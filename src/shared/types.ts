// ─── Telegram Types ───

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
}

export interface TelegramMessage {
  message_id: number;
  from?: TelegramUser;
  chat: TelegramChat;
  date: number;
  text?: string;
  reply_to_message?: TelegramMessage;
}

export interface TelegramUser {
  id: number;
  is_bot: boolean;
  first_name: string;
  last_name?: string;
  username?: string;
}

export interface TelegramChat {
  id: number;
  type: "private" | "group" | "supergroup" | "channel";
  first_name?: string;
  username?: string;
}

export interface TelegramCallbackQuery {
  id: string;
  from: TelegramUser;
  message?: TelegramMessage;
  data?: string;
}

// ─── LLM Routing Types ───

export type Intent =
  | "task_create"
  | "task_query"
  | "github"
  | "memory_query"
  | "conversation"
  | "reminder_set"
  | "skill_invoke"
  | "memory_manage"
  | "grove_status";

export type Complexity = "simple" | "moderate" | "complex";

export type RouteTarget = "simple_response" | "full_agent" | "queue_async";

export interface TriageResult {
  intent: Intent;
  complexity: Complexity;
  tools_needed: string[];
  route_to: RouteTarget;
  confidence: number;
}

// ─── Memory Types ───

export interface Episode {
  id: string;
  summary: string;
  mood_signal: string | null;
  embedding_id: string | null;
  created_at: number;
  deleted_at: number | null;
}

export interface Fact {
  id: string;
  content: string;
  confidence: "confirmed" | "inferred";
  embedding_id: string | null;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
  source: string | null;
}

export interface Conversation {
  id: string;
  messages: ConversationMessage[];
  started_at: number;
  ended_at: number | null;
  processed: number;
}

export interface ConversationMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: number;
}

export interface MemoryContext {
  core_blocks: string;
  recent_episodes: Episode[];
  relevant_facts: Fact[];
}

// ─── Task Types ───

export type TaskStatus = "pending" | "snoozed" | "done" | "cancelled";
export type TaskPriority = "low" | "normal" | "high";

export interface Task {
  id: string;
  title: string;
  body: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  due_at: number | null;
  remind_at: number | null;
  created_at: number;
  updated_at: number;
  tags: string[];
  source: string;
}

// ─── Tool Types ───

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, ToolParameter>;
  requires_confirmation: boolean;
}

export interface ToolParameter {
  type: "string" | "number" | "boolean";
  description: string;
  required: boolean;
  default?: string | number | boolean;
}

export interface ToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

// ─── Skill Types ───

export interface SkillManifest {
  skill: {
    name: string;
    description: string;
    version: string;
    author: string;
  };
  trigger: {
    keywords: string[];
    intents: string[];
  };
  integration: {
    type: "mcp" | "adapter";
    server_url?: string;
    tools?: string[];
    adapter_worker?: string;
  };
  permissions: {
    network: boolean;
    memory_write: boolean;
    cost_class: "low" | "medium" | "high";
  };
  limits: {
    max_calls_per_conversation: number;
    timeout_ms: number;
  };
}

export interface SkillRegistryEntry extends SkillManifest {
  enabled: boolean;
}

export type SkillRegistry = Record<string, SkillRegistryEntry>;

// ─── OpenRouter Types ───

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  name?: string;
  tool_calls?: LLMToolCall[];
  tool_call_id?: string;
}

export interface LLMToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

export interface LLMToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface ChatCompletionResponse {
  id: string;
  choices: Array<{
    message: {
      role: "assistant";
      content: string | null;
      tool_calls?: LLMToolCall[];
    };
    finish_reason: string;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

// ─── Error Types ───

export interface MossError {
  id: string;
  error: string;
  context: string | null;
  created_at: number;
}
