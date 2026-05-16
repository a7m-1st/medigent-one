"""In-process bridge between the MCP proxy WebSocket and the MCP agent.

``McpProxyBridge`` is a **static** registry that maps project IDs to their
browser relay WebSocket.  When the MCP agent on the backend needs to call
a tool on a proxied MCP server, it calls ``send_request()`` which:

  1. Generates a unique request ID
  2. Sends a ``mcp_request`` message over the relay WS to the browser
  3. Creates an ``asyncio.Future`` and waits for the response
  4. The browser calls the real MCP server, gets the result, and sends
     back a ``mcp_response`` (or ``mcp_error``)
  5. The corresponding ``resolve_request`` / ``reject_request`` completes
     the future, unblocking the caller

This is fully async and supports concurrent requests to multiple MCP
servers from the same project.
"""

import asyncio
import json
import logging
import uuid
from typing import Any

from fastapi import WebSocket

logger = logging.getLogger("mcp_proxy_bridge")


class McpProxyBridge:
    """Static registry for browser-side MCP proxy connections."""

    # project_id -> WebSocket
    _connections: dict[str, WebSocket] = {}

    # request_id -> asyncio.Future
    _pending: dict[str, asyncio.Future] = {}

    # request_id -> project_id (for scoped cleanup on disconnect)
    _request_project: dict[str, str] = {}

    @classmethod
    def register(cls, project_id: str, ws: WebSocket) -> None:
        """Register a browser relay WebSocket for a project."""
        cls._connections[project_id] = ws
        logger.info(f"[BRIDGE] Registered proxy for project {project_id}")

    @classmethod
    def unregister(cls, project_id: str) -> None:
        """Unregister the relay WebSocket for a project.

        Also rejects all pending requests for that project.
        """
        cls._connections.pop(project_id, None)

        # Reject only pending requests that belong to this project
        to_reject = [
            rid
            for rid, pid in cls._request_project.items()
            if pid == project_id and rid in cls._pending and not cls._pending[rid].done()
        ]
        for rid in to_reject:
            cls.reject_request(rid, "Browser proxy disconnected")
            cls._request_project.pop(rid, None)

        logger.info(f"[BRIDGE] Unregistered proxy for project {project_id}")

    @classmethod
    def is_connected(cls, project_id: str) -> bool:
        """Check if a browser proxy is connected for the given project."""
        return project_id in cls._connections

    @classmethod
    async def send_request(
        cls,
        project_id: str,
        server_name: str,
        method: str,
        params: dict[str, Any] | None = None,
        timeout: float = 60.0,
    ) -> Any:
        """Send an MCP request to the browser and wait for the response.

        Args:
            project_id: The project whose browser proxy should handle this.
            server_name: Name of the MCP server (as configured by the user).
            method: MCP method to call (e.g. ``tools/call``).
            params: MCP method parameters.
            timeout: Max seconds to wait for the browser response.

        Returns:
            The MCP response payload from the browser.

        Raises:
            RuntimeError: If no proxy is connected or the request times out.
        """
        ws = cls._connections.get(project_id)
        if ws is None:
            raise RuntimeError(
                f"No browser proxy connected for project {project_id}. "
                f"Please ensure the MCP proxy is enabled in the browser."
            )

        request_id = str(uuid.uuid4())
        loop = asyncio.get_running_loop()
        future: asyncio.Future = loop.create_future()
        cls._pending[request_id] = future
        cls._request_project[request_id] = project_id

        # Send the request to the browser
        msg = json.dumps({
            "type": "mcp_request",
            "payload": {
                "request_id": request_id,
                "server_name": server_name,
                "method": method,
                "params": params or {},
            },
        })

        try:
            await ws.send_text(msg)
            logger.debug(
                f"[BRIDGE] Sent request {request_id} to browser "
                f"(server={server_name}, method={method})"
            )
        except Exception as exc:
            cls._pending.pop(request_id, None)
            cls._request_project.pop(request_id, None)
            raise RuntimeError(
                f"Failed to send MCP request to browser proxy: {exc}"
            ) from exc

        # Wait for the response with timeout
        try:
            result = await asyncio.wait_for(future, timeout=timeout)
            return result
        except asyncio.TimeoutError:
            cls._pending.pop(request_id, None)
            cls._request_project.pop(request_id, None)
            raise RuntimeError(
                f"MCP proxy request timed out after {timeout}s "
                f"(server={server_name}, method={method})"
            )
        finally:
            cls._pending.pop(request_id, None)
            cls._request_project.pop(request_id, None)

    @classmethod
    def resolve_request(cls, request_id: str, response: Any) -> None:
        """Complete a pending request with a successful response."""
        future = cls._pending.get(request_id)
        if future and not future.done():
            future.set_result(response)

    @classmethod
    def reject_request(cls, request_id: str, error: str) -> None:
        """Complete a pending request with an error."""
        future = cls._pending.get(request_id)
        if future and not future.done():
            future.set_exception(RuntimeError(f"MCP proxy error: {error}"))
