// =====================================================================
// BONIFICAÇÃO COLETIVA POR NOTA DA EQUIPE — regras de cálculo (puras).
//
// Especificação: protótipo Painel_ERP_Bonificacao_Coletiva.html (05/11/2026).
// Banco: mig 20261105004700 (BONIFICACAO_DEV_PERIODO / _ENTREGA e a RPC
// bonificacao_dev_entregas). Tela: src/pages/sistemas/bonificacao/.
//
// Toda conta mora AQUI, com teste em src/test/bonificacaoColetiva.test.ts —
// a tela só exibe e o banco só guarda. Sem DOM, sem structuredClone.
//
// Diferença deliberada em relação ao protótipo: lá todo dado existia (era
// fictício). Aqui um critério pode faltar numa entrega real (sem avaliação do
// solicitante, sem prazo, sem parecer da IA). Regra adotada:
//   · a média de um critério usa só as entregas que TÊM aquele critério;
//   · a nota final pondera só os critérios que têm nota, renormalizando os
//     pesos para 100 (com tudo presente, é exatamente Σ nota × peso ÷ 100).
// A tela mostra as pendências para o gestor completar antes de fechar o mês.
// =====================================================================

export type Criterio = "qualidade" | "satisfacao" | "prazo" | "dificuldade" | "valor";
export const CRITERIOS: Criterio[] = ["qualidade", "satisfacao", "prazo", "dificuldade", "valor"];
export const ROTULO_CRITERIO: Record<Criterio, string> = {
  qualidade: "Qualidade",
  satisfacao: "Satisfação",
  prazo: "Prazo",
  dificuldade: "Dificuldade",
  valor: "Valor da tarefa",
};

export type Qualidade = "sem_ajuste" | "ajuste_pequeno" | "retrabalho";
export const QUALIDADES: Qualidade[] = ["sem_ajuste", "ajuste_pequeno", "retrabalho"];
export const ROTULO_QUALIDADE: Record<Qualidade, string> = {
  sem_ajuste: "Atendeu sem ajustes",
  ajuste_pequeno: "Exigiu ajuste pequeno",
  retrabalho: "Exigiu retrabalho",
};
const NOTA_QUALIDADE: Record<Qualidade, number> = { sem_ajuste: 100, ajuste_pequeno: 50, retrabalho: 0 };

export type Dificuldade = "facil" | "medio" | "dificil" | "muito_dificil";
export const DIFICULDADES: Dificuldade[] = ["facil", "medio", "dificil", "muito_dificil"];
export const ROTULO_DIFICULDADE: Record<Dificuldade, string> = {
  facil: "Fácil",
  medio: "Médio",
  dificil: "Difícil",
  muito_dificil: "Muito difícil",
};

export interface ConfigBonificacao {
  pesos: Record<Criterio, number>;
  pontosDificuldade: Record<Dificuldade, number>;
  /** Valor de mercado (R$) que vale nota 100 no critério Valor. */
  referenciaValor: number;
}

export const CONFIG_PADRAO: ConfigBonificacao = {
  pesos: { qualidade: 30, satisfacao: 20, prazo: 20, dificuldade: 15, valor: 15 },
  // Escala da equipe (mig 20261105050000): antes 25/50/75/100. A IA classifica
  // a complexidade; quanto cada nível vale é regra da empresa.
  pontosDificuldade: { facil: 80, medio: 88, dificil: 95, muito_dificil: 100 },
  referenciaValor: 10000,
};

/** Uma entrega (chamado concluído) já com a avaliação efetiva resolvida. */
export interface EntregaBonificacao {
  chamadoId: string;
  numero: string | null;
  assunto: string;
  devId: string;
  devNome: string;
  /** Dia da conclusão (YYYY-MM-DD, fuso de Brasília). */
  concluidoDia: string;
  /** Data limite (YYYY-MM-DD) ou null quando o chamado não tinha prazo. */
  prazoLimite: string | null;
  /** Resultado gravado pelo gatilho do chamado; null = usar as datas. */
  concluidoNoPrazo: boolean | null;
  /** Nota do solicitante, 1 a 5. */
  satisfacao: number | null;
  qualidade: Qualidade | null;
  dificuldade: Dificuldade | null;
  valorMercado: number | null;
  valorFreelancer: number | null;
  valorClt: number | null;
}

export type NotasCriterios = Record<Criterio, number | null>;

const finito = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);
const limitar = (n: number, min = 0, max = 100) => Math.min(max, Math.max(min, n));

/** Dentro do prazo? null quando não há como saber (chamado sem prazo). */
export function noPrazo(e: Pick<EntregaBonificacao, "concluidoNoPrazo" | "prazoLimite" | "concluidoDia">): boolean | null {
  if (e.concluidoNoPrazo !== null && e.concluidoNoPrazo !== undefined) return e.concluidoNoPrazo;
  if (!e.prazoLimite || !e.concluidoDia) return null;
  return e.concluidoDia <= e.prazoLimite;
}

/** As 5 notas (0–100) de uma entrega; null = critério sem dado. */
export function notasDaEntrega(e: EntregaBonificacao, cfg: ConfigBonificacao): NotasCriterios {
  const prazo = noPrazo(e);
  const sat = finito(e.satisfacao) && e.satisfacao >= 1 && e.satisfacao <= 5 ? e.satisfacao : null;
  const pontos = e.dificuldade ? cfg.pontosDificuldade[e.dificuldade] : null;
  return {
    qualidade: e.qualidade ? NOTA_QUALIDADE[e.qualidade] : null,
    satisfacao: sat === null ? null : sat * 20,
    prazo: prazo === null ? null : prazo ? 100 : 0,
    dificuldade: finito(pontos) ? limitar(pontos) : null,
    valor: finito(e.valorMercado) && cfg.referenciaValor > 0
      ? PISO_VALOR + (100 - PISO_VALOR) * limitar(e.valorMercado / cfg.referenciaValor, 0, 1)
      : null,
  };
}

// ── Régua do critério Valor (05/11/2026) ─────────────────────────────────
//
// A régua fixa (R$ 10.000 = nota 100) estava fora da escala de chamado: o
// valor médio por entrega ficava em R$ 1–3 mil, e a equipe toda tirava 2 a 25
// nesse critério — ele puxava todo mundo para baixo e não diferenciava
// ninguém. Agora a régua é RELATIVA ao próprio mês: o valor de mercado no
// percentil 75 das entregas do período vale 100 (o quarto mais valioso das
// entregas tira 100; as demais, proporcional). Sempre sobre TODAS as entregas
// válidas do mês — filtrar um dev não muda a régua dele.
//
// Com menos de MIN_ENTREGAS_REFERENCIA entregas com valor, um percentil não
// diz nada; vale a referência fixa configurada em Pesos e regras.
//
// PISO: toda entrega vale pelo menos PISO_VALOR. Pablo, 05/11: "se eu ajustar
// um bug rápido que impede 50 pessoas de trabalhar vai ter menos valor do que
// um sistema novo complexo? os dois têm importância". O preço de mercado mede
// tamanho, não importância — então ele só diferencia de 50 a 100, nunca zera:
//   nota = PISO + (100 − PISO) × min(1, valor ÷ régua).

export const PISO_VALOR = 50;
export const PERCENTIL_REFERENCIA = 0.75;
export const MIN_ENTREGAS_REFERENCIA = 3;

/** Percentil (0–1) com interpolação linear; null em lista vazia. */
export function percentil(valores: number[], p: number): number | null {
  const v = valores.filter(finito).sort((a, b) => a - b);
  if (!v.length) return null;
  const pos = (v.length - 1) * limitar(p, 0, 1);
  const base = Math.floor(pos);
  const resto = pos - base;
  return v[base + 1] === undefined ? v[base] : v[base] + resto * (v[base + 1] - v[base]);
}

export interface ReferenciaValor {
  /** Valor de mercado (R$) que vale nota 100 neste mês. */
  valor: number;
  /** true = calculada pelas entregas do mês; false = a fixa da configuração. */
  automatica: boolean;
  /** Entregas com valor de mercado usadas na conta. */
  base: number;
}

/** Régua do critério Valor para o mês: percentil 75 das entregas, ou a fixa. */
export function referenciaDoPeriodo(entregas: Pick<EntregaBonificacao, "valorMercado">[], referenciaFixa: number): ReferenciaValor {
  const valores = entregas.map((e) => e.valorMercado).filter((n): n is number => finito(n) && n > 0);
  const p = valores.length >= MIN_ENTREGAS_REFERENCIA ? percentil(valores, PERCENTIL_REFERENCIA) : null;
  return p !== null && p > 0
    ? { valor: Math.round(p * 100) / 100, automatica: true, base: valores.length }
    : { valor: referenciaFixa, automatica: false, base: valores.length };
}

/** Configuração efetiva do mês: a gravada, com a régua do Valor já resolvida. */
export function configDoPeriodo(cfg: ConfigBonificacao, entregasDoMes: Pick<EntregaBonificacao, "valorMercado">[]): ConfigBonificacao {
  return { ...cfg, referenciaValor: referenciaDoPeriodo(entregasDoMes, cfg.referenciaValor).valor };
}

/** Média de cada critério sobre as entregas que têm aquele critério. */
export function mediasDosCriterios(entregas: EntregaBonificacao[], cfg: ConfigBonificacao): NotasCriterios {
  const soma: Record<Criterio, number> = { qualidade: 0, satisfacao: 0, prazo: 0, dificuldade: 0, valor: 0 };
  const qtd: Record<Criterio, number> = { qualidade: 0, satisfacao: 0, prazo: 0, dificuldade: 0, valor: 0 };
  for (const e of entregas) {
    const n = notasDaEntrega(e, cfg);
    for (const k of CRITERIOS) {
      const v = n[k];
      if (v !== null) { soma[k] += v; qtd[k] += 1; }
    }
  }
  const out = {} as NotasCriterios;
  for (const k of CRITERIOS) out[k] = qtd[k] ? soma[k] / qtd[k] : null;
  return out;
}

/** Peso efetivo de cada critério: os ausentes saem e os demais voltam a somar 100. */
export function pesosEfetivos(notas: NotasCriterios, pesos: Record<Criterio, number>): Record<Criterio, number> {
  const presentes = CRITERIOS.filter((k) => notas[k] !== null);
  const total = presentes.reduce((a, k) => a + (pesos[k] || 0), 0);
  const out = {} as Record<Criterio, number>;
  for (const k of CRITERIOS) out[k] = total > 0 && notas[k] !== null ? ((pesos[k] || 0) * 100) / total : 0;
  return out;
}

/** Pontos que o critério soma na nota final (nota × peso efetivo ÷ 100). */
export function contribuicao(notas: NotasCriterios, pesos: Record<Criterio, number>): Record<Criterio, number> {
  const ef = pesosEfetivos(notas, pesos);
  const out = {} as Record<Criterio, number>;
  for (const k of CRITERIOS) out[k] = notas[k] === null ? 0 : ((notas[k] as number) * ef[k]) / 100;
  return out;
}

/** Nota final 0–100 a partir das notas dos critérios; null sem nenhum critério. */
export function notaFinal(notas: NotasCriterios, pesos: Record<Criterio, number>): number | null {
  if (!CRITERIOS.some((k) => notas[k] !== null)) return null;
  const ef = pesosEfetivos(notas, pesos);
  if (!CRITERIOS.some((k) => ef[k] > 0)) return null;
  const c = contribuicao(notas, pesos);
  return CRITERIOS.reduce((a, k) => a + c[k], 0);
}

export const notaDaEntrega = (e: EntregaBonificacao, cfg: ConfigBonificacao) =>
  notaFinal(notasDaEntrega(e, cfg), cfg.pesos);

/** Nota de um grupo (a equipe ou um dev): médias dos critérios, depois os pesos. */
export const notaDoGrupo = (entregas: EntregaBonificacao[], cfg: ConfigBonificacao) =>
  notaFinal(mediasDosCriterios(entregas, cfg), cfg.pesos);

/** Pontos que o critério deixou de somar na entrega (peso − contribuição). */
export function pontosPerdidos(notas: NotasCriterios, pesos: Record<Criterio, number>): Record<Criterio, number> {
  const ef = pesosEfetivos(notas, pesos);
  const c = contribuicao(notas, pesos);
  const out = {} as Record<Criterio, number>;
  for (const k of CRITERIOS) out[k] = Math.max(0, ef[k] - c[k]);
  return out;
}

/** Quanto a entrega acrescenta à média da equipe (nota ÷ nº de entregas do período). */
export function contribuicaoParaEquipe(notaEntrega: number | null, totalEntregasPeriodo: number): number {
  if (notaEntrega === null || totalEntregasPeriodo <= 0) return 0;
  return notaEntrega / totalEntregasPeriodo;
}

// ── Validação da configuração ────────────────────────────────────────────

export function validarPesos(pesos: Record<Criterio, number>): string | null {
  const vals = CRITERIOS.map((k) => pesos[k]);
  if (vals.some((n) => !finito(n) || n < 0 || n > 100 || !Number.isInteger(n))) {
    return "Cada peso deve ser um número inteiro entre 0 e 100.";
  }
  const soma = vals.reduce((a, b) => a + b, 0);
  if (soma !== 100) return `Os pesos devem somar exatamente 100% (hoje: ${soma}%).`;
  return null;
}

export function validarPontosDificuldade(p: Record<Dificuldade, number>): string | null {
  if (DIFICULDADES.some((k) => !finito(p[k]) || p[k] < 0 || p[k] > 100 || !Number.isInteger(p[k]))) {
    return "Informe pontos inteiros de 0 a 100 para cada nível de dificuldade.";
  }
  return null;
}

export function validarReferencia(n: number): string | null {
  return finito(n) && n > 0 ? null : "Informe uma referência maior que zero.";
}

export function validarVerba(n: number): string | null {
  return finito(n) && n >= 0 && n <= 100_000_000 ? null : "Informe uma verba válida (de R$ 0 a R$ 100 milhões).";
}

// ── Rateio igualitário ───────────────────────────────────────────────────

export interface Rateio {
  /** Participantes (devs com entrega no período), em ordem alfabética. */
  participantes: { devId: string; devNome: string; valor: number }[];
  notaEquipe: number | null;
  verba: number;
  liberado: number;
  saldo: number;
  /** Cota "nominal" (liberado ÷ participantes), antes do ajuste de centavos. */
  cotaMedia: number;
}

/**
 * Liberado = verba × nota ÷ 100 (em centavos, arredondado), dividido em
 * partes IGUAIS; os centavos que sobram da divisão vão, um a um, para os
 * primeiros em ordem alfabética, para a soma fechar exatamente o liberado.
 */
export function ratearBonificacao(
  verba: number,
  notaEquipe: number | null,
  devs: { devId: string; devNome: string }[],
): Rateio {
  const unicos = new Map<string, string>();
  for (const d of devs) if (!unicos.has(d.devId)) unicos.set(d.devId, d.devNome);
  const lista = [...unicos.entries()]
    .map(([devId, devNome]) => ({ devId, devNome }))
    .sort((a, b) => a.devNome.localeCompare(b.devNome, "pt-BR") || a.devId.localeCompare(b.devId));

  const verbaCent = Math.max(0, Math.round((finito(verba) ? verba : 0) * 100));
  const nota = notaEquipe === null || !finito(notaEquipe) ? null : limitar(notaEquipe);
  const liberadoCent = lista.length && nota !== null ? Math.round((verbaCent * nota) / 100) : 0;
  const base = lista.length ? Math.floor(liberadoCent / lista.length) : 0;
  const sobra = liberadoCent - base * lista.length;

  return {
    participantes: lista.map((d, i) => ({ ...d, valor: (base + (i < sobra ? 1 : 0)) / 100 })),
    notaEquipe: nota,
    verba: verbaCent / 100,
    liberado: liberadoCent / 100,
    saldo: (verbaCent - liberadoCent) / 100,
    cotaMedia: lista.length ? liberadoCent / lista.length / 100 : 0,
  };
}

// ── Distribuição com peso no valor (05/11/2026) ──────────────────────────
//
// Bloco "Desempenho por desenvolvedor — com peso no valor" da aba
// Distribuição (desenho do Pablo, 05/11): cada dev tem um PESO (% do valor
// liberado) e o valor previsto é a parte dele no VALOR LIBERADO à equipe:
//   liberado × (peso × nota) ÷ Σ(peso × nota de todos)
// Correção do mesmo dia (Pablo: "tá puxando o valor errado pra dividir, é o
// valor liberado pra equipe"): a 1ª versão fazia verba × peso × nota e
// deixava saldo; agora o liberado é dividido INTEIRO — a nota coletiva já
// descontou a verba, e a nota individual só decide quem leva mais da parte.
// Dev sem nota leva 0. Os centavos que sobram do arredondamento vão para as
// maiores frações (o total fecha exato).
//
// Peso padrão (Pablo, 05/11): Eduardo, Iury, João e Pablo com peso igual;
// os demais (Otavio, Thamires) com METADE desse peso — PESO_RELATIVO_DEMAIS.
// Casado pelo primeiro nome, sem acento. Editar o peso na tela é simulação:
// o fechamento continua gravando o rateio igual.

export interface LinhaPesoValor {
  devId: string;
  devNome: string;
  entregas: number;
  nota: number | null;
  /** % do valor liberado reservado a este dev. */
  peso: number;
  valor: number;
}

export interface DistribuicaoPorPeso {
  linhas: LinhaPesoValor[];
  base: number;
  pesoTotal: number;
  distribuido: number;
  saldo: number;
  /** true quando os pesos são os do padrão (pesosPadrao). */
  pesosPadrao: boolean;
}

/** Peso igual para cada dev (100 ÷ n), arredondado a 2 casas. */
export const pesoIgual = (n: number) => (n > 0 ? Math.round((10000 / n)) / 100 : 0);

/** Primeiros nomes (sem acento, minúsculos) dos devs de peso cheio. */
export const DEVS_PESO_CHEIO = ["eduardo", "iury", "joao", "pablo"] as const;
/** Peso dos demais devs em relação ao peso cheio. */
export const PESO_RELATIVO_DEMAIS = 0.5;

const primeiroNome = (nome: string) =>
  (nome || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase().split(/\s+/)[0] ?? "";

/**
 * Peso padrão de cada dev (% que somam 100): cheio para os de DEVS_PESO_CHEIO,
 * metade para os demais, e 0 para quem está sem nota no mês (sem entrega —
 * Pablo, 05/11: "se tiver 0 deixa a porcentagem em 0 também").
 */
export function pesosPadrao(devs: (Pick<ResumoDev, "devId" | "devNome"> & { nota?: number | null })[]): Record<string, number> {
  const rel = devs.map((d) =>
    d.nota === null ? 0 : (DEVS_PESO_CHEIO as readonly string[]).includes(primeiroNome(d.devNome)) ? 1 : PESO_RELATIVO_DEMAIS);
  const soma = rel.reduce((a, r) => a + r, 0);
  const out: Record<string, number> = {};
  devs.forEach((d, i) => { out[d.devId] = soma > 0 ? Math.round((rel[i] * 10000) / soma) / 100 : 0; });
  return out;
}

/**
 * "CLT" do Comparativo individual (Pablo, 05/11/2026): o salário do
 * colaborador GASTO no mês, por dias corridos já passados — no mês atual,
 * salário × dia de hoje ÷ dias do mês (o dia de hoje conta: "5 dias
 * passados" no dia 5), e vai subindo sozinho a cada dia. Meses anteriores
 * (e futuros) ficam 0 por enquanto — "os meses anteriores ainda são
 * incertos". Sem salário (ou sem permissão de ver salário, ver mig
 * 20261105010500) → null, a tela mostra "—".
 * `mes` = 'AAAA-MM'; `hoje` = 'AAAA-MM-DD' no fuso de Brasília.
 */
export function cltDoMes(salario: number | null | undefined, mes: string, hoje: string): number | null {
  if (!finito(salario)) return null;
  if (mes !== hoje.slice(0, 7)) return 0;
  const [a, m] = mes.split("-").map(Number);
  const diasNoMes = new Date(Date.UTC(a, m, 0)).getUTCDate();
  const dia = Math.min(diasNoMes, Math.max(1, Number(hoje.slice(8, 10)) || 1));
  return Math.round((salario * 100 * dia) / diasNoMes) / 100;
}

/**
 * Editar o peso de UM dev redistribui a diferença entre os OUTROS que já têm
 * peso > 0, na proporção do peso de cada um — a soma fica sempre em 100%
 * (Pablo, 05/11: "quando diminuir a porcentagem de um tem que aumentar pros
 * outros que já tem alguma porcentagem"; antes Otavio a 5% deixava 93,9% e
 * R$ 270,59 sem destino). Quem está com 0% (sem entrega) continua em 0.
 * Se ninguém mais tem peso, o editado fica com 100% (não há para quem
 * repassar). Arredonda a 2 casas e joga o resíduo no maior dos outros.
 * `base` deve ser o retrato dos pesos ANTES da edição (tela tira no foco),
 * para a proporção entre os outros não se perder digitando "1" → "10" → "100".
 */
export function redistribuirPesos(base: Record<string, number>, devId: string, novo: number): Record<string, number> {
  const out: Record<string, number> = { ...base };
  const outros = Object.keys(base).filter((id) => id !== devId && finito(base[id]) && base[id] > 0);
  const soma = outros.reduce((a, id) => a + base[id], 0);
  if (!outros.length || soma <= 0) {
    out[devId] = 100;
    return out;
  }
  const v = Math.round(limitar(finito(novo) ? novo : 0) * 100) / 100;
  out[devId] = v;
  const resto = Math.round((100 - v) * 100); // em centésimos de %
  let usado = 0;
  outros.forEach((id) => { out[id] = Math.floor((base[id] * resto) / soma) / 100; usado += Math.round(out[id] * 100); });
  const maior = outros.reduce((a, id) => (base[id] > base[a] ? id : a), outros[0]);
  out[maior] = Math.round(out[maior] * 100 + (resto - usado)) / 100;
  return out;
}

/**
 * Como o liberado é dividido (Pablo, 05/11/2026):
 *  - "peso" (PADRÃO): cada um leva liberado × peso ÷ 100 — Eduardo, Iury,
 *    João e Pablo recebem IGUAL; a nota individual não mexe no valor.
 *  - "nota": a parte é proporcional a peso × nota individual (quem tem nota
 *    maior leva mais do mesmo liberado).
 */
export type ModoDivisao = "peso" | "nota";

export function distribuirPorPeso(
  base: number,
  devs: Pick<ResumoDev, "devId" | "devNome" | "nota" | "entregas">[],
  pesos: Record<string, number> = {},
  modo: ModoDivisao = "peso",
): DistribuicaoPorPeso {
  const baseCent = Math.max(0, Math.round((finito(base) ? base : 0) * 100));
  const padrao = pesosPadrao(devs);
  const base1 = devs.map((d) => {
    const peso = finito(pesos[d.devId]) ? limitar(pesos[d.devId]) : padrao[d.devId] ?? 0;
    const nota = d.nota === null || !finito(d.nota) ? null : limitar(d.nota);
    return { d, peso, nota, w: modo === "peso" ? peso : nota === null ? 0 : peso * nota };
  });
  const W = base1.reduce((a, x) => a + x.w, 0);
  // "nota": normaliza por Σ(peso × nota), o liberado sai inteiro.
  // "peso": liberado × peso ÷ 100 — se os pesos não somam 100, a diferença
  // fica como saldo (nunca passa do liberado).
  const brutos = base1.map((x) =>
    modo === "peso" ? (baseCent * x.w) / (Math.abs(W - 100) < 0.05 ? W : Math.max(100, W)) : W > 0 ? (baseCent * x.w) / W : 0);
  const cents = brutos.map(Math.floor);
  const alvo = modo === "peso" ? Math.round(brutos.reduce((a, b) => a + b, 0)) : W > 0 ? baseCent : 0;
  let sobra = alvo - cents.reduce((a, c) => a + c, 0);
  brutos
    .map((b, i) => ({ i, frac: b - Math.floor(b) }))
    .sort((a, b) => b.frac - a.frac)
    .forEach(({ i }) => { if (sobra > 0 && base1[i].w > 0) { cents[i] += 1; sobra -= 1; } });
  const linhas = base1.map((x, i) => ({
    devId: x.d.devId, devNome: x.d.devNome, entregas: x.d.entregas.length, nota: x.nota, peso: x.peso, valor: cents[i] / 100,
  }));
  const distribuidoCent = cents.reduce((a, c) => a + c, 0);
  return {
    linhas,
    base: baseCent / 100,
    pesoTotal: Math.round(linhas.reduce((a, l) => a + l.peso, 0) * 100) / 100,
    distribuido: distribuidoCent / 100,
    saldo: (baseCent - distribuidoCent) / 100,
    pesosPadrao: linhas.every((l) => Math.abs(l.peso - (padrao[l.devId] ?? 0)) < 0.005),
  };
}

// ── Sugestões a partir dos dados reais ───────────────────────────────────

/** A regra em uma frase: a tela mostra para quem lê a nota saber de onde ela vem. */
export function textoEscalaDificuldade(p: Record<Dificuldade, number>): string {
  const niveis = DIFICULDADES.map((d) => `${ROTULO_DIFICULDADE[d]} ${p[d]}`).join(" · ");
  return `Dificuldade: a IA classifica a complexidade de cada chamado; os pontos de cada nível são definidos pela empresa (${niveis}), e não uma nota dada pela IA.`;
}

/** Complexidade 1–5 do parecer da IA → nível de dificuldade do bônus. */
export function dificuldadeDaComplexidade(nivel: number | null | undefined): Dificuldade | null {
  if (!finito(nivel)) return null;
  const n = Math.round(nivel);
  if (n <= 0 || n > 5) return null;
  if (n === 1) return "facil";
  if (n <= 3) return "medio";
  if (n === 4) return "dificil";
  return "muito_dificil";
}

/**
 * Qualidade sugerida (o gestor confirma ou troca).
 *
 * REABERTURA NÃO É ERRO (06/11/2026, pedido do Pablo): "às vezes o
 * solicitante vai concluir e reabre sem querer, e às vezes só reabre pedindo
 * mais coisa, mesmo o desenvolvimento estando perfeito — não é culpa nem erro
 * nosso". Antes 1 reabertura sugeria "ajuste pequeno" (50) e 2+ "retrabalho"
 * (0). Agora a sugestão é sempre "atendeu sem ajuste"; ajuste/retrabalho só
 * quando o gestor marca, ao avaliar a entrega. O número de reaberturas segue
 * à vista, só como informação.
 */
export function qualidadeSugerida(_reaberturas?: number | null): Qualidade {
  return "sem_ajuste";
}

// ── Linha da RPC → entrega ───────────────────────────────────────────────

/** Linha devolvida por bonificacao_dev_entregas (mig 20261105004700). */
export interface LinhaEntregaRpc {
  chamado_id: string;
  numero: string | null;
  assunto: string | null;
  tipo_solicitacao: string | null;
  responsavel_id: string;
  responsavel_nome: string | null;
  concluido_em: string;
  prazo_limite: string | null;
  concluido_no_prazo: boolean | null;
  horas_gastas: number | string | null;
  satisfacao: number | null;
  reaberturas: number | null;
  ia_status: string | null;
  ia_complexidade: number | null;
  ia_valor_mercado: number | string | null;
  ia_valor_freelancer: number | string | null;
  ia_valor_clt: number | string | null;
  qualidade: string | null;
  dificuldade: string | null;
  valor_mercado: number | string | null;
  valor_freelancer: number | string | null;
  valor_clt: number | string | null;
  fora_da_bonificacao: boolean | null;
  motivo_exclusao: string | null;
  observacao: string | null;
  avaliado_em: string | null;
}

/** Entrega com a origem de cada dado, para a tela mostrar o que é sugestão. */
export interface EntregaDetalhada extends EntregaBonificacao {
  tipoSolicitacao: string | null;
  horasGastas: number | null;
  reaberturas: number;
  iaStatus: string | null;
  iaComplexidade: number | null;
  qualidadeAvaliada: boolean;
  dificuldadeAvaliada: boolean;
  valoresAvaliados: boolean;
  foraDaBonificacao: boolean;
  motivoExclusao: string | null;
  observacao: string | null;
  avaliadoEm: string | null;
}

const numOuNull = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const ehQualidade = (v: unknown): v is Qualidade => QUALIDADES.includes(v as Qualidade);
const ehDificuldade = (v: unknown): v is Dificuldade => DIFICULDADES.includes(v as Dificuldade);

/** Dia (YYYY-MM-DD) de um timestamp no fuso de Brasília (UTC−3, sem horário de verão). */
export function diaEmBrasilia(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  return new Date(t - 3 * 3600 * 1000).toISOString().slice(0, 10);
}

/**
 * Resolve a avaliação EFETIVA: o que o gestor gravou vence; sem isso, a
 * sugestão (reaberturas → qualidade; parecer da IA → dificuldade e valores).
 */
export function entregaDaLinha(l: LinhaEntregaRpc): EntregaDetalhada {
  const qualidadeAvaliada = ehQualidade(l.qualidade);
  const dificuldadeAvaliada = ehDificuldade(l.dificuldade);
  const valoresAvaliados = numOuNull(l.valor_mercado) !== null;
  return {
    chamadoId: l.chamado_id,
    numero: l.numero,
    assunto: l.assunto ?? "(sem assunto)",
    devId: l.responsavel_id,
    devNome: l.responsavel_nome ?? "Sem nome",
    concluidoDia: diaEmBrasilia(l.concluido_em),
    prazoLimite: l.prazo_limite ? l.prazo_limite.slice(0, 10) : null,
    concluidoNoPrazo: l.concluido_no_prazo,
    satisfacao: numOuNull(l.satisfacao),
    qualidade: qualidadeAvaliada ? (l.qualidade as Qualidade) : qualidadeSugerida(l.reaberturas),
    dificuldade: dificuldadeAvaliada ? (l.dificuldade as Dificuldade) : dificuldadeDaComplexidade(l.ia_complexidade),
    valorMercado: valoresAvaliados ? numOuNull(l.valor_mercado) : numOuNull(l.ia_valor_mercado),
    valorFreelancer: numOuNull(l.valor_freelancer) ?? numOuNull(l.ia_valor_freelancer),
    valorClt: numOuNull(l.valor_clt) ?? numOuNull(l.ia_valor_clt),
    tipoSolicitacao: l.tipo_solicitacao,
    horasGastas: numOuNull(l.horas_gastas),
    reaberturas: numOuNull(l.reaberturas) ?? 0,
    iaStatus: l.ia_status,
    iaComplexidade: numOuNull(l.ia_complexidade),
    qualidadeAvaliada,
    dificuldadeAvaliada,
    valoresAvaliados,
    foraDaBonificacao: !!l.fora_da_bonificacao,
    motivoExclusao: l.motivo_exclusao,
    observacao: l.observacao,
    avaliadoEm: l.avaliado_em,
  };
}

/** O que falta para a nota da entrega estar completa (para a lista de pendências). */
export function pendenciasDaEntrega(e: EntregaDetalhada): string[] {
  const p: string[] = [];
  if (!e.qualidadeAvaliada) p.push("qualidade não confirmada pelo gestor");
  if (e.satisfacao === null) p.push("sem avaliação do solicitante");
  if (noPrazo(e) === null) p.push("chamado sem prazo");
  if (e.dificuldade === null) p.push("sem dificuldade (IA ou gestor)");
  if (e.valorMercado === null) p.push("sem valor de mercado (IA ou gestor)");
  return p;
}

// ── Período (competência) ────────────────────────────────────────────────

/** "2026-10" → { inicio: "2026-10-01", fim: "2026-10-31", competencia: "2026-10-01" }. */
export function intervaloDaCompetencia(mes: string): { inicio: string; fim: string; competencia: string } {
  const m = /^(\d{4})-(\d{2})/.exec(mes);
  if (!m) throw new Error(`Competência inválida: ${mes}`);
  const ano = Number(m[1]);
  const mm = Number(m[2]);
  const ultimo = new Date(Date.UTC(ano, mm, 0)).getUTCDate();
  const p = (n: number) => String(n).padStart(2, "0");
  return { inicio: `${ano}-${p(mm)}-01`, fim: `${ano}-${p(mm)}-${p(ultimo)}`, competencia: `${ano}-${p(mm)}-01` };
}

const MESES = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
export function rotuloCompetencia(mes: string): string {
  const m = /^(\d{4})-(\d{2})/.exec(mes);
  return m ? `${MESES[Number(m[2]) - 1]}/${m[1]}` : mes;
}

/** Os últimos `n` meses (YYYY-MM), do mais recente para o mais antigo, a partir de `hoje` (YYYY-MM-DD). */
export function ultimasCompetencias(hoje: string, n = 12): string[] {
  let ano = Number(hoje.slice(0, 4));
  let mes = Number(hoje.slice(5, 7));
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    out.push(`${ano}-${String(mes).padStart(2, "0")}`);
    mes -= 1;
    if (mes === 0) { mes = 12; ano -= 1; }
  }
  return out;
}

/** Linha de BONIFICACAO_DEV_PERIODO. */
export interface LinhaPeriodo {
  competencia: string;
  verba: number | string;
  peso_qualidade: number;
  peso_satisfacao: number;
  peso_prazo: number;
  peso_dificuldade: number;
  peso_valor: number;
  pontos_facil: number;
  pontos_medio: number;
  pontos_dificil: number;
  pontos_muito_dificil: number;
  referencia_valor: number | string;
  observacao: string | null;
  fechado_em: string | null;
  fechado_por: string | null;
  resultado: unknown;
  /** Peso no valor por dev ({responsavel_id: %}) — mig 20261105011000. */
  pesos_devs?: Record<string, number> | null;
  modo_divisao?: ModoDivisao | null;
}

export const configDaLinha = (l: LinhaPeriodo): ConfigBonificacao => ({
  pesos: {
    qualidade: Number(l.peso_qualidade),
    satisfacao: Number(l.peso_satisfacao),
    prazo: Number(l.peso_prazo),
    dificuldade: Number(l.peso_dificuldade),
    valor: Number(l.peso_valor),
  },
  pontosDificuldade: {
    facil: Number(l.pontos_facil),
    medio: Number(l.pontos_medio),
    dificil: Number(l.pontos_dificil),
    muito_dificil: Number(l.pontos_muito_dificil),
  },
  referenciaValor: Number(l.referencia_valor),
});

export function linhaDaConfig(cfg: ConfigBonificacao) {
  return {
    peso_qualidade: cfg.pesos.qualidade,
    peso_satisfacao: cfg.pesos.satisfacao,
    peso_prazo: cfg.pesos.prazo,
    peso_dificuldade: cfg.pesos.dificuldade,
    peso_valor: cfg.pesos.valor,
    pontos_facil: cfg.pontosDificuldade.facil,
    pontos_medio: cfg.pontosDificuldade.medio,
    pontos_dificil: cfg.pontosDificuldade.dificil,
    pontos_muito_dificil: cfg.pontosDificuldade.muito_dificil,
    referencia_valor: cfg.referenciaValor,
  };
}

export interface PeriodoResolvido {
  /** YYYY-MM */
  mes: string;
  config: ConfigBonificacao;
  verba: number;
  /** Linha própria do mês (null = ainda não salvo). */
  linha: LinhaPeriodo | null;
  /** Mês de onde a configuração foi herdada (YYYY-MM) ou "padrao". null = própria. */
  herdadoDe: string | null;
  fechado: boolean;
}

// ── Pesos por dev salvos (Pablo, 05/11/2026: "tem que ter um botão de
// salvar e manter fixo") ────────────────────────────────────────────────
// Ficam NO MÊS (BONIFICACAO_DEV_PERIODO.pesos_devs/modo_divisao) e o mês sem
// pesos próprios herda do último mês anterior que tenha — o que se salva hoje
// vale para os meses seguintes até alguém mudar; mexer num mês não reescreve
// o passado (nem período fechado).

export interface PesosSalvos {
  pesos: Record<string, number>;
  modo: ModoDivisao;
  /** null = salvos no próprio mês; 'AAAA-MM' = herdados desse mês. */
  herdadoDe: string | null;
}

export function pesosSalvosDoMes(mes: string, linhas: LinhaPeriodo[]): PesosSalvos | null {
  const chave = (l: LinhaPeriodo) => String(l.competencia).slice(0, 7);
  const l = linhas
    .filter((x) => chave(x) <= mes && x.pesos_devs && typeof x.pesos_devs === "object")
    .sort((a, b) => chave(b).localeCompare(chave(a)))[0];
  if (!l || !l.pesos_devs) return null;
  const pesos: Record<string, number> = {};
  for (const [id, v] of Object.entries(l.pesos_devs)) { const n = Number(v); if (finito(n)) pesos[id] = n; }
  return { pesos, modo: l.modo_divisao === "nota" ? "nota" : "peso", herdadoDe: chave(l) === mes ? null : chave(l) };
}

/** Reescala os pesos > 0 para somarem 100 (2 casas; resíduo no maior). */
function normalizar100(p: Record<string, number>): Record<string, number> {
  const ids = Object.keys(p).filter((id) => p[id] > 0);
  const soma = ids.reduce((a, id) => a + p[id], 0);
  if (!ids.length || Math.abs(soma - 100) < 0.005) return { ...p };
  const out: Record<string, number> = { ...p };
  let usado = 0;
  ids.forEach((id) => { out[id] = Math.floor((p[id] * 10000) / soma) / 100; usado += Math.round(out[id] * 100); });
  const maior = ids.reduce((a, id) => (p[id] > p[a] ? id : a), ids[0]);
  out[maior] = Math.round(out[maior] * 100 + (10000 - usado)) / 100;
  return out;
}

/**
 * Pesos salvos aplicados à equipe do mês: quem está salvo e tem nota leva o
 * seu peso; quem não entregou no mês (nota null) ou não estava salvo fica 0;
 * os pesos > 0 são reescalados para somar 100 (ex.: salvo em outubro com um
 * dev que não entregou em novembro — a parte dele volta para os outros, na
 * proporção). Ninguém com peso → padrão.
 */
export function aplicarPesosSalvos(
  devs: (Pick<ResumoDev, "devId" | "devNome"> & { nota?: number | null })[],
  salvos: Record<string, number>,
): Record<string, number> {
  const p: Record<string, number> = {};
  for (const d of devs) {
    const v = salvos[d.devId];
    p[d.devId] = d.nota !== null && finito(v) && v > 0 ? limitar(v) : 0;
  }
  if (!Object.values(p).some((v) => v > 0)) return pesosPadrao(devs);
  return normalizar100(p);
}

/**
 * Configuração do mês: a linha do próprio mês; sem ela, a do último mês
 * anterior que tenha linha (verba NÃO é herdada — cada mês tem a sua);
 * sem nenhuma, o padrão do protótipo.
 */
export function resolverPeriodo(mes: string, linhas: LinhaPeriodo[]): PeriodoResolvido {
  const chave = (l: LinhaPeriodo) => String(l.competencia).slice(0, 7);
  const propria = linhas.find((l) => chave(l) === mes) ?? null;
  if (propria) {
    return { mes, config: configDaLinha(propria), verba: Number(propria.verba) || 0, linha: propria, herdadoDe: null, fechado: !!propria.fechado_em };
  }
  const anterior = linhas
    .filter((l) => chave(l) < mes)
    .sort((a, b) => chave(b).localeCompare(chave(a)))[0];
  if (anterior) {
    return { mes, config: configDaLinha(anterior), verba: 0, linha: null, herdadoDe: chave(anterior), fechado: false };
  }
  return { mes, config: CONFIG_PADRAO, verba: 0, linha: null, herdadoDe: "padrao", fechado: false };
}

// ── Agrupamento por desenvolvedor ────────────────────────────────────────

export interface ResumoDev {
  devId: string;
  devNome: string;
  entregas: EntregaBonificacao[];
  medias: NotasCriterios;
  nota: number | null;
  mercado: number;
  freelancer: number;
  clt: number;
}

/** Meses para trás em que quem foi responsável por chamado concluído conta como "da equipe". */
export const MESES_EQUIPE = 6;

/** Intervalo da equipe: do 1º dia de MESES_EQUIPE meses antes até o fim da competência. */
export function intervaloDaEquipe(mes: string): { inicio: string; fim: string } {
  const { fim } = intervaloDaCompetencia(mes);
  const [ano, mm] = fim.split("-").map(Number);
  const d = new Date(Date.UTC(ano, mm - 1 - MESES_EQUIPE, 1));
  return { inicio: d.toISOString().slice(0, 10), fim };
}

/**
 * Soma à lista do mês quem é da equipe mas não teve entrega nele (Pablo,
 * 05/11/2026: "por que a Thamires não aparece aqui?"). Entra com 0 entregas,
 * sem nota — no peso no valor leva R$ 0 e não tira nada de ninguém. "Equipe"
 * = responsável por chamado concluído nos últimos MESES_EQUIPE meses.
 */
export function completarComEquipe(devs: ResumoDev[], equipe: { devId: string; devNome: string }[]): ResumoDev[] {
  const tem = new Set(devs.map((d) => d.devId));
  const vazio = Object.fromEntries(CRITERIOS.map((k) => [k, null])) as NotasCriterios;
  const extras = equipe
    .filter((e) => !tem.has(e.devId))
    .map((e) => ({ devId: e.devId, devNome: e.devNome, entregas: [], medias: { ...vazio }, nota: null, mercado: 0, freelancer: 0, clt: 0 }));
  return [...devs, ...extras];
}

export function resumoPorDev(entregas: EntregaBonificacao[], cfg: ConfigBonificacao): ResumoDev[] {
  const grupos = new Map<string, EntregaBonificacao[]>();
  for (const e of entregas) {
    const g = grupos.get(e.devId);
    if (g) g.push(e); else grupos.set(e.devId, [e]);
  }
  return [...grupos.values()]
    .map((lista) => ({
      devId: lista[0].devId,
      devNome: lista[0].devNome,
      entregas: lista,
      medias: mediasDosCriterios(lista, cfg),
      nota: notaDoGrupo(lista, cfg),
      mercado: somar(lista, "valorMercado"),
      freelancer: somar(lista, "valorFreelancer"),
      clt: somar(lista, "valorClt"),
    }))
    .sort((a, b) => a.devNome.localeCompare(b.devNome, "pt-BR"));
}

export function somar(lista: EntregaBonificacao[], campo: "valorMercado" | "valorFreelancer" | "valorClt"): number {
  return lista.reduce((a, e) => a + (finito(e[campo]) ? (e[campo] as number) : 0), 0);
}

// ── Exportação ───────────────────────────────────────────────────────────

const fmt1 = (n: number | null) => (n === null ? "" : n.toFixed(1).replace(".", ","));
const fmt2 = (n: number | null) => (n === null ? "" : n.toFixed(2).replace(".", ","));
const dataBr = (d: string | null) => (d ? d.slice(0, 10).split("-").reverse().join("/") : "");
const celula = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;

/** CSV (";" + BOM, abre direto no Excel) das entregas filtradas, com a cota igual de cada dev. */
export function gerarCsv(entregas: EntregaBonificacao[], cfg: ConfigBonificacao, rateio: Rateio): string {
  const cota = new Map(rateio.participantes.map((p) => [p.devId, p.valor]));
  const cab = [
    "Chamado", "Tarefa", "Desenvolvedor", "Conclusão", "Prazo", "No prazo", "Qualidade", "Satisfação (1-5)",
    "Dificuldade", "Mercado IA", "Freelancer IA", "CLT IA",
    ...CRITERIOS.map((k) => `Nota ${ROTULO_CRITERIO[k]}`), "Nota final", "Cota igual da equipe",
  ];
  const linhas = entregas.map((e) => {
    const n = notasDaEntrega(e, cfg);
    const p = noPrazo(e);
    return [
      e.numero ?? "", e.assunto, e.devNome, dataBr(e.concluidoDia), dataBr(e.prazoLimite),
      p === null ? "" : p ? "Sim" : "Não",
      e.qualidade ? ROTULO_QUALIDADE[e.qualidade] : "", e.satisfacao ?? "",
      e.dificuldade ? ROTULO_DIFICULDADE[e.dificuldade] : "",
      fmt2(e.valorMercado), fmt2(e.valorFreelancer), fmt2(e.valorClt),
      ...CRITERIOS.map((k) => fmt1(n[k])), fmt1(notaFinal(n, cfg.pesos)), fmt2(cota.get(e.devId) ?? 0),
    ];
  });
  return "﻿" + [cab, ...linhas].map((l) => l.map(celula).join(";")).join("\r\n");
}

const esc = (s: unknown) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const moeda = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const num1 = (n: number | null) => (n === null ? "—" : n.toLocaleString("pt-BR", { maximumFractionDigits: 1 }));

/** HTML autossuficiente da proposta (para abrir numa janela e imprimir). */
export function htmlProposta(args: {
  mes: string;
  cfg: ConfigBonificacao;
  rateio: Rateio;
  medias: NotasCriterios;
  devs: ResumoDev[];
  totalEntregas: number;
  geradoEm: string;
  fechado: boolean;
}): string {
  const { mes, cfg, rateio, medias, devs, totalEntregas, geradoEm, fechado } = args;
  const contrib = contribuicao(medias, cfg.pesos);
  const linhasCriterios = CRITERIOS.map((k) =>
    `<tr><td>${esc(ROTULO_CRITERIO[k])}</td><td>${cfg.pesos[k]}%</td><td>${num1(medias[k])}</td><td>${num1(medias[k] === null ? null : contrib[k])}</td></tr>`).join("");
  const linhasDevs = devs.map((d) =>
    `<tr><td>${esc(d.devNome)}</td><td>${d.entregas.length}</td><td>${num1(d.nota)}</td></tr>`).join("");
  const cota = rateio.participantes.length ? moeda(rateio.participantes[rateio.participantes.length - 1].valor) : moeda(0);
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Proposta de bonificação coletiva — ${esc(rotuloCompetencia(mes))}</title>
<style>body{font:13px system-ui,Segoe UI,Arial,sans-serif;color:#111;margin:32px}h1{font-size:20px;margin:0 0 4px}h2{font-size:15px;margin:22px 0 8px}
.sub{color:#555}.kpis{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin:16px 0}.kpi{border:1px solid #bbb;border-radius:8px;padding:10px}
.kpi b{display:block;font-size:18px;margin-top:4px}table{border-collapse:collapse;width:100%}th,td{border-bottom:1px solid #ccc;padding:6px 8px;text-align:left}
th{font-size:11px;text-transform:uppercase;color:#555}.nota{border-left:3px solid #2468bc;padding:8px 12px;background:#f3f6fa;margin:14px 0}</style></head><body>
<div class="sub">Sistemas • Gestão de desempenho</div>
<h1>Proposta de bonificação coletiva — ${esc(rotuloCompetencia(mes))}</h1>
<div class="sub">${fechado ? "Período fechado" : "Simulação (período aberto)"} • gerado em ${esc(geradoEm)}</div>
<div class="kpis">
<div class="kpi">Verba máxima<b>${moeda(rateio.verba)}</b></div>
<div class="kpi">Nota coletiva<b>${num1(rateio.notaEquipe)}/100</b></div>
<div class="kpi">Liberado à equipe<b>${moeda(rateio.liberado)}</b></div>
<div class="kpi">Saldo não liberado<b>${moeda(rateio.saldo)}</b></div>
<div class="kpi">Participantes<b>${rateio.participantes.length}</b></div>
<div class="kpi">Valor igual por participante<b>${rateio.participantes.length ? "≈ " + moeda(rateio.cotaMedia) : moeda(0)}</b></div>
</div>
<div class="nota">Cálculo: ${moeda(rateio.verba)} × ${num1(rateio.notaEquipe)}% = ${moeda(rateio.liberado)} liberados à equipe, divididos igualmente por ${rateio.participantes.length} participante(s). Centavos ajustados só para fechar o total (menor cota: ${cota}). ${totalEntregas} entrega(s) no período.</div>
<h2>Nota da equipe por critério</h2>
<table><thead><tr><th>Critério</th><th>Peso</th><th>Média (0–100)</th><th>Pontos na nota</th></tr></thead><tbody>${linhasCriterios}</tbody></table>
<h2>Desempenho por desenvolvedor (acompanhamento — não altera a cota)</h2>
<table><thead><tr><th>Desenvolvedor</th><th>Entregas</th><th>Nota</th></tr></thead><tbody>${linhasDevs}</tbody></table>
<p class="sub">O valor por participante é único. Notas individuais servem só para acompanhamento gerencial. Os valores estimados pela IA (mercado, freelancer, CLT) não são economia comprovada.</p>
</body></html>`;
}
