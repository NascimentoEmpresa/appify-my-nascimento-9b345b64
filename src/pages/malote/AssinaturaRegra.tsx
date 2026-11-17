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
  "SIS-2026-0903": {
    chamado: "SIS-2026-0903", desde: "17/11/2026",
    resumo: "Conciliação Financeira ampliada: 24 indicadores em 4 fontes (indisponível ≠ zero), detalhamento até a nota, impostos/descontos, conta vinculada, filtros, Excel e tratativas com histórico",
    onde: "src/pages/financeiro/conciliacao-servicos/ (indicadores.ts, regras.ts, tratativas.ts) e textos em infos.tsx",
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
