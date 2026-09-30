/**
 * DOMPulse MCP Bridge Server
 * Runs a unified HTTP REST + OpenAPI + WebSocket server connecting AI agents
 * (Claude Desktop, Cursor, ChatGPT Custom GPTs, Python/LangChain, REST clients)
 * to browser tabs via the DOM_X Chrome Extension.
 */

import { EventEmitter } from 'events';
import http from 'http';
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
  apiKey?: string;
  requireAuth?: boolean;
  allowedOrigins?: string[];
  maxPayloadBytes?: number;
  rateLimitWindowMs?: number;
  rateLimitMaxRequests?: number;
}

export class DOMPulseBridgeServer extends EventEmitter {
  private httpServer: http.Server | null = null;
  private wss: WebSocketServer | null = null;
  private port: number;
  private host: string;
  private tabs: Map<string, TabSession> = new Map();
  private activeTabId: string | null = null;
  private pendingRequests: Map<string, { resolve: (val: any) => void; reject: (err: any) => void; timer: NodeJS.Timeout }> = new Map();
  private mutationBuffer: DOMPulseEvent[] = [];
  private mutationWaiters: Array<(event: DOMPulseEvent) => boolean> = [];
  private maxBufferSize: number = 200;
  private heartbeatInterval: NodeJS.Timeout | null = null;

  // Security & Hardening Properties
  private apiKey: string | null = null;
  private requireAuth: boolean = false;
  private allowedOrigins: string[] = [];
  private maxPayloadBytes: number = 1024 * 1024; // 1MB
  private rateLimitWindowMs: number = 10000;
  private rateLimitMaxRequests: number = 150;
  private rateLimitMap: Map<string, { count: number; resetTime: number }> = new Map();

  constructor(options: BridgeServerOptions = {}) {
    super();
    this.port = options.port || Number(process.env.DOM_X_PORT || process.env.DOMPULSE_PORT) || 8765;
    this.host = options.host || '127.0.0.1';
    this.apiKey = options.apiKey || process.env.DOM_X_API_KEY || process.env.DOM_X_AUTH_TOKEN || null;
    this.requireAuth = options.requireAuth ?? Boolean(this.apiKey);
    this.allowedOrigins = options.allowedOrigins || [];
    if (options.maxPayloadBytes) this.maxPayloadBytes = options.maxPayloadBytes;
    if (options.rateLimitWindowMs) this.rateLimitWindowMs = options.rateLimitWindowMs;
    if (options.rateLimitMaxRequests) this.rateLimitMaxRequests = options.rateLimitMaxRequests;
  }

  private checkRateLimit(ip: string): boolean {
    const now = Date.now();
    const entry = this.rateLimitMap.get(ip);
    if (!entry || now > entry.resetTime) {
      this.rateLimitMap.set(ip, { count: 1, resetTime: now + this.rateLimitWindowMs });
      return true;
    }
    entry.count++;
    return entry.count <= this.rateLimitMaxRequests;
  }

  private authenticate(req: http.IncomingMessage, url: URL): boolean {
    if (!this.requireAuth && !this.apiKey) {
      return true;
    }
    const authHeader = req.headers.authorization;
    const tokenFromHeader = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;
    const customHeader = req.headers['x-api-key'];
    const tokenFromCustom = typeof customHeader === 'string' ? customHeader.trim() : null;
    const tokenFromQuery = url.searchParams.get('token') || url.searchParams.get('apiKey');
    const provided = tokenFromHeader || tokenFromCustom || tokenFromQuery;
    return Boolean(provided && provided === this.apiKey);
  }

  public start(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        // Create unified HTTP server (serves REST endpoints, OpenAPI spec, and WebSocket upgrade)
        this.httpServer = http.createServer((req, res) => this.handleHttpRequest(req, res));

        this.wss = new WebSocketServer({ server: this.httpServer });

        this.wss.on('connection', (ws, req) => {
          // Security: Validate WebSocket Origin & Authentication
          const host = req.headers.host || `${this.host}:${this.port}`;
          const wsUrl = new URL(req.url || '/', `http://${host}`);
          const origin = req.headers.origin;

          if (origin) {
            const isLocal =
              origin.startsWith('chrome-extension://') ||
              origin.startsWith('http://localhost') ||
              origin.startsWith('http://127.0.0.1') ||
              origin.startsWith('http://[::1]') ||
              this.allowedOrigins.includes(origin);

            if (!isLocal && !this.authenticate(req, wsUrl)) {
              ws.close(4403, 'Forbidden: Cross-origin WebSocket connection blocked by DOM_X security sandbox.');
              return;
            }
          }

          if (this.requireAuth && !this.authenticate(req, wsUrl)) {
            ws.close(4401, 'Unauthorized: Missing or invalid DOM_X API token.');
            return;
          }

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
          this.emit('tab_connected', session);

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
            this.emit('tab_disconnected', tabId);
          });

          ws.on('error', (err) => {
            console.error(`[DOMPulse Bridge Server] WebSocket error on tab ${tabId}:`, err.message);
          });
        });

        // Periodic heartbeat to clean up disconnected/hung tabs
        this.heartbeatInterval = setInterval(() => {
          const now = Date.now();
          for (const [id, session] of this.tabs.entries()) {
            if (session.ws.readyState !== WebSocket.OPEN) {
              this.tabs.delete(id);
              if (this.activeTabId === id) {
                const remaining = Array.from(this.tabs.keys());
                this.activeTabId = remaining.length > 0 ? remaining[remaining.length - 1] : null;
              }
              this.emit('tab_disconnected', id);
            } else if (now - session.lastSeen > 45000) {
              try {
                session.ws.ping();
              } catch {}
            }
          }
        }, 15000);

        this.httpServer.on('error', (err) => {
          reject(err);
        });

        this.httpServer.listen(this.port, this.host, () => {
          console.error(`[DOM_X Bridge] Server active on http://${this.host}:${this.port} (HTTP REST + OpenAPI + WebSocket)`);
          resolve();
        });
      } catch (err) {
        reject(err);
      }
    });
  }

  public stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.heartbeatInterval) {
        clearInterval(this.heartbeatInterval);
        this.heartbeatInterval = null;
      }

      for (const req of this.pendingRequests.values()) {
        clearTimeout(req.timer);
        req.reject(new Error('Bridge server shutting down'));
      }
      this.pendingRequests.clear();

      if (this.wss) {
        try {
          this.wss.close();
        } catch {}
        this.wss = null;
      }

      if (this.httpServer) {
        this.httpServer.close(() => {
          this.httpServer = null;
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
          return true;
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
        this.emit('tab_ready', session);
      }
    } else if (msg.type === 'DOM_MUTATIONS' && Array.isArray(msg.events)) {
      for (const evt of msg.events) {
        this.mutationBuffer.push(evt);
        if (this.mutationBuffer.length > this.maxBufferSize) {
          this.mutationBuffer.shift();
        }

        // Notify mutation waiters
        this.mutationWaiters = this.mutationWaiters.filter((waiter) => !waiter(evt));
        this.emit('mutation', evt);
      }
    }
  }

  // ─── HTTP REST & OpenAPI Dispatcher ────────────────────────

  private async handleHttpRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    // 1. Rate Limiting Protection
    const clientIp = (req.socket.remoteAddress || '127.0.0.1').replace('::ffff:', '');
    if (!this.checkRateLimit(clientIp)) {
      res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': '5' });
      res.end(JSON.stringify({ success: false, error: 'Too many requests. Rate limit exceeded.' }));
      return;
    }

    // 2. Strict Security Headers
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');

    const host = req.headers.host || `${this.host}:${this.port}`;
    const url = new URL(req.url || '/', `http://${host}`);
    const pathname = url.pathname.replace(/\/$/, '') || '/';
    const method = req.method?.toUpperCase();

    // 3. DNS Rebinding & Host Header Validation
    const rawHost = host.split(':')[0].toLowerCase();
    const isAllowedHost =
      rawHost === 'localhost' ||
      rawHost === '127.0.0.1' ||
      rawHost === '::1' ||
      rawHost === '[::1]' ||
      rawHost === '0.0.0.0' ||
      rawHost === this.host ||
      this.allowedOrigins.some((o) => o.includes(rawHost));

    if (!isAllowedHost) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: 'Forbidden: Invalid Host header. DNS rebinding protection active.' }));
      return;
    }

    // 4. Strict Origin & CORS Validation
    const origin = req.headers.origin;
    if (origin) {
      const isLocalOrigin =
        origin.startsWith('chrome-extension://') ||
        origin.startsWith('http://localhost') ||
        origin.startsWith('http://127.0.0.1') ||
        origin.startsWith('http://[::1]') ||
        this.allowedOrigins.includes(origin);

      if (!isLocalOrigin && !this.authenticate(req, url)) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            success: false,
            error: `Forbidden: Cross-origin request from origin "${origin}" is blocked by DOM_X security sandbox.`,
          })
        );
        return;
      }
      res.setHeader('Access-Control-Allow-Origin', origin);
    } else {
      res.setHeader('Access-Control-Allow-Origin', '*');
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-API-Key');

    if (method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const sendJson = (status: number, data: unknown) => {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(data, null, 2));
    };

    // 5. Authentication Verification for Protected API Endpoints
    if (this.requireAuth && pathname.startsWith('/api/') && pathname !== '/api/status' && !this.authenticate(req, url)) {
      sendJson(401, {
        success: false,
        error: 'Unauthorized: Missing or invalid DOM_X API token. Provide "Authorization: Bearer <token>" or "?token=<token>".',
      });
      return;
    }

    const readJsonBody = async (): Promise<Record<string, unknown>> => {
      return new Promise((resolve, reject) => {
        let body = '';
        let byteCount = 0;
        req.on('data', (chunk) => {
          byteCount += chunk.length;
          if (byteCount > this.maxPayloadBytes) {
            req.destroy();
            reject(new Error(`Payload too large. Maximum allowed size is ${this.maxPayloadBytes} bytes.`));
            return;
          }
          body += chunk;
        });
        req.on('end', () => {
          try {
            resolve(body ? JSON.parse(body) : {});
          } catch {
            resolve({});
          }
        });
        req.on('error', (err) => reject(err));
      });
    };

    try {
      // ── GET Endpoints ─────────────────────────────────────────

      if (method === 'GET' && pathname === '/') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(this.renderDashboardHtml());
        return;
      }

      if (method === 'GET' && (pathname === '/status' || pathname === '/api/status')) {
        sendJson(200, { success: true, ...this.getStatus() });
        return;
      }

      if (method === 'GET' && pathname === '/openapi.json') {
        sendJson(200, this.getOpenApiSpec());
        return;
      }

      if (method === 'GET' && (pathname === '/api/openai/tools' || pathname === '/openai/tools')) {
        sendJson(200, { tools: this.getOpenAITools() });
        return;
      }

      // ── POST VLM & Browser Action Endpoints ───────────────────

      if (method === 'POST') {
        const body = await readJsonBody();

        switch (pathname) {
          case '/api/vlm/perceive': {
            const result = await this.sendCommand('VLM_PERCEIVE', body);
            sendJson(200, { success: true, ...result });
            return;
          }

          case '/api/vlm/xml': {
            const result = await this.sendCommand('VLM_XML_PERCEIVE', body);
            // Return as application/xml when caller prefers it, JSON otherwise
            const acceptXml = (req.headers.accept || '').includes('application/xml');
            if (acceptXml) {
              res.writeHead(200, { 'Content-Type': 'application/xml; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
              res.end(result.xml || '');
            } else {
              sendJson(200, { success: true, ...result });
            }
            return;
          }

          case '/api/vlm/locate': {
            const query = String(body.query || url.searchParams.get('q') || '');
            if (!query) {
              sendJson(400, { success: false, message: 'Missing "query" parameter in JSON body' });
              return;
            }
            const topK = typeof body.topK === 'number' ? body.topK : 3;
            const result = await this.sendCommand('VLM_LOCATE', { ...body, query, topK });
            sendJson(200, { success: true, ...result });
            return;
          }

          case '/api/vlm/describe': {
            const result = await this.sendCommand('VLM_DESCRIBE', body);
            sendJson(200, { success: true, ...result });
            return;
          }

          case '/api/action/click': {
            const target = String(body.target || '');
            if (!target) {
              sendJson(400, { success: false, message: 'Missing "target" parameter (@e1, selector)' });
              return;
            }
            const result = await this.sendCommand('CLICK', { target });
            sendJson(200, result);
            return;
          }

          case '/api/action/type': {
            const target = String(body.target || '');
            const text = String(body.text || '');
            if (!target) {
              sendJson(400, { success: false, message: 'Missing "target" parameter' });
              return;
            }
            const result = await this.sendCommand('TYPE', {
              target,
              text,
              clearFirst: Boolean(body.clearFirst),
              pressEnter: Boolean(body.pressEnter),
            });
            sendJson(200, result);
            return;
          }

          case '/api/action/scroll': {
            const direction = String(body.direction || 'down');
            const amount = Number(body.amount) || 400;
            const target = body.target ? String(body.target) : undefined;
            const result = await this.sendCommand('SCROLL', { direction, amount, target });
            sendJson(200, result);
            return;
          }

          case '/api/action/navigate': {
            const targetUrl = String(body.url || '');
            if (!targetUrl) {
              sendJson(400, { success: false, message: 'Missing "url" parameter' });
              return;
            }
            const result = await this.sendCommand('NAVIGATE', { url: targetUrl });
            sendJson(200, result);
            return;
          }

          default:
            sendJson(404, { success: false, message: `Route not found: POST ${pathname}` });
            return;
        }
      }

      sendJson(404, { success: false, message: `Route not found: ${method} ${pathname}` });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      const status = message.includes('Payload too large') ? 413 : 503;
      sendJson(status, { success: false, message });
    }
  }

  // ─── OpenAPI 3.1.0 Specification (for ChatGPT Custom GPT Actions) ──

  public getOpenApiSpec(): Record<string, unknown> {
    return {
      openapi: '3.1.0',
      info: {
        title: 'DOM_X Zero-Cost DOM-VLM API',
        version: '1.2.0',
        description:
          'Transforms any browser DOM into a zero-cost Visual Language Model (VLM). Perceive web pages visually, locate elements by natural language, and click/type targets without GPU or screenshot costs. Plug directly into ChatGPT Custom GPT Actions, LangChain, AutoGPT, or REST agents.',
      },
      servers: [
        {
          url: `http://${this.host}:${this.port}`,
          description: 'Local DOM_X Bridge Server',
        },
      ],
      paths: {
        '/api/status': {
          get: {
            operationId: 'getBrowserStatus',
            summary: 'Check browser connection status',
            responses: {
              '200': {
                description: 'Active tab info and connection state',
                content: { 'application/json': { schema: { type: 'object' } } },
              },
            },
          },
        },
        '/api/vlm/perceive': {
          post: {
            operationId: 'vlmPerceive',
            summary: 'Visual scene perception (zero-cost VLM replacement for screenshots)',
            description:
              'Returns spatial layout zones, semantic element groups (Navbar, Form, Modal), bounding boxes, exact pixel click coordinates, and an LLM-ready scene description. Cost: $0.00.',
            responses: {
              '200': {
                description: 'Structured visual scene output',
                content: { 'application/json': { schema: { type: 'object' } } },
              },
            },
          },
        },
        '/api/vlm/xml': {
          post: {
            operationId: 'vlmPerceiveXml',
            summary: 'XML scene perception — structured DOM tree with bounding boxes for AI agent communication',
            description:
              'Returns the full page DOM as structured XML including bounding boxes (x, y, width, height, centerX, centerY), spatial region, role/kind, state flags (disabled, checked, expanded, focused, value, href), and grouped layout sections. Use instead of a screenshot. Cost: $0.00.',
            requestBody: {
              required: false,
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      forceRefresh: { type: 'boolean', default: false, description: 'Force re-scan even if cache is fresh' },
                    },
                  },
                },
              },
            },
            responses: {
              '200': {
                description: 'XML DOM-VLM scene with bbox, region, state, and action targets',
                content: {
                  'application/json': { schema: { type: 'object', properties: { xml: { type: 'string' } } } },
                  'application/xml': { schema: { type: 'string' } },
                },
              },
            },
          },
        },
        '/api/vlm/locate': {
          post: {
            operationId: 'vlmLocate',
            summary: 'Locate webpage elements using plain natural language',
            description:
              'Finds elements matching a plain English query (e.g. "search input", "sign in button", "accept cookies"). Returns action tags (@e1, @e2) and confidence scores.',
            requestBody: {
              required: true,
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['query'],
                    properties: {
                      query: { type: 'string', description: 'Natural language description of the target element' },
                      topK: { type: 'integer', default: 3, description: 'Max number of candidate matches' },
                    },
                  },
                },
              },
            },
            responses: {
              '200': {
                description: 'Ranked element matches with confidence and coordinates',
                content: { 'application/json': { schema: { type: 'object' } } },
              },
            },
          },
        },
        '/api/vlm/describe': {
          post: {
            operationId: 'vlmDescribe',
            summary: 'Get compact natural language description of current viewport for LLM prompt',
            responses: {
              '200': {
                description: 'LLM-ready text description of the visual scene',
                content: { 'application/json': { schema: { type: 'object' } } },
              },
            },
          },
        },
        '/api/action/click': {
          post: {
            operationId: 'browserClick',
            summary: 'Click an element on the webpage by @eX tag or CSS selector',
            requestBody: {
              required: true,
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['target'],
                    properties: {
                      target: { type: 'string', description: 'Action tag (@e1, @e2) or CSS selector' },
                    },
                  },
                },
              },
            },
            responses: {
              '200': {
                description: 'Action execution result',
                content: { 'application/json': { schema: { type: 'object' } } },
              },
            },
          },
        },
        '/api/action/type': {
          post: {
            operationId: 'browserType',
            summary: 'Type text into an input or textarea element',
            requestBody: {
              required: true,
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['target', 'text'],
                    properties: {
                      target: { type: 'string', description: 'Action tag (@e1, @e2) or CSS selector' },
                      text: { type: 'string', description: 'Text to type into element' },
                      pressEnter: { type: 'boolean', default: false, description: 'Press Enter key after typing' },
                      clearFirst: { type: 'boolean', default: false, description: 'Clear existing value first' },
                    },
                  },
                },
              },
            },
            responses: {
              '200': {
                description: 'Action execution result',
                content: { 'application/json': { schema: { type: 'object' } } },
              },
            },
          },
        },
        '/api/action/scroll': {
          post: {
            operationId: 'browserScroll',
            summary: 'Scroll the active browser viewport',
            requestBody: {
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      direction: { type: 'string', enum: ['up', 'down', 'top', 'bottom', 'element'], default: 'down' },
                      amount: { type: 'integer', default: 400, description: 'Pixel distance to scroll' },
                      target: { type: 'string', description: 'Target element to scroll into view' },
                    },
                  },
                },
              },
            },
            responses: {
              '200': {
                description: 'Action execution result',
                content: { 'application/json': { schema: { type: 'object' } } },
              },
            },
          },
        },
        '/api/action/navigate': {
          post: {
            operationId: 'browserNavigate',
            summary: 'Navigate active browser tab to a new URL',
            requestBody: {
              required: true,
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['url'],
                    properties: {
                      url: { type: 'string', description: 'Full URL to navigate to (e.g. https://google.com)' },
                    },
                  },
                },
              },
            },
            responses: {
              '200': {
                description: 'Action execution result',
                content: { 'application/json': { schema: { type: 'object' } } },
              },
            },
          },
        },
      },
    };
  }

  // ─── OpenAI Tools Schema (for Python / OpenAI Function Calling) ─────

  public getOpenAITools(): Array<Record<string, unknown>> {
    return [
      {
        type: 'function',
        function: {
          name: 'vlm_perceive',
          description:
            'Perceives active webpage visually without screenshots. Returns spatial regions, semantic groups (Navbar, Form, Modal), action IDs (@e1, @e2...), bounding boxes, and an LLM-ready text description. Cost: $0.00.',
          parameters: { type: 'object', properties: {} },
        },
      },
      {
        type: 'function',
        function: {
          name: 'vlm_locate',
          description:
            'Finds elements matching a plain English description (e.g. "search input", "sign in button", "checkout"). Returns action tag (@eX), exact coordinates, and confidence score.',
          parameters: {
            type: 'object',
            required: ['query'],
            properties: {
              query: { type: 'string', description: 'Natural language query for the target element' },
              topK: { type: 'integer', default: 3, description: 'Max candidate matches' },
            },
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'vlm_describe',
          description: 'Generates a clean text description of the visible webpage for LLM reasoning.',
          parameters: { type: 'object', properties: {} },
        },
      },
      {
        type: 'function',
        function: {
          name: 'browser_click',
          description: 'Clicks an element on the active page by action tag (@e1, @e2) or CSS selector.',
          parameters: {
            type: 'object',
            required: ['target'],
            properties: {
              target: { type: 'string', description: 'Action tag (@e1) or CSS selector' },
            },
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'browser_type',
          description: 'Types text into an input field or textarea on the active page.',
          parameters: {
            type: 'object',
            required: ['target', 'text'],
            properties: {
              target: { type: 'string', description: 'Action tag (@e1) or CSS selector' },
              text: { type: 'string', description: 'Text to type' },
              pressEnter: { type: 'boolean', default: false, description: 'Press Enter key after typing' },
              clearFirst: { type: 'boolean', default: false, description: 'Clear existing text before typing' },
            },
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'browser_scroll',
          description: 'Scrolls the active browser tab.',
          parameters: {
            type: 'object',
            properties: {
              direction: { type: 'string', enum: ['up', 'down', 'top', 'bottom', 'element'], default: 'down' },
              amount: { type: 'integer', default: 400, description: 'Pixel distance to scroll' },
            },
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'browser_navigate',
          description: 'Navigates browser tab to a new URL.',
          parameters: {
            type: 'object',
            required: ['url'],
            properties: {
              url: { type: 'string', description: 'Full URL (e.g. https://github.com)' },
            },
          },
        },
      },
    ];
  }

  // ─── Web Dashboard HTML ─────────────────────────────────────

  private renderDashboardHtml(): string {
    const status = this.getStatus();
    const tabTitle = status.activeTab ? status.activeTab.title : 'No tab connected';
    const tabUrl = status.activeTab ? status.activeTab.url : 'Open Chrome with DOM_X extension loaded';

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>DOM_X — Zero-Cost DOM-VLM Bridge</title>
  <style>
    :root {
      --bg: #090d16;
      --card: #111827;
      --border: #1f2937;
      --primary: #38bdf8;
      --accent: #10b981;
      --text: #f3f4f6;
      --muted: #9ca3af;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: var(--bg);
      color: var(--text);
      margin: 0;
      padding: 2rem;
      line-height: 1.5;
    }
    .container { max-width: 860px; margin: 0 auto; }
    header { border-bottom: 1px solid var(--border); padding-bottom: 1.5rem; margin-bottom: 2rem; }
    h1 { color: var(--primary); margin: 0 0 0.5rem 0; font-size: 1.8rem; display: flex; align-items: center; gap: 0.5rem; }
    .badge { background: rgba(56, 189, 248, 0.15); color: var(--primary); padding: 2px 8px; border-radius: 4px; font-size: 0.8rem; }
    .status-card {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 1.25rem;
      margin-bottom: 2rem;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .status-dot {
      display: inline-block;
      width: 10px;
      height: 10px;
      border-radius: 50%;
      background: ${status.connected ? 'var(--accent)' : '#ef4444'};
      margin-right: 6px;
    }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 1.5rem; }
    .card {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 1.25rem;
    }
    h2 { font-size: 1.1rem; color: var(--text); margin: 0 0 0.75rem 0; }
    pre {
      background: #000;
      padding: 0.75rem;
      border-radius: 6px;
      overflow-x: auto;
      font-size: 0.85rem;
      color: #34d399;
      margin: 0.5rem 0 0 0;
    }
    a { color: var(--primary); text-decoration: none; }
    a:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <h1>DOM_X <span class="badge">DOM-VLM Engine v1.2</span></h1>
      <p style="color: var(--muted); margin: 0;">Zero-cost, zero-latency Visual Language Model replacement grounded entirely in the DOM.</p>
    </header>

    <div class="status-card">
      <div>
        <div style="font-weight: 600; margin-bottom: 4px;">
          <span class="status-dot"></span> ${status.connected ? 'Browser Tab Connected' : 'Waiting for Browser Tab'}
        </div>
        <div style="color: var(--muted); font-size: 0.9rem;">
          ${tabTitle} (${tabUrl})
        </div>
      </div>
      <div>
        <a href="/openapi.json" style="background: var(--primary); color: #000; font-weight: 600; padding: 6px 12px; border-radius: 6px; font-size: 0.85rem;">
          View OpenAPI Spec
        </a>
      </div>
    </div>

    <div class="grid">
      <div class="card">
        <h2>🤖 Plug into ChatGPT (Custom GPT)</h2>
        <p style="color: var(--muted); font-size: 0.9rem; margin-top: 0;">Add DOM_X to any Custom GPT with 1 click:</p>
        <ol style="color: var(--muted); font-size: 0.85rem; padding-left: 1.2rem; margin: 0;">
          <li>In ChatGPT, create or edit a <strong>Custom GPT</strong>.</li>
          <li>Click <strong>Configure</strong> &rarr; <strong>Create new action</strong>.</li>
          <li>Click <strong>Import from URL</strong> and paste:</li>
        </ol>
        <pre>http://127.0.0.1:${this.port}/openapi.json</pre>
      </div>

      <div class="card">
        <h2>🐍 Plug into Python / LangChain</h2>
        <p style="color: var(--muted); font-size: 0.9rem; margin-top: 0;">Query DOM-VLM with 2 lines of Python:</p>
        <pre>import requests

# Locate element by plain English
res = requests.post("http://127.0.0.1:${this.port}/api/vlm/locate",
  json={"query": "sign in button"}).json()

print(res["matches"][0]["element"]["actionId"]) # @e3</pre>
      </div>
    </div>
  </div>
</body>
</html>`;
  }
}
