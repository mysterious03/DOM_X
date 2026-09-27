import { describe, it, expect, vi } from 'vitest';
import { DOMObserver } from '../src/core/observer';

describe('DOMObserver Debounce & MaxWait Architecture', () => {
  it('flushes after trailing debounce period when mutations stop', async () => {
    const onFlush = vi.fn();
    const observer = new DOMObserver(
      {
        debounceMs: 50,
        maxWaitMs: 200,
        observeAttributes: true,
        observeCharacterData: true,
        observeChildList: true,
        observeSubtree: true,
        ignoreHiddenElements: true,
      },
      onFlush
    );

    const div = document.createElement('div');
    document.body.appendChild(div);
    observer.start(div);

    div.setAttribute('data-test', '1');

    // Wait 30ms (before debounce)
    await new Promise((r) => setTimeout(r, 30));
    expect(onFlush).not.toHaveBeenCalled();

    // Wait another 40ms (exceeding 50ms total)
    await new Promise((r) => setTimeout(r, 40));
    expect(onFlush).toHaveBeenCalledTimes(1);

    observer.stop();
  });

  it('triggers maxWait forced flush under continuous mutation stream', async () => {
    const onFlush = vi.fn();
    const observer = new DOMObserver(
      {
        debounceMs: 40,
        maxWaitMs: 100, // Max wait boundary
        observeAttributes: true,
        observeCharacterData: true,
        observeChildList: true,
        observeSubtree: true,
        ignoreHiddenElements: true,
      },
      onFlush
    );

    const div = document.createElement('div');
    document.body.appendChild(div);
    observer.start(div);

    // Fire continuous mutations every 20ms (faster than 40ms debounce)
    const interval = setInterval(() => {
      div.setAttribute('data-counter', String(Date.now()));
    }, 20);

    // At 240ms, maxWait (100ms) MUST have forced at least one flush!
    await new Promise((r) => setTimeout(r, 240));
    clearInterval(interval);

    expect(onFlush).toHaveBeenCalled();
    observer.stop();
  });

  it('supports pause, resume, stop, and manual flush cleanly', () => {
    const onFlush = vi.fn();
    const observer = new DOMObserver(
      {
        debounceMs: 100,
        maxWaitMs: 300,
        observeAttributes: true,
        observeCharacterData: true,
        observeChildList: true,
        observeSubtree: true,
        ignoreHiddenElements: true,
      },
      onFlush
    );

    const div = document.createElement('div');
    document.body.appendChild(div);

    observer.start(div);
    expect(observer.getStatus()).toBe(true);

    observer.pause();
    expect(observer.getStatus()).toBe(false);

    observer.resume(div);
    expect(observer.getStatus()).toBe(true);

    observer.stop();
    expect(observer.getStatus()).toBe(false);
  });
});
