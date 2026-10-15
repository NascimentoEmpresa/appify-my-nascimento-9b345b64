import { useMemo } from "react";
import { useItensNfEmissaoEmLote } from "@/hooks/useNfEmissao";
import { ignoraNaConciliacao } from "@/hooks/useConciliacaoFluxoCaixa";
import { faltaDeFaturamento } from "../faturamentoStatus";
import { agruparFaturamento, totaisVazios } from "../faturamento/regras";
import { useBaseFaturamento } from "../faturamento/useBaseFaturamento";
import {
  centrosAcimaDoOrcado, conciliacaoDaEmpresa, descontosPorCategoria, divergenciasMaloteFluxo, maloteDiretoPorDespesa, FiltroAuditoria, ItemDesconto, LinhaCentroMalote, saidasFinanceiro, semCentroDetalhe, TipoValidacao, TotaisCard,
  totaisCentrosMalote, totaisFluxoExtrato, totaisMaloteFinanceiro, totalMaloteDireto,
} from "./regras";
import { linhasMalote, useConciliadoMes, useMaloteCentrosMes, useFluxoMes, useMaloteDiretoMes, useOrcadoRealizado } from "./useAuditoriaDados";

const r2 = (n: number) => Math.round(n * 100) / 100;

export interface EstadoCard {
  carregando: boolean;
  erro: string | null;
  totais: TotaisCard | null;
}

export interface FiltrosPainel extends FiltroAuditoria {
  mes: string; // "YYYY-MM"
}

const msg = (e: unknown): string | null => (e ? ((e as { message?: string }).message ?? "erro desconhecido") : null);

// SIS-2026-0553: totais dos 7 cards para o período e filtros da tela.
// Empresa filtra todos; contrato refina onde o dado tem contrato (cards 1, 3,
// 4, 5, 6 e 7).
export function useTotaisAuditoria(f: FiltrosPainel): Record<TipoValidacao, EstadoCard> {
  const fluxoQ = useFluxoMes(f.mes);
  const maloteQ = useMaloteDiretoMes(f.mes);
  const conciliadoQ = useConciliadoMes(f.mes);
  const centrosQ = useMaloteCentrosMes(f.mes);
  const orcado = useOrcadoRealizado(f.mes, f);
  const base = useBaseFaturamento();


  // Contrato passa nos filtros (empresa, contrato, centro de custo).
  const contratoPassa = useMemo(() => {
    return (contratoId: string): boolean => {
      const c = base.contratoPorId.get(contratoId);
      if (!c) return false;
      if (f.empresaId && c.empresa_id !== f.empresaId) return false;
      if (f.contratoId && c.id !== f.contratoId) return false;
      return true;
    };
  }, [base.contratoPorId, f.empresaId, f.contratoId]);

  const nfsDoMes = useMemo(() => base.nfs.filter((n) => n.competencia.startsWith(f.mes) && contratoPassa(n.contrato_id)), [base.nfs, f.mes, contratoPassa]);
  const porContrato = useMemo(() => agruparFaturamento(nfsDoMes, (n) => n.contrato_id), [nfsDoMes]);
  const idsNfs = useMemo(() => nfsDoMes.map((n) => n.id), [nfsDoMes]);
  const itensQ = useItensNfEmissaoEmLote(idsNfs);

  const avisoFiltro = (usaContrato: boolean) => (!usaContrato && f.contratoId ? "Este total não tem contrato: o filtro de contrato não se aplica." : undefined);

  return useMemo(() => {
    // 1. Malote × Fluxo
    let t1: TotaisCard | null = null;
    if (maloteQ.data && fluxoQ.data) {
      const a = totalMaloteDireto(maloteQ.data.naoParceladas, maloteQ.data.parcelas, maloteQ.data.despesasDasParcelas, maloteQ.data.rateios, f);
      // SIS-2026-0657: Malote + lançamentos do Financeiro (o que está no Fluxo e não veio do Malote) × saídas
      // do Fluxo. Aplicação financeira é giro de caixa: fica fora e aparece só como informação.
      const r = totaisMaloteFinanceiro(a, fluxoQ.data, f);
      const direto = maloteDiretoPorDespesa(maloteQ.data.naoParceladas, maloteQ.data.parcelas, maloteQ.data.despesasDasParcelas, maloteQ.data.rateios, f);
      r.painel.divergencias = divergenciasMaloteFluxo(direto, fluxoQ.data, f);
      t1 = { a: r.a, b: r.b, painel: r.painel, aviso: "Diferença costuma ser ajuste de valor feito só no Fluxo de Caixa." };
    }

    // 2. Fluxo × Extrato
    let t2: TotaisCard | null = null;
    if (fluxoQ.data && conciliadoQ.data) {
      // SIS-2026-0657: entradas e saídas separadas; o Fluxo é recortado igual à conciliação (banco + empresas, sem o que
      // ela ignora) e o total do extrato vem do cabeçalho de cada conciliação salva (a mais recente de cada conta/período).
      const r = totaisFluxoExtrato(fluxoQ.data, conciliadoQ.data.cabecalhos, f.empresaId, (l) =>
        ignoraNaConciliacao({ tipo: l.tipo, descricao: l.descricao ?? "", classificacao_nome: l.classificacao_nome, banco_nome: l.banco_nome }));
      t2 = {
        a: r.a, b: r.b, painel: r.painel,
        // Sem nenhuma conciliação salva não há o que validar: o card espera dados.
        indisponivel: r.painel.conciliado ? undefined : "Aguardando dados: nenhuma conciliação bancária foi salva para este mês. A validação é habilitada quando houver conciliação salva.",
      };
    }

    // 3. Centros de Custo × Malote — o centro de custo operacional é o contrato
    // (já presente no rateio); classificações administrativas vão para os centros
    // administrativos. A diferença é gasto de contrato lançado sem contrato.
    let t3: TotaisCard | null = null;
    if (centrosQ.data && fluxoQ.data) {
      // SIS-2026-0657: Malote + lançamentos do Financeiro (mesma definição do card 1, sem aplicação).
      const financeiro: LinhaCentroMalote[] = saidasFinanceiro(fluxoQ.data, f).map((l) => ({
        valor: Number(l.valor) || 0, empresa_id: l.empresa_id, contrato_id: l.contrato_id, classificacao_id: l.classificacao_id ?? null,
        origem: l.origem, despesa_id: l.despesa_id ?? null, id_malote: l.id_malote ?? null, descricao: l.descricao ?? null,
        classificacao_nome: l.classificacao_nome, data_pagamento: l.data_pagamento ?? null,
      }));
      const todasAsLinhas = [...centrosQ.data.linhas, ...financeiro];
      const r = totaisCentrosMalote(todasAsLinhas, centrosQ.data.tipoPorClassificacao, f);
      t3 = {
        painel: { kind: "centros", pendentes: semCentroDetalhe(todasAsLinhas, centrosQ.data.tipoPorClassificacao, f) },
        a: r.total,
        b: r2(r.comContrato + r.administrativo),
        aviso: "Centro de custo = contrato do rateio. A diferença é gasto de contrato ou lançamento financeiro sem centro (ou sem classificação).",
        detalhes: [
          { rotulo: "Em centros de contrato", valor: r.comContrato, somaNoTotal: true },
          { rotulo: "Em centros administrativos", valor: r.administrativo, somaNoTotal: true },
          { rotulo: "Sem centro (pendente de classificar)", valor: r.pendente, somaNoTotal: false },
        ],
      };
    }

    // 4. Orçado × Realizado
    const t4: TotaisCard | null = orcado.isLoading ? null : { a: orcado.data.orcado, b: orcado.data.realizado, painel: centrosAcimaDoOrcado(orcado.data.centros) };

    // 5 e 6. Faturamento / Recebimento (NFs Código N validadas, por competência)
    let t5: TotaisCard | null = null, t6: TotaisCard | null = null;
    if (!base.carregando) {
      let faturado = 0, falta = 0, recebido = 0, aReceber = 0;
      const contratosDoRecorte = base.contratos.filter((c) => contratoPassa(c.id));
      for (const c of contratosDoRecorte) {
        const t = porContrato.get(c.id) ?? totaisVazios();
        faturado += t.bruto; recebido += t.recebido; aReceber += t.aReceber;
        falta += faltaDeFaturamento(base.executavelDoContrato(c, f.mes), t.bruto);
      }
      t5 = { a: r2(faturado), b: r2(falta), aviso: "Falta faturar = valor executável da planilha de custo − NF lançada, por contrato." };
      t6 = { a: r2(recebido), b: r2(aReceber) };
    }

    // 7. Descontos
    let t7: TotaisCard | null = null;
    if (!base.carregando && (idsNfs.length === 0 || itensQ.data)) {
      const itens = [...(itensQ.data?.values() ?? [])].flat() as unknown as ItemDesconto[];
      const d = descontosPorCategoria(itens);
      t7 = { a: d.totalCategorias, b: d.totalDescontado, detalhes: d.categorias };
    }

    const estado = (totais: TotaisCard | null, ...fontes: { isLoading?: boolean; error?: unknown }[]): EstadoCard => ({
      totais,
      carregando: !totais && fontes.some((x) => x.isLoading),
      erro: msg(fontes.find((x) => x.error)?.error),
    });
    const faturamentoFonte = { isLoading: base.carregando };
    return {
      malote_fluxo: estado(t1, maloteQ, fluxoQ),
      fluxo_extrato: estado(t2, fluxoQ, conciliadoQ),
      centros_malote: estado(t3, centrosQ, fluxoQ),
      orcado_realizado: estado(t4, { isLoading: orcado.isLoading }),
      faturado: estado(t5, faturamentoFonte),
      recebido: estado(t6, faturamentoFonte),
      descontos: estado(t7, faturamentoFonte, itensQ),
    };
  }, [maloteQ.data, maloteQ.error, centrosQ.data, centrosQ.error, fluxoQ.data, fluxoQ.error, conciliadoQ.data, conciliadoQ.error, orcado.data, orcado.isLoading, base.carregando, base.contratos, base.executavelDoContrato, porContrato, itensQ.data, itensQ.error, idsNfs.length, f.mes, f.empresaId, f.contratoId, contratoPassa]);
}
