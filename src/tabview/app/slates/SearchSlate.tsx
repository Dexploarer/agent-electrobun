import { useState, useCallback, useRef, useEffect } from "react";
import { Search, FileText, Hash, Loader2, FolderOpen, ArrowRight } from "lucide-react";

interface FileResult {
  path: string;
}

interface ContentResult {
  path: string;
  line: number;
  column: number;
  match: string;
}

type SearchMode = "files" | "content";

export default function SearchSlate() {
  const [mode, setMode] = useState<SearchMode>("files");
  const [query, setQuery] = useState("");
  const [fileResults, setFileResults] = useState<FileResult[]>([]);
  const [contentResults, setContentResults] = useState<ContentResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const rpc = (window as any).__demoRpc;

  useEffect(() => {
    inputRef.current?.focus();
  }, [mode]);

  const doSearch = useCallback(async (q: string) => {
    if (!rpc || !q.trim()) {
      setFileResults([]);
      setContentResults([]);
      setSearched(false);
      return;
    }

    setLoading(true);
    setSearched(true);
    try {
      if (mode === "files") {
        const results = await rpc.request.findFiles({ query: q });
        setFileResults(results.map((p: string) => ({ path: p })));
      } else {
        const results = await rpc.request.findInFiles({ query: q });
        setContentResults(results);
      }
    } catch {
      setFileResults([]);
      setContentResults([]);
    } finally {
      setLoading(false);
    }
  }, [rpc, mode]);

  const handleInput = (value: string) => {
    setQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doSearch(value), 250);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      doSearch(query);
    }
  };

  const openFile = (filePath: string) => {
    if (!rpc) return;
    // Navigate parent shell to open file tab via postMessage
    window.parent?.postMessage({ type: "openFile", filePath }, "*");
  };

  // Group content results by file
  const groupedResults = contentResults.reduce<Record<string, ContentResult[]>>((acc, r) => {
    (acc[r.path] ??= []).push(r);
    return acc;
  }, {});

  return (
    <div className="flex flex-col h-full bg-[#0f0f12]">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-white/[0.06]">
        <Search size={16} className="text-neutral-500" />
        <span className="text-sm font-semibold text-neutral-300">Search</span>
        <div className="flex-1" />
        <div className="flex rounded-lg border border-white/[0.08] overflow-hidden">
          <button
            onClick={() => setMode("files")}
            className={`px-3 py-1 text-xs font-medium transition-colors ${
              mode === "files" ? "bg-white/[0.1] text-white" : "text-neutral-500 hover:text-neutral-300"
            }`}
          >
            Files
          </button>
          <button
            onClick={() => setMode("content")}
            className={`px-3 py-1 text-xs font-medium transition-colors ${
              mode === "content" ? "bg-white/[0.1] text-white" : "text-neutral-500 hover:text-neutral-300"
            }`}
          >
            Content
          </button>
        </div>
      </div>

      {/* Search input */}
      <div className="px-4 py-3 border-b border-white/[0.06]">
        <div className="flex items-center gap-2 bg-white/[0.05] rounded-lg px-3 py-2 border border-white/[0.08] focus-within:border-blue-500/50 transition-colors">
          {mode === "files" ? (
            <FileText size={14} className="text-neutral-500 shrink-0" />
          ) : (
            <Hash size={14} className="text-neutral-500 shrink-0" />
          )}
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => handleInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={mode === "files" ? "Search file names..." : "Search in file contents..."}
            className="flex-1 bg-transparent text-sm text-white placeholder:text-neutral-600 outline-none"
            autoFocus
          />
          {loading && <Loader2 size={14} className="text-neutral-500 animate-spin" />}
        </div>
      </div>

      {/* Results */}
      <div className="flex-1 overflow-y-auto">
        {mode === "files" ? (
          <>
            {fileResults.length > 0 && (
              <div className="px-3 py-1.5 text-[10px] font-bold text-neutral-500 uppercase tracking-widest">
                {fileResults.length} file{fileResults.length !== 1 ? "s" : ""} found
              </div>
            )}
            {fileResults.map((r) => {
              const parts = r.path.split("/");
              const fileName = parts.pop()!;
              const dirPath = parts.join("/");
              return (
                <button
                  key={r.path}
                  onClick={() => openFile(r.path)}
                  className="flex items-center gap-2 w-full px-4 py-1.5 text-xs hover:bg-white/[0.06] transition-colors group"
                >
                  <FileText size={13} className="shrink-0 text-neutral-500" />
                  <span className="text-neutral-200 font-medium">{fileName}</span>
                  <span className="text-neutral-600 truncate flex-1 text-left">{dirPath}</span>
                  <ArrowRight size={12} className="text-neutral-700 opacity-0 group-hover:opacity-100 transition-opacity" />
                </button>
              );
            })}
          </>
        ) : (
          <>
            {Object.keys(groupedResults).length > 0 && (
              <div className="px-3 py-1.5 text-[10px] font-bold text-neutral-500 uppercase tracking-widest">
                {contentResults.length} match{contentResults.length !== 1 ? "es" : ""} in {Object.keys(groupedResults).length} file{Object.keys(groupedResults).length !== 1 ? "s" : ""}
              </div>
            )}
            {Object.entries(groupedResults).map(([filePath, matches]) => {
              const fileName = filePath.split("/").pop()!;
              return (
                <div key={filePath}>
                  <button
                    onClick={() => openFile(filePath)}
                    className="flex items-center gap-2 w-full px-4 py-1.5 text-xs text-neutral-300 hover:bg-white/[0.06] transition-colors"
                  >
                    <FolderOpen size={12} className="text-amber-500/70 shrink-0" />
                    <span className="font-medium">{fileName}</span>
                    <span className="text-neutral-600 text-[10px]">({matches.length})</span>
                  </button>
                  {matches.slice(0, 10).map((m, i) => (
                    <button
                      key={`${m.path}:${m.line}:${i}`}
                      onClick={() => openFile(m.path)}
                      className="flex items-center gap-2 w-full pl-8 pr-4 py-1 text-xs hover:bg-white/[0.06] transition-colors group"
                    >
                      <span className="text-neutral-600 font-mono w-8 text-right shrink-0">{m.line}</span>
                      <span className="text-neutral-400 truncate text-left flex-1 font-mono">{highlightMatch(m.match, query)}</span>
                    </button>
                  ))}
                  {matches.length > 10 && (
                    <div className="pl-8 pr-4 py-1 text-[10px] text-neutral-600">
                      +{matches.length - 10} more matches
                    </div>
                  )}
                </div>
              );
            })}
          </>
        )}

        {searched && !loading && fileResults.length === 0 && contentResults.length === 0 && query.trim() && (
          <div className="flex flex-col items-center justify-center py-12 text-neutral-600">
            <Search size={24} className="mb-2 opacity-50" />
            <p className="text-sm">No results found</p>
          </div>
        )}

        {!searched && !query.trim() && (
          <div className="flex flex-col items-center justify-center py-12 text-neutral-600">
            <Search size={24} className="mb-2 opacity-50" />
            <p className="text-sm">
              {mode === "files" ? "Type to search file names" : "Type to search file contents"}
            </p>
            <p className="text-xs text-neutral-700 mt-1">Results limited to 100 files / 200 matches</p>
          </div>
        )}
      </div>
    </div>
  );
}

function highlightMatch(text: string, query: string): React.ReactNode {
  if (!query) return text;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return text;
  return (
    <>
      {text.slice(0, idx)}
      <span className="text-amber-400 font-semibold">{text.slice(idx, idx + query.length)}</span>
      {text.slice(idx + query.length)}
    </>
  );
}
