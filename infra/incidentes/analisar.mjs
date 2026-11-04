// ============================================================================
//  ANALISAR UM DIA DE LOGS — o que o post-mortem de 03/11/2026 usou
//
//  Uso:  node infra/incidentes/analisar.mjs ./incidente-2026-11-03
//
//  Lê o que o coletar.sh trouxe e imprime, sem interpretação:
//    1. requisições, 4xx, 5xx e MB por janela de 10 min (log do Kong)
//    2. minutos com 5xx > 100, com a ASSINATURA de recarga em massa: rotas de
//       boot (profiles, auth/v1/user, has_screen_access, app_menu) e
//       sistema_saude. Boot alto + 5xx alto = as abas recarregando juntas.
//    3. top rotas do dia por quantidade e por volume, e origem (referer)
//    4. statement timeouts por janela e por alvo (log do Postgres), e em que
//       função de RLS cada um estava quando estourou
//    5. eventos do PostgREST: pool esgotado (PGRST003), schema cache que não
//       carregou, reconexões e LISTEN cortado
// ============================================================================
import fs from "node:fs";
import zlib from "node:zlib";
import readline from "node:readline";
import path from "node:path";

const pasta = process.argv[2];
if (!pasta) { console.error("uso: node analisar.mjs <pasta do coletar.sh>"); process.exit(1); }
const arq = (n) => path.join(pasta, n);
const linhas = (n) => readline.createInterface({ input: fs.createReadStream(arq(n)).pipe(zlib.createGunzip()), crlfDelay: Infinity });
const pad = (v, n = 6) => String(v).padStart(n);
const top = (obj, n) => Object.entries(obj).sort((a, b) => b[1] - a[1]).slice(0, n);

// ── 1-3. Kong ───────────────────────────────────────────────────────────────
const BOOT = new Set(["GET /rest/v1/profiles", "GET /auth/v1/user", "POST /rest/v1/rpc/has_screen_access", "GET /rest/v1/app_menu"]);
const rx = /\[\d\d\/\w{3}\/\d{4}:(\d\d):(\d\d):\d\d \+0000\] "(\w+) ([^ ?]+)[^"]* HTTP\/[\d.]+" (\d{3}) (\d+|-) "([^"]*)"/;
const norm = (p) => p.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, ":id").replace(/\/\d+(?=\/|$)/g, "/:n");
const jan = {}, min = {}, rotaN = {}, rotaB = {}, origem = {};
for await (const bruto of linhas("kong.log.gz")) {
  const m = bruto.split('\\"').join('"').match(rx);
  if (!m) continue;
  const [, h, mi, metodo, caminho, st, bytes, ref] = m;
  if (metodo === "OPTIONS") continue;
  const rota = `${metodo} ${norm(caminho)}`, b = +bytes || 0;
  const j = (jan[`${h}:${mi[0]}0`] ??= { n: 0, e4: 0, e5: 0, b: 0 });
  j.n++; j.b += b; if (st[0] === "5") j.e5++; else if (st[0] === "4") j.e4++;
  const mm = (min[`${h}:${mi}`] ??= { n: 0, e5: 0, boot: 0, saude: 0 });
  mm.n++; if (st[0] === "5") mm.e5++; if (BOOT.has(rota)) mm.boot++; if (rota.endsWith("/sistema_saude")) mm.saude++;
  rotaN[rota] = (rotaN[rota] || 0) + 1; rotaB[rota] = (rotaB[rota] || 0) + b;
  const o = (ref.match(/^https?:\/\/[^/]+/) || ["(sem referer)"])[0];
  origem[o] = (origem[o] || 0) + 1;
}
const total = Object.values(jan).reduce((s, j) => s + j.n, 0), total5 = Object.values(jan).reduce((s, j) => s + j.e5, 0);
console.log(`\n== 1. API por 10 min (UTC) — ${total} req, ${total5} em 5xx (${(100 * total5 / Math.max(total, 1)).toFixed(1)} %)`);
console.log("janela     req    4xx    5xx     MB");
for (const k of Object.keys(jan).sort()) { const j = jan[k]; if (j.n < 200) continue; console.log(`${k} ${pad(j.n)} ${pad(j.e4)} ${pad(j.e5)} ${pad((j.b / 1e6).toFixed(0))}`); }

console.log("\n== 2. Minutos com mais de 100 respostas 5xx");
console.log("minuto   req    5xx   boot  saude");
for (const k of Object.keys(min).sort()) { const v = min[k]; if (v.e5 > 100) console.log(`${k} ${pad(v.n)} ${pad(v.e5)} ${pad(v.boot)} ${pad(v.saude)}`); }

console.log("\n== 3a. Top rotas por quantidade");
for (const [r, n] of top(rotaN, 20)) console.log(`${pad(n, 8)}  ${r}`);
console.log("\n== 3b. Top rotas por volume");
for (const [r, b] of top(rotaB, 15)) console.log(`${pad((b / 1e6).toFixed(0), 6)} MB ${pad(rotaN[r], 7)} req  ${r}`);
console.log("\n== 3c. Origem (referer) — qualquer coisa fora do app oficial é dev/local batendo na produção");
for (const [o, n] of top(origem, 8)) console.log(`${pad(n, 8)}  ${o}`);

// ── 4. Postgres: statement timeouts ──────────────────────────────────────────
const ent = [];
for await (const l of linhas("postgres.log.gz")) { if (l.startsWith("\t") && ent.length) ent[ent.length - 1] += " " + l.trim(); else ent.push(l); }
const rxPg = /^(\S+ \S+) UTC \[(\d+)\] (\w+):\s+(.*)$/;
const pend = {}, to = [];
const alvo = (s) => {
  if (s.includes("p_fonte")) return "rpc fluxo_caixa_ler_fonte";
  const m = s.match(/pgrst_call.*?"public"\."([^"]+)"\(/) || s.match(/FROM "public"\."([^"]+)"/);
  if (m) return m[1];
  return s.includes("pg_catalog") || s.includes("columns AS") ? "(introspecção de schema do PostgREST)" : s.slice(0, 60);
};
for (const e of ent) {
  const m = e.match(rxPg); if (!m) continue;
  const [, ts, pid, nivel, msg] = m;
  if (nivel === "ERROR" && msg.includes("statement timeout")) pend[pid] = { ts, ctx: "" };
  else if (nivel === "CONTEXT" && pend[pid]) pend[pid].ctx = msg.replace(/ (line|statement|during).*/, "").slice(0, 70);
  else if (nivel === "STATEMENT" && pend[pid]) { to.push({ ...pend[pid], alvo: alvo(msg) }); delete pend[pid]; }
}
for (const p of Object.values(pend)) to.push({ ...p, alvo: "(sem statement)" });
const porJan = {}, porAlvo = {}, porCtx = {};
for (const t of to) {
  const j = t.ts.slice(11, 13) + ":" + (t.ts[14] < "3" ? "00" : "30");
  porJan[j] = (porJan[j] || 0) + 1; porAlvo[t.alvo] = (porAlvo[t.alvo] || 0) + 1;
  if (t.ctx) porCtx[t.ctx] = (porCtx[t.ctx] || 0) + 1;
}
console.log(`\n== 4a. statement timeout por meia hora — ${to.length} no dia`);
for (const k of Object.keys(porJan).sort()) console.log(`${k} ${pad(porJan[k])}`);
console.log("\n== 4b. ... por alvo");
for (const [a, n] of top(porAlvo, 15)) console.log(`${pad(n)}  ${a}`);
console.log("\n== 4c. ... onde estava quando estourou (função de RLS etc.)");
for (const [a, n] of top(porCtx, 12)) console.log(`${pad(n)}  ${a}`);

// ── 5. PostgREST ─────────────────────────────────────────────────────────────
const EV = [["PGRST003", "pool esgotado (PGRST003)"], ["Failed to load the schema cache", "schema cache NÃO carregou"],
  ["Attempting to reconnect", "reconexão do pool"], ["Failed listening", "LISTEN cortado"], ["PGRST002", "PGRST002"]];
const ev = {};
for await (const l of linhas("rest.log.gz")) {
  const h = (l.match(/"time":"\d{4}-\d\d-\d\dT(\d\d)/) || [])[1]; if (!h) continue;
  for (const [chave, nome] of EV) if (l.includes(chave)) { const k = `${h}h ${nome}`; ev[k] = (ev[k] || 0) + 1; }
}
console.log("\n== 5. Eventos do PostgREST por hora (UTC)");
for (const k of Object.keys(ev).sort()) console.log(`${pad(ev[k])}  ${k}`);
