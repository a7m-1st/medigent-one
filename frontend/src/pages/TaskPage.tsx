import { useState } from 'react';
import { MainLayout } from '@/components/layout/MainLayout';
import { useTaskStore } from '@/stores';
import type { Task, Status } from '@/types';

export function TaskPage() {
  const { tasks, addTask, removeTask } = useTaskStore();
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newTask, setNewTask] = useState({
    project_id: '',
    content: '',
  });

  const handleCreateTask = () => {
    if (!newTask.content.trim() || !newTask.project_id.trim()) return;

    const task: Task = {
      id: crypto.randomUUID(),
      project_id: newTask.project_id,
      status: 'confirming',
      content: newTask.content,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      conversation_history: [],
    };

    addTask(task);
    setNewTask({ project_id: '', content: '' });
    setShowCreateForm(false);
  };

  const getStatusColor = (status: Status) => {
    switch (status) {
      case 'confirming':
        return 'bg-yellow-100 text-yellow-800';
      case 'confirmed':
        return 'bg-blue-100 text-blue-800';
      case 'processing':
        return 'bg-purple-100 text-purple-800';
      case 'done':
        return 'bg-green-100 text-green-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  return (
    <MainLayout>
      <div className="max-w-6xl mx-auto p-6">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-2xl font-bold">Task Management</h1>
          <button
            onClick={() => setShowCreateForm(true)}
            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
          >
            Create New Task
          </button>
        </div>

        {/* Create Task Form */}
        {showCreateForm && (
          <div className="bg-white rounded-lg shadow p-6 mb-6">
            <h2 className="text-lg font-semibold mb-4">Create New Task</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Project ID
                </label>
                <input
                  type="text"
                  value={newTask.project_id}
                  onChange={(e) =>
                    setNewTask({ ...newTask, project_id: e.target.value })
                  }
                  placeholder="Enter project ID"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Task Content
                </label>
                <textarea
                  value={newTask.content}
                  onChange={(e) =>
                    setNewTask({ ...newTask, content: e.target.value })
                  }
                  placeholder="Describe the task..."
                  rows={3}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div className="flex gap-2">
                <button
                  onClick={handleCreateTask}
                  className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
                >
                  Create Task
                </button>
                <button
                  onClick={() => setShowCreateForm(false)}
                  className="px-4 py-2 bg-gray-200 text-gray-700 rounded-md hover:bg-gray-300 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Task List */}
        <div className="bg-white rounded-lg shadow">
          <div className="p-4 border-b border-gray-200">
            <h2 className="text-lg font-semibold">All Tasks</h2>
          </div>
          
          {tasks.length === 0 ? (
            <div className="p-8 text-center text-gray-500">
              No tasks yet. Create your first task to get started.
            </div>
          ) : (
            <div className="divide-y divide-gray-200">
              {tasks.map((task) => (
                <div
                  key={task.id}
                  className="p-4 hover:bg-gray-50"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2">
                        <h3 className="font-medium text-gray-900">
                          {task.content}
                        </h3>
                        <span
                          className={`px-2 py-0.5 text-xs rounded-full ${getStatusColor(
                            task.status
                          )}`}
                        >
                          {task.status}
                        </span>
                      </div>
                      <div className="text-sm text-gray-500 space-y-1">
                        <p>Project ID: {task.project_id}</p>
                        <p>Task ID: {task.id}</p>
                        <p>
                          Created: {new Date(task.created_at).toLocaleString()}
                        </p>
                        <p>
                          Updated: {new Date(task.updated_at).toLocaleString()}
                        </p>
                      </div>
                      {task.conversation_history.length > 0 && (
                        <div className="mt-3">
                          <p className="text-sm font-medium text-gray-700">
                            Conversation History:
                          </p>
                          <p className="text-sm text-gray-500">
                            {task.conversation_history.length} messages
                          </p>
                        </div>
                      )}
                    </div>
                    <button
                      onClick={() => removeTask(task.id)}
                      className="px-3 py-1 text-sm text-red-600 hover:bg-red-50 rounded transition-colors"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </MainLayout>
  );
}
