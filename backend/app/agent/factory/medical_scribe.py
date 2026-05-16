

import platform

from camel.messages import BaseMessage
from camel.toolkits import ToolkitMessageIntegration

from app.agent.agent_model import agent_model
from app.agent.listen_chat_agent import logger
from app.agent.prompt import MEDICAL_SCRIBE_PROMPT
from app.agent.toolkit.file_write_toolkit import FileToolkit
from app.agent.toolkit.human_toolkit import HumanToolkit
from app.agent.toolkit.note_taking_toolkit import NoteTakingToolkit
from app.agent.toolkit.terminal_toolkit import TerminalToolkit
from app.agent.utils import NOW_STR
from app.model.chat import AgentConfig, Chat
from app.service.task import Agents
from app.service.toolkit_pool import get_or_create_toolkit
from app.utils.file_utils import get_working_directory


async def medical_scribe_agent(options: Chat):
    """Create Medical Scribe agent (Gemini 3 - Documentation)
    
    This agent uses global Chat config for report generation.
    """
    working_directory = get_working_directory(options)
    logger.info(
        f"Creating Medical Scribe agent for project: {options.project_id} "
        f"in directory: {working_directory}"
    )
    
    # Get effective configuration from global Chat config
    effective_config = AgentConfig(
        api_url=options.api_url,
        model_type=options.model_type,
        model_platform=options.model_platform,
        api_key=options.api_key,
    )
    
    message_integration = ToolkitMessageIntegration(
        message_handler=HumanToolkit(
            options.project_id, Agents.medical_scribe
        ).send_message_to_user
    )
    
    # Use toolkit pool for reusable toolkit instances (per-project caching)
    # FileToolkit and NoteTakingToolkit are pooled; TerminalToolkit is not
    # (it has per-session state: command counts, venv)
    file_write_toolkit = get_or_create_toolkit(
        project_id=options.project_id,
        toolkit_class=FileToolkit,
        pool_key=Agents.medical_scribe,
        api_task_id=options.project_id,
        working_directory=working_directory,
    )
    file_write_toolkit = message_integration.register_toolkits(file_write_toolkit)
    
    terminal_toolkit = TerminalToolkit(
        options.project_id,
        agent_name=Agents.medical_scribe,
        working_directory=working_directory,
        safe_mode=True,
        clone_current_env=True,
    )
    terminal_toolkit = message_integration.register_toolkits(terminal_toolkit)
    
    note_toolkit = get_or_create_toolkit(
        project_id=options.project_id,
        toolkit_class=NoteTakingToolkit,
        pool_key=Agents.medical_scribe,
        api_task_id=options.project_id,
        agent_name=Agents.medical_scribe,
        working_directory=working_directory,
    )
    note_toolkit = message_integration.register_toolkits(note_toolkit)
    
    tools = [
        *file_write_toolkit.get_tools(),
        *terminal_toolkit.get_tools(),
        *note_toolkit.get_tools(),
    ]
    
    system_message = MEDICAL_SCRIBE_PROMPT.format(
        platform_system=platform.system(),
        platform_machine=platform.machine(),
        working_directory=working_directory,
        now_str=NOW_STR,
    )
    
    from app.model.chat import AgentModelConfig
    custom_config = AgentModelConfig(
        model_platform=effective_config.model_platform,
        model_type=effective_config.model_type,
        api_key=effective_config.api_key,
        api_url=effective_config.api_url,
    ) if effective_config.has_custom_config() else None
    
    return agent_model(
        Agents.medical_scribe,
        BaseMessage.make_assistant_message(
            role_name="Medical Scribe",
            content=system_message,
        ),
        options,
        tools,
        tool_names=[
            FileToolkit.toolkit_name(),
            TerminalToolkit.toolkit_name(),
            NoteTakingToolkit.toolkit_name(),
        ],
        support_native_tool_calling=not options.use_simulated_tool_calling,
        custom_model_config=custom_config,
    )
