import { describe, it, expect } from "vitest";
import {
  getToolNames,
  getToolDefinitionsForLLM,
} from "../../../src/agent/tools/index";

describe("getToolNames", () => {
  it("returns all registered tool names", () => {
    const names = getToolNames();
    expect(names).toContain("github_issues_list");
    expect(names).toContain("github_issue_get");
    expect(names).toContain("github_issue_comment");
    expect(names).toContain("github_pr_list");
    expect(names).toContain("github_pr_status");
    expect(names).toContain("task_create");
    expect(names).toContain("task_list");
    expect(names).toContain("task_complete");
    expect(names).toContain("reminder_set");
    expect(names).toContain("memory_search");
    expect(names).toContain("memory_forget");
    expect(names).toContain("grove_status");
    expect(names.length).toBe(12);
  });
});

describe("getToolDefinitionsForLLM", () => {
  it("returns all definitions when no specific tools requested", () => {
    const defs = getToolDefinitionsForLLM([]);
    expect(defs.length).toBe(12);
  });

  it("filters to requested tools", () => {
    const defs = getToolDefinitionsForLLM(["github_issues_list", "task_list"]);
    expect(defs.length).toBe(2);
    expect(defs[0].function.name).toBe("github_issues_list");
    expect(defs[1].function.name).toBe("task_list");
  });

  it("skips unknown tool names", () => {
    const defs = getToolDefinitionsForLLM(["github_issues_list", "nonexistent_tool"]);
    expect(defs.length).toBe(1);
    expect(defs[0].function.name).toBe("github_issues_list");
  });
});
