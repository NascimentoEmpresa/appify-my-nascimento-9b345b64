import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useEmpresaAtiva } from "@/context/EmpresaAtivaContext";
import { useAuth } from "@/hooks/useAuth";

export type CotacaoStatus = "pendente" | "visualizado" | "respondido";

export type CotacaoLicitacao = {
  id: string;
  empresa_id: string;
  tipo: string;
  comentario: string;
  arquivo_url: string | null;
  arquivo_nome: string | null;
  remetente_id: string | null;
  remetente_nome: string | null;
  status: CotacaoStatus;
  visualizado_por_id: string | null;
  visualizado_por_nome: string | null;
  visualizado_em: string | null;
  resposta_comentario: string | null;
  resposta_arquivo_url: string | null;
  resposta_arquivo_nome: string | null;
  respondente_id: string | null;
  respondente_nome: string | null;
  data_resposta: string | null;
  resposta_visualizada_por_id: string | null;
  resposta_visualizada_em: string | null;
  editado_por_id: string | null;
  editado_por_nome: string | null;
  editado_em: string | null;
  created_at: string;
  updated_at: string;
};

const BUCKET = "cotacoes-arquivos";

async function uploadArquivo(file: File, empresaId: string): Promise<{ url: string; nome: string }> {
  const ext = file.name.split(".").pop();
  const path = `${empresaId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, file);
  if (error) throw error;
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return { url: data.publicUrl, nome: file.name };
}

export function useCotacoesLicitacao() {
  const { empresa } = useEmpresaAtiva();
  const empresaId = empresa?.id ?? null;

  return useQuery({
    queryKey: ["cotacoes_licitacao", empresaId],
    enabled: !!empresaId,
    staleTime: 30_000,
    queryFn: async (): Promise<CotacaoLicitacao[]> => {
      const { data, error } = await supabase
        .from("cotacoes_licitacao")
        .select("*")
        .eq("empresa_id", empresaId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as CotacaoLicitacao[];
    },
  });
}

export function useCotacaoInsert() {
  const qc = useQueryClient();
  const { empresa } = useEmpresaAtiva();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async (payload: {
      tipo: string;
      comentario: string;
      arquivo: File | null;
      remetente_nome: string;
    }) => {
      let arquivo_url: string | null = null;
      let arquivo_nome: string | null = null;
      if (payload.arquivo) {
        const up = await uploadArquivo(payload.arquivo, empresa.id);
        arquivo_url = up.url;
        arquivo_nome = up.nome;
      }
      const { error } = await supabase.from("cotacoes_licitacao").insert({
        empresa_id: empresa.id,
        tipo: payload.tipo,
        comentario: payload.comentario,
        arquivo_url,
        arquivo_nome,
        remetente_id: user?.id ?? null,
        remetente_nome: payload.remetente_nome,
        status: "pendente",
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["cotacoes_licitacao"] }),
  });
}

export function useCotacaoUpdate() {
  const qc = useQueryClient();
  const { empresa } = useEmpresaAtiva();

  return useMutation({
    mutationFn: async (payload: {
      id: string;
      comentario: string;
      arquivo: File | null;
      editado_por_nome: string;
      editado_por_id: string;
    }) => {
      let extra: Record<string, unknown> = {};
      if (payload.arquivo) {
        const up = await uploadArquivo(payload.arquivo, empresa.id);
        extra = { arquivo_url: up.url, arquivo_nome: up.nome };
      }
      const { error } = await supabase
        .from("cotacoes_licitacao")
        .update({
          comentario: payload.comentario,
          editado_por_id: payload.editado_por_id,
          editado_por_nome: payload.editado_por_nome,
          editado_em: new Date().toISOString(),
          // Editar reseta visualização do compras
          visualizado_por_id: null,
          visualizado_por_nome: null,
          visualizado_em: null,
          status: "pendente",
          ...extra,
        })
        .eq("id", payload.id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["cotacoes_licitacao"] }),
  });
}

export function useCotacaoDelete() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("cotacoes_licitacao").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["cotacoes_licitacao"] }),
  });
}

export function useCotacaoMarcarRespostaVista() {
  const qc = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("cotacoes_licitacao")
        .update({
          resposta_visualizada_por_id: user?.id ?? null,
          resposta_visualizada_em: new Date().toISOString(),
        })
        .eq("id", id)
        .eq("status", "respondido")
        .is("resposta_visualizada_por_id", null);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["cotacoes_licitacao"] }),
  });
}
