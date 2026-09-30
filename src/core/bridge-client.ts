/**
 * DOMPulse Browser Bridge Client
 * Connects browser tabs (via Content Script or Testbench) to the DOMPulse MCP Server via WebSocket.
 */

import { DOMAgentPerceiver } from './agent-dom';
import { DOMPulseEngine } from './engine';
import { DOMPulseEvent } from './types';
import type { DOMVLMEngine } from './vlm-engine';

export interface BridgeConfig {
  wsUrl?: string;
  autoReconnect?: boolean;
  reconnectIntervalMs?: number;
}

export class DOMPulseBridgeClient {
  private ws: WebSocket | null = null;
  private wsUrl: string;
  private autoReconnect: boolean;
  private reconnectIntervalMs: number;
  private isConnected: boolean = false;
  private perceiver: DOMAgentPerceiver;
  private engine: DOMPulseEngine | null = null;
  private vlmEngine: DOMVLMEngine | null = null;

  constructor(config: BridgeConfig = {}) {
    this.wsUrl = config.wsUrl || 'ws://127.0.0.1:8765';
    this.autoReconnect = config.autoReconnect ?? true;
    this.reconnectIntervalMs = config.reconnectIntervalMs || 3000;
    this.perceiver = new DOMAgentPerceiver();
  }

  public attachEngine(engine: DOMPulseEngine): void {
    this.engine = engine;
    this.engine.onBatch((batch) => {
      this.sendMutationBatch(batch.events);
    });
  }

  public attachVLMEngine(vlm: DOMVLMEngine): void {
    this.vlmEngine = vlm;
  }

  public getPerceiver(): DOMAgentPerceiver {
    return this.perceiver;
  }

  public connect(): void {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    try {
      this.ws = new WebSocket(this.wsUrl);

      this.ws.onopen = () => {
        this.isConnected = true;
        console.log(`[DOM_X Bridge] Connected to MCP bridge at ${this.wsUrl}`);
        this.send({
          type: 'TAB_READY',
          url: window.location.href,
          title: document.title,
        });
      };

      this.ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          this.handleServerMessage(msg);
        } catch (err) {
          console.error('[DOM_X Bridge] Failed to parse message:', err);
        }
      };

      this.ws.onclose = () => {
        this.isConnected = false;
        if (this.autoReconnect) {
          setTimeout(() => this.connect(), this.reconnectIntervalMs);
        }
      };

      this.ws.onerror = () => {
        // Silently close and retry; bridge might start later
        if (this.ws) {
          this.ws.close();
        }
      };
    } catch {
      if (this.autoReconnect) {
        setTimeout(() => this.connect(), this.reconnectIntervalMs);
      }
    }
  }

  public disconnect(): void {
    this.autoReconnect = false;
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  public sendMutationBatch(events: DOMPulseEvent[]): void {
    if (!this.isConnected || !this.ws) return;
    this.send({
      type: 'DOM_MUTATIONS',
      url: window.location.href,
      events,
    });
  }

  private send(data: unknown): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  private handleServerMessage(msg: { id: string; action: string; params?: Record<string, unknown> }): void {
    const { id, action, params = {} } = msg;

    try {
      switch (action) {
        case 'GET_DOM': {
          const snapshot = this.perceiver.scan({
            visibleOnly: (params.visibleOnly as boolean) ?? true,
            interactiveOnly: (params.interactiveOnly as boolean) ?? true,
          });
          this.send({ id, success: true, result: snapshot });
          break;
        }

        case 'CLICK': {
          const target = String(params.target || '');
          const res = this.perceiver.click(target);
          this.send({ id, ...res });
          break;
        }

        case 'TYPE': {
          const target = String(params.target || '');
          const text = String(params.text || '');
          const clearFirst = Boolean(params.clearFirst);
          const pressEnter = Boolean(params.pressEnter);
          const res = this.perceiver.type(target, text, { clearFirst, pressEnter });
          this.send({ id, ...res });
          break;
        }

        case 'SCROLL': {
          const dir = (params.direction as 'up' | 'down' | 'top' | 'bottom' | 'element') || 'down';
          const amt = Number(params.amount) || 400;
          const target = params.target ? String(params.target) : undefined;
          const res = this.perceiver.scroll(dir, amt, target);
          this.send({ id, ...res });
          break;
        }

        case 'HIGHLIGHT': {
          const target = String(params.target || '');
          const color = params.color ? String(params.color) : '#f59e0b';
          const res = this.perceiver.highlight(target, color);
          this.send({ id, ...res });
          break;
        }

        case 'HOVER': {
          const target = String(params.target || '');
          const res = this.perceiver.hover(target);
          this.send({ id, ...res });
          break;
        }

        case 'SELECT_OPTION': {
          const target = String(params.target || '');
          const valueOrText = String(params.valueOrText || '');
          const res = this.perceiver.selectOption(target, valueOrText);
          this.send({ id, ...res });
          break;
        }

        case 'PRESS_KEY': {
          const key = String(params.key || 'Enter');
          const target = params.target ? String(params.target) : undefined;
          const modifiers = (params.modifiers as any) || {};
          const res = this.perceiver.pressKey(key, target, modifiers);
          this.send({ id, ...res });
          break;
        }

        case 'INSPECT': {
          const target = String(params.target || '');
          const res = this.perceiver.inspect(target);
          this.send({ id, ...res });
          break;
        }

        case 'EVAL': {
          const expr = String(params.expression || '');
          const res = this.perceiver.evalScript(expr);
          this.send({ id, ...res });
          break;
        }

        case 'NAVIGATE': {
          const url = String(params.url || '');
          const res = this.perceiver.navigate(url);
          this.send({ id, ...res });
          break;
        }

        case 'GET_DIFF': {
          const snapshot = this.perceiver.scan();
          const diff = this.perceiver.computeDiff(snapshot);
          this.send({ id, success: true, result: diff });
          break;
        }

        case 'TOGGLE_HUD': {
          const enabled = params.enabled !== undefined ? Boolean(params.enabled) : undefined;
          const active = this.perceiver.toggleHUD(enabled);
          this.send({ id, success: true, hudActive: active });
          break;
        }

        // ─── DOM-VLM Actions ─────────────────────────────────────
        case 'VLM_PERCEIVE': {
          if (!this.vlmEngine) {
            this.send({ id, success: false, message: 'DOM-VLM Engine is not attached to this tab' });
            break;
          }
          try {
            const output = this.vlmEngine.perceive(Boolean(params.forceRefresh));
            this.perceiver.registerExternalElements(this.vlmEngine.getElementMap());
            this.perceiver.flashHUD(typeof params.highlightDuration === 'number' ? params.highlightDuration : 2500);
            this.send({ id, success: true, result: { success: true, ...output } });
          } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            this.send({ id, success: false, message });
          }
          break;
        }

        case 'VLM_LOCATE': {
          if (!this.vlmEngine) {
            this.send({ id, success: false, message: 'DOM-VLM Engine is not attached to this tab' });
            break;
          }
          try {
            const query = String(params.query || '');
            const topK = typeof params.topK === 'number' ? params.topK : 3;
            const output = this.vlmEngine.locate({ query, topK, kind: params.kind as any, region: params.region as any });
            this.perceiver.registerExternalElements(this.vlmEngine.getElementMap());
            if (output.found && output.matches.length > 0) {
              this.perceiver.highlight(output.matches[0].element.actionId, '#10b981');
            }
            this.send({ id, success: true, result: { success: true, ...output } });
          } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            this.send({ id, success: false, message });
          }
          break;
        }

        case 'VLM_DESCRIBE': {
          if (!this.vlmEngine) {
            this.send({ id, success: false, message: 'DOM-VLM Engine is not attached to this tab' });
            break;
          }
          try {
            const description = this.vlmEngine.describeScene();
            this.send({ id, success: true, result: { success: true, description, sceneText: description } });
          } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            this.send({ id, success: false, message });
          }
          break;
        }

        case 'VLM_XML_PERCEIVE': {
          if (!this.vlmEngine) {
            this.send({ id, success: false, message: 'DOM-VLM Engine is not attached to this tab' });
            break;
          }
          try {
            const output = this.vlmEngine.perceiveXml(Boolean(params.forceRefresh));
            this.perceiver.registerExternalElements(this.vlmEngine.getElementMap());
            this.perceiver.flashHUD(typeof params.highlightDuration === 'number' ? params.highlightDuration : 2500);
            this.send({ id, success: true, result: { success: true, ...output } });
          } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            this.send({ id, success: false, message });
          }
          break;
        }


        default:
          this.send({ id, success: false, message: `Unknown bridge action: ${action}` });
          break;
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.send({ id, success: false, message });
    }
  }
}
