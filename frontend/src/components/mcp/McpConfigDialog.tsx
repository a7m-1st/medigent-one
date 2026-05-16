import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useMcpStore, type McpServerConfig } from '@/stores/mcpStore';
import { Globe, Monitor, Plug, Plus, Trash2 } from 'lucide-react';
import React, { useState } from 'react';

export const McpConfigDialog: React.FC = () => {
  const {
    servers,
    isDialogOpen,
    setDialogOpen,
    addServer,
    removeServer,
    toggleLocalProxy,
  } = useMcpStore();

  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [transport, setTransport] = useState<string>('auto');
  const [useProxy, setUseProxy] = useState(false);
  const [headerKey, setHeaderKey] = useState('');
  const [headerValue, setHeaderValue] = useState('');
  const [headers, setHeaders] = useState<Record<string, string>>({});

  const serverEntries = Object.entries(servers);

  const resetForm = () => {
    setName('');
    setUrl('');
    setTransport('auto');
    setUseProxy(false);
    setHeaderKey('');
    setHeaderValue('');
    setHeaders({});
  };

  const handleAddHeader = () => {
    const k = headerKey.trim();
    const v = headerValue.trim();
    if (k && v) {
      setHeaders((prev) => ({ ...prev, [k]: v }));
      setHeaderKey('');
      setHeaderValue('');
    }
  };

  const handleRemoveHeader = (key: string) => {
    setHeaders((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const handleAddServer = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedName = name.trim();
    const trimmedUrl = url.trim();
    if (!trimmedName || !trimmedUrl) return;

    const config: McpServerConfig = {
      url: trimmedUrl,
      useLocalProxy: useProxy,
    };
    if (transport !== 'auto') {
      config.type = transport as McpServerConfig['type'];
    }
    if (Object.keys(headers).length > 0) {
      config.headers = { ...headers };
    }

    addServer(trimmedName, config);
    resetForm();
  };

  const canAdd = name.trim().length > 0 && url.trim().length > 0;

  const getTransportLabel = (config: McpServerConfig) => {
    if (config.type) return config.type.toUpperCase().replace('_', ' ');
    if (config.url.startsWith('ws://') || config.url.startsWith('wss://'))
      return 'WebSocket';
    return 'HTTP';
  };

  return (
    <Dialog open={isDialogOpen} onOpenChange={setDialogOpen}>
      <DialogContent className="sm:max-w-lg bg-card border-border text-foreground max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <div className="mx-auto w-12 h-12 bg-accent-light rounded-full flex items-center justify-center mb-4">
            <Plug className="w-6 h-6 text-accent" />
          </div>
          <DialogTitle className="text-xl font-bold text-center">
            MCP Servers
          </DialogTitle>
          <DialogDescription className="text-foreground-muted text-center text-sm">
            Configure MCP servers to extend agent capabilities with
            external tools. Enable Local Proxy to route through your browser.
          </DialogDescription>
        </DialogHeader>

        {/* Server list */}
        {serverEntries.length > 0 ? (
          <div className="space-y-2">
            {serverEntries.map(([serverName, config]) => (
              <div
                key={serverName}
                className="flex items-center justify-between rounded-lg border border-border bg-background-secondary px-3 py-2.5"
              >
                <div className="flex flex-col gap-0.5 min-w-0 flex-1 mr-3">
                  <span className="text-sm font-medium text-foreground truncate">
                    {serverName}
                  </span>
                  <span className="text-xs text-foreground-muted truncate">
                    {config.url}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {/* Local Proxy toggle */}
                  <button
                    type="button"
                    onClick={() => toggleLocalProxy(serverName)}
                    className={`
                      flex items-center gap-1 px-2 py-1 rounded text-[10px] font-mono
                      uppercase tracking-wider transition-colors cursor-pointer
                      ${
                        config.useLocalProxy
                          ? 'bg-blue-500/15 text-blue-400 border border-blue-500/30'
                          : 'bg-background-secondary text-foreground-muted border border-border hover:border-blue-500/30 hover:text-blue-400'
                      }
                    `}
                    title={
                      config.useLocalProxy
                        ? 'Using local proxy (requests routed through your browser)'
                        : 'Using direct connection (click to enable local proxy)'
                    }
                  >
                    {config.useLocalProxy ? (
                      <Monitor className="w-3 h-3" />
                    ) : (
                      <Globe className="w-3 h-3" />
                    )}
                    {config.useLocalProxy ? 'LOCAL' : 'DIRECT'}
                  </button>
                  <span className="text-[10px] font-mono uppercase tracking-wider text-accent bg-accent/10 px-1.5 py-0.5 rounded">
                    {getTransportLabel(config)}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="w-7 h-7 text-foreground-muted hover:text-error hover:bg-error/10"
                    onClick={() => removeServer(serverName)}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-6 text-sm text-foreground-muted">
            No MCP servers configured.
          </div>
        )}

        {/* Add server form */}
        <form
          onSubmit={handleAddServer}
          className="space-y-3 pt-2 border-t border-border"
        >
          <p className="text-xs font-medium text-foreground-muted uppercase tracking-wider">
            Add Server
          </p>
          <Input
            placeholder="Server name (e.g. my-tools)"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="bg-input border-input-border text-foreground"
          />
          <Input
            placeholder="URL (e.g. http://localhost:3000/mcp)"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            className="bg-input border-input-border text-foreground"
          />

          <div className="flex items-center gap-3">
            <Select value={transport} onValueChange={setTransport}>
              <SelectTrigger className="bg-input border-input-border text-foreground flex-1">
                <SelectValue placeholder="Transport (auto-detect)" />
              </SelectTrigger>
              <SelectContent className="bg-background border border-border shadow-lg">
                <SelectItem value="auto">Auto-detect</SelectItem>
                <SelectItem value="sse">SSE</SelectItem>
                <SelectItem value="streamable_http">Streamable HTTP</SelectItem>
                <SelectItem value="websocket">WebSocket</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Local Proxy toggle for new server */}
          <button
            type="button"
            onClick={() => setUseProxy(!useProxy)}
            className={`
              w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg border
              transition-colors cursor-pointer text-left
              ${
                useProxy
                  ? 'bg-blue-500/10 border-blue-500/30 text-foreground'
                  : 'bg-background-secondary border-border text-foreground-muted hover:border-blue-500/20'
              }
            `}
          >
            <div
              className={`
                w-8 h-[18px] rounded-full relative transition-colors shrink-0
                ${useProxy ? 'bg-blue-500' : 'bg-border'}
              `}
            >
              <div
                className={`
                  absolute top-[2px] w-[14px] h-[14px] rounded-full bg-white
                  transition-transform
                  ${useProxy ? 'translate-x-[16px]' : 'translate-x-[2px]'}
                `}
              />
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="text-xs font-medium">
                {useProxy ? 'Local Proxy Enabled' : 'Use Local Proxy'}
              </span>
              <span className="text-[10px] text-foreground-muted leading-tight">
                Route requests through your browser to reach local servers
              </span>
            </div>
          </button>

          {/* Headers */}
          <div className="space-y-2">
            <p className="text-xs text-foreground-muted">Headers (optional)</p>
            {Object.entries(headers).map(([k, v]) => (
              <div key={k} className="flex items-center gap-2 text-xs">
                <code className="bg-background-secondary px-1.5 py-0.5 rounded text-foreground flex-1 truncate">
                  {k}: {v}
                </code>
                <button
                  type="button"
                  onClick={() => handleRemoveHeader(k)}
                  className="text-foreground-muted hover:text-error"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            ))}
            <div className="flex items-center gap-2">
              <Input
                placeholder="Key"
                value={headerKey}
                onChange={(e) => setHeaderKey(e.target.value)}
                className="bg-input border-input-border text-foreground text-xs h-8 flex-1"
              />
              <Input
                placeholder="Value"
                value={headerValue}
                onChange={(e) => setHeaderValue(e.target.value)}
                className="bg-input border-input-border text-foreground text-xs h-8 flex-1"
              />
              <Button
                type="button"
                variant={
                  headerKey.trim() && headerValue.trim() ? 'default' : 'ghost'
                }
                size="icon"
                className="w-8 h-8 shrink-0"
                onClick={handleAddHeader}
              >
                <Plus className="w-3.5 h-3.5" />
              </Button>
            </div>
          </div>

          <Button
            type="submit"
            disabled={!canAdd}
            className="w-full bg-accent hover:bg-accent-hover text-accent-foreground font-medium"
          >
            <Plus className="w-4 h-4 mr-2" />
            Add Server
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
};
