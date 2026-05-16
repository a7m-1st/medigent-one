import type { ChatMessage } from './chat';

export interface Project {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  files: string[];
  taskIds: string[];
  messages: ChatMessage[];
}
