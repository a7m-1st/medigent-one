import {
  useAgentStatusStore,
  useChatStore,
  useResourceStore,
  useTaskDecompStore,
} from '@/stores';
import {
  AGENT_DISPLAY_NAMES,
  MAIN_AGENT_NAMES,
} from '@/stores/agentStatusStore';
import { useProjectStore } from '@/stores/projectStore';
import type { ChatMessage } from '@/types';
import {
  SSEEventSchema,
  type SSEActivateAgentEvent,
  type SSEActivateToolkitEvent,
  type SSEAskEvent,
  type SSEAssignTaskEvent,
  type SSEConfirmedEvent,
  type SSECreateAgentEvent,
  type SSEDeactivateAgentEvent,
  type SSEDeactivateToolkitEvent,
  type SSEDecomposeTextEvent,
  type SSEEndEvent,
  type SSEErrorEvent,
  type SSEEvent,
  type SSENoticeEvent,
  type SSETaskStateEvent,
  type SSEToSubTasksEvent,
  type SSEWriteFileEvent,
  type SSTerminalEvent,
} from '@/types';
import type { SSEMedgemmaStatusEvent } from '@/types/sse';
import { useCallback } from 'react';

// ============================================
// Agent Info Cache - Store agent data from create_agent but don't display yet
// ============================================
interface AgentInfo {
  agentId: string;
  agentName: string;
  tools: string[];
}

const agentInfoCache: Map<string, AgentInfo> = new Map();

function cacheAgentInfo(agentId: string, agentName: string, tools: string[]) {
  agentInfoCache.set(agentId, { agentId, agentName, tools });
  // Also cache by name for reverse lookup
  agentInfoCache.set(agentName, { agentId, agentName, tools });
}

function getAgentInfoById(agentId: string): AgentInfo | undefined {
  return agentInfoCache.get(agentId);
}

function getAgentInfoByName(agentName: string): AgentInfo | undefined {
  return agentInfoCache.get(agentName);
}

export function clearAgentInfoCache() {
  agentInfoCache.clear();
}

// ============================================
// Main Agent Names check helper
// ============================================
function isMainAgent(name: string): boolean {
  return MAIN_AGENT_NAMES.includes(name as any);
}

function ensureMainAgentExists(
  agentName: string,
  agentId: string,
  tools: string[] = [],
): void {
  if (!isMainAgent(agentName)) {
    return;
  }

  const store = useAgentStatusStore.getState();
  const existing = store.agents[agentName];
  if (!existing) {
    // Check if we have cached info from a create_agent event
    const cachedInfo = getAgentInfoByName(agentName);
    if (cachedInfo) {
      store.createAgent(agentId, agentName, cachedInfo.tools);
    } else {
      store.createAgent(agentId, agentName, tools);
    }
    return;
  }

  store.registerAgentId(agentName, agentId);
}

/**
 * Hook to handle all server events and route to appropriate stores.
 * Events arrive over WebSocket in the same {"step": ..., "data": ...} format
 * that was previously used with SSE. The handler is transport-agnostic.
 *
 * KEY DESIGN DECISION: The backend uses different agent_ids across different events
 * for the same agent. For example, create_agent might assign id "431ef789..." but
 * activate_agent uses id "b9acbcd8..." for the same clinical_researcher. The agent_name
 * is the ONLY consistent identifier, so all lookups go through agent_name.
 */
export interface SSEHandlerOptions {
  /**
   * Callback invoked when task decomposition is final and the task should
   * be auto-started.  When using WebSocket, this sends a ``start_task``
   * message over the existing connection instead of making a REST call.
   */
  onStartTask?: (projectId: string) => void;
}

export function useSSEHandler(options: SSEHandlerOptions = {}) {
  const agentStore = useAgentStatusStore();
  const taskStore = useTaskDecompStore();
  const resourceStore = useResourceStore();
  const chatStore = useChatStore();

  // Helper: add message to both chatStore and projectStore for persistence
  function addMessageAndPersist(message: ChatMessage) {
    chatStore.addMessage(message);
    const projectId = useChatStore.getState().currentProjectId;
    if (projectId) {
      useProjectStore.getState().addMessageToProject(projectId, message);
    }
  }

  const handleEvent = useCallback(
    (event: unknown) => {
      let validatedEvent: SSEEvent;

      const parsed = SSEEventSchema.safeParse(event);
      if (!parsed.success) {
        console.warn('Invalid SSE event received:', parsed.error.issues, event);
        return;
      }
      validatedEvent = parsed.data;

      const { data, step } = validatedEvent;

      switch (step) {
        case 'confirmed':
          handleConfirmed(data as SSEConfirmedEvent['data']);
          break;

        case 'create_agent':
          handleCreateAgent(data as SSECreateAgentEvent['data']);
          break;

        case 'activate_agent':
          handleActivateAgent(data as SSEActivateAgentEvent['data']);
          break;

        case 'deactivate_agent':
          handleDeactivateAgent(data as SSEDeactivateAgentEvent['data']);
          break;

        case 'activate_toolkit':
          handleActivateToolkit(data as SSEActivateToolkitEvent['data']);
          break;

        case 'deactivate_toolkit':
          handleDeactivateToolkit(data as SSEDeactivateToolkitEvent['data']);
          break;

        case 'decompose_text':
          handleDecomposeText(data as SSEDecomposeTextEvent['data']);
          break;

        case 'to_sub_tasks':
          handleToSubTasks(data as SSEToSubTasksEvent['data']);
          break;

        case 'assign_task':
          handleAssignTask(data as SSEAssignTaskEvent['data']);
          break;

        case 'task_state':
          handleTaskState(data as SSETaskStateEvent['data']);
          break;

        case 'terminal':
          handleTerminal(data as SSTerminalEvent['data']);
          break;

        case 'write_file':
          handleWriteFile(data as SSEWriteFileEvent['data']);
          break;

        case 'notice':
          handleNotice(data as SSENoticeEvent['data']);
          break;

        case 'ask':
          handleAsk(data as SSEAskEvent['data']);
          break;

        case 'end':
          handleEnd(data as SSEEndEvent['data']);
          break;

        case 'error':
          handleError(data as SSEErrorEvent['data']);
          break;

        case 'budget_not_enough':
          handleBudgetNotEnough(data);
          break;

        case 'medgemma_status':
          handleMedgemmaStatus(data as SSEMedgemmaStatusEvent['data']);
          break;

        default:
          console.warn('Unhandled SSE event:', step);
      }
    },
    [agentStore, taskStore, resourceStore, chatStore],
  );

  // ============================================
  // Event Handlers
  // ============================================

  function handleConfirmed(data: SSEConfirmedEvent['data']) {
    // Clear any previous errors
    chatStore.setError(null);
    // Note: User message is now added immediately in TaskInputPanel with images
    // This confirmed event just signals the backend received the question
    console.log(
      '[SSE] Question confirmed:',
      data.question.slice(0, 50) + '...',
    );
  }

  function handleCreateAgent(data: SSECreateAgentEvent['data']) {
    // Cache the agent info but don't display/create yet
    // Agent will only be displayed when an assign_task event is received
    if (isMainAgent(data.agent_name)) {
      cacheAgentInfo(data.agent_id, data.agent_name, data.tools);
      // Register the ID mapping in the store for lookups
      agentStore.registerAgentId(data.agent_name, data.agent_id);
    }
  }

  function handleActivateAgent(data: SSEActivateAgentEvent['data']) {
    if (isMainAgent(data.agent_name)) {
      // Ensure the agent entry exists even if create_agent was missed/delayed
      ensureMainAgentExists(data.agent_name, data.agent_id);
      agentStore.setAgentWorking(
        data.agent_name,
        data.agent_id,
        data.process_task_id,
        data.message,
      );
    }
  }

  function handleDeactivateAgent(data: SSEDeactivateAgentEvent['data']) {
    if (isMainAgent(data.agent_name)) {
      // Ensure the agent entry exists even if create_agent was missed/delayed
      ensureMainAgentExists(data.agent_name, data.agent_id);
      agentStore.setAgentCompleted(
        data.agent_name,
        data.agent_id,
        data.message,
        data.tokens,
      );
    } else if (data.agent_name === 'task_summary_agent') {
      taskStore.setSummaryTask(data.message);

      // Extract project title from message (format: "Title | Description")
      // and update the project in projectStore
      const projectId = useChatStore.getState().currentProjectId;
      if (projectId && data.message) {
        const parts = data.message.split('|');
        const title =
          parts.length >= 2
            ? parts.slice(1).join('|').trim() // Everything after the first pipe
            : data.message.slice(0, 80);
        useProjectStore.getState().updateProject(projectId, { title });
        // Update HTML title
        document.title = `Medigent One | ${title}`;
      }
    }
  }

  function handleActivateToolkit(data: SSEActivateToolkitEvent['data']) {
    // Toolkit events only have agent_name, not agent_id
    if (isMainAgent(data.agent_name)) {
      agentStore.setAgentToolkit(
        data.agent_name,
        data.toolkit_name,
        data.method_name,
        data.message,
      );
      // Only pipe Terminal Toolkit commands into inline terminal output
      if (data.message && data.toolkit_name === 'Terminal Toolkit') {
        const agent = useAgentStatusStore.getState().agents[data.agent_name];
        resourceStore.addTerminalOutput(
          data.agent_name,
          data.process_task_id,
          agent?.displayName || data.agent_name,
          `> ${data.method_name}: ${data.message}`,
        );
      }
    }
  }

  function handleDeactivateToolkit(data: SSEDeactivateToolkitEvent['data']) {
    if (isMainAgent(data.agent_name)) {
      // Only pipe Terminal Toolkit results into inline terminal output
      if (data.message && data.toolkit_name === 'Terminal Toolkit') {
        const agent = useAgentStatusStore.getState().agents[data.agent_name];
        resourceStore.addTerminalOutput(
          data.agent_name,
          data.process_task_id,
          agent?.displayName || data.agent_name,
          data.message,
        );
      }
      agentStore.clearAgentToolkit(data.agent_name, data.message);
    }
  }

  function handleDecomposeText(data: SSEDecomposeTextEvent['data']) {
    taskStore.appendDecomposeText(data.content);
  }

  function handleToSubTasks(data: SSEToSubTasksEvent['data']) {
    taskStore.setTaskTree(data.sub_tasks);
    if (data.summary_task) {
      taskStore.setSummaryTask(data.summary_task);
    }

    // Auto-start task execution when decomposition is final
    if (data.is_final && data.project_id) {
      console.log(
        '[SSEHandler] Decomposition final, auto-starting task for project:',
        data.project_id,
      );
      if (options.onStartTask) {
        // Send start_task over the existing WebSocket connection
        try {
          options.onStartTask(data.project_id);
        } catch (err: unknown) {
          console.error('[SSEHandler] Failed to auto-start task via WS:', err);
          const errorMsg = err instanceof Error ? err.message : String(err);
          chatStore.setError('Failed to start task execution: ' + errorMsg);
        }
      } else {
        console.warn(
          '[SSEHandler] No onStartTask callback — cannot auto-start task',
        );
      }
    }
  }

  function handleAssignTask(data: SSEAssignTaskEvent['data']) {
    // Look up agent name by the assignee_id using the reverse lookup
    const store = useAgentStatusStore.getState();
    let agentName = store.getAgentNameById(data.assignee_id);

    // If agent doesn't exist yet but we have cached info, create it now
    if (!agentName) {
      const cachedInfo = getAgentInfoById(data.assignee_id);
      if (cachedInfo && isMainAgent(cachedInfo.agentName)) {
        agentName = cachedInfo.agentName;
        // Create the agent now that it has a task assigned
        store.createAgent(
          data.assignee_id,
          cachedInfo.agentName,
          cachedInfo.tools,
        );
      }
    }

    const agent = agentName ? store.agents[agentName] : undefined;
    const displayName = agent?.displayName || 'Agent';

    taskStore.assignTask(data.task_id, data.assignee_id, displayName);

    // Also update task state from the assign event
    taskStore.updateTaskState(data.task_id, data.state.toLowerCase());

    // Also update the agent's state if we know who it is
    if (agentName && isMainAgent(agentName)) {
      if (data.state === 'running') {
        store.setAgentWorking(
          agentName,
          data.assignee_id,
          data.task_id,
          data.content,
        );
      } else if (data.state === 'waiting') {
        store.addAgentActivity(
          agentName,
          'notice',
          `Assigned task: ${data.content.slice(0, 100)}...`,
        );
      }
    }
  }

  function handleTaskState(data: SSETaskStateEvent['data']) {
    const normalizedState = data.state.toLowerCase();
    taskStore.updateTaskState(data.task_id, normalizedState);

    // If task failed, check if we can identify the agent and update its state
    if (normalizedState === 'failed' && data.result) {
      // Stop streaming when task permanently fails
      chatStore.setStreaming(false);
      chatStore.setLoading(false);

      // Add error message to chat as system message
      const errorMessage = data.result.slice(0, 200);
      chatStore.addMessage({
        id: `error-${Date.now()}`,
        role: 'system',
        content: `Task failed: \n${errorMessage}. \n\nPlease open the Agents Activity panel to view detailed logs.`,
        timestamp: new Date().toISOString(),
        metadata: { isError: true },
      });

      // Try to find which agent was working on this task and update its state
      const currentAgents = useAgentStatusStore.getState().agents;
      for (const agentName of MAIN_AGENT_NAMES) {
        const agent = currentAgents[agentName];
        if (agent && agent.currentTaskId === data.task_id) {
          useAgentStatusStore.getState().setAgentError(agentName, errorMessage);
          break;
        }
      }
    }
  }

  function handleTerminal(data: SSTerminalEvent['data']) {
    // Find which agent this terminal output belongs to by checking currentTaskId
    const currentAgents = useAgentStatusStore.getState().agents;
    let foundAgent: { name: string; displayName: string } | null = null;

    for (const agentName of MAIN_AGENT_NAMES) {
      const agent = currentAgents[agentName];
      if (agent && agent.currentTaskId === data.process_task_id) {
        foundAgent = { name: agentName, displayName: agent.displayName };
        break;
      }
    }

    if (foundAgent) {
      resourceStore.addTerminalOutput(
        foundAgent.name,
        data.process_task_id,
        foundAgent.displayName,
        data.data,
      );
    } else {
      // Fallback: add to medical_scribe since terminal output is typically from that agent
      resourceStore.addTerminalOutput(
        'medical_scribe',
        data.process_task_id,
        'Medical Scribe',
        data.data,
      );
    }
  }

  function handleWriteFile(data: SSEWriteFileEvent['data']) {
    addMessageAndPersist({
      id: `file-${Date.now()}`,
      role: 'system',
      content: `File created: ${data.file_path}`,
      timestamp: new Date().toISOString(),
    });

    // Track file in project store
    const projectId = useChatStore.getState().currentProjectId;
    if (projectId) {
      useProjectStore.getState().addFileToProject(projectId, data.file_path);
    }
  }

  function handleNotice(data: SSENoticeEvent['data']) {
    // Add as chat message and persist to project
    addMessageAndPersist({
      id: `notice-${Date.now()}`,
      role: 'system',
      content: data.notice,
      timestamp: new Date().toISOString(),
    });

    // Also find the agent working on this task and add to its activity log
    const currentAgents = useAgentStatusStore.getState().agents;
    for (const agentName of MAIN_AGENT_NAMES) {
      const agent = currentAgents[agentName];
      if (agent && agent.currentTaskId === data.process_task_id) {
        useAgentStatusStore
          .getState()
          .addAgentActivity(agentName, 'notice', data.notice);
        break;
      }
    }
  }

  function handleAsk(data: SSEAskEvent['data']) {
    // Convert camelcase agent name to display name
    const agentDisplayName = AGENT_DISPLAY_NAMES[data.agent] || data.agent;

    // Set state to indicate we're waiting for human reply
    chatStore.setWaitingForHumanReply(true, data.agent, agentDisplayName);
    // Clear loading state so user can interact with the input
    chatStore.setLoading(false);

    addMessageAndPersist({
      id: `ask-${Date.now()}`,
      role: 'assistant',
      content: `**${agentDisplayName}** is asking:\n\n${data.question}`,
      timestamp: new Date().toISOString(),
    });
  }

  function handleEnd(data: SSEEndEvent['data']) {
    // Clear any pending human reply state when task ends
    chatStore.setWaitingForHumanReply(false, null);

    taskStore.setFinalSummary(data);

    // Calculate duration
    const startTime = useChatStore.getState().streamingStartTime;
    console.log(
      '[handleEnd] streamingStartTime:',
      startTime,
      'Date.now():',
      Date.now(),
    );
    const duration = startTime ? Date.now() - startTime : null;
    console.log('[handleEnd] duration:', duration);

    addMessageAndPersist({
      id: `end-${Date.now()}`,
      role: 'assistant',
      content: data,
      timestamp: new Date().toISOString(),
      metadata: duration ? { duration } : undefined,
    });

    // Clear streaming state
    chatStore.setStreaming(false);
    // Also clear the start time manually
    useChatStore.getState().streamingStartTime = null;

    // Mark all remaining running/waiting tasks as done
    taskStore.completeRemainingTasks();

    // Mark all working agents as completed
    // Use getState() to get fresh state, not stale closure reference
    const currentAgents = useAgentStatusStore.getState().agents;
    for (const agentName of MAIN_AGENT_NAMES) {
      const agent = currentAgents[agentName];
      if (agent && agent.state === 'working') {
        useAgentStatusStore
          .getState()
          .setAgentCompleted(
            agentName,
            agent.knownIds[0] || '',
            'Task completed',
            0,
          );
      }
    }
  }

  function handleError(data: SSEErrorEvent['data']) {
    // Detect rate-limit (429) errors
    const msg = data.message || '';
    const isRateLimit = /429|rate.?limit|too many requests|quota.*exceed/i.test(
      msg,
    );

    // Display the error but don't reset connection state
    // WebSocket stays open; the backend may retry the operation
    chatStore.setError(msg, isRateLimit ? 'rate_limit' : 'generic');

    // Only mark agents as having an error, but keep the session alive
    // so the backend can retry on the persistent WS connection
    if (!isRateLimit) {
      // For non-rate-limit errors, we might want to stop
      chatStore.setStreaming(false);
      chatStore.setLoading(false);
      // Clear any pending human reply state on error
      chatStore.setWaitingForHumanReply(false, null);

      // Cancel all pending tasks and mark working agents as error
      // Use getState() to get fresh state
      taskStore.cancelPendingTasks();
      const currentAgents = useAgentStatusStore.getState().agents;
      for (const agentName of MAIN_AGENT_NAMES) {
        const agent = currentAgents[agentName];
        if (agent && agent.state === 'working') {
          useAgentStatusStore
            .getState()
            .setAgentError(agentName, msg.slice(0, 200));
        }
      }
    }
    // For rate limit errors, keep the session running so the backend can retry
  }

  function handleBudgetNotEnough(data: any) {
    chatStore.setError(
      'Budget not enough: ' + (data.message || 'Insufficient budget'),
      'budget',
    );
    // Keep session running — backend may retry or user can send a new message
  }

  function handleMedgemmaStatus(data: SSEMedgemmaStatusEvent['data']) {
    if (data.status === 'warming_up') {
      // Show a non-blocking warning banner while the endpoint warms up
      chatStore.setError(data.message, 'warming_up');
    } else if (data.status === 'ready') {
      // Endpoint is available — dismiss the warming-up banner
      chatStore.clearError();
    } else if (data.status === 'unavailable') {
      // Endpoint didn't come up in time — show as generic error
      chatStore.setError(data.message, 'generic');
    }
  }

  return { handleEvent };
}
