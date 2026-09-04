import type { LinhaBruta } from "./tipos";
import { novoUuid } from "@/lib/utils";

export type StatusRevisaoItem = "novo" | "confirmado_sem_mudanca" | "valor_mudou" | "nao_encontrada";

export interface ItemExistente {
  id: string;
  compra_id: string;
  descricao: string;
  data_compra: string | null;
  valor: number;
  parcela_atual: number | null;
  parcela_total: number | null;
  origem: "importado" | "projetado" | "manual";
  status: "confirmado" | "pendente_confirmacao";
}

export interface ItemRevisao {
  /** null = item novo, nunca existiu no banco — gera id na hora de confirmar. */
  id: string | null;
  compraId: string;
  descricao: string;
  dataCompra: string | null;
  valor: number;
  parcelaAtual: number | null;
  parcelaTotal: number | null;
  origem: "importado" | "manual";
  statusRevisao: StatusRevisaoItem;
  /** só quando statusRevisao === "valor_mudou". */
  valorAnterior?: number;
}

function normalizar(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Casa as linhas recém-parseadas do arquivo com os itens que já existem
 * pra esta fatura (projeção de mês anterior com status='pendente_
 * confirmacao', ou já 'confirmado' se o usuário está reimportando a MESMA
 * competência pra corrigir algo). Critério: mesma parcela_total +
 * parcela_atual esperado, desempatado por descrição igual quando há mais
 * de 1 candidato. Ambíguo sem desempate = falha pro lado seguro (linha
 * nova vira "novo" sem casar, e o(s) candidato(s) sobra(m) como "não
 * encontrada") — decisão confirmada com o usuário.
 */
export function reconciliar(linhasBrutas: LinhaBruta[], itensExistentes: ItemExistente[]): ItemRevisao[] {
  const usados = new Set<string>();
  const resultado: ItemRevisao[] = [];

  for (const linha of linhasBrutas) {
    const candidatos = itensExistentes.filter(
      (it) => !usados.has(it.id) && it.parcela_atual === linha.parcelaAtual && it.parcela_total === linha.parcelaTotal,
    );

    let match: ItemExistente | null = null;
    if (candidatos.length === 1) {
      match = candidatos[0];
    } else if (candidatos.length > 1) {
      const normLinha = normalizar(linha.descricao);
      const exatos = candidatos.filter((c) => normalizar(c.descricao) === normLinha);
      if (exatos.length === 1) match = exatos[0];
      // > 1 exato ou 0 exato entre vários candidatos = ambíguo, não casa.
    }

    if (match) {
      usados.add(match.id);
      const valorMudou = Math.abs(match.valor - linha.valor) > 0.005;
      resultado.push({
        id: match.id,
        compraId: match.compra_id,
        descricao: linha.descricao,
        dataCompra: linha.data,
        valor: linha.valor,
        parcelaAtual: linha.parcelaAtual,
        parcelaTotal: linha.parcelaTotal,
        origem: "importado",
        statusRevisao: valorMudou ? "valor_mudou" : "confirmado_sem_mudanca",
        valorAnterior: valorMudou ? match.valor : undefined,
      });
    } else {
      resultado.push({
        id: null,
        compraId: novoUuid(),
        descricao: linha.descricao,
        dataCompra: linha.data,
        valor: linha.valor,
        parcelaAtual: linha.parcelaAtual,
        parcelaTotal: linha.parcelaTotal,
        origem: "importado",
        statusRevisao: "novo",
      });
    }
  }

  for (const it of itensExistentes) {
    if (usados.has(it.id)) continue;
    resultado.push({
      id: it.id,
      compraId: it.compra_id,
      descricao: it.descricao,
      dataCompra: it.data_compra,
      valor: it.valor,
      parcelaAtual: it.parcela_atual,
      parcelaTotal: it.parcela_total,
      origem: it.origem === "manual" ? "manual" : "importado",
      statusRevisao: "nao_encontrada",
    });
  }

  return resultado;
}
