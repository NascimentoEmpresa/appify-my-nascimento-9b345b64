import * as XLSX from "xlsx";

/**
 * Extrator de Benefícios — a base de funcionários vai para o worker como um
 * .xlsx "limpo", regravado aqui no navegador (06/11/2026).
 *
 * POR QUÊ: o worker lê a base com ExcelJS, que só entende .xlsx e, mesmo
 * nele, não enxerga as abas de alguns arquivos gerados por outros sistemas
 * (relação de funcionários exportada direto do sistema da folha/do tomador).
 * Ele carregava o arquivo sem reclamar, `workbook.worksheets[0]` vinha vazio e
 * o job morria com "Cannot read properties of undefined (reading 'eachRow')" —
 * três vezes seguidas no PREF POA SMS em 21/09/2026. O campo da tela também
 * aceita .xls, que o ExcelJS não lê de jeito nenhum.
 *
 * O SheetJS (o mesmo do resto do front) lê .xls, .xlsx e variantes. Daqui sai
 * só a PRIMEIRA aba (é a única que o worker usa), só com VALORES: fórmula vira
 * o resultado (no ExcelJS uma célula de fórmula chega como objeto e vira
 * "[object Object]" no texto) e data continua data.
 */
export function regravarComoXlsx(conteudo: ArrayBuffer): ArrayBuffer {
  const wb = XLSX.read(conteudo, { type: "array", cellDates: false, cellNF: true });
  const nome = wb.SheetNames[0];
  const aba = nome ? wb.Sheets[nome] : undefined;
  if (!aba || !aba["!ref"]) throw new Error("A planilha da base não tem nenhuma aba com dados.");

  const faixa = XLSX.utils.decode_range(aba["!ref"]);
  const linhas: unknown[][] = [];
  for (let r = 0; r <= faixa.e.r; r++) {
    const linha: unknown[] = [];
    for (let c = 0; c <= faixa.e.c; c++) linha.push(valorDaCelula(aba[XLSX.utils.encode_cell({ r, c })]));
    linhas.push(linha);
  }
  if (!linhas.some((l) => l.some((v) => v != null && v !== ""))) {
    throw new Error(`A primeira aba da base ("${nome}") está vazia.`);
  }

  const novo = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(novo, XLSX.utils.aoa_to_sheet(linhas), "Base");
  return XLSX.write(novo, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
}

const pad2 = (n: number) => String(n).padStart(2, "0");

/**
 * Valor de uma célula para a planilha regravada. DATA sai como texto
 * "DD/MM/AAAA": o worker transforma toda célula em texto e só reconhece data
 * nesse formato (formatarData em worker/.../planilhas.js) — uma data de
 * verdade chegaria lá como "Thu Feb 01 2024 ..." e iria assim para a planilha
 * final. E a conta sai do número serial do Excel, sem fuso: passar por
 * Date no navegador desloca a data um dia para trás no fuso de São Paulo
 * (o SheetJS converte com o deslocamento histórico de 1900, -03:06).
 */
function valorDaCelula(cel: XLSX.CellObject | undefined): unknown {
  if (!cel || cel.v == null) return null;
  if (cel.t === "n" && typeof cel.v === "number" && cel.z != null && XLSX.SSF.is_date(cel.z)) {
    const d = XLSX.SSF.parse_date_code(cel.v);
    if (d) return `${pad2(d.d)}/${pad2(d.m)}/${d.y}`;
  }
  if (cel.t === "d" && cel.v instanceof Date) {
    const v = cel.v;
    return `${pad2(v.getDate())}/${pad2(v.getMonth() + 1)}/${v.getFullYear()}`;
  }
  return cel.v;
}

/** O File pronto para subir: mesmo nome, sempre com extensão .xlsx. */
export async function baseNormalizada(arquivo: File): Promise<File> {
  const saida = regravarComoXlsx(await arquivo.arrayBuffer());
  const nome = arquivo.name.replace(/\.[^.]+$/, "") + ".xlsx";
  return new File([saida], nome, { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}
