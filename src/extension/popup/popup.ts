/**
 * DOMPulse Popup Developer Event Viewer
 * Controls monitoring status, visualizes event stream with importance scoring,
 * free-text search, and real-time noise & latency telemetry.
 */

import { DOMPulseEvent, PipelineMetrics } from '../../core/types';

let currentTabId: number | null = null;
let allEvents: DOMPulseEvent[] = [];
let isMonitoringActive = true;
let selectedFilter = 'ALL';
let searchQuery = '';

// DOM Elements
const rawCountEl = document.getElementById('raw-count')!;
const filteredCountEl = document.getElementById('filtered-count')!;
const dedupedCountEl = document.getElementById('deduped-count')!;
const meaningfulCountEl = document.getElementById('meaningful-count')!;
const compressionRatioEl = document.getElementById('compression-ratio')!;
const avgLatencyEl = document.getElementById('avg-latency')!;
const statusIndicatorEl = document.getElementById('status-indicator')!;
const statusTextEl = document.getElementById('status-text')!;
const toggleMonitorBtn = document.getElementById('toggle-monitor-btn')!;
const clearBtn = document.getElementById('clear-btn')!;
const searchInputEl = document.getElementById('search-input') as HTMLInputElement;
const typeFilterEl = document.getElementById('type-filter') as HTMLSelectElement;
const exportJsonBtn = document.getElementById('export-json-btn')!;
const streamCountEl = document.getElementById('stream-count')!;
const eventsListEl = document.getElementById('events-list')!;
const emptyStateEl = document.getElementById('empty-state')!;

function formatTime(timestamp: number): string {
  const d = new Date(timestamp);
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}.${d.getMilliseconds().toString().padStart(3, '0')}`;
}

function updateMetricsUI(metrics: PipelineMetrics): void {
  rawCountEl.textContent = metrics.rawMutations.toLocaleString();
  filteredCountEl.textContent = metrics.filteredMutations.toLocaleString();
  dedupedCountEl.textContent = (metrics.deduplicatedMutations || 0).toLocaleString();
  meaningfulCountEl.textContent = metrics.meaningfulEvents.toLocaleString();

  const percentage = (metrics.compressionRatio * 100).toFixed(1);
  compressionRatioEl.textContent = `${percentage}%`;

  avgLatencyEl.textContent = `${(metrics.averageLatencyMs || 0).toFixed(1)}ms`;

  isMonitoringActive = metrics.isActive;
  if (isMonitoringActive) {
    statusIndicatorEl.className = 'status-dot active';
    statusTextEl.textContent = 'Active';
  } else {
    statusIndicatorEl.className = 'status-dot paused';
    statusTextEl.textContent = 'Paused';
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
    // 1. Type dropdown filter
    if (selectedFilter !== 'ALL' && e.type !== selectedFilter) {
      return false;
    }

    // 2. Free-text search query
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
      snippet.className = 'text-muted';
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
        const attrLabel = document.createElement('span');
        attrLabel.style.color = '#94a3b8';
        attrLabel.textContent = 'attr:';
        const attrValue = document.createElement('span');
        attrValue.style.color = '#38bdf8';
        attrValue.textContent = evt.attributeName; // safe: textContent, not innerHTML
        attrLine.appendChild(attrLabel);
        attrLine.appendChild(document.createTextNode(' '));
        attrLine.appendChild(attrValue);
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
      copyBtn.textContent = 'Copied!';
      setTimeout(() => (copyBtn.textContent = 'Copy JSON'), 1200);
    });

    footer.appendChild(footerLeft);
    footer.appendChild(copyBtn);
    card.appendChild(footer);

    eventsListEl.appendChild(card);
  }
}

async function init(): Promise<void> {
  if (typeof chrome === 'undefined' || !chrome.tabs) {
    return;
  }

  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!activeTab?.id) return;
  currentTabId = activeTab.id;

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
  } catch {
    // Service worker unavailable
  }

  try {
    chrome.tabs.sendMessage(currentTabId, { type: 'DOMPULSE_GET_STATE' }, (response) => {
      if (chrome.runtime.lastError) return;
      if (response) {
        if (response.metrics) updateMetricsUI(response.metrics);
        if (response.recentEvents) {
          allEvents = response.recentEvents;
          renderEvents();
        }
      }
    });
  } catch {
    // Content script not ready
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'DOMPULSE_EVENT_BATCH') {
      if (message.metrics) updateMetricsUI(message.metrics);
      if (message.batch?.events) {
        allEvents.push(...message.batch.events);
        if (allEvents.length > 200) {
          allEvents = allEvents.slice(-200);
        }
        renderEvents();
      }
    } else if (message.type === 'DOMPULSE_METRICS_UPDATE') {
      if (message.metrics) updateMetricsUI(message.metrics);
    }
  });
}

toggleMonitorBtn.addEventListener('click', () => {
  if (!currentTabId) return;
  const action = isMonitoringActive ? 'DOMPULSE_PAUSE' : 'DOMPULSE_RESUME';
  chrome.tabs.sendMessage(currentTabId, { type: action }, (response) => {
    if (response?.metrics) {
      updateMetricsUI(response.metrics);
    }
  });
});

clearBtn.addEventListener('click', () => {
  allEvents = [];
  renderEvents();
  if (currentTabId) {
    chrome.tabs.sendMessage(currentTabId, { type: 'DOMPULSE_CLEAR' }, (response) => {
      if (response?.metrics) {
        updateMetricsUI(response.metrics);
      }
    });
  }
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
  exportJsonBtn.textContent = 'JSON Copied!';
  setTimeout(() => (exportJsonBtn.textContent = 'Export JSON'), 1500);
});

init();
