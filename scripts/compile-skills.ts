/**
 * Compile TOML skill manifests into a JSON registry for KV storage.
 *
 * Usage: pnpm compile-skills
 * Output: Prints compiled JSON to stdout (pipe to wrangler kv:put)
 *
 * Example:
 *   pnpm compile-skills > /tmp/skills.json
 *   wrangler kv:put moss:skills --path /tmp/skills.json --binding KV
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import TOML from "toml";

const SKILLS_DIR = join(import.meta.dirname ?? ".", "..", "skills");

interface SkillManifest {
  skill: { name: string; description: string; version: string; author: string };
  trigger: { keywords: string[]; intents: string[] };
  integration: {
    type: string;
    server_url?: string;
    tools?: string[];
    adapter_worker?: string;
  };
  permissions: { network: boolean; memory_write: boolean; cost_class: string };
  limits: { max_calls_per_conversation: number; timeout_ms: number };
}

function main(): void {
  const files = readdirSync(SKILLS_DIR).filter((f) => f.endsWith(".toml"));

  if (files.length === 0) {
    console.error("No skill manifests found in skills/");
    process.exit(1);
  }

  const registry: Record<string, SkillManifest & { enabled: boolean }> = {};

  for (const file of files) {
    const content = readFileSync(join(SKILLS_DIR, file), "utf-8");
    const parsed = TOML.parse(content) as SkillManifest;

    if (!parsed.skill?.name) {
      console.error(`Skipping ${file}: missing skill.name`);
      continue;
    }

    registry[parsed.skill.name] = {
      ...parsed,
      enabled: true,
    };

    console.error(`Compiled: ${parsed.skill.name} (${file})`);
  }

  // Output the registry as JSON
  console.log(JSON.stringify(registry, null, 2));
}

main();
