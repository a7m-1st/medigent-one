

import asyncio
import json
import logging
import re
from collections.abc import Callable
from threading import Event
from typing import Any

from camel.agents import ChatAgent
from camel.agents._types import ToolCallRequest
from camel.agents.chat_agent import (
    AsyncStreamingChatAgentResponse,
    StreamingChatAgentResponse,
)
from camel.memories import AgentMemory
from camel.messages import BaseMessage, OpenAIMessage
from camel.messages.conversion.sharegpt.hermes import HermesFunctionFormatter
from camel.models import BaseModelBackend, ModelManager, ModelProcessingError
from camel.responses import ChatAgentResponse
from camel.terminators import ResponseTerminator
from camel.toolkits import FunctionTool, RegisteredAgentToolkit
from camel.types import ModelPlatformType, ModelType
from camel.types.agents import ToolCallingRecord
from pydantic import BaseModel

from app.service.task import (
    Action,
    ActionActivateAgentData,
    ActionActivateToolkitData,
    ActionBudgetNotEnough,
    ActionDeactivateAgentData,
    ActionDeactivateToolkitData,
    get_task_lock,
    set_process_task,
)
from app.utils.event_loop_utils import _schedule_async_task

# Logger for agent tracking
logger = logging.getLogger("agent")


# ─── Module-level helpers for JSON repair in tool call parsing ───────────


def _escape_json_control_chars(raw: str) -> str:
    """Escape unescaped control characters inside JSON string values.

    Small models (MedGemma) often output literal newlines, tabs,
    etc. inside JSON strings instead of the proper ``\\n`` / ``\\t``
    escape sequences.  ``json.loads`` rejects these.

    This function walks the raw JSON text and escapes any ASCII control
    character (0x00–0x1F) that appears inside a quoted string value and
    is not already part of a valid JSON escape (``\\n``, ``\\t``, etc.).
    """
    result = []
    in_string = False
    i = 0
    length = len(raw)
    while i < length:
        ch = raw[i]
        if ch == '"' and (i == 0 or raw[i - 1] != '\\'):
            in_string = not in_string
            result.append(ch)
        elif in_string and ord(ch) < 0x20:
            # Replace literal control char with its JSON escape
            escape_map = {
                '\n': '\\n',
                '\r': '\\r',
                '\t': '\\t',
                '\b': '\\b',
                '\f': '\\f',
            }
            result.append(escape_map.get(ch, f'\\u{ord(ch):04x}'))
        else:
            result.append(ch)
        i += 1
    return ''.join(result)


def _extract_json_object(text: str) -> str | None:
    """Extract the outermost ``{...}`` JSON object using bracket counting.

    If the model appends trailing text after the closing ``}``, this
    function strips it so ``json.loads`` can succeed.

    Returns the extracted substring or ``None`` if no balanced object
    is found.
    """
    start = text.find('{')
    if start == -1:
        return None
    depth = 0
    in_str = False
    for i in range(start, len(text)):
        ch = text[i]
        if ch == '"' and (i == 0 or text[i - 1] != '\\'):
            in_str = not in_str
        elif not in_str:
            if ch == '{':
                depth += 1
            elif ch == '}':
                depth -= 1
                if depth == 0:
                    return text[start:i + 1]
    return None


class ListenChatAgent(ChatAgent):
    def __init__(
        self,
        api_task_id: str,
        agent_name: str,
        system_message: BaseMessage | str | None = None,
        model: (
            BaseModelBackend
            | ModelManager
            | tuple[str, str]
            | str
            | ModelType
            | tuple[ModelPlatformType, ModelType]
            | list[BaseModelBackend]
            | list[str]
            | list[ModelType]
            | list[tuple[str, str]]
            | list[tuple[ModelPlatformType, ModelType]]
            | None
        ) = None,
        memory: AgentMemory | None = None,
        message_window_size: int | None = None,
        token_limit: int | None = None,
        output_language: str | None = None,
        tools: list[FunctionTool | Callable[..., Any]] | None = None,
        toolkits_to_register_agent: list[RegisteredAgentToolkit] | None = None,
        external_tools: (
            list[FunctionTool | Callable[..., Any] | dict[str, Any]] | None
        ) = None,
        response_terminators: list[ResponseTerminator] | None = None,
        scheduling_strategy: str = "round_robin",
        max_iteration: int | None = None,
        agent_id: str | None = None,
        stop_event: Event | None = None,
        tool_execution_timeout: float | None = None,
        mask_tool_output: bool = False,
        pause_event: asyncio.Event | None = None,
        prune_tool_calls_from_memory: bool = False,
        enable_snapshot_clean: bool = False,
        step_timeout: float | None = 1800,  # 30 minutes
        support_native_tool_calling: bool = True,
        **kwargs: Any,
    ) -> None:
        self.support_native_tool_calling = support_native_tool_calling
        self._hermes_formatter = HermesFunctionFormatter() if not support_native_tool_calling else None
        super().__init__(
            system_message=system_message,
            model=model,
            memory=memory,
            message_window_size=message_window_size,
            token_limit=token_limit,
            output_language=output_language,
            tools=tools,
            toolkits_to_register_agent=toolkits_to_register_agent,
            external_tools=external_tools,
            response_terminators=response_terminators,
            scheduling_strategy=scheduling_strategy,
            max_iteration=max_iteration,
            agent_id=agent_id,
            stop_event=stop_event,
            tool_execution_timeout=tool_execution_timeout,
            mask_tool_output=mask_tool_output,
            pause_event=pause_event,
            prune_tool_calls_from_memory=prune_tool_calls_from_memory,
            enable_snapshot_clean=enable_snapshot_clean,
            step_timeout=step_timeout,
            **kwargs,
        )
        self.api_task_id = api_task_id
        self.agent_name = agent_name

    process_task_id: str = ""

    def _get_full_tool_schemas(self):
        """Override: suppress tool schemas for models without native support.

        When simulated tool calling is active, tools are handled via
        text-based Hermes format.  Sending OpenAI-style ``tools`` JSON
        to a model that doesn't support it can cause the model to produce
        ``assistant`` messages with ``tool_calls`` entries, which CAMEL
        then records in memory as ``tool`` role messages.  These break
        strict role-alternation templates.
        """
        if not self.support_native_tool_calling:
            return []
        return super()._get_full_tool_schemas()

    @staticmethod
    def _extract_text(content) -> str:
        """Extract plain text from an OpenAI message content field.

        Content may be a ``str``, a ``list`` of content parts
        (e.g. ``[{"type": "text", "text": "..."}]``), or ``None``.
        """
        if content is None:
            return ""
        if isinstance(content, str):
            return content
        if isinstance(content, list):
            parts = []
            for item in content:
                if isinstance(item, dict) and item.get("type") == "text":
                    parts.append(item.get("text", ""))
                elif isinstance(item, str):
                    parts.append(item)
            return "\n".join(parts)
        return str(content)

    @staticmethod
    def _sanitize_message_roles(
        messages: list[OpenAIMessage],
    ) -> list[OpenAIMessage]:
        """Ensure message roles alternate user/assistant as required by
        models with strict Jinja chat templates (e.g. glm-4, MedGemma).

        Rules applied in order:
        1. Messages with roles other than ``user`` and ``assistant``
           (``system``, ``tool``, ``function``, ``developer``) are
           converted to ``user``.
        2. Any remaining consecutive messages with the same role are
           merged (their ``content`` fields are joined with newlines).
        3. If the sequence ends with a ``user`` message (required by
           many models), nothing extra is added; if it ends with
           ``assistant``, a no-op is fine for most templates.

        The function returns a *new* list; the originals are not mutated.
        """
        if not messages:
            return messages

        extract = ListenChatAgent._extract_text

        # --- Step 1: normalise roles to user / assistant only -------------
        working: list[OpenAIMessage] = []
        for msg in messages:
            copied = dict(msg)  # shallow copy
            role = copied.get("role", "user")
            if role not in ("user", "assistant"):
                copied["role"] = "user"
            # Normalise content to plain string for safe merging
            copied["content"] = extract(copied.get("content"))
            # Strip keys that are invalid for non-assistant/non-tool msgs
            for key in ("tool_calls", "tool_call_id", "name"):
                copied.pop(key, None)
            working.append(copied)

        # --- Step 2: merge consecutive same-role messages -----------------
        merged: list[OpenAIMessage] = [working[0]]
        for msg in working[1:]:
            prev = merged[-1]
            if msg["role"] == prev["role"]:
                # Merge content
                prev_content = prev.get("content", "") or ""
                cur_content = msg.get("content", "") or ""
                prev["content"] = f"{prev_content}\n{cur_content}"
            else:
                merged.append(msg)

        return merged

    @staticmethod
    def _normalize_tool_call_format(content: str) -> str:
        """Normalize tool call syntax variants to the canonical Hermes format.

        The model sometimes wraps the tool call in markdown code fences
        (e.g. ```tool_call\\n{...}\\n```) instead of the required XML
        <tool_call> tags.  This method converts known variants so that
        ``HermesFunctionFormatter.extract_tool_calls`` can parse them.

        Additionally, repairs malformed JSON inside <tool_call> blocks
        (unescaped control characters, trailing text, etc.) that small
        models like MedGemma / GLM-4 tend to produce.

        Currently handles:
        - ```tool_call\\n{...}\\n``` → <tool_call>{...}</tool_call>
        - ```tool_call\\n{...}\\n</tool_call>\\n``` → hybrid format
        - ```xml\\n<tool_call>...</tool_call>\\n``` → unwrapped as-is
        - ```json\\n<tool_call>...</tool_call>\\n``` → unwrapped as-is
        - Plain <tool_call>...</tool_call> → unchanged
        - JSON with unescaped newlines/tabs inside string values → escaped
        """
        # Pattern: hybrid — ```tool_call\n{...}\n</tool_call>\n```
        # The model mixes markdown fences with XML close tags.
        # Must come BEFORE the plain fence pattern to avoid partial matches.
        hybrid_pattern = re.compile(
            r"```tool_call\s*\n(.*?)\n</tool_call>\s*\n?```", re.DOTALL
        )
        def replace_hybrid(m: re.Match) -> str:
            inner = m.group(1).strip()
            return f"<tool_call>\n{inner}\n</tool_call>"

        content = hybrid_pattern.sub(replace_hybrid, content)

        # Pattern: ```tool_call\n{...}\n``` (code fence with 'tool_call' lang)
        fence_pattern = re.compile(
            r"```tool_call\s*\n(.*?)\n```", re.DOTALL
        )
        def replace_fence(m: re.Match) -> str:
            inner = m.group(1).strip()
            return f"<tool_call>\n{inner}\n</tool_call>"

        content = fence_pattern.sub(replace_fence, content)

        # Pattern: ```xml\n...\n``` or ```json\n...\n``` — strip fences
        xml_fence_pattern = re.compile(r"```(?:xml|json)\s*\n(.*?)\n```", re.DOTALL)
        content = xml_fence_pattern.sub(lambda m: m.group(1).strip(), content)

        # --- JSON repair inside <tool_call> blocks ---
        # Small models often emit literal newlines, tabs, or other control
        # characters inside JSON string values (e.g. the "content" field of
        # create_note).  json.loads() rejects these.  We fix them by escaping
        # control characters inside the JSON blob.
        def _repair_tool_call_json(m: re.Match) -> str:
            raw_json = m.group(1).strip()
            # First, try parsing as-is (fast path)
            try:
                json.loads(raw_json)
                return f"<tool_call>\n{raw_json}\n</tool_call>"
            except json.JSONDecodeError:
                pass

            # Repair: escape literal control characters (0x00-0x1F) that are
            # not already part of a valid JSON escape sequence.
            # We walk through the string and only escape control chars that
            # appear inside JSON string values (between unescaped quotes).
            repaired = _escape_json_control_chars(raw_json)

            try:
                json.loads(repaired)
                logger.debug("Repaired JSON in <tool_call> block")
                return f"<tool_call>\n{repaired}\n</tool_call>"
            except json.JSONDecodeError:
                pass

            # Last resort: try to extract just the outer JSON object using
            # a bracket-counting approach, in case there's trailing garbage.
            extracted = _extract_json_object(raw_json)
            if extracted:
                repaired2 = _escape_json_control_chars(extracted)
                try:
                    json.loads(repaired2)
                    logger.debug("Extracted & repaired JSON from <tool_call>")
                    return f"<tool_call>\n{repaired2}\n</tool_call>"
                except json.JSONDecodeError:
                    pass

            # Give up — return as-is so the caller's fallback logic handles it
            logger.warning("Could not repair JSON in <tool_call> block")
            return m.group(0)

        content = re.sub(
            r"<tool_call>\s*(.*?)\s*</tool_call>",
            _repair_tool_call_json,
            content,
            flags=re.DOTALL,
        )

        return content

    def _get_model_response(self, openai_messages, *args, **kwargs):
        """Override to sanitize role alternation for models that require it.

        Only active when ``support_native_tool_calling`` is False
        (i.e. the model uses simulated tool calling and likely has a
        strict Jinja chat template that enforces user/assistant
        alternation, such as MedGemma / GLM-4).
        """
        if not self.support_native_tool_calling:
            before_roles = [m.get("role") for m in openai_messages]
            openai_messages = self._sanitize_message_roles(openai_messages)
            after_roles = [m.get("role") for m in openai_messages]
            logger.debug(
                f"[SANITIZE-SYNC] Agent {self.agent_name} "
                f"before={before_roles} after={after_roles}"
            )
        return super()._get_model_response(openai_messages, *args, **kwargs)

    async def _aget_model_response(self, openai_messages, *args, **kwargs):
        """Async override — same sanitization as the sync variant."""
        if not self.support_native_tool_calling:
            before_roles = [m.get("role") for m in openai_messages]
            openai_messages = self._sanitize_message_roles(openai_messages)
            after_roles = [m.get("role") for m in openai_messages]
            logger.debug(
                f"[SANITIZE-ASYNC] Agent {self.agent_name} "
                f"before={before_roles} after={after_roles}"
            )
        return await super()._aget_model_response(
            openai_messages, *args, **kwargs
        )

    def _send_agent_deactivate(self, message: str, tokens: int) -> None:
        """Send agent deactivation event to the frontend.

        Args:
            message: The accumulated message content
            tokens: The total token count used
        """
        task_lock = get_task_lock(self.api_task_id)
        _schedule_async_task(
            task_lock.put_queue(
                ActionDeactivateAgentData(
                    data={
                        "agent_name": self.agent_name,
                        "process_task_id": self.process_task_id,
                        "agent_id": self.agent_id,
                        "message": message,
                        "tokens": tokens,
                    },
                )
            )
        )

    @staticmethod
    def _extract_tokens(response) -> int:
        """Extract total token count from a response chunk.

        Args:
            response: The response chunk (ChatAgentResponse or similar)

        Returns:
            Total token count or 0 if not available
        """
        if response is None:
            return 0
        usage_info = (
            response.info.get("usage")
            or response.info.get("token_usage")
            or {}
        )
        return usage_info.get("total_tokens", 0)

    def _stream_chunks(self, response_gen):
        """Generator that wraps a streaming response.

        Sends chunks to frontend.

        Args:
            response_gen: The original streaming response generator

        Yields:
            Each chunk from the original generator

        Returns:
            Tuple of (accumulated_content, total_tokens) via
            StopIteration value
        """
        accumulated_content = ""
        last_chunk = None

        try:
            for chunk in response_gen:
                last_chunk = chunk
                if chunk.msg and chunk.msg.content:
                    accumulated_content += chunk.msg.content
                yield chunk
        finally:
            total_tokens = self._extract_tokens(last_chunk)
            self._send_agent_deactivate(accumulated_content, total_tokens)

    async def _astream_chunks(self, response_gen):
        """Async generator that wraps a streaming response.

        Sends chunks to frontend.

        Args:
            response_gen: The original async streaming response generator

        Yields:
            Each chunk from the original generator
        """
        accumulated_content = ""
        last_chunk = None

        try:
            async for chunk in response_gen:
                last_chunk = chunk
                if chunk.msg and chunk.msg.content:
                    delta_content = chunk.msg.content
                    accumulated_content += delta_content
                yield chunk
        finally:
            total_tokens = self._extract_tokens(last_chunk)
            self._send_agent_deactivate(accumulated_content, total_tokens)

    def step(
        self,
        input_message: BaseMessage | str,
        response_format: type[BaseModel] | None = None,
    ) -> ChatAgentResponse | StreamingChatAgentResponse:
        task_lock = get_task_lock(self.api_task_id)
        _schedule_async_task(
            task_lock.put_queue(
                ActionActivateAgentData(
                    data={
                        "agent_name": self.agent_name,
                        "process_task_id": self.process_task_id,
                        "agent_id": self.agent_id,
                        "message": (
                            input_message.content
                            if isinstance(input_message, BaseMessage)
                            else input_message
                        ),
                    },
                )
            )
        )
        error_info = None
        message = None
        res = None
        msg = (
            input_message.content
            if isinstance(input_message, BaseMessage)
            else input_message
        )
        logger.info(
            f"Agent {self.agent_name} starting step with message: {msg}"
        )
        try:
            res = super().step(input_message, response_format)
        except ModelProcessingError as e:
            res = None
            error_info = e
            if "Budget has been exceeded" in str(e):
                message = "Budget has been exceeded"
                logger.warning(f"Agent {self.agent_name} budget exceeded")
                _schedule_async_task(
                    task_lock.put_queue(ActionBudgetNotEnough())
                )
            else:
                message = str(e)
                logger.error(
                    f"Agent {self.agent_name} model processing error: {e}"
                )
            total_tokens = 0
        except Exception as e:
            res = None
            error_info = e
            logger.error(
                f"Agent {self.agent_name} unexpected error in step: {e}",
                exc_info=True,
            )
            message = f"Error processing message: {e!s}"
            total_tokens = 0

        if res is not None:
            if isinstance(res, StreamingChatAgentResponse):
                # Use reusable stream wrapper to send chunks to frontend
                return StreamingChatAgentResponse(self._stream_chunks(res))

            message = res.msg.content if res.msg else ""
            usage_info = (
                res.info.get("usage") or res.info.get("token_usage") or {}
            )
            total_tokens = (
                usage_info.get("total_tokens", 0) if usage_info else 0
            )
            logger.info(
                f"Agent {self.agent_name} completed step, "
                f"tokens used: {total_tokens}"
            )

        assert message is not None

        # Handle simulated tool calling for models without native support
        if (
            not self.support_native_tool_calling
            and res is not None
            and not isinstance(res, StreamingChatAgentResponse)
        ):
            res = self._handle_simulated_tool_calls(res, input_message)
            if res.msg:
                message = res.msg.content

        _schedule_async_task(
            task_lock.put_queue(
                ActionDeactivateAgentData(
                    data={
                        "agent_name": self.agent_name,
                        "process_task_id": self.process_task_id,
                        "agent_id": self.agent_id,
                        "message": message,
                        "tokens": total_tokens,
                    },
                )
            )
        )

        if error_info is not None:
            raise error_info
        assert res is not None
        return res

    def _handle_simulated_tool_calls(
        self,
        response: ChatAgentResponse,
        original_input: BaseMessage | str,
        max_iterations: int = 8,
    ) -> ChatAgentResponse:
        r"""Handle simulated tool calls for models without native tool support.

        This method extracts tool calls from the model's text response using
        Hermes format, executes them locally, and continues the conversation
        until no more tool calls are detected.

        Args:
            response: The initial response from the model.
            original_input: The original user input.
            max_iterations: Maximum number of tool call iterations to prevent
                infinite loops.

        Returns:
            ChatAgentResponse: The final response after all tool calls are
                handled.
        """
        if self._hermes_formatter is None or response.msg is None:
            return response

        current_response = response
        iteration = 0

        while iteration < max_iterations:
            iteration += 1
            content = (
                current_response.msg.content
                if current_response.msg
                else ""
            )

            # Normalize any markdown-fenced tool call variants to canonical
            # <tool_call> XML tags before extraction.
            normalized_content = self._normalize_tool_call_format(content)

            # Extract tool calls from the response text
            tool_calls = self._hermes_formatter.extract_tool_calls(normalized_content)

            if not tool_calls:
                logger.debug(
                    f"Agent {self.agent_name} no simulated tool calls found"
                )
                break

            logger.info(
                f"Agent {self.agent_name} found {len(tool_calls)} "
                f"simulated tool call(s) (iteration {iteration})"
            )

            # Execute tool calls and build results
            tool_results = []
            for tc in tool_calls:
                tool_name = tc.name
                tool_args = tc.arguments

                # Find the tool in our registered tools
                if tool_name in self._internal_tools:
                    tool = self._internal_tools[tool_name]
                    try:
                        # Execute the tool
                        if asyncio.iscoroutinefunction(tool.func):
                            result = asyncio.run(tool(**tool_args))
                        else:
                            result = tool(**tool_args)
                        logger.info(
                            f"Agent {self.agent_name} executed tool "
                            f"'{tool_name}' with result: {result}"
                        )
                    except Exception as e:
                        result = f"Error executing tool '{tool_name}': {e}"
                        logger.error(
                            f"Agent {self.agent_name} tool '{tool_name}' "
                            f"execution failed: {e}"
                        )
                else:
                    result = f"Error: Tool '{tool_name}' not found"
                    logger.warning(
                        f"Agent {self.agent_name} tool '{tool_name}' not found"
                    )

                tool_results.append(
                    self._hermes_formatter.format_tool_response(
                        tool_name, result
                    )
                )

            # Prepare follow-up message with tool results.
            # Remind the model to return the final JSON result now that it
            # has the tool output.
            tool_results_text = "\n".join(tool_results)
            follow_up_message = (
                f"Tool results:\n"
                f"{tool_results_text}\n\n"
                f"Continue with your next step. You have TWO options:\n\n"
                f"OPTION A - Call another tool (if you still have steps remaining):\n"
                f"Respond with ONLY a <tool_call> block, nothing else.\n\n"
                f"OPTION B - You are DONE with all tool calls:\n"
                f"Respond with ONLY this JSON (no markdown, no extra text):\n"
                f'{{"content": "brief 2-3 sentence summary of what you did and found", "failed": false}}\n\n'
                f"CRITICAL: Pick exactly ONE option. Do NOT mix them."
            )

            # Get the next response from the model
            # The parent step() will handle memory management properly
            logger.info(
                f"Agent {self.agent_name} getting follow-up response "
                f"after tool execution"
            )
            current_response = super().step(follow_up_message)

        if iteration >= max_iterations:
            logger.warning(
                f"Agent {self.agent_name} reached max iterations "
                f"({max_iterations}) for simulated tool calls"
            )

        return current_response

    async def astep(
        self,
        input_message: BaseMessage | str,
        response_format: type[BaseModel] | None = None,
    ) -> ChatAgentResponse | AsyncStreamingChatAgentResponse:
        task_lock = get_task_lock(self.api_task_id)
        await task_lock.put_queue(
            ActionActivateAgentData(
                action=Action.activate_agent,
                data={
                    "agent_name": self.agent_name,
                    "process_task_id": self.process_task_id,
                    "agent_id": self.agent_id,
                    "message": (
                        input_message.content
                        if isinstance(input_message, BaseMessage)
                        else input_message
                    ),
                },
            )
        )

        error_info = None
        message = None
        res = None
        msg = (
            input_message.content
            if isinstance(input_message, BaseMessage)
            else input_message
        )
        logger.debug(
            f"Agent {self.agent_name} starting async step with message: {msg}"
        )

        try:
            res = await super().astep(input_message, response_format)
            if isinstance(res, AsyncStreamingChatAgentResponse):
                # Use reusable async stream wrapper to send chunks to frontend
                return AsyncStreamingChatAgentResponse(
                    self._astream_chunks(res)
                )
        except ModelProcessingError as e:
            res = None
            error_info = e
            if "Budget has been exceeded" in str(e):
                message = "Budget has been exceeded"
                logger.warning(f"Agent {self.agent_name} budget exceeded")
                asyncio.create_task(
                    task_lock.put_queue(ActionBudgetNotEnough())
                )
            else:
                message = str(e)
                logger.error(
                    f"Agent {self.agent_name} model processing error: {e}"
                )
            total_tokens = 0
        except Exception as e:
            res = None
            error_info = e
            logger.error(
                f"Agent {self.agent_name} unexpected error in async step: {e}",
                exc_info=True,
            )
            message = f"Error processing message: {e!s}"
            total_tokens = 0

        # For non-streaming responses, extract message and tokens from response
        if res is not None and not isinstance(
            res, AsyncStreamingChatAgentResponse
        ):
            message = res.msg.content if res.msg else ""
            usage_info = (
                res.info.get("usage") or res.info.get("token_usage") or {}
            )
            total_tokens = (
                usage_info.get("total_tokens", 0) if usage_info else 0
            )
            logger.info(
                f"Agent {self.agent_name} completed step, "
                f"tokens used: {total_tokens}"
            )

            # Handle simulated tool calling for models without native support
            if not self.support_native_tool_calling:
                res = await self._ahandle_simulated_tool_calls(
                    res, input_message
                )
                if res.msg:
                    message = res.msg.content

        # Send deactivation for all non-streaming cases (success or error)
        # Streaming responses handle deactivation in _astream_chunks
        assert message is not None

        asyncio.create_task(
            task_lock.put_queue(
                ActionDeactivateAgentData(
                    data={
                        "agent_name": self.agent_name,
                        "process_task_id": self.process_task_id,
                        "agent_id": self.agent_id,
                        "message": message,
                        "tokens": total_tokens,
                    },
                )
            )
        )

        if error_info is not None:
            raise error_info
        assert res is not None
        return res

    async def _ahandle_simulated_tool_calls(
        self,
        response: ChatAgentResponse,
        original_input: BaseMessage | str,
        max_iterations: int = 8,
    ) -> ChatAgentResponse:
        r"""Async version of _handle_simulated_tool_calls.

        This method extracts tool calls from the model's text response using
        Hermes format, executes them locally, and continues the conversation
        until no more tool calls are detected.

        Args:
            response: The initial response from the model.
            original_input: The original user input.
            max_iterations: Maximum number of tool call iterations to prevent
                infinite loops.

        Returns:
            ChatAgentResponse: The final response after all tool calls are
                handled.
        """
        if self._hermes_formatter is None or response.msg is None:
            return response

        current_response = response
        iteration = 0

        while iteration < max_iterations:
            iteration += 1
            content = (
                current_response.msg.content
                if current_response.msg
                else ""
            )

            # Normalize any markdown-fenced tool call variants to canonical
            # <tool_call> XML tags before extraction.
            normalized_content = self._normalize_tool_call_format(content)

            # Extract tool calls from the response text
            tool_calls = self._hermes_formatter.extract_tool_calls(normalized_content)

            if not tool_calls:
                logger.debug(
                    f"Agent {self.agent_name} no simulated tool calls found"
                )
                break

            logger.info(
                f"Agent {self.agent_name} found {len(tool_calls)} "
                f"simulated tool call(s) (iteration {iteration})"
            )

            # Execute tool calls and build results
            tool_results = []
            for tc in tool_calls:
                tool_name = tc.name
                tool_args = tc.arguments

                # Find the tool in our registered tools
                if tool_name in self._internal_tools:
                    tool = self._internal_tools[tool_name]
                    try:
                        # Execute the tool via the correct async path to avoid
                        # the "async tool called synchronously" RuntimeWarning.
                        # FunctionTool.async_call() is the proper awaitable
                        # entry-point; fall back to sync call for non-async tools.
                        if asyncio.iscoroutinefunction(tool.func) or getattr(tool, "is_async", False):
                            result = await tool.async_call(**tool_args)
                        else:
                            result = tool(**tool_args)
                            if asyncio.iscoroutine(result):
                                result = await result
                        logger.info(
                            f"Agent {self.agent_name} executed tool "
                            f"'{tool_name}' with result: {result}"
                        )
                    except Exception as e:
                        result = f"Error executing tool '{tool_name}': {e}"
                        logger.error(
                            f"Agent {self.agent_name} tool '{tool_name}' "
                            f"execution failed: {e}"
                        )
                else:
                    result = f"Error: Tool '{tool_name}' not found"
                    logger.warning(
                        f"Agent {self.agent_name} tool '{tool_name}' not found"
                    )

                tool_results.append(
                    self._hermes_formatter.format_tool_response(
                        tool_name, result
                    )
                )

            # Prepare follow-up message with tool results.
            # Crucially, remind the model to return the final JSON result
            # now that it has the tool output — otherwise it may just
            # describe the results in plain prose.
            tool_results_text = "\n".join(tool_results)
            follow_up_message = (
                f"Tool results:\n"
                f"{tool_results_text}\n\n"
                f"Continue with your next step. You have TWO options:\n\n"
                f"OPTION A - Call another tool (if you still have steps remaining):\n"
                f"Respond with ONLY a <tool_call> block, nothing else.\n\n"
                f"OPTION B - You are DONE with all tool calls:\n"
                f"Respond with ONLY this JSON (no markdown, no extra text):\n"
                f'{{"content": "brief 2-3 sentence summary of what you did and found", "failed": false}}\n\n'
                f"CRITICAL: Pick exactly ONE option. Do NOT mix them."
            )

            # Get the next response from the model
            # The parent astep() will handle memory management properly
            logger.info(
                f"Agent {self.agent_name} getting follow-up response "
                f"after tool execution"
            )
            current_response = await super().astep(follow_up_message)

        if iteration >= max_iterations:
            logger.warning(
                f"Agent {self.agent_name} reached max iterations "
                f"({max_iterations}) for simulated tool calls"
            )

        return current_response

    def _execute_tool(
        self, tool_call_request: ToolCallRequest
    ) -> ToolCallingRecord:
        func_name = tool_call_request.tool_name
        tool: FunctionTool = self._internal_tools[func_name]
        # Route async functions to async execution
        # even if they have __wrapped__
        if asyncio.iscoroutinefunction(tool.func):
            # For async functions, we need to use the async execution path
            return asyncio.run(self._aexecute_tool(tool_call_request))

        # Handle all sync tools ourselves to maintain ContextVar context
        args = tool_call_request.args
        tool_call_id = tool_call_request.tool_call_id

        # Check if tool is wrapped by @listen_toolkit decorator
        # If so, the decorator will handle activate/deactivate events
        # TODO: Refactor - current marker detection is a workaround.
        # The proper fix is to unify event sending:
        # remove activate/deactivate from @listen_toolkit, only send here
        has_listen_decorator = getattr(tool.func, "__listen_toolkit__", False)

        try:
            task_lock = get_task_lock(self.api_task_id)

            toolkit_name = (
                tool._toolkit_name
                if hasattr(tool, "_toolkit_name")
                else "mcp_toolkit"
            )
            logger.debug(
                f"Agent {self.agent_name} executing tool: "
                f"{func_name} from toolkit: {toolkit_name} "
                f"with args: {json.dumps(args, ensure_ascii=False)}"
            )

            # Only send activate event if tool is
            # NOT wrapped by @listen_toolkit
            if not has_listen_decorator:
                _schedule_async_task(
                    task_lock.put_queue(
                        ActionActivateToolkitData(
                            data={
                                "agent_name": self.agent_name,
                                "process_task_id": self.process_task_id,
                                "toolkit_name": toolkit_name,
                                "method_name": func_name,
                                "message": json.dumps(
                                    args, ensure_ascii=False
                                ),
                            },
                        )
                    )
                )
            # Set process_task context for all tool executions
            with set_process_task(self.process_task_id):
                raw_result = tool(**args)
            logger.debug(f"Tool {func_name} executed successfully")
            if self.mask_tool_output:
                self._secure_result_store[tool_call_id] = raw_result
                result = (
                    "[The tool has been executed successfully, but the output"
                    " from the tool is masked. You can move forward]"
                )
                mask_flag = True
            else:
                result = raw_result
                mask_flag = False
            # Prepare result message with truncation
            if isinstance(result, str):
                result_msg = result
            else:
                result_str = repr(result)
                MAX_RESULT_LENGTH = 500
                if len(result_str) > MAX_RESULT_LENGTH:
                    result_msg = result_str[:MAX_RESULT_LENGTH] + (
                        f"... (truncated, total length: "
                        f"{len(result_str)} chars)"
                    )
                else:
                    result_msg = result_str

            # Only send deactivate event if tool is
            # NOT wrapped by @listen_toolkit
            if not has_listen_decorator:
                _schedule_async_task(
                    task_lock.put_queue(
                        ActionDeactivateToolkitData(
                            data={
                                "agent_name": self.agent_name,
                                "process_task_id": self.process_task_id,
                                "toolkit_name": toolkit_name,
                                "method_name": func_name,
                                "message": result_msg,
                            },
                        )
                    )
                )
        except Exception as e:
            # Capture the error message to prevent framework crash
            error_msg = f"Error executing tool '{func_name}': {e!s}"
            result = f"Tool execution failed: {error_msg}"
            mask_flag = False
            logger.error(
                f"Tool execution failed for {func_name}: {e}", exc_info=True
            )

        return self._record_tool_calling(
            func_name,
            args,
            result,
            tool_call_id,
            mask_output=mask_flag,
            extra_content=tool_call_request.extra_content,
        )

    async def _aexecute_tool(
        self, tool_call_request: ToolCallRequest
    ) -> ToolCallingRecord:
        func_name = tool_call_request.tool_name
        tool: FunctionTool = self._internal_tools[func_name]

        # Always handle tool execution ourselves to maintain ContextVar context
        args = tool_call_request.args
        tool_call_id = tool_call_request.tool_call_id
        task_lock = get_task_lock(self.api_task_id)

        # Try to get the real toolkit name
        toolkit_name = None

        # Method 1: Check _toolkit_name attribute
        if hasattr(tool, "_toolkit_name"):
            toolkit_name = tool._toolkit_name

        # Method 2: For MCP tools, check if func has __self__
        # (the toolkit instance)
        if (
            not toolkit_name
            and hasattr(tool, "func")
            and hasattr(tool.func, "__self__")
        ):
            toolkit_instance = tool.func.__self__
            if hasattr(toolkit_instance, "toolkit_name") and callable(
                toolkit_instance.toolkit_name
            ):
                toolkit_name = toolkit_instance.toolkit_name()

        # Method 3: Check if tool.func is a bound method with toolkit
        if not toolkit_name and hasattr(tool, "func"):
            if hasattr(tool.func, "func") and hasattr(
                tool.func.func, "__self__"
            ):
                toolkit_instance = tool.func.func.__self__
                if hasattr(toolkit_instance, "toolkit_name") and callable(
                    toolkit_instance.toolkit_name
                ):
                    toolkit_name = toolkit_instance.toolkit_name()

        # Default fallback
        if not toolkit_name:
            toolkit_name = "mcp_toolkit"

        logger.info(
            f"Agent {self.agent_name} executing async tool: {func_name} "
            f"from toolkit: {toolkit_name} "
            f"with args: {json.dumps(args, ensure_ascii=False)}"
        )

        # Check if tool is wrapped by @listen_toolkit decorator
        # If so, the decorator will handle activate/deactivate events
        has_listen_decorator = getattr(tool.func, "__listen_toolkit__", False)

        # Only send activate event if tool is NOT wrapped by @listen_toolkit
        if not has_listen_decorator:
            await task_lock.put_queue(
                ActionActivateToolkitData(
                    data={
                        "agent_name": self.agent_name,
                        "process_task_id": self.process_task_id,
                        "toolkit_name": toolkit_name,
                        "method_name": func_name,
                        "message": json.dumps(args, ensure_ascii=False),
                    },
                )
            )
        try:
            # Set process_task context for all tool executions
            with set_process_task(self.process_task_id):
                # Try different invocation paths in order of preference
                if hasattr(tool, "func") and hasattr(tool.func, "async_call"):
                    # Case: FunctionTool wrapping an MCP tool
                    # Check if wrapped tool is sync to avoid run_in_executor
                    if hasattr(tool, "is_async") and not tool.is_async:
                        # Sync tool: call directly to preserve ContextVar
                        result = tool(**args)
                        if asyncio.iscoroutine(result):
                            result = await result
                    else:
                        # Async tool: use async_call
                        result = await tool.func.async_call(**args)

                elif hasattr(tool, "async_call") and callable(tool.async_call):
                    # Case: tool itself has async_call
                    # Check if this is a sync tool to avoid run_in_executor
                    # (which breaks ContextVar)
                    if hasattr(tool, "is_async") and not tool.is_async:
                        # Sync tool: call directly to preserve ContextVar
                        # in same thread
                        result = tool(**args)
                        # Handle case where sync call returns a coroutine
                        if asyncio.iscoroutine(result):
                            result = await result
                    else:
                        # Async tool: use async_call
                        result = await tool.async_call(**args)

                elif hasattr(tool, "func") and asyncio.iscoroutinefunction(
                    tool.func
                ):
                    # Case: tool wraps a direct async function
                    result = await tool.func(**args)

                elif asyncio.iscoroutinefunction(tool):
                    # Case: tool is itself a coroutine function
                    result = await tool(**args)

                else:
                    # Fallback: sync call - call directly in current context
                    # DO NOT use run_in_executor to preserve ContextVar
                    result = tool(**args)
                    # Handle case where synchronous call returns a coroutine
                    if asyncio.iscoroutine(result):
                        result = await result

        except Exception as e:
            # Capture the error message to prevent framework crash
            error_msg = f"Error executing async tool '{func_name}': {e!s}"
            result = {"error": error_msg}
            logger.error(
                f"Async tool execution failed for {func_name}: {e}",
                exc_info=True,
            )

        # Prepare result message with truncation
        if isinstance(result, str):
            result_msg = result
        else:
            result_str = repr(result)
            MAX_RESULT_LENGTH = 500
            if len(result_str) > MAX_RESULT_LENGTH:
                result_msg = (
                    result_str[:MAX_RESULT_LENGTH]
                    + f"... (truncated, total length: {len(result_str)} chars)"
                )
            else:
                result_msg = result_str

        # Only send deactivate event if tool is NOT wrapped by @listen_toolkit
        if not has_listen_decorator:
            await task_lock.put_queue(
                ActionDeactivateToolkitData(
                    data={
                        "agent_name": self.agent_name,
                        "process_task_id": self.process_task_id,
                        "toolkit_name": toolkit_name,
                        "method_name": func_name,
                        "message": result_msg,
                    },
                )
            )
        return self._record_tool_calling(
            func_name,
            args,
            result,
            tool_call_id,
            extra_content=tool_call_request.extra_content,
        )

    def clone(self, with_memory: bool = False) -> ChatAgent:
        """Please see super.clone()"""
        system_message = None if with_memory else self._original_system_message

        # Clone tools and collect toolkits that need registration
        cloned_tools, toolkits_to_register = self._clone_tools()

        new_agent = ListenChatAgent(
            api_task_id=self.api_task_id,
            agent_name=self.agent_name,
            system_message=system_message,
            model=self.model_backend.models,  # Pass the existing model_backend
            memory=None,  # clone memory later
            message_window_size=getattr(self.memory, "window_size", None),
            token_limit=getattr(
                self.memory.get_context_creator(), "token_limit", None
            ),
            summarize_threshold=self.summarize_threshold,
            output_language=self._output_language,
            tools=cloned_tools,
            toolkits_to_register_agent=toolkits_to_register,
            external_tools=[
                schema for schema in self._external_tool_schemas.values()
            ],
            response_terminators=self.response_terminators,
            scheduling_strategy=self.model_backend.scheduling_strategy.__name__,
            max_iteration=self.max_iteration,
            stop_event=self.stop_event,
            tool_execution_timeout=self.tool_execution_timeout,
            mask_tool_output=self.mask_tool_output,
            pause_event=self.pause_event,
            prune_tool_calls_from_memory=self.prune_tool_calls_from_memory,
            enable_snapshot_clean=self._enable_snapshot_clean,
            step_timeout=self.step_timeout,
            stream_accumulate=self.stream_accumulate,
            support_native_tool_calling=self.support_native_tool_calling,
        )

        new_agent.process_task_id = self.process_task_id

        # Copy memory if requested
        if with_memory:
            # Get all records from the current memory
            context_records = self.memory.retrieve()
            # Write them to the new agent's memory
            for context_record in context_records:
                new_agent.memory.write_record(context_record.memory_record)

        return new_agent
