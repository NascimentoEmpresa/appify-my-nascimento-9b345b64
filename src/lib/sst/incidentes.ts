export const STATUS_INCIDENTE = {
  elaboracao: "Relatório em elaboração",
  aguardando_assinatura: "Aguardando assinatura",
  recebido: "Relatório recebido",
  finalizado: "Finalizado",
} as const;
export type StatusIncidente = keyof typeof STATUS_INCIDENTE;

export interface Incidente {
  id: number;
  empregado_id: number | null;
  nome: string;
  contrato_id: string | null;
  contrato_nome: string | null;
  encarregado: string | null;
  data_incidente: string;
  dias_afastamento: number | null;
  numero_relatorio: string | null;
  status: StatusIncidente;
  observacoes: string | null;
  arquivo_nome: string | null;
  arquivo_path: string | null;
  created_at: string;
}

export interface FiltrosIncidente {
  de: string; ate: string; contrato: string; colaborador: string; encarregado: string;
  afastamento: "todos" | "sim" | "nao"; status: "todos" | StatusIncidente;
}
export const FILTROS_INCIDENTE: FiltrosIncidente = {
  de: "", ate: "", contrato: "todos", colaborador: "", encarregado: "",
  afastamento: "todos", status: "todos",
};
const normalizar = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR");

export function filtrarIncidentes(lista: Incidente[], f: FiltrosIncidente): Incidente[] {
  return lista.filter((i) =>
    (!f.de || i.data_incidente >= f.de) && (!f.ate || i.data_incidente <= f.ate) &&
    (f.contrato === "todos" || i.contrato_id === f.contrato) &&
    (!f.colaborador || normalizar(i.nome).includes(normalizar(f.colaborador))) &&
    (!f.encarregado || normalizar(i.encarregado ?? "").includes(normalizar(f.encarregado))) &&
    (f.afastamento === "todos" || (i.dias_afastamento != null && i.dias_afastamento > 0) === (f.afastamento === "sim")) &&
    (f.status === "todos" || i.status === f.status));
}

export const dataBr = (iso: string) => iso.slice(0, 10).split("-").reverse().join("/");
