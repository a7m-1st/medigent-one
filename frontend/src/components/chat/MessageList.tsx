import type { ChatMessage } from '@/types';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { User, Bot, Info } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { AssistantMessageContent } from '@/components/conversation/AssistantMessageContent';

interface MessageItemProps {
  message: ChatMessage;
  isStreaming?: boolean;
}

function MessageItem({ message, isStreaming }: MessageItemProps) {
  const isUser = message.role === 'user';
  const isSystem = message.role === 'system';

  if (isSystem) {
    return (
      <div className="flex justify-center my-2">
        <div className="bg-muted/50 rounded-full px-4 py-1 flex items-center gap-2 border border-border">
          <Info className="h-3 w-3 text-muted-foreground" />
          <span className="text-xs text-muted-foreground italic">{message.content}</span>
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        'flex gap-3 p-4 rounded-lg',
        isUser ? 'flex-row-reverse bg-muted/50' : 'flex-row bg-background'
      )}
    >
      <Avatar className={cn('shrink-0', isUser ? 'bg-primary' : 'bg-secondary')}>
        <AvatarFallback>
          {isUser ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
        </AvatarFallback>
      </Avatar>
      
      <div className={cn('flex flex-col gap-1', isUser ? 'items-end' : 'items-start')}>
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">
            {isUser ? 'You' : 'Assistant'}
          </span>
          <span className="text-xs text-muted-foreground">
            {format(new Date(message.timestamp), 'MMM d, h:mm a')}
          </span>
        </div>
        
        <div
          className={cn(
            'max-w-2xl prose prose-sm dark:prose-invert',
            isUser ? 'text-right' : 'text-left'
          )}
        >
          {isUser ? (
            <ReactMarkdown>{message.content}</ReactMarkdown>
          ) : (
            <AssistantMessageContent content={message.content} />
          )}
          {isStreaming && (
            <span className="inline-block w-2 h-4 ml-1 bg-primary animate-pulse" />
          )}
        </div>
      </div>
    </div>
  );
}

interface MessageListProps {
  messages: ChatMessage[];
  streamingContent?: string | null;
}

export function MessageList({ messages, streamingContent }: MessageListProps) {
  return (
    <div className="flex flex-col gap-4">
      {messages.map((message) => (
        <MessageItem key={message.id} message={message} />
      ))}
      
      {streamingContent && (
        <div className="flex gap-3 p-4 rounded-lg flex-row bg-background">
          <Avatar className="shrink-0 bg-secondary">
            <AvatarFallback>
              <Bot className="h-4 w-4" />
            </AvatarFallback>
          </Avatar>
          
          <div className="flex flex-col gap-1 items-start">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">Assistant</span>
              <span className="text-xs text-muted-foreground">
                {format(new Date(), 'MMM d, h:mm a')}
              </span>
            </div>
            
            <div className="max-w-2xl prose prose-sm dark:prose-invert text-left">
              <AssistantMessageContent content={streamingContent} />
              <span className="inline-block w-2 h-4 ml-1 bg-primary animate-pulse" />
            </div>
          </div>
        </div>
      )}
      
      {messages.length === 0 && !streamingContent && (
        <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
          <Bot className="h-12 w-12 mb-4 opacity-50" />
          <p className="text-lg font-medium">Start a conversation</p>
          <p className="text-sm">Type a message below to begin</p>
        </div>
      )}
    </div>
  );
}
