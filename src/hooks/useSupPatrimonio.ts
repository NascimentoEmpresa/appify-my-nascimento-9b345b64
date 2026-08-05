import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

/**
 * Patrimônio e Manutenção — frota e maquinário.
 *
 * Um cadastro só (`sup_patrimonio`), separado por `categoria`. Patrimônio é
 * a árvore completa; Manutenção é o recorte de `em_manutencao = true`.
 *
 * Ver supabase/migrations/20260824000001_supply_patrimonio.sql.
 */

const sb = supabase as any;

export type Categoria = "veiculo" | "equipamento";

export const LABEL_CATEGORIA: Record<Categoria, string> = {
  veiculo: "Veículos",
  equipamento: "Máquinas/Equipamentos",
};

export interface Bem {
  id: string;
  empresa_id: string;
  categoria: Categoria;
  nome: string;
  identificador: string | null;
  descricao: string | null;
  contrato_id: string | null;
  posto_id: string | null;
  lotacao: string | null;
  em_manutencao: boolean;
  data_inicio_manutencao: string | null;
  data_previsao_fim: string | null;
  ativo: boolean;
  observacoes: string | null;
  contrato: { id: string; nome: string } | null;
  posto: { id: string; nome: string } | null;
}

export interface ArquivoBem {
  id: string; patrimonio_id: string; nome_arquivo: string; caminho: string;
  comentario: string | null; valor: number | null;
  enviado_por_nome: string | null; created_at: string;
}

/** Grupo "sem contrato" — a frota da sede, que não pertence a licitação. */
export const SEM_CONTRATO = "__sem_contrato__";

/**
 * Máscara BRL progressiva (§9.3): o usuário digita só dígitos e o valor
 * acumula da direita para a esquerda. `1` → R$ 0,01 · `150` → R$ 1,50.
 */
export function mascaraBRL(v: string): string {
  const d = String(v).replace(/\D/g, "").replace(/^0+/, "");
  if (!d) return "";
  const n = Number(d) / 100;
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
export function brlParaNumero(v: string): number | null {
  const d = String(v).replace(/\D/g, "");
  return d ? Number(d) / 100 : null;
}

// ── Consultas ────────────────────────────────────────────────────────

export function useBens(empresaId: string | null) {
  return useQuery({
    queryKey: ["sup_patrimonio", empresaId],
    enabled: !!empresaId,
    queryFn: async (): Promise<Bem[]> => {
      const { data, error } = await sb
        .from("sup_patrimonio")
        .select("*, contrato:contrato_id(id, nome), posto:posto_id(id, nome)")
        .eq("empresa_id", empresaId)
        .eq("ativo", true)
        .order("nome");
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useArquivosDoBem(patrimonioId: string | null) {
  return useQuery({
    queryKey: ["sup_patrimonio_arquivo", patrimonioId],
    enabled: !!patrimonioId,
    queryFn: async (): Promise<ArquivoBem[]> => {
      const { data, error } = await sb
        .from("sup_patrimonio_arquivo").select("*")
        .eq("patrimonio_id", patrimonioId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
}

/** Postos de um contrato, para o select do cadastro. */
export function usePostosDoContrato(contratoId: string | null) {
  return useQuery({
    queryKey: ["sup_posto", "patrimonio", contratoId],
    enabled: !!contratoId,
    queryFn: async () => {
      const { data, error } = await sb
        .from("sup_posto").select("id, nome")
        .eq("contrato_id", contratoId).eq("ativo", true).order("nome");
      if (error) throw error;
      return (data ?? []) as { id: string; nome: string }[];
    },
  });
}

// ── Escrita ──────────────────────────────────────────────────────────

function useInvalidar() {
  const qc = useQueryClient();
  return () => {
    ["sup_patrimonio", "sup_patrimonio_arquivo"].forEach((k) =>
      qc.invalidateQueries({ queryKey: [k] }));
  };
}

export function useSalvarBem() {
  const invalidar = useInvalidar();
  return useMutation({
    mutationFn: async (b: Partial<Bem> & { empresa_id?: string }) => {
      if (!b.nome?.trim()) throw new Error("Informe o nome do bem.");
      const payload = {
        categoria: b.categoria ?? "equipamento",
        nome: b.nome.trim(),
        identificador: b.identificador?.trim() || null,
        descricao: b.descricao || null,
        contrato_id: b.contrato_id || null,
        posto_id: b.contrato_id ? b.posto_id || null : null,
        lotacao: b.contrato_id ? null : b.lotacao?.trim() || null,
        observacoes: b.observacoes || null,
      };
      if (b.id) {
        const { error } = await sb.from("sup_patrimonio").update(payload).eq("id", b.id);
        if (error) throw error;
      } else {
        const { error } = await sb.from("sup_patrimonio")
          .insert({ ...payload, empresa_id: b.empresa_id });
        if (error) throw error;
      }
    },
    onSuccess: () => { invalidar(); toast.success("Bem salvo."); },
    onError: (e: any) =>
      toast.error(/uq_sup_patrim_identificador|duplicate/i.test(e?.message ?? "")
        ? "Já existe um bem com esse identificador."
        : e?.message ?? "Não foi possível salvar."),
  });
}

/**
 * Marca ou desmarca manutenção.
 *
 * Desmarcar LIMPA as duas datas (§9.2) — o banco inclusive recusa o contrário
 * pela constraint sup_patrimonio_datas_coerentes, então isto não é só
 * gentileza da tela.
 */
export function useAtualizarManutencao() {
  const invalidar = useInvalidar();
  return useMutation({
    mutationFn: async (v: {
      id: string; em_manutencao: boolean;
      data_inicio_manutencao?: string | null; data_previsao_fim?: string | null;
    }) => {
      const { error } = await sb.from("sup_patrimonio").update({
        em_manutencao: v.em_manutencao,
        data_inicio_manutencao: v.em_manutencao ? v.data_inicio_manutencao || null : null,
        data_previsao_fim: v.em_manutencao ? v.data_previsao_fim || null : null,
      }).eq("id", v.id);
      if (error) throw error;
    },
    onSuccess: () => { invalidar(); toast.success("Status de manutenção atualizado."); },
    onError: (e: any) => toast.error(e?.message ?? "Não foi possível atualizar."),
  });
}

export function useExcluirBem() {
  const invalidar = useInvalidar();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await sb.from("sup_patrimonio").delete().eq("id", id).select("id");
      if (error) throw error;
      // DELETE barrado pela RLS não devolve erro, devolve zero linhas.
      if (!data?.length) {
        throw new Error("Nada foi excluído — seu perfil não tem a ação 'excluir' em Patrimônio.");
      }
    },
    onSuccess: () => { invalidar(); toast.success("Bem excluído."); },
    onError: (e: any) => toast.error(e?.message ?? "Não foi possível excluir."),
  });
}

/** Envia a nota/foto e grava comentário e valor junto. */
export function useAnexarArquivo() {
  const invalidar = useInvalidar();
  return useMutation({
    mutationFn: async (v: {
      patrimonio_id: string; arquivo: File; comentario?: string | null; valor?: number | null;
    }) => {
      if (v.arquivo.size > 10 * 1024 * 1024) throw new Error("Arquivo maior que 10 MB.");
      const ext = (v.arquivo.name.split(".").pop() || "bin").toLowerCase();
      const caminho = `${v.patrimonio_id}/${crypto.randomUUID()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("sup-patrimonio").upload(caminho, v.arquivo);
      if (upErr) throw upErr;

      const { data: u } = await supabase.auth.getUser();
      let nome: string | null = null;
      if (u.user) {
        const { data: p } = await sb.from("profiles").select("display_name").eq("id", u.user.id).maybeSingle();
        nome = p?.display_name ?? null;
      }
      const { error } = await sb.from("sup_patrimonio_arquivo").insert({
        patrimonio_id: v.patrimonio_id,
        nome_arquivo: v.arquivo.name,
        caminho,
        tipo_mime: v.arquivo.type || null,
        tamanho_kb: Math.round(v.arquivo.size / 1024),
        comentario: v.comentario || null,
        valor: v.valor ?? null,
        enviado_por: u.user?.id ?? null,
        enviado_por_nome: nome,
      });
      if (error) throw error;
    },
    onSuccess: () => { invalidar(); toast.success("Arquivo anexado."); },
    onError: (e: any) => toast.error(e?.message ?? "Não foi possível anexar."),
  });
}

export function useAtualizarArquivo() {
  const invalidar = useInvalidar();
  return useMutation({
    mutationFn: async (v: { id: string; comentario?: string | null; valor?: number | null }) => {
      const { error } = await sb.from("sup_patrimonio_arquivo")
        .update({ comentario: v.comentario || null, valor: v.valor ?? null })
        .eq("id", v.id);
      if (error) throw error;
    },
    onSuccess: () => { invalidar(); toast.success("Anexo atualizado."); },
    onError: (e: any) => toast.error(e?.message ?? "Não foi possível atualizar o anexo."),
  });
}

export function useRemoverArquivo() {
  const invalidar = useInvalidar();
  return useMutation({
    mutationFn: async (a: ArquivoBem) => {
      await supabase.storage.from("sup-patrimonio").remove([a.caminho]);
      const { error } = await sb.from("sup_patrimonio_arquivo").delete().eq("id", a.id);
      if (error) throw error;
    },
    onSuccess: () => { invalidar(); toast.success("Anexo removido."); },
    onError: (e: any) => toast.error(e?.message ?? "Não foi possível remover."),
  });
}

/** Link temporário para abrir o anexo (bucket é privado). */
export async function urlDoArquivo(caminho: string): Promise<string | null> {
  const { data } = await supabase.storage.from("sup-patrimonio").createSignedUrl(caminho, 300);
  return data?.signedUrl ?? null;
}
