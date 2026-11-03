// SIS-2026-0780: alteração em massa do Fluxo de Caixa (Centro de Custo e Classificação). Funções puras: dizem, para cada linha marcada,
// se a troca vale ou por que a linha fica de fora. Quem executa (a tela) repete o que o lápis do Fluxo já faz, linha a linha:
//   · Classificação → ajuste só do Fluxo (financeiro_fluxo_caixa_ajuste), a origem não muda;
//   · Centro de Custo → fluxo_caixa_trocar_contrato(), que grava na ORIGEM (e no Malote repassa o valor no Orçamento).
// "Centro de Custo" é o nome que a tela passou a usar para o Contrato (SIS-2026-0780); o dado continua sendo contratos.id.

export type TipoMassa = "centro_custo" | "classificacao" | "conta_banco";

export interface LinhaMassa {
  origem: "malote" | "debito_automatico" | "cartao_fatura" | "aplicacao_financeira" | "importacao_historica";
  despesa_id: string;
  numero_parcela: number | null;
  id_malote?: string | null;
  empresa_id: string | null;
  contrato_id: string | null;
  contrato_nome: string | null;
  /** SIS-2026-0777: banco do lançamento e conta já atribuída (nulo = sem conta definida). */
  banco_id?: string | null;
  conta_banco_id?: string | null;
  classificacao_id: string | null;
  classificacao_nome: string | null;
  /** Mais de uma classificação na linha (despesa rateada em classificações diferentes). */
  classificacoesIds?: string[];
  fatura_cartao_id?: string | null;
  rateioDetalhe?: { id: string }[];
}

export interface IgnoradaMassa {
  linha: LinhaMassa;
  motivo: string;
}

export interface PlanoMassa {
  aplicar: LinhaMassa[];
  ignoradas: IgnoradaMassa[];
}

// Origens em que fluxo_caixa_trocar_contrato() funciona (cartão tem o "Classificar Lançamentos"; aplicação não tem contrato).
const ORIGENS_COM_TROCA_DE_CENTRO: LinhaMassa["origem"][] = ["malote", "debito_automatico", "importacao_historica"];
// Origens que aceitam ajuste (financeiro_fluxo_caixa_ajuste_origem_check).
const ORIGENS_COM_AJUSTE: LinhaMassa["origem"][] = ["malote", "debito_automatico", "cartao_fatura", "importacao_historica"];
// Malote e débito só trocam para centro de custo da MESMA empresa do lançamento (a importada da planilha não tem essa trava).
const ORIGENS_MESMA_EMPRESA: LinhaMassa["origem"][] = ["malote", "debito_automatico"];

export const chaveDaLinhaMassa = (l: Pick<LinhaMassa, "despesa_id" | "numero_parcela">) => `${l.despesa_id}-${l.numero_parcela ?? "unica"}`;

const rateadaEmCentros = (l: LinhaMassa) => l.contrato_nome === "Rateio" || (!l.fatura_cartao_id && (l.rateioDetalhe?.length ?? 0) > 1);
const rateadaEmClassificacoes = (l: LinhaMassa) => l.classificacao_nome === "Rateio" || (l.classificacoesIds?.length ?? 0) > 1;

export function planejarTrocaDeCentroDeCusto(linhas: LinhaMassa[], novo: { id: string; empresa_id: string | null }): PlanoMassa {
  const aplicar: LinhaMassa[] = [];
  const ignoradas: IgnoradaMassa[] = [];
  const jaVistas = new Set<string>();
  for (const l of linhas) {
    const ignora = (motivo: string) => ignoradas.push({ linha: l, motivo });
    if (!ORIGENS_COM_TROCA_DE_CENTRO.includes(l.origem)) {
      ignora(l.origem === "cartao_fatura" ? "Cartão: o centro de custo é definido em Classificar Lançamentos de Cartão" : "Este tipo de lançamento não tem centro de custo");
      continue;
    }
    if (rateadaEmCentros(l)) { ignora("Rateada entre vários centros de custo: ajuste a grade de rateio na despesa"); continue; }
    if (l.contrato_id === novo.id) { ignora("Já está neste centro de custo"); continue; }
    if (ORIGENS_MESMA_EMPRESA.includes(l.origem) && (l.empresa_id ?? null) !== (novo.empresa_id ?? null)) {
      ignora("O centro de custo escolhido é de outra empresa");
      continue;
    }
    // A troca vale para a despesa inteira: as outras parcelas marcadas já são cobertas pela primeira.
    const chave = `${l.origem}:${l.despesa_id}`;
    if (jaVistas.has(chave)) { ignora("Outra parcela da mesma despesa: a troca já vale para ela"); continue; }
    jaVistas.add(chave);
    aplicar.push(l);
  }
  return { aplicar, ignoradas };
}

export function planejarTrocaDeClassificacao(linhas: LinhaMassa[], novaClassificacaoId: string): PlanoMassa {
  const aplicar: LinhaMassa[] = [];
  const ignoradas: IgnoradaMassa[] = [];
  for (const l of linhas) {
    const ignora = (motivo: string) => ignoradas.push({ linha: l, motivo });
    if (!ORIGENS_COM_AJUSTE.includes(l.origem)) { ignora("Este tipo de lançamento não permite trocar a classificação pelo Fluxo"); continue; }
    if (rateadaEmClassificacoes(l)) { ignora("Rateada em várias classificações: trocar em massa apagaria a divisão"); continue; }
    if (l.classificacao_id === novaClassificacaoId) { ignora("Já está nesta classificação"); continue; }
    aplicar.push(l);
  }
  return { aplicar, ignoradas };
}

// SIS-2026-0777: liga lançamentos a uma CONTA do banco (ex.: Sicredi HAGG 119). Não mexe no lançamento nem no Fluxo, só na tabela de contas.
export function planejarAtribuicaoDeConta(linhas: LinhaMassa[], conta: { id: string; banco_id: string; empresa_id: string }): PlanoMassa {
  const aplicar: LinhaMassa[] = [];
  const ignoradas: IgnoradaMassa[] = [];
  const jaVistas = new Set<string>();
  for (const l of linhas) {
    const ignora = (motivo: string) => ignoradas.push({ linha: l, motivo });
    if (!l.banco_id) { ignora("Lançamento sem banco: informe o banco antes de escolher a conta"); continue; }
    if (l.banco_id !== conta.banco_id) { ignora("A conta escolhida é de outro banco"); continue; }
    if (l.conta_banco_id === conta.id) { ignora("Já está nesta conta"); continue; }
    if (!rateadaEmCentros(l) && l.empresa_id && l.empresa_id !== conta.empresa_id) { ignora("A conta escolhida é de outra empresa"); continue; }
    const chave = `${l.origem}:${l.despesa_id}:${l.numero_parcela ?? 0}`;
    if (jaVistas.has(chave)) { ignora("Outra fatia do mesmo lançamento: a conta já vale para ela"); continue; }
    jaVistas.add(chave);
    aplicar.push(l);
  }
  return { aplicar, ignoradas };
}

/** Motivo → quantas linhas, para o resumo de "ficaram de fora" e de "deram erro". */
export function contarMotivos(itens: { motivo: string }[]): { motivo: string; quantidade: number }[] {
  const mapa = new Map<string, number>();
  for (const i of itens) mapa.set(i.motivo, (mapa.get(i.motivo) ?? 0) + 1);
  return [...mapa.entries()].map(([motivo, quantidade]) => ({ motivo, quantidade })).sort((a, b) => b.quantidade - a.quantidade);
}
