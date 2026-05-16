import asyncio
import logging
import os
import re
import time
from datetime import datetime
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Request, Response
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from app.model.chat import (
    Chat,
    HumanReply,
    Status,
    SupplementChat,
    sse_json,
)
from app.utils.file_utils import get_working_directory, process_attaches
from app.service.chat_service import step_solve
from app.service.task import (
    Action,
    ActionImproveData,
    ActionStartData,
    ActionStopData,
    ImprovePayload,
    delete_task_lock,
    get_or_create_task_lock,
    get_task_lock,
    get_task_lock_by_task_id,
    get_task_lock_if_exists,
    set_current_task_id,
    task_locks,
)

router = APIRouter()

# Logger for chat controller
chat_logger = logging.getLogger("chat_controller")

# SSE timeout configuration (60 minutes in seconds)
SSE_TIMEOUT_SECONDS = 60 * 60

# Cache configuration for project files
FILES_CACHE: dict[str, dict[str, Any]] = {}
FILES_CACHE_TTL_SECONDS = 30  # Cache TTL: 30 seconds


class ProjectFile(BaseModel):
    name: str
    path: str
    size: int
    created_at: str
    is_directory: bool


class ProjectFilesResponse(BaseModel):
    project_id: str
    task_id: str | None
    files: list[ProjectFile]
    total_count: int


async def _cleanup_task_lock_safe(task_lock, reason: str) -> bool:
    """Safely cleanup task lock with existence check.

    Args:
        task_lock: The task lock to cleanup
        reason: Reason for cleanup (for logging)

    Returns:
        True if cleanup was performed, False otherwise
    """
    if not task_lock:
        return False

    # Check if task_lock still exists before attempting cleanup
    if task_lock.id not in task_locks:
        chat_logger.debug(
            f"[{reason}] Task lock already removed, skipping cleanup",
            extra={"task_id": task_lock.id},
        )
        return False

    try:
        task_lock.status = Status.done
        await delete_task_lock(task_lock.id)
        chat_logger.info(
            f"[{reason}] Task lock cleanup completed",
            extra={"task_id": task_lock.id},
        )
        return True
    except Exception as e:
        chat_logger.error(
            f"[{reason}] Failed to cleanup task lock",
            extra={"task_id": task_lock.id, "error": str(e)},
            exc_info=True,
        )
        return False


async def timeout_stream_wrapper(
    stream_generator,
    timeout_seconds: int = SSE_TIMEOUT_SECONDS,
    task_lock=None,
):
    """Wraps a stream generator with timeout handling.

    Closes the SSE connection if no data is received within the timeout period.
    Triggers cleanup if timeout occurs to prevent resource leaks.
    """
    last_data_time = time.time()
    generator = stream_generator.__aiter__()
    cleanup_triggered = False

    try:
        while True:
            elapsed = time.time() - last_data_time
            remaining_timeout = timeout_seconds - elapsed

            try:
                data = await asyncio.wait_for(
                    generator.__anext__(), timeout=remaining_timeout
                )
                last_data_time = time.time()
                yield data
            except TimeoutError:
                chat_logger.warning(
                    "SSE timeout: No data received, closing connection",
                    extra={"timeout_seconds": timeout_seconds},
                )
                timeout_min = timeout_seconds // 60
                yield sse_json(
                    "error",
                    {
                        "message": "Connection timeout: No data"
                        f" received for {timeout_min}"
                        " minutes"
                    },
                )
                cleanup_triggered = await _cleanup_task_lock_safe(
                    task_lock, "TIMEOUT"
                )
                break
            except StopAsyncIteration:
                break

    except asyncio.CancelledError:
        chat_logger.info(
            "[STREAM-CANCELLED] Stream cancelled, triggering cleanup"
        )
        if not cleanup_triggered:
            await _cleanup_task_lock_safe(task_lock, "CANCELLED")
        raise
    except Exception as e:
        chat_logger.error(
            "[STREAM-ERROR] Unexpected error in stream wrapper",
            extra={"error": str(e)},
            exc_info=True,
        )
        if not cleanup_triggered:
            await _cleanup_task_lock_safe(task_lock, "ERROR")
        raise


def scan_folder(folder_path: Path, files: list, base_path: Path):
    """Recursively scan folder and add files to list."""
    # Exclude camel_logs directory
    excluded_dirs = {"camel_logs", "__pycache__", ".git"}

    try:
        for item in folder_path.iterdir():
            if item.name in excluded_dirs:
                continue

            if item.is_file():
                stat = item.stat()
                relative_path = item.relative_to(base_path)
                files.append(
                    ProjectFile(
                        name=item.name,
                        path=str(relative_path),
                        size=stat.st_size,
                        created_at=datetime.fromtimestamp(
                            stat.st_ctime
                        ).isoformat(),
                        is_directory=False,
                    )
                )
            elif item.is_dir():
                # Optionally include subdirectories
                stat = item.stat()
                relative_path = item.relative_to(base_path)
                files.append(
                    ProjectFile(
                        name=item.name,
                        path=str(relative_path),
                        size=0,
                        created_at=datetime.fromtimestamp(
                            stat.st_ctime
                        ).isoformat(),
                        is_directory=True,
                    )
                )
                # Recursively scan subdirectories
                scan_folder(item, files, base_path)
    except PermissionError:
        chat_logger.warning(f"Permission denied: {folder_path}")
    except Exception as e:
        chat_logger.error(f"Error scanning folder {folder_path}: {e}")


@router.post("/chat", name="start chat")
async def post(data: Chat, request: Request):
    chat_logger.info(
        "Starting new chat session",
        extra={
            "project_id": data.project_id,
            "task_id": data.task_id,
        },
    )

    task_lock = get_or_create_task_lock(data.project_id)

    # Feature 3: When reusing an existing task_lock (follow-up in same
    # project), drain any stale queue items from the prior SSE session
    # and replace the queue so the new step_solve starts clean.
    if not task_lock.queue.empty():
        while not task_lock.queue.empty():
            try:
                task_lock.queue.get_nowait()
            except asyncio.QueueEmpty:
                break
        chat_logger.info(
            "Drained stale queue items from reused task_lock",
            extra={"project_id": data.project_id},
        )

    # Load conversation history from frontend (last N messages for context)
    if data.history and len(data.history) > 0:
        for msg in data.history:
            task_lock.add_conversation(msg.role, msg.content)
        chat_logger.info(
            f"Loaded {len(data.history)} messages from frontend into conversation history",
            extra={"project_id": data.project_id},
        )

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

    # Set the initial current_task_id in task_lock
    set_current_task_id(data.project_id, data.task_id)

    # Put initial action in queue to start processing
    await task_lock.put_queue(
        ActionImproveData(
            data=ImprovePayload(
                question=data.question,
                attaches=data.attaches or [],
            ),
            new_task_id=data.task_id,
        )
    )

    chat_logger.info(
        "Chat session initialized",
        extra={
            "project_id": data.project_id,
            "task_id": data.task_id,
            "log_dir": str(camel_log),
        },
    )
    return StreamingResponse(
        timeout_stream_wrapper(
            step_solve(data, request, task_lock), task_lock=task_lock
        ),
        media_type="text/event-stream",
    )


@router.post("/chat/{id}", name="improve chat")
def improve(id: str, data: SupplementChat):
    chat_logger.info(
        "Chat improvement requested",
        extra={"task_id": id, "question_length": len(data.question)},
    )
    task_lock = get_task_lock(id)

    if data.task_id:
        set_current_task_id(id, data.task_id)
        os.environ["file_save_path"] = (
            Path.home()
            / "medgemma"
            / f"project_{id}"
            / f"task_{data.task_id}"
        ).as_posix()
        camel_log = (
            Path.home()
            / "medgemma"
            / f"project_{id}"
            / f"task_{data.task_id}"
            / "camel_logs"
        )
        camel_log.mkdir(parents=True, exist_ok=True)
        os.environ["CAMEL_LOG_DIR"] = str(camel_log)

    # Allow continuing conversation even after task is done
    # This supports multi-turn conversation after complex task completion
    if task_lock.status == Status.done:
        # Reset status to allow processing new messages
        task_lock.status = Status.confirming
        # Clear any existing background tasks since workforce was stopped
        if hasattr(task_lock, "background_tasks"):
            task_lock.background_tasks.clear()
        # Note: conversation_history and last_task_result are preserved

        # Log context preservation
        if hasattr(task_lock, "conversation_history"):
            hist_len = len(task_lock.conversation_history)
            chat_logger.info(
                f"[CONTEXT] Preserved {hist_len} conversation entries"
            )
        if hasattr(task_lock, "last_task_result"):
            result_len = len(task_lock.last_task_result)
            chat_logger.info(
                f"[CONTEXT] Preserved task result: {result_len} chars"
            )

    asyncio.run(
        task_lock.put_queue(
            ActionImproveData(
                data=ImprovePayload(
                    question=data.question,
                    attaches=data.attaches or [],
                ),
                new_task_id=data.task_id,
            )
        )
    )
    chat_logger.info(
        "Improvement request queued with preserved context",
        extra={"project_id": id, "task_id": data.task_id},
    )
    return Response(status_code=201)


@router.delete("/chat/{id}", name="stop chat")
def stop(id: str):
    """Stop the task by task_id or project_id"""
    chat_logger.info("=" * 80)
    chat_logger.info(
        "🛑 [STOP-BUTTON] DELETE /chat/{id} request received from frontend"
    )
    chat_logger.info(f"[STOP-BUTTON] id (task_id or project_id): {id}")
    chat_logger.info("=" * 80)

    # Try to find task lock by task_id first, then by project_id
    task_lock = get_task_lock_by_task_id(id)

    if task_lock is None:
        # Fall back to looking up by project_id
        task_lock = get_task_lock_if_exists(id)

    if task_lock is None:
        chat_logger.warning(
            "[STOP-BUTTON] Task lock not found"
            " for task_id or project_id,"
            f" id: {id}"
        )
        return Response(status_code=204)

    chat_logger.info(
        "[STOP-BUTTON] Task lock retrieved,"
        f" task_lock.id: {task_lock.id},"
        f" current_task_id: {task_lock.current_task_id}"
    )
    chat_logger.info(
        "[STOP-BUTTON] Queueing ActionStopData(Action.stop) to task_lock queue"
    )

    try:
        asyncio.run(task_lock.put_queue(ActionStopData(action=Action.stop)))
        chat_logger.info(
            "[STOP-BUTTON] ActionStopData queued"
            " successfully, this will trigger"
            " workforce.stop_gracefully()"
        )
    except Exception as e:
        chat_logger.error(
            f"[STOP-BUTTON] Failed to queue stop action, error: {str(e)}"
        )

    return Response(status_code=204)


@router.post("/chat/{id}/human-reply")
def human_reply(id: str, data: HumanReply):
    chat_logger.info(
        "Human reply received",
        extra={
            "task_id": id,
            "reply_length": len(data.reply),
            "attaches_count": len(data.attaches),
        },
    )
    task_lock = get_task_lock(id)

    # Process attachments: convert base64 images to file paths
    if data.attaches:
        working_directory = get_working_directory(None, task_lock)
        processed_attaches = process_attaches(data.attaches, working_directory)
        chat_logger.info(
            "Processed human reply attachments",
            extra={"task_id": id, "processed_count": len(processed_attaches)},
        )
        # Update the data with processed file paths
        data.attaches = processed_attaches

    asyncio.run(task_lock.put_human_input(data.agent, data))
    chat_logger.debug("Human reply processed", extra={"task_id": id})
    return Response(status_code=201)


@router.get("/projects/{project_id}/files", name="list project files")
def list_project_files(project_id: str, task_id: str | None = None):
    """List all files in a project's folder.

    Args:
        project_id: The project ID
        task_id: Optional task ID to filter to specific task folder

    Returns:
        List of files with name, path, size, and creation time
    """
    # Check cache first
    cache_key = f"{project_id}:{task_id}"
    cached = FILES_CACHE.get(cache_key)
    if cached and time.time() - cached["timestamp"] < FILES_CACHE_TTL_SECONDS:
        chat_logger.debug(
            "Returning cached project files",
            extra={"project_id": project_id, "task_id": task_id},
        )
        return ProjectFilesResponse(**cached["data"])

    base_path = Path.home() / "medgemma" / f"project_{project_id}"

    if not base_path.exists():
        chat_logger.warning(
            "Project folder not found",
            extra={"project_id": project_id, "path": str(base_path)},
        )
        return ProjectFilesResponse(
            project_id=project_id,
            task_id=task_id,
            files=[],
            total_count=0,
        )

    files = []

    if task_id:
        # List files in specific task folder
        task_path = base_path / f"task_{task_id}"
        if task_path.exists():
            scan_folder(task_path, files, base_path)
    else:
        # List all files in project folder (including all tasks)
        for item in base_path.iterdir():
            if item.is_dir() and item.name.startswith("task_"):
                scan_folder(item, files, base_path)

    # Sort by creation time (newest first)
    files.sort(key=lambda x: x.created_at, reverse=True)

    chat_logger.info(
        "Listed project files",
        extra={
            "project_id": project_id,
            "task_id": task_id,
            "file_count": len(files),
        },
    )

    response = ProjectFilesResponse(
        project_id=project_id,
        task_id=task_id,
        files=files,
        total_count=len(files),
    )

    # Store in cache
    FILES_CACHE[cache_key] = {
        "timestamp": time.time(),
        "data": response.model_dump(),
    }

    return response


@router.get(
    "/projects/{project_id}/files/{file_path:path}", name="get project file"
)
def get_project_file(project_id: str, file_path: str):
    """Get/download a specific file from a project folder.

    Args:
        project_id: The project ID
        file_path: Relative path to the file (URL encoded)

    Returns:
        The file content with appropriate content-type
    """
    base_path = Path.home() / "medgemma" / f"project_{project_id}"
    full_path = base_path / file_path

    # Security check - ensure path is within project folder
    try:
        full_path = full_path.resolve()
        base_path = base_path.resolve()
        if not str(full_path).startswith(str(base_path)):
            chat_logger.warning(
                "Path traversal attempt detected",
                extra={"project_id": project_id, "file_path": file_path},
            )
            return Response(status_code=403, content="Access denied")
    except Exception:
        return Response(status_code=400, content="Invalid path")

    if not full_path.exists():
        chat_logger.warning(
            "File not found",
            extra={
                "project_id": project_id,
                "file_path": file_path,
                "path": str(full_path),
            },
        )
        return Response(status_code=404, content="File not found")

    if not full_path.is_file():
        return Response(status_code=400, content="Not a file")

    # Determine content type
    content_type = "application/octet-stream"
    suffix = full_path.suffix.lower()
    mime_types = {
        ".html": "text/html",
        ".htm": "text/html",
        ".txt": "text/plain",
        ".json": "application/json",
        ".pdf": "application/pdf",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".png": "image/png",
        ".gif": "image/gif",
        ".svg": "image/svg+xml",
        ".md": "text/markdown",
        ".py": "text/x-python",
        ".js": "text/javascript",
        ".css": "text/css",
    }
    content_type = mime_types.get(suffix, "application/octet-stream")

    chat_logger.info(
        "Serving project file",
        extra={"project_id": project_id, "file_path": file_path},
    )

    return Response(
        content=full_path.read_bytes(),
        media_type=content_type,
        headers={
            "Content-Disposition": f'inline; filename="{full_path.name}"'
        },
    )


@router.delete(
    "/projects/{project_id}/files/{file_path:path}", name="delete project file"
)
def delete_project_file(project_id: str, file_path: str):
    """Delete a specific file from a project folder.

    Args:
        project_id: The project ID
        file_path: Relative path to the file (URL encoded)

    Returns:
        Success message
    """
    base_path = Path.home() / "medgemma" / f"project_{project_id}"
    full_path = base_path / file_path

    # Security check - ensure path is within project folder
    try:
        full_path = full_path.resolve()
        base_path = base_path.resolve()
        if not str(full_path).startswith(str(base_path)):
            chat_logger.warning(
                "Path traversal attempt detected",
                extra={"project_id": project_id, "file_path": file_path},
            )
            return Response(status_code=403, content="Access denied")
    except Exception:
        return Response(status_code=400, content="Invalid path")

    if not full_path.exists():
        chat_logger.warning(
            "File not found for deletion",
            extra={"project_id": project_id, "file_path": file_path},
        )
        return Response(status_code=404, content="File not found")

    if not full_path.is_file():
        return Response(status_code=400, content="Not a file")

    try:
        full_path.unlink()
        chat_logger.info(
            "Deleted project file",
            extra={"project_id": project_id, "file_path": file_path},
        )
        return {"message": "File deleted successfully", "file_path": file_path}
    except Exception as e:
        chat_logger.error(
            f"Failed to delete file: {e}",
            extra={"project_id": project_id, "file_path": file_path},
        )
        return Response(
            status_code=500, content=f"Failed to delete file: {str(e)}"
        )



