import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import {
  contarObrigatorios, empresaDaAba, lerPlanilhaCronograma, lerPlanilhaPlano, nrsDoTexto, situacaoTurma, somarMesesIso, statusObrigatorio,
  validadeObrigatorio,
} from "@/lib/sst/treinamentosNr";

// SIS-2026-0816 — SST › Treinamentos Obrigatórios (NR): a régua do status
// (espelho de sst_trn_status) e a leitura das duas planilhas.

const serial = (iso: string) => Math.round((Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) - Date.UTC(1899, 11, 30)) / 86400000);
function planilha(abas: Record<string, unknown[][]>): Uint8Array {
  const wb = XLSX.utils.book_new();
  for (const [nome, rows] of Object.entries(abas)) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), nome);
  return new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx" }));
}
const HOJE = "2026-11-19";

describe("status do treinamento obrigatório", () => {
  it("as mesmas faixas do banco (30 dias de aviso)", () => {
    expect(statusObrigatorio(null, 12, HOJE)).toBe("pendente");
    expect(statusObrigatorio("2025-03-29", 12, HOJE)).toBe("vencido");
    expect(statusObrigatorio("2025-12-04", 12, HOJE)).toBe("proximo");
    expect(statusObrigatorio("2025-12-19", 12, HOJE)).toBe("proximo"); // vence exatamente em 30 dias
    expect(statusObrigatorio("2025-12-20", 12, HOJE)).toBe("em_dia");
    expect(statusObrigatorio("2025-11-19", 12, HOJE)).toBe("proximo"); // vence hoje: ainda não venceu
    expect(statusObrigatorio("2026-04-22", null, HOJE)).toBe("em_dia");
  });

  it("validade soma meses como o Postgres (fim de mês)", () => {
    expect(somarMesesIso("2025-01-31", 1)).toBe("2025-02-28");
    expect(somarMesesIso("2024-02-29", 12)).toBe("2025-02-28");
    expect(validadeObrigatorio("2025-03-29", 24)).toBe("2027-03-29");
    expect(validadeObrigatorio("2025-03-29", null)).toBeNull();
  });

  it("conta só os ativos", () => {
    expect(contarObrigatorios([
      { status: "vencido", ativo: true }, { status: "pendente", ativo: true }, { status: "em_dia", ativo: false },
    ])).toEqual({ total: 2, em_dia: 0, proximo: 0, vencido: 1, pendente: 1 });
  });

  it("NRs citadas num texto", () => {
    expect(nrsDoTexto("NR-01, NR06,NR 17-NR-31, N-12")).toEqual(["NR-01", "NR-06", "NR-17", "NR-31", "NR-12"]);
    expect(nrsDoTexto("PREVENÇÃO DE COMBATE A INCENDIO")).toEqual([]);
  });

  it("turma: realizada até hoje, prevista depois", () => {
    expect(situacaoTurma({ data: "2026-11-04", cancelada: false }, HOJE)).toBe("realizada");
    expect(situacaoTurma({ data: "2026-12-16", cancelada: false }, HOJE)).toBe("prevista");
    expect(situacaoTurma({ data: null, cancelada: false }, HOJE)).toBe("sem_data");
    expect(situacaoTurma({ data: "2026-11-04", cancelada: true }, HOJE)).toBe("cancelada");
  });
});

describe("planilhas de treinamento", () => {
  const CAB_PLANO = ["Contrato", "Função", "Treinamento Obrigatório", "Base Legal/Contratual", "Periodicidade (meses)", "Data do Último Treinamento",
    "Validade até", "Dias p/ Vencer", "Status", "Alerta (30d)", "Observações"];

  it("aba → empresa", () => {
    expect(empresaDaAba("CANAA")).toBe("CANAÃ");
    expect(empresaDaAba("Resumo")).toBeNull();
    expect(empresaDaAba("Instruções")).toBeNull();
  });

  it("matriz: uma aba por empresa, sem as linhas de sobra e sem data futura", () => {
    const l = lerPlanilhaPlano(planilha({
      Resumo: [["Selecione a empresa:", "HAGG"]],
      HAGG: [CAB_PLANO,
        ["CAXIAS DO SUL-2026.95", "TELEFONISTA", "NR-01, NR-06, NR-17", "NRs", 12, serial("2025-03-29"), serial("2026-03-29"), -179, "VENCIDO", "⚠ VENCIDO", ""],
        ["CAXIAS DO SUL-2026.95", "TODAS FUNÇÕES", "NOÇÕES DE PRIMEIROS SOCORROS", "NR-07, RESOLUÇÃO COFEN", 24, "", "", "", "", "", ""],
        ["UFFS REALEZA", "RECEPCIONISTA", "NR-01", "NRs", 12, serial("2026-12-09"), "", "", "ok", "", ""],
        ["", "", "", "", "", "", 0, -46289, "VENCIDO", "⚠ VENCIDO", ""],
      ],
      CANAA: [CAB_PLANO, ["CANAÃ-ESCOLA INFANTIL-173.2019", "PROFESSOR", "NR-01, NR-17", "NRs", "", "", "", "", "", "", ""]],
    }), HOJE);
    expect(l.abas).toEqual([{ aba: "HAGG", empresa: "HAGG", linhas: 3 }, { aba: "CANAA", empresa: "CANAÃ", linhas: 1 }]);
    expect(l.linhas[0]).toMatchObject({ contrato: "CAXIAS DO SUL-2026.95", periodicidade_meses: 12, ultimo_treinamento: "2025-03-29" });
    expect(l.linhas[2].ultimo_treinamento).toBeNull();
    expect(l.avisos[0]).toMatch(/no futuro/);
    expect(l.linhas[3]).toMatchObject({ empresa: "CANAÃ", periodicidade_meses: null });
    expect(new Set(l.linhas.map((x) => x.chave)).size).toBe(4);
  });

  it("cronograma: linha sem nº é a mesma turma em outro contrato; custo soma os itens; totais fora", () => {
    const CAB = ["", "", "Data da Realização", "Contrato", "Função", "NR", "Quantidade de Participantes ", "Comida", "Bolacha", "Bombons",
      "material impresso (certificado+boas vindas)", "Água", "Pó de café", "Material para Dinâmica"];
    const l = lerPlanilhaCronograma(planilha({
      Planilha1: [CAB, [],
        [1, "HAGG", serial("2026-02-10"), "PENHA", "HIGIENIZAÇÃO", "NR 32", 14, 250, 85.45, 79, 8.9, 80, 15, 50],
        [2, "HAGG", serial("2026-02-25"), "UFRGS AUX. DE SAUDE BUCAL-033.2021", "AUX.", "NR 32", 48, 85.5, "", "", "", "", "", ""],
        ["", "HAGG", serial("2026-02-25"), "UFRGS COPA E COZINHA-025.2025", "COPEIRO", "NR 32", "", "", "", "", "", "", "", ""],
        ["", "HAGG", "", "UFRGS MOTORISTAS-034.2022", "TRATORISTA", "NR 31", "", "", "", "", "", "", "", ""],
        ["", "", "", "", "", "", "", 18535.5, "", 2212, 249.2, 2240, 420, 1400],
      ],
    }));
    expect(l.linhas).toHaveLength(4);
    expect(l.linhas[0]).toMatchObject({ numero: 1, data: "2026-02-10", participantes: 14, custo: 568.35 });
    expect(l.linhas[2]).toMatchObject({ numero: 2, data: "2026-02-25", participantes: null, custo: null });
    expect(l.linhas[3]).toMatchObject({ numero: 2, data: "2026-02-25", contrato: "UFRGS MOTORISTAS-034.2022" });
    expect(l.linhas[0].chave).toBe("crono:1:PENHA:NR32:1");
  });
});
