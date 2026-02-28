"""
Modal deployment configuration for Moss inference.
Model names, GPU config, scaling params — all in one place.
"""

# ─── Model Configuration ───

TEXT_MODEL = "nvidia/Llama-3.1-Nemotron-Nano-8B-v1"
TEXT_MODEL_REVISION = "main"

VISION_MODEL = "nvidia/Llama-3.2-11B-Vision-Instruct"
VISION_MODEL_REVISION = "main"

# ─── GPU Configuration ───

GPU_TYPE = "T4"
VRAM_GB = 16

# vLLM memory utilization — leave headroom for CUDA overhead
TEXT_GPU_MEMORY_UTILIZATION = 0.40   # ~6.4GB for text model
VISION_GPU_MEMORY_UTILIZATION = 0.45  # ~7.2GB for vision model

# ─── Scaling Configuration ───

MIN_CONTAINERS = 0          # Scale to zero when idle
SCALEDOWN_WINDOW = 120      # Seconds before idle container shuts down
ENABLE_GPU_SNAPSHOT = True   # CUDA checkpoint/restore for fast cold starts

# ─── vLLM Server Configuration ───

TEXT_PORT = 8000
VISION_PORT = 8001

TEXT_MAX_MODEL_LEN = 4096
VISION_MAX_MODEL_LEN = 4096

# ─── Request Limits ───

MAX_TOOL_ROUNDS = 5
TRIAGE_MAX_TOKENS = 256
EXECUTE_MAX_TOKENS = 512
VISION_MAX_TOKENS = 512
MEMORY_MAX_TOKENS = 1024
