import type { LucideIcon } from "lucide-react";
import { CheckCircle2, CircleX, Clock3, Hourglass } from "lucide-react";

export type StatusHoraExtra = "aguardando_liberacao" | "aprovada" | "aguardando_validacao" | "concluida" | "reprovada";
export type TipoHoraExtra = "normal" | "emergencial";
export type PrioridadeHoraExtra = "alta" | "media" | "baixa";
export type StatusExecucao = "concluido" | "parcial" | "nao_iniciado";

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
  he_inicio_previsto: string;
  he_fim_previsto: string;
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
