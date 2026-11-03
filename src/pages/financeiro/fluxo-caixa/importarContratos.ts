// SIS-2026-0752: o Financeiro exporta do Fluxo de Caixa as linhas "Sem contrato (—)", preenche a coluna Contrato na planilha e importa de volta.
// Aqui fica só a regra (funções puras): ler as linhas da planilha, casar cada uma com a linha do Fluxo e dizer o que será aplicado.
// Quem aplica é a função do banco fluxo_caixa_trocar_contrato (a mesma do botão de editar contrato: regra de empresa, histórico e permissão).
//
// Casamento: Nº + data de pagamento + tipo + empresa + valor (+ parcela). NUNCA sobrescreve um contrato já preenchido no Fluxo.
// Fora do escopo da importação (ficam num relatório): cartão de crédito e aplicação financeira, que não têm contrato pela tela do Fluxo.

export type OrigemFluxo = "malote" | "debito_automatico" | "cartao_fatura" | "aplicacao_financeira" | "importacao_historica";

export interface LinhaPlanilhaContrato {
  linha: number; // número da linha na planilha (cabeçalho = 1)
  numero: string;
  dataIso: string | null;
  tipo: "entrada" | "saida" | null;
  empresa: string;
  valor: number | null;
  parcela: number | null;
  contratoNome: string;
}

export interface LinhaFluxoParaImportar {
  origem: OrigemFluxo;
  despesa_id: string;
  id_malote: string | null;
  data_pagamento: string | null;
  tipo: "entrada" | "saida";
  valor: number | string;
  empresa_id: string | null;
  empresa_nome: string | null;
  contrato_id: string | null;
  contrato_nome: string | null;
  numero_parcela: number | null;
}

export interface ContratoImportacao {
  id: string;
  nome: string;
  empresa_id: string | null;
}

export interface ItemAtualizar {
  origem: OrigemFluxo;
  despesaId: string;
  contratoId: string;
  contratoNome: string;
  numero: string;
  linhasPlanilha: number[];
}

export type MotivoPendencia =
  | "sem_contrato_na_planilha"
  | "contrato_nao_encontrado"
  | "sem_correspondencia_no_fluxo"
  | "ja_tem_outro_contrato"
  | "origem_sem_suporte"
  | "contratos_diferentes_no_mesmo_lancamento"
  | "dados_invalidos";

export interface Pendencia {
  motivo: MotivoPendencia;
  linha: number;
  numero: string;
  detalhe: string;
}

export interface ResultadoCasamento {
  atualizar: ItemAtualizar[];
  jaNoContrato: number;
  pendencias: Pendencia[];
  // nomes de contrato da planilha que não existem no sistema (com quantas linhas dependem de cada um)
  contratosNaoEncontrados: { nome: string; linhas: number }[];
}

export const ROTULO_MOTIVO: Record<MotivoPendencia, string> = {
  sem_contrato_na_planilha: "Contrato em branco na planilha",
  contrato_nao_encontrado: "Contrato da planilha não existe no sistema",
  sem_correspondencia_no_fluxo: "Linha não encontrada no Fluxo (ou já alterada)",
  ja_tem_outro_contrato: "O lançamento já tem outro contrato (não sobrescrito)",
  origem_sem_suporte: "Origem sem contrato pelo Fluxo (cartão / aplicação financeira)",
  contratos_diferentes_no_mesmo_lancamento: "Contratos diferentes para o mesmo lançamento (rateio)",
  dados_invalidos: "Dados da linha ilegíveis (data, valor ou tipo)",
};

export function normalizarTexto(s: unknown): string {
  return String(s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

const r2 = (n: number) => Math.round(n * 100) / 100;

function dataParaIso(v: unknown): string | null {
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    const d = new Date(v.getTime() + 12 * 3600 * 1000);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
  }
  const t = String(v ?? "").trim();
  let m = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(t);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

function numeroDe(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const t = String(v ?? "").replace(/R\$|\s/g, "");
  if (!t) return null;
  const n = Number(t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : t);
  return Number.isFinite(n) ? n : null;
}

// Acha a coluna pelo cabeçalho sem depender de acento, caixa ou do símbolo de "Nº" (º, °, o).
function chaveDaColuna(linha: Record<string, unknown>, nomes: string[]): string | undefined {
  const alvo = new Set(nomes.map((n) => normalizarTexto(n).replace(/[^A-Z0-9]/g, "")));
  return Object.keys(linha).find((k) => alvo.has(normalizarTexto(k).replace(/[^A-Z0-9]/g, "")));
}

// `objetos` = linhas da planilha como objetos (cabeçalho → valor), como devolve o sheet_to_json. A 1ª linha de dados é a linha 2 da planilha.
export function lerLinhasPlanilha(objetos: Record<string, unknown>[]): LinhaPlanilhaContrato[] {
  if (objetos.length === 0) return [];
  const amostra = objetos[0];
  const cNumero = chaveDaColuna(amostra, ["Nº", "No", "N", "Numero"]);
  const cData = chaveDaColuna(amostra, ["Data pagamento", "Data de pagamento"]);
  const cTipo = chaveDaColuna(amostra, ["Tipo"]);
  const cEmpresa = chaveDaColuna(amostra, ["Empresa"]);
  const cValor = chaveDaColuna(amostra, ["Valor"]);
  const cContrato = chaveDaColuna(amostra, ["Contrato"]);
  const cParcela = chaveDaColuna(amostra, ["Parcela"]);
  const lidas: LinhaPlanilhaContrato[] = objetos.map((o, i) => {
    const tipoTxt = normalizarTexto(cTipo ? o[cTipo] : "");
    const parcelaTxt = String(cParcela ? o[cParcela] ?? "" : "").trim();
    return {
      linha: i + 2,
      numero: String(cNumero ? o[cNumero] ?? "" : "").trim(),
      dataIso: dataParaIso(cData ? o[cData] : null),
      tipo: tipoTxt.startsWith("ENTRADA") ? "entrada" : tipoTxt.startsWith("SAIDA") ? "saida" : null,
      empresa: String(cEmpresa ? o[cEmpresa] ?? "" : "").trim(),
      valor: numeroDe(cValor ? o[cValor] : null),
      parcela: /^(\d+)/.test(parcelaTxt) ? Number(/^(\d+)/.exec(parcelaTxt)![1]) : null,
      contratoNome: String(cContrato ? o[cContrato] ?? "" : "").trim(),
    };
  });
  // linha totalmente em branco (sobra de linha apagada na planilha) não é pendência: some sem avisar
  return lidas.filter((l) => l.numero || l.dataIso || l.valor !== null || l.contratoNome || l.empresa);
}

const chaveLinha = (numero: string, data: string | null, tipo: string, empresa: string, valorAbs: number, parcela: number | null) =>
  [normalizarTexto(numero), data ?? "", tipo, normalizarTexto(empresa), r2(valorAbs).toFixed(2), parcela ?? ""].join("|");

export function casarContratos(
  planilha: LinhaPlanilhaContrato[],
  fluxo: LinhaFluxoParaImportar[],
  contratos: ContratoImportacao[],
): ResultadoCasamento {
  const pendencias: Pendencia[] = [];
  const naoEncontrados = new Map<string, number>();
  let jaNoContrato = 0;

  const contratosPorNome = new Map<string, ContratoImportacao[]>();
  for (const c of contratos) {
    const k = normalizarTexto(c.nome);
    contratosPorNome.set(k, [...(contratosPorNome.get(k) ?? []), c]);
  }

  // linhas do Fluxo por chave (cada uma só pode ser usada por uma linha da planilha). O export mostra a parcela só nos parcelados: sem parcela
  // na planilha, o casamento também vale por "tudo menos a parcela".
  const porChave = new Map<string, LinhaFluxoParaImportar[]>();
  const porChaveSemParcela = new Map<string, LinhaFluxoParaImportar[]>();
  for (const l of fluxo) {
    const args = [l.id_malote ?? "", l.data_pagamento, l.tipo, l.empresa_nome ?? "", Math.abs(Number(l.valor) || 0)] as const;
    const k = chaveLinha(...args, l.numero_parcela);
    const kb = chaveLinha(...args, null);
    porChave.set(k, [...(porChave.get(k) ?? []), l]);
    porChaveSemParcela.set(kb, [...(porChaveSemParcela.get(kb) ?? []), l]);
  }
  const usadas = new Set<LinhaFluxoParaImportar>();
  const livre = (lista: LinhaFluxoParaImportar[] | undefined) => lista?.find((l) => !usadas.has(l));

  const alvos = new Map<string, ItemAtualizar>();

  for (const p of planilha) {
    if (!p.contratoNome) {
      pendencias.push({ motivo: "sem_contrato_na_planilha", linha: p.linha, numero: p.numero, detalhe: "" });
      continue;
    }
    if (!p.numero || !p.dataIso || !p.tipo || p.valor === null) {
      pendencias.push({ motivo: "dados_invalidos", linha: p.linha, numero: p.numero, detalhe: `Nº "${p.numero}", data, tipo e valor precisam estar preenchidos` });
      continue;
    }

    const k = chaveLinha(p.numero, p.dataIso, p.tipo, p.empresa, Math.abs(p.valor), p.parcela);
    const kb = chaveLinha(p.numero, p.dataIso, p.tipo, p.empresa, Math.abs(p.valor), null);
    const linhaFluxo = livre(porChave.get(k)) ?? (p.parcela === null ? livre(porChaveSemParcela.get(kb)) : undefined);
    if (!linhaFluxo) {
      pendencias.push({ motivo: "sem_correspondencia_no_fluxo", linha: p.linha, numero: p.numero, detalhe: `${p.dataIso} · ${p.empresa} · ${p.valor}` });
      continue;
    }

    if (linhaFluxo.origem === "cartao_fatura" || linhaFluxo.origem === "aplicacao_financeira") {
      usadas.add(linhaFluxo);
      pendencias.push({ motivo: "origem_sem_suporte", linha: p.linha, numero: p.numero, detalhe: p.contratoNome });
      continue;
    }

    const doNome = contratosPorNome.get(normalizarTexto(p.contratoNome)) ?? [];
    const contrato = doNome.length > 1 ? doNome.find((c) => c.empresa_id && c.empresa_id === linhaFluxo.empresa_id) ?? doNome[0] : doNome[0];
    if (!contrato) {
      usadas.add(linhaFluxo);
      naoEncontrados.set(p.contratoNome, (naoEncontrados.get(p.contratoNome) ?? 0) + 1);
      pendencias.push({ motivo: "contrato_nao_encontrado", linha: p.linha, numero: p.numero, detalhe: p.contratoNome });
      continue;
    }

    usadas.add(linhaFluxo);
    if (linhaFluxo.contrato_id) {
      if (linhaFluxo.contrato_id === contrato.id) { jaNoContrato += 1; continue; }
      pendencias.push({ motivo: "ja_tem_outro_contrato", linha: p.linha, numero: p.numero, detalhe: `já está em "${linhaFluxo.contrato_nome ?? "outro contrato"}"; a planilha pede "${contrato.nome}"` });
      continue;
    }

    const chaveAlvo = `${linhaFluxo.origem}|${linhaFluxo.despesa_id}`;
    const existente = alvos.get(chaveAlvo);
    if (existente) {
      if (existente.contratoId !== contrato.id) {
        pendencias.push({ motivo: "contratos_diferentes_no_mesmo_lancamento", linha: p.linha, numero: p.numero, detalhe: `"${existente.contratoNome}" e "${contrato.nome}" — rateio: ajuste a grade de rateio direto na origem` });
      } else {
        existente.linhasPlanilha.push(p.linha);
      }
      continue;
    }
    alvos.set(chaveAlvo, { origem: linhaFluxo.origem, despesaId: linhaFluxo.despesa_id, contratoId: contrato.id, contratoNome: contrato.nome, numero: p.numero, linhasPlanilha: [p.linha] });
  }

  return {
    atualizar: [...alvos.values()],
    jaNoContrato,
    pendencias,
    contratosNaoEncontrados: [...naoEncontrados.entries()].map(([nome, linhas]) => ({ nome, linhas })).sort((a, b) => b.linhas - a.linhas),
  };
}

// Erros do banco que significam "já está feito" — contam como aplicado, não como falha.
export function erroEhJaNoContrato(mensagem: string | null | undefined): boolean {
  return normalizarTexto(mensagem).includes("JA ESTA NESTE CONTRATO");
}
