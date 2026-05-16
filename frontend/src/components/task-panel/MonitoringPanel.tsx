import { cn } from '@/lib/utils';
import { Activity, FileStack, Layers } from 'lucide-react';
import React, { useState } from 'react';
import { AgentActivityPanel } from './AgentActivityPanel';
import { FileOutputPanel } from './FileOutputPanel';
import { TaskDecompositionPanel } from './TaskDecompositionPanel';

type Tab = 'task-map' | 'agent-activity' | 'files-output';

const TABS: { id: Tab; label: string; icon: typeof Layers }[] = [
  { id: 'task-map', label: 'Task Map', icon: Layers },
  { id: 'agent-activity', label: 'Agents', icon: Activity },
  { id: 'files-output', label: 'Files', icon: FileStack },
];

export const MonitoringPanel: React.FC = () => {
  const [activeTab, setActiveTab] = useState<Tab>('task-map');

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Tab Bar */}
      <div className="flex items-center border-b border-border bg-background shrink-0 px-2 pt-2 gap-1">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setActiveTab(id)}
            className={cn(
              'flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-t-lg transition-colors',
              activeTab === id
                ? 'text-accent border-b-2 border-accent bg-accent/5'
                : 'text-foreground-muted hover:text-foreground-secondary hover:bg-background-secondary'
            )}
          >
            <Icon className="w-3.5 h-3.5" />
            {label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="flex-1 overflow-hidden min-h-0">
        {activeTab === 'task-map' ? (
          <TaskDecompositionPanel />
        ) : activeTab === 'agent-activity' ? (
          <AgentActivityPanel />
        ) :
          <FileOutputPanel />}
      </div>
    </div>
  );
};
