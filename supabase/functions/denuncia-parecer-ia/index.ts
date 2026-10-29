// Arquivo: supabase/functions/denuncia-parecer-ia/index.ts
//
// Parecer da I.A sobre uma denúncia do Canal (Comitê de Ética), 29/10/2026.
// Dois modos, os dois SOB DEMANDA e sem gravar nada:
//   · "resumo": o caso inteiro em texto corrido — relato, linha do tempo,
//     providências (feitas, pendentes, prazos estourados), evidências que
//     existem, resultado e medidas, situação e próximos passos sugeridos;
//   · "chat": perguntas sobre o caso ("o que falta para concluir?", "redija
//     o parecer conclusivo"). O histórico vem do cliente a cada pergunta.
//
// POR QUE NÃO GUARDA O RESUMO (diferente de chamado-parecer-ia)
//   O que cada um enxerga numa denúncia é diferente: a Presidência não lê as
//   mensagens nem a fila em apuração; anexo sigiloso só aparece para quem tem
//   `comite_etica_sigilo`. Um resumo gravado por quem vê tudo vazaria, pela
//   tabela, para quem vê menos. Sob demanda, cada resumo nasce só do que
//   aquele login enxerga.
//
// SIGILO — o portão é a RLS, lida com o JWT de quem pediu
//   Tudo é lido com o cliente do USUÁRIO (anon key + Authorization dele):
//   v_canal_denuncia (que já recorta por empresa/Presidência e mascara o
//   denunciante), providências, anexos, eventos e mensagens pelas próprias
//   policies do canal. Não há service_role nesta função — de propósito.
//   Mesmo para quem pode ver, a identidade do denunciante (nome, CPF,
//   contato) NUNCA vai para a I.A: não muda a apuração e sairia da casa.
//   Anexo sigiloso entra só como "existe um anexo sigiloso" — sem nome,
//   descrição ou observação; de nenhum anexo o conteúdo é lido.
//   O conteúdo da denúncia não vai para log: os console.error daqui só
//   levam status HTTP e provedor.
//
// A I.A falhar NÃO some em silêncio: o erro volta no corpo e a tela mostra.
//
// Provedor: o mesmo de chamado-parecer-ia — Gemini (GEMINI_API_KEY)
// primeiro; erro passageiro tenta de novo; sem tokens ou chave recusada, passa
// ao Groq (GROQ_API_KEY, modelo openai/gpt-oss-120b). Chaves nos secrets da
// Edge Function, nunca em arquivo.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const respostaJson = (corpo: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const ERRO_SEM_TOKENS = "Acabou os tokens da IA, é necessário aguardar a IA renovar os tokens.";

type Provedor = { nome: string; url: string; chave: string; modelo: string };

function provedores(): Provedor[] {
  const lista: Provedor[] = [];
  const gemini = Deno.env.get("GEMINI_API_KEY");
  if (gemini) {
    lista.push({ nome: "gemini", url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", chave: gemini,
                 modelo: Deno.env.get("IA_PARECER_MODELO") ?? Deno.env.get("IA_CHAT_MODELO") ?? "gemini-3.6-flash" });
  }
  const groq = Deno.env.get("GROQ_API_KEY");
  if (groq) {
    lista.push({ nome: "groq", url: "https://api.groq.com/openai/v1/chat/completions", chave: groq,
                 modelo: Deno.env.get("GROQ_MODEL") ?? "openai/gpt-oss-120b" });
  }
  return lista;
}

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function chamarIA(provs: Provedor[], messages: { role: string; content: string }[]):
  Promise<{ texto?: string; provedor?: string; modelo?: string; erro?: string; status?: number }> {
  let ultimo: { erro: string; status: number } = { erro: "Não foi possível falar com a IA agora.", status: 502 };
  for (const prov of provs) {
    for (let tentativa = 1; tentativa <= 2; tentativa++) {
      const r = await fetch(prov.url, {
        method: "POST",
        headers: { Authorization: `Bearer ${prov.chave}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: prov.modelo, temperature: 0.2, messages }),
      }).catch(() => { console.error("IA rede", prov.nome); return null; });
      if (r && r.ok) {
        const dados = await r.json().catch(() => null);
        if (/quota|rate limit|resource_exhausted/i.test(String(dados?.error?.message ?? ""))) { ultimo = { erro: ERRO_SEM_TOKENS, status: 429 }; break; }
        const texto = String(dados?.choices?.[0]?.message?.content ?? "").trim();
        if (texto) return { texto, provedor: prov.nome, modelo: prov.modelo };
        ultimo = { erro: "A IA devolveu resposta vazia. Tente de novo.", status: 502 };
        break;
      }
      const status = r?.status ?? 0;
      // Só o status: o corpo do erro do provedor pode ecoar trecho do prompt.
      console.error("IA erro", prov.nome, prov.modelo, status);
      if (status === 429 || status === 402) { ultimo = { erro: ERRO_SEM_TOKENS, status: 429 }; break; }
      if (status === 401 || status === 403) { ultimo = { erro: "A chave da IA foi recusada. Avise o time de Sistemas.", status: 502 }; break; }
      ultimo = { erro: `Falha ao chamar a IA (HTTP ${status || "sem resposta"}).`, status: 502 };
      if (!(status === 0 || status >= 500) || tentativa === 2) break;
      await esperar(1200);
    }
  }
  return ultimo;
}

// ------------------------------------------------------------ o dossiê

type Linha = Record<string, unknown>;

// Colunas da visão SEM a identidade do denunciante (nome_completo, cpf,
// email, data_nascimento, telefones) — ver o cabeçalho.
const CAMPOS_DENUNCIA = [
  "id", "protocolo", "identificado", "anonimo", "empresa_nome", "contrato_informado",
  "relacao", "tipo_denuncia", "local_ocorrencia", "como_soube",
  "ocorrencia_data", "ocorrencia_hora", "ocorrencia_frequencia",
  "risco_imediato", "risco_imediato_detalhe", "retaliacao", "retaliacao_detalhe",
  "denunciado_informado", "denunciado_funcao",
  "lideranca_ciente", "lideranca_envolvida", "lideranca_ocultou",
  "lideranca_ciente_quem", "lideranca_envolvida_quem", "lideranca_ocultou_quem",
  "titulo", "resumo", "descricao", "testemunhas", "evidencias", "valor_financeiro", "sugestao",
  "origem", "tipo_classificado", "gravidade", "sigilo",
  "denunciado_nome", "lider_nome", "diretoria", "contrato", "setor", "unidade", "cidade",
  "apuracao_responsavel", "apuracao_inicio", "apuracao_fim", "primeira_providencia_em",
  "pendencia_atual", "evidencias_analise",
  "resultado", "medidas", "medida_principal", "recomendacao",
  "houve_recurso", "recurso_resultado", "recurso_data",
  "causa_raiz", "causa_raiz_detalhe", "acoes_preventivas", "acoes_corretivas",
  "sla_dias_override", "status", "justificativa_mudanca", "parecer_interno", "retorno_denunciante",
  "decisao_final", "decisao_em", "decisao_fundamentacao", "decisao_sobre_parecer", "decisao_medidas", "decisao_por_nome",
  "concluido_em", "ultima_movimentacao_em", "created_at",
].join(", ");

const SITUACOES_CONCLUIDAS = ["concluida", "arquivada"];
const DIA = 86_400_000;

/** Data de hoje no fuso da empresa, 'YYYY-MM-DD'. */
const hojeSp = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
const dataBr = (s: unknown) => {
  if (!s) return "—";
  const t = String(s);
  const m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : t;
};
/** Códigos do vocabulário viram texto: "aguardando_presidencia" → "aguardando presidencia". */
const leg = (v: unknown) => (v == null || v === "" ? "—" : String(v).replace(/_/g, " "));
const corta = (v: unknown, n = 4000) => {
  const t = v == null ? "" : String(v).trim();
  return t.length > n ? `${t.slice(0, n)}… [cortado]` : t;
};
const campo = (rotulo: string, v: unknown) => {
  const t = typeof v === "boolean" ? (v ? "sim" : "não") : corta(v);
  return t && t !== "—" ? `- ${rotulo}: ${t}` : null;
};

interface Dossie { texto: string; protocolo: string }

async function montarDossie(supa: ReturnType<typeof createClient>, denunciaId: string): Promise<Dossie | { erro: string; status: number }> {
  const { data: d, error } = await supa.from("v_canal_denuncia").select(CAMPOS_DENUNCIA).eq("id", denunciaId).maybeSingle();
  if (error) return { erro: error.message, status: 500 };
  if (!d) return { erro: "Você não tem acesso a esta denúncia.", status: 403 };
  const den = d as Linha;

  // Cada filha pela própria policy. Uma que o login não lê (ex.: a
  // Presidência e as mensagens) volta vazia — e simplesmente não entra.
  const [prov, anx, evt, msg, sla] = await Promise.all([
    supa.from("CANAL_DENUNCIA_PROVIDENCIA").select("ordem, descricao, responsavel, prazo, concluida_em, situacao, observacao, created_at")
      .eq("denuncia_id", denunciaId).order("ordem"),
    supa.from("CANAL_DENUNCIA_ANEXO").select("origem, categoria, nome_arquivo, mime_type, sensivel, descricao, created_at")
      .eq("denuncia_id", denunciaId).order("ordem"),
    supa.from("CANAL_DENUNCIA_EVENTO").select("campo, de, para, por_nome, justificativa, created_at")
      .eq("denuncia_id", denunciaId).order("created_at").limit(300),
    supa.from("CANAL_DENUNCIA_MENSAGEM").select("autor, mensagem, interna, tipo, created_at")
      .eq("denuncia_id", denunciaId).order("created_at").limit(60),
    supa.from("COMITE_ETICA_SLA").select("gravidade, dias"),
  ]);

  const hoje = hojeSp();
  const concluida = SITUACOES_CONCLUIDAS.includes(String(den.status));
  const regra = ((sla.data ?? []) as Linha[]).find((s) => s.gravidade === den.gravidade);
  const prazoDias = Number(den.sla_dias_override ?? regra?.dias ?? 30);
  const diasTratamento = Math.floor((Date.parse(String(concluida && den.concluido_em ? den.concluido_em : new Date().toISOString())) - Date.parse(String(den.created_at))) / DIA);
  const restam = concluida ? null : prazoDias - diasTratamento;

  const s: string[] = [];
  s.push(`DATA DE HOJE: ${dataBr(hoje)}`);
  s.push(`\n## Identificação do procedimento`);
  s.push([
    campo("Protocolo", den.protocolo), campo("Assunto", den.titulo), campo("Situação atual", leg(den.status)),
    campo("Recebida em", dataBr(den.created_at)), campo("Última movimentação", dataBr(den.ultima_movimentacao_em)),
    campo("Empresa", den.empresa_nome), campo("Origem", leg(den.origem)),
    campo("Tipo informado pelo denunciante", leg(den.tipo_denuncia)), campo("Tipo classificado pelo Comitê", leg(den.tipo_classificado)),
    campo("Gravidade", leg(den.gravidade)), campo("Sigilo", leg(den.sigilo)),
    `- Prazo do caso: ${prazoDias} dias; ${diasTratamento} dias de tratamento` +
      (restam == null ? ` (concluída em ${dataBr(den.concluido_em)})` : restam < 0 ? ` — PRAZO ESTOURADO há ${-restam} dias` : ` — restam ${restam} dias`),
    `- Denunciante: ${den.anonimo ? "anônimo" : den.identificado ? "identificado (a identidade não é enviada à I.A)" : "não se identificou, deixou contato"}`,
  ].filter(Boolean).join("\n"));

  s.push(`\n## Relato recebido (imutável)`);
  s.push([
    campo("Relação com o grupo", leg(den.relacao)), campo("Contrato informado", den.contrato_informado),
    campo("Quando aconteceu", den.ocorrencia_data ? `${dataBr(den.ocorrencia_data)}${den.ocorrencia_hora ? ` às ${den.ocorrencia_hora}` : ""}` : null),
    campo("Frequência", leg(den.ocorrencia_frequencia)), campo("Local", den.local_ocorrencia), campo("Como soube", den.como_soube),
    campo("Pessoa denunciada (segundo o denunciante)", den.denunciado_informado ? `${den.denunciado_informado}${den.denunciado_funcao ? ` — ${den.denunciado_funcao}` : ""}` : null),
    campo("Valor envolvido", den.valor_financeiro),
    den.risco_imediato ? `- RISCO IMEDIATO informado: ${corta(den.risco_imediato_detalhe, 800) || "sem detalhe"}` : null,
    den.retaliacao ? `- AMEAÇA/RETALIAÇÃO informada: ${corta(den.retaliacao_detalhe, 800) || "sem detalhe"}` : null,
    campo("Liderança ciente", leg(den.lideranca_ciente)), campo("Quem (ciente)", den.lideranca_ciente_quem),
    campo("Liderança envolvida", leg(den.lideranca_envolvida)), campo("Quem (envolvida)", den.lideranca_envolvida_quem),
    campo("Liderança tentou esconder", leg(den.lideranca_ocultou)), campo("Quem (ocultou)", den.lideranca_ocultou_quem),
    campo("Relato", den.descricao), campo("Testemunhas", den.testemunhas),
    campo("Evidências citadas no relato", den.evidencias), campo("Sugestão do denunciante", den.sugestao),
  ].filter(Boolean).join("\n"));

  s.push(`\n## Apuração (ficha do Comitê)`);
  s.push([
    campo("Resumo objetivo", den.resumo), campo("Denunciado (vinculado)", den.denunciado_nome), campo("Líder imediato", den.lider_nome),
    campo("Diretoria", den.diretoria), campo("Contrato", den.contrato), campo("Setor", den.setor),
    campo("Unidade", den.unidade), campo("Cidade", den.cidade),
    campo("Responsável pela apuração", den.apuracao_responsavel),
    campo("Primeira providência", dataBr(den.primeira_providencia_em)),
    campo("Início da apuração", dataBr(den.apuracao_inicio)), campo("Conclusão da apuração", dataBr(den.apuracao_fim)),
    campo("Pendência atual", den.pendencia_atual), campo("Evidências analisadas", den.evidencias_analise),
  ].filter(Boolean).join("\n") || "- (nada preenchido ainda)");

  const provs = (prov.data ?? []) as Linha[];
  s.push(`\n## Providências (${provs.length})`);
  if (!provs.length) s.push("- Nenhuma providência registrada.");
  for (const p of provs) {
    const aberta = !["concluida", "cancelada"].includes(String(p.situacao));
    const estourou = aberta && p.prazo && String(p.prazo).slice(0, 10) < hoje;
    s.push(`- ${p.ordem ?? "?"}. ${corta(p.descricao, 600)} — situação: ${leg(p.situacao)}` +
      `; responsável: ${p.responsavel || "—"}; prazo: ${dataBr(p.prazo)}` +
      (p.concluida_em ? `; concluída em ${dataBr(p.concluida_em)}` : "") +
      (estourou ? " — PRAZO ESTOURADO" : "") +
      (p.observacao ? `; observação: ${corta(p.observacao, 400)}` : ""));
  }

  const anexos = (anx.data ?? []) as Linha[];
  s.push(`\n## Evidências e documentos (${anexos.length}) — só a lista; o conteúdo dos arquivos não foi lido`);
  if (!anexos.length) s.push("- Nenhum arquivo.");
  for (const a of anexos) {
    if (a.sensivel) { s.push(`- Existe um anexo sigiloso (${leg(a.categoria)}, enviado em ${dataBr(a.created_at)}).`); continue; }
    s.push(`- ${corta(a.nome_arquivo, 200)} — ${leg(a.categoria)}${a.origem ? `, origem ${leg(a.origem)}` : ""}, em ${dataBr(a.created_at)}` +
      (a.descricao ? `; descrição: ${corta(a.descricao, 300)}` : ""));
  }

  s.push(`\n## Resultado e medidas`);
  s.push([
    campo("Resultado", leg(den.resultado)), campo("Causa raiz", leg(den.causa_raiz)), campo("Detalhe da causa raiz", den.causa_raiz_detalhe),
    campo("Medidas aplicadas", Array.isArray(den.medidas) && den.medidas.length ? (den.medidas as string[]).map(leg).join(", ") : null),
    campo("Medida principal", leg(den.medida_principal)), campo("Recomendação do Comitê", leg(den.recomendacao)),
    campo("Ações corretivas", den.acoes_corretivas), campo("Ações preventivas", den.acoes_preventivas),
    campo("Parecer interno do Comitê", den.parecer_interno),
    campo("Retorno ao denunciante", den.retorno_denunciante),
  ].filter(Boolean).join("\n") || "- (nada definido ainda)");

  s.push(`\n## Decisão da Presidência`);
  s.push(den.decisao_em
    ? [campo("Decisão", den.decisao_final), campo("Sobre o parecer do Comitê", leg(den.decisao_sobre_parecer)),
       campo("Medidas decididas", den.decisao_medidas), campo("Fundamentação", den.decisao_fundamentacao),
       campo("Registrada por", den.decisao_por_nome), campo("Em", dataBr(den.decisao_em))].filter(Boolean).join("\n")
    : "- Ainda não há decisão registrada.");
  if (den.houve_recurso) s.push(`- Houve recurso: ${leg(den.recurso_resultado)} em ${dataBr(den.recurso_data)}`);

  const eventos = (evt.data ?? []) as Linha[];
  if (eventos.length) {
    s.push(`\n## Histórico (gravado pelo banco)`);
    for (const e of eventos) {
      // Só o que conta a história: troca de situação e marcos da apuração.
      if (!["status", "resultado", "gravidade", "apuracao_responsavel", "decisao_final", "recomendacao", "apuracao_inicio", "apuracao_fim"].includes(String(e.campo))) continue;
      s.push(`- ${dataBr(e.created_at)}: ${leg(e.campo)} ${e.de ? `${leg(e.de)} → ` : ""}${leg(e.para)}` +
        (e.por_nome ? ` (por ${e.por_nome})` : "") + (e.justificativa ? ` — motivo: ${corta(e.justificativa, 300)}` : ""));
    }
  }

  const mensagens = (msg.data ?? []) as Linha[];
  if (mensagens.length) {
    s.push(`\n## Conversa e registros (${mensagens.length} mais antigos primeiro)`);
    for (const m of mensagens) {
      s.push(`- ${dataBr(m.created_at)} · ${m.autor === "comite" ? "Comitê" : "Denunciante"}${m.interna ? ` (interno, ${leg(m.tipo)})` : ""}: ${corta(m.mensagem, 500)}`);
    }
  }

  return { texto: s.join("\n"), protocolo: String(den.protocolo ?? "") };
}

// ------------------------------------------------------------ prompts

const REGRAS = `Você é um assistente do Comitê de Ética de uma empresa de terceirização (Grupo Nascimento), ajudando o Comitê e a Presidência a conduzir uma denúncia.
Regras:
- Responda em português do Brasil, em Markdown, com tom institucional, objetivo e imparcial.
- Use SÓ os dados do dossiê. Não invente fatos, nomes, datas ou documentos; quando algo não consta, diga que não consta.
- Não presuma culpa: fale em "relato", "fato apurado", "indícios", conforme o que o dossiê sustenta.
- Não tente descobrir nem sugerir quem é o denunciante, e não peça dados de identificação dele.
- Anexos sigilosos aparecem só como "existe um anexo sigiloso": não especule sobre o conteúdo.
- Prazo estourado = data de prazo anterior à data de hoje com a providência ainda aberta; o prazo do caso já vem calculado.`;

const PEDIDO_RESUMO = `Faça o resumo da denúncia com estas seções, nesta ordem (títulos com ###):
### O que foi relatado
### Linha do tempo
(datas em ordem: recebimento, primeiras providências, mudanças de situação, decisão)
### Providências
(feitas, pendentes e as de prazo estourado — destaque as estouradas)
### Evidências e documentos
(o que existe — só a lista)
### Resultado e medidas até agora
### Situação atual
(inclua o prazo do caso)
### Próximos passos sugeridos
(lista curta e prática do que falta para concluir)
Seja conciso: no máximo uns 400 palavras.`;

/** Histórico vindo do cliente: só user/assistant, texto curto, últimas 20. */
function limparHistorico(h: unknown): { role: string; content: string }[] {
  if (!Array.isArray(h)) return [];
  return h
    .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim())
    .slice(-20)
    .map((m) => ({ role: m.role, content: String(m.content).slice(0, 6000) }));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return respostaJson({ error: "Use POST." }, 405);

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) return respostaJson({ error: "Faça login." }, 401);

    const corpo = await req.json().catch(() => ({}));
    const denunciaId = String(corpo?.denuncia_id ?? "").trim();
    if (!/^[0-9a-f-]{36}$/i.test(denunciaId)) return respostaJson({ error: "denuncia_id inválido." }, 400);
    const modo = corpo?.modo === "chat" ? "chat" : "resumo";
    const pergunta = String(corpo?.pergunta ?? "").trim().slice(0, 2000);
    if (modo === "chat" && !pergunta) return respostaJson({ error: "Escreva a pergunta." }, 400);

    // Com o login de quem pediu: toda leitura daqui passa pela RLS dele.
    const supa = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });
    const { data: userData, error: userErr } = await supa.auth.getUser();
    if (userErr || !userData?.user) return respostaJson({ error: "Sessão inválida." }, 401);

    const dossie = await montarDossie(supa, denunciaId);
    if ("erro" in dossie) return respostaJson({ error: dossie.erro }, dossie.status);

    const provs = provedores();
    if (!provs.length) return respostaJson({ error: "A chave da IA não está configurada. Avise o time de Sistemas." }, 500);

    const sistema = `${REGRAS}\n\n=== DOSSIÊ DA DENÚNCIA ${dossie.protocolo} ===\n${dossie.texto}\n=== FIM DO DOSSIÊ ===`;
    const messages = modo === "chat"
      ? [{ role: "system", content: sistema }, ...limparHistorico(corpo?.historico), { role: "user", content: pergunta }]
      : [{ role: "system", content: sistema }, { role: "user", content: PEDIDO_RESUMO }];

    const res = await chamarIA(provs, messages);
    if (!res.texto) return respostaJson({ error: res.erro }, res.status ?? 502);
    return respostaJson({ texto: res.texto, provedor: res.provedor, modelo: res.modelo, gerado_em: new Date().toISOString() });
  } catch (e) {
    // Só a mensagem do erro — nunca o dossiê.
    console.error("denuncia-parecer-ia", e instanceof Error ? e.message : "erro");
    return respostaJson({ error: e instanceof Error ? e.message : "Não foi possível falar com a IA agora." }, 500);
  }
});
