import { situacaoEspecial } from "./shared";

// A analista pode reabrir para correção uma NF que o Financeiro CANCELOU na
// validação (o app mostra isso como "cancelada"). Mesma regra que a função
// nf_emissao_reabrir_cancelada aplica no banco (migration 20261007000020) — aqui
// só decide se o botão aparece; quem manda é o banco.
//   • status 'cancelada' (validação do Financeiro);
//   • NÃO cancelada/substituída no site ou no Domínio (isso é cancelamento de
//     verdade, fora do ERP);
//   • sem pagamento registrado.
export function podeReabrirNfCancelada(nf: {
  status?: string | null;
  situacao_site_pmt?: string | null;
  situacao_dominio?: string | null;
  data_pagamento?: string | null;
  valor_pago?: number | string | null;
}): boolean {
  return nf.status === "cancelada" && !situacaoEspecial(nf) && !nf.data_pagamento && !(Number(nf.valor_pago) > 0);
}
