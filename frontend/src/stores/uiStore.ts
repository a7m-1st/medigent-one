import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import { persist } from 'zustand/middleware'

type Theme = 'light' | 'dark' | 'system'

interface UIState {
  // State
  sidebarOpen: boolean
  theme: Theme
  resolvedTheme: 'light' | 'dark'
  activeModal: string | null
  toasts: Array<{
    id: string
    type: 'success' | 'error' | 'warning' | 'info'
    message: string
  }>

  // Actions
  toggleSidebar: () => void
  setSidebarOpen: (open: boolean) => void
  setTheme: (theme: Theme) => void
  openModal: (modalId: string) => void
  closeModal: () => void
  addToast: (toast: Omit<UIState['toasts'][0], 'id'>) => void
  removeToast: (id: string) => void
  initializeTheme: () => void
}

// Get system preference
const getSystemTheme = (): 'light' | 'dark' => {
  if (typeof window === 'undefined') return 'dark'
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

// Apply theme to DOM
const applyTheme = (theme: 'light' | 'dark') => {
  const root = document.documentElement
  root.classList.remove('light', 'dark')
  root.classList.add(theme)
}

// Get initial theme from localStorage or default
const getInitialTheme = (): Theme => {
  if (typeof window === 'undefined') return 'system'
  const stored = localStorage.getItem('ui-store')
  if (stored) {
    try {
      const parsed = JSON.parse(stored)
      return parsed.state?.theme || 'system'
    } catch {
      return 'system'
    }
  }
  return 'system'
}

// Calculate resolved theme
const resolveTheme = (theme: Theme): 'light' | 'dark' => {
  if (theme === 'system') {
    return getSystemTheme()
  }
  return theme
}

const initialTheme = getInitialTheme()
const initialResolvedTheme = resolveTheme(initialTheme)

// Apply theme immediately on load (before React hydration)
if (typeof window !== 'undefined') {
  applyTheme(initialResolvedTheme)
}

export const useUIStore = create<UIState>()(
  persist(
    immer((set, get) => ({
      sidebarOpen: true,
      theme: initialTheme,
      resolvedTheme: initialResolvedTheme,
      activeModal: null,
      toasts: [],

      toggleSidebar: () =>
        set((state) => {
          state.sidebarOpen = !state.sidebarOpen
        }),

      setSidebarOpen: (open) =>
        set((state) => {
          state.sidebarOpen = open
        }),

      setTheme: (theme) =>
        set((state) => {
          state.theme = theme
          const resolved = resolveTheme(theme)
          state.resolvedTheme = resolved
          applyTheme(resolved)
        }),

      openModal: (modalId) =>
        set((state) => {
          state.activeModal = modalId
        }),

      closeModal: () =>
        set((state) => {
          state.activeModal = null
        }),

      addToast: (toast) =>
        set((state) => {
          const id = Math.random().toString(36).substring(7)
          state.toasts.push({ ...toast, id })
        }),

      removeToast: (id) =>
        set((state) => {
          state.toasts = state.toasts.filter((t) => t.id !== id)
        }),

      initializeTheme: () => {
        const { theme } = get()
        const resolved = resolveTheme(theme)
        set((state) => {
          state.resolvedTheme = resolved
        })
        applyTheme(resolved)

        // Listen for system theme changes
        if (typeof window !== 'undefined') {
          const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
          const handler = () => {
            const currentTheme = get().theme
            if (currentTheme === 'system') {
              const newResolved = getSystemTheme()
              set((state) => {
                state.resolvedTheme = newResolved
              })
              applyTheme(newResolved)
            }
          }
          mediaQuery.addEventListener('change', handler)
        }
      },
    })),
    {
      name: 'ui-store',
      partialize: (state) => ({
        theme: state.theme,
        sidebarOpen: state.sidebarOpen
      }),
    }
  )
)

// Initialize theme listener when module loads
if (typeof window !== 'undefined') {
  // Delay to ensure store is ready
  setTimeout(() => {
    useUIStore.getState().initializeTheme()
  }, 0)
}