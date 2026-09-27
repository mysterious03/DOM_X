/**
 * DOMPulse Core Engine
 * Coordinates observation, filtering, grouping, deduplication, navigation tracking,
 * latency measurement, and event dispatch.
 */

import {
  DOMPulseEvent,
  EventBatch,
  EngineConfig,
  PipelineMetrics,
} from './types';
import { DOMObserver } from './observer';
import { processAndGroupMutations } from './grouping';
import { NavigationObserver } from './navigation';

export type EventBatchListener = (batch: EventBatch) => void;
export type MetricsListener = (metrics: PipelineMetrics) => void;

const DEFAULT_CONFIG: EngineConfig = {
  debounceMs: 80,
  maxWaitMs: 200,
  observeAttributes: true,
  observeCharacterData: true,
  observeChildList: true,
  observeSubtree: true,
  ignoreHiddenElements: true,
};

export class DOMPulseEngine {
  private config: EngineConfig;
  private observer: DOMObserver;
  private navObserver: NavigationObserver;
  private batchListeners: Set<EventBatchListener> = new Set();
  private metricsListeners: Set<MetricsListener> = new Set();

  private rawMutationsTotal = 0;
  private filteredMutationsTotal = 0;
  private deduplicatedMutationsTotal = 0;
  private meaningfulEventsTotal = 0;
  private lastEventTimestamp: number | null = null;
  private eventHistory: DOMPulseEvent[] = [];
  private maxHistorySize = 200;

  private totalBatchesProcessed = 0;
  private totalProcessingTimeMs = 0;

  constructor(customConfig?: Partial<EngineConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...customConfig };
    this.observer = new DOMObserver(this.config, this.handleRawBatch.bind(this));
    this.navObserver = new NavigationObserver(this.handleNavigationEvent.bind(this));
  }

  public start(root: Node = document.documentElement): void {
    this.observer.start(root);
    this.navObserver.start();
    this.notifyMetrics();
  }

  public stop(): void {
    this.observer.stop();
    this.navObserver.stop();
    this.notifyMetrics();
  }

  public pause(): void {
    this.observer.pause();
    this.navObserver.stop();
    this.notifyMetrics();
  }

  public resume(root: Node = document.documentElement): void {
    this.observer.resume(root);
    this.navObserver.start();
    this.notifyMetrics();
  }

  public flush(): void {
    this.observer.flush();
  }

  public onBatch(listener: EventBatchListener): () => void {
    this.batchListeners.add(listener);
    return () => this.batchListeners.delete(listener);
  }

  public onMetrics(listener: MetricsListener): () => void {
    this.metricsListeners.add(listener);
    return () => this.metricsListeners.delete(listener);
  }

  public getMetrics(): PipelineMetrics {
    const total = this.rawMutationsTotal;
    const meaningful = this.meaningfulEventsTotal;
    const compressionRatio = total > 0 ? Number(((total - meaningful) / total).toFixed(4)) : 0;
    const averageLatencyMs = this.totalBatchesProcessed > 0
      ? Number((this.totalProcessingTimeMs / this.totalBatchesProcessed).toFixed(2))
      : 0;

    return {
      rawMutations: total,
      filteredMutations: this.filteredMutationsTotal,
      deduplicatedMutations: this.deduplicatedMutationsTotal,
      meaningfulEvents: meaningful,
      compressionRatio,
      lastEventTimestamp: this.lastEventTimestamp,
      averageLatencyMs,
      isActive: this.observer.getStatus(),
    };
  }

  public getRecentEvents(limit = 50): DOMPulseEvent[] {
    return this.eventHistory.slice(-limit);
  }

  public clear(): void {
    this.rawMutationsTotal = 0;
    this.filteredMutationsTotal = 0;
    this.deduplicatedMutationsTotal = 0;
    this.meaningfulEventsTotal = 0;
    this.lastEventTimestamp = null;
    this.totalBatchesProcessed = 0;
    this.totalProcessingTimeMs = 0;
    this.eventHistory = [];
    this.notifyMetrics();
  }

  private handleRawBatch(rawRecords: MutationRecord[]): void {
    if (rawRecords.length === 0) return;

    const { batch, rawCount, filteredCount, deduplicatedCount, processingTimeMs } = processAndGroupMutations(rawRecords, this.config.excludeSelectors ?? []);

    this.rawMutationsTotal += rawCount;
    this.filteredMutationsTotal += filteredCount;
    this.deduplicatedMutationsTotal += deduplicatedCount;

    this.totalBatchesProcessed += 1;
    this.totalProcessingTimeMs += processingTimeMs;

    if (batch.events.length > 0) {
      this.meaningfulEventsTotal += batch.events.length;
      this.lastEventTimestamp = batch.timestamp;

      this.eventHistory.push(...batch.events);
      if (this.eventHistory.length > this.maxHistorySize) {
        this.eventHistory = this.eventHistory.slice(-this.maxHistorySize);
      }

      for (const listener of this.batchListeners) {
        try {
          listener(batch);
        } catch (err) {
          console.error('[DOMPulse] Error in batch listener:', err);
        }
      }
    }

    this.notifyMetrics();
  }

  private handleNavigationEvent(navEvent: DOMPulseEvent): void {
    const now = Date.now();
    this.meaningfulEventsTotal += 1;
    this.lastEventTimestamp = now;

    this.eventHistory.push(navEvent);
    if (this.eventHistory.length > this.maxHistorySize) {
      this.eventHistory = this.eventHistory.slice(-this.maxHistorySize);
    }

    const navBatch: EventBatch = {
      batchId: `nav_batch_${now}`,
      timestamp: now,
      events: [navEvent],
      summary: `Navigation detected: ${navEvent.after}`,
      changes: [`Navigated from ${navEvent.before} to ${navEvent.after}`],
      rawMutationsCount: 1,
      filteredMutationsCount: 0,
      deduplicatedMutationsCount: 0,
      processingTimeMs: 0.1,
    };

    for (const listener of this.batchListeners) {
      try {
        listener(navBatch);
      } catch (err) {
        console.error('[DOMPulse] Error in navigation batch listener:', err);
      }
    }

    this.notifyMetrics();
  }

  private notifyMetrics(): void {
    const metrics = this.getMetrics();
    for (const listener of this.metricsListeners) {
      try {
        listener(metrics);
      } catch (err) {
        console.error('[DOMPulse] Error in metrics listener:', err);
      }
    }
  }
}
