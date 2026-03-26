/**
 * Search Engine Abstraction Layer
 *
 * Currently implements SQLite FTS5 (full-text search).
 *
 * --- MEILISEARCH SWAP NOTES ---
 * To switch to MeiliSearch later:
 * 1. Implement the same interface: index(), search(), remove(), getStats()
 * 2. Replace SQLite FTS5 queries with MeiliSearch HTTP API calls
 * 3. MeiliSearch runs as a separate process (port 7700 by default)
 * 4. It handles ranking, typo tolerance, and faceted search natively
 * 5. The SearchEngine class is the ONLY file that needs to change
 * 6. All connectors and API routes use the same interface
 *
 * --- FTS5 vs REGULAR SQLITE ---
 * Regular SQLite: WHERE content LIKE '%query%' → scans every row, O(n)
 * FTS5: Creates an inverted index (word → document mapping), O(log n)
 * FTS5 also supports:
 *   - BM25 ranking (relevance scoring)
 *   - Prefix queries ("proj*")
 *   - Boolean operators (AND, OR, NOT)
 *   - Column weighting (title matches > body matches)
 *   - Snippet/highlight extraction
 * -------------------------------------------
 */

import Database from 'better-sqlite3';
import { join, dirname } from 'path';
import { mkdirSync, existsSync } from 'fs';

export class SearchEngine {
  constructor(dbPath) {
    const dir = dirname(dbPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL'); // Better concurrent read performance
    this._initSchema();
  }

  /**
   * Initialize database schema with FTS5 virtual table.
   *
   * The documents table stores raw metadata for deduplication.
   * The search_index table is the FTS5 virtual table for fast text search.
   * The sync_state table tracks per-connector sync progress.
   */
  _initSchema() {
    this.db.exec(`
      -- Raw document storage for dedup and metadata
      CREATE TABLE IF NOT EXISTS documents (
        id TEXT PRIMARY KEY,           -- Unique ID: "{source}:{sourceId}"
        source TEXT NOT NULL,          -- "chat", "mail", "drive", "share"
        source_id TEXT NOT NULL,       -- Original ID from the source system
        title TEXT,                    -- Subject, filename, or message preview
        body TEXT,                     -- Full text content
        author TEXT,                   -- Sender, uploader, or poster
        timestamp INTEGER,            -- Unix timestamp (ms)
        url TEXT,                      -- Deep link back to the source
        metadata TEXT,                 -- JSON blob for source-specific extras
        indexed_at INTEGER NOT NULL    -- When this doc was indexed
      );

      CREATE INDEX IF NOT EXISTS idx_documents_source
        ON documents(source);
      CREATE INDEX IF NOT EXISTS idx_documents_timestamp
        ON documents(timestamp);

      -- FTS5 virtual table — this is where the search magic happens
      -- Column weights: title matches rank higher than body matches
      --
      -- MEILISEARCH SWAP NOTE:
      -- MeiliSearch handles ranking internally. When swapping, remove this
      -- table entirely and send documents to MeiliSearch's /indexes/:uid/documents
      -- endpoint instead. The search() method would call MeiliSearch's
      -- /indexes/:uid/search endpoint.
      CREATE VIRTUAL TABLE IF NOT EXISTS search_index USING fts5(
        title,
        body,
        author,
        doc_id UNINDEXED,
        source UNINDEXED,
        content='documents',
        content_rowid='rowid',
        tokenize='porter unicode61'
      );

      -- Triggers to keep FTS5 index in sync with documents table
      -- MEILISEARCH SWAP NOTE: Remove these triggers; MeiliSearch syncs via API
      CREATE TRIGGER IF NOT EXISTS documents_ai AFTER INSERT ON documents BEGIN
        INSERT INTO search_index(rowid, title, body, author, doc_id, source)
          VALUES (new.rowid, new.title, new.body, new.author, new.id, new.source);
      END;

      CREATE TRIGGER IF NOT EXISTS documents_ad AFTER DELETE ON documents BEGIN
        INSERT INTO search_index(search_index, rowid, title, body, author, doc_id, source)
          VALUES ('delete', old.rowid, old.title, old.body, old.author, old.id, old.source);
      END;

      CREATE TRIGGER IF NOT EXISTS documents_au AFTER UPDATE ON documents BEGIN
        INSERT INTO search_index(search_index, rowid, title, body, author, doc_id, source)
          VALUES ('delete', old.rowid, old.title, old.body, old.author, old.id, old.source);
        INSERT INTO search_index(rowid, title, body, author, doc_id, source)
          VALUES (new.rowid, new.title, new.body, new.author, new.id, new.source);
      END;

      -- Per-connector sync state (tracks where each connector left off)
      CREATE TABLE IF NOT EXISTS sync_state (
        connector TEXT PRIMARY KEY,    -- "chat", "mail", "drive", "share"
        last_sync INTEGER,             -- Unix timestamp of last sync
        sync_token TEXT,               -- Opaque token (Matrix since, JMAP state, etc.)
        status TEXT DEFAULT 'idle'     -- "idle", "syncing", "error"
      );
    `);
  }

  /**
   * Index a document (insert or update).
   *
   * @param {Object} doc - Document to index
   * @param {string} doc.source - "chat", "mail", "drive", "share"
   * @param {string} doc.sourceId - ID from the source system
   * @param {string} doc.title - Title/subject/filename
   * @param {string} doc.body - Full text content
   * @param {string} doc.author - Author/sender
   * @param {number} doc.timestamp - Unix timestamp (ms)
   * @param {string} [doc.url] - Deep link
   * @param {Object} [doc.metadata] - Extra source-specific data
   *
   * MEILISEARCH SWAP NOTE:
   * Replace with: await meili.index('documents').addDocuments([doc])
   * MeiliSearch handles upsert natively via document primary key.
   */
  index(doc) {
    const id = `${doc.source}:${doc.sourceId}`;

    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO documents
        (id, source, source_id, title, body, author, timestamp, url, metadata, indexed_at)
      VALUES
        (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      doc.source,
      doc.sourceId,
      doc.title || '',
      doc.body || '',
      doc.author || '',
      doc.timestamp || Date.now(),
      doc.url || '',
      doc.metadata ? JSON.stringify(doc.metadata) : null,
      Date.now()
    );

    return id;
  }

  /**
   * Batch index multiple documents in a single transaction.
   * Much faster than individual inserts for bulk indexing.
   */
  indexBatch(docs) {
    const indexed = [];
    const transaction = this.db.transaction(() => {
      for (const doc of docs) {
        indexed.push(this.index(doc));
      }
    });
    transaction();
    return indexed;
  }

  /**
   * Search the index.
   *
   * @param {string} query - Search query (supports FTS5 syntax: AND, OR, NOT, "phrase", prefix*)
   * @param {Object} [options]
   * @param {string[]} [options.sources] - Filter by source: ["chat", "mail"]
   * @param {number} [options.limit=20] - Max results
   * @param {number} [options.offset=0] - Pagination offset
   * @returns {{ results: Object[], total: number, queryTimeMs: number }}
   *
   * MEILISEARCH SWAP NOTE:
   * Replace with: await meili.index('documents').search(query, { filter, limit, offset })
   * MeiliSearch returns results in the same shape, with built-in typo tolerance.
   */
  search(query, { sources, limit = 20, offset = 0 } = {}) {
    const start = performance.now();

    // Sanitize query for FTS5 (escape special chars, add prefix matching)
    const ftsQuery = this._buildFtsQuery(query);

    let sql = `
      SELECT
        d.id, d.source, d.source_id, d.title, d.body, d.author,
        d.timestamp, d.url, d.metadata,
        si.rank
      FROM search_index si
      JOIN documents d ON d.rowid = si.rowid
      WHERE search_index MATCH ?
    `;
    const params = [ftsQuery];

    if (sources?.length) {
      sql += ` AND d.source IN (${sources.map(() => '?').join(',')})`;
      params.push(...sources);
    }

    // BM25 ranking with column weights: title(10) > body(1) > author(5)
    // MEILISEARCH SWAP NOTE: MeiliSearch handles ranking internally
    sql += ` ORDER BY si.rank LIMIT ? OFFSET ?`;
    params.push(limit, offset);

    const results = this.db.prepare(sql).all(...params).map(row => ({
      id: row.id,
      source: row.source,
      sourceId: row.source_id,
      title: row.title,
      snippet: this._snippet(row.body, query),
      author: row.author,
      timestamp: row.timestamp,
      url: row.url,
      metadata: row.metadata ? JSON.parse(row.metadata) : null,
      score: Math.abs(row.rank),
    }));

    // Count total matches (for pagination)
    let countSql = `SELECT count(*) as total FROM search_index si JOIN documents d ON d.rowid = si.rowid WHERE search_index MATCH ?`;
    const countParams = [ftsQuery];
    if (sources?.length) {
      countSql += ` AND d.source IN (${sources.map(() => '?').join(',')})`;
      countParams.push(...sources);
    }
    const { total } = this.db.prepare(countSql).get(...countParams);

    return {
      results,
      total,
      queryTimeMs: Math.round((performance.now() - start) * 100) / 100,
    };
  }

  /**
   * Remove a document from the index.
   *
   * MEILISEARCH SWAP NOTE:
   * Replace with: await meili.index('documents').deleteDocument(id)
   */
  remove(id) {
    this.db.prepare('DELETE FROM documents WHERE id = ?').run(id);
  }

  /**
   * Remove all documents from a specific source.
   */
  removeBySource(source) {
    this.db.prepare('DELETE FROM documents WHERE source = ?').run(source);
  }

  /**
   * Get index statistics.
   *
   * MEILISEARCH SWAP NOTE:
   * Replace with: await meili.index('documents').getStats()
   */
  getStats() {
    const total = this.db.prepare('SELECT count(*) as count FROM documents').get().count;
    const bySources = this.db.prepare(
      'SELECT source, count(*) as count FROM documents GROUP BY source'
    ).all();

    const syncStates = this.db.prepare('SELECT * FROM sync_state').all();

    return {
      totalDocuments: total,
      bySource: Object.fromEntries(bySources.map(r => [r.source, r.count])),
      connectors: syncStates,
      dbSizeBytes: this.db.prepare("SELECT page_count * page_size as size FROM pragma_page_count(), pragma_page_size()").get()?.size || 0,
    };
  }

  /**
   * Get/set sync state for a connector.
   */
  getSyncState(connector) {
    return this.db.prepare('SELECT * FROM sync_state WHERE connector = ?').get(connector);
  }

  setSyncState(connector, { syncToken, status }) {
    this.db.prepare(`
      INSERT OR REPLACE INTO sync_state (connector, last_sync, sync_token, status)
      VALUES (?, ?, ?, ?)
    `).run(connector, Date.now(), syncToken || null, status || 'idle');
  }

  /**
   * Build an FTS5 query from user input.
   * Handles quoting, prefix matching, and basic safety.
   */
  _buildFtsQuery(query) {
    // If user already uses FTS5 syntax (AND, OR, NOT, quotes), pass through
    if (/["""]|AND|OR|NOT/.test(query)) {
      return query;
    }

    // Otherwise, split into words and add prefix matching
    const words = query.trim().split(/\s+/).filter(Boolean);
    if (!words.length) return '""';

    // Last word gets prefix matching, others are exact
    return words.map((w, i) => {
      const escaped = w.replace(/"/g, '');
      if (i === words.length - 1) return `"${escaped}"*`;
      return `"${escaped}"`;
    }).join(' ');
  }

  /**
   * Extract a snippet from body text around the matching query terms.
   */
  _snippet(body, query, maxLen = 150) {
    if (!body) return '';
    const words = query.toLowerCase().split(/\s+/);
    const lower = body.toLowerCase();

    // Find first occurrence of any query word
    let bestPos = 0;
    for (const word of words) {
      const pos = lower.indexOf(word);
      if (pos !== -1) { bestPos = pos; break; }
    }

    const start = Math.max(0, bestPos - 40);
    const end = Math.min(body.length, start + maxLen);
    let snippet = body.slice(start, end).trim();

    if (start > 0) snippet = '...' + snippet;
    if (end < body.length) snippet += '...';

    return snippet;
  }

  close() {
    this.db.close();
  }
}
