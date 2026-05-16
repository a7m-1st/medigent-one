

from camel.toolkits import PubMedToolkit as BasePubMedToolkit

from app.agent.toolkit.abstract_toolkit import AbstractToolkit
from app.service.task import Agents
from app.utils.listen.toolkit_listen import auto_listen_toolkit


@auto_listen_toolkit(BasePubMedToolkit)
class PubMedToolkit(BasePubMedToolkit, AbstractToolkit):
    agent_name: str = Agents.clinical_researcher

    def __init__(
        self,
        api_task_id: str,
        agent_name: str | None = None,
        timeout: float | None = None,
    ) -> None:
        self.api_task_id = api_task_id
        if agent_name is not None:
            self.agent_name = agent_name
        super().__init__(timeout=timeout)
