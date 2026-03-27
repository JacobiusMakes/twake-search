import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { SearchEngine } from '../src/engine/search-engine.js';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

/**
 * SearchEngine test suite — runs against a throwaway SQLite DB in /tmp.
 */

function makeTmpDb() {
  const dir = mkdtempSync(join(tmpdir(), 'twake-search-test-'));
  const dbPath = join(dir, 'test.db');
  return { dir, dbPath };
}

const sampleDoc = {
  source: 'chat',
  sourceId: 'msg-001',
  title: 'Weekly standup notes',
  body: 'Discussed deployment pipeline improvements and code review practices',
  author: 'alice',
  timestamp: Date.now(),
  url: 'https://chat.example.com/msg-001',
  metadata: { channel: '#engineering' },
};

describe('SearchEngine', () => {
  let engine;
  let tmpDir;

  before(() => {
    const tmp = makeTmpDb();
    tmpDir = tmp.dir;
    engine = new SearchEngine(tmp.dbPath);
  });

  after(() => {
    engine.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // ── index() ──────────────────────────────────────────────────
  it('index() stores a document and returns its composite id', () => {
    const id = engine.index(sampleDoc);
    assert.equal(id, 'chat:msg-001');

    const stats = engine.getStats();
    assert.equal(stats.totalDocuments, 1);
  });

  // ── search() ─────────────────────────────────────────────────
  it('search() finds indexed content by keyword', () => {
    const { results, total } = engine.search('deployment');
    assert.ok(total >= 1, `expected at least 1 result, got ${total}`);
    assert.equal(results[0].id, 'chat:msg-001');
  });

  // ── search() with source filter ──────────────────────────────
  it('search() with source filter only returns matching source', () => {
    // Index a mail doc so there are two sources
    engine.index({
      source: 'mail',
      sourceId: 'mail-001',
      title: 'Deployment schedule',
      body: 'The deployment is planned for Friday afternoon',
      author: 'bob',
      timestamp: Date.now(),
    });

    // Filter to mail only
    const mailOnly = engine.search('deployment', { sources: ['mail'] });
    assert.ok(mailOnly.total >= 1);
    assert.ok(mailOnly.results.every(r => r.source === 'mail'));

    // Filter to chat only
    const chatOnly = engine.search('deployment', { sources: ['chat'] });
    assert.ok(chatOnly.total >= 1);
    assert.ok(chatOnly.results.every(r => r.source === 'chat'));
  });

  // ── indexBatch() ─────────────────────────────────────────────
  it('indexBatch() indexes multiple documents in one transaction', () => {
    const docs = [
      {
        source: 'drive',
        sourceId: 'file-001',
        title: 'Architecture diagram',
        body: 'Microservice architecture overview with service mesh',
        author: 'carol',
        timestamp: Date.now(),
      },
      {
        source: 'drive',
        sourceId: 'file-002',
        title: 'API specification',
        body: 'REST API endpoints for the search service',
        author: 'dave',
        timestamp: Date.now(),
      },
    ];

    const ids = engine.indexBatch(docs);
    assert.equal(ids.length, 2);
    assert.equal(ids[0], 'drive:file-001');
    assert.equal(ids[1], 'drive:file-002');

    const { results } = engine.search('architecture');
    assert.ok(results.some(r => r.id === 'drive:file-001'));
  });

  // ── remove() ─────────────────────────────────────────────────
  it('remove() deletes a document so it no longer appears in search', () => {
    // Make sure it exists first
    const before = engine.search('API specification');
    assert.ok(before.results.some(r => r.id === 'drive:file-002'));

    engine.remove('drive:file-002');

    const afterRemoval = engine.search('API specification');
    assert.ok(!afterRemoval.results.some(r => r.id === 'drive:file-002'));
  });

  // ── getStats() ───────────────────────────────────────────────
  it('getStats() returns correct counts per source', () => {
    const stats = engine.getStats();

    // We should have: chat:msg-001, mail:mail-001, drive:file-001 (file-002 was removed)
    assert.equal(stats.totalDocuments, 3);
    assert.equal(stats.bySource['chat'], 1);
    assert.equal(stats.bySource['mail'], 1);
    assert.equal(stats.bySource['drive'], 1);
    assert.ok(typeof stats.dbSizeBytes === 'number');
  });

  // ── getSyncState() / setSyncState() ──────────────────────────
  it('setSyncState() and getSyncState() round-trip sync state', () => {
    engine.setSyncState('chat', {
      syncToken: 's_12345',
      status: 'idle',
    });

    const state = engine.getSyncState('chat');
    assert.equal(state.connector, 'chat');
    assert.equal(state.sync_token, 's_12345');
    assert.equal(state.status, 'idle');
    assert.ok(typeof state.last_sync === 'number');

    // Update and verify
    engine.setSyncState('chat', {
      syncToken: 's_67890',
      status: 'syncing',
    });

    const updated = engine.getSyncState('chat');
    assert.equal(updated.sync_token, 's_67890');
    assert.equal(updated.status, 'syncing');
  });

  it('getSyncState() returns undefined for unknown connector', () => {
    const state = engine.getSyncState('nonexistent');
    assert.equal(state, undefined);
  });
});
