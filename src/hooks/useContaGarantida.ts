import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { ContaGarantida, MovimentoContaGarantida, StatusConta, TipoMovimento } from "@/pages/financeiro/conta-garantida/regras";

// SIS-2026-0798: Conta Garantida nativa (migration 20261104004000). Substitui a versão que só lia a planilha de Fluxo de Caixa importada
// (fin_conta_garantida_*, ultrapassada e sem uso). Conta = linha de crédito; movimento = resgate / amortização / juros, que entra no Fluxo de
// Caixa pela view v_conta_garantida_fluxo_caixa. Quem escreve o movimento são as RPCs (conferem o saldo e o limite no servidor).

const CONTAS_KEY = "financeiro_conta_garantida";
const MOVIMENTOS_KEY = "financeiro_conta_garantida_movimento";

const num = (v: unknown) => Number(v ?? 0);

export function useContasGarantidas() {
  return useQuery({
    queryKey: [CONTAS_KEY],
    staleTime: 30_000,
    queryFn: async (): Promise<ContaGarantida[]> => {
      const { data, error } = await (supabase as any)
        .from("financeiro_conta_garantida")
        .select("id, numero, empresa_id, banco_id, conta_banco_id, conta, limite, taxa, vencimento, status, observacao")
        .order("numero");
      if (error) throw error;
      return ((data ?? []) as any[]).map((c) => ({ ...c, limite: num(c.limite) }));
    },
  });
}

export function useMovimentosContaGarantida() {
  return useQuery({
    queryKey: [MOVIMENTOS_KEY],
    staleTime: 30_000,
    queryFn: async (): Promise<MovimentoContaGarantida[]> => {
      const { data, error } = await (supabase as any)
        .from("financeiro_conta_garantida_movimento")
        .select("id, seq, numero, conta_garantida_id, tipo, data_movimento, valor, classificacao_id, observacao, cancelado_em, motivo_cancelamento, historico, origem_debito_id, created_at")
        .order("data_movimento", { ascending: false })
        .order("seq", { ascending: false });
      if (error) throw error;
      return ((data ?? []) as any[]).map((m) => ({ ...m, seq: num(m.seq), valor: num(m.valor) }));
    },
  });
}

/** O lançamento muda a conta, o Fluxo de Caixa (e a conciliação, que lê o Fluxo): invalida tudo que depende dele. */
function useInvalidarTudo() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: [CONTAS_KEY] });
    qc.invalidateQueries({ queryKey: [MOVIMENTOS_KEY] });
    qc.invalidateQueries({ queryKey: ["fluxo_caixa_combinado"] });
    qc.invalidateQueries({ queryKey: ["fluxo_caixa_malote"] });
    qc.invalidateQueries({ queryKey: ["fluxo_caixa_conta"] });
  };
}

export interface SalvarContaGarantidaInput {
  id?: string;
  empresaId: string;
  bancoId: string;
  contaBancoId: string | null;
  conta: string;
  limite: number;
  taxa: string | null;
  vencimento: string | null;
  status: StatusConta;
  observacao: string | null;
}

export function useSalvarContaGarantida() {
  const invalidar = useInvalidarTudo();
  return useMutation({
    mutationFn: async (input: SalvarContaGarantidaInput) => {
      const userId = (await supabase.auth.getUser()).data.user?.id ?? null;
      const campos = {
        empresa_id: input.empresaId,
        banco_id: input.bancoId,
        conta_banco_id: input.contaBancoId,
        conta: input.conta.trim(),
        limite: input.limite,
        taxa: input.taxa?.trim() || null,
        vencimento: input.vencimento || null,
        status: input.status,
        observacao: input.observacao?.trim() || null,
      };
      const db = (supabase as any).from("financeiro_conta_garantida");
      const { error } = input.id
        ? await db.update({ ...campos, updated_by: userId }).eq("id", input.id)
        : await db.insert({ ...campos, created_by: userId });
      if (error) {
        if (error.code === "23505") throw new Error("Já existe uma conta garantida com esse número para a empresa e o banco.");
        throw error;
      }
    },
    onSuccess: invalidar,
  });
}

export interface LancarContaGarantidaInput {
  contaId: string;
  tipo: TipoMovimento;
  data: string;
  valor: number;
  classificacaoId: string;
  observacao: string | null;
}

export function useLancarContaGarantida() {
  const invalidar = useInvalidarTudo();
  return useMutation({
    mutationFn: async (input: LancarContaGarantidaInput) => {
      const { data, error } = await (supabase as any).rpc("conta_garantida_lancar", {
        _conta_id: input.contaId,
        _tipo: input.tipo,
        _data: input.data,
        _valor: input.valor,
        _classificacao_id: input.classificacaoId,
        _observacao: input.observacao,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: invalidar,
  });
}

export function useEstornarMovimentoContaGarantida() {
  const invalidar = useInvalidarTudo();
  return useMutation({
    mutationFn: async ({ movimentoId, motivo }: { movimentoId: string; motivo: string }) => {
      const { error } = await (supabase as any).rpc("conta_garantida_estornar", { _movimento_id: movimentoId, _motivo: motivo });
      if (error) throw error;
    },
    onSuccess: invalidar,
  });
}
