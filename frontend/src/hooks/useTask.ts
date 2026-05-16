import { useCallback } from 'react';
import { useTaskStore } from '@/stores';
import type { Task } from '@/types';
import * as taskService from '@/services/taskService';

export interface UseTaskReturn {
  tasks: Task[];
  activeTaskId: string | null;
  isLoading: boolean;
  error: string | null;
  startTask: (taskId: string) => Promise<void>;
  stopAllTasks: () => Promise<void>;
  setActiveTask: (taskId: string | null) => void;
  addTask: (task: Task) => void;
  updateTask: (id: string, updates: Partial<Task>) => void;
  removeTask: (id: string) => void;
}

export function useTask(): UseTaskReturn {
  const store = useTaskStore();

  const startTask = useCallback(
    async (taskId: string) => {
      try {
        store.setLoading(true);
        store.setError(null);

        await taskService.startTask(taskId);
        store.setActiveTask(taskId);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to start task';
        store.setError(message);
      } finally {
        store.setLoading(false);
      }
    },
    [store]
  );

  const stopAllTasks = useCallback(async () => {
    try {
      store.setLoading(true);
      store.setError(null);

      await taskService.stopAllTasks();
      store.clearTasks();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to stop tasks';
      store.setError(message);
    } finally {
      store.setLoading(false);
    }
  }, [store]);

  const setActiveTask = useCallback(
    (taskId: string | null) => {
      store.setActiveTask(taskId);
    },
    [store]
  );

  const addTask = useCallback(
    (task: Task) => {
      store.addTask(task);
    },
    [store]
  );

  const updateTask = useCallback(
    (id: string, updates: Partial<Task>) => {
      store.updateTask(id, updates);
    },
    [store]
  );

  const removeTask = useCallback(
    (id: string) => {
      store.removeTask(id);
    },
    [store]
  );

  return {
    tasks: store.tasks,
    activeTaskId: store.activeTaskId,
    isLoading: store.isLoading,
    error: store.error,
    startTask,
    stopAllTasks,
    setActiveTask,
    addTask,
    updateTask,
    removeTask,
  };
}
