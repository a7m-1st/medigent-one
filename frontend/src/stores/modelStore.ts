import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import type { ModelConfig, ValidateModelResponse } from '@/types'

interface ModelState {
  // State
  models: ModelConfig[]
  defaultModel: ModelConfig | null
  isValidating: boolean
  validationResult: ValidateModelResponse | null
  error: string | null

  // Actions
  setModels: (models: ModelConfig[]) => void
  addModel: (model: ModelConfig) => void
  updateModel: (model_name: string, updates: Partial<ModelConfig>) => void
  removeModel: (model_name: string) => void
  setDefaultModel: (model: ModelConfig | null) => void
  setValidationResult: (result: ValidateModelResponse | null) => void
  setValidating: (isValidating: boolean) => void
  setError: (error: string | null) => void
}

const initialState = {
  models: [],
  defaultModel: null,
  isValidating: false,
  validationResult: null,
  error: null,
}

export const useModelStore = create<ModelState>()(
  immer((set) => ({
    ...initialState,

    setModels: (models) =>
      set((state) => {
        state.models = models
      }),

    addModel: (model) =>
      set((state) => {
        state.models.push(model)
      }),

    updateModel: (model_name, updates) =>
      set((state) => {
        const model = state.models.find((m) => m.model_name === model_name)
        if (model) {
          Object.assign(model, updates)
        }
      }),

    removeModel: (model_name) =>
      set((state) => {
        state.models = state.models.filter((m) => m.model_name !== model_name)
      }),

    setDefaultModel: (model) =>
      set((state) => {
        state.defaultModel = model
      }),

    setValidationResult: (result) =>
      set((state) => {
        state.validationResult = result
      }),

    setValidating: (isValidating) =>
      set((state) => {
        state.isValidating = isValidating
      }),

    setError: (error) =>
      set((state) => {
        state.error = error
      }),
  }))
)
