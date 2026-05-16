import { cn } from '@/lib/utils';
import { useAgentStatusStore, MAIN_AGENT_NAMES, MEDGEMMA_AGENTS, type AgentStatus, type ActivityEntry } from '@/stores/agentStatusStore';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Bot,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
  Crown,
  BookOpen,
  FileText,
  Scan,
  Stethoscope,
  Pill,
  Loader2,
  AlertCircle,
  Wrench,
  MessageSquare,
  Clock,
  Plug,
} from 'lucide-react';
import React, { useState } from 'react';

// Agent icon mapping
const AGENT_ICONS: Record<string, typeof Bot> = {
  attending_physician: Stethoscope,
  chief_of_medicine: Crown,
  clinical_pharmacologist: Pill,
  clinical_researcher: BookOpen,
  medical_scribe: FileText,
  radiologist: Scan,
  mcp_agent: Plug,
};

// Format token count for display (e.g., 340K, 1.2M)
function formatTokenCount(tokens: number): string {
  if (tokens >= 1_000_000) {
    return `${(tokens / 1_000_000).toFixed(1)}M tokens`;
  }
  if (tokens >= 1_000) {
    return `${(tokens / 1_000).toFixed(0)}K tokens`;
  }
  return `${tokens} tokens`;
}

// Agent color mapping
const AGENT_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  attending_physician: {
    bg: 'bg-orange-100 dark:bg-orange-900/30',
    text: 'text-orange-600 dark:text-orange-400',
    border: 'border-orange-200 dark:border-orange-800',
  },
  chief_of_medicine: {
    bg: 'bg-blue-100 dark:bg-blue-900/30',
    text: 'text-blue-600 dark:text-blue-400',
    border: 'border-blue-200 dark:border-blue-800',
  },
  clinical_pharmacologist: {
    bg: 'bg-teal-100 dark:bg-teal-900/30',
    text: 'text-teal-600 dark:text-teal-400',
    border: 'border-teal-200 dark:border-teal-800',
  },
  clinical_researcher: {
    bg: 'bg-green-100 dark:bg-green-900/30',
    text: 'text-green-600 dark:text-green-400',
    border: 'border-green-200 dark:border-green-800',
  },
  medical_scribe: {
    bg: 'bg-purple-100 dark:bg-purple-900/30',
    text: 'text-purple-600 dark:text-purple-400',
    border: 'border-purple-200 dark:border-purple-800',
  },
  radiologist: {
    bg: 'bg-red-100 dark:bg-red-900/30',
    text: 'text-red-600 dark:text-red-400',
    border: 'border-red-200 dark:border-red-800',
  },
  mcp_agent: {
    bg: 'bg-indigo-100 dark:bg-indigo-900/30',
    text: 'text-indigo-600 dark:text-indigo-400',
    border: 'border-indigo-200 dark:border-indigo-800',
  },
};

export const AgentActivityPanel: React.FC = () => {
  const agents = useAgentStatusStore((s) => s.agents);

  // Get agents in order, only show ones that have been created
  const activeAgents = MAIN_AGENT_NAMES
    .map((name) => agents[name])
    .filter((agent): agent is AgentStatus => agent !== undefined);

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Agent List */}
      <div className="flex-1 overflow-y-auto p-3 custom-scrollbar space-y-3">
        <AnimatePresence mode="popLayout">
          {activeAgents.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center px-4">
              <div className="w-12 h-12 rounded-full bg-background-secondary border border-border flex items-center justify-center mb-4">
                <Bot className="w-6 h-6 text-foreground-muted" />
              </div>
              <p className="text-foreground font-medium text-sm">No agents active</p>
              <p className="text-foreground-muted text-xs mt-1">
                Agents will appear here when processing tasks.
              </p>
            </div>
          ) : (
            activeAgents.map((agent) => (
              <AgentCard key={agent.name} agent={agent} />
            ))
          )}
        </AnimatePresence>
      </div>
    </div>
  );
};

interface AgentCardProps {
  agent: AgentStatus;
}

const AgentCard: React.FC<AgentCardProps> = ({ agent }) => {
  const [isExpanded, setIsExpanded] = useState(agent.state === 'working');
  const Icon = AGENT_ICONS[agent.name] || Bot;
  const colors = AGENT_COLORS[agent.name] || AGENT_COLORS.chief_of_medicine;

  // Parse the task content from lastInput to get just the task description
  const extractTaskDescription = (input: string | undefined): string => {
    if (!input) return '';
    // Try to extract the content between "==============================" markers
    const match = input.match(/the content of the task.*?is:\s*\n*={10,}\n*([\s\S]*?)\n*={10,}/i);
    if (match) {
      return match[1].trim().slice(0, 300);
    }
    // Fallback: just return first 300 chars
    return input.slice(0, 300);
  };

  // Parse output to get clean result
  const extractOutput = (output: string | undefined): string => {
    if (!output) return '';
    // Try to parse JSON output
    try {
      // Remove markdown code block if present
      const jsonMatch = output.match(/```json\s*([\s\S]*?)\s*```/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[1]);
        return parsed.content || output.slice(0, 500);
      }
      const parsed = JSON.parse(output);
      return parsed.content || output.slice(0, 500);
    } catch {
      return output.slice(0, 500);
    }
  };

  const taskDescription = extractTaskDescription(agent.lastInput);
  const outputContent = extractOutput(agent.lastOutput);

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className={cn(
        'rounded-xl border overflow-hidden transition-all',
        agent.state === 'working' ? colors.border : 'border-border',
        agent.state === 'working' && 'shadow-sm'
      )}
    >
      {/* Agent Header */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className={cn(
          'w-full flex items-center gap-3 p-3 transition-colors',
          agent.state === 'working' ? colors.bg : 'bg-card hover:bg-card-hover'
        )}
      >
        {/* Status Icon */}
        <div className={cn('relative', agent.state === 'working' && 'animate-pulse')}>
          {agent.state === 'working' ? (
            <Loader2 className={cn('w-5 h-5 animate-spin', colors.text)} />
          ) : agent.state === 'completed' ? (
            <CheckCircle2 className="w-5 h-5 text-success" />
          ) : agent.state === 'error' ? (
            <AlertCircle className="w-5 h-5 text-error" />
          ) : (
            <Circle className="w-5 h-5 text-foreground-muted" />
          )}
        </div>

        {/* Agent Info */}
        <div className="flex-1 min-w-0 text-left">
          <div className="flex items-center gap-2">
            <Icon className={cn('w-4 h-4', colors.text)} />
            <span className={cn('text-sm font-medium', colors.text)}>
              {agent.displayName}
            </span>
            {MEDGEMMA_AGENTS.includes(agent.name) && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-teal-500/20 text-teal-600 dark:text-teal-400 font-medium">
                Gemma 4
              </span>
            )}
          </div>
          {agent.state === 'working' && agent.currentToolkit && (
            <div className="flex items-center gap-1.5 mt-1">
              <Wrench className="w-3 h-3 text-foreground-muted" />
              <span className="text-[10px] text-foreground-muted truncate">
                {agent.currentToolkit} → {agent.currentMethod}
              </span>
            </div>
          )}
        </div>

        {/* Token count */}
        {agent.tokensUsed > 0 && (
          <span className="text-[10px] text-foreground-muted">
            {formatTokenCount(agent.tokensUsed)}
          </span>
        )}

        {/* Expand chevron */}
        {isExpanded ? (
          <ChevronDown className="w-4 h-4 text-foreground-muted" />
        ) : (
          <ChevronRight className="w-4 h-4 text-foreground-muted" />
        )}
      </button>

      {/* Expanded Content */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="border-t border-border bg-background-secondary"
          >
            <div className="p-3 space-y-3">
              {/* Current Task */}
              {taskDescription && (
                <div>
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <MessageSquare className="w-3 h-3 text-foreground-muted" />
                    <span className="text-[10px] font-semibold text-foreground-muted uppercase tracking-wide">
                      Task
                    </span>
                  </div>
                  <div className="text-xs text-foreground-secondary bg-background-tertiary rounded-lg p-2.5 max-h-24 overflow-y-auto custom-scrollbar">
                    {taskDescription}
                  </div>
                </div>
              )}

              {/* Output */}
              {outputContent && agent.state !== 'working' && (
                <div>
                  <div className="flex items-center gap-1.5 mb-1.5">
                    {agent.state === 'error' ? (
                      <AlertCircle className="w-3 h-3 text-error" />
                    ) : (
                      <CheckCircle2 className="w-3 h-3 text-success" />
                    )}
                    <span className="text-[10px] font-semibold text-foreground-muted uppercase tracking-wide">
                      Output
                    </span>
                  </div>
                  <div className="text-xs text-foreground-secondary bg-background-tertiary rounded-lg p-2.5 max-h-32 overflow-y-auto custom-scrollbar">
                    {outputContent}
                  </div>
                </div>
              )}

              {/* Activity Log */}
              {agent.activityLog.length > 0 && (
                <div className="flex flex-col mt-2 border-t border-border/50 pt-3">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-1.5">
                      <Clock className="w-3 h-3 text-foreground-muted" />
                      <span className="text-[10px] font-semibold text-foreground-muted uppercase tracking-wide">
                        Activity Timeline ({agent.activityLog.length})
                      </span>
                    </div>
                  </div>
                  
                  <div className="relative pl-1 max-h-72 overflow-y-auto custom-scrollbar pr-2">
                    {/* Vertical timeline line */}
                    <div className="absolute left-[11px] top-2 bottom-4 w-px bg-border/60" />
                    
                    {agent.activityLog.map((entry, idx) => (
                      <ActivityItem 
                        key={entry.id} 
                        entry={entry} 
                        isLast={idx === agent.activityLog.length - 1} 
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};

// ============================================
// Activity Timeline Components
// ============================================

function formatJson(str: string) {
  if (!str) return '';
  try {
    const parsed = JSON.parse(str);
    return JSON.stringify(parsed, null, 2);
  } catch {
    return str;
  }
}

const ActivityItem: React.FC<{ entry: ActivityEntry; isLast: boolean }> = ({ entry, isLast: _isLast }) => {
  const [expanded, setExpanded] = useState(false);

  let icon = <Circle className="w-3 h-3 text-foreground-muted" />;
  let colorClass = "text-foreground-secondary";

  if (entry.type === 'error') {
    icon = <AlertCircle className="w-3 h-3 text-error" />;
    colorClass = "text-error";
  } else if (entry.type === 'toolkit_start') {
    icon = <Wrench className="w-3 h-3 text-accent" />;
    colorClass = "text-foreground font-medium";
  } else if (entry.type === 'toolkit_end') {
    icon = <CheckCircle2 className="w-3 h-3 text-success" />;
    colorClass = "text-success";
  } else if (entry.type === 'activated' || entry.type === 'deactivated') {
    icon = <Bot className="w-3 h-3 text-foreground-muted" />;
  }

  const hasMetadata = entry.metadata && (entry.metadata.args || entry.metadata.result);
  
  // Clean up error message to not show the massive JSON inline
  const isError = entry.type === 'error';
  const displayMessage = isError && entry.message.includes('Error code:') 
    ? 'Error: ' + entry.message.split(' - ')[0]
    : entry.message;

  const isLongMessage = !isError && displayMessage.length > 80;
  const isExpandable = hasMetadata || isError || isLongMessage;
  const titleMessage = isLongMessage ? displayMessage.slice(0, 80) + '...' : displayMessage;

  return (
    <div className="relative flex items-start gap-3">
      {/* Icon background to cover the timeline line */}
      <div className="bg-background-secondary p-0.5 rounded-full z-10 mt-0.5 ring-2 ring-background-secondary">
        {icon}
      </div>
      
      <div className="flex-1 min-w-0 pb-4">
        <div 
          className={cn(
            "flex flex-col text-[10px]",
            isExpandable ? "cursor-pointer hover:bg-background-tertiary rounded p-1 -ml-1 -mt-1 transition-colors" : ""
          )}
          onClick={() => isExpandable && setExpanded(!expanded)}
        >
          <div className="flex items-center justify-between gap-2">
            <span className={cn("truncate", colorClass)}>
              {titleMessage}
            </span>
            <div className="flex items-center gap-1 shrink-0">
              <span className="text-foreground-muted text-[9px]">
                {entry.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </span>
              {isExpandable && (
                expanded ? <ChevronDown className="w-3 h-3 text-foreground-muted" /> : <ChevronRight className="w-3 h-3 text-foreground-muted" />
              )}
            </div>
          </div>
          
          {/* Expanded Metadata */}
          <AnimatePresence>
            {expanded && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="overflow-hidden"
              >
                <div 
                  className="mt-1.5 p-2 bg-background rounded border border-border overflow-x-auto max-w-full text-[10px] font-mono whitespace-pre-wrap max-h-64 custom-scrollbar" 
                  onClick={e => e.stopPropagation()}
                >
                  {entry.metadata?.args && (
                    <div className="text-accent/80">
                      <span className="font-bold text-accent">Arguments:</span>
                      <br/>
                      {formatJson(entry.metadata.args)}
                    </div>
                  )}
                  {entry.metadata?.result && (
                    <div className="text-foreground-muted mt-1">
                      <span className="font-bold text-success">Result:</span>
                      <br/>
                      {formatJson(entry.metadata.result)}
                    </div>
                  )}
                  {isError && !hasMetadata && (
                    <div className="text-error/80">
                      {entry.message}
                    </div>
                  )}
                  {isLongMessage && !hasMetadata && !isError && (
                    <div className={colorClass}>
                      {entry.message}
                    </div>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
};