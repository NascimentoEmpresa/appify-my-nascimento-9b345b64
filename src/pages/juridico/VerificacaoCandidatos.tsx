import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { usePermissoes } from "@/context/PermissoesContext";
import { CandidatoInfo, baixarCurriculoCand, Modal, Campo, Acoes, Toasts, btnStyle, PendToggle, EtapaChip, HistoricoCandidato } from "@/components/recrutamento/CandidatoInfo";

// =====================================================================
// JURÍDICO — Verificação de Candidatos (fila do Recrutamento)
// Candidatos na etapa "Pendente Jurídico". O Jurídico analisa documentos e
// requisitos legais, e:
//   - libera para a Entrevista Comportamental (volta ao Recrutamento), ou reprova;
//   - define/remove a RESTRIÇÃO do CPF (só o Jurídico pode) — vale para qualquer vaga.
// Fonte: VW_RECRUTAMENTO_CANDIDATOS.
// =====================================================================

const digitsOf = (s?: string) => String(s ?? "").replace(/\D/g, "");

export default function VerificacaoCandidatos() {
  const { user } = useAuth();
  const { can } = usePermissoes();
  const podeAgir = can("alterar", undefined, "candidatos");
  const nome = user?.user_metadata?.nome ?? user?.email ?? "";

  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [busca, setBusca] = useState("");
  const [verTodos, setVerTodos] = useState(false);
  const [acao, setAcao] = useState<{ cand: any; tipo: "ok" | "reprovar" | "tirar_restricao" | "realocar" } | null>(null);
  const [obs, setObs] = useState("");
  const [restr, setRestr] = useState<any | null>(null);   // candidato p/ marcar restrição
  const [restrInput, setRestrInput] = useState("");
  const [toasts, setToasts] = useState<{ id: number; msg: string; t: string }[]>([]);

  const toast = (msg: string, t = "info") => {
    const id = Date.now() + Math.random();
    setToasts(x => [...x, { id, msg, t }]);
    setTimeout(() => setToasts(x => x.filter(i => i.id !== id)), 3600);
  };

  const load = useCallback(async () => {
    setLoading(true);
    let q = (supabase as any).from("VW_RECRUTAMENTO_CANDIDATOS").select("*");
    q = verTodos ? q.or("etapa_processo.eq.JURÍDICO,juridico_em.not.is.null") : q.eq("etapa_processo", "JURÍDICO");
    const { data, error } = await q.order("selecionado_em", { ascending: true });
    setLoading(false);
    if (error) { toast("Erro ao carregar: " + error.message, "err"); return; }
    setRows(data ?? []);
  }, [verTodos]);

  useEffect(() => { load(); }, [load]);

  const baixarCv = async (c: any) => {
    const err = await baixarCurriculoCand(c.storage_path);
    if (err) toast(err, "info");
  };

  const confirmar = async () => {
    if (!acao) return;
    if (acao.tipo !== "ok" && !obs.trim()) { toast("Informe o motivo.", "err"); return; }

    if (acao.tipo === "tirar_restricao" || acao.tipo === "realocar") {
      const ok = acao.tipo === "tirar_restricao"
        ? await tirarRestricao(acao.cand, obs.trim())
        : await realocarTriagem(acao.cand, obs.trim());
      if (!ok) return;
      const msg = acao.tipo === "tirar_restricao" ? "Restrição removida." : "Candidato realocado na Triagem.";
      setAcao(null); setObs("");
      toast(msg, "ok");
      load();
      return;
    }
    const nowIso = new Date().toISOString();
    const payload: Record<string, any> = acao.tipo === "ok"
      ? { etapa_processo: "ENTREVISTA", etapa_changed_at: nowIso, juridico_ok: true, juridico_por: nome, juridico_em: nowIso, juridico_obs: obs.trim() || null }
      : { etapa_processo: "Reprovado", etapa_changed_at: nowIso, juridico_ok: false, juridico_por: nome, juridico_em: nowIso, motivo_reprovacao: obs.trim() };
    const { error } = await (supabase as any).from("WA_CURRICULOS").update(payload).eq("id", acao.cand.candidato_id);
    if (error) { toast("Erro ao salvar: " + error.message, "err"); return; }
    // Reprova do Jurídico → restrição no CPF (vale para qualquer vaga).
    if (acao.tipo === "reprovar") {
      const d = digitsOf(acao.cand.cpf);
      if (d.length === 11) {
        await (supabase as any).from("RECRUTAMENTO_CPF_BLACKLIST").upsert({
          cpf_digits: d, cpf_fmt: acao.cand.cpf, motivo: obs.trim() || "Reprovado pelo Jurídico", criado_por: nome,
        }, { onConflict: "cpf_digits" });
      }
    }
    try {
      await (supabase as any).from("RECRUTAMENTO_HISTORICO").insert({
        solicitacao_id: acao.cand.vaga_id, candidato_id: acao.cand.candidato_id, candidato_nome: acao.cand.nome,
        evento: acao.tipo === "ok" ? "Liberado pelo Jurídico → Entrevista" : "Reprovado pelo Jurídico (restrição no CPF)",
        de_status: "JURÍDICO", para_status: acao.tipo === "ok" ? "ENTREVISTA" : "Reprovado",
        papel: "Jurídico", usuario_nome: nome, usuario_email: user?.email ?? "", detalhe: obs.trim() || null,
      });
    } catch { /* log não bloqueia */ }
    toast(acao.tipo === "ok" ? "Liberado para a Entrevista." : "Candidato reprovado e CPF restrito.", "ok");
    setAcao(null); setObs("");
    load();
  };

  // ── Restrição do CPF (só Jurídico) ──────────────────────────────────
  const salvarRestricao = async () => {
    if (!restr) return;
    const d = digitsOf(restr.cpf);
    if (d.length !== 11) { toast("CPF do candidato inválido.", "err"); return; }
    if (!restrInput.trim()) { toast("Informe o motivo da restrição.", "err"); return; }
    const { error } = await (supabase as any).from("RECRUTAMENTO_CPF_BLACKLIST").upsert({
      cpf_digits: d, cpf_fmt: restr.cpf, motivo: restrInput.trim(), criado_por: nome,
    }, { onConflict: "cpf_digits" });
    if (error) { toast("Erro: " + error.message, "err"); return; }
    // Restrito → vai direto para Reprovado (sai do processo).
    const nowIso = new Date().toISOString();
    await (supabase as any).from("WA_CURRICULOS").update({
      etapa_processo: "Reprovado", etapa_changed_at: nowIso, juridico_ok: false,
      juridico_por: nome, juridico_em: nowIso, motivo_reprovacao: "Restrição do Jurídico: " + restrInput.trim(),
    }).eq("id", restr.candidato_id);
    try {
      await (supabase as any).from("RECRUTAMENTO_HISTORICO").insert({
        solicitacao_id: restr.vaga_id, candidato_id: restr.candidato_id, candidato_nome: restr.nome,
        evento: "Restrição no CPF → candidato reprovado", de_status: "JURÍDICO", para_status: "Reprovado",
        papel: "Jurídico", usuario_nome: nome, usuario_email: user?.email ?? "", detalhe: restrInput.trim(),
      });
    } catch { /* noop */ }
    toast("CPF restrito — candidato reprovado.", "ok");
    setRestr(null); setRestrInput("");
    load();
  };

  // Tirar restrição e realocar exigem MOTIVO: as duas desfazem uma decisão já
  // registrada, e um confirm() sem justificativa deixava o histórico mostrando
  // que a restrição sumiu sem dizer por quê.
  const tirarRestricao = async (c: any, motivo: string) => {
    const d = digitsOf(c.cpf);
    if (d.length !== 11) { toast("CPF inválido.", "err"); return false; }
    const { error } = await (supabase as any).from("RECRUTAMENTO_CPF_BLACKLIST").delete().eq("cpf_digits", d);
    if (error) { toast("Erro: " + error.message, "err"); return false; }
    // Limpa também o parecer negativo: sem isso o juridico_ok = false sobrava
    // e o card seguia vermelho mesmo sem restrição nenhuma.
    await (supabase as any).from("WA_CURRICULOS")
      .update({ juridico_ok: null, juridico_obs: "Restrição removida: " + motivo, juridico_por: nome, juridico_em: new Date().toISOString() })
      .eq("id", c.candidato_id);
    try {
      await (supabase as any).from("RECRUTAMENTO_HISTORICO").insert({
        solicitacao_id: c.vaga_id, candidato_id: c.candidato_id, candidato_nome: c.nome,
        evento: "Restrição removida do CPF", papel: "Jurídico",
        usuario_nome: nome, usuario_email: user?.email ?? "", detalhe: motivo,
      });
    } catch { /* histórico é registro; não derruba a ação */ }
    return true;
  };

  const realocarTriagem = async (c: any, motivo: string) => {
    const { error } = await (supabase as any).from("WA_CURRICULOS").update({
      etapa_processo: "TRIAGEM", etapa_changed_at: new Date().toISOString(),
    }).eq("id", c.candidato_id);
    if (error) { toast("Erro: " + error.message, "err"); return false; }
    try {
      await (supabase as any).from("RECRUTAMENTO_HISTORICO").insert({
        solicitacao_id: c.vaga_id, candidato_id: c.candidato_id, candidato_nome: c.nome,
        evento: "Realocado na Triagem pelo Jurídico", de_status: c.etapa_processo, para_status: "TRIAGEM",
        papel: "Jurídico", usuario_nome: nome, usuario_email: user?.email ?? "", detalhe: motivo,
      });
    } catch { /* noop */ }
    return true;
  };

  const termo = busca.trim().toLowerCase();
  const filtrados = !termo ? rows : rows.filter(c =>
    [c.nome, c.cpf, c.cargo, c.contrato, c.cidade].some(v => String(v ?? "").toLowerCase().includes(termo)));

  const btn = btnStyle;

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", background: "#f5f7fb" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 22px", margin: "18px 24px 0", border: "1px solid #e2e8f0", borderRadius: 18, background: "linear-gradient(135deg,#fff 0%,#f8fbff 100%)", boxShadow: "0 8px 24px rgba(15,23,42,.06)", flexShrink: 0, gap: 14, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 19, fontWeight: 800, color: "#0f3171" }}>⚖️ Verificação de Candidatos</div>
          <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 2 }}>Análise de documentos e requisitos legais. Libere para a Entrevista Comportamental ou registre restrição no CPF.</div>
        </div>
        <span style={{ fontSize: 12, fontWeight: 800, background: "#ede9fe", color: "#7c3aed", border: "1px solid #ddd6fe", borderRadius: 20, padding: "4px 12px" }}>{rows.length} pendente(s)</span>
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
          <div style={{ padding: "60px 20px", textAlign: "center", color: "#94a3b8" }}>{verTodos ? "Nenhum candidato passou pelo Jurídico." : "Nenhum candidato aguardando verificação."}</div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(360px,1fr))", gap: 14, alignItems: "start" }}>
            {filtrados.map(c => (
              <div key={c.candidato_id} style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 14, overflow: "hidden", boxShadow: "0 8px 24px rgba(15,23,42,.06)" }}>
                <div style={{ height: 3, background: "#8b5cf6" }} />
                <div style={{ padding: "14px 16px" }}>
                  <CandidatoInfo cand={c} hideCurriculo />
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 12, alignItems: "center" }}>
                    {c.etapa_processo !== "JURÍDICO" && <span style={{ fontSize: 11, color: "#94a3b8" }}>Situação atual: <EtapaChip etapa={c.etapa_processo} /></span>}
                    <HistoricoCandidato candidatoId={c.candidato_id} nome={c.nome} />
                    {podeAgir && c.etapa_processo === "JURÍDICO" && <>
                      <button onClick={() => { setObs(""); setAcao({ cand: c, tipo: "ok" }); }} style={btn("#16a34a", "none", "#fff")}>✓ Liberar → Entrevista</button>
                      <button onClick={() => { setObs(""); setAcao({ cand: c, tipo: "reprovar" }); }} style={btn("rgba(220,38,38,.08)", "1px solid rgba(220,38,38,.25)", "#dc2626")}>Reprovar</button>
                      {!c.possui_restricao && <button onClick={() => { setRestrInput(""); setRestr(c); }} style={btn("#fffbeb", "1px solid #fde68a", "#92400e")}>⚠️ Restringir</button>}
                    </>}
                    {/* Fora do bloco acima de propósito: desfazer restrição e
                        trazer o candidato de volta não são ações da etapa
                        JURÍDICO — o caso típico é justamente alguém que já foi
                        reprovado e está em outra coluna. */}
                    {podeAgir && c.possui_restricao && (
                      <button onClick={() => { setObs(""); setAcao({ cand: c, tipo: "tirar_restricao" }); }} style={btn("#f1f5f9", "1px solid #e2e8f0", "#475569")}>🔓 Tirar restrição</button>
                    )}
                    {podeAgir && c.etapa_processo !== "TRIAGEM" && (
                      <button onClick={() => { setObs(""); setAcao({ cand: c, tipo: "realocar" }); }} style={btn("rgba(59,130,246,.08)", "1px solid rgba(59,130,246,.25)", "#2563eb")}>↩ Realocar na Triagem</button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Modal aprovar/reprovar */}
      {acao && (
        <Modal onClose={() => { setAcao(null); setObs(""); }}
          title={acao.tipo === "ok" ? "Liberar para a Entrevista"
            : acao.tipo === "tirar_restricao" ? "🔓 Tirar restrição do CPF"
            : acao.tipo === "realocar" ? "↩ Realocar na Triagem"
            : "Reprovar candidato (restringe o CPF)"}
          sub={`${acao.cand.nome} · ${acao.cand.cargo || ""}`}>
          {acao.tipo === "tirar_restricao" && (
            <div style={{ fontSize: 12, color: "#475569", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, padding: "8px 10px", marginBottom: 12 }}>
              O CPF deixa de aparecer como restrito em <b>todas</b> as vagas, e o parecer negativo do Jurídico é limpo.
            </div>
          )}
          {acao.tipo === "realocar" && (
            <div style={{ fontSize: 12, color: "#1e40af", background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 8, padding: "8px 10px", marginBottom: 12 }}>
              O candidato volta para a <b>Triagem</b> do Recrutamento e segue o processo a partir de lá.
            </div>
          )}
          <Campo label={acao.tipo === "ok" ? "Observação (opcional)" : "Motivo *"} value={obs} onChange={setObs}
            placeholder={acao.tipo === "ok" ? "Ex.: documentação OK, nada consta."
              : acao.tipo === "tirar_restricao" ? "Ex.: certidão apresentada, pendência resolvida."
              : acao.tipo === "realocar" ? "Ex.: reanálise pedida pelo RH."
              : "Descreva o motivo..."} />
          <Acoes onCancel={() => { setAcao(null); setObs(""); }} onConfirm={confirmar}
            cor={acao.tipo === "ok" ? "#16a34a" : acao.tipo === "reprovar" ? "#dc2626" : acao.tipo === "realocar" ? "#2563eb" : "#475569"} />
        </Modal>
      )}

      {/* Modal restrição */}
      {restr && (
        <Modal onClose={() => { setRestr(null); setRestrInput(""); }} title="⚠️ Registrar restrição no CPF" sub={`${restr.nome} · CPF ${restr.cpf || "—"}`}>
          <div style={{ fontSize: 12, color: "#92400e", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 8, padding: "8px 10px", marginBottom: 12 }}>
A restrição fica vinculada ao CPF (aparece em qualquer vaga) e o candidato é <b>reprovado</b> nesta vaga.
          </div>
          <Campo label="Motivo *" value={restrInput} onChange={setRestrInput} placeholder="Descreva o motivo da restrição..." />
          <Acoes onCancel={() => { setRestr(null); setRestrInput(""); }} onConfirm={salvarRestricao} cor="#d97706" />
        </Modal>
      )}

      <Toasts toasts={toasts} />
    </div>
  );
}
