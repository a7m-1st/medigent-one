"""MCP Proxy Toolkit — CAMEL-compatible tools backed by browser relay.

When an MCP server is marked for local proxy, instead of connecting
directly via ``MCPToolkit``, we create lightweight ``FunctionTool``
wrappers that route calls through the browser proxy WebSocket.

Flow:
  1. ``connect()`` asks the browser (via the relay WS) to list the
     MCP server's available tools.
  2. For each tool, a ``FunctionTool`` is created whose implementation
     sends ``tools/call`` requests back to the browser.
  3. The browser executes the actual MCP call and returns the result.
"""

import asyncio
import json
import logging
from typing import Any

from app.service.mcp_proxy_bridge import McpProxyBridge

logger = logging.getLogger("mcp_proxy_toolkit")


class McpProxyToolkit:
    """Toolkit that creates CAMEL-compatible FunctionTool instances
    backed by the browser MCP proxy relay.

    Usage::

        toolkit = McpProxyToolkit(
            project_id="proj-123",
            server_name="my-local-mcp",
            server_config={"url": "http://localhost:3000/mcp"},
        )
        await toolkit.connect()
        tools = toolkit.get_tools()
    """

    def __init__(
        self,
        project_id: str,
        server_name: str,
        server_config: dict[str, Any],
        timeout: float = 60.0,
    ):
        self.project_id = project_id
        self.server_name = server_name
        self.server_config = server_config
        self.timeout = timeout
        self._tools: list = []
        self._tool_schemas: list[dict] = []
        self._connected = False

    async def connect(self) -> None:
        """Discover tools from the proxied MCP server via the browser.

        Sends an ``initialize`` + ``tools/list`` request through the
        relay and stores the returned tool schemas.
        """
        if not McpProxyBridge.is_connected(self.project_id):
            raise RuntimeError(
                f"No browser proxy connected for project {self.project_id}. "
                f"Please open the app in a browser with Local Proxy enabled."
            )

        # Ask browser to initialize the MCP connection and list tools
        try:
            result = await McpProxyBridge.send_request(
                project_id=self.project_id,
                server_name=self.server_name,
                method="tools/list",
                params={"server_config": self.server_config},
                timeout=self.timeout,
            )
        except Exception as exc:
            logger.error(
                f"[PROXY-TK] Failed to list tools from {self.server_name}: {exc}"
            )
            raise

        # result should be {"tools": [...]} from the MCP server
        tools_list = result.get("tools", [])
        self._tool_schemas = tools_list
        logger.info(
            f"[PROXY-TK] Discovered {len(tools_list)} tools from "
            f"{self.server_name} via browser proxy"
        )
        self._connected = True

    def get_tools(self) -> list:
        """Return CAMEL-compatible FunctionTool instances for each
        discovered MCP tool.

        Must call ``connect()`` first.
        """
        if not self._connected:
            raise RuntimeError(
                "McpProxyToolkit.connect() must be called before get_tools()"
            )

        if self._tools:
            return self._tools

        from camel.toolkits import FunctionTool

        for schema in self._tool_schemas:
            tool_name = schema.get("name", "unknown_tool")
            tool_desc = schema.get("description", "No description")
            input_schema = schema.get("inputSchema", {})

            # Create a closure that captures the tool name
            def _make_caller(t_name: str):
                async def _call_tool(**kwargs) -> str:
                    """Execute an MCP tool call via browser proxy."""
                    try:
                        response = await McpProxyBridge.send_request(
                            project_id=self.project_id,
                            server_name=self.server_name,
                            method="tools/call",
                            params={
                                "name": t_name,
                                "arguments": kwargs,
                            },
                            timeout=self.timeout,
                        )
                        # MCP tool results come as {"content": [...]}
                        content = response.get("content", [])
                        if isinstance(content, list):
                            # Extract text content
                            texts = [
                                c.get("text", str(c))
                                for c in content
                                if isinstance(c, dict)
                            ]
                            return "\n".join(texts) if texts else json.dumps(response)
                        return str(content)
                    except Exception as exc:
                        return f"Error calling {t_name}: {exc}"

                _call_tool.__name__ = t_name
                _call_tool.__doc__ = tool_desc
                return _call_tool

            caller = _make_caller(tool_name)

            # Build an explicit OpenAI-compatible tool schema so the LLM
            # knows the real parameter names, types, and descriptions.
            # Without this, CAMEL's introspection of **kwargs produces
            # an empty parameters object and the LLM can't call the tool.
            properties = input_schema.get("properties", {})
            required = input_schema.get("required", [])

            # Strip unsupported JSON-Schema keywords that OpenAI strict
            # mode rejects (e.g. "default").
            clean_properties = {}
            for pname, pschema in properties.items():
                clean = {k: v for k, v in pschema.items() if k != "default"}
                clean_properties[pname] = clean

            openai_tool_schema = {
                "type": "function",
                "function": {
                    "name": tool_name,
                    "description": tool_desc,
                    "strict": True,
                    "parameters": {
                        "type": "object",
                        "properties": clean_properties,
                        "required": required,
                        "additionalProperties": False,
                    },
                },
            }

            tool = FunctionTool(
                func=caller,
                openai_tool_schema=openai_tool_schema,
            )
            self._tools.append(tool)

        return self._tools

    async def disconnect(self) -> None:
        """Clean up (no-op for proxy — browser manages connections)."""
        self._connected = False
        self._tools.clear()
        self._tool_schemas.clear()


async def get_proxy_mcp_tools(
    project_id: str,
    proxy_servers: dict[str, dict],
    timeout: float = 60.0,
) -> list:
    """Connect to proxied MCP servers via the browser and return tools.

    This is the proxy equivalent of ``get_mcp_tools()`` in tools.py.

    Args:
        project_id: The project ID (to find the right browser relay).
        proxy_servers: Dict of server_name -> server_config for proxied servers.
        timeout: Max seconds per MCP request.

    Returns:
        List of CAMEL FunctionTool instances.
    """
    all_tools = []

    for server_name, server_config in proxy_servers.items():
        toolkit = McpProxyToolkit(
            project_id=project_id,
            server_name=server_name,
            server_config=server_config,
            timeout=timeout,
        )
        try:
            await toolkit.connect()
            tools = toolkit.get_tools()
            all_tools.extend(tools)
            logger.info(
                f"[PROXY-TK] Loaded {len(tools)} tools from "
                f"proxied server {server_name}"
            )
        except Exception as exc:
            logger.error(
                f"[PROXY-TK] Failed to connect to proxied server "
                f"{server_name}: {exc}"
            )
            raise

    return all_tools
