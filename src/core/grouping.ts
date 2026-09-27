/**
 * DOMPulse Grouping, Deduplication & Correlation Module
 * Follows "Reject early. Analyze late." Aggregates mutations, verifies persistence,
 * collapses redundant operations, caches geometry per target, and generates correlated batch summaries.
 */

import {
  DOMPulseEvent,
  EventBatch,
  FilterResult,
  BoundingBox,
  VisibilityState,
} from './types';
import {
  isIgnoredNode,
  isExcludedBySelector,
  filterAttributeMutation,
  filterCharacterDataMutation,
  filterChildListMutation,
} from './filter';
import {
  classifyAttributeMutation,
  classifyChildListMutation,
  computeImportanceScore,
} from './classifier';
import {
  getBoundingBox,
  getVisibilityState,
  describeElement,
} from './geometry';

function generateEventId(): string {
  // Use random base-36 suffix to prevent same-millisecond ID collisions across concurrent instances
  return `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export interface GroupingResult {
  batch: EventBatch;
  rawCount: number;
  filteredCount: number;
  deduplicatedCount: number;
  processingTimeMs: number;
}

/**
 * Processes a collection of raw MutationRecords collected within the debounce window.
 * @param rawMutations - Raw MutationRecords from the observer.
 * @param excludeSelectors - Optional CSS selectors for subtrees to ignore (see EngineConfig.excludeSelectors).
 */
export function processAndGroupMutations(
  rawMutations: MutationRecord[],
  excludeSelectors: string[] = []
): GroupingResult {
  const startTime = performance.now();
  const rawCount = rawMutations.length;
  let filteredCount = 0;
  let deduplicatedCount = 0;

  // Intermediate state maps:
  const textMutationMap = new Map<Node, { target: Node; initialBefore: string | null; count: number }>();
  const attributeMutationMap = new Map<string, { target: Element; attrName: string; initialBefore: string | null; count: number }>();
  const childListMap = new Map<Node, { addedCount: number; removedCount: number; sampleAdded?: Node; sampleRemoved?: Node; record: MutationRecord; count: number }>();

  // Geometry cache per batch to prevent repeated getBoundingClientRect / getComputedStyle calls
  const geometryCache = new Map<Node, { bbox: BoundingBox; visibility: VisibilityState }>();

  function getCachedGeometry(node: Node) {
    if (geometryCache.has(node)) {
      return geometryCache.get(node)!;
    }
    const bbox = getBoundingBox(node);
    const visibility = getVisibilityState(node, bbox);
    const entry = { bbox, visibility };
    geometryCache.set(node, entry);
    return entry;
  }

  // PHASE 1: CHEAP FILTER & BUFFERING (Reject early)
  for (const record of rawMutations) {
    try {
      // Stage 0: User-defined subtree exclusions
      if (isExcludedBySelector(record.target, excludeSelectors)) {
        filteredCount++;
        continue;
      }

      // Stage 1: Structural node filter
      if (isIgnoredNode(record.target)) {
        filteredCount++;
        continue;
      }

      if (record.type === 'attributes') {
        const el = record.target as Element;
        const attrName = record.attributeName || '';
        const key = `${el.tagName}_${el.id || ''}_${attrName}`;

        if (!attributeMutationMap.has(key)) {
          attributeMutationMap.set(key, {
            target: el,
            attrName,
            initialBefore: record.oldValue,
            count: 1,
          });
        } else {
          const existing = attributeMutationMap.get(key)!;
          existing.count += 1;
          deduplicatedCount += 1;
        }
      } else if (record.type === 'characterData') {
        const target = record.target;
        if (!textMutationMap.has(target)) {
          textMutationMap.set(target, {
            target,
            initialBefore: record.oldValue,
            count: 1,
          });
        } else {
          const existing = textMutationMap.get(target)!;
          existing.count += 1;
          deduplicatedCount += 1;
        }
      } else if (record.type === 'childList') {
        const filterRes = filterChildListMutation(record);
        if (!filterRes.passed) {
          filteredCount++;
          continue;
        }

        const parentNode = record.target;
        if (!childListMap.has(parentNode)) {
          let sampleAdded: Node | undefined;
          let sampleRemoved: Node | undefined;

          for (const n of Array.from(record.addedNodes)) {
            if (!isIgnoredNode(n)) {
              sampleAdded = n;
              break;
            }
          }
          for (const n of Array.from(record.removedNodes)) {
            if (!isIgnoredNode(n)) {
              sampleRemoved = n;
              break;
            }
          }

          childListMap.set(parentNode, {
            addedCount: record.addedNodes.length,
            removedCount: record.removedNodes.length,
            sampleAdded,
            sampleRemoved,
            record,
            count: 1,
          });
        } else {
          const existing = childListMap.get(parentNode)!;
          existing.addedCount += record.addedNodes.length;
          existing.removedCount += record.removedNodes.length;
          existing.count += 1;
          deduplicatedCount += 1;
        }
      }
    } catch (err) {
      console.warn('[DOMPulse] Error filtering raw mutation:', err);
      filteredCount++;
    }
  }

  // PHASE 2: PERSISTENCE & ANALYZE LATE (Evaluate net change across batch)
  const events: DOMPulseEvent[] = [];
  const correlatedChanges: string[] = [];
  const now = Date.now();

  // 1. Evaluate Text Mutations
  for (const [, item] of textMutationMap) {
    try {
      const before = item.initialBefore;
      const after = item.target.textContent;

      const filterRes = filterCharacterDataMutation(before, after);
      if (!filterRes.passed) {
        filteredCount += item.count;
        continue;
      }

      const { bbox, visibility } = getCachedGeometry(item.target);
      const element = describeElement(item.target);
      const importance = computeImportanceScore('TEXT_CHANGED');

      events.push({
        eventId: generateEventId(),
        type: 'TEXT_CHANGED',
        timestamp: now,
        element,
        before,
        after,
        bbox,
        visibility,
        importance,
      });

      correlatedChanges.push(`${element.selector} text changed ("${before || ''}" → "${after || ''}")`);
    } catch (err) {
      console.warn('[DOMPulse] Error processing text mutation:', err);
    }
  }

  // 2. Evaluate Attribute Mutations
  for (const [, item] of attributeMutationMap) {
    try {
      const before = item.initialBefore;
      const after = item.target.getAttribute(item.attrName);

      // Persistence Check & Cheap Attribute Filter:
      const filterRes: FilterResult = filterAttributeMutation(item.target, item.attrName, before, after);
      if (!filterRes.passed) {
        filteredCount += item.count;
        continue;
      }

      const eventType = classifyAttributeMutation(item.target, item.attrName, before, after);
      const importance = computeImportanceScore(eventType, item.attrName);

      if (importance === 0) {
        filteredCount += item.count;
        continue;
      }

      const { bbox, visibility } = getCachedGeometry(item.target);
      const element = describeElement(item.target);

      events.push({
        eventId: generateEventId(),
        type: eventType,
        timestamp: now,
        element,
        attributeName: item.attrName,
        before,
        after,
        bbox,
        visibility,
        importance,
      });

      correlatedChanges.push(`${element.selector} ${item.attrName} changed`);
    } catch (err) {
      console.warn('[DOMPulse] Error processing attribute mutation:', err);
    }
  }

  // 3. Evaluate ChildList Mutations
  for (const [parentNode, item] of childListMap) {
    try {
      if (item.addedCount === 0 && item.removedCount === 0) {
        continue;
      }

      const focusTarget = item.sampleAdded || item.sampleRemoved || parentNode;
      const { bbox, visibility } = getCachedGeometry(focusTarget);
      const eventType = classifyChildListMutation(item.record);
      const importance = computeImportanceScore(eventType);

      const element = describeElement(focusTarget);
      let beforeSummary: string | null = null;
      let afterSummary: string | null = null;

      if (eventType === 'TEXT_CHANGED') {
        beforeSummary = item.sampleRemoved?.textContent || null;
        afterSummary = (parentNode instanceof Element ? parentNode.textContent : null) || item.sampleAdded?.textContent || null;
        correlatedChanges.push(`${element.selector} text changed ("${beforeSummary || ''}" → "${afterSummary || ''}")`);
      } else if (item.addedCount > 0 && item.removedCount === 0) {
        afterSummary = `Added ${item.addedCount} node(s)`;
        if (eventType === 'DIALOG_APPEARED') {
          correlatedChanges.push(`Dialog opened (${element.selector})`);
        } else if (eventType === 'NOTIFICATION_APPEARED') {
          correlatedChanges.push(`Notification appeared (${element.selector})`);
        } else {
          correlatedChanges.push(`${element.selector} added ${item.addedCount} node(s)`);
        }
      } else if (item.removedCount > 0 && item.addedCount === 0) {
        beforeSummary = `Removed ${item.removedCount} node(s)`;
        correlatedChanges.push(`${element.selector} removed ${item.removedCount} node(s)`);
      } else {
        beforeSummary = `Removed ${item.removedCount} node(s)`;
        afterSummary = `Added ${item.addedCount} node(s)`;
        correlatedChanges.push(`${element.selector} modified (+${item.addedCount}/-${item.removedCount})`);
      }

      events.push({
        eventId: generateEventId(),
        type: eventType,
        timestamp: now,
        element,
        before: beforeSummary,
        after: afterSummary,
        bbox,
        visibility,
        importance,
        metadata: {
          addedNodesCount: item.addedCount,
          removedNodesCount: item.removedCount,
        },
      });
    } catch (err) {
      console.warn('[DOMPulse] Error processing childList mutation:', err);
    }
  }

  const processingTimeMs = Number((performance.now() - startTime).toFixed(2));
  const batchId = `batch_${now}_${Math.random().toString(36).slice(2, 8)}`;
  const summary = events.length === 0
    ? 'No meaningful changes detected'
    : `${events.length} change(s): ${events.map((e) => e.type).join(', ')}`;

  const batch: EventBatch = {
    batchId,
    timestamp: now,
    events,
    summary,
    changes: correlatedChanges,
    rawMutationsCount: rawCount,
    filteredMutationsCount: filteredCount,
    deduplicatedMutationsCount: deduplicatedCount,
    processingTimeMs,
  };

  return {
    batch,
    rawCount,
    filteredCount,
    deduplicatedCount,
    processingTimeMs,
  };
}
