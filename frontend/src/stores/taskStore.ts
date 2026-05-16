import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import type { Task, Status } from '@/types'

interface TaskState {
  // State
  tasks: Task[]
  activeTaskId: string | null
  isLoading: boolean
  error: string | null

  // Actions
  setTasks: (tasks: Task[]) => void
  addTask: (task: Task) => void
  updateTask: (id: string, updates: Partial<Task>) => void
  updateTaskStatus: (id: string, status: Status) => void
  removeTask: (id: string) => void
  setActiveTask: (id: string | null) => void
  setLoading: (loading: boolean) => void
  setError: (error: string | null) => void
  clearTasks: () => void
}

const initialState = {
  tasks: [],
  activeTaskId: null,
  isLoading: false,
  error: null,
}

export const useTaskStore = create<TaskState>()(
  immer((set) => ({
    ...initialState,

    setTasks: (tasks) =>
      set((state) => {
        state.tasks = tasks
      }),

    addTask: (task) =>
      set((state) => {
        const existingIndex = state.tasks.findIndex((t) => t.id === task.id)
        if (existingIndex >= 0) {
          state.tasks[existingIndex] = task
        } else {
          state.tasks.unshift(task)
        }
      }),

    updateTask: (id, updates) =>
      set((state) => {
        const task = state.tasks.find((t) => t.id === id)
        if (task) {
          Object.assign(task, updates)
        }
      }),

    updateTaskStatus: (id, status) =>
      set((state) => {
        const task = state.tasks.find((t) => t.id === id)
        if (task) {
          task.status = status
          task.updated_at = new Date().toISOString()
        }
      }),

    removeTask: (id) =>
      set((state) => {
        state.tasks = state.tasks.filter((t) => t.id !== id)
      }),

    setActiveTask: (id) =>
      set((state) => {
        state.activeTaskId = id
      }),

    setLoading: (loading) =>
      set((state) => {
        state.isLoading = loading
      }),

    setError: (error) =>
      set((state) => {
        state.error = error
      }),

    clearTasks: () =>
      set((state) => {
        state.tasks = []
        state.activeTaskId = null
      }),
  }))
)
