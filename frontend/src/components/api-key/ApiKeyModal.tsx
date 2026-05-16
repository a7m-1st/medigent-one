import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useApiConfigStore } from '@/stores/apiConfigStore';
import { Key, ShieldCheck } from 'lucide-react';

export const ApiKeyModal: React.FC = () => {
  const { setApiKey, loadFromStorage, isModalOpen, setModalOpen } = useApiConfigStore();
  const [key, setKey] = useState('');
  const [medgemmaUrl, setMedgemmaUrl] = useState('');
  const [medgemmaModelType, setMedgemmaModelType] = useState('');
  const [medgemmaContextSize, setMedgemmaContextSize] = useState('');

  useEffect(() => {
    loadFromStorage();
  }, [loadFromStorage]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (key.trim()) {
      const contextSize = medgemmaContextSize.trim() ? parseInt(medgemmaContextSize.trim(), 10) : undefined;
      setApiKey(
        key.trim(),
        medgemmaUrl.trim() || undefined,
        medgemmaModelType.trim() || undefined,
        contextSize && !isNaN(contextSize) ? contextSize : undefined,
      );
    }
  };

  const showMedgemmaFields = medgemmaUrl.trim().length > 0;

  return (
    <Dialog open={isModalOpen} onOpenChange={setModalOpen}>
      <DialogContent className="sm:max-w-md bg-card border-border text-foreground">
        <DialogHeader>
          <div className="mx-auto w-12 h-12 bg-accent-light rounded-full flex items-center justify-center mb-4">
            <Key className="w-6 h-6 text-accent" />
          </div>
          <DialogTitle className="text-2xl font-bold text-center">Gemini API Key</DialogTitle>
          <DialogDescription className="text-foreground-muted text-center">
            Enter your Google Gemini API key to start using Medigent One (powered by Gemma 4 31B).
            Your key is stored locally in your browser.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 py-4">
          <div className="space-y-2">
            <Input
              type="password"
              placeholder="Enter your API key..."
              value={key}
              onChange={(e) => setKey(e.target.value)}
              className="bg-input border-input-border text-foreground focus:ring-accent"
              autoFocus
            />
            <Input
              type="url"
              placeholder="Secondary model host URL (optional, uses default endpoint)"
              value={medgemmaUrl}
              onChange={(e) => setMedgemmaUrl(e.target.value)}
              className="bg-input border-input-border text-foreground focus:ring-accent mt-2"
            />
            {showMedgemmaFields && (
              <>
                <Input
                  type="text"
                  placeholder="Secondary model type (e.g. gemma-4-31b-it)"
                  value={medgemmaModelType}
                  onChange={(e) => setMedgemmaModelType(e.target.value)}
                  className="bg-input border-input-border text-foreground focus:ring-accent"
                />
                <Input
                  type="number"
                  placeholder="Context window size in tokens (e.g. 16384)"
                  value={medgemmaContextSize}
                  onChange={(e) => setMedgemmaContextSize(e.target.value)}
                  min={1024}
                  className="bg-input border-input-border text-foreground focus:ring-accent"
                />
              </>
            )}
          </div>
          <DialogFooter className="sm:justify-center">
            <Button
              type="submit"
              className="w-full bg-accent hover:bg-accent-hover text-accent-foreground font-medium"
              disabled={!key.trim()}
            >
              <ShieldCheck className="w-4 h-4 mr-2" />
              Save and Continue
            </Button>
          </DialogFooter>
        </form>

        <div className="text-xs text-center text-foreground-muted mt-2">
          Don't have a key? Get one from the <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">Google AI Studio</a>.
        </div>
      </DialogContent>
    </Dialog>
  );
};