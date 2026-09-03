import { describe, expect, it } from "vitest";
import {
  formatarDuracao,
  formatarHora12,
  formatarHora24,
  formatarHoraCompleta,
  minutosParaHora,
  minutosTrabalhadosNoDia,
  normalizarMarcacoesDoDia,
  parseMinutos,
  temBatidaIncompleta,
} from "@/lib/ponto";

// =====================================================================
// PONTO — a conversão minuto-do-dia → hora
//
// O exemplo do pedido é o caso 1: 420, 600, 615 e 780 têm que sair como
// 07:00, 10:00, 10:15 e 13:00. O resto dos testes existe porque essa
// conversão tem três jeitos conhecidos de dar errado em silêncio — turno
// noturno, AM/PM nas bordas e lixo vindo do espelho do banco legado.
// =====================================================================

describe("minutosParaHora — o exemplo do pedido", () => {
  it("420, 600, 615 e 780 viram 07:00, 10:00, 10:15 e 13:00", () => {
    expect(formatarHora24(420)).toBe("07:00");
    expect(formatarHora24(600)).toBe("10:00");
    expect(formatarHora24(615)).toBe("10:15");
    expect(formatarHora24(780)).toBe("13:00");
  });

  it("os mesmos quatro em AM/PM", () => {
    expect(formatarHora12(420)).toBe("7:00 AM");
    expect(formatarHora12(600)).toBe("10:00 AM");
    expect(formatarHora12(615)).toBe("10:15 AM");
    expect(formatarHora12(780)).toBe("1:00 PM");
  });
});

describe("as bordas do AM/PM", () => {
  // O erro clássico é `hora % 12` sem o `|| 12`: meia-noite viraria "0:00 AM"
  // e meio-dia "0:00 PM". Nenhum relógio do mundo escreve assim.
  it("meia-noite é 00:00 / 12:00 AM", () => {
    expect(formatarHora24(0)).toBe("00:00");
    expect(formatarHora12(0)).toBe("12:00 AM");
  });

  it("meio-dia é 12:00 / 12:00 PM", () => {
    expect(formatarHora24(720)).toBe("12:00");
    expect(formatarHora12(720)).toBe("12:00 PM");
  });

  it("11:59 ainda é AM e 12:01 já é PM", () => {
    expect(formatarHora12(719)).toBe("11:59 AM");
    expect(formatarHora12(721)).toBe("12:01 PM");
  });

  it("o último minuto do dia é 23:59, nunca 24:00", () => {
    expect(formatarHora24(1439)).toBe("23:59");
    expect(formatarHora12(1439)).toBe("11:59 PM");
  });
});

describe("turno que atravessa a meia-noite", () => {
  // O relógio não zera às 00:00 quando a jornada atravessa: a saída de quem
  // entrou 22:00 e saiu 02:00 chega como 1560, não como 120.
  it("1560 é 02:00 do DIA SEGUINTE, não 26:00 nem hora inválida", () => {
    const m = minutosParaHora(1560);
    expect(m?.hora24).toBe("02:00");
    expect(m?.diasAdiante).toBe(1);
    expect(m?.minutosOriginais).toBe(1560);
  });

  it("1440 cravado é 00:00 do dia seguinte", () => {
    const m = minutosParaHora(1440);
    expect(m?.hora24).toBe("00:00");
    expect(m?.diasAdiante).toBe(1);
  });

  it("a hora completa avisa que caiu no outro dia", () => {
    expect(formatarHoraCompleta(1560)).toBe("02:00 (2:00 AM) (dia seguinte)");
    expect(formatarHoraCompleta(420)).toBe("07:00 (7:00 AM)");
  });
});

describe("lixo vindo do espelho não derruba a tela", () => {
  it.each([null, undefined, "", "   ", "abc", NaN, Infinity, -1, -420])(
    "%p vira null, não 00:00",
    (v) => {
      expect(minutosParaHora(v as unknown)).toBeNull();
      expect(formatarHora24(v as unknown)).toBe("—");
    },
  );

  it("zero é batida VÁLIDA (meia-noite), não célula vazia", () => {
    expect(parseMinutos(0)).toBe(0);
    expect(minutosParaHora(0)).not.toBeNull();
  });

  it("string numérica é aceita — o espelho devolve texto em algumas colunas", () => {
    expect(formatarHora24("420")).toBe("07:00");
    expect(formatarHora24(" 780 ")).toBe("13:00");
  });

  it("fração é truncada, não arredondada", () => {
    expect(minutosParaHora(420.9)?.hora24).toBe("07:00");
  });
});

describe("normalizarMarcacoesDoDia", () => {
  it("ordena pelo minuto CRU, para o turno noturno não sair invertido", () => {
    const m = normalizarMarcacoesDoDia([1560, 1320]);
    expect(m.map((x) => x.hora24)).toEqual(["22:00", "02:00"]);
  });

  it("descarta duplicata (crachá passado duas vezes) e valor inválido", () => {
    const m = normalizarMarcacoesDoDia([420, 420, null, "x", 780]);
    expect(m.map((x) => x.hora24)).toEqual(["07:00", "13:00"]);
  });
});

describe("minutosTrabalhadosNoDia", () => {
  it("soma os pares entrada/saída do exemplo: 3h + 2h45", () => {
    // 07:00→10:00 = 180 min, 10:15→13:00 = 165 min.
    expect(minutosTrabalhadosNoDia([420, 600, 615, 780])).toBe(345);
    expect(formatarDuracao(345)).toBe("5h45");
  });

  it("turno noturno atravessando a meia-noite dá 4h, não negativo", () => {
    expect(minutosTrabalhadosNoDia([1320, 1560])).toBe(240);
  });

  it("batida ímpar (esqueceu de sair) ignora a última — não estima saída", () => {
    expect(minutosTrabalhadosNoDia([420, 600, 615])).toBe(180);
    expect(temBatidaIncompleta([420, 600, 615])).toBe(true);
    expect(temBatidaIncompleta([420, 600])).toBe(false);
  });

  it("dia sem batida nenhuma é zero", () => {
    expect(minutosTrabalhadosNoDia([])).toBe(0);
    expect(formatarDuracao(0)).toBe("—");
  });
});

describe("formatarDuracao", () => {
  it("hora cheia não mostra os minutos", () => {
    expect(formatarDuracao(480)).toBe("8h");
  });

  it("passa de 24h sem virar relógio", () => {
    expect(formatarDuracao(1500)).toBe("25h");
  });
});
