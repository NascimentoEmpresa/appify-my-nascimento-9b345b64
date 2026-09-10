import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import QRCode from "qrcode";
import { supabase } from "@/integrations/supabase/client";
import logoGrupoNascimento from "@/assets/logo-grupo-nascimento.png";

// As relações novas ainda não existem no types.ts até a migration remota.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as any;
const BUCKET = "sup-comprovacoes";

// Layout do comprovante segue o template aprovado pela operação (set/2026):
// cabeçalho com marca + status, dois blocos de dados, tabela de itens e
// rodapé de validação. As fotos enviadas no formulário viram páginas anexas,
// e o rodapé linka para elas — por isso o QR/rodapé só é desenhado no fim,
// quando já se sabe em que página a seção de fotos começou.
const AZUL: [number, number, number] = [27, 54, 93];
const CINZA_CAIXA: [number, number, number] = [228, 233, 240];
const CINZA_BORDA: [number, number, number] = [190, 198, 210];
const CINZA_ZEBRA: [number, number, number] = [237, 241, 246];
const MARGEM = 15;
const LARGURA_PAGINA = 210;
const ALTURA_PAGINA = 297;

function blobParaDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const leitor = new FileReader();
    leitor.onload = () => resolve(String(leitor.result));
    leitor.onerror = () => reject(leitor.error);
    leitor.readAsDataURL(blob);
  });
}

async function carregarDataUrl(url: string) {
  const resposta = await fetch(url);
  if (!resposta.ok) throw new Error("Não foi possível carregar a imagem do comprovante.");
  return blobParaDataUrl(await resposta.blob());
}

/** Bloco com título e lista de rótulo/valor. Devolve o Y do fim da caixa. */
function caixaDados(
  doc: jsPDF,
  titulo: string,
  linhas: Array<[string, unknown]>,
  x: number,
  y: number,
  largura: number,
  alturaMinima: number,
) {
  doc.setFontSize(9);
  const larguraInterna = largura - 8;
  const corpo = linhas.map(([rotulo, valor]) => {
    const texto = `${rotulo}: ${String(valor ?? "").trim() || "—"}`;
    return doc.splitTextToSize(texto, larguraInterna) as string[];
  });
  const altura = Math.max(alturaMinima, 12 + corpo.reduce((total, l) => total + l.length * 4.6, 0) + 3);

  doc.setDrawColor(...CINZA_BORDA);
  doc.setFillColor(255, 255, 255);
  doc.roundedRect(x, y, largura, altura, 1.5, 1.5, "FD");
  doc.setFillColor(...CINZA_CAIXA);
  doc.roundedRect(x, y, largura, 8, 1.5, 1.5, "F");
  doc.rect(x, y + 5, largura, 3, "F");
  doc.setDrawColor(...CINZA_BORDA);
  doc.line(x, y + 8, x + largura, y + 8);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.5);
  doc.setTextColor(...AZUL);
  doc.text(titulo, x + 4, y + 5.4);

  doc.setFontSize(9);
  let cursor = y + 13;
  corpo.forEach((linhasTexto, indice) => {
    const [rotulo] = linhas[indice];
    linhasTexto.forEach((linha, posicao) => {
      if (posicao === 0) {
        const prefixo = `${rotulo}:`;
        doc.setFont("helvetica", "bold");
        doc.setTextColor(40, 40, 40);
        doc.text(prefixo, x + 4, cursor);
        doc.setFont("helvetica", "normal");
        doc.setTextColor(60, 60, 60);
        doc.text(linha.slice(prefixo.length), x + 4 + doc.getTextWidth(prefixo), cursor);
      } else {
        doc.setFont("helvetica", "normal");
        doc.setTextColor(60, 60, 60);
        doc.text(linha, x + 4, cursor);
      }
      cursor += 4.6;
    });
  });

  return y + altura;
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

  // ── Cabeçalho: marca à esquerda, faixa de status à direita ────────────────
  try {
    const logo = await carregarDataUrl(logoGrupoNascimento);
    const proporcao = doc.getImageProperties(logo);
    const alturaLogo = 11;
    doc.addImage(logo, MARGEM, 14, (proporcao.width / proporcao.height) * alturaLogo, alturaLogo);
  } catch {
    // Sem a logo o comprovante continua válido — não vale derrubar a geração.
    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.setTextColor(...AZUL);
    doc.text("Grupo Nascimento", MARGEM, 22);
  }

  const larguraStatus = 62;
  doc.setFillColor(...AZUL);
  doc.rect(LARGURA_PAGINA - MARGEM - larguraStatus, 14, larguraStatus, 11, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(255, 255, 255);
  doc.text("STATUS: ENTREGUE", LARGURA_PAGINA - MARGEM - larguraStatus / 2, 21.2, { align: "center" });

  doc.setFont("helvetica", "bold");
  doc.setFontSize(19);
  doc.setTextColor(20, 20, 20);
  doc.text("Comprovação de Entrega", LARGURA_PAGINA / 2, 40, { align: "center" });

  // ── Blocos de dados ───────────────────────────────────────────────────────
  const larguraCaixa = (LARGURA_PAGINA - MARGEM * 2 - 6) / 2;
  const yCaixas = 48;
  const fimEsquerda = caixaDados(
    doc,
    "DADOS DO CONTRATO E LOCAL",
    [
      ["Protocolo", pedido.pedido_id],
      ["Contrato", pedido.contrato_nome],
      ["Posto", pedido.posto_nome],
      ["Função", pedido.funcao_nome],
    ],
    MARGEM,
    yCaixas,
    larguraCaixa,
    46,
  );
  const fimDireita = caixaDados(
    doc,
    "DADOS DA ENTREGA E RECEBIMENTO",
    [
      ["Colaborador", pedido.nome_colaborador],
      ["Recebedor", comprovacao.recebedor_nome],
      ["Respondido por", comprovacao.respondido_por_nome],
      ["Data", comprovacao.respondido_em ? new Date(comprovacao.respondido_em).toLocaleString("pt-BR") : "—"],
      ["Observação", comprovacao.observacao],
    ],
    MARGEM + larguraCaixa + 6,
    yCaixas,
    larguraCaixa,
    46,
  );

  // ── Itens ─────────────────────────────────────────────────────────────────
  const yItens = Math.max(fimEsquerda, fimDireita) + 12;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.setTextColor(...AZUL);
  doc.text("ITENS ENTREGUES", MARGEM, yItens);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const itens = [...(pedido.sup_pedido_item ?? [])].sort((a: any, b: any) => a.ordem - b.ordem);
  autoTable(doc, {
    startY: yItens + 4,
    margin: { left: MARGEM, right: MARGEM, bottom: 45 },
    head: [["DESCRIÇÃO DO ITEM", "TAMANHO", "QUANTIDADE"]],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    body: itens.map((item: any) => [
      item.nome_item ?? "—",
      item.tamanho || (item.litros ? `${item.litros} L` : "—"),
      String(item.quantidade ?? ""),
    ]),
    theme: "plain",
    styles: { font: "helvetica", fontSize: 9, textColor: [55, 55, 55], cellPadding: 2.6 },
    headStyles: { fillColor: CINZA_CAIXA, textColor: AZUL, fontStyle: "bold", fontSize: 8.5 },
    alternateRowStyles: { fillColor: CINZA_ZEBRA },
    columnStyles: {
      1: { halign: "center", cellWidth: 32 },
      2: { halign: "center", cellWidth: 36 },
    },
  });

  // ── Fotos do formulário: uma por página, viram a "seção de fotos" ─────────
  const fotos = [...(comprovacao.sup_pedido_comprovacao_foto ?? [])]
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .sort((a: any, b: any) => a.ordem - b.ordem);
  let paginaFotos = 0;
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
    const maxAltura = 235;
    const escala = Math.min(maxLargura / dimensoes.width, maxAltura / dimensoes.height);
    const largura = dimensoes.width * escala;
    const altura = dimensoes.height * escala;
    const formato = blob.type.includes("png") ? "PNG" : blob.type.includes("webp") ? "WEBP" : "JPEG";

    doc.addPage();
    if (!paginaFotos) paginaFotos = doc.getNumberOfPages();

    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.setTextColor(...AZUL);
    doc.text(`FOTOS DA ENTREGA (${indice + 1}/${fotos.length})`, LARGURA_PAGINA / 2, 20, { align: "center" });
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    doc.setTextColor(110, 110, 110);
    doc.text(`Protocolo ${pedido.pedido_id}`, LARGURA_PAGINA / 2, 25.5, { align: "center" });

    doc.addImage(dataUrl, formato, (LARGURA_PAGINA - largura) / 2, 30 + (maxAltura - altura) / 2, largura, altura);

    doc.setFontSize(10);
    doc.setTextColor(40, 40, 40);
    doc.text(foto.colaborador_nome || `Foto ${indice + 1}`, LARGURA_PAGINA / 2, 275, { align: "center" });
  }

  // ── Rodapé de validação na primeira página (QR + link para as fotos) ──────
  doc.setPage(1);
  const yRodape = ALTURA_PAGINA - 40;
  const urlPedido = `${window.location.origin}/app/suprimentos/pedidos-materiais?pedido=${pedido.id}`;
  const qr = await QRCode.toDataURL(urlPedido, { margin: 0, width: 512 });
  doc.addImage(qr, "PNG", LARGURA_PAGINA - MARGEM - 26, yRodape - 4, 26, 26);

  doc.setDrawColor(...CINZA_BORDA);
  doc.line(MARGEM, yRodape + 20, LARGURA_PAGINA - MARGEM, yRodape + 20);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.5);
  doc.setTextColor(60, 60, 60);
  doc.text("VALIDAÇÃO: ESCANEIE O QR CODE PARA AUTENTICIDADE", MARGEM, yRodape + 25);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(120, 120, 120);
  doc.text(
    `Geração: ${new Date().toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}`,
    MARGEM,
    yRodape + 30,
  );

  if (paginaFotos) {
    const frase = `Ver as ${fotos.length} foto(s) da entrega →`;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(...AZUL);
    const larguraFrase = doc.getTextWidth(frase);
    const xFrase = LARGURA_PAGINA - MARGEM - larguraFrase;
    const yFrase = yRodape + 27;
    doc.text(frase, xFrase, yFrase);
    doc.setDrawColor(...AZUL);
    doc.line(xFrase, yFrase + 0.8, xFrase + larguraFrase, yFrase + 0.8);
    // Clicável tanto na frase quanto no próprio QR impresso.
    doc.link(xFrase, yFrase - 3, larguraFrase, 4.5, { pageNumber: paginaFotos });
    doc.link(LARGURA_PAGINA - MARGEM - 26, yRodape - 4, 26, 26, { pageNumber: paginaFotos });
  }

  const url = doc.output("bloburl");
  const janela = window.open(url, "_blank");
  if (!janela) {
    URL.revokeObjectURL(url.toString());
    throw new Error("Libere os pop-ups para abrir o PDF");
  }
  janela.opener = null;
}
