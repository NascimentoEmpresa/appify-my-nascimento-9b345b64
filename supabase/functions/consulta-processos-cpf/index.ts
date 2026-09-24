// Edge function: consulta de processos por CPF em TODOS os tribunais.
//
// Pedido do Pablo (24/09/2026): "verificar se alguém tem processos pelo CPF".
// A API pública do CNJ (DataJud) não traz as partes (LGPD) e as certidões dos
// tribunais têm captcha — o caminho é um fornecedor pago. Implementado com o
// Escavador (API v2, `GET /api/v2/envolvido/processos?cpf_cnpj=`), cobrado
// por requisição; o custo em centavos volta no header `Creditos-Utilizados`
// e fica gravado.
//
// A chave NUNCA vai para o browser: secret ESCAVADOR_API_TOKEN desta função.
// Sem a secret, responde { configurado: false } e a tela explica o que falta.
//
// Trancas:
//   • usuário do ERP com 'incluir' em juridico_consulta_processos (Acesso por
//     Usuário) — a consulta custa dinheiro e expõe dado pessoal;
//   • motivo obrigatório (mín. 10 caracteres), gravado junto;
//   • uma página só (até 100 processos): se houver mais, marca mais_paginas
//     em vez de sair paginando e multiplicando o custo.
// Todo resultado (inclusive erro) vira linha em JUR_CONSULTA_CPF.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const ESCAVADOR = "https://api.escavador.com/api/v2";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const digitos = (s: unknown) => String(s ?? "").replace(/\D/g, "");

/** Item do Escavador → o formato enxuto que a tela mostra. */
// deno-lint-ignore no-explicit-any
function normalizar(p: any, cpf: string) {
  // deno-lint-ignore no-explicit-any
  const fontes: any[] = Array.isArray(p?.fontes) ? p.fontes : [];
  const fonte = fontes.find((f) => f?.tipo === "TRIBUNAL") ?? fontes[0] ?? {};
  // deno-lint-ignore no-explicit-any
  const envolvidos: any[] = fontes.flatMap((f) => (Array.isArray(f?.envolvidos) ? f.envolvidos : []));
  const eu = envolvidos.find((e) => digitos(e?.cpf) === cpf || digitos(e?.cpf_cnpj) === cpf);
  const capa = fonte?.capa ?? {};
  return {
    numero: p?.numero_cnj ?? null,
    tribunal: fonte?.tribunal?.sigla ?? fonte?.sigla ?? fonte?.nome ?? null,
    grau: fonte?.grau_formatado ?? fonte?.grau ?? null,
    classe: capa?.classe ?? null,
    assunto: capa?.assunto_principal_normalizado?.nome ?? capa?.assunto ?? null,
    area: capa?.area ?? null,
    polo_ativo: p?.titulo_polo_ativo ?? null,
    polo_passivo: p?.titulo_polo_passivo ?? null,
    papel: eu?.polo ?? eu?.tipo_normalizado ?? null,
    data_inicio: p?.data_inicio ?? null,
    ultima_movimentacao: p?.data_ultima_movimentacao ?? null,
    status: fonte?.status_predito ?? null,
    valor_causa: capa?.valor_causa?.valor_formatado ?? null,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Missing Authorization" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY")!;

    const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "Unauthorized" }, 401);

    const admin = createClient(supabaseUrl, serviceKey);
    const { data: pode } = await admin.rpc("has_screen_access", {
      _user: user.id, _menu: "juridico_consulta_processos", _acao: "incluir",
    });
    if (!pode) return json({ error: "Sem permissão para consulta paga. Peça 'incluir' em Consulta de processos por CPF (Acesso por Usuário)." }, 403);

    const token = Deno.env.get("ESCAVADOR_API_TOKEN");
    if (!token) return json({ configurado: false });

    const { cpf: cpfBruto, nome, motivo } = await req.json().catch(() => ({}));
    const cpf = digitos(cpfBruto);
    if (cpf.length !== 11) return json({ error: "Informe um CPF com 11 dígitos." }, 400);
    const motivoLimpo = String(motivo ?? "").trim();
    if (motivoLimpo.length < 10) return json({ error: "Escreva o motivo da consulta (mínimo 10 caracteres)." }, 400);

    const { data: perfil } = await admin.from("profiles").select("display_name, email").eq("id", user.id).maybeSingle();
    const quem = perfil?.display_name || perfil?.email || user.email || null;

    const resp = await fetch(`${ESCAVADOR}/envolvido/processos?cpf_cnpj=${cpf}&limit=100`, {
      headers: { Authorization: `Bearer ${token}`, "X-Requested-With": "XMLHttpRequest", Accept: "application/json" },
    });
    const custo = Number(resp.headers.get("Creditos-Utilizados") ?? "") || null;
    // deno-lint-ignore no-explicit-any
    const corpo: any = await resp.json().catch(() => null);

    let processos: ReturnType<typeof normalizar>[] = [];
    let erro: string | null = null;
    let mais = false;
    if (resp.status === 404) {
      // Envolvido não encontrado = nenhum processo com esse CPF na base deles.
      processos = [];
    } else if (!resp.ok) {
      erro = `Escavador respondeu ${resp.status}: ${corpo?.error ?? corpo?.message ?? "erro desconhecido"}`;
    } else {
      processos = (Array.isArray(corpo?.items) ? corpo.items : []).map((p: unknown) => normalizar(p, cpf));
      mais = !!corpo?.links?.next;
    }

    const { data: linha, error: errGravar } = await admin.from("JUR_CONSULTA_CPF").insert({
      cpf_digits: cpf, nome: nome ? String(nome).slice(0, 200) : (corpo?.envolvido_encontrado?.nome ?? null),
      fornecedor: "escavador", motivo: motivoLimpo, processos, total: processos.length,
      mais_paginas: mais, custo_centavos: custo, erro, consultado_por: user.id, consultado_por_nome: quem,
    }).select("*").single();
    if (errGravar) console.error("[consulta-processos-cpf] gravar", errGravar.message);

    if (erro) return json({ configurado: true, error: erro, consulta: linha }, 502);
    return json({ configurado: true, consulta: linha });
  } catch (e) {
    return json({ error: (e as Error).message ?? "Falha na consulta." }, 500);
  }
});
