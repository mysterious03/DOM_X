/**
 * DOM_X Interactive Terminal REPL (Ollama & Claude Code Style)
 * Provides a rich, interactive TUI terminal with real-time browser control,
 * live 15ms DOM mutation streaming, element perception, and agent-like execution.
 */

import readline from 'readline';
import { DOMPulseBridgeServer } from '../mcp/bridge-server';
import { DOMPulseEvent } from '../core/types';
import { askGemini } from './gemini-assistant';
import { runBenchmark, formatBenchmarkTable } from '../core/benchmark';

// ANSI terminal colors
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const CYAN = '\x1b[36m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const ORANGE = '\x1b[38;5;208m';
const RED = '\x1b[31m';
const MAGENTA = '\x1b[35m';
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
  ${DIM}Real-Time Browser Perception & Action Engine for AI Agents${RESET}
`);

  const status = bridge.getStatus();
  const chromePath = findChrome();

  console.log(`  ${CYAN}●${RESET} Bridge: ${BOLD}ws://127.0.0.1:${status.port}${RESET}`);
  console.log(`  ${chromePath ? GREEN + '●' : RED + '○'}${RESET} Chrome: ${chromePath ? BOLD + 'Detected' + RESET : RED + 'Not Found (Run /launch)' + RESET}`);
  console.log(`  ${status.connected ? GREEN + '● Active Tab: ' + status.activeTab?.title : YELLOW + '○ No Browser Tab Connected (Run /launch to start Chrome)'}${RESET}`);
  console.log(`  ${DIM}Type ${BOLD}/ask <question>${RESET}${DIM} for AI guidance, or ${BOLD}/help${RESET}${DIM} for commands.${RESET}\n`);

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: `${ORANGE}${BOLD}dom_x${RESET} > `,
    completer: (line: string) => {
      const completions = [
        '/ask', '/askgemini', '/benchmark',
        '/launch', '/scan', '/dom', '/click', '/type', '/hover',
        '/scroll', '/goto', '/hud', '/mutations', '/status',
        '/install', '/eval', '/help', '/clear', '/exit'
      ];
      const hits = completions.filter((c) => c.startsWith(line.trim()));
      return [hits.length ? hits : completions, line];
    },
  });

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
        case 'help':
        case '?': {
          console.log(`
${BOLD}Available DOM_X Interactive Commands:${RESET}

  ${CYAN}/ask <question>${RESET}         Ask built-in AI / Gemini how to use DOM_X, reduce tokens, etc.
  ${CYAN}/benchmark${RESET}              Run empirical benchmark proving 94%+ token reduction & speedup
  ${CYAN}/launch [url]${RESET}          Launch Chrome with DOM_X pre-loaded (e.g. /launch https://github.com)
  ${CYAN}/scan${RESET} or ${CYAN}/dom${RESET}          Extract actionable elements & IDs (@e1, @e2...) from active tab
  ${CYAN}/click <@id|selector>${RESET}   Click an element (e.g. /click @e1 or /click #submit)
  ${CYAN}/type <@id> <text>${RESET}      Type text into an input field (e.g. /type @e2 mypassword)
  ${CYAN}/hover <@id>${RESET}             Hover over an element (e.g. /hover @e4)
  ${CYAN}/scroll [dir]${RESET}            Scroll active page (up | down | top | bottom)
  ${CYAN}/goto <url>${RESET}              Navigate active tab to a URL (e.g. /goto https://google.com)
  ${CYAN}/hud${RESET}                     Toggle the in-browser visual bounding box HUD in Chrome
  ${CYAN}/mutations${RESET}               List recent 15ms change intelligence events
  ${CYAN}/eval <expr>${RESET}             Execute JavaScript in the active browser tab
  ${CYAN}/install [client]${RESET}        Auto-configure AI client (claude | cursor | all)
  ${CYAN}/status${RESET}                  Display connection diagnostics & Chrome path
  ${CYAN}/clear${RESET}                   Clear terminal screen
  ${CYAN}/exit${RESET} or ${CYAN}quit${RESET}             Exit interactive session
`);
          break;
        }

        case 'ask':
        case 'askgemini':
        case 'gemini': {
          const query = args.join(' ');
          if (!query) {
            console.log(`${YELLOW}Usage: /ask <question>${RESET}`);
            console.log(`Example: ${CYAN}/ask how does DOM_X reduce tokens?${RESET}`);
            break;
          }
          console.log(`${CYAN}🤖 Asking DOM_X Assistant...${RESET}\n`);
          const answer = await askGemini(query);
          console.log(`${answer}\n`);
          break;
        }

        case 'benchmark':
        case 'bench': {
          console.log(`${CYAN}⚡ Running DOM_X Token Reduction & Latency Benchmark...${RESET}`);
          const results = runBenchmark();
          const table = formatBenchmarkTable(results);
          console.log(table);
          break;
        }

        case 'launch':
        case 'open': {
          const url = args[0] || 'https://google.com';
          console.log(`${CYAN}⚡ Launching Chrome with DOM_X at: ${url}...${RESET}`);
          console.log(`${DIM}💡 Tip: You can launch any website by passing its URL (e.g. /launch https://example.com)${RESET}`);
          launchBrowser(url);
          break;
        }

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
              const text = el.text ? `"${el.text.substring(0, 40)}"` : el.placeholder ? `"${el.placeholder}"` : '';
              const bounds = el.boundingBox ? `${DIM}(${el.boundingBox.width}x${el.boundingBox.height} at: ${el.boundingBox.x},${el.boundingBox.y})${RESET}` : '';
              console.log(`  ${tag.padEnd(12)} ${role.padEnd(20)} ${text.padEnd(45)} ${bounds}`);
            }
            if (res.elements.length > 30) {
              console.log(`${DIM}  ... and ${res.elements.length - 30} more elements.${RESET}`);
            }
            console.log(`${DIM}--------------------------------------------------------------------------------${RESET}\n`);
          }
          break;
        }

        case 'click': {
          const target = args[0];
          if (!target) {
            console.log(`${RED}Usage: /click <@e1 | selector>${RESET}`);
            break;
          }
          console.log(`${CYAN}Clicking ${target}...${RESET}`);
          const res = await bridge.sendCommand('CLICK', { target });
          console.log(`${GREEN}✔ ${res.message || 'Clicked successfully!'}${RESET}`);
          break;
        }

        case 'type': {
          const target = args[0];
          const text = args.slice(1).join(' ');
          if (!target || !text) {
            console.log(`${RED}Usage: /type <@e1 | selector> <text to type>${RESET}`);
            break;
          }
          console.log(`${CYAN}Typing into ${target}...${RESET}`);
          const res = await bridge.sendCommand('TYPE', { target, text });
          console.log(`${GREEN}✔ ${res.message || 'Text entered successfully!'}${RESET}`);
          break;
        }

        case 'hover': {
          const target = args[0];
          if (!target) {
            console.log(`${RED}Usage: /hover <@e1 | selector>${RESET}`);
            break;
          }
          const res = await bridge.sendCommand('HOVER', { target });
          console.log(`${GREEN}✔ ${res.message || 'Hovered!'}${RESET}`);
          break;
        }

        case 'scroll': {
          const direction = args[0] || 'down';
          const res = await bridge.sendCommand('SCROLL', { direction, amount: 400 });
          console.log(`${GREEN}✔ ${res.message || `Scrolled ${direction}`}${RESET}`);
          break;
        }

        case 'goto': {
          const url = args[0];
          if (!url) {
            console.log(`${RED}Usage: /goto <url>${RESET}`);
            break;
          }
          const res = await bridge.sendCommand('NAVIGATE', { url });
          console.log(`${GREEN}✔ Navigating to: ${url}${RESET}`);
          break;
        }

        case 'hud': {
          const res = await bridge.sendCommand('TOGGLE_HUD', {});
          console.log(`${GREEN}✔ In-browser HUD ${res.enabled ? 'Enabled' : 'Disabled'}${RESET}`);
          break;
        }

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

        case 'eval': {
          const expr = args.join(' ');
          if (!expr) {
            console.log(`${RED}Usage: /eval <javascript expression>${RESET}`);
            break;
          }
          const res = await bridge.sendCommand('EVAL', { expression: expr });
          console.log(`${GREEN}=>${RESET}`, res.result);
          break;
        }

        case 'install': {
          const client = (args[0] as 'claude' | 'cursor' | 'all') || 'all';
          installConfig(client);
          break;
        }

        case 'status': {
          const s = bridge.getStatus();
          console.log(`\n${BOLD}=== DOM_X System Status ===${RESET}`);
          console.log(`Bridge Port:  ${s.port}`);
          console.log(`Connected:    ${s.connected ? GREEN + 'Yes' + RESET : RED + 'No' + RESET}`);
          console.log(`Active Tab:   ${s.activeTab ? `"${s.activeTab.title}" (${s.activeTab.url})` : 'None'}`);
          console.log(`Chrome Exec:  ${findChrome() || 'Not Found'}`);
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
          console.log(`${RED}Unknown command: "${raw}". Type /help to see all interactive commands.${RESET}`);
          break;
        }
      }
    } catch (err: unknown) {
      console.log(`${RED}✘ Error:${RESET} ${err instanceof Error ? err.message : String(err)}`);
    }

    rl.prompt();
  });

  rl.on('close', () => {
    console.log(`\n${ORANGE}DOM_X session ended.${RESET}`);
    process.exit(0);
  });
}
