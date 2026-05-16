

from app.agent.agent_model import agent_model
from app.agent.prompt import QUESTION_CONFIRM_SYS_PROMPT
from app.agent.utils import NOW_STR
from app.model.chat import Chat


def question_confirm_agent(options: Chat):
    return agent_model(
        "question_confirm_agent",
        QUESTION_CONFIRM_SYS_PROMPT.format(now_str=NOW_STR),
        options,
    )
