

import datetime
import json
import logging
import re

from camel.agents.chat_agent import AsyncStreamingChatAgentResponse
from camel.societies.workforce.prompts import PROCESS_TASK_PROMPT
from camel.societies.workforce.single_agent_worker import (
    SingleAgentWorker as BaseSingleAgentWorker,
)
from camel.societies.workforce.utils import TaskResult
from camel.tasks.task import Task, TaskState, is_task_result_insufficient
from camel.toolkits import FunctionTool
from camel.utils.context_utils import ContextUtility
from colorama import Fore

from app.agent.listen_chat_agent import ListenChatAgent

logger = logging.getLogger("single_agent_worker")


def _salvage_content(response_text: str) -> str | None:
    """Try to extract meaningful content from a response that failed
    TaskResult parsing.

    The model may have produced useful output but formatted it as a raw
    tool-call dict (e.g. ``create_note`` with a long ``content`` field),
    plain Markdown, or malformed JSON.  This function attempts to recover
    that content so the task doesn't fail unnecessarily.

    Returns:
        The extracted content string, or ``None`` if nothing useful found.
    """
    if not response_text or len(response_text.strip()) < 50:
        return None

    text = response_text.strip()

    # 1. If the response is a tool_call for create_note / append_note,
    #    extract the "content" argument value — that's the actual work output.
    tc_match = re.search(
        r'<tool_call>\s*\{.*?"name"\s*:\s*"(?:create_note|append_note)".*?\}\s*</tool_call>',
        text,
        re.DOTALL,
    )
    if tc_match:
        # Try to pull the "content" field from the arguments
        content_match = re.search(
            r'"content"\s*:\s*"((?:[^"\\]|\\.)*)"',
            tc_match.group(0),
        )
        if content_match and len(content_match.group(1)) > 30:
            return content_match.group(1).replace('\\n', '\n').replace('\\"', '"')

    # 2. Try to find a JSON object with a "content" field anywhere
    content_match = re.search(
        r'"content"\s*:\s*"((?:[^"\\]|\\.)*)"',
        text,
    )
    if content_match and len(content_match.group(1)) > 30:
        return content_match.group(1).replace('\\n', '\n').replace('\\"', '"')

    # 3. Strip <tool_call> blocks and see if remaining text is substantial
    cleaned = re.sub(
        r'<tool_call>.*?</tool_call>',
        '',
        text,
        flags=re.DOTALL,
    ).strip()
    if len(cleaned) > 100:
        return cleaned

    # 4. If overall response is substantial prose, return as-is
    if len(text) > 200:
        return text

    return None


def _build_simulated_tool_call_prompt(
    base_task_prompt: str,
    worker_agent: ListenChatAgent,
) -> str:
    """Build a prompt that allows the model to use tools via Hermes
    <tool_call> format before returning the final JSON result.

    When use_structured_output_handler=True, the normal flow sends a prompt
    ending in "CRITICAL: respond ONLY with JSON".  That hard constraint
    prevents the model from emitting the <tool_call> blocks it needs to call
    tools.  This function replaces that prompt with one that:

    1. Lists available tools in the Hermes format.
    2. Instructs the model to call any needed tools FIRST.
    3. Defers the "respond with JSON" requirement to the follow-up turn
       (after tool results are injected by _ahandle_simulated_tool_calls).

    If the agent has no tools, falls back to a plain JSON-only prompt so
    the structured output handler can still parse the response.
    """
    # Collect tool schemas from the agent's registered internal tools
    tool_descriptions = []
    if hasattr(worker_agent, "_internal_tools") and worker_agent._internal_tools:
        for name, tool in worker_agent._internal_tools.items():
            if isinstance(tool, FunctionTool):
                schema = tool.get_openai_tool_schema()
                func = schema.get("function", {})
                tool_descriptions.append({
                    "name": func.get("name", name),
                    "description": func.get("description", ""),
                    "parameters": func.get("parameters", {}),
                })

    if not tool_descriptions:
        # No tools — keep the normal JSON-only instruction
        return base_task_prompt + "\n\n" + (
            "**OUTPUT REQUIREMENTS:**\n"
            "Return a valid JSON object with exactly two fields:\n"
            '- "content" (string): your result\n'
            '- "failed" (boolean): true if you could not complete the task\n\n'
            "**CRITICAL**: Your entire response must be ONLY the JSON object.\n"
            'Example: {"content": "Task completed.", "failed": false}\n'
        )

    # Use compact JSON to save tokens (no indent, no extra spaces)
    tools_json = json.dumps(tool_descriptions, separators=(',', ':'))

    # Build a prompt that FRONT-LOADS the tool calling instructions
    # so small models (like MedGemma 4B) see them early and follow them.
    return (
        f"""You have tools you MUST use to complete this task. Do NOT answer from memory.

AVAILABLE TOOLS:
{tools_json}

HOW TO CALL A TOOL - use this EXACT format (no markdown, no backticks):
<tool_call>
{{"name": "tool_name", "arguments": {{"param1": "value1"}}}}
</tool_call>

RULES:
1. Call ONE tool at a time. Your ENTIRE response must be ONLY the <tool_call> block.
2. After receiving tool results, call the next tool OR return your final answer.
3. You MUST call tools - do NOT skip them or make up results.
4. When you are DONE with ALL tool calls, return ONLY a JSON object (no markdown, no extra text):
   {{"content": "brief 2-3 sentence summary of what you did and found", "failed": false}}
5. Your final JSON response should be a SHORT summary. Any detailed/structured content should be saved in notes via tool calls BEFORE returning the JSON.
6. NEVER return a <tool_call> block and JSON in the same response. Pick ONE.

---
TASK:
{base_task_prompt}
---

Begin by calling your first tool now. Your response must be ONLY a <tool_call> block:"""
    )


    # Use compact JSON to save tokens (no indent, no extra spaces)
    tools_json = json.dumps(tool_descriptions, separators=(',', ':'))
    return (
        base_task_prompt
        + f"""

You have access to the following tools:
{tools_json}

**INSTRUCTIONS:**
1. If you need information from a tool to complete the task, call it using
   the EXACT format below.  Call as many tools as needed, one at a time.
2. After receiving all tool results, return your FINAL answer as a JSON
   object with exactly two fields:
   - "content" (string): your result
   - "failed" (boolean): true if you could not complete the task

**TOOL CALL FORMAT** — copy this exactly, replacing the values:
<tool_call>
{{"name": "tool_name", "arguments": {{"param1": "value1"}}}}
</tool_call>

IMPORTANT RULES:
- You CANNOT view images, files, or external data directly.  Use a tool.
- Do NOT hallucinate or make up results — call the tool instead.
- Do NOT wrap the tool call in markdown code fences (no backticks).
- When calling a tool, your ENTIRE response must be ONLY the <tool_call>
  block shown above (starting with <tool_call> and ending with </tool_call>).
- No extra text before or after the tool call block.
"""
    )


class SingleAgentWorker(BaseSingleAgentWorker):
    def __init__(
        self,
        description: str,
        worker: ListenChatAgent,
        use_agent_pool: bool = True,
        pool_initial_size: int = 1,
        pool_max_size: int = 10,
        auto_scale_pool: bool = True,
        use_structured_output_handler: bool = True,
        context_utility: ContextUtility | None = None,
        enable_workflow_memory: bool = False,
    ) -> None:
        logger.info(
            "Initializing SingleAgentWorker",
            extra={
                "description": description,
                "worker_agent_name": worker.agent_name,
                "use_agent_pool": use_agent_pool,
                "pool_max_size": pool_max_size,
                "enable_workflow_memory": enable_workflow_memory,
            },
        )
        super().__init__(
            description=description,
            worker=worker,
            use_agent_pool=use_agent_pool,
            pool_initial_size=pool_initial_size,
            pool_max_size=pool_max_size,
            auto_scale_pool=auto_scale_pool,
            use_structured_output_handler=use_structured_output_handler,
            context_utility=context_utility,
            enable_workflow_memory=enable_workflow_memory,
        )
        self.worker = worker  # change type hint

    async def _process_task(
        self, task: Task, dependencies: list[Task]
    ) -> TaskState:
        r"""Processes a task with its dependencies using an efficient agent
        management system.

        This method asynchronously processes a given task, considering its
        dependencies, by sending a generated prompt to a worker agent.
        Uses an agent pool for efficiency when enabled, or falls back to
        cloning when pool is disabled.

        Args:
            task (Task): The task to process, which includes necessary details
                like content and type.
            dependencies (List[Task]): Tasks that the given task depends on.

        Returns:
            TaskState: `TaskState.DONE` if processed successfully, otherwise
                `TaskState.FAILED`.
        """
        # Get agent efficiently (from pool or by cloning)
        worker_agent = await self._get_worker_agent()
        worker_agent.process_task_id = task.id  # type: ignore  rewrite line

        logger.info(
            "Starting task processing",
            extra={
                "task_id": task.id,
                "worker_agent_id": worker_agent.agent_id,
                "dependencies_count": len(dependencies),
            },
        )

        response_content = ""
        final_response = None
        try:
            dependency_tasks_info = self._get_dep_tasks_info(dependencies)
            task_content = task.content
            # The coordinator often writes relative filenames (e.g. "file_1.jpg" in the CWD)
            # but the actual toolkits need the absolute path. If we have absolute paths mapped
            # in additional_info, substitute them directly into the task content so the worker
            # agent receives the absolute path.
            if isinstance(task.additional_info, dict):
                for k, v in task.additional_info.items():
                    if isinstance(k, str) and isinstance(v, str) and k in task_content:
                        # Use forward slashes to prevent JSON escaping issues when the LLM generates the tool call
                        safe_v = v.replace("\\", "/")
                        # Replace the filename with the absolute path
                        task_content = task_content.replace(k, safe_v)
            
            prompt = PROCESS_TASK_PROMPT.format(
                content=task_content,
                parent_task_content=task.parent.content if task.parent else "",
                dependency_tasks_info=dependency_tasks_info,
                additional_info=task.additional_info,
            )

            if self.use_structured_output_handler and self.structured_handler:
                # For models using simulated tool calling, use a tool-aware
                # prompt that lets the model call tools BEFORE returning JSON.
                # The normal structured-output prompt ends with "CRITICAL: ONLY
                # JSON", which overrides the tool-call instructions and causes
                # the model to hallucinate answers instead of calling tools.
                if not getattr(worker_agent, "support_native_tool_calling", True):
                    enhanced_prompt = _build_simulated_tool_call_prompt(
                        base_task_prompt=prompt,
                        worker_agent=worker_agent,
                    )
                else:
                    enhanced_prompt = self.structured_handler.generate_structured_prompt(
                        base_prompt=prompt,
                        schema=TaskResult,
                        examples=[
                            {
                                "content": "I have successfully completed the task...",
                                "failed": False,
                            }
                        ],
                        additional_instructions="Ensure you provide a clear "
                        "description of what was done and whether the task "
                        "succeeded or failed.",
                    )
                response = await worker_agent.astep(enhanced_prompt)

                # Handle streaming response
                if isinstance(response, AsyncStreamingChatAgentResponse):
                    # With stream_accumulate=False, we need to accumulate delta content
                    accumulated_content = ""
                    last_chunk = None
                    chunk_count = 0
                    async for chunk in response:
                        chunk_count += 1
                        last_chunk = chunk
                        if chunk.msg and chunk.msg.content:
                            accumulated_content += chunk.msg.content
                    logger.info(
                        f"Streaming complete: {chunk_count} chunks, content_length={len(accumulated_content)}"
                    )
                    response_content = accumulated_content
                    # Store usage info from last chunk for later use
                    response._last_chunk_info = (
                        last_chunk.info if last_chunk else {}
                    )
                else:
                    # Regular ChatAgentResponse
                    response_content = (
                        response.msg.content if response.msg else ""
                    )

                task_result = (
                    self.structured_handler.parse_structured_response(
                        response_text=response_content,
                        schema=TaskResult,
                        fallback_values={
                            "content": "Task processing failed",
                            "failed": True,
                        },
                    )
                )

                # If structured parsing fell back to "Task processing
                # failed" but the response actually contains useful text
                # (e.g. the model returned a tool call as its final
                # response, or plain prose instead of JSON), salvage it.
                if (
                    getattr(task_result, "failed", False)
                    and getattr(task_result, "content", "")
                    == "Task processing failed"
                    and response_content
                    and len(response_content.strip()) > 50
                ):
                    salvaged = _salvage_content(response_content)
                    if salvaged:
                        logger.info(
                            f"Salvaged content (len={len(salvaged)}) "
                            f"from unparseable response for task {task.id}"
                        )
                        task_result = TaskResult(
                            content=salvaged,
                            failed=False,
                        )
            else:
                # Use native structured output if supported
                response = await worker_agent.astep(
                    prompt, response_format=TaskResult
                )

                # Handle streaming response for native output (shouldn't happen now but keep for safety)
                if isinstance(response, AsyncStreamingChatAgentResponse):
                    task_result = None
                    # With stream_accumulate=False, we need to accumulate delta content
                    accumulated_content = ""
                    last_chunk = None
                    async for chunk in response:
                        last_chunk = chunk
                        if chunk.msg:
                            if chunk.msg.content:
                                accumulated_content += chunk.msg.content
                            if chunk.msg.parsed:
                                task_result = chunk.msg.parsed
                    response_content = accumulated_content
                    # Store usage info from last chunk for later use
                    response._last_chunk_info = (
                        last_chunk.info if last_chunk else {}
                    )
                    # If no parsed result found in streaming, create fallback
                    if task_result is None:
                        task_result = TaskResult(
                            content="Failed to parse streaming response",
                            failed=True,
                        )
                else:
                    # Regular ChatAgentResponse
                    task_result = response.msg.parsed
                    response_content = (
                        response.msg.content if response.msg else ""
                    )

            # Get token usage from the response
            if isinstance(response, AsyncStreamingChatAgentResponse):
                # For streaming responses, get info from last chunk captured during iteration
                chunk_info = getattr(response, "_last_chunk_info", {})
                usage_info = chunk_info.get("usage") or chunk_info.get(
                    "token_usage"
                )
            else:
                usage_info = response.info.get("usage") or response.info.get(
                    "token_usage"
                )
            total_tokens = (
                usage_info.get("total_tokens", 0) if usage_info else 0
            )

            # collect conversation from working agent to
            # accumulator for workflow memory
            # Only transfer memory if workflow memory is enabled
            if self.enable_workflow_memory:
                accumulator = self._get_conversation_accumulator()

                # transfer all memory records from working agent to accumulator
                try:
                    # retrieve all context records from the working agent
                    work_records = worker_agent.memory.retrieve()

                    # write these records to the accumulator's memory
                    memory_records = [
                        record.memory_record for record in work_records
                    ]
                    accumulator.memory.write_records(memory_records)

                    logger.debug(
                        f"Transferred {len(memory_records)} memory records to accumulator"
                    )

                except Exception as e:
                    logger.warning(
                        f"Failed to transfer conversation to accumulator: {e}"
                    )

        except Exception as e:
            logger.error(
                f"Error processing task {task.id}: {type(e).__name__}: {e}"
            )
            # Store error information in task result
            task.result = f"{type(e).__name__}: {e!s}"
            return TaskState.FAILED
        finally:
            # Return agent to pool or let it be garbage collected
            await self._return_worker_agent(worker_agent)

        # Populate additional_info with worker attempt details
        if task.additional_info is None:
            task.additional_info = {}

        # Create worker attempt details with descriptive keys
        # Use final_response if available (streaming), otherwise use response
        response_for_info = (
            final_response if final_response is not None else response
        )
        worker_attempt_details = {
            "agent_id": getattr(
                worker_agent, "agent_id", worker_agent.role_name
            ),
            "original_worker_id": getattr(
                self.worker, "agent_id", self.worker.role_name
            ),
            "timestamp": str(datetime.datetime.now()),
            "description": f"Attempt by "
            f"{getattr(worker_agent, 'agent_id', worker_agent.role_name)} "
            f"(from pool/clone of "
            f"{getattr(self.worker, 'agent_id', self.worker.role_name)}) "
            f"to process task: {task.content}",
            "response_content": response_content[:50],
            "tool_calls": str(
                response_for_info.info.get("tool_calls", [])
                if response_for_info and hasattr(response_for_info, "info")
                else []
            )[:50],
            "total_tokens": total_tokens,
        }

        # Store the worker attempt in additional_info
        if "worker_attempts" not in task.additional_info:
            task.additional_info["worker_attempts"] = []
        task.additional_info["worker_attempts"].append(worker_attempt_details)

        # Store the actual token usage for this specific task
        task.additional_info["token_usage"] = {"total_tokens": total_tokens}

        print(f"======\n{Fore.GREEN}Response from {self}:{Fore.RESET}")

        logger.info(f"Response from {self}:")

        if not self.use_structured_output_handler:
            # Handle native structured output parsing
            if task_result is None:
                logger.error(
                    "Error in worker step execution: Invalid task result"
                )
                print(
                    f"{Fore.RED}Error in worker step execution: Invalid task result{Fore.RESET}"
                )
                task_result = TaskResult(
                    content="Failed to generate valid task result.",
                    failed=True,
                )

        color = Fore.RED if task_result.failed else Fore.GREEN  # type: ignore[union-attr]
        print(
            f"\n{color}{task_result.content}{Fore.RESET}\n======",  # type: ignore[union-attr]
        )

        if task_result.failed:  # type: ignore[union-attr]
            logger.error(f"{task_result.content}")  # type: ignore[union-attr]
        else:
            logger.info(f"{task_result.content}")  # type: ignore[union-attr]

        task.result = task_result.content  # type: ignore[union-attr]

        if task_result.failed:  # type: ignore[union-attr]
            return TaskState.FAILED

        if is_task_result_insufficient(task):
            logger.warning(
                f"Task {task.id}: Content validation failed - task marked as failed"
            )
            return TaskState.FAILED
        return TaskState.DONE
