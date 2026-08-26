import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import type { CompraPedido } from "@/hooks/useCompraPedido";
import { calcularTotalPedido } from "@/lib/suprimentos/compra";

const dinheiro = (valor: number | null | undefined) =>
  Number(valor ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const data = (valor: string | null | undefined) =>
  valor ? new Date(`${valor.slice(0, 10)}T12:00:00`).toLocaleDateString("pt-BR") : "Não informada";

export function baixarPdfPedidoCompra(pedido: CompraPedido) {
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const largura = doc.internal.pageSize.getWidth();
  const itens = pedido.itens ?? [];
  const empresa = pedido.empresa;
  const fornecedor = pedido.fornecedor;
  const totalLinhas = calcularTotalPedido(itens);
  const empresaNome = empresa?.razao_social ?? empresa?.nome_fantasia ?? "—";
  const fornecedorNome = fornecedor?.razao_social ?? pedido.fornecedor_nome ?? "—";

  doc.setFillColor(10, 30, 60);
  doc.rect(0, 0, largura, 24, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text("PEDIDO DE COMPRA", 14, 10);
  doc.setFontSize(11);
  doc.text(pedido.numero, largura - 14, 10, { align: "right" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.text(`Data do pedido: ${data(pedido.created_at)}`, largura - 14, 17, { align: "right" });

  autoTable(doc, {
    startY: 29,
    theme: "grid",
    body: [
      [
        { content: "Empresa do Pedido", styles: { fontStyle: "bold", fillColor: [235, 240, 248] } },
        `${empresaNome}\nCNPJ: ${empresa?.cnpj ?? "—"}`,
        { content: "Fornecedor", styles: { fontStyle: "bold", fillColor: [235, 240, 248] } },
        `${fornecedorNome}\nCNPJ/CPF: ${fornecedor?.cnpj_cpf ?? "—"}`,
      ],
      [
        { content: "Número do Pedido", styles: { fontStyle: "bold", fillColor: [235, 240, 248] } },
        pedido.numero,
        { content: "Data do Pedido", styles: { fontStyle: "bold", fillColor: [235, 240, 248] } },
        data(pedido.created_at),
      ],
      [
        { content: "Previsão de entrega", styles: { fontStyle: "bold", fillColor: [235, 240, 248] } },
        `${data(pedido.data_limite_entrega)}${pedido.prazo_entrega_dias != null ? ` (${pedido.prazo_entrega_dias} dias)` : ""}`,
        { content: "Forma de Pagamento", styles: { fontStyle: "bold", fillColor: [235, 240, 248] } },
        pedido.forma_pagamento ?? "Não informada",
      ],
      [
        { content: "Condição de Pagamento", styles: { fontStyle: "bold", fillColor: [235, 240, 248] } },
        { content: pedido.condicoes_negociadas ?? "Não informada", colSpan: 3 },
      ],
      [
        { content: "Local de entrega", styles: { fontStyle: "bold", fillColor: [235, 240, 248] } },
        pedido.local_entrega ?? "Não informado",
        { content: "Frete", styles: { fontStyle: "bold", fillColor: [235, 240, 248] } },
        pedido.frete_incluso ? "INCLUSO NO VALOR" : "NÃO INCLUSO NO VALOR",
      ],
    ],
    styles: { fontSize: 8, cellPadding: 2 },
    columnStyles: {
      0: { cellWidth: 34 }, 1: { cellWidth: 94 },
      2: { cellWidth: 34 }, 3: { cellWidth: 94 },
    },
  });

  const finalCabecalho = (doc as jsPDF & { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? 70;
  autoTable(doc, {
    startY: finalCabecalho + 7,
    head: [["Código", "Referência", "Descrição", "Un", "Quantidade", "Valor Un", "Valor Total"]],
    body: itens.map((item) => [
      // `replace(/-/g)` e nao `replaceAll`: o type-check do CI roda com uma lib
      // anterior a ES2021, onde replaceAll nao existe. O tsc local passa e o CI
      // reprova — este e o alvo que vale.
      item.sup_item_id ? item.sup_item_id.replace(/-/g, "").slice(0, 8).toUpperCase() : "—",
      item.codigo_fornecedor ?? "—",
      `${item.nome_item}${item.tamanho ? ` — ${item.tamanho}` : ""}`,
      item.unidade ?? "—",
      Number(item.quantidade).toLocaleString("pt-BR", { maximumFractionDigits: 3 }),
      item.valor_unitario == null ? "Não informado" : dinheiro(item.valor_unitario),
      dinheiro(Number(item.quantidade) * Number(item.valor_unitario ?? 0)),
    ]),
    styles: { fontSize: 7.5, cellPadding: 2.2, valign: "middle" },
    headStyles: { fillColor: [10, 30, 60], fontStyle: "bold" },
    columnStyles: {
      0: { cellWidth: 20 }, 1: { cellWidth: 28 }, 2: { cellWidth: 100 },
      3: { cellWidth: 14, halign: "center" }, 4: { cellWidth: 25, halign: "right" },
      5: { cellWidth: 34, halign: "right" }, 6: { cellWidth: 34, halign: "right" },
    },
    foot: [["", "", "", "", "", "TOTAL GERAL", dinheiro(totalLinhas)]],
    footStyles: { fillColor: [235, 240, 248], textColor: [10, 30, 60], fontStyle: "bold" },
  });

  const finalTabela = (doc as jsPDF & { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? 120;
  if (pedido.observacoes) {
    doc.setTextColor(25, 35, 50);
    doc.setFont("helvetica", "bold");
    doc.text("Observações", 14, finalTabela + 8);
    doc.setFont("helvetica", "normal");
    doc.text(pedido.observacoes, 14, finalTabela + 13, { maxWidth: largura - 28 });
  }

  doc.save(`${pedido.numero}.pdf`);
}
