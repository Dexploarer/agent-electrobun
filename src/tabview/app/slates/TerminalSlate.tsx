import { useEffect, useRef, useState } from "react";
import { Terminal as TerminalIcon, X } from "lucide-react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { SearchAddon } from "@xterm/addon-search";

export default function TerminalSlate({ cwd }: { cwd?: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const terminalIdRef = useRef<string | null>(null);
  const [isReady, setIsReady] = useState(false);

  const rpc = (window as any).__demoRpc;

  useEffect(() => {
    if (!containerRef.current || !rpc) return;

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: "'Monaco', 'Menlo', 'Courier New', monospace",
      theme: {
        background: "#0a0a0a",
        foreground: "#d9d9d9",
        cursor: "#d9d9d9",
        cursorAccent: "#0a0a0a",
        selectionBackground: "#4353ff55",
        black: "#0a0a0a",
        red: "#ff5555",
        green: "#50fa7b",
        yellow: "#f1fa8c",
        blue: "#6272a4",
        magenta: "#ff79c6",
        cyan: "#8be9fd",
        white: "#d9d9d9",
      },
      scrollback: 10000,
      convertEol: true,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(new SearchAddon());
    term.loadAddon(new WebLinksAddon((_event, uri) => {
      window.open(uri, "_blank");
    }));

    term.open(containerRef.current);
    terminalRef.current = term;
    fitAddonRef.current = fitAddon;

    requestAnimationFrame(() => fitAddon.fit());

    // Create terminal in backend
    rpc.request.createTerminal({ cwd: cwd ?? "/" }).then((id: string) => {
      terminalIdRef.current = id;
      setIsReady(true);

      // User input -> backend
      term.onData((data: string) => {
        rpc.request.writeToTerminal({ terminalId: id, data });
      });

      // Resize
      term.onResize(({ cols, rows }: { cols: number; rows: number }) => {
        rpc.request.resizeTerminal({ terminalId: id, cols, rows });
      });
    });

    // Backend -> terminal output
    const handleOutput = (e: Event) => {
      const { terminalId, data } = (e as CustomEvent).detail;
      if (terminalId === terminalIdRef.current) {
        term.write(data);
      }
    };
    const handleExit = (e: Event) => {
      const { terminalId, exitCode } = (e as CustomEvent).detail;
      if (terminalId === terminalIdRef.current) {
        term.write(`\r\n\x1b[90mProcess exited with code ${exitCode}\x1b[0m\r\n`);
      }
    };

    window.addEventListener("terminalOutput", handleOutput);
    window.addEventListener("terminalExit", handleExit);

    // Resize observer
    const resizeObserver = new ResizeObserver(() => {
      requestAnimationFrame(() => fitAddon.fit());
    });
    resizeObserver.observe(containerRef.current);

    return () => {
      window.removeEventListener("terminalOutput", handleOutput);
      window.removeEventListener("terminalExit", handleExit);
      resizeObserver.disconnect();
      if (terminalIdRef.current) {
        rpc.request.killTerminal({ terminalId: terminalIdRef.current });
      }
      term.dispose();
    };
  }, [cwd]);

  return (
    <div className="flex flex-col h-full bg-[#0a0a0a]">
      {/* Terminal toolbar */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-[#0f0f12] border-b border-white/[0.06]">
        <div className="flex items-center gap-2 text-xs text-neutral-500">
          <TerminalIcon size={12} />
          <span>{cwd ?? "/"}</span>
          {isReady && <span className="text-green-500/80">Connected</span>}
        </div>
      </div>
      {/* xterm container */}
      <div ref={containerRef} className="flex-1 min-h-0 px-1" />
    </div>
  );
}
