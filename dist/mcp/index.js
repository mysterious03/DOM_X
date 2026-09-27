#!/usr/bin/env node
var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ListToolsRequestSchema, CallToolRequestSchema, McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { WebSocketServer, WebSocket } from "ws";
class DOMPulseBridgeServer {
  constructor(options = {}) {
    __publicField(this, "wss", null);
    __publicField(this, "port");
    __publicField(this, "host");
    __publicField(this, "tabs", /* @__PURE__ */ new Map());
    __publicField(this, "activeTabId", null);
    __publicField(this, "pendingRequests", /* @__PURE__ */ new Map());
    __publicField(this, "mutationBuffer", []);
    __publicField(this, "mutationWaiters", []);
    __publicField(this, "maxBufferSize", 200);
    this.port = options.port || Number(process.env.DOM_X_PORT || process.env.DOMPULSE_PORT) || 8765;
    this.host = options.host || "127.0.0.1";
  }
  start() {
    return new Promise((resolve, reject) => {
      try {
        this.wss = new WebSocketServer({ port: this.port, host: this.host }, () => {
          console.error(`[DOM_X MCP Bridge] WebSocket server listening on ws://${this.host}:${this.port}`);
          resolve();
        });
        this.wss.on("connection", (ws) => {
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
          });
          ws.on("error", (err) => {
            console.error(`[DOMPulse Bridge Server] WebSocket error on tab ${tabId}:`, err.message);
          });
        });
        this.wss.on("error", (err) => {
          reject(err);
        });
      } catch (err) {
        reject(err);
      }
    });
  }
  stop() {
    return new Promise((resolve) => {
      for (const [id, req] of this.pendingRequests.entries()) {
        clearTimeout(req.timer);
        req.reject(new Error("Bridge server shutting down"));
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
      }
    } else if (msg.type === "DOM_MUTATIONS" && Array.isArray(msg.events)) {
      for (const evt of msg.events) {
        this.mutationBuffer.push(evt);
        if (this.mutationBuffer.length > this.maxBufferSize) {
          this.mutationBuffer.shift();
        }
        this.mutationWaiters = this.mutationWaiters.filter((waiter) => !waiter(evt));
      }
    }
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
                interactiveOnly: {
                  type: "boolean",
                  description: "If true (default), filters for interactive nodes (buttons, inputs, links, forms, dialogs).",
                  default: true
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
              interactiveOnly: args.interactiveOnly ?? true
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
            const result = await this.bridge.sendCommand("TOGGLE_HUD", { enabled });
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
