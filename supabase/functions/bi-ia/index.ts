// Estúdio de BI — a IA que escreve o gráfico a partir de um texto.
//
// O analista descreve ("faturamento por contrato nos últimos 6 meses, em
// barras") e esta função devolve o widget pronto: título, tipo de gráfico,
// SQL e a configuração de eixo/séries. O SQL é RODADO antes de voltar — pelo
// mesmo bi_executar_sql que o editor usa, com o JWT de quem pediu —, e se
// quebrar o erro volta pro modelo corrigir (uma rodada). O que chega na tela
// já tem amostra de dados; o analista revisa e salva.
//
// Quem pode: menu bi_estudio + ação executar_ia. Tudo fica em BI_IA_LOG.
//
// Provedor: o mesmo desenho de painel-formularios-chat — endpoint compatível
// com OpenAI-chat. Gemini (GEMINI_API_KEY) primeiro; sem ela, Groq
// (GROQ_API_KEY). O modelo sai de variável de ambiente porque nome de modelo
// do free tier muda com frequência.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const jsonHeaders = { ...corsHeaders, "Content-Type": "application/json" };
const respostaJson = (corpo: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: jsonHeaders });

const ERRO_SEM_TOKENS = "Acabou os tokens da IA, é necessário aguardar a IA renovar os tokens.";
const MAX_PEDIDO_CHARS = 4000;
const MAX_HISTORICO = 8;

const TIPOS = ["kpi", "barras", "barras_h", "barras_empilhadas", "linha", "area", "pizza", "rosca", "dispersao", "tabela"];

function provedor() {
  const gemini = Deno.env.get("GEMINI_API_KEY");
  if (gemini) {
    return {
      nome: "gemini",
      url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
      chave: gemini,
      modelo: Deno.env.get("IA_BI_MODELO") ?? Deno.env.get("IA_CHAT_MODELO") ?? "gemini-3.6-flash",
    };
  }
  const groq = Deno.env.get("GROQ_API_KEY");
  if (groq) {
    return {
      nome: "groq",
      url: "https://api.groq.com/openai/v1/chat/completions",
      chave: groq,
      modelo: Deno.env.get("IA_BI_MODELO") ?? Deno.env.get("GROQ_MODEL") ?? "openai/gpt-oss-120b",
    };
  }
  return null;
}

const SYSTEM_PROMPT = `Você é o analista de BI do ERP do Grupo Nascimento (Postgres/Supabase).
Sua função: transformar um pedido em português em UM OU MAIS gráficos prontos, com SQL correto.

RESPONDA SOMENTE COM JSON, sem markdown, neste formato:
{
  "resposta": "uma frase curta dizendo o que você montou",
  "painel": { "nome": "...", "descricao": "...", "filtros": [ { "chave": "inicio", "rotulo": "Início", "tipo": "data", "padrao": "2026-01-01" } ] },
  "widgets": [
    {
      "titulo": "...", "subtitulo": "...",
      "tipo": "barras|barras_h|barras_empilhadas|linha|area|pizza|rosca|dispersao|kpi|tabela",
      "sql": "SELECT ...",
      "config": {
        "x": "nome_da_coluna_do_eixo",
        "series": [ { "coluna": "nome_da_coluna", "rotulo": "Rótulo" } ],
        "formato": "numero|moeda|percentual|inteiro", "casas": 0,
        "mostrar_rotulos": false,
        "kpi": { "coluna": "valor", "comparar_coluna": "valor_anterior", "sufixo": "" }
      },
      "largura": 6, "altura": 2,
      "explicacao": "uma frase sobre como o número é calculado"
    }
  ]
}
"painel" só quando o pedido for criar um painel novo inteiro; senão omita.
"filtros" do painel: tipo "data" | "texto" | "numero" | "lista" (com "opcoes": [...]).

REGRAS DO SQL (obrigatórias):
1. Só SELECT (pode usar WITH). Uma instrução. Sem ponto e vírgula no final.
2. Use APENAS tabelas e colunas do CATÁLOGO abaixo. Nunca invente coluna.
3. Nomes com maiúscula, espaço ou acento SEMPRE entre aspas duplas: "SISTEMA_RECRUTAMENTO", "Nome Filial", "Valor Salário".
4. Dê alias curto e em snake_case sem acento para TODA coluna de saída (ex.: AS total, AS mes, AS contrato).
5. Colunas de valor em texto (ex.: "Valor Salário" text) precisam de conversão: NULLIF(REPLACE(REPLACE(col, '.', ''), ',', '.'), '')::numeric — e datas em texto: rh_data_br_para_date(col) quando a coluna estiver em DD/MM/AAAA.
6. Série temporal: agrupe por date_trunc('month', coluna) e devolva to_char(..., 'YYYY-MM') AS mes, ordenado por mes.
7. Limite a saída a no máximo 500 linhas (LIMIT), exceto tabela/detalhe.
8. Filtros do painel entram no SQL como {{chave}} e viram literal na execução. Ex.: WHERE criado_em >= {{inicio}}::date. Só use chaves que existem em FILTROS DISPONÍVEIS, ou que você mesmo esteja criando em "painel.filtros".
9. Para "kpi": o SQL devolve UMA linha; "config.kpi.coluna" é a coluna do número; "comparar_coluna" (opcional) é o período anterior, pra mostrar variação.
10. Para pizza/rosca: SQL devolve (categoria, valor); "x" = categoria, "series" = [valor]. Máximo 8 fatias — agrupe o resto como 'Outros'.
11. "x" e cada "series[].coluna" TÊM que ser aliases que existem no SELECT.
12. Nunca consulte auth, storage, pg_catalog, information_schema, nem tabelas de senha/token/denúncia.

ESCOLHA DO GRÁFICO: barras para comparar categorias; linha/area para evolução no tempo; barras_empilhadas para composição ao longo de categorias; pizza/rosca só com poucas partes de um todo; dispersao para relação entre dois números; kpi para um número-resumo; tabela para detalhe.
Tamanhos: largura 3/4/6/8/12 (grade de 12); kpi costuma ser 3 x altura 1; gráfico 6 x 2; tabela 12 x 2.
Quando o usuário pedir pra AJUSTAR um gráfico existente (WIDGET ATUAL), devolva o mesmo widget alterado em "widgets" (um só).
Se o pedido for impossível com o catálogo, devolva "widgets": [] e explique em "resposta".`;

interface MensagemChat { role: string; content: string }

/**
 * O catálogo inteiro tem ~500 tabelas — não cabe (nem ajuda) no prompt. Em
 * duas etapas: a IA escolhe até 12 tabelas olhando só os NOMES (e quantas
 * colunas cada uma tem), e só essas vão com as colunas na etapa de gerar.
 * Sem a IA (erro), cai na heurística: tabelas cujo nome tem alguma palavra
 * do pedido.
 */
const MAX_TABELAS_PROMPT = 12;
function palavras(txt: string): string[] {
  return txt.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .split(/[^a-z0-9_]+/).filter(w => w.length >= 4);
}
function escolherPorHeuristica(catalogo: any[], pedido: string, extras: string[] = []): any[] {
  const ws = palavras(pedido);
  const pontua = (t: any) => {
    const nome = t.nome.toLowerCase();
    let n = extras.includes(t.nome) ? 100 : 0;
    for (const w of ws) if (nome.includes(w) || (w.endsWith("s") && nome.includes(w.slice(0, -1)))) n += 3;
    if (t.tipo === "view") n += 1;
    return n;
  };
  return [...catalogo].map(t => ({ t, n: pontua(t) })).filter(x => x.n > 0).sort((a, b) => b.n - a.n).slice(0, MAX_TABELAS_PROMPT).map(x => x.t);
}
function nomesCitados(texto: string, catalogo: any[]): string[] {
  const t = texto.toUpperCase();
  return catalogo.map((c: any) => c.nome).filter((n: string) => n.length >= 5 && t.includes(n.toUpperCase()));
}

function catalogoCompacto(catalogo: any[]): string {
  return catalogo.map((t) =>
    `${t.tipo === "view" ? "VIEW " : ""}"${t.nome}"(${(t.colunas ?? []).map((c: any) => `"${c.nome}":${abreviaTipo(c.tipo)}`).join(", ")})`
  ).join("\n");
}
function abreviaTipo(t: string): string {
  if (!t) return "?";
  if (/timestamp/.test(t)) return "timestamp";
  if (/character|text/.test(t)) return "text";
  if (/bigint|integer|smallint/.test(t)) return "int";
  if (/numeric|double|real/.test(t)) return "num";
  if (/bool/.test(t)) return "bool";
  return t;
}

function extrairJson(texto: string): any {
  const t = texto.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  try { return JSON.parse(t); } catch { /* tenta achar o primeiro { ... } */ }
  const ini = t.indexOf("{"); const fim = t.lastIndexOf("}");
  if (ini >= 0 && fim > ini) return JSON.parse(t.slice(ini, fim + 1));
  throw new Error("A IA não devolveu JSON.");
}

function normalizarWidget(w: any) {
  const tipo = TIPOS.includes(w?.tipo) ? w.tipo : "barras";
  const config = typeof w?.config === "object" && w.config ? w.config : {};
  const series = Array.isArray(config.series)
    ? config.series.filter((s: any) => s && s.coluna).map((s: any) => ({ coluna: String(s.coluna), rotulo: s.rotulo ? String(s.rotulo) : String(s.coluna), cor: s.cor }))
    : [];
  return {
    titulo: String(w?.titulo ?? "Sem título").slice(0, 120),
    subtitulo: w?.subtitulo ? String(w.subtitulo).slice(0, 200) : null,
    tipo,
    sql: String(w?.sql ?? "").replace(/;\s*$/, "").trim(),
    config: { ...config, x: config.x ? String(config.x) : undefined, series },
    largura: [3, 4, 6, 8, 12].includes(Number(w?.largura)) ? Number(w.largura) : (tipo === "kpi" ? 3 : tipo === "tabela" ? 12 : 6),
    altura: [1, 2, 3, 4].includes(Number(w?.altura)) ? Number(w.altura) : (tipo === "kpi" ? 1 : 2),
    explicacao: w?.explicacao ? String(w.explicacao) : null,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return respostaJson({ error: "Método não suportado." }, 405);
  const t0 = Date.now();

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) return respostaJson({ error: "Sem sessão." }, 401);

    const supa = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await supa.auth.getUser();
    if (userErr || !userData?.user) return respostaJson({ error: "Sessão inválida." }, 401);
    const uid = userData.user.id;

    const { data: pode } = await supa.rpc("has_screen_access", { _user: uid, _menu: "bi_estudio", _acao: "executar_ia" });
    if (!pode) return respostaJson({ error: "Você não tem a ação 'executar IA' no Estúdio de BI." }, 403);

    const corpo = await req.json().catch(() => ({}));
    const pedido = String(corpo?.pedido ?? "").trim().slice(0, MAX_PEDIDO_CHARS);
    if (!pedido) return respostaJson({ error: "Escreva o que você quer ver." }, 400);
    const painelId = corpo?.painel_id ? Number(corpo.painel_id) : null;
    const widgetAtual = corpo?.widget_atual ?? null;
    const filtros = Array.isArray(corpo?.filtros) ? corpo.filtros : [];
    const params = typeof corpo?.params === "object" && corpo.params ? corpo.params : {};
    const historico: MensagemChat[] = (Array.isArray(corpo?.historico) ? corpo.historico : [])
      .filter((m: any) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
      .slice(-MAX_HISTORICO)
      .map((m: any) => ({ role: m.role, content: String(m.content).slice(0, 4000) }));

    const prov = provedor();
    if (!prov) return respostaJson({ error: "A chave da IA não está configurada. Avise o time de Sistemas." }, 500);

    const { data: catalogo, error: catErr } = await supa.rpc("bi_catalogo");
    if (catErr) return respostaJson({ error: "Não consegui ler o catálogo: " + catErr.message }, 500);

    // ── Etapa A: quais tabelas importam ──────────────────────────────
    const todas: any[] = catalogo ?? [];
    const citadas = [
      ...nomesCitados(pedido, todas),
      ...nomesCitados(widgetAtual?.sql ?? "", todas),
      ...historico.flatMap(h => nomesCitados(h.content, todas)),
    ];
    let escolhidas: any[] = [];
    try {
      const listaNomes = todas.map((t: any) => `${t.nome} (${(t.colunas ?? []).length} col${t.tipo === "view" ? ", view" : ""})`).join("\n");
      const r = await fetch(prov.url, {
        method: "POST",
        headers: { Authorization: `Bearer ${prov.chave}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: prov.modelo, temperature: 0,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: `Você escolhe, num banco Postgres de um ERP (RH, recrutamento, financeiro, contratos, suprimentos, chamados...), quais tabelas são necessárias para responder um pedido de BI. Responda SÓ JSON: {"tabelas": ["NOME", ...]} com no máximo ${MAX_TABELAS_PROMPT} nomes EXATAMENTE como na lista. Prefira tabelas de domínio (MAIÚSCULAS) e views (vw_/v_). Inclua tabelas de apoio quando o pedido precisar de JOIN (ex.: contratos, empresas, setores).\n\nLISTA:\n${listaNomes}` },
            { role: "user", content: pedido + (widgetAtual?.sql ? "\n\nSQL atual:\n" + widgetAtual.sql : "") },
          ],
        }),
      });
      if (r.ok) {
        const j = await r.json();
        const nomes: string[] = extrairJson(String(j?.choices?.[0]?.message?.content ?? "{}"))?.tabelas ?? [];
        escolhidas = todas.filter((t: any) => nomes.includes(t.nome)).slice(0, MAX_TABELAS_PROMPT);
      }
    } catch (e) {
      console.warn("etapa A falhou, usando heurística:", e instanceof Error ? e.message : e);
    }
    for (const n of citadas) { const t = todas.find((x: any) => x.nome === n); if (t && !escolhidas.includes(t)) escolhidas.push(t); }
    if (escolhidas.length === 0) escolhidas = escolherPorHeuristica(todas, pedido, citadas);
    if (escolhidas.length === 0) escolhidas = todas.filter((t: any) => /^(EMPREGADOS|SISTEMA_RECRUTAMENTO|CONTRATOS|SISTEMA_SOLICITACOES_DEMISSAO)$/.test(t.nome));

    const contexto = [
      "CATÁLOGO (tabela(coluna:tipo, ...)) — só estas tabelas existem para você:",
      catalogoCompacto(escolhidas),
      "",
      "FILTROS DISPONÍVEIS NO PAINEL: " + (filtros.length ? JSON.stringify(filtros) : "(nenhum)"),
      widgetAtual ? "\nWIDGET ATUAL (ajuste este): " + JSON.stringify(widgetAtual) : "",
      "\nDATA DE HOJE: " + new Date().toISOString().slice(0, 10),
    ].join("\n");

    const chamar = async (mensagens: MensagemChat[]) => {
      const r = await fetch(prov.url, {
        method: "POST",
        headers: { Authorization: `Bearer ${prov.chave}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: prov.modelo,
          temperature: 0.2,
          response_format: { type: "json_object" },
          messages: [{ role: "system", content: SYSTEM_PROMPT + "\n\n" + contexto }, ...mensagens],
        }),
      });
      if (!r.ok) {
        const txt = await r.text();
        console.error("IA erro", r.status, txt.slice(0, 300));
        if (r.status === 429 || r.status === 402) throw Object.assign(new Error(ERRO_SEM_TOKENS), { status: r.status });
        if (r.status === 401 || r.status === 403) throw Object.assign(new Error("A chave da IA foi recusada. Avise o time de Sistemas."), { status: 502 });
        if (r.status === 404) throw Object.assign(new Error(`O modelo "${prov.modelo}" não existe nesta API. Ajuste a variável IA_BI_MODELO.`), { status: 502 });
        throw Object.assign(new Error(`Falha ao chamar a IA (HTTP ${r.status}).`), { status: 502 });
      }
      const dados = await r.json();
      const erroCorpo = String(dados?.error?.message ?? "");
      if (/quota|rate limit|resource_exhausted/i.test(erroCorpo)) throw Object.assign(new Error(ERRO_SEM_TOKENS), { status: 429 });
      const texto = dados?.choices?.[0]?.message?.content;
      if (!texto) throw Object.assign(new Error("A IA devolveu resposta vazia."), { status: 502 });
      return String(texto);
    };

    // 1ª rodada
    const mensagens: MensagemChat[] = [...historico, { role: "user", content: pedido }];
    let bruto = await chamar(mensagens);
    let saida = extrairJson(bruto);
    let widgets = (Array.isArray(saida?.widgets) ? saida.widgets : []).map(normalizarWidget);

    // Roda cada SQL; o que quebrar volta pro modelo corrigir (uma rodada só).
    const testar = async (w: any) => {
      if (!w.sql) return { ok: false, erro: "SQL vazio." };
      const { data, error } = await supa.rpc("bi_executar_sql", { p_sql: w.sql, p_params: params, p_limite: 50 });
      if (error) return { ok: false, erro: error.message };
      const cols = (data?.colunas ?? []).map((c: any) => c.nome);
      const faltam = [w.config?.x, ...(w.config?.series ?? []).map((s: any) => s.coluna), w.config?.kpi?.coluna]
        .filter(Boolean).filter((c: string) => cols.length && !cols.includes(c));
      if (faltam.length) return { ok: false, erro: `O SELECT não devolve as colunas ${faltam.join(", ")} usadas em config (colunas devolvidas: ${cols.join(", ")}).` };
      return { ok: true, amostra: data };
    };

    let resultados = await Promise.all(widgets.map(testar));
    let tentativas = 1;
    const quebrados = widgets.map((w: any, i: number) => ({ w, r: resultados[i], i })).filter((x) => !x.r.ok);
    if (quebrados.length) {
      tentativas = 2;
      const correcao = "Os SQLs abaixo falharam ao rodar. Devolva o MESMO JSON completo, corrigindo só o que quebrou:\n" +
        quebrados.map((q) => `- widget "${q.w.titulo}": ${q.r.erro}\n  SQL: ${q.w.sql}`).join("\n");
      bruto = await chamar([...mensagens, { role: "assistant", content: bruto }, { role: "user", content: correcao }]);
      const saida2 = extrairJson(bruto);
      const widgets2 = (Array.isArray(saida2?.widgets) ? saida2.widgets : []).map(normalizarWidget);
      if (widgets2.length) {
        saida = saida2; widgets = widgets2;
        resultados = await Promise.all(widgets.map(testar));
      }
    }

    const widgetsFinal = widgets.map((w: any, i: number) => ({
      ...w,
      ok: resultados[i].ok,
      erro: resultados[i].ok ? null : resultados[i].erro,
      amostra: resultados[i].ok ? resultados[i].amostra : null,
      criado_por_ia: true,
    }));

    const painel = saida?.painel && typeof saida.painel === "object"
      ? {
          nome: String(saida.painel.nome ?? "Novo painel").slice(0, 120),
          descricao: saida.painel.descricao ? String(saida.painel.descricao).slice(0, 400) : null,
          filtros: Array.isArray(saida.painel.filtros) ? saida.painel.filtros.filter((f: any) => f?.chave && f?.tipo) : [],
        }
      : null;

    const resposta = {
      resposta: String(saida?.resposta ?? "").slice(0, 600),
      painel,
      widgets: widgetsFinal,
      tentativas,
      modelo: `${prov.nome}/${prov.modelo}`,
      tabelas: escolhidas.map((t: any) => t.nome),
    };

    await supa.from("BI_IA_LOG").insert({
      user_id: uid, painel_id: painelId, pedido, resposta, modelo: resposta.modelo, duracao_ms: Date.now() - t0,
    });

    return respostaJson(resposta);
  } catch (e) {
    const status = (e as any)?.status ?? 500;
    const msg = e instanceof Error ? e.message : String(e);
    console.error("bi-ia", msg);
    return respostaJson({ error: msg }, status);
  }
});
