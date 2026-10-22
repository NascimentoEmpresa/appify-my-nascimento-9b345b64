// =====================================================================
// OPERACIONAL › EFETIVIDADE E COBERTURAS › 6. EFETIVIDADE MENSAL — o
// painel dos contratos mês a mês (21/10/2026, pedido do Pablo). Lógica pura,
// testada em src/test/efetividade-mensal.test.ts.
//
// NÃO há segunda regra de cálculo aqui: cada dia de cada colaborador passa
// por avaliarTodos() de src/lib/efetividade.ts (a mesma do Painel do Dia e do
// Histórico), e a efetividade é a de resumir(): presentes ÷ (previsto −
// aguardando). Este arquivo só recorta o mês, soma os dias por colaborador,
// filtra, agrupa e monta o Excel.
//
// O RECORTE DO MÊS:
//   · mês fechado → o mês inteiro (setembro = 01/09 a 30/09);
//   · mês corrente → do dia 1 até ONTEM — o dia de hoje ainda não tem os
//     pontos (a Senior importa com atraso; ver regra 5 da lib do dia). Em
//     21/10, outubro = 01/10 a 20/10. No dia 1º o mês corrente ainda não tem
//     nenhum dia apurado: o painel abre no mês anterior.
//   · mês futuro → nada.
// =====================================================================

import * as XLSX from "xlsx";
import {
  avaliarTodos, chaveContrato, chavePosto, descoberto, diasEntre, difDias, fecharResumo, resumir, somaDias,
  RESUMO_VAZIO, ROTULO_TURNO,
  type ColaboradorPrep, type ContratoEfet, type DiaEfet, type Ocorrencia, type Resumo, type Turno,
} from "@/lib/efetividade";

// ---- Recorte do mês -------------------------------------------------------------

export interface RecorteMes {
  /** AAAA-MM */
  mes: string;
  ini: string;
  fim: string;
  /** Mês já terminou (o recorte é o mês inteiro). */
  fechado: boolean;
  dias: number;
}

const RE_MES = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Último dia do mês (AAAA-MM-DD). */
export function ultimoDiaDoMes(mes: string): string {
  const [a, m] = mes.split("-").map(Number);
  return new Date(Date.UTC(a, m, 0)).toISOString().slice(0, 10);
}

/**
 * O período apurado de um mês, visto de `hoje` (AAAA-MM-DD, horário de
 * Brasília). null = mês futuro, ou o mês corrente no dia 1º (nada apurado).
 */
export function recorteDoMes(mes: string, hoje: string): RecorteMes | null {
  if (!RE_MES.test(mes)) return null;
  const ini = `${mes}-01`;
  const mesHoje = hoje.slice(0, 7);
  if (mes > mesHoje) return null;
  const fim = mes < mesHoje ? ultimoDiaDoMes(mes) : somaDias(hoje, -1);
  if (fim < ini) return null;
  return { mes, ini, fim, fechado: mes < mesHoje, dias: difDias(fim, ini) + 1 };
}

/** O mês que o painel abre: o corrente, ou o anterior no dia 1º. */
export const mesPadrao = (hoje: string) => somaDias(hoje, -1).slice(0, 7);

export function somaMeses(mes: string, n: number): string {
  const [a, m] = mes.split("-").map(Number);
  const t = a * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
}

/** Os `n` meses que terminam em `mes`, do mais antigo ao mais novo. */
export const mesesAte = (mes: string, n: number) => Array.from({ length: n }, (_, i) => somaMeses(mes, i - n + 1));

const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
/** "2026-10" → "out/2026" */
export const rotuloMes = (mes: string) => `${MESES[+mes.slice(5, 7) - 1].slice(0, 3)}/${mes.slice(0, 4)}`;
/** "2026-10" → "Outubro de 2026" */
export const nomeMes = (mes: string) => { const n = MESES[+mes.slice(5, 7) - 1]; return `${n[0].toUpperCase()}${n.slice(1)} de ${mes.slice(0, 4)}`; };
const dataBR = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;

// ---- Apuração (um colaborador × o mês) ------------------------------------------

export interface ApuracaoColab {
  p: ColaboradorPrep;
  /** Os dias do recorte em que a pessoa estava no contrato. */
  dias: DiaEfet[];
  resumo: Resumo;
  coberturas: number;
  emAndamento: number;
  descobertos: number;
  /** Dias com falta (AAAA-MM-DD). */
  faltasEm: string[];
}

/**
 * Avalia o mês dia a dia com a regra do Painel do Dia (avaliarTodos: inclui
 * a falta avisada à mão e o estado da cobertura) e soma por colaborador.
 */
export function apurarMes(preps: ColaboradorPrep[], ini: string, fim: string, sincronizadoAte: string | null, ocorrencias: Ocorrencia[]): ApuracaoColab[] {
  const acc = preps.map((p) => ({ p, dias: [] as DiaEfet[], coberturas: 0, emAndamento: 0, descobertos: 0, faltasEm: [] as string[] }));
  const ocs = ocorrencias.filter((o) => o.data >= ini && o.data <= fim);
  for (const data of diasEntre(ini, fim)) {
    // avaliarTodos devolve na ordem de `preps`: o índice casa com `acc`.
    avaliarTodos(preps, data, sincronizadoAte, ocs).forEach((l, i) => {
      if (l.dia.situacao === "fora_contrato") return;
      const a = acc[i];
      a.dias.push(l.dia);
      if (l.dia.situacao === "falta") a.faltasEm.push(data);
      if (l.cobertura === "coberto") a.coberturas++;
      else if (l.cobertura === "em_andamento") a.emAndamento++;
      if (descoberto(l)) a.descobertos++;
    });
  }
  return acc.filter((a) => a.dias.length > 0).map((a) => ({ ...a, resumo: resumir(a.dias) }));
}

/**
 * O que das ocorrências mexe na apuração de um mês (motivo e status de cada
 * uma do período). Igual → não precisa reavaliar o mês.
 */
export function assinaturaOcorrencias(ocorrencias: Ocorrencia[], r: { ini: string; fim: string }): string {
  return ocorrencias.filter((o) => o.data >= r.ini && o.data <= r.fim)
    .map((o) => `${o.id}:${o.data}:${o.empregado_id ?? ""}:${o.motivo}:${o.status}`).sort().join("|");
}

/** Soma resumos — dá o mesmo que resumir() sobre todos os dias juntos. */
export function somarResumos(rs: Resumo[]): Resumo {
  const t: Resumo = { ...RESUMO_VAZIO };
  for (const r of rs) {
    t.presentes += r.presentes; t.faltas += r.faltas; t.atestados += r.atestados;
    t.afastamentos += r.afastamentos; t.ferias += r.ferias; t.folgas += r.folgas; t.aguardando += r.aguardando;
    t.semRegistro += r.semRegistro; t.atrasos += r.atrasos;
  }
  // Previsto, efetividade e "aguardando apuração" pela mesma conta do dia.
  return fecharResumo(t);
}

// ---- Faixa (mesmos cortes do statusContrato / CelulaPct) ------------------------

export type FaixaEfet = "normal" | "atencao" | "critico" | "sem_dados";
export const ROTULO_FAIXA: Record<FaixaEfet, string> = {
  normal: "≥ 95% (meta)", atencao: "91% a 95%", critico: "< 91%", sem_dados: "Sem efetivo previsto",
};
export function faixaEfetividade(ef: number | null | undefined): FaixaEfet {
  if (ef == null) return "sem_dados";
  if (ef >= 0.95) return "normal";
  if (ef >= 0.91) return "atencao";
  return "critico";
}

// ---- Filtros -------------------------------------------------------------------

export interface FiltrosMensal {
  /** Nomes de contrato ("Nome Filial"); vazio = todos. */
  contratos: string[];
  empresa: string | null;      // código da empresa
  encarregado: string | null;  // EMPREGADOS."ID" do encarregado
  posto: string | null;        // chavePosto
  turno: Turno | null;
  cargo: string | null;
  /** Faixa da efetividade DO CONTRATO no mês. */
  faixa: FaixaEfet | null;
  busca: string;
}

export const FILTROS_VAZIOS: FiltrosMensal = { contratos: [], empresa: null, encarregado: null, posto: null, turno: null, cargo: null, faixa: null, busca: "" };

const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
// Chave de busca por colaborador, normalizada uma vez (a busca roda a cada tecla, em todos os meses).
const chavesBusca = new WeakMap<ApuracaoColab, string>();
const chaveBusca = (a: ApuracaoColab) => {
  let k = chavesBusca.get(a);
  if (k == null) { k = semAcento(`${a.p.c.nome} ${a.p.c.cadastro ?? ""}`); chavesBusca.set(a, k); }
  return k;
};

export function filtrarApuracao(ap: ApuracaoColab[], f: FiltrosMensal, contratos: Map<string, ContratoEfet>): ApuracaoColab[] {
  const q = semAcento(f.busca.trim());
  const base = ap.filter((a) => {
    const { p } = a; const { c } = p;
    if (f.contratos.length && !f.contratos.includes(c.contrato)) return false;
    if (f.empresa && String(c.empresa) !== f.empresa) return false;
    if (f.posto && chavePosto(c) !== f.posto) return false;
    if (f.turno && p.turno !== f.turno) return false;
    if (f.cargo && (c.cargo ?? "") !== f.cargo) return false;
    if (f.encarregado && !contratos.get(chaveContrato(c.empresa, c.filial))?.encarregados.some((e) => String(e.id) === f.encarregado)) return false;
    if (q && !chaveBusca(a).includes(q)) return false;
    return true;
  });
  if (!f.faixa) return base;
  // A faixa é do contrato (no recorte já filtrado): fica quem está num contrato da faixa.
  const porContrato = new Map<string, Resumo[]>();
  for (const a of base) {
    const k = chaveContrato(a.p.c.empresa, a.p.c.filial);
    if (!porContrato.has(k)) porContrato.set(k, []);
    porContrato.get(k)!.push(a.resumo);
  }
  const ok = new Set([...porContrato].filter(([, rs]) => faixaEfetividade(somarResumos(rs).efetividade) === f.faixa).map(([k]) => k));
  return base.filter((a) => ok.has(chaveContrato(a.p.c.empresa, a.p.c.filial)));
}

// ---- Agrupamentos --------------------------------------------------------------

export interface LinhaAgregada extends Resumo {
  chave: string;
  rotulo: string;
  colaboradores: number;
  coberturas: number;
  emAndamento: number;
  descobertos: number;
  faixa: FaixaEfet;
  itens: ApuracaoColab[];
}

export function agregarPor(ap: ApuracaoColab[], chave: (a: ApuracaoColab) => string, rotulo: (a: ApuracaoColab) => string): LinhaAgregada[] {
  const m = new Map<string, ApuracaoColab[]>();
  for (const a of ap) {
    const k = chave(a);
    if (!m.has(k)) m.set(k, []);
    m.get(k)!.push(a);
  }
  return [...m].map(([k, itens]) => {
    const r = somarResumos(itens.map((i) => i.resumo));
    return {
      ...r, chave: k, rotulo: rotulo(itens[0]), colaboradores: itens.length,
      coberturas: itens.reduce((s, i) => s + i.coberturas, 0),
      emAndamento: itens.reduce((s, i) => s + i.emAndamento, 0),
      descobertos: itens.reduce((s, i) => s + i.descobertos, 0),
      faixa: faixaEfetividade(r.efetividade), itens,
    };
  });
}

export const porContrato = (ap: ApuracaoColab[]) => agregarPor(ap, (a) => chaveContrato(a.p.c.empresa, a.p.c.filial), (a) => a.p.c.contrato);
export const porPosto = (ap: ApuracaoColab[]) => agregarPor(ap, (a) => chavePosto(a.p.c), (a) => a.p.c.posto_nome);

export interface TotalMes extends Resumo { coberturas: number; descobertos: number; colaboradores: number }
export function totalDoMes(ap: ApuracaoColab[]): TotalMes {
  return {
    ...somarResumos(ap.map((a) => a.resumo)),
    coberturas: ap.reduce((s, a) => s + a.coberturas, 0),
    descobertos: ap.reduce((s, a) => s + a.descobertos, 0),
    colaboradores: ap.length,
  };
}

/** Uma linha por dia do recorte (para o gráfico diário e a aba "Por dia"). */
export function serieDoMes(ap: ApuracaoColab[], ini: string, fim: string): (Resumo & { data: string })[] {
  const m = new Map<string, DiaEfet[]>(diasEntre(ini, fim).map((d) => [d, []]));
  for (const a of ap) for (const d of a.dias) m.get(d.data)?.push(d);
  return [...m].map(([data, ds]) => ({ data, ...resumir(ds) }));
}

// ---- Excel --------------------------------------------------------------------

export interface DadosPlanilha {
  recorte: RecorteMes;
  sincronizadoAte: string | null;
  /** Os filtros em texto ("Contratos: A, B"), para a aba Resumo. */
  filtrosTexto: string[];
  apuracao: ApuracaoColab[];
  contratos: Map<string, ContratoEfet>;
  /** Evolução dos meses carregados (o filtro aplicado em cada um). */
  evolucao: { recorte: RecorteMes; total: TotalMes }[];
  geradoEm?: Date;
}

const COLS_RESUMO = ["Efetivo previsto (dias-pessoa)", "Presentes", "Faltas", "Atestados", "Afastamentos", "Férias", "Folgas", "Aguardando apuração", "Sem registro de ponto", "Atrasos"];
const valoresResumo = (r: Resumo) => [r.previsto - r.aguardando, r.presentes, r.faltas, r.atestados, r.afastamentos, r.ferias, r.folgas, r.aguardando, r.semRegistro, r.atrasos];
const FORMATO_PCT = "0.0%";
/** faltas ÷ efetivo previsto (o mesmo denominador da efetividade). */
export const taxaFaltas = (r: Resumo) => (r.previsto - r.aguardando > 0 ? r.faltas / (r.previsto - r.aguardando) : null);

/** Folha com cabeçalho, filtro automático, largura pelo conteúdo e % nas colunas indicadas. */
function folha(cab: string[], linhas: (string | number | null)[][], colsPct: number[] = []): XLSX.WorkSheet {
  const ws = XLSX.utils.aoa_to_sheet([cab, ...linhas]);
  for (let r = 1; r <= linhas.length; r++) for (const c of colsPct) {
    const cel = ws[XLSX.utils.encode_cell({ r, c })];
    if (cel && typeof cel.v === "number") cel.z = FORMATO_PCT;
  }
  ws["!cols"] = cab.map((h, c) => ({ wch: Math.min(60, Math.max(h.length, ...linhas.slice(0, 500).map((l) => String(l[c] ?? "").length)) + 2) }));
  if (linhas.length) ws["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: linhas.length, c: cab.length - 1 } }) };
  return ws;
}

export function montarPlanilhaEfetividade(d: DadosPlanilha): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  const { recorte, apuracao: ap, contratos } = d;
  const t = totalDoMes(ap);
  const contratoDe = (a: ApuracaoColab) => contratos.get(chaveContrato(a.p.c.empresa, a.p.c.filial));
  const encarregados = (a: ApuracaoColab) => (contratoDe(a)?.encarregados ?? []).map((e) => e.nome).join(", ");
  const empresa = (a: ApuracaoColab) => contratoDe(a)?.empresa_nome ?? String(a.p.c.empresa);
  const contr = porContrato(ap).sort((a, b) => a.rotulo.localeCompare(b.rotulo, "pt-BR"));
  const nFaixa = (x: FaixaEfet) => contr.filter((l) => l.faixa === x).length;

  // Resumo
  const resumo: (string | number | null)[][] = [
    ["Relatório de Efetividade dos Contratos", ""],
    ["Mês", nomeMes(recorte.mes)],
    ["Período apurado", `${dataBR(recorte.ini)} a ${dataBR(recorte.fim)}${recorte.fechado ? " (mês fechado)" : " (mês corrente, até ontem)"}`],
    ["Ponto da Senior sincronizado até", d.sincronizadoAte ? dataBR(d.sincronizadoAte) : "—"],
    ["Gerado em", (d.geradoEm ?? new Date()).toLocaleString("pt-BR")],
    ["Filtros", d.filtrosTexto.length ? d.filtrosTexto.join(" · ") : "Nenhum (todos os contratos)"],
    ["", ""],
    ["Efetividade", t.efetividade],
    ["Contratos", contr.length],
    ...(["normal", "atencao", "critico", "sem_dados"] as FaixaEfet[]).map((x) => [`   ${ROTULO_FAIXA[x]}`, nFaixa(x)]),
    ["Colaboradores", t.colaboradores],
    ...COLS_RESUMO.map((c, i) => [c, valoresResumo(t)[i]]),
    ["Coberturas realizadas", t.coberturas],
    ["Postos descobertos (dias)", t.descobertos],
    ["Taxa de faltas", taxaFaltas(t)],
    ["", ""],
    ["Efetividade = presentes ÷ efetivo previsto. Efetivo previsto = presentes + faltas + atestados (os dias aguardando apuração do ponto não entram); férias, afastamentos longos (INSS, licença), folgas e sem registro de ponto também não.", ""],
  ];
  const wsResumo = XLSX.utils.aoa_to_sheet(resumo);
  resumo.forEach((l, r) => {
    const cel = wsResumo[XLSX.utils.encode_cell({ r, c: 1 })];
    if ((l[0] === "Efetividade" || l[0] === "Taxa de faltas") && cel && typeof cel.v === "number") cel.z = FORMATO_PCT;
  });
  wsResumo["!cols"] = [{ wch: 34 }, { wch: 60 }];
  XLSX.utils.book_append_sheet(wb, wsResumo, "Resumo");

  // Contratos
  const cabAgg = (antes: string[]) => [...antes, "Colaboradores", ...COLS_RESUMO, "Coberturas", "Descobertos", "Taxa de faltas", "Efetividade", "Faixa"];
  const valAgg = (l: LinhaAgregada) => [l.colaboradores, ...valoresResumo(l), l.coberturas, l.descobertos, taxaFaltas(l), l.efetividade, ROTULO_FAIXA[l.faixa]];
  const pctAgg = (cab: string[]) => [cab.length - 3, cab.length - 2];
  const cabC = cabAgg(["Contrato", "Empresa", "Encarregado(s)"]);
  XLSX.utils.book_append_sheet(wb, folha(cabC, contr.map((l) => [l.rotulo, empresa(l.itens[0]), encarregados(l.itens[0]), ...valAgg(l)]), pctAgg(cabC)), "Contratos");

  // Postos
  const post = porPosto(ap).sort((a, b) => a.itens[0].p.c.contrato.localeCompare(b.itens[0].p.c.contrato, "pt-BR") || a.rotulo.localeCompare(b.rotulo, "pt-BR"));
  const cabP = cabAgg(["Contrato", "Código do posto", "Posto"]);
  XLSX.utils.book_append_sheet(wb, folha(cabP, post.map((l) => [l.itens[0].p.c.contrato, l.itens[0].p.c.posto_codigo ?? "", l.rotulo, ...valAgg(l)]), pctAgg(cabP)), "Postos");

  // Colaboradores
  const cabCol = ["Cadastro", "Nome", "Cargo", "Situação", "Empresa", "Contrato", "Encarregado(s)", "Posto", "Turno", "Escala", ...COLS_RESUMO, "Coberturas", "Descobertos", "Efetividade", "Dias de falta"];
  const cols = [...ap].sort((a, b) => a.p.c.contrato.localeCompare(b.p.c.contrato, "pt-BR") || a.p.c.nome.localeCompare(b.p.c.nome, "pt-BR"));
  XLSX.utils.book_append_sheet(wb, folha(cabCol, cols.map((a) => [
    a.p.c.cadastro == null ? "" : String(a.p.c.cadastro), a.p.c.nome, a.p.c.cargo ?? "", a.p.c.situacao ?? "", empresa(a), a.p.c.contrato, encarregados(a),
    a.p.c.posto_nome, ROTULO_TURNO[a.p.turno], a.p.c.escala?.descricao ?? "",
    ...valoresResumo(a.resumo), a.coberturas, a.descobertos, a.resumo.efetividade,
    a.faltasEm.map((x) => x.slice(8, 10) + "/" + x.slice(5, 7)).join(", "),
  ]), [cabCol.length - 2]), "Colaboradores");

  // Por dia
  const cabDia = ["Data", ...COLS_RESUMO, "Efetividade"];
  XLSX.utils.book_append_sheet(wb, folha(cabDia, serieDoMes(ap, recorte.ini, recorte.fim).map((s) => [dataBR(s.data), ...valoresResumo(s), s.efetividade]), [cabDia.length - 1]), "Por dia");

  // Evolução mensal
  if (d.evolucao.length) {
    const cabEv = ["Mês", "Período", ...COLS_RESUMO, "Coberturas", "Descobertos", "Efetividade"];
    XLSX.utils.book_append_sheet(wb, folha(cabEv, d.evolucao.map(({ recorte: r, total: x }) => [
      rotuloMes(r.mes), `${dataBR(r.ini)} a ${dataBR(r.fim)}`, ...valoresResumo(x), x.coberturas, x.descobertos, x.efetividade,
    ]), [cabEv.length - 1]), "Evolução mensal");
  }
  return wb;
}
