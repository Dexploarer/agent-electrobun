import { Zap, Terminal, Globe, GitBranch, FileText, Search, Settings } from "lucide-react";

export default function WelcomeSlate() {
  const rpc = (window as any).__demoRpc;

  const openFileDialog = async () => {
    if (!rpc) return;
    try {
      const { files } = await rpc.request.open_file_dialog({});
      // Files opened via dialog will be handled by the backend
    } catch {}
  };

  return (
    <div className="flex items-center justify-center h-full">
      <div className="max-w-lg w-full px-8">
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-bold text-white mb-2">Agent Workspace</h1>
          <p className="text-white/40 text-sm">
            A hybrid browser + code editor for your AI agent. Built on Electrobun + co(lab).
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3 mb-8">
          <QuickAction icon={<FileText size={18} />} label="Open File" shortcut="Cmd+O" color="blue" onClick={openFileDialog} />
          <QuickAction icon={<Terminal size={18} />} label="Terminal" shortcut="Cmd+Shift+`" color="green" />
          <QuickAction icon={<Search size={18} />} label="Search" shortcut="Cmd+P" color="purple" />
          <QuickAction icon={<GitBranch size={18} />} label="Git" shortcut="" color="orange" />
          <QuickAction icon={<Globe size={18} />} label="Browser" shortcut="" color="cyan" />
          <QuickAction icon={<Settings size={18} />} label="Settings" shortcut="Cmd+," color="gray" />
        </div>

        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-5">
          <div className="flex items-center gap-2 mb-3">
            <Zap size={14} className="text-yellow-400" />
            <span className="text-sm font-semibold text-white/70">Stack</span>
          </div>
          <ul className="text-sm text-white/40 space-y-1.5 list-disc list-inside">
            <li>Electrobun — Bun + WKWebView desktop runtime</li>
            <li>Monaco Editor — VS Code's editor component</li>
            <li>xterm.js — Full terminal emulator</li>
            <li>simple-git — Git operations via Bun backend</li>
            <li>React 19 + Tailwind CSS v4</li>
          </ul>
        </div>

        <div className="mt-6 text-center">
          <p className="text-xs text-white/20">
            Cmd+B toggle sidebar &middot; Cmd+T new tab &middot; Cmd+W close tab &middot; Cmd+P search &middot; Cmd+, settings
          </p>
        </div>
      </div>
    </div>
  );
}

function QuickAction({ icon, label, shortcut, color, onClick }: {
  icon: React.ReactNode; label: string; shortcut: string; color: string; onClick?: () => void;
}) {
  const colorMap: Record<string, string> = {
    blue: "border-blue-500/20 hover:border-blue-500/40 text-blue-400",
    green: "border-green-500/20 hover:border-green-500/40 text-green-400",
    purple: "border-violet-500/20 hover:border-violet-500/40 text-violet-400",
    orange: "border-orange-500/20 hover:border-orange-500/40 text-orange-400",
    cyan: "border-cyan-500/20 hover:border-cyan-500/40 text-cyan-400",
    gray: "border-neutral-500/20 hover:border-neutral-500/40 text-neutral-400",
  };
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-3 p-4 rounded-xl border bg-white/[0.02] hover:bg-white/[0.05] transition-all cursor-pointer text-left ${colorMap[color] ?? colorMap.gray}`}
    >
      {icon}
      <div>
        <p className="text-sm font-medium text-white">{label}</p>
        {shortcut && <p className="text-[10px] text-white/30">{shortcut}</p>}
      </div>
    </button>
  );
}
