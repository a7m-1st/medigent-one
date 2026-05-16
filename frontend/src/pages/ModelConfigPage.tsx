import { useState } from 'react';
import { MainLayout } from '@/components/layout/MainLayout';
import { useModelStore } from '@/stores';
import type { ModelConfig, ModelPlatform } from '@/types';

export function ModelConfigPage() {
  const { models, addModel, updateModel, removeModel } = useModelStore();
  const [isEditing, setIsEditing] = useState(false);
  const [editingModel, setEditingModel] = useState<Partial<ModelConfig>>({
    platform: 'openai',
    model_name: '',
    api_key: '',
    temperature: 0.7,
  });

  const platforms: ModelPlatform[] = [
    'openai',
    'anthropic',
    'google',
    'azure',
    'cohere',
    'mistral',
    'local',
    'custom',
  ];

  const handleAddNew = () => {
    setIsEditing(true);
    setEditingModel({
      platform: 'openai',
      model_name: '',
      api_key: '',
      temperature: 0.7,
    });
  };

  const handleEdit = (model: ModelConfig) => {
    setIsEditing(true);
    setEditingModel({ ...model });
  };

  const handleSave = () => {
    if (!editingModel.model_name || !editingModel.api_key) return;

    const modelData = editingModel as ModelConfig;
    
    // Check if model already exists (for update)
    const existingModel = models.find(
      (m) => m.platform === modelData.platform && m.model_name === modelData.model_name
    );

    if (existingModel) {
      updateModel(`${modelData.platform}-${modelData.model_name}`, modelData);
    } else {
      addModel(modelData);
    }

    setIsEditing(false);
    setEditingModel({
      platform: 'openai',
      model_name: '',
      api_key: '',
      temperature: 0.7,
    });
  };

  const handleCancel = () => {
    setIsEditing(false);
    setEditingModel({
      platform: 'openai',
      model_name: '',
      api_key: '',
      temperature: 0.7,
    });
  };

  return (
    <MainLayout>
      <div className="max-w-4xl mx-auto p-6">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-2xl font-bold">Model Configuration</h1>
          <button
            onClick={handleAddNew}
            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
          >
            Add New Model
          </button>
        </div>

        {/* Model Form */}
        {isEditing && (
          <div className="bg-white rounded-lg shadow p-6 mb-6">
            <h2 className="text-lg font-semibold mb-4">
              {editingModel.model_name ? 'Edit Model' : 'Add New Model'}
            </h2>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Platform
                </label>
                <select
                  value={editingModel.platform}
                  onChange={(e) =>
                    setEditingModel({
                      ...editingModel,
                      platform: e.target.value as ModelPlatform,
                    })
                  }
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {platforms.map((platform) => (
                    <option key={platform} value={platform}>
                      {platform.charAt(0).toUpperCase() + platform.slice(1)}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Model Name
                </label>
                <input
                  type="text"
                  value={editingModel.model_name}
                  onChange={(e) =>
                    setEditingModel({ ...editingModel, model_name: e.target.value })
                  }
                  placeholder="e.g., gpt-4"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  API Key
                </label>
                <input
                  type="password"
                  value={editingModel.api_key}
                  onChange={(e) =>
                    setEditingModel({ ...editingModel, api_key: e.target.value })
                  }
                  placeholder="Enter API key"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Temperature
                </label>
                <input
                  type="number"
                  min="0"
                  max="2"
                  step="0.1"
                  value={editingModel.temperature}
                  onChange={(e) =>
                    setEditingModel({
                      ...editingModel,
                      temperature: parseFloat(e.target.value),
                    })
                  }
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>

            <div className="flex gap-2 mt-4">
              <button
                onClick={handleSave}
                className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
              >
                Save
              </button>
              <button
                onClick={handleCancel}
                className="px-4 py-2 bg-gray-200 text-gray-700 rounded-md hover:bg-gray-300 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Model List */}
        <div className="bg-white rounded-lg shadow">
          <div className="p-4 border-b border-gray-200">
            <h2 className="text-lg font-semibold">Configured Models</h2>
          </div>
          
          {models.length === 0 ? (
            <div className="p-8 text-center text-gray-500">
              No models configured yet. Click "Add New Model" to get started.
            </div>
          ) : (
            <div className="divide-y divide-gray-200">
              {models.map((model, index) => (
                <div
                  key={`${model.platform}-${model.model_name}-${index}`}
                  className="p-4 flex items-center justify-between hover:bg-gray-50"
                >
                  <div>
                    <p className="font-medium text-gray-900">
                      {model.model_name}
                    </p>
                    <p className="text-sm text-gray-500">
                      {model.platform} • Temperature: {model.temperature}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleEdit(model)}
                      className="px-3 py-1 text-sm text-blue-600 hover:bg-blue-50 rounded transition-colors"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => removeModel(`${model.platform}-${model.model_name}`)}
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
