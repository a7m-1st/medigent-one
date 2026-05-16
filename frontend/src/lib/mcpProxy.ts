/**
 * Browser-side MCP Proxy Bridge.
 *
 * Opens a dedicated WebSocket to `/ws/mcp-proxy` on the backend and acts
 * as a relay: when the backend's MCP agent needs to call a tool on a
 * "local proxy" MCP server, the request arrives here, this code calls the
 * actual MCP server (via fetch / WebSocket from the browser), and sends
 * the response back.
 *
 * This enables MCP servers running on localhost or the user's LAN to be
 * used by the cloud-hosted backend without direct network access.
 *
 * Protocol:
 *   Backend -> Browser: {"type":"mcp_request", "payload":{request_id, server_name, method, params}}
 *   Browser -> Backend: {"type":"mcp_response", "payload":{request_id, response}}
 *   Browser -> Backend: {"type":"mcp_error", "payload":{request_id, error}}
 */

import type { McpServerConfig } from '@/stores/mcpStore';

// --------------------------------------------------------------------------
// Types
// --------------------------------------------------------------------------

interface McpProxyMessage {
  type: string;
  payload: Record<string, unknown>;
}

interface McpRequestPayload {
  request_id: string;
  server_name: string;
  method: string;
  params: Record<string, unknown>;
}

export type McpProxyStatus = 'disconnected' | 'connecting' | 'connected';

// --------------------------------------------------------------------------
// Per-server MCP client (handles SSE / Streamable HTTP connections)
// --------------------------------------------------------------------------

/**
 * Lightweight MCP client that communicates with MCP servers via
 * Streamable HTTP (POST for requests, GET for SSE notifications).
 *
 * This runs entirely in the browser and is used by the proxy bridge
 * to forward tool calls to local MCP servers.
 */
class BrowserMcpClient {
  private url: string;
  private headers: Record<string, string>;
  private sessionId: string | null = null;

  constructor(config: McpServerConfig) {
    this.url = config.url;
    this.headers = config.headers || {};
  }

  /**
   * Initialize the MCP connection (protocol handshake).
   */
  async initialize(): Promise<void> {
    const initRequest = {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: {
          name: 'medgemma-browser-proxy',
          version: '1.0.0',
        },
      },
    };

    await this.sendRequest(initRequest);

    // Send initialized notification (fire-and-forget, not awaited)
    this.sendNotification({
      jsonrpc: '2.0',
      method: 'notifications/initialized',
    });
  }

  /**
   * List available tools from the MCP server.
   */
  async listTools(): Promise<{ tools: unknown[] }> {
    const response = await this.sendRequest({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
      params: {},
    });
    return response?.result || { tools: [] };
  }

  /**
   * Call a tool on the MCP server.
   */
  async callTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    const response = await this.sendRequest({
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'tools/call',
      params: { name, arguments: args },
    });
    return response?.result || {};
  }

  /**
   * Send a JSON-RPC request to the MCP server via HTTP POST.
   */
  private async sendRequest(body: Record<string, unknown>): Promise<any> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream;q=0.9',
      ...this.headers,
    };

    // Include session ID if we have one
    if (this.sessionId) {
      headers['Mcp-Session-Id'] = this.sessionId;
    }

    const res = await fetch(this.url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    // Capture session ID from response
    const sid = res.headers.get('Mcp-Session-Id');
    if (sid) {
      this.sessionId = sid;
    }

    // Check for HTTP errors before attempting to parse body
    if (!res.ok) {
      throw new Error(
        `MCP server returned ${res.status}: ${await res.text()}`,
      );
    }

    const contentType = res.headers.get('content-type') || '';

    if (contentType.includes('text/event-stream')) {
      // SSE response — parse the event stream for the result
      return await this.parseSSEResponse(res);
    }

    return await res.json();
  }

  /**
   * Send a JSON-RPC notification (no response expected).
   *
   * Some MCP servers keep the connection open (SSE) for notifications,
   * so we fire-and-forget: we do NOT await the response body.
   * An AbortController ensures the connection is cleaned up if the
   * server holds it open.
   */
  private sendNotification(body: Record<string, unknown>): void {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...this.headers,
    };

    if (this.sessionId) {
      headers['Mcp-Session-Id'] = this.sessionId;
    }

    // Fire-and-forget — don't await. Some servers hold the connection
    // open as an SSE stream for notifications, which would cause a hang.
    const abortController = new AbortController();
    fetch(this.url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: abortController.signal,
    })
      .then((res) => {
        // Capture session ID if returned
        const sid = res.headers.get('Mcp-Session-Id');
        if (sid) {
          this.sessionId = sid;
        }
        // If the server responds with SSE (holds connection open),
        // abort it since we don't need to consume notification responses.
        const ct = res.headers.get('content-type') || '';
        if (ct.includes('text/event-stream')) {
          abortController.abort();
        }
      })
      .catch(() => {
        // Notifications are best-effort — ignore errors
      });
  }

  /**
   * Parse an SSE response stream and extract the JSON-RPC result.
   */
  private async parseSSEResponse(res: Response): Promise<any> {
    const reader = res.body?.getReader();
    if (!reader) {
      throw new Error('No response body');
    }

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Parse SSE events
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6).trim();
          if (data) {
            try {
              const parsed = JSON.parse(data);
              // Return the first JSON-RPC response we find
              if (parsed.id || parsed.result) {
                return parsed;
              }
            } catch {
              // Not JSON, continue
            }
          }
        }
      }
    }

    return null;
  }
}

// --------------------------------------------------------------------------
// McpProxyBridge — main bridge class
// --------------------------------------------------------------------------

export class McpProxyBridge {
  private ws: WebSocket | null = null;
  private projectId: string | null = null;
  private servers: Record<string, McpServerConfig> = {};
  private clients: Map<string, BrowserMcpClient> = new Map();
  private status: McpProxyStatus = 'disconnected';
  private onStatusChange?: (status: McpProxyStatus) => void;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private intentionalDisconnect = false;

  constructor(opts?: { onStatusChange?: (status: McpProxyStatus) => void }) {
    this.onStatusChange = opts?.onStatusChange;
  }

  getStatus(): McpProxyStatus {
    return this.status;
  }

  private setStatus(s: McpProxyStatus) {
    this.status = s;
    this.onStatusChange?.(s);
  }

  /**
   * Connect to the backend's MCP proxy WebSocket and register for a project.
   */
  async connect(
    projectId: string,
    servers: Record<string, McpServerConfig>,
  ): Promise<void> {
    if (this.status === 'connected' && this.projectId === projectId) {
      // Update servers map without reconnecting
      this.servers = servers;
      return;
    }

    this.disconnect();
    this.projectId = projectId;
    this.servers = servers;
    this.setStatus('connecting');

    return new Promise<void>((resolve, reject) => {
      const wsUrl = this.getWSUrl();
      console.log('[McpProxy] Connecting to:', wsUrl);

      this.intentionalDisconnect = false;

      try {
        this.ws = new WebSocket(wsUrl);
      } catch (err) {
        this.setStatus('disconnected');
        reject(err);
        return;
      }

      this.ws.onopen = () => {
        console.log('[McpProxy] WebSocket connected, registering...');
        this.reconnectAttempts = 0;
        // Register for this project
        this.ws!.send(
          JSON.stringify({
            type: 'register',
            payload: { project_id: projectId },
          }),
        );
      };

      this.ws.onmessage = (event: MessageEvent) => {
        this.handleMessage(event.data, resolve);
      };

      this.ws.onerror = () => {
        console.error('[McpProxy] WebSocket error');
        if (this.status === 'connecting') {
          this.setStatus('disconnected');
          reject(new Error('MCP proxy WebSocket connection failed'));
        }
      };

      this.ws.onclose = () => {
        console.log('[McpProxy] WebSocket closed');
        const wasConnected = this.status === 'connected';
        this.setStatus('disconnected');
        this.clients.clear();

        // Auto-reconnect if the close was not intentional
        if (!this.intentionalDisconnect && wasConnected) {
          this.scheduleReconnect();
        }
      };
    });
  }

  /**
   * Disconnect from the proxy WebSocket.
   */
  disconnect(): void {
    this.intentionalDisconnect = true;

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.ws) {
      this.ws.close(1000, 'Client disconnect');
      this.ws = null;
    }

    this.clients.clear();
    this.reconnectAttempts = 0;
    this.setStatus('disconnected');
  }

  // --------------------------------------------------------------------------
  // Private
  // --------------------------------------------------------------------------

  /**
   * Schedule a reconnection attempt with exponential back-off.
   */
  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.warn(
        `[McpProxy] Max reconnect attempts (${this.maxReconnectAttempts}) reached, giving up`,
      );
      return;
    }

    const delay = Math.min(1000 * 2 ** this.reconnectAttempts, 30_000);
    this.reconnectAttempts++;

    console.log(
      `[McpProxy] Scheduling reconnect attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts} in ${delay}ms`,
    );

    this.reconnectTimer = setTimeout(() => {
      if (this.intentionalDisconnect || !this.projectId) return;

      this.setStatus('connecting');
      this.connect(this.projectId!, this.servers).catch((err) => {
        console.error('[McpProxy] Reconnect failed:', err);
        // onclose will fire again and trigger another scheduleReconnect
      });
    }, delay);
  }

  private getWSUrl(): string {
    const apiBaseUrl = import.meta.env.VITE_API_URL || '';
    let base: string;

    if (!apiBaseUrl || apiBaseUrl === '/') {
      const loc = window.location;
      const proto = loc.protocol === 'https:' ? 'wss:' : 'ws:';
      base = `${proto}//${loc.host}`;
    } else if (apiBaseUrl.startsWith('http')) {
      base = apiBaseUrl.replace(/^http/, 'ws');
    } else {
      const loc = window.location;
      const proto = loc.protocol === 'https:' ? 'wss:' : 'ws:';
      base = `${proto}//${loc.host}${apiBaseUrl}`;
    }

    base = base.replace(/\/+$/, '');
    return `${base}/ws/mcp-proxy`;
  }

  private handleMessage(raw: string, onRegistered?: () => void): void {
    let msg: McpProxyMessage;
    try {
      msg = JSON.parse(raw);
    } catch {
      console.error('[McpProxy] Invalid JSON from server');
      return;
    }

    switch (msg.type) {
      case 'registered':
        console.log('[McpProxy] Registered for project', msg.payload.project_id);
        this.setStatus('connected');
        onRegistered?.();
        break;

      case 'mcp_request':
        this.handleMcpRequest(msg.payload as unknown as McpRequestPayload);
        break;

      case 'error':
        console.error('[McpProxy] Server error:', msg.payload.message);
        break;

      default:
        console.warn('[McpProxy] Unknown message type:', msg.type);
    }
  }

  /**
   * Handle an MCP request from the backend — forward it to the actual
   * MCP server running locally, then send the response back.
   */
  private async handleMcpRequest(req: McpRequestPayload): Promise<void> {
    const { request_id, server_name, method, params } = req;

    console.log(`[McpProxy] Request ${request_id}: ${method} -> ${server_name}`);

    try {
      // Get or create a client for this server
      const client = await this.getOrCreateClient(server_name, params);

      let response: unknown;

      if (method === 'tools/list') {
        response = await client.listTools();
      } else if (method === 'tools/call') {
        const toolName = (params as any).name;
        const toolArgs = (params as any).arguments || {};
        response = await client.callTool(toolName, toolArgs);
      } else {
        throw new Error(`Unsupported MCP method: ${method}`);
      }

      // Send response back to backend
      this.sendToBackend({
        type: 'mcp_response',
        payload: { request_id, response },
      });
    } catch (err) {
      const errorMsg =
        err instanceof Error ? err.message : 'Unknown proxy error';
      console.error(`[McpProxy] Error for ${request_id}:`, errorMsg);

      this.sendToBackend({
        type: 'mcp_error',
        payload: { request_id, error: errorMsg },
      });
    }
  }

  /**
   * Get or create a BrowserMcpClient for the given server.
   */
  private async getOrCreateClient(
    serverName: string,
    params: Record<string, unknown>,
  ): Promise<BrowserMcpClient> {
    if (this.clients.has(serverName)) {
      return this.clients.get(serverName)!;
    }

    // Get config from our stored servers or from the request params
    const config =
      this.servers[serverName] ||
      (params.server_config as McpServerConfig | undefined);

    if (!config) {
      throw new Error(
        `No configuration found for MCP server "${serverName}". ` +
          `Make sure the server is configured in the MCP dialog.`,
      );
    }

    const client = new BrowserMcpClient(config);
    await client.initialize();
    this.clients.set(serverName, client);
    console.log(`[McpProxy] Initialized MCP client for ${serverName}`);
    return client;
  }

  private sendToBackend(msg: McpProxyMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    } else {
      console.error('[McpProxy] Cannot send — WebSocket not open');
    }
  }
}
