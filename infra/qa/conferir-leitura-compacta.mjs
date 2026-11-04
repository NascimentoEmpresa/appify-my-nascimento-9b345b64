// ============================================================================
//  PROVA: fluxo_caixa_ler_fonte_compacta devolve EXATAMENTE o mesmo que
//  fluxo_caixa_ler_fonte, para cada usuário e cada fonte (04/11/2026)
//
//  Uso:  node infra/qa/conferir-leitura-compacta.mjs <uuid-usuario> [<uuid> ...]
//
//  Funciona ANTES de a migration ser aplicada: o bloco GERADOR é extraído do
//  próprio arquivo da migration (o mesmo texto que vai para o banco) e
//  executado na produção como `authenticated`, com o JWT do usuário, numa
//  transação desfeita no fim. Nada é gravado.
//
//  Para cada (usuário, fonte): lê pelo formato antigo e pelo novo, remonta o
//  novo com src/lib/leituraCompacta.ts e compara como CONJUNTO de linhas
//  (ordem não importa — nenhuma das duas tem ORDER BY; o hook reordena),
//  cada linha com todos os campos. Imprime linhas, tamanho e tempo.
//  Sai com 1 se qualquer comparação divergir.
// ============================================================================
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");
const MIG = path.join(RAIZ, "supabase/migrations/20261104000100_fluxo_caixa_leitura_compacta.sql");
// [fonte, ordem como a função manda (ou null), coluna dessa ordem]
const FONTES = [
  ...["v_malote_pagamento_fluxo_caixa", "v_malote_pagamento_fluxo_caixa_consolidado",
    "v_debito_automatico_fluxo_caixa", "v_cartao_fatura_fluxo_caixa",
    "v_aplicacao_financeira_fluxo_caixa", "v_aplicacao_financeira_resgate_fluxo_caixa",
    "v_fluxo_caixa_importado_fluxo_caixa", "v_fluxo_caixa_previsto"].map((f) => [f, null, null]),
  ["planilha_custo", "b.created_at DESC", "created_at"],
  ["v_malote_utilizado_orcamento", "b.data_pagamento DESC", "data_pagamento"],
];
const usuarios = process.argv.slice(2);
if (!usuarios.length) { console.error("uso: node conferir-leitura-compacta.mjs <uuid-usuario> ..."); process.exit(1); }

// o decodificador é o MESMO que o navegador usa (compilado na hora pelo esbuild do Vite)
const { build } = await import(pathToFileURL(path.join(RAIZ, "node_modules/esbuild/lib/main.js")).href);
const saidaJs = path.join(RAIZ, "node_modules/.cache/leituraCompacta.mjs");
await build({ entryPoints: [path.join(RAIZ, "src/lib/leituraCompacta.ts")], outfile: saidaJs, format: "esm", bundle: true, platform: "node", logLevel: "silent" });
const { decodificarCompacto } = await import(pathToFileURL(saidaJs).href);

const sqlMig = fs.readFileSync(MIG, "utf8");
const gerador = sqlMig.split("-- GERADOR-INICIO")[1].split("-- GERADOR-FIM")[0].split("\n").slice(1).join("\n");

// desc com NULLS FIRST (o padrão do Postgres para DESC): null vem antes de tudo
const cmpDesc = (x, y) => (x === y ? 0 : x === null ? -1 : y === null ? 1 : x > y ? -1 : 1);
const canon = (o) => JSON.stringify(Object.keys(o).sort().map((k) => [k, o[k]]));
let divergiu = false;
console.log("usuário   fonte                                         linhas   antes        depois   redução  ms antes  ms depois  igual");
for (const u of usuarios) {
  let script = "\\set ON_ERROR_STOP on\n\\timing on\nBEGIN;\nSET LOCAL ROLE authenticated;\n";
  script += `SELECT set_config('request.jwt.claims', '${JSON.stringify({ sub: u, role: "authenticated" })}', true) \\g /dev/null\n`;
  for (const [f, ordem] of FONTES) {
    const sqlGerador = gerador.replaceAll("$1", `'${f}'`).replaceAll("$2", ordem ? `'${ordem}'` : "NULL::text");
    script += `\\echo @@@ ${f} antigo\nSELECT coalesce(json_agg(t), '[]'::json) FROM public.${f} t;\n`;
    script += `\\echo @@@ ${f} novo\nSELECT (${sqlGerador}) \\gexec\n`;
  }
  script += "ROLLBACK;\n";
  const r = spawnSync("ssh", ["-o", "BatchMode=yes", "-p", "8443", "root@216.238.120.171", "sudo -u postgres psql -X -At -q"], { input: script, maxBuffer: 1 << 30 });
  if (r.status !== 0) { console.error(String(r.stderr).slice(0, 2000)); process.exit(1); }
  const partes = String(r.stdout).split("@@@ ").slice(1);
  for (let i = 0; i < partes.length; i += 2) {
    const [cab1, ...c1] = partes[i].split("\n"), [, ...c2] = partes[i + 1].split("\n");
    const fonte = cab1.split(" ")[0];
    const tempo = (ls) => Number((ls.find((l) => l.startsWith("Time:")) || "Time: 0").split(" ")[1]);
    const json = (ls) => ls.filter((l) => l && !l.startsWith("Time:")).join("\n");
    const antigoTxt = json(c1), novoTxt = json(c2);
    const antigo = JSON.parse(antigoTxt), novo = decodificarCompacto(JSON.parse(novoTxt));
    const a = antigo.map(canon).sort(), b = novo.map(canon).sort();
    // fonte ordenada: além do mesmo conjunto, a ordem tem de ser decrescente pela coluna
    const colOrdem = FONTES.find(([x]) => x === fonte)[2];
    const ordemOk = !colOrdem || novo.every((l, k) => k === 0 || cmpDesc(novo[k - 1][colOrdem], l[colOrdem]) <= 0);
    if (!ordemOk) console.log("   ORDEM QUEBRADA em", fonte);
    const igual = a.length === b.length && a.every((x, k) => x === b[k]) && ordemOk;
    if (!igual) divergiu = true;
    const kb = (s) => `${(s.length / 1024).toFixed(0)} kB`.padStart(9);
    console.log(`${u.slice(0, 8)}  ${fonte.padEnd(44)} ${String(antigo.length).padStart(6)} ${kb(antigoTxt)} → ${kb(novoTxt)}  ${antigoTxt.length ? (100 - 100 * novoTxt.length / antigoTxt.length).toFixed(0).padStart(5) + "%" : "    -"}  ${tempo(c1).toFixed(0).padStart(8)}  ${tempo(c2).toFixed(0).padStart(9)}  ${igual ? "SIM" : "NÃO ← DIVERGIU"}`);
    if (!igual) {
      const sa = new Set(a), sb = new Set(b);
      console.log("   só no antigo:", a.filter((x) => !sb.has(x)).slice(0, 2), "\n   só no novo:", b.filter((x) => !sa.has(x)).slice(0, 2));
    }
  }
}
console.log(divergiu ? "\nDIVERGÊNCIA — não aplicar." : "\nIDÊNTICO em todas as fontes e usuários.");
process.exit(divergiu ? 1 : 0);
