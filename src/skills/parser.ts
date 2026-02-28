/**
 * TOML skill manifest parser.
 * Skills are data, not code — each is a typed TOML manifest declaring
 * what it does, what integration it calls, and what permissions it needs.
 */

import type { SkillManifest, SkillRegistryEntry, SkillRegistry } from "../shared/types";

// Using the `toml` package for parsing
import TOML from "toml";

/**
 * Parse a single TOML skill manifest string into a SkillManifest.
 */
export function parseSkillManifest(tomlContent: string): SkillManifest {
  const parsed = TOML.parse(tomlContent);

  // Validate required fields
  if (!parsed.skill?.name) throw new Error("Skill manifest missing skill.name");
  if (!parsed.skill?.description) throw new Error("Skill manifest missing skill.description");
  if (!parsed.integration?.type) throw new Error("Skill manifest missing integration.type");

  return {
    skill: {
      name: parsed.skill.name,
      description: parsed.skill.description,
      version: parsed.skill.version ?? "1.0.0",
      author: parsed.skill.author ?? "unknown",
    },
    trigger: {
      keywords: parsed.trigger?.keywords ?? [],
      intents: parsed.trigger?.intents ?? [],
    },
    integration: {
      type: parsed.integration.type,
      server_url: parsed.integration.server_url,
      tools: parsed.integration.tools,
      adapter_worker: parsed.integration.adapter_worker,
    },
    permissions: {
      network: parsed.permissions?.network ?? false,
      memory_write: parsed.permissions?.memory_write ?? false,
      cost_class: parsed.permissions?.cost_class ?? "low",
    },
    limits: {
      max_calls_per_conversation: parsed.limits?.max_calls_per_conversation ?? 5,
      timeout_ms: parsed.limits?.timeout_ms ?? 8000,
    },
  };
}

/**
 * Compile multiple skill manifests into a registry for KV storage.
 */
export function compileSkillRegistry(
  manifests: SkillManifest[]
): SkillRegistry {
  const registry: SkillRegistry = {};

  for (const manifest of manifests) {
    const entry: SkillRegistryEntry = {
      ...manifest,
      enabled: true,
    };
    registry[manifest.skill.name] = entry;
  }

  return registry;
}
