// =====================================================================
// IMPACTO SISTÊMICO DO CHAMADO (SIS-2026-0910, 17/11/2026) — regras puras.
//
// Pedido da Controladoria (YURI ROSA): o campo único "Módulo / Sistema" da
// abertura não dizia se era o módulo ONDE a mudança é feita, o módulo
// alterado ou todos os afetados. Agora são três informações separadas:
//
//   · POSIÇÃO — o novo módulo ou o módulo diretamente ajustado (onde o
//     código muda). É a coluna que já existia, CHAMADO_SISTEMA.modulo_sistema
//     (+ modulo_sistema_outro quando "Outro"): nada migrou de lugar, só o
//     rótulo ficou explícito.
//   · MÓDULOS IMPACTADOS — todos os módulos a considerar em desenvolvimento,
//     integração, teste e homologação (CHAMADO_SISTEMA.modulos_impactados,
//     mig 20261115001000). A posição entra sempre nesta lista (o exemplo do
//     pedido: ajuste em Fluxo de Caixa → Fluxo de Caixa também é impactado).
//   · SETORES IMPACTADOS — setores cujos processos/informações mudam
//     (CHAMADO_SISTEMA.setores_impactados).
//
// Os módulos são TEXTO: o `value` de MODULOS_ERP nos chamados antigos e, desde
// o SIS-2026-0921, a ROTA da tela escolhida em Setor → telas da barra lateral
// (lib/chamados/arvoreModulos.ts). Nada aqui supõe o catálogo — o rótulo vem de fora (`rotulo`) e valor
// desconhecido aparece como está, então valores novos e antigos convivem.
//
// As análises (Monitoramento de Chamados) contam só chamados que trazem o
// impacto preenchido; os abertos antes do formulário aparecem à parte, como
// "sem impacto informado", para não fingir abrangência 1.
// =====================================================================

/** Valor da posição que pede texto livre e não é módulo do catálogo. */
export const POSICAO_OUTRO = "outro";

/** Trim, sem vazios e sem repetidos, mantendo a ordem de escolha. */
export function normalizarLista(xs: readonly (string | null | undefined)[] | null | undefined): string[] {
  const vistos = new Set<string>();
  const saida: string[] = [];
  for (const x of xs ?? []) {
    const v = (x ?? "").trim();
    if (!v || vistos.has(v)) continue;
    vistos.add(v);
    saida.push(v);
  }
  return saida;
}

/** A posição é um módulo do catálogo (e não vazia/"Outro")? */
export const posicaoEhModulo = (posicao: string | null | undefined) =>
  !!posicao?.trim() && posicao.trim() !== POSICAO_OUTRO;

/**
 * Garante a posição entre os módulos impactados, em primeiro lugar quando
 * entra agora. O trigger da mig 20261117181000 faz o mesmo no banco, mas só
 * em lista não vazia (chamado antigo sem impacto informado segue sem); aqui a
 * lista vazia também ganha a posição — é o que pré-preenche o formulário.
 */
export function incluirPosicao(modulos: readonly string[] | null | undefined, posicao: string | null | undefined): string[] {
  const lista = normalizarLista(modulos);
  if (!posicaoEhModulo(posicao)) return lista;
  const p = (posicao as string).trim();
  return lista.includes(p) ? lista : [p, ...lista];
}

/**
 * Ao trocar a posição no formulário: sai a posição anterior SE ela só estava
 * na lista por ter sido a posição (foi incluída automaticamente), entra a nova.
 * `anteriorAutomatica` = a anterior foi posta pela própria troca, não escolhida.
 */
export function trocarPosicao(
  modulos: readonly string[], anterior: string, nova: string, anteriorAutomatica: boolean,
): string[] {
  const base = anteriorAutomatica && anterior !== nova ? modulos.filter((m) => m !== anterior) : [...modulos];
  return incluirPosicao(base, nova);
}

export interface ImpactoFormulario {
  modulos: readonly string[];
  setores: readonly string[];
  posicao: string;
  posicaoOutro: string;
}

/** O que falta no bloco de impacto (rótulo = o mesmo da tela), na ordem do formulário. */
export function pendenciasImpacto(f: ImpactoFormulario): { id: string; label: string }[] {
  const p: { id: string; label: string }[] = [];
  if (normalizarLista(f.modulos).length === 0) p.push({ id: "campo-modulos-impactados", label: "Módulos do sistema impactados" });
  if (normalizarLista(f.setores).length === 0) p.push({ id: "campo-setores-impactados", label: "Setores impactados" });
  if (!f.posicao.trim()) p.push({ id: "campo-modulo", label: "Posição do novo módulo ou módulo diretamente ajustado" });
  else if (f.posicao === POSICAO_OUTRO && !f.posicaoOutro.trim()) p.push({ id: "campo-modulo", label: "Qual sistema (Outro)" });
  return p;
}

/** Os módulos impactados separados entre "diretamente ajustado" e "demais impactados". */
export function separarModulos(modulos: readonly string[] | null | undefined, posicao: string | null | undefined) {
  const lista = normalizarLista(modulos);
  const p = posicaoEhModulo(posicao) ? (posicao as string).trim() : null;
  return {
    ajustado: p && lista.includes(p) ? p : null,
    demais: lista.filter((m) => m !== p),
  };
}

// ---- Análises do Monitoramento --------------------------------------

/** O mínimo de um chamado que as análises leem (linha da RPC chamados_monitoramento). */
export interface ChamadoImpacto {
  id: string;
  status: string;
  modulo_sistema: string | null;
  modulos_impactados?: string[] | null;
  setores_impactados?: string[] | null;
}

export interface ContagemImpacto {
  valor: string;
  /** Chamados que impactam esse módulo/setor. */
  qtd: number;
  /** Desses, em quantos ele é a posição (módulo diretamente ajustado). Só módulos. */
  comoPosicao: number;
  /** Desses, quantos ainda não foram concluídos/reprovados (vão a teste/homologação). */
  emAberto: number;
}

export interface FaixaAbrangencia { faixa: string; qtd: number }

export interface AnaliseImpacto {
  /** Chamados com impacto informado (1+ módulo e 1+ setor). */
  comImpacto: number;
  /** Chamados sem impacto informado (abertos antes do formulário). */
  semImpacto: number;
  modulos: ContagemImpacto[];
  setores: ContagemImpacto[];
  /** Média de módulos impactados por chamado (só os com impacto). */
  abrangenciaMedia: number | null;
  abrangenciaMaxima: number;
  faixas: FaixaAbrangencia[];
  /** Setores que têm chamados ainda não encerrados — onde haverá homologação. */
  homologacao: ContagemImpacto[];
}

/** Status que já não vão a teste/homologação. */
const ENCERRADOS = new Set(["concluido", "reprovado", "cancelado"]);
export const emAberto = (status: string) => !ENCERRADOS.has(status);

export const FAIXAS_ABRANGENCIA = [
  { faixa: "1 módulo", min: 1, max: 1 },
  { faixa: "2 a 3 módulos", min: 2, max: 3 },
  { faixa: "4 a 5 módulos", min: 4, max: 5 },
  { faixa: "6 ou mais", min: 6, max: Infinity },
] as const;

const ordenar = (a: ContagemImpacto, b: ContagemImpacto) => b.qtd - a.qtd || b.comoPosicao - a.comoPosicao || a.valor.localeCompare(b.valor, "pt-BR");

/** Contagens para o bloco "Impacto sistêmico" do Monitoramento. */
export function analisarImpacto(chamados: readonly ChamadoImpacto[]): AnaliseImpacto {
  const mods = new Map<string, ContagemImpacto>();
  const sets = new Map<string, ContagemImpacto>();
  const tamanhos: number[] = [];
  let semImpacto = 0;

  const conta = (mapa: Map<string, ContagemImpacto>, valor: string, aberto: boolean, posicao: boolean) => {
    const c = mapa.get(valor) ?? { valor, qtd: 0, comoPosicao: 0, emAberto: 0 };
    c.qtd += 1;
    if (posicao) c.comoPosicao += 1;
    if (aberto) c.emAberto += 1;
    mapa.set(valor, c);
  };

  for (const ch of chamados) {
    const setores = normalizarLista(ch.setores_impactados);
    const modulosInformados = normalizarLista(ch.modulos_impactados);
    if (modulosInformados.length === 0 || setores.length === 0) { semImpacto += 1; continue; }
    // A posição conta como impactada mesmo em chamado gravado antes do trigger.
    const modulos = incluirPosicao(modulosInformados, ch.modulo_sistema);
    const aberto = emAberto(ch.status);
    const posicao = posicaoEhModulo(ch.modulo_sistema) ? (ch.modulo_sistema as string).trim() : null;
    modulos.forEach((m) => conta(mods, m, aberto, m === posicao));
    setores.forEach((s) => conta(sets, s, aberto, false));
    tamanhos.push(modulos.length);
  }

  const setores = [...sets.values()].sort(ordenar);
  return {
    comImpacto: tamanhos.length,
    semImpacto,
    modulos: [...mods.values()].sort(ordenar),
    setores,
    abrangenciaMedia: tamanhos.length ? Math.round((tamanhos.reduce((s, n) => s + n, 0) / tamanhos.length) * 10) / 10 : null,
    abrangenciaMaxima: tamanhos.length ? Math.max(...tamanhos) : 0,
    faixas: FAIXAS_ABRANGENCIA.map((f) => ({ faixa: f.faixa, qtd: tamanhos.filter((n) => n >= f.min && n <= f.max).length })),
    homologacao: setores.filter((s) => s.emAberto > 0)
      .sort((a, b) => b.emAberto - a.emAberto || a.valor.localeCompare(b.valor, "pt-BR")),
  };
}

/** Nº de módulos impactados do chamado (abrangência), contando a posição; null = não informado. */
export function abrangencia(ch: ChamadoImpacto): number | null {
  const m = normalizarLista(ch.modulos_impactados);
  return m.length ? incluirPosicao(m, ch.modulo_sistema).length : null;
}
