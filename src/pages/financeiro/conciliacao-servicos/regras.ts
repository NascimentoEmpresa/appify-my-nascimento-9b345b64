// SIS-2026-0869: Conciliação Financeira do Relatório de Serviços.
// Compara, para o mesmo recorte (ano, competência, empresa, contrato, cliente, código, situação), o que três telas dizem do
// MESMO conjunto de NFs (nf_emissao):
//   • Relatório Geral (Relatório de Serviços)      → totaisDoRelatorio + valorPendenteNf
//   • Dashboard do Relatório de Serviços            → kpisDoDashboard (extraída do próprio Dashboard)
//   • Faturamento da Empresa (Controladoria)        → contaNoFaturamento + agruparFaturamento (aReceberDaNf)
// Cada fonte usa a SUA regra de inclusão e a SUA conta — é exatamente aí que as telas se afastam (NF sem contrato no cadastro,
// empresa da NF ≠ empresa do contrato, NF paga com saldo, descontos pós-emissão no cabeçalho × itens). Funções puras: a tela só
// junta as fontes. O fechamento por NF (`notas`) soma exatamente os agregados (há teste para isso).
import type { NfEmissaoItemRow, NfEmissaoRow } from "@/hooks/useNfEmissao";
import { TIPOS_NOTA } from "@/hooks/useNfEmissao";
import { foraDoRelatorio, naoContabilizaKpi, statusDaNota, valorPendenteNf, somaDescontosPosEmissao, type StatusNota } from "@/pages/financeiro/nf-emissao/shared";
import { aReceberDaNf, agruparFaturamento, contaNoFaturamento, totaisVazios } from "@/pages/controladoria/faturamento/regras";
import { totaisDoRelatorio } from "@/pages/financeiro/relatorio-servicos/totais";
import { kpisDoDashboard } from "@/pages/financeiro/relatorio-servicos/kpisDashboard";

export type FonteId = "geral" | "dashboard" | "faturamento";
export const FONTES: { id: FonteId; rotulo: string }[] = [
  { id: "geral", rotulo: "Relatório Geral" },
  { id: "dashboard", rotulo: "Dashboard" },
  { id: "faturamento", rotulo: "Faturamento da Empresa" },
];

export type Indicador = "bruto" | "liquido" | "recebido" | "pendente";
export const INDICADORES: { id: Indicador; rotulo: string }[] = [
  { id: "bruto", rotulo: "Faturamento Bruto" },
  { id: "liquido", rotulo: "Valor Líquido" },
  { id: "recebido", rotulo: "Valor Recebido" },
  { id: "pendente", rotulo: "Valor Pendente" },
];

export const TOLERANCIA = 0.005;
const r2 = (v: number) => Math.round(v * 100) / 100;

export interface FiltrosConciliacao {
  /** 0 = todos os anos */
  ano: number;
  /** "YYYY-MM" ou "" (todas) */
  competencia: string;
  empresaId: string;
  contratoId: string;
  cliente: string;
  /** Tipo da nota (N, R, M, DH) ou "" para todos */
  codigo: string;
  /** "" = todas */
  situacao: StatusNota | "";
}

export interface ContratoParaConciliacao {
  id: string;
  empresa_id: string;
  nome: string;
  cliente: string;
}

export interface EntradaConciliacao {
  nfs: NfEmissaoRow[];
  itensPorNf: Map<string, NfEmissaoItemRow[]> | undefined;
  contratoPorId: Map<string, ContratoParaConciliacao>;
  filtros: FiltrosConciliacao;
}

type Valores = Record<Indicador, number>;
const zerados = (): Valores => ({ bruto: 0, liquido: 0, recebido: 0, pendente: 0 });

export interface ValoresDaFonte extends Valores {
  incluida: boolean;
}

export interface NotaConciliacao {
  id: string;
  numero: string;
  contratoId: string;
  contratoNome: string;
  empresaId: string;
  /** "YYYY-MM" */
  competencia: string;
  status: StatusNota;
  fontes: Record<FonteId, ValoresDaFonte>;
  /** Maior − menor valor entre as fontes, por indicador. */
  dif: Valores;
  difTotal: number;
  divergente: boolean;
  motivos: string[];
}

export interface LinhaIndicador {
  id: Indicador;
  rotulo: string;
  valores: Record<FonteId, number>;
  /** Maior − menor entre as três fontes. */
  diferenca: number;
  /** Diferença sobre o Relatório Geral; null quando o Relatório Geral é zero. */
  variacaoPct: number | null;
  conciliado: boolean;
  /** Quem destoa da maioria (ou o único que difere): ajuda a apontar onde está o erro. */
  destoantes: FonteId[];
}

export interface GrupoConciliacao {
  chave: string;
  rotulo: string;
  notas: number;
  divergentes: number;
  dif: Valores;
  difTotal: number;
}

export interface ResultadoConciliacao {
  indicadores: LinhaIndicador[];
  notas: NotaConciliacao[];
  porCompetencia: GrupoConciliacao[];
  porContrato: GrupoConciliacao[];
  resumo: {
    indicadoresConciliados: number;
    indicadoresDivergentes: number;
    notasAvaliadas: number;
    notasDivergentes: number;
    notasConciliadas: number;
    diferencaTotal: number;
  };
}

export function codigosDoFiltro(codigo: string): string[] {
  return codigo ? [codigo] : Object.keys(TIPOS_NOTA);
}

// Recorte comum às três telas (ano pela competência; competência; contrato; código; situação).
function recorteComum(n: NfEmissaoRow, f: FiltrosConciliacao): boolean {
  if (f.ano && !n.competencia.startsWith(`${f.ano}-`)) return false;
  if (f.competencia && n.competencia.slice(0, 7) !== f.competencia) return false;
  if (f.contratoId && n.contrato_id !== f.contratoId) return false;
  if (f.codigo && n.tipo_nota !== f.codigo) return false;
  if (f.situacao && statusDaNota(n) !== f.situacao) return false;
  return true;
}

// Relatório Geral e Dashboard: empresa = a da NF; cliente = o do contrato embutido na NF.
function entraNoRelatorio(n: NfEmissaoRow, f: FiltrosConciliacao): boolean {
  if (foraDoRelatorio(n)) return false;
  if (f.empresaId && n.empresa_id !== f.empresaId) return false;
  if (f.cliente && n.contrato?.cliente !== f.cliente) return false;
  return true;
}

// Faturamento da Empresa: NF só entra se o contrato existe no cadastro; empresa e cliente são os do CONTRATO.
function entraNoFaturamento(n: NfEmissaoRow, f: FiltrosConciliacao, contratoPorId: Map<string, ContratoParaConciliacao>): boolean {
  if (!contaNoFaturamento(n, codigosDoFiltro(f.codigo))) return false;
  const c = contratoPorId.get(n.contrato_id);
  if (!c) return false;
  if (f.empresaId && c.empresa_id !== f.empresaId) return false;
  if (f.cliente && c.cliente !== f.cliente) return false;
  return true;
}

function difDe(fontes: Record<FonteId, ValoresDaFonte>): Valores {
  const dif = zerados();
  for (const { id } of INDICADORES) {
    const vs = FONTES.map((x) => fontes[x.id][id]);
    dif[id] = r2(Math.max(...vs) - Math.min(...vs));
  }
  return dif;
}

function motivosDaNota(
  n: NfEmissaoRow,
  fontes: Record<FonteId, ValoresDaFonte>,
  dif: Valores,
  itens: NfEmissaoItemRow[],
  contratoPorId: Map<string, ContratoParaConciliacao>,
  f: FiltrosConciliacao,
): string[] {
  const motivos: string[] = [];
  const { geral, dashboard, faturamento } = fontes;
  const fmt = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

  if (geral.incluida && !faturamento.incluida) {
    const c = contratoPorId.get(n.contrato_id);
    if (!c) motivos.push("Contrato da NF não existe no cadastro de contratos: fica fora do Faturamento da Empresa.");
    else if (f.empresaId && c.empresa_id !== f.empresaId && n.empresa_id === f.empresaId) motivos.push("A empresa da NF difere da empresa do contrato: o Faturamento da Empresa usa a do contrato.");
    else if (f.empresaId && c.empresa_id === f.empresaId && n.empresa_id !== f.empresaId) motivos.push("A empresa da NF difere da empresa do contrato: o Relatório usa a da NF.");
    else motivos.push("A NF não entra no Faturamento da Empresa (recorte diferente).");
  } else if (!geral.incluida && faturamento.incluida) {
    motivos.push("A NF entra no Faturamento da Empresa mas não no Relatório de Serviços (empresa/cliente da NF diferem do contrato).");
  }

  if (geral.incluida && faturamento.incluida && Math.abs(geral.pendente - faturamento.pendente) > TOLERANCIA) {
    const pos = somaDescontosPosEmissao(itens);
    const posCab = Number(n.descontos_pos_emissao_total) || 0;
    if (statusDaNota(n) === "pago" && geral.pendente > faturamento.pendente) {
      motivos.push(`NF paga (com data de pagamento) mas com valor pago menor que o devido: Relatório/Dashboard ainda mostram saldo de ${fmt(geral.pendente)}; o Faturamento da Empresa zera. Confira o valor pago ou a data de pagamento.`);
    } else if (Math.abs(pos - posCab) > TOLERANCIA) {
      motivos.push(`Descontos pós-emissão no cabeçalho da NF (${fmt(posCab)}) diferem da soma dos itens (${fmt(pos)}).`);
    } else {
      motivos.push("O saldo a receber é calculado de forma diferente entre as telas para esta NF.");
    }
  }

  if (geral.incluida && dashboard.incluida && (Math.abs(geral.pendente - dashboard.pendente) > TOLERANCIA || Math.abs(geral.bruto - dashboard.bruto) > TOLERANCIA)) {
    motivos.push("Relatório Geral e Dashboard calculam valores diferentes para esta NF.");
  }

  if (motivos.length === 0 && Object.values(dif).some((d) => d > TOLERANCIA)) motivos.push("Valores diferentes entre as telas.");
  return motivos;
}

function agrupar(notas: NotaConciliacao[], chaveDe: (n: NotaConciliacao) => string, rotuloDe: (n: NotaConciliacao) => string): GrupoConciliacao[] {
  const mapa = new Map<string, GrupoConciliacao>();
  for (const n of notas) {
    const chave = chaveDe(n);
    let g = mapa.get(chave);
    if (!g) {
      g = { chave, rotulo: rotuloDe(n), notas: 0, divergentes: 0, dif: zerados(), difTotal: 0 };
      mapa.set(chave, g);
    }
    g.notas += 1;
    if (n.divergente) g.divergentes += 1;
    for (const { id } of INDICADORES) g.dif[id] = r2(g.dif[id] + n.dif[id]);
    g.difTotal = r2(g.difTotal + n.difTotal);
  }
  return [...mapa.values()];
}

export function conciliar({ nfs, itensPorNf, contratoPorId, filtros }: EntradaConciliacao): ResultadoConciliacao {
  const itensDe = (n: NfEmissaoRow) => itensPorNf?.get(n.id) ?? [];

  // Universo de cada fonte, cada uma com a sua regra de inclusão.
  const doRecorte = nfs.filter((n) => recorteComum(n, filtros));
  const linhasRelatorio = doRecorte.filter((n) => entraNoRelatorio(n, filtros));
  const linhasFaturamento = doRecorte.filter((n) => entraNoFaturamento(n, filtros, contratoPorId));
  const idsRelatorio = new Set(linhasRelatorio.map((n) => n.id));
  const idsFaturamento = new Set(linhasFaturamento.map((n) => n.id));

  // Agregados — a conta de cada tela, chamada como a própria tela chama.
  const tRG = totaisDoRelatorio(linhasRelatorio, () => 0, (n) => valorPendenteNf(n, itensDe(n)));
  const kDB = kpisDoDashboard(linhasRelatorio, itensPorNf);
  const tFat = [...agruparFaturamento(linhasFaturamento, () => "tudo").values()][0] ?? totaisVazios();

  const agregado: Record<FonteId, Valores> = {
    geral: { bruto: tRG.faturado, liquido: tRG.liquido, recebido: tRG.recebido, pendente: tRG.pendente },
    dashboard: { bruto: r2(kDB.faturado), liquido: valoresLiquidoDashboard(linhasRelatorio), recebido: r2(kDB.recebido), pendente: r2(kDB.pendente) },
    faturamento: { bruto: r2(tFat.bruto), liquido: r2(tFat.liquido), recebido: r2(tFat.recebido), pendente: r2(tFat.aReceber) },
  };

  const indicadores: LinhaIndicador[] = INDICADORES.map(({ id, rotulo }) => {
    const valores = { geral: agregado.geral[id], dashboard: agregado.dashboard[id], faturamento: agregado.faturamento[id] };
    const lista = Object.values(valores);
    const diferenca = r2(Math.max(...lista) - Math.min(...lista));
    return {
      id,
      rotulo,
      valores,
      diferenca,
      variacaoPct: valores.geral !== 0 ? (diferenca / Math.abs(valores.geral)) * 100 : null,
      conciliado: diferenca < TOLERANCIA,
      destoantes: destoantesDe(valores),
    };
  });

  // Fechamento por NF: toda NF que conta em alguma das fontes.
  const notas: NotaConciliacao[] = [];
  for (const n of doRecorte) {
    const noRel = idsRelatorio.has(n.id);
    const noFat = idsFaturamento.has(n.id);
    if (!noRel && !noFat) continue;
    if (naoContabilizaKpi(n)) continue; // cancelada/substituída não entra em valor nenhum
    const itens = itensDe(n);
    const base: Valores = {
      bruto: n.vlr_bruto_total || 0,
      liquido: n.vlr_liquido_total || 0,
      recebido: n.valor_pago ?? 0,
      pendente: valorPendenteNf(n, itens),
    };
    const fat: Valores = { ...base, pendente: aReceberDaNf(n) };
    const vazio = (): ValoresDaFonte => ({ ...zerados(), incluida: false });
    const fontes: Record<FonteId, ValoresDaFonte> = {
      geral: noRel ? { ...base, incluida: true } : vazio(),
      dashboard: noRel ? { ...base, incluida: true } : vazio(),
      faturamento: noFat ? { ...fat, incluida: true } : vazio(),
    };
    const dif = difDe(fontes);
    const difTotal = r2(INDICADORES.reduce((s, i) => s + dif[i.id], 0));
    const c = contratoPorId.get(n.contrato_id);
    notas.push({
      id: n.id,
      numero: `${n.numero_nf ?? "s/n"}${n.variacao ? `-${n.variacao}` : ""}`,
      contratoId: n.contrato_id,
      contratoNome: n.contrato?.nome ?? c?.nome ?? "Sem contrato",
      empresaId: n.empresa_id,
      competencia: n.competencia.slice(0, 7),
      status: statusDaNota(n),
      fontes,
      dif,
      difTotal,
      divergente: difTotal >= TOLERANCIA,
      motivos: [],
    });
    const nota = notas[notas.length - 1];
    if (nota.divergente) nota.motivos = motivosDaNota(n, fontes, dif, itens, contratoPorId, filtros);
  }
  notas.sort((a, b) => b.difTotal - a.difTotal);

  const divergentes = notas.filter((n) => n.divergente).length;
  const indicadoresDivergentes = indicadores.filter((i) => !i.conciliado).length;
  return {
    indicadores,
    notas,
    porCompetencia: agrupar(notas, (n) => n.competencia, (n) => n.competencia).sort((a, b) => a.chave.localeCompare(b.chave)),
    porContrato: agrupar(notas, (n) => n.contratoId, (n) => n.contratoNome).sort((a, b) => b.difTotal - a.difTotal),
    resumo: {
      indicadoresConciliados: indicadores.length - indicadoresDivergentes,
      indicadoresDivergentes,
      notasAvaliadas: notas.length,
      notasDivergentes: divergentes,
      notasConciliadas: notas.length - divergentes,
      diferencaTotal: r2(notas.reduce((s, n) => s + n.difTotal, 0)),
    },
  };
}

// O Dashboard não exibe o líquido nos KPIs; a conta dele é a mesma do Relatório (soma de vlr_liquido_total das notas que contam).
function valoresLiquidoDashboard(linhas: NfEmissaoRow[]): number {
  return r2(linhas.reduce((s, n) => (naoContabilizaKpi(n) ? s : s + (n.vlr_liquido_total || 0)), 0));
}

// Quem destoa: com 3 fontes, a que ficou sozinha contra as outras duas iguais; se as três diferem, todas.
function destoantesDe(v: Record<FonteId, number>): FonteId[] {
  const ids = FONTES.map((f) => f.id);
  const iguais = (a: number, b: number) => Math.abs(a - b) < TOLERANCIA;
  if (iguais(v.geral, v.dashboard) && iguais(v.geral, v.faturamento)) return [];
  if (iguais(v.geral, v.dashboard)) return ["faturamento"];
  if (iguais(v.geral, v.faturamento)) return ["dashboard"];
  if (iguais(v.dashboard, v.faturamento)) return ["geral"];
  return ids;
}

// Para o teste de integridade e para quem precisa somar por NF.
export function somaPorFonte(notas: NotaConciliacao[]): Record<FonteId, Valores> {
  const out: Record<FonteId, Valores> = { geral: zerados(), dashboard: zerados(), faturamento: zerados() };
  for (const n of notas) for (const f of FONTES) for (const i of INDICADORES) out[f.id][i.id] = r2(out[f.id][i.id] + n.fontes[f.id][i.id]);
  return out;
}
