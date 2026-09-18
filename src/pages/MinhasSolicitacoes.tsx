import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { rotasSolicitacoes, type BaseSolicitacoes } from "@/lib/solicitacoes/rotas";
import { supabase } from "@/integrations/supabase/client";
import type { SupabaseClient } from "@supabase/supabase-js";
import { useAuth } from "@/hooks/useAuth";
import { useVinculoEmpregado } from "@/hooks/useVinculoEmpregado";
import { usePermissoes } from "@/context/PermissoesContext";
import { ESTADOS_BR, municipiosDe } from "@/data/municipios-brasil";
import { ResumoDeFuncoes } from "@/components/fluxos/ResumoDeFuncoes";
import {
  MOTIVOS_VAGA, motivoLabel, ehSubstituicao, maximoDeVagas, quantidadeValida,
  erroDaRecomendacao, recomendacaoParaBanco, cpfValido, soDigitos, maskCpf,
  avaliarPrazo, dataMinimaVaga,
  cargoExigeCnh, aplicarReqCnh, REQ_CNH_TEXTO, MIN_DIAS_UTEIS, fmtBr,
  rotuloReferencia, ajudaReferencia, mostraNomeReferencia, contratoDoEmpregado, rotuloContrato,
  SALARIO_MASCARA, substituidosComVagaViva, avisoSubstituidoPreso,
  podeVagaAdministrativa, statusInicialVaga, contratoEhAdministrativo,
} from "@/lib/recrutamento/vagaRegras";
import { maskFone } from "@/lib/telefone";
import { dataParaIso, tempoDeEmpresa } from "@/lib/rh/colaboradoresUtils";
import { BUCKET_ANEXOS, caminhoAnexo, erroDoAnexo, fmtTamanho } from "@/lib/solicitacoes/anexos";
import { solicitacaoEmAberto, TITULO_DUPLICIDADE, type SolicitacaoEmAberto } from "@/lib/solicitacoes/duplicidade";
import { buscarCustoDoPosto, insalubridadeDoCusto, beneficiosDoCusto, notaDoCusto, AVISO_SEM_POSTO, type CustoPosto } from "@/lib/recrutamento/custoPosto";
import { VinculoCatalogoVaga, type ListasCatalogo } from "@/components/recrutamento/VinculoCatalogoVaga";

// ── Helpers ────────────────────────────────────────────────────────
function fmtDt(s?: string) {
  if (!s) return "—";
  const d = new Date(s.length <= 10 ? s + "T12:00:00" : s);
  return isNaN(+d) ? (s ?? "—") : d.toLocaleDateString("pt-BR");
}
/** Dias inteiros decorridos desde a data informada (0 = hoje). */
function diasDesde(s?: string): number | null {
  if (!s) return null;
  const d = new Date(s.length <= 10 ? s + "T12:00:00" : s);
  if (isNaN(+d)) return null;
  return Math.max(0, Math.floor((Date.now() - d.getTime()) / 86400000));
}
function mesLabel(s?: string) {
  const m = String(s ?? "").match(/^(\d{4})-(\d{2})$/);
  if (!m) return s || "—";
  const meses = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
  return `${meses[+m[2] - 1] ?? m[2]}/${m[1]}`;
}
function badgeStatusCls(st: string) {
  const m: Record<string, string> = {
    "Aguardando Aprovação": "bg-yellow-100 text-yellow-800 border-yellow-200",
    "Pendente Analista": "bg-yellow-100 text-yellow-800 border-yellow-200",
    "Pendente Diretoria": "bg-amber-100 text-amber-800 border-amber-200",
    // As solicitações abertas antes de 02/09/2026 e já decididas continuam
    // gravadas com o nome antigo; sem esta linha o selo delas ficava cinza.
    "Pendente Operacional": "bg-yellow-100 text-yellow-800 border-yellow-200",
    "Pendente Recrutamento": "bg-purple-100 text-purple-700 border-purple-200",
    "Seleção de Candidato": "bg-blue-100 text-blue-700 border-blue-200",
    "Aguardando Recrutamento": "bg-purple-100 text-purple-700 border-purple-200",
    "Aguardando Jurídico": "bg-purple-100 text-purple-700 border-purple-200",
    // Demissão: as mesmas cores de corDoStatus (lib/demissao/solicitacao), pra
    // o selo não mudar de cor entre esta tela e a de quem trata o pedido.
    "Pendente RH": "bg-purple-100 text-purple-700 border-purple-200",
    "Pendente SST": "bg-cyan-100 text-cyan-800 border-cyan-200",
    // Os dois status do SST (08/09/2026). O encarregado é o principal leitor
    // deles: é aqui que ele descobre que o ASO já tem data sem ligar para o SST.
    "Solicitação de agendamento de DEMISSIONAL recebida": "bg-sky-100 text-sky-800 border-sky-200",
    "Agendamento concluído": "bg-emerald-100 text-emerald-700 border-emerald-200",
    "ASO válido": "bg-emerald-100 text-emerald-700 border-emerald-200",
    "Concluída": "bg-green-100 text-green-700 border-green-200",
    Pendente: "bg-yellow-100 text-yellow-800 border-yellow-200",
    Aprovada: "bg-green-100 text-green-700 border-green-200",
    Reprovada: "bg-red-100 text-red-700 border-red-200",
    Cancelada: "bg-slate-100 text-slate-600 border-slate-200",
    Contratado: "bg-emerald-100 text-emerald-700 border-emerald-200",
    Respondida: "bg-green-100 text-green-700 border-green-200",
    Aberta: "bg-orange-100 text-orange-700 border-orange-200",
  };
  return m[st] ?? "bg-blue-100 text-blue-700 border-blue-200";
}

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

function addDaysISO(iso: string, days: number): string {
  const dt = new Date(iso + "T12:00:00");
  dt.setDate(dt.getDate() + days);
  return dt.toISOString().slice(0, 10);
}
function hojeMaisDias(days: number): string {
  const dt = new Date();
  dt.setDate(dt.getDate() + days);
  return dt.toISOString().slice(0, 10);
}

const FERIAS_RESET = {
  colaborador_id: null as number | null, colaborador_nome: "", colaborador_cpf: "",
  colaborador_cargo: "", colaborador_filial: "", colaborador_admissao: "",
  data_saida: "", dias_ferias: "30", dias_vendidos: "0", observacoes: "",
};
const ADV_RESET = {
  colaborador_id: null as number | null, colaborador_nome: "", colaborador_cpf: "",
  colaborador_cargo: "", colaborador_filial: "", contrato: "", contrato_id: null as number | null,
  // Ficha do advertido (17/09/2026): admissão, posto e escala vão gravados como as outras colunas colaborador_*.
  colaborador_admissao: "", colaborador_posto: "", colaborador_escala: "",
  tipo_advertencia: "", grau: "", data_ocorrido: "", descricao_ocorrido: "",
  advertencia_verbal_dada: "Não", data_advertencia_verbal: "",
};
const VAGA_RESET = {
  motivo_vaga: "", administrativa: false, setor: "", nome_substituido: "", contrato: "", cargo: "",
  // Vínculo com o catálogo de Suprimentos (opcional; contrato travado no da vaga).
  contrato_id: "", posto_id: "", funcao_id: "",
  estado: "", cidade: "", quantidade_vagas: "1", data_inicio_prevista: "",
  escala: "", salario: "", insalubridade_recebe: "Não", reserva_tecnica: "Não",
  insalubridade_quanto: "", beneficios: "",
  tem_recomendacao: "Não", recomendacao_nome: "", recomendacao_cpf: "", recomendacao_whatsapp: "",
  grau_urgencia: "", alta_rotatividade: "Não", req_obrigatorios: "",
  req_desejaveis: "", exp_minima: "Não", exp_minima_qual: "",
  motivos_saida: "", recomendacao: "", observacao_importante: "",
};

import { DetalheSolicitacao, type TipoSolicitacao } from "./encarregados/DetalheSolicitacao";
import { AVISO_REFAZER, podeRefazerFerias } from "@/lib/solicitacoes/feriasRefazer";
import { BotaoCancelarDemissao } from "@/components/demissao/CancelarDemissao";

// SISTEMA_SOLICITACOES_*, EMPREGADOS, CONTRATOS... não estão no types.ts
// gerado; mesmo padrão de comite-etica/db.ts — a exceção fica num lugar só.
const db = supabase as unknown as SupabaseClient;

/** Colunas de EMPREGADOS que os modais leem do colaborador escolhido. */
type EmpregadoRef = {
  ID: number;
  Nome?: string | null;
  CPF?: string | null;
  Empresa?: number | string | null;
  Filial?: string | null;
  "Nome Filial"?: string | null;
  "Título do Cargo"?: string | null;
  "Valor Salário"?: number | string | null;
  "% Insalubridade"?: number | string | null;
  "Admissão"?: string | null;
  "Descrição do Local"?: string | null;
  Escala?: string | null;
};
/** Linha de CONTRATOS (só o que a tela usa para casar e rotular). */
type ContratoRow = { id?: number | null; Empresa?: number | string | null; Filial?: string | null; "NOME CONTRATO"?: string | null };
/** Mudança de data de início gravada em SISTEMA_RECRUTAMENTO.data_inicio_alteracoes. */
interface AlteracaoDataInicio { de?: string; para?: string; em?: string; por_nome?: string; justificativa?: string }
/** Colunas de SISTEMA_RECRUTAMENTO que o histórico lê (a lista de `select` é dinâmica). */
interface VagaResumo { id: number; cargo?: string | null; contrato?: string | null; status: string; created_at: string; nome_substituido?: string | null; quantidade_vagas?: number | string | null; motivo_vaga?: string | null; status_changed_at?: string | null; data_inicio_prevista?: string | null; grau_urgencia?: string | null; data_inicio_alteracoes?: unknown }
/** Advertência anterior do colaborador (histórico do modal). */
interface AdvertenciaAnterior { id: number; tipo_advertencia?: string | null; grau?: string | null; status?: string | null; data_ocorrido?: string | null; created_at?: string | null }

interface SolItem {
  tipo: string; icon: string;
  /** Chamado e Materiais tem id uuid; os demais, bigint. So serve de chave. */
  id: number | string;
  titulo: string; status: string; data: string;
  substituido?: string; motivo?: string; qtdVagas?: number; statusDesde?: string; excecao?: boolean;
  dataInicio?: string; grau?: string; alteracoes?: AlteracaoDataInicio[];
  /**
   * Para onde o botão leva, quando o tipo JÁ TEM tela própria.
   *
   * Chamados e Materiais entram no histórico para o encarregado ver tudo num
   * lugar só — mas o detalhe deles continua na tela do módulo, que tem o que
   * este painel não tem (anexos e avaliação no chamado; itens e recebimento
   * no pedido). Refazer isso aqui seria uma segunda versão, pior, da mesma
   * coisa.
   */
  rota?: string;
  /** Rótulo do botão quando há rota — nem todo tipo tem conversa. */
  acao?: string;
}

/**
 * Os chips do histórico.
 *
 * Par valor/rótulo porque os dois divergem em um caso: o tipo guardado é
 * "Mudança de Função" (é o que `SolItem.tipo` traz e o que o DetalheSolicitacao
 * espera), mas o nome inteiro num chip empurra os outros para a linha de
 * baixo. O chip diz "Função"; o filtro compara o nome cheio.
 */
const FILTROS: Array<{ valor: string; rotulo: string }> = [
  { valor: "",                   rotulo: "Todas" },
  { valor: "Vaga",               rotulo: "Vaga" },
  { valor: "Férias",             rotulo: "Férias" },
  { valor: "Advertência",        rotulo: "Advertência" },
  { valor: "Mudança de Função",  rotulo: "Função" },
  { valor: "Demissão",           rotulo: "Demissão" },
  { valor: "Chamado",            rotulo: "Chamado" },
  { valor: "Materiais",          rotulo: "Materiais" },
];

// Vaga já andou: o encarregado não mexe mais na data (o Recrutamento assume).
const VAGA_FECHADA = ["Concluída", "Reprovada", "Cancelada", "Contratado"];
const vagaEditavel = (s: SolItem) =>
  s.tipo === "Vaga" && !VAGA_FECHADA.includes(s.status) && !String(s.status ?? "").startsWith("Concluído");

// `abrir` vem das rotas dedicadas da sidebar (Solicitar Vaga / Férias /
// Advertência): é a MESMA tela, só que já com o formulário aberto. Assim cada
// submódulo tem seu item no menu sem duplicar formulário nenhum, e fechar o
// modal deixa a pessoa no histórico, que é o resto da página.
export type SolicitacaoInicial = "vaga" | "ferias" | "advertencia";

// `base` (15/09/2026): a mesma tela vive em Encarregados e em Central de
// Serviços › Solicitações; só as rotas de destino mudam (ver lib/solicitacoes/rotas).
export default function MinhasSolicitacoes({ abrir, base = "encarregados" }: { abrir?: SolicitacaoInicial; base?: BaseSolicitacoes }) {
  const rotas = rotasSolicitacoes(base);
  const { user } = useAuth();
  // Quem sou eu em EMPREGADOS (17/09/2026): ninguém aplica advertência em si mesmo.
  const { empregado: euEmpregado } = useVinculoEmpregado();
  const { can } = usePermissoes();
  const nav = useNavigate();
  // Vaga do escritório: só quem enxerga esse tipo pode marcar uma como tal.
  const podeAdministrativa = podeVagaAdministrativa(can);
  const [displayName, setDisplayName] = useState("");

  // Wizard nova vaga
  const [modalVaga, setModalVaga] = useState(false);
  const [vagaStep, setVagaStep] = useState(1);
  const [vaga, setVaga] = useState({ ...VAGA_RESET });
  // Contrato do escritório (ADM E ESTAGIÁRIOS) → administrativa sozinha e
  // travada (18/09/2026); fora dele, só quem tem a capacidade marca à mão.
  const contratoAdm = contratoEhAdministrativo(vaga.contrato);
  const ehAdministrativa = contratoAdm || (podeAdministrativa && !!vaga.administrativa);
  // Preencher à mão NÃO existe aqui: o encarregado abre vaga do posto dele, e
  // o posto vem sempre do cadastro de um colaborador. Vaga do escritório é
  // pedida na Central de Serviços ou na Gestão de Recrutamento, que têm o
  // botão de "Preencher manualmente" — e o catálogo de Suprimentos junto, que
  // esta tela não tem. Ver src/components/recrutamento/ModalNovaVaga.tsx.
  const [contratosFull, setContratosFull] = useState<ContratoRow[]>([]);
  // Empregado -> nº da vaga de substituição que já o segura (regra do banco).
  const [presos, setPresos] = useState<Map<number, number>>(new Map());
  const [empregados, setEmpregados] = useState<EmpregadoRef[]>([]);
  const [empSearch, setEmpSearch] = useState("");
  const [showEmpDrop, setShowEmpDrop] = useState(false);
  const [loadingEmps, setLoadingEmps] = useState(false);

  // Modal férias
  const [modalFerias, setModalFerias] = useState(false);
  const [ferias, setFerias] = useState({ ...FERIAS_RESET });
  // Refazer (16/09/2026): id da solicitação que está sendo refeita. O mesmo
  // modal de férias serve pros dois casos; com id, Salvar faz UPDATE e a
  // solicitação volta a Pendente pro RH avaliar de novo.
  const [feriasRefazerId, setFeriasRefazerId] = useState<number | null>(null);
  // Saída com menos de 30 dias: até 14/09/2026 a tela barrava; agora deixa
  // passar como EXCEÇÃO, mas só depois que a pessoa confirma no card
  // (Cancelar / Solicitar mesmo assim) sabendo que pode ser recusada.
  const [feriasExc, setFeriasExc] = useState(false);

  // Modal advertência
  const [modalAdv, setModalAdv] = useState(false);
  const [adv, setAdv] = useState({ ...ADV_RESET });
  const [advHistorico, setAdvHistorico] = useState<AdvertenciaAnterior[]>([]);
  const [advExc, setAdvExc] = useState({ open: false, justificativa: "" });
  // Anexos escolhidos no formulário (opcionais): sobem depois do insert, quando existe o id.
  const [advArquivos, setAdvArquivos] = useState<File[]>([]);

  // Histórico unificado
  const [minhasSols, setMinhasSols] = useState<SolItem[]>([]);
  const [loadingSols, setLoadingSols] = useState(false);
  const [filtro, setFiltro] = useState("");
  /** Solicitacao aberta no painel de detalhes + conversa. */
  const [detalhe, setDetalhe] = useState<SolItem | null>(null);

  // Toasts
  const [toasts, setToasts] = useState<{ id: number; msg: string; type: string }[]>([]);
  const toastId = useRef(0);
  const empDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const empTermo = useRef("");

  const toast = useCallback((msg: string, type = "info") => {
    const id = ++toastId.current;
    setToasts(t => [...t, { id, msg, type }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 3500);
  }, []);

  useEffect(() => {
    if (!user?.id) return;
    supabase.from("profiles").select("display_name, email").eq("id", user.id).maybeSingle()
      .then(({ data }) => setDisplayName(data?.display_name || data?.email || user.email || ""));
  }, [user?.id, user?.email]);

  // ── Histórico (vaga + férias) ───────────────────────────────────────
  const carregarMinhasSols = useCallback(async () => {
    if (!user?.email) return;
    setLoadingSols(true);
    const email = user.email;

    // Vaga: tenta com status_changed_at; se a coluna ainda não existir, refaz sem ela.
    const vagaQuery = (cols: string) => db
      .from("SISTEMA_RECRUTAMENTO").select<string, VagaResumo>(cols)
      .eq("solicitante_cpf", email).order("created_at", { ascending: false }).limit(30);
    let vg = await vagaQuery("id, cargo, contrato, status, created_at, nome_substituido, quantidade_vagas, motivo_vaga, status_changed_at, data_inicio_prevista, grau_urgencia, data_inicio_alteracoes");
    if (vg.error) vg = await vagaQuery("id, cargo, contrato, status, created_at, nome_substituido, quantidade_vagas, motivo_vaga, status_changed_at");
    if (vg.error) vg = await vagaQuery("id, cargo, contrato, status, created_at, nome_substituido, quantidade_vagas, motivo_vaga");

    const fr = await db.from("SISTEMA_SOLICITACOES_FERIAS").select("id, colaborador_nome, status, criado_em, excecao").eq("solicitante_email", email).order("criado_em", { ascending: false }).limit(30);
    const ad = await db.from("SISTEMA_SOLICITACOES_ADVERTENCIA").select("id, colaborador_nome, tipo_advertencia, status, created_at, status_changed_at, excecao").eq("solicitante_email", email).order("created_at", { ascending: false }).limit(30);
    // Demissão morava só na tela dedicada: quem pedia não a via no histórico,
    // e por isso não tinha como acompanhar o andamento junto do resto.
    const dm = await db.from("SISTEMA_SOLICITACOES_DEMISSAO")
      .select("id, colaborador_nome, motivo_solicitacao, status, criado_em, data_solicitacao")
      .eq("solicitante_email", email).order("criado_em", { ascending: false }).limit(30);

    // Mudança de função: mesmo caminho da demissão — quem pede acompanha aqui
    // em vez de ter que perguntar com quem a solicitação está.
    const tf = await db.from("SISTEMA_SOLICITACOES_TROCA_FUNCAO")
      .select("id, colaborador_nome, cargo_atual, cargo_novo, status, criado_em, atualizado_em")
      .eq("solicitante_email", email).order("criado_em", { ascending: false }).limit(30);

    // Chamado é por auth.uid (a tabela usa solicitante_id), não por e-mail.
    const ch = user?.id
      ? await db.from("CHAMADO_SISTEMA")
          .select("id, numero, assunto, status, created_at")
          .eq("solicitante_id", user.id).order("created_at", { ascending: false }).limit(30)
      : { data: [] };

    // Materiais vem por RPC do próprio módulo (sup_ext_meus_pedidos), que já
    // devolve só os pedidos de quem está logado. Não consulto as tabelas de
    // Suprimentos direto — a regra de quem vê o quê é de lá.
    const mt = await db.rpc("sup_ext_meus_pedidos");
    const itens: SolItem[] = [
      ...(vg.data ?? []).map(r => ({
        tipo: "Vaga", icon: "🎯", id: r.id,
        titulo: `${r.cargo || "Vaga"}${r.contrato ? ` — ${r.contrato}` : ""}`,
        status: r.status, data: r.created_at,
        substituido: r.nome_substituido || "", motivo: r.motivo_vaga || "",
        qtdVagas: Number(r.quantidade_vagas) || 1,
        statusDesde: r.status_changed_at || r.created_at,
        dataInicio: r.data_inicio_prevista || "", grau: r.grau_urgencia || "",
        alteracoes: Array.isArray(r.data_inicio_alteracoes) ? r.data_inicio_alteracoes : [],
      })),
      ...(fr.data ?? []).map(r => ({ tipo: "Férias", icon: "📅", id: r.id, titulo: `Férias — ${r.colaborador_nome || ""}`, status: r.status, data: r.criado_em, statusDesde: r.criado_em, excecao: !!r.excecao })),
      ...(ad.data ?? []).map(r => ({ tipo: "Advertência", icon: "⚠️", id: r.id, titulo: `Advertência ${r.tipo_advertencia || ""} — ${r.colaborador_nome || ""}`, status: r.status, data: r.created_at, statusDesde: r.status_changed_at || r.created_at, excecao: r.excecao })),
      ...(tf.data ?? []).map(r => ({
        tipo: "Mudança de Função", icon: "🔀", id: r.id,
        titulo: `${r.colaborador_nome || ""} — ${r.cargo_atual || "?"} → ${r.cargo_novo || "?"}`,
        status: r.status, data: r.criado_em,
        statusDesde: r.atualizado_em || r.criado_em,
      })),
      ...(dm.data ?? []).map(r => ({
        tipo: "Demissão", icon: "🚪", id: r.id,
        titulo: `Demissão — ${r.colaborador_nome || ""}`,
        status: r.status,
        // A tabela de demissão usa `criado_em`; a data digitada no formulário
        // é outra coisa e só serve de reserva quando o carimbo falta.
        data: r.criado_em || r.data_solicitacao,
        statusDesde: r.criado_em || r.data_solicitacao,
        motivo: r.motivo_solicitacao || "",
      })),
      ...(ch.data ?? []).map(r => ({
        tipo: "Chamado", icon: "🎧", id: r.id,
        titulo: `${r.numero ? r.numero + " — " : ""}${r.assunto || "Chamado"}`,
        status: r.status, data: r.created_at, statusDesde: r.created_at,
        rota: `/app/encarregados/chamados/${r.id}/acompanhar`,
        acao: "💬 Detalhes e chat",
      })),
      ...(Array.isArray(mt.data) ? mt.data : []).map(r => ({
        tipo: "Materiais", icon: "📦", id: r.id,
        titulo: `Materiais — ${r.nome_colaborador || r.posto_nome || r.contrato_nome || ""}`.trim(),
        status: r.status, data: r.created_at || r.data_solicitacao,
        statusDesde: r.created_at || r.data_solicitacao,
        rota: rotas.meusPedidos,
        // Pedido de material não tem conversa; prometer "chat" aqui seria
        // mandar o encarregado procurar algo que não existe.
        acao: "📦 Ver pedido",
      })),
    ].sort((a, b) => String(b.data || "").localeCompare(String(a.data || "")));
    setLoadingSols(false);
    setMinhasSols(itens);
  }, [user?.email, user?.id, rotas.meusPedidos]);

  useEffect(() => { carregarMinhasSols(); }, [carregarMinhasSols]);

  // ── Contratos ───────────────────────────────────────────────────────
  const carregarContratos = async () => {
    const { data } = await db
      .from("CONTRATOS").select('id, "NOME CONTRATO", Filial, Empresa').eq("ATIVO", "SIM").order('"NOME CONTRATO"');
    if (data) setContratosFull(data);
  };

  // ── Empregados (busca auto-debounced + descarta obsoletas) ──────────
  const buscarEmpregados = (term: string) => {
    empTermo.current = term;
    setLoadingEmps(true);
    if (empDebounce.current) clearTimeout(empDebounce.current);
    empDebounce.current = setTimeout(async () => {
      const { data, error } = await db
        .from("EMPREGADOS")
        .select('"ID", "Nome", "CPF", "Empresa", "Filial", "Nome Filial", "Título do Cargo", "Valor Salário", "% Insalubridade", "Admissão", "Escala", "Descrição do Local"')
        .eq("Situação", "Trabalhando")
        .ilike("Nome", `%${term}%`)
        .order('"Nome"')
        .limit(50);
      if (empTermo.current !== term) return;
      setLoadingEmps(false);
      if (error) console.error("[EMPREGADOS] erro:", error.message, error.code);
      const lista: EmpregadoRef[] = data ?? [];
      setEmpregados(lista);
      // Só a substituição trava: nos outros motivos a pessoa é molde e pode
      // servir de molde quantas vezes for.
      setPresos(modalVaga && ehSubstituicao(vaga.motivo_vaga)
        ? await substituidosComVagaViva(supabase, lista.map(e => Number(e.ID)))
        : new Map());
    }, 350);
  };

  // Substituição: cargo e contrato vêm do cadastro do colaborador substituído e
  // não podem ser digitados (a vaga tem que repor exatamente aquele posto).
  // `substituidoId` também serve de prova de que a pessoa foi ESCOLHIDA na
  // lista, não só digitada.
  const [substituidoId, setSubstituidoId] = useState<number | null>(null);

  // Insalubridade e benefícios vêm da Planilha de Custo (14/09/2026): o
  // encarregado não preenche nem edita — escolheu o colaborador, a RPC acha o
  // posto no contrato e os campos aparecem preenchidos. `custoNota` é a linha
  // de origem embaixo dos campos ("da planilha, posto X" / "sem planilha").
  const [custoPosto, setCustoPosto] = useState<CustoPosto | null>(null);
  const [custoNota, setCustoNota] = useState("");
  const [catListas, setCatListas] = useState<ListasCatalogo>({ postos: [], funcoes: [] });
  const [setoresCatalogo, setSetoresCatalogo] = useState<string[]>([]);
  useEffect(() => {
    db.from("setor_catalogo").select("nome").order("nome")
      .then(({ data }: { data: { nome: string }[] | null }) => setSetoresCatalogo((data ?? []).map(r => r.nome).filter(Boolean)));
  }, []);
  const [empEscolhido, setEmpEscolhido] = useState<EmpregadoRef | null>(null);
  const [custoBuscando, setCustoBuscando] = useState(false);

  // Substituição anda junto com a demissão de quem sai: o banco recusa a
  // vaga sem `demissao_id` (trigger rec_vaga_exige_demissao). Em vez de
  // deixar a pessoa preencher três etapas pra tomar o erro no final, a
  // busca roda assim que o colaborador é escolhido — achou, vincula sozinho;
  // não achou, abre o card no meio da tela (OK / Solicitar demissão).
  const [demissaoId, setDemissaoId] = useState<number | null>(null);
  const [demissaoBusca, setDemissaoBusca] = useState<"ocioso" | "buscando" | "achou" | "nenhuma">("ocioso");
  const [avisoDemissao, setAvisoDemissao] = useState(false);

  // "Este colaborador já tem solicitação de X": o banco responde na escolha
  // (solicitacao_em_aberto) e o card no meio da tela barra antes de a pessoa
  // preencher o resto. O trigger recusaria o INSERT de qualquer jeito.
  const [bloqueio, setBloqueio] = useState<SolicitacaoEmAberto | null>(null);

  useEffect(() => {
    if (!modalVaga || !ehSubstituicao(vaga.motivo_vaga) || !substituidoId) {
      setDemissaoId(null); setDemissaoBusca("ocioso"); setAvisoDemissao(false); return;
    }
    let vivo = true;
    setDemissaoBusca("buscando");
    (async () => {
      const { data, error } = await db
        .from("SISTEMA_SOLICITACOES_DEMISSAO")
        .select("id, status, vaga_id")
        .eq("colaborador_id", substituidoId)
        .not("status", "in", '("Reprovada","Cancelada")')
        // Sem filtrar vaga_id: a demissão pode apontar para uma vaga que
        // foi reprovada/cancelada, e aí a pessoa PODE ser reposta de novo.
        // Quem trava quem já está numa vaga viva é `presos`.
        .order("criado_em", { ascending: false })
        .limit(1);
      if (!vivo) return;
      const d = !error && data?.[0];
      setDemissaoId(d ? Number(d.id) : null);
      setDemissaoBusca(d ? "achou" : "nenhuma");
      if (!d) setAvisoDemissao(true);
    })();
    return () => { vivo = false; };
  }, [modalVaga, vaga.motivo_vaga, substituidoId]);

  /** Vai solicitar a demissão de quem foi escolhido; a vaga abre a partir dela. */
  const irSolicitarDemissao = () => {
    const id = substituidoId;
    setAvisoDemissao(false); setModalVaga(false);
    nav(`${rotas.demissao}?colaborador=${id}`);
  };

  const selecionarEmpregado = (emp: EmpregadoRef) => {
    const jaTem = ehSubstituicao(vaga.motivo_vaga) ? presos.get(Number(emp.ID)) : undefined;
    if (jaTem) { toast(avisoSubstituidoPreso(jaTem), "err"); return; }
    const contratoMatch = contratoDoEmpregado(contratosFull, emp);
    // Enquanto a planilha não responde, vale o cadastro do colaborador.
    const insalCadastro = insalubridadeDoCusto(null, emp["% Insalubridade"]);
    const contratoRotulo = contratoMatch ? rotuloContrato(contratoMatch) : "";
    const salarioTxt = emp["Valor Salário"] ? `R$ ${String(emp["Valor Salário"]).replace(".", ",")}` : "";
    setSubstituidoId(emp.ID ?? null);
    setVaga(v => ({
      ...v,
      // Nos outros motivos o escolhido é só o molde: o nome não entra na vaga.
      nome_substituido: mostraNomeReferencia(v.motivo_vaga) ? emp.Nome : "",
      cargo: emp["Título do Cargo"] ?? "",
      salario: salarioTxt,
      insalubridade_recebe: insalCadastro.recebe,
      insalubridade_quanto: insalCadastro.quanto,
      beneficios: "",
      escala: emp["Escala"] ? String(emp["Escala"]) : v.escala,
      contrato: contratoRotulo || v.contrato,
    }));
    setEmpSearch(mostraNomeReferencia(vaga.motivo_vaga) ? emp.Nome : "");
    setShowEmpDrop(false);
    // A planilha só é consultada quando o posto do catálogo for escolhido
    // (efeito abaixo) — até lá, aviso e V.A/V.T em branco.
    setEmpEscolhido(emp);
    setCustoPosto(null); setCustoNota(AVISO_SEM_POSTO); setCustoBuscando(false);
  };

  // Planilha de Custo pelo POSTO do catálogo (15/09/2026). Antes a consulta
  // saía ao escolher o colaborador e a RPC adivinhava o posto por salário/
  // cargo/cidade — e errou (ASG com o V.A do supervisor). Agora só consulta
  // com posto escolhido; sem posto, V.A/V.T ficam em branco com aviso e a
  // insalubridade volta pro cadastro do colaborador.
  const postoNomeEscolhido = catListas.postos.find(p => p.id === vaga.posto_id)?.nome ?? "";
  useEffect(() => {
    if (!vaga.contrato) return;
    const emp = empEscolhido;
    if (!postoNomeEscolhido) {
      // Sem posto: só mexe se foi um colaborador escolhido nesta sessão —
      // vaga aberta pra edição fica com o que está gravado.
      if (!emp) return;
      const insal = insalubridadeDoCusto(null, emp["% Insalubridade"]);
      setVaga(v => ({ ...v, insalubridade_recebe: insal.recebe, insalubridade_quanto: insal.quanto, beneficios: "" }));
      setCustoPosto(null); setCustoNota(AVISO_SEM_POSTO); setCustoBuscando(false);
      return;
    }
    let vivo = true;
    setCustoBuscando(true);
    buscarCustoDoPosto(supabase, {
      contrato: vaga.contrato, posto: postoNomeEscolhido,
      cargo: emp?.["Título do Cargo"] ?? vaga.cargo, salario: emp?.["Valor Salário"] ?? vaga.salario, cidade: vaga.cidade || null,
    }).then(custo => {
      if (!vivo) return;
      const insal = insalubridadeDoCusto(custo, emp?.["% Insalubridade"], emp?.["Valor Salário"]);
      setVaga(v => ({ ...v, insalubridade_recebe: insal.recebe, insalubridade_quanto: insal.quanto, beneficios: beneficiosDoCusto(custo) }));
      setCustoPosto(custo); setCustoNota(notaDoCusto(custo, insal.origem, postoNomeEscolhido));
    }).finally(() => { if (vivo) setCustoBuscando(false); });
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [postoNomeEscolhido, vaga.contrato, empEscolhido]);


  const abrirModalVaga = () => {
    setModalVaga(true); setVagaStep(1); setEmpSearch(""); setShowEmpDrop(false); setVaga({ ...VAGA_RESET });
    setSubstituidoId(null); setCustoPosto(null); setCustoNota(""); setEmpEscolhido(null);
    if (!contratosFull.length) carregarContratos();
  };

  // Prazo/grau da data escolhida — o grau não é mais escolhido na mão.
  const prazo = avaliarPrazo(vaga.data_inicio_prevista);
  const cnhDoCargo = cargoExigeCnh(vaga.cargo);

  const vagaValidar = (step: number) => {
    if (step === 1) {
      if (!vaga.motivo_vaga) { toast("Selecione o motivo da vaga.", "err"); return false; }

      // Aqui o colaborador é sempre obrigatório: é dele que vêm cargo,
      // contrato, escala e salário. Não há modo manual nesta tela.
      if (!substituidoId) {
        toast(ehSubstituicao(vaga.motivo_vaga)
          ? "Escolha na lista o colaborador que será substituído — o cargo e o contrato vêm do cadastro dele."
          : "Escolha na lista alguém com o mesmo cargo da vaga — é de lá que vêm cargo, contrato, escala e salário.", "err");
        return false;
      }

      const jaTem = ehSubstituicao(vaga.motivo_vaga) && substituidoId ? presos.get(substituidoId) : undefined;
      if (jaTem) { toast(avisoSubstituidoPreso(jaTem), "err"); return false; }
      // Sem a demissão de quem sai o banco recusa a vaga — o card já avisou
      // na escolha; aqui só impede de seguir e mostra de novo.
      if (ehSubstituicao(vaga.motivo_vaga) && !demissaoId) {
        if (demissaoBusca === "buscando") toast("Ainda procurando a solicitação de demissão — aguarde um instante.", "err");
        else setAvisoDemissao(true);
        return false;
      }
      if (!vaga.contrato) { toast("Selecione o contrato.", "err"); return false; }
      if (!vaga.cargo.trim()) { toast("Informe o cargo.", "err"); return false; }
      // Posto e função do catálogo (15/09/2026): obrigatórios quando o
      // contrato tem posto no catálogo — é do posto que vêm o V.A e o V.T.
      if (vaga.contrato_id && catListas.postos.length > 0 && !vaga.posto_id) { toast("Selecione o posto no catálogo de Suprimentos — é dele que vêm o V.A e o V.T da vaga.", "err"); return false; }
      if (vaga.posto_id && catListas.funcoes.length > 0 && !vaga.funcao_id) { toast("Selecione a função do posto no catálogo de Suprimentos.", "err"); return false; }
      // Estado e cidade obrigatórios (15/09/2026) — mesma regra do Recrutamento.
      if (!vaga.estado) { toast("Selecione o estado (UF) da vaga.", "err"); return false; }
      if (!vaga.cidade) { toast("Selecione a cidade da vaga.", "err"); return false; }
    }
    if (step === 2) {
      if (!prazo.ok) { toast(prazo.erro ?? "Revise a data de início prevista.", "err"); return false; }
    }
    if (step === 3) {
      // A indicação é do passo 3: se disse que tem, os três campos vêm
      // juntos. A regra é a mesma nas duas telas de vaga.
      const erroRec = erroDaRecomendacao(vaga);
      if (erroRec) { toast(erroRec, "err"); return false; }
      if (!prazo.ok) { toast(prazo.erro ?? "Revise a data de início prevista.", "err"); return false; }
    }
    return true;
  };

  const submitVaga = async () => {
    if (!vagaValidar(1) || !vagaValidar(3)) return;
    const payload = {
      ...vaga,
      quantidade_vagas: quantidadeValida(vaga.motivo_vaga, vaga.quantidade_vagas),
      ...recomendacaoParaBanco(vaga),
      reserva_tecnica: vaga.reserva_tecnica === "Sim",
      // Grau e CNH saem das regras, não do que a pessoa digitou (o banco
      // recalcula os dois no trigger — aqui é só p/ a tela não mentir).
      grau_urgencia: prazo.grau ?? "",
      req_obrigatorios: aplicarReqCnh(vaga.req_obrigatorios, vaga.cargo),
      cnh_obrigatoria: !!cnhDoCargo,
      // Só a substituição grava o id: é ele que trava a pessoa numa vaga só.
      substituido_id: ehSubstituicao(vaga.motivo_vaga) ? substituidoId : null,
      demissao_id: ehSubstituicao(vaga.motivo_vaga) ? demissaoId : null,
      contrato_id: vaga.contrato_id || null, posto_id: vaga.posto_id || null, funcao_id: vaga.funcao_id || null,
      administrativa: ehAdministrativa,
      setor: vaga.setor || null,
      // Administrativa ou com setor → Diretoria (16/09/2026); o resto → analista.
      status: statusInicialVaga(ehAdministrativa, vaga.setor || null),
      solicitante_nome: user?.user_metadata?.nome ?? user?.email ?? "",
      solicitante_cpf: user?.email ?? "",
    };
    let { error, data } = await db.from("SISTEMA_RECRUTAMENTO").insert(payload).select("id").single();
    // Banco ainda sem as colunas novas: reenvia sem elas.
    if (error && /column|schema cache/i.test(error.message)) {
      const { cnh_obrigatoria, substituido_id, demissao_id, contrato_id, posto_id, funcao_id, administrativa, reserva_tecnica, tem_recomendacao, recomendacao_nome, recomendacao_cpf, recomendacao_whatsapp, ...semColunasNovas } = payload as Record<string, unknown>;
      ({ error, data } = await db.from("SISTEMA_RECRUTAMENTO").insert(semColunasNovas).select("id").single());
    }
    if (error) { toast("Erro ao solicitar vaga: " + error.message, "err"); return; }
    toast(`Solicitação #${data?.id} criada com sucesso!`, "ok");
    setModalVaga(false); setVaga({ ...VAGA_RESET }); setVagaStep(1); setEmpSearch(""); setShowEmpDrop(false);
    setSubstituidoId(null);
    carregarMinhasSols();
  };

  // ── Editar a data de início (única coisa que o encarregado muda depois) ──
  const [editData, setEditData] = useState<{ sol: SolItem; data: string; justificativa: string } | null>(null);
  const [salvandoData, setSalvandoData] = useState(false);
  const prazoEdicao = editData ? avaliarPrazo(editData.data) : null;

  const salvarNovaData = async () => {
    if (!editData || !prazoEdicao) return;
    if (!prazoEdicao.ok) { toast(prazoEdicao.erro ?? "Revise a data.", "err"); return; }
    if (editData.data === (editData.sol.dataInicio ?? "")) { toast("A data é a mesma que já está na vaga.", "err"); return; }
    if (editData.justificativa.trim().length < 10) { toast("Escreva a justificativa da troca de data (mínimo 10 caracteres).", "err"); return; }
    setSalvandoData(true);
    const historico = [
      ...(editData.sol.alteracoes ?? []),
      {
        de: editData.sol.dataInicio || null, para: editData.data,
        justificativa: editData.justificativa.trim(),
        por_nome: displayName || user?.email || "",
      },
    ];
    const { error } = await db.from("SISTEMA_RECRUTAMENTO").update({
      data_inicio_prevista: editData.data,
      grau_urgencia: prazoEdicao.grau,
      data_inicio_alteracoes: historico,
    }).eq("id", editData.sol.id);
    setSalvandoData(false);
    if (error) { toast(error.message, "err"); return; }
    toast(`Data da vaga #${editData.sol.id} atualizada — urgência ${prazoEdicao.grau}.`, "ok");
    setEditData(null);
    carregarMinhasSols();
  };

  // ── Férias ──────────────────────────────────────────────────────────
  const selecionarColabFerias = async (emp: EmpregadoRef) => {
    setShowEmpDrop(false);
    const dup = await solicitacaoEmAberto(supabase, "ferias", emp.ID ?? null);
    if (dup) { setBloqueio(dup); setEmpSearch(""); setEmpregados([]); return; }
    setFerias(f => ({
      ...f,
      colaborador_id: emp.ID ?? null,
      colaborador_nome: emp.Nome ?? "",
      colaborador_cpf: emp.CPF ?? "",
      colaborador_cargo: emp["Título do Cargo"] ?? "",
      colaborador_filial: emp["Nome Filial"] ?? "",
      colaborador_admissao: emp["Admissão"] ?? "",
    }));
    setEmpSearch(emp.Nome ?? ""); setShowEmpDrop(false);
  };

  const abrirModalFerias = () => {
    setFeriasRefazerId(null);
    setModalFerias(true); setFerias({ ...FERIAS_RESET }); setEmpSearch(""); setShowEmpDrop(false); setEmpregados([]);
  };

  /** Abre o modal de férias preenchido com a solicitação, em modo REFAZER. */
  const abrirRefazerFerias = (ficha: Record<string, unknown>) => {
    const regra = podeRefazerFerias({ criado_em: ficha.criado_em as string | null, status: ficha.status as string | null });
    if (!regra.ok) { toast(regra.motivo, "err"); return; }
    setDetalhe(null);
    setFeriasRefazerId(Number(ficha.id));
    setFerias({
      ...FERIAS_RESET,
      colaborador_id: ficha.colaborador_id != null ? Number(ficha.colaborador_id) : null,
      colaborador_nome: String(ficha.colaborador_nome ?? ""), colaborador_cpf: String(ficha.colaborador_cpf ?? ""),
      colaborador_cargo: String(ficha.colaborador_cargo ?? ""), colaborador_filial: String(ficha.colaborador_filial ?? ""),
      colaborador_admissao: ficha.colaborador_admissao ? fmtDt(String(ficha.colaborador_admissao)) : "",
      data_saida: String(ficha.data_saida ?? "").slice(0, 10),
      dias_ferias: String(ficha.dias_ferias ?? "30"), dias_vendidos: String(ficha.dias_vendidos ?? "0"),
      observacoes: String(ficha.observacoes ?? ""),
    });
    setEmpSearch(String(ficha.colaborador_nome ?? "")); setShowEmpDrop(false); setEmpregados([]);
    setModalFerias(true);
  };

  const feriasForaDoPrazo = () => !!ferias.data_saida && ferias.data_saida < hojeMaisDias(30);

  const submitFerias = async () => {
    if (!ferias.colaborador_id) { toast("Selecione o colaborador.", "err"); return; }
    if (!ferias.data_saida) { toast("Informe a data de saída.", "err"); return; }
    if (ferias.data_saida < hojeMaisDias(0)) { toast("A data de saída não pode ficar no passado.", "err"); return; }
    if (feriasForaDoPrazo()) { setFeriasExc(true); return; }  // card: Cancelar / Solicitar mesmo assim
    await doSubmitFerias(false);
  };

  const doSubmitFerias = async (excecao: boolean) => {
    const dias = parseInt(ferias.dias_ferias) || 30;
    const vend = parseInt(ferias.dias_vendidos) || 0;
    if (feriasRefazerId) { await doRefazerFerias(feriasRefazerId, dias, vend, excecao); return; }
    const payload = {
      solicitante_nome: displayName || user?.email || "", solicitante_email: user?.email ?? "",
      colaborador_id: ferias.colaborador_id, colaborador_nome: ferias.colaborador_nome, colaborador_cpf: ferias.colaborador_cpf,
      colaborador_cargo: ferias.colaborador_cargo, colaborador_filial: ferias.colaborador_filial,
      colaborador_admissao: dataParaIso(ferias.colaborador_admissao),
      data_saida: ferias.data_saida, data_retorno: addDaysISO(ferias.data_saida, dias),
      dias_ferias: dias, dias_vendidos: vend, observacoes: ferias.observacoes.trim() || null, status: "Pendente",
      excecao,
    };
    let { error, data } = await db.from("SISTEMA_SOLICITACOES_FERIAS").insert(payload).select("id").single();
    // Banco ainda sem a coluna excecao (mig 20260930000101): reenvia sem ela.
    if (error && /excecao/i.test(error.message)) {
      const { excecao: _e, ...semExcecao } = payload;
      ({ error, data } = await db.from("SISTEMA_SOLICITACOES_FERIAS").insert(semExcecao).select("id").single());
    }
    if (error) { toast("Erro ao solicitar férias: " + error.message, "err"); return; }
    setFeriasExc(false);
    toast(excecao
      ? `Férias solicitadas para ${ferias.colaborador_nome} como EXCEÇÃO (fora do prazo) — pode ser recusada. (#${data?.id})`
      : `Férias solicitadas para ${ferias.colaborador_nome}! (#${data?.id})`, "ok");
    setModalFerias(false); setFerias({ ...FERIAS_RESET }); setEmpSearch(""); carregarMinhasSols();
  };

  /**
   * Refazer: UPDATE na mesma solicitação. Volta a Pendente e limpa a decisão
   * anterior; o trigger do banco registra 'Refeita' no histórico e recusa se
   * já passou uma semana da criação (a tela só esconde o botão).
   */
  const doRefazerFerias = async (id: number, dias: number, vend: number, excecao: boolean) => {
    const agora = new Date().toISOString();
    const { data: atual } = await db.from("SISTEMA_SOLICITACOES_FERIAS").select("refeita_vezes, status").eq("id", id).maybeSingle();
    const { error } = await db.from("SISTEMA_SOLICITACOES_FERIAS").update({
      data_saida: ferias.data_saida, data_retorno: addDaysISO(ferias.data_saida, dias),
      dias_ferias: dias, dias_vendidos: vend, observacoes: ferias.observacoes.trim() || null,
      excecao,
      status: "Pendente", aprovado_por: null, aprovado_em: null, motivo_reprovacao: null,
      refeita_em: agora, refeita_vezes: (Number(atual?.refeita_vezes) || 0) + 1,
      atualizado_em: agora,
    }).eq("id", id);
    if (error) { toast("Erro ao refazer a solicitação: " + error.message, "err"); return; }
    // Fica na conversa também, pra quem aprova ver sem abrir o histórico.
    await db.from("SISTEMA_COMENTARIOS").insert({
      modulo: "ferias", entidade_id: String(id),
      texto: `🔁 Solicitação refeita pelo encarregado: saída ${fmtDt(ferias.data_saida)}, ${dias} dias${vend ? `, abono de ${vend} dias` : ""}${excecao ? " (fora do prazo — exceção)" : ""}. Voltou para avaliação do RH.`,
      autor_nome: displayName || user?.email || "Encarregado", autor_cpf: user?.email ?? "",
    });
    setFeriasExc(false);
    toast(`Solicitação #${id} refeita e enviada de novo para o RH avaliar.`, "ok");
    setModalFerias(false); setFeriasRefazerId(null); setFerias({ ...FERIAS_RESET }); setEmpSearch(""); carregarMinhasSols();
  };

  // ── Advertência ─────────────────────────────────────────────────────
  const selecionarColabAdv = async (emp: EmpregadoRef) => {
    // Advertência em si mesmo não existe (17/09/2026): pelo vínculo (ID) ou
    // pelo CPF, pra pegar também quem ainda não vinculou o login.
    const souEu = (euEmpregado?.id != null && emp.ID === euEmpregado.id)
      || (!!euEmpregado?.cpf && !!emp.CPF && emp.CPF.replace(/\D/g, "") === euEmpregado.cpf.replace(/\D/g, ""));
    if (souEu) { setShowEmpDrop(false); setEmpSearch(""); setEmpregados([]); toast("Você não pode aplicar uma advertência em si mesmo.", "err"); return; }
    setShowEmpDrop(false);
    const dup = await solicitacaoEmAberto(supabase, "advertencia", emp.ID ?? null);
    if (dup) { setBloqueio(dup); setEmpSearch(""); setEmpregados([]); return; }
    const contratoMatch = contratoDoEmpregado(contratosFull, emp);
    setAdv(a => ({
      ...a,
      colaborador_id: emp.ID ?? null, colaborador_nome: emp.Nome ?? "", colaborador_cpf: emp.CPF ?? "",
      colaborador_cargo: emp["Título do Cargo"] ?? "", colaborador_filial: emp["Nome Filial"] ?? "",
      colaborador_admissao: dataParaIso(emp["Admissão"]) ?? "", colaborador_posto: emp["Descrição do Local"] ?? "", colaborador_escala: emp.Escala ? String(emp.Escala) : "",
      contrato: contratoMatch ? rotuloContrato(contratoMatch) : "",
      contrato_id: contratoMatch ? (contratoMatch.id ?? null) : null,
    }));
    setEmpSearch(emp.Nome ?? ""); setShowEmpDrop(false);
    // Histórico de advertências do colaborador (2ª advertência reabre o mesmo histórico).
    setAdvHistorico([]);
    if (emp.ID != null) {
      const { data } = await db.from("SISTEMA_SOLICITACOES_ADVERTENCIA")
        .select("id, tipo_advertencia, grau, status, data_ocorrido, created_at")
        .eq("colaborador_id", emp.ID).order("created_at", { ascending: false }).limit(20);
      setAdvHistorico(data ?? []);
    }
  };

  const abrirModalAdv = () => {
    setModalAdv(true); setAdv({ ...ADV_RESET }); setAdvArquivos([]); setEmpSearch(""); setShowEmpDrop(false); setEmpregados([]); setAdvHistorico([]);
    if (!contratosFull.length) carregarContratos();
  };

  // Abre o formulário pedido pela rota. Guarda o último valor atendido em vez
  // de um "já abri": sem isso, ir de Solicitar Vaga para Solicitar Férias pela
  // sidebar não reabriria nada (o componente não remonta, só troca a prop) — e
  // fechar o modal não pode reabri-lo sozinho.
  const ultimoAbrir = useRef<SolicitacaoInicial | null>(null);
  useEffect(() => {
    if (!abrir || ultimoAbrir.current === abrir) return;
    ultimoAbrir.current = abrir;
    if (abrir === "vaga") abrirModalVaga();
    else if (abrir === "ferias") abrirModalFerias();
    else if (abrir === "advertencia") abrirModalAdv();
    // Só `abrir` nas deps, de propósito: os abrirModal* são recriados a cada
    // render e o ref acima já garante "abre uma vez por valor de `abrir`".
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abrir]);

  // Trava: grau Baixo exige advertência verbal antes da escrita.
  const advBloqueada = adv.grau === "Baixo" && adv.advertencia_verbal_dada === "Não";

  // Data do ocorrido com mais de 3 dias → fora do prazo (vira EXCEÇÃO com justificativa).
  const advForaDoPrazo = () => {
    if (!adv.data_ocorrido) return false;
    const limite = new Date(); limite.setHours(0, 0, 0, 0); limite.setDate(limite.getDate() - 3);
    return new Date(adv.data_ocorrido + "T00:00:00") < limite;
  };

  const submitAdv = async () => {
    if (!adv.colaborador_id) { toast("Selecione o colaborador.", "err"); return; }
    if (!adv.tipo_advertencia) { toast("Selecione o tipo de advertência.", "err"); return; }
    if (!adv.grau) { toast("Selecione o grau da advertência.", "err"); return; }
    if (!adv.data_ocorrido) { toast("Informe a data do ocorrido.", "err"); return; }
    if (adv.descricao_ocorrido.trim().length < 50) { toast("A descrição do ocorrido precisa ter pelo menos 50 caracteres.", "err"); return; }
    if (adv.advertencia_verbal_dada === "Sim" && !adv.data_advertencia_verbal) { toast("Informe a data em que a advertência verbal foi aplicada.", "err"); return; }
    if (advBloqueada) { toast("Primeiro dê a advertência verbal para dar a escrita.", "err"); return; }
    if (advForaDoPrazo()) { setAdvExc({ open: true, justificativa: "" }); return; }  // pede justificativa de exceção
    await doSubmitAdv(false, null);
  };

  const confirmarExcecao = async () => {
    if (advExc.justificativa.trim().length < 10) { toast("Justifique a exceção (mín. 10 caracteres).", "err"); return; }
    await doSubmitAdv(true, advExc.justificativa.trim());
  };

  const doSubmitAdv = async (excecao: boolean, justificativa: string | null) => {
    const payload = {
      solicitante_nome: displayName || user?.email || "", solicitante_email: user?.email ?? "",
      colaborador_id: adv.colaborador_id, colaborador_nome: adv.colaborador_nome, colaborador_cpf: adv.colaborador_cpf,
      colaborador_cargo: adv.colaborador_cargo, colaborador_filial: adv.colaborador_filial,
      colaborador_admissao: adv.colaborador_admissao || null, colaborador_posto: adv.colaborador_posto || null, colaborador_escala: adv.colaborador_escala || null,
      contrato: adv.contrato || null, contrato_id: adv.contrato_id,
      tipo_advertencia: adv.tipo_advertencia, grau: adv.grau, data_ocorrido: adv.data_ocorrido,
      descricao_ocorrido: adv.descricao_ocorrido.trim(),
      advertencia_verbal_dada: adv.advertencia_verbal_dada === "Sim",
      data_advertencia_verbal: adv.advertencia_verbal_dada === "Sim" ? (adv.data_advertencia_verbal || null) : null,
      status: "Aguardando Aprovação",
      excecao, justificativa_excecao: justificativa,
    };
    const { error, data } = await db.from("SISTEMA_SOLICITACOES_ADVERTENCIA").insert(payload).select("id").single();
    if (error) { toast("Erro ao solicitar advertência: " + error.message, "err"); return; }
    // Anexos opcionais (17/09/2026): sobem depois do insert, com o id da
    // solicitação no caminho. Falha aqui não desfaz o pedido — a pessoa
    // anexa de novo pelo card (Minhas Solicitações › Detalhes).
    if (data?.id && advArquivos.length) {
      let falhas = 0;
      for (const f of advArquivos) {
        const path = caminhoAnexo("advertencia", data.id, f.name);
        const { error: up } = await supabase.storage.from(BUCKET_ANEXOS).upload(path, f, { upsert: false, contentType: f.type || undefined });
        if (up) { falhas++; continue; }
        const { error: reg } = await db.from("SISTEMA_SOLICITACOES_ANEXOS").insert({
          modulo: "advertencia", entidade_id: String(data.id), nome: f.name, storage_path: path,
          tipo: f.type || null, tamanho: f.size, autor_nome: displayName || user?.email || "", autor_email: user?.email ?? null, autor_id: user?.id ?? null,
        });
        if (reg) falhas++;
      }
      if (falhas) toast(`${falhas} anexo(s) não subiram — anexe de novo pelo card da solicitação.`, "err");
    }
    toast(`Advertência solicitada${excecao ? " (EXCEÇÃO)" : ""} para ${adv.colaborador_nome}! (#${data?.id})`, "ok");
    setAdvExc({ open: false, justificativa: "" });
    setModalAdv(false); setAdv({ ...ADV_RESET }); setAdvArquivos([]); setEmpSearch(""); carregarMinhasSols();
  };

  // ── CSS ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const style = document.createElement("style");
    style.id = "mns-styles";
    style.textContent = `
      .ini-card{background:#fff;border:1px solid #e2e8f0;border-radius:16px;box-shadow:0 8px 24px rgba(15,23,42,.06);overflow:hidden;margin-bottom:20px;}
      .ini-card-hd{display:flex;align-items:center;justify-content:space-between;padding:14px 20px;border-bottom:1px solid #e2e8f0;}
      .ini-card-hd h3{font-size:.94rem;font-weight:700;color:#0f172a;display:flex;align-items:center;gap:7px;}
      .ini-card-body{padding:16px 20px;}
      .ini-sol-create{display:flex;flex-direction:column;align-items:center;gap:7px;padding:14px 10px;border-radius:12px;border:1.5px solid #e2e8f0;background:#fff;cursor:pointer;transition:all .15s;text-align:center;box-shadow:0 1px 4px rgba(15,23,42,.04);font-family:inherit;}
      .ini-sol-create:hover{border-color:#0f3171;background:#eef4ff;transform:translateY(-2px);box-shadow:0 6px 16px rgba(15,49,113,.1);}
      .ini-sol-create .icon{font-size:1.3rem;}
      .ini-sol-create span{font-size:.75rem;font-weight:600;color:#0f172a;line-height:1.2;}
      .ini-sol-menu{position:absolute;top:32px;right:4px;z-index:42;min-width:250px;background:#fff;border:1px solid #e2e8f0;border-radius:12px;box-shadow:0 12px 32px rgba(15,23,42,.16);padding:5px;text-align:left;}
      .ini-sol-menu button{display:block;width:100%;padding:9px 11px;border:none;border-radius:9px;background:transparent;cursor:pointer;font-family:inherit;font-size:.8rem;font-weight:600;color:#0f172a;text-align:left;}
      .ini-sol-menu button:hover{background:#eef4ff;}
      .ini-sol-menu button small{display:block;margin-top:3px;font-weight:500;font-size:.7rem;color:#64748b;line-height:1.35;white-space:normal;}
      .ini-sol-item{display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid #f1f5f9;}
      .ini-sol-item:last-child{border-bottom:none;}
      .ini-sol-icon{width:34px;height:34px;border-radius:9px;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:15px;background:rgba(8,145,178,.1);}
      .ini-sol-info{flex:1;min-width:0;}
      .ini-sol-title{font-size:.85rem;font-weight:600;color:#0f172a;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
      .ini-sol-meta{font-size:.72rem;color:#64748b;margin-top:2px;}
      .ini-sol-top{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:4px;}
      .ini-sol-tag{display:inline-flex;align-items:center;gap:4px;font-size:11px;color:#475569;background:#eef4ff;border:1px solid #dbe4f0;border-radius:6px;padding:1px 7px;line-height:1.5;}
      .ini-sol-tag strong{color:#0f172a;font-weight:700;}
      .ini-sol-dias{font-size:10px;color:#64748b;white-space:nowrap;font-weight:600;}
      .ini-badge{display:inline-flex;align-items:center;padding:2px 8px;border-radius:20px;font-size:10px;font-weight:700;white-space:nowrap;border:1px solid transparent;}
      /* Legibilidade (17/09/2026, pedido do Pablo): modal maior, rótulo escuro
         e maior, campo com borda visível e fonte 14px. Antes: rótulo 11px
         #64748b sobre branco — "mal dá pra ver". */
      .ini-modal-ov,.ini-modal-bg{position:fixed;inset:0;z-index:700;background:rgba(15,23,42,.5);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;padding:16px;}
      .ini-modal{background:#fff;border:1px solid #cbd5e1;border-radius:18px;padding:28px 30px;width:100%;max-width:720px;max-height:92vh;overflow-y:auto;position:relative;box-shadow:0 20px 50px rgba(15,23,42,.22);color:#0f172a;}
      .ini-fi{width:100%;background:#fff;border:1.5px solid #64748b;border-radius:12px;color:#0f172a;font-size:14.5px;padding:11px 13px;outline:none;font-family:inherit;transition:.15s;}
      .ini-fi::placeholder{color:#64748b;}
      .ini-fi[readonly]{background:#f1f5f9;color:#334155;}
      .ini-fi:focus{border-color:#0f3171;box-shadow:0 0 0 4px rgba(15,49,113,.14);}
      .ini-fg{margin-bottom:16px;}
      .ini-fg label{display:block;font-size:13px;font-weight:800;color:#1e293b;text-transform:uppercase;letter-spacing:.4px;margin-bottom:6px;}
      .ini-modal .ini-badge{font-size:11.5px;padding:3px 10px;}
    `;
    document.head.appendChild(style);
    return () => { document.getElementById("mns-styles")?.remove(); };
  }, []);

  const lista = filtro ? minhasSols.filter(s => s.tipo === filtro) : minhasSols;

  return (
    <div style={{ flex: 1, overflowY: "auto", padding: "20px 24px 40px", background: "#f5f7fb" }}>
      <div style={{ marginBottom: 18, display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: "#0f172a", display: "flex", alignItems: "center", gap: 8 }}>📤 Minhas Solicitações</h1>
          <p style={{ fontSize: 13, color: "#64748b", marginTop: 2 }}>Abra novas solicitações e acompanhe o status e o histórico das suas.</p>
        </div>
        {/* Os quatro sistemas que nascem nesta tela. Um botão só, com a
            escolha dentro: quatro botões de ajuda lado a lado seriam mais
            ruído do que ajuda. */}
        <ResumoDeFuncoes fluxo={["vaga", "ferias", "advertencia", "demissao"]} />
      </div>

      {/* Botões de criação */}
      <div className="ini-card">
        <div className="ini-card-hd"><h3>➕ Nova Solicitação</h3></div>
        <div className="ini-card-body">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(140px,1fr))", gap: 10 }}>
            {/* O menu de "preencher à mão" fica DENTRO do modal, não aqui: o
                que ele oferece muda a solicitação aberta, não a decisão de
                abrir uma. */}
            {/* Na Central a vaga é a tela da Gestão de Recrutamento (com o
                catálogo), não este modal — o card só leva pra lá. */}
            <button onClick={base === "central" ? () => nav(rotas.vaga) : abrirModalVaga} className="ini-sol-create"><span className="icon">🎯</span><span>Solicitar Vaga</span></button>
            <button onClick={abrirModalFerias} className="ini-sol-create"><span className="icon">📅</span><span>Solicitar Férias</span></button>
            <button onClick={abrirModalAdv} className="ini-sol-create"><span className="icon">⚠️</span><span>Advertência</span></button>
            {/* Demissão estava como "Em breve" — mas a tela existe e funciona
                desde sempre, só não estava ligada aqui. Vai para a página
                dedicada em vez de virar modal: é um formulário de vários
                passos, com anexos, e não cabe num card. */}
            <button onClick={() => nav(rotas.demissao)} className="ini-sol-create">
              <span className="icon">🚪</span><span>Solicitar Demissão</span>
            </button>
            {/* Materiais e Chamado entram no mesmo padrão dos demais cards.
                O card só leva para a tela do módulo, que é onde o fluxo
                próprio vive (carrinho de itens, anexo, categoria): refazer o
                formulário aqui seria uma segunda versão para manter. */}
            <button onClick={() => nav(rotas.materiais)} className="ini-sol-create">
              <span className="icon">📦</span><span>Solicitar Materiais</span>
            </button>
            <button onClick={() => nav(rotas.chamadoNovo)} className="ini-sol-create">
              <span className="icon">🎧</span><span>Abrir Chamado</span>
            </button>
            {/* Mudança de Função já aparecia no histórico e no chat, mas não
                tinha por onde ABRIR daqui — o encarregado tinha que achar a
                tela no menu do RH. Mesmo padrão de Demissão e Materiais: leva
                para a tela do módulo, que tem o fluxo próprio (cargo atual,
                cargo novo, ASO do SST). */}
            {/* Orientações Jurídicas (17/09/2026): perguntar ao Jurídico e ver
                todas as respostas + as próprias — cada módulo tem a sua porta
                (rotas.orientacoes). */}
            <button onClick={() => nav(rotas.orientacoes)} className="ini-sol-create">
              <span className="icon">⚖️</span><span>Orientações Jurídicas</span>
            </button>
            <button onClick={() => nav(rotas.trocaFuncao)} className="ini-sol-create">
              <span className="icon">🔀</span><span>Mudança de Função</span>
            </button>
          </div>
        </div>
      </div>

      {/* Histórico / status */}
      <div className="ini-card">
        <div className="ini-card-hd">
          <h3>🗂 Histórico & Status</h3>
          <div style={{ display: "flex", gap: 6 }}>
            {FILTROS.map(({ valor: f, rotulo }) => (
              <button key={f || "all"} onClick={() => setFiltro(f)}
                style={{ padding: "4px 10px", borderRadius: 16, fontSize: 11, fontWeight: 700, cursor: "pointer",
                  border: `1px solid ${filtro === f ? "#0f3171" : "#e2e8f0"}`, background: filtro === f ? "#0f3171" : "#fff", color: filtro === f ? "#fff" : "#475569" }}>
                {rotulo}
              </button>
            ))}
          </div>
        </div>
        <div className="ini-card-body">
          {loadingSols ? (
            <div style={{ padding: "24px 0", textAlign: "center", color: "#64748b", fontSize: 13 }}>Carregando...</div>
          ) : lista.length === 0 ? (
            <div style={{ padding: "24px 0", textAlign: "center", color: "#64748b", fontSize: 13 }}>
              <div style={{ fontSize: 28, marginBottom: 8 }}>✅</div>Nenhuma solicitação ainda.
            </div>
          ) : (
            <div>
              {lista.map(s => {
                const dias = diasDesde(s.statusDesde);
                const qtd = s.qtdVagas || 1;
                return (
                  <div key={`${s.tipo}-${s.id}`} className="ini-sol-item">
                    <div className="ini-sol-icon">{s.icon}</div>
                    <div className="ini-sol-info">
                      {s.tipo === "Vaga" && (
                        <div className="ini-sol-top">
                          {ehSubstituicao(s.motivo) && s.substituido && (
                            <span className="ini-sol-tag">🔁 Substituindo: <strong>{s.substituido}</strong></span>
                          )}
                          <span className="ini-sol-tag">🎯 {qtd} vaga{qtd > 1 ? "s" : ""} solicitada{qtd > 1 ? "s" : ""}</span>
                          {s.motivo && <span className="ini-sol-tag">{motivoLabel(s.motivo)}</span>}
                          {s.dataInicio && (
                            <span className="ini-sol-tag" title={s.grau ? `Urgência ${s.grau}` : undefined}>
                              📆 Início {fmtBr(s.dataInicio)}{s.grau ? ` · ${s.grau}` : ""}
                              {(s.alteracoes?.length ?? 0) > 0 ? ` · ${s.alteracoes!.length}× remarcada` : ""}
                            </span>
                          )}
                        </div>
                      )}
                      <div className="ini-sol-title">{s.titulo}</div>
                      <div className="ini-sol-meta">{s.tipo} · #{s.id} · {fmtDt(s.data)}</div>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
                      <span className={`ini-badge ${badgeStatusCls(s.status)}`}>{s.status}</span>
                      {s.excecao && <span className="ini-badge" style={{ background: "#fef3c7", color: "#b45309", borderColor: "#fde68a" }}>EXCEÇÃO</span>}
                      {dias !== null && (
                        <span className="ini-sol-dias" title={`Tempo parado no status atual: ${s.status}`}>
                          ⏱ {dias === 0 ? "hoje" : `há ${dias} dia${dias > 1 ? "s" : ""}`} neste status
                        </span>
                      )}
                      {/* Depois de criada, a única coisa que o solicitante muda
                          é a data de início — e com justificativa. */}
                      {vagaEditavel(s) && (
                        <button onClick={() => setEditData({ sol: s, data: s.dataInicio || "", justificativa: "" })}
                          title="Alterar a data de início prevista desta vaga"
                          style={{ padding: "4px 10px", borderRadius: 8, border: "1px solid #dbe4f0", background: "#fff", color: "#0f3171", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
                          📆 Alterar data
                        </button>
                      )}
                      {/* Demissão (17/09/2026): reconsiderar — cancela até o ASO ser agendado. */}
                      {s.tipo === "Demissão" && typeof s.id === "number" && (
                        <BotaoCancelarDemissao compacto solicitacao={{ id: s.id, status: s.status, colaborador_nome: s.titulo.replace(/^Demissão — /, "") }}
                          onCancelada={carregarMinhasSols} avisar={(m, t) => toast(m, t)} />
                      )}
                      {/* Reler o que foi pedido e falar com quem está tratando.
                          A conversa é a MESMA que o outro lado enxerga — ver
                          encarregados/DetalheSolicitacao. */}
                      <button
                        onClick={() => (s.rota ? nav(s.rota) : setDetalhe(s))}
                        title={s.rota
                          ? "Abrir na tela do módulo, que tem o detalhe completo"
                          : "Ver os detalhes e conversar sobre esta solicitação"}
                        style={{ padding: "4px 10px", borderRadius: 8, border: "1px solid #dbe4f0", background: "#fff", color: "#0f3171", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
                        {s.acao ?? "💬 Detalhes e chat"}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* ── Modal: alterar a data de início da vaga ── */}
      {detalhe && (
        <DetalheSolicitacao
          tipo={detalhe.tipo as TipoSolicitacao}
          id={detalhe.id}
          titulo={detalhe.titulo}
          status={detalhe.status}
          onFechar={() => setDetalhe(null)}
          onRefazer={detalhe.tipo === "Férias" ? abrirRefazerFerias : undefined}
        />
      )}

      {editData && prazoEdicao && (
        <div className="ini-modal-ov">
          <div className="ini-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 520 }}>
            <button onClick={() => setEditData(null)} style={{ position: "absolute", top: 14, right: 14, background: "none", border: "none", color: "#64748b", fontSize: 20, cursor: "pointer" }}>✕</button>
            <div style={{ fontSize: 20, fontWeight: 800, marginBottom: 4 }}>📆 Alterar data de início</div>
            <div style={{ fontSize: 14.5, color: "#64748b", marginBottom: 14 }}>
              Vaga #{editData.sol.id} — {editData.sol.titulo}. Esta é a única informação que você altera depois de solicitar; o resto é com o Recrutamento.
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div className="ini-fg">
                <label>Data atual</label>
                <input className="ini-fi" readOnly value={fmtBr(editData.sol.dataInicio) || "—"} style={{ background: "#f1f5f9", color: "#475569" }} />
              </div>
              <div className="ini-fg">
                <label>Nova data *</label>
                <input className="ini-fi" type="date" min={dataMinimaVaga()} value={editData.data}
                  onChange={e => setEditData(d => d && ({ ...d, data: e.target.value }))} />
              </div>
            </div>
            <PrazoAviso prazo={prazoEdicao} />

            <div className="ini-fg">
              <label>Por que a data mudou? *</label>
              <textarea className="ini-fi" rows={3} placeholder="Explique o motivo da alteração (mínimo 10 caracteres)…"
                value={editData.justificativa} onChange={e => setEditData(d => d && ({ ...d, justificativa: e.target.value }))} />
              <div style={{ fontSize: 14.5, color: "#64748b", marginTop: 4 }}>
                A justificativa fica registrada na vaga, com o seu nome e a data — o Recrutamento vê o histórico completo.
              </div>
            </div>

            {(editData.sol.alteracoes?.length ?? 0) > 0 && (
              <div style={{ marginTop: 6, border: "1px solid #e2e8f0", borderRadius: 10, padding: "9px 11px", background: "#f8fafc" }}>
                <div style={{ fontSize: 14.5, fontWeight: 800, color: "#64748b", textTransform: "uppercase", letterSpacing: ".4px", marginBottom: 6 }}>Alterações anteriores</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {editData.sol.alteracoes!.map((a, i) => (
                    <div key={i} style={{ fontSize: 14, color: "#475569" }}>
                      <b>{fmtBr(a?.de) || "—"} → {fmtBr(a?.para)}</b>
                      {a?.em ? <span style={{ color: "#64748b" }}> · {fmtDt(a.em)}</span> : null}
                      {a?.por_nome ? <span style={{ color: "#64748b" }}> · {a.por_nome}</span> : null}
                      <div style={{ fontStyle: "italic" }}>{a?.justificativa}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16, paddingTop: 14, borderTop: "1px solid #e2e8f0" }}>
              <button onClick={() => setEditData(null)} style={{ padding: "7px 14px", borderRadius: 10, border: "1px solid #e2e8f0", background: "#fff", color: "#475569", fontSize: 14.5, fontWeight: 700, cursor: "pointer" }}>Cancelar</button>
              <button onClick={salvarNovaData} disabled={salvandoData}
                style={{ padding: "7px 14px", borderRadius: 10, border: "none", background: salvandoData ? "#64748b" : "#0f3171", color: "#fff", fontSize: 14.5, fontWeight: 700, cursor: salvandoData ? "default" : "pointer" }}>
                {salvandoData ? "Salvando…" : "✓ Salvar nova data"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal Nova Vaga ── */}
      {modalVaga && (
        <div className="ini-modal-ov">
          <div className="ini-modal" onClick={e => e.stopPropagation()}>
            <button onClick={() => setModalVaga(false)} style={{ position: "absolute", top: 14, right: 14, background: "none", border: "none", color: "#64748b", fontSize: 20, cursor: "pointer" }}>✕</button>

            {/* Sem "Preencher manualmente" aqui, de propósito (03/09/2026).
                É vaga do escritório — coisa da Central de Serviços e da Gestão
                de Recrutamento, onde a opção é um botão à vista na etapa 1.
                Nesta tela nem escondida atrás de capacidade ela cabia: o modo
                à mão precisa do catálogo de Suprimentos, que o formulário do
                encarregado não tem. */}
            <div style={{ fontSize: 20, fontWeight: 800, marginBottom: 4 }}>Solicitar Nova Vaga</div>
            <div style={{ fontSize: 14.5, color: "#64748b", marginBottom: 14 }}>
              {vagaStep === 1 ? "Etapa 1 de 3 — Identificação da Vaga" : vagaStep === 2 ? "Etapa 2 de 3 — Detalhes do Posto" : "Etapa 3 de 3 — Requisitos e Urgência"}
            </div>
            <div style={{ display: "flex", gap: 6, marginBottom: 16 }}>
              {[1, 2, 3].map(i => (
                <div key={i} style={{ flex: 1, height: 3, borderRadius: 2, background: i < vagaStep ? "#16a34a" : i === vagaStep ? "#0f3171" : "#dbe4f0", transition: "background .2s" }} />
              ))}
            </div>

            {vagaStep === 1 && (<>
              <div className="ini-fg">
                <label>Motivo da Vaga *</label>
                <select className="ini-fi" value={vaga.motivo_vaga}
                  onChange={e => {
                    const m = e.target.value;
                    // Trocou de motivo: limpa tudo o que vinha do cadastro do
                    // escolhido anterior (senão sobra cargo/contrato/salário de
                    // outro posto) e obriga a escolher de novo.
                    setSubstituidoId(null); setEmpSearch("");
                    setVaga(v => ({
                      ...v, motivo_vaga: m, nome_substituido: "", cargo: "", contrato: "",
                      salario: "", escala: "", insalubridade_recebe: "Não", insalubridade_quanto: "",
                    }));
                  }}>
                  <option value="">— Selecione —</option>
                  {MOTIVOS_VAGA.map(o => <option key={o}>{o}</option>)}
                </select>
              </div>
              {/* O colaborador é obrigatório em todos os motivos: é dele que
                  a vaga copia cargo, contrato, escala e salário. */}
              {!!vaga.motivo_vaga && (
                <div className="ini-fg" style={{ position: "relative" }} onBlur={() => setTimeout(() => setShowEmpDrop(false), 150)}>
                  <label>{rotuloReferencia(vaga.motivo_vaga)} *</label>
                  <input className="ini-fi" placeholder="Digite o nome e escolha na lista..." value={empSearch} autoComplete="off"
                    onChange={e => { const v = e.target.value; setEmpSearch(v); setSubstituidoId(null); setVaga(prev => ({ ...prev, nome_substituido: "", cargo: "", contrato: "", salario: "", escala: "" })); if (v.length >= 2) { setShowEmpDrop(true); buscarEmpregados(v); } else { setShowEmpDrop(false); setEmpregados([]); } }} />
                  {showEmpDrop && empSearch.length >= 2 && (
                    <div style={{ position: "absolute", top: "100%", left: 0, right: 0, zIndex: 999, background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, boxShadow: "0 8px 24px rgba(15,23,42,.14)", maxHeight: 220, overflowY: "auto", marginTop: 2 }}>
                      {loadingEmps ? <div style={{ padding: "12px", fontSize: 14.5, color: "#64748b", textAlign: "center" }}>Buscando...</div>
                        : empregados.length === 0 ? <div style={{ padding: "12px", fontSize: 14.5, color: "#64748b", textAlign: "center" }}>Nenhum colaborador encontrado.</div>
                          : empregados.slice(0, 40).map((emp, i) => {
                            // Já tem vaga de substituição em pé: fica na lista
                            // para a pessoa entender por que não pode escolher.
                            const preso = ehSubstituicao(vaga.motivo_vaga) ? presos.get(Number(emp.ID)) : undefined;
                            return (
                            <div key={i} onMouseDown={() => selecionarEmpregado(emp)} style={{ padding: "8px 12px", fontSize: 14, cursor: preso ? "not-allowed" : "pointer", borderBottom: "1px solid #f1f5f9", color: preso ? "#64748b" : "#0f172a", background: preso ? "#f8fafc" : "#fff" }}
                              onMouseEnter={e => { if (!preso) e.currentTarget.style.background = "#f0f4ff"; }} onMouseLeave={e => { e.currentTarget.style.background = preso ? "#f8fafc" : "#fff"; }}>
                              <div style={{ fontWeight: 600 }}>{emp.Nome}</div>
                              <div style={{ fontSize: 14.5, color: "#64748b" }}>{emp["Título do Cargo"]}{emp["Nome Filial"] ? ` · ${emp["Nome Filial"]}` : ""}</div>
                              {preso && <div style={{ fontSize: 14.5, fontWeight: 800, color: "#b91c1c", marginTop: 2 }}>🚫 já está na vaga de substituição #{preso}</div>}
                            </div>
                            );
                          })}
                    </div>
                  )}
                  <div style={{ marginTop: 6, fontSize: 14, color: "#64748b" }}>{ajudaReferencia(vaga.motivo_vaga)}</div>
                  {/* Sem nome: fora da Substituição o escolhido é só o molde da
                      vaga, e é isso que a tela confirma. */}
                  {!!substituidoId && !mostraNomeReferencia(vaga.motivo_vaga) && (
                    <div style={{ marginTop: 6, fontSize: 14, fontWeight: 700, color: "#15803d", background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 8, padding: "6px 9px" }}>
                      ✓ Colaborador escolhido — cargo, contrato e escala já vieram do cadastro dele.
                    </div>
                  )}
                  {/* Substituição: mostra a demissão vinculada; sem nenhuma, a
                      nota fica aqui depois que a pessoa fecha o card no OK. */}
                  {ehSubstituicao(vaga.motivo_vaga) && !!substituidoId && demissaoBusca === "buscando" && (
                    <div style={{ marginTop: 6, fontSize: 14, color: "#64748b" }}>Procurando a solicitação de demissão…</div>
                  )}
                  {ehSubstituicao(vaga.motivo_vaga) && !!substituidoId && demissaoBusca === "achou" && !!demissaoId && (
                    <div style={{ marginTop: 6, fontSize: 14, fontWeight: 700, color: "#0f3171", background: "#eef4ff", border: "1px solid #c7d7f5", borderRadius: 8, padding: "6px 9px" }}>
                      🔗 Vinculada à solicitação de demissão #{demissaoId} — a vaga repõe essa saída.
                    </div>
                  )}
                  {ehSubstituicao(vaga.motivo_vaga) && !!substituidoId && demissaoBusca === "nenhuma" && (
                    <div style={{ marginTop: 6, fontSize: 14, fontWeight: 700, color: "#92400e", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 8, padding: "6px 9px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                      <span>⚠️ Sem solicitação de demissão para esta pessoa.</span>
                      <button type="button" onClick={() => setAvisoDemissao(true)}
                        style={{ padding: "4px 10px", borderRadius: 8, border: "1px solid #fcd34d", background: "#fff", color: "#92400e", fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
                        Ver aviso
                      </button>
                    </div>
                  )}
                </div>
              )}
              {/* Contrato e cargo vêm do cadastro do escolhido e ficam travados
                  — a vaga é do posto dele, não de outro. */}
              <div className="ini-fg">
                <label>Contrato *<span style={{ color: "#64748b", fontWeight: 600 }}> — do colaborador escolhido</span></label>
                <input className="ini-fi" readOnly value={vaga.contrato} placeholder="Escolha o colaborador acima"
                  style={{ background: "#f1f5f9", color: "#475569", cursor: "not-allowed" }} />
              </div>
              <div className="ini-fg">
                <label>Cargo *<span style={{ color: "#64748b", fontWeight: 600 }}> — do colaborador escolhido</span></label>
                <input className="ini-fi" placeholder="Escolha o colaborador acima"
                  value={vaga.cargo} readOnly
                  style={{ background: "#f1f5f9", color: "#475569", cursor: "not-allowed" }} />
                {cnhDoCargo && (
                  <div style={{ marginTop: 6, fontSize: 14, fontWeight: 700, color: "#b45309", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 8, padding: "6px 9px" }}>
                    🚗 {cnhDoCargo}: CNH obrigatória — já entra sozinha nos requisitos e não pode ser tirada.
                  </div>
                )}
              </div>
              {/* Vínculo com o catálogo de Suprimentos (15/09/2026): posto e
                  função obrigatórios quando o contrato tem posto no catálogo —
                  é do posto que vêm o V.A e o V.T. O contrato é o do
                  colaborador e não muda. */}
              <VinculoCatalogoVaga
                contratoNome={vaga.contrato}
                valor={{ contrato_id: vaga.contrato_id, posto_id: vaga.posto_id, funcao_id: vaga.funcao_id }}
                onChange={v => setVaga(x => ({ ...x, ...v }))}
                onListas={setCatListas}
                classeInput="ini-fi" classeGrupo="ini-fg" />
              {/* Setor (16/09/2026): quem aprova a vaga administrativa. Desde 17/09 só
                  aparece com a caixa "administrativa" marcada — setor NÃO manda mais pra Diretoria. */}
              {ehAdministrativa && <div className="ini-fg">
                <label>Setor <span style={{ color: "#64748b", fontWeight: 600 }}>— só na vaga administrativa: é o setor da Diretoria que aprova</span></label>
                <select className="ini-fi" value={vaga.setor} onChange={e => setVaga(v => ({ ...v, setor: e.target.value }))}>
                  <option value="">— Selecione o setor —</option>
                  {setoresCatalogo.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div className="ini-fg">
                  <label>Estado (UF) <span style={{ color: "#dc2626" }}>*</span></label>
                  <select className="ini-fi" value={vaga.estado} onChange={e => setVaga(v => ({ ...v, estado: e.target.value, cidade: "" }))}>
                    <option value="">— Selecione —</option>
                    {ESTADOS_BR.map(e => <option key={e.uf} value={e.uf}>{e.uf} — {e.nome}</option>)}
                  </select>
                </div>
                <div className="ini-fg">
                  <label>Cidade <span style={{ color: "#dc2626" }}>*</span></label>
                  <select className="ini-fi" value={vaga.cidade} disabled={!vaga.estado} onChange={e => setVaga(v => ({ ...v, cidade: e.target.value }))}>
                    <option value="">{vaga.estado ? "— Selecione —" : "Selecione o estado primeiro"}</option>
                    {municipiosDe(vaga.estado).map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
              </div>
              {(podeAdministrativa || contratoAdm) && (
                <div className="ini-fg">
                  <label style={{ display: "flex", alignItems: "flex-start", gap: 9, cursor: "pointer", background: ehAdministrativa ? "#f0f6ff" : "#fff", border: ehAdministrativa ? "1.5px solid #0f3171" : "1px solid #e2e8f0", borderRadius: 11, padding: "10px 13px", transition: "background .18s, border-color .18s" }}>
                    <input type="checkbox" checked={ehAdministrativa} disabled={contratoAdm} style={{ marginTop: 2, width: 15, height: 15, accentColor: "#0f3171", cursor: contratoAdm ? "not-allowed" : "pointer" }}
                      onChange={e => setVaga(v => ({ ...v, administrativa: e.target.checked }))} />
                    <span>
                      <span style={{ display: "block", fontSize: 14.5, fontWeight: 800, color: "#0f172a" }}>Vaga é administrativa?</span>
                      <span style={{ display: "block", fontSize: 14.5, color: "#64748b", marginTop: 3, lineHeight: 1.45 }}>
                        {contratoAdm ? <b style={{ color: "#0f3171" }}>Contrato ADM E ESTAGIÁRIOS: vaga administrativa automaticamente. </b> : null}Vaga do escritório. Só quem tem “Ver vaga administrativa?” enxerga, aprova ou reprova — os demais nem veem que ela existe.
                      </span>
                    </span>
                  </label>
                </div>
              )}
            </>)}

            {vagaStep === 2 && (<>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                {/* Substituição repõe UMA pessoa: a vaga aponta para um
                    colaborador específico (substituido_id) e é esse id que
                    trava a pessoa numa vaga só. O limite vem de maximoDeVagas,
                    a mesma regra que o ModalNovaVaga usa. */}
                <div className="ini-fg">
                  <label>Quantidade de Vagas</label>
                  <input className="ini-fi" type="number" min={1}
                    max={maximoDeVagas(vaga.motivo_vaga)}
                    value={ehSubstituicao(vaga.motivo_vaga) ? "1" : vaga.quantidade_vagas}
                    disabled={ehSubstituicao(vaga.motivo_vaga)}
                    onChange={e => setVaga(v => ({ ...v, quantidade_vagas: e.target.value }))} />
                  {ehSubstituicao(vaga.motivo_vaga) && (
                    <div style={{ marginTop: 4, fontSize: 14.5, color: "#64748b" }}>
                      Substituição repõe uma pessoa por vez.
                    </div>
                  )}
                </div>
                <div className="ini-fg">
                  <label>Data de Início Prevista *</label>
                  <input className="ini-fi" type="date" min={dataMinimaVaga()} value={vaga.data_inicio_prevista}
                    onChange={e => setVaga(v => ({ ...v, data_inicio_prevista: e.target.value }))} />
                </div>
              </div>
              <PrazoAviso prazo={prazo} />
              {/* Horário saiu: a escala do cadastro já traz a jornada dentro
                  ("07:30-17:18 (1H)(08:48)"). */}
              <div className="ini-fg"><label>Escala</label><input className="ini-fi" placeholder="Ex: 12x36, 5x2..." value={vaga.escala} onChange={e => setVaga(v => ({ ...v, escala: e.target.value }))} /></div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                {/* Salário: quem abre a vaga não vê o valor. Ele vem do cadastro
                    do colaborador escolhido e segue na solicitação — só o
                    Operacional e o Recrutamento, que aprovam, é que enxergam. */}
                <div className="ini-fg">
                  <label>Salário</label>
                  <input className="ini-fi" readOnly value={vaga.salario ? SALARIO_MASCARA : ""} placeholder="Vem do cadastro do colaborador"
                    style={{ background: "#f1f5f9", color: "#475569", cursor: "not-allowed", letterSpacing: 2 }} />
                  <div style={{ marginTop: 4, fontSize: 14.5, color: "#64748b" }}>Visível só para o Operacional e o Recrutamento.</div>
                </div>
                {/* Insalubridade e benefícios vêm da Planilha de Custo do
                    contrato (pelo colaborador escolhido). Só leitura: o
                    encarregado não escolhe nem edita — ver custoPosto.ts. */}
                <div className="ini-fg">
                  <label>Insalubridade <span style={{ color: "#64748b", fontWeight: 600 }}>— da Planilha de Custo</span></label>
                  <input className="ini-fi" readOnly
                    value={custoBuscando ? "Consultando a planilha…" : vaga.insalubridade_recebe === "Sim" ? `Sim — ${vaga.insalubridade_quanto}` : substituidoId ? "Não" : ""}
                    placeholder="Escolha o colaborador na etapa 1"
                    style={{ background: "#f1f5f9", color: "#475569", cursor: "not-allowed" }} />
                </div>
              </div>
              <div className="ini-fg">
                <label>Benefícios <span style={{ color: "#64748b", fontWeight: 600 }}>— VT e VA do contrato</span></label>
                <input className="ini-fi" readOnly
                  value={custoBuscando ? "Consultando a planilha…" : vaga.beneficios}
                  placeholder={!substituidoId ? "Escolha o colaborador na etapa 1" : !vaga.posto_id ? "Selecione o posto no catálogo (etapa 1) para puxar o V.A e o V.T" : "Posto sem Planilha de Custo — o Recrutamento completa"}
                  style={{ background: "#f1f5f9", color: "#475569", cursor: "not-allowed" }} />
                {custoNota && (
                  <div style={{ marginTop: 4, fontSize: 14.5, fontWeight: custoPosto ? 400 : 600, color: custoPosto && !custoPosto.ambiguo ? "#64748b" : "#92400e" }}>{custoNota}</div>
                )}
              </div>
              {/* Local Exato / Posto saiu: o posto já vem do colaborador
                  escolhido na etapa 1. */}
              <div className="ini-fg">
                <label>Essa é uma Vaga de Reserva Técnica (RT)?</label>
                <select className="ini-fi" value={vaga.reserva_tecnica}
                  onChange={e => setVaga(v => ({ ...v, reserva_tecnica: e.target.value }))}>
                  <option>Não</option><option>Sim</option>
                </select>
              </div>
            </>)}

            {vagaStep === 3 && (<>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                {/* Grau não é mais escolhido: sai do prazo da data de início. */}
                <div className="ini-fg">
                  <label>Grau de Urgência — calculado pelo prazo</label>
                  <input className="ini-fi" readOnly value={prazo.grau ?? "— informe a data de início —"}
                    style={{ background: "#f1f5f9", color: prazo.grau ? "#0f172a" : "#64748b", fontWeight: 700, cursor: "not-allowed" }} />
                </div>
                <div className="ini-fg"><label>Alta Rotatividade?</label><select className="ini-fi" value={vaga.alta_rotatividade} onChange={e => setVaga(v => ({ ...v, alta_rotatividade: e.target.value }))}><option>Não</option><option>Sim</option></select></div>
              </div>
              <PrazoAviso prazo={prazo} />
              {/* Requisitos obrigatórios e experiência mínima SAÍRAM do
                  formulário (14/09/2026): vão vir da licitação/planilha, não
                  do encarregado. A CNH continua automática pelo cargo. */}
              {cnhDoCargo && (
                <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 14.5, fontWeight: 700, color: "#b45309", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 8, padding: "7px 10px", marginBottom: 10 }}>
                  <span>🚗</span><span>{REQ_CNH_TEXTO} <span style={{ fontWeight: 600, color: "#92400e" }}>(automático para {cnhDoCargo.toLowerCase()})</span></span>
                </div>
              )}
              <div className="ini-fg"><label>Requisitos Desejáveis</label><textarea className="ini-fi" rows={2} placeholder="Inglês básico, curso técnico..." value={vaga.req_desejaveis} onChange={e => setVaga(v => ({ ...v, req_desejaveis: e.target.value }))} /></div>
                            {/* Indicação: quem abre a vaga muitas vezes JÁ tem alguém em mente, e
                  hoje isso chegava no Recrutamento por WhatsApp, solto. Dizendo
                  "Sim", os três dados vêm juntos — a regra está em
                  erroDaRecomendacao(), a mesma que a outra tela de vaga usa. */}
              <div className="ini-fg">
                <label>Você já tem recomendação para essa vaga?</label>
                <select className="ini-fi" value={vaga.tem_recomendacao}
                  onChange={e => setVaga(v => ({ ...v, tem_recomendacao: e.target.value }))}>
                  <option>Não</option><option>Sim</option>
                </select>
              </div>
              {vaga.tem_recomendacao === "Sim" && (
                <div style={{ border: "1px solid #e2e8f0", borderRadius: 10, padding: 12, background: "#f8fafc" }}>
                  <div style={{ fontSize: 14.5, fontWeight: 800, color: "#334155", marginBottom: 8 }}>Dados de quem você está indicando</div>
                  <div className="ini-fg"><label>Nome completo *</label>
                    <input className="ini-fi" placeholder="Nome completo da pessoa indicada"
                      value={vaga.recomendacao_nome} onChange={e => setVaga(v => ({ ...v, recomendacao_nome: e.target.value }))} /></div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                    <div className="ini-fg"><label>CPF *</label>
                      <input className="ini-fi" inputMode="numeric" placeholder="000.000.000-00"
                        value={vaga.recomendacao_cpf} onChange={e => setVaga(v => ({ ...v, recomendacao_cpf: maskCpf(e.target.value) }))} />
                      {soDigitos(vaga.recomendacao_cpf).length === 11 && !cpfValido(vaga.recomendacao_cpf) && (
                        <div style={{ marginTop: 4, fontSize: 14.5, color: "#dc2626", fontWeight: 700 }}>CPF não confere.</div>
                      )}</div>
                    <div className="ini-fg"><label>WhatsApp *</label>
                      <input className="ini-fi" inputMode="numeric" placeholder="(51) 99999-9999"
                        value={vaga.recomendacao_whatsapp} onChange={e => setVaga(v => ({ ...v, recomendacao_whatsapp: maskFone(e.target.value) }))} /></div>
                  </div>
                </div>
              )}
              <div className="ini-fg"><label>Observação Importante</label><textarea className="ini-fi" rows={2} placeholder="Opcional..." value={vaga.observacao_importante} onChange={e => setVaga(v => ({ ...v, observacao_importante: e.target.value }))} /></div>
            </>)}

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16, paddingTop: 14, borderTop: "1px solid #e2e8f0" }}>
              {vagaStep > 1 && <button onClick={() => setVagaStep(s => s - 1)} style={{ padding: "7px 14px", borderRadius: 10, border: "1px solid #e2e8f0", background: "#fff", color: "#475569", fontSize: 14.5, fontWeight: 700, cursor: "pointer" }}>← Anterior</button>}
              {vagaStep < 3 && <button onClick={() => { if (vagaValidar(vagaStep)) setVagaStep(s => s + 1); }} style={{ padding: "7px 14px", borderRadius: 10, border: "none", background: "#0f3171", color: "#fff", fontSize: 14.5, fontWeight: 700, cursor: "pointer" }}>Próximo →</button>}
              {vagaStep === 3 && <button onClick={submitVaga} style={{ padding: "7px 14px", borderRadius: 10, border: "none", background: "#16a34a", color: "#fff", fontSize: 14.5, fontWeight: 700, cursor: "pointer" }}>✓ Solicitar Vaga</button>}
            </div>
          </div>
        </div>
      )}

      {/* ── Modal Férias ── */}
      {modalFerias && (
        <div className="ini-modal-ov">
          <div className="ini-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 520 }}>
            <button onClick={() => setModalFerias(false)} style={{ position: "absolute", top: 14, right: 14, background: "none", border: "none", color: "#64748b", fontSize: 20, cursor: "pointer" }}>✕</button>
            <div style={{ fontSize: 20, fontWeight: 800, marginBottom: 4 }}>{feriasRefazerId ? `🔁 Refazer solicitação de férias #${feriasRefazerId}` : "📅 Solicitar Férias"}</div>
            <div style={{ fontSize: 14.5, color: "#64748b", marginBottom: 16 }}>Antecedência mínima de 30 dias · abono (venda) de até 10 dias.</div>
            {feriasRefazerId && (
              <div style={{ margin: "-6px 0 14px", padding: "9px 12px", borderRadius: 10, background: "#eef2ff", border: "1px solid #c7d2fe", fontSize: 14.5, color: "#3730a3", lineHeight: 1.5 }}>
                ⚠️ {AVISO_REFAZER}
              </div>
            )}
            {/* Refazendo, o colaborador é o mesmo — muda só o pedido. */}
            <div className="ini-fg" style={{ position: "relative", display: feriasRefazerId ? "none" : undefined }} onBlur={() => setTimeout(() => setShowEmpDrop(false), 150)}>
              <label>Colaborador *</label>
              <input className="ini-fi" placeholder="Digite o nome do colaborador..." value={empSearch} autoComplete="off"
                onChange={e => { const v = e.target.value; setEmpSearch(v); setFerias(f => ({ ...f, colaborador_id: null })); if (v.length >= 2) { setShowEmpDrop(true); buscarEmpregados(v); } else { setShowEmpDrop(false); setEmpregados([]); } }} />
              {showEmpDrop && empSearch.length >= 2 && (
                <div style={{ position: "absolute", top: "100%", left: 0, right: 0, zIndex: 999, background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, boxShadow: "0 8px 24px rgba(15,23,42,.14)", maxHeight: 220, overflowY: "auto", marginTop: 2 }}>
                  {loadingEmps ? <div style={{ padding: "12px", fontSize: 14.5, color: "#64748b", textAlign: "center" }}>Buscando...</div>
                    : empregados.length === 0 ? <div style={{ padding: "12px", fontSize: 14.5, color: "#64748b", textAlign: "center" }}>Nenhum colaborador encontrado.</div>
                      : empregados.slice(0, 40).map((emp, i) => (
                        <div key={i} onMouseDown={() => selecionarColabFerias(emp)} style={{ padding: "8px 12px", fontSize: 14, cursor: "pointer", borderBottom: "1px solid #f1f5f9", color: "#0f172a" }}
                          onMouseEnter={e => (e.currentTarget.style.background = "#f0f4ff")} onMouseLeave={e => (e.currentTarget.style.background = "#fff")}>
                          <div style={{ fontWeight: 600 }}>{emp.Nome}</div>
                          <div style={{ fontSize: 14.5, color: "#64748b" }}>{emp["Título do Cargo"]}{emp["Nome Filial"] ? ` · ${emp["Nome Filial"]}` : ""}</div>
                        </div>
                      ))}
                </div>
              )}
            </div>
            {ferias.colaborador_id && (
              <div style={{ margin: "-6px 0 14px", padding: "8px 12px", borderRadius: 10, background: "#f0f4ff", border: "1px solid #dbe4f0", fontSize: 14.5, color: "#475569" }}>
                <strong style={{ color: "#0f172a" }}>{ferias.colaborador_nome}</strong>
                {ferias.colaborador_cargo ? ` · ${ferias.colaborador_cargo}` : ""}{ferias.colaborador_filial ? ` · ${ferias.colaborador_filial}` : ""}
              </div>
            )}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div className="ini-fg"><label>Data de Saída *</label><input className="ini-fi" type="date" min={hojeMaisDias(0)} value={ferias.data_saida} onChange={e => setFerias(f => ({ ...f, data_saida: e.target.value }))} />
                {feriasForaDoPrazo() && (
                  <div style={{ marginTop: 6, fontSize: 14, fontWeight: 700, color: "#92400e", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 8, padding: "6px 9px" }}>
                    ⚠️ Fora do prazo: menos de 30 dias de antecedência. Vai entrar como exceção e pode ser recusada.
                  </div>
                )}
              </div>
              <div className="ini-fg"><label>Dias de Férias</label><select className="ini-fi" value={ferias.dias_ferias} onChange={e => setFerias(f => ({ ...f, dias_ferias: e.target.value }))}>{["30", "20", "15", "10"].map(o => <option key={o} value={o}>{o} dias</option>)}</select></div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div className="ini-fg"><label>Abono (vender dias)</label><select className="ini-fi" value={ferias.dias_vendidos} onChange={e => setFerias(f => ({ ...f, dias_vendidos: e.target.value }))}>{["0", "5", "10"].map(o => <option key={o} value={o}>{o} dias</option>)}</select></div>
              <div className="ini-fg"><label>Retorno (previsto)</label><input className="ini-fi" readOnly value={ferias.data_saida ? fmtDt(addDaysISO(ferias.data_saida, parseInt(ferias.dias_ferias) || 30)) : "—"} style={{ background: "#f8fafc", color: "#475569" }} /></div>
            </div>
            <div className="ini-fg"><label>Observações</label><textarea className="ini-fi" rows={2} value={ferias.observacoes} onChange={e => setFerias(f => ({ ...f, observacoes: e.target.value }))} placeholder="Opcional..." /></div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 8, paddingTop: 14, borderTop: "1px solid #e2e8f0" }}>
              <button onClick={() => setModalFerias(false)} style={{ padding: "7px 14px", borderRadius: 10, border: "1px solid #e2e8f0", background: "#fff", color: "#475569", fontSize: 14.5, fontWeight: 700, cursor: "pointer" }}>Cancelar</button>
              <button onClick={submitFerias} style={{ padding: "7px 14px", borderRadius: 10, border: "none", background: feriasRefazerId ? "#4f46e5" : "#16a34a", color: "#fff", fontSize: 14.5, fontWeight: 700, cursor: "pointer" }}>{feriasRefazerId ? "🔁 Refazer e enviar ao RH" : "✓ Solicitar Férias"}</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal Advertência ── */}
      {modalAdv && (
        <div className="ini-modal-ov">
          <div className="ini-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 560 }}>
            <button onClick={() => setModalAdv(false)} style={{ position: "absolute", top: 14, right: 14, background: "none", border: "none", color: "#64748b", fontSize: 20, cursor: "pointer" }}>✕</button>
            <div style={{ fontSize: 20, fontWeight: 800, marginBottom: 4 }}>⚠️ Solicitar Advertência</div>
            <div style={{ fontSize: 14.5, color: "#64748b", marginBottom: 12 }}>Informe quem recebe a advertência e responda as questões. Vai direto para o <b>Jurídico</b>, que aprova, reprova e dá o parecer.</div>
            {/* Quem pede vem do login — não se digita (17/09/2026). */}
            <div style={{ margin: "0 0 14px", padding: "8px 12px", borderRadius: 10, background: "#f8fafc", border: "1px solid #e2e8f0", fontSize: 14.5, color: "#475569" }}>
              <span style={{ fontSize: 14.5, fontWeight: 800, color: "#64748b", textTransform: "uppercase", letterSpacing: ".4px" }}>Solicitante</span><br />
              <strong style={{ color: "#0f172a" }}>{displayName || user?.email || "—"}</strong>{user?.email ? <span style={{ color: "#64748b" }}> · {user.email}</span> : null}
            </div>

            <div className="ini-fg" style={{ position: "relative" }} onBlur={() => setTimeout(() => setShowEmpDrop(false), 150)}>
              <label>Quem recebe a advertência (colaborador advertido) *</label>
              <input className="ini-fi" placeholder="Digite o nome do colaborador que será advertido..." value={empSearch} autoComplete="off"
                onChange={e => { const v = e.target.value; setEmpSearch(v); setAdv(a => ({ ...a, colaborador_id: null })); if (v.length >= 2) { setShowEmpDrop(true); buscarEmpregados(v); } else { setShowEmpDrop(false); setEmpregados([]); } }} />
              {showEmpDrop && empSearch.length >= 2 && (
                <div style={{ position: "absolute", top: "100%", left: 0, right: 0, zIndex: 999, background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, boxShadow: "0 8px 24px rgba(15,23,42,.14)", maxHeight: 220, overflowY: "auto", marginTop: 2 }}>
                  {loadingEmps ? <div style={{ padding: "12px", fontSize: 14.5, color: "#64748b", textAlign: "center" }}>Buscando...</div>
                    : empregados.length === 0 ? <div style={{ padding: "12px", fontSize: 14.5, color: "#64748b", textAlign: "center" }}>Nenhum colaborador encontrado.</div>
                      : empregados.slice(0, 40).map((emp, i) => (
                        <div key={i} onMouseDown={() => selecionarColabAdv(emp)} style={{ padding: "8px 12px", fontSize: 14, cursor: "pointer", borderBottom: "1px solid #f1f5f9", color: "#0f172a" }}
                          onMouseEnter={e => (e.currentTarget.style.background = "#f0f4ff")} onMouseLeave={e => (e.currentTarget.style.background = "#fff")}>
                          <div style={{ fontWeight: 600 }}>{emp.Nome}</div>
                          <div style={{ fontSize: 14.5, color: "#64748b" }}>{emp["Título do Cargo"]}{emp["Nome Filial"] ? ` · ${emp["Nome Filial"]}` : ""}</div>
                        </div>
                      ))}
                </div>
              )}
            </div>
            {adv.colaborador_id && (
              // A ficha de quem vai ser advertido, na hora de escolher (17/09/2026):
              // é o que confirma que a pessoa certa foi selecionada.
              <div style={{ margin: "-6px 0 14px", padding: "10px 12px", borderRadius: 10, background: "#f0f4ff", border: "1px solid #dbe4f0", fontSize: 14.5, color: "#475569" }}>
                <div style={{ fontSize: 14.5, fontWeight: 800, color: "#0f3171", textTransform: "uppercase", letterSpacing: ".4px", marginBottom: 4 }}>⚠️ Advertido</div>
                <strong style={{ color: "#0f172a", fontSize: 14 }}>{adv.colaborador_nome}</strong>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "2px 12px", marginTop: 6 }}>
                  {([
                    ["CPF", adv.colaborador_cpf], ["Cargo", adv.colaborador_cargo],
                    ["Contrato", adv.contrato || adv.colaborador_filial], ["Posto", adv.colaborador_posto],
                    ["Admissão", adv.colaborador_admissao ? `${fmtDt(adv.colaborador_admissao)}${tempoDeEmpresa(adv.colaborador_admissao) ? ` · ${tempoDeEmpresa(adv.colaborador_admissao)} de empresa` : ""}` : ""],
                    ["Escala", adv.colaborador_escala],
                  ] as [string, string][]).filter(([, v]) => v).map(([l, v]) => (
                    <div key={l}><span style={{ color: "#64748b", fontWeight: 700 }}>{l}:</span> {v}</div>
                  ))}
                </div>
              </div>
            )}

            {adv.colaborador_id && advHistorico.length > 0 && (
              <div style={{ margin: "-6px 0 14px", padding: "8px 12px", borderRadius: 10, background: "#fff7ed", border: "1px solid #fed7aa", fontSize: 14.5, color: "#9a3412" }}>
                <div style={{ fontWeight: 700, marginBottom: 4 }}>⚠️ {advHistorico.length} advertência(s) anterior(es) deste colaborador:</div>
                {advHistorico.slice(0, 5).map(h => (
                  <div key={h.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, borderTop: "1px solid #fed7aa", padding: "3px 0" }}>
                    <span>{h.tipo_advertencia || "—"} · grau {h.grau || "—"}</span>
                    <span style={{ color: "#b45309" }}>{fmtDt(h.data_ocorrido || h.created_at)} · {h.status}</span>
                  </div>
                ))}
              </div>
            )}

            <div className="ini-fg">
              <label>Contrato (puxado automaticamente do colaborador)</label>
              <input className="ini-fi" readOnly value={adv.contrato || "—"} style={{ background: "#f8fafc", color: "#475569", cursor: "not-allowed" }} />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div className="ini-fg"><label>Tipo de advertência *</label><select className="ini-fi" value={adv.tipo_advertencia} onChange={e => setAdv(a => ({ ...a, tipo_advertencia: e.target.value }))}><option value="">— Selecione —</option>{["Escrita", "Suspensão", "Justa Causa"].map(o => <option key={o}>{o}</option>)}</select></div>
              <div className="ini-fg"><label>Grau *</label><select className="ini-fi" value={adv.grau} onChange={e => setAdv(a => ({ ...a, grau: e.target.value }))}><option value="">— Selecione —</option>{["Baixo", "Médio", "Alto"].map(o => <option key={o}>{o}</option>)}</select></div>
            </div>

            <div className="ini-fg"><label>Data do ocorrido *</label><input className="ini-fi" type="date" max={hojeMaisDias(0)} value={adv.data_ocorrido} onChange={e => setAdv(a => ({ ...a, data_ocorrido: e.target.value }))} /><div style={{ fontSize: 14.5, color: advForaDoPrazo() ? "#dc2626" : "#64748b", marginTop: 3, fontWeight: 600 }}>{advForaDoPrazo() ? "⚠️ Mais de 3 dias atrás — será registrada como Exceção (com justificativa)." : "Prazo ideal: até 3 dias atrás."}</div></div>
            <div className="ini-fg">
              <label>Descrição do ocorrido * (mín. 50 caracteres)</label>
              <textarea className="ini-fi" rows={4} placeholder="Descreva o que aconteceu, com detalhes..." value={adv.descricao_ocorrido} onChange={e => setAdv(a => ({ ...a, descricao_ocorrido: e.target.value }))} />
              <div style={{ fontSize: 14.5, color: adv.descricao_ocorrido.trim().length >= 50 ? "#16a34a" : "#64748b", marginTop: 3, fontWeight: 600 }}>{adv.descricao_ocorrido.trim().length}/50 caracteres</div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div className="ini-fg"><label>Advertência verbal já foi dada para o mesmo fato?</label><select className="ini-fi" value={adv.advertencia_verbal_dada} onChange={e => setAdv(a => ({ ...a, advertencia_verbal_dada: e.target.value, tipo_advertencia: (e.target.value === "Sim" && !a.tipo_advertencia) ? "Escrita" : a.tipo_advertencia }))}><option>Não</option><option>Sim</option></select></div>
              {adv.advertencia_verbal_dada === "Sim" && (
                <div className="ini-fg"><label>Data da advertência verbal *</label><input className="ini-fi" type="date" max={hojeMaisDias(0)} value={adv.data_advertencia_verbal} onChange={e => setAdv(a => ({ ...a, data_advertencia_verbal: e.target.value }))} /></div>
              )}
            </div>

            {advBloqueada && (
              <div style={{ background: "#fef2f2", border: "1px solid #fecaca", color: "#b91c1c", borderRadius: 12, padding: "10px 14px", fontSize: 14.5, marginBottom: 14, fontWeight: 600 }}>
                Primeiro dê a advertência verbal para dar a escrita.
              </div>
            )}

            {/* Anexos opcionais (17/09/2026): foto, print, documento. Sobem
                depois que a solicitação existe (ver doSubmitAdv). */}
            <div className="ini-fg">
              <label>Anexos (opcional)</label>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
                <label style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 12px", borderRadius: 10, border: "1px dashed #cbd5e1", background: "#f8fafc", color: "#0f3171", fontSize: 14.5, fontWeight: 700, cursor: "pointer" }}>
                  📎 Escolher arquivos
                  <input type="file" multiple style={{ display: "none" }} onChange={e => {
                    const lista = Array.from(e.target.files ?? []);
                    for (const f of lista) { const err = erroDoAnexo(f); if (err) { toast(err, "err"); e.target.value = ""; return; } }
                    setAdvArquivos(a => [...a, ...lista]); e.target.value = "";
                  }} />
                </label>
                {advArquivos.map((f, i) => (
                  <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "#eef4ff", border: "1px solid #dbe4f0", borderRadius: 8, padding: "5px 9px", fontSize: 14, color: "#0f3171", fontWeight: 700 }}>
                    {f.name} <span style={{ fontWeight: 500, color: "#64748b" }}>{fmtTamanho(f.size)}</span>
                    <button onClick={() => setAdvArquivos(a => a.filter((_, j) => j !== i))} title="Remover" style={{ border: "none", background: "none", color: "#64748b", cursor: "pointer", padding: 0 }}>✕</button>
                  </span>
                ))}
                {advArquivos.length === 0 && <span style={{ fontSize: 14, color: "#64748b" }}>Fotos, prints ou documentos que ajudem o Jurídico. Até 25 MB cada.</span>}
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 8, paddingTop: 14, borderTop: "1px solid #e2e8f0" }}>
              <button onClick={() => setModalAdv(false)} style={{ padding: "7px 14px", borderRadius: 10, border: "1px solid #e2e8f0", background: "#fff", color: "#475569", fontSize: 14.5, fontWeight: 700, cursor: "pointer" }}>Cancelar</button>
              <button onClick={submitAdv} disabled={advBloqueada} style={{ padding: "7px 14px", borderRadius: 10, border: "none", background: advBloqueada ? "#cbd5e1" : "#16a34a", color: "#fff", fontSize: 14.5, fontWeight: 700, cursor: advBloqueada ? "not-allowed" : "pointer" }}>✓ Solicitar Advertência</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Card: Férias fora do prazo (saída a menos de 30 dias) ──
          Não barra mais: avisa que vai entrar como exceção e pode ser
          recusada, e a pessoa decide — Cancelar ou Solicitar mesmo assim. */}
      {feriasExc && modalFerias && (
        <div className="ini-modal-ov" style={{ zIndex: 800 }} onClick={() => setFeriasExc(false)}>
          <div className="ini-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 480, textAlign: "center", padding: "28px 26px 22px" }}>
            <div style={{ width: 56, height: 56, borderRadius: "50%", background: "#fef3c7", color: "#b45309", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 28, margin: "0 auto 14px" }}>⚠️</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: "#0f172a", marginBottom: 8 }}>Solicitação fora do prazo</div>
            <div style={{ fontSize: 14, color: "#475569", lineHeight: 1.55, marginBottom: 6 }}>
              A saída em <b>{fmtDt(ferias.data_saida)}</b> tem menos de <b>30 dias</b> de antecedência.
            </div>
            <div style={{ fontSize: 14.5, color: "#64748b", lineHeight: 1.55, marginBottom: 20 }}>
              A solicitação vai para aprovação marcada como <b>exceção</b> e <b>pode ser recusada</b>. Deseja solicitar mesmo assim?
            </div>
            <div style={{ display: "flex", justifyContent: "center", gap: 10, flexWrap: "wrap" }}>
              <button type="button" onClick={() => setFeriasExc(false)}
                style={{ padding: "9px 22px", borderRadius: 10, border: "1px solid #e2e8f0", background: "#fff", color: "#475569", fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
                Cancelar
              </button>
              <button type="button" onClick={() => doSubmitFerias(true)}
                style={{ padding: "9px 22px", borderRadius: 10, border: "none", background: "#d97706", color: "#fff", fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
                Solicitar mesmo assim
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal Confirmação de Exceção (advertência fora do prazo de 3 dias) ── */}
      {advExc.open && (
        <div className="ini-modal-ov">
          <div className="ini-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 460 }}>
            <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 4, color: "#b45309" }}>⚠️ Advertência fora do prazo</div>
            <div style={{ fontSize: 14.5, color: "#475569", marginBottom: 14, lineHeight: 1.5 }}>A advertência está sendo aplicada fora do período correto (mais de 3 dias após o ocorrido). Poderá ser aceita como <b>Exceção</b>. Justifique:</div>
            <div className="ini-fg"><label>Justificativa da exceção *</label><textarea className="ini-fi" rows={3} placeholder="Explique por que está sendo solicitada fora do prazo…" value={advExc.justificativa} onChange={e => setAdvExc(s => ({ ...s, justificativa: e.target.value }))} /></div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 8 }}>
              <button onClick={() => setAdvExc({ open: false, justificativa: "" })} style={{ padding: "7px 14px", borderRadius: 10, border: "1px solid #e2e8f0", background: "#fff", color: "#475569", fontSize: 14.5, fontWeight: 700, cursor: "pointer" }}>Cancelar</button>
              <button onClick={confirmarExcecao} style={{ padding: "7px 14px", borderRadius: 10, border: "none", background: "#d97706", color: "#fff", fontSize: 14.5, fontWeight: 700, cursor: "pointer" }}>Confirmar como Exceção</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Card: colaborador já está na fila (férias / advertência) ── */}
      {bloqueio && (
        <div className="ini-modal-ov" style={{ zIndex: 800 }} onClick={() => setBloqueio(null)}>
          <div className="ini-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 480, textAlign: "center", padding: "28px 26px 22px" }}>
            <div style={{ width: 56, height: 56, borderRadius: "50%", background: "#fee2e2", color: "#b91c1c", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 28, margin: "0 auto 14px" }}>🚫</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: "#0f172a", marginBottom: 8 }}>{TITULO_DUPLICIDADE[bloqueio.tipo]}</div>
            <div style={{ fontSize: 14, color: "#475569", lineHeight: 1.55, marginBottom: 20 }}>{bloqueio.mensagem}</div>
            <button type="button" onClick={() => setBloqueio(null)}
              style={{ padding: "9px 26px", borderRadius: 10, border: "none", background: "#0f3171", color: "#fff", fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
              OK
            </button>
          </div>
        </div>
      )}

      {/* ── Card: Substituição sem solicitação de demissão ──
          Fica por cima do modal da vaga (z maior) e exige uma escolha: OK
          (fecha, a pessoa troca o colaborador ou o motivo) ou ir solicitar a
          demissão — a vaga abre sozinha a partir dela. */}
      {avisoDemissao && modalVaga && (
        <div className="ini-modal-ov" style={{ zIndex: 800 }} onClick={() => setAvisoDemissao(false)}>
          <div className="ini-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 480, textAlign: "center", padding: "28px 26px 22px" }}>
            <div style={{ width: 56, height: 56, borderRadius: "50%", background: "#fef3c7", color: "#b45309", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 28, margin: "0 auto 14px" }}>⚠️</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: "#0f172a", marginBottom: 8 }}>Falta a solicitação de demissão</div>
            <div style={{ fontSize: 14, color: "#475569", lineHeight: 1.55, marginBottom: 6 }}>
              <b>{vaga.nome_substituido || "Este colaborador"}</b> ainda não tem solicitação de demissão em andamento.
            </div>
            <div style={{ fontSize: 14.5, color: "#64748b", lineHeight: 1.55, marginBottom: 20 }}>
              Vaga de <b>Substituição</b> é aberta a partir da demissão de quem sai. Solicite a demissão primeiro — ao enviar, a vaga abre sozinha, já preenchida.
            </div>
            <div style={{ display: "flex", justifyContent: "center", gap: 10, flexWrap: "wrap" }}>
              <button type="button" onClick={() => setAvisoDemissao(false)}
                style={{ padding: "9px 22px", borderRadius: 10, border: "1px solid #e2e8f0", background: "#fff", color: "#475569", fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
                OK
              </button>
              <button type="button" onClick={irSolicitarDemissao}
                style={{ padding: "9px 22px", borderRadius: 10, border: "none", background: "#0f3171", color: "#fff", fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
                Solicitar demissão desse colaborador →
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toasts */}
      <div style={{ position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)", zIndex: 9999, pointerEvents: "none", display: "flex", flexDirection: "column", gap: 6, alignItems: "center" }}>
        {toasts.map(t => (
          <div key={t.id} style={{
            padding: "10px 18px", borderRadius: 9, fontSize: 14, fontWeight: 600, boxShadow: "0 16px 40px rgba(15,23,42,.1)",
            background: t.type === "ok" ? "#ecfdf3" : t.type === "err" ? "#fef2f2" : "#eff6ff",
            color: t.type === "ok" ? "#15803d" : t.type === "err" ? "#b91c1c" : "#1d4ed8",
            border: `1px solid ${t.type === "ok" ? "#86efac" : t.type === "err" ? "#fecaca" : "#bfdbfe"}`,
          }}>{t.msg}</div>
        ))}
      </div>
    </div>
  );
}
