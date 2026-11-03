// Formulários › Assistente de I.A — em TODOS os formulários (30/10/2026).
//
// Pablo: "o assistente de i.a ter em todos formulários". Nasceu como o agente
// da Pesquisa de Permanência (pesquisa-permanencia-ia, mig 20261028001200),
// que saiu do RH e virou um formulário (mig 20261030001000). Esta função é a
// mesma, com duas leituras:
//   · formulário com local de trabalho + as perguntas do catálogo de
//     permanência (ehFormularioPermanencia): o contexto de antes —
//     contextoIA() do _shared, com a rotatividade do mesmo contrato/posto/
//     função quando a pessoa tem a capacidade "rotatividade";
//   · qualquer outro formulário: o agregado do diagnóstico por IA
//     (agregarFormulario, o mesmo do Diagnóstico IA) — contagens das
//     perguntas fechadas e textos livres com os nomes conhecidos apagados.
// Dois modos, como antes: "analise" (resumo pronto) e "pergunta" (conversa).
//
// Portão: capacidade "assistente_ia" (CS_FORM_ACESSOS). As respostas são
// lidas com o JWT de quem pediu — a RLS do Formulários escolhe o que entra;
// a I.A nunca vê resposta que a pessoa não veria na tela.
//
// Provedor: Gemini (GEMINI_API_KEY) primeiro; erro passageiro tenta de novo;
// sem tokens ou chave recusada, passa ao Groq (GROQ_API_KEY, modelo
// openai/gpt-oss-120b). Chaves nos secrets da Edge Function, nunca em arquivo.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import {
  contextoIA, ehFormularioPermanencia, linhasDoFormulario, TIPO_ESCOLHA, TIPO_LOCAL,
  type ConfigEscolha, type Filtro, type LinhaTurnover, type ValorLocal,
} from "../_shared/pesquisa-permanencia.ts";
import { montarDicionarioNomes, type PerguntaDiagnostico, type RespostaDiagnostico } from "../_shared/diagnostico-feedback.ts";
import { agregarFormulario } from "../_shared/diagnostico-formulario.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const respostaJson = (corpo: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const ERRO_SEM_TOKENS = "Acabou os tokens da IA, é necessário aguardar a IA renovar os tokens.";

type Msg = { role: "user" | "assistant"; content: string };
type Provedor = { nome: string; url: string; chave: string; modelo: string };

function provedores(): Provedor[] {
  const lista: Provedor[] = [];
  const gemini = Deno.env.get("GEMINI_API_KEY");
  if (gemini) {
    lista.push({ nome: "gemini", url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", chave: gemini,
                 modelo: Deno.env.get("IA_PP_MODELO") ?? Deno.env.get("IA_CHAT_MODELO") ?? "gemini-3.6-flash" });
  }
  const groq = Deno.env.get("GROQ_API_KEY");
  if (groq) {
    lista.push({ nome: "groq", url: "https://api.groq.com/openai/v1/chat/completions", chave: groq,
                 modelo: Deno.env.get("GROQ_MODEL") ?? "openai/gpt-oss-120b" });
  }
  return lista;
}

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function chamarIA(provs: Provedor[], messages: { role: string; content: string }[]): Promise<{ texto?: string; erro?: string; status?: number }> {
  let ultimo: { erro: string; status: number } = { erro: "Não foi possível responder agora.", status: 502 };
  for (const prov of provs) {
    for (let tentativa = 1; tentativa <= 2; tentativa++) {
      const r = await fetch(prov.url, {
        method: "POST",
        headers: { Authorization: `Bearer ${prov.chave}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: prov.modelo, temperature: 0.2, messages }),
      }).catch((e) => { console.error("IA rede", prov.nome, e); return null; });
      if (r && r.ok) {
        const dados = await r.json().catch(() => null);
        if (/quota|rate limit|resource_exhausted/i.test(String(dados?.error?.message ?? ""))) { ultimo = { erro: ERRO_SEM_TOKENS, status: 429 }; break; }
        const texto = String(dados?.choices?.[0]?.message?.content ?? "").trim();
        if (texto) return { texto };
        ultimo = { erro: "A IA devolveu resposta vazia. Tente de novo.", status: 502 };
        break;
      }
      const status = r?.status ?? 0;
      console.error("IA erro", prov.nome, prov.modelo, status, r ? (await r.text()).slice(0, 300) : "sem resposta");
      if (status === 429 || status === 402) { ultimo = { erro: ERRO_SEM_TOKENS, status: 429 }; break; }
      if (status === 401 || status === 403) { ultimo = { erro: "A chave da IA foi recusada. Avise o time de Sistemas.", status: 502 }; break; }
      ultimo = { erro: `Falha ao chamar a IA (HTTP ${status || "sem resposta"}).`, status: 502 };
      if (!(status === 0 || status >= 500) || tentativa === 2) break;
      await esperar(1200);
    }
  }
  return ultimo;
}

// ── Pesquisa de permanência (o prompt de pesquisa-permanencia-ia) ─────────
const SYSTEM_PERMANENCIA = `Você é o analista de rotatividade do RH do Grupo Nascimento (empresa de terceirização: limpeza, portaria, recepção, motoristas, apoio administrativo, em contratos com órgãos públicos — universidades, prefeituras).
Você responde a gestores (não técnicos) sobre a PESQUISA DE PERMANÊNCIA e a ROTATIVIDADE (turnover) por contrato, posto de trabalho e função.

Você recebe um JSON só com AGREGADOS:
- indicadores gerais e as 8 perguntas com quantidades e % (nas perguntas 1, 2 e 8 cada pessoa marca até 3 e indica a MAIS importante — "marcaram" soma mais que 100%; "mais_importante" soma 100%);
- resumo gerencial separando problemas da EMPRESA (liderança/encarregado, salário, sobrecarga, colegas, concorrência), dos FISCAIS do órgão e da ESTRUTURA do órgão público;
- pontos de atenção (grupos acima do geral);
- por contrato / função / posto: respostas, satisfação, insatisfação, motivo de saída mais importante, prioridade mais pedida e o TURNOVER do mesmo recorte (turnover mensal médio %, demissões no período, efetivo médio);
- contratos com rotatividade e pouca ou nenhuma resposta.
"satisfacao_pct"/"insatisfacao_pct" = % das avaliações das perguntas 3 a 7 que foram positivas/negativas. "recomendacao_pts" = % "Sim, com certeza" − % "Não indicaria".
Grupo com menos de "minimo_por_grupo" respostas não aparece detalhado (anonimato) — se perguntarem dele, diga isso.
Se "periodo_turnover" vier vazio, a pessoa não tem acesso à rotatividade: responda só com a pesquisa e diga isso quando perguntarem de turnover.

Regras:
- Português do Brasil, direto, frases curtas.
- Use só o que está nos dados. Não invente número, contrato, causa ou nome. Cite os números (quantidade e %) ao afirmar algo, e o tamanho da amostra.
- Para "por que o contrato X perde gente": junte o turnover dele com o que as pessoas de lá responderam (motivo de saída mais importante, avaliação do encarregado, fiscais, condições do órgão, se indicariam) e compare com o geral. Diga quando a amostra é pequena ou quando o contrato não tem respostas suficientes.
- Separe sempre o que é da empresa (dá para agir direto), o que é dos fiscais (tratar com o gestor do contrato no órgão) e o que é da estrutura do órgão (negociar com o cliente).
- Ao sugerir plano de ação: ação concreta, onde (contrato/posto/função), por quê (o número), quem costuma ser o dono (RH, Operação/supervisão, Gestão do contrato) e um prazo sugerido.
- A pesquisa é anônima: nunca tente identificar quem respondeu. Nomes de pessoas não existem nos dados.
- Markdown simples: ## títulos, "-" listas, ** negrito. Tabelas pequenas quando ajudarem.`;

const PEDIDO_ANALISE_PERMANENCIA = `Faça o resumo gerencial da pesquisa com estas seções curtas:
## Quadro geral
(respostas, satisfação, recomendação, turnover do período)
## Onde a rotatividade se concentra
(contratos/postos/funções com maior turnover e o que as pessoas de lá disseram)
## Problemas da empresa
## Problemas com os fiscais
## Estrutura do órgão público
## Plano de ação sugerido
(3 a 6 ações priorizadas, cada uma com onde, por quê — o número — dono e prazo)
## Perguntas que você pode fazer
(3 sugestões curtas)`;

// ── Qualquer formulário ──────────────────────────────────────────────────
const SYSTEM_GERAL = `Você é o assistente de análise dos formulários do Grupo Nascimento.
Responde a gestores (não técnicos), em português do Brasil, sobre as respostas de UM formulário.

Você recebe um JSON só com AGREGADOS: as perguntas fechadas com quantidade e % de cada opção ("total_respondido" é quantos responderam a pergunta; em caixas de seleção a soma passa de 100%) e os textos livres das perguntas abertas, com nomes de pessoas já apagados.

Regras:
- Use só o que está nos dados. Não invente número, causa, setor ou nome. Cite os números (quantidade e %) e o tamanho da amostra.
- Para texto livre, agrupe por tema e diga quantos citaram algo parecido; cite trechos curtos só quando ajudarem.
- Nunca tente identificar quem respondeu. Fale do grupo como coletivo.
- Os dados são só as respostas que a pessoa que pergunta pode ver. Se a amostra é pequena, diga.
- Ao sugerir plano de ação: ação concreta, por quê (o número), dono sugerido e prazo.
- Markdown simples: ## títulos, "-" listas, ** negrito. Tabelas pequenas quando ajudarem.`;

const PEDIDO_ANALISE_GERAL = `Faça a análise das respostas com estas seções curtas:
## Quadro geral
(quantas respostas e a leitura em 2 ou 3 frases)
## O que está bem
## O que pede atenção
## Por pergunta
(uma linha para cada pergunta que diz algo relevante)
## Plano de ação sugerido
(3 a 5 ações priorizadas, cada uma com por quê — o número — dono e prazo)
## Perguntas que você pode fazer
(3 sugestões curtas)`;

/** Os tipos novos viram texto comparável para o agregado genérico. */
function paraAgregado(perguntas: Record<string, unknown>[], itens: Record<string, unknown> | null): Record<string, unknown> {
  const out: Record<string, unknown> = { ...(itens ?? {}) };
  for (const p of perguntas) {
    const id = String(p.id ?? "");
    const v = out[id] as Record<string, unknown> | undefined;
    if (!v || typeof v !== "object") continue;
    if (p.tipo === TIPO_LOCAL) {
      const l = v as unknown as ValorLocal;
      out[id] = l.contrato ? String(l.contrato) : "";
    } else if (p.tipo === TIPO_ESCOLHA) {
      const cfg = (p.config ?? {}) as ConfigEscolha;
      const rot = new Map((cfg.itens ?? []).map((i) => [i.cod, i.rotulo]));
      out[id] = (Array.isArray(v.marcadas) ? v.marcadas : []).map((c) => rot.get(String(c)) ?? String(c));
    }
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return respostaJson({ error: "Use POST." }, 405);

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) return respostaJson({ error: "Faça login." }, 401);
    const supa = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await supa.auth.getUser();
    if (userErr || !userData?.user) return respostaJson({ error: "Sessão inválida." }, 401);

    const { data: temCap, error: erroCap } = await supa.rpc("cs_form_cap", { _cap: "assistente_ia" });
    if (erroCap) throw erroCap;
    if (!temCap) return respostaJson({ error: "Sem acesso ao Assistente de I.A dos formulários. Peça a liberação em Administração › Acesso por Usuário." }, 403);

    const corpo = await req.json().catch(() => ({}));
    const formularioId = typeof corpo?.formulario_id === "string" ? corpo.formulario_id.trim() : "";
    if (!formularioId) return respostaJson({ error: "Informe o formulário." }, 400);
    const modo = corpo?.modo === "pergunta" ? "pergunta" : "analise";
    const pergunta = String(corpo?.pergunta ?? "").trim().slice(0, 2000);
    if (modo === "pergunta" && !pergunta) return respostaJson({ error: "Escreva a pergunta." }, 400);
    const historico: Msg[] = (Array.isArray(corpo?.historico) ? corpo.historico : [])
      .filter((m: any) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
      .slice(-10).map((m: any) => ({ role: m.role, content: String(m.content).slice(0, 4000) }));
    const f = corpo?.filtro ?? {};
    const txt = (v: unknown, max = 120) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
    const filtro: Filtro = { contrato: txt(f.contrato), posto: txt(f.posto), funcao: txt(f.funcao), de: txt(f.de, 7), ate: txt(f.ate, 7) };

    const provs = provedores();
    if (!provs.length) return respostaJson({ error: "A chave da IA não está configurada. Avise o time de Sistemas." }, 500);

    const { data: form, error: erroForm } = await supa.from("CS_FORMULARIOS")
      .select("id, titulo, perguntas").eq("id", formularioId).maybeSingle();
    if (erroForm) throw erroForm;
    if (!form) return respostaJson({ error: "Formulário não encontrado ou sem acesso." }, 404);
    const perguntas = (Array.isArray(form.perguntas) ? form.perguntas : []) as Record<string, unknown>[];

    // Com o login de quem pediu: a RLS do Formulários escolhe as respostas.
    const respostas: { enviado_em: string; setor: string | null; itens: Record<string, unknown> | null; respondente_nome: string | null }[] = [];
    const PAGINA = 1000;
    for (let ini = 0; ini < 20000; ini += PAGINA) {
      const { data, error } = await supa.from("CS_FORM_RESPOSTAS")
        .select("id, enviado_em, setor, itens, respondente_nome")
        .eq("formulario_id", formularioId).order("id", { ascending: true }).range(ini, ini + PAGINA - 1);
      if (error) throw error;
      respostas.push(...(data ?? []));
      if ((data ?? []).length < PAGINA) break;
    }
    if (!respostas.length) return respostaJson({ error: "Este formulário não tem respostas que você possa ver." }, 422);

    let system: string;
    let contexto: string;
    let pedidoAnalise: string;
    if (ehFormularioPermanencia(perguntas as any)) {
      const linhas = linhasDoFormulario(perguntas as any, respostas.map((r) => ({ formulario_id: form.id, enviado_em: r.enviado_em, itens: r.itens })));
      // Rotatividade é bônus (e capacidade à parte): sem ela, só a pesquisa.
      let tv: LinhaTurnover[] = [];
      let meses: string[] = [];
      const turn = await supa.rpc("cs_form_rotatividade", { p_meses: 12 });
      if (turn.error) console.error("cs_form_rotatividade", turn.error.message);
      else { tv = ((turn.data as any)?.linhas ?? []) as LinhaTurnover[]; meses = ((turn.data as any)?.meses ?? []) as string[]; }
      system = SYSTEM_PERMANENCIA;
      pedidoAnalise = PEDIDO_ANALISE_PERMANENCIA;
      contexto = `DADOS (agregados da pesquisa e da rotatividade):\n${JSON.stringify(contextoIA(linhas, tv, meses, filtro)).slice(0, 60000)}`;
    } else {
      const pergs: PerguntaDiagnostico[] = perguntas.map((p) => ({
        id: String(p.id ?? ""),
        // Os tipos novos entram como fechados (o valor vira o rótulo da opção).
        tipo: p.tipo === TIPO_ESCOLHA ? "caixas_selecao" : p.tipo === TIPO_LOCAL ? "lista_suspensa" : String(p.tipo ?? ""),
        titulo: String(p.titulo ?? ""),
        opcoes: Array.isArray(p.opcoes) ? (p.opcoes as unknown[]).map(String) : [],
        config: p.config && typeof p.config === "object" ? p.config as Record<string, unknown> : {},
      }));
      const resps: RespostaDiagnostico[] = respostas.map((r) => ({ setor: r.setor, itens: paraAgregado(perguntas, r.itens), respondente_nome: r.respondente_nome } as RespostaDiagnostico));
      const dicionario = montarDicionarioNomes(pergs, resps);
      const agregado = agregarFormulario(String(form.titulo ?? ""), "", pergs, resps.map((r) => ({ setor: r.setor, itens: r.itens } as RespostaDiagnostico)), dicionario);
      system = SYSTEM_GERAL;
      pedidoAnalise = PEDIDO_ANALISE_GERAL;
      contexto = `DADOS (agregado das respostas visíveis do formulário "${form.titulo}"):\n${JSON.stringify(agregado).slice(0, 60000)}`;
    }

    const mensagens: Msg[] = modo === "analise"
      ? [{ role: "user", content: pedidoAnalise }]
      : [...historico, { role: "user", content: pergunta }];

    const res = await chamarIA(provs, [
      { role: "system", content: `${system}\n\nHOJE: ${new Date().toISOString().slice(0, 10)}\n${contexto}` },
      ...mensagens,
    ]);
    if (!res.texto) return respostaJson({ error: res.erro }, res.status ?? 502);
    return respostaJson({ texto: res.texto });
  } catch (e) {
    console.error(e);
    return respostaJson({ error: e instanceof Error ? e.message : "Não foi possível responder agora." }, 500);
  }
});
