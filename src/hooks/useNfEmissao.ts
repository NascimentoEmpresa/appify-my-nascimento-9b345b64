import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { ItemCalculado, TotaisNf, PercentuaisFiscais, InssCategoria } from "@/pages/financeiro/nf-emissao/calculos";
import { itemParaGravar, substituirItensNf } from "@/pages/financeiro/nf-emissao/itemParaGravar";
import { ordenarPorConclusao } from "@/pages/financeiro/nf-emissao/ordemConclusao";

const BUCKET = "nf-emissao";

const NF_EMISSAO_KEY = "nf_emissao";

export const TIPOS_NOTA = {
  N: "Normal",
  R: "Repactuação",
  M: "Materiais",
  DH: "Diárias e horas extras",
} as const;
export type TipoNota = keyof typeof TIPOS_NOTA;

export interface NfEmissaoRow {
  id: string;
  empresa_id: string;
  contrato_id: string;
  variacao: string | null;
  competencia: string;
  data_emissao: string | null;
  numero_nf: string | null;
  codigo_servico: string | null;
  cnae: string | null;
  nbs: string | null;
  status: "rascunho" | "enviada" | "concluida" | "cancelada";
  tipo_nota: TipoNota;
  descricao: string | null;
  observacoes: string | null;
  observacoes_financeiro: string | null;
  data_pagamento: string | null;
  valor_pago: number | null;
  situacao_site_pmt: string | null;
  situacao_dominio: string | null;
  desconto_conta_vinculada: number;
  recebimento_extra: number;
  falta_receber: number;
  pago_a_mais: number;
  valor_contrato_exec_total: number;
  vlr_bruto_total: number;
  vlr_liquido_total: number;
  issqn_total: number;
  inss_total: number;
  ir_total: number;
  cofins_total: number;
  pis_total: number;
  csll_total: number;
  issqn_pct: number;
  ir_pct: number;
  cofins_pct: number;
  pis_pct: number;
  csll_pct: number;
  created_at: string;
  // SIS-2026-0614: quando o Financeiro concluiu/cancelou a validação (ordem dos relatórios). Ausente
  // enquanto a migration 20261007000003 não foi aplicada; nulo em rascunho/enviada.
  concluida_em?: string | null;
  // null = linha importada da planilha legada (SIS-2026-0540), sem autor no app.
  created_by: string | null;
  // Lixeira do Relatório Geral: != null = NF na lixeira (fora de todos os totais).
  deleted_at: string | null;
  deleted_by: string | null;
  nf_emissao_modelo_id: string | null;
  contrato: { id: string; nome: string; cliente: string } | null;
  empresa: { id: string; nome_fantasia: string | null; razao_social: string } | null;
}

// SIS-2026-0323: Relatório Geral e Dashboard precisam de NFs de TODAS as
// empresas de uma vez — mesmo padrão de `useContratosERP({ todasEmpresas })`.
// PostgREST devolve no máximo 1000 linhas por padrão — sem paginação, a
// importação do Relatório de Serviços (SIS-2026-0540, 1561 notas) ficava
// cortada em 1000 silenciosamente, sem erro (achado real: "Total de Notas"
// no Dashboard mostrava 1.000 fixo). Mesma classe de bug já corrigida em
// Fluxo de Caixa e Aprovações do Malote (useMaloteDespesa.ts).
async function buscarTodasNfsEmissao(todasEmpresas: boolean, empresaId: string | null | undefined, naLixeira = false) {
  const TAMANHO_PAGINA = 1000;
  const linhas: NfEmissaoRow[] = [];
  for (let pagina = 0; ; pagina++) {
    let q = (supabase as any)
      .from("nf_emissao")
      .select("*, contrato:contrato_id(id, nome, cliente), empresa:empresa_id(id, nome_fantasia, razao_social)")
      .order(naLixeira ? "deleted_at" : "created_at", { ascending: false })
      .range(pagina * TAMANHO_PAGINA, pagina * TAMANHO_PAGINA + TAMANHO_PAGINA - 1);
    q = naLixeira ? q.not("deleted_at", "is", null) : q.is("deleted_at", null);
    if (!todasEmpresas) q = q.eq("empresa_id", empresaId);
    const { data, error } = await q;
    if (error) throw error;
    linhas.push(...((data ?? []) as NfEmissaoRow[]));
    if (!data || data.length < TAMANHO_PAGINA) break;
  }
  return linhas;
}

export function useNfsEmissao(empresaId: string | null | undefined, opts?: { todasEmpresas?: boolean }) {
  const todasEmpresas = opts?.todasEmpresas ?? false;
  return useQuery({
    queryKey: todasEmpresas ? [NF_EMISSAO_KEY, "todas"] : [NF_EMISSAO_KEY, empresaId],
    enabled: todasEmpresas || !!empresaId,
    // Todas as empresas = base dos relatórios: ordem de CONCLUSÃO pelo Financeiro (SIS-2026-0614).
    // A lista por empresa é a do analista (Emissão) e segue pela data de criação.
    queryFn: async () => {
      const linhas = await buscarTodasNfsEmissao(todasEmpresas, empresaId);
      return todasEmpresas ? ordenarPorConclusao(linhas) : linhas;
    },
  });
}

// NFs na lixeira (todas as empresas) — só a aba Relatório Geral lê isto.
export function useNfsEmissaoLixeira(habilitado = true) {
  return useQuery({
    queryKey: [NF_EMISSAO_KEY, "lixeira"],
    enabled: habilitado,
    queryFn: () => buscarTodasNfsEmissao(true, null, true),
  });
}

export interface AnexoParaEnviar {
  file: File;
}

interface SalvarNfEmissaoInput {
  empresa_id: string;
  contrato_id: string;
  variacao: string | null;
  competencia: string;
  data_emissao: string | null;
  numero_nf: string | null;
  codigo_servico: string | null;
  cnae: string | null;
  nbs: string | null;
  tipo_nota: TipoNota;
  descricao: string | null;
  observacoes: string | null;
  itens: ItemCalculado[];
  totais: TotaisNf;
  pctFiscais: PercentuaisFiscais;
  anexos: AnexoParaEnviar[];
  status: "rascunho" | "enviada";
  nf_emissao_modelo_id?: string | null;
}

export function useSalvarNfEmissao() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: SalvarNfEmissaoInput) => {
      const userId = (await supabase.auth.getUser()).data.user?.id ?? null;

      const { data: nf, error } = await (supabase as any)
        .from("nf_emissao")
        .insert({
          empresa_id: input.empresa_id,
          contrato_id: input.contrato_id,
          variacao: input.variacao,
          competencia: input.competencia,
          data_emissao: input.data_emissao,
          numero_nf: input.numero_nf,
          codigo_servico: input.codigo_servico,
          cnae: input.cnae,
          nbs: input.nbs,
          tipo_nota: input.tipo_nota,
          descricao: input.descricao,
          observacoes: input.observacoes,
          status: input.status,
          nf_emissao_modelo_id: input.nf_emissao_modelo_id ?? null,
          ...input.totais,
          ...input.pctFiscais,
          created_by: userId,
          updated_by: userId,
        })
        .select("id")
        .single();
      if (error) throw error;

      const nfId = nf.id as string;

      if (input.itens.length > 0) {
        const payloadItens = input.itens.map((it, idx) => itemParaGravar(it as any, nfId, idx));
        const { error: eItens } = await (supabase as any).from("nf_emissao_item").insert(payloadItens);
        if (eItens) throw eItens;
      }

      for (const a of input.anexos) {
        const path = `${input.empresa_id}/${nfId}/${Date.now()}-${a.file.name}`;
        const up = await supabase.storage.from(BUCKET).upload(path, a.file, {
          contentType: a.file.type,
          upsert: false,
        });
        if (up.error) throw up.error;
        const { error: eAnexo } = await (supabase as any).from("nf_emissao_anexo").insert({
          nf_emissao_id: nfId,
          storage_path: path,
          file_name: a.file.name,
          mime_type: a.file.type,
          size_bytes: a.file.size,
          uploaded_by: userId,
        });
        if (eAnexo) throw eAnexo;
      }

      return nfId;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [NF_EMISSAO_KEY] }),
  });
}

interface AtualizarNfEmissaoInput {
  id: string;
  empresa_id: string;
  contrato_id: string;
  variacao: string | null;
  competencia: string;
  data_emissao: string | null;
  codigo_servico: string | null;
  cnae: string | null;
  nbs: string | null;
  tipo_nota: TipoNota;
  descricao: string | null;
  observacoes: string | null;
  itens: ItemCalculado[];
  totais: TotaisNf;
  pctFiscais: PercentuaisFiscais;
  anexosNovos: AnexoParaEnviar[];
  anexosParaRemover: { id: string; storage_path: string }[];
  status: "rascunho" | "enviada";
  nf_emissao_modelo_id?: string | null;
}

export function useAtualizarNfEmissao() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: AtualizarNfEmissaoInput) => {
      const userId = (await supabase.auth.getUser()).data.user?.id ?? null;

      const { error } = await (supabase as any)
        .from("nf_emissao")
        .update({
          contrato_id: input.contrato_id,
          variacao: input.variacao,
          competencia: input.competencia,
          data_emissao: input.data_emissao,
          codigo_servico: input.codigo_servico,
          cnae: input.cnae,
          nbs: input.nbs,
          tipo_nota: input.tipo_nota,
          descricao: input.descricao,
          observacoes: input.observacoes,
          status: input.status,
          ...(input.nf_emissao_modelo_id !== undefined ? { nf_emissao_modelo_id: input.nf_emissao_modelo_id } : {}),
          ...input.totais,
          ...input.pctFiscais,
          updated_by: userId,
        })
        .eq("id", input.id);
      if (error) throw error;

      await substituirItensNf(supabase, input.id, input.itens as any);

      for (const a of input.anexosParaRemover) {
        const rm = await supabase.storage.from(BUCKET).remove([a.storage_path]);
        if (rm.error) throw rm.error;
        const { error: eDelAnexo } = await (supabase as any).from("nf_emissao_anexo").delete().eq("id", a.id);
        if (eDelAnexo) throw eDelAnexo;
      }

      for (const a of input.anexosNovos) {
        const path = `${input.empresa_id}/${input.id}/${Date.now()}-${a.file.name}`;
        const up = await supabase.storage.from(BUCKET).upload(path, a.file, {
          contentType: a.file.type,
          upsert: false,
        });
        if (up.error) throw up.error;
        const { error: eAnexo } = await (supabase as any).from("nf_emissao_anexo").insert({
          nf_emissao_id: input.id,
          storage_path: path,
          file_name: a.file.name,
          mime_type: a.file.type,
          size_bytes: a.file.size,
          uploaded_by: userId,
        });
        if (eAnexo) throw eAnexo;
      }

      return input.id;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [NF_EMISSAO_KEY] });
      qc.invalidateQueries({ queryKey: ["nf_emissao_item"] });
      qc.invalidateQueries({ queryKey: ["nf_emissao_anexo"] });
    },
  });
}

interface ValidarNfEmissaoInput {
  id: string;
  numero_nf: string | null;
  data_emissao: string | null;
  observacoes_financeiro: string | null;
  itens: ItemCalculado[];
  totais: TotaisNf;
  status: "concluida" | "cancelada";
}

export function useValidarNfEmissao() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: ValidarNfEmissaoInput) => {
      const userId = (await supabase.auth.getUser()).data.user?.id ?? null;

      // Itens PRIMEIRO, status da nota por último: se a gravação dos itens falhar
      // (e substituirItensNf devolve os antigos), a NF continua "enviada" para
      // ser validada de novo — antes ela ficava concluída/cancelada e sem itens
      // (incidente da NF 1416, 06/10/2026).
      await substituirItensNf(supabase, input.id, input.itens as any);

      const { error } = await (supabase as any)
        .from("nf_emissao")
        .update({
          numero_nf: input.numero_nf,
          data_emissao: input.data_emissao,
          observacoes_financeiro: input.observacoes_financeiro,
          status: input.status,
          ...input.totais,
          updated_by: userId,
        })
        .eq("id", input.id);
      if (error) throw error;

      return input.id;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [NF_EMISSAO_KEY] });
      qc.invalidateQueries({ queryKey: ["nf_emissao_item"] });
    },
  });
}

interface RegistrarPagamentoNfInput {
  id: string;
  data_pagamento: string | null;
  valor_pago: number | null;
  situacao_site_pmt?: string | null;
  situacao_dominio?: string | null;
  desconto_conta_vinculada?: number;
  recebimento_extra?: number;
  falta_receber?: number;
  pago_a_mais?: number;
  // Achado real (analista faz o processo no fim do dia, Financeiro só
  // emite/reconcilia no dia seguinte — sem campo aqui, a correção da data
  // de emissão exigia ir pra outra tela, Emissão de NF).
  data_emissao?: string | null;
  // SIS-2026-0582: Ruan corrige o número da NF direto no Relatório de Serviços.
  numero_nf?: string | null;
}

// SIS-2026-0592: grava o ajuste de valores de uma NF concluída (descontos
// pós-emissão + VA/VT/materiais por item + bruto/retenções/líquido derivados, por item e no total).
// Sem RPC: a RLS de nf_emissao_item e o guard de nf_emissao (concluída) já
// exigem a ação 'excluir' em nf-emissao (Nível D) — a tela só oferece o botão
// a quem a tem.
const r2nf = (n: number) => Math.round(n * 100) / 100;

export interface AjusteDescontosPosInput {
  nfId: string;
  itens: {
    id: string;
    multas_pos_emissao: number;
    glosas_pos_emissao: number;
    outros_descontos_pos_emissao: number;
    vlr_va: number;
    vlr_vt: number;
    vlr_materiais: number;
    total_descontos: number;
    vlr_bruto: number;
    vlr_mao_obra: number;
    vlr_liquido: number;
    issqn: number;
    inss: number;
    ir: number;
    cofins: number;
    pis: number;
    csll: number;
  }[];
  totais: {
    vlr_bruto_total: number;
    vlr_mao_obra_total: number;
    vlr_liquido_total: number;
    issqn_total: number;
    inss_total: number;
    ir_total: number;
    cofins_total: number;
    pis_total: number;
    csll_total: number;
  };
}

export function useAjustarDescontosPosEmissao() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ nfId, itens, totais }: AjusteDescontosPosInput) => {
      for (const { id, ...campos } of itens) {
        const corpo = Object.fromEntries(Object.entries(campos).map(([k, v]) => [k, r2nf(v as number)]));
        const { error } = await (supabase as any).from("nf_emissao_item").update(corpo).eq("id", id);
        if (error) throw error;
      }
      const corpoTotais = Object.fromEntries(Object.entries(totais).map(([k, v]) => [k, r2nf(v)]));
      const { error } = await (supabase as any).from("nf_emissao").update(corpoTotais).eq("id", nfId);
      if (error) throw error;
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: [NF_EMISSAO_KEY] });
      qc.invalidateQueries({ queryKey: ["nf_emissao_item"] });
    },
  });
}

export function useRegistrarPagamentoNf() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: RegistrarPagamentoNfInput) => {
      const { error } = await (supabase as any)
        .from("nf_emissao")
        .update({
          data_pagamento: input.data_pagamento,
          valor_pago: input.valor_pago,
          ...(input.situacao_site_pmt !== undefined ? { situacao_site_pmt: input.situacao_site_pmt } : {}),
          ...(input.situacao_dominio !== undefined ? { situacao_dominio: input.situacao_dominio } : {}),
          ...(input.desconto_conta_vinculada !== undefined ? { desconto_conta_vinculada: input.desconto_conta_vinculada } : {}),
          ...(input.recebimento_extra !== undefined ? { recebimento_extra: input.recebimento_extra } : {}),
          ...(input.falta_receber !== undefined ? { falta_receber: input.falta_receber } : {}),
          ...(input.pago_a_mais !== undefined ? { pago_a_mais: input.pago_a_mais } : {}),
          ...(input.data_emissao !== undefined ? { data_emissao: input.data_emissao } : {}),
          ...(input.numero_nf !== undefined ? { numero_nf: input.numero_nf } : {}),
        })
        .eq("id", input.id);
      if (error) throw error;
      return input.id;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [NF_EMISSAO_KEY] }),
  });
}

export function useExcluirNfEmissao() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; anexos: { storage_path: string }[] }) => {
      if (input.anexos.length > 0) {
        const rm = await supabase.storage.from(BUCKET).remove(input.anexos.map((a) => a.storage_path));
        if (rm.error) throw rm.error;
      }
      const { error } = await (supabase as any).from("nf_emissao").delete().eq("id", input.id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [NF_EMISSAO_KEY] }),
  });
}

// Lixeira do Relatório Geral: enviar (deleted_at = agora) e restaurar (null).
// O guard de imutabilidade + a RLS exigem a ação 'excluir' em nf-emissao
// (Nível D) para mexer em NF concluída/cancelada.
async function marcarLixeira(ids: string[], enviar: boolean) {
  const userId = enviar ? ((await supabase.auth.getUser()).data.user?.id ?? null) : null;
  const campos = enviar ? { deleted_at: new Date().toISOString(), deleted_by: userId } : { deleted_at: null, deleted_by: null };
  const TAMANHO_LOTE = 100;
  for (let i = 0; i < ids.length; i += TAMANHO_LOTE) {
    const { error } = await (supabase as any).from("nf_emissao").update(campos).in("id", ids.slice(i, i + TAMANHO_LOTE));
    if (error) throw error;
  }
}

export function useEnviarNfsParaLixeira() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ids: string[]) => marcarLixeira(ids, true),
    onSuccess: () => qc.invalidateQueries({ queryKey: [NF_EMISSAO_KEY] }),
  });
}

export function useRestaurarNfsDaLixeira() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ids: string[]) => marcarLixeira(ids, false),
    onSuccess: () => qc.invalidateQueries({ queryKey: [NF_EMISSAO_KEY] }),
  });
}

// Exclusão DEFINITIVA em lote (só a partir da lixeira do Relatório Geral).
// Itens/anexos (linhas) saem por ON DELETE CASCADE; os ARQUIVOS dos anexos no
// storage são removidos antes. O trigger de imutabilidade + a RLS exigem a
// ação 'excluir' em nf-emissao (Nível D).
export function useExcluirNfsEmissaoEmLote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (ids: string[]) => {
      const TAMANHO_LOTE = 100;
      for (let i = 0; i < ids.length; i += TAMANHO_LOTE) {
        const lote = ids.slice(i, i + TAMANHO_LOTE);
        const { data: anexos, error: eAnexos } = await (supabase as any).from("nf_emissao_anexo").select("storage_path").in("nf_emissao_id", lote);
        if (eAnexos) throw eAnexos;
        const paths = ((anexos ?? []) as { storage_path: string }[]).map((a) => a.storage_path);
        if (paths.length > 0) {
          const rm = await supabase.storage.from(BUCKET).remove(paths);
          if (rm.error) throw rm.error;
        }
        const { error } = await (supabase as any).from("nf_emissao").delete().in("id", lote);
        if (error) throw error;
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [NF_EMISSAO_KEY] }),
  });
}

export function useEnviarNfEmissao() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).from("nf_emissao").update({ status: "enviada" }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [NF_EMISSAO_KEY] }),
  });
}

// A analista reabre uma NF cancelada pelo Financeiro (a validação rejeitou) para
// corrigir e reenviar — volta para 'rascunho' na MESMA nota (itens, anexos e
// histórico ficam). Regras e exceção do guard: migration
// 20261007000020_nf_emissao_reabrir_cancelada.sql.
export function useReabrirNfCancelada() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).rpc("nf_emissao_reabrir_cancelada", { _id: id });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [NF_EMISSAO_KEY] });
      qc.invalidateQueries({ queryKey: ["nf_emissao_historico"] });
    },
  });
}

export interface NfEmissaoItemRow {
  id: string;
  nf_emissao_id: string;
  ordem: number;
  identificacao: string | null;
  valor_contrato_exec: number;
  vlr_va: number;
  vlr_vt: number;
  vlr_materiais: number;
  faltas: number;
  posto_nao_implementado: number;
  multas: number;
  glosas: number;
  outros_descontos: number;
  multas_pos_emissao: number;
  glosas_pos_emissao: number;
  outros_descontos_pos_emissao: number;
  justificativa_multas: string | null;
  justificativa_glosas: string | null;
  justificativa_outros_descontos: string | null;
  qtd_colaboradores: number;
  vlr_bruto: number;
  total_descontos: number;
  vlr_mao_obra: number;
  vlr_liquido: number;
  issqn: number;
  inss: number;
  ir: number;
  cofins: number;
  pis: number;
  csll: number;
  inss_categoria: InssCategoria;
  issqn_pct: number | null;
  ir_pct: number | null;
  cofins_pct: number | null;
  pis_pct: number | null;
  csll_pct: number | null;
}

export function useItensNfEmissao(nfEmissaoId: string | null | undefined) {
  return useQuery({
    queryKey: ["nf_emissao_item", nfEmissaoId],
    enabled: !!nfEmissaoId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("nf_emissao_item")
        .select("*")
        .eq("nf_emissao_id", nfEmissaoId)
        .order("ordem");
      if (error) throw error;
      return (data ?? []) as NfEmissaoItemRow[];
    },
  });
}

// SIS-2026-0323: Dashboard/Relatório Geral precisam somar campos de
// desconto que só existem a nível de ITEM (Faltas, Multas, Glosas...) pra
// todas as NFs filtradas de uma vez — mesmo espírito "volume modesto,
// agregação client-side" do `useResumoPendencias` do Checklist de Faturamento.
export function useItensNfEmissaoEmLote(nfIds: string[]) {
  const chave = [...nfIds].sort().join(",");
  return useQuery({
    queryKey: ["nf_emissao_item", "lote", chave],
    enabled: nfIds.length > 0,
    queryFn: async () => {
      // Mesmo limite de 1000 linhas do PostgREST (ver buscarTodasNfsEmissao)
      // — com 1561 notas concluídas, .in() sozinho já cortava os itens das
      // últimas notas. Pagina em blocos de ids (também evita URL longa
      // demais com 1561 uuids num .in() só) e em blocos de linhas dentro
      // de cada bloco de ids.
      const TAMANHO_BLOCO_IDS = 200;
      const TAMANHO_PAGINA = 1000;
      const todosItens: NfEmissaoItemRow[] = [];
      for (let i = 0; i < nfIds.length; i += TAMANHO_BLOCO_IDS) {
        const bloco = nfIds.slice(i, i + TAMANHO_BLOCO_IDS);
        for (let pagina = 0; ; pagina++) {
          const { data, error } = await (supabase as any)
            .from("nf_emissao_item")
            .select("*")
            .in("nf_emissao_id", bloco)
            .range(pagina * TAMANHO_PAGINA, pagina * TAMANHO_PAGINA + TAMANHO_PAGINA - 1);
          if (error) throw error;
          todosItens.push(...((data ?? []) as NfEmissaoItemRow[]));
          if (!data || data.length < TAMANHO_PAGINA) break;
        }
      }
      const porNf = new Map<string, NfEmissaoItemRow[]>();
      for (const item of todosItens) {
        const arr = porNf.get(item.nf_emissao_id) ?? [];
        arr.push(item);
        porNf.set(item.nf_emissao_id, arr);
      }
      return porNf;
    },
  });
}

export function useAnexosNfEmissao(nfEmissaoId: string | null | undefined) {
  return useQuery({
    queryKey: ["nf_emissao_anexo", nfEmissaoId],
    enabled: !!nfEmissaoId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("nf_emissao_anexo")
        .select("*")
        .eq("nf_emissao_id", nfEmissaoId);
      if (error) throw error;
      return data ?? [];
    },
  });
}

export async function baixarAnexoNfEmissao(storagePath: string) {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(storagePath, 60);
  if (error) throw error;
  return data.signedUrl;
}

export interface NfEmissaoHistoricoRow {
  id: string;
  nf_emissao_id: string;
  user_id: string;
  acao: string;
  detalhe: string;
  created_at: string;
}

export function useHistoricoNfEmissao(nfEmissaoId: string | null | undefined) {
  return useQuery({
    queryKey: ["nf_emissao_historico", nfEmissaoId],
    enabled: !!nfEmissaoId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("nf_emissao_historico")
        .select("*")
        .eq("nf_emissao_id", nfEmissaoId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as NfEmissaoHistoricoRow[];
    },
  });
}

export interface UsuarioAtivo {
  id: string;
  display_name: string;
}

export function useUsuariosAtivos() {
  return useQuery({
    queryKey: ["usuarios_ativos"],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("listar_usuarios_ativos");
      if (error) throw error;
      return (data ?? []) as UsuarioAtivo[];
    },
  });
}
