// ============================================================================
//  CATRACA DO LINT — o número de erros não pode SUBIR (04/11/2026)
//
//  Uso:
//    node .github/scripts/catraca-lint.mjs --resumir lint.json --para base.json
//    node .github/scripts/catraca-lint.mjs --atual lint-da-pr.json --baseline base.json
//
//  POR QUE CATRACA, E NÃO LINT OBRIGATÓRIO
//  A base tem ~2.585 erros de lint. Exigir lint limpo hoje deixaria TODA PR
//  vermelha no primeiro minuto e o time desligaria o check na primeira semana
//  (é o que o cabeçalho do ci.yml já dizia). Mas faltava a outra metade: nada
//  impedia o número de CRESCER. A catraca resolve as duas coisas — ninguém
//  paga a dívida antiga, e ninguém acrescenta dívida nova.
//
//  COMO O NÚMERO DA MAIN APARECE AQUI
//  O lint do repositório inteiro é caro (minutos), então ele roda UMA VEZ por
//  merge, no push da main, e o resultado por arquivo vai para o cache do
//  Actions. A PR linta só os arquivos que ela mexeu e compara com aquele
//  número. Cache escrito na main é visível para todas as PRs.
//
//  ARQUIVO NOVO NÃO É COBRADO, de propósito: ele não tem número na main, e
//  exigir zero num arquivo novo esbarraria no `any` que está em toda parte —
//  seria a mesma PR vermelha de sempre, com outro nome. O que a catraca
//  garante é que arquivo TOCADO não piora.
// ============================================================================
import fs from "node:fs";

const arg = (n, p = null) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : p; };
const normalizar = (p) => p.split("\\").join("/").replace(/^.*?\/(?=src\/|supabase\/|worker\/|infra\/|scripts\/|\.github\/)/, "");

/** Do JSON do eslint (-f json) para { "caminho": erros }. */
export function porArquivo(relatorio) {
  const fora = {};
  for (const f of relatorio) if (f.errorCount) fora[normalizar(f.filePath)] = f.errorCount;
  return fora;
}

/** Arquivos que pioraram em relação à main. */
export function pioras(atual, baseline) {
  return Object.entries(atual)
    .map(([arq, erros]) => ({ arq, erros, antes: baseline[arq] }))
    .filter((p) => p.antes !== undefined && p.erros > p.antes);
}

function principal() {
  const resumir = arg("resumir");
  if (resumir) {
    const fora = porArquivo(JSON.parse(fs.readFileSync(resumir, "utf8")));
    const total = Object.values(fora).reduce((s, n) => s + n, 0);
    fs.writeFileSync(arg("para", "baseline-lint.json"), JSON.stringify({ gerado_em: new Date().toISOString(), total, arquivos: fora }, null, 0));
    console.log(`Baseline do lint: ${total} erro(s) em ${Object.keys(fora).length} arquivo(s).`);
    return 0;
  }

  const atual = porArquivo(JSON.parse(fs.readFileSync(arg("atual"), "utf8")));
  const caminho = arg("baseline");
  if (!caminho || !fs.existsSync(caminho)) {
    console.log("Catraca desligada: não há baseline da main (primeira execução, ou cache expirado). O lint segue informativo.");
    return 0;
  }
  const baseline = JSON.parse(fs.readFileSync(caminho, "utf8")).arquivos ?? {};
  const ruins = pioras(atual, baseline);

  const linhas = ["## Catraca do lint"];
  if (!ruins.length) {
    linhas.push("✅ Nenhum arquivo desta PR tem mais erro de lint do que na `main`.");
  } else {
    linhas.push(`❌ **${ruins.length} arquivo(s) com MAIS erro de lint do que na \`main\`.**`, "");
    for (const p of ruins) {
      linhas.push(`- \`${p.arq}\` — ${p.antes} → **${p.erros}**`);
      console.log(`::error file=${p.arq},title=Catraca do lint::Este arquivo tinha ${p.antes} erro(s) de lint na main e agora tem ${p.erros}. A dívida antiga não é cobrada; a nova é.`);
    }
    linhas.push("", "_A dívida antiga do projeto não é cobrada: a catraca só impede que o número suba no arquivo que você tocou._");
  }
  const resumo = linhas.join("\n");
  console.log(resumo);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, resumo + "\n");
  return ruins.length ? 1 : 0;
}

if (process.argv[1] && process.argv[1].endsWith("catraca-lint.mjs")) process.exit(principal());
