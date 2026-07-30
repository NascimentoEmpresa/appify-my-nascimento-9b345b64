import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useVinculoEmpregado } from "@/hooks/useVinculoEmpregado";
import { usePermissoes } from "@/context/PermissoesContext";

// =====================================================================
// JURÍDICO — Parecer Jurídico (gestão das dúvidas)
// Fluxo: pergunta (Central de Serviços) → 'Aberta' → Diretor Administrativo /
// aprovador aprova ('Aprovada') ou reprova ('Reprovada' + motivo) → o Jurídico
// responde as 'Aprovada' → 'Respondida' (entra na biblioteca pública).
// Admin define quem aprova (JUR_DUVIDAS_APROVADORES).
// =====================================================================

interface Duvida {
  id: number; created_at?: string; autor_id?: string; autor_nome?: string;
  titulo: string; pergunta: string; categoria?: string; status: string;
  resposta?: string; respondido_por?: string; respondido_em?: string;
  aprovado_por?: string; aprovado_em?: string; motivo_reprovacao?: string;
}
interface Aprovador { empregado_id: number; nome?: string }

const CATEGORIAS = ["Trabalhista", "Contratos", "Processos", "Tributário", "Cível", "Administrativo", "Compliance", "LGPD", "Outros"];
const fmtDt = (s?: string) => { if (!s) return "—"; const d = new Date(s); return isNaN(+d) ? s : d.toLocaleDateString("pt-BR"); };
const fmtDtHora = (s?: string) => { if (!s) return "—"; const d = new Date(s); return isNaN(+d) ? s : d.toLocaleDateString("pt-BR") + " às " + d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }); };
const statusInfo = (s: string): { bg: string; c: string; label: string } => ({
  "Aberta": { bg: "#fff7ed", c: "#ea580c", label: "Aguardando aprovação" },
  "Aprovada": { bg: "#ede9fe", c: "#7c3aed", label: "Aguardando resposta" },
  "Respondida": { bg: "#dcfce7", c: "#15803d", label: "Respondida" },
  "Reprovada": { bg: "#fee2e2", c: "#b91c1c", label: "Reprovada" },
}[s] || { bg: "#e0f2fe", c: "#0369a1", label: s });
const ASK_RESET = { titulo: "", categoria: "", pergunta: "" };

export default function CentralDuvidas() {
  const { user } = useAuth();
  const { empregado } = useVinculoEmpregado();
  const { can } = usePermissoes();
  const autor = empregado?.nome || user?.user_metadata?.nome || user?.email || "Usuário";
  const trabalhando = empregado?.situacao === "Trabalhando";
  const podeGerenciar = can("alterar", undefined, "duvidas");

  const [duvidas, setDuvidas] = useState<Duvida[]>([]);
  const [aprovadores, setAprovadores] = useState<Aprovador[]>([]);
  const [responsaveis, setResponsaveis] = useState<Aprovador[]>([]);
  const [loading, setLoading] = useState(true);
  const [busca, setBusca] = useState("");
  const [fStatus, setFStatus] = useState("todas");
  const [fCat, setFCat] = useState("");
  const [toasts, setToasts] = useState<{ id: number; msg: string; t: string }[]>([]);

  const [askModal, setAskModal] = useState(false);
  const [ask, setAsk] = useState({ ...ASK_RESET });
  const [respAlvo, setRespAlvo] = useState<Duvida | null>(null);
  const [resp, setResp] = useState("");
  const [reprAlvo, setReprAlvo] = useState<Duvida | null>(null);
  const [motivoRep, setMotivoRep] = useState("");

  // admin: gerir aprovadores
  const [adminModal, setAdminModal] = useState(false);
  const [empSearch, setEmpSearch] = useState("");
  const [empResults, setEmpResults] = useState<any[]>([]);
  const [empLoading, setEmpLoading] = useState(false);

  const toast = (msg: string, t = "info") => { const id = Date.now() + Math.random(); setToasts(x => [...x, { id, msg, t }]); setTimeout(() => setToasts(x => x.filter(i => i.id !== id)), 3600); };

  const aprovadoresIds = aprovadores.map(a => a.empregado_id);
  const responsaveisIds = responsaveis.map(r => r.empregado_id);
  const podeAprovar = (empregado?.setor === "DIRETOR ADMINISTRATIVO" && trabalhando) || (empregado?.id != null && aprovadoresIds.includes(empregado.id));
  const podeResponder = (empregado?.setor === "JURIDICO" && trabalhando) || (empregado?.id != null && responsaveisIds.includes(empregado.id));

  const load = useCallback(async () => {
    setLoading(true);
    const [d, a, r] = await Promise.all([
      (supabase as any).from("JUR_DUVIDAS").select("*").order("created_at", { ascending: false }).limit(1000),
      (supabase as any).from("JUR_DUVIDAS_APROVADORES").select("empregado_id, nome"),
      (supabase as any).from("JUR_DUVIDAS_RESPONSAVEIS").select("empregado_id, nome"),
    ]);
    setDuvidas(d.data ?? []); setAprovadores(a.data ?? []); setResponsaveis(r.data ?? []); setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const enviarPergunta = async () => {
    if (!ask.titulo.trim() || !ask.pergunta.trim()) { toast("Preencha o título e a pergunta.", "err"); return; }
    const { error } = await (supabase as any).from("JUR_DUVIDAS").insert({ titulo: ask.titulo.trim(), pergunta: ask.pergunta.trim(), categoria: ask.categoria || null, autor_id: user?.id ?? null, autor_nome: autor, status: "Aberta" });
    if (error) { toast("Erro ao enviar: " + error.message, "err"); return; }
    setAskModal(false); setAsk({ ...ASK_RESET }); toast("Dúvida enviada (passa por aprovação).", "ok"); load();
  };

  const aprovar = async (d: Duvida) => {
    const { error } = await (supabase as any).from("JUR_DUVIDAS").update({ status: "Aprovada", aprovado_por: autor, aprovado_em: new Date().toISOString(), motivo_reprovacao: null, updated_at: new Date().toISOString() }).eq("id", d.id);
    if (error) { toast("Erro: " + error.message, "err"); return; }
    toast("Dúvida aprovada — segue para o Jurídico responder.", "ok"); load();
  };
  const confirmarReprovar = async () => {
    if (!reprAlvo) return;
    if (!motivoRep.trim()) { toast("Informe o motivo da reprovação.", "err"); return; }
    const { error } = await (supabase as any).from("JUR_DUVIDAS").update({ status: "Reprovada", motivo_reprovacao: motivoRep.trim(), aprovado_por: autor, aprovado_em: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", reprAlvo.id);
    if (error) { toast("Erro: " + error.message, "err"); return; }
    setReprAlvo(null); setMotivoRep(""); toast("Dúvida reprovada.", "ok"); load();
  };

  const abrirResponder = (d: Duvida) => { setRespAlvo(d); setResp(d.resposta ?? ""); };
  const responder = async () => {
    if (!respAlvo) return;
    if (!resp.trim()) { toast("Escreva a resposta.", "err"); return; }
    const { error } = await (supabase as any).from("JUR_DUVIDAS").update({ resposta: resp.trim(), status: "Respondida", respondido_por: autor, respondido_em: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", respAlvo.id);
    if (error) { toast("Erro ao responder: " + error.message, "err"); return; }
    setRespAlvo(null); setResp(""); toast("Resposta publicada na biblioteca.", "ok"); load();
  };
  const excluir = async (d: Duvida) => {
    if (!confirm(`Excluir a dúvida "${d.titulo}"?`)) return;
    const { error } = await (supabase as any).from("JUR_DUVIDAS").delete().eq("id", d.id);
    if (error) { toast("Erro ao excluir: " + error.message, "err"); return; }
    setDuvidas(x => x.filter(i => i.id !== d.id)); toast("Dúvida excluída.", "ok");
  };

  // ── Admin: aprovadores ──────────────────────────────────────────
  const buscarEmps = async (term: string) => {
    if (term.trim().length < 2) { setEmpResults([]); return; }
    setEmpLoading(true);
    const { data } = await (supabase as any).from("EMPREGADOS").select('"ID","Nome","Setor_ERP","Situação","Nome Filial"').ilike("Nome", `%${term}%`).eq("Situação", "Trabalhando").order('"Nome"').limit(30);
    setEmpLoading(false); setEmpResults(data ?? []);
  };
  const addAprovador = async (emp: any) => {
    const { error } = await (supabase as any).from("JUR_DUVIDAS_APROVADORES").upsert({ empregado_id: emp["ID"], nome: emp["Nome"], criado_por: autor }, { onConflict: "empregado_id" });
    if (error) { toast("Erro: " + error.message, "err"); return; }
    setEmpSearch(""); setEmpResults([]); toast(`${emp["Nome"]} agora pode aprovar.`, "ok"); load();
  };
  const removeAprovador = async (id: number) => {
    const { error } = await (supabase as any).from("JUR_DUVIDAS_APROVADORES").delete().eq("empregado_id", id);
    if (error) { toast("Erro: " + error.message, "err"); return; }
    load();
  };
  const addResponsavel = async (emp: any) => {
    const { error } = await (supabase as any).from("JUR_DUVIDAS_RESPONSAVEIS").upsert({ empregado_id: emp["ID"], nome: emp["Nome"], criado_por: autor }, { onConflict: "empregado_id" });
    if (error) { toast("Erro: " + error.message, "err"); return; }
    setEmpSearch(""); setEmpResults([]); toast(`${emp["Nome"]} agora pode responder.`, "ok"); load();
  };
  const removeResponsavel = async (id: number) => {
    const { error } = await (supabase as any).from("JUR_DUVIDAS_RESPONSAVEIS").delete().eq("empregado_id", id);
    if (error) { toast("Erro: " + error.message, "err"); return; }
    load();
  };

  const respondidasLib = duvidas.filter(d => d.status === "Respondida" && d.resposta);
  const total = duvidas.length;
  const nAberta = duvidas.filter(d => d.status === "Aberta").length;
  const nAprovada = duvidas.filter(d => d.status === "Aprovada").length;
  const nResp = duvidas.filter(d => d.status === "Respondida").length;
  const nReprov = duvidas.filter(d => d.status === "Reprovada").length;

  const filtradas = duvidas.filter(d => {
    if (fStatus === "aprovacao" && d.status !== "Aberta") return false;
    if (fStatus === "resposta" && d.status !== "Aprovada") return false;
    if (fStatus === "respondidas" && d.status !== "Respondida") return false;
    if (fStatus === "reprovadas" && d.status !== "Reprovada") return false;
    if (fStatus === "minhas" && d.autor_id !== user?.id) return false;
    if (fCat && d.categoria !== fCat) return false;
    if (busca) { const q = busca.toLowerCase(); return [d.titulo, d.pergunta, d.resposta, d.categoria, d.autor_nome].some(x => (x || "").toLowerCase().includes(q)); }
    return true;
  });

  const chip = (k: string, label: string, n?: number) => (
    <button className="jd-chip" onClick={() => setFStatus(k)} style={{ background: fStatus === k ? "#0f3171" : "#fff", color: fStatus === k ? "#fff" : "#475569", borderColor: fStatus === k ? "#0f3171" : "#e2e8f0" }}>{label}{n != null && n > 0 ? ` (${n})` : ""}</button>
  );
  const card = (label: string, valor: number, cor: string) => (
    <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 14, padding: "12px 18px", flex: 1, minWidth: 120, boxShadow: "0 8px 24px rgba(15,23,42,.05)" }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: ".5px" }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 800, color: cor, marginTop: 2 }}>{valor}</div>
    </div>
  );

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", background: "#f5f7fb" }}>
      <style>{`
        .jd-fi{width:100%;height:42px;border:1px solid #cbd5e1;border-radius:10px;padding:0 12px;font-size:13px;background:#fff;box-sizing:border-box}
        textarea.jd-fi{height:auto;padding:10px 12px;resize:vertical}
        .jd-fi:focus{outline:none;border-color:#0f3171;box-shadow:0 0 0 3px rgba(15,49,113,.1)}
        .jd-fg{margin-bottom:12px} .jd-fg label{display:block;font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.4px;margin-bottom:5px}
        .jd-btn{border:none;border-radius:10px;font-weight:700;cursor:pointer;font-size:12px;padding:9px 15px}
        .jd-chip{border:1px solid #e2e8f0;border-radius:20px;font-size:12px;font-weight:700;padding:6px 13px;cursor:pointer}
        .jd-ov{position:fixed;inset:0;z-index:700;background:rgba(15,23,42,.45);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;padding:16px}
        .jd-modal{background:#fff;border-radius:16px;padding:22px;width:100%;max-width:600px;max-height:92vh;overflow-y:auto;position:relative;box-shadow:0 16px 40px rgba(15,23,42,.18)}
      `}</style>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 22px", margin: "18px 24px 0", border: "1px solid #e2e8f0", borderRadius: 16, background: "linear-gradient(135deg,#fff,#f8fbff)", boxShadow: "0 8px 24px rgba(15,23,42,.06)", gap: 12, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 800, color: "#0f3171" }}>⚖️ Parecer Jurídico</div>
          <div style={{ fontSize: 12.5, color: "#64748b", marginTop: 2 }}>Aprovação das dúvidas e respostas do Jurídico. Respondidas viram a biblioteca pública (Central de Serviços).</div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {podeGerenciar && <button className="jd-btn" onClick={() => { setAdminModal(true); setEmpSearch(""); setEmpResults([]); }} style={{ background: "#eef4ff", color: "#0f3171" }}>⚙️ Quem aprova/responde</button>}
          <button className="jd-btn" onClick={() => { setAsk({ ...ASK_RESET }); setAskModal(true); }} style={{ background: "#0f3171", color: "#fff", boxShadow: "0 10px 22px rgba(15,49,113,.18)" }}>+ Nova dúvida</button>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "18px 24px 28px" }}>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 14 }}>
          {card("Aguardando aprovação", nAberta, nAberta > 0 ? "#ea580c" : "#16a34a")}
          {card("Aguardando resposta", nAprovada, "#7c3aed")}
          {card("Respondidas", nResp, "#15803d")}
          {card("Reprovadas", nReprov, "#dc2626")}
        </div>

        <div style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap", alignItems: "center" }}>
          <input className="jd-fi" style={{ maxWidth: 360 }} placeholder="🔎 Pesquisar (assunto, palavra-chave, resposta…)" value={busca} onChange={e => setBusca(e.target.value)} />
          <select className="jd-fi" style={{ maxWidth: 200 }} value={fCat} onChange={e => setFCat(e.target.value)}>
            <option value="">Todas as categorias</option>{CATEGORIAS.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div style={{ display: "flex", gap: 7, marginBottom: 16, flexWrap: "wrap" }}>
          {chip("todas", "Todas")}
          {chip("aprovacao", "Aguardando aprovação", nAberta)}
          {chip("resposta", "Aguardando resposta", nAprovada)}
          {chip("respondidas", "Respondidas")}
          {chip("reprovadas", "Reprovadas", nReprov)}
          {chip("minhas", "Minhas")}
        </div>

        {(podeAprovar || podeResponder) && (
          <div style={{ background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 12, padding: "10px 14px", fontSize: 12.5, color: "#1d4ed8", marginBottom: 14 }}>
            {podeAprovar && <>Você <b>aprova/reprova</b> as dúvidas em <b>Aguardando aprovação</b>. </>}
            {podeResponder && <>Você <b>responde</b> as em <b>Aguardando resposta</b>.</>}
          </div>
        )}

        {loading ? <div style={{ padding: 50, textAlign: "center", color: "#94a3b8" }}>Carregando…</div>
          : filtradas.length === 0 ? (
            <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 14, padding: 46, textAlign: "center", color: "#94a3b8", boxShadow: "0 8px 24px rgba(15,23,42,.05)" }}>Nenhuma dúvida neste filtro.</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {filtradas.map(d => { const si = statusInfo(d.status); return (
                <div key={d.id} style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 14, overflow: "hidden", boxShadow: "0 8px 24px rgba(15,23,42,.05)" }}>
                  <div style={{ padding: "14px 16px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, flexWrap: "wrap" }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 800, color: "#0f172a", fontSize: 14.5 }}>{d.titulo}</div>
                        <div style={{ fontSize: 11.5, color: "#94a3b8", marginTop: 2 }}>{d.categoria ? <span style={{ fontWeight: 700, color: "#0f3171" }}>{d.categoria}</span> : null}{d.categoria ? " · " : ""}por {d.autor_nome || "—"} · {fmtDtHora(d.created_at)}</div>
                      </div>
                      <span style={{ fontSize: 11, fontWeight: 800, padding: "3px 11px", borderRadius: 20, whiteSpace: "nowrap", background: si.bg, color: si.c }}>{si.label}</span>
                    </div>
                    <div style={{ marginTop: 10, fontSize: 13, color: "#334155", whiteSpace: "pre-wrap" }}>{d.pergunta}</div>

                    {d.status === "Respondida" && (
                      <div style={{ marginTop: 12, background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 11, padding: "11px 13px" }}>
                        <div style={{ fontSize: 11, fontWeight: 800, color: "#15803d", textTransform: "uppercase", letterSpacing: ".4px", marginBottom: 4 }}>✅ Resposta do Jurídico</div>
                        <div style={{ fontSize: 13, color: "#0f172a", whiteSpace: "pre-wrap" }}>{d.resposta}</div>
                        <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 6 }}>{d.respondido_por || "Jurídico"}{d.respondido_em ? " · " + fmtDt(d.respondido_em) : ""}</div>
                      </div>
                    )}
                    {d.status === "Reprovada" && d.motivo_reprovacao && (
                      <div style={{ marginTop: 12, background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 11, padding: "9px 12px", fontSize: 12.5, color: "#b91c1c" }}>Reprovada por {d.aprovado_por || "—"}: {d.motivo_reprovacao}</div>
                    )}

                    <div style={{ display: "flex", gap: 6, marginTop: 12, flexWrap: "wrap" }}>
                      {d.status === "Aberta" && podeAprovar && <>
                        <button className="jd-btn" onClick={() => aprovar(d)} style={{ background: "rgba(22,163,74,.12)", color: "#15803d", border: "1px solid rgba(22,163,74,.25)", padding: "6px 12px" }}>✓ Aprovar</button>
                        <button className="jd-btn" onClick={() => { setReprAlvo(d); setMotivoRep(""); }} style={{ background: "#fee2e2", color: "#b91c1c", padding: "6px 12px" }}>Reprovar</button>
                      </>}
                      {d.status === "Aprovada" && podeResponder && <button className="jd-btn" onClick={() => abrirResponder(d)} style={{ background: "#7c3aed", color: "#fff", padding: "6px 12px" }}>✓ Responder</button>}
                      {d.status === "Respondida" && podeResponder && <button className="jd-btn" onClick={() => abrirResponder(d)} style={{ background: "#f1f5f9", color: "#475569", padding: "6px 12px" }}>Editar resposta</button>}
                      {(podeResponder || podeGerenciar) && <button className="jd-btn" onClick={() => excluir(d)} style={{ background: "none", color: "#dc2626", padding: "6px 8px" }}>Excluir</button>}
                    </div>
                  </div>
                </div>
              ); })}
            </div>
          )}
      </div>

      {/* Nova dúvida */}
      {askModal && (
        <div className="jd-ov" onClick={e => { if (e.target === e.currentTarget) setAskModal(false); }}>
          <div className="jd-modal" onClick={e => e.stopPropagation()}>
            <button onClick={() => setAskModal(false)} style={{ position: "absolute", top: 14, right: 16, border: "none", background: "none", fontSize: 20, color: "#94a3b8", cursor: "pointer" }}>✕</button>
            <div style={{ fontSize: 17, fontWeight: 800, marginBottom: 4 }}>Nova dúvida ao Jurídico</div>
            <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 16 }}>Passa por aprovação e depois o Jurídico responde.</div>
            <div className="jd-fg"><label>Assunto / título *</label><input className="jd-fi" value={ask.titulo} onChange={e => setAsk(v => ({ ...v, titulo: e.target.value }))} placeholder="Ex.: Prazo para resposta de notificação" /></div>
            <div className="jd-fg"><label>Categoria</label><select className="jd-fi" value={ask.categoria} onChange={e => setAsk(v => ({ ...v, categoria: e.target.value }))}><option value="">— Selecione —</option>{CATEGORIAS.map(c => <option key={c}>{c}</option>)}</select></div>
            <div className="jd-fg"><label>Sua dúvida *</label><textarea className="jd-fi" rows={5} value={ask.pergunta} onChange={e => setAsk(v => ({ ...v, pergunta: e.target.value }))} /></div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 6 }}>
              <button className="jd-btn" onClick={() => setAskModal(false)} style={{ background: "#fff", border: "1px solid #e2e8f0", color: "#475569" }}>Cancelar</button>
              <button className="jd-btn" onClick={enviarPergunta} style={{ background: "#0f3171", color: "#fff" }}>Enviar</button>
            </div>
          </div>
        </div>
      )}

      {/* Reprovar */}
      {reprAlvo && (
        <div className="jd-ov" onClick={e => { if (e.target === e.currentTarget) setReprAlvo(null); }}>
          <div className="jd-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 480 }}>
            <button onClick={() => setReprAlvo(null)} style={{ position: "absolute", top: 14, right: 16, border: "none", background: "none", fontSize: 20, color: "#94a3b8", cursor: "pointer" }}>✕</button>
            <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 4 }}>Reprovar dúvida</div>
            <div style={{ fontSize: 12.5, color: "#64748b", marginBottom: 10 }}>{reprAlvo.titulo}</div>
            <textarea className="jd-fi" rows={4} value={motivoRep} onChange={e => setMotivoRep(e.target.value)} placeholder="Motivo da reprovação (o Jurídico não responde reprovadas)…" />
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 10 }}>
              <button className="jd-btn" onClick={() => setReprAlvo(null)} style={{ background: "#fff", border: "1px solid #e2e8f0", color: "#475569" }}>Cancelar</button>
              <button className="jd-btn" onClick={confirmarReprovar} style={{ background: "#dc2626", color: "#fff" }}>Reprovar</button>
            </div>
          </div>
        </div>
      )}

      {/* Responder */}
      {respAlvo && (
        <div className="jd-ov" onClick={e => { if (e.target === e.currentTarget) setRespAlvo(null); }}>
          <div className="jd-modal" onClick={e => e.stopPropagation()}>
            <button onClick={() => setRespAlvo(null)} style={{ position: "absolute", top: 14, right: 16, border: "none", background: "none", fontSize: 20, color: "#94a3b8", cursor: "pointer" }}>✕</button>
            <div style={{ fontSize: 17, fontWeight: 800, marginBottom: 8 }}>Responder dúvida</div>
            <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 11, padding: "11px 13px", marginBottom: 14 }}>
              <div style={{ fontWeight: 800, color: "#0f172a", fontSize: 13.5 }}>{respAlvo.titulo}</div>
              <div style={{ fontSize: 12.5, color: "#475569", marginTop: 5, whiteSpace: "pre-wrap" }}>{respAlvo.pergunta}</div>
              <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 6 }}>{respAlvo.categoria ? respAlvo.categoria + " · " : ""}perguntada em {fmtDtHora(respAlvo.created_at)}</div>
            </div>
            {/* Reaproveitar resposta de outra pergunta (repetida) */}
            <div className="jd-fg">
              <label>Encaminhar resposta de outra pergunta (se repetida)</label>
              <select className="jd-fi" value="" onChange={e => { const alvo = respondidasLib.find(x => String(x.id) === e.target.value); if (alvo?.resposta) setResp(alvo.resposta); }}>
                <option value="">— Selecione uma resposta já dada —</option>
                {respondidasLib.filter(x => x.id !== respAlvo.id).map(x => <option key={x.id} value={x.id}>{x.titulo}</option>)}
              </select>
            </div>
            <div className="jd-fg"><label>Resposta do Jurídico *</label><textarea className="jd-fi" rows={6} value={resp} onChange={e => setResp(e.target.value)} placeholder="Escreva a resposta. Ela ficará pública na biblioteca (sem o nome de quem perguntou)." /></div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 6 }}>
              <button className="jd-btn" onClick={() => setRespAlvo(null)} style={{ background: "#fff", border: "1px solid #e2e8f0", color: "#475569" }}>Cancelar</button>
              <button className="jd-btn" onClick={responder} style={{ background: "#15803d", color: "#fff" }}>Publicar resposta</button>
            </div>
          </div>
        </div>
      )}

      {/* Admin: quem aprova / quem responde */}
      {adminModal && (
        <div className="jd-ov" onClick={e => { if (e.target === e.currentTarget) setAdminModal(false); }}>
          <div className="jd-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 560 }}>
            <button onClick={() => setAdminModal(false)} style={{ position: "absolute", top: 14, right: 16, border: "none", background: "none", fontSize: 20, color: "#94a3b8", cursor: "pointer" }}>✕</button>
            <div style={{ fontSize: 17, fontWeight: 800, marginBottom: 4 }}>Quem aprova e quem responde</div>
            <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 14 }}>Por padrão o setor <b>Diretor Administrativo</b> aprova e o setor <b>Jurídico</b> responde. Adicione abaixo pessoas específicas para cada papel.</div>
            <div className="jd-fg">
              <label>Buscar colaborador</label>
              <input className="jd-fi" placeholder="Nome do colaborador…" value={empSearch} onChange={e => { setEmpSearch(e.target.value); buscarEmps(e.target.value); }} />
            </div>
            {empLoading && <div style={{ fontSize: 12, color: "#94a3b8", padding: "4px 2px" }}>Buscando…</div>}
            {empResults.length > 0 && (
              <div style={{ border: "1px solid #e2e8f0", borderRadius: 9, maxHeight: 200, overflowY: "auto", marginBottom: 14 }}>
                {empResults.map((e, i) => (
                  <div key={e["ID"]} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, padding: "8px 11px", borderTop: i ? "1px solid #f1f5f9" : "none" }}>
                    <div style={{ minWidth: 0 }}><div style={{ fontSize: 12.5, fontWeight: 700, color: "#0f172a" }}>{e["Nome"]}</div><div style={{ fontSize: 11, color: "#94a3b8" }}>{e["Setor_ERP"] || "—"}{e["Nome Filial"] ? ` · ${e["Nome Filial"]}` : ""}</div></div>
                    <div style={{ display: "flex", gap: 5, flexShrink: 0 }}>
                      {aprovadoresIds.includes(e["ID"]) ? <span style={{ fontSize: 10.5, color: "#15803d", fontWeight: 700, alignSelf: "center" }}>aprova</span> : <button className="jd-btn" onClick={() => addAprovador(e)} style={{ background: "#eef4ff", color: "#0f3171", padding: "5px 9px" }}>+ Aprova</button>}
                      {responsaveisIds.includes(e["ID"]) ? <span style={{ fontSize: 10.5, color: "#7c3aed", fontWeight: 700, alignSelf: "center" }}>responde</span> : <button className="jd-btn" onClick={() => addResponsavel(e)} style={{ background: "#f3e8ff", color: "#7c3aed", padding: "5px 9px" }}>+ Responde</button>}
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
              <div style={{ flex: 1, minWidth: 210 }}>
                <div style={{ fontSize: 11, fontWeight: 800, color: "#0f3171", textTransform: "uppercase", letterSpacing: ".4px", marginBottom: 6 }}>Aprovadores extras</div>
                {aprovadores.length === 0 ? <div style={{ fontSize: 12.5, color: "#94a3b8" }}>Só o setor Diretor Administrativo.</div> : aprovadores.map(a => (
                  <div key={a.empregado_id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "7px 0", borderTop: "1px solid #f1f5f9" }}>
                    <span style={{ fontSize: 13, color: "#0f172a" }}>{a.nome || `ID ${a.empregado_id}`}</span>
                    <button className="jd-btn" onClick={() => removeAprovador(a.empregado_id)} style={{ background: "none", color: "#dc2626", padding: "4px 6px" }}>Remover</button>
                  </div>
                ))}
              </div>
              <div style={{ flex: 1, minWidth: 210 }}>
                <div style={{ fontSize: 11, fontWeight: 800, color: "#7c3aed", textTransform: "uppercase", letterSpacing: ".4px", marginBottom: 6 }}>Respondedores extras</div>
                {responsaveis.length === 0 ? <div style={{ fontSize: 12.5, color: "#94a3b8" }}>Só o setor Jurídico.</div> : responsaveis.map(r => (
                  <div key={r.empregado_id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "7px 0", borderTop: "1px solid #f1f5f9" }}>
                    <span style={{ fontSize: 13, color: "#0f172a" }}>{r.nome || `ID ${r.empregado_id}`}</span>
                    <button className="jd-btn" onClick={() => removeResponsavel(r.empregado_id)} style={{ background: "none", color: "#dc2626", padding: "4px 6px" }}>Remover</button>
                  </div>
                ))}
              </div>
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
