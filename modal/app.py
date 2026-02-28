"""
Moss Inference — Modal GPU Deployment

Two vLLM instances on a single T4 GPU:
  1. Text model (Nemotron-Nano-8B) — triage, tool execution, memory extraction
  2. Vision model (Llama-3.2-11B-Vision) — image understanding

The workers in the walls. Quiet. Precise. Always ready.
"""

import json
import subprocess
import time
from typing import Optional

import modal
from fastapi import Request, Response
from pydantic import BaseModel, Field

from config import (
    TEXT_MODEL,
    VISION_MODEL,
    GPU_TYPE,
    TEXT_PORT,
    VISION_PORT,
    TEXT_GPU_MEMORY_UTILIZATION,
    VISION_GPU_MEMORY_UTILIZATION,
    TEXT_MAX_MODEL_LEN,
    VISION_MAX_MODEL_LEN,
    MIN_CONTAINERS,
    SCALEDOWN_WINDOW,
    ENABLE_GPU_SNAPSHOT,
    TRIAGE_MAX_TOKENS,
    EXECUTE_MAX_TOKENS,
    VISION_MAX_TOKENS,
    MEMORY_MAX_TOKENS,
    MAX_TOOL_ROUNDS,
)

# ─── Modal App Setup ───

app = modal.App("moss-inference")

volume = modal.Volume.from_name("moss-model-cache", create_if_missing=True)

image = (
    modal.Image.debian_slim(python_version="3.11")
    .pip_install("vllm>=0.7.0", "torch>=2.5.0", "transformers>=4.47.0", "fastapi>=0.115.0")
)


# ─── Request/Response Models ───

class TriageRequest(BaseModel):
    message: str
    memory_context: str = ""
    available_tools: list[str] = Field(default_factory=list)
    conversation_history: list[dict] = Field(default_factory=list)


class TriageResponse(BaseModel):
    intent: str
    complexity: str
    tools_needed: list[str]
    route_to: str
    confidence: float


class ExecuteRequest(BaseModel):
    message: str
    triage: dict
    memory_context: str = ""
    tools: list[dict] = Field(default_factory=list)
    tool_results: list[dict] = Field(default_factory=list)
    round_number: int = 0


class ExecuteResponse(BaseModel):
    tool_calls: list[dict] = Field(default_factory=list)
    done: bool = False
    summary: str = ""


class VisionRequest(BaseModel):
    image_base64: str
    caption: str = ""
    memory_context: str = ""


class VisionResponse(BaseModel):
    description: str
    objects: list[str] = Field(default_factory=list)
    text_content: str = ""
    analysis: str = ""


class MemoryExtractionRequest(BaseModel):
    transcript: str


class MemoryExtractionResponse(BaseModel):
    facts: list[dict] = Field(default_factory=list)
    episode_summary: str = ""
    mood_signal: Optional[str] = None
    core_block_updates: list[dict] = Field(default_factory=list)


class HealthResponse(BaseModel):
    status: str
    text_model: str
    vision_model: str
    gpu: str
    uptime_seconds: float


# ─── Prompt Templates ───

TRIAGE_SYSTEM_PROMPT = """You are Moss's routing layer. Classify the user's message and decide how to handle it.

Respond with ONLY a JSON object — no explanation, no markdown, no extra text.

JSON schema:
{
  "intent": "task_create" | "task_query" | "github" | "memory_query" | "conversation" | "reminder_set" | "skill_invoke" | "memory_manage" | "grove_status",
  "complexity": "simple" | "moderate" | "complex",
  "tools_needed": string[],
  "route_to": "simple_response" | "full_agent" | "queue_async",
  "confidence": number (0-1)
}

Routing rules:
- Greetings, simple questions about the owner -> simple_response
- Task creation, reminders, GitHub lookups, memory queries -> full_agent
- Multi-step reasoning, research, complex analysis -> queue_async
- When uncertain, default to full_agent

Available tools: {tools}"""

EXECUTOR_SYSTEM_PROMPT = """You are Moss's tool execution layer. Given a user message and available tools, decide which tool to call next.

If you need to call a tool, respond with ONLY a JSON object:
{{
  "tool_calls": [{{ "name": "tool_name", "arguments": {{...}} }}],
  "done": false
}}

If all necessary work is complete, respond with:
{{
  "tool_calls": [],
  "done": true,
  "summary": "Brief structured summary of what was found/done"
}}

Available tools:
{tools}

Previous tool results:
{results}"""

MEMORY_EXTRACTION_PROMPT = """Read the conversation transcript and extract:

1. facts: Discrete facts or preferences explicitly stated by the user.
   - confidence: "confirmed" if explicit, "inferred" if guessing
   - needs_confirmation: true for inferred facts
2. episode_summary: 1-2 sentence summary of this conversation.
3. mood_signal: Only set if mood is clearly evident. null if unclear.
4. core_block_updates: Changes to propose to the owner's core profile. Empty array if none.

Respond with ONLY a JSON object:
{
  "facts": [{"content": "...", "confidence": "confirmed"|"inferred", "needs_confirmation": bool}],
  "episode_summary": "...",
  "mood_signal": "..." | null,
  "core_block_updates": [{"field": "...", "value": "...", "reason": "..."}]
}

Rules:
- Do NOT extract trivial facts (greetings, filler)
- Be conservative — fewer high-quality extractions over many low-quality ones
- Health/mood observations: ALWAYS set needs_confirmation: true"""

VISION_SYSTEM_PROMPT = """Analyze this image and provide a structured description.

Respond with ONLY a JSON object:
{
  "description": "Natural language description of what you see",
  "objects": ["list", "of", "key", "objects"],
  "text_content": "Any text visible in the image",
  "analysis": "Brief analysis of what this image means in context"
}"""


# ─── Main Inference Class ───

@app.cls(
    gpu=GPU_TYPE,
    image=image,
    volumes={"/models": volume},
    min_containers=MIN_CONTAINERS,
    scaledown_window=SCALEDOWN_WINDOW,
    allow_concurrent_inputs=10,
)
class MossInference:
    """Serves both models on a single T4 GPU via vLLM."""

    @modal.enter()
    def start_engines(self):
        """Start vLLM OpenAI-compatible servers for both models."""
        import openai

        self.start_time = time.time()

        # Start text model vLLM server
        self.text_process = subprocess.Popen(
            [
                "python", "-m", "vllm.entrypoints.openai.api_server",
                "--model", TEXT_MODEL,
                "--port", str(TEXT_PORT),
                "--gpu-memory-utilization", str(TEXT_GPU_MEMORY_UTILIZATION),
                "--max-model-len", str(TEXT_MAX_MODEL_LEN),
                "--download-dir", "/models",
                "--trust-remote-code",
                "--enable-auto-tool-choice",
                "--tool-call-parser", "hermes",
            ],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )

        # Start vision model vLLM server
        self.vision_process = subprocess.Popen(
            [
                "python", "-m", "vllm.entrypoints.openai.api_server",
                "--model", VISION_MODEL,
                "--port", str(VISION_PORT),
                "--gpu-memory-utilization", str(VISION_GPU_MEMORY_UTILIZATION),
                "--max-model-len", str(VISION_MAX_MODEL_LEN),
                "--download-dir", "/models",
                "--trust-remote-code",
            ],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )

        # Wait for both servers to be ready
        self.text_client = openai.OpenAI(
            base_url=f"http://localhost:{TEXT_PORT}/v1",
            api_key="unused",
        )
        self.vision_client = openai.OpenAI(
            base_url=f"http://localhost:{VISION_PORT}/v1",
            api_key="unused",
        )

        self._wait_for_server(self.text_client, "text")
        self._wait_for_server(self.vision_client, "vision")

    def _wait_for_server(self, client, name: str, timeout: int = 120):
        """Poll until the vLLM server is ready."""
        start = time.time()
        while time.time() - start < timeout:
            try:
                client.models.list()
                return
            except Exception:
                time.sleep(1)
        raise RuntimeError(f"vLLM {name} server failed to start within {timeout}s")

    def _safe_json_parse(self, text: str) -> dict | None:
        """Parse JSON from LLM output, stripping markdown fences."""
        cleaned = text.strip()
        if cleaned.startswith("```"):
            cleaned = cleaned.split("\n", 1)[-1]
        if cleaned.endswith("```"):
            cleaned = cleaned.rsplit("```", 1)[0]
        cleaned = cleaned.strip()
        try:
            return json.loads(cleaned)
        except json.JSONDecodeError:
            return None

    @modal.fastapi_endpoint(method="POST")
    async def triage(self, request: TriageRequest) -> TriageResponse:
        """Classify intent, complexity, tools needed."""
        tools_str = ", ".join(request.available_tools) if request.available_tools else "none"
        system_prompt = TRIAGE_SYSTEM_PROMPT.format(tools=tools_str)

        messages = [{"role": "system", "content": system_prompt}]

        if request.memory_context:
            messages.append({
                "role": "system",
                "content": f"Context about the owner:\n{request.memory_context}",
            })

        # Add conversation history for context
        for msg in request.conversation_history[-5:]:
            messages.append(msg)

        messages.append({"role": "user", "content": request.message})

        response = self.text_client.chat.completions.create(
            model=TEXT_MODEL,
            messages=messages,
            temperature=0.1,
            max_tokens=TRIAGE_MAX_TOKENS,
        )

        content = response.choices[0].message.content or ""
        parsed = self._safe_json_parse(content)

        if not parsed or "intent" not in parsed:
            # Default: route to full_agent — better to over-process than drop
            return TriageResponse(
                intent="conversation",
                complexity="moderate",
                tools_needed=[],
                route_to="full_agent",
                confidence=0.5,
            )

        return TriageResponse(
            intent=parsed.get("intent", "conversation"),
            complexity=parsed.get("complexity", "moderate"),
            tools_needed=parsed.get("tools_needed", []),
            route_to=parsed.get("route_to", "full_agent"),
            confidence=parsed.get("confidence", 0.5),
        )

    @modal.fastapi_endpoint(method="POST")
    async def execute(self, request: ExecuteRequest) -> ExecuteResponse:
        """Single round of tool calling with structured output."""
        # Format tool definitions for the prompt
        tools_desc = "\n".join(
            f"- {t['function']['name']}: {t['function']['description']}"
            for t in request.tools
            if "function" in t
        )

        # Format previous tool results
        results_desc = "None yet."
        if request.tool_results:
            lines = []
            for tr in request.tool_results:
                name = tr.get("name", "unknown")
                result = tr.get("result", {})
                summary = result.get("data", result.get("error", "no data"))
                lines.append(f"- {name}: {json.dumps(summary, default=str)[:500]}")
            results_desc = "\n".join(lines)

        system_prompt = EXECUTOR_SYSTEM_PROMPT.format(
            tools=tools_desc,
            results=results_desc,
        )

        messages = [{"role": "system", "content": system_prompt}]

        if request.memory_context:
            messages.append({
                "role": "system",
                "content": f"Context:\n{request.memory_context}",
            })

        messages.append({"role": "user", "content": request.message})

        response = self.text_client.chat.completions.create(
            model=TEXT_MODEL,
            messages=messages,
            temperature=0.1,
            max_tokens=EXECUTE_MAX_TOKENS,
        )

        content = response.choices[0].message.content or ""
        parsed = self._safe_json_parse(content)

        if not parsed:
            # If parsing fails, treat as done with the raw content as summary
            return ExecuteResponse(
                tool_calls=[],
                done=True,
                summary=content[:500] if content else "Processing complete.",
            )

        return ExecuteResponse(
            tool_calls=parsed.get("tool_calls", []),
            done=parsed.get("done", False),
            summary=parsed.get("summary", ""),
        )

    @modal.fastapi_endpoint(method="POST")
    async def vision(self, request: VisionRequest) -> VisionResponse:
        """Process images through the vision model."""
        messages = [
            {"role": "system", "content": VISION_SYSTEM_PROMPT},
        ]

        # Build content with image and optional caption
        content_parts = [
            {
                "type": "image_url",
                "image_url": {
                    "url": f"data:image/jpeg;base64,{request.image_base64}",
                },
            },
        ]

        user_text = request.caption or "Describe this image."
        if request.memory_context:
            user_text += f"\n\nContext: {request.memory_context}"

        content_parts.insert(0, {"type": "text", "text": user_text})

        messages.append({"role": "user", "content": content_parts})

        response = self.vision_client.chat.completions.create(
            model=VISION_MODEL,
            messages=messages,
            temperature=0.3,
            max_tokens=VISION_MAX_TOKENS,
        )

        content = response.choices[0].message.content or ""
        parsed = self._safe_json_parse(content)

        if not parsed:
            return VisionResponse(
                description=content[:500] if content else "Unable to process image.",
            )

        return VisionResponse(
            description=parsed.get("description", ""),
            objects=parsed.get("objects", []),
            text_content=parsed.get("text_content", ""),
            analysis=parsed.get("analysis", ""),
        )

    @modal.fastapi_endpoint(method="POST")
    async def extract_memory(self, request: MemoryExtractionRequest) -> MemoryExtractionResponse:
        """Extract facts and episodes from conversation transcript."""
        messages = [
            {"role": "system", "content": MEMORY_EXTRACTION_PROMPT},
            {"role": "user", "content": f"Transcript:\n\n{request.transcript}"},
        ]

        response = self.text_client.chat.completions.create(
            model=TEXT_MODEL,
            messages=messages,
            temperature=0.1,
            max_tokens=MEMORY_MAX_TOKENS,
        )

        content = response.choices[0].message.content or ""
        parsed = self._safe_json_parse(content)

        if not parsed:
            return MemoryExtractionResponse()

        return MemoryExtractionResponse(
            facts=parsed.get("facts", []),
            episode_summary=parsed.get("episode_summary", ""),
            mood_signal=parsed.get("mood_signal"),
            core_block_updates=parsed.get("core_block_updates", []),
        )

    @modal.fastapi_endpoint(method="GET")
    async def health(self) -> HealthResponse:
        """Health check — returns model status and uptime."""
        return HealthResponse(
            status="ok",
            text_model=TEXT_MODEL,
            vision_model=VISION_MODEL,
            gpu=GPU_TYPE,
            uptime_seconds=time.time() - self.start_time,
        )
