import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { z } from 'zod';
import type { TaskNode } from '@/types';

// ============================================
// Zod Schema for Summary Task
// ============================================
const SummaryTaskSchema = z.object({
  title: z.string(),
  description: z.string(),
});

export type SummaryTask = z.infer<typeof SummaryTaskSchema>;

// ============================================
// Store Interface
// ============================================
interface TaskDecompState {
  // State
  projectId: string | null;
  mainTaskId: string | null;
  summaryTask: SummaryTask | null;
  taskTree: TaskNode[];
  isDecomposing: boolean;
  decomposeText: string;
  finalSummary: string | null;
  
  // Actions
  startDecomposition: (projectId: string, taskId: string) => void;
  appendDecomposeText: (text: string) => void;
  setTaskTree: (tasks: TaskNode[]) => void;
  updateTaskState: (taskId: string, state: string) => void;
  assignTask: (taskId: string, agentId: string, agentName: string) => void;
  setSummaryTask: (summary: string) => void;
  setFinalSummary: (summary: string) => void;
  findTaskById: (taskId: string) => TaskNode | null;
  cancelPendingTasks: () => void;
  completeRemainingTasks: () => void;
  reset: () => void;
}

// ============================================
// Helper function to find and update task recursively
// ============================================
function findAndUpdateTaskInTree(
  nodes: TaskNode[],
  taskId: string,
  updates: Partial<TaskNode>
): boolean {
  for (const node of nodes) {
    if (node.id === taskId) {
      Object.assign(node, updates);
      return true;
    }
    if (node.subtasks.length > 0) {
      if (findAndUpdateTaskInTree(node.subtasks, taskId, updates)) {
        return true;
      }
    }
  }
  return false;
}

// ============================================
// Helper function to find task by ID recursively
// ============================================
function findTaskByIdInTree(nodes: TaskNode[], taskId: string): TaskNode | null {
  for (const node of nodes) {
    if (node.id === taskId) {
      return node;
    }
    if (node.subtasks.length > 0) {
      const found = findTaskByIdInTree(node.subtasks, taskId);
      if (found) return found;
    }
  }
  return null;
}

// ============================================
// Helper to update all tasks matching a condition
// ============================================
const UNFINISHED_STATES = ['running', 'waiting', 'open', 'pending'];

function updateUnfinishedTasks(nodes: TaskNode[], newState: string): void {
  for (const node of nodes) {
    const current = (node.state || '').toLowerCase();
    if (UNFINISHED_STATES.includes(current) || current === '') {
      node.state = newState;
    }
    if (node.subtasks.length > 0) {
      updateUnfinishedTasks(node.subtasks, newState);
    }
  }
}

export const useTaskDecompStore = create<TaskDecompState>()(
  immer((set, get) => ({
    // Initial state
    projectId: null,
    mainTaskId: null,
    summaryTask: null,
    taskTree: [],
    isDecomposing: false,
    decomposeText: '',
    finalSummary: null,
    
    /**
     * Start a new decomposition
     */
    startDecomposition: (projectId: string, taskId: string) => {
      set((state) => {
        state.projectId = projectId;
        state.mainTaskId = taskId;
        state.summaryTask = null;
        state.taskTree = [];
        state.isDecomposing = true;
        state.decomposeText = '';
        state.finalSummary = null;
      });
    },
    
    /**
     * Append streaming decompose text
     */
    appendDecomposeText: (text: string) => {
      set((state) => {
        state.decomposeText += text;
      });
    },
    
    /**
     * Set the complete task tree
     */
    setTaskTree: (tasks: TaskNode[]) => {
      set((state) => {
        state.taskTree = tasks;
        state.isDecomposing = false;
      });
    },
    
    /**
     * Update a specific task's state
     */
    updateTaskState: (taskId: string, newState: string) => {
      set((state) => {
        findAndUpdateTaskInTree(state.taskTree, taskId, { state: newState });
      });
    },
    
    /**
     * Assign a task to an agent
     */
    assignTask: (taskId: string, agentId: string, agentName: string) => {
      set((state) => {
        findAndUpdateTaskInTree(state.taskTree, taskId, {
          assignedTo: agentId,
          assignedToName: agentName,
        });
      });
    },
    
    /**
     * Parse and set the summary task from "title | description" format
     */
    setSummaryTask: (summary: string) => {
      const parts = summary.split('|').map(s => s.trim());
      
      set((state) => {
        if (parts.length >= 2) {
          state.summaryTask = {
            title: parts[0],
            description: parts[1],
          };
        } else {
          state.summaryTask = {
            title: summary,
            description: '',
          };
        }
      });
    },
    
    /**
     * Set the final summary from end event
     */
    setFinalSummary: (summary: string) => {
      set((state) => {
        state.finalSummary = summary;
      });
    },
    
    /**
     * Find a task by ID in the tree
     */
    findTaskById: (taskId: string): TaskNode | null => {
      return findTaskByIdInTree(get().taskTree, taskId);
    },
    
    /**
     * Cancel all running/waiting/pending tasks (used on stop)
     */
    cancelPendingTasks: () => {
      set((state) => {
        updateUnfinishedTasks(state.taskTree, 'cancelled');
      });
    },
    
    /**
     * Mark remaining running tasks as done (used on end)
     */
    completeRemainingTasks: () => {
      set((state) => {
        updateUnfinishedTasks(state.taskTree, 'done');
      });
    },
    
    /**
     * Reset all state (for new chat)
     */
    reset: () => {
      set((state) => {
        state.projectId = null;
        state.mainTaskId = null;
        state.summaryTask = null;
        state.taskTree = [];
        state.isDecomposing = false;
        state.decomposeText = '';
        state.finalSummary = null;
      });
    },
  }))
);
