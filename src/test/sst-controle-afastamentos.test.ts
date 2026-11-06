import { describe, expect, it } from "vitest";
import {
  INDICADORES, alertaRetorno, dataDoRetorno, diasAfastados, pendenciasDocumentais, possivelLimbo, prioridade,
  semContatoRecente, statusDoMotivo, type ControleItem,
} from "@/lib/sst/controleAfastamentos";

const HOJE = "2026-11-05";
const caso = (x: Partial<ControleItem> = {}): ControleItem => ({
  id: 1, empregado_id: 1, nome: "Pessoa", contrato_nome: "Contrato", filial_nome: null, funcao: "Servente", motivo: "Auxílio-doença",
  data_inicio: "2026-10-01", data_prevista_retorno: null, data_retorno_real: null, encerrado_em: null, status: "Auxílio-doença",
  ultimo_contato_em: "2026-11-01", ultimo_contato_obs: null, retorno_informado_em: null, comunicacao_beneficio: "Não se aplica",
  beneficio_encerrado_em: null, aposentado_afastado: false, aposentado_no_vinculo: false, aposentadoria_em: null,
  aso_necessario: false, aso_solicitado_em: null, aso_agendado_em: null, aso_clinica: null, aso_realizado: false, aso_recebido_em: null,
  aso_resultado: null, observacao: null, origem: "manual", senior_situacao: null, recursos: [], doc_categorias: ["inss"], ...x,
});
const conta = (chave: string, itens: ControleItem[]) => {
  const ind = INDICADORES.find((i) => i.chave === chave)!;
  return itens.filter((a) => ind.filtro(a, HOJE)).length;
};

describe("dias afastados", () => {
  it("conta o primeiro dia e segue até hoje", () => expect(diasAfastados(caso({ data_inicio: "2026-11-01" }), HOJE)).toBe(5));
  it("o dia do retorno não conta", () => expect(diasAfastados(caso({ data_inicio: "2026-11-01", data_retorno_real: "2026-11-04" }), HOJE)).toBe(3));
  it("encerrado para de contar", () => expect(diasAfastados(caso({ data_inicio: "2026-10-01", encerrado_em: "2026-10-10" }), HOJE)).toBe(10));
  it("início futuro não fica negativo", () => expect(diasAfastados(caso({ data_inicio: "2026-12-01" }), HOJE)).toBe(0));
});

describe("alertas de retorno", () => {
  const com = (data: string) => alertaRetorno(caso({ data_prevista_retorno: data }), HOJE);
  it("nas três faixas", () => {
    expect(com("2026-11-13")).toBeNull();
    expect(com("2026-11-12")).toBe("7d");
    expect(com("2026-11-09")).toBe("7d");
    expect(com("2026-11-08")).toBe("3d");
    expect(com("2026-11-06")).toBe("3d");
    expect(com("2026-11-05")).toBe("atingida");
    expect(com("2026-10-20")).toBe("atingida");
  });
  it("sem previsão, vale a data informada no contato", () => {
    const a = caso({ retorno_informado_em: "2026-11-07" });
    expect(dataDoRetorno(a)).toBe("2026-11-07");
    expect(alertaRetorno(a, HOJE)).toBe("3d");
  });
  it("retornado não alerta", () => expect(alertaRetorno(caso({ status: "Retornado", data_prevista_retorno: "2026-11-01" }), HOJE)).toBeNull());
});

describe("contato", () => {
  it("nunca contatado ou há mais de 30 dias aparece", () => {
    expect(semContatoRecente(caso({ ultimo_contato_em: null }), HOJE)).toBe(true);
    expect(semContatoRecente(caso({ ultimo_contato_em: "2026-10-05" }), HOJE)).toBe(true);
    expect(semContatoRecente(caso({ ultimo_contato_em: "2026-10-06" }), HOJE)).toBe(false);
  });
  it("caso encerrado não cobra contato", () => expect(semContatoRecente(caso({ status: "Afastamento encerrado", ultimo_contato_em: null }), HOJE)).toBe(false));
});

describe("possível limbo", () => {
  it("benefício encerrado com retorno em aberto", () => expect(possivelLimbo(caso({ beneficio_encerrado_em: "2026-11-01" }), HOJE)).toContain("01/11/2026"));
  it("cita recurso e ação em andamento", () => {
    const m = possivelLimbo(caso({ beneficio_encerrado_em: "2026-11-01", recursos: [{ instancia: "inss", situacao: "em_andamento" }, { instancia: "judicial", situacao: "em_andamento" }] }), HOJE);
    expect(m).toContain("recurso ao INSS");
    expect(m).toContain("ação judicial");
  });
  it("não é limbo sem encerramento, antes da data ou depois do retorno", () => {
    expect(possivelLimbo(caso(), HOJE)).toBeNull();
    expect(possivelLimbo(caso({ beneficio_encerrado_em: "2026-12-01" }), HOJE)).toBeNull();
    expect(possivelLimbo(caso({ beneficio_encerrado_em: "2026-11-01", status: "Retornado" }), HOJE)).toBeNull();
  });
});

describe("pendências documentais", () => {
  it("nada pendente com o documento do afastamento", () => expect(pendenciasDocumentais(caso())).toEqual([]));
  it("sem nenhum documento do afastamento", () => expect(pendenciasDocumentais(caso({ doc_categorias: [] }))).toEqual(["Atestado ou documento do INSS"]));
  it("cobra o documento do que foi marcado", () => {
    expect(pendenciasDocumentais(caso({
      comunicacao_beneficio: "Recebida", aso_realizado: true, aposentado_no_vinculo: true,
      recursos: [{ instancia: "inss", situacao: "deferido" }, { instancia: "judicial", situacao: "em_andamento" }],
    }))).toHaveLength(5);
  });
  it("encerrado não tem pendência", () => expect(pendenciasDocumentais(caso({ status: "Afastamento encerrado", doc_categorias: [] }))).toEqual([]));
});

describe("indicadores", () => {
  it("cada um conta o seu", () => {
    const itens = [
      caso({ comunicacao_beneficio: "Aguardando" }),
      caso({ status: "Aguardando ASO de retorno", data_prevista_retorno: "2026-11-06" }),
      caso({ aposentado_afastado: true, doc_categorias: ["inss", "aposentadoria"] }),
      caso({ status: "Retornado", aposentado_no_vinculo: true, comunicacao_beneficio: "Aguardando", doc_categorias: ["inss", "aposentadoria"] }),
      caso({ beneficio_encerrado_em: "2026-11-01", recursos: [{ instancia: "inss", situacao: "em_andamento" }], doc_categorias: ["inss", "recurso_administrativo"] }),
      caso({ recursos: [{ instancia: "judicial", situacao: "encerrado" }], doc_categorias: [] }),
    ];
    expect(conta("afastados", itens)).toBe(5);
    expect(conta("retornos", itens)).toBe(1);
    expect(conta("aso", itens)).toBe(1);
    expect(conta("comunicacao", itens)).toBe(1);
    expect(conta("aposentados", itens)).toBe(1);
    expect(conta("aposentados_vinculo", itens)).toBe(1);
    expect(conta("inss", itens)).toBe(1);
    expect(conta("judicial", itens)).toBe(0);
    expect(conta("limbo", itens)).toBe(1);
    expect(conta("documentos", itens)).toBe(1);
  });
});

it("status inicial vem do motivo", () => {
  expect(statusDoMotivo("Licença-maternidade")).toBe("Licença-maternidade");
  expect(statusDoMotivo("Auxílio-doença")).toBe("Auxílio-doença");
  expect(statusDoMotivo("Acidente de trabalho")).toBe("Afastado");
});

it("limbo vem antes de retorno, e encerrado por último", () => {
  expect(prioridade(caso({ beneficio_encerrado_em: "2026-11-01" }), HOJE)).toBeLessThan(prioridade(caso({ data_prevista_retorno: "2026-11-01" }), HOJE));
  expect(prioridade(caso({ status: "Retornado" }), HOJE)).toBe(9);
});
