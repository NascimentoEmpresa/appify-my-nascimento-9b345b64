import { describe, expect, it } from "vitest";
import {
  DiariaUfrgs,
  RascunhoTarifaUfrgs,
  TarifaUfrgs,
  calcularValoresUfrgs,
  impactoDaTarifa,
  mesDaCompetencia,
  proximaVigencia,
  sindicatosUfrgs,
  sobreposicaoUfrgs,
  tarifaVigente,
  validarTarifaUfrgs,
  vigenciasDoSindicato,
} from "@/pages/operacional/diariasUfrgs";

/**
 * As fórmulas da Diária UFRGS, conferidas contra a PLANILHA DE VERDADE.
 *
 * Os casos abaixo não são inventados: cada um é uma linha do arquivo
 * 1789651523607-RETIFICADO__1_.xlsx (aba "DIARIAS 09.2025") que o usuário
 * anexou, com o valor que o Excel calculou. É o que trava a conta — se
 * alguém trocar o gross-up dos tributos por uma multiplicação simples, ou
 * apontar a tarifa errada para um sindicato, um destes quebra.
 *
 * As tarifas são as linhas 5 e 6 da aba:
 *   linha 6, SINDIRODOSUL/RS → hosp 173,77 · café 20,75 · alm 30,77 ·
 *                              janta 30,77 · VA 31,69
 *   linha 5, SINECARGA/RS    → hosp  66,07 · café 13,89 · alm 26,09 ·
 *                              janta 26,09 · VA 16,52
 * e a alíquota é PIS 0,31% + COFINS 1,43% + ISS 5% = 6,74%.
 */

const ALIQUOTAS = { aliquotaPis: 0.0031, aliquotaCofins: 0.0143, aliquotaIss: 0.05 };

const SINDIRODOSUL: TarifaUfrgs = {
  id: "t-rodosul-2026",
  sindicato: "SINDIRODOSUL/RS",
  vigenciaInicio: "2026-01-01",
  hospedagemCentavos: 17377,
  cafeCentavos: 2075,
  almocoCentavos: 3077,
  jantaCentavos: 3077,
  vaCentavos: 3169,
  ...ALIQUOTAS,
};

const SINECARGA: TarifaUfrgs = {
  id: "t-sinecarga-2026",
  sindicato: "SINECARGA/RS",
  vigenciaInicio: "2026-01-01",
  hospedagemCentavos: 6607,
  cafeCentavos: 1389,
  almocoCentavos: 2609,
  jantaCentavos: 2609,
  vaCentavos: 1652,
  ...ALIQUOTAS,
};

/** A tabela anterior do contrato (bloco C140:K143, "DATA BASE" antiga). */
const SINDIRODOSUL_ANTIGA: TarifaUfrgs = {
  ...SINDIRODOSUL,
  id: "t-rodosul-2025",
  vigenciaInicio: "2025-01-01",
  hospedagemCentavos: 15943,
  cafeCentavos: 1904,
  almocoCentavos: 2823,
  jantaCentavos: 2823,
  vaCentavos: 2962,
};

describe("calcularValoresUfrgs — as fórmulas da planilha", () => {
  it("linha 8: PAULO RICARDO, 1 hosp + 2 cafés + 2 almoços + 1 janta, 2 dias de VA", () => {
    const v = calcularValoresUfrgs(
      { qtHospedagem: 1, qtCafe: 2, qtAlmoco: 2, qtJanta: 1, qtVa: 2 },
      SINDIRODOSUL,
    );
    // R8 = 173,77 + 2×20,75 + 2×30,77 + 30,77 = 307,58
    expect(v.valorTotalCentavos).toBe(30758);
    // S8 = 31,69 × 2 = 63,38
    expect(v.valorVaCentavos).toBe(6338);
    // T8 = 307,58 - 63,38 = 244,20
    expect(v.valorLiquidoCentavos).toBe(24420);
    // U8 = 244,20 × 0,0674 / (1 - 0,0674) = 17,6485953... → 17,65
    expect(v.tributosCentavos).toBe(1765);
    // V8 = T8 + U8
    expect(v.valorFaturarCentavos).toBe(24420 + 1765);
  });

  it("linha 9: 1 café + 1 almoço, 1 dia de VA", () => {
    const v = calcularValoresUfrgs(
      { qtHospedagem: 0, qtCafe: 1, qtAlmoco: 1, qtJanta: 0, qtVa: 1 },
      SINDIRODOSUL,
    );
    // R9 = 20,75 + 30,77 = 51,52 — na planilha isso sai 51.519999999999996,
    // que é exatamente o motivo de a conta rodar em centavos aqui.
    expect(v.valorTotalCentavos).toBe(5152);
    expect(v.valorVaCentavos).toBe(3169);
    expect(v.valorLiquidoCentavos).toBe(1983);
    expect(v.tributosCentavos).toBe(143);
  });

  it("linha 12: VALOR LÍQUIDO NEGATIVO é resultado legítimo, não erro", () => {
    // 1 almoço (30,77) menos 1 dia de VA (31,69) = -0,92. A planilha tem essa
    // linha; travar em zero aqui esconderia o desconto de VA que passou do que
    // a viagem gerou.
    const v = calcularValoresUfrgs(
      { qtHospedagem: 0, qtCafe: 0, qtAlmoco: 1, qtJanta: 0, qtVa: 1 },
      SINDIRODOSUL,
    );
    expect(v.valorTotalCentavos).toBe(3077);
    expect(v.valorLiquidoCentavos).toBe(-92);
    // U12 = -0,0664893... → -0,07 (arredondado LONGE do zero, como o Postgres)
    expect(v.tributosCentavos).toBe(-7);
    expect(v.valorFaturarCentavos).toBe(-99);
  });

  it("linha 14: 2 hosp + 3 cafés + 3 almoços + 2 jantas, 3 dias de VA", () => {
    const v = calcularValoresUfrgs(
      { qtHospedagem: 2, qtCafe: 3, qtAlmoco: 3, qtJanta: 2, qtVa: 3 },
      SINDIRODOSUL,
    );
    // R14 = 2×173,77 + 3×20,75 + 3×30,77 + 2×30,77 = 563,64
    expect(v.valorTotalCentavos).toBe(56364);
    // S14 = 31,69 × 3 = 95,07
    expect(v.valorVaCentavos).toBe(9507);
    expect(v.valorLiquidoCentavos).toBe(46857);
    // U14 = 33,8640553... → 33,86
    expect(v.tributosCentavos).toBe(3386);
  });

  it("linha 69: a única SINECARGA do mês usa a OUTRA tabela de tarifa", () => {
    // 1 café + 1 almoço na tarifa da SINECARGA = 13,89 + 26,09 = 39,98. Com a
    // tarifa da SINDIRODOSUL daria 51,52 — é este teste que pega a troca de
    // tabela, o erro mais caro possível aqui (hospedagem de R$ 66,07 virando
    // R$ 173,77 sem ninguém perceber).
    const v = calcularValoresUfrgs(
      { qtHospedagem: 0, qtCafe: 1, qtAlmoco: 1, qtJanta: 0, qtVa: 1 },
      SINECARGA,
    );
    expect(v.valorTotalCentavos).toBe(3998);
    expect(v.valorVaCentavos).toBe(1652);
    expect(v.valorLiquidoCentavos).toBe(2346);
  });

  it("o tributo é GROSS-UP, não uma porcentagem do líquido", () => {
    // É a diferença entre f/(1-f) e f, ~7% do imposto em toda linha. O que o
    // gross-up garante: o tributo é 6,74% do valor FATURADO, não do líquido.
    const v = calcularValoresUfrgs(
      { qtHospedagem: 1, qtCafe: 0, qtAlmoco: 0, qtJanta: 0, qtVa: 0 },
      SINDIRODOSUL,
    );
    const faturado = v.valorFaturarCentavos;
    expect(Math.abs(v.tributosCentavos / faturado - 0.0674)).toBeLessThan(0.0001);
    // E é MAIOR que a multiplicação simples, sempre.
    expect(v.tributosCentavos).toBeGreaterThan(Math.round(v.valorLiquidoCentavos * 0.0674));
  });

  it("diária sem nenhuma quantidade dá zero em tudo", () => {
    const v = calcularValoresUfrgs(
      { qtHospedagem: 0, qtCafe: 0, qtAlmoco: 0, qtJanta: 0, qtVa: 0 },
      SINDIRODOSUL,
    );
    expect(v).toEqual({
      valorTotalCentavos: 0,
      valorVaCentavos: 0,
      valorLiquidoCentavos: 0,
      tributosCentavos: 0,
      valorFaturarCentavos: 0,
    });
  });
});

describe("tarifaVigente — a tabela é a do dia da viagem", () => {
  const tabela = [SINDIRODOSUL, SINDIRODOSUL_ANTIGA, SINECARGA];

  it("usa a tarifa em vigor na data de SAÍDA, não a mais recente", () => {
    // Lançamento retroativo de 2025 tem que usar a tabela de 2025: a diária
    // já faturada não pode mudar de valor por causa de um dissídio posterior.
    expect(tarifaVigente(tabela, "SINDIRODOSUL/RS", "2025-06-10")?.id).toBe("t-rodosul-2025");
    expect(tarifaVigente(tabela, "SINDIRODOSUL/RS", "2026-01-15")?.id).toBe("t-rodosul-2026");
  });

  it("pega a tarifa que começa exatamente no dia da saída", () => {
    expect(tarifaVigente(tabela, "SINDIRODOSUL/RS", "2026-01-01")?.id).toBe("t-rodosul-2026");
  });

  it("devolve null quando nenhuma vigência começou ainda", () => {
    expect(tarifaVigente(tabela, "SINDIRODOSUL/RS", "2024-12-31")).toBeNull();
  });

  it("não mistura sindicatos", () => {
    expect(tarifaVigente(tabela, "SINECARGA/RS", "2026-01-15")?.id).toBe("t-sinecarga-2026");
  });

  it("sem sindicato ou sem data, não há tarifa (o modal ainda está sendo preenchido)", () => {
    expect(tarifaVigente(tabela, "", "2026-01-15")).toBeNull();
    expect(tarifaVigente(tabela, "SINECARGA/RS", "")).toBeNull();
  });
});

// ---------------------------------------------------------------------------

const diaria = (p: Partial<DiariaUfrgs>): DiariaUfrgs =>
  ({
    uuid: "u1",
    id: "DU-2026-000001",
    criadoEm: "17/09/2026 09:00",
    status: "solicitada",
    contratoId: "c1",
    contratoNome: "034/2022",
    contratoCliente: "UFRGS",
    contratoEmpresa: "NASCIMENTO",
    competencia: "2026-01-01",
    codFornecedor: "",
    matricula: "5644",
    motoristaEmpregadoId: 10,
    motoristaNome: "PAULO RICARDO DOS SANTOS DUTRA",
    sindicato: "SINDIRODOSUL/RS",
    lotacao: "DITRAN",
    numeroOficio: "001/2026",
    saida: "2026-01-05",
    retorno: "2026-01-06",
    destino: "URUGUAIANA",
    dataDeposito: null,
    posto: "B3",
    postoDescricao: "",
    valorPostoVariavelCentavos: 0,
    fiscal: "",
    aliquotaTotal: 0.0674,
    tarifaId: "t-rodosul-2026",
    qtHospedagem: 1,
    qtCafe: 2,
    qtAlmoco: 2,
    qtJanta: 1,
    qtVa: 2,
    valorTotalCentavos: 30758,
    valorVaCentavos: 6338,
    valorLiquidoCentavos: 24420,
    tributosCentavos: 1765,
    valorFaturarCentavos: 26185,
    observacoes: "",
    anexos: [],
    solicitanteId: "user-1",
    solicitante: "Eduardo",
    maloteDespesaId: null,
    ...p,
  }) as DiariaUfrgs;

describe("sobreposicaoUfrgs — aviso de lançamento repetido", () => {
  const base = diaria({});

  it("aponta o mesmo motorista com período que se cruza", () => {
    const achada = sobreposicaoUfrgs(
      {
        motoristaEmpregadoId: 10,
        motoristaNome: "PAULO RICARDO DOS SANTOS DUTRA",
        saida: "2026-01-06",
        retorno: "2026-01-07",
      },
      [base],
    );
    expect(achada?.uuid).toBe("u1");
  });

  it("não aponta outro motorista no mesmo dia — é o caso normal do contrato", () => {
    expect(
      sobreposicaoUfrgs(
        { motoristaEmpregadoId: 99, motoristaNome: "OUTRO", saida: "2026-01-05", retorno: "2026-01-06" },
        [base],
      ),
    ).toBeNull();
  });

  it("não aponta a própria diária quando ela está sendo editada", () => {
    expect(
      sobreposicaoUfrgs(
        {
          uuid: "u1",
          motoristaEmpregadoId: 10,
          motoristaNome: "PAULO RICARDO DOS SANTOS DUTRA",
          saida: "2026-01-05",
          retorno: "2026-01-06",
        },
        [base],
      ),
    ).toBeNull();
  });

  it("reprovada e excluída não ocupam o período — senão travariam o relançamento", () => {
    for (const status of ["reprovada", "excluida"] as const) {
      expect(
        sobreposicaoUfrgs(
          {
            motoristaEmpregadoId: 10,
            motoristaNome: "PAULO RICARDO DOS SANTOS DUTRA",
            saida: "2026-01-05",
            retorno: "2026-01-06",
          },
          [diaria({ status })],
        ),
      ).toBeNull();
    }
  });

  it("casa por NOME quando o motorista foi digitado à mão (sem id do cadastro)", () => {
    const achada = sobreposicaoUfrgs(
      {
        motoristaEmpregadoId: null,
        motoristaNome: "  paulo ricardo dos santos dutra ",
        saida: "2026-01-05",
        retorno: "2026-01-05",
      },
      [diaria({ motoristaEmpregadoId: null })],
    );
    expect(achada?.uuid).toBe("u1");
  });

  it("períodos que não se tocam não são sobreposição", () => {
    expect(
      sobreposicaoUfrgs(
        {
          motoristaEmpregadoId: 10,
          motoristaNome: "PAULO RICARDO DOS SANTOS DUTRA",
          saida: "2026-01-07",
          retorno: "2026-01-08",
        },
        [base],
      ),
    ).toBeNull();
  });
});

describe("cabeçalho do relatório", () => {
  it("o mês sai em português maiúsculo, como na planilha (V3/W3)", () => {
    expect(mesDaCompetencia("2026-01-01")).toBe("JANEIRO");
    expect(mesDaCompetencia("2026-09-01")).toBe("SETEMBRO");
    expect(mesDaCompetencia("2026-03-01")).toBe("MARÇO");
  });
});


// ---------------------------------------------------------------------------
// EDIÇÃO DA TARIFA PELA TELA (22/09/2026)
//
// A tabela de valores dos sindicatos deixou de ser coisa de migration e
// passou a ser editável em /app/financeiro/diarias?tipo=ufrgs. O que os
// testes abaixo protegem é o que muda de valor no bolso de alguém: quem
// aparece no dropdown, qual vigência manda, o que uma alteração recalcula — e
// o que ela NÃO pode recalcular.

const TABELA_COMPLETA: TarifaUfrgs[] = [SINDIRODOSUL, SINDIRODOSUL_ANTIGA, SINECARGA];

describe("sindicatosUfrgs — o dropdown sai da tabela, não de uma constante", () => {
  it("lista os sindicatos que têm tarifa, em ordem", () => {
    expect(sindicatosUfrgs(TABELA_COMPLETA)).toEqual(["SINDIRODOSUL/RS", "SINECARGA/RS"].sort());
  });

  it("inclui um sindicato cadastrado pela tela, sem passar por código", () => {
    const novo: TarifaUfrgs = { ...SINECARGA, id: "t-novo", sindicato: "SETCERGS/RS" };
    expect(sindicatosUfrgs([...TABELA_COMPLETA, novo])).toContain("SETCERGS/RS");
  });

  it("não oferece sindicato cuja única vigência foi removida", () => {
    const removido: TarifaUfrgs = { ...SINECARGA, id: "t-x", sindicato: "ANTIGO/RS", ativo: false };
    expect(sindicatosUfrgs([...TABELA_COMPLETA, removido])).not.toContain("ANTIGO/RS");
  });

  it("cai na constante enquanto a consulta não respondeu — o campo nunca abre vazio", () => {
    expect(sindicatosUfrgs([])).toEqual(["SINDIRODOSUL/RS", "SINECARGA/RS"]);
  });
});

describe("vigências", () => {
  it("vêm da mais nova para a mais antiga", () => {
    expect(vigenciasDoSindicato(TABELA_COMPLETA, "SINDIRODOSUL/RS").map((t) => t.vigenciaInicio)).toEqual([
      "2026-01-01",
      "2025-01-01",
    ]);
  });

  it("a próxima vigência fecha a janela da anterior", () => {
    expect(proximaVigencia(TABELA_COMPLETA, "SINDIRODOSUL/RS", "2025-01-01")).toBe("2026-01-01");
    expect(proximaVigencia(TABELA_COMPLETA, "SINDIRODOSUL/RS", "2026-01-01")).toBeNull();
  });

  it("vigência removida não fecha janela nenhuma nem entra no cálculo", () => {
    const tabela = TABELA_COMPLETA.map((t) =>
      t.id === "t-rodosul-2026" ? { ...t, ativo: false } : t,
    );
    expect(proximaVigencia(tabela, "SINDIRODOSUL/RS", "2025-01-01")).toBeNull();
    // e a diária de 2026 volta a ser calculada pela tabela de 2025
    expect(tarifaVigente(tabela, "SINDIRODOSUL/RS", "2026-03-10")?.id).toBe("t-rodosul-2025");
  });
});

describe("validarTarifaUfrgs — as mesmas recusas da RPC", () => {
  const ok: RascunhoTarifaUfrgs = {
    sindicato: "SINDIRODOSUL/RS",
    vigenciaInicio: "2026-09-01",
    hospedagemCentavos: 17377,
    cafeCentavos: 2075,
    almocoCentavos: 3077,
    jantaCentavos: 3077,
    vaCentavos: 3169,
    ...ALIQUOTAS,
  };

  it("aceita a tabela do contrato", () => {
    expect(validarTarifaUfrgs(ok)).toBeNull();
  });

  it("recusa alíquotas que somam 100% — o gross-up dividiria por zero no banco", () => {
    expect(
      validarTarifaUfrgs({ ...ok, aliquotaPis: 0.5, aliquotaCofins: 0.5, aliquotaIss: 0 }),
    ).toMatch(/menor que 100%/);
  });

  it("recusa valor negativo, tabela toda zerada, sindicato em branco e data faltando", () => {
    expect(validarTarifaUfrgs({ ...ok, hospedagemCentavos: -1 })).toMatch(/negativos/);
    expect(
      validarTarifaUfrgs({
        ...ok,
        hospedagemCentavos: 0,
        cafeCentavos: 0,
        almocoCentavos: 0,
        jantaCentavos: 0,
        vaCentavos: 0,
      }),
    ).toMatch(/ao menos um valor/);
    expect(validarTarifaUfrgs({ ...ok, sindicato: "   " })).toMatch(/Informe o sindicato/);
    expect(validarTarifaUfrgs({ ...ok, vigenciaInicio: "" })).toMatch(/a partir da qual/);
  });

  it("aceita VA zerado — há contrato sem desconto de vale", () => {
    expect(validarTarifaUfrgs({ ...ok, vaCentavos: 0 })).toBeNull();
  });
});

describe("impactoDaTarifa — o aviso que aparece antes de salvar", () => {
  // Três diárias do mesmo sindicato: uma em aberto e uma aprovada dentro da
  // janela da tarifa de 2026, e uma em aberto na janela de 2025.
  const emAberto = diaria({ uuid: "aberta", status: "solicitada", saida: "2026-03-10" });
  const aprovada = diaria({ uuid: "aprovada", status: "aprovada", saida: "2026-04-10" });
  const paga = diaria({ uuid: "paga", status: "paga", saida: "2026-05-10" });
  const antiga = diaria({ uuid: "antiga", status: "em_ajuste", saida: "2025-06-10" });
  const lista = [emAberto, aprovada, paga, antiga];

  it("recalcula só o que ainda não foi decidido", () => {
    const r = impactoDaTarifa(lista, TABELA_COMPLETA, "SINDIRODOSUL/RS", "2026-01-01");
    expect(r.recalculadas.map((d) => d.uuid)).toEqual(["aberta"]);
    expect(r.congeladas.map((d) => d.uuid).sort()).toEqual(["aprovada", "paga"]);
  });

  it("não atravessa a vigência seguinte — a de 2025 para onde a de 2026 começa", () => {
    const r = impactoDaTarifa(lista, TABELA_COMPLETA, "SINDIRODOSUL/RS", "2025-01-01");
    expect(r.recalculadas.map((d) => d.uuid)).toEqual(["antiga"]);
    expect(r.congeladas).toHaveLength(0);
  });

  it("ignora diária de outro sindicato", () => {
    const outra = diaria({ uuid: "outro", sindicato: "SINECARGA/RS", saida: "2026-03-10" });
    const r = impactoDaTarifa([...lista, outra], TABELA_COMPLETA, "SINDIRODOSUL/RS", "2026-01-01");
    expect(r.recalculadas.map((d) => d.uuid)).not.toContain("outro");
  });

  it("excluída não entra em contagem nenhuma", () => {
    const morta = diaria({ uuid: "morta", status: "excluida", saida: "2026-03-10" });
    const r = impactoDaTarifa([...lista, morta], TABELA_COMPLETA, "SINDIRODOSUL/RS", "2026-01-01");
    expect([...r.recalculadas, ...r.congeladas].map((d) => d.uuid)).not.toContain("morta");
  });

  it("uma vigência criada hoje, com a lista vazia de diárias, não assusta ninguém", () => {
    const r = impactoDaTarifa([], TABELA_COMPLETA, "SINDIRODOSUL/RS", "2026-09-22");
    expect(r.recalculadas).toHaveLength(0);
    expect(r.congeladas).toHaveLength(0);
  });
});
