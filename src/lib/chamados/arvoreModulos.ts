// =====================================================================
// MÓDULOS IMPACTADOS EM ÁRVORE (SIS-2026-0921, 17/11/2026) — regras puras.
//
// Pedido da Controladoria (YURI ROSA): "Módulos do sistema impactados" só
// oferecia opções amplas (Controladoria & Orçamento, Financeiro...). Agora a
// escolha é Setor do ERP → telas dele, "exatamente como é a barra lateral do
// sistema", amarrada a ela: tela nova, removida ou mudada de lugar reflete
// sozinha. Por isso NÃO existe lista própria aqui: a árvore é montada a partir
// dos módulos que a própria barra lateral desenha — o catálogo NAV_MODULOS
// (Sidebar.tsx) passado pela organização salva em Sistemas › Organizar Menu
// Lateral (useMenuLateral / montarMenu). Quem liga as duas pontas é
// src/pages/chamados/impacto/catalogoTelas.ts.
//
// O QUE É GRAVADO: a ROTA da tela ("/app/controladoria/lucratividade-contratos")
// em CHAMADO_SISTEMA.modulos_impactados (e em modulo_sistema, a posição). A
// rota é o que identifica a tela na barra lateral (estrutura.ts) e em app_menu
// (app_menu.rota); o NOME e o SETOR vêm da árvore na hora de mostrar. Assim:
//   · renomear a tela ou movê-la de setor no menu muda o rótulo dos chamados
//     antigos junto, sem migrar dado;
//   · a mesma tela copiada em dois setores do menu é UMA tela — conta uma vez
//     nos indicadores (o rótulo usa o primeiro setor em que ela aparece);
//   · tela que saiu do menu continua aparecendo, pelo endereço.
//
// COMPATIBILIDADE: chamados abertos antes têm valores amplos (o `value` de
// MODULOS_ERP: "controladoria", "financeiro"...). Eles não começam com "/app",
// então convivem: o rótulo antigo continua vindo de MODULOS_ERP (quem chama
// passa `rotuloLegado`) e o Monitoramento mostra os dois lado a lado.
// =====================================================================

/** Ícone de setor (o mesmo componente lucide da barra lateral). */
export type IconeSetor = ComponentType<{ className?: string }>;

import type { ComponentType } from "react";

/** O que a árvore precisa de um módulo da barra lateral (forma de ModuloCatalogo). */
export interface ModuloMenu {
  id: string;
  label: string;
  icon?: IconeSetor;
  status?: "active" | "soon";
  groups?: { label: string; items: { label: string; to: string }[] }[];
}

export interface TelaArvore {
  /** Rota da tela — o valor gravado no chamado. */
  rota: string;
  rotulo: string;
  /** Categoria da barra lateral dentro do setor ("Cadastros Mestres", "Ferramentas"...). */
  categoria: string;
}

export interface SetorArvore {
  id: string;
  rotulo: string;
  /** Ícone do setor na barra lateral (iconeDoModulo). */
  icone?: IconeSetor;
  telas: TelaArvore[];
}

export interface InfoTela {
  rota: string;
  rotulo: string;
  setorId: string;
  setor: string;
}

/** Separador de "Setor › Tela" nos rótulos. */
export const SEPARADOR_SETOR = " › ";

/** O valor é uma tela do menu (rota) e não um módulo amplo antigo? */
export const ehTela = (v: string | null | undefined) => !!v && /^\/app(\/|\?|$)/.test(v.trim());

/**
 * A árvore Setor → telas, na ORDEM da barra lateral (montarMenu já devolve os
 * módulos na ordem salva). Módulo "em breve" ou sem tela fica de fora; dentro
 * do setor, uma tela aparece uma vez só (cópias na mesma posição repetem rota).
 */
export function montarArvoreModulos(modulos: readonly ModuloMenu[]): SetorArvore[] {
  const saida: SetorArvore[] = [];
  for (const m of modulos) {
    if (m.status === "soon") continue;
    const vistas = new Set<string>();
    const telas: TelaArvore[] = [];
    for (const g of m.groups ?? []) {
      for (const it of g.items) {
        const rota = it.to?.trim();
        if (!ehTela(rota) || vistas.has(rota)) continue;
        vistas.add(rota);
        telas.push({ rota, rotulo: it.label?.trim() || rota, categoria: g.label });
      }
    }
    if (telas.length) saida.push({ id: m.id, rotulo: m.label, icone: m.icon, telas });
  }
  return saida;
}

/**
 * Valor amplo antigo (MODULOS_ERP) → id do setor da barra lateral em que ele
 * mora hoje. Serve SÓ para juntar chamado antigo com novo no Monitoramento
 * ("financeiro" e "/app/financeiro/..." são o mesmo setor Financeiro) — não é
 * catálogo: o nome do setor continua vindo da barra. "integracao" e "outro"
 * não têm setor e ficam à parte. Valor sem setor na árvore atual também.
 */
export const SETOR_DO_MODULO_ANTIGO: Readonly<Record<string, string>> = {
  power_bi: "bi",
  bi: "bi",
  licitacoes: "licitacoes",
  controladoria: "controladoria_orc",
  suprimentos: "suprimentos",
  financeiro: "financeiro",
  fiscal: "fiscal",
  contabil: "contabil",
  rh: "rh",
  recrutamento: "recrutamento",
  juridico: "juridico",
  sst: "sst",
  encarregados: "encarregados",
  central_servicos: "central_servicos",
  sistemas: "sistemas",
  plano_acoes: "plano-acoes",
  malote: "malote",
};

/**
 * Valor gravado → tela/setor: as rotas da árvore (tela que aparece em mais de
 * um setor fica com o primeiro) e os valores amplos antigos que têm setor na
 * árvore (SETOR_DO_MODULO_ANTIGO; aí `rotulo` é o nome do setor).
 */
export function indexarArvore(arvore: readonly SetorArvore[]): Map<string, InfoTela> {
  const idx = new Map<string, InfoTela>();
  for (const s of arvore)
    for (const t of s.telas)
      if (!idx.has(t.rota)) idx.set(t.rota, { rota: t.rota, rotulo: t.rotulo, setorId: s.id, setor: s.rotulo });
  const setores = new Map(arvore.map((s) => [s.id, s.rotulo]));
  for (const [antigo, setorId] of Object.entries(SETOR_DO_MODULO_ANTIGO)) {
    const setor = setores.get(setorId);
    if (setor && !idx.has(antigo)) idx.set(antigo, { rota: antigo, rotulo: setor, setorId, setor });
  }
  return idx;
}

/** Tela que saiu do menu: mostra o endereço, para não sumir do chamado. */
export const rotuloTelaForaDoMenu = (rota: string) => `Tela fora do menu (${rota})`;

/**
 * Rótulo de um valor gravado: "Setor › Tela" para rota; para valor antigo
 * (amplo), o `rotuloLegado` (MODULOS_ERP) — e o valor cru se nem ele souber.
 */
export function rotuloModulo(
  v: string,
  idx: ReadonlyMap<string, InfoTela>,
  rotuloLegado: (v: string) => string | undefined = () => undefined,
): string {
  const valor = v.trim();
  if (ehTela(valor)) {
    const t = idx.get(valor);
    return t ? `${t.setor}${SEPARADOR_SETOR}${t.rotulo}` : rotuloTelaForaDoMenu(valor);
  }
  // Valor antigo: o rótulo de antes (ele dizia o setor inteiro), senão o
  // nome do setor da barra, senão o valor cru.
  return rotuloLegado(valor) ?? idx.get(valor)?.setor ?? valor;
}

/**
 * Setor (da barra lateral) de um valor gravado — tela ou valor amplo antigo
 * que tem setor (SETOR_DO_MODULO_ANTIGO). null para tela fora do menu e
 * valor antigo sem setor ("integracao").
 */
export const setorDoModulo = (v: string, idx: ReadonlyMap<string, InfoTela>) =>
  idx.get(v.trim()) ?? null;

// ---- Seleção -----------------------------------------------------------

/** Liga/desliga uma tela na seleção, mantendo a ordem de escolha. A posição nunca sai. */
export function alternarTela(selecao: readonly string[], rota: string, posicao?: string | null): string[] {
  if (selecao.includes(rota)) return rota === posicao?.trim() ? [...selecao] : selecao.filter((v) => v !== rota);
  return [...selecao, rota];
}

/** Quantas telas de cada setor estão marcadas (o contador ao lado do setor). */
export function marcadasPorSetor(arvore: readonly SetorArvore[], selecao: readonly string[]): Map<string, number> {
  const sel = new Set(selecao);
  return new Map(arvore.map((s) => [s.id, s.telas.filter((t) => sel.has(t.rota)).length]));
}

const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/**
 * Busca: setores cujo nome casa entram inteiros; nos demais, só as telas que
 * casam (nome da tela ou da categoria). Termo vazio devolve a árvore.
 */
export function filtrarArvore(arvore: readonly SetorArvore[], termo: string): SetorArvore[] {
  const q = semAcento(termo.trim());
  if (!q) return [...arvore];
  const out: SetorArvore[] = [];
  for (const s of arvore) {
    if (semAcento(s.rotulo).includes(q)) { out.push(s); continue; }
    const telas = s.telas.filter((t) => semAcento(t.rotulo).includes(q) || semAcento(t.categoria).includes(q));
    if (telas.length) out.push({ ...s, telas });
  }
  return out;
}

// ---- Monitoramento -------------------------------------------------------

/** Prefixo do valor de filtro que pega um SETOR inteiro ("todas as telas de Controladoria"). */
export const PREFIXO_FILTRO_SETOR = "setor:";

/**
 * O chamado atinge o filtro de módulo? Valor comum = a tela/módulo exato;
 * `setor:<id>` = qualquer tela daquele setor da barra lateral.
 */
export function atingeModulo(
  modulos: readonly string[] | null | undefined,
  filtro: string,
  todos: string,
  idx: ReadonlyMap<string, InfoTela>,
): boolean {
  if (filtro === todos) return true;
  const xs = modulos ?? [];
  if (filtro.startsWith(PREFIXO_FILTRO_SETOR)) {
    const id = filtro.slice(PREFIXO_FILTRO_SETOR.length);
    return xs.some((m) => setorDoModulo(m, idx)?.setorId === id);
  }
  return xs.includes(filtro);
}

export interface ContagemSetor {
  /** Valor para o filtro (`setor:<id>`, ou o valor antigo/tela fora do menu como está). */
  valor: string;
  rotulo: string;
  /** Chamados que impactam alguma tela do setor (um chamado conta uma vez por setor). */
  qtd: number;
}

/**
 * Setores da barra lateral mais impactados: cada chamado conta uma vez em
 * cada setor em que marcou alguma tela. Valor antigo (amplo) vira o próprio
 * "setor", com o rótulo antigo — chamados de antes continuam no gráfico.
 */
export function contarPorSetor(
  listas: readonly (readonly string[])[],
  idx: ReadonlyMap<string, InfoTela>,
  rotuloLegado: (v: string) => string | undefined = () => undefined,
): ContagemSetor[] {
  const mapa = new Map<string, ContagemSetor>();
  for (const lista of listas) {
    const doChamado = new Map<string, string>();
    for (const m of lista) {
      const t = setorDoModulo(m, idx);
      if (t) doChamado.set(`${PREFIXO_FILTRO_SETOR}${t.setorId}`, t.setor);
      else doChamado.set(m, rotuloModulo(m, idx, rotuloLegado));
    }
    for (const [valor, rotulo] of doChamado) {
      const c = mapa.get(valor) ?? { valor, rotulo, qtd: 0 };
      c.qtd += 1;
      mapa.set(valor, c);
    }
  }
  return [...mapa.values()].sort((a, b) => b.qtd - a.qtd || a.rotulo.localeCompare(b.rotulo, "pt-BR"));
}

// ---- Registro (para rótulos fora de componente) --------------------------
//
// moduloLabel()/rotuloModuloImpactado() são funções comuns, chamadas em lista,
// CSV e tela de outros módulos (Hora Extra, Presidência). Elas leem o índice
// registrado aqui: catalogoTelas.ts registra o catálogo da barra lateral ao
// ser importado e o hook useArvoreModulos registra de novo com a organização
// salva (nomes e setores como o usuário vê). Sem registro, a rota aparece
// como "Tela fora do menu (...)" — nunca some.

// A Sidebar registra de novo quando a organização salva chega; quem
// desenha rótulo com o índice global e precisa acompanhar usa
// `assinarIndiceDasTelas` (useIndiceDasTelas, em catalogoTelas.ts).

let indiceRegistrado: ReadonlyMap<string, InfoTela> = new Map();
let assinaturaRegistrada = "";
const ouvintes = new Set<() => void>();

const assinaturaDe = (arvore: readonly SetorArvore[]) =>
  arvore.map((s) => `${s.id}=${s.rotulo}:${s.telas.map((t) => `${t.rota}|${t.rotulo}`).join(",")}`).join(";");

export function registrarArvoreModulos(arvore: readonly SetorArvore[]) {
  const assinatura = assinaturaDe(arvore);
  if (assinatura === assinaturaRegistrada) return; // mesma árvore: não acorda ninguém
  assinaturaRegistrada = assinatura;
  indiceRegistrado = indexarArvore(arvore);
  ouvintes.forEach((f) => f());
}

export const indiceDasTelas = () => indiceRegistrado;

export function assinarIndiceDasTelas(f: () => void) {
  ouvintes.add(f);
  return () => { ouvintes.delete(f); };
}
