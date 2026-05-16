

import asyncio
import copy
import logging
from collections.abc import Generator

from camel.agents import ChatAgent
from camel.societies.workforce.base import BaseNode
from camel.societies.workforce.events import (
    TaskAssignedEvent,
    TaskCompletedEvent,
    TaskCreatedEvent,
    TaskFailedEvent,
    WorkerCreatedEvent,
)
from camel.societies.workforce.prompts import TASK_DECOMPOSE_PROMPT
from camel.societies.workforce.task_channel import TaskChannel
from camel.societies.workforce.utils import (
    FailureHandlingConfig,
    TaskAnalysisResult,
    TaskAssignResult,
)
from camel.societies.workforce.workforce import (
    DEFAULT_WORKER_POOL_SIZE,
    Workforce as BaseWorkforce,
    WorkforceState,
)
from camel.societies.workforce.workforce_metrics import WorkforceMetrics
from camel.tasks.task import (
    Task,
    TaskState,
    is_task_result_insufficient,
    validate_task_content,
)

# Feature 4 — batch drain window in seconds.  After one returned task
# arrives we wait up to this long for additional results before processing.
_BATCH_DRAIN_WINDOW: float = 0.15

from app.agent.listen_chat_agent import ListenChatAgent
from app.component import code
from app.exception.exception import UserException
from app.model.chat import Chat
from app.service.task import (
    Action,
    ActionAssignTaskData,
    ActionEndData,
    ActionTaskStateData,
    ActionTimeoutData,
    Agents,
    get_camel_task,
    get_task_lock,
)
from app.utils.single_agent_worker import SingleAgentWorker

# Type hint imports for optional MCP agent update
from typing import TYPE_CHECKING
if TYPE_CHECKING:
    from app.agent.factory.mcp import mcp_agent as mcp_agent_func

logger = logging.getLogger("workforce")

_ANALYZE_TASK_MAX_RETRIES = 3


class Workforce(BaseWorkforce):
    def __init__(
        self,
        api_task_id: str,
        description: str,
        children: list[BaseNode] | None = None,
        coordinator_agent: ChatAgent | None = None,
        task_agent: ChatAgent | None = None,
        new_worker_agent: ChatAgent | None = None,
        graceful_shutdown_timeout: float = 3,
        share_memory: bool = False,
        use_structured_output_handler: bool = True,
        support_native_tool_calling: bool = True,
        max_retries: int = 3,
    ) -> None:
        self.api_task_id = api_task_id
        self._support_native_tool_calling = support_native_tool_calling
        self._preempted = False  # Feature 5: suppress ActionEndData on preemption
        self._mcp_config_hash: str | None = None  # Track MCP config for dynamic updates
        logger.info("=" * 80)
        logger.info(
            "🏭 [WF-LIFECYCLE] Workforce.__init__ STARTED",
            extra={"api_task_id": api_task_id},
        )
        logger.info(f"[WF-LIFECYCLE] Workforce id will be: {id(self)}")
        logger.info(
            f"[WF-LIFECYCLE] Init params: graceful_shutdown_timeout="
            f"{graceful_shutdown_timeout}, share_memory={share_memory}"
        )
        logger.info("=" * 80)
        super().__init__(
            description=description,
            children=children,
            coordinator_agent=coordinator_agent,
            task_agent=task_agent,
            new_worker_agent=new_worker_agent,
            graceful_shutdown_timeout=graceful_shutdown_timeout,
            share_memory=share_memory,
            use_structured_output_handler=use_structured_output_handler,
            task_timeout_seconds=3600,  # 60 minutes
            failure_handling_config=FailureHandlingConfig(
                max_retries=max_retries,
                enabled_strategies=["retry", "replan"],
                halt_on_max_retries=False,  # Don't halt entire workforce on single task failure
            ),
        )
        self.task_agent.stream_accumulate = True
        self.task_agent._stream_accumulate_explicit = True

        # --- Monkey-patch role sanitization onto coordinator & task agents ---
        # The base Workforce.__init__ reconstructs these as plain ChatAgent
        # instances (discarding the ListenChatAgent we passed in).  Plain
        # ChatAgent doesn't have our _sanitize_message_roles override, so
        # messages sent by the coordinator/task agent can violate strict
        # role-alternation templates (e.g. MedGemma/GLM-4).  We patch
        # the response methods on these instances to apply sanitization.
        # Only needed when the model doesn't support native tool calling
        # (i.e. it uses a strict Jinja chat template).
        if not support_native_tool_calling:
            self._patch_agent_sanitization(
                self.coordinator_agent, support_native_tool_calling
            )
            self._patch_agent_sanitization(
                self.task_agent, support_native_tool_calling
            )

        logger.info(
            f"[WF-LIFECYCLE] Workforce.__init__ COMPLETED, id={id(self)}"
        )

    @staticmethod
    def _patch_agent_sanitization(
        agent: ChatAgent,
        support_native_tool_calling: bool = True,
    ) -> None:
        """Monkey-patch role sanitization onto a plain ``ChatAgent``.

        The base ``Workforce.__init__`` reconstructs ``coordinator_agent``
        and ``task_agent`` as plain ``ChatAgent`` instances, discarding
        any ``ListenChatAgent`` subclass (and its sanitization overrides).
        This method patches the sync and async ``_get_model_response`` /
        ``_aget_model_response`` methods on the *instance* so that
        ``_sanitize_message_roles`` is applied before every API call.

        When ``support_native_tool_calling`` is False, also patches
        ``_get_full_tool_schemas`` to return ``[]`` so the model backend
        doesn't send tool schemas the model can't handle.
        """
        sanitize = ListenChatAgent._sanitize_message_roles
        original_sync = agent._get_model_response
        original_async = agent._aget_model_response

        def patched_sync(openai_messages, *args, **kwargs):
            openai_messages = sanitize(openai_messages)
            return original_sync(openai_messages, *args, **kwargs)

        async def patched_async(openai_messages, *args, **kwargs):
            openai_messages = sanitize(openai_messages)
            return await original_async(openai_messages, *args, **kwargs)

        # Assign directly on the instance — Python will find these
        # before looking up the class method via MRO.
        agent._get_model_response = patched_sync
        agent._aget_model_response = patched_async

        # Suppress tool schemas for models without native support
        if not support_native_tool_calling:
            agent._get_full_tool_schemas = lambda: []

        logger.debug(
            f"[WF-PATCH] Patched role sanitization onto "
            f"{agent.__class__.__name__} (id={id(agent)}, "
            f"native_tools={support_native_tool_calling})"
        )

    def _analyze_task(
        self,
        task: Task,
        *,
        for_failure: bool,
        error_message: str | None = None,
    ) -> TaskAnalysisResult:
        """Override to retry when the base class returns None.

        The base class can return None when the LLM fails to produce
        valid structured output. We retry up to _ANALYZE_TASK_MAX_RETRIES
        times before falling back.
        
        For MedGemma and other specialized medical models, we are more lenient
        with quality scoring since the structured output format may vary.
        """
        last_exception: Exception | None = None

        for attempt in range(1, _ANALYZE_TASK_MAX_RETRIES + 1):
            try:
                result = super()._analyze_task(
                    task,
                    for_failure=for_failure,
                    error_message=error_message,
                )

                if result is not None:
                    # Be more lenient for radiologist tasks with MedGemma
                    # Accept results with lower quality if they have content
                    if (
                        not for_failure
                        and result.quality_score is not None
                        and result.quality_score < 70
                        and task.result
                        and len(str(task.result)) > 100
                    ):
                        # Task has substantial content, bump quality score
                        logger.info(
                            f"[WF-QUALITY] Boosting quality score from "
                            f"{result.quality_score} to 75 for task with "
                            f"substantial content (len={len(str(task.result))})"
                        )
                        result.quality_score = 75
                    return result

                logger.warning(
                    f"[WF-RETRY] _analyze_task returned None "
                    f"(attempt {attempt}/{_ANALYZE_TASK_MAX_RETRIES}), "
                    f"task_id={task.id}, for_failure={for_failure}"
                )

            except Exception as e:
                last_exception = e
                logger.warning(
                    f"[WF-RETRY] _analyze_task raised "
                    f"{type(e).__name__}: {e} "
                    f"(attempt {attempt}/{_ANALYZE_TASK_MAX_RETRIES}), "
                    f"task_id={task.id}, for_failure={for_failure}"
                )

        # All retries exhausted
        logger.error(
            f"[WF-BUG] _analyze_task failed after "
            f"{_ANALYZE_TASK_MAX_RETRIES} retries, "
            f"task_id={task.id}, for_failure={for_failure}"
        )

        if for_failure:
            # Task already failed + analysis failed — raise to halt
            raise RuntimeError(
                f"_analyze_task returned None after "
                f"{_ANALYZE_TASK_MAX_RETRIES} retries for "
                f"failed task {task.id}"
            ) from last_exception

        # Quality evaluation failed — accept the task result as-is
        return TaskAnalysisResult(
            reasoning=(
                f"_analyze_task returned None after "
                f"{_ANALYZE_TASK_MAX_RETRIES} retries, "
                f"accepting task result"
            ),
            quality_score=80,
        )

    def workforce_make_sub_tasks(
        self,
        task: Task,
        coordinator_context: str = "",
        on_stream_batch=None,
        on_stream_text=None,
    ):
        """Split process_task method to workforce_make_sub_tasks
        and workforce_start method.

        Args:
            task: The main task to decompose
            coordinator_context: Optional context ONLY for coordinator
                agent during decomposition. This context will NOT
                be passed to subtasks or worker agents.
            on_stream_batch: Optional callback for streaming
                batches signature (List[Task], bool)
            on_stream_text: Optional callback for raw
                streaming text chunks
        """
        logger.debug(
            "[DECOMPOSE] workforce_make_sub_tasks called",
            extra={"api_task_id": self.api_task_id, "task_id": task.id},
        )

        if not validate_task_content(task.content, task.id):
            task.state = TaskState.FAILED
            task.result = "Task failed: Invalid or empty content provided"
            logger.warning(
                "[DECOMPOSE] Task rejected: Invalid or empty content",
                extra={
                    "task_id": task.id,
                    "content_preview": task.content[:50] + "..."
                    if len(task.content) > 50
                    else task.content,
                },
            )
            raise UserException(code.error, task.result)

        self.reset()
        self._task = task
        self.set_channel(TaskChannel())
        self._state = WorkforceState.RUNNING
        task.state = TaskState.OPEN
        subtasks = asyncio.run(
            self.handle_decompose_append_task(
                task,
                reset=False,
                coordinator_context=coordinator_context,
                on_stream_batch=on_stream_batch,
                on_stream_text=on_stream_text,
            )
        )

        logger.info(
            "[DECOMPOSE] Task decomposition completed",
            extra={
                "api_task_id": self.api_task_id,
                "task_id": task.id,
                "subtasks_count": len(subtasks),
            },
        )
        return subtasks

    async def workforce_start(self, subtasks: list[Task]):
        """start the workforce"""
        logger.debug(
            (
                f"[WF-LIFECYCLE] workforce_start called with "
                f"{len(subtasks)} subtasks"
            ),
            extra={"api_task_id": self.api_task_id},
        )
        # Clear existing pending tasks to use the user-edited task list
        # (tasks may have been added during decomposition before user edits)
        self._pending_tasks.clear()

        self._pending_tasks.extendleft(reversed(subtasks))
        self.save_snapshot("Initial task decomposition")

        try:
            await self.start()
        except Exception as e:
            logger.error(
                f"[WF-LIFECYCLE] Error in workforce execution: {e}",
                extra={"api_task_id": self.api_task_id, "error": str(e)},
                exc_info=True,
            )
            self._state = WorkforceState.STOPPED
            raise
        finally:
            if self._state != WorkforceState.STOPPED:
                self._state = WorkforceState.IDLE

    def _decompose_task(self, task: Task, stream_callback=None):
        """Decompose task with optional streaming text callback."""
        decompose_prompt = str(
            TASK_DECOMPOSE_PROMPT.format(
                content=task.content,
                child_nodes_info=self._get_child_nodes_info(),
                additional_info=task.additional_info,
            )
        )

        self.task_agent.reset()
        result = task.decompose(
            self.task_agent, decompose_prompt, stream_callback=stream_callback
        )

        if isinstance(result, Generator):

            def streaming_with_dependencies():
                all_subtasks = []
                for new_tasks in result:
                    all_subtasks.extend(new_tasks)
                    if new_tasks:
                        self._update_dependencies_for_decomposition(
                            task, all_subtasks
                        )
                    yield new_tasks

            return streaming_with_dependencies()
        else:
            subtasks = result
            if subtasks:
                self._update_dependencies_for_decomposition(task, subtasks)
            return subtasks

    async def handle_decompose_append_task(
        self,
        task: Task,
        reset: bool = True,
        coordinator_context: str = "",
        on_stream_batch=None,
        on_stream_text=None,
    ) -> list[Task]:
        """Override to support coordinator_context parameter.
        Handle task decomposition and validation,
        then append to pending tasks.

        Args:
            task: The task to be processed
            reset: Should trigger workforce reset
                (Workforce must not be running)
            coordinator_context: Optional context ONLY for
                coordinator during decomposition
            on_stream_batch: Optional callback for streaming
                batches signature (List[Task], bool)
            on_stream_text: Optional callback for raw streaming text chunks

        Returns:
            List[Task]: The decomposed subtasks or the original task
        """
        logger.debug(
            f"[DECOMPOSE] handle_decompose_append_task called, "
            f"task_id={task.id}, reset={reset}"
        )

        if not validate_task_content(task.content, task.id):
            task.state = TaskState.FAILED
            task.result = "Task failed: Invalid or empty content provided"
            logger.warning(
                f"[DECOMPOSE] Task {task.id} rejected: "
                f"Invalid or empty content. "
                f"Content preview: '{task.content}'"
            )
            return [task]

        if reset and self._state != WorkforceState.RUNNING:
            self.reset()

        self._task = task
        task.state = TaskState.FAILED

        if coordinator_context:
            original_content = task.content
            task_with_context = (
                coordinator_context
                + "\n=== CURRENT TASK ===\n"
                + original_content
            )
            task.content = task_with_context
            subtasks_result = self._decompose_task(
                task, stream_callback=on_stream_text
            )
            task.content = original_content
        else:
            subtasks_result = self._decompose_task(
                task, stream_callback=on_stream_text
            )

        if isinstance(subtasks_result, Generator):
            subtasks = []
            for new_tasks in subtasks_result:
                subtasks.extend(new_tasks)
                if on_stream_batch:
                    try:
                        on_stream_batch(new_tasks, False)
                    except Exception as e:
                        logger.warning(f"Streaming callback failed: {e}")

            # After consuming the generator, check task.subtasks
            # for final result as fallback
            if not subtasks and task.subtasks:
                subtasks = task.subtasks
        else:
            subtasks = subtasks_result

        if subtasks:
            # Deep-copy additional_info for each subtask so that
            # mutations during worker execution (e.g. worker_attempts)
            # do not leak back into the parent task's dict.
            for st in subtasks:
                if st.additional_info is not None:
                    st.additional_info = copy.deepcopy(
                        st.additional_info
                    )
                    # Remove stale execution data that may have leaked
                    # from a previous turn via the shared reference.
                    st.additional_info.pop("worker_attempts", None)

            self._pending_tasks.extendleft(reversed(subtasks))
            # Log task created events
            metrics_callbacks = [
                cb
                for cb in self._callbacks
                if isinstance(cb, WorkforceMetrics)
            ]
            if metrics_callbacks:
                for subtask in subtasks:
                    event = TaskCreatedEvent(
                        task_id=subtask.id,
                        description=subtask.content,
                        parent_task_id=task.id if task else None,
                        task_type=None,
                    )
                    metrics_callbacks[0].log_task_created(event)

        if not subtasks:
            logger.warning(
                "[DECOMPOSE] No subtasks returned, creating fallback task"
            )
            fallback_info = (
                copy.deepcopy(task.additional_info)
                if task.additional_info
                else None
            )
            if fallback_info:
                fallback_info.pop("worker_attempts", None)
            fallback_task = Task(
                content=task.content,
                id=f"{task.id}.1",
                parent=task,
                additional_info=fallback_info,
            )
            task.subtasks = [fallback_task]
            subtasks = [fallback_task]

            # Log fallback task created event
            metrics_callbacks = [
                cb
                for cb in self._callbacks
                if isinstance(cb, WorkforceMetrics)
            ]
            if metrics_callbacks:
                event = TaskCreatedEvent(
                    task_id=fallback_task.id,
                    description=fallback_task.content,
                    parent_task_id=task.id if task else None,
                    task_type=None,
                )
                metrics_callbacks[0].log_task_created(event)

        if on_stream_batch:
            try:
                on_stream_batch(subtasks, True)
            except Exception as e:
                logger.warning(f"Final streaming callback failed: {e}")

        logger.debug(
            f"[DECOMPOSE] handle_decompose_append_task completed, "
            f"returned {len(subtasks)} subtasks"
        )
        return subtasks

    def _get_agent_id_from_node_id(self, node_id: str) -> str | None:
        """Map worker node_id to the actual agent_id for
        frontend communication.

        The CAMEL base class uses node_id for task assignment,
        but the frontend uses agent_id to identify agents.
        This method provides the mapping.
        """
        for child in self._children:
            if hasattr(child, "node_id") and child.node_id == node_id:
                if hasattr(child, "worker") and hasattr(
                    child.worker, "agent_id"
                ):
                    return child.worker.agent_id
        return None

    def _extract_model_type(self, agent: ChatAgent) -> str | None:
        """Extract model type from agent's model_backend.

        Handles both ModelManager (multiple models) and single model cases.

        Args:
            agent: The chat agent to extract model type from

        Returns:
            Model type as string, or None if not found
        """
        if not hasattr(agent, "model_backend") or not agent.model_backend:
            return None

        model_obj = agent.model_backend

        # Handle ModelManager case (multiple models)
        if hasattr(model_obj, "models") and model_obj.models:
            first_model = model_obj.models[0] if model_obj.models else None
            if first_model:
                mt = getattr(first_model, "model_type", None)
                return (
                    str(mt.value if hasattr(mt, "value") else mt)
                    if mt
                    else None
                )

        # Handle single model case
        mt = getattr(model_obj, "model_type", None)
        return str(mt.value if hasattr(mt, "value") else mt) if mt else None

    async def _find_assignee(self, tasks: list[Task]) -> TaskAssignResult:
        # Task assignment phase: send "waiting for execution" notification
        # to the frontend, and send "start execution" notification when the
        # task actually begins execution
        assigned = await super()._find_assignee(tasks)

        task_lock = get_task_lock(self.api_task_id)
        for item in assigned.assignments:
            # DEBUG ▶ Task has been assigned to which worker
            # and its dependencies
            logger.debug(
                f"[WF] ASSIGN {item.task_id} -> {item.assignee_id} "
                f"deps={item.dependencies}"
            )
            # The main task itself does not need notification
            if self._task and item.task_id == self._task.id:
                continue
            # Find task content
            task_obj = get_camel_task(item.task_id, tasks)
            if task_obj is None:
                logger.warning(
                    f"[WF] WARN: Task {item.task_id} not found in "
                    f"tasks list during ASSIGN phase. This may indicate "
                    f"a task tree inconsistency."
                )
                content = ""
            else:
                content = task_obj.content

            # Skip sending notification if this is a retry/replan for
            # an already assigned task
            # This prevents the frontend from showing "Reassigned"
            # when a task is being retried with the same or different
            # worker due to failure recovery
            if task_obj and task_obj.assigned_worker_id:
                logger.debug(
                    f"[WF] ASSIGN Skip notification for task {item.task_id}: "
                    f"already has assigned_worker_id="
                    f"{task_obj.assigned_worker_id}, "
                    f"new assignee={item.assignee_id} (retry/replan scenario)"
                )
                continue

            # Map node_id to agent_id for frontend communication
            # The CAMEL base class returns node_id as assignee_id,
            # but the frontend uses agent_id to identify agents
            agent_id = self._get_agent_id_from_node_id(item.assignee_id)
            if agent_id is None:
                workers = [
                    c.node_id for c in self._children if hasattr(c, "node_id")
                ]
                logger.error(
                    f"[WF] ERROR: Could not find agent_id for "
                    f"node_id={item.assignee_id}. Task {item.task_id} "
                    f"will not be properly tracked on frontend. "
                    f"Available workers: {workers}"
                )
                continue  # Skip sending notification for unmapped worker

            # Asynchronously send waiting notification
            task = asyncio.create_task(
                task_lock.put_queue(
                    ActionAssignTaskData(
                        action=Action.assign_task,
                        data={
                            "assignee_id": agent_id,
                            "task_id": item.task_id,
                            "content": content,
                            "state": "waiting",  # Mark as waiting state
                            "failure_count": 0,
                        },
                    )
                )
            )
            # Track the task for cleanup
            task_lock.add_background_task(task)

            metrics_callbacks = [
                cb
                for cb in self._callbacks
                if isinstance(cb, WorkforceMetrics)
            ]
            if metrics_callbacks:
                event = TaskAssignedEvent(
                    task_id=item.task_id,
                    worker_id=agent_id,
                    dependencies=item.dependencies,
                )
                metrics_callbacks[0].log_task_assigned(event)
        return assigned

    async def _post_task(self, task: Task, assignee_id: str) -> None:
        # DEBUG ▶ Dependencies are met, the task really starts to execute
        logger.debug(f"[WF] POST  {task.id} -> {assignee_id}")
        """Override the _post_task method to notify the frontend
        when the task really starts to execute
        """
        # When the dependency check is passed and the task is
        # about to be published to the execution queue, send a
        # notification to the frontend
        task_lock = get_task_lock(self.api_task_id)
        if self._task and task.id != self._task.id:
            # Skip the main task itself
            # Map node_id to agent_id for frontend communication
            agent_id = self._get_agent_id_from_node_id(assignee_id)
            workers = [
                c.node_id for c in self._children if hasattr(c, "node_id")
            ]
            if agent_id is None:
                logger.error(
                    f"[WF] ERROR: Could not find agent_id "
                    f"for node_id={assignee_id}. "
                    f"Task {task.id} will not be properly "
                    f"tracked on frontend. "
                    f"Available workers: "
                    f"{workers}"
                )
            else:
                await task_lock.put_queue(
                    ActionAssignTaskData(
                        action=Action.assign_task,
                        data={
                            "assignee_id": agent_id,
                            "task_id": task.id,
                            "content": task.content,
                            "state": "running",  # running state
                            "failure_count": task.failure_count,
                        },
                    )
                )
        # Call the parent class method to continue the
        # normal task publishing process
        await super()._post_task(task, assignee_id)

    def add_single_agent_worker(
        self,
        description: str,
        worker: ListenChatAgent,
        pool_max_size: int = DEFAULT_WORKER_POOL_SIZE,
        enable_workflow_memory: bool = False,
    ) -> BaseWorkforce:
        if self._state == WorkforceState.RUNNING:
            raise RuntimeError(
                "Cannot add workers while workforce is running. "
                "Pause the workforce first."
            )

        # Validate worker agent compatibility
        self._validate_agent_compatibility(worker, "Worker agent")

        # Ensure the worker agent shares this workforce's pause control
        self._attach_pause_event_to_agent(worker)

        worker_node = SingleAgentWorker(
            description=description,
            worker=worker,
            pool_max_size=pool_max_size,
            use_structured_output_handler=self.use_structured_output_handler,
            context_utility=None,
            enable_workflow_memory=enable_workflow_memory,
        )
        self._children.append(worker_node)

        # If we have a channel set up, set it for the new worker
        if hasattr(self, "_channel") and self._channel is not None:
            worker_node.set_channel(self._channel)

        # If workforce is paused, start the worker's listening task
        self._start_child_node_when_paused(worker_node.start())

        # Use proper CAMEL pattern for metrics logging
        metrics_callbacks = [
            cb for cb in self._callbacks if isinstance(cb, WorkforceMetrics)
        ]
        if metrics_callbacks:
            # Collect agent metadata for telemetry
            agent_class_name = getattr(
                worker, "agent_name", worker.__class__.__name__
            )
            model_type = self._extract_model_type(worker)

            # Log worker created event
            event = WorkerCreatedEvent(
                worker_id=worker_node.node_id,
                worker_type="SingleAgentWorker",
                role=worker_node.description,
            )

        return self

    def _sync_subtask_to_parent(self, task: Task) -> None:
        """Sync completed subtask's :obj:`result` and :obj:`state`
        back to its :obj:`parent.subtasks` list. CAMEL stores results
        in :obj:`_completed_tasks` but doesn't update
        :obj:`parent.subtasks`, causing :obj:`parent.subtasks[i].result`
        to remain :obj:`None`. This ensures consistency.

        Args:
            task (Task): The completed subtask whose result/state should
                be synced to :obj:`parent.subtasks`.
        """
        parent: Task = task.parent
        if not parent or not parent.subtasks:
            return

        for sub in parent.subtasks:
            if sub.id == task.id:
                sub.result = task.result
                sub.state = task.state
                logger.debug(
                    f"[SYNC] Synced subtask {task.id} "
                    f"result to parent.subtasks"
                )
                return

        logger.warning(
            f"[SYNC] Subtask {task.id} not found in parent.subtasks"
        )

    async def _notify_task_completion(self, task: Task) -> None:
        """Send task completion notification to frontend.

        Args:
            task (Task): The completed task to notify the frontend about.
        """
        task_lock = get_task_lock(self.api_task_id)

        # Log task completion
        is_main_task = self._task and task.id == self._task.id
        task_type = "MAIN TASK" if is_main_task else "SUB-TASK"
        logger.info(f"[TASK-RESULT] {task_type} COMPLETED: {task.id}")

        # Build preview strings for logging (with None safety)
        if task.content and len(task.content) > 200:
            content_preview = task.content[:200] + "..."
        else:
            content_preview = task.content or ""

        if task.result and len(str(task.result)) > 500:
            result_preview = str(task.result)[:500] + "..."
        else:
            result_preview = task.result

        logger.info(f"[TASK-RESULT] Content: {content_preview}")
        logger.info(f"[TASK-RESULT] Result: {result_preview}")

        # Send to frontend
        task_data = {
            "task_id": task.id,
            "content": task.content or "",
            "state": task.state,
            "result": task.result or "",
            "failure_count": task.failure_count,
        }
        await task_lock.put_queue(ActionTaskStateData(data=task_data))

        # Log task completion to metrics
        metrics_callbacks = [
            cb for cb in self._callbacks if isinstance(cb, WorkforceMetrics)
        ]
        if metrics_callbacks:
            # worker_id is required and cannot be None
            worker_id = getattr(task, "assigned_worker_id", None) or "unknown"
            event = TaskCompletedEvent(
                task_id=task.id,
                worker_id=worker_id,
            )
            metrics_callbacks[0].log_task_completed(event)

    async def _handle_completed_task(self, task: Task) -> None:
        """Handle task completion: log, notify frontend, sync to parent,
        and delegate to CAMEL.

        Args:
            task (Task): The completed task to process.
        """
        logger.debug(f"[WF] DONE  {task.id}")
        # Sync and fix internal at first before sending task state
        # TODO: CAMEL should handle this task sync or have a more
        # efficient sync
        self._sync_subtask_to_parent(task)
        await self._notify_task_completion(task)
        await super()._handle_completed_task(task)

    async def _handle_failed_task(self, task: Task) -> bool:
        # DEBUG ▶ Task failed
        logger.debug(f"[WF] FAIL  {task.id} retry={task.failure_count}")

        result = await super()._handle_failed_task(task)

        # Only send completion report to frontend when all
        # retries are exhausted
        max_retries = self.failure_handling_config.max_retries
        if task.failure_count < max_retries:
            return result

        fallback_error_message = (
            "Task failed after exhausting all retries. "
            "No detailed error message was provided by the worker."
        )
        error_message = ""
        # Use proper CAMEL pattern for metrics logging
        metrics_callbacks = [
            cb for cb in self._callbacks if isinstance(cb, WorkforceMetrics)
        ]
        if metrics_callbacks and hasattr(metrics_callbacks[0], "log_entries"):
            for entry in reversed(metrics_callbacks[0].log_entries):
                if (
                    entry.get("event_type") == "task_failed"
                    and entry.get("task_id") == task.id
                ):
                    error_message = entry.get("error_message")
                    break

        final_error_message = str(
            error_message or task.result or fallback_error_message
        )
        task.result = final_error_message
        task.state = TaskState.FAILED

        task_lock = get_task_lock(self.api_task_id)
        await task_lock.put_queue(
            ActionTaskStateData(
                data={
                    "task_id": task.id,
                    "content": task.content,
                    "state": task.state,
                    "failure_count": task.failure_count,
                    "result": final_error_message,
                }
            )
        )

        if metrics_callbacks:
            error_msg = final_error_message
            # Pass all values during construction since TaskFailedEvent is frozen
            worker_id = (
                task.assigned_worker_id
                if hasattr(task, "assigned_worker_id")
                else None
            )
            event = TaskFailedEvent(
                task_id=task.id,
                error_message=error_msg,
                worker_id=worker_id,
            )
            metrics_callbacks[0].log_task_failed(event)

        return result

    async def _get_returned_task(self) -> Task | None:
        r"""Override to handle timeout and send notification to frontend.

        Get the task that's published by this node and just get returned
        from the assignee. Includes timeout handling to prevent indefinite
        waiting.

        Raises:
            asyncio.TimeoutError: If waiting for task exceeds timeout
        """
        try:
            return await asyncio.wait_for(
                self._channel.get_returned_task_by_publisher(self.node_id),
                timeout=self.task_timeout_seconds,
            )
        except TimeoutError:
            # Send timeout notification to frontend before re-raising
            logger.warning(
                f"⏰ [WF-TIMEOUT] Task timeout in workforce {self.node_id}. "
                f"Timeout: {self.task_timeout_seconds}s, "
                f"Pending tasks: {len(self._pending_tasks)}, "
                f"In-flight tasks: {self._in_flight_tasks}"
            )

            # Try to notify frontend, but don't let
            # notification failure mask the timeout
            try:
                task_lock = get_task_lock(self.api_task_id)
                timeout_minutes = self.task_timeout_seconds // 60
                await task_lock.put_queue(
                    ActionTimeoutData(
                        data={
                            "message": (
                                f"Task execution timeout: No response received "
                                f"for {timeout_minutes} minutes"
                            ),
                            "in_flight_tasks": self._in_flight_tasks,
                            "pending_tasks": len(self._pending_tasks),
                            "timeout_seconds": self.task_timeout_seconds,
                        }
                    )
                )
            except Exception as notify_err:
                logger.error(
                    f"Failed to send timeout notification: {notify_err}"
                )
            raise
        except Exception as e:
            logger.error(
                f"Error getting returned task {e} in "
                f"workforce {self.node_id}. "
                f"Current pending tasks: {len(self._pending_tasks)}, "
                f"In-flight tasks: {self._in_flight_tasks}"
            )
            raise

    def stop(self) -> None:
        logger.info("=" * 80)
        logger.info(
            "⏹️  [WF-LIFECYCLE] stop() CALLED",
            extra={"api_task_id": self.api_task_id, "workforce_id": id(self)},
        )
        logger.info(
            f"[WF-LIFECYCLE] Current state before stop: "
            f"{self._state.name}, _running: {self._running}"
        )
        logger.info("=" * 80)
        super().stop()
        logger.info(
            f"[WF-LIFECYCLE] super().stop() completed, "
            f"new state: {self._state.name}"
        )

        # Feature 5: When preempted, do NOT queue ActionEndData — the task
        # is not finished, it's being superseded by a new question.
        if self._preempted:
            logger.info(
                "[WF-LIFECYCLE] Skipping ActionEndData (preempted)"
            )
            return

        task_lock = get_task_lock(self.api_task_id)
        task = asyncio.create_task(task_lock.put_queue(ActionEndData()))
        task_lock.add_background_task(task)
        logger.info("[WF-LIFECYCLE] ✅ ActionEndData queued")

    def stop_gracefully(self) -> None:
        logger.info("=" * 80)
        logger.info(
            "🛑 [WF-LIFECYCLE] stop_gracefully() CALLED",
            extra={"api_task_id": self.api_task_id, "workforce_id": id(self)},
        )
        logger.info(
            f"[WF-LIFECYCLE] Current state before stop_gracefully: "
            f"{self._state.name}, _running: {self._running}"
        )
        logger.info("=" * 80)
        super().stop_gracefully()
        logger.info(
            f"[WF-LIFECYCLE] ✅ super().stop_gracefully() completed, "
            f"new state: {self._state.name}, _running: {self._running}"
        )

    def skip_gracefully(self) -> None:
        logger.info("=" * 80)
        logger.info(
            "⏭️  [WF-LIFECYCLE] skip_gracefully() CALLED",
            extra={"api_task_id": self.api_task_id, "workforce_id": id(self)},
        )
        logger.info(
            f"[WF-LIFECYCLE] Current state before skip_gracefully: "
            f"{self._state.name}, _running: {self._running}"
        )
        logger.info("=" * 80)
        super().skip_gracefully()
        logger.info(
            f"[WF-LIFECYCLE] ✅ super().skip_gracefully() completed, "
            f"new state: {self._state.name}, _running: {self._running}"
        )

    def pause(self) -> None:
        logger.info("=" * 80)
        logger.info(
            "⏸️  [WF-LIFECYCLE] pause() CALLED",
            extra={"api_task_id": self.api_task_id, "workforce_id": id(self)},
        )
        logger.info(
            f"[WF-LIFECYCLE] Current state before pause: "
            f"{self._state.name}, _running: {self._running}"
        )
        logger.info("=" * 80)
        super().pause()
        logger.info(
            f"[WF-LIFECYCLE] ✅ super().pause() completed, "
            f"new state: {self._state.name}, _running: {self._running}"
        )

    def resume(self) -> None:
        logger.info("=" * 80)
        logger.info(
            "▶️  [WF-LIFECYCLE] resume() CALLED",
            extra={"api_task_id": self.api_task_id, "workforce_id": id(self)},
        )
        logger.info(
            f"[WF-LIFECYCLE] Current state before resume: "
            f"{self._state.name}, _running: {self._running}"
        )
        logger.info("=" * 80)
        super().resume()
        logger.info(
            f"[WF-LIFECYCLE] ✅ super().resume() completed, "
            f"new state: {self._state.name}, _running: {self._running}"
        )

    async def cleanup(self) -> None:
        r"""Clean up resources when workforce is done"""
        try:
            # Clean up the task lock
            from app.service.task import delete_task_lock

            await delete_task_lock(self.api_task_id)
        except Exception as e:
            logger.error(f"Error cleaning up workforce resources: {e}")

    # ------------------------------------------------------------------
    # Feature 5: Preemption — cancel in-flight work for a new question
    # ------------------------------------------------------------------

    async def preempt_and_redirect(
        self, options: "Chat | None" = None
    ) -> None:
        """Cancel all in-flight subtasks so the workforce can immediately
        start a brand-new task.

        Unlike :meth:`stop`, this method does **not** queue an
        ``ActionEndData`` event (the task is not "finished" — it is being
        superseded).  The sequence is:

        1. Signal ``_stop_requested`` so ``_listen_to_channel`` exits.
        2. Cancel child listening tasks (workers' asyncio Tasks).
        3. Give a short grace period for cancellation to propagate.
        4. Call :meth:`prepare_for_new_task` to clear bookkeeping and
           reset agents for the next task.

        Args:
            options: Optional Chat configuration. If provided, MCP agent
                will be updated if the server config has changed.

        This method is safe to call from any thread — it uses
        ``_submit_coro_to_loop`` when the workforce event loop is alive,
        and falls back to synchronous cleanup otherwise.
        """
        logger.info(
            "[WF-PREEMPT] preempt_and_redirect() called",
            extra={"api_task_id": self.api_task_id, "workforce_id": id(self)},
        )

        if not self._running:
            # Workforce already idle — just reset bookkeeping.
            logger.info(
                "[WF-PREEMPT] Workforce not running, "
                "falling back to prepare_for_new_task()"
            )
            await self.prepare_for_new_task(options)
            return

        # --- 1. Request stop (sets _stop_requested, unblocks pause) ---
        self._stop_requested = True
        self._preempted = True  # Suppress ActionEndData in stop()
        if hasattr(self, "_pause_event"):
            self._pause_event.set()

        # --- 2. Cancel child listening tasks ---
        for child_task in getattr(self, "_child_listening_tasks", []):
            if not child_task.done():
                child_task.cancel()

        # Also cancel children's own tasks
        for child in self._children:
            if child._running:
                try:
                    child.stop()
                except Exception as exc:
                    logger.debug(
                        f"[WF-PREEMPT] Ignoring error stopping "
                        f"child {getattr(child, 'node_id', '?')}: {exc}"
                    )

        # Clear pending/in-flight immediately so the loop exits quickly
        self._pending_tasks.clear()
        self._in_flight_tasks = 0

        # --- 3. Brief grace period for asyncio cancellation ---
        try:
            await asyncio.sleep(0.1)
        except Exception:
            pass

        # Mark as not running so start() can be called again
        self._running = False
        self._state = WorkforceState.STOPPED

        logger.info(
            "[WF-PREEMPT] Workforce stopped, now resetting for new task"
        )

        # --- 4. Reset bookkeeping for the new task ---
        await self.prepare_for_new_task(options)

        logger.info(
            "[WF-PREEMPT] preempt_and_redirect() completed — "
            "workforce ready for reuse",
            extra={"api_task_id": self.api_task_id, "workforce_id": id(self)},
        )

    # ------------------------------------------------------------------
    # Feature 3: Workforce reuse across tasks within the same project
    # ------------------------------------------------------------------

    async def prepare_for_new_task(
        self, options: Chat | None = None
    ) -> None:
        """Reset the workforce so it can execute a brand-new task without
        the cost of rebuilding workers, models, and toolkits from scratch.

        This clears internal bookkeeping (pending/completed/in-flight tasks,
        assignments, dependency maps) and resets every worker agent's memory
        so that prior conversation doesn't leak into the next task.  The
        workers, channel, and coordinator/task agents are kept intact.

        Args:
            options: Optional Chat configuration. If provided and MCP servers
                have changed, the MCP agent will be updated dynamically.
        """
        logger.info(
            "[WF-REUSE] prepare_for_new_task() called",
            extra={"api_task_id": self.api_task_id, "workforce_id": id(self)},
        )

        # 1. Clear task bookkeeping
        self._pending_tasks.clear()
        self._completed_tasks.clear()
        self._in_flight_tasks = 0
        self._task = None
        self._assignees.clear()
        self._task_dependencies.clear()
        self._stop_requested = False
        self._preempted = False  # Feature 5: clear preemption flag

        # 2. Reset state to IDLE so start() can be called again
        self._state = WorkforceState.IDLE
        self._running = False

        # 3. Reset pause event (ensure not paused)
        if hasattr(self, "_pause_event"):
            self._pause_event.set()

        # 4. Clear agent memory on coordinator and task agents
        if hasattr(self, "coordinator_agent") and self.coordinator_agent:
            self.coordinator_agent.reset()
        if hasattr(self, "task_agent") and self.task_agent:
            self.task_agent.reset()

        # 5. Reset each worker's agent memory (but keep the agent alive)
        for child in self._children:
            if isinstance(child, SingleAgentWorker):
                # Reset the primary worker agent
                if hasattr(child, "worker") and child.worker is not None:
                    child.worker.reset()
                # Reset any pooled clones
                if hasattr(child, "agent_pool") and child.agent_pool:
                    for pooled_agent in child.agent_pool._available_agents:
                        pooled_agent.reset()

        # 6. Recreate channel so old task packets don't leak
        self.set_channel(TaskChannel())
        for child in self._children:
            child.set_channel(self._channel)

        # 7. Cancel stale child listening tasks and restart workers
        for task in getattr(self, "_child_listening_tasks", []):
            if not task.done():
                task.cancel()
        self._child_listening_tasks = []

        # 8. Update MCP agent if options provided and config changed
        if options is not None:
            await self._update_mcp_agent_if_needed(options)

        logger.info(
            "[WF-REUSE] prepare_for_new_task() completed — "
            "workforce ready for reuse",
            extra={"api_task_id": self.api_task_id, "workforce_id": id(self)},
        )

    async def _update_mcp_agent_if_needed(self, options: Chat) -> None:
        """Update MCP sidecar agent if configuration has changed.

        Compares the current MCP server configuration hash with the stored
        hash. If different (servers added/removed/config changed), removes
        the old MCP worker and creates a new one with updated configuration.

        Args:
            options: Chat configuration containing installed_mcp settings.
        """
        import hashlib
        import json

        mcp_servers = options.installed_mcp.get("mcpServers", {})
        current_config_hash = None

        if mcp_servers:
            # Create deterministic hash of MCP config
            config_str = json.dumps(mcp_servers, sort_keys=True)
            current_config_hash = hashlib.md5(config_str.encode()).hexdigest()

        # Check if config changed or if we need to add/remove MCP agent
        config_changed = self._mcp_config_hash != current_config_hash
        has_servers_now = bool(mcp_servers)
        had_servers_before = self._mcp_config_hash is not None

        if not config_changed:
            logger.debug(
                "[WF-REUSE] MCP config unchanged, no update needed",
                extra={
                    "api_task_id": self.api_task_id,
                    "workforce_id": id(self),
                    "config_hash": current_config_hash,
                },
            )
            return

        logger.info(
            f"[WF-REUSE] MCP config changed (had_servers={had_servers_before}, "
            f"has_servers={has_servers_now}), updating MCP agent",
            extra={
                "api_task_id": self.api_task_id,
                "workforce_id": id(self),
                "old_hash": self._mcp_config_hash,
                "new_hash": current_config_hash,
            },
        )

        # Remove existing MCP worker if present
        mcp_worker_idx = None
        for idx, child in enumerate(self._children):
            if isinstance(child, SingleAgentWorker):
                worker = getattr(child, "worker", None)
                if worker and getattr(worker, "agent_name", None) == Agents.mcp_agent:
                    mcp_worker_idx = idx
                    break

        if mcp_worker_idx is not None:
            old_worker = self._children.pop(mcp_worker_idx)
            logger.info(
                f"[WF-REUSE] Removed old MCP worker at index {mcp_worker_idx}",
                extra={"api_task_id": self.api_task_id, "workforce_id": id(self)},
            )
            # Clean up the old worker
            if hasattr(old_worker, "stop"):
                old_worker.stop()

        # Create and add new MCP agent if servers are configured
        if has_servers_now:
            from app.agent.factory.mcp import mcp_agent

            mcp_sidecar = await mcp_agent(options)
            server_names = list(mcp_servers.keys())
            self.add_single_agent_worker(
                f"MCP Agent: Executes external tool calls via "
                f"{', '.join(server_names)} MCP servers. "
                f"Delegate tasks that require these external tools to this agent.",
                mcp_sidecar,
            )
            self._mcp_config_hash = current_config_hash
            logger.info(
                f"[WF-REUSE] Added new MCP agent with servers: {server_names}",
                extra={
                    "api_task_id": self.api_task_id,
                    "workforce_id": id(self),
                    "config_hash": current_config_hash,
                },
            )
        else:
            # No servers configured, clear the hash
            self._mcp_config_hash = None
            logger.info(
                "[WF-REUSE] MCP servers removed, no MCP agent in workforce",
                extra={"api_task_id": self.api_task_id, "workforce_id": id(self)},
            )

    # ------------------------------------------------------------------
    # Working-directory hot-swap for cached workforce reuse
    # ------------------------------------------------------------------

    def update_working_directory(self, new_directory: str) -> None:
        """Update the working directory on all toolkit instances inside this
        workforce **in-place**, without destroying and recreating agents.

        This is called when a follow-up message references a new task_id
        (and therefore a new on-disk folder) while the workforce is
        being reused from cache.  It walks:

        1. coordinator_agent, task_agent  (their tools may include NoteTakingToolkit)
        2. Every child worker's primary agent (and pooled clones)
        3. System messages on coordinator_agent and task_agent (patch
           stale working-directory references so the decomposer and
           coordinator use the correct task folder)

        For each agent, it introspects ``FunctionTool.func`` to locate the
        bound toolkit instance and patches its path attributes.
        """
        import re as _re
        from pathlib import Path as _Path

        updated_count = 0

        # ----------------------------------------------------------
        # 0. Patch system messages on coordinator & task agents so the
        #    working-directory reference stays current.  The text we
        #    need to replace looks like:
        #      at working directory `C:\...\task_task-OLD`
        # ----------------------------------------------------------
        _sys_msg_pattern = _re.compile(
            r"(at working directory\s+`)([^`]+)(`)"
        )

        def _patch_system_message(agent) -> bool:
            """Replace the working-directory path inside the agent's
            system message.  Returns True if a substitution was made."""
            sys_msg = getattr(agent, "_system_message", None)
            if sys_msg is None:
                return False
            content = getattr(sys_msg, "content", "")
            if not content:
                return False

            # Normalise the new directory to match the style already
            # present in the system message (backslash on Windows).
            new_dir_str = str(_Path(new_directory))

            # Use a replacement *function* instead of a replacement
            # string to avoid re.escape() corrupting the path.
            # re.escape() is for search patterns, NOT replacement
            # strings — it escapes hyphens etc. which get interpreted
            # as literal backslash+char in the replacement output.
            def _make_replacement(m, _dir=new_dir_str):
                return m.group(1) + _dir + m.group(3)

            new_content, n = _sys_msg_pattern.subn(
                _make_replacement,
                content,
            )
            if n > 0:
                agent.update_system_message(new_content, reset_memory=True)
                logger.debug(
                    f"[WF-REUSE] Patched system message on "
                    f"{agent.__class__.__name__} "
                    f"(id={id(agent)}) → {new_dir_str}"
                )
                return True
            return False

        for attr in ("coordinator_agent", "task_agent", "new_worker_agent"):
            agent = getattr(self, attr, None)
            if agent is not None:
                if _patch_system_message(agent):
                    updated_count += 1

        def _patch_toolkits_on_agent(agent):
            """Patch toolkit working dirs reachable from *agent*."""
            nonlocal updated_count
            internal_tools = getattr(agent, "_internal_tools", None)
            if not isinstance(internal_tools, dict):
                return
            seen_toolkit_ids: set[int] = set()
            for tool in internal_tools.values():
                func = getattr(tool, "func", None)
                if func is None:
                    continue
                toolkit = getattr(func, "__self__", None)
                if toolkit is None:
                    continue
                tk_id = id(toolkit)
                if tk_id in seen_toolkit_ids:
                    continue
                seen_toolkit_ids.add(tk_id)

                # NoteTakingToolkit (CAMEL base) — Path attribute
                if hasattr(toolkit, "working_directory") and isinstance(
                    toolkit.working_directory, _Path
                ):
                    new_path = _Path(new_directory)
                    if toolkit.working_directory != new_path:
                        new_path.mkdir(parents=True, exist_ok=True)
                        toolkit.working_directory = new_path
                        toolkit.registry_file = new_path / ".note_register"
                        updated_count += 1

                # TerminalToolkit (CAMEL base) — str attribute
                if hasattr(toolkit, "working_dir") and isinstance(
                    toolkit.working_dir, str
                ):
                    import os as _os

                    abs_new = _os.path.abspath(new_directory)
                    if toolkit.working_dir != abs_new:
                        toolkit.working_dir = abs_new
                        updated_count += 1

        # 1. Coordinator + task agents
        for attr in ("coordinator_agent", "task_agent", "new_worker_agent"):
            agent = getattr(self, attr, None)
            if agent is not None:
                _patch_toolkits_on_agent(agent)

        # 2. Child workers (SingleAgentWorker instances)
        for child in self._children:
            worker = getattr(child, "worker", None)
            if worker is not None:
                _patch_toolkits_on_agent(worker)
                # Also patch the worker agent's system message
                if _patch_system_message(worker):
                    updated_count += 1
            # Pooled clones
            pool = getattr(child, "agent_pool", None)
            if pool is not None:
                for pooled in pool._available_agents:
                    _patch_toolkits_on_agent(pooled)
                    if _patch_system_message(pooled):
                        updated_count += 1

        if updated_count:
            logger.info(
                f"[WF-REUSE] update_working_directory() patched "
                f"{updated_count} toolkit paths → {new_directory}",
                extra={
                    "api_task_id": self.api_task_id,
                    "workforce_id": id(self),
                },
            )
        else:
            logger.debug(
                "[WF-REUSE] update_working_directory() — "
                "no toolkit paths needed updating",
                extra={
                    "api_task_id": self.api_task_id,
                    "workforce_id": id(self),
                },
            )

    # ------------------------------------------------------------------
    # Feature 4: Concurrent subtask execution — batch-drain returned tasks
    # ------------------------------------------------------------------

    async def _drain_returned_tasks(
        self,
        first: Task,
        window: float = _BATCH_DRAIN_WINDOW,
    ) -> list[Task]:
        """Collect *first* plus any additional returned tasks that arrive
        within *window* seconds.

        Workers execute concurrently, so several tasks may complete almost
        simultaneously.  Instead of processing them one-by-one (each
        requiring a separate loop iteration with pause/stop checks and
        snapshot logic), we batch-drain the channel and hand them back
        to the caller for streamlined processing.

        Args:
            first: The first returned task (already awaited by caller).
            window: Maximum time (seconds) to wait for more results.

        Returns:
            A list starting with *first* followed by any extras.
        """
        batch: list[Task] = [first]
        deadline = asyncio.get_event_loop().time() + window
        while True:
            remaining = deadline - asyncio.get_event_loop().time()
            if remaining <= 0:
                break
            try:
                extra = await asyncio.wait_for(
                    self._channel.get_returned_task_by_publisher(
                        self.node_id
                    ),
                    timeout=remaining,
                )
                if extra is not None:
                    batch.append(extra)
            except (TimeoutError, asyncio.TimeoutError):
                break
            except Exception:
                break
        if len(batch) > 1:
            logger.info(
                f"[WF-BATCH] Drained {len(batch)} returned tasks "
                f"in one batch"
            )
        return batch

    async def _listen_to_channel(self) -> None:
        """Optimised main loop with batch-drain of returned tasks.

        This override replaces the base-class ``_listen_to_channel``
        to reduce per-iteration overhead when multiple workers finish
        at roughly the same time.  After the first returned task
        arrives we wait up to ``_BATCH_DRAIN_WINDOW`` seconds for
        additional results, then process the whole batch before
        calling ``_post_ready_tasks()`` (which may trigger an LLM
        coordinator call to assign newly-unblocked subtasks).
        """
        self._running = True
        self._state = WorkforceState.RUNNING
        logger.info(f"Workforce {self.node_id} started (batch-drain mode).")

        await self._post_ready_tasks()

        while (
            self._task is None
            or self._pending_tasks
            or self._in_flight_tasks > 0
        ) and not self._stop_requested:
            try:
                # ---- pause / stop / skip guards (from base class) ----
                await self._pause_event.wait()
                if self._stop_requested:
                    logger.info("Stop requested, breaking execution loop.")
                    break
                if self._skip_requested:
                    should_stop = await self._handle_skip_task()
                    if should_stop:
                        self._stop_requested = True
                        break
                    self._skip_requested = False
                    continue

                # ---- exit if nothing left ----
                if not self._pending_tasks and self._in_flight_tasks == 0:
                    break

                # ---- decompose main tasks that were added dynamically ----
                if self._pending_tasks and self._in_flight_tasks == 0:
                    next_task = self._pending_tasks[0]
                    if (
                        next_task.additional_info
                        and next_task.additional_info.get(
                            "_needs_decomposition"
                        )
                    ):
                        logger.info(
                            f"Decomposing main task: {next_task.id}"
                        )
                        try:
                            next_task.additional_info[
                                "_needs_decomposition"
                            ] = False
                            await self.handle_decompose_append_task(
                                next_task, reset=False
                            )
                            await self._handle_completed_task(next_task)
                        except Exception as e:
                            logger.error(
                                f"Error decomposing main task "
                                f"{next_task.id}: {e}",
                                exc_info=True,
                            )
                            if not self._pending_tasks:
                                self._pending_tasks.appendleft(next_task)
                        await self._post_ready_tasks()
                        continue

                # ---- await first returned task ----
                try:
                    first_task = await self._get_returned_task()
                except asyncio.TimeoutError:
                    if self._in_flight_tasks > 0:
                        logger.warning(
                            f"Timeout waiting for "
                            f"{self._in_flight_tasks} in-flight tasks."
                        )
                        break
                    await self._post_ready_tasks()
                    continue

                if first_task is None:
                    await self._post_ready_tasks()
                    continue

                # ---- Feature 4: batch-drain any extras ----
                batch = await self._drain_returned_tasks(first_task)

                for returned_task in batch:
                    self._decrement_in_flight_tasks(
                        returned_task.id, "task returned (batch)"
                    )

                if self._stop_requested:
                    break

                # ---- process each task in the batch ----
                for returned_task in batch:
                    if returned_task.state == TaskState.DONE:
                        # Quick insufficient-result guard (matches
                        # base-class inline check).  Full LLM-based
                        # quality evaluation is intentionally skipped
                        # here; the worker already validates results
                        # via is_task_result_insufficient before
                        # returning DONE.
                        if is_task_result_insufficient(returned_task):
                            logger.warning(
                                f"[WF-BATCH] Task {returned_task.id} "
                                f"marked DONE but result is "
                                f"insufficient — treating as FAILED."
                            )
                            returned_task.state = TaskState.FAILED
                            try:
                                halt = await self._handle_failed_task(
                                    returned_task
                                )
                                if halt:
                                    if (
                                        len(self.get_main_task_queue())
                                        > 0
                                    ):
                                        self._skip_requested = True
                                    else:
                                        await self._graceful_shutdown(
                                            returned_task
                                        )
                                        self._stop_requested = True
                                    break
                            except Exception as e:
                                logger.error(
                                    f"Error handling insufficient task "
                                    f"{returned_task.id}: {e}",
                                    exc_info=True,
                                )
                        else:
                            await self._handle_completed_task(
                                returned_task
                            )
                    elif returned_task.state == TaskState.FAILED:
                        try:
                            halt = await self._handle_failed_task(
                                returned_task
                            )
                            if halt:
                                if len(self.get_main_task_queue()) > 0:
                                    self._skip_requested = True
                                else:
                                    await self._graceful_shutdown(
                                        returned_task
                                    )
                                    self._stop_requested = True
                                break
                        except Exception as e:
                            logger.error(
                                f"Error handling failed task "
                                f"{returned_task.id}: {e}",
                                exc_info=True,
                            )
                    elif returned_task.state == TaskState.OPEN:
                        pass
                    else:
                        raise ValueError(
                            f"Task {returned_task.id} has an "
                            f"unexpected state."
                        )

            except Exception as e:
                self._decrement_in_flight_tasks(
                    "unknown", "exception in task processing loop"
                )
                logger.error(
                    f"Error processing task in workforce "
                    f"{self.node_id}: {e}. "
                    f"Pending: {len(self._pending_tasks)}, "
                    f"In-flight: {self._in_flight_tasks}, "
                    f"Completed: {len(self._completed_tasks)}"
                )
                if self._stop_requested:
                    break
                continue

        # ---- final state ----
        if self._stop_requested:
            self._state = WorkforceState.STOPPED
            logger.info("Workforce stopped by user request.")
        elif not self._pending_tasks and self._in_flight_tasks == 0:
            self._state = WorkforceState.IDLE
            logger.info("All tasks completed.")
        self.stop()
