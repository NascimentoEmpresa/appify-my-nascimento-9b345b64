// ============================================================================
//  MANADA — N abas recarregando o ERP ao mesmo tempo
//
//  Uso:
//    node infra/carga/manada.mjs --mix mix.json --tokens tokens.json \
//         --abas 20,40,60 --modo juntas        (como era até 03/11/2026)
//    node infra/carga/manada.mjs ... --modo espalhadas --janela 20
//                                              (como o monitorDeQueda faz agora)
//
//  POR QUE EXISTE
//  As quedas de 03/11/2026 não vieram de usuário demais (o pico foi de 62 abas
//  logadas), e sim de todas as abas recarregando juntas quando o servidor
//  voltava (docs/incidentes/2026-11-03-post-mortem.md, C3). Este teste mede
//  exatamente isso: quantas abas recarregando NO MESMO SEGUNDO derrubam a API,
//  e o que muda quando a mesma quantidade se espalha por 20 s.
//
//  O BOOT de uma aba foi medido no log do Kong da tempestade das 19:02–19:08
//  UTC: ~33 requisições por recarga, com `profiles` buscado ~7 vezes e
//  `auth/v1/user` ~4 vezes (sim — a mesma informação várias vezes por boot;
//  ver item 4). As URLs são as reais do dia, sorteadas do mix.
//
//  Entre um tamanho de manada e o próximo, espera a API ficar boa de novo
//  (sonda com 200 por 3 vezes seguidas).
// ============================================================================
import fs from "node:fs";

const arg = (n, p) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : p; };
const BASE = arg("base", "https://api.grpnascimento.com.br");
const ANON = arg("anon", process.env.ANON_KEY);
const mix = JSON.parse(fs.readFileSync(arg("mix"), "utf8"));
const tokens = Object.entries(JSON.parse(fs.readFileSync(arg("tokens"), "utf8")));
const ABAS = arg("abas", "20,40").split(",").map(Number);
const MODO = arg("modo", "juntas");
const JANELA_S = Number(arg("janela", 20));
const SAIDA = arg("saida", `manada-${MODO}.json`);

// rota -> quantas vezes aparece num boot (medido em 19:02–19:08 UTC, 03/11)
const BOOT = {
  "GET /rest/v1/profiles": 7, "GET /auth/v1/user": 4, "POST /rest/v1/rpc/has_screen_access": 2,
  "GET /rest/v1/EMPREGADOS": 1, "GET /rest/v1/app_menu": 1, "GET /rest/v1/SISTEMA_NOTIFICACAO_CIENCIA": 1,
  "GET /rest/v1/notificacoes": 1, "GET /rest/v1/agenda_favoritos": 1, "GET /rest/v1/SISTEMA_NOVIDADES_LIDAS": 1,
  "GET /rest/v1/setor_catalogo": 1, "GET /rest/v1/usuario_discord": 1, "HEAD /rest/v1/grade": 1,
  "GET /rest/v1/RH_DOCUMENTO_SOLICITACAO": 1, "GET /rest/v1/SISTEMA_NOVIDADES": 1, "GET /rest/v1/SISTEMA_NOTIFICACAO_ALVO": 1,
  "GET /rest/v1/SISTEMA_NOTIFICACOES": 1, "GET /rest/v1/CHAMADO_SISTEMA": 1, "GET /rest/v1/SISTEMA_SOLICITACOES_TROCA_FUNCAO": 1,
  "HEAD /rest/v1/financeiro_pagamento_aprovacao": 1, "HEAD /rest/v1/sup_aprov_etapa": 1, "GET /rest/v1/user_roles": 1,
  "POST /rest/v1/rpc/presenca_listar": 1, "POST /rest/v1/rpc/list_configured_menu_codes": 1,
  "POST /rest/v1/rpc/list_accessible_menus": 1, "GET /rest/v1/screen_permission_user": 1, "GET /rest/v1/usuario_perfil_acesso": 1,
};
const porRota = new Map(mix.rotas.map((r) => [`${r.metodo} ${r.caminho}`, r]));
const um = (a) => a[Math.floor(Math.random() * a.length)];

function requisicoesDeUmBoot() {
  const [user, jwt] = um(tokens);
  const h = { apikey: ANON, Authorization: `Bearer ${jwt}`, "x-teste-de-carga": "manada" };
  const lista = [];
  for (const [rota, vezes] of Object.entries(BOOT)) {
    for (let i = 0; i < vezes; i++) {
      if (rota === "GET /auth/v1/user") { lista.push({ rota, url: `${BASE}/auth/v1/user`, init: { headers: h } }); continue; }
      const r = porRota.get(rota); if (!r) continue;
      if (r.corpos) lista.push({ rota, url: BASE + r.caminho, init: { method: "POST", headers: { ...h, "Content-Type": "application/json" }, body: JSON.stringify(um(r.corpos)).replaceAll("{USER}", user) } });
      else lista.push({ rota, url: BASE + um(r.urls), init: { method: r.metodo, headers: h } });
    }
  }
  return lista;
}

async function req({ url, init }) {
  const t0 = performance.now();
  try { const r = await fetch(url, { ...init, signal: AbortSignal.timeout(20_000) }); await r.arrayBuffer(); return { st: r.status, ms: performance.now() - t0 }; }
  catch { return { st: -1, ms: performance.now() - t0 }; }
}
async function saude() {
  const r = await req({ url: `${BASE}/rest/v1/rpc/sistema_saude`, init: { method: "POST", headers: { apikey: ANON, Authorization: `Bearer ${ANON}`, "Content-Type": "application/json" }, body: "{}" } });
  return r.st > 0 && r.st < 500;
}
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s.length ? Math.round(s[Math.min(s.length - 1, Math.floor(p * s.length))]) : 0; };

const resultados = [];
console.log(`modo ${MODO}${MODO === "espalhadas" ? ` em ${JANELA_S} s` : " (no mesmo segundo)"} · ~${Object.values(BOOT).reduce((a, b) => a + b, 0)} req por boot`);
console.log("abas   req   5xx    esgot  p50    p95    p99   boot-completo-p95  sonda-falhas  recuperou-em");
for (const n of ABAS) {
  // sonda de 2 em 2 s durante a manada
  const sonda = []; let ativa = true;
  (async () => { while (ativa) { sonda.push(await saude()); await espera(2000); } })();
  const t0 = Date.now();
  const boots = await Promise.all(Array.from({ length: n }, async () => {
    if (MODO === "espalhadas") await espera(Math.random() * JANELA_S * 1000);
    const ini = performance.now();
    const r = await Promise.all(requisicoesDeUmBoot().map(req));
    return { r, total: performance.now() - ini };
  }));
  const todas = boots.flatMap((b) => b.r);
  ativa = false;
  // quanto tempo até a API responder bem de novo
  let ok = 0; const ini = Date.now();
  while (ok < 3 && Date.now() - ini < 180_000) { ok = (await saude()) ? ok + 1 : 0; await espera(1000); }
  const linha = {
    abas: n, req: todas.length, e5: todas.filter((x) => x.st >= 500).length / todas.length,
    esgot: todas.filter((x) => x.st === -1).length / todas.length,
    p50: pct(todas.map((x) => x.ms), 0.5), p95: pct(todas.map((x) => x.ms), 0.95), p99: pct(todas.map((x) => x.ms), 0.99),
    bootP95: pct(boots.map((b) => b.total), 0.95), sondaFalhas: sonda.filter((x) => !x).length,
    recuperouEmS: Math.round((Date.now() - ini) / 1000), duracaoS: Math.round((ini - t0) / 1000),
  };
  resultados.push(linha);
  const f = (x) => `${(100 * x).toFixed(1)}%`;
  console.log(`${String(n).padStart(4)} ${String(linha.req).padStart(5)} ${f(linha.e5).padStart(6)} ${f(linha.esgot).padStart(6)} ${String(linha.p50).padStart(5)} ${String(linha.p95).padStart(6)} ${String(linha.p99).padStart(6)} ${String(linha.bootP95).padStart(18)} ${String(linha.sondaFalhas).padStart(13)} ${String(linha.recuperouEmS).padStart(11)} s`);
  if (linha.e5 > 0.3) { console.log("parando: mais de 30% de 5xx — o próximo tamanho só confirmaria a queda"); break; }
  await espera(20_000);
}
fs.writeFileSync(SAIDA, JSON.stringify({ quando: new Date().toISOString(), modo: MODO, janelaS: JANELA_S, resultados }, null, 1));
console.log(`detalhe: ${SAIDA}`);
process.exit(0);
