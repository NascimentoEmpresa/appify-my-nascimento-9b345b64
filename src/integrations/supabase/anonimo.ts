import { createClient } from "@supabase/supabase-js";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "./env";

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
// URL e chave vêm do `.env` pelo módulo `env.ts`, o mesmo que o cliente
// padrão usa — rotacionar a chave é mexer num arquivo só.
// =====================================================================
export const supabaseAnonimo = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
});
