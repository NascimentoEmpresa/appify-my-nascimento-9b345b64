// SIS-2026-0599 — POSTO não é PESSOA, e a Base Mestre tem que contar igual à
// tela de Licitações.
//
// A Base Mestre mostrou "Postos Confirmados: 177" para o contrato POLÍCIA CIVIL
// RS LIMPEZA - 066/2026 enquanto /app/licitacoes/planilha-custo mostrava 48
// postos para o mesmo contrato (15/10/2026). Os dois números existem:
//   • POSTO  = a LINHA vigente da planilha  → 48   ("48 postos · 177 pessoas")
//   • PESSOA = planilha_custo.qt_postos     → 177  (a coluna lá conta gente)
//
// Estes testes prendem a regra de vigência que a Licitação usa
// (resolverLinhasVigentes) com a forma real do dado do contrato-piloto: duas
// vigências (revisão de salário em 01/07) × duas versões (ORÇADO e EXECUTADO),
// ou seja QUATRO linhas por posto. Somar cru dava 708.
//
// A migration 20261015000006 traduz esta mesma regra para SQL em
// `planilha_custo_vigente(contrato, orexec)`. Se alguém mudar a regra aqui sem
// mudar lá (ou o contrário), os números das duas telas voltam a divergir.
import { describe, expect, it } from "vitest";
import { resolverLinhasVigentes, somarQuantFuncExecContrato, somarValorExecutadoMensalContrato } from "@/hooks/usePlanilhaCusto";
import type { PlanilhaCustoRow } from "@/hooks/usePlanilhaCusto";

const CONTRATO = "3918b9ef-ea35-415a-b9f1-9790c863da7f";

const linha = (o: Partial<PlanilhaCustoRow>): PlanilhaCustoRow =>
  ({
    contrato_id: CONTRATO,
    contrato: "POLÍCIA CIVIL RS LIMPEZA - 066/2026",
    encerrado: false,
    ...o,
  }) as PlanilhaCustoRow;

/** Um posto do jeito que ele existe de verdade: 4 linhas. */
const posto = (nome: string, pessoas: number, custoAntes: number, custoDepois: number) => [
  linha({ posto: nome, orexec: "ORÇADO",    data_vigencia: "2026-06-23", qt_postos: pessoas, total_por_empregado: custoAntes }),
  linha({ posto: nome, orexec: "EXECUTADO", data_vigencia: "2026-06-23", qt_postos: pessoas, total_por_empregado: custoAntes }),
  linha({ posto: nome, orexec: "ORÇADO",    data_vigencia: "2026-07-01", qt_postos: pessoas, total_por_empregado: custoDepois }),
  linha({ posto: nome, orexec: "EXECUTADO", data_vigencia: "2026-07-01", qt_postos: pessoas, total_por_empregado: custoDepois }),
];

const planilha: PlanilhaCustoRow[] = [
  ...posto("SERVENTE DE LIMPEZA", 100, 4000, 4500),
  ...posto("ENCARREGADO", 10, 6000, 6500),
  ...posto("JARDINEIRO", 5, 3000, 3200),
];

describe("Base Mestre: posto x pessoa (SIS-2026-0599)", () => {
  it("conta POSTO pela linha vigente, não pela soma de qt_postos", () => {
    const vigentes = resolverLinhasVigentes(planilha, CONTRATO);
    // 3 postos, não 12 linhas e não 115 pessoas
    expect(vigentes.length).toBe(3);
    expect(somarQuantFuncExecContrato(planilha, CONTRATO)).toBe(115);
  });

  it("fica com a vigência mais recente que já começou (a revisão de 01/07)", () => {
    const vigentes = resolverLinhasVigentes(planilha, CONTRATO);
    expect(vigentes.every((l) => l.data_vigencia === "2026-07-01")).toBe(true);
    // 100×4500 + 10×6500 + 5×3200 = 531.000
    expect(somarValorExecutadoMensalContrato(planilha, CONTRATO)).toBe(531000);
  });

  it("só olha EXECUTADO — foi o que a primeira dedup errou ao preferir ORÇADO", () => {
    const vigentes = resolverLinhasVigentes(planilha, CONTRATO);
    expect(vigentes.every((l) => l.orexec === "EXECUTADO")).toBe(true);
  });

  it("vigência com data no futuro não rouba a vigente", () => {
    const comFutura = [
      ...planilha,
      linha({ posto: "SERVENTE DE LIMPEZA", orexec: "EXECUTADO", data_vigencia: "2027-03-01", qt_postos: 999, total_por_empregado: 9999 }),
    ];
    const vigentes = resolverLinhasVigentes(comFutura, CONTRATO);
    expect(vigentes.length).toBe(3);
    expect(somarQuantFuncExecContrato(comFutura, CONTRATO)).toBe(115);
  });

  it("linha encerrada sai da conta inteira, não só do resultado", () => {
    const comEncerrado = planilha.map((l) =>
      l.posto === "JARDINEIRO" ? ({ ...l, encerrado: true } as PlanilhaCustoRow) : l,
    );
    const vigentes = resolverLinhasVigentes(comEncerrado, CONTRATO);
    expect(vigentes.map((l) => l.posto).sort()).toEqual(["ENCARREGADO", "SERVENTE DE LIMPEZA"]);
    expect(somarQuantFuncExecContrato(comEncerrado, CONTRATO)).toBe(110);
  });

  it("o custo mensal é por PESSOA vezes a quantidade de gente, não por linha", () => {
    const vigentes = resolverLinhasVigentes(planilha, CONTRATO);
    // é esta a conta que implantacao_base_financeiro passou a fazer: a versão
    // antiga multiplicava pelo número de postos (1 por linha) e o total do
    // contrato cairia para 14.200
    const porLinha = vigentes.reduce((s, l) => s + (l.total_por_empregado ?? 0) * 1, 0);
    expect(porLinha).toBe(4500 + 6500 + 3200);
    expect(somarValorExecutadoMensalContrato(planilha, CONTRATO)).toBe(531000);
  });
});
