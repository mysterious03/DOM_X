/**
 * DOM_X Interactive Terminal REPL (Ollama & Claude Code Style)
 * Provides a rich, interactive TUI terminal with real-time browser control,
 * live 15ms DOM mutation streaming, visual element perception, privacy blur shield,
 * natural language locator, and live Gemini AI assistance.
 */

import readline from 'readline';
import path from 'path';
import { DOMPulseBridgeServer } from '../mcp/bridge-server';
import { DOMPulseEvent } from '../core/types';
import {
  askGemini,
  getActiveGeminiKey,
  testGeminiKey,
  saveGeminiKey,
} from './gemini-assistant';
import { runBenchmark, formatBenchmarkTable } from '../core/benchmark';

// ANSI terminal colors
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const UNDERLINE = '\x1b[4m';
const CYAN = '\x1b[36m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const ORANGE = '\x1b[38;5;208m';
const RED = '\x1b[31m';
const MAGENTA = '\x1b[35m';
const BLUE = '\x1b[34m';
const RESET = '\x1b[0m';

export interface InteractiveCLIOptions {
  bridge: DOMPulseBridgeServer;
  launchBrowser: (url?: string) => void;
  installConfig: (client: 'claude' | 'cursor' | 'all') => void;
  findChrome: () => string | null;
  rootDir: string;
}

export async function startInteractiveCLI(options: InteractiveCLIOptions): Promise<void> {
  const { bridge, launchBrowser, installConfig, findChrome, rootDir } = options;

  console.clear();

  // Print Retro Banner
  console.log(`
${ORANGE}${BOLD}  ██████╗   ██████╗  ███╗   ███╗     ██╗  ██╗
  ██╔══██╗ ██╔═══██╗ ████╗ ████║     ╚██╗██╔╝
  ██║  ██║ ██║   ██║ ██╔████╔██║      ╚███╔╝ 
  ██║  ██║ ██║   ██║ ██║╚██╔╝██║      ██╔██╗ 
  ██████╔╝ ╚██████╔╝ ██║ ╚═╝ ██║     ██╔╝ ██╗
  ╚═════╝   ╚═════╝  ╚═╝     ╚═╝     ╚═╝  ╚═╝${RESET}

  ${BOLD}✱ Welcome to DOM_X Interactive Terminal ✱${RESET}
  ${DIM}Zero-Cost Browser Perception, Action Engine & Privacy Shield for AI Agents${RESET}
`);

  const status = bridge.getStatus();
  const chromePath = findChrome();
  const activeGeminiKey = getActiveGeminiKey(rootDir);

  console.log(`  ${CYAN}●${RESET} Bridge:    ${BOLD}ws://127.0.0.1:${status.port}${RESET} ${DIM}(REST + OpenAPI 3.1.0)${RESET}`);
  console.log(`  ${chromePath ? GREEN + '●' : RED + '○'}${RESET} Chrome:    ${chromePath ? BOLD + 'Detected' + RESET : RED + 'Not Found (Run open or launch)' + RESET}`);
  console.log(`  ${status.connected ? GREEN + '● Active Tab: ' + status.activeTab?.title : YELLOW + '○ No Browser Tab Connected (Run open <url> to start Chrome)'}${RESET}`);
  console.log(
    `  ${activeGeminiKey ? GREEN + '●' : YELLOW + '○'}${RESET} AI Model:  ${
      activeGeminiKey ? BOLD + 'Gemini 2.0 Flash (Live AI Connected)' + RESET : DIM + 'Local Knowledge Engine (Type ' + BOLD + 'connect' + RESET + DIM + ' to link Gemini)' + RESET
    }`
  );
  console.log(`  ${DIM}Type ${BOLD}see${RESET}${DIM} to perceive page, ${BOLD}find <word>${RESET}${DIM} to locate, or ${BOLD}help${RESET}${DIM} for all commands.${RESET}\n`);

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: `${ORANGE}${BOLD}dom_x${RESET} > `,
    completer: (line: string) => {
      const completions = [
        'see', 'scan', 'find', 'click', 'type', 'hud', 'privacy',
        'highlight', 'xml', 'open', 'launch', 'goto', 'hover', 'scroll',
        'ask', 'connect', 'benchmark', 'status', 'install', 'clear', 'help', 'exit'
      ];
      const trimmed = line.trim().replace(/^\//, '');
      const hits = completions.filter((c) => c.startsWith(trimmed));
      return [hits.length ? hits : completions, line];
    },
  });

  // Helper for prompting questions without closing main readline
  function askPrompt(queryText: string): Promise<string> {
    return new Promise((resolve) => {
      rl.question(queryText, (answer) => {
        resolve(answer.trim());
      });
    });
  }

  // Stream real-time mutations to console
  bridge.on('mutation', (evt: DOMPulseEvent) => {
    readline.clearLine(process.stdout, 0);
    readline.cursorTo(process.stdout, 0);
    const scoreStr = evt.importanceScore ? `[${evt.importanceScore}/5]` : '';
    console.log(
      `${MAGENTA}⚡ [15ms DOM Mutation]${RESET} ${DIM}${scoreStr}${RESET} ${BOLD}${evt.type}${RESET}: ${evt.target}${
        evt.details?.text ? ` → "${CYAN}${evt.details.text}${RESET}"` : ''
      }`
    );
    rl.prompt(true);
  });

  bridge.on('tab_ready', (tab: { title: string; url: string }) => {
    readline.clearLine(process.stdout, 0);
    readline.cursorTo(process.stdout, 0);
    console.log(`${GREEN}✔ [DOM_X Active Tab]${RESET} "${BOLD}${tab.title}${RESET}" (${CYAN}${tab.url}${RESET})`);
    rl.prompt(true);
  });

  bridge.on('tab_disconnected', () => {
    readline.clearLine(process.stdout, 0);
    readline.cursorTo(process.stdout, 0);
    console.log(`${YELLOW}⚠ [DOM_X] Browser tab disconnected.${RESET}`);
    rl.prompt(true);
  });

  rl.prompt();

  rl.on('line', async (line) => {
    const raw = line.trim();
    if (!raw) {
      rl.prompt();
      return;
    }

    const parts = raw.split(/\s+/);
    let cmd = parts[0].toLowerCase();
    if (cmd.startsWith('/')) {
      cmd = cmd.substring(1);
    }

    const args = parts.slice(1);

    try {
      switch (cmd) {
        // ── HELP & ONBOARDING ────────────────────────────────────────────────
        case 'help':
        case '?': {
          console.log(`
${BOLD}DOM_X Command Palette & Cheat Sheet:${RESET}

${CYAN}${BOLD}👁️ Zero-Cost Visual Perception ($0.00 Vision)${RESET}
  ${GREEN}see${RESET}                       Look at the webpage visual scene + flash HUD on screen
  ${GREEN}scan${RESET}                      List all actionable elements with @e1, @e2... IDs
  ${GREEN}find <word>${RESET}               Locate button/link by English (e.g. find "checkout") & scroll to it
  ${GREEN}xml${RESET}                       Get structured Set-of-Mark XML with exact (x, y) coordinates

${ORANGE}${BOLD}⚡ Real Browser Actions (Reflected Live in Chrome)${RESET}
  ${GREEN}click <@id>${RESET}               Click an element (e.g. click @e1) & trigger click beacon
  ${GREEN}type <@id> <text>${RESET}         Type text into input field (e.g. type @e2 user@test.com)
  ${GREEN}highlight <@id>${RESET}           Pulse glowing highlight aura & beacon on target element
  ${GREEN}hover <@id>${RESET}               Hover over element to trigger tooltips & dropdowns
  ${GREEN}scroll [up|down|top|bot]${RESET}  Scroll active page smoothly
  ${GREEN}open <url>${RESET}                Open Chrome with DOM_X active (e.g. open github.com)
  ${GREEN}goto <url>${RESET}                Navigate active tab to a new URL

${RED}${BOLD}🛡️ Privacy & Screen Display${RESET}
  ${GREEN}privacy${RESET}                   Toggle on-screen Frosted Privacy Blur (hides passwords & cards)
  ${GREEN}hud${RESET}                       Toggle persistent neon bounding boxes on screen in Chrome

${MAGENTA}${BOLD}🤖 AI & LLM Assistants${RESET}
  ${GREEN}ask <question>${RESET}            Ask Gemini 2.0 Flash or local assistant about DOM_X & browser tasks
  ${GREEN}connect${RESET}                   Link & test your Google Gemini API key
  ${GREEN}chatgpt${RESET}                   Guide to plug DOM_X into ChatGPT Custom GPT Actions in 60s
  ${GREEN}install [claude|cursor]${RESET}   Auto-configure Claude Desktop or Cursor MCP

${DIM}Type any command above directly (with or without '/'). Example: see, find "search", click @e1${RESET}
`);
          break;
        }

        // ── ZERO-COST VISUAL PERCEPTION (SEE) ────────────────────────────────
        case 'see':
        case 'perceive':
        case 'look': {
          console.log(`${CYAN}⚡ Perceiving active webpage via DOM-VLM ($0.00 vision cost)...${RESET}`);
          
          // Flash the HUD in Chrome so the user sees the real-time bounding boxes
          bridge.sendCommand('TOGGLE_HUD', { enabled: true }).catch(() => {});
          setTimeout(() => {
            bridge.sendCommand('TOGGLE_HUD', { enabled: false }).catch(() => {});
          }, 4000);

          const res = await bridge.sendCommand('VLM_PERCEIVE', {});
          if (!res) {
            console.log(`${YELLOW}No perception data returned. Is Chrome open with the extension active?${RESET}`);
            break;
          }

          console.log(`\n${BOLD}╔══════════════════════════════════════════════════════════════════════════════╗${RESET}`);
          console.log(`${BOLD}║  ⚡ DOM_X Visual Scene Perception  •  $0.00 Cost  •  ${res.elapsedMs || 6}ms Latency          ║${RESET}`);
          console.log(`${BOLD}╚══════════════════════════════════════════════════════════════════════════════╝${RESET}`);
          console.log(`  ${BOLD}Page Title:${RESET}  "${res.title || 'Untitled'}"`);
          console.log(`  ${BOLD}URL:${RESET}         ${CYAN}${res.url || 'Unknown'}${RESET}`);
          console.log(`  ${BOLD}Viewport:${RESET}    ${res.viewport?.width || 1280}×${res.viewport?.height || 800} px`);
          console.log(`  ${BOLD}Targets:${RESET}     ${GREEN}${res.totalInteractive || (res.elements ? res.elements.length : 0)} interactive elements${RESET} detected`);
          console.log(`  ${DIM}👁️  Visual neon bounding boxes flashed on screen in Chrome for 4s.${RESET}\n`);

          if (Array.isArray(res.elements) && res.elements.length > 0) {
            console.log(`${BOLD}=== KEY INTERACTIVE TARGETS ===${RESET}`);
            for (const el of res.elements.slice(0, 18)) {
              const tag = `${ORANGE}${BOLD}${el.actionId || el.id}${RESET}`;
              const kind = `${CYAN}[${(el.kind || el.role || 'ELEMENT').toUpperCase()}]${RESET}`;
              const label = el.label || el.name || el.text || '';
              const cleanLabel = label ? `"${label.substring(0, 36)}"` : `${DIM}(no label)${RESET}`;
              const coords = el.bbox ? `${DIM}center(${el.bbox.centerX || el.bbox.x}, ${el.bbox.centerY || el.bbox.y})${RESET}` : '';
              console.log(`  ${tag.padEnd(12)} ${kind.padEnd(18)} ${cleanLabel.padEnd(42)} ${coords}`);
            }
            if (res.elements.length > 18) {
              console.log(`${DIM}  ... and ${res.elements.length - 18} more targets.${RESET}`);
            }
            console.log('');
            const firstId = res.elements[0]?.actionId || res.elements[0]?.id || '@e1';
            console.log(`💡 ${BOLD}Next Action:${RESET} Type ${GREEN}click ${firstId}${RESET} to click or ${GREEN}find "word"${RESET} to search!`);
          }
          break;
        }

        // ── NATURAL LANGUAGE ELEMENT FINDER (FIND) ──────────────────────────
        case 'find':
        case 'locate':
        case 'search': {
          const query = args.join(' ').replace(/^["']|["']$/g, '');
          if (!query) {
            console.log(`${RED}Usage: find <plain English word or phrase>${RESET}`);
            console.log(`Example: ${GREEN}find "sign in button"${RESET} or ${GREEN}find "search input"${RESET}`);
            break;
          }

          console.log(`${CYAN}🔍 Finding "${query}" on active webpage...${RESET}`);
          const res = await bridge.sendCommand('VLM_LOCATE', { query });

          if (!res || !Array.isArray(res.matches) || res.matches.length === 0) {
            console.log(`${YELLOW}No elements matched "${query}".${RESET}`);
            console.log(`Tip: Type ${GREEN}see${RESET} to view all actionable targets on the page.`);
            break;
          }

          const best = res.matches[0];
          const el = best.element;
          const targetId = el.actionId || el.id;

          // Scroll to the element and flash highlight on the real page in Chrome!
          if (targetId) {
            bridge.sendCommand('HIGHLIGHT', { target: targetId, color: '#10b981' }).catch(() => {});
          }

          console.log(`\n${GREEN}✔ Found matching element (${Math.round((best.score || 0.85) * 100)}% match):${RESET}`);
          console.log(`  ${BOLD}Target ID:${RESET}   ${ORANGE}${BOLD}${targetId}${RESET}`);
          console.log(`  ${BOLD}Kind:${RESET}        ${CYAN}[${(el.kind || el.role || 'ELEMENT').toUpperCase()}]${RESET}`);
          console.log(`  ${BOLD}Label:${RESET}       "${el.label || el.name || el.text || ''}"`);
          if (el.bbox) {
            console.log(`  ${BOLD}Click Pixel:${RESET} center(${el.bbox.centerX || el.bbox.x}, ${el.bbox.centerY || el.bbox.y})`);
          }
          console.log(`  ${DIM}🎯 Highlighted on screen in Chrome with a pulsing beacon!${RESET}\n`);

          if (['textbox', 'input'].includes((el.kind || el.role || '').toLowerCase())) {
            console.log(`👉 ${BOLD}Next Action:${RESET} Type ${GREEN}type ${targetId} "your text"${RESET} to fill this input.`);
          } else {
            console.log(`👉 ${BOLD}Next Action:${RESET} Type ${GREEN}click ${targetId}${RESET} to click this target.`);
          }
          break;
        }

        // ── ON-SCREEN FROSTED PRIVACY BLUR SHIELD ───────────────────────────
        case 'privacy':
        case 'privacyshield':
        case 'blur':
        case 'hide': {
          console.log(`${CYAN}🔒 Toggling on-screen Frosted Privacy Shield in Chrome...${RESET}`);
          const res = await bridge.sendCommand('TOGGLE_PRIVACY', {});

          if (res?.active) {
            console.log(`\n${GREEN}${BOLD}✔ Privacy Shield: ACTIVE 🔒${RESET}`);
            console.log(`  • Frosted blur (${BOLD}blur: 14px${RESET}) applied to all password, credit card, and secret fields.`);
            console.log(`  • Physical red ${BOLD}[🔒 BLURRED PRIVATE]${RESET} banner rendered on monitor.`);
            console.log(`  • Protected fields count: ${BOLD}${res.blurredCount || 0}${RESET}`);
            console.log(`  • Monitor shoulder-surfers and screen-shares cannot read sensitive credentials.`);
          } else {
            console.log(`\n${YELLOW}🔓 Privacy Shield: DEACTIVATED${RESET}`);
            console.log(`  • On-screen frosted blur removed.`);
          }
          console.log('');
          break;
        }

        // ── SCAN DOM ELEMENTS ───────────────────────────────────────────────
        case 'scan':
        case 'dom':
        case 'state': {
          console.log(`${CYAN}🔍 Scanning active tab DOM elements...${RESET}`);
          const res = await bridge.sendCommand('GET_DOM', { preset: 'interactive', visibleOnly: true });
          if (!res || !Array.isArray(res.elements) || res.elements.length === 0) {
            console.log(`${YELLOW}No actionable elements found on current page.${RESET}`);
          } else {
            console.log(
              `\n${BOLD}[DOM_X Perception | Tab: "${res.title || 'Unknown'}" | Actionable Elements: ${res.elements.length}]${RESET}`
            );
            console.log(`${DIM}--------------------------------------------------------------------------------${RESET}`);
            for (const el of res.elements.slice(0, 30)) {
              const tag = el.actionId ? `${ORANGE}${BOLD}${el.actionId}${RESET}` : '@??';
              const role = `${CYAN}[${(el.role || el.tagName || 'ELEMENT').toUpperCase()}]${RESET}`;
              const text = el.text ? `"${el.text.substring(0, 35)}"` : el.placeholder ? `"${el.placeholder}"` : '';
              const bounds = el.boundingBox ? `${DIM}(${el.boundingBox.width}×${el.boundingBox.height} at: ${el.boundingBox.x},${el.boundingBox.y})${RESET}` : '';
              console.log(`  ${tag.padEnd(12)} ${role.padEnd(18)} ${text.padEnd(42)} ${bounds}`);
            }
            if (res.elements.length > 30) {
              console.log(`${DIM}  ... and ${res.elements.length - 30} more elements.${RESET}`);
            }
            console.log(`${DIM}--------------------------------------------------------------------------------${RESET}\n`);
            console.log(`💡 ${BOLD}Quick Tip:${RESET} Type ${GREEN}click @e1${RESET} or ${GREEN}type @e2 "text"${RESET} to interact!`);
          }
          break;
        }

        // ── CLICK ACTION ────────────────────────────────────────────────────
        case 'click': {
          const target = args[0];
          if (!target) {
            console.log(`${RED}Usage: click <@id | selector>${RESET}`);
            console.log(`Example: ${GREEN}click @e1${RESET}`);
            break;
          }
          console.log(`${CYAN}Clicking ${target}...${RESET}`);
          const res = await bridge.sendCommand('CLICK', { target });
          console.log(`${GREEN}✔ ${res.message || `Clicked ${target} successfully!`}${RESET}`);
          console.log(`${DIM}⚡ Dispatched smooth scroll, focus, and native click with on-screen action beacon.${RESET}`);
          break;
        }

        // ── TYPE ACTION ─────────────────────────────────────────────────────
        case 'type': {
          const target = args[0];
          const text = args.slice(1).join(' ').replace(/^["']|["']$/g, '');
          if (!target || !text) {
            console.log(`${RED}Usage: type <@id | selector> <text to type>${RESET}`);
            console.log(`Example: ${GREEN}type @e2 mypassword${RESET}`);
            break;
          }
          console.log(`${CYAN}Typing into ${target}...${RESET}`);
          const res = await bridge.sendCommand('TYPE', { target, text });
          console.log(`${GREEN}✔ ${res.message || `Typed into ${target}`}${RESET}`);
          console.log(`💡 Tip: Dispatched input & change events. Type ${GREEN}/key Enter${RESET} if you wish to submit.`);
          break;
        }

        // ── HIGHLIGHT ELEMENT ───────────────────────────────────────────────
        case 'highlight':
        case 'flash': {
          const target = args[0];
          if (!target) {
            console.log(`${RED}Usage: highlight <@id | selector>${RESET}`);
            console.log(`Example: ${GREEN}highlight @e1${RESET}`);
            break;
          }
          console.log(`${CYAN}Highlighting ${target} in Chrome...${RESET}`);
          const res = await bridge.sendCommand('HIGHLIGHT', { target, color: '#38bdf8' });
          console.log(`${GREEN}✔ ${res.message || `Highlighted ${target}`}${RESET}`);
          break;
        }

        // ── HUD OVERLAY ─────────────────────────────────────────────────────
        case 'hud': {
          const res = await bridge.sendCommand('TOGGLE_HUD', {});
          const active = Boolean(res?.enabled);
          console.log(
            `${GREEN}✔ Visual HUD ${active ? 'ENABLED (Neon Bounding Boxes ON)' : 'DISABLED'}${RESET}`
          );
          if (active) {
            console.log(`${DIM}Set-of-Mark reticles and @e labels are now rendered live on screen in Chrome at 60 FPS.${RESET}`);
          }
          break;
        }

        // ── XML SET-OF-MARK ─────────────────────────────────────────────────
        case 'xml': {
          console.log(`${CYAN}Generating Set-of-Mark XML scene...${RESET}`);
          const res = await bridge.sendCommand('VLM_XML_PERCEIVE', {});
          if (res?.xml) {
            console.log('\n' + res.xml + '\n');
            console.log(`${DIM}<!-- DOM-VLM XML | Cost: $0.00 | Latency: ${res.elapsedMs || 6}ms -->${RESET}`);
          } else {
            console.log(`${YELLOW}No XML returned. Is Chrome open?${RESET}`);
          }
          break;
        }

        // ── HOVER ───────────────────────────────────────────────────────────
        case 'hover': {
          const target = args[0];
          if (!target) {
            console.log(`${RED}Usage: hover <@id | selector>${RESET}`);
            break;
          }
          const res = await bridge.sendCommand('HOVER', { target });
          console.log(`${GREEN}✔ ${res.message || 'Hovered!'}${RESET}`);
          break;
        }

        // ── SCROLL ──────────────────────────────────────────────────────────
        case 'scroll': {
          const direction = args[0] || 'down';
          const res = await bridge.sendCommand('SCROLL', { direction, amount: 400 });
          console.log(`${GREEN}✔ ${res.message || `Scrolled ${direction}`}${RESET}`);
          break;
        }

        // ── GOTO / OPEN ─────────────────────────────────────────────────────
        case 'launch':
        case 'open':
        case 'goto': {
          const url = args[0] || 'https://google.com';
          const statusNow = bridge.getStatus();
          if (!statusNow.connected) {
            console.log(`${CYAN}⚡ Launching Chrome with DOM_X at: ${url}...${RESET}`);
            launchBrowser(url);
          } else {
            console.log(`${CYAN}Navigating active tab to: ${url}...${RESET}`);
            const res = await bridge.sendCommand('NAVIGATE', { url });
            console.log(`${GREEN}✔ ${res.message || `Navigated to ${url}`}${RESET}`);
          }
          break;
        }

        // ── CONNECT / LINK GEMINI API KEY ────────────────────────────────────
        case 'connect':
        case 'key':
        case 'gemini': {
          console.log(`\n${BOLD}=== Connect Google Gemini API to DOM_X ===${RESET}`);
          console.log(`Connecting a Gemini API key lets DOM_X answer questions with live intelligence`);
          console.log(`and help you command the browser in natural language.`);
          console.log(`Get a free key in 10 seconds at: ${CYAN}${UNDERLINE}https://aistudio.google.com/app/apikey${RESET}\n`);

          const currentKey = getActiveGeminiKey(rootDir);
          if (currentKey) {
            const masked = currentKey.slice(0, 6) + '••••••••' + currentKey.slice(-4);
            console.log(`Current key: ${CYAN}${masked}${RESET}`);
          }

          const inputKey = args[0] || await askPrompt(`👉 Enter Gemini API Key (or press Enter to cancel): `);
          if (!inputKey) {
            console.log(`${DIM}Key setup cancelled.${RESET}\n`);
            break;
          }

          console.log(`${CYAN}Testing key with Google Gemini API...${RESET}`);
          const testRes = await testGeminiKey(inputKey);

          if (testRes.success) {
            saveGeminiKey(inputKey, rootDir);
            console.log(`\n${GREEN}${BOLD}✔ Successfully connected to Google Gemini! (${testRes.model})${RESET}`);
            console.log(`Key saved to local .env file. You can now use ${BOLD}ask <question>${RESET} anytime!\n`);
          } else {
            console.log(`\n${RED}✘ Connection failed:${RESET} ${testRes.message}`);
            console.log(`Please verify your API key at https://aistudio.google.com/app/apikey\n`);
          }
          break;
        }

        // ── ASK AI ASSISTANT ─────────────────────────────────────────────────
        case 'ask':
        case 'askgemini': {
          let query = args.join(' ');
          if (!query) {
            query = await askPrompt(`👉 What would you like to ask the AI assistant? `);
            if (!query) break;
          }

          const hasKey = Boolean(getActiveGeminiKey(rootDir));

          // If no key is configured, offer to link one interactively
          if (!hasKey) {
            console.log(`\n${YELLOW}🔑 No Google Gemini API key configured.${RESET}`);
            console.log(`DOM_X can use live ${BOLD}Gemini 2.0 Flash${RESET} to answer questions or automate browser tasks.`);
            console.log(`Free key available at: ${CYAN}${UNDERLINE}https://aistudio.google.com/app/apikey${RESET}`);
            const wantKey = await askPrompt(`Would you like to enter a Gemini key now? [paste key or press Enter to skip]: `);

            if (wantKey) {
              console.log(`${CYAN}Testing key...${RESET}`);
              const test = await testGeminiKey(wantKey);
              if (test.success) {
                saveGeminiKey(wantKey, rootDir);
                console.log(`${GREEN}✔ Connected to Gemini 2.0 Flash!${RESET}\n`);
              } else {
                console.log(`${RED}✘ Invalid key (${test.message}). Using local knowledge instead.${RESET}\n`);
              }
            }
          }

          console.log(`${CYAN}🤖 Thinking...${RESET}\n`);
          const resp = await askGemini(query, rootDir);

          if (resp.source === 'gemini') {
            console.log(`${BOLD}[Gemini 2.0 Flash Assistant]${RESET}`);
            console.log(resp.answer);
          } else {
            console.log(`${BOLD}[DOM_X Local Assistant]${RESET}`);
            console.log(resp.answer);
          }
          console.log('');
          break;
        }

        // ── BENCHMARK ───────────────────────────────────────────────────────
        case 'benchmark':
        case 'bench': {
          console.log(`${CYAN}⚡ Running DOM_X Token Reduction & Latency Benchmark...${RESET}`);
          const results = runBenchmark();
          const table = formatBenchmarkTable(results);
          console.log(table);
          break;
        }

        // ── CHATGPT INTEGRATION ─────────────────────────────────────────────
        case 'chatgpt':
        case 'gpt':
        case 'openapi': {
          const port = bridge.getStatus().port || 8765;
          console.log(`
${BOLD}╔══════════════════════════════════════════════════════════════════════╗${RESET}
${BOLD}║  🤖 How to Plug DOM_X into ChatGPT (Custom GPT in 60s)               ║${RESET}
${BOLD}║  Zero-Cost DOM-VLM · Visual Perception · Browser Automation          ║${RESET}
${BOLD}╚══════════════════════════════════════════════════════════════════════╝${RESET}

${CYAN}${BOLD}Step 1: Expose local bridge port to ChatGPT cloud${RESET}
Since ChatGPT runs remotely in OpenAI's cloud, make your local bridge reachable:

  ${GREEN}npx localtunnel --port ${port}${RESET}
  → Gives you a public URL like: ${BOLD}https://quick-tiger-42.loca.lt${RESET}

${CYAN}${BOLD}Step 2: Add Action to ChatGPT Custom GPT${RESET}
1. Open ${UNDERLINE}https://chatgpt.com/gpts/editor${RESET} (or ChatGPT → Explore GPTs → Create)
2. In the "Configure" tab, scroll down to "Actions" → Click ${BOLD}"Create new action"${RESET}
3. Under "Schema", click ${BOLD}"Import from URL"${RESET}
4. Paste your tunnel URL + /openapi.json:
   e.g. ${BOLD}https://YOUR-TUNNEL-URL/openapi.json${RESET}
5. Click "Import" — ChatGPT automatically loads all DOM_X tools!
`);
          break;
        }

        // ── MUTATIONS STREAM ────────────────────────────────────────────────
        case 'mutations':
        case 'changes': {
          const mutations = bridge.getMutations(15);
          if (mutations.length === 0) {
            console.log(`${DIM}No recent DOM mutations recorded.${RESET}`);
          } else {
            console.log(`\n${BOLD}Recent 15ms DOM Mutations:${RESET}`);
            for (const m of mutations) {
              console.log(`  ${MAGENTA}•${RESET} ${BOLD}${m.type}${RESET} on ${CYAN}${m.target}${RESET} ${m.details?.text ? `("${m.details.text}")` : ''}`);
            }
            console.log('');
          }
          break;
        }

        // ── EVAL ────────────────────────────────────────────────────────────
        case 'eval': {
          const expr = args.join(' ');
          if (!expr) {
            console.log(`${RED}Usage: eval <javascript expression>${RESET}`);
            break;
          }
          const res = await bridge.sendCommand('EVAL', { expression: expr });
          console.log(`${GREEN}=>${RESET}`, res.result);
          break;
        }

        // ── INSTALL MCP ─────────────────────────────────────────────────────
        case 'install': {
          const client = (args[0] as 'claude' | 'cursor' | 'all') || 'all';
          installConfig(client);
          break;
        }

        // ── STATUS ──────────────────────────────────────────────────────────
        case 'status': {
          const s = bridge.getStatus();
          const gKey = getActiveGeminiKey(rootDir);
          console.log(`\n${BOLD}=== DOM_X System Diagnostics ===${RESET}`);
          console.log(`Bridge Port:  ${s.port} (WebSocket + HTTP REST)`);
          console.log(`Connected:    ${s.connected ? GREEN + 'Yes (Tab Active)' + RESET : RED + 'No Tab Connected' + RESET}`);
          console.log(`Active Tab:   ${s.activeTab ? `"${s.activeTab.title}" (${s.activeTab.url})` : 'None'}`);
          console.log(`Chrome Exec:  ${findChrome() || 'Not Found'}`);
          console.log(`Gemini Key:   ${gKey ? GREEN + 'Configured (' + gKey.slice(0, 4) + '...' + gKey.slice(-4) + ')' + RESET : YELLOW + 'Not Set (Run connect)' + RESET}`);
          console.log(`Root Path:    ${rootDir}\n`);
          break;
        }

        case 'clear': {
          console.clear();
          break;
        }

        case 'exit':
        case 'quit': {
          console.log(`\n${ORANGE}Goodbye from DOM_X!${RESET}\n`);
          process.exit(0);
          break;
        }

        default: {
          console.log(`${RED}Unknown command: "${raw}".${RESET}`);
          console.log(`Type ${GREEN}help${RESET} to see all commands, or ${GREEN}see${RESET} to look at the webpage.`);
          break;
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('No browser tab connected')) {
        console.log(`\n${RED}✘ No browser tab connected yet.${RESET}`);
        console.log(`\n${YELLOW}${BOLD}👉 Quick 10-Second Setup to activate DOM_X in Chrome:${RESET}`);
        console.log(`  1. In Chrome, open:  ${CYAN}${BOLD}chrome://extensions${RESET}`);
        console.log(`  2. Turn ${BOLD}ON [Developer mode]${RESET} (toggle in top-right corner)`);
        console.log(`  3. Click ${BOLD}[Load unpacked]${RESET} (top-left)`);
        console.log(`  4. Select the "dist" folder:`);
        console.log(`     👉 ${GREEN}${BOLD}${path.resolve(rootDir, 'dist')}${RESET}`);
        console.log(`  5. Switch to any tab and type ${BOLD}see${RESET} again!\n`);
      } else {
        console.log(`${RED}✘ Error:${RESET} ${msg}`);
      }
    }

    rl.prompt();
  });

  rl.on('close', () => {
    console.log(`\n${ORANGE}DOM_X session ended.${RESET}`);
    process.exit(0);
  });
}
