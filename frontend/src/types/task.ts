import { z } from 'zod';
import { UUIDSchema, TimestampSchema, StatusEnum, ActionEnum } from './common';
import { ChatMessageSchema } from './chat';

export const TaskSchema = z.object({
  id: UUIDSchema,
  project_id: UUIDSchema,
  status: StatusEnum,
  content: z.string(),
  created_at: TimestampSchema,
  updated_at: TimestampSchema,
  conversation_history: z.array(ChatMessageSchema),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
export type Task = z.infer<typeof TaskSchema>;

export const StartTaskSchema = z.object({
  project_id: UUIDSchema,
  task_id: UUIDSchema,
});
export type StartTask = z.infer<typeof StartTaskSchema>;

export const StopTaskSchema = z.object({
  project_id: UUIDSchema,
  task_id: UUIDSchema,
});
export type StopTask = z.infer<typeof StopTaskSchema>;

export const TaskActionSchema = z.object({
  project_id: UUIDSchema,
  task_id: UUIDSchema,
  action: ActionEnum,
  payload: z.record(z.string(), z.unknown()).optional(),
});
export type TaskAction = z.infer<typeof TaskActionSchema>;

export const CreateTaskSchema = z.object({
  project_id: UUIDSchema,
  content: z.string().min(1),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
export type CreateTask = z.infer<typeof CreateTaskSchema>;

export const TaskListSchema = z.object({
  tasks: z.array(TaskSchema),
  total: z.int().nonnegative(),
});
export type TaskList = z.infer<typeof TaskListSchema>;
