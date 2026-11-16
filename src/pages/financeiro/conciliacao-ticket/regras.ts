// SIS-2026-0825: regras puras da Conciliação da Ticket (testáveis, sem tela nem banco).
// O extrato da plataforma Ticket (CSV "Baixar extrato em CSV") é conferido, mês a mês, contra o que o ERP pagou com "TICKET" na descrição:
//   • aba Boletos pagos: "Pagamento de Boleto" (debitado) do extrato  ×  pagamentos do ERP;
//   • aba Créditos adicionados: "Tickets" (adicionado, um crédito por colaborador) do extrato  ×  pagamentos do ERP.
// Cada aba pode ser afinada por empresa e classificação do lado do ERP (o extrato da Ticket não diz de qual empresa/classificação é cada linha).

export type CategoriaExtrato = "boleto" | "credito" | "outro";

export interface LinhaExtratoCsv {
  data: string; // YYYY-MM-DD
  transacao: string;
  status: string; // minúsculo: "debitado" | "adicionado"
  valor: number; // com sinal, como no extrato
}

export interface ResultadoCsv {
  linhas: LinhaExtratoCsv[];
  /** Linhas que não deu para ler, com o número da linha no arquivo (1 = cabeçalho). */
  erros: { linha: number; texto: string; motivo: string }[];
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Valor no formato brasileiro do extrato: "-123.103,48", "2.038,73", "23,06", "4". O ponto é milhar, a vírgula é decimal.
 * Devolve null quando não é número.
 */
export function lerValorBR(texto: string): number | null {
  const t = texto.trim().replace(/^"|"$/g, "").replace(/\s/g, "");
  if (!t) return null;
  const neg = t.startsWith("-");
  const corpo = neg ? t.slice(1) : t.startsWith("+") ? t.slice(1) : t;
  let normal: string;
  if (corpo.includes(",")) normal = corpo.replace(/\./g, "").replace(",", ".");
  else if (/^\d{1,3}(\.\d{3})+$/.test(corpo)) normal = corpo.replace(/\./g, ""); // "1.234" sem vírgula = mil duzentos e trinta e quatro
  else normal = corpo;
  if (!/^\d+(\.\d+)?$/.test(normal)) return null;
  const n = Number(normal);
  return Number.isFinite(n) ? r2(neg ? -n : n) : null;
}

/** "23/10/2026" → "2026-10-23" (null se a data não existe). */
export function dataBRparaIso(texto: string): string | null {
  const m = texto.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  const [, d, mes, a] = m;
  const dt = new Date(Date.UTC(Number(a), Number(mes) - 1, Number(d)));
  if (dt.getUTCFullYear() !== Number(a) || dt.getUTCMonth() !== Number(mes) - 1 || dt.getUTCDate() !== Number(d)) return null;
  return `${a}-${mes}-${d}`;
}

/** Separa a linha por vírgula respeitando aspas ("..." pode ter vírgula dentro). */
function dividirLinha(linha: string): string[] {
  const campos: string[] = [];
  let atual = "";
  let aspas = false;
  for (let i = 0; i < linha.length; i++) {
    const c = linha[i];
    if (c === '"') { aspas = !aspas; continue; }
    if (c === "," && !aspas) { campos.push(atual); atual = ""; continue; }
    atual += c;
  }
  campos.push(atual);
  return campos;
}

/**
 * Lê o CSV da Ticket: `transação,data,status,valor`. O valor vem em formato BR SEM aspas ("-123.103,48"), então a vírgula do decimal
 * quebra a linha em 5 campos: tudo depois do 3º campo é o valor e volta a ser juntado.
 */
export function lerCsvTicket(texto: string): ResultadoCsv {
  const linhasTexto = texto.replace(/^\uFEFF/, "").split(/\r?\n/);
  const linhas: LinhaExtratoCsv[] = [];
  const erros: ResultadoCsv["erros"] = [];
  linhasTexto.forEach((bruta, idx) => {
    if (idx === 0 || !bruta.trim()) return; // cabeçalho e linhas em branco
    const campos = dividirLinha(bruta);
    const erro = (motivo: string) => erros.push({ linha: idx + 1, texto: bruta, motivo });
    if (campos.length < 4) return erro("Esperado: transação, data, status e valor.");
    const data = dataBRparaIso(campos[1]);
    if (!data) return erro("Data inválida (esperado dd/mm/aaaa).");
    const valor = lerValorBR(campos.slice(3).join(","));
    if (valor === null) return erro("Valor inválido.");
    const transacao = campos[0].trim();
    const status = campos[2].trim().toLowerCase();
    if (!transacao || !status) return erro("Transação ou status em branco.");
    linhas.push({ data, transacao, status, valor });
  });
  return { linhas, erros };
}

const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** boleto = "Pagamento de Boleto"; crédito = "Tickets" adicionado (o crédito por colaborador); o resto (ex.: "CREDIT") é outro. */
export function categoriaDoExtrato(l: Pick<LinhaExtratoCsv, "transacao" | "status">): CategoriaExtrato {
  const t = semAcento(l.transacao);
  if (t.includes("boleto")) return "boleto";
  if (t === "tickets" && l.status === "adicionado") return "credito";
  return "outro";
}

// ── Comparativo ───────────────────────────────────────────────────────────────────────────────────────────────────

export type Aba = "boletos" | "creditos";

export interface LinhaErp {
  despesa_id: string;
  origem: string;
  id_malote: string | null;
  numero_parcela: number | null;
  data_pagamento: string; // YYYY-MM-DD
  descricao: string;
  empresa_id: string | null;
  empresa_nome: string | null;
  classificacao_nome: string | null;
  valor: number;
}

export interface FiltroErp {
  /** vazio = todas as empresas */
  empresas: string[];
  /** vazio = todas as classificações */
  classificacoes: string[];
  /** texto que a descrição precisa conter; "" = qualquer */
  texto: string;
}
export const FILTRO_ERP_VAZIO: FiltroErp = { empresas: [], classificacoes: [], texto: "" };

export function filtrarErp(linhas: LinhaErp[], f: FiltroErp): LinhaErp[] {
  const texto = semAcento(f.texto).trim();
  return linhas.filter((l) => {
    if (f.empresas.length > 0 && !f.empresas.includes(l.empresa_nome ?? "")) return false;
    if (f.classificacoes.length > 0 && !f.classificacoes.includes(l.classificacao_nome ?? "")) return false;
    if (texto && !semAcento(l.descricao).includes(texto)) return false;
    return true;
  });
}

/** Linha do extrato que entra na aba: valor em módulo (boleto vem negativo; crédito, positivo). */
export interface ExtratoDaAba { data: string; transacao: string; valor: number }

export function extratoDaAba(linhas: LinhaExtratoCsv[], aba: Aba): ExtratoDaAba[] {
  const alvo: CategoriaExtrato = aba === "boletos" ? "boleto" : "credito";
  return linhas.filter((l) => categoriaDoExtrato(l) === alvo).map((l) => ({ data: l.data, transacao: l.transacao, valor: r2(Math.abs(l.valor)) }));
}

export type SituacaoMes = "confere" | "diferenca" | "so_extrato" | "so_erp";

export interface MesComparado {
  mes: string; // YYYY-MM
  extratoQtd: number;
  extratoTotal: number;
  erpQtd: number;
  erpTotal: number;
  /** ERP − extrato (positivo = o ERP pagou mais do que o extrato mostra). */
  diferenca: number;
  situacao: SituacaoMes;
}

// Diferença abaixo disso (centavos) conta como "confere".
export const TOLERANCIA_TICKET = 0.01;

export function compararPorMes(extrato: ExtratoDaAba[], erp: LinhaErp[]): MesComparado[] {
  const meses = new Map<string, MesComparado>();
  const mes = (m: string): MesComparado => {
    let x = meses.get(m);
    if (!x) { x = { mes: m, extratoQtd: 0, extratoTotal: 0, erpQtd: 0, erpTotal: 0, diferenca: 0, situacao: "confere" }; meses.set(m, x); }
    return x;
  };
  for (const e of extrato) { const x = mes(e.data.slice(0, 7)); x.extratoQtd += 1; x.extratoTotal += e.valor; }
  for (const l of erp) { const x = mes(l.data_pagamento.slice(0, 7)); x.erpQtd += 1; x.erpTotal += l.valor; }
  return [...meses.values()]
    .map((x) => {
      const extratoTotal = r2(x.extratoTotal), erpTotal = r2(x.erpTotal);
      const diferenca = r2(erpTotal - extratoTotal);
      const situacao: SituacaoMes = x.extratoQtd === 0 ? "so_erp" : x.erpQtd === 0 ? "so_extrato" : Math.abs(diferenca) < TOLERANCIA_TICKET ? "confere" : "diferenca";
      return { ...x, extratoTotal, erpTotal, diferenca, situacao };
    })
    .sort((a, b) => a.mes.localeCompare(b.mes));
}

export interface ResumoComparativo {
  extratoTotal: number;
  erpTotal: number;
  diferenca: number;
  mesesQueConferem: number;
  mesesComDiferenca: number;
}

export function resumirComparativo(meses: MesComparado[]): ResumoComparativo {
  const extratoTotal = r2(meses.reduce((s, m) => s + m.extratoTotal, 0));
  const erpTotal = r2(meses.reduce((s, m) => s + m.erpTotal, 0));
  return {
    extratoTotal, erpTotal, diferenca: r2(erpTotal - extratoTotal),
    mesesQueConferem: meses.filter((m) => m.situacao === "confere").length,
    mesesComDiferenca: meses.filter((m) => m.situacao !== "confere").length,
  };
}

export const ROTULO_SITUACAO: Record<SituacaoMes, string> = {
  confere: "Confere", diferenca: "Diferença", so_extrato: "Só no extrato", so_erp: "Só no ERP",
};

/** Resumo do que o extrato tem fora das duas abas (ex.: "CREDIT"), para ninguém achar que sumiu. */
export function resumoOutros(linhas: LinhaExtratoCsv[]): { qtd: number; total: number } {
  const outros = linhas.filter((l) => categoriaDoExtrato(l) === "outro");
  return { qtd: outros.length, total: r2(outros.reduce((s, l) => s + l.valor, 0)) };
}
