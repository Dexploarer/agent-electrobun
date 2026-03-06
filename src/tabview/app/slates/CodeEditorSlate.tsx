import { useEffect, useRef, useState } from "react";
import { monaco } from "../monaco-env";
import { Save } from "lucide-react";

// Language detection from file extension
function getLanguage(filePath: string): string {
  const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript",
    json: "json", html: "html", css: "css", scss: "scss", less: "less",
    md: "markdown", py: "python", rs: "rust", go: "go", java: "java",
    c: "c", cpp: "cpp", h: "c", hpp: "cpp", sh: "shell", bash: "shell",
    yml: "yaml", yaml: "yaml", toml: "ini", xml: "xml", sql: "sql",
    graphql: "graphql", swift: "swift", kt: "kotlin", rb: "ruby",
    php: "php", zig: "zig",
  };
  return map[ext] ?? "plaintext";
}

export default function CodeEditorSlate({ filePath }: { filePath: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  const rpc = (window as any).__demoRpc;

  useEffect(() => {
    if (!containerRef.current) return;

    // Define dark theme matching colab
    monaco.editor.defineTheme("agentDark", {
      base: "vs-dark",
      inherit: true,
      rules: [
        { token: "comment", foreground: "6A9955" },
        { token: "keyword", foreground: "569CD6" },
        { token: "string", foreground: "CE9178" },
        { token: "number", foreground: "B5CEA8" },
        { token: "type", foreground: "4EC9B0" },
      ],
      colors: {
        "editor.background": "#0f0f12",
        "editor.foreground": "#d4d4d4",
        "editor.lineHighlightBackground": "#1a1a20",
        "editor.selectionBackground": "#4353ff44",
        "editorCursor.foreground": "#d4d4d4",
        "editorLineNumber.foreground": "#555566",
        "editorLineNumber.activeForeground": "#cccccc",
      },
    });

    // Load file content
    const loadContent = async () => {
      let content = "";
      if (rpc) {
        try {
          const result = await rpc.request.readFile({ path: filePath });
          content = result.textContent ?? "";
        } catch {}
      }

      const editor = monaco.editor.create(containerRef.current!, {
        value: content,
        language: getLanguage(filePath),
        theme: "agentDark",
        fontSize: 13,
        fontFamily: "'Monaco', 'Menlo', 'Courier New', monospace",
        minimap: { enabled: true, scale: 1 },
        scrollBeyondLastLine: false,
        automaticLayout: true,
        tabSize: 2,
        wordWrap: "on",
        lineNumbers: "on",
        renderWhitespace: "selection",
        bracketPairColorization: { enabled: true },
        padding: { top: 8 },
        smoothScrolling: true,
        cursorBlinking: "smooth",
        cursorSmoothCaretAnimation: "on",
      });

      editorRef.current = editor;

      // Track dirty state
      editor.onDidChangeModelContent(() => setIsDirty(true));

      // Save on Cmd+S
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => saveFile());
    };

    loadContent();

    return () => {
      editorRef.current?.dispose();
      editorRef.current = null;
    };
  }, [filePath]);

  const saveFile = async () => {
    if (!editorRef.current || !rpc) return;
    setSaving(true);
    try {
      const value = editorRef.current.getValue();
      await rpc.request.writeFile({ path: filePath, value });
      setIsDirty(false);
    } catch (e) {
      console.error("Save failed:", e);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Editor toolbar */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-[#0f0f12] border-b border-white/[0.06]">
        <div className="flex items-center gap-2 text-xs text-neutral-500">
          <span className="font-mono truncate max-w-md">{filePath}</span>
          {isDirty && <span className="text-amber-400/80">Modified</span>}
        </div>
        <button
          onClick={saveFile}
          disabled={!isDirty || saving}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium text-neutral-400 hover:text-white hover:bg-white/[0.06] disabled:opacity-30 disabled:cursor-default transition-colors"
        >
          <Save size={12} />
          {saving ? "Saving..." : "Save"}
        </button>
      </div>
      {/* Monaco container */}
      <div ref={containerRef} className="flex-1 min-h-0" />
    </div>
  );
}
