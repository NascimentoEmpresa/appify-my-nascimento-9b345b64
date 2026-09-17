import { useMemo } from "react";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Cell, PieChart, Pie, Legend, CartesianGrid } from "recharts";
import { AVALIACOES, resumoDashboard, type Duvida } from "@/lib/juridico/duvidas";

// =====================================================================
// Dashboard do Parecer Jurídico (17/09/2026, mig 176): avaliações de quem
// perguntou e as categorias das perguntas. Aparece só pra quem tem o menu
// fantasma `duvidas_dashboard` (Administração › Acesso por Usuário). Os
// números vêm de resumoDashboard() — lib com teste; aqui é só desenho.
// =====================================================================

const CORES_CAT = ["#0f3171", "#2563eb", "#0891b2", "#16a34a", "#eab308", "#ea580c", "#dc2626", "#9333ea", "#db2777", "#64748b"];
const fmtDt = (s?: string | null) => { if (!s) return "—"; const d = new Date(s); return isNaN(+d) ? String(s) : d.toLocaleDateString("pt-BR"); };

function Kpi({ rotulo, valor, sub, cor }: { rotulo: string; valor: string | number; sub?: string; cor: string }) {
  return (
    <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 14, padding: "12px 16px", flex: 1, minWidth: 150, boxShadow: "0 8px 24px rgba(15,23,42,.05)" }}>
      <div style={{ fontSize: 11.5, fontWeight: 800, color: "#64748b", textTransform: "uppercase", letterSpacing: ".5px" }}>{rotulo}</div>
      <div style={{ fontSize: 26, fontWeight: 900, color: cor, marginTop: 2, lineHeight: 1.1 }}>{valor}</div>
      {sub && <div style={{ fontSize: 12, color: "#64748b", marginTop: 3 }}>{sub}</div>}
    </div>
  );
}

function Bloco({ titulo, children, largo }: { titulo: string; children: React.ReactNode; largo?: boolean }) {
  return (
    <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 16, padding: "16px 18px", boxShadow: "0 8px 24px rgba(15,23,42,.05)", gridColumn: largo ? "1 / -1" : undefined, minWidth: 0 }}>
      <div style={{ fontSize: 13, fontWeight: 800, color: "#0f172a", marginBottom: 10 }}>{titulo}</div>
      {children}
    </div>
  );
}

export function DashboardDuvidas({ duvidas }: { duvidas: Duvida[] }) {
  const r = useMemo(() => resumoDashboard(duvidas), [duvidas]);
  const pizza = AVALIACOES.map(a => ({ nome: a.rotulo, n: r[a.valor], cor: a.cor })).filter(x => x.n > 0);
  const semAv = r.semAvaliacao;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <Kpi rotulo="Perguntas" valor={r.total} sub={`${r.respondidas} respondidas`} cor="#0f3171" />
        <Kpi rotulo="Satisfação" valor={r.satisfacao == null ? "—" : `${r.satisfacao}%`} sub={`"Resolveu" entre ${r.avaliadas} avaliada${r.avaliadas === 1 ? "" : "s"}`} cor={r.satisfacao == null ? "#64748b" : r.satisfacao >= 70 ? "#15803d" : r.satisfacao >= 40 ? "#b45309" : "#b91c1c"} />
        <Kpi rotulo="Não resolveu" valor={r.nao_resolveu} sub="fora da biblioteca" cor="#b91c1c" />
        <Kpi rotulo="Sem avaliação" valor={semAv} sub="respondidas que ninguém avaliou" cor="#7c3aed" />
        <Kpi rotulo="Tempo de resposta" valor={r.tempoMedioDias == null ? "—" : `${r.tempoMedioDias} d`} sub="média, da pergunta à resposta" cor="#0891b2" />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: 14 }}>
        <Bloco titulo="Avaliações de quem perguntou">
          {pizza.length === 0 ? <div style={{ fontSize: 13, color: "#64748b" }}>Nenhuma resposta avaliada ainda.</div> : (
            <ResponsiveContainer width="100%" height={240}>
              <PieChart>
                <Pie data={pizza} dataKey="n" nameKey="nome" cx="50%" cy="50%" innerRadius={55} outerRadius={90} label={e => `${e.n}`}>
                  {pizza.map(p => <Cell key={p.nome} fill={p.cor} />)}
                </Pie>
                <Tooltip formatter={(v, n) => [v, n]} />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          )}
        </Bloco>

        <Bloco titulo="Perguntas por status">
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={r.porStatus} layout="vertical" margin={{ left: 10, right: 20 }}>
              <CartesianGrid strokeDasharray="3 3" horizontal={false} />
              <XAxis type="number" allowDecimals={false} />
              <YAxis type="category" dataKey="status" width={92} tick={{ fontSize: 12 }} />
              <Tooltip formatter={v => [v, "perguntas"]} />
              <Bar dataKey="n" radius={[0, 6, 6, 0]}>
                {r.porStatus.map(s => <Cell key={s.status} fill={s.status === "Respondida" ? "#15803d" : s.status === "Reprovada" ? "#b91c1c" : s.status === "Aprovada" ? "#7c3aed" : "#ea580c"} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Bloco>

        <Bloco titulo="Categorias — perguntas e como foram avaliadas" largo>
          {r.porCategoria.length === 0 ? <div style={{ fontSize: 13, color: "#64748b" }}>Sem perguntas.</div> : (
            <ResponsiveContainer width="100%" height={Math.max(220, r.porCategoria.length * 38)}>
              <BarChart data={r.porCategoria} layout="vertical" margin={{ left: 10, right: 20 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                <XAxis type="number" allowDecimals={false} />
                <YAxis type="category" dataKey="categoria" width={110} tick={{ fontSize: 12 }} />
                <Tooltip />
                <Legend />
                <Bar dataKey="resolveu" name="Resolveu" stackId="a" fill="#15803d" />
                <Bar dataKey="parcial" name="Em parte" stackId="a" fill="#f59e0b" />
                <Bar dataKey="nao_resolveu" name="Não resolveu" stackId="a" fill="#dc2626" />
                <Bar dataKey="sem_avaliacao" name="Sem avaliação" stackId="a" fill="#c4b5fd" />
              </BarChart>
            </ResponsiveContainer>
          )}
          <div style={{ overflowX: "auto", marginTop: 8 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
              <thead>
                <tr style={{ color: "#64748b", textAlign: "left" }}>
                  {["Categoria", "Perguntas", "Respondidas", "Resolveu", "Em parte", "Não resolveu", "Sem avaliação", "Satisfação"].map(h => <th key={h} style={{ padding: "6px 8px", borderBottom: "1px solid #e2e8f0", fontWeight: 800, fontSize: 11.5, textTransform: "uppercase", letterSpacing: ".3px" }}>{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {r.porCategoria.map((c, i) => (
                  <tr key={c.categoria} style={{ borderBottom: "1px solid #f1f5f9" }}>
                    <td style={{ padding: "7px 8px", fontWeight: 800, color: "#0f172a" }}><span style={{ display: "inline-block", width: 9, height: 9, borderRadius: 3, background: CORES_CAT[i % CORES_CAT.length], marginRight: 7 }} />{c.categoria}</td>
                    <td style={{ padding: "7px 8px" }}>{c.total}</td>
                    <td style={{ padding: "7px 8px" }}>{c.respondidas}</td>
                    <td style={{ padding: "7px 8px", color: "#15803d", fontWeight: 700 }}>{c.resolveu}</td>
                    <td style={{ padding: "7px 8px", color: "#b45309", fontWeight: 700 }}>{c.parcial}</td>
                    <td style={{ padding: "7px 8px", color: "#b91c1c", fontWeight: 700 }}>{c.nao_resolveu}</td>
                    <td style={{ padding: "7px 8px", color: "#7c3aed" }}>{c.sem_avaliacao}</td>
                    <td style={{ padding: "7px 8px", fontWeight: 800, color: c.satisfacao == null ? "#94a3b8" : c.satisfacao >= 70 ? "#15803d" : c.satisfacao >= 40 ? "#b45309" : "#b91c1c" }}>{c.satisfacao == null ? "—" : `${c.satisfacao}%`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Bloco>

        {r.naoResolvidas.length > 0 && (
          <Bloco titulo={`"Não resolveu" — o que precisa de outra resposta (${r.naoResolvidas.length})`} largo>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {r.naoResolvidas.map(d => (
                <div key={d.id} style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "8px 11px", borderRadius: 10, background: "#fef2f2", border: "1px solid #fecaca", flexWrap: "wrap" }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 800, color: "#0f172a", fontSize: 13 }}>{d.titulo} <span style={{ fontWeight: 600, color: "#64748b" }}>· {d.categoria || "Sem categoria"} · {d.autor_nome || "—"}</span></div>
                    {d.avaliacao_comentario && <div style={{ fontSize: 12.5, color: "#7f1d1d", fontStyle: "italic" }}>“{d.avaliacao_comentario}”</div>}
                  </div>
                  <div style={{ fontSize: 12, color: "#64748b", whiteSpace: "nowrap" }}>avaliada em {fmtDt(d.avaliado_em)}</div>
                </div>
              ))}
            </div>
          </Bloco>
        )}
      </div>
    </div>
  );
}
