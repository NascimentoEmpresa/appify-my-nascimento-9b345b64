// SIS-2026-0671: "Lista final" da Emissão de NF — a primeira aba da planilha modelo ("Lista NFs"), uma linha por variação
// de NF do contrato na competência, com o valor mensal total e as faltas, antes de enviar ao Financeiro (e em lote).
// Regras puras; a tela só junta as fontes (NFs, itens, executável do contrato e variações do modelo).
import { temVariaveis } from "./descricaoVariaveis";

export interface NfDaLista {
  id: string;
  variacao: string | null;
  competencia: string;
  numero_nf: string | null;
  data_emissao: string | null;
  tipo_nota: string;
  status: "rascunho" | "enviada" | "concluida" | "cancelada";
  descricao?: string | null;
  situacao_site_pmt?: string | null;
  situacao_dominio?: string | null;
  valor_contrato_exec_total: number;
  vlr_bruto_total: number;
  vlr_liquido_total: number;
  issqn_total: number;
  inss_total: number;
  ir_total: number;
  cofins_total: number;
  pis_total: number;
  csll_total: number;
  desconto_conta_vinculada: number;
}

export interface ItemDaLista {
  nf_emissao_id: string;
  identificacao?: string | null;
  faltas: number;
  posto_nao_implementado: number;
  multas: number;
  glosas: number;
  outros_descontos: number;
  multas_pos_emissao: number;
  glosas_pos_emissao: number;
  outros_descontos_pos_emissao: number;
  justificativa_multas?: string | null;
  justificativa_glosas?: string | null;
  justificativa_outros_descontos?: string | null;
}

export interface LinhaLista {
  nf: NfDaLista;
  exec: number;
  contabil: number;
  liquido: number;
  retencoes: number;
  faltas: number;
  postoNaoImplementado: number;
  multasAntes: number;
  multasDepois: number;
  glosasAntes: number;
  glosasDepois: number;
  outrosAntes: number;
  outrosDepois: number;
  contaVinculada: number;
  /** multas + glosas + outros aplicados ANTES da emissão (já reduzem o líquido) */
  descontosAntes: number;
  /** multas + glosas + outros DEPOIS da emissão (não estão no líquido) */
  descontosDepois: number;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const soma = (itens: ItemDaLista[], f: (i: ItemDaLista) => number) => r2(itens.reduce((s, i) => s + (Number(f(i)) || 0), 0));

export function linhaDaLista(nf: NfDaLista, itens: ItemDaLista[]): LinhaLista {
  const multasAntes = soma(itens, (i) => i.multas);
  const glosasAntes = soma(itens, (i) => i.glosas);
  const outrosAntes = soma(itens, (i) => i.outros_descontos);
  const multasDepois = soma(itens, (i) => i.multas_pos_emissao);
  const glosasDepois = soma(itens, (i) => i.glosas_pos_emissao);
  const outrosDepois = soma(itens, (i) => i.outros_descontos_pos_emissao);
  return {
    nf,
    exec: r2(nf.valor_contrato_exec_total || 0),
    contabil: r2(nf.vlr_bruto_total || 0),
    liquido: r2(nf.vlr_liquido_total || 0),
    retencoes: r2((nf.issqn_total || 0) + (nf.inss_total || 0) + (nf.ir_total || 0) + (nf.cofins_total || 0) + (nf.pis_total || 0) + (nf.csll_total || 0)),
    faltas: soma(itens, (i) => i.faltas),
    postoNaoImplementado: soma(itens, (i) => i.posto_nao_implementado),
    multasAntes, multasDepois, glosasAntes, glosasDepois, outrosAntes, outrosDepois,
    contaVinculada: r2(nf.desconto_conta_vinculada || 0),
    descontosAntes: r2(multasAntes + glosasAntes + outrosAntes),
    descontosDepois: r2(multasDepois + glosasDepois + outrosDepois),
  };
}

/** NF cancelada (pelo Financeiro ou na planilha) ou substituída não entra nos totais: não vai gerar pagamento. */
export function entraNosTotais(nf: Pick<NfDaLista, "status" | "situacao_site_pmt" | "situacao_dominio">): boolean {
  if (nf.status === "cancelada") return false;
  const esp = `${nf.situacao_site_pmt ?? ""} ${nf.situacao_dominio ?? ""}`.toUpperCase();
  return !esp.includes("CANCEL") && !esp.includes("SUBSTIT");
}

export type TotaisLista = Omit<LinhaLista, "nf"> & { notas: number };

export function totaisDaLista(linhas: LinhaLista[]): TotaisLista {
  const t: TotaisLista = {
    exec: 0, contabil: 0, liquido: 0, retencoes: 0, faltas: 0, postoNaoImplementado: 0, multasAntes: 0, multasDepois: 0,
    glosasAntes: 0, glosasDepois: 0, outrosAntes: 0, outrosDepois: 0, contaVinculada: 0, descontosAntes: 0, descontosDepois: 0, notas: 0,
  };
  for (const l of linhas) {
    if (!entraNosTotais(l.nf)) continue;
    t.notas += 1;
    for (const k of Object.keys(t) as (keyof TotaisLista)[]) {
      if (k !== "notas") t[k] = r2(t[k] + (l[k as keyof LinhaLista] as number));
    }
  }
  return t;
}

export interface ConferenciaMes {
  executavel: number;
  /** soma do valor do contrato exec. das NFs Código N da lista (as que contam no faturamento) */
  emitido: number;
  /** executável − emitido; positivo = falta emitir, negativo = emitiu acima do executável */
  diferenca: number;
  /** variações do modelo do contrato que ainda não têm NF nesta competência */
  variacoesSemNf: string[];
}

/** Conferência do mês: o que o contrato deveria faturar (executável) × o que já está nas NFs Código N da lista. */
export function conferenciaDoMes(linhas: LinhaLista[], executavel: number, variacoesDoModelo: (string | null)[]): ConferenciaMes {
  const doN = linhas.filter((l) => l.nf.tipo_nota === "N" && entraNosTotais(l.nf));
  const emitido = r2(doN.reduce((s, l) => s + l.exec, 0));
  const comNf = new Set(linhas.filter((l) => entraNosTotais(l.nf)).map((l) => l.nf.variacao ?? ""));
  return {
    executavel: r2(executavel),
    emitido,
    diferenca: r2(executavel - emitido),
    variacoesSemNf: variacoesDoModelo.filter((v) => !comNf.has(v ?? "")).map((v) => v ?? "(sem nome)"),
  };
}

/**
 * O que impede enviar a NF ao Financeiro (lista vazia = pode enviar). São as mesmas exigências do envio pela tela de
 * emissão: data de emissão, descrição sem variáveis {…} soltas, itens e justificativa para multas, glosas e outros
 * descontos (SIS-2026-0578).
 */
export function problemasParaEnviar(nf: NfDaLista, itens: ItemDaLista[]): string[] {
  const p: string[] = [];
  if (nf.status !== "rascunho") return ["Já foi enviada ao Financeiro."];
  if (!nf.data_emissao) p.push("Sem data de emissão.");
  if (!(nf.descricao ?? "").trim()) p.push("Sem descrição.");
  else if (temVariaveis(nf.descricao ?? "")) p.push("A descrição ainda tem variáveis {…} sem preencher.");
  if (itens.length === 0) p.push("Sem itens.");
  for (const i of itens) {
    const nome = i.identificacao || "item";
    if ((i.multas || 0) > 0 && !(i.justificativa_multas ?? "").trim()) p.push(`Falta a justificativa das multas (${nome}).`);
    if ((i.glosas || 0) > 0 && !(i.justificativa_glosas ?? "").trim()) p.push(`Falta a justificativa das glosas (${nome}).`);
    if ((i.outros_descontos || 0) > 0 && !(i.justificativa_outros_descontos ?? "").trim()) p.push(`Falta a justificativa dos outros descontos (${nome}).`);
  }
  return p;
}

/** Competência mais indicada para abrir a lista: a mais recente com rascunho; senão a mais recente com NF; senão a sugerida. */
export function competenciaInicialDaLista(nfs: Pick<NfDaLista, "competencia" | "status">[], sugerida: string): string {
  const rasc = nfs.filter((n) => n.status === "rascunho").map((n) => n.competencia.slice(0, 7)).sort();
  if (rasc.length) return rasc[rasc.length - 1];
  const todas = nfs.map((n) => n.competencia.slice(0, 7)).sort();
  return todas.length ? todas[todas.length - 1] : sugerida;
}
