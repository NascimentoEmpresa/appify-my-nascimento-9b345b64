// =====================================================================
// SST › ASO de Retorno ao Trabalho — a fila do exame (src/pages/sst/AsoRetorno.tsx).
// Com teste em src/test/sst-aso-retorno.test.ts.
//
// 15/11/2026 (SIS-2026-0852, mig 20261115210000): o ASO de retorno NÃO tem
// tabela própria. Ele é registrado no caso do Controle de Afastamentos
// (SST_CTRL_AFASTAMENTO.aso_*) e esta tela é a fila do exame sobre os mesmos
// casos — o que se salva aqui aparece lá, e vice-versa. A mesma régua de
// status roda no banco (sst_aso_ret_status); esta cópia serve ao painel e
// aos filtros.
// =====================================================================

/** A partir de quantos dias de afastamento o caso entra na fila sozinho. */
export const DIAS_EXIGE_ASO = 30;

export type StatusAsoRetorno = "A solicitar" | "Aguardando agendamento" | "Agendado" | "Realizado/recebido";

/** Ordem da tela: o que pede ação primeiro. */
export const STATUS_RETORNO: StatusAsoRetorno[] = ["A solicitar", "Aguardando agendamento", "Agendado", "Realizado/recebido"];

export interface DocAsoRetorno {
  id: number;
  nome: string;
  storage_path: string;
  enviado_por: string | null;
  created_at: string;
}

export interface ItemAsoRetorno {
  /** Id do caso no Controle de Afastamentos. */
  id: number;
  nome: string;
  contrato_nome: string | null;
  filial_nome: string | null;
  funcao: string | null;
  motivo: string;
  data_inicio: string;
  data_prevista_retorno: string | null;
  data_retorno_real: string | null;
  status_afastamento: string;
  senior_situacao: string | null;
  aso_necessario: boolean;
  aso_solicitado_em: string | null;
  aso_agendado_em: string | null;
  aso_clinica: string | null;
  aso_realizado: boolean;
  aso_recebido_em: string | null;
  aso_resultado: "apto" | "inapto" | null;
  dias_afastado: number | null;
  /** Caso aberto com 30+ dias: está na fila mesmo sem o ASO ligado no Controle. */
  exige_por_prazo: boolean;
  status: StatusAsoRetorno;
  documentos: DocAsoRetorno[];
  updated_at: string;
}

type CamposAso = Pick<ItemAsoRetorno, "aso_realizado" | "aso_resultado" | "aso_agendado_em" | "aso_solicitado_em">;

export function statusAsoRetorno(a: CamposAso): StatusAsoRetorno {
  if (a.aso_realizado && a.aso_resultado) return "Realizado/recebido";
  if (a.aso_agendado_em) return "Agendado";
  if (a.aso_solicitado_em) return "Aguardando agendamento";
  return "A solicitar";
}

export type ChavePainelRetorno = "pendentes" | "solicitar" | "aguardando" | "agendados" | "realizados" | "inaptos";

export const PAINEL_RETORNO: { chave: ChavePainelRetorno; titulo: string; filtro: (i: ItemAsoRetorno) => boolean }[] = [
  { chave: "pendentes", titulo: "ASOs de retorno pendentes", filtro: (i) => i.status !== "Realizado/recebido" },
  { chave: "solicitar", titulo: "A solicitar", filtro: (i) => i.status === "A solicitar" },
  { chave: "aguardando", titulo: "Aguardando agendamento", filtro: (i) => i.status === "Aguardando agendamento" },
  { chave: "agendados", titulo: "Agendados", filtro: (i) => i.status === "Agendado" },
  { chave: "realizados", titulo: "Realizados/recebidos", filtro: (i) => i.status === "Realizado/recebido" },
  { chave: "inaptos", titulo: "Inaptos", filtro: (i) => i.status === "Realizado/recebido" && i.aso_resultado === "inapto" },
];

export function contarPainelRetorno(itens: ItemAsoRetorno[]): Record<ChavePainelRetorno, number> {
  const r = { pendentes: 0, solicitar: 0, aguardando: 0, agendados: 0, realizados: 0, inaptos: 0 } as Record<ChavePainelRetorno, number>;
  for (const i of itens) for (const p of PAINEL_RETORNO) if (p.filtro(i)) r[p.chave]++;
  return r;
}

/** Contrato para filtro e exibição: o do caso, senão a filial da Senior. */
export const contratoDoRetorno = (i: Pick<ItemAsoRetorno, "contrato_nome" | "filial_nome">): string =>
  i.contrato_nome || i.filial_nome || "Sem contrato";

/** A Senior já mostra a pessoa trabalhando e o ASO de retorno não foi concluído. */
export const voltouSemAso = (i: Pick<ItemAsoRetorno, "senior_situacao" | "status">): boolean =>
  i.status !== "Realizado/recebido" && (i.senior_situacao ?? "").trim().toLowerCase() === "trabalhando";

/** Ordem da lista: status (ação primeiro); dentro dele, quem volta antes. */
export function ordenarRetorno(a: ItemAsoRetorno, b: ItemAsoRetorno): number {
  const data = (i: ItemAsoRetorno) => i.aso_agendado_em ?? i.data_prevista_retorno ?? "9999-12-31";
  return STATUS_RETORNO.indexOf(a.status) - STATUS_RETORNO.indexOf(b.status)
    || (a.status === "Realizado/recebido"
      ? String(b.aso_recebido_em ?? "").localeCompare(String(a.aso_recebido_em ?? ""))
      : data(a).localeCompare(data(b)))
    || a.nome.localeCompare(b.nome);
}

/** O que impede salvar, na ordem do formulário (vazio = pode salvar). */
export function pendenciasDoRetorno(c: {
  aso_solicitado_em?: string | null; aso_agendado_em?: string | null; aso_realizado?: boolean;
  aso_recebido_em?: string | null; aso_resultado?: string | null;
}, hoje: string): string[] {
  const f: string[] = [];
  if (c.aso_solicitado_em && c.aso_solicitado_em > hoje) f.push("data da solicitação não pode ser futura");
  if (c.aso_solicitado_em && c.aso_agendado_em && c.aso_agendado_em < c.aso_solicitado_em) f.push("agendamento não pode ser antes da solicitação");
  if (c.aso_recebido_em && c.aso_recebido_em > hoje) f.push("data da realização não pode ser futura");
  if (c.aso_realizado) {
    if (!c.aso_recebido_em) f.push("data da realização");
    if (!c.aso_resultado) f.push("resultado (apto ou inapto)");
  }
  return f;
}
