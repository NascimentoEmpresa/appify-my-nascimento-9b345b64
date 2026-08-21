// Arquivo: supabase/functions/novidade-ia-chamado/index.ts
//
// Conta para a empresa o que mudou, quando um Chamado de Sistemas é concluído.
//
// Disparada pelo trigger trg_chamado_concluido_novidade_ia em CHAMADO_SISTEMA
// (migration 20260821000001) — via pg_net, no mesmo padrão dos ticks de cron
// já existentes. Pega o chamado, pede à IA (Groq) um aviso em linguagem de
// usuário e PUBLICA em SISTEMA_NOVIDADES, que é o que alimenta o sino do topo,
// o painel do Início e /app/novidades.
//
// Publica direto, sem revisão humana (decisão do Pablo, 21/08/2026). Por isso
// a régua do que sai é apertada: dúvida/orientação não vira novidade, ambiente
// que não é produção não vira novidade, e o texto passa por limparVazamentos()
// antes de ir ao banco. Ver _shared/novidade-ia.ts.
//
// SÓ OS PRÓXIMOS: o gatilho é a transição de status, então chamado antigo
// nunca entra. O guard de MARCO_INICIAL abaixo é a segunda tranca, para o caso
// de um UPDATE em massa reencostar em linhas velhas.
//
// Secrets: GROQ_API_KEY (já usada pelo bot do WhatsApp). SUPABASE_URL e
// SUPABASE_SERVICE_ROLE_KEY já existem no projeto.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import {
  decidir, extrairJson, montarPrompt, descartePrevio,
  GROQ_URL, MODELO_PADRAO, SYSTEM_PROMPT,
  type ChamadoParaNovidade,
} from "../_shared/novidade-ia.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

/** Data em que a automação entrou no ar. Nada concluído antes disso vira novidade. */
const MARCO_INICIAL = "2026-08-21T00:00:00Z";

/** Assinatura da novidade automática — é o "por ..." que aparece no rodapé do card. */
const AUTOR = "Assistente do ERP";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

/** Registra a decisão. A PK é o chamado: é ela que garante uma novidade só. */
async function logar(
  admin: ReturnType<typeof createClient>,
  chamadoId: string,
  decisao: string,
  motivo: string | null,
  novidadeId: number | null,
) {
  await admin.from("SISTEMA_NOVIDADES_IA_LOG").upsert({
    chamado_id: chamadoId,
    decisao,
    motivo,
    novidade_id: novidadeId,
  }, { onConflict: "chamado_id" });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  let chamadoId = "";
  try {
    const body = await req.json();
    chamadoId = String(body?.chamado_id ?? "").trim();
  } catch { return json({ error: "json inválido" }, 400); }
  if (!chamadoId) return json({ error: "chamado_id é obrigatório" }, 400);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

  // 1) Idempotência primeiro: reabrir e reconcluir um chamado não gera uma
  // segunda novidade, e uma reentrega do pg_net não gasta chamada de IA.
  const { data: jaFeito } = await admin
    .from("SISTEMA_NOVIDADES_IA_LOG")
    .select("chamado_id, decisao")
    .eq("chamado_id", chamadoId)
    .maybeSingle();
  if (jaFeito) return json({ ok: true, publicado: false, motivo: `já processado (${jaFeito.decisao})` });

  // 2) O chamado.
  const { data: c, error: cErr } = await admin
    .from("CHAMADO_SISTEMA")
    .select("id, numero, assunto, tipo_solicitacao, descricao, categorias, modulo_sistema, modulo_sistema_outro, ambiente, status, concluido_em, solicitante_nome, setor")
    .eq("id", chamadoId)
    .maybeSingle();
  if (cErr) return json({ error: cErr.message }, 500);
  if (!c) return json({ ok: true, publicado: false, motivo: "chamado não encontrado" });

  const chamado = c as unknown as ChamadoParaNovidade;
  if (chamado.status !== "concluido") {
    return json({ ok: true, publicado: false, motivo: "chamado não está concluído" });
  }
  if (!chamado.concluido_em || chamado.concluido_em < MARCO_INICIAL) {
    return json({ ok: true, publicado: false, motivo: "concluído antes do marco inicial" });
  }

  // 3) Descarte que não precisa de IA (dúvida, homologação) — sem gastar token.
  const previo = descartePrevio(chamado);
  if (previo) {
    await logar(admin, chamadoId, "descartado", previo, null);
    return json({ ok: true, publicado: false, motivo: previo });
  }

  // 4) Título da PR que resolveu, se houver — gravado por chamado-vincular-pr
  // no meta do evento. É a melhor pista do que foi de fato entregue.
  const { data: evPr } = await admin
    .from("CHAMADO_SISTEMA_EVENTO")
    .select("meta")
    .eq("chamado_id", chamadoId)
    .not("meta->>pr_titulo", "is", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const prTitulo = (evPr?.meta as Record<string, unknown> | null)?.pr_titulo as string | undefined;

  // 5) A IA.
  const apiKey = Deno.env.get("GROQ_API_KEY") ?? "";
  if (!apiKey) {
    console.error("GROQ_API_KEY não configurada");
    return json({ error: "GROQ_API_KEY não configurada" }, 500);
  }

  let bruto: unknown = null;
  try {
    const resp = await fetch(GROQ_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: Deno.env.get("GROQ_MODEL") || MODELO_PADRAO,
        temperature: 0.2,             // changelog não é lugar para criatividade
        max_completion_tokens: 500,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: montarPrompt(chamado, prTitulo) },
        ],
      }),
    });
    if (!resp.ok) {
      const txt = await resp.text();
      console.error("Groq error", resp.status, txt);
      // Sem log: erro de rede/limite é temporário, e gravar aqui congelaria o
      // chamado como "processado" sem novidade nenhuma. Fica para uma nova
      // conclusão ou para o disparo manual.
      return json({ error: "falha ao chamar a IA", status: resp.status }, 502);
    }
    const data = await resp.json();
    bruto = extrairJson(String(data?.choices?.[0]?.message?.content ?? ""));
  } catch (e) {
    console.error("Groq exception", e);
    return json({ error: "falha ao chamar a IA" }, 502);
  }

  const decisao = decidir(bruto, chamado);
  if (!decisao.publicar) {
    await logar(admin, chamadoId, "descartado", decisao.detalhe ?? decisao.motivo, null);
    return json({ ok: true, publicado: false, motivo: decisao.motivo, detalhe: decisao.detalhe });
  }

  // 6) A rota do "Saiba mais →" NÃO vem da IA: sai de app_menu, pelo módulo
  // que o chamado indica. Rota inventada por modelo levaria a tela em branco.
  let rota: string | null = null;
  const mod = chamado.modulo_sistema;
  if (mod && mod !== "outro") {
    const { data: modulo } = await admin
      .from("app_modulo").select("id").eq("codigo", mod).maybeSingle();
    if (modulo?.id) {
      const { data: menu } = await admin
        .from("app_menu")
        .select("rota")
        .eq("modulo_id", modulo.id)
        .eq("ativo", true)
        .not("rota", "is", null)
        .order("ordem", { ascending: true })
        .limit(1)
        .maybeSingle();
      const r = (menu as { rota?: string } | null)?.rota ?? null;
      if (r && r.startsWith("/") && !r.startsWith("//")) rota = r;
    }
  }

  const { data: nov, error: novErr } = await admin
    .from("SISTEMA_NOVIDADES")
    .insert({
      titulo: decisao.novidade.titulo,
      descricao: decisao.novidade.descricao,
      tipo: decisao.novidade.tipo,
      rota,
      publicado: true,
      origem: "ia",
      chamado_id: chamadoId,
      criado_por_nome: AUTOR,
    })
    .select("id")
    .single();
  if (novErr) {
    console.error("insert novidade", novErr);
    return json({ error: novErr.message }, 500);
  }

  const novidadeId = Number(nov?.id);
  await logar(admin, chamadoId, "publicado", null, novidadeId);

  return json({
    ok: true,
    publicado: true,
    novidade_id: novidadeId,
    tipo: decisao.novidade.tipo,
    titulo: decisao.novidade.titulo,
  });
});
