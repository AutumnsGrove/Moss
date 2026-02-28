import { describe, it, expect } from "vitest";
import { selectExecutionModel, Models } from "../../src/shared/openrouter";

describe("selectExecutionModel", () => {
  it("selects Claude Sonnet for complex tasks", () => {
    expect(selectExecutionModel("complex")).toBe(Models.CLAUDE_SONNET);
  });

  it("selects Claude Sonnet for GitHub intent", () => {
    expect(selectExecutionModel("moderate", "github")).toBe(
      Models.CLAUDE_SONNET
    );
  });

  it("selects MiniMax for moderate tasks", () => {
    expect(selectExecutionModel("moderate")).toBe(Models.MINIMAX);
  });

  it("selects MiniMax for simple tasks needing Tier 2", () => {
    expect(selectExecutionModel("simple")).toBe(Models.MINIMAX);
  });
});

describe("Models", () => {
  it("defines all expected models", () => {
    expect(Models.TRIAGE).toBe("liquid/lfm2-24b-a2b");
    expect(Models.CLAUDE_SONNET).toBe("anthropic/claude-sonnet-4-6");
    expect(Models.MINIMAX).toBe("minimax/minimax-m2.5");
    expect(Models.KIMI).toBe("moonshotai/kimi-k2.5");
  });
});
