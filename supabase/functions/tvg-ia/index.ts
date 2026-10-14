// TV's › Indicadores gerenciais — "de onde vem este número?" com I.A
// (14/10/2026, mig 20261014000014).
//
// Pedido do Pablo, na prévia "Ver como na TV": "preciso que ao clicar com o
// mouse em cima de cada um uma I.A diga da onde vem cada informação, e
// consiga perguntar mais coisas". Dois modos:
//   · "origem": explica o indicador clicado — de que tela/tabela do ERP sai o
//     número, como é a conta, o que significam "onde", "causa" e o gráfico;
//   · "pergunta": conversa livre sobre o indicador, com o histórico.
//
// Nada vem do cliente além do CÓDIGO: o resultado (tvg_indicador) e o SQL que
// o calcula (tvg_fonte, recortado da tvg_calc em produção) são lidos com o
// JWT de quem pediu — o mesmo portão da tela (tvs_gerenciais/sistemas_tvs).
// Nos indicadores do DRE vai junto o DETALHE (tvg_ia_detalhe, mig
// 20261014000023): o custo de cada contrato do gráfico aberto por conta, mês a
// mês. Sem ele a I.A só via o total e respondia "consulte a Controladoria" à
// pergunta "o que provocou a alta?" (Pablo, 14/10/2026) — a resposta estava
// nos lançamentos. Na mig 20261014000024 o DETALHE passou a valer para todos
// os indicadores calculados: os registros por trás do número (notificações,
// vagas, pedidos, NFs, processos, chamados, folha por situação/cargo…), sem
// nome de pessoa. Indicador sem detalhe segue só com resultado + fonte.
//
// Provedor: o mesmo de diretoria-ia — Gemini (GEMINI_API_KEY) primeiro; erro
// passageiro tenta de novo; sem tokens ou chave recusada, passa ao Groq
// (GROQ_API_KEY). Modelo por variável (IA_TVG_MODELO só para o Gemini).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

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
                 modelo: Deno.env.get("IA_TVG_MODELO") ?? Deno.env.get("IA_CHAT_MODELO") ?? "gemini-3.6-flash" });
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

const SYSTEM = `Você é o assistente das TVs gerenciais do ERP do Grupo Nascimento (empresa de terceirização: limpeza, portaria, motoristas, apoio administrativo, com contratos públicos).
Você explica UM indicador que aparece na TV para um gestor (não técnico).

Você recebe:
- o RESULTADO atual do indicador (valor, meta, "onde"/afetado, causa, detalhe por contrato que vira o gráfico, base);
- a FONTE: a regra escrita e o SQL real que calcula o número no banco, mais as funções de apoio que ele usa;
- quase sempre o DETALHE: os registros por trás do número, com o mesmo filtro do cálculo (ex.: lançamentos do DRE por conta e competência; colaboradores por situação e cargo; notificações, vagas, pedidos, NFs, processos, chamados). "observacao" diz o que é cada campo; listas longas vêm cortadas nos primeiros registros e "total_registros" diz quantos existem.

Como traduzir o SQL em tela do ERP (use estes nomes, não o nome da tabela, mas cite a tabela entre parênteses uma vez):
- EMPREGADOS / espelho."Bi…" = folha da Senior (cadastro de colaboradores, situação, salário, ponto) sincronizada todo dia;
- contratos / CONTRATOS = cadastro de contratos (quadro estipulado, valor mensal);
- SISTEMA_RECRUTAMENTO = vagas da Gestão Recrutamento; WA_CURRICULOS = candidatos do kanban; RECRUTAMENTO_HISTORICO = histórico da vaga;
- SISTEMA_SOLICITACOES_DEMISSAO = solicitações de demissão; JUR_NOTIFICACOES = Jurídico › Notificações (glosas, multas, notificações do cliente); JUR_PROCESSOS = Jurídico › Processos;
- grade / capa_edital = Licitações (grade de licitações e capa do edital); implantacao_contrato = implantação de contrato;
- sup_pedido = pedidos de materiais (Supply); sup_estoque_* = estoque; sup_patrimonio(_arquivo/_log) = Patrimônio/Frota; cs_veiculo_agendamento = agendamento de veículos;
- nf_emissao = Faturamento (NFs emitidas); malote_despesa = Malote (despesas a pagar);
- mz_60_view_dre_gerencial_competencia / tvg_dre_mv = DRE gerencial por contrato (carga da migração contábil);
- TRN_* = plataforma de Treinamentos (alunos, matrículas, certificados); plano_acao = Plano de Ações; CHAMADO_SISTEMA = Chamados de Sistemas; fila_http = integrações; TV_DISPOSITIVO = TVs.

Regras:
- Português do Brasil, direto, frases curtas. Nada de mostrar SQL (a não ser que perguntem explicitamente).
- Use só o que está nos dados recebidos. Não invente número, tabela, nome ou causa. Se o dado não mostra, diga isso.
- Quando houver DETALHE, responda "por quê", "qual", "onde" e "quanto" com ele: cite os registros (contrato, número do documento/vaga/NF/processo/chamado, datas, valores, status) e agrupe para mostrar onde se concentra. Não mande o gestor procurar outro módulo ou área se a resposta está no DETALHE — só diga que o dado não existe quando ele de fato não aparece ali (e, se a lista veio cortada, diga que mostra os primeiros de "total_registros").
- No DRE: compare conta por conta a competência atual com a média das anteriores e diga quais contas explicam a diferença, em R$, da maior para a menor.
- Conta que aparece só na competência atual (ex. "Salários operacionais" sem nenhum lançamento nos meses anteriores) quase sempre é lançamento que faltou antes, contrato que começou agora ou carga incompleta — não um aumento real. Aponte isso com clareza, porque infla o percentual. Note também quando a média usa menos de 3 meses (contrato novo).
- O parâmetro do indicador (janela de dias, limite %) vem em "parametro" (null = o padrão escrito no SQL com coalesce).
- Nomes de pessoas não aparecem nos dados — se perguntarem "quem", explique que a TV é área comum e mostra contrato/setor.
- Markdown simples: ## para títulos, "-" para listas, ** para negrito.`;

const PEDIDO_ORIGEM = `Explique este indicador para o gestor, com estas seções curtas:
## De onde vem o número
(qual tela/cadastro do ERP alimenta, e a conta feita — em palavras)
## O que está na tela agora
(o valor, a meta e o semáforo; o que "Onde", "Causa" e o gráfico estão mostrando, com os números)
## Cuidados ao ler
(1 a 3 pontos: janela de tempo, o que entra e o que fica de fora, atualização)
## Perguntas que você pode fazer
(3 sugestões curtas de perguntas úteis sobre este indicador)`;

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
    const codigo = String(corpo?.codigo ?? "");
    if (!/^[a-z0-9_]{2,60}$/.test(codigo)) return respostaJson({ error: "Indicador inválido." }, 400);
    const modo = corpo?.modo === "pergunta" ? "pergunta" : "origem";
    const pergunta = String(corpo?.pergunta ?? "").trim().slice(0, 2000);
    if (modo === "pergunta" && !pergunta) return respostaJson({ error: "Escreva a pergunta." }, 400);
    const historico: Msg[] = (Array.isArray(corpo?.historico) ? corpo.historico : [])
      .filter((m: any) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
      .slice(-10).map((m: any) => ({ role: m.role, content: String(m.content).slice(0, 4000) }));

    const provs = provedores();
    if (!provs.length) return respostaJson({ error: "A chave da IA não está configurada. Avise o time de Sistemas." }, 500);

    // Com o login de quem pediu: o mesmo portão da tela.
    const [ind, fonte, detalhe] = await Promise.all([
      supa.rpc("tvg_indicador", { p_codigo: codigo }),
      supa.rpc("tvg_fonte", { p_codigo: codigo }),
      supa.rpc("tvg_ia_detalhe", { p_codigo: codigo }),
    ]);
    if (ind.error) return respostaJson({ error: ind.error.message }, ind.error.code === "42501" ? 403 : 500);
    if (fonte.error) return respostaJson({ error: fonte.error.message }, fonte.error.code === "42501" ? 403 : 500);
    if (!ind.data) return respostaJson({ error: "Indicador não encontrado ou desativado." }, 404);
    // Detalhe é bônus: se falhar, explica só com o total, como antes.
    if (detalhe.error) console.error("tvg_ia_detalhe", detalhe.error.message);

    const contexto = `HOJE: ${new Date().toISOString().slice(0, 10)}\n` +
      `RESULTADO (o que a TV mostra):\n${JSON.stringify(ind.data).slice(0, 9000)}\n\n` +
      `FONTE (regra e cálculo no banco):\n${JSON.stringify(fonte.data).slice(0, 14000)}` +
      (detalhe.data ? `\n\nDETALHE (registros por trás do número):\n${JSON.stringify(detalhe.data).slice(0, 32000)}` : "");

    const mensagens: Msg[] = modo === "origem"
      ? [{ role: "user", content: PEDIDO_ORIGEM }]
      : [...historico, { role: "user", content: pergunta }];

    const res = await chamarIA(provs, [{ role: "system", content: SYSTEM + "\n\n" + contexto }, ...mensagens]);
    if (!res.texto) return respostaJson({ error: res.erro }, res.status ?? 502);
    return respostaJson({ texto: res.texto });
  } catch (e) {
    console.error(e);
    return respostaJson({ error: e instanceof Error ? e.message : "Não foi possível responder agora." }, 500);
  }
});
