# Moss — TODOs

## Pre-Deploy Checklist

- [ ] Provision D1 database (`moss-db`) on Cloudflare and update `database_id` in wrangler.toml
- [ ] Provision KV namespace (`moss-kv`) on Cloudflare and update `id` in wrangler.toml
- [ ] Provision Queue (`moss-queue`) on Cloudflare
- [ ] Register Telegram bot (`@GroveMossBot`) and configure webhook URL
- [ ] Write actual Core Blocks seed document and upload to KV (`moss:core-blocks`)
- [ ] Verify OpenRouter ZDR is active on account (openrouter.ai/settings)
- [ ] Configure GitHub PAT (read-only) and store in CF Secrets
- [ ] Configure GitHub PAT (write, for issue comments) separately in CF Secrets
- [ ] Set Telegram bot webhook secret in CF Secrets (`TELEGRAM_WEBHOOK_SECRET`)
- [ ] Set Heartwood service token in CF Secrets (`HEARTWOOD_SERVICE_TOKEN`)
- [ ] Set `OWNER_TELEGRAM_ID` in CF Secrets
- [ ] Set `OPENROUTER_API_KEY` in CF Secrets
- [ ] Run D1 schema migration: `pnpm schema:remote`
- [ ] Deploy: `pnpm deploy`
- [ ] End-to-end test: Telegram message -> triage -> agent -> response

## Future Enhancements

- [ ] Provision Vectorize index for semantic fact/episode search (replaces keyword LIKE search)
- [ ] Implement Core Block update proposals via Telegram (confirmation gate for core_block_updates)
- [ ] Natural language date parsing for task creation (extract due dates from freeform text)
- [ ] Replace KV rate limiting with Threshold via Lattice SDK
- [ ] Add Heartwood auth validation (currently trusts OWNER_TELEGRAM_ID check only)
- [ ] Write `web-research` skill manifest (Exa MCP)
- [ ] Write `calendar` skill manifest (Google Calendar MCP)
- [ ] Write `rss-digest` adapter skill
- [ ] Voice note processing via Telegram voice messages (LFM2.5-Audio)
