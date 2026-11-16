import { describe, expect, it } from "vitest";
import { herancaDaConvencao, montarQuadro, urlEditarConvencao, type RespostaReferencia } from "@/lib/licitacoes/convencoes";
import { aplicarHerancaNoQuadro, LINHA_VAZIA } from "@/lib/licitacoes/quadroPostos";

// Convenção Coletiva do CONTRATO (13/11/2026, mig 20261113100500): vinculada
// no contrato, todos os postos herdam os benefícios dela.

const cct = {
  id: "cct-1", versao: 3, identificacao: "CCT 2026/2027",
  beneficios: {
    va: { valor: 30, periodo: "dia" as const, desconto: { nao_contem: true } },
    vl: { nao_contem: true },
    insalubridade: { percentual: 20, base: "minimo_regional" as const },
    periculosidade: { nao_contem: true },
    assiduidade: { valor: 120, periodo: "mes" as const },
    cesta_basica: { nao_contem: true },
    plano_saude: { nao_contem: true },
    auxilio_creche: { nao_contem: true },
    adicional_lider: { nao_contem: true },
  },
};
const decreto = { id: "dec-1", versao: 1, decreto_numero: "123/2026", beneficios: { vt: { valor: 5.5, periodo: "dia" as const } } };

const doContrato = (comDecreto = true): RespostaReferencia => ({
  status: "vinculado", origem: "contrato", principal_id: "cct-1",
  regras: comDecreto ? { vt: "dec-1" } : {},
  referencias: comDecreto ? [cct, decreto] : [cct],
});

describe("herancaDaConvencao", () => {
  it("sem vínculo não herda nada", () => {
    expect(herancaDaConvencao(null)).toBeNull();
    expect(herancaDaConvencao({ status: "sem_vinculo", posto: "UPA" })).toBeNull();
  });

  it("monta o texto dos benefícios, com o VT do decreto, sem os 'Não contém'", () => {
    const h = herancaDaConvencao(doContrato())!;
    expect(h.beneficios).toContain("Vale-Alimentação (VA): R$ 30,00 / dia");
    expect(h.beneficios).toContain("Vale-Transporte (VT): R$ 5,50 / dia");
    expect(h.beneficios).toContain("Prêmio Assiduidade: R$ 120,00 / mês");
    expect(h.beneficios).not.toContain("Não contém");
    expect(h.beneficios).not.toContain("Vale Lanche");
  });

  it("insalubridade e periculosidade vão para os campos do posto", () => {
    const h = herancaDaConvencao(doContrato())!;
    expect(h.insalubridade_pct).toBe("20");
    expect(h.periculosidade_pct).toBe("");
  });

  it("sem decreto o VT fica fora do texto e a pendência manda ao cadastro do contrato", () => {
    const h = herancaDaConvencao(doContrato(false))!;
    expect(h.beneficios).not.toContain("Vale-Transporte");
    const q = montarQuadro(doContrato(false));
    expect(q.pendencias.some((p) => p.includes("cadastro do contrato"))).toBe(true);
    expect(q.pendencias.some((p) => p.includes("Planilha de Custo"))).toBe(false);
  });

  it("vínculo de posto segue mandando à Planilha de Custo", () => {
    const q = montarQuadro({ ...doContrato(false), origem: "posto" });
    expect(q.pendencias.some((p) => p.includes("Planilha de Custo"))).toBe(true);
  });
});

describe("aplicarHerancaNoQuadro", () => {
  const linhas = [
    { ...LINHA_VAZIA, posto_nome: "UPA", beneficios: "VT R$ 1,00/mês", insalubridade_pct: "40", periculosidade_pct: "30" },
    { ...LINHA_VAZIA, posto_nome: "LAVANDERIA" },
  ];

  it("sem convenção não mexe em nada", () => {
    expect(aplicarHerancaNoQuadro(linhas, null)).toBe(linhas);
  });

  it("com convenção, todos os postos recebem os mesmos benefícios (por cima do digitado)", () => {
    const h = herancaDaConvencao(doContrato())!;
    const r = aplicarHerancaNoQuadro(linhas, h);
    for (const l of r) {
      expect(l.beneficios).toBe(h.beneficios);
      expect(l.insalubridade_pct).toBe("20");
      expect(l.periculosidade_pct).toBe("");
    }
    expect(r[0].posto_nome).toBe("UPA");
  });
});

it("link do cadastro abre a convenção em edição", () => {
  expect(urlEditarConvencao("abc")).toBe("/app/licitacoes/convencoes?editar=abc");
});
