import { defineConfig } from "vite";
import { fileURLToPath } from "url";

// Two pages from one codebase: / for backend roles, /full-stack/ for full-stack roles.
export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL("index.html", import.meta.url)),
        fullStack: fileURLToPath(new URL("full-stack/index.html", import.meta.url)),
      },
    },
  },
});
