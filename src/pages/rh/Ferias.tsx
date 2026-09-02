import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { ConversaSolicitacao } from "@/components/solicitacoes/ConversaSolicitacao";
import { ResumoDeFuncoes } from "@/components/fluxos/ResumoDeFuncoes";

// ── Helpers ──────────────────────────────────────────────────────────
function fmtDt(s?: string) {
  if (!s) return "—";
  const d = new Date(s.length <= 10 ? s + "T12:00:00" : s);
  return isNaN(+d) ? (s ?? "—") : d.toLocaleDateString("pt-BR");
}

const STATUS_CFG: Record<string, { bg: string; fg: string; bd: string }> = {
  Pendente: { bg: "#fef9c3", fg: "#854d0e", bd: "#fde68a" },
  Aprovada: { bg: "#dcfce7", fg: "#15803d", bd: "#86efac" },
  Reprovada: { bg: "#fee2e2", fg: "#b91c1c", bd: "#fecaca" },
  Cancelada: { bg: "#f1f5f9", fg: "#475569", bd: "#e2e8f0" },
};
function StatusBadge({ status }: { status: string }) {
  const c = STATUS_CFG[status] ?? { bg: "#dbeafe", fg: "#1d4ed8", bd: "#bfdbfe" };
  return <span style={{ display: "inline-flex", alignItems: "center", padding: "2px 10px", borderRadius: 20, fontSize: 11, fontWeight: 700, background: c.bg, color: c.fg, border: `1px solid ${c.bd}`, whiteSpace: "nowrap" }}>{status}</span>;
}

const FILTROS = ["", "Pendente", "Aprovada", "Reprovada", "Cancelada"];

export default function Ferias() {
  const { user } = useAuth();
  const [nome, setNome] = useState("");

  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<Record<string, number>>({});
  const [statusFilter, setStatusFilter] = useState("");
  const [busca, setBusca] = useState("");

  const [drawerId, setDrawerId] = useState<number | null>(null);
  const [sol, setSol] = useState<any | null>(null);
  const [reprovando, setReprovando] = useState(false);
  const [motivo, setMotivo] = useState("");

  const [toasts, setToasts] = useState<{ id: number; msg: string; type: string }[]>([]);
  const toastId = useRef(0);
  const toast = useCallback((msg: string, type = "info") => {
    const id = ++toastId.current;
    setToasts(t => [...t, { id, msg, type }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 3500);
  }, []);

  useEffect(() => {
    if (!user?.id) return;
    supabase.from("profiles").select("display_name, email").eq("id", user.id).maybeSingle()
      .then(({ data }) => setNome(data?.display_name || data?.email || user.email || ""));
  }, [user?.id]);

  // ── Carregar lista + stats ──────────────────────────────────────────
  const carregar = useCallback(async () => {
    setLoading(true);
    let q = (supabase as any).from("SISTEMA_SOLICITACOES_FERIAS").select("*").order("criado_em", { ascending: false }).limit(200);
    if (statusFilter) q = q.eq("status", statusFilter);
    if (busca.trim()) q = q.or(`colaborador_nome.ilike.%${busca.trim()}%,solicitante_nome.ilike.%${busca.trim()}%`);
    const { data, error } = await q;
    setLoading(false);
    if (error) { toast("Erro ao carregar: " + error.message, "err"); return; }
    setRows(data ?? []);
  }, [statusFilter, busca, toast]);

  const carregarStats = useCallback(async () => {
    const { data } = await (supabase as any).from("SISTEMA_SOLICITACOES_FERIAS").select("status").limit(2000);
    if (!data) return;
    const m: Record<string, number> = { total: data.length };
    for (const r of data) m[r.status] = (m[r.status] ?? 0) + 1;
    setStats(m);
  }, []);

  useEffect(() => { carregar(); }, [carregar]);
  useEffect(() => { carregarStats(); }, [carregarStats]);

  // ── Drawer ──────────────────────────────────────────────────────────
  const abrirDrawer = async (row: any) => {
    setDrawerId(row.id);
    setSol(row);
    setReprovando(false);
    setMotivo("");
  };
  const fecharDrawer = () => { setDrawerId(null); setSol(null); };

  const recarregarTudo = () => { carregar(); carregarStats(); };

  const acao = async (novo: string, motivoTxt?: string) => {
    if (!drawerId) return;
    const patch: any = { status: novo, aprovado_por: nome || user?.email || "", aprovado_em: new Date().toISOString(), atualizado_em: new Date().toISOString() };
    if (motivoTxt !== undefined) patch.motivo_reprovacao = motivoTxt;
    const { error } = await (supabase as any).from("SISTEMA_SOLICITACOES_FERIAS").update(patch).eq("id", drawerId);
    if (error) { toast("Erro: " + error.message, "err"); return; }
    toast(`Solicitação ${novo.toLowerCase()}.`, "ok");
    setSol((s: any) => ({ ...s, ...patch }));
    setReprovando(false);
    setMotivo("");
    recarregarTudo();
  };

  const kpi = (label: string, val: number, cor: string) => (
    <div style={{ flex: 1, background: "#fff", border: "1px solid #e2e8f0", borderRadius: 14, padding: "14px 16px", boxShadow: "0 4px 16px rgba(15,23,42,.05)" }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: ".5px" }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 800, color: cor, marginTop: 2 }}>{val ?? 0}</div>
    </div>
  );

  return (
    <div style={{ padding: "4px 2px 40px" }}>
      <div style={{ marginBottom: 18, display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: "#0f172a", display: "flex", alignItems: "center", gap: 8 }}>📅 Gestão de Férias</h1>
          <p style={{ fontSize: 13, color: "#64748b", marginTop: 2 }}>Solicitações de férias dos colaboradores — aprove, reprove ou acompanhe.</p>
        </div>
        <ResumoDeFuncoes fluxo="ferias" />
      </div>

      {/* KPIs */}
      <div style={{ display: "flex", gap: 12, marginBottom: 18, flexWrap: "wrap" }}>
        {kpi("Pendentes", stats["Pendente"] ?? 0, "#854d0e")}
        {kpi("Aprovadas", stats["Aprovada"] ?? 0, "#15803d")}
        {kpi("Reprovadas", stats["Reprovada"] ?? 0, "#b91c1c")}
        {kpi("Total", stats["total"] ?? 0, "#0f3171")}
      </div>

      {/* Filtros */}
      <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap", alignItems: "center" }}>
        {FILTROS.map(f => (
          <button key={f || "all"} onClick={() => setStatusFilter(f)}
            style={{ padding: "6px 14px", borderRadius: 20, fontSize: 12, fontWeight: 700, cursor: "pointer",
              border: `1px solid ${statusFilter === f ? "#0f3171" : "#e2e8f0"}`,
              background: statusFilter === f ? "#0f3171" : "#fff", color: statusFilter === f ? "#fff" : "#475569" }}>
            {f || "Todas"}
          </button>
        ))}
        <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar colaborador / solicitante..."
          style={{ marginLeft: "auto", minWidth: 240, padding: "8px 12px", borderRadius: 10, border: "1px solid #e2e8f0", fontSize: 13, outline: "none" }} />
      </div>

      {/* Tabela */}
      <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 16, overflow: "hidden", boxShadow: "0 4px 16px rgba(15,23,42,.05)" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: "#f8fafc" }}>
              {["Colaborador", "Período", "Dias", "Solicitante", "Status", "Criado"].map(h => (
                <th key={h} style={{ fontSize: 10, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: ".7px", padding: "11px 14px", borderBottom: "1px solid #e2e8f0", textAlign: "left" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} style={{ padding: 32, textAlign: "center", color: "#94a3b8", fontSize: 13 }}>Carregando...</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={6} style={{ padding: 40, textAlign: "center", color: "#94a3b8", fontSize: 13 }}>
                <div style={{ fontSize: 32, marginBottom: 8 }}>📭</div>Nenhuma solicitação de férias.
              </td></tr>
            ) : rows.map(r => (
              <tr key={r.id} onClick={() => abrirDrawer(r)} style={{ cursor: "pointer", borderBottom: "1px solid #f1f5f9" }}
                onMouseEnter={e => (e.currentTarget.style.background = "#f8fbff")}
                onMouseLeave={e => (e.currentTarget.style.background = "#fff")}>
                <td style={{ padding: "11px 14px", fontSize: 13 }}>
                  <div style={{ fontWeight: 600, color: "#0f172a" }}>{r.colaborador_nome}</div>
                  <div style={{ fontSize: 11, color: "#94a3b8" }}>{r.colaborador_cargo}{r.colaborador_filial ? ` · ${r.colaborador_filial}` : ""}</div>
                </td>
                <td style={{ padding: "11px 14px", fontSize: 12, color: "#475569" }}>{fmtDt(r.data_saida)} → {fmtDt(r.data_retorno)}</td>
                <td style={{ padding: "11px 14px", fontSize: 12, color: "#475569" }}>{r.dias_ferias}d{r.dias_vendidos ? ` +${r.dias_vendidos} abono` : ""}</td>
                <td style={{ padding: "11px 14px", fontSize: 12, color: "#475569" }}>{r.solicitante_nome || "—"}</td>
                <td style={{ padding: "11px 14px" }}><StatusBadge status={r.status} /></td>
                <td style={{ padding: "11px 14px", fontSize: 11, color: "#94a3b8" }}>{fmtDt(r.criado_em)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Drawer */}
      {drawerId && sol && (
        <div onClick={e => { if (e.target === e.currentTarget) fecharDrawer(); }}
          style={{ position: "fixed", inset: 0, zIndex: 500, background: "rgba(15,23,42,.42)", backdropFilter: "blur(4px)", display: "flex", justifyContent: "flex-end" }}>
          <div style={{ width: "82%", maxWidth: 720, height: "100%", background: "#fff", display: "flex", flexDirection: "column", boxShadow: "-20px 0 60px rgba(15,23,42,.18)" }}>
            {/* Header */}
            <div style={{ padding: "18px 24px", borderBottom: "1px solid #e2e8f0", display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
              <div>
                <div style={{ fontSize: 17, fontWeight: 800, color: "#0f172a" }}>{sol.colaborador_nome}</div>
                <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 2 }}>#{sol.id} · {sol.colaborador_cargo}{sol.colaborador_filial ? ` · ${sol.colaborador_filial}` : ""}</div>
              </div>
              <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <StatusBadge status={sol.status} />
                <button onClick={fecharDrawer} style={{ background: "none", border: "none", color: "#94a3b8", fontSize: 22, cursor: "pointer" }}>✕</button>
              </div>
            </div>

            <div style={{ flex: 1, overflowY: "auto", padding: 24 }}>
              {/* Resumo */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 18 }}>
                {[
                  ["Saída", fmtDt(sol.data_saida)],
                  ["Retorno", fmtDt(sol.data_retorno)],
                  ["Dias de férias", `${sol.dias_ferias} dias`],
                  ["Abono (vendidos)", `${sol.dias_vendidos || 0} dias`],
                  ["CPF", sol.colaborador_cpf || "—"],
                  ["Admissão", fmtDt(sol.colaborador_admissao)],
                  ["Solicitante", sol.solicitante_nome || "—"],
                  ["Criado em", fmtDt(sol.criado_em)],
                ].map(([k, v]) => (
                  <div key={k} style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 10, padding: "10px 12px" }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: ".5px" }}>{k}</div>
                    <div style={{ fontSize: 13, color: "#0f172a", marginTop: 2 }}>{v}</div>
                  </div>
                ))}
              </div>
              {sol.observacoes && (
                <div style={{ marginBottom: 18 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: ".5px", marginBottom: 4 }}>Observações</div>
                  <div style={{ fontSize: 13, color: "#475569", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 10, padding: "10px 12px", lineHeight: 1.6 }}>{sol.observacoes}</div>
                </div>
              )}
              {sol.status === "Reprovada" && sol.motivo_reprovacao && (
                <div style={{ marginBottom: 18, background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 10, padding: "10px 12px" }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: "#b91c1c", textTransform: "uppercase", letterSpacing: ".5px", marginBottom: 4 }}>Motivo da reprovação</div>
                  <div style={{ fontSize: 13, color: "#7f1d1d" }}>{sol.motivo_reprovacao}</div>
                </div>
              )}

              {/* Ações */}
              {sol.status === "Pendente" && (
                <div style={{ marginBottom: 20 }}>
                  {!reprovando ? (
                    <div style={{ display: "flex", gap: 8 }}>
                      <button onClick={() => acao("Aprovada")} style={{ flex: 1, padding: "10px", borderRadius: 10, border: "none", background: "#16a34a", color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>✓ Aprovar</button>
                      <button onClick={() => setReprovando(true)} style={{ flex: 1, padding: "10px", borderRadius: 10, border: "1px solid #fecaca", background: "#fef2f2", color: "#b91c1c", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>✕ Reprovar</button>
                      <button onClick={() => acao("Cancelada")} style={{ padding: "10px 14px", borderRadius: 10, border: "1px solid #e2e8f0", background: "#fff", color: "#475569", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>Cancelar</button>
                    </div>
                  ) : (
                    <div>
                      <textarea value={motivo} onChange={e => setMotivo(e.target.value)} rows={2} placeholder="Motivo da reprovação..."
                        style={{ width: "100%", border: "1px solid #fecaca", borderRadius: 10, padding: "8px 12px", fontSize: 13, outline: "none", fontFamily: "inherit" }} />
                      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                        <button onClick={() => { if (!motivo.trim()) { toast("Informe o motivo.", "err"); return; } acao("Reprovada", motivo.trim()); }}
                          style={{ flex: 1, padding: "9px", borderRadius: 10, border: "none", background: "#dc2626", color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>Confirmar reprovação</button>
                        <button onClick={() => { setReprovando(false); setMotivo(""); }} style={{ padding: "9px 14px", borderRadius: 10, border: "1px solid #e2e8f0", background: "#fff", color: "#475569", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>Voltar</button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              <ConversaSolicitacao
                modulo="ferias" entidadeId={drawerId}
                aviso="Quem solicitou lê e responde por Encarregados › Minhas Solicitações."
              />
            </div>
          </div>
        </div>
      )}

      {/* Toasts */}
      <div style={{ position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)", zIndex: 9999, pointerEvents: "none", display: "flex", flexDirection: "column", gap: 6, alignItems: "center" }}>
        {toasts.map(t => (
          <div key={t.id} style={{
            padding: "10px 18px", borderRadius: 9, fontSize: 13, fontWeight: 600, boxShadow: "0 16px 40px rgba(15,23,42,.1)",
            background: t.type === "ok" ? "#ecfdf3" : t.type === "err" ? "#fef2f2" : "#eff6ff",
            color: t.type === "ok" ? "#15803d" : t.type === "err" ? "#b91c1c" : "#1d4ed8",
            border: `1px solid ${t.type === "ok" ? "#86efac" : t.type === "err" ? "#fecaca" : "#bfdbfe"}`,
          }}>{t.msg}</div>
        ))}
      </div>
    </div>
  );
}
