import React from 'react';
import { motion } from 'framer-motion';
import { AlertCircle, Bot, CheckCircle2, FileText, ImageIcon, Info, User } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ChatMessage } from '@/types';
import { AssistantMessageContent } from './AssistantMessageContent';

interface MessageBubbleProps {
  message: ChatMessage;
}

export const MessageBubble: React.FC<MessageBubbleProps> = ({ message }) => {
  const { role, content, files } = message;

  // System messages render as centered info pills
  if (role === 'system') {
    return <SystemMessage content={content} metadata={message.metadata} />;
  }

  const isUser = role === 'user';

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: [0.25, 0.46, 0.45, 0.94] }}
      className={cn(
        'flex gap-3 py-4',
        isUser ? 'flex-row-reverse' : 'flex-row'
      )}
    >
      {/* Avatar */}
      <div
        className={cn(
          'w-8 h-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5',
          isUser
            ? 'bg-accent text-accent-foreground'
            : 'bg-gradient-to-br from-teal-500 to-teal-700 shadow-glow-sm'
        )}
      >
        {isUser ? (
          <User className="w-4 h-4" />
        ) : (
          <Bot className="w-4 h-4 text-white" />
        )}
      </div>

      {/* Content */}
      <div
        className={cn(
          'flex flex-col gap-1.5 min-w-0 max-w-[85%]',
          isUser ? 'items-end' : 'items-start'
        )}
      >
        {/* Role label */}
        <span
          className={cn(
            'text-[10px] font-semibold uppercase tracking-wider px-0.5',
            isUser ? 'text-foreground-muted' : 'text-teal-500 dark:text-teal-400'
          )}
        >
          {isUser ? 'You' : 'Health Unit Coordinator'}
        </span>

        {/* Message bubble */}
        {isUser ? (
          <div className="bg-user-bubble border border-user-bubble-border rounded-2xl rounded-tr-sm px-4 py-3 text-sm text-foreground leading-relaxed shadow-sm">
            {/* Attachments */}
            {files && files.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-2">
                {files.map((file, idx) => (
                  <div
                    key={idx}
                    className="relative w-20 h-20 rounded-lg overflow-hidden border border-border bg-background-secondary flex flex-col items-center justify-center gap-1"
                  >
                    {file.data && file.type === 'image' ? (
                      // Image with base64 data - show actual image
                      <img
                        src={file.data}
                        alt={file.name}
                        className="w-full h-full object-cover"
                      />
                    ) : file.type === 'pdf' ? (
                      // PDF (with or without data) - show PDF placeholder
                      <>
                        <FileText className="w-6 h-6 text-red-500" />
                        <span className="text-[8px] text-foreground-muted text-center px-1 truncate w-full">
                          {file.name}
                        </span>
                      </>
                    ) : file.type === 'image' ? (
                      // Image without data - show image placeholder
                      <>
                        <ImageIcon className="w-6 h-6 text-foreground-muted" />
                        <span className="text-[8px] text-foreground-muted text-center px-1 truncate w-full">
                          {file.name}
                        </span>
                      </>
                    ) : (
                      // Other type - show generic placeholder
                      <>
                        <FileText className="w-6 h-6 text-foreground-muted" />
                        <span className="text-[8px] text-foreground-muted text-center px-1 truncate w-full">
                          {file.name}
                        </span>
                      </>
                    )}
                  </div>
                ))}
              </div>
            )}
            <p className="whitespace-pre-wrap break-words">{content}</p>
          </div>
        ) : (
          <div className="bg-ai-bubble border border-ai-bubble-border rounded-2xl rounded-tl-sm px-4 py-3 shadow-sm">
            <div
              className={cn(
                'prose prose-sm max-w-none',
                // Light mode prose
                'prose-p:text-foreground prose-p:leading-relaxed prose-p:my-2',
                'prose-headings:text-foreground prose-headings:font-semibold',
                'prose-strong:text-foreground',
                'prose-a:text-accent prose-a:no-underline hover:prose-a:underline',
                'prose-li:text-foreground-secondary',
                'prose-ul:my-2 prose-ol:my-2 prose-li:my-0.5',
                'prose-blockquote:border-accent/30 prose-blockquote:text-foreground-muted',
                'prose-hr:border-border',
                // Code blocks
                'prose-pre:bg-background-secondary prose-pre:border prose-pre:border-border prose-pre:rounded-xl',
                'prose-code:text-accent prose-code:before:content-[""] prose-code:after:content-[""]',
                // Dark mode overrides
                'dark:prose-invert',
                'dark:prose-pre:bg-background-tertiary dark:prose-pre:border-border'
              )}
            >
              <AssistantMessageContent content={content} />
            </div>
          </div>
        )}

        {/* Message metadata for AI messages */}
        {!isUser && (
          <div className="flex items-center gap-1.5 text-[10px] text-foreground-muted px-1 mt-1">
            <span className="flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3 text-success" />
              <span>Verified</span>
            </span>
            •
            {message.metadata?.duration !== undefined && (
              <span className="text-foreground-muted">
                {formatDuration(Number(message.metadata.duration))}
              </span>
            )}
          </div>
        )}

        {/* Timestamp */}
        <span className="text-[10px] text-foreground-muted font-medium px-0.5">
          {formatTimestamp(message.timestamp)}
        </span>
      </div>
    </motion.div>
  );
};

/**
 * System messages render as centered subtle pills.
 */
const SystemMessage: React.FC<{ content: string; metadata?: Record<string, unknown> }> = ({ content, metadata }) => {
  const isFileEvent = content.startsWith('File created');
  const isError = metadata?.isError === true;

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex justify-center py-2"
    >
      <div className={cn(
        "flex items-start gap-2 px-3.5 py-2 rounded-lg border",
        isError 
          ? "bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800" 
          : "bg-background-secondary border-border"
      )}>
        {isError ? (
          <AlertCircle className="w-4 h-4 text-red-500 dark:text-red-400 shrink-0 mt-0.5" />
        ) : isFileEvent ? (
          <FileText className="w-3 h-3 text-success shrink-0" />
        ) : (
          <Info className="w-3 h-3 text-foreground-muted shrink-0" />
        )}
        <span className={cn(
          "text-[11px] leading-relaxed whitespace-pre-wrap",
          isError ? "text-red-600 dark:text-red-400" : "text-foreground-muted"
        )}>
          {content}
        </span>
      </div>
    </motion.div>
  );
};

function formatTimestamp(timestamp: string): string {
  try {
    return new Date(timestamp).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (remainingSeconds === 0) return `${minutes}m`;
  return `${minutes}m ${remainingSeconds}s`;
}