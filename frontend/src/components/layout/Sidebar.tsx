import { useUIStore } from '@/stores';
import { useTask } from '@/hooks';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import {
  ChevronLeft,
  ChevronRight,
  Home,
  MessageSquare,
  Settings,
  Plus,
  ClipboardList,
} from 'lucide-react';

const navItems = [
  { icon: Home, label: 'Home', href: '/' },
  { icon: MessageSquare, label: 'Chat', href: '/chat' },
  { icon: Settings, label: 'Settings', href: '/settings' },
];

export function Sidebar() {
  const { sidebarOpen, toggleSidebar } = useUIStore();
  const { tasks, activeTaskId, setActiveTask } = useTask();

  return (
    <TooltipProvider delayDuration={0}>
      <aside
        className={cn(
          'fixed left-0 top-0 z-40 h-screen border-r bg-card transition-all duration-300 ease-in-out flex flex-col',
          sidebarOpen ? 'w-64' : 'w-16'
        )}
      >
        {/* Toggle Button */}
        <div className="flex h-16 items-center justify-end px-2 shrink-0">
          <Button
            variant="ghost"
            size="icon"
            onClick={toggleSidebar}
            className="shrink-0"
          >
            {sidebarOpen ? (
              <ChevronLeft className="h-5 w-5" />
            ) : (
              <ChevronRight className="h-5 w-5" />
            )}
          </Button>
        </div>

        <Separator />

        {/* Navigation */}
        <nav className="flex flex-col gap-1 p-2 shrink-0">
          {navItems.map((item) => (
            <Tooltip key={item.label}>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  className={cn(
                    'w-full justify-start gap-3',
                    !sidebarOpen && 'justify-center px-2'
                  )}
                  asChild
                >
                  <a href={item.href}>
                    <item.icon className="h-5 w-5 shrink-0" />
                    {sidebarOpen && <span>{item.label}</span>}
                  </a>
                </Button>
              </TooltipTrigger>
              {!sidebarOpen && (
                <TooltipContent side="right">
                  <p>{item.label}</p>
                </TooltipContent>
              )}
            </Tooltip>
          ))}
        </nav>

        <Separator className="my-2" />

        {/* Tasks Section */}
        <div className="flex-1 min-h-0 flex flex-col">
          <div className="flex items-center justify-between px-3 py-2 shrink-0">
            {sidebarOpen && (
              <span className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <ClipboardList className="h-4 w-4" />
                Tasks
              </span>
            )}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8">
                  <Plus className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side={sidebarOpen ? 'bottom' : 'right'}>
                <p>New Task</p>
              </TooltipContent>
            </Tooltip>
          </div>

          <ScrollArea className="flex-1 px-2">
            <div className="flex flex-col gap-1">
              {tasks.map((task) => (
                <Tooltip key={task.id}>
                  <TooltipTrigger asChild>
                    <Button
                      variant={activeTaskId === task.id ? 'secondary' : 'ghost'}
                      size="sm"
                      className={cn(
                        'w-full justify-start text-left truncate',
                        !sidebarOpen && 'justify-center px-2'
                      )}
                      onClick={() => setActiveTask(task.id)}
                    >
                      <span className={cn('truncate', !sidebarOpen && 'hidden')}>
                        {task.content.slice(0, 30)}
                        {task.content.length > 30 ? '...' : ''}
                      </span>
                      {sidebarOpen && (
                        <span
                          className={cn(
                            'ml-auto h-2 w-2 rounded-full shrink-0',
                            task.status === 'done' && 'bg-green-500',
                            task.status === 'processing' && 'bg-purple-500',
                            task.status === 'confirmed' && 'bg-blue-500',
                            task.status === 'confirming' && 'bg-yellow-500'
                          )}
                        />
                      )}
                    </Button>
                  </TooltipTrigger>
                  {!sidebarOpen && (
                    <TooltipContent side="right">
                      <p className="max-w-xs truncate">{task.content}</p>
                    </TooltipContent>
                  )}
                </Tooltip>
              ))}
            </div>
          </ScrollArea>
        </div>
      </aside>
    </TooltipProvider>
  );
}
