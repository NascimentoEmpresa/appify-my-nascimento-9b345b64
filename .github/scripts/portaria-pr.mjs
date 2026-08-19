#!/usr/bin/env node
// Portaria de PR — camada determinística da revisão automática.
//
// Regras absolutas (R1–R7) sobre o diff da PR, sem IA. Existe porque segredo
// vazado e DROP TABLE precisam de resposta determinística: se a checagem
// dependesse do julgamento de um modelo, um dia ela passa. O revisor de IA
// (revisao_ia.yml) cuida do que é julgamento de verdade; aqui só entra o que
// dá pra decidir com certeza.
//
// Cada regra foi calibrada contra o histórico real do repositório — os
// comentários citam a contagem que justifica o corte, pra ninguém apertar a
// regra sem saber quantas PRs legítimas ela vai travar.
//
// Uso local (não precisa de nada do GitHub):
//   node .github/scripts/portaria-pr.mjs
//   node .github/scripts/portaria-pr.mjs --base main
//
// Saída: anotações ::error:: pro GitHub Actions, um resumo legível, e o
// arquivo portaria-resultado.json pro job seguinte.

import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";

// ---------------------------------------------------------------- utilidades

function git(args) {
  return execFileSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}

/** Remove aspas, prefixo public. e normaliza pra comparação. */
function normalizarIdentificador(bruto) {
  return bruto
    .replace(/"/g, "")
    .replace(/^public\./i, "")
    .replace(/;$/, "")
    .trim()
    .toLowerCase();
}

/** Linha que é só comentário — não vale como código pra fins de regra. */
function ehComentario(linha) {
  const t = linha.trim();
  return t.startsWith("//") || t.startsWith("--") || t.startsWith("*") ||
         t.startsWith("/*") || t.startsWith("#");
}

/**
 * Devolve só a parte executável de uma linha SQL, sem o comentário `--`.
 *
 * Isso não é preciosismo: as migrations daqui documentam o rollback em
 * comentário (`--   DROP TABLE IF EXISTS public."FOO";`). Sem esta função a
 * R2 reprova 8 migrations legítimas já mergeadas na main — foi o primeiro
 * resultado do teste local, e é exatamente o tipo de falso positivo que faz
 * um time desligar o check.
 *
 * O scanner respeita string de aspas simples pra não cortar em `'--'`.
 */
function codigoSQL(texto) {
  let dentroDeString = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (c === "'") {
      // '' escapado dentro de string continua sendo string
      if (dentroDeString && texto[i + 1] === "'") { i++; continue; }
      dentroDeString = !dentroDeString;
      continue;
    }
    if (!dentroDeString && c === "-" && texto[i + 1] === "-") {
      return texto.slice(0, i);
    }
  }
  return texto;
}

// Arquivos que nunca são revisados: gerados, binários ou grandes demais pra
// terem regra útil. Manter em sincronia com o filtro do revisor de IA.
const IGNORADOS = [
  /(^|\/)package-lock\.json$/,
  /(^|\/)bun\.lockb$/,
  /(^|\/)node_modules\//,
  /(^|\/)dist\//,
  /\.(xlsx|xls|csv|png|jpe?g|gif|webp|pdf|zip|ico|woff2?)$/i,
];

function ehIgnorado(arquivo) {
  return IGNORADOS.some((re) => re.test(arquivo));
}

// ------------------------------------------------------------ leitura do diff

/**
 * Descobre contra qual ref comparar. No Actions o GITHUB_BASE_REF traz a base
 * da PR; localmente cai pra main. Tenta origin/<base> antes de <base> porque
 * o runner faz checkout sem criar as branches locais.
 */
function resolverBase() {
  const argIdx = process.argv.indexOf("--base");
  const nome = argIdx !== -1 ? process.argv[argIdx + 1] : (process.env.GITHUB_BASE_REF || "main");

  for (const candidato of [`origin/${nome}`, nome]) {
    try {
      git(["rev-parse", "--verify", "--quiet", candidato]);
      return candidato;
    } catch {
      /* tenta o próximo */
    }
  }
  throw new Error(
    `Não encontrei a branch base "${nome}" nem "origin/${nome}". ` +
    `No CI isso costuma ser fetch-depth insuficiente no actions/checkout.`
  );
}

/**
 * Parser de diff unificado. Devolve as linhas ADICIONADAS com o número de
 * linha real no arquivo novo — sem isso as anotações do GitHub apontam pro
 * lugar errado e ninguém confia no check.
 */
function lerLinhasAdicionadas(base) {
  const diff = git(["diff", "--unified=0", `${base}...HEAD`]);
  const adicionadas = [];
  let arquivoAtual = null;
  let linhaAtual = 0;

  for (const linha of diff.split("\n")) {
    if (linha.startsWith("+++ ")) {
      const caminho = linha.slice(4).trim();
      arquivoAtual = caminho === "/dev/null" ? null : caminho.replace(/^b\//, "");
      continue;
    }
    if (linha.startsWith("@@")) {
      // @@ -12,3 +45,7 @@  →  a próxima linha adicionada é a 45
      const m = linha.match(/@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (m) linhaAtual = Number(m[1]);
      continue;
    }
    if (!arquivoAtual || ehIgnorado(arquivoAtual)) continue;

    if (linha.startsWith("+") && !linha.startsWith("+++")) {
      adicionadas.push({ arquivo: arquivoAtual, linha: linhaAtual, texto: linha.slice(1) });
      linhaAtual += 1;
    }
    // Com --unified=0 não há linhas de contexto; removidas não avançam o
    // contador do arquivo novo.
  }
  return adicionadas;
}

function lerArquivosPorStatus(base, filtro) {
  const saida = git(["diff", "--name-only", `--diff-filter=${filtro}`, `${base}...HEAD`]);
  return saida.split("\n").map((s) => s.trim()).filter(Boolean);
}

// ------------------------------------------------------------------- as regras

const violacoes = [];
const dispensas = [];

const base = resolverBase();
const adicionadas = lerLinhasAdicionadas(base);
const tituloPR = process.env.PR_TITLE || "";

// --- justificativa por linha --------------------------------------------------
//
// Algumas regras pegam casos legítimos que só o autor consegue julgar. O
// exemplo real: uma migration removeu um catálogo criado na migration anterior,
// com a tabela ainda vazia, porque o desenho estava errado. A R2 acusou com
// razão, mas a única saída era a label pular-revisao-ia, que desliga a revisão
// INTEIRA — inclusive a parte de RLS, que é a que mais importa. Canhão para
// matar mosquito.
//
// Agora dá para justificar UMA ocorrência, ao lado do código, escrevendo:
//
//   -- portaria-ok: R2 — tabela criada em 20260909000001, ainda vazia
//   DROP TABLE IF EXISTS public.malote_analista;
//
// A justificativa fica versionada junto da migration, que é onde o próximo
// leitor vai procurar. Vale para a linha seguinte ou para a própria linha.
//
// Só R2 e R3 aceitam. Segredo (R5/R6), RLS desligada (R1) e migration editada
// (R4) não se justificam com comentário — se pudessem, a regra não seria
// absoluta, seria sugestão.
const ACEITA_JUSTIFICATIVA = new Set(["R2", "R3"]);
const RE_JUSTIFICATIVA = /portaria-ok:\s*(R\d)\s*[—–-]\s*(.+)/i;

const justificativas = new Map(); // "arquivo:linha" -> { regra, motivo }
for (const l of adicionadas) {
  const m = l.texto.match(RE_JUSTIFICATIVA);
  if (m) {
    justificativas.set(`${l.arquivo}:${l.linha}`, {
      regra: m[1].toUpperCase(),
      motivo: m[2].trim(),
    });
  }
}

/** Procura justificativa na própria linha ou na imediatamente acima. */
function buscarJustificativa(regra, arquivo, linha) {
  if (!ACEITA_JUSTIFICATIVA.has(regra)) return null;
  for (const alvo of [linha, linha - 1]) {
    const j = justificativas.get(`${arquivo}:${alvo}`);
    if (j && j.regra === regra) return j;
  }
  return null;
}

function reprovar(regra, arquivo, linha, mensagem, evidencia) {
  const j = buscarJustificativa(regra, arquivo, linha);
  if (j) {
    dispensas.push({ regra, arquivo, linha, motivo: j.motivo });
    return;
  }
  violacoes.push({ regra, arquivo, linha, mensagem, evidencia: (evidencia || "").trim().slice(0, 200) });
}

// Linhas SQL já sem comentário. As regras R1–R3 e R7 rodam sobre isto; R5
// (segredo) roda sobre o texto cru, porque chave vazada em comentário vaza
// exatamente igual.
const sql = adicionadas
  .filter((l) => /\.sql$/i.test(l.arquivo))
  .map((l) => ({ ...l, texto: codigoSQL(l.texto) }))
  .filter((l) => l.texto.trim() !== "");

// --- R1: nunca desabilitar RLS ------------------------------------------------
// 0 ocorrências em 675 migrations. Bloqueio limpo, sem falso positivo possível.
for (const l of sql) {
  if (/DISABLE\s+ROW\s+LEVEL\s+SECURITY/i.test(l.texto)) {
    reprovar("R1", l.arquivo, l.linha,
      "Desabilitar RLS expõe a tabela inteira a qualquer usuário autenticado.", l.texto);
  }
}

// --- R2: DROP TABLE só em tabela temporária -----------------------------------
// Histórico do repo: DROP TABLE aparece em tmp_* e sup_imp_* (carga/importação).
// Em tabela de negócio sempre foi decisão consciente — então exige justificativa.
//
// Recriar a tabela na mesma PR não conta como remoção: mudar a forma de uma
// tabela com DROP + CREATE é padrão normal aqui. Mesma lógica de saldo que a R3
// aplica em policies — o que importa é a tabela sumir, não o comando aparecer.
const tabelasCriadas = new Set();
for (const l of sql) {
  for (const m of l.texto.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([^\s;(]+)/gi)) {
    tabelasCriadas.add(normalizarIdentificador(m[1]));
  }
}

for (const l of sql) {
  for (const m of l.texto.matchAll(/DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?([^\s;(]+)/gi)) {
    const tabela = normalizarIdentificador(m[1]);
    if (/^(tmp_|sup_imp_)/.test(tabela)) continue;
    if (tabelasCriadas.has(tabela)) continue;

    reprovar("R2", l.arquivo, l.linha,
      `DROP TABLE em "${tabela}", que não é temporária (tmp_* / sup_imp_*) e não é ` +
      `recriada nesta PR. Se a remoção é intencional, escreva na linha acima do DROP: ` +
      `-- portaria-ok: R2 — <motivo> (ex.: tabela criada na migration anterior, ainda vazia).`,
      l.texto);
  }
}

// --- R3: DROP POLICY exige CREATE POLICY correspondente -----------------------
// 1296 DROP POLICY no histórico: drop+create é a rotina de manutenção de RLS
// aqui. Bloquear DROP POLICY direto travaria praticamente toda migration.
// O que importa é o saldo — policy removida e não recriada reduz proteção.
const dropadas = new Map();
const criadas = new Set();
const reDrop = /DROP\s+POLICY\s+(?:IF\s+EXISTS\s+)?("(?:[^"]*)"|[A-Za-z_][A-Za-z0-9_]*)\s+ON\s+([^\s;]+)/gi;
const reCreate = /CREATE\s+POLICY\s+("(?:[^"]*)"|[A-Za-z_][A-Za-z0-9_]*)\s+ON\s+([^\s;]+)/gi;

for (const l of sql) {
  for (const m of l.texto.matchAll(reDrop)) {
    const chave = `${normalizarIdentificador(m[1])}@${normalizarIdentificador(m[2])}`;
    if (!dropadas.has(chave)) dropadas.set(chave, l);
  }
  for (const m of l.texto.matchAll(reCreate)) {
    criadas.add(`${normalizarIdentificador(m[1])}@${normalizarIdentificador(m[2])}`);
  }
}
// Comparação vale pra PR inteira, não por arquivo: é normal dropar numa
// migration e recriar na seguinte dentro da mesma entrega.
for (const [chave, l] of dropadas) {
  if (!criadas.has(chave)) {
    const [policy, tabela] = chave.split("@");
    reprovar("R3", l.arquivo, l.linha,
      `A policy "${policy}" em "${tabela}" é removida e nunca recriada nesta PR. ` +
      `Se a remoção é intencional, diga no corpo da PR o que passa a proteger a tabela.`, l.texto);
  }
}

// --- R4: migration já mergeada é append-only ----------------------------------
// Migrations não são aplicadas automaticamente no Supabase — elas rodam à mão
// no SQL Editor. Editar uma que já rodou deixa repo e banco divergentes sem
// nenhum sinal: o arquivo mente sobre o estado real do banco.
for (const arquivo of lerArquivosPorStatus(base, "MD")) {
  if (/^supabase\/migrations\/.+\.sql$/i.test(arquivo)) {
    reprovar("R4", arquivo, 1,
      "Esta migration já existe na main e foi modificada ou apagada. " +
      "Migrations são append-only: crie uma nova migration com a correção.", "");
  }
}

// --- R5: segredo de verdade no diff -------------------------------------------
// Não bloqueia .env: ele é versionado de propósito e contém só
// VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY, que são públicos por design num
// app Vite (vão no bundle do navegador de qualquer jeito).
// Os padrões exigem sufixo longo justamente pra este arquivo e o REGRAS-PR.md
// poderem citar os prefixos sem se auto-reprovarem.
for (const l of adicionadas) {
  if (/sk-ant-[A-Za-z0-9_-]{20,}/.test(l.texto)) {
    reprovar("R5", l.arquivo, l.linha, "Chave da Anthropic no código. Revogue em console.anthropic.com.", l.texto);
  }
  if (/\bghp_[A-Za-z0-9]{36}\b/.test(l.texto) || /\bgithub_pat_[A-Za-z0-9_]{50,}\b/.test(l.texto)) {
    reprovar("R5", l.arquivo, l.linha, "Token do GitHub no código. Revogue em github.com/settings/tokens.", l.texto);
  }
  if (/SUPABASE_SERVICE_ROLE_KEY\s*=\s*["']?ey[A-Za-z0-9_-]{10,}/.test(l.texto)) {
    reprovar("R5", l.arquivo, l.linha, "Chave service_role atribuída no código. Ela pertence a Edge Function secret.", l.texto);
  }

  // JWT do Supabase: decodifica o payload em vez de casar string, pra
  // distinguir a anon key (pública, tudo bem) da service_role (nunca).
  for (const m of l.texto.matchAll(/\beyJ[A-Za-z0-9_-]{10,}\.([A-Za-z0-9_-]{10,})\.[A-Za-z0-9_-]{10,}\b/g)) {
    try {
      const payload = Buffer.from(m[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
      if (/"role"\s*:\s*"service_role"/.test(payload)) {
        reprovar("R5", l.arquivo, l.linha,
          "Chave service_role do Supabase exposta. Ela ignora TODA a RLS — rotacione em " +
          "Supabase → Settings → API antes de qualquer outra coisa.", "<JWT omitido>");
      }
    } catch {
      /* não era base64 válido; segue */
    }
  }
}

// --- R6: service_role nunca no front ------------------------------------------
// Só é legítimo em supabase/functions/**, onde roda no servidor. Comentário
// não conta — hoje a única ocorrência em src/ é um comentário afirmando que
// aquele hook NÃO usa service_role.
for (const l of adicionadas) {
  if (!l.arquivo.startsWith("src/")) continue;
  if (ehComentario(l.texto)) continue;
  if (/service_role/i.test(l.texto)) {
    reprovar("R6", l.arquivo, l.linha,
      "service_role em código do front. O bundle vai pro navegador — a chave viraria pública " +
      "e daria acesso total ignorando a RLS. Mova pra uma Edge Function.", l.texto);
  }
}

// --- R7: função admin_* exige chamado -----------------------------------------
// admin_exec_dml executa DML arbitrário; as demais admin_* mexem em vínculo de
// usuário, empresa e sessão. Mudança nelas precisa de rastro no ERP.
if (/^\[SEM-CHAMADO\]/.test(tituloPR)) {
  for (const l of sql) {
    const m = l.texto.match(/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\.)?(admin_[a-z0-9_]+)/i);
    if (m) {
      reprovar("R7", l.arquivo, l.linha,
        `A função "${m[1]}" é privilegiada e está sendo alterada numa PR [SEM-CHAMADO]. ` +
        `Abra um chamado e use o número no título pra deixar rastro.`, l.texto);
    }
  }
}

// --- R8: só as 4 branches combinadas, sem exceção ----------------------------
// O time tem 3 devs, cada um com a sua branch, e a main. Zero-tolerância: só
// essas 4 nomes existem, nunca mais. A versão anterior desta regra abria
// exceção para branch temporária com prefixo ci/fix/chore — foi apertada
// depois que uma dessas exceções (fix/aviso-veredito-causa-certa) ficou aberta
// como PR ao mesmo tempo que a própria regra que a permitia estava sendo
// revista, o que deixou claro que qualquer exceção é uma porta que se abre de
// novo. Nomenclatura é verificável, então não tem por que deixar isso no
// julgamento do modelo.
const BRANCHES_FIXAS = ["eduardo", "joao", "pablo", "main"];

// GITHUB_HEAD_REF é a branch de origem da PR; fora do CI, a branch atual.
let branch = process.env.GITHUB_HEAD_REF || "";
if (!branch) {
  try {
    branch = git(["rev-parse", "--abbrev-ref", "HEAD"]).trim();
  } catch {
    branch = "";
  }
}

if (branch && !BRANCHES_FIXAS.includes(branch)) {
  reprovar("R8", ".github/REGRAS-PR.md", 1,
    `A branch "${branch}" não está no combinado. Só existem eduardo, joao, pablo e main — ` +
    `sem exceção, nem para correção de workflow ou infraestrutura. Cada dev trabalha na ` +
    `própria branch e abre PR para a main a partir dela.`,
    "");
}

// ------------------------------------------------------------------ resultado

const arquivosAnalisados = new Set(adicionadas.map((l) => l.arquivo)).size;

console.log(`Portaria: base ${base}, ${arquivosAnalisados} arquivo(s) com linhas novas, ` +
            `${adicionadas.length} linha(s) adicionada(s) analisada(s).`);

for (const v of violacoes) {
  // Formato de anotação do Actions: aparece direto no diff da PR.
  console.log(`::error file=${v.arquivo},line=${v.linha},title=Portaria ${v.regra}::${v.mensagem}`);
  console.log(`  ${v.regra} — ${v.arquivo}:${v.linha}`);
  console.log(`     ${v.mensagem}`);
  if (v.evidencia) console.log(`     > ${v.evidencia}`);
}

writeFileSync(
  "portaria-resultado.json",
  JSON.stringify({ base, arquivosAnalisados, violacoes }, null, 2)
);

// O que fazer para destravar, por regra. Sem isto o autor vê "R4 reprovou" e
// fica sem saber o próximo passo — a mensagem diz o que está errado, não como
// sair. Cada texto é uma instrução executável, não um conselho genérico.
const COMO_RESOLVER = {
  R1: "Remova o `DISABLE ROW LEVEL SECURITY`. Se esta tabela precisa mesmo ficar sem RLS, " +
      "isso é decisão de arquitetura e não cabe numa PR — discuta antes com o time.",
  R2: "Se a tabela é de carga/importação, renomeie com prefixo `tmp_` ou `sup_imp_`. " +
      "Se o DROP é intencional numa tabela de negócio, aplique a label `pular-revisao-ia` " +
      "e explique no corpo da PR por que a tabela pode sumir.",
  R3: "Acrescente o `CREATE POLICY` correspondente em algum arquivo desta PR. Se a remoção " +
      "é intencional, escreva no corpo da PR o que passa a proteger a tabela no lugar.",
  R4: "Reverta este arquivo (`git checkout origin/main -- <arquivo>`) e crie uma migration " +
      "NOVA com a correção. A migration antiga já rodou no banco de produção — editá-la faz " +
      "o repositório mentir sobre o estado real do Supabase.",
  R5: "**Rotacione a credencial agora**, antes de mexer no diff: Supabase → Settings → API, " +
      "ou o painel do serviço correspondente. Remover do código não resolve, porque o valor " +
      "já está no histórico do git. Depois de rotacionar, tire do código e use um secret.",
  R6: "Mova esta chamada para uma Edge Function em `supabase/functions/`. Código em `src/` vai " +
      "para o bundle do navegador, então a chave viraria pública para qualquer visitante.",
  R7: "Abra um chamado no ERP e use o número no título da PR (`SIS-XXXX-XXXX: ...`). " +
      "Funções `admin_*` mexem em vínculo de usuário, empresa e sessão — precisam de rastro.",
  R8: "Mova o trabalho para a sua branch pessoal (`eduardo`, `joao` ou `pablo`) e abra a PR " +
      "a partir dela. Só essas três e a `main` existem, sem exceção.",
};

if (violacoes.length > 0) {
  const porRegra = new Map();
  for (const v of violacoes) {
    if (!porRegra.has(v.regra)) porRegra.set(v.regra, []);
    porRegra.get(v.regra).push(v);
  }

  const linhas = [
    `## Portaria reprovou: ${violacoes.length} violação(ões)`,
    "",
    "Estas são **regras absolutas** — verificadas por script, sem IA. Enquanto o check " +
      "estiver vermelho, a PR não deve ser mergeada.",
    "",
  ];

  for (const [regra, lista] of porRegra) {
    linhas.push(`### ${regra}`, "");
    for (const v of lista) {
      linhas.push(`- \`${v.arquivo}:${v.linha}\` — ${v.mensagem}`);
      if (v.evidencia) {
        // Linguagem pela extensão: marcar TypeScript como sql quebra o
        // destaque de sintaxe e faz o comentário parecer descuidado.
        const ext = v.arquivo.split(".").pop()?.toLowerCase();
        const lang = ext === "sql" ? "sql"
                   : ext === "ts" || ext === "tsx" ? "ts"
                   : ext === "js" || ext === "jsx" || ext === "mjs" ? "js"
                   : "";
        linhas.push("", `  \`\`\`${lang}`, `  ${v.evidencia}`, "  ```");
      }
    }
    linhas.push("", `**Como resolver:** ${COMO_RESOLVER[regra] || "Ver `.github/REGRAS-PR.md`."}`, "");
  }

  linhas.push(
    "---",
    "",
    "**Se a regra é que está errada para este caso**, mude o `.github/REGRAS-PR.md` — mas " +
      "numa PR separada, porque mudança de regra também passa por revisão. Não contorne com " +
      "a label sem antes considerar se a regra deveria mudar para todo mundo.",
  );

  writeFileSync("portaria-comentario.md", linhas.join("\n"));
}

// Dispensas são registradas mesmo quando a portaria passa: justificativa que
// ninguém revisa vira carimbo, e o revisor humano precisa ver que uma regra
// absoluta foi contornada e com qual motivo.
if (dispensas.length > 0) {
  console.log(`\n${dispensas.length} justificativa(s) aceita(s):`);
  for (const d of dispensas) {
    console.log(`  ${d.regra} dispensada em ${d.arquivo}:${d.linha} — ${d.motivo}`);
  }

  writeFileSync("portaria-comentario.md", linhas.join("\n"));
}

if (violacoes.length > 0) {
  console.log(`\nPortaria reprovou: ${violacoes.length} violação(ões) de regra absoluta.`);
  process.exit(1);
}
console.log("\nPortaria aprovou: nenhuma regra absoluta violada.");
