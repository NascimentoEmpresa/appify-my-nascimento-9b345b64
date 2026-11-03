// SIS-2026-0641: "como esse número é formado". Cada valor da tabela do Faturamento da Empresa abre um modal com a conta
// que fecha na célula clicada e a lista do que a compõe. Funções puras: a tela só passa o recorte da célula.
import { diasDesdeEmissao } from "@/pages/financeiro/nf-emissao/shared";
import {
  RUBRICAS, type BaseDespesa, aReceberDaNf, notaValidaNoFaturamento, lucroBruto, mesDoCusto, notasComSaldo, ponteAReceber, rubricaDaLinha, somarNf, totaisVazios,
  type LigacoesRubrica, type LinhaFluxoCusto, type NfFaturamento, type TotaisFaturamento,
} from "./regras";
import { saiDasDespesas, tratamentoEfetivo, type TratamentoContrato, type TratamentosContrato } from "./tratamentoContrato";

export type Metrica =
  | "exec" | "diferenca" | "bruto" | "descontos" | "liquido" | "recebido" | "aReceber" | "contaVinculada"
  | "despesas" | "lucroFat" | "lucroRec" | "margem";

export type FonteExecutavel = "planilha" | "cadastro" | "encerrado" | "sem_valor";

export const ROTULO_FONTE_EXEC: Record<FonteExecutavel, string> = {
  planilha: "Planilha de custo",
  cadastro: "Valor Executado Mensal do cadastro",
  encerrado: "Contrato encerrado",
  sem_valor: "Sem planilha e sem valor no cadastro",
};

export interface NfDetalhe extends NfFaturamento {
  id: string;
  numero_nf: string | null;
  data_emissao?: string | null;
  contrato?: { nome: string; cliente: string } | null;
}

/** O recorte da célula clicada. */
export interface EscopoDetalhe {
  titulo: string;
  nfs: NfDetalhe[];
  /** meses ("YYYY-MM") que a célula cobre (1 no Resumo Mensal; o ano todo nas outras) */
  meses: string[];
  /** contratos que a célula cobre (para executável e despesas) */
  contratoIds: string[];
}

export interface ContextoDetalhe {
  contratoNome: (id: string) => string;
  execDe: (contratoId: string, anoMes: string) => { valor: number; fonte: FonteExecutavel };
  custos: LinhaFluxoCusto[];
  ligacoes?: LigacoesRubrica;
  // SIS-2026-0721: base em que as despesas foram lidas (só muda o texto do modal).
  baseDespesa?: BaseDespesa;
  // SIS-2026-0755: exceções de tratamento por contrato (Tratamento dos contratos); sem elas vale o padrão pelo nome.
  tratamentos?: TratamentosContrato;
}

export type Celula = string | number;

export interface LinhaConta {
  rotulo: string;
  valor: number | string;
  sinal?: "-" | "=" | "+";
  destaque?: boolean;
  dica?: string;
}

export interface TabelaDetalhe {
  titulo: string;
  colunas: { rotulo: string; alinhar?: "left" | "right" }[];
  linhas: Celula[][];
  rodape?: Celula[];
  nota?: string;
}

// SIS-2026-0755: contratos que compõem (ou ficam fora de) uma coluna, para o usuário ajustar o tratamento do contrato direto no modal.
export interface ContratoDaColuna {
  id: string;
  nome: string;
  valor: number;
}

// SIS-2026-0755: classificações que compõem a coluna, para trocar a rubrica de cada uma direto no modal.
export interface ClassificacaoDaColuna {
  id: string | null;
  nome: string;
  valor: number;
  lancamentos: number;
}

export interface ContratoForaDaColuna {
  id: string;
  nome: string;
  tratamento: TratamentoContrato;
  // 'padrao' = pela regra do nome; 'configurado' = alguém definiu em Tratamento dos contratos
  origem: "padrao" | "configurado";
}

export interface Composicao {
  titulo: string;
  descricao?: string;
  conta: LinhaConta[];
  tabela?: TabelaDetalhe;
  aviso?: string;
  contratosNaColuna?: ContratoDaColuna[];
  classificacoesNaColuna?: ClassificacaoDaColuna[];
  contratosForaDaColuna?: ContratoForaDaColuna[];
}

export const ROTULO_METRICA: Record<Metrica, string> = {
  exec: "Valor Exec.",
  diferenca: "Diferença Exec. × Fat.",
  bruto: "Valor Bruto",
  descontos: "Descontos",
  liquido: "Valor Líquido",
  recebido: "Recebido",
  aReceber: "A Receber",
  contaVinculada: "Conta vinculada",
  despesas: "Despesas",
  lucroFat: "Lucro Faturamento",
  lucroRec: "Lucro Recebido",
  margem: "Margem Bruta",
};

const LIMITE_LINHAS = 300;
const r2 = (n: number) => Math.round(n * 100) / 100;
const pct = (m: number | null) => (m === null ? "—" : `${(m * 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`);
const mesCurto = (anoMes: string) => `${anoMes.slice(5, 7)}/${anoMes.slice(0, 4)}`;
const dia = (iso: string | null | undefined) => (iso ? iso.slice(0, 10).split("-").reverse().join("/") : "—");
const mesAno = (iso: string | null | undefined) => (iso ? `${iso.slice(5, 7)}/${iso.slice(0, 4)}` : "—");

export function totaisDoEscopo(nfs: NfFaturamento[]): TotaisFaturamento {
  const t = totaisVazios();
  for (const n of nfs) if (notaValidaNoFaturamento(n)) somarNf(t, n);
  return t;
}

// ── Despesas: saídas do Fluxo de Caixa com contrato, no recorte, que viram custo (a mesma conta do Lucro) ──
export interface DespesasEscopo {
  total: number;
  porRubrica: { rotulo: string; valor: number }[];
  linhas: (LinhaFluxoCusto & { rubrica: string })[];
  porContrato: Map<string, number>;
}

export function despesasDoEscopo(custos: LinhaFluxoCusto[], escopo: Pick<EscopoDetalhe, "meses" | "contratoIds">, ligacoes?: LigacoesRubrica): DespesasEscopo {
  const contratos = new Set(escopo.contratoIds);
  const meses = new Set(escopo.meses);
  const rotulo = new Map(RUBRICAS.map((r) => [r.id, r.label]));
  const porRubrica = new Map<string, number>();
  const porContrato = new Map<string, number>();
  const linhas: (LinhaFluxoCusto & { rubrica: string })[] = [];
  let total = 0;
  for (const l of custos) {
    const mesDaLinha = mesDoCusto(l);
    if (l.tipo !== "saida" || !l.contrato_id || !mesDaLinha) continue;
    if (!contratos.has(l.contrato_id) || !meses.has(mesDaLinha)) continue;
    const rub = rubricaDaLinha(l, ligacoes);
    if (!rub) continue;
    const nome = rotulo.get(rub) ?? rub;
    const v = l.valor || 0;
    total += v;
    porRubrica.set(nome, (porRubrica.get(nome) ?? 0) + v);
    porContrato.set(l.contrato_id, (porContrato.get(l.contrato_id) ?? 0) + v);
    linhas.push({ ...l, rubrica: nome });
  }
  return {
    total: r2(total),
    porRubrica: RUBRICAS.map((r) => ({ rotulo: r.label, valor: r2(porRubrica.get(r.label) ?? 0) })).filter((x) => Math.abs(x.valor) > 0.005),
    linhas: linhas.sort((a, b) => (b.valor || 0) - (a.valor || 0)),
    porContrato,
  };
}

function classificacoesDasLinhas(linhas: { classificacao_id?: string | null; classificacao_nome: string | null; valor: number }[]): ClassificacaoDaColuna[] {
  const m = new Map<string, ClassificacaoDaColuna>();
  for (const l of linhas) {
    const nome = (l.classificacao_nome ?? "").trim() || "(sem classificação)";
    const k = l.classificacao_id ?? `nome:${nome}`;
    const a = m.get(k) ?? { id: l.classificacao_id ?? null, nome, valor: 0, lancamentos: 0 };
    a.valor += l.valor || 0;
    a.lancamentos += 1;
    m.set(k, a);
  }
  return [...m.values()].map((x) => ({ ...x, valor: r2(x.valor) })).sort((a, b) => b.valor - a.valor);
}

// ── Executável: por contrato, de onde vem o valor ──
function execDoEscopo(escopo: EscopoDetalhe, ctx: ContextoDetalhe) {
  const brutoPorContrato = new Map<string, number>();
  for (const n of escopo.nfs) if (notaValidaNoFaturamento(n)) brutoPorContrato.set(n.contrato_id, (brutoPorContrato.get(n.contrato_id) ?? 0) + (n.vlr_bruto_total || 0));
  const linhas = escopo.contratoIds.map((id) => {
    let exec = 0;
    const fontes = new Set<FonteExecutavel>();
    let encerrado = 0;
    for (const m of escopo.meses) {
      const e = ctx.execDe(id, m);
      exec += e.valor;
      if (e.valor > 0) fontes.add(e.fonte);
      if (e.fonte === "encerrado") encerrado += 1;
    }
    const bruto = brutoPorContrato.get(id) ?? 0;
    let fonte: string;
    if (fontes.size === 0) fonte = encerrado === escopo.meses.length ? ROTULO_FONTE_EXEC.encerrado : ROTULO_FONTE_EXEC.sem_valor;
    else fonte = [...fontes].map((f) => ROTULO_FONTE_EXEC[f]).join(" + ");
    return { id, nome: ctx.contratoNome(id), exec: r2(exec), bruto: r2(bruto), fonte, semValor: fontes.size === 0 };
  });
  return linhas.filter((l) => l.exec > 0 || l.bruto > 0).sort((a, b) => b.exec - a.exec || b.bruto - a.bruto);
}

function tabelaNotas(escopo: EscopoDetalhe, metrica: Metrica): TabelaDetalhe {
  const valorDe = (n: NfDetalhe): number => {
    switch (metrica) {
      case "recebido": return n.valor_pago ?? 0;
      case "contaVinculada": return n.desconto_conta_vinculada || 0;
      case "aReceber": return aReceberDaNf(n);
      case "liquido": return n.vlr_liquido_total || 0;
      case "descontos": return (n.vlr_bruto_total || 0) - (n.vlr_liquido_total || 0);
      default: return n.vlr_bruto_total || 0;
    }
  };
  const base = escopo.nfs.filter(notaValidaNoFaturamento);
  const doRecorte = metrica === "aReceber" ? notasComSaldo(base).map((x) => x.nf as NfDetalhe) : base.filter((n) => metrica === "recebido" || metrica === "contaVinculada" ? Math.abs(valorDe(n)) > 0.005 : true);
  const ordenadas = [...doRecorte].sort((a, b) => valorDe(b) - valorDe(a));
  const mostradas = ordenadas.slice(0, LIMITE_LINHAS);
  return {
    titulo: metrica === "aReceber" ? `Notas com saldo a receber (${ordenadas.length.toLocaleString("pt-BR")})` : `Notas que formam o valor (${ordenadas.length.toLocaleString("pt-BR")})`,
    colunas: [
      { rotulo: "Nº NF", alinhar: "left" }, { rotulo: "Cliente", alinhar: "left" }, { rotulo: "Contrato", alinhar: "left" }, { rotulo: "Compet.", alinhar: "left" },
      { rotulo: "Bruto" }, { rotulo: "Líquido" }, { rotulo: "Recebido" }, { rotulo: "Conta vinc." }, { rotulo: "A Receber" }, { rotulo: "Dias" },
    ],
    linhas: mostradas.map((n) => {
      const saldo = aReceberDaNf(n);
      const dias = saldo > 0.005 ? diasDesdeEmissao(n.data_emissao ?? null) : null;
      return [
        n.numero_nf ?? "—", n.contrato?.cliente ?? "—", n.contrato?.nome ?? "—", mesCurto(n.competencia),
        n.vlr_bruto_total || 0, n.vlr_liquido_total || 0, n.valor_pago ?? 0, n.desconto_conta_vinculada || 0, saldo, dias === null ? "—" : String(dias),
      ];
    }),
    rodape: ordenadas.length <= LIMITE_LINHAS
      ? ["Total", "", "", "",
        r2(mostradas.reduce((s, n) => s + (n.vlr_bruto_total || 0), 0)), r2(mostradas.reduce((s, n) => s + (n.vlr_liquido_total || 0), 0)),
        r2(mostradas.reduce((s, n) => s + (n.valor_pago ?? 0), 0)), r2(mostradas.reduce((s, n) => s + (n.desconto_conta_vinculada || 0), 0)),
        r2(mostradas.reduce((s, n) => s + aReceberDaNf(n), 0)), ""]
      : undefined,
    nota: ordenadas.length > LIMITE_LINHAS ? `Mostrando as ${LIMITE_LINHAS} maiores de ${ordenadas.length.toLocaleString("pt-BR")} notas.` : undefined,
  };
}

/** Escada do bruto até o saldo; `destacar` marca a linha da célula clicada. */
function escadaNotas(t: TotaisFaturamento, destacar?: Metrica): LinhaConta[] {
  const p = ponteAReceber(t);
  const d = (m: Metrica) => destacar === m;
  return [
    { rotulo: "Valor Bruto", valor: r2(t.bruto), destaque: d("bruto"), dica: "Soma do bruto das NFs Código N do recorte." },
    { rotulo: "Descontos da NF", valor: r2(t.descontos), sinal: "-", destaque: d("descontos"), dica: "Bruto − líquido: retenções e descontos da própria nota." },
    { rotulo: "Valor Líquido", valor: p.liquido, sinal: "=", destaque: d("liquido") },
    { rotulo: "Recebido", valor: p.recebido, sinal: "-", destaque: d("recebido"), dica: "Valor pago registrado no Relatório de Serviços." },
    { rotulo: "Conta vinculada", valor: p.contaVinculada, sinal: "-", destaque: d("contaVinculada"), dica: "Retida na nota (Desconto de conta vinculada): não entra em dinheiro, nem é saldo." },
    { rotulo: "Descontos depois da NF", valor: p.posEmissao, sinal: "-", dica: "Multas, glosas e outros descontos aplicados depois da emissão." },
    { rotulo: "Diferença em notas já baixadas", valor: p.diferencaBaixadas, sinal: "-", dica: "Nota com data de pagamento cujo valor pago não fecha com o devido; baixada, não tem saldo (positivo = pago a menos)." },
    { rotulo: "A Receber", valor: p.aReceber, sinal: "=", destaque: d("aReceber") },
  ];
}

/** Monta o que o modal mostra para a métrica clicada no recorte dado. */
export function montarComposicao(metrica: Metrica, escopo: EscopoDetalhe, ctx: ContextoDetalhe): Composicao {
  const titulo = `${ROTULO_METRICA[metrica]} — ${escopo.titulo}`;
  const t = totaisDoEscopo(escopo.nfs);

  if (metrica === "exec" || metrica === "diferenca") {
    const linhas = execDoEscopo(escopo, ctx);
    const exec = r2(linhas.reduce((s, l) => s + l.exec, 0));
    const bruto = r2(t.bruto);
    const semValor = linhas.filter((l) => l.semValor && l.bruto > 0);
    return {
      titulo,
      descricao: "Executável de cada contrato: planilha de custo vigente; sem planilha, o Valor Executado Mensal do cadastro do contrato. Zero depois do fim do contrato.",
      conta: [
        { rotulo: "Valor Exec.", valor: exec, destaque: metrica === "exec" },
        { rotulo: "Valor Bruto faturado", valor: bruto, sinal: "-" },
        { rotulo: "Diferença Exec. × Fat.", valor: r2(exec - bruto), sinal: "=", destaque: metrica === "diferenca", dica: "Positivo = faturou menos do que o executável." },
      ],
      tabela: {
        titulo: `Contratos (${linhas.length.toLocaleString("pt-BR")})`,
        colunas: [{ rotulo: "Contrato", alinhar: "left" }, { rotulo: "Origem do executável", alinhar: "left" }, { rotulo: "Exec." }, { rotulo: "Bruto" }, { rotulo: "Diferença" }],
        linhas: linhas.map((l) => [l.nome, l.fonte, l.exec, l.bruto, r2(l.exec - l.bruto)]),
        rodape: ["Total", "", exec, bruto, r2(exec - bruto)],
      },
      aviso: semValor.length > 0
        ? `${semValor.length} contrato(s) faturaram sem executável: não têm planilha de custo nem Valor Executado Mensal no cadastro (${semValor.slice(0, 3).map((l) => l.nome).join("; ")}${semValor.length > 3 ? "…" : ""}). Preencha o valor no cadastro do contrato para a diferença aparecer.`
        : undefined,
    };
  }

  if (metrica === "despesas") {
    const d = despesasDoEscopo(ctx.custos, escopo, ctx.ligacoes);
    return {
      titulo,
      descricao: `Saídas do Fluxo de Caixa com contrato, pela ${(ctx.baseDespesa === "pagamento" ? "data de pagamento" : "competência")}, sem transferências, aplicações e empréstimos. É o custo usado no Lucro. Contratos de estoque, movimentação financeira, investimento e administrativos (centros de custo da empresa) ficam de fora (padrão pelo nome, ajustável abaixo).`,
      contratosNaColuna: [...d.porContrato.entries()]
        .map(([id, valor]) => ({ id, nome: ctx.contratoNome(id), valor: r2(valor) }))
        .sort((a, b) => b.valor - a.valor),
      classificacoesNaColuna: classificacoesDasLinhas(d.linhas),
      contratosForaDaColuna: escopo.contratoIds
        .map((id) => ({ id, nome: ctx.contratoNome(id), tratamento: tratamentoEfetivo(ctx.contratoNome(id), ctx.tratamentos?.get(id)), origem: (ctx.tratamentos?.has(id) ? "configurado" : "padrao") as "padrao" | "configurado" }))
        .filter((c) => saiDasDespesas(c.tratamento))
        .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")),
      conta: [
        ...d.porRubrica.map((r, i) => ({ rotulo: r.rotulo, valor: r.valor, sinal: i === 0 ? undefined : ("+" as const) })),
        { rotulo: "Despesas", valor: d.total, sinal: "=", destaque: true },
      ],
      tabela: {
        titulo: `Lançamentos do Fluxo de Caixa (${d.linhas.length.toLocaleString("pt-BR")})`,
        colunas: [{ rotulo: "Competência", alinhar: "left" }, { rotulo: "Pagamento", alinhar: "left" }, { rotulo: "Contrato", alinhar: "left" }, { rotulo: "Classificação", alinhar: "left" }, { rotulo: "Descrição", alinhar: "left" }, { rotulo: "Rubrica", alinhar: "left" }, { rotulo: "Valor" }],
        linhas: d.linhas.slice(0, LIMITE_LINHAS).map((l) => [mesAno(l.competencia ?? l.data_pagamento), dia(l.data_pagamento), ctx.contratoNome(l.contrato_id as string), l.classificacao_nome ?? "—", [l.id_malote, l.descricao].filter(Boolean).join(" · ") || "—", l.rubrica, l.valor || 0]),
        nota: d.linhas.length > LIMITE_LINHAS ? `Mostrando os ${LIMITE_LINHAS} maiores lançamentos de ${d.linhas.length.toLocaleString("pt-BR")}; a conta acima soma todos.` : undefined,
      },
    };
  }

  if (metrica === "lucroFat" || metrica === "lucroRec" || metrica === "margem") {
    const d = despesasDoEscopo(ctx.custos, escopo, ctx.ligacoes);
    const lf = lucroBruto(t.liquido, d.total);
    const lr = t.recebido - d.total;
    const liquidoPorContrato = new Map<string, number>();
    for (const n of escopo.nfs) if (notaValidaNoFaturamento(n)) liquidoPorContrato.set(n.contrato_id, (liquidoPorContrato.get(n.contrato_id) ?? 0) + (n.vlr_liquido_total || 0));
    const ids = [...new Set([...liquidoPorContrato.keys(), ...d.porContrato.keys()])];
    const linhas = ids
      .map((id) => {
        const liq = liquidoPorContrato.get(id) ?? 0;
        const desp = d.porContrato.get(id) ?? 0;
        return { nome: ctx.contratoNome(id), liq, desp, lucro: liq - desp, margem: lucroBruto(liq, desp).margem };
      })
      .sort((a, b) => b.liq - a.liq);
    return {
      titulo,
      descricao: "Lucro Faturamento = Valor Líquido − Despesas. Lucro Recebido = Recebido − Despesas. Margem Bruta = Lucro Faturamento ÷ Valor Líquido.",
      conta: [
        { rotulo: "Valor Líquido", valor: r2(t.liquido) },
        { rotulo: "Despesas", valor: d.total, sinal: "-" },
        { rotulo: "Lucro Faturamento", valor: r2(lf.lucro), sinal: "=", destaque: metrica === "lucroFat" },
        { rotulo: "Margem Bruta (Lucro Faturamento ÷ Líquido)", valor: pct(lf.margem), destaque: metrica === "margem" },
        { rotulo: "Recebido", valor: r2(t.recebido) },
        { rotulo: "Despesas", valor: d.total, sinal: "-" },
        { rotulo: "Lucro Recebido", valor: r2(lr), sinal: "=", destaque: metrica === "lucroRec" },
      ],
      tabela: {
        titulo: `Por contrato (${linhas.length.toLocaleString("pt-BR")})`,
        colunas: [{ rotulo: "Contrato", alinhar: "left" }, { rotulo: "Líquido" }, { rotulo: "Despesas" }, { rotulo: "Lucro" }, { rotulo: "Margem" }],
        linhas: linhas.map((l) => [l.nome, r2(l.liq), r2(l.desp), r2(l.lucro), pct(l.margem)]),
        rodape: ["Total", r2(t.liquido), d.total, r2(lf.lucro), pct(lf.margem)],
      },
    };
  }

  // bruto, descontos, líquido, recebido, conta vinculada, a receber: a escada do bruto ao saldo + as notas
  return {
    titulo,
    descricao: "NFs Código N validadas, sem canceladas e substituídas. Nota paga (com data de pagamento) não tem saldo a receber.",
    conta: escadaNotas(t, metrica),
    tabela: tabelaNotas(escopo, metrica),
  };
}
