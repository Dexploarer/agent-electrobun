import { useState, useEffect, useCallback } from "react";
import { Plus, X, FileText, Terminal, Globe, GitBranch, ChevronRight, ChevronDown, FolderOpen, File, Search, Layers } from "lucide-react";
import { Electroview } from "electrobun/view";
import type { ShellRPC, Tab, TabAction, FileNode, PaneLayout, TabKind } from "../stubs/types";

// ── Shell RPC ─────────────────────────────────────────────────────────────────

type SetTabState = ((tabs: Tab[], activeTabId: string, paneLayout: PaneLayout) => void) | null;
type SetFileTree = ((roots: FileNode[]) => void) | null;
let _setTabState: SetTabState = null;
let _setFileTree: SetFileTree = null;

const shellRpc = Electroview.defineRPC<ShellRPC>({
  handlers: {
    requests: {},
    messages: {
      tabState: ({ tabs, activeTabId, paneLayout }) => _setTabState?.(tabs, activeTabId, paneLayout),
      fileTree: ({ roots }) => _setFileTree?.(roots),
    },
  },
});
new Electroview({ rpc: shellRpc });

function sendAction(action: TabAction) {
  shellRpc.send("tabAction", action);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

type WebviewTagElement = HTMLElement & {
  toggleTransparent(value?: boolean): void;
  togglePassthrough(value?: boolean): void;
  syncDimensions(force?: boolean): void;
};

const webviewRefs = new Map<string, WebviewTagElement>();

function getTabViewUrl(tabId: string): string {
  const base = window.location.hostname === "localhost"
    ? "http://localhost:5173/tabview/index.html"
    : "views://tabview/index.html";
  return `${base}?tabId=${encodeURIComponent(tabId)}`;
}

function syncVisibility(activeId: string) {
  webviewRefs.forEach((wv, tabId) => {
    const isActive = tabId === activeId;
    wv.toggleTransparent(!isActive);
    wv.togglePassthrough(!isActive);
    if (isActive) wv.syncDimensions(true);
  });
}

function getTabIcon(kind: string, size = 12) {
  switch (kind) {
    case "file": return <FileText size={size} />;
    case "terminal": return <Terminal size={size} />;
    case "web": return <Globe size={size} />;
    case "git": return <GitBranch size={size} />;
    default: return <Layers size={size} />;
  }
}

// ── FileTree ──────────────────────────────────────────────────────────────────

function FileTreeNode({ node, depth = 0 }: { node: FileNode; depth?: number }) {
  const [expanded, setExpanded] = useState(depth < 1);
  return (
    <div>
      <button
        onClick={() => {
          if (node.type === "dir") setExpanded(!expanded);
          else sendAction({ type: "add", kind: "file", filePath: node.path });
        }}
        className="flex items-center gap-1.5 w-full px-2 py-[3px] text-[12px] text-neutral-400 hover:text-neutral-200 hover:bg-white/[0.06] rounded-sm transition-colors"
        style={{ paddingLeft: `${8 + depth * 14}px` }}
      >
        {node.type === "dir" ? (
          expanded ? <ChevronDown size={12} className="shrink-0 text-neutral-600" /> : <ChevronRight size={12} className="shrink-0 text-neutral-600" />
        ) : <span className="w-3" />}
        {node.type === "dir" ? <FolderOpen size={13} className="shrink-0 text-amber-500/70" /> : <File size={13} className="shrink-0 text-neutral-500" />}
        <span className="truncate">{node.name}</span>
      </button>
      {expanded && node.children?.map((child) => (
        <FileTreeNode key={child.path} node={child} depth={depth + 1} />
      ))}
    </div>
  );
}

// ── Sidebar ───────────────────────────────────────────────────────────────────

function Sidebar({ fileRoots, onNewTab }: { fileRoots: FileNode[]; onNewTab: (kind: TabKind) => void }) {
  return (
    <div className="w-56 shrink-0 flex flex-col border-r border-white/[0.06] bg-[#161618]">
      <div className="drag-region h-10 shrink-0 flex items-center px-3 border-b border-white/[0.06]">
        <span className="no-drag text-[11px] font-bold text-neutral-400 uppercase tracking-widest">Explorer</span>
      </div>
      <div className="no-drag flex items-center gap-1 px-2 py-1.5 border-b border-white/[0.06]">
        <button onClick={() => onNewTab("terminal")} className="p-1.5 rounded-md text-neutral-600 hover:text-neutral-300 hover:bg-white/[0.06] transition-all" title="New Terminal">
          <Terminal size={14} />
        </button>
        <button onClick={() => onNewTab("web")} className="p-1.5 rounded-md text-neutral-600 hover:text-neutral-300 hover:bg-white/[0.06] transition-all" title="New Browser Tab">
          <Globe size={14} />
        </button>
        <button onClick={() => onNewTab("git")} className="p-1.5 rounded-md text-neutral-600 hover:text-neutral-300 hover:bg-white/[0.06] transition-all" title="Git">
          <GitBranch size={14} />
        </button>
        <button onClick={() => onNewTab("file")} className="p-1.5 rounded-md text-neutral-600 hover:text-neutral-300 hover:bg-white/[0.06] transition-all" title="Search">
          <Search size={14} />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto py-1">
        {fileRoots.map((root) => (
          <div key={root.path}>
            <div className="px-3 py-1.5 text-[10px] font-bold text-neutral-500 uppercase tracking-widest truncate">{root.name}</div>
            {root.children?.map((child) => <FileTreeNode key={child.path} node={child} />)}
          </div>
        ))}
        {fileRoots.length === 0 && (
          <div className="px-3 py-4 text-xs text-neutral-600 text-center">No folder open</div>
        )}
      </div>
    </div>
  );
}

// ── App ───────────────────────────────────────────────────────────────────────

export function App() {
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeTabId, setActiveTabId] = useState("");
  const [mountedIds, setMountedIds] = useState<Set<string>>(new Set());
  const [fileRoots, setFileRoots] = useState<FileNode[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  useEffect(() => {
    _setTabState = (newTabs, newActiveId) => {
      setTabs(newTabs);
      setActiveTabId(newActiveId);
      setMountedIds((prev) => {
        const incoming = new Set(newTabs.map((t) => t.id));
        const toAdd = [...incoming].filter((id) => !prev.has(id));
        const toRemove = [...prev].filter((id) => !incoming.has(id));
        if (toAdd.length === 0 && toRemove.length === 0) return prev;
        const next = new Set([...prev, ...toAdd]);
        if (toRemove.length > 0) {
          setTimeout(() => {
            toRemove.forEach((id) => webviewRefs.delete(id));
            setMountedIds((p) => {
              const n = new Set(p);
              toRemove.forEach((id) => n.delete(id));
              return n;
            });
          }, 300);
        }
        return next;
      });
    };
    _setFileTree = (roots) => setFileRoots(roots);
    return () => { _setTabState = null; _setFileTree = null; };
  }, []);

  useEffect(() => { if (activeTabId) syncVisibility(activeTabId); }, [activeTabId]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      if (e.key === "t" && !e.shiftKey) { e.preventDefault(); sendAction({ type: "add" }); }
      else if (e.key === "w") { e.preventDefault(); sendAction({ type: "close", id: activeTabId }); }
      else if (e.shiftKey && e.key === "T") { e.preventDefault(); sendAction({ type: "reopen" }); }
      else if (e.shiftKey && e.key === "]") { e.preventDefault(); sendAction({ type: "next" }); }
      else if (e.shiftKey && e.key === "[") { e.preventDefault(); sendAction({ type: "prev" }); }
      else if (e.key === "b" && !e.shiftKey) { e.preventDefault(); setSidebarOpen((v) => !v); }
      else if (e.key >= "1" && e.key <= "9") { e.preventDefault(); sendAction({ type: "byIndex", index: Number(e.key) - 1 }); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [activeTabId]);

  const handleNewTab = useCallback((kind: TabKind) => {
    sendAction({ type: "add", kind });
  }, []);

  return (
    <div className="flex h-screen">
      {sidebarOpen && <Sidebar fileRoots={fileRoots} onNewTab={handleNewTab} />}
      <div className="flex flex-col flex-1 min-w-0">
        {/* Tab bar */}
        <div className="drag-region h-10 shrink-0 flex items-center bg-[#1e1e1e] border-b border-white/[0.06]">
          {!sidebarOpen && <div className="shrink-0 w-[76px]" />}
          {sidebarOpen && <div className="shrink-0 w-2" />}
          <div className="no-drag flex items-center min-w-0 flex-1 overflow-x-auto px-1.5">
            {tabs.map((tab) => {
              const isActive = tab.id === activeTabId;
              return (
                <button
                  key={tab.id}
                  onClick={() => sendAction({ type: "activate", id: tab.id })}
                  onMouseDown={(e) => e.button === 1 && (e.preventDefault(), sendAction({ type: "close", id: tab.id }))}
                  className={`group relative flex items-center gap-2 h-10 px-3 text-[12px] font-medium shrink-0 transition-colors duration-150 ${
                    isActive ? "text-neutral-100" : "text-neutral-500 hover:text-neutral-300"
                  }`}
                >
                  {isActive && <span className="absolute bottom-0 left-2 right-2 h-[2px] rounded-full bg-white/70" />}
                  <span className={isActive ? "text-neutral-400" : "text-neutral-600"}>{getTabIcon(tab.kind)}</span>
                  <span className="truncate max-w-[120px]">{tab.label}</span>
                  <button
                    type="button"
                    aria-label="Close tab"
                    onClick={(e) => { e.stopPropagation(); sendAction({ type: "close", id: tab.id }); }}
                    className={`ml-0.5 p-0.5 rounded-sm transition-all hover:bg-white/10 ${
                      isActive ? "opacity-40 hover:opacity-100" : "opacity-0 group-hover:opacity-40 hover:!opacity-100"
                    }`}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </button>
              );
            })}
          </div>
          <button
            onClick={() => sendAction({ type: "add" })}
            className="no-drag shrink-0 p-1.5 mx-1.5 rounded-md text-neutral-600 hover:text-neutral-400 hover:bg-white/[0.06] transition-all active:scale-[0.97]"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Webviews */}
        <div className="flex-1 min-h-0 relative">
          {tabs.filter((tab) => mountedIds.has(tab.id)).map((tab) => (
            <electrobun-webview
              key={tab.id}
              src={getTabViewUrl(tab.id)}
              transparent={tab.id !== activeTabId ? "" : undefined}
              style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
              ref={(el: WebviewTagElement | null) => {
                if (el) {
                  webviewRefs.set(tab.id, el);
                  if (tab.id !== activeTabId) { el.toggleTransparent(true); el.togglePassthrough(true); }
                }
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
