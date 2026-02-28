# 🌿 Moss — Architecture & Design Specification

> *Quiet, always-on, covering everything.*

**Status:** Pre-build design spec  
**Author:** Autumn Brown + Claude  
**Date:** February 2026  
**Part of:** Grove ecosystem (grove.place)

-----

## Table of Contents

- [Philosophy](#philosophy)
- [What Moss Is (and Isn’t)](#what-moss-is-and-isnt)
- [System Overview](#system-overview)
- [Runtime Architecture](#runtime-architecture)
- [Channel Layer — Telegram](#channel-layer--telegram)
- [LLM Layer — Two-Tier Model Stack](#llm-layer--two-tier-model-stack)
- [Memory System](#memory-system)
- [Tool Registry](#tool-registry)
- [Skill System](#skill-system)
- [Task Management](#task-management)
- [Security Model](#security-model)
- [Grove Integration Points](#grove-integration-points)
- [Data Schema — D1](#data-schema--d1)
- [Open Questions & Future Scope](#open-questions--future-scope)

-----

## Philosophy

Moss is not OpenClaw. Moss is not a deployed nanobot. Moss is a **thin, auditable, personally-owned agent** that lives entirely inside Cloudflare’s infrastructure, uses Grove’s existing primitives, and is small enough to read in an afternoon.

The design is governed by three constraints:

**Trust is earned, not assumed.** Moss starts with limited access and expands over time as trust is established. It cannot deploy code, delete data, or take irreversible actions without explicit confirmation.

**Privacy is structural, not promised.** Memory lives in your own D1 and KV. LLM calls go through OpenRouter with ZDR headers — no training on your data. No third-party memory service ever sees your facts.

**Simplicity over features.** A working, readable system beats a complex one that grows uncontrollable. Every component must be explainable.

-----

## What Moss Is (and Isn’t)

### Moss IS:

- A Telegram-native personal AI assistant
- A task manager that reminds you proactively
- A GitHub issues/PR status tool
- A memory layer that actually knows you over time
- A Grove-adjacent service that calls Grove APIs as a client

### Moss IS NOT:

- A process running on a persistent server you pay for
- A shell-access agent on your Mac
- An OpenClaw fork or derivative
- Able to deploy, merge, or delete anything in Grove or GitHub
- Able to access iMessage (for now)

-----

## System Overview

```
┌─────────────────────────────────────────────────────────┐
│                      TELEGRAM                           │
│          (you ↔ Moss, Moss proactively pings you)       │
└───────────────────────┬─────────────────────────────────┘
                        │ webhook POST
                        ▼
┌─────────────────────────────────────────────────────────┐
│              CF WORKER: moss-gateway                    │
│  - Verifies Telegram webhook secret                     │
│  - Threshold rate limiting (via Lattice SDK)            │
│  - Heartwood auth check (owner-only enforcement)        │
│  - Routes to: agent | task | memory ops                 │
└──────┬──────────────────────┬───────────────────────────┘
       │                      │
       ▼                      ▼
┌─────────────┐     ┌─────────────────────────────────────┐
│ CF QUEUES   │     │         AGENT WORKER                │
│ async/defer │     │                                     │
│ - reminders │     │  LFM2.5-Thinking (triage/route)     │
│ - long jobs │     │       ↓                             │
│ - mem write │     │  OpenRouter + ZDR (execution)       │
└──────┬──────┘     │       ↓                             │
       │            │  Tool dispatcher                    │
       ▼            │       ↓                             │
┌─────────────┐     │  Memory injector (pre-call)         │
│ CF CRON     │     │  Memory writer (post-call, async)   │
│ - scheduled │     └──────────────┬──────────────────────┘
│   reminders │                    │
│ - daily     │                    ▼
│   digests   │     ┌─────────────────────────────────────┐
└─────────────┘     │           STORAGE                   │
                    │  D1:  tasks, episodes, facts, log    │
                    │  KV:  core blocks, config, registry  │
                    │  Vectorize: semantic fact search     │
                    │  R2:  attachments (future)           │
                    └─────────────────────────────────────┘
```

-----

## Runtime Architecture

### Core Principle: Stateless Compute, Stateful Storage

Moss has **no persistent process**. There is no daemon, no VPS, no WebSocket gateway keeping a heartbeat alive. Instead:

- **Incoming messages** → Telegram webhook → CF Worker fires, does work, responds, exits
- **Async tasks** → CF Queues (fire-and-forget, retried automatically)
- **Proactive pings** → CF Cron Triggers (scheduled, e.g. “check tasks due today at 9am”)
- **All state** → D1, KV, Vectorize

This means Moss costs effectively **$0 when idle** and scales without configuration.

### Workers

|Worker              |Trigger                                 |Responsibility                   |
|--------------------|----------------------------------------|---------------------------------|
|`moss-gateway`      |Telegram webhook POST                   |Auth, rate limit, route          |
|`moss-agent`        |Queue message / direct invoke           |LLM call, tool dispatch, response|
|`moss-scheduler`    |Cron trigger                            |Reminder checks, daily digests   |
|`moss-memory-writer`|Queue message (async, post-conversation)|Extract + store facts/episodes   |

### Why Not a Durable Object as the “brain”?

DOs with WebSocket hibernation were considered and ruled out. The gateway pattern of OpenClaw requires a persistent WebSocket connection as the control plane — that design assumes you want to run a process-like thing. Moss doesn’t need that. Telegram webhooks are stateless by design, and CF Workers handle them perfectly. DOs are still available as a tool (e.g., for session deduplication or concurrency locking if ever needed), but they’re not the foundation.

-----

## Channel Layer — Telegram

### Inbound (you → Moss)

Telegram sends a webhook POST to `https://moss.grove.place/telegram` on every message you send. The gateway Worker:

1. Verifies the `X-Telegram-Bot-Api-Secret-Token` header
1. Checks sender ID against an allowlist in KV (owner-only: just you)
1. Applies Threshold rate limiting (e.g. 60 messages/hour max — configurable)
1. Enqueues the message to `moss-agent` queue, or handles synchronously for short responses

### Outbound (Moss → you)

Moss can initiate messages via the Telegram Bot API’s `sendMessage` endpoint. This is how:

- Task reminders fire (“hey, you wanted to review the Nook PR today”)
- Confirmation requests arrive (“I inferred you’re feeling overwhelmed — should I store that?”)
- Daily digests are delivered
- Async job completions are reported (“done — here’s the GitHub issue summary”)

### Message Format

Moss responds in plain conversational text with optional Telegram Markdown for structure. No walls of bullet points. Responses should feel like a knowledgeable friend texting you, not a dashboard printout.

-----

## LLM Layer — Two-Tier Model Stack

### Tier 1 — Router/Triage: LFM2.5-1.2B-Thinking (free)

Every inbound message hits this model first via OpenRouter.

```
Model:    liquid/lfm-2-24b-a2b  (via Together AI, routed through OpenRouter)
Role:     Intent classification, tool selection, complexity assessment
Cost:     ~$0.03/1M input · $0.12/1M output — pennies/day at triage volume
Context:  32K tokens
ZDR:      Together AI has a formal ZDR policy — safe to use
```

> **Why not LFM2.5-1.2B-Thinking (free)?** The free-tier LFM models on OpenRouter conflict
> with an account-wide ZDR toggle — free models don’t honor it consistently. Since Moss runs
> ZDR on every call, free models are off the table on this account. LFM2-24B-A2B via Together
> is the clean v1 answer: proper ZDR, stronger model, trivial cost at triage usage patterns.
> 
> **v2 path:** Swap `ROUTER_BASE_URL` to a local LM Studio endpoint (LFM2.5-1.2B running on
> Mac via Tailscale) once a dedicated always-on Mac is available and trusted for this role.
> The tier-1 interface doesn’t change — it’s just an env var swap.

LFM2-24B-A2B is purpose-built for efficient inference with only 2B active parameters per token despite its 24B total size — fast, cheap, and well above what triage routing needs. It reads your message + recent memory context and outputs a structured routing decision:

```json
{
  "intent": "task_create | task_query | github | memory_query | conversation | reminder_set",
  "complexity": "simple | moderate | complex",
  "tools_needed": ["github_issues", "task_db"],
  "route_to": "simple_response | full_agent | queue_async",
  "confidence": 0.92
}
```

Simple responses (greetings, quick lookups) can be handled entirely by LFM without touching the execution tier.

### Tier 2 — Execution: OpenRouter + ZDR

For anything requiring reasoning, generation, or tool use:

```
Provider: OpenRouter (https://openrouter.ai/api/v1)
ZDR Header: X-No-Data-Logging: true  ← on every single request
Testing models:  minimax/minimax-m2.5, mistralai/kimi-k2.5
Production models: anthropic/claude-sonnet-4-6, google/gemini-2.5-pro
Selection: LFM Tier 1 routes based on complexity assessment
```

The ZDR header is set at the HTTP client level, not per-call — it cannot be forgotten. This is non-negotiable for a personal assistant with access to your task list, memory, and GitHub.

### Model Selection Logic

```
simple intent, LFM confident → LFM handles it, no Tier 2
moderate complexity → MiniMax M2.5 (cheap, fast, good enough)
complex reasoning, multi-step → Claude Sonnet (production) / Kimi (testing)
code generation / GitHub ops → Kimi K2.5 or Claude
```

-----

## Memory System

### The Three Layers

#### Layer 1 — Core Blocks (KV, always injected)

A structured document stored in KV at `moss:core-blocks`. Human-readable, editable by you directly. Injected at the top of every system prompt.

**Initial seed (you seed this, Moss refines over time):**

```yaml
identity:
  name: Autumn Brown
  pronouns: she/her
  age: 24
  location: Atlanta area, GA
  timezone: America/New_York
  orientation: demisexual — vibes first, always
  aesthetic: solarpunk, nature-themed everything

work:
  primary_focus: Grove (grove.place) — full-time, this is the livelihood
  financial_context: >
    High pressure. Revenue-generating Grove work takes priority lens.
    Don't be alarmist, just hold it as context when helping prioritize.
  github: autumnsgrove

currently_focused_on:           # Moss updates this naturally over time
  - "Nook: private video platform for 1.5TB of DJI Osmo Pro 5 footage"
  - "Moss: building this"
  - Grove financial sustainability

tech_profile:
  languages: [Python, Go, Svelte, TypeScript]
  interests: [systems programming, MCP servers]
  coding_philosophy: >
    Functional-OOP hybrid, composition over inheritance,
    ADHD-friendly small steps, map/filter over loops
  infra: Apple ecosystem (Mac, iPhone, iPad Pro M5, Apple Watch), Tailscale mesh

communication_style:
  respond_in: conversational prose, not bullet walls
  technical_depth: high — do not simplify unless asked
  pacing: one thing at a time, ADHD-friendly
  open_ended_messages: flesh them out, ask only if genuinely unclear
  dislikes: [most-popular defaults, over-engineered solutions, excessive caveats]
  likes: [indie picks, clean simple answers, honest pushback]

interests:
  books: [Haruki Murakami, science fiction]
  games: Cyberpunk 2077
  reads: Hacker News
  dream: "midnight bloom — queer-friendly late-night bookstore + tea cafe"

health_context: >
  Psychiatric evaluation in progress, takes Guanfacine.
  Handle mood/energy observations with care, not clinical distance.
  Do not catastrophize. Ask before storing anything inferred here.

reminder_window: "[SET THIS YOURSELF before first deploy]"

do_not_store: []    # fill this in privately before deploy
do_not_mention: []
```

Moss can propose updates to Core Blocks — you confirm before they’re written.

**Size target: under 600 tokens.** It’s always in context; keep it lean.

#### Layer 2 — Episodic Memory (D1, `moss_episodes` table)

After every conversation, `moss-memory-writer` (async, queued) reads the full transcript and LFM extracts a compact episode summary:

```
"Feb 28 afternoon: Autumn was designing Moss architecture. Decided on CF-native stateless approach, no VPS. Skeptical of OpenClaw security. Wants Telegram + proactive reminders. Memory is the priority feature. Energy seemed high, engaged."
```

At the start of a new conversation, Moss pulls:

- Last 5 episodes always
- Semantic search across all episodes for relevant older ones (via Vectorize)

Episodes are never deleted automatically. You can delete them manually.

#### Layer 3 — Fact/Preference Store (D1 + Vectorize)

Discrete extracted facts with embeddings. Every time you share something meaningful, LFM extracts it:

```
"prefers reminders no earlier than 9am"
"midnight bloom cafe idea is emotionally important, not just a business idea"  
"currently in psychiatric evaluation — treat energy/mood mentions with care"
"dislikes Notion and most-popular-option defaults"
"Nook is for personal DJI footage, 1.5TB, sharing with friends only"
```

**The confirmation gate** — for inferred facts (not explicitly stated), Moss asks before storing:

> “Hey — I got the sense you’re feeling stretched thin right now. Want me to note that for context, or skip it?”

You say yes → stored with `confidence: inferred`. You say no → discarded, never stored. Explicitly stated facts → stored immediately with `confidence: confirmed`.

At conversation start, Vectorize semantic search against your message retrieves the most relevant facts (top 10-15) and injects them into context.

### Memory Write Flow

```
[conversation ends or message threshold hit]
         ↓
Enqueue to moss-memory-writer (async, no latency impact)
         ↓
LFM2.5-Thinking reads transcript
         ↓
Extracts: facts (new/changed), episode summary, core block updates
         ↓
Facts: D1 insert + Vectorize upsert
Episode: D1 insert
Core block changes: ← HOLD, send confirmation message to Telegram first
         ↓
Done. ~$0 (free tier LFM + D1 writes)
```

### Memory Editing Interface

You can manage memory via natural language in Telegram:

- `"forget that I mentioned X"` → marks fact as deleted in D1
- `"what do you remember about Nook?"` → Vectorize search, returns matching facts
- `"update your core blocks: I'm no longer at Home Depot"` → direct edit with confirmation
- `"show me recent episodes"` → returns last N episode summaries

-----

## Tool Registry

Tools are registered in KV at `moss:tools`. Each tool is a typed function the agent worker can call.

### v1 Tool Set (launch scope)

|Tool                  |Description                        |Auth Required     |Write?       |
|----------------------|-----------------------------------|------------------|-------------|
|`github_issues_list`  |List open issues in a repo         |GitHub PAT (read) |No           |
|`github_issue_get`    |Get single issue details           |GitHub PAT (read) |No           |
|`github_issue_comment`|Add comment to issue               |GitHub PAT (write)|Yes — confirm|
|`github_pr_list`      |List open PRs and status           |GitHub PAT (read) |No           |
|`github_pr_status`    |Get CI status for a PR             |GitHub PAT (read) |No           |
|`task_create`         |Create a task in D1                |Internal          |Yes          |
|`task_list`           |List pending tasks                 |Internal          |No           |
|`task_complete`       |Mark task done                     |Internal          |Yes          |
|`reminder_set`        |Set a timed reminder via Cron      |Internal          |Yes          |
|`memory_search`       |Search fact/episode store          |Internal          |No           |
|`memory_forget`       |Mark a fact deleted                |Internal          |Yes — confirm|
|`grove_status`        |Ping Grove service health endpoints|Heartwood token   |No           |

### Tool Execution Safety Rules

1. **Read ops** → execute immediately, no confirmation
1. **Write ops** (marked above) → show proposed action first, wait for “yes” / “do it” / explicit go-ahead
1. **Destructive ops** (delete, close, remove) → always confirm, restate exactly what will be deleted
1. **No deployments** — no `wrangler deploy`, no merge actions, no env var changes. Ever. This is not in scope.

-----

## Skill System

### Philosophy: Manifests, Not Code

OpenClaw’s skill hub became a malware vector because skills are arbitrary code executed inside the agent’s process with full system permissions. A third-party skill is indistinguishable from the agent itself.

Moss skills are different in a fundamental way: **a skill is a typed TOML manifest, not executable code.** It declares what a skill does, what integration it calls, and what permissions it requires. All execution stays inside Moss’s own Workers — code you wrote and reviewed. A skill cannot do anything Moss’s Worker doesn’t explicitly allow.

Adding a skill is a git commit. Removing one is a git commit. The entire skill surface is auditable at a glance.

### Skill Manifest Format

Skills live in a `skills/` directory in the Moss repo. Each skill is a `.toml` file:

```toml
[skill]
name        = "web-search"
description = "Search the web for current information via Tavily"
version     = "1.0.0"
author      = "autumnsgrove"

[trigger]
# Hints to the LFM router for when to reach for this skill
keywords    = ["search", "look up", "find", "what's", "current", "news", "latest"]
intents     = ["web_search", "research", "fact_check"]

[integration]
type        = "mcp"
server_url  = "https://mcp.tavily.com/mcp/?tavilyApiKey={{TAVILY_API_KEY}}"
tools       = ["tavily_search", "tavily_extract"]  # explicit allowlist — not all tools

[permissions]
network      = true
memory_write = false   # results not stored unless you explicitly ask
cost_class   = "low"   # guards against LFM reaching for expensive skills on trivial queries

[limits]
max_calls_per_conversation = 5
timeout_ms  = 8000
```

Secrets are referenced as `{{ENV_VAR_NAME}}` — never stored in the manifest itself. Resolved at runtime from CF Secrets.

### Integration Types

Skills come in two shapes:

**`type = "mcp"`** — the skill talks to an MCP server. Moss has a built-in MCP client module. Connecting an MCP-native service is almost entirely config — write the manifest, point it at the server URL, allowlist the tools you want. The MCP client handles protocol, auth, and response normalization.

**`type = "adapter"`** — the skill talks to a small Moss-owned Worker that bridges to an integration without a native MCP server. The adapter Worker speaks “Moss tool API” inward and whatever the integration needs outward. From the agent’s perspective, adapter and MCP skills are identical.

### The MCP Client Layer

A shared Worker module, loaded by `moss-agent`, that:

1. Reads the skill registry from KV at `moss:skills` (compiled from manifests on deploy)
1. Passes relevant skill descriptors to the LFM router as available tools
1. Dispatches to MCP server or adapter Worker when LFM selects a skill
1. Enforces timeout, retry limits, `max_calls_per_conversation`, and cost class guards on every call
1. Wraps all external content in `<external_content>` tags before passing to the execution LLM — prompt injection mitigation

### Skill Registry (KV)

At deploy time, manifests are compiled into a single JSON registry stored at `moss:skills`. Structure:

```json
{
  "web-search": {
    "description": "Search the web for current information via Tavily",
    "trigger": { "keywords": [...], "intents": [...] },
    "integration": { "type": "mcp", "server_url": "...", "tools": [...] },
    "permissions": { "network": true, "memory_write": false, "cost_class": "low" },
    "limits": { "max_calls_per_conversation": 5, "timeout_ms": 8000 },
    "enabled": true
  }
}
```

Enabling/disabling a skill at runtime: `moss:skills:{name}:enabled` KV key. You can toggle skills via Telegram without a deploy: `"disable web search for now"` → Moss flips the KV key.

### v1 Skill Roadmap

#### Tier 1 — MCP-native (nearly free once MCP client exists)

**`web-search`** — Tavily MCP. Web search, page extraction. Triggered on research/lookup intents. Low cost class — only fires when genuinely needed, not for every question.

**`web-research`** — Exa MCP. Semantic search, better for technical/HN-style queries. Complements Tavily. Cost class: medium (Exa is better but pricier per call).

**`calendar`** — Google Calendar MCP. Read events, create events, check availability. Moss can answer “what do I have Thursday” or “block two hours for Nook work Friday morning.” Write operations always confirm first.

#### Tier 2 — Adapter skills (small builds, higher value)

**`rss-digest`** — Cron-triggered. Fetches configured RSS feeds + HN front page, summarizes via LFM, delivers a brief digest on your schedule. Self-contained — no external dependencies beyond feed URLs. Easiest skill to build after the MCP client.

Feed config lives in KV at `moss:skills:rss-digest:feeds`:

```json
[
  { "name": "Hacker News", "url": "https://news.ycombinator.com/rss", "priority": "high" },
  { "name": "...", "url": "..." }
]
```

You manage feeds via Telegram: `"add [url] to my feeds"` / `"show my feeds"`.

### Skill Safety Rules

These are enforced by the MCP client layer, not the LLM — the LLM cannot override them:

- Skills with `memory_write = false` cannot write to D1 or Vectorize regardless of what the LLM requests
- `max_calls_per_conversation` is a hard counter, not a suggestion
- All content from external skill calls is tagged `<external_content>` before reaching the execution LLM
- Skills are never called for write operations without a confirmation round-trip to Telegram first
- A skill can be fully disabled in KV without a code deploy

### Adding a New Skill (the full flow)

```
1. Write skills/my-skill.toml
2. Add any required secrets to CF Secrets
3. If adapter: write + deploy the adapter Worker
4. Run: wrangler kv:put moss:skills "$(scripts/compile-skills.py)"
5. Text Moss: "what skills do you have?" — verify it appears
6. Done.
```

No Moss core code changes. No redeploy of moss-agent. Skills are data, not code, inside the agent’s trust boundary.

-----

## Task Management

### Design Philosophy

The goal is “text it open-ended things and get rich reminders.” Not a Notion clone. Not a project management tool. A system smart enough to extract structure from natural language and surface it at the right time.

**Example flows:**

```
You: "remind me to review the Nook thumbnail PR sometime this week, 
      probably not before wednesday"
Moss: "Got it — I'll ping you Wednesday morning about the Nook thumbnail PR."
      [stores task, schedules Cron check for Wed 9am]

Wednesday 9:05am:
Moss: "Morning — you wanted to review the Nook thumbnail PR today. 
       Want me to pull the current status?"
```

```
You: "i need to figure out my credit card situation at some point"
Moss: "Want me to keep that on your radar? I can surface it weekly 
       until you mark it done, or just once — your call."
```

### D1 Schema (tasks)

```sql
CREATE TABLE moss_tasks (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  body        TEXT,                    -- full context, original message
  status      TEXT DEFAULT 'pending',  -- pending | snoozed | done | cancelled
  priority    TEXT DEFAULT 'normal',   -- low | normal | high
  due_at      INTEGER,                 -- unix timestamp, nullable
  remind_at   INTEGER,                 -- when to next ping
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  tags        TEXT,                    -- JSON array of strings
  source      TEXT DEFAULT 'telegram'  -- where it came from
);
```

### Reminder Delivery

CF Cron Trigger fires `moss-scheduler` every morning at 9am ET. It:

1. Queries D1 for tasks where `remind_at <= now()`
1. Builds a brief digest or individual pings depending on count
1. Sends via Telegram Bot API
1. Updates `remind_at` for recurring tasks

For time-specific reminders (“remind me at 3pm Tuesday”), Cron runs every 15 minutes during waking hours (configurable in KV).

-----

## Security Model

### Threat Model

Moss has access to: your tasks, your memories, your GitHub PAT, your Grove service endpoints. The threat vectors are:

- **Prompt injection** — malicious content in GitHub issues/PRs that tries to hijack Moss
- **Runaway agent** — Moss loops or goes haywire and racks up API charges
- **Credential exposure** — API keys leaked via logs or error messages
- **Scope creep** — Moss doing things outside its defined tool set

### Mitigations

**Prompt injection:** All external content (GitHub issue bodies, PR descriptions) is wrapped in `<external_content>` tags with a system instruction that explicitly states this content is untrusted and cannot override instructions. LFM triage layer provides a second validation pass before execution.

**Runaway agent / cost protection:** Threshold rate limiting via Lattice SDK. Configurable hard cap (e.g. 200 OpenRouter calls/day). CF Worker CPU limits provide a natural execution ceiling. Queues have retry limits and dead-letter handling.

**Credential security:** All secrets in CF Secrets (never in KV or D1). Never logged. Never included in error messages returned to Telegram. Error messages to you are generic; full errors go to a separate `moss_errors` D1 table for debugging.

**Scope:** Tool registry is the hard boundary. If a tool isn’t registered, it cannot be called. Adding new tools requires a code deploy — not a prompt instruction.

**Owner-only:** Telegram sender ID allowlist in KV. Any message from an unknown sender is silently dropped (no response, no error — don’t confirm the bot exists to strangers).

### GitHub Access

GitHub PAT is read-only by default. The `github_issue_comment` tool requires a separate PAT with write scope — stored separately, only loaded when that specific tool is invoked. This way, read operations have minimal blast radius if the read PAT leaks.

-----

## Grove Integration Points

Moss is **Grove-adjacent**, not Grove-internal. It authenticates to Grove services as an API client using a Heartwood service token (not a user session token).

### Current integration points

|Grove Service|How Moss Uses It                                      |
|-------------|------------------------------------------------------|
|Heartwood    |Validates the Moss service token on each request      |
|Threshold    |Rate limiting import via Lattice SDK                  |
|Lattice      |Base SDK for CF primitives (KV, D1, Queue helpers)    |
|Amber        |Future: file attachment storage for Moss              |
|Foliage      |Future: if Grove gets internal status/health endpoints|

### What Moss does NOT touch

- Heartwood user database (it has no user management access)
- Amber directly on behalf of other Grove users
- Any deployment pipeline
- Nook internals (it knows Nook exists from your memory, but has no API access)

-----

## Data Schema — D1

### Database: `moss-db`

```sql
-- Core memory: extracted facts
CREATE TABLE moss_facts (
  id            TEXT PRIMARY KEY,
  content       TEXT NOT NULL,           -- the actual fact
  confidence    TEXT NOT NULL,           -- 'confirmed' | 'inferred'
  embedding_id  TEXT,                    -- Vectorize vector ID
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  deleted_at    INTEGER,                 -- soft delete
  source        TEXT                     -- which conversation
);

-- Episodic memory: per-conversation summaries  
CREATE TABLE moss_episodes (
  id          TEXT PRIMARY KEY,
  summary     TEXT NOT NULL,
  mood_signal TEXT,                      -- optional inferred mood
  embedding_id TEXT,
  created_at  INTEGER NOT NULL,
  deleted_at  INTEGER
);

-- Task management
CREATE TABLE moss_tasks (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  body        TEXT,
  status      TEXT DEFAULT 'pending',
  priority    TEXT DEFAULT 'normal',
  due_at      INTEGER,
  remind_at   INTEGER,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  tags        TEXT,
  source      TEXT DEFAULT 'telegram'
);

-- Conversation log (for memory writer input)
CREATE TABLE moss_conversations (
  id          TEXT PRIMARY KEY,
  messages    TEXT NOT NULL,             -- JSON array
  started_at  INTEGER NOT NULL,
  ended_at    INTEGER,
  processed   INTEGER DEFAULT 0          -- 0 = awaiting memory extraction
);

-- Error log (internal debugging only, never exposed to Telegram)
CREATE TABLE moss_errors (
  id          TEXT PRIMARY KEY,
  error       TEXT NOT NULL,
  context     TEXT,
  created_at  INTEGER NOT NULL
);
```

### KV Namespaces

|Key Pattern           |Contents                                                   |
|----------------------|-----------------------------------------------------------|
|`moss:core-blocks`    |The always-injected facts YAML document                    |
|`moss:config`         |Runtime config (rate limits, model choices, cron schedules)|
|`moss:tools`          |Tool registry (enabled tools, their configs)               |
|`moss:allowlist`      |Telegram sender ID allowlist                               |
|`moss:telegram-offset`|Webhook update offset (dedup)                              |

-----

## Open Questions & Future Scope

### Deliberately Deferred

- **iMessage** — requires a Mac relay process (BlueBubbles). Revisit when trust is established and a dedicated always-on Mac is set aside for it.
- **Tailscale / Mac access** — ruled out for v1. Moss stays in CF, no direct machine access.
- **Nook integration** — Moss knows about Nook from memory, but has no API access. Future: read-only status endpoint.
- **Verge integration** — Autumn is already building GitHub agentic workflows there; Moss’s GitHub tools deliberately avoid overlap.
- **Voice** — LFM2.5-Audio-1.5B exists and is interesting for future voice note processing via Telegram voice messages.
- **Vectorize** — needs to be provisioned for Moss (not currently part of Grove). Decision: standalone Moss Vectorize index, not shared with any Grove service.

### Things to Decide Before Build Starts

- [x] **Moss’s Heartwood service token** — Moss calls Heartwood as an API client with a service token. Scope: read-only identity verification only. No user management access.
- [x] **GitHub PAT strategy** — one read-only PAT across all repos. Simple, acceptable blast radius for v1. Revisit per-repo fine-grained tokens if scope expands.
- [x] **Telegram bot name** — `@GroveMossBot` (day-to-day: just “Moss”). Forest druid energy.
- [x] **Reminder time window** — owner-managed in Core Blocks. Not hardcoded. Moss reads the window from Core Blocks before any proactive ping.
- [ ] **Core Blocks initial seed** — write the actual document before first deploy *(in progress)*
- [ ] **OpenRouter ZDR verification** — confirm `X-No-Data-Logging: true` is active on your account tier at openrouter.ai/settings before first deploy. Available on paid accounts only.

-----

*Built for grove.place · Autumn Brown · February 2026*  
*🌿 Quiet, always-on, covering everything.*
