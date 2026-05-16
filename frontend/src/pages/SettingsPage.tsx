import { useState } from 'react';
import { MainLayout } from '@/components/layout/MainLayout';
import { ModelValidator } from '@/components/model/ModelValidator';

export function SettingsPage() {
  const [activeTab, setActiveTab] = useState<'ai-models' | 'general'>('ai-models');

  const tabs = [
    { id: 'ai-models' as const, label: 'AI Models' },
    { id: 'general' as const, label: 'General' },
  ];

  return (
    <MainLayout>
      <div className="max-w-4xl mx-auto p-6">
        <h1 className="text-2xl font-bold mb-6">Settings</h1>
        
        {/* Tabs */}
        <div className="border-b border-gray-200 mb-6">
          <nav className="flex gap-8">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`pb-4 px-1 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === tab.id
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </nav>
        </div>

        {/* Tab Content */}
        <div className="bg-white rounded-lg shadow p-6">
          {activeTab === 'ai-models' && (
            <div>
              <h2 className="text-lg font-semibold mb-4">AI Model Configuration</h2>
              <p className="text-gray-600 mb-6">
                Configure and validate your AI model credentials. Supported platforms include OpenAI, Anthropic, Google, and more.
              </p>
              <ModelValidator />
            </div>
          )}

          {activeTab === 'general' && (
            <div>
              <h2 className="text-lg font-semibold mb-4">General Settings</h2>
              <p className="text-gray-600 mb-4">
                General application settings will appear here.
              </p>
              <div className="p-4 bg-gray-50 rounded-md text-gray-500 text-center">
                General settings coming soon...
              </div>
            </div>
          )}
        </div>
      </div>
    </MainLayout>
  );
}
