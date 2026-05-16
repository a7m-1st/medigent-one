

import asyncio
import logging
from fastapi import APIRouter, Response
from app.service.task import (
    Action,
    ActionStartData,
    ActionStopData,
    get_task_lock,
    task_locks,
)

logger = logging.getLogger("task_controller")

router = APIRouter()


@router.post("/task/{id}/start", name="start task")
def start(id: str):
    task_lock = get_task_lock(id)
    logger.info("Starting task", extra={"task_id": id})
    asyncio.run(task_lock.put_queue(ActionStartData(action=Action.start)))
    logger.info("Task started successfully", extra={"task_id": id})
    return Response(status_code=201)

@router.delete("/task/stop-all", name="stop all tasks")
def stop_all():
    logger.warning("Stopping all tasks", extra={"task_count": len(task_locks)})
    for task_lock in task_locks.values():
        asyncio.run(task_lock.put_queue(ActionStopData()))
    logger.info("All tasks stopped", extra={"task_count": len(task_locks)})
    return Response(status_code=204)
