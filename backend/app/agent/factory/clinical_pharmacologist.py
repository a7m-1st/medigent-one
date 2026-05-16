

import platform

from camel.messages import BaseMessage
from camel.toolkits import ToolkitMessageIntegration

from app.agent.agent_model import agent_model
from app.agent.listen_chat_agent import logger
from app.agent.prompt import CLINICAL_PHARMACOLOGIST_PROMPT
from app.agent.toolkit.human_toolkit import HumanToolkit
from app.agent.toolkit.image_analysis_toolkit import ImageAnalysisToolkit
from app.agent.toolkit.note_taking_toolkit import NoteTakingToolkit
from app.agent.toolkit.search_toolkit import SearchToolkit
from app.agent.utils import NOW_STR
from app.model.chat import AgentConfig, Chat
from app.service.model_registry import get_or_create_model
from app.service.task import Agents
from app.service.toolkit_pool import get_or_create_toolkit
from app.utils.file_utils import get_working_directory


async def clinical_pharmacologist_agent(options: Chat):
    """Create Clinical Pharmacologist agent (MedGemma 4B - Pharmacology)
    
    This agent uses secondary_agent config (MedGemma 4B) for medication recommendations.
    Falls back to global Chat config if not provided.
    """
    working_directory = get_working_directory(options)
    logger.info(
        f"Creating Clinical Pharmacologist agent for project: {options.project_id} "
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
            options.project_id, Agents.clinical_pharmacologist
        ).send_message_to_user
    )
    
    # Use shared model registry for toolkit model (avoids redundant creation)
    toolkit_model = get_or_create_model(
        model_platform=effective_config.model_platform.lower() if effective_config.model_platform else options.model_platform.lower(),
        model_type=effective_config.model_type if effective_config.model_type else options.model_type,
        api_key=effective_config.api_key if effective_config.api_key else options.api_key,
        api_url=effective_config.api_url if effective_config.api_url else options.api_url,
    )
    
    # Use toolkit pool for reusable toolkit instances (per-project caching)
    image_analysis_toolkit = get_or_create_toolkit(
        project_id=options.project_id,
        toolkit_class=ImageAnalysisToolkit,
        pool_key=Agents.clinical_pharmacologist,
        api_task_id=options.project_id,
        model=toolkit_model,
    )
    image_analysis_toolkit = message_integration.register_toolkits(image_analysis_toolkit)
    
    search_toolkit = get_or_create_toolkit(
        project_id=options.project_id,
        toolkit_class=SearchToolkit,
        pool_key=Agents.clinical_pharmacologist,
        api_task_id=options.project_id,
    )
    search_toolkit = message_integration.register_toolkits(search_toolkit)
    
    note_toolkit = get_or_create_toolkit(
        project_id=options.project_id,
        toolkit_class=NoteTakingToolkit,
        pool_key=Agents.clinical_pharmacologist,
        api_task_id=options.project_id,
        agent_name=Agents.clinical_pharmacologist,
        working_directory=working_directory,
    )
    note_toolkit = message_integration.register_toolkits(note_toolkit)
    
    tools = [
        *image_analysis_toolkit.get_tools(),
        *search_toolkit.get_can_use_tools(
            options.project_id
        ),
        *HumanToolkit.get_can_use_tools(
            options.project_id, Agents.clinical_pharmacologist
        ),
        *note_toolkit.get_tools(),
    ]
    
    system_message = CLINICAL_PHARMACOLOGIST_PROMPT.format(
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
        Agents.clinical_pharmacologist,
        BaseMessage.make_assistant_message(
            role_name="Clinical Pharmacologist",
            content=system_message,
        ),
        options,
        tools,
        tool_names=[
            ImageAnalysisToolkit.toolkit_name(),
            SearchToolkit.toolkit_name(),
            HumanToolkit.toolkit_name(),
            NoteTakingToolkit.toolkit_name(),
        ],
        support_native_tool_calling=not effective_config.use_simulated_tool_calling,
        custom_model_config=custom_config,
    )
