const fs = require("fs");
const path = require("path");
const { enviarAlertaDiscord } = require("./discordAlert");

/**
 * Vigia da saúde do banco — o que faltava em 23/09/2026.
 *
 * Naquele dia o Postgres de produção ficou inalcançável por mais de 20
 * minutos e **a equipe só soube porque um usuário ligou reclamando que não
 * conseguia pagar**. O painel da Supabase mostrava tudo, mas painel só avisa
 * quem está olhando — e ninguém olha às 17h de uma quarta.
 *
 * Este módulo lê o mesmo endpoint de métricas que alimenta aquele painel e
 * avisa no Discord quando algum indicador passa do limite. É a diferença
 * entre descobrir em 1 minuto e descobrir por telefone.
 *
 * Os indicadores são os que de fato previram as três quedas:
 *   31/08/2026 — CPU esgotada (Nano)
 *   21/09/2026 — conexões: 61 em uso para 57 disponíveis (Micro)
 *   23/09/2026 — memória: swap, com commit de 2,46 GB numa máquina de 1 GB
 *
 * IOwait entra junto porque é o sintoma mais honesto de falta de memória:
 * parece problema de processador, mas é a CPU parada esperando o disco
 * porque a RAM acabou.
 */

// O endpoint atualiza cerca de uma vez por minuto — medido em 24/09/2026,
// quando o mesmo valor voltou idêntico em leituras de 6s e de 46s. O ciclo
// do worker é de 60s, então cai certinho: uma leitura por atualização.
const TIMEOUT_MS = 20_000;

// Percentual a partir do qual avisa. 75 é folgado o bastante para não tocar
// à toa e apertado o bastante para dar tempo de agir — em 21/09 as conexões
// passaram de 75% cerca de meia hora antes de estourar.
const LIMITE_PCT = Number(process.env.SAUDE_BANCO_LIMITE || 75);

// IOwait tem limite próprio e mais baixo: acima de 20% o banco já está
// gastando mais tempo esperando disco do que trabalhando.
const LIMITE_IOWAIT_PCT = 20;

// Enquanto o indicador continuar acima do limite, repete o aviso neste
// ritmo. Sem isso, um problema que dura horas avisaria uma vez só e
// silenciaria; com um valor curto demais, viraria spam a cada ciclo.
const REPETIR_MS = 30 * 60 * 1000;

// Arquivo que o alerta manda abrir. É o mesmo que o monitor de PowerShell
// grava, de propósito: existe UM lugar para olhar, seja por SSH, seja com o
// monitor aberto na tela.
const ARQ_STATUS = path.join(__dirname, "..", "..", "scripts", "status-banco.txt");

const LIGADO = process.env.SAUDE_BANCO_LIGADO !== "0";

// Estado em memória, igual ao discordAlert: reiniciar o worker é hora
// legítima de avisar de novo, porque significa que alguém mexeu ou que ele
// caiu.
const ultimoAviso = new Map();   // indicador -> timestamp do último envio
const acimaDoLimite = new Set(); // indicadores que estão em alerta agora

// ── Slot de replicação do corte para o cluster próprio (SIS-2026-0276) ─────
//
// Slot é o único objeto deste banco capaz de derrubar a produção sozinho:
// enquanto ele não é consumido, o Postgres não pode apagar o WAL que o
// assinante ainda não leu. Assinatura travada = disco enchendo = banco fora.
//
// 1 GB de atraso é folgado de propósito. Medido em 13/10/2026, a produção
// gera cerca de 400 MB de WAL por hora em dia útil — então 1 GB é umas duas
// horas e meia de atraso, tempo de sobra para agir, e alto o bastante para a
// carga inicial dos 2,3 GB não disparar alarme falso.
const LIMITE_SLOT_BYTES = Number(process.env.SAUDE_SLOT_LIMITE_MB || 1024) * 1048576;

// Slot inativo por instantes é normal (reconexão). Cinco minutos não é.
const SLOT_INATIVO_TOLERADO_MS = 5 * 60 * 1000;

const slotInativoDesde = new Map(); // slot -> desde quando está inativo

/**
 * Soma todas as linhas de uma métrica no formato Prometheus.
 *
 * Há uma linha por CPU, por disco, por banco — somar é o certo para
 * `node_cpu_seconds_total` (8 núcleos × 8 modos = 64 linhas) e inofensivo
 * para as que só têm uma.
 */
function somar(texto, nome, filtroRotulo) {
  const padrao = new RegExp(`^${nome}\\{([^}]*)\\}\\s+([0-9.eE+-]+)\\s*$`, "gm");
  let total = 0;
  let achou = false;
  let m;
  while ((m = padrao.exec(texto)) !== null) {
    if (filtroRotulo && !m[1].includes(filtroRotulo)) continue;
    total += Number(m[2]);
    achou = true;
  }
  return achou ? total : null;
}

const mb = (bytes) => Math.round(bytes / 1048576);
const gb = (bytes) => (bytes / 1073741824).toFixed(1);

function barra(pct, tamanho = 24) {
  const cheio = Math.round((Math.max(0, Math.min(100, pct)) / 100) * tamanho);
  return "█".repeat(cheio) + "░".repeat(tamanho - cheio);
}

/**
 * Decide se este indicador merece uma mensagem agora.
 *
 * A trava do discordAlert não serve aqui: a assinatura dele são os 200
 * primeiros caracteres da mensagem, sem normalizar números — de propósito,
 * para não esconder falhas distintas. Como a nossa mensagem carrega a
 * porcentagem, cada variação viraria uma assinatura nova e avisaria a cada
 * ciclo. Por isso controlamos a cadência aqui e enviamos com `forcar`.
 */
function deveAvisar(indicador) {
  const agora = Date.now();
  const anterior = ultimoAviso.get(indicador);
  if (anterior && agora - anterior < REPETIR_MS) return false;
  ultimoAviso.set(indicador, agora);
  return true;
}

async function avisar(indicador, pct, detalhe) {
  acimaDoLimite.add(indicador);
  if (!deveAvisar(indicador)) return;

  const texto =
    `\u{1F6A8} **Banco de dados — ${indicador.toUpperCase()} em ${Math.round(pct)}%**\n` +
    `${detalhe}\n\n` +
    `Estado completo dos indicadores:\n` +
    `\`${ARQ_STATUS}\`\n` +
    `Por SSH:  \`type "${ARQ_STATUS}"\``;

  await enviarAlertaDiscord(texto, { forcar: true });
}

/** Avisa quando o indicador volta ao normal — senão ninguém sabe que passou. */
async function avisarNormalizado(indicador, pct) {
  if (!acimaDoLimite.has(indicador)) return;
  acimaDoLimite.delete(indicador);
  ultimoAviso.delete(indicador);
  await enviarAlertaDiscord(
    `✅ **Banco de dados — ${indicador.toUpperCase()} normalizou** (${Math.round(pct)}%)`,
    { forcar: true },
  );
}

// CPU e IOwait são contadores acumulados: só viram percentual comparando
// duas leituras. Guardamos a anterior aqui.
let anterior = null;

async function verificarSaudeBanco() {
  if (!LIGADO) return;

  const url = process.env.SUPABASE_URL;
  const chave = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !chave) {
    console.warn("[saude] SUPABASE_URL/SERVICE_ROLE_KEY ausentes — vigia desligado.");
    return;
  }

  const projeto = (url.match(/https:\/\/([^.]+)\.supabase\.co/) || [])[1] || "?";
  const auth = Buffer.from(`service_role:${chave}`).toString("base64");

  let texto;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    const res = await fetch(`${url}/customer/v1/privileged/metrics`, {
      headers: { Authorization: `Basic ${auth}` },
      signal: ctrl.signal,
    });
    clearTimeout(t);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    texto = await res.text();
  } catch (e) {
    // Não conseguir ler as métricas é, por si só, o alerta mais importante:
    // é o sintoma de 23/09, quando tudo devolvia 522.
    await avisar(
      "acesso ao banco",
      100,
      `Não consegui ler as métricas do projeto \`${projeto}\`: ${e.message}\n` +
        "Se persistir por alguns minutos, o banco pode estar fora do ar.",
    );
    gravarStatus([`*** NAO CONSEGUI LER AS METRICAS: ${e.message} ***`], projeto);
    return;
  }

  const linhas = [];
  const checar = async (nome, pct, detalhe, limite = LIMITE_PCT) => {
    linhas.push(`  ${nome.padEnd(10)}[${barra(pct)}] ${String(Math.round(pct)).padStart(3)}%   ${detalhe}`);
    if (pct >= limite) await avisar(nome.toLowerCase(), pct, detalhe);
    else await avisarNormalizado(nome.toLowerCase(), pct);
  };

  // CONEXÕES — o limite vem das próprias métricas, então trocar o tamanho da
  // máquina (Micro 60 → Small 90 → Medium 120) é percebido sozinho, sem
  // ninguém lembrar de editar constante nenhuma.
  const conex = somar(texto, "pg_stat_database_num_backends");
  const maxConex = somar(texto, "max_connections_connection_count");
  if (conex != null && maxConex) {
    await checar("CONEXOES", (100 * conex) / maxConex, `${Math.round(conex)} de ${Math.round(maxConex)}`);
  }

  // MEMÓRIA
  const memTot = somar(texto, "node_memory_MemTotal_bytes");
  const memDisp = somar(texto, "node_memory_MemAvailable_bytes");
  if (memTot && memDisp != null) {
    await checar("MEMORIA", (100 * (memTot - memDisp)) / memTot, `${mb(memDisp)} MB livres de ${mb(memTot)} MB`);
  }

  // SWAP — o aviso mais antecipado de todos.
  const swpTot = somar(texto, "node_memory_SwapTotal_bytes");
  const swpLivre = somar(texto, "node_memory_SwapFree_bytes");
  if (swpTot && swpLivre != null) {
    await checar("SWAP", (100 * (swpTot - swpLivre)) / swpTot, `${mb(swpTot - swpLivre)} MB em disco de ${mb(swpTot)} MB`);
  }

  // DISCO
  const discTot = somar(texto, "node_filesystem_size_bytes", 'mountpoint="/data"');
  const discLivre = somar(texto, "node_filesystem_avail_bytes", 'mountpoint="/data"');
  if (discTot && discLivre != null) {
    await checar("DISCO", (100 * (discTot - discLivre)) / discTot, `${gb(discLivre)} GB livres de ${gb(discTot)} GB`);
  }

  // CPU e IOWAIT — precisam de duas leituras. Se o contador voltar IGUAL
  // (a Supabase ainda não atualizou o scrape), a base NÃO é trocada: trocar
  // daria divisão por zero no próximo delta.
  const cpuTot = somar(texto, "node_cpu_seconds_total");
  const idle = somar(texto, "node_cpu_seconds_total", 'mode="idle"');
  const iow = somar(texto, "node_cpu_seconds_total", 'mode="iowait"');

  if (cpuTot != null) {
    if (anterior && cpuTot > anterior.cpuTot) {
      const dTot = cpuTot - anterior.cpuTot;
      const pctCpu = 100 * (1 - (idle - anterior.idle) / dTot);
      const pctIow = (100 * (iow - anterior.iow)) / dTot;
      await checar("CPU", pctCpu, "média desde a leitura anterior");
      await checar("IOWAIT", pctIow, "CPU parada esperando disco", LIMITE_IOWAIT_PCT);
      anterior = { cpuTot, idle, iow };
    } else if (!anterior) {
      anterior = { cpuTot, idle, iow };
      linhas.push("  CPU/IOWAIT: aguardando a segunda leitura");
    }
  }

  // O slot vem depois das métricas de máquina de propósito: ele é o indicador
  // da fase do corte, não da saúde do dia a dia, e só existe enquanto a
  // replicação para o cluster estiver de pé.
  await verificarSlotReplicacao(url, chave, linhas);

  gravarStatus(linhas, projeto);
}

/**
 * Vigia dos slots de replicação (SIS-2026-0276).
 *
 * Lê o RPC `ha_slot_replicacao_estado` (migration 20261014000020). Enquanto a
 * migration não estiver aplicada, o PostgREST devolve 404 — e isso NÃO vira
 * alerta: fora da fase do corte não há slot nenhum, e aviso que grita sem
 * motivo é aviso que ninguém lê.
 *
 * Avisa em dois casos, cada um com a providência no corpo da mensagem:
 *   - atraso acima do limite (padrão 1 GB);
 *   - slot inativo por mais de 5 minutos.
 */
async function verificarSlotReplicacao(url, chave, linhas) {
  let slots;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    const res = await fetch(`${url}/rest/v1/rpc/ha_slot_replicacao_estado`, {
      method: "POST",
      headers: {
        apikey: chave,
        Authorization: `Bearer ${chave}`,
        "Content-Type": "application/json",
      },
      body: "{}",
      signal: ctrl.signal,
    });
    clearTimeout(t);
    if (res.status === 404) {
      linhas.push("  SLOT      migration 20261014000020 ainda nao aplicada");
      return;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    slots = await res.json();
  } catch (e) {
    // Não conseguir ler o slot não é o mesmo que o slot estar mal: pode ser
    // rede daqui. Fica no arquivo de status e não acorda ninguém.
    linhas.push(`  SLOT      nao consegui ler: ${e.message}`);
    return;
  }

  if (!Array.isArray(slots) || slots.length === 0) {
    linhas.push("  SLOT      nenhum slot na producao (normal fora do corte)");
    return;
  }

  for (const s of slots) {
    const nome = s.slot || "?";
    const atraso = Number(s.atraso_bytes || 0);
    const indicador = `slot ${nome}`;
    const pct = Math.min(100, (100 * atraso) / LIMITE_SLOT_BYTES);

    let inativoHa = 0;
    if (s.ativo === false) {
      if (!slotInativoDesde.has(nome)) slotInativoDesde.set(nome, Date.now());
      inativoHa = Date.now() - slotInativoDesde.get(nome);
    } else {
      slotInativoDesde.delete(nome);
    }

    linhas.push(
      `  SLOT      [${barra(pct)}] ${String(Math.round(pct)).padStart(3)}%   ` +
        `${nome}: ${s.atraso_legivel || "?"} atrasado, ${s.ativo ? "ativo" : "INATIVO"}`,
    );

    const demais =
      `Slot: \`${nome}\` (${s.tipo})\n` +
      `Atraso: **${s.atraso_legivel}**\n` +
      `Ativo: ${s.ativo ? "sim" : "**não**"}\n\n` +
      "O que isso significa: o banco de produção **não pode apagar** o WAL que " +
      "este slot ainda não leu. Se o atraso continuar subindo, o disco enche e " +
      "a Supabase sai do ar.\n" +
      "Providência: ver `docs/ha-corte-roteiro.md`, passo 1.5. Se não resolver " +
      "em poucos minutos, soltar o slot é o caminho — `DROP SUBSCRIPTION` no " +
      "cluster e `DROP PUBLICATION` na produção.";

    if (atraso >= LIMITE_SLOT_BYTES) {
      acimaDoLimite.add(indicador);
      if (deveAvisar(indicador)) {
        await enviarAlertaDiscord(
          `\u{1F6A8} **Replicação — slot atrasado ${s.atraso_legivel}**\n${demais}`,
          { forcar: true },
        );
      }
    } else if (inativoHa > SLOT_INATIVO_TOLERADO_MS) {
      acimaDoLimite.add(indicador);
      if (deveAvisar(indicador)) {
        await enviarAlertaDiscord(
          `\u{1F6A8} **Replicação — slot inativo há ${Math.round(inativoHa / 60000)} min**\n${demais}`,
          { forcar: true },
        );
      }
    } else if (acimaDoLimite.has(indicador)) {
      acimaDoLimite.delete(indicador);
      ultimoAviso.delete(indicador);
      await enviarAlertaDiscord(
        `✅ **Replicação — slot \`${nome}\` normalizou** (${s.atraso_legivel} de atraso, ativo)`,
        { forcar: true },
      );
    }
  }
}

function gravarStatus(linhas, projeto) {
  const conteudo = [
    "BANCO DE DADOS - SUPABASE - MONITOR (worker)",
    `Projeto : ${projeto}`,
    `Momento : ${new Date().toLocaleString("pt-BR")}`,
    "",
    ...linhas,
    "",
    `Limites: verde < 60% | amarelo 60-${LIMITE_PCT}% | vermelho >= ${LIMITE_PCT}%`,
    `Painel: https://supabase.com/dashboard/project/${projeto}/observability/database`,
    "",
    // Sem este aviso, abrir o arquivo com o worker parado mostra numero
    // velho com cara de atual — e o "Momento" la em cima passa batido.
    "ATENCAO: este arquivo so e atualizado enquanto o worker ou o monitor",
    "estiverem rodando. Confira o 'Momento' la em cima antes de confiar no",
    "numero. Para uma leitura nova agora:",
    "    .\\scripts\\monitor-supabase.ps1 -UmaVez",
  ].join("\n");

  try {
    fs.mkdirSync(path.dirname(ARQ_STATUS), { recursive: true });
    fs.writeFileSync(ARQ_STATUS, conteudo + "\n", "utf8");
  } catch (e) {
    // Não conseguir gravar o arquivo não pode derrubar o ciclo do worker —
    // o alerta no Discord já saiu, que é o que importa.
    console.warn("[saude] não consegui gravar o status:", e.message);
  }
}

// verificarSlotReplicacao sai exportada para poder ser testada sozinha,
// sem disparar o vigia inteiro (que fala com o endpoint de metricas).
module.exports = { verificarSaudeBanco, verificarSlotReplicacao };
