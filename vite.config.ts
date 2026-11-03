import { defineConfig } from "vite";
import type { Plugin } from "vite";
import react from "@vitejs/plugin-react";

// examples/ sits outside the demo's root, and Vite only notices new files inside its root, so a spec file added while
// the server runs would never reach the picker. Watch the folder and reload the page when one is added or removed.
const examplesDir = (() => {
  const path = decodeURIComponent(new URL("./examples", import.meta.url).pathname);
  return /^\/[A-Za-z]:/.test(path) ? path.slice(1) : path; // "/C:/..." on Windows
})();

const watchExamples = (): Plugin => ({
  name: "watch-examples",
  configureServer(server) {
    server.watcher.add(examplesDir);
    const onChange = (file: string) => {
      if (!file.replace(/\\/g, "/").startsWith(examplesDir) || !file.endsWith(".json")) return;
      server.moduleGraph.invalidateAll(); // the picker's file list is cached in the transformed module
      server.ws.send({ type: "full-reload" });
    };
    server.watcher.on("add", onChange);
    server.watcher.on("unlink", onChange);
  },
});

// The demo lives in demo/; the library itself is plain TS/TSX under src/ and needs no build step yet.
export default defineConfig({
  root: "demo",
  plugins: [react(), watchExamples()],
  server: { fs: { allow: [".."] } },
  build: { outDir: "../dist-demo", emptyOutDir: true },
});
