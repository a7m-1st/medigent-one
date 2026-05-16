

import logging
import platform

from camel.messages import BaseMessage

from app.agent.agent_model import agent_model
from app.agent.prompt import MCP_SIDECAR_PROMPT
from app.agent.tools import get_all_mcp_tools
from app.agent.utils import NOW_STR
from app.model.chat import Chat
from app.service.task import Agents
from app.utils.file_utils import get_working_directory

logger = logging.getLogger(__name__)


async def mcp_agent(options: Chat):
    """Create MCP sidecar agent for executing external MCP tool calls.

    This agent is initialized once when MCP servers are configured via
    ``installed_mcp`` in the Chat payload.  It joins the workforce as a
    regular worker so the coordinator can delegate tasks to it.

    Supports both direct MCP connections (backend connects to the server)
    and proxied connections (requests relayed through the browser).

    Uses the main model config (same LLM as other primary agents).
    """
    working_directory = get_working_directory(options)
    mcp_servers = options.installed_mcp.get("mcpServers", {})
    server_names = list(mcp_servers.keys())

    logger.info(
        f"Creating MCP agent for project: {options.project_id} "
        f"with {len(server_names)} MCP servers: {server_names}"
    )

    # Categorize servers for logging
    proxy_names = [
        n for n, c in mcp_servers.items() if c.get("useLocalProxy")
    ]
    direct_names = [
        n for n in server_names if n not in proxy_names
    ]
    if proxy_names:
        logger.info(
            f"Proxy servers (via browser): {proxy_names}, "
            f"Direct servers: {direct_names}"
        )

    # Load tools from all configured MCP servers (both direct and proxied).
    # Let exceptions propagate — the caller (construct_workforce) handles
    # them and sends an SSE warning to the frontend.
    tools = []
    if mcp_servers:
        mcp_tools = await get_all_mcp_tools(
            options.installed_mcp, options.project_id
        )
        logger.info(
            f"Loaded {len(mcp_tools)} MCP tools for project {options.project_id}"
        )
        tools.extend(mcp_tools)

    system_message = MCP_SIDECAR_PROMPT.format(
        platform_system=platform.system(),
        platform_machine=platform.machine(),
        working_directory=working_directory,
        now_str=NOW_STR,
        server_names=", ".join(server_names) if server_names else "none",
    )

    tool_names = [f"mcp:{name}" for name in server_names]

    return agent_model(
        Agents.mcp_agent,
        BaseMessage.make_assistant_message(
            role_name="MCP Agent",
            content=system_message,
        ),
        options,
        tools,
        tool_names=tool_names,
        support_native_tool_calling=not options.use_simulated_tool_calling,
    )
