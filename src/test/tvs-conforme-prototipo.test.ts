import { describe, expect, it } from "vitest";
import { aplicarNumerosDaTv, dadosDoGrafico, graficoDo, graficoDoPrototipo, relatoriosDaTv, situacao, type IndicadorGerencial, type PainelGerencial } from "@/lib/tv/gerencial";
import { cardsOpeGerencial, totaisOpe, type DadosOpeContratosTv } from "@/lib/tv/opeContratosTv";
import type { ContratoRpc } from "@/lib/operacional/indicadoresContratos";

// 14/11/2026 — Pablo: "todos gráficos das TVs estão assim [o protótipo], e os
// indicadores gerenciais das TVs têm que estar assim; as informações têm que
// bater". Dados fictícios.

// O tipo de gráfico de cada card no protótipo "TVs Gerenciais — 10 telas
// conforme o Word". Exceções conscientes: lic_prazo é lista (pedido de
// 14/10/2026) e os empilhados ficam em colunas até o cálculo mandar as faixas.
const PROTOTIPO: Record<string, string> = {
  op_postos: "agrupado", op_lucratividade: "combo", op_custo_direto: "colunas", op_glosas: "colunas", op_faltas: "linha", op_turnover: "linha", op_reclamacoes: "combo",
  lic_prazo: "lista", lic_documentos: "colunas", lic_propostas: "agrupado", lic_risco: "rosca", lic_implantacao: "colunas", lic_perdidas: "rosca", lic_valor: "colunas",
  sup_compras_vencidas: "colunas", sup_abaixo_minimo: "rosca", sup_valor_estoque: "colunas", sup_sem_mov: "colunas", sup_fornecedor: "colunas", sup_contratos_sem_entrega: "linha",
  rec_risco: "colunas", rec_abertas: "agrupado", rec_prazo: "colunas", rec_admissoes: "agrupado", rec_desistencias: "rosca",
  rh_quadro: "agrupado", rh_salarios: "colunas", rh_turnover: "linha", rh_absenteismo: "colunas", rh_obrigacoes: "colunas",
  sst_impedidos: "colunas", sst_aso: "rosca", sst_treinamentos: "colunas", sst_epi: "rosca", sst_afastamentos: "linha", sst_acidentes: "agrupado",
  fin_notas_pendentes: "colunas", fin_valor_pendente: "colunas", fin_recebimentos: "agrupado", fin_inadimplencia: "colunas", fin_fluxo: "linha", fin_glosas: "rosca",
  jur_prazos: "colunas", jur_sem_resposta: "colunas", jur_audiencias: "linha", jur_contratos_analise: "colunas", jur_risco: "rosca", jur_reincidentes: "colunas",
  ctl_margem: "agrupado", ctl_desvio: "colunas", ctl_vermelhos: "rosca", ctl_planos: "colunas", ctl_nao_atualizados: "colunas", ctl_reincidentes: "colunas",
  pre_lucratividade: "combo", pre_vermelhos: "rosca", pre_postos: "agrupado", pre_glosas: "colunas", pre_salarios: "colunas", pre_caixa: "colunas", pre_clientes: "colunas", pre_planos: "colunas",
};

const contrato = (id: string, nome: string, extra: Partial<ContratoRpc> = {}): ContratoRpc => ({
  id, nome, cliente: "CLIENTE FICTICIO", encerrado: false,
  postos: { contratados: 20, previsto: 20, implantado_registrado: true, cobertos: 20, afastados: 0 },
  efetivo: 20, demissoes: 0, atestados: { dias_pessoa: 0, pessoas: 0 },
  glosas: { valor: 0, qtd: 0, causa: null }, reclamacoes: { qtd: 0, causa: null },
  orcado: { custo_direto_por_mes: { "2026-09": 80_000 }, margem_prevista: 8 }, ...extra,
});

const ope: DadosOpeContratosTv = {
  competencia: "2026-09", de: "2026-09-01", ate: "2026-09-30", dias: 30,
  janela_notificacoes: { de: "2026-07-03", ate: "2026-09-30" }, gerado_em: "2026-11-11T12:00:00Z",
  contratos: [
    contrato("bom", "CONTRATO BOM - 001/2024"),
    contrato("ruim", "CONTRATO RUIM - 002/2024", {
      postos: { contratados: 20, previsto: 20, implantado_registrado: true, cobertos: 15, afastados: 1 },
      glosas: { valor: 5_000, qtd: 1, causa: "Posto descoberto" },
    }),
  ],
  sem_contrato: { glosas_valor: 0, glosas_qtd: 0, reclamacoes_qtd: 0 },
  financeiro: {
    competencia: "2026-09",
    receita: { bom: 100_000, ruim: 100_000 },
    custo_por_mes: { "bom|2026-09": 80_000, "ruim|2026-09": 95_000 },
    empresa: { liquido: 200_000, despesas: 175_000, lucro: 25_000, margem: 12.5 },
  },
};

const ind = (codigo: string, extra: Partial<IndicadorGerencial> = {}): IndicadorGerencial => ({
  codigo, nome: codigo, identificar: "", regra: null, fonte: "auto", unidade: "qtd", sentido: "menor", meta: null, alerta: null,
  periodicidade: "diaria", responsavel: "Gerência Operacional", pai: null, na_tv: true, ordem: 1, parametro: null, parametro_rotulo: null,
  espelho_de: null, resultado: { valor: 143, afetado: "outro", causa: "outra", detalhe: [] }, ...extra,
});

describe("TVs conforme o protótipo", () => {
  it("cada card dos 10 painéis tem o tipo de gráfico do protótipo", () => {
    for (const [codigo, tipo] of Object.entries(PROTOTIPO)) expect([codigo, graficoDoPrototipo(codigo)]).toEqual([codigo, tipo]);
    expect(Object.keys(PROTOTIPO)).toHaveLength(62);
  });

  it("agrupado sem as duas séries cai para colunas sem perder a unidade", () => {
    const g = graficoDo({ codigo: "lic_propostas", resultado: { valor: 3, detalhe: [{ nome: "Edital 1", valor: 4 }] } });
    expect(g).toEqual({ tipo: "colunas", unidade: "dias" });
  });

  it("Controladoria: margem atual × meta mínima, com a meta como segunda série", () => {
    const i = { codigo: "ctl_margem", meta: 10, resultado: { valor: 2, detalhe: [{ nome: "Contrato A", valor: 4 }] } };
    expect(graficoDo(i).tipo).toBe("agrupado");
    expect(dadosDoGrafico(i)[0]).toMatchObject({ nome: "Contrato A", a: 4, b: 10 });
  });
});

describe("Indicadores gerenciais = TV da Gerência Operacional", () => {
  it("os cards saem dos mesmos totais da TV", () => {
    const c = cardsOpeGerencial(ope);
    const t = totaisOpe(ope);
    expect(c.op_postos.valor).toBe(t.postos.pct);
    expect(c.op_postos.valor).toBe(87.5);
    expect(c.op_postos.detalhe[0]).toMatchObject({ nome: "CONTRATO RUIM - 002/2024", a: 20, b: 15 });
    expect(c.op_lucratividade.valor).toBe(12.5); // a do Faturamento da Empresa
    expect(c.op_glosas.valor).toBe(5_000);
    expect(c.op_glosas.causa).toBe("Posto descoberto");
  });

  it("aplicar troca valor, meta e semáforo, mas mantém nome, dono e medida do cadastro", () => {
    const p: PainelGerencial = { painel: null, indicadores: [ind("op_postos", { medida: "real" }), ind("lic_valor")] } as unknown as PainelGerencial;
    const r = aplicarNumerosDaTv(p, cardsOpeGerencial(ope), "TV Gerência Operacional");
    const postos = r.indicadores.find((i) => i.codigo === "op_postos")!;
    expect(postos).toMatchObject({ unidade: "pct", sentido: "maior", meta: 100, responsavel: "Gerência Operacional", medida: "real" });
    expect(postos.resultado.valor).toBe(87.5);
    expect(situacao(postos)).toBe("vermelho"); // 87,5% < 95% (crítico da TV)
    expect(r.indicadores.find((i) => i.codigo === "lic_valor")!.resultado.valor).toBe(143);
  });

  it("glosa > 0 é atenção, como na TV", () => {
    const r = aplicarNumerosDaTv({ painel: null, indicadores: [ind("op_glosas")] } as unknown as PainelGerencial, cardsOpeGerencial(ope), "x");
    expect(situacao(r.indicadores[0])).toBe("amarelo");
  });
});

describe("Atualizar recarrega as TVs da área", () => {
  it("o painel e a TV própria da área", () => {
    expect(relatoriosDaTv("ger-operacional")).toEqual(["ger-operacional", "ope-contratos"]);
    expect(relatoriosDaTv("ger-supply")).toEqual(["ger-supply", "sup-painel"]);
    expect(relatoriosDaTv("ger-frota")).toEqual(["ger-frota"]);
  });
});
