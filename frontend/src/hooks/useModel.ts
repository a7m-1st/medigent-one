import { useCallback } from 'react';
import { useModelStore } from '@/stores';
import type { ModelConfig, ValidateModelRequest, ValidateModelResponse } from '@/types';
import * as modelService from '@/services/modelService';

export interface UseModelReturn {
  models: ModelConfig[];
  defaultModel: ModelConfig | null;
  isValidating: boolean;
  validationResult: ValidateModelResponse | null;
  error: string | null;
  validateModel: (config: ValidateModelRequest) => Promise<void>;
  addModel: (model: ModelConfig) => void;
  setDefaultModel: (model: ModelConfig | null) => void;
  updateModel: (id: string, updates: Partial<ModelConfig>) => void;
  removeModel: (id: string) => void;
}

export function useModel(): UseModelReturn {
  const store = useModelStore();

  const validateModel = useCallback(
    async (config: ValidateModelRequest) => {
      try {
        store.setValidating(true);
        store.setError(null);
        store.setValidationResult(null);

        const result = await modelService.validateModel(config as ModelConfig);
        store.setValidationResult({
          valid: result.valid,
          error: result.errors?.join(', '),
        } as ValidateModelResponse);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to validate model';
        store.setError(message);
        store.setValidationResult({
          valid: false,
          error: message,
        } as ValidateModelResponse);
      } finally {
        store.setValidating(false);
      }
    },
    [store]
  );

  const addModel = useCallback(
    (model: ModelConfig) => {
      store.addModel(model);
    },
    [store]
  );

  const setDefaultModel = useCallback(
    (model: ModelConfig | null) => {
      store.setDefaultModel(model);
    },
    [store]
  );

  const updateModel = useCallback(
    (id: string, updates: Partial<ModelConfig>) => {
      store.updateModel(id, updates);
    },
    [store]
  );

  const removeModel = useCallback(
    (id: string) => {
      store.removeModel(id);
    },
    [store]
  );

  return {
    models: store.models,
    defaultModel: store.defaultModel,
    isValidating: store.isValidating,
    validationResult: store.validationResult,
    error: store.error,
    validateModel,
    addModel,
    setDefaultModel,
    updateModel,
    removeModel,
  };
}
