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

## One-Command CLI Installation

### Auto-Install into AI Clients
```bash
# Auto-detects and adds DOM_X to Claude Desktop:
npx dom-x install claude

# Auto-detects and adds DOM_X to Cursor:
npx dom-x install cursor

# Configure both:
npx dom-x install all
```

### Auto-Launch Chrome with DOM_X
```bash
npx dom-x launch https://github.com
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
