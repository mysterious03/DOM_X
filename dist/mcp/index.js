#!/usr/bin/env node
var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ListToolsRequestSchema, CallToolRequestSchema, McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { EventEmitter } from "events";
import http from "http";
import { WebSocketServer, WebSocket } from "ws";
class DOMPulseBridgeServer extends EventEmitter {
  constructor(options = {}) {
    super();
    __publicField(this, "httpServer", null);
    __publicField(this, "wss", null);
    __publicField(this, "port");
    __publicField(this, "host");
    __publicField(this, "tabs", /* @__PURE__ */ new Map());
    __publicField(this, "activeTabId", null);
    __publicField(this, "pendingRequests", /* @__PURE__ */ new Map());
    __publicField(this, "mutationBuffer", []);
    __publicField(this, "mutationWaiters", []);
    __publicField(this, "maxBufferSize", 200);
    __publicField(this, "heartbeatInterval", null);
    // Security & Hardening Properties
    __publicField(this, "apiKey", null);
    __publicField(this, "requireAuth", false);
    __publicField(this, "allowedOrigins", []);
    __publicField(this, "maxPayloadBytes", 1024 * 1024);
    // 1MB
    __publicField(this, "rateLimitWindowMs", 1e4);
    __publicField(this, "rateLimitMaxRequests", 150);
    __publicField(this, "rateLimitMap", /* @__PURE__ */ new Map());
    this.port = options.port || Number(process.env.DOM_X_PORT || process.env.DOMPULSE_PORT) || 8765;
    this.host = options.host || "127.0.0.1";
    this.apiKey = options.apiKey || process.env.DOM_X_API_KEY || process.env.DOM_X_AUTH_TOKEN || null;
    this.requireAuth = options.requireAuth ?? Boolean(this.apiKey);
    this.allowedOrigins = options.allowedOrigins || [];
    if (options.maxPayloadBytes) this.maxPayloadBytes = options.maxPayloadBytes;
    if (options.rateLimitWindowMs) this.rateLimitWindowMs = options.rateLimitWindowMs;
    if (options.rateLimitMaxRequests) this.rateLimitMaxRequests = options.rateLimitMaxRequests;
  }
  checkRateLimit(ip) {
    const now = Date.now();
    const entry = this.rateLimitMap.get(ip);
    if (!entry || now > entry.resetTime) {
      this.rateLimitMap.set(ip, { count: 1, resetTime: now + this.rateLimitWindowMs });
      return true;
    }
    entry.count++;
    return entry.count <= this.rateLimitMaxRequests;
  }
  authenticate(req, url) {
    if (!this.requireAuth && !this.apiKey) {
      return true;
    }
    const authHeader = req.headers.authorization;
    const tokenFromHeader = (authHeader == null ? void 0 : authHeader.startsWith("Bearer ")) ? authHeader.slice(7).trim() : null;
    const customHeader = req.headers["x-api-key"];
    const tokenFromCustom = typeof customHeader === "string" ? customHeader.trim() : null;
    const tokenFromQuery = url.searchParams.get("token") || url.searchParams.get("apiKey");
    const provided = tokenFromHeader || tokenFromCustom || tokenFromQuery;
    return Boolean(provided && provided === this.apiKey);
  }
  start() {
    return new Promise((resolve, reject) => {
      try {
        this.httpServer = http.createServer((req, res) => this.handleHttpRequest(req, res));
        this.wss = new WebSocketServer({ server: this.httpServer });
        this.wss.on("connection", (ws, req) => {
          const host = req.headers.host || `${this.host}:${this.port}`;
          const wsUrl = new URL(req.url || "/", `http://${host}`);
          const origin = req.headers.origin;
          if (origin) {
            const isLocal = origin.startsWith("chrome-extension://") || origin.startsWith("http://localhost") || origin.startsWith("http://127.0.0.1") || origin.startsWith("http://[::1]") || this.allowedOrigins.includes(origin);
            if (!isLocal && !this.authenticate(req, wsUrl)) {
              ws.close(4403, "Forbidden: Cross-origin WebSocket connection blocked by DOM_X security sandbox.");
              return;
            }
          }
          if (this.requireAuth && !this.authenticate(req, wsUrl)) {
            ws.close(4401, "Unauthorized: Missing or invalid DOM_X API token.");
            return;
          }
          const tabId = `tab-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
          const session = {
            id: tabId,
            ws,
            url: "about:blank",
            title: "Connecting...",
            connectedAt: Date.now(),
            lastSeen: Date.now()
          };
          this.tabs.set(tabId, session);
          this.activeTabId = tabId;
          this.emit("tab_connected", session);
          ws.on("message", (raw) => {
            try {
              const msg = JSON.parse(raw.toString());
              this.handleClientMessage(tabId, msg);
            } catch (err) {
              console.error("[DOMPulse Bridge Server] Message parse error:", err);
            }
          });
          ws.on("close", () => {
            this.tabs.delete(tabId);
            if (this.activeTabId === tabId) {
              const remaining = Array.from(this.tabs.keys());
              this.activeTabId = remaining.length > 0 ? remaining[remaining.length - 1] : null;
            }
            this.emit("tab_disconnected", tabId);
          });
          ws.on("error", (err) => {
            console.error(`[DOMPulse Bridge Server] WebSocket error on tab ${tabId}:`, err.message);
          });
        });
        this.heartbeatInterval = setInterval(() => {
          const now = Date.now();
          for (const [id, session] of this.tabs.entries()) {
            if (session.ws.readyState !== WebSocket.OPEN) {
              this.tabs.delete(id);
              if (this.activeTabId === id) {
                const remaining = Array.from(this.tabs.keys());
                this.activeTabId = remaining.length > 0 ? remaining[remaining.length - 1] : null;
              }
              this.emit("tab_disconnected", id);
            } else if (now - session.lastSeen > 45e3) {
              try {
                session.ws.ping();
              } catch {
              }
            }
          }
        }, 15e3);
        this.httpServer.on("error", (err) => {
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
  stop() {
    return new Promise((resolve) => {
      if (this.heartbeatInterval) {
        clearInterval(this.heartbeatInterval);
        this.heartbeatInterval = null;
      }
      for (const req of this.pendingRequests.values()) {
        clearTimeout(req.timer);
        req.reject(new Error("Bridge server shutting down"));
      }
      this.pendingRequests.clear();
      if (this.wss) {
        try {
          this.wss.close();
        } catch {
        }
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
  getStatus() {
    const active = this.activeTabId ? this.tabs.get(this.activeTabId) : null;
    return {
      connected: this.tabs.size > 0,
      activeTab: active ? { id: active.id, url: active.url, title: active.title } : null,
      totalTabs: this.tabs.size,
      port: this.port
    };
  }
  async sendCommand(action, params = {}, timeoutMs = 8e3) {
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
  getMutations(limit = 20, clear = false) {
    const result = this.mutationBuffer.slice(-limit);
    if (clear) {
      this.mutationBuffer = [];
    }
    return result;
  }
  waitForMutation(predicate, timeoutMs = 5e3) {
    return new Promise((resolve, reject) => {
      let resolved = false;
      const timer = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          this.mutationWaiters = this.mutationWaiters.filter((w) => w !== check);
          reject(new Error(`Timed out waiting for DOM mutation after ${timeoutMs}ms`));
        }
      }, timeoutMs);
      const check = (event) => {
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
  handleClientMessage(tabId, msg) {
    const session = this.tabs.get(tabId);
    if (session) {
      session.lastSeen = Date.now();
    }
    if (msg.id && this.pendingRequests.has(msg.id)) {
      const pending = this.pendingRequests.get(msg.id);
      clearTimeout(pending.timer);
      this.pendingRequests.delete(msg.id);
      if (msg.success !== false) {
        pending.resolve(msg.result !== void 0 ? msg.result : msg);
      } else {
        pending.reject(new Error(msg.message || "Browser action failed"));
      }
      return;
    }
    if (msg.type === "TAB_READY") {
      if (session) {
        session.url = msg.url || session.url;
        session.title = msg.title || session.title;
        console.error(`[DOM_X MCP Bridge] Active tab ready: "${session.title}" (${session.url})`);
        this.emit("tab_ready", session);
      }
    } else if (msg.type === "DOM_MUTATIONS" && Array.isArray(msg.events)) {
      for (const evt of msg.events) {
        this.mutationBuffer.push(evt);
        if (this.mutationBuffer.length > this.maxBufferSize) {
          this.mutationBuffer.shift();
        }
        this.mutationWaiters = this.mutationWaiters.filter((waiter) => !waiter(evt));
        this.emit("mutation", evt);
      }
    }
  }
  // ─── HTTP REST & OpenAPI Dispatcher ────────────────────────
  async handleHttpRequest(req, res) {
    var _a;
    const clientIp = (req.socket.remoteAddress || "127.0.0.1").replace("::ffff:", "");
    if (!this.checkRateLimit(clientIp)) {
      res.writeHead(429, { "Content-Type": "application/json", "Retry-After": "5" });
      res.end(JSON.stringify({ success: false, error: "Too many requests. Rate limit exceeded." }));
      return;
    }
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "no-referrer");
    const host = req.headers.host || `${this.host}:${this.port}`;
    const url = new URL(req.url || "/", `http://${host}`);
    const pathname = url.pathname.replace(/\/$/, "") || "/";
    const method = (_a = req.method) == null ? void 0 : _a.toUpperCase();
    const rawHost = host.split(":")[0].toLowerCase();
    const isAllowedHost = rawHost === "localhost" || rawHost === "127.0.0.1" || rawHost === "::1" || rawHost === "[::1]" || rawHost === "0.0.0.0" || rawHost === this.host || this.allowedOrigins.some((o) => o.includes(rawHost));
    if (!isAllowedHost) {
      res.writeHead(403, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ success: false, error: "Forbidden: Invalid Host header. DNS rebinding protection active." }));
      return;
    }
    const origin = req.headers.origin;
    if (origin) {
      const isLocalOrigin = origin.startsWith("chrome-extension://") || origin.startsWith("http://localhost") || origin.startsWith("http://127.0.0.1") || origin.startsWith("http://[::1]") || this.allowedOrigins.includes(origin);
      if (!isLocalOrigin && !this.authenticate(req, url)) {
        res.writeHead(403, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            success: false,
            error: `Forbidden: Cross-origin request from origin "${origin}" is blocked by DOM_X security sandbox.`
          })
        );
        return;
      }
      res.setHeader("Access-Control-Allow-Origin", origin);
    } else {
      res.setHeader("Access-Control-Allow-Origin", "*");
    }
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-API-Key");
    if (method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }
    const sendJson = (status, data) => {
      res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify(data, null, 2));
    };
    if (this.requireAuth && pathname.startsWith("/api/") && pathname !== "/api/status" && !this.authenticate(req, url)) {
      sendJson(401, {
        success: false,
        error: 'Unauthorized: Missing or invalid DOM_X API token. Provide "Authorization: Bearer <token>" or "?token=<token>".'
      });
      return;
    }
    const readJsonBody = async () => {
      return new Promise((resolve, reject) => {
        let body = "";
        let byteCount = 0;
        req.on("data", (chunk) => {
          byteCount += chunk.length;
          if (byteCount > this.maxPayloadBytes) {
            req.destroy();
            reject(new Error(`Payload too large. Maximum allowed size is ${this.maxPayloadBytes} bytes.`));
            return;
          }
          body += chunk;
        });
        req.on("end", () => {
          try {
            resolve(body ? JSON.parse(body) : {});
          } catch {
            resolve({});
          }
        });
        req.on("error", (err) => reject(err));
      });
    };
    try {
      if (method === "GET" && pathname === "/") {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(this.renderDashboardHtml());
        return;
      }
      if (method === "GET" && (pathname === "/status" || pathname === "/api/status")) {
        sendJson(200, { success: true, ...this.getStatus() });
        return;
      }
      if (method === "GET" && pathname === "/openapi.json") {
        sendJson(200, this.getOpenApiSpec());
        return;
      }
      if (method === "GET" && (pathname === "/api/openai/tools" || pathname === "/openai/tools")) {
        sendJson(200, { tools: this.getOpenAITools() });
        return;
      }
      if (method === "POST") {
        const body = await readJsonBody();
        switch (pathname) {
          case "/api/vlm/perceive": {
            const result = await this.sendCommand("VLM_PERCEIVE", body);
            sendJson(200, { success: true, ...result });
            return;
          }
          case "/api/vlm/xml": {
            const result = await this.sendCommand("VLM_XML_PERCEIVE", body);
            const acceptXml = (req.headers.accept || "").includes("application/xml");
            if (acceptXml) {
              res.writeHead(200, { "Content-Type": "application/xml; charset=utf-8", "Access-Control-Allow-Origin": "*" });
              res.end(result.xml || "");
            } else {
              sendJson(200, { success: true, ...result });
            }
            return;
          }
          case "/api/vlm/locate": {
            const query = String(body.query || url.searchParams.get("q") || "");
            if (!query) {
              sendJson(400, { success: false, message: 'Missing "query" parameter in JSON body' });
              return;
            }
            const topK = typeof body.topK === "number" ? body.topK : 3;
            const result = await this.sendCommand("VLM_LOCATE", { ...body, query, topK });
            sendJson(200, { success: true, ...result });
            return;
          }
          case "/api/vlm/describe": {
            const result = await this.sendCommand("VLM_DESCRIBE", body);
            sendJson(200, { success: true, ...result });
            return;
          }
          case "/api/action/click": {
            const target = String(body.target || "");
            if (!target) {
              sendJson(400, { success: false, message: 'Missing "target" parameter (@e1, selector)' });
              return;
            }
            const result = await this.sendCommand("CLICK", { target });
            sendJson(200, result);
            return;
          }
          case "/api/action/type": {
            const target = String(body.target || "");
            const text = String(body.text || "");
            if (!target) {
              sendJson(400, { success: false, message: 'Missing "target" parameter' });
              return;
            }
            const result = await this.sendCommand("TYPE", {
              target,
              text,
              clearFirst: Boolean(body.clearFirst),
              pressEnter: Boolean(body.pressEnter)
            });
            sendJson(200, result);
            return;
          }
          case "/api/action/scroll": {
            const direction = String(body.direction || "down");
            const amount = Number(body.amount) || 400;
            const target = body.target ? String(body.target) : void 0;
            const result = await this.sendCommand("SCROLL", { direction, amount, target });
            sendJson(200, result);
            return;
          }
          case "/api/action/navigate": {
            const targetUrl = String(body.url || "");
            if (!targetUrl) {
              sendJson(400, { success: false, message: 'Missing "url" parameter' });
              return;
            }
            const result = await this.sendCommand("NAVIGATE", { url: targetUrl });
            sendJson(200, result);
            return;
          }
          default:
            sendJson(404, { success: false, message: `Route not found: POST ${pathname}` });
            return;
        }
      }
      sendJson(404, { success: false, message: `Route not found: ${method} ${pathname}` });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const status = message.includes("Payload too large") ? 413 : 503;
      sendJson(status, { success: false, message });
    }
  }
  // ─── OpenAPI 3.1.0 Specification (for ChatGPT Custom GPT Actions) ──
  getOpenApiSpec() {
    return {
      openapi: "3.1.0",
      info: {
        title: "DOM_X Zero-Cost DOM-VLM API",
        version: "1.2.0",
        description: "Transforms any browser DOM into a zero-cost Visual Language Model (VLM). Perceive web pages visually, locate elements by natural language, and click/type targets without GPU or screenshot costs. Plug directly into ChatGPT Custom GPT Actions, LangChain, AutoGPT, or REST agents."
      },
      servers: [
        {
          url: `http://${this.host}:${this.port}`,
          description: "Local DOM_X Bridge Server"
        }
      ],
      paths: {
        "/api/status": {
          get: {
            operationId: "getBrowserStatus",
            summary: "Check browser connection status",
            responses: {
              "200": {
                description: "Active tab info and connection state",
                content: { "application/json": { schema: { type: "object" } } }
              }
            }
          }
        },
        "/api/vlm/perceive": {
          post: {
            operationId: "vlmPerceive",
            summary: "Visual scene perception (zero-cost VLM replacement for screenshots)",
            description: "Returns spatial layout zones, semantic element groups (Navbar, Form, Modal), bounding boxes, exact pixel click coordinates, and an LLM-ready scene description. Cost: $0.00.",
            responses: {
              "200": {
                description: "Structured visual scene output",
                content: { "application/json": { schema: { type: "object" } } }
              }
            }
          }
        },
        "/api/vlm/xml": {
          post: {
            operationId: "vlmPerceiveXml",
            summary: "XML scene perception — structured DOM tree with bounding boxes for AI agent communication",
            description: "Returns the full page DOM as structured XML including bounding boxes (x, y, width, height, centerX, centerY), spatial region, role/kind, state flags (disabled, checked, expanded, focused, value, href), and grouped layout sections. Use instead of a screenshot. Cost: $0.00.",
            requestBody: {
              required: false,
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      forceRefresh: { type: "boolean", default: false, description: "Force re-scan even if cache is fresh" }
                    }
                  }
                }
              }
            },
            responses: {
              "200": {
                description: "XML DOM-VLM scene with bbox, region, state, and action targets",
                content: {
                  "application/json": { schema: { type: "object", properties: { xml: { type: "string" } } } },
                  "application/xml": { schema: { type: "string" } }
                }
              }
            }
          }
        },
        "/api/vlm/locate": {
          post: {
            operationId: "vlmLocate",
            summary: "Locate webpage elements using plain natural language",
            description: 'Finds elements matching a plain English query (e.g. "search input", "sign in button", "accept cookies"). Returns action tags (@e1, @e2) and confidence scores.',
            requestBody: {
              required: true,
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    required: ["query"],
                    properties: {
                      query: { type: "string", description: "Natural language description of the target element" },
                      topK: { type: "integer", default: 3, description: "Max number of candidate matches" }
                    }
                  }
                }
              }
            },
            responses: {
              "200": {
                description: "Ranked element matches with confidence and coordinates",
                content: { "application/json": { schema: { type: "object" } } }
              }
            }
          }
        },
        "/api/vlm/describe": {
          post: {
            operationId: "vlmDescribe",
            summary: "Get compact natural language description of current viewport for LLM prompt",
            responses: {
              "200": {
                description: "LLM-ready text description of the visual scene",
                content: { "application/json": { schema: { type: "object" } } }
              }
            }
          }
        },
        "/api/action/click": {
          post: {
            operationId: "browserClick",
            summary: "Click an element on the webpage by @eX tag or CSS selector",
            requestBody: {
              required: true,
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    required: ["target"],
                    properties: {
                      target: { type: "string", description: "Action tag (@e1, @e2) or CSS selector" }
                    }
                  }
                }
              }
            },
            responses: {
              "200": {
                description: "Action execution result",
                content: { "application/json": { schema: { type: "object" } } }
              }
            }
          }
        },
        "/api/action/type": {
          post: {
            operationId: "browserType",
            summary: "Type text into an input or textarea element",
            requestBody: {
              required: true,
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    required: ["target", "text"],
                    properties: {
                      target: { type: "string", description: "Action tag (@e1, @e2) or CSS selector" },
                      text: { type: "string", description: "Text to type into element" },
                      pressEnter: { type: "boolean", default: false, description: "Press Enter key after typing" },
                      clearFirst: { type: "boolean", default: false, description: "Clear existing value first" }
                    }
                  }
                }
              }
            },
            responses: {
              "200": {
                description: "Action execution result",
                content: { "application/json": { schema: { type: "object" } } }
              }
            }
          }
        },
        "/api/action/scroll": {
          post: {
            operationId: "browserScroll",
            summary: "Scroll the active browser viewport",
            requestBody: {
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      direction: { type: "string", enum: ["up", "down", "top", "bottom", "element"], default: "down" },
                      amount: { type: "integer", default: 400, description: "Pixel distance to scroll" },
                      target: { type: "string", description: "Target element to scroll into view" }
                    }
                  }
                }
              }
            },
            responses: {
              "200": {
                description: "Action execution result",
                content: { "application/json": { schema: { type: "object" } } }
              }
            }
          }
        },
        "/api/action/navigate": {
          post: {
            operationId: "browserNavigate",
            summary: "Navigate active browser tab to a new URL",
            requestBody: {
              required: true,
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    required: ["url"],
                    properties: {
                      url: { type: "string", description: "Full URL to navigate to (e.g. https://google.com)" }
                    }
                  }
                }
              }
            },
            responses: {
              "200": {
                description: "Action execution result",
                content: { "application/json": { schema: { type: "object" } } }
              }
            }
          }
        }
      }
    };
  }
  // ─── OpenAI Tools Schema (for Python / OpenAI Function Calling) ─────
  getOpenAITools() {
    return [
      {
        type: "function",
        function: {
          name: "vlm_perceive",
          description: "Perceives active webpage visually without screenshots. Returns spatial regions, semantic groups (Navbar, Form, Modal), action IDs (@e1, @e2...), bounding boxes, and an LLM-ready text description. Cost: $0.00.",
          parameters: { type: "object", properties: {} }
        }
      },
      {
        type: "function",
        function: {
          name: "vlm_locate",
          description: 'Finds elements matching a plain English description (e.g. "search input", "sign in button", "checkout"). Returns action tag (@eX), exact coordinates, and confidence score.',
          parameters: {
            type: "object",
            required: ["query"],
            properties: {
              query: { type: "string", description: "Natural language query for the target element" },
              topK: { type: "integer", default: 3, description: "Max candidate matches" }
            }
          }
        }
      },
      {
        type: "function",
        function: {
          name: "vlm_describe",
          description: "Generates a clean text description of the visible webpage for LLM reasoning.",
          parameters: { type: "object", properties: {} }
        }
      },
      {
        type: "function",
        function: {
          name: "browser_click",
          description: "Clicks an element on the active page by action tag (@e1, @e2) or CSS selector.",
          parameters: {
            type: "object",
            required: ["target"],
            properties: {
              target: { type: "string", description: "Action tag (@e1) or CSS selector" }
            }
          }
        }
      },
      {
        type: "function",
        function: {
          name: "browser_type",
          description: "Types text into an input field or textarea on the active page.",
          parameters: {
            type: "object",
            required: ["target", "text"],
            properties: {
              target: { type: "string", description: "Action tag (@e1) or CSS selector" },
              text: { type: "string", description: "Text to type" },
              pressEnter: { type: "boolean", default: false, description: "Press Enter key after typing" },
              clearFirst: { type: "boolean", default: false, description: "Clear existing text before typing" }
            }
          }
        }
      },
      {
        type: "function",
        function: {
          name: "browser_scroll",
          description: "Scrolls the active browser tab.",
          parameters: {
            type: "object",
            properties: {
              direction: { type: "string", enum: ["up", "down", "top", "bottom", "element"], default: "down" },
              amount: { type: "integer", default: 400, description: "Pixel distance to scroll" }
            }
          }
        }
      },
      {
        type: "function",
        function: {
          name: "browser_navigate",
          description: "Navigates browser tab to a new URL.",
          parameters: {
            type: "object",
            required: ["url"],
            properties: {
              url: { type: "string", description: "Full URL (e.g. https://github.com)" }
            }
          }
        }
      }
    ];
  }
  // ─── Web Dashboard HTML ─────────────────────────────────────
  renderDashboardHtml() {
    const status = this.getStatus();
    const tabTitle = status.activeTab ? status.activeTab.title : "No tab connected";
    const tabUrl = status.activeTab ? status.activeTab.url : "Open Chrome with DOM_X extension loaded";
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
      background: ${status.connected ? "var(--accent)" : "#ef4444"};
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
          <span class="status-dot"></span> ${status.connected ? "Browser Tab Connected" : "Waiting for Browser Tab"}
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
class DOMPulseMCPServer {
  constructor(bridgePort) {
    __publicField(this, "server");
    __publicField(this, "bridge");
    this.bridge = new DOMPulseBridgeServer({ port: bridgePort });
    this.server = new Server(
      {
        name: "dom-x-mcp",
        version: "1.2.0"
      },
      {
        capabilities: {
          tools: {}
        }
      }
    );
    this.setupHandlers();
  }
  async start() {
    await this.bridge.start();
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error("[DOM_X MCP] MCP Server running on stdio transport");
  }
  setupHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          {
            name: "get_page_dom",
            description: "Read the structured, noise-filtered interactive DOM of the active browser tab. Returns actionable elements (@e1, @e2...), roles, accessible names, and bounding boxes for fast AI perception without screenshots.",
            inputSchema: {
              type: "object",
              properties: {
                visibleOnly: {
                  type: "boolean",
                  description: "If true (default), only returns elements currently visible in the viewport.",
                  default: true
                },
                preset: {
                  type: "string",
                  enum: ["interactive", "all", "forms", "headings"],
                  description: 'Element filtering preset (default: "interactive").',
                  default: "interactive"
                },
                query: {
                  type: "string",
                  description: 'Optional CSS selector to scope extraction (e.g. "form.checkout" or "#main-content").'
                },
                search: {
                  type: "string",
                  description: "Optional text query to filter elements by label, name, or tag."
                },
                format: {
                  type: "string",
                  enum: ["summary", "json"],
                  description: 'Output format: "summary" (token-efficient markdown list) or "json" (full metadata).',
                  default: "summary"
                }
              }
            }
          },
          {
            name: "get_dom_mutations",
            description: "Retrieve recent meaningful DOM change events (15ms latency) captured by DOM_X (e.g., modals opened, toast alerts, cart counter increments, URL navigation, form validation errors).",
            inputSchema: {
              type: "object",
              properties: {
                limit: {
                  type: "number",
                  description: "Maximum number of recent mutation events to return (default: 20).",
                  default: 20
                },
                clearAfterRead: {
                  type: "boolean",
                  description: "Whether to clear the mutation event buffer after reading.",
                  default: false
                }
              }
            }
          },
          {
            name: "wait_for_dom_change",
            description: "Asynchronously wait for a meaningful DOM mutation to occur in the browser (e.g. after clicking a submit button or opening a drawer).",
            inputSchema: {
              type: "object",
              properties: {
                timeoutMs: {
                  type: "number",
                  description: "Maximum time to wait in milliseconds (default: 5000).",
                  default: 5e3
                },
                eventType: {
                  type: "string",
                  description: 'Optional event type to wait for (e.g. "DOM_ALERT_APPEARED", "DOM_MODAL_OPENED", "DOM_TEXT_CHANGED").'
                }
              }
            }
          },
          {
            name: "click_element",
            description: 'Click an interactive element in the active browser tab by its reference ID (e.g. "@e1", "@e2") or CSS selector.',
            inputSchema: {
              type: "object",
              properties: {
                target: {
                  type: "string",
                  description: 'The target element reference ID (e.g. "@e1") or CSS selector.'
                }
              },
              required: ["target"]
            }
          },
          {
            name: "hover_element",
            description: "Hover the mouse over an element to trigger tooltips, dropdown menus, or interactive hover states.",
            inputSchema: {
              type: "object",
              properties: {
                target: {
                  type: "string",
                  description: 'The target element reference ID (e.g. "@e2") or CSS selector.'
                }
              },
              required: ["target"]
            }
          },
          {
            name: "type_into_element",
            description: "Type text into an input field or textarea in the active browser tab.",
            inputSchema: {
              type: "object",
              properties: {
                target: {
                  type: "string",
                  description: 'The target element reference ID (e.g. "@e3") or CSS selector.'
                },
                text: {
                  type: "string",
                  description: "The string of text to enter."
                },
                clearFirst: {
                  type: "boolean",
                  description: "Whether to clear any existing value first.",
                  default: false
                },
                pressEnter: {
                  type: "boolean",
                  description: "Whether to dispatch an Enter key submit event after typing.",
                  default: false
                }
              },
              required: ["target", "text"]
            }
          },
          {
            name: "select_option",
            description: "Select an option in a <select> dropdown by its value or visible label.",
            inputSchema: {
              type: "object",
              properties: {
                target: {
                  type: "string",
                  description: 'The select element reference ID (e.g. "@e4") or CSS selector.'
                },
                valueOrText: {
                  type: "string",
                  description: "The option value or visible text to select."
                }
              },
              required: ["target", "valueOrText"]
            }
          },
          {
            name: "press_key",
            description: 'Dispatch a keyboard key or shortcut (e.g. "Enter", "Escape", "Tab", "ArrowDown", "Backspace").',
            inputSchema: {
              type: "object",
              properties: {
                key: {
                  type: "string",
                  description: 'The key name to press (e.g. "Escape", "Enter", "Tab", "ArrowDown").'
                },
                target: {
                  type: "string",
                  description: "Optional target element ID (defaults to currently focused element)."
                },
                ctrl: {
                  type: "boolean",
                  description: "Whether Ctrl modifier is pressed."
                },
                shift: {
                  type: "boolean",
                  description: "Whether Shift modifier is pressed."
                },
                alt: {
                  type: "boolean",
                  description: "Whether Alt modifier is pressed."
                },
                meta: {
                  type: "boolean",
                  description: "Whether Meta (Cmd/Win) modifier is pressed."
                }
              },
              required: ["key"]
            }
          },
          {
            name: "inspect_element",
            description: "Retrieve in-depth technical inspection of an element: computed styles, attributes, parent breadcrumb path, child count, and interactivity state.",
            inputSchema: {
              type: "object",
              properties: {
                target: {
                  type: "string",
                  description: 'The target element reference ID (e.g. "@e1") or CSS selector.'
                }
              },
              required: ["target"]
            }
          },
          {
            name: "scroll_page",
            description: "Scroll the active browser page or scroll an element into view.",
            inputSchema: {
              type: "object",
              properties: {
                direction: {
                  type: "string",
                  enum: ["up", "down", "top", "bottom", "element"],
                  description: "Direction to scroll.",
                  default: "down"
                },
                amount: {
                  type: "number",
                  description: "Pixel distance to scroll (default: 400).",
                  default: 400
                },
                target: {
                  type: "string",
                  description: 'Target element ID (e.g. "@e5") if direction is "element".'
                }
              }
            }
          },
          {
            name: "highlight_element",
            description: "Draw a brief visual highlight ring around an element in the browser window.",
            inputSchema: {
              type: "object",
              properties: {
                target: {
                  type: "string",
                  description: 'The target element reference ID (e.g. "@e2").'
                },
                color: {
                  type: "string",
                  description: 'Hex color code (e.g. "#38bdf8").',
                  default: "#38bdf8"
                }
              },
              required: ["target"]
            }
          },
          {
            name: "navigate_to",
            description: "Navigate the active browser tab to a new URL.",
            inputSchema: {
              type: "object",
              properties: {
                url: {
                  type: "string",
                  description: 'The URL to navigate to (e.g. "https://github.com").'
                }
              },
              required: ["url"]
            }
          },
          {
            name: "eval_script",
            description: "Safely evaluate a JavaScript expression in the active webpage context and return the result.",
            inputSchema: {
              type: "object",
              properties: {
                expression: {
                  type: "string",
                  description: 'JavaScript code snippet to evaluate (e.g. "window.location.pathname" or "document.title").'
                }
              },
              required: ["expression"]
            }
          },
          {
            name: "get_dom_diff",
            description: "Compare current DOM state with previous scan to list added, removed, or changed elements.",
            inputSchema: {
              type: "object",
              properties: {}
            }
          },
          {
            name: "toggle_visual_hud",
            description: "Toggle real-time visual bounding box overlays and @eX tags in Chrome so human users can see what the AI sees.",
            inputSchema: {
              type: "object",
              properties: {
                enabled: {
                  type: "boolean",
                  description: "True to show visual tags and bounding boxes, false to remove them."
                }
              },
              required: ["enabled"]
            }
          },
          {
            name: "get_browser_status",
            description: "Check whether the DOM_X extension/browser tab is actively connected and inspect active tab info.",
            inputSchema: {
              type: "object",
              properties: {}
            }
          },
          // ─── DOM-VLM Tools (Zero-Cost VLM Replacement) ───────────────────
          {
            name: "vlm_perceive",
            description: "[DOM-VLM] Zero-cost visual perception of the current browser page. Replaces screenshot-based VLMs (GPT-4o Vision, Moondream, Claude Vision). Returns a structured visual scene with bounding boxes, spatial layout, element groups, Set-of-Mark element IDs, and an LLM-readable text description. Cost: $0.00 | Latency: ~5–15ms | No GPU | No API calls | Works on any website.",
            inputSchema: {
              type: "object",
              properties: {
                format: {
                  type: "string",
                  enum: ["text", "json", "full"],
                  description: '"text" = LLM-ready scene description only, "json" = structured scene object, "full" = both text + JSON.',
                  default: "text"
                }
              }
            }
          },
          {
            name: "vlm_locate",
            description: '[DOM-VLM] Natural language element locator. Finds browser elements by semantic intent without screenshots or VLM inference. Example: vlm_locate({ query: "the checkout button" }) returns the element with its bounding box and @eX action ID. Cost: $0.00 | Latency: ~2–8ms | Works on any website.',
            inputSchema: {
              type: "object",
              properties: {
                query: {
                  type: "string",
                  description: 'Natural language description of the element to find (e.g. "submit button", "email input", "sign in link", "price of the first product").'
                },
                kind: {
                  type: "string",
                  enum: ["button", "link", "input", "textarea", "select", "checkbox", "radio", "heading", "image", "modal", "dialog", "alert", "navigation", "form", "card", "tab", "menu"],
                  description: "Optional: narrow the search to a specific element kind."
                },
                region: {
                  type: "string",
                  enum: ["top-left", "top-center", "top-right", "middle-left", "middle-center", "middle-right", "bottom-left", "bottom-center", "bottom-right"],
                  description: "Optional: restrict matches to a specific viewport region."
                },
                topK: {
                  type: "number",
                  description: "Number of top matches to return (default: 1).",
                  default: 1
                }
              },
              required: ["query"]
            }
          },
          {
            name: "vlm_describe_scene",
            description: '[DOM-VLM] Generates a compact, LLM-readable natural language description of the current browser viewport. Equivalent to sending a screenshot to a VLM and asking "describe this page" — but with zero cost, zero API calls, and ~5ms latency. Ideal for providing page context to LLMs before issuing action commands.',
            inputSchema: {
              type: "object",
              properties: {}
            }
          }
        ]
      };
    });
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      var _a, _b;
      const { name, arguments: args = {} } = request.params;
      try {
        switch (name) {
          case "get_page_dom": {
            const format = args.format || "summary";
            const snapshot = await this.bridge.sendCommand("GET_DOM", {
              visibleOnly: args.visibleOnly ?? true,
              preset: args.preset || "interactive",
              query: args.query,
              search: args.search
            });
            if (format === "json") {
              return {
                content: [{ type: "text", text: JSON.stringify(snapshot, null, 2) }]
              };
            }
            return {
              content: [{ type: "text", text: snapshot.formattedSummary || JSON.stringify(snapshot) }]
            };
          }
          case "get_dom_mutations": {
            const limit = Number(args.limit) || 20;
            const clear = Boolean(args.clearAfterRead);
            const events = this.bridge.getMutations(limit, clear);
            if (events.length === 0) {
              return {
                content: [{ type: "text", text: "No recent DOM mutation events captured (page is stable)." }]
              };
            }
            const formatted = events.map((e, idx) => {
              var _a2;
              const el = e.targetElement ? `${e.targetElement.tag} (${e.targetElement.selector})` : "DOM";
              const text = ((_a2 = e.targetElement) == null ? void 0 : _a2.textSnippet) ? ` "${e.targetElement.textSnippet}"` : "";
              return `[Event #${idx + 1}] ${e.type} on ${el}${text} at +${e.timestamp}ms`;
            }).join("\n");
            return {
              content: [
                {
                  type: "text",
                  text: `Captured ${events.length} meaningful DOM mutations:
${formatted}`
                }
              ]
            };
          }
          case "wait_for_dom_change": {
            const timeoutMs = Number(args.timeoutMs) || 5e3;
            const eventType = args.eventType;
            const evt = await this.bridge.waitForMutation(
              eventType ? (e) => e.type === eventType : void 0,
              timeoutMs
            );
            return {
              content: [
                {
                  type: "text",
                  text: `Observed DOM mutation: ${evt.type} on <${((_a = evt.targetElement) == null ? void 0 : _a.tag) || "node"}> (${((_b = evt.targetElement) == null ? void 0 : _b.selector) || ""})`
                }
              ]
            };
          }
          case "click_element": {
            const target = String(args.target || "");
            const result = await this.bridge.sendCommand("CLICK", { target });
            return {
              content: [{ type: "text", text: result.message || `Clicked element ${target}` }]
            };
          }
          case "hover_element": {
            const target = String(args.target || "");
            const result = await this.bridge.sendCommand("HOVER", { target });
            return {
              content: [{ type: "text", text: result.message || `Hovered over element ${target}` }]
            };
          }
          case "type_into_element": {
            const target = String(args.target || "");
            const text = String(args.text || "");
            const clearFirst = Boolean(args.clearFirst);
            const pressEnter = Boolean(args.pressEnter);
            const result = await this.bridge.sendCommand("TYPE", {
              target,
              text,
              clearFirst,
              pressEnter
            });
            return {
              content: [{ type: "text", text: result.message || `Typed "${text}" into ${target}` }]
            };
          }
          case "select_option": {
            const target = String(args.target || "");
            const valueOrText = String(args.valueOrText || "");
            const result = await this.bridge.sendCommand("SELECT_OPTION", { target, valueOrText });
            return {
              content: [{ type: "text", text: result.message || `Selected option in ${target}` }]
            };
          }
          case "press_key": {
            const key = String(args.key || "Enter");
            const target = args.target ? String(args.target) : void 0;
            const modifiers = {
              ctrl: Boolean(args.ctrl),
              alt: Boolean(args.alt),
              shift: Boolean(args.shift),
              meta: Boolean(args.meta)
            };
            const result = await this.bridge.sendCommand("PRESS_KEY", { key, target, modifiers });
            return {
              content: [{ type: "text", text: result.message || `Pressed key ${key}` }]
            };
          }
          case "inspect_element": {
            const target = String(args.target || "");
            const result = await this.bridge.sendCommand("INSPECT", { target });
            return {
              content: [{ type: "text", text: JSON.stringify(result.inspection || result, null, 2) }]
            };
          }
          case "navigate_to": {
            const url = String(args.url || "");
            const result = await this.bridge.sendCommand("NAVIGATE", { url });
            return {
              content: [{ type: "text", text: result.message || `Navigated to ${url}` }]
            };
          }
          case "eval_script": {
            const expression = String(args.expression || "");
            const result = await this.bridge.sendCommand("EVAL", { expression });
            if (!result.success) {
              return {
                isError: true,
                content: [{ type: "text", text: `Eval Error: ${result.error || "Execution failed"}` }]
              };
            }
            return {
              content: [{ type: "text", text: JSON.stringify(result.result, null, 2) }]
            };
          }
          case "get_dom_diff": {
            const result = await this.bridge.sendCommand("GET_DIFF", {});
            return {
              content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
            };
          }
          case "scroll_page": {
            const direction = args.direction || "down";
            const amount = Number(args.amount) || 400;
            const target = args.target;
            const result = await this.bridge.sendCommand("SCROLL", {
              direction,
              amount,
              target
            });
            return {
              content: [{ type: "text", text: result.message || `Scrolled ${direction}` }]
            };
          }
          case "highlight_element": {
            const target = String(args.target || "");
            const color = args.color || "#38bdf8";
            const result = await this.bridge.sendCommand("HIGHLIGHT", { target, color });
            return {
              content: [{ type: "text", text: result.message || `Highlighted ${target}` }]
            };
          }
          case "toggle_visual_hud": {
            const enabled = Boolean(args.enabled);
            await this.bridge.sendCommand("TOGGLE_HUD", { enabled });
            return {
              content: [
                {
                  type: "text",
                  text: enabled ? "Visual HUD enabled in Chrome. Bounding boxes and @eX tags are now visible over interactive elements." : "Visual HUD disabled in Chrome."
                }
              ]
            };
          }
          case "get_browser_status": {
            const status = this.bridge.getStatus();
            return {
              content: [{ type: "text", text: JSON.stringify(status, null, 2) }]
            };
          }
          // ─── DOM-VLM Tool Handlers ──────────────────────────────────────────────────
          case "vlm_perceive": {
            const format = args.format || "text";
            const result = await this.bridge.sendCommand("VLM_PERCEIVE", {});
            if (!result.success && result.message) {
              return {
                isError: true,
                content: [{ type: "text", text: `DOM-VLM Error: ${result.message}` }]
              };
            }
            if (format === "json") {
              return {
                content: [{ type: "text", text: JSON.stringify(result.scene || result, null, 2) }]
              };
            } else if (format === "full") {
              return {
                content: [
                  { type: "text", text: result.sceneText || "" },
                  { type: "text", text: "\n\n--- JSON Scene ---\n" + JSON.stringify(result.scene || result, null, 2) }
                ]
              };
            }
            return {
              content: [
                {
                  type: "text",
                  text: (result.sceneText || "No scene data.") + `

[DOM-VLM] Cost: ${result.cost ?? "$0.00"} | Elapsed: ${result.elapsedMs ?? "?"}ms`
                }
              ]
            };
          }
          case "vlm_locate": {
            const query = String(args.query || "");
            if (!query) {
              return {
                isError: true,
                content: [{ type: "text", text: 'DOM-VLM Error: "query" parameter is required for vlm_locate.' }]
              };
            }
            const result = await this.bridge.sendCommand("VLM_LOCATE", {
              query,
              kind: args.kind,
              region: args.region,
              topK: Number(args.topK) || 1
            });
            if (!result.found || !result.matches || result.matches.length === 0) {
              return {
                content: [
                  {
                    type: "text",
                    text: `[DOM-VLM] Element not found for query: "${query}"
Tip: Try a broader query or use vlm_perceive to see all visible elements first.`
                  }
                ]
              };
            }
            const matchLines = result.matches.map((m, i) => {
              const el = m.element;
              return [
                `Match #${i + 1} (score: ${(m.score * 100).toFixed(0)}%) — Reason: ${m.reason}`,
                `  Action ID: ${el.actionId}`,
                `  Kind: ${el.kind} | Label: "${el.label}"`,
                `  Click target: (${el.bbox.centerX}, ${el.bbox.centerY})`,
                `  Region: ${el.region} | In Viewport: ${el.inViewport}`,
                `  Selector: ${el.selector}`
              ].join("\n");
            });
            return {
              content: [
                {
                  type: "text",
                  text: `[DOM-VLM] Located "${query}" — ${result.matches.length} match(es) in ${result.elapsedMs}ms:

${matchLines.join("\n\n")}`
                }
              ]
            };
          }
          case "vlm_describe_scene": {
            const result = await this.bridge.sendCommand("VLM_DESCRIBE", {});
            return {
              content: [
                {
                  type: "text",
                  text: result.description || result.sceneText || "No scene description available."
                }
              ]
            };
          }
          default:
            throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          isError: true,
          content: [{ type: "text", text: `DOM_X Error: ${message}` }]
        };
      }
    });
  }
}
async function main() {
  const port = process.env.DOM_X_PORT || process.env.DOMPULSE_PORT ? parseInt(process.env.DOM_X_PORT || process.env.DOMPULSE_PORT, 10) : 8765;
  const server = new DOMPulseMCPServer(port);
  await server.start();
}
main().catch((err) => {
  console.error("[DOM_X MCP] Fatal server error:", err);
  process.exit(1);
});
