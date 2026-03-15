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
    },
    format: ["esm"],
    platform: "node",
    sourcemap: true,
  },
]);
