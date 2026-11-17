// SIS-2026-0903 (4.9): Excel da Conciliação Financeira. `montarPlanilhas` é pura (testável); `baixarExcel` só entrega o arquivo.
// Indicador que a fonte não traz sai como "Indisponível" (nunca 0).
import type { GrupoConciliacao, NotaConciliacao, ResultadoConciliacao } from "./regras";
import { FONTES, INDICADORES, ROTULO_TIPO_DIVERGENCIA } from "./regras";
import { FONTES_EXT, type LinhaContaVinculada, type LinhaImpostosDescontos, type LinhaIndicadorExt, ROTULO_SITUACAO_CV } from "./indicadores";
import { ROTULO_STATUS_TRATATIVA, type Tratativa } from "./tratativas";

export type Celula = string | number | null;
export interface Planilha { nome: string; linhas: Celula[][] }

export interface DadosExportacao {
  /** Descrição do recorte (filtros) mostrada no resumo. */
  recorte: string[];
  geradoEm: Date;
  resultado: Pick<ResultadoConciliacao, "resumo" | "porCompetencia" | "porContrato" | "notas">;
  indicadores: LinhaIndicadorExt[];
  impostos: LinhaImpostosDescontos[];
  contaVinculada: LinhaContaVinculada[];
  /** SIS-2026-0903 (Fase 2): situação das tratativas */
  tratativas: Tratativa[];
  empresaNome: (id: string) => string;
}

const INDISPONIVEL = "Indisponível";
const STATUS_IND: Record<LinhaIndicadorExt["status"], string> = { conciliado: "Conciliado", divergente: "Divergente", fonte_unica: "Fonte única (sem conferência cruzada)", sem_dado: "Sem dado" };
const mes = (m: string) => `${m.slice(5, 7)}/${m.slice(0, 4)}`;
const dia = (iso: string | null): string => (iso ? new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString("pt-BR") : "—");
const num = (v: number | null, formato: "moeda" | "pct" = "moeda"): Celula => (v === null ? INDISPONIVEL : formato === "pct" ? Math.round(v * 100) / 100 : v);

function grupos(titulo: string, g: GrupoConciliacao[], rotuloDe: (x: GrupoConciliacao) => string): Planilha["linhas"] {
  return [
    [titulo, "Notas", "Divergentes", ...INDICADORES.map((i) => `Dif. ${i.rotulo}`), "Diferença total", "Status"],
    ...g.map((x) => [rotuloDe(x), x.notas, x.divergentes, ...INDICADORES.map((i) => x.dif[i.id]), x.difTotal, x.divergentes === 0 ? "Conciliado" : "Divergente"] as Celula[]),
  ];
}

export function montarPlanilhas(d: DadosExportacao): Planilha[] {
  const { resumo } = d.resultado;
  const pctConciliacao = resumo.notasAvaliadas ? Math.round((resumo.notasConciliadas / resumo.notasAvaliadas) * 10000) / 100 : null;
  const resumoExecutivo: Planilha = {
    nome: "Resumo executivo",
    linhas: [
      ["Conciliação Financeira — Relatório de Serviços"],
      ["Gerado em", d.geradoEm.toLocaleString("pt-BR")],
      ...d.recorte.map((r) => [r] as Celula[]),
      [],
      ["Indicadores conciliados", d.indicadores.filter((i) => i.status === "conciliado").length],
      ["Indicadores divergentes", d.indicadores.filter((i) => i.status === "divergente").length],
      ["Indicadores de fonte única", d.indicadores.filter((i) => i.status === "fonte_unica").length],
      ["Notas avaliadas", resumo.notasAvaliadas],
      ["Notas divergentes", resumo.notasDivergentes],
      ["% de notas conciliadas", pctConciliacao],
      ["Diferença total (soma por NF, R$)", resumo.diferencaTotal],
    ],
  };
  const comparativo: Planilha = {
    nome: "Comparativo entre fontes",
    linhas: [
      ["Grupo", "Indicador", ...FONTES_EXT.map((f) => f.rotulo), "Diferença (maior − menor)", "Variação %", "Status", "Quem destoa", "Fórmula"],
      ...d.indicadores.map((l) => [
        l.indicador.grupo, l.indicador.rotulo,
        ...FONTES_EXT.map((f) => num(l.valores[f.id], l.indicador.formato)),
        l.diferenca === null ? "—" : l.diferenca, l.variacaoPct === null ? "—" : Math.round(l.variacaoPct * 100) / 100, STATUS_IND[l.status],
        l.destoantes.map((x) => FONTES_EXT.find((f) => f.id === x)!.rotulo).join(", ") || "—", l.indicador.formula,
      ] as Celula[]),
    ],
  };
  const porNota = (n: NotaConciliacao): Celula[] => [
    n.numero, n.contratoNome, d.empresaNome(n.empresaId), mes(n.competencia), n.status,
    ...FONTES.flatMap((f) => INDICADORES.map((i) => (n.fontes[f.id].incluida ? n.fontes[f.id][i.id] : "Fora da fonte"))),
    n.difTotal, n.divergente ? "Divergente" : "Conciliada", n.tipos.map((t) => ROTULO_TIPO_DIVERGENCIA[t]).join(" | "), n.motivos.join(" | "),
  ];
  const detalhe: Planilha = {
    nome: "Detalhe por NF",
    linhas: [
      ["NF", "Contrato", "Empresa", "Competência", "Situação", ...FONTES.flatMap((f) => INDICADORES.map((i) => `${i.rotulo} (${f.rotulo})`)), "Diferença total", "Status", "Tipo de divergência", "Motivo"],
      ...d.resultado.notas.map(porNota),
    ],
  };
  const impostos: Planilha = {
    nome: "Impostos e descontos",
    linhas: [
      ["NF", "Contrato", "Empresa", "Competência", "Impostos (cabeçalho)", "Impostos (soma dos itens)", "Faltas", "Postos não implementados", "Multas antes", "Multas depois", "Glosas antes", "Glosas depois",
        "Outros antes", "Outros depois", "Pós-emissão (cabeçalho)", "Pós-emissão (itens)", "Inconsistências"],
      ...d.impostos.map((l) => [l.numero, l.contratoNome, d.empresaNome(l.empresaId), mes(l.competencia), l.totalImpostos, l.totalImpostosItens, l.faltas, l.postos, l.multasAntes, l.multasDepois,
        l.glosasAntes, l.glosasDepois, l.outrosAntes, l.outrosDepois, l.posCabecalho, l.posItens, l.inconsistencias.join(" | ")] as Celula[]),
    ],
  };
  const conta: Planilha = {
    nome: "Conta vinculada",
    linhas: [
      ["NF", "Contrato", "Empresa", "Competência", "Descontada", "Recebida", "Data do recebimento", "Pendente", "Situação"],
      ...d.contaVinculada.map((l) => [l.numero, l.contratoNome, d.empresaNome(l.empresaId), mes(l.competencia), l.descontada, l.recebida,
        l.dataRecebimento ? new Date(`${l.dataRecebimento.slice(0, 10)}T00:00:00`).toLocaleDateString("pt-BR") : "—", l.pendente, ROTULO_SITUACAO_CV[l.situacao]] as Celula[]),
    ],
  };
  const tratativas: Planilha = {
    nome: "Tratativas",
    linhas: [
      ["Divergência", "Competência", "Tipo", "Diferença", "Situação", "Responsável", "Identificada em", "Prazo de resolução", "Regularizada em", "Justificativa"],
      ...d.tratativas.map((t) => [t.titulo, t.competencia ? mes(t.competencia) : "—", t.tipoDivergencia ? ROTULO_TIPO_DIVERGENCIA[t.tipoDivergencia] : "—", t.valorDiferenca,
        ROTULO_STATUS_TRATATIVA[t.status], t.responsavelNome ?? "—", dia(t.identificadaEm), dia(t.prazoResolucao), dia(t.regularizadaEm), t.justificativa ?? ""] as Celula[]),
    ],
  };
  return [
    resumoExecutivo,
    comparativo,
    { nome: "Divergências por competência", linhas: grupos("Competência", d.resultado.porCompetencia, (g) => mes(g.chave)) },
    { nome: "Divergências por contrato", linhas: grupos("Contrato", d.resultado.porContrato, (g) => g.rotulo) },
    detalhe,
    impostos,
    conta,
    tratativas,
  ];
}

/** Gera o .xlsx e dispara o download. O `xlsx` só é carregado quando o usuário exporta. */
export async function baixarExcel(planilhas: Planilha[], arquivo: string): Promise<void> {
  const XLSX = await import("xlsx");
  const wb = XLSX.utils.book_new();
  for (const p of planilhas) {
    const ws = XLSX.utils.aoa_to_sheet(p.linhas);
    const largura = p.linhas.reduce((m, l) => Math.max(m, l.length), 0);
    ws["!cols"] = Array.from({ length: largura }, (_, i) => ({ wch: i === 0 ? 34 : 18 }));
    XLSX.utils.book_append_sheet(wb, ws, p.nome.slice(0, 31));
  }
  XLSX.writeFile(wb, arquivo);
}
