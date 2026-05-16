import { ApiKeyModal } from '@/components/api-key/ApiKeyModal';
import { McpConfigDialog } from '@/components/mcp/McpConfigDialog';
import { TaskInputPanel } from '@/components/chat/TaskInputPanel';
import { ConversationPanel } from '@/components/conversation/ConversationPanel';
import { ErrorBanner } from '@/components/layout/ErrorBanner';
import { MonitoringPanel } from '@/components/task-panel/MonitoringPanel';
import { cn } from '@/lib/utils';
import { useAgentStatusStore, useResourceStore, useTaskDecompStore, useUIStore } from '@/stores';
import { useApiConfigStore } from '@/stores/apiConfigStore';
import { useMcpStore } from '@/stores/mcpStore';
import { useChatStore } from '@/stores/chatStore';
import { useProjectStore } from '@/stores/projectStore';
import { clearAgentInfoCache } from '@/hooks/useSSEHandler';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowLeft,
  FileText,
  HelpCircle,
  History,
  LayoutDashboard,
  Menu,
  MessageSquarePlus,
  Monitor,
  Moon,
  PanelRightClose,
  PanelRightOpen,
  Plug,
  Settings,
  Sun,
} from 'lucide-react';
import React, { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';

const MOBILE_BREAKPOINT = 1024;

export const ProjectPage: React.FC = () => {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [rightSidebarOpen, setRightSidebarOpen] = React.useState(true);
  const [isMobile, setIsMobile] = useState(false);
  const prevIsMobile = useRef<boolean | null>(null);
  const { theme, setTheme, resolvedTheme } = useUIStore();

  const project = useProjectStore((s) =>
    s.projects.find((p) => p.id === projectId)
  );
  const setCurrentProject = useProjectStore((s) => s.setCurrentProject);
  const setChatCurrentProject = useChatStore((s) => s.setCurrentProject);
  const clearMessages = useChatStore((s) => s.clearMessages);
  const addMessage = useChatStore((s) => s.addMessage);
  const { isConfigured, checkBackendConfig, loadFromStorage, setModalOpen } = useApiConfigStore();

  // Load API config from storage and check backend config on mount
  useEffect(() => {
    loadFromStorage();
    checkBackendConfig();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Check URL params for panel open on mount
  useEffect(() => {
    const panelParam = searchParams.get('panel');
    if (panelParam === 'open') {
      setRightSidebarOpen(true);
      // Remove the param from URL
      searchParams.delete('panel');
      setSearchParams(searchParams, { replace: true });
    }
  }, []);

  // Set current project on mount and load messages from project store
  useEffect(() => {
    if (projectId && project) {
      setCurrentProject(projectId);
      setChatCurrentProject(projectId);

      // Load persisted messages into chat store
      clearMessages();
      for (const msg of project.messages) {
        addMessage(msg);
      }
    }
  }, [projectId]); // Only run when projectId changes

  // Set HTML title
  useEffect(() => {
    if (project) {
      document.title = `Medigent One | ${project.title}`;
    }
    return () => {
      document.title = 'Medigent One';
    };
  }, [project?.title]);

  // Handle responsive layout and viewport changes (mobile keyboard, address bar hiding)
  const [, forceUpdate] = React.useReducer((x: number) => x + 1, 0);
  
  useEffect(() => {
    const handleResize = () => {
      const mobile = window.innerWidth < MOBILE_BREAKPOINT;
      if (mobile && !prevIsMobile.current && rightSidebarOpen) {
        setRightSidebarOpen(false);
      }
      prevIsMobile.current = mobile;
      setIsMobile(mobile);
    };

    handleResize();
    window.addEventListener('resize', handleResize);

    // Handle viewport changes on mobile (keyboard appearance, address bar hiding)
    const handleVisualViewportResize = () => {
      if (window.visualViewport) {
        // Update CSS variable with actual visual viewport height
        const vh = window.visualViewport.height * 0.01;
        document.documentElement.style.setProperty('--vh', `${vh}px`);
        // Force re-render to ensure layout updates
        forceUpdate();
      }
    };

    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', handleVisualViewportResize);
      handleVisualViewportResize();
    }

    return () => {
      window.removeEventListener('resize', handleResize);
      if (window.visualViewport) {
        window.visualViewport.removeEventListener('resize', handleVisualViewportResize);
      }
    };
  }, [rightSidebarOpen]);

  const cycleTheme = () => {
    const themes: ('light' | 'dark' | 'system')[] = ['light', 'dark', 'system'];
    const currentIndex = themes.indexOf(theme);
    const nextTheme = themes[(currentIndex + 1) % themes.length];
    setTheme(nextTheme);
  };

  const ThemeIcon = theme === 'system' ? Monitor : resolvedTheme === 'dark' ? Moon : Sun;

  if (!project) {
    return (
      <div className="h-screen w-screen bg-background text-foreground flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-lg font-semibold mb-2">Project not found</h2>
          <p className="text-sm text-foreground-muted mb-4">
            This project may have been deleted or the URL is incorrect.
          </p>
          <button
            onClick={() => navigate('/history')}
            className="text-sm text-accent hover:underline"
          >
            Back to History
          </button>
        </div>
      </div>
    );
  }

  return (
    <div 
      className="fixed inset-0 w-screen bg-background text-foreground flex overflow-hidden"
      style={{ height: '100svh' }}
    >
      {/* Left Sidebar Navigation - Hidden on mobile */}
      <aside className={cn(
        "w-16 flex-col items-center py-6 border-r border-border bg-sidebar z-50 shrink-0",
        isMobile ? 'hidden' : 'flex'
      )}>
        <div className="w-10 h-10 bg-accent rounded-xl flex items-center justify-center mb-6 shadow-glow">
          <LayoutDashboard className="w-6 h-6 text-accent-foreground" />
        </div>

        <div className="flex-1 flex flex-col gap-6">
          <NavIcon
            icon={<MessageSquarePlus className="w-5 h-5" />}
            onClick={() => {
              useChatStore.getState().reset();
              useAgentStatusStore.getState().reset();
              useTaskDecompStore.getState().reset();
              useResourceStore.getState().reset();
              clearAgentInfoCache();
              navigate('/');
            }}
            tooltip="New Chat"
          />
          <NavIcon
            icon={<History className="w-5 h-5" />}
            onClick={() => navigate('/history')}
          />
          <NavIcon
            icon={<Settings className="w-5 h-5" />}
            onClick={() => setModalOpen(true)}
            tooltip="API Config"
          />
          <NavIcon
            icon={<Plug className="w-5 h-5" />}
            onClick={() => useMcpStore.getState().setDialogOpen(true)}
            tooltip="MCP Servers"
          />
          <Link to="/thank-you">
            <NavIcon icon={<HelpCircle className="w-5 h-5" />} />
          </Link>
        </div>

        <div className="mt-auto">
          <NavIcon
            icon={<ThemeIcon className="w-5 h-5" />}
            onClick={cycleTheme}
            tooltip={`Theme: ${theme}`}
          />
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col relative min-w-0">
        {/* Header */}
        <header className="h-14 border-b border-border bg-background/80 backdrop-blur-md flex items-center justify-between px-4 sm:px-6 z-30 shrink-0">
          <div className="flex items-center gap-3 sm:gap-4">
            {/* Mobile Menu Button */}
            {isMobile && (
              <button
                onClick={() => navigate('/menu')}
                className="p-2 rounded-lg hover:bg-background-secondary text-foreground-secondary transition-colors"
                title="Open menu"
              >
                <Menu className="w-5 h-5" />
              </button>
            )}
            <button
              onClick={() => navigate('/history')}
              className="p-1.5 rounded-lg hover:bg-background-secondary text-foreground-muted hover:text-foreground transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
            <h2 className="text-sm font-bold tracking-tight text-foreground-secondary truncate max-w-[200px] sm:max-w-[300px]">
              {project.title}
            </h2>
            <div className="h-4 w-px bg-border hidden sm:block" />
            <div className="hidden sm:flex items-center gap-2">
              <span className="relative flex h-2 w-2">
                {isConfigured ? (
                  <>
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-success opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-success"></span>
                  </>
                ) : (
                  <>
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-warning opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-warning"></span>
                  </>
                )}
              </span>
              <span className="text-[10px] font-mono text-foreground-muted uppercase tracking-widest">
                {isConfigured ? 'System Ready' : 'API Key Required'}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* File count badge */}
            {project.files.length > 0 && (
              <div className="flex items-center gap-1 px-2 py-1 rounded-md bg-background-secondary text-foreground-muted text-xs">
                <FileText className="w-3 h-3" />
                {project.files.length} files
              </div>
            )}

            {/* Right sidebar toggle */}
            <button
              onClick={() => setRightSidebarOpen(!rightSidebarOpen)}
              className={cn(
                'p-2 rounded-lg transition-colors',
                rightSidebarOpen
                  ? 'text-foreground-secondary hover:text-foreground hover:bg-background-secondary'
                  : 'text-foreground-muted hover:text-foreground-secondary hover:bg-background-secondary'
              )}
              title={
                rightSidebarOpen
                  ? 'Hide monitoring panel'
                  : 'Show monitoring panel'
              }
            >
              {rightSidebarOpen ? (
                <PanelRightClose className="w-4 h-4" />
              ) : (
                <PanelRightOpen className="w-4 h-4" />
              )}
            </button>
          </div>
        </header>

        {/* Error Banner */}
        <ErrorBanner />

        {/* Main Layout: Conversation + Right Sidebar */}
        <div className="flex-1 flex overflow-hidden">
          {/* Center: Conversation Panel */}
          <div className="flex-1 flex flex-col min-w-0">
            {/* Scrollable messages */}
            <ConversationPanel />

            {/* Input Panel - anchored at bottom */}
            <div className="border-t border-border bg-background shrink-0">
              <div className="max-w-3xl mx-auto">
                <TaskInputPanel />
              </div>
            </div>
          </div>

          {/* Right: Monitoring Sidebar */}
          <AnimatePresence>
            {rightSidebarOpen && (
              <motion.aside
                initial={isMobile ? { x: '100%', opacity: 0 } : { width: 0, opacity: 0 }}
                animate={isMobile ? { x: 0, opacity: 1 } : { width: 420, opacity: 1 }}
                exit={isMobile ? { x: '100%', opacity: 0 } : { width: 0, opacity: 0 }}
                transition={{ duration: 0.25, ease: [0.25, 0.46, 0.45, 0.94] }}
                className={cn(
                  "bg-background border-l border-border flex flex-col shrink-0 overflow-hidden",
                  isMobile && "fixed inset-0 z-40 w-full"
                )}
              >
                <div className="flex flex-col h-full w-full">
                  {/* Mobile close button */}
                  {isMobile && (
                    <div className="p-3 border-b border-border flex justify-end">
                      <button
                        onClick={() => setRightSidebarOpen(false)}
                        className="p-2 rounded-lg hover:bg-background-secondary text-foreground-muted"
                      >
                        <PanelRightClose className="w-5 h-5" />
                      </button>
                    </div>
                  )}

                  {/* Monitoring Panel (Task Map + Agent Activity) */}
                  <div className="flex-1 flex flex-col border-b border-border overflow-hidden min-h-0">
                    <MonitoringPanel />
                  </div>
                </div>
              </motion.aside>
            )}
          </AnimatePresence>
        </div>
      </main>

      {/* API Key Modal */}
      <ApiKeyModal />
      <McpConfigDialog />
    </div>
  );
};

const NavIcon: React.FC<{
  icon: React.ReactNode;
  active?: boolean;
  onClick?: () => void;
  tooltip?: string;
}> = ({ icon, active, onClick, tooltip }) => (
  <button
    onClick={onClick}
    title={tooltip}
    className={cn(
      'p-3 rounded-xl transition-all duration-300 group',
      active
        ? 'bg-accent/10 text-accent'
        : 'text-foreground-muted hover:text-foreground-secondary hover:bg-sidebar-hover'
    )}
  >
    {icon}
  </button>
);
