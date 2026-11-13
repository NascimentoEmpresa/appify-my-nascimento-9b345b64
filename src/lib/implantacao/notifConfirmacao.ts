// =====================================================================
// BOLINHA DO "RESUMO DOS CONTRATOS" — regra pura (sem React, sem Supabase)
//
// Pedido do Pablo (13/11/2026): bolinha vermelha no módulo Licitações e no
// item do setor em "Resumo dos Contratos" enquanto o setor não confirmar o
// recebimento. A conta de verdade é do banco
// (implantacao_confirmacao_pendente, mig 20261115000800), que devolve
// { rota do item: quantidade }. Este arquivo é o espelho da regra, para o
// teste e para a Sidebar ler o mapa.
//
// UM CONTRATO ESPERA O SETOR quando:
//   • o contrato está ativo;
//   • todas as perguntas do setor estão respondidas (senão o botão
//     "Confirmar recebimento" fica desabilitado e ninguém apagaria a bolinha);
//   • não há confirmação gravada para o setor.
// Confirmação desatualizada não acende (a assinatura é calculada só no
// front); a própria tela já pede "confirme de novo".
// =====================================================================
import type { ResumoSetor } from "./painelSetores";
import { ROTA_PAINEL } from "@/pages/licitacoes/implantacao/rotasPainel";

export interface ContratoParaBolinha {
  status: "ativo" | "encerrado";
  setores: readonly Pick<ResumoSetor, "slug" | "prontoParaConfirmar" | "confirmacao">[];
}

/** O setor deste contrato está esperando "Confirmar recebimento"? */
export function setorAguardaConfirmacao(
  status: ContratoParaBolinha["status"],
  setor: Pick<ResumoSetor, "prontoParaConfirmar" | "confirmacao">,
): boolean {
  return status === "ativo" && setor.prontoParaConfirmar && !setor.confirmacao;
}

/**
 * { rota do item do setor: contratos pendentes }, só dos setores que a
 * pessoa pode ver (slugs). Mesmo formato do retorno da RPC.
 */
export function pendenciasPorRota(
  contratos: readonly ContratoParaBolinha[],
  slugsVisiveis: readonly string[],
): Record<string, number> {
  const saida: Record<string, number> = {};
  for (const c of contratos) {
    for (const s of c.setores) {
      if (!slugsVisiveis.includes(s.slug) || !setorAguardaConfirmacao(c.status, s)) continue;
      const rota = `${ROTA_PAINEL}/${s.slug}`;
      saida[rota] = (saida[rota] ?? 0) + 1;
    }
  }
  return saida;
}

/** O item do menu acende? */
export function itemComBolinha(porRota: Readonly<Record<string, number>>, rota: string): boolean {
  return (porRota[rota] ?? 0) > 0;
}
