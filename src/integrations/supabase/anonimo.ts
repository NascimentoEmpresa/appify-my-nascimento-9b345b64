import { createClient } from "@supabase/supabase-js";

// =====================================================================
// CLIENTE ANÔNIMO — para páginas públicas que NÃO podem carregar identidade
//
// O cliente padrão (`client.ts`) guarda a sessão no localStorage e anexa o
// JWT do usuário em toda requisição. No Canal de Ética isso quebraria a
// promessa da tela: um colaborador logado no ERP que abrisse /denuncia
// mandaria o próprio token junto do relato — e mesmo que a RPC não grave
// auth.uid(), o token aparece no caminho até o banco.
//
// Aqui a sessão é ignorada de propósito: nada é lido do localStorage, nada é
// persistido, nada é renovado. Sai só a chave anon, igual à de um visitante
// que nunca entrou no sistema.
//
// URL e chave repetem os valores de `client.ts` porque aquele arquivo é
// gerado automaticamente e não os exporta. Se a chave anon for rotacionada,
// os dois lugares precisam mudar juntos.
// =====================================================================
const SUPABASE_URL = "https://fwmzeaztjxrxxzxzxmgc.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ3bXplYXp0anhyeHh6eHp4bWdjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY2MDc0NTAsImV4cCI6MjA5MjE4MzQ1MH0.i08oF2-9N6w-CxDVy8ink29-ydHTJEc-eQBZDYRxGwI";

export const supabaseAnonimo = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
});
