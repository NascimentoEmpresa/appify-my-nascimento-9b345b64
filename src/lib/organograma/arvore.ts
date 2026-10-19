// =====================================================================
// Organograma — montagem da árvore (16/10/2026, mig 20261016000030)
//
// Lógica pura (sem React) para a tela src/pages/organograma/Organograma.tsx.
//
// PARES NO MESMO NÍVEL — pedido do Pablo: "conectar ambos no mesmo nível de
// hierarquia, o bigode, guiomar e helena" (três cards soltos no topo, só a
// Helena com árvore). Irmãos (mesmo "reporta a") com o mesmo par_grupo formam
// um GRUPO: lado a lado, ligados por uma barra. Quem tem do_grupo = true
// responde ao grupo inteiro (a linha desce do meio do grupo); no banco o
// parent_id dele aponta para um dos pares, então ciclo e "apagar sobe os
// subordinados" continuam valendo. Grupo com um par só não é grupo: o card
// volta a ser comum e quem tinha do_grupo vira subordinado dele.
// =====================================================================

export interface NoBase {
  id: string; parent_id: string | null; ordem: number; nome: string; setor: string | null;
  par_grupo: string | null; do_grupo: boolean;
}

export interface Grupo<T extends NoBase> { chave: string; nome: string; membros: T[] }

export type Item<T extends NoBase> =
  | { tipo: "no"; no: T }
  | { tipo: "painel"; setor: string; membros: T[] }
  | { tipo: "grupo"; grupo: Grupo<T> };

const normal = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();

export interface Arvore<T extends NoBase> {
  porId: Map<string, T>;
  /** Grupo ativo (2+ pares) de que a pessoa faz parte. */
  grupoDe: (id: string) => Grupo<T> | undefined;
  /** Subordinados que descem do card da pessoa (sem quem responde ao grupo dela). */
  equipeDe: (id: string) => T[];
  /** Quem responde ao grupo inteiro, em ordem. */
  equipeDoGrupo: (g: Grupo<T>) => T[];
  /** Topo da árvore, já agrupado. */
  raiz: Item<T>[];
  /** Agrupa uma lista de irmãos: grupos de pares, quem tem equipe e painéis por setor. */
  itens: (irmaos: T[]) => Item<T>[];
  /** Irmãos da pessoa na ordem da tela (para mover à esquerda/direita), ela inclusa. */
  irmaosDe: (id: string) => T[];
  /** Quem responde ao grupo do chefe (do_grupo valendo). */
  respondeAoGrupo: (n: T) => boolean;
  /** Todos abaixo (pelo parent_id), sem a própria pessoa. */
  descendentes: (id: string) => Set<string>;
  /** Chaves de recolher que precisam abrir para a pessoa aparecer (cards e grupos acima). */
  caminhoAte: (id: string) => string[];
  /** Todas as chaves que têm algo para recolher (cards com equipe e grupos com equipe). */
  recolhiveis: () => string[];
}

export function montarArvore<T extends NoBase>(nos: T[]): Arvore<T> {
  const porId = new Map(nos.map((n) => [n.id, n]));
  const ordenar = (l: T[]) => l.sort((a, b) => a.ordem - b.ordem || a.nome.localeCompare(b.nome, "pt-BR"));

  // Filhos pelo parent_id (pai inexistente = topo).
  const filhos = new Map<string | null, T[]>();
  nos.forEach((n) => {
    const pai = n.parent_id && porId.has(n.parent_id) ? n.parent_id : null;
    filhos.set(pai, [...(filhos.get(pai) ?? []), n]);
  });
  filhos.forEach(ordenar);

  // Grupos: mesmo pai + mesmo do_grupo (o "contexto" dos irmãos) + mesmo nome.
  const contexto = (n: T): string => {
    const pai = n.parent_id && porId.has(n.parent_id) ? n.parent_id : null;
    return `${pai ?? "topo"}|${n.do_grupo ? 1 : 0}`;
  };
  const brutos = new Map<string, Grupo<T>>();
  nos.forEach((n) => {
    if (!normal(n.par_grupo)) return;
    const chave = `g:${contexto(n)}|${normal(n.par_grupo)}`;
    const g = brutos.get(chave) ?? { chave, nome: n.par_grupo!.trim(), membros: [] };
    g.membros.push(n);
    brutos.set(chave, g);
  });
  const grupoPorId = new Map<string, Grupo<T>>();
  brutos.forEach((g) => {
    if (g.membros.length < 2) return;
    ordenar(g.membros);
    g.membros.forEach((m) => grupoPorId.set(m.id, g));
  });
  const grupoDe = (id: string) => grupoPorId.get(id);

  // do_grupo só vale se o pai está num grupo ativo; senão é subordinado comum.
  const respondeAoGrupo = (n: T) => !!(n.do_grupo && n.parent_id && grupoPorId.has(n.parent_id));

  const equipeDe = (id: string) => (filhos.get(id) ?? []).filter((f) => !respondeAoGrupo(f));
  const equipeDoGrupo = (g: Grupo<T>) => ordenar(g.membros.flatMap((m) => (filhos.get(m.id) ?? []).filter(respondeAoGrupo)));

  const itens = (irmaos: T[]): Item<T>[] => {
    const out: Item<T>[] = [];
    const paineis = new Map<string, T[]>();
    const gruposVistos = new Set<string>();
    irmaos.forEach((n) => {
      const g = grupoPorId.get(n.id);
      if (g) {
        if (!gruposVistos.has(g.chave)) { gruposVistos.add(g.chave); out.push({ tipo: "grupo", grupo: g }); }
        return;
      }
      if (equipeDe(n.id).length) { out.push({ tipo: "no", no: n }); return; }
      const setor = n.setor?.trim() || "Sem setor";
      if (!paineis.has(setor)) { const membros: T[] = []; paineis.set(setor, membros); out.push({ tipo: "painel", setor, membros }); }
      paineis.get(setor)!.push(n);
    });
    return out;
  };

  // No topo não há painel: quem está lá sem equipe continua card próprio.
  const raiz: Item<T>[] = [];
  const gruposTopo = new Set<string>();
  (filhos.get(null) ?? []).forEach((n) => {
    const g = grupoPorId.get(n.id);
    if (!g) { raiz.push({ tipo: "no", no: n }); return; }
    if (!gruposTopo.has(g.chave)) { gruposTopo.add(g.chave); raiz.push({ tipo: "grupo", grupo: g }); }
  });

  const irmaosDe = (id: string): T[] => {
    const n = porId.get(id);
    if (!n) return [];
    const pai = n.parent_id && porId.has(n.parent_id) ? n.parent_id : null;
    if (!pai) return [...(filhos.get(null) ?? [])];
    return respondeAoGrupo(n) ? equipeDoGrupo(grupoPorId.get(pai)!) : equipeDe(pai);
  };

  const descendentes = (id: string): Set<string> => {
    const out = new Set<string>();
    const pilha = [id];
    while (pilha.length) {
      const atual = pilha.pop()!;
      (filhos.get(atual) ?? []).forEach((f) => { if (!out.has(f.id)) { out.add(f.id); pilha.push(f.id); } });
    }
    return out;
  };

  const caminhoAte = (id: string): string[] => {
    const out: string[] = [];
    let atual = porId.get(id);
    let passos = 0;
    while (atual?.parent_id && porId.has(atual.parent_id) && passos++ < 500) {
      out.push(respondeAoGrupo(atual) ? grupoPorId.get(atual.parent_id)!.chave : atual.parent_id);
      atual = porId.get(atual.parent_id);
    }
    return out;
  };

  const recolhiveis = (): string[] => {
    const out = nos.filter((n) => equipeDe(n.id).length).map((n) => n.id);
    new Set(grupoPorId.values()).forEach((g) => { if (equipeDoGrupo(g).length) out.push(g.chave); });
    return out;
  };

  return { porId, grupoDe, equipeDe, equipeDoGrupo, raiz, itens, irmaosDe, respondeAoGrupo, descendentes, caminhoAte, recolhiveis };
}

/** Chefe escolhido no seletor: uma pessoa, ou o grupo dela inteiro. */
export interface Chefe { parentId: string | null; doGrupo: boolean }

const PREFIXO_GRUPO = "grupo:";
export const valorChefe = (c: Chefe) => (c.parentId ? `${c.doGrupo ? PREFIXO_GRUPO : ""}${c.parentId}` : null);
export const lerValorChefe = (v: string | null): Chefe =>
  !v ? { parentId: null, doGrupo: false }
    : v.startsWith(PREFIXO_GRUPO) ? { parentId: v.slice(PREFIXO_GRUPO.length), doGrupo: true }
    : { parentId: v, doGrupo: false };

/** Chefe atual da pessoa como o seletor mostra: o grupo vira sempre o 1º par. */
export function chefeDoNo<T extends NoBase>(arv: Arvore<T>, n: T): Chefe {
  if (arv.respondeAoGrupo(n)) return { parentId: arv.grupoDe(n.parent_id!)!.membros[0].id, doGrupo: true };
  return { parentId: n.parent_id && arv.porId.has(n.parent_id) ? n.parent_id : null, doGrupo: false };
}

/** O chefe escolhido é o mesmo de hoje? (responder ao grupo via outro par conta como igual) */
export function mesmoChefe<T extends NoBase>(arv: Arvore<T>, n: T, c: Chefe): boolean {
  const atual = chefeDoNo(arv, n);
  return atual.parentId === c.parentId && atual.doGrupo === c.doGrupo;
}

/**
 * Quem pode entrar como par de `id` com o chefe escolhido: ninguém que fecharia
 * ciclo — o par passa a reportar ao mesmo chefe, então não pode ser o próprio
 * chefe nem alguém acima dele (o chefe está entre os descendentes do par).
 */
export function podeSerPar<T extends NoBase>(arv: Arvore<T>, id: string, candidato: string, chefe: string | null): boolean {
  if (candidato === id || !arv.porId.has(candidato)) return false;
  if (!chefe) return true;
  return candidato !== chefe && !arv.descendentes(candidato).has(chefe);
}
