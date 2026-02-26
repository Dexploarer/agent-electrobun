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
agent-electrobun snapshot -i -C                   # Include cursor-interactive elements (onclick, cursor:pointer)
agent-electrobun snapshot -c                      # Compact output (flat list, no hierarchy)
agent-electrobun snapshot -d 3                    # Limit depth to 3 levels
agent-electrobun snapshot -s "#main"              # Scope to CSS selector
agent-electrobun snapshot @e1                     # Scope to ref's subtree
agent-electrobun snapshot -i -s ".sidebar"        # Interactive elements within a selector scope
```

### Cursor-Interactive Elements (-C flag)

When used with `-i`, includes additional clickable elements not captured by ARIA roles: elements with `onclick` attributes, `cursor:pointer` computed style, `role="button"`, `tabindex`, `<a href>`, `<button>`, `<summary>`, `<label>`. These extra elements are marked with `[cursor]` in the output.

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
agent-electrobun drag @e1 @e2                     # Drag from one element to another
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

### How Drag Works

1. Resolve both refs to centers via `DOM.getBoxModel`
2. `Input.dispatchMouseEvent` mouseMoved to source
3. `mousePressed` at source
4. 10 interpolated `mouseMoved` steps from source to destination
5. `mouseReleased` at destination

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
agent-electrobun keydown Shift                    # Hold key down (dispatch keyDown only)
agent-electrobun keyup Shift                      # Release key (dispatch keyUp only)
agent-electrobun keydown Control                  # Hold Control
agent-electrobun keyup Control                    # Release Control
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
agent-electrobun screenshot                       # Save to /tmp/quiver-tab.png
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
agent-electrobun wait --url "**/dashboard"        # Wait for URL pattern (glob or substring)
agent-electrobun wait --url "settings"            # Wait for URL containing "settings"
agent-electrobun wait @e1                         # Wait for ref to be resolvable (10s timeout)
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
agent-electrobun eval -b "ZG9jdW1lbnQudGl0bGU="  # Evaluate base64-encoded JS
agent-electrobun eval --stdin                     # Read JS from stdin
```

Use `-b`/`--base64` or `--stdin` for reliable execution. Shell escaping with nested quotes and special characters is error-prone.

```bash
# Base64 encode then eval
echo -n 'document.querySelectorAll("a").length' | base64 | xargs agent-electrobun eval -b

# Multiline via stdin
cat <<'EOF' | agent-electrobun eval --stdin
const links = document.querySelectorAll('a');
Array.from(links).map(a => a.href);
EOF
```

## Tab Management

```bash
agent-electrobun new-tab                          # Create new tab via shell automation bridge
agent-electrobun open-repo /path/to/repo          # Open repo in active tab
agent-electrobun open-repo /path/to/repo tab-2    # Open repo in specific tab
agent-electrobun tab switch tab-2                 # Switch to a specific tab via shell automation bridge
agent-electrobun tab close tab-2                  # Close a specific tab via shell automation bridge
```

### How open-repo Works

1. Finds the tab's CDP target by tabId
2. Locates the path input via `querySelector`
3. Sets value using React-compatible native setter + `input` event
4. Clicks the "Open" button
5. Waits 2s and takes a confirmation screenshot to `/tmp/quiver-open-repo.png`

## Console and Errors

```bash
agent-electrobun console                          # View captured console messages
agent-electrobun console --clear                  # Clear console buffer
agent-electrobun errors                           # View captured errors
agent-electrobun errors --clear                   # Clear error buffer
```

Console/error capture works by injecting a persistent in-page ring buffer (max 500 entries). The buffer survives between CLI invocations since it lives in the page's JS context. First call to `console` or `errors` installs the hooks automatically.

Output format:
- Console: `[log|warn|error|info|debug] message args...`
- Errors: `[error] message (filename:line)` with optional stack trace

## Dialogs

```bash
agent-electrobun dialog accept                    # Accept alert/confirm dialog
agent-electrobun dialog accept "yes"              # Accept prompt dialog with text input
agent-electrobun dialog dismiss                   # Dismiss/cancel dialog
```

Handles native JS dialogs (`alert()`, `confirm()`, `prompt()`). If no dialog is currently open, waits up to 10s for one to appear.

## Semantic Locators

Alternative to refs — locate elements without a prior snapshot.

```bash
agent-electrobun find text "Sign In" click        # Find by visible text content
agent-electrobun find label "Email" fill "user@test.com"  # Find by associated label
agent-electrobun find role button click            # Find by ARIA role or tag name
agent-electrobun find placeholder "Search" fill "query"   # Find by placeholder attribute
agent-electrobun find testid "submit-btn" click    # Find by data-testid or data-test-id
agent-electrobun find alt "Logo" click             # Find by alt attribute
agent-electrobun find title "Close" click          # Find by title attribute
```

### Available Actions

After locating an element: `click`, `dblclick`, `hover`, `focus`, `fill <text>`, `get text|html|value|<attr>`

### How find Works

1. Execute a JS query based on strategy (querySelectorAll, label association, text search)
2. Get first matching element as remote object
3. `DOM.describeNode` to get `backendNodeId`
4. Use existing interaction primitives (same as ref-based commands)

### Locator Priority (for `text` strategy)

1. Priority elements: `button, a, [role="button"], [role="link"], input[type="submit"]`
2. Leaf text nodes (elements with no children whose textContent matches)

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
| `scripts/agent-electrobun.ts` | The CLI script |
| `/tmp/agent-electrobun-refs.json` | Persisted ref store (per-target) |
| `/tmp/agent-electrobun-last-snapshot.json` | Last snapshot text (per-target, for diff) |
| `/tmp/quiver-tab.png` | Default screenshot output |
| `/tmp/quiver-open-repo.png` | Screenshot after open-repo |
