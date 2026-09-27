/**
 * DOMPulse Noise Filtering Module
 * Organizes filtering into explicit, deterministic stages:
 * Stage 1: Structural noise (scripts, styles, templates, observation boundaries)
 * Stage 2: Framework internal tracking noise (hydration markers, scoped CSS IDs)
 * Stage 3: Cosmetic noise (animations, transitions, hover/focus state churn)
 * Stage 4: Duplicate & no-op mutations
 */

import { FilterResult } from './types';

// Stage 1: Obvious non-visual nodes
const IGNORED_TAGS = new Set([
  'SCRIPT',
  'STYLE',
  'LINK',
  'META',
  'NOSCRIPT',
  'TEMPLATE',
  'HEAD',
  'IFRAME', // Explicit observation boundary: Cross-origin iframes have their own isolated DOM
]);

// High-value attributes that indicate actual UI state changes
const HIGH_VALUE_ATTRIBUTES = new Set([
  'aria-expanded',
  'aria-hidden',
  'aria-selected',
  'aria-checked',
  'aria-disabled',
  'aria-invalid',
  'disabled',
  'checked',
  'selected',
  'hidden',
  'open',
  'value',
  'role',
  'data-state',
  'readonly',
  'required',
  'href',
  'src',
]);

// Semantic class tokens that represent persistent, meaningful UI state
const SEMANTIC_CLASS_KEYWORDS = [
  'active',
  'open',
  'closed',
  'show',
  'hide',
  'visible',
  'hidden',
  'disabled',
  'expanded',
  'collapsed',
  'selected',
  'checked',
  'valid',
  'invalid',
  'error',
  'success',
  'loading',
  'busy',
];

// Cosmetic class tokens that represent transient animation or interaction noise
const COSMETIC_CLASS_KEYWORDS = [
  'hover',
  'focus',
  'focus-within',
  'focus-visible',
  'active:scale',
  'ripple',
  'animate-',
  'motion-',
  'transition-',
  'cursor-',
  'animation-frame-',
  'pulse',
  'spin',
];

/**
 * Stage 1: Checks if node is an ignored tag or extension's own DOM.
 */
export function isIgnoredNode(node: Node): boolean {
  if (node instanceof Element) {
    if (IGNORED_TAGS.has(node.tagName.toUpperCase())) {
      return true;
    }

    // Ignore extension's own injected elements or developer overlay
    if (
      node.id?.startsWith('dompulse-') ||
      node.classList?.contains('dompulse-root') ||
      node.classList?.contains('dompulse-overlay')
    ) {
      return true;
    }
  }

  // Check parent chain (capped at 25 levels to prevent O(n*depth) on deeply-nested DOMs)
  let parent = node.parentElement;
  let depth = 0;
  while (parent && depth < 25) {
    if (IGNORED_TAGS.has(parent.tagName.toUpperCase())) {
      return true;
    }
    if (
      parent.id?.startsWith('dompulse-') ||
      parent.classList?.contains('dompulse-root')
    ) {
      return true;
    }
    parent = parent.parentElement;
    depth++;
  }

  return false;
}

/**
 * Stage 0: Checks if a node is within a user-defined excluded subtree.
 * Uses Element.closest() to walk up the DOM once per selector.
 * Zero overhead when excludeSelectors is empty or undefined.
 */
export function isExcludedBySelector(node: Node, excludeSelectors: string[]): boolean {
  if (!excludeSelectors || excludeSelectors.length === 0) return false;

  const element = node instanceof Element ? node : node.parentElement;
  if (!element) return false;

  for (const selector of excludeSelectors) {
    try {
      if (element.closest(selector) !== null) {
        return true;
      }
    } catch {
      // Invalid CSS selector — skip silently to avoid crashing the pipeline
    }
  }
  return false;
}

/**
 * Stages 2, 3, 4: Evaluates attribute mutations against high-value rules and cosmetic noise.
 */
export function filterAttributeMutation(
  _target: Element,
  attrName: string,
  oldValue: string | null,
  newValue: string | null
): FilterResult {
  // Stage 4: Duplicate / no-op rejection
  if (oldValue === newValue) {
    return { passed: false, reason: 'identical_attribute_value' };
  }

  const lowerAttrName = attrName.toLowerCase();

  // Stage 2: Framework internal bookkeeping attributes
  if (
    lowerAttrName.startsWith('data-v-') ||
    lowerAttrName.startsWith('data-reactid') ||
    lowerAttrName.startsWith('_ngcontent') ||
    lowerAttrName.startsWith('_nghost') ||
    lowerAttrName.startsWith('ng-') ||
    lowerAttrName === 'data-server-rendered' ||
    lowerAttrName === 'data-hydrated'
  ) {
    return { passed: false, reason: 'framework_internal_attribute' };
  }

  // High-value semantic attributes (always pass)
  if (
    HIGH_VALUE_ATTRIBUTES.has(lowerAttrName) ||
    lowerAttrName.startsWith('aria-') ||
    lowerAttrName.startsWith('data-state')
  ) {
    return { passed: true };
  }

  // Stage 3: Class change intelligence (token-level symmetric difference)
  if (lowerAttrName === 'class') {
    const oldClasses = new Set((oldValue || '').split(/\s+/).filter(Boolean));
    const newClasses = new Set((newValue || '').split(/\s+/).filter(Boolean));

    const changedClasses: string[] = [];
    for (const c of newClasses) {
      if (!oldClasses.has(c)) changedClasses.push(c);
    }
    for (const c of oldClasses) {
      if (!newClasses.has(c)) changedClasses.push(c);
    }

    // No actual tokens changed
    if (changedClasses.length === 0) {
      return { passed: false, reason: 'no_actual_class_change' };
    }

    // If ALL changed tokens match cosmetic tokens -> REJECT as cosmetic noise
    const allCosmetic = changedClasses.every((cls) => {
      const lower = cls.toLowerCase();
      return COSMETIC_CLASS_KEYWORDS.some((kw) => lower.includes(kw));
    });
    if (allCosmetic) {
      return { passed: false, reason: 'cosmetic_class_change' };
    }

    // If ANY changed token matches semantic keywords -> KEEP
    const hasSemanticState = changedClasses.some((cls) => {
      const lower = cls.toLowerCase();
      return SEMANTIC_CLASS_KEYWORDS.some((kw) => lower.includes(kw));
    });
    if (hasSemanticState) {
      return { passed: true };
    }

    // Non-semantic generic class churn is treated as cosmetic
    return { passed: false, reason: 'unrecognized_non_semantic_class' };
  }

  // Stage 3: Style changes: Ignored by default unless toggling structural visibility
  if (lowerAttrName === 'style') {
    const oldStyle = (oldValue || '').toLowerCase();
    const newStyle = (newValue || '').toLowerCase();

    const touchesVisibility =
      oldStyle.includes('display: none') !== newStyle.includes('display: none') ||
      oldStyle.includes('visibility: hidden') !== newStyle.includes('visibility: hidden');

    if (touchesVisibility) {
      return { passed: true };
    }

    return { passed: false, reason: 'cosmetic_style_change_ignored_by_default' };
  }

  return { passed: false, reason: 'unrecognized_non_semantic_attribute' };
}

/**
 * Stage 4: Evaluates characterData (text) mutations.
 */
export function filterCharacterDataMutation(
  oldText: string | null,
  newText: string | null
): FilterResult {
  const trimmedOld = (oldText || '').trim();
  const trimmedNew = (newText || '').trim();

  // If text is identical after trimming whitespace -> reject
  if (trimmedOld === trimmedNew) {
    return { passed: false, reason: 'identical_text' };
  }

  // Whitespace-only changes rejected
  if (!trimmedOld && !trimmedNew) {
    return { passed: false, reason: 'whitespace_only_text' };
  }

  return { passed: true };
}

/**
 * Evaluates childList mutations for meaningful nodes.
 */
export function filterChildListMutation(mutation: MutationRecord): FilterResult {
  const addedNodes = Array.from(mutation.addedNodes);
  const removedNodes = Array.from(mutation.removedNodes);

  const hasMeaningfulAdded = addedNodes.some((node) => {
    if (isIgnoredNode(node)) return false;
    if (node.nodeType === Node.TEXT_NODE) {
      return (node.textContent || '').trim().length > 0;
    }
    return node instanceof Element;
  });

  const hasMeaningfulRemoved = removedNodes.some((node) => {
    if (isIgnoredNode(node)) return false;
    if (node.nodeType === Node.TEXT_NODE) {
      return (node.textContent || '').trim().length > 0;
    }
    return node instanceof Element;
  });

  if (!hasMeaningfulAdded && !hasMeaningfulRemoved) {
    return { passed: false, reason: 'all_nodes_ignored_or_empty' };
  }

  return { passed: true };
}
