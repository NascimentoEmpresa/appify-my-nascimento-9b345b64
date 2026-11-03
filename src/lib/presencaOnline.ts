/**
 * Quem está online — regra do painel da lateral direita (30/10/2026).
 *
 * O front manda um heartbeat (RPC presenca_registrar) a cada
 * INTERVALO_HEARTBEAT_MS enquanto a aba está aberta. O banco guarda dois
 * horários (ver 20261030003100_usuarios_online_presenca.sql):
 *   - visto_em: último heartbeat — a aba está aberta;
 *   - ativo_em: último heartbeat em que a pessoa estava usando (aba visível ou
 *     mexeu em algo há pouco).
 *
 * Status, igual à bolinha do Discord:
 *   - online  (verde):   ativo nos últimos JANELA_ONLINE_MS;
 *   - ausente (amarelo): aba aberta (visto recente), mas parada;
 *   - offline:           sem heartbeat há mais de JANELA_ONLINE_MS — some da lista.
 *
 * A janela é 3× o heartbeat: navegador joga timer de aba em segundo plano para
 * 1×/min ou mais, e um heartbeat perdido na rede não pode derrubar ninguém.
 */

export const INTERVALO_HEARTBEAT_MS = 60_000;
export const JANELA_ONLINE_MS = 3 * INTERVALO_HEARTBEAT_MS;
/** Sem mexer em nada por este tempo (com a aba visível) vira "ausente". */
export const INATIVIDADE_AUSENTE_MS = 5 * 60_000;

export type StatusPresenca = "online" | "ausente" | "offline";

export interface PresencaLinha {
  user_id: string;
  nome: string | null;
  avatar_url: string | null;
  setor: string | null;
  visto_em: string;
  ativo_em: string;
}

function ms(data: string | Date | null | undefined): number {
  if (!data) return NaN;
  return data instanceof Date ? data.getTime() : Date.parse(data);
}

/**
 * Status de uma pessoa contra o relógio `agora` — de preferência o do
 * servidor (presenca_listar devolve `agora`), não o da máquina, que pode
 * estar adiantado ou atrasado.
 */
export function statusPresenca(
  vistoEm: string | Date | null | undefined,
  ativoEm: string | Date | null | undefined,
  agora: string | Date,
): StatusPresenca {
  const t = ms(agora);
  const visto = ms(vistoEm);
  if (!Number.isFinite(visto) || t - visto > JANELA_ONLINE_MS) return "offline";
  const ativo = ms(ativoEm);
  if (Number.isFinite(ativo) && t - ativo <= JANELA_ONLINE_MS) return "online";
  return "ausente";
}

/**
 * O que o heartbeat manda em `_ativo`: aba visível E mexeu em algo há menos de
 * INATIVIDADE_AUSENTE_MS. Aba escondida conta como parada na hora.
 */
export function estaAtivo(abaVisivel: boolean, ultimaInteracao: number, agora: number): boolean {
  return abaVisivel && agora - ultimaInteracao < INATIVIDADE_AUSENTE_MS;
}

export interface PessoaPresenca extends PresencaLinha {
  status: Exclude<StatusPresenca, "offline">;
}

/**
 * Lista do painel: tira quem já está offline, online antes de ausente e,
 * dentro de cada grupo, por nome (pt-BR, sem diferenciar acento/caixa).
 */
export function montarListaPresenca(linhas: PresencaLinha[], agora: string | Date): PessoaPresenca[] {
  const ordem = { online: 0, ausente: 1 } as const;
  return linhas
    .map((l) => ({ ...l, status: statusPresenca(l.visto_em, l.ativo_em, agora) }))
    .filter((l): l is PessoaPresenca => l.status !== "offline")
    .sort(
      (a, b) =>
        ordem[a.status] - ordem[b.status] ||
        (a.nome ?? "").localeCompare(b.nome ?? "", "pt-BR", { sensitivity: "base" }),
    );
}

/** Iniciais para o avatar sem foto: "Ana Luiza Faleiro" → "AF". */
export function iniciais(nome: string | null | undefined): string {
  const partes = (nome ?? "").trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return "?";
  const primeira = partes[0][0];
  const ultima = partes.length > 1 ? partes[partes.length - 1][0] : "";
  return (primeira + ultima).toUpperCase();
}

// ─── Painel completo: todo mundo, por setor, com favoritos (30/10/2026) ─────
//
// "tem que aparecer todos, separados por setor, e cada um pode arrastar e
// organizar o seu do jeito que quiser, adicionar favoritos" (Pablo). O elenco
// vem de presenca_usuarios (cache longo) e a presença de presenca_listar (por
// minuto); aqui as duas viram grupos. Ver 20261030003600.

export const CHAVE_FAVORITOS = "__favoritos";
export const SEM_SETOR = "Sem setor";

export interface UsuarioElenco {
  user_id: string;
  nome: string | null;
  avatar_url: string | null;
  setor: string | null;
}

/** Guardado em usuario_presenca_preferencia.preferencias (jsonb). */
export interface PreferenciasPresenca {
  favoritos: string[];
  /** Ordem dos setores arrastada pela pessoa; o que faltar vai em ordem alfabética. */
  ordemSetores: string[];
  /** Ordem das pessoas arrastada pela pessoa, por grupo (setor ou favoritos). */
  ordemPessoas: Record<string, string[]>;
  /** Grupos recolhidos. */
  recolhidos: string[];
}

export const PREFERENCIAS_VAZIAS: PreferenciasPresenca = {
  favoritos: [],
  ordemSetores: [],
  ordemPessoas: {},
  recolhidos: [],
};

function listaDeTexto(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return [...new Set(v.filter((x): x is string => typeof x === "string" && x.length > 0))];
}

/** O jsonb do banco é confiado só até aqui: qualquer lixo vira o padrão. */
export function normalizarPreferencias(raw: unknown): PreferenciasPresenca {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ...PREFERENCIAS_VAZIAS, ordemPessoas: {} };
  const r = raw as Record<string, unknown>;
  const ordemPessoas: Record<string, string[]> = {};
  if (r.ordemPessoas && typeof r.ordemPessoas === "object" && !Array.isArray(r.ordemPessoas)) {
    for (const [k, v] of Object.entries(r.ordemPessoas as Record<string, unknown>)) {
      const l = listaDeTexto(v);
      if (l.length) ordemPessoas[k] = l;
    }
  }
  return {
    favoritos: listaDeTexto(r.favoritos),
    ordemSetores: listaDeTexto(r.ordemSetores),
    ordemPessoas,
    recolhidos: listaDeTexto(r.recolhidos),
  };
}

/** Comparação sem acento e sem caixa — "érica" acha "ERICA". */
export function normalizarBusca(texto: string | null | undefined): string {
  return (texto ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

export interface PessoaPainel extends UsuarioElenco {
  status: StatusPresenca;
  favorito: boolean;
}

export interface GrupoPresenca {
  chave: string;
  titulo: string;
  pessoas: PessoaPainel[];
  online: number;
  total: number;
  recolhido: boolean;
}

const PESO_STATUS: Record<StatusPresenca, number> = { online: 0, ausente: 1, offline: 2 };

function compararNome(a: { nome: string | null }, b: { nome: string | null }) {
  return (a.nome ?? "").localeCompare(b.nome ?? "", "pt-BR", { sensitivity: "base" });
}

/**
 * Ordem dentro de um grupo: quem a pessoa arrastou fica na posição que ela
 * escolheu; quem nunca foi arrastado (gente nova, setor nunca mexido) vem
 * depois, online antes de ausente antes de offline, e por nome.
 */
function ordenarPessoas(pessoas: PessoaPainel[], ordem: string[] | undefined): PessoaPainel[] {
  const pos = new Map((ordem ?? []).map((id, i) => [id, i]));
  return [...pessoas].sort((a, b) => {
    const pa = pos.get(a.user_id);
    const pb = pos.get(b.user_id);
    if (pa !== undefined && pb !== undefined) return pa - pb;
    if (pa !== undefined) return -1;
    if (pb !== undefined) return 1;
    return PESO_STATUS[a.status] - PESO_STATUS[b.status] || compararNome(a, b);
  });
}

/** Setores na ordem da pessoa; o resto por nome; "Sem setor" sempre por último. */
export function ordenarSetores(setores: string[], ordem: string[]): string[] {
  const pos = new Map(ordem.map((s, i) => [s, i]));
  return [...new Set(setores)].sort((a, b) => {
    if (a === SEM_SETOR || b === SEM_SETOR) return a === b ? 0 : a === SEM_SETOR ? 1 : -1;
    const pa = pos.get(a);
    const pb = pos.get(b);
    if (pa !== undefined && pb !== undefined) return pa - pb;
    if (pa !== undefined) return -1;
    if (pb !== undefined) return 1;
    return a.localeCompare(b, "pt-BR", { sensitivity: "base" });
  });
}

/**
 * Monta os grupos do painel: "Favoritos" no topo (quem é favorito sai do
 * setor, para não aparecer duas vezes) e depois um grupo por setor. Com busca,
 * só quem bate no nome, grupos vazios somem e nada fica recolhido.
 */
export function montarGruposPresenca(
  elenco: UsuarioElenco[],
  presencas: PresencaLinha[],
  agora: string | Date,
  prefs: PreferenciasPresenca,
  busca = "",
): GrupoPresenca[] {
  const presencaPorId = new Map(presencas.map((p) => [p.user_id, p]));
  const favoritos = new Set(prefs.favoritos);
  const recolhidos = new Set(prefs.recolhidos);
  const termo = normalizarBusca(busca);

  const porGrupo = new Map<string, PessoaPainel[]>();
  for (const u of elenco) {
    if (termo && !normalizarBusca(u.nome).includes(termo)) continue;
    const p = presencaPorId.get(u.user_id);
    const pessoa: PessoaPainel = {
      ...u,
      status: p ? statusPresenca(p.visto_em, p.ativo_em, agora) : "offline",
      favorito: favoritos.has(u.user_id),
    };
    const chave = pessoa.favorito ? CHAVE_FAVORITOS : u.setor?.trim() || SEM_SETOR;
    const lista = porGrupo.get(chave);
    if (lista) lista.push(pessoa);
    else porGrupo.set(chave, [pessoa]);
  }

  const grupo = (chave: string, titulo: string): GrupoPresenca => {
    const pessoas = ordenarPessoas(porGrupo.get(chave) ?? [], prefs.ordemPessoas[chave]);
    return {
      chave,
      titulo,
      pessoas,
      online: pessoas.filter((p) => p.status === "online").length,
      total: pessoas.length,
      recolhido: !termo && recolhidos.has(chave),
    };
  };

  const setores = ordenarSetores(
    [...porGrupo.keys()].filter((k) => k !== CHAVE_FAVORITOS),
    prefs.ordemSetores,
  );
  const grupos = setores.map((s) => grupo(s, s));
  if (porGrupo.has(CHAVE_FAVORITOS)) grupos.unshift(grupo(CHAVE_FAVORITOS, "Favoritos"));
  return grupos;
}

/** Move `de` para a posição de `para` (mesma semântica do arrayMove do dnd-kit). */
export function moverItem<T>(lista: T[], de: T, para: T): T[] {
  const i = lista.indexOf(de);
  const j = lista.indexOf(para);
  if (i < 0 || j < 0 || i === j) return lista;
  const nova = [...lista];
  nova.splice(i, 1);
  nova.splice(j, 0, de);
  return nova;
}

/** Arrastar uma pessoa: grava a ordem do grupo inteiro como está na tela. */
export function reordenarPessoa(
  prefs: PreferenciasPresenca,
  grupo: string,
  idsNaTela: string[],
  de: string,
  para: string,
): PreferenciasPresenca {
  const nova = moverItem(idsNaTela, de, para);
  if (nova === idsNaTela) return prefs;
  return { ...prefs, ordemPessoas: { ...prefs.ordemPessoas, [grupo]: nova } };
}

/** Arrastar um setor: grava a ordem de todos os setores como está na tela. */
export function reordenarSetor(
  prefs: PreferenciasPresenca,
  setoresNaTela: string[],
  de: string,
  para: string,
): PreferenciasPresenca {
  const nova = moverItem(setoresNaTela, de, para);
  if (nova === setoresNaTela) return prefs;
  return { ...prefs, ordemSetores: nova };
}

export function alternarFavorito(prefs: PreferenciasPresenca, userId: string): PreferenciasPresenca {
  const tem = prefs.favoritos.includes(userId);
  return {
    ...prefs,
    favoritos: tem ? prefs.favoritos.filter((id) => id !== userId) : [...prefs.favoritos, userId],
  };
}

export function alternarRecolhido(prefs: PreferenciasPresenca, chave: string): PreferenciasPresenca {
  const tem = prefs.recolhidos.includes(chave);
  return {
    ...prefs,
    recolhidos: tem ? prefs.recolhidos.filter((c) => c !== chave) : [...prefs.recolhidos, chave],
  };
}
