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
│  - Runs via stdio or `node dist/mcp/index.js`               │
│  - Bridges MCP JSON-RPC protocol with browser WebSocket    │
└──────────────────────────────▲──────────────────────────────┘
                               │ MCP Stdio Transport
┌──────────────────────────────▼──────────────────────────────┐
│           AI Assistant (Claude, Cursor, Antigravity)        │
│  - Invokes: get_page_dom, click_element, type_into_element   │
│  - Observes 15ms change-intelligence events                 │
└─────────────────────────────────────────────────────────────┘
```

---

## Quick Start

### 1. Build the Extension & MCP Server
```bash
npm run build
```
This generates:
- `dist/` (Unpacked Chrome Extension)
- `dist/mcp/index.js` (Compiled MCP Server)

### 2. Load the Extension into Google Chrome
1. Open Chrome and go to `chrome://extensions/`.
2. Enable **Developer mode** (top-right toggle).
3. Click **Load unpacked** and select the [`dist/`](../dist) folder.

### 3. Add to your AI Client Config

#### Claude Desktop (`claude_desktop_config.json`)
On Windows: `%APPDATA%\Claude\claude_desktop_config.json`
On macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "dom-x": {
      "command": "node",
      "args": [
        "c:/Users/ASUS/OneDrive/Desktop/DOM_PULSE/dist/mcp/index.js"
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
        "c:/Users/ASUS/OneDrive/Desktop/DOM_PULSE/dist/mcp/index.js"
      ]
    }
  }
}
```

---

## Available MCP Tools

| Tool | Description |
|---|---|
| `get_page_dom` | Reads structured, token-efficient interactive elements (`@e1`, `@e2`...), tags, roles, labels, and bounding boxes. |
| `get_dom_mutations` | Fetches recent 15ms meaningful DOM change events (alerts, modals, cart updates, navigation). |
| `wait_for_dom_change` | Asynchronously waits for a DOM mutation to occur after an action. |
| `click_element` | Clicks an element by its ID (e.g. `@e1`) or CSS selector. |
| `type_into_element` | Types text into an input field or textarea by its ID (e.g. `@e3`). |
| `scroll_page` | Scrolls the page or scrolls an element into view. |
| `highlight_element` | Draws a temporary visual highlight ring around an element on screen. |
| `toggle_visual_hud` | Toggles visual bounding boxes and `@eX` badges on the live webpage in Chrome. |
| `get_browser_status` | Returns connection status, active tab URL, and page title. |
