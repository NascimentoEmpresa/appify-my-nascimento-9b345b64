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
//  Sai com código 1 se alguma tela reprovar, listando a tela, o motivo e as
//  URLs que saíram sozinhas.
// ============================================================================
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const arg = (n, p) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : p; };
const BASE = arg("base", "http://localhost:4173");
const SO = arg("so", null);
const ABERTURA = Number(arg("abertura", 60));
const PARALELO = Number(arg("paralelo", 6));
const SAIDA = arg("saida", "orcamento-requisicoes.json");
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

const navegador = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
const resultados = [];
async function testar(rota) {
  const ctx = await navegador.newContext();
  await ctx.addInitScript(([s]) => { try { localStorage.setItem("sb-fwmzeaztjxrxxzxzxmgc-auth-token", s); } catch { /* */ } }, [sessao]);
  const pagina = await ctx.newPage();
  await pagina.clock.install();
  const pedidos = []; let fase = "abertura";
  await pagina.route((u) => ehApi(u.href), (r) => {
    pedidos.push({ fase, metodo: r.request().method(), url: r.request().url().replace(/^https?:\/\/[^/]+/, "").slice(0, 160) });
    const f = respostaFalsa(r.request().url());
    return r.fulfill({ status: f.status, contentType: "application/json", headers: { "access-control-allow-origin": "*", ...(f.headers ?? {}) }, body: f.body });
  });
  try { await pagina.goto(BASE + rota, { waitUntil: "networkidle", timeout: 30_000 }); } catch { /* registra o que deu */ }
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
  fase = "parada";
  await pagina.clock.runFor(10 * 60_000).catch(() => {});
  await pagina.waitForTimeout(800);
  await ctx.close();
  const ab = pedidos.filter((p) => p.fase === "abertura"), pa = pedidos.filter((p) => p.fase === "parada");
  const problemas = [];
  if (ab.length > ABERTURA) problemas.push(`abre com ${ab.length} requisições (orçamento ${ABERTURA})`);
  if (pa.length > 0) problemas.push(`fez ${pa.length} requisição(ões) SOZINHA em 10 min parada (polling)`);
  resultados.push({ rota, abertura: ab.length, parada: pa.length, problemas, sozinhas: [...new Set(pa.map((p) => `${p.metodo} ${p.url.split("?")[0]}`))] });
}

console.log(`${rotas.length} telas · orçamento de abertura ${ABERTURA} · ${PARALELO} em paralelo · ${BASE}`);
const fila = [...rotas];
await Promise.all(Array.from({ length: PARALELO }, async () => { while (fila.length) await testar(fila.shift()); }));
await navegador.close();

resultados.sort((a, b) => a.rota.localeCompare(b.rota));
const ruins = resultados.filter((r) => r.problemas.length);
for (const r of ruins) {
  console.log(`::error title=QA requisições ${r.rota}::${r.problemas.join("; ")}${r.sozinhas.length ? " — sozinhas: " + r.sozinhas.join(", ") : ""}`);
}
const media = (resultados.reduce((s, r) => s + r.abertura, 0) / Math.max(resultados.length, 1)).toFixed(1);
const resumo = [`## QA de requisições por tela`, ruins.length ? `❌ **${ruins.length} de ${resultados.length} telas reprovaram.**` : `✅ ${resultados.length} telas: nenhuma busca sozinha, todas dentro do orçamento de abertura.`,
  `Média de requisições para abrir uma tela: **${media}** · maior: **${Math.max(...resultados.map((r) => r.abertura))}** (${resultados.reduce((m, r) => (r.abertura > m.abertura ? r : m), resultados[0])?.rota}).`,
  "", ...ruins.map((r) => `- \`${r.rota}\` — ${r.problemas.join("; ")}${r.sozinhas.length ? `<br>sozinhas: ${r.sozinhas.map((s) => `\`${s}\``).join(", ")}` : ""}`)].join("\n");
console.log(resumo);
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, resumo + "\n");
fs.writeFileSync(SAIDA, JSON.stringify({ quando: new Date().toISOString(), base: BASE, resultados }, null, 1));
process.exit(ruins.length ? 1 : 0);
