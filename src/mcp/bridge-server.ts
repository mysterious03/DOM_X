/**
 * DOMPulse MCP Bridge Server
 * Runs a local WebSocket server connecting AI agents (via MCP) to browser tabs (Chrome Extension or Testbench).
 */

import { WebSocketServer, WebSocket } from 'ws';
import { DOMPulseEvent } from '../core/types';

export interface TabSession {
  id: string;
  ws: WebSocket;
  url: string;
  title: string;
  connectedAt: number;
  lastSeen: number;
}

export interface BridgeServerOptions {
  port?: number;
  host?: string;
}

export class DOMPulseBridgeServer {
  private wss: WebSocketServer | null = null;
  private port: number;
  private host: string;
  private tabs: Map<string, TabSession> = new Map();
  private activeTabId: string | null = null;
  private pendingRequests: Map<string, { resolve: (val: any) => void; reject: (err: any) => void; timer: NodeJS.Timeout }> = new Map();
  private mutationBuffer: DOMPulseEvent[] = [];
  private mutationWaiters: Array<(event: DOMPulseEvent) => boolean> = [];
  private maxBufferSize: number = 200;

  constructor(options: BridgeServerOptions = {}) {
    this.port = options.port || Number(process.env.DOM_X_PORT || process.env.DOMPULSE_PORT) || 8765;
    this.host = options.host || '127.0.0.1';
  }

  public start(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.wss = new WebSocketServer({ port: this.port, host: this.host }, () => {
          console.error(`[DOM_X MCP Bridge] WebSocket server listening on ws://${this.host}:${this.port}`);
          resolve();
        });

        this.wss.on('connection', (ws) => {
          const tabId = `tab-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
          const session: TabSession = {
            id: tabId,
            ws,
            url: 'about:blank',
            title: 'Connecting...',
            connectedAt: Date.now(),
            lastSeen: Date.now(),
          };

          this.tabs.set(tabId, session);
          this.activeTabId = tabId;

          ws.on('message', (raw) => {
            try {
              const msg = JSON.parse(raw.toString());
              this.handleClientMessage(tabId, msg);
            } catch (err) {
              console.error('[DOMPulse Bridge Server] Message parse error:', err);
            }
          });

          ws.on('close', () => {
            this.tabs.delete(tabId);
            if (this.activeTabId === tabId) {
              const remaining = Array.from(this.tabs.keys());
              this.activeTabId = remaining.length > 0 ? remaining[remaining.length - 1] : null;
            }
          });

          ws.on('error', (err) => {
            console.error(`[DOMPulse Bridge Server] WebSocket error on tab ${tabId}:`, err.message);
          });
        });

        this.wss.on('error', (err) => {
          reject(err);
        });
      } catch (err) {
        reject(err);
      }
    });
  }

  public stop(): Promise<void> {
    return new Promise((resolve) => {
      for (const [id, req] of this.pendingRequests.entries()) {
        clearTimeout(req.timer);
        req.reject(new Error('Bridge server shutting down'));
      }
      this.pendingRequests.clear();

      if (this.wss) {
        this.wss.close(() => {
          this.wss = null;
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  public getStatus(): { connected: boolean; activeTab: { url: string; title: string; id: string } | null; totalTabs: number; port: number } {
    const active = this.activeTabId ? this.tabs.get(this.activeTabId) : null;
    return {
      connected: this.tabs.size > 0,
      activeTab: active ? { id: active.id, url: active.url, title: active.title } : null,
      totalTabs: this.tabs.size,
      port: this.port,
    };
  }

  public async sendCommand(action: string, params: Record<string, unknown> = {}, timeoutMs = 8000): Promise<any> {
    const active = this.activeTabId ? this.tabs.get(this.activeTabId) : null;
    if (!active || active.ws.readyState !== WebSocket.OPEN) {
      throw new Error(
        `No browser tab connected to DOM_X. Please ensure Chrome is open with the DOM_X extension loaded in developer mode (Bridge on ws://${this.host}:${this.port})`
      );
    }

    const id = `req-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const payload = JSON.stringify({ id, action, params });

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`DOM_X action "${action}" timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      this.pendingRequests.set(id, { resolve, reject, timer });
      active.ws.send(payload);
    });
  }

  public getMutations(limit = 20, clear = false): DOMPulseEvent[] {
    const result = this.mutationBuffer.slice(-limit);
    if (clear) {
      this.mutationBuffer = [];
    }
    return result;
  }

  public waitForMutation(predicate?: (evt: DOMPulseEvent) => boolean, timeoutMs = 5000): Promise<DOMPulseEvent> {
    return new Promise((resolve, reject) => {
      let resolved = false;

      const timer = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          this.mutationWaiters = this.mutationWaiters.filter((w) => w !== check);
          reject(new Error(`Timed out waiting for DOM mutation after ${timeoutMs}ms`));
        }
      }, timeoutMs);

      const check = (event: DOMPulseEvent): boolean => {
        if (resolved) return true;
        if (!predicate || predicate(event)) {
          resolved = true;
          clearTimeout(timer);
          resolve(event);
          return true; // remove from list
        }
        return false;
      };

      this.mutationWaiters.push(check);
    });
  }

  private handleClientMessage(tabId: string, msg: any): void {
    const session = this.tabs.get(tabId);
    if (session) {
      session.lastSeen = Date.now();
    }

    // Handle responses to sent commands
    if (msg.id && this.pendingRequests.has(msg.id)) {
      const pending = this.pendingRequests.get(msg.id)!;
      clearTimeout(pending.timer);
      this.pendingRequests.delete(msg.id);

      if (msg.success !== false) {
        pending.resolve(msg.result !== undefined ? msg.result : msg);
      } else {
        pending.reject(new Error(msg.message || 'Browser action failed'));
      }
      return;
    }

    // Handle notifications from tab
    if (msg.type === 'TAB_READY') {
      if (session) {
        session.url = msg.url || session.url;
        session.title = msg.title || session.title;
        console.error(`[DOM_X MCP Bridge] Active tab ready: "${session.title}" (${session.url})`);
      }
    } else if (msg.type === 'DOM_MUTATIONS' && Array.isArray(msg.events)) {
      for (const evt of msg.events) {
        this.mutationBuffer.push(evt);
        if (this.mutationBuffer.length > this.maxBufferSize) {
          this.mutationBuffer.shift();
        }

        // Notify mutation waiters
        this.mutationWaiters = this.mutationWaiters.filter((waiter) => !waiter(evt));
      }
    }
  }
}
