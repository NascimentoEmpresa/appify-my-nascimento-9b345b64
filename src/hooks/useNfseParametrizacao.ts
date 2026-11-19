import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { SupabaseClient } from "@supabase/supabase-js";

// SIS-2026-0941: parametrização fiscal da NFS-e (mig 20261120020000).
export interface ParametroServicoNfse {
  id: string;
  municipio_emissor: string;
  item_lc116: string;
  descricao: string;
  codigo_tributacao: string;
  codigo_nbs: string;
  codigo_integracao_municipal: string;
  ibs_cst: string;
  ibs_classificacao: string;
  ibs_indicador_operacao: string;
  ativo: boolean;
  atualizado_em: string;
  atualizado_por: string | null;
}
export type ParametroServicoEntrada = Omit<ParametroServicoNfse, "id" | "atualizado_em" | "atualizado_por"> & { id?: string };
export interface DadosContratoNfse {
  contrato_id: string;
  tomador_documento: string;
  tomador_nome: string;
  tomador_inscricao_municipal: string;
  tomador_municipio: string;
  tomador_cep: string;
  tomador_logradouro: string;
  tomador_numero: string;
  tomador_complemento: string;
  tomador_bairro: string;
  tomador_email: string;
  local_prestacao: string;
  consumidor_final: string;
  tipo_ente_governamental: string;
  iss_retido: string;
  retencao_pis_cofins: string;
  item_lc116: string;
  origem_solicitacao_id: string | null;
  atualizado_em: string;
  atualizado_por: string | null;
  contrato?: { nome: string; cliente: string | null } | null;
}
export interface ContratoParaNfse { id: string; nome: string; cliente: string | null; cnpj_cliente: string | null }

const CHAVE = "nfse-parametrizacao";
// Tabelas da migration da parametrização, sem reescrever o arquivo de tipos gerados.
const cliente = supabase as unknown as SupabaseClient;
const CAMPOS_SERVICO = "id,municipio_emissor,item_lc116,descricao,codigo_tributacao,codigo_nbs,codigo_integracao_municipal,ibs_cst,ibs_classificacao,ibs_indicador_operacao,ativo,atualizado_em,atualizado_por";
const CAMPOS_CONTRATO = "contrato_id,tomador_documento,tomador_nome,tomador_inscricao_municipal,tomador_municipio,tomador_cep,tomador_logradouro,tomador_numero,tomador_complemento,tomador_bairro,tomador_email,local_prestacao,consumidor_final,tipo_ente_governamental,iss_retido,retencao_pis_cofins,item_lc116,origem_solicitacao_id,atualizado_em,atualizado_por";

/** Parâmetros de um município emissor; sem município, todos (tela de Parametrização). */
export function useParametrosServicoNfse(municipio?: string) {
  return useQuery({
    queryKey: [CHAVE, "servicos", municipio ?? "todos"],
    enabled: municipio !== "",
    queryFn: async () => {
      let consulta = cliente.from("NFSE_PARAMETRO_SERVICO").select(CAMPOS_SERVICO)
        .order("municipio_emissor").order("item_lc116").limit(500);
      if (municipio) consulta = consulta.eq("municipio_emissor", municipio);
      const { data, error } = await consulta;
      if (error) throw error;
      return (data ?? []) as ParametroServicoNfse[];
    },
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });
}
export function useDadosContratoNfse(contratoId: string | null | undefined) {
  return useQuery({
    queryKey: [CHAVE, "contrato", contratoId],
    enabled: Boolean(contratoId),
    queryFn: async () => {
      const { data, error } = await cliente.from("NFSE_DADOS_CONTRATO").select(CAMPOS_CONTRATO).eq("contrato_id", contratoId!).maybeSingle();
      if (error) throw error;
      return (data ?? null) as DadosContratoNfse | null;
    },
    refetchOnWindowFocus: false,
  });
}
export function useDadosContratosNfse() {
  return useQuery({
    queryKey: [CHAVE, "contratos"],
    queryFn: async () => {
      const { data, error } = await cliente.from("NFSE_DADOS_CONTRATO").select(`${CAMPOS_CONTRATO},contrato:contrato_id(nome,cliente)`)
        .order("atualizado_em", { ascending: false }).limit(1000);
      if (error) throw error;
      return (data ?? []) as unknown as DadosContratoNfse[];
    },
    refetchOnWindowFocus: false,
  });
}
/** Contratos para cadastrar um tomador novo; nome e CNPJ do cliente sugerem o tomador. */
export function useContratosParaNfse(habilitado: boolean) {
  return useQuery({
    queryKey: [CHAVE, "contratos-disponiveis"],
    enabled: habilitado,
    queryFn: async () => {
      const { data, error } = await cliente.from("contratos").select("id,nome,cliente,cnpj_cliente").order("nome").limit(1000);
      if (error) throw error;
      return (data ?? []) as ContratoParaNfse[];
    },
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });
}
/** Nomes de quem alterou, numa consulta só. Sem acesso aos perfis, a tela mostra só a data. */
export function useNomesUsuariosNfse(ids: string[]) {
  const unicos = [...new Set(ids.filter(Boolean))].sort();
  return useQuery({
    queryKey: [CHAVE, "nomes", unicos.join(",")],
    enabled: unicos.length > 0,
    queryFn: async () => {
      const { data, error } = await cliente.from("profiles").select("id,display_name,email").in("id", unicos);
      if (error) return {} as Record<string, string>;
      return Object.fromEntries((data ?? []).map((p: { id: string; display_name: string | null; email: string | null }) => [p.id, p.display_name || p.email || ""])) as Record<string, string>;
    },
    staleTime: 10 * 60_000,
    refetchOnWindowFocus: false,
  });
}
export function useSalvarParametroServicoNfse() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...linha }: ParametroServicoEntrada) => {
      const { error } = id
        ? await cliente.from("NFSE_PARAMETRO_SERVICO").update(linha).eq("id", id)
        : await cliente.from("NFSE_PARAMETRO_SERVICO").insert(linha);
      if (error) {
        if (error.code === "23505") throw new Error("Já existe parâmetro para este item de serviço neste município.");
        if (error.code === "23514") throw new Error("Algum código está fora do formato aceito pela prefeitura. Revise os campos.");
        if (error.code === "42501") throw new Error("Sem permissão para alterar a Parametrização Fiscal.");
        throw new Error(error.message);
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [CHAVE] }),
  });
}
export function useSalvarDadosContratoNfse() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ contratoId, dados }: { contratoId: string; dados: Record<string, unknown> }) => {
      const { error } = await cliente.rpc("nfse_salvar_dados_contrato", { _contrato_id: contratoId, _dados: dados });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [CHAVE] }),
  });
}
