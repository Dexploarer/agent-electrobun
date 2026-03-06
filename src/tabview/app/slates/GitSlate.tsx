import { useState, useEffect, useCallback } from "react";
import { GitBranch, GitCommit, RefreshCw, Plus, Minus, Check, ChevronDown, ChevronRight, FileText } from "lucide-react";

interface GitFile {
  path: string;
  index: string;
  working_dir: string;
}

interface GitLogEntry {
  hash: string;
  date: string;
  message: string;
  author_name: string;
}

export default function GitSlate({ repoRoot }: { repoRoot?: string }) {
  const [root, setRoot] = useState(repoRoot ?? "");
  const [currentBranch, setCurrentBranch] = useState<string | null>(null);
  const [files, setFiles] = useState<GitFile[]>([]);
  const [log, setLog] = useState<GitLogEntry[]>([]);
  const [commitMsg, setCommitMsg] = useState("");
  const [loading, setLoading] = useState(false);
  const [diffText, setDiffText] = useState("");
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [showLog, setShowLog] = useState(true);
  const [error, setError] = useState("");

  const rpc = (window as any).__demoRpc;
  const effectiveRoot = root || (typeof process !== "undefined" ? process.cwd?.() : "/");

  const refresh = useCallback(async () => {
    if (!rpc || !effectiveRoot) return;
    setLoading(true);
    setError("");
    try {
      const [status, logResult] = await Promise.all([
        rpc.request.gitStatus({ repoRoot: effectiveRoot }),
        rpc.request.gitLog({ repoRoot: effectiveRoot, limit: 30 }),
      ]);
      setCurrentBranch(status.current);
      setFiles(status.files ?? []);
      setLog(logResult.all ?? []);
    } catch (e: any) {
      setError(e.message ?? "Git operation failed");
    } finally {
      setLoading(false);
    }
  }, [effectiveRoot, rpc]);

  useEffect(() => { refresh(); }, [refresh]);

  const stageFile = async (path: string) => {
    if (!rpc) return;
    await rpc.request.gitAdd({ repoRoot: effectiveRoot, files: path });
    refresh();
  };

  const commit = async () => {
    if (!rpc || !commitMsg.trim()) return;
    try {
      await rpc.request.gitCommit({ repoRoot: effectiveRoot, msg: commitMsg });
      setCommitMsg("");
      refresh();
    } catch (e: any) {
      setError(e.message ?? "Commit failed");
    }
  };

  const showDiff = async (filePath: string) => {
    if (!rpc) return;
    setSelectedFile(filePath);
    try {
      const diff = await rpc.request.gitDiff({ repoRoot: effectiveRoot, options: ["--", filePath] });
      setDiffText(diff);
    } catch { setDiffText(""); }
  };

  const stagedFiles = files.filter((f) => f.index !== " " && f.index !== "?");
  const unstagedFiles = files.filter((f) => f.working_dir !== " " || f.index === "?");

  return (
    <div className="flex h-full">
      {/* Left panel: status + commit */}
      <div className="w-80 shrink-0 flex flex-col border-r border-white/[0.06] bg-[#0f0f12]">
        {/* Header */}
        <div className="flex items-center justify-between px-3 py-2 border-b border-white/[0.06]">
          <div className="flex items-center gap-2 text-xs">
            <GitBranch size={13} className="text-green-400" />
            <span className="text-neutral-300 font-medium">{currentBranch ?? "..."}</span>
          </div>
          <button onClick={refresh} className="p-1 rounded text-neutral-500 hover:text-neutral-300 hover:bg-white/[0.06] transition-all">
            <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
          </button>
        </div>

        {error && (
          <div className="px-3 py-2 text-xs text-red-400 bg-red-500/10 border-b border-red-500/20">{error}</div>
        )}

        {/* Staged changes */}
        <div className="border-b border-white/[0.06]">
          <div className="px-3 py-1.5 text-[10px] font-bold text-neutral-500 uppercase tracking-widest">
            Staged ({stagedFiles.length})
          </div>
          {stagedFiles.map((f) => (
            <button
              key={`staged-${f.path}`}
              onClick={() => showDiff(f.path)}
              className={`flex items-center gap-2 w-full px-3 py-1 text-xs hover:bg-white/[0.06] transition-colors ${selectedFile === f.path ? "bg-white/[0.06] text-white" : "text-neutral-400"}`}
            >
              <span className="text-green-400 font-mono w-3 text-center">{f.index}</span>
              <FileText size={12} className="shrink-0" />
              <span className="truncate">{f.path}</span>
            </button>
          ))}
        </div>

        {/* Unstaged changes */}
        <div className="flex-1 overflow-y-auto border-b border-white/[0.06]">
          <div className="px-3 py-1.5 text-[10px] font-bold text-neutral-500 uppercase tracking-widest">
            Changes ({unstagedFiles.length})
          </div>
          {unstagedFiles.map((f) => (
            <div key={`unstaged-${f.path}`} className="flex items-center group">
              <button
                onClick={() => showDiff(f.path)}
                className={`flex items-center gap-2 flex-1 min-w-0 px-3 py-1 text-xs hover:bg-white/[0.06] transition-colors ${selectedFile === f.path ? "bg-white/[0.06] text-white" : "text-neutral-400"}`}
              >
                <span className="text-amber-400 font-mono w-3 text-center">{f.working_dir === "?" ? "?" : f.working_dir}</span>
                <FileText size={12} className="shrink-0" />
                <span className="truncate">{f.path}</span>
              </button>
              <button
                onClick={() => stageFile(f.path)}
                className="p-1 mr-1 rounded text-neutral-600 hover:text-green-400 hover:bg-white/[0.06] opacity-0 group-hover:opacity-100 transition-all"
                title="Stage file"
              >
                <Plus size={12} />
              </button>
            </div>
          ))}
          {files.length === 0 && !loading && (
            <div className="px-3 py-4 text-xs text-neutral-600 text-center">Working tree clean</div>
          )}
        </div>

        {/* Commit box */}
        <div className="p-3">
          <textarea
            value={commitMsg}
            onChange={(e) => setCommitMsg(e.target.value)}
            placeholder="Commit message..."
            className="w-full rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-sm text-white placeholder:text-neutral-600 outline-none focus:border-blue-500/50 resize-none"
            rows={3}
          />
          <button
            onClick={commit}
            disabled={!commitMsg.trim() || stagedFiles.length === 0}
            className="mt-2 w-full flex items-center justify-center gap-2 rounded-lg bg-green-600/80 hover:bg-green-600 disabled:bg-neutral-800 disabled:text-neutral-600 px-4 py-2 text-sm font-medium text-white transition-colors"
          >
            <Check size={14} />
            Commit ({stagedFiles.length} staged)
          </button>
        </div>
      </div>

      {/* Right panel: diff + log */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Diff view */}
        {selectedFile && diffText ? (
          <div className="flex-1 overflow-auto p-4">
            <div className="text-xs text-neutral-500 mb-2 font-mono">{selectedFile}</div>
            <pre className="text-xs font-mono leading-5 whitespace-pre-wrap">
              {diffText.split("\n").map((line, i) => {
                let color = "text-neutral-400";
                if (line.startsWith("+") && !line.startsWith("+++")) color = "text-green-400";
                else if (line.startsWith("-") && !line.startsWith("---")) color = "text-red-400";
                else if (line.startsWith("@@")) color = "text-blue-400";
                return <div key={i} className={color}>{line}</div>;
              })}
            </pre>
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center text-neutral-600 text-sm">
            Select a file to view diff
          </div>
        )}

        {/* Log */}
        <div className="border-t border-white/[0.06]">
          <button
            onClick={() => setShowLog(!showLog)}
            className="flex items-center gap-2 w-full px-3 py-2 text-xs text-neutral-500 hover:text-neutral-300 hover:bg-white/[0.04] transition-colors"
          >
            {showLog ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            <GitCommit size={12} />
            <span className="font-bold uppercase tracking-wider">History ({log.length})</span>
          </button>
          {showLog && (
            <div className="max-h-48 overflow-y-auto">
              {log.map((entry) => (
                <div key={entry.hash} className="flex items-baseline gap-3 px-3 py-1.5 text-xs hover:bg-white/[0.04] transition-colors">
                  <span className="text-blue-400 font-mono shrink-0">{entry.hash.slice(0, 7)}</span>
                  <span className="text-neutral-300 truncate flex-1">{entry.message}</span>
                  <span className="text-neutral-600 shrink-0">{entry.author_name}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
