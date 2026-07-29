// =====================================================================
// Configuração de acesso ao Supabase — lida SEMPRE do .env (Vite).
//
// Nada de URL/chave hardcoded no código: os valores vêm de
//   VITE_SUPABASE_URL
//   VITE_SUPABASE_ANON_KEY
// definidos no .env da máquina que faz o build (ver .env.example).
//
// Lembrete: a chave anon é embutida no bundle no build — ela é pública por
// natureza. Quem protege os dados é a RLS do banco, não o sigilo da chave.
// O .env serve para não versionar credencial e para trocar de ambiente sem
// mexer no código. Chave de servidor (service_role) NUNCA entra aqui.
// =====================================================================
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

if (!url || !anonKey) {
  throw new Error(
    "Supabase não configurado: defina VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY no .env antes de rodar/buildar (veja .env.example).",
  );
}

export const SUPABASE_URL = url;
export const SUPABASE_ANON_KEY = anonKey;
