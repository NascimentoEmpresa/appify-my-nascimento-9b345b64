import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { SupabaseClient } from "@supabase/supabase-js";

export interface ParametrosNfse {
  serie: string;
  municipio_emissor: string;
  inscricao_municipal: string;
  opcao_simples: string;
  regime_especial: string;
  regime_apuracao: string;
  local_prestacao: string;
  codigo_tributacao: string;
  codigo_municipal: string;
  codigo_integracao_municipal?: string;
  codigo_nbs: string;
  descricao: string;
  iss_retido: string;
  aliquota_iss: string;
  cst_pis_cofins: string;
  retencao_pis_cofins: string;
  ibs_cst: string;
  ibs_classificacao: string;
  ibs_indicador_operacao: string;
  consumidor_final: string;
  tipo_operacao: string;
  tipo_ente_governamental: string;
  informar_imovel?: boolean;
  imovel?: { cep: string; logradouro: string; numero: string; complemento: string; bairro: string; inscricao: string };
  tributos_aproximados_federais: string;
  tributos_aproximados_estaduais: string;
  tributos_aproximados_municipais: string;
  confirmacao_fiscal: boolean;
  confirmacao_producao?: boolean;
  tomador: {
    documento: string; nome: string; municipio: string; cep: string;
    logradouro: string; numero: string; complemento: string; bairro: string; email: string;
  };
}
export type EstadoNfse = "pendente" | "processando" | "aguardando" | "autorizada" | "rejeitada" | "erro" | "incerta";
export type AmbienteNfse = "homologacao" | "producao";
export interface ConfiguracaoNfse {
  ambiente: AmbienteNfse; serie: number | null; municipio_emissor: string;
  inscricao_municipal: string; habilitado: boolean; nf_piloto_id: string | null;
}
export interface SolicitacaoNfse {
  id: string;
  ambiente: AmbienteNfse;
  estado: EstadoNfse;
  serie: number;
  numero_dps: number;
  numero_nf: string | null;
  chave: string | null;
  mensagem: string | null;
  criado_em: string;
  atualizado_em: string;
  envio_iniciado_em: string | null;
  xml_retorno_path: string | null;
  pdf_path: string | null;
  dados: { parametros: ParametrosNfse };
}
const CHAVE = "nfse-integracao";
// Tabelas da migration do piloto, sem reescrever o arquivo de tipos gerados.
const clienteNfse = supabase as unknown as SupabaseClient;
const CAMPOS = "id,ambiente,estado,serie,numero_dps,numero_nf,chave,mensagem,criado_em,atualizado_em,envio_iniciado_em,xml_retorno_path,pdf_path,dados";

export function useConfiguracaoNfse(empresaId: string) {
  return useQuery({
    queryKey: [CHAVE, "configuracao", empresaId],
    queryFn: async () => {
      const { data, error } = await clienteNfse.from("NFSE_CONFIGURACAO")
        .select("ambiente,serie,municipio_emissor,inscricao_municipal,habilitado,nf_piloto_id")
        .eq("empresa_id", empresaId).limit(2);
      if (error) throw error;
      return (data ?? []) as ConfiguracaoNfse[];
    },
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });
}
export function useSolicitacoesNfse(notaId: string, ambiente: AmbienteNfse = "homologacao") {
  return useQuery({
    queryKey: [CHAVE, notaId, ambiente],
    queryFn: async () => {
      const { data, error } = await clienteNfse.from("NFSE_SOLICITACAO")
        .select(CAMPOS).eq("nf_emissao_id", notaId).eq("ambiente", ambiente).order("criado_em", { ascending: false }).limit(5);
      if (error) throw error;
      return (data ?? []) as SolicitacaoNfse[];
    },
    // O operador pede a atualização; não há polling ou refetch ao focar a aba.
    refetchOnWindowFocus: false,
  });
}
export function useSolicitarNfse(notaId: string, ambiente: AmbienteNfse = "homologacao") {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (parametros: ParametrosNfse) => {
      const { data, error } = await clienteNfse.rpc("nfse_solicitar_emissao", { _nf_id: notaId, _parametros: parametros, _ambiente: ambiente });
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [CHAVE, notaId] }),
  });
}
export function useReprocessarNfse(notaId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, descartar = false }: { id: string; descartar?: boolean }) => {
      const { error } = await clienteNfse.rpc("nfse_reprocessar", { _id: id, _descartar: descartar });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [CHAVE, notaId] }),
  });
}
export async function abrirDocumentoNfse(caminho: string) {
  const { data, error } = await supabase.storage.from("nfse-integracao").createSignedUrl(caminho, 60, { download: true });
  if (error) throw error;
  const link = document.createElement("a");
  link.href = data.signedUrl;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.click();
}
