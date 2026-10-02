// =====================================================================
// Sistemas › CHECKLIST DE MÓDULOS — as regras (02/10/2026, mig 291)
//
// Tudo que a tela src/pages/sistemas/checklist/* mostra e calcula sai daqui
// (testado em src/test/checklist-modulos.test.ts). O catálogo vem do banco:
// módulos (app_modulo) e telas (app_menu com rota). O checklist de cada tela
// começa vazio — "pendente de preenchimento" — e quem preenche é o gerente
// de sistemas.
//
// EFETIVIDADE de uma tela = média das quatro etapas que se aplicam:
//   desenvolvimento  pronto 1 · homologação 0,75 · em desenvolvimento 0,4 · não iniciado 0
//   implantação      implantado 1 · em implantação 0,5 · não implantado 0
//   treinamento      treinado 1 · agendado 0,3 · pendente 0 · "não se aplica" sai da média
//   validação        validado 1 · em validação 0,5 · pendente/reprovado 0
// Etapa sem preenchimento conta 0. Módulo = média das telas ATIVAS dele
// (tela pendente entra como 0 — senão um módulo com 1 tela pronta e 20 sem
// preencher apareceria 100%).
// =====================================================================

export type StatusDev = "nao_iniciado" | "em_desenvolvimento" | "em_homologacao" | "pronto";
export type StatusImplantacao = "nao_implantado" | "em_implantacao" | "implantado";
export type StatusTreinamento = "pendente" | "agendado" | "treinado" | "nao_se_aplica";
export type StatusValidacao = "pendente" | "em_validacao" | "validado" | "reprovado";
export type Etapa = "dev" | "implantacao" | "treinamento" | "validacao";

export type Tom = "ok" | "progresso" | "atencao" | "risco" | "neutro" | "pendente";

export interface OpcaoStatus<T extends string> { valor: T; rotulo: string; tom: Tom; peso: number | null }

export const OPCOES_DEV: OpcaoStatus<StatusDev>[] = [
  { valor: "nao_iniciado", rotulo: "Não iniciado", tom: "neutro", peso: 0 },
  { valor: "em_desenvolvimento", rotulo: "Em desenvolvimento", tom: "progresso", peso: 0.4 },
  { valor: "em_homologacao", rotulo: "Em homologação", tom: "atencao", peso: 0.75 },
  { valor: "pronto", rotulo: "Pronto", tom: "ok", peso: 1 },
];
export const OPCOES_IMPLANTACAO: OpcaoStatus<StatusImplantacao>[] = [
  { valor: "nao_implantado", rotulo: "Não implantado", tom: "neutro", peso: 0 },
  { valor: "em_implantacao", rotulo: "Em implantação", tom: "progresso", peso: 0.5 },
  { valor: "implantado", rotulo: "Implantado", tom: "ok", peso: 1 },
];
export const OPCOES_TREINAMENTO: OpcaoStatus<StatusTreinamento>[] = [
  { valor: "pendente", rotulo: "Pendente", tom: "atencao", peso: 0 },
  { valor: "agendado", rotulo: "Agendado", tom: "progresso", peso: 0.3 },
  { valor: "treinado", rotulo: "Treinado", tom: "ok", peso: 1 },
  { valor: "nao_se_aplica", rotulo: "Não se aplica", tom: "neutro", peso: null },
];
export const OPCOES_VALIDACAO: OpcaoStatus<StatusValidacao>[] = [
  { valor: "pendente", rotulo: "Pendente", tom: "atencao", peso: 0 },
  { valor: "em_validacao", rotulo: "Em validação", tom: "progresso", peso: 0.5 },
  { valor: "validado", rotulo: "Validado", tom: "ok", peso: 1 },
  { valor: "reprovado", rotulo: "Reprovado", tom: "risco", peso: 0 },
];

export const ETAPAS: { chave: Etapa; campo: keyof ChecklistItem; titulo: string; opcoes: OpcaoStatus<string>[] }[] = [
  { chave: "dev", campo: "status_dev", titulo: "Desenvolvimento", opcoes: OPCOES_DEV },
  { chave: "implantacao", campo: "status_implantacao", titulo: "Implantação", opcoes: OPCOES_IMPLANTACAO },
  { chave: "treinamento", campo: "status_treinamento", titulo: "Treinamento", opcoes: OPCOES_TREINAMENTO },
  { chave: "validacao", campo: "status_validacao", titulo: "Validação do usuário", opcoes: OPCOES_VALIDACAO },
];

export const ROTULO_PENDENTE = "Pendente de preenchimento";

export function opcaoDe(etapa: Etapa, valor: string | null | undefined): OpcaoStatus<string> | null {
  if (!valor) return null;
  return ETAPAS.find((e) => e.chave === etapa)!.opcoes.find((o) => o.valor === valor) ?? null;
}

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
  observacoes: string | null; atualizado_por: string | null; atualizado_em: string;
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

// ── Cálculo ──────────────────────────────────────────────────────────────

/** Algum status foi preenchido? (responsável/observação sozinhos não contam.) */
export const preenchido = (c: Partial<ChecklistItem> | null | undefined) =>
  !!c && !!(c.status_dev || c.status_implantacao || c.status_treinamento || c.status_validacao);

/** 0–1 (null = nenhuma etapa aplicável, só "não se aplica" no treinamento e o resto vazio não acontece: o resto conta 0). */
export function efetividade(c: Partial<ChecklistItem> | null | undefined): number {
  const pesos: number[] = [];
  for (const e of ETAPAS) {
    const v = c?.[e.campo] as string | null | undefined;
    const o = opcaoDe(e.chave, v);
    if (o && o.peso == null) continue;   // "não se aplica"
    pesos.push(o?.peso ?? 0);
  }
  return pesos.length ? pesos.reduce((a, b) => a + b, 0) / pesos.length : 0;
}

export interface LinhaTela {
  tela: TelaCat;
  item: ChecklistItem | null;
  preenchido: boolean;
  efetividade: number;
  bugsAbertos: number;
  treinados: number;
  /** usuários ativos em 30 dias ÷ usuários com acesso (null = ninguém com acesso). */
  adocao: number | null;
}

export interface LinhaModulo {
  modulo: ModuloCat;
  item: ChecklistItem | null;           // dados do módulo (responsável, usuário-chave, observações)
  telas: LinhaTela[];                   // todas (ativas primeiro)
  ativas: number;
  preenchidas: number;
  efetividade: number;                  // média das telas ativas
  porDev: Record<StatusDev | "pendente", number>;
  prontas: number; implantadas: number; treinadas: number; validadas: number;
  bugsAbertos: number;
  chamadosAbertos: number;
  comAcesso: number;                    // pessoas distintas
  ativos30d: number;                    // pessoas distintas, 30 dias
  acessos30d: number;
  ultimoUso: string | null;
}

const ZERO_DEV = (): Record<StatusDev | "pendente", number> => ({ pendente: 0, nao_iniciado: 0, em_desenvolvimento: 0, em_homologacao: 0, pronto: 0 });

export function montarModulos(d: DadosChecklist): LinhaModulo[] {
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
    const porDev = ZERO_DEV();
    for (const t of ativas) porDev[t.item?.status_dev ?? "pendente"] += 1;
    const conta = (f: (t: LinhaTela) => boolean) => ativas.filter(f).length;
    return {
      modulo: m,
      item: itemModulo.get(m.id) ?? null,
      telas,
      ativas: ativas.length,
      preenchidas: conta((t) => t.preenchido),
      efetividade: ativas.length ? ativas.reduce((s, t) => s + t.efetividade, 0) / ativas.length : 0,
      porDev,
      prontas: porDev.pronto,
      implantadas: conta((t) => t.item?.status_implantacao === "implantado"),
      treinadas: conta((t) => t.item?.status_treinamento === "treinado"),
      validadas: conta((t) => t.item?.status_validacao === "validado"),
      bugsAbertos: bugsModulo.get(m.id) ?? 0,
      chamadosAbertos: chamados.get(m.codigo) ?? 0,
      comAcesso: m.com_acesso ?? 0,
      ativos30d: m.ativos_30d ?? 0,
      acessos30d: ativas.reduce((s, t) => s + t.tela.acessos_30d, 0),
      ultimoUso: ativas.map((t) => t.tela.ultimo_uso).filter((x): x is string => !!x).sort().pop() ?? null,
    };
  });
}

// ── Filtros ──────────────────────────────────────────────────────────────

export interface FiltrosChecklist {
  modulo: string;               // id ou ""
  dev: "" | StatusDev | "pendente";
  treinamento: "" | StatusTreinamento | "sem";
  validacao: "" | StatusValidacao | "sem";
  responsavel: string;          // user id ou ""
  busca: string;
  soPendentes: boolean;
  mostrarInativas: boolean;
}
export const FILTROS_VAZIOS: FiltrosChecklist = {
  modulo: "", dev: "", treinamento: "", validacao: "", responsavel: "", busca: "", soPendentes: false, mostrarInativas: false,
};

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export function telaPassa(t: LinhaTela, m: LinhaModulo, f: FiltrosChecklist): boolean {
  if (!f.mostrarInativas && !t.tela.ativo) return false;
  if (f.dev && (t.item?.status_dev ?? "pendente") !== f.dev) return false;
  if (f.treinamento && (t.item?.status_treinamento ?? "sem") !== f.treinamento) return false;
  if (f.validacao && (t.item?.status_validacao ?? "sem") !== f.validacao) return false;
  if (f.responsavel && (t.item?.responsavel_id ?? m.item?.responsavel_id ?? "") !== f.responsavel) return false;
  if (f.soPendentes && t.preenchido) return false;
  if (f.busca.trim()) {
    const q = norm(f.busca.trim());
    if (![t.tela.nome, t.tela.rota, t.tela.codigo, m.modulo.nome].some((x) => norm(x ?? "").includes(q))) return false;
  }
  return true;
}

/** Módulos com as telas que passam no filtro (módulo sem nenhuma tela que passe some, a não ser sem filtro de tela). */
export function filtrarModulos(mods: LinhaModulo[], f: FiltrosChecklist): { modulo: LinhaModulo; telas: LinhaTela[] }[] {
  const temFiltroTela = !!(f.dev || f.treinamento || f.validacao || f.responsavel || f.busca.trim() || f.soPendentes);
  return mods
    .filter((m) => !f.modulo || m.modulo.id === f.modulo)
    .filter((m) => f.mostrarInativas || m.modulo.ativo)
    .map((m) => ({ modulo: m, telas: m.telas.filter((t) => telaPassa(t, m, f)) }))
    .filter((x) => !temFiltroTela || x.telas.length > 0
      || (!!f.busca.trim() && norm(x.modulo.modulo.nome).includes(norm(f.busca.trim()))));
}

// ── KPIs gerais ──────────────────────────────────────────────────────────

export function indicadores(mods: LinhaModulo[]) {
  const telas = mods.filter((m) => m.modulo.ativo).flatMap((m) => m.telas.filter((t) => t.tela.ativo));
  const conta = (f: (t: LinhaTela) => boolean) => telas.filter(f).length;
  return {
    modulos: mods.filter((m) => m.modulo.ativo).length,
    telas: telas.length,
    preenchidas: conta((t) => t.preenchido),
    pendentes: conta((t) => !t.preenchido),
    prontas: conta((t) => t.item?.status_dev === "pronto"),
    emDesenvolvimento: conta((t) => t.item?.status_dev === "em_desenvolvimento" || t.item?.status_dev === "em_homologacao"),
    implantadas: conta((t) => t.item?.status_implantacao === "implantado"),
    treinadas: conta((t) => t.item?.status_treinamento === "treinado"),
    validadas: conta((t) => t.item?.status_validacao === "validado"),
    efetividade: telas.length ? telas.reduce((s, t) => s + t.efetividade, 0) / telas.length : 0,
    bugsAbertos: mods.reduce((s, m) => s + m.bugsAbertos, 0),
    semUso: conta((t) => t.tela.com_acesso > 0 && t.tela.ativos_30d === 0),
  };
}

// ── Texto ────────────────────────────────────────────────────────────────

export const pct = (x: number | null | undefined) => (x == null ? "—" : `${Math.round(x * 100)}%`);

export const ROTULO_CAMPO: Record<string, string> = {
  status_dev: "Desenvolvimento", status_implantacao: "Implantação", status_treinamento: "Treinamento",
  status_validacao: "Validação", responsavel_id: "Responsável", usuario_chave_id: "Usuário-chave",
  previsao_entrega: "Previsão de entrega", data_implantacao: "Data de implantação", data_treinamento: "Data do treinamento",
  data_validacao: "Data da validação", observacoes: "Observações",
};

/** "pronto" → "Pronto" (qualquer etapa); data ISO → dd/mm/aaaa; resto como veio. */
export function rotuloValor(campo: string, v: string | null): string {
  if (v == null || v === "") return "—";
  const etapa = ETAPAS.find((e) => e.campo === campo);
  if (etapa) return etapa.opcoes.find((o) => o.valor === v)?.rotulo ?? v;
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v.split("-").reverse().join("/");
  return v;
}
