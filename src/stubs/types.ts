// Cross-process RPC type contracts for the agent workspace.
// Modeled after blackboardsh/colab's WorkspaceRPC schema.

// ── Core types ────────────────────────────────────────────────────────────────

export type Tab = {
  id: string;
  label: string;
  kind: TabKind;
  filePath?: string;
  url?: string;
  cwd?: string;
  repoRoot?: string;
};

export type TabKind = "file" | "terminal" | "web" | "git" | "welcome" | "search" | "settings";

export type PaneLayout =
  | { type: "pane"; id: string; tabIds: string[]; activeTabId: string }
  | { type: "container"; direction: "row" | "column"; children: PaneLayout[]; sizes: number[] };

export type FileNode = {
  name: string;
  path: string;
  type: "file" | "dir";
  children?: FileNode[];
};

// ── Shell RPC (Bun <-> Shell/mainview) ────────────────────────────────────────

export type ShellRPC = {
  webview: {
    requests: Record<never, never>;
    messages: {
      tabState: { tabs: Tab[]; activeTabId: string; paneLayout: PaneLayout };
      fileTree: { roots: FileNode[] };
    };
  };
  bun: {
    requests: Record<never, never>;
    messages: {
      tabAction: TabAction;
      splitPane: { paneId: string; direction: "row" | "column" };
    };
  };
};

export type TabAction =
  | { type: "add"; kind?: TabKind; filePath?: string; url?: string; cwd?: string; repoRoot?: string }
  | { type: "close"; id: string }
  | { type: "activate"; id: string }
  | { type: "reopen" }
  | { type: "prev" }
  | { type: "next" }
  | { type: "byIndex"; index: number };

// ── Tab RPC (Bun <-> each OOPIF tab/slate) ───────────────────────────────────

export type TabRPC = {
  webview: {
    requests: Record<never, never>;
    messages: {
      terminalOutput: { terminalId: string; data: string };
      terminalExit: { terminalId: string; exitCode: number };
      fileWatchEvent: {
        absolutePath: string;
        exists: boolean;
        isFile: boolean;
        isDir: boolean;
      };
    };
  };
  bun: {
    requests: {
      registerTab: { params: { tabId: string; webviewId: number }; response: void };
      unregisterTab: { params: { tabId: string }; response: void };
      ping: { params: { message: string }; response: { pong: string } };
      get_system_info: {
        params: Record<never, never>;
        response: { platform: string; arch: string; bunVersion: string; cwd: string; pid: number };
      };
      open_file_dialog: { params: Record<never, never>; response: { files: string[] } };
      open_external: { params: { url: string }; response: void };

      // ── File operations ──
      readFile: { params: { path: string }; response: { textContent: string } };
      writeFile: {
        params: { path: string; value: string };
        response: { success: boolean; error?: string };
      };
      readDir: { params: { path: string }; response: FileNode[] };
      getNode: { params: { path: string }; response: FileNode | null };
      exists: { params: { path: string }; response: boolean };
      mkdir: { params: { path: string }; response: { success: boolean; error?: string } };
      rename: {
        params: { oldPath: string; newPath: string };
        response: { success: boolean; error?: string };
      };
      deleteFile: { params: { path: string }; response: { success: boolean; error?: string } };
      findFiles: { params: { query: string; cwd?: string }; response: string[] };
      findInFiles: {
        params: { query: string; cwd?: string };
        response: { path: string; line: number; column: number; match: string }[];
      };

      // ── Terminal (PTY) ──
      createTerminal: { params: { cwd: string; shell?: string }; response: string };
      writeToTerminal: { params: { terminalId: string; data: string }; response: boolean };
      resizeTerminal: { params: { terminalId: string; cols: number; rows: number }; response: boolean };
      killTerminal: { params: { terminalId: string }; response: boolean };

      // ── Git operations ──
      gitStatus: {
        params: { repoRoot: string };
        response: {
          current: string | null;
          tracking: string | null;
          files: { path: string; index: string; working_dir: string }[];
          ahead: number;
          behind: number;
        };
      };
      gitLog: {
        params: { repoRoot: string; limit?: number };
        response: { all: { hash: string; date: string; message: string; author_name: string }[] };
      };
      gitDiff: { params: { repoRoot: string; options?: string[] }; response: string };
      gitAdd: { params: { repoRoot: string; files: string | string[] }; response: string };
      gitCommit: {
        params: { repoRoot: string; msg: string };
        response: { commit: string; summary: { changes: number; insertions: number; deletions: number } };
      };
      gitCheckout: { params: { repoRoot: string; branch: string }; response: string };
      gitBranch: { params: { repoRoot: string }; response: { current: string; all: string[] } };
      gitPush: { params: { repoRoot: string; remote?: string; branch?: string }; response: string };
      gitPull: { params: { repoRoot: string; remote?: string; branch?: string }; response: string };
      gitShow: { params: { repoRoot: string; options: string[] }; response: string };
      gitStash: {
        params: { repoRoot: string; action: "list" | "push" | "pop" | "apply"; message?: string };
        response: string;
      };
    };
    messages: Record<never, never>;
  };
};
