# Moss v2 — Durable Agent Architecture Spec

> *Quiet, always-on, covering everything — now with teeth.*

**Status:** Design spec (pre-build)
**Author:** Autumn Brown + Claude
**Date:** March 2026
**Part of:** Grove ecosystem (grove.place)
**Supersedes:** Moss-Spec.md (v1 — queue-based, no execution)

---

## What Changed and Why

Moss v1 is a stateless Worker with a Queue-based pipeline. It triages via
Modal, dispatches structured tools, and replies via OpenRouter. It works, but
it has a fundamental gap: **it cannot execute anything**. No bash, no file ops,
no git, no curl. Every capability must be hand-coded as a structured tool.

OpenClaw proved that 4 universal primitives (read, write, edit, bash) can
handle virtually any task. Moss v2 brings that capability to a serverless,
single-user architecture while preserving the safety-first philosophy.

### Key Shifts

| v1 | v2 |
|----|-----|
| Stateless Worker + Queue | Durable Object (session brain) + Worker (webhook) |
| No code execution | Cloudflare Sandbox (isolated container exec) |
| All state in D1 | Hot state in DO SQLite, cold archive in D1 |
| Queue-driven async | DO alarms for async work |
| Modal does triage + execution | Modal does triage + tool reasoning; OpenRouter does conversation |
| No compaction | Heuristic-first auto-compaction with LFM fallback |
| ~12 structured tools | Structured tools + sandbox exec |

---

## Philosophy (Unchanged)

**Trust is earned, not assumed.** Read operations execute freely. Write
operations require confirmation. Destructive operations always confirm with
specifics.

**Privacy is structural, not promised.** Memory lives in your own D1 and DO
SQLite. LLM calls go through OpenRouter with ZDR. Modal runs on your own GPU
via your own account.

**Simplicity over features.** Every component must be explainable. The system
is for one person (Autumn). No multi-tenancy, no user management, no billing.

**New: Execution is sandboxed, not forbidden.** v1 avoided execution entirely.
v2 allows it inside VM-isolated containers that cannot reach the host, the
network (beyond what's allowed), or Cloudflare internals.

---

## System Overview

```
┌──────────────────────────────────────────────────────────────┐
│                        TELEGRAM                               │
│            (you <-> Moss, Moss proactively pings you)         │
└─────────────────────────┬────────────────────────────────────┘
                          │ webhook POST
                          v
┌──────────────────────────────────────────────────────────────┐
│                  CF WORKER: moss-gateway                      │
│                                                               │
│  1. Verify Telegram webhook secret                            │
│  2. Rate limit (owner-only enforcement)                       │
│  3. Triage via Modal (LFM 2.5)                                │
│     - simple_response -> conversational model -> reply        │
│     - agent_loop -> route to Durable Object                   │
│  4. Simple responses handled directly in Worker               │
│                                                               │
└────────────┬────────────────────────────────┬────────────────┘
             │ simple_response                │ agent_loop
             v                                v
┌─────────────────────┐    ┌────────────────────────────────────┐
│ OpenRouter           │    │   DURABLE OBJECT: MossSession      │
│ (MiniMax/Claude/Kimi)│    │                                    │
│                      │    │   Internal SQLite:                  │
│ Quick conversational │    │   ├─ messages                      │
│ reply, no tools      │    │   ├─ tool_calls                    │
│                      │    │   ├─ compaction_state               │
│                      │    │   └─ session_meta                   │
└─────────────────────┘    │                                    │
                            │   Agent Loop:                      │
                            │   1. Build context from SQLite     │
                            │   2. Call Modal (LFM) for reasoning│
                            │   3. Dispatch tool calls:          │
                            │      ├─ Structured tools (local)   │
                            │      └─ Sandbox exec (container)   │
                            │   4. Feed results back to LFM      │
                            │   5. Repeat until done             │
                            │   6. Call OpenRouter for final msg  │
                            │   7. Send via Telegram              │
                            │   8. Update progress log            │
                            │                                    │
                            │   Async (via alarms):              │
                            │   - Memory extraction -> D1         │
                            │   - Session archive -> D1           │
                            │   - Compaction checks               │
                            │   - Reminder delivery               │
                            │                                    │
                            └────────────┬───────────────────────┘
                                         │
                            ┌────────────v───────────────────────┐
                            │   CF SANDBOX CONTAINER              │
                            │                                     │
                            │   VM-isolated Ubuntu Linux           │
                            │   Python, Node.js, Git, curl, jq    │
                            │                                     │
                            │   exec("curl https://api.example")  │
                            │   exec("python analyze.py")         │
                            │   exec("git clone ...")             │
                            │   exec("jq '.data[]' file.json")   │
                            │                                     │
                            │   Cannot access:                    │
                            │   - Cloudflare internals             │
                            │   - Host network (beyond allowed)   │
                            │   - Other Workers/DOs               │
                            │   - Persistent state (ephemeral)    │
                            └─────────────────────────────────────┘
```

---

## Component Architecture

### 1. Gateway Worker (`src/gateway/`)

The HTTP entry point. Handles Telegram webhook, runs triage, routes.

**Responsibilities:**
- Verify Telegram webhook secret
- Owner-only enforcement (OWNER_TELEGRAM_ID)
- Call Modal for triage classification
- Handle simple_response flow directly (no DO needed)
- Route agent_loop to MossSession DO
- Handle /commands (e.g., /model, /status)

**Does NOT:**
- Hold conversation state
- Execute tools
- Call the big model for complex reasoning

```typescript
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // 1. Telegram webhook verification
    // 2. Rate limit check
    // 3. Triage via Modal
    // 4. Route:
    //    - simple_response → OpenRouter → reply
    //    - agent_loop → env.MOSS_SESSION.get(chatId).process(message)
  }
}
```

### 2. MossSession Durable Object (`src/session/`)

The brain. One DO per chat ID. Manages conversation state, runs the agent
loop, orchestrates tool calls, handles compaction.

**Internal SQLite Schema:**

```sql
CREATE TABLE messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  role TEXT NOT NULL,             -- user | assistant | system | tool_call | tool_result
  content TEXT NOT NULL,
  token_count INTEGER NOT NULL,
  tool_call_id TEXT,              -- links tool_result to its tool_call
  tool_name TEXT,                 -- for tool_call/tool_result rows
  compacted INTEGER DEFAULT 0,   -- 0=active, 1=compacted (still in DB for archive)
  created_at INTEGER NOT NULL
);

CREATE TABLE compaction_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  messages_start_id INTEGER NOT NULL,
  messages_end_id INTEGER NOT NULL,
  summary TEXT NOT NULL,
  tokens_saved INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE session_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
-- Keys: model, created_at, last_active, total_tokens, sandbox_tier
```

**Agent Loop (inside the DO):**

```typescript
async processMessage(userMessage: string, messageId: number): Promise<void> {
  // 1. Store user message in SQLite
  this.storeMessage("user", userMessage, countTokens(userMessage));

  // 2. Check compaction threshold
  if (this.shouldCompact()) await this.compact();

  // 3. Build context window
  const context = this.buildContext(); // system prompt + compacted summaries + recent messages

  // 4. Agent loop (max N rounds)
  for (let round = 0; round < MAX_ROUNDS; round++) {
    // 4a. Call Modal (LFM) with context + available tools
    const response = await this.callModal(context);

    // 4b. If done, break
    if (response.done) break;

    // 4c. Execute tool calls
    for (const toolCall of response.tool_calls) {
      const result = await this.dispatchTool(toolCall);
      this.storeMessage("tool_result", result, countTokens(result));
      context.push({ role: "tool_result", content: result });
    }

    // 4d. Update Telegram progress log
    await this.updateProgressLog(round, response.tool_calls);
  }

  // 5. Generate final conversational response via OpenRouter
  const reply = await this.generateReply(context);

  // 6. Send to Telegram
  await this.sendTelegram(reply);

  // 7. Store assistant response
  this.storeMessage("assistant", reply, countTokens(reply));

  // 8. Schedule async work via alarm
  await this.ctx.storage.setAlarm(Date.now() + 5000); // memory extraction in 5s
}
```

**Hibernation behavior:**
- DO stays alive during active conversation
- After idle timeout (configurable, default 5 min), DO hibernates
- On next message, DO wakes, SQLite is intact, resumes
- Zero cost while hibernating

### 3. Sandbox Container (`src/sandbox/`)

Ephemeral execution environment. Spun up when triage routes to agent_loop,
torn down after the conversation chain ends (or idle timeout).

**Lifecycle: Hybrid Triage-Gated**
- No container until triage routes to agent_loop
- Container stays alive for the conversation session
- Sleeps on idle timeout (DO alarm cleans up)
- Next agent_loop message wakes it (may cold-start ~2-5s)

**Instance Tier: Configurable (default: lite)**

```typescript
// In wrangler config
containers: [{
  class_name: "MossSandbox",
  image: "./sandbox/Dockerfile",
  instance_type: "lite",  // user can upgrade via /sandbox-tier command
  max_instances: 1,        // single user, one sandbox
}]
```

**Custom Dockerfile:**
```dockerfile
FROM ubuntu:22.04
RUN apt-get update && apt-get install -y \
  python3 python3-pip \
  nodejs npm \
  git curl wget jq \
  && rm -rf /var/lib/apt/lists/*

# Pre-install useful Python packages
RUN pip3 install requests httpx beautifulsoup4 pandas

WORKDIR /workspace
```

**Execution approval model:**

| Operation Type | Approval | Examples |
|---------------|----------|---------|
| Read-only | Auto-approve | curl, cat, ls, git status, git log, python (read scripts) |
| Write (file) | Auto-approve (in sandbox) | write files, edit files, mkdir |
| Write (network) | Confirm | git push, curl -X POST, pip install |
| Destructive | Always confirm | rm -rf, git reset --hard |
| Allowlisted | Auto-approve | User-defined commands added over time |

**The DO classifies commands before execution:**
```typescript
async dispatchExec(command: string): Promise<ExecResult> {
  const classification = classifyCommand(command);

  if (classification === "read" || this.isAllowlisted(command)) {
    return await this.sandbox.exec(command);
  }

  if (classification === "write_network" || classification === "destructive") {
    // Ask via Telegram inline keyboard
    const approved = await this.requestApproval(command, classification);
    if (!approved) return { success: false, error: "Denied by owner" };
  }

  return await this.sandbox.exec(command);
}
```

### 4. Modal Integration (`src/modal/`)

LFM 2.5 on Modal handles all structured decision-making.

**Endpoints:**

| Endpoint | Purpose | Input | Output |
|----------|---------|-------|--------|
| `/triage` | Classify intent, pick route | message, memory, available_tools | route, intent, tools_needed |
| `/reason` | Agent loop reasoning | context, tools, tool_results | tool_calls[] or done+summary |
| `/vision` | Image understanding | image_base64, caption, memory | description, extracted_facts |
| `/extract` | Memory extraction | transcript | facts[], episode_summary |
| `/compact` | Summarize old messages | messages_to_compact | compressed_summary |

**Key difference from v1:** The `/reason` endpoint replaces the old
`/execute` endpoint. Instead of Modal running the full loop, the DO runs the
loop and calls Modal for each reasoning step. This keeps state management in
the DO and lets Modal stay stateless.

**The `/compact` endpoint is the fallback.** DO-side heuristic compaction runs
first (drop tool results, truncate old messages, keep user/assistant text).
Only if heuristic isn't sufficient does it call Modal for LLM summarization.

### 5. Tool System (`src/tools/`)

Hybrid model: structured tools + sandbox exec.

**Structured tools (fast, safe, no container needed):**

| Tool | Category | Approval |
|------|----------|----------|
| github_issues_list | GitHub | Auto |
| github_issue_get | GitHub | Auto |
| github_issue_comment | GitHub | Confirm |
| github_pr_list | GitHub | Auto |
| github_pr_status | GitHub | Auto |
| task_create | Tasks | Auto |
| task_list | Tasks | Auto |
| task_complete | Tasks | Auto |
| reminder_set | Tasks | Auto |
| memory_search | Memory | Auto |
| memory_forget | Memory | Confirm |
| grove_status | Grove | Auto |

**Sandbox tools (container required):**

| Tool | Description | Approval |
|------|-------------|----------|
| exec | Run a shell command | Classified per command |
| read_file | Read file from sandbox workspace | Auto |
| write_file | Write file to sandbox workspace | Auto (sandboxed) |
| run_code | Execute Python/JS with persistent context | Classified |

**Tool definitions sent to LFM include both sets.** LFM decides whether to use
a structured tool or sandbox exec for any given task. Structured tools are
preferred when available (faster, no container startup, no approval needed for
reads).

### 6. Conversation Management

**Session-per-chat model.** One MossSession DO per Telegram chat ID.

**Context window construction:**

```
┌─────────────────────────────────────────────────┐
│ System prompt (~500 tokens)                      │
│ - Personality, rules, tool list                  │
├─────────────────────────────────────────────────┤
│ Compacted summaries (variable)                   │
│ - "Earlier, we discussed X, decided Y..."        │
├─────────────────────────────────────────────────┤
│ Recent messages (last N, within token budget)    │
│ - Full user/assistant/tool exchanges             │
├─────────────────────────────────────────────────┤
│ Current user message                             │
└─────────────────────────────────────────────────┘
```

**Token budget management:**

```typescript
const MODEL_CONTEXT_WINDOW = 32_768; // LFM 2.5 context window (configurable)
const SYSTEM_PROMPT_BUDGET = 1_000;
const RESPONSE_BUDGET = 2_048;
const AVAILABLE_FOR_CONTEXT = MODEL_CONTEXT_WINDOW - SYSTEM_PROMPT_BUDGET - RESPONSE_BUDGET;
// = ~29,700 tokens for compacted summaries + recent messages

const COMPACTION_THRESHOLD = 0.80; // Trigger compaction at 80% of available budget
```

**Auto-compaction algorithm:**

```
1. Sum token_count of all non-compacted messages
2. If total < AVAILABLE_FOR_CONTEXT * COMPACTION_THRESHOLD → no action
3. Otherwise, run heuristic compaction first:
   a. Drop tool_result messages older than N turns (keep summary line)
   b. Truncate long assistant messages to first 200 tokens
   c. Merge consecutive system messages
   d. Recalculate total
4. If still over threshold, call Modal /compact:
   a. Send oldest non-compacted messages to LFM
   b. LFM returns compressed summary
   c. Mark originals as compacted=1
   d. Insert summary as new compacted message
5. Schedule D1 flush alarm (archive compacted messages)
```

### 7. D1 Archive & Memory

**D1 is the cold archive.** DO SQLite is the hot working memory.

**Flush pattern:**
- DO alarm fires after conversation goes idle (5 min)
- Batch-write all new messages to D1 `conversation_history` table
- Batch-write any new compaction logs
- Extract memory facts and write to D1 `moss_facts` table

**D1 Schema (evolved from v1):**

```sql
-- Conversation archive (flushed from DO SQLite)
CREATE TABLE conversation_history (
  id TEXT PRIMARY KEY,
  chat_id INTEGER NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  token_count INTEGER NOT NULL,
  tool_name TEXT,
  compacted INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL,
  flushed_at INTEGER NOT NULL
);

-- Existing tables from v1 (preserved)
CREATE TABLE moss_facts (...);          -- semantic memory
CREATE TABLE moss_episodes (...);       -- conversation summaries
CREATE TABLE moss_core_blocks (...);    -- owner profile
CREATE TABLE moss_tasks (...);          -- task management
CREATE TABLE moss_errors (...);         -- error log
```

**Memory context building:**
- On new message, DO queries D1 for relevant facts (semantic search via text matching)
- Future: Vectorize embeddings for proper semantic search
- Memory context injected into system prompt for both triage and agent loop

---

## Model Routing

```
                    ┌──────────────────────────────────┐
                    │           User Message            │
                    └───────────────┬──────────────────┘
                                    │
                    ┌───────────────v──────────────────┐
                    │   LFM 2.5 via Modal (/triage)    │
                    │   Cost: ~$0.001 per call          │
                    │                                   │
                    │   Decides:                        │
                    │   - simple_response               │
                    │   - agent_loop                    │
                    └──────┬──────────────┬────────────┘
                           │              │
              ┌────────────v──┐    ┌──────v──────────────────┐
              │  OpenRouter    │    │  DO Agent Loop           │
              │  (conv. model) │    │                          │
              │                │    │  Each reasoning step:    │
              │  MiniMax M2.5  │    │  LFM 2.5 via Modal      │
              │  Claude Sonnet │    │  (/reason endpoint)      │
              │  Kimi K2.5     │    │  Cost: ~$0.001/step      │
              │                │    │                          │
              │  Cost: varies  │    │  Final response:         │
              │  $0.002-0.03   │    │  OpenRouter (conv model) │
              └────────────────┘    └──────────────────────────┘
```

**Cost profile for a typical agent interaction:**
- Triage: ~$0.001 (LFM, tiny)
- 3 reasoning steps: ~$0.003 (LFM, tiny)
- Final response: ~$0.002–0.03 (depends on model)
- **Total: ~$0.006–0.034 per agent interaction**

**Cost profile for a simple chat:**
- Triage: ~$0.001
- Response: ~$0.002–0.03
- **Total: ~$0.003–0.031 per simple chat**

---

## Security Model

### Layer 1: Owner-Only Enforcement
- OWNER_TELEGRAM_ID checked on every webhook
- No other users can interact with Moss
- Single sandbox, single DO, single owner

### Layer 2: Sandbox Isolation
- VM-isolated container (Cloudflare Containers)
- Cannot access Cloudflare internals, other Workers, or host network
- Ephemeral workspace — state doesn't persist across sessions unless
  explicitly copied out
- Custom Dockerfile controls what's available

### Layer 3: Command Classification
- Read-only commands: auto-approved
- Write-to-network commands: require Telegram confirmation
- Destructive commands: always confirm with specifics
- User-maintained allowlist for frequently used commands

### Layer 4: Credential Isolation
- API keys (GitHub, OpenRouter, Modal) stay in CF Secrets
- Structured tools use credentials directly — never exposed to sandbox
- Sandbox has NO access to CF Secrets
- If sandbox needs API access, it goes through a structured tool or
  the DO proxies the request

### Prompt Injection Defenses (Unchanged from v1)
- External content wrapped in `<external_content>` tags
- LFM trained to ignore instructions in external content
- Tool results are data, not instructions
- Sandbox output treated as untrusted data

---

## Wrangler Configuration

```toml
name = "moss"
main = "src/index.ts"
compatibility_date = "2025-02-24"
compatibility_flags = ["nodejs_compat"]

# --- Durable Object ---
[[durable_objects.bindings]]
name = "MOSS_SESSION"
class_name = "MossSession"

[[migrations]]
tag = "v1"
new_sqlite_classes = ["MossSession"]

# --- Sandbox Container ---
[[containers]]
class_name = "MossSandbox"
image = "./sandbox/Dockerfile"
instance_type = "lite"
max_instances = 1

[[durable_objects.bindings]]
name = "SANDBOX"
class_name = "MossSandbox"

[[migrations]]
tag = "v2"
new_sqlite_classes = ["MossSandbox"]

# --- D1 Database (cold archive) ---
[[d1_databases]]
binding = "DB"
database_name = "moss-db"
database_id = "9e3895bc-0035-4cca-8aa0-fc78449a4eb9"

# --- KV (lightweight config) ---
[[kv_namespaces]]
binding = "KV"
id = "361174d7af9b48e9b839a8e340be7e46"

# --- Cron Triggers ---
[triggers]
crons = [
  "0 13 * * *",       # 9am ET daily digest
  "*/15 13-3 * * *"   # Every 15 min during waking hours (reminders)
]

[vars]
ENVIRONMENT = "production"
```

---

## File Structure (Clean Rewrite)

```
src/
├── index.ts                    # Worker entry: fetch + scheduled
├── gateway/
│   ├── index.ts                # Webhook handler, triage routing
│   ├── router.ts               # Path routing (/telegram, /health)
│   └── ratelimit.ts            # Owner-only + rate limiting
├── session/
│   ├── durable-object.ts       # MossSession DO class
│   ├── agent-loop.ts           # Reasoning loop (Modal calls)
│   ├── context-builder.ts      # Build LLM context from SQLite
│   ├── compaction.ts           # Heuristic + LFM compaction
│   ├── schema.ts               # SQLite table creation
│   └── flush.ts                # D1 archive flush logic
├── sandbox/
│   ├── index.ts                # Sandbox interface
│   ├── classifier.ts           # Command classification (read/write/destructive)
│   ├── approval.ts             # Telegram inline keyboard approval flow
│   └── Dockerfile              # Container image definition
├── tools/
│   ├── index.ts                # Tool registry + dispatcher
│   ├── definitions.ts          # LLM tool definitions (OpenAI format)
│   ├── github.ts               # GitHub structured tools
│   ├── tasks.ts                # Task management tools
│   ├── memory.ts               # Memory search/forget tools
│   └── grove.ts                # Grove status tools
├── modal/
│   ├── client.ts               # Modal HTTP client
│   ├── triage.ts               # /triage endpoint caller
│   ├── reason.ts               # /reason endpoint caller (new)
│   ├── vision.ts               # /vision endpoint caller
│   ├── extract.ts              # /extract endpoint caller
│   └── compact.ts              # /compact endpoint caller (new)
├── memory/
│   ├── extractor.ts            # Fact/episode extraction
│   ├── context.ts              # Memory context builder
│   └── index.ts                # Memory read/write orchestration
├── shared/
│   ├── env.ts                  # Env interface (bindings + secrets)
│   ├── types.ts                # Shared type definitions
│   ├── telegram.ts             # Telegram API helpers
│   ├── openrouter.ts           # OpenRouter API client
│   ├── tokens.ts               # Token counting utilities
│   └── utils.ts                # Shared utilities
└── scheduler/
    ├── index.ts                # Cron handler (delegates to DO alarms)
    └── reminders.ts            # Reminder delivery logic
```

---

## Migration from v1

**Approach: Clean rewrite with DO as the core.**

The current codebase is ~1,500 lines across 25 files. Small enough to
rewrite cleanly rather than incrementally bolt on a DO.

**What carries over directly:**
- Tool implementations (github.ts, tasks.ts, memory.ts, grove.ts)
- Telegram helpers (telegram.ts)
- OpenRouter client (openrouter.ts)
- Modal client (modal.ts — extended with /reason and /compact)
- Memory extraction logic (extractor.ts)
- D1 schema (extended, not replaced)
- Type definitions (types.ts — extended)

**What gets rewritten:**
- Entry point (index.ts — no more queue consumer)
- Gateway (simpler — triage + route to DO)
- Agent processing (executor.ts → session/agent-loop.ts in DO)
- Progress logging (now managed by DO, not a separate module)
- Provider routing (simplified — Modal for reasoning, OpenRouter for conversation)

**What's new:**
- MossSession Durable Object (session/durable-object.ts)
- Context builder with token tracking (session/context-builder.ts)
- Auto-compaction system (session/compaction.ts)
- Sandbox integration (sandbox/*)
- Command classifier (sandbox/classifier.ts)
- Approval flow (sandbox/approval.ts)

**D1 migration:**
- Add `conversation_history` table
- Existing tables (moss_facts, moss_tasks, etc.) unchanged
- Data in existing tables preserved

---

## Pricing Summary (Single User, Workers Paid $5/mo)

| Component | Included Free | Estimated Monthly Cost |
|-----------|--------------|----------------------|
| Workers (gateway) | 10M requests | $0 |
| Durable Objects (session) | 1M requests, 400K GB-s | $0 |
| DO SQLite storage | 5 GB | $0 |
| Containers (lite sandbox) | 25 GiB-hr, 375 vCPU-min | $0 (light use) |
| D1 (archive) | 25B reads, 50M writes, 5 GB | $0 |
| KV (config) | 10M reads | $0 |
| Modal (LFM 2.5) | Your own GPU | ~$0 (already running) |
| OpenRouter (conv. model) | Pay per token | ~$5-15/mo (usage dependent) |
| **Total** | | **~$10-20/mo** |

The only variable cost is OpenRouter for the conversational model. Everything
on Cloudflare stays within included allowances for personal use.

---

## Open Questions

1. **Vectorize integration** — Should memory search move from text matching to
   proper vector similarity via Cloudflare Vectorize? Would improve recall
   quality significantly.

2. **Sandbox persistence** — Should the sandbox workspace persist across
   sessions? Could mount a small persistent volume for project files the agent
   works on repeatedly.

3. **Multi-channel** — Discord and Signal support. The DO architecture makes
   this easier (one DO per chat, channel-agnostic internally).

4. **Streaming responses** — Current architecture sends complete responses.
   Could use Telegram's edit-message API to stream partial responses for long
   agent chains.

5. **Modal /reason vs direct tool calling** — Some models (Claude, GPT-4o)
   have native tool calling. Could bypass Modal for reasoning if using those
   models. But LFM's tool calling is the differentiator — keep it as primary.

6. **Approval UX** — Telegram inline keyboards for exec approval. Need to
   design the flow: what info to show, timeout behavior, default-deny.
