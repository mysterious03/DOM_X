<div align="center">

# ⚡ DOM_X
### *Real-Time Browser Perception & Change-Intelligence MCP Server for AI Agents*

[![MCP Ready](https://img.shields.io/badge/MCP-Model%20Context%20Protocol-38bdf8?style=for-the-badge&logo=anthropic&logoColor=white)](https://modelcontextprotocol.io)
[![Tests](https://img.shields.io/badge/Vitest-47%20Passed%20(100%25)-34d399?style=for-the-badge&logo=vitest&logoColor=white)](https://github.com/mysterious03/DOM_X)
[![Extension](https://img.shields.io/badge/Chrome%20Extension-Manifest%20V3-fbbf24?style=for-the-badge&logo=googlechrome&logoColor=white)](https://github.com/mysterious03/DOM_X)
[![One Command CLI](https://img.shields.io/badge/CLI-One--Command%20Install-a855f7?style=for-the-badge)](https://github.com/mysterious03/DOM_X)
[![Zero Cloud APIs](https://img.shields.io/badge/Cloud%20APIs-Zero%20(100%25%20Local)-f43f5e?style=for-the-badge)](https://github.com/mysterious03/DOM_X)

<br/>

<p align="center">
  <b>DOM_X gives AI assistants (Claude Desktop, Cursor, Antigravity, custom agents) real-time perception and precision action control over live browser tabs—replacing expensive screenshot polling with 15ms structured DOM events and bounding box action tags.</b>
</p>

</div>

---

## 🎯 What is DOM_X?

Traditional browser AI agents rely on **continuous full-screen screenshots** fed into Vision-Language Models (VLMs). This causes 3-4 second delays, high API costs, and misses semantic state attributes (like `aria-expanded`, form errors, or off-screen dialogs).

**DOM_X connects directly to your live Chrome browser via the Model Context Protocol (MCP)**:
1. **Reads Clean DOM State:** Extracts interactive buttons, links, inputs, and forms with bounding boxes and action IDs (`@e1`, `@e2`...).
2. **15ms Change-Intelligence:** Informs the AI immediately when a toast appears, modal opens, or button updates, without screenshot polling.
3. **Full Precision Action Suite:** The AI can click, hover, type, select options, send keypresses, scroll, and evaluate scripts directly through MCP tool calls.
4. **Visual HUD:** Optionally renders live bounding box tags directly in your Chrome window so you can watch what the AI sees in real time.
5. **One-Command CLI:** Installs into Claude Desktop or Cursor and launches Chrome with one command.

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                 Chrome Browser (Real Websites)              │
│  - Active Tab (Any site: GitHub, Amazon, Wikipedia, etc.)   │
│  - DOM_X Extension: Extracts elements & 15ms DOM events     │
│  - Visual HUD: Renders translucent boxes & @eX badges       │
└──────────────────────────────▲──────────────────────────────┘
                               │ WebSocket (ws://127.0.0.1:8765)
┌──────────────────────────────▼──────────────────────────────┐
│                    DOM_X MCP Server                         │
│  - Implements Model Context Protocol via Stdio transport    │
│  - Translates MCP tool calls into live browser actions      │
│  - CLI Installer, Chrome Auto-Launcher & Diagnostics        │
└──────────────────────────────▲──────────────────────────────┘
                               │ MCP Protocol
┌──────────────────────────────▼──────────────────────────────┐
│           AI Assistant (Claude, Cursor, Antigravity)        │
│  - Invokes: get_page_dom, click_element, type_into_element   │
│  - Waits for DOM mutations (wait_for_dom_change)            │
└─────────────────────────────────────────────────────────────┘
```

---

## 🚀 One-Command CLI Setup

### 1. Build DOM_X
```bash
git clone https://github.com/mysterious03/DOM_X.git
cd DOM_X
npm install
npm run build
```

### 2. Auto-Install into Your AI Client
You can automatically inject DOM_X into Claude Desktop or Cursor with a single command:

```bash
# Auto-configure Claude Desktop
npx dom-x install claude

# Auto-configure Cursor
npx dom-x install cursor

# Auto-configure both
npx dom-x install all
```

*(Alternatively, add manually to `claude_desktop_config.json` or `mcp_config.json`:)*
```json
{
  "mcpServers": {
    "dom-x": {
      "command": "node",
      "args": ["<PATH_TO_DOM_X>/dist/mcp/index.js"]
    }
  }
}
```

### 3. Launch Chrome with DOM_X Pre-Loaded
No need to manually load extensions if you don't want to:
```bash
# Auto-launches Chrome with DOM_X extension pre-loaded
npx dom-x launch https://github.com
```

### 4. Check System Diagnostics
```bash
npx dom-x status
```

---

## 🛠️ MCP Tools Reference (16 Powerful Tools)

| Tool | Parameters | Description |
|---|---|---|
| `get_page_dom` | `visibleOnly?: boolean`, `preset?: "interactive" \| "all" \| "forms" \| "headings"`, `query?: string`, `search?: string`, `format?: "summary" \| "json"` | Returns token-efficient structured interactive elements (`@e1`, `@e2`...), tags, roles, labels, and bounding boxes. |
| `get_dom_mutations` | `limit?: number`, `clearAfterRead?: boolean` | Fetches recent meaningful DOM events (15ms latency) captured by DOM_X (modals, alerts, form updates). |
| `wait_for_dom_change` | `timeoutMs?: number`, `eventType?: string` | Asynchronously pauses until a DOM change event occurs (e.g. after clicking a submit button). |
| `click_element` | `target: string` | Clicks an element by its action ID (e.g. `@e1`) or CSS selector. |
| `hover_element` | `target: string` | Hovers mouse over an element to reveal tooltips, dropdown menus, or hover effects. |
| `type_into_element` | `target: string`, `text: string`, `clearFirst?: boolean`, `pressEnter?: boolean` | Types text into an input field or textarea by its ID (e.g. `@e2`). |
| `select_option` | `target: string`, `valueOrText: string` | Selects an option in a `<select>` dropdown by value or visible label. |
| `press_key` | `key: string`, `target?: string`, `ctrl?: boolean`, `shift?: boolean`, `alt?: boolean`, `meta?: boolean` | Dispatches keyboard events (e.g. "Enter", "Escape", "Tab", "ArrowDown"). |
| `inspect_element` | `target: string` | Deep element inspection returning computed styles, attributes, parent breadcrumbs, and child count. |
| `scroll_page` | `direction?: "up" \| "down" \| "top" \| "bottom" \| "element"`, `amount?: number`, `target?: string` | Scrolls the page or scrolls an element into view. |
| `highlight_element` | `target: string`, `color?: string` | Flashes a visual highlight ring around an element on screen. |
| `navigate_to` | `url: string` | Navigates the active browser tab to any URL. |
| `eval_script` | `expression: string` | Safely evaluates a JavaScript snippet in the active page and returns the result. |
| `get_dom_diff` | *(none)* | Compares current DOM state with previous scan to list added, removed, or changed elements. |
| `toggle_visual_hud` | `enabled: boolean` | Toggles in-browser visual bounding box tags (`@e1`, `@e2`) on the active tab. |
| `get_browser_status` | *(none)* | Returns connection status, active tab title, and current URL. |

---

## 👁️ In-Browser Visual HUD

DOM_X includes a visual perception overlay built into the Chrome extension:
- Click the extension icon in Chrome and click **`👁️ HUD`**.
- All interactive elements are outlined with glowing bounding boxes and tagged with `@e1`, `@e2`, `@e3`...
- When the AI interacts or DOM changes occur, elements flash with real-time visual feedback.

---

## 🧪 Testing

Run the automated test suite:
```bash
npm test
```
All **47 unit and integration tests** across core filtering, classification, and MCP bridge communication pass locally with 100% success rate.

---

## 📄 License

MIT License.
