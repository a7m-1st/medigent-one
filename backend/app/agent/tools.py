

import asyncio
import copy
import logging

from camel.toolkits import MCPToolkit

from app.agent.toolkit.audio_analysis_toolkit import AudioAnalysisToolkit
from app.agent.toolkit.document_analysis_toolkit import (
    DocumentAnalysisToolkit,
)
from app.agent.toolkit.image_analysis_toolkit import ImageAnalysisToolkit
from app.agent.toolkit.pubmed_toolkit import PubMedToolkit
from app.agent.toolkit.search_toolkit import SearchToolkit
from app.agent.toolkit.terminal_toolkit import TerminalToolkit
from app.agent.toolkit.video_analysis_toolkit import VideoAnalysisToolkit
from app.model.chat import McpServers
from app.agent.toolkit.abstract_toolkit import AbstractToolkit

logger = logging.getLogger(__name__)


async def get_toolkits(tools: list[str], agent_name: str, api_task_id: str):
    logger.info(
        f"Getting toolkits for agent: {agent_name}, "
        f"task: {api_task_id}, tools: {tools}"
    )
    toolkits = {
        "video_analysis_toolkit": VideoAnalysisToolkit,
        "audio_analysis_toolkit": AudioAnalysisToolkit,
        "image_analysis_toolkit": ImageAnalysisToolkit,
        "document_analysis_toolkit": DocumentAnalysisToolkit,
        "pubmed_toolkit": PubMedToolkit,
        "search_toolkit": SearchToolkit,
        "terminal_toolkit": TerminalToolkit,
    }
    res = []
    for item in tools:
        if item in toolkits:
            toolkit: AbstractToolkit = toolkits[item]
            toolkit.agent_name = agent_name
            toolkit_tools = toolkit.get_can_use_tools(api_task_id)
            toolkit_tools = (
                await toolkit_tools
                if asyncio.iscoroutine(toolkit_tools)
                else toolkit_tools
            )
            res.extend(toolkit_tools)
        else:
            logger.warning(f"Toolkit {item} not found for agent {agent_name}")
    return res


def _split_mcp_servers(
    mcp_server: McpServers,
) -> tuple[dict[str, dict], dict[str, dict]]:
    """Split MCP servers into direct and proxied groups.

    Returns:
        Tuple of (direct_servers, proxy_servers).
        Each is a dict of server_name -> server_config.
    """
    all_servers = mcp_server.get("mcpServers", {})
    direct: dict[str, dict] = {}
    proxy: dict[str, dict] = {}

    for name, config in all_servers.items():
        if config.get("useLocalProxy"):
            proxy[name] = config
        else:
            direct[name] = config

    return direct, proxy


async def get_mcp_tools(mcp_server: McpServers):
    """Connect to MCP servers and return available tools.

    Only connects to **direct** (non-proxy) servers. Proxy servers are
    handled separately via ``get_proxy_mcp_tools()`` in
    ``mcp_proxy_toolkit.py``.

    Raises:
        MCPConnectionError (from camel) or other exceptions on failure.
        The caller is responsible for handling errors — this function
        intentionally does NOT swallow them so that connection failures
        are surfaced to the user.
    """
    direct_servers, _ = _split_mcp_servers(mcp_server)

    logger.info(
        f"Getting MCP tools for {len(direct_servers)} direct servers"
    )
    if len(direct_servers) == 0:
        return []

    # Build a DEEP copy of the config dict so mutations (timeout
    # injection by MCPToolkit, env injection below) never leak back
    # into the caller's ``options.installed_mcp``.
    config_dict = {"mcpServers": copy.deepcopy(direct_servers)}
    mcp_toolkit = MCPToolkit(config_dict=config_dict, timeout=30)
    await mcp_toolkit.connect()

    logger.info(
        f"Successfully connected to MCP toolkit with "
        f"{len(direct_servers)} direct servers"
    )
    tools = mcp_toolkit.get_tools()
    if tools:
        tool_names = [
            (
                tool.get_function_name()
                if hasattr(tool, "get_function_name")
                else str(tool)
            )
            for tool in tools
        ]
        logging.debug(f"MCP tool names: {tool_names}")
    return tools


async def get_all_mcp_tools(
    mcp_server: McpServers, project_id: str
) -> list:
    """Get tools from both direct and proxied MCP servers.

    For direct servers, connects via CAMEL's MCPToolkit.
    For proxy servers, uses the browser relay via McpProxyToolkit.

    Args:
        mcp_server: Full MCP server configuration from the Chat payload.
        project_id: Project ID (needed to find the browser proxy relay).

    Returns:
        Combined list of FunctionTool instances from all servers.
    """
    direct_servers, proxy_servers = _split_mcp_servers(mcp_server)
    all_tools: list = []

    # 1. Direct servers (backend connects directly)
    if direct_servers:
        direct_config: McpServers = {"mcpServers": direct_servers}
        direct_tools = await get_mcp_tools(direct_config)
        all_tools.extend(direct_tools)
        logger.info(
            f"Loaded {len(direct_tools)} tools from "
            f"{len(direct_servers)} direct MCP servers"
        )

    # 2. Proxy servers (browser relay)
    if proxy_servers:
        from app.agent.mcp_proxy_toolkit import get_proxy_mcp_tools

        proxy_tools = await get_proxy_mcp_tools(
            project_id=project_id,
            proxy_servers=proxy_servers,
            timeout=60.0,
        )
        all_tools.extend(proxy_tools)
        logger.info(
            f"Loaded {len(proxy_tools)} tools from "
            f"{len(proxy_servers)} proxied MCP servers"
        )

    return all_tools
