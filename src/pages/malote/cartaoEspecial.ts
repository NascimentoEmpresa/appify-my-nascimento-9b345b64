import { useMemo } from "react";
import { useFormasPagamento } from "@/hooks/useMaloteFormaPagamento";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

// [SEM-CHAMADO] Despesa de cartão de crédito com Fluxo Especial (SIS-2026-0439). A compra já foi feita no cartão, então a
// despesa é paga no dia em que é lançada: Data de Pagamento = dia da criação, Competência = mês de hoje (editável), e ela
// segue o Fluxo Especial (um aprovador fixo) sem pedir exceção. A exceção da SIS-2026-0668 exige senha do N2 e tirou esse
// fluxo, porque pagar "hoje" fica antes do prazo normal de inclusão.

export interface CartaoEspecialDaForma {
  rotulo: string; // nome da forma de pagamento (para o aviso)
  dataPagamento: string; // YYYY-MM-DD = hoje (dia em que a despesa entra no Malote)
  competencia: string; // YYYY-MM = mês de hoje
}

// Data de pagamento e competência de uma despesa de cartão com Fluxo Especial lançada em `hoje` ("YYYY-MM-DD").
export function datasDaDespesaDeCartao(hoje: string): { dataPagamento: string; competencia: string } {
  return { dataPagamento: hoje, competencia: hoje.slice(0, 7) };
}

// Forma de pagamento com Fluxo Especial ligada a um cartão ativo. Quem lança a despesa (ex.: Compras) não tem o menu "Cartão de
// Crédito" e a RLS esconde os cartões dele, então a pergunta vai a uma função do banco que devolve só um booleano
// (malote_forma_e_cartao_fluxo_especial, migration 20261019000013). Devolve null para qualquer outra forma.
export function useCartaoEspecialDaForma(formaPagamento: string): CartaoEspecialDaForma | null {
  const { data: formas = [] } = useFormasPagamento();
  const forma = formas.find((f) => f.nome === formaPagamento && f.fluxo_aprovacao === "especial");
  const { data: ehCartao = false } = useQuery({
    queryKey: ["malote_forma_e_cartao_fluxo_especial", forma?.nome ?? ""],
    enabled: !!forma,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("malote_forma_e_cartao_fluxo_especial", { _forma: forma!.nome });
      if (error) throw error;
      return !!data;
    },
  });
  return useMemo(() => {
    if (!forma || !ehCartao) return null;
    return { rotulo: forma.nome, ...datasDaDespesaDeCartao(new Date().toLocaleDateString("sv-SE")) };
  }, [forma, ehCartao]);
}
