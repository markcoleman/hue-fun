import { defineConfig } from "tsdown";

export default defineConfig([
  {
    clean: true,
    dts: true,
    entry: ["src/index.ts"],
    exports: true,
    format: ["esm", "cjs"],
    platform: "neutral",
    sourcemap: true,
  },
  {
    clean: false,
    dts: false,
    entry: {
      hue: "src/cli/bin.ts",
      "hue-mcp": "src/mcp/bin.ts",
    },
    format: ["esm"],
    platform: "node",
    sourcemap: true,
  },
  {
    clean: false,
    deps: {
      alwaysBundle: ["commander", "picocolors", "prompts", "yaml"],
    },
    dts: false,
    entry: {
      "hue-sea": "src/cli/sea.ts",
    },
    format: ["cjs"],
    platform: "node",
    sourcemap: true,
  },
]);
