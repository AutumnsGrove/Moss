import { describe, it, expect } from "vitest";
import { summarizeToolResult } from "../../src/agent/progress";

describe("summarizeToolResult", () => {
  it("returns error message on failure", () => {
    const result = summarizeToolResult("github_issues_list", {
      success: false,
      error: "API rate limited",
    });
    expect(result).toBe("API rate limited");
  });

  it("returns 'failed' when no error message on failure", () => {
    const result = summarizeToolResult("github_issues_list", {
      success: false,
    });
    expect(result).toBe("failed");
  });

  it("returns array count for list results", () => {
    const result = summarizeToolResult("github_issues_list", {
      success: true,
      data: [1, 2, 3, 4, 5],
    });
    expect(result).toBe("5 items");
  });

  it("returns singular for single item", () => {
    const result = summarizeToolResult("task_list", {
      success: true,
      data: [{ title: "test" }],
    });
    expect(result).toBe("1 item");
  });

  it("returns 'done' for null data", () => {
    const result = summarizeToolResult("task_complete", {
      success: true,
      data: null,
    });
    expect(result).toBe("done");
  });

  it("returns 'done' for undefined data", () => {
    const result = summarizeToolResult("task_complete", {
      success: true,
    });
    expect(result).toBe("done");
  });

  it("extracts message from object data", () => {
    const result = summarizeToolResult("task_create", {
      success: true,
      data: { message: "Task created successfully" },
    });
    expect(result).toBe("Task created successfully");
  });

  it("extracts title from object data", () => {
    const result = summarizeToolResult("github_issue_get", {
      success: true,
      data: { title: "Fix auth bug" },
    });
    expect(result).toBe("Fix auth bug");
  });

  it("truncates long string data", () => {
    const longStr = "a".repeat(100);
    const result = summarizeToolResult("memory_search", {
      success: true,
      data: longStr,
    });
    expect(result).toHaveLength(60);
    expect(result).toMatch(/\.\.\.$/);
  });

  it("returns short string data as-is", () => {
    const result = summarizeToolResult("grove_status", {
      success: true,
      data: "all healthy",
    });
    expect(result).toBe("all healthy");
  });
});
