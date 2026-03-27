/**
 * twake-search — Unified Search Service for Twake Workplace
 *
 * A Fastify-based REST API that indexes content from Twake Chat (Matrix),
 * Twake Mail (JMAP), and Twake Drive (Cozy), providing server-side unified
 * search across all Twake products.
 *
 * Twake's built-in search is client-side only (DataProxy service worker in
 * the browser). This service fills the gap with a proper server-side search
 * API backed by SQLite FTS5.
 *
 * Usage:
 *   npm start                         Start with default config
 *   npm start -- --demo               Start with sample data (no credentials needed)
 *   TWAKE_CONFIG=path node server.js  Start with custom config path
 *
 * Configuration is loaded from twake-cli's config file by default,
 * so both tools share the same credentials.
 */

import Fastify from 'fastify';
import { join, dirname } from 'path';
import { existsSync, readFileSync } from 'fs';
import { homedir } from 'os';

import { SearchEngine } from './engine/search-engine.js';
import { ChatConnector } from './connectors/chat-connector.js';
import { MailConnector } from './connectors/mail-connector.js';
import { DriveConnector } from './connectors/drive-connector.js';
import { registerRoutes } from './api/routes.js';
import { seedDemoData } from './demo/seed.js';

// --- Configuration ---

const PORT = parseInt(process.env.TWAKE_SEARCH_PORT || '3200');
const HOST = process.env.TWAKE_SEARCH_HOST || '127.0.0.1';
const DEMO_MODE = process.argv.includes('--demo');

/**
 * Load config from twake-cli's config file.
 * This way both tools share credentials — no duplicate auth setup.
 */
function loadConfig() {
  // Try twake-cli's config locations (conf package defaults)
  const configPaths = [
    process.env.TWAKE_CONFIG,
    join(homedir(), 'Library/Preferences/twake-cli-nodejs/config.json'),   // macOS
    join(homedir(), '.config/twake-cli-nodejs/config.json'),                // Linux
    join(process.env.APPDATA || '', 'twake-cli-nodejs/Config/config.json'), // Windows
  ].filter(Boolean);

  for (const p of configPaths) {
    if (existsSync(p)) {
      console.log(`[config] Loaded from ${p}`);
      return JSON.parse(readFileSync(p, 'utf-8'));
    }
  }

  console.error('[config] No twake-cli config found. Run `twake auth login` first.');
  process.exit(1);
}

// --- Server Setup ---

async function main() {
  // --- Demo mode: seed sample data, skip real connectors ---
  if (DEMO_MODE) {
    console.log('[demo] Starting in demo mode — no credentials required');

    const dbDir = join(homedir(), '.twake-search');
    const dbPath = join(dbDir, 'demo.db');

    console.log(`[engine] Database: ${dbPath}`);
    const engine = new SearchEngine(dbPath);

    seedDemoData(engine);

    const fastify = Fastify({ logger: { level: 'info' } });
    registerRoutes(fastify, { engine, connectors: {} });

    await fastify.listen({ port: PORT, host: HOST });
    console.log(`\n[demo] twake-search running at http://${HOST}:${PORT}`);
    console.log(`[demo] Try these queries:`);
    console.log(`[demo]   curl http://${HOST}:${PORT}/search?q=project`);
    console.log(`[demo]   curl http://${HOST}:${PORT}/search?q=deployment+pipeline`);
    console.log(`[demo]   curl http://${HOST}:${PORT}/search?q=budget&sources=drive`);
    console.log(`[demo]   curl http://${HOST}:${PORT}/search/stats`);

    const shutdown = async () => {
      console.log('\n[server] Shutting down...');
      await fastify.close();
      engine.close();
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
    return;
  }

  // --- Normal mode: load config and start connectors ---
  const config = loadConfig();

  // Database stored alongside the config
  const dbDir = join(homedir(), '.twake-search');
  const dbPath = join(dbDir, 'search.db');

  console.log(`[engine] Database: ${dbPath}`);
  const engine = new SearchEngine(dbPath);

  // Initialize connectors based on available config
  const connectors = {};

  if (config.matrix?.homeserver && config.matrix?.accessToken) {
    connectors.chat = new ChatConnector(engine, config.matrix);
    console.log('[connector] Chat (Matrix) — ready');
  }

  if (config.jmap?.sessionUrl && config.jmap?.bearerToken) {
    connectors.mail = new MailConnector(engine, config.jmap);
    console.log('[connector] Mail (JMAP) — ready');
  }

  if (config.cozy?.instanceUrl && config.cozy?.token) {
    connectors.drive = new DriveConnector(engine, config.cozy);
    console.log('[connector] Drive (Cozy) — ready');
  }

  if (!Object.keys(connectors).length) {
    console.error('[server] No services configured. Run `twake auth login` to connect services.');
    process.exit(1);
  }

  // Create Fastify server
  const fastify = Fastify({
    logger: { level: 'info' },
  });

  // Register routes
  registerRoutes(fastify, { engine, connectors });

  // Start server
  await fastify.listen({ port: PORT, host: HOST });
  console.log(`\n[server] twake-search running at http://${HOST}:${PORT}`);
  console.log(`[server] Search: GET http://${HOST}:${PORT}/search?q=hello`);
  console.log(`[server] Stats:  GET http://${HOST}:${PORT}/search/stats`);

  // Initial sync on startup
  console.log('\n[sync] Running initial index sync...');
  for (const [name, connector] of Object.entries(connectors)) {
    try {
      const syncState = engine.getSyncState(name);
      if (syncState?.sync_token) {
        await connector.incrementalSync();
      } else {
        await connector.fullSync();
      }
    } catch (err) {
      console.error(`[sync] ${name} sync failed: ${err.message}`);
    }
  }
  console.log('[sync] Initial sync complete\n');

  // Start real-time sync for chat
  if (connectors.chat) {
    connectors.chat.startRealtimeSync();
  }

  // Periodic sync for mail and drive (every 5 minutes)
  setInterval(async () => {
    for (const [name, connector] of Object.entries(connectors)) {
      if (name === 'chat') continue; // Chat uses real-time sync
      try {
        await connector.incrementalSync();
      } catch (err) {
        console.error(`[sync] Periodic ${name} sync failed: ${err.message}`);
      }
    }
  }, 5 * 60 * 1000);

  // Graceful shutdown
  const shutdown = async () => {
    console.log('\n[server] Shutting down...');
    connectors.chat?.stopRealtimeSync();
    await fastify.close();
    engine.close();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch(err => {
  console.error(`[server] Fatal: ${err.message}`);
  process.exit(1);
});
