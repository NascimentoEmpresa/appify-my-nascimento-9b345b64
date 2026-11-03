// ============================================================================
//  TESTE DE CARGA — até onde a API aguenta antes de o usuário sentir
//
//  Uso:
//    node infra/carga/carga.mjs --mix mix.json --tokens tokens.json \
//         --degraus 5:60,10:60,20:60,40:60,60:60,80:60,120:60
//
//  Cada degrau é "requisições por segundo : duração em s". O modelo é ABERTO:
//  as requisições saem no ritmo pedido, responda o servidor rápido ou devagar
//  — é assim que usuário de verdade se comporta (ninguém espera a requisição
//  do colega terminar para clicar). Modelo fechado (N usuários em laço)
//  esconde a saturação: o próprio teste desacelera junto com o servidor.
//
//  O QUE MEDE, por degrau: vazão alcançada, p50/p95/p99, % de 5xx, % de 4xx,
//  % de tempo esgotado (>15 s), e uma SONDA independente de "usuário":
//  sistema_saude a cada 2 s, que é exatamente o que o monitorDeQueda usa
//  para decidir mostrar a tela de "Sistema indisponível".
//
//  PARA SOZINHO quando, numa janela de 10 s: 5xx > 5 %, ou p95 > 4 s, ou a
//  sonda falhar 2 vezes seguidas (= o que faria a tela de queda aparecer
//  para os usuários reais). O degrau em que parou é o ponto de ruptura; o
//  anterior é o último saudável.
//
//  --monitorar 216.238.120.171 junta, a cada 5 s, carga do nó e conexões do
//  PostgREST no banco (só leitura, por ssh na porta 8443).
//
//  Só leitura: o mix vem de montar-mix.mjs, que descarta toda escrita.
// ============================================================================
import fs from "node:fs";
import { spawn } from "node:child_process";

const arg = (n, padrao) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : padrao; };
const BASE = arg("base", "https://api.grpnascimento.com.br");
const ANON = arg("anon", process.env.ANON_KEY);
const mix = JSON.parse(fs.readFileSync(arg("mix"), "utf8"));
const tokens = Object.entries(JSON.parse(fs.readFileSync(arg("tokens"), "utf8"))); // [[user_id, jwt]]
const degraus = arg("degraus", "5:60,10:60,20:60,40:60").split(",").map((d) => { const [rps, s] = d.split(":").map(Number); return { rps, s }; });
const MONITOR = arg("monitorar", null);
const SAIDA = arg("saida", `carga-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "")}.json`);
const LIMITE_P95 = Number(arg("limite-p95", 4000));
const LIMITE_5XX = Number(arg("limite-5xx", 0.05));
const TEMPO_LIMITE = 15_000;
if (!ANON) { console.error("falta --anon ou ANON_KEY"); process.exit(1); }

// ── sorteio ponderado de rota ────────────────────────────────────────────────
const acumulado = []; let soma = 0;
for (const r of mix.rotas) { soma += r.peso; acumulado.push(soma); }
function sortearRota() {
  const x = Math.random() * soma;
  let lo = 0, hi = acumulado.length - 1;
  while (lo < hi) { const m = (lo + hi) >> 1; if (acumulado[m] < x) lo = m + 1; else hi = m; }
  return mix.rotas[lo];
}
const um = (a) => a[Math.floor(Math.random() * a.length)];

function montarRequisicao() {
  const r = sortearRota();
  const [user, jwt] = um(tokens);
  const headers = { apikey: ANON, Authorization: `Bearer ${jwt}`, "x-teste-de-carga": "1" };
  if (r.corpos) {
    const corpo = JSON.stringify(um(r.corpos)).replaceAll("{USER}", user);
    return { rota: `${r.metodo} ${r.caminho}`, url: BASE + r.caminho, init: { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: corpo } };
  }
  return { rota: `${r.metodo} ${r.caminho}`, url: BASE + um(r.urls), init: { method: r.metodo, headers } };
}

// ── medição ──────────────────────────────────────────────────────────────────
const amostras = []; // { t, ms, st, rota, degrau }
let degrauAtual = -1, emVoo = 0, picoEmVoo = 0;
async function disparar() {
  const req = montarRequisicao();
  const t0 = performance.now(); const d = degrauAtual;
  emVoo++; picoEmVoo = Math.max(picoEmVoo, emVoo);
  const ctrl = new AbortController(); const to = setTimeout(() => ctrl.abort(), TEMPO_LIMITE);
  let st = 0;
  try {
    const r = await fetch(req.url, { ...req.init, signal: ctrl.signal });
    await r.arrayBuffer(); // mede até o último byte: é o que o usuário espera
    st = r.status;
  } catch { st = -1; } // -1 = tempo esgotado ou rede
  finally { clearTimeout(to); emVoo--; }
  amostras.push({ t: Date.now(), ms: performance.now() - t0, st, rota: req.rota, degrau: d });
}

const sonda = []; // { t, ok, ms, degrau }
async function sondar() {
  const t0 = performance.now(); let ok = false;
  try {
    const r = await fetch(`${BASE}/rest/v1/rpc/sistema_saude`, { method: "POST", headers: { apikey: ANON, Authorization: `Bearer ${ANON}`, "Content-Type": "application/json" }, body: "{}", signal: AbortSignal.timeout(8000) });
    ok = r.status < 500; await r.arrayBuffer();
  } catch { ok = false; }
  sonda.push({ t: Date.now(), ok, ms: performance.now() - t0, degrau: degrauAtual });
}

const servidor = []; // amostras do nó
function monitorar() {
  if (!MONITOR) return null;
  const cmd = `while true; do echo "$(date +%s) $(cut -d' ' -f1 /proc/loadavg) $(sudo -u postgres psql -X -At -c "select count(*) filter (where state='active'), count(*) from pg_stat_activity where application_name like 'PostgREST%'")"; sleep 5; done`;
  const p = spawn("ssh", ["-o", "BatchMode=yes", "-p", "8443", `root@${MONITOR}`, cmd]);
  p.stdout.on("data", (b) => {
    for (const l of String(b).trim().split("\n")) {
      const [ts, carga, conns] = l.split(" "); const [ativas, total] = (conns || "").split("|");
      servidor.push({ t: Number(ts) * 1000, carga: Number(carga), ativas: Number(ativas), conexoes: Number(total), degrau: degrauAtual });
    }
  });
  return p;
}

const pct = (arr, p) => { if (!arr.length) return 0; const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
function resumo(lista) {
  const ms = lista.map((a) => a.ms);
  const n = lista.length || 1;
  return {
    n: lista.length,
    p50: Math.round(pct(ms, 0.5)), p95: Math.round(pct(ms, 0.95)), p99: Math.round(pct(ms, 0.99)),
    e5: lista.filter((a) => a.st >= 500).length / n, e4: lista.filter((a) => a.st >= 400 && a.st < 500).length / n,
    esgotado: lista.filter((a) => a.st === -1).length / n,
  };
}
const fmtPct = (x) => `${(100 * x).toFixed(1)}%`;

// ── execução ─────────────────────────────────────────────────────────────────
const monitor = monitorar();
const timerSonda = setInterval(sondar, 2000);
let motivoParada = null, ultimoSaudavel = null;
const resultados = [];
console.log(`mix: ${mix.rotas.length} rotas (${mix.origem}) · ${tokens.length} usuários · alvo ${BASE}`);
console.log("degrau  rps-alvo  rps-real  p50   p95    p99    5xx    4xx   esgot  sonda-falhas  carga-nó  conexões-ativas");

for (let i = 0; i < degraus.length && !motivoParada; i++) {
  const { rps, s } = degraus[i];
  degrauAtual = i;
  const inicio = Date.now();
  const intervaloMs = 1000 / rps;
  let devidas = 0;
  // agenda em lotes de 50 ms para chegar ao rps sem 1 timer por requisição
  await new Promise((fim) => {
    const tick = setInterval(() => {
      const decorrido = Date.now() - inicio;
      const alvo = Math.floor(decorrido / intervaloMs);
      while (devidas < alvo) { devidas++; void disparar(); }
      // trava a cada 10 s olhando a última janela
      if (decorrido > 10_000 && decorrido % 2000 < 50) {
        const janela = amostras.filter((a) => a.t > Date.now() - 10_000);
        const r = resumo(janela);
        const sondaRecente = sonda.filter((x) => x.t > Date.now() - 10_000);
        const falhasSeguidas = sondaRecente.length >= 2 && !sondaRecente.at(-1).ok && !sondaRecente.at(-2).ok;
        if (r.n > 20 && r.e5 > LIMITE_5XX) motivoParada = `5xx em ${fmtPct(r.e5)} na última janela de 10 s`;
        else if (r.n > 20 && r.p95 > LIMITE_P95) motivoParada = `p95 de ${r.p95} ms na última janela de 10 s`;
        else if (falhasSeguidas) motivoParada = "sonda sistema_saude falhou 2x seguidas (a tela de queda apareceria)";
        if (motivoParada) { clearInterval(tick); fim(); return; }
      }
      if (decorrido >= s * 1000) { clearInterval(tick); fim(); }
    }, 50);
  });
  // espera as em voo do degrau terminarem (até o tempo limite) antes de medir
  const ate = Date.now() + TEMPO_LIMITE; while (emVoo > 0 && Date.now() < ate) await new Promise((r) => setTimeout(r, 200));
  const doDegrau = amostras.filter((a) => a.degrau === i);
  const r = resumo(doDegrau);
  const dur = (Date.now() - inicio) / 1000;
  const so = sonda.filter((x) => x.degrau === i);
  const sv = servidor.filter((x) => x.degrau === i);
  const cargaMax = sv.length ? Math.max(...sv.map((x) => x.carga)) : null;
  const ativasMax = sv.length ? Math.max(...sv.map((x) => x.ativas)) : null;
  const linha = { degrau: i + 1, rpsAlvo: rps, rpsReal: +(r.n / dur).toFixed(1), ...r, sondaFalhas: so.filter((x) => !x.ok).length, sondaP95: Math.round(pct(so.map((x) => x.ms), 0.95)), cargaMax, ativasMax };
  resultados.push(linha);
  console.log(`${String(i + 1).padStart(6)}  ${String(rps).padStart(8)}  ${String(linha.rpsReal).padStart(8)}  ${String(r.p50).padStart(4)}  ${String(r.p95).padStart(5)}  ${String(r.p99).padStart(5)}  ${fmtPct(r.e5).padStart(5)}  ${fmtPct(r.e4).padStart(5)}  ${fmtPct(r.esgotado).padStart(5)}  ${String(linha.sondaFalhas).padStart(12)}  ${String(cargaMax ?? "-").padStart(8)}  ${String(ativasMax ?? "-").padStart(15)}`);
  if (!motivoParada) ultimoSaudavel = linha;
}

clearInterval(timerSonda);
monitor?.kill();

// as 10 rotas mais lentas no teste inteiro (p95), para saber quem cede primeiro
const porRota = {};
for (const a of amostras) (porRota[a.rota] ??= []).push(a);
const lentas = Object.entries(porRota).map(([rota, l]) => ({ rota, ...resumo(l) })).filter((x) => x.n >= 10).sort((a, b) => b.p95 - a.p95).slice(0, 10);
console.log("\nrotas mais lentas (p95, teste inteiro):");
for (const x of lentas) console.log(`  ${String(x.p95).padStart(6)} ms  p50 ${String(x.p50).padStart(5)}  5xx ${fmtPct(x.e5).padStart(5)}  n=${x.n}  ${x.rota}`);

console.log(motivoParada ? `\nPAROU: ${motivoParada} (degrau de ${degraus[degrauAtual].rps} req/s)` : "\nterminou todos os degraus sem atingir o limite");
console.log(ultimoSaudavel ? `ÚLTIMO DEGRAU SAUDÁVEL: ${ultimoSaudavel.rpsAlvo} req/s (p95 ${ultimoSaudavel.p95} ms, 5xx ${fmtPct(ultimoSaudavel.e5)})` : "nenhum degrau saudável");
fs.writeFileSync(SAIDA, JSON.stringify({ quando: new Date().toISOString(), base: BASE, degraus, motivoParada, ultimoSaudavel, resultados, lentas, servidor, sonda }, null, 1));
console.log(`detalhe: ${SAIDA}`);
process.exit(0);
