import { useMemo } from "react";
import { useLeituraCompartilhada } from "@/pages/controladoria/faturamento/leituraCompartilhada";
import { codigosDoFiltro } from "@/pages/controladoria/faturamento/FiltroCodigoNota";
import { useBaseFaturamento } from "@/pages/controladoria/faturamento/useBaseFaturamento";
import { useCustosContratoAno, useDespesasAdmAno } from "@/pages/controladoria/faturamento/useCustosContratoMes";
import { useLigacoesRubrica } from "@/pages/controladoria/faturamento/useLigacoesRubrica";
import { custosPorContratoMes, totalCustos, type CustosPorRubrica } from "@/pages/controladoria/faturamento/regras";
import { admPorMesRubrica } from "@/pages/controladoria/fechamento/regras";
import type { NfComDatas } from "@/lib/operacional/indicadoresFaturamento";

// =====================================================================
// Operacional › Indicadores (09/11/2026): a base de Controladoria ›
// Faturamento da Empresa, com a MESMA escolha de empresa, base (competência ×
// pagamento) e código de nota que a pessoa fez lá. As telas 2 e 3 leem daqui
// para os números baterem com a tela de origem.
// `comCustos`: só a Lucratividade precisa do Fluxo de Caixa (dois anos, para
// o mês anterior de janeiro).
// =====================================================================

export function useIndicadoresFaturamento(ano: number, comCustos: boolean) {
  const leitura = useLeituraCompartilhada();
  const codigos = useMemo(() => codigosDoFiltro(leitura.codigo), [leitura.codigo]);
  const base = useBaseFaturamento(codigos);
  const custosAno = useCustosContratoAno(ano, comCustos, leitura.base);
  const custosAnt = useCustosContratoAno(ano - 1, comCustos, leitura.base);
  const admAno = useDespesasAdmAno(ano, leitura.base, comCustos);
  const admAnt = useDespesasAdmAno(ano - 1, leitura.base, comCustos);
  const { data: ligacoes } = useLigacoesRubrica();
  const empresa = leitura.empresaId === "todos" ? null : leitura.empresaId;

  const doRecorte = useMemo(() => base.contratos.filter((c) => !empresa || c.empresa_id === empresa), [base.contratos, empresa]);
  const contratos = useMemo(() => new Map(doRecorte.map((c) => [c.id, { nome: c.nome, cliente: c.cliente || null }])), [doRecorte]);

  const custos = useMemo(() => {
    if (!comCustos || !custosAno.data || !custosAnt.data) return null;
    return custosPorContratoMes([...custosAnt.data, ...custosAno.data], ligacoes) as Map<string, CustosPorRubrica>;
  }, [comCustos, custosAno.data, custosAnt.data, ligacoes]);

  const admPorMes = useMemo(() => {
    if (!comCustos || !admAno.data || !admAnt.data) return null;
    const m = new Map<string, number>();
    for (const [mes, c] of admPorMesRubrica([...admAnt.data, ...admAno.data], ligacoes, empresa)) m.set(mes, totalCustos(c));
    return m;
  }, [comCustos, admAno.data, admAnt.data, ligacoes, empresa]);

  const carregando = base.carregando || (comCustos && (!custos || !admPorMes));
  const erro = custosAno.error ?? custosAnt.error ?? admAno.error ?? admAnt.error ?? null;
  return { nfs: base.nfs as NfComDatas[], contratos, custos, admPorMes, carregando, erro, empresaFiltrada: !!empresa };
}
