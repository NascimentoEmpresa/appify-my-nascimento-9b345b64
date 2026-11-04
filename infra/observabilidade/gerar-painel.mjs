// Gera infra/observabilidade/painel-saude.json (dashboard do Grafana).
// Uso: node infra/observabilidade/gerar-painel.mjs
// Editar AQUI e regerar — o JSON é saída, não fonte.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

let id = 0, y = 0;
const P = "${DS_PROM}", L = "${DS_LOKI}";
const K = '{servico="kong"}';
const RX_ROTA = '| regexp "\\"(?P<metodo>[A-Z]+) (?P<rota>/[^ ?]+)" | label_format rota="{{ regexReplaceAll \\"[0-9a-f]{8}-[0-9a-f-]{27}\\" .rota \\":id\\" }}"';
const RX_RT = '| regexp "rt=(?P<rt>[0-9.]+)"';

const linha = (title) => { const p = { type: "row", title, id: ++id, gridPos: { h: 1, w: 24, x: 0, y }, collapsed: false, panels: [] }; y += 1; return p; };
function serie(title, ds, alvos, { unit = "short", desc = "", empilhar = false } = {}) {
  return {
    type: "timeseries", title, description: desc, id: ++id,
    datasource: { type: ds === P ? "prometheus" : "loki", uid: ds },
    gridPos: { h: 8, w: 12, x: 0, y },
    fieldConfig: {
      defaults: { unit, custom: { lineWidth: 2, fillOpacity: empilhar ? 40 : 8, stacking: { mode: empilhar ? "normal" : "none" } } },
      overrides: [{ matcher: { id: "byRegexp", options: ".*ontem.*" }, properties: [
        { id: "custom.lineStyle", value: { dash: [6, 6], fill: "dash" } }, { id: "color", value: { mode: "fixed", fixedColor: "gray" } }] }],
    },
    options: { legend: { displayMode: "list", placement: "bottom" }, tooltip: { mode: "multi" } },
    targets: alvos.map(([expr, legendFormat], i) => ({ refId: String.fromCharCode(65 + i), expr, legendFormat, datasource: { uid: ds } })),
  };
}
const lado = (...ps) => { const w = 24 / ps.length; ps.forEach((p, i) => { p.gridPos.x = i * w; p.gridPos.w = w; }); y += 8; return ps; };
const tabela = (title, expr, x) => ({
  type: "table", title, id: ++id, datasource: { type: "loki", uid: L }, gridPos: { h: 10, w: 12, x, y },
  targets: [{ refId: "A", datasource: { uid: L }, queryType: "instant", expr }],
  transformations: [{ id: "reduce", options: { reducers: ["lastNotNull"] } }],
});

const panels = [
  linha("Agora × ontem (linha tracejada cinza = mesma hora de ontem)"),
  ...lado(
    serie("Requisições por minuto", L, [
      [`sum by (classe) (count_over_time(${K}[1m]))`, "{{classe}}"],
      [`sum(count_over_time(${K}[1m] offset 1d))`, "total ontem"],
    ], { empilhar: true, desc: "Toda requisição à API (sem OPTIONS), log do Kong dos dois nós. 5xx = o usuário viu erro." }),
    serie("% de respostas 5xx", L, [
      [`100 * sum(count_over_time({servico="kong",classe="5xx"}[1m])) / sum(count_over_time(${K}[1m]))`, "hoje"],
      [`100 * sum(count_over_time({servico="kong",classe="5xx"}[1m] offset 1d)) / sum(count_over_time(${K}[1m] offset 1d))`, "ontem"],
    ], { unit: "percent", desc: "Acima de 2 % por 2 min = alerta. Em 03/11/2026 chegou a 60 %." }),
  ),
  ...lado(
    serie("Tempo de resposta p95", L, [
      [`quantile_over_time(0.95, ${K} ${RX_RT} | unwrap rt [1m]) by (no)`, "{{no}}"],
      [`quantile_over_time(0.95, ${K} ${RX_RT} | unwrap rt [1m] offset 1d)`, "ontem"],
    ], { unit: "s", desc: "rt= do log do Kong. O monitor de queda do ERP desiste em 8 s." }),
    serie("CPU ocupada por nó", P, [
      ['100 - 100 * avg by (no) (rate(node_cpu_seconds_total{mode="idle"}[2m]))', "{{no}}"],
      ['100 - 100 * avg by (no) (rate(node_cpu_seconds_total{mode="idle"}[2m] offset 1d))', "{{no}} ontem"],
    ], { unit: "percent", desc: "O teto do ERP é CPU do banco1 (teste de carga 03/11: ~85 req/s com 2 núcleos cheios)." }),
  ),
  linha("PostgREST — as causas da queda de 03/11, ao vivo"),
  ...lado(
    serie("Pool: livres / esperando / máximo", P, [
      ["pgrst_db_pool_available", "livres {{no}}"], ["pgrst_db_pool_waiting", "esperando {{no}}"], ["pgrst_db_pool_max", "máximo {{no}}"],
    ], { desc: "Esperando > 0 por mais de 1 min = pool cheio (C1 do post-mortem). Livres = 0 é o prenúncio." }),
    serie("Pool esgotado (PGRST003) em 5 min", P, [["increase(pgrst_db_pool_timeouts_total[5m])", "{{no}}"]], { desc: "Cada um = um usuário recebeu 504." }),
    serie("Recargas de schema em 5 min", P, [["increase(pgrst_schema_cache_loads_total[5m])", "{{status}} {{no}}"]],
      { desc: "status=FAIL = a recarga estourou e o PostgREST derrubou o pool (C2). Toda migration aplicada gera uma recarga." }),
  ),
  linha("Banco"),
  ...lado(
    serie("Conexões no Postgres por estado", P, [['sum by (state) (pg_stat_activity_count{no="banco1"})', "{{state}}"]], { empilhar: true }),
    serie("Statement timeout em 5 min", L, [['sum(count_over_time({servico="postgres", no="banco1"} |= "statement timeout" [5m]))', "timeouts"]],
      { desc: "Consulta cancelada por passar de 8 s (authenticated) ou 3 s (anon)." }),
    serie("Patroni: líder (1) e atraso de replay", P, [
      ["patroni_primary", "líder {{no}}"], ["patroni_xlog_received_location - patroni_xlog_replayed_location", "atraso {{no}} (bytes)"],
    ], { desc: "Troca de líder aparece como cruzamento das linhas." }),
  ),
  linha("Máquinas e containers"),
  ...lado(
    serie("CPU por container (núcleos)", P, [['sum by (name, no) (rate(container_cpu_usage_seconds_total{name=~"erp-pilha.*"}[2m]))', "{{name}} {{no}}"]],
      { desc: "O que faltou em 03/11: o sar não separa por processo." }),
    serie("Memória disponível", P, [["node_memory_MemAvailable_bytes", "{{no}}"]], { unit: "bytes" }),
    serie("Disco usado", P, [['100 - 100 * node_filesystem_avail_bytes{mountpoint="/"} / node_filesystem_size_bytes{mountpoint="/"}', "{{no}}"]],
      { unit: "percent", desc: "banco2 estava em 86 % em 03/11/2026." }),
  ),
  linha("Rotas"),
  tabela("Rotas mais chamadas (período do painel)", `topk(20, sum by (rota) (count_over_time(${K} ${RX_ROTA} [$__range])))`, 0),
  tabela("Rotas mais lentas — p95 em s (período do painel)", `topk(20, quantile_over_time(0.95, ${K} ${RX_ROTA} ${RX_RT} | unwrap rt [$__range]) by (rota))`, 12),
];
y += 10;
panels.push({
  type: "logs", title: "Erros recentes (Postgres e PostgREST)", id: ++id, datasource: { type: "loki", uid: L }, gridPos: { h: 12, w: 24, x: 0, y },
  targets: [{ refId: "A", datasource: { uid: L }, expr: '{servico=~"postgres|rest"} |~ "ERROR|FATAL|PANIC|PGRST0|schema cache|reconnect"' }],
  options: { showTime: true, wrapLogMessage: true, sortOrder: "Descending" },
});

const painel = {
  __inputs: [
    { name: "DS_PROM", label: "Prometheus (grafanacloud-…-prom)", type: "datasource", pluginId: "prometheus" },
    { name: "DS_LOKI", label: "Loki (grafanacloud-…-logs)", type: "datasource", pluginId: "loki" },
  ],
  title: "ERP — Saúde da produção", uid: "erp-saude-producao", tags: ["erp", "producao"],
  timezone: "America/Sao_Paulo", schemaVersion: 39, version: 1, time: { from: "now-24h", to: "now" }, panels,
  description: "Item 8 (03/11/2026). Linha tracejada = mesma hora de ontem. Fonte: infra/observabilidade/gerar-painel.mjs.",
};
const destino = path.join(path.dirname(fileURLToPath(import.meta.url)), "painel-saude.json");
fs.writeFileSync(destino, JSON.stringify(painel, null, 1));
console.log(`${panels.length} painéis -> ${destino}`);
