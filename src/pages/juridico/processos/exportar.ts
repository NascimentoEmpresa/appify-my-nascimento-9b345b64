// Jurídico / Processos — Exportar dados (21/09/2026).
//
// O conteúdo: a ficha do processo + tudo o que o detalhe mostra (motivos,
// valores à parte, audiências, propostas, pagamentos do Malote, comprovantes
// anexados e comentários). A forma (Excel/HTML) é do motor comum,
// src/lib/exportarRelatorio.ts — o mesmo do Patrimônio.
//
// O processo chega JÁ AGRUPADO pela tela (uma linha por motivo no banco vira
// um processo) e com os totais calculados por ela — pedidosTotal, custoTotal…
// Recalcular aqui seria a segunda cópia de uma regra que já mudou três vezes
// (valores à parte, destino, custos do processo); o arquivo tem que bater
// com o cartão da tela.

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  type Bloco, type Coluna, type GrupoFicha, type Linha, type ModeloRelatorio,
  excelBlob, htmlBlob, moeda, montarExcel as excelDoModelo, montarHtml as htmlDoModelo,
  num, slug, txt, dataBr,
} from "@/lib/exportarRelatorio";
import { ROTULO_TIPO_PARTE, partes, type TipoParte } from "@/lib/juridico/tipoProcesso";

// Processo "Outros" (SIS-2026-0488): Autor × Réu com tipo e CPF/CNPJ. No
// trabalhista esses campos saem vazios (a ficha só mostra reclamante/reclamada).
const outros = (p: ProcessoExp) => p.tipo_processo === "outros";
const partesExp = (p: ProcessoExp) => partes({
  tipo_processo: txt(p.tipo_processo), reclamante: txt(p.reclamante), reclamada: txt(p.reclamada),
  autor_nome: txt(p.autor_nome), reu_nome: txt(p.reu_nome),
});
const parteTxt = (p: ProcessoExp, lado: "autor" | "reu") => {
  if (!outros(p)) return "";
  const tipo = ROTULO_TIPO_PARTE[txt(p[`${lado}_tipo`]) as TipoParte] ?? "";
  return [txt(p[`${lado}_nome`]), tipo, txt(p[`${lado}_documento`])].filter(Boolean).join(" · ");
};

/** O processo como a tela monta (agrupar) + os totais que ela calcula. */
export type ProcessoExp = Linha & {
  id: number;
  id_sequencial?: number;
  numero_processo: string;
  motivo_items: Linha[];
  valores_a_parte: Linha[];
  audiencias: Linha[];
  propostas: Linha[];
  totais: { pedidos: number; acordo: number; sentenca: number; custoFinal: number; aParte: number };
};

export interface ExtrasProcesso {
  /** numero_processo → comentários */
  comentarios: Map<string, Linha[]>;
  /** id do processo → retorno da jur_processo_pagamentos (malote + anexos) */
  pagamentos: Map<number, { malote: Linha[]; anexos: Linha[] }>;
}

// ── Leitura do que a tela não tem em memória ────────────────────────
async function comentariosDe(db: SupabaseClient, numeros: string[] | null): Promise<Map<string, Linha[]>> {
  const acc: Linha[] = [];
  const PAGINA = 1000;
  for (let de = 0; ; de += PAGINA) {
    let q = db.from("SISTEMA_COMENTARIOS").select("*").eq("modulo", "processo");
    if (numeros) q = q.in("entidade_id", numeros);
    const { data, error } = await q.order("id", { ascending: true }).range(de, de + PAGINA - 1);
    if (error) throw new Error(`comentários: ${error.message}`);
    acc.push(...((data ?? []) as Linha[]));
    if (!data || data.length < PAGINA) break;
  }
  const m = new Map<string, Linha[]>();
  for (const c of acc) { const k = txt(c.entidade_id); (m.get(k) ?? m.set(k, []).get(k)!).push(c); }
  return m;
}

/**
 * Pagamentos do Malote + comprovantes anexados, pela MESMA RPC do detalhe
 * (jur_processo_pagamentos) — é ela que acha a despesa pelo número CNJ no
 * texto do Malote. Uma chamada por processo, 8 de cada vez: os 407 levam uns
 * poucos segundos, com o progresso na tela.
 */
async function pagamentosDe(db: SupabaseClient, ids: number[], progresso?: (feitos: number, total: number) => void) {
  const m = new Map<number, { malote: Linha[]; anexos: Linha[] }>();
  let i = 0, feitos = 0;
  const trabalhador = async () => {
    while (i < ids.length) {
      const id = ids[i++];
      const { data, error } = await db.rpc("jur_processo_pagamentos", { _processo_id: id });
      if (error) throw new Error(`pagamentos do processo #${id}: ${error.message}`);
      const d = (data ?? {}) as { malote?: Linha[]; anexos?: Linha[] };
      m.set(id, { malote: d.malote ?? [], anexos: d.anexos ?? [] });
      progresso?.(++feitos, ids.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(8, ids.length) }, trabalhador));
  return m;
}

export async function carregarExtras(db: SupabaseClient, processos: ProcessoExp[], progresso?: (msg: string) => void): Promise<ExtrasProcesso> {
  const umSo = processos.length === 1;
  const [comentarios, pagamentos] = await Promise.all([
    comentariosDe(db, umSo ? [processos[0].numero_processo] : null),
    pagamentosDe(db, processos.map(p => p.id), (f, t) => progresso?.(`Pagamentos do Malote ${f}/${t}…`)),
  ]);
  return { comentarios, pagamentos };
}

// ── O que sai, e com que nome ───────────────────────────────────────
const FICHA: GrupoFicha<ProcessoExp>[] = [
  { grupo: "Identificação", campos: [
    { rotulo: "ID", valor: p => (p.id_sequencial ? `#${p.id_sequencial}` : "") },
    { rotulo: "Número do processo", valor: p => p.numero_processo },
    { rotulo: "Ano", valor: p => p.ano_processo || "" },
    { rotulo: "Status do processo", valor: p => p.status, selo: true },
    { rotulo: "Entrada da reclamatória", tipo: "data", valor: p => p.data_entrada_reclamatoria },
  ] },
  { grupo: "Partes", campos: [
    { rotulo: "Tipo de processo", valor: p => (outros(p) ? "Outros" : "Processo Trabalhista") },
    { rotulo: "Natureza da ação", valor: p => (outros(p) ? p.natureza_acao : "") },
    { rotulo: "Autor", valor: p => parteTxt(p, "autor") },
    { rotulo: "Réu", valor: p => parteTxt(p, "reu") },
    { rotulo: "Reclamante", valor: p => (outros(p) ? "" : p.reclamante) },
    { rotulo: "CPF do reclamante (vínculo)", valor: p => p.reclamante_vinculado_cpf },
    { rotulo: "Reclamada", valor: p => (outros(p) ? "" : p.reclamada) },
    { rotulo: "Contrato", valor: p => p.contrato },
  ] },
  { grupo: "Local", campos: [
    { rotulo: "Comarca", valor: p => p.comarca },
    { rotulo: "Município de origem", valor: p => p.municipio_origem },
  ] },
  { grupo: "Andamento", campos: [
    { rotulo: "Status da sentença", valor: p => p.status_sentenca, selo: true },
    { rotulo: "Status dos recursos", valor: p => p.status_recursos },
    { rotulo: "Houve acordo", valor: p => p.houve_acordo },
    { rotulo: "Motivo do acordo", valor: p => p.motivo_acordo },
    { rotulo: "Vai recorrer", valor: p => p.vai_recorrer },
  ] },
  { grupo: "Perícia", campos: [
    { rotulo: "Haverá perícia", valor: p => p.havera_pericia },
    { rotulo: "Data da perícia", tipo: "data", valor: p => p.data_pericia },
    { rotulo: "Hora da perícia", valor: p => txt(p.hora_pericia).slice(0, 5) },
    { rotulo: "Local da perícia", valor: p => p.local_pericia },
    { rotulo: "Houve perícia médica", valor: p => p.houve_pericia_medica },
  ] },
  { grupo: "Valores", campos: [
    { rotulo: "Valor da causa", tipo: "moeda", valor: p => num(p.valor_causa) || "" },
    { rotulo: "Pedidos", tipo: "moeda", valor: p => p.totais.pedidos },
    { rotulo: "Acordo", tipo: "moeda", valor: p => p.totais.acordo },
    { rotulo: "Sentença", tipo: "moeda", valor: p => p.totais.sentenca },
    { rotulo: "Custo final", tipo: "moeda", valor: p => p.totais.custoFinal },
    { rotulo: "Total de valores à parte", tipo: "moeda", valor: p => p.totais.aParte || "" },
  ] },
  { grupo: "Custos do processo", campos: [
    { rotulo: "Outros custos", tipo: "moeda", valor: p => num(p.valor_outros_custos) || "" },
    { rotulo: "Motivo dos outros custos", valor: p => p.motivos_outros_custos },
    { rotulo: "Depósito recursal", tipo: "moeda", valor: p => num(p.valor_deposito_recursal) || "" },
    { rotulo: "Custas processuais", tipo: "moeda", valor: p => num(p.valor_custas_processuais) || "" },
    { rotulo: "Custas recursais", tipo: "moeda", valor: p => num(p.valor_custas_recursais) || "" },
    { rotulo: "Seguro garantia", tipo: "moeda", valor: p => num(p.valor_seguro_garantia) || "" },
    { rotulo: "Perito judicial", tipo: "moeda", valor: p => num(p.valor_perito_judicial) || "" },
    { rotulo: "Assistente técnico/médico", tipo: "moeda", valor: p => num(p.valor_assistente_tecnico) || "" },
  ] },
];

const VALORES_MOTIVO = ["valor_pedidos", "valor_acordo", "valor_sentenca", "valor_final", "valor_outros_custos", "valor_deposito_recursal", "valor_custas_processuais"];
const moedaOuVazio = (v: unknown) => num(v) || "";
const COLUNAS_MOTIVOS: Coluna[] = [
  { rotulo: "Motivo", valor: m => m.motivo },
  { rotulo: "Pedidos", tipo: "moeda", valor: m => moedaOuVazio(m.valor_pedidos) },
  { rotulo: "Acordo", tipo: "moeda", valor: m => moedaOuVazio(m.valor_acordo) },
  { rotulo: "Sentença", tipo: "moeda", valor: m => moedaOuVazio(m.valor_sentenca) },
  { rotulo: "Valor final", tipo: "moeda", valor: m => moedaOuVazio(m.valor_final) },
  { rotulo: "Outros custos", tipo: "moeda", valor: m => moedaOuVazio(m.valor_outros_custos) },
  { rotulo: "Depósito recursal", tipo: "moeda", valor: m => moedaOuVazio(m.valor_deposito_recursal) },
  { rotulo: "Custas processuais", tipo: "moeda", valor: m => moedaOuVazio(m.valor_custas_processuais) },
  { rotulo: "Total do motivo", tipo: "moeda", valor: m => VALORES_MOTIVO.reduce((s, k) => s + (num(m[k]) ?? 0), 0) },
];

const DESTINO: Record<string, string> = { pedidos: "Pedidos", acordo: "Acordo", sentenca: "Sentença", custo_final: "Custo final" };
const COLUNAS_A_PARTE: Coluna[] = [
  { rotulo: "Motivo", valor: v => v.motivo },
  { rotulo: "Descrição", valor: v => v.descricao },
  { rotulo: "Soma em", valor: v => DESTINO[txt(v.destino)] ?? "Custo final" },
  { rotulo: "Valor", tipo: "moeda", valor: v => v.valor },
];

const resumoProposta = (pr: Linha) =>
  [`${txt(pr.quem) || "Juiz"} · ${txt(pr.tipo) || "Judicial"}`, num(pr.valor) ? moeda(pr.valor) : "", txt(pr.descricao)].filter(Boolean).join(" — ");
const COLUNAS_AUDIENCIAS: Coluna[] = [
  { rotulo: "Data", tipo: "data", valor: a => a.data },
  { rotulo: "Horário", valor: a => a.horario },
  { rotulo: "Tipo", valor: a => a.tipo_audiencia },
  { rotulo: "Modalidade", valor: a => a.modalidade_audiencia },
  { rotulo: "Propostas na audiência", valor: a => ((a.propostas as Linha[] | undefined) ?? []).map(resumoProposta).join("\n") },
];

const COLUNAS_PROPOSTAS: Coluna[] = [
  { rotulo: "Quando", tipo: "data", valor: p => p.data },
  { rotulo: "Onde", valor: p => p.onde },
  { rotulo: "De quem", valor: p => p.quem },
  { rotulo: "Tipo", valor: p => p.tipo },
  { rotulo: "Valor", tipo: "moeda", valor: p => moedaOuVazio(p.valor) },
  { rotulo: "Descrição", valor: p => p.descricao },
];

const COLUNAS_MALOTE: Coluna[] = [
  { rotulo: "Despesa", valor: d => d.numero },
  { rotulo: "Nome", valor: d => d.nome },
  { rotulo: "Status", valor: d => d.status, selo: true },
  { rotulo: "Valor total", tipo: "moeda", valor: d => d.valor_total },
  { rotulo: "Valor aprovado", tipo: "moeda", valor: d => d.valor_aprovado },
  { rotulo: "Data de pagamento", tipo: "data", valor: d => d.data_pagamento },
  { rotulo: "Pago em", tipo: "datahora", valor: d => d.pago_em },
  { rotulo: "Forma de pagamento", valor: d => d.forma_pagamento },
  { rotulo: "Parcelas", valor: d => {
    const ps = (d.parcelas as Linha[] | undefined) ?? [];
    if (!ps.length) return "";
    const pagas = ps.filter(p => p.pago_em || p.data_pagamento_real || /pag/i.test(txt(p.status))).length;
    return `${pagas} de ${ps.length} paga(s)`;
  } },
  { rotulo: "Comprovante no Malote", valor: d => (d.comprovante_path || ((d.parcelas as Linha[] | undefined) ?? []).some(p => p.comprovante_path) ? "Sim" : "Não") },
  { rotulo: "Como entrou", valor: d => (d.origem === "malote_manual" ? "Vinculado à mão" : "Pelo nº do processo no Malote") },
  { rotulo: "Observação do pagamento", valor: d => d.observacao_pagamento },
];

const COLUNAS_ANEXOS: Coluna[] = [
  { rotulo: "Arquivo", valor: c => c.nome },
  { rotulo: "Descrição", valor: c => c.descricao },
  { rotulo: "Valor", tipo: "moeda", valor: c => c.valor },
  { rotulo: "Data do pagamento", tipo: "data", valor: c => c.data_pagamento },
  { rotulo: "Enviado por", valor: c => c.criado_por_nome },
  { rotulo: "Enviado em", tipo: "datahora", valor: c => c.created_at },
];

const COLUNAS_COMENTARIOS: Coluna[] = [
  { rotulo: "Quando", tipo: "datahora", valor: c => c.created_at },
  { rotulo: "Autor", valor: c => c.autor_nome },
  { rotulo: "Comentário", valor: c => c.texto },
];

const somaHtml = (rotulo: string, campo: string) => (linhas: Linha[]) =>
  `<div class="tot">${rotulo}: <b>${moeda(linhas.reduce((s, l) => s + (num(l[campo]) ?? 0), 0))}</b></div>`;

function blocos(extras: ExtrasProcesso): Bloco<ProcessoExp>[] {
  const recentes = (a: Linha, b: Linha) => txt(b.created_at).localeCompare(txt(a.created_at));
  return [
    { titulo: "Motivos", aba: "Motivos", colunas: COLUNAS_MOTIVOS, linhas: p => p.motivo_items },
    { titulo: "Valores à parte", aba: "Valores à parte", colunas: COLUNAS_A_PARTE, linhas: p => p.valores_a_parte,
      resumoHtml: somaHtml("Total à parte", "valor") },
    { titulo: "Audiências", aba: "Audiências", colunas: COLUNAS_AUDIENCIAS, linhas: p => p.audiencias },
    { titulo: "Propostas de acordo", aba: "Propostas", colunas: COLUNAS_PROPOSTAS, linhas: p => [
      // As da audiência dizem de qual audiência saíram; as outras, "no decorrer".
      ...p.audiencias.flatMap(a => ((a.propostas as Linha[] | undefined) ?? []).map(pr => ({
        ...pr, data: pr.data || a.data, onde: `Audiência de ${dataBr(a.data)}${a.tipo_audiencia ? ` (${txt(a.tipo_audiencia)})` : ""}`,
      }))),
      ...p.propostas.map(pr => ({ ...pr, onde: "No decorrer do processo" })),
    ] },
    { titulo: "Pagamentos do Malote", aba: "Pagamentos (Malote)", colunas: COLUNAS_MALOTE,
      linhas: p => extras.pagamentos.get(p.id)?.malote ?? [], resumoHtml: somaHtml("Total das despesas", "valor_total") },
    { titulo: "Comprovantes anexados", aba: "Comprovantes anexados", colunas: COLUNAS_ANEXOS,
      linhas: p => extras.pagamentos.get(p.id)?.anexos ?? [] },
    { titulo: "Comentários", aba: "Comentários", colunas: COLUNAS_COMENTARIOS,
      linhas: p => [...(extras.comentarios.get(p.numero_processo) ?? [])].sort(recentes) },
  ];
}

function modelo(processos: ProcessoExp[], extras: ExtrasProcesso, autor: string): ModeloRelatorio<ProcessoExp> {
  const soma = (f: (p: ProcessoExp) => number) => processos.reduce((s, p) => s + f(p), 0);
  const titulo = (p: ProcessoExp) => `${p.id_sequencial ? `#${p.id_sequencial} · ` : ""}${p.numero_processo}`;
  return {
    modulo: "Jurídico · Processos trabalhistas",
    itens: processos,
    nome: { um: "processo", varios: "processos" },
    tituloTodos: "Relatório completo de processos",
    tituloUm: p => `Processo ${titulo(p)}`,
    ancora: p => `proc-${p.id}`,
    cabecalho: p => ({
      eyebrow: titulo(p),
      titulo: txt(partesExp(p).nome1) || `${partesExp(p).rotulo1} não informado`,
      sub: [`${partesExp(p).rotulo2}: ${txt(partesExp(p).nome2) || "—"}`, outros(p) ? txt(p.natureza_acao) : "", p.comarca, p.ano_processo].map(txt).filter(Boolean).join(" · "),
      selos: [p.status, p.status_sentenca ? `Sentença: ${txt(p.status_sentenca)}` : ""],
    }),
    destaques: p => [
      ["Pedidos", moeda(p.totais.pedidos)],
      ["Acordo", moeda(p.totais.acordo)],
      ["Sentença", moeda(p.totais.sentenca)],
      ["Custo final", moeda(p.totais.custoFinal)],
    ],
    ficha: FICHA,
    blocos: blocos(extras),
    resumo: [
      { rotulo: "Total de processos", valor: processos.length },
      { rotulo: "Em andamento", valor: processos.filter(p => p.status !== "ARQUIVADO").length },
      { rotulo: "Arquivados", valor: processos.filter(p => p.status === "ARQUIVADO").length },
      { rotulo: "Pedidos", valor: soma(p => p.totais.pedidos), tipo: "moeda" },
      { rotulo: "Acordos", valor: soma(p => p.totais.acordo), tipo: "moeda" },
      { rotulo: "Sentenças", valor: soma(p => p.totais.sentenca), tipo: "moeda" },
      { rotulo: "Custo final", valor: soma(p => p.totais.custoFinal), tipo: "moeda" },
    ],
    indice: [
      { rotulo: "ID", valor: p => (p.id_sequencial ? `#${p.id_sequencial}` : "") },
      { rotulo: "Número do processo", valor: p => p.numero_processo },
      { rotulo: "Reclamante / autor", valor: p => p.reclamante },
      { rotulo: "Reclamada / réu", valor: p => p.reclamada },
      { rotulo: "Tipo", valor: p => (outros(p) ? "Outros" : "Trabalhista") },
      { rotulo: "Status", valor: p => p.status, selo: true },
      { rotulo: "Custo final", tipo: "moeda", valor: p => p.totais.custoFinal },
    ],
    identificacao: [
      { rotulo: "ID", valor: p => (p.id_sequencial ? `#${p.id_sequencial}` : "") },
      { rotulo: "Número do processo", valor: p => p.numero_processo },
      { rotulo: "Reclamante", valor: p => p.reclamante },
    ],
    notas: [
      ["Custo final", "Mesma conta do cartão da tela: o valor final lançado, ou acordo + sentença + custos do processo + valores à parte."],
      ["Pagamentos do Malote", "Despesas achadas pelo número do processo no Malote, mais as vinculadas à mão."],
    ],
    rodape: "Comprovantes aparecem só como registro — os arquivos continuam no ERP.",
    autor,
  };
}

export const montarExcel = (ps: ProcessoExp[], ex: ExtrasProcesso, autor: string) => excelDoModelo(modelo(ps, ex, autor));
export const montarHtml = (ps: ProcessoExp[], ex: ExtrasProcesso, autor: string) => htmlDoModelo(modelo(ps, ex, autor));
export const gerarExcel = (ps: ProcessoExp[], ex: ExtrasProcesso, autor: string) => excelBlob(montarExcel(ps, ex, autor));
export const gerarHtml = (ps: ProcessoExp[], ex: ExtrasProcesso, autor: string) => htmlBlob(montarHtml(ps, ex, autor));

/** "processo-123-0020035-59-2024-5-04-0001-2026-09-21" ou "processos-completo-…". */
export function nomeArquivo(ps: ProcessoExp[]): string {
  const dia = new Date().toISOString().slice(0, 10);
  if (ps.length !== 1) return `processos-completo-${dia}`;
  const p = ps[0];
  return ["processo", p.id_sequencial ? String(p.id_sequencial) : "", slug(p.numero_processo, 30), dia].filter(Boolean).join("-");
}
