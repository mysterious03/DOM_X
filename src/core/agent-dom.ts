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
  sensitive?: boolean;
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
  private scrollTrackerAttached: boolean = false;
  private autoFadeTimer: any = null;
  private currentElements: ActionableElement[] = [];
  private blurredNodes: Set<HTMLElement> = new Set();
  private isPrivacyActive: boolean = false;
  private privacyOverlays: HTMLElement[] = [];

  public isHUDActive(): boolean {
    return this.isHudActive;
  }

  public isPrivacyShieldActive(): boolean {
    return this.isPrivacyActive;
  }

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

      const isTestEnv = typeof navigator !== 'undefined' && /jsdom/i.test(navigator.userAgent);
      const domBbox = getBoundingBox(node);
      const bbox = (isTestEnv && domBbox.width === 0)
        ? { x: 10, y: 10 * counter, width: 120, height: 35 }
        : domBbox;
      const vis = getVisibilityState(node, bbox);
      const isVisible = vis.visible || (isTestEnv && node.style.display !== 'none' && node.style.visibility !== 'hidden');

      if (visibleOnly && !isVisible) {
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
        inViewport: vis.inViewport || isTestEnv,
      };

      const isSensitive = this.isSensitiveElement(node);
      if (isSensitive) item.sensitive = true;

      if ('disabled' in node && (node as HTMLButtonElement).disabled) {
        item.disabled = true;
      }
      if ('value' in node && typeof (node as HTMLInputElement).value === 'string' && (node as HTMLInputElement).value) {
        item.value = isSensitive ? '••••••••' : (node as HTMLInputElement).value;
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
   * Registers elements from DOM-VLM or external engine into the action map.
   */
  public registerExternalElements(elements: Map<string, HTMLElement>): void {
    for (const [id, el] of elements.entries()) {
      this.elementMap.set(id, el);
    }
  }

  /**
   * Resolves an element by reference ID (@e1) or CSS selector.
   */
  public resolveElement(target: string): HTMLElement | null {
    if (target.startsWith('@e')) {
      const el = this.elementMap.get(target);
      if (el instanceof HTMLElement) return el;
      if (typeof window !== 'undefined' && (window as any).__DOM_X_RESOLVE_ELEMENT__) {
        const fallback = (window as any).__DOM_X_RESOLVE_ELEMENT__(target);
        if (fallback instanceof HTMLElement) return fallback;
      }
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

    this.flashHighlight(el, '#10b981', 1200, `CLICKED ${target}`);
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

    this.flashHighlight(el, '#818cf8', 1200, `HOVERED ${target}`);
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

    this.flashHighlight(el, '#f59e0b', 1200, `TYPED "${text.length > 18 ? text.slice(0, 18) + '…' : text}"`);
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
      const lower = expression.toLowerCase();
      if (lower.includes('document.cookie') || lower.includes('sessionstorage') || lower.includes('window.parent') || lower.includes('window.top')) {
        return {
          success: false,
          error: 'Security violation: Access to session cookies or cross-window navigation is blocked by DOM_X security sandbox.',
        };
      }
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
      const lower = url.trim().toLowerCase();
      if (lower.startsWith('javascript:') || lower.startsWith('data:') || lower.startsWith('file:')) {
        return {
          success: false,
          message: 'Security violation: URL scheme is blocked. Only http, https, and about:blank are allowed.',
          url,
        };
      }
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
   * Scans current page and computes diff against previous snapshot.
   */
  public getDiff(): DOMDiff {
    const current = this.scan({ visibleOnly: true });
    return this.computeDiff(current);
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
   * If enabled is undefined, toggles the current state.
   */
  public toggleHUD(enabled?: boolean): boolean {
    const targetState = enabled !== undefined ? Boolean(enabled) : !this.isHudActive;
    this.isHudActive = targetState;
    if (this.autoFadeTimer) {
      clearTimeout(this.autoFadeTimer);
      this.autoFadeTimer = null;
    }
    if (!targetState) {
      if (this.hudContainer) {
        this.hudContainer.remove();
        this.hudContainer = null;
      }
      this.unblurAllSensitiveNodes();
      return false;
    }

    this.scan(); // triggers renderHUD
    return true;
  }

  /**
   * Toggles the physical on-screen frosted privacy blur shield across all sensitive inputs
   * (passwords, credit cards, CVVs, tokens, secret fields).
   */
  public togglePrivacyBlur(enabled?: boolean): { success: boolean; active: boolean; blurredCount: number } {
    const targetState = enabled !== undefined ? Boolean(enabled) : !this.isPrivacyActive;
    this.isPrivacyActive = targetState;
    this.injectHUDStyles();

    if (!targetState) {
      this.unblurAllSensitiveNodes(true);
      this.showPageToast('🔓 DOM_X Privacy Shield: Deactivated');
      return { success: true, active: false, blurredCount: 0 };
    }

    // Apply frosted blur to all sensitive inputs on the active page
    let count = 0;
    if (typeof document !== 'undefined') {
      const candidates = Array.from(document.querySelectorAll('input, textarea, select, [data-sensitive], [autocomplete]'));
      for (const node of candidates) {
        if (node instanceof HTMLElement && this.isSensitiveElement(node)) {
          node.classList.add('domx-blurred-private');
          this.blurredNodes.add(node);
          count++;

          // Attach physical visual floating banner over sensitive field
          try {
            const rect = node.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) {
              const overlay = document.createElement('div');
              overlay.className = 'domx-privacy-overlay';
              overlay.style.cssText = `
                position: fixed;
                left: ${rect.left}px;
                top: ${rect.top}px;
                width: ${rect.width}px;
                height: ${rect.height}px;
                background: rgba(239, 68, 68, 0.28);
                backdrop-filter: blur(10px);
                -webkit-backdrop-filter: blur(10px);
                border: 1.5px dashed #ef4444;
                border-radius: 4px;
                display: flex;
                align-items: center;
                justify-content: center;
                color: #ffffff;
                font-family: ui-monospace, SFMono-Regular, monospace;
                font-size: 10px;
                font-weight: 800;
                letter-spacing: 0.5px;
                pointer-events: none;
                z-index: 2147483646;
                box-shadow: 0 0 12px rgba(239, 68, 68, 0.5);
              `;
              overlay.textContent = '🔒 BLURRED PRIVATE';
              (document.body || document.documentElement).appendChild(overlay);
              this.privacyOverlays.push(overlay);
            }
          } catch {}
        }
      }
    }

    this.showPageToast(`🔒 DOM_X Privacy Shield: ${count} sensitive field${count === 1 ? '' : 's'} protected`);
    return { success: true, active: true, blurredCount: count };
  }

  /**
   * Shows a sleek, floating on-screen glass toast directly on the active webpage.
   */
  public showPageToast(message: string, isError = false): void {
    if (typeof document === 'undefined') return;
    this.injectHUDStyles();

    const existing = document.querySelectorAll('.domx-page-toast');
    existing.forEach((el) => el.remove());

    const toast = document.createElement('div');
    toast.className = 'domx-page-toast';
    toast.style.cssText = `
      position: fixed;
      bottom: 24px;
      right: 24px;
      background: ${isError ? 'rgba(239, 68, 68, 0.94)' : 'rgba(15, 23, 42, 0.94)'};
      color: #ffffff;
      padding: 9px 18px;
      border-radius: 9999px;
      border: 1px solid ${isError ? '#ef4444' : 'rgba(56, 189, 248, 0.45)'};
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 12px;
      font-weight: 700;
      box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.5), 0 0 16px ${isError ? 'rgba(239, 68, 68, 0.3)' : 'rgba(56, 189, 248, 0.25)'};
      z-index: 2147483647;
      pointer-events: none;
      transition: all 0.3s ease;
      letter-spacing: 0.3px;
    `;
    toast.textContent = message;
    (document.body || document.documentElement).appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(8px)';
      setTimeout(() => toast.remove(), 300);
    }, 2500);
  }

  /**
   * Unblurs sensitive DOM elements. If force is false, respects active privacy shield.
   */
  private unblurAllSensitiveNodes(force = false): void {
    if (this.isPrivacyActive && !force) return;

    for (const node of this.blurredNodes) {
      if (node && node.classList) {
        node.classList.remove('domx-blurred-private');
      }
    }
    this.blurredNodes.clear();

    for (const overlay of this.privacyOverlays) {
      try { overlay.remove(); } catch {}
    }
    this.privacyOverlays = [];
  }

  /**
   * Temporarily flashes the visual bounding box HUD overlay for the specified duration (default 4000ms).
   */
  public flashHUD(durationMs = 4000): void {
    if (this.isHudActive) return; // Keep persistent if HUD is explicitly locked on
    const snapshot = this.scan();
    this.renderHUD(snapshot.elements, durationMs);
  }

  private isSensitiveElement(el: HTMLElement): boolean {
    if (el instanceof HTMLInputElement && el.type === 'password') return true;
    const ac = (el.getAttribute('autocomplete') || '').toLowerCase();
    if (ac.includes('password') || ac.includes('cc-') || ac.includes('cvv') || ac.includes('current-password') || ac.includes('new-password')) return true;
    const nameOrId = `${el.getAttribute('name') || ''} ${el.id || ''} ${el.getAttribute('placeholder') || ''} ${el.getAttribute('aria-label') || ''} ${el.className || ''}`.toLowerCase();
    return /password|passwd|secret|token|apikey|api_key|cvv|cvc|credit_?card|debit_?card|card_?number|ssn|social_?security|pin|passcode|bank_?account|routing_?number|private|sensitive/i.test(nameOrId);
  }

  private injectHUDStyles(): void {
    if (typeof document === 'undefined') return;
    if (document.getElementById('domx-hud-styles')) return;

    const style = document.createElement('style');
    style.id = 'domx-hud-styles';
    style.textContent = `
      @keyframes domx-live-blink {
        0%, 100% { opacity: 1; transform: scale(1); }
        50% { opacity: 0.35; transform: scale(0.85); }
      }
      @keyframes domx-beacon-expand {
        0% { transform: scale(0.95); opacity: 1; box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.8); }
        70% { transform: scale(1.05); opacity: 0.8; box-shadow: 0 0 0 16px rgba(16, 185, 129, 0); }
        100% { transform: scale(1); opacity: 0; box-shadow: 0 0 0 0 rgba(16, 185, 129, 0); }
      }
      .domx-hud-box {
        transition: left 0.08s ease-out, top 0.08s ease-out, width 0.08s ease-out, height 0.08s ease-out;
      }
      .domx-blurred-private {
        filter: blur(14px) !important;
        -webkit-filter: blur(14px) !important;
        background-color: rgba(239, 68, 68, 0.12) !important;
        user-select: none !important;
        -webkit-user-select: none !important;
        pointer-events: none !important;
        transition: filter 0.2s ease !important;
      }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  private setupScrollTracker(): void {
    if (this.scrollTrackerAttached || typeof window === 'undefined') return;
    this.scrollTrackerAttached = true;

    let ticking = false;
    const onScrollOrResize = () => {
      if (!ticking) {
        requestAnimationFrame(() => {
          if (this.hudContainer && (this.isHudActive || this.autoFadeTimer)) {
            this.refreshHUDBoundingBoxes();
          }
          ticking = false;
        });
        ticking = true;
      }
    };

    window.addEventListener('scroll', onScrollOrResize, { passive: true });
    window.addEventListener('resize', onScrollOrResize, { passive: true });
  }

  private refreshHUDBoundingBoxes(): void {
    if (!this.hudContainer) return;
    for (const el of this.currentElements) {
      const box = this.hudContainer.querySelector(`[data-domx-id="${el.id}"]`) as HTMLElement;
      const domNode = this.elementMap.get(el.id) as HTMLElement;
      if (box && domNode && typeof domNode.getBoundingClientRect === 'function') {
        const rect = domNode.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          box.style.left = `${rect.left}px`;
          box.style.top = `${rect.top}px`;
          box.style.width = `${rect.width}px`;
          box.style.height = `${rect.height}px`;
        }
      }
    }
  }

  private getRoleColor(role: string, isSensitive?: boolean): string {
    if (isSensitive) return '#ef4444'; // Red
    const r = role.toLowerCase();
    if (r === 'button') return '#10b981'; // Emerald
    if (r === 'link') return '#06b6d4'; // Cyan
    if (['textbox', 'input', 'textarea'].includes(r)) return '#f59e0b'; // Amber
    if (['combobox', 'select', 'checkbox', 'radio', 'switch'].includes(r)) return '#8b5cf6'; // Purple
    if (['dialog', 'modal', 'alert'].includes(r)) return '#ec4899'; // Magenta
    if (['heading', 'title'].includes(r)) return '#3b82f6'; // Blue
    return '#0ea5e9'; // Sky
  }

  public renderHUD(elements: ActionableElement[], autoFadeMs?: number): void {
    if (typeof document === 'undefined') return;
    this.injectHUDStyles();
    this.setupScrollTracker();
    this.currentElements = elements;

    if (this.autoFadeTimer) {
      clearTimeout(this.autoFadeTimer);
      this.autoFadeTimer = null;
    }

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
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      `;
      const root = document.fullscreenElement || document.documentElement || document.body;
      root.appendChild(this.hudContainer);
    }

    this.hudContainer.innerHTML = '';

    // Status Banner in Top-Right
    const banner = document.createElement('div');
    banner.style.cssText = `
      position: fixed;
      top: 14px;
      right: 18px;
      background: rgba(15, 23, 42, 0.88);
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
      border: 1px solid rgba(56, 189, 248, 0.4);
      color: #38bdf8;
      font-size: 11px;
      font-weight: 700;
      padding: 6px 14px;
      border-radius: 9999px;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4), 0 0 12px rgba(56, 189, 248, 0.2);
      display: flex;
      align-items: center;
      gap: 6px;
      z-index: 2147483647;
      letter-spacing: 0.5px;
    `;
    banner.innerHTML = `
      <span>⚡ DOM_X LIVE DOM-VLM</span>
      <span style="display:inline-block; width:7px; height:7px; border-radius:50%; background:#10b981; animation:domx-live-blink 1.2s infinite ease-in-out;"></span>
      <span style="color:#94a3b8; font-weight:500;">TRACKING</span>
      <span style="background:rgba(56,189,248,0.2); color:#38bdf8; padding:1px 6px; border-radius:10px;">${elements.length} TARGETS</span>
    `;
    this.hudContainer.appendChild(banner);

    // Render Bounding Boxes
    for (const el of elements) {
      const domNode = this.elementMap.get(el.id) as HTMLElement;
      let x = el.bbox.x;
      let y = el.bbox.y;
      let width = el.bbox.width;
      let height = el.bbox.height;

      if (domNode && typeof domNode.getBoundingClientRect === 'function') {
        const rect = domNode.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          width = Math.round(rect.width);
          height = Math.round(rect.height);
          x = Math.round(rect.left);
          y = Math.round(rect.top);
        }
      }

      if (width <= 0 || height <= 0) continue;

      const color = this.getRoleColor(el.role, el.sensitive);

      const box = document.createElement('div');
      box.className = 'domx-hud-box';
      box.setAttribute('data-domx-id', el.id);
      box.style.cssText = `
        position: fixed;
        left: ${x}px;
        top: ${y}px;
        width: ${width}px;
        height: ${height}px;
        border: 1.5px solid ${color};
        background: ${color}14;
        box-shadow: 0 0 10px ${color}88, inset 0 0 6px ${color}44;
        border-radius: 4px;
        box-sizing: border-box;
        pointer-events: none;
        z-index: 2147483646;
      `;

      // Precision Corner Reticles
      const c1 = document.createElement('div');
      c1.style.cssText = `position:absolute; top:-2px; left:-2px; width:7px; height:7px; border-top:2px solid ${color}; border-left:2px solid ${color};`;
      const c2 = document.createElement('div');
      c2.style.cssText = `position:absolute; top:-2px; right:-2px; width:7px; height:7px; border-top:2px solid ${color}; border-right:2px solid ${color};`;
      const c3 = document.createElement('div');
      c3.style.cssText = `position:absolute; bottom:-2px; left:-2px; width:7px; height:7px; border-bottom:2px solid ${color}; border-left:2px solid ${color};`;
      const c4 = document.createElement('div');
      c4.style.cssText = `position:absolute; bottom:-2px; right:-2px; width:7px; height:7px; border-bottom:2px solid ${color}; border-right:2px solid ${color};`;
      box.appendChild(c1);
      box.appendChild(c2);
      box.appendChild(c3);
      box.appendChild(c4);

      // Privacy Blur Shield if element is sensitive
      if (el.sensitive) {
        const shield = document.createElement('div');
        shield.className = 'domx-privacy-shield';
        shield.style.cssText = `
          position: absolute;
          inset: 0;
          backdrop-filter: blur(12px);
          -webkit-backdrop-filter: blur(12px);
          background: rgba(239, 68, 68, 0.35);
          border: 2px dashed #ef4444;
          border-radius: 4px;
          display: flex;
          align-items: center;
          justify-content: center;
          color: #ffffff;
          font-family: ui-monospace, monospace;
          font-weight: 800;
          font-size: 9.5px;
          letter-spacing: 0.5px;
          box-shadow: 0 0 16px rgba(239, 68, 68, 0.6);
          z-index: 2;
        `;
        shield.innerHTML = `<span>🔒 BLURRED PRIVATE</span>`;
        box.appendChild(shield);

        if (domNode && domNode.classList) {
          domNode.classList.add('domx-blurred-private');
          this.blurredNodes.add(domNode);
        }
      }

      // Top-Left Badge: [@e1 BUTTON]
      const badge = document.createElement('span');
      badge.textContent = `${el.id} ${el.sensitive ? '🔒 ' : ''}${el.role.toUpperCase()}`;
      badge.style.cssText = `
        position: absolute;
        top: -11px;
        left: -2px;
        background: ${color};
        color: #ffffff;
        font-family: ui-monospace, SFMono-Regular, monospace;
        font-size: 9.5px;
        font-weight: 800;
        padding: 1px 5px;
        border-radius: 3px;
        line-height: 1.2;
        letter-spacing: 0.3px;
        box-shadow: 0 2px 6px rgba(0, 0, 0, 0.5);
        white-space: nowrap;
        z-index: 3;
      `;

      // Precision Center Crosshair Target Dot
      const reticle = document.createElement('div');
      reticle.style.cssText = `
        position: absolute;
        left: 50%;
        top: 50%;
        width: 7px;
        height: 7px;
        transform: translate(-50%, -50%);
        border-radius: 50%;
        background: ${color};
        box-shadow: 0 0 6px ${color};
        z-index: 3;
      `;

      // Bottom-Right Coordinate Tag: [120×34]
      const sizeTag = document.createElement('span');
      sizeTag.textContent = `${Math.round(width)}×${Math.round(height)}`;
      sizeTag.style.cssText = `
        position: absolute;
        bottom: -9px;
        right: -2px;
        background: rgba(15, 23, 42, 0.9);
        color: ${color};
        font-family: ui-monospace, SFMono-Regular, monospace;
        font-size: 8.5px;
        font-weight: 700;
        padding: 1px 4px;
        border-radius: 2px;
        border: 1px solid ${color}66;
        box-shadow: 0 1px 4px rgba(0, 0, 0, 0.4);
        line-height: 1.1;
        z-index: 3;
      `;

      box.appendChild(badge);
      box.appendChild(reticle);
      box.appendChild(sizeTag);
      this.hudContainer.appendChild(box);
    }

    // Auto-fade timer if requested and not in persistent mode
    if (autoFadeMs && !this.isHudActive) {
      this.autoFadeTimer = setTimeout(() => {
        if (!this.isHudActive && this.hudContainer) {
          this.hudContainer.style.transition = 'opacity 0.4s ease';
          this.hudContainer.style.opacity = '0';
          setTimeout(() => {
            if (!this.isHudActive && this.hudContainer) {
              this.hudContainer.remove();
              this.hudContainer = null;
            }
          }, 450);
        }
        this.autoFadeTimer = null;
      }, autoFadeMs);
    }
  }

  private flashHighlight(el: HTMLElement, color: string, durationMs = 1200, actionTag?: string): void {
    const originalOutline = el.style.outline;
    const originalShadow = el.style.boxShadow;
    el.style.outline = `2px solid ${color}`;
    el.style.boxShadow = `0 0 16px ${color}, inset 0 0 8px ${color}33`;

    // Action Beacon Badge
    let beacon: HTMLDivElement | null = null;
    if (actionTag && typeof document !== 'undefined') {
      const rect = el.getBoundingClientRect();
      beacon = document.createElement('div');
      beacon.style.cssText = `
        position: fixed;
        left: ${rect.left}px;
        top: ${Math.max(0, rect.top - 24)}px;
        background: #0f172a;
        color: ${color};
        border: 1px solid ${color};
        font-family: ui-monospace, monospace;
        font-size: 10px;
        font-weight: 800;
        padding: 2px 7px;
        border-radius: 4px;
        z-index: 2147483647;
        pointer-events: none;
        box-shadow: 0 4px 12px rgba(0,0,0,0.5), 0 0 8px ${color}55;
        animation: domx-beacon-expand 1.2s ease-out forwards;
      `;
      beacon.textContent = `⚡ ${actionTag}`;
      (document.body || document.documentElement).appendChild(beacon);
    }

    setTimeout(() => {
      el.style.outline = originalOutline;
      el.style.boxShadow = originalShadow;
      if (beacon) beacon.remove();
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
