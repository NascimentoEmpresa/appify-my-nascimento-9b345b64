// =====================================================================
// Sistemas › CHECKLIST DE MÓDULOS — as regras (02/10/2026, migs 291/292)
//
// Tudo que a tela "Controle de Efetividade dos Módulos"
// (src/pages/sistemas/checklist/*) mostra e calcula sai daqui — testado em
// src/test/checklist-modulos.test.ts. O catálogo vem do banco: módulos
// (app_modulo) e telas/submódulos (app_menu com rota). Tudo começa
// "pendente de preenchimento"; o gerente de sistemas preenche.
//
// STATUS DO MÓDULO: o que o gerente marcou no próprio módulo (linha do
// checklist com menu_id NULL). Etapa que ele deixou vazia é CALCULADA pelas
// telas (ver derivar*): todas prontas → Pronto; alguma em desenvolvimento →
// Em desenvolvimento; e assim por diante.
//
// EFETIVIDADE = média das três etapas do painel (as colunas do modelo):
//   desenvolvimento  pronto 1 · homologação 0,75 · em desenvolvimento 0,4 · não iniciado 0
//   treinamento      treinado 1 · agendado 0,3 · pendente 0 · "não se aplica" sai da média
//   validação        validado 1 · em validação 0,5 · não validado/reprovado 0
// Implantação é registrada e mostrada na janela do módulo, mas não entra no %.
// Sem nenhuma etapa preenchida (nem calculável), a efetividade é "—".
// =====================================================================

export type StatusDev = "nao_iniciado" | "em_desenvolvimento" | "em_homologacao" | "pronto";
export type StatusImplantacao = "nao_implantado" | "em_implantacao" | "implantado";
export type StatusTreinamento = "pendente" | "agendado" | "treinado" | "nao_se_aplica";
export type StatusValidacao = "pendente" | "em_validacao" | "validado" | "reprovado";
export type Etapa = "dev" | "implantacao" | "treinamento" | "validacao";

/** ok verde · andamento laranja · atencao amarelo · progresso azul · risco vermelho · neutro cinza · pendente tracejado. */
export type Tom = "ok" | "andamento" | "atencao" | "progresso" | "risco" | "neutro" | "pendente";

export interface OpcaoStatus<T extends string> { valor: T; rotulo: string; tom: Tom; peso: number | null }

export const OPCOES_DEV: OpcaoStatus<StatusDev>[] = [
  { valor: "pronto", rotulo: "Pronto", tom: "ok", peso: 1 },
  { valor: "em_homologacao", rotulo: "Em homologação", tom: "atencao", peso: 0.75 },
  { valor: "em_desenvolvimento", rotulo: "Em desenvolvimento", tom: "andamento", peso: 0.4 },
  { valor: "nao_iniciado", rotulo: "Não iniciado", tom: "neutro", peso: 0 },
];
export const OPCOES_IMPLANTACAO: OpcaoStatus<StatusImplantacao>[] = [
  { valor: "implantado", rotulo: "Implantado", tom: "ok", peso: null },
  { valor: "em_implantacao", rotulo: "Em implantação", tom: "andamento", peso: null },
  { valor: "nao_implantado", rotulo: "Não implantado", tom: "neutro", peso: null },
];
export const OPCOES_TREINAMENTO: OpcaoStatus<StatusTreinamento>[] = [
  { valor: "treinado", rotulo: "Treinado", tom: "ok", peso: 1 },
  { valor: "agendado", rotulo: "Agendado", tom: "progresso", peso: 0.3 },
  { valor: "pendente", rotulo: "Pendente", tom: "andamento", peso: 0 },
  { valor: "nao_se_aplica", rotulo: "Não se aplica", tom: "neutro", peso: null },
];
export const OPCOES_VALIDACAO: OpcaoStatus<StatusValidacao>[] = [
  { valor: "validado", rotulo: "Validado", tom: "ok", peso: 1 },
  { valor: "em_validacao", rotulo: "Em validação", tom: "progresso", peso: 0.5 },
  { valor: "pendente", rotulo: "Não validado", tom: "risco", peso: 0 },
  { valor: "reprovado", rotulo: "Reprovado", tom: "risco", peso: 0 },
];

export const ETAPAS: { chave: Etapa; campo: "status_dev" | "status_implantacao" | "status_treinamento" | "status_validacao"; titulo: string; opcoes: OpcaoStatus<string>[]; noPercentual: boolean }[] = [
  { chave: "dev", campo: "status_dev", titulo: "Desenvolvimento", opcoes: OPCOES_DEV, noPercentual: true },
  { chave: "implantacao", campo: "status_implantacao", titulo: "Implantação", opcoes: OPCOES_IMPLANTACAO, noPercentual: false },
  { chave: "treinamento", campo: "status_treinamento", titulo: "Treinamento", opcoes: OPCOES_TREINAMENTO, noPercentual: true },
  { chave: "validacao", campo: "status_validacao", titulo: "Validação do usuário", opcoes: OPCOES_VALIDACAO, noPercentual: true },
];

export const ROTULO_PENDENTE = "Pendente de preenchimento";

export function opcaoDe(etapa: Etapa, valor: string | null | undefined): OpcaoStatus<string> | null {
  if (!valor) return null;
  return ETAPAS.find((e) => e.chave === etapa)!.opcoes.find((o) => o.valor === valor) ?? null;
}

// ── Área do módulo ───────────────────────────────────────────────────────

/** Setor dono de cada módulo, quando o gerente não escreveu outro (SIS_CHECKLIST.area). */
export const AREA_PADRAO: Record<string, string> = {
  presidencia: "Diretoria", diretoria: "Diretoria", organograma: "Recursos Humanos",
  licitacoes: "Comercial", contratos: "Comercial", controladoria: "Controladoria", financeiro: "Financeiro",
  contabil: "Contábil", fiscal: "Fiscal", suprimentos: "Suprimentos", rh: "Recursos Humanos",
  recrutamento: "Recursos Humanos", treinamentos: "Recursos Humanos", sst: "Segurança do Trabalho",
  juridico: "Jurídico", comite_etica: "Jurídico", plano_acoes: "Planejamento", bi: "BI & Analytics",
  admin: "Sistemas", sistemas: "Sistemas", ti: "Sistemas", encarregados: "Operacional", operacional: "Operacional",
  central_servicos: "Central de Serviços", whatsapp: "Comunicação", malote: "Logística",
};

// ── Dados (como a RPC sis_checklist_dados devolve) ──────────────────────

export interface ModuloCat {
  id: string; codigo: string; nome: string; ordem: number | null; ativo: boolean;
  /** Pessoas distintas com acesso a alguma tela do módulo / que usaram nos últimos 30 dias. */
  com_acesso: number; ativos_30d: number;
}
export interface TelaCat {
  id: string; modulo_id: string; codigo: string; nome: string; rota: string; ordem: number | null; ativo: boolean;
  com_acesso: number; ativos_30d: number; acessos_30d: number; ultimo_uso: string | null;
}
export interface ChecklistItem {
  id: string; modulo_id: string; menu_id: string | null;
  status_dev: StatusDev | null; status_implantacao: StatusImplantacao | null;
  status_treinamento: StatusTreinamento | null; status_validacao: StatusValidacao | null;
  responsavel_id: string | null; usuario_chave_id: string | null;
  previsao_entrega: string | null; data_implantacao: string | null; data_treinamento: string | null; data_validacao: string | null;
  observacoes: string | null; area?: string | null; atualizado_por: string | null; atualizado_em: string;
}
export interface BugResumo { modulo_id: string; menu_id: string | null; status: StatusBug; severidade: Severidade }
export interface ChamadosModulo { modulo: string | null; abertos: number; total: number }
export interface Historico {
  id: number; checklist_id: string | null; modulo_id: string | null; menu_id: string | null;
  campo: string; de: string | null; para: string | null; usuario_nome: string | null; created_at: string;
}
export interface UsuarioCat { id: string; nome: string; email: string | null }
export interface DadosChecklist {
  modulos: ModuloCat[]; telas: TelaCat[]; checklist: ChecklistItem[]; bugs: BugResumo[];
  chamados: ChamadosModulo[]; treinados: { modulo_id: string; menu_id: string | null; qtd: number }[];
  historico: Historico[]; usuarios: UsuarioCat[];
  uso_total_30d: { usuarios: number; acessos: number } | null; uso_desde: string | null;
}

// ── Bugs ─────────────────────────────────────────────────────────────────

export type StatusBug = "aberto" | "em_analise" | "encaminhado" | "resolvido" | "descartado";
export type Severidade = "baixa" | "media" | "alta" | "critica";
export const STATUS_BUG: { valor: StatusBug; rotulo: string; tom: Tom }[] = [
  { valor: "aberto", rotulo: "Aberto", tom: "risco" },
  { valor: "em_analise", rotulo: "Em análise", tom: "atencao" },
  { valor: "encaminhado", rotulo: "Encaminhado (chamado)", tom: "progresso" },
  { valor: "resolvido", rotulo: "Resolvido", tom: "ok" },
  { valor: "descartado", rotulo: "Descartado", tom: "neutro" },
];
export const SEVERIDADES: { valor: Severidade; rotulo: string; tom: Tom }[] = [
  { valor: "critica", rotulo: "Crítica", tom: "risco" },
  { valor: "alta", rotulo: "Alta", tom: "risco" },
  { valor: "media", rotulo: "Média", tom: "atencao" },
  { valor: "baixa", rotulo: "Baixa", tom: "neutro" },
];
export const bugAberto = (s: StatusBug) => s === "aberto" || s === "em_analise" || s === "encaminhado";
export const rotuloStatusBug = (s: string) => STATUS_BUG.find((x) => x.valor === s)?.rotulo ?? s;
export const rotuloSeveridade = (s: string) => SEVERIDADES.find((x) => x.valor === s)?.rotulo ?? s;

// ── Status e efetividade ─────────────────────────────────────────────────

export interface Status4 {
  status_dev: StatusDev | null; status_implantacao: StatusImplantacao | null;
  status_treinamento: StatusTreinamento | null; status_validacao: StatusValidacao | null;
}

/** Algum status foi preenchido? (responsável/observação sozinhos não contam.) */
export const preenchido = (c: Partial<Status4> | null | undefined) =>
  !!c && !!(c.status_dev || c.status_implantacao || c.status_treinamento || c.status_validacao);

/** Alguma etapa que ENTRA no percentual está preenchida? */
const temPercentual = (c: Partial<Status4> | null | undefined) =>
  !!c && !!(c.status_dev || c.status_treinamento || c.status_validacao);

/** 0–1 sobre desenvolvimento, treinamento e validação; null = nada para medir. */
export function efetividade(c: Partial<Status4> | null | undefined): number | null {
  if (!temPercentual(c)) return null;
  const pesos: number[] = [];
  for (const e of ETAPAS) {
    if (!e.noPercentual) continue;
    const o = opcaoDe(e.chave, c?.[e.campo] as string | null | undefined);
    if (o && o.peso == null) continue;   // "não se aplica"
    pesos.push(o?.peso ?? 0);
  }
  return pesos.length ? pesos.reduce((a, b) => a + b, 0) / pesos.length : null;
}

/** Status do módulo pelas telas ATIVAS, etapa a etapa (null = nenhuma tela preenchida nessa etapa). */
export function derivarDev(vals: (StatusDev | null)[]): StatusDev | null {
  const v = vals.filter((x): x is StatusDev => !!x);
  if (!v.length) return null;
  if (v.length === vals.length && v.every((x) => x === "pronto")) return "pronto";
  if (v.includes("em_desenvolvimento")) return "em_desenvolvimento";
  if (v.includes("em_homologacao")) return "em_homologacao";
  if (v.includes("pronto")) return "em_desenvolvimento";   // parte pronta, parte por fazer
  return "nao_iniciado";
}
export function derivarImplantacao(vals: (StatusImplantacao | null)[]): StatusImplantacao | null {
  const v = vals.filter((x): x is StatusImplantacao => !!x);
  if (!v.length) return null;
  if (v.length === vals.length && v.every((x) => x === "implantado")) return "implantado";
  if (v.some((x) => x === "implantado" || x === "em_implantacao")) return "em_implantacao";
  return "nao_implantado";
}
export function derivarTreinamento(vals: (StatusTreinamento | null)[]): StatusTreinamento | null {
  const v = vals.filter((x): x is StatusTreinamento => !!x);
  if (!v.length) return null;
  if (v.every((x) => x === "nao_se_aplica")) return "nao_se_aplica";
  if (v.length === vals.length && v.every((x) => x === "treinado" || x === "nao_se_aplica")) return "treinado";
  if (v.includes("agendado")) return "agendado";
  return "pendente";
}
export function derivarValidacao(vals: (StatusValidacao | null)[]): StatusValidacao | null {
  const v = vals.filter((x): x is StatusValidacao => !!x);
  if (!v.length) return null;
  if (v.length === vals.length && v.every((x) => x === "validado")) return "validado";
  if (v.includes("reprovado")) return "reprovado";
  if (v.some((x) => x === "em_validacao" || x === "validado")) return "em_validacao";
  return "pendente";
}

// ── Linhas ───────────────────────────────────────────────────────────────

export interface LinhaTela {
  tela: TelaCat;
  item: ChecklistItem | null;
  preenchido: boolean;
  efetividade: number | null;
  bugsAbertos: number;
  treinados: number;
  /** usuários ativos em 30 dias ÷ usuários com acesso (null = ninguém com acesso). */
  adocao: number | null;
}

export interface LinhaModulo {
  modulo: ModuloCat;
  item: ChecklistItem | null;             // a linha do próprio módulo
  area: string;
  /** Status efetivo do módulo: o marcado no módulo, ou o calculado pelas telas. */
  status: Status4;
  /** Etapas cujo status veio das telas (não foi marcado no módulo). */
  calculado: Record<Etapa, boolean>;
  efetividade: number | null;
  responsavelId: string | null;
  usuarioChaveId: string | null;
  ultimaAtualizacao: string | null;
  telas: LinhaTela[];
  ativas: number;
  preenchidas: number;
  bugsAbertos: number;
  chamadosAbertos: number;
  comAcesso: number;
  ativos30d: number;
  acessos30d: number;
}

const maisFrequente = (xs: (string | null | undefined)[]) => {
  const m = new Map<string, number>();
  xs.forEach((x) => { if (x) m.set(x, (m.get(x) ?? 0) + 1); });
  return [...m.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
};

export function montarModulos(d: Pick<DadosChecklist, "modulos" | "telas" | "checklist" | "bugs" | "chamados" | "treinados">): LinhaModulo[] {
  const itemTela = new Map<string, ChecklistItem>();
  const itemModulo = new Map<string, ChecklistItem>();
  for (const c of d.checklist) {
    if (c.menu_id) itemTela.set(c.menu_id, c); else itemModulo.set(c.modulo_id, c);
  }
  const bugsTela = new Map<string, number>();
  const bugsModulo = new Map<string, number>();
  for (const b of d.bugs) {
    if (!bugAberto(b.status)) continue;
    bugsModulo.set(b.modulo_id, (bugsModulo.get(b.modulo_id) ?? 0) + 1);
    if (b.menu_id) bugsTela.set(b.menu_id, (bugsTela.get(b.menu_id) ?? 0) + 1);
  }
  const treinTela = new Map<string, number>();
  for (const t of d.treinados) if (t.menu_id) treinTela.set(t.menu_id, t.qtd);
  const chamados = new Map(d.chamados.map((c) => [c.modulo ?? "", c.abertos]));

  return d.modulos.map((m) => {
    const telas = d.telas
      .filter((t) => t.modulo_id === m.id)
      .map((t): LinhaTela => {
        const item = itemTela.get(t.id) ?? null;
        return {
          tela: t, item, preenchido: preenchido(item), efetividade: efetividade(item),
          bugsAbertos: bugsTela.get(t.id) ?? 0, treinados: treinTela.get(t.id) ?? 0,
          adocao: t.com_acesso > 0 ? Math.min(1, t.ativos_30d / t.com_acesso) : null,
        };
      })
      .sort((a, b) => Number(b.tela.ativo) - Number(a.tela.ativo) || (a.tela.ordem ?? 999) - (b.tela.ordem ?? 999) || a.tela.nome.localeCompare(b.tela.nome));
    const ativas = telas.filter((t) => t.tela.ativo);
    const item = itemModulo.get(m.id) ?? null;
    const de = <K extends keyof Status4>(k: K) => ativas.map((t) => (t.item?.[k] ?? null) as Status4[K]);
    const calc: Status4 = {
      status_dev: derivarDev(de("status_dev")),
      status_implantacao: derivarImplantacao(de("status_implantacao")),
      status_treinamento: derivarTreinamento(de("status_treinamento")),
      status_validacao: derivarValidacao(de("status_validacao")),
    };
    const status: Status4 = {
      status_dev: item?.status_dev ?? calc.status_dev,
      status_implantacao: item?.status_implantacao ?? calc.status_implantacao,
      status_treinamento: item?.status_treinamento ?? calc.status_treinamento,
      status_validacao: item?.status_validacao ?? calc.status_validacao,
    };
    const datas = [item?.atualizado_em, ...ativas.map((t) => t.item?.atualizado_em)].filter((x): x is string => !!x).sort();
    return {
      modulo: m,
      item,
      area: (item?.area ?? "").trim() || AREA_PADRAO[m.codigo] || m.nome,
      status,
      calculado: {
        dev: !item?.status_dev && !!calc.status_dev,
        implantacao: !item?.status_implantacao && !!calc.status_implantacao,
        treinamento: !item?.status_treinamento && !!calc.status_treinamento,
        validacao: !item?.status_validacao && !!calc.status_validacao,
      },
      efetividade: efetividade(status),
      responsavelId: item?.responsavel_id ?? maisFrequente(ativas.map((t) => t.item?.responsavel_id)),
      usuarioChaveId: item?.usuario_chave_id ?? maisFrequente(ativas.map((t) => t.item?.usuario_chave_id)),
      ultimaAtualizacao: datas.pop() ?? null,
      telas,
      ativas: ativas.length,
      preenchidas: ativas.filter((t) => t.preenchido).length,
      bugsAbertos: bugsModulo.get(m.id) ?? 0,
      chamadosAbertos: chamados.get(m.codigo) ?? 0,
      comAcesso: m.com_acesso ?? 0,
      ativos30d: m.ativos_30d ?? 0,
      acessos30d: ativas.reduce((s, t) => s + t.tela.acessos_30d, 0),
    };
  });
}

// ── Filtros e ordem (lista de módulos) ───────────────────────────────────

export interface FiltrosChecklist {
  area: string;
  dev: "" | StatusDev | "pendente";
  treinamento: "" | StatusTreinamento | "sem";
  validacao: "" | StatusValidacao | "sem";
  responsavel: string;
  busca: string;
}
export const FILTROS_VAZIOS: FiltrosChecklist = { area: "", dev: "", treinamento: "", validacao: "", responsavel: "", busca: "" };

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export function filtrarModulos(mods: LinhaModulo[], f: FiltrosChecklist): LinhaModulo[] {
  const q = norm(f.busca.trim());
  return mods.filter((m) =>
    m.modulo.ativo
    && (!f.area || m.area === f.area)
    && (!f.dev || (m.status.status_dev ?? "pendente") === f.dev)
    && (!f.treinamento || (m.status.status_treinamento ?? "sem") === f.treinamento)
    && (!f.validacao || (m.status.status_validacao ?? "sem") === f.validacao)
    && (!f.responsavel || m.responsavelId === f.responsavel)
    && (!q || [m.modulo.nome, m.area, ...m.telas.map((t) => t.tela.nome)].some((x) => norm(x).includes(q))));
}

export type ColunaOrdem = "ordem" | "dev" | "validacao" | "atualizacao";
const ORDEM_DEV_VAL: Record<string, number> = { pronto: 0, em_homologacao: 1, em_desenvolvimento: 2, nao_iniciado: 3 };
const ORDEM_VAL_VAL: Record<string, number> = { validado: 0, em_validacao: 1, pendente: 2, reprovado: 3 };
export function ordenarModulos(mods: LinhaModulo[], col: ColunaOrdem, asc: boolean): LinhaModulo[] {
  const k = (m: LinhaModulo): number | string => {
    if (col === "dev") return ORDEM_DEV_VAL[m.status.status_dev ?? ""] ?? 9;
    if (col === "validacao") return ORDEM_VAL_VAL[m.status.status_validacao ?? ""] ?? 9;
    if (col === "atualizacao") return m.ultimaAtualizacao ?? "";
    return m.modulo.ordem ?? 999;
  };
  const r = [...mods].sort((a, b) => {
    const x = k(a), y = k(b);
    const c = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y));
    return c || a.modulo.nome.localeCompare(b.modulo.nome);
  });
  return asc ? r : r.reverse();
}

// ── Indicadores e o mês anterior ─────────────────────────────────────────

export interface Indicadores {
  modulos: number; prontos: number; emDesenvolvimento: number; treinados: number; validados: number;
  efetividade: number | null; preenchidos: number;
  porDev: Record<StatusDev | "pendente", number>;
}

export function indicadores(mods: LinhaModulo[]): Indicadores {
  const ativos = mods.filter((m) => m.modulo.ativo);
  const porDev: Record<StatusDev | "pendente", number> = { pronto: 0, em_homologacao: 0, em_desenvolvimento: 0, nao_iniciado: 0, pendente: 0 };
  ativos.forEach((m) => { porDev[m.status.status_dev ?? "pendente"] += 1; });
  const efs = ativos.map((m) => m.efetividade).filter((x): x is number => x != null);
  return {
    modulos: ativos.length,
    prontos: porDev.pronto,
    emDesenvolvimento: porDev.em_desenvolvimento + porDev.em_homologacao,
    treinados: ativos.filter((m) => m.status.status_treinamento === "treinado").length,
    validados: ativos.filter((m) => m.status.status_validacao === "validado").length,
    // Módulo sem nada para medir conta 0 no geral (senão 1 módulo pronto e
    // 24 sem preencher dariam 100%).
    efetividade: ativos.length && efs.length ? ativos.reduce((s, m) => s + (m.efetividade ?? 0), 0) / ativos.length : null,
    preenchidos: ativos.filter((m) => preenchido(m.status)).length,
    porDev,
  };
}

const CAMPOS_STATUS = ["status_dev", "status_implantacao", "status_treinamento", "status_validacao"] as const;

/**
 * O checklist como estava em `ate` (ISO), refeito pelo histórico: cada
 * status vale o último "para" gravado até lá; linha criada depois some.
 * É o que dá o "vs. mês anterior" dos indicadores.
 */
export function checklistEm(checklist: ChecklistItem[], historico: Pick<Historico, "checklist_id" | "campo" | "para" | "created_at">[], ate: string): ChecklistItem[] {
  const ultimo = new Map<string, string | null>();
  const existia = new Set<string>();
  const ordenado = [...historico].filter((h) => h.created_at <= ate).sort((a, b) => a.created_at.localeCompare(b.created_at));
  for (const h of ordenado) {
    if (!h.checklist_id) continue;
    existia.add(h.checklist_id);
    if ((CAMPOS_STATUS as readonly string[]).includes(h.campo)) ultimo.set(`${h.checklist_id}|${h.campo}`, h.para);
  }
  return checklist
    .filter((c) => existia.has(c.id))
    .map((c) => {
      const r = { ...c };
      for (const k of CAMPOS_STATUS) {
        const chave = `${c.id}|${k}`;
        (r as Record<string, unknown>)[k] = ultimo.has(chave) ? ultimo.get(chave) : null;
      }
      return r;
    });
}

export interface Variacao { texto: string; sentido: "sobe" | "desce" | "igual"; bom: boolean | null }

/** "+12%" (relativo) ou "+2" (quando não havia base), e se a mudança é boa. */
export function variacao(atual: number, anterior: number, maisEhMelhor: boolean): Variacao {
  const d = atual - anterior;
  if (d === 0) return { texto: "0", sentido: "igual", bom: null };
  const sinal = d > 0 ? "+" : "−";
  const texto = anterior > 0 ? `${sinal}${Math.round(Math.abs(d) / anterior * 100)}%` : `${sinal}${Math.abs(d)}`;
  return { texto, sentido: d > 0 ? "sobe" : "desce", bom: d > 0 ? maisEhMelhor : !maisEhMelhor };
}
/** Diferença em pontos percentuais (efetividade): "+8,4 p.p.". */
export function variacaoPP(atual: number | null, anterior: number | null): Variacao {
  const d = ((atual ?? 0) - (anterior ?? 0)) * 100;
  if (Math.abs(d) < 0.05) return { texto: "0 p.p.", sentido: "igual", bom: null };
  return { texto: `${d > 0 ? "+" : "−"}${Math.abs(d).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} p.p.`, sentido: d > 0 ? "sobe" : "desce", bom: d > 0 };
}

/** Primeiro instante do mês corrente (ISO) — o "mês anterior" é o estado até aqui. */
export const inicioDoMes = (agora = new Date()) => new Date(agora.getFullYear(), agora.getMonth(), 1).toISOString();

// ── Análises adicionais ──────────────────────────────────────────────────

/** Módulos que ainda não foram treinados (pendente, agendado ou sem preenchimento). */
export const modulosSemTreinamento = (mods: LinhaModulo[]) =>
  mods.filter((m) => m.modulo.ativo && m.status.status_treinamento !== "treinado" && m.status.status_treinamento !== "nao_se_aplica");

/** Prontos que o usuário ainda não validou. */
export const prontosSemValidacao = (mods: LinhaModulo[]) =>
  mods.filter((m) => m.modulo.ativo && m.status.status_dev === "pronto" && m.status.status_validacao !== "validado");

/** Por área: módulos e quantas pendências (etapa do % que não está concluída). */
export function rankingAreas(mods: LinhaModulo[]) {
  const m = new Map<string, { area: string; modulos: number; pendencias: number; efetividade: number }>();
  for (const x of mods.filter((y) => y.modulo.ativo)) {
    const r = m.get(x.area) ?? { area: x.area, modulos: 0, pendencias: 0, efetividade: 0 };
    r.modulos += 1;
    r.efetividade += x.efetividade ?? 0;
    if (x.status.status_dev !== "pronto") r.pendencias += 1;
    if (x.status.status_treinamento !== "treinado" && x.status.status_treinamento !== "nao_se_aplica") r.pendencias += 1;
    if (x.status.status_validacao !== "validado") r.pendencias += 1;
    m.set(x.area, r);
  }
  return [...m.values()].map((r) => ({ ...r, efetividade: r.modulos ? r.efetividade / r.modulos : 0 }))
    .sort((a, b) => b.pendencias - a.pendencias || a.area.localeCompare(b.area));
}

/** Últimos N meses: quantas vezes algo virou Pronto / Treinado / Validado (módulos e telas). */
export function evolucaoEntregas(historico: Pick<Historico, "campo" | "para" | "created_at">[], meses = 6, agora = new Date()) {
  const lista: { mes: string; rotulo: string; prontos: number; treinados: number; validados: number }[] = [];
  for (let i = meses - 1; i >= 0; i--) {
    const d = new Date(agora.getFullYear(), agora.getMonth() - i, 1);
    const mes = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    lista.push({ mes, rotulo: `${["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"][d.getMonth()]}/${String(d.getFullYear()).slice(2)}`, prontos: 0, treinados: 0, validados: 0 });
  }
  const porMes = new Map(lista.map((x) => [x.mes, x]));
  for (const h of historico) {
    const x = porMes.get(new Date(h.created_at).toISOString().slice(0, 7));
    if (!x) continue;
    if (h.campo === "status_dev" && h.para === "pronto") x.prontos += 1;
    if (h.campo === "status_treinamento" && h.para === "treinado") x.treinados += 1;
    if (h.campo === "status_validacao" && h.para === "validado") x.validados += 1;
  }
  return lista;
}

/** Por usuário-chave: quantos módulos/telas estão com ele e quantos ele já validou. */
export function aderenciaUsuarioChave(mods: LinhaModulo[]) {
  const m = new Map<string, { userId: string; itens: number; validados: number; emValidacao: number }>();
  const somar = (uid: string | null | undefined, v: StatusValidacao | null | undefined) => {
    if (!uid) return;
    const r = m.get(uid) ?? { userId: uid, itens: 0, validados: 0, emValidacao: 0 };
    r.itens += 1;
    if (v === "validado") r.validados += 1;
    if (v === "em_validacao") r.emValidacao += 1;
    m.set(uid, r);
  };
  for (const x of mods.filter((y) => y.modulo.ativo)) {
    if (x.item?.usuario_chave_id) somar(x.item.usuario_chave_id, x.status.status_validacao);
    for (const t of x.telas) if (t.tela.ativo && t.item?.usuario_chave_id) somar(t.item.usuario_chave_id, t.item.status_validacao);
  }
  return [...m.values()].map((r) => ({ ...r, taxa: r.itens ? r.validados / r.itens : 0 })).sort((a, b) => b.itens - a.itens);
}

// ── Texto ────────────────────────────────────────────────────────────────

export const pct = (x: number | null | undefined) => (x == null ? "—" : `${Math.round(x * 100)}%`);
export const pct1 = (x: number | null | undefined) =>
  x == null ? "—" : `${(x * 100).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;

export const ROTULO_CAMPO: Record<string, string> = {
  status_dev: "Desenvolvimento", status_implantacao: "Implantação", status_treinamento: "Treinamento",
  status_validacao: "Validação", responsavel_id: "Responsável", usuario_chave_id: "Usuário-chave",
  previsao_entrega: "Previsão de entrega", data_implantacao: "Data de implantação", data_treinamento: "Data do treinamento",
  data_validacao: "Data da validação", observacoes: "Observações", area: "Área",
};

/** "pronto" → "Pronto" (qualquer etapa); data ISO → dd/mm/aaaa; resto como veio. */
export function rotuloValor(campo: string, v: string | null): string {
  if (v == null || v === "") return "—";
  const etapa = ETAPAS.find((e) => e.campo === campo);
  if (etapa) return etapa.opcoes.find((o) => o.valor === v)?.rotulo ?? v;
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v.split("-").reverse().join("/");
  return v;
}

export type TipoMovimentacao = "validado" | "treinamento" | "atualizado" | "atribuido" | "outro";

/** A frase das "Últimas movimentações": "Módulo Compras validado por Juliana Santos". */
export function fraseMovimentacao(h: Historico, nomeModulo: string, nomeTela: string | null): { tipo: TipoMovimentacao; texto: string; destaque: string } {
  const alvo = nomeTela ? `Tela ${nomeTela} (${nomeModulo})` : `Módulo ${nomeModulo}`;
  const destaque = nomeTela ?? nomeModulo;
  const por = h.usuario_nome ? ` por ${h.usuario_nome}` : "";
  if (h.campo === "status_validacao" && h.para === "validado") return { tipo: "validado", texto: `${alvo} validado${por}`, destaque };
  if (h.campo === "status_treinamento" && h.para === "agendado") return { tipo: "treinamento", texto: `${alvo} enviado para treinamento`, destaque };
  if (h.campo === "status_treinamento" && h.para === "treinado") return { tipo: "treinamento", texto: `${alvo} treinado${por}`, destaque };
  if (h.campo === "responsavel_id" || h.campo === "usuario_chave_id") {
    return { tipo: "atribuido", texto: h.para ? `${alvo} atribuído para ${h.para}${h.campo === "usuario_chave_id" ? " (usuário-chave)" : ""}` : `${alvo} ficou sem ${ROTULO_CAMPO[h.campo].toLowerCase()}`, destaque };
  }
  if (h.campo.startsWith("status_")) return { tipo: "atualizado", texto: `${alvo}: ${ROTULO_CAMPO[h.campo]} → ${rotuloValor(h.campo, h.para)}${por}`, destaque };
  return { tipo: "outro", texto: `${alvo}: ${ROTULO_CAMPO[h.campo] ?? h.campo} atualizado${por}`, destaque };
}

// ── Status de desenvolvimento no canto de TODA tela (02/10/2026) ─────────
// Vem da RPC sis_status_dev_telas (mig 20261002000003), legível por
// qualquer usuário logado. Vale o status da TELA; vazia, o do MÓDULO como o
// painel mostra (marcado no módulo ou calculado pelas telas ativas).

export interface StatusDevTelas {
  telas: { codigo: string; modulo_id: string; ativo: boolean; status_dev: StatusDev | null }[];
  modulos: { modulo_id: string; status_dev: StatusDev | null }[];
}
export type OrigemStatusDev = "tela" | "modulo" | "calculado" | "pendente";

export function statusDevDaTela(d: StatusDevTelas | null | undefined, menuCodigo: string | null): { status: StatusDev | null; origem: OrigemStatusDev } | null {
  if (!d || !menuCodigo) return null;
  const tela = d.telas.find((t) => t.codigo === menuCodigo);
  if (!tela) return null;
  if (tela.status_dev) return { status: tela.status_dev, origem: "tela" };
  const doModulo = d.modulos.find((m) => m.modulo_id === tela.modulo_id)?.status_dev ?? null;
  if (doModulo) return { status: doModulo, origem: "modulo" };
  const calc = derivarDev(d.telas.filter((t) => t.modulo_id === tela.modulo_id && t.ativo).map((t) => t.status_dev));
  return calc ? { status: calc, origem: "calculado" } : { status: null, origem: "pendente" };
}
