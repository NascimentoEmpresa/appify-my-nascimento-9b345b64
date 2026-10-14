// =====================================================================
// TVs GERENCIAIS POR DIRETORIA (12/10/2026, mig 20261012000001) — SIS-2026-0635
//
// Pedido do chamado: "fazer as telas para TVs conforme os anexos" — o
// documento "Indicadores das TVs — Separação por Diretoria e Áreas
// Transversais" (13 TVs). Os números vêm de tvg_painel_dados (banco); aqui
// ficam as regras da APRESENTAÇÃO que o documento manda (Parte IV), com
// teste em src/test/tvs-gerenciais.test.ts:
//   · semáforo pela meta e pelo limite de atenção, no sentido do indicador;
//   · "exibir prioritariamente indicadores fora da meta" e "ordenação pelo
//     impacto absoluto, não somente o percentual";
//   · o formato de cada indicador: resultado, meta, afetado, causa e
//     responsável ("Glosas: R$ 80 mil — 3 contratos — maior causa: posto
//     descoberto — responsável: Operação").
// =====================================================================

export type Unidade = "qtd" | "pct" | "brl" | "dias";
export type Sentido = "menor" | "maior";
export type Fonte = "auto" | "manual" | "espelho" | "soma";
export type Situacao = "vermelho" | "amarelo" | "verde" | "neutro" | "sem_dado";

export interface LinhaDetalhe {
  nome: string; valor: number | null; rotulo?: string | null; /** duas séries (postos: contratados × cobertos; quadro: ativos × necessários) */ a?: number | null; b?: number | null;
  /** Gráfico "lista" (alertas): data (AAAA-MM-DD), linha principal e linha de apoio. */
  data?: string | null; titulo?: string | null; sub?: string | null;
}

export interface ResultadoIndicador {
  valor: number | string | null;
  afetado?: string | null; causa?: string | null; impacto?: number | string | null; base?: string | null;
  detalhe?: LinhaDetalhe[] | null; erro?: string | null; origem?: string | null;
  referencia?: string | null; atualizado_em?: string | null; observacao?: string | null;
  /** TV que espelha um relatório (mig 20261014000030): o gráfico da tela de origem — tipo, título e a ordem embaixo. */
  grafico?: TipoGrafico | null; grafico_titulo?: string | null; grafico_series?: [string, string] | null; destaque?: number | null;
}

export interface IndicadorGerencial {
  codigo: string; nome: string; identificar: string; regra: string | null; fonte: Fonte; unidade: Unidade; sentido: Sentido;
  meta: number | string | null; alerta: number | string | null; periodicidade: "diaria" | "semanal" | "mensal";
  responsavel: string | null; pai: string | null; na_tv: boolean; ordem: number;
  parametro: number | string | null; parametro_rotulo: string | null; espelho_de: string | null;
  resultado: ResultadoIndicador;
}

/** Série de 12 meses com dado real para o gráfico grande do dashboard (mig 20261014000010 › tvg_tendencia). */
export interface TendenciaPainel {
  titulo: string; series: [string, string]; unidade: Unidade;
  meses: { mes: string; a: number | null; b: number | null }[];
  erro?: string;
}

export interface PainelGerencial {
  painel: { slug: string; titulo: string; diretoria: string; pergunta: string } | null;
  indicadores: IndicadorGerencial[];
  tendencia?: TendenciaPainel | null;
  gerado_em?: string;
}

/** As 13 TVs do documento — slug (= relatorio do item da playlist), cor e ícone. */
export const PAINEIS_GERENCIAIS: { slug: string; titulo: string; diretoria: string; cor: string; icone: string }[] = [
  { slug: "ger-operacional", titulo: "Gerência Operacional", diretoria: "Diretor Operacional", cor: "#1d4ed8", icone: "Briefcase" },
  { slug: "ger-licitacoes", titulo: "Licitações", diretoria: "Diretor Operacional", cor: "#0e7490", icone: "Gavel" },
  { slug: "ger-supply", titulo: "Supply", diretoria: "Diretor Operacional", cor: "#b45309", icone: "Package" },
  { slug: "ger-frota", titulo: "Frota e Patrimônio", diretoria: "Diretor Operacional", cor: "#475569", icone: "Truck" },
  { slug: "ger-recrutamento", titulo: "Recrutamento e Seleção", diretoria: "Diretora Administrativa", cor: "#4338ca", icone: "UserPlus" },
  { slug: "ger-rh", titulo: "RH e Departamento Pessoal", diretoria: "Diretora Administrativa", cor: "#7c3aed", icone: "Users" },
  { slug: "ger-sst", titulo: "SST", diretoria: "Diretora Administrativa", cor: "#15803d", icone: "HardHat" },
  { slug: "ger-treinamento", titulo: "Treinamento", diretoria: "Diretora Administrativa", cor: "#f26522", icone: "GraduationCap" },
  { slug: "ger-financeiro", titulo: "Financeiro", diretoria: "Diretora Administrativa", cor: "#047857", icone: "Wallet" },
  { slug: "ger-juridico", titulo: "Jurídico", diretoria: "Diretora Administrativa", cor: "#9f1239", icone: "Scale" },
  { slug: "ger-controladoria", titulo: "Controladoria", diretoria: "Áreas Transversais", cor: "#0f766e", icone: "Calculator" },
  { slug: "ger-ti", titulo: "TI / ERP", diretoria: "Áreas Transversais", cor: "#334155", icone: "Server" },
  { slug: "ger-presidencia", titulo: "Presidência", diretoria: "Presidência", cor: "#111827", icone: "Crown" },
];
export const ehPainelGerencial = (slug: string | null | undefined) => !!slug && slug.startsWith("ger-");
export const painelGerencial = (slug: string | null | undefined) => PAINEIS_GERENCIAIS.find((p) => p.slug === slug) ?? null;

const num = (v: number | string | null | undefined): number | null => {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * Semáforo. Sentido "menor" (quanto menor, melhor): até a meta = verde; até o
 * limite de atenção = amarelo; acima = vermelho. "maior": o espelho. Sem meta
 * = neutro (só acompanhamento). Sem valor = sem dado.
 */
export function situacao(i: Pick<IndicadorGerencial, "meta" | "alerta" | "sentido"> & { resultado: Pick<ResultadoIndicador, "valor"> }): Situacao {
  const v = num(i.resultado?.valor);
  if (v == null) return "sem_dado";
  const meta = num(i.meta);
  // "Quanto mais, melhor" sem meta = o que o setor entregou (chamados concluídos,
  // vagas preenchidas, recebido no mês…): é notícia boa, vai em verde. Pablo,
  // 14/10/2026: "só tá aparecendo coisa ruim, tem que aparecer coisas boas".
  if (meta == null) return i.sentido === "maior" && v > 0 ? "verde" : "neutro";
  const alerta = num(i.alerta);
  if (i.sentido === "maior") {
    if (v >= meta) return "verde";
    return alerta != null && v >= alerta ? "amarelo" : "vermelho";
  }
  if (v <= meta) return "verde";
  return alerta != null && v <= alerta ? "amarelo" : "vermelho";
}

// Neutro e verde empatam: o que não está ruim segue a ordem do cadastro — assim a TV
// Supply mostra os cartões na ordem do Dashboard de Compras (14/10/2026).
const PESO: Record<Situacao, number> = { vermelho: 0, amarelo: 1, sem_dado: 2, neutro: 3, verde: 3 };

/** Quanto o indicador está fora da meta, em valor absoluto (0 se dentro ou sem meta). */
export function desvio(i: Pick<IndicadorGerencial, "meta" | "sentido"> & { resultado: Pick<ResultadoIndicador, "valor"> }): number {
  const v = num(i.resultado?.valor), meta = num(i.meta);
  if (v == null || meta == null) return 0;
  return Math.max(0, i.sentido === "maior" ? meta - v : v - meta);
}

/**
 * A ordem da TV: fora da meta primeiro (vermelho, amarelo), depois sem dado,
 * acompanhamento e os que estão bem. Dentro do grupo, pelo IMPACTO ABSOLUTO
 * (R$ em jogo, quando o cálculo/lançamento informa) e então pelo desvio da
 * meta — e só então pela ordem do documento.
 */
export function ordenarParaTv<T extends IndicadorGerencial>(itens: T[]): T[] {
  return [...itens].sort((a, b) => {
    const s = PESO[situacao(a)] - PESO[situacao(b)];
    if (s) return s;
    const ia = Math.abs(num(a.resultado?.impacto) ?? 0), ib = Math.abs(num(b.resultado?.impacto) ?? 0);
    if (ia !== ib) return ib - ia;
    const da = desvio(a), db = desvio(b);
    if (da !== db) return db - da;
    return a.ordem - b.ordem;
  });
}

/** Só os que vão para a TV (os subindicadores ficam no detalhe do sistema). */
export const indicadoresDaTv = (p: PainelGerencial | null | undefined) => ordenarParaTv((p?.indicadores ?? []).filter((i) => i.na_tv));

/** Subindicadores de um consolidado (pai) ou do painel (sem pai e fora da TV). */
export const subindicadores = (p: PainelGerencial | null | undefined, pai: string | null) =>
  (p?.indicadores ?? []).filter((i) => !i.na_tv && (pai ? i.pai === pai : !i.pai));

/** Número curto para a TV: R$ 1,2 mi / R$ 80 mil / 12,5% / 138. */
export function formatarValor(v: number | string | null | undefined, unidade: Unidade, curto = true): string {
  const n = num(v);
  if (n == null) return "—";
  if (unidade === "pct") return `${n.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
  // Uma casa, como os dashboards dos módulos ("7,5 dias" no Dashboard de Compras; antes saía "8 d").
  if (unidade === "dias") return `${n.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} d`;
  if (unidade === "brl") {
    const a = Math.abs(n);
    // Bilhão (14/10/2026): "R$ 1.140,1 mi" (valor participado das licitações) não cabia no cartão.
    if (curto && a >= 1_000_000_000) return `R$ ${(n / 1_000_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} bi`;
    if (curto && a >= 1_000_000) return `R$ ${(n / 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mi`;
    if (curto && a >= 10_000) return `R$ ${(n / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 0 })} mil`;
    const casas = a >= 1000 || Number.isInteger(n) ? 0 : 2; // mínimo explícito: navegador de TV antigo recusa máximo < mínimo padrão
    return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: casas, maximumFractionDigits: casas });
  }
  return n.toLocaleString("pt-BR", { maximumFractionDigits: 1 });
}

/** "Meta ≤ 0" / "Meta ≥ 95%" / "Sem meta" — o texto da comparação com a meta. */
export function textoMeta(i: Pick<IndicadorGerencial, "meta" | "sentido" | "unidade">): string {
  const meta = num(i.meta);
  if (meta == null) return i.sentido === "maior" ? "Entregue no período" : "Sem meta · acompanhamento";
  return `Meta ${i.sentido === "maior" ? "≥" : "≤"} ${formatarValor(meta, i.unidade)}`;
}

export const ROTULO_SITUACAO: Record<Situacao, string> = {
  vermelho: "Fora da meta", amarelo: "Atenção", verde: "Na meta", neutro: "Acompanhar", sem_dado: "Sem dado",
};
export const COR_SITUACAO: Record<Situacao, string> = {
  vermelho: "#dc2626", amarelo: "#d97706", verde: "#16a34a", neutro: "#2563eb", sem_dado: "#71717a",
};

export const ROTULO_FONTE: Record<Fonte, string> = {
  auto: "Calculado do ERP", manual: "Lançamento", espelho: "Espelho de outra TV", soma: "Consolidado (soma)",
};
export const ROTULO_PERIODICIDADE = { diaria: "Diária", semanal: "Semanal", mensal: "Mensal" } as const;

/** Lançamento manual em atraso pela periodicidade (a mesma tolerância do ctl_nao_atualizados). */
export function lancamentoAtrasado(i: Pick<IndicadorGerencial, "fonte" | "periodicidade"> & { resultado: Pick<ResultadoIndicador, "atualizado_em"> }, agora = new Date()): boolean {
  if (i.fonte !== "manual") return false;
  if (!i.resultado?.atualizado_em) return true;
  const tol = i.periodicidade === "diaria" ? 2 : i.periodicidade === "semanal" ? 8 : 35;
  return agora.getTime() - new Date(i.resultado.atualizado_em).getTime() > tol * 86_400_000;
}

/** O resumo da TV numa linha, no formato "adequado" do documento. */
export function frase(i: IndicadorGerencial): string {
  const partes = [`${i.nome}: ${formatarValor(i.resultado?.valor, i.unidade)}`];
  if (i.resultado?.afetado) partes.push(i.resultado.afetado);
  if (i.resultado?.causa) partes.push(`maior causa: ${i.resultado.causa}`);
  if (i.responsavel) partes.push(`responsável: ${i.responsavel}`);
  return partes.join(" — ");
}

/** Contagem por situação (o placar do topo da TV). */
export function placar(itens: IndicadorGerencial[]): Record<Situacao, number> {
  const p: Record<Situacao, number> = { vermelho: 0, amarelo: 0, verde: 0, neutro: 0, sem_dado: 0 };
  for (const i of itens) p[situacao(i)]++;
  return p;
}

// ---- Visual do protótipo HTML (14/10/2026, mig 20261014000002) ---------------
//
// Pedido do Pablo: "desenvolve igual ao HTML, deixa várias opções, não
// precisa tirar as já desenvolvidas". O protótipo anexado ao chamado
// (TVs_Gerenciais_10_Telas_CONFORME_WORD.html) tem fundo escuro e um GRÁFICO
// em cada indicador, com as caixas Meta / Contrato-Setor afetado / Causa
// principal / Responsável. Vira uma opção por item da playlist
// (TV_ITEM.rel_visual); o "clássico" de 12/10 continua sendo o padrão.

// 14/10/2026 — "tira essas telas anteriores e coloca essas novas só": o visual
// clássico (cartões com o número, de 12/10) saiu. "classico"/vazio no banco
// (itens antigos) tocam o painel padrão (claro).
// 14/10/2026 — "seja um dashboard pra TV, não cada um no seu quadrado — dashboard
// completo com gráficos e números reais": o DASHBOARD (faixa de números, a
// tendência de 12 meses, onde agir e os gráficos dos piores) passa a ser o
// padrão; os painéis de cartões ficam como opção.
export type VisualGerencial = "dashboard" | "dashboard-escuro" | "painel" | "painel-claro" | "graficos";
export const VISUAIS_GERENCIAIS: { valor: VisualGerencial; rotulo: string; dica: string; porTela: number; colunas: number; escuro: boolean }[] = [
  { valor: "dashboard", rotulo: "Dashboard completo — claro (padrão)", dica: "Uma tela só: todos os números com semáforo, a tendência de 12 meses, onde agir agora e os gráficos dos indicadores mais críticos", porTela: 99, colunas: 0, escuro: false },
  { valor: "dashboard-escuro", rotulo: "Dashboard completo — escuro", dica: "O mesmo dashboard no fundo escuro", porTela: 99, colunas: 0, escuro: true },
  // 14/10/2026 — "visual parecido com o HTML, mas mais bonito, na qualidade de carmed.vercel.app": o claro (faixa de cor, cartões brancos com sombra) é o padrão.
  { valor: "painel-claro", rotulo: "Cartões com gráfico — claro", dica: "O painel inteiro numa tela: gráfico por indicador, resultado × meta, onde, causa e responsável — fundo claro, cartões brancos", porTela: 8, colunas: 0, escuro: false },
  { valor: "painel", rotulo: "Cartões com gráfico — escuro (como o HTML)", dica: "O mesmo painel no fundo escuro do protótipo HTML", porTela: 8, colunas: 0, escuro: true },
  { valor: "graficos", rotulo: "Gráficos grandes — claro", dica: "4 indicadores por tela, gráfico maior — para TV longe de quem olha", porTela: 4, colunas: 2, escuro: false },
];
/** Colunas da grade: fixa no "gráficos grandes" (2×2); no painel, cabe tudo numa tela (até 3 → uma linha; até 6 → 3; senão 4). */
export const colunasDaTela = (visual: VisualGerencial, n: number) => {
  const c = visualGerencial(visual).colunas;
  return c || (n <= 3 ? Math.max(1, n) : n <= 6 ? 3 : 4);
};
export const visualGerencial = (v: string | null | undefined) => VISUAIS_GERENCIAIS.find((x) => x.valor === v) ?? VISUAIS_GERENCIAIS[0];
/** O visual que a TV toca: o do item, ou o padrão (o primeiro da lista: o dashboard claro). */
export const ehDashboard = (v: VisualGerencial) => v === "dashboard" || v === "dashboard-escuro";
export const visualDoItem = (v: string | null | undefined): VisualGerencial => visualGerencial(v).valor;

/** "lista": linhas de alerta com data, título e apoio (lic_prazo — o slide Alertas da TV de Licitações, 14/10/2026). */
export type TipoGrafico = "colunas" | "agrupado" | "linha" | "rosca" | "combo" | "lista";
/** O tipo de gráfico de cada indicador — o mesmo do protótipo HTML quando o dado do ERP permite. */
const GRAFICO: Record<string, { tipo: TipoGrafico; series?: [string, string]; /** unidade do detalhe quando difere da do indicador */ unidade?: Unidade }> = {
  fin_notas_pendentes: { tipo: "colunas", unidade: "brl" }, sup_valor_estoque: { tipo: "colunas", unidade: "brl" }, sup_sem_mov: { tipo: "colunas", unidade: "brl" },
  rh_ob_rescisoes: { tipo: "colunas", unidade: "qtd" }, fin_recebimentos: { tipo: "colunas", unidade: "brl" },
  lic_prazo: { tipo: "lista", unidade: "dias" }, lic_implantacao: { tipo: "colunas", unidade: "dias" }, lic_propostas: { tipo: "colunas", unidade: "dias" },
  jur_prazos: { tipo: "colunas", unidade: "dias" }, fro_manutencoes: { tipo: "colunas", unidade: "dias" }, jur_audiencias: { tipo: "linha", unidade: "dias" },
  op_postos: { tipo: "agrupado", series: ["Contratados", "Cobertos"] }, pre_postos: { tipo: "agrupado", series: ["Contratados", "Cobertos"] },
  rh_quadro: { tipo: "agrupado", series: ["Ativos", "Necessários"] },
  // TV Supply = Dashboard de Compras (mig 20261014000028): os mesmos gráficos de lá.
  sup_solicitacoes: { tipo: "agrupado", series: ["Solicitações", "Despachadas"] }, sup_pendentes: { tipo: "rosca" },
  sup_cotacoes: { tipo: "rosca" }, sup_saving: { tipo: "colunas", unidade: "brl" }, sup_saving_pct: { tipo: "colunas", unidade: "pct" }, sup_tempo_atendimento: { tipo: "colunas", unidade: "dias" }, sup_despachados: { tipo: "colunas", unidade: "qtd" },
  op_lucratividade: { tipo: "combo" }, pre_lucratividade: { tipo: "combo" }, op_reclamacoes: { tipo: "combo" }, ctl_margem: { tipo: "combo" },
  op_faltas: { tipo: "linha" }, op_turnover: { tipo: "linha" }, rh_turnover: { tipo: "linha" }, sst_afastamentos: { tipo: "linha" },
  sup_contratos_sem_entrega: { tipo: "linha" }, fin_fluxo: { tipo: "linha" },
  lic_risco: { tipo: "rosca" }, lic_perdidas: { tipo: "rosca" }, rec_desistencias: { tipo: "rosca" }, sst_aso: { tipo: "rosca" },
  sst_epi: { tipo: "rosca" }, fin_glosas: { tipo: "rosca" }, jur_risco: { tipo: "rosca" }, ctl_vermelhos: { tipo: "rosca" },
  pre_vermelhos: { tipo: "rosca" }, ti_integracoes: { tipo: "rosca" }, fro_sem_responsavel: { tipo: "rosca" },
};
export function graficoDo(i: Pick<IndicadorGerencial, "codigo" | "resultado">): { tipo: TipoGrafico; series?: [string, string]; unidade?: Unidade } {
  // Espelho de relatório: o tipo do gráfico vem da tela de origem.
  const g = i.resultado?.grafico ? { tipo: i.resultado.grafico, series: i.resultado.grafico_series ?? undefined } : GRAFICO[i.codigo] ?? { tipo: "colunas" as TipoGrafico };
  // Agrupado sem as duas séries (detalhe lançado à mão) cai para colunas.
  if (g.tipo === "agrupado" && !(i.resultado?.detalhe ?? []).some((l) => l.a != null && l.b != null)) return { tipo: "colunas" };
  // Lista sem os campos (banco antes da mig 20261014000027) cai para colunas.
  if (g.tipo === "lista" && !(i.resultado?.detalhe ?? []).some((l) => l.titulo)) return { tipo: "colunas", unidade: g.unidade };
  return g;
}

/** Os pontos do gráfico: o detalhamento real (os N maiores; rosca só fatias > 0). */
export function dadosDoGrafico(i: Pick<IndicadorGerencial, "codigo" | "resultado">, max = 6): LinhaDetalhe[] {
  const g = graficoDo(i);
  const linhas = (i.resultado?.detalhe ?? []).filter((l) => l && l.nome && (l.valor != null || (l.a != null && l.b != null)));
  if (g.tipo === "rosca") {
    const pos = linhas.filter((l) => Number(l.valor) > 0);
    if (pos.length <= max) return pos;
    const resto = pos.slice(max - 1).reduce((s, l) => s + Number(l.valor), 0);
    return [...pos.slice(0, max - 1), { nome: "Outros", valor: resto }];
  }
  return linhas.slice(0, max);
}

/** Nome curto para eixo de gráfico: sem o código do contrato e sem o nº do edital. */
export function nomeCurto(s: string, max = 22): string {
  const t = s.replace(/^\s*\d+\s*-\s*/, "").replace(/\s*(?:[-–]\s*)?\d+[./]\d+\s*$/, "").replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

/** As telas do painel: os indicadores da TV (na ordem de gravidade) em telas equilibradas (7 → 4 + 3). */
export function paginasPainel(p: PainelGerencial, visual: VisualGerencial): { chave: string; titulo: string }[] {
  if (ehDashboard(visual)) return [{ chave: "dashboard", titulo: "Dashboard" }];
  const n = indicadoresDaTv(p).length;
  const porTela = visualGerencial(visual).porTela;
  const telas = Math.max(1, Math.ceil(n / porTela));
  return Array.from({ length: telas }, (_, k) => ({ chave: `painel-${k + 1}`, titulo: telas > 1 ? `Tela ${k + 1} de ${telas}` : "Indicadores" }));
}
export function indicadoresDaTela(p: PainelGerencial, visual: VisualGerencial, chave: string): IndicadorGerencial[] {
  const itens = indicadoresDaTv(p);
  const telas = paginasPainel(p, visual).length;
  const porTela = Math.ceil(itens.length / telas);
  const k = Math.max(0, Number(chave.replace("painel-", "")) - 1);
  return itens.slice(k * porTela, (k + 1) * porTela);
}

/** As notas do topo da tela (como no HTML): subindicadores que ficam no sistema. */
export function notaSubindicadores(p: PainelGerencial): string | null {
  const nomes = (p.indicadores ?? []).filter((i) => !i.na_tv).map((i) => i.nome);
  return nomes.length ? `Subindicadores disponíveis no sistema: ${nomes.join(", ")}.` : null;
}

/** A cor de cada gráfico, a mesma do protótipo HTML (cada painel com a sua cara). Sem cor: a do status. */
const COR_GRAFICO: Record<string, string> = {
  op_custo_direto: "#ef4444", op_glosas: "#f59e0b", op_faltas: "#38bdf8", op_turnover: "#a78bfa",
  lic_prazo: "#ef4444", lic_implantacao: "#f97316", lic_valor: "#38bdf8", lic_propostas: "#60a5fa", lic_documentos: "#ef4444",
  sup_compras_vencidas: "#ef4444", sup_abaixo_minimo: "#fb7185", sup_valor_estoque: "#60a5fa", sup_sem_mov: "#a855f7", sup_fornecedor: "#fb7185", sup_contratos_sem_entrega: "#22c55e",
  fro_indisponiveis: "#ef4444", fro_manutencoes: "#f97316", fro_documentos: "#f59e0b", fro_combustivel: "#a855f7", fro_nao_localizados: "#fb7185",
  rec_risco: "#ef4444", rec_abertas: "#60a5fa", rec_prazo: "#f97316", rec_admissoes: "#22c55e",
  rh_salarios: "#ef4444", rh_turnover: "#a78bfa", rh_absenteismo: "#f59e0b", rh_obrigacoes: "#ef4444",
  sst_impedidos: "#ef4444", sst_treinamentos: "#f97316", sst_afastamentos: "#38bdf8", sst_acidentes: "#facc15",
  trn_integracoes: "#f97316", trn_contratuais: "#60a5fa", trn_vencidos: "#ef4444", trn_programados: "#22c55e", trn_sem_comprovacao: "#a855f7",
  fin_notas_pendentes: "#ef4444", fin_valor_pendente: "#fb7185", fin_recebimentos: "#ef4444", fin_inadimplencia: "#f59e0b", fin_fluxo: "#22c55e",
  jur_prazos: "#ef4444", jur_sem_resposta: "#ef4444", jur_audiencias: "#60a5fa", jur_contratos_analise: "#f97316", jur_reincidentes: "#a855f7",
  ctl_desvio: "#ef4444", ctl_planos: "#fb7185", ctl_nao_atualizados: "#38bdf8", ctl_reincidentes: "#ef4444",
  ti_indisponiveis: "#ef4444", ti_erros: "#fb7185", ti_backups: "#f59e0b", ti_demandas: "#f97316", ti_acessos: "#a855f7",
  pre_glosas: "#ef4444", pre_salarios: "#f97316", pre_caixa: "#ef4444", pre_clientes: "#38bdf8", pre_planos: "#a855f7",
};
export const corDoGrafico = (codigo: string): string | null => COR_GRAFICO[codigo] ?? null;

// ---- Dashboard completo (14/10/2026) -----------------------------------------

/** Os gráficos de baixo do dashboard: os piores com detalhamento (até `n`), na ordem da TV. */
/** TV que espelha o dashboard do módulo: os gráficos de baixo são os mesmos da tela de lá, nessa ordem. */
const GRAFICOS_DO_DASHBOARD: Record<string, string[]> = {
  // Suprimentos › Dashboard de Compras: Solicitações por Contrato · Saving por Contrato · Motivos das Pendências.
  "ger-supply": ["sup_solicitacoes", "sup_saving", "sup_pendentes"],
};

export function destaquesDoDashboard(p: PainelGerencial, n = 3): IndicadorGerencial[] {
  const comGrafico = indicadoresDaTv(p).filter((i) => dadosDoGrafico(i).length > 0);
  // Espelho de relatório: os gráficos da tela, na ordem marcada no cadastro (espelho_destaque).
  const marcados = comGrafico.filter((i) => i.resultado?.destaque != null).sort((a, b) => Number(a.resultado?.destaque) - Number(b.resultado?.destaque));
  if (marcados.length) return marcados.slice(0, n);
  const fixos = GRAFICOS_DO_DASHBOARD[p.painel?.slug ?? ""];
  if (fixos) {
    const escolhidos = fixos.map((c) => comGrafico.find((i) => i.codigo === c)).filter((i): i is IndicadorGerencial => !!i);
    if (escolhidos.length) return escolhidos.slice(0, n);
  }
  const ruins = comGrafico.filter((i) => ["vermelho", "amarelo"].includes(situacao(i)));
  return [...ruins, ...comGrafico.filter((i) => !ruins.includes(i))].slice(0, n);
}

/** "Onde agir agora": fora da meta e atenção, com onde, causa e responsável. */
export function ondeAgir(p: PainelGerencial, n = 6): IndicadorGerencial[] {
  return indicadoresDaTv(p).filter((i) => ["vermelho", "amarelo"].includes(situacao(i))).slice(0, n);
}

/** Tendência utilizável: pelo menos 2 meses e algum valor diferente de zero. */
export function tendenciaValida(t: TendenciaPainel | null | undefined): t is TendenciaPainel {
  return !!t && !t.erro && Array.isArray(t.meses) && t.meses.length >= 2 && t.meses.some((m) => (Number(m.a) || 0) > 0 || (Number(m.b) || 0) > 0);
}

// ---- Indicador sozinho na TV (relatorio "ind:<codigo>") ----------------------
export const PREFIXO_INDICADOR = "ind:";
export const ehIndicadorAvulso = (slug: string | null | undefined) => !!slug && slug.startsWith(PREFIXO_INDICADOR);
export const codigoDoIndicador = (slug: string | null | undefined) => (ehIndicadorAvulso(slug) ? slug!.slice(PREFIXO_INDICADOR.length) : null);
