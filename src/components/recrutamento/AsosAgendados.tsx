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
import { CalendarCheck, Check, CheckCheck, ChevronDown, ChevronRight, Clock, Copy, Eye, Loader2, MapPin, MessageSquare, Phone, RefreshCw, Search, Stethoscope, Undo2, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import {
  agruparAsosPorSolicitacao, asoCasaBusca, asoEstaAgendado, chaveAgendamentoAso, dataBr, diaDaSemana, hojeSp, linkMapaAso,
  mensagemEnvioAgendamento, textoAgendamentoAso, textoTodosAsos, type AsoAgendadoLinha, type SolicitacaoComAsos,
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

// "Marcar como visto" (20/10/2026, mig 20261020000080): da EQUIPE — quem
// tratou o agendamento marca e as outras veem. A chave é candidato + o
// agendamento (data|hora|local): reagendou, volta a ser novo.
interface Visto { visto_por: string; visto_por_nome: string | null; visto_em: string }
const chaveVisto = (c: AsoAgendadoLinha) => `${c.candidato_id}#${chaveAgendamentoAso(c)}`;
let cacheVistos: Map<string, Visto> | null = null;
const horaBr = (iso: string) => new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });

const temTelefone = (c: AsoAgendadoLinha) => String(c.telefone ?? "").replace(/\D/g, "").length >= 10;

const MESES = ["JAN", "FEV", "MAR", "ABR", "MAI", "JUN", "JUL", "AGO", "SET", "OUT", "NOV", "DEZ"];

export function AsosAgendados({ podeEnviar, onToast, onAbrirVaga }: {
  /** Enviar no WhatsApp é de quem conduz o processo (o "alterar" da tela). */
  podeEnviar: boolean;
  onToast: (msg: string, tipo?: "ok" | "err" | "info") => void;
  /** Abre o detalhe da solicitação (a janela fecha antes). */
  onAbrirVaga?: (vagaId: number) => void;
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
  const { user } = useAuth();
  const [vistos, setVistos] = useState<Map<string, Visto>>(cacheVistos ?? new Map());
  // null = ainda não sabe; false = a tabela não respondeu (migration não
  // aplicada?) — some o recurso em vez de mostrar botão que não grava.
  const [vistosOk, setVistosOk] = useState<boolean | null>(cacheVistos ? true : null);
  const [soNovos, setSoNovos] = useState(false);
  const [marcando, setMarcando] = useState<string>("");
  const [meuNome, setMeuNome] = useState("");

  useEffect(() => {
    if (!user?.id) return;
    supabase.from("profiles").select("display_name, email").eq("id", user.id).maybeSingle()
      .then(({ data }) => setMeuNome(data?.display_name || data?.email || user.email || ""));
  }, [user?.id, user?.email]);

  const carregarVistos = useCallback(async () => {
    // Sem `.in(candidato_id)`: a lista de ids estoura a URL no gateway do
    // cluster (502). Os ASOs da janela são dos últimos 30 dias para frente,
    // então os "vistos" de 120 dias para trás cobrem com folga.
    const { data, error } = await sb.from("RECRUTAMENTO_ASO_VISTO")
      .select("candidato_id, agendamento, visto_por, visto_por_nome, visto_em")
      .gte("visto_em", diasAntes(hojeSp(), 120)).limit(5000);
    if (error) { setVistosOk(false); return; }
    const m = new Map<string, Visto>();
    for (const v of (data ?? []) as Array<Visto & { candidato_id: number; agendamento: string }>) m.set(`${v.candidato_id}#${v.agendamento}`, v);
    cacheVistos = m;
    setVistos(m);
    setVistosOk(true);
  }, []);

  const carregar = useCallback(async () => {
    setCarregando(true);
    carregarVistos();
    const { data, error } = await sb.from("VW_RECRUTAMENTO_CANDIDATOS").select(COLUNAS)
      .gte("sst_data_exame", diasAntes(hojeSp(), 30))
      .order("sst_data_exame", { ascending: true }).limit(1000);
    setCarregando(false);
    if (error) { onToast("Erro ao carregar os ASOs agendados: " + error.message, "err"); return; }
    cache = (data ?? []) as unknown as AsoAgendadoLinha[];
    setLinhas(cache);
  }, [onToast, carregarVistos]);

  const visto = (c: AsoAgendadoLinha) => vistos.get(chaveVisto(c)) ?? null;

  /** Marca um ou vários como vistos (otimista: a tela muda antes de o banco responder). */
  const marcarVistos = async (lista: AsoAgendadoLinha[], silencioso = false) => {
    const novos = lista.filter((c) => !visto(c));
    if (!novos.length || !user?.id) return;
    const agora = new Date().toISOString();
    const rotulo = novos.length === 1 ? chaveVisto(novos[0]) : "todos";
    setMarcando(rotulo);
    setVistos((m) => { const n = new Map(m); novos.forEach((c) => n.set(chaveVisto(c), { visto_por: user.id, visto_por_nome: meuNome || null, visto_em: agora })); return n; });
    const { error } = await sb.from("RECRUTAMENTO_ASO_VISTO").upsert(
      novos.map((c) => ({ candidato_id: c.candidato_id, agendamento: chaveAgendamentoAso(c), visto_por: user.id, visto_por_nome: meuNome || null })),
      { onConflict: "candidato_id,agendamento", ignoreDuplicates: true },
    );
    setMarcando("");
    if (error) { onToast("Não consegui marcar como visto: " + error.message, "err"); carregarVistos(); return; }
    if (!silencioso && novos.length > 1) onToast(`${novos.length} ASOs marcados como vistos.`, "ok");
    carregarVistos();
  };

  const desmarcarVisto = async (c: AsoAgendadoLinha) => {
    const k = chaveVisto(c);
    setVistos((m) => { const n = new Map(m); n.delete(k); return n; });
    const { error } = await sb.from("RECRUTAMENTO_ASO_VISTO").delete().eq("candidato_id", c.candidato_id).eq("agendamento", chaveAgendamentoAso(c));
    if (error) { onToast("Não consegui desmarcar: " + error.message, "err"); carregarVistos(); }
  };
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
  // "Incluir últimos 30 dias": os próximos continuam em cima; os que já
  // passaram vão para uma seção à parte, do mais recente para o mais antigo
  // (antes tudo saía do mais antigo, e o que importa ficava lá embaixo).
  // Novos = de hoje em diante e ninguém marcou como visto (o que passou não
  // pede mais aviso). É o número laranja do botão e o filtro "Não vistos".
  const qtdNovos = useMemo(
    () => (vistosOk ? (linhas ?? []).filter((c) => asoEstaAgendado(c, hoje) && !vistos.has(chaveVisto(c))).length : 0),
    [linhas, hoje, vistos, vistosOk],
  );
  const { futuros, passados } = useMemo(() => {
    const lista = (linhas ?? []).filter((c) => asoEstaAgendado(c, hoje, proximos) && asoCasaBusca(c, busca)
      && (!soNovos || !vistos.has(chaveVisto(c))));
    const ehPassado = (c: AsoAgendadoLinha) => String(c.sst_data_exame).slice(0, 10) < hoje;
    return {
      futuros: agruparAsosPorSolicitacao(lista.filter((c) => !ehPassado(c))),
      passados: agruparAsosPorSolicitacao(lista.filter(ehPassado)).reverse(),
    };
  }, [linhas, hoje, proximos, busca, soNovos, vistos]);
  const grupos = useMemo(() => [...futuros, ...passados], [futuros, passados]);
  const qtdLista = grupos.reduce((n, g) => n + g.asos.length, 0);
  const qtdHoje = futuros.reduce((n, g) => n + g.asos.filter((c) => String(c.sst_data_exame).slice(0, 10) === hoje).length, 0);
  const [mensagemAberta, setMensagemAberta] = useState<Set<number>>(new Set());
  const alternarMensagem = (id: number) => setMensagemAberta((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  // Clicar na vaga abre o detalhe dela (o mesmo verDetalhe da linha da tabela).
  const abrirVaga = (id: number) => { setAberto(false); onAbrirVaga?.(id); };

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
      // Avisou o candidato pelo WhatsApp = tratou o agendamento: marca sozinho.
      if (r.ok && vistosOk) marcarVistos([c], true);
    } catch (e) {
      onToast(mensagemEnvioAgendamento({ detalhe: (e as Error).message }, c.nome).texto, "err");
    } finally { setEnviando(null); setConfirmar(null); }
  };

  const abrirConversa = async (c: AsoAgendadoLinha) => {
    const { data, error } = await sb.rpc("recrutamento_abrir_conversa", { p_candidato_id: c.candidato_id });
    if (error || !data) { onToast("Não consegui abrir a conversa: " + (error?.message ?? "conversa não encontrada"), "err"); return; }
    navigate(`/app/whatsapp?conversa=${data}`);
  };

  /** Um card por solicitação: cabeçalho clicável (abre a vaga) + um bloco por candidato. */
  const cardVaga = (g: SolicitacaoComAsos) => (
    <div key={`${g.vaga_id}-${g.asos[0]?.sst_data_exame}`} className="aso-vaga">
      <button type="button" className="aso-vaga-topo" onClick={() => abrirVaga(g.vaga_id)} title={`Abrir a solicitação #${g.vaga_id}`}>
        <span style={{ fontSize: 12, fontWeight: 800, color: "#0f3171", background: "#eef2ff", borderRadius: 8, padding: "4px 8px", flexShrink: 0 }}>#{g.vaga_id}</span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: "block", fontSize: 14, fontWeight: 800, color: "#0f172a", lineHeight: 1.25 }}>{g.cargo || "—"}</span>
          <span style={{ display: "block", fontSize: 12, color: "#64748b", marginTop: 2, lineHeight: 1.35 }}>{[g.contrato, g.cidade].filter(Boolean).join(" · ") || "—"}</span>
        </span>
        <span style={{ fontSize: 11, fontWeight: 800, color: "#166534", background: "#dcfce7", borderRadius: 20, padding: "3px 9px", whiteSpace: "nowrap", flexShrink: 0 }}>
          {g.asos.length} ASO{g.asos.length === 1 ? "" : "s"}
        </span>
        <span className="aso-abrir"><span className="aso-abrir-txt">Abrir vaga</span><ChevronRight size={14} aria-hidden /></span>
      </button>

      {g.asos.map((c) => {
        const dia = String(c.sst_data_exame).slice(0, 10);
        const passou = dia < hoje;
        const ehHoje = dia === hoje;
        const mapa = linkMapaAso(c);
        const texto = textoAgendamentoAso(c) ?? "";
        const cor = ehHoje ? { fundo: "#fff7ed", borda: "#fed7aa", txt: "#c2410c" } : passou ? { fundo: "#f8fafc", borda: "#e2e8f0", txt: "#64748b" } : { fundo: "#f0fdf4", borda: "#bbf7d0", txt: "#166534" };
        const [, mes, d] = dia.split("-");
        const verMsg = mensagemAberta.has(c.candidato_id);
        const v = visto(c);
        // Novo = ainda vai acontecer e ninguém marcou. O que já passou não
        // ganha o destaque (não há mais o que avisar), mas pode ser marcado.
        const novo = vistosOk === true && !v && !passou;
        return (
          <div key={c.candidato_id} className="aso-cand" data-novo={novo} data-visto={!!v}>
            {/* Data do exame */}
            <div style={{ background: cor.fundo, border: `1px solid ${cor.borda}`, borderRadius: 12, padding: "7px 4px 8px", textAlign: "center", color: cor.txt }}>
              <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: ".05em" }}>{ehHoje ? "HOJE" : MESES[Number(mes) - 1] ?? ""}</div>
              <div style={{ fontSize: 24, fontWeight: 900, lineHeight: 1.05 }}>{d}</div>
              <div style={{ fontSize: 10.5, fontWeight: 700, textTransform: "capitalize" }}>{diaDaSemana(dia).replace("-feira", "")}</div>
              {c.sst_hora_exame && <div style={{ marginTop: 5, fontSize: 12, fontWeight: 800, background: "#fff", borderRadius: 6, padding: "1px 0", border: `1px solid ${cor.borda}` }}>{c.sst_hora_exame}</div>}
            </div>

            {/* Candidato e local */}
            <div style={{ minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <span style={{ fontSize: 14, fontWeight: 800, color: "#0f172a", overflowWrap: "anywhere" }}>{c.nome || "Candidato"}</span>
                {novo && <span className="aso-tag-novo">● NOVO</span>}
                {v && (
                  <span className="aso-tag-visto" title={`Marcado como visto em ${horaBr(v.visto_em)}`}>
                    <CheckCheck size={12} aria-hidden /> Visto{v.visto_por_nome ? ` por ${v.visto_por_nome.split(" ")[0]}` : ""} · {horaBr(v.visto_em)}
                  </span>
                )}
              </div>
              <div style={{ fontSize: 12, color: "#64748b", marginTop: 2, display: "flex", gap: 10, flexWrap: "wrap" }}>
                {c.telefone && <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><Phone size={12} aria-hidden />{c.telefone}</span>}
                {c.etapa_processo && <span>{c.etapa_processo}</span>}
                {passou && <span style={{ fontWeight: 700 }}>· exame já passou</span>}
              </div>
              <div style={{ fontSize: 12.5, color: "#334155", marginTop: 8, display: "flex", gap: 6, alignItems: "flex-start" }}>
                <Clock size={13} style={{ flexShrink: 0, marginTop: 2 }} color="#64748b" aria-hidden />
                <span>{dataBr(c.sst_data_exame)} ({diaDaSemana(c.sst_data_exame)}){c.sst_hora_exame ? ` às ${c.sst_hora_exame}` : " — horário não informado"}</span>
              </div>
              <div style={{ fontSize: 12.5, color: "#334155", marginTop: 4, display: "flex", gap: 6, alignItems: "flex-start" }}>
                <MapPin size={13} style={{ flexShrink: 0, marginTop: 2 }} color="#64748b" aria-hidden />
                <span style={{ minWidth: 0, overflowWrap: "anywhere" }}>
                  {c.sst_local_exame || <span style={{ color: "#94a3b8" }}>Local não informado</span>}
                  {mapa && <> · <a href={mapa} target="_blank" rel="noopener noreferrer" style={{ color: "#0f3171", fontWeight: 700 }}>ver no mapa</a></>}
                </span>
              </div>
              {c.sst_agendado_por && <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 6 }}>Agendado por {c.sst_agendado_por}</div>}
              {texto && (
                <button type="button" onClick={() => alternarMensagem(c.candidato_id)}
                  style={{ marginTop: 8, border: "none", background: "transparent", padding: 0, color: "#0f3171", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", display: "inline-flex", alignItems: "center", gap: 3 }}>
                  <ChevronDown size={14} style={{ transform: verMsg ? "rotate(180deg)" : "none", transition: "transform .15s" }} aria-hidden />
                  {verMsg ? "Esconder mensagem" : "Ver mensagem"}
                </button>
              )}
              {verMsg && (
                <pre style={{ margin: "8px 0 0", whiteSpace: "pre-wrap", overflowWrap: "anywhere", fontFamily: "inherit", fontSize: 12, lineHeight: 1.5, color: "#0f172a", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 10, padding: "10px 12px", userSelect: "all" }}>
                  {texto}
                </pre>
              )}
            </div>

            {/* Ações */}
            <div className="aso-acoes">
              {vistosOk && !v && (
                <button type="button" className="aso-btn aso-btn-visto" disabled={marcando === chaveVisto(c)} onClick={() => marcarVistos([c])}>
                  {marcando === chaveVisto(c) ? <Loader2 size={14} className="animate-spin" /> : <Eye size={14} aria-hidden />}Marcar como visto
                </button>
              )}
              <button type="button" className="aso-btn" onClick={() => copiarUm(c)}>
                {copiado === `c${c.candidato_id}` ? <Check size={14} color="#16a34a" aria-hidden /> : <Copy size={14} aria-hidden />}
                {copiado === `c${c.candidato_id}` ? "Copiado!" : "Copiar texto"}
              </button>
              {podeEnviar && temTelefone(c) && (
                <button type="button" className="aso-btn aso-btn-zap" disabled={enviando === c.candidato_id} onClick={() => setConfirmar(c)}>
                  {enviando === c.candidato_id ? <Loader2 size={14} className="animate-spin" /> : <IconeWhatsApp tamanho={14} />}Enviar no WhatsApp
                </button>
              )}
              {temTelefone(c) && (
                <button type="button" className="aso-btn" onClick={() => abrirConversa(c)} title="Abrir a conversa do candidato na Caixa de Entrada">
                  <MessageSquare size={14} aria-hidden />Conversa
                </button>
              )}
              {v && (
                <button type="button" className="aso-desfazer" onClick={() => desmarcarVisto(c)} title="Voltar a ficar como novo">
                  <Undo2 size={12} aria-hidden /> Desmarcar visto
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );

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
        {qtdNovos > 0 && (
          <span title={`${qtdNovos} ASO${qtdNovos === 1 ? "" : "s"} que ninguém marcou como visto`}
            style={{ fontSize: 11, fontWeight: 800, color: "#fff", background: "#ea580c", borderRadius: 20, padding: "3px 8px", whiteSpace: "nowrap" }}>
            {qtdNovos} novo{qtdNovos === 1 ? "" : "s"}
          </span>
        )}
      </button>

      {aberto && (
        // Layout (refeito em 19/10/2026 — "ficou BEEEM ruim"): a lista era um
        // flex-column com overflow:hidden em cada card, e o flex-shrink padrão
        // espremia os cards para caber na altura da janela — cortava nome,
        // data e botões, e com 24 itens viravam faixas de 15 px. Agora a lista
        // é um bloco comum que rola (min-height:0) e cada vaga tem altura
        // natural; cabeçalho e filtros ficam fixos em cima.
        <div role="dialog" aria-modal="true" aria-label="ASOs agendados" className="aso-ov"
          onClick={(e) => { if (e.target === e.currentTarget) setAberto(false); }}
          style={{ position: "fixed", inset: 0, zIndex: 1100, background: "rgba(15,23,42,.55)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div className="aso-painel" style={{ background: "#f1f5f9", borderRadius: 16, width: "100%", maxWidth: 940, height: "min(92vh, 960px)", display: "flex", flexDirection: "column", boxShadow: "0 24px 60px rgba(15,23,42,.3)", overflow: "hidden" }}>
            {/* Cabeçalho + filtros (fixos) */}
            <div style={{ flexShrink: 0, background: "#fff", borderBottom: "1px solid #e2e8f0" }}>
              <div style={{ height: 4, background: "linear-gradient(90deg,#16a34a,#22c55e)" }} />
              <div style={{ padding: "16px 20px 14px" }}>
                <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
                  <div style={{ width: 40, height: 40, borderRadius: 12, background: "#dcfce7", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    <CalendarCheck size={21} color="#16a34a" aria-hidden />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 18, fontWeight: 800, color: "#0f172a", lineHeight: 1.2 }}>ASOs Agendados</div>
                    <div style={{ fontSize: 12.5, color: "#64748b", marginTop: 3 }}>
                      Exames admissionais marcados pelo SST. Clique na vaga para abri-la; copie o texto ou envie no WhatsApp do candidato.
                    </div>
                  </div>
                  <button onClick={() => setAberto(false)} aria-label="Fechar" style={{ border: "none", background: "#f1f5f9", borderRadius: 8, cursor: "pointer", color: "#475569", padding: 6, display: "flex" }}><X size={18} /></button>
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginTop: 14 }}>
                  <div style={{ display: "inline-flex", padding: 3, borderRadius: 10, background: "#f1f5f9", border: "1px solid #e2e8f0" }}>
                    <button type="button" className="aso-seg" data-ativo={proximos} onClick={() => setProximos(true)}>De hoje em diante ({qtdProximos})</button>
                    <button type="button" className="aso-seg" data-ativo={!proximos} onClick={() => setProximos(false)}>+ últimos 30 dias</button>
                  </div>
                  {vistosOk && (
                    <button type="button" className="aso-chip-novos" data-ativo={soNovos} onClick={() => setSoNovos((v) => !v)}
                      title="Mostrar só os ASOs que ninguém marcou como visto">
                      <Eye size={13} aria-hidden /> Não vistos ({qtdNovos})
                    </button>
                  )}
                  <div style={{ position: "relative", flex: "1 1 220px", minWidth: 0 }}>
                    <Search size={14} color="#94a3b8" style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)" }} aria-hidden />
                    <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar candidato, contrato, cargo, nº da vaga…"
                      style={{ width: "100%", padding: "8px 10px 8px 30px", borderRadius: 9, border: "1px solid #e2e8f0", fontSize: 12.5, fontFamily: "inherit", outline: "none", background: "#fff" }} />
                  </div>
                  <button type="button" onClick={() => carregar()} disabled={carregando} title="Atualizar" aria-label="Atualizar" className="aso-btn">
                    <RefreshCw size={14} className={carregando ? "animate-spin" : ""} aria-hidden />
                  </button>
                  <button type="button" onClick={copiarTodos} disabled={!qtdLista} className="aso-btn aso-btn-azul">
                    {copiado === "todos" ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}
                    {copiado === "todos" ? "Copiado!" : `Copiar todos (${qtdLista})`}
                  </button>
                </div>

                {linhas != null && qtdLista > 0 && (
                  <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginTop: 10, fontSize: 12, color: "#475569" }}>
                    <span><b style={{ color: "#0f172a" }}>{qtdLista}</b> ASO{qtdLista === 1 ? "" : "s"}</span>
                    <span><b style={{ color: "#0f172a" }}>{new Set(grupos.map((g) => g.vaga_id)).size}</b> vaga{new Set(grupos.map((g) => g.vaga_id)).size === 1 ? "" : "s"}</span>
                    {qtdHoje > 0 && <span style={{ color: "#c2410c", fontWeight: 700 }}>● {qtdHoje} hoje</span>}
                    {qtdNovos > 0 && <span style={{ color: "#ea580c", fontWeight: 700 }}>{qtdNovos} não visto{qtdNovos === 1 ? "" : "s"}</span>}
                    {(() => {
                      // "Marcar todos como vistos" vale para o que está NA TELA
                      // (respeita busca e período), nunca para o que o filtro escondeu.
                      const naTela = grupos.flatMap((g) => g.asos).filter((c) => !visto(c) && String(c.sst_data_exame).slice(0, 10) >= hoje);
                      return vistosOk && naTela.length > 1 ? (
                        <button type="button" className="aso-link" disabled={marcando === "todos"} onClick={() => marcarVistos(naTela)}>
                          {marcando === "todos" ? <Loader2 size={12} className="animate-spin" /> : <CheckCheck size={13} aria-hidden />}
                          Marcar os {naTela.length} da lista como vistos
                        </button>
                      ) : null;
                    })()}
                  </div>
                )}
                {vistosOk === false && (
                  <div style={{ marginTop: 8, fontSize: 11.5, color: "#92400e" }}>
                    "Marcar como visto" indisponível no momento (o banco ainda não tem a tabela de vistos).
                  </div>
                )}
              </div>
            </div>

            {/* Lista (rola) */}
            <div style={{ flex: "1 1 auto", minHeight: 0, overflowY: "auto", padding: "16px 20px 24px" }}>
              {linhas == null ? (
                <div style={{ textAlign: "center", padding: 40, color: "#64748b", fontSize: 13 }}><Loader2 size={18} className="animate-spin" style={{ display: "inline" }} /> Carregando…</div>
              ) : grupos.length === 0 ? (
                <div style={{ textAlign: "center", padding: "48px 20px", color: "#64748b", fontSize: 13 }}>
                  <CalendarCheck size={30} color="#cbd5e1" style={{ margin: "0 auto 10px" }} aria-hidden />
                  {soNovos ? "Tudo visto — nenhum ASO novo esperando." : busca.trim() ? "Nenhum ASO agendado com essa busca." : proximos ? "Nenhum ASO agendado de hoje em diante." : "Nenhum ASO agendado nos últimos 30 dias."}
                </div>
              ) : (
                <>
                  {futuros.length > 0 && !proximos && <div className="aso-secao">Próximos</div>}
                  {futuros.map((g) => cardVaga(g))}
                  {passados.length > 0 && <div className="aso-secao" style={{ marginTop: futuros.length ? 22 : 0 }}>Já passaram</div>}
                  {passados.map((g) => cardVaga(g))}
                </>
              )}
            </div>
          </div>
          <style>{`
            .aso-seg { border: none; background: transparent; padding: 6px 12px; border-radius: 8px; font-size: 12px; font-weight: 700; color: #475569; cursor: pointer; font-family: inherit; white-space: nowrap; }
            .aso-seg[data-ativo="true"] { background: #0f3171; color: #fff; box-shadow: 0 1px 3px rgba(15,23,42,.2); }
            .aso-btn { display: inline-flex; align-items: center; justify-content: center; gap: 6px; padding: 7px 11px; border-radius: 9px; font-size: 12px; font-weight: 700; cursor: pointer; font-family: inherit; border: 1px solid #e2e8f0; background: #fff; color: #334155; white-space: nowrap; text-decoration: none; }
            .aso-btn:hover:not(:disabled) { background: #f8fafc; border-color: #cbd5e1; }
            .aso-btn:disabled { opacity: .55; cursor: default; }
            .aso-btn-azul { background: #0f3171; color: #fff; border-color: #0f3171; }
            .aso-btn-azul:hover:not(:disabled) { background: #0b255a; border-color: #0b255a; }
            .aso-btn-zap { background: #25d366; color: #fff; border-color: #25d366; }
            .aso-btn-zap:hover:not(:disabled) { background: #1ebe5a; border-color: #1ebe5a; }
            .aso-secao { font-size: 11px; font-weight: 800; letter-spacing: .06em; text-transform: uppercase; color: #64748b; margin: 0 2px 8px; }
            .aso-vaga { background: #fff; border: 1px solid #e2e8f0; border-radius: 14px; margin-bottom: 12px; overflow: hidden; box-shadow: 0 1px 2px rgba(15,23,42,.04); }
            .aso-vaga-topo { width: 100%; display: flex; align-items: center; gap: 12px; padding: 12px 16px; background: #fff; border: none; border-bottom: 1px solid #eef2f7; text-align: left; cursor: pointer; font-family: inherit; }
            .aso-vaga-topo:hover { background: #f5f8ff; }
            .aso-vaga-topo:hover .aso-abrir { color: #0f3171; border-color: #c7d2fe; background: #eef2ff; }
            .aso-abrir { display: inline-flex; align-items: center; gap: 4px; font-size: 11.5px; font-weight: 700; color: #64748b; border: 1px solid #e2e8f0; border-radius: 8px; padding: 4px 8px; white-space: nowrap; }
            .aso-cand { display: grid; grid-template-columns: 74px minmax(0,1fr) auto; gap: 14px; padding: 14px 16px; align-items: start; }
            .aso-cand + .aso-cand { border-top: 1px solid #f1f5f9; }
            .aso-cand[data-novo="true"] { background: #fff7ed; box-shadow: inset 4px 0 0 #ea580c; }
            .aso-cand[data-visto="true"] { background: #fbfcfd; }
            .aso-cand[data-visto="true"] > div:first-child { opacity: .6; }
            .aso-tag-novo { font-size: 10.5px; font-weight: 800; letter-spacing: .04em; color: #fff; background: #ea580c; border-radius: 20px; padding: 2px 8px; white-space: nowrap; }
            .aso-tag-visto { display: inline-flex; align-items: center; gap: 4px; font-size: 11px; font-weight: 700; color: #475569; background: #f1f5f9; border: 1px solid #e2e8f0; border-radius: 20px; padding: 2px 8px; white-space: nowrap; }
            .aso-btn-visto { background: #0f3171; color: #fff; border-color: #0f3171; }
            .aso-btn-visto:hover:not(:disabled) { background: #0b255a; border-color: #0b255a; }
            .aso-desfazer { display: inline-flex; align-items: center; justify-content: center; gap: 4px; border: none; background: transparent; color: #64748b; font-size: 11.5px; font-weight: 600; cursor: pointer; font-family: inherit; padding: 2px 0; }
            .aso-desfazer:hover { color: #0f3171; text-decoration: underline; }
            .aso-chip-novos { display: inline-flex; align-items: center; gap: 5px; padding: 7px 11px; border-radius: 9px; font-size: 12px; font-weight: 700; cursor: pointer; font-family: inherit; border: 1px solid #fed7aa; background: #fff7ed; color: #c2410c; white-space: nowrap; }
            .aso-chip-novos[data-ativo="true"] { background: #ea580c; border-color: #ea580c; color: #fff; }
            .aso-link { display: inline-flex; align-items: center; gap: 4px; border: none; background: transparent; padding: 0; color: #0f3171; font-size: 12px; font-weight: 700; cursor: pointer; font-family: inherit; }
            .aso-link:hover:not(:disabled) { text-decoration: underline; }
            .aso-acoes { display: flex; flex-direction: column; gap: 6px; align-items: stretch; min-width: 150px; }
            @media (max-width: 680px) {
              .aso-ov { padding: 0 !important; align-items: stretch !important; }
              .aso-painel { border-radius: 0 !important; height: 100% !important; max-width: none !important; }
              .aso-cand { grid-template-columns: 64px minmax(0,1fr); }
              .aso-acoes { grid-column: 1 / -1; flex-direction: row; flex-wrap: wrap; min-width: 0; }
              .aso-acoes > * { flex: 1 1 auto; }
              .aso-abrir-txt { display: none; }
            }
          `}</style>
        </div>
      )}

      {confirmar && (
        <ConfirmarEnvioAgendamento candidato={confirmar} cargo={confirmar.cargo} enviando={enviando === confirmar.candidato_id}
          onConfirmar={() => enviar(confirmar)} onCancelar={() => setConfirmar(null)} />
      )}
    </>
  );
}
