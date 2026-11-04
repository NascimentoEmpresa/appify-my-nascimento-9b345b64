import { useEffect, useRef } from "react";
import type { QueryClient } from "@tanstack/react-query";

// =====================================================================
// "ATUALIZAR ESTA TELA" — a única forma de buscar dado novo sem navegar
// (03/11/2026, item 5 da revisão de infraestrutura)
//
// Até aqui ~40 pontos do ERP buscavam dado sozinhos: refetchInterval de 4 s a
// 5 min, setInterval de 2,5 s a 30 s, refetch ao voltar para a aba. Medido no
// log do Kong de 03/11: uma aba PARADA fazia ~13 requisições por minuto, e
// com 62 abas abertas isso era a maior parte da carga do banco o dia todo.
// Nas quedas, esse ritmo multiplicava (post-mortem, docs/incidentes/).
//
// A regra agora: o ERP só pede ao servidor quando o USUÁRIO pede — abrir a
// tela, filtrar, salvar, ou clicar em "Atualizar" (botão na barra do topo,
// em toda tela). Sem exceção: sininho, chat, painel de TV, conferência.
//
// O botão faz duas coisas:
//   1. invalida as consultas do React Query que estão NA TELA (refetchType
//      "active") — as de outras telas ficam para quando forem abertas;
//   2. avisa as telas que carregam dado fora do React Query (useEffect com
//      fetch próprio) pelo evento "erp:atualizar"; elas se inscrevem com
//      useAoPedirAtualizacao(carregar).
// =====================================================================

const EVENTO = "erp:atualizar";

export async function atualizarTela(qc: QueryClient) {
  window.dispatchEvent(new Event(EVENTO));
  await qc.invalidateQueries({ refetchType: "active" });
}

/** A tela carrega dado por conta própria? Inscreva o carregador aqui. */
export function useAoPedirAtualizacao(carregar: () => unknown) {
  const ref = useRef(carregar);
  ref.current = carregar;
  useEffect(() => {
    const fn = () => { void ref.current(); };
    window.addEventListener(EVENTO, fn);
    return () => window.removeEventListener(EVENTO, fn);
  }, []);
}
