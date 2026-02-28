import { describe, it, expect } from "vitest";
import { routeUpdate } from "../../src/gateway/router";
import type { TelegramUpdate } from "../../src/shared/types";

const OWNER_ID = "12345";

function makeUpdate(overrides: Partial<TelegramUpdate["message"]> = {}): TelegramUpdate {
  return {
    update_id: 1,
    message: {
      message_id: 1,
      from: { id: 12345, is_bot: false, first_name: "Autumn" },
      chat: { id: 12345, type: "private" as const },
      date: 1700000000,
      text: "hello",
      ...overrides,
    },
  };
}

describe("routeUpdate", () => {
  it("queues valid messages from the owner", () => {
    const decision = routeUpdate(makeUpdate(), OWNER_ID);
    expect(decision.action).toBe("queue");
    expect(decision.chatId).toBe(12345);
    expect(decision.text).toBe("hello");
    expect(decision.messageId).toBe(1);
  });

  it("drops messages from non-owner (silent drop)", () => {
    const update = makeUpdate({
      from: { id: 99999, is_bot: false, first_name: "Stranger" },
    });
    const decision = routeUpdate(update, OWNER_ID);
    expect(decision.action).toBe("drop");
  });

  it("drops updates without text", () => {
    const update = makeUpdate({ text: undefined });
    const decision = routeUpdate(update, OWNER_ID);
    expect(decision.action).toBe("drop");
  });

  it("drops updates without from field", () => {
    const update = makeUpdate({ from: undefined });
    const decision = routeUpdate(update, OWNER_ID);
    expect(decision.action).toBe("drop");
  });

  it("drops updates with no message at all", () => {
    const update: TelegramUpdate = { update_id: 1 };
    const decision = routeUpdate(update, OWNER_ID);
    expect(decision.action).toBe("drop");
  });

  it("truncates excessively long messages", () => {
    const longText = "a".repeat(5000);
    const decision = routeUpdate(makeUpdate({ text: longText }), OWNER_ID);
    expect(decision.action).toBe("queue");
    expect(decision.text!.length).toBe(4000);
  });
});
