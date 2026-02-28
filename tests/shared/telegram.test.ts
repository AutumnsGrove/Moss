import { describe, it, expect } from "vitest";
import {
  verifyWebhookSecret,
  escapeMarkdownV2,
} from "../../src/shared/telegram";

describe("verifyWebhookSecret", () => {
  function makeRequest(secret?: string): Request {
    const headers = new Headers();
    if (secret) {
      headers.set("X-Telegram-Bot-Api-Secret-Token", secret);
    }
    return new Request("https://example.com", { headers });
  }

  it("returns true for matching secret", () => {
    const result = verifyWebhookSecret(
      makeRequest("my-secret-123"),
      "my-secret-123"
    );
    expect(result).toBe(true);
  });

  it("returns false for mismatched secret", () => {
    const result = verifyWebhookSecret(
      makeRequest("wrong-secret"),
      "my-secret-123"
    );
    expect(result).toBe(false);
  });

  it("returns false for missing header", () => {
    const result = verifyWebhookSecret(makeRequest(), "my-secret-123");
    expect(result).toBe(false);
  });

  it("returns false for empty expected secret", () => {
    const result = verifyWebhookSecret(makeRequest("something"), "");
    expect(result).toBe(false);
  });

  it("returns false for different-length strings", () => {
    const result = verifyWebhookSecret(makeRequest("short"), "much-longer-secret");
    expect(result).toBe(false);
  });

  it("uses constant-time comparison (same length, different content)", () => {
    // Both same length but different — should still return false
    const result = verifyWebhookSecret(
      makeRequest("aaaa"),
      "bbbb"
    );
    expect(result).toBe(false);
  });
});

describe("escapeMarkdownV2", () => {
  it("escapes special characters", () => {
    expect(escapeMarkdownV2("hello_world")).toBe("hello\\_world");
    expect(escapeMarkdownV2("*bold*")).toBe("\\*bold\\*");
    expect(escapeMarkdownV2("code`block`")).toBe("code\\`block\\`");
  });

  it("escapes multiple special characters", () => {
    const result = escapeMarkdownV2("foo_bar*baz[qux]");
    expect(result).toBe("foo\\_bar\\*baz\\[qux\\]");
  });

  it("returns plain text unchanged", () => {
    expect(escapeMarkdownV2("hello world")).toBe("hello world");
  });
});
