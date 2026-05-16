import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAgentStatusStore, type AgentStatus, type ActivityEntry } from '@/stores/agentStatusStore';
import { useResourceStore } from '@/stores/resourceStore';
import { useChatStore } from '@/stores/chatStore';
import { TerminalOutput } from '@/components/resources/TerminalOutput';
import { 
  Terminal, 
  FileText, 
  Activity,
  AlertCircle,
  CheckCircle,
  Wrench,
  Clock,
  ChevronUp,
  Crown,
  BookOpen,
  Scan,
  Stethoscope,
  Pill,
  Plug,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// Medical workforce agents configuration
const MEDICAL_AGENTS_CONFIG = [
  { name: 'chief_of_medicine', displayName: 'Chief of Medicine', icon: Crown, color: 'blue' },
  { name: 'clinical_researcher', displayName: 'Clinical Researcher', icon: BookOpen, color: 'green' },
  { name: 'medical_scribe', displayName: 'Medical Scribe', icon: FileText, color: 'purple' },
  { name: 'radiologist', displayName: 'Radiologist', icon: Scan, color: 'red' },
  { name: 'attending_physician', displayName: 'Attending Physician', icon: Stethoscope, color: 'orange' },
  { name: 'clinical_pharmacologist', displayName: 'Clinical Pharmacologist', icon: Pill, color: 'teal' },
  { name: 'mcp_agent', displayName: 'MCP Agent', icon: Plug, color: 'indigo' },
] as const;



export const AgentDashboard: React.FC = () => {
  const agents = useAgentStatusStore((s) => s.agents);
  const isStreaming = useChatStore((s) => s.isStreaming);

  // Count active agents
  const activeCount = Object.values(agents).filter((a: any) => a.state === 'working').length;
  const totalRegistered = Object.keys(agents).length;

  return (
    <div className="h-full flex flex-col p-4 gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold text-zinc-400 uppercase tracking-widest">
          Medical Team
        </h2>
        <div className="flex items-center gap-3">
          {totalRegistered > 0 && (
            <span className="text-[10px] text-zinc-500 font-mono">
              {activeCount}/{totalRegistered} active
            </span>
          )}
          <div className="flex items-center gap-2">
            <span className={cn(
              "w-2 h-2 rounded-full",
              isStreaming ? "bg-blue-500 animate-pulse" : 
              activeCount > 0 ? "bg-emerald-500 animate-pulse" : "bg-zinc-600"
            )} />
            <span className="text-xs text-zinc-500">
              {isStreaming ? 'Processing' : activeCount > 0 ? 'Agents Active' : 'System Ready'}
            </span>
          </div>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4 flex-1">
        {MEDICAL_AGENTS_CONFIG.map((config) => {
          const agent = agents[config.name];
          return (
            <AgentCard 
              key={config.name} 
              config={config} 
              agent={agent} 
            />
          );
        })}
      </div>
    </div>
  );
};

// Combined agent config type
interface AgentConfigItem {
  name: string;
  displayName: string;
  icon: any;
  color: string;
}

interface AgentCardProps {
  config: AgentConfigItem;
  agent: AgentStatus | undefined;
}

const AgentCard: React.FC<AgentCardProps> = ({ config, agent }) => {
  const Icon = config.icon;
  const isActive = !!agent;
  const state = agent?.state || 'idle';
  const [isExpanded, setIsExpanded] = React.useState(false);
  const [showTerminal, setShowTerminal] = React.useState(false);
  
  // Check if this agent has terminal output
  const terminalOutputs = useResourceStore((s) => s.terminalOutputs);
  const terminalLogs = terminalOutputs[config.name] || [];
  const hasTerminalOutput = terminalLogs.length > 0;
  
  // Auto-show terminal when new output arrives and agent is working
  const prevCountRef = React.useRef(0);
  React.useEffect(() => {
    if (terminalLogs.length > prevCountRef.current && state === 'working') {
      setShowTerminal(true);
    }
    prevCountRef.current = terminalLogs.length;
  }, [terminalLogs.length, state]);
  
  // Color classes need to be hardcoded for Tailwind to detect them
  const colorClasses = getColorClasses(config.color, state, isActive);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn(
        "relative overflow-hidden rounded-xl border p-4 transition-all duration-300 flex flex-col",
        colorClasses.bg,
        state === 'working' && isActive ? colorClasses.ring : "",
        (isExpanded || showTerminal) ? "row-span-2 h-full z-10 shadow-2xl scale-[1.02]" : ""
      )}
    >
      {/* Header */}
      <div className="flex items-center gap-3 mb-3">
        <div className={cn(
          "p-2.5 rounded-xl bg-zinc-950 border border-white/5 shrink-0",
          isActive ? colorClasses.icon : 'text-zinc-700'
        )}>
          <Icon className="w-5 h-5" />
        </div>
        
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-bold text-zinc-200">{config.displayName}</h3>
          <div className="flex items-center gap-2 mt-1">
            <span className={cn("w-2 h-2 rounded-full", colorClasses.dot, state === 'working' && "animate-pulse")} />
            <span className={cn("text-xs uppercase tracking-wider font-medium", 
              isActive ? colorClasses.icon : 'text-zinc-600'
            )}>
              {isActive ? state : 'standby'}
            </span>
          </div>
        </div>

        {/* Terminal toggle button */}
        {hasTerminalOutput && (
          <button
            onClick={(e) => { e.stopPropagation(); setShowTerminal(!showTerminal); }}
            className={cn(
              "p-1.5 rounded-lg border transition-all duration-200",
              showTerminal
                ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400"
                : "bg-zinc-800/50 border-zinc-700/50 text-zinc-500 hover:text-zinc-300 hover:border-zinc-600"
            )}
            title={showTerminal ? "Hide terminal" : "Show terminal"}
          >
            <Terminal className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Current Task / Error Content */}
      {isActive && agent.currentTaskContent && (
        <div 
          onClick={() => setIsExpanded(!isExpanded)}
          className={cn(
            "rounded-lg p-3 border mb-3 min-h-[48px] cursor-pointer transition-colors hover:bg-black/40",
            state === 'error' 
              ? "bg-rose-950/30 border-rose-500/20" 
              : "bg-black/20 border-white/5",
            isExpanded ? "overflow-y-auto max-h-[300px]" : "",
            showTerminal ? "flex-none" : "flex-1"
          )}
        >
          <p className={cn(
            "text-xs leading-relaxed",
            state === 'error' ? "text-rose-300" : "text-zinc-400",
            !isExpanded && "line-clamp-3"
          )}>
            {agent.currentTaskContent}
          </p>
          {!isExpanded && agent.currentTaskContent.length > 150 && (
            <div className="text-[10px] text-zinc-600 mt-1 font-medium italic">Click to expand...</div>
          )}
        </div>
      )}

      {/* Inline Terminal Output (collapsible) */}
      <AnimatePresence>
        {showTerminal && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="mb-3 overflow-hidden"
          >
            <div className={cn(
              "rounded-lg border bg-black/40 overflow-hidden",
              state === 'working' ? "border-emerald-500/20" : "border-zinc-700/50"
            )}>
              {/* Mini terminal header */}
              <div className="flex items-center justify-between px-2 py-1 bg-zinc-900/60 border-b border-white/5">
                <div className="flex items-center gap-1.5">
                  <Terminal className="w-2.5 h-2.5 text-emerald-500" />
                  <span className="text-[9px] font-mono text-zinc-500 uppercase">Terminal</span>
                  <span className="text-[9px] font-mono text-zinc-600">
                    ({terminalLogs.length} lines)
                  </span>
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); setShowTerminal(false); }}
                  className="text-zinc-600 hover:text-zinc-400 transition-colors"
                >
                  <ChevronUp className="w-3 h-3" />
                </button>
              </div>
              {/* Terminal content */}
              <div className="h-[140px]">
                <TerminalOutput agentName={config.name} compact maxLines={30} />
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Activity Log - last 3 entries (hidden when terminal is shown to save space) */}
      {!showTerminal && isActive && agent.activityLog && agent.activityLog.length > 0 && (
        <div className="flex-1 mb-3 space-y-1 max-h-[80px] overflow-hidden">
          <AnimatePresence mode="popLayout">
            {agent.activityLog.slice(-3).map((entry) => (
              <ActivityRow key={entry.id} entry={entry} />
            ))}
          </AnimatePresence>
        </div>
      )}

      {/* Toolkit & Tokens */}
      <div className="flex items-center justify-between mt-auto pt-2 border-t border-white/5">
        {isActive && agent.currentToolkit ? (
          <div className="flex items-center gap-1.5 min-w-0 flex-1">
            <Wrench className="w-3 h-3 text-zinc-500 shrink-0" />
            <span className="text-[10px] text-zinc-400 font-mono truncate">
              {agent.currentToolkit}
              {agent.currentMethod && (
                <span className="text-zinc-600"> &rarr; {agent.currentMethod}</span>
              )}
            </span>
          </div>
        ) : (
          <span className="text-[10px] text-zinc-600">No active tool</span>
        )}
        
        {isActive && (
          <span className="text-[10px] text-zinc-500 shrink-0 ml-2">
            {agent.tokensUsed > 0 ? `${agent.tokensUsed.toLocaleString()} tokens` : ''}
          </span>
        )}
      </div>
      
      {/* Progress bar for working state */}
      {isActive && state === 'working' && (
        <motion.div 
          className={cn("absolute bottom-0 left-0 h-0.5", colorClasses.bar)}
          initial={{ width: "0%" }}
          animate={{ width: ["0%", "100%", "0%"] }}
          transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
        />
      )}
      
      {/* Error indicator */}
      {isActive && state === 'error' && (
        <div className="absolute top-2 right-2">
          <AlertCircle className="w-4 h-4 text-rose-400" />
        </div>
      )}
      
      {/* Completed indicator */}
      {isActive && state === 'completed' && (
        <div className="absolute top-2 right-2">
          <CheckCircle className="w-4 h-4 text-emerald-400" />
        </div>
      )}
    </motion.div>
  );
};

// Activity log row component
const ActivityRow: React.FC<{ entry: ActivityEntry }> = ({ entry }) => {
  const getActivityIcon = () => {
    switch (entry.type) {
      case 'activated': return <Activity className="w-2.5 h-2.5 text-blue-400" />;
      case 'deactivated': return <CheckCircle className="w-2.5 h-2.5 text-emerald-400" />;
      case 'toolkit_start': return <Wrench className="w-2.5 h-2.5 text-amber-400" />;
      case 'toolkit_end': return <Wrench className="w-2.5 h-2.5 text-zinc-500" />;
      case 'error': return <AlertCircle className="w-2.5 h-2.5 text-rose-400" />;
      case 'notice': return <Clock className="w-2.5 h-2.5 text-zinc-500" />;
      default: return <Activity className="w-2.5 h-2.5 text-zinc-600" />;
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 5 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      className="flex items-center gap-1.5"
    >
      {getActivityIcon()}
      <span className={cn(
        "text-[10px] truncate",
        entry.type === 'error' ? "text-rose-400" : "text-zinc-500"
      )}>
        {entry.message}
      </span>
    </motion.div>
  );
};

// ============================================
// Color utility - returns hardcoded Tailwind classes
// to ensure they're included in the build
// ============================================
function getColorClasses(color: string, state: string, isActive: boolean) {
  // We need hardcoded class strings for Tailwind's JIT to detect them
  const colorMap: Record<string, { 
    icon: string; dot: string; bg: string; ring: string; bar: string;
  }> = {
    blue: {
      icon: state === 'working' ? 'text-blue-400' : state === 'completed' ? 'text-emerald-400' : state === 'error' ? 'text-rose-400' : 'text-zinc-600',
      dot: !isActive ? 'bg-zinc-700' : state === 'working' ? 'bg-blue-400' : state === 'completed' ? 'bg-emerald-400' : state === 'error' ? 'bg-rose-400' : 'bg-zinc-600',
      bg: !isActive ? 'bg-zinc-900/30 border-zinc-800/30' : state === 'working' ? 'bg-blue-400/5 border-blue-400/10' : state === 'completed' ? 'bg-emerald-400/5 border-emerald-400/10' : state === 'error' ? 'bg-rose-400/5 border-rose-400/10' : 'bg-zinc-800/30 border-zinc-700/30',
      ring: 'ring-1 ring-blue-400/20',
      bar: 'bg-blue-400',
    },
    emerald: {
      icon: state === 'working' ? 'text-emerald-400' : state === 'completed' ? 'text-emerald-400' : state === 'error' ? 'text-rose-400' : 'text-zinc-600',
      dot: !isActive ? 'bg-zinc-700' : state === 'working' ? 'bg-emerald-400' : state === 'completed' ? 'bg-emerald-400' : state === 'error' ? 'bg-rose-400' : 'bg-zinc-600',
      bg: !isActive ? 'bg-zinc-900/30 border-zinc-800/30' : state === 'working' ? 'bg-emerald-400/5 border-emerald-400/10' : state === 'completed' ? 'bg-emerald-400/5 border-emerald-400/10' : state === 'error' ? 'bg-rose-400/5 border-rose-400/10' : 'bg-zinc-800/30 border-zinc-700/30',
      ring: 'ring-1 ring-emerald-400/20',
      bar: 'bg-emerald-400',
    },
    amber: {
      icon: state === 'working' ? 'text-amber-400' : state === 'completed' ? 'text-emerald-400' : state === 'error' ? 'text-rose-400' : 'text-zinc-600',
      dot: !isActive ? 'bg-zinc-700' : state === 'working' ? 'bg-amber-400' : state === 'completed' ? 'bg-emerald-400' : state === 'error' ? 'bg-rose-400' : 'bg-zinc-600',
      bg: !isActive ? 'bg-zinc-900/30 border-zinc-800/30' : state === 'working' ? 'bg-amber-400/5 border-amber-400/10' : state === 'completed' ? 'bg-emerald-400/5 border-emerald-400/10' : state === 'error' ? 'bg-rose-400/5 border-rose-400/10' : 'bg-zinc-800/30 border-zinc-700/30',
      ring: 'ring-1 ring-amber-400/20',
      bar: 'bg-amber-400',
    },
    purple: {
      icon: state === 'working' ? 'text-purple-400' : state === 'completed' ? 'text-emerald-400' : state === 'error' ? 'text-rose-400' : 'text-zinc-600',
      dot: !isActive ? 'bg-zinc-700' : state === 'working' ? 'bg-purple-400' : state === 'completed' ? 'bg-emerald-400' : state === 'error' ? 'bg-rose-400' : 'bg-zinc-600',
      bg: !isActive ? 'bg-zinc-900/30 border-zinc-800/30' : state === 'working' ? 'bg-purple-400/5 border-purple-400/10' : state === 'completed' ? 'bg-emerald-400/5 border-emerald-400/10' : state === 'error' ? 'bg-rose-400/5 border-rose-400/10' : 'bg-zinc-800/30 border-zinc-700/30',
      ring: 'ring-1 ring-purple-400/20',
      bar: 'bg-purple-400',
    },
    // Medical agent colors
    green: {
      icon: state === 'working' ? 'text-green-400' : state === 'completed' ? 'text-emerald-400' : state === 'error' ? 'text-rose-400' : 'text-zinc-600',
      dot: !isActive ? 'bg-zinc-700' : state === 'working' ? 'bg-green-400' : state === 'completed' ? 'bg-emerald-400' : state === 'error' ? 'bg-rose-400' : 'bg-zinc-600',
      bg: !isActive ? 'bg-zinc-900/30 border-zinc-800/30' : state === 'working' ? 'bg-green-400/5 border-green-400/10' : state === 'completed' ? 'bg-emerald-400/5 border-emerald-400/10' : state === 'error' ? 'bg-rose-400/5 border-rose-400/10' : 'bg-zinc-800/30 border-zinc-700/30',
      ring: 'ring-1 ring-green-400/20',
      bar: 'bg-green-400',
    },
    red: {
      icon: state === 'working' ? 'text-red-400' : state === 'completed' ? 'text-emerald-400' : state === 'error' ? 'text-rose-400' : 'text-zinc-600',
      dot: !isActive ? 'bg-zinc-700' : state === 'working' ? 'bg-red-400' : state === 'completed' ? 'bg-emerald-400' : state === 'error' ? 'bg-rose-400' : 'bg-zinc-600',
      bg: !isActive ? 'bg-zinc-900/30 border-zinc-800/30' : state === 'working' ? 'bg-red-400/5 border-red-400/10' : state === 'completed' ? 'bg-emerald-400/5 border-emerald-400/10' : state === 'error' ? 'bg-rose-400/5 border-rose-400/10' : 'bg-zinc-800/30 border-zinc-700/30',
      ring: 'ring-1 ring-red-400/20',
      bar: 'bg-red-400',
    },
    orange: {
      icon: state === 'working' ? 'text-orange-400' : state === 'completed' ? 'text-emerald-400' : state === 'error' ? 'text-rose-400' : 'text-zinc-600',
      dot: !isActive ? 'bg-zinc-700' : state === 'working' ? 'bg-orange-400' : state === 'completed' ? 'bg-emerald-400' : state === 'error' ? 'bg-rose-400' : 'bg-zinc-600',
      bg: !isActive ? 'bg-zinc-900/30 border-zinc-800/30' : state === 'working' ? 'bg-orange-400/5 border-orange-400/10' : state === 'completed' ? 'bg-emerald-400/5 border-emerald-400/10' : state === 'error' ? 'bg-rose-400/5 border-rose-400/10' : 'bg-zinc-800/30 border-zinc-700/30',
      ring: 'ring-1 ring-orange-400/20',
      bar: 'bg-orange-400',
    },
    teal: {
      icon: state === 'working' ? 'text-teal-400' : state === 'completed' ? 'text-emerald-400' : state === 'error' ? 'text-rose-400' : 'text-zinc-600',
      dot: !isActive ? 'bg-zinc-700' : state === 'working' ? 'bg-teal-400' : state === 'completed' ? 'bg-emerald-400' : state === 'error' ? 'bg-rose-400' : 'bg-zinc-600',
      bg: !isActive ? 'bg-zinc-900/30 border-zinc-800/30' : state === 'working' ? 'bg-teal-400/5 border-teal-400/10' : state === 'completed' ? 'bg-emerald-400/5 border-emerald-400/10' : state === 'error' ? 'bg-rose-400/5 border-rose-400/10' : 'bg-zinc-800/30 border-zinc-700/30',
      ring: 'ring-1 ring-teal-400/20',
      bar: 'bg-teal-400',
    },
    indigo: {
      icon: state === 'working' ? 'text-indigo-400' : state === 'completed' ? 'text-emerald-400' : state === 'error' ? 'text-rose-400' : 'text-zinc-600',
      dot: !isActive ? 'bg-zinc-700' : state === 'working' ? 'bg-indigo-400' : state === 'completed' ? 'bg-emerald-400' : state === 'error' ? 'bg-rose-400' : 'bg-zinc-600',
      bg: !isActive ? 'bg-zinc-900/30 border-zinc-800/30' : state === 'working' ? 'bg-indigo-400/5 border-indigo-400/10' : state === 'completed' ? 'bg-emerald-400/5 border-emerald-400/10' : state === 'error' ? 'bg-rose-400/5 border-rose-400/10' : 'bg-zinc-800/30 border-zinc-700/30',
      ring: 'ring-1 ring-indigo-400/20',
      bar: 'bg-indigo-400',
    },
  };

  return colorMap[color] || colorMap.blue;
}
