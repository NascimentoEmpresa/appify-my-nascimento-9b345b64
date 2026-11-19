import { describe, expect, it } from "vitest";
import {
  COLUNAS_CSV_CANCELAMENTOS,
  csvCancelamentos,
  filtrarLinhasCancelamento,
  normalizarPainelCancelamentos,
  proporcaoCancelados,
  rotuloMes,
  rotuloSituacaoCancelamento,
} from "@/lib/suprimentos/dashboardCancelamentos";

// Formato que sup_dashboard_cancelamentos_painel devolve (SIS-2026-0945),
// com `numeric` vindo como string, como o PostgREST faz em valores grandes.
const bruto = {
  resumo: { total: 6, estruturados: 5, legados: 1, valor: "150.00", unidades: "4", unidades_sem_preco: 1,
    pedidos_no_periodo: 11, aguardando_decisao: 1, recusados: 1, vagas_com_reposicao: 2, valor_reposicao: "70" },
  por_mes: [{ mes: "2026-10", cancelados: 1, pedidos_criados: 2, valor: "50" }],
  por_motivo: [{ categoria: "LEGADO", nome: "Registro antigo (sem motivo padronizado)", quantidade: 1, valor: 50 }],
  por_origem: [{ nome: "Recrutamento", quantidade: 2 }],
  por_situacao: [{ situacao: "APOS_DESPACHO", quantidade: 1, valor: 50 }, { situacao: "INVENTADA", quantidade: 1, valor: 0 }],
  por_contrato: [{ contrato: "C1", quantidade: 6, valor: 150 }],
  linhas: [
    {
      id: "a", empresa_id: "e1", pedido_id: "PED-A", contrato_nome: "C1", posto_nome: "P1", funcao_nome: "Servente",
      nome_colaborador: "Maria", cancelado_em: "2026-11-10T15:00:00+00:00", legado: false,
      categoria: "DESISTENCIA_ADMISSAO", motivo_nome: "Desistência da admissão", detalhe: "Desistiu; não volta",
      origem_nome: "Recrutamento", solicitado_por_nome: "RH ANA", decidido_por_nome: "SUP JOAO",
      situacao: "ANTES_DESPACHO", unidades: "3", valor: "1234.5", unidades_sem_preco: 1,
      reposicao_pedido_id: "PED-R", reposicao_criado_em: "2026-11-15T12:00:00+00:00", reposicao_valor: "70",
    },
    {
      id: "l", empresa_id: "e1", pedido_id: "PED-L", contrato_nome: "C1", posto_nome: null, funcao_nome: null,
      nome_colaborador: null, cancelado_em: "2026-10-20T13:00:00+00:00", legado: true, categoria: null,
      motivo_nome: "Registro antigo (sem motivo padronizado)", detalhe: null, origem_nome: "Registro antigo",
      solicitado_por_nome: null, decidido_por_nome: "BERNARDO", situacao: "APOS_DESPACHO",
      unidades: 1, valor: 50, unidades_sem_preco: 0, reposicao_pedido_id: null, reposicao_criado_em: null, reposicao_valor: null,
    },
  ],
  linhas_truncadas: false,
  pendentes: [],
};

describe("dashboard de pedidos cancelados (SIS-2026-0945)", () => {
  it("normaliza numeric em string e preenche o que falta", () => {
    const p = normalizarPainelCancelamentos(bruto);
    expect(p.resumo.valor).toBe(150);
    expect(p.resumo.valor_reposicao).toBe(70);
    expect(p.por_mes[0].valor).toBe(50);
    expect(p.linhas[0].unidades).toBe(3);
    expect(p.linhas[0].reposicao_valor).toBe(70);
    expect(p.linhas[1].reposicao_valor).toBeNull();
    expect(p.linhas[1].legado).toBe(true);
  });

  it("situação desconhecida vira 'não informado' em vez de quebrar o rótulo", () => {
    const p = normalizarPainelCancelamentos(bruto);
    expect(p.por_situacao[1].situacao).toBe("NAO_INFORMADO");
    expect(rotuloSituacaoCancelamento("APOS_DESPACHO")).toBe("Depois do despacho (registro antigo)");
  });

  it("aguenta retorno vazio ou nulo (RPC sem dado ou banco desatualizado)", () => {
    const p = normalizarPainelCancelamentos(null);
    expect(p.resumo.total).toBe(0);
    expect(p.linhas).toEqual([]);
    expect(p.por_mes).toEqual([]);
    expect(p.linhas_truncadas).toBe(false);
  });

  it("proporção não divide por zero e arredonda em uma casa", () => {
    expect(proporcaoCancelados(3, 0)).toBe(0);
    expect(proporcaoCancelados(25, 394)).toBe(6.3);
    expect(proporcaoCancelados(Number.NaN, 10)).toBe(0);
  });

  it("rótulo do mês é curto e com ano", () => {
    expect(rotuloMes("2026-11")).toBe("nov/26");
    expect(rotuloMes("lixo")).toBe("lixo");
  });

  it("busca procura em pedido, colaborador, motivo, detalhe e no novo pedido", () => {
    const { linhas } = normalizarPainelCancelamentos(bruto);
    expect(filtrarLinhasCancelamento(linhas, "  ").length).toBe(2);
    expect(filtrarLinhasCancelamento(linhas, "maria").map((l) => l.pedido_id)).toEqual(["PED-A"]);
    expect(filtrarLinhasCancelamento(linhas, "ped-r").map((l) => l.pedido_id)).toEqual(["PED-A"]);
    expect(filtrarLinhasCancelamento(linhas, "BERNARDO").map((l) => l.pedido_id)).toEqual(["PED-L"]);
  });

  it("CSV tem as colunas na ordem, data de São Paulo, vírgula decimal e escapa ponto e vírgula", () => {
    const { linhas } = normalizarPainelCancelamentos(bruto);
    const [cabecalho, a, l] = csvCancelamentos(linhas).split("\n");
    expect(cabecalho).toBe(COLUNAS_CSV_CANCELAMENTOS.join(";"));
    const ca = a.split(/;(?=(?:[^"]*"[^"]*")*[^"]*$)/);
    expect(ca[0]).toBe("PED-A");
    expect(ca[1]).toBe("10/11/2026");
    expect(ca[7]).toBe('"Desistiu; não volta"');
    expect(ca[14]).toBe("1234,50");
    expect(ca[15]).toBe("PED-R");
    expect(ca[16]).toBe("70,00");
    const cl = l.split(";");
    expect(cl[6]).toBe("Registro antigo (sem motivo padronizado)");
    expect(cl[7]).toBe("");
    expect(cl[15]).toBe("");
    expect(cl[16]).toBe("");
  });
});
