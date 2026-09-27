/**
 * DOM_X Background Service Worker (Manifest V3)
 * Relays events, caches active tab metrics, and manages badge states.
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

// Handle tab close cleanup
chrome.tabs.onRemoved.addListener((tabId) => {
  tabCache.delete(tabId);
});

// Listen for messages from content scripts or popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const tabId = sender.tab?.id;

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
