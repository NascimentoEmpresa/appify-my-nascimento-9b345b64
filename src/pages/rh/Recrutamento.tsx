import { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { usePermissoes } from "@/context/PermissoesContext";
import { ESTADOS_BR, municipiosDe } from "@/data/municipios-brasil";

// ── Tipos ──────────────────────────────────────────────────────────
interface Solicitacao {
  id: number;
  contrato: string;
  cargo: string;
  cidade: string;
  status: string;
  grau_urgencia: string;
  motivo_vaga: string;
  nome_substituido?: string;
  escala?: string;
  horario?: string;
  salario?: string;
  beneficios?: string;
  insalubridade_recebe?: string;
  insalubridade_quanto?: string;
  local_exato?: string;
  data_inicio_prevista?: string;
  quantidade_vagas?: number;
  req_obrigatorios?: string;
  req_desejaveis?: string;
  exp_minima?: string;
  exp_minima_qual?: string;
  alta_rotatividade?: string;
  motivos_saida?: string;
  recomendacao?: string;
  observacao_importante?: string;
  observacao_interna?: string;
  motivo_reprovacao?: string;
  funcionario_selecionado?: string;
  contratado_nome?: string;
  contratado_contato?: string;
  contratado_data_inicio?: string;
  link_publico?: string;
  analista_id?: number;
  analista_nome?: string;
  solicitante_nome?: string;
  solicitante_cpf?: string;
  aprovado_por_nome?: string;
  created_at: string;
  status_changed_at?: string;
}

interface Mensagem {
  id: number;
  mensagem: string;
  autor_nome: string;
  autor_cpf: string;
  is_treinamento?: boolean;
  created_at: string;
}

interface Curriculo {
  id: number;
  origem: string;
  telefone?: string;
  nome?: string;
  email?: string;
  cpf?: string;
  mensagem?: string;
  tem_pdf?: boolean;
  storage_path?: string;
  created_at: string;
  // Processo do candidato (kanban interno)
  etapa_processo?: string | null;
  juridico_obs?: string;
  sst_obs?: string;
  motivo_reprovacao?: string;
}

// ── Helpers ────────────────────────────────────────────────────────
function esc(s: any): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function fmtDt(s?: string) {
  if (!s) return "—";
  return s.replace("T", " ").slice(0, 10);
}

function badgeStatusCls(st: string) {
  if (st === "Pendente Operacional")  return "bg-yellow-100 text-yellow-800 border border-yellow-200";
  if (st === "Pendente Recrutamento") return "bg-purple-100 text-purple-700 border border-purple-200";
  if (st === "Reprovada")             return "bg-red-100 text-red-700 border border-red-200";
  if (st === "Contratado" || st?.startsWith("Concluído")) return "bg-green-100 text-green-700 border border-green-200";
  return "bg-blue-100 text-blue-700 border border-blue-200"; // demais (processo 3–10)
}

// Etapas do candidato dentro da solicitação (kanban interno).
function badgeEtapaCls(e?: string) {
  const m: Record<string, string> = {
    Selecionado:         "bg-blue-100 text-blue-700 border border-blue-200",
    "Pendente Jurídico": "bg-purple-100 text-purple-700 border border-purple-200",
    ASO:                 "bg-yellow-100 text-yellow-800 border border-yellow-200",
    "Admissão":          "bg-green-100 text-green-700 border border-green-200",
    Reprovado:           "bg-red-100 text-red-700 border border-red-200",
  };
  return e ? (m[e] ?? "bg-slate-100 text-slate-600 border border-slate-200") : "";
}

function badgeUrgCls(u?: string) {
  if (!u) return "";
  if (u.startsWith("Alta")) return "bg-red-100 text-red-700 border border-red-200";
  if (u === "Média") return "bg-yellow-100 text-yellow-700 border border-yellow-200";
  return "bg-green-100 text-green-700 border border-green-200";
}

// Board externo (por solicitação) — fluxo curto.
const KB_STATUS_ORDER = [
  "Pendente Operacional",
  "Pendente Recrutamento",
  "Seleção de Candidato",
  "Concluída",
  "Reprovada",
];

const KB_COL_COLORS: Record<string, { dot: string; label: string; accent: string }> = {
  "Pendente Operacional":  { dot: "#f59e0b", label: "#b45309", accent: "#f59e0b" },
  "Pendente Recrutamento": { dot: "#8b5cf6", label: "#7c3aed", accent: "#8b5cf6" },
  "Seleção de Candidato":  { dot: "#3b82f6", label: "#2563eb", accent: "#3b82f6" },
  "Concluída":             { dot: "#16a34a", label: "#15803d", accent: "#16a34a" },
  Reprovada:               { dot: "#dc2626", label: "#b91c1c", accent: "#dc2626" },
};

// Kanban interno (Status do Candidato) — 9 colunas + Reprovado.
const CAND_ETAPAS = [
  "ENTRADA", "TRIAGEM", "JURÍDICO", "ENTREVISTA", "ENTREVISTA GESTOR",
  "APROVADOS", "EXAME SST", "COMPRAS", "DOCUMENTAÇÃO", "Reprovado",
];
const CAND_COL_COLORS: Record<string, { dot: string; label: string; accent: string }> = {
  ENTRADA:            { dot: "#64748b", label: "#475569", accent: "#64748b" },
  TRIAGEM:            { dot: "#3b82f6", label: "#2563eb", accent: "#3b82f6" },
  "JURÍDICO":         { dot: "#8b5cf6", label: "#7c3aed", accent: "#8b5cf6" },
  ENTREVISTA:         { dot: "#0ea5e9", label: "#0369a1", accent: "#0ea5e9" },
  "ENTREVISTA GESTOR":{ dot: "#6366f1", label: "#4f46e5", accent: "#6366f1" },
  APROVADOS:          { dot: "#14b8a6", label: "#0f766e", accent: "#14b8a6" },
  "EXAME SST":        { dot: "#f59e0b", label: "#b45309", accent: "#f59e0b" },
  COMPRAS:            { dot: "#f97316", label: "#ea580c", accent: "#f97316" },
  "DOCUMENTAÇÃO":     { dot: "#16a34a", label: "#15803d", accent: "#16a34a" },
  Reprovado:          { dot: "#dc2626", label: "#b91c1c", accent: "#dc2626" },
};
// Papel responsável por completar cada etapa.
const PAPEL_ETAPA: Record<string, string> = {
  ENTRADA: "Recrutamento", TRIAGEM: "Recrutamento", "JURÍDICO": "Jurídico",
  ENTREVISTA: "Recrutamento", "ENTREVISTA GESTOR": "Recrutamento", APROVADOS: "Recrutamento",
  "EXAME SST": "SST", COMPRAS: "Suprimentos", "DOCUMENTAÇÃO": "Recrutamento",
};
// Status da Solicitação dirigidos pelo candidato (etapas 3–10).
const STATUS_PROCESSO = [
  "Vaga aberta - Seleção de Currículos", "Em análise jurídica", "Entrevista e Avaliação",
  "Entrevista com Gestor", "Aprovado - Aguardando SST", "Encaminhado para SST (ASO)",
  "ASO Aprovado - Aguardando Informe de EPIs", "Aguardando Confirmação Compras",
  "Compras Confirmou - Aguardando Documentação",
];

// ── Componente Principal ───────────────────────────────────────────
export default function Recrutamento() {
  const { user } = useAuth();
  const { roles, can } = usePermissoes();

  const isTreinamento = roles.includes("treinamentos"); // só rótulo da mensagem no chat, não é gate

  // Recrutamento = quem tem alterar em recrutamento_gestao (conduz o processo).
  const podeRecrutar = can("alterar", undefined, "recrutamento_gestao");
  // Visibilidade ampla (dashboard "Todas as Solicitações") sem rodar o processo.
  const podeVerTudo = can("visualizar", undefined, "recrutamento_gestao");
  const isRH = podeVerTudo && !podeRecrutar;
  // Operacional aprova a etapa 1 (Pendente Operacional → Pendente Recrutamento).
  const podeAprovarOperacional = can("aprovar", undefined, "recrutamento_gestao");
  // Quem pode mover o candidato pra fora de cada etapa específica do kanban.
  const podeMoverJuridico = can("aprovar", undefined, "recrutamento_etapa_juridico");
  const podeMoverSst      = can("aprovar", undefined, "recrutamento_etapa_sst");
  const podeMoverCompras  = can("aprovar", undefined, "recrutamento_etapa_compras");

  // ── Estado ─────────────────────────────────────────────────────
  const [view, setView]               = useState<"tabela" | "kanban">("tabela");
  const [tab, setTab]                 = useState("minha");
  const [page, setPage]               = useState(1);
  const [pages, setPages]             = useState(1);
  const [total, setTotal]             = useState(0);
  const [items, setItems]             = useState<Solicitacao[]>([]);
  const [loading, setLoading]         = useState(false);
  const [statusFilter, setStatusFilter] = useState("");
  const [contratoFiltro, setContratoFiltro]         = useState<string[]>([]);
  const [contratoCounts, setContratoCounts]         = useState<{ contrato: string; n: number }[]>([]);
  const [showContratoFiltro, setShowContratoFiltro] = useState(false);
  const [search, setSearch]           = useState("");
  const [stats, setStats]             = useState({ total: 0, pendentes: 0, ag_treinamentos: 0, em_processo: 0, contratados: 0, reprovadas: 0 });
  const [kanbanData, setKanbanData]   = useState<Record<string, Solicitacao[]>>({});

  // Drawer
  const [drawerId, setDrawerId]       = useState<number | null>(null);
  const [drawerSol, setDrawerSol]     = useState<Solicitacao | null>(null);
  const [msgs, setMsgs]               = useState<Mensagem[]>([]);
  const [chatInput, setChatInput]     = useState("");
  const [sendingMsg, setSendingMsg]   = useState(false);

  // Modais
  const [modalReprovar, setModalReprovar]   = useState(false);
  const [reprovarMotivo, setReprovarMotivo] = useState("");
  const [modalStatus, setModalStatus]       = useState(false);
  const [statusSel, setStatusSel]           = useState("");
  const [statusExtra, setStatusExtra]       = useState<Record<string, string>>({});
  const [modalLink, setModalLink]           = useState(false);
  const [linkCopiado, setLinkCopiado]       = useState(false);
  const [modalVaga, setModalVaga]           = useState(false);
  const [vagaStep, setVagaStep]             = useState(1);
  const [curriculos, setCurriculos]         = useState<Curriculo[]>([]);
  const [showCurriculos, setShowCurriculos] = useState(false);
  const [empCpf, setEmpCpf]                 = useState<Record<string, any[]>>({});   // CPF dígitos → cadastros EMPREGADOS
  const [blacklist, setBlacklist]           = useState<Record<string, { motivo: string; criado_em?: string }>>({});
  const [blockModal, setBlockModal]         = useState<{ digits: string; fmt: string } | null>(null);
  const [blockMotivo, setBlockMotivo]       = useState("");
  const [detalheEmp, setDetalheEmp]         = useState<{ nome: string; cpf: string; telefone?: string; email?: string; itens: Curriculo[]; emps: any[] } | null>(null);

  // Kanban drag
  const [dragId, setDragId]                 = useState<number | null>(null);
  const [dragStatus, setDragStatus]         = useState<string | null>(null);
  const [dragOver, setDragOver]             = useState<string | null>(null);
  const [modalMoverKb, setModalMoverKb]     = useState(false);
  const [pendMover, setPendMover]           = useState<{ id: number; novoStatus: string; oldSt: string } | null>(null);
  const [moverExtra, setMoverExtra]         = useState<Record<string, string>>({});

  // Kanban interno de candidatos (solicitação em "Seleção de Candidato")
  const [candidatos, setCandidatos]         = useState<Curriculo[]>([]);
  const [buscaCand, setBuscaCand]           = useState(""); // busca no kanban de candidatos
  const [candModal, setCandModal]           = useState<{ id: number; novaEtapa: string; nome: string } | null>(null);
  const [candObs, setCandObs]               = useState("");
  const [showKanbanCand, setShowKanbanCand] = useState(false);   // painel dedicado do kanban
  const [showHistorico, setShowHistorico]   = useState(false);   // painel de histórico
  const [historico, setHistorico]           = useState<any[]>([]);
  const [nomesPorEmailHist, setNomesPorEmailHist] = useState<Record<string, string>>({}); // nome real (EMPREGADOS) por e-mail, p/ histórico
  // Roteiro de entrevista (ENTREVISTA / ENTREVISTA GESTOR)
  const [roteiroModal, setRoteiroModal]     = useState<{ id: number; nome: string; etapa: string } | null>(null);
  const [roteiroRows, setRoteiroRows]       = useState<{ pergunta: string; resposta: string }[]>([]);

  // Wizard nova vaga
  const [vaga, setVaga] = useState({
    motivo_vaga: "", nome_substituido: "", contrato: "", cargo: "",
    estado: "", cidade: "", quantidade_vagas: "1", data_inicio_prevista: "",
    escala: "", horario: "", salario: "", insalubridade_recebe: "Não",
    insalubridade_quanto: "", beneficios: "", local_exato: "",
    grau_urgencia: "", alta_rotatividade: "Não", req_obrigatorios: "",
    req_desejaveis: "", exp_minima: "Não", exp_minima_qual: "",
    motivos_saida: "", recomendacao: "", observacao_importante: "",
  });
  const [contratos, setContratos] = useState<string[]>([]);
  const [contratosFull, setContratosFull] = useState<any[]>([]);
  const [empregados, setEmpregados] = useState<any[]>([]);
  const [empSearch, setEmpSearch] = useState("");
  const [showEmpDrop, setShowEmpDrop] = useState(false);
  const [loadingEmps, setLoadingEmps] = useState(false);

  // Toast
  const [toasts, setToasts] = useState<{ id: number; msg: string; type: string }[]>([]);
  const toastId = useRef(0);

  const chatEndRef = useRef<HTMLDivElement>(null);
  const kbBoardRef = useRef<HTMLDivElement>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollTimer   = useRef<ReturnType<typeof setInterval> | null>(null);
  const empDebounce = useRef<ReturnType<typeof setTimeout> | null>(null); // debounce busca colaborador
  const empTermo    = useRef("");  // último termo buscado (descarta respostas obsoletas)

  // ── Toast helper ─────────────────────────────────────────────
  const toast = useCallback((msg: string, type = "info") => {
    const id = ++toastId.current;
    setToasts(t => [...t, { id, msg, type }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 3500);
  }, []);

  // ── Tabs por perfil ───────────────────────────────────────────
  const tabs = isRH
    ? [{ label: "Todas as Solicitações", tab: "todas" }]
    : podeRecrutar
    ? [
        { label: "Todas", tab: "todas" },
        { label: "Pendente Operacional", tab: "analista" },
        { label: "Minhas Solicitações", tab: "minha" },
      ]
    : [{ label: "Minhas Solicitações", tab: "minha" }];

  useEffect(() => { setTab(tabs[0].tab); }, [isRH, podeRecrutar]);

  // ── Carregar Stats ────────────────────────────────────────────
  const loadStats = useCallback(async () => {
    const { data, error } = await (supabase as any)
      .from("SISTEMA_RECRUTAMENTO")
      .select("status");
    if (error || !data) return;
    const rows: { status: string }[] = data;
    setStats({
      total:            rows.length,
      pendentes:        rows.filter(r => r.status === "Pendente Operacional").length,
      ag_treinamentos:  rows.filter(r => r.status === "Pendente Recrutamento").length,
      em_processo:      rows.filter(r => STATUS_PROCESSO.includes(r.status)).length,
      contratados:      rows.filter(r => r.status === "Contratado" || String(r.status ?? "").startsWith("Concluído")).length,
      reprovadas:       rows.filter(r => r.status === "Reprovada").length,
    });
  }, []);

  // ── Filtros compartilhados ────────────────────────────────────
  // Tabela e Kanban são a MESMA consulta, só muda a apresentação — então os
  // dois aplicam exatamente os mesmos filtros (aba/status/busca).
  const aplicarFiltros = useCallback((q: any) => {
    if (statusFilter === "em_processo") {
      q = q.in("status", STATUS_PROCESSO);
    } else if (statusFilter === "concluido") {
      q = q.like("status", "Concluído%");
    } else if (statusFilter) {
      q = q.eq("status", statusFilter);
    }
    if (tab === "minha" && user?.email) {
      q = q.eq("solicitante_cpf", user.email);
    } else if (tab === "analista") {
      q = q.eq("status", "Pendente Operacional");
    }
    if (search) {
      q = q.or(`cargo.ilike.%${search}%,contrato.ilike.%${search}%,cidade.ilike.%${search}%`);
    }
    return q;
  }, [statusFilter, tab, search, user]);

  // ── Carregar Lista ────────────────────────────────────────────
  const listaReq = useRef(0);
  const loadLista = useCallback(async () => {
    const myReq = ++listaReq.current;   // descarta respostas antigas (race ao trocar de aba/filtro)
    setLoading(true);
    const PER = 20;
    let q = (supabase as any)
      .from("SISTEMA_RECRUTAMENTO")
      .select("*", { count: "exact" });
    q = aplicarFiltros(q);
    if (contratoFiltro.length) q = q.in("contrato", contratoFiltro);

    const from = (page - 1) * PER;
    const to   = from + PER - 1;
    q = q.order("created_at", { ascending: false }).range(from, to);

    const { data, count, error } = await q;
    if (myReq !== listaReq.current) return;   // já saiu uma consulta mais nova: ignora esta
    setLoading(false);
    if (error) { toast("Erro ao carregar lista: " + error.message, "err"); return; }
    setItems(data ?? []);
    const ct = count ?? 0;
    setTotal(ct);
    setPages(Math.max(1, Math.ceil(ct / PER)));
  }, [aplicarFiltros, contratoFiltro, page, toast]);

  // ── Carregar Kanban ───────────────────────────────────────────
  const kanbanReq = useRef(0);
  const loadKanban = useCallback(async () => {
    const myReq = ++kanbanReq.current;
    // Mesma consulta da tabela (mesmos filtros), só agrupada por status.
    // Tenta trazer status_changed_at (tempo na etapa atual); se a coluna ainda
    // não existir no ambiente, refaz a consulta sem ela.
    const kbQuery = (cols: string) => {
      let q = (supabase as any).from("SISTEMA_RECRUTAMENTO").select(cols);
      q = aplicarFiltros(q);
      if (contratoFiltro.length) q = q.in("contrato", contratoFiltro);
      return q.order("created_at", { ascending: false });
    };
    let { data, error } = await kbQuery("id,cargo,contrato,cidade,status,grau_urgencia,quantidade_vagas,analista_nome,solicitante_nome,created_at,status_changed_at");
    if (error) ({ data, error } = await kbQuery("id,cargo,contrato,cidade,status,grau_urgencia,quantidade_vagas,analista_nome,solicitante_nome,created_at"));
    if (myReq !== kanbanReq.current) return;
    if (error || !data) return;
    const grouped: Record<string, Solicitacao[]> = {};
    for (const row of data) {
      if (!grouped[row.status]) grouped[row.status] = [];
      grouped[row.status].push(row);
    }
    setKanbanData(grouped);
  }, [aplicarFiltros, contratoFiltro]);

  // Contagem de solicitações por contrato (respeita aba/status/busca; ignora o próprio filtro de contrato).
  const loadContratoCounts = useCallback(async () => {
    let q = (supabase as any).from("SISTEMA_RECRUTAMENTO").select("contrato");
    q = aplicarFiltros(q);
    const { data, error } = await q;
    if (error || !data) return;
    const map = new Map<string, number>();
    for (const r of data) {
      const c = String(r.contrato ?? "").trim();
      if (c) map.set(c, (map.get(c) ?? 0) + 1);
    }
    setContratoCounts(Array.from(map, ([contrato, n]) => ({ contrato, n })).sort((a, b) => a.contrato.localeCompare(b.contrato)));
  }, [aplicarFiltros]);

  useEffect(() => { loadStats(); }, [loadStats]);
  useEffect(() => { loadContratoCounts(); }, [loadContratoCounts]);
  useEffect(() => { if (view === "tabela") loadLista(); else loadKanban(); }, [view, loadLista, loadKanban, tab, page, statusFilter, search]);

  const debounceSearch = (v: string) => {
    setSearch(v);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => { setPage(1); }, 350);
  };

  // ── Candidatos no processo (kanban interno) ───────────────────
  const mapCurriculo = (c: any): Curriculo => ({
    ...c,
    nome: String(c.nome ?? c.nome_cand ?? c.nome_candidato ?? "").trim().toUpperCase(),
    email: c.email ?? c.email_cand ?? "",
    cpf: c.cpf ?? c.cpf_cand ?? "",
    storage_path: c.storage_path ?? c.arquivo_path ?? c.path ?? "",
    tem_pdf: !!(c.storage_path ?? c.arquivo_path ?? c.path ?? c.arquivo_url),
  });

  const loadCandidatos = useCallback(async (vagaId: number) => {
    const { data } = await (supabase as any)
      .from("WA_CURRICULOS")
      .select("*")
      .eq("vaga_id", vagaId)
      .not("etapa_processo", "is", null)
      .order("etapa_changed_at", { ascending: false });
    setCandidatos((data ?? []).map(mapCurriculo));
  }, []);

  // ── Histórico de movimentações ────────────────────────────────
  const logHistorico = useCallback(async (
    solicitacaoId: number,
    evento: string,
    opts: { de?: string; para?: string; papel?: string; detalhe?: string; candidatoId?: number; candidatoNome?: string } = {},
  ) => {
    try {
      await (supabase as any).from("RECRUTAMENTO_HISTORICO").insert({
        solicitacao_id: solicitacaoId,
        candidato_id: opts.candidatoId ?? null,
        candidato_nome: opts.candidatoNome ?? null,
        evento,
        de_status: opts.de ?? null,
        para_status: opts.para ?? null,
        papel: opts.papel ?? null,
        usuario_nome: user?.user_metadata?.nome ?? user?.email ?? "",
        usuario_email: user?.email ?? "",
        detalhe: opts.detalhe ?? null,
      });
    } catch { /* o log nunca bloqueia a ação principal */ }
  }, [user]);

  const loadHistorico = useCallback(async (solicitacaoId: number) => {
    const { data } = await (supabase as any)
      .from("RECRUTAMENTO_HISTORICO")
      .select("*")
      .eq("solicitacao_id", solicitacaoId)
      .order("created_at", { ascending: true });
    const eventos = data ?? [];
    // usuario_nome pode ter ficado só com o e-mail (usuário sem nome no metadata)
    // — busca o nome completo real em EMPREGADOS pra exibir no lugar.
    const emails = Array.from(new Set(eventos.map((r: any) => r.usuario_email).filter(Boolean)));
    let mapa: Record<string, string> = {};
    if (emails.length) {
      const { data: emps } = await (supabase as any).from("EMPREGADOS").select('"Nome","email"').in("email", emails);
      (emps ?? []).forEach((e: any) => { if (e.email && e["Nome"]) mapa[e.email] = e["Nome"]; });
    }
    setNomesPorEmailHist(mapa);
    setHistorico(eventos);
  }, []);

  // ── Abrir Detalhe ─────────────────────────────────────────────
  const verDetalhe = useCallback(async (id: number) => {
    setDrawerId(id);
    setDrawerSol(null);
    setMsgs([]);
    setCandidatos([]);
    if (pollTimer.current) clearInterval(pollTimer.current);

    const [{ data: sol }, { data: mensagens }] = await Promise.all([
      (supabase as any).from("SISTEMA_RECRUTAMENTO").select("*").eq("id", id).single(),
      (supabase as any).from("WA_MENSAGENS_RECRUTAMENTO").select("*").eq("solicitacao_id", id).order("created_at"),
    ]);
    if (sol) setDrawerSol(sol);
    if (sol && (STATUS_PROCESSO.includes(sol.status) || sol.status === "Contratado" || String(sol.status ?? "").startsWith("Concluído"))) loadCandidatos(id);
    if (mensagens) setMsgs(mensagens);

    pollTimer.current = setInterval(async () => {
      const { data: nm } = await (supabase as any)
        .from("WA_MENSAGENS_RECRUTAMENTO").select("*").eq("solicitacao_id", id).order("created_at");
      if (nm) setMsgs(nm);
    }, 5000);
  }, [loadCandidatos]);

  const fecharDrawer = () => {
    setDrawerId(null);
    setDrawerSol(null);
    setShowKanbanCand(false);
    setShowHistorico(false);
    setHistorico([]);
    if (pollTimer.current) clearInterval(pollTimer.current);
    if (view === "kanban") loadKanban();
  };

  useEffect(() => {
    if (chatEndRef.current) chatEndRef.current.scrollIntoView({ behavior: "smooth" });
  }, [msgs]);

  // ── Enviar Mensagem ───────────────────────────────────────────
  const enviarMsg = async () => {
    if (!chatInput.trim() || !drawerId || isRH) return;
    setSendingMsg(true);
    const { error } = await (supabase as any).from("WA_MENSAGENS_RECRUTAMENTO").insert({
      solicitacao_id: drawerId,
      mensagem: chatInput.trim(),
      autor_nome: user?.user_metadata?.nome ?? user?.email ?? "Usuário",
      autor_cpf: user?.email ?? "",
      is_treinamento: isTreinamento,
    });
    setSendingMsg(false);
    if (error) { toast("Erro ao enviar mensagem.", "err"); return; }
    setChatInput("");
    const { data } = await (supabase as any)
      .from("WA_MENSAGENS_RECRUTAMENTO").select("*").eq("solicitacao_id", drawerId).order("created_at");
    if (data) setMsgs(data);
  };

  // ── Aprovar ───────────────────────────────────────────────────
  const aprovar = async () => {
    if (!drawerId || !drawerSol) return;
    const ehAbertura = drawerSol.status === "Pendente Recrutamento";
    const label = ehAbertura ? "Confirmar abertura da vaga" : "Aprovar";
    if (!confirm(`${label} (#${drawerId})?`)) return;

    const novoStatus = ehAbertura ? "Vaga aberta - Seleção de Currículos" : "Pendente Recrutamento";

    const { error } = await (supabase as any)
      .from("SISTEMA_RECRUTAMENTO")
      .update({ status: novoStatus, aprovado_por_nome: user?.user_metadata?.nome ?? user?.email ?? "" })
      .eq("id", drawerId);

    if (error) { toast("Erro ao aprovar.", "err"); return; }
    await logHistorico(drawerId, ehAbertura ? "Abertura de vaga confirmada" : "Aprovada pelo Operacional", {
      de: drawerSol.status, para: novoStatus, papel: ehAbertura ? "Recrutamento" : "Operacional",
    });
    toast(ehAbertura ? "Vaga aberta — já aparece no portal de candidaturas!" : "Aprovado e encaminhado ao Recrutamento!", "ok");
    fecharDrawer();
    loadStats();
    loadLista();
  };

  // ── Concluir Solicitação (só com candidato admitido) ──────────
  const concluir = async () => {
    if (!drawerId) return;
    const admitido = candidatos.find(c => c.etapa_processo === "Admissão");
    if (!admitido) { toast("Conclua só após admitir um candidato (etapa Admissão).", "err"); return; }
    if (!confirm(`Concluir a solicitação #${drawerId}? Ela sai da seleção de candidatos.`)) return;
    const { error } = await (supabase as any)
      .from("SISTEMA_RECRUTAMENTO")
      .update({ status: "Concluída" })
      .eq("id", drawerId);
    if (error) { toast("Erro ao concluir.", "err"); return; }
    await logHistorico(drawerId, "Solicitação concluída", {
      de: "Seleção de Candidato", para: "Concluída", papel: "Recrutamento",
      detalhe: admitido.nome ? `Admitido: ${admitido.nome}` : undefined,
      candidatoId: admitido.id, candidatoNome: admitido.nome,
    });
    toast("Solicitação concluída!", "ok");
    fecharDrawer();
    loadStats();
    loadLista();
  };

  // ── Reprovar ──────────────────────────────────────────────────
  const confirmarReprovar = async () => {
    if (!reprovarMotivo.trim()) { toast("Informe o motivo.", "err"); return; }
    const { error } = await (supabase as any)
      .from("SISTEMA_RECRUTAMENTO")
      .update({ status: "Reprovada", motivo_reprovacao: reprovarMotivo.trim(), aprovado_por_nome: user?.user_metadata?.nome ?? "" })
      .eq("id", drawerId);
    if (error) { toast("Erro ao reprovar.", "err"); return; }
    if (drawerId) {
      const papel = drawerSol?.status === "Pendente Operacional" ? "Operacional" : "Recrutamento";
      await logHistorico(drawerId, "Solicitação reprovada", {
        de: drawerSol?.status, para: "Reprovada", papel, detalhe: reprovarMotivo.trim(),
      });
    }
    toast("Solicitação reprovada.", "ok");
    setModalReprovar(false);
    setReprovarMotivo("");
    fecharDrawer();
    loadStats();
    loadLista();
  };

  // ── Atualizar Status ──────────────────────────────────────────
  const confirmarStatus = async () => {
    if (!statusSel) { toast("Selecione um status.", "err"); return; }
    const payload: Record<string, any> = { status: statusSel };
    if (statusSel === "Funcionário Selecionado") {
      if (!statusExtra.nome) { toast("Informe o nome.", "err"); return; }
      payload.funcionario_selecionado = statusExtra.nome;
    } else if (statusSel === "Contratado") {
      if (!statusExtra.nome || !statusExtra.contato || !statusExtra.data) { toast("Preencha todos os campos.", "err"); return; }
      payload.contratado_nome        = statusExtra.nome;
      payload.contratado_contato     = statusExtra.contato;
      payload.contratado_data_inicio = statusExtra.data;
    }
    const { error } = await (supabase as any).from("SISTEMA_RECRUTAMENTO").update(payload).eq("id", drawerId);
    if (error) { toast("Erro ao atualizar status.", "err"); return; }
    toast("Status atualizado!", "ok");
    setModalStatus(false);
    setStatusSel("");
    setStatusExtra({});
    if (drawerId) verDetalhe(drawerId);
    loadStats();
    loadLista();
  };

  // ── Carregar Currículos ───────────────────────────────────────
  const digitsOf = (s?: string) => String(s ?? "").replace(/\D/g, "");

  const abrirCurriculos = async () => {
    setShowCurriculos(true);
    setCurriculos([]); setEmpCpf({}); setBlacklist({});
    const { data } = await (supabase as any)
      .from("WA_CURRICULOS")
      .select("*")
      .eq("vaga_id", drawerId)
      .order("created_at", { ascending: false });
    if (!data) return;
    const mapped: Curriculo[] = data.map((c: any) => ({
      ...c,
      nome: c.nome ?? c.nome_cand ?? c.nome_candidato ?? "",
      email: c.email ?? c.email_cand ?? "",
      cpf: c.cpf ?? c.cpf_cand ?? "",
      storage_path: c.storage_path ?? c.arquivo_path ?? c.path ?? "",
      tem_pdf: !!(c.storage_path ?? c.arquivo_path ?? c.path ?? c.arquivo_url),
    }));
    setCurriculos(mapped);

    // Cruza o CPF com a tabela EMPREGADOS e verifica a lista negra.
    const cpfs = Array.from(new Set(mapped.map(c => c.cpf).filter(Boolean))) as string[];
    const digits = Array.from(new Set(mapped.map(c => digitsOf(c.cpf)).filter(d => d.length === 11)));
    if (cpfs.length) {
      const { data: emps } = await (supabase as any).rpc("empregados_por_cpfs", { p_cpfs: cpfs });
      const byCpf: Record<string, any[]> = {};
      (emps ?? []).forEach((e: any) => { (byCpf[e.cpf_match] = byCpf[e.cpf_match] || []).push(e); });
      setEmpCpf(byCpf);
    }
    if (digits.length) {
      const { data: bl } = await (supabase as any)
        .from("RECRUTAMENTO_CPF_BLACKLIST").select("cpf_digits,motivo,criado_em").in("cpf_digits", digits);
      const blMap: Record<string, { motivo: string; criado_em?: string }> = {};
      (bl ?? []).forEach((b: any) => { blMap[b.cpf_digits] = { motivo: b.motivo, criado_em: b.criado_em }; });
      setBlacklist(blMap);
    }
  };

  // Link do WhatsApp do candidato com mensagem já preenchida com o nome dele.
  const waLinkDe = (c: any): string | null => {
    const d = String(c.telefone ?? "").replace(/\D/g, "");
    if (d.length < 10) return null;
    const num = d.startsWith("55") && d.length >= 12 ? d : "55" + d;
    const pn = String(c.nome ?? "").trim().split(/\s+/)[0] || "";
    const primeiroNome = pn.charAt(0).toUpperCase() + pn.slice(1).toLowerCase(); // "PABLO" → "Pablo"
    const msg = `Olá ${primeiroNome}, tudo bem? Estamos entrando em contato sobre o seu processo seletivo.`;
    return `https://wa.me/${num}?text=${encodeURIComponent(msg)}`;
  };

  // Download do currículo: signed URL temporária no bucket privado 'curriculos'.
  const baixarCurriculo = async (cv: Curriculo) => {
    if (!cv.storage_path) return;
    const { data, error } = await supabase.storage.from("curriculos").createSignedUrl(cv.storage_path, 3600);
    if (error || !data?.signedUrl) { toast("Não foi possível abrir o arquivo.", "err"); return; }
    window.open(data.signedUrl, "_blank", "noopener");
  };

  // ── Lista negra de CPF ────────────────────────────────────────
  const abrirBloqueio = (cv: Curriculo) => {
    const digits = digitsOf(cv.cpf);
    if (digits.length !== 11) { toast("CPF do candidato inválido.", "err"); return; }
    setBlockMotivo(""); setBlockModal({ digits, fmt: cv.cpf || digits });
  };
  const confirmarBloqueio = async () => {
    if (!blockModal) return;
    if (!blockMotivo.trim()) { toast("Informe o motivo do bloqueio.", "err"); return; }
    const { error } = await (supabase as any).from("RECRUTAMENTO_CPF_BLACKLIST").upsert({
      cpf_digits: blockModal.digits, cpf_fmt: blockModal.fmt, motivo: blockMotivo.trim(),
      criado_por: user?.user_metadata?.nome ?? user?.email ?? "",
    }, { onConflict: "cpf_digits" });
    if (error) { toast("Erro ao bloquear: " + error.message, "err"); return; }
    setBlacklist(prev => ({ ...prev, [blockModal.digits]: { motivo: blockMotivo.trim() } }));
    setBlockModal(null); toast("CPF adicionado à lista negra.", "ok");
  };
  const desbloquearCpf = async (digits: string) => {
    if (!confirm("Remover este CPF da lista negra?")) return;
    const { error } = await (supabase as any).from("RECRUTAMENTO_CPF_BLACKLIST").delete().eq("cpf_digits", digits);
    if (error) { toast("Erro ao remover: " + error.message, "err"); return; }
    setBlacklist(prev => { const n = { ...prev }; delete n[digits]; return n; });
    toast("CPF removido da lista negra.", "ok");
  };

  // Agrupa currículos pelo MESMO CPF (dígitos). Sem CPF válido → grupo próprio.
  const cvGrupos = (() => {
    const m = new Map<string, Curriculo[]>();
    for (const cv of curriculos) {
      const d = digitsOf(cv.cpf);
      const key = d.length === 11 ? d : `id:${cv.id}`;
      const arr = m.get(key);
      if (arr) arr.push(cv); else m.set(key, [cv]);
    }
    return Array.from(m.values()).map(items => {
      const latest = items[0]; // já vem ordenado por created_at desc
      const d = digitsOf(latest.cpf);
      const emProcesso = items.some(i => !!i.etapa_processo);
      return { items, latest, digits: d.length === 11 ? d : "", emProcesso };
    });
  })();

  // ── Candidatos: selecionar e mover no kanban interno ──────────
  // Quem pode mover o candidato a partir de cada etapa.
  const podeMoverCand = (etapa?: string | null) => {
    if (etapa === "JURÍDICO")  return podeMoverJuridico || podeRecrutar;
    if (etapa === "EXAME SST") return podeMoverSst || podeRecrutar;
    if (etapa === "COMPRAS")   return podeMoverCompras || podeRecrutar; // confirma → DOCUMENTAÇÃO
    return podeRecrutar; // ENTRADA, TRIAGEM, ENTREVISTA, ENT. GESTOR, APROVADOS, DOCUMENTAÇÃO
  };
  // Próxima etapa linear (TRIAGEM e ENTREVISTA ramificam → tratadas no card).
  const CAND_PROX: Record<string, string> = {
    ENTRADA: "TRIAGEM",
    "JURÍDICO": "ENTREVISTA",
    "ENTREVISTA GESTOR": "APROVADOS",
    APROVADOS: "EXAME SST",
    "EXAME SST": "COMPRAS",
    COMPRAS: "DOCUMENTAÇÃO",
  };
  const labelProx = (etapa: string) => ({
    ENTRADA: "→ Triagem",
    "JURÍDICO": "Liberar → Entrevista",
    "ENTREVISTA GESTOR": "→ Aprovados",
    APROVADOS: "→ Exame SST",
    "EXAME SST": "→ Compras",
    COMPRAS: "Confirmar → Documentação",
  } as Record<string, string>)[etapa] || "Avançar";

  // DOCUMENTAÇÃO → envia o candidato para a Admissão (RH).
  const enviarAdmissao = async (cv: Curriculo) => {
    if (!confirm(`Contratar ${cv.nome || "o candidato"}? Ele será enviado à Admissão (RH) e a vaga fica como "Contratado".`)) return;
    const nowIso = new Date().toISOString();
    const nome = user?.user_metadata?.nome ?? user?.email ?? "";
    const { error } = await (supabase as any).from("WA_CURRICULOS")
      .update({ enviado_admissao_por: nome, enviado_admissao_em: nowIso }).eq("id", cv.id);
    if (error) { toast("Erro: " + error.message, "err"); return; }
    if (drawerId) await logHistorico(drawerId, "Contratado — enviado à Admissão (RH)", {
      papel: "Recrutamento", para: "Contratado", candidatoId: cv.id, candidatoNome: cv.nome,
    });
    toast("Candidato contratado — enviado à Admissão.", "ok");
    if (drawerId) loadCandidatos(drawerId);
  };

  // ── Roteiro de entrevista (ENTREVISTA / ENTREVISTA GESTOR) ─────
  const ROTEIRO_PADRAO: Record<string, string[]> = {
    "ENTREVISTA": [
      "Fale um pouco sobre você e sua trajetória.",
      "Por que tem interesse nesta vaga?",
      "Como lida com trabalho sob pressão / imprevistos?",
      "Disponibilidade de horários e para início?",
      "Pretensão salarial?",
    ],
    "ENTREVISTA GESTOR": [
      "Descreva sua experiência técnica na função.",
      "Quais atividades já executou relacionadas à vaga?",
      "Como resolveria uma situação técnica comum do posto?",
      "Pontos fortes e pontos a desenvolver?",
      "Disponibilidade para início?",
    ],
  };
  const novaLinhaRot = () => ({ pergunta: "", resposta: "" });
  const abrirRoteiro = async (cv: Curriculo, etapa: string) => {
    const { data } = await (supabase as any).from("RECRUTAMENTO_ENTREVISTA").select("*").eq("candidato_id", cv.id).eq("etapa", etapa).order("ordem");
    const rows = (data ?? []).map((r: any) => ({ pergunta: r.pergunta || "", resposta: r.resposta || "" }));
    setRoteiroRows(rows.length ? rows : (ROTEIRO_PADRAO[etapa] || []).map(p => ({ pergunta: p, resposta: "" })));
    setRoteiroModal({ id: cv.id, nome: cv.nome || "Candidato", etapa });
  };
  const salvarRoteiro = async () => {
    if (!roteiroModal) return;
    const rows = roteiroRows.filter(r => r.pergunta.trim());
    await (supabase as any).from("RECRUTAMENTO_ENTREVISTA").delete().eq("candidato_id", roteiroModal.id).eq("etapa", roteiroModal.etapa);
    if (rows.length) {
      const { error } = await (supabase as any).from("RECRUTAMENTO_ENTREVISTA").insert(rows.map((r, i) => ({
        candidato_id: roteiroModal.id, etapa: roteiroModal.etapa, ordem: i, pergunta: r.pergunta.trim(), resposta: r.resposta.trim() || null,
      })));
      if (error) { toast("Erro ao salvar roteiro: " + error.message, "err"); return; }
    }
    if (drawerId) await logHistorico(drawerId, `Roteiro de entrevista (${roteiroModal.etapa}) preenchido`, { papel: "Recrutamento", candidatoId: roteiroModal.id, candidatoNome: roteiroModal.nome });
    toast("Roteiro salvo.", "ok");
    setRoteiroModal(null); setRoteiroRows([]);
  };

  // Seleciona um currículo para o processo (entra no kanban como "ENTRADA").
  const selecionarCandidato = async (cv: Curriculo) => {
    if (cv.etapa_processo) { toast("Candidato já está no processo.", "info"); return; }
    const nowIso = new Date().toISOString();
    const { error } = await (supabase as any).from("WA_CURRICULOS").update({
      etapa_processo: "ENTRADA",
      etapa_changed_at: nowIso,
      selecionado_por: user?.user_metadata?.nome ?? user?.email ?? "",
      selecionado_em: nowIso,
    }).eq("id", cv.id);
    if (error) { toast("Erro ao selecionar candidato: " + error.message, "err"); return; }
    if (drawerId) await logHistorico(drawerId, "Candidato selecionado", {
      para: "ENTRADA", papel: "Recrutamento", candidatoId: cv.id, candidatoNome: cv.nome,
    });
    toast(`${cv.nome || "Candidato"} adicionado ao processo.`, "ok");
    setCurriculos(prev => prev.map(c => c.id === cv.id ? { ...c, etapa_processo: "ENTRADA" } : c));
    if (drawerId) loadCandidatos(drawerId);
  };

  const pedirMoverCand = (cv: Curriculo, novaEtapa: string) => {
    setCandObs("");
    setCandModal({ id: cv.id, novaEtapa, nome: cv.nome || "Candidato" });
  };

  const executarMoverCand = async (id: number, novaEtapa: string, extra: Record<string, any> = {}) => {
    const nowIso = new Date().toISOString();
    const nome = user?.user_metadata?.nome ?? user?.email ?? "";
    const cand = candidatos.find(c => c.id === id);
    const origem = cand?.etapa_processo || "";
    const reprovado = novaEtapa === "Reprovado";
    const payload: Record<string, any> = { etapa_processo: novaEtapa, etapa_changed_at: nowIso, ...extra };
    // Carimba quem completou a etapa de ORIGEM (e decisão do Jurídico colore o card).
    if (origem === "JURÍDICO")  { payload.juridico_ok = !reprovado; payload.juridico_por = nome; payload.juridico_em = nowIso; }
    if (origem === "EXAME SST" && !reprovado) { payload.sst_ok = true; payload.sst_por = nome; payload.sst_em = nowIso; }
    if (origem === "COMPRAS" && !reprovado)   { payload.compras_por = nome; payload.compras_em = nowIso; }
    const { error } = await (supabase as any).from("WA_CURRICULOS").update(payload).eq("id", id);
    if (error) { toast("Erro ao mover candidato: " + error.message, "err"); return; }
    // Reprova do Jurídico vira restrição do CPF (vale para qualquer vaga).
    if (origem === "JURÍDICO" && reprovado) {
      const d = digitsOf(cand?.cpf);
      if (d.length === 11) {
        await (supabase as any).from("RECRUTAMENTO_CPF_BLACKLIST").upsert({
          cpf_digits: d, cpf_fmt: cand?.cpf, motivo: extra.motivo_reprovacao || "Reprovado pelo Jurídico", criado_por: nome,
        }, { onConflict: "cpf_digits" });
      }
    }
    const eventoTxt: Record<string, string> = {
      TRIAGEM: "Movido para Triagem",
      "JURÍDICO": "Enviado ao Jurídico",
      ENTREVISTA: origem === "JURÍDICO" ? "Liberado pelo Jurídico → Entrevista" : "Liberado para Entrevista",
      "ENTREVISTA GESTOR": "Enviado à Entrevista com Gestor",
      APROVADOS: "Aprovado nas entrevistas",
      "EXAME SST": "Encaminhado ao SST (ASO)",
      COMPRAS: "Exame OK → Compras",
      "DOCUMENTAÇÃO": "Compras OK → Documentação",
      Reprovado: "Candidato reprovado",
    };
    if (drawerId) await logHistorico(drawerId, eventoTxt[novaEtapa] || `Movido para ${novaEtapa}`, {
      de: origem, para: novaEtapa, papel: PAPEL_ETAPA[origem] || "Recrutamento",
      candidatoId: id, candidatoNome: cand?.nome,
      detalhe: extra.motivo_reprovacao || extra.juridico_obs || extra.sst_obs || undefined,
    });
    toast(`Candidato movido para "${novaEtapa}".`, "ok");
    if (drawerId) loadCandidatos(drawerId);
  };

  const confirmarMoverCand = async () => {
    if (!candModal) return;
    const { id, novaEtapa } = candModal;
    if (novaEtapa === "Reprovado" && !candObs.trim()) { toast("Informe o motivo da reprovação.", "err"); return; }
    const extra: Record<string, any> = {};
    const origem = candidatos.find(c => c.id === id)?.etapa_processo;
    if (novaEtapa === "Reprovado") {
      extra.motivo_reprovacao = candObs.trim();
    } else if (candObs.trim()) {
      if (origem === "JURÍDICO")        extra.juridico_obs = candObs.trim();
      else if (origem === "EXAME SST")  extra.sst_obs = candObs.trim();
    }
    setCandModal(null);
    setCandObs("");
    await executarMoverCand(id, novaEtapa, extra);
  };

  // ── Kanban Mover ──────────────────────────────────────────────
  const executarMover = async (id: number, novoStatus: string, oldSt: string, extra: Record<string, any>) => {
    const payload: Record<string, any> = { status: novoStatus, ...extra };
    const { error } = await (supabase as any).from("SISTEMA_RECRUTAMENTO").update(payload).eq("id", id);
    if (error) { toast("Erro ao mover card.", "err"); loadKanban(); return; }
    toast(`Card movido para "${novoStatus}"`, "ok");
    loadStats();
    loadKanban();
  };

  const kbDrop = (novoStatus: string) => {
    if (!dragId || novoStatus === dragStatus) return;
    const id   = dragId;
    const oldSt = dragStatus!;
    setDragId(null);
    setDragStatus(null);
    setDragOver(null);

    // No board externo só se arrasta para encerrar a solicitação (Concluída/Reprovada).
    // As demais transições são feitas pelos botões dentro da solicitação.
    if (novoStatus === "Reprovada" || novoStatus === "Concluída") {
      setPendMover({ id, novoStatus, oldSt });
      setMoverExtra({});
      setModalMoverKb(true);
      return;
    }
    toast("Use os botões da solicitação para avançar entre as etapas.", "info");
  };

  const confirmarMoverKb = async () => {
    if (!pendMover) return;
    const { id, novoStatus, oldSt } = pendMover;
    const extra: Record<string, any> = {};

    if (novoStatus === "Reprovada") {
      if (!moverExtra.motivo) { toast("Informe o motivo.", "err"); return; }
      extra.motivo_reprovacao = moverExtra.motivo;
      extra.aprovado_por_nome = user?.user_metadata?.nome ?? "";
    }
    setModalMoverKb(false);
    setPendMover(null);
    executarMover(id, novoStatus, oldSt, extra);
  };

  // ── Solicitar Vaga ────────────────────────────────────────────
  const carregarContratos = async () => {
    const { data } = await (supabase as any)
      .from("CONTRATOS")
      .select('"NOME CONTRATO", Filial')
      .eq("ATIVO", "SIM")
      .order('"NOME CONTRATO"');
    if (data) {
      setContratosFull(data);
      // dedup de nomes — há contratos com mesmo NOME CONTRATO em filiais diferentes
      const nomes = Array.from(new Set(data.map((c: any) => c["NOME CONTRATO"] ?? "").filter(Boolean)));
      setContratos(nomes as string[]);
    }
  };

  const buscarEmpregados = async (term: string) => {
    empTermo.current = term;
    setLoadingEmps(true);
    const { data, error } = await (supabase as any)
      .from("EMPREGADOS")
      .select('"Nome", "Filial", "Nome Filial", "Título do Cargo", "Valor Salário", "% Insalubridade", "Escala"')
      .eq("Situação", "Trabalhando")
      .ilike("Nome", `%${term}%`)
      .order('"Nome"')
      .limit(50);
    if (empTermo.current !== term) return; // resposta de uma busca antiga — descarta
    setLoadingEmps(false);
    if (error) { toast("EMPREGADOS: " + error.message + " (" + (error.code ?? "?") + ")", "err"); return; }
    setEmpregados(data ?? []);
  };

  const selecionarEmpregado = (emp: any) => {
    const contratoMatch = contratosFull.find((c: any) => c.Filial === emp.Filial);
    const insal = parseFloat(String(emp["% Insalubridade"] ?? "0").replace(",", ".")) || 0;
    setVaga(v => ({
      ...v,
      nome_substituido: emp.Nome,
      cargo: emp["Título do Cargo"] ?? "",
      salario: emp["Valor Salário"] ? `R$ ${String(emp["Valor Salário"]).replace(".", ",")}` : "",
      insalubridade_recebe: insal > 0 ? "Sim" : "Não",
      insalubridade_quanto: insal > 0 ? `${emp["% Insalubridade"]}%` : "",
      escala: emp["Escala"] ? String(emp["Escala"]) : v.escala,
      contrato: contratoMatch ? contratoMatch["NOME CONTRATO"] : v.contrato,
    }));
    setEmpSearch(emp.Nome);
    setShowEmpDrop(false);
  };

  const abrirModalVaga = () => {
    setModalVaga(true);
    setVagaStep(1);
    setEmpSearch("");
    setShowEmpDrop(false);
    if (!contratos.length) carregarContratos();
  };

  const vagaValidar = (step: number) => {
    if (step === 1) {
      if (!vaga.motivo_vaga) { toast("Selecione o motivo da vaga.", "err"); return false; }
      if (!vaga.contrato)    { toast("Selecione o contrato.", "err"); return false; }
      if (!vaga.cargo.trim()){ toast("Informe o cargo.", "err"); return false; }
    }
    if (step === 3) {
      if (!vaga.req_obrigatorios.trim()) { toast("Informe os requisitos obrigatórios.", "err"); return false; }
    }
    return true;
  };

  const submitVaga = async () => {
    if (!vagaValidar(3)) return;
    const payload = {
      ...vaga,
      quantidade_vagas: parseInt(vaga.quantidade_vagas) || 1,
      status: "Pendente Operacional",
      solicitante_nome: user?.user_metadata?.nome ?? user?.email ?? "",
      solicitante_cpf: user?.email ?? "",
    };
    const { error, data } = await (supabase as any).from("SISTEMA_RECRUTAMENTO").insert(payload).select("id").single();
    if (error) { toast("Erro ao solicitar vaga: " + error.message, "err"); return; }
    toast(`Solicitação #${data?.id} criada com sucesso!`, "ok");
    setModalVaga(false);
    setVaga({ motivo_vaga:"",nome_substituido:"",contrato:"",cargo:"",estado:"",cidade:"",
      quantidade_vagas:"1",data_inicio_prevista:"",escala:"",horario:"",salario:"",
      insalubridade_recebe:"Não",insalubridade_quanto:"",beneficios:"",local_exato:"",
      grau_urgencia:"",alta_rotatividade:"Não",req_obrigatorios:"",req_desejaveis:"",
      exp_minima:"Não",exp_minima_qual:"",motivos_saida:"",recomendacao:"",observacao_importante:"" });
    setVagaStep(1);
    setEmpSearch("");
    setShowEmpDrop(false);
    loadStats();
    loadLista();
  };

  // ── CSS injetado ──────────────────────────────────────────────
  useEffect(() => {
    const style = document.createElement("style");
    style.id = "rec-styles";
    style.textContent = `
      .rec-kpi{background:#fff;border:1px solid #e2e8f0;border-radius:16px;padding:14px 16px;box-shadow:0 8px 24px rgba(15,23,42,.06)}
      .rec-badge{display:inline-flex;align-items:center;padding:2px 8px;border-radius:20px;font-size:10px;font-weight:700;white-space:nowrap}
      .rec-table{width:100%;border-collapse:collapse}
      .rec-table th{font-size:10px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:.7px;padding:10px 12px;border-bottom:1px solid #e2e8f0;text-align:left;background:#f8fafc}
      .rec-table td{padding:11px 12px;border-bottom:1px solid #e2e8f0;font-size:12px;color:#475569;vertical-align:middle}
      .rec-table tr:hover td{background:#f8fbff;cursor:pointer}
      .rec-drawer-ov{position:fixed;inset:0;z-index:500;background:rgba(15,23,42,.42);backdrop-filter:blur(4px);display:flex;justify-content:flex-end}
      .rec-drawer{width:84%;max-width:960px;height:100%;background:#fff;border-left:1px solid #e2e8f0;display:flex;flex-direction:column;overflow:hidden;box-shadow:-20px 0 60px rgba(15,23,42,.18);animation:drIn .22s ease}
      @keyframes drIn{from{transform:translateX(40px);opacity:.4}to{transform:translateX(0);opacity:1}}
      .rec-modal-ov{position:fixed;inset:0;z-index:700;background:rgba(15,23,42,.42);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center}
      .rec-modal{background:#fff;border:1px solid #e2e8f0;border-radius:18px;padding:24px;width:100%;max-width:520px;max-height:90vh;overflow-y:auto;position:relative;box-shadow:0 16px 40px rgba(15,23,42,.1)}
      .rec-fi{width:100%;background:#fff;border:1px solid #e2e8f0;border-radius:12px;color:#0f172a;font-size:13px;padding:8px 12px;outline:none;font-family:inherit;transition:.15s}
      .rec-fi:focus{border-color:#0f3171;box-shadow:0 0 0 4px rgba(15,49,113,.08)}
      .rec-fg{margin-bottom:14px}
      .rec-fg label{display:block;font-size:11px;font-weight:600;color:#94a3b8;text-transform:uppercase;letter-spacing:.5px;margin-bottom:5px}
      .kb-toolbar{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:10px;flex-wrap:wrap}
      .kb-hint{font-size:11px;color:#94a3b8;font-weight:600}
      .kb-hint strong{color:#475569}
      .kb-nav{display:flex;gap:6px;flex-shrink:0}
      .kb-nav-btn{width:34px;height:30px;border-radius:9px;border:1px solid #e2e8f0;background:#fff;color:#0f3171;font-size:13px;font-weight:800;cursor:pointer;box-shadow:0 4px 12px rgba(15,23,42,.06);transition:.15s;display:inline-flex;align-items:center;justify-content:center}
      .kb-nav-btn:hover{background:#0f3171;color:#fff;border-color:#0f3171}
      .kb-board{display:flex;gap:10px;height:calc(100vh - 320px);min-height:420px;overflow-x:auto;overflow-y:hidden;padding-bottom:14px;align-items:flex-start;scroll-behavior:smooth;cursor:grab}
      .kb-board.kb-grabbing{cursor:grabbing;scroll-behavior:auto;user-select:none}
      .kb-board::-webkit-scrollbar{height:12px}
      .kb-board::-webkit-scrollbar-track{background:#eef2f7;border-radius:8px}
      .kb-board::-webkit-scrollbar-thumb{background:#cbd5e1;border-radius:8px;border:3px solid #eef2f7}
      .kb-board::-webkit-scrollbar-thumb:hover{background:#94a3b8}
      .kb-board{scrollbar-width:auto;scrollbar-color:#cbd5e1 #eef2f7}
      .kb-col{flex:0 0 252px;background:#fff;border:1px solid #e2e8f0;border-radius:14px;display:flex;flex-direction:column;max-height:100%;overflow:hidden;transition:.15s;box-shadow:0 8px 24px rgba(15,23,42,.06)}
      .kb-col.drag-over{border-color:#0f3171;background:rgba(15,49,113,.04)}
      .kb-col-head{padding:10px 12px 8px;border-bottom:1px solid #e2e8f0;flex-shrink:0;display:flex;align-items:center;gap:6px;background:#fcfdff}
      .kb-col-body{flex:1;overflow-y:auto;padding:8px 6px;display:flex;flex-direction:column;gap:6px;user-select:none}
      .kb-card{background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;cursor:pointer;transition:transform .12s,border-color .12s;box-shadow:0 8px 24px rgba(15,23,42,.06);user-select:none}
      .kb-card:hover{border-color:#cbd5e1;transform:translateY(-2px)}
      .kb-card.dragging{opacity:.3;transform:scale(.96)}
      .cv-panel-ov{position:fixed;inset:0;z-index:800;background:rgba(15,23,42,.48);backdrop-filter:blur(5px);display:flex;justify-content:flex-end}
      .cv-panel{width:88%;max-width:1100px;height:100%;background:#fff;border-left:1px solid #e2e8f0;display:flex;flex-direction:column;overflow:hidden;box-shadow:-20px 0 60px rgba(15,23,42,.18)}
      .cv-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:16px}
      .cv-card{background:#fff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;display:flex;flex-direction:column;box-shadow:0 8px 24px rgba(15,23,42,.06)}
      .rec-dg{display:grid;grid-template-columns:1fr 1fr;gap:0;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;margin-bottom:14px;box-shadow:0 8px 24px rgba(15,23,42,.06)}
      .rec-di{padding:10px 14px;border-bottom:1px solid #e2e8f0;font-size:13px}
      .rec-di:nth-last-child(-n+2){border-bottom:none}
      .rec-di.full{grid-column:1/-1}
      .rec-di label{display:block;font-size:10px;font-weight:600;color:#94a3b8;text-transform:uppercase;letter-spacing:.7px;margin-bottom:2px}
      .rec-dd{background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:12px 14px;font-size:13px;color:#475569;line-height:1.6;margin-bottom:12px;white-space:pre-wrap;word-break:break-word}
      .rec-dd-label{font-size:10px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:.7px;margin-bottom:5px}
      .rec-chat-msgs{flex:1;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:8px}
      .rec-cmsg{max-width:88%}
      .rec-cmsg.mine{align-self:flex-end;align-items:flex-end;display:flex;flex-direction:column}
      .rec-cmsg.theirs{align-self:flex-start;align-items:flex-start;display:flex;flex-direction:column}
      .rec-cbubble-mine{padding:8px 12px;border-radius:12px 12px 3px 12px;font-size:13px;line-height:1.5;background:rgba(15,49,113,.10);border:1px solid rgba(15,49,113,.20);color:#0f172a}
      .rec-cbubble-theirs{padding:8px 12px;border-radius:12px 12px 12px 3px;font-size:13px;line-height:1.5;background:#fff;border:1px solid #e2e8f0;color:#0f172a}
    `;
    document.head.appendChild(style);
    return () => { document.getElementById("rec-styles")?.remove(); };
  }, []);

  // ── Render Detalhe ────────────────────────────────────────────
  const renderDetalhe = (s: Solicitacao) => {
    const di = (label: string, val: any, full = false) => (
      <div className={`rec-di${full ? " full" : ""}`} key={label}>
        <label>{label}</label>
        <span>{val || "—"}</span>
      </div>
    );
    const dd = (label: string, val?: string) => val ? (
      <div key={label} style={{ marginBottom: 12 }}>
        <div className="rec-dd-label">{label}</div>
        <div className="rec-dd">{val}</div>
      </div>
    ) : null;

    return (
      <div style={{ padding: 20 }}>
        <div className="rec-dg">
          {di("Contrato", s.contrato, true)}
          {di("Cargo", s.cargo)}
          {di("Cidade", s.cidade)}
          {di("Motivo da Vaga", s.motivo_vaga)}
          {di("Escala", s.escala)}
          {di("Horário", s.horario)}
          {di("Salário", s.salario)}
          {di("Benefícios", s.beneficios, true)}
          {di("Insalubridade", s.insalubridade_recebe + (s.insalubridade_quanto ? " — " + s.insalubridade_quanto : ""))}
          {di("Local Exato", s.local_exato)}
          {di("Data Início Prevista", s.data_inicio_prevista)}
          {di("Solicitado por", s.solicitante_nome)}
          {di("Data Solicitação", fmtDt(s.created_at))}
          {s.aprovado_por_nome ? di("Aprovado/Reprovado por", s.aprovado_por_nome) : null}
        </div>
        {dd("Colaborador Substituído", s.nome_substituido)}
        {dd("Requisitos Obrigatórios", s.req_obrigatorios)}
        {dd("Requisitos Desejáveis", s.req_desejaveis)}
        <div className="rec-dg">
          {di("Experiência Mínima", s.exp_minima + (s.exp_minima_qual ? " — " + s.exp_minima_qual : ""))}
          {di("Alta Rotatividade", s.alta_rotatividade)}
        </div>
        {dd("Motivos de Saída", s.motivos_saida)}
        {dd("Recomendação", s.recomendacao)}
        {dd("Observação Importante", s.observacao_importante)}
        {dd("Motivo de Reprovação", s.motivo_reprovacao)}
        {s.status === "Funcionário Selecionado" && dd("Funcionário Selecionado", s.funcionario_selecionado)}
        {s.status === "Contratado" && dd("Contratado", [s.contratado_nome, s.contratado_contato ? "Contato: " + s.contratado_contato : "", s.contratado_data_inicio ? "Início: " + s.contratado_data_inicio : ""].filter(Boolean).join("\n"))}
      </div>
    );
  };

  // ── Ações do Drawer ───────────────────────────────────────────
  const renderActions = (s: Solicitacao) => {
    const btns = [];
    const reprovar = (key: string) => (
      <button key={key} onClick={() => { setReprovarMotivo(""); setModalReprovar(true); }} style={{ padding: "5px 12px", borderRadius: 8, border: "none", background: "#dc2626", color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>Reprovar</button>
    );

    // Etapa 1 → 2: Operacional aprova a solicitação.
    if (s.status === "Pendente Operacional" && podeAprovarOperacional) {
      btns.push(reprovar("rep"));
      btns.push(<button key="apr" onClick={aprovar} style={{ padding: "5px 12px", borderRadius: 8, border: "none", background: "#16a34a", color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>✓ Aprovar</button>);
    }
    // Etapa 2 → 3: Recrutamento confirma a abertura (vaga vai pro portal).
    if (s.status === "Pendente Recrutamento" && podeRecrutar) {
      btns.push(reprovar("rep2"));
      btns.push(<button key="ab" onClick={aprovar} style={{ padding: "5px 12px", borderRadius: 8, border: "none", background: "#16a34a", color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>✓ Confirmar Abertura de Vaga</button>);
    }
    // Etapas 3–10 (dirigidas pelo candidato): currículos, kanban, reprovar.
    if (STATUS_PROCESSO.includes(s.status) && podeRecrutar) {
      btns.push(<button key="cv" onClick={abrirCurriculos} style={{ padding: "5px 12px", borderRadius: 8, border: "1px solid rgba(34,197,94,.25)", background: "rgba(34,197,94,.1)", color: "#22c55e", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>Currículos</button>);
      btns.push(<button key="kb" onClick={abrirKanbanCand} style={{ padding: "5px 12px", borderRadius: 8, border: "1px solid rgba(59,130,246,.35)", background: "rgba(59,130,246,.12)", color: "#2563eb", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>👥 Candidatos ({candidatos.length})</button>);
      if (s.link_publico) btns.push(<button key="lnk" onClick={() => { setLinkCopiado(false); setModalLink(true); }} style={{ padding: "5px 12px", borderRadius: 8, border: "1px solid rgba(99,102,241,.35)", background: "rgba(99,102,241,.15)", color: "#818cf8", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>Gerar Link</button>);
      btns.push(reprovar("rep3"));
    }
    // Histórico — sempre disponível.
    btns.push(<button key="hist" onClick={() => { if (drawerId) loadHistorico(drawerId); setShowHistorico(true); }} style={{ padding: "5px 12px", borderRadius: 8, border: "1px solid #e2e8f0", background: "#fff", color: "#475569", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>📜 Histórico</button>);
    return btns;
  };

  const abrirKanbanCand = () => { setShowKanbanCand(true); setBuscaCand(""); if (drawerId) loadCandidatos(drawerId); };

  // ── Histórico (timeline): sintetiza a criação + eventos logados ──
  const papelCor = (p?: string): string => (({
    Solicitante: "#0f3171", Operacional: "#b45309", Recrutamento: "#2563eb",
    "Jurídico": "#7c3aed", SST: "#ea580c",
  } as Record<string, string>)[p || ""] || "#64748b");

  const renderHistorico = () => {
    const criada = drawerSol ? [{
      created_at: drawerSol.created_at,
      evento: "Solicitação criada",
      papel: "Solicitante",
      usuario_nome: drawerSol.solicitante_nome,
      para_status: "Pendente Operacional",
      detalhe: drawerSol.motivo_vaga === "Substituição"
        ? (drawerSol.nome_substituido ? `Substituindo: ${drawerSol.nome_substituido}` : "Substituição")
        : (drawerSol.motivo_vaga ? `Aumento de quadro — ${drawerSol.motivo_vaga}` : null),
    }] : [];
    const eventos = [...criada, ...historico].sort((a: any, b: any) => String(a.created_at).localeCompare(String(b.created_at)));
    if (eventos.length === 0) return <div style={{ textAlign: "center", color: "#94a3b8", padding: "40px 16px", fontSize: 13 }}>Sem movimentações registradas.</div>;
    return (
      <div style={{ display: "flex", flexDirection: "column" }}>
        {eventos.map((e: any, i: number) => {
          const cor = papelCor(e.papel);
          const dthora = String(e.created_at ?? "").replace("T", " ").slice(0, 16);
          const nomeExibido = nomesPorEmailHist[e.usuario_email] || e.usuario_nome || "—";
          return (
            <div key={i} style={{ display: "flex", gap: 12, paddingBottom: i === eventos.length - 1 ? 0 : 18 }}>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flexShrink: 0 }}>
                <span style={{ width: 12, height: 12, borderRadius: "50%", background: cor, border: "2px solid #fff", boxShadow: `0 0 0 2px ${cor}33`, marginTop: 3 }} />
                {i < eventos.length - 1 && <span style={{ flex: 1, width: 2, background: "#e2e8f0", marginTop: 2 }} />}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 13.5, fontWeight: 800, color: "#0f172a" }}>{e.evento}</span>
                  {e.papel && <span style={{ fontSize: 10, fontWeight: 800, padding: "1px 8px", borderRadius: 20, background: `${cor}1a`, color: cor }}>{e.papel}</span>}
                </div>
                {(e.de_status || e.para_status) && <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 2 }}>{e.de_status ? `${e.de_status} → ` : ""}{e.para_status || ""}</div>}
                {e.candidato_nome && <div style={{ fontSize: 12, color: "#475569", marginTop: 2 }}>Candidato: <b>{e.candidato_nome}</b></div>}
                {e.detalhe && <div style={{ fontSize: 12, color: "#475569", marginTop: 4, background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, padding: "6px 9px", whiteSpace: "pre-wrap" }}>{e.detalhe}</div>}
                <div style={{ fontSize: 12.5, color: "#0f172a", marginTop: 4 }}><span style={{ fontWeight: 800 }}>{nomeExibido}</span><span style={{ color: "#94a3b8", fontWeight: 400 }}> · {dthora || "—"}</span></div>
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  // ── Kanban interno: candidatos da solicitação ─────────────────
  const renderCandidatosKanban = () => {
    const grupos: Record<string, Curriculo[]> = {};
    // Arrastar para rolar a coluna verticalmente (sem selecionar texto).
    const dragScrollCol = (e: any) => {
      if (e.button !== 0) return;
      if ((e.target as HTMLElement).closest("button, a, input, textarea, select")) return;
      const el = e.currentTarget as HTMLDivElement;
      const startY = e.clientY, startTop = el.scrollTop;
      let moved = false;
      const onMove = (ev: MouseEvent) => {
        const dy = ev.clientY - startY;
        if (Math.abs(dy) > 3) moved = true;
        if (moved) { el.scrollTop = startTop - dy; ev.preventDefault(); }
      };
      const onUp = () => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    };

    // Busca: filtra os cards em todas as colunas (nome, CPF ou telefone).
    const q = buscaCand.trim().toLowerCase();
    const candVisiveis = q
      ? candidatos.filter(c => [c.nome, c.cpf, (c as any).telefone].some(v => String(v ?? "").toLowerCase().includes(q)))
      : candidatos;
    for (const c of candVisiveis) {
      const e = c.etapa_processo || "Selecionado";
      (grupos[e] = grupos[e] || []).push(c);
    }
    return (
      <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, margin: "0 0 12px", flexWrap: "wrap", flexShrink: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: "#0f3171", display: "flex", alignItems: "center", gap: 8 }}>
            👥 Candidatos no processo
            <span style={{ fontSize: 11, fontWeight: 700, background: "#eef4ff", border: "1px solid #dbe4f0", borderRadius: 20, padding: "1px 9px", color: "#0f3171" }}>{q ? `${candVisiveis.length} de ${candidatos.length}` : candidatos.length}</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <input value={buscaCand} onChange={e => setBuscaCand(e.target.value)} placeholder="🔎 Buscar candidato (nome, CPF, fone)…"
              style={{ height: 30, width: 240, border: "1px solid #e2e8f0", borderRadius: 8, padding: "0 10px", fontSize: 12, outline: "none", background: "#fff", color: "#0f172a" }} />
            {q && <button onClick={() => setBuscaCand("")} style={{ height: 30, padding: "0 10px", borderRadius: 8, border: "1px solid #e2e8f0", background: "#f8fafc", color: "#475569", fontSize: 11.5, fontWeight: 700, cursor: "pointer" }}>Limpar</button>}
            {podeRecrutar && (
              <button onClick={abrirCurriculos} style={{ padding: "5px 12px", borderRadius: 8, border: "1px solid rgba(34,197,94,.25)", background: "rgba(34,197,94,.1)", color: "#22c55e", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>+ Selecionar dos currículos</button>
            )}
          </div>
        </div>
        {candidatos.length === 0 ? (
          <div style={{ border: "1px dashed #cbd5e1", borderRadius: 12, padding: "26px 16px", textAlign: "center", color: "#94a3b8", fontSize: 12.5 }}>
            Nenhum candidato selecionado ainda. Abra <b>Currículos</b> e clique em <b>Selecionar candidato</b> para iniciar o processo (Triagem → Jurídico → Entrevistas → Exame SST → Compras → Documentação).
          </div>
        ) : (
          <div style={{ display: "flex", gap: 6, flex: 1, minHeight: 0, paddingBottom: 4, alignItems: "stretch" }}>
            {CAND_ETAPAS.map(etapa => {
              const cards = grupos[etapa] ?? [];
              const meta = CAND_COL_COLORS[etapa];
              return (
                <div key={etapa} className="kb-col" style={{ flex: "1 1 0", minWidth: 0, maxHeight: "100%" }}>
                  <div className="kb-col-head">
                    <span style={{ width: 7, height: 7, borderRadius: "50%", background: meta.dot, display: "inline-block" }} />
                    <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: ".4px", flex: 1, textTransform: "uppercase", color: meta.label }}>{etapa}</span>
                    <span style={{ fontSize: 10, fontWeight: 800, background: "#eef2f7", borderRadius: 20, padding: "1px 7px", color: "#94a3b8" }}>{cards.length}</span>
                  </div>
                  <div className="kb-col-body" onMouseDown={dragScrollCol}>
                    {cards.length === 0 ? (
                      <div style={{ textAlign: "center", padding: "16px 8px", color: "#94a3b8", fontSize: 10, opacity: .6 }}>—</div>
                    ) : cards.map(c => {
                      const podeAqui = podeMoverCand(etapa);
                      // Botões em largura total, empilhados (layout limpo).
                      const bFull = { width: "100%", fontSize: 11, fontWeight: 700 as const, padding: "6px 8px", borderRadius: 8, border: "none", color: "#fff", cursor: "pointer", textAlign: "center" as const };
                      const bSkip = { ...bFull, background: "#fff", color: "#475569", border: "1px solid #e2e8f0" };
                      const avancaBtn = bFull;
                      // Cor do card pela decisão do Jurídico (cinza=pendente, verde=ok, vermelho=reprovado).
                      const cor = c.juridico_ok === true ? "#16a34a" : c.juridico_ok === false ? "#dc2626" : meta.accent;
                      return (
                        <div key={c.id} className="kb-card" style={{ cursor: "default", borderColor: c.juridico_ok === true ? "#bbf7d0" : c.juridico_ok === false ? "#fecaca" : undefined }}>
                          <div style={{ height: 3, background: cor }} />
                          <div style={{ padding: "9px 10px 8px" }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                              <div style={{ fontSize: 12, fontWeight: 800, color: "#0f172a", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", flex: 1 }}>{c.nome || "Sem nome"}</div>
                              <button onClick={() => setDetalheEmp({ nome: c.nome || "Candidato", cpf: c.cpf || "", telefone: c.telefone, email: c.email, itens: [c], emps: [] })} title="Ver todos os detalhes do candidato"
                                style={{ flexShrink: 0, width: 20, height: 20, padding: 0, display: "inline-flex", alignItems: "center", justifyContent: "center", borderRadius: 6, border: "1px solid #e2e8f0", background: "#f8fafc", cursor: "pointer", fontSize: 10.5 }}>🔍</button>
                            </div>
                            {c.cpf && <div style={{ fontSize: 10, color: "#94a3b8" }}>CPF {c.cpf}</div>}
                            {c.telefone && (
                              <div style={{ fontSize: 10, color: "#475569", display: "flex", alignItems: "center", gap: 5 }}>
                                <span>📞 {c.telefone}</span>
                                {waLinkDe(c) && (
                                  <a href={waLinkDe(c)!} target="_blank" rel="noopener noreferrer" title="Chamar no WhatsApp"
                                    style={{ flexShrink: 0, width: 17, height: 17, borderRadius: "50%", background: "#25d366", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
                                    <svg width="10" height="10" viewBox="0 0 24 24" fill="#fff" aria-hidden>
                                      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z"/>
                                    </svg>
                                  </a>
                                )}
                              </div>
                            )}
                            {c.juridico_ok === true && <div style={{ fontSize: 9.5, color: "#15803d", marginTop: 3, fontWeight: 700 }}>✓ Jurídico aprovado</div>}
                            {c.juridico_ok === false && <div style={{ fontSize: 9.5, color: "#b91c1c", marginTop: 3, fontWeight: 700 }}>⛔ Restrito (Jurídico)</div>}
                            {etapa === "Reprovado" && c.motivo_reprovacao && <div style={{ fontSize: 10.5, color: "#b91c1c", marginTop: 4 }}>Motivo: {c.motivo_reprovacao}</div>}
                            {etapa === "DOCUMENTAÇÃO" && (c as any).enviado_admissao_em && <div style={{ fontSize: 9.5, color: "#15803d", marginTop: 4, fontWeight: 700 }}>✓ Contratado — na Admissão (RH)</div>}
                            <div style={{ display: "flex", flexDirection: "column", gap: 5, marginTop: 10 }}>
                              {/* ENTREVISTA/GESTOR: roteiro de entrevista */}
                              {(etapa === "ENTREVISTA" || etapa === "ENTREVISTA GESTOR") && podeRecrutar && <button onClick={() => abrirRoteiro(c, etapa)} style={{ ...bFull, background: "rgba(59,130,246,.1)", color: "#2563eb", border: "1px solid rgba(59,130,246,.3)" }}>📋 Roteiro de entrevista</button>}
                              {/* Avançar — com ramificação em TRIAGEM e ENTREVISTA */}
                              {etapa === "TRIAGEM" && podeAqui ? (<>
                                <button onClick={() => pedirMoverCand(c, "JURÍDICO")} style={{ ...avancaBtn, background: "#8b5cf6" }}>Enviar ao Jurídico</button>
                                <button onClick={() => pedirMoverCand(c, "ENTREVISTA")} style={bSkip}>Pular Jurídico →</button>
                              </>) : etapa === "ENTREVISTA" && podeAqui ? (<>
                                <button onClick={() => pedirMoverCand(c, "ENTREVISTA GESTOR")} style={{ ...avancaBtn, background: "#6366f1" }}>Entrevista c/ Gestor</button>
                                <button onClick={() => pedirMoverCand(c, "APROVADOS")} style={bSkip}>Pular Gestor →</button>
                              </>) : etapa === "DOCUMENTAÇÃO" ? (
                                podeRecrutar && !(c as any).enviado_admissao_em && <button onClick={() => enviarAdmissao(c)} style={{ ...avancaBtn, background: "#16a34a" }}>✓ Contratar (enviar à Admissão)</button>
                              ) : (CAND_PROX[etapa] && podeAqui && (
                                <button onClick={() => pedirMoverCand(c, CAND_PROX[etapa])} style={{ ...avancaBtn, background: "#16a34a" }}>{labelProx(etapa)}</button>
                              ))}
                              {etapa !== "DOCUMENTAÇÃO" && etapa !== "Reprovado" && podeAqui && <button onClick={() => pedirMoverCand(c, "Reprovado")} style={{ width: "100%", fontSize: 10.5, fontWeight: 700, padding: "4px", borderRadius: 7, background: "transparent", border: "none", color: "#94a3b8", cursor: "pointer" }}>Reprovar</button>}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  const canNovaVaga = !isRH;
  const linkUrl = drawerSol?.link_publico ? `${window.location.origin}/recrutamento/candidatura/${drawerSol.link_publico}` : "";

  // Kanban: rola o quadro horizontalmente (~1,5 coluna por clique).
  const scrollKb = (dir: -1 | 1) => kbBoardRef.current?.scrollBy({ left: dir * 380, behavior: "smooth" });

  // Portal público de candidatura (/vagas): copiar o link para divulgar.
  const [portalCopiado, setPortalCopiado] = useState(false);
  const copiarLinkPortal = async () => {
    const url = `${window.location.origin}/vagas`;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = url; ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.focus(); ta.select();
      try { document.execCommand("copy"); } catch { /* noop */ }
      document.body.removeChild(ta);
    }
    setPortalCopiado(true);
    toast("Link de candidatura copiado!", "ok");
    setTimeout(() => setPortalCopiado(false), 2000);
  };

  // Kanban: clicar numa área vazia do quadro e arrastar para o lado (pan).
  // Ignora cliques sobre os cards para não atrapalhar o arrastar-e-soltar deles.
  const kbPan = useRef({ down: false, startX: 0, startLeft: 0 });
  const kbPanDown = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest(".kb-card")) return;
    const el = kbBoardRef.current; if (!el) return;
    e.preventDefault();
    kbPan.current = { down: true, startX: e.pageX, startLeft: el.scrollLeft };
    el.classList.add("kb-grabbing");
  };
  const kbPanMove = (e: React.MouseEvent) => {
    const st = kbPan.current; if (!st.down) return;
    const el = kbBoardRef.current; if (!el) return;
    el.scrollLeft = st.startLeft - (e.pageX - st.startX);
  };
  const kbPanEnd = () => {
    if (!kbPan.current.down) return;
    kbPan.current.down = false;
    kbBoardRef.current?.classList.remove("kb-grabbing");
  };

  // ── RENDER ────────────────────────────────────────────────────
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", background: "#f5f7fb" }}>

      {/* Topbar */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 22px", margin: "18px 24px 0", border: "1px solid #e2e8f0", borderRadius: 18, background: "linear-gradient(135deg,#fff 0%,#f8fbff 100%)", boxShadow: "0 8px 24px rgba(15,23,42,.06)", flexShrink: 0, gap: 14, flexWrap: "wrap" }}>
        <div style={{ fontSize: 19, fontWeight: 800, color: "#0f3171" }}>🎯 Seleção e Recrutamento</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {podeRecrutar && (
            <button onClick={copiarLinkPortal} title="Copia o link público (/vagas) para os candidatos escolherem a cidade e enviarem o currículo" style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "7px 14px", borderRadius: 10, border: "1px solid #f97316", background: "rgba(249,115,22,.10)", color: "#ea580c", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
              🔗 {portalCopiado ? "Link copiado!" : "Copiar link de candidatura"}
            </button>
          )}
          {canNovaVaga && (
            <button onClick={abrirModalVaga} style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "7px 14px", borderRadius: 10, border: "none", background: "#0f3171", color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer", boxShadow: "0 10px 22px rgba(15,49,113,.18)" }}>
              + Nova Solicitação
            </button>
          )}
        </div>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: "auto", padding: "20px 24px 24px" }}>

        {/* KPIs */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(6,1fr)", gap: 12, marginBottom: 20 }}>
          {[
            { label: "Total",            val: stats.total,           color: "#0f3171" },
            { label: "Pend. Operacional",val: stats.pendentes,       color: "#f59e0b" },
            { label: "Pend. Recrutamento",val: stats.ag_treinamentos, color: "#8b5cf6" },
            { label: "Em Processo",      val: stats.em_processo,     color: "#3b82f6" },
            { label: "Concluídas",       val: stats.contratados,     color: "#16a34a" },
            { label: "Reprovadas",       val: stats.reprovadas,      color: "#dc2626" },
          ].map(k => (
            <div key={k.label} className="rec-kpi">
              <div style={{ fontSize: 10, color: "#94a3b8", textTransform: "uppercase", letterSpacing: ".7px", marginBottom: 6, fontWeight: 700 }}>{k.label}</div>
              <div style={{ fontSize: 26, fontWeight: 800, color: k.color }}>{k.val}</div>
            </div>
          ))}
        </div>

        {/* Filtro de Contratos */}
        <div style={{ position: "relative", marginBottom: 12, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <button onClick={() => setShowContratoFiltro(v => !v)} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 14px", borderRadius: 10, border: "1px solid #e2e8f0", background: contratoFiltro.length ? "#0f3171" : "#fff", color: contratoFiltro.length ? "#fff" : "#475569", fontSize: 12, fontWeight: 700, cursor: "pointer", boxShadow: "0 8px 24px rgba(15,23,42,.06)" }}>
            🗂 Filtros · Contratos{contratoFiltro.length ? ` (${contratoFiltro.length})` : ""} ▾
          </button>
          {contratoFiltro.length > 0 && (
            <button onClick={() => { setContratoFiltro([]); setPage(1); }} style={{ background: "none", border: "none", color: "#94a3b8", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>limpar</button>
          )}
          {showContratoFiltro && (
            <>
              <div onClick={() => setShowContratoFiltro(false)} style={{ position: "fixed", inset: 0, zIndex: 40 }} />
              <div style={{ position: "absolute", top: "100%", left: 0, zIndex: 50, marginTop: 6, background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, boxShadow: "0 16px 40px rgba(15,23,42,.16)", padding: 10, width: 340, maxWidth: "90vw", maxHeight: 360, overflowY: "auto" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8, padding: "0 4px" }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: ".5px" }}>Mostrar só estes contratos</span>
                  {contratoFiltro.length > 0 && <button onClick={() => { setContratoFiltro([]); setPage(1); }} style={{ background: "none", border: "none", color: "#0f3171", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>Limpar</button>}
                </div>
                {contratoCounts.length === 0 ? (
                  <div style={{ fontSize: 12, color: "#94a3b8", padding: "8px 6px" }}>Nenhum contrato com solicitação.</div>
                ) : contratoCounts.map(c => {
                  const checked = contratoFiltro.includes(c.contrato);
                  return (
                    <label key={c.contrato} style={{ display: "flex", alignItems: "center", gap: 9, padding: "7px 6px", borderRadius: 8, cursor: "pointer", background: checked ? "#eef4ff" : "transparent" }}>
                      <input type="checkbox" checked={checked} onChange={() => { setContratoFiltro(prev => checked ? prev.filter(x => x !== c.contrato) : [...prev, c.contrato]); setPage(1); }} style={{ width: 15, height: 15, accentColor: "#0f3171", cursor: "pointer" }} />
                      <span style={{ flex: 1, fontSize: 13, color: "#0f172a", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.contrato}</span>
                      <span style={{ fontSize: 11, fontWeight: 800, color: "#0f3171", background: "#fff", border: "1px solid #dbe4f0", borderRadius: 20, padding: "1px 9px", minWidth: 22, textAlign: "center" }}>{c.n}</span>
                    </label>
                  );
                })}
              </div>
            </>
          )}
        </div>

        {/* Tabela View */}
        {view === "tabela" && (
          <>
            {/* Filtros de status (linha única) */}
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 14 }}>
              {[
                { label: "Todas", val: "" },
                { label: "Pendente Operacional", val: "Pendente Operacional" },
                { label: "Pendente Recrutamento", val: "Pendente Recrutamento" },
                { label: "Em Processo", val: "em_processo" },
                { label: "Concluídas", val: "concluido" },
                { label: "Reprovados", val: "Reprovada" },
              ].map(p => (
                <button key={p.val} onClick={() => { setStatusFilter(p.val); setPage(1); }} style={{ padding: "5px 13px", borderRadius: 20, border: "1px solid #e2e8f0", background: statusFilter === p.val ? "#0f3171" : "#fff", color: statusFilter === p.val ? "#fff" : "#94a3b8", fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
                  {p.label}
                </button>
              ))}
            </div>

            {/* Busca */}
            <div style={{ marginBottom: 10 }}>
              <input style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, color: "#0f172a", fontSize: 12, padding: "9px 12px", outline: "none", width: "100%", maxWidth: 400, boxShadow: "0 8px 24px rgba(15,23,42,.06)" }}
                placeholder="Buscar por cargo, contrato, cidade..."
                onChange={e => debounceSearch(e.target.value)} />
            </div>

            {/* Tabela */}
            <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 18, overflow: "hidden", boxShadow: "0 8px 24px rgba(15,23,42,.06)" }}>
              {loading ? (
                <div style={{ padding: "60px 20px", textAlign: "center", color: "#94a3b8" }}>Carregando...</div>
              ) : items.length === 0 ? (
                <div style={{ padding: "60px 20px", textAlign: "center", color: "#94a3b8" }}>Nenhuma solicitação encontrada.</div>
              ) : (
                <table className="rec-table">
                  <thead>
                    <tr>
                      <th>#</th><th>Contrato</th><th>Cargo</th><th>Cidade</th>
                      <th>Status</th><th>Urgência</th><th>Solicitante</th><th>Data</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map(item => (
                      <tr key={item.id} onClick={() => verDetalhe(item.id)}>
                        <td style={{ color: "#94a3b8", fontSize: 11 }}>#{item.id}</td>
                        <td style={{ fontWeight: 600, color: "#0f172a" }}>{item.contrato || "—"}</td>
                        <td>{item.cargo || "—"}</td>
                        <td>{item.cidade || "—"}</td>
                        <td><span className={`rec-badge ${badgeStatusCls(item.status)}`}>{item.status || "—"}</span></td>
                        <td>{item.grau_urgencia ? <span className={`rec-badge ${badgeUrgCls(item.grau_urgencia)}`}>{item.grau_urgencia.startsWith("Alta") ? "⚡ Alta" : item.grau_urgencia}</span> : "—"}</td>
                        <td>{item.solicitante_nome || "—"}</td>
                        <td style={{ color: "#94a3b8", fontSize: 11 }}>{fmtDt(item.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {/* Paginação */}
            {pages > 1 && (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, marginTop: 16 }}>
                <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1} style={{ padding: "5px 10px", border: "1px solid #e2e8f0", borderRadius: 8, background: "#fff", cursor: page <= 1 ? "default" : "pointer", opacity: page <= 1 ? .35 : 1 }}>‹ Anterior</button>
                <span style={{ fontSize: 12, color: "#94a3b8" }}>Página {page} de {pages} ({total} registros)</span>
                <button onClick={() => setPage(p => Math.min(pages, p + 1))} disabled={page >= pages} style={{ padding: "5px 10px", border: "1px solid #e2e8f0", borderRadius: 8, background: "#fff", cursor: page >= pages ? "default" : "pointer", opacity: page >= pages ? .35 : 1 }}>Próxima ›</button>
              </div>
            )}
          </>
        )}
      </div>

      {/* ── Drawer Detalhe ── */}
      {drawerId && (
        <div className="rec-drawer-ov" onClick={e => { if (e.target === e.currentTarget) fecharDrawer(); }}>
          <div className="rec-drawer">
            {/* Head */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 20px", borderBottom: "1px solid #e2e8f0", flexShrink: 0, gap: 10, flexWrap: "wrap", background: "#f8fafc" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <span style={{ fontSize: 13, color: "#94a3b8", fontWeight: 700 }}>Solicitação #{drawerId}</span>
                {drawerSol && <span className={`rec-badge ${badgeStatusCls(drawerSol.status)}`}>{drawerSol.status}</span>}
                {drawerSol?.grau_urgencia && <span className={`rec-badge ${badgeUrgCls(drawerSol.grau_urgencia)}`}>{drawerSol.grau_urgencia.startsWith("Alta") ? "⚡ Alta" : drawerSol.grau_urgencia}</span>}
              </div>
              <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                {drawerSol && renderActions(drawerSol)}
                <button onClick={fecharDrawer} style={{ background: "none", border: "none", color: "#94a3b8", fontSize: 20, cursor: "pointer", padding: "4px 8px", lineHeight: 1 }}>✕</button>
              </div>
            </div>

            {/* Body */}
            <div style={{ flex: 1, display: "flex", overflow: "hidden", minHeight: 0 }}>
              {/* Left: detalhe + kanban de candidatos */}
              <div style={{ flex: 1, overflowY: "auto", minWidth: 0 }}>
                {drawerSol ? (<>
                  {renderDetalhe(drawerSol)}
                  {STATUS_PROCESSO.includes(drawerSol.status) && (
                    <div style={{ padding: "0 20px 20px" }}>
                      <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 12, padding: "12px 14px" }}>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                          <div style={{ fontSize: 13, fontWeight: 800, color: "#0f3171", display: "flex", alignItems: "center", gap: 8 }}>
                            👥 Candidatos no processo
                            <span style={{ fontSize: 11, fontWeight: 700, background: "#eef4ff", border: "1px solid #dbe4f0", borderRadius: 20, padding: "1px 9px", color: "#0f3171" }}>{candidatos.length}</span>
                          </div>
                          <button onClick={abrirKanbanCand} style={{ padding: "6px 12px", borderRadius: 8, border: "none", background: "#0f3171", color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>Abrir kanban →</button>
                        </div>
                        {/* Status do Candidato (resumo) — segundo trilho */}
                        {candidatos.length > 0 && (
                          <div style={{ marginTop: 10, display: "flex", flexWrap: "wrap", gap: 6 }}>
                            {candidatos.map(c => {
                              const m = CAND_COL_COLORS[c.etapa_processo || "ENTRADA"] ?? CAND_COL_COLORS.ENTRADA;
                              return (
                                <span key={c.id} title={c.nome} style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 10.5, fontWeight: 700, padding: "3px 9px", borderRadius: 20, background: "#fff", border: `1px solid ${m.dot}33`, color: m.label }}>
                                  <span style={{ width: 6, height: 6, borderRadius: "50%", background: m.dot }} />
                                  {(c.nome || "—").split(" ")[0]} · {c.etapa_processo}
                                </span>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </>) : <div style={{ padding: 40, textAlign: "center", color: "#94a3b8" }}>Carregando...</div>}
              </div>

              {/* Right: chat */}
              <div style={{ width: 320, flexShrink: 0, display: "flex", flexDirection: "column", overflow: "hidden", borderLeft: "1px solid #e2e8f0", background: "#fff" }}>
                <div style={{ padding: "11px 14px", borderBottom: "1px solid #e2e8f0", fontSize: 13, fontWeight: 700, color: "#475569", flexShrink: 0, background: "#f8fafc", display: "flex", alignItems: "center", gap: 6 }}>
                  💬 Chat
                </div>
                <div className="rec-chat-msgs" style={{ background: "linear-gradient(180deg,#fff 0%,#f8fafc 100%)" }}>
                  {msgs.length === 0 ? (
                    <div style={{ textAlign: "center", color: "#94a3b8", fontSize: 12, padding: "24px 16px" }}>Nenhuma mensagem ainda.</div>
                  ) : msgs.map(m => {
                    const mine = m.autor_cpf === user?.email;
                    return (
                      <div key={m.id} className={`rec-cmsg ${mine ? "mine" : "theirs"}`}>
                        <div style={{ fontSize: 10, color: "#94a3b8", padding: "0 2px" }}>{m.is_treinamento ? "🎓 " : ""}{m.autor_nome}</div>
                        <div className={mine ? "rec-cbubble-mine" : "rec-cbubble-theirs"}>{m.mensagem}</div>
                        <div style={{ fontSize: 10, color: "#94a3b8", padding: "0 2px" }}>{fmtDt(m.created_at)}</div>
                      </div>
                    );
                  })}
                  <div ref={chatEndRef} />
                </div>
                {!isRH && (
                  <div style={{ padding: "10px 12px", borderTop: "1px solid #e2e8f0", display: "flex", flexDirection: "column", gap: 7, flexShrink: 0, background: "#f8fafc" }}>
                    <textarea value={chatInput} onChange={e => setChatInput(e.target.value)} placeholder="Escreva uma mensagem..." style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, color: "#0f172a", fontSize: 13, padding: "8px 12px", outline: "none", resize: "none", fontFamily: "inherit", minHeight: 60, width: "100%" }} />
                    <button onClick={enviarMsg} disabled={sendingMsg || !chatInput.trim()} style={{ background: "#0f3171", color: "#fff", border: "none", borderRadius: 10, padding: "7px 14px", fontSize: 12, fontWeight: 700, display: "flex", alignItems: "center", gap: 5, cursor: "pointer", alignSelf: "flex-end", opacity: sendingMsg || !chatInput.trim() ? .5 : 1 }}>
                      ➤ Enviar
                    </button>
                  </div>
                )}
              </div>
            </div>

            <div style={{ padding: "10px 20px", borderTop: "1px solid #e2e8f0", flexShrink: 0, display: "flex", justifyContent: "flex-end", background: "#f8fafc" }}>
              <button onClick={fecharDrawer} style={{ padding: "7px 14px", borderRadius: 10, border: "1px solid #e2e8f0", background: "#fff", color: "#475569", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>Fechar</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal Reprovar ── */}
      {modalReprovar && (
        <div className="rec-modal-ov">
          <div className="rec-modal">
            <button onClick={() => setModalReprovar(false)} style={{ position: "absolute", top: 14, right: 14, background: "none", border: "none", color: "#94a3b8", fontSize: 20, cursor: "pointer" }}>✕</button>
            <div style={{ fontSize: 17, fontWeight: 800, marginBottom: 4 }}>Reprovar Solicitação</div>
            <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 18 }}>Informe o motivo da reprovação.</div>
            <div className="rec-fg">
              <label>Motivo da reprovação *</label>
              <textarea className="rec-fi" rows={4} placeholder="Descreva o motivo..." value={reprovarMotivo} onChange={e => setReprovarMotivo(e.target.value)} />
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button onClick={() => setModalReprovar(false)} style={{ padding: "7px 14px", borderRadius: 10, border: "1px solid #e2e8f0", background: "#fff", color: "#475569", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>Cancelar</button>
              <button onClick={confirmarReprovar} style={{ padding: "7px 14px", borderRadius: 10, border: "none", background: "#dc2626", color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>Confirmar Reprovação</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal Status ── */}
      {modalStatus && (
        <div className="rec-modal-ov">
          <div className="rec-modal">
            <button onClick={() => setModalStatus(false)} style={{ position: "absolute", top: 14, right: 14, background: "none", border: "none", color: "#94a3b8", fontSize: 20, cursor: "pointer" }}>✕</button>
            <div style={{ fontSize: 17, fontWeight: 800, marginBottom: 4 }}>Atualizar Status — #{drawerId}</div>
            <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 18 }}>Selecione o novo status da solicitação.</div>
            <div className="rec-fg">
              <label>Status</label>
              <select className="rec-fi" value={statusSel} onChange={e => { setStatusSel(e.target.value); setStatusExtra({}); }}>
                <option value="">— Selecione —</option>
                {["Vaga Aberta","Seleção de Currículos","Entrevistas","Entrevista com Gestor","Entrevista com Psicóloga","Aguardando Documentação","Aguardando ASO","Funcionário Selecionado","Contratado"].map(s => <option key={s}>{s}</option>)}
              </select>
            </div>
            {statusSel === "Funcionário Selecionado" && (
              <div className="rec-fg">
                <label>Nome do Funcionário Selecionado *</label>
                <input className="rec-fi" placeholder="Nome completo" value={statusExtra.nome ?? ""} onChange={e => setStatusExtra(x => ({ ...x, nome: e.target.value }))} />
              </div>
            )}
            {statusSel === "Contratado" && (<>
              <div className="rec-fg"><label>Nome Completo do Contratado *</label><input className="rec-fi" placeholder="Nome completo" value={statusExtra.nome ?? ""} onChange={e => setStatusExtra(x => ({ ...x, nome: e.target.value }))} /></div>
              <div className="rec-fg"><label>Contato *</label><input className="rec-fi" placeholder="Telefone / e-mail" value={statusExtra.contato ?? ""} onChange={e => setStatusExtra(x => ({ ...x, contato: e.target.value }))} /></div>
              <div className="rec-fg"><label>Data de Início (DD/MM/AAAA) *</label><input className="rec-fi" placeholder="DD/MM/AAAA" maxLength={10} value={statusExtra.data ?? ""} onChange={e => setStatusExtra(x => ({ ...x, data: e.target.value }))} /></div>
            </>)}
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 4 }}>
              <button onClick={() => setModalStatus(false)} style={{ padding: "7px 14px", borderRadius: 10, border: "1px solid #e2e8f0", background: "#fff", color: "#475569", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>Cancelar</button>
              <button onClick={confirmarStatus} style={{ padding: "7px 14px", borderRadius: 10, border: "none", background: "#0f3171", color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>Salvar Status</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal Link ── */}
      {modalLink && drawerSol && (
        <div className="rec-modal-ov" onClick={e => { if (e.target === e.currentTarget) setModalLink(false); }}>
          <div className="rec-modal">
            <button onClick={() => setModalLink(false)} style={{ position: "absolute", top: 14, right: 14, background: "none", border: "none", color: "#94a3b8", fontSize: 20, cursor: "pointer" }}>✕</button>
            <div style={{ fontSize: 17, fontWeight: 800, marginBottom: 4 }}>Link para Candidatura</div>
            <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 14 }}>Compartilhe este link para receber currículos.</div>
            <div style={{ marginBottom: 16, padding: "12px 14px", background: "rgba(15,49,113,.07)", border: "1px solid rgba(15,49,113,.18)", borderRadius: 10, fontSize: 13 }}>
              <strong>{drawerSol.cargo}</strong>{drawerSol.cidade ? ` · 📍 ${drawerSol.cidade}` : ""}
            </div>
            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".5px", color: "#94a3b8", textTransform: "uppercase", display: "block", marginBottom: 6 }}>Link de candidatura</label>
              <div style={{ display: "flex", gap: 8 }}>
                <input readOnly value={linkUrl} onClick={e => (e.target as HTMLInputElement).select()} style={{ flex: 1, background: "rgba(255,255,255,.04)", border: "1px solid #e2e8f0", borderRadius: 10, padding: "10px 14px", fontSize: 12, color: "#f97316", fontFamily: "monospace", outline: "none" }} />
                <button onClick={() => { navigator.clipboard.writeText(linkUrl); setLinkCopiado(true); setTimeout(() => setLinkCopiado(false), 3000); }} style={{ flexShrink: 0, padding: "0 18px", background: linkCopiado ? "linear-gradient(135deg,#22c55e,#16a34a)" : "linear-gradient(135deg,#0f3171,#1e4a8a)", border: "none", borderRadius: 10, color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
                  {linkCopiado ? "✓ Copiado!" : "Copiar"}
                </button>
              </div>
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button onClick={() => setModalLink(false)} style={{ padding: "7px 14px", borderRadius: 10, border: "1px solid #e2e8f0", background: "#fff", color: "#475569", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>Fechar</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal Mover Candidato (kanban interno) ── */}
      {candModal && (
        <div className="rec-modal-ov" style={{ zIndex: 850 }}>
          <div className="rec-modal" style={{ maxWidth: 420 }}>
            <button onClick={() => { setCandModal(null); setCandObs(""); }} style={{ position: "absolute", top: 14, right: 14, background: "none", border: "none", color: "#94a3b8", fontSize: 20, cursor: "pointer" }}>✕</button>
            <div style={{ fontSize: 17, fontWeight: 800, marginBottom: 4 }}>
              {candModal.novaEtapa === "Reprovado" ? "Reprovar candidato" : `Mover para "${candModal.novaEtapa}"`}
            </div>
            <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 14 }}>{candModal.nome}</div>
            <div className="rec-fg">
              <label>{candModal.novaEtapa === "Reprovado" ? "Motivo *" : "Observação (opcional)"}</label>
              <textarea className="rec-fi" rows={3} placeholder={candModal.novaEtapa === "Reprovado" ? "Descreva o motivo..." : "Observação da etapa..."} value={candObs} onChange={e => setCandObs(e.target.value)} />
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 4 }}>
              <button onClick={() => { setCandModal(null); setCandObs(""); }} style={{ padding: "7px 14px", borderRadius: 10, border: "1px solid #e2e8f0", background: "#fff", color: "#475569", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>Cancelar</button>
              <button onClick={confirmarMoverCand} style={{ padding: "7px 14px", borderRadius: 10, border: "none", background: candModal.novaEtapa === "Reprovado" ? "#dc2626" : "#0f3171", color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>Confirmar</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal: Roteiro de Entrevista ── */}
      {roteiroModal && (
        <div className="rec-modal-ov" style={{ zIndex: 850 }}>
          <div className="rec-modal" style={{ maxWidth: 720 }}>
            <button onClick={() => { setRoteiroModal(null); setRoteiroRows([]); }} style={{ position: "absolute", top: 14, right: 14, background: "none", border: "none", color: "#94a3b8", fontSize: 20, cursor: "pointer" }}>✕</button>
            <div style={{ fontSize: 17, fontWeight: 800, marginBottom: 4 }}>📋 Roteiro de Entrevista</div>
            <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 14 }}>{roteiroModal.nome} · {roteiroModal.etapa === "ENTREVISTA GESTOR" ? "Entrevista com Gestor" : "Entrevista"}</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10, maxHeight: "56vh", overflowY: "auto" }}>
              {roteiroRows.map((r, i) => {
                const upd = (k: "pergunta" | "resposta", v: string) => setRoteiroRows(rs => rs.map((x, j) => j === i ? { ...x, [k]: v } : x));
                return (
                  <div key={i} style={{ border: "1px solid #e2e8f0", borderRadius: 10, padding: "10px 12px", background: "#fcfdff" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <input value={r.pergunta} onChange={e => upd("pergunta", e.target.value)} placeholder="Pergunta" style={{ flex: 1, border: "none", background: "transparent", fontSize: 13, fontWeight: 700, color: "#0f172a", outline: "none" }} />
                      <button onClick={() => setRoteiroRows(rs => rs.filter((_, j) => j !== i))} title="Remover" style={{ background: "none", border: "none", color: "#dc2626", cursor: "pointer", fontSize: 14 }}>✕</button>
                    </div>
                    <textarea value={r.resposta} onChange={e => upd("resposta", e.target.value)} placeholder="Resposta / anotações" rows={2} style={{ width: "100%", marginTop: 6, border: "1px solid #e2e8f0", borderRadius: 8, padding: "7px 9px", fontSize: 13, outline: "none", fontFamily: "inherit", resize: "vertical" }} />
                  </div>
                );
              })}
            </div>
            <button onClick={() => setRoteiroRows(rs => [...rs, novaLinhaRot()])} style={{ marginTop: 10, padding: "6px 12px", borderRadius: 8, border: "1px dashed #cbd5e1", background: "#fff", color: "#0f3171", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>+ Adicionar pergunta</button>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 16 }}>
              <button onClick={() => { setRoteiroModal(null); setRoteiroRows([]); }} style={{ padding: "7px 14px", borderRadius: 10, border: "1px solid #e2e8f0", background: "#fff", color: "#475569", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>Cancelar</button>
              <button onClick={salvarRoteiro} style={{ padding: "7px 14px", borderRadius: 10, border: "none", background: "#0f3171", color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>Salvar roteiro</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Painel Kanban de Candidatos (janela central ~92%) ── */}
      {showKanbanCand && (
        <div style={{ position: "fixed", inset: 0, zIndex: 800, background: "rgba(15,23,42,.48)", backdropFilter: "blur(5px)", display: "flex", alignItems: "center", justifyContent: "center" }}
          onClick={e => { if (e.target === e.currentTarget) setShowKanbanCand(false); }}>
          <div style={{ width: "94vw", height: "92vh", background: "#fff", borderRadius: 16, border: "1px solid #e2e8f0", display: "flex", flexDirection: "column", overflow: "hidden", boxShadow: "0 24px 70px rgba(15,23,42,.3)" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 22px", borderBottom: "1px solid #e2e8f0", flexShrink: 0, background: "#f8fafc", gap: 12, flexWrap: "wrap" }}>
              <div style={{ fontSize: 16, fontWeight: 800, color: "#0f172a", display: "flex", alignItems: "center", gap: 10 }}>
                👥 Processo Seletivo — Candidatos
                <span style={{ fontSize: 12, color: "#94a3b8" }}>{drawerSol?.cargo} · #{drawerId}</span>
              </div>
              <button onClick={() => setShowKanbanCand(false)} style={{ background: "none", border: "none", color: "#94a3b8", fontSize: 20, cursor: "pointer" }}>✕</button>
            </div>
            <div style={{ flex: 1, minHeight: 0, padding: 18, display: "flex", flexDirection: "column" }}>
              {renderCandidatosKanban()}
            </div>
          </div>
        </div>
      )}

      {/* ── Painel Histórico (janela dedicada) ── */}
      {showHistorico && (
        <div className="cv-panel-ov" onClick={e => { if (e.target === e.currentTarget) setShowHistorico(false); }}>
          <div className="cv-panel" style={{ maxWidth: 720 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 22px", borderBottom: "1px solid #e2e8f0", flexShrink: 0, background: "#f8fafc", gap: 12, flexWrap: "wrap" }}>
              <div style={{ fontSize: 16, fontWeight: 800, color: "#0f172a", display: "flex", alignItems: "center", gap: 10 }}>
                📜 Histórico da Solicitação
                <span style={{ fontSize: 12, color: "#94a3b8" }}>#{drawerId}</span>
              </div>
              <button onClick={() => setShowHistorico(false)} style={{ background: "none", border: "none", color: "#94a3b8", fontSize: 20, cursor: "pointer" }}>✕</button>
            </div>
            <div style={{ flex: 1, overflowY: "auto", padding: 22 }}>
              {renderHistorico()}
            </div>
          </div>
        </div>
      )}

      {/* ── Painel Currículos ── */}
      {showCurriculos && (
        <div className="cv-panel-ov" onClick={e => { if (e.target === e.currentTarget) setShowCurriculos(false); }}>
          <div className="cv-panel">
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 22px", borderBottom: "1px solid #e2e8f0", flexShrink: 0, background: "#f8fafc", gap: 12, flexWrap: "wrap" }}>
              <div style={{ fontSize: 16, fontWeight: 800, color: "#0f172a", display: "flex", alignItems: "center", gap: 10 }}>
                Currículos Recebidos
                <span style={{ padding: "2px 10px", borderRadius: 20, fontSize: 11, fontWeight: 700, background: "rgba(249,115,22,.12)", color: "#f97316", border: "1px solid rgba(249,115,22,.18)" }}>{curriculos.length}</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 12, color: "#94a3b8" }}>{drawerSol?.cargo} — #{drawerId}</span>
                <button onClick={() => setShowCurriculos(false)} style={{ background: "none", border: "none", color: "#94a3b8", fontSize: 20, cursor: "pointer" }}>✕</button>
              </div>
            </div>
            <div style={{ flex: 1, overflowY: "auto", padding: 22 }}>
              {curriculos.length === 0 ? (
                <div style={{ textAlign: "center", padding: "60px 20px", color: "#94a3b8" }}>
                  <div style={{ fontSize: 40, marginBottom: 12 }}>📄</div>
                  <div style={{ fontSize: 14, marginBottom: 4 }}>Nenhum currículo recebido ainda.</div>
                  <div style={{ fontSize: 12 }}>Com a vaga em <b>“Seleção de Candidato”</b>, ela aparece no portal público <b>/vagas</b> para receber candidaturas.</div>
                </div>
              ) : (
                <div className="cv-grid">
                  {cvGrupos.map(g => {
                    const cv = g.latest;
                    const digits = g.digits;
                    const emps = empCpf[digits] || [];
                    const hasEmp = emps.length > 0;
                    const bl = digits ? blacklist[digits] : undefined;
                    return (
                    <div key={g.items[0].id} className="cv-card" style={{ position: "relative", outline: bl ? "2px solid #fecaca" : undefined, outlineOffset: -1 }}>
                      <div style={{ height: 3, background: cv.origem === "whatsapp" ? "linear-gradient(90deg,#22c55e,#16a34a)" : "linear-gradient(90deg,#0f3171,#1e4a8a)" }}></div>
                      <div style={{ position: "absolute", top: 9, right: 9, zIndex: 2, display: "flex", gap: 6 }}>
                        {hasEmp && <span title="Já tem cadastro na empresa (EMPREGADOS)" style={{ display: "inline-flex", alignItems: "center", gap: 4, background: "#0f3171", color: "#fff", borderRadius: 8, padding: "3px 8px", fontSize: 10, fontWeight: 800, boxShadow: "0 6px 16px rgba(15,49,113,.3)" }}>🏦 NO BANCO</span>}
                        {bl && <span title={`Restrição: ${bl.motivo}`} style={{ display: "inline-flex", alignItems: "center", gap: 4, background: "#d97706", color: "#fff", borderRadius: 8, padding: "3px 8px", fontSize: 10, fontWeight: 800, boxShadow: "0 6px 16px rgba(217,119,6,.32)" }}>⚠️ POSSUI RESTRIÇÕES</span>}
                      </div>
                      <div style={{ padding: "16px 18px", flex: 1, display: "flex", flexDirection: "column", gap: 10 }}>
                        <span style={{ width: "fit-content", display: "inline-flex", alignItems: "center", gap: 5, fontSize: 10, fontWeight: 700, letterSpacing: ".5px", textTransform: "uppercase", padding: "3px 9px", borderRadius: 4, background: cv.origem === "whatsapp" ? "rgba(34,197,94,.1)" : "rgba(249,115,22,.12)", color: cv.origem === "whatsapp" ? "#22c55e" : "#f97316", border: `1px solid ${cv.origem === "whatsapp" ? "rgba(34,197,94,.2)" : "rgba(249,115,22,.18)"}` }}>
                          {cv.origem === "whatsapp" ? "WhatsApp" : "Portal"}
                        </span>
                        {cv.nome ? <div style={{ fontSize: 15, fontWeight: 700, color: "#0f172a" }}>{cv.nome}</div> : <div style={{ fontSize: 14, fontWeight: 600, color: "#94a3b8", fontStyle: "italic" }}>Nome não informado</div>}
                        {g.items.length > 1 && <span style={{ width: "fit-content", fontSize: 11, fontWeight: 700, color: "#0f3171", background: "#eef4ff", border: "1px solid #dbe4f0", borderRadius: 20, padding: "2px 10px" }}>📩 {g.items.length} candidaturas enviadas</span>}
                        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                          {cv.telefone && <div style={{ fontSize: 12, color: "#475569", display: "flex", gap: 7 }}><span style={{ fontSize: 10, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", minWidth: 50 }}>Fone</span>{cv.telefone}</div>}
                          {cv.email    && <div style={{ fontSize: 12, color: "#475569", display: "flex", gap: 7 }}><span style={{ fontSize: 10, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", minWidth: 50 }}>Email</span>{cv.email}</div>}
                          {cv.cpf      && <div style={{ fontSize: 12, color: "#475569", display: "flex", gap: 7 }}><span style={{ fontSize: 10, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", minWidth: 50 }}>CPF</span>{cv.cpf}</div>}
                        </div>
                        {bl && <div style={{ fontSize: 11.5, color: "#92400e", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 7, padding: "8px 10px" }}><b>⚠️ Possui restrições.</b> {bl.motivo} <span style={{ color: "#b45309" }}>(definido pelo Jurídico)</span></div>}
                        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                          <div style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: ".5px", color: "#94a3b8" }}>Currículos enviados</div>
                          {g.items.map(item => (
                            <div key={item.id} style={{ display: "flex", alignItems: "center", gap: 8, border: "1px solid #e2e8f0", borderRadius: 8, padding: "7px 10px", background: "#fcfdff" }}>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontSize: 11, color: "#94a3b8" }}>{fmtDt(item.created_at)}</div>
                                {item.mensagem && <div style={{ fontSize: 12, color: "#475569", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.mensagem}</div>}
                              </div>
                              {item.tem_pdf ? <button onClick={() => baixarCurriculo(item)} style={{ flexShrink: 0, display: "inline-flex", alignItems: "center", gap: 4, padding: "5px 10px", borderRadius: 6, background: "rgba(249,115,22,.12)", border: "1px solid rgba(249,115,22,.25)", color: "#f97316", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>↓ Baixar</button> : <span style={{ flexShrink: 0, fontSize: 11, color: "#94a3b8" }}>Sem arquivo</span>}
                            </div>
                          ))}
                        </div>
                      </div>
                      <div style={{ padding: "10px 14px", borderTop: "1px solid #e2e8f0", display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 8, background: "#fcfdff", flexWrap: "wrap" }}>
                        {drawerSol && STATUS_PROCESSO.includes(drawerSol.status) && podeRecrutar && (
                          g.emProcesso
                            ? <span style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "5px 11px", borderRadius: 6, background: "rgba(34,197,94,.1)", border: "1px solid rgba(34,197,94,.25)", color: "#16a34a", fontSize: 11, fontWeight: 700 }}>✓ No processo</span>
                            : <button onClick={() => selecionarCandidato(cv)} title={bl ? "Atenção: CPF possui restrições (Jurídico)" : ""} style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "5px 11px", borderRadius: 6, background: "#16a34a", border: "none", color: "#fff", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>✓ Selecionar candidato</button>
                        )}
                        <button onClick={() => setDetalheEmp({ nome: cv.nome || "Candidato", cpf: cv.cpf || "", telefone: cv.telefone, email: cv.email, itens: g.items, emps })} style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "5px 11px", borderRadius: 6, background: "rgba(15,49,113,.08)", border: "1px solid rgba(15,49,113,.25)", color: "#0f3171", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>{hasEmp ? `🏦 Ver detalhes (${emps.length})` : "Ver detalhes"}</button>
                      </div>
                    </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Modal: bloquear CPF (lista negra) ── */}
      {blockModal && (
        <div className="rec-modal-ov" style={{ zIndex: 900 }} onClick={e => { if (e.target === e.currentTarget) setBlockModal(null); }}>
          <div className="rec-modal" style={{ maxWidth: 460 }} onClick={e => e.stopPropagation()}>
            <button onClick={() => setBlockModal(null)} style={{ position: "absolute", top: 14, right: 14, background: "none", border: "none", color: "#94a3b8", fontSize: 20, cursor: "pointer" }}>✕</button>
            <div style={{ fontSize: 17, fontWeight: 800, marginBottom: 4, color: "#dc2626" }}>🚫 Adicionar CPF à lista negra</div>
            <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 14 }}>CPF {blockModal.fmt} — informe o motivo do bloqueio.</div>
            <div className="rec-fg"><label>Motivo *</label>
              <textarea className="rec-fi" rows={3} value={blockMotivo} onChange={e => setBlockMotivo(e.target.value)} placeholder="Ex.: histórico de faltas, desligamento por justa causa, etc." /></div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 8 }}>
              <button onClick={() => setBlockModal(null)} style={{ padding: "8px 14px", borderRadius: 10, border: "1px solid #e2e8f0", background: "#fff", color: "#475569", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>Cancelar</button>
              <button onClick={confirmarBloqueio} style={{ padding: "8px 14px", borderRadius: 10, border: "none", background: "#dc2626", color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>Bloquear CPF</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal: detalhes dos cadastros em EMPREGADOS ── */}
      {detalheEmp && (
        <div className="rec-modal-ov" style={{ zIndex: 900 }} onClick={e => { if (e.target === e.currentTarget) setDetalheEmp(null); }}>
          <div className="rec-modal" style={{ maxWidth: 580 }} onClick={e => e.stopPropagation()}>
            <button onClick={() => setDetalheEmp(null)} style={{ position: "absolute", top: 14, right: 14, background: "none", border: "none", color: "#94a3b8", fontSize: 20, cursor: "pointer" }}>✕</button>
            <div style={{ fontSize: 17, fontWeight: 800, marginBottom: 2 }}>🪪 Detalhes do candidato</div>
            <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 14 }}>{detalheEmp.nome} · CPF {detalheEmp.cpf || "—"}</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 18, maxHeight: "64vh", overflowY: "auto" }}>

              {/* Dados enviados na candidatura */}
              <div>
                <div style={{ fontSize: 11, fontWeight: 800, textTransform: "uppercase", letterSpacing: ".5px", color: "#0f3171", marginBottom: 8 }}>📩 Candidatura ({detalheEmp.itens.length} envio{detalheEmp.itens.length > 1 ? "s" : ""})</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "5px 16px", fontSize: 12, color: "#334155", marginBottom: 12 }}>
                  <div><span style={{ color: "#94a3b8", fontWeight: 700 }}>Nome: </span>{detalheEmp.nome || "—"}</div>
                  <div><span style={{ color: "#94a3b8", fontWeight: 700 }}>CPF: </span>{detalheEmp.cpf || "—"}</div>
                  <div><span style={{ color: "#94a3b8", fontWeight: 700 }}>Telefone: </span>{detalheEmp.telefone || "—"}</div>
                  <div><span style={{ color: "#94a3b8", fontWeight: 700 }}>E-mail: </span>{detalheEmp.email || "—"}</div>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {detalheEmp.itens.map(item => (
                    <div key={item.id} style={{ border: "1px solid #e2e8f0", borderRadius: 10, padding: "10px 12px", background: "#fcfdff" }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                        <span style={{ fontSize: 11, color: "#94a3b8" }}>Enviado em {fmtDt(item.created_at)}</span>
                        {item.tem_pdf ? <button onClick={() => baixarCurriculo(item)} style={{ flexShrink: 0, display: "inline-flex", alignItems: "center", gap: 4, padding: "5px 10px", borderRadius: 6, background: "rgba(249,115,22,.12)", border: "1px solid rgba(249,115,22,.25)", color: "#f97316", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>↓ Baixar currículo</button> : <span style={{ fontSize: 11, color: "#94a3b8" }}>Sem arquivo</span>}
                      </div>
                      {item.mensagem && <div style={{ fontSize: 12.5, color: "#475569", marginTop: 8, lineHeight: 1.55, whiteSpace: "pre-wrap" }}>{item.mensagem}</div>}
                    </div>
                  ))}
                </div>
              </div>

              {/* Dados pessoais do formulário (o que existir em qualquer envio) */}
              {(() => {
                const dg = (campo: string) => detalheEmp.itens.map((it: any) => it[campo]).find((v: any) => v || v === false);
                const linhas = ([
                  ["Nascimento", dg("data_nascimento") ? fmtDt(dg("data_nascimento")) : null],
                  ["RG", dg("rg")],
                  ["Sexo", dg("sexo")],
                  ["Nome da mãe", dg("nome_mae")],
                  ["Nome do pai", dg("nome_pai")],
                  ["Escolaridade", dg("escolaridade")],
                  ["Reside", dg("cidade_residencia")],
                  ["Deseja trabalhar", [dg("cidade_desejada"), dg("estado_desejado")].filter(Boolean).join("/")],
                  ["CNH", dg("possui_cnh")],
                  ["Disp. horários", dg("disponibilidade_horarios")],
                  ["Fim de semana", dg("disp_fim_semana")],
                  ["Experiência prévia", dg("experiencia_previa")],
                  ["Estrangeiro", dg("estrangeiro")],
                  ["Cargos de interesse", dg("cargos_interesse")],
                  ["Experiências", [dg("experiencia_1"), dg("experiencia_2"), dg("experiencia_3")].filter(Boolean).join(" · ")],
                ] as [string, any][]).filter(([, v]) => v || v === false);
                if (!linhas.length) return null;
                return (
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 800, textTransform: "uppercase", letterSpacing: ".5px", color: "#0f3171", marginBottom: 8 }}>🪪 Dados pessoais (formulário)</div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "5px 16px", fontSize: 12, color: "#334155" }}>
                      {linhas.map(([l, v]) => <div key={l}><span style={{ color: "#94a3b8", fontWeight: 700 }}>{l}: </span>{v === true ? "Sim" : v === false ? "Não" : v}</div>)}
                    </div>
                  </div>
                );
              })()}

              {/* Cadastros na empresa (EMPREGADOS) */}
              {detalheEmp.emps.length > 0 && (
                <div>
                  <div style={{ fontSize: 11, fontWeight: 800, textTransform: "uppercase", letterSpacing: ".5px", color: "#0f3171", marginBottom: 8 }}>🏦 Cadastros na empresa ({detalheEmp.emps.length})</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    {detalheEmp.emps.map((e, i) => {
                      const off = /demit|rescis|deslig|inativ/i.test(e.situacao || "");
                      return (
                        <div key={i} style={{ border: "1px solid #e2e8f0", borderRadius: 10, padding: "12px 14px", background: "#f8fbff" }}>
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                            <div style={{ fontSize: 14, fontWeight: 800, color: "#0f172a" }}>{e.cargo || "Cargo não informado"}</div>
                            {e.situacao && <span style={{ fontSize: 10, fontWeight: 800, padding: "2px 9px", borderRadius: 20, background: off ? "#fee2e2" : "#dcfce7", color: off ? "#b91c1c" : "#15803d" }}>{e.situacao}</span>}
                          </div>
                          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px 16px", marginTop: 10, fontSize: 12, color: "#334155" }}>
                            <div><span style={{ color: "#94a3b8", fontWeight: 700 }}>Admissão: </span>{e.admissao || "—"}</div>
                            <div><span style={{ color: "#94a3b8", fontWeight: 700 }}>Setor: </span>{e.setor || "—"}</div>
                            <div><span style={{ color: "#94a3b8", fontWeight: 700 }}>Empresa: </span>{e.empresa || "—"}</div>
                            <div><span style={{ color: "#94a3b8", fontWeight: 700 }}>Filial: </span>{e.filial || "—"}</div>
                            <div><span style={{ color: "#94a3b8", fontWeight: 700 }}>Perfil: </span>{e.perfil || "—"}</div>
                            <div><span style={{ color: "#94a3b8", fontWeight: 700 }}>Líder: </span>{e.lider || "—"}</div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Modal Nova Vaga (Wizard 3 etapas) ── */}
      {modalVaga && (
        <div className="rec-modal-ov">
          <div className="rec-modal" style={{ maxWidth: 600 }} onClick={e => e.stopPropagation()}>
            <button onClick={() => setModalVaga(false)} style={{ position: "absolute", top: 14, right: 14, background: "none", border: "none", color: "#94a3b8", fontSize: 20, cursor: "pointer" }}>✕</button>
            <div style={{ fontSize: 17, fontWeight: 800, marginBottom: 4 }}>Solicitar Nova Vaga</div>
            <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 14 }}>
              {vagaStep === 1 ? "Etapa 1 de 3 — Identificação da Vaga" : vagaStep === 2 ? "Etapa 2 de 3 — Detalhes do Posto" : "Etapa 3 de 3 — Requisitos e Urgência"}
            </div>

            {/* Progress */}
            <div style={{ display: "flex", gap: 6, marginBottom: 16 }}>
              {[1,2,3].map(i => (
                <div key={i} style={{ flex: 1, height: 3, borderRadius: 2, background: i < vagaStep ? "#16a34a" : i === vagaStep ? "#0f3171" : "#dbe4f0", transition: "background .2s" }}></div>
              ))}
            </div>

            {/* Step 1 */}
            {vagaStep === 1 && (<>
              <div className="rec-fg">
                <label>Motivo da Vaga *</label>
                <select className="rec-fi" value={vaga.motivo_vaga} onChange={e => setVaga(v => ({ ...v, motivo_vaga: e.target.value }))}>
                  <option value="">— Selecione —</option>
                  {["Admissão","Substituição","Expansão","Transferência","Retorno"].map(o => <option key={o}>{o}</option>)}
                </select>
              </div>
              {vaga.motivo_vaga === "Substituição" && (
                <div className="rec-fg" style={{ position: "relative" }}
                  onBlur={() => setTimeout(() => setShowEmpDrop(false), 150)}>
                  <label>Colaborador a Substituir</label>
                  <input
                    className="rec-fi"
                    placeholder="Buscar colaborador..."
                    value={empSearch}
                    autoComplete="off"
                    onChange={e => {
                      const v = e.target.value;
                      setEmpSearch(v);
                      setVaga(prev => ({ ...prev, nome_substituido: v }));
                      if (empDebounce.current) clearTimeout(empDebounce.current);
                      if (v.trim().length >= 2) {
                        setShowEmpDrop(true);
                        setLoadingEmps(true);
                        empDebounce.current = setTimeout(() => buscarEmpregados(v.trim()), 350);
                      } else { setShowEmpDrop(false); setEmpregados([]); }
                    }}
                  />
                  {showEmpDrop && empSearch.length >= 2 && (
                    <div style={{ position: "absolute", top: "100%", left: 0, right: 0, zIndex: 999, background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, boxShadow: "0 8px 24px rgba(15,23,42,.14)", maxHeight: 220, overflowY: "auto", marginTop: 2 }}>
                      {loadingEmps ? (
                        <div style={{ padding: "12px", fontSize: 12, color: "#94a3b8", textAlign: "center" }}>Buscando...</div>
                      ) : (() => {
                        const filtrados = empregados.slice(0, 40);
                        return filtrados.length === 0 ? (
                          <div style={{ padding: "12px", fontSize: 12, color: "#94a3b8", textAlign: "center" }}>Nenhum colaborador encontrado.</div>
                        ) : filtrados.map((emp, i) => (
                          <div key={i} onMouseDown={() => selecionarEmpregado(emp)}
                            style={{ padding: "8px 12px", fontSize: 13, cursor: "pointer", borderBottom: "1px solid #f1f5f9", color: "#0f172a" }}
                            onMouseEnter={e => (e.currentTarget.style.background = "#f0f4ff")}
                            onMouseLeave={e => (e.currentTarget.style.background = "#fff")}>
                            <div style={{ fontWeight: 600 }}>{emp.Nome}</div>
                            <div style={{ fontSize: 11, color: "#94a3b8" }}>{emp["Título do Cargo"]}{emp["Nome Filial"] ? ` · ${emp["Nome Filial"]}` : ""}</div>
                          </div>
                        ));
                      })()}
                    </div>
                  )}
                </div>
              )}
              <div className="rec-fg">
                <label>Contrato *</label>
                <select className="rec-fi" value={vaga.contrato} onChange={e => setVaga(v => ({ ...v, contrato: e.target.value }))}>
                  <option value="">— Selecione —</option>
                  {contratos.map(c => <option key={c}>{c}</option>)}
                </select>
              </div>
              <div className="rec-fg"><label>Cargo *</label><input className="rec-fi" placeholder="Ex: Auxiliar de Limpeza, Vigilante..." value={vaga.cargo} onChange={e => setVaga(v => ({ ...v, cargo: e.target.value }))} /></div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div className="rec-fg">
                  <label>Estado (UF)</label>
                  <select className="rec-fi" value={vaga.estado} onChange={e => setVaga(v => ({ ...v, estado: e.target.value, cidade: "" }))}>
                    <option value="">— Selecione —</option>
                    {ESTADOS_BR.map(e => <option key={e.uf} value={e.uf}>{e.uf} — {e.nome}</option>)}
                  </select>
                </div>
                <div className="rec-fg">
                  <label>Cidade</label>
                  <select className="rec-fi" value={vaga.cidade} disabled={!vaga.estado} onChange={e => setVaga(v => ({ ...v, cidade: e.target.value }))}>
                    <option value="">{vaga.estado ? "— Selecione —" : "Selecione o estado primeiro"}</option>
                    {municipiosDe(vaga.estado).map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
              </div>
            </>)}

            {/* Step 2 */}
            {vagaStep === 2 && (<>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div className="rec-fg"><label>Quantidade de Vagas</label><input className="rec-fi" type="number" min={1} max={99} value={vaga.quantidade_vagas} onChange={e => setVaga(v => ({ ...v, quantidade_vagas: e.target.value }))} /></div>
                <div className="rec-fg"><label>Data de Início Prevista</label><input className="rec-fi" type="date" value={vaga.data_inicio_prevista} onChange={e => setVaga(v => ({ ...v, data_inicio_prevista: e.target.value }))} /></div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div className="rec-fg"><label>Escala</label><input className="rec-fi" placeholder="Ex: 12x36, 5x2..." value={vaga.escala} onChange={e => setVaga(v => ({ ...v, escala: e.target.value }))} /></div>
                <div className="rec-fg"><label>Horário</label><input className="rec-fi" placeholder="Ex: 07h às 19h..." value={vaga.horario} onChange={e => setVaga(v => ({ ...v, horario: e.target.value }))} /></div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div className="rec-fg"><label>Salário</label><input className="rec-fi" placeholder="Ex: R$ 1.412,00" value={vaga.salario} onChange={e => setVaga(v => ({ ...v, salario: e.target.value }))} /></div>
                <div className="rec-fg">
                  <label>Insalubridade</label>
                  <select className="rec-fi" value={vaga.insalubridade_recebe} onChange={e => setVaga(v => ({ ...v, insalubridade_recebe: e.target.value }))}>
                    <option>Não</option><option>Sim</option>
                  </select>
                </div>
              </div>
              {vaga.insalubridade_recebe === "Sim" && (
                <div className="rec-fg"><label>Percentual de Insalubridade</label><input className="rec-fi" placeholder="Ex: 20%, 40%" value={vaga.insalubridade_quanto} onChange={e => setVaga(v => ({ ...v, insalubridade_quanto: e.target.value }))} /></div>
              )}
              <div className="rec-fg"><label>Benefícios</label><textarea className="rec-fi" rows={2} placeholder="VT, VR, Plano de Saúde..." value={vaga.beneficios} onChange={e => setVaga(v => ({ ...v, beneficios: e.target.value }))} /></div>
              <div className="rec-fg"><label>Local Exato / Posto</label><input className="rec-fi" placeholder="Nome do posto ou endereço..." value={vaga.local_exato} onChange={e => setVaga(v => ({ ...v, local_exato: e.target.value }))} /></div>
            </>)}

            {/* Step 3 */}
            {vagaStep === 3 && (<>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div className="rec-fg">
                  <label>Grau de Urgência</label>
                  <select className="rec-fi" value={vaga.grau_urgencia} onChange={e => setVaga(v => ({ ...v, grau_urgencia: e.target.value }))}>
                    <option value="">— Selecione —</option>
                    {["Baixa","Média","Alta — Urgente"].map(o => <option key={o}>{o}</option>)}
                  </select>
                </div>
                <div className="rec-fg">
                  <label>Alta Rotatividade?</label>
                  <select className="rec-fi" value={vaga.alta_rotatividade} onChange={e => setVaga(v => ({ ...v, alta_rotatividade: e.target.value }))}>
                    <option>Não</option><option>Sim</option>
                  </select>
                </div>
              </div>
              <div className="rec-fg"><label>Requisitos Obrigatórios *</label><textarea className="rec-fi" rows={3} placeholder="Experiência comprovada, CNH B..." value={vaga.req_obrigatorios} onChange={e => setVaga(v => ({ ...v, req_obrigatorios: e.target.value }))} /></div>
              <div className="rec-fg"><label>Requisitos Desejáveis</label><textarea className="rec-fi" rows={2} placeholder="Inglês básico, curso técnico... (opcional)" value={vaga.req_desejaveis} onChange={e => setVaga(v => ({ ...v, req_desejaveis: e.target.value }))} /></div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div className="rec-fg">
                  <label>Experiência Mínima?</label>
                  <select className="rec-fi" value={vaga.exp_minima} onChange={e => setVaga(v => ({ ...v, exp_minima: e.target.value }))}>
                    <option>Não</option><option>Sim</option>
                  </select>
                </div>
                {vaga.exp_minima === "Sim" && (
                  <div className="rec-fg"><label>Qual experiência?</label><input className="rec-fi" placeholder="Ex: 6 meses em limpeza" value={vaga.exp_minima_qual} onChange={e => setVaga(v => ({ ...v, exp_minima_qual: e.target.value }))} /></div>
                )}
              </div>
              <div className="rec-fg"><label>Observação Importante</label><textarea className="rec-fi" rows={2} placeholder="Opcional..." value={vaga.observacao_importante} onChange={e => setVaga(v => ({ ...v, observacao_importante: e.target.value }))} /></div>
            </>)}

            {/* Navegação */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 16, paddingTop: 14, borderTop: "1px solid #e2e8f0" }}>
              <div />
              <div style={{ display: "flex", gap: 8 }}>
                {vagaStep > 1 && <button onClick={() => setVagaStep(s => s - 1)} style={{ padding: "7px 14px", borderRadius: 10, border: "1px solid #e2e8f0", background: "#fff", color: "#475569", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>← Anterior</button>}
                {vagaStep < 3 && <button onClick={() => { if (vagaValidar(vagaStep)) setVagaStep(s => s + 1); }} style={{ padding: "7px 14px", borderRadius: 10, border: "none", background: "#0f3171", color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>Próximo →</button>}
                {vagaStep === 3 && <button onClick={submitVaga} style={{ padding: "7px 14px", borderRadius: 10, border: "none", background: "#16a34a", color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>✓ Solicitar Vaga</button>}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Toasts ── */}
      <div style={{ position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)", zIndex: 9999, pointerEvents: "none", display: "flex", flexDirection: "column", gap: 6, alignItems: "center" }}>
        {toasts.map(t => (
          <div key={t.id} style={{
            display: "inline-block", padding: "10px 18px", borderRadius: 9, fontSize: 13, fontWeight: 600, boxShadow: "0 16px 40px rgba(15,23,42,.1)",
            background: t.type === "ok" ? "#ecfdf3" : t.type === "err" ? "#fef2f2" : "#eff6ff",
            color:      t.type === "ok" ? "#15803d"  : t.type === "err" ? "#b91c1c"  : "#1d4ed8",
            border: `1px solid ${t.type === "ok" ? "#86efac" : t.type === "err" ? "#fecaca" : "#bfdbfe"}`,
          }}>{t.msg}</div>
        ))}
      </div>
    </div>
  );
}
