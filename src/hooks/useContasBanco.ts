import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { chaveContaDoLancamento, type ContaBanco, type OrigemFluxo } from "@/lib/contaBanco";

// SIS-2026-0777: contas do mesmo banco e a conta de cada lançamento do Fluxo. Tabelas novas: se a migration ainda não foi aplicada
// (42P01 / PGRST205), as telas seguem como antes (sem contas) em vez de quebrar.
const KEY_CONTAS = "financeiro_conta_banco";
const KEY_ATRIBUICOES = "fluxo_caixa_conta";
const PAGINA = 1000;
const semTabela = (e: { code?: string } | null) => !!e && (e.code === "42P01" || e.code === "PGRST205");

export function useContasBanco() {
  return useQuery({
    queryKey: [KEY_CONTAS],
    staleTime: 60_000,
    queryFn: async (): Promise<ContaBanco[]> => {
      const { data, error } = await (supabase as any)
        .from("financeiro_conta_banco")
        .select("id, banco_id, empresa_id, numero, apelido, ativo")
        .order("numero");
      if (error) {
        if (semTabela(error)) return [];
        throw error;
      }
      return (data ?? []) as ContaBanco[];
    },
  });
}

export interface SalvarContaBancoInput {
  id?: string;
  bancoId: string;
  empresaId: string;
  numero: string;
  apelido: string | null;
  ativo: boolean;
}

export function useSalvarContaBanco() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (i: SalvarContaBancoInput) => {
      const { data: auth } = await supabase.auth.getUser();
      const dados = { banco_id: i.bancoId, empresa_id: i.empresaId, numero: i.numero.trim(), apelido: i.apelido?.trim() || null, ativo: i.ativo, updated_at: new Date().toISOString() };
      const q = (supabase as any).from("financeiro_conta_banco");
      const { error } = i.id ? await q.update(dados).eq("id", i.id) : await q.insert({ ...dados, created_by: auth.user?.id ?? null });
      if (error) {
        if (error.code === "23505") throw new Error("Já existe uma conta com esse número neste banco e empresa.");
        throw error;
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY_CONTAS] }),
  });
}

/** chave do lançamento (origem|despesa|parcela) → conta. Busca a tabela inteira em páginas: é pequena perto do Fluxo e não usa filtro em URL. */
export function useContasDosLancamentos() {
  return useQuery({
    queryKey: [KEY_ATRIBUICOES],
    staleTime: 60_000,
    queryFn: async (): Promise<Map<string, string>> => {
      const mapa = new Map<string, string>();
      for (let pagina = 0; ; pagina += 1) {
        const { data, error } = await (supabase as any)
          .from("financeiro_fluxo_caixa_conta")
          .select("origem, despesa_id, parcela, conta_banco_id")
          .order("origem").order("despesa_id").order("parcela")
          .range(pagina * PAGINA, pagina * PAGINA + PAGINA - 1);
        if (error) {
          if (semTabela(error)) return new Map();
          throw error;
        }
        for (const r of data ?? []) {
          mapa.set(chaveContaDoLancamento({ origem: r.origem as OrigemFluxo, despesa_id: r.despesa_id, numero_parcela: r.parcela || null }), r.conta_banco_id);
        }
        if ((data ?? []).length < PAGINA) break;
      }
      return mapa;
    },
  });
}

export interface LinhaParaConta {
  origem: OrigemFluxo;
  despesa_id: string;
  numero_parcela: number | null;
}

const LOTE = 200;

/** Liga lançamentos a uma conta (ou tira a ligação, com `contaBancoId = null`). Grava em lotes; o que falhar volta com o motivo. */
export async function atribuirContaAosLancamentos(linhas: LinhaParaConta[], contaBancoId: string | null) {
  const { data: auth } = await supabase.auth.getUser();
  const feitas: LinhaParaConta[] = [];
  const erros: { linha: LinhaParaConta; motivo: string }[] = [];
  for (let i = 0; i < linhas.length; i += LOTE) {
    const lote = linhas.slice(i, i + LOTE);
    const q = (supabase as any).from("financeiro_fluxo_caixa_conta");
    let erro: { message?: string } | null = null;
    if (contaBancoId) {
      const registros = lote.map((l) => ({ origem: l.origem, despesa_id: l.despesa_id, parcela: l.numero_parcela ?? 0, conta_banco_id: contaBancoId, updated_by: auth.user?.id ?? null, updated_at: new Date().toISOString() }));
      ({ error: erro } = await q.upsert(registros, { onConflict: "origem,despesa_id,parcela" }));
    } else {
      for (const l of lote) {
        ({ error: erro } = await q.delete().match({ origem: l.origem, despesa_id: l.despesa_id, parcela: l.numero_parcela ?? 0 }));
        if (erro) break;
      }
    }
    if (erro) for (const linha of lote) erros.push({ linha, motivo: erro.message ?? "Erro ao salvar a conta." });
    else feitas.push(...lote);
  }
  return { feitas, erros };
}

export function useInvalidarContasDosLancamentos() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: [KEY_ATRIBUICOES] });
}
