/**
 * Aba Cancelamentos do Dashboard de Compras (SIS-2026-0945).
 *
 * Lógica pura sobre o retorno de `sup_dashboard_cancelamentos_painel`. A regra
 * de "cancelado" mora no banco (`sup_cancelamentos_base`) e é a MESMA do cartão
 * "Cancelados" da aba Solicitações — aqui só se normaliza e se formata.
 *
 * Três escopos que a tela precisa dizer em voz alta, porque cada um já foi
 * lido errado em algum painel deste dashboard:
 *   • data do cancelamento = aprovação do Suprimentos; nos registros antigos
 *     (antes do SIS-2026-0948), o último CANCELADO do histórico;
 *   • valor = quantidade × preço de referência ATUAL do estoque, não dinheiro
 *     gasto;
 *   • "novo pedido para a vaga" é provável, não certo: mesmo contrato + posto +
 *     função, até 45 dias depois. O cartão conta só desistência e desligamento
 *     com motivo padronizado; os antigos aparecem só na tabela.
 */
import { formatarNumero } from "@/lib/suprimentos/dashboardComprasEstoque";

export type SituacaoCancelamento = "AGUARDANDO_COMPRA" | "ANTES_DESPACHO" | "APOS_DESPACHO" | "NAO_INFORMADO";

export interface ResumoCancelamentos {
  total: number;
  estruturados: number;
  legados: number;
  valor: number;
  unidades: number;
  unidades_sem_preco: number;
  pedidos_no_periodo: number;
  aguardando_decisao: number;
  recusados: number;
  vagas_com_reposicao: number;
  valor_reposicao: number;
}

export interface MesCancelamentos {
  mes: string;
  cancelados: number;
  pedidos_criados: number;
  valor: number;
}

export interface MotivoCancelamentos {
  categoria: string;
  nome: string;
  quantidade: number;
  valor: number;
}

export interface LinhaCancelamento {
  id: string;
  empresa_id: string;
  pedido_id: string;
  contrato_nome: string | null;
  posto_nome: string | null;
  funcao_nome: string | null;
  nome_colaborador: string | null;
  cancelado_em: string;
  legado: boolean;
  categoria: string | null;
  motivo_nome: string;
  detalhe: string | null;
  origem_nome: string;
  solicitado_por_nome: string | null;
  decidido_por_nome: string | null;
  situacao: SituacaoCancelamento;
  unidades: number;
  valor: number;
  unidades_sem_preco: number;
  reposicao_pedido_id: string | null;
  reposicao_criado_em: string | null;
  reposicao_valor: number | null;
}

export interface PendenteCancelamento {
  id: string;
  pedido_id: string;
  status: string;
  contrato_nome: string | null;
  nome_colaborador: string | null;
  cancelamento_categoria: string | null;
  cancelamento_detalhe: string | null;
  cancelamento_origem: string | null;
  cancelamento_solicitado_por_nome: string | null;
  cancelamento_solicitado_em: string | null;
}

export interface PainelCancelamentos {
  resumo: ResumoCancelamentos;
  por_mes: MesCancelamentos[];
  por_motivo: MotivoCancelamentos[];
  por_origem: { nome: string; quantidade: number }[];
  por_situacao: { situacao: SituacaoCancelamento; quantidade: number; valor: number }[];
  por_contrato: { contrato: string; quantidade: number; valor: number }[];
  linhas: LinhaCancelamento[];
  linhas_truncadas: boolean;
  pendentes: PendenteCancelamento[];
}

const numero = (valor: unknown) => Number(valor) || 0;
const texto = (valor: unknown) => (valor === null || valor === undefined || valor === "" ? null : String(valor));
const lista = <T>(valor: unknown): T[] => (Array.isArray(valor) ? (valor as T[]) : []);

const SITUACOES: SituacaoCancelamento[] = ["AGUARDANDO_COMPRA", "ANTES_DESPACHO", "APOS_DESPACHO", "NAO_INFORMADO"];

function situacao(valor: unknown): SituacaoCancelamento {
  return SITUACOES.includes(valor as SituacaoCancelamento) ? (valor as SituacaoCancelamento) : "NAO_INFORMADO";
}

/** O PostgREST devolve `numeric` como número ou como string, conforme o tamanho. */
export function normalizarPainelCancelamentos(bruto: unknown): PainelCancelamentos {
  const d = (bruto ?? {}) as Record<string, unknown>;
  const r = (d.resumo ?? {}) as Record<string, unknown>;
  return {
    resumo: {
      total: numero(r.total),
      estruturados: numero(r.estruturados),
      legados: numero(r.legados),
      valor: numero(r.valor),
      unidades: numero(r.unidades),
      unidades_sem_preco: numero(r.unidades_sem_preco),
      pedidos_no_periodo: numero(r.pedidos_no_periodo),
      aguardando_decisao: numero(r.aguardando_decisao),
      recusados: numero(r.recusados),
      vagas_com_reposicao: numero(r.vagas_com_reposicao),
      valor_reposicao: numero(r.valor_reposicao),
    },
    por_mes: lista<Record<string, unknown>>(d.por_mes).map((m) => ({
      mes: String(m.mes),
      cancelados: numero(m.cancelados),
      pedidos_criados: numero(m.pedidos_criados),
      valor: numero(m.valor),
    })),
    por_motivo: lista<Record<string, unknown>>(d.por_motivo).map((m) => ({
      categoria: String(m.categoria ?? "OUTRO"),
      nome: String(m.nome ?? "Outro"),
      quantidade: numero(m.quantidade),
      valor: numero(m.valor),
    })),
    por_origem: lista<Record<string, unknown>>(d.por_origem).map((o) => ({
      nome: String(o.nome),
      quantidade: numero(o.quantidade),
    })),
    por_situacao: lista<Record<string, unknown>>(d.por_situacao).map((s) => ({
      situacao: situacao(s.situacao),
      quantidade: numero(s.quantidade),
      valor: numero(s.valor),
    })),
    por_contrato: lista<Record<string, unknown>>(d.por_contrato).map((c) => ({
      contrato: String(c.contrato ?? "Sem contrato"),
      quantidade: numero(c.quantidade),
      valor: numero(c.valor),
    })),
    linhas: lista<Record<string, unknown>>(d.linhas).map((l) => ({
      id: String(l.id),
      empresa_id: String(l.empresa_id),
      pedido_id: String(l.pedido_id ?? ""),
      contrato_nome: texto(l.contrato_nome),
      posto_nome: texto(l.posto_nome),
      funcao_nome: texto(l.funcao_nome),
      nome_colaborador: texto(l.nome_colaborador),
      cancelado_em: String(l.cancelado_em),
      legado: l.legado === true,
      categoria: texto(l.categoria),
      motivo_nome: String(l.motivo_nome ?? "Outro"),
      detalhe: texto(l.detalhe),
      origem_nome: String(l.origem_nome ?? ""),
      solicitado_por_nome: texto(l.solicitado_por_nome),
      decidido_por_nome: texto(l.decidido_por_nome),
      situacao: situacao(l.situacao),
      unidades: numero(l.unidades),
      valor: numero(l.valor),
      unidades_sem_preco: numero(l.unidades_sem_preco),
      reposicao_pedido_id: texto(l.reposicao_pedido_id),
      reposicao_criado_em: texto(l.reposicao_criado_em),
      reposicao_valor: l.reposicao_valor === null || l.reposicao_valor === undefined ? null : numero(l.reposicao_valor),
    })),
    linhas_truncadas: d.linhas_truncadas === true,
    pendentes: lista<PendenteCancelamento>(d.pendentes),
  };
}

export function rotuloSituacaoCancelamento(valor: SituacaoCancelamento): string {
  switch (valor) {
    case "AGUARDANDO_COMPRA":
      return "Aguardando compra";
    case "ANTES_DESPACHO":
      return "Antes do despacho (reserva liberada)";
    case "APOS_DESPACHO":
      return "Depois do despacho (registro antigo)";
    default:
      return "Não informado";
  }
}

/** "2026-11" → "nov/26". */
export function rotuloMes(mes: string): string {
  const [ano, m] = mes.split("-").map(Number);
  if (!ano || !m) return mes;
  const nome = new Date(ano, m - 1, 1).toLocaleDateString("pt-BR", { month: "short" }).replace(".", "");
  return `${nome}/${String(ano).slice(2)}`;
}

/**
 * Proporção do mês: cancelados ÷ pedidos abertos no mês. São populações
 * diferentes (o cancelado de novembro pode ter sido aberto em outubro), por isso
 * a tela chama de "proporção", não de "taxa de cancelamento dos pedidos do mês".
 */
export function proporcaoCancelados(cancelados: number, criados: number): number {
  if (!Number.isFinite(cancelados) || !Number.isFinite(criados) || criados <= 0) return 0;
  return Math.round((cancelados / criados) * 1000) / 10;
}

export function filtrarLinhasCancelamento(linhas: LinhaCancelamento[], busca: string): LinhaCancelamento[] {
  const termo = busca.trim().toLocaleLowerCase("pt-BR");
  if (!termo) return linhas;
  return linhas.filter((l) =>
    [l.pedido_id, l.contrato_nome, l.posto_nome, l.funcao_nome, l.nome_colaborador, l.motivo_nome, l.detalhe,
      l.solicitado_por_nome, l.decidido_por_nome, l.reposicao_pedido_id]
      .some((campo) => campo?.toLocaleLowerCase("pt-BR").includes(termo)),
  );
}

export const COLUNAS_CSV_CANCELAMENTOS = [
  "Pedido",
  "Cancelado em",
  "Contrato",
  "Posto",
  "Função",
  "Colaborador",
  "Motivo",
  "Detalhe",
  "Origem",
  "Solicitado por",
  "Decidido por",
  "Situação ao cancelar",
  "Unidades",
  "Unidades sem preço",
  "Valor estimado (R$)",
  "Provável novo pedido para a vaga",
  "Valor do novo pedido (R$)",
] as const;

export function csvCancelamentos(linhas: LinhaCancelamento[]): string {
  const valor = (n: number | null) => (n === null ? "" : formatarNumero(n, 2).replace(/\./g, ""));
  const celula = (v: string | number | null) => {
    const s = v === null ? "" : String(v);
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const saida: string[] = [COLUNAS_CSV_CANCELAMENTOS.join(";")];
  for (const l of linhas) {
    saida.push([
      l.pedido_id,
      new Date(l.cancelado_em).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }),
      l.contrato_nome,
      l.posto_nome,
      l.funcao_nome,
      l.nome_colaborador,
      l.motivo_nome,
      l.detalhe,
      l.origem_nome,
      l.solicitado_por_nome,
      l.decidido_por_nome,
      rotuloSituacaoCancelamento(l.situacao),
      l.unidades,
      l.unidades_sem_preco,
      valor(l.valor),
      l.reposicao_pedido_id,
      l.reposicao_pedido_id ? valor(l.reposicao_valor) : null,
    ].map(celula).join(";"));
  }
  return saida.join("\n");
}
