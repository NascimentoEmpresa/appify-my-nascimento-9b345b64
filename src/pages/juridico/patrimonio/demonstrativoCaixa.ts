// Jurídico / Patrimônio — importação do DEMONSTRATIVO DA CAIXA em PDF
// (SIS-2026-0939, 18/11/2026 — Parte 2 do SIS-2026-0909).
//
// PEDIDO (Fernanda Maldaner, Diretoria Administrativa): a CASA SENILTON tem
// 420 parcelas no "Documento Descritivo do Crédito" da CAIXA (habitação).
// Cadastrar parcela por parcela não é viável: o sistema lê o PDF e preenche
// tudo — número, vencimento, pagamento, composição, saldo e índice — mais os
// dados gerais do contrato; os eventos entre parcelas (inclusão, moratória,
// incorporação, mudança de vencimento) vão para o HISTÓRICO, sem virar parcela.
//
// CUIDADOS que esta camada garante (sem React, testada em
// src/test/patrimonio-demonstrativo-caixa.test.ts):
//   • casa pelo CONTRATO + NÚMERO da parcela: nunca duplica. Parcela que já
//     existe é atualizada; a que não existe é criada.
//   • campo vazio no cadastro é COMPLEMENTADO sem perguntar; campo preenchido
//     e DIFERENTE do PDF é DIVERGÊNCIA e só é trocado se o usuário aceitar
//     (por campo ou por parcela). Sem decisão, fica o valor atual.
//   • pagamentos registrados, comprovantes, demonstrativos anexados,
//     lançamento vinculado e situação da planilha NÃO são tocados — o plano
//     nem tem essas colunas.
//   • parcela paga (tem data de pagamento) × vencida em aberto × FUTURA
//     (vencimento depois da data de referência do documento): a futura entra
//     como PROJETADA — valor previsto, sujeito a atualização.
//   • nada de Contas / Malote / baixa: o plano só escreve em
//     JUR_PATRIMONIO_PARCELAS, JUR_PATRIMONIO_FINANCIAMENTOS e no histórico.
//
// LAYOUT (conferido no demonstrativo real de 27/10/2026, 15 páginas): o texto
// do PDF sai uma linha por posição vertical (ver lerPdfTexto.ts). Linha de
// parcela = Nº, vencimento, pagamento (00/00/000 quando não pago) e 16
// valores, nesta ordem:
//   Amortização · Juros · MPI · DFI · Seguros/FGHAB · Taxas · Valor FCVS ·
//   FGTS utilizado · Encargo líquido · Valores da impontualidade ·
//   Valor devido · Valor pago · Diferença de valor · Atualização monetária ·
//   Saldo devedor · Índice de correção (fator, ou 0 quando não houve)
// Linha de evento = data, descrição, "00/00/000" e os valores; quando tem,
// "Valor do evento:" e "Saldo após:".

import { numeroOuNulo, componentesDaParcela, type ParcelaFinanciamento } from "./financiamento";

// ── Tipos ────────────────────────────────────────────────────────────────

export interface ContratoCaixa {
  numero_contrato: string | null;
  credor: string | null;
  agencia: string | null;
  devedor: string | null;
  data_referencia: string | null;
  data_emissao: string | null;
  produto: string | null;
  sistema_amortizacao: string | null;
  /** Como veio no documento ("SAC-SISTEMA DE AMORTIZACAO CONSTANTE NOVO"). */
  sistema_amortizacao_documento: string | null;
  taxa_juros_nominal_aa: number | null;
  taxa_juros_efetiva_aa: number | null;
  cet_aa: number | null;
  prazo_meses: number | null;
  prazo_remanescente_meses: number | null;
  data_ultima_parcela: string | null;
  saldo_perda_renda_fghab: number | null;
  indexador: string | null;
  funding: string | null;
  cotas_fgts_contratadas: number | null;
  parcelas_fgts_remanescentes: number | null;
  fgts_nao_utilizado: number | null;
  percentual_fgts_utilizado: number | null;
}

export type ClasseParcela = "paga" | "vencida" | "futura";

export interface ParcelaCaixa {
  numero: number;
  vencimento: string;
  data_pagamento: string | null;
  amortizacao: number;
  juros: number;
  seguro_mip: number;
  seguro_dfi: number;
  seguros_fghab: number;
  taxas: number;
  valor_fcvs: number;
  fgts_utilizado: number;
  encargo_liquido: number;
  valor_impontualidade: number;
  valor: number;            // Valor devido
  valor_pago: number;
  diferenca_valor: number;
  atualizacao_monetaria: number;
  saldo_devedor: number;
  /** Fator (1,00146421). O documento escreve 0 quando não houve correção → null. */
  indice_correcao: number | null;
  classe: ClasseParcela;
  /** Linha do texto (1-based), para aviso. */
  linha: number;
}

export interface EventoCaixa {
  data: string;
  descricao: string;
  valor_evento: number | null;
  saldo_apos: number | null;
  /** "Taxa de juros reduzida" (4 casas), quando o documento traz. */
  taxa_juros_reduzida: number | null;
  linha: number;
}

export interface DemonstrativoCaixa {
  contrato: ContratoCaixa;
  parcelas: ParcelaCaixa[];
  eventos: EventoCaixa[];
  avisos: string[];
}

// ── Leitura ──────────────────────────────────────────────────────────────

const DATA = String.raw`\d{2}\/\d{2}\/\d{4}`;
const NUM = String.raw`-?\d{1,3}(?:\.\d{3})*,\d+|-?\d+`;

/** dd/mm/aaaa → aaaa-mm-dd; "00/00/000" e afins → null. */
export function dataCaixa(s: string | null | undefined): string | null {
  const m = String(s ?? "").trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m || m[1] === "00" || m[2] === "00" || Number(m[3]) < 1900) return null;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

const pegar = (texto: string, re: RegExp) => { const m = texto.match(re); return m ? m[1].trim() : null; };
const num = (s: string | null) => (s == null ? null : numeroOuNulo(s));
const inteiro = (s: string | null) => { const n = num(s); return n == null ? null : Math.trunc(n); };

/** "SAC-SISTEMA DE AMORTIZACAO…" → "SAC"; PRICE/SACRE idem; o resto como veio. */
export function sistemaCurto(s: string | null): string | null {
  if (!s) return null;
  const k = s.toUpperCase();
  if (/^SACRE\b|\bSACRE\b/.test(k)) return "SACRE";
  if (/^SAC\b|AMORTIZACAO CONSTANTE/.test(k)) return "SAC";
  if (/PRICE|FRANCES/.test(k)) return "PRICE";
  return s.trim();
}

function lerContrato(texto: string): ContratoCaixa {
  // Cabeçalho lido no texto TODO (não linha a linha): em outro demonstrativo
  // o pdf.js pode quebrar as linhas em outro ponto.
  const t = texto.replace(/[ \t]+/g, " ");
  const sistemaDoc = pegar(t, /Sistema de Amortiza[çc][ãa]o:\s*(.+?)\s+Taxa de Juros/i);
  const fgts = t.match(/Percentual utilizado \(%\)\s*\n?\s*(\d+)\s+(\d+)\s+(-?[\d.]+,\d+)\s+(-?[\d.]+,\d+)/i);
  const devedor = t.match(/Devedor\s+CPF\s*\n\s*(.+?)\s+\d{3}\.\d{3}\.\d{3}-\d{2}/i);
  return {
    numero_contrato: pegar(t, /Contrato:\s*([\d.\-/]+\d)/i)?.replace(/\D/g, "") ?? null,
    credor: /CAIXA ECON[OÔ]MICA FEDERAL/i.test(t) ? "CAIXA" : null,
    agencia: pegar(t, /Ag[êe]ncia de Origem:\s*(.+?)(?:\s+pag\.|\s+Data de Refer|\n)/i),
    devedor: devedor ? devedor[1].trim() : null,
    data_referencia: dataCaixa(pegar(t, new RegExp(String.raw`Data de Refer[êe]ncia:\s*(${DATA})`, "i"))),
    data_emissao: dataCaixa(pegar(t, new RegExp(String.raw`Data de Emiss[ãa]o:\s*(${DATA})`, "i"))),
    produto: pegar(t, /Produto:\s*(.+?)\s+Taxa de Juros/i),
    sistema_amortizacao: sistemaCurto(sistemaDoc),
    sistema_amortizacao_documento: sistemaDoc,
    taxa_juros_nominal_aa: num(pegar(t, /Taxa de Juros Anual Nominal:\s*([\d.,]+)/i)),
    taxa_juros_efetiva_aa: num(pegar(t, /Taxa de Juros Anual Efetiva:\s*([\d.,]+)/i)),
    cet_aa: num(pegar(t, /Custo Efetivo Total \(CET\):\s*\*?\s*([\d.,]+)/i)),
    prazo_meses: inteiro(pegar(t, /Prazo de Amortiza[çc][ãa]o Contratado:\s*(\d+)/i)),
    prazo_remanescente_meses: inteiro(pegar(t, /Prazo de Amortiza[çc][ãa]o Remanescente:\s*(\d+)/i)),
    data_ultima_parcela: dataCaixa(pegar(t, new RegExp(String.raw`[úu]ltima parcela do contrato:\s*(${DATA})`, "i"))),
    saldo_perda_renda_fghab: num(pegar(t, /Saldo Devedor Perda Renda FGHAB:\s*(-?[\d.]+,\d+)/i)),
    indexador: pegar(t, /Indexador:\s*(\S+)/i),
    funding: pegar(t, /Funding:\s*(.+?)\s*(?:\n|$)/i),
    cotas_fgts_contratadas: fgts ? inteiro(fgts[1]) : null,
    parcelas_fgts_remanescentes: fgts ? inteiro(fgts[2]) : null,
    fgts_nao_utilizado: fgts ? num(fgts[3]) : null,
    percentual_fgts_utilizado: fgts ? num(fgts[4]) : null,
  };
}

const RE_PARCELA = new RegExp(String.raw`^(\d{1,4})\s+(${DATA})\s+(\d{2}\/\d{2}\/\d{3,4})\s+(.+)$`);
const RE_EVENTO = new RegExp(String.raw`^(${DATA})\s+(.+?)\s+00\/00\/0{3,4}\s+(.*)$`);
const RE_NUM_TOKEN = new RegExp(String.raw`^(?:${NUM})$`);

/**
 * Lê o texto extraído do PDF. Não grava nada; o que não reconhece vira aviso,
 * nunca valor inventado.
 */
export function lerDemonstrativoCaixa(texto: string): DemonstrativoCaixa {
  const contrato = lerContrato(texto);
  const avisos: string[] = [];
  const parcelas: ParcelaCaixa[] = [];
  const eventos: EventoCaixa[] = [];
  const ref = contrato.data_referencia ?? contrato.data_emissao;
  if (!/Dados da Evolu[çc][ãa]o/i.test(texto) || !contrato.numero_contrato) {
    avisos.push("O arquivo não parece um demonstrativo da CAIXA (sem \"Dados da Evolução\" ou sem número do contrato).");
  }
  if (!ref) avisos.push("Data de referência não encontrada: parcelas sem pagamento não puderam ser separadas em vencidas e futuras.");

  const linhas = texto.replace(/\r/g, "").split("\n");
  const vistos = new Set<number>();
  linhas.forEach((bruta, i) => {
    const l = bruta.trim().replace(/\s+/g, " ");
    if (!l) return;
    const mp = l.match(RE_PARCELA);
    if (mp) {
      const toks = mp[4].split(" ");
      if (toks.length !== 16 || !toks.every(t => RE_NUM_TOKEN.test(t))) {
        avisos.push(`Linha ${i + 1}: parcela ${mp[1]} com ${toks.length} valores (esperado 16) — não importada.`);
        return;
      }
      const v = toks.map(t => numeroOuNulo(t) as number);
      const numero = Number(mp[1]);
      const vencimento = dataCaixa(mp[2]);
      if (!vencimento) { avisos.push(`Linha ${i + 1}: parcela ${numero} com vencimento inválido.`); return; }
      if (vistos.has(numero)) { avisos.push(`Parcela ${numero} aparece mais de uma vez no documento — vale a primeira.`); return; }
      vistos.add(numero);
      const data_pagamento = dataCaixa(mp[3]);
      const classe: ClasseParcela = data_pagamento ? "paga" : ref && vencimento > ref ? "futura" : "vencida";
      parcelas.push({
        numero, vencimento, data_pagamento,
        amortizacao: v[0], juros: v[1], seguro_mip: v[2], seguro_dfi: v[3], seguros_fghab: v[4], taxas: v[5],
        valor_fcvs: v[6], fgts_utilizado: v[7], encargo_liquido: v[8], valor_impontualidade: v[9],
        valor: v[10], valor_pago: v[11], diferenca_valor: v[12], atualizacao_monetaria: v[13], saldo_devedor: v[14],
        indice_correcao: v[15] ? v[15] : null,
        classe, linha: i + 1,
      });
      return;
    }
    const me = l.match(RE_EVENTO);
    if (me) {
      const resto = me[3];
      // "Valor do evento:" fica na coluna da Diferença; o 1º número depois do
      // rótulo é a própria Diferença (0,00) e o 2º, o valor do evento.
      const depoisValor = resto.split(/Valor do evento:/i)[1];
      const numsValor = depoisValor ? depoisValor.split(/Saldo ap[óo]s:/i)[0].trim().split(" ").filter(t => RE_NUM_TOKEN.test(t)) : [];
      const depoisSaldo = resto.split(/Saldo ap[óo]s:/i)[1];
      const saldo = depoisSaldo ? depoisSaldo.trim().split(" ").find(t => RE_NUM_TOKEN.test(t)) ?? null : null;
      const taxa = resto.split(" ").find(t => /^-?\d+,\d{4}$/.test(t)) ?? null;
      eventos.push({
        data: dataCaixa(me[1])!,
        descricao: me[2].trim(),
        valor_evento: numsValor.length >= 2 ? numeroOuNulo(numsValor[1]) : numsValor.length === 1 ? numeroOuNulo(numsValor[0]) : null,
        saldo_apos: saldo ? numeroOuNulo(saldo) : null,
        taxa_juros_reduzida: taxa ? numeroOuNulo(taxa) : null,
        linha: i + 1,
      });
    }
  });

  parcelas.sort((a, b) => a.numero - b.numero);
  if (contrato.prazo_meses && parcelas.length && parcelas.length !== contrato.prazo_meses) {
    avisos.push(`O documento informa prazo de ${contrato.prazo_meses} meses e foram lidas ${parcelas.length} parcelas.`);
  }
  // Buracos na numeração = linha que o PDF não entregou inteira.
  const faltando: number[] = [];
  for (let n = 1, max = parcelas.length ? parcelas[parcelas.length - 1].numero : 0; n <= max; n++) if (!vistos.has(n)) faltando.push(n);
  if (faltando.length) avisos.push(`Parcelas não lidas no documento: ${faltando.slice(0, 20).join(", ")}${faltando.length > 20 ? "…" : ""}.`);
  return { contrato, parcelas, eventos, avisos };
}

// ── Casamento com o cadastro ─────────────────────────────────────────────

/** Campos da parcela que o demonstrativo preenche, na ordem da prévia. */
export const CAMPOS_PARCELA_CAIXA = [
  "vencimento", "data_pagamento", "amortizacao", "juros", "seguro_mip", "seguro_dfi", "seguros_fghab", "taxas",
  "valor_fcvs", "fgts_utilizado", "encargo_liquido", "valor_impontualidade", "valor", "valor_pago",
  "diferenca_valor", "atualizacao_monetaria", "saldo_devedor", "indice_correcao",
] as const;
export type CampoParcelaCaixa = typeof CAMPOS_PARCELA_CAIXA[number];

export const ROTULO_CAMPO_CAIXA: Record<CampoParcelaCaixa, string> = {
  vencimento: "Vencimento", data_pagamento: "Data do pagamento", amortizacao: "Amortização", juros: "Juros",
  seguro_mip: "MPI", seguro_dfi: "DFI", seguros_fghab: "Seguros / FGHAB", taxas: "Taxas", valor_fcvs: "Valor FCVS",
  fgts_utilizado: "FGTS utilizado", encargo_liquido: "Encargo líquido", valor_impontualidade: "Valores da impontualidade",
  valor: "Valor devido", valor_pago: "Valor pago", diferenca_valor: "Diferença de valor",
  atualizacao_monetaria: "Atualização monetária", saldo_devedor: "Saldo devedor", indice_correcao: "Índice de correção",
};

const DATAS = new Set<string>(["vencimento", "data_pagamento"]);

/**
 * O que o demonstrativo diz de cada campo. Parcela não paga (vencida ou
 * futura) não tem valor pago nem data: o "0,00" do documento é "ainda não
 * pago", não um pagamento de zero — gravar 0 apagaria a leitura de PAGA de
 * quem registrou pagamento à parte. Pela mesma razão a "Diferença" de quem
 * não pagou (o documento repete o devido) não vai para conciliação.
 */
export function valoresDaParcelaCaixa(p: ParcelaCaixa): Record<CampoParcelaCaixa, string | number | null> {
  const pago = p.classe === "paga";
  return {
    vencimento: p.vencimento, data_pagamento: p.data_pagamento,
    amortizacao: p.amortizacao, juros: p.juros, seguro_mip: p.seguro_mip, seguro_dfi: p.seguro_dfi,
    seguros_fghab: p.seguros_fghab, taxas: p.taxas, valor_fcvs: p.valor_fcvs, fgts_utilizado: p.fgts_utilizado,
    encargo_liquido: p.encargo_liquido, valor_impontualidade: p.valor_impontualidade, valor: p.valor,
    valor_pago: pago ? p.valor_pago : null,
    diferenca_valor: pago ? p.diferenca_valor : null,
    atualizacao_monetaria: p.atualizacao_monetaria, saldo_devedor: p.saldo_devedor, indice_correcao: p.indice_correcao,
  };
}

/** Valor atual de um campo no cadastro: coluna estruturada; senão o que a aba lê de `detalhes`. */
function valorAtual(e: ParcelaFinanciamento, campo: CampoParcelaCaixa): { visto: string | number | null; coluna: string | number | null } {
  if (DATAS.has(campo)) {
    const v = (e as unknown as Record<string, unknown>)[campo];
    const s = v ? String(v).slice(0, 10) : null;
    return { visto: s, coluna: s };
  }
  const coluna = numeroOuNulo((e as unknown as Record<string, unknown>)[campo]);
  if (campo === "valor" || campo === "valor_pago") return { visto: coluna, coluna };
  const comp = componentesDaParcela(e) as unknown as Record<string, number | null>;
  return { visto: coluna ?? comp[campo] ?? null, coluna };
}

const iguais = (a: string | number | null, b: string | number | null, campo: string) => {
  if (a == null || b == null) return a == null && b == null;
  if (DATAS.has(campo)) return String(a) === String(b);
  const tol = campo === "indice_correcao" ? 5e-9 : 0.005;
  return Math.abs(Number(a) - Number(b)) < tol;
};

export type TipoCampo = "novo" | "igual" | "divergente";
export interface CampoComparado {
  campo: CampoParcelaCaixa;
  atual: string | number | null;
  novo: string | number | null;
  tipo: TipoCampo;
  /** A coluna está vazia (valor visto veio da planilha): gravar não muda nada na tela. */
  colunaVazia: boolean;
}

export type StatusParcela = "nova" | "igual" | "complementa" | "divergente";
export interface ParcelaComparada {
  numero: number;
  doc: ParcelaCaixa;
  existente: ParcelaFinanciamento | null;
  campos: CampoComparado[];
  status: StatusParcela;
}

export interface PlanoDemonstrativo {
  parcelas: ParcelaComparada[];
  /** Parcelas do cadastro deste contrato que o PDF não traz — ficam como estão. */
  foraDoDocumento: ParcelaFinanciamento[];
  /** Números repetidos no cadastro (casou com a primeira; as outras não são tocadas). */
  repetidasNoCadastro: number[];
  contagem: { novas: number; iguais: number; complementa: number; divergentes: number; camposDivergentes: number; pagas: number; vencidas: number; futuras: number };
}

/**
 * Parcelas do cadastro que pertencem ao contrato de destino: as ligadas a
 * ele e, se ele é o primeiro/único do imóvel, as sem contrato (importadas
 * antes do SIS-2026-0909) — a mesma régua da aba (doContrato).
 */
export function parcelasDoContrato<P extends ParcelaFinanciamento>(todas: P[], financiamentoId: number | null, ehPrimeiro: boolean): P[] {
  if (financiamentoId == null) return todas.filter(p => p.financiamento_id == null);
  return todas.filter(p => p.financiamento_id != null ? Number(p.financiamento_id) === financiamentoId : ehPrimeiro);
}

export function planejarDemonstrativo(demo: DemonstrativoCaixa, existentes: ParcelaFinanciamento[]): PlanoDemonstrativo {
  const porNumero = new Map<number, ParcelaFinanciamento>();
  const repetidas = new Set<number>();
  // Ordem estável: a de menor id ganha (a mais antiga).
  for (const e of [...existentes].sort((a, b) => Number(a.id) - Number(b.id))) {
    if (e.numero == null) continue;
    const n = Number(e.numero);
    if (porNumero.has(n)) repetidas.add(n); else porNumero.set(n, e);
  }
  const numerosDoc = new Set(demo.parcelas.map(p => p.numero));
  const c = { novas: 0, iguais: 0, complementa: 0, divergentes: 0, camposDivergentes: 0, pagas: 0, vencidas: 0, futuras: 0 };
  const parcelas = demo.parcelas.map((doc): ParcelaComparada => {
    c[doc.classe === "paga" ? "pagas" : doc.classe === "vencida" ? "vencidas" : "futuras"]++;
    const existente = porNumero.get(doc.numero) ?? null;
    const novos = valoresDaParcelaCaixa(doc);
    const campos = CAMPOS_PARCELA_CAIXA.map((campo): CampoComparado => {
      const novo = novos[campo];
      if (!existente) return { campo, atual: null, novo, tipo: "novo", colunaVazia: true };
      const { visto, coluna } = valorAtual(existente, campo);
      const tipo: TipoCampo = novo == null ? "igual" : visto == null ? "novo" : iguais(visto, novo, campo) ? "igual" : "divergente";
      return { campo, atual: visto, novo, tipo, colunaVazia: coluna == null };
    });
    let status: StatusParcela;
    if (!existente) status = "nova";
    else if (campos.some(x => x.tipo === "divergente")) status = "divergente";
    else if (campos.some(x => x.tipo === "novo")) status = "complementa";
    else status = "igual";
    c[status === "nova" ? "novas" : status === "igual" ? "iguais" : status === "complementa" ? "complementa" : "divergentes"]++;
    c.camposDivergentes += campos.filter(x => x.tipo === "divergente").length;
    return { numero: doc.numero, doc, existente, campos, status };
  });
  const foraDoDocumento = existentes.filter(e => e.numero == null || !numerosDoc.has(Number(e.numero)));
  return { parcelas, foraDoDocumento, repetidasNoCadastro: [...repetidas].sort((a, b) => a - b), contagem: c };
}

// ── Decisões e gravação ──────────────────────────────────────────────────

/** Chave de uma divergência aceita: "83:juros". */
export const chaveDecisao = (numero: number, campo: string) => `${numero}:${campo}`;

/** Todas as divergências de uma parcela (ou do plano todo) como chaves. */
export function chavesDivergentes(parcelas: ParcelaComparada[]): string[] {
  return parcelas.flatMap(p => p.campos.filter(x => x.tipo === "divergente").map(x => chaveDecisao(p.numero, x.campo)));
}

export interface OpcoesGravacao {
  patrimonioId: number;
  financiamentoId: number;
  autor: string;
  documentoData: string | null;
  /** Próxima `ordem` livre no imóvel (as novas entram depois das que existem). */
  ordemInicial: number;
}

export interface GravacaoParcelas {
  inserir: Record<string, unknown>[];
  /**
   * Linhas COMPLETAS para um único upsert por id (uma requisição, uma
   * transação). Campo não aceito leva o valor que já está na coluna — o
   * upsert regrava o mesmo valor, não apaga nada.
   */
  atualizar: Record<string, unknown>[];
  /** Quantos campos de fato mudam. */
  camposGravados: number;
}

/** Colunas que o upsert envia (todas as linhas com as mesmas chaves, exigência do PostgREST). */
const COLUNAS_UPSERT = [
  "id", "patrimonio_id", "financiamento_id", ...CAMPOS_PARCELA_CAIXA, "indice_tipo", "projetado",
  "seguros_fghab_subtotal", "encargos_inclusos", "documento_origem", "documento_data", "atualizado_por",
] as const;

export const DOCUMENTO_ORIGEM = "Demonstrativo CAIXA";

/** "Seguros / FGHAB" é o subtotal de MPI + DFI quando bate com a soma (padrão da CAIXA). */
const ehSubtotal = (d: ParcelaCaixa) => Math.abs(d.seguro_mip + d.seguro_dfi - d.seguros_fghab) < 0.015;

export function montarGravacao(plano: PlanoDemonstrativo, aceitas: Set<string>, o: OpcoesGravacao): GravacaoParcelas {
  const inserir: Record<string, unknown>[] = [];
  const atualizar: Record<string, unknown>[] = [];
  let camposGravados = 0;
  let ordem = o.ordemInicial;
  for (const p of plano.parcelas) {
    const d = p.doc;
    const marcas = {
      indice_tipo: d.indice_correcao != null ? "fator" : null,
      // Futura = prevista, sujeita a atualização pela CAIXA.
      projetado: d.classe === "futura",
      seguros_fghab_subtotal: ehSubtotal(d),
      encargos_inclusos: true,
      documento_origem: DOCUMENTO_ORIGEM,
      documento_data: o.documentoData,
      atualizado_por: o.autor,
    };
    if (!p.existente) {
      const linha: Record<string, unknown> = {
        patrimonio_id: o.patrimonioId, financiamento_id: o.financiamentoId, numero: d.numero, ordem: ++ordem,
        origem: `${DOCUMENTO_ORIGEM} (PDF)`, ...valoresDaParcelaCaixa(d), ...marcas,
      };
      inserir.push(linha);
      camposGravados += p.campos.filter(x => x.novo != null).length;
      continue;
    }
    const e = p.existente as unknown as Record<string, unknown>;
    const linha: Record<string, unknown> = { id: e.id, patrimonio_id: o.patrimonioId, financiamento_id: o.financiamentoId };
    for (const x of p.campos) {
      const atualColuna = DATAS.has(x.campo) ? (e[x.campo] ? String(e[x.campo]).slice(0, 10) : null) : numeroOuNulo(e[x.campo]);
      const grava = x.novo != null && (x.tipo === "novo" || (x.tipo === "igual" && x.colunaVazia) || (x.tipo === "divergente" && aceitas.has(chaveDecisao(p.numero, x.campo))));
      linha[x.campo] = grava ? x.novo : atualColuna;
      if (grava && x.tipo !== "igual") camposGravados++;
    }
    // O índice só é marcado como fator se o índice do documento foi gravado.
    const indiceGravado = linha.indice_correcao != null && linha.indice_correcao === d.indice_correcao;
    Object.assign(linha, marcas, { indice_tipo: indiceGravado ? marcas.indice_tipo : (e.indice_tipo ?? null) });
    atualizar.push(Object.fromEntries(COLUNAS_UPSERT.map(k => [k, linha[k] ?? null])));
  }
  return { inserir, atualizar, camposGravados };
}

// ── Contrato (condições do financiamento) ────────────────────────────────

export interface FinanciamentoCadastro {
  id: number;
  nome?: string | null;
  observacoes?: string | null;
  [k: string]: unknown;
}

/** Nº do contrato achado no nome ou nas observações do financiamento cadastrado. */
export function contratoDoCadastro(f: FinanciamentoCadastro): string | null {
  const m = `${f.nome ?? ""} ${f.observacoes ?? ""}`.match(/\d{10,}/);
  return m ? m[0] : null;
}

/**
 * Qual financiamento do imóvel recebe o demonstrativo: o que já tem o mesmo
 * nº de contrato; senão o único cadastrado sem número; senão nenhum (criar).
 */
export function financiamentoDestino(fins: FinanciamentoCadastro[], numeroContrato: string | null): FinanciamentoCadastro | null {
  if (numeroContrato) {
    const mesmo = fins.find(f => contratoDoCadastro(f) === numeroContrato);
    if (mesmo) return mesmo;
  }
  const semNumero = fins.filter(f => !contratoDoCadastro(f));
  if (fins.length === 1 && semNumero.length === 1) return semNumero[0];
  return null;
}

const MARCA_INI = "[Demonstrativo CAIXA]";
const MARCA_FIM = "[/Demonstrativo CAIXA]";
const fmtData = (s: string | null) => (s ? s.split("-").reverse().join("/") : "—");

/**
 * Bloco de observações com o que o demonstrativo traz e o cadastro não tem
 * coluna (agência, prazo remanescente, última parcela, funding…). Reimportar
 * TROCA o bloco, não empilha; o resto das observações fica.
 */
export function observacoesComDemonstrativo(atual: string | null | undefined, c: ContratoCaixa): string {
  const linhas = [
    MARCA_INI,
    `Contrato ${c.numero_contrato ?? "—"} · referência ${fmtData(c.data_referencia)}${c.data_emissao ? ` · emitido em ${fmtData(c.data_emissao)}` : ""}`,
    c.devedor ? `Devedor: ${c.devedor}` : null,
    c.agencia ? `Agência de origem: ${c.agencia}` : null,
    c.sistema_amortizacao_documento ? `Sistema: ${c.sistema_amortizacao_documento}` : null,
    c.prazo_remanescente_meses != null ? `Prazo remanescente: ${c.prazo_remanescente_meses} meses` : null,
    c.data_ultima_parcela ? `Vencimento da última parcela: ${fmtData(c.data_ultima_parcela)}` : null,
    MARCA_FIM,
  ].filter(Boolean).join("\n");
  const base = String(atual ?? "");
  const ini = base.indexOf(MARCA_INI), fim = base.indexOf(MARCA_FIM);
  const sem = ini >= 0 && fim > ini ? (base.slice(0, ini) + base.slice(fim + MARCA_FIM.length)).trim() : base.trim();
  return sem ? `${sem}\n\n${linhas}` : linhas;
}

/** As linhas do bloco do demonstrativo nas observações (para a aba mostrar). */
export function linhasDoDemonstrativo(observacoes: string | null | undefined): string[] {
  const o = String(observacoes ?? "");
  const ini = o.indexOf(MARCA_INI), fim = o.indexOf(MARCA_FIM);
  if (ini < 0 || fim <= ini) return [];
  return o.slice(ini + MARCA_INI.length, fim).split(/\r?\n/).map(l => l.trim()).filter(Boolean);
}

/** Campos do financiamento que o demonstrativo preenche, com rótulo. */
export const CAMPOS_CONTRATO_CAIXA: Array<[string, string]> = [
  ["nome", "Nome do contrato"], ["credor", "Credor"], ["sistema_amortizacao", "Sistema de amortização"],
  ["indexador", "Indexador"], ["prazo_meses", "Prazo contratado (meses)"],
  ["taxa_juros_nominal_aa", "Juros anuais nominais (%)"], ["taxa_juros_efetiva_aa", "Juros anuais efetivos (%)"],
  ["cet_aa", "CET (%)"], ["data_referencia", "Data de referência"], ["saldo_perda_renda_fghab", "Saldo perda de renda FGHAB"],
  ["cotas_fgts_contratadas", "Cotas FGTS contratadas"], ["parcelas_fgts_remanescentes", "Parcelas FGTS remanescentes"],
  ["fgts_nao_utilizado", "FGTS não utilizado"], ["percentual_fgts_utilizado", "Percentual FGTS utilizado"],
  ["produto_fonte_recursos", "Produto / fonte de recursos"], ["documento_origem", "Documento de origem"],
  ["documento_data", "Data do documento"],
];

export function valoresDoContrato(c: ContratoCaixa): Record<string, string | number | null> {
  return {
    nome: c.numero_contrato ? `Contrato ${c.credor ?? "CAIXA"} ${c.numero_contrato}` : null,
    credor: c.credor, sistema_amortizacao: c.sistema_amortizacao, indexador: c.indexador, prazo_meses: c.prazo_meses,
    taxa_juros_nominal_aa: c.taxa_juros_nominal_aa, taxa_juros_efetiva_aa: c.taxa_juros_efetiva_aa, cet_aa: c.cet_aa,
    data_referencia: c.data_referencia, saldo_perda_renda_fghab: c.saldo_perda_renda_fghab,
    cotas_fgts_contratadas: c.cotas_fgts_contratadas, parcelas_fgts_remanescentes: c.parcelas_fgts_remanescentes,
    fgts_nao_utilizado: c.fgts_nao_utilizado, percentual_fgts_utilizado: c.percentual_fgts_utilizado,
    produto_fonte_recursos: [c.produto, c.funding].filter(Boolean).join(" / ") || null,
    documento_origem: DOCUMENTO_ORIGEM, documento_data: c.data_emissao ?? c.data_referencia,
  };
}

export interface CampoContrato { campo: string; rotulo: string; atual: string | number | null; novo: string | number | null; tipo: TipoCampo }

/** Compara as condições cadastradas com as do documento (mesma régua das parcelas). */
export function compararContrato(atual: FinanciamentoCadastro | null, c: ContratoCaixa): CampoContrato[] {
  const novos = valoresDoContrato(c);
  return CAMPOS_CONTRATO_CAIXA.map(([campo, rotulo]) => {
    const novo = novos[campo] ?? null;
    const brutoAtual = atual?.[campo];
    const ehTexto = typeof novo === "string" && !/^\d{4}-\d{2}-\d{2}$/.test(novo);
    const at = brutoAtual == null || brutoAtual === "" ? null
      : ehTexto || /data/.test(campo) ? String(brutoAtual).slice(0, /data/.test(campo) ? 10 : undefined) : numeroOuNulo(brutoAtual);
    let tipo: TipoCampo;
    if (novo == null) tipo = "igual";
    else if (at == null) tipo = "novo";
    else if (typeof novo === "number") tipo = Math.abs(Number(at) - novo) < 0.00005 ? "igual" : "divergente";
    else tipo = String(at).trim().toUpperCase() === novo.trim().toUpperCase() ? "igual" : "divergente";
    return { campo, rotulo, atual: at, novo, tipo };
  });
}

/** Payload do financiamento: novo e aceito entram; divergência recusada fica. */
export function payloadDoContrato(campos: CampoContrato[], aceitas: Set<string>, observacoesAtuais: string | null | undefined, c: ContratoCaixa, autor: string) {
  const out: Record<string, unknown> = { atualizado_por: autor, observacoes: observacoesComDemonstrativo(observacoesAtuais, c) };
  for (const x of campos) {
    if (x.novo == null) continue;
    if (x.tipo === "novo" || (x.tipo === "divergente" && aceitas.has(chaveDecisao(0, x.campo)))) out[x.campo] = x.novo;
  }
  return out;
}

// ── Eventos → histórico ──────────────────────────────────────────────────

export const TIPO_ITEM_EVENTO = "evento_financiamento";

/** Chave que impede o mesmo evento de entrar duas vezes no histórico. */
export const chaveEvento = (numeroContrato: string | null, ev: Pick<EventoCaixa, "data" | "descricao">) =>
  `${numeroContrato ?? "-"}|${ev.data}|${ev.descricao.toUpperCase().replace(/\s+/g, " ").trim()}`;

export interface ItemHistoricoEvento {
  patrimonio_id: number;
  kind: "historico";
  tipo: typeof TIPO_ITEM_EVENTO;
  acao: string;
  detalhe: string;
  autor: string;
  /** JSON com os dados do evento (financiamento, data, valores) e a chave. */
  observacao: string;
}

const moeda = (v: number | null) => (v == null ? null : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }));

/** Linhas de JUR_PATRIMONIO_ITENS (kind historico) para os eventos que ainda não estão lá. */
export function itensDeEventos(
  eventos: EventoCaixa[], jaGravadas: Set<string>,
  o: { patrimonioId: number; financiamentoId: number; numeroContrato: string | null; autor: string },
): ItemHistoricoEvento[] {
  const out: ItemHistoricoEvento[] = [];
  const nesta = new Set<string>();
  for (const ev of eventos) {
    const chave = chaveEvento(o.numeroContrato, ev);
    if (jaGravadas.has(chave) || nesta.has(chave)) continue;
    nesta.add(chave);
    out.push({
      patrimonio_id: o.patrimonioId, kind: "historico", tipo: TIPO_ITEM_EVENTO,
      acao: `Evento do contrato: ${ev.descricao}`,
      detalhe: [fmtData(ev.data), o.numeroContrato ? `contrato ${o.numeroContrato}` : null,
        ev.valor_evento ? `valor do evento ${moeda(ev.valor_evento)}` : null,
        ev.saldo_apos ? `saldo após ${moeda(ev.saldo_apos)}` : null, "demonstrativo CAIXA"].filter(Boolean).join(" · "),
      autor: o.autor,
      observacao: JSON.stringify({ chave, financiamento_id: o.financiamentoId, data: ev.data, descricao: ev.descricao, valor_evento: ev.valor_evento, saldo_apos: ev.saldo_apos, taxa_juros_reduzida: ev.taxa_juros_reduzida }),
    });
  }
  return out;
}

/** Lê a chave e os dados de um item de evento já gravado (observacao JSON). */
export function lerItemEvento(observacao: string | null | undefined): { chave: string; financiamento_id: number | null; data: string; descricao: string; valor_evento: number | null; saldo_apos: number | null } | null {
  try {
    const o = JSON.parse(String(observacao ?? ""));
    return o && typeof o.chave === "string" ? o : null;
  } catch { return null; }
}
