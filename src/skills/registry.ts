/**
 * Skill registry management.
 * Skills are stored in KV at moss:skills as a compiled JSON registry.
 */

import type { SkillRegistry, SkillRegistryEntry } from "../shared/types";
import { safeJsonParse } from "../shared/utils";

const SKILLS_KEY = "moss:skills";
const SKILL_ENABLED_PREFIX = "moss:skills:";

/**
 * Load the skill registry from KV.
 */
export async function loadSkillRegistry(
  kv: KVNamespace
): Promise<SkillRegistry> {
  const raw = await kv.get(SKILLS_KEY);
  if (!raw) return {};

  return safeJsonParse<SkillRegistry>(raw) ?? {};
}

/**
 * Get a specific skill from the registry, respecting the enabled flag.
 */
export async function getSkill(
  kv: KVNamespace,
  skillName: string
): Promise<SkillRegistryEntry | null> {
  const registry = await loadSkillRegistry(kv);
  const skill = registry[skillName];
  if (!skill) return null;

  // Check for runtime enable/disable override in KV
  const enabledOverride = await kv.get(
    `${SKILL_ENABLED_PREFIX}${skillName}:enabled`
  );
  if (enabledOverride !== null) {
    skill.enabled = enabledOverride === "true";
  }

  return skill.enabled ? skill : null;
}

/**
 * Toggle a skill's enabled state at runtime (via KV, no redeploy needed).
 */
export async function toggleSkill(
  kv: KVNamespace,
  skillName: string,
  enabled: boolean
): Promise<boolean> {
  const registry = await loadSkillRegistry(kv);
  if (!registry[skillName]) return false;

  await kv.put(
    `${SKILL_ENABLED_PREFIX}${skillName}:enabled`,
    String(enabled)
  );

  return true;
}

/**
 * Find skills whose trigger keywords or intents match a user message.
 */
export async function findMatchingSkills(
  kv: KVNamespace,
  message: string,
  intent?: string
): Promise<SkillRegistryEntry[]> {
  const registry = await loadSkillRegistry(kv);
  const messageLower = message.toLowerCase();

  const matches: SkillRegistryEntry[] = [];

  for (const skill of Object.values(registry)) {
    if (!skill.enabled) continue;

    // Check keyword match
    const keywordMatch = skill.trigger.keywords.some((kw) =>
      messageLower.includes(kw.toLowerCase())
    );

    // Check intent match
    const intentMatch =
      intent !== undefined &&
      skill.trigger.intents.includes(intent);

    if (keywordMatch || intentMatch) {
      matches.push(skill);
    }
  }

  return matches;
}
