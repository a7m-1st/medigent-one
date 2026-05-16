import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { immer } from 'zustand/middleware/immer'
import type { Project } from '@/types/project'
import type { ChatMessage } from '@/types'

interface ProjectState {
  // State
  projects: Project[]
  currentProjectId: string | null

  // Actions
  createProject: (id?: string) => Project
  deleteProject: (id: string) => void
  updateProject: (id: string, updates: Partial<Omit<Project, 'id'>>) => void
  setCurrentProject: (id: string | null) => void
  addTaskToProject: (projectId: string, taskId: string) => void
  addFileToProject: (projectId: string, filePath: string) => void
  addMessageToProject: (projectId: string, message: ChatMessage) => void
  getProjectById: (id: string) => Project | undefined
  getMessagesForProject: (projectId: string) => ChatMessage[]
}

export const useProjectStore = create<ProjectState>()(
  persist(
    immer((set, get) => ({
      projects: [],
      currentProjectId: null,

      createProject: (id?: string) => {
        const now = new Date().toISOString()
        const project: Project = {
          id: id || `project-${Date.now()}`,
          title: 'New Project',
          created_at: now,
          updated_at: now,
          files: [],
          taskIds: [],
          messages: [],
        }
        set((state) => {
          state.projects.unshift(project)
          state.currentProjectId = project.id
        })
        return project
      },

      deleteProject: (id) =>
        set((state) => {
          state.projects = state.projects.filter((p) => p.id !== id)
          if (state.currentProjectId === id) {
            state.currentProjectId = null
          }
        }),

      updateProject: (id, updates) =>
        set((state) => {
          const project = state.projects.find((p) => p.id === id)
          if (project) {
            Object.assign(project, updates)
            project.updated_at = new Date().toISOString()
          }
        }),

      setCurrentProject: (id) =>
        set((state) => {
          state.currentProjectId = id
        }),

      addTaskToProject: (projectId, taskId) =>
        set((state) => {
          const project = state.projects.find((p) => p.id === projectId)
          if (project && !project.taskIds.includes(taskId)) {
            project.taskIds.push(taskId)
            project.updated_at = new Date().toISOString()
          }
        }),

      addFileToProject: (projectId, filePath) =>
        set((state) => {
          const project = state.projects.find((p) => p.id === projectId)
          if (project && !project.files.includes(filePath)) {
            project.files.push(filePath)
            project.updated_at = new Date().toISOString()
          }
        }),

      addMessageToProject: (projectId, message) =>
        set((state) => {
          const project = state.projects.find((p) => p.id === projectId)
          if (project) {
            // Avoid duplicates by checking message id
            const exists = project.messages.some((m) => m.id === message.id)
            if (!exists) {
              project.messages.push(message)
              project.updated_at = new Date().toISOString()
            }
          }
        }),

      getProjectById: (id) => {
        return get().projects.find((p) => p.id === id)
      },

      getMessagesForProject: (projectId) => {
        const project = get().projects.find((p) => p.id === projectId)
        return project?.messages || []
      },
    })),
    {
      name: 'medgemma-projects',
      partialize: (state) => ({
        // Persist projects but remove base64 data from files to avoid localStorage quota issues
        // Keep name and type fields for display purposes
        projects: state.projects.map(project => ({
          ...project,
          messages: project.messages.map(message => ({
            ...message,
            files: message.files?.map(file => ({
              name: file.name,
              type: file.type,
              // data field is intentionally removed - not persisted to localStorage
            })) || undefined,
          })),
        })),
        currentProjectId: state.currentProjectId,
      }),
    }
  )
)
