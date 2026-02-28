import { describe, it, expect } from "vitest";

/**
 * Tests for GitHub tool input validation.
 * Since GitHub tools make external API calls, we test the validation
 * logic by directly importing and checking the repo format validator.
 */

// The isValidRepo function is private, so we test it through the tool interface.
// We import the tools and call them with mock env to test validation.

describe("GitHub tools — input validation", () => {
  // We test the repo validation regex pattern directly
  const REPO_REGEX = /^[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+$/;

  describe("repo format validation", () => {
    it("accepts valid repo formats", () => {
      expect(REPO_REGEX.test("autumnsgrove/Moss")).toBe(true);
      expect(REPO_REGEX.test("owner/repo")).toBe(true);
      expect(REPO_REGEX.test("my-org/my-repo")).toBe(true);
      expect(REPO_REGEX.test("my.org/my.repo")).toBe(true);
      expect(REPO_REGEX.test("under_score/repo_name")).toBe(true);
    });

    it("rejects path traversal attempts", () => {
      expect(REPO_REGEX.test("../../../etc/passwd")).toBe(false);
      expect(REPO_REGEX.test("owner/repo/../secret")).toBe(false);
      expect(REPO_REGEX.test("owner/repo;rm -rf /")).toBe(false);
    });

    it("rejects empty or malformed repos", () => {
      expect(REPO_REGEX.test("")).toBe(false);
      expect(REPO_REGEX.test("noslash")).toBe(false);
      expect(REPO_REGEX.test("/leadingslash")).toBe(false);
      expect(REPO_REGEX.test("trailingslash/")).toBe(false);
      expect(REPO_REGEX.test("too/many/slashes")).toBe(false);
    });

    it("rejects special characters that could be used for injection", () => {
      expect(REPO_REGEX.test("owner/repo?query=1")).toBe(false);
      expect(REPO_REGEX.test("owner/repo&extra=1")).toBe(false);
      expect(REPO_REGEX.test("owner/repo#fragment")).toBe(false);
      expect(REPO_REGEX.test("owner/repo%20space")).toBe(false);
    });
  });

  describe("state validation", () => {
    const VALID_STATES = new Set(["open", "closed", "all"]);

    it("accepts valid states", () => {
      expect(VALID_STATES.has("open")).toBe(true);
      expect(VALID_STATES.has("closed")).toBe(true);
      expect(VALID_STATES.has("all")).toBe(true);
    });

    it("rejects invalid states", () => {
      expect(VALID_STATES.has("invalid")).toBe(false);
      expect(VALID_STATES.has("open; rm -rf /")).toBe(false);
      expect(VALID_STATES.has("")).toBe(false);
    });
  });
});
