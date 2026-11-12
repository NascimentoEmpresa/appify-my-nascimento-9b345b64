import type { AplicacaoFinanceiraLinha, AplicacaoFinanceiraResgateCaixa, AplicacaoHistoricoImportado } from "@/hooks/useAplicacaoFinanceira";

// Totais da carteira de Aplicações Financeiras. Extraído de AplicacoesFinanceiras.tsx para o Fluxo de Caixa Gerencial (SIS-2026-0871) mostrar o MESMO
// saldo que a tela de Aplicações (uma cópia da conta poderia se afastar dela). As duas telas chamam esta função.
export function kpisAplicacoes(
  linhas: AplicacaoFinanceiraLinha[],
  resgatesCaixa: AplicacaoFinanceiraResgateCaixa[],
  historico: AplicacaoHistoricoImportado[],
) {
  const ativas = linhas.filter((l) => l.status === "ativa");
  // SIS-2026-0588: resgate novo não mexe na linha (saldo_principal da view só desconta os resgates antigos, por linha) — o principal já resgatado pela
  // tabela do caixa sai daqui para o card acompanhar o resgate lançado.
  const principalResgatadoCaixa = resgatesCaixa.reduce((s, r) => s + Number(r.valor_principal), 0);
  // SIS-2026-0651: histórico importado do Fluxo (até 08/09). O que foi aplicado e ainda não resgatado até lá segue aplicado; resgates e rendimentos
  // entram nos totais.
  const histAplicado = historico.filter((h) => h.movimento === "aplicacao").reduce((s, h) => s + h.valor, 0);
  const histResgatado = historico.filter((h) => h.movimento === "resgate").reduce((s, h) => s + h.valor, 0);
  const histRendimento = historico.filter((h) => h.movimento === "rendimento").reduce((s, h) => s + h.valor, 0);
  const totalAplicado = ativas.reduce((s, l) => s + Number(l.saldo_principal), 0) - principalResgatadoCaixa + (histAplicado - histResgatado);
  const rendimentoAcumulado = ativas.reduce((s, l) => s + Number(l.rendimento_acumulado), 0) + histRendimento;
  // Resgate não é mais por linha (entra no caixa da empresa, ver useResgatarMontanteAplicacao) — a soma vem da tabela própria, não das colunas
  // total_principal_resgatado/total_rendimento_resgatado da view (essas ficam sempre zero para resgates feitos por esse fluxo).
  const totalResgatado = resgatesCaixa.reduce((s, r) => s + Number(r.valor_principal) + Number(r.valor_rendimento), 0) + histResgatado;
  const vencidas = ativas.filter((l) => l.status_exibicao === "vencida").length;
  return { totalAplicado, rendimentoAcumulado, totalResgatado, vencidas };
}
