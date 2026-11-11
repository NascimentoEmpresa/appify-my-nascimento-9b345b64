// =====================================================================
// Operacional › Indicadores › INDICADORES POR CONTRATO (11/11/2026)
//
// Os 7 indicadores da Gerência Operacional, uma linha por contrato. Fontes
// e contas: mig 20261111100000 (ope_contratos_indicadores). Lucratividade e
// custo realizado vêm da conta de Controladoria › Faturamento da Empresa
// (montarLucratividade + custosPorContratoMes), a mesma de Lucratividade e
// Orçamento — a tela passa os dois prontos para cá.
//
// REGRAS DE DESTAQUE (pedido do Pablo para as TVs, vale aqui também: "ruim"
// só quando é verdadeiro; número de base pequena ou de mês sem lançamento
// não acusa ninguém):
//   · sem_fonte: o ERP não tem o dado — nunca vira zero;
//   · sem_dado: a fonte existe, mas não há base no mês (ex.: receita abaixo
//     de R$ 10 mil, custo não lançado, efetivo pequeno) — sem semáforo;
//   · ok / atencao / critico: só com base suficiente.
// =====================================================================

export type StatusInd = "ok" | "atencao" | "critico" | "sem_dado" | "sem_fonte";
export type Medida = "real" | "parcial";

export type ChaveInd = "postos" | "lucratividade" | "custo" | "glosas" | "faltas" | "turnover" | "reclamacoes";

export const INDICADORES: { chave: ChaveInd; titulo: string; curto: string; medida: Medida; pergunta: string }[] = [
  { chave: "postos", titulo: "Postos contratados x postos cobertos", curto: "Postos", medida: "real",
    pergunta: "Contratos que não entregam o quantitativo de postos vendido." },
  { chave: "lucratividade", titulo: "Lucratividade por contrato (%)", curto: "Lucratividade", medida: "real",
    pergunta: "Contratos com prejuízo ou margem abaixo da prevista na licitação." },
  { chave: "custo", titulo: "Custo direto acima do orçado (%)", curto: "Custo × orçado", medida: "real",
    pergunta: "Onde mão de obra, benefícios, insumos ou demais custos diretos passaram do orçamento." },
  { chave: "glosas", titulo: "Glosas por contrato", curto: "Glosas", medida: "real",
    pergunta: "Valor perdido, contrato afetado e principal causa." },
  { chave: "faltas", titulo: "Faltas por contrato (%)", curto: "Faltas", medida: "parcial",
    pergunta: "Onde as ausências comprometem a cobertura e elevam o custo operacional." },
  { chave: "turnover", titulo: "Turnover por contrato (%)", curto: "Turnover", medida: "real",
    pergunta: "Contratos com equipes instáveis e reposições frequentes." },
  { chave: "reclamacoes", titulo: "Reclamações ou baixa satisfação", curto: "Reclamações", medida: "parcial",
    pergunta: "Contratos com risco de desgaste, penalidade ou perda do cliente." },
];

// ── Limites (todos aqui, para a tela e o teste lerem do mesmo lugar) ──────
/** Receita mínima no mês para a margem valer (o mesmo piso da Lucratividade). */
export const PISO_RECEITA = 10_000;
/** Margem mínima quando a Planilha de Custo não traz o lucro previsto. */
export const MARGEM_PADRAO = 10;
/** Cobertura de postos abaixo disso é crítica; entre isso e 100%, atenção. */
export const COBERTURA_CRITICA = 95;
/** Custo realizado acima do orçado (acumulado no ano): atenção / crítico. */
export const CUSTO_ATENCAO = 5;
export const CUSTO_CRITICO = 10;
/** Atestados ÷ dias de trabalho do efetivo: atenção / crítico (meta da TV: ≤ 3%). */
export const FALTAS_ATENCAO = 3;
export const FALTAS_CRITICO = 5;
/** Efetivo mínimo para faltas e turnover terem semáforo. */
export const EFETIVO_MIN_FALTAS = 5;
export const EFETIVO_MIN_TURNOVER = 10;
/** Meta anual do Turn-over (relatório oficial): 41% no ano → por mês. */
export const TURNOVER_META_MES = Math.round((41 / 12) * 100) / 100;
/** Glosa acima desta fração da receita do mês é crítica. */
export const GLOSA_CRITICA_RECEITA = 0.02;
export const RECLAMACOES_CRITICO = 3;

// ── O que a RPC devolve ───────────────────────────────────────────────────
export interface ContratoRpc {
  id: string;
  nome: string;
  cliente: string | null;
  encerrado: boolean;
  postos: { contratados: number; previsto: number; implantado_registrado: boolean; cobertos: number; afastados: number } | null;
  efetivo: number;
  demissoes: number;
  atestados: { dias_pessoa: number; pessoas: number };
  glosas: { valor: number; qtd: number; causa: string | null };
  reclamacoes: { qtd: number; causa: string | null };
  orcado: { custo_direto_por_mes: Record<string, number>; margem_prevista: number | null } | null;
}

export interface DadosContratosRpc {
  competencia: string;
  de: string;
  ate: string;
  dias: number;
  janela_notificacoes: { de: string; ate: string };
  gerado_em: string;
  contratos: ContratoRpc[];
  sem_contrato: { glosas_valor: number; glosas_qtd: number; reclamacoes_qtd: number };
}

/** Receita e custo do Faturamento da Empresa (competência), por contrato. */
export interface Financeiro {
  receita: number;
  custo: number;
}

export interface EntradaFinanceira {
  /** null = sem acesso ao Faturamento/Fluxo de Caixa ou ainda carregando. */
  doMes: Map<string, Financeiro> | null;
  /** Custo realizado por "contratoId|YYYY-MM" (Despesas do Faturamento). null = idem. */
  custoPorMes: Map<string, number> | null;
}

export interface ResultadoInd {
  status: StatusInd;
  /** Número principal (%, R$ ou quantidade); null quando não há. */
  valor: number | null;
  /** O que a célula mostra. */
  texto: string;
  /** Linha de baixo / dica: base, causa, meta. */
  detalhe: string;
  /** Quanto maior, pior (para ordenar pela coluna). null = vai para o fim. */
  peso: number | null;
}

export interface LinhaContrato {
  id: string;
  nome: string;
  cliente: string | null;
  ind: Record<ChaveInd, ResultadoInd>;
  criticos: number;
  atencoes: number;
  /** Gravidade geral: crítico vale 3, atenção 1. */
  gravidade: number;
}

// ── Formatação ────────────────────────────────────────────────────────────
const pct1 = (v: number) => `${v.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const r1 = (v: number) => Math.round(v * 10) / 10;
const semFonte = (detalhe: string): ResultadoInd => ({ status: "sem_fonte", valor: null, texto: "sem fonte", detalhe, peso: null });
const semDado = (detalhe: string, texto = "—"): ResultadoInd => ({ status: "sem_dado", valor: null, texto, detalhe, peso: null });

// ── 1. Postos ─────────────────────────────────────────────────────────────
export function indPostos(c: ContratoRpc): ResultadoInd {
  const p = c.postos;
  if (!p || !(p.contratados > 0)) return semFonte("Sem posto implantado na Planilha de Custo");
  const cobertura = r1((p.cobertos / p.contratados) * 100);
  const falta = Math.max(p.contratados - p.cobertos, 0);
  const status: StatusInd = falta === 0 ? "ok" : cobertura >= COBERTURA_CRITICA ? "atencao" : "critico";
  const afast = p.afastados > 0 ? ` · ${p.afastados} afastado(s)` : "";
  return {
    status, valor: cobertura,
    texto: `${p.cobertos} de ${p.contratados}`,
    detalhe: falta > 0 ? `Faltam ${falta} posto(s) · ${pct1(cobertura)} coberto${afast}` : `100% coberto${afast}`,
    peso: falta > 0 ? 100 - cobertura : 0,
  };
}

// ── 2. Lucratividade ──────────────────────────────────────────────────────
export function indLucratividade(c: ContratoRpc, fin: Financeiro | undefined, comAcesso: boolean): ResultadoInd {
  if (!comAcesso) return semFonte("Sem acesso ao Faturamento da Empresa / Fluxo de Caixa");
  if (!fin || fin.receita <= 0) return semDado("Sem nota na competência");
  if (fin.receita < PISO_RECEITA) return semDado(`Receita abaixo de ${brl(PISO_RECEITA)} no mês`);
  if (!(fin.custo > 0)) return semDado("Sem despesa lançada no Fluxo de Caixa", "sem custo");
  const margem = r1(((fin.receita - fin.custo) / fin.receita) * 100);
  const prevista = c.orcado?.margem_prevista ?? null;
  const meta = prevista ?? MARGEM_PADRAO;
  const rotuloMeta = prevista != null ? `prevista na licitação ${pct1(prevista)}` : `mínimo de ${MARGEM_PADRAO}% (sem lucro na Planilha)`;
  const status: StatusInd = margem < 0 ? "critico" : margem < meta ? "atencao" : "ok";
  return {
    status, valor: margem, texto: pct1(margem),
    detalhe: `${margem < 0 ? "Prejuízo" : "Lucro"} de ${brl(fin.receita - fin.custo)} · ${rotuloMeta}`,
    peso: meta - margem,
  };
}

// ── 3. Custo direto × orçado (acumulado no ano até a competência) ─────────
export function indCusto(c: ContratoRpc, competencia: string, custoPorMes: Map<string, number> | null): ResultadoInd {
  if (!c.orcado || !Object.keys(c.orcado.custo_direto_por_mes).length) return semFonte("Sem Planilha de Custo executada (orçado)");
  if (!custoPorMes) return semFonte("Sem acesso às despesas do Fluxo de Caixa");
  const ano = competencia.slice(0, 4);
  let orcado = 0;
  let real = 0;
  let meses = 0;
  for (const [mes, o] of Object.entries(c.orcado.custo_direto_por_mes)) {
    if (!mes.startsWith(ano) || mes > competencia || !(o > 0)) continue;
    const r = custoPorMes.get(`${c.id}|${mes}`) ?? 0;
    // Mês sem despesa lançada não é "custo abaixo do orçado": fica de fora.
    if (!(r > 0)) continue;
    orcado += o;
    real += r;
    meses++;
  }
  if (!meses) return semDado("Sem despesa lançada no ano para comparar", "sem custo");
  const desvio = r1(((real - orcado) / orcado) * 100);
  const status: StatusInd = desvio > CUSTO_CRITICO ? "critico" : desvio > CUSTO_ATENCAO ? "atencao" : "ok";
  return {
    status, valor: desvio,
    texto: `${desvio > 0 ? "+" : ""}${pct1(desvio)}`,
    detalhe: `${brl(real)} realizado × ${brl(orcado)} orçado · ${meses} ${meses === 1 ? "mês" : "meses"} de ${ano}`,
    peso: desvio,
  };
}

// ── 4. Glosas ─────────────────────────────────────────────────────────────
export function indGlosas(c: ContratoRpc, fin: Financeiro | undefined): ResultadoInd {
  const g = c.glosas;
  if (!(g.qtd > 0)) return { status: "ok", valor: 0, texto: brl(0), detalhe: "Nenhuma glosa nos últimos 90 dias", peso: 0 };
  const critica = !!fin && fin.receita > 0 && g.valor >= fin.receita * GLOSA_CRITICA_RECEITA;
  return {
    status: critica ? "critico" : "atencao",
    valor: g.valor, texto: brl(g.valor),
    detalhe: `${g.qtd} glosa(s) em 90 dias${g.causa ? ` · ${g.causa}` : ""}`,
    peso: g.valor,
  };
}

// ── 5. Faltas (atestados) ─────────────────────────────────────────────────
export function indFaltas(c: ContratoRpc, dias: number): ResultadoInd {
  if (c.efetivo < EFETIVO_MIN_FALTAS || !(dias > 0)) return semDado(`Efetivo abaixo de ${EFETIVO_MIN_FALTAS} pessoas`);
  const pct = r1((c.atestados.dias_pessoa / (c.efetivo * dias)) * 100);
  const status: StatusInd = pct > FALTAS_CRITICO ? "critico" : pct > FALTAS_ATENCAO ? "atencao" : "ok";
  return {
    status, valor: pct, texto: pct1(pct),
    detalhe: `${c.atestados.dias_pessoa} dia(s) de atestado · ${c.atestados.pessoas} pessoa(s) · efetivo ${c.efetivo}`,
    peso: pct,
  };
}

// ── 6. Turnover (mês) ─────────────────────────────────────────────────────
export function indTurnover(c: ContratoRpc): ResultadoInd {
  if (c.efetivo < EFETIVO_MIN_TURNOVER) return semDado(`Efetivo abaixo de ${EFETIVO_MIN_TURNOVER} pessoas`);
  const pct = r1((c.demissoes / c.efetivo) * 100);
  // Uma demissão sozinha não é "equipe instável".
  const status: StatusInd = c.demissoes < 2 || pct <= TURNOVER_META_MES ? "ok"
    : pct > TURNOVER_META_MES * 2 ? "critico" : "atencao";
  return {
    status, valor: pct, texto: pct1(pct),
    detalhe: `${c.demissoes} demissão(ões) · efetivo ${c.efetivo} · meta ${pct1(TURNOVER_META_MES)}/mês`,
    peso: pct,
  };
}

// ── 7. Reclamações ────────────────────────────────────────────────────────
export function indReclamacoes(c: ContratoRpc): ResultadoInd {
  const r = c.reclamacoes;
  if (!(r.qtd > 0)) return { status: "ok", valor: 0, texto: "0", detalhe: "Nenhuma notificação do cliente em 90 dias · satisfação sem fonte", peso: 0 };
  return {
    status: r.qtd >= RECLAMACOES_CRITICO ? "critico" : "atencao",
    valor: r.qtd, texto: String(r.qtd),
    detalhe: `${r.qtd} notificação(ões) em 90 dias${r.causa ? ` · ${r.causa}` : ""} · satisfação sem fonte`,
    peso: r.qtd,
  };
}

// ── Montagem ──────────────────────────────────────────────────────────────
export function montarLinhas(d: DadosContratosRpc, fin: EntradaFinanceira): LinhaContrato[] {
  const comAcesso = fin.doMes != null;
  return d.contratos.map((c) => {
    const f = fin.doMes?.get(c.id);
    const ind: Record<ChaveInd, ResultadoInd> = {
      postos: indPostos(c),
      lucratividade: indLucratividade(c, f, comAcesso),
      custo: indCusto(c, d.competencia, fin.custoPorMes),
      glosas: indGlosas(c, f),
      faltas: indFaltas(c, d.dias),
      turnover: indTurnover(c),
      reclamacoes: indReclamacoes(c),
    };
    const vals = Object.values(ind);
    const criticos = vals.filter((v) => v.status === "critico").length;
    const atencoes = vals.filter((v) => v.status === "atencao").length;
    return { id: c.id, nome: c.nome, cliente: c.cliente, ind, criticos, atencoes, gravidade: criticos * 3 + atencoes };
  });
}

export const foraDoEsperado = (s: StatusInd) => s === "critico" || s === "atencao";

export type Ordem = "pior" | "nome" | ChaveInd;

/** Pior primeiro: gravidade, depois críticos, depois nome. Por coluna: peso, sem número no fim. */
export function ordenar(linhas: LinhaContrato[], ordem: Ordem): LinhaContrato[] {
  const porNome = (a: LinhaContrato, b: LinhaContrato) => a.nome.localeCompare(b.nome, "pt-BR");
  const out = [...linhas];
  if (ordem === "nome") return out.sort(porNome);
  if (ordem === "pior") return out.sort((a, b) => b.gravidade - a.gravidade || b.criticos - a.criticos || porNome(a, b));
  const rank = (s: StatusInd) => (s === "critico" ? 2 : s === "atencao" ? 1 : 0);
  return out.sort((a, b) => {
    const x = a.ind[ordem];
    const y = b.ind[ordem];
    if ((x.peso == null) !== (y.peso == null)) return x.peso == null ? 1 : -1;
    return rank(y.status) - rank(x.status) || (y.peso ?? 0) - (x.peso ?? 0) || porNome(a, b);
  });
}

export interface Filtro {
  busca: string;
  /** null = todos; "algum" = qualquer indicador fora; ou um indicador. */
  fora: null | "algum" | ChaveInd;
}

const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export function filtrar(linhas: LinhaContrato[], f: Filtro): LinhaContrato[] {
  const termo = semAcento(f.busca.trim());
  return linhas.filter((l) => {
    if (termo && !semAcento(`${l.nome} ${l.cliente ?? ""}`).includes(termo)) return false;
    if (f.fora === "algum") return l.gravidade > 0;
    if (f.fora) return foraDoEsperado(l.ind[f.fora].status);
    return true;
  });
}

export interface ResumoInd {
  chave: ChaveInd;
  criticos: number;
  atencoes: number;
  ok: number;
  semBase: number;
  semFonte: number;
}

export function resumir(linhas: LinhaContrato[]): ResumoInd[] {
  return INDICADORES.map(({ chave }) => {
    const r: ResumoInd = { chave, criticos: 0, atencoes: 0, ok: 0, semBase: 0, semFonte: 0 };
    for (const l of linhas) {
      const s = l.ind[chave].status;
      if (s === "critico") r.criticos++;
      else if (s === "atencao") r.atencoes++;
      else if (s === "ok") r.ok++;
      else if (s === "sem_dado") r.semBase++;
      else r.semFonte++;
    }
    return r;
  });
}
