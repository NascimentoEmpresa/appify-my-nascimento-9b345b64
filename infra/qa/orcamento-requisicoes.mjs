// ============================================================================
//  QA AUTOMÁTICO: ORÇAMENTO DE REQUISIÇÕES POR TELA (item 13, 03/11/2026)
//
//  Uso (CI ou local, com a build servida em --base):
//    PLAYWRIGHT=<node_modules/playwright> node infra/qa/orcamento-requisicoes.mjs \
//      --base http://localhost:4173 [--so /app/malote] [--abertura 60] [--paralelo 6]
//
//  O QUE PROVA, SEM TOCAR NA PRODUÇÃO
//  A API é FALSA: o Playwright intercepta toda chamada ao Supabase e responde
//  vazio na hora. Assim o teste mede o COMPORTAMENTO do frontend, não o banco:
//    1. ABERTURA — quantas requisições a tela faz para abrir. Acima de
//       --abertura (padrão 60) reprova: em 03/11/2026 o boot real eram ~36,
//       com profiles lido 7 vezes.
//    2. PARADA — depois de aberta, o relógio da página é ADIANTADO 10 minutos
//       (page.clock.runFor): todo setInterval, refetchInterval e setTimeout
//       encadeado dispara como se 10 min tivessem passado. QUALQUER requisição
//       nessa janela é busca automática e reprova (regra do item 5: só busca
//       quando o usuário pede). É o que pega o polling escondido que nenhuma
//       regra estática enxerga.
//
//  ---------------------------------------------------------------------------
//  04/11/2026 — três coisas que este arquivo passou a provar
//
//  3. TELA QUEBRADA REPROVA. Antes o job media só QUANTIDADE de requisição, e
//     tela que explode no render faz MENOS requisição que a tela sadia: ela
//     passava com folga. Agora `console.error`, exceção de página, resposta
//     >= 400 e `#root` vazio reprovam. O ErrorBoundary do projeto
//     (src/components/layout/ErroDeTela.tsx) grava "[ErroDeTela] falha ao
//     renderizar a tela" no console, então toda tela que cai na rede de
//     segurança é pega aqui. É o `infra/qa/varrer-telas.mjs` (que só rodava à
//     mão, contra a produção) trazido para dentro do CI, na mesma build e no
//     mesmo navegador: custo adicional ~zero.
//
//  4. CONTRATO DE REDE. Toda requisição é inspecionada ANTES de responder: GET
//     numa das tabelas grandes (.github/tabelas-grandes.json) sem `limit`,
//     sem `Range` e sem filtro por `id`, ou com `select=*`, REPROVA. Isso é o
//     complemento das regras D5/D6 do guardião, que são regex em cima do
//     código e por isso só veem `.from("NOME")` literal. Aqui observamos o que
//     SAIU PELA REDE, então pega o nome de tabela em variável, a chamada
//     dentro de hook, a montada por biblioteca e a de Edge Function chamada
//     pela tela. O que escapa do texto não escapa do fio.
//
//  5. CATRACA POR TELA. Com `--baseline orcamento-da-main.json`, a tela que
//     piorar em relação à main reprova mesmo dentro do teto absoluto — uma
//     tela de 20 requisições não pode virar 59 em silêncio. O baseline é o
//     próprio JSON de saída, publicado a cada push na main.
//  ---------------------------------------------------------------------------
//
//  Sai com código 1 se alguma tela reprovar, listando a tela, o motivo e as
//  URLs que saíram sozinhas.
// ============================================================================
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { violacaoDeContrato } from "./contrato-de-rede.mjs";

const arg = (n, p) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : p; };
const BASE = arg("base", "http://localhost:4173");
const SO = arg("so", null);
const ABERTURA = Number(arg("abertura", 60));
const PARALELO = Number(arg("paralelo", 6));
const SAIDA = arg("saida", "orcamento-requisicoes.json");
const BASELINE = arg("baseline", null);
// Folga da catraca: a tela só reprova se passar dos DOIS (número absoluto e
// percentual). Tela de 4 requisições oscila 1-2 por timing de render; tela de
// 40 não pula para 50 por acidente.
const FOLGA_ABS = Number(arg("folga-abs", 8));
const FOLGA_PCT = Number(arg("folga-pct", 25));
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT ?? "playwright");

const app = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "../../src/App.tsx"), "utf8");
const blocoApp = app.slice(app.indexOf('<Route path="/app"'));
const rotas = [...new Set([...blocoApp.matchAll(/<Route path="([^"]+)"/g)].map((m) => m[1])
  .filter((p) => !p.includes(":") && !p.includes("*"))
  .map((p) => (p.startsWith("/") ? p : `/app/${p}`))
  .filter((p) => p.startsWith("/app/") && (!SO || p.startsWith(SO))))].sort();

// sessão falsa: o JWT não é verificado por ninguém (a API é falsa)
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const agora = Math.floor(Date.now() / 1000);
const USER = { id: "00000000-0000-4000-8000-000000000001", email: "qa@teste.local", aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: { nome: "QA" } };
const jwt = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: USER.id, role: "authenticated", aud: "authenticated", exp: agora + 7200, iat: agora })}.qa`;
const sessao = JSON.stringify({ access_token: jwt, token_type: "bearer", expires_in: 7200, expires_at: agora + 7200, refresh_token: "qa", user: USER });

const ehApi = (u) => /\/(rest|auth|storage|functions)\/v1\//.test(u);

function respostaFalsa(url) {
  if (url.includes("/auth/v1/user")) return { status: 200, body: JSON.stringify(USER) };
  if (url.includes("/auth/v1/")) return { status: 200, body: JSON.stringify({ ...JSON.parse(sessao) }) };
  if (url.includes("/rpc/sistema_saude")) return { status: 200, body: "true" };
  if (url.includes("/rest/v1/rpc/")) return { status: 200, body: "[]" };
  if (url.includes("/rest/v1/")) return { status: 200, body: "[]", headers: { "content-range": "*/0" } };
  return { status: 200, body: "{}" };
}

// ── baseline da main, para a catraca por tela ───────────────────────────────
// É o próprio JSON de saída de uma execução anterior (o workflow publica o da
// main a cada merge). Ausente ou ilegível = sem catraca, só o teto absoluto:
// baseline que falta não pode virar motivo de PR vermelha.
const BASE_POR_ROTA = new Map();
if (BASELINE) {
  try {
    for (const r of JSON.parse(fs.readFileSync(BASELINE, "utf8")).resultados ?? []) {
      if (typeof r.abertura === "number" && !r.problemas?.length) BASE_POR_ROTA.set(r.rota, r.abertura);
    }
    console.log(`Catraca: baseline de ${BASE_POR_ROTA.size} tela(s) lido de ${BASELINE}.`);
  } catch (e) {
    console.log(`Catraca desligada: não deu para ler ${BASELINE} (${e.message}).`);
  }
}

const navegador = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
const resultados = [];
async function testar(rota) {
  const ctx = await navegador.newContext();
  await ctx.addInitScript(([s]) => { try { localStorage.setItem("sb-fwmzeaztjxrxxzxzxmgc-auth-token", s); } catch { /* */ } }, [sessao]);
  const pagina = await ctx.newPage();
  await pagina.clock.install();
  const pedidos = []; let fase = "abertura";
  // Tela quebrada reprova (item 3 do cabeçalho). O ErrorBoundary do projeto
  // grava "[ErroDeTela] falha ao renderizar a tela" no console, então toda
  // tela que cai na rede de segurança aparece aqui.
  const erros = [];
  const anotarErro = (e) => { if (erros.length < 5) erros.push(String(e).replace(/\s+/g, " ").slice(0, 300)); };
  pagina.on("console", (m) => { if (m.type() === "error") anotarErro(`console.error: ${m.text()}`); });
  pagina.on("pageerror", (e) => anotarErro(`exceção não tratada: ${e.message || e}`));
  pagina.on("requestfailed", (r) => {
    // Requisição da própria página que nem saiu (script quebrado, chunk que
    // não existe). A API falsa nunca falha, então aqui só sobra defeito real.
    const falha = r.failure()?.errorText ?? "";
    if (!/ERR_ABORTED|net::ERR_FAILED$/.test(falha) || !ehApi(r.url())) anotarErro(`requisição falhou (${falha}): ${r.url().slice(0, 120)}`);
  });
  pagina.on("response", (r) => { if (r.status() >= 400 && !ehApi(r.url())) anotarErro(`HTTP ${r.status()} em ${r.url().replace(BASE, "").slice(0, 120)}`); });

  // Contrato de rede (item 4): julga a requisição, não o texto do código.
  const violacoes = new Map();
  await pagina.route((u) => ehApi(u.href), (r) => {
    const req = r.request();
    const url = req.url();
    pedidos.push({ fase, metodo: req.method(), url: url.replace(/^https?:\/\/[^/]+/, "").slice(0, 160) });
    const motivo = violacaoDeContrato({ url, metodo: req.method(), cabecalhos: req.headers() });
    if (motivo) violacoes.set(motivo, (violacoes.get(motivo) ?? 0) + 1);
    const f = respostaFalsa(url);
    return r.fulfill({ status: f.status, contentType: "application/json", headers: { "access-control-allow-origin": "*", ...(f.headers ?? {}) }, body: f.body });
  });

  let navegacao = null;
  try {
    await pagina.goto(BASE + rota, { waitUntil: "networkidle", timeout: 30_000 });
  } catch (e) {
    // Antes este catch era vazio e engolia a falha: a tela que não carregava
    // fazia POUCAS requisições e passava com folga. `networkidle` com a tela
    // ainda buscando dá timeout sem a tela estar quebrada, então timeout não
    // é erro por si — quem decide é o #root vazio, logo abaixo.
    navegacao = String(e.message || e).split("\n")[0].slice(0, 200);
  }
  // Espera a tela ASSENTAR: dois ciclos seguidos sem requisição nova. Sem
  // isto, tela que termina de carregar devagar (máquina disputada) tem o fim
  // do carregamento contado como "busca sozinha" — falso positivo medido em
  // 03/11/2026: 7 telas reprovaram com 4 em paralelo e passaram uma a uma.
  for (let quietos = 0, voltas = 0; quietos < 2 && voltas < 15; voltas++) {
    const antes = pedidos.length;
    await pagina.clock.runFor(2_000).catch(() => {});
    await pagina.waitForTimeout(700);
    quietos = pedidos.length === antes ? quietos + 1 : 0;
  }
  // Tela branca: o React montou algo dentro do #root? Esta é a asserção que
  // separa "tela demorou" de "tela não existe" — e a que impede que uma tela
  // quebrada seja premiada por fazer poucas requisições.
  const pintou = await pagina.evaluate(() => {
    const r = document.getElementById("root");
    return { filhos: r ? r.childElementCount : 0, texto: (document.body.innerText || "").trim().length };
  }).catch(() => ({ filhos: 0, texto: 0 }));

  fase = "parada";
  await pagina.clock.runFor(10 * 60_000).catch(() => {});
  await pagina.waitForTimeout(800);
  await ctx.close();
  const ab = pedidos.filter((p) => p.fase === "abertura"), pa = pedidos.filter((p) => p.fase === "parada");
  const problemas = [];
  if (ab.length > ABERTURA) problemas.push(`abre com ${ab.length} requisições (orçamento ${ABERTURA})`);
  if (pa.length > 0) problemas.push(`fez ${pa.length} requisição(ões) SOZINHA em 10 min parada (polling)`);

  // Catraca por tela (item 5): piorar em relação à main reprova, mesmo dentro
  // do teto absoluto.
  const base = BASE_POR_ROTA.get(rota);
  if (base !== undefined) {
    const teto = Math.max(base + FOLGA_ABS, Math.ceil(base * (1 + FOLGA_PCT / 100)));
    if (ab.length > teto) problemas.push(`piorou: abre com ${ab.length} e na main eram ${base} (limite ${teto})`);
  }

  if (pintou.filhos === 0 || pintou.texto < 10) {
    problemas.push(`não pintou nada (#root com ${pintou.filhos} filho(s), ${pintou.texto} caractere(s) de texto)${navegacao ? ` — navegação: ${navegacao}` : ""}`);
  }
  if (erros.length) problemas.push(`${erros.length} erro(s) no navegador`);
  if (violacoes.size) problemas.push(`${violacoes.size} violação(ões) do contrato de rede`);

  resultados.push({
    rota, abertura: ab.length, parada: pa.length, problemas,
    sozinhas: [...new Set(pa.map((p) => `${p.metodo} ${p.url.split("?")[0]}`))],
    erros, violacoes: [...violacoes.entries()].map(([motivo, vezes]) => ({ motivo, vezes })),
  });
}

console.log(`${rotas.length} telas · orçamento de abertura ${ABERTURA} · ${PARALELO} em paralelo · ${BASE}`);
const fila = [...rotas];
await Promise.all(Array.from({ length: PARALELO }, async () => { while (fila.length) await testar(fila.shift()); }));
await navegador.close();

resultados.sort((a, b) => a.rota.localeCompare(b.rota));
const ruins = resultados.filter((r) => r.problemas.length);
for (const r of ruins) {
  const extra = [
    r.sozinhas.length ? "sozinhas: " + r.sozinhas.join(", ") : "",
    ...r.violacoes.map((v) => `contrato (${v.vezes}x): ${v.motivo}`),
    ...r.erros,
  ].filter(Boolean).join(" | ");
  console.log(`::error title=QA requisições ${r.rota}::${r.problemas.join("; ")}${extra ? " — " + extra : ""}`);
}
const media = (resultados.reduce((s, r) => s + r.abertura, 0) / Math.max(resultados.length, 1)).toFixed(1);
const detalhe = (r) => [
  r.sozinhas.length ? `<br>sozinhas: ${r.sozinhas.map((s) => `\`${s}\``).join(", ")}` : "",
  ...r.violacoes.map((v) => `<br>contrato de rede (${v.vezes}x): ${v.motivo}`),
  ...r.erros.map((e) => `<br>no navegador: \`${e}\``),
].join("");
const resumo = [`## QA de requisições por tela`, ruins.length ? `❌ **${ruins.length} de ${resultados.length} telas reprovaram.**` : `✅ ${resultados.length} telas: abrem sem erro no navegador, nenhuma busca sozinha, nenhuma lista sem janela e todas dentro do orçamento.`,
  `Média de requisições para abrir uma tela: **${media}** · maior: **${Math.max(...resultados.map((r) => r.abertura))}** (${resultados.reduce((m, r) => (r.abertura > m.abertura ? r : m), resultados[0])?.rota}).`
  + (BASE_POR_ROTA.size ? ` · catraca com baseline de ${BASE_POR_ROTA.size} tela(s).` : " · sem baseline (catraca desligada)."),
  "", ...ruins.map((r) => `- \`${r.rota}\` — ${r.problemas.join("; ")}${detalhe(r)}`)].join("\n");
console.log(resumo);
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, resumo + "\n");
fs.writeFileSync(SAIDA, JSON.stringify({ quando: new Date().toISOString(), base: BASE, resultados }, null, 1));
process.exit(ruins.length ? 1 : 0);
