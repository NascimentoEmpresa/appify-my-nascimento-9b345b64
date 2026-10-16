// Gerado originalmente pelo Lovable. EDITADO À MÃO: a URL e a chave anon
// saíram do literal e passaram a vir do `.env` (ver ./env.ts). Se o Lovable
// regerar este arquivo, ele volta com as credenciais escritas aqui dentro —
// é só reaplicar estas duas linhas.
import { createClient } from '@supabase/supabase-js';
import type { Database } from './types';
import { SUPABASE_ANON_KEY, SUPABASE_URL } from './env';

// Import the supabase client like this:
// import { supabase } from "@/integrations/supabase/client";

export const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: localStorage,
    persistSession: true,
    autoRefreshToken: true,
    // POR QUE ESTA LINHA EXISTE (16/10/2026, véspera do corte para o cluster)
    //
    // Sem `storageKey`, o supabase-js INVENTA a chave do localStorage a partir
    // da URL: ele pega o primeiro rótulo do host. Hoje a URL é
    // `https://fwmzeaztjxrxxzxzxmgc.supabase.co`, então a sessão de todo mundo
    // está gravada em `sb-fwmzeaztjxrxxzxzxmgc-auth-token` — exatamente o
    // valor abaixo. Trocar a URL para `https://api.grpnascimento.com.br`
    // mudaria a chave para `sb-api-auth-token`, um espaço VAZIO: o navegador
    // não acharia a sessão e os ~157 usuários logados cairiam na tela de
    // login no momento da virada, cada um com a senha que talvez não lembre.
    //
    // Com a chave fixada, o navegador continua achando a sessão. O token de
    // acesso que está lá dentro vai ser recusado pelo cluster (a produção
    // assina em ES256 com chave privada da Supabase, que não existe fora de
    // lá; o cluster assina em HS256) — mas o `refresh_token` ao lado dele é
    // uma string opaca conferida NO BANCO, e `auth.refresh_tokens` foi
    // copiado para o cluster. Então o autoRefreshToken troca o token morto
    // por um vivo e o usuário não vê nada.
    //
    // NÃO mexer no valor: ele não é "o nome do projeto", é o endereço da
    // gaveta onde a sessão dos usuários já está. Mudar = deslogar todo mundo.
    // Se o Lovable regerar este arquivo, esta linha tem que voltar.
    storageKey: 'sb-fwmzeaztjxrxxzxzxmgc-auth-token',
  }
});
