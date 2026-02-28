import { describe, it, expect } from "vitest";
import { validateWebhook } from "../../src/gateway/webhook";

function makeRequest(
  method: string,
  body?: unknown,
  secret?: string
): Request {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (secret) {
    headers.set("X-Telegram-Bot-Api-Secret-Token", secret);
  }

  return new Request("https://moss.grove.place/telegram", {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
}

const VALID_UPDATE = {
  update_id: 12345,
  message: {
    message_id: 1,
    from: { id: 123, is_bot: false, first_name: "Autumn" },
    chat: { id: 123, type: "private" },
    date: 1700000000,
    text: "hello",
  },
};

describe("validateWebhook", () => {
  it("accepts a valid webhook with correct secret", async () => {
    const req = makeRequest("POST", VALID_UPDATE, "test-secret");
    const result = await validateWebhook(req, "test-secret");
    expect(result.valid).toBe(true);
    expect(result.update).toBeDefined();
    expect(result.update!.update_id).toBe(12345);
  });

  it("rejects non-POST requests", async () => {
    const req = new Request("https://moss.grove.place/telegram", {
      method: "GET",
      headers: new Headers({
        "X-Telegram-Bot-Api-Secret-Token": "test-secret",
      }),
    });
    const result = await validateWebhook(req, "test-secret");
    expect(result.valid).toBe(false);
    expect(result.error).toBe("method_not_allowed");
  });

  it("rejects invalid webhook secret", async () => {
    const req = makeRequest("POST", VALID_UPDATE, "wrong-secret");
    const result = await validateWebhook(req, "test-secret");
    expect(result.valid).toBe(false);
    expect(result.error).toBe("invalid_secret");
  });

  it("rejects invalid JSON body", async () => {
    const headers = new Headers({
      "Content-Type": "application/json",
      "X-Telegram-Bot-Api-Secret-Token": "test-secret",
    });
    const req = new Request("https://moss.grove.place/telegram", {
      method: "POST",
      headers,
      body: "not json",
    });
    const result = await validateWebhook(req, "test-secret");
    expect(result.valid).toBe(false);
    expect(result.error).toBe("invalid_body");
  });
});
