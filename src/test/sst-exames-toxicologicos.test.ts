// SST › Exames Toxicológicos — SIS-2026-0887. A planilha abaixo reproduz, em
// memória, o formato da que o SST usava (medido nela em 13/11/2026): uma aba
// por responsável, linhas vazias no meio, a seção "NÃO PRECISAM" no fim, CPF
// colado no nome, "S/TOXIC" na validade e a cobrança anotada na coluna da
// clínica. Nomes e CPFs fictícios: o repositório é público.
import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import {
  INDICADORES, cobrancaDoTexto, cobradoNoCiclo, contaNoPainel, dataDaCelula, emAlerta, lerPlanilhaToxicologico,
  linhasParaImportar, normCnh, prioridade, responsavelDaAba, situacaoExame, somarMeses, validadeSugerida, type ItemToxico,
} from "@/lib/sst/exameToxicologico";

const HOJE = "2026-11-13";
const item = (x: Partial<ItemToxico> = {}): ItemToxico => ({
  toxicologico_id: 1, empregado_id: 1, nome: "Pessoa", cargo: "MOTORISTA CAT D", situacao_senior: "Trabalhando", desligado: false,
  contrato_id: null, contrato_nome: "Contrato", local_trabalho: null, categoria_cnh: "D", cnh_do_cargo: "D", precisa_exame: true,
  responsavel: null, superior_organograma: null, data_ultimo_exame: null, data_validade: "2027-11-13", clinica: null, observacao: null,
  ultima_cobranca_em: null, ultimo_contato_em: null, ultimo_contato_obs: null, documentos: 0, ...x,
});

describe("situação do exame", () => {
  const s = (validade: string | null) => situacaoExame(item({ data_validade: validade }), HOJE);
  it("nas quatro faixas", () => {
    expect(s("2026-12-14")).toBe("em_dia");       // 31 dias
    expect(s("2026-12-13")).toBe("proximo");      // 30 dias
    expect(s("2026-11-13")).toBe("proximo");      // vence hoje: ainda vale
    expect(s("2026-11-12")).toBe("vencido");
    expect(s(null)).toBe("aguardando");
  });
  it("alerta de 15 dias, contando o dia do vencimento", () => {
    const a = (validade: string) => emAlerta(item({ data_validade: validade }), HOJE);
    expect(a("2026-11-28")).toBe(true);
    expect(a("2026-11-29")).toBe(false);
    expect(a("2026-11-13")).toBe(true);
    expect(a("2026-11-12")).toBe(false);          // vencido não é alerta, é pendência
  });
});

describe("painel", () => {
  const itens = [
    item({ data_validade: "2028-01-01" }), item({ data_validade: "2026-11-20" }), item({ data_validade: "2026-10-01" }),
    item({ data_validade: null }), item({ data_validade: null, precisa_exame: false }), item({ data_validade: "2026-01-01", desligado: true }),
  ];
  const conta = (chave: string) => {
    const ind = INDICADORES.find((i) => i.chave === chave)!;
    return itens.filter(contaNoPainel).filter((i) => ind.filtro(i, HOJE)).length;
  };
  it("quem não precisa e quem saiu da empresa ficam fora", () => expect(conta("total")).toBe(4));
  it("as quatro situações somam o total", () => {
    expect([conta("em_dia"), conta("proximo"), conta("vencido"), conta("aguardando")]).toEqual([1, 1, 1, 1]);
  });
  it("ordem: vencido, alerta, próximo, sem exame, em dia, e por último quem não conta", () => {
    const ord = [
      item({ nome: "fora", precisa_exame: false }), item({ nome: "em dia", data_validade: "2028-01-01" }),
      item({ nome: "sem exame", data_validade: null }), item({ nome: "próximo", data_validade: "2026-12-10" }),
      item({ nome: "alerta", data_validade: "2026-11-20" }), item({ nome: "vencido", data_validade: "2026-10-01" }),
    ].sort((a, b) => prioridade(a, HOJE) - prioridade(b, HOJE)).map((i) => i.nome);
    expect(ord).toEqual(["vencido", "alerta", "próximo", "sem exame", "em dia", "fora"]);
  });
});

describe("datas", () => {
  it("validade sugerida: 24 meses, e 29/02 vira 28/02", () => {
    expect(validadeSugerida("2026-11-13")).toBe("2028-11-13");
    expect(validadeSugerida("2028-02-29")).toBe("2030-02-28");
    expect(somarMeses("2026-01-31", 1)).toBe("2026-02-28");
    expect(somarMeses("2026-03-15", -24)).toBe("2024-03-15");
  });
  it("célula: número de série do Excel, dd/mm/aaaa e o que não é data", () => {
    expect(dataDaCelula(46337)).toBe("2026-11-11");   // série do Excel
    expect(dataDaCelula("05/03/2027")).toBe("2027-03-05");
    expect(dataDaCelula("05/03/27")).toBe("2027-03-05");
    expect(dataDaCelula("")).toBeNull();
    expect(dataDaCelula("S/TOXIC")).toBeUndefined();
    expect(dataDaCelula("31/02/2027")).toBeUndefined();
  });
  it("cobrança anotada: com ano de 4 dígitos (já virou 2020), sem ano, e sem ano no futuro", () => {
    expect(cobrancaDoTexto("COBRADO 11/11/2026", HOJE)).toBe("2026-11-11");
    expect(cobrancaDoTexto("(COBRADO 12/11 ESTV FÉRIAS)", HOJE)).toBe("2026-11-12");
    expect(cobrancaDoTexto("cobrada em 20/12", HOJE)).toBe("2025-12-20");
    expect(cobrancaDoTexto("LAB CENTRAL", HOJE)).toBeNull();
  });
  it("selo de cobrado some depois do exame novo", () => {
    expect(cobradoNoCiclo(item({ ultima_cobranca_em: "2026-11-11", data_validade: "2026-11-24" }))).toBe(true);
    expect(cobradoNoCiclo(item({ ultima_cobranca_em: "2026-11-11", data_ultimo_exame: "2026-11-20", data_validade: "2028-11-20" }))).toBe(false);
    expect(cobradoNoCiclo(item({ ultima_cobranca_em: null }))).toBe(false);
  });
});

describe("CNH e responsável da aba", () => {
  it("CNH normalizada", () => {
    expect(normCnh("D ")).toBe("D");
    expect(normCnh("ae")).toBe("AE");
    expect(normCnh("Z")).toBeNull();
    expect(normCnh("")).toBeNull();
  });
  it("responsável pelo nome da aba; aba com nome de contrato fica vazia", () => {
    expect(responsavelDaAba("EXAMES MOT FULANO", ["CAMPUS X"])).toBe("FULANO");
    expect(responsavelDaAba("EXAMES MOT ANA,BIA,CAIO", [])).toBe("ANA, BIA, CAIO");
    expect(responsavelDaAba("DORA COLETA DE LIXO", ["COLETA DE LIXO"])).toBe("DORA");
    expect(responsavelDaAba("UFXX", ["", "UFXX CAMPUS NORTE"])).toBe("");
  });
});

function montar(abas: Record<string, unknown[][]>): Uint8Array {
  const wb = XLSX.utils.book_new();
  for (const [nome, linhas] of Object.entries(abas)) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(linhas), nome);
  return new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer);
}
const CAB = ["Contrato", "Nome do Colaborador", "CPF", "Função", "Tipo de CNH", "Data do Último Exame", "Data de Vencimento", "Status", "Clínica / Laboratório", "Observações"];
const vazia = () => Array(10).fill("");

describe("lerPlanilhaToxicologico()", () => {
  const leitura = () => lerPlanilhaToxicologico(montar({
    "EXAMES MOT FULANO": [
      CAB,
      ["CAMPUS X / FROTA", "ANA TESTE", "100.000.000-01", "MOT CAT D", "D ", 45667, 46397, "EM DIA", "", ""],
      ["CAMPUS X / FROTA", "BIA TESTE", "100.000.000-02", "MOT CAT C", "C", "", 46336, "VENCIDO", "(COBRADO 12/11 ESTV FÉRIAS)", "NÃO ESTA NA LISTA DE PERIÓDICO"],
      ["CAMPUS X / FROTA", "CAIO TESTE", "100.000.000-03", "MOT CAT D", "D", 46411, 46411, "EM DIA", "", "DEMITIDO"],
      vazia(),
      ["", "", "", "MOTORISTA CAT B - NÃO PRECISAM TOXICOLÓGICO", "", "", "", "", "", ""],
      ["CAMPUS X / ADM", "DANI TESTE100.000.000-04", "", "MOT CAT B", "", "", "", "", "", ""],
    ],
    UFXX: [
      CAB,
      ["UFXX NORTE", "EDU TESTE", "100.000.000-05", "MOTORISTA", "AE", "", "S/TOXIC", "", "COBRADO 11/11/2026", ""],
      ["", "FABI TESTE", "", "MOT TRATORISTA", "", "", "", "", "", ""],
    ],
  }), HOJE);

  it("abas, seção de quem não precisa e responsável", () => {
    const { abas } = leitura();
    expect(abas).toEqual([
      { nome: "EXAMES MOT FULANO", linhas: 4, naoPrecisam: 1, responsavel: "FULANO" },
      { nome: "UFXX", linhas: 2, naoPrecisam: 0, responsavel: "" },
    ]);
  });

  it("datas pelo número de série; status da planilha ignorado", () => {
    const ana = leitura().linhas.find((l) => l.nome === "ANA TESTE")!;
    expect([ana.data_ultimo_exame, ana.data_validade, ana.categoria_cnh, ana.cpf]).toEqual(["2025-01-10", "2027-01-10", "D", "10000000001"]);
  });

  it("cobrança da coluna da clínica vira data e observação; DEMITIDO sai", () => {
    const { linhas } = leitura();
    const bia = linhas.find((l) => l.nome === "BIA TESTE")!;
    expect([bia.ultima_cobranca_em, bia.clinica, bia.observacao]).toEqual(["2026-11-12", null, "NÃO ESTA NA LISTA DE PERIÓDICO · (COBRADO 12/11 ESTV FÉRIAS)"]);
    expect(linhas.find((l) => l.nome === "EDU TESTE")!.ultima_cobranca_em).toBe("2026-11-11");
    expect(linhas.find((l) => l.nome === "CAIO TESTE")!.observacao).toBeNull();
  });

  it("último exame no futuro é descartado com aviso", () => {
    const caio = leitura().linhas.find((l) => l.nome === "CAIO TESTE")!;
    expect(caio.data_ultimo_exame).toBeNull();
    expect(caio.data_validade).toBe("2027-01-24");
    expect(caio.avisos[0]).toMatch(/futuro/);
  });

  it("CPF colado no nome é separado; seção CAT B ganha CNH B", () => {
    const dani = leitura().linhas.find((l) => l.nome === "DANI TESTE")!;
    expect([dani.cpf, dani.nao_precisa, dani.categoria_cnh]).toEqual(["10000000004", true, "B"]);
  });

  it("S/TOXIC não é data; sem CPF fica fora do envio", () => {
    const { linhas } = leitura();
    const edu = linhas.find((l) => l.nome === "EDU TESTE")!;
    expect(edu.data_validade).toBeNull();
    expect(edu.avisos[0]).toMatch(/S\/TOXIC/);
    const envio = linhasParaImportar(linhas, { "EXAMES MOT FULANO": "FULANO", UFXX: " " });
    expect(envio.map((l) => l.nome)).not.toContain("FABI TESTE");
    expect(envio).toHaveLength(5);
    expect(envio.find((l) => l.nome === "EDU TESTE")!.responsavel).toBeNull();
    expect(envio.find((l) => l.nome === "ANA TESTE")!.responsavel).toBe("FULANO");
  });
});
