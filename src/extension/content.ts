/**
 * DOMPulse Content Script
 * Injected into webpages to observe DOM mutations, filter noise,
 * and dispatch structured change events to Chrome runtime and page window.
 */

import { DOMPulseEngine } from '../core/engine';
import { EventBatch, PipelineMetrics } from '../core/types';

// Declare window augmentation for in-page AI agent consumption
declare global {
  interface Window {
    __DOMPULSE__?: {
      getMetrics: () => PipelineMetrics;
      getRecentEvents: (limit?: number) => unknown[];
      pause: () => void;
      resume: () => void;
      clear: () => void;
    };
  }
}

console.log('[DOMPulse] Content script active. Initializing change-intelligence engine...');

const engine = new DOMPulseEngine({
  debounceMs: 80,
  observeAttributes: true,
  observeCharacterData: true,
  observeChildList: true,
  observeSubtree: true,
});

// Expose in-page programmatic API for browser agents (safe method wrappers only — no raw engine reference)
window.__DOMPULSE__ = {
  getMetrics: () => engine.getMetrics(),
  getRecentEvents: (limit?: number) => engine.getRecentEvents(limit),
  pause: () => engine.pause(),
  resume: () => engine.resume(),
  clear: () => engine.clear(),
};

// Dispatch events to window and Chrome runtime
engine.onBatch((batch: EventBatch) => {
  // 1. Dispatch custom DOM event for in-page agents/scripts
  try {
    window.dispatchEvent(
      new CustomEvent('dompulse:batch', {
        detail: batch,
      })
    );

    for (const evt of batch.events) {
      window.dispatchEvent(
        new CustomEvent('dompulse:event', {
          detail: evt,
        })
      );
    }
  } catch (err) {
    console.debug('[DOMPulse] In-page dispatch error:', err);
  }

  // 2. Dispatch to Chrome Extension background/popup
  try {
    if (typeof chrome !== 'undefined' && chrome.runtime?.id) {
      chrome.runtime.sendMessage({
        type: 'DOMPULSE_EVENT_BATCH',
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
        type: 'DOMPULSE_METRICS_UPDATE',
        metrics,
      }).catch(() => {});
    }
  } catch {
    // Context invalidated
  }
});

// Listen for commands from Popup or Background
if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    switch (message.type) {
      case 'DOMPULSE_GET_STATE':
        sendResponse({
          metrics: engine.getMetrics(),
          recentEvents: engine.getRecentEvents(50),
        });
        break;

      case 'DOMPULSE_PAUSE':
        engine.pause();
        sendResponse({ success: true, metrics: engine.getMetrics() });
        break;

      case 'DOMPULSE_RESUME':
        engine.resume();
        sendResponse({ success: true, metrics: engine.getMetrics() });
        break;

      case 'DOMPULSE_CLEAR':
        engine.clear();
        sendResponse({ success: true, metrics: engine.getMetrics() });
        break;

      default:
        break;
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
