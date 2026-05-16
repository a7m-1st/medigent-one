import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import type { ChatMessage } from '@/types'

export type ErrorType = 'rate_limit' | 'budget' | 'generic' | 'warming_up' | null;

interface ChatState {
  // State
  messages: ChatMessage[]
  currentTaskId: string | null
  currentProjectId: string | null
  isStreaming: boolean
  isLoading: boolean
  error: string | null
  errorType: ErrorType
  streamingContent: string
  isConnected: boolean
  wasStopped: boolean
  waitingForHumanReply: boolean
  currentAskAgent: string | null
  currentAskAgentDisplayName: string | null
  pendingInput: string | null
  streamingStartTime: number | null

  // Actions
  addMessage: (message: ChatMessage) => void
  updateMessage: (id: string, updates: Partial<ChatMessage>) => void
  appendStreamingContent: (content: string) => void
  clearStreamingContent: () => void
  setStreaming: (isStreaming: boolean) => void
  setLoading: (isLoading: boolean) => void
  setCurrentTask: (taskId: string | null) => void
  setCurrentProject: (projectId: string | null) => void
  setError: (error: string | null, type?: ErrorType) => void
  clearError: () => void
  setConnected: (isConnected: boolean) => void
  setWasStopped: (wasStopped: boolean) => void
  setWaitingForHumanReply: (waiting: boolean, agent: string | null, displayName?: string | null) => void
  setPendingInput: (input: string | null) => void
  clearMessages: () => void
  reset: () => void
}

const initialState = {
  messages: [],
  currentTaskId: null,
  currentProjectId: null,
  isStreaming: false,
  isLoading: false,
  error: null,
  errorType: null as ErrorType,
  streamingContent: '',
  isConnected: false,
  wasStopped: false,
  waitingForHumanReply: false,
  currentAskAgent: null as string | null,
  currentAskAgentDisplayName: null as string | null,
  pendingInput: null as string | null,
  streamingStartTime: null as number | null,
}

export const useChatStore = create<ChatState>()(
  immer((set) => ({
    ...initialState,

    addMessage: (message) =>
      set((state) => {
        state.messages.push(message)
      }),

    updateMessage: (id, updates) =>
      set((state) => {
        const message = state.messages.find((m) => m.id === id)
        if (message) {
          Object.assign(message, updates)
        }
      }),

    appendStreamingContent: (content) =>
      set((state) => {
        state.streamingContent += content
      }),

    clearStreamingContent: () =>
      set((state) => {
        state.streamingContent = ''
      }),

    setStreaming: (isStreaming) =>
      set((state) => {
        console.log('[chatStore] setStreaming:', isStreaming);
        state.isStreaming = isStreaming
        if (isStreaming && !state.streamingStartTime) {
          state.streamingStartTime = Date.now()
          console.log('[chatStore] streamingStartTime set to:', state.streamingStartTime);
        }
        if (!isStreaming) {
          state.streamingContent = ''
        }
      }),

    setLoading: (isLoading) =>
      set((state) => {
        state.isLoading = isLoading
      }),

    setCurrentTask: (taskId) =>
      set((state) => {
        state.currentTaskId = taskId
      }),

    setCurrentProject: (projectId) =>
      set((state) => {
        state.currentProjectId = projectId
      }),

    setError: (error, type) =>
      set((state) => {
        state.error = error
        state.errorType = type ?? (error ? 'generic' : null)
      }),

    clearError: () =>
      set((state) => {
        state.error = null
        state.errorType = null
      }),

    setConnected: (isConnected) =>
      set((state) => {
        state.isConnected = isConnected
      }),

    setWasStopped: (wasStopped) =>
      set((state) => {
        state.wasStopped = wasStopped
      }),

    setWaitingForHumanReply: (waiting, agent = null, displayName = null) =>
      set((state) => {
        state.waitingForHumanReply = waiting
        state.currentAskAgent = agent
        state.currentAskAgentDisplayName = displayName
      }),

    setPendingInput: (input) =>
      set((state) => {
        state.pendingInput = input
      }),

    clearMessages: () =>
      set((state) => {
        state.messages = []
      }),

    reset: () =>
      set((state) => {
        Object.assign(state, initialState)
      }),
  }))
)
