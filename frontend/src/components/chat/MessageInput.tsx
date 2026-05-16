import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useChat } from '@/hooks';
import { cn } from '@/lib/utils';
import { useTaskStore } from '@/stores';
import { Send, Square } from 'lucide-react';
import { useState, type KeyboardEvent } from 'react';

// Default model configuration from environment variables
const DEFAULT_MODEL_PLATFORM = import.meta.env.VITE_DEFAULT_MODEL_PLATFORM || 'GEMINI';
const DEFAULT_MODEL_TYPE = import.meta.env.VITE_DEFAULT_MODEL_TYPE || 'gemma-4-31b-it';
const DEFAULT_MODEL_API_URL = import.meta.env.VITE_DEFAULT_MODEL_API_URL || null;

export function MessageInput() {
  const [input, setInput] = useState('');
  const { startChat, stopChat, isStreaming, isLoading, currentProjectId } = useChat();
  const activeTaskId = useTaskStore((state) => state.activeTaskId);

  const handleSubmit = async () => {
    if (!input.trim() || isStreaming || isLoading) return;

    const content = input.trim();
    setInput('');

    // TODO: Get project ID and agents from context/props
    const projectId = currentProjectId || activeTaskId || 'default-project';
    
    // Always start a new chat session via /chat
    await startChat({
      project_id: projectId,
      task_id: `task-${Date.now()}`,
      question: content,
      attaches: [],
      model_platform: DEFAULT_MODEL_PLATFORM,
      model_type: DEFAULT_MODEL_TYPE,
      api_key: '',
      api_url: DEFAULT_MODEL_API_URL,
      max_retries: 5,
      installed_mcp: { mcpServers: {} },
      summary_prompt: '',
      use_simulated_tool_calling: false,
      history: [],
    });
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="flex gap-2 items-end">
      <Textarea
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Type a message... (Shift+Enter for new line)"
        className="min-h-[80px] resize-none"
        disabled={isStreaming || isLoading}
      />
      {isStreaming ? (
        <Button
          onClick={stopChat}
          variant="destructive"
          className="shrink-0 h-[80px] px-6"
        >
          <Square className="h-5 w-5" />
        </Button>
      ) : (
        <Button
          onClick={handleSubmit}
          disabled={!input.trim() || isLoading}
          className={cn('shrink-0 h-[80px] px-6')}
        >
          <Send className="h-5 w-5" />
        </Button>
      )}
    </div>
  );
}
