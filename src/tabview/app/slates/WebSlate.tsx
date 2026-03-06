import { useState, useRef, useEffect } from "react";
import { Globe, ArrowLeft, ArrowRight, RotateCw, ExternalLink } from "lucide-react";

export default function WebSlate({ initialUrl }: { initialUrl?: string }) {
  const [url, setUrl] = useState(initialUrl ?? "https://www.google.com");
  const [inputUrl, setInputUrl] = useState(url);
  const [isLoading, setIsLoading] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const rpc = (window as any).__demoRpc;

  const navigate = (newUrl: string) => {
    let normalized = newUrl;
    if (!normalized.startsWith("http://") && !normalized.startsWith("https://")) {
      // Treat as search if no protocol
      if (normalized.includes(".") && !normalized.includes(" ")) {
        normalized = "https://" + normalized;
      } else {
        normalized = `https://www.google.com/search?q=${encodeURIComponent(normalized)}`;
      }
    }
    setUrl(normalized);
    setInputUrl(normalized);
    setIsLoading(true);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      navigate(inputUrl);
    }
  };

  const openExternal = () => {
    if (rpc) rpc.request.open_external({ url });
    else window.open(url, "_blank");
  };

  return (
    <div className="flex flex-col h-full bg-[#0f0f12]">
      {/* URL bar */}
      <div className="flex items-center gap-2 px-3 py-2 bg-[#161618] border-b border-white/[0.06]">
        <div className="flex items-center gap-1">
          <button className="p-1.5 rounded-md text-neutral-500 hover:text-neutral-300 hover:bg-white/[0.06] transition-all" onClick={() => iframeRef.current?.contentWindow?.history.back()}>
            <ArrowLeft size={14} />
          </button>
          <button className="p-1.5 rounded-md text-neutral-500 hover:text-neutral-300 hover:bg-white/[0.06] transition-all" onClick={() => iframeRef.current?.contentWindow?.history.forward()}>
            <ArrowRight size={14} />
          </button>
          <button className="p-1.5 rounded-md text-neutral-500 hover:text-neutral-300 hover:bg-white/[0.06] transition-all" onClick={() => navigate(url)}>
            <RotateCw size={14} className={isLoading ? "animate-spin" : ""} />
          </button>
        </div>

        <div className="flex-1 flex items-center gap-2 bg-white/[0.05] rounded-lg px-3 py-1.5 border border-white/[0.08] focus-within:border-blue-500/50 transition-colors">
          <Globe size={13} className="text-neutral-500 shrink-0" />
          <input
            type="text"
            value={inputUrl}
            onChange={(e) => setInputUrl(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Enter URL or search..."
            className="flex-1 bg-transparent text-sm text-white placeholder:text-neutral-600 outline-none"
          />
        </div>

        <button onClick={openExternal} className="p-1.5 rounded-md text-neutral-500 hover:text-neutral-300 hover:bg-white/[0.06] transition-all" title="Open in system browser">
          <ExternalLink size={14} />
        </button>
      </div>

      {/* Web content */}
      <div className="flex-1 min-h-0 relative">
        <iframe
          ref={iframeRef}
          src={url}
          className="w-full h-full border-0"
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
          onLoad={() => setIsLoading(false)}
        />
      </div>
    </div>
  );
}
