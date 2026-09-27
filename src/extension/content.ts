/**
 * DOM_X Content Script
 * Injected into webpages to observe DOM mutations, filter noise,
 * stream structured events to Chrome runtime and MCP server,
 * and execute AI perception actions (DOM scanning, click, type, HUD).
 */

import { DOMPulseEngine } from '../core/engine';
import { DOMPulseBridgeClient } from '../core/bridge-client';
import { EventBatch, PipelineMetrics } from '../core/types';

// Declare window augmentation for in-page AI agent consumption
declare global {
  interface Window {
    __DOM_X__?: {
      getMetrics: () => PipelineMetrics;
      getRecentEvents: (limit?: number) => unknown[];
      pause: () => void;
      resume: () => void;
      clear: () => void;
      scan: (options?: { visibleOnly?: boolean; interactiveOnly?: boolean }) => unknown;
      toggleHUD: (enabled: boolean) => boolean;
      click: (target: string) => unknown;
      type: (target: string, text: string) => unknown;
    };
    __DOMPULSE__?: Window['__DOM_X__'];
  }
}

console.log('[DOM_X] Content script active. Initializing perception engine & AI MCP bridge...');

const engine = new DOMPulseEngine({
  debounceMs: 80,
  observeAttributes: true,
  observeCharacterData: true,
  observeChildList: true,
  observeSubtree: true,
});

// Initialize WebSocket bridge client connecting to local MCP server
const bridgeClient = new DOMPulseBridgeClient({
  wsUrl: 'ws://127.0.0.1:8765',
  autoReconnect: true,
  reconnectIntervalMs: 3000,
});
bridgeClient.attachEngine(engine);
bridgeClient.connect();

const perceiver = bridgeClient.getPerceiver();

// Expose in-page programmatic API for browser agents
const api = {
  getMetrics: () => engine.getMetrics(),
  getRecentEvents: (limit?: number) => engine.getRecentEvents(limit),
  pause: () => engine.pause(),
  resume: () => engine.resume(),
  clear: () => engine.clear(),
  scan: (options?: { visibleOnly?: boolean; interactiveOnly?: boolean }) => perceiver.scan(options),
  toggleHUD: (enabled: boolean) => perceiver.toggleHUD(enabled),
  click: (target: string) => perceiver.click(target),
  type: (target: string, text: string) => perceiver.type(target, text),
};

window.__DOM_X__ = api;
window.__DOMPULSE__ = api;

// Dispatch events to window and Chrome runtime
engine.onBatch((batch: EventBatch) => {
  // 1. Dispatch custom DOM event for in-page agents/scripts
  try {
    window.dispatchEvent(
      new CustomEvent('domx:batch', {
        detail: batch,
      })
    );

    for (const evt of batch.events) {
      window.dispatchEvent(
        new CustomEvent('domx:event', {
          detail: evt,
        })
      );
    }
  } catch (err) {
    console.debug('[DOM_X] In-page dispatch error:', err);
  }

  // 2. Dispatch to Chrome Extension background/popup
  try {
    if (typeof chrome !== 'undefined' && chrome.runtime?.id) {
      chrome.runtime.sendMessage({
        type: 'DOM_X_EVENT_BATCH',
        batch,
        metrics: engine.getMetrics(),
      }).catch(() => {
        // Popup or background might not be open/listening; this is expected
      });
    }
  } catch {
    // Extension context might be invalid during hot-reload
  }
});

// Broadcast metrics updates
engine.onMetrics((metrics) => {
  try {
    if (typeof chrome !== 'undefined' && chrome.runtime?.id) {
      chrome.runtime.sendMessage({
        type: 'DOM_X_METRICS_UPDATE',
        metrics,
      }).catch(() => {});
    }
  } catch {
    // Context invalidated
  }
});

// Listen for commands from Background Service Worker or Popup
if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    const action = message.action || message.type;
    const params = message.params || message;

    try {
      switch (action) {
        case 'GET_DOM': {
          const snapshot = perceiver.scan({
            visibleOnly: (params.visibleOnly as boolean) ?? true,
            preset: (params.preset as any) || 'interactive',
            query: params.query as string,
            search: params.search as string,
          });
          sendResponse({ success: true, ...snapshot });
          break;
        }

        case 'CLICK': {
          const res = perceiver.click(params.target as string);
          sendResponse(res);
          break;
        }

        case 'TYPE': {
          const res = perceiver.type(params.target as string, (params.text as string) || '', {
            clearFirst: params.clearFirst as boolean,
            pressEnter: params.pressEnter as boolean,
          });
          sendResponse(res);
          break;
        }

        case 'SELECT': {
          const res = perceiver.selectOption(params.target as string, params.valueOrText as string);
          sendResponse(res);
          break;
        }

        case 'HOVER': {
          const res = perceiver.hover(params.target as string);
          sendResponse(res);
          break;
        }

        case 'SCROLL': {
          const res = perceiver.scroll({
            direction: params.direction as any,
            amount: params.amount as number,
            target: params.target as string,
          });
          sendResponse(res);
          break;
        }

        case 'KEYPRESS': {
          const res = perceiver.pressKey(params.key as string, {
            target: params.target as string,
            ctrl: params.ctrl as boolean,
            shift: params.shift as boolean,
            alt: params.alt as boolean,
            meta: params.meta as boolean,
          });
          sendResponse(res);
          break;
        }

        case 'HIGHLIGHT': {
          const res = perceiver.highlight(params.target as string, params.color as string);
          sendResponse(res);
          break;
        }

        case 'TOGGLE_HUD': {
          const enabled = perceiver.toggleHUD(params.enabled !== undefined ? Boolean(params.enabled) : undefined);
          sendResponse({ success: true, enabled });
          break;
        }

        case 'INSPECT': {
          const res = perceiver.inspect(params.target as string);
          sendResponse(res);
          break;
        }

        case 'DIFF': {
          const res = perceiver.getDiff();
          sendResponse({ success: true, ...res });
          break;
        }

        case 'EVAL': {
          try {
            const evalFn = new Function(`return (${params.expression})`);
            const result = evalFn();
            sendResponse({ success: true, result });
          } catch (err: unknown) {
            sendResponse({ success: false, message: err instanceof Error ? err.message : String(err) });
          }
          break;
        }

        // Popup controls
        case 'DOM_X_GET_STATE':
        case 'DOMPULSE_GET_STATE':
          sendResponse({
            metrics: engine.getMetrics(),
            recentEvents: engine.getRecentEvents(50),
          });
          break;

        case 'DOM_X_PAUSE':
        case 'DOMPULSE_PAUSE':
          engine.pause();
          sendResponse({ success: true, metrics: engine.getMetrics() });
          break;

        case 'DOM_X_RESUME':
        case 'DOMPULSE_RESUME':
          engine.resume();
          sendResponse({ success: true, metrics: engine.getMetrics() });
          break;

        case 'DOM_X_CLEAR':
        case 'DOMPULSE_CLEAR':
          engine.clear();
          sendResponse({ success: true, metrics: engine.getMetrics() });
          break;

        default:
          sendResponse({ success: false, message: `Unknown action: ${action}` });
          break;
      }
    } catch (err: unknown) {
      sendResponse({ success: false, message: err instanceof Error ? err.message : String(err) });
    }

    return true; // Keep message channel open for async response
  });
}

// Start observing when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    engine.start(document.documentElement);
  });
} else {
  engine.start(document.documentElement);
}
