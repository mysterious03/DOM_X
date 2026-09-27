/**
 * DOMPulse Agent Perception & Interaction Layer
 * Scans page DOM for interactive elements, assigns compact action tags (@e1, @e2...),
 * calculates bounding boxes, and executes AI agent actions (click, type, scroll, HUD overlay).
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

export interface DOMSnapshot {
  title: string;
  url: string;
  timestamp: number;
  totalElements: number;
  elements: ActionableElement[];
  formattedSummary: string;
}

export class DOMAgentPerceiver {
  private elementMap: Map<string, Element> = new Map();
  private hudContainer: HTMLDivElement | null = null;
  private isHudActive: boolean = false;

  /**
   * Scans document and returns a structured snapshot of actionable/interactive elements.
   */
  public scan(options: { visibleOnly?: boolean; interactiveOnly?: boolean } = {}): DOMSnapshot {
    const { visibleOnly = true, interactiveOnly = true } = options;
    this.elementMap.clear();

    const query = interactiveOnly
      ? 'button, input, select, textarea, a[href], [role="button"], [role="link"], [role="checkbox"], [role="radio"], [role="switch"], [role="tab"], [role="menuitem"], [role="dialog"], [role="alert"], summary, dialog, h1, h2, h3, [tabindex]:not([tabindex="-1"])'
      : '*';

    const rawNodes = Array.from(document.querySelectorAll(query));
    const elements: ActionableElement[] = [];
    let counter = 1;

    for (const node of rawNodes) {
      if (!(node instanceof HTMLElement)) continue;
      // Skip our own HUD elements and invisible scripts/styles
      if (node.classList.contains('domx-hud') || node.closest('.domx-hud') || node.classList.contains('dompulse-hud') || node.closest('.dompulse-hud')) continue;

      const bbox = getBoundingBox(node);
      const vis = getVisibilityState(node, bbox);

      if (visibleOnly && !vis.visible) {
        continue;
      }

      const id = `@e${counter++}`;
      this.elementMap.set(id, node);

      const tag = node.tagName.toUpperCase();
      const role = node.getAttribute('role') || this.inferRole(node);
      const name = this.extractAccessibleName(node);
      const selector = this.buildSelector(node);

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
    // Fallback to query selector
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
   * Scrolls the page or an element.
   */
  public scroll(direction: 'up' | 'down' | 'top' | 'bottom' | 'element', amount = 400, target?: string): { success: boolean; message: string } {
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

    // Check inner text
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
