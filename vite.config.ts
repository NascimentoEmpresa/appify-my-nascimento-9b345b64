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
    build: {
      // O bundle era UM arquivo só, e cresceu até quebrar o build: ao entrar
      // a engine 3D do Mapa de T.I (three + @react-three), o parser do
      // Rollup estourou com "WebAssembly.Memory.grow(): Unable to grow
      // instance memory" — o arquivo passou do que o analisador aguenta ler.
      //
      // Separar as bibliotecas pesadas resolve o build E o carregamento: o
      // three só desce para quem abre o mapa 3D (as telas usam React.lazy),
      // o xlsx só para quem exporta planilha, e assim por diante. Antes,
      // todo usuário do ERP baixava tudo para abrir a tela inicial.
      //
      // Se aparecer outra lib grande, o lugar de registrar é aqui.
      chunkSizeWarningLimit: 1500,
      rollupOptions: {
        output: {
          manualChunks: {
            "vendor-3d": ["three", "@react-three/fiber", "@react-three/drei"],
            "vendor-planilha": ["xlsx"],
            "vendor-pdf": ["jspdf", "jspdf-autotable"],
            "vendor-graficos": ["recharts"],
            "vendor-react": ["react", "react-dom", "react-router-dom"],
          },
        },
      },
    },
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
      dedupe: ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime", "@tanstack/react-query", "@tanstack/query-core"],
    },
  };
});
