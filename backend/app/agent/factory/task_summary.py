

from app.agent.agent_model import agent_model
from app.agent.prompt import TASK_SUMMARY_SYS_PROMPT
from app.model.chat import Chat


def task_summary_agent(options: Chat):
    return agent_model(
        "task_summary_agent",
        TASK_SUMMARY_SYS_PROMPT,
        options,
    )
