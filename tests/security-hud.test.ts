import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DOMPulseBridgeServer } from '../src/mcp/bridge-server';
import { DOMAgentPerceiver } from '../src/core/agent-dom';
import { DOMVLMEngine } from '../src/core/vlm-engine';

describe('DOM_X Security & Live Screen Bounding Box (HUD)', () => {
  let perceiver: DOMAgentPerceiver;
  let vlmEngine: DOMVLMEngine;

  beforeAll(() => {
    document.body.innerHTML = `
      <div id="app">
        <header>
          <nav>
            <a id="home-link" href="https://example.com">Home</a>
            <a id="about-link" href="https://example.com/about">About</a>
          </nav>
        </header>
        <main>
          <h1>Welcome</h1>
          <form id="login-form">
            <input id="user-email" type="email" name="email" value="alice@test.com" placeholder="Email" />
            <input id="user-pass" type="password" name="password" value="SuperSecret123!" placeholder="Password" />
            <input id="user-card" type="text" autocomplete="cc-number" value="4111222233334444" placeholder="Card Number" />
            <button id="submit-btn" type="submit">Sign In</button>
          </form>
        </main>
      </div>
    `;

    perceiver = new DOMAgentPerceiver();
    vlmEngine = new DOMVLMEngine();
  });

  describe('1. Sensitive Data Masking & Privacy Guardrails', () => {
    it('masks password values in agent DOM scan and marks sensitive=true', () => {
      const snap = perceiver.scan({ visibleOnly: false });
      const passEl = snap.elements.find((e) => e.selector.includes('user-pass'));
      expect(passEl).toBeDefined();
      expect(passEl?.sensitive).toBe(true);
      expect(passEl?.value).toBe('••••••••');
      expect(passEl?.value).not.toContain('SuperSecret123!');
    });

    it('masks credit card field values and flags them as sensitive', () => {
      const snap = perceiver.scan({ visibleOnly: false });
      const cardEl = snap.elements.find((e) => e.selector.includes('user-card'));
      expect(cardEl).toBeDefined();
      expect(cardEl?.sensitive).toBe(true);
      expect(cardEl?.value).toBe('••••••••');
    });

    it('masks passwords and tags sensitive="true" in VLM XML scene generation', () => {
      const xmlOutput = vlmEngine.perceiveXml(true);
      expect(xmlOutput.xml).toBeDefined();
      expect(xmlOutput.xml).toContain('sensitive="true"');
      expect(xmlOutput.xml).not.toContain('SuperSecret123!');
    });
  });

  describe('2. Navigation & JavaScript Execution Sandbox', () => {
    it('blocks dangerous navigation protocols (javascript:, file:, data:)', () => {
      const resJs = perceiver.navigate('javascript:alert(1)');
      expect(resJs.success).toBe(false);
      expect(resJs.message).toContain('Security violation');

      const resFile = perceiver.navigate('file:///etc/passwd');
      expect(resFile.success).toBe(false);
      expect(resFile.message).toContain('Security violation');
    });

    it('blocks access to document.cookie in evalScript', () => {
      const res = perceiver.evalScript('console.log(document.cookie)');
      expect(res.success).toBe(false);
      expect(res.error).toContain('Security violation');
    });
  });

  describe('3. Visual Bounding Box Screen HUD Engine', () => {
    it('toggles in-browser visual HUD and renders cyber-grade bounding boxes', () => {
      const active = perceiver.toggleHUD(true);
      expect(active).toBe(true);
      expect(perceiver.isHUDActive()).toBe(true);

      const hudEl = document.querySelector('.domx-hud');
      expect(hudEl).not.toBeNull();

      // Verify banner
      expect(hudEl?.textContent).toContain('DOM_X LIVE DOM-VLM');
      expect(hudEl?.textContent).toContain('TRACKING');

      // Verify bounding boxes exist
      const boxes = hudEl?.querySelectorAll('.domx-hud-box');
      expect(boxes && boxes.length).toBeGreaterThanOrEqual(1);

      // Verify toggle off cleans up DOM
      perceiver.toggleHUD(false);
      expect(document.querySelector('.domx-hud')).toBeNull();
    });

    it('supports flashHUD for temporary real-time vision verification', () => {
      perceiver.flashHUD(3000);
      const hudEl = document.querySelector('.domx-hud');
      expect(hudEl).not.toBeNull();
      perceiver.toggleHUD(false);
    });
  });

  describe('4. Bridge Server Network Security & Authentication', () => {
    const securePort = 8798;
    let secureServer: DOMPulseBridgeServer;

    beforeAll(async () => {
      secureServer = new DOMPulseBridgeServer({
        port: securePort,
        apiKey: 'test-secret-token-xyz',
        requireAuth: true,
      });
      await secureServer.start();
    });

    afterAll(async () => {
      await secureServer.stop();
    });

    it('rejects unauthorized requests with 401 when token is missing', async () => {
      const res = await fetch(`http://127.0.0.1:${securePort}/api/vlm/perceive`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('Unauthorized');
    });

    it('allows requests with valid Authorization Bearer token', async () => {
      const res = await fetch(`http://127.0.0.1:${securePort}/api/status`, {
        method: 'GET',
        headers: { Authorization: 'Bearer test-secret-token-xyz' },
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
    });

    it('blocks requests with invalid Host header (DNS rebinding protection)', async () => {
      const http = await import('http');
      const statusCode = await new Promise<number>((resolve, reject) => {
        const req = http.request(
          {
            hostname: '127.0.0.1',
            port: securePort,
            path: '/api/status',
            method: 'GET',
            headers: {
              Host: 'malicious-attacker-domain.com',
              Authorization: 'Bearer test-secret-token-xyz',
            },
          },
          (res) => {
            resolve(res.statusCode || 0);
          }
        );
        req.on('error', reject);
        req.end();
      });
      expect(statusCode).toBe(403);
    }, 15000);

    it('blocks unauthorized cross-origin requests from external web pages', async () => {
      const res = await fetch(`http://127.0.0.1:${securePort}/api/status`, {
        method: 'GET',
        headers: {
          Origin: 'https://evil-phishing-site.com',
        },
      });
      expect(res.status).toBe(403);
    });
  });
});
