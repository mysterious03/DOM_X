/**
 * DOM_X DOM-VLM Types
 * Defines the data contracts for the zero-cost DOM-based Visual Language Model (DOM-VLM) perception API.
 * This replaces screenshot-based VLMs (Moondream, GPT-4o Vision, Claude Vision) with 100% DOM-driven
 * spatial scene understanding. Zero cost. Zero latency. Zero hallucination.
 */

// ─────────────────────────────────────────────
// Spatial & Visual Primitives
// ─────────────────────────────────────────────

export interface VLMBoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
  /** Center pixel coordinates — direct action target for agents */
  centerX: number;
  centerY: number;
}

export type VLMSpatialRegion =
  | 'top-left'
  | 'top-center'
  | 'top-right'
  | 'middle-left'
  | 'middle-center'
  | 'middle-right'
  | 'bottom-left'
  | 'bottom-center'
  | 'bottom-right'
  | 'off-screen';

export type VLMElementKind =
  | 'button'
  | 'link'
  | 'input'
  | 'textarea'
  | 'select'
  | 'checkbox'
  | 'radio'
  | 'heading'
  | 'image'
  | 'icon'
  | 'text'
  | 'modal'
  | 'dialog'
  | 'alert'
  | 'navigation'
  | 'form'
  | 'card'
  | 'tab'
  | 'menu'
  | 'unknown';

// ─────────────────────────────────────────────
// VLM Scene Element — the core visual token
// ─────────────────────────────────────────────

export interface VLMElement {
  /** Unique action tag (e.g. "@e1") usable by the agent to target this element */
  actionId: string;
  /** Human-readable kind / semantic label */
  kind: VLMElementKind;
  /** Accessible label or visible text (truncated to 80 chars) */
  label: string;
  /** Raw HTML tag (e.g. BUTTON, INPUT, A) */
  tag: string;
  /** Exact bounding box with center-click coordinates */
  bbox: VLMBoundingBox;
  /** Which named region of the viewport this element lives in */
  region: VLMSpatialRegion;
  /** Whether the element is in the current viewport */
  inViewport: boolean;
  /** Whether the element is interactable right now */
  isInteractive: boolean;
  /** Whether an overlay/modal is blocking this element */
  isOccluded: boolean;
  /** Current z-index (to detect if something is layered on top) */
  zIndex: number;
  /** Current visual state flags */
  state: {
    disabled?: boolean;
    checked?: boolean;
    expanded?: boolean;
    selected?: boolean;
    focused?: boolean;
    hasValue?: boolean;
    currentValue?: string;
    href?: string;
    sensitive?: boolean;
  };
  /** CSS selector for programmatic targeting */
  selector: string;
}

// ─────────────────────────────────────────────
// VLM Scene — the full visual frame
// ─────────────────────────────────────────────

export interface VLMSceneGroup {
  /** Group label (e.g. "Navigation Bar", "Hero Section", "Checkout Form") */
  label: string;
  /** Spatial region this group lives in */
  region: VLMSpatialRegion;
  /** Elements belonging to this group */
  elements: VLMElement[];
}

export interface VLMScene {
  /** Page title */
  title: string;
  /** Full page URL */
  url: string;
  /** Unix timestamp of the perception capture */
  timestamp: number;
  /** Viewport dimensions at capture time */
  viewport: { width: number; height: number };
  /** Whether a modal/dialog is currently blocking the page */
  hasBlockingOverlay: boolean;
  /** The detected blocking overlay element (if any) */
  blockingOverlay?: VLMElement;
  /** Total interactive elements detected */
  totalInteractive: number;
  /** Elements visible in the current viewport */
  viewportElements: VLMElement[];
  /** Spatial groups (e.g. navbars, forms, card grids) */
  groups: VLMSceneGroup[];
  /** Compact LLM-readable visual scene description (no screenshots needed) */
  sceneDescription: string;
  /** Full JSON-serializable element list for agent consumption */
  elements: VLMElement[];
}

// ─────────────────────────────────────────────
// VLM Query & Location API
// ─────────────────────────────────────────────

export interface VLMLocateQuery {
  /** Natural language intent — e.g. "the login button", "search input", "price of the first product" */
  query: string;
  /** Narrow search to a specific kind of element */
  kind?: VLMElementKind;
  /** Only match elements inside this viewport region */
  region?: VLMSpatialRegion;
  /** Return top N matches (default 1) */
  topK?: number;
}

export interface VLMLocateResult {
  found: boolean;
  matches: Array<{
    element: VLMElement;
    /** Confidence score 0–1 (semantic similarity + spatial weight) */
    score: number;
    /** Why this element was matched */
    reason: string;
  }>;
  query: string;
  elapsedMs: number;
}

// ─────────────────────────────────────────────
// VLM Perceive Output (drop-in VLM replacement)
// ─────────────────────────────────────────────

export interface VLMPerceiveOutput {
  /** Compact natural language scene description (what an LLM would read instead of a screenshot) */
  sceneText: string;
  /** Structured Set-of-Mark style element list — directly actionable */
  markedElements: string;
  /** Full scene object */
  scene: VLMScene;
  /** Total processing time in milliseconds */
  elapsedMs: number;
  /** Cost of this perception — always $0.00 */
  cost: '$0.00';
}
