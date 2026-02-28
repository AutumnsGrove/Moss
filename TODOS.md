# Moss — TODOs

## Phase 1: Foundation (Cloudflare + Telegram)

- [ ] Initialize pnpm project with TypeScript config
- [ ] Create wrangler.toml with D1, KV, Queue, and Cron bindings
- [ ] Provision D1 database (`moss-db`) and run initial schema migration
- [ ] Provision KV namespace (`moss-kv`)
- [ ] Build `moss-gateway` worker: Telegram webhook verification, sender allowlist check, basic routing
- [ ] Register Telegram bot (`@GroveMossBot`) and configure webhook URL
- [ ] Get basic echo working: message in Telegram -> gateway -> response back

## Phase 2: LLM Layer (Two-Tier Model Stack)

- [ ] Build OpenRouter HTTP client with ZDR header (`X-No-Data-Logging: true`) baked in at client level
- [ ] Implement Tier 1 router: LFM2-24B-A2B for intent classification and routing
- [ ] Define routing decision schema (intent, complexity, tools_needed, route_to, confidence)
- [ ] Implement Tier 2 execution: model selection based on complexity (MiniMax M2.5, Claude Sonnet, Kimi K2.5)
- [ ] Build `moss-agent` worker: receives routed messages, calls LLM, returns response
- [ ] Wire gateway -> agent flow (direct invoke for simple, queue for complex)

## Phase 3: Task Management + Reminders

- [ ] Implement `task_create`, `task_list`, `task_complete` tools in agent worker
- [ ] Build `moss-scheduler` worker: cron-triggered, queries D1 for due reminders
- [ ] Configure Cron Triggers (9am daily digest, 15-min checks during waking hours)
- [ ] Wire scheduler -> Telegram Bot API for outbound reminder messages
- [ ] Natural language task parsing (extract due dates, priorities, reminder times from freeform text)

## Phase 4: Memory System

- [ ] Implement Core Blocks: KV storage at `moss:core-blocks`, inject into every system prompt
- [ ] Seed initial Core Blocks document (from spec template)
- [ ] Build `moss-memory-writer` worker: async queue consumer, reads conversation transcripts
- [ ] Implement episodic memory: LFM extracts conversation summaries -> D1 `moss_episodes`
- [ ] Implement fact extraction: LFM extracts facts -> D1 `moss_facts`
- [ ] Provision Vectorize index for semantic fact/episode search
- [ ] Implement confirmation gate for inferred facts (ask before storing)
- [ ] Wire memory retrieval into conversation start (last 5 episodes + semantic search)

## Phase 5: Tool Registry + GitHub Integration

- [ ] Build tool registry (KV at `moss:tools`)
- [ ] Implement tool dispatcher in agent worker
- [ ] Build GitHub tools: `github_issues_list`, `github_issue_get`, `github_pr_list`, `github_pr_status`
- [ ] Build `github_issue_comment` (write op, requires confirmation)
- [ ] Implement `memory_search` and `memory_forget` tools
- [ ] Build `grove_status` tool (ping Grove health endpoints)
- [ ] Implement tool safety rules (read = immediate, write = confirm first, destructive = always confirm)

## Phase 6: Skill System

- [ ] Build TOML skill manifest parser
- [ ] Build `scripts/compile-skills.py` to compile manifests into KV registry
- [ ] Build MCP client module in agent worker
- [ ] Implement skill safety enforcement (max_calls, timeout, cost class, memory_write guard)
- [ ] Implement `<external_content>` tagging for all skill responses
- [ ] Write first skill manifest: `web-search` (Tavily MCP)
- [ ] Wire skill enable/disable via Telegram ("disable web search for now")

## Phase 7: Security + Hardening

- [ ] Implement Threshold rate limiting via Lattice SDK in gateway
- [ ] Set up daily OpenRouter call cap (hard limit)
- [ ] Implement `moss_errors` table logging (internal only, never exposed to Telegram)
- [ ] Add `<external_content>` wrapping for all GitHub issue/PR bodies
- [ ] Test owner-only enforcement (unknown sender = silent drop)
- [ ] Audit all error paths for credential leakage

## Pre-Deploy Checklist

- [ ] Write actual Core Blocks seed document
- [ ] Verify OpenRouter ZDR is active on account (openrouter.ai/settings)
- [ ] Configure GitHub PAT (read-only) and store in CF Secrets
- [ ] Configure GitHub PAT (write, for issue comments) separately in CF Secrets
- [ ] Set Telegram bot webhook secret in CF Secrets
- [ ] Set Heartwood service token in CF Secrets
- [ ] Set reminder time window in Core Blocks
- [ ] End-to-end test: Telegram message -> triage -> agent -> response
