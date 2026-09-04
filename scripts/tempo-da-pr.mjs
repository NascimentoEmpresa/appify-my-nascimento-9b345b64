#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Quanto tempo a pipeline inteira levou numa PR
//
// O GitHub não mostra isso em lugar nenhum. Ele mostra a duração de CADA run
// (Actions → o run → Usage), e como uma PR dispara de 5 a 9 workflows, saber o
// total exige abrir um por um e somar na mão.
//
// Pior: somar na mão dá o número ERRADO para a pergunta que interessa. Os
// workflows rodam ao mesmo tempo, então a soma responde "quanto de runner isso
// consumiu", não "quanto tempo eu esperei". Este script separa os dois:
//
//   ESPERA  do primeiro workflow começar até o último terminar. É o tempo que
//           o dev fica olhando para a tela. É este que a gente quer baixar.
//   MÁQUINA a soma de todos. É o que consome cota de runner. Cai quando se
//           apaga trabalho inútil, não quando se paraleliza.
//
// E os workflows do mesmo commit não vêm todos juntos: uns disparam no push da
// PR e outros só no merge (Notify Discord, Concluir Chamado no merge). Medir do
// primeiro ao último sem separar contava as horas de revisão humana entre eles
// como se fossem espera de pipeline. Por isso o script agrupa em ONDAS: runs
// que começam com menos de 3 minutos de intervalo são a mesma onda.
//
// Uso:
//   npm run tempo            (a PR da branch atual)
//   npm run tempo 510        (uma PR específica)
//   npm run tempo 510 --tudo (todos os commits da PR, não só o do topo)
//
// Precisa do gh autenticado (`gh auth status`).
// ---------------------------------------------------------------------------

import { execFileSync } from "node:child_process";

const REPO = "NascimentoEmpresa/appify-my-nascimento-9b345b64";
const INTERVALO_DA_ONDA_S = 180;

function gh(caminho) {
  return JSON.parse(
    execFileSync("gh", ["api", caminho], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 }),
  );
}

function ghPr(args) {
  const saida = execFileSync("gh", ["pr", ...args], { encoding: "utf8" });
  return saida.trim() ? JSON.parse(saida) : null;
}

function duracao(segundos) {
  if (segundos == null) return "—";
  if (segundos < 60) return `${segundos}s`;
  return `${Math.floor(segundos / 60)}min${String(segundos % 60).padStart(2, "0")}`;
}

const seg = (a, b) => Math.round((new Date(b) - new Date(a)) / 1000);
const hora = (d) => new Date(d).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

// --- argumentos ------------------------------------------------------------
const args = process.argv.slice(2);
const tudo = args.includes("--tudo");
const numero = args.find((a) => /^\d+$/.test(a));
const campos = "number,title,headRefOid,commits,state";

const pr = numero
  ? ghPr(["view", numero, "--repo", REPO, "--json", campos])
  : ghPr(["view", "--json", campos]);

if (!pr) {
  console.error("Nenhuma PR para a branch atual. Passe o número: npm run tempo 510");
  process.exit(1);
}

const commits = [...pr.commits].reverse();
const alvos = tudo ? commits : [commits[0]];

console.log(`\nPR #${pr.number} — ${pr.title}`);
console.log(`${pr.state.toLowerCase()} · ${commits.length} commit(s) na branch\n`);

let esperaTotal = 0;
let maquinaTotal = 0;
let ondasTotal = 0;

for (const commit of alvos) {
  const sha = commit.oid;
  const { workflow_runs: runs } = gh(
    `repos/${REPO}/actions/runs?head_sha=${sha}&per_page=100`,
  );

  console.log(`  ${sha.slice(0, 8)}  ${commit.messageHeadline.slice(0, 58)}`);
  console.log(`  ${"─".repeat(72)}`);

  if (!runs.length) {
    console.log("  (nenhum workflow disparado)\n");
    continue;
  }

  // Agrupa em ondas: corta onde há mais de 3 min de silêncio entre um começo
  // e o seguinte. Separa o que rodou no push do que rodou no merge.
  const ordenados = runs
    .map((r) => ({
      nome: r.name,
      estado: r.status === "completed" ? r.conclusion : r.status,
      inicio: r.created_at,
      fim: r.updated_at,
      segundos: seg(r.created_at, r.updated_at),
    }))
    .sort((a, b) => new Date(a.inicio) - new Date(b.inicio));

  const ondas = [[ordenados[0]]];
  for (const r of ordenados.slice(1)) {
    const anterior = ondas.at(-1).at(-1);
    if (seg(anterior.inicio, r.inicio) > INTERVALO_DA_ONDA_S) ondas.push([r]);
    else ondas.at(-1).push(r);
  }

  for (const [i, onda] of ondas.entries()) {
    const inicio = new Date(Math.min(...onda.map((l) => new Date(l.inicio))));
    const fim = new Date(Math.max(...onda.map((l) => new Date(l.fim))));
    const espera = Math.round((fim - inicio) / 1000);
    const maquina = onda.reduce((s, l) => s + l.segundos, 0);
    const rodando = onda.filter((l) => l.estado !== "success" && l.estado !== "failure" && l.estado !== "cancelled");

    esperaTotal += espera;
    maquinaTotal += maquina;
    ondasTotal += 1;

    const rotulo = ondas.length > 1 ? `onda ${i + 1} de ${ondas.length} · ` : "";
    console.log(`  ${rotulo}${hora(inicio)} → ${hora(fim)}`);
    console.log(`    ESPERA   ${duracao(espera).padEnd(9)} do primeiro começar ao último terminar`);
    console.log(`    MÁQUINA  ${duracao(maquina).padEnd(9)} soma dos ${onda.length} workflow(s)`);
    if (rodando.length) console.log(`    (${rodando.length} ainda rodando — o número sobe)`);
    console.log();

    const maior = Math.max(...onda.map((l) => l.segundos), 1);
    for (const l of [...onda].sort((a, b) => b.segundos - a.segundos)) {
      const barra = "█".repeat(Math.max(1, Math.round((l.segundos / maior) * 24)));
      const marca = l.estado === "success" ? " " : l.estado === "cancelled" ? "~" : "!";
      console.log(`     ${marca} ${duracao(l.segundos).padStart(7)}  ${barra.padEnd(24)}  ${l.nome}`);
    }
    console.log();
  }
}

if (ondasTotal > 1) {
  console.log(`  ${"═".repeat(72)}`);
  console.log(`  ESPERA somada das ${ondasTotal} ondas: ${duracao(esperaTotal)}`);
  console.log(`  MÁQUINA somada:${" ".repeat(String(ondasTotal).length + 8)}${duracao(maquinaTotal)}\n`);
}

console.log("  legenda:  (vazio) passou   ~ cancelado   ! falhou ou ainda rodando\n");
