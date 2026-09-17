import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useVinculoEmpregado } from "@/hooks/useVinculoEmpregado";
import type { SupabaseClient } from "@supabase/supabase-js";
import { FioDuvida } from "@/components/juridico/FioDuvida";
import { CATEGORIAS_DUVIDA as CATEGORIAS, agruparComplementos, complementoPendente, type Complemento, type Duvida } from "@/lib/juridico/duvidas";

// =====================================================================
// CENTRAL DE SERVIÇOS — Orientações Jurídicas (biblioteca pública)
// Todos veem perguntas + respostas (SEM o nome de quem perguntou) e podem
// enviar novas. A pergunta passa por aprovação (Diretor Administrativo) e só
// então o Jurídico responde (em Jurídico → Parecer Jurídico).
// Respondida, quem perguntou AVALIA a resposta e pode PERGUNTAR MAIS no mesmo
// fio (17/09/2026) — o fio aparece na biblioteca, sem o nome de quem perguntou.
// =====================================================================


// JUR_DUVIDAS* não estão no types.ts gerado; mesmo padrão de comite-etica/db.ts.
const db = supabase as unknown as SupabaseClient;

const fmtDt = (s?: string) => { if (!s) return "—"; const d = new Date(s); return isNaN(+d) ? s : d.toLocaleDateString("pt-BR"); };
const statusBadge = (s: string): { bg: string; c: string; label: string } => ({
  "Respondida": { bg: "#dcfce7", c: "#15803d", label: "Respondida" },
  "Aprovada": { bg: "#ede9fe", c: "#7c3aed", label: "Aguardando Jurídico" },
  "Aberta": { bg: "#fff7ed", c: "#ea580c", label: "Aguardando aprovação" },
  "Reprovada": { bg: "#fee2e2", c: "#b91c1c", label: "Reprovada" },
}[s] || { bg: "#e0f2fe", c: "#0369a1", label: s });
const ASK_RESET = { titulo: "", categoria: "", pergunta: "" };

export default function OrientacoesJuridicas() {
  const { user } = useAuth();
  const { empregado } = useVinculoEmpregado();
  const autor = empregado?.nome || user?.user_metadata?.nome || user?.email || "Usuário";

  const [duvidas, setDuvidas] = useState<Duvida[]>([]);
  // Fio de complementos por dúvida (17/09/2026) — ver lib/juridico/duvidas.ts.
  const [fios, setFios] = useState<Map<number, Complemento[]>>(new Map());
  const [loading, setLoading] = useState(true);
  const [busca, setBusca] = useState("");
  const [fCat, setFCat] = useState("");
  const [aba, setAba] = useState<"biblioteca" | "minhas">("biblioteca");
  const [toasts, setToasts] = useState<{ id: number; msg: string; t: string }[]>([]);
  const [askModal, setAskModal] = useState(false);
  const [ask, setAsk] = useState({ ...ASK_RESET });

  const toast = (msg: string, t = "info") => { const id = Date.now() + Math.random(); setToasts(x => [...x, { id, msg, t }]); setTimeout(() => setToasts(x => x.filter(i => i.id !== id)), 3600); };

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data }, c] = await Promise.all([
      db.from("JUR_DUVIDAS").select("id, created_at, autor_id, titulo, pergunta, categoria, status, resposta, respondido_em, motivo_reprovacao, avaliacao, avaliacao_comentario, avaliado_em").order("created_at", { ascending: false }).limit(1000),
      db.from("JUR_DUVIDAS_COMPLEMENTOS").select("*").order("id", { ascending: false }).limit(1000),
    ]);
    setFios(agruparComplementos(c.data ?? []));
    setDuvidas(data ?? []); setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const enviar = async () => {
    if (!ask.titulo.trim() || !ask.pergunta.trim()) { toast("Preencha o assunto e a pergunta.", "err"); return; }
    const { error } = await db.from("JUR_DUVIDAS").insert({
      titulo: ask.titulo.trim(), pergunta: ask.pergunta.trim(), categoria: ask.categoria || null,
      autor_id: user?.id ?? null, autor_nome: autor, status: "Aberta",
    });
    if (error) { toast("Erro ao enviar: " + error.message, "err"); return; }
    setAskModal(false); setAsk({ ...ASK_RESET }); toast("Pergunta enviada. Passará por aprovação antes de ir ao Jurídico.", "ok"); load();
  };

  const respondidas = duvidas.filter(d => d.status === "Respondida");
  const minhas = duvidas.filter(d => d.autor_id === user?.id);
  const base = aba === "minhas" ? minhas : respondidas;
  const filtradas = base.filter(d => {
    if (fCat && d.categoria !== fCat) return false;
    if (busca) { const q = busca.toLowerCase(); return [d.titulo, d.pergunta, d.resposta, d.categoria].some(x => (x || "").toLowerCase().includes(q)); }
    return true;
  });

  const card = (label: string, valor: number, cor: string) => (
    <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 14, padding: "12px 18px", flex: 1, minWidth: 130, boxShadow: "0 8px 24px rgba(15,23,42,.05)" }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: ".5px" }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 800, color: cor, marginTop: 2 }}>{valor}</div>
    </div>
  );

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", background: "#f5f7fb" }}>
      <style>{`
        .oj-fi{width:100%;height:42px;border:1px solid #cbd5e1;border-radius:10px;padding:0 12px;font-size:13px;background:#fff;box-sizing:border-box}
        textarea.oj-fi{height:auto;padding:10px 12px;resize:vertical}
        .oj-fi:focus{outline:none;border-color:#0f3171;box-shadow:0 0 0 3px rgba(15,49,113,.1)}
        .oj-fg{margin-bottom:12px} .oj-fg label{display:block;font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.4px;margin-bottom:5px}
        .oj-btn{border:none;border-radius:10px;font-weight:700;cursor:pointer;font-size:12px;padding:9px 15px}
        .oj-chip{border:1px solid #e2e8f0;border-radius:20px;font-size:12px;font-weight:700;padding:6px 13px;cursor:pointer}
        .oj-ov{position:fixed;inset:0;z-index:700;background:rgba(15,23,42,.45);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;padding:16px}
        .oj-modal{background:#fff;border-radius:16px;padding:22px;width:100%;max-width:600px;max-height:92vh;overflow-y:auto;position:relative;box-shadow:0 16px 40px rgba(15,23,42,.18)}
      `}</style>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 22px", margin: "18px 24px 0", border: "1px solid #e2e8f0", borderRadius: 16, background: "linear-gradient(135deg,#fff,#f8fbff)", boxShadow: "0 8px 24px rgba(15,23,42,.06)", gap: 12, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 800, color: "#0f3171" }}>📚 Orientações Jurídicas</div>
          <div style={{ fontSize: 12.5, color: "#64748b", marginTop: 2 }}>Biblioteca de respostas do Jurídico. Pesquise antes de perguntar — talvez já tenha resposta.</div>
        </div>
        <button className="oj-btn" onClick={() => { setAsk({ ...ASK_RESET }); setAskModal(true); }} style={{ background: "#0f3171", color: "#fff", boxShadow: "0 10px 22px rgba(15,49,113,.18)" }}>+ Nova pergunta</button>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "18px 24px 28px" }}>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 14 }}>
          {card("Respostas na biblioteca", respondidas.length, "#15803d")}
          {card("Minhas solicitações", minhas.length, "#0f3171")}
        </div>

        <div style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap", alignItems: "center" }}>
          <input className="oj-fi" style={{ maxWidth: 380 }} placeholder="🔎 Pesquisar (assunto, palavra-chave, resposta…)" value={busca} onChange={e => setBusca(e.target.value)} />
          <select className="oj-fi" style={{ maxWidth: 200 }} value={fCat} onChange={e => setFCat(e.target.value)}>
            <option value="">Todas as categorias</option>{CATEGORIAS.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div style={{ display: "flex", gap: 7, marginBottom: 16, flexWrap: "wrap" }}>
          <button className="oj-chip" onClick={() => setAba("biblioteca")} style={{ background: aba === "biblioteca" ? "#0f3171" : "#fff", color: aba === "biblioteca" ? "#fff" : "#475569", borderColor: aba === "biblioteca" ? "#0f3171" : "#e2e8f0" }}>Todas as respostas</button>
          <button className="oj-chip" onClick={() => setAba("minhas")} style={{ background: aba === "minhas" ? "#0f3171" : "#fff", color: aba === "minhas" ? "#fff" : "#475569", borderColor: aba === "minhas" ? "#0f3171" : "#e2e8f0" }}>Minhas solicitações</button>
        </div>

        {loading ? <div style={{ padding: 50, textAlign: "center", color: "#94a3b8" }}>Carregando…</div>
          : filtradas.length === 0 ? (
            <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 14, padding: 46, textAlign: "center", color: "#94a3b8", boxShadow: "0 8px 24px rgba(15,23,42,.05)" }}>
              {aba === "minhas" ? "Você ainda não enviou nenhuma solicitação." : "Ainda não há respostas na biblioteca."}
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {filtradas.map(d => { const respondida = d.status === "Respondida"; const sb = respondida && complementoPendente(fios.get(d.id) ?? []) ? { bg: "#ede9fe", c: "#7c3aed", label: "Complemento com o Jurídico" } : statusBadge(d.status); return (
                <div key={d.id} style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 14, overflow: "hidden", boxShadow: "0 8px 24px rgba(15,23,42,.05)" }}>
                  <div style={{ padding: "14px 16px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, flexWrap: "wrap" }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 800, color: "#0f172a", fontSize: 14.5 }}>{d.titulo}</div>
                        <div style={{ fontSize: 11.5, color: "#94a3b8", marginTop: 2 }}>{d.categoria ? <span style={{ fontWeight: 700, color: "#0f3171" }}>{d.categoria}</span> : null}{d.categoria ? " · " : ""}{aba === "minhas" ? fmtDt(d.created_at) : (d.respondido_em ? "Respondida em " + fmtDt(d.respondido_em) : "")}</div>
                      </div>
                      {aba === "minhas" && <span style={{ fontSize: 11, fontWeight: 800, padding: "3px 11px", borderRadius: 20, whiteSpace: "nowrap", background: sb.bg, color: sb.c }}>{sb.label}</span>}
                    </div>
                    <div style={{ marginTop: 10, fontSize: 13, color: "#334155", whiteSpace: "pre-wrap" }}>{d.pergunta}</div>
                    {respondida && d.resposta && (
                      <div style={{ marginTop: 12, background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 11, padding: "11px 13px" }}>
                        <div style={{ fontSize: 11, fontWeight: 800, color: "#15803d", textTransform: "uppercase", letterSpacing: ".4px", marginBottom: 4 }}>✅ Resposta do Jurídico</div>
                        <div style={{ fontSize: 13, color: "#0f172a", whiteSpace: "pre-wrap" }}>{d.resposta}</div>
                      </div>
                    )}
                    {/* Quem perguntou avalia e pode perguntar mais; o fio aparece
                        pra todo mundo na biblioteca, sem o nome de quem perguntou
                        (17/09/2026). */}
                    {respondida && (
                      <FioDuvida duvida={d} fio={fios.get(d.id) ?? []} userId={user?.id} autorNome={autor}
                        podeResponder={false} mostrarNomes={false} onMudou={load} toast={toast} />
                    )}
                    {aba === "minhas" && d.status === "Reprovada" && d.motivo_reprovacao && (
                      <div style={{ marginTop: 12, background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 11, padding: "9px 12px", fontSize: 12.5, color: "#b91c1c" }}>Reprovada: {d.motivo_reprovacao}</div>
                    )}
                  </div>
                </div>
              ); })}
            </div>
          )}
      </div>

      {askModal && (
        <div className="oj-ov" onClick={e => { if (e.target === e.currentTarget) setAskModal(false); }}>
          <div className="oj-modal" onClick={e => e.stopPropagation()}>
            <button onClick={() => setAskModal(false)} style={{ position: "absolute", top: 14, right: 16, border: "none", background: "none", fontSize: 20, color: "#94a3b8", cursor: "pointer" }}>✕</button>
            <div style={{ fontSize: 17, fontWeight: 800, marginBottom: 4 }}>Nova pergunta jurídica</div>
            <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 16 }}>Passa por aprovação e depois o Jurídico responde. A resposta fica pública na biblioteca (sem seu nome).</div>
            <div className="oj-fg"><label>Assunto / título *</label><input className="oj-fi" value={ask.titulo} onChange={e => setAsk(v => ({ ...v, titulo: e.target.value }))} placeholder="Ex.: Prazo para resposta de notificação" /></div>
            <div className="oj-fg"><label>Categoria</label><select className="oj-fi" value={ask.categoria} onChange={e => setAsk(v => ({ ...v, categoria: e.target.value }))}><option value="">— Selecione —</option>{CATEGORIAS.map(c => <option key={c}>{c}</option>)}</select></div>
            <div className="oj-fg"><label>Sua pergunta *</label><textarea className="oj-fi" rows={5} value={ask.pergunta} onChange={e => setAsk(v => ({ ...v, pergunta: e.target.value }))} placeholder="Descreva sua dúvida sobre processo, lei, contrato…" /></div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 6 }}>
              <button className="oj-btn" onClick={() => setAskModal(false)} style={{ background: "#fff", border: "1px solid #e2e8f0", color: "#475569" }}>Cancelar</button>
              <button className="oj-btn" onClick={enviar} style={{ background: "#0f3171", color: "#fff" }}>Enviar pergunta</button>
            </div>
          </div>
        </div>
      )}

      <div style={{ position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)", zIndex: 9999, display: "flex", flexDirection: "column", gap: 6, alignItems: "center" }}>
        {toasts.map(t => (<div key={t.id} style={{ padding: "10px 18px", borderRadius: 9, fontSize: 13, fontWeight: 600, boxShadow: "0 16px 40px rgba(15,23,42,.12)", background: t.t === "ok" ? "#ecfdf3" : t.t === "err" ? "#fef2f2" : "#eff6ff", color: t.t === "ok" ? "#15803d" : t.t === "err" ? "#b91c1c" : "#1d4ed8", border: `1px solid ${t.t === "ok" ? "#86efac" : t.t === "err" ? "#fecaca" : "#bfdbfe"}` }}>{t.msg}</div>))}
      </div>
    </div>
  );
}
