// Importador das planilhas de Início de Contrato — SIS-2026-0599.
//
// As amostras abaixo reproduzem, em memória, o formato EXATO dos dois anexos
// do chamado (medido neles): cabeçalho na linha 4, células mescladas com o
// cargo só na primeira linha do grupo, dois blocos lado a lado na aba
// UNIFORMES e — a armadilha que custou um bug — os dois formatos numéricos
// convivendo na mesma planilha.
import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import { lerPlanilhaOperacional, lerPlanilhaFinanceira, moeda } from "@/lib/implantacao/importarPlanilha";

function montar(abas: Record<string, unknown[][]>): Uint8Array {
  const wb = XLSX.utils.book_new();
  for (const [nome, linhas] of Object.entries(abas)) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(linhas), nome);
  }
  return new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer);
}

const vazio = (n: number) => Array.from({ length: n }, () => "");

describe("moeda()", () => {
  it("formato americano das células de valor", () => {
    expect(moeda(" R$ 1,605.33 ")).toBeCloseTo(1605.33, 2);
    expect(moeda(" R$ 12,533.56 ")).toBeCloseTo(12533.56, 2);
  });

  it("formato brasileiro dos textos escritos à mão", () => {
    // Tratar como americano daria R$ 1.060,00 — 100x o valor real do VT.
    expect(moeda(" R$ 10,60 POR DIA EFETIVAMENTE TRABALHADO")).toBeCloseTo(10.6, 2);
    expect(moeda("R$ 27,15 POR DIA")).toBeCloseTo(27.15, 2);
  });

  it("ignora o que não é valor", () => {
    expect(moeda("NÃO")).toBeNull();
    expect(moeda("")).toBeNull();
    expect(moeda(null)).toBeNull();
    expect(moeda("NÃO ESTÃO PREVISTAS HORAS EXTRAS")).toBeNull();
  });

  it("número já numérico passa direto e porcentagem vira número", () => {
    expect(moeda(2247.46)).toBe(2247.46);
    expect(moeda("19%")).toBe(19);
  });
});

describe("lerPlanilhaOperacional()", () => {
  const arquivo = () =>
    montar({
      "DADOS PARA INICIO DE CONTRATO": [
        vazio(31),
        ["Prestação de serviços de limpeza", ...vazio(30)],
        vazio(31),
        // Linha 4 (índice 3): o cabeçalho de verdade.
        ["TIPO DE POSTO", "TIPO DE SERVIÇO", "CBO", "SALÁRIO BASE", ...vazio(17),
         "TOTAL REMUNERAÇÃO", "ESCALA", "CARGA HORÁRIA", "DIAS DA SEMANA E TURNO",
         "Nº DE POSTOS", "Nº DE FUNCIONÁRIOS POR POSTO", "LOCAIS", "SINDICATO",
         "VALE TRANSPORTE POR DIA", "DESCONTO DE VT"],
        ["LIMPEZA PORTO ALEGRE", "LIMPEZA 40H POA", "5143-20", " R$ 1,605.33 ", ...vazio(17),
         " R$ 2,247.46 ", "5X2 (SEG-SEX)", "40H", "8H POR DIA", "65", "65", "", "SEEAC/RS POA",
         " R$ 10,60 POR DIA EFETIVAMENTE TRABALHADO", " R$ 96.32 "],
        ["LIMPEZA PORTO ALEGRE", "LIMPEZA 20H POA", "5143-20", " R$ 802.66 ", ...vazio(17),
         " R$ 1,123.72 ", "4H DIA (5X2)", "20H", "4H POR DIA", "12", "12", "", "SEEAC/RS POA",
         " R$ 10,60 POR DIA ", " R$ 48.16 "],
      ],
      UNIFORMES: [
        ["UNIFORMES E EPI'S", "", "", "", "MATERIAIS", "", ""],
        ["CARGO", "TIPO DE UNIFORME", "QUANTIDADE", "", "CARGO", "TIPO DE MATERIAL", "QUANTIDADE"],
        ["LIMPEZA", "AVENTAL", "2", "", "LIMPEZA", "BALDES", "1"],
        ["", "LUVA", "2", "", "", "VASSOURA", "3"],
        ["", "MASCARA DE PROTEÇÃO", "5", "", "COPEIRA", "COLHER PARA CAFÉ", "24"],
      ],
      "LOCAIS DE TRABALHO": [
        ["LOCAL", "CIDADE", "ENDEREÇO", "POSTO", "QUANTIDADE DE POSTOS", "QUANTIDADE DE FUNCIONÁRIOS"],
        ["PALÁCIO DA POLÍCIA", "PORTO ALEGRE", "AV. JOÃO PESSOA, 2050", "LIMPEZA 40H POA", "20", "29"],
        ["", "", "", "SUPERVISOR 40H POA", "1", ""],
        ["1ª DP ALVORADA", "ALVORADA", "AV. PRESIDENTE GETÚLIO VARGAS, 100", "LIMPEZA 20H POA", "1", "1"],
      ],
    });

  it("acha o cabeçalho na linha 4 e lê os postos", () => {
    const r = lerPlanilhaOperacional(arquivo());
    expect(r.avisos).toEqual([]);
    expect(r.postos).toHaveLength(2);
    expect(r.postos[0]).toMatchObject({
      tipo_posto: "LIMPEZA PORTO ALEGRE",
      tipo_servico: "LIMPEZA 40H POA",
      cbo: "5143-20",
      escala: "5X2 (SEG-SEX)",
      carga_horaria: "40H",
      qt_postos: 65,
      qt_funcionarios: 65,
    });
    expect(r.postos[0].salario_base).toBeCloseTo(1605.33, 2);
    expect(r.postos[0].total_remuneracao).toBeCloseTo(2247.46, 2);
    // O VT é o caso que o formato misto quebrava.
    expect(r.postos[0].vt_dia).toBeCloseTo(10.6, 2);
  });

  it("herda o cargo das células mescladas nos dois blocos da aba UNIFORMES", () => {
    const r = lerPlanilhaOperacional(arquivo());
    expect(r.itens.filter((i) => i.tipo === "uniforme")).toEqual([
      { cargo: "LIMPEZA", descricao: "AVENTAL", tipo: "uniforme", quantidade: 2 },
      { cargo: "LIMPEZA", descricao: "LUVA", tipo: "uniforme", quantidade: 2 },
      { cargo: "LIMPEZA", descricao: "MASCARA DE PROTEÇÃO", tipo: "uniforme", quantidade: 5 },
    ]);
    // "VASSOURA" herda LIMPEZA; "COLHER PARA CAFÉ" troca para COPEIRA.
    expect(r.itens.filter((i) => i.tipo === "material")).toEqual([
      { cargo: "LIMPEZA", descricao: "BALDES", tipo: "material", quantidade: 1 },
      { cargo: "LIMPEZA", descricao: "VASSOURA", tipo: "material", quantidade: 3 },
      { cargo: "COPEIRA", descricao: "COLHER PARA CAFÉ", tipo: "material", quantidade: 24 },
    ]);
  });

  it("herda local, cidade e endereço quando só o posto muda de linha", () => {
    const r = lerPlanilhaOperacional(arquivo());
    expect(r.locais).toHaveLength(3);
    expect(r.locais[1]).toEqual({
      local_nome: "PALÁCIO DA POLÍCIA",
      cidade: "PORTO ALEGRE",
      endereco: "AV. JOÃO PESSOA, 2050",
      posto: "SUPERVISOR 40H POA",
      qt_postos: 1,
      qt_funcionarios: 0,
    });
    expect(new Set(r.locais.map((l) => l.local_nome)).size).toBe(2);
  });

  it("avisa, em vez de estourar, quando a aba não existe", () => {
    const r = lerPlanilhaOperacional(montar({ Planilha1: [["nada"]] }));
    expect(r.postos).toEqual([]);
    expect(r.avisos.join(" ")).toContain("DADOS PARA INICIO DE CONTRATO");
  });
});

describe("lerPlanilhaFinanceira()", () => {
  it("acha o bloco de postos abaixo do cabeçalho 'Posto' e ignora o total", () => {
    const arquivo = montar({
      "Resumo do Contrato": [
        ["", "", "NASCIMENTO SERVIÇOS DE LIMPEZA LTDA", "", ""],
        ["FICHA DE INÍCIO DE CONTRATO", "", "", "", ""],
        ["Posto", "Valor do Posto", "Quantidade de Postos", "Valor mensal dos postos", ""],
        ["Limpeza 40h POA", " R$ 5,040.09 ", "65", " R$ 327,605.73 ", ""],
        ["Limpeza 20h POA", " R$ 2,870.60 ", "12", " R$ 34,447.15 ", ""],
        ["Total Geral", "", "77", " R$ 362,052.88 ", ""],
      ],
    });
    const r = lerPlanilhaFinanceira(arquivo);
    expect(r.avisos).toEqual([]);
    expect(r.postos).toHaveLength(2);
    expect(r.postos[0].valor_posto).toBeCloseTo(5040.09, 2);
    expect(r.postos.reduce((s, p) => s + p.qt_postos, 0)).toBe(77);
  });
});
