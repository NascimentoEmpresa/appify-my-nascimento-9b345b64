import { useMemo } from "react";
import { useFormasPagamento } from "@/hooks/useMaloteFormaPagamento";
import { useCartoesCredito, type CartaoCredito } from "@/hooks/useMaloteCartaoCredito";

// [SEM-CHAMADO] Despesa de cartão de crédito com Fluxo Especial (SIS-2026-0439). A compra já foi feita no cartão, então a
// despesa é paga no dia em que é lançada: Data de Pagamento = dia da criação, Competência = mês de hoje (editável), e ela
// segue o Fluxo Especial (um aprovador fixo) sem pedir exceção. A exceção da SIS-2026-0668 exige senha do N2 e tirou esse
// fluxo, porque pagar "hoje" fica antes do prazo normal de inclusão.

export interface CartaoEspecialDaForma {
  cartao: CartaoCredito;
  dataPagamento: string; // YYYY-MM-DD = hoje (dia em que a despesa entra no Malote)
  competencia: string; // YYYY-MM = mês de hoje
}

// Data de pagamento e competência de uma despesa de cartão com Fluxo Especial lançada em `hoje` ("YYYY-MM-DD").
export function datasDaDespesaDeCartao(hoje: string): { dataPagamento: string; competencia: string } {
  return { dataPagamento: hoje, competencia: hoje.slice(0, 7) };
}

// Forma de pagamento com Fluxo Especial e cartão ativo cadastrado. A despesa grava o NOME da forma (catálogo nomeado, ex.
// "Cartão de Crédito Sicredi HAGG 119 - Final 2719 - (Usado no Malote)"); o cartão é ligado ao TIPO dela
// (malote_cartao_credito.tipo_forma_pagamento, ex. "Sicredi Final 2719 - (Usado no Malote)"). Casa pelo tipo da forma (e,
// por segurança, pelo próprio texto da despesa). Devolve null para qualquer outra forma.
export function useCartaoEspecialDaForma(formaPagamento: string): CartaoEspecialDaForma | null {
  const { data: formas = [] } = useFormasPagamento();
  const { data: cartoes = [] } = useCartoesCredito();
  return useMemo(() => {
    if (!formaPagamento) return null;
    const forma = formas.find((f) => f.nome === formaPagamento && f.fluxo_aprovacao === "especial");
    if (!forma) return null;
    const cartao = cartoes.find((c) => c.ativo && (c.tipo_forma_pagamento === forma.tipo || c.tipo_forma_pagamento === formaPagamento));
    if (!cartao) return null;
    return { cartao, ...datasDaDespesaDeCartao(new Date().toLocaleDateString("sv-SE")) };
  }, [formaPagamento, formas, cartoes]);
}
