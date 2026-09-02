import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { usePermissoes } from "@/context/PermissoesContext";
import { useEmpresaAtiva } from "@/context/EmpresaAtivaContext";
import { useContratosCatalogo, usePostos, useFuncoes } from "@/hooks/useSupCatalogo";
import { ESTADOS_BR, municipiosDe } from "@/data/municipios-brasil";
import { ResumoDeFuncoes } from "@/components/fluxos/ResumoDeFuncoes";
import {
  MOTIVOS_VAGA, motivoLabel, ehSubstituicao, avaliarPrazo, dataMinimaVaga,
  cargoExigeCnh, aplicarReqCnh, REQ_CNH_TEXTO, fmtBr,
  rotuloReferencia, ajudaReferencia, mostraNomeReferencia, contratoDoEmpregado,
  faltamCamposManuais,
  podeVagaAdministrativa, filtrarAdministrativas,
  substituidosComVagaViva, avisoSubstituidoPreso,
} from "@/lib/recrutamento/vagaRegras";

/** Explica o prazo da data escolhida: o que falta ou qual grau saiu dela. */
function PrazoAviso({ prazo }: { prazo: ReturnType<typeof avaliarPrazo> }) {
  const cor = !prazo.ok ? { bg: "#fef2f2", bd: "#fecaca", tx: "#b91c1c" }
    : prazo.grau === "Alta — Urgente" ? { bg: "#fff7ed", bd: "#fed7aa", tx: "#c2410c" }
      : prazo.grau === "Média" ? { bg: "#fefce8", bd: "#fde68a", tx: "#a16207" }
        : { bg: "#f0fdf4", bd: "#bbf7d0", tx: "#15803d" };
  return (
    <div style={{ fontSize: 12, lineHeight: 1.5, background: cor.bg, border: `1px solid ${cor.bd}`, color: cor.tx, borderRadius: 9, padding: "8px 11px", marginBottom: 12, fontWeight: 600 }}>
      {!prazo.ok
        ? <>⚠️ {prazo.erro}</>
        : <>✅ <b>{prazo.dias} dias úteis</b> de antecedência → urgência <b>{prazo.grau}</b>. <span style={{ fontWeight: 500 }}>O grau sai do prazo: até 13 dias úteis é urgente, de 14 a 20 é média, 21 ou mais é baixa.</span></>}
    </div>
  );
}

// ── Tipos ──────────────────────────────────────────────────────────
interface Solicitacao {
  id: number;
  contrato: string;
  cargo: string;
  cidade: string;
  status: string;
  grau_urgencia: string;
  motivo_vaga: string;
  /** Vaga do escritório: só quem tem a capacidade enxerga (RLS). */
  administrativa?: boolean;
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
  // Pareceres por setor. `false` no juridico_ok com etapa <> 'Reprovado'
  // significa "reprovado mas devolvido ao RH" — ver devolverDoJuridico.
  juridico_ok?: boolean | null;
  juridico_obs?: string;
  // SST e Compras correm em PARALELO: os dois precisam estar true para o
  // candidato seguir sozinho para a Admissão.
  sst_ok?: boolean | null;
  sst_obs?: string;
  compras_ok?: boolean | null;
  compras_obs?: string;
  motivo_reprovacao?: string;
  // Desistência é do CANDIDATO (reprovação é da empresa). `desistencia_etapa`
  // guarda onde ele estava, senão o indicador de perda fica cego.
  desistiu?: boolean | null;
  desistencia_motivo?: string | null;
  desistencia_etapa?: string | null;
  desistencia_em?: string | null;
  desistencia_por?: string | null;
  enviado_admissao_em?: string | null;
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

/**
 * Nome completo real (EMPREGADOS) de cada e-mail.
 *
 * Quem solicita uma vaga fica gravado com `user_metadata.nome`, e quem não tem
 * nome no metadata fica gravado só com o e-mail — daí "Solicitado por
 * fulano.silva@grupo…" nas telas. EMPREGADOS é a fonte oficial do nome
 * (ver o vínculo login↔empregado), então é dela que se traduz.
 */
async function nomesPorEmail(emails: (string | null | undefined)[]): Promise<Record<string, string>> {
  const lista = Array.from(new Set(emails.filter((e): e is string => !!e && e.includes("@"))));
  if (!lista.length) return {};
  const { data } = await (supabase as any).from("EMPREGADOS").select('"Nome","email"').in("email", lista);
  const mapa: Record<string, string> = {};
  (data ?? []).forEach((e: any) => { if (e.email && e["Nome"]) mapa[e.email] = e["Nome"]; });
  return mapa;
}

/** O e-mail de quem solicitou — mora em `solicitante_cpf` (nome de coluna legado). */
const emailSolicitante = (s: { solicitante_cpf?: string; solicitante_nome?: string }) =>
  [s.solicitante_cpf, s.solicitante_nome].find((v) => String(v ?? "").includes("@")) ?? "";

function badgeStatusCls(st: string) {
  if (st === "Pendente Analista")  return "bg-yellow-100 text-yellow-800 border border-yellow-200";
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
  "Pendente Analista",
  "Pendente Recrutamento",
  "Seleção de Candidato",
  "Concluída",
  "Reprovada",
];

const KB_COL_COLORS: Record<string, { dot: string; label: string; accent: string }> = {
  "Pendente Analista":  { dot: "#f59e0b", label: "#b45309", accent: "#f59e0b" },
  "Pendente Recrutamento": { dot: "#8b5cf6", label: "#7c3aed", accent: "#8b5cf6" },
  "Seleção de Candidato":  { dot: "#3b82f6", label: "#2563eb", accent: "#3b82f6" },
  "Concluída":             { dot: "#16a34a", label: "#15803d", accent: "#16a34a" },
  Reprovada:               { dot: "#dc2626", label: "#b91c1c", accent: "#dc2626" },
};

// Kanban interno (Status do Candidato) — 10 colunas + Reprovado.
// DOCUMENTAÇÃO vem antes do EXAME SST (o laboratório já precisa dos dados do
// candidato) e ADMISSÃO é a coluna final, onde ele é efetivado no RH.
// APROVADO no singular: é uma vaga, um aprovado.
const CAND_ETAPAS = [
  "ENTRADA", "TRIAGEM", "JURÍDICO", "ENTREVISTA", "ENTREVISTA GESTOR",
  "APROVADO", "DOCUMENTAÇÃO", "SST + COMPRAS", "ADMISSÃO", "Reprovado",
];

// SST e Compras correm JUNTOS a partir da Documentação: os dois recebem o
// candidato ao mesmo tempo e a Admissão só libera quando ambos aprovarem.
export const ETAPA_SST_COMPRAS = "SST + COMPRAS";

// Dado gravado antes da fusão continua chegando como 'EXAME SST' ou
// 'COMPRAS'. Quem concilia é a TELA, não uma migration: assim não existe
// janela em que o banco esteja à frente do código e o card fique sem coluna
// onde cair (foi o que aconteceu em 18/08/2026).
const ETAPAS_ANTIGAS_PARALELO = ["EXAME SST", "COMPRAS"];
export const normalizarEtapa = (e?: string | null) =>
  ETAPAS_ANTIGAS_PARALELO.includes(String(e ?? "")) ? ETAPA_SST_COMPRAS : String(e ?? "");

// Rótulo da coluna. Só difere do valor onde o nome guardado é curto demais
// para o que a coluna realmente contém.
const ETAPA_LABEL: Record<string, string> = {
  Reprovado: "Reprovado / Desistência",
};
const CAND_COL_COLORS: Record<string, { dot: string; label: string; accent: string }> = {
  ENTRADA:            { dot: "#64748b", label: "#475569", accent: "#64748b" },
  TRIAGEM:            { dot: "#3b82f6", label: "#2563eb", accent: "#3b82f6" },
  "JURÍDICO":         { dot: "#8b5cf6", label: "#7c3aed", accent: "#8b5cf6" },
  ENTREVISTA:         { dot: "#0ea5e9", label: "#0369a1", accent: "#0ea5e9" },
  "ENTREVISTA GESTOR":{ dot: "#6366f1", label: "#4f46e5", accent: "#6366f1" },
  APROVADO:           { dot: "#14b8a6", label: "#0f766e", accent: "#14b8a6" },
  "DOCUMENTAÇÃO":     { dot: "#0891b2", label: "#0e7490", accent: "#0891b2" },
  "SST + COMPRAS":    { dot: "#f59e0b", label: "#b45309", accent: "#f59e0b" },
  "ADMISSÃO":         { dot: "#16a34a", label: "#15803d", accent: "#16a34a" },
  Reprovado:          { dot: "#dc2626", label: "#b91c1c", accent: "#dc2626" },
};
// Papel responsável por completar cada etapa.
const PAPEL_ETAPA: Record<string, string> = {
  ENTRADA: "Recrutamento", TRIAGEM: "Recrutamento", "JURÍDICO": "Jurídico",
  ENTREVISTA: "Recrutamento", "ENTREVISTA GESTOR": "Recrutamento", APROVADO: "Recrutamento",
  "DOCUMENTAÇÃO": "Recrutamento", "SST + COMPRAS": "SST + Suprimentos",
  "ADMISSÃO": "Recrutamento",
};
// Etapas que disparam WhatsApp automático (o texto vem de RECRUTAMENTO_MENSAGENS).
// "ENTREVISTA GESTOR" é a segunda entrevista, opcional no fluxo.
const ETAPAS_COM_MENSAGEM = ["TRIAGEM", "ENTREVISTA", "ENTREVISTA GESTOR", "APROVADO"];
// Variáveis que o RH pode usar nos {{n}} do template aprovado na Meta.
const MSG_VARIAVEIS = ["primeiro_nome", "nome", "cargo", "cidade", "contrato", "empresa"];

// Nome de template da Meta: só minúsculas, números e underscore. "Entrevista
// Gestor" é recusado lá com erro 132001, e o envio automático falharia calado
// a cada card movido — melhor barrar aqui, na hora de configurar.
const RE_TEMPLATE = /^[a-z0-9_]+$/;
const nomeTemplateInvalido = (n?: string | null) => {
  const v = String(n ?? "").trim();
  return v.length > 0 && !RE_TEMPLATE.test(v);
};
const sugerirNomeTemplate = (n?: string | null) =>
  String(n ?? "").trim().toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")   // "Aprovação" → "aprovacao"
    .replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
// Status da Solicitação dirigidos pelo candidato (etapas 3–10).
const STATUS_PROCESSO = [
  "Vaga aberta - Seleção de Currículos", "Em análise jurídica", "Entrevista e Avaliação",
  "Entrevista com Gestor", "Aprovado - Aguardando SST",
  "Compras Confirmou - Aguardando Documentação",
  // Um status só para a etapa paralela. Os três antigos ("Encaminhado para
  // SST (ASO)", "ASO Aprovado - Aguardando Informe de EPIs", "Aguardando
  // Confirmação Compras") descreviam uma fila SST → Compras que não existe
  // mais; ainda aparecem em vagas antigas e por isso seguem na lista.
  "Aguardando SST e Compras",
  "Encaminhado para SST (ASO)", "ASO Aprovado - Aguardando Informe de EPIs",
  "Aguardando Confirmação Compras",
];

// ── Componente Principal ───────────────────────────────────────────
//
// A MESMA tela serve dois módulos, e é de propósito: o Operacional analisa
// exatamente as solicitações que o Recrutamento vê na aba "Pendente
// Operacional", com o mesmo drawer, o mesmo histórico e o mesmo chat. Uma
// cópia divergiria na primeira correção feita só de um lado.
//
//   escopo "rh"          → Recrutamento e Seleção, o processo inteiro
//   escopo "analista"    → só a fila "Pendente Analista", para aprovar
//                          ou reprovar antes de virar vaga
//   escopo "operacional" → a MESMA fila, só que sem decidir nada: abre o
//                          card, lê o andamento e pronto
//
// A ETAPA 1 MUDOU DE DONO em 02/09/2026: era do Operacional, passou para o
// analista (Licitações › Analistas Validações). O Operacional não perdeu a
// tela — perdeu o botão. Foi pedido assim: "pode deixar a gestão recrutamento
// no operacional só pra eles verem os andamentos das solicitações, mas nenhuma
// interação".
//
// O que muda é o recorte e QUAL MENU decide as permissões — cada escopo tem o
// seu, então liberar o menu certo já basta; não precisa dar Gestão
// Recrutamento junto.
export default function Recrutamento({ escopo = "rh" }: { escopo?: "rh" | "analista" | "operacional" }) {
  // Os dois escopos estreitos veem a MESMA fila; o que os separa é poder ou
  // não decidir nela — ver `podeAprovarAnalista`.
  const soEtapa1 = escopo === "analista" || escopo === "operacional";
  const menuAcesso =
    escopo === "analista" ? "licitacoes_analistas_recrutamento"
    : escopo === "operacional" ? "operacional_recrutamento"
    : "recrutamento_gestao";
  const { user } = useAuth();
  const { roles, can } = usePermissoes();
  const { empresa } = useEmpresaAtiva();
  const navigate = useNavigate();

  const isTreinamento = roles.includes("treinamentos"); // só rótulo da mensagem no chat, não é gate

  // Recrutamento = quem tem alterar no menu da tela (conduz o processo). No
  // Operacional ninguém conduz processo: a tela para na etapa 1.
  const podeRecrutar = !soEtapa1 && can("alterar", undefined, menuAcesso);
  // Visibilidade ampla (dashboard "Todas as Solicitações") sem rodar o processo.
  const podeVerTudo = can("visualizar", undefined, menuAcesso);
  const isRH = !soEtapa1 && podeVerTudo && !podeRecrutar;
  // A etapa 1 (Pendente Operacional → Pendente Recrutamento) é do OPERACIONAL,
  // e só existe na tela dele. No Recrutamento a solicitação nessa fase aparece
  // na lista, para acompanhar, mas sem botão de decidir — senão as duas telas
  // aprovariam a mesma coisa e a última a salvar ganharia.
  const podeAprovarAnalista = escopo === "analista" && can("aprovar", undefined, menuAcesso);
  // Quem pode mover o candidato pra fora de cada etapa específica do kanban.
  // Vaga do escritório: só quem tem a capacidade vê, marca e decide.
  const podeAdministrativa = podeVagaAdministrativa(can);
  const podeMoverJuridico = can("aprovar", undefined, "recrutamento_etapa_juridico");
  const podeMoverSst      = can("aprovar", undefined, "recrutamento_etapa_sst");
  const podeMoverCompras  = can("aprovar", undefined, "recrutamento_etapa_compras");

  // ── Estado ─────────────────────────────────────────────────────
  // Vaga do escritório preenchida à mão, sem colaborador de referência.
  const [vagaManual, setVagaManual]     = useState(false);
  const [menuVagaAberto, setMenuVagaAberto] = useState(false);
  const [view, setView]               = useState<"tabela" | "kanban">("tabela");
  const [tab, setTab]                 = useState("minha");
  const [page, setPage]               = useState(1);
  const [pages, setPages]             = useState(1);
  const [total, setTotal]             = useState(0);
  const [items, setItems]             = useState<Solicitacao[]>([]);
  const [loading, setLoading]         = useState(false);
  // O Operacional abre na fila dele; os demais abrem em "Todas". Antes isso
  // vinha da aba, que PRENDIA o status e impedia ele de rever o que ja tinha
  // aprovado.
  const [statusFilter, setStatusFilter] = useState(soEtapa1 ? "Pendente Analista" : "");
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
  // Materiais/EPIs que o Compras precisa providenciar. Obrigatório ao enviar
  // para a etapa paralela: sem a lista o pedido chega vazio no módulo de
  // Suprimentos e alguém volta perguntando.
  const [candMateriais, setCandMateriais]   = useState("");
  const [showKanbanCand, setShowKanbanCand] = useState(false);   // painel dedicado do kanban
  const [showHistorico, setShowHistorico]   = useState(false);   // painel de histórico
  const [historico, setHistorico]           = useState<any[]>([]);
  const [nomesPorEmailHist, setNomesPorEmailHist] = useState<Record<string, string>>({}); // nome real (EMPREGADOS) por e-mail, p/ histórico
  const [nomeSolicitante, setNomeSolicitante] = useState("");  // nome real de quem pediu a vaga (quando só ficou o e-mail)
  // Roteiro de entrevista (ENTREVISTA / ENTREVISTA GESTOR)
  const [roteiroModal, setRoteiroModal]     = useState<{ id: number; nome: string; etapa: string } | null>(null);
  const [roteiroRows, setRoteiroRows]       = useState<{ pergunta: string; resposta: string }[]>([]);
  // Documentos do candidato (etapa DOCUMENTAÇÃO)
  const [docsModal, setDocsModal]           = useState<{ id: number; nome: string } | null>(null);
  const [docs, setDocs]                     = useState<any[]>([]);
  const [docsCount, setDocsCount]           = useState<Record<number, number>>({}); // p/ o contador no card
  const [docTitulo, setDocTitulo]           = useState("");
  const [docFile, setDocFile]               = useState<File | null>(null);
  const [docSubindo, setDocSubindo]         = useState(false);
  // Configuração das mensagens automáticas de WhatsApp
  const [msgModal, setMsgModal]             = useState(false);
  const [msgCfgs, setMsgCfgs]               = useState<any[]>([]);
  const [msgSalvando, setMsgSalvando]       = useState(false);
  // Status de cada template na Meta (APPROVED / PENDING / REJECTED / NAO_CRIADO)
  const [msgStatus, setMsgStatus]           = useState<Record<string, any>>({});
  const [msgMetaBusy, setMsgMetaBusy]       = useState(false);

  // Wizard nova vaga
  const [vaga, setVaga] = useState({
    motivo_vaga: "", administrativa: false, nome_substituido: "", contrato: "", cargo: "",
    contrato_id: "", posto_id: "", funcao_id: "",
    estado: "", cidade: "", quantidade_vagas: "1", data_inicio_prevista: "",
    escala: "", horario: "", salario: "", insalubridade_recebe: "Não",
    insalubridade_quanto: "", beneficios: "", local_exato: "",
    grau_urgencia: "", alta_rotatividade: "Não", req_obrigatorios: "",
    req_desejaveis: "", exp_minima: "Não", exp_minima_qual: "",
    motivos_saida: "", recomendacao: "", observacao_importante: "",
  });
  const { data: contratosCatalogo = [] } = useContratosCatalogo(empresa.id);
  const { data: postosCatalogo = [] } = usePostos(vaga.contrato_id || null);
  const { data: funcoesCatalogo = [] } = useFuncoes(vaga.posto_id || null);
  const [contratosFull, setContratosFull] = useState<any[]>([]);
  // Empregado -> nº da vaga de substituição que já o segura (regra do banco).
  const [presos, setPresos] = useState<Map<number, number>>(new Map());
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
  const tabs = soEtapa1
    ? [{ label: "Pendente Analista", tab: "analista" }]
    : isRH
    ? [{ label: "Todas as Solicitações", tab: "todas" }]
    : podeRecrutar
    ? [
        { label: "Todas", tab: "todas" },
        { label: "Minhas Solicitações", tab: "minha" },
      ]
    : [{ label: "Minhas Solicitações", tab: "minha" }];

  useEffect(() => { setTab(tabs[0].tab); }, [isRH, podeRecrutar, soEtapa1]);

  // ── Carregar Stats ────────────────────────────────────────────
  const loadStats = useCallback(async () => {
    const { data, error } = await (supabase as any)
      .from("SISTEMA_RECRUTAMENTO")
      .select("status");
    if (error || !data) return;
    const rows: { status: string }[] = data;
    setStats({
      total:            rows.length,
      pendentes:        rows.filter(r => r.status === "Pendente Analista").length,
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
    }
    // A aba "analista" NÃO prende mais o status. Quem recorta é o filtro de
    // chips, que já abre em "Pendente Analista" — prender aqui deixava o
    // Operacional trancado na própria fila, sem alcançar o que ele mesmo
    // aprovou ou reprovou (nem o chat daqueles casos).
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
    setItems(filtrarAdministrativas(data ?? [], podeAdministrativa));
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
    const lista = (data ?? []).map(mapCurriculo);
    setCandidatos(lista);
    // Contador de documentos no card: uma consulta só para todos os candidatos
    // do quadro, senão seriam N chamadas a cada render do kanban.
    const ids = lista.map((c: Curriculo) => c.id);
    if (!ids.length) { setDocsCount({}); return; }
    const { data: arqs } = await (supabase as any)
      .from("RECRUTAMENTO_CANDIDATO_ARQUIVOS")
      .select("candidato_id").in("candidato_id", ids).eq("tipo", "documento");
    const cont: Record<number, number> = {};
    (arqs ?? []).forEach((a: any) => { cont[a.candidato_id] = (cont[a.candidato_id] ?? 0) + 1; });
    setDocsCount(cont);
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
    setNomesPorEmailHist(await nomesPorEmail(eventos.map((r: any) => r.usuario_email)));
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
    // "Solicitado por": quando ficou gravado só com o e-mail, traduz para o
    // nome de EMPREGADOS. Só consulta quando precisa — solicitação criada por
    // quem tem nome no metadata já vem pronta.
    setNomeSolicitante("");
    const nomeGravado = String(sol?.solicitante_nome ?? "").trim();
    if (sol && (!nomeGravado || nomeGravado.includes("@"))) {
      const email = emailSolicitante(sol);
      if (email) setNomeSolicitante((await nomesPorEmail([email]))[email] ?? "");
    }
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
    if (error) { toast("Erro ao enviar mensagem: " + error.message, "err"); return; }
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

    if (error) { toast("Erro ao aprovar: " + error.message, "err"); return; }
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
    if (error) { toast("Erro ao concluir: " + error.message, "err"); return; }
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
    if (error) { toast("Erro ao reprovar: " + error.message, "err"); return; }
    if (drawerId) {
      const papel = drawerSol?.status === "Pendente Analista" ? "Analista" : "Recrutamento";
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
    if (error) { toast("Erro ao atualizar status: " + error.message, "err"); return; }
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

  // O candidato tem WhatsApp utilizável? (só valida o telefone; a conversa em
  // si é resolvida no clique)
  const temWhatsApp = (c: any): boolean =>
    String(c.telefone ?? "").replace(/\D/g, "").length >= 10;

  // Abre a conversa do candidato na NOSSA Caixa de Entrada.
  // Antes isso apontava para wa.me e tirava o recrutador do sistema: a conversa
  // ficava no celular dele, fora do histórico e invisível para o próximo
  // atendente. A RPC acha (ou cria) a conversa e a Caixa abre já nela.
  const abrirWhatsAppInterno = async (c: any) => {
    if (!temWhatsApp(c)) { toast("Candidato sem telefone válido.", "err"); return; }
    const { data, error } = await (supabase as any).rpc("recrutamento_abrir_conversa", { p_candidato_id: c.id });
    if (error || !data) { toast("Não consegui abrir a conversa: " + (error?.message ?? "conversa não encontrada"), "err"); return; }
    navigate(`/app/whatsapp?conversa=${data}`);
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
    // JURÍDICO é SÓ do Jurídico. O "|| podeRecrutar" saiu a pedido do RH em
    // 18/08/2026: com ele, o recrutador liberava a própria análise jurídica,
    // que é justamente o controle que a etapa existe para exercer.
    if (etapa === "JURÍDICO") return podeMoverJuridico;
    // Etapa paralela: cada setor mexe no SEU selo (ver aprovarParalelo).
    if (etapa === ETAPA_SST_COMPRAS) return podeMoverSst || podeMoverCompras || podeRecrutar;
    return podeRecrutar; // ENTRADA, TRIAGEM, ENTREVISTA, ENT. GESTOR, APROVADO, DOCUMENTAÇÃO
  };
  // Próxima etapa linear (TRIAGEM e ENTREVISTA ramificam → tratadas no card).
  const CAND_PROX: Record<string, string> = {
    ENTRADA: "TRIAGEM",
    "JURÍDICO": "ENTREVISTA",
    "ENTREVISTA GESTOR": "APROVADO",
    APROVADO: "DOCUMENTAÇÃO",
    "DOCUMENTAÇÃO": ETAPA_SST_COMPRAS,
    // ETAPA_SST_COMPRAS não entra aqui: sai sozinha quando os dois setores
    // aprovam (ver aprovarParalelo).
  };
  const labelProx = (etapa: string) => ({
    ENTRADA: "→ Triagem",
    "JURÍDICO": "Liberar → Entrevista",
    "ENTREVISTA GESTOR": "→ Aprovado",
    APROVADO: "→ Documentação",
    "DOCUMENTAÇÃO": "→ SST + Compras",
  } as Record<string, string>)[etapa] || "Avançar";

  // ADMISSÃO → efetiva o candidato no módulo de Admissão (RH).
  const enviarAdmissao = async (cv: Curriculo) => {
    if (!confirm(`Contratar ${cv.nome || "o candidato"}?\n\nEle vai para a Admissão (RH), a vaga é ENCERRADA como "Contratado" e sai do portal público /vagas.`)) return;
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

  // ── Documentos do candidato (etapa DOCUMENTAÇÃO) ───────────────
  // Ficam presos ao candidato, não ao empregado: aqui o cadastro em EMPREGADOS
  // ainda não existe — ele só nasce na Admissão. Quando nascer, o vínculo
  // WA_CURRICULOS.empregado_id faz esses anexos aparecerem no cadastro dele.
  const loadDocs = async (candidatoId: number) => {
    const { data } = await (supabase as any)
      .from("RECRUTAMENTO_CANDIDATO_ARQUIVOS")
      .select("*").eq("candidato_id", candidatoId).eq("tipo", "documento")
      .order("created_at", { ascending: false });
    setDocs(data ?? []);
  };
  const abrirDocs = async (cv: Curriculo) => {
    setDocTitulo(""); setDocFile(null);
    setDocsModal({ id: cv.id, nome: cv.nome || "Candidato" });
    await loadDocs(cv.id);
  };
  const anexarDoc = async () => {
    if (!docsModal) return;
    if (!docTitulo.trim()) { toast("Informe o título do documento.", "err"); return; }
    if (!docFile) { toast("Escolha o arquivo.", "err"); return; }
    setDocSubindo(true);
    // Nome no bucket é gerado: título com acento/barra quebraria o storage, e
    // dois arquivos com o mesmo nome se sobrescreveriam.
    const ext = docFile.name.includes(".") ? docFile.name.split(".").pop() : "";
    const path = `documentos/${docsModal.id}/${Date.now()}${ext ? "." + ext : ""}`;
    const { error: upErr } = await supabase.storage.from("curriculos").upload(path, docFile);
    if (upErr) { toast("Erro ao subir o arquivo: " + upErr.message, "err"); setDocSubindo(false); return; }
    const { error } = await (supabase as any).from("RECRUTAMENTO_CANDIDATO_ARQUIVOS").insert({
      candidato_id: docsModal.id, tipo: "documento", etapa: "DOCUMENTAÇÃO",
      titulo: docTitulo.trim(), nome: docFile.name, storage_path: path,
      enviado_por: user?.user_metadata?.nome ?? user?.email ?? "",
    });
    setDocSubindo(false);
    if (error) { toast("Erro ao registrar o documento: " + error.message, "err"); return; }
    if (drawerId) await logHistorico(drawerId, `Documento anexado: ${docTitulo.trim()}`, {
      papel: "Recrutamento", candidatoId: docsModal.id, candidatoNome: docsModal.nome,
    });
    toast("Documento anexado.", "ok");
    setDocTitulo(""); setDocFile(null);
    await loadDocs(docsModal.id);
    setDocsCount(p => ({ ...p, [docsModal.id]: (p[docsModal.id] ?? 0) + 1 }));
  };
  const baixarDoc = async (d: any) => {
    const { data, error } = await supabase.storage.from("curriculos").createSignedUrl(d.storage_path, 3600);
    if (error || !data?.signedUrl) { toast("Não foi possível abrir o arquivo.", "err"); return; }
    window.open(data.signedUrl, "_blank", "noopener");
  };
  const removerDoc = async (d: any) => {
    if (!confirm(`Remover o documento "${d.titulo || d.nome}"?`)) return;
    const { error } = await (supabase as any).from("RECRUTAMENTO_CANDIDATO_ARQUIVOS").delete().eq("id", d.id);
    if (error) { toast("Erro ao remover: " + error.message, "err"); return; }
    await supabase.storage.from("curriculos").remove([d.storage_path]);
    toast("Documento removido.", "ok");
    if (docsModal) {
      await loadDocs(docsModal.id);
      setDocsCount(p => ({ ...p, [docsModal.id]: Math.max(0, (p[docsModal.id] ?? 1) - 1) }));
    }
  };

  // ── Configuração das mensagens automáticas ─────────────────────
  const abrirMsgConfig = async () => {
    const { data } = await (supabase as any).from("RECRUTAMENTO_MENSAGENS").select("*");
    // Ordena pela ordem do funil, não alfabética — é assim que o RH lê o fluxo.
    const porEtapa = new Map((data ?? []).map((r: any) => [r.etapa, r]));
    setMsgCfgs(ETAPAS_COM_MENSAGEM.map(e => porEtapa.get(e) ?? {
      etapa: e, ativo: false, template_nome: "", template_idioma: "pt_BR",
      parametros: ["primeiro_nome", "cargo"], texto_previa: "",
    }));
    setMsgModal(true);
    consultarTemplates();
  };

  // ── Templates na Meta ──────────────────────────────────────────
  // O texto real mora lá e precisa passar por revisão. Saber o status aqui
  // evita o RH ligar a etapa e descobrir pelo silêncio que nada é enviado.
  const consultarTemplates = async () => {
    try {
      const { data, error } = await supabase.functions.invoke("whatsapp-templates", { body: { acao: "listar" } });
      if (error) return; // sem WhatsApp configurado ou sem permissão: a tela segue utilizável
      const mapa: Record<string, any> = {};
      ((data as any)?.templates ?? []).forEach((t: any) => { mapa[t.etapa] = t; });
      setMsgStatus(mapa);
    } catch { /* consulta é informativa; falha nela não trava a configuração */ }
  };

  const criarTemplates = async () => {
    if (!confirm("Enviar os textos para aprovação da Meta?\n\nEles passam por revisão e ficam registrados na conta da empresa. Isso não liga o envio automático — depois de aprovados, você ainda marca \"Enviar automaticamente\" na etapa.")) return;
    setMsgMetaBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("whatsapp-templates", { body: { acao: "criar" } });
      if (error) { toast("Não consegui falar com a Meta: " + (error.message ?? ""), "err"); return; }
      const r = (data as any)?.resultado ?? [];
      const criados = r.filter((x: any) => x.acao === "criado").length;
      const jaExistiam = r.filter((x: any) => x.acao === "ja_existia").length;
      const erros = r.filter((x: any) => x.acao === "erro");
      if (erros.length) toast(`${erros.length} template(s) recusado(s): ${erros.map((e: any) => `${e.etapa} — ${e.erro}`).join(" | ")}`, "err");
      else toast(`${criados} enviado(s) para aprovação${jaExistiam ? `, ${jaExistiam} já existia(m)` : ""}. A revisão da Meta costuma levar de minutos a algumas horas.`, "ok");
      await consultarTemplates();
    } finally { setMsgMetaBusy(false); }
  };
  const salvarMsgConfig = async () => {
    // Nome fora do padrão da Meta só se descobre quando a mensagem não chega —
    // e aí o candidato já ficou sem retorno. Barra antes de salvar.
    const invalidos = msgCfgs.filter(c => nomeTemplateInvalido(c.template_nome));
    if (invalidos.length) {
      toast(`Nome de template inválido em ${invalidos.map(c => c.etapa).join(", ")}. Use só minúsculas, números e underscore.`, "err");
      return;
    }
    setMsgSalvando(true);
    const nome = user?.user_metadata?.nome ?? user?.email ?? "";
    const rows = msgCfgs.map(c => ({
      etapa: c.etapa,
      // Ligar sem template só produziria erro de envio a cada card movido.
      ativo: !!c.ativo && !!String(c.template_nome ?? "").trim(),
      template_nome: String(c.template_nome ?? "").trim() || null,
      template_idioma: String(c.template_idioma ?? "").trim() || "pt_BR",
      parametros: Array.isArray(c.parametros) ? c.parametros : [],
      texto_previa: String(c.texto_previa ?? "").trim() || null,
      updated_at: new Date().toISOString(), updated_por: nome,
    }));
    const { error } = await (supabase as any).from("RECRUTAMENTO_MENSAGENS").upsert(rows, { onConflict: "etapa" });
    setMsgSalvando(false);
    if (error) { toast("Erro ao salvar: " + error.message, "err"); return; }
    // "Salvo" sozinho já enganou: dá a entender que passou a enviar, quando o
    // que foi salvo pode ser quatro etapas desligadas. O aviso diz o que vale.
    const ligadasSemTemplate = msgCfgs.filter(c => c.ativo && !String(c.template_nome ?? "").trim());
    const ligadas = rows.filter(r => r.ativo);
    if (ligadasSemTemplate.length) toast(`Sem nome do template, ${ligadasSemTemplate.map(c => c.etapa).join(" e ")} ficou(aram) desligada(s).`, "info");
    else if (!ligadas.length) toast("Salvo — mas nenhuma etapa está enviando. Marque \"Enviar automaticamente\" na etapa desejada.", "info");
    else toast(`Salvo. Enviando automaticamente em: ${ligadas.map(r => r.etapa).join(", ")}.`, "ok");
    setMsgModal(false);
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
    setCandMateriais("");
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
    // Na etapa paralela quem carimba é aprovarParalelo, setor por setor —
    // aqui só passa a movimentação final para ADMISSÃO.
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
      APROVADO: "Aprovado nas entrevistas",
      "DOCUMENTAÇÃO": "Aprovado → Documentação",
      [ETAPA_SST_COMPRAS]: "Documentação OK → SST + Compras",
      "ADMISSÃO": "SST e Compras aprovaram → Admissão",
      Reprovado: "Candidato reprovado",
    };
    if (drawerId) await logHistorico(drawerId, eventoTxt[novaEtapa] || `Movido para ${novaEtapa}`, {
      de: origem, para: novaEtapa, papel: PAPEL_ETAPA[origem] || "Recrutamento",
      candidatoId: id, candidatoNome: cand?.nome,
      detalhe: extra.motivo_reprovacao || extra.juridico_obs || extra.sst_obs || undefined,
    });
    toast(`Candidato movido para "${novaEtapa}".`, "ok");
    if (!reprovado) await dispararMensagemEtapa(id, novaEtapa, cand?.nome);
    if (drawerId) loadCandidatos(drawerId);
  };

  // ── Lupinha do card: detalhes + cadastro na empresa ───────────────
  // Abrir a lupa a partir do kanban passava emps: [] e a seção "Cadastros na
  // empresa" nunca aparecia ali — só no Banco de Talentos, que já carregava
  // isso em lote. Agora busca sob demanda, pelo CPF, na hora do clique.
  const abrirDetalheCandidato = async (c: Curriculo) => {
    const base = { nome: c.nome || "Candidato", cpf: c.cpf || "", telefone: c.telefone, email: c.email, itens: [c] };
    setDetalheEmp({ ...base, emps: [] });
    if (!c.cpf) return;
    const { data } = await (supabase as any).rpc("empregados_por_cpfs", { p_cpfs: [c.cpf] });
    if (data?.length) setDetalheEmp({ ...base, emps: data });
  };

  // ── Etapa paralela: SST e Compras ─────────────────────────────────
  // Cada setor aprova o SEU lado; a Admissão só libera com os dois verdes.
  // Antes isto era uma fila (SST → Compras), o que fazia o segundo setor
  // esperar sem motivo — os dois trabalhos são independentes.
  // ── Desistência ───────────────────────────────────────────────────
  // O candidato pode desistir em QUALQUER etapa. Não é reprovação: quem
  // reprova é a empresa, quem desiste é ele — e a diferença importa para o
  // indicador e para reaproveitar a pessoa no banco de talentos. Por isso
  // campos próprios, e a etapa de origem fica guardada (senão o "onde
  // perdemos candidato" fica cego, já que a etapa passa a ser Reprovado).
  const [desistModal, setDesistModal] = useState<{ id: number; nome: string; etapa: string } | null>(null);
  const [desistMotivo, setDesistMotivo] = useState("");

  const confirmarDesistencia = async () => {
    if (!desistModal) return;
    if (!desistMotivo.trim()) { toast("Informe o motivo da desistência.", "err"); return; }
    const nowIso = new Date().toISOString();
    const nome = user?.user_metadata?.nome ?? user?.email ?? "";
    const { id, etapa } = desistModal;
    const { error } = await (supabase as any).from("WA_CURRICULOS").update({
      desistiu: true, desistencia_motivo: desistMotivo.trim(), desistencia_em: nowIso,
      desistencia_por: nome, desistencia_etapa: etapa,
      etapa_processo: "Reprovado", etapa_changed_at: nowIso,
    }).eq("id", id);
    if (error) { toast("Erro ao registrar desistência: " + error.message, "err"); return; }
    if (drawerId) await logHistorico(drawerId, `Candidato desistiu (em ${etapa})`, {
      de: etapa, para: "Reprovado", papel: "Recrutamento",
      candidatoId: id, candidatoNome: desistModal.nome, detalhe: desistMotivo.trim(),
    });
    setDesistModal(null); setDesistMotivo("");
    toast("Desistência registrada.", "ok");
    if (drawerId) loadCandidatos(drawerId);
  };

  // ── Jurídico: reprovar porém devolver ao RH ───────────────────────
  // O parecer negativo fica gravado, mas o candidato NÃO vai para Reprovado:
  // volta à Triagem com alerta para o RH decidir. Sem coluna nova — a
  // combinação juridico_ok = false + etapa <> 'Reprovado' já descreve isso.
  const devolverDoJuridico = async (cv: Curriculo) => {
    const motivo = window.prompt("Parecer do Jurídico (fica registrado no card):", "");
    if (motivo === null) return;
    if (!motivo.trim()) { toast("Informe o parecer.", "err"); return; }
    const nowIso = new Date().toISOString();
    const nome = user?.user_metadata?.nome ?? user?.email ?? "";
    const { error } = await (supabase as any).from("WA_CURRICULOS").update({
      juridico_ok: false, juridico_obs: motivo.trim(), juridico_por: nome, juridico_em: nowIso,
      etapa_processo: "TRIAGEM", etapa_changed_at: nowIso,
    }).eq("id", cv.id);
    if (error) { toast("Erro: " + error.message, "err"); return; }
    if (drawerId) await logHistorico(drawerId, "Jurídico reprovou e devolveu ao RH", {
      de: "JURÍDICO", para: "TRIAGEM", papel: "Jurídico",
      candidatoId: cv.id, candidatoNome: cv.nome, detalhe: motivo.trim(),
    });
    toast("Parecer registrado — candidato devolvido ao RH.", "ok");
    if (drawerId) loadCandidatos(drawerId);
  };

  // ── WhatsApp automático da etapa ──────────────────────────────────
  // O envio é um efeito da movimentação, não uma condição dela: se a Meta
  // recusar (template não aprovado, número inválido), o candidato já mudou de
  // etapa e o RH precisa saber para chamar na mão — daí o toast de aviso e o
  // registro em RECRUTAMENTO_MENSAGENS_LOG.
  const dispararMensagemEtapa = async (candidatoId: number, etapa: string, nome?: string) => {
    if (!ETAPAS_COM_MENSAGEM.includes(etapa)) return;
    try {
      const { data, error } = await supabase.functions.invoke("recrutamento-mensagem", {
        body: { candidato_id: candidatoId, etapa },
      });
      if (error) { toast(`WhatsApp de "${etapa}" não saiu — chame ${nome || "o candidato"} pelo ícone do WhatsApp.`, "err"); return; }
      const r = data as { enviado?: boolean; motivo?: string; detalhe?: string };
      if (r?.enviado) { toast(`WhatsApp de "${etapa}" enviado ao candidato.`, "ok"); return; }
      // "desligado" é escolha do RH nas Configurações — não é falha, não avisa.
      if (r?.motivo === "desligado" || r?.motivo === "etapa_sem_mensagem") return;
      const porque = r?.motivo === "sem_telefone" ? "candidato sem telefone"
        : r?.motivo === "sem_template" ? "template não configurado"
        : r?.detalhe || "falha no envio";
      toast(`WhatsApp de "${etapa}" não saiu (${porque}). Chame pelo ícone do WhatsApp.`, "err");
    } catch {
      toast(`WhatsApp de "${etapa}" não saiu. Chame pelo ícone do WhatsApp.`, "err");
    }
  };

  const confirmarMoverCand = async () => {
    if (!candModal) return;
    const { id, novaEtapa } = candModal;
    if (novaEtapa === "Reprovado" && !candObs.trim()) { toast("Informe o motivo da reprovação.", "err"); return; }
    // Compras precisa saber O QUE comprar: sem a lista, o pedido chega vazio
    // no módulo de Suprimentos e alguém tem que voltar perguntando. Para o
    // SST a observação é opcional — o exame independe de descrição.
    if (novaEtapa === ETAPA_SST_COMPRAS && !candMateriais.trim()) {
      toast("Descreva os materiais/EPIs necessários — o Compras precisa disso.", "err"); return;
    }
    const extra: Record<string, any> = {};
    const origem = candidatos.find(c => c.id === id)?.etapa_processo;
    if (novaEtapa === ETAPA_SST_COMPRAS) {
      extra.compras_necessidades = candMateriais.trim();
      if (candObs.trim()) extra.sst_obs = candObs.trim();
    } else if (novaEtapa === "Reprovado") {
      extra.motivo_reprovacao = candObs.trim();
    } else if (candObs.trim()) {
      if (origem === "JURÍDICO")               extra.juridico_obs = candObs.trim();
      else if (origem === ETAPA_SST_COMPRAS)   extra.sst_obs = candObs.trim();
    }
    setCandModal(null);
    setCandObs("");
    setCandMateriais("");
    await executarMoverCand(id, novaEtapa, extra);
  };

  // ── Kanban Mover ──────────────────────────────────────────────
  const executarMover = async (id: number, novoStatus: string, oldSt: string, extra: Record<string, any>) => {
    const payload: Record<string, any> = { status: novoStatus, ...extra };
    const { error } = await (supabase as any).from("SISTEMA_RECRUTAMENTO").update(payload).eq("id", id);
    if (error) { toast("Erro ao mover card: " + error.message, "err"); loadKanban(); return; }
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
    if (data) setContratosFull(data);
  };

  const buscarEmpregados = async (term: string) => {
    empTermo.current = term;
    setLoadingEmps(true);
    const { data, error } = await (supabase as any)
      .from("EMPREGADOS")
      .select('"ID", "Nome", "Filial", "Nome Filial", "Título do Cargo", "Valor Salário", "% Insalubridade", "Escala"')
      .eq("Situação", "Trabalhando")
      .ilike("Nome", `%${term}%`)
      .order('"Nome"')
      .limit(50);
    if (empTermo.current !== term) return; // resposta de uma busca antiga — descarta
    setLoadingEmps(false);
    if (error) { toast("EMPREGADOS: " + error.message + " (" + (error.code ?? "?") + ")", "err"); return; }
    const lista = data ?? [];
    setEmpregados(lista);
    // Só a substituição trava: nos outros motivos a pessoa é molde e pode
    // servir de molde quantas vezes for.
    setPresos(ehSubstituicao(vaga.motivo_vaga)
      ? await substituidosComVagaViva(supabase, lista.map((e: any) => Number(e.ID)))
      : new Map());
  };

  const selecionarEmpregado = (emp: any) => {
    const jaTem = ehSubstituicao(vaga.motivo_vaga) ? presos.get(Number(emp.ID)) : undefined;
    if (jaTem) { toast(avisoSubstituidoPreso(jaTem), "err"); return; }
    const contratoMatch = contratoDoEmpregado(contratosFull, emp);
    const insal = parseFloat(String(emp["% Insalubridade"] ?? "0").replace(",", ".")) || 0;
    setSubstituidoId(emp.ID ?? null);
    setVaga(v => ({
      ...v,
      // Nos outros motivos o escolhido é só o molde: o nome não entra na vaga.
      nome_substituido: mostraNomeReferencia(v.motivo_vaga) ? emp.Nome : "",
      cargo: emp["Título do Cargo"] ?? "",
      salario: emp["Valor Salário"] ? `R$ ${String(emp["Valor Salário"]).replace(".", ",")}` : "",
      insalubridade_recebe: insal > 0 ? "Sim" : "Não",
      insalubridade_quanto: insal > 0 ? `${emp["% Insalubridade"]}%` : "",
      escala: emp["Escala"] ? String(emp["Escala"]) : v.escala,
      contrato: contratoMatch ? contratoMatch["NOME CONTRATO"] : v.contrato,
      contrato_id: "", posto_id: "", funcao_id: "",
    }));
    setEmpSearch(mostraNomeReferencia(vaga.motivo_vaga) ? emp.Nome : "");
    setShowEmpDrop(false);
  };

  // Cargo/contrato vêm do cadastro do escolhido (o id prova que a pessoa foi
  // escolhida na lista, não só digitada).
  const [substituidoId, setSubstituidoId] = useState<number | null>(null);

  const abrirModalVaga = () => {
    setModalVaga(true);
    setVagaStep(1);
    setEmpSearch("");
    setShowEmpDrop(false);
    setSubstituidoId(null);
    setVagaManual(false);
    setMenuVagaAberto(false);
    if (!contratosFull.length) carregarContratos();
  };

  /**
   * A mesma tela, sem o colaborador de referência.
   *
   * Cargo, contrato, escala e salário passam a ser digitados. Só existe para
   * quem tem a capacidade de vaga administrativa — ver `podePreencherVagaManual`
   * em lib/recrutamento/vagaRegras.ts, que explica por que o escritório
   * precisa disso e por que a chave é a capacidade, não o setor.
   *
   * Já marca `administrativa`: quem abre vaga à mão está abrindo vaga do
   * escritório, e deixar os dois desencontrados criaria a vaga fora da vista
   * de quem a criou.
   */
  const abrirModalVagaManual = () => {
    abrirModalVaga();
    setVagaManual(true);
    setVaga((v: any) => ({ ...v, administrativa: true }));
  };

  // Prazo/grau da data escolhida — o grau não é mais escolhido na mão.
  const prazo = avaliarPrazo(vaga.data_inicio_prevista);
  const cnhDoCargo = cargoExigeCnh(vaga.cargo);

  const vagaValidar = (step: number) => {
    if (step === 1) {
      if (!vaga.motivo_vaga) { toast("Selecione o motivo da vaga.", "err"); return false; }

      // No modo manual ninguém preenche por você: o que o cadastro daria vira
      // digitação, e o que era "escolha alguém" vira "informe o campo".
      if (vagaManual) {
        const faltam = faltamCamposManuais(vaga);
        if (faltam.length) {
          toast(`Preenchendo à mão, ${faltam.join(" e ")} ${faltam.length > 1 ? "são obrigatórios" : "é obrigatório"}.`, "err");
          return false;
        }
        // Substituição é o único motivo que PRECISA dizer quem sai — é esse
        // vínculo que impede duas vagas repondo a mesma pessoa.
        if (ehSubstituicao(vaga.motivo_vaga) && !substituidoId) {
          toast("Em Substituição, escolha na lista quem será substituído — mesmo preenchendo o resto à mão.", "err");
          return false;
        }
      } else if (!substituidoId) {
        toast(ehSubstituicao(vaga.motivo_vaga)
          ? "Escolha na lista o colaborador que será substituído — o cargo e o contrato vêm do cadastro dele."
          : "Escolha na lista alguém com o mesmo cargo da vaga — é de lá que vêm cargo, contrato, escala e salário.", "err");
        return false;
      }

      const jaTem = ehSubstituicao(vaga.motivo_vaga) && substituidoId ? presos.get(substituidoId) : undefined;
      if (jaTem) { toast(avisoSubstituidoPreso(jaTem), "err"); return false; }
      if (!vaga.contrato)    { toast("Selecione o contrato.", "err"); return false; }
      if (!vaga.cargo.trim()){ toast("Informe o cargo.", "err"); return false; }
      if (!vaga.contrato_id) { toast("Selecione o contrato do catálogo de Suprimentos.", "err"); return false; }
      if (!vaga.posto_id)    { toast("Selecione o posto do catálogo de Suprimentos.", "err"); return false; }
      if (!vaga.funcao_id)   { toast("Selecione a função do catálogo de Suprimentos.", "err"); return false; }
    }
    if (step === 2) {
      if (!prazo.ok) { toast(prazo.erro ?? "Revise a data de início prevista.", "err"); return false; }
    }
    if (step === 3) {
      if (!prazo.ok) { toast(prazo.erro ?? "Revise a data de início prevista.", "err"); return false; }
      if (!vaga.req_obrigatorios.trim() && !cnhDoCargo) { toast("Informe os requisitos obrigatórios.", "err"); return false; }
    }
    return true;
  };

  const submitVaga = async () => {
    if (!vagaValidar(1) || !vagaValidar(3)) return;
    const payload = {
      ...vaga,
      quantidade_vagas: parseInt(vaga.quantidade_vagas) || 1,
      // Grau e CNH saem das regras (o trigger recalcula os dois no banco).
      grau_urgencia: prazo.grau ?? "",
      req_obrigatorios: aplicarReqCnh(vaga.req_obrigatorios, vaga.cargo),
      cnh_obrigatoria: !!cnhDoCargo,
      administrativa: podeAdministrativa ? !!vaga.administrativa : false,
      // Só a substituição grava o id: é ele que trava a pessoa numa vaga só.
      substituido_id: ehSubstituicao(vaga.motivo_vaga) ? substituidoId : null,
      status: "Pendente Analista",
      solicitante_nome: user?.user_metadata?.nome ?? user?.email ?? "",
      solicitante_cpf: user?.email ?? "",
    };
    let { error, data } = await (supabase as any).from("SISTEMA_RECRUTAMENTO").insert(payload).select("id").single();
    // Banco ainda sem as colunas novas: reenvia sem elas.
    if (error && /column|schema cache/i.test(error.message)) {
      const { cnh_obrigatoria, substituido_id, contrato_id, posto_id, funcao_id, ...semColunasNovas } = payload as any;
      ({ error, data } = await (supabase as any).from("SISTEMA_RECRUTAMENTO").insert(semColunasNovas).select("id").single());
    }
    if (error) { toast("Erro ao solicitar vaga: " + error.message, "err"); return; }
    toast(`Solicitação #${data?.id} criada com sucesso!`, "ok");
    setModalVaga(false);
    setVaga({ motivo_vaga:"",administrativa:false,nome_substituido:"",contrato:"",cargo:"",contrato_id:"",posto_id:"",funcao_id:"",estado:"",cidade:"",
      quantidade_vagas:"1",data_inicio_prevista:"",escala:"",horario:"",salario:"",
      insalubridade_recebe:"Não",insalubridade_quanto:"",beneficios:"",local_exato:"",
      grau_urgencia:"",alta_rotatividade:"Não",req_obrigatorios:"",req_desejaveis:"",
      exp_minima:"Não",exp_minima_qual:"",motivos_saida:"",recomendacao:"",observacao_importante:"" });
    setVagaStep(1);
    setEmpSearch("");
    setShowEmpDrop(false);
    setSubstituidoId(null);
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
  /**
   * "Solicitado por": nome de quem pediu, com o e-mail embaixo em letra miúda.
   * O e-mail continua ali porque é o que identifica homônimos e o que aparece
   * nas outras telas; o que muda é a ordem de leitura — o nome vem primeiro.
   */
  const quemSolicitou = (s: Solicitacao) => {
    const email = emailSolicitante(s);
    const gravado = String(s.solicitante_nome ?? "").trim();
    const nome = (gravado && !gravado.includes("@") ? gravado : "") || nomeSolicitante;
    if (!nome) return email;   // sem cadastro em EMPREGADOS: o e-mail é melhor que nada
    return (
      <span style={{ display: "inline-flex", flexDirection: "column", lineHeight: 1.35 }}>
        <span>{nome}</span>
        {email && <span style={{ fontSize: 11, fontWeight: 600, color: "#94a3b8" }}>{email}</span>}
      </span>
    );
  };

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
          {di("Motivo da Vaga", motivoLabel(s.motivo_vaga))}
          {s.administrativa ? di("Tipo de vaga", "Administrativa (escritório)") : null}
          {di("Escala", s.escala)}
          {di("Horário", s.horario)}
          {di("Salário", s.salario)}
          {di("Benefícios", s.beneficios, true)}
          {di("Insalubridade", s.insalubridade_recebe + (s.insalubridade_quanto ? " — " + s.insalubridade_quanto : ""))}
          {di("Local Exato", s.local_exato)}
          {di("Data Início Prevista", fmtBr(s.data_inicio_prevista))}
          {di("Solicitado por", quemSolicitou(s))}
          {di("Data Solicitação", fmtDt(s.created_at))}
          {s.aprovado_por_nome ? di("Aprovado/Reprovado por", s.aprovado_por_nome) : null}
        </div>
        {mostraNomeReferencia(s.motivo_vaga) ? dd("Colaborador Substituído", s.nome_substituido) : null}
        {/* Remarcações da data de início — quem pediu, quando e por quê. */}
        {Array.isArray((s as any).data_inicio_alteracoes) && (s as any).data_inicio_alteracoes.length > 0 && (
          <div style={{ marginBottom: 12 }}>
            <div className="rec-dd-label">Alterações da Data de Início ({(s as any).data_inicio_alteracoes.length})</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {(s as any).data_inicio_alteracoes.map((a: any, i: number) => (
                <div key={i} style={{ background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 9, padding: "8px 11px", fontSize: 12.5, color: "#78350f" }}>
                  <div style={{ fontWeight: 800 }}>
                    {fmtBr(a?.de) || "—"} → {fmtBr(a?.para)}
                    <span style={{ fontWeight: 600, color: "#a16207" }}>
                      {a?.por_nome ? ` · ${a.por_nome}` : ""}{a?.em ? ` · ${fmtDt(a.em)}` : ""}
                    </span>
                  </div>
                  <div style={{ fontStyle: "italic", marginTop: 2 }}>{a?.justificativa}</div>
                </div>
              ))}
            </div>
          </div>
        )}
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

    // Etapa 1 → 2: o ANALISTA aprova a solicitação (02/09/2026 — era do
    // Operacional, que ficou só com o acompanhamento).
    if (s.status === "Pendente Analista" && podeAprovarAnalista) {
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
    Solicitante: "#0f3171", Analista: "#b45309", Operacional: "#b45309", Recrutamento: "#2563eb",
    "Jurídico": "#7c3aed", SST: "#ea580c",
  } as Record<string, string>)[p || ""] || "#64748b");

  const renderHistorico = () => {
    const criada = drawerSol ? [{
      created_at: drawerSol.created_at,
      evento: "Solicitação criada",
      papel: "Solicitante",
      usuario_nome: drawerSol.solicitante_nome,
      para_status: "Pendente Analista",
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
      (grupos[normalizarEtapa(e)] = grupos[normalizarEtapa(e)] || []).push(c);
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
              <button onClick={abrirMsgConfig} title="Definir a mensagem de WhatsApp que o sistema envia em cada etapa"
                style={{ padding: "5px 12px", borderRadius: 8, border: "1px solid rgba(37,211,102,.3)", background: "rgba(37,211,102,.1)", color: "#128c7e", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>⚙️ Mensagens automáticas</button>
            )}
            {podeRecrutar && (
              <button onClick={abrirCurriculos} style={{ padding: "5px 12px", borderRadius: 8, border: "1px solid rgba(34,197,94,.25)", background: "rgba(34,197,94,.1)", color: "#22c55e", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>+ Selecionar dos currículos</button>
            )}
          </div>
        </div>
        {candidatos.length === 0 ? (
          <div style={{ border: "1px dashed #cbd5e1", borderRadius: 12, padding: "26px 16px", textAlign: "center", color: "#94a3b8", fontSize: 12.5 }}>
            Nenhum candidato selecionado ainda. Abra <b>Currículos</b> e clique em <b>Selecionar candidato</b> para iniciar o processo (Triagem → Jurídico → Entrevistas → Aprovado → Documentação → Exame SST → Compras → Admissão).
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
                    <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: ".4px", flex: 1, textTransform: "uppercase", color: meta.label }}>{ETAPA_LABEL[etapa] ?? etapa}</span>
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
                              <button onClick={() => abrirDetalheCandidato(c)} title="Ver detalhes e procurar cadastro dele na empresa"
                                style={{ flexShrink: 0, width: 20, height: 20, padding: 0, display: "inline-flex", alignItems: "center", justifyContent: "center", borderRadius: 6, border: "1px solid #e2e8f0", background: "#f8fafc", cursor: "pointer", fontSize: 10.5 }}>🔍</button>
                            </div>
                            {c.cpf && <div style={{ fontSize: 10, color: "#94a3b8" }}>CPF {c.cpf}</div>}
                            {c.telefone && (
                              <div style={{ fontSize: 10, color: "#475569", display: "flex", alignItems: "center", gap: 5 }}>
                                <span>📞 {c.telefone}</span>
                                {temWhatsApp(c) && (
                                  <button onClick={() => abrirWhatsAppInterno(c)} title="Abrir a conversa na Caixa de Entrada do WhatsApp"
                                    style={{ flexShrink: 0, width: 17, height: 17, padding: 0, border: "none", cursor: "pointer", borderRadius: "50%", background: "#25d366", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
                                    <svg width="10" height="10" viewBox="0 0 24 24" fill="#fff" aria-hidden>
                                      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z"/>
                                    </svg>
                                  </button>
                                )}
                              </div>
                            )}
                            {c.juridico_ok === true && <div style={{ fontSize: 9.5, color: "#15803d", marginTop: 3, fontWeight: 700 }}>✓ Jurídico aprovado</div>}
                            {c.juridico_ok === false && <div style={{ fontSize: 9.5, color: "#b91c1c", marginTop: 3, fontWeight: 700 }}>⛔ Restrito (Jurídico)</div>}
                            {c.sst_ok === true && <div style={{ fontSize: 9.5, color: "#15803d", marginTop: 3, fontWeight: 700 }}>✓ SST aprovou</div>}
                            {c.sst_ok === false && <div style={{ fontSize: 9.5, color: "#b91c1c", marginTop: 3, fontWeight: 700 }}>⛔ Reprovado no SST</div>}
                            {c.compras_ok === true && <div style={{ fontSize: 9.5, color: "#15803d", marginTop: 3, fontWeight: 700 }}>✓ Compras aprovou</div>}
                            {c.compras_ok === false && <div style={{ fontSize: 9.5, color: "#b91c1c", marginTop: 3, fontWeight: 700 }}>⛔ Reprovado no Compras</div>}
                            {etapa === "Reprovado" && c.desistiu && (
                              <div style={{ fontSize: 9.5, color: "#b45309", marginTop: 3, fontWeight: 700 }}>
                                🚪 Desistiu{c.desistencia_etapa ? ` (em ${c.desistencia_etapa})` : ""}
                              </div>
                            )}
                            {etapa === "Reprovado" && c.desistiu
                              ? c.desistencia_motivo && <div style={{ fontSize: 10.5, color: "#b45309", marginTop: 4 }}>Motivo: {c.desistencia_motivo}</div>
                              : etapa === "Reprovado" && c.motivo_reprovacao && <div style={{ fontSize: 10.5, color: "#b91c1c", marginTop: 4 }}>Motivo: {c.motivo_reprovacao}</div>}
                            {/* Etapa paralela: mostra QUEM falta, que é a única
                                informação que importa enquanto os dois correm. */}
                            {etapa === ETAPA_SST_COMPRAS && (
                              <div style={{ display: "flex", gap: 6, marginTop: 5, flexWrap: "wrap" }}>
                                {([["SST", c.sst_ok === true], ["Compras", c.compras_ok === true]] as [string, boolean][]).map(([rot, ok]) => (
                                  <span key={rot} style={{ fontSize: 9.5, fontWeight: 700, padding: "1px 7px", borderRadius: 20,
                                    background: ok ? "#dcfce7" : "#fef3c7", color: ok ? "#15803d" : "#b45309" }}>
                                    {ok ? "✅" : "⏳"} {rot}
                                  </span>
                                ))}
                              </div>
                            )}
                            {etapa === "DOCUMENTAÇÃO" && (docsCount[c.id] ?? 0) > 0 && <div style={{ fontSize: 9.5, color: "#0e7490", marginTop: 4, fontWeight: 700 }}>📎 {docsCount[c.id]} documento{docsCount[c.id] > 1 ? "s" : ""}</div>}
                            {etapa === "ADMISSÃO" && c.enviado_admissao_em && <div style={{ fontSize: 9.5, color: "#15803d", marginTop: 4, fontWeight: 700 }}>✓ Contratado — na Admissão (RH)</div>}
                            <div style={{ display: "flex", flexDirection: "column", gap: 5, marginTop: 10 }}>
                              {/* ENTREVISTA/GESTOR: roteiro de entrevista */}
                              {(etapa === "ENTREVISTA" || etapa === "ENTREVISTA GESTOR") && podeRecrutar && <button onClick={() => abrirRoteiro(c, etapa)} style={{ ...bFull, background: "rgba(59,130,246,.1)", color: "#2563eb", border: "1px solid rgba(59,130,246,.3)" }}>📋 Roteiro de entrevista</button>}
                              {/* DOCUMENTAÇÃO: anexos do candidato (vários, cada um com título) */}
                              {etapa === "DOCUMENTAÇÃO" && podeRecrutar && <button onClick={() => abrirDocs(c)} style={{ ...bFull, background: "rgba(8,145,178,.1)", color: "#0e7490", border: "1px solid rgba(8,145,178,.3)" }}>📎 Documentos ({docsCount[c.id] ?? 0})</button>}
                              {/* Avançar — com ramificação em TRIAGEM e ENTREVISTA */}
                              {etapa === "TRIAGEM" && podeAqui ? (<>
                                <button onClick={() => pedirMoverCand(c, "JURÍDICO")} style={{ ...avancaBtn, background: "#8b5cf6" }}>Enviar ao Jurídico</button>
                                <button onClick={() => pedirMoverCand(c, "ENTREVISTA")} style={bSkip}>Pular Jurídico →</button>
                              </>) : etapa === "ENTREVISTA" && podeAqui ? (<>
                                <button onClick={() => pedirMoverCand(c, "ENTREVISTA GESTOR")} style={{ ...avancaBtn, background: "#6366f1" }}>Entrevista c/ Gestor</button>
                                <button onClick={() => pedirMoverCand(c, "APROVADO")} style={bSkip}>Pular Gestor →</button>
                              </>) : etapa === "ADMISSÃO" ? (
                                podeRecrutar && !c.enviado_admissao_em && <button onClick={() => enviarAdmissao(c)} style={{ ...avancaBtn, background: "#16a34a" }}>✓ Contratar (enviar à Admissão)</button>
                              ) : etapa === ETAPA_SST_COMPRAS ? (
                                // Aqui o Recrutamento só ACOMPANHA. Quem aprova é
                                // cada setor no SEU módulo (SST › ASO/Admissão e
                                // Suprimentos › EPIs/Admissões), onde só ele entra.
                                // Botão de aprovar neste kanban deixaria o
                                // Recrutamento assinar etapa alheia.
                                <div style={{ fontSize: 9.5, color: "#94a3b8", textAlign: "center", padding: "2px 0" }}>
                                  Aguardando {c.sst_ok !== true && c.compras_ok !== true ? "SST e Compras"
                                    : c.sst_ok !== true ? "SST" : "Compras"}
                                </div>
                              ) : (CAND_PROX[etapa] && podeAqui && (
                                <button onClick={() => pedirMoverCand(c, CAND_PROX[etapa])} style={{ ...avancaBtn, background: "#16a34a" }}>{labelProx(etapa)}</button>
                              ))}
                              {etapa === "JURÍDICO" && podeMoverJuridico && (
                                <button onClick={() => devolverDoJuridico(c)} style={{ ...bSkip, color: "#b45309", borderColor: "#fde68a" }}>⚠ Reprovar e devolver ao RH</button>
                              )}
                              {etapa !== "ADMISSÃO" && etapa !== "Reprovado" && podeAqui && <button onClick={() => pedirMoverCand(c, "Reprovado")} style={{ width: "100%", fontSize: 10.5, fontWeight: 700, padding: "4px", borderRadius: 7, background: "transparent", border: "none", color: "#94a3b8", cursor: "pointer" }}>Reprovar</button>}
                              {/* Desistência: cabe em QUALQUER etapa, porque
                                  desistir é decisão do candidato e ele pode
                                  tomá-la a qualquer momento. */}
                              {etapa !== "Reprovado" && podeRecrutar && (
                                <button onClick={() => { setDesistMotivo(""); setDesistModal({ id: c.id, nome: c.nome || "Candidato", etapa }); }}
                                  title="Registrar que o candidato desistiu"
                                  style={{ width: "100%", fontSize: 10, fontWeight: 700, padding: "3px", borderRadius: 7, background: "transparent", border: "none", color: "#cbd5e1", cursor: "pointer" }}>🚪 Desistiu</button>
                              )}
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

  // O Operacional analisa o que chega; abrir vaga é do encarregado/recrutamento.
  const canNovaVaga = !isRH && !soEtapa1;
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
        <div style={{ fontSize: 19, fontWeight: 800, color: "#0f3171" }}>
          {!soEtapa1 ? "🎯 Seleção e Recrutamento"
            : escopo === "analista" ? "🎯 Gestão Recrutamento — aguardando o analista"
            : "🎯 Gestão Recrutamento — acompanhamento"}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          {/* Vale para os três escopos: o fluxo é o mesmo, muda só onde a
              pessoa entra nele. */}
          <ResumoDeFuncoes fluxo="vaga" />
          {podeRecrutar && (
            <button onClick={copiarLinkPortal} title="Copia o link público (/vagas) para os candidatos escolherem a cidade e enviarem o currículo" style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "7px 14px", borderRadius: 10, border: "1px solid #f97316", background: "rgba(249,115,22,.10)", color: "#ea580c", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
              🔗 {portalCopiado ? "Link copiado!" : "Copiar link de candidatura"}
            </button>
          )}
          {canNovaVaga && (
            /* O botão ganha um menu ao lado, e não outro botão: preencher à
               mão é a EXCEÇÃO (vaga do escritório, sem molde no cadastro), e
               exceção não disputa espaço com o caminho normal. Só aparece
               para quem tem a capacidade de vaga administrativa. */
            <div style={{ position: "relative", display: "inline-flex", alignItems: "center", gap: 4 }}>
              <button onClick={abrirModalVaga} style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "7px 14px", borderRadius: 10, border: "none", background: "#0f3171", color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer", boxShadow: "0 10px 22px rgba(15,49,113,.18)" }}>
                + Nova Solicitação
              </button>
              {podeAdministrativa && (
                <>
                  <button
                    type="button"
                    aria-label="Mais opções de solicitação de vaga"
                    aria-haspopup="menu"
                    aria-expanded={menuVagaAberto}
                    onClick={(e) => { e.stopPropagation(); setMenuVagaAberto(v => !v); }}
                    style={{ width: 28, height: 28, borderRadius: 8, border: "1px solid #e2e8f0", background: "#fff", color: "#475569", fontSize: 15, lineHeight: 1, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
                  >
                    ⋯
                  </button>
                  {menuVagaAberto && (
                    <>
                      {/* Overlay transparente fecha ao clicar fora, sem
                          listener global que alguém esquece de remover. */}
                      <div onClick={() => setMenuVagaAberto(false)}
                           style={{ position: "fixed", inset: 0, zIndex: 60 }} />
                      <div role="menu" style={{ position: "absolute", top: 34, right: 0, zIndex: 61, minWidth: 262, background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, boxShadow: "0 12px 32px rgba(15,23,42,.16)", padding: 5, textAlign: "left" }}>
                        <button role="menuitem" type="button" onClick={abrirModalVagaManual}
                                style={{ display: "block", width: "100%", padding: "9px 11px", border: "none", borderRadius: 9, background: "transparent", cursor: "pointer", fontFamily: "inherit", fontSize: 12.5, fontWeight: 700, color: "#0f172a", textAlign: "left" }}
                                onMouseEnter={e => { e.currentTarget.style.background = "#eef4ff"; }}
                                onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}>
                          ✍️ Preencher manualmente
                          <small style={{ display: "block", marginTop: 3, fontWeight: 500, fontSize: 11, color: "#64748b", lineHeight: 1.35, whiteSpace: "normal" }}>
                            Vaga do escritório: você digita cargo, contrato, escala e salário
                            em vez de copiar de um colaborador.
                          </small>
                        </button>
                      </div>
                    </>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: "auto", padding: "20px 24px 24px" }}>

        {/* O Operacional acompanha, não decide. Dizer isso é melhor do que
            simplesmente não desenhar botão: sem a frase, quem abre o card fica
            procurando onde clicar para aprovar. */}
        {escopo === "operacional" && (
          <div style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "12px 16px", marginBottom: 16, border: "1px solid #e2e8f0", borderRadius: 12, background: "#fff", fontSize: 13, color: "#475569" }}>
            <span style={{ fontSize: 15, lineHeight: "18px" }}>👁️</span>
            <span>
              Esta tela é de <strong>acompanhamento</strong>. Quem aprova a solicitação de vaga
              é o analista, em Licitações › Analistas Validações. Aqui você abre o card,
              vê o andamento e a conversa.
            </span>
          </div>
        )}

        {/* KPIs */}
        <div style={{ display: "grid", gridTemplateColumns: soEtapa1 ? "repeat(3,1fr)" : "repeat(5,1fr)", gap: 12, marginBottom: 20 }}>
          {(soEtapa1
            ? [
              // A fila desta tela, e o destino de quem já passou por ela — é o
              // que o operacional pergunta ("aprovei quantas hoje?").
              { label: "Aguardando você",  val: stats.pendentes,       color: "#f59e0b" },
              { label: "Já aprovadas",     val: stats.ag_treinamentos, color: "#8b5cf6" },
              { label: "Reprovadas",       val: stats.reprovadas,      color: "#dc2626" },
            ]
            : [
              // "Pend. Operacional" não entra: essa fila é do módulo Operacional.
              { label: "Total",            val: stats.total,           color: "#0f3171" },
              { label: "Pend. Recrutamento",val: stats.ag_treinamentos, color: "#8b5cf6" },
              { label: "Em Processo",      val: stats.em_processo,     color: "#3b82f6" },
              { label: "Concluídas",       val: stats.contratados,     color: "#16a34a" },
              { label: "Reprovadas",       val: stats.reprovadas,      color: "#dc2626" },
            ]
          ).map(k => (
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
            {/* Filtros de status (linha única). No Operacional a lista já é
                fixa em "Pendente Analista": outro filtro de status viraria
                um segundo .eq na mesma coluna e zeraria a tela sem explicar. */}
            {/* O Operacional também filtra. Sem isto ele só via a própria fila
                (Pendente Operacional) e não conseguia voltar no que já tinha
                aprovado ou reprovado — nem abrir o chat daqueles casos. */}
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 14 }}>
              {(soEtapa1
              ? [
                { label: "Aguardando você", val: "Pendente Analista" },
                // Aprovar pelo Operacional manda para o Recrutamento; daí em
                // diante o caso anda sozinho. Por isso "já aprovadas" não é um
                // status só, e cada etapa vira um recorte próprio.
                { label: "Já aprovadas", val: "Pendente Recrutamento" },
                { label: "Em processo", val: "em_processo" },
                { label: "Concluídas", val: "concluido" },
                { label: "Reprovadas", val: "Reprovada" },
                { label: "Todas", val: "" },
              ]
              : [
                { label: "Todas", val: "" },
                { label: "Pendente Recrutamento", val: "Pendente Recrutamento" },
                { label: "Em Processo", val: "em_processo" },
                { label: "Concluídas", val: "concluido" },
                { label: "Reprovados", val: "Reprovada" },
              ]).map(p => (
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
            <button onClick={() => { setCandModal(null); setCandObs(""); setCandMateriais(""); }} style={{ position: "absolute", top: 14, right: 14, background: "none", border: "none", color: "#94a3b8", fontSize: 20, cursor: "pointer" }}>✕</button>
            <div style={{ fontSize: 17, fontWeight: 800, marginBottom: 4 }}>
              {candModal.novaEtapa === "Reprovado" ? "Reprovar candidato" : `Mover para "${candModal.novaEtapa}"`}
            </div>
            <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 14 }}>{candModal.nome}</div>
            {candModal.novaEtapa === ETAPA_SST_COMPRAS && (
              <div className="rec-fg">
                <label>Materiais / EPIs necessários *</label>
                <textarea className="rec-fi" rows={3} placeholder="Ex.: 2 uniformes tam. M, botina 42, luva de raspa, protetor auricular…" value={candMateriais} onChange={e => setCandMateriais(e.target.value)} />
                <div style={{ fontSize: 10.5, color: "#94a3b8", marginTop: 4 }}>
                  Vai para o Suprimentos (EPIs — Admissões), que é quem compra.
                </div>
              </div>
            )}
            <div className="rec-fg">
              <label>{candModal.novaEtapa === "Reprovado" ? "Motivo *"
                : candModal.novaEtapa === ETAPA_SST_COMPRAS ? "Observação para o SST (opcional)"
                : "Observação (opcional)"}</label>
              <textarea className="rec-fi" rows={3} placeholder={candModal.novaEtapa === "Reprovado" ? "Descreva o motivo..." : "Observação da etapa..."} value={candObs} onChange={e => setCandObs(e.target.value)} />
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 4 }}>
              <button onClick={() => { setCandModal(null); setCandObs(""); setCandMateriais(""); }} style={{ padding: "7px 14px", borderRadius: 10, border: "1px solid #e2e8f0", background: "#fff", color: "#475569", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>Cancelar</button>
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

      {/* ── Modal: Documentos do candidato (etapa DOCUMENTAÇÃO) ── */}
      {docsModal && (
        <div className="rec-modal-ov" style={{ zIndex: 860 }}>
          <div className="rec-modal" style={{ maxWidth: 660 }}>
            <button onClick={() => { setDocsModal(null); setDocs([]); }} style={{ position: "absolute", top: 14, right: 14, background: "none", border: "none", color: "#94a3b8", fontSize: 20, cursor: "pointer" }}>✕</button>
            <div style={{ fontSize: 17, fontWeight: 800, marginBottom: 4 }}>📎 Documentos do candidato</div>
            <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 14 }}>
              {docsModal.nome} · os anexos seguem com ele para o cadastro de empregado na Admissão
            </div>

            {/* Anexar: título é obrigatório — sem ele a lista vira um monte de
                "documento (1).pdf" e ninguém sabe o que é cada arquivo. */}
            <div style={{ border: "1px solid #e2e8f0", borderRadius: 10, padding: "12px 13px", background: "#fcfdff" }}>
              <label style={{ fontSize: 11.5, fontWeight: 800, color: "#475569" }}>Título do documento *</label>
              <input value={docTitulo} onChange={e => setDocTitulo(e.target.value)} placeholder="Ex.: RG, CPF, Comprovante de residência, CTPS…"
                style={{ width: "100%", marginTop: 5, height: 34, border: "1px solid #e2e8f0", borderRadius: 8, padding: "0 10px", fontSize: 13, outline: "none" }} />
              <input type="file" onChange={e => setDocFile(e.target.files?.[0] ?? null)}
                style={{ width: "100%", marginTop: 9, fontSize: 12.5, color: "#475569" }} />
              <button onClick={anexarDoc} disabled={docSubindo}
                style={{ marginTop: 10, padding: "7px 14px", borderRadius: 9, border: "none", background: docSubindo ? "#94a3b8" : "#0891b2", color: "#fff", fontSize: 12, fontWeight: 700, cursor: docSubindo ? "default" : "pointer" }}>
                {docSubindo ? "Anexando…" : "+ Anexar documento"}
              </button>
            </div>

            <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 7, maxHeight: "42vh", overflowY: "auto" }}>
              {docs.length === 0 ? (
                <div style={{ textAlign: "center", color: "#94a3b8", fontSize: 12.5, padding: "18px 8px" }}>Nenhum documento anexado ainda.</div>
              ) : docs.map(d => (
                <div key={d.id} style={{ display: "flex", alignItems: "center", gap: 10, border: "1px solid #e2e8f0", borderRadius: 9, padding: "8px 11px" }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 800, color: "#0f172a" }}>{d.titulo || "(sem título)"}</div>
                    <div style={{ fontSize: 11, color: "#94a3b8", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {d.nome}{d.enviado_por ? ` · ${d.enviado_por}` : ""} · {fmtDt(d.created_at)}
                    </div>
                  </div>
                  <button onClick={() => baixarDoc(d)} style={{ padding: "5px 10px", borderRadius: 7, border: "1px solid #e2e8f0", background: "#f8fafc", color: "#0f3171", fontSize: 11.5, fontWeight: 700, cursor: "pointer" }}>Abrir</button>
                  {podeRecrutar && <button onClick={() => removerDoc(d)} title="Remover" style={{ background: "none", border: "none", color: "#dc2626", cursor: "pointer", fontSize: 14 }}>✕</button>}
                </div>
              ))}
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}>
              <button onClick={() => { setDocsModal(null); setDocs([]); }} style={{ padding: "7px 14px", borderRadius: 10, border: "1px solid #e2e8f0", background: "#fff", color: "#475569", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>Fechar</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal: Mensagens automáticas de WhatsApp por etapa ── */}
      {msgModal && (
        <div className="rec-modal-ov" style={{ zIndex: 870 }}>
          <div className="rec-modal" style={{ maxWidth: 780 }}>
            <button onClick={() => setMsgModal(false)} style={{ position: "absolute", top: 14, right: 14, background: "none", border: "none", color: "#94a3b8", fontSize: 20, cursor: "pointer" }}>✕</button>
            <div style={{ fontSize: 17, fontWeight: 800, marginBottom: 4 }}>⚙️ Mensagens automáticas (WhatsApp)</div>
            <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 12 }}>
              Enviadas ao candidato quando ele é movido para a etapa.
            </div>
            {/* O RH precisa entender por que o texto não é livre aqui, senão
                digita a mensagem no campo errado e nada é enviado. */}
            <div style={{ fontSize: 11.5, color: "#92400e", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 9, padding: "9px 11px", marginBottom: 14, lineHeight: 1.5 }}>
              O WhatsApp só deixa iniciar conversa com <b>template aprovado pela Meta</b>. Cadastre a mensagem no
              Meta Business Manager, aguarde a aprovação e coloque aqui o <b>nome do template</b>. O texto abaixo é
              só a prévia que aparece na Caixa de Entrada — mudar ela não muda o que o candidato recebe.
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 12, maxHeight: "52vh", overflowY: "auto" }}>
              {msgCfgs.map((c, i) => {
                const upd = (k: string, v: any) => setMsgCfgs(cs => cs.map((x, j) => j === i ? { ...x, [k]: v } : x));
                const params: string[] = Array.isArray(c.parametros) ? c.parametros : [];
                const rotulo = c.etapa === "ENTREVISTA GESTOR" ? "ENTREVISTA GESTOR (segunda entrevista — opcional)" : c.etapa;
                return (
                  <div key={c.etapa} style={{ border: "1px solid #e2e8f0", borderRadius: 10, padding: "12px 13px", background: c.ativo ? "#f7fdf9" : "#fcfdff" }}>
                    {/* O estado ligado/desligado tem que ser lido de relance: preencher
                        o template e esquecer o check faz a etapa continuar muda, e o
                        envio desligado é silencioso de propósito. */}
                    <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 9 }}>
                      <span style={{ fontSize: 13, fontWeight: 800, color: "#0f172a", flex: 1 }}>{rotulo}</span>
                      {(() => {
                        // Status na Meta: sem APPROVED, marcar o check não faz a
                        // mensagem sair — e o RH tem que ver isso antes de marcar.
                        const st = msgStatus[c.etapa]?.status;
                        if (!st) return null;
                        const cor = st === "APPROVED" ? { bg: "#dcfce7", fg: "#15803d", txt: "aprovado na Meta" }
                          : st === "PENDING" ? { bg: "#fef3c7", fg: "#b45309", txt: "em revisão na Meta" }
                          : st === "REJECTED" ? { bg: "#fee2e2", fg: "#b91c1c", txt: "reprovado na Meta" }
                          : { bg: "#f1f5f9", fg: "#64748b", txt: "não enviado à Meta" };
                        return <span title={msgStatus[c.etapa]?.motivo || ""} style={{ fontSize: 10, fontWeight: 800, padding: "2px 8px", borderRadius: 20, background: cor.bg, color: cor.fg }}>{cor.txt}</span>;
                      })()}
                      <label style={{ display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer", userSelect: "none" }}>
                        <input type="checkbox" checked={!!c.ativo} onChange={e => upd("ativo", e.target.checked)} style={{ width: 15, height: 15, cursor: "pointer" }} />
                        <span style={{ fontSize: 11.5, fontWeight: 800, color: c.ativo ? "#15803d" : "#94a3b8" }}>
                          {c.ativo ? "Enviando automaticamente" : "Desligada — não envia nada"}
                        </span>
                      </label>
                    </div>
                    <div style={{ display: "flex", gap: 9, flexWrap: "wrap" }}>
                      <div style={{ flex: "2 1 220px" }}>
                        <label style={{ fontSize: 11, fontWeight: 800, color: "#475569" }}>Nome do template na Meta *</label>
                        <input value={c.template_nome ?? ""} onChange={e => upd("template_nome", e.target.value)} placeholder="ex.: recrutamento_triagem"
                          style={{ width: "100%", marginTop: 4, height: 32, borderRadius: 8, padding: "0 9px", fontSize: 12.5, outline: "none",
                            border: `1px solid ${nomeTemplateInvalido(c.template_nome) ? "#fca5a5" : "#e2e8f0"}` }} />
                        {nomeTemplateInvalido(c.template_nome) && (
                          <div style={{ fontSize: 10.5, color: "#b91c1c", marginTop: 3, lineHeight: 1.4 }}>
                            A Meta só aceita minúsculas, números e underscore. Use <b>{sugerirNomeTemplate(c.template_nome)}</b>
                            {" "}— e confira se é exatamente esse o nome lá no Business Manager.
                          </div>
                        )}
                      </div>
                      <div style={{ flex: "1 1 110px" }}>
                        <label style={{ fontSize: 11, fontWeight: 800, color: "#475569" }}>Idioma</label>
                        <input value={c.template_idioma ?? "pt_BR"} onChange={e => upd("template_idioma", e.target.value)}
                          style={{ width: "100%", marginTop: 4, height: 32, border: "1px solid #e2e8f0", borderRadius: 8, padding: "0 9px", fontSize: 12.5, outline: "none" }} />
                      </div>
                    </div>
                    <div style={{ marginTop: 9 }}>
                      <label style={{ fontSize: 11, fontWeight: 800, color: "#475569" }}>
                        Variáveis, na ordem dos {"{{1}}, {{2}}…"} do template
                      </label>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 5 }}>
                        {params.map((p, pi) => (
                          <span key={pi} style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, fontWeight: 700, background: "#eef4ff", border: "1px solid #dbe4f0", borderRadius: 20, padding: "3px 5px 3px 9px", color: "#0f3171" }}>
                            {`{{${pi + 1}}}`} = {p}
                            <button onClick={() => upd("parametros", params.filter((_, j) => j !== pi))} style={{ background: "none", border: "none", color: "#94a3b8", cursor: "pointer", fontSize: 12, lineHeight: 1 }}>✕</button>
                          </span>
                        ))}
                        <select value="" onChange={e => { if (e.target.value) upd("parametros", [...params, e.target.value]); }}
                          style={{ height: 25, border: "1px dashed #cbd5e1", borderRadius: 20, padding: "0 8px", fontSize: 11, color: "#0f3171", background: "#fff", cursor: "pointer" }}>
                          <option value="">+ variável</option>
                          {MSG_VARIAVEIS.map(v => <option key={v} value={v}>{v}</option>)}
                        </select>
                      </div>
                    </div>
                    <div style={{ marginTop: 9 }}>
                      <label style={{ fontSize: 11, fontWeight: 800, color: "#475569" }}>Prévia (espelho do template, só para leitura interna)</label>
                      <textarea value={c.texto_previa ?? ""} onChange={e => upd("texto_previa", e.target.value)} rows={2}
                        style={{ width: "100%", marginTop: 4, border: "1px solid #e2e8f0", borderRadius: 8, padding: "7px 9px", fontSize: 12.5, outline: "none", fontFamily: "inherit", resize: "vertical" }} />
                    </div>
                  </div>
                );
              })}
            </div>

            <div style={{ display: "flex", gap: 8, justifyContent: "space-between", alignItems: "center", marginTop: 16, flexWrap: "wrap" }}>
              <button onClick={criarTemplates} disabled={msgMetaBusy}
                title="Cria os textos na conta da empresa na Meta e os põe em revisão"
                style={{ padding: "7px 14px", borderRadius: 10, border: "1px solid rgba(37,211,102,.35)", background: msgMetaBusy ? "#f1f5f9" : "rgba(37,211,102,.1)", color: "#128c7e", fontSize: 12, fontWeight: 700, cursor: msgMetaBusy ? "default" : "pointer" }}>
                {msgMetaBusy ? "Enviando…" : "↑ Enviar textos para aprovação da Meta"}
              </button>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => setMsgModal(false)} style={{ padding: "7px 14px", borderRadius: 10, border: "1px solid #e2e8f0", background: "#fff", color: "#475569", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>Cancelar</button>
                <button onClick={salvarMsgConfig} disabled={msgSalvando} style={{ padding: "7px 14px", borderRadius: 10, border: "none", background: msgSalvando ? "#94a3b8" : "#0f3171", color: "#fff", fontSize: 12, fontWeight: 700, cursor: msgSalvando ? "default" : "pointer" }}>{msgSalvando ? "Salvando…" : "Salvar"}</button>
              </div>
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
      {desistModal && (
        <div className="rec-modal-ov" style={{ zIndex: 950 }} onClick={e => { if (e.target === e.currentTarget) setDesistModal(null); }}>
          <div className="rec-modal" style={{ maxWidth: 460 }} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: 17, fontWeight: 800, marginBottom: 2 }}>🚪 Registrar desistência</div>
            <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 14 }}>
              {desistModal.nome} · estava em <b style={{ color: "#475569" }}>{desistModal.etapa}</b>
            </div>
            <label style={{ fontSize: 11, fontWeight: 700, color: "#475569" }}>Motivo da desistência *</label>
            <textarea value={desistMotivo} onChange={e => setDesistMotivo(e.target.value)} rows={3}
              placeholder="Ex.: conseguiu outra colocação, distância, proposta salarial…"
              style={{ width: "100%", marginTop: 6, padding: "8px 10px", borderRadius: 8, border: "1px solid #e2e8f0", fontSize: 13, resize: "vertical" }} />
            <div style={{ fontSize: 10.5, color: "#94a3b8", marginTop: 6 }}>
              Fica no histórico do processo, junto da etapa em que ele estava.
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
              <button onClick={() => setDesistModal(null)} style={{ padding: "7px 14px", borderRadius: 8, background: "#fff", border: "1px solid #e2e8f0", color: "#475569", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>Cancelar</button>
              <button onClick={confirmarDesistencia} style={{ padding: "7px 14px", borderRadius: 8, background: "#b45309", border: "none", color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>Registrar desistência</button>
            </div>
          </div>
        </div>
      )}

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
                <select className="rec-fi" value={vaga.motivo_vaga}
                  onChange={e => {
                    const m = e.target.value;
                    // Trocou de motivo: limpa tudo o que veio do cadastro do
                    // escolhido anterior (senão sobra cargo/contrato/salário de
                    // outro posto) e obriga a escolher de novo.
                    setSubstituidoId(null); setEmpSearch("");
                    setVaga(v => ({
                      ...v, motivo_vaga: m, nome_substituido: "", cargo: "", contrato: "",
                      contrato_id: "", posto_id: "", funcao_id: "",
                      salario: "", escala: "", insalubridade_recebe: "Não", insalubridade_quanto: "",
                    }));
                  }}>
                  <option value="">— Selecione —</option>
                  {MOTIVOS_VAGA.map(o => <option key={o}>{o}</option>)}
                </select>
              </div>
              {/* Aviso do modo manual: a pessoa precisa saber que trocou de
                  regime, senão estranha os campos que antes vinham prontos. */}
              {vagaManual && (
                <div className="rec-fg" style={{ gridColumn: "1 / -1" }}>
                  <div style={{ fontSize: 11.5, fontWeight: 600, color: "#0f3171", background: "#eef4ff", border: "1px solid #c7d7fe", borderRadius: 9, padding: "8px 11px" }}>
                    ✍️ <b>Preenchendo à mão</b> — vaga do escritório. Cargo, contrato, escala e salário
                    são digitados por você, e não copiados de um colaborador.
                  </div>
                </div>
              )}
              {/* Em Substituição o colaborador continua obrigatório mesmo à
                  mão: é o vínculo que impede duas vagas repondo a mesma pessoa. */}
              {!!vaga.motivo_vaga && (!vagaManual || ehSubstituicao(vaga.motivo_vaga)) && (
                <div className="rec-fg" style={{ position: "relative" }}
                  onBlur={() => setTimeout(() => setShowEmpDrop(false), 150)}>
                  <label>{rotuloReferencia(vaga.motivo_vaga)} *</label>
                  <input
                    className="rec-fi"
                    placeholder="Buscar e escolher na lista..."
                    value={empSearch}
                    autoComplete="off"
                    onChange={e => {
                      const v = e.target.value;
                      setEmpSearch(v);
                      setSubstituidoId(null);
                      // Digitar não vale escolher: o que ficou do último
                      // escolhido sai daqui, e só volta quando clicarem na lista.
                      setVaga(prev => ({
                        ...prev, nome_substituido: "", cargo: "", contrato: "", salario: "", escala: "",
                        contrato_id: "", posto_id: "", funcao_id: "",
                      }));
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
                        ) : filtrados.map((emp, i) => {
                          // Já tem vaga de substituição em pé: fica na lista
                          // para a pessoa entender por que não pode escolher.
                          const preso = ehSubstituicao(vaga.motivo_vaga) ? presos.get(Number(emp.ID)) : undefined;
                          return (
                          <div key={i} onMouseDown={() => selecionarEmpregado(emp)}
                            style={{ padding: "8px 12px", fontSize: 13, cursor: preso ? "not-allowed" : "pointer", borderBottom: "1px solid #f1f5f9", color: preso ? "#94a3b8" : "#0f172a", background: preso ? "#f8fafc" : "#fff" }}
                            onMouseEnter={e => { if (!preso) e.currentTarget.style.background = "#f0f4ff"; }}
                            onMouseLeave={e => { e.currentTarget.style.background = preso ? "#f8fafc" : "#fff"; }}>
                            <div style={{ fontWeight: 600 }}>{emp.Nome}</div>
                            <div style={{ fontSize: 11, color: "#94a3b8" }}>{emp["Título do Cargo"]}{emp["Nome Filial"] ? ` · ${emp["Nome Filial"]}` : ""}</div>
                            {preso && <div style={{ fontSize: 10.5, fontWeight: 800, color: "#b91c1c", marginTop: 2 }}>🚫 já está na vaga de substituição #{preso}</div>}
                          </div>
                          );
                        });
                      })()}
                    </div>
                  )}
                  <div style={{ marginTop: 6, fontSize: 11.5, color: "#94a3b8" }}>{ajudaReferencia(vaga.motivo_vaga)}</div>
                  {/* Sem nome: nos motivos que não são Substituição o escolhido
                      é só o molde da vaga, e é isso que a tela confirma. */}
                  {!!substituidoId && !mostraNomeReferencia(vaga.motivo_vaga) && (
                    <div style={{ marginTop: 6, fontSize: 11.5, fontWeight: 700, color: "#15803d", background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 8, padding: "6px 9px" }}>
                      ✓ Colaborador escolhido — cargo, contrato, escala e salário já vieram do cadastro dele.
                    </div>
                  )}
                </div>
              )}
              {/* Contrato e cargo vêm do cadastro do escolhido e ficam travados
                  — a vaga é do posto dele, não de outro. */}
              <div className="rec-fg">
                <label>Contrato *{!vagaManual && <span style={{ color: "#94a3b8", fontWeight: 600 }}> — do colaborador escolhido</span>}</label>
                <input className="rec-fi"
                  placeholder={vagaManual ? "Ex.: ADM E ESTAGIARIOS - NH" : "Escolha o colaborador acima"}
                  value={vaga.contrato} readOnly={!vagaManual}
                  onChange={e => setVaga(v => ({ ...v, contrato: e.target.value }))}
                  style={vagaManual ? undefined : { background: "#f1f5f9", color: "#475569", cursor: "not-allowed" }} />
                {vagaManual && (
                  <div style={{ marginTop: 4, fontSize: 11, color: "#94a3b8" }}>
                    Escolher o contrato no catálogo de Suprimentos, abaixo, também preenche este campo.
                  </div>
                )}
              </div>
              <div className="rec-fg">
                <label>Cargo *{!vagaManual && <span style={{ color: "#94a3b8", fontWeight: 600 }}> — do colaborador escolhido</span>}</label>
                <input className="rec-fi"
                  placeholder={vagaManual ? "Ex.: Analista Administrativo" : "Escolha o colaborador acima"}
                  value={vaga.cargo} readOnly={!vagaManual}
                  onChange={e => setVaga(v => ({ ...v, cargo: e.target.value }))}
                  style={vagaManual ? undefined : { background: "#f1f5f9", color: "#475569", cursor: "not-allowed" }} />
                {cnhDoCargo && (
                  <div style={{ marginTop: 6, fontSize: 11.5, fontWeight: 700, color: "#b45309", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 8, padding: "6px 9px" }}>
                    🚗 {cnhDoCargo}: CNH obrigatória — já entra sozinha nos requisitos e não pode ser tirada.
                  </div>
                )}
              </div>
              <div className="rec-fg" style={{ gridColumn: "1 / -1" }}>
                <label>Vínculo com o catálogo de Suprimentos *</label>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 8 }}>
                  <select className="rec-fi" value={vaga.contrato_id} onChange={e => {
                    const id = e.target.value;
                    const contrato = contratosCatalogo.find(c => c.id === id);
                    setVaga(v => ({
                      ...v, contrato_id: id, posto_id: "", funcao_id: "",
                      contrato: contrato?.nome ?? v.contrato,
                    }));
                  }}>
                    <option value="">Contrato</option>
                    {contratosCatalogo.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
                  </select>
                  <select className="rec-fi" value={vaga.posto_id} disabled={!vaga.contrato_id} onChange={e => {
                    const id = e.target.value;
                    setVaga(v => ({ ...v, posto_id: id, funcao_id: "" }));
                  }}>
                    <option value="">{vaga.contrato_id ? "Posto" : "Escolha o contrato"}</option>
                    {postosCatalogo.map(p => <option key={p.id} value={p.id}>{p.nome}</option>)}
                  </select>
                  <select className="rec-fi" value={vaga.funcao_id} disabled={!vaga.posto_id} onChange={e => {
                    const id = e.target.value;
                    const funcao = funcoesCatalogo.find(f => f.id === id);
                    setVaga(v => ({ ...v, funcao_id: id, cargo: funcao?.nome ?? v.cargo }));
                  }}>
                    <option value="">{vaga.posto_id ? "Função" : "Escolha o posto"}</option>
                    {funcoesCatalogo.map(f => <option key={f.id} value={f.id}>{f.nome}</option>)}
                  </select>
                </div>
                <div style={{ marginTop: 5, fontSize: 11, color: "#64748b" }}>
                  Este vínculo define automaticamente os uniformes e EPIs da admissão.
                </div>
              </div>
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

              {podeAdministrativa && (
                <div className="rec-fg" style={{ gridColumn: "1 / -1" }}>
                  <label style={{ display: "flex", alignItems: "flex-start", gap: 9, cursor: "pointer", background: vaga.administrativa ? "#f0f6ff" : "#fff", border: vaga.administrativa ? "1.5px solid #0f3171" : "1px solid #e2e8f0", borderRadius: 11, padding: "10px 13px", transition: "background .18s, border-color .18s" }}>
                    <input type="checkbox" checked={!!vaga.administrativa} style={{ marginTop: 2, width: 15, height: 15, accentColor: "#0f3171", cursor: "pointer" }}
                      onChange={e => setVaga(v => ({ ...v, administrativa: e.target.checked }))} />
                    <span>
                      <span style={{ display: "block", fontSize: 12.5, fontWeight: 800, color: "#0f172a" }}>Vaga é administrativa?</span>
                      <span style={{ display: "block", fontSize: 11, color: "#94a3b8", marginTop: 3, lineHeight: 1.45 }}>
                        Vaga do escritório. Só quem tem “Ver vaga administrativa?” enxerga, aprova ou reprova — os demais nem veem que ela existe.
                      </span>
                    </span>
                  </label>
                </div>
              )}
            </>)}

            {/* Step 2 */}
            {vagaStep === 2 && (<>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div className="rec-fg"><label>Quantidade de Vagas</label><input className="rec-fi" type="number" min={1} max={99} value={vaga.quantidade_vagas} onChange={e => setVaga(v => ({ ...v, quantidade_vagas: e.target.value }))} /></div>
                <div className="rec-fg">
                  <label>Data de Início Prevista *</label>
                  <input className="rec-fi" type="date" min={dataMinimaVaga()} value={vaga.data_inicio_prevista}
                    onChange={e => setVaga(v => ({ ...v, data_inicio_prevista: e.target.value }))} />
                </div>
              </div>
              <PrazoAviso prazo={prazo} />
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
                {/* Grau não é mais escolhido: sai do prazo da data de início. */}
                <div className="rec-fg">
                  <label>Grau de Urgência — calculado pelo prazo</label>
                  <input className="rec-fi" readOnly value={prazo.grau ?? "— informe a data de início —"}
                    style={{ background: "#f1f5f9", color: prazo.grau ? "#0f172a" : "#94a3b8", fontWeight: 700, cursor: "not-allowed" }} />
                </div>
                <div className="rec-fg">
                  <label>Alta Rotatividade?</label>
                  <select className="rec-fi" value={vaga.alta_rotatividade} onChange={e => setVaga(v => ({ ...v, alta_rotatividade: e.target.value }))}>
                    <option>Não</option><option>Sim</option>
                  </select>
                </div>
              </div>
              <PrazoAviso prazo={prazo} />
              <div className="rec-fg">
                <label>Requisitos Obrigatórios *</label>
                {cnhDoCargo && (
                  <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12, fontWeight: 700, color: "#b45309", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 8, padding: "7px 10px", marginBottom: 6 }}>
                    <span>🚗</span><span>{REQ_CNH_TEXTO} <span style={{ fontWeight: 600, color: "#92400e" }}>(automático para {cnhDoCargo.toLowerCase()} — vai junto mesmo que você não escreva)</span></span>
                  </div>
                )}
                <textarea className="rec-fi" rows={3} placeholder="Experiência comprovada, curso específico..." value={vaga.req_obrigatorios} onChange={e => setVaga(v => ({ ...v, req_obrigatorios: e.target.value }))} />
              </div>
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
