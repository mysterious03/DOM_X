/**
 * DOM_X Agent Perception & Interaction Layer
 * Scans page DOM for interactive elements, assigns compact action tags (@e1, @e2...),
 * calculates bounding boxes, tracks net-diffs, and executes AI agent actions
 * (click, type, hover, select, pressKey, inspect, navigate, eval, HUD overlay).
 */

import { getBoundingBox, getVisibilityState } from './geometry';

export interface ActionableElement {
  id: string;
  tag: string;
  role: string;
  name: string;
  selector: string;
  bbox: { x: number; y: number; width: number; height: number };
  inViewport: boolean;
  disabled?: boolean;
  value?: string;
  checked?: boolean;
  href?: string;
}

export interface ElementInspection {
  id?: string;
  tag: string;
  selector: string;
  role: string;
  name: string;
  bbox: { x: number; y: number; width: number; height: number };
  inViewport: boolean;
  attributes: Record<string, string>;
  computedStyles: Record<string, string>;
  domPath: string;
  textSnippet: string;
  childCount: number;
  isInteractive: boolean;
}

export interface ScanOptions {
  visibleOnly?: boolean;
  interactiveOnly?: boolean;
  query?: string;
  search?: string;
  preset?: 'interactive' | 'all' | 'forms' | 'headings';
}

export interface DOMSnapshot {
  title: string;
  url: string;
  timestamp: number;
  totalElements: number;
  elements: ActionableElement[];
  formattedSummary: string;
}

export interface DOMDiff {
  added: ActionableElement[];
  removed: string[];
  modified: { id: string; changes: Record<string, { from: any; to: any }> }[];
}

export class DOMAgentPerceiver {
  private elementMap: Map<string, Element> = new Map();
  private hudContainer: HTMLDivElement | null = null;
  private isHudActive: boolean = false;
  private previousSnapshot: Map<string, ActionableElement> = new Map();

  /**
   * Scans document and returns a structured snapshot of actionable/interactive elements.
   */
  public scan(options: ScanOptions = {}): DOMSnapshot {
    const { visibleOnly = true, query, search, preset = 'interactive' } = options;
    this.elementMap.clear();

    let cssQuery = '';
    if (query) {
      cssQuery = query;
    } else {
      switch (preset) {
        case 'forms':
          cssQuery = 'input, select, textarea, button, form, [role="button"], [role="checkbox"], [role="radio"]';
          break;
        case 'headings':
          cssQuery = 'h1, h2, h3, h4, h5, h6, [role="heading"]';
          break;
        case 'all':
          cssQuery = '*';
          break;
        case 'interactive':
        default:
          cssQuery =
            'button, input, select, textarea, a[href], [role="button"], [role="link"], [role="checkbox"], [role="radio"], [role="switch"], [role="tab"], [role="menuitem"], [role="dialog"], [role="alert"], summary, dialog, h1, h2, h3, [tabindex]:not([tabindex="-1"])';
          break;
      }
    }

    const rawNodes = Array.from(document.querySelectorAll(cssQuery));
    const elements: ActionableElement[] = [];
    let counter = 1;

    for (const node of rawNodes) {
      if (!(node instanceof HTMLElement)) continue;
      // Skip HUD elements and invisible scripts/styles
      if (
        node.classList.contains('domx-hud') ||
        node.closest('.domx-hud') ||
        node.classList.contains('dompulse-hud') ||
        node.closest('.dompulse-hud')
      ) {
        continue;
      }

      const bbox = getBoundingBox(node);
      const vis = getVisibilityState(node, bbox);

      if (visibleOnly && !vis.visible) {
        continue;
      }

      const tag = node.tagName.toUpperCase();
      const role = node.getAttribute('role') || this.inferRole(node);
      const name = this.extractAccessibleName(node);
      const selector = this.buildSelector(node);

      if (search && search.trim()) {
        const queryLower = search.toLowerCase();
        const matchesName = name.toLowerCase().includes(queryLower);
        const matchesTag = tag.toLowerCase().includes(queryLower);
        const matchesSelector = selector.toLowerCase().includes(queryLower);
        if (!matchesName && !matchesTag && !matchesSelector) {
          continue;
        }
      }

      const id = `@e${counter++}`;
      this.elementMap.set(id, node);

      const item: ActionableElement = {
        id,
        tag,
        role,
        name,
        selector,
        bbox,
        inViewport: vis.inViewport,
      };

      if ('disabled' in node && (node as HTMLButtonElement).disabled) {
        item.disabled = true;
      }
      if ('value' in node && typeof (node as HTMLInputElement).value === 'string' && (node as HTMLInputElement).value) {
        item.value = (node as HTMLInputElement).value;
      }
      if ('checked' in node && typeof (node as HTMLInputElement).checked === 'boolean') {
        item.checked = (node as HTMLInputElement).checked;
      }
      if (node instanceof HTMLAnchorElement && node.href) {
        item.href = node.href;
      }

      elements.push(item);
    }

    const formattedSummary = this.formatForLLM(elements);

    // Refresh HUD if active
    if (this.isHudActive) {
      this.renderHUD(elements);
    }

    return {
      title: document.title || 'Untitled Document',
      url: window.location.href,
      timestamp: Date.now(),
      totalElements: elements.length,
      elements,
      formattedSummary,
    };
  }

  /**
   * Resolves an element by reference ID (@e1) or CSS selector.
   */
  public resolveElement(target: string): HTMLElement | null {
    if (target.startsWith('@e')) {
      const el = this.elementMap.get(target);
      if (el instanceof HTMLElement) return el;
    }
    try {
      const el = document.querySelector(target);
      if (el instanceof HTMLElement) return el;
    } catch {
      // Invalid selector
    }
    return null;
  }

  /**
   * Dispatches synthetic and native click events on the target element.
   */
  public click(target: string): { success: boolean; message: string; target: string } {
    const el = this.resolveElement(target);
    if (!el) {
      return { success: false, message: `Element not found: ${target}`, target };
    }

    this.flashHighlight(el, '#38bdf8');
    if (typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
    }

    if (typeof el.focus === 'function') {
      el.focus();
    }
    const opts: MouseEventInit = { bubbles: true, cancelable: true };
    el.dispatchEvent(new MouseEvent('mousedown', opts));
    el.dispatchEvent(new MouseEvent('mouseup', opts));
    el.click();

    return {
      success: true,
      message: `Clicked ${target} (${el.tagName.toLowerCase()})`,
      target,
    };
  }

  /**
   * Hovers over an element to trigger mouseover, mouseenter, and tooltips.
   */
  public hover(target: string): { success: boolean; message: string; target: string } {
    const el = this.resolveElement(target);
    if (!el) {
      return { success: false, message: `Element not found: ${target}`, target };
    }

    this.flashHighlight(el, '#818cf8');
    if (typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    const opts: MouseEventInit = { bubbles: true, cancelable: true };
    el.dispatchEvent(new MouseEvent('mouseenter', opts));
    el.dispatchEvent(new MouseEvent('mouseover', opts));
    el.dispatchEvent(new MouseEvent('mousemove', opts));

    return {
      success: true,
      message: `Hovered over ${target} (${el.tagName.toLowerCase()})`,
      target,
    };
  }

  /**
   * Types text into the target element.
   */
  public type(
    target: string,
    text: string,
    options: { clearFirst?: boolean; pressEnter?: boolean } = {}
  ): { success: boolean; message: string; target: string; value?: string } {
    const el = this.resolveElement(target);
    if (!el) {
      return { success: false, message: `Element not found: ${target}`, target };
    }

    this.flashHighlight(el, '#10b981');
    if (typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    if (typeof el.focus === 'function') {
      el.focus();
    }

    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      if (options.clearFirst) {
        el.value = '';
      }
      el.value += text;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));

      if (options.pressEnter) {
        el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
        el.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
        if (el.form) {
          el.form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        }
      }

      return {
        success: true,
        message: `Typed "${text}" into ${target}`,
        target,
        value: el.value,
      };
    }

    if (el.isContentEditable) {
      if (options.clearFirst) el.innerText = '';
      el.innerText += text;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return { success: true, message: `Typed into contenteditable ${target}`, target };
    }

    return { success: false, message: `${target} is not an input or editable element`, target };
  }

  /**
   * Selects an option in a <select> element by value or visible text.
   */
  public selectOption(target: string, valueOrText: string): { success: boolean; message: string; target: string } {
    const el = this.resolveElement(target);
    if (!el || !(el instanceof HTMLSelectElement)) {
      return { success: false, message: `Target ${target} is not a <select> element`, target };
    }

    let matchedOption: HTMLOptionElement | null = null;
    const options = Array.from(el.options);

    for (const opt of options) {
      if (opt.value === valueOrText || opt.text.trim().toLowerCase() === valueOrText.trim().toLowerCase()) {
        matchedOption = opt;
        break;
      }
    }

    if (!matchedOption) {
      return {
        success: false,
        message: `Option "${valueOrText}" not found in select element. Available: [${options.map((o) => o.text).join(', ')}]`,
        target,
      };
    }

    el.value = matchedOption.value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    this.flashHighlight(el, '#10b981');

    return {
      success: true,
      message: `Selected "${matchedOption.text}" (value: "${matchedOption.value}") in ${target}`,
      target,
    };
  }

  /**
   * Dispatches keyboard key event (e.g. "Escape", "Enter", "Tab", "ArrowDown").
   */
  public pressKey(
    key: string,
    target?: string,
    modifiers: { ctrl?: boolean; alt?: boolean; shift?: boolean; meta?: boolean } = {}
  ): { success: boolean; message: string } {
    let el = target ? this.resolveElement(target) : (document.activeElement as HTMLElement | null);
    if (!el) el = document.body;

    const opts: KeyboardEventInit = {
      key,
      code: key,
      bubbles: true,
      cancelable: true,
      ctrlKey: Boolean(modifiers.ctrl),
      altKey: Boolean(modifiers.alt),
      shiftKey: Boolean(modifiers.shift),
      metaKey: Boolean(modifiers.meta),
    };

    el.dispatchEvent(new KeyboardEvent('keydown', opts));
    el.dispatchEvent(new KeyboardEvent('keypress', opts));
    el.dispatchEvent(new KeyboardEvent('keyup', opts));

    return { success: true, message: `Pressed key "${key}" on ${el.tagName.toLowerCase()}` };
  }

  /**
   * Deeply inspects an element: attributes, computed styles, DOM hierarchy, and state.
   */
  public inspect(target: string): { success: boolean; inspection?: ElementInspection; message?: string } {
    const el = this.resolveElement(target);
    if (!el) {
      return { success: false, message: `Element not found: ${target}` };
    }

    const bbox = getBoundingBox(el);
    const vis = getVisibilityState(el, bbox);

    const attributes: Record<string, string> = {};
    for (let i = 0; i < el.attributes.length; i++) {
      const attr = el.attributes[i];
      attributes[attr.name] = attr.value;
    }

    const win = el.ownerDocument.defaultView || window;
    const computedStyles: Record<string, string> = {};
    if (win && typeof win.getComputedStyle === 'function') {
      try {
        const style = win.getComputedStyle(el);
        const props = ['display', 'visibility', 'opacity', 'position', 'zIndex', 'color', 'backgroundColor', 'fontSize', 'cursor'];
        for (const p of props) {
          const val = style.getPropertyValue(p.replace(/([A-Z])/g, '-$1').toLowerCase());
          if (val) computedStyles[p] = val;
        }
      } catch {
        // Fallback
      }
    }

    const domPath = this.getDomBreadcrumb(el);

    const inspection: ElementInspection = {
      id: target.startsWith('@e') ? target : undefined,
      tag: el.tagName.toUpperCase(),
      selector: this.buildSelector(el),
      role: el.getAttribute('role') || this.inferRole(el),
      name: this.extractAccessibleName(el),
      bbox,
      inViewport: vis.inViewport,
      attributes,
      computedStyles,
      domPath,
      textSnippet: (el.innerText || el.textContent || '').slice(0, 100).trim(),
      childCount: el.children.length,
      isInteractive: this.isElementInteractive(el),
    };

    return { success: true, inspection };
  }

  /**
   * Evaluates arbitrary JavaScript safely in the active tab context.
   */
  public evalScript(expression: string): { success: boolean; result?: any; error?: string } {
    try {
      const res = window.eval(expression);
      return { success: true, result: res };
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  /**
   * Navigates the current browser tab to a new URL.
   */
  public navigate(url: string): { success: boolean; message: string; url: string } {
    try {
      window.location.href = url;
      return { success: true, message: `Navigating to ${url}`, url };
    } catch (err: unknown) {
      return { success: false, message: err instanceof Error ? err.message : String(err), url };
    }
  }

  /**
   * Computes diff between current scan and previous snapshot.
   */
  public computeDiff(currentSnapshot: DOMSnapshot): DOMDiff {
    const currentMap = new Map<string, ActionableElement>();
    for (const el of currentSnapshot.elements) {
      currentMap.set(el.selector, el);
    }

    const added: ActionableElement[] = [];
    const removed: string[] = [];
    const modified: { id: string; changes: Record<string, { from: any; to: any }> }[] = [];

    for (const [sel, el] of currentMap.entries()) {
      if (!this.previousSnapshot.has(sel)) {
        added.push(el);
      } else {
        const prev = this.previousSnapshot.get(sel)!;
        const changes: Record<string, { from: any; to: any }> = {};
        if (prev.name !== el.name) changes.name = { from: prev.name, to: el.name };
        if (prev.value !== el.value) changes.value = { from: prev.value, to: el.value };
        if (prev.disabled !== el.disabled) changes.disabled = { from: prev.disabled, to: el.disabled };
        if (prev.checked !== el.checked) changes.checked = { from: prev.checked, to: el.checked };

        if (Object.keys(changes).length > 0) {
          modified.push({ id: el.id, changes });
        }
      }
    }

    for (const [sel] of this.previousSnapshot.entries()) {
      if (!currentMap.has(sel)) {
        removed.push(sel);
      }
    }

    this.previousSnapshot = currentMap;
    return { added, removed, modified };
  }

  /**
   * Scrolls the page or an element.
   */
  public scroll(
    direction: 'up' | 'down' | 'top' | 'bottom' | 'element',
    amount = 400,
    target?: string
  ): { success: boolean; message: string } {
    if (direction === 'element' && target) {
      const el = this.resolveElement(target);
      if (el) {
        if (typeof el.scrollIntoView === 'function') {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
        return { success: true, message: `Scrolled to element ${target}` };
      }
      return { success: false, message: `Scroll target not found: ${target}` };
    }

    if (direction === 'top') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } else if (direction === 'bottom') {
      window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
    } else if (direction === 'up') {
      window.scrollBy({ top: -amount, behavior: 'smooth' });
    } else {
      window.scrollBy({ top: amount, behavior: 'smooth' });
    }

    return { success: true, message: `Scrolled ${direction}` };
  }

  /**
   * Highlights an element briefly.
   */
  public highlight(target: string, color = '#f59e0b'): { success: boolean; message: string } {
    const el = this.resolveElement(target);
    if (!el) return { success: false, message: `Target not found: ${target}` };
    this.flashHighlight(el, color, 2000);
    return { success: true, message: `Highlighted ${target}` };
  }

  /**
   * Toggles in-browser visual HUD overlay showing bounding boxes and @eX tags.
   */
  public toggleHUD(enabled: boolean): boolean {
    this.isHudActive = enabled;
    if (!enabled) {
      if (this.hudContainer) {
        this.hudContainer.remove();
        this.hudContainer = null;
      }
      return false;
    }

    this.scan(); // triggers renderHUD
    return true;
  }

  private renderHUD(elements: ActionableElement[]): void {
    if (!this.hudContainer) {
      this.hudContainer = document.createElement('div');
      this.hudContainer.className = 'domx-hud';
      this.hudContainer.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100vw;
        height: 100vh;
        pointer-events: none;
        z-index: 2147483647;
      `;
      document.body.appendChild(this.hudContainer);
    }

    this.hudContainer.innerHTML = '';

    for (const el of elements) {
      if (!el.inViewport || el.bbox.width <= 0 || el.bbox.height <= 0) continue;

      const box = document.createElement('div');
      box.className = 'domx-hud-box';
      box.style.cssText = `
        position: absolute;
        left: ${el.bbox.x}px;
        top: ${el.bbox.y}px;
        width: ${el.bbox.width}px;
        height: ${el.bbox.height}px;
        border: 1.5px solid rgba(56, 189, 248, 0.7);
        background: rgba(56, 189, 248, 0.08);
        border-radius: 3px;
        box-sizing: border-box;
      `;

      const badge = document.createElement('span');
      badge.textContent = el.id;
      badge.style.cssText = `
        position: absolute;
        top: -10px;
        left: -2px;
        background: #0284c7;
        color: #fff;
        font-family: monospace;
        font-size: 10px;
        font-weight: bold;
        padding: 1px 4px;
        border-radius: 3px;
        line-height: 1;
        box-shadow: 0 1px 3px rgba(0,0,0,0.4);
      `;

      box.appendChild(badge);
      this.hudContainer.appendChild(box);
    }
  }

  private flashHighlight(el: HTMLElement, color: string, durationMs = 1200): void {
    const originalOutline = el.style.outline;
    const originalShadow = el.style.boxShadow;
    el.style.outline = `2px solid ${color}`;
    el.style.boxShadow = `0 0 12px ${color}`;

    setTimeout(() => {
      el.style.outline = originalOutline;
      el.style.boxShadow = originalShadow;
    }, durationMs);
  }

  private inferRole(el: HTMLElement): string {
    const tag = el.tagName.toLowerCase();
    if (tag === 'button') return 'button';
    if (tag === 'a') return 'link';
    if (tag === 'input') {
      const type = (el as HTMLInputElement).type || 'text';
      if (['button', 'submit', 'reset'].includes(type)) return 'button';
      if (['checkbox', 'radio'].includes(type)) return type;
      return 'textbox';
    }
    if (tag === 'textarea') return 'textbox';
    if (tag === 'select') return 'combobox';
    if (tag === 'dialog') return 'dialog';
    if (tag.startsWith('h') && tag.length === 2) return 'heading';
    return tag;
  }

  private extractAccessibleName(el: HTMLElement): string {
    const ariaLabel = el.getAttribute('aria-label');
    if (ariaLabel) return ariaLabel.trim();

    const ariaLabelledBy = el.getAttribute('aria-labelledby');
    if (ariaLabelledBy) {
      const ref = document.getElementById(ariaLabelledBy);
      if (ref && ref.textContent) return ref.textContent.trim();
    }

    if (el instanceof HTMLInputElement) {
      if (el.placeholder) return el.placeholder.trim();
      if (el.value && ['button', 'submit'].includes(el.type)) return el.value.trim();
    }

    if (el.title) return el.title.trim();

    const text = el.innerText || el.textContent;
    if (text) {
      const clean = text.replace(/\s+/g, ' ').trim();
      return clean.length > 50 ? clean.slice(0, 47) + '...' : clean;
    }

    return '';
  }

  private buildSelector(el: HTMLElement): string {
    if (el.id) return `#${el.id}`;
    const tag = el.tagName.toLowerCase();
    const classes = Array.from(el.classList).filter((c) => !c.startsWith('domx-') && !c.startsWith('dompulse-'));
    if (classes.length > 0) {
      return `${tag}.${classes.slice(0, 2).join('.')}`;
    }
    return tag;
  }

  private getDomBreadcrumb(el: HTMLElement): string {
    const path: string[] = [];
    let curr: HTMLElement | null = el;
    while (curr && curr.tagName && curr.tagName !== 'HTML') {
      let desc = curr.tagName.toLowerCase();
      if (curr.id) desc += `#${curr.id}`;
      else if (curr.className && typeof curr.className === 'string') {
        const firstClass = curr.className.split(' ').filter((c) => !c.startsWith('domx-'))[0];
        if (firstClass) desc += `.${firstClass}`;
      }
      path.unshift(desc);
      curr = curr.parentElement;
    }
    return path.join(' > ');
  }

  private isElementInteractive(el: HTMLElement): boolean {
    const tag = el.tagName.toLowerCase();
    if (['button', 'a', 'input', 'select', 'textarea', 'summary'].includes(tag)) return true;
    if (el.hasAttribute('onclick') || el.hasAttribute('tabindex')) return true;
    const role = el.getAttribute('role');
    if (role && ['button', 'link', 'checkbox', 'radio', 'tab', 'menuitem', 'switch'].includes(role)) return true;
    return false;
  }

  private formatForLLM(elements: ActionableElement[]): string {
    const lines: string[] = [
      `[DOM_X Perception | Page: "${document.title || 'Untitled'}" | URL: ${window.location.href} | Actionable Elements: ${elements.length}]`,
    ];

    for (const el of elements) {
      let desc = `${el.id} [${el.role.toUpperCase()}]`;
      if (el.name) {
        desc += ` "${el.name}"`;
      }
      desc += ` (at: ${el.bbox.x},${el.bbox.y} size: ${el.bbox.width}x${el.bbox.height})`;

      const extras: string[] = [];
      if (el.disabled) extras.push('disabled');
      if (el.checked !== undefined) extras.push(`checked: ${el.checked}`);
      if (el.value) extras.push(`value: "${el.value}"`);
      if (extras.length > 0) {
        desc += ` [${extras.join(', ')}]`;
      }

      lines.push(desc);
    }

    return lines.join('\n');
  }
}
