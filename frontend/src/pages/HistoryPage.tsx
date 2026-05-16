import { ApiKeyModal } from '@/components/api-key/ApiKeyModal';
import { cn } from '@/lib/utils';
import { useAgentStatusStore, useChatStore, useResourceStore, useTaskDecompStore, useUIStore } from '@/stores';
import { useApiConfigStore } from '@/stores/apiConfigStore';
import { useProjectStore } from '@/stores/projectStore';
import { clearAgentInfoCache } from '@/hooks/useSSEHandler';
import {
  ArrowLeft,
  Calendar,
  FolderOpen,
  HelpCircle,
  History,
  LayoutDashboard,
  ListChecks,
  Menu,
  MessageSquare,
  MessageSquarePlus,
  Monitor,
  Moon,
  Plus,
  Settings,
  Sun,
  Trash2
} from 'lucide-react';
import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

const MOBILE_BREAKPOINT = 1024;

const formatDate = (isoString: string): string => {
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

export const HistoryPage: React.FC = () => {
  const navigate = useNavigate();
  const projects = useProjectStore((s) => s.projects);
  const createProject = useProjectStore((s) => s.createProject);
  const deleteProject = useProjectStore((s) => s.deleteProject);
  const { theme, setTheme, resolvedTheme } = useUIStore();
  const { setModalOpen } = useApiConfigStore();
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    };
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const handleNewProject = () => {
    const project = createProject();
    navigate(`/project/${project.id}`);
  };

  const handleProjectClick = (projectId: string) => {
    navigate(`/project/${projectId}`);
  };

  const handleDelete = (e: React.MouseEvent, projectId: string) => {
    e.stopPropagation();
    deleteProject(projectId);
  };

  const cycleTheme = () => {
    const themes: ('light' | 'dark' | 'system')[] = ['light', 'dark', 'system'];
    const currentIndex = themes.indexOf(theme);
    const nextTheme = themes[(currentIndex + 1) % themes.length];
    setTheme(nextTheme);
  };

  const ThemeIcon = theme === 'system' ? Monitor : resolvedTheme === 'dark' ? Moon : Sun;

  return (
    <div className="h-screen w-screen bg-background text-foreground flex overflow-hidden">
      {/* Left Sidebar Navigation - Hidden on mobile */}
      <aside className={cn(
        "w-16 flex flex-col items-center py-6 border-r border-border bg-sidebar z-50 shrink-0",
        isMobile && "hidden"
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
          <NavIcon icon={<History className="w-5 h-5" />} active />
          <NavIcon
            icon={<Settings className="w-5 h-5" />}
            onClick={() => setModalOpen(true)}
            tooltip="API Config"
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

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0">
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
              onClick={() => navigate('/')}
              className="p-1.5 rounded-lg hover:bg-background-secondary text-foreground-muted hover:text-foreground transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
            <h2 className="text-sm font-bold tracking-tight text-foreground-secondary">
              Project History
            </h2>
          </div>
        </header>

        {/* Content */}
        <div className="flex-1 overflow-y-auto custom-scrollbar">
          <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
            {/* New Project Button */}
            <button
              onClick={handleNewProject}
              className={cn(
                "w-full mb-6 sm:mb-8 p-3 sm:p-4 rounded-xl border-2 border-dashed border-border",
                "flex items-center justify-center gap-3",
                "text-foreground-muted hover:text-accent hover:border-accent",
                "hover:bg-accent-light/50 transition-all duration-200"
              )}
            >
              <Plus className="w-5 h-5" />
              <span className="text-sm font-medium">New Project</span>
            </button>

            {/* Projects List */}
            {projects.length === 0 ? (
              <div className="flex flex-col items-center justify-center min-h-[40vh] text-center">
                <FolderOpen className="w-16 h-16 text-foreground-muted opacity-40 mb-4" />
                <h3 className="text-lg font-medium text-foreground mb-1">No projects yet</h3>
                <p className="text-sm text-foreground-muted max-w-sm">
                  Create a new project or start a chat from the dashboard to begin.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {projects.map((project) => (
                  <button
                    key={project.id}
                    onClick={() => handleProjectClick(project.id)}
                    className={cn(
                      "w-full text-left p-3 sm:p-4 rounded-xl border border-border bg-card",
                      "hover:border-accent hover:shadow-md",
                      "transition-all duration-200 group"
                    )}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <h3 className="text-sm font-semibold text-foreground truncate group-hover:text-accent transition-colors">
                          {project.title}
                        </h3>
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2 text-xs text-foreground-muted">
                          <span className="flex items-center gap-1">
                            <Calendar className="w-3 h-3" />
                            {formatDate(project.created_at)}
                          </span>
                          <span className="flex items-center gap-1">
                            <MessageSquare className="w-3 h-3" />
                            {project.messages.filter((m) => m.role === 'user').length} chats
                          </span>
                          <span className="flex items-center gap-1">
                            <ListChecks className="w-3 h-3" />
                            {project.taskIds.length} tasks
                          </span>
                        </div>
                      </div>
                      {/* Delete button - visible on hover */}
                      <div
                        onClick={(e) => handleDelete(e, project.id)}
                        className="p-2 rounded-lg opacity-0 group-hover:opacity-100 text-foreground-muted hover:text-error hover:bg-error/10 transition-all shrink-0"
                        title="Delete project"
                      >
                        <Trash2 className="w-4 h-4" />
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </main>

      {/* API Key Modal */}
      <ApiKeyModal />
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
