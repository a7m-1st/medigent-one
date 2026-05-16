

import os

from camel.models import BaseAudioModel, BaseModelBackend
from camel.toolkits import AudioAnalysisToolkit as BaseAudioAnalysisToolkit

from app.agent.toolkit.abstract_toolkit import AbstractToolkit
from app.component.environment import env
from app.service.task import Agents
from app.utils.listen.toolkit_listen import auto_listen_toolkit


@auto_listen_toolkit(BaseAudioAnalysisToolkit)
class AudioAnalysisToolkit(BaseAudioAnalysisToolkit, AbstractToolkit):
    agent_name: str = Agents.radiologist

    def __init__(
        self,
        api_task_id: str,
        cache_dir: str | None = None,
        transcribe_model: BaseAudioModel | None = None,
        audio_reasoning_model: BaseModelBackend | None = None,
        timeout: float | None = None,
    ):
        if cache_dir is None:
            cache_dir = env(
                "file_save_path", os.path.expanduser("~/.medgemma/tmp/")
            )
        super().__init__(
            cache_dir, transcribe_model, audio_reasoning_model, timeout
        )
        self.api_task_id = api_task_id
