/**
 * GitHub tools — read issues, PRs, and CI status.
 * Uses GitHub REST API v3.
 *
 * Read operations use GITHUB_PAT_READ.
 * Write operations (comments) use GITHUB_PAT_WRITE — loaded separately.
 */

import type { Env } from "../../shared/env";
import type { ToolResult } from "../../shared/types";
import { wrapExternalContent, truncate } from "../../shared/utils";

const GITHUB_API = "https://api.github.com";

/** Validate repo format (owner/name) to prevent path traversal */
function isValidRepo(repo: string): boolean {
  return /^[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+$/.test(repo);
}

/** Validate state parameter to prevent query injection */
const VALID_STATES = new Set(["open", "closed", "all"]);
function sanitizeState(state: unknown): string {
  const s = String(state ?? "open");
  return VALID_STATES.has(s) ? s : "open";
}

async function githubFetch(
  path: string,
  token: string,
  method = "GET",
  body?: string
): Promise<Response> {
  return fetch(`${GITHUB_API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github.v3+json",
      "User-Agent": "Moss/1.0",
    },
    body,
  });
}

/** List open issues in a repository */
export async function issuesList(
  env: Env,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const repo = args.repo as string;
  const state = sanitizeState(args.state);
  const limit = Math.min((args.limit as number) ?? 10, 30);

  if (!repo || !isValidRepo(repo)) {
    return { success: false, error: "repo must be in owner/name format" };
  }

  const res = await githubFetch(
    `/repos/${repo}/issues?state=${state}&per_page=${limit}&sort=updated`,
    env.GITHUB_PAT_READ
  );

  if (!res.ok) {
    return { success: false, error: `GitHub API ${res.status}` };
  }

  const issues = (await res.json()) as Array<{
    number: number;
    title: string;
    state: string;
    user: { login: string };
    labels: Array<{ name: string }>;
    updated_at: string;
    pull_request?: unknown;
  }>;

  // Filter out pull requests (GitHub API returns PRs in issues endpoint)
  const filtered = issues
    .filter((i) => !i.pull_request)
    .map((i) => ({
      number: i.number,
      title: wrapExternalContent(truncate(i.title, 200), "github"),
      state: i.state,
      author: i.user.login,
      labels: i.labels.map((l) => l.name),
      updated: i.updated_at,
    }));

  return { success: true, data: filtered };
}

/** Get details of a specific issue */
export async function issueGet(
  env: Env,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const repo = args.repo as string;
  const number = args.number as number;

  if (!repo || !isValidRepo(repo) || !number) {
    return { success: false, error: "valid repo (owner/name) and number are required" };
  }

  const res = await githubFetch(
    `/repos/${repo}/issues/${number}`,
    env.GITHUB_PAT_READ
  );

  if (!res.ok) {
    return { success: false, error: `GitHub API ${res.status}` };
  }

  const issue = (await res.json()) as {
    number: number;
    title: string;
    body: string | null;
    state: string;
    user: { login: string };
    labels: Array<{ name: string }>;
    assignees: Array<{ login: string }>;
    created_at: string;
    updated_at: string;
    comments: number;
  };

  return {
    success: true,
    data: {
      number: issue.number,
      title: wrapExternalContent(issue.title, "github"),
      body: issue.body
        ? wrapExternalContent(truncate(issue.body, 2000), "github")
        : null,
      state: issue.state,
      author: issue.user.login,
      labels: issue.labels.map((l) => l.name),
      assignees: issue.assignees.map((a) => a.login),
      created: issue.created_at,
      updated: issue.updated_at,
      comment_count: issue.comments,
    },
  };
}

/** Add a comment to an issue (WRITE operation — requires confirmation in agent) */
export async function issueComment(
  env: Env,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const repo = args.repo as string;
  const number = args.number as number;
  const body = args.body as string;

  if (!repo || !isValidRepo(repo) || !number || !body) {
    return { success: false, error: "valid repo (owner/name), number, and body are required" };
  }

  const res = await githubFetch(
    `/repos/${repo}/issues/${number}/comments`,
    env.GITHUB_PAT_WRITE,
    "POST",
    JSON.stringify({ body })
  );

  if (!res.ok) {
    return { success: false, error: `GitHub API ${res.status}` };
  }

  return { success: true, data: { message: `Comment added to ${repo}#${number}` } };
}

/** List open pull requests */
export async function prList(
  env: Env,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const repo = args.repo as string;
  const state = sanitizeState(args.state);
  const limit = Math.min((args.limit as number) ?? 10, 30);

  if (!repo || !isValidRepo(repo)) {
    return { success: false, error: "repo must be in owner/name format" };
  }

  const res = await githubFetch(
    `/repos/${repo}/pulls?state=${state}&per_page=${limit}&sort=updated`,
    env.GITHUB_PAT_READ
  );

  if (!res.ok) {
    return { success: false, error: `GitHub API ${res.status}` };
  }

  const prs = (await res.json()) as Array<{
    number: number;
    title: string;
    state: string;
    user: { login: string };
    draft: boolean;
    updated_at: string;
    head: { ref: string };
    base: { ref: string };
  }>;

  return {
    success: true,
    data: prs.map((pr) => ({
      number: pr.number,
      title: wrapExternalContent(truncate(pr.title, 200), "github"),
      state: pr.state,
      author: pr.user.login,
      draft: pr.draft,
      head: pr.head.ref,
      base: pr.base.ref,
      updated: pr.updated_at,
    })),
  };
}

/** Get CI status for a pull request */
export async function prStatus(
  env: Env,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const repo = args.repo as string;
  const number = args.number as number;

  if (!repo || !isValidRepo(repo) || !number) {
    return { success: false, error: "valid repo (owner/name) and number are required" };
  }

  // Get the PR to find the head SHA
  const prRes = await githubFetch(
    `/repos/${repo}/pulls/${number}`,
    env.GITHUB_PAT_READ
  );

  if (!prRes.ok) {
    return { success: false, error: `GitHub API ${prRes.status}` };
  }

  const pr = (await prRes.json()) as {
    head: { sha: string };
    mergeable_state: string;
  };

  // Get check runs for the head commit
  const checksRes = await githubFetch(
    `/repos/${repo}/commits/${pr.head.sha}/check-runs`,
    env.GITHUB_PAT_READ
  );

  if (!checksRes.ok) {
    return { success: false, error: `GitHub API ${checksRes.status}` };
  }

  const checks = (await checksRes.json()) as {
    total_count: number;
    check_runs: Array<{
      name: string;
      status: string;
      conclusion: string | null;
    }>;
  };

  return {
    success: true,
    data: {
      mergeable_state: pr.mergeable_state,
      total_checks: checks.total_count,
      checks: checks.check_runs.map((c) => ({
        name: c.name,
        status: c.status,
        conclusion: c.conclusion,
      })),
    },
  };
}
