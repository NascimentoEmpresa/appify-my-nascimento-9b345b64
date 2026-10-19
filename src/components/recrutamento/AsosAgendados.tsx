// =====================================================================
// Gestão Recrutamento — card "ASOs Agendados" (19/10/2026).
//
// Pedido do Pablo: "Vai aparecer só as solicitações com os ASOs agendados e
// todos ASOs prontos pra copiar e colar ou pra enviar pros colaboradores.
// Desenvolve esse card novo pra ficar bem mais fácil do setor de recrutamento
// e seleção ver."
//
// Botão na linha dos filtros, com o número de exames de hoje em diante. Abre
// uma janela com as solicitações que têm ASO marcado pelo SST, cada candidato
// com data/hora/local/mapa, "Copiar" (o mesmo texto do StatusSstDialog),
// "Enviar no WhatsApp" (template recrutamento_agendamento_aso pela Edge
// recrutamento-mensagem, com a mesma confirmação do kanban) e "Copiar todos".
//
// Lê a VW_RECRUTAMENTO_CANDIDATOS (security_invoker: a RLS do WA_CURRICULOS e
// da SISTEMA_RECRUTAMENTO decide quem vê o quê, igual à lista da tela). Uma
// consulta só, dos últimos 30 dias para frente; a régua de quem entra está em
// src/lib/recrutamento/agendamentoAso.ts (asoEstaAgendado), com teste.
// Cache de módulo + revalidação silenciosa: o número aparece na hora ao
// voltar para a tela (memória "telas devem carregar instantâneo").
// =====================================================================
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { SupabaseClient } from "@supabase/supabase-js";
import { CalendarCheck, Check, Copy, Loader2, MapPin, MessageSquare, RefreshCw, Search, Stethoscope, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  agruparAsosPorSolicitacao, asoCasaBusca, asoEstaAgendado, dataBr, diaDaSemana, hojeSp, linkMapaAso,
  mensagemEnvioAgendamento, textoAgendamentoAso, textoTodosAsos, type AsoAgendadoLinha,
} from "@/lib/recrutamento/agendamentoAso";
import { copiar } from "@/components/recrutamento/StatusSstDialog";
import { ConfirmarEnvioAgendamento } from "@/components/recrutamento/ConfirmarEnvioAgendamento";
import { IconeWhatsApp } from "@/components/recrutamento/QuadrosSstCompras";

const sb = supabase as unknown as SupabaseClient;

const COLUNAS = [
  "candidato_id", "vaga_id", "nome", "telefone", "cpf", "cargo", "contrato", "cidade", "etapa_processo",
  "desistiu", "admitido_em", "sst_ok", "sst_obs", "sst_data_exame", "sst_hora_exame", "sst_local_exame",
  "sst_maps_url", "sst_agendado_em", "sst_agendado_por",
].join(",");

/** "2026-10-19" − n dias. */
function diasAntes(dia: string, n: number): string {
  const [a, m, d] = dia.split("-").map(Number);
  return new Date(Date.UTC(a, m - 1, d - n)).toISOString().slice(0, 10);
}

// Cache de módulo: sobrevive à troca de tela (não ao F5).
let cache: AsoAgendadoLinha[] | null = null;

const temTelefone = (c: AsoAgendadoLinha) => String(c.telefone ?? "").replace(/\D/g, "").length >= 10;

export function AsosAgendados({ podeEnviar, onToast }: {
  /** Enviar no WhatsApp é de quem conduz o processo (o "alterar" da tela). */
  podeEnviar: boolean;
  onToast: (msg: string, tipo?: "ok" | "err" | "info") => void;
}) {
  const navigate = useNavigate();
  const [linhas, setLinhas] = useState<AsoAgendadoLinha[] | null>(cache);
  const [carregando, setCarregando] = useState(false);
  const [aberto, setAberto] = useState(false);
  const [proximos, setProximos] = useState(true);
  const [busca, setBusca] = useState("");
  const [copiado, setCopiado] = useState<string>("");
  const [confirmar, setConfirmar] = useState<AsoAgendadoLinha | null>(null);
  const [enviando, setEnviando] = useState<number | null>(null);

  const carregar = useCallback(async () => {
    setCarregando(true);
    const { data, error } = await sb.from("VW_RECRUTAMENTO_CANDIDATOS").select(COLUNAS)
      .gte("sst_data_exame", diasAntes(hojeSp(), 30))
      .order("sst_data_exame", { ascending: true }).limit(1000);
    setCarregando(false);
    if (error) { onToast("Erro ao carregar os ASOs agendados: " + error.message, "err"); return; }
    cache = (data ?? []) as unknown as AsoAgendadoLinha[];
    setLinhas(cache);
  }, [onToast]);
  useEffect(() => { carregar(); }, [carregar]);
  // Reabrir a janela revalida em silêncio (o SST pode ter agendado agora).
  useEffect(() => { if (aberto) carregar(); }, [aberto, carregar]);

  useEffect(() => {
    if (!aberto) return;
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape" && !confirmar) setAberto(false); };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [aberto, confirmar]);

  const hoje = hojeSp();
  const qtdProximos = useMemo(() => (linhas ?? []).filter((c) => asoEstaAgendado(c, hoje)).length, [linhas, hoje]);
  const grupos = useMemo(() => agruparAsosPorSolicitacao(
    (linhas ?? []).filter((c) => asoEstaAgendado(c, hoje, proximos) && asoCasaBusca(c, busca)),
  ), [linhas, hoje, proximos, busca]);
  const qtdLista = grupos.reduce((n, g) => n + g.asos.length, 0);

  const marcarCopiado = (chave: string) => { setCopiado(chave); window.setTimeout(() => setCopiado((v) => (v === chave ? "" : v)), 1800); };
  const copiarUm = async (c: AsoAgendadoLinha) => {
    const t = textoAgendamentoAso(c);
    if (!t) return;
    if (await copiar(t)) marcarCopiado(`c${c.candidato_id}`); else onToast("Não consegui copiar — selecione o texto à mão.", "err");
  };
  const copiarTodos = async () => {
    const t = textoTodosAsos(grupos);
    if (!t) return;
    if (await copiar(t)) { marcarCopiado("todos"); onToast(`${qtdLista} agendamento${qtdLista === 1 ? "" : "s"} copiado${qtdLista === 1 ? "" : "s"}.`, "ok"); }
    else onToast("Não consegui copiar.", "err");
  };

  // Mesmo envio do kanban (Recrutamento.confirmarEnvioAgendamento).
  const enviar = async (c: AsoAgendadoLinha) => {
    setEnviando(c.candidato_id);
    try {
      const { data, error } = await supabase.functions.invoke("recrutamento-mensagem", { body: { candidato_id: c.candidato_id, etapa: "AGENDAMENTO ASO" } });
      const r = mensagemEnvioAgendamento(error ? { detalhe: error.message } : (data as { enviado?: boolean; motivo?: string; detalhe?: string }), c.nome);
      onToast(r.texto, r.ok ? "ok" : "err");
    } catch (e) {
      onToast(mensagemEnvioAgendamento({ detalhe: (e as Error).message }, c.nome).texto, "err");
    } finally { setEnviando(null); setConfirmar(null); }
  };

  const abrirConversa = async (c: AsoAgendadoLinha) => {
    const { data, error } = await sb.rpc("recrutamento_abrir_conversa", { p_candidato_id: c.candidato_id });
    if (error || !data) { onToast("Não consegui abrir a conversa: " + (error?.message ?? "conversa não encontrada"), "err"); return; }
    navigate(`/app/whatsapp?conversa=${data}`);
  };

  const botao = (ativo = false) => ({
    display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 11px", borderRadius: 8, fontSize: 12, fontWeight: 700,
    cursor: "pointer", fontFamily: "inherit", border: "1px solid #e2e8f0", background: ativo ? "#0f3171" : "#fff", color: ativo ? "#fff" : "#334155",
  } as const);

  return (
    <>
      <button type="button" onClick={() => setAberto(true)} title="Solicitações com ASO agendado pelo SST — textos prontos para copiar ou enviar"
        style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 10, padding: "7px 8px 7px 14px", borderRadius: 12, cursor: "pointer", fontFamily: "inherit",
                 border: "1px solid #bbf7d0", background: "linear-gradient(135deg,#f0fdf4,#dcfce7)", color: "#166534", boxShadow: "0 8px 24px rgba(22,101,52,.10)" }}>
        <Stethoscope size={16} strokeWidth={2.2} aria-hidden />
        <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", lineHeight: 1.1 }}>
          <span style={{ fontSize: 12.5, fontWeight: 800 }}>ASOs Agendados</span>
          <span style={{ fontSize: 10.5, fontWeight: 600, color: "#15803d" }}>prontos para copiar ou enviar</span>
        </span>
        <span style={{ minWidth: 30, textAlign: "center", fontSize: 15, fontWeight: 900, color: "#fff", background: "#16a34a", borderRadius: 9, padding: "3px 8px" }}>
          {linhas == null ? <Loader2 size={13} className="animate-spin" style={{ display: "inline" }} /> : qtdProximos}
        </span>
      </button>

      {aberto && (
        <div role="dialog" aria-modal="true" aria-label="ASOs agendados"
          onClick={(e) => { if (e.target === e.currentTarget) setAberto(false); }}
          style={{ position: "fixed", inset: 0, zIndex: 1100, background: "rgba(15,23,42,.5)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div style={{ background: "#f8fafc", borderRadius: 16, width: "100%", maxWidth: 880, maxHeight: "92vh", display: "flex", flexDirection: "column", boxShadow: "0 24px 60px rgba(15,23,42,.3)", overflow: "hidden" }}>
            <div style={{ height: 4, background: "#16a34a" }} />
            <div style={{ padding: "14px 20px 12px", background: "#fff", borderBottom: "1px solid #e2e8f0" }}>
              <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                <CalendarCheck size={22} color="#16a34a" style={{ marginTop: 2, flexShrink: 0 }} aria-hidden />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 17, fontWeight: 800, color: "#0f172a" }}>ASOs Agendados</div>
                  <div style={{ fontSize: 12.5, color: "#475569", marginTop: 2 }}>
                    Exames admissionais marcados pelo SST, por solicitação. Copie o texto ou envie direto no WhatsApp do candidato.
                  </div>
                </div>
                <button onClick={() => setAberto(false)} aria-label="Fechar" style={{ border: "none", background: "transparent", cursor: "pointer", color: "#64748b", padding: 4 }}><X size={18} /></button>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
                <button type="button" style={botao(proximos)} onClick={() => setProximos(true)}>De hoje em diante ({qtdProximos})</button>
                <button type="button" style={botao(!proximos)} onClick={() => setProximos(false)}>Incluir últimos 30 dias</button>
                <div style={{ position: "relative", flex: "1 1 200px", minWidth: 180 }}>
                  <Search size={14} color="#94a3b8" style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)" }} aria-hidden />
                  <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar candidato, contrato, cargo, nº da vaga…"
                    style={{ width: "100%", padding: "7px 10px 7px 30px", borderRadius: 8, border: "1px solid #e2e8f0", fontSize: 12.5, fontFamily: "inherit", outline: "none" }} />
                </div>
                <button type="button" onClick={() => carregar()} disabled={carregando} title="Atualizar" style={botao()}>
                  <RefreshCw size={13} className={carregando ? "animate-spin" : ""} aria-hidden />
                </button>
                <button type="button" onClick={copiarTodos} disabled={!qtdLista}
                  style={{ ...botao(), background: qtdLista ? "#0f3171" : "#e2e8f0", color: qtdLista ? "#fff" : "#94a3b8", border: "none", cursor: qtdLista ? "pointer" : "default" }}>
                  {copiado === "todos" ? <Check size={13} aria-hidden /> : <Copy size={13} aria-hidden />}
                  {copiado === "todos" ? "Copiado!" : `Copiar todos (${qtdLista})`}
                </button>
              </div>
            </div>

            <div style={{ overflowY: "auto", padding: "14px 20px 20px", display: "flex", flexDirection: "column", gap: 12 }}>
              {linhas == null ? (
                <div style={{ textAlign: "center", padding: 30, color: "#64748b", fontSize: 13 }}><Loader2 size={18} className="animate-spin" style={{ display: "inline" }} /> Carregando…</div>
              ) : grupos.length === 0 ? (
                <div style={{ textAlign: "center", padding: 30, color: "#64748b", fontSize: 13 }}>
                  {busca.trim() ? "Nenhum ASO agendado com essa busca." : proximos ? "Nenhum ASO agendado de hoje em diante." : "Nenhum ASO agendado nos últimos 30 dias."}
                </div>
              ) : grupos.map((g) => (
                <div key={g.vaga_id} style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, overflow: "hidden" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 14px", background: "#eef4ff", borderBottom: "1px solid #dbe4f0", flexWrap: "wrap" }}>
                    <span style={{ fontSize: 12, fontWeight: 800, color: "#0f3171" }}>#{g.vaga_id}</span>
                    <span style={{ fontSize: 13, fontWeight: 800, color: "#0f172a" }}>{g.cargo || "—"}</span>
                    <span style={{ fontSize: 12, color: "#475569" }}>{[g.contrato, g.cidade].filter(Boolean).join(" · ")}</span>
                    <span style={{ marginLeft: "auto", fontSize: 11, fontWeight: 800, color: "#166534", background: "#dcfce7", borderRadius: 20, padding: "2px 9px" }}>
                      {g.asos.length} ASO{g.asos.length === 1 ? "" : "s"}
                    </span>
                  </div>
                  {g.asos.map((c, i) => {
                    const passou = String(c.sst_data_exame).slice(0, 10) < hoje;
                    const ehHoje = String(c.sst_data_exame).slice(0, 10) === hoje;
                    const mapa = linkMapaAso(c);
                    const texto = textoAgendamentoAso(c) ?? "";
                    return (
                      <div key={c.candidato_id} style={{ padding: "11px 14px", borderTop: i ? "1px solid #f1f5f9" : "none", display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1.2fr)", gap: 12 }} className="aso-agendado-linha">
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: 13.5, fontWeight: 800, color: "#0f172a" }}>{c.nome || "Candidato"}</div>
                          <div style={{ fontSize: 11.5, color: "#64748b", marginTop: 1 }}>{[c.telefone, c.etapa_processo].filter(Boolean).join(" · ")}</div>
                          <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 7, flexWrap: "wrap" }}>
                            <span style={{ fontSize: 12.5, fontWeight: 800, color: passou ? "#64748b" : "#166534", background: passou ? "#f1f5f9" : "#f0fdf4", border: `1px solid ${passou ? "#e2e8f0" : "#bbf7d0"}`, borderRadius: 8, padding: "3px 9px" }}>
                              {dataBr(c.sst_data_exame)} ({diaDaSemana(c.sst_data_exame)}){c.sst_hora_exame ? ` · ${c.sst_hora_exame}` : ""}
                            </span>
                            {ehHoje && <span style={{ fontSize: 10.5, fontWeight: 800, color: "#fff", background: "#ea580c", borderRadius: 20, padding: "2px 8px" }}>HOJE</span>}
                            {passou && <span style={{ fontSize: 10.5, fontWeight: 800, color: "#64748b" }}>já passou</span>}
                          </div>
                          {c.sst_local_exame && (
                            <div style={{ fontSize: 12, color: "#334155", marginTop: 6, display: "flex", gap: 5 }}>
                              <MapPin size={13} style={{ flexShrink: 0, marginTop: 2 }} color="#64748b" aria-hidden />
                              <span>{c.sst_local_exame}{mapa && <> · <a href={mapa} target="_blank" rel="noopener noreferrer" style={{ color: "#0f3171", fontWeight: 700 }}>mapa</a></>}</span>
                            </div>
                          )}
                          {c.sst_agendado_por && <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 4 }}>Agendado por {c.sst_agendado_por}</div>}
                          <div style={{ display: "flex", gap: 6, marginTop: 9, flexWrap: "wrap" }}>
                            <button type="button" style={botao()} onClick={() => copiarUm(c)}>
                              {copiado === `c${c.candidato_id}` ? <Check size={13} color="#16a34a" aria-hidden /> : <Copy size={13} aria-hidden />}
                              {copiado === `c${c.candidato_id}` ? "Copiado!" : "Copiar"}
                            </button>
                            {podeEnviar && temTelefone(c) && (
                              <button type="button" disabled={enviando === c.candidato_id} onClick={() => setConfirmar(c)}
                                style={{ ...botao(), background: "#25d366", color: "#fff", border: "none" }}>
                                {enviando === c.candidato_id ? <Loader2 size={13} className="animate-spin" /> : <IconeWhatsApp tamanho={13} />}Enviar no WhatsApp
                              </button>
                            )}
                            {temTelefone(c) && (
                              <button type="button" style={botao()} onClick={() => abrirConversa(c)} title="Abrir a conversa do candidato na Caixa de Entrada">
                                <MessageSquare size={13} aria-hidden />Conversa
                              </button>
                            )}
                          </div>
                        </div>
                        <pre style={{ margin: 0, whiteSpace: "pre-wrap", overflowWrap: "anywhere", fontFamily: "inherit", fontSize: 11.5, color: "#0f172a", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 10, padding: "8px 10px", userSelect: "all" }}>
                          {texto}
                        </pre>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
          {/* Celular: texto embaixo dos dados, não ao lado. */}
          <style>{`@media (max-width: 640px) { .aso-agendado-linha { grid-template-columns: minmax(0,1fr) !important; } }`}</style>
        </div>
      )}

      {confirmar && (
        <ConfirmarEnvioAgendamento candidato={confirmar} cargo={confirmar.cargo} enviando={enviando === confirmar.candidato_id}
          onConfirmar={() => enviar(confirmar)} onCancelar={() => setConfirmar(null)} />
      )}
    </>
  );
}
