// Painel Gerencial — aba LIDERANÇA.
//
// Responde "como as lideranças estão sendo avaliadas": o índice 1–5 de cada
// uma, a distribuição por faixa e a evolução no trimestre. A nota sai das
// DIMENSÕES escolhidas no mapeamento; quem lidera cada resposta vem da
// hierarquia (setor → diretor → CEO), nunca da própria pessoa avaliada.
//
// Só desenha: o cálculo todo chega pronto por prop, de PainelGerencial.
import {
  ResponsiveContainer, BarChart, Bar, LineChart, Line, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, LabelList,
} from "recharts";
import { Alerta, ChartFaixas, Kpi, Painel, Vazio, btn, evolCor, evolTxt, nf } from "./ui";
import { ItemDist, Lider, Viz } from "./tipos";

function TabelaLideres({ titulo, lista, cor }: { titulo: string; lista: Lider[]; cor: string }) {
  return (
    <Painel titulo={titulo} semViz>
      {lista.length === 0 ? <Vazio /> : (
        <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          <div style={{ display: "flex", gap: 8, fontSize: 10, fontWeight: 800, color: "#94a3b8", textTransform: "uppercase", letterSpacing: ".4px" }}>
            <span style={{ width: 14 }}>#</span><span style={{ flex: 1 }}>Liderança</span><span style={{ width: 46, textAlign: "right" }}>Índice</span><span style={{ width: 58, textAlign: "right" }}>Evolução</span>
          </div>
          {lista.map((l, i) => (
            <div key={l.lider} style={{ display: "flex", gap: 8, fontSize: 12.5, alignItems: "baseline", borderTop: "1px solid #f1f5f9", paddingTop: 5 }}>
              <span style={{ width: 14, fontWeight: 800, color: "#94a3b8" }}>{i + 1}</span>
              <span style={{ flex: 1, color: "#0f172a", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={`${l.lider} · ${l.n} avaliação(ões)`}>{l.lider}</span>
              <span style={{ width: 46, textAlign: "right", fontWeight: 800, color: cor }}>{nf(l.indice)}</span>
              <span style={{ width: 58, textAlign: "right", fontSize: 11.5, fontWeight: 700, color: evolCor(l.evol) }}>{evolTxt(l.evol)}</span>
            </div>
          ))}
        </div>
      )}
    </Painel>
  );
}

export default function PainelLideranca({ indice, dist, porDim, evol, delta, avaliados, lideres, temMapa, ultima, onExport, viz, onViz, onAbrirMapa }: {
  indice: number | null; dist: ItemDist[];
  porDim: { nome: string; completo: string; valor: number; n: number }[];
  evol: { tri: string; indice: number }[]; delta: number | null; avaliados: number; lideres: Lider[];
  temMapa: boolean; ultima: string; onExport: () => void;
  viz: Record<string, Viz>; onViz: (k: string, v: Viz) => void; onAbrirMapa: () => void;
}) {
  if (!temMapa) {
    return (
      <div style={{ padding: 40, textAlign: "center", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 14 }}>
        <div style={{ fontSize: 15, fontWeight: 800, color: "#0f172a", marginBottom: 6 }}>Falta configurar a Liderança</div>
        <div style={{ fontSize: 12.5, color: "#64748b", maxWidth: 520, margin: "0 auto 14px" }}>
          Para calcular o índice eu preciso saber <b>qual pergunta identifica a liderança</b> avaliada e <b>quais perguntas são as dimensões</b> (viram nota de 1 a 5).
        </div>
        <button onClick={onAbrirMapa} style={btn("#0f3171")}>⚙ Abrir mapeamento</button>
      </div>
    );
  }
  const destaque = lideres.filter(l => l.indice >= 4);
  const atencao = lideres.filter(l => l.indice >= 3 && l.indice < 4);
  const critica = lideres.filter(l => l.indice < 3);
  const maxDim = Math.max(5, ...porDim.map(d => d.valor));
  return (
    <>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 14, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 21, fontWeight: 800, color: "#0f172a" }}>LIDERANÇA</div>
          <div style={{ fontSize: 12.5, color: "#64748b" }}>Avaliação da liderança percebida pela equipe.</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ fontSize: 10.5, color: "#94a3b8", textAlign: "right", lineHeight: 1.4 }}>Última atualização<br /><b style={{ color: "#475569" }}>{ultima}</b></div>
          <button onClick={onExport} style={btn("#fff", "#0f3171", "1px solid #0f3171")}>⬇ Exportar relatório</button>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))", gap: 12, marginBottom: 16 }}>
        <Kpi titulo="Índice geral de liderança" valor={indice != null ? `${nf(indice)} / 5` : "—"} cor="#7c3aed" icone="⭐" sub="Média no período (1–5)" />
        <Kpi titulo="Lideranças em destaque" valor={destaque.length} cor="#16a34a" icone="📈" sub="Acima de 4,0" />
        <Kpi titulo="Lideranças em atenção" valor={atencao.length} cor="#f59e0b" icone="🙂" sub="Entre 3,0 e 4,0" />
        <Kpi titulo="Lideranças críticas" valor={critica.length} cor="#dc2626" icone="⚠️" sub="Abaixo de 3,0" />
        <Kpi titulo="Profissionais avaliados" valor={avaliados} cor="#2563eb" icone="👥" sub="Com avaliação de liderança" />
        <Kpi titulo="Evolução do índice" valor={delta != null ? `${delta >= 0 ? "+" : "−"}${Math.abs(delta).toFixed(2).replace(".", ",")}` : "—"} cor={delta != null && delta < 0 ? "#dc2626" : "#0891b2"} icone="📊" sub="vs. período anterior" />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(320px,1fr))", gap: 14, marginBottom: 14 }}>
        <Painel titulo="Evolução do índice geral de liderança" viz={viz.lidEvol ?? "linha"} onViz={v => onViz("lidEvol", v)} vizOpts={["linha", "area", "colunas"]} semPerg>
          {evol.length === 0 ? <Vazio /> : (
            <ResponsiveContainer width="100%" height={230}>
              {(viz.lidEvol ?? "linha") === "colunas" ? (
                <BarChart data={evol} margin={{ top: 6, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                  <XAxis dataKey="tri" tick={{ fontSize: 10 }} /><YAxis domain={[1, 5]} tick={{ fontSize: 10 }} /><Tooltip />
                  <Bar dataKey="indice" fill="#7c3aed" radius={[4, 4, 0, 0]}><LabelList dataKey="indice" position="top" style={{ fontSize: 10, fill: "#475569" }} /></Bar>
                </BarChart>
              ) : (viz.lidEvol ?? "linha") === "area" ? (
                <AreaChart data={evol} margin={{ top: 6, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="tri" tick={{ fontSize: 10 }} /><YAxis domain={[1, 5]} tick={{ fontSize: 10 }} /><Tooltip />
                  <Area type="monotone" dataKey="indice" stroke="#7c3aed" fill="#7c3aed" fillOpacity={0.18} strokeWidth={2} />
                </AreaChart>
              ) : (
                <LineChart data={evol} margin={{ top: 6, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="tri" tick={{ fontSize: 10 }} /><YAxis domain={[1, 5]} tick={{ fontSize: 10 }} /><Tooltip />
                  <Line type="monotone" dataKey="indice" stroke="#7c3aed" strokeWidth={2.5} dot={{ r: 4 }}>
                    <LabelList dataKey="indice" position="top" style={{ fontSize: 10, fill: "#475569" }} />
                  </Line>
                </LineChart>
              )}
            </ResponsiveContainer>
          )}
        </Painel>

        <Painel titulo="Distribuição do índice de liderança" viz={viz.lidDist ?? "rosca"} onViz={v => onViz("lidDist", v)} semPerg>
          <ChartFaixas dados={dist} viz={viz.lidDist ?? "rosca"} />
        </Painel>

        <Painel titulo="Índice por dimensão de liderança" semViz>
          {porDim.length === 0 ? <Vazio /> : (
            <div>
              {porDim.map(d => (
                <div key={d.completo} style={{ marginBottom: 9 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5, marginBottom: 3, gap: 8 }}>
                    <span style={{ color: "#334155", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={d.completo}>{d.nome}</span>
                    <b style={{ color: "#0f172a" }}>{nf(d.valor)}</b>
                  </div>
                  <div style={{ height: 8, background: "#eef2f7", borderRadius: 20, overflow: "hidden" }}>
                    <div style={{ width: `${(d.valor / maxDim) * 100}%`, height: "100%", background: "#7c3aed", borderRadius: 20 }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </Painel>

        <Painel titulo="Insights principais" semViz>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: 12.5, color: "#334155" }}>
            {porDim.length > 0 && <div>✅ Ponto mais forte: <b>{porDim[0].completo}</b> ({nf(porDim[0].valor)}).</div>}
            {porDim.length > 1 && <div>📈 Maior oportunidade: <b>{porDim[porDim.length - 1].completo}</b> ({nf(porDim[porDim.length - 1].valor)}).</div>}
            {critica.length > 0 && <div>⚠️ <b>{critica.length}</b> liderança(s) abaixo de 3,0 — apoio imediato.</div>}
            {delta != null && <div>{delta >= 0 ? "🟢" : "🔴"} O índice {delta >= 0 ? "subiu" : "caiu"} <b>{Math.abs(delta).toFixed(2).replace(".", ",")}</b> vs. o período anterior.</div>}
          </div>
        </Painel>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(300px,1fr))", gap: 14, marginBottom: 14 }}>
        <TabelaLideres titulo="Top 5 – Lideranças melhor avaliadas" lista={destaque.slice(0, 5)} cor="#16a34a" />
        <TabelaLideres titulo="Top 5 – Lideranças em atenção" lista={atencao.slice(0, 5)} cor="#f59e0b" />
        <TabelaLideres titulo="Top 5 – Lideranças críticas" lista={critica.slice(-5).reverse()} cor="#dc2626" />
        <Painel titulo="Alertas de liderança" semViz>
          <div style={{ display: "flex", flexDirection: "column", gap: 9, fontSize: 12.5 }}>
            <Alerta cor="#dc2626" titulo={`${critica.length} liderança(s) com índice abaixo de 3,0`} sub="Ação imediata recomendada" />
            <Alerta cor="#f59e0b" titulo={`${atencao.length} liderança(s) em atenção (3,0 a 4,0)`} sub="Acompanhar e apoiar desenvolvimento" />
            <Alerta cor="#2563eb" titulo={`${lideres.filter(l => l.evol != null && l.evol < 0).length} liderança(s) em queda`} sub="Comparado ao período anterior" />
          </div>
        </Painel>
      </div>
    </>
  );
}
