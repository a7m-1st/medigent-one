

import platform

from camel.messages import BaseMessage
from camel.toolkits import ToolkitMessageIntegration

from app.agent.agent_model import agent_model
from app.agent.listen_chat_agent import logger
from app.agent.prompt import ATTENDING_PHYSICIAN_PROMPT
from app.agent.toolkit.human_toolkit import HumanToolkit
from app.agent.toolkit.note_taking_toolkit import NoteTakingToolkit
from app.agent.utils import NOW_STR
from app.model.chat import AgentConfig, Chat
from app.service.task import Agents
from app.service.toolkit_pool import get_or_create_toolkit
from app.utils.file_utils import get_working_directory


async def attending_physician_agent(options: Chat):
    """Create Attending Physician agent (MedGemma 4B - Clinical Diagnosis)
    
    This agent uses secondary_agent config (MedGemma 4B) for diagnosis and treatment planning.
    Falls back to global Chat config if not provided.
    """
    working_directory = get_working_directory(options)
    logger.info(
        f"Creating Attending Physician agent for project: {options.project_id} "
        f"in directory: {working_directory}"
    )
    
    # Get effective configuration
    # secondary_agent -> Chat global config
    global_config = AgentConfig(
        api_url=options.api_url,
        model_type=options.model_type,
        model_platform=options.model_platform,
        api_key=options.api_key,
    )
    
    if options.secondary_agent:
        # Use secondary agent config with fallback to global
        effective_config = options.secondary_agent.get_effective_config(global_config)
    else:
        # Use global config
        effective_config = global_config
    
    message_integration = ToolkitMessageIntegration(
        message_handler=HumanToolkit(
            options.project_id, Agents.attending_physician
        ).send_message_to_user
    )
    
    # Use toolkit pool for reusable toolkit instances (per-project caching)
    note_toolkit = get_or_create_toolkit(
        project_id=options.project_id,
        toolkit_class=NoteTakingToolkit,
        pool_key=Agents.attending_physician,
        api_task_id=options.project_id,
        agent_name=Agents.attending_physician,
        working_directory=working_directory,
    )
    note_toolkit = message_integration.register_toolkits(note_toolkit)
    
    tools = [
        *HumanToolkit.get_can_use_tools(
            options.project_id, Agents.attending_physician
        ),
        *note_toolkit.get_tools(),
    ]
    
    system_message = ATTENDING_PHYSICIAN_PROMPT.format(
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
        model_context_size=effective_config.model_context_size,
        default_headers=effective_config.default_headers,
    ) if effective_config.has_custom_config() else None
    
    return agent_model(
        Agents.attending_physician,
        BaseMessage.make_assistant_message(
            role_name="Attending Physician",
            content=system_message,
        ),
        options,
        tools,
        tool_names=[
            HumanToolkit.toolkit_name(),
            NoteTakingToolkit.toolkit_name(),
        ],
        support_native_tool_calling=not effective_config.use_simulated_tool_calling,
        custom_model_config=custom_config,
    )
