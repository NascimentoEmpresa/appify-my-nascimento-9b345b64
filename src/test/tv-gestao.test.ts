import { describe, expect, it } from "vitest";
import { brlCurto, ehContratoVermelho, pctRecebido, resumoPresidencia, tomMargem, tomNaoEmitido, type DadosPrePainelTv } from "@/lib/tv/gestaoTv";
import { paginasDoRelatorio } from "@/lib/tv/relatorioTv";
import type { ContratoRpc } from "@/lib/operacional/indicadoresContratos";

// TVs de gestão — Financeiro, Controladoria e Presidência (11/11/2026). Dados fictícios.

const kpisFin = { vigentes: 2, executavel: 100_000, executado: 100_000, faturado: 80_000, liquido: 70_000, recebido: 40_000, conta_vinculada: 3_000,
  nao_emitido: 20_000, excesso: 0, lancadas: 1, parciais: 0, pendentes: 1, sem_dados: 0 };

const contrato = (id: string, extra: Partial<ContratoRpc> = {}): ContratoRpc => ({
  id, nome: `CONTRATO ${id}`, cliente: null, encerrado: false,
  postos: { contratados: 10, previsto: 10, implantado_registrado: true, cobertos: 10, afastados: 0 },
  efetivo: 20, demissoes: 0, atestados: { dias_pessoa: 0, pessoas: 0 },
  glosas: { valor: 0, qtd: 0, causa: null }, reclamacoes: { qtd: 0, causa: null }, orcado: null, ...extra,
});

const pre: DadosPrePainelTv = {
  operacional: {
    competencia: "2026-09", de: "", ate: "", dias: 30, janela_notificacoes: { de: "", ate: "" }, gerado_em: "",
    sem_contrato: { glosas_valor: 0, glosas_qtd: 0, reclamacoes_qtd: 0 },
    contratos: [
      contrato("A", { glosas: { valor: 1_500, qtd: 1, causa: null }, reclamacoes: { qtd: 2, causa: null } }),
      contrato("B", { postos: { contratados: 10, previsto: 10, implantado_registrado: true, cobertos: 7, afastados: 0 }, efetivo: 20, demissoes: 8 }),
      contrato("C", { encerrado: true, glosas: { valor: 99_999, qtd: 9, causa: null } }),
    ],
    financeiro: { competencia: "2026-09", receita: { A: 100_000, B: 100_000 }, custo_por_mes: { "A|2026-09": 80_000, "B|2026-09": 130_000 } },
  },
  controladoria: { competencia: "2026-09", kpis: { bruto: 1, liquido: 200_000, recebido: 1, a_receber: 1, conta_vinculada: 1, despesas: 1, lucro: 20_000, margem: 10, notas: 2, contratos: 2 },
    evolucao: [], melhores: [], piores: [{ contrato: "CONTRATO B", liquido: 100_000, lucro: -30_000, margem: -30 }, { contrato: "CONTRATO A", liquido: 100_000, lucro: 20_000, margem: 20 }] },
  financeiro: { competencia: "2026-10", kpis: kpisFin, evolucao: [], pendentes: [], inadimplencia: { valor: 5_000, notas: 1, mais_de_90: 0 } },
  rh: { competencias: {}, orcado: 1_000, realizado: 1_100, contratos: [{ contrato: "A", pessoas: 1, orc_sal: 1_000, real_sal: 1_100, orc_ben: 0, real_ben: 0, desvio: 10 }] },
};

describe("TVs de gestão", () => {
  it("Financeiro: % recebido e não emitido com folga de 2%", () => {
    expect(pctRecebido(kpisFin)).toBe(50);
    expect(tomNaoEmitido(kpisFin)).toBe("critico");
    expect(tomNaoEmitido({ ...kpisFin, nao_emitido: 1_000 })).toBe("bom");
    expect(tomNaoEmitido(null)).toBe("neutro");
  });

  it("Controladoria: margem negativa é crítica, abaixo de 10% atenção", () => {
    expect(tomMargem(-1)).toBe("critico");
    expect(tomMargem(5)).toBe("atencao");
    expect(tomMargem(12)).toBe("bom");
    expect(tomMargem(null)).toBe("neutro");
    expect(brlCurto(1_250_000)).toBe("R$ 1,3 mi");
  });

  it("Presidência: tudo vem das outras TVs; contrato encerrado não conta", () => {
    const r = resumoPresidencia(pre);
    expect(r.margem).toBe(10);
    expect(r.postos).toEqual({ contratados: 20, cobertos: 17, contratos: 1 });
    expect(r.glosas).toEqual({ valor: 1_500, qtd: 1 });
    expect(r.retencoes).toBe(3_000);
    expect(r.notasPendentes).toEqual({ contratos: 1, valor: 20_000 });
    expect(r.salarios).toEqual({ desvio: 10, acima: 1, total: 1 });
    expect(r.insatisfeitos).toEqual([{ contrato: "CONTRATO A", qtd: 2 }]);
    expect(r.piores.map((c) => c.contrato)).toEqual(["CONTRATO B"]);
    // B: postos abaixo de 95%, prejuízo e turnover alto → vermelho.
    expect(r.vermelhos.map((l) => l.id)).toEqual(["B"]);
    expect(r.vermelhos.every(ehContratoVermelho)).toBe(true);
  });

  it("cada item da playlist é uma página só", () => {
    expect(paginasDoRelatorio({ ...pre, tipo: "pre-painel", contrato: null })).toHaveLength(1);
  });
});
