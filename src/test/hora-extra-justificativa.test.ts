import { describe, expect, it } from "vitest";
import {
  gerarJustificativaModelo,
  LIMITE_JUSTIFICATIVA,
  limparResposta,
  montarPrompt,
  normalizarChamados,
} from "../../supabase/functions/_shared/hora-extra-justificativa";

// Os dois chamados do print do Pablo (03/11/2026).
const CHAMADOS = [
  {
    numero: "SIS-2026-0783",
    assunto: "Criar botão “Novo Decreto” com cadastro separado do Vale-Transporte",
    setor: "DIRETOR ADMINISTRATIVO",
    prioridade: "alta",
    percentual_previsto: 100,
  },
  {
    numero: "SIS-2026-0782",
    assunto: "Convenções Coletivas — Ajustes no cadastro e nas bases de cálculo dos adicionais",
    setor: "DIRETOR ADMINISTRATIVO",
    prioridade: "alta",
    percentual_previsto: 100,
  },
];

describe("hora extra › gerar mensagem da justificativa", () => {
  it("o prompt leva número, título, setor, prioridade e expectativa de cada chamado", () => {
    const prompt = montarPrompt(normalizarChamados(CHAMADOS));
    expect(prompt).toContain("SIS-2026-0783: Criar botão “Novo Decreto”");
    expect(prompt).toContain("SIS-2026-0782: Convenções Coletivas");
    expect(prompt).toContain("solicitado por DIRETOR ADMINISTRATIVO");
    expect(prompt).toContain("prioridade Alta");
    expect(prompt).toContain("expectativa de conclusão 100%");
  });

  it("normaliza o corpo do navegador: corta campos, limita a 10 e descarta lixo", () => {
    const lista = normalizarChamados([
      null,
      "texto",
      { assunto: "x".repeat(500), percentual_previsto: 150 },
      ...Array.from({ length: 12 }, (_, i) => ({ assunto: `C${i}` })),
    ]);
    expect(lista.length).toBeLessThanOrEqual(10);
    expect(lista[0].assunto).toHaveLength(200);
    expect(lista[0].percentual_previsto).toBe(100);
    expect(normalizarChamados("nada")).toEqual([]);
  });

  it("texto por modelo cita os chamados e cabe nos 500 caracteres", () => {
    const texto = gerarJustificativaModelo(CHAMADOS);
    expect(texto).toMatch(/^Antecipar as demandas/);
    expect(texto).toContain("SIS-2026-0783");
    expect(texto).toContain("SIS-2026-0782");
    expect(texto).toContain("prioridade alta");
    expect(texto.length).toBeLessThanOrEqual(LIMITE_JUSTIFICATIVA);
  });

  it("muitos chamados: modelo troca a lista pela contagem e não estoura o limite", () => {
    const muitos = Array.from({ length: 8 }, (_, i) => ({
      numero: `SIS-2026-08${i}0`,
      assunto: `Ajustar o relatório gerencial número ${i} com filtros novos por contrato e posto`,
      setor: "CONTROLADORIA",
      prioridade: "media",
    }));
    const texto = gerarJustificativaModelo(muitos);
    expect(texto).toContain("8 chamados");
    expect(texto.length).toBeLessThanOrEqual(LIMITE_JUSTIFICATIVA);
  });

  it("HE emergencial sem chamado tem texto próprio; sem chamado nenhum, vazio", () => {
    expect(gerarJustificativaModelo([{ sem_chamado: true }])).toContain("ajuste emergencial em produção");
    expect(gerarJustificativaModelo([])).toBe("");
  });

  it("limpa a resposta da I.A: cerca, markdown, aspas, rótulo e quebra de linha", () => {
    expect(limparResposta('```\n"Justificativa: **Antecipar** demandas.\nE seguir."\n```')).toBe(
      "Antecipar demandas. E seguir.",
    );
    expect(limparResposta("<think>pensando</think>Texto final.")).toBe("Texto final.");
  });

  it("resposta longa da I.A é cortada sem palavra pela metade", () => {
    const longo = Array.from({ length: 40 }, (_, i) => `Frase número ${i} do texto.`).join(" ");
    const texto = limparResposta(longo);
    expect(texto.length).toBeLessThanOrEqual(LIMITE_JUSTIFICATIVA);
    expect(texto.endsWith(".")).toBe(true);
  });
});
