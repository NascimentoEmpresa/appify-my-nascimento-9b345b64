/**
 * Resolve o destino de uma notificação do sininho (tabela `notificacoes`).
 *
 * A coluna `link` é o único ponteiro que a tabela tem para o registro de
 * origem — não existe `entidade_id`/`metadata`. Ela é gravada pelos produtores
 * (triggers de reunião, sup_aprov_avancar, RPC de aprovação de pagamento e a
 * edge function de SLA), então o caminho fica congelado no momento do INSERT:
 * linha antiga guarda rota antiga, e não dá pra corrigir o passado só arrumando
 * o produtor. Por isso a normalização mora aqui, no cliente, e vale igualmente
 * para o que já está gravado em produção e para o que vier depois.
 */

/** Rotas legadas gravadas em `notificacoes.link` que hoje apontam para o lugar errado. */
const REESCRITAS: { de: string; para: string; exato?: boolean }[] = [
  // sup_aprov_avancar gravava a tela de aprovações de licitações; o motor
  // unificado (sup_aprov) é lido no inbox. Só o caminho cru — se algum dia vier
  // com id/query, o destino já é outro e não deve ser reescrito.
  { de: "/app/aprovacoes", para: "/app/aprovacoes/inbox", exato: true },
  // A rota real é `/app/suprimentos/pedidos` (App.tsx). O caminho no plural
  // composto nunca existiu no router.
  { de: "/app/suprimentos/pedidos-compra", para: "/app/suprimentos/pedidos" },
];

/** Destino quando a notificação não trouxe link nenhum. */
const FALLBACK_POR_TIPO: Record<string, string> = {
  reuniao: "/app/central-servicos/reunioes",
  aprovacao_pagamento: "/app/aprovacoes/inbox",
  sup_aprov_pendente: "/app/aprovacoes/inbox",
  aprovacao_sla: "/app/aprovacoes/inbox",
};

/**
 * Devolve a rota para onde o clique na notificação deve levar, ou `null` quando
 * não há destino conhecido (aí o item continua não-clicável, como era antes).
 * Um retorno começando com `http` é externo e cabe ao chamador abrir em nova aba.
 */
export function resolverLinkNotificacao(n: { tipo: string; link: string | null }): string | null {
  const bruto = n.link?.trim();
  if (!bruto) return FALLBACK_POR_TIPO[n.tipo] ?? null;

  if (/^https?:\/\//i.test(bruto)) return bruto;

  // A edge function de SLA grava `/aprovacoes/inbox` sem o prefixo do shell,
  // o que cai direto no NotFound. Todas as telas internas vivem sob `/app`.
  let destino = bruto.startsWith("/") ? bruto : `/${bruto}`;
  if (destino !== "/app" && !destino.startsWith("/app/") && !destino.startsWith("/app?")) {
    destino = `/app${destino}`;
  }

  for (const r of REESCRITAS) {
    if (r.exato ? destino === r.de : destino === r.de || destino.startsWith(`${r.de}/`) || destino.startsWith(`${r.de}?`)) {
      destino = destino.replace(r.de, r.para);
      break;
    }
  }

  return destino;
}
