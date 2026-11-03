// Ficha Financeira — Excel e PDF (29/10/2026).
//
// Exporta o que está NA TELA (período e tipos de folha filtrados), não a
// ficha inteira: quem exporta "férias de 2025" quer só isso. Sem a permissão
// de valores, as colunas de R$ saem vazias — a RPC já não mandou os números.
import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import {
  ROTULO_FOLHA, fmtData, fmtMoeda, fmtRef, rotuloMes,
  type CalculoFicha, type EventoSomado, type ResumoFicha,
} from "@/lib/fichaFinanceira";

export interface CabecalhoFicha {
  nome: string;
  matriculas: string;
  cargo: string | null;
  filial: string | null;
  situacao: string | null;
  usuario: string | null;
  filtro: string;
  veValores: boolean;
}

const ROT_CLASSE = { provento: "Provento", desconto: "Desconto", informativo: "Informativo" } as const;
const nomeArquivo = (s: string) => s.replace(/[\\/:*?"<>|]/g, "_").replace(/\s+/g, "_").slice(0, 80);

export function exportarFichaExcel(cab: CabecalhoFicha, calculos: CalculoFicha[], resumo: ResumoFicha, porEvento: EventoSomado[]) {
  const v = (n: number | null) => (cab.veValores ? n : null);
  const wb = XLSX.utils.book_new();

  const res: unknown[][] = [
    ["Ficha financeira", cab.nome],
    ["Matrícula(s)", cab.matriculas],
    ["Cargo", cab.cargo ?? ""],
    ["Filial", cab.filial ?? ""],
    ["Situação", cab.situacao ?? ""],
    ["Usuário do ERP", cab.usuario ?? "sem login"],
    ["Filtro", cab.filtro],
    [],
    ["Proventos no período", v(resumo.proventos)],
    ["Descontos no período", v(resumo.descontos)],
    ["Total recebido (líquido) no período", v(resumo.liquido)],
    [`Total recebido em ${resumo.ano}`, v(resumo.liquidoAno)],
    ["Média mensal (meses com pagamento)", v(resumo.mediaMensal)],
    ["Folhas no período", resumo.calculos],
    [],
    ["Mês de pagamento", "Proventos", "Descontos", "Líquido", "Folhas"],
    ...resumo.meses.map((m) => [rotuloMes(m.mes), v(m.proventos), v(m.descontos), v(m.liquido), m.calculos]),
    [],
    ["Fonte: eventos de pagamento da Senior (espelho BiFichaFinanceira). Gerado no ERP em " + new Date().toLocaleString("pt-BR")],
  ];
  const wsRes = XLSX.utils.aoa_to_sheet(res);
  wsRes["!cols"] = [{ wch: 38 }, { wch: 18 }, { wch: 18 }, { wch: 18 }, { wch: 8 }];
  XLSX.utils.book_append_sheet(wb, wsRes, "Resumo");

  const folhas = [
    ["Pagamento", "Competência", "Tipo de folha", "Empresa", "Matrícula", "Cálculo", "Proventos", "Descontos", "Líquido"],
    ...calculos.map((c) => [fmtData(c.pagamento), rotuloMes(c.competencia) + (c.competenciaEstimada ? " (est.)" : ""),
      ROTULO_FOLHA[c.tipo], c.empresa, c.matricula, c.calculo, v(c.proventos), v(c.descontos), v(c.liquido)]),
  ];
  const wsFol = XLSX.utils.aoa_to_sheet(folhas);
  wsFol["!cols"] = [{ wch: 12 }, { wch: 14 }, { wch: 14 }, { wch: 8 }, { wch: 10 }, { wch: 8 }, { wch: 14 }, { wch: 14 }, { wch: 14 }];
  XLSX.utils.book_append_sheet(wb, wsFol, "Folhas");

  const eventos = [
    ["Pagamento", "Competência", "Tipo de folha", "Cálculo", "Código", "Evento", "Classe", "Referência", "Valor"],
    ...calculos.flatMap((c) => c.eventos.map((e) => [fmtData(c.pagamento), rotuloMes(c.competencia), ROTULO_FOLHA[c.tipo],
      c.calculo, e.codigo, e.descricao, ROT_CLASSE[e.classe] + (e.classeEstimada ? " (est.)" : ""), e.referencia, v(e.valor)])),
  ];
  const wsEv = XLSX.utils.aoa_to_sheet(eventos);
  wsEv["!cols"] = [{ wch: 12 }, { wch: 12 }, { wch: 14 }, { wch: 8 }, { wch: 8 }, { wch: 36 }, { wch: 16 }, { wch: 11 }, { wch: 14 }];
  wsEv["!autofilter"] = { ref: `A1:I${eventos.length}` };
  XLSX.utils.book_append_sheet(wb, wsEv, "Eventos");

  const somas = [
    ["Código", "Evento", "Classe", "Vezes", "Total"],
    ...porEvento.map((e) => [e.codigo, e.descricao, ROT_CLASSE[e.classe], e.vezes, v(e.total)]),
  ];
  const wsSom = XLSX.utils.aoa_to_sheet(somas);
  wsSom["!cols"] = [{ wch: 8 }, { wch: 36 }, { wch: 12 }, { wch: 8 }, { wch: 14 }];
  XLSX.utils.book_append_sheet(wb, wsSom, "Por evento");

  XLSX.writeFile(wb, nomeArquivo(`ficha_financeira_${cab.nome}.xlsx`));
}

export function exportarFichaPdf(cab: CabecalhoFicha, calculos: CalculoFicha[], resumo: ResumoFicha) {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const m = (n: number | null) => (cab.veValores ? fmtMoeda(n) : "—");
  const fimY = () => (doc as jsPDF & { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? 40;

  doc.setFont("helvetica", "bold").setFontSize(14).setTextColor(20);
  doc.text("Ficha financeira", 14, 16);
  doc.setFont("helvetica", "normal").setFontSize(9).setTextColor(90);
  doc.text(`${cab.nome} · matrícula ${cab.matriculas}`, 14, 22);
  doc.text([cab.cargo, cab.filial, cab.situacao].filter(Boolean).join(" · "), 14, 26.5);
  doc.text(`Usuário do ERP: ${cab.usuario ?? "sem login"} · ${cab.filtro}`, 14, 31);

  autoTable(doc, {
    startY: 36,
    theme: "grid",
    styles: { fontSize: 8.5, cellPadding: 1.6 },
    headStyles: { fillColor: [21, 49, 105] },
    head: [["Proventos", "Descontos", "Líquido no período", `Recebido em ${resumo.ano}`, "Média mensal"]],
    body: [[m(resumo.proventos), m(resumo.descontos), m(resumo.liquido), m(resumo.liquidoAno), m(resumo.mediaMensal)]],
  });

  for (const c of calculos) {
    autoTable(doc, {
      startY: fimY() + 5,
      theme: "striped",
      styles: { fontSize: 7.5, cellPadding: 1.2 },
      headStyles: { fillColor: [235, 238, 245], textColor: 20 },
      columnStyles: { 0: { cellWidth: 14 }, 2: { cellWidth: 22 }, 3: { cellWidth: 20, halign: "right" }, 4: { cellWidth: 28, halign: "right" } },
      head: [[{
        content: `${ROTULO_FOLHA[c.tipo]} · competência ${rotuloMes(c.competencia)}${c.competenciaEstimada ? " (est.)" : ""} · pago em ${fmtData(c.pagamento)} · cálculo ${c.calculo ?? "—"}`,
        colSpan: 5, styles: { halign: "left", fontStyle: "bold" },
      }], ["Código", "Evento", "Classe", "Referência", "Valor"]],
      body: [
        ...c.eventos.map((e) => [String(e.codigo ?? ""), e.descricao, ROT_CLASSE[e.classe], fmtRef(e.referencia), e.classe === "informativo" ? `(${m(e.valor)})` : m(e.valor)]),
        [{ content: `Proventos ${m(c.proventos)}   ·   Descontos ${m(c.descontos)}   ·   Líquido ${m(c.liquido)}`, colSpan: 5, styles: { halign: "right", fontStyle: "bold" } }],
      ],
    });
  }

  const n = doc.getNumberOfPages();
  for (let i = 1; i <= n; i++) {
    doc.setPage(i);
    doc.setFontSize(7).setTextColor(130);
    doc.text(`Fonte: eventos de pagamento da Senior. Gerado no ERP em ${new Date().toLocaleString("pt-BR")} · página ${i} de ${n}`, 14, 290);
  }
  doc.save(nomeArquivo(`ficha_financeira_${cab.nome}.pdf`));
}
