import QRCode from "qrcode";
import { escaparHtml, urlRetirada } from "./etiquetaTermica";

export interface PedidoRomaneioImpressao {
  pedido_id: string;
  nome_colaborador: string;
  posto_nome: string;
  sup_pedido_item?: Array<{ quantidade: number }>;
  quantidade_itens?: number;
}

export interface RomaneioImpressao {
  id: string;
  codigo: string;
  contrato_nome: string;
  volumes: number | null;
  observacao: string | null;
  created_at?: string;
  pedidos: PedidoRomaneioImpressao[];
}

function quantidadeItens(pedido: PedidoRomaneioImpressao) {
  if (pedido.quantidade_itens != null) return pedido.quantidade_itens;
  return (pedido.sup_pedido_item ?? []).reduce(
    (total, item) => total + Number(item.quantidade || 0),
    0,
  );
}

/**
 * Abre a janela antes de aguardar o QR. Assim o gesto do clique ainda está
 * ativo e o bloqueador de pop-up não confunde geração assíncrona com anúncio.
 */
export async function imprimirRomaneio(
  romaneio: RomaneioImpressao,
  janelaExistente?: Window,
): Promise<boolean> {
  const janela = janelaExistente ?? window.open("", "_blank", "width=900,height=900");
  if (!janela) return false;

  janela.document.write(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
    <title>${escaparHtml(romaneio.codigo)}</title></head><body style="font-family:Arial;padding:32px">
    Gerando romaneio…</body></html>`);
  janela.document.close();

  try {
    const qr = await QRCode.toDataURL(urlRetirada(romaneio.id, window.location.origin), {
      margin: 1,
      width: 768,
      errorCorrectionLevel: "M",
    });
    const linhas = romaneio.pedidos.map((pedido, indice) => `
      <tr>
        <td>${indice + 1}</td>
        <td class="mono">${escaparHtml(pedido.pedido_id)}</td>
        <td>${escaparHtml(pedido.nome_colaborador || "—")}</td>
        <td>${escaparHtml(pedido.posto_nome || "—")}</td>
        <td class="numero">${quantidadeItens(pedido)}</td>
      </tr>`).join("");

    janela.document.open();
    janela.document.write(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
      <title>${escaparHtml(romaneio.codigo)}</title>
      <style>
        @page { size: A4 portrait; margin: 12mm; }
        * { box-sizing: border-box; }
        body { margin: 0; color: #111; font-family: Arial, Helvetica, sans-serif; font-size: 10pt; }
        header { display: grid; grid-template-columns: 1fr 38mm; gap: 8mm; align-items: start; border-bottom: 1.2mm solid #111; padding-bottom: 5mm; }
        h1 { margin: 0 0 2mm; font-size: 22pt; }
        .subtitulo { margin: 0 0 5mm; color: #444; }
        .dados { display: grid; grid-template-columns: 28mm 1fr; gap: 1.5mm 3mm; }
        .rotulo { color: #555; text-transform: uppercase; font-size: 8pt; }
        .valor { font-weight: 700; }
        .qr { text-align: center; font-size: 7pt; line-height: 1.2; }
        .qr img { display: block; width: 36mm; height: 36mm; image-rendering: pixelated; margin-bottom: 1mm; }
        table { width: 100%; margin-top: 6mm; border-collapse: collapse; }
        thead { display: table-header-group; }
        th, td { border: .25mm solid #777; padding: 2mm; vertical-align: top; }
        th { background: #eee; text-align: left; font-size: 8pt; text-transform: uppercase; }
        tr { break-inside: avoid; }
        .mono { font-family: "Courier New", monospace; white-space: nowrap; }
        .numero { text-align: center; }
        .observacao { margin-top: 5mm; border: .25mm solid #999; padding: 3mm; white-space: pre-wrap; }
        footer { margin-top: 8mm; padding-top: 3mm; border-top: .25mm solid #999; color: #555; font-size: 8pt; }
      </style></head><body>
      <header>
        <div>
          <h1>Romaneio de Retirada</h1>
          <p class="subtitulo">Um QR para conferir os pedidos deste volume.</p>
          <div class="dados">
            <span class="rotulo">Código</span><span class="valor mono">${escaparHtml(romaneio.codigo)}</span>
            <span class="rotulo">Contrato</span><span class="valor">${escaparHtml(romaneio.contrato_nome)}</span>
            <span class="rotulo">Volumes</span><span class="valor">${romaneio.volumes ?? "Não informado"}</span>
            <span class="rotulo">Pedidos</span><span class="valor">${romaneio.pedidos.length}</span>
          </div>
        </div>
        <div class="qr"><img src="${escaparHtml(qr)}" alt="QR do romaneio">Supervisor: leia para conferir e confirmar a retirada.</div>
      </header>
      <table>
        <thead><tr><th>#</th><th>Protocolo</th><th>Colaborador</th><th>Posto</th><th>Qtd. itens</th></tr></thead>
        <tbody>${linhas}</tbody>
      </table>
      ${romaneio.observacao ? `<div class="observacao"><strong>Observação:</strong> ${escaparHtml(romaneio.observacao)}</div>` : ""}
      <footer>Gerado automaticamente via ERP · confira todos os volumes antes de confirmar a retirada.</footer>
      <script>setTimeout(() => window.print(), 300);</script>
      </body></html>`);
    janela.document.close();
    return true;
  } catch (erro) {
    janela.close();
    throw erro;
  }
}
