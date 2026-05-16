

from camel.toolkits import NoteTakingToolkit as BaseNoteTakingToolkit

from app.agent.toolkit.abstract_toolkit import AbstractToolkit
from app.service.task import Agents
from app.utils.listen.toolkit_listen import auto_listen_toolkit


@auto_listen_toolkit(BaseNoteTakingToolkit)
class NoteTakingToolkit(BaseNoteTakingToolkit, AbstractToolkit):
    agent_name: str = Agents.medical_scribe

    def __init__(
        self,
        api_task_id: str,
        agent_name: str | None = None,
        working_directory: str | None = None,
        timeout: float | None = None,
    ) -> None:
        # TODO: Remove default value None since working_directory is required
        # Now the working_directory now is required to be specified
        # as the notes are stored in task specific directory
        if working_directory is None:
            raise ValueError(
                "working_directory is required for NoteTakingToolkit. "
                "Notes must be stored in a task-specific directory."
            )
        self.api_task_id = api_task_id
        if agent_name is not None:
            self.agent_name = agent_name
        super().__init__(
            working_directory=working_directory,
            timeout=timeout,
        )
