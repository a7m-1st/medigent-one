"""WebSocket relay endpoint for browser-proxied MCP connections.

When a user enables "Local Proxy" for an MCP server, the backend cannot
reach the server directly (e.g. it's on ``localhost`` or the user's LAN).
Instead, the browser acts as the intermediary:

    Backend  <──WS relay──>  Browser  <──HTTP/WS──>  MCP Server

Protocol (over the /ws/mcp-proxy WebSocket):

  Browser -> Backend:
    {"type": "register", "payload": {"project_id": "..."}}
    {"type": "mcp_response", "payload": {"request_id": "...", "response": {...}}}
    {"type": "mcp_error", "payload": {"request_id": "...", "error": "..."}}

  Backend -> Browser:
    {"type": "mcp_request", "payload": {"request_id": "...", "server_name": "...", "method": "...", "params": {...}}}
    {"type": "registered", "payload": {"project_id": "..."}}

The backend uses ``McpProxyBridge`` (a global registry) to match project
sessions with their browser relay WebSocket.  When the MCP agent needs to
call a tool on a proxied server, it posts a request to the bridge, which
forwards it to the browser and awaits the response.
"""

import asyncio
import json
import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.service.mcp_proxy_bridge import McpProxyBridge

router = APIRouter()
logger = logging.getLogger("mcp_proxy")


@router.websocket("/ws/mcp-proxy")
async def websocket_mcp_proxy(ws: WebSocket):
    """Persistent WebSocket for browser-side MCP proxy relay."""
    await ws.accept()
    logger.info("[MCP-PROXY] WebSocket connection accepted")

    project_id: str | None = None

    try:
        while True:
            raw = await ws.receive_text()
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                await ws.send_text(
                    json.dumps({"type": "error", "payload": {"message": "Invalid JSON"}})
                )
                continue

            msg_type = msg.get("type", "")
            payload = msg.get("payload", {})

            # ----------------------------------------------------------
            # register — browser announces which project it's proxying for
            # ----------------------------------------------------------
            if msg_type == "register":
                project_id = payload.get("project_id")
                if not project_id:
                    await ws.send_text(
                        json.dumps({
                            "type": "error",
                            "payload": {"message": "project_id is required"},
                        })
                    )
                    continue

                McpProxyBridge.register(project_id, ws)
                await ws.send_text(
                    json.dumps({
                        "type": "registered",
                        "payload": {"project_id": project_id},
                    })
                )
                logger.info(
                    f"[MCP-PROXY] Browser registered for project {project_id}"
                )

            # ----------------------------------------------------------
            # mcp_response — browser returning an MCP tool call result
            # ----------------------------------------------------------
            elif msg_type == "mcp_response":
                request_id = payload.get("request_id")
                if request_id:
                    McpProxyBridge.resolve_request(
                        request_id, payload.get("response", {})
                    )
                    logger.debug(
                        f"[MCP-PROXY] Response received for request {request_id}"
                    )

            # ----------------------------------------------------------
            # mcp_error — browser reporting an error for an MCP call
            # ----------------------------------------------------------
            elif msg_type == "mcp_error":
                request_id = payload.get("request_id")
                if request_id:
                    McpProxyBridge.reject_request(
                        request_id, payload.get("error", "Unknown proxy error")
                    )
                    logger.warning(
                        f"[MCP-PROXY] Error for request {request_id}: "
                        f"{payload.get('error')}"
                    )

            else:
                await ws.send_text(
                    json.dumps({
                        "type": "error",
                        "payload": {"message": f"Unknown message type: {msg_type}"},
                    })
                )

    except WebSocketDisconnect:
        logger.info(f"[MCP-PROXY] Browser disconnected (project={project_id})")
    except Exception as exc:
        logger.error(f"[MCP-PROXY] Unexpected error: {exc}", exc_info=True)
    finally:
        if project_id:
            McpProxyBridge.unregister(project_id)
            logger.info(f"[MCP-PROXY] Unregistered project {project_id}")
