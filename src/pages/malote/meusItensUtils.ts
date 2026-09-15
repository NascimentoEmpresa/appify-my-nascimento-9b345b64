import {
  ItemLinhaMalote,
  MaloteDespesaRow,
  STATUS_FASE_SOLICITACAO,
  STATUS_LABEL,
  StatusDespesa,
} from "@/hooks/useMaloteDespesa";

export const ORIGEM_LABEL: Record<string, string> = {
  solicitacao: "Solicitação",
  despesa_unica: "Despesa",
  despesa_multi_classificacao: "Rateio de Classificação",
};

export const CABECALHOS_EXCEL_MEUS_ITENS = [
  "Tipo",
  "Nº / ID",
  "Parcela",
  "Data de pagamento",
  "Classificação",
  "Nome da despesa",
  "Empresa",
  "Forma de pagamento",
  "Valor (R$)",
  "Status",
  "Aprovador pendente",
  "Exceção",
  "Justificativa da exceção",
  "Última atualização",
];

// SIS-2026-0223: despesa parcelada vira N linhas (1 por parcela) a partir de
// "aguardando_pagamento" — pros chips/status de pagamento, o que conta é o
// status da PARCELA (paga/pendente), não o bruto da despesa, senão as N
// linhas cairiam sempre no mesmo chip (todas "aguardando" até a despesa
// inteira ficar paga na última parcela).
export function statusEfetivo(item: ItemLinhaMalote): StatusDespesa {
  // pronto_para_pagar/ajuste_pagamento continuam sendo decisão sobre a
  // despesa inteira (parcela só tem pendente/paga) — só aguardando_pagamento
  // e despesa_paga refletem o progresso real de CADA parcela.
  if (item.parcela && (item.despesa.status === "aguardando_pagamento" || item.despesa.status === "despesa_paga")) {
    return item.parcela.status === "paga" ? "despesa_paga" : "aguardando_pagamento";
  }
  return item.despesa.status;
}

export function dataPagamentoDe(item: ItemLinhaMalote): string | null {
  const { despesa, parcela } = item;
  return parcela ? parcela.data_pagamento_real ?? parcela.data_vencimento : despesa.data_pagamento;
}

export function valorDe(item: ItemLinhaMalote): number {
  return Number(item.parcela ? item.parcela.valor : item.despesa.valor_total);
}

// `origem` não muda depois que a Solicitação vira Despesa (fica "solicitacao"
// pra sempre) — quem decide se ainda é Solicitação é o status atual, mesma
// lógica de Aprovacoes.tsx: a partir de cotacao_aprovada em diante já é
// Despesa (Tipo e agrupamento das abas Solicitações/Despesas do Malote).
export function aindaESolicitacao(despesa: MaloteDespesaRow): boolean {
  return despesa.origem === "solicitacao" && STATUS_FASE_SOLICITACAO.includes(despesa.status);
}

export function tipoLabelDe(despesa: MaloteDespesaRow): string {
  if (despesa.origem === "solicitacao") return aindaESolicitacao(despesa) ? "Solicitação" : "Despesa";
  return ORIGEM_LABEL[despesa.origem] ?? despesa.origem;
}

// SIS-2026-0236: nível pode ter mais de um aprovador — mostra o primeiro
// + indicador "+N" (mesmo padrão de ClassificacoesMalote.tsx/OrcamentoGeral.tsx).
// A lista completa vai no tooltip do <AprovadorPendenteCell> abaixo — achado
// do usuário: em "Meus Itens" só dava pra ver o primeiro nome (ex. "Yuri Rosa"),
// sem jeito de saber os demais aprovadores daquele nível.
export function aprovadoresPendentes(despesa: MaloteDespesaRow): string[] | null {
  if (despesa.status !== "pendente_aprovacao" || !despesa.nivel_aprovacao_atual) return null;
  const c = despesa.classificacao;
  if (!c) return null;
  const nomes =
    despesa.nivel_aprovacao_atual === 1 ? c.aprovador1_nomes : despesa.nivel_aprovacao_atual === 2 ? c.aprovador2_nomes : c.aprovador3_nomes;
  return nomes && nomes.length > 0 ? nomes : null;
}

function formatarData(data: string | null | undefined): string {
  if (!data) return "";
  const [ano, mes, dia] = data.slice(0, 10).split("-");
  return ano && mes && dia ? `${dia}/${mes}/${ano}` : "";
}

function formatarDataHora(data: string | null | undefined): string {
  if (!data) return "";
  const valor = new Date(data);
  if (Number.isNaN(valor.getTime())) return "";
  const preencher = (numero: number) => String(numero).padStart(2, "0");
  return `${preencher(valor.getDate())}/${preencher(valor.getMonth() + 1)}/${valor.getFullYear()} ${preencher(valor.getHours())}:${preencher(valor.getMinutes())}`;
}

export function montarLinhasExcelMeusItens(
  itens: ItemLinhaMalote[],
  nomeEmpresaDe: (despesa: MaloteDespesaRow) => string,
): Record<string, string | number>[] {
  return itens.map((item) => {
    const { despesa, parcela } = item;
    const status = statusEfetivo(item);
    const nivel = status === "pendente_aprovacao" && despesa.nivel_aprovacao_atual ? ` N${despesa.nivel_aprovacao_atual}` : "";
    return {
      "Tipo": tipoLabelDe(despesa),
      "Nº / ID": despesa.numero ?? "",
      "Parcela": parcela ? `${parcela.numero_parcela}/${despesa.numero_parcelas}` : "",
      "Data de pagamento": formatarData(dataPagamentoDe(item)),
      "Classificação": despesa.classificacao?.nome ?? "",
      "Nome da despesa": despesa.nome ?? "",
      "Empresa": nomeEmpresaDe(despesa) ?? "",
      "Forma de pagamento": despesa.forma_pagamento ?? "",
      "Valor (R$)": valorDe(item),
      "Status": `${STATUS_LABEL[status]}${nivel}`,
      "Aprovador pendente": aprovadoresPendentes(despesa)?.join(", ") ?? "",
      "Exceção": despesa.excecao ? "Sim" : "Não",
      "Justificativa da exceção": despesa.justificativa_excecao ?? "",
      "Última atualização": formatarDataHora(despesa.updated_at),
    };
  });
}

export function nomeArquivoMeusItens(escopo: "filtrado" | "completo", data = new Date()): string {
  const preencher = (numero: number) => String(numero).padStart(2, "0");
  return `meus-itens-malote-${escopo}-${data.getFullYear()}-${preencher(data.getMonth() + 1)}-${preencher(data.getDate())}.xlsx`;
}
