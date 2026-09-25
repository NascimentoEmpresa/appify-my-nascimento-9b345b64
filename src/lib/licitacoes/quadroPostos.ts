// REGRAS DO QUADRO DE POSTOS DO CONTRATO — fonte única.
//
// O quadro é o que o contrato assinado exige: posto 1 = 10 jardineiros,
// posto 2 = 10 vigilantes, posto 3 = 10 auxiliares administrativos. Dele saem
// as 30 solicitações de vaga, cada uma já com salário, benefício, escala e
// local — ver `contrato_quadro_gerar_vagas` na migration 20260930000238.
//
// As mesmas regras valem no banco (a RPC `contrato_quadro_salvar` repete cada
// validação daqui). Aqui é onde elas ficam escritas uma vez só e onde os
// testes as alcançam; lá é o piso, porque a tela não é o único caminho até a
// tabela.

// O prazo da vaga NÃO é recalculado aqui de propósito: é a mesma regra da
// solicitação de vaga (7 dias úteis, seg–sex menos feriado nacional), e ela
// já mora em vagaRegras.ts, que é onde o trigger `sistema_recrutamento_guard`
// é espelhado. Reimplementar a contagem de dias úteis neste arquivo criaria
// duas contas que podem divergir — e a que a vaga usa na hora de gravar
// continuaria sendo a de lá, então a daqui só enganaria quem preenche.
import { avaliarPrazo, dataMinimaVaga, hojeIso, MIN_DIAS_UTEIS, fmtBr } from "@/lib/recrutamento/vagaRegras";

export { dataMinimaVaga, MIN_DIAS_UTEIS };

/** Uma linha do quadro, do jeito que o formulário a edita (tudo string). */
export interface LinhaQuadroForm {
  /** UUID quando a linha já existe no banco; "" na linha nova. */
  id: string;
  posto_nome: string;
  cargo: string;
  quantidade: string;
  escala: string;
  horario: string;
  salario: string;
  insalubridade_pct: string;
  periculosidade_pct: string;
  beneficios: string;
  estado: string;
  cidade: string;
  local_exato: string;
  data_inicio_prevista: string;
  motivo_vaga: string;
  req_obrigatorios: string;
  req_desejaveis: string;
  exp_minima: string;
  exp_minima_qual: string;
  observacao: string;
  gerar_vagas: boolean;
}

export const LINHA_VAZIA: LinhaQuadroForm = {
  id: "", posto_nome: "", cargo: "", quantidade: "1", escala: "", horario: "",
  salario: "", insalubridade_pct: "", periculosidade_pct: "", beneficios: "",
  estado: "", cidade: "", local_exato: "", data_inicio_prevista: "",
  motivo_vaga: "Admissão", req_obrigatorios: "", req_desejaveis: "",
  exp_minima: "Não", exp_minima_qual: "", observacao: "", gerar_vagas: true,
};

// ── Números em pt-BR ────────────────────────────────────────────────────
// O salário é digitado como as pessoas escrevem ("R$ 1.412,00", "1412,00",
// "1412"). Vira número aqui e só aqui: mandar a string crua pro banco faria a
// coluna numeric recusar a vírgula, e trocar vírgula por ponto sem tirar o
// separador de milhar leria "1.412,00" como 1,412.
export function paraNumero(v: unknown): number {
  if (v === null || v === undefined) return 0;
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const s = String(v).replace(/R\$\s*/i, "").trim();
  if (!s) return 0;
  // Com vírgula, a vírgula é o decimal e o ponto é milhar (pt-BR).
  // Sem vírgula, o ponto é o decimal (o que um <input type=number> devolve).
  const limpo = s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s;
  const n = Number(limpo);
  return Number.isFinite(n) ? n : 0;
}

export const paraInteiro = (v: unknown): number => {
  const n = Math.floor(paraNumero(v));
  return Number.isFinite(n) && n > 0 ? n : 0;
};

export const brl = (v: number): string =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

// ── Prazo da vaga ───────────────────────────────────────────────────────
// A vaga precisa de 7 dias úteis de antecedência — regra do
// `sistema_recrutamento_guard` (migration 20260903000001), que recusa o
// INSERT. A geração das vagas do quadro passa pelo MESMO guard, então a data
// de cada posto tem que respeitá-la antes de alguém clicar em salvar: sem
// isso o erro só apareceria na hora de gerar, com o contrato já gravado e
// nenhuma vaga aberta.
export const prazoSuficiente = (data: string, hoje = hojeIso()): boolean =>
  avaliarPrazo(data, hoje).ok;

// ── O que falta numa linha ──────────────────────────────────────────────
// Devolve as frases prontas, e não um booleano, pelo mesmo motivo de
// `erroDaRecomendacao` em vagaRegras.ts: a frase É a regra. "Informe o
// salário" e "o salário não pode ser zero" são problemas diferentes, e quem
// lê a tela precisa saber qual dos dois é o dele.
export function faltamNaLinha(l: LinhaQuadroForm): string[] {
  const faltam: string[] = [];
  if (!l.posto_nome.trim()) faltam.push("Posto");
  if (!l.cargo.trim()) faltam.push("Cargo");
  if (paraInteiro(l.quantidade) <= 0) faltam.push("Quantidade de colaboradores");
  if (!l.escala.trim()) faltam.push("Escala");
  if (paraNumero(l.salario) <= 0) faltam.push("Salário");
  if (!l.estado.trim()) faltam.push("Estado");
  if (!l.cidade.trim()) faltam.push("Cidade");
  if (!l.local_exato.trim()) faltam.push("Local exato de trabalho");
  if (!l.data_inicio_prevista.trim()) faltam.push("Data prevista de início");

  // "Sim" sem dizer qual experiência é a mesma meia-informação que um nome de
  // indicação sem telefone: o Recrutamento não consegue filtrar candidato.
  if (l.exp_minima === "Sim" && !l.exp_minima_qual.trim()) {
    faltam.push("Qual experiência mínima");
  }
  return faltam;
}

/** Erro de regra (não de campo vazio) da linha, ou null. */
export function erroDaLinha(l: LinhaQuadroForm, hoje = hojeIso()): string | null {
  if (faltamNaLinha(l).length) return null; // campo vazio é outra mensagem
  // Posto que não abre vaga agora não tem prazo a cumprir: ele existe no
  // quadro (é o contrato), só não vira solicitação nesta leva.
  if (l.gerar_vagas) {
    // `prazo.erro` já vem pronto e já diz a primeira data possível — repetir
    // a frase aqui daria duas versões do mesmo aviso para manter em dia.
    const prazo = avaliarPrazo(l.data_inicio_prevista, hoje);
    if (!prazo.ok) return `Posto "${l.posto_nome.trim()}": ${prazo.erro}`;
  }
  const pct = paraNumero(l.insalubridade_pct);
  if (pct < 0 || pct > 100) return `Posto "${l.posto_nome.trim()}": a insalubridade vai de 0 a 100%.`;
  const per = paraNumero(l.periculosidade_pct);
  if (per < 0 || per > 100) return `Posto "${l.posto_nome.trim()}": a periculosidade vai de 0 a 100%.`;
  return null;
}

/** Nome normalizado do posto — mesma régua do `sup_norm_nome` do banco. */
export const chavePosto = (s: string): string =>
  String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9]/g, "").toUpperCase();

/**
 * O que impede de salvar o quadro inteiro, ou [] se está tudo certo.
 *
 * Vale a pena olhar o conjunto e não só cada linha: "posto repetido" só se
 * responde com todas as linhas na mão, e é o erro que o UNIQUE
 * (contrato_id, posto_nome) devolveria como "duplicate key value violates
 * unique constraint" — sem dizer qual posto a pessoa digitou duas vezes.
 */
export function errosDoQuadro(linhas: LinhaQuadroForm[], hoje = hojeIso()): string[] {
  const erros: string[] = [];

  linhas.forEach((l, i) => {
    const faltam = faltamNaLinha(l);
    if (faltam.length) {
      const quem = l.posto_nome.trim() ? `Posto "${l.posto_nome.trim()}"` : `Posto nº ${i + 1}`;
      erros.push(`${quem}: falta ${faltam.join(", ")}.`);
      return;
    }
    const erro = erroDaLinha(l, hoje);
    if (erro) erros.push(erro);
  });

  const vistos = new Map<string, string>();
  for (const l of linhas) {
    const k = chavePosto(l.posto_nome);
    if (!k) continue;
    if (vistos.has(k)) {
      erros.push(`O posto "${l.posto_nome.trim()}" aparece duas vezes no quadro. Cada posto entra uma vez só — se são dois blocos diferentes, dê nomes diferentes.`);
    } else {
      vistos.set(k, l.posto_nome);
    }
  }
  return erros;
}

/** Total de pessoas que o quadro declara (some todos os postos). */
export const totalDeColaboradores = (linhas: LinhaQuadroForm[]): number =>
  linhas.reduce((s, l) => s + paraInteiro(l.quantidade), 0);

/** Quantas vagas a geração vai abrir — só os postos marcados para abrir. */
export const totalDeVagas = (linhas: LinhaQuadroForm[]): number =>
  linhas.filter(l => l.gerar_vagas).reduce((s, l) => s + paraInteiro(l.quantidade), 0);

/** Custo mensal de salário do quadro — conferência contra o valor do contrato. */
export const totalSalarialMensal = (linhas: LinhaQuadroForm[]): number =>
  linhas.reduce((s, l) => s + paraNumero(l.salario) * paraInteiro(l.quantidade), 0);

/** O quadro pronto para a RPC: números viram número, vazio vira null. */
export function paraPayload(linhas: LinhaQuadroForm[]) {
  return linhas.map((l, i) => ({
    id: l.id || null,
    posto_nome: l.posto_nome.trim(),
    cargo: l.cargo.trim(),
    quantidade: paraInteiro(l.quantidade),
    escala: l.escala.trim(),
    horario: l.horario.trim() || null,
    salario: paraNumero(l.salario),
    insalubridade_pct: paraNumero(l.insalubridade_pct),
    periculosidade_pct: paraNumero(l.periculosidade_pct),
    beneficios: l.beneficios.trim() || null,
    estado: l.estado.trim().toUpperCase(),
    cidade: l.cidade.trim(),
    local_exato: l.local_exato.trim(),
    data_inicio_prevista: l.data_inicio_prevista,
    motivo_vaga: l.motivo_vaga || "Admissão",
    req_obrigatorios: l.req_obrigatorios.trim() || null,
    req_desejaveis: l.req_desejaveis.trim() || null,
    exp_minima: l.exp_minima || "Não",
    exp_minima_qual: l.exp_minima_qual.trim() || null,
    observacao: l.observacao.trim() || null,
    gerar_vagas: !!l.gerar_vagas,
    ordem: i + 1,
  }));
}

// ── O card de obrigatórios do CONTRATO ──────────────────────────────────
//
// Até aqui a tela marcava os campos com "*" e o `handleSalvar` só conferia a
// empresa — dava para gravar um contrato sem vigência, sem valor e sem
// quantidade de funcionários, e o "*" não significava nada. O card lista o
// que falta, com o nome que aparece no formulário, e o botão de salvar espera.

export interface ContratoParaConferir {
  empresa_id?: string | null;
  nome?: string | null;
  cliente?: string | null;
  numero_edital?: string | null;
  cidade?: string | null;
  status_solicitacao?: string | null;
  data_inicio?: string | null;
  data_fim_vigencia?: string | null;
  vigencia_inicial?: string | null;
  vigencia_final?: string | null;
  quant_func_estipulado?: number | null;
  quant_func_exec?: number | null;
  valor_mensal_contratado?: number | null;
  valor_executado_mensal?: number | null;
}

export interface ItemObrigatorio {
  campo: string;
  secao: string;
  ok: boolean;
}

const preenchido = (v: unknown): boolean =>
  v !== null && v !== undefined && String(v).trim() !== "";

const positivo = (v: unknown): boolean =>
  v !== null && v !== undefined && String(v).trim() !== "" && Number(v) > 0;

/** A conferência do contrato, seção por seção, na ordem do formulário. */
export function conferirContrato(c: ContratoParaConferir): ItemObrigatorio[] {
  return [
    { secao: "Dados do Contrato", campo: "Empresa", ok: preenchido(c.empresa_id) },
    { secao: "Dados do Contrato", campo: "Contrato", ok: preenchido(c.nome) },
    { secao: "Dados do Contrato", campo: "Nº Edital", ok: preenchido(c.numero_edital) },
    { secao: "Dados do Contrato", campo: "Cidade", ok: preenchido(c.cidade) },
    { secao: "Dados do Contrato", campo: "Status da Solicitação", ok: preenchido(c.status_solicitacao) },
    { secao: "Dados do Contrato", campo: "Cliente (Órgão)", ok: preenchido(c.cliente) },
    { secao: "Vigência e Prazos", campo: "Data Início", ok: preenchido(c.data_inicio) },
    { secao: "Vigência e Prazos", campo: "Data Fim Vigência", ok: preenchido(c.data_fim_vigencia) },
    { secao: "Vigência e Prazos", campo: "Vigência Inicial", ok: preenchido(c.vigencia_inicial) },
    { secao: "Vigência e Prazos", campo: "Vigência Final", ok: preenchido(c.vigencia_final) },
    // Quantidade e valor aceitam zero? Não: contrato com 0 funcionário
    // estipulado ou R$ 0,00 mensal é cadastro pela metade, não um contrato
    // de verdade — e é dele que sai o confronto com o quadro de postos.
    { secao: "Equipe e Execução", campo: "Qtd. Func. Estip.", ok: positivo(c.quant_func_estipulado) },
    { secao: "Equipe e Execução", campo: "Qtd. Func. Exec.", ok: positivo(c.quant_func_exec) },
    { secao: "Valores Mensais", campo: "Valor Mensal Contratado", ok: positivo(c.valor_mensal_contratado) },
    { secao: "Valores Mensais", campo: "Valor Executado Mensal", ok: positivo(c.valor_executado_mensal) },
  ];
}

export const pendenciasDoContrato = (c: ContratoParaConferir): ItemObrigatorio[] =>
  conferirContrato(c).filter(i => !i.ok);

export const contratoCompleto = (c: ContratoParaConferir): boolean =>
  pendenciasDoContrato(c).length === 0;

/**
 * O quadro bate com a quantidade declarada no contrato?
 *
 * Divergir NÃO impede de salvar, de propósito: a implantação é faseada (o
 * contrato exige 30 e a primeira leva é de 12), e travar o cadastro nessa
 * conta obrigaria a mentir num dos dois campos. É um aviso — mas um aviso
 * visível, porque a divergência silenciosa entre o contrato e o quadro é
 * exatamente o que este módulo existe para acabar.
 */
export function conferirQuadroComContrato(
  linhas: LinhaQuadroForm[], quantFuncEstipulado: number | null | undefined,
): { total: number; estipulado: number; diferenca: number; aviso: string | null } {
  const total = totalDeColaboradores(linhas);
  const estipulado = Number(quantFuncEstipulado ?? 0) || 0;
  const diferenca = total - estipulado;
  if (!estipulado || !linhas.length || diferenca === 0) {
    return { total, estipulado, diferenca, aviso: null };
  }
  const aviso = diferenca > 0
    ? `O quadro soma ${total} colaboradores, ${diferenca} a MAIS que os ${estipulado} estipulados no contrato.`
    : `O quadro soma ${total} colaboradores, ${Math.abs(diferenca)} a MENOS que os ${estipulado} estipulados no contrato.`;
  return { total, estipulado, diferenca, aviso };
}
