# twake-search

> Server-side unified search for [Twake Workplace](https://linagora.com/en/twake-workplace) — because search shouldn't live only in the browser.

Twake Workplace's built-in search runs entirely client-side via a DataProxy service worker. That means no search from the CLI, no search from external tools, and no search API for integrations. **twake-search** fills that gap.

A Fastify REST API backed by SQLite FTS5 that indexes content from Twake Chat (Matrix), Twake Mail (JMAP), and Twake Drive (Cozy), providing instant full-text search across all your Twake data.

## Demo

```
$ curl 'http://localhost:3200/search?q=quarterly+report' | jq .

{
  "query": "quarterly report",
  "results": [
    {
      "source": "mail",
      "title": "Q1 Quarterly Report - Final",
      "snippet": "...please find attached the quarterly report for review...",
      "author": "finance@company.com",
      "score": 4.2
    },
    {
      "source": "chat",
      "title": "#engineering",
      "snippet": "...uploaded the quarterly report to Drive...",
      "author": "jacob",
      "score": 3.1
    },
    {
      "source": "drive",
      "title": "quarterly-report-q1.pdf",
      "snippet": "Revenue grew 12% year-over-year...",
      "author": "jacob",
      "score": 2.8
    }
  ],
  "total": 3,
  "queryTimeMs": 0.46
}
```

One query. Three services. Sub-millisecond.

## How it works

```
                    ┌─────────────────┐
                    │   REST API      │
                    │  GET /search    │
                    └────────┬────────┘
                             │
                    ┌────────▼────────┐
                    │  SQLite FTS5    │
                    │  Search Engine  │
                    └────────┬────────┘
                             │
              ┌──────────────┼──────────────┐
              │              │              │
     ┌────────▼───┐  ┌──────▼─────┐  ┌─────▼──────┐
     │   Matrix   │  │    JMAP    │  │    Cozy    │
     │  Chat Sync │  │  Mail Sync │  │  Drive Sync│
     │ (realtime) │  │  (polling) │  │  (polling) │
     └────────────┘  └────────────┘  └────────────┘
```

- **Chat**: Real-time indexing via Matrix `/sync` long-poll — new messages are searchable instantly
- **Mail**: Incremental sync via JMAP state tracking — only fetches new/changed emails
- **Drive**: Recursive file indexing with text extraction from plain text, PDF, and DOCX files

## Install

```bash
git clone https://github.com/JacobiusMakes/twake-search.git
cd twake-search
npm install
```

Requires Node.js >= 18 and a configured [twake-cli](https://github.com/JacobiusMakes/twake-cli) (shares credentials).

## Quick start

```bash
# Make sure twake-cli is authenticated first
cd ../twake-cli
twake auth login --chat
twake auth login --drive

# Start the search service
cd ../twake-search
npm start
```

The service starts on `http://127.0.0.1:3200`, runs an initial sync, then keeps the index updated in the background.

## API

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/search?q=query` | GET | Search across all indexed services |
| `/search?q=query&sources=chat,mail` | GET | Search specific services |
| `/search/stats` | GET | Index statistics and connector status |
| `/index/refresh` | POST | Trigger re-indexing |
| `/health` | GET | Health check |

### Search parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `q` | string | required | Search query (supports FTS5 syntax: AND, OR, NOT, "phrase", prefix*) |
| `sources` | string | all | Comma-separated filter: `chat`, `mail`, `drive` |
| `limit` | integer | 20 | Max results (1-100) |
| `offset` | integer | 0 | Pagination offset |

## Integration with twake-cli

When twake-search is running, `twake search` automatically proxies through it:

```bash
# Without twake-search: hits each API separately (slow)
# With twake-search: instant indexed results
twake search "meeting notes"
```

## Architecture

```
twake-search/
├── src/
│   ├── server.js                  # Fastify server + startup orchestration
│   ├── api/
│   │   └── routes.js              # REST endpoint definitions
│   ├── engine/
│   │   └── search-engine.js       # SQLite FTS5 (swappable for MeiliSearch)
│   ├── connectors/
│   │   ├── chat-connector.js      # Matrix protocol (real-time sync)
│   │   ├── mail-connector.js      # JMAP protocol (incremental sync)
│   │   └── drive-connector.js     # Cozy API (file content extraction)
│   └── extractors/
│       └── text-extractor.js      # Plain text, PDF, DOCX extraction
└── package.json
```

### Search engine abstraction

The search engine is behind a clean interface (`index`, `search`, `remove`, `getStats`). Currently uses SQLite FTS5 with BM25 ranking. The codebase includes detailed swap notes for migrating to MeiliSearch when needed — search for `MEILISEARCH SWAP NOTE` in `search-engine.js`.

### Document extraction

Supports extracting searchable text from:
- **Plain text** (txt, md, csv, json, code files)
- **PDF** via pdf-parse
- **DOCX** via mammoth

File metadata (name, path, dates) is always indexed even for unsupported formats.

## Configuration

Reads credentials from twake-cli's config file automatically. No duplicate setup needed.

| Environment Variable | Default | Description |
|---------------------|---------|-------------|
| `TWAKE_SEARCH_PORT` | 3200 | Server port |
| `TWAKE_SEARCH_HOST` | 127.0.0.1 | Bind address |
| `TWAKE_CONFIG` | auto-detect | Path to twake-cli config |

## License

AGPL-3.0 — matching Linagora's licensing.

Built to demonstrate that Twake Workplace deserves a server-side search API, not just a browser service worker.
