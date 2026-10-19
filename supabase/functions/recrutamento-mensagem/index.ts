// Arquivo: supabase/functions/recrutamento-mensagem/index.ts
//
// Dispara as mensagens automáticas de WhatsApp de uma etapa do recrutamento.
//
// 14/10/2026 (SIS-2026-0667, mig 20261014000049): as mensagens vêm da
// BIBLIOTECA (WA_TEMPLATE — as mesmas da "/" e do "Enviar para aprovação"),
// e cada etapa pode ter várias (RECRUTAMENTO_MENSAGEM_ETAPA). Antes era um
// template solto por etapa (RECRUTAMENTO_MENSAGENS) que nunca foi criado na
// Meta — o log só tinha "(#132001) Template name does not exist".
//
// AGENDAMENTO ASO (16/10/2026, mig 20261016000031): MANUAL — o botão "Enviar
// agendamento" do card em SST + COMPRAS manda ao candidato data, horário,
// local e mapa do exame que o SST agendou. Continua na linha própria de
// RECRUTAMENTO_MENSAGENS (template recrutamento_agendamento_aso) e não
// depende do "Enviar automaticamente" (ativo); aqui ela vira uma mensagem
// a mais no mesmo laço de envio.
//
// TEXTO x TEMPLATE: a Cloud API só aceita texto livre dentro de 24h da última
// mensagem DO CONTATO. Dentro da janela vai texto (sai mesmo antes de a Meta
// aprovar o template); fora dela, vai o template aprovado, que pode iniciar
// conversa a qualquer momento. Sem template aprovado, fora da janela não sai —
// fica no log e o RH é avisado.
//
// VARIÁVEIS: cada {{n}} tem um rótulo (WA_TEMPLATE.variaveis). O valor vem,
// nesta ordem: do que a tela mandou (ex.: banco do salário, ao contratar) →
// do candidato/vaga (nome, cargo, cidade, contrato, data de início, posto) →
// dos valores fixos (RECRUTAMENTO_MENSAGEM_VALOR, ex.: link do formulário).
// Faltou valor: a mensagem não sai (a Meta recusa parâmetro vazio, e mandar
// "-" no lugar do banco ou do link é pior que não mandar) e o log diz o quê.
//
// A mensagem entra na Caixa de Entrada como qualquer envio nosso: cria/reusa
// contato e conversa e grava em WA_MENSAGEM (origem 'sistema' — a antiga
// gravava 'recrutamento', que o CHECK recusa, e a bolha nunca aparecia).
//
// Secrets: WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WA_TOKEN = Deno.env.get("WHATSAPP_TOKEN") ?? "";
const PHONE_NUMBER_ID = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID") ?? "";
const GRAPH = "https://graph.facebook.com/v21.0";

const ETAPA_AGENDAMENTO = "AGENDAMENTO ASO";

// Mesma régua de src/lib/recrutamento/agendamentoAso.ts (o Deno não importa
// do src): "2026-10-19" → "19/10/2026 (segunda-feira)".
const DIAS = ["domingo", "segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado"];
function dataExameBr(s: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s ?? ""));
  if (!m) return "";
  const dia = DIAS[new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).getUTCDay()];
  return `${m[3]}/${m[2]}/${m[1]} (${dia})`;
}
function mapaExame(url: string, local: string): string {
  if (String(url ?? "").trim()) return String(url).trim();
  const l = String(local ?? "").trim();
  return l ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(l)}` : "";
}
// Parâmetro de template não aceita quebra de linha, tab nem 4+ espaços seguidos.
const umaLinha = (s: string) => String(s ?? "").replace(/[\r\n\t]+/g, " ").replace(/ {2,}/g, " ").trim();

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

// "PABLO SANTAREM" -> "Pablo". Nome gritado em caixa alta é como vem da folha
// e do portal; mandar assim para o candidato fica agressivo.
function primeiroNomeDe(nome: string): string {
  const p = String(nome ?? "").trim().split(/\s+/)[0] ?? "";
  return p ? p.charAt(0).toUpperCase() + p.slice(1).toLowerCase() : "";
}

// Telefone utilizável? Só o comprimento — quem resolve o wa_id é a RPC
// recrutamento_abrir_conversa, no banco (ela conhece a forma legada do número
// brasileiro, sem o 9º dígito, que a Cloud API guarda).
function temTelefone(telefone: string): boolean {
  return String(telefone ?? "").replace(/\D/g, "").length >= 10;
}

/** Rótulo de variável comparável: minúsculo, sem acento, sem espaço sobrando. */
const chave = (s: string) =>
  String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

/** "2026-10-22" → "22/10/2026"; o resto (ex.: "Imediato") passa como está. */
function dataBr(v: unknown): string {
  const s = String(v ?? "").trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : s;
}

const preencher = (texto: string, valores: string[]) =>
  texto.replace(/\{\{(\d+)\}\}/g, (_, n) => valores[Number(n) - 1] ?? "");

const problemaDeTemplate = (codigo: unknown): boolean => {
  const n = Number(codigo);
  return Number.isFinite(n) && n >= 132000 && n < 133000;
};

interface Resultado { codigo: string; titulo: string; enviado: boolean; via?: "texto" | "template"; motivo?: string; detalhe?: string }

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

  let body: { candidato_id?: number; etapa?: string; valores?: Record<string, string> };
  try { body = await req.json(); } catch { return json({ error: "json inválido" }, 400); }

  const candidatoId = Number(body.candidato_id ?? 0);
  const etapa = String(body.etapa ?? "").trim();
  if (!candidatoId || !etapa) return json({ error: "candidato_id e etapa são obrigatórios" }, 400);
  const manual = etapa === ETAPA_AGENDAMENTO;

  // service_role: configuração e log. A AUTORIZAÇÃO é a leitura do candidato
  // abaixo, feita com a sessão de quem moveu (RLS do Recrutamento).
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const logar = (row: Record<string, unknown>) =>
    admin.from("RECRUTAMENTO_MENSAGENS_LOG").insert({ candidato_id: candidatoId, etapa, ...row });

  // ── Mensagens da etapa ────────────────────────────────────────────
  let codigos: string[] = [];
  let porCodigo = new Map<string, unknown>();
  if (manual) {
    // Agendamento do ASO: a linha própria de RECRUTAMENTO_MENSAGENS vira uma
    // "mensagem" no formato da biblioteca (parametros = rótulos das variáveis).
    const { data: cfg } = await admin.from("RECRUTAMENTO_MENSAGENS").select("*").eq("etapa", etapa).maybeSingle();
    if (!cfg?.template_nome) {
      await logar({ status: "sem_config" });
      return json({ ok: true, enviados: 0, motivo: "sem_template", resultados: [] });
    }
    codigos = [cfg.template_nome];
    porCodigo.set(cfg.template_nome, {
      codigo: cfg.template_nome, titulo: "Agendamento do ASO", texto: cfg.texto_previa ?? "",
      variaveis: Array.isArray(cfg.parametros) ? cfg.parametros : [],
      template_nome: cfg.template_nome, idioma: cfg.template_idioma ?? "pt_BR",
    });
  } else {
    const { data: mapa } = await admin.from("RECRUTAMENTO_MENSAGEM_ETAPA")
      .select("codigo, ordem").eq("etapa", etapa).eq("ativo", true).order("ordem");
    codigos = (mapa ?? []).map((m: { codigo: string }) => m.codigo);
    if (!codigos.length) return json({ ok: true, enviados: 0, motivo: "etapa_sem_mensagem", resultados: [] });

    const { data: tpls } = await admin.from("WA_TEMPLATE")
      .select("codigo, titulo, texto, variaveis, template_nome, idioma").in("codigo", codigos).eq("ativo", true);
    porCodigo = new Map((tpls ?? []).map((t: { codigo: string }) => [t.codigo, t]));
  }

  // ── Candidato + vaga ──────────────────────────────────────────────
  const { data: cand } = await db.from("WA_CURRICULOS")
    .select("id, nome, telefone, vaga_id, aso_posto, sst_data_exame, sst_hora_exame, sst_local_exame, sst_maps_url")
    .eq("id", candidatoId).maybeSingle();
  if (!cand) return json({ error: "candidato não encontrado ou sem acesso" }, 404);
  if (manual && !cand.sst_data_exame) {
    return json({ ok: true, enviados: 0, motivo: "sem_agendamento", resultados: [] });
  }

  if (!temTelefone(cand.telefone ?? "")) {
    await logar({ status: "sem_telefone", telefone: cand.telefone ?? null });
    return json({ ok: true, enviados: 0, motivo: "sem_telefone", resultados: [] });
  }
  if (!WA_TOKEN || !PHONE_NUMBER_ID) return json({ error: "WhatsApp não configurado no servidor" }, 500);

  let vaga: Record<string, unknown> | null = null;
  if (cand.vaga_id) {
    const { data } = await admin.from("SISTEMA_RECRUTAMENTO")
      .select("cargo, cidade, contrato, data_inicio_prevista, local_exato").eq("id", cand.vaga_id).maybeSingle();
    vaga = data ?? null;
  }
  const { data: fixosRows } = await admin.from("RECRUTAMENTO_MENSAGEM_VALOR").select("variavel, valor");

  const automaticos: Record<string, string> = {
    "primeiro nome": primeiroNomeDe(cand.nome ?? ""),
    "nome": String(cand.nome ?? "").trim(),
    "cargo": String(vaga?.cargo ?? "").trim(),
    "cidade": String(vaga?.cidade ?? "").trim(),
    "contrato": String(vaga?.contrato ?? "").trim(),
    "empresa": "Grupo Nascimento",
    "data de inicio": dataBr(vaga?.data_inicio_prevista),
    "local / posto": String(cand.aso_posto ?? vaga?.local_exato ?? "").trim(),
    // Agendamento do ASO (mig 20261016000031 — rótulos no formato antigo).
    "primeiro_nome": primeiroNomeDe(cand.nome ?? ""),
    "data_exame": dataExameBr(cand.sst_data_exame ?? ""),
    "hora_exame": umaLinha(cand.sst_hora_exame ?? ""),
    "local_exame": umaLinha(cand.sst_local_exame ?? ""),
    "mapa_exame": mapaExame(cand.sst_maps_url ?? "", cand.sst_local_exame ?? ""),
  };
  const daTela: Record<string, string> = {};
  for (const [k, v] of Object.entries(body.valores ?? {})) if (String(v ?? "").trim()) daTela[chave(k)] = String(v).trim();
  const fixos: Record<string, string> = {};
  for (const r of (fixosRows ?? []) as { variavel: string; valor: string | null }[]) {
    if (String(r.valor ?? "").trim()) fixos[chave(r.variavel)] = String(r.valor).trim();
  }
  const valorDe = (rotulo: string) => daTela[chave(rotulo)] || automaticos[chave(rotulo)] || fixos[chave(rotulo)] || "";

  // ── Contato e conversa (a mensagem tem que aparecer na Caixa) ─────
  const { data: conversaId, error: erroConversa } =
    await admin.rpc("recrutamento_abrir_conversa", { p_candidato_id: candidatoId });
  if (erroConversa || !conversaId) {
    await logar({ status: "erro", telefone: cand.telefone ?? null, erro: erroConversa?.message ?? "conversa não resolvida" });
    return json({ ok: false, enviados: 0, motivo: "sem_conversa", detalhe: erroConversa?.message, resultados: [] });
  }
  const { data: conversa } = await admin.from("WA_CONVERSA").select("id, contato_id").eq("id", conversaId).maybeSingle();
  if (!conversa) return json({ error: "não consegui abrir a conversa" }, 500);
  const { data: contato } = await admin.from("WA_CONTATO").select("id, wa_id").eq("id", conversa.contato_id).maybeSingle();
  if (!contato?.wa_id) return json({ error: "contato sem wa_id" }, 500);
  const waId = contato.wa_id;

  // Janela de 24h: alguma mensagem DO candidato nas últimas 24h?
  const limite = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count } = await admin.from("WA_MENSAGEM")
    .select("id", { count: "exact", head: true })
    .eq("conversa_id", conversa.id).eq("direcao", "entrada").gt("criada_em", limite);
  const dentroJanela = (count ?? 0) > 0;

  // ── Envio, uma mensagem por vez, na ordem da etapa ─────────────────
  const resultados: Resultado[] = [];
  for (const codigo of codigos) {
    const tpl = porCodigo.get(codigo) as { codigo: string; titulo: string; texto: string; variaveis: string[] | null; template_nome: string | null; idioma: string | null } | undefined;
    if (!tpl) { resultados.push({ codigo, titulo: codigo, enviado: false, motivo: "mensagem_inativa" }); continue; }

    const rotulos: string[] = Array.isArray(tpl.variaveis) ? tpl.variaveis : [];
    const valores = rotulos.map(valorDe);
    const faltam = rotulos.filter((_, i) => !valores[i]);
    if (faltam.length) {
      await logar({ status: "falta_valor", codigo, template_nome: tpl.template_nome, telefone: waId, erro: `falta: ${faltam.join(", ")}` });
      resultados.push({ codigo, titulo: tpl.titulo, enviado: false, motivo: "falta_valor", detalhe: faltam.join(", ") });
      continue;
    }
    const texto = preencher(String(tpl.texto ?? ""), valores);

    if (!dentroJanela && !tpl.template_nome) {
      await logar({ status: "erro", codigo, telefone: waId, erro: "sem template na Meta e fora da janela de 24h" });
      resultados.push({ codigo, titulo: tpl.titulo, enviado: false, motivo: "sem_template" });
      continue;
    }

    const base = { messaging_product: "whatsapp", to: waId };
    const mensagem = dentroJanela
      ? { ...base, type: "text", text: { body: texto } }
      : { ...base, type: "template", template: {
          name: tpl.template_nome, language: { code: tpl.idioma || "pt_BR" },
          ...(valores.length ? { components: [{ type: "body", parameters: valores.map((v) => ({ type: "text", text: v })) }] } : {}),
        } };
    const res = await fetch(`${GRAPH}/${PHONE_NUMBER_ID}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${WA_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify(mensagem),
    });
    const dataG = await res.json().catch(() => ({}));
    if (!res.ok) {
      const erro = dataG?.error?.message ?? JSON.stringify(dataG).slice(0, 500);
      const motivo = problemaDeTemplate(dataG?.error?.code) ? "template_nao_aprovado" : "falha_envio";
      await logar({ status: "erro", codigo, telefone: waId, template_nome: tpl.template_nome, erro });
      resultados.push({ codigo, titulo: tpl.titulo, enviado: false, motivo, detalhe: erro });
      continue;
    }

    const wamid = dataG?.messages?.[0]?.id ?? null;
    await admin.from("WA_MENSAGEM").insert({
      conversa_id: conversa.id, contato_id: contato.id, direcao: "saida",
      tipo: dentroJanela ? "text" : "template", texto, wa_message_id: wamid, status: "enviada",
      origem: "sistema", autor_id: userData.user.id,
      meta: { etapa, candidato_id: candidatoId, codigo, automatica: !manual },
      ...(dentroJanela ? {} : { payload: { template: tpl.template_nome } }),
    });
    await admin.from("WA_CONVERSA").update({
      ultima_mensagem_em: new Date().toISOString(),
      ultima_mensagem_preview: texto.slice(0, 120),
      ultima_direcao: "saida",
    }).eq("id", conversa.id);
    await logar({ status: "enviado", codigo, telefone: waId, template_nome: tpl.template_nome, wa_message_id: wamid });
    resultados.push({ codigo, titulo: tpl.titulo, enviado: true, via: dentroJanela ? "texto" : "template" });
  }

  // O botão do agendamento lê { enviado, motivo, detalhe } (mensagemEnvioAgendamento).
  const unico = manual ? { enviado: !!resultados[0]?.enviado, motivo: resultados[0]?.motivo, detalhe: resultados[0]?.detalhe } : {};
  return json({ ok: true, enviados: resultados.filter((r) => r.enviado).length, resultados, ...unico });
});
