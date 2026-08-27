/**
 * Leitura do XML de NF-e que a Receita entrega.
 *
 * O XML fica guardado inteiro em `nfe_dist_documento.xml`. Extrair os produtos
 * aqui, na tela, evita uma tabela de itens que seria só uma cópia do que já
 * está no XML — e o XML é a fonte fiscal, não pode divergir de um espelho.
 */

export interface ItemNfe {
  codigo: string;
  descricao: string;
  ncm: string;
  unidade: string;
  quantidade: number;
  valorUnitario: number;
  valorTotal: number;
}

export interface NfeLida {
  chave: string;
  numero: string;
  serie: string;
  emitente: string;
  emitenteCnpj: string;
  emitidaEm: string | null;
  valorTotal: number;
  itens: ItemNfe[];
}

const texto = (pai: Element | Document | null, tag: string): string => {
  if (!pai) return "";
  const el = pai.querySelector(tag);
  return el?.textContent?.trim() ?? "";
};

const numero = (pai: Element | Document | null, tag: string): number => {
  const v = texto(pai, tag);
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/**
 * Lê o XML e devolve a nota com os itens, ou null se não for uma NF-e completa.
 *
 * Devolver null para o resumo é proposital: `resNFe` tem cabeçalho e nenhum
 * `<det>`, então tratar os dois iguais mostraria uma nota "sem produtos" e
 * pareceria defeito, quando é só a fase anterior do ciclo.
 */
export function lerNfeXml(xml: string | null | undefined): NfeLida | null {
  if (!xml || !xml.includes("<det")) return null;

  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(xml, "application/xml");
  } catch {
    return null;
  }
  if (doc.querySelector("parsererror")) return null;

  const ide = doc.querySelector("ide");
  const emit = doc.querySelector("emit");
  const total = doc.querySelector("ICMSTot");

  const itens: ItemNfe[] = [];
  // `det` são os itens; cada um tem um `prod` com os dados do produto.
  doc.querySelectorAll("det").forEach((det) => {
    const prod = det.querySelector("prod");
    if (!prod) return;
    itens.push({
      codigo: texto(prod, "cProd"),
      descricao: texto(prod, "xProd"),
      ncm: texto(prod, "NCM"),
      unidade: texto(prod, "uCom"),
      quantidade: numero(prod, "qCom"),
      valorUnitario: numero(prod, "vUnCom"),
      valorTotal: numero(prod, "vProd"),
    });
  });

  // A chave está no atributo Id de infNFe, com o prefixo "NFe".
  const infNFe = doc.querySelector("infNFe");
  const chave = (infNFe?.getAttribute("Id") ?? "").replace(/^NFe/, "");

  return {
    chave,
    numero: texto(ide, "nNF"),
    serie: texto(ide, "serie"),
    emitente: texto(emit, "xNome"),
    emitenteCnpj: texto(emit, "CNPJ"),
    emitidaEm: (texto(ide, "dhEmi") || texto(ide, "dEmi") || "").slice(0, 10) || null,
    valorTotal: numero(total, "vNF"),
    itens,
  };
}
