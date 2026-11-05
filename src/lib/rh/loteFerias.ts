// =====================================================================
// RH › Gestão de Férias → "Malote em massa" (05/11/2026, pedido do Pablo:
// "um botão no gestão de férias de inserir malote em massa, onde seja
// possível adicionar esse arquivo que é as férias de vários ao mesmo tempo
// sendo pagas, o sistema tem que ler o nome completo ali, bater com o
// sistema e vincular esse mesmo documento na solicitação de férias").
//
// O arquivo é o lote que a Senior gera por filial ("FERIAS UFRGS MOTORISTAS
// 034.2022.pdf"): a 1ª página é a RELAÇÃO BANCÁRIA —
//     Cadastro  Nome                            Cpf             ... Valor
//     000005644 PAULO RICARDO DOS SANTOS DUTRA  359.120.900-78  ... 3.346,58
//     Total Geral da Empresa: 8.091,83
// — e depois vem UM "Recibo de Férias" por página, o mesmo recibo do envio
// individual (reciboFerias.ts). Tudo puro aqui; extrair o texto de cada
// página é do lerReciboFerias.ts (lerPaginasLote).
//
// "NÃO PODE PUXAR ERRADO DE FORMA ALGUMA" vale igual ao individual, com uma
// prova a mais: o valor de cada pessoa é CONFIÁVEL só quando o líquido do
// recibo dela bate com pelo menos DUAS conferências independentes — agora
// também a linha dela na relação bancária (que só conta se a soma das linhas
// fecha com o "Total Geral"). Qualquer divergência = o RH digita olhando o
// PDF. E a pessoa: CPF lido ≠ CPF do sistema bloqueia; o NOME COMPLETO tem
// de ser o do cadastro, senão o RH confirma olhando.
// =====================================================================
import {
  conferirValor, fmtReais, lerTextoRecibo, mesmoValor, paraNumero,
  type ConferenciaValor, type LeituraRecibo,
} from "./reciboFerias";

const DINHEIRO = String.raw`(\d{1,3}(?:\.\d{3})*,\d{2})`;
const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");
/** "Paulo Ricardo dos Santos  Dutra" → "PAULO RICARDO DOS SANTOS DUTRA" */
export const normNomeCompleto = (s: string | null | undefined) =>
  semAcento(s ?? "").toUpperCase().replace(/[^A-Z ]/g, " ").replace(/\s+/g, " ").trim();
const soDigitos = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "");
const dataIso = (s: string | undefined) => {
  const m = s?.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
};
const centavos = (n: number) => Math.round(n * 100);

// ── Páginas ──────────────────────────────────────────────────────────
export type TipoPagina = "relacao" | "recibo" | "outra";
export function tipoPagina(texto: string): TipoPagina {
  const t = semAcento(texto);
  if (/Rela..o\s+Banc.ria/i.test(t)) return "relacao";
  if (/Recibo\s+de\s+Ferias/i.test(t) || /L.quido[\s.:_]*\d/i.test(t)) return "recibo";
  return "outra";
}

// ── Relação bancária ─────────────────────────────────────────────────
export interface LinhaRelacao {
  /** Sem zeros à esquerda. */
  cadastro: string;
  nome: string;
  /** Só dígitos. */
  cpf: string;
  valor: number | null;
}
export interface RelacaoBancaria {
  empresaCodigo: string | null;
  filialCodigo: string | null;
  /** "UFRGS MOTORISTA - 034.2022" */
  filialNome: string | null;
  banco: string | null;
  /** AAAA-MM-DD */
  dataPagamento: string | null;
  linhas: LinhaRelacao[];
  totalGeral: number | null;
  /** A soma das linhas fecha com o total geral (só então a relação vale como prova). */
  fecha: boolean;
}

export function lerRelacaoBancaria(texto: string): RelacaoBancaria {
  const linhasTxt = texto.replace(/\r/g, "").split("\n").map((l) => l.trim()).filter(Boolean);
  const plano = linhasTxt.join("\n");
  const linhas: LinhaRelacao[] = [];
  const reLinha = new RegExp(String.raw`^(\d{4,12})\s+(.+?)\s+(\d{3}\.?\d{3}\.?\d{3}-?\d{2})\b(.*)$`);
  for (const l of linhasTxt) {
    const m = l.match(reLinha);
    if (!m) continue;
    const resto = [...m[4].matchAll(new RegExp(DINHEIRO, "g"))];
    linhas.push({
      cadastro: String(Number(m[1])),
      nome: m[2].replace(/\s+/g, " ").trim(),
      cpf: soDigitos(m[3]),
      valor: resto.length ? paraNumero(resto[resto.length - 1][1]) : null,
    });
  }
  const total = (rot: string) => {
    const m = semAcento(plano).match(new RegExp(rot + String.raw`[^\n\d]*` + DINHEIRO, "i"))
      ?? semAcento(plano).match(new RegExp(DINHEIRO + String.raw`[^\n\d]*` + rot, "i"));
    return m ? paraNumero(m[1]) : null;
  };
  const totalGeral = total(String.raw`Total\s+Geral(?:\s+da\s+Empresa)?\s*:?`);
  const soma = linhas.reduce((s, l) => s + (l.valor != null ? centavos(l.valor) : 0), 0);
  const fecha = linhas.length > 0 && linhas.every((l) => l.valor != null) && totalGeral != null && soma === centavos(totalGeral);

  const emp = linhasTxt[0]?.match(/^(\d{1,6})\s*-\s*\S/);
  const fil = plano.match(/Filial\s*:?\s*(\d{1,6})\s+([^\n]+)/i);
  const banco = plano.match(/Banco\s*:\s*([^\n]+)/i);
  const pag = semAcento(plano).match(/Data\s+Pagamento\s*:?\s*(\d{2}\/\d{2}\/\d{4})/i);
  return {
    empresaCodigo: emp ? String(Number(emp[1])) : null,
    filialCodigo: fil ? String(Number(fil[1])) : null,
    filialNome: fil ? fil[2].trim() : null,
    banco: banco ? banco[1].trim() : null,
    dataPagamento: dataIso(pag?.[1]),
    linhas,
    totalGeral,
    fecha,
  };
}

// ── O lote: uma entrada por pessoa ───────────────────────────────────
export interface PessoaLote {
  /** CPF (ou cadastro, se o CPF não foi lido) — chave da pessoa no lote. */
  chave: string;
  nome: string | null;
  cpf: string | null;
  cadastro: string | null;
  /** Valor da linha dela na relação bancária. */
  valorRelacao: number | null;
  recibo: LeituraRecibo | null;
  /** Página do arquivo (1 = primeira) com o recibo dela. */
  paginaRecibo: number | null;
  conferencia: ConferenciaValor;
}
export interface Lote {
  relacao: RelacaoBancaria | null;
  pessoas: PessoaLote[];
  /** Problemas do arquivo inteiro (não impedem as pessoas que conferem). */
  avisos: string[];
}

/** Confere o valor de uma pessoa juntando as provas do recibo e a da relação bancária. */
export function conferirValorLote(recibo: LeituraRecibo | null, valorRelacao: number | null, relacaoFecha: boolean, haRelacao = true): ConferenciaValor {
  const base: ConferenciaValor = recibo
    ? conferirValor(recibo)
    : { valor: null, confiavel: false, provas: [], problemas: ["Não há recibo desta pessoa no arquivo — só a linha da relação bancária."] };
  const provas = [...base.provas];
  // A frase "só N conferências" do individual é refeita aqui, com a relação contando.
  const problemas = base.problemas.filter((p) => !p.startsWith("Só "));
  if (valorRelacao != null && base.valor != null) {
    if (!mesmoValor(valorRelacao, base.valor)) {
      problemas.push(`A relação bancária paga R$ ${fmtReais(valorRelacao)}, e o recibo tem líquido de R$ ${fmtReais(base.valor)}.`);
    } else if (relacaoFecha) {
      provas.push(`Relação bancária: R$ ${fmtReais(valorRelacao)}`);
    }
  }
  if (haRelacao && valorRelacao == null && base.valor != null) {
    problemas.push("Esta pessoa não está na relação bancária do arquivo.");
  }
  const confirmacoes = provas.length - (base.valor != null ? 1 : 0);
  if (!problemas.length && confirmacoes < 2) {
    problemas.push(`Só ${confirmacoes} conferência(s) além do líquido — são precisas 2 (relação bancária, importância, extenso ou totais).`);
  }
  const valor = base.valor ?? valorRelacao;
  return { valor, confiavel: base.valor != null && problemas.length === 0, provas, problemas };
}

/** Recebe o texto de cada página do arquivo, na ordem. */
export function montarLote(paginas: string[]): Lote {
  const avisos: string[] = [];
  let relacao: RelacaoBancaria | null = null;
  const recibos: { pagina: number; leitura: LeituraRecibo }[] = [];
  paginas.forEach((texto, i) => {
    const tipo = tipoPagina(texto);
    if (tipo === "relacao") {
      const r = lerRelacaoBancaria(texto);
      if (!relacao) relacao = r;
      else {
        // Relação em mais de uma página: junta as linhas; o total geral é o da última.
        relacao = { ...relacao, linhas: [...relacao.linhas, ...r.linhas], totalGeral: r.totalGeral ?? relacao.totalGeral };
        const soma = relacao.linhas.reduce((s, l) => s + (l.valor != null ? centavos(l.valor) : 0), 0);
        relacao.fecha = relacao.linhas.every((l) => l.valor != null) && relacao.totalGeral != null && soma === centavos(relacao.totalGeral);
      }
    } else if (tipo === "recibo") {
      recibos.push({ pagina: i + 1, leitura: lerTextoRecibo(texto) });
    }
  });
  const rel = relacao as RelacaoBancaria | null;
  if (!rel) avisos.push("O arquivo não tem a página da Relação Bancária — cada valor depende só do recibo.");
  else if (!rel.fecha) {
    avisos.push(rel.totalGeral == null
      ? "Não consegui ler o \"Total Geral\" da relação bancária — ela não conta como conferência."
      : `A soma das linhas da relação bancária não fecha com o Total Geral (R$ ${fmtReais(rel.totalGeral)}) — ela não conta como conferência.`);
  }
  if (!recibos.length) avisos.push("Não achei nenhum Recibo de Férias no arquivo.");

  const pessoas: PessoaLote[] = [];
  const usados = new Set<number>();
  const mesmaPessoa = (r: LeituraRecibo, l: LinhaRelacao) =>
    (r.cpf && r.cpf === l.cpf) || (!r.cpf && r.cadastro === l.cadastro && normNomeCompleto(r.nome) === normNomeCompleto(l.nome));
  for (const l of rel?.linhas ?? []) {
    const achados = recibos.filter((r, i) => !usados.has(i) && mesmaPessoa(r.leitura, l));
    const idx = achados.length ? recibos.indexOf(achados[0]) : -1;
    if (idx >= 0) usados.add(idx);
    const rec = idx >= 0 ? recibos[idx] : null;
    pessoas.push({
      chave: l.cpf || `cad:${l.cadastro}`,
      nome: l.nome, cpf: l.cpf || rec?.leitura.cpf || null, cadastro: l.cadastro,
      valorRelacao: l.valor, recibo: rec?.leitura ?? null, paginaRecibo: rec?.pagina ?? null,
      conferencia: conferirValorLote(rec?.leitura ?? null, l.valor, !!rel?.fecha),
    });
    if (achados.length > 1) avisos.push(`${l.nome} tem ${achados.length} recibos no arquivo — conferido só o primeiro (página ${rec!.pagina}).`);
  }
  recibos.forEach((r, i) => {
    if (usados.has(i)) return;
    const l = r.leitura;
    pessoas.push({
      chave: l.cpf || (l.cadastro ? `cad:${l.cadastro}` : `pag:${r.pagina}`),
      nome: l.nome, cpf: l.cpf, cadastro: l.cadastro,
      valorRelacao: null, recibo: l, paginaRecibo: r.pagina,
      conferencia: conferirValorLote(l, null, false, !!rel),
    });
  });
  // Um CPF repetido no lote é sinal de leitura errada: ninguém confere sozinho.
  const vistos = new Map<string, number>();
  for (const p of pessoas) vistos.set(p.chave, (vistos.get(p.chave) ?? 0) + 1);
  for (const p of pessoas) {
    if ((vistos.get(p.chave) ?? 0) > 1) {
      p.conferencia = { ...p.conferencia, confiavel: false, problemas: [...p.conferencia.problemas, "Esta pessoa aparece mais de uma vez no arquivo."] };
    }
  }
  return { relacao: rel, pessoas, avisos };
}

// ── Casamento com as solicitações do sistema ─────────────────────────
/** Uma solicitação de férias candidata (RPC ferias_lote_localizar). */
export interface CandidataLote {
  id: number;
  colaborador_id: number | null;
  nome: string | null;
  cpf: string | null;
  matricula: string | null;
  data_saida: string | null;
  dias_ferias: number | null;
  status: string;
  /** Já tem despesa viva no Malote. */
  no_malote: boolean;
  empresa_id: string | null;
  contrato_id: string | null;
  contrato_nome: string | null;
}
export interface Casamento {
  /** A solicitação escolhida sozinha (null = o RH escolhe ou a pessoa fica de fora). */
  solicitacaoId: number | null;
  /** Solicitações em que dá para lançar (aprovadas, fora do Malote) — o RH pode trocar. */
  opcoes: CandidataLote[];
  bloqueios: string[];
  avisos: string[];
  ok: string[];
}

const fmtData = (iso: string | null | undefined) => (iso ? iso.slice(0, 10).split("-").reverse().join("/") : "—");

export function casarPessoa(p: PessoaLote, candidatas: CandidataLote[]): Casamento {
  const bloqueios: string[] = [];
  const avisos: string[] = [];
  const ok: string[] = [];
  const cpf = soDigitos(p.cpf);
  const nome = normNomeCompleto(p.nome);
  // Da pessoa: mesmo CPF; ou, sem CPF no sistema, mesmo nome completo.
  const dela = candidatas.filter((c) => {
    const cc = soDigitos(c.cpf);
    if (cpf.length === 11 && cc.length === 11) return cc === cpf;
    return !!nome && normNomeCompleto(c.nome) === nome;
  });
  // Homônimo com outro CPF: avisa (não entra).
  const homonimos = candidatas.filter((c) => !dela.includes(c) && !!nome && normNomeCompleto(c.nome) === nome);
  if (homonimos.length && !dela.length) {
    bloqueios.push(`Há "${p.nome}" no sistema, mas com outro CPF — não é a mesma pessoa.`);
  }
  if (!dela.length) {
    if (!bloqueios.length) bloqueios.push("Não achei solicitação de férias desta pessoa no sistema (pelo CPF nem pelo nome completo).");
    return { solicitacaoId: null, opcoes: [], bloqueios, avisos, ok };
  }

  const nomeSistema = dela[0].nome;
  if (nome && normNomeCompleto(nomeSistema) === nome) ok.push("Nome completo igual ao do cadastro.");
  else avisos.push(`O nome no arquivo ("${p.nome ?? "ilegível"}") não é igual ao do sistema ("${nomeSistema}").`);
  if (cpf.length === 11 && soDigitos(dela[0].cpf) === cpf) ok.push("CPF confere.");

  const opcoes = dela.filter((c) => c.status === "Aprovada" && !c.no_malote);
  if (!opcoes.length) {
    const noMalote = dela.find((c) => c.no_malote);
    bloqueios.push(noMalote
      ? `As férias de ${fmtData(noMalote.data_saida)} já estão no Malote.`
      : `Nenhuma solicitação aprovada (${dela.map((c) => `${fmtData(c.data_saida)}: ${c.status}`).join("; ")}).`);
    return { solicitacaoId: null, opcoes, bloqueios, avisos, ok };
  }
  const inicio = p.recibo?.periodoInicio ?? null;
  const naData = inicio ? opcoes.filter((c) => c.data_saida?.slice(0, 10) === inicio) : [];
  let escolhida: CandidataLote | null = null;
  if (naData.length === 1) {
    escolhida = naData[0];
    ok.push(`Férias de ${fmtData(inicio)} — mesma saída da solicitação.`);
  } else if (opcoes.length === 1) {
    escolhida = opcoes[0];
    avisos.push(inicio
      ? `O recibo começa as férias em ${fmtData(inicio)}, e a solicitação aprovada sai em ${fmtData(escolhida.data_saida)}.`
      : `Não consegui ler o período no recibo — a única solicitação aprovada sai em ${fmtData(escolhida.data_saida)}.`);
  } else {
    avisos.push(`Há ${opcoes.length} solicitações aprovadas desta pessoa — escolha a destas férias.`);
  }
  if (escolhida && p.recibo?.diasFerias != null && escolhida.dias_ferias != null && Math.round(p.recibo.diasFerias) !== escolhida.dias_ferias) {
    avisos.push(`O recibo tem ${Math.round(p.recibo.diasFerias)} dias de férias, e a solicitação ${escolhida.dias_ferias}.`);
  }
  return { solicitacaoId: escolhida?.id ?? null, opcoes, bloqueios, avisos, ok };
}

// ── Nome da despesa ──────────────────────────────────────────────────
/** "1048 - UFRGS - MOTORISTAS - 034/2022" → "UFRGS MOTORISTAS 034.2022" (como o RH nomeia no Malote). */
export function nomeContratoMalote(contrato: string | null | undefined): string {
  return (contrato ?? "").replace(/^\s*\d+\s*-\s*/, "").replace(/\s*-\s*/g, " ").replace(/\//g, ".").replace(/\s+/g, " ").trim().toUpperCase();
}
/** Um contrato só: "FERIAS UFRGS MOTORISTAS 034.2022"; vários: pela filial da relação. */
export function nomeDespesaLote(contratos: (string | null | undefined)[], filialRelacao: string | null | undefined): string {
  const unicos = [...new Set(contratos.map(nomeContratoMalote).filter(Boolean))];
  const base = unicos.length === 1 ? unicos[0] : nomeContratoMalote(filialRelacao);
  return `FERIAS ${base || "EM LOTE"}`.replace(/\s+/g, " ").trim();
}
