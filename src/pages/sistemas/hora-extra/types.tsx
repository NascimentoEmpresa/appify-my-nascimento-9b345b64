import type { LucideIcon } from "lucide-react";
import { CheckCircle2, CircleX, Clock3, Hourglass } from "lucide-react";

export type StatusHoraExtra = "aguardando_liberacao" | "aprovada" | "aguardando_validacao" | "concluida" | "reprovada";
export type TipoHoraExtra = "normal" | "emergencial";
export type PrioridadeHoraExtra = "alta" | "media" | "baixa";
export type StatusExecucao = "concluido" | "parcial" | "nao_iniciado";

/** Os quatro registros de ponto do dia, na ordem em que são batidos. */
export interface PontoDia {
  entrada: string;
  saida_intervalo: string;
  retorno_intervalo: string;
  saida: string;
}

export interface EscalaHoraExtra extends PontoDia {
  id: string;
  nome: string;
  minutos_jornada: number;
  padrao: boolean;
  ativo: boolean;
  /** Quando marcada, a jornada desta escala pode ser ignorada aos sábados e domingos. */
  nao_aplicavel_fins_semana: boolean;
}

export interface ChamadoHoraExtra {
  id: string;
  solicitacao_id?: string;
  chamado_id: string;
  chamado_numero: string;
  chamado_assunto: string;
  chamado_setor?: string | null;
  prioridade: PrioridadeHoraExtra;
  adicional: boolean;
  percentual_previsto: number | null;
  percentual_concluido: number | null;
  status_execucao: StatusExecucao | null;
  observacao?: string | null;
  pr_numero?: number | null;
  pr_url?: string | null;
  pr_titulo?: string | null;
  pr_linhas_adicionadas?: number | null;
  pr_commits?: number | null;
  pr_arquivos_adicionados?: number | null;
}

export interface AnexoHoraExtra {
  id: string;
  solicitacao_id: string;
  fase: "solicitacao" | "conclusao";
  storage_path: string;
  nome_arquivo: string;
  mime_type?: string | null;
  tamanho_bytes?: number | null;
}

export interface SolicitacaoHoraExtra {
  id: string;
  numero: string;
  colaborador_id: string;
  colaborador_nome: string;
  colaborador_cargo?: string | null;
  setor?: string | null;
  empresa?: string | null;
  criado_por: string;
  data_he: string;
  tipo: TipoHoraExtra;
  ponto_entrada: string;
  ponto_saida_intervalo: string;
  ponto_retorno_intervalo: string;
  ponto_saida: string;
  escala_id?: string | null;
  escala_nome?: string | null;
  jornada_minutos?: number | null;
  /** No fim de semana elegível, define se a jornada da escala foi aplicada. */
  seguir_escala?: boolean | null;
  /** Sem intervalo, os dois registros intermediários representam a entrada. */
  sem_intervalo?: boolean | null;
  trabalhado_previsto_min?: number | null;
  trabalhado_real_min?: number | null;
  he_inicio_previsto: string;
  he_fim_previsto: string;
  /** Minutos de hora extra: o que passou da jornada da escala. */
  total_previsto_min: number;
  justificativa: string;
  status: StatusHoraExtra;
  motivo_reprovacao?: string | null;
  ponto_entrada_real?: string | null;
  ponto_saida_intervalo_real?: string | null;
  ponto_retorno_intervalo_real?: string | null;
  ponto_saida_real?: string | null;
  he_inicio_real?: string | null;
  he_fim_real?: string | null;
  total_real_min?: number | null;
  resumo_conclusao?: string | null;
  motivo_devolucao?: string | null;
  created_at: string;
  updated_at: string;
  chamados?: ChamadoHoraExtra[];
  anexos?: AnexoHoraExtra[];
}

export interface ColaboradorHoraExtra {
  id: string;
  nome: string;
  cargo?: string | null;
  setor?: string | null;
  empresa?: string | null;
}

export interface ChamadoDisponivel {
  id: string;
  numero: string;
  assunto: string;
  prioridade: PrioridadeHoraExtra;
  setor?: string | null;
  responsavel_id?: string | null;
  responsavel_nome?: string | null;
}

export interface StatsHoraExtra {
  total: number;
  aguardando_liberacao: number;
  aguardando_validacao: number;
  aprovadas: number;
  liberadas: number;
  pendentes_conclusao: number;
  concluidas: number;
  reprovadas: number;
  total_minutos: number;
  media_minutos: number;
  horas_aprovadas_min: number;
  variacao: number;
}

export interface AparenciaBadge {
  label: string;
  classe: string;
  Icone: LucideIcon;
}

export const LABEL_TIPO: Record<TipoHoraExtra, string> = { normal: "Normal", emergencial: "Emergencial" };
export const LABEL_PRIORIDADE: Record<PrioridadeHoraExtra, string> = { alta: "Alta", media: "Média", baixa: "Baixa" };
export const CLASSE_PRIORIDADE: Record<PrioridadeHoraExtra, string> = {
  alta: "border-red-200 bg-red-50 text-red-700",
  media: "border-amber-200 bg-amber-50 text-amber-700",
  baixa: "border-emerald-200 bg-emerald-50 text-emerald-700",
};
export const STATUS_EXECUCAO: Record<StatusExecucao, AparenciaBadge> = {
  concluido: { label: "Concluído", classe: "bg-emerald-100 text-emerald-700", Icone: CheckCircle2 },
  parcial: { label: "Parcial", classe: "bg-amber-100 text-amber-700", Icone: Clock3 },
  nao_iniciado: { label: "Não iniciado", classe: "bg-red-100 text-red-700", Icone: CircleX },
};
export const ICONES_STATUS = { CheckCircle2, CircleX, Clock3, Hourglass };

// ---------------------------------------------------------------------
// Dashboard de HE (SIS-2026-0474) — o que a RPC `hora_extra_dashboard`
// devolve. Tudo em minutos: a formatação é da tela, não do banco.
// ---------------------------------------------------------------------

export interface IndicadoresDashboardHoraExtra {
  aprovadas_min: number;
  aprovadas_variacao: number;
  realizadas_min: number;
  realizadas_variacao: number;
  pendentes_conclusao: number;
  pendentes_variacao: number;
  custo_estimado: number;
  custo_variacao: number;
  colaboradores: number;
  colaboradores_variacao: number;
  chamados: number;
  chamados_variacao: number;
}

export interface VolumeColaboradorHoraExtra {
  id: string;
  nome: string;
  minutos: number;
}

export interface MesDashboardHoraExtra {
  /** `AAAA-MM`. */
  mes: string;
  previsto_min: number;
  realizado_min: number;
}

export interface MotivoDashboardHoraExtra {
  /** `tipo_solicitacao` do chamado trabalhado. */
  motivo: string;
  minutos: number;
}

export interface DiaSemanaDashboardHoraExtra {
  /** `isodow`: 1 = segunda ... 7 = domingo. */
  dia: number;
  minutos: number;
}

export interface StatusDashboardHoraExtra {
  aprovadas_min: number;
  concluidas_min: number;
  pendentes_min: number;
  total_min: number;
}

export interface ColaboradorDashboardHoraExtra {
  id: string;
  nome: string;
  qtd: number;
  aprovadas_min: number;
  realizadas_min: number;
  chamados: number;
  conclusao_media: number;
}

export interface OpcoesDashboardHoraExtra {
  empresas: string[];
  setores: string[];
  colaboradores: Array<{ id: string; nome: string }>;
}

export interface DadosDashboardHoraExtra {
  /** 0 enquanto o RH não define o valor-hora em `HORA_EXTRA_PARAMETRO`. */
  valor_hora: number;
  indicadores: IndicadoresDashboardHoraExtra;
  por_colaborador: VolumeColaboradorHoraExtra[];
  evolucao: MesDashboardHoraExtra[];
  por_motivo: MotivoDashboardHoraExtra[];
  por_dia_semana: DiaSemanaDashboardHoraExtra[];
  status: StatusDashboardHoraExtra;
  efetividade: ColaboradorDashboardHoraExtra[];
  opcoes: OpcoesDashboardHoraExtra;
}

export interface FiltrosDashboardHoraExtra {
  inicio: string;
  fim: string;
  empresa: string;
  setor: string;
  colaborador: string;
  /** Tamanho da série de "Evolução"/"Previsto x Realizado", em meses. */
  meses: number;
}

export interface NivelEfetividade {
  label: string;
  classe: string;
}

export interface InsightDashboardHoraExtra {
  chave: "volume" | "efetividade" | "dia";
  titulo: string;
  destaque: string;
  detalhe: string;
}
