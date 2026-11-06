// SST › Controle de Afastamentos (mig 20261105030000) — as regras que a tela
// mostra: dias afastados, alertas de retorno, possível limbo previdenciário,
// pendências documentais e os indicadores do painel. A regra do status do ASO
// mora no banco (gatilho sst_ctrl_afa_regras), porque ela vale para qualquer
// escrita; aqui fica só o que é leitura.

export const STATUS = [
  "Afastado", "Auxílio-doença", "Licença-maternidade", "Aguardando retorno",
  "Aguardando ASO de retorno", "Retorno agendado", "Retornado", "Afastamento encerrado",
] as const;
export type StatusAfastamento = (typeof STATUS)[number];
export const STATUS_ASO: StatusAfastamento = "Aguardando ASO de retorno";
const STATUS_FIM: string[] = ["Retornado", "Afastamento encerrado"];

export const MOTIVOS = ["Auxílio-doença", "Acidente de trabalho", "Licença-maternidade", "Doença / atestado prolongado", "Outros"] as const;
export const COMUNICACOES = ["Aguardando", "Recebida", "Não se aplica"] as const;
export const RECURSO_SITUACOES = [
  { valor: "em_andamento", rotulo: "Em andamento" }, { valor: "deferido", rotulo: "Deferido" },
  { valor: "indeferido", rotulo: "Indeferido" }, { valor: "encerrado", rotulo: "Encerrado" },
] as const;
export const DOC_CATEGORIAS = [
  { valor: "atestado", rotulo: "Atestado" }, { valor: "inss", rotulo: "Documento do INSS" },
  { valor: "comunicacao_beneficio", rotulo: "Comunicação de Benefício" }, { valor: "aso_retorno", rotulo: "ASO de retorno" },
  { valor: "recurso_administrativo", rotulo: "Recurso administrativo" }, { valor: "judicial", rotulo: "Documento judicial" },
  { valor: "aposentadoria", rotulo: "Aposentadoria" },
] as const;
export type CategoriaDoc = (typeof DOC_CATEGORIAS)[number]["valor"];

/** Sem contato há mais que isso = sem acompanhamento recente. */
export const SEM_CONTATO_DIAS = 30;

export interface RecursoResumo { instancia: "inss" | "judicial"; situacao: string }

export interface ControleItem {
  id: number;
  empregado_id: number;
  nome: string;
  contrato_nome: string | null;
  filial_nome: string | null;
  funcao: string | null;
  motivo: string;
  data_inicio: string;
  data_prevista_retorno: string | null;
  data_retorno_real: string | null;
  encerrado_em: string | null;
  status: StatusAfastamento;
  ultimo_contato_em: string | null;
  ultimo_contato_obs: string | null;
  retorno_informado_em: string | null;
  comunicacao_beneficio: (typeof COMUNICACOES)[number];
  beneficio_encerrado_em: string | null;
  aposentado_afastado: boolean;
  aposentado_no_vinculo: boolean;
  aposentadoria_em: string | null;
  aso_necessario: boolean;
  aso_solicitado_em: string | null;
  aso_agendado_em: string | null;
  aso_clinica: string | null;
  aso_realizado: boolean;
  aso_recebido_em: string | null;
  aso_resultado: "apto" | "inapto" | null;
  observacao: string | null;
  origem: "manual" | "senior";
  senior_situacao: string | null;
  recursos: RecursoResumo[];
  doc_categorias: string[];
}

export const hojeIso = (d = new Date()): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export const fmtData = (iso?: string | null): string => (iso ? iso.slice(0, 10).split("-").reverse().join("/") : "—");

const diasEntre = (de: string, ate: string): number =>
  Math.round((Date.parse(`${ate.slice(0, 10)}T00:00:00Z`) - Date.parse(`${de.slice(0, 10)}T00:00:00Z`)) / 86400000);

export const estaAberto = (a: Pick<ControleItem, "status">): boolean => !STATUS_FIM.includes(a.status);

/** O status com que um caso novo nasce, pelo motivo escolhido. */
export const statusDoMotivo = (motivo: string): StatusAfastamento =>
  motivo === "Auxílio-doença" ? "Auxílio-doença" : motivo === "Licença-maternidade" ? "Licença-maternidade" : "Afastado";

/** Dias corridos, contando o primeiro. Encerrado para de contar. */
export function diasAfastados(a: Pick<ControleItem, "data_inicio" | "data_retorno_real" | "encerrado_em">, hoje = hojeIso()): number {
  // O dia do retorno já é trabalhado; o do encerramento ainda conta.
  const fim = a.data_retorno_real ? diasEntre(a.data_inicio, a.data_retorno_real) : diasEntre(a.data_inicio, a.encerrado_em ?? hoje) + 1;
  return Math.max(0, fim);
}

export type AlertaRetorno = "atingida" | "3d" | "7d";
export const ROTULO_ALERTA: Record<AlertaRetorno, string> = {
  atingida: "Data de retorno atingida", "3d": "Retorno em até 3 dias", "7d": "Retorno em até 7 dias",
};

/** Vale a data prevista; sem ela, a que o colaborador informou no contato. */
export const dataDoRetorno = (a: Pick<ControleItem, "data_prevista_retorno" | "retorno_informado_em">): string | null =>
  a.data_prevista_retorno ?? a.retorno_informado_em;

export function alertaRetorno(a: ControleItem, hoje = hojeIso()): AlertaRetorno | null {
  const data = dataDoRetorno(a);
  if (!estaAberto(a) || !data) return null;
  const faltam = diasEntre(hoje, data);
  return faltam <= 0 ? "atingida" : faltam <= 3 ? "3d" : faltam <= 7 ? "7d" : null;
}

export function semContatoRecente(a: Pick<ControleItem, "status" | "ultimo_contato_em">, hoje = hojeIso()): boolean {
  if (!estaAberto(a)) return false;
  return !a.ultimo_contato_em || diasEntre(a.ultimo_contato_em, hoje) > SEM_CONTATO_DIAS;
}

const recursoVivo = (a: Pick<ControleItem, "recursos">, instancia: RecursoResumo["instancia"]) =>
  a.recursos.some((r) => r.instancia === instancia && r.situacao !== "encerrado");
const recursoEmAndamento = (a: Pick<ControleItem, "recursos">, instancia: RecursoResumo["instancia"]) =>
  a.recursos.some((r) => r.instancia === instancia && r.situacao === "em_andamento");

/** Benefício encerrado e retorno não regularizado. Devolve o porquê, ou null. */
export function possivelLimbo(a: ControleItem, hoje = hojeIso()): string | null {
  if (!estaAberto(a) || !a.beneficio_encerrado_em || a.beneficio_encerrado_em > hoje) return null;
  const extras = [
    recursoEmAndamento(a, "inss") ? "recurso ao INSS em andamento" : "",
    recursoEmAndamento(a, "judicial") ? "ação judicial em andamento" : "",
  ].filter(Boolean);
  return `Benefício encerrado em ${fmtData(a.beneficio_encerrado_em)} e retorno não regularizado${extras.length ? `, com ${extras.join(" e ")}` : ""}.`;
}

/** O que o caso diz que existe e não tem documento anexado. */
export function pendenciasDocumentais(a: ControleItem): string[] {
  if (a.status === "Afastamento encerrado") return [];
  const tem = (c: CategoriaDoc) => a.doc_categorias.includes(c);
  const faltam: string[] = [];
  if (!tem("atestado") && !tem("inss")) faltam.push("Atestado ou documento do INSS");
  if (a.comunicacao_beneficio === "Recebida" && !tem("comunicacao_beneficio")) faltam.push("Comunicação de Benefício");
  if (a.aso_realizado && !tem("aso_retorno")) faltam.push("ASO de retorno");
  if (a.recursos.some((r) => r.instancia === "inss") && !tem("recurso_administrativo")) faltam.push("Documentos do recurso administrativo");
  if (a.recursos.some((r) => r.instancia === "judicial") && !tem("judicial")) faltam.push("Documentos judiciais");
  if ((a.aposentado_afastado || a.aposentado_no_vinculo) && !tem("aposentadoria")) faltam.push("Documentos da aposentadoria");
  return faltam;
}

export const INDICADORES = [
  { chave: "afastados", titulo: "Total de afastados", filtro: (a: ControleItem) => estaAberto(a) },
  { chave: "retornos", titulo: "Retornos próximos", filtro: (a: ControleItem, h: string) => alertaRetorno(a, h) !== null },
  { chave: "aso", titulo: "Aguardando ASO", filtro: (a: ControleItem) => a.status === STATUS_ASO },
  { chave: "comunicacao", titulo: "Aguardando Comunicação de Benefício", filtro: (a: ControleItem) => estaAberto(a) && a.comunicacao_beneficio === "Aguardando" },
  { chave: "aposentados", titulo: "Aposentados afastados", filtro: (a: ControleItem) => estaAberto(a) && a.aposentado_afastado },
  // Quem se aposentou segue no vínculo depois de voltar: só sai quando o caso é encerrado.
  { chave: "aposentados_vinculo", titulo: "Aposentados durante o vínculo", filtro: (a: ControleItem) => a.status !== "Afastamento encerrado" && a.aposentado_no_vinculo },
  { chave: "inss", titulo: "Recursos ao INSS", filtro: (a: ControleItem) => estaAberto(a) && recursoVivo(a, "inss") },
  { chave: "judicial", titulo: "Recursos judiciais", filtro: (a: ControleItem) => estaAberto(a) && recursoVivo(a, "judicial") },
  { chave: "limbo", titulo: "Possíveis situações de limbo", filtro: (a: ControleItem, h: string) => possivelLimbo(a, h) !== null },
  { chave: "documentos", titulo: "Pendências documentais", filtro: (a: ControleItem) => pendenciasDocumentais(a).length > 0 },
] as const;
export type ChaveIndicador = (typeof INDICADORES)[number]["chave"];

/** Quanto menor, mais em cima: limbo, depois retorno pela urgência. */
export function prioridade(a: ControleItem, hoje = hojeIso()): number {
  if (!estaAberto(a)) return 9;
  if (possivelLimbo(a, hoje)) return 0;
  const al = alertaRetorno(a, hoje);
  if (al === "atingida") return 1;
  if (al === "3d") return 2;
  if (al === "7d") return 3;
  return semContatoRecente(a, hoje) ? 4 : 5;
}
