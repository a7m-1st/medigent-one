

import platform

from camel.messages import BaseMessage
from camel.toolkits import ToolkitMessageIntegration

from app.agent.agent_model import agent_model
from app.agent.listen_chat_agent import logger
from app.agent.prompt import CHIEF_OF_MEDICINE_PROMPT
from app.agent.toolkit.document_analysis_toolkit import (
    DocumentAnalysisToolkit,
)
from app.agent.toolkit.human_toolkit import HumanToolkit
from app.agent.toolkit.image_analysis_toolkit import ImageAnalysisToolkit
from app.agent.toolkit.note_taking_toolkit import NoteTakingToolkit
from app.agent.utils import NOW_STR
from app.model.chat import AgentConfig, Chat
from app.service.model_registry import get_or_create_model
from app.service.task import Agents
from app.service.toolkit_pool import get_or_create_toolkit
from app.utils.file_utils import get_working_directory


async def chief_of_medicine_agent(options: Chat):
    """Create Chief of Medicine agent (Gemini 3 - Coordinator)
    
    This agent uses global Chat config for task orchestration.
    """
    working_directory = get_working_directory(options)
    logger.info(
        f"Creating Chief of Medicine agent for project: {options.project_id} "
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
            options.project_id, Agents.chief_of_medicine
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
    note_toolkit = get_or_create_toolkit(
        project_id=options.project_id,
        toolkit_class=NoteTakingToolkit,
        pool_key=Agents.chief_of_medicine,
        api_task_id=options.project_id,
        agent_name=Agents.chief_of_medicine,
        working_directory=working_directory,
    )
    note_toolkit = message_integration.register_toolkits(note_toolkit)
    
    document_analysis_toolkit = get_or_create_toolkit(
        project_id=options.project_id,
        toolkit_class=DocumentAnalysisToolkit,
        pool_key=Agents.chief_of_medicine,
        api_task_id=options.project_id,
        working_directory=working_directory,
    )
    document_analysis_toolkit.agent_name = Agents.chief_of_medicine
    document_analysis_toolkit = message_integration.register_toolkits(
        document_analysis_toolkit
    )
    
    image_analysis_toolkit = get_or_create_toolkit(
        project_id=options.project_id,
        toolkit_class=ImageAnalysisToolkit,
        pool_key=Agents.chief_of_medicine,
        api_task_id=options.project_id,
        model=toolkit_model,
    )
    image_analysis_toolkit.agent_name = Agents.chief_of_medicine
    image_analysis_toolkit = message_integration.register_toolkits(
        image_analysis_toolkit
    )
    
    tools = [
        *HumanToolkit.get_can_use_tools(
            options.project_id, Agents.chief_of_medicine
        ),
        *note_toolkit.get_tools(),
        *document_analysis_toolkit.get_tools(),
        *image_analysis_toolkit.get_tools(),
    ]
    
    system_message = CHIEF_OF_MEDICINE_PROMPT.format(
        platform_system=platform.system(),
        platform_machine=platform.machine(),
        working_directory=working_directory,
        now_str=NOW_STR,
    )
    
    # Create custom model config for this agent
    from app.model.chat import AgentModelConfig
    custom_config = AgentModelConfig(
        model_platform=effective_config.model_platform,
        model_type=effective_config.model_type,
        api_key=effective_config.api_key,
        api_url=effective_config.api_url,
    ) if effective_config.has_custom_config() else None
    
    return agent_model(
        Agents.chief_of_medicine,
        BaseMessage.make_assistant_message(
            role_name="Chief of Medicine",
            content=system_message,
        ),
        options,
        tools,
        tool_names=[
            HumanToolkit.toolkit_name(),
            NoteTakingToolkit.toolkit_name(),
            DocumentAnalysisToolkit.toolkit_name(),
            ImageAnalysisToolkit.toolkit_name(),
        ],
        support_native_tool_calling=not options.use_simulated_tool_calling,
        custom_model_config=custom_config,
    )
