// Arquivo: supabase/functions/fornecedor-cadastro-publico/index.ts
// Cadastro de fornecedor preenchido pelo próprio fornecedor — o endpoint que a
// página /fornecedor/cadastro/:token chama (SIS-2026-0209).
//
// POR QUE EXISTE
// Mesmo motivo do denuncia-registrar: falar direto com o PostgREST obriga o
// navegador a carregar a chave anon. Aqui o navegador manda JSON puro, SEM
// header de autenticação — quem guarda a chave é esta função, no servidor.
//
// verify_jwt = false no config.toml: é público de propósito, porque quem
// preenche é alguém de fora, que não tem (nem deve ter) conta no ERP.
//
// Usa a chave ANON, não a service role: assim o GRANT das RPCs continua sendo
// a barreira real e esta função não ganha poder nenhum sobre o resto do banco.
// As duas únicas coisas que ela alcança são sup_forn_validar_convite e
// sup_forn_enviar_cadastro. Ver a migration
// 20260925000002_fornecedor_cadastro_externo.sql.
//
// A CREDENCIAL É O TOKEN. Não há login: cada convite tem um token próprio,
// gerado pelo comprador, que morre depois de usado ou de expirar. Por isso
// nada aqui devolve dado de dentro — nem o nome da empresa que convidou.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY")!;

// "authorization" fica FORA do allow-headers de propósito: se alguém tentar
// mandar um token daqui, o navegador barra antes de sair.
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Corpo inválido." }, 400);
  }

  const token = typeof body?.token === "string" ? body.token.trim() : "";
  if (!token) return json({ error: "Link inválido." }, 400);

  const sb = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });

  // acao "validar": a página pergunta se mostra o formulário ou a tela de
  // link expirado. acao "enviar": grava o cadastro.
  if (body?.acao === "validar") {
    const { data, error } = await sb.rpc("sup_forn_validar_convite", { p_token: token });
    if (error) return json({ error: "Não foi possível validar o link." }, 500);
    return json(data ?? { valido: false, motivo: "inexistente" });
  }

  if (body?.acao === "enviar") {
    const payload = body?.dados ?? {};
    if (!payload?.cnpj_cpf || !payload?.razao_social) {
      return json({ error: "Informe pelo menos o CNPJ e a razão social." }, 400);
    }

    const { data, error } = await sb.rpc("sup_forn_enviar_cadastro", {
      p_token: token,
      p_payload: payload,
    });

    if (error) {
      // A RPC levanta mensagem de negócio ("Este link já foi utilizado",
      // "Este link expirou"): devolve como está, é o que a pessoa precisa ler.
      return json({ error: error.message ?? "Não foi possível enviar o cadastro." }, 400);
    }
    return json(data ?? { ok: true });
  }

  return json({ error: "Ação desconhecida." }, 400);
});
