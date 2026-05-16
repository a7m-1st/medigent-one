import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { persist } from 'zustand/middleware';

const MCP_CONFIG_KEY = 'medgemma_mcp_config';

export interface McpServerConfig {
  url: string;
  headers?: Record<string, string>;
  type?: 'sse' | 'streamable_http' | 'websocket';
  /** When true, the browser acts as a proxy — MCP requests are relayed
   *  through the browser instead of connected to directly by the backend. */
  useLocalProxy?: boolean;
}

interface McpState {
  servers: Record<string, McpServerConfig>;
  isDialogOpen: boolean;

  // Actions
  addServer: (name: string, config: McpServerConfig) => void;
  removeServer: (name: string) => void;
  updateServer: (name: string, config: McpServerConfig) => void;
  setDialogOpen: (open: boolean) => void;
  loadFromStorage: () => void;
  toggleLocalProxy: (name: string) => void;

  /** Returns the payload shape expected by the backend Chat model. */
  getInstalledMcp: () => { mcpServers: Record<string, McpServerConfig> };

  /** Returns only servers that use local proxy. */
  getProxyServers: () => Record<string, McpServerConfig>;

  /** Returns true if any server uses local proxy. */
  hasProxyServers: () => boolean;
}

export const useMcpStore = create<McpState>()(
  persist(
    immer((set, get) => ({
      servers: {},
      isDialogOpen: false,

      addServer: (name, config) => {
        set((state) => {
          state.servers[name] = config;
        });
      },

      removeServer: (name) => {
        set((state) => {
          delete state.servers[name];
        });
      },

      updateServer: (name, config) => {
        set((state) => {
          state.servers[name] = config;
        });
      },

      setDialogOpen: (open) => {
        set((state) => {
          state.isDialogOpen = open;
        });
      },

      loadFromStorage: () => {
        // No longer needed - persist middleware handles this automatically
      },

      toggleLocalProxy: (name) => {
        set((state) => {
          const server = state.servers[name];
          if (server) {
            server.useLocalProxy = !server.useLocalProxy;
          }
        });
      },

      getInstalledMcp: () => {
        return { mcpServers: JSON.parse(JSON.stringify(get().servers)) };
      },

      getProxyServers: () => {
        const servers = get().servers;
        const proxy: Record<string, McpServerConfig> = {};
        for (const [name, config] of Object.entries(servers)) {
          if (config.useLocalProxy) {
            proxy[name] = JSON.parse(JSON.stringify(config));
          }
        }
        return proxy;
      },

      hasProxyServers: () => {
        return Object.values(get().servers).some((s) => s.useLocalProxy);
      },
    })),
    {
      name: MCP_CONFIG_KEY,
      partialize: (state) => ({
        servers: JSON.parse(JSON.stringify(state.servers)),
      }),
    }
  )
);
