import { describe, expect, it } from "vitest";
import {
  calcularVencimento, contarPainel, diasParaVencer, erroConfig, erroMesesContrato, nomeContrato, ordenar,
  motivoAfastamento, ordenarAfastados, pendenciasParaRealizar, periodicidadeMeses, rotuloPeriodicidade, somarMeses,
  statusComAfastamento, statusPeriodico, casaBusca, contaNoPainel, empresaDoItem, funcaoDoItem, type ItemPeriodico,
} from "@/lib/sst/asoPeriodico";
import { ehMEI } from "@/lib/rh/mei";

const HOJE = "2026-11-14";
const item = (x: Partial<ItemPeriodico> = {}): ItemPeriodico => ({
  cpf: "11111111111", empregado_id: 1, nome: "Pessoa", situacao: "Trabalhando", filial_nome: null, contrato_nome: "UFRGS - LIMPEZA",
  cargo: "Servente", admissao: "2020-01-01", ultimo_aso: "2025-06-01", ultimo_tipo: "admissional", periodicidade_meses: 24,
  vencimento: "2027-06-01", status: "Em dia", ciclo: null, ultimo_periodico: null, ...x,
});

describe("periodicidade por contrato (configuração, SIS-2026-0918)", () => {
  const config = [
    { contrato_id: "uffs", periodicidade_meses: 12 },  // semente da migration
    { contrato_id: "ufrgs", periodicidade_meses: null }, // listado, sem periodicidade própria
    { contrato_id: "semestral", periodicidade_meses: 6 },
  ];
  it("contrato configurado usa a dele", () => {
    expect(periodicidadeMeses("uffs", config)).toBe(12);
    expect(periodicidadeMeses("semestral", config)).toBe(6);
  });
  it("sem configuração, sem contrato ou contrato desconhecido: o padrão (2 anos)", () => {
    expect(periodicidadeMeses("ufrgs", config)).toBe(24);
    expect(periodicidadeMeses("outro", config)).toBe(24);
    expect(periodicidadeMeses(null, config)).toBe(24);
    expect(periodicidadeMeses(undefined, [])).toBe(24);
  });
  it("o padrão também é configurável", () => {
    expect(periodicidadeMeses("ufrgs", config, 36)).toBe(36);
    expect(periodicidadeMeses("uffs", config, 36)).toBe(12);
  });
  it("não procura UFFS no nome: o nome não decide nada", () => {
    expect(periodicidadeMeses("UFFS - 041/2021", [])).toBe(24);
  });
  it("rótulo", () => {
    expect(rotuloPeriodicidade(12)).toBe("1 ano");
    expect(rotuloPeriodicidade(24)).toBe("2 anos");
    expect(rotuloPeriodicidade(6)).toBe("6 meses");
    expect(rotuloPeriodicidade(18)).toBe("18 meses");
    expect(rotuloPeriodicidade(1)).toBe("1 mês");
  });
  it("validação da configuração (faixas dos CHECKs do banco)", () => {
    expect(erroConfig(60, 24)).toBeNull();
    expect(erroConfig(0, 24)).toMatch(/Dias de aviso/);
    expect(erroConfig(366, 24)).toMatch(/Dias de aviso/);
    expect(erroConfig(30.5, 24)).toMatch(/Dias de aviso/);
    expect(erroConfig(60, 0)).toMatch(/Periodicidade padrão/);
    expect(erroConfig(60, 61)).toMatch(/Periodicidade padrão/);
    expect(erroMesesContrato(12)).toBeNull();
    expect(erroMesesContrato(0)).not.toBeNull();
    expect(erroMesesContrato(Number.NaN)).not.toBeNull();
  });
});

describe("vencimento", () => {
  it("conta do último ASO", () => {
    expect(calcularVencimento("2025-11-14", 12)).toBe("2026-11-14");
    expect(calcularVencimento("2025-11-14", 24)).toBe("2027-11-14");
  });
  it("sem ASO, sem vencimento", () => expect(calcularVencimento(null, 24)).toBeNull());
  it("29/02 cai em 28/02, como no Postgres", () => {
    expect(somarMeses("2024-02-29", 12)).toBe("2025-02-28");
    expect(somarMeses("2024-02-29", 24)).toBe("2026-02-28");
    expect(somarMeses("2025-12-31", 2)).toBe("2026-02-28");
  });
  it("dias para vencer", () => {
    expect(diasParaVencer(item({ vencimento: "2026-11-24" }), HOJE)).toBe(10);
    expect(diasParaVencer(item({ vencimento: "2026-11-04" }), HOJE)).toBe(-10);
    expect(diasParaVencer(item({ vencimento: null }), HOJE)).toBeNull();
  });
});

describe("status", () => {
  const st = (x: Partial<ItemPeriodico>) => statusPeriodico(item(x), HOJE);
  it("vencido e próximo do vencimento (60 dias)", () => {
    expect(st({ vencimento: "2026-11-13" })).toBe("Vencido");
    expect(st({ vencimento: "2026-11-14" })).toBe("Próximo do vencimento");
    expect(st({ vencimento: "2027-01-13" })).toBe("Próximo do vencimento");
    expect(st({ vencimento: "2027-01-14" })).toBe("Em dia");
  });
  it("ciclo aberto manda no status, mesmo vencido", () => {
    const ciclo = { id: 1, agendado_para: null } as unknown as ItemPeriodico["ciclo"];
    expect(st({ vencimento: "2026-01-01", ciclo })).toBe("Aguardando agendamento");
    expect(st({ vencimento: "2026-01-01", ciclo: { ...ciclo!, agendado_para: "2026-11-20" } })).toBe("Agendado");
  });
  it("periódico feito e longe do vencimento = realizado/recebido", () => {
    expect(st({ ultimo_tipo: "periodico", vencimento: "2027-11-14" })).toBe("Realizado/recebido");
    expect(st({ ultimo_tipo: "periodico", vencimento: "2026-12-01" })).toBe("Próximo do vencimento");
  });
  it("sem nenhuma data", () => expect(st({ vencimento: null, ultimo_aso: null })).toBe("Sem ASO"));
  it("janela de aviso configurável", () => {
    const v = item({ vencimento: "2027-01-01" }); // 48 dias depois de HOJE
    expect(statusPeriodico(v, HOJE, 30)).toBe("Em dia");
    expect(statusPeriodico(v, HOJE, 48)).toBe("Próximo do vencimento");
    expect(statusPeriodico(v, HOJE, 90)).toBe("Próximo do vencimento");
    expect(statusPeriodico(item({ vencimento: "2026-11-13" }), HOJE, 1)).toBe("Vencido");
  });
  it("UFFS (12 meses) e demais (24) a partir do mesmo último ASO", () => {
    const ultimo = "2025-12-01";
    const uffs = item({ ultimo_aso: ultimo, vencimento: calcularVencimento(ultimo, 12) });
    const outro = item({ ultimo_aso: ultimo, vencimento: calcularVencimento(ultimo, 24) });
    expect(statusPeriodico(uffs, HOJE)).toBe("Próximo do vencimento");
    expect(statusPeriodico(outro, HOJE)).toBe("Em dia");
  });
});

describe("painel", () => {
  it("conta cada status e os previstos somam tudo que não está só em dia", () => {
    const itens = [
      item({ status: "Vencido" }), item({ status: "Vencido" }), item({ status: "Próximo do vencimento" }),
      item({ status: "Aguardando agendamento" }), item({ status: "Agendado" }), item({ status: "Realizado/recebido" }),
      item({ status: "Em dia" }), item({ status: "Sem ASO" }),
    ];
    expect(contarPainel(itens)).toEqual({ previstos: 6, proximos: 1, vencidos: 2, aguardando: 1, agendados: 1, realizados: 1, afastados: 0 });
  });
});

describe("lista", () => {
  it("vencido primeiro, depois o vencimento mais próximo", () => {
    const l = [
      item({ nome: "C", status: "Em dia", vencimento: "2027-01-01" }),
      item({ nome: "B", status: "Próximo do vencimento", vencimento: "2026-12-20" }),
      item({ nome: "A", status: "Próximo do vencimento", vencimento: "2026-12-01" }),
      item({ nome: "D", status: "Vencido", vencimento: "2026-01-01" }),
    ].sort(ordenar);
    expect(l.map((i) => i.nome)).toEqual(["D", "A", "B", "C"]);
  });
  it("contrato: o do depara, senão a filial", () => {
    expect(nomeContrato(item({ contrato_nome: "UFFS", filial_nome: "F" }))).toBe("UFFS");
    expect(nomeContrato(item({ contrato_nome: null, filial_nome: "F" }))).toBe("F");
    expect(nomeContrato(item({ contrato_nome: null, filial_nome: null }))).toBe("Sem contrato");
  });
});

describe("marcar realizado/recebido", () => {
  it("pede data e resultado", () => {
    expect(pendenciasParaRealizar({}, HOJE)).toEqual(["data da realização", "resultado (apto ou inapto)"]);
    expect(pendenciasParaRealizar({ realizado_em: "2026-11-15", resultado: "apto" }, HOJE)).toEqual(["data da realização não pode ser futura"]);
    expect(pendenciasParaRealizar({ realizado_em: HOJE, resultado: "inapto" }, HOJE)).toEqual([]);
  });
});

// SIS-2026-0886 (mig 20261119190000): afastados por aposentadoria, benefício
// do INSS ou licença-maternidade saem das pendências; férias continuam.
describe("afastados fora das pendências (SIS-2026-0886)", () => {
  it("cada motivo pedido é reconhecido pela situação da Senior", () => {
    expect(motivoAfastamento("Aposentadoria por Invalidez")).toBe("aposentadoria");
    expect(motivoAfastamento("Aposentado")).toBe("aposentadoria");
    expect(motivoAfastamento("Auxílio Doença")).toBe("beneficio_inss");
    expect(motivoAfastamento("Aux. Doença Previdenciário")).toBe("beneficio_inss");
    expect(motivoAfastamento("Acidente de Trabalho")).toBe("beneficio_inss");
    expect(motivoAfastamento("Afastamento INSS")).toBe("beneficio_inss");
    expect(motivoAfastamento("Licença Maternidade")).toBe("licenca_maternidade");
    expect(motivoAfastamento("Prorrogação Licença Maternidade")).toBe("licenca_maternidade");
  });
  it("férias, atestado, doença até 15 dias, paternidade, aviso e trabalhando continuam no periódico", () => {
    for (const s of ["Férias", "FERIAS", "Atestado Médico", "Doença até 15 dias", "Licença Paternidade",
      "Licença sem Remuneração", "Aviso Prévio", "Trabalhando", "", null, "Demitido", "Pedido Rescisão Indireta"]) {
      expect(motivoAfastamento(s)).toBeNull();
    }
  });
  it("afastado sai de vencido, próximo, aguardando, em dia e sem ASO", () => {
    for (const s of ["Vencido", "Próximo do vencimento", "Aguardando agendamento", "Em dia", "Sem ASO"] as const) {
      expect(statusComAfastamento(s, true)).toBe("Afastado");
    }
  });
  it("agendado e realizado de um afastado continuam no status deles", () => {
    expect(statusComAfastamento("Agendado", true)).toBe("Agendado");
    expect(statusComAfastamento("Realizado/recebido", true)).toBe("Realizado/recebido");
  });
  it("fim do afastamento: sem afastamento, volta ao status calculado (nada gravado)", () => {
    const vencido = { vencimento: "2026-01-01", ultimo_tipo: "admissional" as const, ciclo: null };
    expect(statusComAfastamento(statusPeriodico(vencido, HOJE), true)).toBe("Afastado");
    expect(statusComAfastamento(statusPeriodico(vencido, HOJE), false)).toBe("Vencido");
    // ciclo solicitado durante o afastamento reaparece como aguardando no retorno
    const comCiclo = { ...vencido, ciclo: { agendado_para: null } };
    expect(statusComAfastamento(statusPeriodico(comCiclo, HOJE), true)).toBe("Afastado");
    expect(statusComAfastamento(statusPeriodico(comCiclo, HOJE), false)).toBe("Aguardando agendamento");
  });
  it("painel: afastado não conta em nada dos periódicos, só no cartão de afastados (SIS-2026-0918, 19/11)", () => {
    const af = { motivo: "beneficio_inss" as const, situacao: "Auxílio Doença", desde: "2026-03-01", previsao_retorno: null, fonte: "senior" as const };
    const p = contarPainel([
      item({ status: "Vencido" }),
      item({ status: "Afastado", afastamento: af }),
      item({ status: "Agendado", afastamento: af }),
      item({ status: "Realizado/recebido", afastamento: { ...af, motivo: "aposentadoria" as const } }),
      item({ status: "Próximo do vencimento" }),
    ]);
    expect(p.vencidos).toBe(1);
    expect(p.proximos).toBe(1);
    expect(p.agendados).toBe(0);  // agendado, mas afastado: fora da contagem
    expect(p.realizados).toBe(0); // idem
    expect(p.previstos).toBe(2);  // só vencido + próximo
    expect(p.afastados).toBe(3);
    expect(contaNoPainel(item({ afastamento: af }))).toBe(false);
    expect(contaNoPainel(item())).toBe(true);
  });
  it("afastados: previsão de retorno mais próxima primeiro, sem previsão por último", () => {
    const af = (previsao_retorno: string | null) => ({ motivo: "licenca_maternidade" as const, situacao: null, desde: null, previsao_retorno, fonte: "controle_afastamentos" as const });
    const l = [item({ nome: "C", afastamento: af(null) }), item({ nome: "B", afastamento: af("2027-02-01") }), item({ nome: "A", afastamento: af("2026-12-10") })]
      .sort(ordenarAfastados).map((i) => i.nome);
    expect(l).toEqual(["A", "B", "C"]);
  });
});

// SIS-2026-0886 parte 2 (mig 20261119200000): função e empresa do vínculo.
describe("empresa e função na lista (SIS-2026-0886, parte 2)", () => {
  it("empresa pelo código da Senior, na régua das telas de RH", () => {
    expect(empresaDoItem({ empresa_codigo: "1", empresa_nome: "HAGG SERVICOS LTDA" })).toBe("HAGG");
    expect(empresaDoItem({ empresa_codigo: "2", empresa_nome: null })).toBe("SN");
    expect(empresaDoItem({ empresa_codigo: "3", empresa_nome: null })).toBe("CANAÃ");
    expect(empresaDoItem({ empresa_codigo: "5", empresa_nome: null })).toBe("NH");
  });
  it("sem código conhecido: cai no nome da empresa; sem nada, traço", () => {
    expect(empresaDoItem({ empresa_codigo: "9", empresa_nome: "NH SERVICOS" })).toBe("NH");
    expect(empresaDoItem({ empresa_codigo: "9", empresa_nome: "OUTRA LTDA" })).toBe("OUTRA LTDA");
    expect(empresaDoItem({ empresa_codigo: null, empresa_nome: null })).toBe("—");
    expect(empresaDoItem({})).toBe("—"); // RPC antiga, sem as chaves
  });
  it("função: o cargo da Senior, ou o aviso quando falta", () => {
    expect(funcaoDoItem({ cargo: "Servente" })).toBe("Servente");
    expect(funcaoDoItem({ cargo: null })).toBe("Sem função na Senior");
    expect(funcaoDoItem({ cargo: "  " })).toBe("Sem função na Senior");
  });
  it("busca acha por empresa (sigla ou nome) e por função", () => {
    const i = item({ nome: "Maria", cargo: "Copeira", empresa_codigo: "2", empresa_nome: "SN SERVICOS" });
    expect(casaBusca(i, "sn")).toBe(true);
    expect(casaBusca(i, "servicos")).toBe(true);
    expect(casaBusca(i, "copeira")).toBe(true);
    expect(casaBusca(i, "maria")).toBe(true);
    expect(casaBusca(i, "")).toBe(true);
    expect(casaBusca(i, "hagg")).toBe(false);
  });
});

// SIS-2026-0918 (19/11, mig 20261120150000): MEI sai da base do periódico.
// A função SQL sst_aso_per_eh_mei espelha esta régua do RH (lib/rh/mei.ts):
// sigla MEI como palavra inteira ou "MICROEMPREEND" numa coluna de tipo/categoria.
describe("MEI fora do periódico (SIS-2026-0918)", () => {
  it("reconhece o MEI pela régua do RH, a mesma da função SQL", () => {
    expect(ehMEI({ "TIPO DE CONTRATO": "MEI" })).toBe(true);
    expect(ehMEI({ "TIPO DE CONTRATO": "mei" })).toBe(true);
    expect(ehMEI({ "Descrição (Cat. eSocial)": "Contribuinte individual - Microempreendedor Individual" })).toBe(true);
    expect(ehMEI({ "TIPO DE CONTRATO": "CLT" })).toBe(false);
    expect(ehMEI({ "TIPO DE CONTRATO": null })).toBe(false);
    expect(ehMEI({ "TIPO DE CONTRATO": "COMEIA" })).toBe(false); // só a sigla inteira
  });
});
