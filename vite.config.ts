import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  // As credenciais do front vivem no .env, que não é versionado — então toda
  // máquina que builda precisa ter o arquivo. Faltando, o Vite embutiria
  // `undefined` no bundle e o app subiria quebrado só no primeiro request:
  // falha silenciosa que só aparece em produção, e foi assim que a produção
  // ficou num bundle velho em 12/08/2026. Melhor parar aqui, dizendo o que
  // faltou.
  const env = loadEnv(mode, process.cwd(), "");
  const faltando = ["VITE_SUPABASE_URL", "VITE_SUPABASE_ANON_KEY"].filter((k) => !env[k]);
  if (faltando.length) {
    throw new Error(
      `Faltam variáveis de ambiente: ${faltando.join(", ")}. ` +
        "Copie o .env.example para .env e preencha antes de rodar o build.",
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
