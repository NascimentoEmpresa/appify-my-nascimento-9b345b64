import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { usePermissoes } from "@/context/PermissoesContext";
import { CandidatoInfo, baixarCurriculoCand, Toasts, btnStyle, PendToggle, HistoricoCandidato } from "@/components/recrutamento/CandidatoInfo";

// =====================================================================
// RH — Novas Admissões
// Candidatos na etapa "Admissão" (após Compras), ainda não admitidos. O RH
// preenche os dados e CADASTRA o novo colaborador na tabela EMPREGADOS.
// Fonte: VW_RECRUTAMENTO_CANDIDATOS (etapa='Admissão' e admitido_por nulo).
// =====================================================================

// Campos da EMPREGADOS preenchidos na admissão (coluna → rótulo).
const CAMPOS: { key: string; label: string; type?: string }[] = [
  { key: "Nome", label: "Nome completo *" },
  { key: "CPF", label: "CPF *" },
  { key: "Título do Cargo", label: "Cargo *" },
  { key: "Situação", label: "Situação" },
  { key: "Admissão", label: "Data de Admissão *", type: "date" },
  { key: "Valor Salário", label: "Salário" },
  { key: "Empresa", label: "Empresa (cód.)" },
  { key: "Nome da Empresa", label: "Nome da Empresa" },
  { key: "Filial", label: "Filial (cód.)" },
  { key: "Nome Filial", label: "Nome da Filial" },
  { key: "Contrato", label: "Contrato" },
  { key: "Setor_ERP", label: "Setor" },
  { key: "Perfil_ERP", label: "Perfil" },
  { key: "LIDER", label: "Líder" },
  { key: "C.Custo", label: "Centro de Custo" },
  { key: "Titulo C.Custo", label: "Título do C.Custo" },
  { key: "PIS", label: "PIS" },
  { key: "email", label: "E-mail" },
  { key: "Descrição do Local", label: "Local / Posto" },
];

export default function NovasAdmissoes() {
  const { user } = useAuth();
  const { can } = usePermissoes();
  const podeAgir = can("alterar", undefined, "colaboradores");
  const nome = user?.user_metadata?.nome ?? user?.email ?? "";

  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [busca, setBusca] = useState("");
  const [verTodos, setVerTodos] = useState(false);
  const [form, setForm] = useState<Record<string, string> | null>(null);  // candidato em admissão
  const [cand, setCand] = useState<any | null>(null);
  const [saving, setSaving] = useState(false);
  const [toasts, setToasts] = useState<{ id: number; msg: string; t: string }[]>([]);

  const toast = (msg: string, t = "info") => {
    const id = Date.now() + Math.random();
    setToasts(x => [...x, { id, msg, t }]);
    setTimeout(() => setToasts(x => x.filter(i => i.id !== id)), 3600);
  };

  const load = useCallback(async () => {
    setLoading(true);
    let q = (supabase as any).from("VW_RECRUTAMENTO_CANDIDATOS").select("*").not("enviado_admissao_em", "is", null);
    if (!verTodos) q = q.is("admitido_por", null);
    const { data, error } = await q.order("etapa_changed_at", { ascending: true });
    setLoading(false);
    if (error) { toast("Erro ao carregar: " + error.message, "err"); return; }
    setRows(data ?? []);
  }, [verTodos]);

  useEffect(() => { load(); }, [load]);

  const baixarCv = async (c: any) => { const err = await baixarCurriculoCand(c.storage_path); if (err) toast(err, "info"); };

  const abrirForm = (c: any) => {
    setCand(c);
    const hoje = new Date().toISOString().slice(0, 10);
    setForm({
      "Nome": c.nome || "",
      "CPF": c.cpf || "",
      "Título do Cargo": c.cargo || "",
      "Situação": "Trabalhando",
      "Admissão": hoje,
      "Valor Salário": c.salario || "",
      "Empresa": "",
      "Nome da Empresa": "",
      "Filial": "",
      "Nome Filial": "",
      "Contrato": c.contrato || "",
      "Setor_ERP": "",
      "Perfil_ERP": "",
      "LIDER": "",
      "C.Custo": "",
      "Titulo C.Custo": "",
      "PIS": "",
      "email": c.email || "",
      "Descrição do Local": c.local_exato || "",
    });
  };

  const admitir = async () => {
    if (!form || !cand) return;
    if (!form["Nome"].trim() || !form["CPF"].trim() || !form["Título do Cargo"].trim() || !form["Admissão"].trim()) {
      toast("Preencha Nome, CPF, Cargo e Data de Admissão.", "err"); return;
    }
    setSaving(true);
    // Só envia colunas com valor (evita sobrescrever defaults do banco com vazio).
    const payload: Record<string, any> = {};
    for (const { key } of CAMPOS) { const v = (form[key] ?? "").trim(); if (v) payload[key] = v; }

    const { data: novo, error } = await (supabase as any).from("EMPREGADOS").insert(payload).select().single();
    if (error) { setSaving(false); toast("Erro ao cadastrar EMPREGADO: " + error.message, "err"); return; }

    const nowIso = new Date().toISOString();
    const empId = novo?.["ID"] ?? null;
    await (supabase as any).from("WA_CURRICULOS")
      .update({ admitido_por: nome, admitido_em: nowIso, empregado_id: empId })
      .eq("id", cand.candidato_id);
    try {
      await (supabase as any).from("RECRUTAMENTO_HISTORICO").insert({
        solicitacao_id: cand.vaga_id, candidato_id: cand.candidato_id, candidato_nome: cand.nome,
        evento: "Colaborador admitido (EMPREGADO cadastrado)", de_status: "Admissão", para_status: "Admitido",
        papel: "RH", usuario_nome: nome, usuario_email: user?.email ?? "",
        detalhe: empId ? `EMPREGADOS.ID ${empId}` : undefined,
      });
    } catch { /* noop */ }
    setSaving(false);
    setForm(null); setCand(null);
    toast("Colaborador admitido e cadastrado em EMPREGADOS!", "ok");
    load();
  };

  const termo = busca.trim().toLowerCase();
  const filtrados = !termo ? rows : rows.filter(c => [c.nome, c.cpf, c.cargo, c.contrato, c.cidade].some(v => String(v ?? "").toLowerCase().includes(termo)));

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", background: "#f5f7fb" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 22px", margin: "18px 24px 0", border: "1px solid #e2e8f0", borderRadius: 18, background: "linear-gradient(135deg,#fff 0%,#f8fbff 100%)", boxShadow: "0 8px 24px rgba(15,23,42,.06)", flexShrink: 0, gap: 14, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 19, fontWeight: 800, color: "#0f3171" }}>🧾 Novas Admissões</div>
          <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 2 }}>Candidatos aprovados em todas as etapas. Preencha os dados e cadastre o novo colaborador.</div>
        </div>
        <span style={{ fontSize: 12, fontWeight: 800, background: "#dcfce7", color: "#15803d", border: "1px solid #86efac", borderRadius: 20, padding: "4px 12px" }}>{rows.length} para admitir</span>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "20px 24px 24px" }}>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginBottom: 14 }}>
          <input placeholder="Buscar por nome, CPF, cargo, contrato, cidade..." value={busca} onChange={e => setBusca(e.target.value)}
            style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, color: "#0f172a", fontSize: 12, padding: "9px 12px", outline: "none", flex: 1, minWidth: 240, boxShadow: "0 8px 24px rgba(15,23,42,.06)" }} />
          <PendToggle verTodos={verTodos} setVerTodos={setVerTodos} />
        </div>

        {loading ? (
          <div style={{ padding: "60px 20px", textAlign: "center", color: "#94a3b8" }}>Carregando...</div>
        ) : filtrados.length === 0 ? (
          <div style={{ padding: "60px 20px", textAlign: "center", color: "#94a3b8" }}>Nenhum candidato aguardando admissão.</div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(360px,1fr))", gap: 14, alignItems: "start" }}>
            {filtrados.map(c => (
              <div key={c.candidato_id} style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 14, overflow: "hidden", boxShadow: "0 8px 24px rgba(15,23,42,.06)" }}>
                <div style={{ height: 3, background: "#16a34a" }} />
                <div style={{ padding: "14px 16px" }}>
                  <CandidatoInfo cand={c} />
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 12, alignItems: "center" }}>
                    {c.admitido_por && <span style={{ fontSize: 11, fontWeight: 800, padding: "3px 10px", borderRadius: 20, background: "#dcfce7", color: "#15803d" }}>✓ Admitido por {c.admitido_por}</span>}
                    <HistoricoCandidato candidatoId={c.candidato_id} nome={c.nome} />
                    {c.storage_path && <button onClick={() => baixarCv(c)} style={btnStyle("rgba(249,115,22,.12)", "1px solid rgba(249,115,22,.25)", "#f97316")}>↓ Currículo</button>}
                    {podeAgir && !c.admitido_por && <button onClick={() => abrirForm(c)} style={btnStyle("#16a34a", "none", "#fff")}>✓ Admitir / Cadastrar EMPREGADO</button>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Formulário de admissão (cria EMPREGADO) */}
      {form && cand && (
        <div style={{ position: "fixed", inset: 0, zIndex: 700, background: "rgba(15,23,42,.42)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 18, padding: 24, width: "100%", maxWidth: 720, maxHeight: "90vh", overflowY: "auto", position: "relative", boxShadow: "0 16px 40px rgba(15,23,42,.1)" }}>
            <button onClick={() => { setForm(null); setCand(null); }} style={{ position: "absolute", top: 14, right: 14, background: "none", border: "none", color: "#94a3b8", fontSize: 20, cursor: "pointer" }}>✕</button>
            <div style={{ fontSize: 17, fontWeight: 800, marginBottom: 2 }}>Admissão — novo colaborador</div>
            <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 16 }}>Vaga #{cand.vaga_id} · {cand.cargo} · {cand.contrato}</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px 14px" }}>
              {CAMPOS.map(f => (
                <div key={f.key}>
                  <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "#94a3b8", textTransform: "uppercase", letterSpacing: ".4px", marginBottom: 4 }}>{f.label}</label>
                  <input type={f.type || "text"} value={form[f.key] ?? ""} onChange={e => setForm(s => ({ ...(s as any), [f.key]: e.target.value }))}
                    style={{ width: "100%", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, color: "#0f172a", fontSize: 13, padding: "8px 10px", outline: "none", fontFamily: "inherit" }} />
                </div>
              ))}
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 18 }}>
              <button onClick={() => { setForm(null); setCand(null); }} style={{ padding: "8px 16px", borderRadius: 10, border: "1px solid #e2e8f0", background: "#fff", color: "#475569", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>Cancelar</button>
              <button onClick={admitir} disabled={saving} style={{ padding: "8px 16px", borderRadius: 10, border: "none", background: "#16a34a", color: "#fff", fontSize: 12, fontWeight: 700, cursor: saving ? "default" : "pointer", opacity: saving ? .6 : 1 }}>{saving ? "Cadastrando..." : "✓ Cadastrar colaborador"}</button>
            </div>
          </div>
        </div>
      )}

      <Toasts toasts={toasts} />
    </div>
  );
}
