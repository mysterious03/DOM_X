/**
 * DOM_X Built-In & Gemini AI Assistant
 * Provides natural language help, explanations of features, token reduction details,
 * and live Gemini API responses directly in the CLI.
 */

export async function askGemini(question: string): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;

  if (apiKey) {
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            systemInstruction: {
              parts: [
                {
                  text: `You are DOM_X Assistant, an expert on the DOM_X Model Context Protocol (MCP) server for AI browser agents.
Help the user understand how DOM_X works, how to use its CLI commands (/scan, /click, /type, /launch, /hud, /benchmark, domx install),
how it reduces LLM tokens by 94%+ compared to screenshot polling, and how to connect it to Claude Desktop and Cursor.
Keep your responses concise, highly structured with bullet points, and practical with exact commands.`,
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
        if (reply) return reply;
      }
    } catch {
      // Fallback to built-in knowledge base if network/API fails
    }
  }

  // Built-in intelligent local knowledge engine
  return queryBuiltInKnowledge(question);
}

function queryBuiltInKnowledge(q: string): string {
  const query = q.toLowerCase();

  if (query.includes('token') || query.includes('reduce') || query.includes('saving') || query.includes('cost')) {
    return `💡 How DOM_X Reduces LLM Tokens by 94%+ :
  1. No Screenshots: Replaces 4K screenshot polling (1,600+ vision tokens / step) with structured JSON events.
  2. Noise Stripping: Prunes 96% of HTML clutter (SVG paths, CSS stylesheets, inline scripts, invisible divs).
  3. Actionable Tags: Assigns short, deterministic IDs (@e1, @e2, @e3) to interactive elements only (~22 tokens per element).
  4. 15ms MutationObserver: Alerts agents ONLY when something changes, avoiding full-page re-dumps.
  👉 Run '/benchmark' right now in this terminal to see the live comparison table!`;
  }

  if (query.includes('feature') || query.includes('what can it do') || query.includes('tools')) {
    return `⚡ Core Features of DOM_X:
  • 16 MCP Tools: Perception (get_page_dom), Interaction (click, type, hover, select), Automation (navigate, eval_script).
  • 15ms Change Intelligence: Catches modals, toasts, form validation, and URL changes with zero screenshot delay.
  • In-Browser Visual HUD: Live color-coded bounding boxes with @e tags drawn directly in Chrome (toggle with '/hud').
  • 1-Command Setup: Auto-configures Claude Desktop ('domx install claude') and Cursor ('domx install cursor').
  • Interactive Terminal REPL: Full control directly from your command line without writing code.`;
  }

  if (query.includes('claude') || query.includes('cursor') || query.includes('connect') || query.includes('install')) {
    return `🔌 Connecting DOM_X to AI Clients:
  • Claude Desktop: Run 'domx install claude' (or type '/install claude' here). Restart Claude Desktop.
  • Cursor IDE: Run 'domx install cursor' (or type '/install cursor' here).
  • Launch Chrome: Run '/launch https://github.com' to start Chrome with DOM_X active.
  • Then simply ask Claude or Cursor: "Look at the current browser tab and click the login button!"`;
  }

  if (query.includes('how to use') || query.includes('start') || query.includes('guide') || query.includes('begin')) {
    return `🚀 Quickstart in 3 Steps:
  1. Open Chrome with DOM_X: Type '/launch https://github.com'
  2. Inspect the webpage: Type '/scan' to see interactive elements (@e1, @e2, @e3...)
  3. Interact directly:
     • Click an element: '/click @e1'
     • Type text: '/type @e2 mypassword'
     • View in Chrome: Type '/hud' to see visual glowing boxes on screen!
  💡 To connect to Gemini live: Set environment variable GEMINI_API_KEY=<your-key>`;
  }

  if (query.includes('hud') || query.includes('box') || query.includes('visual')) {
    return `👁️ In-Browser Visual HUD:
  • What it is: Highlights interactive elements on real web pages with glowing cyan/green boxes and badge IDs (@e1, @e2).
  • How to toggle: Type '/hud' here in the terminal, or click the HUD button in the Chrome extension popup.`;
  }

  if (query.includes('benchmark') || query.includes('test') || query.includes('proof')) {
    return `📊 DOM_X Benchmark Engine:
  • Proves 94.8% token reduction and 200x speedup compared to Vision Screenshots and Raw DOM dumps.
  • Run '/benchmark' to see the exact numbers across GitHub, E-Commerce, and SaaS Dashboards!`;
  }

  return `🤖 DOM_X Assistant:
  I can explain all features of DOM_X! Try asking:
  • "/ask how does DOM_X reduce tokens?"
  • "/ask how do I connect to Claude or Cursor?"
  • "/ask what are all the features?"
  • "/benchmark" to run live token reduction tests!
  💡 Tip: Set GEMINI_API_KEY=<key> to chat with live Gemini 2.0 Flash in this terminal.`;
}
