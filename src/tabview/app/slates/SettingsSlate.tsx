import { useState } from "react";
import { Settings, Monitor, Type, Palette, Terminal, Code2, Keyboard } from "lucide-react";

interface SettingsState {
  editor: {
    fontSize: number;
    tabSize: number;
    wordWrap: "on" | "off" | "bounded";
    minimap: boolean;
    lineNumbers: "on" | "off" | "relative";
    bracketPairColorization: boolean;
    renderWhitespace: "none" | "selection" | "all";
  };
  terminal: {
    fontSize: number;
    scrollback: number;
    cursorBlink: boolean;
    shell: string;
  };
  appearance: {
    sidebarWidth: number;
    showWelcomeOnStart: boolean;
  };
}

const defaultSettings: SettingsState = {
  editor: {
    fontSize: 13,
    tabSize: 2,
    wordWrap: "on",
    minimap: true,
    lineNumbers: "on",
    bracketPairColorization: true,
    renderWhitespace: "selection",
  },
  terminal: {
    fontSize: 13,
    scrollback: 10000,
    cursorBlink: true,
    shell: "",
  },
  appearance: {
    sidebarWidth: 224,
    showWelcomeOnStart: true,
  },
};

function loadSettings(): SettingsState {
  try {
    const stored = localStorage.getItem("agent-workspace-settings");
    if (stored) return { ...defaultSettings, ...JSON.parse(stored) };
  } catch {}
  return defaultSettings;
}

function saveSettings(settings: SettingsState) {
  localStorage.setItem("agent-workspace-settings", JSON.stringify(settings));
}

type SettingsSection = "editor" | "terminal" | "appearance" | "shortcuts";

export default function SettingsSlate() {
  const [settings, setSettings] = useState<SettingsState>(loadSettings);
  const [section, setSection] = useState<SettingsSection>("editor");
  const [saved, setSaved] = useState(false);

  const update = <K extends keyof SettingsState>(
    category: K,
    key: keyof SettingsState[K],
    value: SettingsState[K][typeof key]
  ) => {
    const next = { ...settings, [category]: { ...settings[category], [key]: value } };
    setSettings(next);
    saveSettings(next);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  const sections: { id: SettingsSection; label: string; icon: React.ReactNode }[] = [
    { id: "editor", label: "Editor", icon: <Code2 size={14} /> },
    { id: "terminal", label: "Terminal", icon: <Terminal size={14} /> },
    { id: "appearance", label: "Appearance", icon: <Palette size={14} /> },
    { id: "shortcuts", label: "Keyboard Shortcuts", icon: <Keyboard size={14} /> },
  ];

  return (
    <div className="flex h-full bg-[#0f0f12]">
      {/* Sidebar */}
      <div className="w-52 shrink-0 border-r border-white/[0.06] py-3">
        <div className="flex items-center gap-2 px-4 mb-4">
          <Settings size={16} className="text-neutral-400" />
          <span className="text-sm font-semibold text-neutral-300">Settings</span>
          {saved && <span className="text-[10px] text-green-400 ml-auto">Saved</span>}
        </div>
        {sections.map((s) => (
          <button
            key={s.id}
            onClick={() => setSection(s.id)}
            className={`flex items-center gap-2.5 w-full px-4 py-2 text-xs transition-colors ${
              section === s.id
                ? "text-white bg-white/[0.08]"
                : "text-neutral-500 hover:text-neutral-300 hover:bg-white/[0.04]"
            }`}
          >
            {s.icon}
            {s.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6 max-w-xl">
        {section === "editor" && (
          <div className="space-y-5">
            <SectionTitle>Editor</SectionTitle>

            <NumberSetting
              label="Font Size"
              value={settings.editor.fontSize}
              min={10} max={24}
              onChange={(v) => update("editor", "fontSize", v)}
            />
            <NumberSetting
              label="Tab Size"
              value={settings.editor.tabSize}
              min={1} max={8}
              onChange={(v) => update("editor", "tabSize", v)}
            />
            <SelectSetting
              label="Word Wrap"
              value={settings.editor.wordWrap}
              options={[
                { value: "on", label: "On" },
                { value: "off", label: "Off" },
                { value: "bounded", label: "Bounded" },
              ]}
              onChange={(v) => update("editor", "wordWrap", v as any)}
            />
            <ToggleSetting
              label="Minimap"
              value={settings.editor.minimap}
              onChange={(v) => update("editor", "minimap", v)}
            />
            <SelectSetting
              label="Line Numbers"
              value={settings.editor.lineNumbers}
              options={[
                { value: "on", label: "On" },
                { value: "off", label: "Off" },
                { value: "relative", label: "Relative" },
              ]}
              onChange={(v) => update("editor", "lineNumbers", v as any)}
            />
            <ToggleSetting
              label="Bracket Pair Colorization"
              value={settings.editor.bracketPairColorization}
              onChange={(v) => update("editor", "bracketPairColorization", v)}
            />
            <SelectSetting
              label="Render Whitespace"
              value={settings.editor.renderWhitespace}
              options={[
                { value: "none", label: "None" },
                { value: "selection", label: "Selection" },
                { value: "all", label: "All" },
              ]}
              onChange={(v) => update("editor", "renderWhitespace", v as any)}
            />
          </div>
        )}

        {section === "terminal" && (
          <div className="space-y-5">
            <SectionTitle>Terminal</SectionTitle>
            <NumberSetting
              label="Font Size"
              value={settings.terminal.fontSize}
              min={10} max={24}
              onChange={(v) => update("terminal", "fontSize", v)}
            />
            <NumberSetting
              label="Scrollback Lines"
              value={settings.terminal.scrollback}
              min={1000} max={100000} step={1000}
              onChange={(v) => update("terminal", "scrollback", v)}
            />
            <ToggleSetting
              label="Cursor Blink"
              value={settings.terminal.cursorBlink}
              onChange={(v) => update("terminal", "cursorBlink", v)}
            />
            <TextSetting
              label="Shell Path"
              value={settings.terminal.shell}
              placeholder="Default system shell"
              onChange={(v) => update("terminal", "shell", v)}
            />
          </div>
        )}

        {section === "appearance" && (
          <div className="space-y-5">
            <SectionTitle>Appearance</SectionTitle>
            <ToggleSetting
              label="Show Welcome Tab on Start"
              value={settings.appearance.showWelcomeOnStart}
              onChange={(v) => update("appearance", "showWelcomeOnStart", v)}
            />
          </div>
        )}

        {section === "shortcuts" && (
          <div className="space-y-5">
            <SectionTitle>Keyboard Shortcuts</SectionTitle>
            <div className="space-y-1">
              {[
                ["New Tab", "Cmd+T"],
                ["Close Tab", "Cmd+W"],
                ["Reopen Tab", "Cmd+Shift+T"],
                ["New Terminal", "Cmd+Shift+`"],
                ["Toggle Sidebar", "Cmd+B"],
                ["Next Tab", "Cmd+Shift+]"],
                ["Previous Tab", "Cmd+Shift+["],
                ["Go to Tab 1-9", "Cmd+1 ... Cmd+9"],
                ["Open File", "Cmd+O"],
                ["Open Folder", "Cmd+Shift+O"],
                ["Save File", "Cmd+S"],
                ["Quick Open", "Cmd+P"],
                ["Search in Files", "Cmd+Shift+F"],
              ].map(([action, shortcut]) => (
                <div key={action} className="flex items-center justify-between px-1 py-2 text-xs border-b border-white/[0.04]">
                  <span className="text-neutral-300">{action}</span>
                  <kbd className="px-2 py-0.5 rounded bg-white/[0.06] text-neutral-500 font-mono text-[11px]">{shortcut}</kbd>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="text-lg font-semibold text-white mb-1">{children}</h2>;
}

function NumberSetting({ label, value, min, max, step, onChange }: {
  label: string; value: number; min: number; max: number; step?: number; onChange: (v: number) => void;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm text-neutral-400">{label}</span>
      <input
        type="number"
        value={value}
        min={min} max={max} step={step ?? 1}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-20 rounded-md border border-white/[0.08] bg-white/[0.04] px-2 py-1 text-sm text-white text-right outline-none focus:border-blue-500/50"
      />
    </div>
  );
}

function SelectSetting({ label, value, options, onChange }: {
  label: string; value: string; options: { value: string; label: string }[]; onChange: (v: string) => void;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm text-neutral-400">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-md border border-white/[0.08] bg-white/[0.04] px-2 py-1 text-sm text-white outline-none focus:border-blue-500/50"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value} className="bg-[#1e1e1e]">{o.label}</option>
        ))}
      </select>
    </div>
  );
}

function ToggleSetting({ label, value, onChange }: {
  label: string; value: boolean; onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm text-neutral-400">{label}</span>
      <button
        onClick={() => onChange(!value)}
        className={`w-9 h-5 rounded-full transition-colors ${
          value ? "bg-blue-600" : "bg-neutral-700"
        }`}
      >
        <div className={`w-3.5 h-3.5 rounded-full bg-white transition-transform ${
          value ? "translate-x-[18px]" : "translate-x-[3px]"
        }`} />
      </button>
    </div>
  );
}

function TextSetting({ label, value, placeholder, onChange }: {
  label: string; value: string; placeholder: string; onChange: (v: string) => void;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm text-neutral-400">{label}</span>
      <input
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="w-48 rounded-md border border-white/[0.08] bg-white/[0.04] px-2 py-1 text-sm text-white placeholder:text-neutral-600 outline-none focus:border-blue-500/50"
      />
    </div>
  );
}
