import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  // Falha no BUILD (e não com tela branca no navegador) quando o .env da
  // máquina não tem a configuração do Supabase. Ver .env.example.
  const env = loadEnv(mode, process.cwd(), "VITE_");
  const faltando = ["VITE_SUPABASE_URL", "VITE_SUPABASE_ANON_KEY"].filter((k) => !env[k]);
  if (faltando.length > 0) {
    throw new Error(
      `Configuração ausente no .env: ${faltando.join(", ")}. Copie o .env.example para .env e preencha antes de rodar/buildar.`,
    );
  }

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
