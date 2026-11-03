// RH › Pesquisa de Permanência — agente de I.A sobre rotatividade
// (mig 20261028001200).
//
// Pedido do Pablo no chamado: "preciso que desenvolva completo esse chamado.
// mesmo que precise de um agente de i.a respondendo sobre". O gestor pergunta
// ("por que o contrato X perde tanta gente?") e a I.A responde com os números
// da pesquisa e da rotatividade do mesmo contrato/posto/função. Dois modos:
//   · "analise": resumo gerencial pronto + sugestões de plano de ação;
//   · "pergunta": conversa livre, com o histórico.
//
// Nada vem do cliente além da pergunta e do filtro (contrato/posto/função/
// aplicação): respostas (pp_respostas) e rotatividade (pp_turnover) são lidas
// com o JWT de quem pediu — o mesmo portão da tela (rh_pesquisa_permanencia,
// visualizar). Para a I.A vai SÓ o agregado de contextoIA() do _shared: a
// pesquisa não coleta nome, grupo com menos de 3 respostas não é detalhado e
// texto livre só vai quando repetido.
//
// Provedor: o mesmo de tvg-ia/diretoria-ia — Gemini (GEMINI_API_KEY)
// primeiro; erro passageiro tenta de novo; sem tokens ou chave recusada, passa
// ao Groq (GROQ_API_KEY, modelo openai/gpt-oss-120b). Chaves nos secrets da
// Edge Function, nunca em arquivo.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { contextoIA, type Filtro, type LinhaResposta, type LinhaTurnover } from "../_shared/pesquisa-permanencia.ts";

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

const SYSTEM = `Você é o analista de rotatividade do RH do Grupo Nascimento (empresa de terceirização: limpeza, portaria, recepção, motoristas, apoio administrativo, em contratos com órgãos públicos — universidades, prefeituras).
Você responde a gestores (não técnicos) sobre a PESQUISA DE PERMANÊNCIA e a ROTATIVIDADE (turnover) por contrato, posto de trabalho e função.

Você recebe um JSON só com AGREGADOS:
- indicadores gerais e as 8 perguntas com quantidades e % (nas perguntas 1, 2 e 8 cada pessoa marca até 3 e indica a MAIS importante — "marcaram" soma mais que 100%; "mais_importante" soma 100%);
- resumo gerencial separando problemas da EMPRESA (liderança/encarregado, salário, sobrecarga, colegas, concorrência), dos FISCAIS do órgão e da ESTRUTURA do órgão público;
- pontos de atenção (grupos acima do geral);
- por contrato / função / posto: respostas, satisfação, insatisfação, motivo de saída mais importante, prioridade mais pedida e o TURNOVER do mesmo recorte (turnover mensal médio %, demissões no período, efetivo médio);
- contratos com rotatividade e pouca ou nenhuma resposta.
"satisfacao_pct"/"insatisfacao_pct" = % das avaliações das perguntas 3 a 7 que foram positivas/negativas. "recomendacao_pts" = % "Sim, com certeza" − % "Não indicaria".
Grupo com menos de "minimo_por_grupo" respostas não aparece detalhado (anonimato) — se perguntarem dele, diga isso.

Regras:
- Português do Brasil, direto, frases curtas.
- Use só o que está nos dados. Não invente número, contrato, causa ou nome. Cite os números (quantidade e %) ao afirmar algo, e o tamanho da amostra.
- Para "por que o contrato X perde gente": junte o turnover dele com o que as pessoas de lá responderam (motivo de saída mais importante, avaliação do encarregado, fiscais, condições do órgão, se indicariam) e compare com o geral. Diga quando a amostra é pequena ou quando o contrato não tem respostas suficientes.
- Separe sempre o que é da empresa (dá para agir direto), o que é dos fiscais (tratar com o gestor do contrato no órgão) e o que é da estrutura do órgão (negociar com o cliente).
- Ao sugerir plano de ação: ação concreta, onde (contrato/posto/função), por quê (o número), quem costuma ser o dono (RH, Operação/supervisão, Gestão do contrato) e um prazo sugerido.
- A pesquisa é anônima: nunca tente identificar quem respondeu. Nomes de pessoas não existem nos dados.
- Markdown simples: ## títulos, "-" listas, ** negrito. Tabelas pequenas quando ajudarem.`;

const PEDIDO_ANALISE = `Faça o resumo gerencial da pesquisa com estas seções curtas:
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

    const corpo = await req.json().catch(() => ({}));
    const modo = corpo?.modo === "pergunta" ? "pergunta" : "analise";
    const pergunta = String(corpo?.pergunta ?? "").trim().slice(0, 2000);
    if (modo === "pergunta" && !pergunta) return respostaJson({ error: "Escreva a pergunta." }, 400);
    const historico: Msg[] = (Array.isArray(corpo?.historico) ? corpo.historico : [])
      .filter((m: any) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
      .slice(-10).map((m: any) => ({ role: m.role, content: String(m.content).slice(0, 4000) }));
    const f = corpo?.filtro ?? {};
    const txt = (v: unknown, max = 120) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
    const filtro: Filtro = { contrato: txt(f.contrato), posto: txt(f.posto), funcao: txt(f.funcao), aplicacao: txt(f.aplicacao, 40), de: txt(f.de, 7), ate: txt(f.ate, 7) };

    const provs = provedores();
    if (!provs.length) return respostaJson({ error: "A chave da IA não está configurada. Avise o time de Sistemas." }, 500);

    // Com o login de quem pediu: o mesmo portão da tela.
    const [resp, turn] = await Promise.all([
      supa.rpc("pp_respostas", { p_aplicacao: null }),
      supa.rpc("pp_turnover", { p_meses: 12 }),
    ]);
    if (resp.error) return respostaJson({ error: resp.error.message }, resp.error.code === "42501" ? 403 : 500);
    // Rotatividade é bônus: se falhar, responde só com a pesquisa.
    if (turn.error) console.error("pp_turnover", turn.error.message);
    const linhas = (resp.data ?? []) as LinhaResposta[];
    const tv = ((turn.data as any)?.linhas ?? []) as LinhaTurnover[];
    const meses = ((turn.data as any)?.meses ?? []) as string[];

    const contexto = `HOJE: ${new Date().toISOString().slice(0, 10)}\n` +
      `DADOS (agregados da pesquisa e da rotatividade):\n${JSON.stringify(contextoIA(linhas, tv, meses, filtro)).slice(0, 60000)}`;

    const mensagens: Msg[] = modo === "analise"
      ? [{ role: "user", content: PEDIDO_ANALISE }]
      : [...historico, { role: "user", content: pergunta }];

    const res = await chamarIA(provs, [{ role: "system", content: SYSTEM + "\n\n" + contexto }, ...mensagens]);
    if (!res.texto) return respostaJson({ error: res.erro }, res.status ?? 502);
    return respostaJson({ texto: res.texto });
  } catch (e) {
    console.error(e);
    return respostaJson({ error: e instanceof Error ? e.message : "Não foi possível responder agora." }, 500);
  }
});
