---
name: agent-electrobun
description: "CDP controller for Electrobun apps with multi-tab OOPIF architecture. Use when asked to interact with, test, screenshot, click, fill, or automate an Electrobun desktop app. Triggers on: interact with app, click button, test UI, screenshot app, inspect element, automate Electrobun, take screenshot, fill form, test this app, dogfood, QA the app."
allowed-tools: Bash(agent-electrobun:*), Bash(bun run ctl:*), Bash(bun src/agent-electrobun.ts:*)
---

# Electrobun App Automation with agent-electrobun

CDP (Chrome DevTools Protocol) controller for Electrobun apps that use multi-tab OOPIF architecture. Unlike agent-browser, this tool **attaches to existing CDP targets** — it never creates pages or navigates away, preserving the OOPIF lifecycle.

## Prerequisites

The Electrobun app must be running with CDP enabled:
- `QUIVER_DEBUG=1` env var set (enables `--remote-debugging-port=9222`)
- Dev mode: `bun run dev:electrobun` in the app directory

## Architecture

```
Electrobun app
├── Shell webview (mainview)    — tab bar, managed by shellRpc
│   └── window.__quiverAutomation  — automation bridge (dev only)
└── Tab OOPIFs (tabview)        — one OS process per tab, all app content
    └── Each at tabview/index.html?tabId=tab-N
```

CDP targets are discovered via `GET http://localhost:9222/json/list`. Shell is identified by `/mainview/` in URL, tabs by `/tabview/`.

## Core Workflow

Every interaction follows this pattern:

1. **Discover**: `agent-electrobun list` or `agent-electrobun tabs`
2. **Snapshot**: `agent-electrobun snapshot -i` (get element refs like `@e1`, `@e2`)
3. **Interact**: Use refs to click, fill, type
4. **Re-snapshot**: After UI changes, get fresh refs

```bash
agent-electrobun tabs
agent-electrobun snapshot -i
# Output: @e1 button "Open Repository…"
#         @e2 textbox "~/path/to/repo or GitHub PR URL"
#         @e3 button "Open" [disabled]

agent-electrobun fill @e2 "/path/to/my/repo"
agent-electrobun snapshot -i   # Re-snapshot — @e3 should now be enabled
agent-electrobun click @e3
agent-electrobun wait 2000
agent-electrobun snapshot -i   # See the workspace UI
```

## Target Selection

By default, commands target the **active tab**. Override with `--target`:

```bash
agent-electrobun --target shell snapshot -i     # Target the shell (tab bar)
agent-electrobun --target tab-1 snapshot -i     # Target a specific tab
agent-electrobun --target tab-2 screenshot      # Screenshot tab-2
agent-electrobun snapshot -i                    # Default: active tab
```

The shell automation bridge (`window.__quiverAutomation`) is used to discover the active tab. Commands like `tabs`, `new-tab`, and `shell eval` always target the shell implicitly.

## Essential Commands

```bash
# Discovery
agent-electrobun list                            # List all CDP page targets
agent-electrobun tabs                            # List tabs with active indicator

# Snapshot
agent-electrobun snapshot -i                     # Interactive elements with @refs (recommended)
agent-electrobun snapshot                        # Full accessibility tree

# Interaction (use @refs from snapshot)
agent-electrobun click @e1                       # Click element
agent-electrobun dblclick @e1                    # Double-click element
agent-electrobun focus @e1                       # Focus element
agent-electrobun hover @e1                       # Hover over element
agent-electrobun fill @e2 "text"                # Clear input + set value (React-compatible)
agent-electrobun type "text"                     # Type at current focus
agent-electrobun press Enter                     # Press key (Enter, Tab, Escape, Space, ArrowUp, …)
agent-electrobun press Control+a                # Key combo (Control, Shift, Meta, Alt + key)
agent-electrobun check @e1                       # Check checkbox (no-op if already checked)
agent-electrobun uncheck @e1                     # Uncheck checkbox (no-op if already unchecked)
agent-electrobun select @e1 "value"             # Select dropdown option by value or text
agent-electrobun scroll down 500                 # Scroll page (default: 400px)
agent-electrobun scroll up                       # Scroll up
agent-electrobun scrollintoview @e1              # Scroll element into view

# Mouse (low-level)
agent-electrobun mouse move 100 200              # Move mouse to coordinates
agent-electrobun mouse down left                 # Press mouse button (left/right/middle)
agent-electrobun mouse up left                   # Release mouse button
agent-electrobun mouse wheel 100                 # Mouse wheel scroll (deltaY)

# Keyboard (low-level)
agent-electrobun keyboard type "text"            # Type with key events (char by char)
agent-electrobun keyboard inserttext "text"      # Insert text without key events

# Get information
agent-electrobun get text @e1                    # Element text content
agent-electrobun get html @e1                    # Element innerHTML
agent-electrobun get value @e1                   # Input value
agent-electrobun get attr @e1 placeholder        # Element attribute
agent-electrobun get url                         # Page URL
agent-electrobun get title                       # Page title
agent-electrobun get count ".selector"           # Count matching elements
agent-electrobun get box @e1                     # Bounding box (JSON)
agent-electrobun get styles @e1                  # Computed styles (font, color, bg, size, …)

# Check state
agent-electrobun is visible @e1                  # Check if element is visible (true/false)
agent-electrobun is enabled @e1                  # Check if element is enabled (true/false)
agent-electrobun is checked @e1                  # Check if checkbox/radio is checked (true/false)

# Wait
agent-electrobun wait 2000                       # Wait milliseconds
agent-electrobun wait "#my-element"              # Wait for CSS selector (10s timeout)
agent-electrobun wait --text "Sign in"           # Wait for text on page
agent-electrobun wait --fn "window.loaded"       # Wait for JS condition to be truthy

# Capture
agent-electrobun screenshot                      # Screenshot (default: /tmp/electrobun-screenshot.png)
agent-electrobun screenshot /tmp/my.png          # Save to specific path
agent-electrobun screenshot --annotate           # With numbered ref labels overlaid
agent-electrobun screenshot --full               # Full page (beyond viewport)

# Compare
agent-electrobun diff snapshot                   # Compare current vs last snapshot

# Debug
agent-electrobun highlight @e1                   # Highlight element with red border (fades in 5s)

# JavaScript
agent-electrobun eval 'document.title'           # Evaluate JS in target
agent-electrobun shell eval 'document.title'     # Evaluate JS in shell

# Tab management
agent-electrobun new-tab                         # Create a new tab
agent-electrobun open-repo /path/to/repo         # Open repo in active tab
agent-electrobun open-repo /path/to/repo tab-2   # Open repo in specific tab
```

## Command Chaining

Commands can be chained with `&&` in a single shell invocation:

```bash
# Fill and click in sequence
agent-electrobun fill @e2 "/path/to/repo" && agent-electrobun click @e3

# Wait then screenshot
agent-electrobun wait 2000 && agent-electrobun screenshot /tmp/result.png

# Create tab, wait for it, then snapshot
agent-electrobun new-tab && agent-electrobun wait 1000 && agent-electrobun snapshot -i
```

**When to chain:** Use `&&` when you don't need to read intermediate output. Run separately when you need to parse snapshot output to get refs before interacting.

## Ref System

Refs (`@e1`, `@e2`, …) are assigned during `snapshot -i` and map to accessibility tree nodes via `backendDOMNodeId`. They are persisted to `/tmp/agent-electrobun-refs.json` so they survive between CLI invocations.

### Ref Lifecycle (Important)

Refs are invalidated when the DOM changes. **Always re-snapshot after:**

- Clicking buttons that change the view
- Filling inputs that trigger UI updates
- Opening repos or switching tabs
- Any navigation or dynamic content loading

```bash
agent-electrobun click @e3               # Triggers navigation
agent-electrobun wait 2000               # Wait for UI to settle
agent-electrobun snapshot -i             # MUST re-snapshot
agent-electrobun click @e1               # Use new refs
```

### Per-Target Ref Isolation

Refs are stored per-target (`shell`, `tab:tab-1`, `tab:tab-2`), so switching `--target` doesn't invalidate other targets' refs.

## Annotated Screenshots (Vision Mode)

Use `--annotate` to take a screenshot with numbered red labels overlaid on interactive elements. Each label `[N]` maps to ref `@eN`. This also refreshes refs.

```bash
agent-electrobun screenshot --annotate
# Output includes the image path and a legend:
#   [1] @e1 button "Open Repository…"
#   [2] @e2 textbox "~/path/to/repo or GitHub PR URL"
#   [3] @e3 button "Open"
agent-electrobun click @e2               # Click using ref from annotated screenshot
```

Use annotated screenshots when:
- You need to verify visual layout
- The page has unlabeled icon buttons
- You need spatial reasoning about element positions

## Diffing (Verifying Changes)

Use `diff snapshot` after performing an action to verify it had the intended effect. Compares the current accessibility tree against the last `snapshot -i`.

```bash
# Typical workflow: snapshot → action → diff
agent-electrobun snapshot -i             # Take baseline snapshot
agent-electrobun click @e2               # Perform action
agent-electrobun diff snapshot           # See what changed (+ additions, - removals)
```

## Common Patterns

### Open a Repository

```bash
agent-electrobun snapshot -i
agent-electrobun fill @e2 "/path/to/repo"
agent-electrobun snapshot -i              # Verify Open button is enabled
agent-electrobun click @e3                # Click Open
agent-electrobun wait 3000                # Wait for repo to load
agent-electrobun snapshot -i              # See workspace elements
```

### Multi-Tab Workflow

```bash
agent-electrobun tabs                     # See current tabs
agent-electrobun new-tab                  # Create tab-2
agent-electrobun --target tab-2 snapshot -i
agent-electrobun --target tab-2 fill @e2 "/other/repo"
agent-electrobun --target tab-2 click @e3
agent-electrobun --target tab-1 screenshot /tmp/tab1.png
agent-electrobun --target tab-2 screenshot /tmp/tab2.png
```

### Inspect Shell Tab Bar

```bash
agent-electrobun --target shell snapshot -i
# @e1 button "my-repo"
# @e2 button                         # The "+" new tab button
agent-electrobun --target shell click @e2   # Add tab via shell
```

### Form Interaction

```bash
agent-electrobun snapshot -i
agent-electrobun fill @e2 "user@example.com"
agent-electrobun fill @e3 "password"
agent-electrobun check @e4                 # Check "Remember me"
agent-electrobun select @e5 "admin"        # Select role
agent-electrobun click @e6                 # Submit
agent-electrobun wait --text "Welcome"     # Wait for success
agent-electrobun snapshot -i
```

### Keyboard Navigation

```bash
agent-electrobun press Tab                 # Focus next element
agent-electrobun press Tab                 # Focus next
agent-electrobun press Enter               # Activate focused element
agent-electrobun press Control+a           # Select all
agent-electrobun press Escape              # Close modal/dialog
agent-electrobun press ArrowDown           # Navigate list
```

### State Verification

```bash
agent-electrobun is visible @e1            # "true" or "false"
agent-electrobun is enabled @e3            # Check if button is clickable
agent-electrobun is checked @e4            # Check checkbox state
agent-electrobun get value @e2             # Read input value
agent-electrobun get text @e1              # Read element text
agent-electrobun get styles @e1            # Inspect computed styles
agent-electrobun get box @e1               # Get position and dimensions
```

### Data Extraction

```bash
agent-electrobun snapshot -i
agent-electrobun get text @e13             # Get file diff summary text
agent-electrobun get html @e5              # Get raw HTML content
agent-electrobun get attr @e1 href         # Get attribute value
agent-electrobun get count ".file-item"    # Count elements
agent-electrobun eval 'document.querySelectorAll("[data-testid]").length'
```

### Low-Level Mouse Control

```bash
agent-electrobun mouse move 100 200        # Position the cursor
agent-electrobun mouse down left           # Press left button
agent-electrobun mouse move 300 200        # Drag to new position
agent-electrobun mouse up left             # Release (completes drag)
agent-electrobun mouse wheel -200          # Scroll up via wheel
```

## Timeouts and Slow UI

The default wait timeout is 10 seconds. Use explicit waits for slow operations:

```bash
agent-electrobun wait 3000                  # Fixed delay (ms)
agent-electrobun wait "#content"            # Wait for element to appear
agent-electrobun wait --text "Loaded"       # Wait for text to appear
agent-electrobun wait --fn "window.ready"   # Wait for JS condition
```

## Deep-Dive Documentation

| Reference | When to Use |
|-----------|-------------|
| [references/commands.md](references/commands.md) | Full command reference with all options |
| [references/snapshot-refs.md](references/snapshot-refs.md) | Ref lifecycle, troubleshooting, per-target isolation |
| [references/architecture.md](references/architecture.md) | OOPIF architecture, CDP target discovery, why agent-browser can't work |
