// ============================================================================
//  VARRER TODAS AS TELAS — nenhuma pode abrir com erro no DevTools
//
//  Uso (precisa do pacote playwright e de um Chromium instalado):
//    PLAYWRIGHT=<caminho do node_modules/playwright> \
//    node infra/qa/varrer-telas.mjs --base https://app.grpnascimento.com.br \
//         --tokens tokens.json --usuario <uuid> [--so /app/malote]
//
//  Para cada rota estática de src/App.tsx (as com :parametro ficam de fora —
//  precisam de um id real), abre a tela LOGADA como um usuário comum, espera
//  a rede assentar e registra:
//    - console.error e erro de página (exceção não tratada);
//    - toda resposta HTTP >= 400 (o que aparece vermelho na aba Network).
//  Agrupa por assinatura (método + rota da API + status), para que um erro
//  repetido em 80 telas apareça como UM achado com a lista de telas.
//
//  A sessão é injetada no localStorage (mesma gaveta do supabase-js), com um
//  JWT de 4 h assinado no próprio servidor (ver docs/infra/capacidade.md,
//  "Tokens"). Nada é gravado: a varredura só abre telas.
// ============================================================================
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const arg = (n, p) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : p; };
const BASE = arg("base", "https://app.grpnascimento.com.br");
const API = arg("api", "https://api.grpnascimento.com.br");
const tokens = JSON.parse(fs.readFileSync(arg("tokens"), "utf8"));
const USUARIO = arg("usuario", Object.keys(tokens)[0]);
const SO = arg("so", null);
const SAIDA = arg("saida", `varredura-${USUARIO.slice(0, 8)}.json`);
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT ?? "playwright");

// ── rotas de src/App.tsx ─────────────────────────────────────────────────────
const app = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "../../src/App.tsx"), "utf8");
// Só o que está DENTRO de <Route path="/app">: rota relativa antes dele é de
// outro pai (ex.: perfil/salario/ponto são do Portal do Colaborador).
const blocoApp = app.slice(app.indexOf("<Route path=\"/app\""));
const rotas = [...new Set([...blocoApp.matchAll(/<Route path="([^"]+)"/g)].map((m) => m[1])
  .filter((p) => !p.includes(":") && !p.includes("*"))
  .map((p) => (p.startsWith("/") ? p : `/app/${p}`))
  .filter((p) => p.startsWith("/app/") && !["/app/login"].includes(p))
  .filter((p) => !SO || p.startsWith(SO)))].sort();

// ── sessão do usuário comum ──────────────────────────────────────────────────
const jwt = tokens[USUARIO];
const claims = JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString());
const user = await (await fetch(`${API}/auth/v1/user`, { headers: { apikey: process.env.ANON_KEY, Authorization: `Bearer ${jwt}` } })).json();
const sessao = JSON.stringify({ access_token: jwt, token_type: "bearer", expires_in: claims.exp - Math.floor(Date.now() / 1000), expires_at: claims.exp, refresh_token: "varredura-sem-refresh", user });

// CHROMIUM=<caminho do executável> quando o Playwright instalado não trouxer
// o navegador da versão dele (ex.: o que veio com o MCP do Playwright).
const navegador = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
const ctx = await navegador.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addInitScript(([s]) => { try { localStorage.setItem("sb-fwmzeaztjxrxxzxzxmgc-auth-token", s); } catch { /* */ } }, [sessao]);
const achados = []; let rotaAtual = "";
const curto = (u) => { try { const x = new URL(u); return x.origin === new URL(API).origin ? x.pathname : `${x.host}${x.pathname}`; } catch { return u; } };

// Uma aba NOVA por tela (03/11/2026): com uma aba só para 342 navegações a
// memória do renderizador acumulava e a página "quebrava" no meio
// (Page crashed em /app/contabil/balancete, que aberta sozinha abre limpa).
async function abrir(rota) {
  const pagina = await ctx.newPage();
  pagina.on("crash", () => achados.push({ rota, tipo: "quebra", texto: "a aba do navegador quebrou (Page crashed)" }));
  pagina.on("console", (m) => { if (m.type() === "error") achados.push({ rota, tipo: "console", texto: m.text().slice(0, 300) }); });
  pagina.on("pageerror", (e) => achados.push({ rota, tipo: "excecao", texto: String(e.message).slice(0, 300) }));
  pagina.on("response", (r) => {
    if (r.status() >= 400) achados.push({ rota, tipo: "http", status: r.status(), metodo: r.request().method(), url: curto(r.url()), urlCompleta: r.url().slice(0, 400) });
  });
  pagina.on("requestfailed", (r) => {
    const motivo = r.failure()?.errorText ?? "";
    if (!/ERR_ABORTED/.test(motivo)) achados.push({ rota, tipo: "falha-rede", texto: motivo, url: curto(r.url()) });
  });
  try {
    // "load" + 4 s, e não "networkidle": a biblioteca Troika (vendor-3d, já na main)
    // cria um worker vazio só para testar suporte e o encerra na hora — o
    // Playwright conta esse blob: como requisição aberta para sempre, e toda
    // tela esperava os 30 s inteiros. Medido em 04/11/2026 também na build da main.
    try { await pagina.goto(BASE + rota, { waitUntil: "load", timeout: 30_000 }); } catch { /* registra o que deu */ }
    await pagina.waitForTimeout(4000);
  } catch (e) {
    achados.push({ rota, tipo: "quebra", texto: String(e.message).slice(0, 200) });
  } finally {
    await pagina.close().catch(() => {});
  }
}

// Quando a aba quebra, o Playwright rejeita outras promessas pendentes dela
// fora do try/catch; sem isto o processo inteiro morria na tela ~125.
process.on("unhandledRejection", (e) => achados.push({ rota: rotaAtual, tipo: "quebra", texto: String(e?.message ?? e).slice(0, 200) }));
const DESDE = Number(arg("desde", 1));
console.log(`${rotas.length} rotas · usuário ${USUARIO} · ${BASE}${DESDE > 1 ? ` · a partir da ${DESDE}` : ""}`);
let i = 0;
for (const rota of rotas) {
  rotaAtual = rota; i++;
  if (i < DESDE) continue;
  if (process.env.DETALHE) console.log(`  [${i}] ${rota}`);
  await abrir(rota);
  if (i % 25 === 0) console.log(`  ${i}/${rotas.length}`);
}
await navegador.close();

// ── agrupa por assinatura ────────────────────────────────────────────────────
const assinatura = (a) => a.tipo === "http" ? `HTTP ${a.status} ${a.metodo} ${a.url.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, ":id")}`
  : `${a.tipo}: ${String(a.texto).replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, ":id").replace(/\d{4,}/g, "N").slice(0, 160)}`;
const grupos = {};
for (const a of achados) { const k = assinatura(a); (grupos[k] ??= { n: 0, rotas: new Set(), exemplo: a }).n++; grupos[k].rotas.add(a.rota); }
const lista = Object.entries(grupos).map(([k, g]) => ({ assinatura: k, vezes: g.n, telas: [...g.rotas], exemplo: g.exemplo })).sort((a, b) => b.telas.length - a.telas.length);
const telasComErro = new Set(achados.map((a) => a.rota));
console.log(`\n${achados.length} erros em ${telasComErro.size} de ${rotas.length} telas · ${lista.length} assinaturas distintas\n`);
for (const g of lista) console.log(`${String(g.telas.length).padStart(4)} telas  ${String(g.vezes).padStart(5)}x  ${g.assinatura}\n             ex.: ${g.telas.slice(0, 3).join(", ")}`);
fs.writeFileSync(SAIDA, JSON.stringify({ quando: new Date().toISOString(), base: BASE, usuario: USUARIO, rotas: rotas.length, telasComErro: telasComErro.size, grupos: lista }, null, 1));
console.log(`\ndetalhe: ${SAIDA}`);
