import { apiRequest, handleApiError } from '@/lib/api';
import type {
  ModelConfig,
  ModelInfo,
} from '@/types';
import {
  ModelConfigSchema,
  ModelInfoSchema,
} from '@/types';
import { z } from 'zod';

const ModelInfoArraySchema = z.array(ModelInfoSchema);

export interface ValidationResult {
  valid: boolean;
  errors?: string[];
}

const ValidationResultSchema = z.object({
  valid: z.boolean(),
  errors: z.array(z.string()).optional(),
});

export async function validateModel(config: ModelConfig): Promise<ValidationResult> {
  try {
    const validatedConfig = ModelConfigSchema.parse(config);
    
    const response = await apiRequest<ValidationResult>({
      method: 'POST',
      url: '/models/validate',
      data: validatedConfig,
      responseSchema: ValidationResultSchema,
    });
    
    return response;
  } catch (error) {
    const apiError = handleApiError(error);
    throw apiError;
  }
}

export async function getAvailableModels(): Promise<ModelInfo[]> {
  try {
    const response = await apiRequest<ModelInfo[]>({
      method: 'GET',
      url: '/models',
      responseSchema: ModelInfoArraySchema,
    });
    
    return response;
  } catch (error) {
    const apiError = handleApiError(error);
    throw apiError;
  }
}
