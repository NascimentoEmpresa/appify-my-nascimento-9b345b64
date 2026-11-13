// Arquivo: supabase/functions/chamado-monitor-ia/index.ts
//
// Nota da I.A sobre a QUALIDADE DO PEDIDO de um Chamado de Sistemas, para o
// Monitoramento de Chamados (mig 20261115000100). Grava em
// CHAMADO_SISTEMA_MONITOR_IA; a tela só LÊ de lá (via chamados_monitoramento).
// Prompt e regras: _shared/chamado-monitor-ia.ts (leia o cabeçalho de lá).
//
// QUEM CHAMA: só a fila_http (Bearer = service_role). O banco marca a linha
// como pendente (chamado novo, texto alterado, conclusão) e o pg_cron solta
// poucas por minuto — nunca uma rajada (ver a migration). Não há botão.
//
// NÃO REPETE À TOA: o texto enviado à I.A vira um hash; se a linha já está
// pronta com o mesmo hash, nada é chamado. Assim reenfileirar é barato.
//
// FALHA NÃO SOME: a linha fica 'erro' com a mensagem e o número de
// tentativas; o cron tenta de novo depois (até 3 vezes). Responde 200 nesse
// caso para a fila_http não somar as próprias 5 tentativas às nossas.
//
// Provedor: o mesmo do chamado-parecer-ia — Gemini (GEMINI_API_KEY) primeiro,
// Groq (GROQ_API_KEY, openai/gpt-oss-120b) de reserva. Chaves nos secrets.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import {
  SYSTEM_PROMPT_MONITOR, extrairJsonMonitor, montarPromptMonitor, validarAvaliacaoMonitor,
  type AnexoParaMonitorIa, type ChamadoParaMonitorIa, type EventoParaMonitorIa,
} from "../_shared/chamado-monitor-ia.ts";

/** Muda quando o prompt muda de régua: força reavaliar tudo (o hash inclui isto). */
const VERSAO_REGUA = "v1-2026-11-13";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const respostaJson = (corpo: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { "Content-Type": "application/json" } });

type Provedor = { nome: string; url: string; chave: string; modelo: string };

function provedores(): Provedor[] {
  const lista: Provedor[] = [];
  const gemini = Deno.env.get("GEMINI_API_KEY");
  if (gemini) {
    lista.push({ nome: "gemini", url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", chave: gemini,
                 modelo: Deno.env.get("IA_MONITOR_MODELO") ?? Deno.env.get("IA_CHAT_MODELO") ?? "gemini-3.6-flash" });
  }
  const groq = Deno.env.get("GROQ_API_KEY");
  if (groq) {
    lista.push({ nome: "groq", url: "https://api.groq.com/openai/v1/chat/completions", chave: groq,
                 modelo: Deno.env.get("GROQ_MODEL") ?? "openai/gpt-oss-120b" });
  }
  return lista;
}

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function chamarIA(messages: { role: string; content: string }[]):
  Promise<{ texto?: string; provedor?: string; modelo?: string; erro?: string }> {
  let erro = "Nenhuma chave de I.A configurada.";
  for (const prov of provedores()) {
    for (let tentativa = 1; tentativa <= 2; tentativa++) {
      const r = await fetch(prov.url, {
        method: "POST",
        headers: { Authorization: `Bearer ${prov.chave}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: prov.modelo,
          temperature: 0,
          messages,
          ...(prov.nome === "groq" ? { response_format: { type: "json_object" } } : {}),
        }),
      }).catch((e) => { console.error("IA rede", prov.nome, e); return null; });
      if (r && r.ok) {
        const dados = await r.json().catch(() => null);
        const texto = String(dados?.choices?.[0]?.message?.content ?? "").trim();
        if (texto) return { texto, provedor: prov.nome, modelo: prov.modelo };
        erro = `${prov.nome}: resposta vazia`;
        break;
      }
      const status = r?.status ?? 0;
      console.error("IA erro", prov.nome, prov.modelo, status, r ? (await r.text()).slice(0, 300) : "sem resposta");
      erro = `${prov.nome}: HTTP ${status || "sem resposta"}`;
      if (!(status === 0 || status >= 500) || tentativa === 2) break;
      await esperar(1500);
    }
  }
  return { erro };
}

async function sha256(texto: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(texto));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return respostaJson({ error: "Use POST." }, 405);
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token || token !== SERVICE_ROLE) return respostaJson({ error: "Só a fila do banco chama esta função." }, 403);

  const corpo = await req.json().catch(() => ({}));
  const chamadoId = String(corpo?.chamado_id ?? "").trim();
  if (!/^[0-9a-f-]{36}$/i.test(chamadoId)) return respostaJson({ error: "chamado_id inválido." }, 400);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
  const gravar = (campos: Record<string, unknown>) =>
    admin.from("CHAMADO_SISTEMA_MONITOR_IA").upsert({ chamado_id: chamadoId, atualizado_em: new Date().toISOString(), ...campos }, { onConflict: "chamado_id" });

  try {
    const { data: c, error: cErr } = await admin.from("CHAMADO_SISTEMA")
      .select("numero, assunto, tipo_solicitacao, descricao, observacoes_solicitante, categorias, modulo_sistema, modulo_sistema_outro, impacto_trabalho, urgencia, afeta_usuarios, prioridade, status, setor, solicitante_id")
      .eq("id", chamadoId).maybeSingle();
    if (cErr) throw new Error(cErr.message);
    if (!c) return respostaJson({ ok: true, ignorado: "chamado não existe mais" });

    const [{ data: eventos, error: eErr }, { data: anexos, error: aErr }, { data: atual }] = await Promise.all([
      admin.from("CHAMADO_SISTEMA_EVENTO").select("tipo, texto, autor_id, created_at")
        .eq("chamado_id", chamadoId).in("tipo", ["comentario", "solicitar_info"]).order("created_at").limit(80),
      admin.from("CHAMADO_SISTEMA_ANEXO").select("nome_arquivo, campo").eq("chamado_id", chamadoId).limit(40),
      admin.from("CHAMADO_SISTEMA_MONITOR_IA").select("status, base_hash, tentativas").eq("chamado_id", chamadoId).maybeSingle(),
    ]);
    if (eErr) throw new Error(eErr.message);
    if (aErr) throw new Error(aErr.message);

    const prompt = montarPromptMonitor(c as ChamadoParaMonitorIa, (eventos ?? []) as EventoParaMonitorIa[], (anexos ?? []) as AnexoParaMonitorIa[]);
    const hash = await sha256(`${VERSAO_REGUA}\n${prompt}`);
    if (atual?.status === "pronto" && atual.base_hash === hash) {
      await gravar({ status: "pronto", pendente: false });
      return respostaJson({ ok: true, ignorado: "sem mudança desde a última avaliação" });
    }

    const res = await chamarIA([
      { role: "system", content: SYSTEM_PROMPT_MONITOR },
      { role: "user", content: prompt },
    ]);
    const aval = res.texto ? validarAvaliacaoMonitor(extrairJsonMonitor(res.texto)) : null;
    if (!aval) {
      const msg = res.erro ?? "A I.A devolveu um JSON incompleto.";
      // Mantém a nota pronta anterior (se houver) — só marca a tentativa.
      await gravar({
        ...(atual?.status === "pronto" ? {} : { status: "erro" }),
        erro: msg.slice(0, 500), pendente: false, tentativas: (atual?.tentativas ?? 0) + 1,
      });
      return respostaJson({ ok: false, erro: msg });
    }

    const { error: gErr } = await gravar({
      status: "pronto", pendente: false, tentativas: 0, erro: null,
      criterios: aval.criterios, resumo: aval.resumo, base_hash: hash,
      provedor: res.provedor, modelo: res.modelo, avaliado_em: new Date().toISOString(),
    });
    if (gErr) throw new Error(gErr.message);
    return respostaJson({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("chamado-monitor-ia", chamadoId, msg);
    await gravar({ erro: msg.slice(0, 500), pendente: false }).catch(() => null);
    return respostaJson({ ok: false, erro: msg });
  }
});
