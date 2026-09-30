import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DOMPulseBridgeServer } from '../src/mcp/bridge-server';
import { DOMPulseBridgeClient } from '../src/core/bridge-client';
import { DOMVLMEngine } from '../src/core/vlm-engine';

describe('DOMPulse MCP Bridge Communication', () => {
  let server: DOMPulseBridgeServer;
  let client: DOMPulseBridgeClient;
  let vlmEngine: DOMVLMEngine;
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
    vlmEngine = new DOMVLMEngine();
    client.attachVLMEngine(vlmEngine);
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

  it('handles HOVER command via MCP bridge', async () => {
    const snapshot = await server.sendCommand('GET_DOM', { visibleOnly: false });
    const cartEl = snapshot.elements.find((e: any) => e.name === 'Add to Cart');

    const res = await server.sendCommand('HOVER', { target: cartEl.id });
    expect(res.success).toBe(true);
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

  it('handles INSPECT command via MCP bridge', async () => {
    const snapshot = await server.sendCommand('GET_DOM', { visibleOnly: false });
    const cartEl = snapshot.elements.find((e: any) => e.name === 'Add to Cart');

    const res = await server.sendCommand('INSPECT', { target: cartEl.id });
    expect(res.success).toBe(true);
    expect(res.inspection.tag).toBe('BUTTON');
  });

  it('handles EVAL command via MCP bridge', async () => {
    const res = await server.sendCommand('EVAL', { expression: '10 * 5' });
    expect(res).toBe(50);
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

  // ─── DOM-VLM Bridge Tests ─────────────────────────────────

  it('handles VLM_PERCEIVE command via MCP bridge', async () => {
    const res = await server.sendCommand('VLM_PERCEIVE', {});
    expect(res.success).toBe(true);
    expect(res.sceneText).toBeDefined();
    expect(res.sceneText).toContain('DOM-VLM Perception');
    expect(res.elapsedMs).toBeDefined();
  });

  it('handles VLM_LOCATE command and finds elements by plain English', async () => {
    const res = await server.sendCommand('VLM_LOCATE', { query: 'cart button', topK: 1 });
    expect(res.success).toBe(true);
    expect(res.found).toBe(true);
    expect(res.matches.length).toBeGreaterThanOrEqual(1);
    expect(res.matches[0].element.label).toBe('Add to Cart');
  });

  it('handles VLM_DESCRIBE command via MCP bridge', async () => {
    const res = await server.sendCommand('VLM_DESCRIBE', {});
    expect(res.success).toBe(true);
    expect(res.sceneText).toBeDefined();
  });

  // ─── HTTP REST & OpenAPI Endpoints ─────────────────────────

  it('serves OpenAPI 3.1.0 specification at /openapi.json for ChatGPT Custom GPT', async () => {
    const res = await fetch(`http://127.0.0.1:${testPort}/openapi.json`);
    expect(res.status).toBe(200);
    const spec = await res.json() as any;
    expect(spec.openapi).toBe('3.1.0');
    expect(spec.info.title).toContain('DOM_X');
    expect(spec.paths['/api/vlm/perceive']).toBeDefined();
    expect(spec.paths['/api/vlm/locate']).toBeDefined();
    expect(spec.paths['/api/action/click']).toBeDefined();
  });

  it('serves OpenAI Function Calling tools schema at /api/openai/tools', async () => {
    const res = await fetch(`http://127.0.0.1:${testPort}/api/openai/tools`);
    expect(res.status).toBe(200);
    const data = await res.json() as any;
    expect(data.tools).toBeInstanceOf(Array);
    const toolNames = data.tools.map((t: any) => t.function.name);
    expect(toolNames).toContain('vlm_perceive');
    expect(toolNames).toContain('vlm_locate');
    expect(toolNames).toContain('browser_click');
  });

  it('serves health and tab status at /api/status', async () => {
    const res = await fetch(`http://127.0.0.1:${testPort}/api/status`);
    expect(res.status).toBe(200);
    const data = await res.json() as any;
    expect(data.success).toBe(true);
    expect(data.connected).toBe(true);
  });
});
