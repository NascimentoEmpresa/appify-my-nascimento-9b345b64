// =====================================================================
// TREINAMENTOS › Gerenciar alunos — relatório do filtro (08/10/2026)
//
// Pedido do Pablo: "preciso conseguir tirar um relatório do filtro aqui:
// quando eu seleciono os contratos, por exemplo, e todos inativos ou ativos,
// preciso tirar um relatório de todos os dados filtrados".
//
// Os dados vêm de trn_alunos_gerenciar_exportar (mig 20261008000011): os
// MESMOS filtros da tela, mas TODAS as linhas — a lista da tela é paginada
// em no máximo 200. O desenho é o motor comum (src/lib/exportarRelatorio.ts,
// o mesmo de Patrimônio, Processos e Veículos): aba Resumo com os filtros e
// os totais + uma aba com um aluno por linha (filtro no cabeçalho, datas como
// data, cursos como número). Só Excel: o HTML do motor é uma ficha por
// página, e o filtro pode trazer milhares de alunos.
// =====================================================================

import { type Coluna, type ModeloRelatorio, montarExcel, slug, txt } from "@/lib/exportarRelatorio";
import { DESCRICAO_STATUS_ALUNO, ROTULO_STATUS_ALUNO, type StatusAluno } from "@/pages/treinamentos/plataforma/tipos";

/** Uma linha de trn_alunos_gerenciar_exportar. */
export interface AlunoRelatorio {
  id: string; nome: string; email: string; documento: string | null; status: StatusAluno;
  situacao: string | null; contrato: string | null; cargo: string | null; empregado_id: number | null;
  origem: string | null; acesso_completo: boolean; cursos: number; ultimo_acesso_em: string | null;
  sincronizado_em: string | null; admissao: string | null; afastamento: string | null; email_sintetico: boolean;
}

/** Os filtros da tela no momento da exportação ("" / [] = sem filtro). */
export interface FiltrosRelatorioAlunos {
  busca: string;
  status: "" | StatusAluno;
  situacao: string;
  contratos: string[];
}

const STATUS_PLURAL: Record<StatusAluno, string> = { ativo: "Ativos", inativo: "Inativos", bloqueado: "Bloqueados", demitido: "Demitidos" };
const STATUS_ORDEM: StatusAluno[] = ["ativo", "inativo", "bloqueado", "demitido"];

export const cpfFormatado = (v: string | null | undefined) => {
  const d = txt(v).replace(/\D/g, "");
  return d.length === 11 ? d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4") : txt(v);
};

/** Os filtros em texto, na ordem da tela — vão para a aba Resumo. */
export function filtrosEmTexto(f: FiltrosRelatorioAlunos): [string, string][] {
  return [
    ["Busca", f.busca.trim() || "(sem busca)"],
    ["Contratos", f.contratos.length ? f.contratos.join("; ") : "Todos os contratos"],
    ["Status do aluno", f.status ? `${STATUS_PLURAL[f.status]} (${DESCRICAO_STATUS_ALUNO[f.status]})` : "Todos os status"],
    ["Situação (Senior)", f.situacao || "Todas as situações"],
  ];
}

/** "alunos-treinamentos-inativos-2-contratos-2026-10-08.xlsx" — o filtro resumido no nome. */
export function nomeArquivoAlunos(f: FiltrosRelatorioAlunos, hoje: Date = new Date()): string {
  const partes: string[] = [];
  if (f.status) partes.push(STATUS_PLURAL[f.status]);
  if (f.situacao) partes.push(f.situacao);
  if (f.contratos.length === 1) partes.push(slug(f.contratos[0], 30));
  else if (f.contratos.length > 1) partes.push(`${f.contratos.length} contratos`);
  if (f.busca.trim()) partes.push(`busca ${f.busca.trim()}`);
  const resumo = partes.map((p) => slug(p, 30)).filter(Boolean).join("-") || "todos";
  const iso = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}-${String(hoje.getDate()).padStart(2, "0")}`;
  return `alunos-treinamentos-${resumo}-${iso}.xlsx`;
}

const COLUNAS: Coluna<AlunoRelatorio>[] = [
  { rotulo: "Colaborador", valor: (a) => a.nome },
  { rotulo: "E-mail", valor: (a) => (a.email_sintetico ? "" : a.email) },
  { rotulo: "Sem e-mail no cadastro", valor: (a) => (a.email_sintetico ? "Sim" : "Não") },
  { rotulo: "CPF", valor: (a) => cpfFormatado(a.documento) },
  { rotulo: "Contrato", valor: (a) => a.contrato },
  { rotulo: "Cargo", valor: (a) => a.cargo },
  { rotulo: "Situação (Senior)", valor: (a) => a.situacao },
  { rotulo: "Afastamento", tipo: "data", valor: (a) => a.afastamento },
  { rotulo: "Aluno", valor: (a) => ROTULO_STATUS_ALUNO[a.status] ?? a.status },
  { rotulo: "Acesso", valor: (a) => (a.acesso_completo ? "Completo" : "Personalizado") },
  { rotulo: "Cursos", tipo: "inteiro", valor: (a) => a.cursos },
  { rotulo: "Último acesso", tipo: "datahora", valor: (a) => a.ultimo_acesso_em },
  { rotulo: "Admissão", tipo: "data", valor: (a) => a.admissao },
  { rotulo: "Origem", valor: (a) => a.origem },
];

export function modeloRelatorioAlunos(alunos: AlunoRelatorio[], f: FiltrosRelatorioAlunos, autor: string): ModeloRelatorio<AlunoRelatorio> {
  const porStatus = STATUS_ORDEM.map((s) => [s, alunos.filter((a) => a.status === s).length] as const);
  return {
    modulo: "Treinamentos · Alunos",
    itens: alunos,
    nome: { um: "aluno", varios: "alunos" },
    tituloTodos: "Treinamentos — alunos do filtro",
    tituloUm: (a) => a.nome,
    ancora: (a) => `aluno-${a.id}`,
    cabecalho: (a) => ({ eyebrow: "Treinamentos · Aluno", titulo: a.nome, sub: [a.contrato, a.cargo].filter(Boolean).join(" · "), selos: [ROTULO_STATUS_ALUNO[a.status]] }),
    ficha: [{ grupo: "Aluno", campos: COLUNAS }],
    blocos: [],
    resumo: [
      ...filtrosEmTexto(f).map(([rotulo, valor]) => ({ rotulo: `Filtro · ${rotulo}`, valor })),
      { rotulo: "Total de alunos", valor: alunos.length, tipo: "inteiro" as const },
      ...porStatus.map(([s, n]) => ({ rotulo: STATUS_PLURAL[s], valor: n, tipo: "inteiro" as const })),
    ],
    indice: COLUNAS.slice(0, 5),
    identificacao: [],
    notas: [
      ["Status do aluno", STATUS_ORDEM.map((s) => `${ROTULO_STATUS_ALUNO[s]}: ${DESCRICAO_STATUS_ALUNO[s]}`).join(" · ")],
      ["E-mail", "Quem não tem e-mail no cadastro da Senior aparece com a coluna \"Sem e-mail no cadastro\" = Sim (o ERP usa um identificador interno, que não sai aqui)."],
    ],
    autor,
  };
}

/** Os bytes do .xlsx (separado do download para dar para testar). */
export const montarExcelAlunos = (alunos: AlunoRelatorio[], f: FiltrosRelatorioAlunos, autor: string) =>
  montarExcel(modeloRelatorioAlunos(alunos, f, autor));
