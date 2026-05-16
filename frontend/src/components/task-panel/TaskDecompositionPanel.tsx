import { cn } from '@/lib/utils';
import { useTaskDecompStore } from '@/stores/taskDecompStore';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Activity,
  AlertCircle,
  CheckCircle2,
  ChevronRight,
  Circle,
  Layers,
  Loader2,
  XCircle,
  Terminal,
  Image as ImageIcon,
  Search,
  FileText,
  Bot,
} from 'lucide-react';
import React from 'react';

// Agent type configuration with colors
const AGENT_CONFIG: Record<string, { color: string; bgColor: string; icon: typeof Bot }> = {
  coordinator: { color: 'text-purple-600 dark:text-purple-400', bgColor: 'bg-purple-100 dark:bg-purple-900/30', icon: Activity },
  vision: { color: 'text-blue-600 dark:text-blue-400', bgColor: 'bg-blue-100 dark:bg-blue-900/30', icon: ImageIcon },
  browser: { color: 'text-green-600 dark:text-green-400', bgColor: 'bg-green-100 dark:bg-green-900/30', icon: Search },
  document: { color: 'text-orange-600 dark:text-orange-400', bgColor: 'bg-orange-100 dark:bg-orange-900/30', icon: FileText },
  default: { color: 'text-accent', bgColor: 'bg-accent-light', icon: Bot },
};

export const TaskDecompositionPanel: React.FC = () => {
  const { taskTree: rootTasks } = useTaskDecompStore();

  // Check if any task is currently running
  const hasActiveTask = rootTasks?.some(task =>
    task.state?.toLowerCase() === 'running' ||
    task.subtasks?.some((st: any) => st.state?.toLowerCase() === 'running')
  );

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Task Tree */}
      <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
        <div className="space-y-2">
          <AnimatePresence mode="popLayout">
            {rootTasks && rootTasks.map((task, index) => (
              <TaskNode
                key={task.id}
                task={task}
                level={0}
                isLast={index === rootTasks.length - 1}
              />
            ))}
          </AnimatePresence>

          {(!rootTasks || rootTasks.length === 0) && (
            <div className="flex flex-col items-center justify-center py-20 text-center px-4">
              <div className="w-12 h-12 rounded-full bg-background-secondary border border-border flex items-center justify-center mb-4">
                <Layers className="w-6 h-6 text-foreground-muted" />
              </div>
              <p className="text-foreground font-medium text-sm">No tasks active</p>
              <p className="text-foreground-muted text-xs mt-1">Start a conversation to see task decomposition.</p>
            </div>
          )}
        </div>
      </div>

      {/* Terminal-style Log Footer */}
      <div className="p-3 border-t border-border bg-background-tertiary">
        <div className="flex items-center gap-2 text-[10px] text-foreground-muted uppercase tracking-widest font-bold mb-2">
          <Terminal className="w-3.5 h-3.5" />
          <span>System Output</span>
        </div>
        <div className="terminal-text text-[11px] text-foreground-muted/80 h-16 overflow-y-auto custom-scrollbar">
          {hasActiveTask ? (
            <>
              <div className="text-success">&gt; Agents orchestrating...</div>
              <div>&gt; Processing multi-modal inputs</div>
              <div className="animate-pulse">&gt; _</div>
            </>
          ) : (
            <div className="text-foreground-muted">&gt; Awaiting instructions...</div>
          )}
        </div>
      </div>
    </div>
  );
};

interface TaskNodeProps {
  task: any;
  level: number;
  isLast?: boolean;
}

const TaskNode: React.FC<TaskNodeProps> = ({ task, level, isLast }) => {
  const hasChildren = task.subtasks && task.subtasks.length > 0;

  // Map backend states to UI statuses
  const getStatus = () => {
    switch (task.state?.toLowerCase()) {
      case 'done': return 'completed';
      case 'running': return 'in_progress';
      case 'failed': return 'error';
      case 'cancelled': return 'cancelled';
      default: return 'waiting';
    }
  };

  const status = getStatus();

  // Get agent config
  const agentType = task.assignedToName?.toLowerCase() || 'default';
  const agentConfig = AGENT_CONFIG[agentType] || AGENT_CONFIG.default;
  const AgentIcon = agentConfig.icon;

  return (
    <motion.div
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -10 }}
      className={cn("relative", !isLast && level === 0 && "timeline-connector")}
    >
      <div
        className={cn(
          "group flex items-start gap-3 p-3 rounded-lg transition-colors cursor-default",
          level === 0
            ? "bg-card border border-card-border hover:border-border-hover"
            : "hover:bg-background-secondary"
        )}
      >
        {/* Status indicator with timeline dot */}
        <div className="mt-0.5 relative">
          {status === 'completed' ? (
            <CheckCircle2 className="w-4 h-4 text-success" />
          ) : status === 'in_progress' ? (
            <div className="relative">
              <Loader2 className="w-4 h-4 text-accent animate-spin" />
              {/* Ping effect for active */}
              <span className="absolute inset-0 rounded-full bg-accent/20 animate-pulse-ring" />
            </div>
          ) : status === 'error' ? (
            <AlertCircle className="w-4 h-4 text-warning" />
          ) : status === 'cancelled' ? (
            <XCircle className="w-4 h-4 text-foreground-muted" />
          ) : (
            <Circle className="w-4 h-4 text-foreground-muted" />
          )}
        </div>

        <div className="flex-1 min-w-0">
          {/* Task content */}
          <p className={cn(
            "text-sm font-medium leading-tight",
            status === 'completed' ? "text-foreground-muted"
              : status === 'cancelled' ? "text-foreground-muted line-through"
              : "text-foreground"
          )}>
            {task.content}
          </p>

          {/* Agent tag */}
          {task.assignedToName && (
            <div className="flex items-center gap-2 mt-2">
              <span className={cn(
                "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-semibold uppercase tracking-wide",
                agentConfig.bgColor,
                agentConfig.color
              )}>
                <AgentIcon className="w-3 h-3" />
                {task.assignedToName}
              </span>
              {status === 'in_progress' && (
                <span className="text-[9px] text-foreground-muted uppercase tracking-wide animate-pulse">
                  Processing...
                </span>
              )}
            </div>
          )}
        </div>

        {hasChildren && (
          <ChevronRight className="w-3.5 h-3.5 text-foreground-muted group-hover:text-foreground-secondary transition-colors" />
        )}
      </div>

      {/* Subtasks with connecting line */}
      {hasChildren && (
        <div className="ml-6 pl-4 border-l-2 border-border space-y-2 mt-2">
          {task.subtasks.map((subtask: any, idx: number) => (
            <TaskNode
              key={subtask.id}
              task={subtask}
              level={level + 1}
              isLast={idx === task.subtasks.length - 1}
            />
          ))}
        </div>
      )}
    </motion.div>
  );
};