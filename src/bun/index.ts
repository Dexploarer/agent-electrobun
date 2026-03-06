import { BrowserWindow, BrowserView, Utils, Updater, ApplicationMenu } from "electrobun/bun";
import type { Tab, TabAction, TabKind, FileNode, PaneLayout } from "../stubs/types";
import { basename, join } from "path";
import { existsSync, statSync, readdirSync, readFileSync, writeFileSync, mkdirSync, renameSync, unlinkSync, rmSync } from "fs";
import { watch } from "fs";
import { spawn } from "bun";

// ── Dev server ────────────────────────────────────────────────────────────────

const DEV_SERVER_PORT = 5173;
const DEV_SERVER_URL = `http://localhost:${DEV_SERVER_PORT}`;

async function getViewUrl(): Promise<string> {
  const channel = await Updater.localInfo.channel();
  if (channel === "dev") {
    const viewUrl = `${DEV_SERVER_URL}/mainview/index.html`;
    for (let i = 0; i < 20; i++) {
      try {
        const res = await fetch(viewUrl, { method: "HEAD" });
        if (res.ok) return viewUrl;
      } catch {}
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  return "views://mainview/index.html";
}

function getTabViewUrl(tab: Tab): string {
  const params = new URLSearchParams({ tabId: tab.id, kind: tab.kind });
  if (tab.filePath) params.set("filePath", tab.filePath);
  if (tab.url) params.set("url", tab.url);
  if (tab.cwd) params.set("cwd", tab.cwd);
  if (tab.repoRoot) params.set("repoRoot", tab.repoRoot);
  return `${DEV_SERVER_URL}/tabview/index.html?${params.toString()}`;
}

// ── State persistence ─────────────────────────────────────────────────────────

const STATE_FILE = join(process.env.HOME ?? "/tmp", ".agent-workspace-state.json");

interface PersistedState {
  tabs: Tab[];
  activeTabId: string;
  paneLayout: PaneLayout;
  nextId: number;
  projectRoots: string[];
}

function saveState() {
  try {
    const state: PersistedState = { tabs, activeTabId, paneLayout, nextId, projectRoots };
    writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), "utf-8");
  } catch {}
}

function loadState(): PersistedState | null {
  try {
    if (!existsSync(STATE_FILE)) return null;
    const data = JSON.parse(readFileSync(STATE_FILE, "utf-8"));
    if (data.tabs?.length > 0) return data;
  } catch {}
  return null;
}

// ── Tab manager ───────────────────────────────────────────────────────────────

const CLOSE_STACK_MAX = 25;
const MUTATION_THROTTLE_MS = 150;
let nextId = 1;
let lastMutationAt = 0;

function makeTab(kind: TabKind = "welcome", opts: Partial<Tab> = {}): Tab {
  const id = `tab-${nextId++}`;
  const label = opts.filePath ? basename(opts.filePath) :
    opts.url ? opts.url :
    kind === "terminal" ? "Terminal" :
    kind === "git" ? "Git" :
    kind === "search" ? "Search" :
    kind === "settings" ? "Settings" :
    "Welcome";
  return { id, label, kind, ...opts };
}

// Restore state or start fresh
const restored = loadState();
let tabs: Tab[] = restored?.tabs.filter((t) => t.kind !== "terminal") ?? [makeTab("welcome")];
let activeTabId: string = restored?.activeTabId ?? tabs[0].id;
if (restored?.nextId) nextId = restored.nextId;
if (!tabs.some((t) => t.id === activeTabId)) activeTabId = tabs[0].id;

const closedStack: Tab[] = [];
let paneLayout: PaneLayout = restored?.paneLayout ?? {
  type: "pane", id: "root-pane", tabIds: [tabs[0].id], activeTabId: tabs[0].id,
};

function throttle(): boolean {
  const now = Date.now();
  if (now - lastMutationAt < MUTATION_THROTTLE_MS) return false;
  lastMutationAt = now;
  return true;
}

function pushState() {
  shellRpc.send("tabState", { tabs: [...tabs], activeTabId, paneLayout });
  saveState();
}

function tabAdd(kind: TabKind = "welcome", opts: Partial<Tab> = {}) {
  if (!throttle()) return;
  const tab = makeTab(kind, opts);
  tabs = [...tabs, tab];
  activeTabId = tab.id;
  if (paneLayout.type === "pane") {
    paneLayout = { ...paneLayout, tabIds: [...paneLayout.tabIds, tab.id], activeTabId: tab.id };
  }
  pushState();
}

function tabClose(id: string) {
  if (!throttle()) return;
  const idx = tabs.findIndex((t) => t.id === id);
  if (idx === -1) return;
  closedStack.push(tabs[idx]);
  if (closedStack.length > CLOSE_STACK_MAX) closedStack.shift();
  const next = tabs.filter((t) => t.id !== id);
  if (next.length === 0) { Utils.quit(); return; }
  if (activeTabId === id) activeTabId = next[Math.min(idx, next.length - 1)].id;
  tabs = next;
  pushState();
}

function tabReopen() {
  if (!throttle()) return;
  const tab = closedStack.pop();
  if (!tab) return;
  const revived = { ...tab, id: `tab-${nextId++}` };
  tabs = [...tabs, revived];
  activeTabId = revived.id;
  pushState();
}

function tabActivate(id: string) {
  if (!tabs.some((t) => t.id === id)) return;
  activeTabId = id;
  pushState();
}

function tabPrev() {
  const cur = tabs.findIndex((t) => t.id === activeTabId);
  activeTabId = tabs[(cur - 1 + tabs.length) % tabs.length].id;
  pushState();
}

function tabNext() {
  const cur = tabs.findIndex((t) => t.id === activeTabId);
  activeTabId = tabs[(cur + 1) % tabs.length].id;
  pushState();
}

function tabByIndex(index: number) {
  const idx = index === 8 ? tabs.length - 1 : Math.min(index, tabs.length - 1);
  activeTabId = tabs[idx].id;
  pushState();
}

function handleTabAction(action: TabAction) {
  switch (action.type) {
    case "add":      tabAdd(action.kind, action); break;
    case "close":    tabClose(action.id); break;
    case "activate": tabActivate(action.id); break;
    case "reopen":   tabReopen(); break;
    case "prev":     tabPrev(); break;
    case "next":     tabNext(); break;
    case "byIndex":  tabByIndex(action.index); break;
  }
}

// ── Pane splitting ───────────────────────────────────────────────────────────
let nextPaneId = 1;

function findPane(layout: PaneLayout, paneId: string): PaneLayout | null {
  if (layout.type === "pane" && layout.id === paneId) return layout;
  if (layout.type === "container") {
    for (const child of layout.children) {
      const found = findPane(child, paneId);
      if (found) return found;
    }
  }
  return null;
}

function replacePane(layout: PaneLayout, paneId: string, replacement: PaneLayout): PaneLayout {
  if (layout.type === "pane" && layout.id === paneId) return replacement;
  if (layout.type === "container") {
    return {
      ...layout,
      children: layout.children.map((child) => replacePane(child, paneId, replacement)),
    };
  }
  return layout;
}

function splitPane(paneId: string, direction: "row" | "column") {
  const existing = findPane(paneLayout, paneId);
  if (!existing || existing.type !== "pane") return;

  // Create a new tab for the new pane
  const newTab = makeTab("welcome");
  tabs = [...tabs, newTab];

  const newPaneId = `pane-${nextPaneId++}`;
  const newPane: PaneLayout = {
    type: "pane",
    id: newPaneId,
    tabIds: [newTab.id],
    activeTabId: newTab.id,
  };

  const container: PaneLayout = {
    type: "container",
    direction,
    children: [existing, newPane],
    sizes: [50, 50],
  };

  paneLayout = replacePane(paneLayout, paneId, container);
  activeTabId = newTab.id;
  pushState();
}

// ── File tree ─────────────────────────────────────────────────────────────────

const projectRoots: string[] = restored?.projectRoots?.length ? restored.projectRoots : [process.cwd()];

function readDirTree(dirPath: string, depth = 1): FileNode[] {
  try {
    const entries = readdirSync(dirPath, { withFileTypes: true })
      .filter((e) => !e.name.startsWith(".") && e.name !== "node_modules" && e.name !== "dist" && e.name !== "build")
      .sort((a, b) => {
        if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
    return entries.map((e) => {
      const fullPath = join(dirPath, e.name);
      const node: FileNode = { name: e.name, path: fullPath, type: e.isDirectory() ? "dir" : "file" };
      if (e.isDirectory() && depth > 0) node.children = readDirTree(fullPath, depth - 1);
      return node;
    });
  } catch { return []; }
}

function pushFileTree() {
  const roots = projectRoots.map((root) => ({
    name: basename(root),
    path: root,
    type: "dir" as const,
    children: readDirTree(root, 2),
  }));
  shellRpc.send("fileTree", { roots });
}

// ── PTY / Terminal manager ────────────────────────────────────────────────────

const terminals = new Map<string, { proc: ReturnType<typeof spawn>; decoder: TextDecoder }>();
let termNextId = 1;

function createTerminal(cwd: string, shell?: string): string {
  const terminalId = `term-${termNextId++}`;
  const proc = spawn([shell ?? (process.platform === "win32" ? "cmd.exe" : "/bin/bash")], {
    cwd,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, TERM: "xterm-256color" },
  });
  const decoder = new TextDecoder();
  terminals.set(terminalId, { proc, decoder });

  (async () => {
    const reader = proc.stdout.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        broadcastToTabs("terminalOutput", { terminalId, data: decoder.decode(value) });
      }
    } catch {}
    broadcastToTabs("terminalExit", { terminalId, exitCode: proc.exitCode ?? 0 });
    terminals.delete(terminalId);
  })();

  if (proc.stderr) {
    (async () => {
      const reader = proc.stderr!.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          broadcastToTabs("terminalOutput", { terminalId, data: decoder.decode(value) });
        }
      } catch {}
    })();
  }

  return terminalId;
}

function broadcastToTabs(event: string, data: any) {
  try { (rpc as any).send(event, data); } catch {}
}

// ── Git helper ────────────────────────────────────────────────────────────────

async function gitOp(repoRoot: string, fn: (git: any) => Promise<any>) {
  const { simpleGit } = await import("simple-git");
  return fn(simpleGit(repoRoot));
}

// ── Application menu ──────────────────────────────────────────────────────────

const menuConfig = [
  { label: "AgentWorkspace", submenu: [{ role: "quit", accelerator: "cmd+q" }] },
  {
    label: "File",
    submenu: [
      { type: "normal", label: "New Tab", action: "tab:new", accelerator: "cmd+t" },
      { type: "normal", label: "New Terminal", action: "tab:terminal", accelerator: "cmd+shift+`" },
      { type: "normal", label: "Close Tab", action: "tab:close", accelerator: "cmd+w" },
      { type: "normal", label: "Reopen Closed Tab", action: "tab:reopen", accelerator: "cmd+shift+t" },
      { type: "separator" },
      { type: "normal", label: "Open File...", action: "file:open", accelerator: "cmd+o" },
      { type: "normal", label: "Open Folder...", action: "folder:open", accelerator: "cmd+shift+o" },
      { type: "separator" },
      { type: "normal", label: "Search Files", action: "search:open", accelerator: "cmd+p" },
      { type: "normal", label: "Search in Files", action: "search:content", accelerator: "cmd+shift+f" },
      { type: "separator" },
      { type: "normal", label: "Settings", action: "settings:open", accelerator: "cmd+," },
    ],
  },
  {
    label: "Edit",
    submenu: [
      { role: "undo" }, { role: "redo" }, { type: "separator" },
      { role: "cut" }, { role: "copy" }, { role: "paste" }, { role: "selectAll" },
    ],
  },
  {
    label: "View",
    submenu: [
      { type: "normal", label: "Previous Tab", action: "tab:prev", accelerator: "cmd+shift+[" },
      { type: "normal", label: "Next Tab", action: "tab:next", accelerator: "cmd+shift+]" },
      { type: "separator" },
      { type: "normal", label: "Split Right", action: "split:right", accelerator: "cmd+\\" },
      { type: "normal", label: "Split Down", action: "split:down", accelerator: "cmd+shift+\\" },
      { type: "separator" },
      ...[1,2,3,4,5,6,7,8,9].map((n) => ({
        type: "normal", label: `Tab ${n}`, action: `tab:${n}`, accelerator: `cmd+${n}`,
      })),
    ],
  },
];

const helpMenu = {
  label: "Help",
  submenu: [
    { type: "normal", label: "About Agent Workspace", action: "help:about" },
    { type: "normal", label: "Keyboard Shortcuts", action: "help:shortcuts" },
  ],
};
menuConfig.push(helpMenu as any);

ApplicationMenu.setApplicationMenu(menuConfig as any);

// ── Shell RPC ─────────────────────────────────────────────────────────────────

const shellRpc = BrowserView.defineRPC<any>({
  maxRequestTime: 60000,
  handlers: {
    requests: {},
    messages: {
      tabAction: (action: TabAction) => handleTabAction(action),
      splitPane: ({ paneId, direction }: { paneId: string; direction: "row" | "column" }) => {
        splitPane(paneId, direction);
      },
    },
  },
});

ApplicationMenu.on("application-menu-clicked", (e) => {
  const { action } = e.data;
  if (action === "tab:new") handleTabAction({ type: "add" });
  else if (action === "tab:terminal") handleTabAction({ type: "add", kind: "terminal", cwd: process.cwd() });
  else if (action === "tab:close") handleTabAction({ type: "close", id: activeTabId });
  else if (action === "tab:reopen") handleTabAction({ type: "reopen" });
  else if (action === "tab:prev") handleTabAction({ type: "prev" });
  else if (action === "tab:next") handleTabAction({ type: "next" });
  else if (action === "file:open") {
    Utils.openFileDialog({ canChooseFiles: true, canChooseDirectory: false, allowsMultipleSelection: true })
      .then((files: string[]) => {
        files.forEach((f) => handleTabAction({ type: "add", kind: "file", filePath: f }));
      });
  }
  else if (action === "folder:open") {
    Utils.openFileDialog({ canChooseFiles: false, canChooseDirectory: true, allowsMultipleSelection: false })
      .then((dirs: string[]) => {
        if (dirs[0]) { projectRoots.push(dirs[0]); pushFileTree(); saveState(); }
      });
  }
  else if (action === "search:open" || action === "search:content") {
    handleTabAction({ type: "add", kind: "search" });
  }
  else if (action === "settings:open") {
    handleTabAction({ type: "add", kind: "settings" });
  }
  else if (action === "split:right") {
    splitPane("root-pane", "row");
  }
  else if (action === "split:down") {
    splitPane("root-pane", "column");
  }
  else if (action === "help:shortcuts") {
    handleTabAction({ type: "add", kind: "settings" });
  }
  else if (action === "help:about") {
    handleTabAction({ type: "add", kind: "welcome" });
  }
  else if (action.startsWith("tab:") && !isNaN(Number(action.slice(4)))) {
    handleTabAction({ type: "byIndex", index: Number(action.slice(4)) - 1 });
  }
});

// ── Tab RPC (OOPIF tabs) ──────────────────────────────────────────────────────

const tabViewsByTabId = new Map<string, any>();

const rpc = BrowserView.defineRPC<any>({
  maxRequestTime: 60000,
  handlers: {
    requests: {
      registerTab: async ({ tabId, webviewId }: any) => {
        const view = BrowserView.getById(webviewId);
        if (view) tabViewsByTabId.set(tabId, view);
      },
      unregisterTab: async ({ tabId }: any) => { tabViewsByTabId.delete(tabId); },
      ping: async ({ message }: any) => ({ pong: `"${message}" — hello from Bun` }),
      get_system_info: async () => ({
        platform: process.platform, arch: process.arch,
        bunVersion: Bun.version, cwd: process.cwd(), pid: process.pid,
      }),
      open_file_dialog: async () => ({
        files: await Utils.openFileDialog({
          canChooseFiles: true, canChooseDirectory: false, allowsMultipleSelection: true,
        }),
      }),
      open_external: async ({ url }: any) => { await Utils.openExternal(url); },

      // File operations
      readFile: async ({ path }: any) => {
        try { return { textContent: readFileSync(path, "utf-8") }; }
        catch (e: any) { return { textContent: "", error: e.message }; }
      },
      writeFile: async ({ path, value }: any) => {
        try { writeFileSync(path, value, "utf-8"); return { success: true }; }
        catch (e: any) { return { success: false, error: e.message }; }
      },
      readDir: async ({ path }: any) => readDirTree(path, 1),
      getNode: async ({ path }: any) => {
        try {
          const stat = statSync(path);
          return { name: basename(path), path, type: stat.isDirectory() ? "dir" : "file" };
        } catch { return null; }
      },
      exists: async ({ path }: any) => existsSync(path),
      mkdir: async ({ path }: any) => {
        try { mkdirSync(path, { recursive: true }); return { success: true }; }
        catch (e: any) { return { success: false, error: e.message }; }
      },
      rename: async ({ oldPath, newPath }: any) => {
        try { renameSync(oldPath, newPath); return { success: true }; }
        catch (e: any) { return { success: false, error: e.message }; }
      },
      deleteFile: async ({ path }: any) => {
        try {
          if (statSync(path).isDirectory()) rmSync(path, { recursive: true });
          else unlinkSync(path);
          return { success: true };
        } catch (e: any) { return { success: false, error: e.message }; }
      },
      findFiles: async ({ query, cwd }: any) => {
        const results: string[] = [];
        const lq = query.toLowerCase();
        function walk(dir: string) {
          try {
            for (const e of readdirSync(dir, { withFileTypes: true })) {
              if (e.name.startsWith(".") || e.name === "node_modules") continue;
              const fp = join(dir, e.name);
              if (e.isDirectory()) walk(fp);
              else if (e.name.toLowerCase().includes(lq)) { results.push(fp); if (results.length >= 100) return; }
            }
          } catch {}
        }
        walk(cwd ?? process.cwd());
        return results;
      },
      findInFiles: async ({ query, cwd }: any) => {
        const results: any[] = [];
        const lq = query.toLowerCase();
        function walk(dir: string) {
          try {
            for (const e of readdirSync(dir, { withFileTypes: true })) {
              if (e.name.startsWith(".") || e.name === "node_modules") continue;
              const fp = join(dir, e.name);
              if (e.isDirectory()) { walk(fp); continue; }
              try {
                const lines = readFileSync(fp, "utf-8").split("\n");
                for (let i = 0; i < lines.length; i++) {
                  const col = lines[i].toLowerCase().indexOf(lq);
                  if (col !== -1) { results.push({ path: fp, line: i+1, column: col+1, match: lines[i].trim() }); if (results.length >= 200) return; }
                }
              } catch {}
            }
          } catch {}
        }
        walk(cwd ?? process.cwd());
        return results;
      },

      // Terminal
      createTerminal: async ({ cwd, shell }: any) => createTerminal(cwd, shell),
      writeToTerminal: async ({ terminalId, data }: any) => {
        const t = terminals.get(terminalId);
        if (!t) return false;
        t.proc.stdin.write(data);
        return true;
      },
      resizeTerminal: async () => true,
      killTerminal: async ({ terminalId }: any) => {
        const t = terminals.get(terminalId);
        if (!t) return false;
        t.proc.kill();
        terminals.delete(terminalId);
        return true;
      },

      // Git operations
      gitStatus: async ({ repoRoot }: any) => gitOp(repoRoot, async (git) => {
        const s = await git.status();
        return { current: s.current, tracking: s.tracking, files: s.files.map((f: any) => ({ path: f.path, index: f.index, working_dir: f.working_dir })), ahead: s.ahead, behind: s.behind };
      }),
      gitLog: async ({ repoRoot, limit }: any) => gitOp(repoRoot, async (git) => {
        const log = await git.log({ maxCount: limit ?? 50 });
        return { all: log.all.map((c: any) => ({ hash: c.hash, date: c.date, message: c.message, author_name: c.author_name })) };
      }),
      gitDiff: async ({ repoRoot, options }: any) => gitOp(repoRoot, (git) => git.diff(options ?? [])),
      gitAdd: async ({ repoRoot, files }: any) => gitOp(repoRoot, (git) => git.add(files)),
      gitCommit: async ({ repoRoot, msg }: any) => gitOp(repoRoot, (git) => git.commit(msg)),
      gitCheckout: async ({ repoRoot, branch }: any) => gitOp(repoRoot, (git) => git.checkout(branch)),
      gitBranch: async ({ repoRoot }: any) => gitOp(repoRoot, async (git) => {
        const b = await git.branch();
        return { current: b.current, all: b.all };
      }),
      gitPush: async ({ repoRoot, remote, branch }: any) => gitOp(repoRoot, (git) => git.push(remote ?? "origin", branch)),
      gitPull: async ({ repoRoot, remote, branch }: any) => gitOp(repoRoot, (git) => git.pull(remote ?? "origin", branch)),
      gitShow: async ({ repoRoot, options }: any) => gitOp(repoRoot, (git) => git.show(options)),
      gitStash: async ({ repoRoot, action, message }: any) => gitOp(repoRoot, (git) => {
        if (action === "list") return git.stashList();
        if (action === "push") return git.stash(["push", ...(message ? ["-m", message] : [])]);
        if (action === "pop") return git.stash(["pop"]);
        if (action === "apply") return git.stash(["apply"]);
        return "";
      }),
    },
    messages: {} as any,
  },
});

// ── Window + webview wiring ───────────────────────────────────────────────────

const url = await getViewUrl();

const mainWindow = new BrowserWindow({
  title: "Agent Workspace",
  url,
  frame: { width: 1280, height: 850, x: 80, y: 60 },
  titleBarStyle: "hiddenInset",
  transparent: false,
  rpc: shellRpc,
});

mainWindow.on("close", () => {
  saveState();
  terminals.forEach((t) => t.proc.kill());
  Utils.quit();
});

(BrowserView as any).onTagCreated((view: any) => {
  rpc.setTransport(view.createTransport());
});

// ── File watcher ──────────────────────────────────────────────────────────────

for (const root of projectRoots) {
  try {
    watch(root, { recursive: true }, (_event, filename) => {
      if (!filename || filename.includes("node_modules") || filename.startsWith(".")) return;
      const fullPath = join(root, filename);
      const exists = existsSync(fullPath);
      const isFile = exists ? statSync(fullPath).isFile() : true;
      broadcastToTabs("fileWatchEvent", { absolutePath: fullPath, exists, isFile, isDir: !isFile });
      pushFileTree();
    });
  } catch {}
}

setTimeout(() => { pushState(); pushFileTree(); }, 1000);

console.log("Agent Workspace started");
