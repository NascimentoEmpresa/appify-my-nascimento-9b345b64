import type { PlanoAcaoRow } from "@/hooks/usePlanoAcoes";
import {
  PRIORIDADE_LABEL,
  STATUS_LABELS,
  TIPO_ACAO_LABEL,
  type TipoAcao,
} from "@/types/planoAcao";

// Mesmo padrão de meusItensUtils.ts (Malote › Meus Itens): a montagem das
// linhas fica fora do componente pra ser testável sem render, e a ordem
// desta lista é a ordem das colunas na planilha (json_to_sheet respeita a
// ordem de inserção das chaves do primeiro objeto).
export const CABECALHOS_EXCEL_PLANO_ACOES = [
  "ID",
  "Empresa",
  "Comitê",
  "Setor",
  "Tipo",
  "Título",
  "Problema",
  "Ação",
  "Responsável",
  "Líder do comitê",
  "Líder do setor",
  "Prioridade",
  "Status",
  "Status (origem)",
  "Início planejado",
  "Fim planejado",
  "Início real",
  "Fim real",
  "Custo previsto (R$)",
  "Custo realizado (R$)",
  "Pendências",
  "Comentários",
  "Criada em",
  "Última atualização",
];

// Larguras (wch) na mesma ordem dos cabeçalhos acima.
export const LARGURAS_EXCEL_PLANO_ACOES = [
  14, 14, 22, 22, 10, 44, 44, 44, 26, 26, 26, 14, 26, 20, 16, 16, 16, 16, 18, 18, 30, 40, 16, 20,
];

function formatarData(data: string | null | undefined): string {
  if (!data) return "";
  // Datas de origem chegam tanto como "AAAA-MM-DD" quanto como texto livre
  // da importação (o campo *_original é string crua da planilha antiga) —
  // o que não casa com ISO volta como veio, sem virar "Invalid Date".
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(data);
  return iso ? `${iso[3]}/${iso[2]}/${iso[1]}` : data;
}

function formatarDataHora(data: string | null | undefined): string {
  if (!data) return "";
  const valor = new Date(data);
  if (Number.isNaN(valor.getTime())) return "";
  const preencher = (numero: number) => String(numero).padStart(2, "0");
  return `${preencher(valor.getDate())}/${preencher(valor.getMonth() + 1)}/${valor.getFullYear()} ${preencher(valor.getHours())}:${preencher(valor.getMinutes())}`;
}

// Mesmos três badges da coluna "Pend." da Lista, por extenso.
export function pendenciasDe(row: PlanoAcaoRow): string {
  const pendencias: string[] = [];
  if (row.pendencia_responsavel) pendencias.push("Sem responsável");
  if (row.pendencia_datas) pendencias.push("Sem datas planejadas");
  if (row.pendencia_evidencia) pendencias.push("Concluída sem evidência");
  return pendencias.join(", ");
}

export function montarLinhasExcelPlanoAcoes(
  rows: PlanoAcaoRow[],
  empresaLabelById: Record<string, string>,
): Record<string, string | number>[] {
  return rows.map((row) => ({
    "ID": row.id_importacao ?? row.id.slice(0, 8),
    "Empresa": empresaLabelById[row.empresa_id] ?? "",
    "Comitê": row.comite ?? "",
    "Setor": row.area ?? row.setor ?? "",
    "Tipo": TIPO_ACAO_LABEL[row.tipo_acao as TipoAcao] ?? row.tipo_acao ?? "",
    "Título": row.titulo ?? "",
    "Problema": row.problema ?? "",
    "Ação": row.acao ?? "",
    "Responsável": row.responsavel_nome_origem ?? "",
    "Líder do comitê": row.lider_comite_nome_origem ?? "",
    "Líder do setor": row.lider_setor_nome_origem ?? "",
    "Prioridade": row.prioridade_normalizada
      ? PRIORIDADE_LABEL[row.prioridade_normalizada] ?? row.prioridade_normalizada
      : "",
    "Status": STATUS_LABELS[row.status_normalizado] ?? row.status_normalizado,
    "Status (origem)": row.status_original ?? "",
    "Início planejado": formatarData(row.data_inicio_planejado_original),
    "Fim planejado": formatarData(row.data_fim_planejado_original),
    "Início real": formatarData(row.data_inicio_real_original),
    "Fim real": formatarData(row.data_fim_real_original),
    "Custo previsto (R$)": Number(row.custo_previsto ?? 0),
    "Custo realizado (R$)": Number(row.custo_realizado ?? 0),
    "Pendências": pendenciasDe(row),
    "Comentários": row.comentarios ?? "",
    "Criada em": formatarDataHora(row.created_at),
    "Última atualização": formatarDataHora(row.updated_at),
  }));
}

export function nomeArquivoPlanoAcoes(escopo: "filtrado" | "completo", data = new Date()): string {
  const preencher = (numero: number) => String(numero).padStart(2, "0");
  return `plano-de-acoes-${escopo}-${data.getFullYear()}-${preencher(data.getMonth() + 1)}-${preencher(data.getDate())}.xlsx`;
}
