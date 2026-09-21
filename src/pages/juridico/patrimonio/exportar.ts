// Jurídico / Patrimônio — Exportar dados (21/09/2026).
//
// O conteúdo da exportação: a ficha do bem + as sete abas do drawer (contas,
// parcelas, acessos, contatos, documentos, histórico, comentários). A forma
// (Excel ou HTML) mora no motor comum, src/lib/exportarRelatorio.ts — o mesmo
// que os Processos usam.
//
// Exporta o que a pessoa já enxerga na tela: as consultas passam pelo mesmo
// RLS. Documento sai só como registro (nome, tipo, quem enviou) — o arquivo
// continua no storage, não vai dentro da exportação.

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  type Bloco, type Coluna, type GrupoFicha, type Linha, type ModeloRelatorio,
  baixar, dataBr, excelBlob, htmlBlob, moeda, montarExcel as excelDoModelo, montarHtml as htmlDoModelo,
  num, simNao, slug, txt,
} from "@/lib/exportarRelatorio";
import { rotuloTipoLancamento, ehContratoParcelado, mapaValorQueFalta } from "./parcelas";

export { baixar };
export type { Linha };

export interface DadosExportacao {
  patrimonios: Linha[];
  obrigacoes: Linha[];
  parcelas: Linha[];
  itens: Linha[];        // JUR_PATRIMONIO_ITENS: acesso/contato/documento/historico
  comentarios: Linha[];  // SISTEMA_COMENTARIOS (modulo = 'patrimonio')
}

export interface OpcoesExportacao {
  /** Selo da conta já com o "pago" do Malote — o mesmo que a tela mostra. */
  seloDaConta: (o: Linha) => string;
  /** Quem exportou (vai no cabeçalho). */
  autor: string;
}

// ── Leitura ─────────────────────────────────────────────────────────
/**
 * Traz TODAS as linhas, em páginas de 1.000 — o PostgREST corta a resposta
 * em 1.000 sem avisar, e só as contas já passam de 1.400.
 */
async function todas(db: SupabaseClient, tabela: string, filtro: (q: any) => any): Promise<Linha[]> {
  const PAGINA = 1000;
  const acc: Linha[] = [];
  for (let de = 0; ; de += PAGINA) {
    const { data, error } = await filtro(db.from(tabela).select("*"))
      .order("id", { ascending: true }).range(de, de + PAGINA - 1);
    if (error) throw new Error(`${tabela}: ${error.message}`);
    acc.push(...((data ?? []) as Linha[]));
    if (!data || data.length < PAGINA) break;
  }
  return acc;
}

/** `patrimonioId` null = todos. */
export async function carregarDadosExportacao(db: SupabaseClient, patrimonioId: number | null): Promise<DadosExportacao> {
  const doPat = (q: any) => (patrimonioId == null ? q : q.eq("patrimonio_id", patrimonioId));
  const [patrimonios, obrigacoes, parcelas, itens, comentarios] = await Promise.all([
    todas(db, "JUR_PATRIMONIOS", q => (patrimonioId == null ? q : q.eq("id", patrimonioId))),
    todas(db, "JUR_PATRIMONIO_OBRIGACOES", doPat),
    todas(db, "JUR_PATRIMONIO_PARCELAS", doPat),
    todas(db, "JUR_PATRIMONIO_ITENS", doPat),
    todas(db, "SISTEMA_COMENTARIOS", q => {
      const base = q.eq("modulo", "patrimonio");
      return patrimonioId == null ? base : base.eq("entidade_id", String(patrimonioId));
    }),
  ]);
  // Mesma ordem da lista da tela: código numérico crescente.
  patrimonios.sort((a, b) => ordemCodigo(a) - ordemCodigo(b) || txt(a.descricao).localeCompare(txt(b.descricao), "pt-BR"));
  return { patrimonios, obrigacoes, parcelas, itens, comentarios };
}

const ordemCodigo = (p: Linha) => {
  const n = parseInt(String(p.codigo ?? "").replace(/\D/g, ""), 10);
  return isNaN(n) ? Number.MAX_SAFE_INTEGER : n;
};

// ── O que sai, e com que nome ───────────────────────────────────────
/** A ficha do patrimônio, agrupada como uma pessoa leria. */
const FICHA: GrupoFicha<Linha>[] = [
  { grupo: "Identificação", campos: [
    { rotulo: "Código", valor: p => p.codigo },
    { rotulo: "Descrição", valor: p => p.descricao },
    { rotulo: "Tipo", valor: p => p.tipo },
    { rotulo: "Classificação", valor: p => p.classificacao },
    { rotulo: "Status do cadastro", valor: p => p.status, selo: true },
    { rotulo: "Placa", valor: p => p.placa },
  ] },
  { grupo: "Localização", campos: [
    { rotulo: "Endereço / localização", valor: p => p.localizacao },
    { rotulo: "Cidade", valor: p => p.cidade },
    { rotulo: "Coordenadas", valor: p => (p.latitude != null && p.longitude != null ? `${p.latitude}, ${p.longitude}` : "") },
  ] },
  { grupo: "Titularidade e responsáveis", campos: [
    { rotulo: "Proprietário", valor: p => p.proprietario },
    { rotulo: "Empresa", valor: p => p.empresa },
    { rotulo: "Empresa pagadora", valor: p => p.empresa_pagadora },
    { rotulo: "Responsável", valor: p => p.responsavel },
    { rotulo: "Centro de custo", valor: p => p.centro_custo },
    { rotulo: "Transferência concluída", valor: p => simNao(p.transferida) },
  ] },
  { grupo: "Documentação", campos: [
    { rotulo: "Matrícula", valor: p => p.matricula },
    { rotulo: "Possui escritura", valor: p => (p.possui_escritura == null ? "Não informado" : simNao(p.possui_escritura)) },
    { rotulo: "Espécie da escritura", valor: p => p.especie_escritura },
  ] },
  { grupo: "Carteira e valores", campos: [
    { rotulo: "Situação do pagamento", valor: p => p.situacao_pagamento, selo: true },
    { rotulo: "Valor do contrato", tipo: "moeda", valor: p => p.valor_contrato },
    { rotulo: "Valor de entrada", tipo: "moeda", valor: p => p.valor_entrada },
    { rotulo: "Valor total", tipo: "moeda", valor: p => p.valor_total },
    { rotulo: "Valor estimado", tipo: "moeda", valor: p => p.valor_estimado },
    { rotulo: "Comissão", tipo: "moeda", valor: p => p.comissao },
    { rotulo: "Reforços pagos", tipo: "moeda", valor: p => p.reforcos_pagos },
    { rotulo: "Reforços a pagar", tipo: "moeda", valor: p => p.reforcos_a_pagar },
    { rotulo: "Valor da parcela", tipo: "moeda", valor: p => p.valor_parcela },
    { rotulo: "Quantidade de parcelas", tipo: "inteiro", valor: p => p.qtd_parcelas },
    { rotulo: "Parcelas pagas", tipo: "inteiro", valor: p => p.parcelas_pagas },
    { rotulo: "Parcelas que faltam", tipo: "inteiro", valor: p => p.parcelas_falta },
    { rotulo: "Valor que falta pagar", tipo: "moeda", valor: p => p.valor_falta },
    { rotulo: "Próxima parcela", tipo: "data", valor: p => p.proxima_parcela },
  ] },
  { grupo: "Observações", campos: [
    { rotulo: "Onde pagar", valor: p => p.onde_pagar },
    { rotulo: "Observações", valor: p => p.observacoes },
    { rotulo: "Anotações", valor: p => p.anotacoes },
  ] },
  { grupo: "Registro", campos: [
    { rotulo: "Cadastrado em", tipo: "datahora", valor: p => p.created_at },
    { rotulo: "Última atualização", tipo: "datahora", valor: p => p.updated_at },
  ] },
];

const colunasContas = (seloDaConta: (o: Linha) => string): Coluna[] => [
  { rotulo: "Categoria", valor: o => o.categoria },
  { rotulo: "Lançamento", valor: o => (ehContratoParcelado(txt(o.categoria)) ? rotuloTipoLancamento(txt(o.tipo_lancamento) || "parcela") : "") },
  { rotulo: "Parcela", valor: o => (o.parcela_numero != null ? `${o.parcela_numero}/${o.parcela_total ?? "?"}` : "") },
  { rotulo: "Descrição", valor: o => o.descricao },
  { rotulo: "Valor", tipo: "moeda", valor: o => o.valor },
  { rotulo: "Entrada", tipo: "moeda", valor: o => o.valor_entrada },
  { rotulo: "Vencimento", tipo: "data", valor: o => o.vencimento },
  { rotulo: "Periodicidade", valor: o => o.periodicidade },
  { rotulo: "Situação", valor: o => seloDaConta(o), selo: true },
  { rotulo: "Pago em", tipo: "data", valor: o => o.pago_em },
  { rotulo: "Forma de pagamento", valor: o => o.forma_pagamento },
  { rotulo: "Onde pagar", valor: o => o.onde_pagar },
  { rotulo: "Responsável", valor: o => o.responsavel },
  { rotulo: "Seguradora", valor: o => o.seguradora },
  { rotulo: "Apólice", valor: o => o.apolice },
  { rotulo: "Vigência (início)", tipo: "data", valor: o => o.vigencia_inicio },
  { rotulo: "Vigência (fim)", tipo: "data", valor: o => o.vigencia_fim },
  { rotulo: "Prêmio", tipo: "moeda", valor: o => o.premio },
  { rotulo: "Comprovante", valor: o => o.comprovante_nome },
  { rotulo: "Enviado ao Malote em", tipo: "datahora", valor: o => o.enviado_malote_em },
];
const COLUNAS_PARCELAS: Coluna[] = [
  { rotulo: "Nº", tipo: "inteiro", valor: p => p.numero },
  { rotulo: "Parcela", valor: p => p.rotulo },
  { rotulo: "Vencimento", tipo: "data", valor: p => p.vencimento },
  { rotulo: "Valor", tipo: "moeda", valor: p => p.valor },
  { rotulo: "Valor pago", tipo: "moeda", valor: p => p.valor_pago },
  { rotulo: "Situação", valor: p => p.situacao, selo: true },
];
const COLUNAS_ACESSOS: Coluna[] = [
  { rotulo: "Serviço", valor: a => a.servico },
  { rotulo: "Link", valor: a => a.link },
  { rotulo: "Usuário", valor: a => a.usuario },
  { rotulo: "Onde está a senha", valor: a => a.local_senha },
  { rotulo: "Observação", valor: a => a.observacao },
];
const COLUNAS_CONTATOS: Coluna[] = [
  { rotulo: "Tipo", valor: c => c.tipo },
  { rotulo: "Nome", valor: c => c.nome },
  { rotulo: "Telefone", valor: c => c.telefone },
  { rotulo: "E-mail", valor: c => c.email },
  { rotulo: "Observação", valor: c => c.observacao },
];
const COLUNAS_DOCUMENTOS: Coluna[] = [
  { rotulo: "Tipo", valor: d => d.tipo },
  { rotulo: "Nome do arquivo", valor: d => d.nome },
  { rotulo: "Enviado por", valor: d => d.criado_por },
  { rotulo: "Enviado em", tipo: "datahora", valor: d => d.created_at },
];
const COLUNAS_HISTORICO: Coluna[] = [
  { rotulo: "Quando", tipo: "datahora", valor: h => h.created_at },
  { rotulo: "O que aconteceu", valor: h => h.acao },
  { rotulo: "Detalhe", valor: h => h.detalhe },
  { rotulo: "Quem", valor: h => h.autor },
];
const COLUNAS_COMENTARIOS: Coluna[] = [
  { rotulo: "Quando", tipo: "datahora", valor: c => c.created_at },
  { rotulo: "Autor", valor: c => c.autor_nome },
  { rotulo: "Comentário", valor: c => c.texto },
];

/** Contas: o total e o que está em aberto, pra não precisar somar de cabeça. */
const totaisContas = (seloDaConta: (o: Linha) => string) => (linhas: Linha[]) => {
  const soma = (ls: Linha[]) => ls.reduce((s, l) => s + (num(l.valor) ?? 0), 0);
  const aberto = soma(linhas.filter(l => !["Pago", "Suspensa"].includes(seloDaConta(l))));
  const vencidas = linhas.filter(l => seloDaConta(l) === "Vencido").length;
  return `<div class="tot">Total lançado: <b>${moeda(soma(linhas))}</b> · Em aberto: <b>${moeda(aberto)}</b>${vencidas ? ` · <span style="color:#b91c1c">Vencidas: <b>${vencidas}</b></span>` : ""}</div>`;
};

/** Os blocos do drawer, na ordem das abas. */
function montarBlocos(d: DadosExportacao, o: OpcoesExportacao): Bloco<Linha>[] {
  const porPat = (ls: Linha[], campo = "patrimonio_id") => {
    const m = new Map<string, Linha[]>();
    for (const l of ls) { const k = txt(l[campo]); (m.get(k) ?? m.set(k, []).get(k)!).push(l); }
    return (p: Linha) => m.get(txt(p.id)) ?? [];
  };
  const porData = (campo: string, desc = false) => (a: Linha, b: Linha) =>
    (txt(a[campo]) || "9999").localeCompare(txt(b[campo]) || "9999") * (desc ? -1 : 1);
  const doKind = (k: string) => d.itens.filter(i => i.kind === k);
  const contas = porPat(d.obrigacoes), parcelas = porPat(d.parcelas), acessos = porPat(doKind("acesso")),
    contatos = porPat(doKind("contato")), documentos = porPat(doKind("documento")),
    historico = porPat(doKind("historico")), comentarios = porPat(d.comentarios, "entidade_id");
  return [
    { titulo: "Contas e obrigações", aba: "Contas e obrigações", colunas: colunasContas(o.seloDaConta),
      linhas: p => [...contas(p)].sort(porData("vencimento")), resumoHtml: totaisContas(o.seloDaConta) },
    { titulo: "Parcelas do contrato", aba: "Parcelas", colunas: COLUNAS_PARCELAS,
      linhas: p => [...parcelas(p)].sort((a, b) => (num(a.ordem) ?? 0) - (num(b.ordem) ?? 0)) },
    { titulo: "Acessos (portais)", aba: "Acessos", colunas: COLUNAS_ACESSOS, linhas: acessos },
    { titulo: "Contatos", aba: "Contatos", colunas: COLUNAS_CONTATOS, linhas: contatos },
    { titulo: "Documentos", aba: "Documentos", colunas: COLUNAS_DOCUMENTOS, linhas: p => [...documentos(p)].sort(porData("created_at", true)) },
    { titulo: "Histórico", aba: "Histórico", colunas: COLUNAS_HISTORICO, linhas: p => [...historico(p)].sort(porData("created_at", true)) },
    { titulo: "Comentários", aba: "Comentários", colunas: COLUNAS_COMENTARIOS, linhas: p => [...comentarios(p)].sort(porData("created_at", true)) },
  ];
}

/**
 * "Valor que falta pagar" com a MESMA conta da tela: soma das parcelas em
 * aberto de Financiamento/Consórcio (mapaValorQueFalta). A coluna
 * valor_falta da JUR_PATRIMONIOS é o número da importação e ninguém atualiza
 * — exportar ela faria o arquivo discordar do cartão da tela.
 */
function comFaltaCalculada(d: DadosExportacao): DadosExportacao {
  const falta = mapaValorQueFalta(d.obrigacoes as unknown as Parameters<typeof mapaValorQueFalta>[0]);
  return { ...d, patrimonios: d.patrimonios.map(p => ({ ...p, valor_falta: falta.get(Number(p.id)) ?? 0 })) };
}

function modelo(bruto: DadosExportacao, o: OpcoesExportacao): ModeloRelatorio<Linha> {
  const d = comFaltaCalculada(bruto);
  const sit = (p: Linha) => txt(p.situacao_pagamento).toUpperCase();
  const soma = (campo: string) => d.patrimonios.reduce((s, p) => s + (num(p[campo]) ?? 0), 0);
  return {
    modulo: "Jurídico · Gestão Patrimonial e Obrigações",
    itens: d.patrimonios,
    nome: { um: "patrimônio", varios: "patrimônios" },
    tituloTodos: "Relatório completo de patrimônios",
    tituloUm: p => `Patrimônio ${txt(p.codigo)} — ${txt(p.descricao)}`,
    ancora: p => `pat-${txt(p.id)}`,
    cabecalho: p => ({
      eyebrow: `${p.codigo ? `Patrimônio nº ${txt(p.codigo)}` : "Patrimônio"} · ${txt(p.tipo)}`,
      titulo: txt(p.descricao),
      sub: [p.localizacao, p.cidade].map(txt).filter(Boolean).join(" · "),
      selos: [p.situacao_pagamento, p.status],
    }),
    destaques: p => [
      ["Valor do contrato", moeda(p.valor_contrato)],
      ["Entrada", moeda(p.valor_entrada)],
      ["Falta pagar", num(p.valor_falta) ? moeda(p.valor_falta) : ""],
      ["Parcelas pagas", p.qtd_parcelas != null ? `${txt(p.parcelas_pagas) || 0} de ${txt(p.qtd_parcelas)}` : ""],
      ["Próxima parcela", dataBr(p.proxima_parcela)],
    ],
    ficha: FICHA,
    blocos: montarBlocos(d, o),
    resumo: [
      { rotulo: "Total de patrimônios", valor: d.patrimonios.length },
      { rotulo: "Pagando", valor: d.patrimonios.filter(p => sit(p).startsWith("PAGANDO")).length },
      { rotulo: "Quitados", valor: d.patrimonios.filter(p => sit(p).startsWith("PAGO")).length },
      { rotulo: "Valor total dos contratos", valor: soma("valor_contrato"), tipo: "moeda" },
      { rotulo: "Total que falta pagar", valor: soma("valor_falta"), tipo: "moeda" },
    ],
    indice: [
      { rotulo: "Código", valor: p => p.codigo },
      { rotulo: "Patrimônio", valor: p => p.descricao },
      { rotulo: "Tipo", valor: p => p.tipo },
      { rotulo: "Cidade", valor: p => p.cidade },
      { rotulo: "Situação", valor: p => p.situacao_pagamento, selo: true },
      { rotulo: "Valor do contrato", tipo: "moeda", valor: p => p.valor_contrato },
      { rotulo: "Falta pagar", tipo: "moeda", valor: p => p.valor_falta },
    ],
    identificacao: [
      { rotulo: "Código", valor: p => p.codigo },
      { rotulo: "Patrimônio", valor: p => p.descricao },
    ],
    notas: [["Valor que falta pagar", "Soma das parcelas em aberto de Financiamento/Consórcio — a mesma conta da tela."]],
    rodape: "Documentos aparecem só como registro — os arquivos continuam no ERP.",
    autor: o.autor,
  };
}

export const montarExcel = (d: DadosExportacao, o: OpcoesExportacao) => excelDoModelo(modelo(d, o));
export const montarHtml = (d: DadosExportacao, o: OpcoesExportacao) => htmlDoModelo(modelo(d, o));
export const gerarExcel = (d: DadosExportacao, o: OpcoesExportacao) => excelBlob(montarExcel(d, o));
export const gerarHtml = (d: DadosExportacao, o: OpcoesExportacao) => htmlBlob(montarHtml(d, o));

/** "Casa Triunfo" → "patrimonio-12-casa-triunfo-2026-09-21". */
export function nomeArquivo(d: DadosExportacao, umSo: boolean): string {
  const dia = new Date().toISOString().slice(0, 10);
  if (!umSo || !d.patrimonios[0]) return `patrimonios-completo-${dia}`;
  const p = d.patrimonios[0];
  return ["patrimonio", txt(p.codigo), slug(p.descricao), dia].filter(Boolean).join("-");
}
