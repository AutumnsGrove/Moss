import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  setConversationalModel,
  getCurrentModelDisplay,
} from "../../src/shared/providers";

describe("setConversationalModel", () => {
  const mockKV = {
    get: vi.fn(),
    put: vi.fn(),
  } as unknown as KVNamespace;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("accepts 'minimax' alias", async () => {
    const result = await setConversationalModel(mockKV, "minimax");
    expect(result).not.toBeNull();
    expect(result!.display).toBe("MiniMax M2.5");
    expect(mockKV.put).toHaveBeenCalled();
  });

  it("accepts 'claude' alias", async () => {
    const result = await setConversationalModel(mockKV, "claude");
    expect(result).not.toBeNull();
    expect(result!.display).toBe("Claude Sonnet");
  });

  it("accepts 'kimi' alias", async () => {
    const result = await setConversationalModel(mockKV, "kimi");
    expect(result).not.toBeNull();
    expect(result!.display).toBe("Kimi K2.5");
  });

  it("rejects unknown model aliases", async () => {
    const result = await setConversationalModel(mockKV, "gpt4");
    expect(result).toBeNull();
    expect(mockKV.put).not.toHaveBeenCalled();
  });

  it("normalizes case and whitespace", async () => {
    const result = await setConversationalModel(mockKV, "  Claude  ");
    expect(result).not.toBeNull();
    expect(result!.display).toBe("Claude Sonnet");
  });

  it("rejects empty string", async () => {
    const result = await setConversationalModel(mockKV, "");
    expect(result).toBeNull();
  });
});

describe("getCurrentModelDisplay", () => {
  it("returns MiniMax M2.5 when no preference is stored", async () => {
    const mockKV = {
      get: vi.fn().mockResolvedValue(null),
    } as unknown as KVNamespace;

    const display = await getCurrentModelDisplay(mockKV);
    expect(display).toBe("MiniMax M2.5");
  });

  it("returns stored model display name", async () => {
    const mockKV = {
      get: vi.fn().mockResolvedValue("moonshotai/kimi-k2.5"),
    } as unknown as KVNamespace;

    const display = await getCurrentModelDisplay(mockKV);
    expect(display).toBe("Kimi K2.5");
  });
});
