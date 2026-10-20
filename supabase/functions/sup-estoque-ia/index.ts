// Suprimentos › Dashboard › Estoque Saudável — a leitura com I.A
// (migrations 20261020000020/21/22).
//
// Pedido do gerente de Supply por áudio (19/10/2026, sem chamado): "uma IA que
// identifique a rotatividade dos produtos e me diga qual é o estoque saudável
// que eu tenho que ter de cada coisa", "o que eu preciso eliminar do estoque",
// "o que a gente tem de dinheiro parado", "mês a mês a IA ia analisando e
// dizendo a hora de diminuir".
//
// O QUE ESTA FUNÇÃO FAZ — E O QUE ELA NÃO FAZ
//
// Ela NÃO calcula quantidade. Alvo, ponto de pedido, estoque de segurança e
// compra sugerida saem da RPC sup_estoque_saudavel, no banco, por fórmula de
// reposição — determinística e igual toda vez. Esta função LÊ esse resultado e
// escreve a interpretação: o que priorizar, o que liquidar, o que mudou desde
// o último fechamento, onde o número merece desconfiança.
//
// A separação é o que permite o gerente usar o número numa negociação: se a IA
// "arredondasse" quantidade, o pedido ao fornecedor viraria palpite de modelo
// de linguagem, irreprodutível e indefensável. O prompt abaixo proíbe isso
// explicitamente, e é por isso que o texto da tela sempre diz de onde o número
// veio.
//
// OS NÚMEROS NÃO VÊM DO CLIENTE: a função chama a RPC com o JWT de quem pediu,
// então a IA só enxerga o que essa pessoa enxerga, e ninguém planta dado na
// análise mandando um corpo de requisição fabricado.
//
// Provedor: o mesmo de diretoria-ia / tvg-ia — Gemini (GEMINI_API_KEY)
// primeiro; erro passageiro tenta de novo, erro persistente/sem tokens passa
// para o Groq (GROQ_API_KEY). Modelo por variável (IA_ESTOQUE_MODELO só vale
// para o Gemini; o Groq usa GROQ_MODEL).
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
    lista.push({
      nome: "gemini",
      url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
      chave: gemini,
      modelo: Deno.env.get("IA_ESTOQUE_MODELO") ?? Deno.env.get("IA_CHAT_MODELO") ?? "gemini-3.6-flash",
    });
  }
  const groq = Deno.env.get("GROQ_API_KEY");
  if (groq) {
    lista.push({
      nome: "groq",
      url: "https://api.groq.com/openai/v1/chat/completions",
      chave: groq,
      modelo: Deno.env.get("GROQ_MODEL") ?? "openai/gpt-oss-120b",
    });
  }
  return lista;
}

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function chamarIA(
  provs: Provedor[],
  messages: { role: string; content: string }[],
): Promise<{ texto?: string; erro?: string; status?: number }> {
  let ultimo: { erro: string; status: number } = { erro: "Não foi possível gerar a análise agora.", status: 502 };
  for (const prov of provs) {
    for (let tentativa = 1; tentativa <= 2; tentativa++) {
      const r = await fetch(prov.url, {
        method: "POST",
        headers: { Authorization: `Bearer ${prov.chave}`, "Content-Type": "application/json" },
        // Temperatura baixa: é leitura de número, não redação criativa.
        body: JSON.stringify({ model: prov.modelo, temperature: 0.2, messages }),
      }).catch((e) => { console.error("IA rede", prov.nome, e); return null; });
      if (r && r.ok) {
        const dados = await r.json().catch(() => null);
        if (/quota|rate limit|resource_exhausted/i.test(String(dados?.error?.message ?? ""))) {
          ultimo = { erro: ERRO_SEM_TOKENS, status: 429 };
          break;
        }
        const texto = String(dados?.choices?.[0]?.message?.content ?? "").trim();
        if (texto) return { texto };
        ultimo = { erro: "A IA devolveu resposta vazia. Tente de novo.", status: 502 };
        break;
      }
      const status = r?.status ?? 0;
      console.error("IA erro", prov.nome, prov.modelo, status, r ? (await r.text()).slice(0, 300) : "sem resposta");
      if (status === 413) return { erro: "O painel ficou grande demais para a IA — filtre por categoria.", status: 413 };
      if (status === 429 || status === 402) { ultimo = { erro: ERRO_SEM_TOKENS, status: 429 }; break; }
      if (status === 401 || status === 403) { ultimo = { erro: "A chave da IA foi recusada. Avise o time de Sistemas.", status: 502 }; break; }
      ultimo = { erro: `Falha ao chamar a IA (HTTP ${status || "sem resposta"}).`, status: 502 };
      if (!(status === 0 || status >= 500) || tentativa === 2) break;
      await esperar(1200);
    }
  }
  return ultimo;
}

/**
 * Enxuga o payload para o prompt.
 *
 * O catálogo tem centenas de combinações item+tamanho e o payload inteiro
 * estoura o limite do modelo (e já custou um HTTP 413 em diretoria-ia). O
 * corte não é aleatório: ficam as linhas que mudam decisão — o que falta, o
 * que repor, o que está morto, o que tem mais dinheiro parado — e some o
 * meio da tabela, que é item saudável sobre o qual não há nada a dizer.
 *
 * Os TOTAIS vão inteiros, sempre. É deles que a IA tira "R$ 48 mil parados",
 * e eles são calculados sobre o catálogo todo, não sobre a amostra — então o
 * texto continua certo mesmo com a lista cortada. O prompt avisa que a lista
 * é uma amostra, para a IA não concluir "só 40 itens têm problema".
 */
function compactar(painel: Record<string, unknown>): Record<string, unknown> {
  const itens = Array.isArray(painel?.itens) ? (painel.itens as Record<string, unknown>[]) : [];
  const porSituacao = (s: string, n: number) =>
    itens.filter((i) => i.situacao === s).slice(0, n);

  // Só as colunas que a análise usa. Cada campo a menos é espaço para uma
  // linha a mais.
  const enxuto = (i: Record<string, unknown>) => ({
    item: i.item,
    tam: i.tamanho,
    disp: i.disponivel,
    transito: i.em_transito,
    dem_mes: i.demanda_mensal,
    cob_dias: i.cobertura_dias,
    alvo: i.alvo,
    comprar: i.comprar,
    excesso: i.excesso,
    meses_sem_giro: i.meses_sem_giro,
    valor_parado: i.valor_excesso,
    valor_estoque: i.valor_em_estoque,
    abc: i.classe_abc,
    xyz: i.classe_xyz,
    situacao: i.situacao,
    alvo_aprovado: i.alvo_aprovado,
  });

  return {
    premissas: painel.premissas,
    resumo: painel.resumo,
    alertas: painel.alertas,
    evolucao: painel.evolucao,
    // Os RANKINGS vão INTEIROS e primeiro. São dez linhas cada, calculadas
    // pelo banco sobre o catálogo TODO, e são a única fonte correta para as
    // perguntas de "qual item mais/menos ..." — a amostra abaixo não serve,
    // porque um topo tirado de amostra é uma resposta errada com cara de
    // certa. Cortar daqui para economizar prompt reintroduz esse erro.
    rankings: painel.rankings,
    compra_por_familia: Array.isArray(painel.compra_por_familia)
      ? (painel.compra_por_familia as unknown[]).slice(0, 25)
      : [],
    liquidar: Array.isArray(painel.liquidar) ? (painel.liquidar as unknown[]).slice(0, 25) : [],
    amostra_itens: {
      em_falta: porSituacao("falta", 25).map(enxuto),
      a_repor: porSituacao("repor", 25).map(enxuto),
      em_excesso: porSituacao("excesso", 20).map(enxuto),
      saudaveis: porSituacao("saudavel", 10).map(enxuto),
    },
    total_de_itens_na_tela: itens.length,
  };
}

const SYSTEM = `Você é o analista de Suprimentos do Grupo Nascimento (terceirização: limpeza, portaria, recepção, administrativo — centenas de contratos). Fala com o GERENTE DE SUPPLY e com a diretoria.

Você recebe o painel de PLANEJAMENTO DE ESTOQUE em JSON, já calculado pelo banco.

COMO O NÚMERO FOI FEITO (explique assim se perguntarem):
- A demanda é o que foi PEDIDO pelos contratos na janela (não o que saiu do almoxarifado) — porque quem pediu uma peça que não tinha não apareceria na saída física.
- Só entra contrato ATIVO. Contrato novo é pedido à parte.
- "estoque de segurança" = colchão para a oscilação da demanda dentro do prazo de reposição, no nível de serviço das premissas.
- "ponto de pedido" = consumo durante o prazo de reposição + segurança. Abaixo dele, pedir.
- "alvo saudável" = consumo durante (prazo de reposição + ciclo de revisão) + segurança. É o quanto ter em casa depois de comprar.
- "comprar" = alvo − disponível − em trânsito.
- ABC = onde está o dinheiro (A = 80% do valor consumido). XYZ = previsibilidade (X regular, Z irregular).
- "dinheiro parado" = valor acima do alvo em itens que giram. "valor morto" = valor de item sem giro no prazo das premissas. São números SEPARADOS, nunca some os dois.

OS RANKINGS (campo "rankings") — USE SEMPRE QUE A PERGUNTA FOR "QUAL ITEM MAIS/MENOS …":
Eles são calculados sobre o catálogo INTEIRO. A lista de itens ("amostra_itens") é só uma amostra — NUNCA monte um "qual item mais…" a partir dela.
- rankings.mais_roda → "qual item mais roda no estoque": ordenado por giro anual (quantas vezes o estoque do item se renova por ano). Piso: 5 peças em casa e 3/mês de consumo, para não premiar item de 1 peça.
- rankings.repor_mais_seguido → "qual item eu reponho mais seguidamente": ordenado pelas reposições QUE ACONTECERAM na janela (entradas de estoque; entradas do mesmo dia contam como uma). "ciclos_por_ano_modelo" é referência teórica, NÃO é o critério — não ranqueie por ele.
- rankings.mais_faltou → "qual item mais faltou nos pedidos": histórico de pedidos que o estoque NÃO conseguiu atender, contado desde "falta_contada_desde" (quando o almoxarifado passou a registrar baixa por item). NÃO é a situação de hoje: um item que faltou 15 vezes e foi reposto ontem aparece como "saudável" na tabela e ainda assim é o maior problema. Sempre cite desde quando a contagem vale.
- rankings.mais_acumulado → "qual item não sai e está acumulado": excesso e item sem giro, pelo valor parado, com há quantos meses não gira.
- rankings.comprar_urgente → o que comprar primeiro: quem está sem peça agora, do maior consumo para o menor, com o histórico de falta ao lado.
Se um ranking vier vazio, diga que não há caso na janela — não preencha com item da amostra.

REGRAS DURAS:
- NUNCA invente nem recalcule quantidade, valor ou preço. Use exatamente os números do JSON. Se quiser sugerir quantidade diferente da calculada, diga que é uma sugestão para a pessoa aprovar na tela, e por quê.
- Se um dado não está no JSON, diga que o painel não mostra. Não estime.
- A lista de itens é uma AMOSTRA das linhas que mais importam; os totais em "resumo" valem para o catálogo inteiro. Nunca diga que o problema se limita aos itens listados.
- Item sem preço cadastrado fica fora do valor — se "itens_sem_preco" for maior que zero, avise que o valor está subestimado.
- Respeite os alertas: "historico_curto" significa alvo provisório; "demanda_irregular" (classe Z) significa alvo inflado pelo colchão, que vale conferir antes de comprar.
- Português do Brasil, direto, frases curtas, sem jargão técnico e sem falar de JSON, SQL ou nome de tabela/coluna.
- Markdown simples: ## nos títulos, "-" nas listas, **negrito** no essencial. Sempre cite o número junto da afirmação.

RESPOSTA A PERGUNTA SOLTA (modo conversa):
- Vá direto ao ponto: comece pela resposta, não por preâmbulo. No máximo ~12 linhas, salvo se pedirem detalhe.
- Liste no máximo 5 itens, com o nome, o tamanho e o número que sustenta a posição.
- Feche com UMA frase de recomendação prática.
- Se a pergunta não tiver nada a ver com estoque, diga que só sabe responder sobre este painel.`;

const PEDIDO_ANALISE = `Escreva a análise deste painel, nesta ordem:

## Como estamos
3 a 5 linhas: quanto temos em estoque, quantos dias isso cobre no consumo de hoje, e o que está em falta agora.

## Risco de parar gente
Use rankings.comprar_urgente. Os itens que podem deixar colaborador sem uniforme, do mais grave ao menos: tamanho, dias de cobertura restantes e quanto comprar. Quando o item também aparecer em rankings.mais_faltou, diga quantas vezes ele já faltou — é o que mostra que o problema é crônico e não de hoje.

## O que mais roda e o que eu reponho mais seguido
Use rankings.mais_roda e rankings.repor_mais_seguido. Dois ou três de cada, com o número. Aponte onde vale comprar em lote maior para reduzir o número de compras no ano.

## Dinheiro parado e o que vender
Use rankings.mais_acumulado. Separe os dois: excesso sobre o alvo em item que gira, e item sem giro (morto). Diga o valor de cada um e liste os maiores, com há quantos meses não giram.

## Compra sugerida
O total e as famílias com maior volume — é o que dá poder de negociação com o fornecedor. Diga onde vale fechar volume maior.

## Onde desconfiar do número
O que os alertas apontam, e qual item merece conferência humana antes de virar pedido.

## O que eu faria nesta semana
3 a 6 ações concretas, cada uma amarrada a um número do painel.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return respostaJson({ error: "Use POST." }, 405);

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) return respostaJson({ error: "Faça login." }, 401);

    const supa = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: userData, error: userErr } = await supa.auth.getUser();
    if (userErr || !userData?.user) return respostaJson({ error: "Sessão inválida." }, 401);

    const corpo = await req.json().catch(() => ({}));

    const uuid = (v: unknown) =>
      typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v) ? v : null;
    const empresaId = uuid(corpo?.empresaId);
    if (!empresaId) return respostaJson({ error: "Empresa não informada." }, 400);

    const modo = corpo?.modo === "pergunta" ? "pergunta" : "analise";
    const pergunta = String(corpo?.pergunta ?? "").trim().slice(0, 2000);
    if (modo === "pergunta" && !pergunta) return respostaJson({ error: "Escreva a pergunta." }, 400);

    const historico: Msg[] = (Array.isArray(corpo?.historico) ? corpo.historico : [])
      .filter((m: any) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
      .slice(-8)
      .map((m: any) => ({ role: m.role, content: String(m.content).slice(0, 4000) }));

    const provs = provedores();
    if (!provs.length) {
      return respostaJson({ error: "A chave da IA não está configurada. Avise o time de Sistemas." }, 500);
    }

    const janela = Number.isInteger(corpo?.janelaMeses) ? Number(corpo.janelaMeses) : null;
    const categoria = typeof corpo?.categoria === "string" && corpo.categoria ? corpo.categoria : null;

    // A permissão é cobrada DENTRO da RPC (can_access no dashboard de
    // Compras/Estoque) — não se confere aqui de novo para não haver duas
    // regras de acesso se desencontrando com o tempo. 42501 vira 403.
    const { data: painel, error: painelErr } = await supa.rpc("sup_estoque_saudavel", {
      p_empresa_id: empresaId,
      p_janela_meses: janela,
      p_contrato_id: uuid(corpo?.contratoId),
      p_categoria: categoria,
      p_almoxarifado_id: uuid(corpo?.almoxarifadoId),
    });
    if (painelErr) {
      return respostaJson({ error: painelErr.message }, painelErr.code === "42501" ? 403 : 500);
    }
    if (!painel) return respostaJson({ error: "O painel voltou vazio." }, 502);

    const hoje = new Date().toISOString().slice(0, 10);
    const contexto =
      `PAINEL DE PLANEJAMENTO DE ESTOQUE — categoria: ${categoria ?? "todas"}. Hoje é ${hoje}.\n` +
      JSON.stringify(compactar(painel as Record<string, unknown>));

    const mensagens: Msg[] = modo === "analise"
      ? [{ role: "user", content: PEDIDO_ANALISE }]
      : [...historico, { role: "user", content: pergunta }];

    const res = await chamarIA(provs, [
      { role: "system", content: SYSTEM + "\n\n" + contexto },
      ...mensagens,
    ]);
    if (!res.texto) return respostaJson({ error: res.erro }, res.status ?? 502);
    return respostaJson({ texto: res.texto });
  } catch (e) {
    console.error(e);
    return respostaJson(
      { error: e instanceof Error ? e.message : "Não foi possível gerar a análise agora." },
      500,
    );
  }
});
