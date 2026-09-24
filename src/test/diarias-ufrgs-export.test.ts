import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { montarFolhaUfrgs } from "@/pages/operacional/exportarDiarias";
import { COLUNAS_UFRGS, DiariaUfrgs, PostoUfrgs, TarifaUfrgs } from "@/pages/operacional/diariasUfrgs";

/**
 * O LAYOUT do Excel exportado.
 *
 * O pedido é que o sistema gere "um relatório exatamente igual o excel
 * anexado", para ninguém mais preencher a planilha à mão. Então o layout é
 * requisito, não estética: estes testes travam as posições que o arquivo
 * original tem — título em D1, ANO/MÊS em V2:W3, o "Período de ... A ..." em
 * J4, as duas linhas de tarifa em 5 e 6, os títulos na linha 7, os dados a
 * partir da 8 — e as FÓRMULAS que cada célula carrega.
 *
 * Se alguém mexer no gerador e o cabeçalho descer uma linha, a fórmula
 * `($N$6*N8)` de toda linha de dado passa a apontar para o lugar errado e o
 * relatório sai com outro número. É o tipo de quebra que ninguém vê revisando
 * código, só abrindo o arquivo.
 */

const TARIFAS: TarifaUfrgs[] = [
  {
    id: "t-rodosul",
    sindicato: "SINDIRODOSUL/RS",
    vigenciaInicio: "2026-01-01",
    hospedagemCentavos: 17377,
    cafeCentavos: 2075,
    almocoCentavos: 3077,
    jantaCentavos: 3077,
    vaCentavos: 3169,
    aliquotaPis: 0.0031,
    aliquotaCofins: 0.0143,
    aliquotaIss: 0.05,
  },
  {
    id: "t-sinecarga",
    sindicato: "SINECARGA/RS",
    vigenciaInicio: "2026-01-01",
    hospedagemCentavos: 6607,
    cafeCentavos: 1389,
    almocoCentavos: 2609,
    jantaCentavos: 2609,
    vaCentavos: 1652,
    aliquotaPis: 0.0031,
    aliquotaCofins: 0.0143,
    aliquotaIss: 0.05,
  },
];

const POSTOS: PostoUfrgs[] = [
  { codigo: "B3", descricao: "Motorista categoria B3...", localidade: "PORTO ALEGRE", ordem: 20 },
  { codigo: "D3", descricao: "Motorista categoria D3...", localidade: "ELDORADO DO SUL", ordem: 120 },
];

/** A linha 8 da planilha entregue, campo por campo. */
const LINHA_8: DiariaUfrgs = {
  uuid: "u1",
  id: "DU-2026-000001",
  criadoEm: "2026-01-20 09:00",
  status: "aprovada",
  contratoId: "c1",
  contratoNome: "034/2022 - Motoristas",
  contratoCliente: "UFRGS",
  contratoEmpresa: "NASCIMENTO SERVIÇOS DE LIMPEZA LTDA",
  competencia: "2026-01-01",
  codFornecedor: "",
  matricula: "5644",
  motoristaEmpregadoId: 79,
  motoristaNome: "PAULO RICARDO DOS SANTOS DUTRA",
  sindicato: "SINDIRODOSUL/RS",
  lotacao: "DITRAN",
  numeroOficio: "001/2026",
  saida: "2026-01-20",
  retorno: "2026-01-21",
  destino: "URUGUAIANA",
  dataDeposito: "2026-01-19",
  posto: "B3",
  postoDescricao: "",
  valorPostoVariavelCentavos: 0,
  fiscal: "CARLOS AUGUSTO DOS SANTOS CASTILHO",
  pix: "",
  pixTipo: null,
  aliquotaTotal: 0.0674,
  tarifaId: "t-rodosul",
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
  maloteDespesaId: "d1",
};

/** A linha 69 — a única SINECARGA do mês, a que usa a tarifa da linha 5. */
const LINHA_69: DiariaUfrgs = {
  ...LINHA_8,
  uuid: "u2",
  id: "DU-2026-000002",
  criadoEm: "2026-01-21 09:00",
  status: "solicitada",
  matricula: "5628",
  motoristaNome: "WANDELIR WILDNER",
  sindicato: "SINECARGA/RS",
  lotacao: "FROTA",
  numeroOficio: "03/2026",
  saida: "2026-01-21",
  retorno: "2026-01-21",
  destino: "MAQUINE",
  dataDeposito: null,
  posto: "D3",
  fiscal: "MARCIANA DEMARCHI",
  pix: "",
  pixTipo: null,
  tarifaId: "t-sinecarga",
  qtHospedagem: 0,
  qtCafe: 1,
  qtAlmoco: 1,
  qtJanta: 0,
  qtVa: 1,
  valorTotalCentavos: 3998,
  valorVaCentavos: 1652,
  valorLiquidoCentavos: 2346,
  tributosCentavos: 170,
  valorFaturarCentavos: 2516,
  maloteDespesaId: null,
};

const folha = () =>
  montarFolhaUfrgs([LINHA_8, LINHA_69], {
    nomeArquivo: "teste",
    empresa: "NASCIMENTO SERVIÇOS DE LIMPEZA LTDA",
    contrato: "034/2022 - Motoristas",
    postos: POSTOS,
    tarifas: TARIFAS,
  });

/** Valor de uma célula, ou undefined quando ela não existe. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const v = (ws: XLSX.WorkSheet, addr: string) => (ws[addr] as any)?.v;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const f = (ws: XLSX.WorkSheet, addr: string) => (ws[addr] as any)?.f;

describe("cabeçalho do relatório", () => {
  const ws = folha();

  it("o título fica em D1, mesclado até S1, com o texto do arquivo original", () => {
    expect(v(ws, "D1")).toBe("TABELA DE PAGAMENTO DE DIÁRIAS UFRGS     ");
    const mesclados = (ws["!merges"] ?? []).map((m) => XLSX.utils.encode_range(m));
    expect(mesclados).toContain("D1:S1");
    expect(mesclados).toContain("D2:S2");
    expect(mesclados).toContain("D3:S3");
  });

  it("empresa em D2 e contrato em D3", () => {
    expect(v(ws, "D2")).toBe("NASCIMENTO SERVIÇOS DE LIMPEZA LTDA");
    expect(v(ws, "D3")).toBe("Contrato: 034/2022 - Motoristas");
  });

  it("ANO e MÊS em V2:W3, com o mês em português", () => {
    expect(v(ws, "V2")).toBe("ANO");
    expect(v(ws, "W2")).toBe(2026);
    expect(v(ws, "V3")).toBe("MÊS");
    expect(v(ws, "W3")).toBe("JANEIRO");
  });

  it("o período em J4 cobre da primeira saída ao último retorno", () => {
    expect(v(ws, "J4")).toBe("Período de 20/01/2026 A 21/01/2026");
    expect(v(ws, "R4")).toBe("VA");
  });
});

describe("linhas 5 e 6 — as tarifas que as fórmulas referenciam", () => {
  const ws = folha();

  it("a linha 5 é a SINECARGA/RS e a 6 é a SINDIRODOSUL/RS, como no original", () => {
    expect(v(ws, "M5")).toBe("SINECARGA/RS");
    expect(v(ws, "N5")).toBeCloseTo(66.07, 2);
    expect(v(ws, "O5")).toBeCloseTo(13.89, 2);
    expect(v(ws, "P5")).toBeCloseTo(26.09, 2);
    expect(v(ws, "Q5")).toBeCloseTo(26.09, 2);
    expect(v(ws, "R5")).toBeCloseTo(16.52, 2);

    expect(v(ws, "M6")).toBe("SINDIRODOSUL/RS");
    expect(v(ws, "N6")).toBeCloseTo(173.77, 2);
    expect(v(ws, "O6")).toBeCloseTo(20.75, 2);
    expect(v(ws, "P6")).toBeCloseTo(30.77, 2);
    expect(v(ws, "Q6")).toBeCloseTo(30.77, 2);
    expect(v(ws, "R6")).toBeCloseTo(31.69, 2);
  });
});

describe("linha 7 — os títulos das colunas", () => {
  const ws = folha();

  it("A7:W7 são exatamente os 23 títulos da planilha, na ordem dela", () => {
    COLUNAS_UFRGS.forEach((c, i) => {
      const addr = `${XLSX.utils.encode_col(i)}7`;
      expect(v(ws, addr)).toBe(c.titulo);
    });
    // Sanidade: os cantos do cabeçalho, escritos à mão.
    expect(v(ws, "A7")).toBe("Item");
    expect(v(ws, "C7")).toBe("Matr.");
    expect(v(ws, "D7")).toBe("Motorista");
    expect(v(ws, "K7")).toBe("Data de Depósito");
    expect(v(ws, "R7")).toBe("Valor Total");
    expect(v(ws, "W7")).toBe("Fiscal");
  });

  it("as colunas de rastreabilidade do sistema vêm DEPOIS da W", () => {
    // Elas não existem na planilha do usuário e não podem empurrar nenhuma
    // coluna do relatório para o lado.
    expect(v(ws, "X7")).toBe("Dias VA");
    expect(v(ws, "Y7")).toBe("Nº no sistema");
    expect(v(ws, "Z7")).toBe("Status");
    expect(v(ws, "AA7")).toBe("Lançada por");
  });
});

describe("linhas de dados — valores e fórmulas", () => {
  const ws = folha();

  it("a primeira diária entra na linha 8, numerada como Item 1", () => {
    expect(v(ws, "A8")).toBe(1);
    expect(v(ws, "C8")).toBe("5644");
    expect(v(ws, "D8")).toBe("PAULO RICARDO DOS SANTOS DUTRA");
    expect(v(ws, "E8")).toBe("SINDIRODOSUL/RS");
    expect(v(ws, "F8")).toBe("DITRAN");
    expect(v(ws, "G8")).toBe("001/2026");
    expect(v(ws, "J8")).toBe("URUGUAIANA");
    expect(v(ws, "L8")).toBe("B3");
    expect(v(ws, "W8")).toBe("CARLOS AUGUSTO DOS SANTOS CASTILHO");
  });

  it("as datas saem como serial do Excel com formato dd/mm/yyyy", () => {
    // 20/01/2026 = 46042 dias desde 30/12/1899.
    expect(v(ws, "H8")).toBe(46042);
    expect(v(ws, "I8")).toBe(46043);
    // "Data de Depósito" só existe quando a diária foi paga no malote.
    expect(v(ws, "K8")).toBe(46041);
    expect(ws["H8"]?.z).toBe("dd/mm/yyyy");
    expect(ws["K9"]).toBeUndefined();
  });

  it("a fórmula do Valor Total aponta para a linha de tarifa DO SINDICATO da linha", () => {
    // SINDIRODOSUL → linha 6; SINECARGA → linha 5. Trocar isto é pagar
    // hospedagem de R$ 173,77 onde o contrato prevê R$ 66,07.
    expect(f(ws, "R8")).toBe("($N$6*N8)+($O$6*O8)+($P$6*P8)+($Q$6*Q8)");
    expect(f(ws, "R9")).toBe("($N$5*N9)+($O$5*O9)+($P$5*P9)+($Q$5*Q9)");
    expect(v(ws, "R8")).toBeCloseTo(307.58, 2);
    expect(v(ws, "R9")).toBeCloseTo(39.98, 2);
  });

  it("Valor VA é a tarifa de VA vezes os dias — o que a planilha escrevia à mão", () => {
    // No original: "=31.69*2", com o 31,69 digitado. Aqui a referência é a
    // célula da tarifa, então um dissídio não deixa a fórmula desatualizada.
    expect(f(ws, "S8")).toBe("$R$6*2");
    expect(f(ws, "S9")).toBe("$R$5*1");
    expect(v(ws, "S8")).toBeCloseTo(63.38, 2);
  });

  it("Líquido, Tributos e À Faturar são as fórmulas T=R-S, U=gross-up, V=T+U", () => {
    expect(f(ws, "T8")).toBe("R8-S8");
    expect(f(ws, "U8")).toBe("(T8*0.0674/(1-0.0674))");
    expect(f(ws, "V8")).toBe("T8+U8");
    expect(v(ws, "T8")).toBeCloseTo(244.2, 2);
    expect(v(ws, "U8")).toBeCloseTo(17.65, 2);
    expect(v(ws, "V8")).toBeCloseTo(261.85, 2);
  });

  it("todas as células de dinheiro saem no formato contábil do original", () => {
    for (const addr of ["R8", "S8", "T8", "U8", "V8"]) {
      expect(ws[addr]?.z).toContain('R$ ');
    }
  });
});

describe("Totalizadores", () => {
  const ws = folha();
  // 2 diárias → dados nas linhas 8 e 9, totalizador na 10.
  const rTot = 10;

  it("soma as quantidades e os valores com SUM sobre a faixa dos dados", () => {
    expect(v(ws, `A${rTot}`)).toBe("Totalizadores");
    expect(f(ws, `N${rTot}`)).toBe("SUM(N8:N9)");
    expect(v(ws, `N${rTot}`)).toBe(1);
    expect(f(ws, `V${rTot}`)).toBe("SUM(V8:V9)");
    expect(v(ws, `V${rTot}`)).toBeCloseTo((26185 + 2516) / 100, 2);
  });
});

describe("blocos de resumo", () => {
  const ws = folha();

  it("traz a tabela de referência, os tributos, o resumo por sindicato e o POSTO/CARGO", () => {
    const textos = Object.keys(ws)
      .filter((k) => !k.startsWith("!"))
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((k) => (ws[k] as any)?.v)
      .filter((x): x is string => typeof x === "string");

    expect(textos).toContain("RESUMO DOS TRIBUTOS");
    expect(textos).toContain("DATA BASE");
    expect(textos).toContain("VALE ALIMENTAÇÃO");
    expect(textos).toContain("HOSPEDAGEM");
    expect(textos).toContain("1 PIS");
    expect(textos).toContain("2 COFINS");
    expect(textos).toContain("Total (F)");
    expect(textos).toContain("PLANILHA RESUMO - VIAGENS REALIZADAS");
    expect(textos).toContain("Valor Total VA (D)");
    expect(textos).toContain("Valor Líquido das Diárias (E)");
    expect(textos).toContain("Valor dos Tributos (G)");
    expect(textos).toContain("Valor da Fatura");
    expect(textos).toContain("SINDICATOS");
    expect(textos).toContain("QT HOSPEDAGEM");
    expect(textos).toContain("POSTO/CARGO");
    expect(textos).toContain("Total a Faturar");
    // Um total por localidade, mais o total do contrato.
    expect(textos).toContain("TOTAL - PORTO ALEGRE");
    expect(textos).toContain("TOTAL - ELDORADO DO SUL");
    expect(textos).toContain("TOTAL DO CONTRATO");
  });

  it("as larguras de coluna são as medidas no arquivo entregue", () => {
    const cols = ws["!cols"] ?? [];
    expect(cols[0]?.wch).toBeCloseTo(9.21, 2); // A — Item
    expect(cols[3]?.wch).toBeCloseTo(69.93, 2); // D — Motorista
    expect(cols[22]?.wch).toBeCloseTo(68.07, 2); // W — Fiscal
  });
});

describe("relatório vazio", () => {
  it("não quebra e ainda mostra a tabela do contrato", () => {
    const ws = montarFolhaUfrgs([], {
      nomeArquivo: "vazio",
      empresa: "NASCIMENTO",
      contrato: "034/2022",
      postos: POSTOS,
      tarifas: TARIFAS,
    });
    expect(v(ws, "D1")).toBe("TABELA DE PAGAMENTO DE DIÁRIAS UFRGS     ");
    expect(v(ws, "A7")).toBe("Item");
    expect(v(ws, "N6")).toBeCloseTo(173.77, 2);
    // Sem dados, o totalizador cai na linha 9 (a faixa mínima é 8:8).
    expect(v(ws, "A9")).toBe("Totalizadores");
  });
});
