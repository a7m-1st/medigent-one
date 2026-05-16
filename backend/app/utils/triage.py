"""
Task Complexity Triage Module

Evaluates incoming user questions and determines the appropriate
processing path:
- SIMPLE: Direct answer from Coordinator (no agent orchestration)
- MODERATE: 1-2 specialized agents
- COMPLEX: Full multi-agent task decomposition

This improves efficiency for simple queries while preserving
multi-agent capabilities for complex tasks.
"""

import logging
from dataclasses import dataclass
from enum import Enum
from typing import Optional

from camel.agents import ChatAgent

logger = logging.getLogger("triage")


class ComplexityLevel(str, Enum):
    """Task complexity classification."""
    SIMPLE = "simple"      # Direct answer, no tools needed
    MODERATE = "moderate"  # 1-2 agents needed
    COMPLEX = "complex"    # Full multi-agent orchestration


@dataclass
class TriageResult:
    """Result of task complexity assessment."""
    complexity: ComplexityLevel
    reasoning: str
    suggested_agents: list[str]  # Empty for SIMPLE, 1-2 for MODERATE
    direct_answer: Optional[str] = None  # Pre-generated answer for SIMPLE


# Triage prompt for the coordinator to evaluate task complexity
TRIAGE_PROMPT = """You are a medical assistant coordinator. Your job is to evaluate the user's question and determine how to best answer it.

## Classification Rules

### SIMPLE (Direct Answer)
Questions that can be answered directly from medical knowledge without any tools:
- General medical knowledge questions (e.g., "What is hypertension?", "What are symptoms of diabetes?", "What is COPD?")
- Medical term explanations or definitions mentioned in prior conversation
- Basic health information
- Simple factual questions about conditions, medications, or procedures
- Follow-up questions asking to explain a medical term or concept from a previous response, even if earlier messages had attachments
- Questions like "explain", "what is X?", "tell me about Y" that require NO tools and NO file analysis

### MODERATE (1-2 Agents)
Questions that need ONE specific specialist:
- Medical image/scan/X-ray/MRI/photo analysis → radiologist
- Web search for latest clinical research or drug information → clinical_researcher
- Writing medical reports, notes, or documentation → medical_scribe
- Drug interactions, prescriptions, or pharmacology → clinical_pharmacologist
- Patient diagnosis, symptoms, or treatment planning → attending_physician
- Complex clinical decision-making or oversight → chief_of_medicine
- **PDF, DOCX, or other document files attached** → chief_of_medicine OR clinical_researcher (these are the ONLY agents that can read documents)

### COMPLEX (Full Orchestration)
Questions that require MULTIPLE specialists combined:
- Analyzing images AND generating a clinical report
- Research + diagnosis + treatment plan
- Multi-step workflows with dependencies
- Tasks explicitly requesting multiple outputs or disciplines

## CRITICAL DOCUMENT ROUTING RULES
**IMPORTANT**: Only the **Chief of Medicine** and **Clinical Researcher** can read PDF, DOCX, XLSX, and other document files. These agents use the stronger Gemini model with document analysis capabilities.

The following agents CANNOT read documents:
- Radiologist (image analysis only)
- Attending Physician (clinical reasoning only, no document reading)
- Clinical Pharmacologist (drug information only, no document reading)
- Medical Scribe (report writing only, no document reading)

When the user provides a PDF or document file:
1. If it's a medical document needing review/analysis → route to **chief_of_medicine**
2. If it's a research paper or literature → route to **clinical_researcher**
3. If the document needs to be analyzed AND a clinical assessment is needed → route to BOTH **chief_of_medicine** and the relevant specialist (COMPLEX)
4. NEVER route document files to radiologist, attending_physician, or clinical_pharmacologist — they cannot read them

## Conversation Context
The following shows the recent conversation history. You MUST use this information to answer questions about what was said before:

{conversation_context}

## User's Question
{question}

IMPORTANT: When answering, ONLY state what the user said from the context above. DO NOT add any disclaimers about not remembering, conversations starting fresh, privacy features, or technical limitations. The user is asking about the CURRENT conversation which you CAN see above.

## Attached Files
{attachments}

## Available MCP Servers
The following MCP (Model Context Protocol) servers are available and can provide additional tools:
{mcp_servers}

If specific MCP servers are available that match the task requirements, you may consider routing to MODERATE instead of COMPLEX if the MCP tools can handle the task efficiently.

## Your Task
Analyze the question and respond in this EXACT format:

COMPLEXITY: [SIMPLE|MODERATE|COMPLEX]
REASONING: [Brief explanation of why this classification]
AGENTS: [Comma-separated list of needed agents, or "none" for SIMPLE]

If COMPLEXITY is SIMPLE, also provide:
ANSWER: [Your direct, helpful answer to the question]

CRITICAL INSTRUCTIONS:
1. For SIMPLE questions, provide a complete, accurate answer
2. If asked about previous messages, ONLY report what you see in the Conversation Context - NO DISCLAIMERS about memory or fresh starts
3. NEVER say "I cannot repeat/recall", "conversations start fresh", "I don't store information", or similar phrases
4. Be conservative: when in doubt, classify as MODERATE or COMPLEX
5. Any attached image (jpg, png, etc.) IN THE CURRENT MESSAGE requires radiologist (MODERATE or higher)
6. Any attached document (PDF, DOCX, XLSX, etc.) MUST be routed to chief_of_medicine or clinical_researcher — NEVER to radiologist, attending_physician, or clinical_pharmacologist
7. Available agents: radiologist, clinical_researcher, medical_scribe, clinical_pharmacologist, attending_physician, chief_of_medicine
8. If the current question has NO attachments and is asking to explain/define a medical term or concept (even one mentioned in prior conversation), classify as SIMPLE — do NOT route to any agent
9. Previous attachments in conversation history do NOT affect the current question's classification. Only CURRENT attachments matter for routing
"""


def parse_triage_response(response: str) -> TriageResult:
    """Parse the coordinator's triage response into a TriageResult."""
    lines = response.strip().split('\n')

    complexity = ComplexityLevel.COMPLEX  # Default to most conservative
    reasoning = ""
    agents = []
    direct_answer = None

    current_section = None
    answer_lines = []

    for line in lines:
        line_stripped = line.strip()

        if line_stripped.startswith("COMPLEXITY:"):
            value = line_stripped.replace("COMPLEXITY:", "").strip().upper()
            if value == "SIMPLE":
                complexity = ComplexityLevel.SIMPLE
            elif value == "MODERATE":
                complexity = ComplexityLevel.MODERATE
            else:
                complexity = ComplexityLevel.COMPLEX
            current_section = "complexity"

        elif line_stripped.startswith("REASONING:"):
            reasoning = line_stripped.replace("REASONING:", "").strip()
            current_section = "reasoning"

        elif line_stripped.startswith("AGENTS:"):
            agents_str = line_stripped.replace("AGENTS:", "").strip().lower()
            if agents_str and agents_str != "none":
                agents = [a.strip() for a in agents_str.split(",") if a.strip()]
            current_section = "agents"

        elif line_stripped.startswith("ANSWER:"):
            answer_lines = [line_stripped.replace("ANSWER:", "").strip()]
            current_section = "answer"

        elif current_section == "answer" and line_stripped:
            # Continue collecting answer lines
            answer_lines.append(line_stripped)

    if answer_lines:
        direct_answer = "\n".join(answer_lines)

    return TriageResult(
        complexity=complexity,
        reasoning=reasoning,
        suggested_agents=agents,
        direct_answer=direct_answer,
    )


async def evaluate_task_complexity(
    coordinator_agent: ChatAgent,
    question: str,
    attachments: list[str] | None = None,
    conversation_context: str = "",
    installed_mcp: dict | None = None,
) -> TriageResult:
    """
    Evaluate the complexity of a user's question using the coordinator agent.

    Args:
        coordinator_agent: The coordinator agent to use for evaluation
        question: The user's question
        attachments: List of file paths attached to the question
        conversation_context: Previous conversation context for continuity
        installed_mcp: MCP server configuration with mcpServers dict

    Returns:
        TriageResult with complexity level and optional direct answer
    """
    # Format attachments info
    if attachments:
        attachments_info = "\n".join(f"- {path}" for path in attachments)
    else:
        attachments_info = "None"

    # Extract MCP server names if available
    mcp_servers_info = "None"
    if installed_mcp:
        mcp_servers = installed_mcp.get("mcpServers", {})
        if mcp_servers:
            server_names = list(mcp_servers.keys())
            mcp_servers_info = ", ".join(server_names) if server_names else "None"

    # Build the triage prompt with conversation context
    prompt = TRIAGE_PROMPT.format(
        conversation_context=conversation_context if conversation_context else "No previous conversation",
        question=question,
        attachments=attachments_info,
        mcp_servers=mcp_servers_info,
    )

    logger.info(f"[TRIAGE] Evaluating question complexity: {question[:100]}...")

    try:
        # Get coordinator's assessment
        response = coordinator_agent.step(prompt)
        response_text = response.msgs[0].content if response.msgs else ""

        logger.debug(f"[TRIAGE] Raw response: {response_text[:500]}...")

        # Parse the response
        result = parse_triage_response(response_text)

        logger.info(
            f"[TRIAGE] Result: complexity={result.complexity.value}, "
            f"agents={result.suggested_agents}, "
            f"reasoning={result.reasoning[:100]}..."
        )

        # Validation: if attachments exist, cannot be SIMPLE
        if attachments and result.complexity == ComplexityLevel.SIMPLE:
            # Determine if attachments are documents or images
            document_extensions = {
                '.pdf', '.doc', '.docx', '.txt', '.html', '.htm',
                '.csv', '.json', '.xml', '.xlsx', '.xls',
                '.pptx', '.ppt', '.epub',
            }
            has_documents = any(
                any(path.lower().endswith(ext) for ext in document_extensions)
                for path in attachments
            )

            if has_documents:
                # Documents must go to Gemini agents (chief_of_medicine or clinical_researcher)
                logger.info(
                    "[TRIAGE] Upgrading SIMPLE to MODERATE due to document attachments "
                    "— routing to chief_of_medicine"
                )
                result = TriageResult(
                    complexity=ComplexityLevel.MODERATE,
                    reasoning=f"Has document attachments (PDF/DOCX/etc.) that require document analysis. "
                              f"Only chief_of_medicine and clinical_researcher can read documents. "
                              f"Original: {result.reasoning}",
                    suggested_agents=["chief_of_medicine"],
                    direct_answer=None,
                )
            else:
                # Image attachments go to radiologist
                logger.info(
                    "[TRIAGE] Upgrading SIMPLE to MODERATE due to image attachments"
                )
                result = TriageResult(
                    complexity=ComplexityLevel.MODERATE,
                    reasoning=f"Has image attachments. Original: {result.reasoning}",
                    suggested_agents=["radiologist"],
                    direct_answer=None,
                )

        return result

    except Exception as e:
        logger.error(f"[TRIAGE] Error during evaluation: {e}", exc_info=True)
        # Default to COMPLEX on error (most conservative)
        return TriageResult(
            complexity=ComplexityLevel.COMPLEX,
            reasoning=f"Error during triage: {str(e)}",
            suggested_agents=[],
            direct_answer=None,
        )
