import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { z } from 'zod';

// ============================================
// Zod Schemas
// ============================================
export const TerminalEntrySchema = z.object({
  id: z.string(),
  agentId: z.string(),
  agentName: z.string(),
  taskId: z.string(),
  output: z.string(),
  timestamp: z.date(),
});

export const SnapshotEntrySchema = z.object({
  id: z.string(),
  taskId: z.string(),
  browserUrl: z.string(),
  imageData: z.string(), // base64 or URL
  timestamp: z.date(),
});

export type TerminalEntry = z.infer<typeof TerminalEntrySchema>;
export type SnapshotEntry = z.infer<typeof SnapshotEntrySchema>;

// ============================================
// Store Interface
// ============================================
interface ResourceState {
  // State
  terminalOutputs: Record<string, TerminalEntry[]>; // keyed by agentId
  snapshots: Record<string, SnapshotEntry[]>; // keyed by taskId
  isPolling: boolean;
  pollingTaskId: string | null;
  
  // Actions
  addTerminalOutput: (agentId: string, taskId: string, agentName: string, output: string) => void;
  clearTerminalOutputs: (agentId: string) => void;
  getTerminalOutputsForAgent: (agentId: string) => TerminalEntry[];
  setSnapshots: (taskId: string, snapshots: SnapshotEntry[]) => void;
  addSnapshot: (taskId: string, snapshot: SnapshotEntry) => void;
  getSnapshotsForTask: (taskId: string) => SnapshotEntry[];
  startPolling: (taskId: string) => void;
  stopPolling: () => void;
  reset: () => void;
}

export const useResourceStore = create<ResourceState>()(
  immer((set, get) => ({
    // Initial state
    terminalOutputs: {},
    snapshots: {},
    isPolling: false,
    pollingTaskId: null,
    
    /**
     * Add a terminal output entry
     */
    addTerminalOutput: (agentId: string, taskId: string, agentName: string, output: string) => {
      set((state) => {
        if (!state.terminalOutputs[agentId]) {
          state.terminalOutputs[agentId] = [];
        }
        state.terminalOutputs[agentId].push({
          id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          agentId,
          agentName,
          taskId,
          output,
          timestamp: new Date(),
        });
      });
    },
    
    /**
     * Clear terminal outputs for an agent (e.g., when starting new chat)
     */
    clearTerminalOutputs: (agentId: string) => {
      set((state) => {
        state.terminalOutputs[agentId] = [];
      });
    },
    
    /**
     * Get terminal outputs for a specific agent
     */
    getTerminalOutputsForAgent: (agentId: string): TerminalEntry[] => {
      return get().terminalOutputs[agentId] || [];
    },
    
    /**
     * Set all snapshots for a task (from API response)
     */
    setSnapshots: (taskId: string, snapshots: SnapshotEntry[]) => {
      set((state) => {
        state.snapshots[taskId] = snapshots;
      });
    },
    
    /**
     * Add a single snapshot (from real-time update)
     */
    addSnapshot: (taskId: string, snapshot: SnapshotEntry) => {
      set((state) => {
        if (!state.snapshots[taskId]) {
          state.snapshots[taskId] = [];
        }
        // Avoid duplicates by browserUrl
        const exists = state.snapshots[taskId].some(s => s.browserUrl === snapshot.browserUrl);
        if (!exists) {
          state.snapshots[taskId].push(snapshot);
        }
      });
    },
    
    /**
     * Get snapshots for a specific task
     */
    getSnapshotsForTask: (taskId: string): SnapshotEntry[] => {
      return get().snapshots[taskId] || [];
    },
    
    /**
     * Start polling for snapshots
     */
    startPolling: (taskId: string) => {
      set((state) => {
        state.isPolling = true;
        state.pollingTaskId = taskId;
      });
    },
    
    /**
     * Stop polling
     */
    stopPolling: () => {
      set((state) => {
        state.isPolling = false;
        state.pollingTaskId = null;
      });
    },
    
    /**
     * Reset all resources (for new chat)
     */
    reset: () => {
      set((state) => {
        state.terminalOutputs = {};
        state.snapshots = {};
        state.isPolling = false;
        state.pollingTaskId = null;
      });
    },
  }))
);
