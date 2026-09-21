// Jurídico › Controle de Notificações — Exportar dados (21/09/2026).
// Mesmo motor do Patrimônio e dos Processos (src/lib/exportarRelatorio.ts):
// aqui só se diz O QUE sai e com que nome.

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  type Coluna, type GrupoFicha, type Linha, type ModeloRelatorio,
  excelBlob, htmlBlob, moeda, montarExcel as excelDoModelo, montarHtml as htmlDoModelo, slug, txt,
} from "@/lib/exportarRelatorio";
import { situacaoPrazo, valorEvitado, valorVigente, indicadores, type Notificacao } from "./regras";

export interface ExtrasNotificacao {
  defesas: Map<number, Linha[]>;
  anexos: Map<number, Linha[]>;
  historico: Map<number, Linha[]>;
  comentarios: Map<string, Linha[]>;
}

const agrupar = (ls: Linha[], campo: string) => {
  const m = new Map<string, Linha[]>();
  for (const l of ls) { const k = txt(l[campo]); (m.get(k) ?? m.set(k, []).get(k)!).push(l); }
  return m;
};

async function todas(db: SupabaseClient, tabela: string, filtro: (q: any) => any): Promise<Linha[]> {
  const acc: Linha[] = [];
  for (let de = 0; ; de += 1000) {
    const { data, error } = await filtro(db.from(tabela).select("*")).order("id", { ascending: true }).range(de, de + 999);
    if (error) throw new Error(`${tabela}: ${error.message}`);
    acc.push(...((data ?? []) as Linha[]));
    if (!data || data.length < 1000) break;
  }
  return acc;
}

export async function carregarExtras(db: SupabaseClient, ids: number[] | null): Promise<ExtrasNotificacao> {
  const f = (q: any) => (ids ? q.in("notificacao_id", ids) : q);
  const [defesas, anexos, historico, comentarios] = await Promise.all([
    todas(db, "JUR_NOTIFICACAO_DEFESAS", f),
    todas(db, "JUR_NOTIFICACAO_ANEXOS", f),
    todas(db, "JUR_NOTIFICACAO_HISTORICO", f),
    todas(db, "SISTEMA_COMENTARIOS", q => { const b = q.eq("modulo", "notificacao"); return ids ? b.in("entidade_id", ids.map(String)) : b; }),
  ]);
  const porId = (ls: Linha[]) => new Map([...agrupar(ls, "notificacao_id")].map(([k, v]) => [Number(k), v]));
  return { defesas: porId(defesas), anexos: porId(anexos), historico: porId(historico), comentarios: agrupar(comentarios, "entidade_id") };
}

const hoje = () => new Date().toISOString().slice(0, 10);

const FICHA: GrupoFicha<Notificacao>[] = [
  { grupo: "Identificação", campos: [
    { rotulo: "Protocolo", valor: n => n.protocolo },
    { rotulo: "Tipo", valor: n => n.tipo },
    { rotulo: "Assunto", valor: n => n.assunto },
    { rotulo: "Nº do documento", valor: n => n.numero_documento },
    { rotulo: "Órgão / contratante", valor: n => n.orgao },
    { rotulo: "Contrato", valor: n => n.contrato },
    { rotulo: "Local / posto", valor: n => n.local_posto },
  ] },
  { grupo: "Datas e prazo", campos: [
    { rotulo: "Data do fato", tipo: "data", valor: n => n.data_ocorrencia },
    { rotulo: "Recebida em", tipo: "data", valor: n => n.data_recebimento },
    { rotulo: "Prazo de defesa", tipo: "data", valor: n => n.prazo_defesa },
    { rotulo: "Situação do prazo", valor: n => situacaoPrazo(n, hoje()).rotulo },
  ] },
  { grupo: "Andamento", campos: [
    { rotulo: "Etapa", valor: n => n.etapa, selo: true },
    { rotulo: "Resultado", valor: n => n.resultado, selo: true },
    { rotulo: "Desfecho financeiro", valor: n => n.desfecho_financeiro },
    { rotulo: "Data do desfecho", tipo: "data", valor: n => n.data_desfecho },
    { rotulo: "Setor responsável", valor: n => n.setor_responsavel },
    { rotulo: "Responsável", valor: n => n.responsavel_nome },
  ] },
  { grupo: "Valores", campos: [
    { rotulo: "Valor original", tipo: "moeda", valor: n => n.valor_original },
    { rotulo: "Valor final (após defesa)", tipo: "moeda", valor: n => n.valor_final },
    { rotulo: "Valor vigente", tipo: "moeda", valor: n => valorVigente(n) },
    { rotulo: "Valor evitado pela defesa", tipo: "moeda", valor: n => valorEvitado(n) || "" },
    { rotulo: "Valor descontado / pago", tipo: "moeda", valor: n => n.valor_descontado },
  ] },
  { grupo: "Conteúdo", campos: [
    { rotulo: "Descrição", valor: n => n.descricao },
    { rotulo: "Fundamentação (cláusula / base legal)", valor: n => n.fundamentacao },
    { rotulo: "Observações", valor: n => n.observacoes },
  ] },
  { grupo: "Medida preventiva", campos: [
    { rotulo: "Causa raiz", valor: n => n.causa_raiz },
    { rotulo: "Medida preventiva", valor: n => n.medida_preventiva },
    { rotulo: "Responsável pela medida", valor: n => n.medida_responsavel },
    { rotulo: "Prazo da medida", tipo: "data", valor: n => n.medida_prazo },
    { rotulo: "Medida concluída", valor: n => ((n.medida_preventiva ?? "").trim() ? (n.medida_concluida ? "Sim" : "Não") : "") },
  ] },
  { grupo: "Registro", campos: [
    { rotulo: "Registrada por", valor: n => n.criado_por_nome },
    { rotulo: "Registrada em", tipo: "datahora", valor: n => n.created_at },
    { rotulo: "Encerrada em", tipo: "datahora", valor: n => n.encerrada_em },
  ] },
];

const COLUNAS_DEFESAS: Coluna[] = [
  { rotulo: "Instância", valor: d => d.instancia },
  { rotulo: "Prazo", tipo: "data", valor: d => d.prazo },
  { rotulo: "Protocolada em", tipo: "data", valor: d => d.data_protocolo },
  { rotulo: "Nº do protocolo", valor: d => d.numero_protocolo },
  { rotulo: "Resultado", valor: d => d.resultado, selo: true },
  { rotulo: "Decisão em", tipo: "data", valor: d => d.data_resultado },
  { rotulo: "Valor após a decisão", tipo: "moeda", valor: d => d.valor_apos },
  { rotulo: "Responsável", valor: d => d.responsavel_nome },
  { rotulo: "Argumentos", valor: d => d.argumentos },
  { rotulo: "Observação", valor: d => d.observacao },
];
const COLUNAS_ANEXOS: Coluna[] = [
  { rotulo: "Categoria", valor: a => a.categoria },
  { rotulo: "Arquivo", valor: a => a.nome },
  { rotulo: "Enviado por", valor: a => a.enviado_por },
  { rotulo: "Enviado em", tipo: "datahora", valor: a => a.created_at },
];
const COLUNAS_HISTORICO: Coluna[] = [
  { rotulo: "Quando", tipo: "datahora", valor: h => h.created_at },
  { rotulo: "O que aconteceu", valor: h => h.acao },
  { rotulo: "Detalhe", valor: h => h.detalhe },
  { rotulo: "Quem", valor: h => h.autor_nome },
];
const COLUNAS_COMENTARIOS: Coluna[] = [
  { rotulo: "Quando", tipo: "datahora", valor: c => c.created_at },
  { rotulo: "Autor", valor: c => c.autor_nome },
  { rotulo: "Comentário", valor: c => c.texto },
];

function modelo(lista: Notificacao[], ex: ExtrasNotificacao, autor: string): ModeloRelatorio<Notificacao> {
  const ind = indicadores(lista, hoje());
  const recentes = (a: Linha, b: Linha) => txt(b.created_at).localeCompare(txt(a.created_at));
  return {
    modulo: "Jurídico · Controle de Notificações",
    itens: lista,
    nome: { um: "ocorrência", varios: "ocorrências" },
    tituloTodos: "Multas, glosas e notificações — relatório completo",
    tituloUm: n => `${n.protocolo} — ${n.tipo}`,
    ancora: n => `not-${n.id}`,
    cabecalho: n => ({
      eyebrow: `${n.protocolo} · ${n.tipo}`,
      titulo: n.assunto,
      sub: [n.contrato, n.orgao].filter(Boolean).join(" · "),
      selos: [n.etapa, n.resultado],
    }),
    destaques: n => [
      ["Valor original", moeda(n.valor_original)],
      ["Valor vigente", moeda(valorVigente(n))],
      ["Evitado pela defesa", valorEvitado(n) ? moeda(valorEvitado(n)) : ""],
      ["Prazo", situacaoPrazo(n, hoje()).rotulo],
    ],
    ficha: FICHA,
    blocos: [
      { titulo: "Defesas e recursos", aba: "Defesas e recursos", colunas: COLUNAS_DEFESAS, linhas: n => ex.defesas.get(n.id) ?? [] },
      { titulo: "Documentos", aba: "Documentos", colunas: COLUNAS_ANEXOS, linhas: n => ex.anexos.get(n.id) ?? [] },
      { titulo: "Histórico", aba: "Histórico", colunas: COLUNAS_HISTORICO, linhas: n => [...(ex.historico.get(n.id) ?? [])].sort(recentes) },
      { titulo: "Comentários", aba: "Comentários", colunas: COLUNAS_COMENTARIOS, linhas: n => [...(ex.comentarios.get(String(n.id)) ?? [])].sort(recentes) },
    ],
    resumo: [
      { rotulo: "Total de ocorrências", valor: ind.total },
      { rotulo: "Em aberto", valor: ind.abertas },
      { rotulo: "Prazo vencido", valor: ind.vencidas },
      { rotulo: "Valor aplicado", valor: ind.valorAplicado, tipo: "moeda" },
      { rotulo: "Valor evitado pela defesa", valor: ind.valorEvitado, tipo: "moeda" },
      { rotulo: "Valor descontado / pago", valor: ind.valorDescontado, tipo: "moeda" },
      { rotulo: "Taxa de êxito das defesas", valor: ind.taxaExito == null ? "—" : `${ind.taxaExito}%` },
    ],
    indice: [
      { rotulo: "Protocolo", valor: n => n.protocolo },
      { rotulo: "Assunto", valor: n => n.assunto },
      { rotulo: "Tipo", valor: n => n.tipo },
      { rotulo: "Contrato", valor: n => n.contrato },
      { rotulo: "Etapa", valor: n => n.etapa, selo: true },
      { rotulo: "Valor original", tipo: "moeda", valor: n => n.valor_original },
      { rotulo: "Valor vigente", tipo: "moeda", valor: n => valorVigente(n) },
    ],
    identificacao: [
      { rotulo: "Protocolo", valor: n => n.protocolo },
      { rotulo: "Assunto", valor: n => n.assunto },
    ],
    notas: [
      ["Valor vigente", "O valor final lançado depois da defesa/recurso; sem ele, o original (revertida ou cancelada = zero)."],
      ["Taxa de êxito", "Das ocorrências com decisão, quantas foram revertidas no todo ou em parte (as 'Sem defesa' não entram)."],
    ],
    rodape: "Documentos aparecem só como registro — os arquivos continuam no ERP.",
    autor,
  };
}

export const gerarExcel = (l: Notificacao[], ex: ExtrasNotificacao, autor: string) => excelBlob(excelDoModelo(modelo(l, ex, autor)));
export const gerarHtml = (l: Notificacao[], ex: ExtrasNotificacao, autor: string) => htmlBlob(htmlDoModelo(modelo(l, ex, autor)));
export const nomeArquivo = (l: Notificacao[]) => {
  const dia = new Date().toISOString().slice(0, 10);
  return l.length === 1 ? `ocorrencia-${slug(l[0].protocolo)}-${dia}` : `notificacoes-multas-glosas-${dia}`;
};
