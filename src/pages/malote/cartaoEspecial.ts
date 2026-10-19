import { useMemo } from "react";
import { useFormasPagamento } from "@/hooks/useMaloteFormaPagamento";
import { useCartoesCredito, type CartaoCredito } from "@/hooks/useMaloteCartaoCredito";

// [SEM-CHAMADO] Despesa de cartão de crédito com Fluxo Especial (SIS-2026-0439). A compra já foi feita no cartão, então
// o pagamento é o vencimento da fatura: Data de Pagamento e Competência saem do cartão e a despesa não passa pelas
// regras de prazo/dia bloqueado/horário nem pede exceção (a exceção da SIS-2026-0668 exige senha do N2 e tirou esse fluxo).

function diasDoMes(ano: number, mes: number): number {
  return new Date(ano, mes, 0).getDate();
}

const pad2 = (n: number) => String(n).padStart(2, "0");

// Próximo vencimento do cartão a partir de `hoje` ("YYYY-MM-DD"): o dia de vencimento deste mês se ainda não passou
// (hoje conta), senão o do mês seguinte. Mês curto usa o último dia (vencimento 31 em fevereiro cai no 28/29).
export function proximoVencimentoCartao(diaVencimento: number, hoje: string): string {
  const [ano, mes] = hoje.split("-").map(Number);
  const dia = Math.max(1, Math.floor(diaVencimento));
  const nesteMes = `${ano}-${pad2(mes)}-${pad2(Math.min(dia, diasDoMes(ano, mes)))}`;
  if (nesteMes >= hoje) return nesteMes;
  const ano2 = mes === 12 ? ano + 1 : ano;
  const mes2 = mes === 12 ? 1 : mes + 1;
  return `${ano2}-${pad2(mes2)}-${pad2(Math.min(dia, diasDoMes(ano2, mes2)))}`;
}

export interface CartaoEspecialDaForma {
  cartao: CartaoCredito;
  vencimento: string; // YYYY-MM-DD
  competencia: string; // YYYY-MM
}

// Forma de pagamento com Fluxo Especial e cartão ativo cadastrado com o mesmo nome (cartão.tipo_forma_pagamento =
// despesa.forma_pagamento). Devolve null para qualquer outra forma.
export function useCartaoEspecialDaForma(formaPagamento: string): CartaoEspecialDaForma | null {
  const { data: formas = [] } = useFormasPagamento();
  const { data: cartoes = [] } = useCartoesCredito();
  return useMemo(() => {
    if (!formaPagamento) return null;
    const especial = formas.some((f) => f.nome === formaPagamento && f.fluxo_aprovacao === "especial");
    if (!especial) return null;
    const cartao = cartoes.find((c) => c.ativo && c.tipo_forma_pagamento === formaPagamento);
    if (!cartao) return null;
    const vencimento = proximoVencimentoCartao(cartao.dia_vencimento, new Date().toLocaleDateString("sv-SE"));
    return { cartao, vencimento, competencia: vencimento.slice(0, 7) };
  }, [formaPagamento, formas, cartoes]);
}
