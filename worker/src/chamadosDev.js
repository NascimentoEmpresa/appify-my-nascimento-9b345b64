// Detecta chamado de desenvolvimento novo atribuído ao dev configurado
// (CHAMADOS_DEV_USER_ID) e dispara uma sessão headless do Claude Code
// (permission-mode plan) pra já deixar um plano de implementação pronto pra
// revisão — ver docs/automacao-chamados.md pro desenho completo.
//
// Detecção via CHAMADO_SISTEMA_EVENTO (não via CHAMADO_SISTEMA.updated_at):
// o texto 'Chamado direcionado a...' é gravado pela RPC chamado_direcionar
// (supabase/migrations/20260813000001_chamados_fila_por_dev.sql) toda vez
// que alguém é atribuído/reatribuído — é o sinal mais preciso de "isso é
// novo pra este dev", diferente de updated_at que muda por qualquer edição.

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { enviarAlertaDiscord } = require("./discordAlert");

const CHAMADOS_DEV_USER_ID = process.env.CHAMADOS_DEV_USER_ID;
const CHAMADOS_DEV_REPO_PATH = process.env.CHAMADOS_DEV_REPO_PATH;
const MAX_DISPAROS_AUTOMATICOS_DIA = 5;
const TIMEOUT_TRIAGEM_MS = 2 * 60_000;
const TIMEOUT_PLANEJAMENTO_MS = 15 * 60_000;

const CLAUDE_BIN = process.platform === "win32" ? "claude.cmd" : "claude";
const ESTADO_PATH = path.join(__dirname, "..", "state", "chamados-dev.json");
const PLANOS_DIR = path.join(require("os").homedir(), ".claude", "plans");

function lerEstado() {
  try {
    return JSON.parse(fs.readFileSync(ESTADO_PATH, "utf8"));
  } catch {
    return { ultimoProcessado: null, contadorData: null, contadorHoje: 0 };
  }
}

function salvarEstado(estado) {
  fs.mkdirSync(path.dirname(ESTADO_PATH), { recursive: true });
  fs.writeFileSync(ESTADO_PATH, JSON.stringify(estado, null, 2));
}

function hojeISO() {
  return new Date().toISOString().slice(0, 10);
}

function classificarComplexidade(chamado) {
  const prompt =
    `Classifique a complexidade deste chamado de desenvolvimento em exatamente ` +
    `uma palavra: "simples", "normal" ou "complexo". Responda só a palavra, ` +
    `nada mais.\n\nAssunto: ${chamado.assunto}\n` +
    `Tipo: ${chamado.tipo_solicitacao || "não informado"}\n` +
    `Descrição: ${chamado.descricao || "não informada"}\n` +
    `Módulo: ${chamado.modulo_sistema || "não informado"}`;

  const r = spawnSync(
    CLAUDE_BIN,
    ["--print", "--model", "haiku", "--output-format", "json", prompt],
    { encoding: "utf8", timeout: TIMEOUT_TRIAGEM_MS },
  );
  if (r.error || r.status !== 0) {
    console.error("[chamadosDev] triagem falhou, usando 'normal' como padrão:", r.error || r.stderr);
    return "normal";
  }
  try {
    const saida = JSON.parse(r.stdout).result || "";
    const m = saida.toLowerCase().match(/simples|normal|complexo/);
    return m ? m[0] : "normal";
  } catch {
    return "normal";
  }
}

const MODELO_POR_COMPLEXIDADE = {
  simples: "sonnet",
  normal: "sonnet",
  complexo: "opus",
};

// Localiza, em ~/.claude/plans, o arquivo mais recente (criado depois de
// `desde`) que comece com o marcador <!-- chamado:NUMERO --> — é assim que
// .claude/commands/chamado.md marca o plano dele. Não existe caminho
// previsível: em modo headless o Write só grava num nome aleatório dentro
// dessa pasta compartilhada (validado na prática, ver docs/automacao-chamados.md).
function localizarPlano(numero, desde) {
  let candidatos;
  try {
    candidatos = fs.readdirSync(PLANOS_DIR)
      .map((nome) => path.join(PLANOS_DIR, nome))
      .filter((p) => {
        const st = fs.statSync(p);
        return st.isFile() && st.mtime >= desde;
      });
  } catch {
    return null;
  }
  const marcador = `<!-- chamado:${numero} -->`;
  for (const p of candidatos.sort((a, b) => fs.statSync(b).mtime - fs.statSync(a).mtime)) {
    const conteudo = fs.readFileSync(p, "utf8");
    if (conteudo.startsWith(marcador)) return p;
  }
  return null;
}

async function processarChamado(supabase, evento, estado) {
  const numero = evento.CHAMADO_SISTEMA.numero;
  const { data: chamado, error } = await supabase
    .from("CHAMADO_SISTEMA")
    .select("numero,assunto,descricao,tipo_solicitacao,modulo_sistema,prioridade")
    .eq("id", evento.chamado_id)
    .single();
  if (error || !chamado) {
    console.error(`[chamadosDev] não consegui buscar detalhes do chamado ${numero}:`, error?.message);
    return;
  }

  const complexidade = classificarComplexidade(chamado);
  const modeloClaude = MODELO_POR_COMPLEXIDADE[complexidade];
  console.log(`[chamadosDev] ${numero}: complexidade=${complexidade} modeloClaude=${modeloClaude}`);

  // Sem --worktree de propósito: em permission-mode plan o Claude não escreve
  // no código (é read-only) e o plano sai em ~/.claude/plans/ de qualquer
  // jeito, então worktree aqui só criaria pasta órfã. A worktree é criada
  // depois, no /codex-executar, quando o Codex vai de fato escrever código.
  const antesDoRun = new Date();
  const r = spawnSync(
    CLAUDE_BIN,
    [
      "--print",
      "--permission-mode", "plan",
      "--model", modeloClaude,
      "--output-format", "json",
      `/chamado ${numero}`,
    ],
    {
      cwd: CHAMADOS_DEV_REPO_PATH,
      encoding: "utf8",
      timeout: TIMEOUT_PLANEJAMENTO_MS,
      env: { ...process.env, CHAMADO_HEADLESS: "1" },
    },
  );
  if (r.error) {
    console.error(`[chamadosDev] sessão de planejamento falhou pra ${numero}:`, r.error);
    await enviarAlertaDiscord(`Chamado ${numero}: sessão de planejamento automática falhou (${r.error.message}). Rode manualmente com /chamado ${numero}.`);
    return;
  }

  const planoOrigem = localizarPlano(numero, antesDoRun);
  if (!planoOrigem) {
    console.error(`[chamadosDev] plano de ${numero} não encontrado em ~/.claude/plans após o run.`);
    await enviarAlertaDiscord(`Chamado ${numero}: sessão automática terminou mas o plano não foi encontrado. Rode /chamado ${numero} manualmente.`);
    return;
  }

  // Guarda a classificação junto do plano pro /codex-executar reaproveitar
  // sem ter que classificar de novo (economiza uma chamada de modelo).
  const destino = path.join(__dirname, "..", "state", "planos");
  fs.mkdirSync(destino, { recursive: true });
  fs.copyFileSync(planoOrigem, path.join(destino, `${numero}.md`));
  fs.writeFileSync(path.join(destino, `${numero}.complexidade`), complexidade);

  await enviarAlertaDiscord(
    `Chamado ${numero} — plano pronto pra revisão.\n` +
    `Complexidade estimada: ${complexidade}\n` +
    `Plano: ${path.join(destino, `${numero}.md`)}\n` +
    `Pra executar: /codex-executar ${numero}`,
  );

  estado.ultimoProcessado = evento.created_at;
  estado.contadorHoje += 1;
}

async function verificarChamadosDevNovos(supabase) {
  if (!CHAMADOS_DEV_USER_ID || !CHAMADOS_DEV_REPO_PATH) {
    console.error("[chamadosDev] CHAMADOS_DEV_USER_ID/CHAMADOS_DEV_REPO_PATH não configurados no .env — pulando ciclo.");
    return;
  }

  const estado = lerEstado();
  if (estado.contadorData !== hojeISO()) {
    estado.contadorData = hojeISO();
    estado.contadorHoje = 0;
  }

  // Primeira execução: marca "agora" como ponto de partida e não processa
  // nada. Sem isso, o cursor vazio traria todo o histórico de chamados já
  // direcionados e queimaria o limite diário com demanda antiga.
  if (!estado.ultimoProcessado) {
    estado.ultimoProcessado = new Date().toISOString();
    salvarEstado(estado);
    console.log(`[chamadosDev] primeira execução — marco inicial em ${estado.ultimoProcessado}; só chamados direcionados a partir de agora serão processados.`);
    return;
  }

  let query = supabase
    .from("CHAMADO_SISTEMA_EVENTO")
    .select("id,created_at,chamado_id,CHAMADO_SISTEMA!inner(numero,responsavel_id)")
    .eq("tipo", "evento")
    .like("texto", "Chamado direcionado a%")
    .eq("CHAMADO_SISTEMA.responsavel_id", CHAMADOS_DEV_USER_ID)
    .order("created_at", { ascending: true });
  if (estado.ultimoProcessado) query = query.gt("created_at", estado.ultimoProcessado);

  const { data: eventos, error } = await query;
  if (error) {
    console.error("[chamadosDev] erro ao buscar eventos:", error.message);
    return;
  }
  if (!eventos || eventos.length === 0) return;

  for (const evento of eventos) {
    if (estado.contadorHoje >= MAX_DISPAROS_AUTOMATICOS_DIA) {
      await enviarAlertaDiscord(`Chamado ${evento.CHAMADO_SISTEMA.numero} atribuído a você — limite diário de ${MAX_DISPAROS_AUTOMATICOS_DIA} sessões automáticas já atingido. Rode manualmente: /chamado ${evento.CHAMADO_SISTEMA.numero}`);
      estado.ultimoProcessado = evento.created_at;
      continue;
    }
    try {
      await processarChamado(supabase, evento, estado);
    } catch (e) {
      console.error(`[chamadosDev] erro processando ${evento.CHAMADO_SISTEMA.numero}:`, e);
      estado.ultimoProcessado = evento.created_at;
    }
    salvarEstado(estado);
  }
}

module.exports = { verificarChamadosDevNovos };
