import { situacaoFluxo, type AbaFluxo } from "./abasFluxo";

// SIS-2026-0611: os cards do Fluxo abrem um modal que explica o número e mostra o que o alimenta.
export type KpiFluxo = "entradas" | "saidas" | "saldo" | "vencidas";

interface LinhaKpi {
  tipo: "entrada" | "saida";
  valor: number | string;
  data_pagamento: string | null;
  situacao_base?: "aberto" | "cancelado" | null;
}

// As linhas que o card soma (já vindas do filtro atual da tela).
export function linhasDoKpi<T extends LinhaKpi>(linhas: T[], kpi: KpiFluxo, hoje: string): T[] {
  if (kpi === "entradas") return linhas.filter((l) => l.tipo === "entrada");
  if (kpi === "saidas") return linhas.filter((l) => l.tipo === "saida");
  if (kpi === "vencidas") return linhas.filter((l) => l.tipo === "saida" && situacaoFluxo(l, hoje) === "vencido");
  return linhas; // saldo = entradas − saídas
}

export interface GrupoKpi {
  chave: string;
  qtd: number;
  entradas: number;
  saidas: number;
  total: number; // entradas − saídas do grupo (para entradas/saídas/vencidas fica só o lado que interessa)
}

export function agruparKpi<T extends LinhaKpi>(linhas: T[], chaveDe: (l: T) => string): GrupoKpi[] {
  const mapa = new Map<string, GrupoKpi>();
  for (const l of linhas) {
    const chave = chaveDe(l);
    const g = mapa.get(chave) ?? { chave, qtd: 0, entradas: 0, saidas: 0, total: 0 };
    const v = Number(l.valor) || 0;
    g.qtd += 1;
    if (l.tipo === "entrada") g.entradas += v;
    else g.saidas += v;
    g.total = g.entradas - g.saidas;
    mapa.set(chave, g);
  }
  return Array.from(mapa.values()).sort((a, b) => Math.abs(b.total) - Math.abs(a.total));
}

export function totalKpi<T extends LinhaKpi>(linhas: T[], kpi: KpiFluxo): number {
  const v = (l: T) => Number(l.valor) || 0;
  if (kpi === "saldo") return linhas.reduce((s, l) => s + (l.tipo === "entrada" ? v(l) : -v(l)), 0);
  return linhas.reduce((s, l) => s + v(l), 0);
}

export interface ExplicacaoKpi {
  titulo: string;
  oQueE: string;
  fontes: string[];
  aviso?: string;
}

export function explicacaoKpi(kpi: KpiFluxo, aba: AbaFluxo): ExplicacaoKpi {
  const projetado = aba === "projetado";
  const consolidado = aba === "consolidado";
  const periodo = projetado ? "previstos" : consolidado ? "realizados e previstos" : "realizados";

  if (kpi === "entradas") {
    return {
      titulo: projetado ? "Entradas previstas" : "Entradas",
      oQueE: projetado
        ? "Recebimentos que ainda não aconteceram, dentro do filtro atual."
        : `Soma das entradas ${periodo} no filtro atual.`,
      fontes: projetado
        ? [
            "Débito Automático: entradas com status pendente (inclui as de data já vencida).",
            "Entradas já lançadas no Fluxo com data de pagamento futura.",
          ]
        : [
            "Débito Automático: entradas pagas (Nota Recebida e movimentações financeiras).",
            "Aplicações Financeiras: resgates.",
            "Importação da planilha de Fluxo 2026: entradas.",
          ],
      aviso: projetado || consolidado
        ? "Não inclui recebimento de contratos nem NFs emitidas aguardando pagamento: o ERP ainda não tem uma fonte de contas a receber ligada ao Fluxo."
        : undefined,
    };
  }
  if (kpi === "saidas") {
    return {
      titulo: projetado ? "Saídas previstas" : "Saídas",
      oQueE: projetado
        ? "Pagamentos que ainda não aconteceram, dentro do filtro atual. Canceladas não entram."
        : `Soma das saídas ${periodo} no filtro atual.`,
      fontes: projetado
        ? [
            "Pagamento Malote: despesas aprovadas aguardando pagamento e parcelas ainda pendentes.",
            "Débito Automático: saídas com status pendente (inclui as parcelas futuras).",
            "Lançamentos já feitos no Fluxo com data de pagamento futura (ex.: parcelas de cartão a vencer).",
          ]
        : [
            "Pagamento Malote: despesas e parcelas pagas.",
            "Débito Automático: saídas pagas.",
            "Fatura de Cartão de Crédito (importada e consolidada).",
            "Aplicações Financeiras: aplicações.",
            "Importação da planilha de Fluxo 2026: saídas.",
          ],
    };
  }
  if (kpi === "vencidas") {
    return {
      titulo: "Vencidas não pagas (saídas)",
      oQueE: "Saídas previstas cuja data de pagamento já passou e que continuam sem pagamento confirmado.",
      fontes: [
        "Pagamento Malote: despesas aprovadas e parcelas pendentes com data anterior a hoje.",
        "Débito Automático: saídas pendentes com data anterior a hoje.",
      ],
      aviso: "Quando o pagamento é confirmado, o lançamento sai daqui e passa para o Realizado.",
    };
  }
  return {
    titulo: projetado ? "Saldo projetado" : "Saldo",
    oQueE: `Entradas menos saídas ${periodo} no filtro atual. É o resultado do período, não um saldo bancário.`,
    fontes: ["Os mesmos lançamentos dos cards de Entradas e de Saídas."],
    aviso: "O Fluxo ainda não tem fonte de saldo bancário real (extrato).",
  };
}
