// SIS-2026-0914 — exportação da Participação nos vídeos (Excel e PDF).
//
// Serve de comprovação de capacitação para o Jurídico: todo arquivo leva no
// topo os filtros aplicados e "situação até dd/mm/aaaa", e no fim a regra de
// contagem (NOTA_REGRA). xlsx e jspdf entram por import dinâmico — só pesam
// para quem clica em exportar (mesmo padrão de DashboardRecrutamento.tsx).
import {
  NOTA_REGRA, ROTULO_SITUACAO, dataBr, dataHoraBr, pctConclusao, pctTexto,
  type LinhaIndividual, type ResumoParticipacao,
} from "./participacaoVideos";

export interface ConteudoExportacao {
  resumo: ResumoParticipacao;
  individual: LinhaIndividual[];
  filtros: string[];        // descreverFiltros(...)
  data: string;             // AAAA-MM-DD
  geradoPor: string | null;
}

const nomeArquivo = (data: string, ext: string) => `participacao-videos-treinamento-ate-${data}.${ext}`;

const linhaMetricas = (m: { publico: number; acessaram: number; concluiram: number; acessaram_nao_concluiram: number; nao_acessaram: number }) => [
  m.publico, m.acessaram, m.concluiram, m.acessaram_nao_concluiram, m.nao_acessaram, pctTexto(pctConclusao(m)),
];
const CAB_METRICAS = ["Deveriam realizar", "Acessaram", "Assistiram até o fim", "Acessaram e não concluíram", "Não acessaram", "% conclusão"];

const linhaIndividual = (l: LinhaIndividual) => [
  l.nome, l.empresa, l.cadastro, l.contrato ?? "", l.cargo ?? "", l.curso,
  `${l.concluidos}/${l.videos}`, dataHoraBr(l.primeiro_acesso), dataHoraBr(l.conclusao), ROTULO_SITUACAO[l.situacao],
];
const CAB_INDIVIDUAL = ["Colaborador", "Empresa", "Cadastro", "Contrato", "Cargo", "Treinamento",
  "Vídeos concluídos", "Primeiro acesso", "Conclusão", "Situação"];

function rodape(geradoPor: string | null) {
  return `Gerado no ERP em ${new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}${geradoPor ? ` por ${geradoPor}` : ""}`;
}

export async function exportarParticipacaoExcel(c: ConteudoExportacao) {
  const XLSX = await import("xlsx");
  const wb = XLSX.utils.book_new();
  const t = c.resumo.totais;

  const resumo: (string | number)[][] = [
    ["PARTICIPAÇÃO NOS VÍDEOS DE TREINAMENTO"],
    [`Situação até ${dataBr(c.data)}`],
    ...c.filtros.map((f) => [f]),
    [],
    ["Pessoas distintas no recorte", t.pessoas],
    ["Acessaram ao menos um vídeo", t.acessaram],
    ["Concluíram todos os vídeos que lhes cabiam", t.concluiram_tudo],
    ["Acessaram e não concluíram tudo", t.em_andamento],
    ["Não acessaram nenhum vídeo", t.nao_acessaram],
    ["Vídeos no recorte", t.videos],
    ["Treinamentos no recorte", t.treinamentos],
    [],
    ["Regra de contagem"],
    ...NOTA_REGRA.map((n) => [n]),
    [],
    [rodape(c.geradoPor)],
  ];
  const wsRes = XLSX.utils.aoa_to_sheet(resumo);
  wsRes["!cols"] = [{ wch: 60 }, { wch: 14 }];
  XLSX.utils.book_append_sheet(wb, wsRes, "Resumo");

  const porVideo = [["Treinamento", "Vídeo", ...CAB_METRICAS],
    ...c.resumo.por_video.map((v) => [v.curso, v.aula, ...linhaMetricas(v)])];
  const wsV = XLSX.utils.aoa_to_sheet(porVideo);
  wsV["!cols"] = [{ wch: 34 }, { wch: 40 }, ...CAB_METRICAS.map(() => ({ wch: 14 }))];
  wsV["!autofilter"] = { ref: `A1:H${porVideo.length}` };
  XLSX.utils.book_append_sheet(wb, wsV, "Por vídeo");

  const porTrn = [["Treinamento", "Vídeos", ...CAB_METRICAS],
    ...c.resumo.por_treinamento.map((v) => [v.curso, v.videos, ...linhaMetricas(v)])];
  const wsT = XLSX.utils.aoa_to_sheet(porTrn);
  wsT["!cols"] = [{ wch: 40 }, { wch: 8 }, ...CAB_METRICAS.map(() => ({ wch: 14 }))];
  XLSX.utils.book_append_sheet(wb, wsT, "Por treinamento");

  const ind = [CAB_INDIVIDUAL, ...c.individual.map(linhaIndividual)];
  const wsI = XLSX.utils.aoa_to_sheet(ind);
  wsI["!cols"] = [{ wch: 36 }, { wch: 8 }, { wch: 10 }, { wch: 30 }, { wch: 26 }, { wch: 34 }, { wch: 10 }, { wch: 17 }, { wch: 17 }, { wch: 14 }];
  wsI["!autofilter"] = { ref: `A1:J${ind.length}` };
  XLSX.utils.book_append_sheet(wb, wsI, "Individual");

  XLSX.writeFile(wb, nomeArquivo(c.data, "xlsx"));
}

export async function exportarParticipacaoPdf(c: ConteudoExportacao) {
  const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([import("jspdf"), import("jspdf-autotable")]);
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const fimY = () => (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? 40;
  const t = c.resumo.totais;
  const azul: [number, number, number] = [21, 49, 105];

  doc.setFont("helvetica", "bold").setFontSize(14).setTextColor(20);
  doc.text("Participação nos vídeos de treinamento", 14, 15);
  doc.setFontSize(11).setTextColor(...azul);
  doc.text(`Situação até ${dataBr(c.data)}`, 14, 21);
  doc.setFont("helvetica", "normal").setFontSize(8.5).setTextColor(80);
  // Filtros em duas colunas para caber no topo.
  const meio = Math.ceil(c.filtros.length / 2);
  c.filtros.slice(0, meio).forEach((f, i) => doc.text(f, 14, 27 + i * 4));
  c.filtros.slice(meio).forEach((f, i) => doc.text(f, 150, 27 + i * 4));
  const y0 = 27 + meio * 4 + 2;

  autoTable(doc, {
    startY: y0,
    theme: "grid",
    styles: { fontSize: 8.5, cellPadding: 1.6, halign: "center" },
    headStyles: { fillColor: azul },
    head: [["Pessoas distintas", "Acessaram algum vídeo", "Concluíram tudo", "Acessaram e não concluíram", "Não acessaram", "Vídeos", "Treinamentos"]],
    body: [[t.pessoas, t.acessaram, t.concluiram_tudo, t.em_andamento, t.nao_acessaram, t.videos, t.treinamentos].map(String)],
  });

  autoTable(doc, {
    startY: fimY() + 5,
    theme: "striped",
    styles: { fontSize: 7.5, cellPadding: 1.2 },
    headStyles: { fillColor: azul },
    columnStyles: { 2: { halign: "right" }, 3: { halign: "right" }, 4: { halign: "right" }, 5: { halign: "right" }, 6: { halign: "right" }, 7: { halign: "right" } },
    head: [[{ content: "Por vídeo", colSpan: 8, styles: { halign: "left" } }], ["Treinamento", "Vídeo", ...CAB_METRICAS]],
    body: c.resumo.por_video.map((v) => [v.curso, v.aula, ...linhaMetricas(v).map(String)]),
  });

  autoTable(doc, {
    startY: fimY() + 5,
    theme: "striped",
    styles: { fontSize: 7, cellPadding: 1 },
    headStyles: { fillColor: azul },
    head: [[{ content: `Relatório individual — ${c.individual.length.toLocaleString("pt-BR")} linha(s)`, colSpan: 10, styles: { halign: "left" } }], CAB_INDIVIDUAL],
    body: c.individual.map((l) => linhaIndividual(l).map(String)),
  });

  autoTable(doc, {
    startY: fimY() + 5,
    theme: "plain",
    styles: { fontSize: 7, cellPadding: 0.8, textColor: 90 },
    head: [["Regra de contagem"]],
    body: NOTA_REGRA.map((n) => [n]),
  });

  const n = doc.getNumberOfPages();
  for (let i = 1; i <= n; i++) {
    doc.setPage(i);
    doc.setFontSize(7).setTextColor(130);
    doc.text(`Situação até ${dataBr(c.data)} · ${rodape(c.geradoPor)} · página ${i} de ${n}`, 14, 203);
  }
  doc.save(nomeArquivo(c.data, "pdf"));
}
