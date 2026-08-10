// Arquivo: supabase/functions/whatsapp-templates/index.ts
//
// Submete à Meta, para aprovação, os templates das mensagens automáticas do
// recrutamento — e consulta o status deles.
//
// Existe como Edge Function porque o WHATSAPP_TOKEN é secret do servidor: o
// navegador não pode vê-lo, e ninguém precisa copiá-lo para lugar nenhum.
//
// Ações:
//   { acao: "listar" } → status de cada template na Meta (APPROVED/PENDING/REJECTED)
//   { acao: "criar"  } → cria na Meta os que ainda não existem
//
// Criar template NÃO liga a mensagem: aprovado na Meta, o RH ainda precisa
// marcar "Enviar automaticamente" na tela. São decisões diferentes.
//
// Secrets: WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WA_TOKEN = Deno.env.get("WHATSAPP_TOKEN") ?? "";
const PHONE_NUMBER_ID = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID") ?? "";
const GRAPH = "https://graph.facebook.com/v21.0";

// Exemplo por variável: a Meta exige amostra de cada {{n}} para revisar, e
// recusa a criação sem isso.
const EXEMPLOS: Record<string, string> = {
  primeiro_nome: "Maria",
  nome: "Maria Silva",
  cargo: "Auxiliar de Limpeza",
  cidade: "Porto Alegre",
  contrato: "UFRGS - Limpeza",
  empresa: "Grupo Nascimento",
};

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return json({ error: "não autenticado" }, 401);

  const db = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const { data: userData, error: userErr } = await db.auth.getUser();
  if (userErr || !userData?.user) return json({ error: "sessão inválida" }, 401);

  // Criar template altera a conta da empresa na Meta e passa por revisão —
  // não é ação de qualquer usuário logado.
  const { data: podeGerir } = await db.rpc("tem_acesso_menu", {
    _menu_codigo: "recrutamento_gestao", _acao: "alterar",
  });
  if (!podeGerir) return json({ error: "sem permissão para gerir o recrutamento" }, 403);

  if (!WA_TOKEN || !PHONE_NUMBER_ID) return json({ error: "WhatsApp não configurado no servidor" }, 500);

  let body: { acao?: string };
  try { body = await req.json(); } catch { return json({ error: "json inválido" }, 400); }
  const acao = String(body.acao ?? "listar");

  // A WABA sai do próprio número — evita mais um secret para alguém manter.
  const resWaba = await fetch(
    `${GRAPH}/${PHONE_NUMBER_ID}?fields=whatsapp_business_account`,
    { headers: { Authorization: `Bearer ${WA_TOKEN}` } },
  );
  const dataWaba = await resWaba.json().catch(() => ({}));
  const wabaId = dataWaba?.whatsapp_business_account?.id;
  if (!resWaba.ok || !wabaId) {
    return json({ error: "não consegui identificar a conta do WhatsApp", detalhe: dataWaba }, 502);
  }

  // Templates que já existem na conta (por nome), para não recriar.
  const listar = async (): Promise<Record<string, { status: string; category?: string; motivo?: string }>> => {
    const out: Record<string, { status: string; category?: string; motivo?: string }> = {};
    let url = `${GRAPH}/${wabaId}/message_templates?limit=200&fields=name,status,category,language,rejected_reason`;
    for (let pagina = 0; pagina < 10 && url; pagina++) {
      const r = await fetch(url, { headers: { Authorization: `Bearer ${WA_TOKEN}` } });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) break;
      for (const t of d?.data ?? []) {
        out[t.name] = { status: t.status, category: t.category, motivo: t.rejected_reason };
      }
      url = d?.paging?.next ?? "";
    }
    return out;
  };

  const { data: cfgs } = await db.from("RECRUTAMENTO_MENSAGENS")
    .select("etapa, template_nome, template_idioma, parametros, texto_previa");
  const linhas = (cfgs ?? []).filter((c) => String(c.template_nome ?? "").trim());

  const existentes = await listar();

  if (acao === "listar") {
    return json({
      ok: true, waba_id: wabaId,
      templates: linhas.map((c) => ({
        etapa: c.etapa, nome: c.template_nome,
        ...(existentes[c.template_nome!] ?? { status: "NAO_CRIADO" }),
      })),
    });
  }

  if (acao !== "criar") return json({ error: "ação inválida" }, 400);

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const resultado: Array<Record<string, unknown>> = [];

  for (const c of linhas) {
    const nome = String(c.template_nome);
    if (existentes[nome]) {
      resultado.push({ etapa: c.etapa, nome, acao: "ja_existia", status: existentes[nome].status });
      continue;
    }

    const corpo = String(c.texto_previa ?? "").trim();
    const params: string[] = Array.isArray(c.parametros) ? c.parametros : [];
    if (!corpo) { resultado.push({ etapa: c.etapa, nome, acao: "erro", erro: "sem texto" }); continue; }
    // Regra da Meta: corpo não pode começar nem terminar em variável.
    if (/^\{\{\d+\}\}/.test(corpo) || /\{\{\d+\}\}\s*[.!?]?$/.test(corpo)) {
      resultado.push({ etapa: c.etapa, nome, acao: "erro", erro: "o texto não pode começar nem terminar com variável" });
      continue;
    }

    const componentes: Array<Record<string, unknown>> = [{
      type: "BODY", text: corpo,
      ...(params.length
        ? { example: { body_text: [params.map((p) => EXEMPLOS[p] ?? "exemplo")] } }
        : {}),
    }];

    const r = await fetch(`${GRAPH}/${wabaId}/message_templates`, {
      method: "POST",
      headers: { Authorization: `Bearer ${WA_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        name: nome,
        // UTILITY: é atualização de um processo que o próprio candidato
        // iniciou. A Meta pode reclassificar para MARKETING na revisão.
        category: "UTILITY",
        language: c.template_idioma || "pt_BR",
        components: componentes,
      }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) {
      resultado.push({ etapa: c.etapa, nome, acao: "erro", erro: d?.error?.message ?? JSON.stringify(d).slice(0, 300) });
      continue;
    }
    resultado.push({ etapa: c.etapa, nome, acao: "criado", status: d?.status ?? "PENDING" });
    await admin.from("RECRUTAMENTO_MENSAGENS_LOG").insert({
      etapa: c.etapa, status: "template_criado", template_nome: nome,
    });
  }

  return json({ ok: true, waba_id: wabaId, resultado });
});
