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
function launchBrowser(url = 'https://google.com') {
  const chromePath = findChromeExecutable();
  if (!chromePath) {
    console.error('[DOM_X] Could not locate Google Chrome executable automatically.');
    console.error('        Please open Chrome manually and load unpacked extension from:');
    console.error(`        ${path.resolve(ROOT_DIR, 'dist')}`);
    process.exit(1);
  }

  const distDir = path.resolve(ROOT_DIR, 'dist');
  const userDataDir = path.join(os.tmpdir(), 'dom-x-chrome-session');

  console.log(`[DOM_X] Launching Google Chrome with DOM_X extension loaded:`);
  console.log(`        Extension: ${distDir}`);
  console.log(`        Target URL: ${url}`);

  const args = [
    `--load-extension=${distDir}`,
    `--disable-extensions-except=${distDir}`,
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    url,
  ];

  const child = spawn(chromePath, args, {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();

  console.log('[DOM_X] Chrome launched with DOM_X extension active!');
  console.log('💡 Tip: Once the page loads, type "/scan" or ask Claude to inspect it.');
  console.log('       (Extensions activate on real URLs like https://github.com, not on chrome:// pages).');
}

import { DOMPulseBridgeServer } from '../mcp/bridge-server';
import { startInteractiveCLI } from './interactive';

import { runBenchmark, formatBenchmarkTable } from '../core/benchmark';
import { askGemini } from './gemini-assistant';

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

    case '--help':
    case '-h':
    case 'help': {
      console.log(`
DOM_X CLI - Browser Perception & Change-Intelligence MCP Server

Usage:
  domx [command] [options]

Commands:
  interactive, repl     Start interactive terminal REPL (default in TTY)
  benchmark             Run token reduction & performance benchmark tests
  ask <question>        Ask built-in AI / Gemini assistant how to use DOM_X
  serve                 Run MCP server over stdio for Claude Desktop / Cursor
  launch [url]          Launch Chrome with DOM_X extension pre-loaded
  install [client]      Auto-configure AI client (claude | cursor | all)
  status                Display diagnostic info and paths
  help                  Show this help screen

Examples:
  domx                         # Starts interactive terminal session (Ollama / Claude style)
  domx benchmark               # Proves 94%+ token reduction with real benchmark numbers
  domx ask "how do I use it"   # Answers questions about DOM_X with built-in/Gemini AI
  domx install claude          # Installs DOM_X into Claude Desktop
  domx install cursor          # Installs DOM_X into Cursor
  domx launch https://github.com # Opens Chrome with DOM_X loaded
  domx serve                   # Starts MCP server on stdio
`);
      break;
    }

    default:
      console.error(`Unknown command: ${command}. Run "dom-x --help" for available commands.`);
      process.exit(1);
  }
}
