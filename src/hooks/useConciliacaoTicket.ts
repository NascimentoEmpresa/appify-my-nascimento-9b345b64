import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { LinhaErp, LinhaExtratoCsv } from "@/pages/financeiro/conciliacao-ticket/regras";

// SIS-2026-0825: dados da Conciliação da Ticket. As tabelas e RPCs novas (migration 20261116160000) ainda não estão nos tipos gerados do
// Supabase; este cliente declara só o que a tela usa, sem espalhar `any`.
type Resposta<T> = PromiseLike<{ data: T | null; error: { message: string } | null }>;

export interface ImportacaoTicket {
  id: string;
  arquivo_nome: string;
  periodo_ini: string;
  periodo_fim: string;
  qtd_linhas: number;
  total_creditos: number;
  total_boletos: number;
  importado_por_nome: string | null;
  importado_em: string;
}
export interface ResultadoImportacaoTicket { importacao_id: string; inseridas: number; substituidas: number; periodo_ini: string; periodo_fim: string }

interface LinhaExtratoRow { data: string; transacao: string; status: string; valor: number | string }
interface LinhaErpRow {
  despesa_id: string; origem: string; id_malote: string | null; numero_parcela: number | null; data_pagamento: string; descricao: string;
  empresa_id: string | null; empresa_nome: string | null; classificacao_nome: string | null; valor: number | string;
}

interface ClienteTicket {
  rpc(fn: "ticket_extrato_importar", args: { _arquivo: string; _linhas: LinhaExtratoCsv[] }): Resposta<ResultadoImportacaoTicket>;
  rpc(fn: "ticket_extrato_excluir_importacao", args: { _id: string }): Resposta<number>;
  rpc(fn: "ticket_conciliacao_erp", args: { _ini: string; _fim: string }): { range(de: number, ate: number): Resposta<LinhaErpRow[]> };
  from(tabela: "ticket_extrato_importacao"): { select(colunas: string): { order(coluna: string, o: { ascending: boolean }): Resposta<ImportacaoTicket[]> } };
  from(tabela: "ticket_extrato_linha"): { select(colunas: string): { order(coluna: string, o: { ascending: boolean }): { range(de: number, ate: number): Resposta<LinhaExtratoRow[]> } } };
}
const cliente = supabase as unknown as ClienteTicket;

const PAGINA = 1000; // o PostgREST devolve no máximo 1000 linhas por chamada
async function lerPaginas<T>(buscar: (de: number, ate: number) => Resposta<T[]>): Promise<T[]> {
  const todas: T[] = [];
  for (let de = 0; ; de += PAGINA) {
    const { data, error } = await buscar(de, de + PAGINA - 1);
    if (error) throw new Error(error.message);
    todas.push(...(data ?? []));
    if (!data || data.length < PAGINA) break;
  }
  return todas;
}

const KEY = "conciliacao_ticket";

export function useImportacoesTicket() {
  return useQuery({
    queryKey: [KEY, "importacoes"],
    queryFn: async () => {
      const { data, error } = await cliente.from("ticket_extrato_importacao").select("*").order("importado_em", { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []).map((i) => ({ ...i, total_creditos: Number(i.total_creditos), total_boletos: Number(i.total_boletos) }));
    },
  });
}

/** Todas as linhas do extrato gravado (todas as importações juntas). */
export function useLinhasExtratoTicket() {
  return useQuery({
    queryKey: [KEY, "linhas"],
    queryFn: async (): Promise<LinhaExtratoCsv[]> => {
      const rows = await lerPaginas((de, ate) => cliente.from("ticket_extrato_linha").select("data, transacao, status, valor").order("data", { ascending: true }).range(de, ate));
      return rows.map((r) => ({ data: r.data, transacao: r.transacao, status: r.status, valor: Number(r.valor) }));
    },
  });
}

/** O que o ERP pagou com "TICKET" na descrição entre as datas (YYYY-MM-DD). */
export function useErpTicket(ini: string | null, fim: string | null) {
  return useQuery({
    queryKey: [KEY, "erp", ini, fim],
    enabled: !!ini && !!fim,
    queryFn: async (): Promise<LinhaErp[]> => {
      const rows = await lerPaginas((de, ate) => cliente.rpc("ticket_conciliacao_erp", { _ini: ini as string, _fim: fim as string }).range(de, ate));
      return rows.map((r) => ({ ...r, data_pagamento: String(r.data_pagamento).slice(0, 10), valor: Number(r.valor) }));
    },
  });
}

export function useImportarExtratoTicket() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (i: { arquivo: string; linhas: LinhaExtratoCsv[] }) => {
      const { data, error } = await cliente.rpc("ticket_extrato_importar", { _arquivo: i.arquivo, _linhas: i.linhas });
      if (error) throw new Error(error.message);
      return data as ResultadoImportacaoTicket;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY] }),
  });
}

export function useExcluirImportacaoTicket() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await cliente.rpc("ticket_extrato_excluir_importacao", { _id: id });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY] }),
  });
}
