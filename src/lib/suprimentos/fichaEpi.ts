/**
 * Ficha de Controle e Entrega de EPI de um pedido de materiais.
 *
 * O layout reproduz a ficha em papel que a operação já usava (modelo enviado
 * em set/2026): cabeçalho com a empresa empregadora, dados do colaborador,
 * declaração da NR-6 / art. 158 da CLT e a grade de retirada/devolução.
 *
 * O CABEÇALHO vem do CONTRATO do pedido (contratos.empresa_id), não da
 * empresa do usuário logado. O grupo tem seis CNPJs (AGPS, Canaã, HAGG, LF,
 * NH, SN) e o mesmo Supply atende todos — a ficha de um porteiro da SN
 * precisa sair com o CNPJ da SN mesmo quando quem imprime está vinculado à
 * HAGG. Quem resolve isso é a RPC sup_pedido_ficha_epi: a policy de
 * `empresas` só deixa ler as empresas em que o usuário atua, então um join
 * feito direto do navegador devolveria o cabeçalho vazio justamente nesse caso.
 *
 * Tudo o que a RPC não souber (pessoa ainda não está em EMPREGADOS, que é o
 * caso de toda admissão) cai para o que está no próprio pedido, e o modal
 * deixa editar antes de imprimir.
 */

export interface PedidoFicha {
  id: string;
  pedido_id: string;
  status: string;
  nome_colaborador: string;
  matricula_colaborador: string | null;
  admissao: boolean;
  data_admissao: string | null;
  contrato_nome: string;
  posto_nome: string;
  funcao_nome: string;
  data_despachado: string | null;
  sup_pedido_item: Array<{
    nome_item: string;
    tamanho: string | null;
    quantidade: number;
    litros: string | null;
    ordem: number;
  }>;
}

/** Formato devolvido pela RPC sup_pedido_ficha_epi. */
export interface RespostaFichaEpi {
  empresa: { razao_social: string | null; cnpj: string | null; codigo: string | null } | null;
  contrato: { nome: string | null; cliente: string | null } | null;
  colaborador: {
    matricula: string | null;
    admissao: string | null;
    cargo: string | null;
    local: string | null;
    situacao: string | null;
    demissao: string | null;
  } | null;
  itens: Array<{
    nome_item: string;
    tamanho: string | null;
    quantidade: number;
    litros: string | null;
    ordem: number;
    /** C.A. das etiquetas que saíram para o item; vários viram "123 / 456". */
    ca: string | null;
  }>;
}

/** Campos de texto livre da ficha — os que o modal deixa corrigir. */
export interface CamposFicha {
  nome: string;
  registro: string;
  admissao: string;
  funcao: string;
  secao: string;
  demissao: string;
  /** Data ao lado da assinatura da declaração. */
  data: string;
}

export interface LinhaFicha {
  retirada: string;
  devolucao: string;
  quantidade: string;
  descricao: string;
  tamanho: string;
  ca: string;
}

export interface DadosFichaEpi {
  empresa: { razao_social: string; cnpj: string } | null;
  contrato: string;
  protocolo: string;
  campos: CamposFicha;
  itens: LinhaFicha[];
}

/** A folha em papel tinha 20 linhas; menos que isso a ficha fica "cortada". */
export const LINHAS_MINIMAS = 20;

/**
 * Data em dd/mm/aaaa. Aceita `aaaa-mm-dd` (coluna date), timestamp com hora
 * (convertido no fuso de Brasília — um despacho às 22h de São Paulo já é o
 * dia seguinte em UTC) e texto que já esteja em dd/mm/aaaa.
 */
export function dataBR(valor: string | null | undefined): string {
  if (!valor) return "";
  const s = String(valor).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const [a, m, d] = s.split("-");
    return `${d}/${m}/${a}`;
  }
  if (/^\d{4}-\d{2}-\d{2}[T ]/.test(s)) {
    const data = new Date(s);
    if (!Number.isNaN(data.getTime())) {
      return data.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
    }
  }
  return s;
}

export function montarFichaEpi(pedido: PedidoFicha, resposta: RespostaFichaEpi | null): DadosFichaEpi {
  const col = resposta?.colaborador ?? null;
  // Data de retirada só para pedido DESPACHADO. "Retirado para entrega" não
  // conta: é o supervisor levando o pacote, o colaborador ainda não recebeu —
  // e é o recebimento dele que a ficha registra. Fora disso a coluna sai em
  // branco, para ser preenchida à mão na entrega.
  const despachado = pedido.status === "DESPACHADO";
  const retiradaPadrao = despachado ? dataBR(pedido.data_despachado) : "";

  // A RPC devolve somente o que efetivamente saiu do estoque, já com a
  // quantidade enviada (inclusive quando o atendimento foi parcial). Sem a
  // resposta dela não há como distinguir enviado de pendente com segurança:
  // deixar a grade vazia é preferível a emitir um documento trabalhista com
  // material que o colaborador não recebeu.
  const itensOrigem = resposta?.itens ?? [];

  const itens = [...itensOrigem]
    .sort((a, b) => a.ordem - b.ordem)
    .map((i) => ({
      retirada: retiradaPadrao,
      devolucao: "",
      quantidade: i.quantidade != null ? String(i.quantidade) : "",
      descricao: i.litros ? `${i.nome_item} (${i.litros} L)` : i.nome_item,
      tamanho: i.tamanho ?? "",
      ca: i.ca ?? "",
    }));

  const razao = resposta?.empresa?.razao_social?.trim();

  return {
    empresa: razao ? { razao_social: razao, cnpj: resposta?.empresa?.cnpj ?? "" } : null,
    contrato: resposta?.contrato?.nome?.trim() || pedido.contrato_nome || "",
    protocolo: pedido.pedido_id,
    campos: {
      nome: pedido.nome_colaborador ?? "",
      registro: col?.matricula || pedido.matricula_colaborador || "",
      // Admissão: o RH é a fonte; o pedido de admissão é o plano B, porque a
      // pessoa ainda não chegou em EMPREGADOS quando o uniforme é pedido.
      admissao: dataBR(col?.admissao) || (pedido.admissao ? dataBR(pedido.data_admissao) : ""),
      // Cargo oficial do RH antes da função do catálogo de Compras: a ficha é
      // documento trabalhista, e sup_funcao é só o que o encarregado escolheu
      // para pedir o uniforme.
      funcao: col?.cargo || pedido.funcao_nome || "",
      secao: pedido.posto_nome || col?.local || "",
      demissao: dataBR(col?.demissao),
      data: retiradaPadrao,
    },
    itens,
  };
}

function escapar(valor: unknown) {
  return String(valor ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** "10/09/2026" vira "10 / 09 / 2026"; vazio vira os traços do formulário. */
function dataDaDeclaracao(data: string) {
  const partes = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(data.trim());
  if (!partes) return `<span class="linha curta"></span>/<span class="linha curta"></span>/<span class="linha curta"></span>`;
  return `<span class="linha curta">${partes[1]}</span>/<span class="linha curta">${partes[2]}</span>/<span class="linha curta">${partes[3]}</span>`;
}

export function gerarHtmlFichaEpi(d: DadosFichaEpi, opcoes: { imprimir?: boolean } = {}) {
  const linhas = [...d.itens];
  while (linhas.length < LINHAS_MINIMAS) {
    linhas.push({ retirada: "", devolucao: "", quantidade: "", descricao: "", tamanho: "", ca: "" });
  }
  const c = d.campos;

  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <title>Ficha de EPI ${escapar(d.protocolo)}</title>
  <style>
    @page { size: A4 portrait; margin: 10mm; }
    * { box-sizing: border-box; }
    html, body { background: #fff; }
    body { margin: 0; color: #000; font-family: Calibri, Arial, Helvetica, sans-serif; font-size: 11px; }
    @media screen { body { padding: 8mm; } }
    table { width: 100%; border-collapse: collapse; table-layout: fixed; }
    td, th { border: 1px solid #000; padding: 3px 5px; vertical-align: middle; }
    .cab td { padding: 0; vertical-align: top; }
    .empresa-logo { height: 14mm; border-bottom: 1px solid #000; }
    .empresa-dados { padding: 4px 6px; font-weight: 700; font-size: 10.5px; line-height: 1.5; text-transform: uppercase; }
    .titulo { height: 24mm; display: flex; align-items: center; justify-content: center; text-align: center;
              padding: 4px 10px; font-weight: 700; font-size: 13px; border-bottom: 1px solid #000; }
    .sigla { padding: 3px; text-align: center; font-size: 11px; }
    .dados td { height: 10mm; vertical-align: top; }
    .dados .rotulo { font-size: 10px; }
    .dados .valor { display: block; margin-top: 2px; font-weight: 700; font-size: 11px; text-transform: uppercase; }
    .declaracao td { padding: 5px 8px; font-size: 10.5px; line-height: 1.45; }
    .declaracao .forte { font-weight: 700; text-align: center; }
    .declaracao .centro { text-align: center; }
    .assinatura td { height: 10mm; vertical-align: bottom; padding-bottom: 4px; }
    .linha { display: inline-block; border-bottom: 1px solid #000; text-align: center; font-weight: 700; }
    .linha.curta { min-width: 9mm; }
    .linha.longa { min-width: 72mm; }
    .itens th { font-weight: 400; font-size: 10.5px; text-align: center; }
    .itens thead { display: table-header-group; }
    .itens td { height: 6mm; font-size: 10.5px; }
    .itens .c { text-align: center; }
    .itens tr { page-break-inside: avoid; }
    .rodape { display: flex; justify-content: space-between; align-items: flex-end; margin-top: 10mm; font-size: 11px; }
    .rodape .ref { font-size: 8.5px; color: #666; }
  </style>
</head>
<body>
  <table class="cab">
    <colgroup><col style="width:40%" /><col style="width:60%" /></colgroup>
    <tr>
      <td>
        <div class="empresa-logo"></div>
        <div class="empresa-dados">
          <div>${escapar(d.empresa?.razao_social ?? "")}</div>
          <div>CNPJ: ${escapar(d.empresa?.cnpj ?? "")}</div>
          <div>${escapar(d.contrato)}</div>
        </div>
      </td>
      <td>
        <div class="titulo">FICHA DE CONTROLE E ENTREGA DE EQUIPAMENTO DE PROTEÇÃO INDIVIDUAL</div>
        <div class="sigla">E.P.I</div>
      </td>
    </tr>
  </table>
  <table class="dados">
    <colgroup><col style="width:29%" /><col style="width:27%" /><col style="width:44%" /></colgroup>
    <tr>
      <td><span class="rotulo">NOME:</span><span class="valor">${escapar(c.nome)}</span></td>
      <td><span class="rotulo">Nº DE REGISTRO:</span><span class="valor">${escapar(c.registro)}</span></td>
      <td><span class="rotulo">DATA DE ADMISSÃO:</span><span class="valor">${escapar(c.admissao)}</span></td>
    </tr>
    <tr>
      <td><span class="rotulo">FUNÇÃO:</span><span class="valor">${escapar(c.funcao)}</span></td>
      <td><span class="rotulo">SEÇÃO/LOCAL:</span><span class="valor">${escapar(c.secao)}</span></td>
      <td><span class="rotulo">DATA DE DEMISSÃO:</span><span class="valor">${escapar(c.demissao)}</span></td>
    </tr>
  </table>
  <table class="declaracao">
    <tr><td>
      <div class="forte">DECLARO PARA OS DEVIDOS FINS, QUE RECEBI OS EPI'S ABAIXO DESCRITOS E ME COMPROMETO:</div>
      <div>* USÁ-LOS APENAS PARA A FINALIDADE A QUE SE DESTINAM;</div>
      <div>* RESPONSABILIZAR-ME POR SUA GUARDA E CONSERVAÇÃO;</div>
      <div>* COMUNICAR AO EMPREGADOR QUALQUER MODIFICAÇÃO QUE OS TORNEM IMPRÓPRIOS PARA O USO;</div>
      <div>* RESPONSABILIZAR-ME PELA DANIFICAÇÃO DO E.P.I DEVIDO AO USO INADEQUADO OU FORA DAS ATIVIDADES A QUE SE DESTINAM, BEM COMO PELO SEU EXTRAVIO.</div>
      <div class="forte">DECLARO AINDA ESTAR CIENTE DE QUE O USO É OBRIGATÓRIO.</div>
      <div class="centro">SOB RESPONSABILIDADE DE SER PENALIZADO CONFORME LEI Nº 6.514, DE 22/12/1977, ARTIGO 158.</div>
      <div class="centro">DECLARO, AINDA, QUE RECEBI TREINAMENTO REFERENTE AO USO DO E.P.I E AS NORMAS DE SEGURANÇA DO TRABALHO.</div>
    </td></tr>
  </table>
  <table class="assinatura">
    <colgroup><col style="width:34%" /><col style="width:66%" /></colgroup>
    <tr>
      <td style="border-right:0">&nbsp;&nbsp;DATA: ${dataDaDeclaracao(c.data)}</td>
      <td style="border-left:0;text-align:right">ASSINATURA DO FUNCIONÁRIO: <span class="linha longa"></span></td>
    </tr>
  </table>
  <table class="itens">
    <colgroup>
      <col style="width:10%" /><col style="width:10%" /><col style="width:9%" /><col style="width:27%" />
      <col style="width:7%" /><col style="width:9.5%" /><col style="width:27.5%" />
    </colgroup>
    <thead>
      <tr>
        <th colspan="2">DATA:</th>
        <th rowspan="2">QUANT</th>
        <th rowspan="2">DESCRIÇÃO</th>
        <th rowspan="2">TM</th>
        <th rowspan="2">Nº DO C.A</th>
        <th rowspan="2">ASSINATURA</th>
      </tr>
      <tr><th style="font-size:9px">RETIRADA</th><th style="font-size:9px">DEVOLUÇÃO</th></tr>
    </thead>
    <tbody>
      ${linhas.map((l) => `<tr><td class="c">${escapar(l.retirada)}</td><td class="c">${escapar(l.devolucao)}</td><td class="c">${escapar(l.quantidade)}</td><td>${escapar(l.descricao)}</td><td class="c">${escapar(l.tamanho)}</td><td class="c">${escapar(l.ca)}</td><td></td></tr>`).join("")}
    </tbody>
  </table>
  <div class="rodape">
    <span>ASS. RESPONSÁVEL PELA ENTREGA: <span class="linha longa"></span></span>
    <span class="ref">Pedido ${escapar(d.protocolo)}</span>
  </div>
  ${opcoes.imprimir ? "<script>setTimeout(() => window.print(), 300);</script>" : ""}
</body>
</html>`;
}

export function imprimirFichaEpi(d: DadosFichaEpi) {
  const janela = window.open("", "_blank", "width=900,height=700");
  if (!janela) throw new Error("O navegador bloqueou a janela de impressão. Libere os pop-ups deste site.");
  janela.document.write(gerarHtmlFichaEpi(d, { imprimir: true }));
  janela.document.close();
}
