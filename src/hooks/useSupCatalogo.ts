import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

/**
 * Catálogo de materiais do Supply — cascata Contrato → Posto → Função → Itens.
 *
 * Regra central: NADA entra em vigor direto. Toda escrita grava a linha real
 * com `aprovado = false` (invisível para o encarregado, porque as RPCs
 * sup_ext_* filtram aprovado = true) E registra uma linha de rascunho em
 * `sup_cat_alteracao`. O rascunho vira lote em "Enviar para Aprovação", e é
 * a decisão do lote (sup_cat_decidir_lote) que acende ou descarta.
 *
 * Ver supabase/migrations/20260819000001_supply_catalogo.sql.
 */

export type TipoItem = "uniforme" | "epi" | "insumo" | "equipamento";
export type TipoEntidade = "posto" | "funcao" | "item" | "opcoes" | "funcao_item";
export type TipoAcao = "criar" | "editar" | "excluir";

export interface Contrato { id: string; nome: string; cliente: string | null; status: string }
export interface Posto { id: string; contrato_id: string; nome: string; ativo: boolean; aprovado: boolean }
export interface Funcao { id: string; posto_id: string; nome: string; ativo: boolean; aprovado: boolean }
export interface Item {
  id: string; nome: string; tipo: TipoItem; ativo: boolean; aprovado: boolean;
}
export interface FuncaoItem {
  id: string; funcao_id: string; item_id: string; ordem: number; ativo: boolean; aprovado: boolean;
  sup_item: Item | null;
}
export interface ItemOpcao {
  id: string; item_id: string; tipo: "tamanho" | "quantidade" | "litros"; opcoes: string[];
}
export interface Alteracao {
  id: string; lote_id: string | null; tipo_entidade: TipoEntidade; tipo_acao: TipoAcao;
  alvo_id: string; dados: any; contexto: any; descricao: string; status: string;
  criado_por_nome: string | null; created_at: string;
}

const sb = supabase as any;

/** Listas pré-definidas do painel legado (ARQUITETURA-COMPLETA.md §11.2). */
export const OPCOES_PREDEFINIDAS: Record<string, string[]> = {
  quantidade: ["1", "2", "3", "4", "5", "6"],
  tamanho: ["PP", "P", "M", "G", "GG", "EGG", "EXGG",
    ...Array.from({ length: 17 }, (_, i) => String(33 + i))],
  litros: Array.from({ length: 19 }, (_, i) => String((i + 1) * 10)),
};

export const LABEL_TIPO_ITEM: Record<TipoItem, string> = {
  uniforme: "Uniforme",
  epi: "EPI",
  insumo: "Insumo",
  equipamento: "Equipamento",
};

// ── Consultas ────────────────────────────────────────────────────────

/** Contratos da empresa ativa — a raiz da cascata vem de Licitações. */
export function useContratosCatalogo(empresaId: string | null) {
  return useQuery({
    queryKey: ["sup_cat_contratos", empresaId],
    enabled: !!empresaId,
    queryFn: async (): Promise<Contrato[]> => {
      const { data, error } = await sb
        .from("contratos")
        .select("id, nome, cliente, status")
        .order("nome");
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function usePostos(contratoId: string | null) {
  return useQuery({
    queryKey: ["sup_posto", contratoId],
    enabled: !!contratoId,
    queryFn: async (): Promise<Posto[]> => {
      const { data, error } = await sb
        .from("sup_posto")
        .select("id, contrato_id, nome, ativo, aprovado")
        .eq("contrato_id", contratoId)
        .eq("ativo", true)
        .order("nome");
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useFuncoes(postoId: string | null) {
  return useQuery({
    queryKey: ["sup_funcao", postoId],
    enabled: !!postoId,
    queryFn: async (): Promise<Funcao[]> => {
      const { data, error } = await sb
        .from("sup_funcao")
        .select("id, posto_id, nome, ativo, aprovado")
        .eq("posto_id", postoId)
        .eq("ativo", true)
        .order("nome");
      if (error) throw error;
      return data ?? [];
    },
  });
}

/** Enxoval da função: o vínculo N:N já trazendo o item do catálogo mestre. */
export function useFuncaoItens(funcaoId: string | null) {
  return useQuery({
    queryKey: ["sup_funcao_item", funcaoId],
    enabled: !!funcaoId,
    queryFn: async (): Promise<FuncaoItem[]> => {
      const { data, error } = await sb
        .from("sup_funcao_item")
        .select("id, funcao_id, item_id, ordem, ativo, aprovado, sup_item(id, nome, tipo, ativo, aprovado)")
        .eq("funcao_id", funcaoId)
        .eq("ativo", true)
        .order("ordem");
      if (error) throw error;
      return data ?? [];
    },
  });
}

/** Catálogo mestre de materiais da empresa. */
export function useItens(empresaId: string | null) {
  return useQuery({
    queryKey: ["sup_item", empresaId],
    enabled: !!empresaId,
    queryFn: async (): Promise<Item[]> => {
      const { data, error } = await sb
        .from("sup_item")
        .select("id, nome, tipo, ativo, aprovado")
        .eq("ativo", true)
        .order("nome");
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useItemOpcoes(itemId: string | null) {
  return useQuery({
    queryKey: ["sup_item_opcao", itemId],
    enabled: !!itemId,
    queryFn: async (): Promise<ItemOpcao[]> => {
      const { data, error } = await sb
        .from("sup_item_opcao")
        .select("id, item_id, tipo, opcoes")
        .eq("item_id", itemId);
      if (error) throw error;
      return data ?? [];
    },
  });
}

/** Rascunhos ainda não enviados — alimenta o botão "Enviar para Aprovação (N)". */
export function useRascunhos(empresaId: string | null) {
  return useQuery({
    queryKey: ["sup_cat_alteracao", "rascunho", empresaId],
    enabled: !!empresaId,
    queryFn: async (): Promise<Alteracao[]> => {
      const { data, error } = await sb
        .from("sup_cat_alteracao")
        .select("*")
        .eq("status", "RASCUNHO")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
}

// ── Escrita ──────────────────────────────────────────────────────────

interface RegistroAlteracao {
  empresaId: string;
  tipoEntidade: TipoEntidade;
  tipoAcao: TipoAcao;
  alvoId: string;
  descricao: string;
  dados?: Record<string, unknown>;
  contexto?: Record<string, unknown>;
}

/**
 * Grava o rascunho que acompanha cada escrita no catálogo.
 * `contexto` guarda os nomes da hierarquia na hora da criação para a tela de
 * aprovação exibir "Contrato X · Posto Y · Função Z" sem re-derivar nada —
 * é a decisão mais acertada do Subsistema 6 do legado (REPLICAR §8.3).
 */
async function registrarAlteracao(r: RegistroAlteracao) {
  const { data: u } = await supabase.auth.getUser();
  let nome: string | null = null;
  if (u.user) {
    const { data: p } = await sb.from("profiles").select("display_name").eq("id", u.user.id).maybeSingle();
    nome = p?.display_name ?? null;
  }
  const { error } = await sb.from("sup_cat_alteracao").insert({
    empresa_id: r.empresaId,
    tipo_entidade: r.tipoEntidade,
    tipo_acao: r.tipoAcao,
    alvo_id: r.alvoId,
    dados: r.dados ?? {},
    contexto: r.contexto ?? {},
    descricao: r.descricao,
    status: "RASCUNHO",
    criado_por: u.user?.id ?? null,
    criado_por_nome: nome,
  });
  if (error) throw error;
}

/**
 * Se a linha ainda não foi aprovada E o único rascunho dela é o "criar",
 * excluir de verdade em vez de gerar um par criar+excluir que não diz nada
 * a quem for aprovar. Retorna true se resolveu por aqui.
 */
async function descartarCriacaoPendente(tabela: string, entidade: TipoEntidade, alvoId: string) {
  const { data: rasc } = await sb
    .from("sup_cat_alteracao")
    .select("id, tipo_acao")
    .eq("alvo_id", alvoId)
    .eq("tipo_entidade", entidade)
    .eq("status", "RASCUNHO");
  const temCriacaoPendente = (rasc ?? []).some((a: any) => a.tipo_acao === "criar");
  if (!temCriacaoPendente) return false;

  await sb.from("sup_cat_alteracao").delete().eq("alvo_id", alvoId).eq("tipo_entidade", entidade).eq("status", "RASCUNHO");
  const { error } = await sb.from(tabela).delete().eq("id", alvoId).eq("aprovado", false);
  if (error) throw error;
  return true;
}

/** Invalida tudo que a cascata mostra — barato e evita tela desatualizada. */
function useInvalidarCatalogo() {
  const qc = useQueryClient();
  return () => {
    ["sup_posto", "sup_funcao", "sup_item", "sup_funcao_item", "sup_item_opcao", "sup_cat_alteracao"]
      .forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
  };
}

export function useCatalogoMutations(empresaId: string | null) {
  const invalidar = useInvalidarCatalogo();
  const exigeEmpresa = () => {
    if (!empresaId) throw new Error("Empresa ativa não identificada.");
    return empresaId;
  };

  const onErro = (e: any) => toast.error(e?.message ?? "Não foi possível salvar.");

  // ── Posto ──
  const criarPosto = useMutation({
    mutationFn: async (v: { contratoId: string; contratoNome: string; nome: string }) => {
      const emp = exigeEmpresa();
      // empresa_id é preenchido por trigger a partir do contrato (ver migration).
      const { data, error } = await sb.from("sup_posto")
        .insert({ contrato_id: v.contratoId, nome: v.nome.trim(), empresa_id: emp })
        .select("id").single();
      if (error) throw error;
      await registrarAlteracao({
        empresaId: emp, tipoEntidade: "posto", tipoAcao: "criar", alvoId: data.id,
        descricao: `Criar posto "${v.nome.trim()}"`,
        dados: { nome: v.nome.trim(), contrato_id: v.contratoId },
        contexto: { contrato: v.contratoNome, posto: v.nome.trim() },
      });
    },
    onSuccess: () => { invalidar(); toast.success("Posto criado — aguardando aprovação."); },
    onError: onErro,
  });

  const renomearPosto = useMutation({
    mutationFn: async (v: { id: string; nome: string; nomeAnterior: string; contratoNome: string }) => {
      const emp = exigeEmpresa();
      const { error } = await sb.from("sup_posto").update({ nome: v.nome.trim() }).eq("id", v.id);
      if (error) throw error;
      await registrarAlteracao({
        empresaId: emp, tipoEntidade: "posto", tipoAcao: "editar", alvoId: v.id,
        descricao: `Renomear posto "${v.nomeAnterior}" → "${v.nome.trim()}"`,
        dados: { de: v.nomeAnterior, para: v.nome.trim() },
        contexto: { contrato: v.contratoNome, posto: v.nome.trim() },
      });
    },
    onSuccess: () => { invalidar(); toast.success("Posto renomeado."); },
    onError: onErro,
  });

  const excluirPosto = useMutation({
    mutationFn: async (v: { id: string; nome: string; contratoNome: string }) => {
      const emp = exigeEmpresa();
      if (await descartarCriacaoPendente("sup_posto", "posto", v.id)) return;
      const { error } = await sb.from("sup_posto").update({ ativo: false }).eq("id", v.id);
      if (error) throw error;
      await registrarAlteracao({
        empresaId: emp, tipoEntidade: "posto", tipoAcao: "excluir", alvoId: v.id,
        descricao: `Excluir posto "${v.nome}"`,
        contexto: { contrato: v.contratoNome, posto: v.nome },
      });
    },
    onSuccess: () => { invalidar(); toast.success("Posto removido."); },
    onError: onErro,
  });

  // ── Função ──
  const criarFuncao = useMutation({
    mutationFn: async (v: { postoId: string; nome: string; ctx: Record<string, string> }) => {
      const emp = exigeEmpresa();
      const { data, error } = await sb.from("sup_funcao")
        .insert({ posto_id: v.postoId, nome: v.nome.trim() })
        .select("id").single();
      if (error) throw error;
      await registrarAlteracao({
        empresaId: emp, tipoEntidade: "funcao", tipoAcao: "criar", alvoId: data.id,
        descricao: `Criar função "${v.nome.trim()}"`,
        dados: { nome: v.nome.trim(), posto_id: v.postoId },
        contexto: { ...v.ctx, funcao: v.nome.trim() },
      });
    },
    onSuccess: () => { invalidar(); toast.success("Função criada — aguardando aprovação."); },
    onError: onErro,
  });

  const renomearFuncao = useMutation({
    mutationFn: async (v: { id: string; nome: string; nomeAnterior: string; ctx: Record<string, string> }) => {
      const emp = exigeEmpresa();
      const { error } = await sb.from("sup_funcao").update({ nome: v.nome.trim() }).eq("id", v.id);
      if (error) throw error;
      await registrarAlteracao({
        empresaId: emp, tipoEntidade: "funcao", tipoAcao: "editar", alvoId: v.id,
        descricao: `Renomear função "${v.nomeAnterior}" → "${v.nome.trim()}"`,
        dados: { de: v.nomeAnterior, para: v.nome.trim() },
        contexto: { ...v.ctx, funcao: v.nome.trim() },
      });
    },
    onSuccess: () => { invalidar(); toast.success("Função renomeada."); },
    onError: onErro,
  });

  const excluirFuncao = useMutation({
    mutationFn: async (v: { id: string; nome: string; ctx: Record<string, string> }) => {
      const emp = exigeEmpresa();
      if (await descartarCriacaoPendente("sup_funcao", "funcao", v.id)) return;
      const { error } = await sb.from("sup_funcao").update({ ativo: false }).eq("id", v.id);
      if (error) throw error;
      await registrarAlteracao({
        empresaId: emp, tipoEntidade: "funcao", tipoAcao: "excluir", alvoId: v.id,
        descricao: `Excluir função "${v.nome}"`,
        contexto: { ...v.ctx, funcao: v.nome },
      });
    },
    onSuccess: () => { invalidar(); toast.success("Função removida."); },
    onError: onErro,
  });

  // ── Item do catálogo mestre ──
  const criarItem = useMutation({
    mutationFn: async (v: { nome: string; tipo: TipoItem }) => {
      const emp = exigeEmpresa();
      const { data, error } = await sb.from("sup_item")
        .insert({ empresa_id: emp, nome: v.nome.trim().toUpperCase(), tipo: v.tipo })
        .select("id").single();
      if (error) throw error;
      await registrarAlteracao({
        empresaId: emp, tipoEntidade: "item", tipoAcao: "criar", alvoId: data.id,
        descricao: `Criar material "${v.nome.trim().toUpperCase()}" (${LABEL_TIPO_ITEM[v.tipo]})`,
        dados: { nome: v.nome.trim().toUpperCase(), tipo: v.tipo },
        contexto: { item: v.nome.trim().toUpperCase() },
      });
      return data.id as string;
    },
    onSuccess: () => { invalidar(); toast.success("Material criado — aguardando aprovação."); },
    onError: onErro,
  });

  /** Substitui as opções de um tipo. Array vazio APAGA aquele tipo (igual ao legado). */
  const salvarOpcoes = useMutation({
    mutationFn: async (v: {
      itemId: string; itemNome: string;
      opcoesPorTipo: Record<"tamanho" | "quantidade" | "litros", string[]>;
    }) => {
      const emp = exigeEmpresa();
      for (const [tipo, opcoes] of Object.entries(v.opcoesPorTipo)) {
        if (!opcoes.length) {
          const { error } = await sb.from("sup_item_opcao").delete().eq("item_id", v.itemId).eq("tipo", tipo);
          if (error) throw error;
        } else {
          const { error } = await sb.from("sup_item_opcao")
            .upsert({ item_id: v.itemId, tipo, opcoes }, { onConflict: "item_id,tipo" });
          if (error) throw error;
        }
      }
      const resumo = Object.entries(v.opcoesPorTipo)
        .filter(([, o]) => o.length)
        .map(([t, o]) => `${t}: ${o.join(", ")}`)
        .join(" · ") || "sem opções";
      await registrarAlteracao({
        empresaId: emp, tipoEntidade: "opcoes", tipoAcao: "editar", alvoId: v.itemId,
        descricao: `Opções de "${v.itemNome}" — ${resumo}`,
        dados: v.opcoesPorTipo,
        contexto: { item: v.itemNome },
      });
    },
    onSuccess: () => { invalidar(); toast.success("Opções salvas."); },
    onError: onErro,
  });

  // ── Enxoval (vínculo função ↔ item) ──
  const adicionarAoEnxoval = useMutation({
    mutationFn: async (v: {
      funcaoId: string; itemId: string; itemNome: string; ordem: number; ctx: Record<string, string>;
    }) => {
      const emp = exigeEmpresa();
      const { data, error } = await sb.from("sup_funcao_item")
        .insert({ funcao_id: v.funcaoId, item_id: v.itemId, ordem: v.ordem })
        .select("id").single();
      if (error) throw error;
      await registrarAlteracao({
        empresaId: emp, tipoEntidade: "funcao_item", tipoAcao: "criar", alvoId: data.id,
        descricao: `Incluir "${v.itemNome}" no enxoval de ${v.ctx.funcao ?? "função"}`,
        dados: { funcao_id: v.funcaoId, item_id: v.itemId },
        contexto: { ...v.ctx, item: v.itemNome },
      });
    },
    onSuccess: () => { invalidar(); toast.success("Material incluído no enxoval."); },
    onError: onErro,
  });

  const removerDoEnxoval = useMutation({
    mutationFn: async (v: { id: string; itemNome: string; ctx: Record<string, string> }) => {
      const emp = exigeEmpresa();
      if (await descartarCriacaoPendente("sup_funcao_item", "funcao_item", v.id)) return;
      const { error } = await sb.from("sup_funcao_item").update({ ativo: false }).eq("id", v.id);
      if (error) throw error;
      await registrarAlteracao({
        empresaId: emp, tipoEntidade: "funcao_item", tipoAcao: "excluir", alvoId: v.id,
        descricao: `Remover "${v.itemNome}" do enxoval de ${v.ctx.funcao ?? "função"}`,
        contexto: { ...v.ctx, item: v.itemNome },
      });
    },
    onSuccess: () => { invalidar(); toast.success("Material removido do enxoval."); },
    onError: onErro,
  });

  // ── Envio do lote ──
  const enviarLote = useMutation({
    mutationFn: async () => {
      const emp = exigeEmpresa();
      const { data, error } = await sb.rpc("sup_cat_enviar_lote", { p_empresa_id: emp });
      if (error) throw error;
      return data;
    },
    onSuccess: (lote: any) => {
      invalidar();
      toast.success(`Lote ${lote?.codigo ?? ""} enviado para aprovação.`);
    },
    onError: onErro,
  });

  return {
    criarPosto, renomearPosto, excluirPosto,
    criarFuncao, renomearFuncao, excluirFuncao,
    criarItem, salvarOpcoes,
    adicionarAoEnxoval, removerDoEnxoval,
    enviarLote,
  };
}
