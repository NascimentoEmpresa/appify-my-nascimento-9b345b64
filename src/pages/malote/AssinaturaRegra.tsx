// Assinatura de uma regra no infobox (i): qual chamado a definiu, quando entrou e onde está no código, para quem for alterá-la saber por onde começar.
// Ao subir uma mudança de regra, acrescente a assinatura dela em ASSINATURAS e use <AssinaturaRegra chamado="SIS-AAAA-NNNN" /> no fim do infobox.
interface Assinatura { chamado: string; desde: string; resumo: string; onde: string }

const ASSINATURAS: Record<string, Assinatura> = {
  // `desde` = data em que a regra entrou (data da entrega; ajustar para a do merge/produção se divergir).
  "SIS-2026-0828": {
    chamado: "SIS-2026-0828", desde: "16/11/2026",
    resumo: "orçamento de contratos pelo EXECUTADO (faturado nas NFs do mês) a partir de 70% do executável da Planilha de Custo; antes disso, ou sem NF no mês corrente e nos futuros, pelo executável (previsto); mês passado sem NF = 0",
    onde: "LIMIAR_EXECUTADO / baseDoOrcamento / computarGruposContrato (src/hooks/useOrcamentoContratos.ts)",
  },
  "SIS-2026-0893": {
    chamado: "SIS-2026-0893", desde: "19/11/2026",
    resumo: "Fluxo de Caixa Gerencial: recebido pela data de pagamento (não pela emissão da nota), faturamento por emissão/competência/vencimento, vencimento da NF (ajuste manual › prazo do contrato › emissão + 30), aging dos pendentes, despesas por contrato/classificação com comparativo, empréstimos e aplicações separados do fluxo operacional, análises mensais e projeção diária de caixa (motor)",
    onde: "src/pages/financeiro/fluxo-caixa-gerencial/ (regras.ts, vencimento.ts, pendentes.ts, analiseDespesas.ts, emprestimosAplicacoes.ts, analiseGerencial.ts, projecaoDiaria.ts) e FluxoCaixaGerencial.tsx",
  },
  "SIS-2026-0903": {
    chamado: "SIS-2026-0903", desde: "17/11/2026",
    resumo: "Conciliação Financeira ampliada: 24 indicadores em 4 fontes (indisponível ≠ zero), detalhamento até a nota, impostos/descontos, conta vinculada, filtros, Excel e tratativas com histórico",
    onde: "src/pages/financeiro/conciliacao-servicos/ (indicadores.ts, regras.ts, tratativas.ts) e textos em infos.tsx",
  },
  "SIS-2026-0926": {
    chamado: "SIS-2026-0926", desde: "18/11/2026",
    resumo: "coluna Reserva Empresa (R$) no Resumo Mensal com Sócios do Fechamento da Empresa, ao lado de Obras Adm: o valor vem do Fechamento dos Sócios (competência fechada = gravado; aberta = percentual × Resultado do Período), sem digitar de novo e fora das despesas, retiradas, investimentos e obras",
    onde: "reservaDoMesParaEmpresa / calcularReserva (src/pages/controladoria/fechamento-socios/regras.ts) e a coluna em FechamentoEmpresa.tsx",
  },
  "SIS-2026-0927": {
    chamado: "SIS-2026-0927", desde: "17/11/2026",
    resumo: "unificar 2+ lançamentos (Malote/Débito Automático) de um mesmo pagamento bancário numa linha só; os originais ficam guardados e some só da leitura; rateio por classificação e centro de custo fecha sempre com o total; só a Controladoria; histórico completo",
    onde: "src/pages/financeiro/fluxo-caixa/unificacao.ts (conferências), RPCs fluxo_caixa_unificar/_ratear/_desfazer e views v_malote_pagamento_fluxo_caixa/v_debito_automatico_fluxo_caixa (migration 20261117240000)",
  },
  "SIS-2026-0911": {
    chamado: "SIS-2026-0911", desde: "19/11/2026",
    resumo: "Imóveis Detalhamento (Jurídico › Patrimônios): por imóvel, aquisição (valor do contrato do cadastro) + Investimentos/Obras (gastos do Fluxo de Caixa vinculados ao imóvel em contrato de tratamento Investimento ou Obra administrativa) + manutenção (demais gastos vinculados) = total aplicado; resultado potencial = valor estimado de venda − total aplicado; o vínculo lançamento → imóvel é feito na Alteração em massa do Fluxo de Caixa",
    onde: "src/pages/juridico/patrimonio/imoveisRegras.ts (resumoDoImovel / tipoDoGasto), ImoveisDetalhamento.tsx, hook useImoveisDetalhamento.ts e a função juridico_imoveis_lancamentos (migration 20261120010000)",
  },
  "SIS-2026-0925": {
    chamado: "SIS-2026-0925", desde: "17/11/2026",
    resumo: "Reserva de Investimento (%) por competência no Fechamento dos Sócios: Total a Distribuir = Resultado do Período − Reserva; consumo da Empresa e retiradas saem depois da divisão",
    onde: "calcularMes / calcularReserva (src/pages/controladoria/fechamento-socios/regras.ts) e BannerReserva (FechamentoSocios.tsx)",
  },
};

export function AssinaturaRegra({ chamado }: { chamado: keyof typeof ASSINATURAS | string }) {
  const a = ASSINATURAS[chamado];
  if (!a) return null;
  return (
    <span className="mt-1 block border-t border-border/60 pt-1 text-[10px] leading-snug text-muted-foreground">
      Regra do chamado <b>{a.chamado}</b>, em vigor desde {a.desde}: {a.resumo}. Para alterar: <code>{a.onde}</code>.
    </span>
  );
}
