/**
 * DOM_X Background Service Worker (Manifest V3)
 * Maintains persistent WebSocket connection to the DOM_X MCP Server Bridge (ws://127.0.0.1:8765),
 * relays tool commands to active webpage content scripts, forwards 15ms DOM mutations,
 * and manages badge status.
 *
 * NOTE: Connecting from the Service Worker completely bypasses webpage CSP (Content Security Policy)
 * and Mixed Content blocks, guaranteeing 100% connectivity on all HTTPS sites (GitHub, Google, Amazon, etc.).
 */

interface TabData {
  metrics: {
    rawMutations: number;
    filteredMutations: number;
    meaningfulEvents: number;
    compressionRatio: number;
    lastEventTimestamp: number | null;
    isActive: boolean;
  };
  events: unknown[];
}

const tabCache = new Map<number, TabData>();

let ws: WebSocket | null = null;
let isConnected = false;
const BRIDGE_URL = 'ws://127.0.0.1:8765';

/**
 * Initializes and maintains WebSocket connection to DOM_X MCP server.
 */
function connectBridge(): void {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    return;
  }

  try {
    ws = new WebSocket(BRIDGE_URL);

    ws.onopen = () => {
      isConnected = true;
      console.log('[DOM_X Background] Connected to MCP Bridge on', BRIDGE_URL);
      notifyActiveTab();
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        handleBridgeCommand(msg);
      } catch (err) {
        console.error('[DOM_X Background] Error parsing bridge message:', err);
      }
    };

    ws.onclose = () => {
      isConnected = false;
      setTimeout(connectBridge, 3000);
    };

    ws.onerror = () => {
      if (ws) {
        ws.close();
      }
    };
  } catch {
    setTimeout(connectBridge, 3000);
  }
}

/**
 * Sends a message back to the DOM_X MCP Bridge.
 */
function sendToBridge(payload: unknown): void {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

/**
 * Proactively verifies if content script is loaded; if not, dynamically injects it.
 */
async function ensureContentScript(tabId: number, url?: string): Promise<boolean> {
  if (!url || url.startsWith('chrome://') || url.startsWith('chrome-extension://') || url.startsWith('edge://') || url.startsWith('about:')) {
    return false;
  }
  if (!chrome.scripting) {
    return false;
  }

  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, { action: 'PING' }, async (res) => {
      if (chrome.runtime.lastError || !res?.pong) {
        try {
          console.log(`[DOM_X Background] Proactively injecting content.js into tab ${tabId} (${url})...`);
          await chrome.scripting.executeScript({
            target: { tabId },
            files: ['content.js'],
          });
          resolve(true);
        } catch {
          resolve(false);
        }
      } else {
        resolve(true);
      }
    });
  });
}

/**
 * Informs the MCP Bridge which tab is currently active.
 */
async function notifyActiveTab(): Promise<void> {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;

  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tab = tabs[0];
    if (tab && tab.url && !tab.url.startsWith('chrome://') && !tab.url.startsWith('chrome-extension://')) {
      sendToBridge({
        type: 'TAB_READY',
        url: tab.url,
        title: tab.title || 'Untitled Page',
        tabId: tab.id,
      });

      if (tab.id) {
        ensureContentScript(tab.id, tab.url);
      }
    }
  } catch (err) {
    console.debug('[DOM_X Background] Tab query error:', err);
  }
}

/**
 * Dispatches an MCP command to the active tab's content script.
 * If the content script is not yet attached (e.g. tab opened before extension load),
 * dynamically injects content.js and retries the command automatically.
 */
async function handleBridgeCommand(msg: { id: string; action: string; params?: Record<string, unknown> }): Promise<void> {
  const { id, action, params = {} } = msg;

  if (action === 'NAVIGATE') {
    const targetUrl = params.url as string;
    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const tab = tabs[0];
      if (tab && tab.id) {
        await chrome.tabs.update(tab.id, { url: targetUrl });
        sendToBridge({ id, success: true, message: `Navigating to ${targetUrl}` });
      } else {
        const newTab = await chrome.tabs.create({ url: targetUrl });
        sendToBridge({ id, success: true, message: `Opened new tab at ${targetUrl}`, tabId: newTab.id });
      }
    } catch (err: unknown) {
      sendToBridge({ id, success: false, message: err instanceof Error ? err.message : String(err) });
    }
    return;
  }

  // Find active tab for DOM inspection / interaction
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tab = tabs[0];

    if (!tab || !tab.id) {
      sendToBridge({
        id,
        success: false,
        message: 'No active browser tab found. Please open a webpage in Chrome.',
      });
      return;
    }

    if (tab.url && (tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://') || tab.url.startsWith('edge://') || tab.url.startsWith('about:'))) {
      sendToBridge({
        id,
        success: false,
        message: 'Cannot interact with internal browser pages (chrome://). Please navigate to a real website (e.g. https://google.com).',
      });
      return;
    }

    const tabId = tab.id;

    // Helper to send message with automatic dynamic injection recovery
    const dispatchWithRetry = (isRetry = false) => {
      chrome.tabs.sendMessage(tabId, msg, async (response) => {
        if (chrome.runtime.lastError) {
          const errMsg = chrome.runtime.lastError.message || '';

          // If content script is not running in this tab, inject it on the fly
          if (!isRetry && (errMsg.includes('Receiving end does not exist') || errMsg.includes('Could not establish connection'))) {
            if (chrome.scripting) {
              try {
                console.log(`[DOM_X Background] Dynamically injecting content.js into tab ${tabId}...`);
                await chrome.scripting.executeScript({
                  target: { tabId },
                  files: ['content.js'],
                });

                // Wait 120ms for DOM listener initialization
                setTimeout(() => {
                  dispatchWithRetry(true);
                }, 120);
                return;
              } catch (injectErr: unknown) {
                console.error('[DOM_X Background] Dynamic injection failed:', injectErr);
              }
            }
          }

          sendToBridge({
            id,
            success: false,
            message: `Tab communication error: ${errMsg}. If this tab was open before loading the extension, please refresh it once (press F5 or Ctrl+R).`,
          });
          return;
        }

        sendToBridge({
          id,
          success: response ? response.success !== false : true,
          ...(response || {}),
        });
      });
    };

    dispatchWithRetry(false);
  } catch (err: unknown) {
    sendToBridge({
      id,
      success: false,
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

// Track tab activation & navigation
chrome.tabs.onActivated.addListener(() => {
  notifyActiveTab();
});

chrome.tabs.onUpdated.addListener((_tabId, changeInfo, tab) => {
  if (tab.active && (changeInfo.status === 'complete' || changeInfo.url)) {
    notifyActiveTab();
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  tabCache.delete(tabId);
});

// Listen for messages from content scripts or popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const tabId = sender.tab?.id;

  // Forward 15ms DOM mutations from content script directly to MCP Bridge
  if (message.type === 'DOM_MUTATIONS' || message.type === 'DOM_X_MUTATIONS') {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'DOM_MUTATIONS',
        url: sender.tab?.url || '',
        events: message.events || [],
      }));
    }
    sendResponse({ received: true });
    return true;
  }

  if ((message.type === 'DOM_X_EVENT_BATCH' || message.type === 'DOMPULSE_EVENT_BATCH') && tabId !== undefined) {
    let data = tabCache.get(tabId);
    if (!data) {
      data = {
        metrics: message.metrics,
        events: [],
      };
      tabCache.set(tabId, data);
    } else {
      data.metrics = message.metrics;
    }

    if (message.batch?.events) {
      data.events.push(...message.batch.events);
      if (data.events.length > 100) {
        data.events = data.events.slice(-100);
      }

      // Also forward events to MCP bridge
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'DOM_MUTATIONS',
          url: sender.tab?.url || '',
          events: message.batch.events,
        }));
      }
    }

    // Update extension action badge with meaningful event count
    const count = data.metrics.meaningfulEvents;
    const badgeText = count > 99 ? '99+' : count > 0 ? String(count) : '';
    chrome.action.setBadgeText({ tabId, text: badgeText });
    chrome.action.setBadgeBackgroundColor({ tabId, color: '#38bdf8' });

    sendResponse({ received: true });
    return true;
  }

  if ((message.type === 'DOM_X_METRICS_UPDATE' || message.type === 'DOMPULSE_METRICS_UPDATE') && tabId !== undefined) {
    const data = tabCache.get(tabId);
    if (data) {
      data.metrics = message.metrics;
    }
    sendResponse({ received: true });
    return true;
  }

  if (message.type === 'DOM_X_GET_CACHED_TAB_DATA' || message.type === 'DOMPULSE_GET_CACHED_TAB_DATA') {
    const targetTabId = message.tabId;
    const cached = tabCache.get(targetTabId);
    sendResponse(cached || null);
    return true;
  }

  return false;
});

// Boot WebSocket bridge connection
connectBridge();
