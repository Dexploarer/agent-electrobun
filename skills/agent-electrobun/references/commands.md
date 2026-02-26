# Command Reference

Complete reference for all agent-electrobun commands. For quick start and common patterns, see [SKILL.md](../SKILL.md).

## Discovery

```bash
agent-electrobun list                             # List all CDP page targets (shell, tabs, other)
agent-electrobun tabs                             # List tabs via shell automation bridge (shows active)
agent-electrobun help                             # Show help text
```

## Snapshot (page analysis)

```bash
agent-electrobun snapshot                         # Full accessibility tree (hierarchical)
agent-electrobun snapshot -i                      # Interactive elements only with @refs (recommended)
```

### Interactive Roles

The following ARIA roles are included in `-i` snapshots:
`button`, `textbox`, `link`, `combobox`, `checkbox`, `radio`, `menuitem`, `menuitemcheckbox`, `menuitemradio`, `option`, `searchbox`, `slider`, `spinbutton`, `switch`, `tab`, `treeitem`, `listbox`

### Ref Properties Shown

- `value="…"` — current input value
- `[checked]` — checked state for checkboxes/radios
- `[disabled]` — disabled elements (can't be clicked/filled)

## Interactions (use @refs from snapshot)

```bash
agent-electrobun click @e1                        # Click element (scroll into view + mouse event)
agent-electrobun dblclick @e1                     # Double-click element
agent-electrobun focus @e1                        # Focus element (for keyboard input)
agent-electrobun hover @e1                        # Hover over element (mouseMoved event)
agent-electrobun fill @e2 "text"                 # Clear + set value (React-compatible native setter)
agent-electrobun type "text"                      # Type at current focus (Input.insertText)
agent-electrobun press Enter                      # Press key (alias for key combos too)
agent-electrobun press Control+a                  # Key combination (modifiers: Control, Shift, Meta, Alt)
agent-electrobun check @e1                        # Check checkbox (no-op if already checked)
agent-electrobun uncheck @e1                      # Uncheck checkbox (no-op if already unchecked)
agent-electrobun select @e1 "value"              # Select dropdown option by value or visible text
agent-electrobun scroll down 500                  # Scroll page (default: 400px)
agent-electrobun scroll up 300                    # Scroll up
agent-electrobun scrollintoview @e1               # Scroll element into view (alias: scrollinto)
```

### Supported Keys (press command)

Named keys: `Enter`, `Tab`, `Escape`, `Backspace`, `Delete`, `Space`, `ArrowUp`, `ArrowDown`, `ArrowLeft`, `ArrowRight`, `Home`, `End`, `PageUp`, `PageDown`, `F1`–`F12`

Modifiers: `Control` (alias: `Ctrl`), `Shift`, `Meta` (alias: `Command`, `Cmd`), `Alt`

Combos: `Control+a`, `Shift+Tab`, `Meta+c`, `Control+Shift+p`

Single characters: `a`, `A`, `1`, `/`, etc.

### How Click Works

1. Resolve `backendDOMNodeId` → `DOM.describeNode` → `nodeId`
2. `DOM.scrollIntoViewIfNeeded` (ensures element is visible)
3. `DOM.getBoxModel` → compute center coordinates
4. `Input.dispatchMouseEvent` (mouseMoved + mousePressed + mouseReleased)

### How Fill Works

1. Resolve `backendDOMNodeId` → `nodeId`
2. `DOM.scrollIntoViewIfNeeded`
3. `DOM.focus`
4. Clear + set via `Runtime.callFunctionOn` with React-compatible native setter
5. Dispatches `input` + `change` events to trigger React state updates

## Mouse Control

```bash
agent-electrobun mouse move 100 200               # Move mouse to coordinates (x, y)
agent-electrobun mouse down left                   # Press mouse button (left/right/middle)
agent-electrobun mouse down right                  # Right-click press
agent-electrobun mouse up left                     # Release mouse button
agent-electrobun mouse wheel 100                   # Mouse wheel scroll (positive = down)
agent-electrobun mouse wheel -200                  # Mouse wheel scroll (negative = up)
```

## Keyboard Control

```bash
agent-electrobun keyboard type "hello"             # Type with key events (keyDown + char + keyUp per char)
agent-electrobun keyboard inserttext "hello"       # Insert text without key events (Input.insertText)
```

`keyboard type` fires individual key events per character — use when the app listens for keyDown/keyUp. `keyboard inserttext` uses `Input.insertText` — faster, but no key events fired.

## Get Information

```bash
agent-electrobun get text @e1                     # Get element textContent or value
agent-electrobun get html @e1                     # Get element innerHTML
agent-electrobun get value @e1                    # Get input value (this.value)
agent-electrobun get attr @e1 href                # Get element attribute by name
agent-electrobun get url                          # Get page URL (window.location.href)
agent-electrobun get title                        # Get page title (document.title)
agent-electrobun get count ".selector"            # Count matching elements (querySelectorAll.length)
agent-electrobun get box @e1                      # Get bounding box JSON ({x, y, width, height})
agent-electrobun get styles @e1                   # Get computed styles (font, color, bg, size, display, …)
```

### Styles Output

`get styles` returns JSON with: `font`, `fontSize`, `fontWeight`, `fontFamily`, `color`, `backgroundColor`, `width`, `height`, `display`, `position`, `visibility`, `opacity`, `padding`, `margin`, `border`, `borderRadius`.

## Check State

```bash
agent-electrobun is visible @e1                   # Checks bounding rect, visibility, display, opacity
agent-electrobun is enabled @e1                   # Checks !this.disabled
agent-electrobun is checked @e1                   # Checks !!this.checked
```

All return `true` or `false` as plain text.

## Screenshots and Capture

```bash
agent-electrobun screenshot                       # Save to /tmp/electrobun-screenshot.png
agent-electrobun screenshot /tmp/my.png           # Save to specific path
agent-electrobun screenshot --annotate            # With red bordered numbered labels on interactive elements
agent-electrobun screenshot /tmp/a.png --annotate # Annotated to specific path
agent-electrobun screenshot --full                # Full page (captureBeyondViewport)
```

### Annotated Screenshot Details

1. Takes a fresh `snapshot -i` to assign/refresh refs
2. Resolves bounding boxes for each ref via `DOM.getBoxModel`
3. Injects a DOM overlay with red-bordered boxes and `[N]` labels
4. Takes screenshot via `Page.captureScreenshot`
5. Removes overlay (always, even on failure)
6. Prints a legend mapping `[N]` → `@eN role "name"`

## Wait

```bash
agent-electrobun wait 2000                        # Wait milliseconds
agent-electrobun wait "#my-element"               # Wait for CSS selector (polls every 200ms, 10s timeout)
agent-electrobun wait "[data-loaded]"             # Wait for attribute selector
agent-electrobun wait --text "Welcome"            # Wait for text in document.body.innerText
agent-electrobun wait --fn "window.appReady"      # Wait for JS expression to be truthy
```

All selector/text/fn waits poll every 200ms with a 10s timeout.

## Compare

```bash
agent-electrobun diff snapshot                    # Compare current snapshot vs last saved snapshot
```

Output uses `+` for additions and `-` for removals (like git diff). The last `snapshot -i` is automatically saved per-target to `/tmp/agent-electrobun-last-snapshot.json`.

## Debug

```bash
agent-electrobun highlight @e1                    # Red border + translucent red overlay, fades after 5s
```

## JavaScript Evaluation

```bash
agent-electrobun eval 'document.title'                                      # Simple expression
agent-electrobun eval 'document.querySelectorAll("button").length'           # Count elements
agent-electrobun eval 'JSON.stringify(Array.from(document.querySelectorAll("a")).map(a=>a.href))'
agent-electrobun shell eval 'document.title'                                 # Eval in shell webview
agent-electrobun shell eval 'JSON.stringify(window.__quiverAutomation?.listTabs())'
```

## Tab Management

```bash
agent-electrobun new-tab                          # Create new tab via shell automation bridge
agent-electrobun open-repo /path/to/repo          # Open repo in active tab
agent-electrobun open-repo /path/to/repo tab-2    # Open repo in specific tab
```

### How open-repo Works

1. Finds the tab's CDP target by tabId
2. Locates the path input via `querySelector`
3. Sets value using React-compatible native setter + `input` event
4. Clicks the "Open" button
5. Waits 2s and takes a confirmation screenshot to `/tmp/quiver-open-repo.png`

## Target Selection (Global Flag)

```bash
--target shell          # Target the shell (mainview) webview
--target tab-1          # Target tab with id "tab-1"
--target tab-2          # Target tab with id "tab-2"
(omit)                  # Default: auto-detect active tab via shell bridge
```

Target resolution order:
1. If `--target shell` or command is `tabs`/`new-tab`/`shell eval`: connect to shell
2. If `--target tab-N`: connect to that specific tab
3. Otherwise: query shell for active tab → connect to that tab

## Environment Variables

```bash
QUIVER_CDP_PORT=9222        # CDP port (default: 9222)
QUIVER_DEBUG=1              # Must be set when launching the Electrobun app
```

## File Locations

| File | Purpose |
|------|---------|
| `src/agent-electrobun.ts` | The CLI script |
| `/tmp/agent-electrobun-refs.json` | Persisted ref store (per-target) |
| `/tmp/agent-electrobun-last-snapshot.json` | Last snapshot text (per-target, for diff) |
| `/tmp/electrobun-screenshot.png` | Default screenshot output |
| `/tmp/electrobun-open-repo.png` | Screenshot after open-repo |
