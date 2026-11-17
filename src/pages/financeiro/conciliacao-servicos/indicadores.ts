// SIS-2026-0903: Conciliação Financeira ampliada. Funções puras (sem React nem banco) para serem testadas.
//
// Regra central do chamado: indicador que uma fonte NÃO traz é "indisponível" (null), nunca zero. Só se compara o que existe em pelo menos duas
// fontes; indicador de fonte única aparece com o valor, sem conferência cruzada. As quatro fontes são as telas do ERP:
//   • Relatório Geral (Relatório de Serviços)   • Dashboard do Relatório de Serviços
//   • Faturamento da Empresa (Controladoria)    • Lucratividade de Contratos (Controladoria)
// Cada fonte calcula com a SUA conta (as mesmas funções que a tela chama); aqui só se junta e se aponta onde destoam.
import type { NfEmissaoItemRow, NfEmissaoRow } from "@/hooks/useNfEmissao";
import { naoContabilizaKpi, pendenciaContaVinculada, somaDescontosPosEmissao, valorPendenteNf, statusDaNota, type StatusNota } from "@/pages/financeiro/nf-emissao/shared";
import { aReceberDaNf, agruparFaturamento, lucroBruto, lucroRecebido, totaisVazios } from "@/pages/controladoria/faturamento/regras";
import { IMPOSTOS_RETIDOS, retencoesDaNf, totaisDoRelatorio } from "@/pages/financeiro/relatorio-servicos/totais";
import { CAMPOS_DESCONTO, kpisDoDashboard } from "@/pages/financeiro/relatorio-servicos/kpisDashboard";

export const TOLERANCIA = 0.005;
const r2 = (v: number) => Math.round(v * 100) / 100;

export type FonteExt = "geral" | "dashboard" | "faturamento" | "lucratividade";
export const FONTES_EXT: { id: FonteExt; rotulo: string }[] = [
  { id: "geral", rotulo: "Relatório Geral" },
  { id: "dashboard", rotulo: "Dashboard" },
  { id: "faturamento", rotulo: "Faturamento da Empresa" },
  { id: "lucratividade", rotulo: "Lucratividade de Contratos" },
];

export type GrupoIndicador = "Valores da NF" | "Descontos" | "Impostos" | "Conta vinculada" | "Resultado";
export const GRUPOS_INDICADOR: GrupoIndicador[] = ["Valores da NF", "Descontos", "Impostos", "Conta vinculada", "Resultado"];

export type IndicadorId =
  | "executavel" | "executado" | "bruto" | "dif_exec_fat" | "liquido" | "impostos"
  | "faltas" | "postos" | "glosas_antes" | "glosas_depois" | "multas_antes" | "multas_depois" | "outros_antes" | "outros_depois" | "desc_pos_total"
  | "recebido" | "pendente" | "cv_descontada" | "cv_recebida" | "cv_pendente"
  | "despesas" | "lucro_faturamento" | "lucro_recebimentos" | "margem";

export interface IndicadorExt {
  id: IndicadorId;
  rotulo: string;
  grupo: GrupoIndicador;
  formato: "moeda" | "pct";
  /** Fontes em que a tela mostra este indicador. As demais são "indisponível". */
  fontes: FonteExt[];
  formula: string;
  /** Existe valor por NF (dá para abrir o detalhamento até a nota). */
  porNota: boolean;
}

export const INDICADORES_EXT: IndicadorExt[] = [
  { id: "executavel", rotulo: "Valor executável", grupo: "Valores da NF", formato: "moeda", fontes: ["geral", "faturamento", "lucratividade"], porNota: false,
    formula: "Valor da licitação/contrato (planilha de custo vigente). Relatório Geral: um por contrato e mês COM nota Código N; Faturamento e Lucratividade: todos os contratos do recorte, por mês." },
  { id: "executado", rotulo: "Valor executado", grupo: "Valores da NF", formato: "moeda", fontes: ["geral", "dashboard"], porNota: true,
    formula: "Soma do 'Valor contrato exec.' digitado nas NFs." },
  { id: "bruto", rotulo: "Valor faturado (bruto)", grupo: "Valores da NF", formato: "moeda", fontes: ["geral", "dashboard", "faturamento", "lucratividade"], porNota: true,
    formula: "Soma do valor bruto das NFs." },
  { id: "dif_exec_fat", rotulo: "Executado − faturado", grupo: "Valores da NF", formato: "moeda", fontes: ["geral", "dashboard"], porNota: true,
    formula: "Valor executado − valor faturado (bruto). Positivo: executou mais do que faturou." },
  { id: "liquido", rotulo: "Valor líquido", grupo: "Valores da NF", formato: "moeda", fontes: ["geral", "faturamento", "lucratividade"], porNota: true,
    formula: "Soma do valor líquido das NFs (após descontos e retenções da nota)." },
  { id: "impostos", rotulo: "Impostos retidos", grupo: "Impostos", formato: "moeda", fontes: ["geral"], porNota: true,
    formula: "ISSQN + INSS + IR + COFINS + PIS + CSLL retidos nas NFs." },
  { id: "faltas", rotulo: "Faltas", grupo: "Descontos", formato: "moeda", fontes: ["dashboard"], porNota: true, formula: "Soma das faltas dos itens das NFs." },
  { id: "postos", rotulo: "Postos não implementados", grupo: "Descontos", formato: "moeda", fontes: ["dashboard"], porNota: true, formula: "Soma dos postos não implementados dos itens." },
  { id: "glosas_antes", rotulo: "Glosas antes da NF", grupo: "Descontos", formato: "moeda", fontes: ["dashboard"], porNota: true, formula: "Glosas lançadas antes da emissão (já no líquido)." },
  { id: "glosas_depois", rotulo: "Glosas depois da NF", grupo: "Descontos", formato: "moeda", fontes: ["dashboard"], porNota: true, formula: "Glosas pós-emissão (fora do líquido; reduzem o que falta receber)." },
  { id: "multas_antes", rotulo: "Multas antes da NF", grupo: "Descontos", formato: "moeda", fontes: ["dashboard"], porNota: true, formula: "Multas lançadas antes da emissão (já no líquido)." },
  { id: "multas_depois", rotulo: "Multas depois da NF", grupo: "Descontos", formato: "moeda", fontes: ["dashboard"], porNota: true, formula: "Multas pós-emissão (fora do líquido)." },
  { id: "outros_antes", rotulo: "Outros descontos antes da NF", grupo: "Descontos", formato: "moeda", fontes: ["dashboard"], porNota: true, formula: "Outros descontos antes da emissão (já no líquido)." },
  { id: "outros_depois", rotulo: "Outros descontos depois da NF", grupo: "Descontos", formato: "moeda", fontes: ["dashboard"], porNota: true, formula: "Outros descontos pós-emissão (fora do líquido)." },
  { id: "desc_pos_total", rotulo: "Descontos depois da NF (total)", grupo: "Descontos", formato: "moeda", fontes: ["dashboard", "faturamento"], porNota: true,
    formula: "Multas + glosas + outros descontos pós-emissão. Dashboard: soma dos itens; Faturamento da Empresa: total gravado no cabeçalho da NF." },
  { id: "recebido", rotulo: "Valor recebido", grupo: "Valores da NF", formato: "moeda", fontes: ["geral", "dashboard", "faturamento"], porNota: true, formula: "Soma do valor pago das NFs." },
  { id: "pendente", rotulo: "Valor pendente de recebimento", grupo: "Valores da NF", formato: "moeda", fontes: ["geral", "dashboard", "faturamento"], porNota: true,
    formula: "Relatório e Dashboard: líquido − pago − conta vinculada − descontos pós-emissão dos itens. Faturamento da Empresa: a mesma conta com o total pós-emissão do cabeçalho, e nota paga (com data de pagamento) não tem saldo." },
  { id: "cv_descontada", rotulo: "Conta vinculada descontada", grupo: "Conta vinculada", formato: "moeda", fontes: ["geral", "dashboard", "faturamento"], porNota: true, formula: "Desconto de conta vinculada retido nas NFs." },
  { id: "cv_recebida", rotulo: "Conta vinculada efetivamente recebida", grupo: "Conta vinculada", formato: "moeda", fontes: ["geral"], porNota: true, formula: "Valor que entrou na conta vinculada (registrado no Relatório Geral)." },
  { id: "cv_pendente", rotulo: "Pendência da conta vinculada", grupo: "Conta vinculada", formato: "moeda", fontes: ["geral"], porNota: true, formula: "Desconto − recebido, por nota, nunca negativa (NF em situação especial não tem pendência)." },
  { id: "despesas", rotulo: "Despesas", grupo: "Resultado", formato: "moeda", fontes: ["lucratividade"], porNota: false,
    formula: "Saídas do Fluxo de Caixa com contrato nos meses do recorte (custos por rubrica)." },
  { id: "lucro_faturamento", rotulo: "Lucro sobre faturamento", grupo: "Resultado", formato: "moeda", fontes: ["lucratividade"], porNota: false, formula: "Valor líquido faturado − despesas." },
  { id: "lucro_recebimentos", rotulo: "Lucro sobre recebimentos", grupo: "Resultado", formato: "moeda", fontes: ["faturamento"], porNota: false, formula: "Valor recebido − despesas." },
  { id: "margem", rotulo: "Margem de resultado", grupo: "Resultado", formato: "pct", fontes: ["lucratividade"], porNota: false, formula: "Lucro sobre faturamento ÷ valor líquido." },
];

// ── Totais por fonte ────────────────────────────────────────────────────────────────────────────────────────────────────────────────

export type ValoresPorFonte = Record<FonteExt, number | null>;
export type StatusIndicador = "conciliado" | "divergente" | "fonte_unica" | "sem_dado";

export interface LinhaIndicadorExt {
  indicador: IndicadorExt;
  valores: ValoresPorFonte;
  /** Maior − menor entre as fontes que trazem o indicador; null com menos de duas fontes. */
  diferenca: number | null;
  variacaoPct: number | null;
  status: StatusIndicador;
  /** Fontes em que o indicador não existe (indisponível ≠ zero). */
  indisponiveis: FonteExt[];
  destoantes: FonteExt[];
}

export interface EntradaIndicadores {
  linhasRelatorio: NfEmissaoRow[];
  linhasFaturamento: NfEmissaoRow[];
  itensPorNf: Map<string, NfEmissaoItemRow[]> | undefined;
  /** Executável do contrato no mês (planilha vigente). */
  executavelDoContratoMes: (contratoId: string, anoMes: string) => number;
  /** Contratos do recorte (sem os ADMINISTRATIVO) e os meses realizados do recorte: base do executável de Faturamento/Lucratividade. */
  contratosDoRecorte: { id: string }[];
  meses: string[];
  /** Despesas dos contratos do recorte nos meses; null = ainda não carregadas (indicador fica sem dado, não zero). */
  despesas: number | null;
}

const vazioPorFonte = (): ValoresPorFonte => ({ geral: null, dashboard: null, faturamento: null, lucratividade: null });

export function descontosPorCampo(linhas: NfEmissaoRow[], itensPorNf: Map<string, NfEmissaoItemRow[]> | undefined): Record<string, number> {
  const out: Record<string, number> = Object.fromEntries(CAMPOS_DESCONTO.map((c) => [String(c.key), 0]));
  for (const n of linhas) {
    if (naoContabilizaKpi(n)) continue;
    for (const it of itensPorNf?.get(n.id) ?? []) for (const c of CAMPOS_DESCONTO) out[String(c.key)] += Number(it[c.key]) || 0;
  }
  for (const k of Object.keys(out)) out[k] = r2(out[k]);
  return out;
}

export function indicadoresExtendidos(e: EntradaIndicadores): LinhaIndicadorExt[] {
  const itensDe = (n: NfEmissaoRow) => e.itensPorNf?.get(n.id) ?? [];
  const tRG = totaisDoRelatorio(e.linhasRelatorio, e.executavelDoContratoMes, (n) => valorPendenteNf(n, itensDe(n)));
  const kDB = kpisDoDashboard(e.linhasRelatorio, e.itensPorNf);
  const porCampo = descontosPorCampo(e.linhasRelatorio, e.itensPorNf);
  const tFat = [...agruparFaturamento(e.linhasFaturamento, () => "tudo").values()][0] ?? totaisVazios();
  const execRecorte = r2(e.contratosDoRecorte.reduce((s, c) => s + e.meses.reduce((m, mes) => m + e.executavelDoContratoMes(c.id, mes), 0), 0));

  const dashPos = r2((porCampo.multas_pos_emissao ?? 0) + (porCampo.glosas_pos_emissao ?? 0) + (porCampo.outros_descontos_pos_emissao ?? 0));
  const lucro = e.despesas === null ? null : lucroBruto(tFat.liquido, e.despesas);
  const v: Record<IndicadorId, Partial<ValoresPorFonte>> = {
    executavel: { geral: tRG.executavel, faturamento: execRecorte, lucratividade: execRecorte },
    executado: { geral: tRG.executado, dashboard: r2(kDB.executado) },
    bruto: { geral: tRG.faturado, dashboard: r2(kDB.faturado), faturamento: r2(tFat.bruto), lucratividade: r2(tFat.bruto) },
    dif_exec_fat: { geral: tRG.divergencia, dashboard: r2(kDB.executado - kDB.faturado) },
    liquido: { geral: tRG.liquido, faturamento: r2(tFat.liquido), lucratividade: r2(tFat.liquido) },
    impostos: { geral: tRG.retencoes },
    faltas: { dashboard: porCampo.faltas },
    postos: { dashboard: porCampo.posto_nao_implementado },
    glosas_antes: { dashboard: porCampo.glosas },
    glosas_depois: { dashboard: porCampo.glosas_pos_emissao },
    multas_antes: { dashboard: porCampo.multas },
    multas_depois: { dashboard: porCampo.multas_pos_emissao },
    outros_antes: { dashboard: porCampo.outros_descontos },
    outros_depois: { dashboard: porCampo.outros_descontos_pos_emissao },
    desc_pos_total: { dashboard: dashPos, faturamento: r2(tFat.posEmissao) },
    recebido: { geral: tRG.recebido, dashboard: r2(kDB.recebido), faturamento: r2(tFat.recebido) },
    pendente: { geral: tRG.pendente, dashboard: r2(kDB.pendente), faturamento: r2(tFat.aReceber) },
    cv_descontada: { geral: tRG.contaVinculada, dashboard: r2(e.linhasRelatorio.reduce((s, n) => (naoContabilizaKpi(n) ? s : s + (n.desconto_conta_vinculada || 0)), 0)), faturamento: r2(tFat.contaVinculada) },
    cv_recebida: { geral: tRG.contaVinculadaRecebida },
    cv_pendente: { geral: tRG.pendenciaContaVinculada },
    despesas: { lucratividade: e.despesas === null ? null : r2(e.despesas) },
    lucro_faturamento: { lucratividade: lucro ? r2(lucro.lucro) : null },
    lucro_recebimentos: { faturamento: e.despesas === null ? null : r2(lucroRecebido(tFat.recebido, e.despesas)) },
    margem: { lucratividade: lucro && lucro.margem !== null ? lucro.margem * 100 : null },
  };

  return INDICADORES_EXT.map((ind) => {
    const valores = vazioPorFonte();
    for (const f of ind.fontes) valores[f] = v[ind.id][f] ?? null;
    const presentes = FONTES_EXT.map((f) => f.id).filter((f) => valores[f] !== null);
    const nums = presentes.map((f) => valores[f] as number);
    const diferenca = nums.length >= 2 ? r2(Math.max(...nums) - Math.min(...nums)) : null;
    const status: StatusIndicador = nums.length === 0 ? "sem_dado" : nums.length === 1 ? "fonte_unica" : diferenca! < TOLERANCIA ? "conciliado" : "divergente";
    return {
      indicador: ind,
      valores,
      diferenca,
      variacaoPct: diferenca !== null && nums[0] !== 0 ? (diferenca / Math.abs(valores[presentes[0]] as number)) * 100 : null,
      status,
      indisponiveis: FONTES_EXT.map((f) => f.id).filter((f) => !ind.fontes.includes(f)),
      destoantes: status === "divergente" ? destoantesDeExt(valores) : [],
    };
  });
}

/** Quem destoa: a fonte sozinha contra as demais iguais; se todas diferem entre si, todas as que têm o indicador. */
export function destoantesDeExt(v: ValoresPorFonte): FonteExt[] {
  const pres = FONTES_EXT.map((f) => f.id).filter((f) => v[f] !== null);
  const iguais = (a: number, b: number) => Math.abs(a - b) < TOLERANCIA;
  const grupos: FonteExt[][] = [];
  for (const f of pres) {
    const g = grupos.find((x) => iguais(v[x[0]] as number, v[f] as number));
    if (g) g.push(f); else grupos.push([f]);
  }
  if (grupos.length <= 1) return [];
  const maior = Math.max(...grupos.map((g) => g.length));
  const lideres = grupos.filter((g) => g.length === maior);
  return lideres.length === 1 && maior > 1 ? grupos.filter((g) => g !== lideres[0]).flat() : pres;
}

// ── Detalhamento por nota (4.2) ────────────────────────────────────────────────────────────────────────────────────────────────────

/** Valor de UMA nota num indicador, do jeito que cada fonte calcula. null = a fonte não traz o indicador. */
export function valorDaNota(id: IndicadorId, fonte: FonteExt, n: NfEmissaoRow, itens: NfEmissaoItemRow[]): number | null {
  const soma = (campo: keyof NfEmissaoItemRow) => itens.reduce((s, it) => s + (Number(it[campo]) || 0), 0);
  const ind = INDICADORES_EXT.find((i) => i.id === id);
  if (!ind || !ind.fontes.includes(fonte) || !ind.porNota) return null;
  switch (id) {
    case "executado": return n.valor_contrato_exec_total || 0;
    case "bruto": return n.vlr_bruto_total || 0;
    case "dif_exec_fat": return (n.valor_contrato_exec_total || 0) - (n.vlr_bruto_total || 0);
    case "liquido": return n.vlr_liquido_total || 0;
    case "impostos": return retencoesDaNf(n);
    case "faltas": return soma("faltas");
    case "postos": return soma("posto_nao_implementado");
    case "glosas_antes": return soma("glosas");
    case "glosas_depois": return soma("glosas_pos_emissao");
    case "multas_antes": return soma("multas");
    case "multas_depois": return soma("multas_pos_emissao");
    case "outros_antes": return soma("outros_descontos");
    case "outros_depois": return soma("outros_descontos_pos_emissao");
    case "desc_pos_total": return fonte === "faturamento" ? Number(n.descontos_pos_emissao_total) || 0 : somaDescontosPosEmissao(itens);
    case "recebido": return n.valor_pago ?? 0;
    case "pendente": return fonte === "faturamento" ? aReceberDaNf(n) : valorPendenteNf(n, itens);
    case "cv_descontada": return n.desconto_conta_vinculada || 0;
    case "cv_recebida": return n.conta_vinculada_valor_recebido ?? 0;
    case "cv_pendente": return pendenciaContaVinculada(n);
    default: return null;
  }
}

export type Dimensao = "competencia" | "empresa" | "cliente" | "contrato" | "nota";
export const DIMENSOES: { id: Dimensao; rotulo: string }[] = [
  { id: "competencia", rotulo: "Competência" },
  { id: "empresa", rotulo: "Empresa" },
  { id: "cliente", rotulo: "Cliente" },
  { id: "contrato", rotulo: "Contrato" },
  { id: "nota", rotulo: "Nota fiscal" },
];

export interface ContextoNota {
  empresaNome: (empresaId: string) => string;
  contratoPorId: Map<string, { nome: string; cliente: string; empresa_id: string }>;
}

export interface LinhaDetalhe {
  chave: string;
  rotulo: string;
  /** Soma por fonte; null quando nenhuma NF do grupo existe naquela fonte. */
  valores: ValoresPorFonte;
  diferenca: number;
  notas: number;
  /** NFs do grupo que estão em uma fonte e não em outra (registro ausente). */
  ausentes: number;
  tipo: "NF" | "grupo";
  /** Só no nível NF: a nota para abrir/justificar. */
  nota?: { id: string; empresaId: string; contratoId: string; competencia: string; situacao: StatusNota; numero: string };
}

/** Filtro de drill: dimensão → valor da chave escolhida (ex.: competencia = "2026-03"). */
export type FiltroDrill = Partial<Record<Dimensao, string>>;

function chaveDimensao(d: Dimensao, n: NfEmissaoRow, c: ContextoNota): { chave: string; rotulo: string } {
  switch (d) {
    case "competencia": { const m = n.competencia.slice(0, 7); return { chave: m, rotulo: `${m.slice(5, 7)}/${m.slice(0, 4)}` }; }
    case "empresa": return { chave: n.empresa_id, rotulo: c.empresaNome(n.empresa_id) || "—" };
    case "cliente": { const cl = n.contrato?.cliente ?? c.contratoPorId.get(n.contrato_id)?.cliente ?? "Sem cliente"; return { chave: cl, rotulo: cl }; }
    case "contrato": return { chave: n.contrato_id, rotulo: n.contrato?.nome ?? c.contratoPorId.get(n.contrato_id)?.nome ?? "Sem contrato" };
    case "nota": return { chave: n.id, rotulo: `${n.numero_nf ?? "s/n"}${n.variacao ? `-${n.variacao}` : ""}` };
  }
}

/**
 * Detalhamento progressivo de UM indicador: agrupa as NFs por `dimensao` (depois de aplicar o `drill` já escolhido) e mostra, por fonte, o valor
 * de cada grupo e a diferença. NF que está numa fonte e não na outra conta como "ausente" (≠ valor zerado).
 */
export function detalharIndicador(
  id: IndicadorId,
  e: Pick<EntradaIndicadores, "linhasRelatorio" | "linhasFaturamento" | "itensPorNf">,
  dimensao: Dimensao,
  drill: FiltroDrill,
  ctx: ContextoNota,
): LinhaDetalhe[] {
  const ind = INDICADORES_EXT.find((i) => i.id === id);
  if (!ind || !ind.porNota) return [];
  const idsRel = new Set(e.linhasRelatorio.map((n) => n.id));
  const idsFat = new Set(e.linhasFaturamento.map((n) => n.id));
  const todas = new Map<string, NfEmissaoRow>();
  for (const n of [...e.linhasRelatorio, ...e.linhasFaturamento]) todas.set(n.id, n);

  const grupos = new Map<string, LinhaDetalhe>();
  for (const n of todas.values()) {
    if (naoContabilizaKpi(n)) continue;
    if (!(Object.keys(drill) as Dimensao[]).every((d) => chaveDimensao(d, n, ctx).chave === drill[d])) continue;
    const itens = e.itensPorNf?.get(n.id) ?? [];
    const naFonte = (f: FonteExt) => (f === "faturamento" || f === "lucratividade" ? idsFat.has(n.id) : idsRel.has(n.id));
    const { chave, rotulo } = chaveDimensao(dimensao, n, ctx);
    let g = grupos.get(chave);
    if (!g) {
      g = { chave, rotulo, valores: vazioPorFonte(), diferenca: 0, notas: 0, ausentes: 0, tipo: dimensao === "nota" ? "NF" : "grupo" };
      if (dimensao === "nota") g.nota = { id: n.id, empresaId: n.empresa_id, contratoId: n.contrato_id, competencia: n.competencia.slice(0, 7), situacao: statusDaNota(n), numero: rotulo };
      grupos.set(chave, g);
    }
    g.notas += 1;
    const presentes = ind.fontes.filter(naFonte).length;
    if (presentes > 0 && presentes < ind.fontes.length) g.ausentes += 1;
    for (const f of ind.fontes) {
      if (!naFonte(f)) continue;
      const val = valorDaNota(id, f, n, itens);
      if (val === null) continue;
      g.valores[f] = r2((g.valores[f] ?? 0) + val);
    }
  }
  for (const g of grupos.values()) {
    const nums = FONTES_EXT.map((f) => g.valores[f.id]).filter((x): x is number => x !== null);
    g.diferenca = nums.length >= 2 ? r2(Math.max(...nums) - Math.min(...nums)) : 0;
  }
  return [...grupos.values()].sort((a, b) => b.diferenca - a.diferenca || b.ausentes - a.ausentes || a.rotulo.localeCompare(b.rotulo, "pt-BR"));
}

// ── Impostos e descontos (4.4) ───────────────────────────────────────────────────────────────────────────────────────────────────────

export interface LinhaImpostosDescontos {
  id: string;
  numero: string;
  contratoId: string;
  contratoNome: string;
  empresaId: string;
  competencia: string;
  /** impostos no cabeçalho da NF (o que o Relatório mostra) */
  impostos: Record<string, number>;
  totalImpostos: number;
  /** soma dos impostos dos itens (o que a nota de fato carrega item a item) */
  totalImpostosItens: number;
  faltas: number;
  postos: number;
  multasAntes: number; multasDepois: number;
  glosasAntes: number; glosasDepois: number;
  outrosAntes: number; outrosDepois: number;
  posCabecalho: number;
  posItens: number;
  inconsistencias: string[];
}

export function linhasImpostosDescontos(
  nfs: NfEmissaoRow[], itensPorNf: Map<string, NfEmissaoItemRow[]> | undefined, nomeContrato: (n: NfEmissaoRow) => string,
): LinhaImpostosDescontos[] {
  const fmt = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  const out: LinhaImpostosDescontos[] = [];
  for (const n of nfs) {
    if (naoContabilizaKpi(n)) continue;
    const itens = itensPorNf?.get(n.id);
    const soma = (campo: keyof NfEmissaoItemRow) => (itens ?? []).reduce((s, it) => s + (Number(it[campo]) || 0), 0);
    const impostos = Object.fromEntries(IMPOSTOS_RETIDOS.map((i) => [i.campo, n[i.campo] ?? 0]));
    const totalImpostos = r2(retencoesDaNf(n));
    const totalImpostosItens = r2(["issqn", "inss", "ir", "cofins", "pis", "csll"].reduce((s, c) => s + soma(c as keyof NfEmissaoItemRow), 0));
    const posItens = r2(somaDescontosPosEmissao(itens ?? []));
    const posCabecalho = r2(Number(n.descontos_pos_emissao_total) || 0);
    const inconsistencias: string[] = [];
    if (itens && itens.length > 0) {
      if (Math.abs(totalImpostos - totalImpostosItens) > TOLERANCIA) inconsistencias.push(`Impostos do cabeçalho (${fmt(totalImpostos)}) diferem da soma dos itens (${fmt(totalImpostosItens)}).`);
      if (Math.abs(posCabecalho - posItens) > TOLERANCIA) inconsistencias.push(`Descontos pós-emissão do cabeçalho (${fmt(posCabecalho)}) diferem da soma dos itens (${fmt(posItens)}).`);
    } else if (itens === undefined) {
      // itens ainda não carregados: não afirma divergência
    } else if (totalImpostos > 0 || posCabecalho > 0) {
      inconsistencias.push("NF com valores no cabeçalho e sem itens: não há como conferir a composição.");
    }
    out.push({
      id: n.id, numero: `${n.numero_nf ?? "s/n"}${n.variacao ? `-${n.variacao}` : ""}`, contratoId: n.contrato_id, contratoNome: nomeContrato(n), empresaId: n.empresa_id,
      competencia: n.competencia.slice(0, 7), impostos, totalImpostos, totalImpostosItens,
      faltas: r2(soma("faltas")), postos: r2(soma("posto_nao_implementado")),
      multasAntes: r2(soma("multas")), multasDepois: r2(soma("multas_pos_emissao")),
      glosasAntes: r2(soma("glosas")), glosasDepois: r2(soma("glosas_pos_emissao")),
      outrosAntes: r2(soma("outros_descontos")), outrosDepois: r2(soma("outros_descontos_pos_emissao")),
      posCabecalho, posItens, inconsistencias,
    });
  }
  return out;
}

// ── Contas vinculadas (4.5) ──────────────────────────────────────────────────────────────────────────────────────────────────────────

export type SituacaoContaVinculada = "recebida" | "parcial" | "pendente" | "recebido_a_mais";
export const ROTULO_SITUACAO_CV: Record<SituacaoContaVinculada, string> = { recebida: "Recebida", parcial: "Recebida em parte", pendente: "Pendente", recebido_a_mais: "Recebido a mais" };

export interface LinhaContaVinculada {
  id: string;
  numero: string;
  contratoId: string;
  contratoNome: string;
  empresaId: string;
  competencia: string;
  descontada: number;
  recebida: number;
  dataRecebimento: string | null;
  pendente: number;
  situacao: SituacaoContaVinculada;
}

/** Só entram NFs com conta vinculada descontada ou recebida. */
export function linhasContaVinculada(nfs: NfEmissaoRow[], nomeContrato: (n: NfEmissaoRow) => string): LinhaContaVinculada[] {
  const out: LinhaContaVinculada[] = [];
  for (const n of nfs) {
    if (naoContabilizaKpi(n)) continue;
    const descontada = r2(n.desconto_conta_vinculada || 0);
    const recebida = r2(n.conta_vinculada_valor_recebido || 0);
    if (descontada === 0 && recebida === 0) continue;
    const pendente = pendenciaContaVinculada(n);
    const situacao: SituacaoContaVinculada = recebida - descontada > TOLERANCIA ? "recebido_a_mais" : pendente < TOLERANCIA ? "recebida" : recebida > 0 ? "parcial" : "pendente";
    out.push({
      id: n.id, numero: `${n.numero_nf ?? "s/n"}${n.variacao ? `-${n.variacao}` : ""}`, contratoId: n.contrato_id, contratoNome: nomeContrato(n), empresaId: n.empresa_id,
      competencia: n.competencia.slice(0, 7), descontada, recebida, dataRecebimento: n.conta_vinculada_data_recebimento ?? null, pendente, situacao,
    });
  }
  return out.sort((a, b) => b.pendente - a.pendente || a.contratoNome.localeCompare(b.contratoNome, "pt-BR"));
}

export function somarContaVinculada(linhas: LinhaContaVinculada[], chaveDe: (l: LinhaContaVinculada) => { chave: string; rotulo: string }) {
  const m = new Map<string, { chave: string; rotulo: string; notas: number; descontada: number; recebida: number; pendente: number }>();
  for (const l of linhas) {
    const { chave, rotulo } = chaveDe(l);
    const g = m.get(chave) ?? { chave, rotulo, notas: 0, descontada: 0, recebida: 0, pendente: 0 };
    g.notas += 1; g.descontada = r2(g.descontada + l.descontada); g.recebida = r2(g.recebida + l.recebida); g.pendente = r2(g.pendente + l.pendente);
    m.set(chave, g);
  }
  return [...m.values()].sort((a, b) => b.pendente - a.pendente);
}

// ── Critérios de comparação (4.3) ────────────────────────────────────────────────────────────────────────────────────────────────────

export interface CriterioFonte { criterio: string; geral: string; dashboard: string; faturamento: string; lucratividade: string; iguais: boolean }

/** O que cada tela considera. Mostrado ANTES de classificar valores como divergentes: critério diferente explica diferença, não é erro. */
export const CRITERIOS: CriterioFonte[] = [
  { criterio: "Período", geral: "Competência da NF", dashboard: "Competência da NF", faturamento: "Competência da NF", lucratividade: "Competência da NF (intervalo de meses)", iguais: true },
  { criterio: "Empresa", geral: "Empresa da NF", dashboard: "Empresa da NF", faturamento: "Empresa do CONTRATO", lucratividade: "Empresa do CONTRATO", iguais: false },
  { criterio: "Cliente", geral: "Cliente do contrato gravado na NF", dashboard: "Cliente do contrato gravado na NF", faturamento: "Cliente do cadastro de contratos", lucratividade: "Cliente do cadastro de contratos", iguais: false },
  { criterio: "NF sem contrato no cadastro", geral: "Entra", dashboard: "Entra", faturamento: "Fica de fora", lucratividade: "Fica de fora", iguais: false },
  { criterio: "Códigos da NF", geral: "Os escolhidos no filtro", dashboard: "Os escolhidos no filtro", faturamento: "Os escolhidos no filtro (padrão N)", lucratividade: "Os escolhidos no filtro (padrão N)", iguais: true },
  { criterio: "Cancelada / substituída", geral: "Fora dos totais", dashboard: "Fora dos totais", faturamento: "Fora dos totais", lucratividade: "Fora dos totais", iguais: true },
  { criterio: "Contratos ADMINISTRATIVO", geral: "Entram se tiverem NF", dashboard: "Entram se tiverem NF", faturamento: "Entram se tiverem NF", lucratividade: "Ficam de fora", iguais: false },
  { criterio: "Valor pendente", geral: "Líquido − pago − conta vinculada − pós-emissão dos itens", dashboard: "Igual ao Relatório Geral", faturamento: "Igual, com o total pós-emissão do cabeçalho; NF paga não tem saldo", lucratividade: "Não mostra", iguais: false },
  { criterio: "Valor executável", geral: "Um por contrato/mês COM nota N", dashboard: "Não mostra", faturamento: "Todos os contratos do recorte, mês a mês", lucratividade: "Todos os contratos do recorte, mês a mês", iguais: false },
  { criterio: "Despesas", geral: "Não mostra", dashboard: "Não mostra", faturamento: "Fluxo de Caixa por contrato", lucratividade: "Fluxo de Caixa por contrato (competência)", iguais: true },
];

export interface AlertaCriterio { id: string; texto: string; quantidade: number }

/** Quantas NFs do recorte caem em critérios que as telas tratam de forma diferente (para avisar antes de chamar de divergência). */
export function alertasDeCriterio(
  nfs: NfEmissaoRow[], contratoPorId: Map<string, { empresa_id: string }>,
): AlertaCriterio[] {
  let semContrato = 0, empresaDifere = 0, pagaComSaldo = 0;
  for (const n of nfs) {
    if (naoContabilizaKpi(n)) continue;
    const c = contratoPorId.get(n.contrato_id);
    if (!c) semContrato++;
    else if (c.empresa_id !== n.empresa_id) empresaDifere++;
    if (statusDaNota(n) === "pago" && (n.vlr_liquido_total || 0) - (n.valor_pago ?? 0) - (n.desconto_conta_vinculada || 0) - (Number(n.descontos_pos_emissao_total) || 0) > TOLERANCIA) pagaComSaldo++;
  }
  return [
    { id: "sem_contrato", texto: "NF cujo contrato não existe no cadastro: o Relatório mostra, o Faturamento da Empresa e a Lucratividade não.", quantidade: semContrato },
    { id: "empresa_difere", texto: "NF cuja empresa difere da empresa do contrato: o Relatório usa a da NF, o Faturamento e a Lucratividade usam a do contrato.", quantidade: empresaDifere },
    { id: "paga_com_saldo", texto: "NF paga (com data de pagamento) com valor pago menor que o devido: Relatório e Dashboard mostram saldo; o Faturamento zera.", quantidade: pagaComSaldo },
  ].filter((a) => a.quantidade > 0);
}
