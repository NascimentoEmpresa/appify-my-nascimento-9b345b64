import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

// Bloco compartilhado: mostra TODAS as informações do candidato + da vaga +
// restrição do CPF + perfil e anexos (CV/CTPS). Usado nas filas de Jurídico,
// SST, Suprimentos e RH.

export async function baixarCurriculoCand(storage_path?: string): Promise<string | null> {
  if (!storage_path) return "Sem arquivo de currículo.";
  const { data, error } = await supabase.storage.from("curriculos").createSignedUrl(storage_path, 3600);
  if (error || !data?.signedUrl) return "Não foi possível abrir o arquivo.";
  window.open(data.signedUrl, "_blank", "noopener");
  return null;
}

const simNao = (b: any) => (b === true ? "Sim" : b === false ? "Não" : null);
const fmtD = (s?: string) => (!s ? null : String(s).slice(0, 10).split("-").reverse().join("/"));

const Field = ({ label, val }: { label: string; val: any }) =>
  (val || val === false) ? (
    <div style={{ fontSize: 12, color: "#475569" }}>
      <span style={{ color: "#94a3b8", fontWeight: 700 }}>{label}: </span>{typeof val === "boolean" ? simNao(val) : val}
    </div>
  ) : null;

export function CandidatoInfo({ cand, hideCurriculo }: { cand: any; hideCurriculo?: boolean }) {
  // Carrega perfil completo + anexos do candidato (WA_CURRICULOS + arquivos).
  const [perfil, setPerfil] = useState<any | null>(null);
  const [arqs, setArqs] = useState<any[]>([]);
  const [aberto, setAberto] = useState(false);
  useEffect(() => {
    let vivo = true;
    (async () => {
      if (!cand?.candidato_id) return;
      const COLS = "data_nascimento,rg,sexo,nome_mae,nome_pai,escolaridade,cidade_residencia,estado_desejado,cidade_desejada,cargos_interesse,disponibilidade_horarios,disp_fim_semana,possui_cnh,experiencia_previa,estrangeiro,experiencia_1,experiencia_2,experiencia_3,sst_data_exame,sst_hora_exame,sst_local_exame";
      // sst_maps_url é recente — se o banco ainda não tiver a coluna, refaz sem ela.
      let pr = await (supabase as any).from("WA_CURRICULOS").select(COLS + ",sst_maps_url").eq("id", cand.candidato_id).maybeSingle();
      if (pr.error) pr = await (supabase as any).from("WA_CURRICULOS").select(COLS).eq("id", cand.candidato_id).maybeSingle();
      const { data: a } = await (supabase as any).from("RECRUTAMENTO_CANDIDATO_ARQUIVOS").select("*").eq("candidato_id", cand.candidato_id).order("id");
      if (!vivo) return;
      setPerfil(pr.data ?? null); setArqs(a ?? []);
    })();
    return () => { vivo = false; };
  }, [cand?.candidato_id]);

  const baixarArq = async (a: any) => { await baixarCurriculoCand(a.storage_path); };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {/* Candidato */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <div style={{ fontSize: 15, fontWeight: 800, color: "#0f172a" }}>{cand.nome || "Sem nome"}</div>
        {cand.possui_restricao && (
          <span title={cand.restricao_motivo || ""} style={{ fontSize: 10, fontWeight: 800, padding: "2px 9px", borderRadius: 20, background: "#fef3c7", color: "#92400e", border: "1px solid #fde68a" }}>⚠️ Possui restrições</span>
        )}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
        <Field label="CPF" val={cand.cpf} />
        <Field label="Fone" val={cand.telefone} />
        <Field label="Email" val={cand.email} />
      </div>

      {/* Resumo da vaga (sempre visível) */}
      <div style={{ fontSize: 12, color: "#475569" }}>
        <span style={{ color: "#94a3b8", fontWeight: 700 }}>Vaga #{cand.vaga_id}: </span>
        {[cand.cargo, cand.cidade].filter(Boolean).join(" · ") || "—"}
        {cand.grau_urgencia?.startsWith("Alta") && <span style={{ marginLeft: 6, fontSize: 9.5, fontWeight: 800, padding: "1px 6px", borderRadius: 20, background: "#fee2e2", color: "#b91c1c" }}>URGENTE</span>}
      </div>

      {/* Ver detalhes do candidato → modal grande */}
      <button onClick={() => setAberto(true)} style={{ alignSelf: "flex-start", padding: "6px 12px", borderRadius: 8, background: "rgba(15,49,113,.08)", border: "1px solid rgba(15,49,113,.2)", color: "#0f3171", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
        🔍 Ver detalhes do candidato
      </button>

      {aberto && (
        <div style={{ position: "fixed", inset: 0, zIndex: 760, background: "rgba(15,23,42,.48)", backdropFilter: "blur(5px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }} onClick={e => { if (e.target === e.currentTarget) setAberto(false); }}>
          <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 18, padding: 24, width: "100%", maxWidth: 760, maxHeight: "88vh", overflowY: "auto", position: "relative", boxShadow: "0 20px 60px rgba(15,23,42,.25)", display: "flex", flexDirection: "column", gap: 10 }} onClick={e => e.stopPropagation()}>
            <button onClick={() => setAberto(false)} style={{ position: "absolute", top: 14, right: 14, background: "none", border: "none", color: "#94a3b8", fontSize: 22, cursor: "pointer" }}>✕</button>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", paddingRight: 24 }}>
              <div style={{ fontSize: 18, fontWeight: 800, color: "#0f172a" }}>{cand.nome || "Sem nome"}</div>
              {cand.possui_restricao && <span style={{ fontSize: 10, fontWeight: 800, padding: "2px 9px", borderRadius: 20, background: "#fef3c7", color: "#92400e", border: "1px solid #fde68a" }}>⚠️ Possui restrições</span>}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
              <Field label="CPF" val={cand.cpf} />
              <Field label="Fone" val={cand.telefone} />
              <Field label="Email" val={cand.email} />
            </div>
      {cand.possui_restricao && cand.restricao_motivo && (
        <div style={{ fontSize: 11.5, color: "#92400e", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 8, padding: "7px 9px" }}>
          <b>Restrição (Jurídico):</b> {cand.restricao_motivo}
        </div>
      )}

      {/* Vaga */}
      <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 10, padding: "10px 12px" }}>
        <div style={{ fontSize: 11, fontWeight: 800, color: "#0f3171", marginBottom: 6, textTransform: "uppercase", letterSpacing: ".4px" }}>Vaga #{cand.vaga_id}</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px 14px" }}>
          <Field label="Cargo" val={cand.cargo} />
          <Field label="Contrato" val={cand.contrato} />
          <Field label="Cidade" val={cand.cidade} />
          <Field label="Motivo" val={cand.motivo_vaga} />
          {cand.motivo_vaga === "Substituição"
            ? <Field label="Substituindo" val={cand.nome_substituido} />
            : <Field label="Tipo" val={cand.motivo_vaga ? "Aumento de quadro" : null} />}
          <Field label="Escala" val={cand.escala} />
          <Field label="Horário" val={cand.horario} />
          <Field label="Salário" val={cand.salario} />
          <Field label="Insalubridade" val={cand.insalubridade_recebe + (cand.insalubridade_quanto ? " — " + cand.insalubridade_quanto : "")} />
          <Field label="Local" val={cand.local_exato} />
          <Field label="Reserva Técnica (RT)" val={cand.reserva_tecnica ? "Sim" : null} />
          {/* Indicação de quem abriu a vaga. Só aparece quando existe — o
              Field some sozinho com valor vazio. */}
          <Field label="Indicação" val={cand.tem_recomendacao ? cand.recomendacao_nome : null} />
          <Field label="CPF da indicação" val={cand.tem_recomendacao ? cand.recomendacao_cpf : null} />
          <Field label="WhatsApp da indicação" val={cand.tem_recomendacao ? cand.recomendacao_whatsapp : null} />
          <Field label="Início previsto" val={cand.data_inicio_prevista} />
          <Field label="Urgência" val={cand.grau_urgencia} />
          <Field label="Solicitante" val={cand.solicitante_nome} />
        </div>
        {cand.beneficios && <div style={{ marginTop: 6, fontSize: 12, color: "#475569" }}><span style={{ color: "#94a3b8", fontWeight: 700 }}>Benefícios: </span>{cand.beneficios}</div>}
        {cand.req_obrigatorios && <div style={{ marginTop: 4, fontSize: 12, color: "#475569" }}><span style={{ color: "#94a3b8", fontWeight: 700 }}>Req. obrigatórios: </span>{cand.req_obrigatorios}</div>}
        {cand.req_desejaveis && <div style={{ fontSize: 12, color: "#475569" }}><span style={{ color: "#94a3b8", fontWeight: 700 }}>Req. desejáveis: </span>{cand.req_desejaveis}</div>}
      </div>

      {/* Perfil completo (do cadastro do portal) */}
      {perfil && (perfil.data_nascimento || perfil.rg || perfil.escolaridade || perfil.nome_mae) && (
        <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 10, padding: "10px 12px" }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: "#0f3171", marginBottom: 6, textTransform: "uppercase", letterSpacing: ".4px" }}>Perfil do candidato</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "3px 14px" }}>
            <Field label="Nascimento" val={fmtD(perfil.data_nascimento)} />
            <Field label="RG" val={perfil.rg} />
            <Field label="Sexo" val={perfil.sexo} />
            <Field label="Escolaridade" val={perfil.escolaridade} />
            <Field label="Nome da mãe" val={perfil.nome_mae} />
            <Field label="Nome do pai" val={perfil.nome_pai} />
            <Field label="Reside" val={perfil.cidade_residencia} />
            <Field label="CNH" val={perfil.possui_cnh} />
            <Field label="Disp. horários" val={perfil.disponibilidade_horarios} />
            <Field label="Fim de semana" val={perfil.disp_fim_semana} />
            <Field label="Experiência" val={perfil.experiencia_previa} />
            <Field label="Estrangeiro" val={perfil.estrangeiro} />
          </div>
          {perfil.cargos_interesse && <div style={{ marginTop: 4, fontSize: 12, color: "#475569" }}><span style={{ color: "#94a3b8", fontWeight: 700 }}>Cargos de interesse: </span>{perfil.cargos_interesse}</div>}
          {(perfil.experiencia_1 || perfil.experiencia_2 || perfil.experiencia_3) && (
            <div style={{ marginTop: 6, fontSize: 12, color: "#475569" }}>
              <span style={{ color: "#94a3b8", fontWeight: 700 }}>Experiências: </span>
              {[perfil.experiencia_1, perfil.experiencia_2, perfil.experiencia_3].filter(Boolean).join(" · ")}
            </div>
          )}
        </div>
      )}

      {/* Agendamento do exame (SST) */}
      {perfil?.sst_data_exame && (
        <div style={{ fontSize: 12, background: "#ecfdf5", border: "1px solid #a7f3d0", borderRadius: 8, padding: "8px 10px", color: "#15803d" }}>
          🗓 <b>Exame agendado:</b> {fmtD(perfil.sst_data_exame)}{perfil.sst_hora_exame ? ` às ${perfil.sst_hora_exame}` : ""}{perfil.sst_local_exame ? ` · ${perfil.sst_local_exame}` : ""}
          {(perfil.sst_maps_url || perfil.sst_local_exame) && <> · <a href={perfil.sst_maps_url || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(perfil.sst_local_exame)}`} target="_blank" rel="noopener noreferrer" style={{ color: "#0369a1", fontWeight: 700 }}>📍 Ver no mapa</a></>}
        </div>
      )}

      {/* Anexos (Currículo / CTPS) — currículo pode ser ocultado por setor */}
      {arqs.filter(a => !(hideCurriculo && a.tipo === "curriculo")).length > 0 && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {arqs.filter(a => !(hideCurriculo && a.tipo === "curriculo")).map(a => (
            <button key={a.id} onClick={() => baixarArq(a)} style={{ padding: "6px 11px", borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: "pointer", background: a.tipo === "ctps" ? "rgba(139,92,246,.12)" : "rgba(249,115,22,.12)", border: `1px solid ${a.tipo === "ctps" ? "rgba(139,92,246,.3)" : "rgba(249,115,22,.3)"}`, color: a.tipo === "ctps" ? "#7c3aed" : "#ea580c" }}>↓ {a.tipo === "ctps" ? "CTPS" : "Currículo"}</button>
          ))}
        </div>
      )}

          </div>
        </div>
      )}
    </div>
  );
}

// ── UI compartilhada das filas por setor ──────────────────────────────
import type { ReactNode, CSSProperties } from "react";

export function Modal({ title, sub, children, onClose, maxWidth = 460 }: { title: string; sub?: string; children: ReactNode; onClose: () => void; maxWidth?: number }) {
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 700, background: "rgba(15,23,42,.42)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 18, padding: 24, width: "100%", maxWidth, maxHeight: "90vh", overflowY: "auto", position: "relative", boxShadow: "0 16px 40px rgba(15,23,42,.1)" }}>
        <button onClick={onClose} style={{ position: "absolute", top: 14, right: 14, background: "none", border: "none", color: "#94a3b8", fontSize: 20, cursor: "pointer" }}>✕</button>
        <div style={{ fontSize: 17, fontWeight: 800, marginBottom: 4 }}>{title}</div>
        {sub && <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 14 }}>{sub}</div>}
        {children}
      </div>
    </div>
  );
}

export function Campo({ label, value, onChange, placeholder, rows = 3 }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; rows?: number }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "#94a3b8", textTransform: "uppercase", letterSpacing: ".5px", marginBottom: 5 }}>{label}</label>
      <textarea rows={rows} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
        style={{ width: "100%", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, color: "#0f172a", fontSize: 13, padding: "8px 12px", outline: "none", fontFamily: "inherit", resize: "vertical" }} />
    </div>
  );
}

export function Acoes({ onCancel, onConfirm, cor, confirmLabel = "Confirmar" }: { onCancel: () => void; onConfirm: () => void; cor: string; confirmLabel?: string }) {
  return (
    <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
      <button onClick={onCancel} style={{ padding: "7px 14px", borderRadius: 10, border: "1px solid #e2e8f0", background: "#fff", color: "#475569", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>Cancelar</button>
      <button onClick={onConfirm} style={{ padding: "7px 14px", borderRadius: 10, border: "none", background: cor, color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>{confirmLabel}</button>
    </div>
  );
}

export function Toasts({ toasts }: { toasts: { id: number; msg: string; t: string }[] }) {
  return (
    <div style={{ position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)", zIndex: 9999, pointerEvents: "none", display: "flex", flexDirection: "column", gap: 6, alignItems: "center" }}>
      {toasts.map(t => (
        <div key={t.id} style={{ display: "inline-block", padding: "10px 18px", borderRadius: 9, fontSize: 13, fontWeight: 600, boxShadow: "0 16px 40px rgba(15,23,42,.1)",
          background: t.t === "ok" ? "#ecfdf3" : t.t === "err" ? "#fef2f2" : "#eff6ff",
          color: t.t === "ok" ? "#15803d" : t.t === "err" ? "#b91c1c" : "#1d4ed8",
          border: `1px solid ${t.t === "ok" ? "#86efac" : t.t === "err" ? "#fecaca" : "#bfdbfe"}` }}>{t.msg}</div>
      ))}
    </div>
  );
}

export const btnStyle = (bg: string, brd: string, col: string): CSSProperties =>
  ({ padding: "6px 11px", borderRadius: 8, background: bg, border: brd, color: col, fontSize: 12, fontWeight: 700, cursor: "pointer" });

// Toggle "Pendentes | Todos" (histórico do setor).
export function PendToggle({ verTodos, setVerTodos }: { verTodos: boolean; setVerTodos: (v: boolean) => void }) {
  return (
    <div style={{ display: "inline-flex", gap: 2, background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: 3, boxShadow: "0 8px 24px rgba(15,23,42,.06)" }}>
      {([["Pendentes", false], ["Todos", true]] as [string, boolean][]).map(([lbl, v]) => (
        <button key={lbl} onClick={() => setVerTodos(v)} style={{ padding: "7px 15px", borderRadius: 8, border: "none", background: verTodos === v ? "#0f3171" : "transparent", color: verTodos === v ? "#fff" : "#94a3b8", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>{lbl}</button>
      ))}
    </div>
  );
}

// Botão + modal de histórico de movimentações de um candidato.
const papelHistCor = (p?: string): string => (({
  Solicitante: "#0f3171", Operacional: "#b45309", Recrutamento: "#2563eb",
  "Jurídico": "#7c3aed", SST: "#ea580c", Suprimentos: "#f97316", RH: "#16a34a",
} as Record<string, string>)[p || ""] || "#64748b");

export function HistoricoCandidato({ candidatoId, nome }: { candidatoId: number; nome?: string }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<any[]>([]);
  const [nomesPorEmail, setNomesPorEmail] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const abrir = async () => {
    setOpen(true); setLoading(true);
    const { data } = await (supabase as any).from("RECRUTAMENTO_HISTORICO").select("*").eq("candidato_id", candidatoId).order("created_at", { ascending: true });
    const historico = data ?? [];
    // Nome gravado no histórico às vezes é só o e-mail (quando o usuário não
    // tinha nome no metadata) — busca o nome completo real em EMPREGADOS.
    const emails = Array.from(new Set(historico.map((r: any) => r.usuario_email).filter(Boolean)));
    let mapa: Record<string, string> = {};
    if (emails.length) {
      const { data: emps } = await (supabase as any).from("EMPREGADOS").select('"Nome","email"').in("email", emails);
      (emps ?? []).forEach((e: any) => { if (e.email && e["Nome"]) mapa[e.email] = e["Nome"]; });
    }
    setNomesPorEmail(mapa);
    setRows(historico); setLoading(false);
  };
  return (
    <>
      <button onClick={abrir} style={{ padding: "6px 11px", borderRadius: 8, background: "#fff", border: "1px solid #e2e8f0", color: "#475569", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>📜 Histórico</button>
      {open && (
        <div style={{ position: "fixed", inset: 0, zIndex: 750, background: "rgba(15,23,42,.42)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }} onClick={e => { if (e.target === e.currentTarget) setOpen(false); }}>
          <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 18, padding: 24, width: "100%", maxWidth: 600, maxHeight: "85vh", overflowY: "auto", position: "relative", boxShadow: "0 16px 40px rgba(15,23,42,.1)" }}>
            <button onClick={() => setOpen(false)} style={{ position: "absolute", top: 14, right: 14, background: "none", border: "none", color: "#94a3b8", fontSize: 20, cursor: "pointer" }}>✕</button>
            <div style={{ fontSize: 17, fontWeight: 800, marginBottom: 2 }}>📜 Histórico do candidato</div>
            <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 16 }}>{nome || ""}</div>
            {loading ? <div style={{ padding: 30, textAlign: "center", color: "#94a3b8" }}>Carregando...</div>
              : rows.length === 0 ? <div style={{ padding: 30, textAlign: "center", color: "#94a3b8" }}>Sem movimentações registradas.</div>
                : <div style={{ display: "flex", flexDirection: "column" }}>
                  {rows.map((e, i) => {
                    const c = papelHistCor(e.papel);
                    const dt = String(e.created_at ?? "").replace("T", " ").slice(0, 16);
                    const nomeExibido = nomesPorEmail[e.usuario_email] || e.usuario_nome || "—";
                    return (
                      <div key={i} style={{ display: "flex", gap: 12, paddingBottom: i === rows.length - 1 ? 0 : 18 }}>
                        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flexShrink: 0 }}>
                          <span style={{ width: 12, height: 12, borderRadius: "50%", background: c, border: "2px solid #fff", boxShadow: `0 0 0 2px ${c}33`, marginTop: 3 }} />
                          {i < rows.length - 1 && <span style={{ flex: 1, width: 2, background: "#e2e8f0", marginTop: 2 }} />}
                        </div>
                        <div style={{ flex: 1 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                            <span style={{ fontSize: 13.5, fontWeight: 800, color: "#0f172a" }}>{e.evento}</span>
                            {e.papel && <span style={{ fontSize: 10, fontWeight: 800, padding: "1px 8px", borderRadius: 20, background: `${c}1a`, color: c }}>{e.papel}</span>}
                          </div>
                          {(e.de_status || e.para_status) && <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 2 }}>{e.de_status ? `${e.de_status} → ` : ""}{e.para_status || ""}</div>}
                          {e.detalhe && <div style={{ fontSize: 12, color: "#475569", marginTop: 4, background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, padding: "6px 9px", whiteSpace: "pre-wrap" }}>{e.detalhe}</div>}
                          <div style={{ fontSize: 12.5, color: "#0f172a", marginTop: 4 }}><span style={{ fontWeight: 800 }}>{nomeExibido}</span><span style={{ color: "#94a3b8", fontWeight: 400 }}> · {dt}</span></div>
                        </div>
                      </div>
                    );
                  })}
                </div>}
          </div>
        </div>
      )}
    </>
  );
}

// Chip da etapa/situação atual do candidato (usado no modo "Todos").
export function EtapaChip({ etapa }: { etapa?: string }) {
  const cor = etapa === "Reprovado" ? { bg: "#fee2e2", c: "#b91c1c" }
    : etapa === "Contratado" || etapa === "DOCUMENTAÇÃO" ? { bg: "#dcfce7", c: "#15803d" }
    : { bg: "#e0f2fe", c: "#0369a1" };
  return <span style={{ fontSize: 10, fontWeight: 800, padding: "2px 9px", borderRadius: 20, background: cor.bg, color: cor.c }}>{etapa || "—"}</span>;
}

