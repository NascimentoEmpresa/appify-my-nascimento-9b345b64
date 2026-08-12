import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  return {
    server: {
      host: "::",
      port: 8080,
      hmr: {
        overlay: false,
      },
      watch: {
        // worker/ é um projeto Node separado (não faz parte do app Vite) —
        // tem node_modules próprio e o perfil do Chrome do WhatsApp
        // (.wwebjs_auth), cujos arquivos ficam travados pelo SO enquanto em
        // uso. Vite tentando vigiar isso trava o dev server (EBUSY).
        ignored: ["**/worker/**"],
      },
    },
    plugins: [react(), mode === "development" && componentTagger()].filter(Boolean),
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
      dedupe: ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime", "@tanstack/react-query", "@tanstack/query-core"],
    },
  };
});
