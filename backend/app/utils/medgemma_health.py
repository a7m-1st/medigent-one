"""
MedGemma Endpoint Health Check
===============================

Probes the MedGemma API endpoint with a lightweight GET request to detect
whether the HuggingFace Inference Endpoint has scaled down (503 Service
Unavailable).  When it has, the caller can notify the user to wait for
the endpoint to warm up before the workforce starts.

Typical HuggingFace cold-start times range from 30 seconds to a few minutes
depending on model size and instance type.
"""

import asyncio
import logging
import os
from typing import NamedTuple

import httpx

logger = logging.getLogger("medgemma_health")

# How long to wait for the probe request before giving up (seconds).
PROBE_TIMEOUT = 10
# How long to poll before giving up entirely (seconds).
MAX_WAIT_TIME = int(os.getenv("SECONDARY_MAX_WAIT_TIME", "300"))  # 5 minutes
# Interval between retry probes while waiting for warm-up (seconds).
POLL_INTERVAL = int(os.getenv("SECONDARY_POLL_INTERVAL", "15"))


class HealthStatus(NamedTuple):
    available: bool
    message: str


async def check_medgemma_health(
    api_url: str | None = None,
    api_key: str | None = None,
    default_headers: dict[str, str] | None = None,
) -> HealthStatus:
    """Send a lightweight probe to the MedGemma endpoint.

    Args:
        api_url: The base URL of the OpenAI-compatible endpoint (e.g.
            ``https://…/v1``).  Falls back to ``SECONDARY_API_URL`` env var.
        api_key: Optional API key (used in Authorization header if
            *default_headers* doesn't already contain one).
        default_headers: Extra HTTP headers (e.g. ``Authorization: Bearer …``).

    Returns:
        A ``HealthStatus(available, message)`` tuple.
    """
    url = api_url or os.getenv("SECONDARY_API_URL", "")
    if not url:
        return HealthStatus(True, "No secondary endpoint URL configured — skipping check")

    # Strip trailing /v1 so we hit the root health endpoint
    probe_url = url.rstrip("/")
    if probe_url.endswith("/v1"):
        probe_url = probe_url[:-3]

    headers: dict[str, str] = {}
    if default_headers:
        headers.update(default_headers)
    elif api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    try:
        async with httpx.AsyncClient(timeout=PROBE_TIMEOUT) as client:
            resp = await client.get(probe_url, headers=headers)

            if resp.status_code == 503:
                return HealthStatus(
                    False,
                    "MedGemma endpoint is currently scaled down (503). "
                    "It is warming up — this usually takes 1-3 minutes.",
                )
            if resp.status_code == 502:
                return HealthStatus(
                    False,
                    "MedGemma endpoint returned 502 Bad Gateway. "
                    "It may be starting up — please wait.",
                )

            # Any 2xx or other code we treat as "available"
            return HealthStatus(True, f"MedGemma endpoint responded ({resp.status_code})")

    except httpx.TimeoutException:
        return HealthStatus(
            False,
            "MedGemma endpoint did not respond within "
            f"{PROBE_TIMEOUT}s — it may be scaled down.",
        )
    except httpx.ConnectError as exc:
        return HealthStatus(False, f"Cannot reach MedGemma endpoint: {exc}")
    except Exception as exc:
        logger.warning(f"Unexpected error probing MedGemma: {exc}", exc_info=True)
        return HealthStatus(True, f"Health check error (assuming available): {exc}")


async def wait_for_medgemma(
    on_status: "asyncio.coroutines|None" = None,
    api_url: str | None = None,
    api_key: str | None = None,
    default_headers: dict[str, str] | None = None,
) -> HealthStatus:
    """Poll the MedGemma endpoint until it becomes available.

    Calls ``on_status(HealthStatus)`` (if provided) after each probe so the
    caller can stream progress updates to the frontend.

    Returns the final ``HealthStatus``.
    """
    elapsed = 0
    while elapsed < MAX_WAIT_TIME:
        status = await check_medgemma_health(api_url, api_key, default_headers)
        if on_status:
            await on_status(status)
        if status.available:
            return status
        logger.info(
            f"[MEDGEMMA] Waiting for endpoint to warm up … "
            f"({elapsed}s / {MAX_WAIT_TIME}s)"
        )
        await asyncio.sleep(POLL_INTERVAL)
        elapsed += POLL_INTERVAL

    return HealthStatus(
        False,
        f"MedGemma endpoint did not become available within {MAX_WAIT_TIME}s. "
        "You can retry later.",
    )
