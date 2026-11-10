// ============================================================================
//  VARRER TODAS AS TELAS NO CELULAR (06/11/2026)
//
//  Uso, com a build servida em --base:
//    PLAYWRIGHT=<node_modules/playwright> node infra/qa/varrer-celular.mjs \
//      --base http://localhost:4173 [--largura 375] [--so /app/rh] [--saida celular.json]
//
//  Abre cada rota estática de src/App.tsx num celular emulado, com a API FALSA
//  (nada toca a produção) e um usuário que enxerga todos os menus, e registra:
//    - QUEBRA: exceção, ou a tela caiu na rede de segurança (ErroDeTela);
//    - ROLAGEM: a página inteira rola de lado;
//    - DE LADO: elemento passa da borda sem contêiner próprio que role. Não fica
//      inalcançável (o <main> rola de lado no celular), mas a tela inteira
//      precisa correr para vê-lo: é a lista do que ainda não foi feito para o dedo.
//
//  Com a API vazia a tela mostra só o esqueleto (filtros, cabeçalhos de tabela,
//  botões), e é aí que moram quase todos os estouros. Listas cheias e telas com
//  :parametro precisam ser olhadas à parte. Não reprova build: é uma medida, e
//  sai com código 1 só se alguma tela QUEBRAR.
// ============================================================================
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const arg = (n, p) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : p; };
const BASE = arg("base", "http://localhost:4173");
const LARGURA = Number(arg("largura", 375));
const SO = arg("so", null);
const SAIDA = arg("saida", "varredura-celular.json");
const PARALELO = Number(arg("paralelo", 6));
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT ?? "playwright");

const app = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "../../src/App.tsx"), "utf8");
const bloco = app.slice(app.indexOf('<Route path="/app"'));
const rotas = [...new Set([...bloco.matchAll(/<Route path="([^"]+)"/g)].map((m) => m[1])
  .filter((p) => !p.includes(":") && !p.includes("*"))
  .map((p) => (p.startsWith("/") ? p : `/app/${p}`))
  .filter((p) => p.startsWith("/app/") && p !== "/app/login" && (!SO || p.startsWith(SO))))].sort();

// Sessão e API falsas: o JWT não é verificado por ninguém.
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const agora = Math.floor(Date.now() / 1000);
const USER = { id: "00000000-0000-4000-8000-000000000001", email: "qa@teste.local", aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: { nome: "QA" } };
const jwt = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: USER.id, role: "authenticated", aud: "authenticated", exp: agora + 7200, iat: agora })}.qa`;
const sessao = JSON.stringify({ access_token: jwt, token_type: "bearer", expires_in: 7200, expires_at: agora + 7200, refresh_token: "qa", user: USER });
const menus = rotas.map((r) => ({ codigo: `m${r.replace(/\W/g, "_")}`, rota: r, ativo: true }));
const ehApi = (u) => /\/(rest|auth|storage|functions)\/v1\//.test(u);

function respostaFalsa(url) {
  const json = (b) => ({ status: 200, body: JSON.stringify(b) });
  if (url.includes("/auth/v1/user")) return json(USER);
  if (url.includes("/auth/v1/")) return json(JSON.parse(sessao));
  if (url.includes("/rpc/sistema_saude")) return { status: 200, body: "true" };
  if (url.includes("/rpc/list_accessible_menus")) return json(menus.map((m) => ({ menu_codigo: m.codigo })));
  if (url.includes("/rpc/list_configured_menu_codes")) return json(menus.map((m) => m.codigo));
  if (url.includes("/rpc/sis_status_dev_telas")) return json({ telas: [], modulos: [] });
  if (url.includes("/rpc/meu_empregado")) return json([{ id: 1, nome: "QA", cargo: "ANALISTA" }]);
  if (url.includes("/rest/v1/rpc/")) return { status: 200, body: "[]" };
  if (url.includes("/rest/v1/app_menu")) return json(menus);
  if (url.includes("/rest/v1/")) return { status: 200, body: "[]", headers: { "content-range": "*/0" } };
  return { status: 200, body: "{}" };
}

// Roda dentro da página. Só conta quem tem caixa visível e não está dentro de
// algo que rola de lado, nem de overlay (gaveta fora da tela é de propósito).
const medir = () => {
  const W = window.innerWidth;
  const rolaDeLado = (e) => {
    for (let a = e.parentElement; a && a !== document.body; a = a.parentElement) {
      if (a.tagName === "MAIN") return false;
      const o = getComputedStyle(a).overflowX;
      if (o === "auto" || o === "scroll") return true;
    }
    return false;
  };
  const cortados = [];
  for (const e of document.querySelectorAll("main *")) {
    const r = e.getBoundingClientRect();
    if (r.width <= 1 || r.height <= 1 || r.right <= W + 1 || r.left >= W) continue;
    const c = getComputedStyle(e);
    if (c.visibility === "hidden" || c.position === "fixed" || rolaDeLado(e)) continue;
    // Conta o mais fundo: pai que só estourou por causa do filho seria ruído.
    if ([...e.children].some((f) => f.getBoundingClientRect().right > W + 1)) continue;
    const txt = (e.innerText || e.getAttribute("aria-label") || e.getAttribute("placeholder") || "").trim().replace(/\s+/g, " ").slice(0, 40);
    cortados.push({ tag: e.tagName.toLowerCase(), direita: Math.round(r.right), txt });
    if (cortados.length >= 200) break;
  }
  return { rolagem: document.documentElement.scrollWidth > W + 1 ? document.documentElement.scrollWidth : 0, cortados };
};

const navegador = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
const resultados = [];
async function testar(rota) {
  const ctx = await navegador.newContext({ viewport: { width: LARGURA, height: 812 }, isMobile: true, hasTouch: true });
  await ctx.addInitScript(([s]) => { try { localStorage.setItem("sb-fwmzeaztjxrxxzxzxmgc-auth-token", s); } catch { /* */ } }, [sessao]);
  await ctx.route((u) => ehApi(u.href), (r) => {
    const f = respostaFalsa(r.request().url());
    return r.fulfill({ status: f.status, contentType: "application/json", headers: { "access-control-allow-origin": "*", ...(f.headers ?? {}) }, body: f.body });
  });
  const p = await ctx.newPage();
  const quebras = [];
  p.on("pageerror", (e) => quebras.push(String(e.message).slice(0, 200)));
  p.on("console", (m) => { if (m.type() === "error" && m.text().includes("[ErroDeTela]")) quebras.push(m.text().slice(0, 240)); });
  const r = { rota, quebras, rolagem: 0, cortados: [] };
  try {
    await p.goto(BASE + rota, { waitUntil: "load", timeout: 45_000 });
    await p.waitForTimeout(2200);
    Object.assign(r, await p.evaluate(medir));
  } catch (e) { quebras.push(String(e.message).slice(0, 160)); }
  await ctx.close();
  resultados.push(r);
}

const fila = [...rotas];
console.log(`${rotas.length} rotas a ${LARGURA} px · ${BASE}`);
await Promise.all(Array.from({ length: PARALELO }, async () => { while (fila.length) await testar(fila.shift()); }));
await navegador.close();
resultados.sort((a, b) => a.rota.localeCompare(b.rota));

const quebradas = resultados.filter((r) => r.quebras.length);
const comRolagem = resultados.filter((r) => r.rolagem);
const comCorte = resultados.filter((r) => r.cortados.length);
console.log(`\nquebradas: ${quebradas.length} · documento rolando de lado: ${comRolagem.length} · com algo fora da borda: ${comCorte.length} · de ${resultados.length}\n`);
for (const r of quebradas) console.log(`QUEBRA  ${r.rota}: ${r.quebras[0]}`);
for (const r of [...comCorte].sort((a, b) => b.cortados.length - a.cortados.length).slice(0, 60)) {
  console.log(`DE LADO ${String(r.cortados.length).padStart(3)}  ${r.rota}  ex.: ${r.cortados[0].tag} "${r.cortados[0].txt}" até ${r.cortados[0].direita}px`);
}
fs.writeFileSync(SAIDA, JSON.stringify({ quando: new Date().toISOString(), base: BASE, largura: LARGURA, resultados }, null, 1));
console.log(`\ndetalhe: ${SAIDA}`);
process.exit(quebradas.length ? 1 : 0);
