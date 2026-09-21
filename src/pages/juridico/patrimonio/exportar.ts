// Jurídico / Patrimônio — Exportar dados (21/09/2026).
//
// Duas perguntas, quatro saídas: formato (HTML ou Excel) × alcance (todos os
// patrimônios ou um só). O conteúdo é o mesmo nos dois formatos — ficha do
// bem + as sete abas do drawer (contas, parcelas, acessos, contatos,
// documentos, histórico, comentários) — só a forma muda:
//
//   • HTML: relatório pra LER e imprimir. Ficha agrupada por assunto, selo de
//     situação colorido, índice clicável quando são todos. Abre em qualquer
//     navegador e o "Imprimir" já sai paginado (um patrimônio por página).
//   • Excel: planilha pra TRABALHAR. Uma aba por assunto, valor em R$ como
//     número de verdade (soma e filtro funcionam), data como data, filtro
//     automático no cabeçalho e as colunas já na largura do conteúdo.
//
// Exporta o que a pessoa já enxerga na tela: as consultas passam pelo mesmo
// RLS. Documento sai só como registro (nome, tipo, quem enviou) — o arquivo
// continua no storage, não vai dentro da exportação.

import type { SupabaseClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx";
import { rotuloTipoLancamento, ehContratoParcelado, mapaValorQueFalta } from "./parcelas";

// ── Tipos (só o que a exportação lê) ────────────────────────────────
export type Linha = Record<string, unknown>;

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

// ── Formatação ──────────────────────────────────────────────────────
const txt = (v: unknown) => (v == null ? "" : String(v));
const num = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return isNaN(n) ? null : n;
};
const moeda = (v: unknown) => {
  const n = num(v);
  return n == null ? "" : n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
};
/** "2026-09-21" ou timestamp → Date local (sem o fuso empurrar pro dia anterior). */
const paraData = (v: unknown): Date | null => {
  const s = txt(v);
  if (!s) return null;
  const d = s.length <= 10 ? new Date(`${s}T12:00:00`) : new Date(s);
  return isNaN(+d) ? null : d;
};
const dataBr = (v: unknown) => paraData(v)?.toLocaleDateString("pt-BR") ?? "";
const dataHoraBr = (v: unknown) => {
  const d = paraData(v);
  return d ? d.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "";
};
const simNao = (v: unknown) => (v === true ? "Sim" : v === false ? "Não" : "");

// ── O que sai, e com que nome ───────────────────────────────────────
type Tipo = "texto" | "moeda" | "data" | "datahora" | "inteiro";
interface Coluna { rotulo: string; tipo?: Tipo; valor: (l: Linha) => unknown; }

/** A ficha do patrimônio, agrupada como uma pessoa leria. */
const FICHA: { grupo: string; campos: Coluna[] }[] = [
  { grupo: "Identificação", campos: [
    { rotulo: "Código", valor: p => p.codigo },
    { rotulo: "Descrição", valor: p => p.descricao },
    { rotulo: "Tipo", valor: p => p.tipo },
    { rotulo: "Classificação", valor: p => p.classificacao },
    { rotulo: "Status do cadastro", valor: p => p.status },
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
    { rotulo: "Situação do pagamento", valor: p => p.situacao_pagamento },
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
const CAMPOS_FICHA = FICHA.flatMap(g => g.campos);

const colunasContas = (selo: (o: Linha) => string): Coluna[] => [
  { rotulo: "Categoria", valor: o => o.categoria },
  { rotulo: "Lançamento", valor: o => (ehContratoParcelado(txt(o.categoria)) ? rotuloTipoLancamento(txt(o.tipo_lancamento) || "parcela") : "") },
  { rotulo: "Parcela", valor: o => (o.parcela_numero != null ? `${o.parcela_numero}/${o.parcela_total ?? "?"}` : "") },
  { rotulo: "Descrição", valor: o => o.descricao },
  { rotulo: "Valor", tipo: "moeda", valor: o => o.valor },
  { rotulo: "Entrada", tipo: "moeda", valor: o => o.valor_entrada },
  { rotulo: "Vencimento", tipo: "data", valor: o => o.vencimento },
  { rotulo: "Periodicidade", valor: o => o.periodicidade },
  { rotulo: "Situação", valor: o => selo(o) },
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
  { rotulo: "Situação", valor: p => p.situacao },
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

/**
 * Só as colunas que têm dado em pelo menos uma linha. Conta de luz não tem
 * seguradora nem apólice: vinte colunas com metade vazia espremiam a
 * descrição e escondiam o que importa.
 */
const colunasComDado = (colunas: Coluna[], linhas: Linha[]) =>
  colunas.filter(c => linhas.some(l => txt(c.valor(l)).trim() !== ""));

/** Colunas de texto corrido: quebram linha, mas não ficam estreitas. */
const TEXTO_LONGO = new Set(["Descrição", "Observação", "Detalhe", "Comentário", "O que aconteceu", "Onde pagar", "Link"]);

/** Os blocos do drawer, na ordem das abas. */
interface Bloco { titulo: string; aba: string; colunas: Coluna[]; linhas: (patId: number) => Linha[]; }

function montarBlocos(d: DadosExportacao, o: OpcoesExportacao): Bloco[] {
  const porPat = <T extends Linha>(ls: T[], campo = "patrimonio_id") => {
    const m = new Map<string, T[]>();
    for (const l of ls) { const k = txt(l[campo]); (m.get(k) ?? m.set(k, []).get(k)!).push(l); }
    return (id: number) => m.get(String(id)) ?? [];
  };
  const porData = (campo: string, desc = false) => (a: Linha, b: Linha) =>
    (txt(a[campo]) || "9999").localeCompare(txt(b[campo]) || "9999") * (desc ? -1 : 1);
  const doKind = (k: string) => d.itens.filter(i => i.kind === k);
  const contas = porPat(d.obrigacoes), parcelas = porPat(d.parcelas), acessos = porPat(doKind("acesso")),
    contatos = porPat(doKind("contato")), documentos = porPat(doKind("documento")),
    historico = porPat(doKind("historico")), comentarios = porPat(d.comentarios, "entidade_id");
  return [
    { titulo: "Contas e obrigações", aba: "Contas e obrigações", colunas: colunasContas(o.seloDaConta),
      linhas: id => [...contas(id)].sort(porData("vencimento")) },
    { titulo: "Parcelas do contrato", aba: "Parcelas", colunas: COLUNAS_PARCELAS,
      linhas: id => [...parcelas(id)].sort((a, b) => (num(a.ordem) ?? 0) - (num(b.ordem) ?? 0)) },
    { titulo: "Acessos (portais)", aba: "Acessos", colunas: COLUNAS_ACESSOS, linhas: acessos },
    { titulo: "Contatos", aba: "Contatos", colunas: COLUNAS_CONTATOS, linhas: contatos },
    { titulo: "Documentos", aba: "Documentos", colunas: COLUNAS_DOCUMENTOS, linhas: id => [...documentos(id)].sort(porData("created_at", true)) },
    { titulo: "Histórico", aba: "Histórico", colunas: COLUNAS_HISTORICO, linhas: id => [...historico(id)].sort(porData("created_at", true)) },
    { titulo: "Comentários", aba: "Comentários", colunas: COLUNAS_COMENTARIOS, linhas: id => [...comentarios(id)].sort(porData("created_at", true)) },
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

/** Os números do topo — a mesma leitura dos cartões da carteira. */
function resumo(d: DadosExportacao) {
  const sit = (p: Linha) => txt(p.situacao_pagamento).toUpperCase();
  const soma = (campo: string) => d.patrimonios.reduce((s, p) => s + (num(p[campo]) ?? 0), 0);
  return {
    total: d.patrimonios.length,
    pagando: d.patrimonios.filter(p => sit(p).startsWith("PAGANDO")).length,
    quitados: d.patrimonios.filter(p => sit(p).startsWith("PAGO")).length,
    valorContratos: soma("valor_contrato"),
    valorFalta: soma("valor_falta"),
    contas: d.obrigacoes.length,
  };
}

/** "Casa Triunfo" → "patrimonio-12-casa-triunfo-2026-09-21". */
export function nomeArquivo(d: DadosExportacao, umSo: boolean): string {
  const dia = new Date().toISOString().slice(0, 10);
  if (!umSo || !d.patrimonios[0]) return `patrimonios-completo-${dia}`;
  const p = d.patrimonios[0];
  const slug = txt(p.descricao).normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
  return ["patrimonio", txt(p.codigo), slug, dia].filter(Boolean).join("-");
}

// =====================================================================
// EXCEL
// =====================================================================
const FMT_MOEDA = '"R$" #,##0.00;[Red]-"R$" #,##0.00';
const FMT_DATA = "dd/mm/yyyy";
const FMT_DATAHORA = "dd/mm/yyyy hh:mm";

/** Valor da célula: número de verdade pra moeda, Date pra data. */
function celula(tipo: Tipo | undefined, v: unknown): unknown {
  if (tipo === "moeda" || tipo === "inteiro") return num(v);
  if (tipo === "data" || tipo === "datahora") return paraData(v);
  const s = txt(v);
  return s === "" ? null : s;
}

/**
 * Aba em forma de tabela: cabeçalho + linhas, com formato por coluna, filtro
 * automático e largura pelo conteúdo.
 */
function abaTabela(colunas: Coluna[], linhas: Linha[], prefixo: Coluna[] = []): XLSX.WorkSheet {
  const cols = [...prefixo, ...colunasComDado(colunas, linhas)];
  const aoa: unknown[][] = [cols.map(c => c.rotulo), ...linhas.map(l => cols.map(c => celula(c.tipo, c.valor(l))))];
  const ws = XLSX.utils.aoa_to_sheet(aoa, { cellDates: true });
  cols.forEach((c, j) => {
    const z = c.tipo === "moeda" ? FMT_MOEDA : c.tipo === "data" ? FMT_DATA : c.tipo === "datahora" ? FMT_DATAHORA : null;
    if (!z) return;
    for (let i = 1; i < aoa.length; i++) {
      const cel = ws[XLSX.utils.encode_cell({ r: i, c: j })];
      if (cel) cel.z = z;
    }
  });
  ws["!cols"] = cols.map((c, j) => ({
    wch: Math.min(60, Math.max(c.rotulo.length + 2, ...aoa.slice(1, 400).map(r => larguraTexto(r[j], c.tipo)))),
  }));
  if (aoa.length > 1) ws["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: aoa.length - 1, c: cols.length - 1 } }) };
  return ws;
}
const larguraTexto = (v: unknown, tipo?: Tipo) =>
  v == null ? 0 : tipo === "moeda" ? 16 : tipo === "data" ? 12 : tipo === "datahora" ? 17 : String(v).length + 2;

/** Aba "ficha": Campo | Valor, com uma linha de título por grupo. */
function abaFicha(p: Linha): XLSX.WorkSheet {
  const aoa: unknown[][] = [[`Patrimônio ${txt(p.codigo)} — ${txt(p.descricao)}`, null], [null, null]];
  const formatos: { r: number; z: string }[] = [];
  for (const g of FICHA) {
    aoa.push([g.grupo.toUpperCase(), null]);
    for (const c of g.campos) {
      const v = celula(c.tipo, c.valor(p));
      if (c.tipo === "moeda" && v != null) formatos.push({ r: aoa.length, z: FMT_MOEDA });
      if (c.tipo === "data" && v != null) formatos.push({ r: aoa.length, z: FMT_DATA });
      if (c.tipo === "datahora" && v != null) formatos.push({ r: aoa.length, z: FMT_DATAHORA });
      aoa.push([c.rotulo, v ?? "—"]);
    }
    aoa.push([null, null]);
  }
  const ws = XLSX.utils.aoa_to_sheet(aoa, { cellDates: true });
  for (const f of formatos) { const cel = ws[XLSX.utils.encode_cell({ r: f.r, c: 1 })]; if (cel) cel.z = f.z; }
  ws["!cols"] = [{ wch: 28 }, { wch: 70 }];
  return ws;
}

/** Os bytes do .xlsx (separado do Blob pra dar pra testar fora do navegador). */
export function montarExcel(bruto: DadosExportacao, o: OpcoesExportacao): ArrayBuffer {
  const d = comFaltaCalculada(bruto);
  const umSo = d.patrimonios.length === 1;
  const wb = XLSX.utils.book_new();
  const blocos = montarBlocos(d, o);

  if (umSo) {
    XLSX.utils.book_append_sheet(wb, abaFicha(d.patrimonios[0]), "Patrimônio");
  } else {
    const r = resumo(d);
    const capa = XLSX.utils.aoa_to_sheet([
      ["Gestão Patrimonial e Obrigações — exportação completa"],
      [],
      ["Gerado em", new Date().toLocaleString("pt-BR")],
      ["Gerado por", o.autor],
      [],
      ["Total de patrimônios", r.total],
      ["Patrimônios pagando", r.pagando],
      ["Patrimônios quitados", r.quitados],
      ["Valor total dos contratos", r.valorContratos],
      ["Valor total que falta pagar", r.valorFalta],
      ["Contas e obrigações lançadas", r.contas],
      [],
      ["Como ler esta planilha"],
      ["Patrimônios", "Uma linha por patrimônio, com a ficha completa."],
      ["Demais abas", "Cada linha traz o Código e a Descrição do patrimônio — use o filtro do cabeçalho para ver um só."],
      ["Valor que falta pagar", "Soma das parcelas em aberto de Financiamento/Consórcio — a mesma conta da tela."],
    ]);
    for (const r0 of [8, 9]) { const cel = capa[XLSX.utils.encode_cell({ r: r0, c: 1 })]; if (cel) cel.z = FMT_MOEDA; }
    capa["!cols"] = [{ wch: 30 }, { wch: 90 }];
    XLSX.utils.book_append_sheet(wb, capa, "Resumo");
    XLSX.utils.book_append_sheet(wb, abaTabela(CAMPOS_FICHA, d.patrimonios), "Patrimônios");
  }

  // Todos: cada linha diz de que patrimônio é. Um só: a ficha já diz.
  const porId = new Map(d.patrimonios.map(p => [txt(p.id), p]));
  const prefixo: Coluna[] = umSo ? [] : [
    { rotulo: "Código", valor: l => porId.get(txt(l.__pat))?.codigo },
    { rotulo: "Patrimônio", valor: l => porId.get(txt(l.__pat))?.descricao },
  ];
  for (const b of blocos) {
    const linhas = d.patrimonios.flatMap(p => b.linhas(Number(p.id)).map(l => ({ ...l, __pat: p.id })));
    if (!linhas.length) continue; // aba vazia só atrapalha
    XLSX.utils.book_append_sheet(wb, abaTabela(b.colunas, linhas, prefixo), b.aba);
  }

  return XLSX.write(wb, { bookType: "xlsx", type: "array", cellDates: true }) as ArrayBuffer;
}
export const gerarExcel = (d: DadosExportacao, o: OpcoesExportacao): Blob =>
  new Blob([montarExcel(d, o)], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });

// =====================================================================
// HTML
// =====================================================================
const esc = (v: unknown) =>
  txt(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Texto da célula no HTML: moeda formatada, data em pt-BR, link clicável. */
function htmlValor(c: Coluna, l: Linha): string {
  const v = c.valor(l);
  if (c.tipo === "moeda") return esc(moeda(v));
  if (c.tipo === "data") return esc(dataBr(v));
  if (c.tipo === "datahora") return esc(dataHoraBr(v));
  const s = txt(v);
  if (/^https?:\/\//i.test(s.trim())) return `<a href="${esc(s.trim())}" target="_blank" rel="noopener">${esc(s)}</a>`;
  return esc(s).replace(/\n/g, "<br>");
}

const COR_SELO: Record<string, [string, string]> = {
  pago: ["#dcfce7", "#15803d"], pagando: ["#dbeafe", "#1d4ed8"], vencido: ["#fee2e2", "#b91c1c"],
  pendente: ["#fef9c3", "#a16207"], aguardando: ["#fef9c3", "#a16207"], "enviado ao malote": ["#ede9fe", "#6d28d9"],
  suspensa: ["#f1f5f9", "#475569"], ativo: ["#dcfce7", "#15803d"], inativo: ["#f1f5f9", "#64748b"],
};
const selo = (v: unknown) => {
  const s = txt(v);
  if (!s) return "";
  const chave = Object.keys(COR_SELO).find(k => s.toLowerCase().startsWith(k));
  const [bg, fg] = chave ? COR_SELO[chave] : ["#f1f5f9", "#475569"];
  return `<span class="selo" style="background:${bg};color:${fg}">${esc(s)}</span>`;
};

function htmlTabela(todasColunas: Coluna[], linhas: Linha[]): string {
  const colunas = colunasComDado(todasColunas, linhas);
  const cab = colunas.map(c => `<th${c.tipo === "moeda" ? ' class="num"' : ""}>${esc(c.rotulo)}</th>`).join("");
  const corpo = linhas.map(l => `<tr>${colunas.map(c => {
    const cls = c.tipo === "moeda" ? ' class="num"' : c.tipo === "data" || c.tipo === "datahora" ? ' class="dt"' : TEXTO_LONGO.has(c.rotulo) ? ' class="longo"' : "";
    return `<td${cls}>${c.rotulo === "Situação" ? selo(c.valor(l)) : htmlValor(c, l)}</td>`;
  }).join("")}</tr>`).join("");
  return `<div class="tab-wrap"><table><thead><tr>${cab}</tr></thead><tbody>${corpo}</tbody></table></div>`;
}

/** Contas: o total e o que está em aberto, pra não precisar somar de cabeça. */
function htmlTotaisContas(linhas: Linha[], o: OpcoesExportacao): string {
  const total = linhas.reduce((s, l) => s + (num(l.valor) ?? 0), 0);
  const aberto = linhas.filter(l => !["Pago", "Suspensa"].includes(o.seloDaConta(l))).reduce((s, l) => s + (num(l.valor) ?? 0), 0);
  const vencidas = linhas.filter(l => o.seloDaConta(l) === "Vencido").length;
  return `<div class="tot">Total lançado: <b>${esc(moeda(total))}</b> · Em aberto: <b>${esc(moeda(aberto))}</b>${vencidas ? ` · <span style="color:#b91c1c">Vencidas: <b>${vencidas}</b></span>` : ""}</div>`;
}

function htmlPatrimonio(p: Linha, blocos: Bloco[], o: OpcoesExportacao, comIndice: boolean): string {
  const id = Number(p.id);
  const ficha = FICHA.map(g => {
    const campos = g.campos
      .map(c => ({ c, v: htmlValor(c, p) }))
      .filter(({ v }) => v !== "");
    if (!campos.length) return "";
    return `<div class="grupo"><h4>${esc(g.grupo)}</h4><dl>${campos.map(({ c, v }) =>
      `<div class="campo${c.rotulo.startsWith("Observa") || c.rotulo === "Anotações" ? " largo" : ""}"><dt>${esc(c.rotulo)}</dt><dd>${c.rotulo === "Situação do pagamento" || c.rotulo === "Status do cadastro" ? selo(c.valor(p)) : v}</dd></div>`).join("")}</dl></div>`;
  }).join("");

  const kpis = [
    ["Valor do contrato", moeda(p.valor_contrato)],
    ["Entrada", moeda(p.valor_entrada)],
    ["Falta pagar", moeda(p.valor_falta)],
    ["Parcelas pagas", p.qtd_parcelas != null ? `${txt(p.parcelas_pagas) || 0} de ${txt(p.qtd_parcelas)}` : ""],
    ["Próxima parcela", dataBr(p.proxima_parcela)],
  ].filter(([, v]) => v);

  const secoes = blocos.map(b => {
    const linhas = b.linhas(id);
    const extra = b.aba === "Contas e obrigações" && linhas.length ? htmlTotaisContas(linhas, o) : "";
    return `<section class="bloco"><h3>${esc(b.titulo)} <span class="qtd">${linhas.length}</span></h3>${
      linhas.length ? extra + htmlTabela(b.colunas, linhas) : '<p class="vazio">Nenhum registro.</p>'}</section>`;
  }).join("");

  return `<article class="pat" id="pat-${id}">
    <header class="pat-cab">
      <div>
        <div class="pat-cod">${p.codigo ? `Patrimônio nº ${esc(p.codigo)}` : "Patrimônio"} · ${esc(p.tipo)}</div>
        <h2>${esc(p.descricao)}</h2>
        <div class="pat-sub">${esc([p.localizacao, p.cidade].map(txt).filter(Boolean).join(" · "))}</div>
      </div>
      <div class="pat-selos">${selo(p.situacao_pagamento)} ${selo(p.status)}</div>
    </header>
    ${kpis.length ? `<div class="kpis">${kpis.map(([r, v]) => `<div class="kpi"><span>${esc(r)}</span><b>${esc(v)}</b></div>`).join("")}</div>` : ""}
    <div class="ficha">${ficha}</div>
    ${secoes}
    ${comIndice ? '<p class="voltar"><a href="#indice">↑ voltar ao índice</a></p>' : ""}
  </article>`;
}

/** O documento HTML inteiro, autocontido (CSS dentro, nenhum arquivo externo). */
export function montarHtml(bruto: DadosExportacao, o: OpcoesExportacao): string {
  const d = comFaltaCalculada(bruto);
  const umSo = d.patrimonios.length === 1;
  const blocos = montarBlocos(d, o);
  const r = resumo(d);
  const titulo = umSo
    ? `Patrimônio ${txt(d.patrimonios[0].codigo)} — ${txt(d.patrimonios[0].descricao)}`
    : "Relatório completo de patrimônios";

  const indice = umSo ? "" : `
    <section class="capa-resumo">
      <div class="kpis">
        <div class="kpi"><span>Total de patrimônios</span><b>${r.total}</b></div>
        <div class="kpi"><span>Pagando</span><b>${r.pagando}</b></div>
        <div class="kpi"><span>Quitados</span><b>${r.quitados}</b></div>
        <div class="kpi"><span>Valor total dos contratos</span><b>${esc(moeda(r.valorContratos))}</b></div>
        <div class="kpi"><span>Total que falta pagar</span><b>${esc(moeda(r.valorFalta))}</b></div>
      </div>
      <h3 id="indice">Índice <span class="qtd">${r.total}</span></h3>
      <div class="tab-wrap"><table><thead><tr><th>Código</th><th>Patrimônio</th><th>Tipo</th><th>Cidade</th><th>Situação</th><th class="num">Valor do contrato</th><th class="num">Falta pagar</th></tr></thead><tbody>
      ${d.patrimonios.map(p => `<tr><td>${esc(p.codigo)}</td><td><a href="#pat-${esc(p.id)}">${esc(p.descricao)}</a></td><td>${esc(p.tipo)}</td><td>${esc(p.cidade)}</td><td>${selo(p.situacao_pagamento)}</td><td class="num">${esc(moeda(p.valor_contrato))}</td><td class="num">${esc(moeda(p.valor_falta))}</td></tr>`).join("")}
      </tbody></table></div>
    </section>`;

  const html = `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(titulo)}</title>
<style>
  *{box-sizing:border-box}
  body{margin:0;background:#f5f7fb;color:#0f172a;font:14px/1.5 -apple-system,"Segoe UI",Roboto,Arial,sans-serif}
  .pagina{max-width:1100px;margin:0 auto;padding:28px 20px 60px}
  .topo{background:linear-gradient(135deg,#0f3171,#1e4fa8);color:#fff;border-radius:16px;padding:22px 26px;margin-bottom:22px;display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap;align-items:flex-end}
  .topo h1{margin:4px 0 0;font-size:22px}
  .topo .eyebrow{font-size:11px;letter-spacing:.08em;text-transform:uppercase;opacity:.8;font-weight:700}
  .topo .meta{font-size:12px;opacity:.85;text-align:right}
  .imprimir{margin-top:8px;border:1px solid rgba(255,255,255,.5);background:rgba(255,255,255,.12);color:#fff;border-radius:8px;padding:6px 12px;font-weight:700;cursor:pointer}
  .kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px;margin:0 0 16px}
  .kpi{background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:10px 14px}
  .kpi span{display:block;font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.04em}
  .kpi b{font-size:18px;color:#0f3171}
  .capa-resumo,.pat{background:#fff;border:1px solid #e2e8f0;border-radius:16px;padding:22px;margin-bottom:22px;box-shadow:0 6px 18px rgba(15,23,42,.05)}
  .pat-cab{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;border-bottom:2px solid #0f3171;padding-bottom:12px;margin-bottom:16px}
  .pat-cod{font-size:12px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.05em}
  .pat h2{margin:2px 0;font-size:20px;color:#0f3171}
  .pat-sub{font-size:13px;color:#475569}
  .pat .kpis .kpi{background:#f8fbff}
  .ficha{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:12px;margin-bottom:8px}
  .grupo{border:1px solid #e2e8f0;border-radius:12px;padding:12px 14px}
  .grupo h4{margin:0 0 8px;font-size:11px;color:#0f3171;text-transform:uppercase;letter-spacing:.06em}
  dl{margin:0;display:grid;grid-template-columns:1fr 1fr;gap:8px 14px}
  .campo.largo{grid-column:1/-1}
  dt{font-size:11px;color:#64748b;font-weight:600}
  dd{margin:0;font-weight:600;word-break:break-word}
  h3{font-size:15px;margin:22px 0 8px;color:#0f172a;display:flex;align-items:center;gap:8px}
  .qtd{background:#eef4ff;color:#0f3171;border-radius:999px;padding:1px 9px;font-size:12px}
  .tab-wrap{overflow-x:auto;border:1px solid #e2e8f0;border-radius:10px}
  table{border-collapse:collapse;width:100%;font-size:12.5px}
  th{background:#f1f5f9;text-align:left;padding:7px 9px;font-size:11px;text-transform:uppercase;letter-spacing:.03em;color:#475569;white-space:nowrap}
  td{padding:7px 9px;border-top:1px solid #eef2f7;vertical-align:top}
  tbody tr:nth-child(even) td{background:#fafcff}
  .num{text-align:right;white-space:nowrap}
  .dt{white-space:nowrap}
  .longo{min-width:220px}
  .selo{display:inline-block;border-radius:999px;padding:1px 9px;font-size:11.5px;font-weight:700;white-space:nowrap}
  .vazio{color:#94a3b8;font-size:12.5px;margin:0}
  .tot{font-size:12.5px;color:#475569;margin:0 0 8px}
  .voltar{text-align:right;font-size:12px;margin:14px 0 0}
  a{color:#1d4ed8}
  .rodape{text-align:center;font-size:11px;color:#94a3b8}
  @media print{
    body{background:#fff}
    .pagina{padding:0;max-width:none}
    .imprimir,.voltar{display:none}
    .topo{-webkit-print-color-adjust:exact;print-color-adjust:exact}
    .pat,.capa-resumo{box-shadow:none;border:none;padding:0}
    .pat{break-before:page}
    .selo,.qtd,th{-webkit-print-color-adjust:exact;print-color-adjust:exact}
    tr{break-inside:avoid}
  }
</style></head>
<body><div class="pagina">
  <div class="topo">
    <div><div class="eyebrow">Jurídico · Gestão Patrimonial e Obrigações</div><h1>${esc(titulo)}</h1></div>
    <div class="meta">Gerado em ${esc(new Date().toLocaleString("pt-BR"))}<br>por ${esc(o.autor)}<br>
      <button class="imprimir" onclick="window.print()">Imprimir / salvar em PDF</button></div>
  </div>
  ${indice}
  ${d.patrimonios.map(p => htmlPatrimonio(p, blocos, o, !umSo)).join("")}
  <p class="rodape">Documentos aparecem só como registro — os arquivos continuam no ERP.</p>
</div></body></html>`;
  return html;
}
export const gerarHtml = (d: DadosExportacao, o: OpcoesExportacao): Blob =>
  new Blob([montarHtml(d, o)], { type: "text/html;charset=utf-8" });

/** Dispara o download no navegador. */
export function baixar(blob: Blob, nome: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = nome;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
