#!/usr/bin/env bun
/**
 * quiver-ctl — Full-featured CDP controller for the Quiver Electrobun app.
 *
 * Attaches to EXISTING CDP targets (shell / tab OOPIFs) via WebSocket.
 * Never creates new pages or navigates away — preserves the OOPIF lifecycle.
 *
 * Target selection:
 *   --target shell       Target the shell (mainview)
 *   --target tab-1       Target a specific tab
 *   (default)            Target the active tab
 */

const CDP_PORT = process.env.QUIVER_CDP_PORT ?? "9222";
const CDP_BASE = `http://localhost:${CDP_PORT}`;
const REFS_PATH = "/tmp/quiver-ctl-refs.json";
const SNAPSHOT_PATH = "/tmp/quiver-ctl-last-snapshot.json";

// ── Types ─────────────────────────────────────────────────────────────────────

type CDPTarget = {
  id: string;
  title: string;
  type: string;
  url: string;
  webSocketDebuggerUrl: string;
};

type RefRecord = {
  backendDOMNodeId: number;
  role: string;
  name: string;
};

type TargetRefs = {
  next: number;
  refs: Record<string, RefRecord>;
};

type RefsFile = {
  version: 1;
  targets: Record<string, TargetRefs>;
};

type AXNode = {
  nodeId: string;
  ignored: boolean;
  role?: { type: string; value: string };
  name?: { type: string; value: string };
  properties?: Array<{ name: string; value: { type: string; value: any } }>;
  backendDOMNodeId?: number;
  childIds?: string[];
};

// ── Key definitions for press command ─────────────────────────────────────────

type KeyDef = { key: string; code: string; keyCode: number; text?: string };

const KEY_MAP: Record<string, KeyDef> = {
  enter:      { key: "Enter", code: "Enter", keyCode: 13, text: "\r" },
  tab:        { key: "Tab", code: "Tab", keyCode: 9 },
  escape:     { key: "Escape", code: "Escape", keyCode: 27 },
  backspace:  { key: "Backspace", code: "Backspace", keyCode: 8 },
  delete:     { key: "Delete", code: "Delete", keyCode: 46 },
  space:      { key: " ", code: "Space", keyCode: 32, text: " " },
  arrowup:    { key: "ArrowUp", code: "ArrowUp", keyCode: 38 },
  arrowdown:  { key: "ArrowDown", code: "ArrowDown", keyCode: 40 },
  arrowleft:  { key: "ArrowLeft", code: "ArrowLeft", keyCode: 37 },
  arrowright: { key: "ArrowRight", code: "ArrowRight", keyCode: 39 },
  home:       { key: "Home", code: "Home", keyCode: 36 },
  end:        { key: "End", code: "End", keyCode: 35 },
  pageup:     { key: "PageUp", code: "PageUp", keyCode: 33 },
  pagedown:   { key: "PageDown", code: "PageDown", keyCode: 34 },
  f1: { key: "F1", code: "F1", keyCode: 112 }, f2: { key: "F2", code: "F2", keyCode: 113 },
  f3: { key: "F3", code: "F3", keyCode: 114 }, f4: { key: "F4", code: "F4", keyCode: 115 },
  f5: { key: "F5", code: "F5", keyCode: 116 }, f6: { key: "F6", code: "F6", keyCode: 117 },
  f7: { key: "F7", code: "F7", keyCode: 118 }, f8: { key: "F8", code: "F8", keyCode: 119 },
  f9: { key: "F9", code: "F9", keyCode: 120 }, f10: { key: "F10", code: "F10", keyCode: 121 },
  f11: { key: "F11", code: "F11", keyCode: 122 }, f12: { key: "F12", code: "F12", keyCode: 123 },
  // Modifier keys (for keydown/keyup commands)
  shift:    { key: "Shift", code: "ShiftLeft", keyCode: 16 },
  control:  { key: "Control", code: "ControlLeft", keyCode: 17 },
  ctrl:     { key: "Control", code: "ControlLeft", keyCode: 17 },
  alt:      { key: "Alt", code: "AltLeft", keyCode: 18 },
  meta:     { key: "Meta", code: "MetaLeft", keyCode: 91 },
  command:  { key: "Meta", code: "MetaLeft", keyCode: 91 },
  cmd:      { key: "Meta", code: "MetaLeft", keyCode: 91 },
};

// CDP modifier bit flags
const MOD_ALT = 1, MOD_CTRL = 2, MOD_META = 4, MOD_SHIFT = 8;
const MOD_MAP: Record<string, number> = {
  alt: MOD_ALT, control: MOD_CTRL, ctrl: MOD_CTRL,
  meta: MOD_META, command: MOD_META, cmd: MOD_META,
  shift: MOD_SHIFT,
};

function parseKeyCombo(combo: string): { keyDef: KeyDef; modifiers: number } {
  const parts = combo.split("+");
  let modifiers = 0;
  let keyPart = "";
  for (const p of parts) {
    const lower = p.toLowerCase();
    if (MOD_MAP[lower] != null) { modifiers |= MOD_MAP[lower]; }
    else { keyPart = p; }
  }
  // If no key part but modifiers exist, the combo is a bare modifier key (e.g., "Shift")
  if (!keyPart && modifiers) {
    const firstMod = parts[parts.length - 1].toLowerCase();
    if (KEY_MAP[firstMod]) return { keyDef: KEY_MAP[firstMod], modifiers: 0 };
  }
  const lower = keyPart.toLowerCase();
  if (KEY_MAP[lower]) return { keyDef: KEY_MAP[lower], modifiers };
  // Single character key
  const ch = keyPart.length === 1 ? keyPart : keyPart;
  const upper = ch.toUpperCase();
  return {
    keyDef: { key: ch, code: ch.length === 1 ? `Key${upper}` : ch, keyCode: upper.charCodeAt(0), text: ch },
    modifiers,
  };
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function die(msg: string): never {
  console.error(msg);
  process.exit(1);
}

// ── CDPClient ─────────────────────────────────────────────────────────────────

class CDPClient {
  private ws: WebSocket;
  private nextId = 1;
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  private listeners = new Map<string, Set<(params: any) => void>>();
  private ready: Promise<void>;

  private constructor(wsUrl: string) {
    this.ws = new WebSocket(wsUrl);
    this.ready = new Promise((resolve, reject) => {
      this.ws.onopen = () => resolve();
      this.ws.onerror = (e) => reject(new Error(`WebSocket error: ${e}`));
    });
    this.ws.onmessage = (event) => {
      const msg = JSON.parse(String(event.data));
      if (msg.id != null) {
        const p = this.pending.get(msg.id);
        if (p) {
          this.pending.delete(msg.id);
          clearTimeout(p.timer);
          if (msg.error) p.reject(new Error(msg.error.message ?? JSON.stringify(msg.error)));
          else p.resolve(msg.result);
        }
      } else if (msg.method) {
        const fns = this.listeners.get(msg.method);
        if (fns) for (const fn of fns) fn(msg.params);
      }
    };
  }

  static async connect(wsUrl: string): Promise<CDPClient> {
    const client = new CDPClient(wsUrl);
    await client.ready;
    for (const domain of ["Runtime", "Page", "DOM", "Accessibility"]) {
      try { await client.call(`${domain}.enable`, {}, 3000); } catch { /* ignore */ }
    }
    try { await client.call("DOM.getDocument", { depth: -1 }, 5000); } catch { /* ignore */ }
    return client;
  }

  on(method: string, fn: (params: any) => void): void {
    if (!this.listeners.has(method)) this.listeners.set(method, new Set());
    this.listeners.get(method)!.add(fn);
  }

  off(method: string, fn: (params: any) => void): void {
    this.listeners.get(method)?.delete(fn);
  }

  once(method: string, timeoutMs = 15_000): Promise<any> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.off(method, handler); reject(new Error(`Timed out waiting for ${method} (${timeoutMs}ms)`)); }, timeoutMs);
      const handler = (params: any) => { clearTimeout(timer); this.off(method, handler); resolve(params); };
      this.on(method, handler);
    });
  }

  async call<T = any>(method: string, params: Record<string, any> = {}, timeoutMs = 15_000): Promise<T> {
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`CDP ${method} timed out (${timeoutMs}ms)`)); }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async close(): Promise<void> {
    for (const [, p] of this.pending) { clearTimeout(p.timer); p.reject(new Error("CDPClient closed")); }
    this.pending.clear();
    this.ws.close();
  }
}

// ── Target discovery ──────────────────────────────────────────────────────────

async function getTargets(): Promise<CDPTarget[]> {
  const res = await fetch(`${CDP_BASE}/json/list`);
  return res.json();
}

function findShell(targets: CDPTarget[]) {
  return targets.find((t) => t.type === "page" && t.url.includes("/mainview/"));
}

function findTab(targets: CDPTarget[], tabId: string) {
  return targets.find((t) => t.type === "page" && t.url.includes("/tabview/") && t.url.includes(`tabId=${tabId}`));
}

async function getActiveTabId(shellWsUrl: string): Promise<string | null> {
  const client = await CDPClient.connect(shellWsUrl);
  try {
    const r = await client.call("Runtime.evaluate", { expression: "JSON.stringify(window.__quiverAutomation?.listTabs())", returnByValue: true, awaitPromise: true });
    const data = JSON.parse(r.result?.value ?? "null");
    return data?.activeTabId ?? null;
  } finally { await client.close(); }
}

// ── Ref store ─────────────────────────────────────────────────────────────────

const fs = require("fs");

function loadRefs(): RefsFile {
  try { return JSON.parse(fs.readFileSync(REFS_PATH, "utf-8")); }
  catch { return { version: 1, targets: {} }; }
}

function saveRefs(data: RefsFile) {
  const tmp = REFS_PATH + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, REFS_PATH);
}

function getTargetKey(targetSpec: string): string {
  return targetSpec === "shell" ? "shell" : `tab:${targetSpec}`;
}

function resolveRef(refArg: string, targetKey: string): RefRecord {
  const key = refArg.startsWith("@") ? refArg : `@${refArg}`;
  const store = loadRefs();
  const targetRefs = store.targets[targetKey];
  if (!targetRefs?.refs[key]) die(`Ref ${key} not found for target "${targetKey}". Run \`snapshot -i\` first.`);
  return targetRefs.refs[key];
}

// ── CDP primitives ────────────────────────────────────────────────────────────

async function evalJS(client: CDPClient, expression: string, opts?: { returnByValue?: boolean; awaitPromise?: boolean }): Promise<any> {
  const r = await client.call("Runtime.evaluate", { expression, returnByValue: opts?.returnByValue ?? true, awaitPromise: opts?.awaitPromise ?? true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? JSON.stringify(r.exceptionDetails));
  return r.result?.value;
}

async function getFullAXTree(client: CDPClient): Promise<AXNode[]> {
  const r = await client.call("Accessibility.getFullAXTree", {}, 10_000);
  return r.nodes ?? [];
}

async function getScopedAXTree(client: CDPClient, backendNodeId: number): Promise<AXNode[]> {
  const nodeId = await resolveBackendNode(client, backendNodeId);
  const r = await client.call("Accessibility.getPartialAXTree", { nodeId, fetchRelatives: false }, 10_000);
  return r.nodes ?? [];
}

async function resolveSelector(client: CDPClient, selector: string): Promise<number> {
  const doc = await client.call("DOM.getDocument", { depth: 0 });
  const r = await client.call("DOM.querySelector", { nodeId: doc.root.nodeId, selector });
  if (!r.nodeId) throw new Error(`Selector "${selector}" not found`);
  const desc = await client.call("DOM.describeNode", { nodeId: r.nodeId });
  return desc.node.backendNodeId;
}

async function resolveBackendNode(client: CDPClient, backendDOMNodeId: number): Promise<number> {
  const r = await client.call("DOM.describeNode", { backendNodeId: backendDOMNodeId });
  return r.node?.nodeId;
}

async function scrollIntoView(client: CDPClient, nodeId: number): Promise<void> {
  try { await client.call("DOM.scrollIntoViewIfNeeded", { nodeId }); } catch { /* best-effort */ }
}

async function getBoxCenter(client: CDPClient, nodeId: number): Promise<{ x: number; y: number }> {
  const r = await client.call("DOM.getBoxModel", { nodeId });
  const quad = r.model?.content ?? r.model?.border;
  if (!quad || quad.length < 8) throw new Error("No box model for node");
  const xs = [quad[0], quad[2], quad[4], quad[6]], ys = [quad[1], quad[3], quad[5], quad[7]];
  return { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 };
}

async function getBoxRect(client: CDPClient, nodeId: number): Promise<{ x: number; y: number; width: number; height: number }> {
  const r = await client.call("DOM.getBoxModel", { nodeId });
  const quad = r.model?.content ?? r.model?.border;
  if (!quad || quad.length < 8) throw new Error("No box model for node");
  const xs = [quad[0], quad[2], quad[4], quad[6]], ys = [quad[1], quad[3], quad[5], quad[7]];
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

async function clickAt(client: CDPClient, x: number, y: number, clickCount = 1): Promise<void> {
  await client.call("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
  await client.call("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount });
  await client.call("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount });
}

async function focusNode(client: CDPClient, nodeId: number): Promise<void> {
  await client.call("DOM.focus", { nodeId });
}

async function captureScreenshot(client: CDPClient, full = false): Promise<Buffer> {
  const params: Record<string, any> = { format: "png" };
  if (full) params.captureBeyondViewport = true;
  const r = await client.call("Page.captureScreenshot", params, 15_000);
  if (!r.data) throw new Error("No screenshot data");
  return Buffer.from(r.data, "base64");
}

/** Resolve ref → nodeId, scroll into view. Returns nodeId. */
async function prepareRef(client: CDPClient, refArg: string, targetKey: string): Promise<{ nodeId: number; ref: RefRecord }> {
  const ref = resolveRef(refArg, targetKey);
  try {
    const nodeId = await resolveBackendNode(client, ref.backendDOMNodeId);
    await scrollIntoView(client, nodeId);
    return { nodeId, ref };
  } catch (e: any) {
    die(`✗ Ref ${refArg} (${ref.role} "${ref.name}") is stale: ${e.message}\n  Run \`snapshot -i\` to refresh.`);
  }
}

/** Get JS object for a DOM node */
async function getRemoteObject(client: CDPClient, nodeId: number): Promise<string> {
  const resolved = await client.call("DOM.resolveNode", { nodeId });
  const objectId = resolved.object?.objectId;
  if (!objectId) throw new Error("Could not resolve node to JS object");
  return objectId;
}

/** Call a function on a DOM node and return the value */
async function callOnNode(client: CDPClient, nodeId: number, fn: string): Promise<any> {
  const objectId = await getRemoteObject(client, nodeId);
  const r = await client.call("Runtime.callFunctionOn", { objectId, functionDeclaration: fn, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? "callFunctionOn failed");
  return r.result?.value;
}

async function findElement(client: CDPClient, strategy: string, value: string): Promise<{ objectId: string; backendNodeId: number; nodeId: number }> {
  let expression: string;
  const escaped = value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  switch (strategy) {
    case "testid":
      expression = `document.querySelector('[data-testid="${escaped}"], [data-test-id="${escaped}"]')`;
      break;
    case "placeholder":
      expression = `Array.from(document.querySelectorAll('input,textarea')).find(el => (el.placeholder||'').includes('${escaped}'))`;
      break;
    case "label": {
      expression = `(() => {
        const labels = Array.from(document.querySelectorAll('label'));
        const label = labels.find(l => l.textContent?.includes('${escaped}'));
        if (!label) return null;
        if (label.htmlFor) return document.getElementById(label.htmlFor);
        return label.querySelector('input,textarea,select,button') || label;
      })()`;
      break;
    }
    case "text":
      expression = `(() => {
        const priority = 'button,a,[role="button"],[role="link"],[role="menuitem"],input[type="submit"],input[type="button"]';
        for (const el of document.querySelectorAll(priority)) {
          if ((el.textContent||'').trim().includes('${escaped}')) return el;
        }
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
        let node;
        while (node = walker.nextNode()) {
          if ((node.textContent||'').trim().includes('${escaped}') && node.children.length === 0) return node;
        }
        return null;
      })()`;
      break;
    case "role":
      expression = `document.querySelector('[role="${escaped}"]') || document.querySelector('${escaped}')`;
      break;
    case "alt":
      expression = `document.querySelector('[alt="${escaped}"]')`;
      break;
    case "title":
      expression = `document.querySelector('[title="${escaped}"]')`;
      break;
    default:
      throw new Error(`Unknown find strategy: ${strategy}. Use: text, label, role, placeholder, alt, title, testid`);
  }

  const r = await client.call("Runtime.evaluate", { expression, returnByValue: false, awaitPromise: false });
  if (!r.result?.objectId) throw new Error(`No element found with ${strategy}="${value}"`);
  const desc = await client.call("DOM.describeNode", { objectId: r.result.objectId });
  if (!desc.node?.backendNodeId) throw new Error(`Could not resolve element found by ${strategy}="${value}"`);
  const nodeId = await resolveBackendNode(client, desc.node.backendNodeId);
  return { objectId: r.result.objectId, backendNodeId: desc.node.backendNodeId, nodeId };
}

async function collectCursorInteractiveIds(client: CDPClient): Promise<Array<{ backendNodeId: number; tag: string; text: string }>> {
  // Collect elements in a single batch using Runtime.evaluate returning remote objects
  const countResult = await evalJS(client, `(() => {
    const seen = new Set();
    const result = [];
    document.querySelectorAll('[onclick], [role="button"], [tabindex]:not([tabindex="-1"]), a[href], button, summary, label').forEach(el => {
      if (!seen.has(el)) { seen.add(el); result.push(el); }
    });
    const divs = document.querySelectorAll('div, span, li, img, svg, td, tr');
    let c = 0;
    for (const el of divs) {
      if (c >= 300) break;
      if (window.getComputedStyle(el).cursor === 'pointer' && !seen.has(el)) { seen.add(el); result.push(el); }
      c++;
    }
    window.__quiverCtlCursorEls = result;
    return result.length;
  })()`);

  const count = typeof countResult === "number" ? countResult : 0;
  const results: Array<{ backendNodeId: number; tag: string; text: string }> = [];

  for (let i = 0; i < count; i++) {
    try {
      const objResult = await client.call("Runtime.evaluate", {
        expression: `window.__quiverCtlCursorEls[${i}]`,
        returnByValue: false,
      });
      if (!objResult.result?.objectId) continue;
      const desc = await client.call("DOM.describeNode", { objectId: objResult.result.objectId });
      const tagResult = await client.call("Runtime.callFunctionOn", {
        objectId: objResult.result.objectId,
        functionDeclaration: "function() { return JSON.stringify({ tag: this.tagName?.toLowerCase() || '', text: (this.textContent || '').trim().slice(0, 80) }); }",
        returnByValue: true,
      });
      const info = JSON.parse(tagResult.result?.value || '{"tag":"","text":""}');
      if (desc.node?.backendNodeId) {
        results.push({ backendNodeId: desc.node.backendNodeId, tag: info.tag, text: info.text });
      }
    } catch { /* skip */ }
  }

  // Cleanup
  await evalJS(client, "delete window.__quiverCtlCursorEls").catch(() => {});
  return results;
}

// ── Console/error log hooks ───────────────────────────────────────────────────

async function ensureLogHooks(client: CDPClient): Promise<void> {
  const alreadyInstalled = await evalJS(client, "!!window.__quiverCtlLogs");
  if (alreadyInstalled) return;
  await evalJS(client, `(() => {
    window.__quiverCtlLogs = { console: [], errors: [] };
    const MAX = 500;
    const origLog = console.log, origWarn = console.warn, origError = console.error, origInfo = console.info, origDebug = console.debug;
    function capture(level, args) {
      const entry = { level, ts: Date.now(), args: args.map(a => { try { return typeof a === 'object' ? JSON.stringify(a) : String(a); } catch { return String(a); } }) };
      window.__quiverCtlLogs.console.push(entry);
      if (window.__quiverCtlLogs.console.length > MAX) window.__quiverCtlLogs.console.shift();
    }
    console.log = function(...a) { capture('log', a); origLog.apply(console, a); };
    console.warn = function(...a) { capture('warn', a); origWarn.apply(console, a); };
    console.error = function(...a) { capture('error', a); origError.apply(console, a); };
    console.info = function(...a) { capture('info', a); origInfo.apply(console, a); };
    console.debug = function(...a) { capture('debug', a); origDebug.apply(console, a); };
    window.addEventListener('error', function(e) {
      window.__quiverCtlLogs.errors.push({ ts: Date.now(), message: e.message, filename: e.filename, lineno: e.lineno, colno: e.colno, stack: e.error?.stack });
      if (window.__quiverCtlLogs.errors.length > MAX) window.__quiverCtlLogs.errors.shift();
    });
    window.addEventListener('unhandledrejection', function(e) {
      window.__quiverCtlLogs.errors.push({ ts: Date.now(), message: 'Unhandled rejection: ' + String(e.reason), stack: e.reason?.stack });
      if (window.__quiverCtlLogs.errors.length > MAX) window.__quiverCtlLogs.errors.shift();
    });
  })()`);
}

// ── Snapshot with refs ────────────────────────────────────────────────────────

const INTERACTIVE_ROLES = new Set([
  "button", "textbox", "link", "combobox", "checkbox", "radio",
  "menuitem", "menuitemcheckbox", "menuitemradio", "option",
  "searchbox", "slider", "spinbutton", "switch", "tab", "treeitem", "listbox",
]);

function buildSnapshotInteractive(nodes: AXNode[], targetKey: string, cursorExtras?: Array<{ backendNodeId: number; tag: string; text: string }>): { text: string; count: number } {
  const lines: string[] = [];
  const refs: Record<string, RefRecord> = {};
  let counter = 0;

  for (const node of nodes) {
    const role = node.role?.value;
    if (!role || !INTERACTIVE_ROLES.has(role)) continue;
    if (node.ignored || node.backendDOMNodeId == null) continue;

    counter++;
    const refKey = `@e${counter}`;
    const name = node.name?.value ?? "";
    const disabled = node.properties?.find((p) => p.name === "disabled")?.value?.value;
    const checked = node.properties?.find((p) => p.name === "checked")?.value?.value;
    const value = node.properties?.find((p) => p.name === "value")?.value?.value;

    refs[refKey] = { backendDOMNodeId: node.backendDOMNodeId, role, name };

    let line = `${refKey} ${role}`;
    if (name) line += ` "${name}"`;
    if (value && typeof value === "string" && value.length > 0) line += ` value="${value}"`;
    if (checked === "true" || checked === true) line += " [checked]";
    if (disabled) line += " [disabled]";
    lines.push(line);
  }

  // Add cursor-interactive elements not already captured
  if (cursorExtras) {
    const existingBackendIds = new Set(Object.values(refs).map(r => r.backendDOMNodeId));
    for (const extra of cursorExtras) {
      if (existingBackendIds.has(extra.backendNodeId)) continue;
      counter++;
      const refKey = `@e${counter}`;
      refs[refKey] = { backendDOMNodeId: extra.backendNodeId, role: extra.tag, name: extra.text };
      let line = `${refKey} ${extra.tag}`;
      if (extra.text) line += ` "${extra.text}"`;
      line += " [cursor]";
      lines.push(line);
    }
  }

  const store = loadRefs();
  store.targets[targetKey] = { next: counter, refs };
  saveRefs(store);

  // Save snapshot text for diff
  const snapshots: Record<string, string> = (() => { try { return JSON.parse(fs.readFileSync(SNAPSHOT_PATH, "utf-8")); } catch { return {}; } })();
  snapshots[targetKey] = lines.join("\n");
  fs.writeFileSync(SNAPSHOT_PATH, JSON.stringify(snapshots, null, 2));

  return { text: lines.length ? lines.join("\n") : "(no interactive elements found)", count: counter };
}

function buildSnapshotFull(nodes: AXNode[], maxDepth?: number): string {
  const lines: string[] = [];
  const idMap = new Map<string, AXNode>();
  for (const n of nodes) idMap.set(n.nodeId, n);

  function walk(nodeId: string, depth: number) {
    const node = idMap.get(nodeId);
    if (!node) return;
    const role = node.role?.value;
    // Transparent nodes: ignored, none, generic — skip rendering, recurse at same depth
    if (node.ignored || !role || role === "none" || role === "generic") {
      for (const cid of node.childIds ?? []) walk(cid, depth);
      return;
    }
    if (maxDepth != null && depth > maxDepth) return;
    const name = node.name?.value ?? "";
    const indent = "  ".repeat(depth);
    lines.push(`${indent}- ${role}${name ? ` "${name}"` : ""}`);
    for (const cid of node.childIds ?? []) walk(cid, depth + 1);
  }

  if (nodes.length > 0) walk(nodes[0].nodeId, 0);
  return lines.length ? lines.join("\n") : "(empty accessibility tree)";
}

function buildSnapshotCompact(nodes: AXNode[]): string {
  const lines: string[] = [];
  for (const node of nodes) {
    const role = node.role?.value;
    if (!role || role === "none" || role === "generic" || node.ignored) continue;
    const name = node.name?.value ?? "";
    lines.push(`${role}${name ? ` "${name}"` : ""}`);
  }
  return lines.length ? lines.join("\n") : "(empty)";
}

// ── Annotated screenshot ──────────────────────────────────────────────────────

async function annotatedScreenshot(client: CDPClient, targetKey: string, outPath: string): Promise<string> {
  const nodes = await getFullAXTree(client);
  const { count } = buildSnapshotInteractive(nodes, targetKey);

  const store = loadRefs();
  const targetRefs = store.targets[targetKey];
  if (!targetRefs || count === 0) {
    const buf = await captureScreenshot(client);
    await Bun.write(outPath, buf);
    return `✓ Screenshot saved to ${outPath} (no interactive elements to annotate)`;
  }

  const annotations: Array<{ num: number; x: number; y: number; width: number; height: number; role: string; name: string }> = [];
  for (const [key, ref] of Object.entries(targetRefs.refs)) {
    const num = parseInt(key.replace("@e", ""), 10);
    try {
      const nodeId = await resolveBackendNode(client, ref.backendDOMNodeId);
      await scrollIntoView(client, nodeId);
      const rect = await getBoxRect(client, nodeId);
      annotations.push({ num, ...rect, role: ref.role, name: ref.name });
    } catch { /* skip */ }
  }

  const overlayData = JSON.stringify(annotations);
  await evalJS(client, `(() => {
    document.getElementById('__quiver_ctl_overlay')?.remove();
    var c = document.createElement('div');
    c.id = '__quiver_ctl_overlay';
    c.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483647;';
    var items = ${overlayData};
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      var b = document.createElement('div');
      b.style.cssText = 'position:fixed;left:'+it.x+'px;top:'+it.y+'px;width:'+it.width+'px;height:'+it.height+'px;border:2px solid rgba(255,0,0,0.8);box-sizing:border-box;pointer-events:none;';
      var l = document.createElement('div');
      l.textContent = String(it.num);
      var labelTop = it.y < 14 ? '2px' : '-14px';
      l.style.cssText = 'position:absolute;top:'+labelTop+';left:-2px;background:rgba(255,0,0,0.9);color:#fff;font:bold 11px/14px monospace;padding:0 4px;border-radius:2px;white-space:nowrap;';
      b.appendChild(l); c.appendChild(b);
    }
    document.documentElement.appendChild(c);
  })()`);

  try {
    const buf = await captureScreenshot(client);
    await Bun.write(outPath, buf);
  } finally {
    await evalJS(client, `document.getElementById('__quiver_ctl_overlay')?.remove()`).catch(() => {});
  }

  const legend = annotations.map((a) => `  [${a.num}] @e${a.num} ${a.role}${a.name ? ` "${a.name}"` : ""}`).join("\n");
  return `✓ Annotated screenshot saved to ${outPath}\n${legend}`;
}

// ── CLI parsing ───────────────────────────────────────────────────────────────

function parseCliArgs(argv: string[]): { target: string | null; cmd: string; args: string[]; flags: Record<string, string | boolean> } {
  const raw = argv.slice(2);
  let target: string | null = null;
  const flags: Record<string, string | boolean> = {};
  const positional: string[] = [];

  for (let i = 0; i < raw.length; i++) {
    const a = raw[i];
    if (a === "--target" && i + 1 < raw.length) { target = raw[++i]; }
    else if (a === "--annotate") { flags.annotate = true; }
    else if (a === "--full")     { flags.full = true; }
    else if (a === "--text" && i + 1 < raw.length) { flags.text = raw[++i]; }
    else if (a === "--fn" && i + 1 < raw.length)   { flags.fn = raw[++i]; }
    else if (a === "--url" && i + 1 < raw.length)  { flags.url = raw[++i]; }
    else if (a === "-i")         { flags.interactive = true; }
    else if (a === "-c")         { flags.compact = true; }
    else if (a === "-d" && i + 1 < raw.length) { flags.depth = raw[++i]; }
    else if (a === "-s" && i + 1 < raw.length) { flags.scope = raw[++i]; }
    else if (a === "-C")         { flags.cursor = true; }
    else if (a === "--stdin")    { flags.stdin = true; }
    else if (a === "-b")         { flags.base64 = true; }
    else if (a === "--clear")    { flags.clear = true; }
    else { positional.push(a); }
  }

  return { target, cmd: positional[0] ?? "help", args: positional.slice(1), flags };
}

// ── Resolve target to wsUrl ───────────────────────────────────────────────────

async function resolveTarget(targetSpec: string | null, cmdNeedsShell: boolean): Promise<{ wsUrl: string; targetKey: string }> {
  const targets = await getTargets();
  if (cmdNeedsShell || targetSpec === "shell") {
    const shell = findShell(targets);
    if (!shell) die("Shell target not found. Is the app running with QUIVER_DEBUG=1?");
    return { wsUrl: shell.webSocketDebuggerUrl, targetKey: "shell" };
  }
  if (targetSpec) {
    const tab = findTab(targets, targetSpec);
    if (!tab) {
      const available = targets.filter((t) => t.type === "page" && t.url.includes("/tabview/")).map((t) => t.url.match(/tabId=([^&]+)/)?.[1] ?? t.title);
      die(`Tab target not found for "${targetSpec}". Available: ${available.join(", ") || "none"}`);
    }
    return { wsUrl: tab.webSocketDebuggerUrl, targetKey: getTargetKey(targetSpec) };
  }
  const shell = findShell(targets);
  if (!shell) die("Shell target not found. Is the app running with QUIVER_DEBUG=1?");
  const activeId = await getActiveTabId(shell.webSocketDebuggerUrl);
  if (!activeId) die("No active tab found. Create one: bun run ctl new-tab");
  const tab = findTab(targets, activeId);
  if (!tab) die(`Active tab "${activeId}" target not found in CDP targets.`);
  return { wsUrl: tab.webSocketDebuggerUrl, targetKey: getTargetKey(activeId) };
}

// ── Command handlers ──────────────────────────────────────────────────────────

const { target, cmd, args, flags } = parseCliArgs(process.argv);

if (cmd === "help" || !cmd) {
  console.log(`quiver-ctl — CDP controller for Quiver Electrobun app

Target selection:
  --target shell            Target the shell (mainview)
  --target tab-1            Target a specific tab
  (default)                 Target the active tab

Discovery:
  list                            List CDP page targets
  tabs                            List tabs via shell automation bridge

Snapshot:
  snapshot [-i]                   Accessibility snapshot (-i = interactive refs)

Interaction:
  click @e1                       Click element
  dblclick @e1                    Double-click element
  focus @e1                       Focus element
  hover @e1                       Hover over element
  fill @e2 "text"                 Clear + set value (React-compatible)
  type "text"                     Type at current focus
  press Enter                     Press key (Enter, Tab, Escape, Space, ArrowUp, ...)
  press Control+a                 Key combination (Control, Shift, Meta, Alt + key)
  check @e1                       Check checkbox
  uncheck @e1                     Uncheck checkbox
  select @e1 "value"              Select dropdown option
  scroll up|down [amount]         Scroll page (default: 400px)
  scrollintoview @e1              Scroll element into view
  drag @e1 @e2                    Drag element to another element

Mouse:
  mouse move <x> <y>             Move mouse to coordinates
  mouse down [left|right|middle] Press mouse button
  mouse up [left|right|middle]   Release mouse button
  mouse wheel <deltaY>           Mouse wheel scroll

Keyboard:
  keyboard type "text"            Type with key events
  keyboard inserttext "text"      Insert text without key events
  keydown Shift                   Hold key down
  keyup Shift                     Release key

Get information:
  get text @e1                    Element text content
  get html @e1                    Element innerHTML
  get value @e1                   Input value
  get attr @e1 <name>             Element attribute
  get url                         Page URL
  get title                       Page title
  get count "<selector>"          Count matching elements
  get box @e1                     Element bounding box
  get styles @e1                  Computed styles (font, color, bg, size)

Check state:
  is visible @e1                  Check if element is visible
  is enabled @e1                  Check if element is enabled
  is checked @e1                  Check if checkbox/radio is checked

Screenshot:
  screenshot [path] [--annotate] [--full]

JavaScript:
  eval <js>                       Evaluate JavaScript
  eval -b <base64>                Evaluate base64-encoded JS
  eval --stdin                    Read JS from stdin
  shell eval <js>                 Eval in shell webview

Wait:
  wait <ms>                       Wait milliseconds
  wait <selector>                 Wait for CSS selector
  wait --text "text"              Wait for text content
  wait --fn "expression"          Wait for JS condition

Compare:
  diff snapshot                   Compare current vs last snapshot

Debug:
  highlight @e1                   Highlight element with red border

Dialogs:
  dialog accept [text]            Accept JS dialog (alert/confirm/prompt)
  dialog dismiss                  Dismiss JS dialog

Semantic locators:
  find text "Sign In" click       Find by text content and act
  find label "Email" fill "text"  Find by label and fill
  find role button click          Find by ARIA role
  find placeholder "Search" fill "q"  Find by placeholder
  find testid "submit" click      Find by data-testid
  find alt "Logo" click           Find by alt text
  find title "Close" click        Find by title attribute

Tab management:
  new-tab                         Create a new tab
  tab switch <tabId>              Switch to a specific tab
  tab close <tabId>              Close a specific tab
  open-repo <path> [tabId]        Open a repo in a tab

Console/errors:
  console                         View captured console messages
  console --clear                 Clear console buffer
  errors                          View captured errors
  errors --clear                  Clear error buffer`);
  process.exit(0);
}

// ── list ──────────────────────────────────────────────────────────────────────

if (cmd === "list") {
  const targets = await getTargets();
  for (const t of targets.filter((t) => t.type === "page")) {
    const kind = t.url.includes("/mainview/") ? "shell" : t.url.includes("/tabview/") ? "tab" : "other";
    console.log(`[${kind}] ${t.title} — ${t.url}`);
  }
  process.exit(0);
}

// ── tabs ──────────────────────────────────────────────────────────────────────

if (cmd === "tabs") {
  const { wsUrl } = await resolveTarget(null, true);
  const client = await CDPClient.connect(wsUrl);
  try {
    const result = await evalJS(client, "JSON.stringify(window.__quiverAutomation?.listTabs())");
    const data = JSON.parse(result);
    if (!data?.tabs?.length) console.log("No tabs open.");
    else for (const tab of data.tabs) console.log(`${tab.id}: ${tab.label}${tab.id === data.activeTabId ? " (active)" : ""}`);
  } finally { await client.close(); }
  process.exit(0);
}

// ── new-tab ───────────────────────────────────────────────────────────────────

if (cmd === "new-tab") {
  const { wsUrl } = await resolveTarget(null, true);
  const client = await CDPClient.connect(wsUrl);
  try {
    const result = await evalJS(client, "window.__quiverAutomation.newTabAndActivate().then(r => JSON.stringify(r))");
    console.log(`✓ Created tab: ${JSON.parse(result).tabId}`);
  } finally { await client.close(); }
  process.exit(0);
}

// ── shell eval ────────────────────────────────────────────────────────────────

if (cmd === "shell" && args[0] === "eval") {
  const js = args.slice(1).join(" ");
  if (!js) die("Usage: quiver-ctl shell eval <js>");
  const { wsUrl } = await resolveTarget(null, true);
  const client = await CDPClient.connect(wsUrl);
  try { console.log(await evalJS(client, js)); } finally { await client.close(); }
  process.exit(0);
}

// ── open-repo ─────────────────────────────────────────────────────────────────

if (cmd === "open-repo") {
  const repoPath = args[0];
  if (!repoPath) die("Usage: quiver-ctl open-repo <path> [tabId]");
  const targets = await getTargets();
  const shell = findShell(targets);
  if (!shell) die("Shell target not found");
  let tabId = args[1];
  if (!tabId) {
    tabId = (await getActiveTabId(shell.webSocketDebuggerUrl)) ?? "";
    if (!tabId) die("No active tab found. Create one first: bun run ctl new-tab");
  }
  const tab = findTab(targets, tabId);
  if (!tab) die(`Tab target not found for tabId=${tabId}`);
  const client = await CDPClient.connect(tab.webSocketDebuggerUrl);
  try {
    const escaped = repoPath.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
    const result = await evalJS(client, `(async () => {
      const input = document.querySelector('input[placeholder*="path/to/repo"]');
      if (!input) return JSON.stringify({ error: 'Input not found' });
      const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      nativeSetter.call(input, '${escaped}');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise(r => setTimeout(r, 100));
      const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent?.trim() === 'Open');
      if (!btn) return JSON.stringify({ error: 'Open button not found' });
      if (btn.disabled) return JSON.stringify({ error: 'Open button is disabled' });
      btn.click();
      return JSON.stringify({ ok: true, tabId: '${tabId}' });
    })()`);
    const data = JSON.parse(result);
    if (data.error) die(`✗ ${data.error}`);
    console.log(`✓ Opening repo in ${tabId}...`);
    await sleep(2000);
    const buf = await captureScreenshot(client);
    await Bun.write("/tmp/quiver-open-repo.png", buf);
    console.log(`✓ Screenshot saved to /tmp/quiver-open-repo.png`);
  } finally { await client.close(); }
  process.exit(0);
}

// ── tab switch|close ──────────────────────────────────────────────────────

if (cmd === "tab") {
  const sub = args[0];
  if (sub === "switch") {
    const tabId = args[1];
    if (!tabId) die("Usage: agent-electrobun tab switch <tabId>");
    const { wsUrl } = await resolveTarget(null, true);
    const client = await CDPClient.connect(wsUrl);
    try {
      const result = await evalJS(client, `(async () => {
        if (!window.__quiverAutomation?.activate) return JSON.stringify({ error: 'activate not available on automation bridge' });
        try { window.__quiverAutomation.activate('${tabId.replace(/'/g, "\\'")}'); return JSON.stringify({ ok: true }); }
        catch(e) { return JSON.stringify({ error: String(e) }); }
      })()`);
      const data = JSON.parse(result);
      if (data.error) die(`✗ ${data.error}`);
      console.log(`✓ Switched to tab ${tabId}`);
    } finally { await client.close(); }
  } else if (sub === "close") {
    const tabId = args[1];
    if (!tabId) die("Usage: agent-electrobun tab close <tabId>");
    const { wsUrl } = await resolveTarget(null, true);
    const client = await CDPClient.connect(wsUrl);
    try {
      const result = await evalJS(client, `(async () => {
        if (!window.__quiverAutomation?.closeTab) return JSON.stringify({ error: 'closeTab not available on automation bridge' });
        try { window.__quiverAutomation.closeTab('${tabId.replace(/'/g, "\\'")}'); return JSON.stringify({ ok: true }); }
        catch(e) { return JSON.stringify({ error: String(e) }); }
      })()`);
      const data = JSON.parse(result);
      if (data.error) die(`✗ ${data.error}`);
      console.log(`✓ Closed tab ${tabId}`);
    } finally { await client.close(); }
  } else {
    die("Usage: agent-electrobun tab switch|close <tabId>");
  }
  process.exit(0);
}

// ── All other commands need a resolved target ─────────────────────────────────

const shellCmds = new Set(["list", "tabs", "new-tab", "tab"]);
const needsShell = cmd === "shell" || shellCmds.has(cmd);
const { wsUrl, targetKey } = await resolveTarget(target, needsShell);
const client = await CDPClient.connect(wsUrl);

try {
  // ── snapshot ────────────────────────────────────────────────────────────
  if (cmd === "snapshot") {
    let nodes: AXNode[];
    // Determine scope
    if (args[0]?.startsWith("@")) {
      const ref = resolveRef(args[0], targetKey);
      nodes = await getScopedAXTree(client, ref.backendDOMNodeId);
    } else if (flags.scope) {
      const backendId = await resolveSelector(client, flags.scope as string);
      nodes = await getScopedAXTree(client, backendId);
    } else {
      nodes = await getFullAXTree(client);
    }

    const maxDepth = flags.depth ? parseInt(flags.depth as string, 10) : undefined;

    if (flags.interactive) {
      let cursorExtras: Array<{ backendNodeId: number; tag: string; text: string }> | undefined;
      if (flags.cursor) {
        cursorExtras = await collectCursorInteractiveIds(client);
      }
      const { text, count } = buildSnapshotInteractive(nodes, targetKey, cursorExtras);
      console.log(text);
      console.error(`(${count} interactive elements, refs saved for target "${targetKey}")`);
    } else if (flags.compact) {
      console.log(buildSnapshotCompact(nodes));
    } else {
      console.log(buildSnapshotFull(nodes, maxDepth));
    }
  }

  // ── click @ref ──────────────────────────────────────────────────────────
  else if (cmd === "click") {
    if (!args[0]) die("Usage: quiver-ctl click @e1");
    const { nodeId, ref } = await prepareRef(client, args[0], targetKey);
    const { x, y } = await getBoxCenter(client, nodeId);
    await clickAt(client, x, y);
    console.log(`✓ Clicked ${args[0]} (${ref.role}${ref.name ? ` "${ref.name}"` : ""}) at (${Math.round(x)}, ${Math.round(y)})`);
  }

  // ── dblclick @ref ───────────────────────────────────────────────────────
  else if (cmd === "dblclick") {
    if (!args[0]) die("Usage: quiver-ctl dblclick @e1");
    const { nodeId, ref } = await prepareRef(client, args[0], targetKey);
    const { x, y } = await getBoxCenter(client, nodeId);
    await clickAt(client, x, y, 2);
    console.log(`✓ Double-clicked ${args[0]} (${ref.role}${ref.name ? ` "${ref.name}"` : ""})`);
  }

  // ── drag @e1 @e2 ───────────────────────────────────────────────────────
  else if (cmd === "drag") {
    if (!args[0] || !args[1]) die("Usage: agent-electrobun drag @e1 @e2");
    const { nodeId: srcNodeId, ref: srcRef } = await prepareRef(client, args[0], targetKey);
    const src = await getBoxCenter(client, srcNodeId);
    const { nodeId: dstNodeId, ref: dstRef } = await prepareRef(client, args[1], targetKey);
    const dst = await getBoxCenter(client, dstNodeId);
    // Move to start, press, interpolate move steps, release
    await client.call("Input.dispatchMouseEvent", { type: "mouseMoved", x: src.x, y: src.y });
    await client.call("Input.dispatchMouseEvent", { type: "mousePressed", x: src.x, y: src.y, button: "left", clickCount: 1 });
    await sleep(50);
    const steps = 10;
    for (let i = 1; i <= steps; i++) {
      const x = src.x + (dst.x - src.x) * (i / steps);
      const y = src.y + (dst.y - src.y) * (i / steps);
      await client.call("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
      await sleep(10);
    }
    await client.call("Input.dispatchMouseEvent", { type: "mouseReleased", x: dst.x, y: dst.y, button: "left", clickCount: 1 });
    console.log(`✓ Dragged ${args[0]} (${srcRef.role}${srcRef.name ? ` "${srcRef.name}"` : ""}) → ${args[1]} (${dstRef.role}${dstRef.name ? ` "${dstRef.name}"` : ""})`);
  }

  // ── focus @ref ──────────────────────────────────────────────────────────
  else if (cmd === "focus") {
    if (!args[0]) die("Usage: quiver-ctl focus @e1");
    const { nodeId, ref } = await prepareRef(client, args[0], targetKey);
    await focusNode(client, nodeId);
    console.log(`✓ Focused ${args[0]} (${ref.role}${ref.name ? ` "${ref.name}"` : ""})`);
  }

  // ── hover @ref ──────────────────────────────────────────────────────────
  else if (cmd === "hover") {
    if (!args[0]) die("Usage: quiver-ctl hover @e1");
    const { nodeId, ref } = await prepareRef(client, args[0], targetKey);
    const { x, y } = await getBoxCenter(client, nodeId);
    await client.call("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
    console.log(`✓ Hovered ${args[0]} (${ref.role}${ref.name ? ` "${ref.name}"` : ""}) at (${Math.round(x)}, ${Math.round(y)})`);
  }

  // ── fill @ref "text" ────────────────────────────────────────────────────
  else if (cmd === "fill") {
    const refArg = args[0];
    const text = args.slice(1).join(" ");
    if (!refArg || !text) die('Usage: quiver-ctl fill @e1 "text"');
    const { nodeId, ref } = await prepareRef(client, refArg, targetKey);
    await focusNode(client, nodeId);
    const objectId = await getRemoteObject(client, nodeId);
    const escaped = text.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
    await client.call("Runtime.callFunctionOn", {
      objectId,
      functionDeclaration: `function() {
        var text = '${escaped}';
        var nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
          || Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
        if (nativeSetter) { nativeSetter.call(this, text); }
        else { this.value = text; }
        this.dispatchEvent(new Event('input', { bubbles: true }));
        this.dispatchEvent(new Event('change', { bubbles: true }));
      }`,
      returnByValue: true,
    });
    console.log(`✓ Filled ${refArg} (${ref.role}${ref.name ? ` "${ref.name}"` : ""}) with "${text}"`);
  }

  // ── type "text" ─────────────────────────────────────────────────────────
  else if (cmd === "type") {
    const text = args.join(" ");
    if (!text) die('Usage: quiver-ctl type "text"');
    await client.call("Input.insertText", { text });
    console.log(`✓ Typed "${text}"`);
  }

  // ── press <key|combo> ───────────────────────────────────────────────────
  else if (cmd === "press") {
    const combo = args[0];
    if (!combo) die("Usage: quiver-ctl press Enter | press Control+a");
    const { keyDef, modifiers } = parseKeyCombo(combo);
    const base = { key: keyDef.key, code: keyDef.code, windowsVirtualKeyCode: keyDef.keyCode, nativeVirtualKeyCode: keyDef.keyCode, modifiers };
    await client.call("Input.dispatchKeyEvent", { ...base, type: "keyDown", ...(keyDef.text ? { text: keyDef.text } : {}) });
    if (keyDef.text) await client.call("Input.dispatchKeyEvent", { ...base, type: "char", text: keyDef.text });
    await client.call("Input.dispatchKeyEvent", { ...base, type: "keyUp" });
    console.log(`✓ Pressed ${combo}`);
  }

  // ── keydown <key|combo> ─────────────────────────────────────────────────
  else if (cmd === "keydown") {
    const combo = args[0];
    if (!combo) die("Usage: agent-electrobun keydown Shift");
    const { keyDef, modifiers } = parseKeyCombo(combo);
    await client.call("Input.dispatchKeyEvent", {
      type: "keyDown", key: keyDef.key, code: keyDef.code,
      windowsVirtualKeyCode: keyDef.keyCode, nativeVirtualKeyCode: keyDef.keyCode,
      modifiers, ...(keyDef.text ? { text: keyDef.text } : {}),
    });
    console.log(`✓ Key down: ${combo}`);
  }

  // ── keyup <key|combo> ───────────────────────────────────────────────────
  else if (cmd === "keyup") {
    const combo = args[0];
    if (!combo) die("Usage: agent-electrobun keyup Shift");
    const { keyDef, modifiers } = parseKeyCombo(combo);
    await client.call("Input.dispatchKeyEvent", {
      type: "keyUp", key: keyDef.key, code: keyDef.code,
      windowsVirtualKeyCode: keyDef.keyCode, nativeVirtualKeyCode: keyDef.keyCode,
      modifiers,
    });
    console.log(`✓ Key up: ${combo}`);
  }

  // ── check / uncheck @ref ────────────────────────────────────────────────
  else if (cmd === "check" || cmd === "uncheck") {
    if (!args[0]) die(`Usage: quiver-ctl ${cmd} @e1`);
    const { nodeId, ref } = await prepareRef(client, args[0], targetKey);
    const isChecked = await callOnNode(client, nodeId, "function() { return this.checked; }");
    const want = cmd === "check";
    if (isChecked !== want) {
      const { x, y } = await getBoxCenter(client, nodeId);
      await clickAt(client, x, y);
    }
    console.log(`✓ ${cmd === "check" ? "Checked" : "Unchecked"} ${args[0]} (${ref.role}${ref.name ? ` "${ref.name}"` : ""})`);
  }

  // ── select @ref "value" ─────────────────────────────────────────────────
  else if (cmd === "select") {
    if (!args[0] || !args[1]) die('Usage: quiver-ctl select @e1 "value"');
    const { nodeId, ref } = await prepareRef(client, args[0], targetKey);
    const value = args.slice(1).join(" ");
    const escaped = value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
    await callOnNode(client, nodeId, `function() {
      var val = '${escaped}';
      for (var i = 0; i < this.options.length; i++) {
        if (this.options[i].value === val || this.options[i].textContent.trim() === val) {
          this.selectedIndex = i;
          this.dispatchEvent(new Event('change', { bubbles: true }));
          return true;
        }
      }
      return false;
    }`);
    console.log(`✓ Selected "${value}" in ${args[0]} (${ref.role}${ref.name ? ` "${ref.name}"` : ""})`);
  }

  // ── scroll up|down [amount] ─────────────────────────────────────────────
  else if (cmd === "scroll") {
    const dir = args[0];
    if (dir !== "up" && dir !== "down") die("Usage: quiver-ctl scroll up|down [amount]");
    const amount = parseInt(args[1] ?? "400", 10);
    const deltaY = dir === "down" ? amount : -amount;
    // Get viewport center for the wheel event target
    const vp = await client.call("Runtime.evaluate", { expression: "JSON.stringify({w:window.innerWidth,h:window.innerHeight})", returnByValue: true });
    const { w, h } = JSON.parse(vp.result?.value ?? '{"w":800,"h":600}');
    await client.call("Input.dispatchMouseEvent", { type: "mouseWheel", x: Math.round(w / 2), y: Math.round(h / 2), deltaX: 0, deltaY });
    console.log(`✓ Scrolled ${dir} ${amount}px`);
  }

  // ── scrollintoview @ref ─────────────────────────────────────────────────
  else if (cmd === "scrollintoview" || cmd === "scrollinto") {
    if (!args[0]) die("Usage: quiver-ctl scrollintoview @e1");
    const { nodeId, ref } = await prepareRef(client, args[0], targetKey);
    await scrollIntoView(client, nodeId);
    console.log(`✓ Scrolled ${args[0]} (${ref.role}${ref.name ? ` "${ref.name}"` : ""}) into view`);
  }

  // ── mouse move|down|up|wheel ────────────────────────────────────────────
  else if (cmd === "mouse") {
    const sub = args[0];
    if (sub === "move") {
      const x = parseFloat(args[1]), y = parseFloat(args[2]);
      if (isNaN(x) || isNaN(y)) die("Usage: quiver-ctl mouse move <x> <y>");
      await client.call("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
      console.log(`✓ Mouse moved to (${x}, ${y})`);
    } else if (sub === "down") {
      const button = args[1] ?? "left";
      await client.call("Input.dispatchMouseEvent", { type: "mousePressed", x: 0, y: 0, button, clickCount: 1 });
      console.log(`✓ Mouse ${button} down`);
    } else if (sub === "up") {
      const button = args[1] ?? "left";
      await client.call("Input.dispatchMouseEvent", { type: "mouseReleased", x: 0, y: 0, button, clickCount: 1 });
      console.log(`✓ Mouse ${button} up`);
    } else if (sub === "wheel") {
      const deltaY = parseFloat(args[1] ?? "100");
      await client.call("Input.dispatchMouseEvent", { type: "mouseWheel", x: 0, y: 0, deltaX: 0, deltaY });
      console.log(`✓ Mouse wheel ${deltaY}`);
    } else {
      die("Usage: quiver-ctl mouse move|down|up|wheel");
    }
  }

  // ── keyboard type|inserttext ────────────────────────────────────────────
  else if (cmd === "keyboard") {
    const sub = args[0];
    const text = args.slice(1).join(" ");
    if (!text) die('Usage: quiver-ctl keyboard type|inserttext "text"');
    if (sub === "type") {
      // Type char by char with key events
      for (const ch of text) {
        const code = ch === " " ? "Space" : `Key${ch.toUpperCase()}`;
        await client.call("Input.dispatchKeyEvent", { type: "keyDown", key: ch, code, text: ch });
        await client.call("Input.dispatchKeyEvent", { type: "char", key: ch, code, text: ch });
        await client.call("Input.dispatchKeyEvent", { type: "keyUp", key: ch, code });
      }
      console.log(`✓ Keyboard typed "${text}"`);
    } else if (sub === "inserttext") {
      await client.call("Input.insertText", { text });
      console.log(`✓ Inserted text "${text}"`);
    } else {
      die("Usage: quiver-ctl keyboard type|inserttext");
    }
  }

  // ── screenshot [path] [--annotate] [--full] ─────────────────────────────
  else if (cmd === "screenshot") {
    const outPath = args[0] ?? "/tmp/quiver-tab.png";
    if (flags.annotate) {
      console.log(await annotatedScreenshot(client, targetKey, outPath));
    } else {
      const buf = await captureScreenshot(client, !!flags.full);
      await Bun.write(outPath, buf);
      console.log(`✓ Screenshot saved to ${outPath}`);
    }
  }

  // ── eval <js> ───────────────────────────────────────────────────────────
  else if (cmd === "eval") {
    let js: string;
    if (flags.stdin) {
      js = await new Response(Bun.stdin.stream()).text();
    } else {
      js = args.join(" ");
    }
    if (flags.base64) {
      js = Buffer.from(js.trim(), "base64").toString("utf-8");
    }
    if (!js.trim()) die("Usage: agent-electrobun eval <expression> | eval -b <base64> | eval --stdin");
    console.log(await evalJS(client, js));
  }

  // ── console [--clear] ───────────────────────────────────────────────────
  else if (cmd === "console") {
    await ensureLogHooks(client);
    if (flags.clear) {
      await evalJS(client, "window.__quiverCtlLogs.console = []");
      console.log("✓ Console log buffer cleared");
    } else {
      const raw = await evalJS(client, "JSON.stringify(window.__quiverCtlLogs?.console || [])");
      const entries: Array<{ level: string; ts: number; args: string[] }> = JSON.parse(raw || "[]");
      if (entries.length === 0) console.log("(no console messages captured)");
      else for (const e of entries) console.log(`[${e.level}] ${e.args.join(" ")}`);
    }
  }

  // ── errors [--clear] ───────────────────────────────────────────────────
  else if (cmd === "errors") {
    await ensureLogHooks(client);
    if (flags.clear) {
      await evalJS(client, "window.__quiverCtlLogs.errors = []");
      console.log("✓ Error buffer cleared");
    } else {
      const raw = await evalJS(client, "JSON.stringify(window.__quiverCtlLogs?.errors || [])");
      const entries: Array<{ ts: number; message: string; filename?: string; lineno?: number; stack?: string }> = JSON.parse(raw || "[]");
      if (entries.length === 0) console.log("(no errors captured)");
      else for (const e of entries) {
        console.log(`[error] ${e.message}${e.filename ? ` (${e.filename}:${e.lineno})` : ""}`);
        if (e.stack) console.log(`  ${e.stack.split("\\n").slice(0, 3).join("\\n  ")}`);
      }
    }
  }

  // ── wait ────────────────────────────────────────────────────────────────
  else if (cmd === "wait") {
    const timeout = 10_000;

    if (typeof flags.text === "string") {
      // Wait for text content
      const target = flags.text;
      const start = Date.now();
      while (Date.now() - start < timeout) {
        const found = await evalJS(client, `document.body?.innerText?.includes(${JSON.stringify(target)})`);
        if (found) { console.log(`✓ Text "${target}" found`); break; }
        await sleep(200);
        if (Date.now() - start >= timeout) die(`✗ Timed out waiting for text "${target}"`);
      }
    } else if (typeof flags.url === "string") {
      const pattern = flags.url;
      const start = Date.now();
      const isGlob = pattern.includes("*");
      const regex = isGlob ? new RegExp("^" + pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$") : null;
      while (Date.now() - start < timeout) {
        const href = await evalJS(client, "window.location.href");
        if (regex ? regex.test(href) : href.includes(pattern)) { console.log(`✓ URL matched: ${href}`); break; }
        await sleep(200);
        if (Date.now() - start >= timeout) die(`✗ Timed out waiting for URL pattern "${pattern}"`);
      }
    } else if (typeof flags.fn === "string") {
      // Wait for JS condition
      const expr = flags.fn;
      const start = Date.now();
      while (Date.now() - start < timeout) {
        const result = await evalJS(client, `!!(${expr})`);
        if (result) { console.log(`✓ Condition met: ${expr}`); break; }
        await sleep(200);
        if (Date.now() - start >= timeout) die(`✗ Timed out waiting for condition: ${expr}`);
      }
    } else {
      const what = args[0];
      if (!what) die("Usage: quiver-ctl wait <ms|selector|@ref> | wait --text | wait --fn | wait --url");
      if (what.startsWith("@")) {
        const ref = resolveRef(what, targetKey);
        const start = Date.now();
        while (Date.now() - start < timeout) {
          try {
            await client.call("DOM.describeNode", { backendNodeId: ref.backendDOMNodeId });
            console.log(`✓ Ref ${what} resolved (${ref.role}${ref.name ? ` "${ref.name}"` : ""})`);
            break;
          } catch {
            await sleep(200);
            if (Date.now() - start >= timeout) die(`✗ Timed out waiting for ref ${what}`);
          }
        }
      } else {
        const ms = parseInt(what, 10);
        if (!isNaN(ms) && String(ms) === what) {
          await sleep(ms);
          console.log(`✓ Waited ${ms}ms`);
        } else {
          const start = Date.now();
          while (Date.now() - start < timeout) {
            if (await evalJS(client, `!!document.querySelector(${JSON.stringify(what)})`)) {
              console.log(`✓ Element "${what}" found`);
              break;
            }
            await sleep(200);
            if (Date.now() - start >= timeout) die(`✗ Timed out waiting for "${what}" (${timeout}ms)`);
          }
        }
      }
    }
  }

  // ── get text|html|value|attr|url|title|count|box|styles ─────────────────
  else if (cmd === "get") {
    const what = args[0];
    if (what === "url") { console.log(await evalJS(client, "window.location.href")); }
    else if (what === "title") { console.log(await evalJS(client, "document.title")); }
    else if (what === "text") {
      if (!args[1]) die("Usage: quiver-ctl get text @e1");
      const { nodeId } = await prepareRef(client, args[1], targetKey);
      console.log(await callOnNode(client, nodeId, "function() { return this.textContent || this.value || ''; }"));
    }
    else if (what === "html") {
      if (!args[1]) die("Usage: quiver-ctl get html @e1");
      const { nodeId } = await prepareRef(client, args[1], targetKey);
      console.log(await callOnNode(client, nodeId, "function() { return this.innerHTML; }"));
    }
    else if (what === "value") {
      if (!args[1]) die("Usage: quiver-ctl get value @e1");
      const { nodeId } = await prepareRef(client, args[1], targetKey);
      console.log(await callOnNode(client, nodeId, "function() { return this.value ?? ''; }"));
    }
    else if (what === "attr") {
      if (!args[1] || !args[2]) die("Usage: quiver-ctl get attr @e1 <name>");
      const { nodeId } = await prepareRef(client, args[1], targetKey);
      const attrName = args[2];
      console.log(await callOnNode(client, nodeId, `function() { return this.getAttribute('${attrName.replace(/'/g, "\\'")}'); }`));
    }
    else if (what === "count") {
      if (!args[1]) die('Usage: quiver-ctl get count ".selector"');
      console.log(await evalJS(client, `document.querySelectorAll(${JSON.stringify(args[1])}).length`));
    }
    else if (what === "box") {
      if (!args[1]) die("Usage: quiver-ctl get box @e1");
      const { nodeId } = await prepareRef(client, args[1], targetKey);
      const rect = await getBoxRect(client, nodeId);
      console.log(JSON.stringify(rect));
    }
    else if (what === "styles") {
      if (!args[1]) die("Usage: quiver-ctl get styles @e1");
      const { nodeId } = await prepareRef(client, args[1], targetKey);
      const styles = await callOnNode(client, nodeId, `function() {
        var s = window.getComputedStyle(this);
        return JSON.stringify({
          font: s.font, fontSize: s.fontSize, fontWeight: s.fontWeight, fontFamily: s.fontFamily,
          color: s.color, backgroundColor: s.backgroundColor,
          width: s.width, height: s.height,
          display: s.display, position: s.position, visibility: s.visibility, opacity: s.opacity,
          padding: s.padding, margin: s.margin, border: s.border, borderRadius: s.borderRadius,
        });
      }`);
      console.log(JSON.stringify(JSON.parse(styles), null, 2));
    }
    else { die("Usage: quiver-ctl get text|html|value|attr|url|title|count|box|styles"); }
  }

  // ── is visible|enabled|checked ──────────────────────────────────────────
  else if (cmd === "is") {
    const what = args[0];
    if (!args[1]) die(`Usage: quiver-ctl is ${what ?? "visible|enabled|checked"} @e1`);
    const { nodeId, ref } = await prepareRef(client, args[1], targetKey);

    if (what === "visible") {
      const visible = await callOnNode(client, nodeId, `function() {
        var r = this.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) return false;
        var s = window.getComputedStyle(this);
        return s.visibility !== 'hidden' && s.display !== 'none' && parseFloat(s.opacity) > 0;
      }`);
      console.log(visible ? "true" : "false");
    }
    else if (what === "enabled") {
      const enabled = await callOnNode(client, nodeId, "function() { return !this.disabled; }");
      console.log(enabled ? "true" : "false");
    }
    else if (what === "checked") {
      const checked = await callOnNode(client, nodeId, "function() { return !!this.checked; }");
      console.log(checked ? "true" : "false");
    }
    else { die("Usage: quiver-ctl is visible|enabled|checked @e1"); }
  }

  // ── highlight @ref ──────────────────────────────────────────────────────
  else if (cmd === "highlight") {
    if (!args[0]) die("Usage: quiver-ctl highlight @e1");
    const { nodeId, ref } = await prepareRef(client, args[0], targetKey);
    const rect = await getBoxRect(client, nodeId);
    await evalJS(client, `(() => {
      document.getElementById('__quiver_ctl_highlight')?.remove();
      var d = document.createElement('div');
      d.id = '__quiver_ctl_highlight';
      d.style.cssText = 'position:fixed;left:${rect.x}px;top:${rect.y}px;width:${rect.width}px;height:${rect.height}px;border:3px solid red;background:rgba(255,0,0,0.1);pointer-events:none;z-index:2147483647;box-sizing:border-box;transition:opacity 3s;';
      document.documentElement.appendChild(d);
      setTimeout(function() { d.style.opacity = '0'; }, 2000);
      setTimeout(function() { d.remove(); }, 5000);
    })()`);
    console.log(`✓ Highlighted ${args[0]} (${ref.role}${ref.name ? ` "${ref.name}"` : ""}) — fades in 5s`);
  }

  // ── diff snapshot ───────────────────────────────────────────────────────
  else if (cmd === "diff" && args[0] === "snapshot") {
    // Load previous snapshot
    const snapshots: Record<string, string> = (() => { try { return JSON.parse(fs.readFileSync(SNAPSHOT_PATH, "utf-8")); } catch { return {}; } })();
    const previous = snapshots[targetKey];
    if (!previous) die(`No previous snapshot for target "${targetKey}". Run \`snapshot -i\` first.`);

    // Take new snapshot
    const nodes = await getFullAXTree(client);
    const { text: current } = buildSnapshotInteractive(nodes, targetKey);

    const prevLines = previous.split("\n");
    const currLines = current.split("\n");
    const prevSet = new Set(prevLines);
    const currSet = new Set(currLines);

    const removed = prevLines.filter((l) => !currSet.has(l));
    const added = currLines.filter((l) => !prevSet.has(l));

    if (removed.length === 0 && added.length === 0) {
      console.log("No changes detected.");
    } else {
      for (const l of removed) console.log(`- ${l}`);
      for (const l of added) console.log(`+ ${l}`);
      console.error(`\n(${removed.length} removed, ${added.length} added)`);
    }
  }

  // ── dialog accept|dismiss ───────────────────────────────────────────────
  else if (cmd === "dialog") {
    const sub = args[0];
    if (sub === "accept") {
      const promptText = args.slice(1).join(" ") || undefined;
      // Listen for dialog event, then handle it
      const dialogPromise = client.once("Page.javascriptDialogOpening", 10_000).catch(() => null);
      // Check if a dialog is already open by trying to handle it immediately
      try {
        await client.call("Page.handleJavaScriptDialog", { accept: true, ...(promptText ? { promptText } : {}) }, 1000);
        console.log(`✓ Accepted dialog${promptText ? ` with text "${promptText}"` : ""}`);
      } catch {
        // No dialog open yet, wait for one
        console.error("Waiting for dialog...");
        const params = await dialogPromise;
        if (!params) die("✗ No dialog appeared within 10s");
        await client.call("Page.handleJavaScriptDialog", { accept: true, ...(promptText ? { promptText } : {}) });
        console.log(`✓ Accepted ${params.type} dialog: "${params.message}"${promptText ? ` with text "${promptText}"` : ""}`);
      }
    } else if (sub === "dismiss") {
      try {
        await client.call("Page.handleJavaScriptDialog", { accept: false }, 1000);
        console.log("✓ Dismissed dialog");
      } catch {
        console.error("Waiting for dialog...");
        const params = await client.once("Page.javascriptDialogOpening", 10_000).catch(() => null);
        if (!params) die("✗ No dialog appeared within 10s");
        await client.call("Page.handleJavaScriptDialog", { accept: false });
        console.log(`✓ Dismissed ${params.type} dialog: "${params.message}"`);
      }
    } else {
      die("Usage: agent-electrobun dialog accept [text] | dialog dismiss");
    }
  }

  // ── find <strategy> <value> <action> [args] ────────────────────────────
  else if (cmd === "find") {
    const strategy = args[0];
    const value = args[1];
    const action = args[2];
    if (!strategy || !value || !action) die('Usage: agent-electrobun find text|label|role|placeholder|alt|title|testid "value" click|fill|hover|focus|get [args]');
    const { objectId, backendNodeId, nodeId } = await findElement(client, strategy, value);
    await scrollIntoView(client, nodeId);

    if (action === "click") {
      const { x, y } = await getBoxCenter(client, nodeId);
      await clickAt(client, x, y);
      console.log(`✓ Clicked ${strategy}="${value}" at (${Math.round(x)}, ${Math.round(y)})`);
    } else if (action === "dblclick") {
      const { x, y } = await getBoxCenter(client, nodeId);
      await clickAt(client, x, y, 2);
      console.log(`✓ Double-clicked ${strategy}="${value}"`);
    } else if (action === "hover") {
      const { x, y } = await getBoxCenter(client, nodeId);
      await client.call("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
      console.log(`✓ Hovered ${strategy}="${value}"`);
    } else if (action === "focus") {
      await focusNode(client, nodeId);
      console.log(`✓ Focused ${strategy}="${value}"`);
    } else if (action === "fill") {
      const text = args.slice(3).join(" ");
      if (!text) die("Usage: find ... fill <text>");
      await focusNode(client, nodeId);
      const escaped = text.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
      await client.call("Runtime.callFunctionOn", {
        objectId,
        functionDeclaration: `function() {
          var text = '${escaped}';
          var nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
            || Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
          if (nativeSetter) { nativeSetter.call(this, text); }
          else { this.value = text; }
          this.dispatchEvent(new Event('input', { bubbles: true }));
          this.dispatchEvent(new Event('change', { bubbles: true }));
        }`,
        returnByValue: true,
      });
      console.log(`✓ Filled ${strategy}="${value}" with "${text}"`);
    } else if (action === "get") {
      const what = args[3] ?? "text";
      if (what === "text") {
        console.log(await callOnNode(client, nodeId, "function() { return this.textContent || this.value || ''; }"));
      } else if (what === "html") {
        console.log(await callOnNode(client, nodeId, "function() { return this.innerHTML; }"));
      } else if (what === "value") {
        console.log(await callOnNode(client, nodeId, "function() { return this.value ?? ''; }"));
      } else {
        console.log(await callOnNode(client, nodeId, `function() { return this.getAttribute('${what.replace(/'/g, "\\'")}'); }`));
      }
    } else {
      die(`Unknown find action: ${action}. Use: click, dblclick, hover, focus, fill, get`);
    }
  }

  // ── unknown ─────────────────────────────────────────────────────────────
  else {
    die(`Unknown command: ${cmd}. Run 'quiver-ctl help' for usage.`);
  }
} finally {
  await client.close();
}

process.exit(0);
