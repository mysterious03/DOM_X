import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DOMPulseBridgeServer } from '../src/mcp/bridge-server';
import { DOMPulseBridgeClient } from '../src/core/bridge-client';

describe('DOMPulse MCP Bridge Communication', () => {
  let server: DOMPulseBridgeServer;
  let client: DOMPulseBridgeClient;
  const testPort = 8799;

  beforeAll(async () => {
    document.body.innerHTML = `
      <div id="test-root">
        <button id="cart-btn">Add to Cart</button>
        <input id="search-box" type="text" placeholder="Search..." />
      </div>
    `;

    server = new DOMPulseBridgeServer({ port: testPort });
    await server.start();

    client = new DOMPulseBridgeClient({
      wsUrl: `ws://127.0.0.1:${testPort}`,
      autoReconnect: false,
    });
    client.connect();

    // Wait 200ms for connection handshake
    await new Promise((r) => setTimeout(r, 200));
  });

  afterAll(async () => {
    client.disconnect();
    await server.stop();
  });

  it('reports bridge server status as connected with active tab', () => {
    const status = server.getStatus();
    expect(status.connected).toBe(true);
    expect(status.totalTabs).toBeGreaterThanOrEqual(1);
  });

  it('handles GET_DOM command and returns structured element snapshot', async () => {
    const snapshot = await server.sendCommand('GET_DOM', { visibleOnly: false });
    expect(snapshot).toBeDefined();
    expect(snapshot.elements).toBeInstanceOf(Array);
    expect(snapshot.elements.length).toBeGreaterThanOrEqual(2);
  });

  it('handles CLICK command via MCP bridge', async () => {
    let clicked = false;
    document.getElementById('cart-btn')!.addEventListener('click', () => {
      clicked = true;
    });

    const snapshot = await server.sendCommand('GET_DOM', { visibleOnly: false });
    const cartEl = snapshot.elements.find((e: any) => e.name === 'Add to Cart');
    expect(cartEl).toBeDefined();

    const res = await server.sendCommand('CLICK', { target: cartEl.id });
    expect(res.success).toBe(true);
    expect(clicked).toBe(true);
  });

  it('handles TYPE command via MCP bridge', async () => {
    const snapshot = await server.sendCommand('GET_DOM', { visibleOnly: false });
    const inputEl = snapshot.elements.find((e: any) => e.tag === 'INPUT');
    expect(inputEl).toBeDefined();

    const res = await server.sendCommand('TYPE', { target: inputEl.id, text: 'DOM_X' });
    expect(res.success).toBe(true);
    const searchBox = document.getElementById('search-box') as HTMLInputElement;
    expect(searchBox.value).toBe('DOM_X');
  });

  it('collects mutation events pushed from browser client', async () => {
    client.sendMutationBatch([
      {
        id: 'evt-1',
        type: 'TEXT_CHANGED',
        timestamp: 15,
        targetElement: { tag: 'BUTTON', selector: '#cart-btn' },
        importance: 3,
        boundingBox: { x: 0, y: 0, width: 100, height: 40 },
        inViewport: true,
      },
    ]);

    await new Promise((r) => setTimeout(r, 50));
    const mutations = server.getMutations(10);
    expect(mutations.length).toBeGreaterThanOrEqual(1);
    expect(mutations[mutations.length - 1].type).toBe('TEXT_CHANGED');
  });
});
