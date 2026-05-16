import asyncio
import json
import logging
import os
from pathlib import Path

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from pydantic import ValidationError

from app.model.chat import Chat, HumanReply, Status, SupplementChat
from app.service.chat_service import step_solve
from app.service.task import (
    Action,
    ActionImproveData,
    ActionStartData,
    ActionStopData,
    ImprovePayload,
    TaskLock,
    get_or_create_task_lock,
    get_task_lock,
    set_current_task_id,
)
from app.utils.file_utils import get_working_directory, process_attaches

router = APIRouter()

session_logger = logging.getLogger("session_controller")


class _WSRequest:
    """Minimal adapter so ``step_solve`` can call ``await request.is_disconnected()``
    using the WebSocket's connection state instead of an HTTP Request object."""

    def __init__(self, ws: WebSocket):
        self._ws = ws
        self._disconnected = False

    def mark_disconnected(self):
        self._disconnected = True

    async def is_disconnected(self) -> bool:
        if self._disconnected:
            return True
        # WebSocket application state: CONNECTING=0, CONNECTED=1, DISCONNECTED=2
        try:
            return self._ws.application_state.value == 2
        except Exception:
            return self._disconnected


@router.websocket("/ws/chat")
async def websocket_chat(ws: WebSocket):
    """Persistent WebSocket endpoint that replaces per-message SSE streams.

    The client opens a single WS connection per project session.  All
    operations that previously required separate HTTP endpoints (start_chat,
    improve, stop, human_reply, start_task) are sent as JSON messages over the
    same socket, and all server events are pushed back as JSON frames using the
    identical ``{"step": ..., "data": ...}`` format that SSE used.

    Client -> Server message format::

        {
          "type": "start_chat" | "improve" | "stop" | "human_reply" | "start_task",
          "payload": { ... }
        }

    Server -> Client message format (same as SSE)::

        {"step": "<event_type>", "data": <payload>}
    """
    await ws.accept()
    session_logger.info("[WS] WebSocket connection accepted")

    ws_request = _WSRequest(ws)
    task_lock = None
    sse_consumer_task: asyncio.Task | None = None
    options: Chat | None = None
    stopped_via_action = False  # True when stop was handled inside step_solve

    async def _delayed_disconnect_cleanup(lock: TaskLock):
        """Wait 5 seconds after disconnect, then stop workforce and delete cache."""
        try:
            await asyncio.sleep(5)
            session_logger.warning(
                "[WS] Disconnect timeout reached (5s), stopping workforce",
                extra={"project_id": lock.id}
            )
            # Stop the workforce and cleanup
            await lock.cleanup()
            # Delete the task lock from global cache
            from app.service.task import task_locks
            if lock.id in task_locks:
                del task_locks[lock.id]
                session_logger.info(
                    "[WS] Task lock deleted after disconnect timeout",
                    extra={"project_id": lock.id}
                )
        except asyncio.CancelledError:
            session_logger.info(
                "[WS] Disconnect cleanup cancelled (client reconnected)",
                extra={"project_id": lock.id if lock else None}
            )
        except Exception as exc:
            session_logger.error(
                f"[WS] Error in disconnect cleanup: {exc}",
                exc_info=True,
                extra={"project_id": lock.id if lock else None}
            )

    async def _consume_sse_and_forward():
        """Read items from step_solve's async generator and forward them
        over the WebSocket as JSON text frames."""
        nonlocal task_lock, options
        try:
            async for sse_line in step_solve(options, ws_request, task_lock):
                # sse_line has the format: "data: {json}\n\n"
                # Strip the SSE framing to extract the raw JSON.
                line = sse_line.strip()
                if line.startswith("data: "):
                    line = line[6:]
                if line:
                    await ws.send_text(line)
        except asyncio.CancelledError:
            session_logger.info("[WS] SSE consumer cancelled")
        except WebSocketDisconnect:
            session_logger.info("[WS] Client disconnected during SSE consume")
        except Exception as exc:
            session_logger.error(
                f"[WS] Error in SSE consumer: {exc}", exc_info=True
            )
            try:
                await ws.send_text(
                    json.dumps({"step": "error", "data": {"message": str(exc)}})
                )
            except Exception:
                pass

    try:
        while True:
            raw = await ws.receive_text()
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                await ws.send_text(
                    json.dumps(
                        {"step": "error", "data": {"message": "Invalid JSON"}}
                    )
                )
                continue

            msg_type = msg.get("type", "")
            payload = msg.get("payload", {})

            # ----------------------------------------------------------
            # start_chat — equivalent to POST /chat
            # ----------------------------------------------------------
            if msg_type == "start_chat":
                try:
                    data = Chat(**payload)
                except (ValidationError, Exception) as exc:
                    await ws.send_text(
                        json.dumps(
                            {
                                "step": "error",
                                "data": {"message": f"Validation error: {exc}"},
                            }
                        )
                    )
                    continue

                options = data

                task_lock = get_or_create_task_lock(data.project_id)

                # Cancel any pending disconnect cleanup (client reconnected)
                if task_lock.disconnect_cleanup_task and not task_lock.disconnect_cleanup_task.done():
                    task_lock.disconnect_cleanup_task.cancel()
                    try:
                        await task_lock.disconnect_cleanup_task
                    except asyncio.CancelledError:
                        pass
                    task_lock.disconnect_cleanup_task = None
                    session_logger.info(
                        "[WS] Cancelled pending disconnect cleanup",
                        extra={"project_id": data.project_id}
                    )

                if task_lock.status == Status.done:
                    task_lock.status = Status.confirming
                    if hasattr(task_lock, "background_tasks"):
                        task_lock.background_tasks.clear()

                # Load conversation history safely, clearing if user overrides history completely
                if data.history and len(data.history) > 0:
                    task_lock.conversation_history.clear()
                    for hist_msg in data.history:
                        task_lock.add_conversation(hist_msg.role, hist_msg.content)

                os.environ["file_save_path"] = data.file_save_path()
                if data.api_key:
                    os.environ["OPENAI_API_KEY"] = data.api_key
                os.environ["OPENAI_API_BASE_URL"] = (
                    data.api_url or "https://api.openai.com/v1"
                )
                os.environ["CAMEL_MODEL_LOG_ENABLED"] = "true"

                camel_log = (
                    Path.home()
                    / ".medgemma"
                    / ("project_" + data.project_id)
                    / ("task_" + data.task_id)
                    / "camel_logs"
                )
                camel_log.mkdir(parents=True, exist_ok=True)
                os.environ["CAMEL_LOG_DIR"] = str(camel_log)

                set_current_task_id(data.project_id, data.task_id)
                
                # Process attachments for follow-up turns
                if data.attaches:
                    working_directory = get_working_directory(options, task_lock)
                    data.attaches = process_attaches(data.attaches, working_directory)

                # Enqueue the initial improve action
                await task_lock.put_queue(
                    ActionImproveData(
                        data=ImprovePayload(
                            question=data.question,
                            attaches=data.attaches or [],
                        ),
                        new_task_id=data.task_id,
                    )
                )

                session_logger.info(
                    "[WS] start_chat processed",
                    extra={
                        "project_id": data.project_id,
                        "task_id": data.task_id,
                    },
                )

                # Launch the SSE consumer in the background if it's not currently running
                if sse_consumer_task is None or sse_consumer_task.done():
                    sse_consumer_task = asyncio.create_task(
                        _consume_sse_and_forward()
                    )

            # ----------------------------------------------------------
            # improve — equivalent to POST /chat/{project_id}
            # ----------------------------------------------------------
            elif msg_type == "improve":
                try:
                    sup = SupplementChat(**payload)
                except (ValidationError, Exception) as exc:
                    await ws.send_text(
                        json.dumps(
                            {
                                "step": "error",
                                "data": {"message": f"Validation error: {exc}"},
                            }
                        )
                    )
                    continue

                if task_lock is None:
                    if sup.project_id:
                        task_lock = get_or_create_task_lock(sup.project_id)
                        
                        # Cancel any pending disconnect cleanup (client reconnected)
                        if task_lock.disconnect_cleanup_task and not task_lock.disconnect_cleanup_task.done():
                            task_lock.disconnect_cleanup_task.cancel()
                            try:
                                await task_lock.disconnect_cleanup_task
                            except asyncio.CancelledError:
                                pass
                            task_lock.disconnect_cleanup_task = None
                            session_logger.info(
                                "[WS] Cancelled pending disconnect cleanup",
                                extra={"project_id": sup.project_id}
                            )
                        
                        options = Chat(task_id=sup.task_id or "", project_id=sup.project_id, question=sup.question)
                        
                        if sse_consumer_task is None or sse_consumer_task.done():
                            sse_consumer_task = asyncio.create_task(
                                _consume_sse_and_forward()
                            )
                    else:
                        await ws.send_text(
                            json.dumps(
                                {
                                    "step": "error",
                                    "data": {"message": "No active session"},
                                }
                            )
                        )
                        continue

                # Allow continuing after task is done
                if task_lock.status == Status.done:
                    task_lock.status = Status.confirming
                    if hasattr(task_lock, "background_tasks"):
                        task_lock.background_tasks.clear()

                if sup.task_id and options is not None:
                    set_current_task_id(task_lock.id, sup.task_id)
                    options.task_id = sup.task_id
                    os.environ["file_save_path"] = options.file_save_path()
                    camel_log = (
                        Path.home()
                        / ".medgemma"
                        / ("project_" + options.project_id)
                        / ("task_" + options.task_id)
                        / "camel_logs"
                    )
                    camel_log.mkdir(parents=True, exist_ok=True)
                    os.environ["CAMEL_LOG_DIR"] = str(camel_log)

                # Process attachments for follow-up turns
                if sup.attaches:
                    working_directory = get_working_directory(options, task_lock)
                    sup.attaches = process_attaches(sup.attaches, working_directory)

                await task_lock.put_queue(
                    ActionImproveData(
                        data=ImprovePayload(
                            question=sup.question,
                            attaches=sup.attaches or [],
                        ),
                        new_task_id=sup.task_id,
                    )
                )
                session_logger.info(
                    "[WS] improve queued",
                    extra={"project_id": task_lock.id},
                )

            # ----------------------------------------------------------
            # stop — equivalent to DELETE /chat/{id}
            # ----------------------------------------------------------
            elif msg_type == "stop":
                if task_lock is not None:
                    stopped_via_action = True
                    await task_lock.put_queue(
                        ActionStopData(action=Action.stop)
                    )
                    session_logger.info("[WS] stop queued")

            # ----------------------------------------------------------
            # human_reply — equivalent to POST /chat/{id}/human-reply
            # ----------------------------------------------------------
            elif msg_type == "human_reply":
                if task_lock is None:
                    await ws.send_text(
                        json.dumps(
                            {
                                "step": "error",
                                "data": {"message": "No active session"},
                            }
                        )
                    )
                    continue

                try:
                    hr = HumanReply(**payload)
                except (ValidationError, Exception) as exc:
                    await ws.send_text(
                        json.dumps(
                            {
                                "step": "error",
                                "data": {"message": f"Validation error: {exc}"},
                            }
                        )
                    )
                    continue

                # Process attachments
                if hr.attaches and options is not None:
                    working_directory = get_working_directory(options, task_lock)
                    hr.attaches = process_attaches(hr.attaches, working_directory)

                await task_lock.put_human_input(hr.agent, hr)
                session_logger.info("[WS] human_reply delivered")

            # ----------------------------------------------------------
            # start_task — equivalent to POST /task/{id}/start
            # ----------------------------------------------------------
            elif msg_type == "start_task":
                project_id = payload.get("project_id") or (
                    task_lock.id if task_lock else None
                )
                if project_id:
                    tl = get_task_lock(project_id)
                    await tl.put_queue(
                        ActionStartData(action=Action.start)
                    )
                    session_logger.info(
                        "[WS] start_task queued",
                        extra={"project_id": project_id},
                    )

            else:
                await ws.send_text(
                    json.dumps(
                        {
                            "step": "error",
                            "data": {
                                "message": f"Unknown message type: {msg_type}"
                            },
                        }
                    )
                )

    except WebSocketDisconnect:
        session_logger.info("[WS] Client disconnected")
    except Exception as exc:
        session_logger.error(f"[WS] Unexpected error: {exc}", exc_info=True)
    finally:
        ws_request.mark_disconnected()

        # Cancel the SSE consumer
        if sse_consumer_task and not sse_consumer_task.done():
            sse_consumer_task.cancel()
            try:
                await sse_consumer_task
            except (asyncio.CancelledError, Exception):
                pass

        # Only schedule disconnect cleanup if the session wasn't already
        # stopped via the stop action (which already cleaned up in step_solve).
        from app.service.task import task_locks
        if task_lock is not None and not stopped_via_action and task_lock.id in task_locks:
            task_lock.status = Status.done
            while not task_lock.queue.empty():
                try:
                    task_lock.queue.get_nowait()
                except asyncio.QueueEmpty:
                    break
            
            # Schedule delayed cleanup task
            task_lock.disconnect_cleanup_task = asyncio.create_task(
                _delayed_disconnect_cleanup(task_lock)
            )
            session_logger.info(
                "[WS] Scheduled disconnect cleanup in 5s",
                extra={"project_id": task_lock.id}
            )
        elif stopped_via_action:
            session_logger.info(
                "[WS] Skipping disconnect cleanup — stop already handled",
                extra={"project_id": task_lock.id if task_lock else None}
            )

        session_logger.info("[WS] Cleanup complete")
