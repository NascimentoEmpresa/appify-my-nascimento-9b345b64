import { Circle, FolderClosed, type LucideIcon } from "lucide-react";

/**
 * SIS-2026-0772 (fase 2, pedido do Iury, gerente de sistemas, 05/11/2026):
 * menu lateral organizável por tela — Sistemas › Organizar Menu Lateral.
 *
 * O QUE ISTO É: só o LUGAR onde cada tela aparece no menu (módulo, categoria,
 * ordem, nome exibido). A organização salva mora em "MENU_LATERAL_VERSAO"
 * (mig 20261105040000), uma linha por gravação — o histórico é a tabela.
 *
 * O QUE ISTO NÃO É: permissão. Quem vê cada tela continua sendo decidido pelo
 * ENDEREÇO dela (Sidebar.canSee / RouteGuard → matchMenuCode →
 * list_accessible_menus). Por isso:
 *   · mover ou copiar uma entrada não dá acesso a ninguém — a tela só aparece
 *     no lugar novo para quem já tinha permissão nela;
 *   · tirar do menu não bloqueia — quem tem permissão abre pelo endereço;
 *   · "novo submódulo" é ATALHO para uma tela que já existe, nunca uma tela
 *     nova, e só aceita endereço interno (/app…) — o banco recusa o resto;
 *   · nada aqui toca app_menu.modulo_id. Isso é proposital e é a cerca mais
 *     importante: o perfil de módulo (perfil_acesso.modulo_codigo) libera TUDO
 *     o que pertence ao módulo no banco — em 05/11/2026 eram 83 encarregados
 *     no de Encarregados. Se "mover para Encarregados" trocasse o modulo_id,
 *     os 83 ganhariam a tela na hora, sem ninguém perceber.
 *
 * O CATÁLOGO (Sidebar.tsx, NAV_MODULOS_ORIGEM) continua sendo a fonte das
 * telas que existem: ícone, bolinha de notificação e selo vêm dele pela rota.
 * Tela que os devs criarem depois de uma organização salva aparece sozinha no
 * módulo de origem (ver `rotasConhecidas`) — nenhuma tela some do menu por
 * alguém ter salvo a organização antes de ela existir.
 */

// ── Formato salvo (jsonb em "MENU_LATERAL_VERSAO".estrutura) ──────────────────

export interface ItemEstrutura {
  id: string;
  rota: string;
  /** Só quando renomeado ou criado no editor; sem ele vale o nome do catálogo. */
  rotulo?: string;
  /** Id do item do padrão de onde veio (entrada original ou cópia dela). */
  ref?: string;
  /** Preenchido nas cópias: id da entrada copiada. */
  copiaDe?: string;
}

export interface CategoriaEstrutura {
  id: string;
  rotulo: string;
  itens: ItemEstrutura[];
}

export interface ModuloEstrutura {
  id: string;
  rotulo: string;
  /** Id do módulo do catálogo de onde veio; null para módulo criado no editor. */
  origem: string | null;
  categorias: CategoriaEstrutura[];
}

export interface EstruturaMenu {
  modulos: ModuloEstrutura[];
  /** Rotas do catálogo no momento da gravação — o que não está aqui é tela nova. */
  rotasConhecidas: string[];
}

// ── Catálogo (formato da Sidebar) ────────────────────────────────────────────

export interface ItemCatalogo {
  label: string;
  to: string;
  icon: LucideIcon;
}

export interface GrupoCatalogo<I extends ItemCatalogo = ItemCatalogo> {
  label: string;
  items: I[];
  defaultOpen?: boolean;
}

export interface ModuloCatalogo<I extends ItemCatalogo = ItemCatalogo> {
  id: string;
  label: string;
  description: string;
  icon: LucideIcon;
  basePath: string;
  status: "active" | "soon";
  groups?: GrupoCatalogo<I>[];
  headerLink?: string;
}

/** Endereço aceito numa entrada do menu. A mesma regra está no banco (menu_lateral_salvar). */
export const ROTA_VALIDA = /^\/app(\/|\?|$)/;
export const ROTULO_MAX = 120;

const porNome = (a: string, b: string) => a.localeCompare(b, "pt-BR", { sensitivity: "base" });

/** Id estável de uma entrada do padrão: módulo + rota (+ #n se a rota repetir no módulo). */
function idPadrao(modId: string, rota: string, n: number) {
  return n === 0 ? `${modId}|${rota}` : `${modId}|${rota}#${n + 1}`;
}

interface EntradaCatalogo<I extends ItemCatalogo> {
  item: I;
  modId: string;
  grupo: string;
}

/**
 * Lê o catálogo uma vez: entradas por id do padrão e a primeira por rota.
 * A página-hub (headerLink) que não é item vira entrada do primeiro grupo — no
 * menu novo o cabeçalho do módulo abre o painel, não navega.
 */
function indexar<I extends ItemCatalogo>(catalogo: ModuloCatalogo<I>[]) {
  const porRef = new Map<string, EntradaCatalogo<I>>();
  const porRota = new Map<string, EntradaCatalogo<I>>();
  const grupos = new Map<string, { label: string; refs: string[] }[]>();

  for (const mod of catalogo) {
    const vistos = new Map<string, number>();
    const gruposMod: { label: string; refs: string[] }[] = [];
    const hubFora =
      mod.headerLink && mod.headerLink !== "/app" &&
      !(mod.groups ?? []).some((g) => g.items.some((i) => i.to === mod.headerLink));

    (mod.groups ?? []).forEach((g, gi) => {
      const itens = [...g.items];
      if (gi === 0 && hubFora) itens.unshift({ label: mod.label, to: mod.headerLink!, icon: mod.icon } as I);
      const refs: string[] = [];
      for (const item of itens) {
        const n = vistos.get(item.to) ?? 0;
        vistos.set(item.to, n + 1);
        const ref = idPadrao(mod.id, item.to, n);
        const entrada = { item, modId: mod.id, grupo: g.label };
        porRef.set(ref, entrada);
        if (!porRota.has(item.to)) porRota.set(item.to, entrada);
        refs.push(ref);
      }
      gruposMod.push({ label: g.label, refs });
    });
    grupos.set(mod.id, gruposMod);
  }
  return { porRef, porRota, grupos };
}

/** O menu de antes de qualquer organização: os módulos do catálogo, tudo em ordem alfabética. */
export function estruturaPadrao<I extends ItemCatalogo>(catalogo: ModuloCatalogo<I>[]): EstruturaMenu {
  const { porRef, grupos } = indexar(catalogo);
  const modulos: ModuloEstrutura[] = catalogo
    .filter((m) => m.status === "active" && (m.groups ?? []).length > 0)
    .map((mod) => ({
      id: `m:${mod.id}`,
      rotulo: mod.label,
      origem: mod.id,
      categorias: (grupos.get(mod.id) ?? [])
        .map((g, gi) => ({
          id: `c:${mod.id}:${gi}`,
          rotulo: g.label,
          itens: g.refs
            .map((ref) => ({ id: ref, rota: porRef.get(ref)!.item.to, ref }))
            .sort((a, b) => porNome(porRef.get(a.ref)!.item.label, porRef.get(b.ref)!.item.label)),
        }))
        .sort((a, b) => porNome(a.rotulo, b.rotulo)),
    }))
    .sort((a, b) => porNome(a.rotulo, b.rotulo));
  return { modulos, rotasConhecidas: [...new Set([...porRef.values()].map((e) => e.item.to))] };
}

type Indice<I extends ItemCatalogo> = ReturnType<typeof indexar<I>>;

function rotuloCom<I extends ItemCatalogo>(item: ItemEstrutura, idx: Indice<I>): string {
  if (item.rotulo) return item.rotulo;
  return (item.ref && idx.porRef.get(item.ref)?.item.label) || idx.porRota.get(item.rota)?.item.label || item.rota;
}

/** O mesmo que rotuloDoItem, lendo o catálogo uma vez só (para listas grandes, como o editor). */
export function criarResolvedorDeRotulo<I extends ItemCatalogo>(catalogo: ModuloCatalogo<I>[]) {
  const idx = indexar(catalogo);
  return (item: ItemEstrutura) => rotuloCom(item, idx);
}

/** Telas que o catálogo conhece, para escolher ao criar um atalho: rota, nome e módulo de origem. */
export function telasDoCatalogo<I extends ItemCatalogo>(catalogo: ModuloCatalogo<I>[]) {
  const { porRota } = indexar(catalogo);
  const nomeModulo = new Map(catalogo.map((m) => [m.id, m.label]));
  return [...porRota.values()]
    .map((e) => ({ rota: e.item.to, nome: e.item.label, modulo: nomeModulo.get(e.modId) ?? "" }))
    .sort((a, b) => porNome(a.nome, b.nome));
}

/** Nome exibido de uma entrada: o renomeado, senão o do catálogo, senão o endereço. */
export function rotuloDoItem<I extends ItemCatalogo>(item: ItemEstrutura, catalogo: ModuloCatalogo<I>[]): string {
  return rotuloCom(item, indexar(catalogo));
}

/**
 * Coloca na estrutura as telas que o catálogo tem e a organização salva não
 * conhecia (criadas depois): no módulo de origem, na categoria de mesmo nome
 * (ou na primeira), em posição alfabética. Sem o módulo de origem, num módulo
 * "Novas telas". Não mexe nas que foram retiradas de propósito.
 */
export function incluirTelasNovas<I extends ItemCatalogo>(e: EstruturaMenu, catalogo: ModuloCatalogo<I>[]): EstruturaMenu {
  const idx = indexar(catalogo);
  const { porRef } = idx;
  const conhecidas = new Set(e.rotasConhecidas);
  const novas = [...porRef.entries()].filter(([, ent]) => !conhecidas.has(ent.item.to));
  if (novas.length === 0) return e;

  const saida: EstruturaMenu = structuredClone(e);
  const jaPostas = new Set<string>();
  for (const [ref, ent] of novas) {
    if (jaPostas.has(ent.item.to)) continue;
    jaPostas.add(ent.item.to);
    let mod = saida.modulos.find((m) => m.origem === ent.modId);
    if (!mod) {
      mod = saida.modulos.find((m) => m.id === "m:novas-telas");
      if (!mod) {
        mod = { id: "m:novas-telas", rotulo: "Novas telas", origem: null, categorias: [] };
        saida.modulos.push(mod);
      }
    }
    let cat = mod.categorias.find((c) => porNome(c.rotulo, ent.grupo) === 0) ?? mod.categorias[0];
    if (!cat) {
      cat = { id: `c:${mod.id}:novas`, rotulo: ent.grupo, itens: [] };
      mod.categorias.push(cat);
    }
    const novo: ItemEstrutura = { id: ref, rota: ent.item.to, ref };
    const pos = cat.itens.findIndex((i) => porNome(rotuloCom(i, idx), ent.item.label) > 0);
    cat.itens.splice(pos === -1 ? cat.itens.length : pos, 0, novo);
  }
  saida.rotasConhecidas = [...new Set([...saida.rotasConhecidas, ...jaPostas])];
  return saida;
}

/**
 * Estrutura → módulos no formato que a Sidebar e o Início desenham. Sem
 * estrutura salva, devolve o padrão. Ícone, bolinha e selo vêm do catálogo
 * pela rota (também nas cópias); entrada para tela fora do catálogo (atalho
 * para uma rota que só existe em app_menu) ganha ícone genérico.
 *
 * O id do módulo é o do catálogo quando há origem (o Início usa para a cor).
 */
export function montarMenu<I extends ItemCatalogo, M extends ModuloCatalogo<I>>(
  catalogo: M[],
  estrutura: EstruturaMenu | null,
): M[] {
  const e = incluirTelasNovas(estrutura ?? estruturaPadrao(catalogo), catalogo);
  const idx = indexar(catalogo);
  const { porRef, porRota } = idx;
  const catPorId = new Map(catalogo.map((m) => [m.id, m]));

  return e.modulos.map((m) => {
    const base = m.origem ? catPorId.get(m.origem) : undefined;
    const groups = m.categorias.map((c) => ({
      label: c.rotulo,
      items: c.itens.map((it) => {
        const ent = (it.ref && porRef.get(it.ref)) || porRota.get(it.rota);
        const doCatalogo = ent?.item ?? ({ label: it.rota, to: it.rota, icon: Circle } as unknown as I);
        return { ...doCatalogo, to: it.rota, label: rotuloCom(it, idx) } as I;
      }),
    }));
    return {
      ...(base ?? { description: "", icon: FolderClosed, basePath: "/app", status: "active" as const }),
      id: m.origem ?? m.id,
      label: m.rotulo,
      headerLink: undefined,
      groups,
    } as M;
  });
}

// ── Operações do editor (puras: devolvem uma estrutura nova) ──────────────────

function localizarItem(e: EstruturaMenu, itemId: string) {
  for (const m of e.modulos)
    for (const c of m.categorias) {
      const i = c.itens.findIndex((x) => x.id === itemId);
      if (i !== -1) return { m, c, i };
    }
  return null;
}

function categoria(e: EstruturaMenu, catId: string) {
  for (const m of e.modulos) for (const c of m.categorias) if (c.id === catId) return { m, c };
  return null;
}

const clamp = (n: number | undefined, max: number) => (n === undefined ? max : Math.max(0, Math.min(n, max)));

/** Move uma entrada para outra categoria (ou outra posição na mesma). */
export function moverItem(e: EstruturaMenu, itemId: string, destCatId: string, destIndex?: number): EstruturaMenu {
  const s = structuredClone(e);
  const org = localizarItem(s, itemId);
  const dst = categoria(s, destCatId);
  if (!org || !dst) return e;
  const [item] = org.c.itens.splice(org.i, 1);
  dst.c.itens.splice(clamp(destIndex, dst.c.itens.length), 0, item);
  return s;
}

/** Cópia: a original fica onde está e uma entrada nova, com o mesmo endereço, entra no destino. */
export function copiarItem(e: EstruturaMenu, itemId: string, destCatId: string, novoId: string, destIndex?: number): EstruturaMenu {
  const s = structuredClone(e);
  const org = localizarItem(s, itemId);
  const dst = categoria(s, destCatId);
  if (!org || !dst) return e;
  const orig = org.c.itens[org.i];
  const copia: ItemEstrutura = { id: novoId, rota: orig.rota, ref: orig.ref, copiaDe: orig.copiaDe ?? orig.id };
  if (orig.rotulo) copia.rotulo = orig.rotulo;
  dst.c.itens.splice(clamp(destIndex, dst.c.itens.length), 0, copia);
  return s;
}

export function moverModulo(e: EstruturaMenu, modId: string, destIndex: number): EstruturaMenu {
  const s = structuredClone(e);
  const i = s.modulos.findIndex((m) => m.id === modId);
  if (i === -1) return e;
  const [m] = s.modulos.splice(i, 1);
  s.modulos.splice(clamp(destIndex, s.modulos.length), 0, m);
  return s;
}

export function moverCategoria(e: EstruturaMenu, catId: string, destModId: string, destIndex?: number): EstruturaMenu {
  const s = structuredClone(e);
  const org = categoria(s, catId);
  const dst = s.modulos.find((m) => m.id === destModId);
  if (!org || !dst) return e;
  org.m.categorias.splice(org.m.categorias.indexOf(org.c), 1);
  dst.categorias.splice(clamp(destIndex, dst.categorias.length), 0, org.c);
  return s;
}

export function criarModulo(e: EstruturaMenu, rotulo: string, novoId: string): EstruturaMenu {
  const s = structuredClone(e);
  s.modulos.push({ id: novoId, rotulo: rotulo.trim(), origem: null, categorias: [] });
  return s;
}

export function criarCategoria(e: EstruturaMenu, modId: string, rotulo: string, novoId: string): EstruturaMenu {
  const s = structuredClone(e);
  const m = s.modulos.find((x) => x.id === modId);
  if (!m) return e;
  m.categorias.push({ id: novoId, rotulo: rotulo.trim(), itens: [] });
  return s;
}

/** "Novo submódulo": atalho para uma tela que já existe. */
export function criarAtalho(e: EstruturaMenu, catId: string, rota: string, rotulo: string, novoId: string): EstruturaMenu {
  if (!ROTA_VALIDA.test(rota)) return e;
  const s = structuredClone(e);
  const dst = categoria(s, catId);
  if (!dst) return e;
  dst.c.itens.push({ id: novoId, rota, rotulo: rotulo.trim() });
  return s;
}

/** Renomeia módulo, categoria ou entrada. Entrada com nome vazio volta ao nome do catálogo. */
export function renomear(e: EstruturaMenu, alvoId: string, rotulo: string): EstruturaMenu {
  const s = structuredClone(e);
  const nome = rotulo.trim();
  for (const m of s.modulos) {
    if (m.id === alvoId) { if (nome) m.rotulo = nome; return s; }
    for (const c of m.categorias) {
      if (c.id === alvoId) { if (nome) c.rotulo = nome; return s; }
      const it = c.itens.find((i) => i.id === alvoId);
      if (it) {
        if (nome) it.rotulo = nome;
        else if (it.ref) delete it.rotulo;
        return s;
      }
    }
  }
  return e;
}

/**
 * Tira do menu. Entrada: sai (a tela continua abrindo pelo endereço para quem
 * tem permissão). Módulo e categoria: só vazios — apagar uma pasta com telas
 * dentro sumiria com todas de uma vez.
 */
export function remover(e: EstruturaMenu, alvoId: string): EstruturaMenu {
  const s = structuredClone(e);
  const mi = s.modulos.findIndex((m) => m.id === alvoId);
  if (mi !== -1) {
    if (s.modulos[mi].categorias.some((c) => c.itens.length > 0)) return e;
    s.modulos.splice(mi, 1);
    return s;
  }
  for (const m of s.modulos) {
    const ci = m.categorias.findIndex((c) => c.id === alvoId);
    if (ci !== -1) {
      if (m.categorias[ci].itens.length > 0) return e;
      m.categorias.splice(ci, 1);
      return s;
    }
  }
  const org = localizarItem(s, alvoId);
  if (!org) return e;
  org.c.itens.splice(org.i, 1);
  return s;
}

/** Onde a entrada está hoje e onde estava no padrão. */
export type SituacaoItem = "original" | "movido" | "copiado" | "criado";

export function situacaoDoItem(item: ItemEstrutura, modulo: ModuloEstrutura, cat: CategoriaEstrutura, padrao: EstruturaMenu): SituacaoItem {
  if (item.copiaDe) return "copiado";
  if (!item.ref) return "criado";
  for (const m of padrao.modulos)
    for (const c of m.categorias)
      if (c.itens.some((i) => i.id === item.ref)) return m.origem === modulo.origem && c.rotulo === cat.rotulo ? "original" : "movido";
  return "original";
}

/** Volta a entrada (original, não cópia) para o módulo e a categoria do padrão. */
export function restaurarOriginal(e: EstruturaMenu, itemId: string, padrao: EstruturaMenu): EstruturaMenu {
  const org = localizarItem(e, itemId);
  if (!org || !org.c.itens[org.i].ref || org.c.itens[org.i].copiaDe) return e;
  const ref = org.c.itens[org.i].ref!;
  for (const pm of padrao.modulos)
    for (const pc of pm.categorias)
      if (pc.itens.some((i) => i.id === ref)) {
        const mod = e.modulos.find((m) => m.origem === pm.origem);
        const cat = mod?.categorias.find((c) => c.rotulo === pc.rotulo) ?? mod?.categorias[0];
        return cat ? moverItem(e, itemId, cat.id) : e;
      }
  return e;
}

// ── Validação (espelho do que menu_lateral_salvar confere no banco) ───────────

export function validarEstrutura(e: EstruturaMenu): string[] {
  const erros: string[] = [];
  if (!e || !Array.isArray(e.modulos)) return ["Estrutura sem a lista de módulos."];
  if (!Array.isArray(e.rotasConhecidas)) erros.push("Estrutura sem a lista de rotas conhecidas.");
  const ids = new Set<string>();
  const id = (x: string, onde: string) => {
    if (!x) erros.push(`${onde} sem id.`);
    else if (ids.has(x)) erros.push(`Id repetido: ${x}.`);
    else ids.add(x);
  };
  const rotulo = (r: string | undefined, onde: string, obrigatorio: boolean) => {
    if (r === undefined) { if (obrigatorio) erros.push(`${onde} sem nome.`); return; }
    if (!r.trim()) erros.push(`${onde} com nome vazio.`);
    else if (r.length > ROTULO_MAX) erros.push(`${onde} com nome acima de ${ROTULO_MAX} caracteres.`);
  };
  for (const m of e.modulos) {
    id(m.id, "Módulo");
    rotulo(m.rotulo, `Módulo ${m.id}`, true);
    for (const c of m.categorias ?? []) {
      id(c.id, "Categoria");
      rotulo(c.rotulo, `Categoria ${c.id}`, true);
      for (const i of c.itens ?? []) {
        id(i.id, "Entrada");
        rotulo(i.rotulo, `Entrada ${i.id}`, !i.ref);
        if (typeof i.rota !== "string" || !ROTA_VALIDA.test(i.rota)) erros.push(`Endereço não permitido: ${String(i.rota)}.`);
      }
    }
  }
  return erros;
}

/** Endereços em que o menu leva: usado no teste e na lista de telas do editor. */
export function rotasDaEstrutura(e: EstruturaMenu): string[] {
  return e.modulos.flatMap((m) => m.categorias.flatMap((c) => c.itens.map((i) => i.rota)));
}
