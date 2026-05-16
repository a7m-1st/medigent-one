import { useChat } from '@/hooks';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { MessageList } from './MessageList';
import { MessageInput } from './MessageInput';
import { Square } from 'lucide-react';

interface ChatHeaderProps {
  title?: string;
  subtitle?: string;
}

function ChatHeader({ title = 'Chat', subtitle }: ChatHeaderProps) {
  return (
    <div className="border-b p-4 shrink-0">
      <h2 className="text-lg font-semibold">{title}</h2>
      {subtitle && (
        <p className="text-sm text-muted-foreground">{subtitle}</p>
      )}
    </div>
  );
}

export function ChatWindow() {
  const {
    messages,
    isStreaming,
    error,
    streamingContent,
    stopChat,
  } = useChat();

  return (
    <div className="flex flex-col h-full bg-card rounded-lg border shadow-sm">
      <ChatHeader />
      
      {error && (
        <Alert variant="destructive" className="m-4 shrink-0">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <ScrollArea className="flex-1 p-4">
        <MessageList 
          messages={messages} 
          streamingContent={isStreaming ? streamingContent : null}
        />
      </ScrollArea>

      <div className="border-t p-4 shrink-0 space-y-2">
        {isStreaming && (
          <Button
            variant="destructive"
            size="sm"
            onClick={stopChat}
            className="w-full"
          >
            <Square className="h-4 w-4 mr-2" />
            Stop Generating
          </Button>
        )}
        <MessageInput />
      </div>
    </div>
  );
}
