/**
 * Etiqueta térmica do pedido de material.
 *
 * O desenho aqui é uma reprodução deliberada da etiqueta do SISTEMA ANTIGO,
 * pedida pelo Compras em 04/09/2026: barra de cabeçalho, protocolo grande e
 * centralizado, status em caixa, e cada campo como RÓTULO pequeno em cima do
 * valor grande. A primeira versão desta tela imprimia texto corrido, e na
 * prancheta do almoxarifado isso é pior — quem está separando material lê de
 * relance, procurando o nome e o posto, não uma frase.
 *
 * Os campos são exatamente os da etiqueta antiga (protocolo, status,
 * colaborador, matrícula, solicitante, função, contrato, posto). MATRÍCULA e
 * SOLICITANTE tinham sumido na primeira versão — e solicitante é o que
 * distingue quem pediu de para quem é, que na etiqueta nova apareciam
 * confundidos num campo só.
 *
 * O QR code no canto inferior (só no modelo padrão) é a retirada para
 * entrega: o supervisor que busca o volume fora do horário lê com o celular
 * e confirma que levou — ver src/pages/suprimentos/RetiradaPedido.tsx.
 */

import { calcularEnvioItens, type EtiquetaParaEnvio, type ItemParaEnvio } from "./envioItens";

export type TamanhoEtiqueta = "PADRAO" | "COMPACTO";

export interface DadosEtiqueta {
  pedido_id: string;
  status: string;
  statusRotulo: string;
  nome_colaborador: string;
  matricula_colaborador: string | null;
  solicitante: string;
  funcao_nome: string;
  contrato_nome: string;
  posto_nome: string;
  /**
   * TODAS as linhas do pedido, não só as de uma situação. A separação entre
   * enviado e pendente é feita em `textoItens`, a partir das etiquetas — se
   * o filtro acontecesse aqui, a etiqueta voltaria a sair com meio pedido.
   */
  itens: ItemParaEnvio[];
  /**
   * PNG (data URL) do QR code de retirada. Vem pronto de fora porque a
   * geração é assíncrona e esta função monta HTML de forma síncrona — é o
   * mesmo HTML da prévia e da impressão.
   */
  qrDataUrl?: string | null;
}

/**
 * Endereço que o QR code abre. Leva o id (uuid) do pedido, e não o
 * protocolo: é inequívoco e não depende do formato do protocolo, que mudou
 * entre o legado e o sistema novo.
 */
export function urlRetirada(pedidoUuid: string, origem: string) {
  return `${origem}/app/suprimentos/retirada/${encodeURIComponent(pedidoUuid)}`;
}

/** Medidas reais das duas etiquetas, em milímetros. */
export const MEDIDAS: Record<TamanhoEtiqueta, { largura: number; altura: number }> = {
  PADRAO: { largura: 98, altura: 150 },
  COMPACTO: { largura: 40, altura: 50 },
};

export function escaparHtml(valor: string) {
  return valor
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * Uma linha de item, no formato que o almoxarifado já lê hoje.
 *
 * `quantidade` é parâmetro porque na etiqueta a mesma linha aparece com
 * números diferentes conforme a seção: no despacho parcial, 1 em ENVIADOS e
 * 1 em PENDENTES para um item pedido 2 vezes. Sem isso as duas seções
 * repetiriam a quantidade pedida e somariam o dobro do pedido.
 */
export function linhaItem(i: DadosEtiqueta["itens"][number], quantidade: number = i.quantidade) {
  const detalhes = [
    i.tamanho ? `Tam. ${i.tamanho}` : null,
    i.litros ? `${i.litros} L` : null,
    `Qtd. ${quantidade}`,
  ].filter(Boolean).join(" — ");
  return `• ${i.nome_item} — ${detalhes}`;
}

export const TITULO_ENVIADOS = "ITENS ENVIADOS:";
export const TITULO_PENDENTES = "ITENS PENDENTES DE ENVIO:";

/**
 * Texto livre que a tela oferece pronto para edição.
 *
 * Só os itens: o resto da etiqueta é montado a partir dos campos do pedido e
 * não passa por aqui, para ninguém conseguir imprimir uma etiqueta cujo
 * protocolo não bate com o pedido de onde ela saiu.
 *
 * Sai SEMPRE o pedido inteiro, em duas seções — ENVIADOS e PENDENTES DE
 * ENVIO. A etiqueta imprimia uma lista só, e quem separava o volume não
 * tinha como saber, pela etiqueta colada na caixa, o que já tinha ido e o que
 * ainda faltava: precisava voltar ao sistema. A divisão é a mesma dos botões
 * "Enviados"/"Pendentes envio" do card (calcularEnvioItens, por QUANTIDADE),
 * para os dois lugares nunca discordarem.
 *
 * Seção vazia é OMITIDA — título sem linha embaixo faz o conferente procurar
 * o que não existe. Sem etiqueta nenhuma baixada, o pedido inteiro é pendente
 * e sai uma seção só.
 */
export function textoItens(dados: DadosEtiqueta, etiquetas: EtiquetaParaEnvio[] = []) {
  const linhas = calcularEnvioItens(dados.itens, etiquetas);
  const enviados = linhas.filter((l) => l.enviada > 0).map((l) => linhaItem(l, l.enviada));
  const pendentes = linhas.filter((l) => l.pendente > 0).map((l) => linhaItem(l, l.pendente));

  const secoes = [
    enviados.length ? `${TITULO_ENVIADOS}\n${enviados.join("\n")}` : "",
    pendentes.length ? `${TITULO_PENDENTES}\n${pendentes.join("\n")}` : "",
  ].filter(Boolean);

  return secoes.join("\n\n");
}

function campo(rotulo: string, valor: string | null | undefined) {
  if (!valor) return "";
  return `<div class="campo"><span class="rotulo">${escaparHtml(rotulo)}</span><span class="valor">${escaparHtml(valor)}</span></div>`;
}

/**
 * HTML de UMA etiqueta.
 *
 * No modelo compacto (4x5 cm) o cabeçalho, o status e os itens saem: em
 * 40x50 mm eles roubariam o espaço do que se procura primeiro, que é o
 * protocolo e o nome. Não é limitação técnica, é escolha — enfiar tudo lá
 * produziria uma etiqueta ilegível.
 */
export function htmlEtiqueta(dados: DadosEtiqueta, tamanho: TamanhoEtiqueta, textoLivre: string) {
  const compacto = tamanho === "COMPACTO";
  const extra = textoLivre.trim();

  return `
    <section class="etiqueta">
      ${compacto ? "" : `<div class="cabecalho">GRUPO NASCIMENTO - COMPRAS</div>`}
      <div class="corpo">
        <div class="protocolo">${escaparHtml(dados.pedido_id)}</div>
        ${compacto ? "" : `<div class="status">${escaparHtml(dados.statusRotulo)}</div>`}
        ${campo("COLABORADOR", dados.nome_colaborador)}
        ${campo("MATRÍCULA", dados.matricula_colaborador || "—")}
        ${compacto ? "" : campo("SOLICITANTE", dados.solicitante)}
        ${campo("FUNÇÃO", dados.funcao_nome)}
        ${campo("CONTRATO", dados.contrato_nome)}
        ${campo("POSTO", dados.posto_nome)}
        ${!compacto && extra ? `<div class="livre">${escaparHtml(extra)}</div>` : ""}
      </div>
      ${!compacto && dados.qrDataUrl
        ? `<div class="qr"><span>Supervisor: leia ao retirar o pedido</span><img src="${escaparHtml(dados.qrDataUrl)}" alt=""></div>`
        : ""}
      ${compacto ? "" : `<div class="rodape">Gerado automaticamente via ERP | ${MEDIDAS[tamanho].largura}x${MEDIDAS[tamanho].altura}mm</div>`}
    </section>
  `;
}

/** CSS compartilhado entre a prévia da tela e a janela de impressão. */
export function cssEtiqueta(tamanho: TamanhoEtiqueta) {
  const { largura, altura } = MEDIDAS[tamanho];
  const compacto = tamanho === "COMPACTO";
  return `
    .etiqueta {
      width: ${largura}mm; height: ${altura}mm;
      box-sizing: border-box; overflow: hidden;
      display: flex; flex-direction: column;
      font-family: Arial, Helvetica, sans-serif;
      background: #fff; color: #000;
      border: ${compacto ? "0.4mm" : "0.6mm"} solid #000;
    }
    .cabecalho {
      background: #000; color: #fff; text-align: center;
      font-weight: 700; letter-spacing: .4px;
      font-size: ${compacto ? 5 : 9}pt; padding: ${compacto ? 1 : 2}mm 1mm;
    }
    .corpo { flex: 1; padding: ${compacto ? 1.5 : 3}mm; overflow: hidden; }
    .protocolo {
      text-align: center; font-weight: 700; font-family: "Courier New", monospace;
      font-size: ${compacto ? 7 : 12}pt; letter-spacing: ${compacto ? 0 : 0.3}px;
      margin-bottom: ${compacto ? 1 : 2}mm; overflow-wrap: anywhere;
    }
    .status {
      margin: 0 auto ${compacto ? 1 : 2.5}mm; display: table;
      border: 0.4mm solid #000; padding: 0.8mm 2.5mm;
      font-size: 8pt; font-weight: 700; text-transform: uppercase;
    }
    .campo { margin-bottom: ${compacto ? 0.8 : 2}mm; }
    .rotulo {
      display: block; font-size: ${compacto ? 4 : 6.5}pt;
      letter-spacing: .5px; text-transform: uppercase;
    }
    .valor {
      display: block; font-weight: 700; line-height: 1.1;
      font-size: ${compacto ? 6 : 10}pt; overflow-wrap: anywhere;
    }
    .livre {
      margin-top: 2mm; padding-top: 1.5mm; border-top: 0.3mm dashed #000;
      font-size: 7pt; line-height: 1.25; white-space: pre-wrap; overflow-wrap: anywhere;
    }
    .qr {
      display: flex; align-items: flex-end; justify-content: flex-end; gap: 2mm;
      padding: 0 3mm 2mm;
    }
    .qr span { font-size: 6pt; text-align: right; max-width: 30mm; line-height: 1.2; }
    /* 24 mm é folgado para a câmera de celular a um palmo; pixelated evita o
       borrão que a térmica transforma em módulo ilegível. */
    .qr img { width: 24mm; height: 24mm; image-rendering: pixelated; }
    .rodape {
      text-align: center; font-size: 5pt; padding: 1mm;
      border-top: 0.3mm solid #000;
    }
  `;
}

/**
 * Abre a janela de impressão com N cópias.
 *
 * Devolve `false` quando o navegador bloqueia o pop-up — quem chama avisa o
 * usuário. Silenciar isso faz o botão parecer quebrado.
 */
export function imprimirEtiqueta(
  dados: DadosEtiqueta,
  tamanho: TamanhoEtiqueta,
  textoLivre: string,
  copias: number,
): boolean {
  const janela = window.open("", "_blank", "width=650,height=750");
  if (!janela) return false;

  const { largura, altura } = MEDIDAS[tamanho];
  const total = Math.max(1, copias);
  const paginas = Array.from({ length: total }, (_, i) =>
    htmlEtiqueta(dados, tamanho, textoLivre).replace(
      "<section class=\"etiqueta\">",
      `<section class="etiqueta${i === total - 1 ? " ultima" : ""}">`,
    ),
  ).join("");

  janela.document.write(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
    <title>Etiqueta ${escaparHtml(dados.pedido_id)}</title><style>
    @page { size: ${largura}mm ${altura}mm; margin: 0; }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; }
    ${cssEtiqueta(tamanho)}
    .etiqueta { page-break-after: always; }
    .etiqueta.ultima { page-break-after: auto; }
  </style></head><body>${paginas}
  <script>setTimeout(() => window.print(), 250);<\/script></body></html>`);
  janela.document.close();
  return true;
}
