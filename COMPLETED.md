# Moss — Completed Tasks

## Phase 0: Project Scaffolding

- [x] Write Moss architecture and design specification (`docs/Moss-Spec.md`)
- [x] Decide on Heartwood service token scope (read-only identity verification)
- [x] Decide on GitHub PAT strategy (one read-only PAT for v1, separate write PAT for comments)
- [x] Choose Telegram bot name (`@GroveMossBot`)
- [x] Define reminder time window approach (owner-managed in Core Blocks, not hardcoded)
- [x] Set up project scaffolding (directory structure, AGENT.md, README, TODOs)
- [x] Remove BaseProject template artifacts

## Phase 1: Foundation (Cloudflare + Telegram)

- [x] Initialize pnpm project with TypeScript config (`package.json`, `tsconfig.json`)
- [x] Create wrangler.toml with D1, KV, Queue, and Cron bindings
- [x] Write D1 schema migration (`scripts/schema.sql`) with all 5 tables + indexes
- [x] Build `moss-gateway` worker: Telegram webhook verification, sender allowlist, routing
- [x] Implement KV-based rate limiting (60 msg/hr, auto-expiring, Threshold replacement ready)
- [x] Wire gateway -> agent flow via Cloudflare Queues

## Phase 2: LLM Layer (Two-Tier Model Stack)

- [x] Build OpenRouter HTTP client with ZDR header (`X-No-Data-Logging: true`) baked in
- [x] Implement Tier 1 router: LFM2-24B-A2B for intent classification and routing
- [x] Define routing decision schema (intent, complexity, tools_needed, route_to, confidence)
- [x] Implement Tier 2 execution: model selection (Claude Sonnet, MiniMax M2.5, Kimi K2.5)
- [x] Build `moss-agent` worker: triage -> execute -> tool loop -> respond
- [x] Implement daily OpenRouter call cap (200/day, KV-tracked, hard limit)

## Phase 3: Task Management + Reminders

- [x] Implement `task_create`, `task_list`, `task_complete`, `reminder_set` tools
- [x] Build `moss-scheduler` worker: cron-triggered with daily digest and reminder checks
- [x] Configure Cron Triggers (9am ET daily digest, 15-min checks during waking hours)
- [x] Wire scheduler -> Telegram Bot API for outbound messages (single + digest format)

## Phase 4: Memory System

- [x] Implement Core Blocks: KV storage at `moss:core-blocks`, inject into every system prompt
- [x] Build `moss-memory-writer` worker: async queue consumer
- [x] Implement episodic memory: LFM extracts conversation summaries -> D1 `moss_episodes`
- [x] Implement fact extraction: LFM extracts facts -> D1 `moss_facts`
- [x] Implement confirmation gate for inferred facts (stored with `source: 'conversation:pending_confirmation'`)
- [x] Wire memory retrieval into conversation start (last 5 episodes + recent facts)
- [x] Build `memory_search` and `memory_forget` tools

## Phase 5: Tool Registry + GitHub Integration

- [x] Build tool dispatcher with registry pattern (`src/agent/tools/index.ts`)
- [x] Build GitHub tools: `github_issues_list`, `github_issue_get`, `github_pr_list`, `github_pr_status`
- [x] Build `github_issue_comment` (write op, uses separate GITHUB_PAT_WRITE)
- [x] Build `grove_status` tool (ping Grove health endpoints with Heartwood token)
- [x] Implement tool safety (tool definitions include `requires_confirmation` flag)
- [x] Add repo format validation (path traversal prevention) on all GitHub tools
- [x] Add state parameter sanitization on GitHub tools

## Phase 6: Skill System

- [x] Build TOML skill manifest parser (`src/skills/parser.ts`)
- [x] Build `scripts/compile-skills.ts` to compile manifests into KV registry
- [x] Build MCP client module (`src/skills/mcp-client.ts`)
- [x] Implement skill safety enforcement (max_calls, timeout, tool allowlist, memory_write guard)
- [x] Implement `<external_content>` tagging for all skill responses
- [x] Write first skill manifest: `web-search` (Tavily MCP)
- [x] Implement skill registry with runtime enable/disable via KV

## Phase 7: Security + Hardening

- [x] Implement rate limiting in gateway (KV-based, 60 msg/hr)
- [x] Set up daily OpenRouter call cap (200/day hard limit)
- [x] Implement `moss_errors` table logging (internal only, never exposed to Telegram)
- [x] Add `<external_content>` wrapping for all GitHub issue/PR bodies and titles
- [x] Implement owner-only enforcement (unknown sender = silent drop, no bot existence confirmation)
- [x] Constant-time webhook secret comparison (timing attack prevention)
- [x] Input length validation on gateway (4000 char truncation)
- [x] Repo format validation (regex-based path traversal prevention)
- [x] All D1 queries use parameterized statements (zero SQL injection risk)
- [x] Generic error messages to Telegram (internal details logged to moss_errors only)
- [x] ZDR header enforced at HTTP client level on every OpenRouter call

## Testing

- [x] Write unit tests for shared utilities (utils, telegram, openrouter)
- [x] Write integration tests for gateway (webhook validation, routing)
- [x] Write validation tests for GitHub tools (repo format, state sanitization)
- [x] Write tests for skill manifest parser and registry compilation
- [x] 54 tests passing across 7 test files
