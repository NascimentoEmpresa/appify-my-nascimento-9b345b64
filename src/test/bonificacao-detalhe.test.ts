import { describe, expect, it } from "vitest";
import { contextoComparativo, detalheValores, origemDoValor } from "@/lib/sistemas/bonificacaoDetalhe";
import { resumoPorDev, CONFIG_PADRAO, type EntregaBonificacao } from "@/lib/sistemas/bonificacaoColetiva";
import {
  MAX_MENSAGENS_HISTORICO, montarMensagensBonificacao, normalizarMensagens, SYSTEM_PROMPT_BONIFICACAO,
} from "../../supabase/functions/_shared/bonificacao-ia";

const base = (x: Partial<EntregaBonificacao> & { valoresAvaliados?: boolean; observacao?: string | null }) => ({
  chamadoId: "c", numero: "SIS-2026-0001", assunto: "A", devId: "d1", devNome: "Ana", concluidoDia: "2026-11-05",
  prazoLimite: null, concluidoNoPrazo: true, satisfacao: 5, qualidade: "sem_ajuste", dificuldade: "medio",
  valorMercado: null, valorFreelancer: null, valorClt: null, ...x,
}) as EntregaBonificacao & { valoresAvaliados?: boolean; observacao?: string | null };

const entregas = [
  base({ chamadoId: "a", numero: "SIS-2026-0010", assunto: "Filtro", valorMercado: 1800, valorFreelancer: 1200, valoresAvaliados: true, observacao: "P1, 4 h." }),
  base({ chamadoId: "b", numero: "SIS-2026-0011", assunto: "Módulo", valorMercado: 54000, valorFreelancer: 36000 }),
  base({ chamadoId: "c", numero: "SIS-2026-0012", assunto: "Sem parecer" }),
];

describe("Bonificação — detalhe dos valores ao passar o mouse", () => {
  it("lista cada chamado do maior para o menor e soma igual ao total da coluna", () => {
    const l = detalheValores(entregas, "valorMercado");
    expect(l.map((x) => x.numero)).toEqual(["SIS-2026-0011", "SIS-2026-0010", "SIS-2026-0012"]);
    expect(l.reduce((a, x) => a + x.valor, 0)).toBe(55800);
    expect(l[1]).toMatchObject({ chamadoId: "a", origem: "gestor", observacao: "P1, 4 h." });
  });

  it("origem do valor: gestor, parecer da I.A ou sem valor", () => {
    expect(origemDoValor(entregas[0], "valorMercado")).toBe("gestor");
    expect(origemDoValor(entregas[1], "valorMercado")).toBe("ia");
    expect(origemDoValor(entregas[2], "valorMercado")).toBe("sem valor");
    expect(detalheValores([entregas[2]], "valorFreelancer")[0].valor).toBe(0);
  });

  it("contexto da I.A traz totais, média e cada chamado do mês", () => {
    const devs = resumoPorDev(entregas, CONFIG_PADRAO);
    const ctx = JSON.parse(contextoComparativo(devs, "Novembro/2026"));
    expect(ctx.mes).toBe("Novembro/2026");
    expect(ctx.desenvolvedores[0]).toMatchObject({ nome: "Ana", entregas: 3, mercado_total: 55800, media_por_entrega: 18600, freelancer_total: 37200 });
    expect(ctx.desenvolvedores[0].chamados).toHaveLength(3);
    expect(ctx.desenvolvedores[0].chamados.find((c: { numero: string }) => c.numero === "SIS-2026-0010").observacao).toBe("P1, 4 h.");
  });
});

describe("Edge bonificacao-ia — mensagens", () => {
  it("saneia o histórico: papéis válidos, sem vazios, limitado", () => {
    const muitas = Array.from({ length: 30 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", content: `m${i}` }));
    expect(normalizarMensagens(muitas)).toHaveLength(MAX_MENSAGENS_HISTORICO);
    expect(normalizarMensagens([{ role: "system", content: "x" }, { role: "user", content: "  " }, null])).toEqual([{ role: "user", content: "x" }]);
  });

  it("o contexto vai junto da última pergunta, depois do prompt de sistema", () => {
    const m = montarMensagensBonificacao('{"a":1}', "Novembro/2026", [
      { role: "user", content: "oi" }, { role: "assistant", content: "olá" }, { role: "user", content: "e o João?" },
    ]);
    expect(m[0]).toEqual({ role: "system", content: SYSTEM_PROMPT_BONIFICACAO });
    expect(m).toHaveLength(4);
    expect(m[3].content).toContain("Novembro/2026");
    expect(m[3].content).toContain('{"a":1}');
    expect(m[3].content).toContain("PERGUNTA: e o João?");
  });
});
