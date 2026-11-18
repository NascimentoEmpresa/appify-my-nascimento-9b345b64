// SIS-2026-0888: controle de calçados ortopédicos (SST + Compras).
// As regras de status são cópia das funções SQL sst_calcado_* da migration
// 20261118200000 — o banco é quem decide; aqui elas existem para a tela e
// para os testes. Mudou lá, muda aqui.

export const STATUS_CALCADO = {
  solicitado: "Solicitado",
  em_analise: "Em análise",
  em_compra: "Em compra",
  enviado: "Enviado",
  entregue: "Entregue",
  finalizado: "Finalizado",
  cancelado: "Cancelado",
} as const;
export type StatusCalcado = keyof typeof STATUS_CALCADO;

export const ESTILO_STATUS_CALCADO: Record<StatusCalcado, string> = {
  solicitado: "border-sky-300 bg-sky-50 text-sky-800 dark:bg-sky-950/30 dark:text-sky-200",
  em_analise: "border-violet-300 bg-violet-50 text-violet-800 dark:bg-violet-950/30 dark:text-violet-200",
  em_compra: "border-amber-300 bg-amber-50 text-amber-800 dark:bg-amber-950/30 dark:text-amber-200",
  enviado: "border-blue-300 bg-blue-50 text-blue-800 dark:bg-blue-950/30 dark:text-blue-200",
  entregue: "border-emerald-300 bg-emerald-50 text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200",
  finalizado: "border-slate-300 bg-slate-100 text-slate-700 dark:bg-slate-800/40 dark:text-slate-200",
  cancelado: "border-red-300 bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-200",
};

/** Em aberto = ainda tem coisa a acontecer; Finalizado e Cancelado saíram da fila. */
export const STATUS_ABERTOS: StatusCalcado[] = ["solicitado", "em_analise", "em_compra", "enviado", "entregue"];

/** Dias sem movimentação a partir dos quais a linha aparece destacada. */
export const DIAS_PARADO = 7;

export interface CalcadoOrtopedico {
  id: number;
  pedido_id: string | null;
  pedido_codigo: string | null;
  pedido_status: string | null;
  colaborador_nome: string | null;
  contrato_nome: string | null;
  encarregado_nome: string | null;
  item_nome: string;
  tamanho: string | null;
  quantidade: number | null;
  data_solicitacao: string;
  status: StatusCalcado;
  observacoes: string | null;
  laudo_nome: string | null;
  laudo_path: string | null;
  updated_at: string;
}

const ORDEM: Record<StatusCalcado, number> = {
  solicitado: 1, em_analise: 2, em_compra: 3, enviado: 4, entregue: 5, finalizado: 6, cancelado: 0,
};

/** sst_calcado_status_do_pedido: o que o status do pedido no Compras sugere. */
export function statusSugeridoPeloPedido(statusPedido: string | null | undefined): StatusCalcado | null {
  switch (statusPedido) {
    case "AGUARDANDO COMPRA": return "em_compra";
    case "RETIRADO PARA ENTREGA":
    case "DESPACHADO": return "enviado";
    case "CANCELADO": return "cancelado";
    default: return null;
  }
}

/** sst_calcado_proximo_status: só para frente, e nunca depois que o SST fechou. */
export function proximoStatus(atual: StatusCalcado, sugerido: StatusCalcado | null): StatusCalcado {
  if (!sugerido || atual === "entregue" || atual === "finalizado" || atual === "cancelado") return atual;
  if (sugerido === "cancelado") return "cancelado";
  return ORDEM[sugerido] > ORDEM[atual] ? sugerido : atual;
}

/** Finalizado exige laudo — mesma trava do sst_calcado_salvar. */
export const exigeLaudo = (status: StatusCalcado) => status === "finalizado";

const DIA_MS = 86_400_000;
export function diasSemMovimentacao(updatedAt: string, agora: Date = new Date()): number {
  const t = new Date(updatedAt).getTime();
  if (!Number.isFinite(t)) return 0;
  return Math.max(0, Math.floor((agora.getTime() - t) / DIA_MS));
}

export function estaParado(c: Pick<CalcadoOrtopedico, "status" | "updated_at">, agora: Date = new Date(), limite = DIAS_PARADO): boolean {
  return STATUS_ABERTOS.includes(c.status) && c.status !== "entregue" && diasSemMovimentacao(c.updated_at, agora) >= limite;
}

export interface FiltrosCalcado {
  busca: string;
  contrato: string;
  status: "abertos" | "todos" | StatusCalcado;
  laudo: "todos" | "com" | "sem";
  parados: boolean;
}
export const FILTROS_CALCADO: FiltrosCalcado = { busca: "", contrato: "todos", status: "abertos", laudo: "todos", parados: false };

const normalizar = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLocaleLowerCase("pt-BR");

export function filtrarCalcados(lista: CalcadoOrtopedico[], f: FiltrosCalcado, agora: Date = new Date()): CalcadoOrtopedico[] {
  const busca = normalizar(f.busca.trim());
  return lista.filter((c) =>
    (!busca || [c.colaborador_nome, c.encarregado_nome, c.pedido_codigo, c.item_nome]
      .some((v) => normalizar(v ?? "").includes(busca))) &&
    (f.contrato === "todos" || c.contrato_nome === f.contrato) &&
    (f.status === "todos" || (f.status === "abertos" ? STATUS_ABERTOS.includes(c.status) : c.status === f.status)) &&
    (f.laudo === "todos" || !!c.laudo_path === (f.laudo === "com")) &&
    (!f.parados || estaParado(c, agora)));
}

/** Contagem por status para os cartões do topo. */
export function contarPorStatus(lista: CalcadoOrtopedico[]): Record<StatusCalcado, number> {
  const base = Object.fromEntries(Object.keys(STATUS_CALCADO).map((s) => [s, 0])) as Record<StatusCalcado, number>;
  for (const c of lista) base[c.status] += 1;
  return base;
}

export const dataBr = (iso: string) => iso.slice(0, 10).split("-").reverse().join("/");
