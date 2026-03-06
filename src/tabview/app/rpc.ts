// RPC bridge — calls Bun via Electrobun RPC, falls back to mock data in browser dev mode.

import type { FileNode } from "../../stubs/types";

export interface SystemInfo {
  platform: string;
  arch: string;
  bunVersion: string;
  cwd: string;
  pid: number;
}

function getRpc() {
  return (window as any).__demoRpc ?? null;
}

// ── System ──

export async function ping(message: string): Promise<{ pong: string }> {
  const rpc = getRpc();
  if (rpc) return rpc.request.ping({ message });
  return { pong: `[mock] "${message}" — hello from mock Bun` };
}

export async function getSystemInfo(): Promise<SystemInfo> {
  const rpc = getRpc();
  if (rpc) return rpc.request.get_system_info({});
  return { platform: "browser (mock)", arch: "wasm", bunVersion: "n/a", cwd: "/mock/cwd", pid: 0 };
}

export async function openFileDialog(): Promise<{ files: string[] }> {
  const rpc = getRpc();
  if (rpc) return rpc.request.open_file_dialog({});
  return { files: ["/mock/file1.txt"] };
}

export async function openExternal(url: string): Promise<void> {
  const rpc = getRpc();
  if (rpc) return rpc.request.open_external({ url });
  window.open(url, "_blank");
}

// ── File operations ──

export async function readFile(path: string): Promise<{ textContent: string }> {
  const rpc = getRpc();
  if (rpc) return rpc.request.readFile({ path });
  return { textContent: "// Mock file content" };
}

export async function writeFile(path: string, value: string): Promise<{ success: boolean; error?: string }> {
  const rpc = getRpc();
  if (rpc) return rpc.request.writeFile({ path, value });
  return { success: true };
}

export async function readDir(path: string): Promise<FileNode[]> {
  const rpc = getRpc();
  if (rpc) return rpc.request.readDir({ path });
  return [];
}

export async function findFiles(query: string, cwd?: string): Promise<string[]> {
  const rpc = getRpc();
  if (rpc) return rpc.request.findFiles({ query, cwd });
  return [];
}

export async function findInFiles(query: string, cwd?: string) {
  const rpc = getRpc();
  if (rpc) return rpc.request.findInFiles({ query, cwd });
  return [];
}

// ── Terminal ──

export async function createTerminal(cwd: string, shell?: string): Promise<string> {
  const rpc = getRpc();
  if (rpc) return rpc.request.createTerminal({ cwd, shell });
  return "mock-terminal";
}

export async function writeToTerminal(terminalId: string, data: string): Promise<boolean> {
  const rpc = getRpc();
  if (rpc) return rpc.request.writeToTerminal({ terminalId, data });
  return false;
}

export async function killTerminal(terminalId: string): Promise<boolean> {
  const rpc = getRpc();
  if (rpc) return rpc.request.killTerminal({ terminalId });
  return false;
}

// ── Git operations ──

export async function gitStatus(repoRoot: string) {
  const rpc = getRpc();
  if (rpc) return rpc.request.gitStatus({ repoRoot });
  return { current: "main", tracking: null, files: [], ahead: 0, behind: 0 };
}

export async function gitLog(repoRoot: string, limit?: number) {
  const rpc = getRpc();
  if (rpc) return rpc.request.gitLog({ repoRoot, limit });
  return { all: [] };
}

export async function gitDiff(repoRoot: string, options?: string[]) {
  const rpc = getRpc();
  if (rpc) return rpc.request.gitDiff({ repoRoot, options });
  return "";
}

export async function gitAdd(repoRoot: string, files: string | string[]) {
  const rpc = getRpc();
  if (rpc) return rpc.request.gitAdd({ repoRoot, files });
  return "";
}

export async function gitCommit(repoRoot: string, msg: string) {
  const rpc = getRpc();
  if (rpc) return rpc.request.gitCommit({ repoRoot, msg });
  return { commit: "", summary: { changes: 0, insertions: 0, deletions: 0 } };
}
