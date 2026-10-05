import type { OFXTransaction, PlanilhaRow } from "@/lib/conciliacaoBancariaEngine";
import type { FluxoCaixaMaloteLinha } from "@/hooks/useFluxoCaixaMalote";
import { linhasFluxoParaPlanilhaRow } from "@/hooks/useConciliacaoFluxoCaixa";

// Conciliação do Fluxo de Caixa: o SALDO ANTERIOR (abertura da conta) entra
// como uma linha da própria conciliação, nos dois lados.
//
// O OFX só traz movimentos e o saldo final — o saldo anterior está no extrato
// impresso/PDF. Então a pessoa digita o do extrato; aqui ele vira uma
// "transação" do lado do extrato, e o "SALDO ANTERIOR" que já está no Fluxo
// (importação histórica, classificação "SALDO ANTERIOR") vira a linha do lado
// do Fluxo. O motor compara como qualquer outra linha: bate = OK; não bate =
// divergência que a pessoa resolve (ajustar/ignorar/criar) antes de salvar.
//
// Sem saldo digitado, o saldo do Fluxo fica FORA da comparação (nunca tem par
// no OFX e viraria divergência falsa — achado da Érica, AGPS/Banrisul).

export const CLASSIFICACAO_SALDO_ANTERIOR = "SALDO ANTERIOR";

export const ehSaldoAnterior = (l: { classificacao_nome: string | null }) =>
  (l.classificacao_nome ?? "").trim().toUpperCase() === CLASSIFICACAO_SALDO_ANTERIOR;

const r2 = (n: number) => Math.round(n * 100) / 100;

export function linhasSaldoAnterior(
  saldoFluxo: FluxoCaixaMaloteLinha[],
  saldoExtrato: number | null,
  dataInicio: string,
  banco: string
): { plan: PlanilhaRow[]; ofx: OFXTransaction[] } {
  if (saldoExtrato == null) return { plan: [], ofx: [] };

  let plan: PlanilhaRow[] = [];
  if (saldoFluxo.length === 1) {
    // Uma linha só: mantém o vínculo com o lançamento real (dá pra "Ajustar").
    plan = linhasFluxoParaPlanilhaRow(saldoFluxo);
  } else if (saldoFluxo.length > 1) {
    // Várias linhas do mesmo banco/empresa: compara pela SOMA, numa linha só
    // (sem despesaId — não existe um lançamento único pra ajustar).
    const total = r2(saldoFluxo.reduce((t, l) => t + (l.tipo === "entrada" ? Number(l.valor) : -Number(l.valor)), 0));
    const dia = saldoFluxo.map((l) => l.data_pagamento ?? "").filter(Boolean).sort()[0] ?? dataInicio;
    if (total !== 0) {
      plan = [{
        dia,
        valor: Math.abs(total),
        tipo: total > 0 ? "ENTRADA" : "SAÍDA",
        banco,
        despesaId: null,
        numeroParcela: null,
        origemFluxo: null,
        empresaNome: `Saldo anterior (${saldoFluxo.length} lançamentos somados)`,
      }];
    }
  }

  const valorExtrato = r2(saldoExtrato);
  if (valorExtrato === 0) return { plan, ofx: [] };

  const dia = plan[0]?.dia || dataInicio;
  return {
    plan,
    ofx: [{
      dia,
      valor: Math.abs(valorExtrato),
      tipo: valorExtrato > 0 ? "ENTRADA" : "SAÍDA",
      memo: "SALDO ANTERIOR (informado)",
      origem: "Saldo anterior informado",
    }],
  };
}
