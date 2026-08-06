import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Cell,
  LineChart, Line, PieChart, Pie, Legend,
} from "recharts";

// =====================================================================
// RECRUTAMENTO — Dashboard
// KPIs + gráficos: currículos por período, solicitações por status,
// tempo médio por etapa, candidaturas por vaga.
// =====================================================================

const STATUS_PROCESSO = [
  "Vaga aberta - Seleção de Currículos", "Em análise jurídica", "Entrevista e Avaliação",
  "Entrevista com Gestor", "Aprovado - Aguardando SST", "Encaminhado para SST (ASO)",
  "ASO Aprovado - Aguardando Informe de EPIs", "Aguardando Confirmação Compras",
  "Compras Confirmou - Aguardando Documentação",
];
const dayKey = (d: Date) => d.toISOString().slice(0, 10);
const startOf = (days: number) => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - days); return d; };

export default function RecrutamentoDashboard() {
  const [loading, setLoading] = useState(true);
  const [sols, setSols] = useState<any[]>([]);
  const [curs, setCurs] = useState<any[]>([]);
  const [tempos, setTempos] = useState<{ etapa: string; dias: number }[]>([]);
  const [mes, setMes] = useState<string>(() => new Date().toISOString().slice(0, 7)); // YYYY-MM ("" = todos)

  useEffect(() => {
    (async () => {
      setLoading(true);
      const [{ data: s }, { data: c }, { data: log }] = await Promise.all([
        (supabase as any).from("SISTEMA_RECRUTAMENTO").select("id,cargo,status,created_at"),
        (supabase as any).from("WA_CURRICULOS").select("id,vaga_id,created_at,tipo_candidatura,etapa_processo"),
        (supabase as any).from("SISTEMA_RECRUTAMENTO_STATUS_LOG").select("status_anterior,dias_no_anterior"),
      ]);
      setSols(s ?? []);
      setCurs(c ?? []);
      // Tempo médio por etapa (dias) a partir do log de transições.
      const acc: Record<string, { soma: number; n: number }> = {};
      (log ?? []).forEach((r: any) => {
        const k = r.status_anterior; const v = Number(r.dias_no_anterior);
        if (!k || isNaN(v)) return;
        (acc[k] = acc[k] || { soma: 0, n: 0 }); acc[k].soma += v; acc[k].n += 1;
      });
      const ordem = ["Pendente Operacional", "Pendente Recrutamento", ...STATUS_PROCESSO];
      setTempos(Object.entries(acc)
        .map(([etapa, v]) => ({ etapa, dias: +(v.soma / v.n).toFixed(1) }))
        .sort((a, b) => ordem.indexOf(a.etapa) - ordem.indexOf(b.etapa)));
      setLoading(false);
    })();
  }, []);

  // ── Métricas ──────────────────────────────────────────────────
  // ── Filtro por mês (created_at) ────────────────────────────────
  const noMes = (s?: string) => !mes || String(s ?? "").slice(0, 7) === mes;
  const solsF = sols.filter(s => noMes(s.created_at));
  const cursF = curs.filter(c => noMes(c.created_at));
  const mesesOpc = (() => {
    const now = new Date(); const out: string[] = [];
    for (let i = 0; i < 12; i++) out.push(new Date(now.getFullYear(), now.getMonth() - i, 1).toISOString().slice(0, 7));
    return out;
  })();
  const mesLabel = (m: string) => {
    if (!m) return "Todos os meses";
    const [y, mm] = m.split("-");
    return `${["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"][+mm - 1]}/${y}`;
  };

  const total = solsF.length;
  const emProcesso = solsF.filter(s => STATUS_PROCESSO.includes(s.status)).length;
  const contratados = solsF.filter(s => s.status === "Contratado" || String(s.status ?? "").startsWith("Concluído")).length;
  const reprovadas = solsF.filter(s => s.status === "Reprovada").length;
  const pendOp = solsF.filter(s => s.status === "Pendente Operacional").length;
  const pendRec = solsF.filter(s => s.status === "Pendente Recrutamento").length;

  const t0 = startOf(0), t7 = startOf(7);
  const curvHoje = curs.filter(c => new Date(c.created_at) >= t0).length;
  const curvSemana = curs.filter(c => new Date(c.created_at) >= t7).length;
  const curvMes = cursF.length; // currículos do mês selecionado

  // Currículos por dia — do mês selecionado (ou últimos 14 dias se "Todos")
  const dias14: { dia: string; qtd: number }[] = [];
  if (mes) {
    const [y, mm] = mes.split("-").map(Number);
    const nDias = new Date(y, mm, 0).getDate();
    for (let d = 1; d <= nDias; d++) {
      const k = `${mes}-${String(d).padStart(2, "0")}`;
      dias14.push({ dia: `${d}`, qtd: curs.filter(c => dayKey(new Date(c.created_at)) === k).length });
    }
  } else {
    for (let i = 13; i >= 0; i--) {
      const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - i);
      const k = dayKey(d);
      dias14.push({ dia: `${d.getDate()}/${d.getMonth() + 1}`, qtd: curs.filter(c => dayKey(new Date(c.created_at)) === k).length });
    }
  }

  // Solicitações por status (agrupado por fase para não poluir)
  const statusData = [
    { nome: "Pend. Operacional", qtd: pendOp, cor: "#f59e0b" },
    { nome: "Pend. Recrutamento", qtd: pendRec, cor: "#8b5cf6" },
    { nome: "Em processo", qtd: emProcesso, cor: "#3b82f6" },
    { nome: "Contratados", qtd: contratados, cor: "#16a34a" },
    { nome: "Reprovadas", qtd: reprovadas, cor: "#dc2626" },
  ];

  // Candidaturas por vaga (top 8)
  const porVaga: Record<number, number> = {};
  cursF.forEach(c => { if (c.vaga_id) porVaga[c.vaga_id] = (porVaga[c.vaga_id] || 0) + 1; });
  const cargoDe = (id: number) => sols.find(s => s.id === id)?.cargo || `#${id}`;
  const vagaData = Object.entries(porVaga)
    .map(([id, qtd]) => ({ vaga: `${cargoDe(+id)} #${id}`, qtd }))
    .sort((a, b) => b.qtd - a.qtd).slice(0, 8);
  const geral = cursF.filter(c => c.tipo_candidatura === "geral" && !c.vaga_id).length;

  const pieData = [
    { name: "Em processo", value: emProcesso, cor: "#3b82f6" },
    { name: "Contratados", value: contratados, cor: "#16a34a" },
    { name: "Reprovadas", value: reprovadas, cor: "#dc2626" },
  ].filter(x => x.value > 0);

  // Candidatos por etapa do kanban (funil do processo)
  // Mesma ordem do kanban em Recrutamento.tsx — o funil aqui é a leitura dele.
  const CAND_ETAPAS = ["ENTRADA", "TRIAGEM", "JURÍDICO", "ENTREVISTA", "ENTREVISTA GESTOR", "APROVADO", "DOCUMENTAÇÃO", "EXAME SST", "COMPRAS", "ADMISSÃO", "Reprovado"];
  const etapaCor: Record<string, string> = {
    ENTRADA: "#64748b", TRIAGEM: "#3b82f6", "JURÍDICO": "#8b5cf6", ENTREVISTA: "#0ea5e9",
    "ENTREVISTA GESTOR": "#6366f1", APROVADO: "#14b8a6", "DOCUMENTAÇÃO": "#0891b2",
    "EXAME SST": "#f59e0b", COMPRAS: "#f97316", "ADMISSÃO": "#16a34a", Reprovado: "#dc2626",
  };
  const etapaData = CAND_ETAPAS
    .map(e => ({ etapa: e, qtd: cursF.filter(c => c.etapa_processo === e).length }))
    .filter(d => d.qtd > 0);

  const Kpi = ({ label, val, color }: { label: string; val: number | string; color: string }) => (
    <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 16, padding: "14px 16px", boxShadow: "0 8px 24px rgba(15,23,42,.06)" }}>
      <div style={{ fontSize: 10, color: "#94a3b8", textTransform: "uppercase", letterSpacing: ".7px", marginBottom: 6, fontWeight: 700 }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 800, color }}>{val}</div>
    </div>
  );
  const Card = ({ title, children, h = 300 }: { title: string; children: any; h?: number }) => (
    <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 18, padding: 18, boxShadow: "0 8px 24px rgba(15,23,42,.06)" }}>
      <div style={{ fontSize: 14, fontWeight: 800, color: "#0f3171", marginBottom: 12 }}>{title}</div>
      <div style={{ width: "100%", height: h }}>{children}</div>
    </div>
  );

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", background: "#f5f7fb" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14, flexWrap: "wrap", padding: "16px 22px", margin: "18px 24px 0", border: "1px solid #e2e8f0", borderRadius: 18, background: "linear-gradient(135deg,#fff 0%,#f8fbff 100%)", boxShadow: "0 8px 24px rgba(15,23,42,.06)", flexShrink: 0 }}>
        <div>
          <div style={{ fontSize: 19, fontWeight: 800, color: "#0f3171" }}>📊 Dashboard — Recrutamento e Seleção</div>
          <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 2 }}>Indicadores de vagas, candidaturas e tempo por etapa.</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: "#94a3b8" }}>📅 Período:</span>
          <select value={mes} onChange={e => setMes(e.target.value)} style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, color: "#0f172a", fontSize: 13, fontWeight: 700, padding: "8px 12px", outline: "none", cursor: "pointer" }}>
            {mesesOpc.map(m => <option key={m} value={m}>{mesLabel(m)}</option>)}
            <option value="">Todos os meses</option>
          </select>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "20px 24px 28px" }}>
        {loading ? (
          <div style={{ padding: "60px 20px", textAlign: "center", color: "#94a3b8" }}>Carregando indicadores...</div>
        ) : (<>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 12, marginBottom: 18 }}>
            <Kpi label="Solicitações" val={total} color="#0f3171" />
            <Kpi label="Em processo" val={emProcesso} color="#3b82f6" />
            <Kpi label="Contratados" val={contratados} color="#16a34a" />
            <Kpi label="Reprovadas" val={reprovadas} color="#dc2626" />
            <Kpi label={mes ? "Currículos no mês" : "Currículos (total)"} val={curvMes} color="#f97316" />
            <Kpi label="Currículos hoje" val={curvHoje} color="#f97316" />
            <Kpi label="Currículos 7 dias" val={curvSemana} color="#f97316" />
            <Kpi label="Banco de Talentos" val={geral} color="#8b5cf6" />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(380px,1fr))", gap: 16 }}>
            <Card title={mes ? `Currículos recebidos — ${mesLabel(mes)}` : "Currículos recebidos — últimos 14 dias"}>
              <ResponsiveContainer>
                <LineChart data={dias14} margin={{ top: 6, right: 10, left: -18, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" />
                  <XAxis dataKey="dia" tick={{ fontSize: 11, fill: "#94a3b8" }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "#94a3b8" }} />
                  <Tooltip />
                  <Line type="monotone" dataKey="qtd" name="Currículos" stroke="#f97316" strokeWidth={2.5} dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            </Card>

            <Card title="Solicitações por fase">
              <ResponsiveContainer>
                <BarChart data={statusData} margin={{ top: 6, right: 10, left: -18, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" />
                  <XAxis dataKey="nome" tick={{ fontSize: 10, fill: "#94a3b8" }} interval={0} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "#94a3b8" }} />
                  <Tooltip />
                  <Bar dataKey="qtd" name="Solicitações" radius={[6, 6, 0, 0]}>
                    {statusData.map((d, i) => <Cell key={i} fill={d.cor} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </Card>

            <Card title="Tempo médio por etapa (dias)">
              {tempos.length === 0 ? <Vazio texto="Ainda sem transições registradas." /> : (
                <ResponsiveContainer>
                  <BarChart data={tempos} layout="vertical" margin={{ top: 6, right: 16, left: 20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" />
                    <XAxis type="number" tick={{ fontSize: 11, fill: "#94a3b8" }} />
                    <YAxis type="category" dataKey="etapa" width={150} tick={{ fontSize: 9.5, fill: "#475569" }} />
                    <Tooltip />
                    <Bar dataKey="dias" name="Dias (média)" fill="#0f3171" radius={[0, 6, 6, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </Card>

            <Card title="Candidaturas por vaga (top 8)">
              {vagaData.length === 0 ? <Vazio texto="Nenhuma candidatura por vaga ainda." /> : (
                <ResponsiveContainer>
                  <BarChart data={vagaData} layout="vertical" margin={{ top: 6, right: 16, left: 20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" />
                    <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11, fill: "#94a3b8" }} />
                    <YAxis type="category" dataKey="vaga" width={150} tick={{ fontSize: 9.5, fill: "#475569" }} />
                    <Tooltip />
                    <Bar dataKey="qtd" name="Candidaturas" fill="#f97316" radius={[0, 6, 6, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </Card>

            <Card title="Distribuição das solicitações">
              {pieData.length === 0 ? <Vazio texto="Sem dados." /> : (
                <ResponsiveContainer>
                  <PieChart>
                    <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={90} label>
                      {pieData.map((d, i) => <Cell key={i} fill={d.cor} />)}
                    </Pie>
                    <Legend />
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </Card>

            <Card title="Candidatos por etapa (kanban)">
              {etapaData.length === 0 ? <Vazio texto="Nenhum candidato no processo ainda." /> : (
                <ResponsiveContainer>
                  <BarChart data={etapaData} layout="vertical" margin={{ top: 6, right: 16, left: 20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" />
                    <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11, fill: "#94a3b8" }} />
                    <YAxis type="category" dataKey="etapa" width={130} tick={{ fontSize: 9.5, fill: "#475569" }} />
                    <Tooltip />
                    <Bar dataKey="qtd" name="Candidatos" radius={[0, 6, 6, 0]}>
                      {etapaData.map((d, i) => <Cell key={i} fill={etapaCor[d.etapa] || "#0f3171"} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </Card>
          </div>
        </>)}
      </div>
    </div>
  );
}

function Vazio({ texto }: { texto: string }) {
  return <div style={{ height: "100%", display: "grid", placeItems: "center", color: "#94a3b8", fontSize: 13 }}>{texto}</div>;
}
