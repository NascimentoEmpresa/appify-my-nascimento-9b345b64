// Diretoria e Presidência › Relatórios — análise com I.A (mig 20261005000006).
//
// Pedido (05/10/2026): "nesse Relatório Geral vai ter gráfico pra tudo, e vai
// ter I.A integrada pra gerar análises". Duas formas:
//   · modo "analise": a IA lê o relatório e escreve a análise (destaques,
//     alertas, recomendações);
//   · modo "pergunta": responde uma pergunta livre sobre o relatório, com
//     o histórico da conversa.
//
// Os NÚMEROS não vêm do cliente: a função chama a mesma RPC da tela
// (dir_rel_geral ou dir_rel_<sistema>) com o JWT de quem pediu — então a IA
// só enxerga o que essa pessoa enxerga, e ninguém "planta" dado na análise.
// Quem pode: capacidade diretoria_relatorios_ia (dir_rel_pode_ia) + acesso
// ao relatório pedido (cobrado pela própria RPC).
//
// Provedor: o mesmo de bi-ia / painel-formularios-chat — Gemini
// (GEMINI_API_KEY) primeiro; sem ela, Groq (GROQ_API_KEY). Modelo por
// variável de ambiente (IA_DIRETORIA_MODELO), porque nome de modelo muda.
//
// 07/10/2026: o Gemini respondeu 503 (sobrecarregado) e a tela mostrava
// "Falha ao chamar a IA (HTTP 503)". Agora: erro passageiro (5xx) tenta o
// mesmo provedor mais uma vez; persistindo — ou acabando os tokens (429) ou
// a chave sendo recusada — passa para o próximo provedor configurado (Groq).
// IA_DIRETORIA_MODELO só vale para o Gemini; o Groq usa GROQ_MODEL ou o
// padrão, senão um nome de modelo do Gemini iria parar no Groq.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const respostaJson = (corpo: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const ERRO_SEM_TOKENS = "Acabou os tokens da IA, é necessário aguardar a IA renovar os tokens.";

// Sistema → RPC. "geral" = todos.
const RPC: Record<string, string> = {
  geral: "dir_rel_geral",
  recrutamento: "dir_rel_recrutamento",
  demissoes: "dir_rel_demissoes",
  materiais: "dir_rel_materiais",
  ferias: "dir_rel_ferias",
  "medida-disciplinar": "dir_rel_medida_disciplinar",
  chamados: "dir_rel_chamados",
  orientacoes: "dir_rel_orientacoes",
  "mudanca-funcao": "dir_rel_mudanca_funcao",
  colaboradores: "dir_rel_colaboradores",
  turnover: "dir_rel_turnover",
};

type Msg = { role: "user" | "assistant"; content: string };

type Provedor = { nome: string; url: string; chave: string; modelo: string };

function provedores(): Provedor[] {
  const lista: Provedor[] = [];
  const gemini = Deno.env.get("GEMINI_API_KEY");
  if (gemini) {
    lista.push({ nome: "gemini", url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", chave: gemini,
                 modelo: Deno.env.get("IA_DIRETORIA_MODELO") ?? Deno.env.get("IA_CHAT_MODELO") ?? "gemini-3.6-flash" });
  }
  const groq = Deno.env.get("GROQ_API_KEY");
  if (groq) {
    lista.push({ nome: "groq", url: "https://api.groq.com/openai/v1/chat/completions", chave: groq,
                 modelo: Deno.env.get("GROQ_MODEL") ?? "openai/gpt-oss-120b" });
  }
  return lista;
}

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Chama os provedores em ordem. Devolve o texto ou o erro para a tela (o do
 * ÚLTIMO provedor tentado — se até o Groq falhou, é o que vale contar).
 */
async function chamarIA(provs: Provedor[], messages: { role: string; content: string }[]): Promise<{ texto?: string; erro?: string; status?: number }> {
  let ultimo: { erro: string; status: number } = { erro: "Não foi possível gerar a análise agora.", status: 502 };
  for (const prov of provs) {
    for (let tentativa = 1; tentativa <= 2; tentativa++) {
      const r = await fetch(prov.url, {
        method: "POST",
        headers: { Authorization: `Bearer ${prov.chave}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: prov.modelo, temperature: 0.3, messages }),
      }).catch((e) => { console.error("IA rede", prov.nome, e); return null; });
      if (r && r.ok) {
        const dados = await r.json().catch(() => null);
        if (/quota|rate limit|resource_exhausted/i.test(String(dados?.error?.message ?? ""))) {
          ultimo = { erro: ERRO_SEM_TOKENS, status: 429 };
          break;                                   // sem tokens: próximo provedor
        }
        const texto = String(dados?.choices?.[0]?.message?.content ?? "").trim();
        if (texto) return { texto };
        ultimo = { erro: "A IA devolveu resposta vazia. Tente de novo.", status: 502 };
        break;
      }
      const status = r?.status ?? 0;
      console.error("IA erro", prov.nome, prov.modelo, status, r ? (await r.text()).slice(0, 300) : "sem resposta");
      if (status === 413) return { erro: "O relatório ficou grande demais para a IA — diminua o período.", status: 413 };
      if (status === 429 || status === 402) { ultimo = { erro: ERRO_SEM_TOKENS, status: 429 }; break; }
      if (status === 401 || status === 403) { ultimo = { erro: "A chave da IA foi recusada. Avise o time de Sistemas.", status: 502 }; break; }
      ultimo = { erro: `Falha ao chamar a IA (HTTP ${status || "sem resposta"}).`, status: 502 };
      if (!(status === 0 || status >= 500) || tentativa === 2) break;   // 4xx não melhora repetindo
      await esperar(1200);                         // 5xx/rede: mais uma vez no mesmo provedor
    }
  }
  return ultimo;
}

/** Enxuga o relatório para o prompt: tira a tabela de recentes (nomes de pessoas, e não ajuda a análise). */
function compactar(rel: any): any {
  if (!rel || typeof rel !== "object") return rel;
  if (rel.kpis) {
    const { recentes, ...resto } = rel;
    return resto;
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(rel)) out[k] = compactar(v);
  return out;
}

const SYSTEM = `Você é o analista sênior da DIRETORIA E PRESIDÊNCIA do Grupo Nascimento (empresa de terceirização: limpeza, portaria, recepção, administrativo etc., com centenas de contratos públicos).
Você recebe o relatório (JSON) dos sistemas de solicitação do ERP: KPIs, série mensal, distribuição por status e rankings (contrato, cargo, motivo…).

Regras:
- Responda em português do Brasil, direto, para diretor: frases curtas, sem jargão técnico, sem falar de JSON/SQL.
- Use SÓ os números do relatório. Não invente dado, nome, meta nem causa. Se algo não dá para afirmar, diga que o dado não mostra.
- Cite números concretos (ex.: "73 vagas em andamento, 6% do total").
- "Variação" nos KPIs é % contra o período anterior de mesmo tamanho.
- Turn-over = ((admitidos + desligados) ÷ 2) ÷ quadro do início do mês; "desligados em até 90 dias" = contratação que não firmou.
- Formato em Markdown simples: títulos com ##, listas com "-", negrito com **.`;

const PEDIDO_ANALISE = `Escreva a análise deste relatório com estas seções:
## Resumo executivo
(3 a 5 linhas com o quadro geral)
## Destaques positivos
## Pontos de atenção
(o que está ruim, acumulado, demorado ou crescendo — com o número)
## Recomendações
(3 a 6 ações práticas e específicas para a diretoria, ligadas aos números)`;

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

    const { data: pode } = await supa.rpc("dir_rel_pode_ia");
    if (!pode) return respostaJson({ error: "Você não tem a liberação de \"Relatórios — Análise com I.A\". Peça em Acesso por Usuário." }, 403);

    const corpo = await req.json().catch(() => ({}));
    const sistema = String(corpo?.sistema ?? "geral");
    const rpc = RPC[sistema];
    if (!rpc) return respostaJson({ error: "Relatório desconhecido." }, 400);
    const modo = corpo?.modo === "pergunta" ? "pergunta" : "analise";
    const pergunta = String(corpo?.pergunta ?? "").trim().slice(0, 2000);
    if (modo === "pergunta" && !pergunta) return respostaJson({ error: "Escreva a pergunta." }, 400);
    const data = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
    const historico: Msg[] = (Array.isArray(corpo?.historico) ? corpo.historico : [])
      .filter((m: any) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
      .slice(-8).map((m: any) => ({ role: m.role, content: String(m.content).slice(0, 4000) }));

    const provs = provedores();
    if (!provs.length) return respostaJson({ error: "A chave da IA não está configurada. Avise o time de Sistemas." }, 500);

    const { data: rel, error: relErr } = await supa.rpc(rpc, { _de: data(corpo?.de), _ate: data(corpo?.ate) });
    if (relErr) return respostaJson({ error: relErr.message }, relErr.code === "42501" ? 403 : 500);

    const contexto = `RELATÓRIO (${sistema === "geral" ? "Relatório Geral — todos os sistemas" : sistema}), hoje é ${new Date().toISOString().slice(0, 10)}:\n` +
      JSON.stringify(compactar(rel));

    const mensagens: Msg[] = modo === "analise"
      ? [{ role: "user", content: PEDIDO_ANALISE }]
      : [...historico, { role: "user", content: pergunta }];

    const res = await chamarIA(provs, [{ role: "system", content: SYSTEM + "\n\n" + contexto }, ...mensagens]);
    if (!res.texto) return respostaJson({ error: res.erro }, res.status ?? 502);
    return respostaJson({ texto: res.texto });
  } catch (e) {
    console.error(e);
    return respostaJson({ error: e instanceof Error ? e.message : "Não foi possível gerar a análise agora." }, 500);
  }
});
