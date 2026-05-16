import { MainLayout } from '@/components/layout/MainLayout';
import { TaskList } from '@/components/task/TaskList';
import { ChatWindow } from '@/components/chat/ChatWindow';

export function ChatPage() {
  return (
    <MainLayout>
      <div className="flex h-full">
        <div className="w-80 flex-shrink-0">
          <TaskList />
        </div>
        <div className="flex-1">
          <ChatWindow />
        </div>
      </div>
    </MainLayout>
  );
}
