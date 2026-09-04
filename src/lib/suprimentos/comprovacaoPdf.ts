import jsPDF from "jspdf";
import { supabase } from "@/integrations/supabase/client";

// As relações novas ainda não existem no types.ts até a migration remota.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as any;
const BUCKET = "sup-comprovacoes";
const LIMITE_CONTEUDO_Y = 280;

function adicionarPaginaContinuacao(doc: jsPDF) {
  doc.addPage();
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text("Comprovação de Entrega (continuação)", 105, 18, { align: "center" });
  doc.setDrawColor(80);
  doc.line(15, 23, 195, 23);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  return 31;
}

function blobParaDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const leitor = new FileReader();
    leitor.onload = () => resolve(String(leitor.result));
    leitor.onerror = () => reject(leitor.error);
    leitor.readAsDataURL(blob);
  });
}

function texto(doc: jsPDF, rotulo: string, valor: unknown, y: number) {
  const linhas = doc.splitTextToSize(String(valor || "—"), 145);
  const altura = Math.max(7, linhas.length * 5);
  const yLinha = y + altura > LIMITE_CONTEUDO_Y ? adicionarPaginaContinuacao(doc) : y;
  doc.setFont("helvetica", "bold");
  doc.text(`${rotulo}:`, 15, yLinha);
  doc.setFont("helvetica", "normal");
  doc.text(linhas, 50, yLinha);
  return yLinha + altura;
}

export async function abrirComprovacaoPdf(pedidoId: string) {
  const { data: pedido, error } = await sb
    .from("sup_pedido")
    .select("id, pedido_id, contrato_nome, posto_nome, funcao_nome, nome_colaborador, sup_pedido_item(nome_item, tamanho, litros, quantidade, ordem), sup_pedido_comprovacao(id, status, respondido_em, respondido_por_nome, recebedor_nome, observacao, sup_pedido_comprovacao_foto(storage_path, colaborador_nome, ordem))")
    .eq("id", pedidoId)
    .single();
  if (error) throw error;

  const relacao = pedido.sup_pedido_comprovacao;
  const comprovacao = Array.isArray(relacao) ? relacao[0] : relacao;
  if (!comprovacao || comprovacao.status !== "ENVIADO") {
    throw new Error("A comprovação deste pedido ainda não foi recebida.");
  }

  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text("Comprovação de Entrega", 105, 18, { align: "center" });
  doc.setDrawColor(80);
  doc.line(15, 23, 195, 23);
  doc.setFontSize(10);

  let y = 33;
  y = texto(doc, "Protocolo", pedido.pedido_id, y);
  y = texto(doc, "Contrato", pedido.contrato_nome, y);
  y = texto(doc, "Posto", pedido.posto_nome, y);
  y = texto(doc, "Função", pedido.funcao_nome, y);
  y = texto(doc, "Colaborador", pedido.nome_colaborador, y);
  y = texto(doc, "Recebedor", comprovacao.recebedor_nome, y);
  y = texto(doc, "Respondido por", comprovacao.respondido_por_nome, y);
  y = texto(doc, "Data", comprovacao.respondido_em ? new Date(comprovacao.respondido_em).toLocaleString("pt-BR") : "—", y);
  y = texto(doc, "Observação", comprovacao.observacao, y);

  if (y + 13 > LIMITE_CONTEUDO_Y) y = adicionarPaginaContinuacao(doc);
  doc.setFont("helvetica", "bold");
  doc.text("Itens entregues", 15, y + 3);
  doc.setFont("helvetica", "normal");
  y += 10;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const itens = [...(pedido.sup_pedido_item ?? [])].sort((a: any, b: any) => a.ordem - b.ordem);
  for (const item of itens) {
    const linha = `• ${item.nome_item}${item.tamanho ? ` · Tam. ${item.tamanho}` : ""}${item.litros ? ` · ${item.litros} L` : ""} · Qtd. ${item.quantidade}`;
    const quebrado = doc.splitTextToSize(linha, 175);
    const alturaLinha = quebrado.length * 5 + 1;
    if (y + alturaLinha > LIMITE_CONTEUDO_Y) {
      y = adicionarPaginaContinuacao(doc);
      doc.setFont("helvetica", "bold");
      doc.text("Itens entregues (continuação)", 15, y);
      doc.setFont("helvetica", "normal");
      y += 7;
    }
    doc.text(quebrado, 18, y);
    y += alturaLinha;
  }

  const fotos = [...(comprovacao.sup_pedido_comprovacao_foto ?? [])]
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .sort((a: any, b: any) => a.ordem - b.ordem);
  for (const [indice, foto] of fotos.entries()) {
    const { data: assinada, error: erroUrl } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(foto.storage_path, 300);
    if (erroUrl) throw erroUrl;
    const resposta = await fetch(assinada.signedUrl);
    if (!resposta.ok) throw new Error(`Não foi possível carregar a foto ${indice + 1}.`);
    const blob = await resposta.blob();
    const dataUrl = await blobParaDataUrl(blob);
    const dimensoes = doc.getImageProperties(dataUrl);
    const maxLargura = 180;
    const maxAltura = 250;
    const escala = Math.min(maxLargura / dimensoes.width, maxAltura / dimensoes.height);
    const largura = dimensoes.width * escala;
    const altura = dimensoes.height * escala;
    const x = (210 - largura) / 2;
    const yImagem = 15 + (maxAltura - altura) / 2;
    const formato = blob.type.includes("png") ? "PNG" : blob.type.includes("webp") ? "WEBP" : "JPEG";

    doc.addPage();
    doc.addImage(dataUrl, formato, x, yImagem, largura, altura);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.text(foto.colaborador_nome || `Foto ${indice + 1}`, 105, 285, { align: "center" });
  }

  const url = doc.output("bloburl");
  const janela = window.open(url, "_blank");
  if (!janela) {
    URL.revokeObjectURL(url.toString());
    throw new Error("Libere os pop-ups para abrir o PDF");
  }
  janela.opener = null;
}
