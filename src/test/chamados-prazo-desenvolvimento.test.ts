import { describe, expect, it } from "vitest";
import {
  calcularPrazo, chamadosComMesmaData, diaDoPrazo, diaLocal, lerInputDataHora, paraInputDataHora,
  podeIniciarDesenvolvimento, prazoVencido, situacaoDesenvolvimento,
} from "@/lib/chamados/prazoDesenvolvimento";
import { montarLinhaDoTempo, resumoStatus } from "@/pages/chamados/validacaoPresidencia";

// =====================================================================
// Iniciar desenvolvimento com prazo (28/10/2026, mig 20261028001400).
//
// "antes de confirmar o inicio do chamado, tem que informar o PRAZO quanto
// tempo vai levar ... se for só horas, ou dias, cada chamado tem que ter sua
// data. Não posso colocar a mesma data em dois chamados. Mas nada pode
// impedir também, só tem que dar um aviso." — Pablo.
// Datas em hora local (como o navegador do dev), sem depender do fuso da máquina.
// =====================================================================

// Quarta-feira, 28/10/2026, 10:00 (hora local).
const QUARTA_10H = new Date(2026, 9, 28, 10, 0);

describe("calcularPrazo", () => {
  it("horas são corridas: 4 h a partir das 10:00 vencem às 14:00 do mesmo dia", () => {
    const p = calcularPrazo(QUARTA_10H, 4, "horas")!;
    expect(diaLocal(p)).toBe("2026-10-28");
    expect(p.getHours()).toBe(14);
  });

  it("dias são úteis: 3 dias a partir de quarta caem na segunda (pula sábado e domingo)", () => {
    const p = calcularPrazo(QUARTA_10H, 3, "dias")!;
    expect(diaLocal(p)).toBe("2026-11-02");
    expect(p.getHours()).toBe(10);
  });

  it("1 dia útil a partir de sexta é segunda", () => {
    const sexta = new Date(2026, 9, 30, 9, 0);
    expect(diaLocal(calcularPrazo(sexta, 1, "dias")!)).toBe("2026-11-02");
  });

  it("quantidade vazia, zero ou negativa não gera prazo (o prazo é obrigatório)", () => {
    expect(calcularPrazo(QUARTA_10H, 0, "horas")).toBeNull();
    expect(calcularPrazo(QUARTA_10H, -2, "dias")).toBeNull();
    expect(calcularPrazo(QUARTA_10H, Number(""), "horas")).toBeNull();
    expect(calcularPrazo(QUARTA_10H, Number.NaN, "horas")).toBeNull();
  });

  it("o campo de data/hora ida e volta não perde o minuto", () => {
    const d = new Date(2026, 10, 2, 16, 45);
    expect(paraInputDataHora(d)).toBe("2026-11-02T16:45");
    expect(lerInputDataHora("2026-11-02T16:45")!.getTime()).toBe(d.getTime());
    expect(lerInputDataHora("")).toBeNull();
  });
});

describe("mesma data em dois chamados: só aviso", () => {
  const outros = [
    { id: "a", numero: "SIS-1", prazo_conclusao_em: new Date(2026, 10, 2, 9, 0).toISOString() },
    { id: "b", numero: "SIS-2", prazo_conclusao_em: null, prazo_previsto: "2026-11-03" },
    { id: "c", numero: "SIS-3", prazo_conclusao_em: null, prazo_previsto: null },
  ];

  it("mesmo DIA, mesmo em hora diferente, entra no aviso", () => {
    const r = chamadosComMesmaData(new Date(2026, 10, 2, 17, 0), outros, "x");
    expect(r.map((c) => c.numero)).toEqual(["SIS-1"]);
  });

  it("prazo antigo (só data, prazo_previsto) também conta, sem escorregar de dia pelo fuso", () => {
    expect(diaDoPrazo(outros[1])).toBe("2026-11-03");
    expect(chamadosComMesmaData(new Date(2026, 10, 3, 8, 0), outros).map((c) => c.numero)).toEqual(["SIS-2"]);
  });

  it("o próprio chamado (alterando o prazo) não avisa contra si mesmo", () => {
    expect(chamadosComMesmaData(new Date(2026, 10, 2, 17, 0), outros, "a")).toEqual([]);
  });

  it("dia livre ou sem prazo: nenhum aviso", () => {
    expect(chamadosComMesmaData(new Date(2026, 10, 5, 10, 0), outros)).toEqual([]);
    expect(chamadosComMesmaData(null, outros)).toEqual([]);
  });
});

describe("Na fila x Em desenvolvimento", () => {
  it("em andamento sem início = na fila; com início = em desenvolvimento", () => {
    expect(situacaoDesenvolvimento({ status: "em_andamento" })).toBe("na_fila");
    expect(situacaoDesenvolvimento({ status: "em_andamento", desenvolvimento_iniciado_em: "2026-10-28T13:00:00Z" })).toBe("em_desenvolvimento");
    expect(situacaoDesenvolvimento({ status: "aberto" })).toBeNull();
    expect(situacaoDesenvolvimento({ status: "concluido", desenvolvimento_iniciado_em: "2026-10-28T13:00:00Z" })).toBeNull();
  });

  it("iniciar espelha a RPC: aberto/em andamento, com responsável, ainda não iniciado", () => {
    expect(podeIniciarDesenvolvimento({ status: "em_andamento", responsavel_id: "dev" })).toBe(true);
    expect(podeIniciarDesenvolvimento({ status: "aberto", responsavel_id: "dev" })).toBe(true);
    expect(podeIniciarDesenvolvimento({ status: "aberto", responsavel_id: null })).toBe(false);
    expect(podeIniciarDesenvolvimento({ status: "aguardando_retorno", responsavel_id: "dev" })).toBe(false);
    expect(podeIniciarDesenvolvimento({ status: "em_andamento", responsavel_id: "dev", desenvolvimento_iniciado_em: "2026-10-28T13:00:00Z" })).toBe(false);
  });

  it("prazo vencido só enquanto o chamado não fecha", () => {
    const agora = new Date("2026-10-28T15:00:00Z");
    expect(prazoVencido({ status: "em_andamento", prazo_conclusao_em: "2026-10-28T14:00:00Z" }, agora)).toBe(true);
    expect(prazoVencido({ status: "em_andamento", prazo_conclusao_em: "2026-10-28T16:00:00Z" }, agora)).toBe(false);
    expect(prazoVencido({ status: "concluido", prazo_conclusao_em: "2026-10-28T14:00:00Z" }, agora)).toBe(false);
    expect(prazoVencido({ status: "em_andamento" }, agora)).toBe(false);
  });

  it("botão Status e linha do tempo mostram o início e a previsão", () => {
    const c = {
      status: "em_andamento", created_at: "2026-10-27T10:00:00Z", updated_at: "2026-10-28T13:00:00Z",
      responsavel_id: "dev", concluido_em: null, motivo_reprovacao: null, motivo_cancelamento: null, cancelado_em: null,
      desenvolvimento_iniciado_em: "2026-10-28T13:00:00Z", prazo_conclusao_em: "2026-10-30T20:00:00Z",
    };
    expect(resumoStatus(c, null)).toBe("Em desenvolvimento");
    const dev = montarLinhaDoTempo(c, null).find((x) => x.key === "desenvolvimento")!;
    expect(dev.detalhe).toContain("Em desenvolvimento desde");
    expect(dev.detalhe).toContain("Previsão de conclusão");
    expect(resumoStatus({ ...c, desenvolvimento_iniciado_em: null }, null)).toBe("Na fila do desenvolvedor");
  });
});
