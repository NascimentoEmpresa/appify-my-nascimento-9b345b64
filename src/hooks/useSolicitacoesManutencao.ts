import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  BUCKET_SOLICITACAO_MANUTENCAO as BUCKET, validarArquivoManutencao,
  type CategoriaAnexoManutencao,
} from "@/lib/suprimentos/anexoManutencao";
import type { StatusManutencao } from "@/lib/suprimentos/manutencaoQr";

// As tabelas/RPCs desta migration ainda não existem no types.ts gerado.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as any;
const TABELA = "SUP_SOLICITACAO_MANUTENCAO";
const TABELA_ANEXO = "SUP_SOLICITACAO_MANUTENCAO_ANEXO";

export type TipoSolicitacaoManutencao = "peca" | "manutencao";
export type StatusSolicitacaoManutencao = StatusManutencao;

export interface EquipamentoManutencao {
  id: string; nome: string; numero_serie: string; placa_patrimonial: string; contrato_id: string;
}

export interface SolicitacaoManutencao {
  id: string; tipo: TipoSolicitacaoManutencao; contrato_id: string; patrimonio_id: string | null;
  maquinario: string; numero_serie: string; placa_patrimonial: string | null; descricao: string | null;
  status: StatusSolicitacaoManutencao; decisao_motivo: string | null; malote_despesa_id: string | null;
  solicitante_id: string; solicitante_nome: string | null; prestadora_empresa: string | null;
  prestadora_responsavel: string | null; respondida_em: string | null; created_at: string;
  contrato: { id: string; nome: string } | null;
}

export interface AnexoSolicitacaoManutencao {
  id: string; solicitacao_id: string; categoria: CategoriaAnexoManutencao; nome_arquivo: string;
  caminho: string; tipo_mime: string | null; tamanho_bytes: number | null; created_at: string;
}

export interface HistoricoSolicitacaoManutencao {
  id: string; solicitacao_id: string; status: StatusSolicitacaoManutencao; motivo: string | null;
  origem: string; autor_nome: string | null; created_at: string;
}

function invalidar(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ["sup_solicitacoes_manutencao"] });
}

function mensagemErro(erro: unknown, fallback: string) {
  return erro instanceof Error ? erro.message : fallback;
}

export function useSolicitacoesManutencao() {
  return useQuery({
    queryKey: ["sup_solicitacoes_manutencao"],
    queryFn: async (): Promise<SolicitacaoManutencao[]> => {
      const { data, error } = await sb.from(TABELA).select("*, contrato:contrato_id(id, nome)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useEquipamentosManutencao(contratoId: string | null, habilitado = true) {
  return useQuery({
    queryKey: ["sup_equipamentos_para_manutencao", contratoId], enabled: habilitado && !!contratoId,
    queryFn: async (): Promise<EquipamentoManutencao[]> => {
      const { data, error } = await sb.rpc("sup_equipamentos_para_manutencao", { p_contrato_id: contratoId });
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useAnexosSolicitacaoManutencao(solicitacaoId: string | null) {
  return useQuery({
    queryKey: ["sup_solicitacoes_manutencao", "anexos", solicitacaoId], enabled: !!solicitacaoId,
    queryFn: async (): Promise<AnexoSolicitacaoManutencao[]> => {
      const { data, error } = await sb.from(TABELA_ANEXO).select("*")
        .eq("solicitacao_id", solicitacaoId).order("created_at");
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useHistoricoSolicitacaoManutencao(solicitacaoId: string | null) {
  return useQuery({
    queryKey: ["sup_solicitacoes_manutencao", "historico", solicitacaoId], enabled: !!solicitacaoId,
    queryFn: async (): Promise<HistoricoSolicitacaoManutencao[]> => {
      const { data, error } = await sb.from("SUP_SOLICITACAO_MANUTENCAO_HISTORICO").select("*")
        .eq("solicitacao_id", solicitacaoId).order("created_at");
      if (error) throw error;
      return data ?? [];
    },
  });
}

async function enviarAnexo(usuarioId: string, solicitacaoId: string, arquivo: File, categoria: CategoriaAnexoManutencao) {
  const [rotulo, genero, padrao] = categoria === "orcamento" ? ["o orçamento", "o", "pdf"] : ["a foto", "a", "jpg"];
  const extensao = (arquivo.name.split(".").pop() || padrao).toLowerCase();
  const caminho = `${usuarioId}/${solicitacaoId}/${crypto.randomUUID()}.${extensao}`;
  const { error: erroUpload } = await supabase.storage.from(BUCKET).upload(caminho, arquivo);
  if (erroUpload) throw new Error(`Solicitação criada, mas ${rotulo} não foi enviad${genero}: ${erroUpload.message}`);
  const { error: erroAnexo } = await sb.from(TABELA_ANEXO).insert({
    solicitacao_id: solicitacaoId, categoria, nome_arquivo: arquivo.name, caminho,
    tipo_mime: arquivo.type || null, tamanho_bytes: arquivo.size,
  });
  if (erroAnexo) throw new Error(`Solicitação criada, mas ${rotulo} não foi vinculad${genero}: ${erroAnexo.message}`);
}

export function useCriarSolicitacaoManutencao() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dados: {
      tipo: TipoSolicitacaoManutencao; contrato_id: string; patrimonio_id?: string | null;
      maquinario: string; numero_serie: string; placa_patrimonial?: string | null;
      descricao: string; foto: File; orcamento?: File | null;
    }) => {
      if (!dados.maquinario.trim() || !dados.numero_serie.trim()) throw new Error("Informe o maquinário e o número de série.");
      if (dados.tipo === "manutencao" && (!dados.patrimonio_id || !dados.placa_patrimonial?.trim())) {
        throw new Error("Selecione uma máquina cadastrada com série e patrimônio.");
      }
      const recusaFoto = validarArquivoManutencao(dados.foto, "foto_equipamento");
      const recusaOrcamento = dados.orcamento ? validarArquivoManutencao(dados.orcamento, "orcamento") : null;
      if (recusaFoto || recusaOrcamento) throw new Error(recusaFoto || recusaOrcamento || "Arquivo inválido.");
      const { data: usuario } = await supabase.auth.getUser();
      if (!usuario.user) throw new Error("Sessão não identificada.");
      const nome = usuario.user.user_metadata?.full_name ?? usuario.user.user_metadata?.name ?? usuario.user.email ?? null;
      const { data: solicitacao, error } = await sb.from(TABELA).insert({
        tipo: dados.tipo, contrato_id: dados.contrato_id,
        patrimonio_id: dados.tipo === "manutencao" ? dados.patrimonio_id : null,
        maquinario: dados.maquinario.trim(), numero_serie: dados.numero_serie.trim(),
        placa_patrimonial: dados.tipo === "manutencao" ? dados.placa_patrimonial?.trim() : null,
        descricao: dados.descricao.trim() || null,
        status: dados.tipo === "manutencao" ? "aguardando_orcamento" : "aberta",
        solicitante_id: usuario.user.id, solicitante_nome: nome,
      }).select("id").single();
      if (error) throw error;
      await enviarAnexo(usuario.user.id, solicitacao.id, dados.foto, "foto_equipamento");
      if (dados.orcamento) {
        await enviarAnexo(usuario.user.id, solicitacao.id, dados.orcamento, "orcamento");
        const { error: erroEtapa } = await sb.rpc("sup_solicitacao_manutencao_registrar_orcamento", { p_solicitacao_id: solicitacao.id });
        if (erroEtapa) throw erroEtapa;
      }
      return solicitacao.id as string;
    },
    onSuccess: () => { invalidar(qc); toast.success("Solicitação enviada ao Almoxarifado."); },
    onError: (erro: unknown) => toast.error(mensagemErro(erro, "Não foi possível enviar a solicitação.")),
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
    onSuccess: () => { invalidar(qc); toast.success("Resposta registrada."); },
    onError: (erro: unknown) => toast.error(mensagemErro(erro, "Não foi possível registrar a resposta.")),
  });
}

export function useEncerrarSolicitacaoManutencao() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await sb.rpc("sup_encerrar_solicitacao_manutencao", { p_solicitacao_id: id });
      if (error) throw error;
    },
    onSuccess: () => { invalidar(qc); toast.success("Retirada confirmada e manutenção encerrada."); },
    onError: (erro: unknown) => toast.error(mensagemErro(erro, "Não foi possível encerrar.")),
  });
}

export async function abrirAnexoSolicitacaoManutencao(caminho: string) {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(caminho, 300);
  if (error || !data?.signedUrl) throw new Error(error?.message ?? "Não foi possível abrir o anexo.");
  window.open(data.signedUrl, "_blank", "noopener,noreferrer");
}
