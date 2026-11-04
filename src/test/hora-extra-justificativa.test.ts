import { describe, expect, it } from "vitest";
import {
  gerarJustificativaModelo,
  gerarResumoConclusaoModelo,
  LIMITE_RESUMO_CONCLUSAO,
  LIMITE_JUSTIFICATIVA,
  limparResposta,
  montarPrompt,
  montarPromptConclusao,
  normalizarConclusao,
  normalizarChamados,
} from "../../supabase/functions/_shared/hora-extra-justificativa";
import { motivoErroFuncao } from "@/pages/sistemas/hora-extra/horaExtraUtils";

describe("hora extra › motivo do erro da Edge no toast", () => {
  it("lê `error` da nossa função e `erro` do roteador do cluster, com o status", () => {
    expect(motivoErroFuncao(403, '{"error":"Você não tem acesso para solicitar hora extra."}')).toBe(
      "Você não tem acesso para solicitar hora extra. (HTTP 403)",
    );
    expect(motivoErroFuncao(404, `{"erro":"funcao 'x' nao existe nesta replica"}`)).toBe(
      "funcao 'x' nao existe nesta replica (HTTP 404)",
    );
  });

  it("página do proxy (não JSON) vira texto curto; 504 vazio diz que demorou", () => {
    expect(motivoErroFuncao(502, "<html><h1>502 Bad Gateway</h1></html>")).toBe("502 Bad Gateway (HTTP 502)");
    expect(motivoErroFuncao(504, "")).toBe("o servidor demorou demais para responder (HTTP 504)");
    expect(motivoErroFuncao(500, "{}")).toBe("Falha na função (HTTP 500).");
  });
});

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

describe("hora extra › gerar mensagem do resumo da conclusão", () => {
  const CONCLUSAO = {
    tipo: "normal",
    total_he: "2h 30min",
    horario: "17:18 - 19:48",
    chamados: [
      {
        ...CHAMADOS[0],
        percentual_concluido: 100,
        pr_numero: 1101,
        pr_titulo: "SIS-2026-0783: botão Novo Decreto",
        pr_linhas_adicionadas: 420,
        pr_commits: 6,
      },
      { ...CHAMADOS[1], percentual_concluido: 60, pr_numero: 1102, pr_titulo: "SIS-2026-0782: convenções" },
    ],
  };

  it("o prompt leva horas, faixa, PR, commits, linhas e % concluído de cada linha", () => {
    const prompt = montarPromptConclusao(normalizarConclusao(CONCLUSAO));
    expect(prompt).toContain("total de 2h 30min (das 17:18 às 19:48)");
    expect(prompt).toContain("SIS-2026-0783: Criar botão “Novo Decreto”");
    expect(prompt).toContain("PR #1101");
    expect(prompt).toContain("6 commits");
    expect(prompt).toContain("420 linhas adicionadas");
    expect(prompt).toContain("60% concluído");
  });

  it("normaliza o corpo: descarta lixo, limita a 15 linhas e prende o percentual em 0..100", () => {
    const dados = normalizarConclusao({
      chamados: [null, "x", { assunto: "A", percentual_concluido: 180 }, ...Array.from({ length: 20 }, () => ({ assunto: "B" }))],
    });
    expect(dados.chamados.length).toBeLessThanOrEqual(15);
    expect(dados.chamados[0].percentual_concluido).toBe(100);
    expect(normalizarConclusao(undefined).chamados).toEqual([]);
  });

  it("modelo cita chamados e PRs, aponta o parcial e cabe nos 1000 caracteres", () => {
    const texto = gerarResumoConclusaoModelo(normalizarConclusao(CONCLUSAO));
    expect(texto).toMatch(/^Durante a hora extra \(2h 30min, das 17:18 às 19:48\)/);
    expect(texto).toContain("PR #1101");
    expect(texto).toContain("SIS-2026-0782 ficou parcial");
    expect(texto.length).toBeLessThanOrEqual(LIMITE_RESUMO_CONCLUSAO);
  });

  it("tudo a 100%: sem impedimentos; PR sem chamado usa o título da PR", () => {
    const texto = gerarResumoConclusaoModelo(
      normalizarConclusao({
        chamados: [{ sem_chamado: true, pr_numero: 1200, pr_titulo: "Corrige login", percentual_concluido: 100 }],
      }),
    );
    expect(texto).toContain("Corrige login (PR #1200)");
    expect(texto).toContain("não houve impedimentos");
    expect(gerarResumoConclusaoModelo({ chamados: [] })).toBe("");
  });

  it("muitas linhas longas: troca a lista pela contagem sem estourar o limite", () => {
    const chamados = Array.from({ length: 15 }, (_, i) => ({
      numero: `SIS-2026-09${String(i).padStart(2, "0")}`,
      assunto: "Ajustar o relatório gerencial com filtros novos por contrato, posto e período de apuração".repeat(2),
      pr_numero: 1300 + i,
      percentual_concluido: 100,
    }));
    const texto = gerarResumoConclusaoModelo(normalizarConclusao({ chamados }));
    expect(texto).toContain("15 chamados");
    expect(texto.length).toBeLessThanOrEqual(LIMITE_RESUMO_CONCLUSAO);
  });

  it("limparResposta aceita o limite da conclusão (1000) e mantém 500 por padrão", () => {
    const longo = Array.from({ length: 80 }, (_, i) => `Frase número ${i} do texto.`).join(" ");
    expect(limparResposta(longo).length).toBeLessThanOrEqual(500);
    const conclusao = limparResposta(longo, LIMITE_RESUMO_CONCLUSAO);
    expect(conclusao.length).toBeGreaterThan(500);
    expect(conclusao.length).toBeLessThanOrEqual(LIMITE_RESUMO_CONCLUSAO);
  });
});
