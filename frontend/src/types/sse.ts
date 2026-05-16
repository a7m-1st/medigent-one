import { z } from 'zod';

// ============================================
// Task Node Schema (for recursive tree structure)
// Backend sends state as uppercase (FAILED, DONE, etc.) but we also accept lowercase
// ============================================
export const TaskNodeSchema: z.ZodType<TaskNode> = z.lazy(() =>
  z.object({
    id: z.string(),
    content: z.string(),
    state: z.string(), // Backend sends uppercase (FAILED, DONE, WAITING, RUNNING) or lowercase
    assignedTo: z.string().optional(),
    assignedToName: z.string().optional(),
    failureCount: z.number().default(0),
    subtasks: z.array(TaskNodeSchema).default([]),
  })
);

export type TaskNode = {
  id: string;
  content: string;
  state: string; // Backend sends FAILED/DONE/WAITING/RUNNING, normalized to lowercase in handler
  assignedTo?: string;
  assignedToName?: string;
  failureCount: number;
  subtasks: TaskNode[];
};

// ============================================
// SSE Event Schemas - Based on backend sse_json format
// Backend sends: { step: string, data: any }
// ============================================

// 1. Confirmed Event - Initial question confirmation
export const SSEConfirmedDataSchema = z.object({
  question: z.string(),
});

export const SSEConfirmedEventSchema = z.object({
  step: z.literal('confirmed'),
  data: SSEConfirmedDataSchema,
});

// 2. Create Agent Event - Agent instantiated
export const SSECreateAgentDataSchema = z.object({
  agent_name: z.string(),
  agent_id: z.string(),
  tools: z.array(z.string()),
});

export const SSECreateAgentEventSchema = z.object({
  step: z.literal('create_agent'),
  data: SSECreateAgentDataSchema,
});

// 3. Activate Agent Event - Agent started working
export const SSEActivateAgentDataSchema = z.object({
  agent_name: z.string(),
  process_task_id: z.string(),
  agent_id: z.string(),
  message: z.string(),
});

export const SSEActivateAgentEventSchema = z.object({
  step: z.literal('activate_agent'),
  data: SSEActivateAgentDataSchema,
});

// 4. Deactivate Agent Event - Agent finished
export const SSEDeactivateAgentDataSchema = z.object({
  agent_name: z.string(),
  process_task_id: z.string(),
  agent_id: z.string(),
  message: z.string(),
  tokens: z.number().optional(),
});

export const SSEDeactivateAgentEventSchema = z.object({
  step: z.literal('deactivate_agent'),
  data: SSEDeactivateAgentDataSchema,
});

// 5. Activate Toolkit Event - Toolkit method started
export const SSEActivateToolkitDataSchema = z.object({
  agent_name: z.string(),
  process_task_id: z.string(),
  toolkit_name: z.string(),
  method_name: z.string(),
  message: z.string(),
});

export const SSEActivateToolkitEventSchema = z.object({
  step: z.literal('activate_toolkit'),
  data: SSEActivateToolkitDataSchema,
});

// 6. Deactivate Toolkit Event - Toolkit method done
export const SSEDeactivateToolkitDataSchema = z.object({
  agent_name: z.string(),
  process_task_id: z.string(),
  toolkit_name: z.string(),
  method_name: z.string(),
  message: z.string(),
});

export const SSEDeactivateToolkitEventSchema = z.object({
  step: z.literal('deactivate_toolkit'),
  data: SSEDeactivateToolkitDataSchema,
});

// 7. Decompose Text Event - Streaming task breakdown
export const SSEDecomposeTextDataSchema = z.object({
  project_id: z.string(),
  task_id: z.string(),
  content: z.string(),
});

export const SSEDecomposeTextEventSchema = z.object({
  step: z.literal('decompose_text'),
  data: SSEDecomposeTextDataSchema,
});

// 8. To Sub Tasks Event - Complete subtask tree
// Backend may send project_id/task_id at top level or only inside sub_tasks
export const SSEToSubTasksDataSchema = z.object({
  project_id: z.string().optional(),
  task_id: z.string().optional(),
  sub_tasks: z.array(TaskNodeSchema),
  delta_sub_tasks: z.array(TaskNodeSchema).optional(),
  is_final: z.boolean().optional(),
  summary_task: z.string().optional(),
});

export const SSEToSubTasksEventSchema = z.object({
  step: z.literal('to_sub_tasks'),
  data: SSEToSubTasksDataSchema,
});

// 9. Assign Task Event - Task assigned to agent
export const SSEAssignTaskDataSchema = z.object({
  assignee_id: z.string(),
  task_id: z.string(),
  content: z.string(),
  state: z.string(), // Backend sends lowercase: waiting, running, done, failed
  failure_count: z.number(),
});

export const SSEAssignTaskEventSchema = z.object({
  step: z.literal('assign_task'),
  data: SSEAssignTaskDataSchema,
});

// 10. Task State Event - Task progress update
export const SSETaskStateDataSchema = z.object({
  task_id: z.string(),
  content: z.string(),
  state: z.string(),
  result: z.string().optional(),
  failure_count: z.number(),
});

export const SSETaskStateEventSchema = z.object({
  step: z.literal('task_state'),
  data: SSETaskStateDataSchema,
});

// 11. Terminal Event - Terminal output from Developer Agent
export const SSTerminalDataSchema = z.object({
  process_task_id: z.string(),
  data: z.string(),
});

export const SSTerminalEventSchema = z.object({
  step: z.literal('terminal'),
  data: SSTerminalDataSchema,
});

// 12. Write File Event - File operation completed
export const SSEWriteFileDataSchema = z.object({
  file_path: z.string(),
  process_task_id: z.string(),
});

export const SSEWriteFileEventSchema = z.object({
  step: z.literal('write_file'),
  data: SSEWriteFileDataSchema,
});

// 13. Notice Event - System notification
export const SSENoticeDataSchema = z.object({
  notice: z.string(),
  process_task_id: z.string(),
});

export const SSENoticeEventSchema = z.object({
  step: z.literal('notice'),
  data: SSENoticeDataSchema,
});

// 14. Ask Event - Agent asking user for input
export const SSEAskDataSchema = z.object({
  question: z.string(),
  agent: z.string(),
});

export const SSEAskEventSchema = z.object({
  step: z.literal('ask'),
  data: SSEAskDataSchema,
});

// 15. Budget Not Enough Event
export const SSEBudgetNotEnoughDataSchema = z.object({
  message: z.string(),
});

export const SSEBudgetNotEnoughEventSchema = z.object({
  step: z.literal('budget_not_enough'),
  data: SSEBudgetNotEnoughDataSchema,
});

// 16. End Event - Task completed with final summary
export const SSEEndEventSchema = z.object({
  step: z.literal('end'),
  data: z.string(),
});

// 17. Error Event
export const SSEErrorDataSchema = z.object({
  message: z.string(),
  type: z.string().optional(),
  details: z.unknown().optional(),
});

export const SSEErrorEventSchema = z.object({
  step: z.literal('error'),
  data: SSEErrorDataSchema,
});

// 18. MedGemma Status Event - Endpoint warm-up / availability
export const SSEMedgemmaStatusDataSchema = z.object({
  status: z.enum(['warming_up', 'ready', 'unavailable']),
  message: z.string(),
});

export const SSEMedgemmaStatusEventSchema = z.object({
  step: z.literal('medgemma_status'),
  data: SSEMedgemmaStatusDataSchema,
});

// ============================================
// Union Type for All SSE Events
// ============================================
export const SSEEventSchema = z.discriminatedUnion('step', [
  SSEConfirmedEventSchema,
  SSECreateAgentEventSchema,
  SSEActivateAgentEventSchema,
  SSEDeactivateAgentEventSchema,
  SSEActivateToolkitEventSchema,
  SSEDeactivateToolkitEventSchema,
  SSEDecomposeTextEventSchema,
  SSEToSubTasksEventSchema,
  SSEAssignTaskEventSchema,
  SSETaskStateEventSchema,
  SSTerminalEventSchema,
  SSEWriteFileEventSchema,
  SSENoticeEventSchema,
  SSEAskEventSchema,
  SSEBudgetNotEnoughEventSchema,
  SSEEndEventSchema,
  SSEErrorEventSchema,
  SSEMedgemmaStatusEventSchema,
]);

export type SSEEvent = z.infer<typeof SSEEventSchema>;

// ============================================
// Individual Type Exports
// ============================================
export type SSEConfirmedEvent = z.infer<typeof SSEConfirmedEventSchema>;
export type SSECreateAgentEvent = z.infer<typeof SSECreateAgentEventSchema>;
export type SSEActivateAgentEvent = z.infer<typeof SSEActivateAgentEventSchema>;
export type SSEDeactivateAgentEvent = z.infer<typeof SSEDeactivateAgentEventSchema>;
export type SSEActivateToolkitEvent = z.infer<typeof SSEActivateToolkitEventSchema>;
export type SSEDeactivateToolkitEvent = z.infer<typeof SSEDeactivateToolkitEventSchema>;
export type SSEDecomposeTextEvent = z.infer<typeof SSEDecomposeTextEventSchema>;
export type SSEToSubTasksEvent = z.infer<typeof SSEToSubTasksEventSchema>;
export type SSEAssignTaskEvent = z.infer<typeof SSEAssignTaskEventSchema>;
export type SSETaskStateEvent = z.infer<typeof SSETaskStateEventSchema>;
export type SSTerminalEvent = z.infer<typeof SSTerminalEventSchema>;
export type SSEWriteFileEvent = z.infer<typeof SSEWriteFileEventSchema>;
export type SSENoticeEvent = z.infer<typeof SSENoticeEventSchema>;
export type SSEAskEvent = z.infer<typeof SSEAskEventSchema>;
export type SSEBudgetNotEnoughEvent = z.infer<typeof SSEBudgetNotEnoughEventSchema>;
export type SSEEndEvent = z.infer<typeof SSEEndEventSchema>;
export type SSEErrorEvent = z.infer<typeof SSEErrorEventSchema>;
export type SSEMedgemmaStatusEvent = z.infer<typeof SSEMedgemmaStatusEventSchema>;

// ============================================
// Helper Functions
// ============================================
export function isValidSSEEvent(event: unknown): event is SSEEvent {
  return SSEEventSchema.safeParse(event).success;
}

export function parseSSEEvent(event: unknown): SSEEvent | null {
  const result = SSEEventSchema.safeParse(event);
  if (result.success) {
    return result.data;
  }
  console.error('Invalid SSE event:', result.error);
  return null;
}

// ============================================
// Legacy Exports (for backward compatibility during migration)
// These are unused but kept as reference - consider removing in cleanup
export const isMessageEvent = (event: SSEEvent): boolean => event.step === 'confirmed';
export const isStatusEvent = (event: SSEEvent): boolean => event.step === 'task_state';
export const isErrorEvent = (event: SSEEvent): boolean => event.step === 'error';
export const isDoneEvent = (event: SSEEvent): boolean => event.step === 'end';
export const isAgentEvent = (event: SSEEvent): boolean => 
  ['create_agent', 'activate_agent', 'deactivate_agent'].includes(event.step);
