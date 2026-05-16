import { z } from 'zod';
import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';

// ============================================
// Zod Schemas
// ============================================

export const ActivityEntrySchema = z.object({
  id: z.string(),
  type: z.enum(['created', 'activated', 'deactivated', 'toolkit_start', 'toolkit_end', 'error', 'notice']),
  message: z.string(),
  timestamp: z.date(),
  metadata: z.any().optional(),
});

export type ActivityEntry = z.infer<typeof ActivityEntrySchema>;

export const AgentStatusSchema = z.object({
  name: z.enum([
    'attending_physician',
    'chief_of_medicine',
    'clinical_pharmacologist',
    'clinical_researcher',
    'medical_scribe',
    'radiologist',
    'mcp_agent',
  ]),
  displayName: z.string(),
  // Track all known IDs for this agent (backend may use different IDs across events)
  knownIds: z.array(z.string()),
  state: z.enum(['idle', 'working', 'completed', 'error']),
  currentTaskId: z.string().optional(),
  currentTaskContent: z.string().optional(),
  currentToolkit: z.string().optional(),
  currentMethod: z.string().optional(),
  // Full input/output for "thinking" display
  lastInput: z.string().optional(),      // Full activate_agent message
  lastOutput: z.string().optional(),     // Full deactivate_agent message
  tools: z.array(z.string()).default([]),
  tokensUsed: z.number().default(0),
  lastActivity: z.date(),
  activityLog: z.array(ActivityEntrySchema).default([]),
});

export type AgentStatus = z.infer<typeof AgentStatusSchema>;

// ============================================
// Display name mapping
// ============================================
export const AGENT_DISPLAY_NAMES: Record<string, string> = {
  attending_physician: 'Attending Physician',
  chief_of_medicine: 'Chief of Medicine',
  clinical_pharmacologist: 'Clinical Pharmacologist',
  clinical_researcher: 'Clinical Researcher',
  medical_scribe: 'Medical Scribe',
  radiologist: 'Radiologist',
  mcp_agent: 'MCP Agent',
};

// Agents routed through the secondary_agent config (Gemma 4 in Medigent One)
export const MEDGEMMA_AGENTS: string[] = [
  'attending_physician',
  'clinical_pharmacologist',
  'radiologist',
];

// ============================================
// Main Agents List
// ============================================
export const MAIN_AGENT_NAMES = [
  'attending_physician',
  'chief_of_medicine',
  'clinical_pharmacologist',
  'clinical_researcher',
  'medical_scribe',
  'radiologist',
  'mcp_agent',
] as const;

export type MainAgentName = typeof MAIN_AGENT_NAMES[number];

// ============================================
// Store Interface
// ============================================
interface AgentStatusState {
  // State - keyed by agent_name (the only consistent identifier across events)
  agents: Record<string, AgentStatus>;
  // Reverse lookup: agent_id -> agent_name (for events that only have agent_id)
  idToName: Record<string, string>;

  // Actions
  createAgent: (agentId: string, agentName: string, tools: string[]) => void;
  setAgentWorking: (agentName: string, agentId: string, taskId: string, content: string) => void;
  setAgentCompleted: (agentName: string, agentId: string, message: string, tokens?: number) => void;
  setAgentError: (agentName: string, error: string) => void;
  setAgentToolkit: (agentName: string, toolkit: string, method: string, argsMessage?: string) => void;
  clearAgentToolkit: (agentName: string, resultMessage?: string) => void;
  addAgentActivity: (agentName: string, type: ActivityEntry['type'], message: string) => void;
  registerAgentId: (agentName: string, agentId: string) => void;
  reset: () => void;

  // Getters
  getAgentByName: (name: string) => AgentStatus | undefined;
  getAgentNameById: (id: string) => string | undefined;
  getMainAgents: () => AgentStatus[];
}

const MAX_ACTIVITY_LOG = 1000;

export const useAgentStatusStore = create<AgentStatusState>()(
  immer((set, get) => ({
    // Initial state
    agents: {},
    idToName: {},

    /**
     * Create a new agent entry (only for main 6 medical agents), keyed by name
     */
    createAgent: (agentId: string, agentName: string, tools: string[]) => {
      if (!MAIN_AGENT_NAMES.includes(agentName as MainAgentName)) {
        return;
      }

      set((state) => {
        // Register the ID mapping
        state.idToName[agentId] = agentName;

        if (state.agents[agentName]) {
          // Agent already exists (can happen on session reuse/reconnect).
          // Treat this as a fresh agent-view reset for the new run.
          if (!state.agents[agentName].knownIds.includes(agentId)) {
            state.agents[agentName].knownIds.push(agentId);
          }
          state.agents[agentName].state = 'idle';
          state.agents[agentName].currentTaskId = undefined;
          state.agents[agentName].currentTaskContent = undefined;
          state.agents[agentName].currentToolkit = undefined;
          state.agents[agentName].currentMethod = undefined;
          state.agents[agentName].lastInput = undefined;
          state.agents[agentName].lastOutput = undefined;
          state.agents[agentName].tools = tools;
          state.agents[agentName].tokensUsed = 0;
          state.agents[agentName].lastActivity = new Date();
          state.agents[agentName].activityLog = [{
            id: `act-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
            type: 'created',
            message: `Agent registered (${tools.length} tools)`,
            timestamp: new Date(),
          }];
        } else {
          // Create new agent entry keyed by name
          state.agents[agentName] = {
            name: agentName as AgentStatus['name'],
            displayName: AGENT_DISPLAY_NAMES[agentName] || agentName,
            knownIds: [agentId],
            state: 'idle',
            currentTaskId: undefined,
            currentTaskContent: undefined,
            currentToolkit: undefined,
            currentMethod: undefined,
            tools,
            tokensUsed: 0,
            lastActivity: new Date(),
            activityLog: [{
              id: `act-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
              type: 'created',
              message: `Agent created with ${tools.length} tools: ${tools.join(', ')}`,
              timestamp: new Date(),
            }],
          };
        }
      });
    },

    /**
     * Register an agent ID for name-based lookup
     */
    registerAgentId: (agentName: string, agentId: string) => {
      set((state) => {
        state.idToName[agentId] = agentName;
        if (state.agents[agentName] && !state.agents[agentName].knownIds.includes(agentId)) {
          state.agents[agentName].knownIds.push(agentId);
        }
      });
    },

    /**
     * Mark agent as working on a task (looked up by name)
     */
    setAgentWorking: (agentName: string, agentId: string, taskId: string, content: string) => {
      set((state) => {
        // Register the ID
        state.idToName[agentId] = agentName;

        if (state.agents[agentName]) {
          state.agents[agentName].state = 'working';
          state.agents[agentName].currentTaskId = taskId;
          state.agents[agentName].currentTaskContent = content.slice(0, 200);
          state.agents[agentName].lastInput = content; // Store full input for "thinking" display
          state.agents[agentName].lastOutput = undefined; // Clear previous output
          state.agents[agentName].lastActivity = new Date();
          if (!state.agents[agentName].knownIds.includes(agentId)) {
            state.agents[agentName].knownIds.push(agentId);
          }
          // Add activity
          state.agents[agentName].activityLog.push({
            id: `act-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
            type: 'activated',
            message: `Working on task: ${content}`,
            timestamp: new Date(),
          });
          if (state.agents[agentName].activityLog.length > MAX_ACTIVITY_LOG) {
            state.agents[agentName].activityLog = state.agents[agentName].activityLog.slice(-MAX_ACTIVITY_LOG);
          }
        }
      });
    },

    /**
     * Mark agent as completed (looked up by name)
     */
    setAgentCompleted: (agentName: string, agentId: string, message: string, tokens?: number) => {
      set((state) => {
        state.idToName[agentId] = agentName;

        if (state.agents[agentName]) {
          // Check if the message indicates an error
          const isError = message.includes('Error') || message.includes('error') ||
                          message.includes('Unable to process') || message.includes('429');

          state.agents[agentName].state = isError ? 'error' : 'completed';
          state.agents[agentName].currentToolkit = undefined;
          state.agents[agentName].currentMethod = undefined;
          state.agents[agentName].lastOutput = message; // Store full output
          if (isError) {
            state.agents[agentName].currentTaskContent = message.slice(0, 200);
          }
          if (tokens) {
            state.agents[agentName].tokensUsed += tokens;
          }
          state.agents[agentName].lastActivity = new Date();
          // Add activity
          state.agents[agentName].activityLog.push({
            id: `act-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
            type: isError ? 'error' : 'deactivated',
            message: isError ? `Error: ${message}` : `Task completed${tokens ? ` (${tokens} tokens)` : ''}`,
            timestamp: new Date(),
          });
          if (state.agents[agentName].activityLog.length > MAX_ACTIVITY_LOG) {
            state.agents[agentName].activityLog = state.agents[agentName].activityLog.slice(-MAX_ACTIVITY_LOG);
          }
        }
      });
    },

    /**
     * Mark agent as error
     */
    setAgentError: (agentName: string, error: string) => {
      set((state) => {
        if (state.agents[agentName]) {
          state.agents[agentName].state = 'error';
          state.agents[agentName].currentTaskContent = error.slice(0, 200);
          state.agents[agentName].lastActivity = new Date();
          state.agents[agentName].activityLog.push({
            id: `act-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
            type: 'error',
            message: error,
            timestamp: new Date(),
          });
          if (state.agents[agentName].activityLog.length > MAX_ACTIVITY_LOG) {
            state.agents[agentName].activityLog = state.agents[agentName].activityLog.slice(-MAX_ACTIVITY_LOG);
          }
        }
      });
    },

    /**
     * Set current toolkit being used by agent (looked up by name)
     */
    setAgentToolkit: (agentName: string, toolkit: string, method: string, argsMessage?: string) => {
      set((state) => {
        if (state.agents[agentName]) {
          state.agents[agentName].currentToolkit = toolkit;
          state.agents[agentName].currentMethod = method;
          state.agents[agentName].state = 'working';
          state.agents[agentName].lastActivity = new Date();
          state.agents[agentName].activityLog.push({
            id: `act-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
            type: 'toolkit_start',
            message: `Using ${toolkit} -> ${method}`,
            timestamp: new Date(),
            metadata: { args: argsMessage },
          });
          if (state.agents[agentName].activityLog.length > MAX_ACTIVITY_LOG) {
            state.agents[agentName].activityLog = state.agents[agentName].activityLog.slice(-MAX_ACTIVITY_LOG);
          }
        }
      });
    },

    /**
     * Clear current toolkit when done
     */
    clearAgentToolkit: (agentName: string, resultMessage?: string) => {
      set((state) => {
        if (state.agents[agentName]) {
          const prevToolkit = state.agents[agentName].currentToolkit;
          const prevMethod = state.agents[agentName].currentMethod;
          state.agents[agentName].currentToolkit = undefined;
          state.agents[agentName].currentMethod = undefined;
          state.agents[agentName].lastActivity = new Date();
          if (prevToolkit) {
            state.agents[agentName].activityLog.push({
              id: `act-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
              type: 'toolkit_end',
              message: `Finished ${prevToolkit}${prevMethod ? ` -> ${prevMethod}` : ''}`,
              timestamp: new Date(),
              metadata: { result: resultMessage },
            });
            if (state.agents[agentName].activityLog.length > MAX_ACTIVITY_LOG) {
              state.agents[agentName].activityLog = state.agents[agentName].activityLog.slice(-MAX_ACTIVITY_LOG);
            }
          }
        }
      });
    },

    /**
     * Add a manual activity entry
     */
    addAgentActivity: (agentName: string, type: ActivityEntry['type'], message: string) => {
      set((state) => {
        if (state.agents[agentName]) {
          state.agents[agentName].activityLog.push({
            id: `act-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
            type,
            message,
            timestamp: new Date(),
          });
          state.agents[agentName].lastActivity = new Date();
          if (state.agents[agentName].activityLog.length > MAX_ACTIVITY_LOG) {
            state.agents[agentName].activityLog = state.agents[agentName].activityLog.slice(-MAX_ACTIVITY_LOG);
          }
        }
      });
    },

    /**
     * Reset all agents (for new chat)
     */
    reset: () => {
      set((state) => {
        state.agents = {};
        state.idToName = {};
      });
    },

    /**
     * Get agent by name
     */
    getAgentByName: (name: string) => {
      return get().agents[name];
    },

    /**
     * Get agent name by any known ID
     */
    getAgentNameById: (id: string) => {
      return get().idToName[id];
    },

    /**
     * Get all main agents in order
     */
    getMainAgents: () => {
      const agents = get().agents;
      return MAIN_AGENT_NAMES
        .map(name => agents[name])
        .filter((agent): agent is AgentStatus => agent !== undefined);
    },
  }))
);