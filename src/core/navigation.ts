/**
 * DOMPulse SPA Navigation Interceptor
 * Safely intercepts history.pushState, history.replaceState, popstate, and hashchange
 * without altering native browser behavior, arguments, or return values.
 */

import { DOMPulseEvent } from './types';

export type NavigationCallback = (event: DOMPulseEvent) => void;

export class NavigationObserver {
  private onNavigate: NavigationCallback;
  private originalPushState: typeof history.pushState | null = null;
  private originalReplaceState: typeof history.replaceState | null = null;
  private popstateListener: ((e: PopStateEvent) => void) | null = null;
  private hashchangeListener: ((e: HashChangeEvent) => void) | null = null;
  private lastUrl: string;
  private isObserving = false;

  constructor(onNavigate: NavigationCallback) {
    this.onNavigate = onNavigate;
    this.lastUrl = typeof window !== 'undefined' ? window.location.href : '';
  }

  public start(): void {
    if (this.isObserving || typeof window === 'undefined' || typeof history === 'undefined') {
      return;
    }

    this.lastUrl = window.location.href;
    const self = this;

    // 1. Wrap history.pushState
    this.originalPushState = history.pushState;
    history.pushState = function (data: any, unused: string, url?: string | URL | null) {
      const prevUrl = window.location.href;
      const res = self.originalPushState!.apply(this, [data, unused, url]);
      const currentUrl = window.location.href;
      if (prevUrl !== currentUrl) {
        self.emitNavigation(prevUrl, currentUrl);
      }
      return res;
    };

    // 2. Wrap history.replaceState
    this.originalReplaceState = history.replaceState;
    history.replaceState = function (data: any, unused: string, url?: string | URL | null) {
      const prevUrl = window.location.href;
      const res = self.originalReplaceState!.apply(this, [data, unused, url]);
      const currentUrl = window.location.href;
      if (prevUrl !== currentUrl) {
        self.emitNavigation(prevUrl, currentUrl);
      }
      return res;
    };

    // 3. Listen to popstate (back / forward)
    this.popstateListener = () => {
      const currentUrl = window.location.href;
      if (self.lastUrl !== currentUrl) {
        const prev = self.lastUrl;
        self.emitNavigation(prev, currentUrl);
      }
    };
    window.addEventListener('popstate', this.popstateListener);

    // 4. Listen to hashchange
    this.hashchangeListener = (e: HashChangeEvent) => {
      self.emitNavigation(e.oldURL || self.lastUrl, e.newURL || window.location.href);
    };
    window.addEventListener('hashchange', this.hashchangeListener);

    // 5. Ensure cleanup if page is unloaded or extension context is killed
    window.addEventListener('pagehide', () => this.stop(), { once: true });

    this.isObserving = true;
  }

  public stop(): void {
    if (!this.isObserving || typeof window === 'undefined' || typeof history === 'undefined') {
      return;
    }

    if (this.originalPushState) {
      history.pushState = this.originalPushState;
      this.originalPushState = null;
    }

    if (this.originalReplaceState) {
      history.replaceState = this.originalReplaceState;
      this.originalReplaceState = null;
    }

    if (this.popstateListener) {
      window.removeEventListener('popstate', this.popstateListener);
      this.popstateListener = null;
    }

    if (this.hashchangeListener) {
      window.removeEventListener('hashchange', this.hashchangeListener);
      this.hashchangeListener = null;
    }

    this.isObserving = false;
  }

  private emitNavigation(beforeUrl: string, afterUrl: string): void {
    this.lastUrl = afterUrl;
    const now = Date.now();

    const winW = typeof window !== 'undefined' ? window.innerWidth : 1920;
    const winH = typeof window !== 'undefined' ? window.innerHeight : 1080;

    const event: DOMPulseEvent = {
      eventId: `nav_${now}_${Math.floor(Math.random() * 1000)}`,
      type: 'NAVIGATION_DETECTED',
      timestamp: now,
      element: {
        tag: 'WINDOW',
        selector: 'window.location',
        classes: [],
      },
      before: beforeUrl,
      after: afterUrl,
      bbox: { x: 0, y: 0, width: winW, height: winH },
      visibility: { visible: true, inViewport: true },
      importance: 5,
    };

    try {
      this.onNavigate(event);
    } catch (err) {
      console.warn('[DOMPulse] Error dispatching navigation event:', err);
    }
  }
}
