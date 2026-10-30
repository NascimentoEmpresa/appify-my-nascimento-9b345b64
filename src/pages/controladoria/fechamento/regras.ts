// SIS-2026-0642: regras do Fechamento da Empresa (Controladoria). Funções puras — a tela só junta as fontes.
//
//   Lucro dos Contratos = valor líquido faturado − custos dos contratos (mesma conta da Lucratividade de Contratos).
//   Despesas Administrativas = saídas do Fluxo de Caixa SEM contrato e as dos contratos "ADMINISTRATIVO - …" (centros de custo da empresa,
//                              pedido da Controladoria, 22/10/2026), nas mesmas rubricas dos contratos (transferência, aplicação, empréstimo, financiamento etc. não contam).
//   Resultado Operacional = Lucro dos Contratos − Total de Despesas Administrativas (era "Resultado Final").
//   Resultado Gerencial após Ajustes = Resultado Operacional − sócios − Investimentos − Obras Adm.     (SIS-2026-0749)
//   Resultado Gerencial Líquido = Resultado Gerencial após Ajustes − Tributos sobre o Resultado (IRPJ e CSLL).
//   Margem Final = Resultado Operacional ÷ Lucro dos Contratos.
//
// Meses até o atual são realizados (despesa e faturamento pela competência; SIS-2026-0708).
// Meses futuros são PROJETADOS:
//   • faturamento: notas já emitidas na competência; sem nota, o executável do mês × a proporção líquido/executável
//     dos últimos meses realizados;
//   • custos dos contratos e despesas administrativas: o que já está lançado/programado no Fluxo, ou a média mensal
//     dos últimos meses realizados, o que for maior (o Fluxo costuma ter pouco programado para frente).
import { custosVazios, ehDespesaDeSocio, mesDoCusto, RUBRICAS, rubricaDaLinha, totalCustos, type CustosPorRubrica, type LigacoesRubrica, type LinhaFluxoCusto, type RubricaCusto } from "../faturamento/regras";

export type StatusFechamento = "saudavel" | "atencao" | "critico";

export const ROTULO_STATUS: Record<StatusFechamento, string> = { saudavel: "Saudável", atencao: "Atenção", critico: "Crítico" };

// Quantos meses realizados entram na média usada nas projeções.
export const MESES_NA_MEDIA = 3;

// De onde vem cada coluna de rubrica (tooltip do cabeçalho). A regra é a de rubricaDeCusto (faturamento/regras.ts): o nome
// da classificação do lançamento no Fluxo de Caixa decide a rubrica; a ligação manual feita na Lucratividade vale primeiro.
export const ORIGEM_RUBRICA: Record<RubricaCusto, string> = {
  salarios: "Classificações que começam com \"Salário\" (exceto salário-educação, que vai em Outras), 13º salário e adiantamento de 13º.",
  ferias: "Classificações com \"Férias\" no nome.",
  rescisoes: "Classificações com \"Rescisão\" no nome, incluindo o FGTS da rescisão.",
  fgts: "Classificações com \"FGTS\" no nome (o FGTS de rescisão vai em Rescisões).",
  inss: "Classificações com \"INSS\" no nome.",
  va: "Classificações \"VA\" ou com \"Vale alimentação\" no nome.",
  vt: "Classificações \"VT\" ou com \"Vale transporte\" no nome.",
  outras: "Qualquer outra classificação de despesa sem contrato (ex.: serviços, sistemas, consignado, consórcio, patrimônio, pró-labore). Saída sem classificação não entra.",
};

// Origem comum a todas as colunas de despesa administrativa.
export const ORIGEM_ADM =
  "Saídas do Fluxo de Caixa SEM contrato (Malote, débito automático, fatura de cartão e importação histórica), no mês da base escolhida no topo da tela (competência ou data de pagamento). Transferência, aplicação, empréstimo e financiamento não contam. A ligação manual de classificação em Lucratividade › Rubricas de custo vale antes do nome.";

const r2 = (v: number) => Math.round(v * 100) / 100;

// ── SIS-2026-0709: despesas dos sócios ────────────────────────────────────────────────────────────────────
// O sócio é um "contrato" administrativo com o nome dele: "ADMINISTRATIVO SÓCIOS - HELENA", "ADMINISTRATIVO SÓCIOS - CARLOS EDUARDO"
// (também vale "ADMINISTRATIVO SENILTON", sem o "SÓCIOS -"). Os contratos administrativos das empresas levam hífen logo depois de
// ADMINISTRATIVO ("ADMINISTRATIVO - HAGG") e NÃO são de sócio. As despesas dos sócios saem do Resultado Final
// (que fica "sem sócios") e entram no Resultado com Sócios, que dá o Lucro Líquido Final.
export function socioDoContrato(nome: string | null | undefined): string | null {
  const original = (nome ?? "").trim().toUpperCase();
  const m = /^ADMINISTRATIVO\s+S[OÓ]CIOS?\s*[-–—]\s*(\S.*)$/.exec(original) ?? /^ADMINISTRATIVO\s+(?![-–—])(\S.*)$/.exec(original);
  if (!m) return null;
  const nomeSocio = m[1].trim().toLowerCase().replace(/(^|\s)\p{L}/gu, (c) => c.toUpperCase());
  return nomeSocio || null;
}

// SIS-2026-0744: contratos "INVESTIMENTOS <empresa>" (INVESTIMENTOS AGPS, HAGG, SN…) recebem o mesmo tratamento das despesas dos sócios: a saída fica
// fora do Resultado Final e entra numa coluna própria, "Investimentos", antes do Lucro Líquido Final. Casa pelo INÍCIO do nome, sem acento e sem caixa.
export const ROTULO_INVESTIMENTOS = "Investimentos";
export function ehContratoInvestimento(nome: string | null | undefined): boolean {
  return (nome ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toUpperCase().startsWith("INVESTIMENTO");
}

// SIS-2026-0749: contratos "OBRAS ADM - …" (tratamento "Obra administrativa") formam a coluna "Obras Adm", com a mesma regra dos investimentos.
export const ROTULO_OBRAS_ADM = "Obras Adm";

// Ordem das colunas da aba com sócios: os sócios em ordem alfabética, depois "Investimentos" e por último "Obras Adm" (logo antes do Resultado Gerencial após Ajustes).
const pesoColuna = (nome: string) => (nome === ROTULO_OBRAS_ADM ? 2 : nome === ROTULO_INVESTIMENTOS ? 1 : 0);
export function ordenarColunasSocios(nomes: string[]): string[] {
  return [...nomes].sort((a, b) => pesoColuna(a) - pesoColuna(b) || a.localeCompare(b, "pt-BR"));
}

// SIS-2026-0749: Tributos sobre o Resultado = saídas das classificações IRPJ e CSLL. Saem das Despesas Administrativas (e do Resultado Operacional) e
// são descontadas só depois do Resultado Gerencial após Ajustes. Casa pela palavra no nome da classificação, sem acento e sem caixa, para valer também
// para variações ("IRPJ - ADICIONAL"). IMPOSTOS e TRIBUTOS ESTADUAIS continuam como despesa administrativa. A ligação manual "não é custo" vale antes.
export function ehTributoSobreResultado(l: Pick<LinhaFluxoCusto, "classificacao_id" | "classificacao_nome">, ligacoes?: LigacoesRubrica): boolean {
  if (l.classificacao_id && ligacoes?.get(l.classificacao_id) === "nao_custo") return false;
  const nome = (l.classificacao_nome ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
  return /\b(IRPJ|CSLL)\b/.test(nome);
}

// Rubrica de despesa ADMINISTRATIVA: a do Fluxo, exceto o que virou Tributo sobre o Resultado (null = fora da despesa administrativa).
function rubricaAdm(l: Pick<LinhaFluxoCusto, "classificacao_id" | "classificacao_nome">, ligacoes?: LigacoesRubrica): RubricaCusto | null {
  return ehTributoSobreResultado(l, ligacoes) ? null : rubricaDaLinha(l, ligacoes);
}

/** mês ("YYYY-MM") → total lançado em IRPJ/CSLL (saídas sem contrato, mesma seleção da despesa administrativa). */
export function tributosPorMes(linhas: LinhaFluxoCusto[], ligacoes?: LigacoesRubrica, empresaId?: string | null): Map<string, number> {
  const mapa = new Map<string, number>();
  for (const l of linhas) {
    const mes = mesDoCusto(l);
    if (l.tipo !== "saida" || l.contrato_id || !mes) continue;
    if (empresaId && l.empresa_id !== empresaId) continue;
    if (!ehTributoSobreResultado(l, ligacoes)) continue;
    mapa.set(mes, (mapa.get(mes) ?? 0) + (l.valor || 0));
  }
  return mapa;
}

/** sócio → mês ("YYYY-MM") → total de despesa lançada no Fluxo (todas as saídas do contrato do sócio, qualquer classificação). */
export function despesasDosSocios(
  linhas: LinhaFluxoCusto[],
  socioPorContrato: Map<string, string>,
  ligacoes?: LigacoesRubrica,
): Map<string, Map<string, number>> {
  const out = new Map<string, Map<string, number>>();
  for (const l of linhas) {
    const mes = mesDoCusto(l);
    if (!l.contrato_id || !mes) continue;
    const socio = socioPorContrato.get(l.contrato_id);
    if (!socio || !ehDespesaDeSocio(l, ligacoes)) continue;
    const porMes = out.get(socio) ?? new Map<string, number>();
    porMes.set(mes, (porMes.get(mes) ?? 0) + (l.valor || 0));
    out.set(socio, porMes);
  }
  return out;
}

// Margem Final = Resultado ÷ Lucro dos Contratos. Sem lucro positivo não há base de comparação (null).
export function margemFinal(resultado: number, lucro: number): number | null {
  return lucro > 0 ? resultado / lucro : null;
}

// Maior que 10% = Saudável; de 8% a 10% = Atenção; menos que 8% = Crítico. Compara com a margem como aparece na
// tela (duas casas em %), para 9,996% não aparecer "10,00%" e ficar em Atenção por engano.
// Sem lucro positivo: resultado negativo é Crítico; zerado não tem status.
export function statusDoFechamento(lucro: number, resultado: number): StatusFechamento | null {
  const m = margemFinal(resultado, lucro);
  if (m === null) return resultado < 0 ? "critico" : null;
  const p = Math.round(m * 10000) / 100;
  if (p > 10) return "saudavel";
  if (p >= 8) return "atencao";
  return "critico";
}

export interface EntradasMes {
  // "YYYY-MM"
  meses: string[];
  mesAtual: string;
  liquidoPorMes: Map<string, number>;
  executavelPorMes: Map<string, number>;
  custosContratoPorMes: Map<string, number>;
  admPorMes: Map<string, CustosPorRubrica>;
  // SIS-2026-0709: sócio → mês → despesa. Sem isto o Lucro Líquido Final é igual ao Resultado Final.
  sociosPorMes?: Map<string, Map<string, number>>;
  // SIS-2026-0749: IRPJ + CSLL por mês (Tributos sobre o Resultado).
  tributosPorMes?: Map<string, number>;
}

export interface LinhaFechamento {
  mes: string;
  projetado: boolean;
  lucroContratos: number;
  adm: CustosPorRubrica;
  totalAdm: number;
  resultado: number;
  margem: number | null;
  status: StatusFechamento | null;
  // SIS-2026-0709: despesas de cada sócio no mês, o total e o Lucro Líquido Final (resultado − sócios).
  socios: Record<string, number>;
  totalSocios: number;
  // = Resultado Gerencial após Ajustes (resultado operacional − sócios − Investimentos − Obras Adm; os dois últimos vêm junto em `socios`).
  lucroLiquido: number;
  // SIS-2026-0749: Tributos sobre o Resultado (IRPJ + CSLL) e o Resultado Gerencial Líquido (lucroLiquido − tributos). Margem e status são deste último.
  tributos: number;
  resultadoGerencialLiquido: number;
  margemLiquida: number | null;
  statusLiquido: StatusFechamento | null;
}

export function somaRubricas(a: CustosPorRubrica, b: CustosPorRubrica): CustosPorRubrica {
  const out = custosVazios();
  for (const r of RUBRICAS) out[r.id] = a[r.id] + b[r.id];
  return out;
}

// Meses realizados usados como referência da média: os últimos MESES_NA_MEDIA anteriores ao mês atual (o mês atual
// ainda está incompleto); se não houver nenhum (janeiro), vale o próprio mês atual.
function mesesDeReferencia(meses: string[], mesAtual: string): string[] {
  const anteriores = meses.filter((m) => m < mesAtual).slice(-MESES_NA_MEDIA);
  if (anteriores.length > 0) return anteriores;
  return meses.filter((m) => m === mesAtual);
}

export function montarFechamento(e: EntradasMes): LinhaFechamento[] {
  const refs = mesesDeReferencia(e.meses, e.mesAtual);
  const media = (f: (m: string) => number) => (refs.length ? refs.reduce((s, m) => s + f(m), 0) / refs.length : 0);

  const somaLiq = refs.reduce((s, m) => s + (e.liquidoPorMes.get(m) ?? 0), 0);
  const somaExec = refs.reduce((s, m) => s + (e.executavelPorMes.get(m) ?? 0), 0);
  const proporcao = somaExec > 0 ? somaLiq / somaExec : 0;
  const mediaCustoContrato = media((m) => e.custosContratoPorMes.get(m) ?? 0);
  const mediaTributos = media((m) => e.tributosPorMes?.get(m) ?? 0);
  const mediaAdm: CustosPorRubrica = custosVazios();
  for (const r of RUBRICAS) mediaAdm[r.id] = media((m) => (e.admPorMes.get(m) ?? custosVazios())[r.id]);

  return e.meses.map((mes) => {
    const projetado = mes > e.mesAtual;
    const liquidoEmitido = e.liquidoPorMes.get(mes) ?? 0;
    const custoContratoLancado = e.custosContratoPorMes.get(mes) ?? 0;
    const admLancada = e.admPorMes.get(mes) ?? custosVazios();

    let liquido = liquidoEmitido;
    let custoContrato = custoContratoLancado;
    let adm = admLancada;
    if (projetado) {
      liquido = liquidoEmitido > 0 ? liquidoEmitido : (e.executavelPorMes.get(mes) ?? 0) * proporcao;
      custoContrato = Math.max(custoContratoLancado, mediaCustoContrato);
      adm = custosVazios();
      for (const r of RUBRICAS) adm[r.id] = Math.max(admLancada[r.id], mediaAdm[r.id]);
    }
    const lucroContratos = r2(liquido - custoContrato);
    const totalAdm = r2(totalCustos(adm));
    const resultado = r2(lucroContratos - totalAdm);

    // Sócios: nos meses realizados vale o lançado; nos projetados, o lançado ou a média dos últimos meses, o maior (como a administrativa).
    const socios: Record<string, number> = {};
    for (const [socio, porMes] of e.sociosPorMes ?? []) {
      const lancado = porMes.get(mes) ?? 0;
      socios[socio] = r2(projetado ? Math.max(lancado, media((m) => porMes.get(m) ?? 0)) : lancado);
    }
    const totalSocios = r2(Object.values(socios).reduce((s, v) => s + v, 0));
    const lucroLiquido = r2(resultado - totalSocios);
    // Tributos: nos meses projetados vale o lançado ou a média dos últimos meses, o maior (como as demais despesas).
    const tributosLancados = e.tributosPorMes?.get(mes) ?? 0;
    const tributos = r2(projetado ? Math.max(tributosLancados, mediaTributos) : tributosLancados);
    const resultadoGerencialLiquido = r2(lucroLiquido - tributos);
    return {
      mes, projetado, lucroContratos, adm, totalAdm, resultado, margem: margemFinal(resultado, lucroContratos), status: statusDoFechamento(lucroContratos, resultado),
      socios, totalSocios, lucroLiquido, tributos, resultadoGerencialLiquido,
      margemLiquida: margemFinal(resultadoGerencialLiquido, lucroContratos), statusLiquido: statusDoFechamento(lucroContratos, resultadoGerencialLiquido),
    };
  });
}

export interface TotalFechamento {
  lucroContratos: number;
  adm: CustosPorRubrica;
  totalAdm: number;
  resultado: number;
  margem: number | null;
  status: StatusFechamento | null;
  lucroRealizado: number;
  lucroProjetado: number;
  // SIS-2026-0709
  socios: Record<string, number>;
  totalSocios: number;
  lucroLiquido: number;
  // SIS-2026-0749
  tributos: number;
  resultadoGerencialLiquido: number;
  margemLiquida: number | null;
  statusLiquido: StatusFechamento | null;
}

export function totalDoFechamento(linhas: LinhaFechamento[]): TotalFechamento {
  let adm = custosVazios();
  let lucro = 0, lucroRealizado = 0, lucroProjetado = 0, tributosSoma = 0;
  const socios: Record<string, number> = {};
  for (const l of linhas) {
    tributosSoma += l.tributos;
    for (const [s, v] of Object.entries(l.socios)) socios[s] = (socios[s] ?? 0) + v;
    adm = somaRubricas(adm, l.adm);
    lucro += l.lucroContratos;
    if (l.projetado) lucroProjetado += l.lucroContratos; else lucroRealizado += l.lucroContratos;
  }
  const lucroContratos = r2(lucro);
  const totalAdm = r2(totalCustos(adm));
  const resultado = r2(lucroContratos - totalAdm);
  for (const s of Object.keys(socios)) socios[s] = r2(socios[s]);
  const totalSocios = r2(Object.values(socios).reduce((t, v) => t + v, 0));
  const lucroLiquido = r2(resultado - totalSocios);
  const tributos = r2(tributosSoma);
  const resultadoGerencialLiquido = r2(lucroLiquido - tributos);
  return {
    lucroContratos, adm, totalAdm, resultado, margem: margemFinal(resultado, lucroContratos), status: statusDoFechamento(lucroContratos, resultado),
    lucroRealizado: r2(lucroRealizado), lucroProjetado: r2(lucroProjetado),
    socios, totalSocios, lucroLiquido, tributos, resultadoGerencialLiquido,
    margemLiquida: margemFinal(resultadoGerencialLiquido, lucroContratos), statusLiquido: statusDoFechamento(lucroContratos, resultadoGerencialLiquido),
  };
}

// Despesas administrativas por mês e rubrica: saídas sem contrato que sejam despesa (a ligação manual da classificação
// vale primeiro, como na Lucratividade).
export function admPorMesRubrica(linhas: LinhaFluxoCusto[], ligacoes?: LigacoesRubrica, empresaId?: string | null): Map<string, CustosPorRubrica> {
  const mapa = new Map<string, CustosPorRubrica>();
  for (const l of linhas) {
    const mes = mesDoCusto(l);
    if (l.tipo !== "saida" || l.contrato_id || !mes) continue;
    if (empresaId && l.empresa_id !== empresaId) continue;
    const rubrica = rubricaAdm(l, ligacoes);
    if (!rubrica) continue;
    const atual = mapa.get(mes) ?? custosVazios();
    atual[rubrica] += l.valor || 0;
    mapa.set(mes, atual);
  }
  return mapa;
}

export interface LinhaPorClassificacao {
  classificacao: string;
  rubrica: RubricaCusto;
  valor: number;
  lancamentos: number;
}

// Aba "Despesas Administrativas": o que está lançado no Fluxo, por classificação, nos meses escolhidos.
export function admPorClassificacao(linhas: LinhaFluxoCusto[], meses: Set<string>, ligacoes?: LigacoesRubrica, empresaId?: string | null): LinhaPorClassificacao[] {
  const mapa = new Map<string, LinhaPorClassificacao>();
  for (const l of linhas) {
    const mesDaLinha = mesDoCusto(l);
    if (l.tipo !== "saida" || l.contrato_id || !mesDaLinha || !meses.has(mesDaLinha)) continue;
    if (empresaId && l.empresa_id !== empresaId) continue;
    const rubrica = rubricaAdm(l, ligacoes);
    if (!rubrica) continue;
    const nome = (l.classificacao_nome ?? "").trim() || "(sem classificação)";
    const atual = mapa.get(nome) ?? { classificacao: nome, rubrica, valor: 0, lancamentos: 0 };
    atual.valor += l.valor || 0;
    atual.lancamentos += 1;
    mapa.set(nome, atual);
  }
  return [...mapa.values()].map((x) => ({ ...x, valor: r2(x.valor) })).sort((a, b) => b.valor - a.valor);
}

// Saídas sem contrato e sem classificação: ficam fora de qualquer rubrica; a tela avisa para ninguém perder de vista.
export function admSemClassificacao(linhas: LinhaFluxoCusto[], empresaId?: string | null): { linhas: number; valor: number } {
  let n = 0, valor = 0;
  for (const l of linhas) {
    if (l.tipo !== "saida" || l.contrato_id || (l.classificacao_nome ?? "").trim()) continue;
    if (empresaId && l.empresa_id !== empresaId) continue;
    n += 1;
    valor += l.valor || 0;
  }
  return { linhas: n, valor: r2(valor) };
}

// ── SIS-2026-0730: detalhamento por classificação ao clicar no valor ──────────────────────────────────────────────────
// Mesma seleção de linhas e mesmo mês das colunas do resumo mensal, só que agrupada pela classificação do lançamento no Fluxo.
// A soma do detalhe é o valor da célula; nos meses projetados o que a célula mostra pode passar do lançado (média dos últimos
// meses): a diferença vem à parte em `complementoProjecao`, para o total do modal sempre bater com o número clicado.
export interface ItemDetalheClassificacao {
  // SIS-2026-0755: id da classificação (null = lançamento sem classificação), para trocar a rubrica dela direto no modal
  classificacaoId: string | null;
  classificacao: string;
  valor: number;
  lancamentos: number;
}

function agruparPorClassificacao(linhas: { classificacao_id?: string | null; classificacao_nome: string | null; valor: number }[]): ItemDetalheClassificacao[] {
  const mapa = new Map<string, ItemDetalheClassificacao>();
  for (const l of linhas) {
    const nome = (l.classificacao_nome ?? "").trim() || "(sem classificação)";
    const atual = mapa.get(nome) ?? { classificacaoId: l.classificacao_id ?? null, classificacao: nome, valor: 0, lancamentos: 0 };
    atual.valor += l.valor || 0;
    atual.lancamentos += 1;
    mapa.set(nome, atual);
  }
  return [...mapa.values()].map((x) => ({ ...x, valor: r2(x.valor) })).sort((a, b) => b.valor - a.valor || a.classificacao.localeCompare(b.classificacao, "pt-BR"));
}

/** Despesa administrativa lançada nos meses, por classificação. `rubricas` = só essas colunas (null = todas, para o Total Desp. Adm). */
export function detalheAdmPorClassificacao(
  linhas: LinhaFluxoCusto[],
  meses: Set<string>,
  rubricas: RubricaCusto[] | null,
  ligacoes?: LigacoesRubrica,
  empresaId?: string | null,
): ItemDetalheClassificacao[] {
  const escolhidas = linhas.filter((l) => {
    const mes = mesDoCusto(l);
    if (l.tipo !== "saida" || l.contrato_id || !mes || !meses.has(mes)) return false;
    if (empresaId && l.empresa_id !== empresaId) return false;
    const rubrica = rubricaAdm(l, ligacoes);
    return !!rubrica && (!rubricas || rubricas.includes(rubrica));
  });
  return agruparPorClassificacao(escolhidas);
}

/** IRPJ/CSLL lançados nos meses, por classificação (mesma seleção de tributosPorMes). */
export function detalheTributosPorClassificacao(linhas: LinhaFluxoCusto[], meses: Set<string>, ligacoes?: LigacoesRubrica, empresaId?: string | null): ItemDetalheClassificacao[] {
  const escolhidas = linhas.filter((l) => {
    const mes = mesDoCusto(l);
    if (l.tipo !== "saida" || l.contrato_id || !mes || !meses.has(mes)) return false;
    if (empresaId && l.empresa_id !== empresaId) return false;
    return ehTributoSobreResultado(l, ligacoes);
  });
  return agruparPorClassificacao(escolhidas);
}

/** Despesa lançada nos contratos do sócio nos meses, por classificação (mesma seleção de despesasDosSocios). */
export function detalheSocioPorClassificacao(
  linhas: LinhaFluxoCusto[],
  meses: Set<string>,
  socio: string,
  socioPorContrato: Map<string, string>,
  ligacoes?: LigacoesRubrica,
): ItemDetalheClassificacao[] {
  const escolhidas = linhas.filter((l) => {
    const mes = mesDoCusto(l);
    if (!l.contrato_id || !mes || !meses.has(mes)) return false;
    return socioPorContrato.get(l.contrato_id) === socio && ehDespesaDeSocio(l, ligacoes);
  });
  return agruparPorClassificacao(escolhidas);
}

/** Quanto do valor mostrado na célula não está lançado (projeção por média). Zero nos meses realizados. */
export function complementoProjecao(valorCelula: number, itens: ItemDetalheClassificacao[]): number {
  const dif = r2(valorCelula - itens.reduce((s, i) => s + i.valor, 0));
  return dif > 0.005 ? dif : 0;
}
