import { Button } from '@/components/ui/button';
import { McpConfigDialog } from '@/components/mcp/McpConfigDialog';
import { useChat } from '@/hooks/useChat';
import { cn } from '@/lib/utils';
import { useApiConfigStore } from '@/stores/apiConfigStore';
import { useChatStore } from '@/stores/chatStore';
import { useMcpStore } from '@/stores/mcpStore';
import { useProjectStore } from '@/stores/projectStore';
import { AnimatePresence, motion } from 'framer-motion';
import {
  AlertTriangle,
  Camera,
  FileText,
  Paperclip,
  PauseCircle,
  Plug,
  Send,
  Upload,
  X,
} from 'lucide-react';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB limit

// Default model configuration from environment variables
const DEFAULT_MODEL_PLATFORM =
  import.meta.env.VITE_DEFAULT_MODEL_PLATFORM || 'GEMINI';
const DEFAULT_MODEL_TYPE =
  import.meta.env.VITE_DEFAULT_MODEL_TYPE || 'gemma-4-31b-it';
const DEFAULT_MODEL_API_URL =
  import.meta.env.VITE_DEFAULT_MODEL_API_URL || null;

interface AttachedFile {
  data: string; // base64 data URL
  name: string; // original filename
  type: 'image' | 'pdf';
}

const MOBILE_BREAKPOINT = 768;

export const TaskInputPanel: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [message, setMessage] = useState('');
  const [attachments, setAttachments] = useState<AttachedFile[]>([]);
  const [isFocused, setIsFocused] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [showMobileAttachMenu, setShowMobileAttachMenu] = useState(false);
  const mcpServers = useMcpStore((state) => state.servers);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const dropZoneRef = useRef<HTMLDivElement>(null);
  const mobileMenuRef = useRef<HTMLDivElement>(null);
  const inputChatRef = useRef<HTMLTextAreaElement>(null);

  // Handle responsive layout
  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    };

    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Close mobile menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        mobileMenuRef.current &&
        !mobileMenuRef.current.contains(event.target as Node)
      ) {
        setShowMobileAttachMenu(false);
      }
    };

    if (showMobileAttachMenu) {
      document.addEventListener('mousedown', handleClickOutside);
      return () =>
        document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showMobileAttachMenu]);

  // Auto-resize textarea based on content
  useEffect(() => {
    if (inputChatRef.current) {
      inputChatRef.current.style.height = 'auto';
      inputChatRef.current.style.height = `${inputChatRef.current.scrollHeight}px`;
    }
  }, [message]);

  const { sendMessage, sendHumanReply, stopChat, isLoading, isStreaming } =
    useChat();
  const { geminiApiKey, backendHasApiKey } = useApiConfigStore();

  // Consume pending input from suggestion chips
  const pendingInput = useChatStore((state) => state.pendingInput);
  useEffect(() => {
    if (pendingInput) {
      setMessage(pendingInput);
      useChatStore.getState().setPendingInput(null);
    }
  }, [pendingInput]);
  const wasStopped = useChatStore((state) => state.wasStopped);
  const waitingForHumanReply = useChatStore(
    (state) => state.waitingForHumanReply,
  );
  const currentAskAgent = useChatStore((state) => state.currentAskAgent);
  const currentAskAgentDisplayName = useChatStore(
    (state) => state.currentAskAgentDisplayName,
  );
  const setWaitingForHumanReply = useChatStore(
    (state) => state.setWaitingForHumanReply,
  );

  const isProcessing =
    (isStreaming || isLoading) && !wasStopped && !waitingForHumanReply;
  const hasText = message.trim().length > 0;
  const hasContent = hasText || attachments.length > 0;
  const canSend =
    hasContent && (!isProcessing || waitingForHumanReply) && hasText;

  // Project-aware: check if there are prior persisted messages for the disclaimer
  const currentProjectId = useChatStore((state) => state.currentProjectId);
  const projectFromStore = useProjectStore((s) =>
    currentProjectId
      ? s.projects.find((p) => p.id === currentProjectId)
      : undefined,
  );
  const hasPriorMessages =
    (projectFromStore?.messages?.length ?? 0) > 0 && !isStreaming;
  const showDisclaimer = hasPriorMessages && message.trim().length > 0;

  // Process files (from input or drag & drop)
  const processFiles = useCallback((files: FileList | File[]) => {
    Array.from(files).forEach((file) => {
      // Accept image files and PDF files
      const isImage = file.type.startsWith('image/');
      const isPdf = file.type === 'application/pdf';

      if (!isImage && !isPdf) {
        console.warn('Skipping unsupported file type:', file.name, file.type);
        return;
      }

      if (file.size > MAX_FILE_SIZE) {
        toast.error(`File "${file.name}" exceeds the maximum size of 2MB`);
        return;
      }

      const reader = new FileReader();
      reader.onloadend = () => {
        setAttachments((prev) => [
          ...prev,
          {
            data: reader.result as string,
            name: file.name,
            type: isImage ? 'image' : 'pdf',
          },
        ]);
      };
      reader.readAsDataURL(file);
    });
  }, []);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files) {
      processFiles(files);
    }
    // Reset input so same file can be selected again
    e.target.value = '';
    setShowMobileAttachMenu(false);
  };

  const handleCameraCapture = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files) {
      processFiles(files);
    }
    // Reset input so same file can be selected again
    e.target.value = '';
    setShowMobileAttachMenu(false);
  };

  const handleAttachClick = () => {
    if (isMobile) {
      setShowMobileAttachMenu(!showMobileAttachMenu);
    } else {
      fileInputRef.current?.click();
    }
  };

  const removeAttachment = (index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  };

  // Drag & Drop handlers
  const handleDragEnter = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (isProcessing) return;
      setIsDragging(true);
    },
    [isProcessing],
  );

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // Only set isDragging to false if we're leaving the drop zone entirely
    if (
      dropZoneRef.current &&
      !dropZoneRef.current.contains(e.relatedTarget as Node)
    ) {
      setIsDragging(false);
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);

      if (isProcessing) return;

      const files = e.dataTransfer.files;
      if (files && files.length > 0) {
        processFiles(files);
      }
    },
    [isProcessing, processFiles],
  );

  const handleSend = async () => {
    console.log(
      'Send clicked! Message:',
      message,
      'Processing:',
      isProcessing,
      'API Key exists:',
      !!geminiApiKey,
      'WaitingForHumanReply:',
      waitingForHumanReply,
    );

    // Handle human reply mode
    if (
      waitingForHumanReply &&
      currentAskAgent &&
      (message.trim() || attachments.length > 0)
    ) {
      const currentMessage = message;
      const currentAttachments = [...attachments];
      setMessage('');
      setAttachments([]);

      // Add user message to chat immediately and persist to project
      // files[] contains: {data, name, type} - data is stripped in projectStore for localStorage
      const userMsg: import('@/types').ChatMessage = {
        id: `user-${Date.now()}`,
        role: 'user',
        content: currentMessage,
        timestamp: new Date().toISOString(),
        files: currentAttachments.map((a) => ({
          data: a.data,
          name: a.name,
          type: a.type as 'image' | 'pdf' | 'other',
        })) || undefined,
      };
      useChatStore.getState().addMessage(userMsg);
      const pid = useChatStore.getState().currentProjectId;
      if (pid) {
        useProjectStore.getState().addMessageToProject(pid, userMsg);
      }

      // Clear the waiting state
      setWaitingForHumanReply(false, null);

      try {
        await sendHumanReply(
          currentAskAgent,
          currentMessage,
          currentAttachments.map((a) => a.data),
        );
        console.log('Human reply sent successfully');
      } catch (error) {
        console.error('Failed to send human reply:', error);
        setMessage(currentMessage);
        setAttachments(currentAttachments);
      }
      return;
    }

    if ((message.trim() || attachments.length > 0) && !isProcessing) {
      // Check if API key is configured (frontend or backend)
      if (!geminiApiKey && !backendHasApiKey) {
        console.error('No API key configured!');
        alert('Please enter your Gemini API key in the settings.');
        return;
      }

      // Capture current values before clearing
      const currentMessage = message;
      const currentAttachments = [...attachments];

      // Clear input immediately for better UX
      setMessage('');
      setAttachments([]);

      // Add user message to chat immediately (with attachments) and persist to project
      // files[] contains: {data, name, type} - data is stripped in projectStore for localStorage
      const userMsg: import('@/types').ChatMessage = {
        id: `user-${Date.now()}`,
        role: 'user',
        content: currentMessage,
        timestamp: new Date().toISOString(),
        files: currentAttachments.map((a) => ({
          data: a.data,
          name: a.name,
          type: a.type as 'image' | 'pdf' | 'other',
        })) || undefined,
      };
      useChatStore.getState().addMessage(userMsg);
      const existingProjectId = useChatStore.getState().currentProjectId;
      if (existingProjectId) {
        useProjectStore
          .getState()
          .addMessageToProject(existingProjectId, userMsg);
      }

      try {
        console.log('Sending message:', currentMessage);

        // Get the last 5 messages from project history for context (excluding current message)
        const projectMessages = existingProjectId
          ? useProjectStore.getState().getMessagesForProject(existingProjectId)
          : [];
        const last5Messages = projectMessages.slice(-6, -1);

        // Use sendMessage which automatically detects whether to use improve or start new chat
        // If no frontend key, send empty string — backend will use its .env default
        await sendMessage(
          currentMessage,
          currentAttachments.map((a) => a.data),
          {
            model_platform: DEFAULT_MODEL_PLATFORM,
            model_type: DEFAULT_MODEL_TYPE,
            api_key: geminiApiKey || '',
            api_url: DEFAULT_MODEL_API_URL,
            max_retries: 3,
            installed_mcp: useMcpStore.getState().getInstalledMcp(),
            summary_prompt: '',
          },
          last5Messages,
        );

        console.log('Message sent successfully');

        // If this was a new chat (no existing project), navigate to project page
        // BUT skip navigation when on the Dashboard (/) because the Dashboard
        // already renders ConversationPanel + MonitoringPanel. Navigating away
        // would unmount the component tree, tearing down the WebSocket
        // connection and losing the streaming response.
        const newProjectId = useChatStore.getState().currentProjectId;
        if (!existingProjectId && newProjectId) {
          // Persist the user message to the project before navigating,
          // so ProjectPage's useEffect can reload it from projectStore.
          useProjectStore.getState().addMessageToProject(newProjectId, userMsg);

          const isDashboard = location.pathname === '/';
          if (isDashboard) {
            // Silently update the URL so a page refresh lands on the project page
            window.history.replaceState(null, '', `/project/${newProjectId}`);
          } else {
            navigate(`/project/${newProjectId}`);
          }
        }
      } catch (error) {
        console.error('Failed to send:', error);
        // Restore input on error so user can retry
        setMessage(currentMessage);
        setAttachments(currentAttachments);
        if (error instanceof Error) {
          alert('Error: ' + error.message);
        }
      }
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Block Enter key when processing
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (canSend) {
        handleSend();
      }
    }
  };

  return (
    <div
      ref={dropZoneRef}
      className={cn(
        'flex flex-col bg-background relative transition-colors',
        isDragging && 'bg-accent/5',
      )}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {/* Drag overlay */}
      <AnimatePresence>
        {isDragging && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-10 flex items-center justify-center bg-accent/10 border-2 border-dashed border-accent rounded-xl m-2 pointer-events-none"
          >
            <div className="flex flex-col items-center gap-2 text-accent">
              <Upload className="w-8 h-8" />
              <span className="text-sm font-medium">Drop images here</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Human Reply Banner */}
      <AnimatePresence>
        {waitingForHumanReply && currentAskAgent && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="flex items-center gap-2 px-4 py-2 bg-amber-500/10 border-b border-amber-500/20"
          >
            <div className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
            <span className="text-xs font-medium text-amber-500">
              {currentAskAgentDisplayName || currentAskAgent} is waiting for
              your reply
            </span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Attached Files */}
      <AnimatePresence>
        {attachments.length > 0 && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="flex flex-wrap gap-2 px-4 pt-3"
          >
            {attachments.map((file, i) => (
              <motion.div
                key={i}
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.8, opacity: 0 }}
                className="relative group w-20 h-16 rounded-lg overflow-hidden border border-border bg-background-secondary flex flex-col items-center justify-center"
              >
                {file.type === 'image' ? (
                  <img
                    src={file.data}
                    alt={file.name}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="flex flex-col items-center justify-center p-1 w-full h-full bg-red-50 dark:bg-red-900/30">
                    <FileText className="w-6 h-6 text-red-500 dark:text-red-400" />
                    <span className="text-[8px] text-red-600 dark:text-red-400 truncate w-full text-center px-1">
                      PDF
                    </span>
                  </div>
                )}
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors" />
                <button
                  onClick={() => removeAttachment(i)}
                  className="absolute top-1 right-1 p-1 bg-background/90 rounded-full opacity-0 group-hover:opacity-100 transition-opacity shadow-sm"
                >
                  <X className="w-3 h-3 text-foreground" />
                </button>
                <span className="absolute bottom-0 left-0 right-0 bg-black/60 text-white text-[8px] truncate px-1 text-center">
                  {file.name}
                </span>
              </motion.div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Input Area */}
      <div className="flex-1 flex items-center gap-3 p-4 relative">
        {/* File input for desktop and Files option */}
        <input
          type="file"
          accept="image/*,.pdf"
          multiple
          className="hidden"
          ref={fileInputRef}
          onChange={handleFileUpload}
        />

        {/* Camera input for mobile camera option */}
        <input
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          ref={cameraInputRef}
          onChange={handleCameraCapture}
        />

        {/* Mobile Attachment Menu */}
        {isMobile && showMobileAttachMenu && (
          <div
            ref={mobileMenuRef}
            className="absolute bottom-full left-4 mb-2 bg-card border border-border rounded-xl shadow-lg p-2 z-50 min-w-[140px]"
          >
            <button
              onClick={() => {
                cameraInputRef.current?.click();
                setShowMobileAttachMenu(false);
              }}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-accent/10 transition-colors text-left"
            >
              <div className="p-1.5 rounded-lg bg-accent/10 text-accent shrink-0">
                <Camera className="w-4 h-4" />
              </div>
              <span className="text-sm text-foreground">Camera</span>
            </button>
            <button
              onClick={() => {
                fileInputRef.current?.click();
                setShowMobileAttachMenu(false);
              }}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-accent/10 transition-colors text-left mt-1"
            >
              <div className="p-1.5 rounded-lg bg-accent/10 text-accent shrink-0">
                <FileText className="w-4 h-4" />
              </div>
              <span className="text-sm text-foreground">Files</span>
            </button>
          </div>
        )}

        <Button
          variant="ghost"
          size="icon"
          className={cn(
            'w-10 h-10 rounded-xl shrink-0 transition-colors',
            'text-foreground-muted hover:text-accent hover:bg-accent-light',
            showMobileAttachMenu && 'text-accent bg-accent-light',
          )}
          onClick={handleAttachClick}
          disabled={isProcessing}
        >
          <Paperclip className="w-5 h-5" />
        </Button>

        {/* MCP Servers Indicator - Only show when MCP is configured */}
        {(() => {
          const serverCount = Object.keys(mcpServers).length;
          if (serverCount === 0) return null;
          return (
            <Button
              variant="ghost"
              size="icon"
              className={cn(
                'w-10 h-10 rounded-xl shrink-0 transition-colors relative',
                'text-accent hover:bg-accent-light',
              )}
              onClick={() => useMcpStore.getState().setDialogOpen(true)}
              title="MCP Servers"
            >
              <Plug className="w-5 h-5" />
              <span className="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full bg-accent text-accent-foreground text-[10px] font-bold flex items-center justify-center">
                {serverCount}
              </span>
            </Button>
          );
        })()}

        <div
          className={cn(
            'flex-1 relative rounded-xl transition-all duration-200',
            isFocused && !waitingForHumanReply && 'border-accent',
            isFocused && waitingForHumanReply && 'ring-2 ring-amber-500/30',
          )}
        >
          <textarea
            ref={inputChatRef}
            rows={1}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={handleKeyDown}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setIsFocused(false)}
            onPaste={(e) => {
              const clipboardData = e.clipboardData;
              if (clipboardData && clipboardData.items) {
                const items = Array.from(clipboardData.items);
                const imageItems = items.filter((item) =>
                  item.type.startsWith('image/'),
                );

                if (imageItems.length > 0) {
                  e.preventDefault();
                  const files = imageItems
                    .map((item) => item.getAsFile())
                    .filter((file): file is File => file !== null);
                  processFiles(files);
                }
              }
            }}
            placeholder={
              waitingForHumanReply && currentAskAgent
                ? `Reply to ${currentAskAgent}...`
                : 'Enter your task or question...'
            }
            className={cn(
              'w-full bg-input border border-input-border rounded-xl px-4 py-2.5',
              'text-foreground placeholder:text-foreground-muted',
              'focus:outline-none transition-colors resize-none overflow-y-auto',
              'scrollbar-hide',
              'min-h-[48px] max-h-[130px]',
              waitingForHumanReply
                ? 'border-amber-500/40 focus:border-amber-500 placeholder:text-amber-500/60'
                : 'focus:border-accent',
              isProcessing && !waitingForHumanReply && 'opacity-60',
            )}
          />
        </div>

        {isStreaming && !waitingForHumanReply ? (
          <Button
            size="icon"
            onClick={stopChat}
            className="w-10 h-10 rounded-xl transition-all duration-300 shrink-0 bg-error hover:bg-error/90 text-white shadow-glow-error"
          >
            <PauseCircle className="w-4 h-4" />
          </Button>
        ) : (
          <Button
            size="icon"
            disabled={!canSend}
            onClick={() => {
              console.log('Button clicked directly');
              handleSend();
            }}
            className={cn(
              'w-10 h-10 rounded-xl transition-all duration-300 shrink-0',
              canSend
                ? waitingForHumanReply
                  ? 'bg-amber-600 hover:bg-amber-500 text-white shadow-[0_0_15px_rgba(217,119,6,0.4)]'
                  : 'bg-accent hover:bg-accent-hover text-accent-foreground shadow-glow'
                : 'bg-background-tertiary text-foreground-muted cursor-not-allowed',
            )}
          >
            <Send className="w-4 h-4" />
          </Button>
        )}
      </div>

      {/* Status Bar - Hidden on mobile */}
      <div
        className={cn(
          'px-4 pb-3 flex items-center justify-center gap-4 text-[10px] text-foreground-muted font-medium uppercase tracking-widest',
          isMobile && 'hidden',
        )}
      >
        <span>Gemma 4 31B</span>
        <span className="w-1 h-1 rounded-full bg-border" />
        <span>Multi-Agent System</span>
        <span className="w-1 h-1 rounded-full bg-border" />
        <span>Online</span>
        {showDisclaimer && (
          <>
            <span className="w-1 h-1 rounded-full bg-border" />
            <span
              title="Sending last 5 conversation turns as context with each message w/o attachments."
              className="flex items-center gap-1 text-amber-500 cursor-help normal-case tracking-normal"
            >
              <AlertTriangle className="w-3 h-3" />
              <span>Memory of 5 turns (w/o media)</span>
            </span>
          </>
        )}
      </div>

      {/* MCP Config Dialog */}
      <McpConfigDialog />
    </div>
  );
};
