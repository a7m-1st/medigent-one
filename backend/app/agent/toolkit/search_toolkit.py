

import logging
import os
from typing import Any

import httpx
from camel.toolkits import SearchToolkit as BaseSearchToolkit
from camel.toolkits.function_tool import FunctionTool

from app.agent.toolkit.abstract_toolkit import AbstractToolkit
from app.component.environment import env, env_not_empty
from app.service.task import Agents
from app.utils.listen.toolkit_listen import auto_listen_toolkit, listen_toolkit

logger = logging.getLogger("search_toolkit")


@auto_listen_toolkit(BaseSearchToolkit)
class SearchToolkit(BaseSearchToolkit, AbstractToolkit):
    agent_name: str = Agents.clinical_researcher

    def __init__(
        self,
        api_task_id: str,
        agent_name: str | None = None,
        timeout: float | None = None,
        exclude_domains: list[str] | None = None,
    ):
        self.api_task_id = api_task_id
        if agent_name is not None:
            self.agent_name = agent_name
        super().__init__(timeout=timeout, exclude_domains=exclude_domains)
        # Cache for user-specific search configurations
        self._user_google_api_key = None
        self._user_search_engine_id = None
        self._config_loaded = False

    @listen_toolkit(BaseSearchToolkit.search_wiki)
    def search_wiki(self, entity: str) -> str:
        return super().search_wiki(entity)

    @listen_toolkit(
        BaseSearchToolkit.search_duckduckgo,
        lambda _,
        query,
        source="text",
        number_of_result_pages=10: f"Search DuckDuckGo with query '{query}', source '{source}', and {number_of_result_pages} result page(s)",
        lambda result: f"Search DuckDuckGo returned {len(result)} results",
    )
    def search_duckduckgo(self, query: str, source: str = "text", number_of_result_pages: int = 10) -> list[dict[str, Any]]:
        return super().search_duckduckgo(query, source, number_of_result_pages)


    @classmethod
    def get_can_use_tools(cls, api_task_id: str) -> list[FunctionTool]:
        search_toolkit = SearchToolkit(api_task_id)
        tools = [
            FunctionTool(search_toolkit.search_wiki),
            FunctionTool(search_toolkit.search_duckduckgo),
        ]
        return tools

    def get_tools(self) -> list[FunctionTool]:
        return [
            FunctionTool(self.search_wiki),
            FunctionTool(self.search_duckduckgo),
        ]
