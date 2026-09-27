/**
 * DOMPulse Core Types
 * Defines the contract for observation, filtering, classification, and event delivery.
 */

export type SemanticEventType =
  | 'TEXT_CHANGED'
  | 'ELEMENT_ADDED'
  | 'ELEMENT_REMOVED'
  | 'ATTRIBUTE_CHANGED'
  | 'VISIBILITY_CHANGED'
  | 'STATE_CHANGED'
  | 'FORM_CHANGED'
  | 'DIALOG_APPEARED'
  | 'NOTIFICATION_APPEARED'
  | 'NAVIGATION_DETECTED';

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface VisibilityState {
  visible: boolean;
  inViewport: boolean;
}

export interface ElementDescriptor {
  tag: string;
  id?: string;
  classes: string[];
  selector: string;
  role?: string;
  name?: string;
  textSnippet?: string;
}

export interface DOMPulseEvent {
  eventId: string;
  type: SemanticEventType;
  timestamp: number;
  element: ElementDescriptor;
  before?: string | null;
  after?: string | null;
  attributeName?: string;
  bbox: BoundingBox;
  visibility: VisibilityState;
  importance: number; // 0 (discard), 1-2 (low), 3-4 (interesting), 5+ (critical)
  metadata?: Record<string, unknown>;
}

export interface EventBatch {
  batchId: string;
  timestamp: number;
  events: DOMPulseEvent[];
  summary: string;
  changes: string[]; // Correlated human-readable change list
  rawMutationsCount: number;
  filteredMutationsCount: number;
  deduplicatedMutationsCount: number;
  processingTimeMs?: number;
}

export interface PipelineMetrics {
  rawMutations: number;
  filteredMutations: number;
  deduplicatedMutations: number;
  meaningfulEvents: number;
  compressionRatio: number; // e.g. 0.985 = 98.5% noise eliminated
  lastEventTimestamp: number | null;
  averageLatencyMs: number;
  isActive: boolean;
}

export interface FilterResult {
  passed: boolean;
  reason?: string;
}

export interface EngineConfig {
  debounceMs: number;
  maxWaitMs: number;
  observeAttributes: boolean;
  observeCharacterData: boolean;
  observeChildList: boolean;
  observeSubtree: boolean;
  ignoreHiddenElements: boolean;
  /**
   * Optional CSS selectors for DOM subtrees to exclude from observation.
   * Example: ['#live-chat-widget', '.cookie-banner', '[data-analytics]']
   * Any node whose closest ancestor matches one of these selectors will be silently ignored.
   */
  excludeSelectors?: string[];
}
