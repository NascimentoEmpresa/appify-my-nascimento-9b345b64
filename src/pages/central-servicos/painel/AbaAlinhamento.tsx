// Painel Gerencial — aba ALINHAMENTO E ENTREGA.
//
// Três indicadores viram nota 1–5 (alinhamento às metas, qualidade da entrega
// e contribuição para resultados) e o painel os quebra por setor e por
// liderança, com a evolução contra o trimestre anterior.
//
// Só desenha: o cálculo todo chega pronto por prop, de PainelGerencial.
import {
  ResponsiveContainer, BarChart, Bar, LineChart, Line, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, LabelList,
} from "recharts";
import { Alerta, ChartFaixas, Kpi, KpiIndice, Painel, Vazio, btn, evolCor, evolTxt, nf } from "./ui";
import { SEM_SETOR } from "./calculos";
import { Grupo, ItemDist, Viz } from "./tipos";

function TabelaGrupo({ titulo, lista, colChave, colValor, cor }: { titulo: string; lista: Grupo[]; colChave: string; colValor: string; cor: string }) {
  return (
    <Painel titulo={titulo} semViz>
      {lista.length === 0 ? <Vazio /> : (
        <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          <div style={{ display: "flex", gap: 8, fontSize: 10, fontWeight: 800, color: "#94a3b8", textTransform: "uppercase", letterSpacing: ".4px" }}>
            <span style={{ width: 14 }}>#</span><span style={{ flex: 1 }}>{colChave}</span>
            <span style={{ width: 52, textAlign: "right" }}>{colValor}</span><span style={{ width: 58, textAlign: "right" }}>Evolução</span>
          </div>
          {lista.map((x, i) => (
            <div key={x.chave} style={{ display: "flex", gap: 8, fontSize: 12.5, alignItems: "baseline", borderTop: "1px solid #f1f5f9", paddingTop: 5 }}>
              <span style={{ width: 14, fontWeight: 800, color: "#94a3b8" }}>{i + 1}</span>
              <span style={{ flex: 1, color: "#0f172a", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={`${x.chave} · ${x.n} avaliação(ões)`}>{x.chave}</span>
              <span style={{ width: 52, textAlign: "right", fontWeight: 800, color: cor }}>{nf(x.media)}</span>
              <span style={{ width: 58, textAlign: "right", fontSize: 11.5, fontWeight: 700, color: evolCor(x.evol) }}>{evolTxt(x.evol)}</span>
            </div>
          ))}
        </div>
      )}
    </Painel>
  );
}

export default function PainelAlinhamento({ k, dist, porSetor, topLidAlin, topSetorEntrega, topLidContrib, temMapa, ultima, onExport, viz, onViz, onAbrirMapa }: {
  k: { alin: number | null; dAlin: number | null; ent: number | null; dEnt: number | null; con: number | null; dCon: number | null; geral: number | null; dGeral: number | null; serieGeral: { tri: string; valor: number }[]; metasConcl: number | null; metasPrazo: number | null };
  dist: ItemDist[]; porSetor: Grupo[];
  topLidAlin: Grupo[]; topSetorEntrega: Grupo[]; topLidContrib: Grupo[];
  temMapa: boolean; ultima: string; onExport: () => void;
  viz: Record<string, Viz>; onViz: (k: string, v: Viz) => void; onAbrirMapa: () => void;
}) {
  if (!temMapa) {
    return (
      <div style={{ padding: 40, textAlign: "center", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 14 }}>
        <div style={{ fontSize: 15, fontWeight: 800, color: "#0f172a", marginBottom: 6 }}>Falta configurar Alinhamento e Entrega</div>
        <div style={{ fontSize: 12.5, color: "#64748b", maxWidth: 540, margin: "0 auto 14px" }}>
          Preciso saber quais perguntas medem <b>alinhamento às metas</b>, <b>qualidade da entrega</b> e <b>contribuição para resultados</b>.
        </div>
        <button onClick={onAbrirMapa} style={btn("#0f3171")}>⚙ Abrir mapeamento</button>
      </div>
    );
  }
  const maxSetor = Math.max(5, ...porSetor.map(s => s.media));
  const vEvol = viz.alinEvol ?? "linha";
  const reais = porSetor.filter(s => s.chave !== SEM_SETOR);  // insights/alertas só com setor real
  const semSetor = porSetor.find(s => s.chave === SEM_SETOR);
  return (
    <>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 14, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 21, fontWeight: 800, color: "#0f172a" }}>ALINHAMENTO E ENTREGA</div>
          <div style={{ fontSize: 12.5, color: "#64748b" }}>Avaliação do alinhamento da equipe às metas, qualidade da entrega e contribuição para os resultados.</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ fontSize: 10.5, color: "#94a3b8", textAlign: "right", lineHeight: 1.4 }}>Última atualização<br /><b style={{ color: "#475569" }}>{ultima}</b></div>
          <button onClick={onExport} style={btn("#fff", "#0f3171", "1px solid #0f3171")}>⬇ Exportar relatório</button>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))", gap: 12, marginBottom: 16 }}>
        <KpiIndice titulo="Alinhamento às metas" valor={k.alin} delta={k.dAlin} cor="#2563eb" icone="🎯" />
        <KpiIndice titulo="Qualidade da entrega" valor={k.ent} delta={k.dEnt} cor="#16a34a" icone="✅" />
        <KpiIndice titulo="Contribuição para resultados" valor={k.con} delta={k.dCon} cor="#f59e0b" icone="👥" />
        <KpiIndice titulo="Índice geral de alinhamento" valor={k.geral} delta={k.dGeral} cor="#7c3aed" icone="⭐" />
        <Kpi titulo="Metas concluídas no período" valor={k.metasConcl != null ? `${Math.round(k.metasConcl)}%` : "—"} cor="#0891b2" icone="🏁"
          sub={k.metasConcl != null ? "Do total de metas" : "Mapeie a pergunta em ⚙"} />
        <Kpi titulo="Metas até o prazo" valor={k.metasPrazo != null ? `${Math.round(k.metasPrazo)}%` : "—"} cor="#dc2626" icone="⏱"
          sub={k.metasPrazo != null ? "No período" : "Mapeie a pergunta em ⚙"} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(320px,1fr))", gap: 14, marginBottom: 14 }}>
        <Painel titulo="Evolução do índice geral de alinhamento" viz={vEvol} onViz={v => onViz("alinEvol", v)} vizOpts={["linha", "area", "colunas"]} semPerg>
          {k.serieGeral.length === 0 ? <Vazio /> : (
            <ResponsiveContainer width="100%" height={230}>
              {vEvol === "colunas" ? (
                <BarChart data={k.serieGeral} margin={{ top: 6, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                  <XAxis dataKey="tri" tick={{ fontSize: 10 }} /><YAxis domain={[2, 5]} tick={{ fontSize: 10 }} /><Tooltip />
                  <Bar dataKey="valor" fill="#2563eb" radius={[4, 4, 0, 0]}><LabelList dataKey="valor" position="top" style={{ fontSize: 10, fill: "#475569" }} /></Bar>
                </BarChart>
              ) : vEvol === "area" ? (
                <AreaChart data={k.serieGeral} margin={{ top: 6, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="tri" tick={{ fontSize: 10 }} /><YAxis domain={[2, 5]} tick={{ fontSize: 10 }} /><Tooltip />
                  <Area type="monotone" dataKey="valor" stroke="#2563eb" fill="#2563eb" fillOpacity={0.18} strokeWidth={2} />
                </AreaChart>
              ) : (
                <LineChart data={k.serieGeral} margin={{ top: 6, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="tri" tick={{ fontSize: 10 }} /><YAxis domain={[2, 5]} tick={{ fontSize: 10 }} /><Tooltip />
                  <Line type="monotone" dataKey="valor" stroke="#2563eb" strokeWidth={2.5} dot={{ r: 4 }}>
                    <LabelList dataKey="valor" position="top" style={{ fontSize: 10, fill: "#475569" }} />
                  </Line>
                </LineChart>
              )}
            </ResponsiveContainer>
          )}
        </Painel>

        <Painel titulo="Distribuição do alinhamento da equipe" viz={viz.alinDist ?? "rosca"} onViz={v => onViz("alinDist", v)} semPerg>
          <ChartFaixas dados={dist} viz={viz.alinDist ?? "rosca"} rotulo="avaliações" />
        </Painel>

        <Painel titulo="Alinhamento por setor" semViz>
          {porSetor.length === 0 ? <Vazio /> : (
            <div>
              {porSetor.slice(0, 8).map(s => (
                <div key={s.chave} style={{ marginBottom: 9 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5, marginBottom: 3, gap: 8 }}>
                    <span style={{ color: "#334155", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={s.chave}>{s.chave}</span>
                    <b style={{ color: "#0f172a" }}>{nf(s.media)}</b>
                  </div>
                  <div style={{ height: 8, background: "#eef2f7", borderRadius: 20, overflow: "hidden" }}>
                    <div style={{ width: `${(s.media / maxSetor) * 100}%`, height: "100%", background: s.chave === SEM_SETOR ? "#cbd5e1" : "#4f46e5", borderRadius: 20 }} />
                  </div>
                </div>
              ))}
              {semSetor && (
                <div style={{ fontSize: 10.5, color: "#94a3b8", borderTop: "1px dashed #e2e8f0", paddingTop: 7, marginTop: 2 }}>
                  ⓘ <b>Sem setor</b> = {semSetor.n} resposta(s) de quem respondeu sem login/vínculo, num formulário sem pergunta de setor. Fica fora dos rankings.
                </div>
              )}
            </div>
          )}
        </Painel>

        <Painel titulo="Insights principais" semViz>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: 12.5, color: "#334155" }}>
            {reais.length > 0 && <div>📈 <b>{reais[0].chave}</b> lidera o alinhamento com média <b>{nf(reais[0].media)}</b>.</div>}
            {k.dEnt != null && <div>🎯 A qualidade da entrega {k.dEnt >= 0 ? "cresceu" : "caiu"} <b>{Math.abs(k.dEnt).toFixed(2).replace(".", ",")}</b> ponto(s).</div>}
            {k.metasPrazo != null && <div>⏱ <b>{Math.round(k.metasPrazo)}%</b> das metas foram concluídas dentro do prazo.</div>}
            {reais.length > 1 && <div>⚠️ <b>{reais[reais.length - 1].chave}</b> possui o menor índice ({nf(reais[reais.length - 1].media)}).</div>}
          </div>
        </Painel>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(300px,1fr))", gap: 14, marginBottom: 14 }}>
        <TabelaGrupo titulo="Top 5 – Líderes com melhor alinhamento" lista={topLidAlin.slice(0, 5)} colChave="Liderança" colValor="Índice" cor="#2563eb" />
        <TabelaGrupo titulo="Top 5 – Setores com melhor entrega" lista={topSetorEntrega.slice(0, 5)} colChave="Setor" colValor="Entrega" cor="#16a34a" />
        <TabelaGrupo titulo="Top 5 – Maiores contribuições" lista={topLidContrib.slice(0, 5)} colChave="Liderança" colValor="Contrib." cor="#f59e0b" />
        <Painel titulo="Alertas e atenções" semViz>
          <div style={{ display: "flex", flexDirection: "column", gap: 9, fontSize: 12.5 }}>
            <Alerta cor="#dc2626" titulo={`${dist[2]?.n ?? 0} avaliação(ões) com alinhamento baixo`} sub="Abaixo de 3,0 — acompanhar plano de ação" />
            <Alerta cor="#f59e0b" titulo={`${dist[1]?.n ?? 0} em nível médio (3,0 a 3,9)`} sub="Ação corretiva recomendada" />
            <Alerta cor="#2563eb" titulo={`${reais.filter(s => s.media < 3.5).length} setor(es) com índice abaixo de 3,5`} sub="Atenção da liderança" />
          </div>
        </Painel>
      </div>

      <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 14, padding: "14px 16px", boxShadow: "0 8px 24px rgba(15,23,42,.05)" }}>
        <div style={{ fontSize: 12, fontWeight: 800, color: "#0f3171", textTransform: "uppercase", letterSpacing: ".5px", marginBottom: 10 }}>Ações recomendadas</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(210px,1fr))", gap: 12 }}>
          {[
            { i: "🎯", t: `Reforçar alinhamento de metas${porSetor.length ? ` com ${porSetor[porSetor.length - 1].chave}` : ""}.` },
            { i: "👏", t: "Reconhecer e compartilhar boas práticas das equipes com maior entrega." },
            { i: "📈", t: "Acompanhar de perto as metas em risco de não conclusão." },
            { i: "💬", t: "Fortalecer comunicação entre áreas para melhorar contribuições." },
            { i: "✅", t: "Revisar metas do próximo ciclo com base nos gaps identificados." },
          ].map((a, i) => (
            <div key={i} style={{ display: "flex", gap: 9, alignItems: "flex-start" }}>
              <span style={{ width: 28, height: 28, borderRadius: 9, background: "#eef2ff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, flexShrink: 0 }}>{a.i}</span>
              <span style={{ fontSize: 12, color: "#475569", lineHeight: 1.45 }}>{a.t}</span>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
