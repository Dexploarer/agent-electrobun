# Architecture: OOPIF-Aware CDP Control

How agent-electrobun works with Electrobun's multi-process architecture, and why agent-browser can't.

## Electrobun OOPIF Architecture

```
Bun process (src/bun/index.ts)
├── BrowserWindow (shell)
│   └── Shell webview: mainview/index.html
│       ├── Tab bar UI (React)
│       ├── shellRpc (Electroview RPC)
│       └── window.__quiverAutomation (dev only)
│           ├── listTabs()
│           ├── activate(tabId)
│           └── newTabAndActivate()
│
└── BrowserView OOPIFs (one per tab)
    └── Tab webview: tabview/index.html?tabId=tab-N
        ├── Full app content (React + TanStack Router)
        ├── tabRpc (Electroview RPC → Bun)
        └── Separate OS process
```

Each tab is a **separate OS process** (Out-of-Process IFrame). The shell manages the tab bar and creates `<electrobun-webview>` elements imperatively via the `WebviewHost` class.

## Why agent-browser Can't Work

agent-browser uses Playwright's `connectOverCDP()` which:
1. Connects to the CDP endpoint
2. Gets all existing contexts/pages
3. Uses `page.goto()` for navigation

**The problem:** When agent-browser runs `open` or `goto`, it navigates the shell page away from `mainview/index.html`. This destroys:
- The Electroview RPC registration
- The tab bar React app
- The `WebviewHost` that manages OOPIF elements
- All existing tab processes lose their parent

After navigation, tab commands like `open_repo` fail with "no handler" because the shell's RPC bridge is gone.

## How agent-electrobun Works Instead

agent-electrobun uses **raw CDP WebSocket connections** to attach to existing targets without navigating:

1. **Target discovery**: `GET http://localhost:9222/json/list` returns all CDP targets
2. **Target identification**: Shell has `/mainview/` in URL, tabs have `/tabview/`
3. **Direct WebSocket**: Connects to `webSocketDebuggerUrl` of the specific target
4. **No navigation**: Only uses read/interact CDP methods, never `Page.navigate`

### CDP Target List Example

```json
[
  {
    "id": "ABC123",
    "title": "Quiver",
    "type": "page",
    "url": "http://localhost:5173/mainview/index.html",
    "webSocketDebuggerUrl": "ws://localhost:9222/devtools/page/ABC123"
  },
  {
    "id": "DEF456",
    "title": "Quiver Tab tab-1",
    "type": "page",
    "url": "http://localhost:5173/tabview/index.html?tabId=tab-1",
    "webSocketDebuggerUrl": "ws://localhost:9222/devtools/page/DEF456"
  }
]
```

### CDPClient Connection Flow

1. Fetch `/json/list` → find target by URL pattern
2. Open WebSocket to `webSocketDebuggerUrl`
3. Enable domains: `Runtime.enable`, `Page.enable`, `DOM.enable`, `Accessibility.enable`
4. `DOM.getDocument({ depth: -1 })` — **critical**: populates the DOM tree so `DOM.describeNode` returns real `nodeId`s (without this, all nodeIds are 0)
5. Execute commands
6. Close WebSocket

### Key CDP Methods Used

| Method | Purpose |
|--------|---------|
| `Runtime.evaluate` | JavaScript evaluation |
| `Runtime.callFunctionOn` | Execute JS on a specific DOM node |
| `Accessibility.getFullAXTree` | Accessibility snapshot for ref assignment |
| `DOM.getDocument` | Populate DOM tree (must call before describeNode) |
| `DOM.describeNode` | Resolve `backendDOMNodeId` → `nodeId` |
| `DOM.scrollIntoViewIfNeeded` | Ensure element is visible before interaction |
| `DOM.getBoxModel` | Get element coordinates for click targeting |
| `DOM.focus` | Focus an element for typing |
| `DOM.resolveNode` | Get JS object reference for `callFunctionOn` |
| `Input.dispatchMouseEvent` | Click, hover, drag, wheel at coordinates |
| `Input.dispatchKeyEvent` | Key press events (keyDown, char, keyUp) |
| `Input.insertText` | Type text at current focus |
| `Page.captureScreenshot` | Take screenshot (viewport or full page) |

## The backendDOMNodeId → nodeId Problem

The accessibility tree gives us `backendDOMNodeId` for each node. But CDP interaction methods need `nodeId`, which is only valid after the DOM tree is populated.

**The fix:** Call `DOM.getDocument({ depth: -1 })` during client connection. This tells CDP to walk the full DOM tree and assign real `nodeId`s. After that, `DOM.describeNode({ backendNodeId })` returns a usable `nodeId`.

Without `DOM.getDocument`:
```json
{ "node": { "nodeId": 0, "backendNodeId": 7 } }  // nodeId 0 = unusable
```

With `DOM.getDocument`:
```json
{ "node": { "nodeId": 46, "backendNodeId": 7 } }  // nodeId 46 = works!
```

## React-Compatible Fill

React uses synthetic events and the native `value` setter is bypassed by `Input.insertText`. To properly fill React-controlled inputs:

1. `DOM.focus` the element
2. Use `Runtime.callFunctionOn` to call the native setter:
   ```js
   Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, text)
   ```
3. Dispatch `input` + `change` events with `{ bubbles: true }`

This triggers React's `onChange` handler correctly.

## Key Press Implementation

The `press` command sends three CDP events for each key:

1. `Input.dispatchKeyEvent({ type: "keyDown", key, code, modifiers })`
2. `Input.dispatchKeyEvent({ type: "char", text })` (if key produces text)
3. `Input.dispatchKeyEvent({ type: "keyUp", key, code, modifiers })`

Modifier flags are bitmask: Alt=1, Ctrl=2, Meta=4, Shift=8. The `keyboard type` command does this per-character for each character in the text.
