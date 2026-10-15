// SIS-2026-0668: regras puras da Solicitação de Exceção do Malote (a regra de verdade, no banco, é a
// migration 20261015000001 — aqui só o que a tela usa para avisar antes de o banco recusar).
import { describe, expect, it } from "vitest";
import {
  conferirExcecaoComDespesa, FILTRO_EXCECOES_VAZIO, PARAM_EXCECAO, podeCriarDespesaDaExcecao, podeExcluirExcecao, urlCriarDespesaDaExcecao, filtrarExcecoes, normalizarSenhaExcecao, percentualDoTotal, resumirExcecoes, restanteDaSenha,
  statusExibidoExcecao, type ExcecaoSolicitacao, type ExcecaoValidada,
} from "@/pages/malote/excecao/regras";

const EXC: ExcecaoValidada = {
  id: "e1", numero: "EXC-2026-0001", tipo: "administrativo", classificacao_id: "C1", contrato_id: null, empresa_id: "E1",
  valor: 5800, data_pagamento: "2026-10-20", descricao: "Manutenção", justificativa: "Urgente", senha_expira_em: "2026-10-16T12:00:00Z",
};

describe("senha de exceção: validade", () => {
  it("aprovada com a senha vencida aparece como expirada; antes disso continua aprovada", () => {
    const s = { status: "aprovada" as const, senha_expira_em: "2026-10-16T12:00:00Z" };
    expect(statusExibidoExcecao(s, new Date("2026-10-16T11:59:00Z"))).toBe("aprovada");
    expect(statusExibidoExcecao(s, new Date("2026-10-16T12:00:01Z"))).toBe("expirada");
  });

  it("só 'aprovada' expira: utilizada/reprovada/em análise não mudam", () => {
    const depois = new Date("2030-01-01T00:00:00Z");
    for (const status of ["utilizada", "reprovada", "em_analise", "cancelada"] as const) {
      expect(statusExibidoExcecao({ status, senha_expira_em: "2026-10-16T12:00:00Z" }, depois)).toBe(status);
    }
  });

  it("tempo restante legível", () => {
    const base = new Date("2026-10-15T12:00:00Z");
    expect(restanteDaSenha("2026-10-16T11:10:00Z", base)).toBe("23 h 10 min");
    expect(restanteDaSenha("2026-10-15T12:42:00Z", base)).toBe("42 min");
    expect(restanteDaSenha("2026-10-15T11:00:00Z", base)).toBe("expirada");
    expect(restanteDaSenha(null, base)).toBe("");
  });
});

describe("a senha só libera a despesa que foi pedida", () => {
  const ok = { classificacaoId: "C1", dataPagamento: "2026-10-20", valor: 5800 };

  it("data, classificação e valor dentro do pedido → ok", () => {
    expect(conferirExcecaoComDespesa(EXC, ok)).toBeNull();
    expect(conferirExcecaoComDespesa(EXC, { ...ok, valor: 1000 })).toBeNull();
  });

  it("outra classificação, outra data ou valor maior → mensagem do primeiro problema", () => {
    expect(conferirExcecaoComDespesa(EXC, { ...ok, classificacaoId: "C2" })).toMatch(/outra classificação/);
    expect(conferirExcecaoComDespesa(EXC, { ...ok, dataPagamento: "2026-10-21" })).toMatch(/libera só a data 20\/10\/2026/);
    expect(conferirExcecaoComDespesa(EXC, { ...ok, valor: 5800.01 })).toMatch(/libera até/);
  });

  it("despesa rateada (sem classificação no cabeçalho) não é barrada pela classificação", () => {
    expect(conferirExcecaoComDespesa(EXC, { ...ok, classificacaoId: null })).toBeNull();
  });
});

describe("digitação da senha", () => {
  it("tira espaços e põe em caixa alta", () => {
    expect(normalizarSenhaExcecao("  exc-9f3a1c ")).toBe("EXC-9F3A1C");
  });
});

describe("Autorizações de Exceção: KPIs e filtros (fase 2)", () => {
  const S = (o: Partial<ExcecaoSolicitacao>): ExcecaoSolicitacao => ({
    id: "x", numero: "EXC-2026-0001", solicitante_id: "u1", tipo: "administrativo", classificacao_id: "C1", contrato_id: null, empresa_id: "E1",
    valor: 100, data_pagamento: "2026-10-20", descricao: "Material de limpeza", justificativa: "Urgente", status: "em_analise", decidido_por: null,
    decidido_em: null, motivo_decisao: null, senha: null, senha_expira_em: null, usada_em: null, despesa_id: null, arquivos: [], created_at: "2026-10-14T15:00:00Z", ...o,
  });
  const lista = [
    S({ id: "a", numero: "EXC-2026-0001", status: "em_analise" }),
    S({ id: "b", numero: "EXC-2026-0002", status: "aprovada", senha: "EXC-AAAAAA", senha_expira_em: "2026-10-16T15:00:00Z", empresa_id: "E2", solicitante_id: "u2" }),
    S({ id: "c", numero: "EXC-2026-0003", status: "utilizada", created_at: "2026-10-01T15:00:00Z" }),
    S({ id: "d", numero: "EXC-2026-0004", status: "reprovada", descricao: "Hospedagem para evento" }),
    S({ id: "e", numero: "EXC-2026-0005", status: "cancelada" }),
  ];

  it("KPIs: aprovadas inclui as de senha já usada; canceladas só entram no total", () => {
    expect(resumirExcecoes(lista)).toEqual({ total: 5, emAnalise: 1, aprovadas: 2, reprovadas: 1 });
  });

  it("percentual do total, sem NaN quando não há nada", () => {
    expect(percentualDoTotal(1, 4)).toBe(25);
    expect(percentualDoTotal(0, 0)).toBe(0);
  });

  it("filtra por status exibido (senha vencida vira 'expirada'), empresa, solicitante e busca", () => {
    const depois = new Date("2026-10-17T00:00:00Z");
    expect(filtrarExcecoes(lista, { ...FILTRO_EXCECOES_VAZIO, status: "expirada" }, depois).map((s) => s.id)).toEqual(["b"]);
    expect(filtrarExcecoes(lista, { ...FILTRO_EXCECOES_VAZIO, status: "aprovada" }, depois)).toEqual([]);
    expect(filtrarExcecoes(lista, { ...FILTRO_EXCECOES_VAZIO, empresaId: "E2" }).map((s) => s.id)).toEqual(["b"]);
    expect(filtrarExcecoes(lista, { ...FILTRO_EXCECOES_VAZIO, solicitanteId: "u2" }).map((s) => s.id)).toEqual(["b"]);
    expect(filtrarExcecoes(lista, { ...FILTRO_EXCECOES_VAZIO, busca: "hospedagem" }).map((s) => s.id)).toEqual(["d"]);
    expect(filtrarExcecoes(lista, { ...FILTRO_EXCECOES_VAZIO, busca: "EXC-2026-0003" }).map((s) => s.id)).toEqual(["c"]);
  });

  it("período pela data do pedido, inclusive nas pontas", () => {
    const so = (de: string, ate: string) => filtrarExcecoes(lista, { ...FILTRO_EXCECOES_VAZIO, de, ate }).map((s) => s.id);
    expect(so("2026-10-01", "2026-10-01")).toEqual(["c"]);
    expect(so("2026-10-02", "2026-10-31")).toEqual(["a", "b", "d", "e"]);
  });
});

describe("botão 'Criar despesa' da exceção aprovada", () => {
  const sol = { id: "abc-123", descricao: "Compra de toner & papel", valor: 1234.5, data_pagamento: "2026-10-20" };

  it("monta o link do Criar Despesa com classificação, descrição, valor, data e o id da exceção (sem a senha na URL)", () => {
    const u = new URL("http://x" + urlCriarDespesaDaExcecao(sol, "MATERIAL DE ESCRITÓRIO"));
    expect(u.pathname).toBe("/app/malote/criar-despesa");
    expect(u.searchParams.get("rubrica")).toBe("MATERIAL DE ESCRITÓRIO");
    expect(u.searchParams.get("nome")).toBe("Compra de toner & papel");
    expect(u.searchParams.get("valor")).toBe("1234.5");
    expect(u.searchParams.get("pagamento")).toBe("2026-10-20");
    expect(u.searchParams.get(PARAM_EXCECAO)).toBe("abc-123");
    expect(u.search).not.toMatch(/EXC-/);
  });

  it("sem nome de classificação, não manda rubrica vazia", () => {
    expect(new URL("http://x" + urlCriarDespesaDaExcecao(sol, null)).searchParams.has("rubrica")).toBe(false);
  });

  it("só aparece com a exceção aprovada e a senha dentro do prazo", () => {
    const agora = new Date("2026-10-15T12:00:00Z");
    expect(podeCriarDespesaDaExcecao({ status: "aprovada", senha_expira_em: "2026-10-16T12:00:00Z" }, agora)).toBe(true);
    expect(podeCriarDespesaDaExcecao({ status: "aprovada", senha_expira_em: "2026-10-15T11:00:00Z" }, agora)).toBe(false);
    for (const status of ["em_analise", "reprovada", "utilizada", "cancelada"] as const) {
      expect(podeCriarDespesaDaExcecao({ status, senha_expira_em: "2026-10-16T12:00:00Z" }, agora)).toBe(false);
    }
  });
});

describe("excluir solicitação de exceção", () => {
  const s = (status: ExcecaoSolicitacao["status"], solicitante = "u1") => ({ status, solicitante_id: solicitante });

  it("quem pediu ou o aprovador pode; os demais não", () => {
    expect(podeExcluirExcecao(s("em_analise"), "u1", false)).toBe(true);
    expect(podeExcluirExcecao(s("em_analise"), "u2", true)).toBe(true);
    expect(podeExcluirExcecao(s("em_analise"), "u2", false)).toBe(false);
    expect(podeExcluirExcecao(s("em_analise"), null, true)).toBe(false);
  });

  it("depois que a senha foi usada na despesa, ninguém exclui", () => {
    expect(podeExcluirExcecao(s("utilizada"), "u1", true)).toBe(false);
  });

  it("aprovada (senha ainda não usada), reprovada e cancelada podem ser excluídas", () => {
    for (const st of ["aprovada", "reprovada", "cancelada"] as const) expect(podeExcluirExcecao(s(st), "u1", false)).toBe(true);
  });
});
