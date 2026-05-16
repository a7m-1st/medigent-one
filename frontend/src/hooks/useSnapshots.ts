import { useEffect, useCallback } from 'react';
import { snapshotService } from '@/services/snapshotService';
import { useResourceStore } from '@/stores';

/**
 * Hook to poll for browser snapshots
 * Automatically polls every 3 seconds when agent is working
 */
export function useSnapshots(taskId: string | null, agentState: string) {
  const { 
    setSnapshots, 
    isPolling, 
    startPolling, 
    stopPolling 
  } = useResourceStore();

  const fetchSnapshots = useCallback(async () => {
    if (!taskId) return;
    
    try {
      const snapshots = await snapshotService.fetchSnapshots(taskId);
      setSnapshots(taskId, snapshots);
    } catch (error) {
      console.error('Failed to fetch snapshots:', error);
    }
  }, [taskId, setSnapshots]);

  // Start/stop polling based on agent state
  useEffect(() => {
    if (!taskId) return;
    
    if (agentState === 'working') {
      startPolling(taskId);
    } else {
      stopPolling();
      // Do a final fetch when the agent finishes to capture the last screenshot
      fetchSnapshots();
    }
  }, [taskId, agentState, startPolling, stopPolling, fetchSnapshots]);

  // Polling interval
  useEffect(() => {
    if (!isPolling || !taskId) return;
    
    const interval = setInterval(fetchSnapshots, 3000);
    return () => clearInterval(interval);
  }, [isPolling, taskId, fetchSnapshots]);

  return { refetch: fetchSnapshots };
}
