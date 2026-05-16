import type { Task } from '@/types';
import { useTask } from '@/hooks';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { TaskStatusBadge } from './TaskStatusBadge';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';

interface TaskCardProps {
  task: Task;
}

export function TaskCard({ task }: TaskCardProps) {
  const { activeTaskId, setActiveTask } = useTask();
  const isActive = activeTaskId === task.id;

  return (
    <Card
      className={cn(
        'cursor-pointer transition-all hover:shadow-md',
        isActive && 'ring-2 ring-primary shadow-md'
      )}
      onClick={() => setActiveTask(task.id)}
    >
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <p className="text-sm font-medium line-clamp-2 flex-1">
            {task.content}
          </p>
          <TaskStatusBadge status={task.status} />
        </div>
      </CardHeader>
      
      <CardContent className="pt-0">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>
            Created {format(new Date(task.created_at), 'MMM d, h:mm a')}
          </span>
          {task.conversation_history.length > 0 && (
            <span>{task.conversation_history.length} messages</span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
