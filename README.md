# Moss

> *Quiet, always-on, covering everything.*

A thin, auditable, personally-owned AI assistant living entirely inside Cloudflare's infrastructure. Communicates via Telegram, manages tasks with proactive reminders, builds memory over time, and integrates with the Grove ecosystem.

**Part of:** [grove.place](https://grove.place)

---

## How It Works

```
Telegram → CF Worker (gateway) → LFM triage → Agent Worker → Tools/Memory → Response
```

- **No server, no daemon** — Cloudflare Workers fire on events and exit. Costs $0 when idle.
- **Two-tier LLM** — cheap/fast model triages every message, expensive models only when needed.
- **Three-layer memory** — Core Blocks (always in context), Episodic Memory (conversation summaries), Fact Store (semantic search).
- **Skills are TOML manifests** — auditable, git-tracked, no arbitrary code execution.
- **Owner-only** — unknown Telegram senders are silently dropped.

## Architecture

| Worker | Trigger | Role |
|---|---|---|
| `moss-gateway` | Telegram webhook | Auth, rate limit, route |
| `moss-agent` | Queue / direct invoke | LLM call, tool dispatch, response |
| `moss-scheduler` | Cron trigger | Reminders, daily digests |
| `moss-memory-writer` | Queue (async) | Extract + store facts/episodes |

**Storage:** D1 (tasks, memory, conversations, errors) · KV (config, tool registry, core blocks) · Vectorize (semantic fact search)

## Tech Stack

- TypeScript (Cloudflare Workers)
- Cloudflare D1, KV, Queues, Cron Triggers, Vectorize
- OpenRouter (ZDR-enabled) for LLM calls
- Telegram Bot API (webhook-driven)
- Wrangler CLI for deployment
- Grove: Heartwood (auth), Threshold (rate limiting), Lattice SDK

## Project Structure

```
Moss/
├── src/
│   ├── gateway/        # moss-gateway worker
│   ├── agent/          # moss-agent worker
│   ├── scheduler/      # moss-scheduler worker
│   ├── memory/         # moss-memory-writer worker
│   ├── shared/         # shared types, utilities, clients
│   └── skills/         # skill manifest compiler
├── skills/             # TOML skill manifests
├── scripts/            # deploy, compile-skills, migrations
├── tests/              # test suites
├── docs/               # Moss-Spec.md, architecture docs
├── wrangler.toml       # Cloudflare Worker config
└── package.json        # dependencies
```

## Development

```bash
pnpm install          # install dependencies
pnpm dev              # local dev with wrangler
pnpm test             # run tests
pnpm deploy           # deploy to Cloudflare
```

## Documentation

- **[docs/Moss-Spec.md](docs/Moss-Spec.md)** — Full architecture and design specification
- **[TODOS.md](TODOS.md)** — Current task tracking
- **[COMPLETED.md](COMPLETED.md)** — Done tasks and decisions

---

*Built for grove.place · February 2026*
