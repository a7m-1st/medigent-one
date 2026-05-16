

import logging
import os

from fastapi import APIRouter
from pydantic import BaseModel

logger = logging.getLogger("health_controller")

router = APIRouter(tags=["Health"])


class HealthResponse(BaseModel):
    status: str
    service: str


class ConfigStatusResponse(BaseModel):
    has_api_key: bool
    model_platform: str
    model_type: str


@router.get("/health", name="health check", response_model=HealthResponse)
async def health_check():
    """Health check endpoint for verifying backend
    is ready to accept requests."""
    logger.debug("Health check requested")
    response = HealthResponse(status="ok", service="medgemma")
    logger.debug(
        "Health check completed",
        extra={"status": response.status, "service": response.service},
    )
    return response


@router.get(
    "/config/status",
    name="config status",
    response_model=ConfigStatusResponse,
)
async def config_status():
    """Report whether the backend has default model
    configuration via environment variables."""
    api_key = os.getenv("GEMINI_API_KEY", "")
    has_key = bool(
        api_key and api_key != "your_gemini_api_key_here"
    )
    return ConfigStatusResponse(
        has_api_key=has_key,
        model_platform=os.getenv("MODEL_PLATFORM", ""),
        model_type=os.getenv("MODEL_TYPE", ""),
    )
