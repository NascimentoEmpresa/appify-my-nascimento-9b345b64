import { useCallback, useEffect, useState } from "react";
import { Building2, Gavel, Landmark, Loader2, Search, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { usePermissoes } from "@/context/PermissoesContext";

// =====================================================================
// JURÍDICO — Processos pelo CPF (24/09/2026).
//
// Duas camadas, na ordem em que custam:
//   1) Contra a empresa: JUR_PROCESSOS, na hora e de graça
//      (RPC jur_processos_por_cpf — casa pelo CPF vinculado ou pelo nome).
//   2) Em todos os tribunais: Edge Function consulta-processos-cpf
//      (Escavador, pago por consulta). A última consulta salva aparece
//      primeiro; consultar de novo pede motivo e fica registrado.
// Permissão: juridico_consulta_processos — visualizar vê, incluir paga.
// Vetar candidato por ter processado ex-empregador é discriminatório (TST);
// o aviso fica na própria tela.
// =====================================================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- tabelas/RPCs fora do types.ts gerado
const sb = supabase as any;
const MENU = "juridico_consulta_processos";

interface ProcessoEmpresa { id: number; numero: string | null; reclamante: string | null; reclamada: string | null; tipo: string | null; status: string | null; comarca: string | null; contrato: string | null; ano: number | null; data_entrada: string | null; encerramento: string | null; casou_por: "cpf" | "nome" }
interface ProcessoTribunal { numero: string | null; tribunal: string | null; grau?: string | null; classe: string | null; assunto: string | null; area?: string | null; polo_ativo: string | null; polo_passivo: string | null; papel: string | null; data_inicio: string | null; ultima_movimentacao: string | null; status: string | null; valor_causa?: string | null }
interface Consulta { id: number; created_at: string; consultado_por_nome: string | null; motivo: string; processos: ProcessoTribunal[]; total: number; mais_paginas: boolean; custo_centavos: number | null; erro: string | null }

const dig = (s?: string | null) => String(s ?? "").replace(/\D/g, "");
const fmtCpf = (d: string) => d.length === 11 ? `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}` : d;
const dataBr = (s?: string | null) => {
  if (!s) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  const d = new Date(s);
  return isNaN(+d) ? s : d.toLocaleDateString("pt-BR");
};
const dataHoraBr = (s?: string | null) => {
  if (!s) return "—";
  const d = new Date(s);
  return isNaN(+d) ? s : `${d.toLocaleDateString("pt-BR")} ${d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`;
};

const secao: React.CSSProperties = { border: "1px solid #e2e8f0", borderRadius: 12, padding: "12px 14px", background: "#fff" };
const titulo: React.CSSProperties = { display: "flex", alignItems: "center", gap: 7, fontSize: 13, fontWeight: 800, color: "#0f3171" };
const linha: React.CSSProperties = { border: "1px solid #eef2f7", background: "#f8fafc", borderRadius: 9, padding: "8px 10px", fontSize: 12, color: "#334155" };

export function ModalProcessosCpf({ cpf: cpfInicial, nome, onClose }: { cpf?: string | null; nome?: string | null; onClose: () => void }) {
  const { can } = usePermissoes();
  const podePagar = can("incluir", undefined, MENU);
  const [cpfDigitado, setCpfDigitado] = useState(fmtCpf(dig(cpfInicial)));
  const [cpf, setCpf] = useState(dig(cpfInicial));
  const [empresa, setEmpresa] = useState<ProcessoEmpresa[] | null>(null);
  const [erroEmpresa, setErroEmpresa] = useState("");
  const [consultas, setConsultas] = useState<Consulta[]>([]);
  const [motivo, setMotivo] = useState("");
  const [consultando, setConsultando] = useState(false);
  const [aviso, setAviso] = useState("");

  const carregar = useCallback(async (c: string) => {
    setEmpresa(null); setErroEmpresa(""); setConsultas([]); setAviso("");
    if (c.length !== 11) return;
    const [r1, r2] = await Promise.all([
      sb.rpc("jur_processos_por_cpf", { p_cpf: c, p_nome: nome ?? null }),
      sb.from("JUR_CONSULTA_CPF").select("*").eq("cpf_digits", c).order("created_at", { ascending: false }).limit(5),
    ]);
    if (r1.error) setErroEmpresa(r1.error.message); else setEmpresa((r1.data?.processos ?? []) as ProcessoEmpresa[]);
    setConsultas((r2.data ?? []) as Consulta[]);
  }, [nome]);
  useEffect(() => { carregar(cpf); }, [cpf, carregar]);

  const consultarTribunais = async () => {
    if (motivo.trim().length < 10) { setAviso("Escreva o motivo da consulta (mínimo 10 caracteres)."); return; }
    setConsultando(true); setAviso("");
    const { data, error } = await sb.functions.invoke("consulta-processos-cpf", { body: { cpf, nome, motivo: motivo.trim() } });
    setConsultando(false);
    if (data?.configurado === false) { setAviso("A consulta nos tribunais ainda não foi ativada: falta cadastrar a chave do fornecedor (ESCAVADOR_API_TOKEN) nos secrets do Supabase."); return; }
    if (error || data?.error) {
      let msg = data?.error ?? error?.message ?? "Falha na consulta.";
      try { const corpo = await error?.context?.json?.(); if (corpo?.error) msg = corpo.error; } catch { /* corpo já lido */ }
      setAviso(msg);
    }
    setMotivo("");
    carregar(cpf);
  };

  const ultima = consultas[0];

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 950, background: "rgba(15,23,42,.5)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "#f5f7fb", borderRadius: 16, width: 720, maxWidth: "96vw", maxHeight: "90vh", overflowY: "auto", padding: 18, position: "relative" }}>
        <button onClick={onClose} aria-label="Fechar" style={{ position: "absolute", top: 12, right: 12, border: "none", background: "none", cursor: "pointer", color: "#94a3b8" }}><X size={20} /></button>
        <div style={{ ...titulo, fontSize: 16 }}><Gavel size={18} /> Processos pelo CPF</div>
        <div style={{ fontSize: 12, color: "#64748b", margin: "2px 0 12px" }}>{nome ? <b style={{ color: "#0f172a" }}>{nome} · </b> : null}{cpf ? `CPF ${fmtCpf(cpf)}` : "Informe o CPF"}</div>

        {!cpfInicial && (
          <form onSubmit={(e) => { e.preventDefault(); setCpf(dig(cpfDigitado)); }} style={{ display: "flex", gap: 8, marginBottom: 12 }}>
            <input value={cpfDigitado} onChange={(e) => setCpfDigitado(e.target.value)} placeholder="000.000.000-00" autoFocus
              style={{ flex: 1, height: 36, border: "1px solid #e2e8f0", borderRadius: 10, padding: "0 12px", fontSize: 13 }} />
            <button type="submit" style={{ display: "inline-flex", alignItems: "center", gap: 6, height: 36, padding: "0 14px", borderRadius: 10, border: "none", background: "#0f3171", color: "#fff", fontWeight: 700, fontSize: 12.5, cursor: "pointer" }}><Search size={14} /> Buscar</button>
          </form>
        )}

        {cpf.length === 11 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {/* 1) Contra a empresa */}
            <div style={secao}>
              <div style={titulo}><Building2 size={15} /> Contra a Nascimento</div>
              <div style={{ fontSize: 11.5, color: "#94a3b8", margin: "2px 0 8px" }}>Processos cadastrados no Jurídico (Processos Jurídicos).</div>
              {erroEmpresa ? <div style={{ fontSize: 12, color: "#b91c1c" }}>{erroEmpresa}</div>
                : empresa === null ? <div style={{ fontSize: 12, color: "#94a3b8" }}>Carregando…</div>
                : empresa.length === 0 ? <div style={{ fontSize: 12.5, color: "#166534", fontWeight: 700 }}>Nenhum processo contra a empresa.</div>
                : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {empresa.map((p) => (
                      <div key={p.id} style={linha}>
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                          <b style={{ color: "#0f172a" }}>{p.numero ?? "sem número"}</b>
                          {p.status && <span style={{ fontSize: 10.5, fontWeight: 800, padding: "1px 8px", borderRadius: 20, background: "#eef2ff", color: "#3730a3" }}>{p.status}</span>}
                          {p.casou_por === "nome" && <span title="Achado só pelo nome — confira se é a mesma pessoa" style={{ fontSize: 10.5, fontWeight: 800, padding: "1px 8px", borderRadius: 20, background: "#fef3c7", color: "#92400e" }}>pelo nome (conferir)</span>}
                        </div>
                        <div style={{ marginTop: 3 }}>{[p.tipo, p.comarca, p.contrato].filter(Boolean).join(" · ")}</div>
                        <div style={{ marginTop: 2, color: "#64748b" }}>Reclamante: {p.reclamante ?? "—"} · Entrada: {dataBr(p.data_entrada)}{p.encerramento ? ` · Encerrado: ${dataBr(p.encerramento)}` : ""}</div>
                      </div>
                    ))}
                  </div>
                )}
            </div>

            {/* 2) Todos os tribunais */}
            <div style={secao}>
              <div style={titulo}><Landmark size={15} /> Em todos os tribunais</div>
              <div style={{ fontSize: 11.5, color: "#94a3b8", margin: "2px 0 8px" }}>Consulta paga (Escavador). Cada consulta fica registrada com quem fez e o motivo.</div>
              {ultima ? (
                <div style={{ marginBottom: 10 }}>
                  <div style={{ fontSize: 11.5, color: "#475569", marginBottom: 6 }}>
                    Última consulta: <b>{dataHoraBr(ultima.created_at)}</b> por {ultima.consultado_por_nome ?? "—"} · Motivo: {ultima.motivo}
                    {ultima.custo_centavos != null && ` · Custo: R$ ${(ultima.custo_centavos / 100).toFixed(2).replace(".", ",")}`}
                  </div>
                  {ultima.erro ? <div style={{ fontSize: 12, color: "#b91c1c" }}>{ultima.erro}</div>
                    : ultima.total === 0 ? <div style={{ fontSize: 12.5, color: "#166534", fontWeight: 700 }}>Nenhum processo encontrado nos tribunais.</div>
                    : (
                      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                        {ultima.processos.map((p, i) => (
                          <div key={p.numero ?? i} style={linha}>
                            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                              <b style={{ color: "#0f172a" }}>{p.numero ?? "—"}</b>
                              {p.tribunal && <span style={{ fontSize: 10.5, fontWeight: 800, padding: "1px 8px", borderRadius: 20, background: "#e0f2fe", color: "#075985" }}>{p.tribunal}{p.grau ? ` · ${p.grau}` : ""}</span>}
                              {p.papel && <span style={{ fontSize: 10.5, fontWeight: 800, padding: "1px 8px", borderRadius: 20, background: "#f1f5f9", color: "#334155" }}>{p.papel}</span>}
                              {p.status && <span style={{ fontSize: 10.5, color: "#64748b" }}>{p.status}</span>}
                            </div>
                            <div style={{ marginTop: 3 }}>{[p.area, p.classe, p.assunto].filter(Boolean).join(" · ") || "—"}</div>
                            <div style={{ marginTop: 2, color: "#64748b" }}>{p.polo_ativo ?? "—"} x {p.polo_passivo ?? "—"}</div>
                            <div style={{ marginTop: 2, color: "#94a3b8" }}>Início: {dataBr(p.data_inicio)} · Última movimentação: {dataBr(p.ultima_movimentacao)}{p.valor_causa ? ` · Valor da causa: ${p.valor_causa}` : ""}</div>
                          </div>
                        ))}
                        {ultima.mais_paginas && <div style={{ fontSize: 11.5, color: "#92400e" }}>Há mais de 100 processos; só os 100 primeiros foram trazidos.</div>}
                      </div>
                    )}
                </div>
              ) : <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 10 }}>Nenhuma consulta feita para este CPF.</div>}

              {podePagar ? (
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <input value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Motivo da consulta (ex.: vaga de vigilante — exigência do contrato)"
                    style={{ flex: 1, minWidth: 260, height: 34, border: "1px solid #e2e8f0", borderRadius: 9, padding: "0 10px", fontSize: 12.5 }} />
                  <button onClick={consultarTribunais} disabled={consultando}
                    style={{ display: "inline-flex", alignItems: "center", gap: 6, height: 34, padding: "0 14px", borderRadius: 9, border: "none", background: consultando ? "#94a3b8" : "#0f3171", color: "#fff", fontWeight: 700, fontSize: 12.5, cursor: consultando ? "default" : "pointer" }}>
                    {consultando ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />} {ultima ? "Consultar de novo" : "Consultar tribunais"}
                  </button>
                </div>
              ) : <div style={{ fontSize: 11.5, color: "#94a3b8" }}>Consultar nos tribunais exige a permissão "incluir" em Consulta de processos por CPF.</div>}
              {aviso && <div style={{ marginTop: 8, fontSize: 12, color: "#92400e", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 8, padding: "7px 10px" }}>{aviso}</div>}
            </div>

            <div style={{ fontSize: 11, color: "#64748b", lineHeight: 1.5 }}>
              Atenção: recusar candidato por ter movido ação trabalhista contra ex-empregador é considerado discriminatório pela Justiça do Trabalho.
              Antecedentes só justificam restrição em funções específicas — na dúvida, fale com o Jurídico.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** Botão pronto: abre o modal para um CPF. Some para quem não tem a permissão. */
export function BotaoProcessosCpf({ cpf, nome, rotulo = "Processos", estilo }: { cpf?: string | null; nome?: string | null; rotulo?: string; estilo?: React.CSSProperties }) {
  const { can } = usePermissoes();
  const [aberto, setAberto] = useState(false);
  if (!can("visualizar", undefined, MENU)) return null;
  return (
    <>
      <button type="button" onClick={() => setAberto(true)} title="Ver processos desta pessoa pelo CPF"
        style={estilo ?? { display: "inline-flex", alignItems: "center", gap: 5, padding: "5px 11px", borderRadius: 8, border: "1px solid #c7d2fe", background: "#eef2ff", color: "#3730a3", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
        <Gavel size={13} /> {rotulo}
      </button>
      {aberto && <ModalProcessosCpf cpf={cpf} nome={nome} onClose={() => setAberto(false)} />}
    </>
  );
}
