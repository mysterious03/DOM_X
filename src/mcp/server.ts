/**
 * DOMPulse MCP (Model Context Protocol) Server
 * Exposes browser perception, DOM change-intelligence, and action tools to AI agents.
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
                interactiveOnly: {
                  type: 'boolean',
                  description: 'If true (default), filters for interactive nodes (buttons, inputs, links, forms, dialogs).',
                  default: true,
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
              interactiveOnly: args.interactiveOnly ?? true,
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

            const formatted = events.map((e, idx) => {
              const el = e.targetElement ? `${e.targetElement.tag} (${e.targetElement.selector})` : 'DOM';
              const text = e.targetElement?.textSnippet ? ` "${e.targetElement.textSnippet}"` : '';
              return `[Event #${idx + 1}] ${e.type} on ${el}${text} at +${e.timestamp}ms`;
            }).join('\n');

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
            const result = await this.bridge.sendCommand('TOGGLE_HUD', { enabled });
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
