import json
import logging
import os
import re
from pathlib import Path
from typing import Literal

from camel.types import ModelType, RoleType
from pydantic import BaseModel, Field, field_validator, model_validator

from app.model.enums import DEFAULT_SUMMARY_PROMPT, Status  # noqa: F401
from app.utils.encryption_utils import decrypt, is_encrypted

logger = logging.getLogger("chat_model")


class ChatHistory(BaseModel):
    role: RoleType
    content: str


class QuestionAnalysisResult(BaseModel):
    type: Literal["simple", "complex"] = Field(
        description="Whether this is a simple question or complex task"
    )
    answer: str | None = Field(
        default=None,
        description="Direct answer for simple questions."
        " None for complex tasks.",
    )


McpServers = dict[Literal["mcpServers"], dict[str, dict]]


class AgentConfig(BaseModel):
    """Configuration for a specific agent type (e.g., Gemini 3 or MedGemma 4B).

    Used for primary_agent (Gemini 3 agents) and secondary_agent (MedGemma 4B agents).
    Falls back to Chat global config if not provided.
    """

    api_url: str | None = None
    model_type: str | None = None
    model_platform: str | None = None
    api_key: str | None = None
    use_simulated_tool_calling: bool = False
    # Maximum context window size in tokens for this agent's model.
    # Used as token_limit for CAMEL's auto-compaction (context summarization).
    # If None, CAMEL uses the model backend's default token limit.
    model_context_size: int | None = None
    # Optional HTTP headers to include in every API request.
    # Use this to pass Authorization: Bearer <token> for HuggingFace endpoints.
    default_headers: dict[str, str] | None = None

    @field_validator("model_type")
    @classmethod
    def normalize_model_type(cls, model_type: str | None):
        """Normalize model_type from enum NAME to enum VALUE if applicable.

        The frontend sends enum names (e.g. 'GLM_4_6V') but the API expects
        the enum value (e.g. 'glm-4.6v'). If the string is not a known enum
        name, it passes through as-is — allowing any custom/OpenAI-compatible
        model type.
        """
        if model_type is None:
            return model_type
        try:
            enum_member = ModelType[model_type]
            return enum_member.value
        except KeyError:
            pass
        return model_type

    def get_effective_config(self, fallback: "AgentConfig") -> "AgentConfig":
        """Returns a new AgentConfig with fallbacks applied."""
        return AgentConfig(
            api_url=self.api_url or fallback.api_url,
            model_type=self.model_type or fallback.model_type,
            model_platform=self.model_platform or fallback.model_platform,
            api_key=self.api_key or fallback.api_key,
            use_simulated_tool_calling=self.use_simulated_tool_calling
            or fallback.use_simulated_tool_calling,
            model_context_size=self.model_context_size
            or fallback.model_context_size,
            default_headers=self.default_headers or fallback.default_headers,
        )

    def has_custom_config(self) -> bool:
        """Check if any custom configuration values are set."""
        return any(
            [
                self.api_url,
                self.model_type,
                self.model_platform,
                self.api_key,
            ]
        )


class ChatMessage(BaseModel):
    id: str
    role: str
    content: str
    timestamp: str
    images: list[str] | None = None


class Chat(BaseModel):
    task_id: str
    project_id: str
    question: str
    attaches: list[str] = []
    # Model config fields: optional, fall back to env vars if not provided
    model_platform: str = ""
    model_type: str = ""
    api_key: str = ""
    # for cloud version, user don't need to set api_url
    api_url: str | None = None
    max_retries: int = 3
    installed_mcp: McpServers = {"mcpServers": {}}
    summary_prompt: str = DEFAULT_SUMMARY_PROMPT
    # Check if we need to use simulated tool calling
    # This is useful for models that don't support native function calling
    # like MedGemma, local LLMs, or other open-source models
    use_simulated_tool_calling: bool = False
    # Medical workforce model configurations
    # secondary_agent: For MedGemma 4B agents (Radiologist, Attending Physician, Clinical Pharmacologist)
    # Falls back to Chat global config if not provided
    secondary_agent: AgentConfig | None = None
    # Conversation history from frontend (last N messages for context)
    history: list[ChatMessage] = []

    @model_validator(mode="before")
    @classmethod
    def apply_env_defaults(cls, data: dict) -> dict:
        """Fill model config from environment variables when not
        provided by the frontend."""
        if isinstance(data, dict):
            api_key = data.get("api_key")

            # If api_key is provided by frontend, check if it needs decryption
            if api_key:
                if is_encrypted(api_key):
                    data["api_key"] = decrypt(api_key).strip()
            # Otherwise, fall back to environment variable
            elif api_key is None:
                data["api_key"] = os.getenv("GEMINI_API_KEY", "")

            if not data.get("model_platform"):
                data["model_platform"] = os.getenv("MODEL_PLATFORM", "")
            if not data.get("model_type"):
                data["model_type"] = os.getenv("MODEL_TYPE", "")
            if not data.get("api_url"):
                env_url = os.getenv("API_URL", "")
                if env_url:
                    data["api_url"] = env_url

            # Set default secondary_agent configuration if not provided.
            # In Medigent One the secondary agent defaults to Gemma 4 31B
            # via the Gemini API; SECONDARY_* env vars override the defaults.
            if not data.get("secondary_agent"):
                secondary_ctx = os.getenv("SECONDARY_CONTEXT_SIZE", "128000")
                # Bearer token (e.g. HuggingFace) via SECONDARY_API_KEY or HF_TOKEN
                secondary_api_key = os.getenv("SECONDARY_API_KEY") or os.getenv("HF_TOKEN")
                # Build default_headers for Authorization if a token is set
                secondary_headers: dict[str, str] | None = None
                if secondary_api_key:
                    secondary_headers = {"Authorization": f"Bearer {secondary_api_key}"}
                data["secondary_agent"] = {
                    "api_url": os.getenv("SECONDARY_API_URL", ""),
                    "model_platform": os.getenv(
                        "SECONDARY_MODEL_PLATFORM", "gemini"
                    ),
                    "model_type": os.getenv(
                        "SECONDARY_MODEL_TYPE", "gemma-4-31b-it"
                    ),
                    "api_key": secondary_api_key,
                    "use_simulated_tool_calling": False,
                    "model_context_size": int(secondary_ctx)
                    if secondary_ctx
                    else None,
                    "default_headers": secondary_headers,
                }
        return data

    @field_validator("model_type")
    @classmethod
    def check_model_type(cls, model_type: str):
        try:
            # Try to get the enum by name and return its value
            enum_member = ModelType[model_type]
            return enum_member.value
        except KeyError:
            # Not a valid enum name, return as-is
            logger.debug(
                f"model_type '{model_type}' is not a valid ModelType enum"
            )
        return model_type

    def file_save_path(self, path: str | None = None):
        # Use project-based structure: project_{project_id}/task_{task_id}
        save_path = (
            Path.home()
            / "medgemma"
            / f"project_{self.project_id}"
            / f"task_{self.task_id}"
        )
        if path is not None:
            save_path = save_path / path
        save_path.mkdir(parents=True, exist_ok=True)

        return str(save_path)


class SupplementChat(BaseModel):
    question: str
    task_id: str | None = None
    project_id: str | None = None
    attaches: list[str] = []


class HumanReply(BaseModel):
    agent: str
    reply: str
    attaches: list[str] = []


class TaskContent(BaseModel):
    id: str
    content: str


class UpdateData(BaseModel):
    task: list[TaskContent]


class AgentModelConfig(BaseModel):
    """Optional per-agent model configuration
    to override the default task model."""

    model_platform: str | None = None
    model_type: str | None = None
    api_key: str | None = None
    api_url: str | None = None
    # Context window size in tokens, passed from AgentConfig (secondary agents).
    # Used as token_limit for CAMEL's auto-compaction.
    model_context_size: int | None = None
    # Optional HTTP headers forwarded to the OpenAI-compatible client.
    # Used to pass Authorization: Bearer <token> for HuggingFace endpoints.
    default_headers: dict[str, str] | None = None

    def has_custom_config(self) -> bool:
        """Check if any custom model configuration is set."""
        return any(
            [
                self.model_platform is not None,
                self.model_type is not None,
                self.api_key is not None,
                self.api_url is not None,
            ]
        )


class NewAgent(BaseModel):
    name: str
    description: str
    tools: list[str]
    mcp_tools: McpServers | None
    custom_model_config: AgentModelConfig | None = None


class AddTaskRequest(BaseModel):
    content: str
    project_id: str | None = None
    task_id: str | None = None
    additional_info: dict | None = None
    insert_position: int = -1
    is_independent: bool = False


class RemoveTaskRequest(BaseModel):
    task_id: str


def sse_json(step: str, data):
    res_format = {"step": step, "data": data}
    return f"data: {json.dumps(res_format, ensure_ascii=False)}\n\n"
