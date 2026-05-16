import { useState } from 'react';
import type { ModelPlatform, ValidateModelRequest } from '@/types';
import { useModelStore } from '@/stores';

export function ModelValidator() {
  const { isValidating, validationResult, setValidating, setValidationResult, addModel } = useModelStore();
  const [formData, setFormData] = useState<ValidateModelRequest>({
    platform: 'openai',
    model_name: '',
    api_key: '',
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

  const handleValidate = async () => {
    if (!formData.model_name || !formData.api_key) return;

    setValidating(true);
    setValidationResult(null);

    try {
      // Simulate validation - replace with actual validation service
      await new Promise((resolve) => setTimeout(resolve, 1500));
      
      // Mock validation result
      const result = {
        valid: true,
        model_info: {
          name: formData.model_name,
          platform: formData.platform,
        },
      };
      
      setValidationResult(result);
      
      if (result.valid) {
        addModel({
          ...formData,
          temperature: 0.7,
        });
      }
    } catch (error) {
      setValidationResult({
        valid: false,
        error: 'Validation failed. Please check your credentials.',
      });
    } finally {
      setValidating(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Platform
          </label>
          <select
            value={formData.platform}
            onChange={(e) =>
              setFormData({ ...formData, platform: e.target.value as ModelPlatform })
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
            value={formData.model_name}
            onChange={(e) =>
              setFormData({ ...formData, model_name: e.target.value })
            }
            placeholder="e.g., gpt-4, claude-3-opus-20240229"
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            API Key
          </label>
          <input
            type="password"
            value={formData.api_key}
            onChange={(e) =>
              setFormData({ ...formData, api_key: e.target.value })
            }
            placeholder="Enter your API key"
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <button
          onClick={handleValidate}
          disabled={isValidating || !formData.model_name || !formData.api_key}
          className="w-full px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {isValidating ? 'Validating...' : 'Validate & Add Model'}
        </button>
      </div>

      {validationResult && (
        <div
          className={`p-4 rounded-md ${
            validationResult.valid
              ? 'bg-green-50 border border-green-200'
              : 'bg-red-50 border border-red-200'
          }`}
        >
          <div className="flex items-center gap-2">
            <span className="text-xl">{validationResult.valid ? '✅' : '❌'}</span>
            <p
              className={`font-medium ${
                validationResult.valid ? 'text-green-800' : 'text-red-800'
              }`}
            >
              {validationResult.valid
                ? 'Model validated successfully!'
                : validationResult.error || 'Validation failed'}
            </p>
          </div>
          {validationResult.model_info && (
            <div className="mt-2 text-sm text-green-700">
              <p>Model: {String(validationResult.model_info.name)}</p>
              <p>Platform: {String(validationResult.model_info.platform)}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
