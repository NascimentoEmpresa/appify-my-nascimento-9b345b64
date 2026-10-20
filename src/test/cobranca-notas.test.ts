import { describe, expect, it } from "vitest";
import {
  agruparPorContrato, filtrarLinhas, FILTROS_VAZIOS, linhasDeCobranca, notasPorFaixa, ordenarLinhas, proximaAcao, recebidoDoMes, topContratos,
  totaisDe, valoresPorStatus, type NfParaCobranca,
} from "@/pages/cobrancas/cobrancaNotas";

// 2026-10-20 12:00 em Brasília
const AGORA = new Date("2026-10-20T15:00:00Z");
const emissaoHaDias = (dias: number) => new Date(Date.UTC(2026, 9, 20) - dias * 86_400_000).toISOString().slice(0, 10);

const nf = (dias: number, o: Partial<NfParaCobranca> = {}): NfParaCobranca => ({
  id: `n${dias}-${Math.random()}`, contrato_id: "c1", empresa_id: "e1", numero_nf: String(1000 + dias), data_emissao: emissaoHaDias(dias), competencia: "2026-08-01",
  status: "concluida", deleted_at: null, data_pagamento: null, valor_pago: null, vlr_liquido_total: 1000, contrato: { nome: "UFRGS - LIMPEZA" }, ...o,
});
const EMP = new Map([["e1", "HAGG"], ["e2", "SN"]]);
const linhas = (nfs: NfParaCobranca[]) => linhasDeCobranca(nfs, EMP, AGORA);

describe("SIS-2026-0653 · notas em aberto (tela Cobranças)", () => {
  it("só entra nota concluída, fora da lixeira, sem pagamento e com valor em aberto", () => {
    const l = linhas([
      nf(40),
      nf(41, { status: "enviada" }),
      nf(42, { status: "rascunho" }),
      nf(43, { deleted_at: "2026-10-01T00:00:00Z" }),
      nf(44, { data_pagamento: "2026-10-10" }),
      nf(45, { vlr_liquido_total: 500, valor_pago: 500 }),
    ]);
    expect(l.map((x) => x.numero)).toEqual(["1040"]);
  });

  it("status pela regra: até 30 dias a vencer, depois em atraso; pago em parte é 'parcial'", () => {
    const l = linhas([nf(26), nf(30), nf(31), nf(60, { valor_pago: 300 })]);
    expect(l.map((x) => x.status)).toEqual(["a_vencer", "a_vencer", "em_atraso", "parcial"]);
    expect(l[3].valor).toBe(700); // líquido − já pago
  });

  it("a faixa é a da cobrança automática; antes do aviso a nota está 'no prazo' (sem faixa)", () => {
    const l = linhas([nf(10), nf(26), nf(40), nf(135), nf(200)]);
    expect(l.map((x) => x.faixa)).toEqual([null, "aviso", "verde", "roxa", "preta"]);
  });

  it("nota cancelada/substituída de verdade fica 'cancelada' e não entra nos totais", () => {
    const l = linhas([nf(40), nf(50, { situacao_dominio: "CANCELADA" })]);
    expect(l.find((x) => x.numero === "1050")?.status).toBe("cancelada");
    expect(totaisDe(l).totalGeral).toBe(1000);
  });

  it("'Todos' não lista canceladas; elas aparecem só no filtro próprio", () => {
    const l = linhas([nf(40), nf(50, { situacao_dominio: "CANCELADA" })]);
    expect(filtrarLinhas(l, FILTROS_VAZIOS).map((x) => x.numero)).toEqual(["1040"]);
    expect(filtrarLinhas(l, { ...FILTROS_VAZIOS, status: "cancelada" }).map((x) => x.numero)).toEqual(["1050"]);
  });
});

describe("SIS-2026-0653 · filtros e visibilidade", () => {
  const base = linhas([
    nf(26, { contrato_id: "c1" }),
    nf(40, { contrato_id: "c1" }),
    nf(70, { contrato_id: "c2", empresa_id: "e2", contrato: { nome: "TJRS" } }),
    nf(140, { contrato_id: "c3", contrato: { nome: "CHARQUEADAS - 249/2020" } }),
  ]);

  it("busca sem acento por contrato, nota ou faixa", () => {
    expect(filtrarLinhas(base, { ...FILTROS_VAZIOS, busca: "charqueadas" })).toHaveLength(1);
    expect(filtrarLinhas(base, { ...FILTROS_VAZIOS, busca: "1040" })).toHaveLength(1);
    expect(filtrarLinhas(base, { ...FILTROS_VAZIOS, busca: "roxa" })).toHaveLength(1);
  });

  it("empresa, contrato e período de emissão", () => {
    expect(filtrarLinhas(base, { ...FILTROS_VAZIOS, empresaId: "e2" }).map((x) => x.contrato)).toEqual(["TJRS"]);
    expect(filtrarLinhas(base, { ...FILTROS_VAZIOS, contratoId: "c1" })).toHaveLength(2);
    expect(filtrarLinhas(base, { ...FILTROS_VAZIOS, de: emissaoHaDias(45), ate: emissaoHaDias(30) })).toHaveLength(1);
  });

  it("restrição do Jurídico (30) e do Comercial (60) olha o atraso real, não os dias da emissão", () => {
    // dias 26 e 40 → atraso −4 e 10; dias 70 → 40; dias 140 → 110
    expect(filtrarLinhas(base, FILTROS_VAZIOS, 30).map((x) => x.dias)).toEqual([70, 140]);
    expect(filtrarLinhas(base, FILTROS_VAZIOS, 60).map((x) => x.dias)).toEqual([140]);
  });
});

describe("SIS-2026-0653 · totais e gráficos", () => {
  const l = linhas([
    nf(26, { vlr_liquido_total: 100 }),
    nf(40, { vlr_liquido_total: 200 }),
    nf(70, { vlr_liquido_total: 300, contrato_id: "c2", contrato: { nome: "TJRS" } }),
    nf(135, { vlr_liquido_total: 400, contrato_id: "c2", contrato: { nome: "TJRS" } }),
    nf(80, { vlr_liquido_total: 1000, valor_pago: 600, contrato_id: "c3", contrato: { nome: "FURG" } }),
  ]);

  it("total geral = a vencer + em atraso (inclui o que falta de nota parcial)", () => {
    const t = totaisDe(l);
    expect(t.totalGeral).toBe(100 + 200 + 300 + 400 + 400);
    expect(t.aVencer).toBe(100);
    expect(t.atraso).toBe(1300);
    expect(t.qtdAtraso).toBe(4);
    expect(t.pctAtraso).toBeCloseTo(1300 / 1400, 5);
  });

  it("valores por status: cada nota em um só status, e as barras somam o total geral", () => {
    const v = valoresPorStatus(l);
    expect(Object.fromEntries(v.map((x) => [x.status, x.valor]))).toEqual({ em_atraso: 900, a_vencer: 100, parcial: 400, cancelada: 0 });
    expect(v.reduce((s, x) => s + x.valor, 0)).toBe(totaisDe(l).totalGeral);
  });

  it("notas por faixa: só vencidas, nas faixas oficiais, com percentual", () => {
    const f = notasPorFaixa(l);
    expect(f.map((x) => x.faixa)).toEqual(["verde", "laranja", "roxa"]);
    expect(f.find((x) => x.faixa === "roxa")?.valor).toBe(400);
  });

  it("top contratos pelo valor em aberto", () => {
    expect(topContratos(l, 2).map((x) => x.contrato)).toEqual(["TJRS", "FURG"]);
  });

  it("agrupa por contrato com total, dias máximos e a faixa mais grave", () => {
    const g = agruparPorContrato(l);
    const tjrs = g.find((x) => x.contrato === "TJRS")!;
    expect(tjrs.total).toBe(700);
    expect(tjrs.faixa).toBe("roxa");
    expect(tjrs.diasMax).toBe(135);
    expect(g[0].contrato).toBe("TJRS"); // maior total primeiro
  });

  it("ordena por coluna nos dois sentidos", () => {
    expect(ordenarLinhas(l, "dias", true)[0].dias).toBe(135);
    expect(ordenarLinhas(l, "valor", false)[0].valor).toBe(100);
  });
});

describe("SIS-2026-0653 · recebido do mês", () => {
  const nfs = [
    { contrato_id: "c1", empresa_id: "e1", status: "concluida", data_pagamento: "2026-10-05", valor_pago: 1000 },
    { contrato_id: "c1", empresa_id: "e1", status: "concluida", data_pagamento: "2026-10-15", valor_pago: 500 },
    { contrato_id: "c2", empresa_id: "e2", status: "concluida", data_pagamento: "2026-09-20", valor_pago: 1000 },
    { contrato_id: "c2", empresa_id: "e2", status: "concluida", data_pagamento: null, valor_pago: 900 },
    { contrato_id: "c2", empresa_id: "e2", status: "enviada", data_pagamento: "2026-10-01", valor_pago: 900 },
  ];
  it("soma o pago no mês e compara com o mês anterior", () => {
    const r = recebidoDoMes(nfs, "2026-10");
    expect(r.valor).toBe(1500);
    expect(r.anterior).toBe(1000);
    expect(r.variacao).toBeCloseTo(0.5);
  });
  it("respeita empresa e contrato, e a virada de ano", () => {
    expect(recebidoDoMes(nfs, "2026-10", { empresaId: "e1" }).valor).toBe(1500);
    expect(recebidoDoMes(nfs, "2026-10", { contratoId: "c2" }).valor).toBe(0);
    expect(recebidoDoMes([{ contrato_id: "c", empresa_id: "e", status: "concluida", data_pagamento: "2025-12-10", valor_pago: 10 }], "2026-01").anterior).toBe(10);
  });
});

describe("SIS-2026-0653 · próxima ação (junta a nota com o plano da cobrança automática)", () => {
  const l = (status: "a_vencer" | "em_atraso" | "parcial" | "cancelada", faixa: any) => ({ status, faixa });
  it("no prazo: aguardar; roxa/preta: sempre manual do Jurídico, qualquer que seja o plano", () => {
    expect(proximaAcao(l("a_vencer", null), undefined, "producao").texto).toBe("Aguardar vencimento");
    expect(proximaAcao(l("em_atraso", "roxa"), { decisao: "enviar", proximo_envio: null }, "producao").texto).toBe("Manual — Jurídico");
    expect(proximaAcao(l("em_atraso", "preta"), undefined, "producao").tom).toBe("juridico");
  });
  it("plano do contrato: sem e-mail, só manual, enviar e aguardar", () => {
    expect(proximaAcao(l("em_atraso", "verde"), { decisao: "sem_destinatario", proximo_envio: null }, "producao").texto).toBe("Cadastrar e-mail do tomador");
    expect(proximaAcao(l("em_atraso", "verde"), { decisao: "manual", proximo_envio: null }, "producao").texto).toBe("Só manual");
    expect(proximaAcao(l("em_atraso", "verde"), { decisao: "enviar", proximo_envio: null }, "producao").tom).toBe("auto");
    expect(proximaAcao(l("em_atraso", "verde"), { decisao: "enviar", proximo_envio: null }, "simulacao").texto).toBe("Enviar e-mail");
    expect(proximaAcao(l("em_atraso", "verde"), { decisao: "aguardar", proximo_envio: "2026-10-27" }, "producao").texto).toBe("Automático em 27/10/2026");
  });
});
