# Snapshot and Refs

Compact element references for interacting with Electrobun app UI via CDP.

**Related**: [commands.md](commands.md) for full command reference, [SKILL.md](../SKILL.md) for quick start.

## Contents

- [How Refs Work](#how-refs-work)
- [The Snapshot Command](#the-snapshot-command)
- [Using Refs](#using-refs)
- [Ref Lifecycle](#ref-lifecycle)
- [Per-Target Isolation](#per-target-isolation)
- [Troubleshooting](#troubleshooting)

## How Refs Work

`snapshot -i` calls `Accessibility.getFullAXTree` via CDP, filters to interactive ARIA roles, and assigns sequential `@eN` refs. Each ref maps to a `backendDOMNodeId` — a stable identifier that CDP can resolve to a live DOM node for clicking, focusing, or reading.

```
AX tree → filter interactive roles → assign @e1, @e2, … → persist to /tmp/agent-electrobun-refs.json
```

When you run `click @e1`, the tool:
1. Loads the ref store from disk
2. Finds `@e1` → `{ backendDOMNodeId: 7, role: "button", name: "Open" }`
3. Calls `DOM.describeNode({ backendNodeId: 7 })` → gets `nodeId`
4. Calls `DOM.scrollIntoViewIfNeeded({ nodeId })` → ensures visible
5. Calls `DOM.getBoxModel({ nodeId })` → computes center `(x, y)`
6. Calls `Input.dispatchMouseEvent` → clicks

## The Snapshot Command

```bash
# Interactive snapshot — RECOMMENDED
agent-electrobun snapshot -i

# Full tree (hierarchical, includes all roles)
agent-electrobun snapshot
```

### Interactive Snapshot Output

```
@e1 button "Open Repository…"
@e2 textbox "~/path/to/repo or GitHub PR URL"
@e3 button "Open" [disabled]
@e4 button "Connect GitHub Token"
@e5 button "Settings"
(5 interactive elements, refs saved for target "tab:tab-1")
```

Each line shows: `@ref role "accessible name" [state]`

### Ref Properties

```
@e1 button "Submit"                       # Role + accessible name
@e2 textbox "Email" value="user@test.com" # Current input value
@e3 checkbox "Remember" [checked]         # Checked state
@e4 button "Save" [disabled]              # Disabled element
```

## Using Refs

```bash
# Click a button
agent-electrobun click @e1

# Double-click
agent-electrobun dblclick @e1

# Focus an input
agent-electrobun focus @e2

# Fill an input (React-compatible)
agent-electrobun fill @e2 "/path/to/repo"

# Get element text
agent-electrobun get text @e1

# Get innerHTML
agent-electrobun get html @e1

# Get input value
agent-electrobun get value @e2

# Get attribute
agent-electrobun get attr @e1 placeholder

# Get bounding box
agent-electrobun get box @e1

# Get computed styles
agent-electrobun get styles @e1

# Check state
agent-electrobun is visible @e1
agent-electrobun is enabled @e1
agent-electrobun is checked @e3

# Scroll element into view
agent-electrobun scrollintoview @e1

# Highlight for debugging
agent-electrobun highlight @e1
```

Refs accept multiple formats: `@e1`, `e1`, or just the number after `@e`.

## Ref Lifecycle

**Refs are invalidated when the DOM changes.** Always re-snapshot after:

- Clicking buttons that navigate or change the view
- Filling inputs that trigger conditional UI (e.g., enabling/disabling buttons)
- Opening a repository (changes the entire page)
- Creating or switching tabs
- Dynamic content loading (modals, dropdowns, lazy-loaded lists)

```bash
# CORRECT
agent-electrobun snapshot -i            # Get refs
agent-electrobun click @e3              # Click Open (navigates)
agent-electrobun wait 2000              # Wait for UI
agent-electrobun snapshot -i            # Re-snapshot — new refs!
agent-electrobun click @e10             # Use new refs

# WRONG
agent-electrobun snapshot -i
agent-electrobun click @e3              # Page changed
agent-electrobun click @e10             # STALE REF — will fail or click wrong thing!
```

### Stale Ref Errors

When a ref is stale, you'll see:
```
✗ Ref @e3 (button "Open") is stale: ...
  Run `snapshot -i` to refresh.
```

This means the DOM node no longer exists. Run `snapshot -i` to get fresh refs.

### Verifying Changes with Diff

Use `diff snapshot` to see what changed after an action without manually comparing snapshots:

```bash
agent-electrobun snapshot -i             # Baseline (auto-saved)
agent-electrobun click @e2               # Perform action
agent-electrobun diff snapshot           # Shows + additions, - removals
```

## Per-Target Isolation

Refs are stored per-target in the ref file:

```json
{
  "version": 1,
  "targets": {
    "shell": { "next": 2, "refs": { "@e1": { ... }, "@e2": { ... } } },
    "tab:tab-1": { "next": 57, "refs": { "@e1": { ... }, ... } },
    "tab:tab-2": { "next": 5, "refs": { "@e1": { ... }, ... } }
  }
}
```

This means:
- Snapshotting `tab-1` doesn't affect `tab-2`'s refs
- You can switch `--target` between commands without losing refs
- Each tab and the shell have independent ref namespaces

## Troubleshooting

### "Ref not found" Error

```
Ref @e5 not found for target "tab:tab-1". Run `snapshot -i` first.
```

**Fix:** Run `agent-electrobun snapshot -i` (or `--target <target> snapshot -i`).

### "Shell target not found"

```
Shell target not found. Is the app running with QUIVER_DEBUG=1?
```

**Fix:** Ensure the Electrobun app is running with `QUIVER_DEBUG=1`:
```bash
QUIVER_DEBUG=1 electrobun dev --watch
```

### "No active tab found"

```
No active tab found. Create one: agent-electrobun new-tab
```

**Fix:** The shell automation bridge couldn't find an active tab. Either:
- Run `agent-electrobun new-tab` to create one
- Use `--target tab-1` to target explicitly

### Click Misses / Wrong Element

If `click @eN` hits the wrong element:
1. The DOM may have changed — re-snapshot
2. The element may be overlapped — try `scroll up/down` then re-snapshot
3. For very small elements, the center point might be off — use `eval` as fallback

### Fill Doesn't Trigger React State Update

The `fill` command uses React-compatible native setter (`Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set`) and dispatches `input` + `change` events. If the app uses a non-standard input component, try:

```bash
agent-electrobun click @e2                       # Focus the input
agent-electrobun type "text"                     # Type via Input.insertText
```

Or use `keyboard type` for key-event-level typing:
```bash
agent-electrobun focus @e2
agent-electrobun keyboard type "text"            # Fires keyDown/char/keyUp per character
```

### Element Not in Snapshot

Some elements may not appear in `snapshot -i` if:
- They don't have an interactive ARIA role
- They're added dynamically after the snapshot
- They're inside a shadow DOM

**Fix:** Use `eval` to interact directly:
```bash
agent-electrobun eval 'document.querySelector(".my-button").click()'
```
