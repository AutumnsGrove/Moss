import { describe, it, expect, vi, beforeEach } from "vitest";
import { getModalConfig, ModalError } from "../../src/shared/modal";

describe("getModalConfig", () => {
  it("builds config from env bindings", () => {
    const config = getModalConfig({
      MODAL_ENDPOINT_URL: "https://workspace--moss-inference.modal.run",
      MODAL_AUTH_KEY: "key-123",
      MODAL_AUTH_SECRET: "secret-456",
    });

    expect(config.endpointUrl).toBe(
      "https://workspace--moss-inference.modal.run"
    );
    expect(config.authKey).toBe("key-123");
    expect(config.authSecret).toBe("secret-456");
  });
});

describe("ModalError", () => {
  it("includes status and endpoint", () => {
    const error = new ModalError("test error", 503, "/triage");
    expect(error.message).toBe("test error");
    expect(error.status).toBe(503);
    expect(error.endpoint).toBe("/triage");
    expect(error.name).toBe("ModalError");
  });
});
