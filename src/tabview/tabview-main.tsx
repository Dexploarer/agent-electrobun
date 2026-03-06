import React, { Suspense, lazy } from "react";
import ReactDOM from "react-dom/client";
import { Electroview } from "electrobun/view";
import type { TabRPC, TabKind } from "../stubs/types";
import "./app/index.css";

// Lazy-load slates to reduce initial bundle
const WelcomeSlate = lazy(() => import("./app/slates/WelcomeSlate"));
const CodeEditorSlate = lazy(() => import("./app/slates/CodeEditorSlate"));
const TerminalSlate = lazy(() => import("./app/slates/TerminalSlate"));
const WebSlate = lazy(() => import("./app/slates/WebSlate"));
const GitSlate = lazy(() => import("./app/slates/GitSlate"));
const SearchSlate = lazy(() => import("./app/slates/SearchSlate"));
const SettingsSlate = lazy(() => import("./app/slates/SettingsSlate"));

const params = new URLSearchParams(window.location.search);
const tabId = params.get("tabId") ?? "unknown";
const webviewId: number = (window as any).__electrobunWebviewId;

// Extract tab metadata from URL params
const tabKind: TabKind = (params.get("kind") as TabKind) ?? "welcome";
const filePath = params.get("filePath") ?? undefined;
const tabUrl = params.get("url") ?? undefined;
const tabCwd = params.get("cwd") ?? undefined;
const repoRoot = params.get("repoRoot") ?? undefined;

// Tab RPC
export const rpc = Electroview.defineRPC<TabRPC>({
  handlers: {
    requests: {},
    messages: {
      terminalOutput: (data) => {
        window.dispatchEvent(new CustomEvent("terminalOutput", { detail: data }));
      },
      terminalExit: (data) => {
        window.dispatchEvent(new CustomEvent("terminalExit", { detail: data }));
      },
      fileWatchEvent: (data) => {
        window.dispatchEvent(new CustomEvent("fileWatchEvent", { detail: data }));
      },
    },
  },
});

new Electroview({ rpc });
(window as any).__demoRpc = rpc;

if (webviewId !== undefined) {
  rpc.request.registerTab({ tabId, webviewId });
  window.addEventListener("beforeunload", () => {
    rpc.request.unregisterTab({ tabId });
  });
}

function SlateLoader() {
  return (
    <div className="flex items-center justify-center h-full text-neutral-500 text-sm">
      Loading...
    </div>
  );
}

function TabContent() {
  return (
    <Suspense fallback={<SlateLoader />}>
      {tabKind === "file" && filePath ? (
        <CodeEditorSlate filePath={filePath} />
      ) : tabKind === "terminal" ? (
        <TerminalSlate cwd={tabCwd} />
      ) : tabKind === "web" ? (
        <WebSlate initialUrl={tabUrl} />
      ) : tabKind === "git" ? (
        <GitSlate repoRoot={repoRoot} />
      ) : tabKind === "search" ? (
        <SearchSlate />
      ) : tabKind === "settings" ? (
        <SettingsSlate />
      ) : (
        <WelcomeSlate />
      )}
    </Suspense>
  );
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <TabContent />
  </React.StrictMode>
);
