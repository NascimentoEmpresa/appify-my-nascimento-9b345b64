// =====================================================================
// Licitações › Convenções Coletivas e Decretos Municipais (27/10/2026,
// mig 20261027000930) — as regras, sem tela.
//
// Do chamado:
//   • os benefícios ficam em campos próprios (não basta anexar o PDF);
//   • "Não contém" desabilita o resto do benefício;
//   • campo NÃO preenchido não é "Não contém": vira pendência, para o
//     Recrutamento não entender que o benefício não existe;
//   • a periodicidade é a cadastrada — "por dia" nunca vira "por mês";
//   • com mais de uma referência no posto, cada benefício diz de qual
//     convenção sai (`regras`) — nada é somado nem duplicado;
//   • sem vínculo do posto = pendência, nunca a CCT de outro posto.
//
// Usado pelo cadastro (avisos e situação), pela Planilha de Custo (vínculo)
// e pela vaga (quadro "Benefícios e adicionais da vaga").
// =====================================================================

//
// 03/11/2026 (ajustes do cadastro da CCT):
//   • Insalubridade, Periculosidade e Líder em porcentagem: o percentual é
//     DIGITADO (sem lista fixa) e leva a "Base de cálculo" — obrigatória
//     quando o adicional está preenchido. A base é sobre o que o percentual
//     incide, não uma terceira modalidade: o Líder continua Valor OU
//     Porcentagem (no Valor não há base);
//   • VA ganha o desconto do colaborador (valor ou porcentagem, digitado,
//     ou "Não contém");
//   • VT saiu da CCT: vem do decreto municipal (BENEFICIOS_DECRETO).
//   Cadastro antigo com percentual e sem base fica Pendente até informar.

export type Periodo = "dia" | "mes";
export type ModoLider = "valor" | "porcentagem";

/** Sobre o que o percentual incide. */
export type BaseCalculo = "salario_base" | "salario_normativo" | "minimo_regional" | "minimo_nacional";

export const BASES_CALCULO: { valor: BaseCalculo; nome: string }[] = [
  { valor: "salario_base", nome: "Salário base" },
  { valor: "salario_normativo", nome: "Salário normativo" },
  { valor: "minimo_regional", nome: "Salário mínimo regional" },
  { valor: "minimo_nacional", nome: "Salário mínimo nacional" },
];

export const NOME_BASE = Object.fromEntries(BASES_CALCULO.map((b) => [b.valor, b.nome])) as Record<BaseCalculo, string>;

/** Como cada benefício é preenchido. */
export type TipoBeneficio = "valor" | "percentual" | "lider";

export interface DefBeneficio {
  chave: ChaveBeneficio;
  nome: string;
  tipo: TipoBeneficio;
  /** Periodicidades aceitas (tipo valor/lider). Uma só = fixa, sem escolha. */
  periodos?: Periodo[];
  /** Pede o desconto do colaborador (VA). */
  desconto?: boolean;
}

export type ChaveBeneficio =
  | "va" | "vl" | "vt" | "insalubridade" | "periculosidade"
  | "assiduidade" | "cesta_basica" | "plano_saude" | "auxilio_creche" | "adicional_lider";

/** A ordem é a do chamado — Vale-Lanche logo abaixo do Vale-Alimentação. */
export const BENEFICIOS: DefBeneficio[] = [
  { chave: "va", nome: "Vale-Alimentação (VA)", tipo: "valor", periodos: ["dia", "mes"], desconto: true },
  { chave: "vl", nome: "Vale Lanche (VL)", tipo: "valor", periodos: ["dia", "mes"] },
  { chave: "vt", nome: "Vale-Transporte (VT)", tipo: "valor", periodos: ["dia", "mes"] },
  { chave: "insalubridade", nome: "Insalubridade", tipo: "percentual" },
  { chave: "periculosidade", nome: "Periculosidade", tipo: "percentual" },
  { chave: "assiduidade", nome: "Prêmio Assiduidade", tipo: "valor", periodos: ["dia", "mes"] },
  { chave: "cesta_basica", nome: "Cesta Básica", tipo: "valor", periodos: ["dia", "mes"] },
  { chave: "plano_saude", nome: "Plano de Saúde", tipo: "valor", periodos: ["mes"] },
  { chave: "auxilio_creche", nome: "Auxílio Creche", tipo: "valor", periodos: ["mes"] },
  { chave: "adicional_lider", nome: "Adicional de Líder", tipo: "lider", periodos: ["dia", "mes"] },
];

export const DEF_POR_CHAVE = Object.fromEntries(BENEFICIOS.map((b) => [b.chave, b])) as Record<ChaveBeneficio, DefBeneficio>;

/** O que a CCT cadastra — o VT vem do decreto municipal. */
export const BENEFICIOS_CCT: DefBeneficio[] = BENEFICIOS.filter((b) => b.chave !== "vt");

/** Desconto do colaborador (VA): valor ou porcentagem, ou "Não contém". */
export interface DescontoColaborador {
  nao_contem?: boolean;
  modo?: ModoLider | null;
  valor?: number | null;
  percentual?: number | null;
}

/** O que fica em `beneficios[chave]` no banco. */
export interface ValorBeneficio {
  nao_contem?: boolean;
  valor?: number | null;
  periodo?: Periodo | null;
  percentual?: number | null;
  modo?: ModoLider | null;
  /** Percentual (insalubridade, periculosidade, líder em %): sobre o quê. */
  base?: BaseCalculo | null;
  desconto?: DescontoColaborador | null;
}

export type MapaBeneficios = Partial<Record<ChaveBeneficio, ValorBeneficio>>;

const percentualOk = (p: unknown) => Number(p) > 0 && Number(p) <= 100;
const baseOk = (b: unknown) => BASES_CALCULO.some((x) => x.valor === b);

export function descontoPreenchido(d: DescontoColaborador | null | undefined): boolean {
  if (!d) return false;
  if (d.nao_contem) return true;
  if (d.modo === "valor") return Number(d.valor) > 0;
  if (d.modo === "porcentagem") return percentualOk(d.percentual);
  return false;
}

/** Benefício com informação suficiente (ou "Não contém" marcado). */
export function beneficioPreenchido(def: DefBeneficio, v: ValorBeneficio | null | undefined): boolean {
  if (!v) return false;
  if (v.nao_contem) return true;
  const periodoOk = (p: Periodo | null | undefined) => !!p && (def.periodos ?? []).includes(p);
  if (def.tipo === "valor") return Number(v.valor) > 0 && periodoOk(periodoEfetivo(def, v)) && (!def.desconto || descontoPreenchido(v.desconto));
  if (def.tipo === "percentual") return percentualOk(v.percentual) && baseOk(v.base);
  if (v.modo === "valor") return Number(v.valor) > 0 && periodoOk(v.periodo);
  if (v.modo === "porcentagem") return percentualOk(v.percentual) && baseOk(v.base) && periodoOk(v.periodo);
  return false;
}

/** Periodicidade fixa (Plano de Saúde, Auxílio Creche) não depende de escolha. */
export function periodoEfetivo(def: DefBeneficio, v: ValorBeneficio): Periodo | null {
  if (def.periodos?.length === 1) return def.periodos[0];
  return v.periodo ?? null;
}

// Espaço comum no lugar do NBSP do Intl: o texto também vai para o "Copiar informações".
const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }).replace(/\s/g, " ");
const rotuloPeriodo = (p: Periodo | null) => (p === "dia" ? " / dia" : p === "mes" ? " / mês" : "");

const pct = (n: number) => `${n.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;
const sobre = (b: BaseCalculo | null | undefined) => (b ? ` sobre o ${NOME_BASE[b].toLowerCase()}` : "");

/** "20%", "R$ 50,00", "não contém" — o desconto do colaborador. */
export function textoDesconto(d: DescontoColaborador | null | undefined): string | null {
  if (!descontoPreenchido(d)) return null;
  if (d!.nao_contem) return "não contém";
  return d!.modo === "porcentagem" ? pct(Number(d!.percentual)) : brl(Number(d!.valor));
}

/**
 * "R$ 461,82 / mês", "20% sobre o salário mínimo regional", "Não contém" —
 * ou null se não preenchido. O percentual nunca sai sem a base.
 */
export function textoBeneficio(def: DefBeneficio, v: ValorBeneficio | null | undefined): string | null {
  if (!beneficioPreenchido(def, v)) return null;
  if (v!.nao_contem) return "Não contém";
  if (def.tipo === "percentual") return `${pct(Number(v!.percentual))}${sobre(v!.base)}`;
  if (def.tipo === "lider" && v!.modo === "porcentagem") return `${pct(Number(v!.percentual))}${sobre(v!.base)}${rotuloPeriodo(v!.periodo ?? null)}`;
  const texto = `${brl(Number(v!.valor))}${rotuloPeriodo(periodoEfetivo(def, v!))}`;
  return def.desconto ? `${texto} · desconto do colaborador: ${textoDesconto(v!.desconto)}` : texto;
}

const numOuNull = (n: unknown) => (Number(n) > 0 ? Number(n) : null);

/** Normaliza o que vai pro banco: "Não contém" limpa o resto; periodicidade fixa entra sozinha. */
export function normalizarBeneficios(m: MapaBeneficios): MapaBeneficios {
  const out: MapaBeneficios = {};
  for (const def of BENEFICIOS) {
    const v = m[def.chave];
    if (!v) continue;
    if (v.nao_contem) { out[def.chave] = { nao_contem: true }; continue; }
    const limpo: ValorBeneficio = { nao_contem: false };
    if (def.tipo === "valor") {
      limpo.valor = numOuNull(v.valor);
      limpo.periodo = periodoEfetivo(def, v);
      if (def.desconto && v.desconto) {
        const d = v.desconto;
        limpo.desconto = d.nao_contem ? { nao_contem: true }
          : { nao_contem: false, modo: d.modo ?? null, ...(d.modo === "valor" ? { valor: numOuNull(d.valor) } : d.modo === "porcentagem" ? { percentual: numOuNull(d.percentual) } : {}) };
      }
    } else if (def.tipo === "percentual") {
      limpo.percentual = numOuNull(v.percentual);
      limpo.base = v.base ?? null;
    } else {
      limpo.modo = v.modo ?? null;
      limpo.periodo = v.periodo ?? null;
      if (v.modo === "valor") limpo.valor = numOuNull(v.valor);
      // Base só existe na porcentagem — no Valor ela não é guardada.
      if (v.modo === "porcentagem") { limpo.percentual = numOuNull(v.percentual); limpo.base = v.base ?? null; }
    }
    out[def.chave] = limpo;
  }
  return out;
}

// ── Cadastro ──────────────────────────────────────────────────────────────

/** 'decreto' = cadastro próprio do decreto municipal (mig 20261103002250). */
export type TipoCadastro = "cct" | "decreto";

/** O que o decreto municipal traz: só o Vale-Transporte. */
export const BENEFICIOS_DECRETO: ChaveBeneficio[] = ["vt"];

export interface CadastroConvencao {
  tipo?: TipoCadastro | null;
  empresa_id?: string | null;
  contrato_id?: string | null;
  categoria_profissional?: string | null;
  sindicato?: string | null;
  vigencia_inicio?: string | null;
  vigencia_fim?: string | null;
  cct_arquivo_path?: string | null;
  decreto_numero?: string | null;
  decreto_arquivo_path?: string | null;
  municipio?: string | null;
  beneficios?: MapaBeneficios | null;
}

const vazio = (s: unknown) => !String(s ?? "").trim();

/** O que falta para o cadastro ficar "Completo". Lista vazia = completo. */
export function pendenciasConvencao(c: CadastroConvencao): string[] {
  if (c.tipo === "decreto") return pendenciasDecreto(c);
  const p: string[] = [];
  // Contrato e posto saíram da CCT (03/11/2026): o vínculo é na Planilha de Custo.
  // Empresa saiu em 09/11/2026 (mig 20261109004500): a CCT é cadastrada uma
  // vez e vale para todas as empresas a que se aplica — não é pendência.
  if (vazio(c.categoria_profissional)) p.push("Categoria profissional não informada");
  if (vazio(c.sindicato)) p.push("Sindicato não informado");
  if (vazio(c.vigencia_inicio) || vazio(c.vigencia_fim)) p.push("Vigência da CCT incompleta");
  else if (String(c.vigencia_fim) < String(c.vigencia_inicio)) p.push("Vigência da CCT termina antes de começar");
  if (vazio(c.cct_arquivo_path)) p.push("Convenção coletiva não anexada");
  for (const def of BENEFICIOS_CCT) p.push(...pendenciaBeneficio(def, c.beneficios?.[def.chave]));
  return p;
}

/** O aviso diz o que falta — a base e o desconto têm mensagem própria. */
function pendenciaBeneficio(def: DefBeneficio, v: ValorBeneficio | null | undefined): string[] {
  if (beneficioPreenchido(def, v)) return [];
  const temPercentual = def.tipo === "percentual" || (def.tipo === "lider" && v?.modo === "porcentagem");
  if (v && temPercentual && percentualOk(v.percentual) && !baseOk(v.base)) return [`${def.nome}: escolha a base de cálculo`];
  if (v && def.desconto && Number(v.valor) > 0 && !descontoPreenchido(v.desconto)) {
    return [`${def.nome}: informe o desconto do colaborador ou marque "Não contém"`];
  }
  if (v && temPercentual && Number(v.percentual) > 100) return [`${def.nome}: percentual acima de 100%`];
  return [`${def.nome}: preencha o valor ou marque "Não contém"`];
}

/** Decreto municipal: número, município, anexo e o VT (valor ou "Não contém"). */
export function pendenciasDecreto(c: CadastroConvencao): string[] {
  const p: string[] = [];
  if (vazio(c.decreto_numero)) p.push("Número do decreto não informado");
  if (vazio(c.municipio)) p.push("Município não informado");
  if (vazio(c.decreto_arquivo_path)) p.push("Decreto não anexado");
  for (const chave of BENEFICIOS_DECRETO) {
    const def = DEF_POR_CHAVE[chave];
    if (!beneficioPreenchido(def, c.beneficios?.[chave])) p.push(`${def.nome}: preencha o valor ou marque "Não contém"`);
  }
  return p;
}

export const situacaoConvencao =(c: CadastroConvencao): "completo" | "pendente" =>
  pendenciasConvencao(c).length ? "pendente" : "completo";

/** "CCT 2026/2027" a partir da vigência (quando a identificação não foi digitada). */
export function identificacaoCct(c: { identificacao?: string | null; vigencia_inicio?: string | null; vigencia_fim?: string | null }): string | null {
  if (!vazio(c.identificacao)) return String(c.identificacao).trim();
  const a = String(c.vigencia_inicio ?? "").slice(0, 4);
  const b = String(c.vigencia_fim ?? "").slice(0, 4);
  if (!a) return null;
  return `CCT ${a}${b ? "/" + b : ""}`;
}

export const dataBr = (iso: string | null | undefined) => (iso ? String(iso).slice(0, 10).split("-").reverse().join("/") : "—");

/** "01/01/2026 a 31/12/2027". */
export const vigenciaTxt = (de?: string | null, ate?: string | null) =>
  de || ate ? `${dataBr(de)} a ${dataBr(ate)}` : "—";

// ── Quadro da vaga ────────────────────────────────────────────────────────

/** Uma referência como lic_referencia_do_posto devolve. */
export interface ReferenciaConvencao {
  id: string;
  versao: number;
  identificacao?: string | null;
  categoria_profissional?: string | null;
  sindicato?: string | null;
  municipio?: string | null;
  vigencia_inicio?: string | null;
  vigencia_fim?: string | null;
  cct_arquivo_path?: string | null;
  decreto_numero?: string | null;
  decreto_arquivo_path?: string | null;
  beneficios?: MapaBeneficios | null;
  contrato_nome?: string | null;
  situacao?: string | null;
}

/** Saída de lic_referencia_do_posto / rec_beneficios_da_vaga. */
export interface RespostaReferencia {
  status: "sem_posto" | "sem_vinculo" | "vinculado";
  /**
   * De onde veio o vínculo (mig 20261113100500): 'contrato' = convenção do
   * contrato, que vale para todos os postos dele; 'posto' = vínculo do posto
   * na Planilha de Custo (contrato sem convenção própria). Retrato antigo de
   * vaga não tem o campo — é 'posto'.
   */
  origem?: "contrato" | "posto";
  contrato_id?: string | null;
  posto?: string | null;
  principal_id?: string;
  regras?: Partial<Record<ChaveBeneficio, string>>;
  referencias?: ReferenciaConvencao[];
  gerado_em?: string | null;
  pode_atualizar?: boolean;
  versoes_atuais?: Record<string, number>;
}

export interface ItemQuadro {
  def: DefBeneficio;
  /** "R$ 461,82 / mês", "Não contém"… — null = pendente. */
  texto: string | null;
  naoContem: boolean;
  referencia: ReferenciaConvencao | null;
}

export interface Quadro {
  status: RespostaReferencia["status"] | "pendente" | "ok";
  itens: ItemQuadro[];
  pendencias: string[];
  /** Referências de fato usadas (a principal primeiro). */
  usadas: ReferenciaConvencao[];
  /** Alguma convenção usada já tem versão mais nova que a do retrato. */
  desatualizada: boolean;
}

/** Benefício a benefício: de qual referência ele sai (regra do posto, senão a principal). */
export function montarQuadro(r: RespostaReferencia | null | undefined): Quadro {
  if (!r || r.status !== "vinculado") {
    const motivo = !r || r.status === "sem_posto"
      ? "A vaga não tem posto de trabalho do catálogo — escolha o posto para puxar os benefícios."
      : `O posto ${r.posto ?? ""} ainda não tem CCT/decreto vinculado na Planilha de Custo. A Licitação precisa fazer o vínculo.`;
    return { status: r?.status ?? "sem_posto", itens: [], pendencias: [motivo], usadas: [], desatualizada: false };
  }
  const refs = new Map((r.referencias ?? []).map((x) => [x.id, x]));
  const pendencias: string[] = [];
  const usadasIds: string[] = [];
  const itens = BENEFICIOS.map((def): ItemQuadro => {
    const id = r.regras?.[def.chave] || r.principal_id || "";
    const ref = refs.get(id) ?? null;
    if (!ref) {
      pendencias.push(`${def.nome}: a referência escolhida para este benefício não existe mais.`);
      return { def, texto: null, naoContem: false, referencia: null };
    }
    if (!usadasIds.includes(ref.id)) usadasIds.push(ref.id);
    const v = ref.beneficios?.[def.chave];
    const texto = textoBeneficio(def, v);
    // VT sai do decreto municipal: CCT sem VT pede o decreto, não o VT na CCT.
    if (!texto && def.chave === "vt" && !ref.decreto_numero) {
      pendencias.push(r.origem === "contrato"
        ? `${def.nome}: o contrato não tem decreto municipal para o VT — escolha o decreto no cadastro do contrato.`
        : `${def.nome}: o posto não tem decreto municipal para o VT — vincule na Planilha de Custo.`);
    }
    else if (!texto) pendencias.push(`${def.nome}: não preenchido em ${identificacaoCct(ref) ?? ref.decreto_numero ?? "na convenção"}.`);
    return { def, texto, naoContem: !!v?.nao_contem && !!texto, referencia: ref };
  });
  const ordem = (id: string) => (id === r.principal_id ? 0 : 1);
  const usadas = usadasIds.sort((a, b) => ordem(a) - ordem(b)).map((id) => refs.get(id)!);
  const desatualizada = usadas.some((u) => (r.versoes_atuais?.[u.id] ?? u.versao) > u.versao);
  return { status: pendencias.length ? "pendente" : "ok", itens, pendencias, usadas, desatualizada };
}

/** Texto do quadro para colar (Copiar informações da vaga). */
export function quadroEmTexto(q: Quadro): string {
  if (q.status !== "ok" && q.status !== "pendente") return "";
  return q.itens.map((i) => `${i.def.nome}: ${i.texto ?? "PENDENTE"}`).join("\n");
}

// ── Percentual digitado ───────────────────────────────────────────────────

/**
 * "7,5" / "7.5" / "7,5%" → 7.5; vazio ou inválido → null. O campo virou
 * texto em 09/11/2026: o input numérico do navegador, com a seta, ocupava o
 * pouco espaço que sobrava ao lado de "Porcentagem" e parecia desabilitado.
 */
export function lerPercentual(texto: string | null | undefined): number | null {
  const t = String(texto ?? "").replace(/%/g, "").replace(/\s/g, "").replace(",", ".");
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** 7.5 → "7,5" (o que o campo mostra). */
export const percentualTexto = (n: number | null | undefined) =>
  n == null || !Number.isFinite(Number(n)) ? "" : String(n).replace(".", ",");

// ── Vários anexos na CCT (09/11/2026, mig 20261109004500) ─────────────────
//
// O SEEAC publica mais de uma CCT: a convenção guarda N arquivos, cada um com
// a descrição da abrangência. Anexo novo NÃO substitui o anterior.
// `cct_arquivo_*` da convenção é o espelho do PRIMEIRO anexo (é o que a vaga,
// os KPIs e a pendência "não anexada" leem).

export interface AnexoLista {
  /** Linha em LIC_CONVENCAO_ANEXO; sem id = ainda não gravado. */
  id?: string | null;
  path: string | null;
  nome: string | null;
  tamanho: number | null;
  descricao: string | null;
}

/**
 * Lista de anexos de um cadastro: as linhas da tabela, na ordem em que
 * entraram; cadastro de antes da tabela (ou banco ainda sem ela) cai no anexo
 * único antigo, sem id — ao salvar ele vira linha.
 */
export function anexosDoCadastro(
  c: { cct_arquivo_path?: string | null; cct_arquivo_nome?: string | null; cct_arquivo_tamanho?: number | null } | null | undefined,
  linhas: (AnexoLista & { criado_em?: string | null })[] | null | undefined,
): AnexoLista[] {
  if (linhas?.length) {
    return [...linhas]
      .sort((a, b) => String(a.criado_em ?? "").localeCompare(String(b.criado_em ?? "")))
      .map((l) => ({ id: l.id ?? null, path: l.path, nome: l.nome, tamanho: l.tamanho, descricao: l.descricao ?? null }));
  }
  if (c?.cct_arquivo_path) {
    return [{ id: null, path: c.cct_arquivo_path, nome: c.cct_arquivo_nome ?? null, tamanho: c.cct_arquivo_tamanho ?? null, descricao: null }];
  }
  return [];
}

const descricaoLimpa = (s: string | null | undefined) => (s ?? "").trim() || null;

/** O que gravar para ir de `antes` (o banco) para `depois` (a tela, com os arquivos novos já enviados). */
export function planoAnexos(antes: AnexoLista[], depois: AnexoLista[]) {
  const ficam = new Set(depois.map((a) => a.path).filter(Boolean) as string[]);
  const gravados = new Map(antes.filter((a) => a.id && a.path).map((a) => [a.path as string, a]));
  return {
    /** Linhas novas: arquivo novo, ou o anexo antigo que ainda não era linha. */
    inserir: depois.filter((a) => a.path && !gravados.has(a.path))
      .map((a) => ({ path: a.path as string, nome: a.nome, tamanho: a.tamanho, descricao: descricaoLimpa(a.descricao) })),
    /** Descrição trocada. */
    atualizar: depois
      .filter((a) => a.path && gravados.has(a.path) && descricaoLimpa(gravados.get(a.path)!.descricao) !== descricaoLimpa(a.descricao))
      .map((a) => ({ id: gravados.get(a.path as string)!.id as string, descricao: descricaoLimpa(a.descricao) })),
    /** Linhas que saem (sem id não há linha). */
    removerLinhas: antes.filter((a) => a.id && a.path && !ficam.has(a.path)).map((a) => a.id as string),
    /** Arquivos que saem do storage. */
    removerArquivos: [...new Set(antes.filter((a) => a.path && !ficam.has(a.path)).map((a) => a.path as string))],
  };
}

/** Espelho do primeiro anexo nas colunas cct_arquivo_* da convenção. */
export function espelhoAnexoPrincipal(lista: AnexoLista[]) {
  const p = lista.find((a) => a.path);
  return { cct_arquivo_path: p?.path ?? null, cct_arquivo_nome: p?.nome ?? null, cct_arquivo_tamanho: p?.tamanho ?? null };
}

// ── Convenção do CONTRATO (13/11/2026, mig 20261113100500) ────────────────
//
// Pedido do Pablo: vinculada a convenção no contrato, TODOS os benefícios
// dos postos dele vêm dela — no Quadro de Postos do contrato e na
// Solicitação de Vaga. O posto não edita: mudar um valor é no cadastro da
// convenção (a tela avisa e leva até lá).

/** O que um posto herda da convenção, nos campos de texto do formulário. */
export interface HerancaConvencao {
  /** "Vale-Alimentação (VA): R$ 30,00 / dia · …" — o que vai para a vaga. */
  beneficios: string;
  /** "20" / "" — o campo "Insalubridade (%)" do posto. */
  insalubridade_pct: string;
  periculosidade_pct: string;
}

/**
 * Referência vinculada → campos do posto. Benefício "Não contém" e pendente
 * ficam de fora do texto (a pendência aparece no quadro, não na vaga).
 * Sem vínculo: null (o posto continua preenchido à mão / pela planilha).
 */
export function herancaDaConvencao(r: RespostaReferencia | null | undefined): HerancaConvencao | null {
  if (!r || r.status !== "vinculado") return null;
  const q = montarQuadro(r);
  const pctDe = (chave: ChaveBeneficio): string => {
    const i = q.itens.find((x) => x.def.chave === chave);
    const v = i?.referencia?.beneficios?.[chave];
    if (!i?.texto || !v || v.nao_contem) return "";
    return percentualTexto(v.percentual);
  };
  return {
    beneficios: q.itens.filter((i) => i.texto && !i.naoContem).map((i) => `${i.def.nome}: ${i.texto}`).join(" · "),
    insalubridade_pct: pctDe("insalubridade"),
    periculosidade_pct: pctDe("periculosidade"),
  };
}

/** Link do cadastro da convenção (abre já em edição). */
export const urlEditarConvencao = (id: string) => `/app/licitacoes/convencoes?editar=${id}`;
