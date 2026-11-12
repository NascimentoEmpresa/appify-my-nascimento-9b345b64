import { describe, expect, it } from "vitest";
import { entradaFinanceiraTv, linhasDaTv, paginasOpeContratos, topImpacto, type DadosOpeContratosTv } from "@/lib/tv/opeContratosTv";
import type { ContratoRpc } from "@/lib/operacional/indicadoresContratos";
import { paginasDoRelatorio } from "@/lib/tv/relatorioTv";

// TV › Operacional — Indicadores por Contrato (11/11/2026). Dados fictícios.

const contrato = (id: string, nome: string, extra: Partial<ContratoRpc> = {}): ContratoRpc => ({
  id, nome, cliente: "CLIENTE FICTICIO", encerrado: false,
  postos: { contratados: 20, previsto: 20, implantado_registrado: true, cobertos: 20, afastados: 0 },
  efetivo: 20, demissoes: 0, atestados: { dias_pessoa: 0, pessoas: 0 },
  glosas: { valor: 0, qtd: 0, causa: null }, reclamacoes: { qtd: 0, causa: null },
  orcado: { custo_direto_por_mes: { "2026-09": 80_000 }, margem_prevista: 8 }, ...extra,
});

const d: DadosOpeContratosTv = {
  competencia: "2026-09", de: "2026-09-01", ate: "2026-09-30", dias: 30,
  janela_notificacoes: { de: "2026-07-03", ate: "2026-09-30" }, gerado_em: "2026-11-11T12:00:00Z",
  contratos: [
    contrato("bom", "CONTRATO BOM - 001/2024"),
    contrato("ruim", "CONTRATO RUIM - 002/2024", { postos: { contratados: 20, previsto: 20, implantado_registrado: true, cobertos: 15, afastados: 1 } }),
    contrato("prejuizo", "CONTRATO PREJUIZO - 003/2024"),
    contrato("fim", "CONTRATO ENCERRADO", { encerrado: true }),
    contrato("vazio", "CONTRATO SEM NADA", { postos: null, efetivo: 0 }),
  ],
  sem_contrato: { glosas_valor: 0, glosas_qtd: 0, reclamacoes_qtd: 0 },
  financeiro: {
    competencia: "2026-09",
    receita: { bom: 100_000, ruim: 100_000, prejuizo: 100_000 },
    custo_por_mes: { "bom|2026-09": 80_000, "ruim|2026-09": 80_000, "prejuizo|2026-09": 120_000 },
  },
};

describe("TV Indicadores por Contrato", () => {
  it("lucratividade vem do financeiro do banco (receita − custo da competência)", () => {
    const f = entradaFinanceiraTv(d.financeiro);
    expect(f.doMes?.get("bom")).toEqual({ receita: 100_000, custo: 80_000 });
    const linhas = linhasDaTv(d);
    expect(linhas.find((l) => l.id === "bom")!.ind.lucratividade.valor).toBe(20);
    expect(linhas.find((l) => l.id === "prejuizo")!.ind.lucratividade.status).toBe("critico");
  });

  it("encerrado e contrato sem posto, efetivo nem nota ficam fora da TV", () => {
    expect(linhasDaTv(d).map((l) => l.id).sort()).toEqual(["bom", "prejuizo", "ruim"]);
  });

  it("do pior para o melhor, com a abertura dos que mais pedem atenção", () => {
    const linhas = linhasDaTv(d);
    expect(linhas[linhas.length - 1].id).toBe("bom");
    const ps = paginasOpeContratos(linhas);
    expect(ps[0].chave).toBe("ope-top");
    expect(ps).toHaveLength(4);
    expect(topImpacto(linhas).map((l) => l.id)).not.toContain("bom");
  });

  it("tudo bem: sem tela de destaques, só os contratos", () => {
    const ok = { ...d, contratos: [contrato("bom", "CONTRATO BOM")], financeiro: { ...d.financeiro, receita: { bom: 100_000 }, custo_por_mes: { "bom|2026-09": 80_000 } } };
    expect(paginasOpeContratos(linhasDaTv(ok)).map((p) => p.chave)).toEqual(["ope:bom"]);
  });

  it("sem financeiro, lucratividade fica sem fonte (nunca zero)", () => {
    const l = linhasDaTv({ ...d, financeiro: undefined as unknown as DadosOpeContratosTv["financeiro"] });
    expect(l[0].ind.lucratividade.status).toBe("sem_fonte");
  });

  it("o item da playlist é uma página só (a troca de contrato é da tela)", () => {
    expect(paginasDoRelatorio({ ...d, tipo: "ope-contratos", contrato: null })).toHaveLength(1);
  });
});

// 11/11/2026: o layout "TV da Gerência Operacional" — totais somando as bases e o alerta principal.
import { alertaPrincipal, glosasPorCausa, totaisOpe } from "@/lib/tv/opeContratosTv";

describe("TV da Gerência Operacional — totais", () => {
  it("postos e lucratividade somam as bases, não fazem média de %", () => {
    const t = totaisOpe(d);
    expect(t.postos).toMatchObject({ contratados: 60, cobertos: 55, pct: 91.7, status: "critico" });
    // receita 300 mil, custo 280 mil → 6,7%
    expect(t.lucratividade.margem).toBe(6.7);
    expect(t.lucratividade.status).toBe("atencao");
  });

  it("alerta principal: crítico primeiro; prejuízo tem nome próprio", () => {
    const linhas = linhasDaTv(d);
    expect(alertaPrincipal(linhas.find((l) => l.id === "prejuizo")!)?.texto).toBe("Prejuízo no contrato");
    expect(alertaPrincipal(linhas.find((l) => l.id === "ruim")!)?.texto).toBe("Postos descobertos");
  });

  it("glosas agrupadas pela causa", () => {
    const g = { ...d, contratos: [contrato("x", "X", { glosas: { valor: 100, qtd: 1, causa: "Falta" } }), contrato("y", "Y", { glosas: { valor: 50, qtd: 1, causa: "Falta" } }), contrato("z", "Z", { glosas: { valor: 30, qtd: 1, causa: null } })] };
    expect(glosasPorCausa(g)).toEqual([{ causa: "Falta", valor: 150 }, { causa: "Sem causa informada", valor: 30 }]);
  });
});
