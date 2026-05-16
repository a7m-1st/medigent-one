import React from 'react';
import { motion } from 'framer-motion';
import { useAgentStatusStore } from '@/stores/agentStatusStore';
import { useTaskDecompStore } from '@/stores/taskDecompStore';
import { Bot, Loader2 } from 'lucide-react';

export const ThinkingIndicator: React.FC = () => {
  const agents = useAgentStatusStore((s) => s.agents);
  const isDecomposing = useTaskDecompStore((s) => s.isDecomposing);

  const workingAgents = Object.values(agents).filter(
    (a) => a.state === 'working'
  );

  // Determine the status message
  let statusMessage = 'Thinking...';
  if (isDecomposing) {
    statusMessage = 'Planning task decomposition...';
  } else if (workingAgents.length > 0) {
    const names = workingAgents.map((a) => a.displayName);
    if (names.length === 1) {
      statusMessage = `${names[0]} is working`;
      if (workingAgents[0].currentToolkit) {
        statusMessage += ` — using ${workingAgents[0].currentToolkit}`;
      }
    } else {
      statusMessage = `${names.join(', ')} are working...`;
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      className="flex gap-3 py-4"
    >
      {/* Avatar */}
      <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-teal-500 to-teal-700 flex items-center justify-center shrink-0 shadow-glow-sm">
        <Bot className="w-4 h-4 text-white" />
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-teal-500 dark:text-teal-400 px-0.5">
          Health Unit Coordinator
        </span>

        <div className="bg-ai-bubble border border-ai-bubble-border rounded-2xl rounded-tl-sm px-4 py-3 shadow-sm">
          {/* Status line */}
          <div className="flex items-center gap-2.5">
            <Loader2 className="w-4 h-4 text-accent animate-spin shrink-0" />
            <span className="text-sm text-foreground-secondary">{statusMessage}</span>
          </div>

          {/* Animated dots */}
          <div className="flex gap-1.5 mt-3">
            {[0, 1, 2].map((i) => (
              <motion.div
                key={i}
                className="w-1.5 h-1.5 rounded-full bg-accent/50"
                animate={{
                  scale: [0.8, 1.2, 0.8],
                  opacity: [0.3, 0.8, 0.3],
                }}
                transition={{
                  duration: 1.5,
                  repeat: Infinity,
                  delay: i * 0.2,
                  ease: 'easeInOut',
                }}
              />
            ))}
          </div>
        </div>
      </div>
    </motion.div>
  );
};