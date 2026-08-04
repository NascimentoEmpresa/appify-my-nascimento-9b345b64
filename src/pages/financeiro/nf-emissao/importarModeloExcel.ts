import * as XLSX from "xlsx";
import { PostoVigente } from "@/hooks/usePlanilhaCusto";

// Lê o "MODELO" de NFs em Excel que o Financeiro já mantém por contrato:
// aba "Lista NFs" (índice/resumo, uma linha por nota) + uma aba por nota
// com o detalhe/valor daquela nota específica. Best-effort: a "Variação"
// (nome da nota) é confiável em todos os exemplos inspecionados; o valor de
// referência e a sugestão de posto dependem de achar a aba de detalhe
// correspondente, o que nem sempre bate 100% (ex: nome na Lista NFs
// levemente diferente do nome da aba) — por isso ficam null quando não
// encontrados, em vez de quebrar a importação inteira.

export interface ItemImportado {
  valor: number | null;
  posto: string | null;
}

export interface VariacaoImportada {
  variacao: string;
  itens: ItemImportado[];
  descricaoSugerida: string | null;
  issqnPct: number | null;
  irPct: number | null;
  cofinsPct: number | null;
  pisPct: number | null;
  csllPct: number | null;
}

export async function parseModeloExcel(arquivo: File, postosVigentes: PostoVigente[]): Promise<VariacaoImportada[]> {
  const buf = await arquivo.arrayBuffer();
  const wb = XLSX.read(new Uint8Array(buf), { type: "array" });

  const nomeListaSheet = wb.SheetNames.find((n) => n.toLowerCase().includes("lista")) ?? wb.SheetNames[0];
  const wsLista = wb.Sheets[nomeListaSheet];
  const linhas: unknown[][] = XLSX.utils.sheet_to_json(wsLista, { header: 1, raw: true, defval: "" });

  let headerIdx = -1;
  let colVariacao = -1;
  for (let i = 0; i < Math.min(8, linhas.length); i++) {
    const linha = (linhas[i] ?? []).map((c) => String(c ?? "").trim().toUpperCase());
    const iVar = linha.indexOf("VARIAÇÃO");
    if (iVar >= 0) {
      headerIdx = i;
      colVariacao = iVar;
      break;
    }
  }
  if (headerIdx === -1) {
    throw new Error('Não encontrei a coluna "Variação" na aba de lista de NFs desta planilha.');
  }

  const resultado: VariacaoImportada[] = [];
  for (let i = headerIdx + 1; i < linhas.length; i++) {
    const row = linhas[i];
    if (!row || row.length === 0) continue;
    const variacao = String(row[colVariacao] ?? "").trim();
    if (!variacao) continue;
    const notaNome = String(row[1] ?? "").trim();

    let itens: ItemImportado[] = [{ valor: null, posto: null }];
    let descricaoSugerida: string | null = null;
    let issqnPct: number | null = null;
    let irPct: number | null = null;
    let cofinsPct: number | null = null;
    let pisPct: number | null = null;
    let csllPct: number | null = null;

    const abaDetalhe = encontrarAbaDetalhe(wb.SheetNames, notaNome);
    if (abaDetalhe) {
      const detalhe = extrairDetalheNota(wb.Sheets[abaDetalhe], postosVigentes);
      if (detalhe.itens.length > 0) itens = detalhe.itens;
      descricaoSugerida = detalhe.descricaoServico;
      issqnPct = detalhe.issqnPct;
      irPct = detalhe.irPct;
      cofinsPct = detalhe.cofinsPct;
      pisPct = detalhe.pisPct;
      csllPct = detalhe.csllPct;
    }

    resultado.push({ variacao, itens, descricaoSugerida, issqnPct, irPct, cofinsPct, pisPct, csllPct });
  }
  return resultado;
}

const STOPWORDS_ABA = new Set(["NF", "COPA", "DE"]);

function tokensAba(s: string): Set<string> {
  const normalizado = s
    .trim()
    .toUpperCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");
  return new Set(normalizado.split(" ").filter((t) => t && !STOPWORDS_ABA.has(t)));
}

// O nome da nota na "Lista NFs" às vezes não bate exatamente com o nome da
// aba de detalhe (ex: "NF copa ELDORADO" na lista vs. aba "NF Eldorado" —
// confirmado na planilha real da UFRGS Copa e Cozinha, onde essa palavra a
// mais fazia o match por substring falhar e a nota ficar sem valor/posto).
// Por isso comparamos por sobreposição de palavras significativas (ignorando
// "NF"/"copa"/"de"), não por substring exata.
function encontrarAbaDetalhe(sheetNames: string[], notaNome: string): string | null {
  if (!notaNome) return null;
  const exato = sheetNames.find((n) => n.trim().toLowerCase() === notaNome.toLowerCase());
  if (exato) return exato;

  const alvoTokens = tokensAba(notaNome);
  let melhor: string | null = null;
  let melhorScore = 0;
  for (const n of sheetNames) {
    const candTokens = tokensAba(n);
    if (candTokens.size === 0) continue;
    const intersecao = [...candTokens].filter((t) => alvoTokens.has(t)).length;
    const score = intersecao / candTokens.size;
    if (score > melhorScore) {
      melhorScore = score;
      melhor = n;
    }
  }
  if (melhorScore >= 0.6) return melhor;

  // fallback: substring bruta (cobre casos como "PRÉDIO I" cujo nome já é
  // simples o bastante pra não precisar de tokenização)
  const alvo = notaNome.toLowerCase().replace(/\s+/g, " ");
  const parecido = sheetNames.find((n) => {
    const cand = n.trim().toLowerCase().replace(/\s+/g, " ");
    return cand.includes(alvo) || alvo.includes(cand);
  });
  return parecido ?? null;
}

interface RetencoesExtraidas {
  issqnPct: number | null;
  irPct: number | null;
  cofinsPct: number | null;
  pisPct: number | null;
  csllPct: number | null;
}

// A planilha traz um bloco "Retenção de impostos" (rótulo na coluna, valor na
// coluna seguinte, ex. M11="ISSQN" / N11=0.02) — a mesma aba também reusa
// esses rótulos como cabeçalho de uma tabela de totais mais abaixo (rótulo ao
// lado de outro rótulo, não de número), por isso só aceitamos o par se o
// vizinho for de fato uma fração de imposto plausível (0 a 1).
const RETENCAO_LABELS: Record<string, keyof RetencoesExtraidas> = {
  ISSQN: "issqnPct",
  IR: "irPct",
  COFINS: "cofinsPct",
  COFIS: "cofinsPct", // typo recorrente nas planilhas do Financeiro
  PIS: "pisPct",
  CSLL: "csllPct",
};

function extrairRetencoes(linhas: unknown[][]): RetencoesExtraidas {
  const result: RetencoesExtraidas = { issqnPct: null, irPct: null, cofinsPct: null, pisPct: null, csllPct: null };
  for (const linha of linhas) {
    if (!linha) continue;
    for (let c = 0; c < linha.length; c++) {
      const campo = RETENCAO_LABELS[String(linha[c] ?? "").trim().toUpperCase()];
      if (!campo || result[campo] != null) continue;
      const vizinho = linha[c + 1];
      if (typeof vizinho === "number" && vizinho >= 0 && vizinho < 1) {
        result[campo] = vizinho;
      }
    }
  }
  return result;
}

// Uma nota pode ser composta por vários postos/unidades (ex: Veranópolis tem
// notas com até 6 "Valor contrato exec. N" numa mesma aba — um por
// escola/prédio) — o cabeçalho repete o rótulo com sufixo numérico por
// coluna, e a linha seguinte traz os valores na mesma posição. Inspecionado
// direto na planilha real (VERANÓPOLIS 01.2021.xlsm): a maioria das notas só
// usa a coluna 1, mas várias têm 2 a 6 colunas populadas de uma vez — pegar
// só a primeira (como o código fazia antes) subestimava o valor da nota.
function extrairDetalheNota(
  ws: XLSX.WorkSheet,
  postosVigentes: PostoVigente[]
): { itens: ItemImportado[]; descricaoServico: string | null } & RetencoesExtraidas {
  const linhas: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: "" });
  const retencoes = extrairRetencoes(linhas);
  for (let i = 0; i < linhas.length - 1; i++) {
    const linha = (linhas[i] ?? []).map((c) => String(c ?? "").trim().toUpperCase());
    const colDesc = linha.indexOf("DESCRIÇÃO DOS SERVIÇOS");
    if (colDesc === -1) continue;

    // O template só vem com 6 slots de "Valor contrato exec. N" prontos —
    // quando uma nota precisa de mais (ex: Veranópolis com 7 unidades numa
    // nota só), o analista estende manualmente a coluna reaproveitando o
    // rótulo "Vlr bruto item N" (sem "- desc") na mesma linha de cabeçalho,
    // em vez de criar "Valor contrato exec. 7". Confirmado na planilha real
    // (VERANÓPOLIS 01.2021.xlsm, aba "NF 1 Limpeza Saúde", linha 28).
    const colsValor: number[] = [];
    linha.forEach((c, idx) => {
      if (c.startsWith("VALOR CONTRATO EXEC") || /^VLR BRUTO ITEM \d+$/.test(c)) colsValor.push(idx);
    });

    const proxima = linhas[i + 1] ?? [];
    const descricaoOriginal = String(proxima[colDesc] ?? "").trim();
    const descricaoUpper = descricaoOriginal.toUpperCase();

    const itensPopulados = colsValor
      .map((col) => Number(proxima[col]))
      .filter((v) => !isNaN(v) && v !== 0);

    if (itensPopulados.length === 0) {
      return { itens: [], descricaoServico: descricaoOriginal || null, ...retencoes };
    }

    // Tenta casar os postos vigentes citados no texto (na ordem em que
    // aparecem) com as colunas de valor populadas. Só atribui posto quando a
    // contagem bate exatamente — senão fica null pra não vincular errado.
    const postosNoTexto = postosVigentes
      .map((p) => ({ posto: p.posto, idx: descricaoUpper.indexOf(p.posto.toUpperCase()) }))
      .filter((p) => p.idx >= 0)
      .sort((a, b) => a.idx - b.idx);
    const postosParaZip = postosNoTexto.length === itensPopulados.length ? postosNoTexto.map((p) => p.posto) : null;

    const itens: ItemImportado[] = itensPopulados.map((valor, idx) => ({
      valor,
      posto: postosParaZip ? postosParaZip[idx] : null,
    }));

    return { itens, descricaoServico: descricaoOriginal || null, ...retencoes };
  }
  return { itens: [], descricaoServico: null, ...retencoes };
}
