import { describe, expect, it } from "vitest";
import { classificacaoVisivelPorSetor } from "@/pages/malote/orcamentoUtils";

// SIS-2026-0265 (Iury): "as classificações administrativas do financeiro só
// podem ser vistas por eles" — fallback INVERTIDO em relação a
// Aprovações/Meus Itens (lá, sem recorte configurado = vê tudo).
//
// Escopo restrito a "Financeiro" por decisão explícita (achado real, 31/08):
// setor_responsavel é um campo de categorização preenchido em praticamente
// TODA Classificação Malote (Suprimentos, RH, Jurídico, Operacional,
// Sistemas...), não um marcador de exclusividade — tratar "tem setor" como
// "é restrito" escondia o orçamento inteiro pra quem não tinha nenhum
// recorte configurado. Só Financeiro é tratado como exclusivo; os demais
// setores continuam visíveis a todos, independente do que for marcado em
// Gerenciamento de Acesso.
describe("classificacaoVisivelPorSetor", () => {
  it("classificação com setor Financeiro só é visível pra quem tem Financeiro liberado", () => {
    const financeiro = { setor_responsavel: "FINANCEIRO" };
    expect(classificacaoVisivelPorSetor(financeiro, ["FINANCEIRO"])).toBe(true);
    expect(classificacaoVisivelPorSetor(financeiro, ["RH"])).toBe(false);
  });

  it("sem NENHUM recorte configurado, classificação do Financeiro fica escondida (fallback invertido)", () => {
    const financeiro = { setor_responsavel: "FINANCEIRO" };
    expect(classificacaoVisivelPorSetor(financeiro, [])).toBe(false);
  });

  it("comparação de setor é case/espaço insensível", () => {
    const financeiro = { setor_responsavel: "  Financeiro  " };
    expect(classificacaoVisivelPorSetor(financeiro, ["financeiro"])).toBe(true);
  });

  it("classificação SEM setor_responsavel continua visível a todos", () => {
    const semSetor = { setor_responsavel: null };
    expect(classificacaoVisivelPorSetor(semSetor, [])).toBe(true);
    expect(classificacaoVisivelPorSetor({ setor_responsavel: "" }, [])).toBe(true);
  });

  it("qualquer setor que NÃO seja Financeiro nunca restringe — mesmo sem nenhum recorte configurado (achado real: Suprimentos/RH/Jurídico/etc. são só categorização)", () => {
    const suprimentos = { setor_responsavel: "SUPRIMENTOS" };
    expect(classificacaoVisivelPorSetor(suprimentos, [])).toBe(true);
    expect(classificacaoVisivelPorSetor(suprimentos, ["FINANCEIRO"])).toBe(true);
    const rh = { setor_responsavel: "RH" };
    expect(classificacaoVisivelPorSetor(rh, [])).toBe(true);
  });

  it("tipo não entra na conta — a restrição depende só do setor_responsavel ser Financeiro", () => {
    const financeiroContrato = { setor_responsavel: "Financeiro" };
    expect(classificacaoVisivelPorSetor(financeiroContrato, [])).toBe(false);
    expect(classificacaoVisivelPorSetor(financeiroContrato, ["FINANCEIRO"])).toBe(true);
  });

  it("classificação nula/indefinida é tratada como visível (sem dado suficiente pra restringir)", () => {
    expect(classificacaoVisivelPorSetor(null, [])).toBe(true);
    expect(classificacaoVisivelPorSetor(undefined, [])).toBe(true);
  });
});
