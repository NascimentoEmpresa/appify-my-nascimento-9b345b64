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

export interface VariacaoImportada {
  variacao: string;
  valorReferencia: number | null;
  postoSugerido: string | null;
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

    let valorReferencia: number | null = null;
    let postoSugerido: string | null = null;
    let issqnPct: number | null = null;
    let irPct: number | null = null;
    let cofinsPct: number | null = null;
    let pisPct: number | null = null;
    let csllPct: number | null = null;

    const abaDetalhe = encontrarAbaDetalhe(wb.SheetNames, notaNome);
    if (abaDetalhe) {
      const detalhe = extrairDetalheNota(wb.Sheets[abaDetalhe], postosVigentes);
      valorReferencia = detalhe.valor;
      postoSugerido = detalhe.posto;
      issqnPct = detalhe.issqnPct;
      irPct = detalhe.irPct;
      cofinsPct = detalhe.cofinsPct;
      pisPct = detalhe.pisPct;
      csllPct = detalhe.csllPct;
    }

    resultado.push({ variacao, valorReferencia, postoSugerido, issqnPct, irPct, cofinsPct, pisPct, csllPct });
  }
  return resultado;
}

function encontrarAbaDetalhe(sheetNames: string[], notaNome: string): string | null {
  if (!notaNome) return null;
  const exato = sheetNames.find((n) => n.trim().toLowerCase() === notaNome.toLowerCase());
  if (exato) return exato;
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

function extrairDetalheNota(
  ws: XLSX.WorkSheet,
  postosVigentes: PostoVigente[]
): { valor: number | null; posto: string | null } & RetencoesExtraidas {
  const linhas: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: "" });
  const retencoes = extrairRetencoes(linhas);
  for (let i = 0; i < linhas.length - 1; i++) {
    const linha = (linhas[i] ?? []).map((c) => String(c ?? "").trim().toUpperCase());
    const colDesc = linha.indexOf("DESCRIÇÃO DOS SERVIÇOS");
    if (colDesc === -1) continue;
    const colValor = linha.findIndex((c) => (c ?? "").startsWith("VALOR CONTRATO EXEC"));
    const proxima = linhas[i + 1] ?? [];
    const descricao = String(proxima[colDesc] ?? "").toUpperCase();
    const valorBruto = colValor >= 0 ? Number(proxima[colValor]) : NaN;
    const posto = postosVigentes.find((p) => descricao.includes(p.posto.toUpperCase()))?.posto ?? null;
    return { valor: !isNaN(valorBruto) ? valorBruto : null, posto, ...retencoes };
  }
  return { valor: null, posto: null, ...retencoes };
}
