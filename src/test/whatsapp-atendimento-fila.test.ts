import { describe, it, expect } from "vitest";
import {
  proximoStatus, formatarProtocolo, RE_PROTOCOLO, tempoEsperaMin, formatarEspera, urgencia,
  ordenarFila, filtrarFila, calcularIndicadores, rotuloMotivoEncaminhamento,
  type ItemFila, type AtendimentoParaIndicador,
} from "@/lib/whatsapp/atendimentoSupervisores";

// SIS-2026-0929 — status, protocolo, fila e indicadores do atendimento dos
// supervisores. Espelho dos triggers/RPCs da migration 20261118130000.

describe("status do protocolo", () => {
  it("I.A → aguardando humano → em atendimento humano → concluído", () => {
    let s = proximoStatus("ia", "ia_encaminhou");
    expect(s).toBe("aguardando_humano");
    s = proximoStatus(s, "humano_respondeu");
    expect(s).toBe("em_atendimento_humano");
    s = proximoStatus(s, "concluido");
    expect(s).toBe("concluido");
  });
  it("pessoa pode assumir direto da I.A (para a I.A)", () => {
    expect(proximoStatus("ia", "humano_assumiu")).toBe("em_atendimento_humano");
  });
  it("devolver ao bot volta para a I.A", () => {
    expect(proximoStatus("em_atendimento_humano", "devolvido_ia")).toBe("ia");
  });
  it("encaminhar a outra pessoa/setor volta para a fila", () => {
    expect(proximoStatus("em_atendimento_humano", "encaminhado")).toBe("aguardando_humano");
  });
  it("concluído não reabre (nova mensagem gera novo protocolo)", () => {
    expect(proximoStatus("concluido", "humano_respondeu")).toBe("concluido");
    expect(proximoStatus("concluido", "devolvido_ia")).toBe("concluido");
  });
  it("encaminhamento da I.A não rebaixa quem já está com humano", () => {
    expect(proximoStatus("em_atendimento_humano", "ia_encaminhou")).toBe("em_atendimento_humano");
  });
});

describe("protocolo", () => {
  it("formato ATD-AAAA-NNNNNN", () => {
    expect(formatarProtocolo(2026, 123)).toBe("ATD-2026-000123");
    expect(RE_PROTOCOLO.test("ATD-2026-000123")).toBe(true);
    expect(RE_PROTOCOLO.test("ATD-2026-1234567")).toBe(true); // passa de 999.999 sem quebrar
    expect(RE_PROTOCOLO.test("SIS-2026-0929")).toBe(false);
  });
});

const agora = new Date("2026-11-18T15:00:00Z");
const item = (p: Partial<ItemFila>): ItemFila => ({
  id: p.protocolo ?? "x", protocolo: "ATD-2026-000001", status: "aguardando_humano",
  aberto_em: "2026-11-18T14:00:00Z", aguardando_desde: null, ...p,
});

describe("fila de pendências", () => {
  it("tempo de espera conta desde que entrou na fila", () => {
    expect(tempoEsperaMin(item({ aguardando_desde: "2026-11-18T14:15:00Z" }), agora)).toBe(45);
  });
  it("sem marca de fila, conta desde a abertura", () => {
    expect(tempoEsperaMin(item({}), agora)).toBe(60);
  });
  it("na I.A ou concluído não há espera", () => {
    expect(tempoEsperaMin(item({ status: "ia" }), agora)).toBeNull();
    expect(tempoEsperaMin(item({ status: "concluido" }), agora)).toBeNull();
  });
  it("formata a espera", () => {
    expect(formatarEspera(45)).toBe("45 min");
    expect(formatarEspera(125)).toBe("2h05");
    expect(formatarEspera(60 * 27)).toBe("1d 3h");
    expect(formatarEspera(null)).toBe("—");
  });
  it("urgência pela espera", () => {
    expect(urgencia(10)).toBe("normal");
    expect(urgencia(30)).toBe("atencao");
    expect(urgencia(120)).toBe("critico");
  });
  it("ordena: aguardando primeiro, quem espera há mais tempo na frente", () => {
    const fila = ordenarFila([
      item({ protocolo: "C", status: "ia", aberto_em: "2026-11-18T10:00:00Z" }),
      item({ protocolo: "B", aguardando_desde: "2026-11-18T14:30:00Z" }),
      item({ protocolo: "A", aguardando_desde: "2026-11-18T13:00:00Z" }),
      item({ protocolo: "D", status: "em_atendimento_humano", aguardando_desde: "2026-11-18T09:00:00Z" }),
    ]);
    expect(fila.map((i) => i.protocolo)).toEqual(["A", "B", "D", "C"]);
  });
  it("filtra abertos e meus", () => {
    const l = [
      item({ protocolo: "1", responsavel_id: "u1" }),
      item({ protocolo: "2", responsavel_id: "u2" }),
      item({ protocolo: "3", status: "concluido", responsavel_id: "u1" }),
    ];
    expect(filtrarFila(l, { status: "abertos" }).map((i) => i.protocolo)).toEqual(["1", "2"]);
    expect(filtrarFila(l, { status: "abertos", meus: "u1" }).map((i) => i.protocolo)).toEqual(["1"]);
    expect(filtrarFila(l, { status: "concluido" }).map((i) => i.protocolo)).toEqual(["3"]);
  });
  it("rótulo do motivo inclui o motivo da negativa", () => {
    expect(rotuloMotivoEncaminhamento("consulta_negada:categoria_sensivel"))
      .toBe("Informação não autorizada automaticamente (Categoria sensível (nunca automática))");
    expect(rotuloMotivoEncaminhamento(null)).toBe("—");
  });
});

describe("indicadores", () => {
  const a = (p: Partial<AtendimentoParaIndicador>): AtendimentoParaIndicador => ({
    status: "concluido", assunto: null, aberto_em: "2026-11-18T10:00:00Z", aguardando_desde: null,
    primeira_resposta_ia_em: null, primeira_resposta_humana_em: null, concluido_em: null, resolvido_pela_ia: null, ...p,
  });
  const lista = [
    a({ assunto: "escala", primeira_resposta_ia_em: "2026-11-18T10:00:04Z", concluido_em: "2026-11-18T10:10:00Z", resolvido_pela_ia: true }),
    a({ assunto: "escala", primeira_resposta_ia_em: "2026-11-18T10:00:02Z", concluido_em: "2026-11-18T10:30:00Z", resolvido_pela_ia: true }),
    a({ assunto: "remuneracao", aguardando_desde: "2026-11-18T10:01:00Z", primeira_resposta_humana_em: "2026-11-18T10:21:00Z",
        concluido_em: "2026-11-18T11:00:00Z", resolvido_pela_ia: false }),
    a({ status: "aguardando_humano", assunto: "saude", aguardando_desde: "2026-11-18T12:00:00Z" }),
  ];
  const ind = calcularIndicadores(lista);

  it("volume, concluídos e % resolvido pela I.A (sobre os concluídos)", () => {
    expect(ind.total).toBe(4);
    expect(ind.concluidos).toBe(3);
    expect(ind.resolvidos_ia).toBe(2);
    expect(ind.pct_resolvido_ia).toBe(66.7);
    expect(ind.pendentes).toBe(1);
  });
  it("tempos médios", () => {
    expect(ind.tempo_resposta_ia_seg).toBe(3);
    expect(ind.espera_humano_min).toBe(20);
    expect(ind.duracao_media_min).toBe(33.3);
  });
  it("assuntos recorrentes, mais frequente primeiro", () => {
    expect(ind.assuntos[0]).toEqual({ assunto: "escala", total: 2 });
    expect(ind.assuntos).toHaveLength(3);
  });
  it("sem concluídos o % fica vazio (não 0%)", () => {
    expect(calcularIndicadores([a({ status: "ia" })]).pct_resolvido_ia).toBeNull();
    expect(calcularIndicadores([]).total).toBe(0);
  });
});
