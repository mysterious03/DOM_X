/**
 * DOM_X Built-In & Gemini AI Assistant
 * Provides natural language help, explanations of features, token reduction details,
 * and live Gemini API responses directly in the CLI with multi-model fallback,
 * key sanitization, connection testing & .env persistence.
 */

import fs from 'fs';
import path from 'path';

export interface GeminiResponse {
  answer: string;
  source: 'gemini' | 'local';
  model?: string;
  error?: string;
}

// Fallback models to test in priority order (using available endpoints)
const CANDIDATE_MODELS = [
  'gemini-flash-lite-latest',
  'gemini-3.5-flash-lite',
  'gemini-3.8-flash',
  'gemini-3.7-flash',
  'gemini-flash-latest',
  'gemini-2.5-flash',
];

/**
 * Sanitizes any raw input (strips "GEMINI_API_KEY=", "export", quotes, whitespace).
 */
export function sanitizeGeminiKey(raw: string): string {
  if (!raw) return '';
  let key = raw.trim();
  key = key.replace(/^(export\s+|set\s+)/i, '');
  key = key.replace(/^(gemini_api_key|google_api_key|api_key)\s*[:=]\s*/i, '');
  key = key.replace(/^["']|["']$/g, '').trim();
  return key;
}

/**
 * Attempts to load GEMINI_API_KEY from process.env or .env file.
 */
export function getActiveGeminiKey(rootDir?: string): string | null {
  if (process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim()) {
    return sanitizeGeminiKey(process.env.GEMINI_API_KEY);
  }

  // Check .env file in rootDir or current directory
  const pathsToCheck = [
    rootDir ? path.join(rootDir, '.env') : null,
    path.join(process.cwd(), '.env'),
  ].filter(Boolean) as string[];

  for (const envPath of pathsToCheck) {
    if (fs.existsSync(envPath)) {
      try {
        const content = fs.readFileSync(envPath, 'utf8');
        const match = content.match(/^\s*GEMINI_API_KEY\s*=\s*([^\r\n#]+)/m);
        if (match && match[1]) {
          const val = sanitizeGeminiKey(match[1]);
          if (val) {
            process.env.GEMINI_API_KEY = val;
            return val;
          }
        }
      } catch {}
    }
  }

  return null;
}

/**
 * Tests a Gemini API key with multiple candidate models to guarantee compatibility.
 */
export async function testGeminiKey(key: string): Promise<{ success: boolean; message: string; model?: string }> {
  const cleanKey = sanitizeGeminiKey(key);
  if (!cleanKey) {
    return { success: false, message: 'API key is empty.' };
  }

  let lastError = '';

  for (const model of CANDIDATE_MODELS) {
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${cleanKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: 'Respond with exactly: PONG' }] }],
          }),
        }
      );

      if (response.ok) {
        return {
          success: true,
          message: `Connected successfully using model: ${model}`,
          model,
        };
      }

      const errData: any = await response.json().catch(() => null);
      const errMsg = errData?.error?.message || `HTTP ${response.status} (${response.statusText})`;
      lastError = errMsg;

      // If invalid API key, no need to retry other models
      if (response.status === 400 && /API_KEY_INVALID|API key not valid/i.test(errMsg)) {
        return {
          success: false,
          message: 'API key is invalid. Keys from Google AI Studio usually start with "AIzaSy...". Please verify you copied the entire key.',
        };
      }

      if (response.status === 429) {
        return {
          success: false,
          message: 'Quota exceeded for this API key. Check your limits at https://aistudio.google.com',
        };
      }
    } catch (err: unknown) {
      lastError = err instanceof Error ? err.message : String(err);
    }
  }

  return { success: false, message: lastError || 'Failed to reach Gemini API endpoint.' };
}

/**
 * Saves a valid Gemini API key to local .env file.
 */
export function saveGeminiKey(key: string, rootDir: string): boolean {
  try {
    const cleanKey = sanitizeGeminiKey(key);
    process.env.GEMINI_API_KEY = cleanKey;
    const envPath = path.join(rootDir, '.env');
    let content = '';
    if (fs.existsSync(envPath)) {
      content = fs.readFileSync(envPath, 'utf8');
    }

    if (/^\s*GEMINI_API_KEY\s*=/m.test(content)) {
      content = content.replace(/^\s*GEMINI_API_KEY\s*=.*$/m, `GEMINI_API_KEY=${cleanKey}`);
    } else {
      content += (content.endsWith('\n') || !content ? '' : '\n') + `GEMINI_API_KEY=${cleanKey}\n`;
    }

    fs.writeFileSync(envPath, content, 'utf8');
    return true;
  } catch {
    return false;
  }
}

/**
 * Queries Gemini with multi-model fallback or falls back to built-in knowledge base.
 */
export async function askGemini(question: string, rootDir?: string): Promise<GeminiResponse> {
  const apiKey = getActiveGeminiKey(rootDir);

  if (apiKey) {
    let lastError = '';

    for (const model of CANDIDATE_MODELS) {
      try {
        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              systemInstruction: {
                parts: [
                  {
                    text: `You are DOM_X Assistant, the official AI specialist for DOM_X & DOMPulse — the Zero-Cost Browser Perception & Change-Intelligence MCP Server for Claude Desktop, Cursor, and AI browser agents.
Help the user understand how DOM_X works, how its commands work (see, scan, find, click, type, hud, privacy, benchmark), how it replaces expensive 4K screenshots with 5ms DOM Set-of-Marks at $0.00 cost, and how to control Chrome.
Keep your responses concise, well-structured with clear bullet points, and actionable with exact commands.`,
                  },
                ],
              },
              contents: [{ parts: [{ text: question }] }],
            }),
          }
        );

        if (response.ok) {
          const data: any = await response.json();
          const reply = data.candidates?.[0]?.content?.parts?.[0]?.text;
          if (reply) {
            return {
              answer: reply.trim(),
              source: 'gemini',
              model,
            };
          }
        } else {
          const errData: any = await response.json().catch(() => null);
          lastError = errData?.error?.message || `HTTP ${response.status}`;
        }
      } catch (err: unknown) {
        lastError = err instanceof Error ? err.message : String(err);
      }
    }

    const localFallback = queryBuiltInKnowledge(question);
    return {
      answer: `${localFallback}\n\n⚠️  [Gemini API Note]: ${lastError}`,
      source: 'local',
      error: lastError,
    };
  }

  // Built-in intelligent local knowledge engine
  return {
    answer: queryBuiltInKnowledge(question),
    source: 'local',
  };
}

export function queryBuiltInKnowledge(q: string): string {
  const query = q.toLowerCase();

  if (query.includes('token') || query.includes('reduce') || query.includes('saving') || query.includes('cost')) {
    return `💡 How DOM_X Reduces LLM Tokens by 94%+ :
  1. No Screenshots: Replaces 4K screenshot polling (1,600+ vision tokens / step) with structured JSON events.
  2. Noise Stripping: Prunes 96% of HTML clutter (SVG paths, CSS stylesheets, inline scripts, invisible divs).
  3. Actionable Tags: Assigns short, deterministic IDs (@e1, @e2, @e3) to interactive elements only (~22 tokens per element).
  4. 15ms MutationObserver: Alerts agents ONLY when something changes, avoiding full-page re-dumps.
  👉 Run 'benchmark' right now in this terminal to see the live comparison table!`;
  }

  if (query.includes('privacy') || query.includes('hide') || query.includes('sensitive') || query.includes('password') || query.includes('blur')) {
    return `🔒 On-Screen Frosted Privacy Shield:
  • Physical Blur: Automatically covers all passwords, credit cards, CVVs, and secret tokens with a frosted blur on screen.
  • Zero Plaintext to LLMs: Credentials are never sent to AI models — they are masked as ••••••••.
  • How to toggle:
    - In terminal: Type 'privacy'
    - In Chrome Extension: Click the '🔒 Privacy Shield' button in the popup.`;
  }

  if (query.includes('feature') || query.includes('what can it do') || query.includes('tools')) {
    return `⚡ Core Features of DOM_X:
  • 16 MCP Tools: Perception (get_page_dom), Interaction (click, type, hover, select), Automation (navigate, eval_script).
  • Zero-Cost DOM-VLM: 'see' and 'find' replace GPT-4o / Claude Vision screenshot bills ($0.00 cost, 5ms latency).
  • 15ms Change Intelligence: Catches modals, toasts, form validation, and URL changes with zero screenshot delay.
  • In-Browser Visual HUD: Live color-coded bounding boxes with @e tags drawn directly in Chrome (toggle with 'hud').
  • Frosted Privacy Shield: Real on-screen blur covering sensitive fields (toggle with 'privacy').
  • 1-Command Setup: Auto-configures Claude Desktop ('domx install claude') and Cursor ('domx install cursor').`;
  }

  if (query.includes('claude') || query.includes('cursor') || query.includes('connect') || query.includes('install')) {
    return `🔌 Connecting DOM_X to AI Clients:
  • Claude Desktop: Run 'install claude' (or 'domx install claude' in bash). Restart Claude Desktop.
  • Cursor IDE: Run 'install cursor' (or 'domx install cursor' in bash).
  • Launch Chrome: Run 'open https://github.com' to start Chrome with DOM_X active.
  • Then simply ask Claude or Cursor: "Look at the current browser tab and click the login button!"`;
  }

  if (query.includes('how to use') || query.includes('start') || query.includes('guide') || query.includes('begin')) {
    return `🚀 Quickstart in 3 Steps:
  1. Open Chrome with DOM_X: Type 'open https://github.com'
  2. Inspect the webpage: Type 'see' to see the visual layout and targets
  3. Interact directly:
     • Find an element: 'find "sign in"'
     • Click an element: 'click @e1'
     • Type text: 'type @e2 mypassword'
     • Visual HUD: Type 'hud' to see neon bounding boxes in Chrome!
     • Privacy Shield: Type 'privacy' to blur and hide sensitive inputs!
  💡 To connect live Gemini AI: Type 'connect <key>' in this terminal.`;
  }

  if (query.includes('hud') || query.includes('box') || query.includes('visual')) {
    return `👁️ In-Browser Visual HUD:
  • What it is: Highlights interactive elements on real web pages with glowing boxes and badge IDs (@e1, @e2).
  • Color Badges:
    - 🟢 Emerald: Buttons & actions
    - 🔵 Cyan: Links & navigation
    - 🟠 Amber: Text inputs
    - 🟣 Purple: Dropdowns & checkboxes
    - 🔴 Red: Sensitive fields (passwords, cards)
  • How to toggle: Type 'hud' here in the terminal, or click the Screen HUD button in Chrome popup.`;
  }

  if (query.includes('benchmark') || query.includes('test') || query.includes('proof')) {
    return `📊 DOM_X Benchmark Engine:
  • Proves 94.8% token reduction and 250x speedup compared to Vision Screenshots and Raw DOM dumps.
  • Run 'benchmark' to see the exact numbers across GitHub, E-Commerce, and SaaS Dashboards!`;
  }

  return `🤖 DOM_X Local Assistant:
  I can explain all features of DOM_X! Try asking:
  • "ask how does DOM_X reduce tokens?"
  • "ask how do I connect to Claude or Cursor?"
  • "ask how does the privacy shield work?"
  • "benchmark" to run live token reduction tests!
  💡 Want to chat with live Gemini? Type 'connect <your_key>' to link your free Google AI Studio key!`;
}
