/**
 * DOM_X MCP (Model Context Protocol) Server
 * Exposes browser perception, DOM change-intelligence, inspection, and action tools to AI agents.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import { DOMPulseBridgeServer } from './bridge-server';

export class DOMPulseMCPServer {
  private server: Server;
  private bridge: DOMPulseBridgeServer;

  constructor(bridgePort?: number) {
    this.bridge = new DOMPulseBridgeServer({ port: bridgePort });

    this.server = new Server(
      {
        name: 'dom-x-mcp',
        version: '1.2.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.setupHandlers();
  }

  public async start(): Promise<void> {
    await this.bridge.start();
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('[DOM_X MCP] MCP Server running on stdio transport');
  }

  private setupHandlers(): void {
    // 1. List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          {
            name: 'get_page_dom',
            description:
              'Read the structured, noise-filtered interactive DOM of the active browser tab. Returns actionable elements (@e1, @e2...), roles, accessible names, and bounding boxes for fast AI perception without screenshots.',
            inputSchema: {
              type: 'object',
              properties: {
                visibleOnly: {
                  type: 'boolean',
                  description: 'If true (default), only returns elements currently visible in the viewport.',
                  default: true,
                },
                preset: {
                  type: 'string',
                  enum: ['interactive', 'all', 'forms', 'headings'],
                  description: 'Element filtering preset (default: "interactive").',
                  default: 'interactive',
                },
                query: {
                  type: 'string',
                  description: 'Optional CSS selector to scope extraction (e.g. "form.checkout" or "#main-content").',
                },
                search: {
                  type: 'string',
                  description: 'Optional text query to filter elements by label, name, or tag.',
                },
                format: {
                  type: 'string',
                  enum: ['summary', 'json'],
                  description: 'Output format: "summary" (token-efficient markdown list) or "json" (full metadata).',
                  default: 'summary',
                },
              },
            },
          },
          {
            name: 'get_dom_mutations',
            description:
              'Retrieve recent meaningful DOM change events (15ms latency) captured by DOM_X (e.g., modals opened, toast alerts, cart counter increments, URL navigation, form validation errors).',
            inputSchema: {
              type: 'object',
              properties: {
                limit: {
                  type: 'number',
                  description: 'Maximum number of recent mutation events to return (default: 20).',
                  default: 20,
                },
                clearAfterRead: {
                  type: 'boolean',
                  description: 'Whether to clear the mutation event buffer after reading.',
                  default: false,
                },
              },
            },
          },
          {
            name: 'wait_for_dom_change',
            description:
              'Asynchronously wait for a meaningful DOM mutation to occur in the browser (e.g. after clicking a submit button or opening a drawer).',
            inputSchema: {
              type: 'object',
              properties: {
                timeoutMs: {
                  type: 'number',
                  description: 'Maximum time to wait in milliseconds (default: 5000).',
                  default: 5000,
                },
                eventType: {
                  type: 'string',
                  description: 'Optional event type to wait for (e.g. "DOM_ALERT_APPEARED", "DOM_MODAL_OPENED", "DOM_TEXT_CHANGED").',
                },
              },
            },
          },
          {
            name: 'click_element',
            description:
              'Click an interactive element in the active browser tab by its reference ID (e.g. "@e1", "@e2") or CSS selector.',
            inputSchema: {
              type: 'object',
              properties: {
                target: {
                  type: 'string',
                  description: 'The target element reference ID (e.g. "@e1") or CSS selector.',
                },
              },
              required: ['target'],
            },
          },
          {
            name: 'hover_element',
            description:
              'Hover the mouse over an element to trigger tooltips, dropdown menus, or interactive hover states.',
            inputSchema: {
              type: 'object',
              properties: {
                target: {
                  type: 'string',
                  description: 'The target element reference ID (e.g. "@e2") or CSS selector.',
                },
              },
              required: ['target'],
            },
          },
          {
            name: 'type_into_element',
            description:
              'Type text into an input field or textarea in the active browser tab.',
            inputSchema: {
              type: 'object',
              properties: {
                target: {
                  type: 'string',
                  description: 'The target element reference ID (e.g. "@e3") or CSS selector.',
                },
                text: {
                  type: 'string',
                  description: 'The string of text to enter.',
                },
                clearFirst: {
                  type: 'boolean',
                  description: 'Whether to clear any existing value first.',
                  default: false,
                },
                pressEnter: {
                  type: 'boolean',
                  description: 'Whether to dispatch an Enter key submit event after typing.',
                  default: false,
                },
              },
              required: ['target', 'text'],
            },
          },
          {
            name: 'select_option',
            description: 'Select an option in a <select> dropdown by its value or visible label.',
            inputSchema: {
              type: 'object',
              properties: {
                target: {
                  type: 'string',
                  description: 'The select element reference ID (e.g. "@e4") or CSS selector.',
                },
                valueOrText: {
                  type: 'string',
                  description: 'The option value or visible text to select.',
                },
              },
              required: ['target', 'valueOrText'],
            },
          },
          {
            name: 'press_key',
            description: 'Dispatch a keyboard key or shortcut (e.g. "Enter", "Escape", "Tab", "ArrowDown", "Backspace").',
            inputSchema: {
              type: 'object',
              properties: {
                key: {
                  type: 'string',
                  description: 'The key name to press (e.g. "Escape", "Enter", "Tab", "ArrowDown").',
                },
                target: {
                  type: 'string',
                  description: 'Optional target element ID (defaults to currently focused element).',
                },
                ctrl: {
                  type: 'boolean',
                  description: 'Whether Ctrl modifier is pressed.',
                },
                shift: {
                  type: 'boolean',
                  description: 'Whether Shift modifier is pressed.',
                },
                alt: {
                  type: 'boolean',
                  description: 'Whether Alt modifier is pressed.',
                },
                meta: {
                  type: 'boolean',
                  description: 'Whether Meta (Cmd/Win) modifier is pressed.',
                },
              },
              required: ['key'],
            },
          },
          {
            name: 'inspect_element',
            description:
              'Retrieve in-depth technical inspection of an element: computed styles, attributes, parent breadcrumb path, child count, and interactivity state.',
            inputSchema: {
              type: 'object',
              properties: {
                target: {
                  type: 'string',
                  description: 'The target element reference ID (e.g. "@e1") or CSS selector.',
                },
              },
              required: ['target'],
            },
          },
          {
            name: 'scroll_page',
            description: 'Scroll the active browser page or scroll an element into view.',
            inputSchema: {
              type: 'object',
              properties: {
                direction: {
                  type: 'string',
                  enum: ['up', 'down', 'top', 'bottom', 'element'],
                  description: 'Direction to scroll.',
                  default: 'down',
                },
                amount: {
                  type: 'number',
                  description: 'Pixel distance to scroll (default: 400).',
                  default: 400,
                },
                target: {
                  type: 'string',
                  description: 'Target element ID (e.g. "@e5") if direction is "element".',
                },
              },
            },
          },
          {
            name: 'highlight_element',
            description: 'Draw a brief visual highlight ring around an element in the browser window.',
            inputSchema: {
              type: 'object',
              properties: {
                target: {
                  type: 'string',
                  description: 'The target element reference ID (e.g. "@e2").',
                },
                color: {
                  type: 'string',
                  description: 'Hex color code (e.g. "#38bdf8").',
                  default: '#38bdf8',
                },
              },
              required: ['target'],
            },
          },
          {
            name: 'navigate_to',
            description: 'Navigate the active browser tab to a new URL.',
            inputSchema: {
              type: 'object',
              properties: {
                url: {
                  type: 'string',
                  description: 'The URL to navigate to (e.g. "https://github.com").',
                },
              },
              required: ['url'],
            },
          },
          {
            name: 'eval_script',
            description: 'Safely evaluate a JavaScript expression in the active webpage context and return the result.',
            inputSchema: {
              type: 'object',
              properties: {
                expression: {
                  type: 'string',
                  description: 'JavaScript code snippet to evaluate (e.g. "window.location.pathname" or "document.title").',
                },
              },
              required: ['expression'],
            },
          },
          {
            name: 'get_dom_diff',
            description: 'Compare current DOM state with previous scan to list added, removed, or changed elements.',
            inputSchema: {
              type: 'object',
              properties: {},
            },
          },
          {
            name: 'toggle_visual_hud',
            description:
              'Toggle real-time visual bounding box overlays and @eX tags in Chrome so human users can see what the AI sees.',
            inputSchema: {
              type: 'object',
              properties: {
                enabled: {
                  type: 'boolean',
                  description: 'True to show visual tags and bounding boxes, false to remove them.',
                },
              },
              required: ['enabled'],
            },
          },
          {
            name: 'get_browser_status',
            description: 'Check whether the DOM_X extension/browser tab is actively connected and inspect active tab info.',
            inputSchema: {
              type: 'object',
              properties: {},
            },
          },

          // ─── DOM-VLM Tools (Zero-Cost VLM Replacement) ───────────────────
          {
            name: 'vlm_perceive',
            description:
              '[DOM-VLM] Zero-cost visual perception of the current browser page. Replaces screenshot-based VLMs (GPT-4o Vision, Moondream, Claude Vision). ' +
              'Returns a structured visual scene with bounding boxes, spatial layout, element groups, Set-of-Mark element IDs, and an LLM-readable text description. ' +
              'Cost: $0.00 | Latency: ~5–15ms | No GPU | No API calls | Works on any website.',
            inputSchema: {
              type: 'object',
              properties: {
                format: {
                  type: 'string',
                  enum: ['text', 'json', 'full'],
                  description: '"text" = LLM-ready scene description only, "json" = structured scene object, "full" = both text + JSON.',
                  default: 'text',
                },
              },
            },
          },
          {
            name: 'vlm_locate',
            description:
              '[DOM-VLM] Natural language element locator. Finds browser elements by semantic intent without screenshots or VLM inference. ' +
              'Example: vlm_locate({ query: "the checkout button" }) returns the element with its bounding box and @eX action ID. ' +
              'Cost: $0.00 | Latency: ~2–8ms | Works on any website.',
            inputSchema: {
              type: 'object',
              properties: {
                query: {
                  type: 'string',
                  description: 'Natural language description of the element to find (e.g. "submit button", "email input", "sign in link", "price of the first product").',
                },
                kind: {
                  type: 'string',
                  enum: ['button', 'link', 'input', 'textarea', 'select', 'checkbox', 'radio', 'heading', 'image', 'modal', 'dialog', 'alert', 'navigation', 'form', 'card', 'tab', 'menu'],
                  description: 'Optional: narrow the search to a specific element kind.',
                },
                region: {
                  type: 'string',
                  enum: ['top-left', 'top-center', 'top-right', 'middle-left', 'middle-center', 'middle-right', 'bottom-left', 'bottom-center', 'bottom-right'],
                  description: 'Optional: restrict matches to a specific viewport region.',
                },
                topK: {
                  type: 'number',
                  description: 'Number of top matches to return (default: 1).',
                  default: 1,
                },
              },
              required: ['query'],
            },
          },
          {
            name: 'vlm_describe_scene',
            description:
              '[DOM-VLM] Generates a compact, LLM-readable natural language description of the current browser viewport. ' +
              'Equivalent to sending a screenshot to a VLM and asking "describe this page" — but with zero cost, zero API calls, and ~5ms latency. ' +
              'Ideal for providing page context to LLMs before issuing action commands.',
            inputSchema: {
              type: 'object',
              properties: {},
            },
          },
        ],
      };
    });

    // 2. Call tool execution
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args = {} } = request.params;

      try {
        switch (name) {
          case 'get_page_dom': {
            const format = (args.format as string) || 'summary';
            const snapshot = await this.bridge.sendCommand('GET_DOM', {
              visibleOnly: args.visibleOnly ?? true,
              preset: args.preset || 'interactive',
              query: args.query,
              search: args.search,
            });

            if (format === 'json') {
              return {
                content: [{ type: 'text', text: JSON.stringify(snapshot, null, 2) }],
              };
            }

            return {
              content: [{ type: 'text', text: snapshot.formattedSummary || JSON.stringify(snapshot) }],
            };
          }

          case 'get_dom_mutations': {
            const limit = Number(args.limit) || 20;
            const clear = Boolean(args.clearAfterRead);
            const events = this.bridge.getMutations(limit, clear);

            if (events.length === 0) {
              return {
                content: [{ type: 'text', text: 'No recent DOM mutation events captured (page is stable).' }],
              };
            }

            const formatted = events
              .map((e, idx) => {
                const el = e.targetElement ? `${e.targetElement.tag} (${e.targetElement.selector})` : 'DOM';
                const text = e.targetElement?.textSnippet ? ` "${e.targetElement.textSnippet}"` : '';
                return `[Event #${idx + 1}] ${e.type} on ${el}${text} at +${e.timestamp}ms`;
              })
              .join('\n');

            return {
              content: [
                {
                  type: 'text',
                  text: `Captured ${events.length} meaningful DOM mutations:\n${formatted}`,
                },
              ],
            };
          }

          case 'wait_for_dom_change': {
            const timeoutMs = Number(args.timeoutMs) || 5000;
            const eventType = args.eventType as string | undefined;

            const evt = await this.bridge.waitForMutation(
              eventType ? (e) => e.type === eventType : undefined,
              timeoutMs
            );

            return {
              content: [
                {
                  type: 'text',
                  text: `Observed DOM mutation: ${evt.type} on <${evt.targetElement?.tag || 'node'}> (${evt.targetElement?.selector || ''})`,
                },
              ],
            };
          }

          case 'click_element': {
            const target = String(args.target || '');
            const result = await this.bridge.sendCommand('CLICK', { target });
            return {
              content: [{ type: 'text', text: result.message || `Clicked element ${target}` }],
            };
          }

          case 'hover_element': {
            const target = String(args.target || '');
            const result = await this.bridge.sendCommand('HOVER', { target });
            return {
              content: [{ type: 'text', text: result.message || `Hovered over element ${target}` }],
            };
          }

          case 'type_into_element': {
            const target = String(args.target || '');
            const text = String(args.text || '');
            const clearFirst = Boolean(args.clearFirst);
            const pressEnter = Boolean(args.pressEnter);

            const result = await this.bridge.sendCommand('TYPE', {
              target,
              text,
              clearFirst,
              pressEnter,
            });
            return {
              content: [{ type: 'text', text: result.message || `Typed "${text}" into ${target}` }],
            };
          }

          case 'select_option': {
            const target = String(args.target || '');
            const valueOrText = String(args.valueOrText || '');
            const result = await this.bridge.sendCommand('SELECT_OPTION', { target, valueOrText });
            return {
              content: [{ type: 'text', text: result.message || `Selected option in ${target}` }],
            };
          }

          case 'press_key': {
            const key = String(args.key || 'Enter');
            const target = args.target ? String(args.target) : undefined;
            const modifiers = {
              ctrl: Boolean(args.ctrl),
              alt: Boolean(args.alt),
              shift: Boolean(args.shift),
              meta: Boolean(args.meta),
            };

            const result = await this.bridge.sendCommand('PRESS_KEY', { key, target, modifiers });
            return {
              content: [{ type: 'text', text: result.message || `Pressed key ${key}` }],
            };
          }

          case 'inspect_element': {
            const target = String(args.target || '');
            const result = await this.bridge.sendCommand('INSPECT', { target });
            return {
              content: [{ type: 'text', text: JSON.stringify(result.inspection || result, null, 2) }],
            };
          }

          case 'navigate_to': {
            const url = String(args.url || '');
            const result = await this.bridge.sendCommand('NAVIGATE', { url });
            return {
              content: [{ type: 'text', text: result.message || `Navigated to ${url}` }],
            };
          }

          case 'eval_script': {
            const expression = String(args.expression || '');
            const result = await this.bridge.sendCommand('EVAL', { expression });
            if (!result.success) {
              return {
                isError: true,
                content: [{ type: 'text', text: `Eval Error: ${result.error || 'Execution failed'}` }],
              };
            }
            return {
              content: [{ type: 'text', text: JSON.stringify(result.result, null, 2) }],
            };
          }

          case 'get_dom_diff': {
            const result = await this.bridge.sendCommand('GET_DIFF', {});
            return {
              content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
            };
          }

          case 'scroll_page': {
            const direction = (args.direction as string) || 'down';
            const amount = Number(args.amount) || 400;
            const target = args.target as string | undefined;

            const result = await this.bridge.sendCommand('SCROLL', {
              direction,
              amount,
              target,
            });
            return {
              content: [{ type: 'text', text: result.message || `Scrolled ${direction}` }],
            };
          }

          case 'highlight_element': {
            const target = String(args.target || '');
            const color = (args.color as string) || '#38bdf8';
            const result = await this.bridge.sendCommand('HIGHLIGHT', { target, color });
            return {
              content: [{ type: 'text', text: result.message || `Highlighted ${target}` }],
            };
          }

          case 'toggle_visual_hud': {
            const enabled = Boolean(args.enabled);
            await this.bridge.sendCommand('TOGGLE_HUD', { enabled });
            return {
              content: [
                {
                  type: 'text',
                  text: enabled
                    ? 'Visual HUD enabled in Chrome. Bounding boxes and @eX tags are now visible over interactive elements.'
                    : 'Visual HUD disabled in Chrome.',
                },
              ],
            };
          }

          case 'get_browser_status': {
            const status = this.bridge.getStatus();
            return {
              content: [{ type: 'text', text: JSON.stringify(status, null, 2) }],
            };
          }

          // ─── DOM-VLM Tool Handlers ──────────────────────────────────────────────────
          case 'vlm_perceive': {
            const format = (args.format as string) || 'text';
            const result = await this.bridge.sendCommand('VLM_PERCEIVE', {});

            if (!result.success && result.message) {
              return {
                isError: true,
                content: [{ type: 'text', text: `DOM-VLM Error: ${result.message}` }],
              };
            }

            if (format === 'json') {
              return {
                content: [{ type: 'text', text: JSON.stringify(result.scene || result, null, 2) }],
              };
            } else if (format === 'full') {
              return {
                content: [
                  { type: 'text', text: result.sceneText || '' },
                  { type: 'text', text: '\n\n--- JSON Scene ---\n' + JSON.stringify(result.scene || result, null, 2) },
                ],
              };
            }

            return {
              content: [
                {
                  type: 'text',
                  text:
                    (result.sceneText || 'No scene data.') +
                    `\n\n[DOM-VLM] Cost: ${result.cost ?? '$0.00'} | Elapsed: ${result.elapsedMs ?? '?'}ms`,
                },
              ],
            };
          }

          case 'vlm_locate': {
            const query = String(args.query || '');
            if (!query) {
              return {
                isError: true,
                content: [{ type: 'text', text: 'DOM-VLM Error: "query" parameter is required for vlm_locate.' }],
              };
            }

            const result = await this.bridge.sendCommand('VLM_LOCATE', {
              query,
              kind: args.kind,
              region: args.region,
              topK: Number(args.topK) || 1,
            });

            if (!result.found || !result.matches || result.matches.length === 0) {
              return {
                content: [
                  {
                    type: 'text',
                    text: `[DOM-VLM] Element not found for query: "${query}"\nTip: Try a broader query or use vlm_perceive to see all visible elements first.`,
                  },
                ],
              };
            }

            const matchLines = result.matches.map((m: any, i: number) => {
              const el = m.element;
              return [
                `Match #${i + 1} (score: ${(m.score * 100).toFixed(0)}%) — Reason: ${m.reason}`,
                `  Action ID: ${el.actionId}`,
                `  Kind: ${el.kind} | Label: "${el.label}"`,
                `  Click target: (${el.bbox.centerX}, ${el.bbox.centerY})`,
                `  Region: ${el.region} | In Viewport: ${el.inViewport}`,
                `  Selector: ${el.selector}`,
              ].join('\n');
            });

            return {
              content: [
                {
                  type: 'text',
                  text: `[DOM-VLM] Located "${query}" — ${result.matches.length} match(es) in ${result.elapsedMs}ms:\n\n${matchLines.join('\n\n')}`,
                },
              ],
            };
          }

          case 'vlm_describe_scene': {
            const result = await this.bridge.sendCommand('VLM_DESCRIBE', {});
            return {
              content: [
                {
                  type: 'text',
                  text: result.description || result.sceneText || 'No scene description available.',
                },
              ],
            };
          }

          default:
            throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          isError: true,
          content: [{ type: 'text', text: `DOM_X Error: ${message}` }],
        };
      }
    });
  }
}
