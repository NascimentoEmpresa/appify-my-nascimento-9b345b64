import { describe, expect, it } from "vitest";
import { contextoComparativo, detalheValores, mediaComValor, origemDoValor } from "@/lib/sistemas/bonificacaoDetalhe";
import { resumoPorDev, CONFIG_PADRAO, entregaDaLinha, lucroDaEntrega, type EntregaBonificacao, type LinhaEntregaRpc } from "@/lib/sistemas/bonificacaoColetiva";
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
    expect(ctx.desenvolvedores[0]).toMatchObject({ nome: "Ana", entregas: 3, mercado_total: 55800, media_por_entrega: 27900, aguardando_ia: 1, freelancer_total: 37200 });
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

describe("Lucro da entrega — valor de mercado − custo real conosco", () => {
  const hora = 3138.65 / 220; // R$ 14,27

  it("usa as horas informadas de verdade; sem elas, as horas internas da I.A", () => {
    expect(lucroDaEntrega(7200, 8, 3)).toEqual({ horasInternas: 8, custoInterno: Math.round(hora * 8 * 100) / 100, lucro: Math.round((7200 - Math.round(hora * 8 * 100) / 100) * 100) / 100 });
    expect(lucroDaEntrega(7200, null, 3).horasInternas).toBe(3);
    expect(lucroDaEntrega(null, 8, 3).lucro).toBeNull();
    expect(lucroDaEntrega(7200, null, null)).toEqual({ horasInternas: null, custoInterno: null, lucro: null });
  });

  it("entregaDaLinha ignora horas SUPOSTAS e usa o valor do gestor quando há", () => {
    const l = { chamado_id: "x", numero: "SIS-2026-0001", assunto: "A", tipo_solicitacao: null, responsavel_id: "d", responsavel_nome: "Ana",
      concluido_em: "2026-11-05T15:00:00Z", prazo_limite: null, concluido_no_prazo: true, horas_gastas: 24, satisfacao: 5, reaberturas: 0,
      ia_status: "pronto", ia_complexidade: 3, ia_valor_mercado: 9000, ia_valor_freelancer: 6000, ia_valor_clt: 1000,
      qualidade: null, dificuldade: null, valor_mercado: null, valor_freelancer: null, valor_clt: null, fora_da_bonificacao: false,
      motivo_exclusao: null, observacao: null, avaliado_em: null, horas_gastas_estimadas: true, ia_horas_interno: 4 } as LinhaEntregaRpc;
    const e = entregaDaLinha(l);
    expect(e.horasInternas).toBe(4);
    expect(e.lucro).toBe(Math.round((9000 - Math.round(hora * 4 * 100) / 100) * 100) / 100);
    const g = entregaDaLinha({ ...l, horas_gastas_estimadas: false, valor_mercado: 5000 });
    expect(g.horasInternas).toBe(24);
    expect(g.lucro).toBe(Math.round((5000 - Math.round(hora * 24 * 100) / 100) * 100) / 100);
  });

  it("detalhe do lucro traz a conta de cada chamado", () => {
    const e = { ...base({ chamadoId: "z", valorMercado: 7200 }), ...lucroDaEntrega(7200, 8, null) };
    const [linha] = detalheValores([e], "lucro");
    expect(linha.valor).toBe(e.lucro);
    // toLocaleString usa espaço não separável depois do "R$".
    expect(linha.conta?.replace(/\s/g, " ")).toContain("de mercado − R$ 114,13 de custo real (8 h × hora do salário)");
  });
});

describe("Bonificação — chamado sem parecer não vira R$ 0 (12/11/2026)", () => {
  it("a média só conta as entregas com valor e mostra as pendentes à parte", () => {
    expect(mediaComValor(entregas, "valorMercado")).toEqual({ media: 27900, comValor: 2, pendentes: 1 });
  });

  it("sem nenhuma entrega com valor, não há média", () => {
    expect(mediaComValor([entregas[2]], "valorMercado")).toEqual({ media: null, comValor: 0, pendentes: 1 });
  });

  it("o contexto da I.A leva a média sem as pendentes", () => {
    const [dev] = resumoPorDev(entregas, CONFIG_PADRAO);
    const ctx = JSON.parse(contextoComparativo([dev], "Novembro/2026"));
    expect(ctx.desenvolvedores[0].media_por_entrega).toBe(27900);
    expect(ctx.desenvolvedores[0].aguardando_ia).toBe(1);
  });
});
