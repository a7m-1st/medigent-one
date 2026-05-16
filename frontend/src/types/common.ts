import { z } from 'zod';

export const StatusEnum = z.enum(['confirming', 'confirmed', 'processing', 'done']);
export type Status = z.infer<typeof StatusEnum>;

export const ActionEnum = z.enum(['improve', 'start', 'stop', 'end', 'task_state', 'create_agent', 'chat_step', 'human_reply']);
export type Action = z.infer<typeof ActionEnum>;

export const RoleEnum = z.enum(['user', 'assistant', 'system']);
export type Role = z.infer<typeof RoleEnum>;

export const UUIDSchema = z.string().uuid();
export type UUID = z.infer<typeof UUIDSchema>;

export const TimestampSchema = z.string().datetime();
export type Timestamp = z.infer<typeof TimestampSchema>;

export const ApiKeySchema = z.object({
  name: z.string(),
  key: z.string(),
});
export type ApiKey = z.infer<typeof ApiKeySchema>;

export function createApiResponseSchema<T extends z.ZodTypeAny>(dataSchema: T) {
  return z.object({
    data: dataSchema,
    success: z.boolean(),
    message: z.string().optional(),
  });
}

export const ApiResponseMetaSchema = z.object({
  success: z.boolean(),
  message: z.string().optional(),
  timestamp: TimestampSchema.optional(),
});
export type ApiResponseMeta = z.infer<typeof ApiResponseMetaSchema>;
