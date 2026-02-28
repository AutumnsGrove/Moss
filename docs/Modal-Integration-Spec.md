# Modal GPU Integration — Architecture & Design Specification

> *The workers in the walls. Quiet. Precise. Always ready.*

**Status:** Design spec — ready for implementation
**Author:** Autumn Brown + Claude
**Date:** February 2026
**Parent:** [Moss-Spec.md](./Moss-Spec.md)
**Part of:** Grove ecosystem (grove.place)

-----

## Table of Contents

- [Motivation](#motivation)
- [Architecture Overview](#architecture-overview)
- [The Two Flows](#the-two-flows)
- [Message Lifecycle in Telegram](#message-lifecycle-in-telegram)
- [Modal Deployment](#modal-deployment)
- [The Triage Layer (Modal)](#the-triage-layer-modal)
- [The Executor Layer (Modal)](#the-executor-layer-modal)
- [The Conversational Layer (OpenRouter)](#the-conversational-layer-openrouter)
- [Progress Log — Real-Time Observability](#progress-log--real-time-observability)
- [Provider Abstraction](#provider-abstraction)
- [Tool Calling on Modal](#tool-calling-on-modal)
- [Memory Extraction on Modal](#memory-extraction-on-modal)
- [Vision Pipeline](#vision-pipeline)
- [Error Handling](#error-handling)
- [Cost Analysis](#cost-analysis)
- [Security Model](#security-model)
- [Migration Path](#migration-path)
- [Future Scope](#future-scope)

-----

## Motivation

Moss v1 runs all LLM inference through OpenRouter. This works — but it creates three tensions:

**Privacy is routed, not structural.** ZDR headers tell OpenRouter "don't train on this." But the data still transits OpenRouter's infrastructure and the upstream provider's infrastructure. The header is a policy, not an architecture.

**Model choice is constrained.** OpenRouter carries what it carries. When LFM2.5-1.2B-Instruct launched with native tool calling tokens, it wasn't on OpenRouter. When you want to run a vision model for photo understanding, you're limited to what's available and affordable on someone else's platform.

**The right model for each job.** Small, purpose-built models (1-2B parameters) are better at structured extraction, triage, and tool calling than large conversational models. Large conversational models (MiniMax M2.5, Kimi K2.5) are better at being warm and human. Forcing one model to do both jobs means neither job is done well.

Modal solves all three: your models, on your GPU, with your data never leaving the inference endpoint. The conversational models stay on OpenRouter where they belong — talking to the user. The worker models move to Modal where they belong — doing the work.

-----

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                        TELEGRAM                              │
│              you <-> Moss (natural conversation)             │
└──────────────────────────┬──────────────────────────────────┘
                           │ webhook POST
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                   CF WORKER: moss-gateway                    │
│     Auth · Rate limit · Owner-only · Enqueue to agent        │
└──────────────────────────┬──────────────────────────────────┘
                           │ CF Queue
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                   CF WORKER: moss-agent                      │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐    │
│  │               MODAL (T4 GPU, 16GB)                   │    │
│  │                                                      │    │
│  │  vLLM Instance 1: LFM2.5-1.2B-Instruct              │    │
│  │    - Triage (intent, complexity, tools_needed)        │    │
│  │    - Tool execution (constrained decoding)            │    │
│  │    - Memory extraction (async, queued)                │    │
│  │                                                      │    │
│  │  vLLM Instance 2: LFM2.5-VL-1.6B                    │    │
│  │    - Image understanding                              │    │
│  │    - Photo descriptions, OCR                          │    │
│  │    - Vision-augmented tool calling                     │    │
│  │                                                      │    │
│  │  Combined VRAM: ~5.6GB FP16 (T4 has 16GB headroom)   │    │
│  └──────────────────────────────────────────────────────┘    │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐    │
│  │           OPENROUTER (conversational layer)           │    │
│  │                                                      │    │
│  │  Default: MiniMax M2.5 (warm, natural, fast)          │    │
│  │  Override: /model command (Kimi K2.5, Claude, etc.)   │    │
│  │  ZDR: X-No-Data-Logging: true (always)                │    │
│  │                                                      │    │
│  │  Jobs:                                                │    │
│  │    - Generate contextual acknowledgments              │    │
│  │    - Craft final responses from structured summaries   │    │
│  │    - Handle pure chat (no tools needed)                │    │
│  │    - Explain errors naturally                          │    │
│  └──────────────────────────────────────────────────────┘    │
│                                                              │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                        STORAGE                               │
│  D1: tasks, episodes, facts, conversations, errors           │
│  KV: core blocks, config, tools, skills, model preference    │
│  Vectorize: semantic fact search                             │
│  R2: attachments (future)                                    │
└─────────────────────────────────────────────────────────────┘
```

### The Split

| Role | Where | Model | Talks to User? |
|------|-------|-------|----------------|
| Triage | Modal | LFM2.5-1.2B-Instruct | Never |
| Tool execution | Modal | LFM2.5-1.2B-Instruct | Never |
| Image understanding | Modal | LFM2.5-VL-1.6B | Never |
| Memory extraction | Modal | LFM2.5-1.2B-Instruct | Never |
| Acknowledgment | OpenRouter | MiniMax M2.5 | Yes |
| Final response | OpenRouter | MiniMax M2.5 | Yes |
| Pure chat | OpenRouter | MiniMax M2.5 | Yes |
| Error explanation | OpenRouter | MiniMax M2.5 | Yes |

The worker models never speak to the user. They produce structured data. The conversational model never touches a tool. It narrates what happened.

-----

## The Two Flows

### Chat Flow (no tools needed)

When triage determines the message is pure conversation — greetings, questions, casual chat — Modal does the classification and then gets out of the way. No acknowledgment message, no progress log. Just a natural response.

```
User message
    │
    ▼
Modal: LFM2.5-1.2B triage
    │
    ├── intent: "conversation"
    ├── complexity: "simple"
    ├── tools_needed: []
    └── route_to: "chat"
    │
    ▼
OpenRouter: MiniMax M2.5
    │
    ├── Input: user message + memory context + triage metadata
    └── Output: warm, natural response
    │
    ▼
Telegram: single response message
```

**One Modal call (triage) + one OpenRouter call (response).** No ack, no log. Clean.

### Work Flow (tools needed)

When triage determines the message needs action — GitHub lookups, task management, memory queries — the full pipeline fires. The user sees three messages: an acknowledgment, a progress log, and a final response.

```
User message
    │
    ▼
Modal: LFM2.5-1.2B triage
    │
    ├── intent: "github"
    ├── complexity: "moderate"
    ├── tools_needed: ["github_issues_list", "github_pr_status"]
    └── route_to: "full_agent"
    │
    ▼
OpenRouter: MiniMax M2.5 (acknowledgment)
    │
    ├── Input: user message + triage result
    └── Output: "Let me check your GitHub board..."
    │
    ▼
Telegram: send ack message
    │
    ▼
Modal: LFM2.5-1.2B executor (tool loop, up to 5 rounds)
    │
    ├── Round 1: github_issues_list → 12 items
    ├── Round 2: github_pr_status → 2 open PRs
    ├── (each round: edit progress log in Telegram)
    └── Done → structured summary
    │
    ▼
OpenRouter: MiniMax M2.5 (final response)
    │
    ├── Input: user message + memory context + structured summary
    └── Output: "Here's the situation room — 12 items on the board..."
    │
    ▼
Telegram: send final response message
```

**One Modal triage + one OpenRouter ack + N Modal executor rounds + one OpenRouter final.** Three messages in Telegram: ack, progress log, response.

-----

## Message Lifecycle in Telegram

For a work flow interaction, the user sees exactly three messages from Moss:

### Message 1: Acknowledgment

Generated by the conversational model (MiniMax M2.5) after triage completes. The triage result informs the ack so it's specific, not generic.

> "Let me pull up your GitHub board."

Not: "Let me look into that for you." The model knows what it's about to do.

### Message 2: Progress Log

Sent as soon as the first tool call begins. Edited in real-time via the Telegram `editMessageText` API as each tool completes. Uses inline Telegram HTML formatting.

```
▸ Triage: github_board_check
▸ github_issues_list → 12 items
▸ github_pr_status → 2 open, 1 merged
✓ Done (1.3s)
```

This message stays in chat history permanently. It's the audit trail — you can scroll back and see exactly what Moss did for any interaction.

### Message 3: Final Response

Generated by the conversational model from the structured summary. Warm, natural, conversational. References the data but doesn't regurgitate the raw tool output.

> "Here's the situation room — you've got 12 items on the board with 5 open issues. Two of them are critical: the auth flow has been sitting in Ready for 3 days, and there's a failing CI check on the Nook thumbnail PR. Want me to dig into either one?"

### Telegram API Considerations

- **`editMessageText`** rate limit: ~30 edits/minute per chat. With a max of 5 tool rounds, this is well within limits.
- **Typing indicator**: Sent via `sendChatAction("typing")` during OpenRouter calls (ack generation, final response generation). Not during Modal tool execution — the progress log is the indicator.
- **Message ordering**: Ack is sent before the executor starts. Progress log is sent when the first tool fires. Final response is sent after all tools complete. Sequential — no race conditions.

-----

## Modal Deployment

### Infrastructure

```
Provider:     Modal (modal.com)
GPU:          T4 (16GB VRAM, Turing architecture)
Cost:         $0.59/hr active, $0/hr idle (scale to zero)
Region:       Modal selects automatically
Scaling:      0 to N containers, auto-managed
Cold start:   ~5s with GPU memory snapshots
```

### Why T4

The two models combined need ~5.6GB VRAM at FP16. A T4 has 16GB — over 10GB of headroom. The T4 is the cheapest GPU Modal offers ($0.59/hr) and is more than sufficient for 1-2B parameter models. There is no reason to pay for an L4 ($0.80/hr) or higher.

If VRAM requirements grow (adding more models in v2), Modal's GPU fallback chains make it trivial to upgrade:

```python
@app.function(gpu=["T4", "L4"])  # try T4, fall back to L4
```

### Two vLLM Instances, One GPU

Both models run simultaneously on the same T4. No model swapping, no cold start penalty for switching between text and vision tasks.

```python
# Simplified Modal deployment structure

import modal

app = modal.App("moss-inference")
volume = modal.Volume.from_name("moss-model-cache", create_if_missing=True)

# Image with vLLM + both models cached
image = (
    modal.Image.debian_slim(python_version="3.11")
    .pip_install("vllm", "torch", "transformers")
)

@app.cls(
    gpu="T4",
    image=image,
    volumes={"/models": volume},
    min_containers=0,          # scale to zero
    scaledown_window=120,      # 2 min idle before shutdown
    experimental_options={"enable_gpu_snapshot": True},
)
class MossInference:
    """Serves both LFM models on a single T4 GPU."""

    @modal.enter()
    def start_engines(self):
        # Start vLLM for text model (port 8000)
        # Start vLLM for vision model (port 8001)
        ...

    @modal.fastapi_endpoint(method="POST")
    async def triage(self, request):
        """Classify intent, complexity, tools needed."""
        ...

    @modal.fastapi_endpoint(method="POST")
    async def execute(self, request):
        """Run tool calling loop with constrained decoding."""
        ...

    @modal.fastapi_endpoint(method="POST")
    async def vision(self, request):
        """Process images through LFM2.5-VL."""
        ...

    @modal.fastapi_endpoint(method="POST")
    async def extract_memory(self, request):
        """Extract facts and episodes from conversation."""
        ...
```

### GPU Memory Snapshots

Modal's GPU memory snapshot feature (NVIDIA CUDA checkpoint/restore API) captures the full GPU state after first boot — compiled models, CUDA graphs, allocated memory. On subsequent cold starts, instead of loading models from disk and compiling (~30-45s), it restores the snapshot in **~5 seconds**.

This is critical for a Telegram bot. Without snapshots, a message after an idle period would wait 30-45 seconds for the GPU to wake up. With snapshots, it's 5 seconds — fast enough that the typing indicator covers it.

Enabled with a single flag:

```python
experimental_options={"enable_gpu_snapshot": True}
```

### Endpoint URLs

After `modal deploy`, the endpoints are:

```
https://<workspace>--moss-inference-triage.modal.run
https://<workspace>--moss-inference-execute.modal.run
https://<workspace>--moss-inference-vision.modal.run
https://<workspace>--moss-inference-extract-memory.modal.run
```

Stable URLs. HTTPS. No custom domain needed (Modal provides them).

-----

## The Triage Layer (Modal)

### What Changed from v1

In v1, triage runs on OpenRouter via LFM2-24B-A2B. In this architecture, triage moves to Modal via LFM2.5-1.2B-Instruct. The interface is identical — same JSON output format, same system prompt structure — but the model is smaller, faster, and runs on your own GPU.

### Triage Request

```typescript
// From moss-agent Worker
const triageResult = await modalClient.triage({
  message: userMessage.text,
  memory_context: memoryContext,    // core blocks + episodes + facts
  available_tools: toolRegistry,     // tool names + descriptions
  conversation_history: recentMessages,
});
```

### Triage Response

```json
{
  "intent": "github",
  "complexity": "moderate",
  "tools_needed": ["github_issues_list", "github_pr_status"],
  "route_to": "full_agent",
  "confidence": 0.94
}
```

Unchanged from the v1 triage contract. The `route_to` field determines which flow fires:

| `route_to` | Flow | What Happens |
|------------|------|--------------|
| `"chat"` | Chat flow | Skip ack/log, straight to OpenRouter for response |
| `"full_agent"` | Work flow | Ack → executor → progress log → final response |
| `"queue_async"` | Background | Ack → queue for later processing (future) |

-----

## The Executor Layer (Modal)

### Tool Calling with Constrained Decoding

This is where the LFM models earn their keep. vLLM's structured output engine (XGrammar) forces the model to produce valid JSON matching the tool's parameter schema. The model doesn't need to "decide" to format correctly — the decoding process guarantees it.

```typescript
// From moss-agent Worker
const executionResult = await modalClient.execute({
  message: userMessage.text,
  triage: triageResult,
  memory_context: memoryContext,
  tools: getToolDefinitionsForLLM(triageResult.tools_needed),
  max_rounds: 5,
  on_tool_call: async (toolCall) => {
    // Real-time progress update callback
    await updateProgressLog(chatId, progressMessageId, toolCall);
  },
});
```

### The Tool Loop

The executor runs a loop of up to 5 rounds:

```
Round 1:
  LFM receives: user message + tools + memory
  LFM outputs:  tool_call { name: "github_issues_list", args: { repo: "Moss" } }
  Worker:        dispatches tool, gets result
  Telegram:      edits progress log ("▸ github_issues_list → 12 items")

Round 2:
  LFM receives: previous context + tool result
  LFM outputs:  tool_call { name: "github_pr_status", args: { repo: "Moss" } }
  Worker:        dispatches tool, gets result
  Telegram:      edits progress log (adds "▸ github_pr_status → 2 open")

Round 3:
  LFM receives: previous context + all tool results
  LFM outputs:  no tool calls — returns structured summary
  Loop ends.
```

### Execution Response

```json
{
  "completed": true,
  "rounds": 2,
  "duration_ms": 1340,
  "tools_called": [
    {
      "name": "github_issues_list",
      "args": { "repo": "Moss" },
      "result_summary": "12 items: 5 open issues, 2 critical"
    },
    {
      "name": "github_pr_status",
      "args": { "repo": "Moss" },
      "result_summary": "2 open PRs, 1 with failing CI"
    }
  ],
  "summary": "GitHub board has 12 items. 5 open issues, 2 critical (auth flow stale 3 days, Nook CI failing). 2 open PRs, 1 needs attention."
}
```

The summary is what gets passed to the conversational model. Clean, structured, no raw API payloads.

### Tool Calling Configuration

vLLM is configured with `tool_choice='required'` for the executor — every output must be a valid tool call or an explicit "done" signal. This uses XGrammar constrained decoding, which works with **any** model including LFM2.5-1.2B-Instruct.

No custom tool call parser needed for v1. The constrained decoding approach is model-agnostic and guaranteed to produce valid JSON.

**v2 path:** Write a custom vLLM tool parser plugin that understands LFM's native `<|tool_list_start|>`/`<|tool_list_end|>` tokens. This would enable `tool_choice='auto'` where the model itself decides when to call tools vs. when to return a summary. Higher quality because it uses the model's training, not just output constraints.

-----

## The Conversational Layer (OpenRouter)

### Default Model: MiniMax M2.5

```
Provider:     OpenRouter
Model:        minimax/minimax-m2.5
ZDR:          X-No-Data-Logging: true (always)
Role:         All user-facing text generation
```

MiniMax M2.5 was chosen for its natural conversational ability, strong system prompt adherence, and competitive pricing. It generates the acknowledgment ("Let me check that..."), the final response ("Here's what I found..."), and handles pure chat when no tools are needed.

### Model Override

The user can switch the conversational model via a `/model` command in Telegram:

```
/model kimi        → switches to Kimi K2.5
/model claude      → switches to Claude Sonnet
/model minimax     → switches back to MiniMax M2.5
/model             → shows current model
```

The selected model is stored in KV at `moss:config:conversational-model`. Persists across sessions. Only affects the conversational layer — triage and execution always use LFM on Modal regardless of this setting.

### What the Conversational Model Receives

For acknowledgment generation:

```json
{
  "role": "system",
  "content": "You are Moss. Generate a brief, natural acknowledgment for what you're about to do. One sentence."
},
{
  "role": "user",
  "content": "what does the github board look like"
},
{
  "role": "assistant_context",
  "content": {
    "triage": {
      "intent": "github",
      "tools_needed": ["github_issues_list", "github_pr_status"]
    }
  }
}
```

For final response generation:

```json
{
  "role": "system",
  "content": "[Moss system prompt + memory context]"
},
{
  "role": "user",
  "content": "what does the github board look like"
},
{
  "role": "assistant_context",
  "content": {
    "execution_summary": {
      "tools_called": [...],
      "summary": "GitHub board has 12 items. 5 open issues, 2 critical..."
    }
  }
}
```

The conversational model never sees raw tool definitions, raw API responses, or the inner workings of the executor. It gets a clean summary and turns it into natural language.

-----

## Progress Log — Real-Time Observability

### Format

Inline Telegram HTML formatting. Bold tool names, italic results. Grows as each tool completes.

After round 1:

```html
<b>▸ Triage:</b> github_board_check
<b>▸ github_issues_list</b> → <i>12 items</i>
```

After round 2:

```html
<b>▸ Triage:</b> github_board_check
<b>▸ github_issues_list</b> → <i>12 items</i>
<b>▸ github_pr_status</b> → <i>2 open, 1 failing CI</i>
```

After completion:

```html
<b>▸ Triage:</b> github_board_check
<b>▸ github_issues_list</b> → <i>12 items</i>
<b>▸ github_pr_status</b> → <i>2 open, 1 failing CI</i>
<b>✓ Done</b> (1.3s)
```

### Implementation

```typescript
async function updateProgressLog(
  chatId: number,
  messageId: number,
  entry: ProgressEntry,
  existingLog: string,
): Promise<string> {
  const line = formatProgressLine(entry);
  const updatedLog = existingLog + "\n" + line;

  await telegram.editMessageText({
    chat_id: chatId,
    message_id: messageId,
    text: updatedLog,
    parse_mode: "HTML",
  });

  return updatedLog;
}
```

### When No Tools Are Needed (Chat Flow)

No progress log is sent. No acknowledgment is sent. The user sends a message, Modal triages it as chat, OpenRouter responds. One message in, one message out. Clean.

-----

## Provider Abstraction

### The Modal Client

A new module in `src/shared/` that handles all communication with Modal endpoints.

```typescript
// src/shared/modal.ts

interface ModalClient {
  triage(request: TriageRequest): Promise<TriageResult>;
  execute(request: ExecuteRequest): Promise<ExecutionResult>;
  vision(request: VisionRequest): Promise<VisionResult>;
  extractMemory(request: MemoryExtractionRequest): Promise<MemoryExtractionResult>;
  health(): Promise<HealthStatus>;
}
```

### Configuration

```typescript
// Environment variables (CF Secrets)
MODAL_ENDPOINT_URL:   "https://<workspace>--moss-inference.modal.run"
MODAL_AUTH_TOKEN:     "modal-secret-..."  // Modal proxy auth token
```

### Timeout and Retry

```typescript
const MODAL_CONFIG = {
  triage_timeout_ms: 10_000,     // 10s (includes cold start)
  execute_timeout_ms: 30_000,    // 30s (multi-round tool loop)
  vision_timeout_ms: 15_000,     // 15s
  memory_timeout_ms: 20_000,     // 20s
  retry_attempts: 1,              // one retry on network failure
  retry_delay_ms: 2_000,         // 2s between retries
};
```

-----

## Tool Calling on Modal

### How Tools Execute

Tools are still defined and dispatched in the Cloudflare Worker (`src/agent/tools/`). The Modal executor doesn't call tools directly — it returns tool call requests, the Worker dispatches them, and feeds results back to Modal for the next round.

```
┌────────────┐     tool_call request     ┌──────────────┐
│   Modal    │ ──────────────────────────> │  CF Worker   │
│  Executor  │                            │  (moss-agent)│
│            │ <────────────────────────── │              │
│            │     tool result            │  dispatches   │
│            │                            │  github.ts    │
│            │     next tool_call         │  tasks.ts     │
│            │ ──────────────────────────> │  memory.ts   │
│            │                            │  grove.ts     │
│            │ <────────────────────────── │              │
│            │     tool result            └──────────────┘
│            │
│            │     "done" + summary
└────────────┘
```

This design means:

- **Tools stay in the Worker.** GitHub PATs, D1 access, KV access — all stay in Cloudflare. Modal never sees your credentials.
- **Modal only does inference.** It receives context, produces structured output (tool calls or summaries), and that's it.
- **Adding a new tool** doesn't require a Modal redeploy. You add it to the Worker's tool registry. The executor's tool definitions are passed in the request.

### Tool Definition Format

Same OpenAI function-calling format used in v1. Passed to Modal in the execute request:

```json
{
  "tools": [
    {
      "type": "function",
      "function": {
        "name": "github_issues_list",
        "description": "List open issues in a GitHub repository",
        "parameters": {
          "type": "object",
          "properties": {
            "repo": { "type": "string", "description": "Repository name" },
            "state": { "type": "string", "enum": ["open", "closed", "all"] }
          },
          "required": ["repo"]
        }
      }
    }
  ]
}
```

-----

## Memory Extraction on Modal

### What Changed from v1

In v1, memory extraction runs on OpenRouter via LFM. In this architecture, it moves to Modal. The extraction prompt, output format, and confirmation flow are unchanged.

### Async Pipeline

```
[conversation ends]
         │
         ▼
CF Queue: { type: "memory_write", conversationId: "..." }
         │
         ▼
moss-agent queue consumer
         │
         ▼
Modal: POST /extract_memory
  - Input: full conversation transcript
  - Model: LFM2.5-1.2B-Instruct (temperature 0.1)
  - Output: { facts, episode_summary, mood_signal, core_block_updates }
         │
         ▼
Store in D1 + Vectorize (same as v1)
```

Memory extraction is not latency-sensitive. It runs asynchronously via the queue. Even if Modal is cold (5s startup), it doesn't matter — the user isn't waiting.

-----

## Vision Pipeline

### When It Fires

When a user sends a photo via Telegram, the gateway extracts the image, and triage routes it through the vision model.

```
Telegram: photo message
         │
         ▼
Gateway: download image from Telegram file API
         │
         ▼
Modal: POST /vision
  - Input: image bytes + user message (caption) + memory context
  - Model: LFM2.5-VL-1.6B
  - Output: { description, objects, text_content, analysis }
         │
         ▼
Inject vision output into executor context (if tools needed)
  OR inject directly into conversational model (if chat)
         │
         ▼
OpenRouter: MiniMax M2.5 generates response incorporating vision
```

### Vision Response Format

```json
{
  "description": "A screenshot of a GitHub project board showing 12 issues in 4 columns",
  "objects": ["project board", "issue cards", "column headers"],
  "text_content": "Columns: Backlog (4), Ready (3), In Progress (3), Done (2)",
  "analysis": "The board shows active development with even distribution across columns"
}
```

### Image Handling

- Telegram provides a file URL via the Bot API. The Worker downloads the image bytes.
- Image is sent to Modal as base64 in the request body (vLLM accepts base64 images in the OpenAI vision format).
- Images are not stored. They're processed and discarded. No R2, no persistence.
- Max image size: 10MB (Telegram's limit for photos).

-----

## Error Handling

### Philosophy

When Modal fails, the user should hear about it from Moss in Moss's voice — not see a stack trace or a generic error. Errors are passed to the conversational model on OpenRouter, which explains what happened naturally.

### Error Scenarios

| Scenario | What Happens |
|----------|--------------|
| Modal cold start timeout | OpenRouter generates: "I'm just waking up — give me a moment and try again." |
| Modal GPU unavailable | OpenRouter generates: "My GPU is busy right now. Let me try that again in a moment." |
| Tool call fails | Progress log shows: `✗ github_issues_list → API error`. OpenRouter explains: "I tried to check GitHub but hit an API error. Want me to try again?" |
| Modal completely down | Fall back to OpenRouter for triage + execution (degraded mode). Conversational model handles everything, including tool calling if needed. |
| OpenRouter down | Triage still works (Modal). Ack and response fail. User sees no response. Retry on next message. |

### Error Response Flow

```typescript
try {
  const result = await modalClient.execute(request);
  // ... normal flow
} catch (error) {
  // Pass error to conversational model for natural explanation
  const errorResponse = await openrouter.chatCompletion({
    model: conversationalModel,
    messages: [
      { role: "system", content: MOSS_SYSTEM_PROMPT },
      { role: "user", content: userMessage.text },
      {
        role: "system",
        content: `An error occurred while processing: ${error.message}. Explain this to the user naturally and suggest next steps.`,
      },
    ],
  });

  await telegram.sendMessage(chatId, errorResponse.content);
}
```

-----

## Cost Analysis

### Modal Costs (T4 GPU)

```
GPU rate:              $0.59/hr ($0.0001639/second)
Idle rate:             $0.00 (scale to zero)
Scaledown window:      120 seconds (configurable)
Cold start:            ~5 seconds (with GPU snapshot)
```

### Daily Usage Estimate (typical personal use)

```
Triage calls:          ~100/day × ~1s each = 100s GPU time
Executor rounds:       ~50 tool rounds/day × ~3s each = 150s GPU time
Memory extractions:    ~20/day × ~5s each = 100s GPU time
Vision calls:          ~5/day × ~4s each = 20s GPU time
                       ─────────────────────────────────
Total GPU time:        370s = 6.2 minutes/day
Scaledown overhead:    ~30 wake events × 120s = 3600s idle time (billed)
                       ─────────────────────────────────
Total billed time:     ~3970s = 66 minutes/day
Daily cost:            66 min × $0.59/60 = $0.65/day
Monthly cost:          ~$19.50/month
```

### With $30/Month Free Credits

Modal's Starter plan includes $30/month in free credits. At ~$19.50/month estimated usage, **Modal inference is effectively free** on the Starter plan with headroom to spare.

### OpenRouter Costs (unchanged from v1)

The conversational model calls (ack + final response + pure chat) are the same as v1 — they just go to MiniMax M2.5 instead of being mixed between models. MiniMax M2.5 pricing on OpenRouter is competitive.

### Comparison to v1 (all-OpenRouter)

| | v1 (OpenRouter only) | v1.5 (Modal + OpenRouter) |
|---|---|---|
| Triage | LFM2-24B-A2B on OpenRouter (~$0.03/1M in) | LFM2.5-1.2B on Modal (included in GPU time) |
| Execution | Claude/MiniMax on OpenRouter (per-token) | LFM2.5-1.2B on Modal (included in GPU time) |
| Conversation | Claude/MiniMax on OpenRouter (per-token) | MiniMax M2.5 on OpenRouter (per-token, but fewer tokens — no tool calling overhead) |
| Memory extraction | LFM on OpenRouter (per-token) | LFM2.5-1.2B on Modal (included in GPU time) |
| **Monthly estimate** | Depends heavily on usage, ~$10-30 | ~$0 Modal + reduced OpenRouter |

The big win: tool calling loops no longer burn per-token costs on OpenRouter. Those tokens are now "free" (included in the flat GPU time). OpenRouter only handles the conversational parts — ack + final response — which are typically short.

-----

## Security Model

### Data Flow

```
User message → CF Worker → Modal (inference only) → CF Worker → Storage
                                                   → OpenRouter (ZDR) → CF Worker
```

**What Modal sees:**
- User message text (for triage/execution)
- Memory context (injected in prompt)
- Tool definitions (schemas, not credentials)
- Image bytes (for vision, not stored)

**What Modal never sees:**
- GitHub PATs
- Telegram bot token
- D1 data directly
- KV data directly
- Any Cloudflare credentials

Tools are dispatched by the Worker, not Modal. Modal says "call `github_issues_list` with these args" — the Worker executes it using credentials that never leave Cloudflare.

### Modal Authentication

Modal web endpoints support proxy auth tokens — Modal validates `Modal-Key` and `Modal-Secret` headers before routing to your endpoint. The Worker includes these headers on every request. No public access to the inference endpoints.

```typescript
// Request from CF Worker to Modal
headers: {
  "Modal-Key": env.MODAL_AUTH_KEY,
  "Modal-Secret": env.MODAL_AUTH_SECRET,
  "Content-Type": "application/json",
}
```

### ZDR on OpenRouter

Unchanged. `X-No-Data-Logging: true` on every OpenRouter call. Non-negotiable.

### Privacy Upgrade

Moving triage, execution, and memory extraction to Modal means your conversations, memory context, and tool calling patterns no longer transit OpenRouter's infrastructure for those operations. Only the conversational layer (ack + final response) goes through OpenRouter, and those contain summaries — not raw conversation data.

This is a meaningful privacy improvement. The most sensitive data (what tools you use, what you ask Moss to do, your memory context) stays between Cloudflare and your Modal endpoint.

-----

## Migration Path

### Phase 1: Deploy Modal Endpoint

1. Set up Modal account and install CLI
2. Create `/modal` directory in the Moss repo
3. Write the Modal deployment Python code
4. Download and cache LFM2.5-1.2B-Instruct + LFM2.5-VL-1.6B in a Modal Volume
5. Configure vLLM with GPU memory snapshots
6. Deploy with `modal deploy`
7. Verify endpoints respond correctly

### Phase 2: Add Modal Client to Worker

1. Create `src/shared/modal.ts` — the Modal HTTP client
2. Add `MODAL_ENDPOINT_URL` and `MODAL_AUTH_*` to CF Secrets
3. Wire triage to call Modal instead of OpenRouter for classification
4. Keep OpenRouter as the execution/response layer initially (no behavior change for the user)
5. Deploy and verify triage works via Modal

### Phase 3: Move Executor to Modal

1. Update `src/agent/executor.ts` to use Modal for the tool calling loop
2. Implement the progress log (send, edit, complete)
3. Split the response flow into ack + log + final
4. Add the acknowledgment generation step (OpenRouter)
5. Deploy and verify the full work flow

### Phase 4: Move Memory Extraction to Modal

1. Update `src/memory/extractor.ts` to call Modal instead of OpenRouter
2. Verify extraction quality is equivalent
3. Deploy

### Phase 5: Add Vision

1. Update gateway to handle Telegram photo messages
2. Add vision endpoint to Modal deployment
3. Wire vision results into the executor/conversational flow
4. Deploy

### Phase 6: Add `/model` Command

1. Add Telegram command handler for `/model`
2. Store model preference in KV at `moss:config:conversational-model`
3. Update OpenRouter calls to use the stored preference
4. Deploy

-----

## Future Scope

### Deliberately Deferred

**Voice notes (v2):** Telegram voice messages → NVIDIA Parakeet TDT 0.6B (ASR) on the same Modal GPU → text → normal Moss flow. Parakeet is 600M params, ~2.1GB VRAM, CC-BY-4.0 license. Fits on the T4 alongside the existing models. Best-in-class English ASR (6.05% WER, better than Whisper).

**LFM native tool parser (v2):** Write a custom vLLM tool call parser for LFM's native `<|tool_list_start|>`/`<|tool_list_end|>` tokens. Enables `tool_choice='auto'` where the model decides when to call tools. Better quality than constrained decoding for complex multi-tool reasoning.

**Voice responses (v3):** LFM2.5-Audio-1.5B for text-to-speech. Moss talks back via Telegram voice messages. End-to-end voice conversation without leaving the LFM family.

**Model hot-swap (v2):** Multiple model configurations cached in Modal Volumes. Switch between model sizes based on time of day (faster/cheaper at night, higher quality during work hours) or user preference.

**RunPod fallback (v2):** If Modal has availability issues, route to a RunPod serverless endpoint running the same models. Same OpenAI-compatible protocol, same vLLM configuration. The provider abstraction makes this trivial.

-----

## Code Location

All Modal deployment code lives in `/modal` within the Moss monorepo:

```
/modal
├── app.py              # Modal app definition, vLLM setup, endpoints
├── config.py           # Model names, GPU config, scaling params
├── requirements.txt    # Python dependencies (vllm, torch, etc.)
└── README.md           # Deployment instructions
```

TypeScript integration code lives in the existing `src/` structure:

```
/src/shared
├── modal.ts            # Modal HTTP client (NEW)
├── openrouter.ts       # OpenRouter client (existing, unchanged)
├── providers.ts        # Provider abstraction layer (NEW)
└── ...

/src/agent
├── executor.ts         # Updated to use Modal for tool loop
├── triage.ts           # Updated to use Modal for classification
├── progress.ts         # Progress log management (NEW)
└── ...
```

-----

*Built for grove.place · Autumn Brown · February 2026*
*The workers in the walls. Quiet. Precise. Always ready.*
