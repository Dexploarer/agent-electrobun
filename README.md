# agent-electrobun

CDP automation CLI for [Electrobun](https://electrobun.dev) desktop apps. Attaches to existing CDP targets via raw WebSocket — never creates new pages or navigates away, preserving the OOPIF lifecycle.

Built with [Bun](https://bun.sh).

## Why Not agent-browser?

[agent-browser](https://github.com/vercel-labs/agent-browser) uses Playwright's `connectOverCDP()`, which navigates pages on attach. In an Electrobun app, this destroys the shell's RPC registration, the tab bar React app, and OOPIF management — the app becomes unusable.

agent-electrobun connects via raw CDP WebSocket and only calls observation/input methods. The app keeps running exactly as it was.

## Installation

```bash
# Clone and use directly
git clone https://github.com/ataraxy-labs/agent-electrobun
cd agent-electrobun
bun src/agent-electrobun.ts help
```

To add as a script in your Electrobun project:

```jsonc
// package.json
{
  "scripts": {
    "ctl": "bun path/to/agent-electrobun/src/agent-electrobun.ts"
  }
}
```

### Prerequisites

The Electrobun app must be running with CDP enabled:

```bash
# The app should launch Chromium with --remote-debugging-port=9222
# For Quiver: QUIVER_DEBUG=1 bun run dev:electrobun
```

## Quick Start

```bash
agent-electrobun list                    # Discover CDP targets
agent-electrobun tabs                    # List tabs with active indicator
agent-electrobun snapshot -i             # Get interactive elements with @refs
agent-electrobun click @e1               # Click by ref
agent-electrobun fill @e2 "text"         # Fill input (React-compatible)
agent-electrobun screenshot              # Take screenshot
```

## Commands

### Core Commands

```bash
agent-electrobun click @e1               # Click element
agent-electrobun dblclick @e1            # Double-click element
agent-electrobun focus @e1               # Focus element
agent-electrobun hover @e1               # Hover over element
agent-electrobun fill @e1 "text"         # Clear + set value (React-compatible)
agent-electrobun type "text"             # Type at current focus
agent-electrobun press Enter             # Press key (Enter, Tab, Escape, Space, arrows, ...)
agent-electrobun press Control+a         # Key combo (Control, Shift, Meta, Alt + key)
agent-electrobun check @e1               # Check checkbox (no-op if already checked)
agent-electrobun uncheck @e1             # Uncheck checkbox (no-op if already unchecked)
agent-electrobun select @e1 "value"      # Select dropdown option by value or text
agent-electrobun scroll down 500         # Scroll page (up/down, default: 400px)
agent-electrobun scrollintoview @e1      # Scroll element into view
```

### Get Info

```bash
agent-electrobun get text @e1            # Get text content
agent-electrobun get html @e1            # Get innerHTML
agent-electrobun get value @e1           # Get input value
agent-electrobun get attr @e1 href       # Get attribute
agent-electrobun get url                 # Get page URL
agent-electrobun get title               # Get page title
agent-electrobun get count ".selector"   # Count matching elements
agent-electrobun get box @e1             # Get bounding box (JSON)
agent-electrobun get styles @e1          # Get computed styles
```

### Check State

```bash
agent-electrobun is visible @e1          # Check if visible
agent-electrobun is enabled @e1          # Check if enabled
agent-electrobun is checked @e1          # Check if checked
```

### Snapshot

```bash
agent-electrobun snapshot                # Full accessibility tree
agent-electrobun snapshot -i             # Interactive elements only with @refs (recommended)
```

### Screenshots

```bash
agent-electrobun screenshot              # Save to /tmp/electrobun-screenshot.png
agent-electrobun screenshot /tmp/my.png  # Save to specific path
agent-electrobun screenshot --annotate   # With numbered ref labels overlaid
agent-electrobun screenshot --full       # Full page (beyond viewport)
```

### Wait

```bash
agent-electrobun wait 2000               # Wait milliseconds
agent-electrobun wait "#my-element"      # Wait for CSS selector (10s timeout)
agent-electrobun wait --text "Sign in"   # Wait for text on page
agent-electrobun wait --fn "window.ready"  # Wait for JS condition to be truthy
```

### Mouse Control

```bash
agent-electrobun mouse move 100 200      # Move mouse to coordinates
agent-electrobun mouse down left         # Press button (left/right/middle)
agent-electrobun mouse up left           # Release button
agent-electrobun mouse wheel 100         # Scroll wheel (deltaY)
```

### Keyboard Control

```bash
agent-electrobun keyboard type "text"        # Type with real key events (char by char)
agent-electrobun keyboard inserttext "text"  # Insert text without key events
```

### JavaScript

```bash
agent-electrobun eval 'document.title'       # Evaluate JS in current target
agent-electrobun shell eval 'document.title' # Evaluate JS in shell webview
```

### Tab Management

```bash
agent-electrobun list                    # List all CDP page targets
agent-electrobun tabs                    # List tabs with active indicator
agent-electrobun new-tab                 # Create a new tab
agent-electrobun open-repo /path/to/repo         # Open repo in active tab
agent-electrobun open-repo /path/to/repo tab-2   # Open repo in specific tab
```

### Debug

```bash
agent-electrobun highlight @e1           # Highlight element with red border (fades in 5s)
```

### Diff

```bash
agent-electrobun diff snapshot           # Compare current vs last snapshot (+ added, - removed)
```

## Target Selection

By default, commands target the **active tab**. Override with `--target`:

```bash
agent-electrobun --target shell snapshot -i     # Target the shell (tab bar UI)
agent-electrobun --target tab-1 snapshot -i     # Target a specific tab
agent-electrobun --target tab-2 screenshot      # Screenshot tab-2
agent-electrobun snapshot -i                    # Default: active tab
```

Commands that always target the shell implicitly: `tabs`, `new-tab`, `shell eval`.

The shell's `window.__quiverAutomation` bridge is used to discover the active tab ID.

## Selectors: The @ref System

Instead of CSS selectors, agent-electrobun uses **refs** — stable references to accessibility tree nodes.

### How it works

1. Run `snapshot -i` to scan the accessibility tree
2. Each interactive element gets a ref: `@e1`, `@e2`, `@e3`, ...
3. Use refs in subsequent commands: `click @e1`, `fill @e2 "text"`
4. Refs are backed by `backendDOMNodeId` from `Accessibility.getFullAXTree`

```
$ agent-electrobun snapshot -i
@e1 button "Open Repository..."
@e2 textbox "~/path/to/repo or GitHub PR URL"
@e3 button "Open" [disabled]

$ agent-electrobun fill @e2 "/path/to/my/repo"
✓ Filled @e2 (textbox "~/path/to/repo or GitHub PR URL") with "/path/to/my/repo"
```

### Ref Lifecycle

Refs are invalidated when the DOM changes. **Always re-snapshot after:**

- Clicking buttons that change the view
- Filling inputs that trigger UI updates
- Navigation or dynamic content loading
- Opening repos or switching tabs

### Per-Target Isolation

Refs are stored per-target in `/tmp/agent-electrobun-refs.json`. Switching `--target` does not invalidate other targets' refs.

```
{
  "version": 1,
  "targets": {
    "shell": { "next": 4, "refs": { "@e1": {...}, ... } },
    "tab:tab-1": { "next": 12, "refs": { "@e1": {...}, ... } }
  }
}
```

## Snapshot Options

The `snapshot -i` command filters the accessibility tree to interactive elements only:

| Option | Description |
|--------|-------------|
| `-i` | Interactive elements only (recommended for AI agents) |
| *(none)* | Full accessibility tree with hierarchy |

### Interactive Roles

Elements with these ARIA roles are captured during `snapshot -i`:

`button` `textbox` `link` `combobox` `checkbox` `radio` `menuitem` `menuitemcheckbox` `menuitemradio` `option` `searchbox` `slider` `spinbutton` `switch` `tab` `treeitem` `listbox`

### Ref Properties

Each ref in the snapshot output includes:

| Property | Description |
|----------|-------------|
| Role | ARIA role (button, textbox, link, ...) |
| Name | Accessible name (label text, button text) |
| `value="..."` | Current input value (if non-empty) |
| `[checked]` | Checkbox/radio is checked |
| `[disabled]` | Element is disabled |

## Annotated Screenshots

Use `--annotate` to overlay numbered labels on interactive elements. Each label `[N]` maps to ref `@eN`.

```bash
agent-electrobun screenshot --annotate
# Output:
# ✓ Annotated screenshot saved to /tmp/electrobun-screenshot.png
#   [1] @e1 button "Open Repository..."
#   [2] @e2 textbox "~/path/to/repo or GitHub PR URL"
#   [3] @e3 button "Open"

agent-electrobun click @e2               # Use ref from annotated screenshot
```

This also refreshes refs — equivalent to running `snapshot -i` before the screenshot.

Use annotated screenshots when:
- You need to verify visual layout
- The page has unlabeled icon buttons
- You need spatial reasoning about element positions

## Multi-Tab Workflows

Each tab is a separate OOPIF with its own CDP target. Refs are isolated per target.

```bash
# List current tabs
agent-electrobun tabs
# tab-1: my-repo (active)

# Create a second tab
agent-electrobun new-tab
# ✓ Created tab: tab-2

# Work on tab-2
agent-electrobun --target tab-2 snapshot -i
agent-electrobun --target tab-2 fill @e2 "/other/repo"
agent-electrobun --target tab-2 click @e3

# tab-1 refs are still valid
agent-electrobun --target tab-1 screenshot /tmp/tab1.png
agent-electrobun --target tab-2 screenshot /tmp/tab2.png
```

## Command Chaining

Commands can be chained with `&&` in a single shell invocation:

```bash
# Fill and click in sequence
agent-electrobun fill @e2 "/path/to/repo" && agent-electrobun click @e3

# Wait then screenshot
agent-electrobun wait 2000 && agent-electrobun screenshot /tmp/result.png

# Create tab, wait, then snapshot
agent-electrobun new-tab && agent-electrobun wait 1000 && agent-electrobun snapshot -i
```

Use `&&` when you don't need intermediate output. Run commands separately when you need to parse snapshot output to discover refs before interacting.

## Optimal AI Workflow

The most efficient pattern for AI agents:

```
1. snapshot -i           → Discover interactive elements and their refs
2. Interact              → click, fill, press, select using refs
3. wait (if needed)      → Let UI settle after actions
4. snapshot -i           → Re-discover after DOM changes
5. diff snapshot         → Verify the action had the intended effect
```

### Tips

- **Start with `snapshot -i`**, not `screenshot`. Snapshots are faster and give you refs directly.
- **Re-snapshot after every action** that changes the DOM. Refs go stale.
- **Use `diff snapshot`** to verify changes instead of re-reading the entire tree.
- **Use `wait`** after clicks that trigger navigation or async loading.
- **Prefer `fill`** over `type` for inputs — it's React-compatible and handles controlled components.
- **Use annotated screenshots** only when you need visual/spatial reasoning.

## Diffing (Verifying Changes)

Compare the current accessibility tree against the last `snapshot -i`:

```bash
# Take baseline
agent-electrobun snapshot -i

# Perform action
agent-electrobun click @e3

# See what changed
agent-electrobun diff snapshot
# - @e3 button "Open" [disabled]
# + @e3 button "Open"
# + @e4 heading "my-repo"
# + @e5 treeitem "src/"
#
# (1 removed, 3 added)
```

Snapshots are saved per-target to `/tmp/agent-electrobun-last-snapshot.json`.

## Architecture

```
Electrobun app
├── Shell webview (mainview)    → Tab bar UI, managed by shellRpc
│   └── window.__quiverAutomation  → Automation bridge (dev only)
└── Tab OOPIFs (tabview)        → One OS process per tab, all app content
    └── Each at tabview/index.html?tabId=tab-N
```

### Why agent-browser Can't Work

| | agent-browser | agent-electrobun |
|---|---|---|
| Connection | Playwright `connectOverCDP()` | Raw WebSocket to `ws://` target |
| On attach | Navigates the page | Attaches without side effects |
| Effect on shell | Destroys RPC registration, tab bar, OOPIF management | None — shell keeps running |
| Page creation | Creates new pages/tabs via CDP | Never creates pages |
| Target model | Single page focus | Multi-target (shell + N tabs) |
| Ref system | CSS selectors + AX refs | `backendDOMNodeId` from AX tree |

### CDP Connection Flow

1. `GET http://localhost:9222/json/list` → discover all CDP page targets
2. Shell identified by `/mainview/` in URL, tabs by `/tabview/`
3. Connect via `WebSocket` to the target's `webSocketDebuggerUrl`
4. Enable domains: `Runtime`, `Page`, `DOM`, `Accessibility`
5. Call `DOM.getDocument({depth:-1})` — required after `DOM.enable` for node resolution
6. Ready to send commands

### Key Implementation Details

- **Fill uses React-compatible native setter**: `Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set` + `input`/`change` events
- **Refs persisted** to `/tmp/agent-electrobun-refs.json`, isolated per target
- **Modifier keys**: Alt=1, Ctrl=2, Meta=4, Shift=8 (CDP bit flags). Combos parsed from `"Control+a"` format
- **Key map**: enter, tab, escape, backspace, delete, space, arrows, home/end, page up/down, F1-F12

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `ELECTROBUN_CDP_PORT` | `9222` | CDP remote debugging port |
| `QUIVER_CDP_PORT` | `9222` | Alias (fallback if `ELECTROBUN_CDP_PORT` not set) |

File paths:

| Path | Description |
|------|-------------|
| `/tmp/agent-electrobun-refs.json` | Persisted refs per target |
| `/tmp/agent-electrobun-last-snapshot.json` | Last snapshot per target (for `diff`) |
| `/tmp/electrobun-screenshot.png` | Default screenshot output |

## Usage with AI Agents

### Just ask the agent

```
Use agent-electrobun to test the app. Run `bun src/agent-electrobun.ts help` to see available commands.
```

### AGENTS.md / CLAUDE.md

For more consistent results, add to your project instructions:

```markdown
## App Automation

Use `agent-electrobun` for Electrobun app automation.

Core workflow:
1. `agent-electrobun snapshot -i` — Get interactive elements with refs (@e1, @e2)
2. `agent-electrobun click @e1` / `fill @e2 "text"` — Interact using refs
3. Re-snapshot after any DOM change
4. `agent-electrobun diff snapshot` — Verify changes
```

### Agent Skill

An agent skill is available at `skills/agent-electrobun/` for integration with AI agent frameworks that support skills. The skill provides the full command reference, workflow patterns, and tool permissions.

## License

MIT — [Ataraxy Labs](https://github.com/ataraxy-labs)
