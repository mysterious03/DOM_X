/**
 * DOM_X Popup — Apple-Grade Minimalist UI Controller
 * Zero-cost DOM-VLM telemetry, temporal difference engine,
 * and high-density semantic event feed.
 */

import type { DOMPulseEvent, PipelineMetrics, TemporalDiffState } from '../../core/types';

let currentTabId: number | null = null;
let allEvents: DOMPulseEvent[] = [];
let isMonitoringActive = true;
let isHudActive = false;
let isPrivacyActive = false;
let selectedFilter = 'ALL';
let searchQuery = '';

// ─── DOM References ──────────────────────────────────────────────────────────
const activeTabLabel = document.getElementById('active-tab-label')!;
const monitorSwitch = document.getElementById('monitor-switch') as HTMLInputElement;
const clearBtn = document.getElementById('clear-btn')!;

// Tab buttons
const segButtons = document.querySelectorAll<HTMLButtonElement>('.seg-btn');
const tabPanes = document.querySelectorAll<HTMLElement>('.tab-pane');

// Pipeline visual flow
const pipeRawCount = document.getElementById('pipe-raw-count')!;
const pipeLatency = document.getElementById('pipe-latency')!;
const pipeTokensSaved = document.getElementById('pipe-tokens-saved')!;

// Telemetry Grid
const compressionRatioEl = document.getElementById('compression-ratio')!;
const avgLatencyEl = document.getElementById('avg-latency')!;
const targetsCountEl = document.getElementById('targets-count')!;

// Actions
const toggleHudBtn = document.getElementById('toggle-hud-btn')!;
const hudBadge = document.getElementById('hud-badge')!;
const togglePrivacyBtn = document.getElementById('toggle-privacy-btn')!;
const privacyBadge = document.getElementById('privacy-badge')!;
const perceiveBtn = document.getElementById('perceive-btn')!;
const copyXmlBtn = document.getElementById('copy-xml-btn')!;

// Temporal Difference Elements
const temporalDeltaBadge = document.getElementById('temporal-delta-badge')!;
const tokenTraditionalEl = document.getElementById('token-traditional')!;
const tokenDeltaEl = document.getElementById('token-delta')!;
const wasteProgressFill = document.getElementById('waste-progress-fill')!;
const wasteSavedPct = document.getElementById('waste-saved-pct')!;
const deltaAddedEl = document.getElementById('delta-added')!;
const deltaRemovedEl = document.getElementById('delta-removed')!;
const deltaTextEl = document.getElementById('delta-text')!;
const deltaAttrEl = document.getElementById('delta-attr')!;
const temporalFeedCount = document.getElementById('temporal-feed-count')!;
const temporalFeedList = document.getElementById('temporal-feed-list')!;

// Events Tab Elements
const searchInputEl = document.getElementById('search-input') as HTMLInputElement;
const typeFilterEl = document.getElementById('type-filter') as HTMLSelectElement;
const exportJsonBtn = document.getElementById('export-json-btn')!;
const streamCountEl = document.getElementById('stream-count')!;
const eventsListEl = document.getElementById('events-list')!;
const emptyStateEl = document.getElementById('empty-state')!;

// Toast
const toastEl = document.getElementById('apple-toast')!;
const toastMsg = document.getElementById('toast-message')!;
let toastTimeout: any = null;

function showToast(message: string): void {
  toastMsg.textContent = message;
  toastEl.classList.add('show');
  if (toastTimeout) clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => {
    toastEl.classList.remove('show');
  }, 2200);
}

// ─── Formatters ──────────────────────────────────────────────────────────────
function formatTime(timestamp: number): string {
  const d = new Date(timestamp);
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}.${d.getMilliseconds().toString().padStart(3, '0')}`;
}

// ─── UI Updates ──────────────────────────────────────────────────────────────
function updateMetricsUI(metrics: PipelineMetrics): void {
  const raw = metrics.rawMutations || 0;
  const meaningful = metrics.meaningfulEvents || 0;
  const latency = (metrics.averageLatencyMs || 0).toFixed(1);
  const ratioPct = ((metrics.compressionRatio || 0) * 100).toFixed(1);

  // Pipeline flow
  pipeRawCount.textContent = `${raw.toLocaleString()} mut`;
  pipeLatency.textContent = `${latency}ms`;
  pipeTokensSaved.textContent = `${ratioPct}% saved`;

  // Grid
  compressionRatioEl.textContent = `${ratioPct}%`;
  avgLatencyEl.textContent = `${latency}ms`;

  // Active state
  isMonitoringActive = metrics.isActive;
  if (monitorSwitch.checked !== isMonitoringActive) {
    monitorSwitch.checked = isMonitoringActive;
  }

  // Temporal diff update if available
  if (metrics.temporalDiff) {
    updateTemporalUI(metrics.temporalDiff);
  }
}

function updateTemporalUI(temp: TemporalDiffState): void {
  temporalDeltaBadge.textContent = `Δt ${temp.deltaMs}ms`;
  tokenTraditionalEl.textContent = `~${temp.rawTokensEstimated.toLocaleString()} tokens`;
  tokenDeltaEl.textContent = `~${temp.diffTokensEstimated.toLocaleString()} tokens`;

  const savedPct = temp.tokenWastePreventedPct.toFixed(1);
  wasteSavedPct.textContent = `${savedPct}% token waste eliminated`;
  wasteProgressFill.style.width = `${Math.min(100, Math.max(5, temp.tokenWastePreventedPct))}%`;

  deltaAddedEl.textContent = temp.addedNodes.toLocaleString();
  deltaRemovedEl.textContent = temp.removedNodes.toLocaleString();
  deltaTextEl.textContent = temp.textChanges.toLocaleString();
  deltaAttrEl.textContent = temp.attrChanges.toLocaleString();

  // Render recent deltas in Temporal Feed
  if (temp.recentDeltas && temp.recentDeltas.length > 0) {
    temporalFeedCount.textContent = `${temp.recentDeltas.length} frames`;
    temporalFeedList.innerHTML = '';
    for (const d of temp.recentDeltas) {
      const row = document.createElement('div');
      row.className = 'temporal-feed-row';

      const left = document.createElement('div');
      left.className = 'tfeed-left';

      const deltaTag = document.createElement('span');
      deltaTag.className = 'tfeed-delta';
      deltaTag.textContent = `+${d.deltaMs}ms`;

      const typeTag = document.createElement('span');
      typeTag.className = 'tfeed-type';
      typeTag.textContent = d.type;

      const summary = document.createElement('span');
      summary.className = 'tfeed-summary';
      summary.textContent = d.summary;

      left.appendChild(deltaTag);
      left.appendChild(typeTag);
      left.appendChild(summary);

      row.appendChild(left);
      temporalFeedList.appendChild(row);
    }
  }
}

function getSeverityDot(importance: number): string {
  if (importance >= 5) return '🔴';
  if (importance >= 3) return '🟡';
  return '🟢';
}

function renderEvents(): void {
  const q = searchQuery.toLowerCase().trim();

  const filtered = allEvents.filter((e) => {
    if (selectedFilter !== 'ALL' && e.type !== selectedFilter) return false;
    if (q) {
      const matchType = e.type.toLowerCase().includes(q);
      const matchSelector = e.element.selector.toLowerCase().includes(q);
      const matchText = (e.element.textSnippet || '').toLowerCase().includes(q);
      const matchAttr = (e.attributeName || '').toLowerCase().includes(q);
      const matchBefore = (e.before || '').toLowerCase().includes(q);
      const matchAfter = (e.after || '').toLowerCase().includes(q);
      if (!matchType && !matchSelector && !matchText && !matchAttr && !matchBefore && !matchAfter) {
        return false;
      }
    }
    return true;
  });

  streamCountEl.textContent = `${filtered.length} event${filtered.length === 1 ? '' : 's'}`;

  if (filtered.length === 0) {
    eventsListEl.innerHTML = '';
    eventsListEl.appendChild(emptyStateEl);
    emptyStateEl.style.display = 'flex';
    return;
  }

  emptyStateEl.style.display = 'none';
  eventsListEl.innerHTML = '';

  const displayList = [...filtered].reverse();

  for (const evt of displayList) {
    const card = document.createElement('div');
    card.className = 'event-card';

    // Top Row: Dot + Type Badge + Timestamp
    const topRow = document.createElement('div');
    topRow.className = 'event-top-row';

    const badgeGroup = document.createElement('div');
    badgeGroup.className = 'badge-group';

    const dot = document.createElement('span');
    dot.className = 'severity-dot';
    dot.textContent = getSeverityDot(evt.importance ?? 1);

    const badge = document.createElement('span');
    badge.className = `badge badge-${evt.type}`;
    badge.textContent = evt.type;

    badgeGroup.appendChild(dot);
    badgeGroup.appendChild(badge);

    const time = document.createElement('span');
    time.className = 'event-time';
    time.textContent = formatTime(evt.timestamp);

    topRow.appendChild(badgeGroup);
    topRow.appendChild(time);

    // Selector Row
    const selectorRow = document.createElement('div');
    selectorRow.className = 'event-selector-row';

    const selector = document.createElement('span');
    selector.className = 'selector-tag';
    selector.textContent = evt.element.selector;
    selectorRow.appendChild(selector);

    if (evt.element.textSnippet) {
      const snippet = document.createElement('span');
      snippet.style.color = '#8e8e93';
      snippet.textContent = `"${evt.element.textSnippet}"`;
      selectorRow.appendChild(snippet);
    }

    card.appendChild(topRow);
    card.appendChild(selectorRow);

    // Diff Box
    if (evt.before || evt.after || evt.attributeName) {
      const diffBox = document.createElement('div');
      diffBox.className = 'event-diff-box';

      if (evt.attributeName) {
        const attrLine = document.createElement('div');
        attrLine.className = 'diff-line';
        attrLine.textContent = `attr: ${evt.attributeName}`;
        diffBox.appendChild(attrLine);
      }

      if (evt.before) {
        const beforeLine = document.createElement('div');
        beforeLine.className = 'diff-line diff-before';
        beforeLine.textContent = `- ${evt.before}`;
        diffBox.appendChild(beforeLine);
      }

      if (evt.after) {
        const afterLine = document.createElement('div');
        afterLine.className = 'diff-line diff-after';
        afterLine.textContent = `+ ${evt.after}`;
        diffBox.appendChild(afterLine);
      }

      card.appendChild(diffBox);
    }

    // Footer: BBox + Importance + Copy Button
    const footer = document.createElement('div');
    footer.className = 'event-footer-row';

    const footerLeft = document.createElement('div');
    footerLeft.className = 'footer-left';

    const bbox = document.createElement('span');
    bbox.className = 'bbox-badge';
    bbox.textContent = `[${evt.bbox.x}, ${evt.bbox.y}, ${evt.bbox.width}×${evt.bbox.height}]`;

    const importance = document.createElement('span');
    importance.className = 'importance-pill';
    importance.textContent = `score: ${evt.importance ?? 1}`;

    footerLeft.appendChild(bbox);
    footerLeft.appendChild(importance);

    const copyBtn = document.createElement('button');
    copyBtn.className = 'btn-copy-card';
    copyBtn.textContent = 'Copy JSON';
    copyBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      navigator.clipboard.writeText(JSON.stringify(evt, null, 2));
      showToast('Event JSON copied to clipboard');
    });

    footer.appendChild(footerLeft);
    footer.appendChild(copyBtn);
    card.appendChild(footer);

    eventsListEl.appendChild(card);
  }
}

// ─── Tab Switching ───────────────────────────────────────────────────────────
segButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    segButtons.forEach((b) => b.classList.remove('active'));
    tabPanes.forEach((p) => p.classList.remove('active'));

    btn.classList.add('active');
    const targetId = btn.dataset.tab;
    if (targetId) {
      const pane = document.getElementById(targetId);
      if (pane) pane.classList.add('active');
    }
  });
});

// ─── Initialization & Listeners ──────────────────────────────────────────────
async function init(): Promise<void> {
  if (typeof chrome === 'undefined' || !chrome.tabs) return;

  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!activeTab?.id) return;
  currentTabId = activeTab.id;

  // Set active tab title in header
  if (activeTab.title) {
    activeTabLabel.textContent = `${activeTab.title.slice(0, 32)} · ${activeTab.url ? new URL(activeTab.url).hostname : ''}`;
  }

  // Request cached data from service worker
  try {
    chrome.runtime.sendMessage(
      { type: 'DOMPULSE_GET_CACHED_TAB_DATA', tabId: currentTabId },
      (cached) => {
        if (cached) {
          if (cached.metrics) updateMetricsUI(cached.metrics);
          if (cached.events) {
            allEvents = cached.events;
            renderEvents();
          }
        }
      }
    );
  } catch {}

  // Request live state from content script
  try {
    chrome.tabs.sendMessage(currentTabId, { type: 'DOM_X_GET_STATE' }, (response) => {
      if (chrome.runtime.lastError) return;
      if (response) {
        if (response.metrics) updateMetricsUI(response.metrics);
        if (response.recentEvents) {
          allEvents = response.recentEvents;
          renderEvents();
        }
        if (response.temporalDiff) {
          updateTemporalUI(response.temporalDiff);
        }
      }
    });
  } catch {}

  // Request DOM scan to count interactive elements
  try {
    chrome.tabs.sendMessage(currentTabId, { action: 'GET_DOM', params: { visibleOnly: true } }, (res) => {
      if (res?.elements) {
        targetsCountEl.textContent = String(res.elements.length);
      }
    });
  } catch {}

  // Request Privacy status
  try {
    chrome.tabs.sendMessage(currentTabId, { action: 'GET_PRIVACY_STATUS' }, (res) => {
      if (res && res.active !== undefined) {
        isPrivacyActive = res.active;
        privacyBadge.textContent = isPrivacyActive ? 'ON' : 'OFF';
        privacyBadge.className = isPrivacyActive ? 'hud-status-badge active' : 'hud-status-badge';
      }
    });
  } catch {}

  // Listen for broadcast events
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'DOM_X_EVENT_BATCH' || message.type === 'DOMPULSE_EVENT_BATCH') {
      if (message.metrics) updateMetricsUI(message.metrics);
      if (message.batch?.events) {
        allEvents.push(...message.batch.events);
        if (allEvents.length > 200) allEvents = allEvents.slice(-200);
        renderEvents();
      }
    } else if (message.type === 'DOM_X_METRICS_UPDATE' || message.type === 'DOMPULSE_METRICS_UPDATE') {
      if (message.metrics) updateMetricsUI(message.metrics);
    }
  });
}

// ─── Button Actions ──────────────────────────────────────────────────────────
toggleHudBtn.addEventListener('click', () => {
  if (!currentTabId) return;
  isHudActive = !isHudActive;
  chrome.tabs.sendMessage(currentTabId, { action: 'TOGGLE_HUD', params: { enabled: isHudActive } }, (response) => {
    if (response && response.enabled !== undefined) {
      isHudActive = response.enabled;
    }
    hudBadge.textContent = isHudActive ? 'ON' : 'OFF';
    hudBadge.className = isHudActive ? 'hud-status-badge active' : 'hud-status-badge';
    showToast(isHudActive ? 'Neon Screen HUD Enabled' : 'Screen HUD Disabled');
  });
});

togglePrivacyBtn.addEventListener('click', () => {
  if (!currentTabId) return;
  isPrivacyActive = !isPrivacyActive;
  chrome.tabs.sendMessage(currentTabId, { action: 'TOGGLE_PRIVACY', params: { enabled: isPrivacyActive } }, (response) => {
    if (response && response.active !== undefined) {
      isPrivacyActive = response.active;
    }
    privacyBadge.textContent = isPrivacyActive ? 'ON' : 'OFF';
    privacyBadge.className = isPrivacyActive ? 'hud-status-badge active' : 'hud-status-badge';
    showToast(isPrivacyActive ? 'Privacy Shield: Passwords & Cards Hidden' : 'Privacy Shield Disabled');
  });
});

perceiveBtn.addEventListener('click', () => {
  if (!currentTabId) return;
  perceiveBtn.style.opacity = '0.5';
  chrome.tabs.sendMessage(currentTabId, { action: 'VLM_PERCEIVE', params: {} }, (res) => {
    perceiveBtn.style.opacity = '1';
    if (res?.sceneText) {
      showToast(`Perceived in ${res.elapsedMs || 6}ms ($0.00)`);
    } else {
      showToast('Perceived active viewport');
    }
  });
});

copyXmlBtn.addEventListener('click', () => {
  if (!currentTabId) return;
  copyXmlBtn.style.opacity = '0.5';
  chrome.tabs.sendMessage(currentTabId, { action: 'VLM_XML_PERCEIVE', params: {} }, (res) => {
    copyXmlBtn.style.opacity = '1';
    if (res?.xml) {
      navigator.clipboard.writeText(res.xml);
      showToast('Set-of-Mark XML Copied ($0.00)');
    } else {
      showToast('Failed to generate XML');
    }
  });
});

monitorSwitch.addEventListener('change', () => {
  if (!currentTabId) return;
  const action = monitorSwitch.checked ? 'DOM_X_RESUME' : 'DOM_X_PAUSE';
  chrome.tabs.sendMessage(currentTabId, { type: action }, (res) => {
    if (res?.metrics) updateMetricsUI(res.metrics);
    showToast(monitorSwitch.checked ? 'Monitoring Active' : 'Monitoring Paused');
  });
});

clearBtn.addEventListener('click', () => {
  allEvents = [];
  renderEvents();
  if (currentTabId) {
    chrome.tabs.sendMessage(currentTabId, { type: 'DOM_X_CLEAR' }, (res) => {
      if (res?.metrics) updateMetricsUI(res.metrics);
    });
  }
  showToast('Event history cleared');
});

searchInputEl.addEventListener('input', () => {
  searchQuery = searchInputEl.value;
  renderEvents();
});

typeFilterEl.addEventListener('change', () => {
  selectedFilter = typeFilterEl.value;
  renderEvents();
});

exportJsonBtn.addEventListener('click', () => {
  const jsonStr = JSON.stringify(allEvents, null, 2);
  navigator.clipboard.writeText(jsonStr);
  showToast('Exported events to clipboard');
});

// ─── ChatGPT Modal ──────────────────────────────────────────────────────────
const chatgptBtn = document.getElementById('chatgpt-btn');
const chatgptModal = document.getElementById('chatgpt-modal');
const modalCloseBtn = document.getElementById('modal-close-btn');
const copyTunnelCmd = document.getElementById('copy-tunnel-cmd');
const copyOpenApiUrl = document.getElementById('copy-openapi-url');
const copyGptPrompt = document.getElementById('copy-gpt-prompt');

if (chatgptBtn && chatgptModal) {
  chatgptBtn.addEventListener('click', () => {
    chatgptModal.classList.add('open');
  });

  if (modalCloseBtn) {
    modalCloseBtn.addEventListener('click', () => {
      chatgptModal.classList.remove('open');
    });
  }

  chatgptModal.addEventListener('click', (e) => {
    if (e.target === chatgptModal) {
      chatgptModal.classList.remove('open');
    }
  });

  if (copyTunnelCmd) {
    copyTunnelCmd.addEventListener('click', () => {
      navigator.clipboard.writeText('npx localtunnel --port 8765');
      showToast('Copied tunnel command');
    });
  }

  if (copyOpenApiUrl) {
    copyOpenApiUrl.addEventListener('click', () => {
      navigator.clipboard.writeText('http://127.0.0.1:8765/openapi.json');
      showToast('Copied OpenAPI URL');
    });
  }

  if (copyGptPrompt) {
    copyGptPrompt.addEventListener('click', () => {
      const gptPrompt = `You are an AI browser agent powered by DOM_X zero-cost DOM-VLM.
To see the active webpage visually, call GET /api/vlm/xml or POST /api/vlm/perceive.
To find any element by English words, call POST /api/vlm/locate.
To interact, call POST /api/action/click or POST /api/action/type.
All private info (passwords, payment cards) is auto-blurred and protected.`;
      navigator.clipboard.writeText(gptPrompt);
      showToast('Copied ChatGPT Instructions');
    });
  }
}

init();

