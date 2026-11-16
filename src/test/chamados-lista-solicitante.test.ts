import { describe, it, expect } from "vitest";
import {
  apareceNaListaPadrao, chamadoComPendencia, motivoNaListaPadrao, passaNosFiltros, rankingDevs,
  respondeuDepoisDoVisto, FILTROS_VAZIOS,
} from "@/pages/chamados/listaSolicitante";

const T = (h: number) => new Date(Date.UTC(2026, 10, 13, h)).toISOString();

describe("Meus chamados — chamado com pendência", () => {
  it("na fila sempre tem pendência", () => {
    for (const status of ["aberto", "em_andamento", "aguardando_retorno"]) {
      expect(chamadoComPendencia({ status }, false)).toBe(true);
    }
  });
  it("concluído: pendente só se falta confirmar/avaliar ou está na Presidência", () => {
    expect(chamadoComPendencia({ status: "concluido" }, true)).toBe(true);
    expect(chamadoComPendencia({ status: "concluido" }, false, true)).toBe(true);
    expect(chamadoComPendencia({ status: "concluido" }, false)).toBe(false);
  });
  it("reprovado e cancelado vão para o histórico", () => {
    expect(chamadoComPendencia({ status: "reprovado" }, false)).toBe(false);
    expect(chamadoComPendencia({ status: "cancelado" }, false, true)).toBe(false);
  });
});

describe("Meus chamados — aparece na lista padrão", () => {
  it("pendente aparece", () => {
    expect(motivoNaListaPadrao({ pendente: true, naoLidos: 0 })).toBe("pendencia");
  });
  it("arquivado sem conversa não aparece", () => {
    expect(apareceNaListaPadrao({ pendente: false, naoLidos: 0, conversa: null })).toBe(false);
  });
  it("arquivado com mensagem nova volta", () => {
    expect(motivoNaListaPadrao({
      pendente: false, naoLidos: 2,
      conversa: { ultima_minha_em: null, ultima_outros_em: T(5), visto_em: null },
    })).toBe("mensagem_nova");
  });
  it("leu a mensagem (sem responder) → arquiva de novo", () => {
    expect(apareceNaListaPadrao({
      pendente: false, naoLidos: 0,
      conversa: { ultima_minha_em: T(1), ultima_outros_em: T(5), visto_em: null },
    })).toBe(false);
  });
  it("marcou como visto → arquiva de novo", () => {
    expect(apareceNaListaPadrao({
      pendente: false, naoLidos: 0,
      conversa: { ultima_minha_em: T(6), ultima_outros_em: T(5), visto_em: T(7) },
    })).toBe(false);
  });
  it("respondeu → continua na lista até alguém responder", () => {
    const conversa = { ultima_minha_em: T(6), ultima_outros_em: T(5), visto_em: null };
    expect(motivoNaListaPadrao({ pendente: false, naoLidos: 0, conversa })).toBe("respondeu");
    expect(respondeuDepoisDoVisto({ ...conversa, ultima_outros_em: T(8) })).toBe(false);
  });
  it("respondeu depois de ter marcado visto → volta", () => {
    expect(apareceNaListaPadrao({
      pendente: false, naoLidos: 0,
      conversa: { ultima_minha_em: T(9), ultima_outros_em: T(5), visto_em: T(7) },
    })).toBe(true);
  });
});

describe("Meus chamados — filtros", () => {
  const c = {
    numero: "SIS-2026-0817", assunto: "Desenvolver app Web de comunicação", status: "concluido",
    responsavel_id: "dev1", prioridade: "media", created_at: "2026-11-06T14:06:00Z", concluido_em: "2026-11-10T12:00:00Z",
  };
  it("sem filtro passa tudo", () => expect(passaNosFiltros(c, "Sistema novo", FILTROS_VAZIOS)).toBe(true));
  it("busca por número, com #, e por assunto sem acento", () => {
    expect(passaNosFiltros(c, "x", { ...FILTROS_VAZIOS, busca: "#0817" })).toBe(true);
    expect(passaNosFiltros(c, "x", { ...FILTROS_VAZIOS, busca: "comunicacao" })).toBe(true);
    expect(passaNosFiltros(c, "x", { ...FILTROS_VAZIOS, busca: "folha" })).toBe(false);
  });
  it("status, responsável, prioridade e módulo", () => {
    expect(passaNosFiltros(c, "x", { ...FILTROS_VAZIOS, status: "aberto" })).toBe(false);
    expect(passaNosFiltros(c, "x", { ...FILTROS_VAZIOS, responsavel: "sem" })).toBe(false);
    expect(passaNosFiltros(c, "x", { ...FILTROS_VAZIOS, responsavel: "dev1" })).toBe(true);
    expect(passaNosFiltros(c, "x", { ...FILTROS_VAZIOS, prioridade: "alta" })).toBe(false);
    expect(passaNosFiltros(c, "Sistema novo", { ...FILTROS_VAZIOS, modulo: "Financeiro" })).toBe(false);
  });
  it("período por conclusão", () => {
    const f = { ...FILTROS_VAZIOS, campoData: "conclusao" as const, de: "2026-11-09", ate: "2026-11-11" };
    expect(passaNosFiltros(c, "x", f)).toBe(true);
    expect(passaNosFiltros({ ...c, concluido_em: null }, "x", f)).toBe(false);
  });
});

describe("Meus chamados — ranking dos devs", () => {
  it("conta, prazo médio e nota média por responsável", () => {
    const r = rankingDevs([
      { id: "a", responsavel_id: "d1", status: "concluido", created_at: T(0), concluido_em: new Date(Date.UTC(2026, 10, 15, 0)).toISOString() },
      { id: "b", responsavel_id: "d1", status: "em_andamento", created_at: T(0), concluido_em: null },
      { id: "c", responsavel_id: "d2", status: "concluido", created_at: T(0), concluido_em: new Date(Date.UTC(2026, 10, 14, 0)).toISOString() },
      { id: "d", responsavel_id: null, status: "aberto", created_at: T(0), concluido_em: null },
    ], { a: 4, c: 5 });
    expect(r.map((x) => x.responsavel_id)).toEqual(["d1", "d2"]);
    expect(r[0]).toMatchObject({ quantidade: 2, concluidos: 1, prazo_medio: 2, nota_media: 4 });
    expect(r[1]).toMatchObject({ quantidade: 1, prazo_medio: 1, nota_media: 5 });
  });
});
