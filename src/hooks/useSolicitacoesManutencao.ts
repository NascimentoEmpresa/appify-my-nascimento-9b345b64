import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

const sb = supabase as any;
const TABELA = "SUP_SOLICITACAO_MANUTENCAO";
const TABELA_ANEXO = "SUP_SOLICITACAO_MANUTENCAO_ANEXO";
const BUCKET = "sup-solicitacoes-manutencao";

export type TipoSolicitacaoManutencao = "peca" | "manutencao";
export type StatusSolicitacaoManutencao =
  | "aberta" | "peca_disponivel" | "compra_solicitada"
  | "manutencao_autorizada" | "manutencao_reprovada";

export interface SolicitacaoManutencao {
  id: string;
  tipo: TipoSolicitacaoManutencao;
  contrato_id: string;
  maquinario: string;
  numero_serie: string;
  descricao: string | null;
  status: StatusSolicitacaoManutencao;
  decisao_motivo: string | null;
  malote_despesa_id: string | null;
  solicitante_id: string;
  solicitante_nome: string | null;
  respondida_em: string | null;
  created_at: string;
  contrato: { id: string; nome: string } | null;
}

export interface AnexoSolicitacaoManutencao {
  id: string;
  solicitacao_id: string;
  nome_arquivo: string;
  caminho: string;
  tipo_mime: string | null;
  tamanho_bytes: number | null;
  created_at: string;
}

function invalidar(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ["sup_solicitacoes_manutencao"] });
}

export function useSolicitacoesManutencao() {
  return useQuery({
    queryKey: ["sup_solicitacoes_manutencao"],
    queryFn: async (): Promise<SolicitacaoManutencao[]> => {
      const { data, error } = await sb.from(TABELA)
        .select("*, contrato:contrato_id(id, nome)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useAnexosSolicitacaoManutencao(solicitacaoId: string | null) {
  return useQuery({
    queryKey: ["sup_solicitacoes_manutencao", "anexos", solicitacaoId],
    enabled: !!solicitacaoId,
    queryFn: async (): Promise<AnexoSolicitacaoManutencao[]> => {
      const { data, error } = await sb.from(TABELA_ANEXO).select("*")
        .eq("solicitacao_id", solicitacaoId).order("created_at");
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useCriarSolicitacaoManutencao() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dados: {
      tipo: TipoSolicitacaoManutencao; contrato_id: string; maquinario: string;
      numero_serie: string; descricao: string; foto: File;
    }) => {
      if (!dados.maquinario.trim() || !dados.numero_serie.trim()) {
        throw new Error("Informe o maquinário e o número de série.");
      }
      if (!dados.foto?.type.startsWith("image/")) {
        throw new Error("Anexe uma foto da máquina em formato de imagem.");
      }
      if (dados.foto.size > 5 * 1024 * 1024) throw new Error("A foto deve ter no máximo 5 MB.");

      const { data: usuario } = await supabase.auth.getUser();
      if (!usuario.user) throw new Error("Sessão não identificada.");
      const nome = usuario.user.user_metadata?.full_name
        ?? usuario.user.user_metadata?.name ?? usuario.user.email ?? null;
      const { data: solicitacao, error } = await sb.from(TABELA).insert({
        tipo: dados.tipo, contrato_id: dados.contrato_id, maquinario: dados.maquinario.trim(),
        numero_serie: dados.numero_serie.trim(), descricao: dados.descricao.trim() || null,
        solicitante_id: usuario.user.id, solicitante_nome: nome,
      }).select("id").single();
      if (error) throw error;

      const extensao = (dados.foto.name.split(".").pop() || "jpg").toLowerCase();
      const caminho = `${usuario.user.id}/${solicitacao.id}/${crypto.randomUUID()}.${extensao}`;
      const { error: erroUpload } = await supabase.storage.from(BUCKET).upload(caminho, dados.foto);
      if (erroUpload) throw new Error(`Solicitação criada, mas a foto não foi enviada: ${erroUpload.message}`);

      const { error: erroAnexo } = await sb.from(TABELA_ANEXO).insert({
        solicitacao_id: solicitacao.id, nome_arquivo: dados.foto.name, caminho,
        tipo_mime: dados.foto.type || null, tamanho_bytes: dados.foto.size,
      });
      if (erroAnexo) throw new Error(`Solicitação criada, mas a foto não foi vinculada: ${erroAnexo.message}`);
      return solicitacao.id as string;
    },
    onSuccess: () => {
      invalidar(qc);
      toast.success("Solicitação enviada ao Almoxarifado.");
    },
    onError: (erro: any) => toast.error(erro?.message ?? "Não foi possível enviar a solicitação."),
  });
}

export function useResponderSolicitacaoManutencao() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dados: { id: string; decisao: string; motivo: string }) => {
      const { data, error } = await sb.rpc("sup_responder_solicitacao_manutencao", {
        p_solicitacao_id: dados.id, p_decisao: dados.decisao, p_motivo: dados.motivo || null,
      });
      if (error) throw error;
      return data as string | null;
    },
    onSuccess: () => {
      invalidar(qc);
      toast.success("Resposta registrada.");
    },
    onError: (erro: any) => toast.error(erro?.message ?? "Não foi possível registrar a resposta."),
  });
}

export async function abrirAnexoSolicitacaoManutencao(caminho: string) {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(caminho, 300);
  if (error || !data?.signedUrl) throw new Error(error?.message ?? "Não foi possível abrir a foto.");
  window.open(data.signedUrl, "_blank", "noopener,noreferrer");
}
