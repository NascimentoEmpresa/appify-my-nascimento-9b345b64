// REGRAS DO QUADRO DE POSTOS DO CONTRATO — fonte única.
//
// O quadro segue a MESMA cascata do Catálogo de Materiais — contrato → posto
// → função → quantas pessoas:
//
//   BENTO GONÇALVES LIMPEZA 048/2026
//     ├── BLOCO CIRURGICO  → SERVENTE DE LIMPEZA ....  4
//     ├── LAVANDERIA       → SERVENTE DE LIMPEZA ....  2
//     └── UPA 24 H         → SERVENTE DE LIMPEZA .... 10
//
// A quantidade pendura na FUNÇÃO, não no posto: um posto pode ter mais de uma
// função, e "quantas pessoas" só faz sentido perguntado da função. Dela saem
// as solicitações de vaga, cada uma já com salário, benefício, escala e local
// — ver `contrato_quadro_gerar_vagas` na migration 20260930000238.
//
// As mesmas regras valem no banco (a RPC `contrato_quadro_salvar` repete cada
// validação daqui). Aqui é onde elas ficam escritas uma vez só e onde os
// testes as alcançam; lá é o piso, porque a tela não é o único caminho até a
// tabela.

// O prazo da vaga NÃO é recalculado aqui de propósito: é a mesma regra da
// solicitação de vaga (3 dias corridos desde 13/11/2026; eram 7 úteis), e ela
// já mora em vagaRegras.ts, que é onde o trigger `sistema_recrutamento_guard`
// é espelhado. Reimplementar a contagem de dias neste arquivo criaria
// duas contas que podem divergir — e a que a vaga usa na hora de gravar
// continuaria sendo a de lá, então a daqui só enganaria quem preenche.
import { avaliarPrazo, dataMinimaVaga, hojeIso, MIN_DIAS_ANTECEDENCIA, fmtBr } from "@/lib/recrutamento/vagaRegras";
import { beneficiosDoCusto, type CustoPosto } from "@/lib/recrutamento/custoPosto";
import { herancaDaConvencao, percentualTexto, type RespostaReferencia } from "@/lib/licitacoes/convencoes";

export { dataMinimaVaga, MIN_DIAS_ANTECEDENCIA };

/** Um provento de "Outros" (SIS-2026-0884) — digitado à mão, valor em R$/mês. */
export interface ProventoForm {
  descricao: string;
  valor: string;
}

/** Campos que o posto preenche sozinho (SIS-2026-0884). */
export type CampoAuto = "salario" | "insalubridade_pct" | "periculosidade_pct" | "beneficios";

/** Uma linha do quadro, do jeito que o formulário a edita (tudo string). */
export interface LinhaQuadroForm {
  /** UUID quando a linha já existe no banco; "" na linha nova. */
  id: string;
  posto_nome: string;
  /** Id do posto no catálogo (sup_posto). "" quando o posto é novo. */
  sup_posto_id: string;
  funcao_nome: string;
  /** Id da função no catálogo (sup_funcao). "" quando a função é nova. */
  sup_funcao_id: string;
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
  /** Proventos fora do convencional — vão para a vaga (SIS-2026-0884). */
  outros_proventos: ProventoForm[];
  /**
   * O último valor que o PREENCHIMENTO AUTOMÁTICO pôs em cada campo. Não vai
   * para o banco: serve só para saber se o que está no campo ainda é o que o
   * posto trouxe (pode ser atualizado) ou se alguém digitou por cima (nunca
   * mais é tocado sem o botão). Ver `aplicarPreenchimento`.
   */
  auto?: Partial<Record<CampoAuto, string>>;
}

export const LINHA_VAZIA: LinhaQuadroForm = {
  id: "", posto_nome: "", sup_posto_id: "", funcao_nome: "", sup_funcao_id: "",
  cargo: "", quantidade: "1", escala: "", horario: "",
  salario: "", insalubridade_pct: "", periculosidade_pct: "", beneficios: "",
  estado: "", cidade: "", local_exato: "", data_inicio_prevista: "",
  motivo_vaga: "Admissão", req_obrigatorios: "", req_desejaveis: "",
  exp_minima: "Não", exp_minima_qual: "", observacao: "", gerar_vagas: true,
  outros_proventos: [],
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
// A vaga precisa de 3 dias corridos de antecedência — regra do
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
  // A função não é detalhe: é dela que sai o enxoval de uniforme/EPI da
  // admissão (sup_funcao_item), e é por função que se conta gente.
  if (!l.funcao_nome.trim()) faltam.push("Função");
  if (!l.cargo.trim()) faltam.push("Cargo");
  // A quantidade não entra: é ELA que decide se a linha é validada
  // (ver `linhaEmUso`). Uma linha sem quantidade não está no quadro.

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

/** Como a linha é chamada nas mensagens: "Posto X · Função Y", ou o número. */
export function rotuloDaLinha(l: LinhaQuadroForm, i: number): string {
  const p = l.posto_nome.trim();
  const f = l.funcao_nome.trim();
  if (p && f) return `Posto "${p}" · função "${f}"`;
  if (p) return `Posto "${p}"`;
  return `Posto nº ${i + 1}`;
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
    if (!prazo.ok) return `${rotuloDaLinha(l, 0)}: ${prazo.erro}`;
  }
  const pct = paraNumero(l.insalubridade_pct);
  if (pct < 0 || pct > 100) return `${rotuloDaLinha(l, 0)}: a insalubridade vai de 0 a 100%.`;
  const per = paraNumero(l.periculosidade_pct);
  if (per < 0 || per > 100) return `${rotuloDaLinha(l, 0)}: a periculosidade vai de 0 a 100%.`;
  const outro = erroDosOutros(l.outros_proventos);
  if (outro) return `${rotuloDaLinha(l, 0)}: ${outro}`;
  return null;
}

// ── "Outros" (SIS-2026-0884) ────────────────────────────────────────────
// Item em branco (sem descrição e sem valor) é ignorado — é a linha que a
// pessoa abriu e não usou. Meio preenchido é erro: a mesma regra que
// `contrato_quadro_outros_limpos` aplica no banco.
const proventoEmBranco = (p: ProventoForm) => !p.descricao.trim() && paraNumero(p.valor) === 0;

export function erroDosOutros(outros: ProventoForm[] | undefined): string | null {
  for (const p of outros ?? []) {
    if (proventoEmBranco(p)) continue;
    if (!p.descricao.trim()) return `item de "Outros" sem descrição.`;
    if (paraNumero(p.valor) <= 0) return `o item "${p.descricao.trim()}" de "Outros" precisa de valor maior que zero.`;
  }
  return null;
}

/**
 * "Outros" como a vaga mostra: "Ajuda de custo R$ 150,00/mês · Bônus R$ 80,00/mês".
 * Aceita o jsonb da vaga (`SISTEMA_RECRUTAMENTO.outros_proventos`) como vier.
 */
export function outrosEmTexto(outros: unknown): string {
  if (!Array.isArray(outros)) return "";
  return outros
    .map(p => ({ d: String((p as { descricao?: unknown })?.descricao ?? "").trim(), v: paraNumero((p as { valor?: unknown })?.valor) }))
    .filter(p => p.d && p.v > 0)
    .map(p => `${p.d} ${brl(p.v)}/mês`)
    .join(" · ");
}

/** "Outros" pronto para o banco: só os itens preenchidos, valor numérico. */
export const outrosParaPayload = (outros: ProventoForm[] | undefined) =>
  (outros ?? []).filter(p => !proventoEmBranco(p))
    .map(p => ({ descricao: p.descricao.trim(), valor: paraNumero(p.valor) }));

/** Nome normalizado do posto — mesma régua do `sup_norm_nome` do banco. */
export const chavePosto = (s: string): string =>
  String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9]/g, "").toUpperCase();

// ── Linha "em uso" ──────────────────────────────────────────────────────
//
// O quadro NASCE com a cascata inteira do contrato: os 27 postos de BENTO
// GONÇALVES e as funções de cada um já aparecem listados, porque eles já
// existem no catálogo — fazer alguém redigitar os 27 para dizer quantas
// pessoas quer em três deles seria trabalho inventado.
//
// A consequência é que a maioria das linhas está ali só para ser vista. Uma
// linha só ENTRA no quadro quando ganha quantidade >= 1; até lá ela não é
// validada, não é gravada e não abre vaga. Sem essa regra o card de
// obrigatórios abriria com 27 postos reclamando salário e escala, e o
// contrato ficaria impossível de salvar por causa de postos que ninguém
// pediu para preencher.
export const linhaEmUso = (l: LinhaQuadroForm): boolean => paraInteiro(l.quantidade) >= 1;

/** A identidade da linha do quadro: posto + função, normalizados. */
export const chaveLinha = (l: Pick<LinhaQuadroForm, "posto_nome" | "funcao_nome">): string => {
  const p = chavePosto(l.posto_nome);
  const f = chavePosto(l.funcao_nome);
  return p && f ? `${p}|${f}` : "";
};

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
    // Linha sem quantidade é só o catálogo mostrando que o posto existe.
    if (!linhaEmUso(l)) return;
    const faltam = faltamNaLinha(l);
    if (faltam.length) {
      erros.push(`${rotuloDaLinha(l, i)}: falta ${faltam.join(", ")}.`);
      return;
    }
    const erro = erroDaLinha(l, hoje);
    if (erro) erros.push(erro);
  });

  // O que não pode repetir é o PAR posto+função. O mesmo posto entra várias
  // vezes quando tem várias funções (LAVANDERIA com servente e com
  // encarregado são duas linhas); duas linhas com o mesmo par é que deixariam
  // sem resposta de qual delas é cada vaga.
  const vistos = new Set<string>();
  for (const l of linhas.filter(linhaEmUso)) {
    const k = chaveLinha(l);
    if (!k) continue;
    if (vistos.has(k)) {
      erros.push(`A função "${l.funcao_nome.trim()}" aparece duas vezes no posto "${l.posto_nome.trim()}". Some as quantidades numa linha só.`);
    } else {
      vistos.add(k);
    }
  }
  return erros;
}

/** Total de pessoas que o quadro declara (soma todas as funções). */
export const totalDeColaboradores = (linhas: LinhaQuadroForm[]): number =>
  linhas.reduce((s, l) => s + paraInteiro(l.quantidade), 0);

/**
 * Quantos POSTOS distintos o quadro toca.
 *
 * Não é `linhas.length`: uma linha é um par posto+função, e um posto com duas
 * funções são duas linhas do mesmo posto. "3 postos" tem que bater com o que
 * a pessoa vê na coluna Posto do Catálogo.
 */
export const totalDePostos = (linhas: LinhaQuadroForm[]): number =>
  new Set(linhas.filter(linhaEmUso).map(l => chavePosto(l.posto_nome)).filter(Boolean)).size;

/** Quantas linhas (posto+função) o contrato de fato usa. */
export const totalDeFuncoes = (linhas: LinhaQuadroForm[]): number =>
  linhas.filter(linhaEmUso).length;

/** Quantas vagas a geração vai abrir — só os postos marcados para abrir. */
export const totalDeVagas = (linhas: LinhaQuadroForm[]): number =>
  linhas.filter(l => l.gerar_vagas).reduce((s, l) => s + paraInteiro(l.quantidade), 0);

/** Custo mensal de salário do quadro — conferência contra o valor do contrato. */
export const totalSalarialMensal = (linhas: LinhaQuadroForm[]): number =>
  linhas.reduce((s, l) => s + paraNumero(l.salario) * paraInteiro(l.quantidade), 0);

/** O quadro pronto para a RPC: números viram número, vazio vira null. */
export function paraPayload(linhas: LinhaQuadroForm[]) {
  // Só vai para o banco o que tem gente. As outras linhas são a cascata do
  // catálogo aparecendo na tela — gravá-las encheria o quadro de todo
  // contrato com dezenas de linhas vazias.
  return linhas.filter(linhaEmUso).map((l, i) => ({
    id: l.id || null,
    posto_nome: l.posto_nome.trim(),
    funcao_nome: l.funcao_nome.trim(),
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
    outros_proventos: outrosParaPayload(l.outros_proventos),
    ordem: i + 1,
  }));
}

// ── O quadro nasce com a cascata do contrato ────────────────────────────

/** Um par posto+função que o catálogo do contrato já tem. */
export interface ParDoCatalogo {
  posto_nome: string;
  sup_posto_id: string;
  funcao_nome: string;
  sup_funcao_id: string;
}

/**
 * Monta o par posto+função a partir das duas listas do catálogo.
 *
 * Posto SEM função entra mesmo assim, com a função em branco: ele existe no
 * contrato, e escondê-lo faria a tela mostrar menos postos que o Catálogo de
 * Materiais — que é exatamente a estranheza que este trecho existe para
 * evitar. Quem for usar aquele posto digita a função na hora.
 */
export function paresDoCatalogo(
  postos: { id: string; nome: string }[],
  funcoes: { id: string; nome: string; posto_id: string }[],
): ParDoCatalogo[] {
  const pares: ParDoCatalogo[] = [];
  for (const p of postos) {
    const doPosto = funcoes.filter(f => f.posto_id === p.id);
    if (!doPosto.length) {
      pares.push({ posto_nome: p.nome, sup_posto_id: p.id, funcao_nome: "", sup_funcao_id: "" });
      continue;
    }
    for (const f of doPosto) {
      pares.push({ posto_nome: p.nome, sup_posto_id: p.id, funcao_nome: f.nome, sup_funcao_id: f.id });
    }
  }
  return pares;
}

/**
 * O que a tela mostra: o quadro salvo MAIS todo par posto+função do catálogo
 * que ainda não está nele.
 *
 * O que já foi salvo manda — uma linha do catálogo nunca sobrescreve salário,
 * escala ou quantidade que alguém digitou. O que vem do catálogo entra com
 * quantidade "0", ou seja, fora do quadro até alguém dizer quantas pessoas
 * quer (ver `linhaEmUso`).
 *
 * A ordem é a do Catálogo de Materiais (posto, depois função), e não "salvas
 * primeiro": a pessoa está conferindo contra aquela tela, e duas ordens
 * diferentes para a mesma cascata obrigariam a procurar linha por linha.
 */
export function mesclarComCatalogo(
  salvas: LinhaQuadroForm[],
  pares: ParDoCatalogo[],
): LinhaQuadroForm[] {
  const porChave = new Map<string, LinhaQuadroForm>();
  for (const l of salvas) {
    const k = chaveLinha(l) || chavePosto(l.posto_nome);
    if (k) porChave.set(k, l);
  }

  const vindasDoCatalogo: LinhaQuadroForm[] = [];
  for (const par of pares) {
    const k = par.funcao_nome
      ? `${chavePosto(par.posto_nome)}|${chavePosto(par.funcao_nome)}`
      : chavePosto(par.posto_nome);
    if (porChave.has(k)) continue;
    // Posto sem função: só entra se o posto ainda não apareceu em NENHUMA
    // linha salva. Senão o posto que já tem duas funções no quadro ganharia
    // uma terceira linha vazia só porque o catálogo não casou a chave.
    if (!par.funcao_nome && salvas.some(l => chavePosto(l.posto_nome) === chavePosto(par.posto_nome))) {
      continue;
    }
    vindasDoCatalogo.push({
      ...LINHA_VAZIA,
      posto_nome: par.posto_nome,
      sup_posto_id: par.sup_posto_id,
      funcao_nome: par.funcao_nome,
      sup_funcao_id: par.sup_funcao_id,
      quantidade: "0",
    });
  }

  const todas = [...salvas, ...vindasDoCatalogo];
  return todas.sort((a, b) => {
    const pa = a.posto_nome.localeCompare(b.posto_nome, "pt-BR");
    if (pa !== 0) return pa;
    return a.funcao_nome.localeCompare(b.funcao_nome, "pt-BR");
  });
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

// ── Convenção do contrato (13/11/2026, mig 20261113100500) ──────────────
// Com convenção vinculada no contrato, benefícios e percentuais de TODOS os
// postos saem dela (ver herancaDaConvencao em convencoes.ts), por cima do
// que estiver na linha — inclusive do "Puxar da Planilha". É o que a tela
// mostra e o que vai para contrato_quadro_salvar (e dali para as vagas).
export function aplicarHerancaNoQuadro(
  linhas: LinhaQuadroForm[],
  h: { beneficios: string; insalubridade_pct: string; periculosidade_pct: string } | null | undefined,
): LinhaQuadroForm[] {
  if (!h) return linhas;
  return linhas.map(l => (
    l.beneficios === h.beneficios && l.insalubridade_pct === h.insalubridade_pct && l.periculosidade_pct === h.periculosidade_pct
      ? l
      : { ...l, beneficios: h.beneficios, insalubridade_pct: h.insalubridade_pct, periculosidade_pct: h.periculosidade_pct }
  ));
}

// ── O posto preenche a linha (SIS-2026-0884, 16/11/2026) ────────────────
//
// Pedido: escolhido o posto, salário, insalubridade, periculosidade e
// benefícios vêm sozinhos — o contrato de 750 postos não pode depender de
// clicar "Puxar da Planilha" 750 vezes. A remuneração de TODOS os postos do
// contrato chega numa chamada (`lic_quadro_remuneracao_do_contrato`, mig
// 20261116210000), crua como a Planilha de Custo guarda (R$). As regras que
// transformam o R$ da planilha no que a vaga pede ficam aqui.
//
// DECISÕES (a confirmar com o solicitante — o padrão é o mais seguro):
//   1. Nada que alguém digitou é sobrescrito automaticamente. O automático só
//      preenche campo VAZIO ou campo que ainda tem o valor que ele mesmo pôs
//      (`auto`). Por isso um quadro já salvo não muda o salário sozinho ao ser
//      reaberto; "Atualizar da Planilha" (o botão) é quem força.
//   2. Valor que a planilha ou a convenção não têm fica VAZIO — nunca
//      inventado nem calculado sobre uma base suposta.
//   3. Periculosidade (%) = R$ periculosidade ÷ salário base × 100: a lei põe a
//      periculosidade sobre o salário base, então a conta é a própria regra.
//   4. Insalubridade (%): a planilha guarda R$, e a base costuma ser o salário
//      mínimo (nacional, regional ou o da CCT) — o banco não tem essa tabela.
//      Ordem: % da convenção vinculada ao posto; senão, R$ ÷ salário base SÓ
//      quando dá exatamente um grau legal (10, 20 ou 40%); senão fica vazio e
//      a tela mostra o R$ da planilha para quem preenche informar o %.
//   5. Benefícios: convenção do CONTRATO (já tratada por
//      `aplicarHerancaNoQuadro`) > convenção vinculada ao POSTO na Planilha de
//      Custo > benefícios da própria planilha (VT/VA/... em R$/mês).
//   6. Add. Líder, Add. Not. Reduzida, Add. Noturno, Horas Extras e DSR da
//      planilha NÃO entram sozinhos em "Outros": na planilha eles são custo
//      estimado do posto, não provento garantido de quem é contratado. A tela
//      os mostra, e um clique os inclui em "Outros".
//   7. O automático só usa o posto de nome EXATO na planilha. A aproximação
//      por cidade/escala (rec_custo_do_posto) fica só no botão, com aviso.

/** Uma linha de `lic_quadro_remuneracao_do_contrato`. */
export interface RemuneracaoPosto {
  posto: string;
  planilha_custo_id?: string | null;
  vigencia?: string | null;
  salario: number | null;
  insalubridade: number | null;
  periculosidade: number | null;
  lideranca?: number | null;
  adicional_noturno_reduzido?: number | null;
  adicional_noturno?: number | null;
  adicional_extra?: number | null;
  dsr?: number | null;
  vt?: number | null;
  va?: number | null;
  vr?: number | null;
  lanche?: number | null;
  cesta_basica?: number | null;
  assistencia_medica?: number | null;
  /** Saída de lic_referencia_do_posto_interno para o posto. */
  referencia?: RespostaReferencia | null;
}

/** Graus legais de insalubridade (NR-15). */
export const GRAUS_INSALUBRIDADE = [10, 20, 40] as const;

/** Número → como o formulário mostra ("1964,63"). */
const textoValor = (n: number): string => n.toFixed(2).replace(".", ",");
const positivoOuZero = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

/** O que o posto diz para a linha, campo a campo, e por quê. */
export interface PreenchimentoPosto {
  valores: Partial<Record<CampoAuto, string>>;
  /** De onde veio cada campo — vira a dica embaixo dele. */
  origem: Partial<Record<CampoAuto, string>>;
  /** O que a planilha tem e não virou campo (insalubridade sem base, etc.). */
  avisos: string[];
  /** Adicionais da planilha que podem ir para "Outros" com um clique. */
  adicionais: { descricao: string; valor: number }[];
}

export const ROTULO_ADICIONAL: { chave: keyof RemuneracaoPosto; descricao: string }[] = [
  { chave: "lideranca", descricao: "Adicional de líder" },
  { chave: "adicional_noturno_reduzido", descricao: "Adicional noturno reduzido" },
  { chave: "adicional_noturno", descricao: "Adicional noturno" },
  { chave: "adicional_extra", descricao: "Adicional de horas extras" },
  { chave: "dsr", descricao: "DSR" },
];

/**
 * A remuneração da planilha (e a convenção do posto) traduzida para os campos
 * da linha. `convencaoNoContrato`: a convenção do contrato já manda em
 * benefícios e percentuais (aplicarHerancaNoQuadro) — aqui eles ficam de fora,
 * senão a planilha e a convenção brigariam pelo mesmo campo a cada render.
 */
export function preenchimentoDoPosto(
  r: RemuneracaoPosto | null | undefined,
  opts: { convencaoNoContrato?: boolean } = {},
): PreenchimentoPosto {
  const out: PreenchimentoPosto = { valores: {}, origem: {}, avisos: [], adicionais: [] };
  if (!r) return out;
  const daPlanilha = `Da Planilha de Custo${r.vigencia ? ` (vigência ${fmtBr(String(r.vigencia).slice(0, 10))})` : ""}`;

  const salario = positivoOuZero(r.salario);
  if (salario > 0) {
    out.valores.salario = textoValor(salario);
    out.origem.salario = daPlanilha;
  }

  for (const a of ROTULO_ADICIONAL) {
    const v = positivoOuZero(r[a.chave]);
    if (v > 0) out.adicionais.push({ descricao: a.descricao, valor: Math.round(v * 100) / 100 });
  }

  if (opts.convencaoNoContrato) return out;

  // Convenção vinculada ao POSTO (Planilha de Custo). A do contrato não chega
  // aqui (o resolvedor devolve origem 'contrato' e ela já foi tratada).
  const heranca = r.referencia?.origem === "posto" ? herancaDaConvencao(r.referencia) : null;
  const nomeCct = "Da Convenção Coletiva vinculada ao posto";

  // Periculosidade
  const perValor = positivoOuZero(r.periculosidade);
  if (heranca?.periculosidade_pct) {
    out.valores.periculosidade_pct = heranca.periculosidade_pct;
    out.origem.periculosidade_pct = nomeCct;
  } else if (perValor > 0 && salario > 0) {
    const pct = Math.round((perValor / salario) * 10000) / 100;
    if (pct > 0 && pct <= 100) {
      out.valores.periculosidade_pct = percentualTexto(pct);
      out.origem.periculosidade_pct = `${daPlanilha}: ${brl(perValor)} sobre o salário base`;
    }
  } else if (perValor > 0) {
    out.avisos.push(`Periculosidade na planilha: ${brl(perValor)}/mês, sem salário base para calcular o %.`);
  }

  // Insalubridade
  const insValor = positivoOuZero(r.insalubridade);
  if (heranca?.insalubridade_pct) {
    out.valores.insalubridade_pct = heranca.insalubridade_pct;
    out.origem.insalubridade_pct = nomeCct;
  } else if (insValor > 0) {
    const pct = salario > 0 ? (insValor / salario) * 100 : 0;
    const grau = GRAUS_INSALUBRIDADE.find(g => Math.abs(pct - g) < 0.5);
    if (grau) {
      out.valores.insalubridade_pct = String(grau);
      out.origem.insalubridade_pct = `${daPlanilha}: ${brl(insValor)} = ${grau}% do salário base`;
    } else {
      out.avisos.push(`Insalubridade na planilha: ${brl(insValor)}/mês — a base de cálculo não é o salário base (costuma ser o salário mínimo). Informe o %.`);
    }
  }

  // Benefícios
  if (heranca?.beneficios) {
    out.valores.beneficios = heranca.beneficios;
    out.origem.beneficios = nomeCct;
  } else {
    const texto = beneficiosDoCusto({
      vt: r.vt ?? null, va: r.va ?? null, vr: r.vr ?? null, lanche: r.lanche ?? null,
      cesta_basica: r.cesta_basica ?? null, assistencia_medica: r.assistencia_medica ?? null,
    } as CustoPosto);
    if (texto) {
      out.valores.beneficios = texto;
      out.origem.beneficios = daPlanilha;
    }
  }
  return out;
}

/**
 * Aplica o preenchimento na linha. Devolve a linha nova, ou null quando nada
 * muda (é o que impede o efeito da tela de entrar em laço).
 *
 * Sem `forcar`: só mexe no campo vazio ou que ainda tem o valor que o próprio
 * automático pôs (`auto`) — quem digitou por cima não perde o que digitou.
 * Com `forcar` (o botão "Atualizar da Planilha"): troca o que a fonte tem; o
 * que a fonte NÃO tem continua como está (decisão 2: nada é apagado).
 */
export function aplicarPreenchimento(
  l: LinhaQuadroForm, p: PreenchimentoPosto, forcar = false,
): LinhaQuadroForm | null {
  let mudou = false;
  const auto: Partial<Record<CampoAuto, string>> = { ...(l.auto ?? {}) };
  const nova: LinhaQuadroForm = { ...l, auto };
  for (const campo of Object.keys(p.valores) as CampoAuto[]) {
    const valor = p.valores[campo]!;
    const atual = l[campo] ?? "";
    const anterior = l.auto?.[campo];
    const livre = forcar || !atual.trim() || (anterior !== undefined && atual === anterior);
    if (!livre) continue;
    if (atual !== valor) { nova[campo] = valor; mudou = true; }
    if (anterior !== valor) { auto[campo] = valor; mudou = true; }
  }
  return mudou ? nova : null;
}

/** Mapa nome normalizado do posto → remuneração. */
export function remuneracaoPorPosto(lista: RemuneracaoPosto[] | null | undefined): Map<string, RemuneracaoPosto> {
  const m = new Map<string, RemuneracaoPosto>();
  for (const r of lista ?? []) {
    const k = chavePosto(r.posto);
    if (k && !m.has(k)) m.set(k, r);
  }
  return m;
}

/**
 * Preenche todas as linhas EM USO do quadro (quantidade >= 1) cujo posto está
 * na planilha. Linha zerada é só o catálogo à mostra: não é tocada, para não
 * mexer em 750 linhas que ninguém pediu. Devolve null quando nada muda.
 */
export function preencherQuadro(
  linhas: LinhaQuadroForm[], porPosto: Map<string, RemuneracaoPosto>, convencaoNoContrato: boolean,
): LinhaQuadroForm[] | null {
  let mudou = false;
  const novas = linhas.map(l => {
    if (!linhaEmUso(l)) return l;
    const r = porPosto.get(chavePosto(l.posto_nome));
    if (!r) return l;
    const n = aplicarPreenchimento(l, preenchimentoDoPosto(r, { convencaoNoContrato }));
    if (!n) return l;
    mudou = true;
    return n;
  });
  return mudou ? novas : null;
}

/** Inclui um adicional da planilha em "Outros" (não duplica pela descrição). */
export function incluirEmOutros(outros: ProventoForm[] | undefined, a: { descricao: string; valor: number }): ProventoForm[] {
  const lista = outros ?? [];
  if (lista.some(p => chavePosto(p.descricao) === chavePosto(a.descricao))) return lista;
  return [...lista, { descricao: a.descricao, valor: textoValor(a.valor) }];
}
