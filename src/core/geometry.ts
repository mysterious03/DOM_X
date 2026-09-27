/**
 * DOMPulse Geometry & Visibility Module
 * Extracts screen coordinates (x, y, width, height) and visibility states.
 */

import { BoundingBox, VisibilityState, ElementDescriptor } from './types';

/**
 * Extracts the bounding box of a Node or Element.
 * If node is a text node, uses Range API to measure bounding box.
 */
export function getBoundingBox(target: Node): BoundingBox {
  const defaultBox: BoundingBox = { x: 0, y: 0, width: 0, height: 0 };

  if (target instanceof Element) {
    const rect = target.getBoundingClientRect();
    return {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    };
  }

  // Handle CharacterData / Text nodes
  if (target.nodeType === Node.TEXT_NODE && target.ownerDocument) {
    try {
      const range = target.ownerDocument.createRange();
      range.selectNodeContents(target);
      const rect = range.getBoundingClientRect();
      if (rect.width > 0 || rect.height > 0) {
        return {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        };
      }
    } catch {
      // Fall through to parentElement
    }

    if (target.parentElement) {
      return getBoundingBox(target.parentElement);
    }
  }

  return defaultBox;
}

/**
 * Evaluates visibility state and viewport intersection.
 */
export function getVisibilityState(target: Node, bbox: BoundingBox): VisibilityState {
  const element = target instanceof Element ? target : target.parentElement;

  if (!element) {
    return { visible: false, inViewport: false };
  }

  // Check window availability (e.g. browser context vs fallback)
  const win = element.ownerDocument.defaultView || window;
  if (!win) {
    // Unknown context — default to not visible so agents don't attempt to click invisible elements
    return { visible: false, inViewport: false };
  }

  let isStyleVisible = true;
  try {
    const style = win.getComputedStyle(element);
    if (
      style.display === 'none' ||
      style.visibility === 'hidden' ||
      style.opacity === '0'
    ) {
      isStyleVisible = false;
    }
  } catch {
    // If getComputedStyle fails, rely on dimensions
  }

  const hasSize = bbox.width > 0 && bbox.height > 0;
  const visible = isStyleVisible && hasSize;

  const winWidth = win.innerWidth || 1920;
  const winHeight = win.innerHeight || 1080;

  const inViewport =
    visible &&
    bbox.x + bbox.width > 0 &&
    bbox.y + bbox.height > 0 &&
    bbox.x < winWidth &&
    bbox.y < winHeight;

  return { visible, inViewport };
}

/**
 * Builds a compact, human-readable and machine-usable descriptor for a DOM Element.
 */
export function describeElement(target: Node): ElementDescriptor {
  const element = target instanceof Element ? target : target.parentElement;

  if (!element) {
    return {
      tag: target.nodeName || 'UNKNOWN',
      classes: [],
      selector: target.nodeName || 'UNKNOWN',
    };
  }

  const tag = element.tagName.toUpperCase();
  const id = element.id ? element.id : undefined;
  const classes = Array.from(element.classList || []).filter(
    (c) => !c.startsWith('dompulse-') // avoid self-referential classes
  );

  let selector = tag.toLowerCase();
  if (id) {
    selector += `#${id}`;
  } else if (classes.length > 0) {
    // Include up to first 2 primary classes
    selector += `.${classes.slice(0, 2).join('.')}`;
  }

  const role = element.getAttribute('role') || undefined;
  const name = element.getAttribute('name') || undefined;

  // Extract a short text snippet (up to 40 chars)
  let textSnippet: string | undefined;
  const rawText = element.textContent?.trim();
  if (rawText) {
    textSnippet = rawText.length > 40 ? rawText.slice(0, 37) + '...' : rawText;
  }

  return {
    tag,
    id,
    classes,
    selector,
    role,
    name,
    textSnippet,
  };
}
