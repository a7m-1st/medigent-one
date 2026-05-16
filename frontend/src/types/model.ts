import { z } from 'zod';

export const ModelPlatformEnum = z.enum([
  'openai',
  'anthropic',
  'google',
  'azure',
  'cohere',
  'mistral',
  'local',
  'custom',
]);
export type ModelPlatform = z.infer<typeof ModelPlatformEnum>;

export const ValidateModelRequestSchema = z.object({
  platform: ModelPlatformEnum,
  model_name: z.string(),
  api_key: z.string(),
});
export type ValidateModelRequest = z.infer<typeof ValidateModelRequestSchema>;

export const ValidateModelResponseSchema = z.object({
  valid: z.boolean(),
  error: z.string().optional(),
  model_info: z.record(z.string(), z.unknown()).optional(),
});
export type ValidateModelResponse = z.infer<typeof ValidateModelResponseSchema>;

export const ModelConfigSchema = z.object({
  platform: ModelPlatformEnum,
  model_name: z.string(),
  api_key: z.string(),
  temperature: z.number().min(0).max(2).optional().default(0.7),
  max_tokens: z.number().positive().optional(),
  top_p: z.number().min(0).max(1).optional(),
  frequency_penalty: z.number().min(-2).max(2).optional(),
  presence_penalty: z.number().min(-2).max(2).optional(),
  stop_sequences: z.array(z.string()).optional(),
});
export type ModelConfig = z.infer<typeof ModelConfigSchema>;

export const ModelInfoSchema = z.object({
  id: z.string(),
  name: z.string(),
  platform: ModelPlatformEnum,
  description: z.string().optional(),
  version: z.string().optional(),
  capabilities: z.array(z.string()).optional(),
});
export type ModelInfo = z.infer<typeof ModelInfoSchema>;
