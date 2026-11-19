// =====================================================================
// SST › ASOs Realizados (SIS-2026-0816, mig 20261121100000) — o histórico
// dos ASOs feitos fora dos fluxos do ERP, com a leitura da planilha
// "EXAMES CLINICOS PROTEGE NOVO.xlsm" para a importação. Testado em
// src/test/sst-aso-historico.test.ts.
//
// Por que existe: o ASO Periódico conta o vencimento do último ASO que o
// ERP conhece; sem nenhum, conta da admissão ("Estimado pela admissão"). O
// card chegou a 778 vencidos — a maioria já tinha feito o exame, registrado
// só nesta planilha. Com o histórico importado, sst_aso_per_ultimos passa a
// enxergar esses exames (só os ligados a um colaborador e não demissionais).
//
// A planilha: uma aba por tipo (ADMISSIONAL, DEMISSIONAL, PERIÓDICO, TROCA
// DE FUNÇÃO - RISCO, RETORNO), cabeçalho na 1ª linha — NOME EMPRESA | NOME
// FILIAL | PCD? | NOME | SOLICITADO POR | TIPO | DATA DA SOLICITAÇÃO |
// TENTATIVA 1..5 | QUANTIDADE DE TENTATIVAS | DATA DA REALIZAÇÃO | DATA
// LIMITE | STATUS | AVISO. Não tem CPF nem matrícula: o banco casa o nome.
// As demais abas (RESUMO, Planilha1, dados, PESQUISA) são ignoradas.
// =====================================================================

import * as XLSX from "xlsx";
import { dataDaCelula, fmtData, hojeIso } from "@/lib/sst/exameToxicologico";

export { fmtData, hojeIso };

export type TipoAso = "admissional" | "periodico" | "retorno" | "troca_funcao" | "demissional";
export const ROTULO_TIPO_ASO: Record<TipoAso, string> = {
  admissional: "Admissional", periodico: "Periódico", retorno: "Retorno ao trabalho",
  troca_funcao: "Mudança de função", demissional: "Demissional",
};
export const TIPOS_ASO = Object.keys(ROTULO_TIPO_ASO) as TipoAso[];

export type SituacaoAso = "realizado" | "aguardando" | "atrasado" | "cancelado" | "valido" | "nao_compareceu";
export const ROTULO_SITUACAO_ASO: Record<SituacaoAso, string> = {
  realizado: "Realizado", aguardando: "Aguardando", atrasado: "Atenção (atrasado)", cancelado: "Cancelado",
  valido: "Dispensado (ASO anterior válido)", nao_compareceu: "Não compareceu",
};
export const SITUACOES_ASO = Object.keys(ROTULO_SITUACAO_ASO) as SituacaoAso[];

export interface AsoHistorico {
  id: number;
  nome: string;
  vinculado: boolean;
  empresa: string | null;
  filial_texto: string | null;
  tipo: TipoAso;
  data_solicitacao: string | null;
  data_realizacao: string | null;
  situacao: SituacaoAso;
  solicitado_por: string | null;
  clinica: string | null;
  observacoes: string | null;
  origem: "manual" | "planilha";
  editado_manual: boolean;
  created_by_nome: string | null;
  updated_at: string;
}

export interface ResumoAsoHistorico {
  realizados_ano: number;
  por_tipo_ano: Partial<Record<TipoAso, number>>;
  pendentes: number;
  sem_vinculo: number;
  total: number;
}

/** O mesmo que sup_norm_nome do banco: sem acento, só letras e números, maiúsculo. */
export const normNome = (v: unknown): string =>
  String(v ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();

const texto = (v: unknown): string => String(v ?? "").replace(/\s+/g, " ").trim();
const normCab = (v: unknown): string => texto(v).normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase();

/** Nome da aba → tipo. As abas de apoio não são tipo (null). */
export function tipoDaAba(aba: string): TipoAso | null {
  const n = normCab(aba);
  if (/^ADMISSIONAL/.test(n)) return "admissional";
  if (/^DEMISSIONAL/.test(n)) return "demissional";
  if (/^PERIODICO/.test(n)) return "periodico";
  if (/^RETORNO/.test(n)) return "retorno";
  if (/TROCA DE FUNCAO|MUDANCA DE FUNCAO/.test(n)) return "troca_funcao";
  return null;
}

/**
 * A situação sai do AVISO (a coluna que a planilha calcula); sem aviso, do
 * STATUS; sem os dois, da data: com data de realização é realizado.
 */
export function situacaoDaPlanilha(aviso: unknown, status: unknown, temRealizacao: boolean): SituacaoAso {
  const a = normCab(aviso);
  const s = normCab(status);
  if (/^REALIZ/.test(a)) return "realizado";
  if (/^CANCEL/.test(a) || /^CANCEL/.test(s)) return "cancelado";
  if (/^VALID/.test(a) || /^VALID/.test(s)) return "valido";
  if (/^AGUARD/.test(a)) return "aguardando";
  if (/^ATEN/.test(a)) return "atrasado";
  if (/^N\/?C$/.test(a) || /NAO COMPARE/.test(a) || /RECUSOU/.test(s)) return "nao_compareceu";
  return temRealizacao ? "realizado" : "aguardando";
}

/** Data da célula; antes de 2000 é lixo da planilha (0 = 30/12/1899, 8 = 08/01/1900). */
export function dataPlanilha(v: unknown): string | null {
  const d = dataDaCelula(v);
  return d && d >= "2000-01-01" ? d : null;
}

export interface LinhaAsoPlanilha {
  chave: string;
  linha: number;
  aba: string;
  tipo: TipoAso;
  nome: string;
  empresa: string | null;
  filial: string | null;
  data_solicitacao: string | null;
  data_realizacao: string | null;
  situacao: SituacaoAso;
  solicitado_por: string | null;
}

export interface LeituraAsos {
  linhas: LinhaAsoPlanilha[];
  /** Por aba: lidas, canceladas (não entram) e ignoradas com motivo. */
  abas: { aba: string; tipo: TipoAso; lidas: number; canceladas: number }[];
  ignoradas: { aba: string; linha: number; nome: string; motivo: string }[];
}

const CAB = {
  empresa: (n: string) => n === "NOME EMPRESA" || n === "EMPRESA",
  filial: (n: string) => n === "NOME FILIAL" || n === "FILIAL" || n === "CONTRATO",
  nome: (n: string) => n === "NOME" || n === "NOME DO FUNCIONARIO" || n === "COLABORADOR",
  solicitante: (n: string) => n === "SOLICITADO POR",
  solicitacao: (n: string) => /^DATA DA SOLICITA/.test(n),
  realizacao: (n: string) => /^DATA DA REALIZA/.test(n),
  status: (n: string) => n === "STATUS",
  aviso: (n: string) => n === "AVISO",
};
type ColAso = keyof typeof CAB;

/**
 * Lê as abas de tipo. Cancelado não entra (é pedido que não virou exame —
 * e quase sempre candidato que nem foi admitido). "Realizado" sem data de
 * realização também não: sem data não há vencimento a contar.
 *
 * A chave da linha (para reimportar sem duplicar): tipo + nome + data da
 * solicitação + nº de ordem entre as repetidas — a data da realização fica
 * de fora porque ela é preenchida depois (AGUARDANDO → REALIZADO atualiza).
 */
export function lerPlanilhaAsos(dados: ArrayBuffer | Uint8Array): LeituraAsos {
  const wb = XLSX.read(dados, { type: "array" });
  const linhas: LinhaAsoPlanilha[] = [];
  const abas: LeituraAsos["abas"] = [];
  const ignoradas: LeituraAsos["ignoradas"] = [];
  const vistas = new Map<string, number>();

  for (const aba of wb.SheetNames) {
    const tipo = tipoDaAba(aba);
    if (!tipo) continue;
    const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[aba], { header: 1, raw: true, defval: "" });
    const iCab = rows.slice(0, 10).findIndex((r) => r.map(normCab).some((c) => c === "NOME") && r.map(normCab).some((c) => /^DATA DA REALIZA/.test(c)));
    if (iCab < 0) continue;
    const col = {} as Record<ColAso, number>;
    const tentativas: number[] = [];
    rows[iCab].forEach((c, i) => {
      const n = normCab(c);
      if (/^TENTATIVA/.test(n)) tentativas.push(i);
      const k = (Object.keys(CAB) as ColAso[]).find((x) => col[x] == null && CAB[x](n));
      if (k) col[k] = i;
    });
    const cel = (r: unknown[], k: ColAso) => (col[k] == null ? "" : r[col[k]]);
    let lidas = 0;
    let canceladas = 0;

    rows.slice(iCab + 1).forEach((r, k) => {
      const linha = iCab + k + 2;
      const nome = texto(cel(r, "nome"));
      if (!nome) return;
      // Sem a data da realização, a última tentativa de agendamento (é o dia marcado na clínica).
      const realizacao = dataPlanilha(cel(r, "realizacao"))
        ?? tentativas.map((i) => dataPlanilha(r[i])).filter((d): d is string => !!d && d <= hojeIso()).sort().pop() ?? null;
      const situacao = situacaoDaPlanilha(cel(r, "aviso"), cel(r, "status"), !!realizacao);
      if (situacao === "cancelado") { canceladas++; return; }
      if (situacao === "realizado" && !realizacao) { ignoradas.push({ aba, linha, nome, motivo: "realizado sem data de realização" }); return; }
      if (realizacao && realizacao > hojeIso()) { ignoradas.push({ aba, linha, nome, motivo: `data de realização no futuro (${fmtData(realizacao)})` }); return; }
      const solicitacao = dataPlanilha(cel(r, "solicitacao"));
      const base = `aso:${tipo}:${normNome(nome)}:${solicitacao ?? "sem-data"}`;
      const n = (vistas.get(base) ?? 0) + 1;
      vistas.set(base, n);
      lidas++;
      linhas.push({
        chave: `${base}:${n}`, linha, aba, tipo, nome: nome.toUpperCase(),
        empresa: texto(cel(r, "empresa")).toUpperCase() || null,
        filial: texto(cel(r, "filial")) || null,
        data_solicitacao: solicitacao,
        // Só o realizado carrega a data: "dispensado" e "aguardando" com data seriam lidos como exame feito.
        data_realizacao: situacao === "realizado" ? realizacao : null,
        situacao,
        solicitado_por: texto(cel(r, "solicitante")) || null,
      });
    });
    abas.push({ aba, tipo, lidas, canceladas });
  }
  if (abas.length === 0) throw new Error('Nenhuma aba de ASO encontrada (ADMISSIONAL, DEMISSIONAL, PERIÓDICO, TROCA DE FUNÇÃO, RETORNO).');
  return { linhas, abas, ignoradas };
}

/** O que vai para sst_aso_hist_importar. */
export const linhasAsoParaImportar = (l: LinhaAsoPlanilha[]) => l;

export interface ResultadoImportacaoAsos {
  simulado: boolean;
  lidas: number;
  recusadas: number;
  novos: number;
  atualizados: number;
  ligados: number;
  sem_vinculo_total: number;
  sem_vinculo: { linha: number; aba: string; nome: string; motivo: "homonimo" | "nao_encontrado" }[];
  por_tipo: Partial<Record<TipoAso, number>>;
  periodico: { ativos_corrigidos: number; deixam_de_vencer: number; saem_de_proximo: number };
}

export interface FiltrosAsoHistorico {
  busca: string;
  tipo: TipoAso | "todos";
  situacao: SituacaoAso | "todas";
  de: string;
  ate: string;
  soSemVinculo: boolean;
}
export const FILTROS_ASO_INICIAIS: FiltrosAsoHistorico = { busca: "", tipo: "todos", situacao: "todas", de: "", ate: "", soSemVinculo: false };

/** Parâmetros da RPC sst_aso_hist_lista a partir dos filtros da tela. */
export const paramsDaLista = (f: FiltrosAsoHistorico, limite = 300) => ({
  p_busca: f.busca.trim() || null,
  p_tipo: f.tipo === "todos" ? null : f.tipo,
  p_situacao: f.situacao === "todas" ? null : f.situacao,
  p_de: f.de || null,
  p_ate: f.ate || null,
  p_sem_vinculo: f.soSemVinculo,
  p_limite: limite,
});
