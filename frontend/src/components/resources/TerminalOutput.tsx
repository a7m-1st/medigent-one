import { useResourceStore } from '@/stores/resourceStore';
import { Clock, Hash, Terminal as TerminalIcon } from 'lucide-react';
import React, { useEffect, useRef } from 'react';

interface TerminalOutputProps {
  agentName: string;
  /** Compact mode for embedding inside agent cards */
  compact?: boolean;
  /** Max lines to show in compact mode */
  maxLines?: number;
}

export const TerminalOutput: React.FC<TerminalOutputProps> = ({ 
  agentName, 
  compact = false,
  maxLines = 50,
}) => {
  const { terminalOutputs } = useResourceStore();
  const scrollRef = useRef<HTMLDivElement>(null);

  const allLogs = terminalOutputs[agentName] || [];
  const logs = compact ? allLogs.slice(-maxLines) : allLogs;

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs]);

  if (compact) {
    return (
      <div className="flex flex-col h-full overflow-hidden">
        <div 
          ref={scrollRef}
          className="flex-1 font-mono text-[10px] overflow-y-auto custom-scrollbar space-y-0.5 select-text p-2"
        >
          {logs.length === 0 ? (
            <div className="flex items-center gap-1.5 text-zinc-600 italic">
              <Hash className="w-2.5 h-2.5" />
              <span>Waiting for output...</span>
            </div>
          ) : (
            logs.map((log, i) => (
              <div key={log.id} className="group flex gap-2 animate-in fade-in duration-200">
                <span className="text-zinc-700 shrink-0 tabular-nums select-none">
                  {(allLogs.length - logs.length + i + 1).toString().padStart(3, '0')}
                </span>
                <span className="text-emerald-500/60 shrink-0">$</span>
                <span className="text-zinc-400 leading-relaxed whitespace-pre-wrap break-all">
                  {log.output}
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    );
  }

  // Full-size mode (legacy standalone usage)
  return (
    <div className="flex flex-col h-full bg-zinc-950 border border-zinc-800 rounded-xl overflow-hidden shadow-2xl">
      <div className="flex items-center justify-between px-4 py-2 bg-zinc-900/50 border-b border-zinc-800">
        <div className="flex items-center gap-2">
          <TerminalIcon className="w-4 h-4 text-emerald-500" />
          <span className="text-xs font-mono font-bold text-zinc-300">TERMINAL</span>
        </div>
        <div className="flex gap-1.5">
          <div className="w-2.5 h-2.5 rounded-full bg-zinc-800" />
          <div className="w-2.5 h-2.5 rounded-full bg-zinc-800" />
          <div className="w-2.5 h-2.5 rounded-full bg-zinc-800" />
        </div>
      </div>

      <div 
        ref={scrollRef}
        className="flex-1 p-4 font-mono text-xs overflow-y-auto custom-scrollbar space-y-1 select-text"
      >
        {logs.length === 0 ? (
          <div className="flex items-center gap-2 text-zinc-600 italic">
            <Hash className="w-3 h-3" />
            <span>Waiting for process output...</span>
          </div>
        ) : (
          logs.map((log, i) => (
            <div key={log.id} className="group flex gap-3 animate-in fade-in slide-in-from-left-2 duration-300">
              <span className="text-zinc-700 shrink-0 tabular-nums">{(i + 1).toString().padStart(3, '0')}</span>
              <div className="flex-1 space-y-0.5">
                <div className="flex items-center gap-2">
                  <span className="text-emerald-500/80">$</span>
                  <span className="text-zinc-300 leading-relaxed whitespace-pre-wrap">{log.output}</span>
                </div>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <Clock className="w-2.5 h-2.5 text-zinc-600" />
                  <span className="text-[9px] text-zinc-600">
                    {new Date(log.timestamp).toLocaleTimeString()}
                  </span>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
