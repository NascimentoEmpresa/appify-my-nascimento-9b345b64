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
  // Despesa PARCELADA: a 1ª parcela vence no vencimento da fatura em que a compra cai; as seguintes seguem o dia do desconto. null = os
  // dias do cartão não vieram (ou a forma bate com cartões de datas diferentes): a tela cai na data de hoje, como sempre.
  proximoVencimento: string | null;
  diaVencimento: number | null;
}

const doisDigitos = (n: number) => String(n).padStart(2, "0");
const ultimoDia = (ano: number, mes0: number) => new Date(ano, mes0 + 1, 0).getDate();

// Vencimento da fatura em que uma compra feita em `hoje` ("YYYY-MM-DD") cai, dados o dia de fechamento e o de vencimento do cartão.
// Compra até o dia do fechamento entra na fatura que fecha neste mês; depois dele, na do mês seguinte. O vencimento é o `diaVencimento`
// do mês do fechamento se vier depois dele, senão do mês seguinte (fecha dia 25, vence dia 5 → vence no mês seguinte). Dia 29–31 em mês
// curto vira o último dia do mês, e vencimento em fim de semana vai para a sexta anterior — a mesma regra das parcelas 2 em diante.
export function proximoVencimentoFatura(hoje: string, diaFechamento: number, diaVencimento: number): string {
  const [a, m, d] = hoje.split("-").map(Number);
  let ano = a;
  let mes0 = m - 1;
  const fechamentoDoMes = Math.min(diaFechamento, ultimoDia(ano, mes0));
  if (d > fechamentoDoMes) mes0 += 1; // a compra já passou do fechamento deste mês
  if (diaVencimento <= diaFechamento) mes0 += 1; // vence no mês seguinte ao do fechamento
  ano += Math.floor(mes0 / 12);
  mes0 = ((mes0 % 12) + 12) % 12;
  const venc = new Date(ano, mes0, Math.min(diaVencimento, ultimoDia(ano, mes0)));
  const semana = venc.getDay(); // 0 = domingo, 6 = sábado
  if (semana === 0) venc.setDate(venc.getDate() - 2);
  else if (semana === 6) venc.setDate(venc.getDate() - 1);
  return `${venc.getFullYear()}-${doisDigitos(venc.getMonth() + 1)}-${doisDigitos(venc.getDate())}`;
}

// Data de pagamento e competência de uma despesa de cartão com Fluxo Especial lançada em `hoje` ("YYYY-MM-DD").
export function datasDaDespesaDeCartao(hoje: string): { dataPagamento: string; competencia: string } {
  return { dataPagamento: hoje, competencia: hoje.slice(0, 7) };
}

// Forma de pagamento com Fluxo Especial ligada a um cartão ativo. Quem lança a despesa (ex.: Compras) não tem o menu "Cartão de
// Crédito" e a RLS esconde os cartões dele, então a pergunta vai a uma função do banco que devolve só um booleano
// (malote_forma_e_cartao_fluxo_especial, migration 20261019000013). Devolve null para qualquer outra forma.
export function useCartaoEspecialDaForma(formaPagamento: string, empresaId?: string | null): CartaoEspecialDaForma | null {
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
  // Dias de fechamento e vencimento do cartão (função do banco: quem lança não enxerga a tabela de cartões). Falha ou função ausente = null:
  // a tela mantém a data de hoje em vez de travar o lançamento.
  const { data: dias = null } = useQuery({
    queryKey: ["malote_cartao_fluxo_especial_dias", forma?.nome ?? "", empresaId ?? ""],
    enabled: !!forma && ehCartao,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("malote_cartao_fluxo_especial_dias", { _forma: forma!.nome, _empresa_id: empresaId ?? null });
      if (error) return null;
      const lista = (data ?? []) as { dia_fechamento: number; dia_vencimento: number }[];
      // mais de um cartão com datas diferentes para a mesma forma: não dá para saber qual é, não chuta.
      const distintos = new Set(lista.map((r) => `${r.dia_fechamento}/${r.dia_vencimento}`));
      return lista.length > 0 && distintos.size === 1 ? { fechamento: Number(lista[0].dia_fechamento), vencimento: Number(lista[0].dia_vencimento) } : null;
    },
  });
  return useMemo(() => {
    if (!forma || !ehCartao) return null;
    const hoje = new Date().toLocaleDateString("sv-SE");
    return {
      rotulo: forma.nome,
      ...datasDaDespesaDeCartao(hoje),
      proximoVencimento: dias ? proximoVencimentoFatura(hoje, dias.fechamento, dias.vencimento) : null,
      diaVencimento: dias ? dias.vencimento : null,
    };
  }, [forma, ehCartao, dias]);
}
