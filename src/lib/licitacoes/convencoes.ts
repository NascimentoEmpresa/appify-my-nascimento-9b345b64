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
  if (vazio(c.empresa_id)) p.push("Empresa não informada");
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
    if (!texto && def.chave === "vt" && !ref.decreto_numero) pendencias.push(`${def.nome}: o posto não tem decreto municipal para o VT — vincule na Planilha de Custo.`);
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
