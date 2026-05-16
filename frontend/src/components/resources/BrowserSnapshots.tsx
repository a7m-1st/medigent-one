import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useResourceStore } from '@/stores/resourceStore';
import { useAgentStatusStore } from '@/stores/agentStatusStore';
import { useSnapshots } from '@/hooks/useSnapshots';
import { Monitor, ExternalLink, Clock, Image as ImageIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

export const BrowserSnapshots: React.FC = () => {
  const { snapshots } = useResourceStore();
  const { getAgentByName } = useAgentStatusStore();

  const browserAgent = getAgentByName('browser_agent');
  const currentTaskId = browserAgent?.currentTaskId || null;
  const agentState = browserAgent?.state || 'idle';

  // Polling hook
  useSnapshots(currentTaskId, agentState);

  const taskSnapshots = currentTaskId ? (snapshots[currentTaskId] || []) : [];

  return (
    <div className="flex flex-col h-full bg-background-secondary border border-border rounded-xl overflow-hidden shadow-lg">
      <div className="flex items-center justify-between px-4 py-2 bg-background-tertiary border-b border-border">
        <div className="flex items-center gap-2">
          <Monitor className="w-4 h-4 text-accent" />
          <span className="text-xs font-mono font-bold text-foreground-secondary">BROWSER_SNAPSHOTS</span>
        </div>
        <div className="text-[10px] text-foreground-muted font-mono">
          {taskSnapshots.length} CAPTURES
        </div>
      </div>

      <div className="flex-1 p-4 overflow-y-auto custom-scrollbar">
        {!browserAgent || taskSnapshots.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-foreground-muted gap-3">
            <div className="w-12 h-12 rounded-full bg-background-tertiary flex items-center justify-center border border-border">
              <ImageIcon className="w-6 h-6 opacity-30" />
            </div>
            <p className="text-xs italic">
              {!browserAgent ? 'Waiting for browser agent...' : 'No browser activity recorded yet'}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-6">
            <AnimatePresence mode="popLayout">
              {taskSnapshots.map((snapshot, i) => (
                <SnapshotCard
                  key={snapshot.id}
                  snapshot={snapshot}
                  isLatest={i === taskSnapshots.length - 1}
                />
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>
    </div>
  );
};

interface SnapshotCardProps {
  snapshot: any;
  isLatest: boolean;
}

const SnapshotCard: React.FC<SnapshotCardProps> = ({ snapshot, isLatest }) => {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn(
        "group relative bg-card rounded-lg border border-card-border overflow-hidden",
        isLatest && "ring-2 ring-accent/50"
      )}
    >
      <div className="aspect-video relative bg-background-tertiary flex items-center justify-center overflow-hidden">
        <img
          src={snapshot.imageData}
          alt="Browser View"
          className="w-full h-full object-contain transition-transform duration-500 group-hover:scale-105"
        />
        {isLatest && (
          <div className="absolute top-2 right-2 px-2 py-0.5 bg-accent text-[9px] font-bold text-accent-foreground rounded-full animate-pulse">
            LIVE
          </div>
        )}
      </div>

      <div className="p-3 bg-card border-t border-card-border">
        <div className="flex items-center justify-between gap-2 mb-1.5">
          <div className="flex items-center gap-1.5 min-w-0">
            <ExternalLink className="w-3 h-3 text-foreground-muted shrink-0" />
            <span className="text-[10px] text-foreground-secondary truncate font-mono">
              {snapshot.browserUrl}
            </span>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <Clock className="w-3 h-3 text-foreground-muted" />
            <span className="text-[9px] text-foreground-muted">
              {new Date(snapshot.timestamp).toLocaleTimeString()}
            </span>
          </div>
        </div>
      </div>
    </motion.div>
  );
};