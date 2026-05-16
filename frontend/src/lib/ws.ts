import type { ZodSchema } from 'zod';
import { ZodError } from 'zod';

/**
 * WebSocket message types sent FROM the client TO the server.
 * Maps to the backend ``msg_type`` discriminator.
 */
export type WSMessageType =
  | 'start_chat'
  | 'improve'
  | 'stop'
  | 'human_reply'
  | 'start_task';

export interface WSMessage {
  type: WSMessageType;
  payload: unknown;
}

export interface WSOptions<TEvent> {
  /** Full WebSocket URL (ws:// or wss://) */
  url: string;
  /** Zod schema to validate incoming server events */
  eventSchema: ZodSchema<TEvent>;
  /** Called for every validated server event */
  onMessage?: (data: TEvent) => void;
  /** Called on connection errors (including close errors) */
  onError?: (error: Error) => void;
  /** Called when the WebSocket connection opens */
  onOpen?: () => void;
  /** Called when the WebSocket connection closes */
  onClose?: (code: number, reason: string) => void;
  /** Max reconnect attempts (default: 5, set 0 to disable) */
  reconnectAttempts?: number;
  /** Initial reconnect delay in ms (default: 1000) */
  reconnectDelay?: number;
  /** Max reconnect delay in ms (default: 30000) */
  maxReconnectDelay?: number;
}

export interface WSConnectionState {
  isConnected: boolean;
  isConnecting: boolean;
  reconnectCount: number;
  lastError?: Error;
}

/**
 * Persistent WebSocket connection class.
 *
 * Provides a callback-driven API for bidirectional communication with the
 * backend.  All client-to-server commands (start_chat, improve, stop,
 * human_reply, start_task) are sent via {@link send}.  Server events arrive
 * in the ``{"step": ..., "data": ...}`` JSON format and are validated with
 * the provided Zod schema.
 */
export class WSConnection<TEvent> {
  private ws: WebSocket | null = null;
  private options: Required<
    Pick<WSOptions<TEvent>, 'reconnectAttempts' | 'reconnectDelay' | 'maxReconnectDelay'>
  > &
    WSOptions<TEvent>;
  private state: WSConnectionState = {
    isConnected: false,
    isConnecting: false,
    reconnectCount: 0,
  };
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private currentReconnectDelay: number;
  private intentionalClose = false;

  constructor(options: WSOptions<TEvent>) {
    this.options = {
      reconnectAttempts: 5,
      reconnectDelay: 1000,
      maxReconnectDelay: 30000,
      ...options,
    };
    this.currentReconnectDelay = this.options.reconnectDelay;
  }

  getState(): WSConnectionState {
    return { ...this.state };
  }

  /**
   * Open the WebSocket connection.
   *
   * Resolves once the socket is open, or rejects on connection error.
   */
  connect(): Promise<void> {
    if (this.state.isConnected || this.state.isConnecting) {
      return Promise.resolve();
    }

    this.intentionalClose = false;
    this.state.isConnecting = true;

    return new Promise<void>((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.options.url);
      } catch (err) {
        this.state.isConnecting = false;
        const error = err instanceof Error ? err : new Error(String(err));
        this.state.lastError = error;
        reject(error);
        return;
      }

      this.ws.onopen = () => {
        this.state.isConnected = true;
        this.state.isConnecting = false;
        this.state.reconnectCount = 0;
        this.currentReconnectDelay = this.options.reconnectDelay;
        this.options.onOpen?.();
        resolve();
      };

      this.ws.onmessage = (event: MessageEvent) => {
        this.parseAndEmitEvent(event.data);
      };

      this.ws.onerror = (_event: Event) => {
        const error = new Error('WebSocket connection error');
        this.state.lastError = error;
        if (this.state.isConnecting) {
          this.state.isConnecting = false;
          reject(error);
        }
        this.options.onError?.(error);
      };

      this.ws.onclose = (event: CloseEvent) => {
        const wasConnected = this.state.isConnected;
        this.state.isConnected = false;
        this.state.isConnecting = false;
        this.options.onClose?.(event.code, event.reason);

        // Attempt reconnect only if the close was unexpected
        if (
          !this.intentionalClose &&
          wasConnected &&
          this.state.reconnectCount < this.options.reconnectAttempts
        ) {
          this.attemptReconnect();
        }
      };
    });
  }

  /**
   * Send a typed message to the server.
   */
  send(type: WSMessageType, payload: unknown): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.warn('[WS] Cannot send — socket not open');
      return;
    }
    const msg: WSMessage = { type, payload };
    this.ws.send(JSON.stringify(msg));
  }

  /**
   * Gracefully close the connection (no auto-reconnect).
   */
  disconnect(): void {
    this.intentionalClose = true;

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.ws) {
      this.ws.close(1000, 'Client disconnect');
      this.ws = null;
    }

    this.state.isConnected = false;
    this.state.isConnecting = false;
  }

  // ------------------------------------------------------------------
  // Private helpers
  // ------------------------------------------------------------------

  private parseAndEmitEvent(raw: string): void {
    try {
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        parsed = { message: raw };
      }

      const validated = this.options.eventSchema.parse(parsed);
      this.options.onMessage?.(validated);
    } catch (error: unknown) {
      if (error instanceof ZodError) {
        console.error('WS event validation failed:', error.issues);
        this.options.onError?.(
          new Error(
            `Event validation failed: ${error.issues.map((e: { message: string }) => e.message).join(', ')}`
          )
        );
      } else {
        this.options.onError?.(
          error instanceof Error ? error : new Error(String(error))
        );
      }
    }
  }

  private attemptReconnect(): void {
    this.state.reconnectCount++;
    console.log(
      `[WS] Reconnecting (${this.state.reconnectCount}/${this.options.reconnectAttempts})...`
    );

    this.reconnectTimer = setTimeout(() => {
      this.connect().catch(() => {
        // onError is already called inside connect
      });
    }, this.currentReconnectDelay);

    this.currentReconnectDelay = Math.min(
      this.currentReconnectDelay * 2,
      this.options.maxReconnectDelay
    );
  }
}

/**
 * Derive the WebSocket URL from the current API base URL.
 *
 * If ``VITE_API_URL`` is ``http://localhost:8000`` the WS URL becomes
 * ``ws://localhost:8000/ws/chat``.  Handles both relative and absolute
 * base URLs and upgrades ``https`` to ``wss``.
 */
export function getWSUrl(apiBaseUrl: string): string {
  let base: string;

  if (!apiBaseUrl || apiBaseUrl === '/') {
    // Relative — derive from current page origin
    const loc = window.location;
    const proto = loc.protocol === 'https:' ? 'wss:' : 'ws:';
    base = `${proto}//${loc.host}`;
  } else if (apiBaseUrl.startsWith('http')) {
    base = apiBaseUrl.replace(/^http/, 'ws');
  } else {
    // Relative path like "/api"
    const loc = window.location;
    const proto = loc.protocol === 'https:' ? 'wss:' : 'ws:';
    base = `${proto}//${loc.host}${apiBaseUrl}`;
  }

  // Remove trailing slash
  base = base.replace(/\/+$/, '');
  return `${base}/ws/chat`;
}
