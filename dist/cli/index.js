var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";
import { fileURLToPath } from "url";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ListToolsRequestSchema, CallToolRequestSchema, McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { EventEmitter } from "events";
import { WebSocketServer, WebSocket } from "ws";
import readline from "readline";
class DOMPulseBridgeServer extends EventEmitter {
  constructor(options = {}) {
    super();
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
const BOLD = "\x1B[1m";
const DIM = "\x1B[2m";
const CYAN = "\x1B[36m";
const GREEN = "\x1B[32m";
const YELLOW = "\x1B[33m";
const ORANGE = "\x1B[38;5;208m";
const RED = "\x1B[31m";
const MAGENTA = "\x1B[35m";
const RESET = "\x1B[0m";
async function startInteractiveCLI(options) {
  var _a;
  const { bridge, launchBrowser: launchBrowser2, installConfig: installConfig2, findChrome, rootDir } = options;
  console.clear();
  console.log(`
${ORANGE}${BOLD}  ██████╗   ██████╗  ███╗   ███╗     ██╗  ██╗
  ██╔══██╗ ██╔═══██╗ ████╗ ████║     ╚██╗██╔╝
  ██║  ██║ ██║   ██║ ██╔████╔██║      ╚███╔╝ 
  ██║  ██║ ██║   ██║ ██║╚██╔╝██║      ██╔██╗ 
  ██████╔╝ ╚██████╔╝ ██║ ╚═╝ ██║     ██╔╝ ██╗
  ╚═════╝   ╚═════╝  ╚═╝     ╚═╝     ╚═╝  ╚═╝${RESET}

  ${BOLD}✱ Welcome to DOM_X Interactive Terminal ✱${RESET}
  ${DIM}Real-Time Browser Perception & Action Engine for AI Agents${RESET}
`);
  const status = bridge.getStatus();
  const chromePath = findChrome();
  console.log(`  ${CYAN}●${RESET} Bridge: ${BOLD}ws://127.0.0.1:${status.port}${RESET}`);
  console.log(`  ${chromePath ? GREEN + "●" : RED + "○"}${RESET} Chrome: ${chromePath ? BOLD + "Detected" + RESET : RED + "Not Found (Run /launch)" + RESET}`);
  console.log(`  ${status.connected ? GREEN + "● Active Tab: " + ((_a = status.activeTab) == null ? void 0 : _a.title) : YELLOW + "○ No Browser Tab Connected (Run /launch to start Chrome)"}${RESET}`);
  console.log(`  ${DIM}Type ${BOLD}/help${RESET}${DIM} for command list, or type commands directly.${RESET}
`);
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: `${ORANGE}${BOLD}dom_x${RESET} > `,
    completer: (line) => {
      const completions = [
        "/launch",
        "/scan",
        "/dom",
        "/click",
        "/type",
        "/hover",
        "/scroll",
        "/goto",
        "/hud",
        "/mutations",
        "/status",
        "/install",
        "/eval",
        "/help",
        "/clear",
        "/exit"
      ];
      const hits = completions.filter((c) => c.startsWith(line.trim()));
      return [hits.length ? hits : completions, line];
    }
  });
  bridge.on("mutation", (evt) => {
    var _a2;
    readline.clearLine(process.stdout, 0);
    readline.cursorTo(process.stdout, 0);
    const scoreStr = evt.importanceScore ? `[${evt.importanceScore}/5]` : "";
    console.log(
      `${MAGENTA}⚡ [15ms DOM Mutation]${RESET} ${DIM}${scoreStr}${RESET} ${BOLD}${evt.type}${RESET}: ${evt.target}${((_a2 = evt.details) == null ? void 0 : _a2.text) ? ` → "${CYAN}${evt.details.text}${RESET}"` : ""}`
    );
    rl.prompt(true);
  });
  bridge.on("tab_ready", (tab) => {
    readline.clearLine(process.stdout, 0);
    readline.cursorTo(process.stdout, 0);
    console.log(`${GREEN}✔ [DOM_X Active Tab]${RESET} "${BOLD}${tab.title}${RESET}" (${CYAN}${tab.url}${RESET})`);
    rl.prompt(true);
  });
  bridge.on("tab_disconnected", () => {
    readline.clearLine(process.stdout, 0);
    readline.cursorTo(process.stdout, 0);
    console.log(`${YELLOW}⚠ [DOM_X] Browser tab disconnected.${RESET}`);
    rl.prompt(true);
  });
  rl.prompt();
  rl.on("line", async (line) => {
    var _a2;
    const raw = line.trim();
    if (!raw) {
      rl.prompt();
      return;
    }
    const parts = raw.split(/\s+/);
    let cmd = parts[0].toLowerCase();
    if (cmd.startsWith("/")) {
      cmd = cmd.substring(1);
    }
    const args = parts.slice(1);
    try {
      switch (cmd) {
        case "help":
        case "?": {
          console.log(`
${BOLD}Available DOM_X Interactive Commands:${RESET}

  ${CYAN}/launch [url]${RESET}          Launch Chrome with DOM_X pre-loaded (e.g. /launch https://github.com)
  ${CYAN}/scan${RESET} or ${CYAN}/dom${RESET}          Extract actionable elements & IDs (@e1, @e2...) from active tab
  ${CYAN}/click <@id|selector>${RESET}   Click an element (e.g. /click @e1 or /click #submit)
  ${CYAN}/type <@id> <text>${RESET}      Type text into an input field (e.g. /type @e2 mypassword)
  ${CYAN}/hover <@id>${RESET}             Hover over an element (e.g. /hover @e4)
  ${CYAN}/scroll [dir]${RESET}            Scroll active page (up | down | top | bottom)
  ${CYAN}/goto <url>${RESET}              Navigate active tab to a URL (e.g. /goto https://google.com)
  ${CYAN}/hud${RESET}                     Toggle the in-browser visual bounding box HUD in Chrome
  ${CYAN}/mutations${RESET}               List recent 15ms change intelligence events
  ${CYAN}/eval <expr>${RESET}             Execute JavaScript in the active browser tab
  ${CYAN}/install [client]${RESET}        Auto-configure AI client (claude | cursor | all)
  ${CYAN}/status${RESET}                  Display connection diagnostics & Chrome path
  ${CYAN}/clear${RESET}                   Clear terminal screen
  ${CYAN}/exit${RESET} or ${CYAN}quit${RESET}             Exit interactive session
`);
          break;
        }
        case "launch":
        case "open": {
          const url = args[0] || "https://github.com";
          console.log(`${CYAN}⚡ Launching Chrome with DOM_X at: ${url}...${RESET}`);
          launchBrowser2(url);
          break;
        }
        case "scan":
        case "dom":
        case "state": {
          console.log(`${CYAN}🔍 Scanning active tab DOM elements...${RESET}`);
          const res = await bridge.sendCommand("GET_DOM", { preset: "interactive", visibleOnly: true });
          if (!res || !Array.isArray(res.elements) || res.elements.length === 0) {
            console.log(`${YELLOW}No actionable elements found on current page.${RESET}`);
          } else {
            console.log(
              `
${BOLD}[DOM_X Perception | Tab: "${res.title || "Unknown"}" | Actionable Elements: ${res.elements.length}]${RESET}`
            );
            console.log(`${DIM}--------------------------------------------------------------------------------${RESET}`);
            for (const el of res.elements.slice(0, 30)) {
              const tag = el.actionId ? `${ORANGE}${BOLD}${el.actionId}${RESET}` : "@??";
              const role = `${CYAN}[${(el.role || el.tagName || "ELEMENT").toUpperCase()}]${RESET}`;
              const text = el.text ? `"${el.text.substring(0, 40)}"` : el.placeholder ? `"${el.placeholder}"` : "";
              const bounds = el.boundingBox ? `${DIM}(${el.boundingBox.width}x${el.boundingBox.height} at: ${el.boundingBox.x},${el.boundingBox.y})${RESET}` : "";
              console.log(`  ${tag.padEnd(12)} ${role.padEnd(20)} ${text.padEnd(45)} ${bounds}`);
            }
            if (res.elements.length > 30) {
              console.log(`${DIM}  ... and ${res.elements.length - 30} more elements.${RESET}`);
            }
            console.log(`${DIM}--------------------------------------------------------------------------------${RESET}
`);
          }
          break;
        }
        case "click": {
          const target = args[0];
          if (!target) {
            console.log(`${RED}Usage: /click <@e1 | selector>${RESET}`);
            break;
          }
          console.log(`${CYAN}Clicking ${target}...${RESET}`);
          const res = await bridge.sendCommand("CLICK", { target });
          console.log(`${GREEN}✔ ${res.message || "Clicked successfully!"}${RESET}`);
          break;
        }
        case "type": {
          const target = args[0];
          const text = args.slice(1).join(" ");
          if (!target || !text) {
            console.log(`${RED}Usage: /type <@e1 | selector> <text to type>${RESET}`);
            break;
          }
          console.log(`${CYAN}Typing into ${target}...${RESET}`);
          const res = await bridge.sendCommand("TYPE", { target, text });
          console.log(`${GREEN}✔ ${res.message || "Text entered successfully!"}${RESET}`);
          break;
        }
        case "hover": {
          const target = args[0];
          if (!target) {
            console.log(`${RED}Usage: /hover <@e1 | selector>${RESET}`);
            break;
          }
          const res = await bridge.sendCommand("HOVER", { target });
          console.log(`${GREEN}✔ ${res.message || "Hovered!"}${RESET}`);
          break;
        }
        case "scroll": {
          const direction = args[0] || "down";
          const res = await bridge.sendCommand("SCROLL", { direction, amount: 400 });
          console.log(`${GREEN}✔ ${res.message || `Scrolled ${direction}`}${RESET}`);
          break;
        }
        case "goto": {
          const url = args[0];
          if (!url) {
            console.log(`${RED}Usage: /goto <url>${RESET}`);
            break;
          }
          const res = await bridge.sendCommand("NAVIGATE", { url });
          console.log(`${GREEN}✔ Navigating to: ${url}${RESET}`);
          break;
        }
        case "hud": {
          const res = await bridge.sendCommand("TOGGLE_HUD", {});
          console.log(`${GREEN}✔ In-browser HUD ${res.enabled ? "Enabled" : "Disabled"}${RESET}`);
          break;
        }
        case "mutations":
        case "changes": {
          const mutations = bridge.getMutations(15);
          if (mutations.length === 0) {
            console.log(`${DIM}No recent DOM mutations recorded.${RESET}`);
          } else {
            console.log(`
${BOLD}Recent 15ms DOM Mutations:${RESET}`);
            for (const m of mutations) {
              console.log(`  ${MAGENTA}•${RESET} ${BOLD}${m.type}${RESET} on ${CYAN}${m.target}${RESET} ${((_a2 = m.details) == null ? void 0 : _a2.text) ? `("${m.details.text}")` : ""}`);
            }
            console.log("");
          }
          break;
        }
        case "eval": {
          const expr = args.join(" ");
          if (!expr) {
            console.log(`${RED}Usage: /eval <javascript expression>${RESET}`);
            break;
          }
          const res = await bridge.sendCommand("EVAL", { expression: expr });
          console.log(`${GREEN}=>${RESET}`, res.result);
          break;
        }
        case "install": {
          const client = args[0] || "all";
          installConfig2(client);
          break;
        }
        case "status": {
          const s = bridge.getStatus();
          console.log(`
${BOLD}=== DOM_X System Status ===${RESET}`);
          console.log(`Bridge Port:  ${s.port}`);
          console.log(`Connected:    ${s.connected ? GREEN + "Yes" + RESET : RED + "No" + RESET}`);
          console.log(`Active Tab:   ${s.activeTab ? `"${s.activeTab.title}" (${s.activeTab.url})` : "None"}`);
          console.log(`Chrome Exec:  ${findChrome() || "Not Found"}`);
          console.log(`Root Path:    ${rootDir}
`);
          break;
        }
        case "clear": {
          console.clear();
          break;
        }
        case "exit":
        case "quit": {
          console.log(`
${ORANGE}Goodbye from DOM_X!${RESET}
`);
          process.exit(0);
          break;
        }
        default: {
          console.log(`${RED}Unknown command: "${raw}". Type /help to see all interactive commands.${RESET}`);
          break;
        }
      }
    } catch (err) {
      console.log(`${RED}✘ Error:${RESET} ${err instanceof Error ? err.message : String(err)}`);
    }
    rl.prompt();
  });
  rl.on("close", () => {
    console.log(`
${ORANGE}DOM_X session ended.${RESET}`);
    process.exit(0);
  });
}
const __filename$1 = fileURLToPath(import.meta.url);
const __dirname$1 = path.dirname(__filename$1);
const ROOT_DIR = path.resolve(__dirname$1, "..", "..");
function findChromeExecutable() {
  const platform = os.platform();
  if (platform === "win32") {
    const paths = [
      path.join(process.env.PROGRAMFILES || "C:\\Program Files", "Google", "Chrome", "Application", "chrome.exe"),
      path.join(process.env["PROGRAMFILES(X86)"] || "C:\\Program Files (x86)", "Google", "Chrome", "Application", "chrome.exe"),
      path.join(process.env.LOCALAPPDATA || "", "Google", "Chrome", "Application", "chrome.exe")
    ];
    for (const p of paths) {
      if (fs.existsSync(p)) return p;
    }
  } else if (platform === "darwin") {
    const p = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
    if (fs.existsSync(p)) return p;
  } else {
    const paths = ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium-browser", "/usr/bin/chromium"];
    for (const p of paths) {
      if (fs.existsSync(p)) return p;
    }
  }
  return null;
}
function getClientConfigPaths() {
  const platform = os.platform();
  let claudePath = null;
  let cursorPath = null;
  if (platform === "win32") {
    claudePath = path.join(process.env.APPDATA || "", "Claude", "claude_desktop_config.json");
    cursorPath = path.join(os.homedir(), ".cursor", "mcp.json");
  } else if (platform === "darwin") {
    claudePath = path.join(os.homedir(), "Library", "Application Support", "Claude", "claude_desktop_config.json");
    cursorPath = path.join(os.homedir(), ".cursor", "mcp.json");
  } else {
    claudePath = path.join(os.homedir(), ".config", "Claude", "claude_desktop_config.json");
    cursorPath = path.join(os.homedir(), ".cursor", "mcp.json");
  }
  return { claudePath, cursorPath };
}
function installConfig(target) {
  const { claudePath, cursorPath } = getClientConfigPaths();
  const mcpIndexPath = path.resolve(ROOT_DIR, "dist", "mcp", "index.js");
  const serverEntry = {
    command: "node",
    args: [mcpIndexPath]
  };
  const targets = target === "all" ? ["claude", "cursor"] : [target];
  for (const t of targets) {
    const configPath = t === "claude" ? claudePath : cursorPath;
    if (!configPath) continue;
    try {
      const dir = path.dirname(configPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      let config = { mcpServers: {} };
      if (fs.existsSync(configPath)) {
        try {
          config = JSON.parse(fs.readFileSync(configPath, "utf8"));
          if (!config.mcpServers) config.mcpServers = {};
        } catch {
          config = { mcpServers: {} };
        }
      }
      config.mcpServers["dom-x"] = serverEntry;
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2), "utf8");
      console.log(`[DOM_X] Successfully installed DOM_X MCP server into ${t.toUpperCase()} config:`);
      console.log(`         ${configPath}`);
    } catch (err) {
      console.error(`[DOM_X] Failed to write config for ${t}:`, err instanceof Error ? err.message : err);
    }
  }
}
function launchBrowser(url = "https://google.com") {
  const chromePath = findChromeExecutable();
  if (!chromePath) {
    console.error("[DOM_X] Could not locate Google Chrome executable automatically.");
    console.error("        Please open Chrome manually and load unpacked extension from:");
    console.error(`        ${path.resolve(ROOT_DIR, "dist")}`);
    process.exit(1);
  }
  const distDir = path.resolve(ROOT_DIR, "dist");
  console.log(`[DOM_X] Launching Google Chrome with DOM_X extension loaded:`);
  console.log(`        Extension: ${distDir}`);
  console.log(`        Target URL: ${url}`);
  const args = [
    `--load-extension=${distDir}`,
    `--disable-extensions-except=${distDir}`,
    url
  ];
  const child = spawn(chromePath, args, {
    detached: true,
    stdio: "ignore"
  });
  child.unref();
  console.log("[DOM_X] Chrome launched successfully!");
}
async function runCLI(argv) {
  const argCommand = argv[2];
  const command = argCommand || (process.stdin.isTTY ? "interactive" : "serve");
  switch (command) {
    case "interactive":
    case "repl":
    case "chat":
    case "-i": {
      const port = process.env.DOM_X_PORT ? parseInt(process.env.DOM_X_PORT, 10) : 8765;
      const bridge = new DOMPulseBridgeServer({ port });
      await bridge.start();
      await startInteractiveCLI({
        bridge,
        launchBrowser,
        installConfig,
        findChrome: findChromeExecutable,
        rootDir: ROOT_DIR
      });
      break;
    }
    case "serve": {
      const port = process.env.DOM_X_PORT ? parseInt(process.env.DOM_X_PORT, 10) : 8765;
      const server = new DOMPulseMCPServer(port);
      await server.start();
      break;
    }
    case "launch": {
      const url = argv[3] || "https://google.com";
      launchBrowser(url);
      break;
    }
    case "install": {
      const client = argv[3] || "all";
      installConfig(client);
      break;
    }
    case "status": {
      const port = process.env.DOM_X_PORT || "8765";
      console.log("=== DOM_X System Status ===");
      console.log(`Node Version:  ${process.version}`);
      console.log(`MCP Port:      ${port}`);
      console.log(`Root Dir:      ${ROOT_DIR}`);
      console.log(`Dist Built:    ${fs.existsSync(path.resolve(ROOT_DIR, "dist", "content.js")) ? "Yes" : "No"}`);
      console.log(`MCP Bundle:    ${fs.existsSync(path.resolve(ROOT_DIR, "dist", "mcp", "index.js")) ? "Yes" : "No"}`);
      const chrome = findChromeExecutable();
      console.log(`Chrome Found:  ${chrome || "Not Found"}`);
      break;
    }
    case "--help":
    case "-h":
    case "help": {
      console.log(`
DOM_X CLI - Browser Perception & Change-Intelligence MCP Server

Usage:
  domx [command] [options]

Commands:
  interactive, repl     Start interactive terminal REPL (default in TTY)
  serve                 Run MCP server over stdio for Claude Desktop / Cursor
  launch [url]          Launch Chrome with DOM_X extension pre-loaded
  install [client]      Auto-configure AI client (claude | cursor | all)
  status                Display diagnostic info and paths
  help                  Show this help screen

Examples:
  domx                         # Starts interactive terminal session (Ollama / Claude style)
  domx install claude          # Installs DOM_X into Claude Desktop
  domx install cursor          # Installs DOM_X into Cursor
  domx launch https://github.com # Opens Chrome with DOM_X loaded
  domx serve                   # Starts MCP server on stdio
`);
      break;
    }
    default:
      console.error(`Unknown command: ${command}. Run "dom-x --help" for available commands.`);
      process.exit(1);
  }
}
export {
  runCLI
};
