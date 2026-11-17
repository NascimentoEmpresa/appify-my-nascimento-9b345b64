// SIS-2026-0909 — correções da revisão independente de 16/11/2026 (b271ffb3).
// Um bloco por item da revisão.
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import * as XLSX from "xlsx";
import {
  situacaoDa, valorPagoDa, resolverParcelas, resumoDoPeriodo, saldoDeReferencia, recortesDaAba,
  parcelaParaEdicao, pagamentosSemComprovante, linhasDoRelatorio, lerImportacao, campoDoDetalhe,
  campoDoCabecalho, tipoDoIndice, rotuloIndice, permissoesDaAba, impontualidadeDe, csvDasParcelas,
  naoPagaNaPlanilha, type ParcelaFinanciamento,
} from "@/pages/juridico/patrimonio/financiamento";
import { aplicarBaixaDasContas } from "@/pages/juridico/patrimonio/baixaParcelas";
import { montarExcel, type DadosExportacao } from "@/pages/juridico/patrimonio/exportar";

const HOJE = "2026-11-16";
const raiz = path.resolve(__dirname, "../..");
const migration = fs.readFileSync(path.join(raiz, "supabase/migrations/20261117180000_sis_2026_0909_financiamento_composicao_parcelas.sql"), "utf8");

describe("1. RLS e botões por ação", () => {
  it("a migration não tem mais policy FOR ALL e separa as ações", () => {
    expect(migration).not.toMatch(/CREATE POLICY[^;]*FOR ALL/);
    expect(migration).toMatch(/FOR SELECT TO authenticated USING %s', pre \|\| '_select'/);
    expect(migration).toMatch(/FOR INSERT TO authenticated WITH CHECK %s', pre \|\| '_insert'/);
    expect(migration).toMatch(/FOR UPDATE TO authenticated USING %s WITH CHECK %s', pre \|\| '_update'/);
    expect(migration).toMatch(/FOR DELETE TO authenticated USING %s', pre \|\| '_delete'/);
    // cada ação com a sua: visualizar só no select, excluir só no delete
    expect(migration).toMatch(/'visualizar', 'juridico_patrimonios', 'visualizar'\);\s*EXECUTE format\('CREATE POLICY %I ON public\.%I FOR SELECT/);
    expect(migration).toMatch(/'excluir', 'juridico_patrimonios', 'excluir'\);\s*EXECUTE format\('CREATE POLICY %I ON public\.%I FOR DELETE/);
    // as 4 tabelas, inclusive a de parcelas (a policy antiga _gate cai)
    for (const t of ["JUR_PATRIMONIO_FINANCIAMENTOS", "JUR_PATRIMONIO_PARCELA_PAGAMENTOS", "JUR_PATRIMONIO_INCC_APLICACOES", "JUR_PATRIMONIO_PARCELAS"])
      expect(migration).toContain(`'${t}'`);
    expect(migration).toMatch(/DROP POLICY IF EXISTS %I ON public\.%I', pre \|\| '_gate'/);
  });
  it("quem só visualiza não vê botão de gravar nem de excluir", () => {
    const so = permissoesDaAba({ incluir: false, alterar: false, excluir: false });
    expect(Object.values(so).every(v => v === false)).toBe(true);
  });
  it("cada botão pela sua ação", () => {
    const alt = permissoesDaAba({ incluir: false, alterar: true, excluir: false });
    expect(alt.editarParcela && alt.anexarComprovante && alt.editarContrato).toBe(true);
    expect(alt.excluirPagamento || alt.excluirParcela || alt.excluirIncc || alt.registrarPagamento || alt.importar).toBe(false);
    const exc = permissoesDaAba({ incluir: false, alterar: false, excluir: true });
    expect(exc.excluirPagamento && exc.excluirParcela && exc.excluirIncc).toBe(true);
    expect(exc.editarParcela).toBe(false);
    expect(permissoesDaAba({ incluir: true, alterar: true, excluir: false }).importar).toBe(true);
  });
});

describe("2. Editar composição abre com a linha crua", () => {
  it("a baixa do Malote põe valor_pago na cópia; o formulário usa a do banco", () => {
    const brutas = [{ id: 5, numero: 21, vencimento: "2026-09-30", valor: 4166.66, situacao: "NAO PAGA", valor_pago: null as number | null }];
    const comBaixa = aplicarBaixaDasContas(brutas, [
      { id: 1, categoria: "Financiamento", tipo_lancamento: "parcela", parcela_numero: 21, vencimento: "2026-09-30", valor: 4200 },
    ], () => "malote");
    expect(comBaixa[0].valor_pago).toBe(4200);                 // o que a tabela desenha
    expect(parcelaParaEdicao(comBaixa[0].id, brutas)?.valor_pago).toBeNull();  // o que vai ao formulário
    expect(brutas[0].valor_pago).toBeNull();                   // a crua não foi mexida
    expect(parcelaParaEdicao(99, brutas)).toBeNull();
  });
});

describe("3. Impontualidade e baixa corrigida não viram A CONFERIR", () => {
  it("pago = devido + multa é PAGA", () => {
    expect(situacaoDa({ id: 1, valor: 2370.11, valor_pago: 2385.31, valor_impontualidade: 15.2 }, [], HOJE)).toBe("PAGA");
    expect(situacaoDa({ id: 1, valor: 2370.11, valor_pago: 2385.31, multa_atraso: 10, juros_atraso: 5.2 }, [], HOJE)).toBe("PAGA");
    expect(situacaoDa({ id: 1, valor: 2370.11, valor_pago: 2385.31 }, [], HOJE)).toBe("A CONFERIR");
    expect(impontualidadeDe({ valor_impontualidade: null, multa_atraso: 1, juros_atraso: 2 })).toBe(3);
  });
  it("baixa do Malote com valor corrigido acima da planilha é PAGA", () => {
    expect(situacaoDa({ id: 1, valor: 4166.66, valor_pago: 4210.4, baixa: "malote" }, [], HOJE)).toBe("PAGA");
    expect(situacaoDa({ id: 1, valor: 4166.66, valor_pago: 4210.4, baixa: "conta" }, [], HOJE)).toBe("PAGA");
    // com pagamento detalhado acima do devido continua indo para conferência
    expect(situacaoDa({ id: 1, valor: 100, baixa: "malote" }, [{ parcela_id: 1, valor: 150 }], HOJE)).toBe("A CONFERIR");
  });
});

describe("4. valor_pago de parcela NAO PAGA da planilha é ignorado", () => {
  const p = { id: 1, valor: 4166.66, valor_pago: 4301.2, situacao: "NAO PAGA", vencimento: "2027-01-30" };
  it("sem baixa e sem pagamento: não há pago", () => {
    expect(naoPagaNaPlanilha(p)).toBe(true);
    expect(naoPagaNaPlanilha({ situacao: "NÃO PAGO" })).toBe(true);
    expect(naoPagaNaPlanilha({ situacao: "PAGA" })).toBe(false);
    expect(valorPagoDa(p)).toBeNull();
    expect(situacaoDa(p, [], HOJE)).toBe("EM ABERTO");
  });
  it("com baixa ou pagamento registrado volta a contar", () => {
    expect(valorPagoDa({ ...p, baixa: "malote" })).toBe(4301.2);
    expect(valorPagoDa(p, [{ parcela_id: 1, valor: 1000 }])).toBe(1000);
    expect(valorPagoDa({ ...p, situacao: null })).toBe(4301.2);
  });
});

describe("5. Importação detecta percentual x fator", () => {
  it("fator 1,00122401 vira fator; 0,58% vira percentual", () => {
    const r = lerImportacao("Parcela;Índice\n83;1,00122401\n84;0,58%\n85;0,58");
    expect(r.linhas[0]).toMatchObject({ indice_correcao: 1.00122401, indice_tipo: "fator" });
    expect(r.linhas[1]).toMatchObject({ indice_correcao: 0.58, indice_tipo: "percentual" });
    expect(r.linhas[2]).toMatchObject({ indice_tipo: "percentual" });
    expect(rotuloIndice(1.00122401, tipoDoIndice(1.00122401))).toBe("1,00122401");
    expect(tipoDoIndice(null)).toBeNull();
  });
});

describe("6. Pagamentos não somem com o importador antigo", () => {
  it("FK dos pagamentos sem cascata (NO ACTION)", () => {
    expect(migration).toMatch(/parcela_id\s+BIGINT NOT NULL REFERENCES public\."JUR_PATRIMONIO_PARCELAS"\(id\) ON DELETE NO ACTION/);
    expect(migration).not.toMatch(/"JUR_PATRIMONIO_PARCELAS"\(id\) ON DELETE CASCADE/);
  });
  it("o importador pula imóvel com parcela mexida pela tela ou com pagamento", () => {
    const script = fs.readFileSync(path.join(raiz, "scripts/importar-patrimonios-planilha.mjs"), "utf8");
    const guarda = script.indexOf("JUR_PATRIMONIO_PARCELA_PAGAMENTOS?patrimonio_id=eq.");
    const del = script.indexOf(`JUR_PATRIMONIO_PARCELAS?patrimonio_id=eq.\${id}\`, { method: "DELETE"`);
    expect(guarda).toBeGreaterThan(0);
    expect(del).toBeGreaterThan(guarda);
    expect(script.slice(guarda, del)).toMatch(/updated_at\.not\.is\.null|continue;/);
    expect(script.slice(guarda - 400, del)).toContain("updated_at.not.is.null");
  });
});

describe("7. Relatório exportado com a mesma leitura da aba", () => {
  const parcelas: ParcelaFinanciamento[] = [
    { id: 1, numero: 1, vencimento: "2026-10-06", valor: 1000, situacao: "NAO PAGA", valor_pago: 1050 },
    { id: 2, numero: 2, vencimento: "2026-11-06", valor: 1000 },
  ];
  const pags = [{ parcela_id: 2, data_pagamento: "2026-11-06", valor: 400 }];
  it("linhasDoRelatorio = resolverParcelas", () => {
    const rel = linhasDoRelatorio(parcelas, pags, HOJE);
    const aba = resolverParcelas(parcelas, pags, HOJE);
    expect(rel.map(r => r.situacao)).toEqual(aba.map(a => a.situacao));
    expect(rel.map(r => r.valor_pago)).toEqual([null, 400]);
    expect(rel.map(r => r.situacao)).toEqual(["VENCIDA", "PARCIAL"]);
  });
  it("o Excel traz situação, valor pago e data do pagamento calculados", () => {
    const d: DadosExportacao = {
      patrimonios: [{ id: 1, codigo: "5", descricao: "Casa do Senilton", tipo: "Imóvel", status: "Ativo" }],
      obrigacoes: [], itens: [], comentarios: [],
      parcelas: parcelas.map(p => ({ ...p, patrimonio_id: 1, ordem: p.id })),
      pagamentos: pags.map((p, i) => ({ ...p, id: i + 1, patrimonio_id: 1 })),
    };
    const wb = XLSX.read(new Uint8Array(montarExcel(d, { seloDaConta: o => String(o.status), autor: "T" })), { type: "array", cellDates: true });
    const ls = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets["Parcelas"]);
    expect(ls.map(l => l["Situação"])).toEqual(["VENCIDA", "PARCIAL"]);
    expect(ls[0]["Valor pago"] ?? null).toBeNull();
    expect(ls[1]["Valor pago"]).toBe(400);
    expect(ls[1]["Data do pagamento"]).toBeInstanceOf(Date);
  });
});

describe("8. Resumo e evolução pelo período, não pelo filtro de situação", () => {
  const parcelas: ParcelaFinanciamento[] = [
    { id: 1, vencimento: "2026-02-06", valor: 2375.4, valor_pago: 2375.4, amortizacao: 600.1, saldo_anterior: 207579.19, atualizacao_monetaria: 0, saldo_devedor: 206979.09 },
    { id: 2, vencimento: "2026-03-06", valor: 2370.11, valor_pago: 2370.11, amortizacao: 601.06, atualizacao_monetaria: 253.34, saldo_devedor: 206631.37 },
    { id: 3, vencimento: "2026-04-06", valor: 2360 },                       // vencida em aberto
    { id: 4, vencimento: "2027-01-06", valor: 2350, projetado: true, saldo_devedor: 200000 },
  ];
  const res = resolverParcelas(parcelas, [], HOJE);
  it("situação = Vencidas recorta a tabela mas não zera o resumo", () => {
    const r = recortesDaAba(res, "2026", "VENCIDA", HOJE);
    expect(r.filtradas.map(l => l.p.id)).toEqual([3]);
    expect(r.resumo.pago).toBe(4745.51);
    expect(r.resumo.amortizacao).toBe(1201.16);
  });
  it("evolução aparece em contrato inteiro (até hoje, sem projetadas) e em mês único", () => {
    const todo = recortesDaAba(res, "", "", HOJE).evolucao!;
    expect(todo.saldoAnterior).toBe(207579.19);
    expect(todo.saldoApos).toBe(206631.37);          // não o 200.000 projetado
    const mes = recortesDaAba(res, "2026-03", "", HOJE).evolucao!;
    expect(mes.saldoAnterior).toBe(206979.09);
    expect(mes.variacao).toBe(-347.72);
    expect(recortesDaAba(res, "2027-01", "", HOJE).evolucao).toBeNull();   // só projeção
  });
});

describe("9. Saldo de referência nunca passa de hoje", () => {
  const ps: ParcelaFinanciamento[] = [
    { id: 1, vencimento: "2026-03-06", saldo_devedor: 206631.37 },
    { id: 2, vencimento: "2027-03-06", saldo_devedor: 190000 },                 // futura
    { id: 3, vencimento: "2026-10-06", saldo_devedor: 199000, projetado: true },
    { id: 4, vencimento: null, saldo_devedor: 1 },                            // sem vencimento ("9999")
  ];
  it("contrato inteiro: última parcela até hoje, não projetada, com vencimento", () => {
    expect(saldoDeReferencia(ps, "", null, HOJE)).toMatchObject({ valor: 206631.37, data: "2026-03-06" });
  });
  it("período futuro também para em hoje", () => {
    expect(saldoDeReferencia(ps, "2027", null, HOJE)?.valor).toBe(206631.37);
  });
});

describe("10. Cabeçalhos do importador", () => {
  it("aceita 'Data do pagamento' (o nome do CSV exportado) e reimporta o próprio CSV", () => {
    expect(campoDoCabecalho("Data do pagamento")).toBe("data_pagamento");
    expect(campoDoCabecalho("Dt. pagamento")).toBe("data_pagamento");
    const csv = csvDasParcelas(resolverParcelas([{ id: 1, numero: 83, vencimento: "2026-03-06", valor: 2370.11, data_pagamento: "2026-03-06", valor_pago: 2370.11, juros: 1692.01, indice_correcao: 1.00122401, indice_tipo: "fator" }], [], HOJE));
    const r = lerImportacao(csv);
    expect(r.linhas[0]).toMatchObject({ numero: 83, data_pagamento: "2026-03-06", juros: 1692.01, valor_pago: 2370.11, indice_correcao: 1.00122401, indice_tipo: "fator" });
  });
  it("'Taxa de juros' (% a.a.) não cai em juros em R$ nem em taxas", () => {
    expect(campoDoDetalhe("Taxa de juros")).toBeNull();
    expect(campoDoDetalhe("Juros nominais a.a.")).toBeNull();
    expect(campoDoDetalhe("CET")).toBeNull();
    expect(campoDoCabecalho("Taxa de juros")).toBeNull();
    expect(campoDoDetalhe("Juros")).toBe("juros");
    expect(campoDoDetalhe("Taxa de administração")).toBe("taxas");
    expect(campoDoDetalhe("INCC (%)")).toBe("indice_correcao");
    expect(campoDoCabecalho("Índice %")).toBe("indice_correcao");
  });
});

describe("11. Anexar comprovante a pagamento existente", () => {
  it("lista só os pagamentos sem comprovante", () => {
    const pags = [{ id: 1, comprovante_path: "x.pdf" }, { id: 2, comprovante_path: null }, { id: 3 }];
    expect(pagamentosSemComprovante(pags).map(p => p.id)).toEqual([2, 3]);
  });
});

describe("12. Vencido em aberto sem projetadas e sem vencimento", () => {
  it("só conta parcela real vencida", () => {
    const r = resumoDoPeriodo(resolverParcelas([
      { id: 1, valor: 100, vencimento: "2026-10-01" },
      { id: 2, valor: 200, vencimento: "2026-09-01", projetado: true },
      { id: 3, valor: 300, vencimento: null },
      { id: 4, valor: 400, vencimento: "2027-01-01" },
    ], [], HOJE), HOJE);
    expect(r.vencidoEmAberto).toBe(100);
    expect(r.futuro).toBe(400);
  });
});

describe("Ajustes pelo mock do chamado (17/11)", () => {
  it("competência do índice: a escolhida ou a mais recente; sem lançamento → null", async () => {
    const { aplicacaoDaCompetencia } = await import("@/pages/juridico/patrimonio/financiamento");
    const h = [{ competencia: "2026-01-01", correcao: 580 }, { competencia: "2026-02-01", correcao: 503 }];
    expect(aplicacaoDaCompetencia(h, "")?.correcao).toBe(503);
    expect(aplicacaoDaCompetencia(h, "2026-01")?.correcao).toBe(580);
    expect(aplicacaoDaCompetencia(h, "2026-03")).toBeNull();
    expect(aplicacaoDaCompetencia([], "")).toBeNull();
  });
  it("o CSV exportado usa MPI, como o demonstrativo", () => {
    const csv = csvDasParcelas(resolverParcelas([{ id: 1, numero: 83, seguro_mip: 24.58 }], [], HOJE));
    expect(csv.split("\n")[0]).toContain(";MPI;DFI;");
    expect(lerImportacao(csv).linhas[0]).toMatchObject({ seguro_mip: 24.58 });
  });
});
