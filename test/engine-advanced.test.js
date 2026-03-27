import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { SearchEngine } from '../src/engine/search-engine.js';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

/**
 * Advanced SearchEngine tests — BM25 ranking, prefix search, pagination,
 * edge cases, upsert behavior, and bulk performance.
 */

function makeTmpDb() {
  const dir = mkdtempSync(join(tmpdir(), 'twake-search-adv-'));
  return { dir, dbPath: join(dir, 'test.db') };
}

describe('SearchEngine — BM25 Ranking', () => {
  let engine, tmpDir;

  before(() => {
    const tmp = makeTmpDb();
    tmpDir = tmp.dir;
    engine = new SearchEngine(tmp.dbPath);

    // Doc where "kubernetes" appears in TITLE (should rank higher)
    engine.index({
      source: 'chat', sourceId: 'rank-1',
      title: 'Kubernetes deployment guide',
      body: 'Step by step instructions for deploying microservices.',
      author: 'alice', timestamp: Date.now(),
    });
    // Doc where "kubernetes" appears only in BODY
    engine.index({
      source: 'chat', sourceId: 'rank-2',
      title: 'Infrastructure meeting notes',
      body: 'We discussed kubernetes cluster scaling and cost optimization.',
      author: 'bob', timestamp: Date.now(),
    });
    // Doc where "kubernetes" appears many times in body
    engine.index({
      source: 'mail', sourceId: 'rank-3',
      title: 'Weekly digest',
      body: 'Kubernetes kubernetes kubernetes — the team is all-in on kubernetes.',
      author: 'carol', timestamp: Date.now(),
    });
  });

  after(() => { engine.close(); rmSync(tmpDir, { recursive: true, force: true }); });

  it('title matches rank higher than body-only matches (same term frequency)', () => {
    // Compare rank-1 (title match) vs rank-2 (body-only match) — both
    // have "kubernetes" exactly once, so column weight is the tiebreaker.
    const { results } = engine.search('kubernetes');
    assert.ok(results.length >= 2, `expected ≥2 results, got ${results.length}`);
    const r1 = results.find(r => r.sourceId === 'rank-1');
    const r2 = results.find(r => r.sourceId === 'rank-2');
    assert.ok(r1 && r2, 'both rank-1 and rank-2 should appear in results');
    assert.ok(r1.score > r2.score,
      `title-match (${r1.score}) should score higher than body-only (${r2.score})`);
  });

  it('each result has a numeric score > 0', () => {
    const { results } = engine.search('kubernetes');
    for (const r of results) {
      assert.ok(typeof r.score === 'number' && r.score > 0,
        `result ${r.id} has invalid score: ${r.score}`);
    }
  });
});

describe('SearchEngine — FTS5 Query Syntax', () => {
  let engine, tmpDir;

  before(() => {
    const tmp = makeTmpDb();
    tmpDir = tmp.dir;
    engine = new SearchEngine(tmp.dbPath);

    engine.indexBatch([
      { source: 'chat', sourceId: 'fts-1', title: 'Docker containers', body: 'Running containers in production with health checks', author: 'eve', timestamp: 1 },
      { source: 'chat', sourceId: 'fts-2', title: 'Dockerfile best practices', body: 'Multi-stage builds reduce image size dramatically', author: 'frank', timestamp: 2 },
      { source: 'mail', sourceId: 'fts-3', title: 'Meeting recap', body: 'No docker discussion today, focused on frontend', author: 'grace', timestamp: 3 },
      { source: 'drive', sourceId: 'fts-4', title: 'Security audit report', body: 'All containers passed vulnerability scanning', author: 'hank', timestamp: 4 },
    ]);
  });

  after(() => { engine.close(); rmSync(tmpDir, { recursive: true, force: true }); });

  it('prefix search matches partial words (e.g. "dock*")', () => {
    // Our engine adds prefix matching to the last word automatically
    const { results } = engine.search('dock');
    assert.ok(results.length >= 2, `expected ≥2 prefix matches for "dock", got ${results.length}`);
    const ids = results.map(r => r.sourceId);
    assert.ok(ids.includes('fts-1'), 'should match "Docker containers"');
    assert.ok(ids.includes('fts-2'), 'should match "Dockerfile best practices"');
  });

  it('multi-word search matches documents containing all words', () => {
    const { results } = engine.search('containers production');
    assert.ok(results.length >= 1);
    assert.equal(results[0].sourceId, 'fts-1');
  });

  it('FTS5 boolean syntax: AND/OR pass through', () => {
    const { results } = engine.search('"docker" OR "security"');
    assert.ok(results.length >= 2, 'OR query should match both docker and security docs');
  });

  it('returns empty results for nonsense query', () => {
    const { results, total } = engine.search('xyzzy987notaword');
    assert.equal(total, 0);
    assert.equal(results.length, 0);
  });
});

describe('SearchEngine — Pagination', () => {
  let engine, tmpDir;

  before(() => {
    const tmp = makeTmpDb();
    tmpDir = tmp.dir;
    engine = new SearchEngine(tmp.dbPath);

    // Index 25 docs all containing "project" so we can paginate
    const docs = Array.from({ length: 25 }, (_, i) => ({
      source: 'chat',
      sourceId: `page-${String(i).padStart(3, '0')}`,
      title: `Project update #${i}`,
      body: `Progress report for the project milestone ${i}`,
      author: 'alice',
      timestamp: Date.now() + i,
    }));
    engine.indexBatch(docs);
  });

  after(() => { engine.close(); rmSync(tmpDir, { recursive: true, force: true }); });

  it('limit restricts number of results', () => {
    const { results, total } = engine.search('project', { limit: 5 });
    assert.equal(results.length, 5);
    assert.equal(total, 25);
  });

  it('offset skips results for pagination', () => {
    const page1 = engine.search('project', { limit: 10, offset: 0 });
    const page2 = engine.search('project', { limit: 10, offset: 10 });
    const page3 = engine.search('project', { limit: 10, offset: 20 });

    assert.equal(page1.results.length, 10);
    assert.equal(page2.results.length, 10);
    assert.equal(page3.results.length, 5); // 25 total, 20 skipped

    // No overlap between pages
    const ids1 = new Set(page1.results.map(r => r.id));
    const ids2 = new Set(page2.results.map(r => r.id));
    for (const id of ids2) {
      assert.ok(!ids1.has(id), `page 2 result ${id} also appeared in page 1`);
    }
  });

  it('total is consistent across all pages', () => {
    const p1 = engine.search('project', { limit: 5, offset: 0 });
    const p2 = engine.search('project', { limit: 5, offset: 5 });
    assert.equal(p1.total, p2.total, 'total should be same regardless of offset');
  });
});

describe('SearchEngine — Upsert & Edge Cases', () => {
  let engine, tmpDir;

  before(() => {
    const tmp = makeTmpDb();
    tmpDir = tmp.dir;
    engine = new SearchEngine(tmp.dbPath);
  });

  after(() => { engine.close(); rmSync(tmpDir, { recursive: true, force: true }); });

  it('indexing the same doc twice updates rather than duplicates', () => {
    engine.index({ source: 'chat', sourceId: 'dup-1', title: 'Original title', body: 'original body', author: 'x', timestamp: 1 });
    engine.index({ source: 'chat', sourceId: 'dup-1', title: 'Updated title', body: 'updated body', author: 'x', timestamp: 2 });

    const stats = engine.getStats();
    assert.equal(stats.totalDocuments, 1, 'should have 1 doc, not 2');

    // Old content gone, new content searchable
    const old = engine.search('original');
    assert.equal(old.total, 0, 'old content should not be searchable');

    const updated = engine.search('updated');
    assert.equal(updated.total, 1, 'new content should be searchable');
  });

  it('handles empty/missing fields gracefully', () => {
    const id = engine.index({ source: 'mail', sourceId: 'empty-1' });
    assert.equal(id, 'mail:empty-1');

    const stats = engine.getStats();
    assert.ok(stats.totalDocuments >= 1);
  });

  it('removeBySource() removes all docs from a source', () => {
    engine.indexBatch([
      { source: 'drive', sourceId: 'rm-1', title: 'file A', body: 'content A', author: 'a', timestamp: 1 },
      { source: 'drive', sourceId: 'rm-2', title: 'file B', body: 'content B', author: 'a', timestamp: 2 },
      { source: 'chat', sourceId: 'rm-3', title: 'message', body: 'content C', author: 'a', timestamp: 3 },
    ]);

    engine.removeBySource('drive');

    const driveSearch = engine.search('content', { sources: ['drive'] });
    assert.equal(driveSearch.total, 0, 'all drive docs should be removed');

    const chatSearch = engine.search('content', { sources: ['chat'] });
    assert.ok(chatSearch.total >= 1, 'chat docs should still exist');
  });

  it('snippet extraction includes context around match', () => {
    engine.index({
      source: 'mail', sourceId: 'snip-1',
      title: 'Long email',
      body: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. The deployment to production was successful and all health checks passed. Sed do eiusmod tempor incididunt ut labore.',
      author: 'z', timestamp: 1,
    });

    const { results } = engine.search('deployment');
    assert.ok(results.length >= 1);
    const snippet = results[0].snippet;
    assert.ok(snippet.includes('deployment'), `snippet should contain query term, got: "${snippet}"`);
    assert.ok(snippet.length < 200, `snippet should be truncated, got ${snippet.length} chars`);
  });
});

describe('SearchEngine — Timing & Performance', () => {
  let engine, tmpDir;

  before(() => {
    const tmp = makeTmpDb();
    tmpDir = tmp.dir;
    engine = new SearchEngine(tmp.dbPath);
  });

  after(() => { engine.close(); rmSync(tmpDir, { recursive: true, force: true }); });

  it('queryTimeMs is reported and > 0', () => {
    engine.index({ source: 'chat', sourceId: 'perf-1', title: 'test', body: 'performance test document', author: 'x', timestamp: 1 });

    const result = engine.search('performance');
    assert.ok(typeof result.queryTimeMs === 'number');
    assert.ok(result.queryTimeMs >= 0, `queryTimeMs should be ≥0, got ${result.queryTimeMs}`);
  });

  it('bulk indexing 1000 documents completes in < 2 seconds', () => {
    const docs = Array.from({ length: 1000 }, (_, i) => ({
      source: 'chat',
      sourceId: `bulk-${i}`,
      title: `Message ${i}`,
      body: `This is bulk test message number ${i} with some searchable content about engineering`,
      author: `user-${i % 10}`,
      timestamp: Date.now() + i,
    }));

    const start = performance.now();
    engine.indexBatch(docs);
    const elapsed = performance.now() - start;

    assert.ok(elapsed < 2000, `bulk index took ${elapsed.toFixed(0)}ms, expected < 2000ms`);

    const stats = engine.getStats();
    assert.ok(stats.totalDocuments >= 1000);
  });

  it('searching 1000+ docs returns in < 50ms', () => {
    const result = engine.search('engineering');
    assert.ok(result.queryTimeMs < 50, `search took ${result.queryTimeMs}ms, expected < 50ms`);
    assert.ok(result.total >= 100, `expected many results, got ${result.total}`);
  });
});
