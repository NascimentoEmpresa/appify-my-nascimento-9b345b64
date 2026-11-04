// =====================================================================
// RH › Gestão de Férias — leitura do "Aviso e Recibo de Férias" da Senior
// (04/11/2026, pedido do Pablo: o RH anexa o arquivo gerado na Senior, o
// sistema puxa o valor sozinho e o RH confirma antes de ir para o Malote —
// "não pode puxar errado de forma alguma").
//
// O arquivo que o RH tem na mão é, na prática, o recibo ESCANEADO depois de
// assinado (o modelo de 19/01/2026 é "Scanner System": duas páginas só de
// imagem, nenhum texto). Então o texto vem de OCR (src/lib/rh/lerReciboFerias.ts)
// — e OCR erra número: no mesmo recibo o "Salário Base 3.371,30" saiu
// "3:37 1:30". Por isso o valor NUNCA é aceito por uma leitura só.
//
// O recibo da Senior escreve o líquido de quatro jeitos independentes:
//     Totais........: 749,17   56,18        (proventos − descontos)
//     Líquido.......: 692,99
//     Recebi a importância de R$ 692,99 (seiscentos e noventa e dois reais
//     e noventa e nove centavos) referente a quitação das férias.
// conferirValor só dá o valor como CONFIÁVEL quando o "Líquido" foi lido e
// pelo menos DUAS das outras três formas foram lidas e batem com ele — e
// nenhuma das lidas discorda. Qualquer divergência: o campo fica para o RH
// digitar olhando o PDF. E mesmo confiável, o RH confirma antes de gravar.
//
// conferirPessoa confere que o recibo é do colaborador da solicitação (CPF;
// sem CPF legível, matrícula + nome) e se o período bate com a saída.
// =====================================================================

export interface LeituraRecibo {
  /** "Líquido....: 692,99" */
  liquido: number | null;
  /** Todos os líquidos encontrados — mais de um distinto = mais de um recibo no arquivo. */
  liquidos: number[];
  /** "Recebi a importância de R$ 692,99" */
  importancia: number | null;
  /** O valor por extenso entre parênteses, convertido. */
  extenso: number | null;
  extensoTexto: string | null;
  /** Linha dos Totais: proventos e descontos. */
  proventos: number | null;
  descontos: number | null;
  /** "Cadastro: 000000100 - NOME" → "100" (sem zeros à esquerda). */
  cadastro: string | null;
  nome: string | null;
  /** Só dígitos. */
  cpf: string | null;
  /** "0005 - NH PRESTACAO..." → "5". */
  empresaCodigo: string | null;
  /** AAAA-MM-DD */
  periodoInicio: string | null;
  periodoFim: string | null;
  retorno: string | null;
  pagamento: string | null;
  diasFerias: number | null;
  diasAbono: number | null;
}

const DINHEIRO = String.raw`(\d{1,3}(?:[.\s]\d{3})*,\d{2}|\d+,\d{2})`;

/** "1.234,56" / "1 234,56" / "692,99" → número; qualquer outra coisa → null. */
export function paraNumero(s: string | null | undefined): number | null {
  if (!s) return null;
  const limpo = s.replace(/[.\s]/g, "").replace(",", ".");
  if (!/^\d+\.\d{2}$/.test(limpo)) return null;
  const n = Number(limpo);
  return Number.isFinite(n) ? n : null;
}

const centavos = (n: number) => Math.round(n * 100);
export const mesmoValor = (a: number | null, b: number | null) => a != null && b != null && centavos(a) === centavos(b);

const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");

function dataIso(s: string | undefined): string | null {
  const m = s?.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (!m) return null;
  const [, d, mes, a] = m;
  if (+mes < 1 || +mes > 12 || +d < 1 || +d > 31) return null;
  return `${a}-${mes}-${d}`;
}

// ── Valor por extenso ────────────────────────────────────────────────
const UNIDADES: Record<string, number> = {
  zero: 0, um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9,
  dez: 10, onze: 11, doze: 12, treze: 13, quatorze: 14, catorze: 14, quinze: 15, dezesseis: 16, dezasseis: 16,
  dezessete: 17, dezassete: 17, dezoito: 18, dezenove: 19, dezanove: 19,
  vinte: 20, trinta: 30, quarenta: 40, cinquenta: 50, cincoenta: 50, sessenta: 60, setenta: 70, oitenta: 80, noventa: 90,
  cem: 100, cento: 100, duzentos: 200, duzentas: 200, trezentos: 300, trezentas: 300, quatrocentos: 400, quatrocentas: 400,
  quinhentos: 500, quinhentas: 500, seiscentos: 600, seiscentas: 600, setecentos: 700, setecentas: 700,
  oitocentos: 800, oitocentas: 800, novecentos: 900, novecentas: 900,
};

/** "seiscentos e noventa e dois" → 692. Palavra desconhecida → null (OCR errou: não é prova, nem contra nem a favor). */
function inteiroPorExtenso(txt: string): number | null {
  const palavras = semAcento(txt).toLowerCase().replace(/[^a-z\s]/g, " ").split(/\s+/).filter((p) => p && p !== "e" && p !== "de");
  if (!palavras.length) return null;
  let total = 0;
  let grupo = 0;
  for (const p of palavras) {
    if (p in UNIDADES) { grupo += UNIDADES[p]; continue; }
    if (p === "mil") { total += (grupo || 1) * 1000; grupo = 0; continue; }
    if (p === "milhao" || p === "milhoes") { total += (grupo || 1) * 1_000_000; grupo = 0; continue; }
    return null;
  }
  return total + grupo;
}

/** "(seiscentos e noventa e dois reais e noventa e nove centavos)" → 692.99 */
export function valorPorExtenso(txt: string | null | undefined): number | null {
  if (!txt) return null;
  const t = semAcento(txt).toLowerCase().replace(/\s+/g, " ").trim();
  const m = t.match(/^(.*?)\s*\breais?\b(?:\s*e\s*(.*?)\s*\bcentavos?\b)?\s*$/) ?? t.match(/^()(.*?)\s*\bcentavos?\b\s*$/);
  if (!m) return null;
  const [, parteReais, parteCent] = m;
  const reais = parteReais ? inteiroPorExtenso(parteReais) : 0;
  const cents = parteCent ? inteiroPorExtenso(parteCent) : 0;
  if (reais == null || cents == null || cents > 99) return null;
  return reais + cents / 100;
}

// ── Leitura do texto ─────────────────────────────────────────────────
export function lerTextoRecibo(texto: string): LeituraRecibo {
  const t = texto.replace(/\r/g, "");
  const linhas = t.split("\n").map((l) => l.trim()).filter(Boolean);
  const plano = linhas.join("\n");

  const liquidos: number[] = [];
  let idxLiquido = -1;
  linhas.forEach((l, i) => {
    const m = semAcento(l).match(new RegExp(String.raw`L.quido[\s.:_\-]*` + DINHEIRO, "i"));
    const v = m ? paraNumero(m[1]) : null;
    if (v != null) {
      if (!liquidos.some((x) => mesmoValor(x, v))) liquidos.push(v);
      if (idxLiquido < 0) idxLiquido = i;
    }
  });

  // Totais: a linha "Totais" ou, se o OCR comeu a palavra, a linha logo acima
  // do Líquido que tem exatamente dois valores (proventos > descontos).
  let proventos: number | null = null;
  let descontos: number | null = null;
  const doisValores = (l: string) => {
    const vs = [...l.matchAll(new RegExp(DINHEIRO, "g"))].map((x) => paraNumero(x[1]));
    return vs.length === 2 && vs[0] != null && vs[1] != null ? (vs as number[]) : null;
  };
  const linhaTotais = linhas.find((l) => /tota[il]s?/i.test(semAcento(l)) && doisValores(l));
  const candidata = linhaTotais ?? (idxLiquido > 0 ? linhas[idxLiquido - 1] : undefined);
  const par = candidata ? doisValores(candidata) : null;
  if (par && par[0] >= par[1]) [proventos, descontos] = par;

  const imp = semAcento(plano).match(new RegExp(String.raw`import.ncia\s+de\s+R\s*\$?\s*` + DINHEIRO, "i"));
  const importancia = imp ? paraNumero(imp[1]) : null;
  const ext = plano.replace(/\n/g, " ").match(new RegExp(String.raw`R\s*\$?\s*` + DINHEIRO + String.raw`\s*\(([^)]+)\)`, "i"));
  const extensoTexto = ext ? ext[2].trim() : null;

  const cad = plano.match(/(?:Cadastro|Colaborador)\s*:?\s*(\d{1,12})\s*-\s*([^\n]+?)(?:\s+CPF\b|$)/im);
  const cpf = plano.match(/CPF\s*:?\s*(\d{3}\.?\d{3}\.?\d{3}-?\d{2})/i);
  const emp = linhas[0]?.match(/^(\d{1,6})\s*-\s*\S/);
  const per = semAcento(plano).match(/Periodo\s+das\s+Ferias[\s.:_]*(\d{2}\/\d{2}\/\d{4})\s*a\s*(\d{2}\/\d{2}\/\d{4})/i)
    ?? semAcento(plano).match(/a\s+partir\s+de\s+(\d{2}\/\d{2}\/\d{4})\s*a\s*(\d{2}\/\d{2}\/\d{4})/i);
  const ret = semAcento(plano).match(/Retorno\s+ao\s+Trabalho[\s.:_]*(\d{2}\/\d{2}\/\d{4})/i);
  const pag = semAcento(plano).match(/Pagamento\s+do\s+Recibo[\s.:_]*(\d{2}\/\d{2}\/\d{4})/i);
  const dias = (rot: RegExp) => {
    const m = semAcento(plano).match(new RegExp(rot.source + String.raw`[\s.:_]*(\d{1,3},\d{2})`, "i"));
    return m ? paraNumero(m[1]) : null;
  };

  return {
    liquido: liquidos[0] ?? null,
    liquidos,
    importancia,
    extenso: valorPorExtenso(extensoTexto),
    extensoTexto,
    proventos,
    descontos,
    cadastro: cad ? String(Number(cad[1])) : null,
    nome: cad ? cad[2].replace(/\s+/g, " ").trim() : null,
    cpf: cpf ? cpf[1].replace(/\D/g, "") : null,
    empresaCodigo: emp ? String(Number(emp[1])) : null,
    periodoInicio: per ? dataIso(per[1]) : null,
    periodoFim: per ? dataIso(per[2]) : null,
    retorno: ret ? dataIso(ret[1]) : null,
    pagamento: pag ? dataIso(pag[1]) : null,
    diasFerias: dias(/Dias\s+Ferias/),
    diasAbono: dias(/Dias\s+Abono/),
  };
}

/** Junta duas leituras do mesmo arquivo (texto do PDF + OCR): o que uma não achou, a outra completa. */
export function juntarLeituras(a: LeituraRecibo, b: LeituraRecibo): LeituraRecibo {
  const r = { ...a } as Record<string, unknown>;
  for (const [k, v] of Object.entries(b)) if (r[k] == null || (Array.isArray(r[k]) && !(r[k] as unknown[]).length)) r[k] = v;
  return r as unknown as LeituraRecibo;
}

// ── Conferência do valor ─────────────────────────────────────────────
export interface ConferenciaValor {
  valor: number | null;
  /** true só com o líquido + ao menos 2 provas independentes e nenhuma contra. */
  confiavel: boolean;
  provas: string[];
  problemas: string[];
}

export const fmtReais = (n: number) => n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function conferirValor(l: LeituraRecibo): ConferenciaValor {
  const provas: string[] = [];
  const problemas: string[] = [];
  if (l.liquidos.length > 1) {
    problemas.push(`O arquivo tem mais de um recibo (líquidos ${l.liquidos.map(fmtReais).join(", ")}). Anexe só o recibo deste colaborador.`);
  }
  const L = l.liquido;
  if (L == null) {
    problemas.push('Não consegui ler o "Líquido" do recibo.');
    return { valor: null, confiavel: false, provas, problemas };
  }
  provas.push(`Líquido: R$ ${fmtReais(L)}`);

  if (l.importancia != null) {
    if (mesmoValor(l.importancia, L)) provas.push(`"Recebi a importância de R$ ${fmtReais(l.importancia)}"`);
    else problemas.push(`"Recebi a importância" foi lido como R$ ${fmtReais(l.importancia)}, diferente do líquido.`);
  }
  if (l.extenso != null) {
    if (mesmoValor(l.extenso, L)) provas.push(`Por extenso: "${l.extensoTexto}"`);
    else problemas.push(`O valor por extenso ("${l.extensoTexto}") dá R$ ${fmtReais(l.extenso)}, diferente do líquido.`);
  }
  if (l.proventos != null && l.descontos != null) {
    const conta = (centavos(l.proventos) - centavos(l.descontos)) / 100;
    if (mesmoValor(conta, L)) provas.push(`Totais: R$ ${fmtReais(l.proventos)} − R$ ${fmtReais(l.descontos)} = R$ ${fmtReais(conta)}`);
    else problemas.push(`Totais lidos (R$ ${fmtReais(l.proventos)} − R$ ${fmtReais(l.descontos)} = R$ ${fmtReais(conta)}) não fecham com o líquido.`);
  }
  const confirmacoes = provas.length - 1;
  if (!problemas.length && confirmacoes < 2) {
    problemas.push(`Só ${confirmacoes} conferência(s) além do líquido — são precisas 2 (importância, extenso ou totais) para puxar sozinho.`);
  }
  return { valor: L, confiavel: problemas.length === 0, provas, problemas };
}

// ── Conferência da pessoa e do período ───────────────────────────────
export interface Esperado {
  cpf?: string | null;
  matricula?: string | number | null;
  nome?: string | null;
  dataSaida?: string | null;
  diasFerias?: number | null;
}
export interface ConferenciaPessoa {
  /** Impede seguir: o recibo é comprovadamente de outra pessoa. */
  bloqueios: string[];
  /** Pede confirmação explícita do RH. */
  avisos: string[];
  ok: string[];
}

const normNome = (s: string) => semAcento(s).toUpperCase().replace(/[^A-Z ]/g, " ").replace(/\s+/g, " ").trim();
/** Proporção de palavras do nome esperado que aparecem no nome lido. */
function nomeParecido(lido: string, esperado: string): number {
  const a = new Set(normNome(lido).split(" ").filter((p) => p.length > 2));
  const b = normNome(esperado).split(" ").filter((p) => p.length > 2);
  if (!b.length) return 0;
  return b.filter((p) => a.has(p)).length / b.length;
}

export function conferirPessoa(l: LeituraRecibo, e: Esperado): ConferenciaPessoa {
  const bloqueios: string[] = [];
  const avisos: string[] = [];
  const ok: string[] = [];
  const cpfEsperado = (e.cpf ?? "").replace(/\D/g, "");
  const matEsperada = e.matricula != null && String(e.matricula).trim() !== "" ? String(Number(String(e.matricula).replace(/\D/g, ""))) : "";
  const nomeBate = l.nome && e.nome ? nomeParecido(l.nome, e.nome) >= 0.75 : null;

  if (l.cpf && cpfEsperado.length === 11) {
    if (l.cpf === cpfEsperado) ok.push("CPF do recibo é o do colaborador.");
    else bloqueios.push(`O CPF do recibo (${l.cpf}) não é o do colaborador desta solicitação.`);
  } else if (l.cadastro && matEsperada) {
    if (l.cadastro === matEsperada && nomeBate !== false) ok.push(`Matrícula ${l.cadastro} confere${nomeBate ? " e o nome também" : ""}.`);
    else if (l.cadastro !== matEsperada && nomeBate === false) bloqueios.push(`O recibo é da matrícula ${l.cadastro} (${l.nome}) — não é deste colaborador.`);
    else avisos.push(`Não deu para confirmar de quem é o recibo (lido: matrícula ${l.cadastro}, ${l.nome ?? "nome ilegível"}). Confira no PDF.`);
  } else {
    avisos.push("Não consegui ler o CPF nem a matrícula do recibo. Confira no PDF se é deste colaborador.");
  }

  if (e.dataSaida) {
    if (!l.periodoInicio) avisos.push("Não consegui ler o período das férias no recibo.");
    else if (l.periodoInicio === e.dataSaida.slice(0, 10)) ok.push("Início das férias confere com a saída da solicitação.");
    else avisos.push(`O recibo começa as férias em ${l.periodoInicio.split("-").reverse().join("/")}, e a solicitação sai em ${e.dataSaida.slice(0, 10).split("-").reverse().join("/")}.`);
  }
  if (e.diasFerias != null && l.diasFerias != null && Math.round(l.diasFerias) !== e.diasFerias) {
    avisos.push(`O recibo tem ${Math.round(l.diasFerias)} dias de férias, e a solicitação ${e.diasFerias}.`);
  }
  return { bloqueios, avisos, ok };
}
