import { describe, expect, it } from "vitest";
import { totaisPorNatureza, type MapaNatureza } from "@/pages/financeiro/fluxo-caixa/naturezaFluxo";

const mapa: MapaNatureza = new Map([
  ["cls-livre", "livre"],
  ["cls-vinc", "conta_vinculada"],
  ["cls-cdb", "cdb"],
]);

describe("SIS-2026-0726 — Fluxo separado por natureza da classificação", () => {
  it("separa entradas e saídas em conta movimento, conta vinculada e CDB, e fecha com o total", () => {
    const r = totaisPorNatureza(
      [
        { tipo: "entrada", valor: 1000, classificacao_id: "cls-livre" },
        { tipo: "entrada", valor: 200, classificacao_id: "cls-vinc" },
        { tipo: "entrada", valor: 50.5, classificacao_id: "cls-cdb" },
        { tipo: "saida", valor: 400, classificacao_id: "cls-livre" },
        { tipo: "saida", valor: 150, classificacao_id: "cls-vinc" },
        { tipo: "saida", valor: 30, classificacao_id: "cls-cdb" },
      ],
      mapa,
    );
    expect(r.entradas).toEqual({ livre: 1000, conta_vinculada: 200, cdb: 50.5, semNatureza: 0, total: 1250.5 });
    expect(r.saidas).toEqual({ livre: 400, conta_vinculada: 150, cdb: 30, semNatureza: 0, total: 580 });
    expect(r.saldo).toEqual({ livre: 600, conta_vinculada: 50, cdb: 20.5, semNatureza: 0, total: 670.5 });
    expect(r.saldo.livre + r.saldo.conta_vinculada + r.saldo.cdb).toBe(r.saldo.total);
  });

  it("rateio com classificações diferentes conta cada cota na natureza da sua classificação", () => {
    const r = totaisPorNatureza(
      [{ tipo: "saida", valor: 5319.41, partesClassificacao: [{ classificacaoId: "cls-livre", valor: 3000 }, { classificacaoId: "cls-vinc", valor: 2319.41 }] }],
      mapa,
    );
    expect(r.saidas).toMatchObject({ livre: 3000, conta_vinculada: 2319.41, total: 5319.41 });
  });

  it("classificação sem natureza e lançamento sem classificação NÃO são chutados: ficam em semNatureza e são listados", () => {
    const r = totaisPorNatureza(
      [
        { tipo: "entrada", valor: 100, classificacao_id: "cls-livre" },
        { tipo: "entrada", valor: 40, classificacao_id: "cls-nova" },
        { tipo: "saida", valor: 10, classificacao_id: null },
        { tipo: "saida", valor: 5, classificacao_id: "cls-nova" },
      ],
      mapa,
    );
    expect(r.entradas).toMatchObject({ livre: 100, semNatureza: 40, total: 140 });
    expect(r.saidas).toMatchObject({ semNatureza: 15, total: 15 });
    expect(r.semNaturezaPorClassificacao).toEqual([
      { classificacaoId: "cls-nova", valor: 45, qtd: 2 },
      { classificacaoId: null, valor: 10, qtd: 1 },
    ]);
  });

  it("sem nenhum mapeamento tudo vira semNatureza, e o total continua igual ao de sempre", () => {
    const r = totaisPorNatureza([{ tipo: "entrada", valor: "10.50", classificacao_id: "x" }, { tipo: "saida", valor: 4, classificacao_id: "y" }], new Map());
    expect(r.entradas.total).toBe(10.5);
    expect(r.saidas.total).toBe(4);
    expect(r.saldo.total).toBe(6.5);
    expect(r.saldo.semNatureza).toBe(6.5);
  });

  it("não acumula erro de centavo", () => {
    const linhas = Array.from({ length: 10 }, () => ({ tipo: "entrada" as const, valor: 0.1, classificacao_id: "cls-livre" }));
    expect(totaisPorNatureza(linhas, mapa).entradas.livre).toBe(1);
  });
});

describe("SIS-2026-0726 V1 — conta vinculada pelo texto do banco/descrição (só sem classificação mapeada)", () => {
  it("lançamento sem natureza na classificação, com 'conta vinculada' na descrição ou no banco, vai para Conta vinculada", () => {
    const r = totaisPorNatureza(
      [
        { tipo: "entrada", valor: 100, classificacao_id: "cls-nova", descricao: "Resgate Conta Vinculada Embrapa" },
        { tipo: "saida", valor: 40, classificacao_id: null, banco_nome: "Banco do Brasil Conta Vinculada Furg Portaria" },
        { tipo: "saida", valor: 7, classificacao_id: "cls-nova", descricao: "PAGAMENTO FORNECEDOR" },
      ],
      mapa,
    );
    expect(r.entradas).toMatchObject({ conta_vinculada: 100, semNatureza: 0 });
    expect(r.saidas).toMatchObject({ conta_vinculada: 40, semNatureza: 7 });
    expect(r.contaVinculadaPorTexto).toEqual({ entradas: 100, saidas: 40 });
  });

  it("a classificação mapeada sempre vence o texto", () => {
    const r = totaisPorNatureza([{ tipo: "entrada", valor: 50, classificacao_id: "cls-livre", descricao: "RECEBIMENTO NOTA conta vinculada" }], mapa);
    expect(r.entradas).toMatchObject({ livre: 50, conta_vinculada: 0 });
    expect(r.contaVinculadaPorTexto).toEqual({ entradas: 0, saidas: 0 });
  });

  it("ignora acento e caixa", () => {
    const r = totaisPorNatureza([{ tipo: "saida", valor: 3, classificacao_id: null, descricao: "retenção cónta vinculáda" }], mapa);
    expect(r.saidas.conta_vinculada).toBe(3); // acento e caixa não atrapalham
    const r2 = totaisPorNatureza([{ tipo: "saida", valor: 3, classificacao_id: null, descricao: "Conta Vinculada" }], mapa);
    expect(r2.saidas.conta_vinculada).toBe(3);
  });
});
