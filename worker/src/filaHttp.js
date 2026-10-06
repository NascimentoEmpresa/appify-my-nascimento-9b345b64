const { enviarAlertaDiscord } = require("./discordAlert");

/**
 * Entrega as chamadas HTTP que o banco enfileirou.
 *
 * POR QUE O BANCO NÃO FAZ MAIS HTTP SOZINHO
 *
 * Até 05/10/2026 os gatilhos e os crons chamavam Edge Function direto do
 * Postgres, com `net.http_post` (extensão pg_net). Três problemas:
 *
 *  1. pg_net é EXCLUSIVO DA SUPABASE. Enquanto o banco depender dele, o
 *     primário não pode sair de lá — ou seja, não existe failover automático
 *     com escrita. Era o bloqueador do projeto de alta disponibilidade.
 *
 *  2. HTTP dentro de transação é entrega não confiável. Se a transação volta
 *     atrás depois do disparo, a chamada JÁ FOI: a Edge Function recebe um
 *     evento que, no banco, nunca aconteceu.
 *
 *  3. Falha de rede era engolida com `RAISE WARNING` — o aviso sumia em
 *     silêncio, sem nova tentativa.
 *
 * Agora o gatilho GRAVA a intenção em `public.fila_http`, na mesma transação
 * do dado. Se a transação volta atrás, a intenção volta com ela. Quem entrega
 * é este módulo, com nova tentativa e alerta quando desiste.
 *
 * A FILA GUARDA O NOME DA FUNÇÃO, NUNCA A URL
 *
 * A URL estava fixa em sete lugares apontando para o projeto de produção. Com
 * só o nome na fila, quem resolve o endereço é este worker, pelo ambiente —
 * então o mesmo banco serve produção e réplica sem apontar para o lugar
 * errado.
 */

// Quantas entregas por ciclo. O ciclo é de 60s e cada entrega é uma chamada
// HTTP: lotes grandes atrasariam os outros módulos do mesmo ciclo.
const POR_CICLO = 25;

// Depois disto, para de tentar e avisa. Com ciclo de 60s, 5 tentativas cobrem
// uma indisponibilidade de alguns minutos sem ficar batendo para sempre numa
// função que, por exemplo, foi renomeada.
const MAX_TENTATIVAS = 5;

// Quanto tempo o histórico entregue fica na tabela antes da faxina.
const DIAS_DE_HISTORICO = 7;

/**
 * Cabeçalho extra que alguma função exige além do JWT.
 *
 * `whatsapp-retomada-tick` confere um segredo próprio (`x-tick-secret`), que
 * antes vinha do Vault da Supabase para dentro do comando do cron. Agora vem
 * do ambiente do worker. Se faltar, a chamada é recusada pela própria função —
 * então avisamos cedo, em vez de deixar a fila acumular erro 401.
 */
function cabecalhosExtras(destino) {
  if (destino === "whatsapp-retomada-tick") {
    const segredo = process.env.WHATSAPP_TICK_SECRET;
    if (!segredo) return { faltando: "WHATSAPP_TICK_SECRET" };
    return { headers: { "x-tick-secret": segredo } };
  }
  return { headers: {} };
}

async function entregarUma(item, base, chave) {
  const extras = cabecalhosExtras(item.destino);
  if (extras.faltando) {
    throw new Error(`falta a variavel ${extras.faltando} no worker/.env`);
  }

  // AbortController em vez de confiar no tempo da rede: uma Edge Function
  // pendurada travaria o ciclo inteiro do worker.
  const ctrl = new AbortController();
  const limite = setTimeout(() => ctrl.abort(), 30_000);
  try {
    const r = await fetch(`${base}/functions/v1/${item.destino}`, {
      method: "POST",
      signal: ctrl.signal,
      headers: {
        "Content-Type": "application/json",
        apikey: chave,
        Authorization: `Bearer ${chave}`,
        ...extras.headers,
      },
      body: JSON.stringify(item.corpo ?? {}),
    });
    if (!r.ok) {
      const corpo = (await r.text()).slice(0, 300);
      throw new Error(`HTTP ${r.status} ${corpo}`);
    }
  } finally {
    clearTimeout(limite);
  }
}

async function processarFilaHttp(supabase) {
  const base = process.env.SUPABASE_URL;
  const chave = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !chave) {
    console.warn("[fila-http] SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY ausentes — nada entregue.");
    return;
  }

  const { data: pendentes, error } = await supabase
    .from("fila_http")
    .select("id, destino, corpo, tentativas")
    .is("processado_em", null)
    .lt("tentativas", MAX_TENTATIVAS)
    .order("id", { ascending: true })
    .limit(POR_CICLO);

  if (error) {
    console.error("[fila-http] não consegui ler a fila:", error.message);
    return;
  }
  if (!pendentes?.length) {
    await faxina(supabase);
    return;
  }

  let entregues = 0;
  let falhas = 0;

  for (const item of pendentes) {
    // try/catch por item: uma função fora do ar não pode travar as outras —
    // mesmo padrão de `lembreteWhatsapp.js`.
    try {
      await entregarUma(item, base, chave);
      await supabase
        .from("fila_http")
        .update({ processado_em: new Date().toISOString(), erro: null })
        .eq("id", item.id);
      entregues += 1;
    } catch (e) {
      falhas += 1;
      const tentativas = (item.tentativas ?? 0) + 1;
      await supabase
        .from("fila_http")
        .update({
          tentativas,
          ultima_tentativa_em: new Date().toISOString(),
          erro: String(e.message ?? e).slice(0, 500),
        })
        .eq("id", item.id);

      // Avisa UMA vez, na tentativa que esgota — não a cada ciclo. Alerta
      // repetido vira ruído e deixa de ser lido.
      if (tentativas >= MAX_TENTATIVAS) {
        try {
          await enviarAlertaDiscord(
            `fila_http desistiu de \`${item.destino}\` (id ${item.id}) depois de ` +
              `${MAX_TENTATIVAS} tentativas.\nÚltimo erro: ${String(e.message ?? e).slice(0, 300)}`,
          );
        } catch (e2) {
          console.error("[fila-http] não consegui alertar no Discord:", e2);
        }
      }
    }
  }

  console.log(`[fila-http] ${entregues} entregue(s), ${falhas} com erro, de ${pendentes.length}.`);
  await faxina(supabase);
}

/**
 * Remove o histórico já entregue. Sem isto a tabela cresce para sempre — e o
 * índice parcial de pendentes continuaria pequeno, mas um `select *` de
 * diagnóstico ficaria impraticável.
 */
async function faxina(supabase) {
  const corte = new Date(Date.now() - DIAS_DE_HISTORICO * 86_400_000).toISOString();
  const { error } = await supabase
    .from("fila_http")
    .delete()
    .not("processado_em", "is", null)
    .lt("processado_em", corte);
  if (error) console.error("[fila-http] faxina falhou:", error.message);
}

module.exports = { processarFilaHttp };
