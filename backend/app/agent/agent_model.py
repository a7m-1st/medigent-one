
import json
import logging
import uuid
from collections.abc import Callable
from typing import Any

from camel.messages import BaseMessage
from camel.messages.conversion.sharegpt.hermes import HermesFunctionFormatter
from camel.models import ModelFactory
from camel.toolkits import FunctionTool, RegisteredAgentToolkit
from camel.types import ModelPlatformType

from app.agent.listen_chat_agent import ListenChatAgent, logger
from app.model.chat import AgentModelConfig, Chat
from app.service.model_registry import get_or_create_model
from app.service.task import ActionCreateAgentData, Agents, get_task_lock
from app.utils.event_loop_utils import _schedule_async_task


def _normalize_agent_name(agent_name: str | Agents) -> str:
    if isinstance(agent_name, Agents):
        return agent_name.value

    normalized = str(agent_name)
    if normalized.startswith("Agents."):
        return normalized.split(".", 1)[1]
    return normalized


def agent_model(
    agent_name: str,
    system_message: str | BaseMessage,
    options: Chat,
    tools: list[FunctionTool | Callable] | None = None,
    prune_tool_calls_from_memory: bool = False,
    tool_names: list[str] | None = None,
    toolkits_to_register_agent: list[RegisteredAgentToolkit] | None = None,
    enable_snapshot_clean: bool = False,
    custom_model_config: AgentModelConfig | None = None,
    support_native_tool_calling: bool = True,
):
    task_lock = get_task_lock(options.project_id)
    agent_id = str(uuid.uuid4())
    normalized_agent_name = _normalize_agent_name(agent_name)
    logger.info(
        f"Creating agent: {normalized_agent_name} with id: {agent_id} "
        f"for project: {options.project_id}"
    )
    # Use thread-safe scheduling to support parallel agent creation
    _schedule_async_task(
        task_lock.put_queue(
            ActionCreateAgentData(
                data={
                    "agent_name": normalized_agent_name,
                    "agent_id": agent_id,
                    "tools": tool_names or [],
                }
            )
        )
    )

    # Determine model configuration - use custom config if provided,
    # otherwise use task defaults
    config_attrs = ["model_platform", "model_type", "api_key", "api_url"]
    effective_config = {}

    if custom_model_config and custom_model_config.has_custom_config():
        for attr in config_attrs:
            effective_config[attr] = getattr(
                custom_model_config, attr, None
            ) or getattr(options, attr)
        logger.info(
            f"Agent {agent_name} using custom model config: "
            f"platform={effective_config['model_platform']}, "
            f"type={effective_config['model_type']}"
        )
    else:
        for attr in config_attrs:
            effective_config[attr] = getattr(options, attr)
    init_params = {}
    model_config: dict[str, Any] = {}

    if normalized_agent_name == Agents.task_agent.value:
        model_config["stream"] = True
    if normalized_agent_name == Agents.clinical_researcher.value:
        try:
            model_platform_enum = ModelPlatformType(
                effective_config["model_platform"].lower()
            )
            if model_platform_enum in {
                ModelPlatformType.OPENAI,
                ModelPlatformType.AZURE,
                ModelPlatformType.OPENAI_COMPATIBLE_MODEL,
                ModelPlatformType.LITELLM,
                ModelPlatformType.OPENROUTER,
            }:
                model_config["parallel_tool_calls"] = False
        except (ValueError, AttributeError):
            logging.error(
                f"Invalid model platform for browser agent: "
                f"{effective_config['model_platform']}",
                exc_info=True,
            )
            model_platform_enum = None

    logger.info(
        f"Creating model with platform={effective_config['model_platform']}, "
        f"type={effective_config['model_type']}, url={effective_config['api_url']}"
    )

    # Resolve context size from custom_model_config (secondary agents only)
    resolved_context_size = None
    if custom_model_config and custom_model_config.model_context_size:
        resolved_context_size = custom_model_config.model_context_size

    if resolved_context_size:
        logger.info(
            f"Agent {agent_name} using token_limit={resolved_context_size} "
            f"(auto-compaction enabled at ~90% usage)"
        )

    # Resolve custom headers (e.g. Authorization: Bearer for HuggingFace endpoints)
    resolved_headers = (
        custom_model_config.default_headers
        if custom_model_config and custom_model_config.default_headers
        else None
    )

    # Use shared model registry to avoid redundant ModelFactory.create() calls.
    # Identical configurations (same platform/type/key/url) return the same
    # cached backend instance — typically only 2 are needed (Gemini + MedGemma).
    model = get_or_create_model(
        model_platform=effective_config["model_platform"].lower(),
        model_type=effective_config["model_type"],
        api_key=effective_config["api_key"],
        api_url=effective_config["api_url"],
        model_config_dict=model_config or None,
        timeout=600,  # 10 minutes
        default_headers=resolved_headers,
        **init_params,
    )

    # Handle simulated tool calling for models without native support
    if not support_native_tool_calling and tools:
        logger.info(
            "Agent "
            f"{normalized_agent_name} using simulated tool calling "
            "(Hermes format)"
        )
        # Build tool descriptions for the system message
        tool_descriptions = []
        for tool in tools:
            if isinstance(tool, FunctionTool):
                schema = tool.get_openai_tool_schema()
                func = schema["function"]
                tool_descriptions.append({
                    "name": func["name"],
                    "description": func["description"],
                    "parameters": func["parameters"]
                })

        # Build tool instructions
        tool_instructions = f"""

You have access to the following tools:
{json.dumps(tool_descriptions, separators=(',', ':'))}

When you need to use a tool, format your response like this:
<tool_call>
{{"name": "tool_name", "arguments": {{"param1": "value1", "param2": "value2"}}}}
</tool_call>

After calling a tool, you will receive the result and should continue the conversation based on that result."""

        # Append tool instructions to system message
        # Keep the original role type (system) to maintain proper conversation flow
        if isinstance(system_message, BaseMessage):
            # Create a new message with updated content but same role
            from camel.types import RoleType
            system_message = BaseMessage(
                role_name=system_message.role_name,
                role_type=system_message.role_type,
                meta_dict=system_message.meta_dict,
                content=system_message.content + tool_instructions,
            )
        else:
            system_message = system_message + tool_instructions

        # When using simulated tool calling, pass tools separately for local execution
        # but don't pass them to ChatAgent (which would send them to the API)
        return ListenChatAgent(
            options.project_id,
            normalized_agent_name,
            system_message,
            model=model,
            tools=tools,  # Pass tools for local execution
            agent_id=agent_id,
            token_limit=resolved_context_size or None,
            summarize_threshold=90,  # Trigger summarization at 90% of token_limit (~14.7k for 16384 context)
            prune_tool_calls_from_memory=prune_tool_calls_from_memory,
            toolkits_to_register_agent=toolkits_to_register_agent,
            enable_snapshot_clean=enable_snapshot_clean,
            stream_accumulate=False,
            support_native_tool_calling=False,  # Enable simulated mode in agent
        )

    return ListenChatAgent(
        options.project_id,
        normalized_agent_name,
        system_message,
        model=model,
        tools=tools,
        agent_id=agent_id,
        token_limit=resolved_context_size or None,
        summarize_threshold=90,  # Trigger summarization at 90% of token_limit
        prune_tool_calls_from_memory=prune_tool_calls_from_memory,
        toolkits_to_register_agent=toolkits_to_register_agent,
        enable_snapshot_clean=enable_snapshot_clean,
        stream_accumulate=False,
        support_native_tool_calling=True,
    )
