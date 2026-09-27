<div align="center">

# ⚡ DOM_X
### *Real-Time Browser Perception & Change-Intelligence MCP Server for AI Agents*

[![MCP Ready](https://img.shields.io/badge/MCP-Model%20Context%20Protocol-38bdf8?style=for-the-badge&logo=anthropic&logoColor=white)](https://modelcontextprotocol.io)
[![Tests](https://img.shields.io/badge/Vitest-37%20Passed%20(100%25)-34d399?style=for-the-badge&logo=vitest&logoColor=white)](https://github.com/mysterious03/DOM_X)
[![Extension](https://img.shields.io/badge/Chrome%20Extension-Manifest%20V3-fbbf24?style=for-the-badge&logo=googlechrome&logoColor=white)](https://github.com/mysterious03/DOM_X)
[![Zero Cloud APIs](https://img.shields.io/badge/Cloud%20APIs-Zero%20(100%25%20Local)-f43f5e?style=for-the-badge)](https://github.com/mysterious03/DOM_X)

<br/>

<p align="center">
  <b>DOM_X gives AI models (Claude, Cursor, Antigravity) instant perception and action control over real browser tabs—replacing expensive screenshot polling with 15ms structured DOM events and bounding box action tags.</b>
</p>

</div>

---

## 🎯 What is DOM_X?

Traditional browser AI agents rely on **continuous full-screen screenshots** fed into Vision-Language Models (VLMs). This causes 3-4 second delays, high API costs, and misses semantic state attributes (like `aria-expanded`, form errors, or off-screen dialogs).

**DOM_X connects directly to your live Chrome browser via the Model Context Protocol (MCP)**:
1. **Reads Clean DOM State:** Extracts interactive buttons, links, inputs, and forms with bounding boxes and action IDs (`@e1`, `@e2`...).
2. **15ms Change-Intelligence:** Informs the AI immediately when a toast appears, modal opens, or button updates, without screenshot polling.
3. **Direct Action Execution:** The AI can click, type, scroll, and highlight elements directly through MCP tool calls.
4. **Visual HUD:** Optionally renders live bounding box tags directly in your Chrome window so you can watch what the AI sees in real time.

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
└──────────────────────────────▲──────────────────────────────┘
                               │ MCP Protocol
┌──────────────────────────────▼──────────────────────────────┐
│           AI Assistant (Claude, Cursor, Antigravity)        │
│  - Invokes: get_page_dom, click_element, type_into_element   │
│  - Waits for DOM mutations (wait_for_dom_change)            │
└─────────────────────────────────────────────────────────────┘
```

---

## 🚀 Quick Start

### 1. Install & Build
```bash
git clone https://github.com/mysterious03/DOM_X.git
cd DOM_X
npm install
npm run build
```

This compiles:
- `dist/` (Unpacked Chrome Extension)
- `dist/mcp/index.js` (Compiled MCP Server)

### 2. Load the Extension into Google Chrome
1. Navigate to `chrome://extensions/` in Google Chrome.
2. Toggle on **Developer mode** in the upper right.
3. Click **Load unpacked** and select the [`dist/`](./dist) directory.

### 3. Connect to your AI Assistant

#### Claude Desktop (`claude_desktop_config.json`)
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`
- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "dom-x": {
      "command": "node",
      "args": [
        "<PATH_TO_DOM_X>/dist/mcp/index.js"
      ]
    }
  }
}
```

#### Antigravity / Cursor (`mcp_config.json`)
```json
{
  "mcpServers": {
    "dom-x": {
      "command": "node",
      "args": [
        "<PATH_TO_DOM_X>/dist/mcp/index.js"
      ]
    }
  }
}
```

---

## 🛠️ MCP Tools Reference

| Tool | Parameters | Description |
|---|---|---|
| `get_page_dom` | `visibleOnly?: boolean`, `format?: "summary" \| "json"` | Returns token-efficient structured interactive elements (`@e1`, `@e2`...), tags, roles, labels, and bounding boxes. |
| `get_dom_mutations` | `limit?: number`, `clearAfterRead?: boolean` | Fetches recent meaningful DOM events (15ms latency) captured by DOM_X (modals, alerts, form updates). |
| `wait_for_dom_change` | `timeoutMs?: number`, `eventType?: string` | Asynchronously pauses until a DOM change event occurs (e.g. after clicking a submit button). |
| `click_element` | `target: string` | Clicks an element by its action ID (e.g. `@e1`) or CSS selector. |
| `type_into_element` | `target: string`, `text: string`, `clearFirst?: boolean`, `pressEnter?: boolean` | Types text into an input field or textarea by its ID (e.g. `@e2`). |
| `scroll_page` | `direction?: "up" \| "down" \| "top" \| "bottom" \| "element"`, `amount?: number`, `target?: string` | Scrolls the page or scrolls an element into view. |
| `highlight_element` | `target: string`, `color?: string` | Flashes a visual highlight ring around an element on screen. |
| `toggle_visual_hud` | `enabled: boolean` | Toggles in-browser visual bounding box tags (`@e1`, `@e2`) on the active tab. |
| `get_browser_status` | *(none)* | Returns connection status, active tab title, and current URL. |

---

## 👁️ In-Browser Visual HUD

DOM_X includes a visual perception overlay built into the Chrome extension:
- Click the extension icon in Chrome and click **`👁️ HUD`**.
- All interactive elements are outlined with glowing bounding boxes and tagged with `@e1`, `@e2`, `@e3`...
- When the AI interacts or DOM changes occur, elements flash with real-time feedback.

---

## 🧪 Testing

Run the automated test suite:
```bash
npm test
```
All 37 unit and integration tests across core filtering, classification, and MCP bridge communication run locally with 100% pass rate.

---

## 📄 License

MIT License.
