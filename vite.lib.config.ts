import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The package build: `npm run build` (this, then declarations). Three entries, React and react-dom left for the host to supply.
// Only the main entry carries "use client": `core` and `svg` hold no hooks, so a server component can import them.
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: true,
    minify: false,
    target: "es2022",
    lib: { entry: { index: "src/index.ts", core: "src/core.ts", svg: "src/svg.ts" }, formats: ["es"] },
    rollupOptions: {
      external: [/^react($|\/)/, /^react-dom($|\/)/],
      output: { banner: (chunk) => (chunk.name === "index" ? '"use client";' : "") },
    },
  },
});
