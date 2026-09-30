/**
 * DOM_X CLI & Easy Installer
 * Provides one-command setup, auto-config for Claude/Cursor, Chrome launcher, and MCP server runner.
 */

import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import { DOMPulseMCPServer } from '../mcp/server';
import { testGeminiKey, saveGeminiKey, getActiveGeminiKey } from './gemini-assistant';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..', '..');

/**
 * Auto-detects Google Chrome binary path across platforms.
 */
function findChromeExecutable(): string | null {
  const platform = os.platform();

  if (platform === 'win32') {
    const paths = [
      path.join(process.env.PROGRAMFILES || 'C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)', 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    ];
    for (const p of paths) {
      if (fs.existsSync(p)) return p;
    }
  } else if (platform === 'darwin') {
    const p = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    if (fs.existsSync(p)) return p;
  } else {
    // Linux
    const paths = ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium-browser', '/usr/bin/chromium'];
    for (const p of paths) {
      if (fs.existsSync(p)) return p;
    }
  }

  return null;
}

/**
 * Resolves configuration paths for AI clients.
 */
function getClientConfigPaths() {
  const platform = os.platform();
  let claudePath: string | null = null;
  let cursorPath: string | null = null;

  if (platform === 'win32') {
    claudePath = path.join(process.env.APPDATA || '', 'Claude', 'claude_desktop_config.json');
    cursorPath = path.join(os.homedir(), '.cursor', 'mcp.json');
  } else if (platform === 'darwin') {
    claudePath = path.join(os.homedir(), 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
    cursorPath = path.join(os.homedir(), '.cursor', 'mcp.json');
  } else {
    claudePath = path.join(os.homedir(), '.config', 'Claude', 'claude_desktop_config.json');
    cursorPath = path.join(os.homedir(), '.cursor', 'mcp.json');
  }

  return { claudePath, cursorPath };
}

/**
 * Injects DOM_X into Claude Desktop or Cursor configuration.
 */
function installConfig(target: 'claude' | 'cursor' | 'all') {
  const { claudePath, cursorPath } = getClientConfigPaths();
  const mcpIndexPath = path.resolve(ROOT_DIR, 'dist', 'mcp', 'index.js');

  const serverEntry = {
    command: 'node',
    args: [mcpIndexPath],
  };

  const targets = target === 'all' ? ['claude', 'cursor'] : [target];

  for (const t of targets) {
    const configPath = t === 'claude' ? claudePath : cursorPath;
    if (!configPath) continue;

    try {
      const dir = path.dirname(configPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      let config: any = { mcpServers: {} };
      if (fs.existsSync(configPath)) {
        try {
          config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
          if (!config.mcpServers) config.mcpServers = {};
        } catch {
          config = { mcpServers: {} };
        }
      }

      config.mcpServers['dom-x'] = serverEntry;
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
      console.log(`[DOM_X] Successfully installed DOM_X MCP server into ${t.toUpperCase()} config:`);
      console.log(`         ${configPath}`);
    } catch (err: unknown) {
      console.error(`[DOM_X] Failed to write config for ${t}:`, err instanceof Error ? err.message : err);
    }
  }
}

/**
 * Launches Chrome with DOM_X extension pre-loaded.
 */
function copyToClipboard(text: string): void {
  try {
    const platform = os.platform();
    if (platform === 'win32') {
      const proc = spawn('clip');
      proc.stdin.write(text);
      proc.stdin.end();
    } else if (platform === 'darwin') {
      const proc = spawn('pbcopy');
      proc.stdin.write(text);
      proc.stdin.end();
    }
  } catch {}
}

function launchBrowser(url = 'https://google.com') {
  const chromePath = findChromeExecutable();
  if (!chromePath) {
    console.error('[DOM_X] Could not locate Google Chrome executable automatically.');
    console.error('        Please open Chrome manually and load unpacked extension from:');
    console.error(`        ${path.resolve(ROOT_DIR, 'dist')}`);
    process.exit(1);
  }

  const distDir = path.resolve(ROOT_DIR, 'dist');
  copyToClipboard(distDir);

  const args = [
    `--load-extension=${distDir}`,
    url,
  ];

  const child = spawn(chromePath, args, {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();

  console.log(`
======================================================================
  ⚡ DOM_X CHROME EXTENSION SETUP (First-Time Only — Takes 10s) ⚡
======================================================================
 Opened Chrome at: ${url}

 If this is your first time using DOM_X:
 1. In Chrome, open a new tab to:  chrome://extensions
 2. Turn ON [Developer mode] (toggle switch in the top-right corner)
 3. Click [Load unpacked] (button in the top-left corner)
 4. Select the "dist" folder (already copied to your clipboard!):
    👉 ${distDir}

 5. Now switch back to any website (e.g. ${url}) and type /scan!
======================================================================
`);
}

import { DOMPulseBridgeServer } from '../mcp/bridge-server';
import { startInteractiveCLI } from './interactive';

import { runBenchmark, formatBenchmarkTable } from '../core/benchmark';
import { askGemini } from './gemini-assistant';

async function callBridge(action: string, params: Record<string, unknown> = {}): Promise<any> {
  const port = process.env.DOM_X_PORT ? parseInt(process.env.DOM_X_PORT, 10) : 8765;
  const baseUrl = `http://127.0.0.1:${port}`;

  // 1. Fast path: check if bridge HTTP server is already running
  try {
    const statusRes = await fetch(`${baseUrl}/api/status`, { signal: AbortSignal.timeout(600) });
    if (statusRes.ok) {
      let endpoint = '';
      if (action === 'VLM_PERCEIVE') endpoint = '/api/vlm/perceive';
      else if (action === 'VLM_LOCATE') endpoint = '/api/vlm/locate';
      else if (action === 'VLM_DESCRIBE') endpoint = '/api/vlm/describe';
      else if (action === 'VLM_XML_PERCEIVE') endpoint = '/api/vlm/xml';
      else if (action === 'CLICK') endpoint = '/api/action/click';
      else if (action === 'TYPE') endpoint = '/api/action/type';


      if (endpoint) {
        const postRes = await fetch(`${baseUrl}${endpoint}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(params),
          signal: AbortSignal.timeout(8000),
        });
        const json = (await postRes.json()) as any;
        if (!postRes.ok || json.success === false) {
          throw new Error(json.message || json.error || 'Request failed');
        }
        return json;
      }
    }
  } catch (err: any) {
    if (err.name !== 'TimeoutError' && !err.message?.includes('fetch failed') && !err.message?.includes('ECONNREFUSED')) {
      throw err;
    }
  }

  // 2. Slow path: Bridge not running; start an ephemeral bridge
  const bridge = new DOMPulseBridgeServer({ port });
  await bridge.start();
  await new Promise((r) => setTimeout(r, 1200));
  try {
    const res = await bridge.sendCommand(action, params);
    await bridge.stop();
    return res;
  } catch (err) {
    await bridge.stop();
    throw err;
  }
}

/**
 * Main CLI router.
 */
export async function runCLI(argv: string[]) {
  const argCommand = argv[2];

  // If no command provided:
  // If run in an interactive terminal (TTY), launch the Interactive REPL (like Ollama / Claude Code)
  // If run non-interactively (piped / spawned by Claude or Cursor), run stdio MCP server
  const command = argCommand || (process.stdin.isTTY ? 'interactive' : 'serve');

  switch (command) {
    case 'interactive':
    case 'repl':
    case 'chat':
    case '-i': {
      const port = process.env.DOM_X_PORT ? parseInt(process.env.DOM_X_PORT, 10) : 8765;
      const bridge = new DOMPulseBridgeServer({ port });
      await bridge.start();

      await startInteractiveCLI({
        bridge,
        launchBrowser,
        installConfig,
        findChrome: findChromeExecutable,
        rootDir: ROOT_DIR,
      });
      break;
    }

    case 'benchmark':
    case 'bench': {
      console.log('⚡ Running DOM_X Token Reduction & Latency Benchmark...');
      const results = runBenchmark();
      console.log(formatBenchmarkTable(results));
      break;
    }

    case 'ask':
    case 'askgemini': {
      const question = argv.slice(3).join(' ');
      if (!question) {
        console.log('Usage: domx ask <your question>');
        process.exit(1);
      }
      console.log('🤖 Asking DOM_X Assistant...\n');
      const answer = await askGemini(question);
      console.log(answer);
      break;
    }

    case 'serve': {
      const port = process.env.DOM_X_PORT ? parseInt(process.env.DOM_X_PORT, 10) : 8765;
      const server = new DOMPulseMCPServer(port);
      await server.start();
      break;
    }

    case 'open':
    case 'start':
    case 'launch': {
      const url = argv[3] || 'https://google.com';
      launchBrowser(url);
      break;
    }

    case 'install': {
      const client = (argv[3] as 'claude' | 'cursor' | 'all') || 'all';
      installConfig(client);
      break;
    }

    case 'status': {
      const port = process.env.DOM_X_PORT || '8765';
      console.log('=== DOM_X System Status ===');
      console.log(`Node Version:  ${process.version}`);
      console.log(`MCP Port:      ${port}`);
      console.log(`Root Dir:      ${ROOT_DIR}`);
      console.log(`Dist Built:    ${fs.existsSync(path.resolve(ROOT_DIR, 'dist', 'content.js')) ? 'Yes' : 'No'}`);
      console.log(`MCP Bundle:    ${fs.existsSync(path.resolve(ROOT_DIR, 'dist', 'mcp', 'index.js')) ? 'Yes' : 'No'}`);
      const chrome = findChromeExecutable();
      console.log(`Chrome Found:  ${chrome || 'Not Found'}`);
      break;
    }

    case 'see':
    case 'look':
    case 'perceive': {
      console.log('[DOM_X] Perceiving active browser tab visually...');
      try {
        const result = await callBridge('VLM_PERCEIVE', {});
        if (result.sceneText) {
          console.log(result.sceneText);
          console.log(`\n[DOM_X] Cost: $0.00 | Elapsed: ${result.elapsedMs}ms`);
        } else {
          console.log('[DOM_X] No scene data returned. Ensure Chrome is open with the DOM_X extension loaded.');
        }
      } catch (err: unknown) {
        console.error('[DOM_X Error]', err instanceof Error ? err.message : err);
      }
      break;
    }

    case 'find':
    case 'locate': {
      const query = argv.slice(3).join(' ');
      if (!query) {
        console.log('Usage: domx find <what to search for>');
        console.log('Example: domx find "sign in button"');
        process.exit(1);
      }
      console.log(`[DOM_X] Finding: "${query}"...`);
      try {
        const result = await callBridge('VLM_LOCATE', { query, topK: 3 });
        if (result.found && result.matches?.length > 0) {
          console.log(`[DOM_X] Found ${result.matches.length} match(es) for "${query}" in ${result.elapsedMs}ms:\n`);
          for (let i = 0; i < result.matches.length; i++) {
            const m = result.matches[i];
            const el = m.element;
            console.log(`  Match #${i + 1} (${Math.round(m.score * 100)}% confidence) — ${m.reason}`);
            console.log(`    Action ID: ${el.actionId}`);
            console.log(`    Kind: ${el.kind} | Label: "${el.label}"`);
            console.log(`    Click at: (${el.bbox.centerX}, ${el.bbox.centerY}) | Region: ${el.region}`);
            console.log(`    Selector: ${el.selector}\n`);
          }
          console.log(`Tip: Run "domx click ${result.matches[0].element.actionId}" to click this element!`);
        } else {
          console.log(`[DOM_X] No element found for query: "${query}"`);
          console.log('Tip: Run "domx see" to view all visible elements first.');
        }
      } catch (err: unknown) {
        console.error('[DOM_X Error]', err instanceof Error ? err.message : err);
      }
      break;
    }

    case 'click': {
      const target = argv[3];
      if (!target) {
        console.log('Usage: domx click <@id | selector>');
        console.log('Example: domx click @e1');
        process.exit(1);
      }
      console.log(`[DOM_X] Clicking: ${target}...`);
      try {
        const result = await callBridge('CLICK', { target });
        console.log(`✔ ${result?.message || `Clicked ${target}`}`);
      } catch (err: unknown) {
        console.error('[DOM_X Error]', err instanceof Error ? err.message : err);
      }
      break;
    }

    case 'type': {
      const target = argv[3];
      const text = argv.slice(4).join(' ');
      if (!target || text === undefined) {
        console.log('Usage: domx type <@id> <text to type>');
        console.log('Example: domx type @e2 "user@example.com"');
        process.exit(1);
      }
      console.log(`[DOM_X] Typing into ${target}...`);
      try {
        const result = await callBridge('TYPE', { target, text });
        console.log(`✔ ${result?.message || `Typed "${text}" into ${target}`}`);
      } catch (err: unknown) {
        console.error('[DOM_X Error]', err instanceof Error ? err.message : err);
      }
      break;
    }

    case 'hud':
    case 'box':
    case 'boxes': {
      console.log('[DOM_X] Toggling in-browser visual HUD...');
      try {
        const result = await callBridge('TOGGLE_HUD', {});
        console.log(`✔ In-browser HUD ${result?.enabled ? 'Enabled (Neon Bounding Boxes ON)' : 'Disabled'}`);
      } catch (err: unknown) {
        console.error('[DOM_X Error]', err instanceof Error ? err.message : err);
      }
      break;
    }

    case 'privacy':
    case 'blur':
    case 'hide': {
      console.log('[DOM_X] Toggling on-screen Frosted Privacy Shield in Chrome...');
      try {
        const result = await callBridge('TOGGLE_PRIVACY', {});
        if (result?.active) {
          console.log(`✔ Privacy Shield ACTIVE: ${result.blurredCount || 0} sensitive fields protected with on-screen frosted blur.`);
          console.log('  Passwords, credit cards, and secret tokens are now physically obscured on your monitor.');
        } else {
          console.log('🔓 Privacy Shield DISABLED: On-screen frosted blur removed.');
        }
      } catch (err: unknown) {
        console.error('[DOM_X Error]', err instanceof Error ? err.message : err);
      }
      break;
    }

    case 'connect':
    case 'key':
    case 'gemini': {
      const inputKey = argv[3];
      if (!inputKey) {
        const active = getActiveGeminiKey(ROOT_DIR);
        if (active) {
          console.log(`Current key: ${active.slice(0, 6)}••••••••${active.slice(-4)}`);
          console.log('Testing connection to Google Gemini...');
          const res = await testGeminiKey(active);
          console.log(res.success ? `✔ ${res.message}` : `✘ ${res.message}`);
        } else {
          console.log('Usage: domx key <your_gemini_api_key>');
          console.log('Get a free key in 10s at: https://aistudio.google.com/app/apikey');
        }
        break;
      }

      console.log('Testing key with Google Gemini...');
      const res = await testGeminiKey(inputKey);
      if (res.success) {
        saveGeminiKey(inputKey, ROOT_DIR);
        console.log(`✔ Successfully connected to Google Gemini! (${res.model})`);
        console.log('Key saved to local .env file.');
      } else {
        console.error(`✘ Connection failed: ${res.message}`);
      }
      break;
    }

    case 'describe': {
      console.log('[DOM-VLM] Generating page description...');
      try {
        const result = await callBridge('VLM_DESCRIBE', {});
        const desc = result.description || result.sceneText || '';
        if (desc) {
          console.log('\n[DOM-VLM Scene Description | $0.00 | No VLM API needed]');
          console.log('─'.repeat(70));
          console.log(desc);
          console.log('─'.repeat(70));
        } else {
          console.log('[DOM-VLM] No description available. Ensure Chrome is open with the DOM_X extension.');
        }
      } catch (err: unknown) {
        console.error('[DOM-VLM Error]', err instanceof Error ? err.message : err);
      }
      break;
    }

    case 'xml': {
      const forceRefresh = argv.includes('--force') || argv.includes('-f');
      console.log('[DOM-VLM] Generating XML scene with bounding boxes...');
      try {
        const result = await callBridge('VLM_XML_PERCEIVE', { forceRefresh });
        const xml: string = result.xml || '';
        if (xml) {
          console.log(xml);
          console.log(`\n<!-- DOM-VLM XML | Cost: $0.00 | Elapsed: ${result.elapsedMs}ms -->`);
        } else {
          console.log('[DOM-VLM] No XML data returned. Ensure Chrome is open with the DOM_X extension loaded.');
        }
      } catch (err: unknown) {
        console.error('[DOM-VLM Error]', err instanceof Error ? err.message : err);
      }
      break;
    }

    case 'chatgpt':
    case 'gpt':
    case 'openapi': {
      const port = process.env.DOM_X_PORT || '8765';
      const isJson = argv.includes('--json');
      if (isJson) {
        const bridge = new DOMPulseBridgeServer({ port: Number(port) });
        console.log(JSON.stringify(bridge.getOpenApiSpec(), null, 2));
      } else {
        console.log(`
╔══════════════════════════════════════════════════════════════════════╗
║  🤖 How to Plug DOM_X into ChatGPT (Custom GPT in 60s)               ║
║  Zero-Cost DOM-VLM · Visual Perception · Browser Automation          ║
╚══════════════════════════════════════════════════════════════════════╝

Step 1: Expose local bridge port to ChatGPT cloud
------------------------------------------------------------------------
Since ChatGPT runs remotely in OpenAI's cloud, make your local bridge reachable:

  Option A (Zero-setup localtunnel):
    npx localtunnel --port ${port}
    → Gives you a public URL like: https://quick-tiger-42.loca.lt

  Option B (Cloudflare tunnel - fast & free):
    cloudflared tunnel --url http://127.0.0.1:${port}

  Option C (ngrok):
    ngrok http ${port}

Step 2: Add Action to ChatGPT Custom GPT
------------------------------------------------------------------------
1. Open https://chatgpt.com/gpts/editor (or ChatGPT → Explore GPTs → Create)
2. In the "Configure" tab, scroll down to "Actions" → Click "Create new action"
3. Under "Schema", click "Import from URL"
4. Paste your tunnel URL + /openapi.json:
   e.g. https://YOUR-TUNNEL-URL/openapi.json
   (Or local URL: http://127.0.0.1:${port}/openapi.json)
5. Click "Import" — ChatGPT will load all 7 DOM_X browser perception tools!

Step 3: ChatGPT System Instructions (paste into Instructions box)
------------------------------------------------------------------------
"You are an AI browser agent powered by DOM_X zero-cost DOM-VLM.
To see the active webpage visually, call GET /api/vlm/xml or POST /api/vlm/perceive.
To find any element by English words, call POST /api/vlm/locate.
To interact, call POST /api/action/click or POST /api/action/type.
All private info (passwords, payment cards) is auto-blurred and protected."

Tip: Run "domx openapi --json" to output the raw JSON schema.
`);
      }
      break;
    }

    case 'python': {
      const port = process.env.DOM_X_PORT || '8765';
      console.log(`
# ─── DOM_X Python Client Snippet ─────────────────────────────
# Zero-cost DOM-VLM integration with Python / LangChain / OpenAI

import requests

BASE_URL = "http://127.0.0.1:${port}"

def perceive_page():
    """Perceives page layout and returns LLM-ready text description ($0.00 cost)."""
    res = requests.post(f"{BASE_URL}/api/vlm/perceive").json()
    return res["sceneText"]

def locate_element(query: str):
    """Locates an element using plain natural language."""
    res = requests.post(f"{BASE_URL}/api/vlm/locate", json={"query": query}).json()
    if res.get("found") and res.get("matches"):
        top_match = res["matches"][0]
        return top_match["element"]["actionId"]  # e.g. "@e3"
    return None

def click_element(action_id: str):
    """Clicks the element."""
    return requests.post(f"{BASE_URL}/api/action/click", json={"target": action_id}).json()

def type_text(action_id: str, text: str, press_enter: bool = True):
    """Types text into field."""
    return requests.post(f"{BASE_URL}/api/action/type", json={
        "target": action_id, "text": text, "pressEnter": press_enter
    }).json()

# Example usage:
if __name__ == "__main__":
    print("Page Scene:\\n", perceive_page())
    tag = locate_element("search input")
    if tag:
        print("Found search field:", tag)
        type_text(tag, "DOM-VLM github", press_enter=True)
`);
      break;
    }

    case '--help':
    case '-h':
    case 'help': {
      console.log(`
DOM_X CLI — Simple Browser Perception & Automation

Usage:
  domx [command] [options]
  (Run "domx" without arguments to open the interactive terminal)

⚡ Simple Commands:
  see                     Look at the active webpage (zero-cost DOM vision, $0.00)
  find <text>             Find any button, input, or link (e.g. domx find "sign in")
  click <@id>             Click an element (e.g. domx click @e1)
  type <@id> <text>       Type into a field (e.g. domx type @e2 "user@test.com")
  hud                     Toggle live neon bounding boxes on-screen in Chrome
  xml                     Output structured XML scene with pixel-exact bounding boxes
  open [url]              Open Chrome with DOM_X (e.g. domx open github.com)
  help                    Show this help message

🤖 AI Agent & Developer Tools:
  serve                   Start MCP stdio server for Claude Desktop / Cursor
  install [client]        Auto-configure AI client (claude | cursor | all)
  openapi                 Show OpenAPI 3.1.0 endpoints & Custom GPT Action setup
  python                  Show Python / LangChain / OpenAI agent code snippet
  benchmark               Run token reduction & performance benchmark tests
  ask <question>          Ask built-in AI assistant
  status                  Display diagnostic info

Examples:
  domx                    Start the simple interactive terminal session
  domx see                Perceive active webpage visually
  domx find "login"       Find login button and get click coordinates
  domx click @e1          Click element @e1
  domx type @e2 "hello"   Type "hello" into element @e2
  domx hud                Turn on visual bounding boxes in browser
  domx xml                Export XML with coordinates for AI agents
`);
      break;
    }

    default:
      console.error(`Unknown command: "${command}".`);
      console.log('Try: domx see, domx find <text>, domx click <@id>, or domx help');
      process.exit(1);
  }
}
