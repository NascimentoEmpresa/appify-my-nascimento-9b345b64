// SST › Acidentes de Trabalho — SIS-2026-0889. A planilha abaixo reproduz, em
// memória, o formato da "PLANILHA DE ACIDENTES.xlsx" do SST (medido nela em
// 17/11/2026): aba de resumo antes, título e totais no alto da aba
// "Histórico de Acidentes", cabeçalho na linha 13, "TÍPICO"/"TIPICO"/"-",
// "NÃO " com espaço e a observação numa coluna sem nome. Nomes fictícios:
// o repositório é público.
import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import {
  COLUNAS_EXPORTACAO, afastamentoDoLegado, diasSemAcidente, filtrarAcidentes, FILTROS_INICIAIS, indicadores, legadoDoAfastamento,
  lerPlanilhaAcidentes, linhasParaImportar, pendenciasParaConcluir, planilhaExportacao, simNao, tipoDoTexto, type Acidente,
} from "@/lib/sst/acidentes";

const HOJE = "2026-11-17";
const acidente = (x: Partial<Acidente> = {}): Acidente => ({
  id: 1, empregado_id: 10, vinculado: true, nome: "PESSOA FICTICIA", cargo: null, situacao_senior: "Trabalhando", desligado: false,
  empresa: "NASCIMENTO", contrato_id: "c1", contrato_nome: "HU RIO GRANDE", contrato_texto: null, encarregado: null,
  data_acidente: "2026-11-02", tipo: "tipico", descricao: "Escorregou", houve_afastamento: false, dias_afastamento: null,
  encaminhado_inss: false, cat_emitida: true, numero_cat: "ID1", cat_motivo_sem: null, morte_invalidez: false, observacoes: null,
  afastamento_id: null, ctrl_afastamento_id: null, concluido: false, concluido_em: null, concluido_por: null, origem: "manual",
  created_at: "2026-11-02T10:00:00Z", documentos: 1, cat_anexada: true, ...x,
});

describe("a coluna ACIDENTE da planilha", () => {
  it("vira dois Sim/Não — e C/ AFASTAMENTO sozinho é COM INSS", () => {
    expect(afastamentoDoLegado("S/ AFASTAMENTO")).toEqual({ houve_afastamento: false, encaminhado_inss: false });
    expect(afastamentoDoLegado("C/ AFASTAMENTO S/ INSS")).toEqual({ houve_afastamento: true, encaminhado_inss: false });
    expect(afastamentoDoLegado("C/ AFASTAMENTO")).toEqual({ houve_afastamento: true, encaminhado_inss: true });
    expect(afastamentoDoLegado("c/afastamento s/inss")).toEqual({ houve_afastamento: true, encaminhado_inss: false });
    expect(afastamentoDoLegado("TALVEZ")).toBeNull();
  });
  it("e volta igual na exportação", () => {
    for (const v of ["S/ AFASTAMENTO", "C/ AFASTAMENTO S/ INSS", "C/ AFASTAMENTO"] as const) {
      expect(legadoDoAfastamento(afastamentoDoLegado(v)!)).toBe(v);
    }
  });
});

describe("tipo e sim/não", () => {
  it("TÍPICO, TIPICO e TRAJETO; traço é não informado", () => {
    expect(tipoDoTexto("TÍPICO")).toBe("tipico");
    expect(tipoDoTexto("TIPICO")).toBe("tipico");
    expect(tipoDoTexto("TRAJETO")).toBe("trajeto");
    expect(tipoDoTexto("-")).toBeNull();
    expect(tipoDoTexto("")).toBeNull();
    expect(tipoDoTexto("QUEDA")).toBeUndefined();
  });
  it('"NÃO " com espaço é não', () => {
    expect(simNao("NÃO ")).toBe(false);
    expect(simNao("SIM")).toBe(true);
    expect(simNao("")).toBeNull();
    expect(simNao("TALVEZ")).toBeUndefined();
  });
});

describe("pendências para concluir (mesma lista do banco)", () => {
  it("completo: nada falta", () => {
    expect(pendenciasParaConcluir(acidente(), true)).toEqual([]);
  });
  it("CAT emitida pede número e arquivo", () => {
    expect(pendenciasParaConcluir(acidente({ numero_cat: null }), false)).toEqual(["Informar o número da CAT", "Anexar o arquivo da CAT"]);
  });
  it("CAT não emitida pede o motivo, e não o arquivo", () => {
    expect(pendenciasParaConcluir(acidente({ cat_emitida: false, numero_cat: null }), false)).toEqual(["Informar o motivo de não ter emitido a CAT"]);
    expect(pendenciasParaConcluir(acidente({ cat_emitida: false, numero_cat: null, cat_motivo_sem: "Sem afastamento" }), false)).toEqual([]);
  });
  it("na ordem do banco", () => {
    const a = acidente({ vinculado: false, contrato_id: null, contrato_texto: " ", tipo: null, descricao: "", houve_afastamento: true,
      dias_afastamento: null, cat_emitida: null });
    expect(pendenciasParaConcluir(a, false)).toEqual([
      "Ligar o registro a um colaborador", "Informar o contrato", "Informar o tipo (típico ou trajeto)", "Descrever o ocorrido",
      "Informar os dias de afastamento", "Dizer se a CAT foi emitida",
    ]);
  });
  it("o contrato escrito na planilha conta como contrato", () => {
    expect(pendenciasParaConcluir(acidente({ contrato_id: null, contrato_texto: "FARROUPILHA" }), true)).toEqual([]);
  });
});

describe("filtros, indicadores e dias sem acidente", () => {
  const lista = [
    acidente({ id: 1, data_acidente: "2024-05-17", nome: "ANA FICTICIA", concluido: true }),
    acidente({ id: 2, data_acidente: "2025-02-01", nome: "BRUNO FICTICIO", houve_afastamento: true, dias_afastamento: 5, encaminhado_inss: true,
      contrato_id: null, contrato_nome: null, contrato_texto: "FARROUPILHA", vinculado: false }),
    acidente({ id: 3, data_acidente: "2026-11-14", nome: "CLÁUDIA FICTÍCIA", houve_afastamento: true, dias_afastamento: 2 }),
  ];
  it("período, contrato (inclusive o texto da planilha), nome sem acento e concluída", () => {
    const f = (x: Partial<typeof FILTROS_INICIAIS>) => filtrarAcidentes(lista, { ...FILTROS_INICIAIS, ...x }).map((a) => a.id);
    expect(f({})).toEqual([1, 2, 3]);
    expect(f({ de: "2025-01-01" })).toEqual([2, 3]);
    expect(f({ ate: "2025-02-01" })).toEqual([1, 2]);
    expect(f({ contrato: "FARROUPILHA" })).toEqual([2]);
    expect(f({ colaborador: "claudia" })).toEqual([3]);
    expect(f({ concluida: "sim" })).toEqual([1]);
    expect(f({ concluida: "nao" })).toEqual([2, 3]);
    expect(f({ soSemVinculo: true })).toEqual([2]);
  });
  it("indicadores somam o que está na lista", () => {
    expect(indicadores(lista)).toEqual({ total: 3, comAfastamento: 2, comInss: 1, diasAfastamento: 7, emAberto: 2, semVinculo: 1 });
  });
  it("dias sem acidente contam do último registrado (a planilha dizia 3 em 17/11)", () => {
    expect(diasSemAcidente(lista, HOJE)).toBe(3);
    expect(diasSemAcidente([], HOJE)).toBeNull();
  });
});

// ── A planilha ─────────────────────────────────────────────────────────
const serial = (iso: string) => (Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) - Date.UTC(1899, 11, 30)) / 86400000;
const CAB = ["EMPRESA", "CONTRATO", "ACIDENTE", "DATA DO ACIDENTE", "TIPO DE ACIDENTE", "Nº DE PESSOAS ENVOLVIDAS", "NOME DOS ENVOLVIDOS",
  "MOTIVO / CAUSA", "CAT", "Nº DA CAT", "MORTE / INVALIDEZ", "Coluna1", "Coluna2"];

function planilha(): Uint8Array {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["ACIDENTES POR EMPRESA"], ["EMPRESA", "QNT ACIDENTES"], ["NASCIMENTO", 27]]), "Planilha2");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ["PLANILHA DE CONTROLE DE ACIDENTES"], [], ["TOTAL DE ACIDENTES"], [], [5], [], ["DIAS SEM ACIDENTES"], [], [3], [], [], [],
    CAB,
    ["NASCIMENTO", "HU  RIO GRANDE", "S/ AFASTAMENTO", serial("2024-05-17"), "-", 1, "ANA FICTICIA", "-", "NÃO ", "", "", "", ""],
    ["SN", "FARROUPILHA", "C/ AFASTAMENTO S/ INSS", serial("2025-02-01"), "TÍPICO", 1, "BRUNO FICTICIO", "Cortou o dedo", "SIM", "ID1036", "", "", "SEGUNDO O MÉDICO"],
    ["NASCIMENTO", "UFRGS CENTRO", "C/ AFASTAMENTO", "14/11/2026", "TRAJETO", 2, "CARLA FICTICIA", "Caiu da moto", "SIM", "", "", "", ""],
    ["NH", "PREF. M. BENTO", "C/ AFASTAMENTO", "", "TIPICO", 1, "DIEGO SEM DATA", "x", "NÃO", "", "", "", ""],
    ["NH", "PREF. M. BENTO", "QUALQUER", serial("2026-01-10"), "QUEDA", 1, "ELISA FICTICIA", "x", "NÃO", "ID55", "SIM", "", ""],
    [],
  ]), "Histórico de Acidentes");
  return new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer);
}

describe("leitura da planilha do SST", () => {
  const l = lerPlanilhaAcidentes(planilha());
  it("acha a aba do histórico, pula o resumo e os totais", () => {
    expect(l.aba).toBe("Histórico de Acidentes");
    expect(l.linhas.map((x) => x.nome)).toEqual(["ANA FICTICIA", "BRUNO FICTICIO", "CARLA FICTICIA", "ELISA FICTICIA"]);
    expect(l.ignoradas).toEqual([{ linha: 17, nome: "DIEGO SEM DATA", motivo: "sem data do acidente" }]);
  });
  it("converte cada coluna", () => {
    const [ana, bruno, carla] = l.linhas;
    expect(ana).toMatchObject({ linha: 14, empresa: "NASCIMENTO", contrato: "HU RIO GRANDE", data_acidente: "2024-05-17", tipo: null,
      descricao: null, houve_afastamento: false, encaminhado_inss: false, cat_emitida: false, numero_cat: null, avisos: [] });
    expect(bruno).toMatchObject({ tipo: "tipico", houve_afastamento: true, encaminhado_inss: false, cat_emitida: true, numero_cat: "ID1036",
      observacoes: "SEGUNDO O MÉDICO" });
    expect(carla).toMatchObject({ data_acidente: "2026-11-14", tipo: "trajeto", encaminhado_inss: true, cat_emitida: true, numero_cat: null });
    expect(carla.avisos).toEqual(["CAT marcada SIM sem número: entra em aberto", '2 pessoas na mesma linha: entra só "CARLA FICTICIA"']);
  });
  it("avisa o que não reconheceu, sem perder a linha", () => {
    const elisa = l.linhas[3];
    expect(elisa).toMatchObject({ tipo: null, houve_afastamento: false, cat_emitida: true, numero_cat: "ID55", morte_invalidez: true });
    expect(elisa.avisos).toEqual([
      '"ACIDENTE" = "QUALQUER" não reconhecido: entra sem afastamento', 'Tipo "QUEDA" não reconhecido: fica em branco',
      "Tinha número de CAT: marcada como emitida",
    ]);
  });
  it("o envio ao banco não leva os avisos", () => {
    expect(linhasParaImportar(l.linhas)[0]).not.toHaveProperty("avisos");
  });
  it("arquivo sem a aba certa é recusado", () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["A", "B"]]), "X");
    expect(() => lerPlanilhaAcidentes(new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer))).toThrow(/NOME DOS ENVOLVIDOS/);
  });
});

describe("exportação no formato da planilha antiga", () => {
  const aoa = planilhaExportacao([
    acidente({ id: 2, data_acidente: "2026-11-14", tipo: "trajeto", houve_afastamento: true, encaminhado_inss: true, dias_afastamento: 4 }),
    acidente({ id: 1, data_acidente: "2024-05-17", tipo: null, descricao: null, cat_emitida: false, numero_cat: null, concluido: true,
      contrato_nome: null, contrato_texto: "HU  RIO GRANDE" }),
  ], HOJE);
  it("totais nas mesmas células e cabeçalho na linha 13", () => {
    expect(aoa[2]).toEqual(["TOTAL DE ACIDENTES"]);
    expect(aoa[4]).toEqual([2]);
    expect(aoa[6]).toEqual(["DIAS SEM ACIDENTES"]);
    expect(aoa[8]).toEqual([3]);
    expect(aoa[12]).toEqual([...COLUNAS_EXPORTACAO]);
    expect(COLUNAS_EXPORTACAO.slice(0, 11)).toEqual(CAB.slice(0, 11));
  });
  it("uma linha por acidente, do mais antigo, com os valores da planilha", () => {
    const [velho, novo] = aoa.slice(13);
    expect(velho.slice(0, 3)).toEqual(["NASCIMENTO", "HU  RIO GRANDE", "S/ AFASTAMENTO"]);
    expect((velho[3] as Date).getDate()).toBe(17);
    expect(velho.slice(4)).toEqual(["-", 1, "PESSOA FICTICIA", "-", "NÃO", "", "", "", "", "NÃO", "SIM", ""]);
    expect(novo[2]).toBe("C/ AFASTAMENTO");
    expect(novo[4]).toBe("TRAJETO");
    expect(novo.slice(8, 15)).toEqual(["SIM", "ID1", "", "", 4, "SIM", "NÃO"]);
  });
});
