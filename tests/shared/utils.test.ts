import { describe, it, expect } from "vitest";
import {
  generateId,
  now,
  truncate,
  safeJsonParse,
  wrapExternalContent,
  formatTimestamp,
  parseTags,
} from "../../src/shared/utils";

describe("generateId", () => {
  it("returns a valid UUID", () => {
    const id = generateId();
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
  });

  it("returns unique IDs", () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateId()));
    expect(ids.size).toBe(100);
  });
});

describe("now", () => {
  it("returns a unix timestamp in seconds", () => {
    const ts = now();
    expect(ts).toBeGreaterThan(1700000000);
    expect(ts).toBeLessThan(2000000000);
  });
});

describe("truncate", () => {
  it("returns short text unchanged", () => {
    expect(truncate("hello", 10)).toBe("hello");
  });

  it("truncates long text with ellipsis", () => {
    const result = truncate("hello world", 6);
    expect(result).toBe("hello…");
    expect(result.length).toBe(6);
  });

  it("handles exact length", () => {
    expect(truncate("hello", 5)).toBe("hello");
  });
});

describe("safeJsonParse", () => {
  it("parses valid JSON", () => {
    expect(safeJsonParse<{ a: number }>('{"a": 1}')).toEqual({ a: 1 });
  });

  it("returns null for invalid JSON", () => {
    expect(safeJsonParse("not json")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(safeJsonParse("")).toBeNull();
  });

  it("parses arrays", () => {
    expect(safeJsonParse<string[]>('["a","b"]')).toEqual(["a", "b"]);
  });
});

describe("wrapExternalContent", () => {
  it("wraps content with source tags", () => {
    const result = wrapExternalContent("hello", "github");
    expect(result).toBe(
      '<external_content source="github">\nhello\n</external_content>'
    );
  });

  it("preserves newlines in content", () => {
    const result = wrapExternalContent("line1\nline2", "skill:web-search");
    expect(result).toContain("line1\nline2");
    expect(result).toContain('source="skill:web-search"');
  });
});

describe("formatTimestamp", () => {
  it("formats a unix timestamp as human-readable", () => {
    // Feb 28, 2026 at 12:00 UTC = 7:00 AM ET
    const ts = 1772222400;
    const result = formatTimestamp(ts);
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });
});

describe("parseTags", () => {
  it("parses a JSON array of tags", () => {
    expect(parseTags('["work","urgent"]')).toEqual(["work", "urgent"]);
  });

  it("returns empty array for null", () => {
    expect(parseTags(null)).toEqual([]);
  });

  it("returns empty array for invalid JSON", () => {
    expect(parseTags("not json")).toEqual([]);
  });

  it("returns empty array for empty string", () => {
    expect(parseTags("")).toEqual([]);
  });
});
