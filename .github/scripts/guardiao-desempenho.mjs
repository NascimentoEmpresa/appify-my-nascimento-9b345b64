// ============================================================================
//  GUARDIÃO DE DESEMPENHO — reprova a PR que repete o que derrubou a produção
//  (item 13, 03/11/2026)
//
//  Uso:  node .github/scripts/guardiao-desempenho.mjs --base origin/main
//        (lê `git diff <base>...HEAD`; só as linhas ADICIONADAS contam — a
//        dívida antiga não trava ninguém, código novo não pode repetir)
//
//  Cada regra abaixo nasceu de um incidente MEDIDO, citado na mensagem, para
//  quem levar o vermelho entender o porquê sem precisar perguntar:
//
//  FRONTEND (src/**) — D1, D4 e D8 só aqui; o resto vale também para
//  supabase/functions/** e worker/** (ver ALCANCE, abaixo)
//   D1 refetchInterval / refetchIntervalInBackground ........ polling
//   D2 setInterval que chama o servidor ........................ polling
//   D3 .channel( / postgres_changes (Realtime) ................. não existe no cluster
//   D4 refetchOnWindowFocus: true .............................. rajada a cada alt-tab
//   D5 lista em tabela GRANDE sem .range/.limit/.single ........ tela que baixa MB
//   D6 select("*") em tabela GRANDE (lista) .................... idem, coluna que ninguém usa
//   D7 Promise.all de requisições num .map ..................... rajada que esgota o pool
//   D8 URL/chave do Supabase escrita no código ................. o Lovable regenera com credencial
//  WORKER (worker/**)
//   W1 temporizador abaixo de 60 s ............................. o worker é poller, mas com piso
//  MIGRATION
//   M1 policy com função chamada POR LINHA (sem (SELECT ...)) .. 2,4 s em 86 linhas
//   M2 FOREIGN KEY sem índice na coluna ........................ varredura em todo JOIN/DELETE
//   M3 SECURITY DEFINER sem SET search_path .................... convenção de segurança
//   M4 CREATE OR REPLACE TRIGGER/POLICY ........................ o Postgres não suporta: a fila para
//   M5 DDL sem NOTIFY pgrst no fim ............................. PostgREST serve o schema velho
//   M6 DO/BEGIN que dá RAISE EXCEPTION validando dado .......... aborta e para a fila do time
//
//  ALCANCE (04/11/2026). Antes as regras de código olhavam SÓ `src/`, então
//  Edge Function que varria tabela grande e worker com temporizador de 5 s não
//  passavam por regra nenhuma. Agora:
//    src/**                  D1 D2 D3 D4 D5 D6 D7 D8
//    supabase/functions/**   D2 D3 D5 D6 D7
//    worker/**               D3 D5 D6 D7 W1
//  O que o regex não alcança — nome de tabela em variável, chamada dentro de
//  hook, consulta montada por biblioteca — é pego pelo CONTRATO DE REDE do
//  `qa-requisicoes` (infra/qa/contrato-de-rede.mjs), que julga a requisição em
//  vez do texto. As duas camadas são de propósito.
//
//  VÁLVULA: `guardiao-ok: <motivo com 15+ caracteres>` num comentário na
//  MESMA linha ou na de cima libera aquela ocorrência. Toda liberação aparece
//  listada no resumo da PR — liberar é decisão registrada, não esquecimento.
//
//  Tabelas "grandes": .github/tabelas-grandes.json (gerado da produção).
// ============================================================================
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
export const GRANDES = new Set(Object.keys(JSON.parse(fs.readFileSync(path.join(AQUI, "../tabelas-grandes.json"), "utf8")).tabelas));

const VALVULA = /guardiao-ok:\s*(.{15,})/;
const ehComentario = (l) => /^\s*(\/\/|\*|\/\*|--)/.test(l);

/** Linhas do arquivo depois da mudança + quais números de linha foram adicionados. */
export function analisarArquivo(caminho, texto, adicionadas) {
  const linhas = texto.split(/\r?\n/);
  const achados = [];
  const liberado = (i) => VALVULA.exec(linhas[i] ?? "") || VALVULA.exec(linhas[i - 1] ?? "");
  const achar = (regra, i, msg) => {
    const v = liberado(i);
    achados.push({ regra, arquivo: caminho, linha: i + 1, msg, liberado: v ? v[1].trim() : null });
  };
  const trecho = (i, n) => linhas.slice(i, i + n).join("\n");

  const ehCodigo = /\.(ts|tsx|js|jsx|mjs)$/.test(caminho);
  const ehTela = ehCodigo && caminho.startsWith("src/") && !caminho.startsWith("src/test/");
  const ehFuncao = ehCodigo && caminho.startsWith("supabase/functions/");
  const ehWorker = ehCodigo && caminho.startsWith("worker/") && !/\.test\.|\/teste?s?\//.test(caminho);

  if (ehTela || ehFuncao || ehWorker) {
    for (const n of adicionadas) {
      const i = n - 1, l = linhas[i] ?? "";
      if (ehComentario(l)) continue;
      if (ehTela && /\brefetchInterval(InBackground)?\s*:/.test(l) && !/refetchInterval\s*:\s*(false|0)\s*[,}]/.test(l))
        achar("D1", i, "refetchInterval = busca automática. Em 03/11/2026 uma aba parada fazia 13 req/min e uma só aba do WhatsApp Inbox (8 s) fez 232 req/min. Regra do ERP: só busca quando o usuário pede — use o botão Atualizar (src/lib/atualizarTela.ts).");
      if (!ehWorker && /\bsetInterval\s*\(/.test(l) && /(supabase|\bsb\b|\bdb\b|\.rpc\(|\.from\(|fetch\(|carregar|buscar|load[A-Z]|refetch|invalidateQueries)/.test(trecho(i, 8)))
        achar("D2", i, "setInterval que vai ao servidor = polling. Temporizador só para relógio/animação. Dado novo: useAoPedirAtualizacao (src/lib/atualizarTela.ts).");
      // W1: o worker É um poller, então D2 não se aplica a ele — mas com piso.
      // Um ciclo de 5 s no worker é o mesmo estrago que um na tela, só sem
      // ninguém olhando: 12 req/min por tarefa, para sempre, no mesmo pool de
      // 20 conexões do PostgREST.
      if (ehWorker) {
        const mt = l.match(/\bset(?:Interval|Timeout)\s*\(\s*[^,]{1,80},\s*(\d[\d_]*)\s*\)/);
        if (mt && Number(mt[1].replace(/_/g, "")) < 60_000)
          achar("W1", i, `Temporizador de ${Number(mt[1].replace(/_/g, "")) / 1000} s no worker. O piso do projeto é 60 s por ciclo: abaixo disso o worker vira o polling que a tela deixou de fazer, no mesmo pool de 20 conexões. Ver worker/AGENTS.md (ciclo e travas).`);
      }
      if (/\.channel\s*\(|postgres_changes/.test(l))
        achar("D3", i, "Realtime não existe no cluster (nem container, nem rota no Kong): o canal vira 404 a cada 10 s para sempre (Conferência de Ponto, 03/11/2026).");
      if (ehTela && /refetchOnWindowFocus\s*:\s*true/.test(l))
        achar("D4", i, "refetchOnWindowFocus: true refaz todas as consultas da tela a cada alt-tab. O padrão do ERP é false (src/App.tsx).");
      const m = l.match(/\.from\(\s*["'`]([^"'`]+)["'`]\s*\)/);
      if (m && GRANDES.has(m[1])) {
        const stmt = trecho(i, 14).split(/;\s*$|^\s*\}\s*\)?;?\s*$/m)[0];
        const ehEscrita = /\.(insert|update|upsert|delete)\s*\(/.test(stmt);
        const limitada = /\.(range|limit|single|maybeSingle)\s*\(|head:\s*true|\.eq\(\s*["'`]id["'`]/.test(stmt);
        if (!ehEscrita && !limitada)
          achar("D5", i, `Lista em "${m[1]}" (tabela grande da produção) sem .range()/.limit(). Em 03/11/2026 as telas que fazem isso baixavam de 1 a 17,9 MB por abertura e foram as primeiras a ceder no teste de carga. Pagine no servidor e calcule total/KPI numa RPC.`);
        if (!ehEscrita && /\.select\(\s*["'`]\*["'`]/.test(stmt) && !/\.(single|maybeSingle)\s*\(|\.eq\(\s*["'`]id["'`]/.test(stmt))
          achar("D6", i, `select("*") em "${m[1]}" (tabela grande). Peça só as colunas que a tela usa — planilha_custo com select=* eram 2,1 MB por leitura (3,1 GB no dia).`);
      }
      // D8: a deriva do Lovable. Ele regenera
      // `src/integrations/supabase/client.ts` com a URL e a chave anon
      // escritas no arquivo, e hoje só um humano lembrando reaplica o import
      // de `env.ts` (está no CLAUDE.md). Duas formas de pegar sem falso
      // positivo: chave JWT literal (a anon começa com `eyJ`) e `createClient`
      // recebendo a URL como texto.
      if (ehTela) {
        if (/["'`]eyJ[A-Za-z0-9_-]{20,}/.test(l))
          achar("D8", i, "Chave JWT escrita no código (a anon do Supabase começa com `eyJ`). Credencial vem do .env via src/integrations/supabase/env.ts. Se este arquivo foi regerado pelo Lovable, reaplique o import — é o caso descrito no CLAUDE.md.");
        if (/createClient\s*\(\s*["'`]https?:\/\//.test(l))
          achar("D8", i, "createClient com a URL escrita no código. A URL vem do .env (src/integrations/supabase/env.ts): com ela no literal, uma build de homologação aponta para a produção sem ninguém perceber.");
      }
      if (/Promise\.all\s*\(/.test(l) && /\.map\s*\(/.test(trecho(i, 4)) && /(\.from\(|\.rpc\(|fetch\()/.test(trecho(i, 6)))
        achar("D7", i, "Promise.all com uma requisição por item dispara N requisições juntas — o PostgREST tem 20 conexões. Lotes de 40 ids x 247 = o que esgotou o pool em 03/11. Use uma RPC que recebe uuid[] no corpo (uma requisição) ou emLotes (no máximo 4 por vez).");
    }
  }

  if (/^supabase\/migrations\/.*\.sql$/.test(caminho)) {
    const add = new Set(adicionadas);
    const semComentario = linhas.map((l) => l.replace(/--.*$/, "")).join("\n");
    // M1: CREATE/ALTER POLICY ... ; com chamada por linha. ALTER também: é
    // como se troca a expressão de uma policy viva sem derrubá-la.
    for (const pm of semComentario.matchAll(/(?:CREATE|ALTER)\s+POLICY[\s\S]*?;/gi)) {
      const ini = semComentario.slice(0, pm.index).split("\n").length - 1;
      if (!add.has(ini + 1)) continue;
      const restante = tirarSelects(pm[0]);
      const chamadas = restante.match(/\b(auth\.uid|has_screen_access|can_access|tem_acesso_menu|has_role|pode_\w+|user_pode_\w+|get_user_\w+|is_admin\w*)\s*\(/gi);
      if (chamadas)
        achar("M1", ini, `Policy chama ${[...new Set(chamadas.map((c) => c.replace(/\s*\($/, "")))].join(", ")} FORA de (SELECT ...): o Postgres reavalia a função EM CADA LINHA. SISTEMA_NOTIFICACAO_ALVO levava 2,4 s para devolver ZERO de 86 linhas (03/11/2026). Escreva (SELECT auth.uid()), (SELECT has_screen_access(...)).`);
    }
    // M2: FK sem índice
    for (const tm of semComentario.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?((?:public\.)?"?[\w]+"?)\s*\(([\s\S]*?)\n\);/gi)) {
      const ini = semComentario.slice(0, tm.index).split("\n").length - 1;
      if (!add.has(ini + 1)) continue;
      const tabela = tm[1].replace(/^public\./, "").replace(/"/g, "");
      for (const cm of tm[2].matchAll(/^\s*"?(\w+)"?\s+[\w\s]+?\bREFERENCES\b/gim)) {
        const col = cm[1];
        const temIndice = new RegExp(`CREATE\\s+(UNIQUE\\s+)?INDEX[^;]*ON\\s+(public\\.)?"?${tabela}"?[^;]*\\(\\s*"?${col}"?`, "i").test(semComentario)
          || new RegExp(`\\bPRIMARY\\s+KEY\\s*\\(\\s*"?${col}"?|UNIQUE\\s*\\(\\s*"?${col}"?`, "i").test(tm[2])
          || new RegExp(`^\\s*"?${col}"?[^,]*\\b(PRIMARY KEY|UNIQUE)\\b`, "im").test(tm[2]);
        if (!temIndice)
          achar("M2", ini, `"${tabela}".${col} é FOREIGN KEY sem índice. Todo JOIN por ela e todo DELETE na tabela referenciada varrem "${tabela}" inteira. Acrescente: CREATE INDEX IF NOT EXISTS ${tabela.toLowerCase()}_${col}_idx ON public."${tabela}" (${col});`);
      }
    }
    // M3: SECURITY DEFINER sem search_path
    for (const fm of semComentario.matchAll(/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION[\s\S]*?(?:\$\$|\$[a-z_]+\$)/gi)) {
      const ini = semComentario.slice(0, fm.index).split("\n").length - 1;
      if (!add.has(ini + 1)) continue;
      if (/SECURITY\s+DEFINER/i.test(fm[0]) && !/SET\s+search_path/i.test(fm[0]))
        achar("M3", ini, "Função SECURITY DEFINER sem SET search_path = public, pg_temp — convenção do projeto (backend-supabase/SKILL.md): sem ela, um objeto com o mesmo nome em outro schema é executado com o poder do dono.");
    }

    // ----------------------------------------------------------------------
    // 04/11/2026 — as três que param a FILA, não o desempenho
    //
    // Desde 19/10 a migration aplica sozinha no merge
    // (.github/workflows/cluster_pos_merge.yml), UMA transação por arquivo e
    // parando no primeiro erro. Então uma migration que não roda não é um
    // problema de quem a escreveu: é a fila do time inteiro parada, com o
    // banco no meio do caminho. Estas três regras pegam, no texto, os três
    // jeitos conhecidos de isso acontecer.
    // ----------------------------------------------------------------------

    // M4: o Postgres NÃO tem CREATE OR REPLACE para trigger nem para policy.
    // É erro de sintaxe na aplicação — e já está escrito no CLAUDE.md.
    for (const m of semComentario.matchAll(/CREATE\s+OR\s+REPLACE\s+(TRIGGER|POLICY)\b/gi)) {
      const ini = semComentario.slice(0, m.index).split("\n").length - 1;
      if (!add.has(ini + 1)) continue;
      achar("M4", ini, `O Postgres não suporta CREATE OR REPLACE ${m[1].toUpperCase()}: a migration falha na aplicação e PARA A FILA de todo o time. Use DROP ${m[1].toUpperCase()} IF EXISTS seguido de CREATE (que também deixa o arquivo idempotente).`);
    }

    // M5: PostgREST guarda o schema em cache. Sem o NOTIFY, a função/coluna
    // nova existe no banco e devolve 404 pela API até alguém reiniciar.
    const mexeNoSchema = /(CREATE|ALTER)\s+(OR\s+REPLACE\s+)?(FUNCTION|TABLE|VIEW|MATERIALIZED\s+VIEW)\b|(CREATE|DROP|ALTER)\s+POLICY\b/i;
    const primeiraDDL = linhas.findIndex((l, k) => add.has(k + 1) && mexeNoSchema.test(l.replace(/--.*$/, "")));
    if (primeiraDDL >= 0 && !/NOTIFY\s+pgrst/i.test(semComentario)) {
      achar("M5", primeiraDDL, "Migration que cria ou altera função, tabela, view ou policy precisa terminar com `NOTIFY pgrst, 'reload schema';` — convenção do projeto. Sem isso o PostgREST continua servindo o schema velho e a API devolve 404 para o que já existe no banco, até alguém reiniciar o container.");
    }

    // M6: validação de dado que aborta. Já aconteceu: a migration conferia
    // nome/perfil da produção, não batia, dava RAISE EXCEPTION, a transação
    // caía e a fila parou — e a R4 (append-only) impede consertar o arquivo.
    for (const m of semComentario.matchAll(/\bDO\s+(\$\$|\$[a-z_]*\$)[\s\S]*?\1/gi)) {
      const ini = semComentario.slice(0, m.index).split("\n").length - 1;
      if (!add.has(ini + 1)) continue;
      if (/RAISE\s+EXCEPTION/i.test(m[0]) && /\bSELECT\b/i.test(m[0]))
        achar("M6", ini, "Bloco DO que consulta dado e dá RAISE EXCEPTION: se o dado da produção não bater, a transação aborta, a migration fica pendente e a FILA DO TIME PARA — e a R4 proíbe editar o arquivo depois. Para conferir sem travar, use RAISE NOTICE; para garantir regra, use CHECK/trigger.");
    }
  }
  return achados;
}

/** Remove os trechos (SELECT ...) com parênteses balanceados — o que sobra é avaliado por linha. */
export function tirarSelects(sql) {
  let s = sql, mudou = true;
  while (mudou) {
    mudou = false;
    const m = /\(\s*SELECT\b/i.exec(s);
    if (!m) break;
    let prof = 0, j = m.index;
    for (; j < s.length; j++) { if (s[j] === "(") prof++; else if (s[j] === ")" && --prof === 0) break; }
    s = s.slice(0, m.index) + " __SUB__ " + s.slice(j + 1); mudou = true;
  }
  return s;
}

// ── execução no CI ───────────────────────────────────────────────────────────
function principal() {
  const i = process.argv.indexOf("--base");
  const base = i > 0 ? process.argv[i + 1] : "origin/main";
  const diff = execSync(`git diff --unified=0 --no-color --diff-filter=AM ${base}...HEAD`, { maxBuffer: 1 << 28 }).toString();
  const porArquivo = new Map(); let atual = null;
  for (const l of diff.split("\n")) {
    if (l.startsWith("+++ b/")) { atual = l.slice(6); porArquivo.set(atual, []); continue; }
    const h = l.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/);
    if (h && atual) { const ini = +h[1], n = h[2] === undefined ? 1 : +h[2]; for (let k = 0; k < n; k++) porArquivo.get(atual).push(ini + k); }
  }
  const achados = [];
  for (const [arq, adicionadas] of porArquivo) {
    if (!adicionadas.length || !fs.existsSync(arq)) continue;
    achados.push(...analisarArquivo(arq, fs.readFileSync(arq, "utf8"), adicionadas));
  }
  const bloqueia = achados.filter((a) => !a.liberado), liberados = achados.filter((a) => a.liberado);
  for (const a of bloqueia) console.log(`::error file=${a.arquivo},line=${a.linha},title=Guardião ${a.regra}::${a.msg}`);
  const resumo = [
    "## Guardião de desempenho",
    bloqueia.length ? `❌ **${bloqueia.length} ocorrência(s) bloqueiam a PR.**` : "✅ Nenhuma ocorrência que bloqueie.",
    "", ...bloqueia.map((a) => `- **${a.regra}** \`${a.arquivo}:${a.linha}\` — ${a.msg}`),
    ...(liberados.length ? ["", "### Liberadas com `guardiao-ok` (o revisor deve concordar com o motivo)", ...liberados.map((a) => `- **${a.regra}** \`${a.arquivo}:${a.linha}\` — motivo: _${a.liberado}_`)] : []),
  ].join("\n");
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, resumo + "\n");
  console.log(resumo);
  process.exit(bloqueia.length ? 1 : 0);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) principal();
