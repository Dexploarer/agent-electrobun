import type { ElectrobunConfig } from "electrobun";

export default {
  app: {
    name: "AgentWorkspace",
    identifier: "com.ataraxy-labs.agent-workspace",
    version: "0.2.0",
  },
  build: {
    bun: {
      entrypoint: "src/bun/index.ts",
      external: [],
    },
    copy: {
      "dist/mainview/index.html": "views/mainview/index.html",
      "dist/tabview/index.html": "views/tabview/index.html",
      "dist/assets": "views/assets",
    },
    mac: { bundleCEF: false },
    linux: { bundleCEF: false },
    win: { bundleCEF: false },
  },
  runtime: {
    exitOnLastWindowClosed: false,
  },
} satisfies ElectrobunConfig;
