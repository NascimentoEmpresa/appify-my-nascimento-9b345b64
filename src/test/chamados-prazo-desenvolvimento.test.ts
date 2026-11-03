import { describe, expect, it } from "vitest";
import {
  calcularPrevisao, chamadosComMesmaData, desceuNaFila, mudouNaFila, prazoValido, rotuloPrazo, diaDoPrazo, diaLocal, diasUteisAte, ehDiaUtil, podeDefinirPrazo,
  podeIniciarDesenvolvimento, prazoVencido, projetarPrevisoes, situacaoDesenvolvimento, situacaoPrazo, somarDiasUteis,
  type ChamadoPrazo,
} from "@/lib/chamados/prazoDesenvolvimento";
import { montarLinhaDoTempo, resumoStatus } from "@/pages/chamados/validacaoPresidencia";

// =====================================================================
// Prazo do desenvolvedor (SIS-2026-0763 — migs 20261028001400 e 20261028001410).
//
// "Ao receber a tarefa o desenvolvedor deve definir o prazo de acordo com as
// suas prioridades, esse prazo não poderá ser alterado, somente se a tarefa
// descer de prioridade. Ao concluir a tarefa deve ficar com o status de
// concluída dentro do prazo ou concluída com atraso." — Pablo.
// Datas em hora local (como o navegador do dev), sem depender do fuso da máquina.
// =====================================================================

// Quarta-feira, 28/10/2026, 10:00 (hora local).
const QUARTA = new Date(2026, 9, 28, 10, 0);

const chamado = (over: Partial<ChamadoPrazo> = {}): ChamadoPrazo => ({
  id: "c1", status: "em_andamento", responsavel_id: "dev", posicao_dev: 1, created_at: "2026-10-20T10:00:00Z",
  prazo_dias: null, prazo_posicao_fila: null, desenvolvimento_iniciado_em: null, prazo_conclusao_em: null,
  ...over,
});

describe("dias úteis (o mesmo calendário de public.chamado_somar_dias_uteis)", () => {
  it("pula sábado, domingo e feriado: 3 dias a partir de quarta 28/10 caem em 03/11 (02/11 é Finados)", () => {
    expect(diaLocal(somarDiasUteis(QUARTA, 3))).toBe("2026-11-03");
  });

  it("1 dia útil a partir de sexta é segunda", () => {
    expect(diaLocal(somarDiasUteis(new Date(2026, 9, 23), 1))).toBe("2026-10-26");
  });

  it("Sexta-feira Santa é feriado; Carnaval (ponto facultativo) conta como dia útil", () => {
    expect(ehDiaUtil(new Date(2026, 3, 3))).toBe(false);   // 03/04/2026
    expect(ehDiaUtil(new Date(2026, 1, 16))).toBe(true);   // Carnaval 2026
    expect(ehDiaUtil(new Date(2026, 10, 15))).toBe(false); // domingo e feriado
  });

  it("contagem de dias úteis entre duas datas, negativa quando já passou", () => {
    expect(diasUteisAte(QUARTA, new Date(2026, 10, 3))).toBe(3);
    expect(diasUteisAte(QUARTA, QUARTA)).toBe(0);
    expect(diasUteisAte(new Date(2026, 10, 3), QUARTA)).toBe(-3);
  });
});

// Mig 20261028001900: "se meu chamado numero 5 foi pra 6, posso ajustar o
// prazo, e vice versa" — libera quando a posição MUDA, para cima ou para baixo.
describe("prazo travado: só ajusta quando a posição na fila muda", () => {
  it("sem prazo: pode definir", () => {
    expect(podeDefinirPrazo(chamado())).toBe(true);
  });

  it("com prazo e mesma posição: travado", () => {
    expect(podeDefinirPrazo(chamado({ prazo_dias: 3, prazo_posicao_fila: 2, posicao_dev: 2 }))).toBe(false);
  });

  it("desceu (5º → 6º): libera ajustar", () => {
    const c = chamado({ prazo_dias: 3, prazo_posicao_fila: 5, posicao_dev: 6 });
    expect(mudouNaFila(c)).toBe(true);
    expect(desceuNaFila(c)).toBe(true);
    expect(podeDefinirPrazo(c)).toBe(true);
  });

  it("subiu (6º → 5º): também libera ajustar", () => {
    const c = chamado({ prazo_dias: 3, prazo_posicao_fila: 6, posicao_dev: 5 });
    expect(mudouNaFila(c)).toBe(true);
    expect(desceuNaFila(c)).toBe(false);
    expect(podeDefinirPrazo(c)).toBe(true);
  });

  it("chamado encerrado ou sem responsável: nada a definir", () => {
    expect(podeDefinirPrazo(chamado({ status: "concluido" }))).toBe(false);
    expect(podeDefinirPrazo(chamado({ responsavel_id: null }))).toBe(false);
    expect(desceuNaFila(chamado({ status: "concluido", prazo_dias: 3, prazo_posicao_fila: 1, posicao_dev: 4 }))).toBe(false);
  });
});

describe("previsão de entrega pela fila", () => {
  it("iniciada usa a previsão gravada; as de trás começam depois dela", () => {
    const fila = [
      chamado({ id: "a", posicao_dev: 1, prazo_dias: 2, desenvolvimento_iniciado_em: "2026-10-27T12:00:00Z",
        prazo_conclusao_em: new Date(2026, 9, 29, 23, 59).toISOString() }),
      chamado({ id: "b", posicao_dev: 2, prazo_dias: 3 }),
      chamado({ id: "c", posicao_dev: 3, prazo_dias: null }),
      chamado({ id: "d", posicao_dev: 4, prazo_dias: 1 }),
    ];
    const p = projetarPrevisoes(fila, QUARTA);
    expect(diaLocal(p.a.data)).toBe("2026-10-29");
    expect(p.a.projetada).toBe(false);
    // b: depois de a (29/10) + 3 dias úteis = 30/10, 03/11 (pula 02/11), 04/11
    expect(diaLocal(p.b.data)).toBe("2026-11-04");
    expect(p.b.projetada).toBe(true);
    expect(p.c).toBeUndefined();          // sem prazo: sem previsão, não empurra as de trás
    expect(diaLocal(p.d.data)).toBe("2026-11-05");
  });

  it("a ordem é a da fila (posicao_dev), não a da lista", () => {
    const p = projetarPrevisoes([chamado({ id: "x", posicao_dev: 2, prazo_dias: 1 }), chamado({ id: "y", posicao_dev: 1, prazo_dias: 1 })], QUARTA);
    expect(diaLocal(p.y.data)).toBe("2026-10-29");
    expect(diaLocal(p.x.data)).toBe("2026-10-30");
  });
});

describe("situação do prazo", () => {
  const prev = (d: Date) => ({ data: d, projetada: false });

  it("No prazo / Risco (vence hoje ou no próximo dia útil) / Atrasado", () => {
    const c = chamado({ prazo_dias: 3 });
    expect(situacaoPrazo(c, prev(new Date(2026, 10, 4)), QUARTA)).toBe("no_prazo");
    expect(situacaoPrazo(c, prev(new Date(2026, 9, 29)), QUARTA)).toBe("risco");
    expect(situacaoPrazo(c, prev(new Date(2026, 9, 28)), QUARTA)).toBe("risco");
    expect(situacaoPrazo(c, prev(new Date(2026, 9, 27)), QUARTA)).toBe("atrasado");
  });

  it("sem prazo definido pede para definir", () => {
    expect(situacaoPrazo(chamado(), undefined, QUARTA)).toBe("sem_prazo");
  });

  it("concluído: dentro do prazo ou com atraso, como o banco gravou", () => {
    expect(situacaoPrazo(chamado({ status: "concluido", concluido_no_prazo: true }), null, QUARTA)).toBe("concluido_no_prazo");
    expect(situacaoPrazo(chamado({ status: "concluido", concluido_no_prazo: false }), null, QUARTA)).toBe("concluido_atraso");
    expect(situacaoPrazo(chamado({ status: "concluido", concluido_no_prazo: null }), null, QUARTA)).toBe("concluido");
    expect(situacaoPrazo(chamado({ status: "cancelado" }), null, QUARTA)).toBeNull();
  });
});

describe("mesma data em dois chamados: só aviso", () => {
  const outros = [
    { id: "a", numero: "SIS-1", prazo_conclusao_em: new Date(2026, 10, 3, 23, 59).toISOString() },
    { id: "b", numero: "SIS-2", prazo_conclusao_em: null, prazo_previsto: "2026-11-04" },
    { id: "c", numero: "SIS-3", prazo_conclusao_em: null, prazo_previsto: null },
  ];

  it("mesmo DIA entra no aviso; o próprio chamado não", () => {
    expect(chamadosComMesmaData(new Date(2026, 10, 3, 8, 0), outros, "x").map((c) => c.numero)).toEqual(["SIS-1"]);
    expect(chamadosComMesmaData(new Date(2026, 10, 3, 8, 0), outros, "a")).toEqual([]);
  });

  it("prazo antigo (só data) não escorrega de dia pelo fuso", () => {
    expect(diaDoPrazo(outros[1])).toBe("2026-11-04");
    expect(chamadosComMesmaData(null, outros)).toEqual([]);
  });
});

describe("Na fila x Em desenvolvimento", () => {
  it("em andamento sem início = na fila; com início = em desenvolvimento", () => {
    expect(situacaoDesenvolvimento({ status: "em_andamento" })).toBe("na_fila");
    expect(situacaoDesenvolvimento({ status: "em_andamento", desenvolvimento_iniciado_em: "2026-10-28T13:00:00Z" })).toBe("em_desenvolvimento");
    expect(situacaoDesenvolvimento({ status: "aberto" })).toBeNull();
  });

  it("iniciar espelha a RPC: aberto/em andamento, com responsável, ainda não iniciado", () => {
    expect(podeIniciarDesenvolvimento({ status: "em_andamento", responsavel_id: "dev" })).toBe(true);
    expect(podeIniciarDesenvolvimento({ status: "aberto", responsavel_id: null })).toBe(false);
    expect(podeIniciarDesenvolvimento({ status: "aguardando_retorno", responsavel_id: "dev" })).toBe(false);
    expect(podeIniciarDesenvolvimento({ status: "em_andamento", responsavel_id: "dev", desenvolvimento_iniciado_em: "2026-10-28T13:00:00Z" })).toBe(false);
  });

  it("previsão vencida é por dia: no próprio dia ainda não venceu", () => {
    const fim = new Date(2026, 9, 28, 23, 59).toISOString();
    expect(prazoVencido({ status: "em_andamento", prazo_conclusao_em: fim }, QUARTA)).toBe(false);
    expect(prazoVencido({ status: "em_andamento", prazo_conclusao_em: fim }, new Date(2026, 9, 29, 9, 0))).toBe(true);
    expect(prazoVencido({ status: "concluido", prazo_conclusao_em: fim }, new Date(2026, 9, 29, 9, 0))).toBe(false);
  });

  it("botão Status e linha do tempo mostram o início e a previsão", () => {
    const c = {
      status: "em_andamento", created_at: "2026-10-27T10:00:00Z", updated_at: "2026-10-28T13:00:00Z",
      responsavel_id: "dev", concluido_em: null, motivo_reprovacao: null, motivo_cancelamento: null, cancelado_em: null,
      desenvolvimento_iniciado_em: "2026-10-28T13:00:00Z", prazo_conclusao_em: "2026-10-31T02:59:00Z",
    };
    expect(resumoStatus(c, null)).toBe("Em desenvolvimento");
    const dev = montarLinhaDoTempo(c, null).find((x) => x.key === "desenvolvimento")!;
    expect(dev.detalhe).toContain("Em desenvolvimento desde");
    expect(dev.detalhe).toContain("Previsão de conclusão");
    expect(resumoStatus({ ...c, desenvolvimento_iniciado_em: null }, null)).toBe("Na fila do desenvolvedor");
  });
});

// Mig 20261028001900: "determinar se o prazo vai ser em dias, horas, semanas".
describe("prazo em horas, dias ou semanas", () => {
  it("horas são corridas, com hora: 4 h a partir de quarta 10:00 = 14:00 do mesmo dia", () => {
    const p = calcularPrevisao(QUARTA, 4, "horas");
    expect(diaLocal(p)).toBe("2026-10-28");
    expect(p.getHours()).toBe(14);
  });

  it("dias úteis vão até o fim do dia; semana = 5 dias úteis (02/11 é Finados)", () => {
    const d = calcularPrevisao(QUARTA, 3, "dias");
    expect(diaLocal(d)).toBe("2026-11-03");
    expect(d.getHours()).toBe(23);
    expect(diaLocal(calcularPrevisao(QUARTA, 1, "semanas"))).toBe("2026-11-05");
  });

  it("limite por unidade, igual ao banco (chamado_prazo_valido)", () => {
    expect(prazoValido(720, "horas")).toBe(true);
    expect(prazoValido(721, "horas")).toBe(false);
    expect(prazoValido(120, "dias")).toBe(true);
    expect(prazoValido(121, "dias")).toBe(false);
    expect(prazoValido(24, "semanas")).toBe(true);
    expect(prazoValido(25, "semanas")).toBe(false);
    expect(prazoValido(0, "dias")).toBe(false);
    expect(prazoValido(1.5, "dias")).toBe(false);
  });

  it("rótulo curto na tabela; sem unidade (prazos antigos) é dias", () => {
    expect(rotuloPrazo(4, "horas")).toBe("4 h");
    expect(rotuloPrazo(1, "dias")).toBe("1 dia");
    expect(rotuloPrazo(3, null)).toBe("3 dias");
    expect(rotuloPrazo(2, "semanas")).toBe("2 sem");
    expect(rotuloPrazo(null, "dias")).toBe("—");
  });

  it("situação em horas: atrasado depois da hora, risco faltando 2 h ou menos", () => {
    const c = chamado({ prazo_dias: 4, prazo_unidade: "horas" });
    const prev = (h: number) => ({ data: new Date(2026, 9, 28, h, 0), projetada: false, comHora: true });
    expect(situacaoPrazo(c, prev(9), QUARTA)).toBe("atrasado");
    expect(situacaoPrazo(c, prev(12), QUARTA)).toBe("risco");
    expect(situacaoPrazo(c, prev(15), QUARTA)).toBe("no_prazo");
  });

  it("projeção pela fila respeita a unidade de cada tarefa", () => {
    const p = projetarPrevisoes([
      chamado({ id: "h", posicao_dev: 1, prazo_dias: 3, prazo_unidade: "horas" }),
      chamado({ id: "d", posicao_dev: 2, prazo_dias: 1, prazo_unidade: "dias" }),
    ], QUARTA);
    expect(p.h.data.getHours()).toBe(13);
    expect(p.h.comHora).toBe(true);
    expect(diaLocal(p.d.data)).toBe("2026-10-29");
  });
});
