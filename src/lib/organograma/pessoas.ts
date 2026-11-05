// =====================================================================
// Organograma — quem é a pessoa e onde ela fica (mig 20261104009000)
//
// Tudo o que as telas falam com o banco sobre posição: a árvore, a busca por
// nome, a posição atual de alguém e o salvar. A mesma posição é preenchida em
// três lugares (criar/editar usuário, cadastro do colaborador e o próprio
// organograma), então a regra de "o que é obrigatório" mora aqui, uma vez só.
// =====================================================================
import { supabase } from "@/integrations/supabase/client";
import type { NoComContrato } from "./arvore";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as any;

export interface NoPessoa extends NoComContrato {
  user_id: string | null; empregado_id: number | null; funcao_manual: string | null;
  email: string | null; avatar_url: string | null; cargo: string | null; ativo: boolean; cor: string | null;
  superior_origem: "manual" | "posto" | "contrato" | "sem"; posto_codigo: string | null; posto_nome: string | null;
}

export interface ContratoRef { empresa: number; filial: number; nome: string }

export const funcaoDe = (n: Pick<NoPessoa, "funcao_manual" | "cargo">) => n.funcao_manual || n.cargo || "";

/** A RPC manda cada pessoa como array (2.500 linhas): a ordem está no comentário da organograma_arvore. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function linhaParaNo(l: any[]): NoPessoa {
  return {
    id: l[0], user_id: l[1], empregado_id: l[2], parent_id: l[3], ordem: l[4], funcao_manual: l[5], nome: l[6], email: l[7],
    avatar_url: l[8], cargo: l[9], setor: l[10], ativo: l[11], cor: l[12], par_grupo: l[13], do_grupo: l[14],
    superior_pendente: l[15], superior_origem: l[16], posto_codigo: l[17], posto_nome: l[18], empresa: l[19], filial: l[20],
    contrato: l[21], contratos_extras: l[22] ?? [],
  };
}

export async function carregarArvore(): Promise<{ nos: NoPessoa[]; contratos: ContratoRef[] }> {
  const { data, error } = await sb.rpc("organograma_arvore");
  if (error) throw error;
  return {
    nos: (data?.nos ?? []).map(linhaParaNo),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    contratos: (data?.contratos ?? []).map((c: any[]) => ({ empresa: c[0], filial: c[1], nome: c[2] })),
  };
}

export interface PessoaBusca {
  empregado_id: number | null; user_id: string | null; no_id: string | null; nome: string; cargo: string | null;
  posto_codigo: string | null; posto_nome: string | null; empresa: number | null; filial: number | null;
  contrato: string | null; setor: string | null; superior_id: string | null; superior_nome: string | null;
  pendente: boolean; funcao: string | null;
}

export async function buscarPessoas(termo: string, soNaArvore = false): Promise<PessoaBusca[]> {
  const { data, error } = await sb.rpc("organograma_buscar_pessoas", { p_termo: termo, p_so_no: soNaArvore, p_limite: 20 });
  if (error) throw error;
  return data ?? [];
}

export async function carregarContratos(): Promise<ContratoRef[]> {
  const { data, error } = await sb.rpc("organograma_contratos_opcoes");
  if (error) throw error;
  return data ?? [];
}

export async function carregarPostos(empresa: number, filial: number): Promise<{ codigo: string; titulo: string }[]> {
  const { data, error } = await sb.rpc("organograma_opcoes_posto", { p_empresa: empresa, p_filial: filial });
  if (error) throw error;
  return data ?? [];
}

// ── Posição: o que o formulário edita ───────────────────────────────────
export interface PosicaoForm {
  noId: string | null;
  empregadoId: number | null;
  empresa: number | null; filial: number | null; contrato: string | null; cargo: string | null;
  superior: { id: string; nome: string } | null;
  doGrupo: boolean;
  topo: boolean;
  funcao: string;
  postoCodigo: string | null;
  extras: ContratoRef[];
  /** O superior que está na tela foi deduzido pelo sistema e ainda não foi confirmado. */
  deduzido: boolean;
  /** Sem superior até agora: o formulário cobra. */
  pendente: boolean;
  equipeDireta: number;
}

export const posicaoVazia = (): PosicaoForm => ({
  noId: null, empregadoId: null, empresa: null, filial: null, contrato: null, cargo: null, superior: null, doGrupo: false,
  topo: false, funcao: "", postoCodigo: null, extras: [], deduzido: false, pendente: true, equipeDireta: 0,
});

/** Por que a posição ainda não pode ser salva (ou null, se pode). */
export function posicaoFaltando(p: PosicaoForm): string | null {
  if (!p.superior && !p.topo) return "Escolha a quem a pessoa se reporta (superior imediato) ou marque que ela fica no topo.";
  return null;
}

export async function carregarPosicao(chave: { empregado?: number | null; user?: string | null }): Promise<PosicaoForm> {
  const { data, error } = await sb.rpc("organograma_posicao", { p_empregado: chave.empregado ?? null, p_user: chave.user ?? null });
  if (error) throw error;
  return posicaoDeResposta(data);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function posicaoDeResposta(d: any): PosicaoForm {
  return {
    noId: d?.no_id ?? null,
    empregadoId: d?.empregado_id ?? null,
    empresa: d?.empresa ?? null, filial: d?.filial ?? null, contrato: d?.contrato ?? null, cargo: d?.cargo ?? null,
    superior: d?.parent_id ? { id: d.parent_id, nome: d.parent_nome ?? "—" } : null,
    doGrupo: !!d?.do_grupo,
    topo: !!d?.no_topo,
    funcao: d?.funcao ?? "",
    postoCodigo: d?.posto_codigo ?? null,
    extras: d?.contratos_extras ?? [],
    deduzido: d?.origem === "posto" || d?.origem === "contrato",
    pendente: !!d?.pendente,
    equipeDireta: d?.equipe_direta ?? 0,
  };
}

/** Parâmetros de organograma_salvar_posicao (e do bloco `organograma` da admin-create-user). */
export function posicaoParaParametros(p: PosicaoForm) {
  return {
    p_parent: p.topo ? null : p.superior?.id ?? null,
    p_topo: p.topo,
    p_do_grupo: p.topo ? false : p.doGrupo,
    p_funcao: p.funcao.trim(),
    p_posto: p.empregadoId ? p.postoCodigo ?? "" : null,
    p_contratos: p.extras.map((c) => ({ empresa: c.empresa, filial: c.filial })),
  };
}

export async function salvarPosicao(p: PosicaoForm, quem: { user?: string | null } = {}, extra: {
  destinoEquipe?: DestinoEquipe; novoLider?: string | null; motivo?: string | null;
} = {}): Promise<void> {
  const { error } = await sb.rpc("organograma_salvar_posicao", {
    p_no: p.noId, p_empregado: p.empregadoId, p_user: quem.user ?? null, ...posicaoParaParametros(p),
    p_destino_equipe: extra.destinoEquipe ?? "acompanha", p_novo_lider: extra.novoLider ?? null, p_motivo: extra.motivo ?? null,
  });
  if (error) throw error;
}

/** Quando um líder muda de posição, o que acontece com quem responde direto a ele. */
export type DestinoEquipe = "acompanha" | "chefe_anterior" | "novo_lider";

export async function moverNaArvore(args: {
  no: string; parent: string | null; doGrupo?: boolean; topo?: boolean;
  destinoEquipe?: DestinoEquipe; novoLider?: string | null; motivo?: string | null;
}): Promise<void> {
  const { error } = await sb.rpc("organograma_mover", {
    p_no: args.no, p_parent: args.parent, p_do_grupo: !!args.doGrupo, p_topo: !!args.topo,
    p_destino_equipe: args.destinoEquipe ?? "acompanha", p_novo_lider: args.novoLider ?? null, p_motivo: args.motivo ?? null,
  });
  if (error) throw error;
}

// ── Histórico ────────────────────────────────────────────────────────────
export type Natureza = "positiva" | "negativa" | "neutra";

export interface Movimentacao {
  chave: string; empregado_id: number | null; user_id: string | null; pessoa_nome: string; tipo: string; natureza: Natureza;
  titulo: string; descricao: string | null; valor_antes: string | null; valor_depois: string | null;
  empresa: number | null; filial: number | null; contrato_nome: string | null; setor: string | null;
  data_evento: string; origem: string; autor_nome: string | null; created_at: string;
}

export const ROTULO_TIPO: Record<string, string> = {
  admissao: "Admissão", readmissao: "Readmissão", desligamento: "Desligamento", transferencia: "Transferência de cadastro",
  troca_superior: "Troca de liderança", troca_cargo: "Mudança de cargo", troca_funcao: "Troca de função", troca_posto: "Mudança de posto",
  troca_contrato: "Mudança de contrato", promocao: "Promoção", transferencia_escopo: "Transferência de escopo", elogio: "Elogio",
  feedback: "Feedback", ocorrencia: "Ocorrência", advertencia: "Advertência", outro: "Outro",
};

/** O que a liderança registra à mão. Advertência formal segue no Jurídico e aparece aqui sozinha. */
export const TIPOS_REGISTRO: { tipo: string; natureza: Natureza }[] = [
  { tipo: "elogio", natureza: "positiva" },
  { tipo: "feedback", natureza: "positiva" },
  { tipo: "promocao", natureza: "positiva" },
  { tipo: "transferencia_escopo", natureza: "neutra" },
  { tipo: "ocorrencia", natureza: "negativa" },
  { tipo: "outro", natureza: "neutra" },
];

/** Hoje no fuso de quem usa: toISOString() já vira o dia depois das 21h no Brasil. */
export const hojeLocal = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
};

export const fmtDataBr = (iso: string | null | undefined) => {
  if (!iso) return "—";
  const [a, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${a}`;
};

export const COR_NATUREZA: Record<Natureza, string> = {
  positiva: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200",
  negativa: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200",
  neutra: "bg-muted text-muted-foreground",
};
export const ROTULO_NATUREZA: Record<Natureza, string> = { positiva: "Positiva", negativa: "Negativa", neutra: "Neutra" };
