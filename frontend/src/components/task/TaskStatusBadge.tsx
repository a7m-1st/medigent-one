import type { Status } from '@/types';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

interface TaskStatusBadgeProps {
  status: Status;
}

export function TaskStatusBadge({ status }: TaskStatusBadgeProps) {
  const variants: Record<Status, { variant: 'default' | 'secondary' | 'destructive' | 'outline'; className: string; label: string }> = {
    confirming: {
      variant: 'secondary',
      className: 'bg-yellow-100 text-yellow-800 hover:bg-yellow-100 dark:bg-yellow-900 dark:text-yellow-200',
      label: 'Confirming',
    },
    confirmed: {
      variant: 'secondary',
      className: 'bg-blue-100 text-blue-800 hover:bg-blue-100 dark:bg-blue-900 dark:text-blue-200',
      label: 'Confirmed',
    },
    processing: {
      variant: 'secondary',
      className: 'bg-purple-100 text-purple-800 hover:bg-purple-100 dark:bg-purple-900 dark:text-purple-200',
      label: 'Processing',
    },
    done: {
      variant: 'default',
      className: 'bg-green-100 text-green-800 hover:bg-green-100 dark:bg-green-900 dark:text-green-200',
      label: 'Done',
    },
  };

  const { variant, className, label } = variants[status];

  return (
    <Badge variant={variant} className={cn('font-medium', className)}>
      {label}
    </Badge>
  );
}
