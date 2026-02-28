import { describe, it, expect } from "vitest";
import {
  parseSkillManifest,
  compileSkillRegistry,
} from "../../src/skills/parser";

const VALID_TOML = `
[skill]
name        = "web-search"
description = "Search the web for current information via Tavily"
version     = "1.0.0"
author      = "autumnsgrove"

[trigger]
keywords    = ["search", "look up", "find"]
intents     = ["web_search", "research"]

[integration]
type        = "mcp"
server_url  = "https://mcp.tavily.com/mcp/?tavilyApiKey={{TAVILY_API_KEY}}"
tools       = ["tavily_search", "tavily_extract"]

[permissions]
network      = true
memory_write = false
cost_class   = "low"

[limits]
max_calls_per_conversation = 5
timeout_ms  = 8000
`;

describe("parseSkillManifest", () => {
  it("parses a valid TOML manifest", () => {
    const manifest = parseSkillManifest(VALID_TOML);
    expect(manifest.skill.name).toBe("web-search");
    expect(manifest.skill.description).toContain("Tavily");
    expect(manifest.trigger.keywords).toContain("search");
    expect(manifest.integration.type).toBe("mcp");
    expect(manifest.integration.server_url).toContain("{{TAVILY_API_KEY}}");
    expect(manifest.permissions.network).toBe(true);
    expect(manifest.permissions.memory_write).toBe(false);
    expect(manifest.limits.max_calls_per_conversation).toBe(5);
    expect(manifest.limits.timeout_ms).toBe(8000);
  });

  it("applies defaults for missing optional fields", () => {
    const minimal = `
[skill]
name = "test"
description = "A test skill"

[integration]
type = "adapter"
`;
    const manifest = parseSkillManifest(minimal);
    expect(manifest.skill.version).toBe("1.0.0");
    expect(manifest.skill.author).toBe("unknown");
    expect(manifest.trigger.keywords).toEqual([]);
    expect(manifest.trigger.intents).toEqual([]);
    expect(manifest.permissions.network).toBe(false);
    expect(manifest.permissions.memory_write).toBe(false);
    expect(manifest.permissions.cost_class).toBe("low");
    expect(manifest.limits.max_calls_per_conversation).toBe(5);
    expect(manifest.limits.timeout_ms).toBe(8000);
  });

  it("throws on missing skill.name", () => {
    const bad = `
[skill]
description = "No name"
[integration]
type = "mcp"
`;
    expect(() => parseSkillManifest(bad)).toThrow("skill.name");
  });

  it("throws on missing integration.type", () => {
    const bad = `
[skill]
name = "test"
description = "Missing integration"
`;
    expect(() => parseSkillManifest(bad)).toThrow("integration.type");
  });
});

describe("compileSkillRegistry", () => {
  it("compiles manifests into a keyed registry", () => {
    const manifest = parseSkillManifest(VALID_TOML);
    const registry = compileSkillRegistry([manifest]);

    expect(registry["web-search"]).toBeDefined();
    expect(registry["web-search"].enabled).toBe(true);
    expect(registry["web-search"].skill.name).toBe("web-search");
  });

  it("handles multiple manifests", () => {
    const m1 = parseSkillManifest(VALID_TOML);
    const m2 = parseSkillManifest(`
[skill]
name = "calendar"
description = "Google Calendar"
[integration]
type = "mcp"
`);

    const registry = compileSkillRegistry([m1, m2]);
    expect(Object.keys(registry)).toEqual(["web-search", "calendar"]);
  });

  it("returns empty registry for no manifests", () => {
    const registry = compileSkillRegistry([]);
    expect(Object.keys(registry)).toHaveLength(0);
  });
});
