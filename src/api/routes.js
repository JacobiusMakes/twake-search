/**
 * REST API Routes for twake-search
 *
 * GET  /search        — Unified search across all indexed services
 * GET  /search/stats  — Index statistics and connector status
 * POST /index/refresh — Trigger re-indexing for one or all connectors
 * GET  /health        — Health check
 */

export function registerRoutes(fastify, { engine, connectors }) {

  /**
   * GET /search?q=query&sources=chat,mail,drive&limit=20&offset=0
   *
   * Returns search results ranked by relevance (BM25) across all indexed
   * Twake Workplace services. Results include snippets and source metadata.
   */
  fastify.get('/search', {
    schema: {
      querystring: {
        type: 'object',
        required: ['q'],
        properties: {
          q: { type: 'string', minLength: 1 },
          sources: { type: 'string' },  // Comma-separated: "chat,mail,drive"
          limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
          offset: { type: 'integer', minimum: 0, default: 0 },
        },
      },
    },
  }, async (request) => {
    const { q, sources, limit, offset } = request.query;
    const sourceList = sources ? sources.split(',').map(s => s.trim()) : undefined;

    const result = engine.search(q, { sources: sourceList, limit, offset });

    return {
      query: q,
      ...result,
    };
  });

  /**
   * GET /search/stats
   *
   * Returns index statistics: total documents, per-source counts,
   * connector sync states, and database size.
   */
  fastify.get('/search/stats', async () => {
    return engine.getStats();
  });

  /**
   * POST /index/refresh
   * Body: { "sources": ["chat", "mail", "drive"] } or omit for all
   *
   * Triggers re-indexing. For chat/mail, does incremental sync if possible.
   * For drive, does incremental sync based on CouchDB _changes.
   */
  fastify.post('/index/refresh', {
    schema: {
      body: {
        type: 'object',
        properties: {
          sources: {
            type: 'array',
            items: { type: 'string', enum: ['chat', 'mail', 'drive'] },
          },
          full: { type: 'boolean', default: false },
        },
      },
    },
  }, async (request) => {
    const { sources, full } = request.body || {};
    const targetSources = sources || Object.keys(connectors);

    const results = {};

    for (const source of targetSources) {
      const connector = connectors[source];
      if (!connector) {
        results[source] = { error: `Unknown connector: ${source}` };
        continue;
      }

      try {
        const method = full ? 'fullSync' : 'incrementalSync';
        const syncFn = connector[method] || connector.fullSync;
        const count = await syncFn.call(connector);
        results[source] = { indexed: count, status: 'ok' };
      } catch (err) {
        results[source] = { error: err.message, status: 'error' };
      }
    }

    return { results, stats: engine.getStats() };
  });

  /**
   * GET /health
   */
  fastify.get('/health', async () => {
    return {
      status: 'ok',
      version: '0.1.0',
      uptime: process.uptime(),
      indexed: engine.getStats().totalDocuments,
    };
  });
}
