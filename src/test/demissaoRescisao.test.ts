import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import {
  atualizarPelaPlanilha, casarComExistentes, casarComSolicitacoes, chavePlanilha, completarVazios, dataNoTexto, edicaoInicial, erroDatasRescisao,
  filtrarRescisoes, lerPlanilhaRescisao, meioNoTexto, montarLinhaRescisao, montarLinhasRescisao,
  normalizarHomologacao, normalizarStatusRescisao, normalizarTipoDesligamento, ordenarRescisoes,
  planilhaDasRescisoes, sugerirDataDemissao, pagamentoAtrasado, resumoPorStatus, patchDaCelula, patchProgramadas, patchTextoDocumento, rescisaoConcluida, demissaoCancelada, diasDesde, erroIdentificacao, sugerirDataPagamento, textoProgramadas, tipoPelaSolicitacao,
  TIPO_SJ_TRABALHADO, type LinhaPlanilhaRescisao, type RescisaoRH,
} from "@/lib/demissao/rescisao";
import type { SolicitacaoDemissao } from "@/lib/demissao/solicitacao";

const sol = (p: Partial<SolicitacaoDemissao>): SolicitacaoDemissao => ({
  id: 1, status: "Agendamento concluído", colaborador_nome: "FULANA DE TAL", colaborador_id: 10,
  contrato: "1109 - UFRGS", data_solicitacao: "2026-10-01", criado_em: "2026-10-01T10:00:00Z",
  motivo_solicitacao: null, modelo_aviso: null, data_aviso: null, rh_ultima_data_trabalhada: null,
  solicitante_nome: "Encarregado", ...p,
} as SolicitacaoDemissao);

const resc = (p: Partial<RescisaoRH>): RescisaoRH => ({
  id: 1, solicitacao_id: null, origem: "planilha", planilha_chave: null, empresa: null, matricula: null,
  colaborador_nome: null, contrato: null, data_recebimento: null, solicitado_por: null, homologacao: null,
  sst_ok: null, data_aviso: null, data_ultimo_dia: null, data_demissao: null, data_pagamento: null,
  tipo_desligamento: null, rescisao_programada: false, vales_programados: false, malote_data: null,
  malote_obs: null, envio_meio: null, envio_data: null, envio_obs: null, retorno_meio: null,
  retorno_data: null, retorno_obs: null, status_rescisao: null, observacao: null, atualizado_por: null,
  criado_em: null, atualizado_em: null, ...p,
});

describe("régua das datas (a da planilha)", () => {
  it("sem justa trabalhado: demissão = último dia + 7; os outros: o próprio último dia", () => {
    expect(sugerirDataDemissao("2025-12-25", TIPO_SJ_TRABALHADO)).toBe("2026-01-01");
    expect(sugerirDataDemissao("2026-01-03", "Término de contrato")).toBe("2026-01-03");
    expect(sugerirDataDemissao(null, TIPO_SJ_TRABALHADO)).toBeNull();
  });
  it("pagamento = demissão + 5, atravessando o mês", () => {
    expect(sugerirDataPagamento("2026-02-28")).toBe("2026-03-05");
    expect(sugerirDataPagamento(null)).toBeNull();
  });
  it("datas fora de ordem são barradas", () => {
    expect(erroDatasRescisao({ data_aviso: "2026-10-10", data_ultimo_dia: "2026-10-01", data_demissao: null, data_pagamento: null })).toMatch(/último dia/);
    expect(erroDatasRescisao({ data_aviso: null, data_ultimo_dia: "2026-10-10", data_demissao: "2026-10-17", data_pagamento: "2026-10-16" })).toMatch(/pagamento/);
    expect(erroDatasRescisao({ data_aviso: "2026-09-09", data_ultimo_dia: "2026-10-02", data_demissao: "2026-10-09", data_pagamento: "2026-10-14" })).toBeNull();
  });
});

describe("tipo de desligamento", () => {
  it("as escritas da planilha caem na lista fixa", () => {
    expect(normalizarTipoDesligamento("SEM JUSTA - TRABALHADO")).toBe(TIPO_SJ_TRABALHADO);
    expect(normalizarTipoDesligamento("SEM JUSTA TRABALHADO")).toBe(TIPO_SJ_TRABALHADO);
    expect(normalizarTipoDesligamento("SEM JUSTA - INDENIZADO ")).toBe("Sem justa causa - indenizado");
    expect(normalizarTipoDesligamento("SEM JUSTA - TRABALHADO ( ACORDO POR LEI )")).toBe("Acordo por lei");
    expect(normalizarTipoDesligamento("PEDIDO DE DEMISSAO ")).toBe("Pedido de demissão");
    expect(normalizarTipoDesligamento("PEDIDO DE DEMISSAO (VAI CUMPRIR AVISO)")).toBe("Pedido de demissão (vai cumprir aviso)");
    expect(normalizarTipoDesligamento("TERMINO ANTECIPADO PELO EMPREGADO")).toBe("Término antecipado pelo empregado");
    expect(normalizarTipoDesligamento("TERMINO ANTECIPADO PELA EMPRESA")).toBe("Término antecipado pela empresa");
    expect(normalizarTipoDesligamento("TERMINO DE CONTRATO JOVEM APRENDIZ")).toBe("Término de contrato - jovem aprendiz");
    expect(normalizarTipoDesligamento("TERMINO DE CONTRATO DE ESTÁGIO")).toBe("Término de contrato - estágio");
    expect(normalizarTipoDesligamento("RESCISAO COMPLEMENTAR-DISSISIO")).toBe("Rescisão complementar");
    expect(normalizarTipoDesligamento("RESCISAO POR JUSTA CAUSA")).toBe("Justa causa");
    expect(normalizarTipoDesligamento("RESCISAO INDIRETA - ACORDO JUDICIAL")).toBe("Rescisão indireta");
    expect(normalizarTipoDesligamento("RESCISAO POR MORTE")).toBe("Rescisão por morte");
    expect(normalizarTipoDesligamento("ABANDONO DE EMPREGO")).toBe("Abandono de emprego");
    expect(normalizarTipoDesligamento("xyz")).toBeNull();
  });
  it("a solicitação do encarregado sugere o tipo", () => {
    expect(tipoPelaSolicitacao({ motivo_solicitacao: "Desligamento sem justa causa", modelo_aviso: "Aviso Prévio Trabalhado" })).toBe(TIPO_SJ_TRABALHADO);
    expect(tipoPelaSolicitacao({ motivo_solicitacao: "Desligamento sem justa causa", modelo_aviso: "Aviso Prévio Indenizado" })).toBe("Sem justa causa - indenizado");
    expect(tipoPelaSolicitacao({ motivo_solicitacao: "Pedido de demissão pelo colaborador", modelo_aviso: "Aviso Prévio Trabalhado" })).toBe("Pedido de demissão (vai cumprir aviso)");
    expect(tipoPelaSolicitacao({ motivo_solicitacao: "Término de contrato de experiência", modelo_aviso: null })).toBe("Término de contrato");
    expect(tipoPelaSolicitacao({ motivo_solicitacao: "Outro", modelo_aviso: null })).toBeNull();
  });
});

describe("textos da planilha", () => {
  it("homologação e status", () => {
    expect(normalizarHomologacao("NÃO")).toBe("Não");
    expect(normalizarHomologacao("CARTA NÃO HOMO")).toBe("Carta não homo");
    expect(normalizarHomologacao("AGUARDANDO CARTA")).toBe("Aguardando carta");
    expect(normalizarHomologacao("REALIZADO")).toBe("Realizado");
    expect(normalizarHomologacao("SIM/FEZ CARTA ")).toBe("Sim");
    expect(normalizarStatusRescisao("RESCISÃO E DOCUMENTOS OK")).toBe("Rescisão e documentos OK");
    expect(normalizarStatusRescisao("RESCISÃO OK")).toBe("Rescisão OK");
    expect(normalizarStatusRescisao("RESCISÃO POR FAZER")).toBe("Rescisão por fazer");
    expect(normalizarStatusRescisao("RESCISÃO FEITA")).toBe("Rescisão feita");
    expect(normalizarStatusRescisao("ENCAMINHADO AO INSS")).toBe("Encaminhado ao INSS");
  });
  it("meio e data do envio/retorno, com os erros de digitação", () => {
    expect(meioNoTexto("ENVIADO ZAPSING - 09/01/2026", "envio")).toBe("ZapSign");
    expect(meioNoTexto("RETORNOU ZAPISGN - 13/01/2026", "retorno")).toBe("ZapSign");
    expect(meioNoTexto("IMNPRESSO   GUSTAVO BARCELOS", "envio")).toBe("Impresso");
    expect(meioNoTexto("RETORNOU FÍSICO - 07/01/2026", "retorno")).toBe("Físico");
    expect(meioNoTexto("ENVIADO EMAIL JESSICA DIA 10/02", "envio")).toBe("E-mail");
    expect(dataNoTexto("ENVIADO ZAPSIGN - 18/09/2026")).toBe("2026-09-18");
    expect(dataNoTexto("malote 20/11/24")).toBe("2024-11-20");
    expect(dataNoTexto("MALOTE 26/07", 2026)).toBe("2026-07-26");
    expect(dataNoTexto("BULLLA OK", 2026)).toBeNull();
  });
});

describe("ler a planilha", () => {
  const montar = () => {
    const ws = XLSX.utils.aoa_to_sheet([
      [null, " EMPRESA ", " MAT ", " FUNCIONARIO ", " CONTRATO ", " HOMOLOGAÇÃO  ", " PLANILHA SST ", " AVISO ", " SOLICITADO POR ", "ULTIMO DIA", " DEMISSÃO ", " PAGAMENTO ", " TIPO DE DESL ", " PROGRAMADAS ", " MALOTE ", " ENVIO DA DOCUMENTAÇÃO ", " RETORNO DA DOCUMENTAÇÃO ", " STATUS. ", " OBSERVAÇÃO "],
      [new Date(2025, 11, 2), "HAGG", 8736, "MARIA TESTE", "BENTO", "NÃO", "OK", new Date(2025, 11, 3), "SURVEY MONKEY", new Date(2025, 11, 26), new Date(2026, 0, 2), new Date(2026, 0, 7), "SEM JUSTA - TRABALHADO", "RESCISÃO E VALES OK", "RESCISAO E FGTS MALOTE 09/01/2026", "ENVIADO ZAPSING - 09/01/2026", null, "RESCISÃO E DOCUMENTOS OK", null],
      [new Date(2025, 11, 2), "HAGG", 8736, "MARIA TESTE", "BENTO", "NÃO", "OK", new Date(2025, 11, 3), "SURVEY MONKEY", new Date(2025, 11, 26), new Date(2026, 0, 2), new Date(2026, 0, 7), "SEM JUSTA - TRABALHADO", "RESCISÃO E VALES OK", null, null, null, "RESCISÃO OK", null],
      [null, "SN", 55, "JOAO (OBS NO NOME)", "TJ", "CARTA NÃO HOMO", "NÃO", null, "ERP NASCIMENTO", new Date(2026, 9, 1), new Date(2026, 9, 1), new Date(2026, 9, 6), "TIPO ESTRANHO", null, null, null, null, "RESCISÃO POR FAZER", "ver ponto"],
    ], { cellDates: true });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "RESCISÕES");
    return XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  };

  it("lê colunas, datas, programadas e documentação; repetida entra uma vez", () => {
    const { linhas, avisos, aba } = lerPlanilhaRescisao(montar());
    expect(aba).toBe("RESCISÕES");
    expect(linhas).toHaveLength(2);
    const [m, j] = linhas;
    expect(m).toMatchObject({
      empresa: "HAGG", matricula: "8736", colaborador_nome: "MARIA TESTE", homologacao: "Não", sst_ok: true,
      data_recebimento: "2025-12-02", data_aviso: "2025-12-03", data_ultimo_dia: "2025-12-26",
      data_demissao: "2026-01-02", data_pagamento: "2026-01-07", tipo_desligamento: TIPO_SJ_TRABALHADO,
      rescisao_programada: true, vales_programados: true, malote_data: "2026-01-09",
      envio_meio: "ZapSign", envio_data: "2026-01-09", status_rescisao: "Rescisão e documentos OK",
    });
    expect(j.tipo_desligamento).toBeNull();
    expect(j.observacao).toContain("Tipo na planilha: TIPO ESTRANHO");
    expect(j.sst_ok).toBe(false);
    expect(j.rescisao_programada).toBe(false);
    expect(avisos.some((a) => a.includes("repetidas"))).toBe(true);
  });
});

describe("importação: casar e completar", () => {
  const linha = (p: Partial<LinhaPlanilhaRescisao>): LinhaPlanilhaRescisao => {
    const l = {
      chave: "", empresa: "HAGG", matricula: "100", colaborador_nome: "FULANA DE TAL", contrato: null,
      data_recebimento: "2026-10-02", solicitado_por: "ERP NASCIMENTO", homologacao: "Não", sst_ok: true,
      data_aviso: null, data_ultimo_dia: null, data_demissao: "2026-10-20", data_pagamento: "2026-10-25",
      tipo_desligamento: null, rescisao_programada: true, vales_programados: true, malote_data: null,
      malote_obs: null, envio_meio: null, envio_data: null, envio_obs: null, retorno_meio: null,
      retorno_data: null, retorno_obs: null, status_rescisao: "Rescisão OK", observacao: null, ...p,
    } as LinhaPlanilhaRescisao;
    l.chave = chavePlanilha(l);
    return l;
  };

  it("casa pela matrícula; sem ela, pelo nome; cada solicitação uma vez só", () => {
    const empregados = new Map([[10, { empresa: "HAGG", matricula: "100" }]]);
    const sols = [sol({ id: 1, colaborador_id: 10, colaborador_nome: "OUTRO NOME" }), sol({ id: 2, colaborador_id: 99, colaborador_nome: "Joana Silva" })];
    const a = linha({});
    const b = linha({ empresa: "SN", matricula: "7", colaborador_nome: "JOANA SILVA (INSS)" });
    const c = linha({ data_demissao: "2026-11-01" }); // complementar da mesma pessoa
    const r = casarComSolicitacoes([a, b, c], sols, empregados);
    expect(r.get(a.chave)).toBe(1);
    expect(r.get(b.chave)).toBe(2);
    expect(r.has(c.chave)).toBe(false);
  });

  it("não casa com cancelada nem com a já vinculada", () => {
    const r = casarComSolicitacoes([linha({ matricula: null })], [sol({ id: 3, status: "Cancelada" }), sol({ id: 4 })], new Map(), new Set([4]));
    expect(r.size).toBe(0);
  });

  it("completa só o vazio — o que o RH lançou no sistema fica", () => {
    const atual = resc({ homologacao: "Sim", data_demissao: null, rescisao_programada: false, vales_programados: true });
    expect(completarVazios(atual, linha({}))).toEqual({
      data_demissao: "2026-10-20", data_pagamento: "2026-10-25", rescisao_programada: true, status_rescisao: "Rescisão OK",
    });
    expect(completarVazios(resc({ homologacao: "Não", data_demissao: "2026-10-20", data_pagamento: "2026-10-25", rescisao_programada: true, vales_programados: true, status_rescisao: "Rescisão feita" }), linha({}))).toBeNull();
  });
});

describe("a linha da tela", () => {
  it("solicitação sem ficha: sugere tipo e datas, status 'Rescisão por fazer', SST OK pelo status do fluxo", () => {
    const l = montarLinhaRescisao(sol({
      motivo_solicitacao: "Desligamento sem justa causa", modelo_aviso: "Aviso Prévio Trabalhado",
      data_aviso: "2026-09-09", rh_ultima_data_trabalhada: "2026-10-02",
    }), null, { empresa: "1", matricula: "8736" });
    expect(l).toMatchObject({
      origem: "erp", empresa: "HAGG", matricula: "8736", tipo: TIPO_SJ_TRABALHADO,
      ultimoDia: "2026-10-02", demissao: "2026-10-09", pagamento: "2026-10-14",
      statusRescisao: "Rescisão por fazer", sstOk: true,
    });
    expect(l.sugerido).toEqual({ aviso: true, ultimoDia: true, demissao: true, pagamento: true, tipo: true });
  });

  it("o gravado vence a sugestão", () => {
    const l = montarLinhaRescisao(sol({ rh_ultima_data_trabalhada: "2026-10-02" }), resc({ solicitacao_id: 1, origem: "erp", data_demissao: "2026-10-05", tipo_desligamento: "Pedido de demissão" }));
    expect(l.demissao).toBe("2026-10-05");
    expect(l.pagamento).toBe("2026-10-10");
    expect(l.sugerido.demissao).toBe(false);
    expect(l.sugerido.pagamento).toBe(true);
    expect(edicaoInicial(l).data_pagamento).toBe("2026-10-10");
  });

  it("a linha gravada manda: solicitação sem linha (o RH não liberou) não entra; cancelada depois fica sinalizada", () => {
    const linhas = montarLinhasRescisao(
      [sol({ id: 1, status: "Pendente RH" }), sol({ id: 3, status: "Cancelada" })],
      [resc({ id: 7, solicitacao_id: 3, origem: "erp" }), resc({ id: 8, colaborador_nome: "AVULSA", empresa: "SN" })],
    );
    expect(linhas.map((l) => l.chave)).toEqual(["s:3", "r:8"]);
    expect(demissaoCancelada(linhas[0])).toBe(true);
    expect(demissaoCancelada(linhas[1])).toBe(false);
    expect(linhas[1]).toMatchObject({ origem: "planilha", nome: "AVULSA", empresa: "SN" });
  });

  it("programadas: duas marcações viram o texto da planilha", () => {
    expect(textoProgramadas({ rescisaoProgramada: true, valesProgramados: true })).toBe("Rescisão e vales OK");
    expect(textoProgramadas({ rescisaoProgramada: true, valesProgramados: false })).toBe("Rescisão OK");
    expect(textoProgramadas({ rescisaoProgramada: false, valesProgramados: false })).toBe("");
  });

  it("filtra e ordena como a planilha", () => {
    const linhas = montarLinhasRescisao([], [
      resc({ id: 1, colaborador_nome: "B", empresa: "HAGG", data_pagamento: "2026-10-10", status_rescisao: "Rescisão OK", rescisao_programada: true, vales_programados: true }),
      resc({ id: 2, colaborador_nome: "A", empresa: "SN", data_pagamento: "2026-09-10", homologacao: "Sim" }),
      resc({ id: 3, colaborador_nome: "C", empresa: "HAGG" }),
    ]);
    expect(filtrarRescisoes(linhas, { empresa: "HAGG" }).map((l) => l.nome)).toEqual(["B", "C"]);
    expect(filtrarRescisoes(linhas, { mes: "2026-09", campoMes: "pagamento" }).map((l) => l.nome)).toEqual(["A"]);
    expect(filtrarRescisoes(linhas, { statusRescisao: "Rescisão por fazer" }).map((l) => l.nome)).toEqual(["A", "C"]);
    expect(filtrarRescisoes(linhas, { soNaoProgramadas: true }).map((l) => l.nome)).toEqual(["A", "C"]);
    expect(filtrarRescisoes(linhas, { homologacao: "Sim" }).map((l) => l.nome)).toEqual(["A"]);
    expect(ordenarRescisoes(linhas, "pagamento").map((l) => l.nome)).toEqual(["B", "A", "C"]);
    expect(ordenarRescisoes(linhas, "nome").map((l) => l.nome)).toEqual(["A", "B", "C"]);
  });

  it("exporta no layout da planilha", () => {
    const wb = planilhaDasRescisoes(montarLinhasRescisao([], [resc({ id: 1, colaborador_nome: "X", rescisao_programada: true, vales_programados: true, envio_meio: "ZapSign", envio_data: "2026-10-01" })]));
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets["RESCISÕES"]);
    expect(rows[0]["Funcionário"]).toBe("X");
    expect(rows[0]["Programadas"]).toBe("Rescisão e vales OK");
    expect(rows[0]["Envio da documentação"]).toBe("ZapSign - 01/10/2026");
    expect(rows[0]["Status"]).toBe("Rescisão por fazer");
  });
});

describe("módulo Rescisões (21/10/2026)", () => {
  const montarDuasAbas = () => {
    const rescisoes = XLSX.utils.aoa_to_sheet([
      [null, "EMPRESA", "MAT", "FUNCIONARIO", "CONTRATO", "HOMOLOGAÇÃO ", "PLANILHA SST", "AVISO", "SOLICITADO POR", "ULTIMO DIA", "DEMISSÃO", "PAGAMENTO", "TIPO DE DESL", "PROGRAMADAS", "MALOTE", "ENVIO DA DOCUMENTAÇÃO", "RETORNO DA DOCUMENTAÇÃO", "STATUS.", "OBSERVAÇÃO", "PONTOS AJUSTADOS?", "ADMISSÃO"],
      [new Date(2026, 9, 1), "HAGG", 10, "ANA (ENCAMINHADA AO INSS)", "UFRGS", "REALIZADO", "OK", null, "SURVEY MONKEY", new Date(2026, 9, 10), new Date(2026, 9, 17), new Date(2026, 9, 22), "SEM JUSTA - TRABALHADO ( ACORDO 40% )", "RESCISÃO E VALES OK", null, null, null, "RESCISÃO POR FAZER", null, "OK", new Date(2024, 0, 15)],
    ], { cellDates: true });
    const homolog = XLSX.utils.aoa_to_sheet([
      [null, null, null, null, "TOTAL"],
      [null, null, null, null, 1],
      ["EMPRESA", "MAT", "FUNCIONARIO", "CONTRATO", "HOMOLOGAÇÃO ", "AVISO", "SOLICITADO POR", "ULTIMO DIA", "DEMISSÃO", "PAGAMENTO", "TIPO DE DESL", "PROGRAMADAS", "MALOTE", "ENVIO DA DOCUMENTAÇÃO", "RETORNO DA DOCUMENTAÇÃO", "STATUS.", "OBSERVAÇÃO"],
      ["CANAA", 67, "TATIANE", "CANAA", "SIM", new Date(2025, 0, 10), "E-MAIL", new Date(2025, 1, 2), new Date(2025, 1, 9), new Date(2025, 1, 14), "SEM JUSTA - TRABALHADO", "RESCISÃO E VALES OK", "(vazio)", "(vazio)", "(vazio)", "RESCISÃO OK", "(vazio)"],
    ], { cellDates: true });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, rescisoes, "RESCISÕES");
    XLSX.utils.book_append_sheet(wb, homolog, "HOMOLOGAÇÃO");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["RESUMO DE STATUS", null]]), "RESUMO");
    return XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  };

  it("lê as duas abas e guarda a linha como está no Excel", () => {
    const { linhas, abas } = lerPlanilhaRescisao(montarDuasAbas());
    expect(abas).toEqual([{ aba: "RESCISÕES", linhas: 1 }, { aba: "HOMOLOGAÇÃO", linhas: 1 }]);
    const [ana, tati] = linhas;
    expect(ana.planilha_aba).toBe("RESCISÕES");
    expect(ana.pontos_ajustados).toBe("OK");
    expect(ana.data_admissao).toBe("2024-01-15");
    // O original é o texto da planilha, sem normalizar; datas em dd/mm/aaaa.
    expect(ana.planilha_original).toMatchObject({
      RECEBIDO: "01/10/2026", FUNCIONARIO: "ANA (ENCAMINHADA AO INSS)", "TIPO DE DESL": "SEM JUSTA - TRABALHADO ( ACORDO 40% )",
      PAGAMENTO: "22/10/2026", "STATUS.": "RESCISÃO POR FAZER", MAT: 10,
    });
    expect(ana.planilha_original).not.toHaveProperty("AVISO");
    expect(tati).toMatchObject({ planilha_aba: "HOMOLOGAÇÃO", empresa: "CANAA", data_recebimento: null, status_rescisao: "Rescisão OK", malote_obs: null });
    expect(tati.planilha_original["HOMOLOGAÇÃO"]).toBe("SIM");
  });

  it("completa a linha original de quem foi importado antes dela existir", () => {
    const { linhas } = lerPlanilhaRescisao(montarDuasAbas());
    const p = completarVazios(resc({ status_rescisao: "Rescisão por fazer", pontos_ajustados: null }), linhas[0]);
    expect(p?.planilha_original).toBeTruthy();
    expect(p?.planilha_aba).toBe("RESCISÕES");
    expect(p?.pontos_ajustados).toBe("OK");
    expect(completarVazios(resc({ planilha_original: { X: 1 }, pontos_ajustados: "OK", data_admissao: "2024-01-15", status_rescisao: "x", homologacao: "x", tipo_desligamento: "x", data_ultimo_dia: "x", data_demissao: "x", data_pagamento: "x", rescisao_programada: true, vales_programados: true }), linhas[0])).toBeNull();
  });

  it("pagamento vencido só conta com a rescisão por fazer; resumo conta por status", () => {
    const linhas = montarLinhasRescisao([], [
      resc({ id: 1, colaborador_nome: "A", data_pagamento: "2026-10-20", status_rescisao: "Rescisão por fazer" }),
      resc({ id: 2, colaborador_nome: "B", data_pagamento: "2026-10-20", status_rescisao: "Rescisão OK" }),
      resc({ id: 3, colaborador_nome: "C", data_pagamento: "2026-10-25" }),
    ]);
    expect(linhas.map((l) => pagamentoAtrasado(l, "2026-10-21"))).toEqual([true, false, false]);
    expect(filtrarRescisoes(linhas, { soAtrasadas: true }, "2026-10-21").map((l) => l.nome)).toEqual(["A"]);
    expect(resumoPorStatus(linhas)).toMatchObject({ "Rescisão por fazer": 2, "Rescisão OK": 1, "Rescisão feita": 0 });
  });

  it("documentação sem retorno e filtro de SST", () => {
    const linhas = montarLinhasRescisao([], [
      resc({ id: 1, colaborador_nome: "A", envio_meio: "ZapSign", sst_ok: true }),
      resc({ id: 2, colaborador_nome: "B", envio_meio: "ZapSign", retorno_meio: "ZapSign" }),
      resc({ id: 3, colaborador_nome: "C", sst_ok: false }),
    ]);
    expect(filtrarRescisoes(linhas, { soSemRetorno: true }).map((l) => l.nome)).toEqual(["A"]);
    expect(filtrarRescisoes(linhas, { sst: "ok" }).map((l) => l.nome)).toEqual(["A"]);
    expect(filtrarRescisoes(linhas, { sst: "pendente" }).map((l) => l.nome)).toEqual(["B", "C"]);
  });

  it("célula de status grava só o status", () => {
    const [l] = montarLinhasRescisao([], [resc({ id: 1, colaborador_nome: "A", status_rescisao: "Rescisão por fazer" })]);
    expect(patchDaCelula(l, { status_rescisao: "Rescisão feita" })).toEqual({ status_rescisao: "Rescisão feita" });
  });

  it("origem manual e dias na coluna", () => {
    const [m] = montarLinhasRescisao([], [resc({ origem: "manual", colaborador_nome: "Z", status_desde: "2026-10-18T12:00:00Z" })]);
    expect(m.origem).toBe("manual");
    expect(filtrarRescisoes([m], { origem: "manual" })).toHaveLength(1);
    expect(diasDesde(m.statusDesde, new Date("2026-10-21T12:00:00Z"))).toBe(3);
    expect(diasDesde(null)).toBeNull();
  });

  it("nova rescisão à mão: nome obrigatório, empresa da lista", () => {
    const base = { empresa: null, matricula: null, colaborador_nome: null, contrato: null, data_recebimento: null, solicitado_por: null };
    expect(erroIdentificacao(base)).toMatch(/nome/);
    expect(erroIdentificacao({ ...base, colaborador_nome: "X", empresa: "ACME" })).toMatch(/Empresa/);
    expect(erroIdentificacao({ ...base, colaborador_nome: "X", empresa: "SN" })).toBeNull();
  });

  it("exporta com a aba RESUMO e as colunas novas", () => {
    const wb = planilhaDasRescisoes(montarLinhasRescisao([], [resc({ id: 1, colaborador_nome: "X", pontos_ajustados: "OK" })]));
    expect(wb.SheetNames).toEqual(["RESCISÕES", "RESUMO"]);
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets["RESCISÕES"]);
    expect(rows[0]["Pontos ajustados?"]).toBe("OK");
    const resumo = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets["RESUMO"], { header: 1 });
    expect(resumo).toContainEqual(["Rescisão por fazer", 1]);
    expect(resumo).toContainEqual(["TOTAL", 1]);
  });
});

describe("Rescisões dentro do RH, a planilha (22/10/2026)", () => {
  it("os 10 status da lista suspensa do Excel", () => {
    expect(normalizarStatusRescisao("RESCISÃO URGENTE POR FAZER")).toBe("Rescisão urgente por fazer");
    expect(normalizarStatusRescisao("RECALCULAR")).toBe("Recalcular");
    expect(normalizarStatusRescisao("GUIA PENDENTE")).toBe("Guia pendente");
    expect(normalizarStatusRescisao("PENDENCIA")).toBe("Pendência");
    expect(normalizarStatusRescisao("FAZER VA")).toBe("Fazer VA");
    expect(normalizarStatusRescisao("ENCAMINHADO AO INSS")).toBe("Encaminhado ao INSS");
    expect(normalizarStatusRescisao("RESCISÃO E DOCUMENTOS OK")).toBe("Rescisão e documentos OK");
  });

  it("concluídas: só Rescisão OK e Rescisão e documentos OK", () => {
    expect(rescisaoConcluida("Rescisão OK")).toBe(true);
    expect(rescisaoConcluida("Rescisão e documentos OK")).toBe(true);
    expect(rescisaoConcluida("Rescisão feita")).toBe(false);
    expect(rescisaoConcluida("Encaminhado ao INSS")).toBe(false);
    expect(rescisaoConcluida(null)).toBe(false);
    const linhas = montarLinhasRescisao([], [
      resc({ id: 1, colaborador_nome: "A", status_rescisao: "Rescisão OK" }),
      resc({ id: 2, colaborador_nome: "B", status_rescisao: "Pendência" }),
      resc({ id: 3, colaborador_nome: "C", status_rescisao: "Rescisão e documentos OK" }),
    ]);
    expect(filtrarRescisoes(linhas, { situacao: "abertas" }).map((l) => l.nome)).toEqual(["B"]);
    expect(filtrarRescisoes(linhas, { situacao: "concluidas" }).map((l) => l.nome)).toEqual(["A", "C"]);
  });

  it("urgente e recalcular também atrasam o pagamento; guia pendente não", () => {
    const [u, r, g] = montarLinhasRescisao([], [
      resc({ id: 1, data_pagamento: "2026-10-20", status_rescisao: "Rescisão urgente por fazer" }),
      resc({ id: 2, data_pagamento: "2026-10-20", status_rescisao: "Recalcular" }),
      resc({ id: 3, data_pagamento: "2026-10-20", status_rescisao: "Guia pendente" }),
    ]);
    expect([u, r, g].map((l) => pagamentoAtrasado(l, "2026-10-21"))).toEqual([true, true, false]);
  });

  it("importar: a planilha vence o 'por fazer' que o gatilho pôs na linha do ERP, e só ele", () => {
    const linha = { ...lerPlanilhaRescisao(XLSX.write((() => {
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
        ["EMPRESA", "MAT", "FUNCIONARIO", "PAGAMENTO", "STATUS."],
        ["HAGG", 1, "X", null, "RESCISÃO OK"],
      ]), "RESCISÕES");
      return wb;
    })(), { type: "array", bookType: "xlsx" }) as ArrayBuffer).linhas[0] };
    expect(completarVazios(resc({ status_rescisao: "Rescisão por fazer" }), linha)?.status_rescisao).toBe("Rescisão OK");
    expect(completarVazios(resc({ status_rescisao: "Pendência" }), linha)?.status_rescisao).toBeUndefined();
  });

  it("mudar último dia ou tipo recalcula demissão e pagamento — se ninguém tinha digitado outra data", () => {
    const [l] = montarLinhasRescisao([], [resc({
      id: 1, tipo_desligamento: TIPO_SJ_TRABALHADO, data_ultimo_dia: "2026-10-10", data_demissao: "2026-10-17", data_pagamento: "2026-10-22",
    })]);
    expect(patchDaCelula(l, { data_ultimo_dia: "2026-10-20" })).toEqual({
      data_ultimo_dia: "2026-10-20", data_demissao: "2026-10-27", data_pagamento: "2026-11-01",
    });
    expect(patchDaCelula(l, { tipo_desligamento: "Pedido de demissão" })).toEqual({
      tipo_desligamento: "Pedido de demissão", data_demissao: "2026-10-10", data_pagamento: "2026-10-15",
    });
    expect(patchDaCelula(l, { data_demissao: "2026-10-18" })).toEqual({ data_demissao: "2026-10-18", data_pagamento: "2026-10-23" });
    // Demissão digitada à mão (fora da régua) não é atropelada.
    const [m] = montarLinhasRescisao([], [resc({
      id: 2, tipo_desligamento: TIPO_SJ_TRABALHADO, data_ultimo_dia: "2026-10-10", data_demissao: "2026-10-30", data_pagamento: "2026-11-04",
    })]);
    expect(patchDaCelula(m, { data_ultimo_dia: "2026-10-20" })).toEqual({ data_ultimo_dia: "2026-10-20" });
  });

  it("programadas e documentação: a célula de texto vira campo", () => {
    expect(patchProgramadas("Rescisão e vales OK")).toEqual({ rescisao_programada: true, vales_programados: true });
    expect(patchProgramadas("Vales OK")).toEqual({ rescisao_programada: false, vales_programados: true });
    expect(patchProgramadas("")).toEqual({ rescisao_programada: false, vales_programados: false });
    expect(patchTextoDocumento("envio", "ENVIADO ZAPSIGN - 09/01/2026")).toEqual({
      envio_obs: "ENVIADO ZAPSIGN - 09/01/2026", envio_data: "2026-01-09", envio_meio: "ZapSign",
    });
    expect(patchTextoDocumento("malote", "RESCISAO E FGTS MALOTE 05/01", 2026)).toEqual({
      malote_obs: "RESCISAO E FGTS MALOTE 05/01", malote_data: "2026-01-05",
    });
    expect(patchTextoDocumento("retorno", "  ")).toEqual({ retorno_obs: null, retorno_data: null, retorno_meio: null });
  });
});

describe("reimportar atualiza (28/10/2026)", () => {
  const linha = (p: Partial<LinhaPlanilhaRescisao>): LinhaPlanilhaRescisao => {
    const l = {
      chave: "", empresa: "HAGG", matricula: "100", colaborador_nome: "FULANA DE TAL", contrato: null,
      data_recebimento: null, solicitado_por: null, homologacao: null, sst_ok: null,
      data_aviso: null, data_ultimo_dia: null, data_demissao: "2026-10-20", data_pagamento: "2026-10-25",
      tipo_desligamento: null, rescisao_programada: false, vales_programados: false, malote_data: null,
      malote_obs: null, envio_meio: null, envio_data: null, envio_obs: null, retorno_meio: null,
      retorno_data: null, retorno_obs: null, status_rescisao: "Rescisão OK", observacao: null,
      pontos_ajustados: null, data_admissao: null, planilha_original: { FUNCIONARIO: "FULANA DE TAL", MAT: 100 }, planilha_aba: "RESCISÕES", ...p,
    } as LinhaPlanilhaRescisao;
    l.chave = chavePlanilha(l);
    return l;
  };

  it("a planilha vence o status e as datas que ela preenche; vazio dela não apaga; observação só completa", () => {
    const l = linha({ observacao: "da planilha", rescisao_programada: false });
    const r = atualizarPelaPlanilha(resc({
      planilha_chave: l.chave, status_rescisao: "Rescisão feita", data_demissao: "2026-10-20", data_pagamento: "2026-10-24",
      envio_obs: "ZAPSIGN 21/10", observacao: "do sistema", rescisao_programada: true,
      planilha_original: { MAT: 100, FUNCIONARIO: "FULANA DE TAL" },
    }), l);
    expect(r?.patch).toEqual({ status_rescisao: "Rescisão OK", data_pagamento: "2026-10-25" });
    expect(r?.mudancas).toContainEqual({ campo: "status_rescisao", de: "Rescisão feita", para: "Rescisão OK" });
  });

  it("igual à planilha (mesmo com o jsonb em outra ordem) não muda nada", () => {
    const l = linha({});
    expect(atualizarPelaPlanilha(resc({
      planilha_chave: l.chave, status_rescisao: "Rescisão OK", data_demissao: "2026-10-20", data_pagamento: "2026-10-25",
      planilha_original: { MAT: 100, FUNCIONARIO: "FULANA DE TAL" },
    }), l)).toBeNull();
  });

  it("data mudou no Excel: casa pela pessoa, não duplica; a complementar fica nova; empate é ambígua", () => {
    const antiga = linha({ data_pagamento: "2026-10-24" });
    const nova = linha({}); // pagamento corrigido para 25/10
    const compl = linha({ data_demissao: "2026-12-01", data_pagamento: "2026-12-06" });
    const r1 = casarComExistentes([nova, compl], [{ id: 7, planilha_chave: antiga.chave, data_demissao: "2026-10-20", data_pagamento: "2026-10-24" }]);
    expect(r1.casadas.get(nova.chave)).toBe(7);
    expect(r1.casadas.has(compl.chave)).toBe(false);
    expect(r1.ambiguas).toEqual([]);

    const semData = linha({ data_demissao: null, data_pagamento: null });
    const r2 = casarComExistentes([semData], [
      { id: 1, planilha_chave: antiga.chave, data_demissao: "2026-10-20", data_pagamento: null },
      { id: 2, planilha_chave: compl.chave, data_demissao: "2026-12-01", data_pagamento: null },
    ]);
    expect(r2.casadas.size).toBe(0);
    expect(r2.ambiguas).toHaveLength(1);
  });

  it("a chave exata vem antes da pessoa", () => {
    const a = linha({});
    const b = linha({ data_demissao: "2026-10-21", data_pagamento: "2026-10-26" });
    const r = casarComExistentes([b, a], [
      { id: 1, planilha_chave: a.chave, data_demissao: "2026-10-20", data_pagamento: "2026-10-25" },
      { id: 2, planilha_chave: chavePlanilha({ ...b, data_pagamento: "2026-10-27" }), data_demissao: "2026-10-21", data_pagamento: "2026-10-27" },
    ]);
    expect(r.casadas.get(a.chave)).toBe(1);
    expect(r.casadas.get(b.chave)).toBe(2);
  });
});
