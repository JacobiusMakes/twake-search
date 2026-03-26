/**
 * Drive Connector — indexes Twake Drive files via Cozy API
 *
 * Indexes file metadata (name, path, dates) and extracts text content
 * from supported formats (plain text, PDF, DOCX) for full-text search.
 *
 * Uses the same Cozy API pattern as twake-cli's drive commands.
 */

import { extractText } from '../extractors/text-extractor.js';

const USER_AGENT = 'twake-search/0.1.0';

export class DriveConnector {
  constructor(engine, config) {
    this.engine = engine;
    this.instanceUrl = config.instanceUrl;
    this.token = config.token;
  }

  get name() { return 'drive'; }

  async _cozyFetch(endpoint, options = {}) {
    const url = `${this.instanceUrl}${endpoint}`;
    const res = await fetch(url, {
      ...options,
      headers: {
        'Authorization': `Bearer ${this.token}`,
        'Content-Type': 'application/vnd.api+json',
        'Accept': 'application/vnd.api+json',
        'User-Agent': USER_AGENT,
        ...options.headers,
      },
    });

    if (!res.ok) {
      const err = await res.text().catch(() => '');
      throw new Error(`Cozy API error ${res.status}: ${err || res.statusText}`);
    }
    return res.json();
  }

  /**
   * Full sync — recursively walk all directories and index files.
   */
  async fullSync() {
    console.log('[drive] Starting full sync...');
    this.engine.setSyncState('drive', { status: 'syncing' });

    let totalIndexed = 0;

    const walkDir = async (dirId, path = '/') => {
      const data = await this._cozyFetch(`/files/${dirId}`);
      const contents = data.included || [];

      for (const item of contents) {
        const attrs = item.attributes || {};
        const name = attrs.name || '';
        const itemPath = `${path}${name}`;

        if (attrs.type === 'directory') {
          await walkDir(item.id, `${itemPath}/`);
        } else {
          // Index file metadata
          const doc = {
            source: 'drive',
            sourceId: item.id,
            title: name,
            body: '', // Will be populated with file content if extractable
            author: attrs.created_by || '',
            timestamp: attrs.updated_at ? new Date(attrs.updated_at).getTime() : Date.now(),
            url: `${this.instanceUrl}/drive/#/folder/${dirId}`,
            metadata: {
              path: itemPath,
              size: attrs.size,
              mime: attrs.mime,
              class: attrs.class,
            },
          };

          // Try to extract text content from supported file types
          if (this._isExtractable(attrs.mime, name)) {
            try {
              const content = await this._downloadFile(item.id);
              if (content) {
                doc.body = await extractText(content, attrs.mime, name);
                if (doc.body) {
                  console.log(`[drive] Extracted ${doc.body.length} chars from ${name}`);
                }
              }
            } catch (err) {
              console.warn(`[drive] Failed to extract content from ${name}: ${err.message}`);
            }
          }

          this.engine.index(doc);
          totalIndexed++;
        }
      }
    };

    await walkDir('io.cozy.files.root-dir');

    this.engine.setSyncState('drive', { status: 'idle' });
    console.log(`[drive] Full sync complete — ${totalIndexed} files indexed`);
    return totalIndexed;
  }

  /**
   * Incremental sync — check for changes since last sync.
   * Uses Cozy's _changes endpoint for CouchDB-style change tracking.
   */
  async incrementalSync() {
    const syncState = this.engine.getSyncState('drive');
    if (!syncState?.sync_token) {
      return this.fullSync();
    }

    console.log('[drive] Starting incremental sync...');
    this.engine.setSyncState('drive', { syncToken: syncState.sync_token, status: 'syncing' });

    try {
      const changes = await this._cozyFetch(
        `/data/io.cozy.files/_changes?since=${syncState.sync_token}&limit=100`
      );

      let indexed = 0;

      for (const result of (changes.results || [])) {
        if (result.deleted) {
          this.engine.remove(`drive:${result.id}`);
          continue;
        }

        const doc = result.doc;
        if (!doc || doc.type === 'directory') continue;

        const indexDoc = {
          source: 'drive',
          sourceId: result.id,
          title: doc.name || '',
          body: '',
          author: doc.created_by || '',
          timestamp: doc.updated_at ? new Date(doc.updated_at).getTime() : Date.now(),
          metadata: {
            path: doc.path,
            size: doc.size,
            mime: doc.mime,
          },
        };

        if (this._isExtractable(doc.mime, doc.name)) {
          try {
            const content = await this._downloadFile(result.id);
            if (content) {
              indexDoc.body = await extractText(content, doc.mime, doc.name);
            }
          } catch { /* non-fatal */ }
        }

        this.engine.index(indexDoc);
        indexed++;
      }

      const newToken = changes.last_seq;
      this.engine.setSyncState('drive', { syncToken: newToken, status: 'idle' });
      console.log(`[drive] Incremental sync: ${indexed} files updated`);
      return indexed;
    } catch (err) {
      console.warn(`[drive] Incremental sync failed, falling back to full sync: ${err.message}`);
      return this.fullSync();
    }
  }

  /**
   * Download a file's content as a Buffer.
   */
  async _downloadFile(fileId) {
    const url = `${this.instanceUrl}/files/downloads/${fileId}`;
    const res = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${this.token}`,
        'User-Agent': USER_AGENT,
      },
    });

    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  }

  /**
   * Check if a file's content can be extracted for indexing.
   * Skip large files (>10MB) and binary formats.
   */
  _isExtractable(mime, fileName) {
    if (!mime && !fileName) return false;

    const m = (mime || '').toLowerCase();
    const ext = fileName?.split('.').pop()?.toLowerCase();

    // Plain text formats
    if (m.startsWith('text/')) return true;

    // PDF
    if (m === 'application/pdf' || ext === 'pdf') return true;

    // DOCX
    if (m === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || ext === 'docx') return true;

    // Code files (detected by extension)
    if (['js', 'ts', 'py', 'rb', 'go', 'rs', 'java', 'c', 'cpp', 'h', 'css', 'html', 'sql', 'sh', 'md', 'json', 'xml', 'yaml', 'yml'].includes(ext)) {
      return true;
    }

    return false;
  }
}
