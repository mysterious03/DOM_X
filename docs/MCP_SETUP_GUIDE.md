# DOM_X MCP Server Guide

DOM_X provides an official **Model Context Protocol (MCP)** server. This allows AI assistants (Claude Desktop, Cursor, Antigravity, custom AI agents) to connect directly to your live Chrome browser tabs and perceive web pages with structured DOM events, screen bounding boxes, and action IDs without relying on expensive screenshot polling.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                 Chrome Browser (Real Websites)              │
│  - Active Tab (e.g. Wikipedia, GitHub, Amazon, Docs)        │
│  - DOM_X Extension / Content Script                         │
│  - Optional Visual HUD (overlays @e1, @e2 bounding boxes)  │
└──────────────────────────────▲──────────────────────────────┘
                               │ WebSocket (ws://127.0.0.1:8765)
┌──────────────────────────────▼──────────────────────────────┐
│                    DOM_X MCP Server                         │
│  - Runs via stdio: `node dist/mcp/index.js` or `npx dom-x`  │
│  - Bridges MCP JSON-RPC protocol with browser WebSocket    │
│  - One-command CLI installer and Chrome launcher            │
└──────────────────────────────▲──────────────────────────────┘
                               │ MCP Stdio Transport
┌──────────────────────────────▼──────────────────────────────┐
│           AI Assistant (Claude, Cursor, Antigravity)        │
│  - Invokes: get_page_dom, click_element, type_into_element   │
│  - Observes 15ms change-intelligence events                 │
└─────────────────────────────────────────────────────────────┘
```

---

### 1. How to Add the Chrome Extension (Plugin)

The DOM_X Chrome Extension is the bridge that extracts 15ms DOM mutations and renders the visual HUD on web pages.

#### Option A: 1-Command Auto-Launch (Recommended)
```bash
domx launch https://github.com
```
*This automatically starts Chrome with an isolated session and the DOM_X extension pre-loaded.*

#### Option B: Manual Installation into your Regular Chrome Browser
1. Open Google Chrome.
2. In the URL bar, go to: `chrome://extensions`
3. In the top-right corner, switch the **Developer mode** toggle to **ON**.
4. In the top-left corner, click the **Load unpacked** button.
5. In the file picker, select the `dist/` directory located inside your DOM_X folder:
   ```text
   <PATH_TO_DOM_X>/dist
   ```
6. Open any real webpage (e.g. `https://github.com` or `https://google.com`).
7. You will see the **DOM_X** icon in your Chrome toolbar, and it will immediately connect to your local MCP server on `ws://127.0.0.1:8765`!

> [!WARNING]
> **Why do I see "No browser tab connected"?**
> Chrome security policies strictly block extensions from running on internal browser pages:
> - ❌ `chrome://extensions`, `chrome://newtab`, or blank tabs
> - ❌ Chrome Web Store
> - ✅ Real websites: `https://github.com`, `https://google.com`, `http://localhost:3000`
> 
> Simply navigate your tab to any real website and DOM_X connects instantly!

---

### 2. Auto-Install into AI Clients
```bash
# Auto-detects and adds DOM_X to Claude Desktop:
domx install claude

# Auto-detects and adds DOM_X to Cursor:
domx install cursor

# Configure both:
domx install all
```

---

### 3. Connecting via API in Code (Python & TypeScript)

If you are building custom AI agents with LangChain, LlamaIndex, or raw LLM APIs, you can connect directly to DOM_X:

#### In Python (using official `mcp` SDK)
```python
import asyncio
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

async def main():
    # 1. Configure DOM_X MCP Server
    server_params = StdioServerParameters(
        command="node",
        args=["<PATH_TO_DOM_X>/dist/mcp/index.js"]
    )

    async with stdio_client(server_params) as (read, write):
        async with ClientSession(read, write) as session:
            await session.initialize()

            # 2. Inspect active browser tab in 12ms!
            dom = await session.call_tool("get_page_dom", arguments={"preset": "interactive"})
            print(dom.content[0].text)

            # 3. Click any element
            await session.call_tool("click_element", arguments={"target": "@e1"})

asyncio.run(main())
```

#### In TypeScript / Node.js (using `@modelcontextprotocol/sdk`)
```typescript
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const transport = new StdioClientTransport({
  command: "node",
  args: ["<PATH_TO_DOM_X>/dist/mcp/index.js"],
});

const client = new Client({ name: "my-browser-agent", version: "1.0.0" }, { capabilities: {} });
await client.connect(transport);

// Call DOM_X Perception
const result = await client.callTool({
  name: "get_page_dom",
  arguments: { preset: "interactive" },
});
console.log(result.content[0].text);
```

### Manual Configuration

#### Claude Desktop (`claude_desktop_config.json`)
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`
- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "dom-x": {
      "command": "node",
      "args": [
        "<ABSOLUTE_PATH_TO_DOM_X>/dist/mcp/index.js"
      ]
    }
  }
}
```

#### Antigravity / Cursor (`mcp.json` or `.cursor/mcp.json`)
```json
{
  "mcpServers": {
    "dom-x": {
      "command": "node",
      "args": [
        "<ABSOLUTE_PATH_TO_DOM_X>/dist/mcp/index.js"
      ]
    }
  }
}
```

---

## Available MCP Tools (16 Tools)

| Tool | Description |
|---|---|
| `get_page_dom` | Reads structured, token-efficient interactive elements (`@e1`, `@e2`...), tags, roles, labels, and bounding boxes. Supports filtering by preset (`forms`, `headings`, `interactive`), CSS query, and text search. |
| `get_dom_mutations` | Fetches recent 15ms meaningful DOM change events (alerts, modals, cart updates, navigation). |
| `wait_for_dom_change` | Asynchronously waits for a DOM mutation to occur after an action. |
| `click_element` | Clicks an element by its ID (e.g. `@e1`) or CSS selector. |
| `hover_element` | Hovers mouse over an element to reveal tooltips or dropdown menus. |
| `type_into_element` | Types text into an input field or textarea by its ID (e.g. `@e3`). |
| `select_option` | Selects an option in a `<select>` dropdown by value or visible text. |
| `press_key` | Dispatches keyboard key events (e.g. "Escape", "Enter", "Tab", "ArrowDown"). |
| `inspect_element` | Deep inspection of computed styles, attributes, DOM hierarchy breadcrumbs, and state. |
| `scroll_page` | Scrolls the page or scrolls an element into view. |
| `highlight_element` | Draws a temporary visual highlight ring around an element on screen. |
| `navigate_to` | Navigates the active browser tab to any URL. |
| `eval_script` | Safely evaluates arbitrary JavaScript expression in the active tab context. |
| `get_dom_diff` | Computes a net change diff since the previous DOM scan. |
| `toggle_visual_hud` | Toggles visual bounding boxes and `@eX` badges on the live webpage in Chrome. |
| `get_browser_status` | Returns connection status, active tab URL, and page title. |
