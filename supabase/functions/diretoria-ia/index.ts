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

function provedor() {
  const gemini = Deno.env.get("GEMINI_API_KEY");
  if (gemini) {
    return { url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", chave: gemini,
             modelo: Deno.env.get("IA_DIRETORIA_MODELO") ?? Deno.env.get("IA_CHAT_MODELO") ?? "gemini-3.6-flash" };
  }
  const groq = Deno.env.get("GROQ_API_KEY");
  if (groq) {
    return { url: "https://api.groq.com/openai/v1/chat/completions", chave: groq,
             modelo: Deno.env.get("IA_DIRETORIA_MODELO") ?? Deno.env.get("GROQ_MODEL") ?? "openai/gpt-oss-120b" };
  }
  return null;
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

    const prov = provedor();
    if (!prov) return respostaJson({ error: "A chave da IA não está configurada. Avise o time de Sistemas." }, 500);

    const { data: rel, error: relErr } = await supa.rpc(rpc, { _de: data(corpo?.de), _ate: data(corpo?.ate) });
    if (relErr) return respostaJson({ error: relErr.message }, relErr.code === "42501" ? 403 : 500);

    const contexto = `RELATÓRIO (${sistema === "geral" ? "Relatório Geral — todos os sistemas" : sistema}), hoje é ${new Date().toISOString().slice(0, 10)}:\n` +
      JSON.stringify(compactar(rel));

    const mensagens: Msg[] = modo === "analise"
      ? [{ role: "user", content: PEDIDO_ANALISE }]
      : [...historico, { role: "user", content: pergunta }];

    const r = await fetch(prov.url, {
      method: "POST",
      headers: { Authorization: `Bearer ${prov.chave}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: prov.modelo, temperature: 0.3,
        messages: [{ role: "system", content: SYSTEM + "\n\n" + contexto }, ...mensagens],
      }),
    });
    if (!r.ok) {
      const txt = await r.text();
      console.error("IA erro", r.status, txt.slice(0, 300));
      if (r.status === 429 || r.status === 402) return respostaJson({ error: ERRO_SEM_TOKENS }, 429);
      if (r.status === 401 || r.status === 403) return respostaJson({ error: "A chave da IA foi recusada. Avise o time de Sistemas." }, 502);
      if (r.status === 413) return respostaJson({ error: "O relatório ficou grande demais para a IA — diminua o período." }, 413);
      return respostaJson({ error: `Falha ao chamar a IA (HTTP ${r.status}).` }, 502);
    }
    const dados = await r.json();
    if (/quota|rate limit|resource_exhausted/i.test(String(dados?.error?.message ?? ""))) return respostaJson({ error: ERRO_SEM_TOKENS }, 429);
    const texto = String(dados?.choices?.[0]?.message?.content ?? "").trim();
    if (!texto) return respostaJson({ error: "A IA devolveu resposta vazia. Tente de novo." }, 502);
    return respostaJson({ texto });
  } catch (e) {
    console.error(e);
    return respostaJson({ error: e instanceof Error ? e.message : "Não foi possível gerar a análise agora." }, 500);
  }
});
