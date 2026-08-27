import { describe, it, expect } from "vitest";
import {
  competenciaDe, competenciaLegivel, dataParaBR, dataParaISO, descreveJanela, descreveTeto,
  emMinutos, fmtBRL, normalizaHora, podeLancar, proximoStatus, tiposDisponiveis,
  totalEmCentavos, valorEmCentavos, viagemAlcancaJanela,
  type TipoReembolso,
} from "@/lib/reembolso/regras";

// O Solicitar Reembolso veio de um bot de Discord onde o catálogo de despesas
// era constante no código, "sem limite de valor", e o poder de aprovar saía do
// cargo do Discord. O que estes testes travam é o que foi acrescentado por
// cima: teto por tipo e janela de horário por tipo — as duas regras que agora
// decidem se a despesa pode sequer ser lançada.

const tipo = (over: Partial<TipoReembolso> = {}): TipoReembolso => ({
  codigo: "almoco",
  nome: "Almoço",
  valor_maximo_centavos: 3500,
  hora_inicio: "11:00",
  hora_fim: "13:00",
  ativo: true,
  ordem: 3,
  ...over,
});

describe("normalizaHora — a pessoa digita com pressa", () => {
  it("aceita as três formas que o bot aceitava", () => {
    expect(normalizaHora("8")).toBe("08:00");
    expect(normalizaHora("0830")).toBe("08:30");
    expect(normalizaHora("08:30")).toBe("08:30");
    expect(normalizaHora("18")).toBe("18:00");
    expect(normalizaHora(" 7 ")).toBe("07:00");
  });

  it("recusa o que não é hora", () => {
    expect(normalizaHora("")).toBeNull();
    expect(normalizaHora("abc")).toBeNull();
    expect(normalizaHora("25:00")).toBeNull();
    expect(normalizaHora("08:75")).toBeNull();
    expect(normalizaHora("2570")).toBeNull();
  });

  it("emMinutos conta da meia-noite", () => {
    expect(emMinutos("00:00")).toBe(0);
    expect(emMinutos("11:30")).toBe(690);
    expect(emMinutos("23:59")).toBe(1439);
  });
});

describe("viagemAlcancaJanela — o diferencial pedido", () => {
  it("quem saiu às 14h não pede almoço", () => {
    // A frase que originou a regra, literal.
    expect(viagemAlcancaJanela("14:00", "18:00", "11:00", "13:00")).toBe(false);
  });

  it("quem estava na rua no horário do almoço pede", () => {
    expect(viagemAlcancaJanela("11:30", "12:30", "11:00", "13:00")).toBe(true);
  });

  it("basta ATRAVESSAR a janela, não começar dentro dela", () => {
    // Saiu 09h e voltou 15h: passou o almoço inteiro na rua. Se a regra fosse
    // "a saída tem que estar na janela", esse caso — o mais comum de todos —
    // seria recusado.
    expect(viagemAlcancaJanela("09:00", "15:00", "11:00", "13:00")).toBe(true);
  });

  it("encostar na borda conta", () => {
    expect(viagemAlcancaJanela("08:00", "11:00", "11:00", "13:00")).toBe(true);
    expect(viagemAlcancaJanela("13:00", "17:00", "11:00", "13:00")).toBe(true);
  });

  it("voltar antes de a janela abrir não conta", () => {
    expect(viagemAlcancaJanela("07:00", "10:59", "11:00", "13:00")).toBe(false);
  });

  it("tipo sem janela vale o dia todo", () => {
    // Estacionamento e hospedagem não têm hora — é o default de quem cadastra
    // um tipo sem pensar em horário.
    expect(viagemAlcancaJanela("03:00", "04:00", null, null)).toBe(true);
    expect(viagemAlcancaJanela("03:00", "04:00", "11:00", null)).toBe(true);
  });

  it("viagem que atravessa a meia-noite não se perde", () => {
    // Saiu 22h, chegou 02h. Tratado como um par só [1320,120] daria intervalo
    // negativo e a janta (18h-23h) seria recusada de graça.
    expect(viagemAlcancaJanela("22:00", "02:00", "18:00", "23:00")).toBe(true);
    expect(viagemAlcancaJanela("22:00", "02:00", "11:00", "13:00")).toBe(false);
  });

  it("janela que atravessa a meia-noite também vale", () => {
    // Ceia de plantão, 23h às 01h.
    expect(viagemAlcancaJanela("23:30", "23:45", "23:00", "01:00")).toBe(true);
    expect(viagemAlcancaJanela("00:10", "00:20", "23:00", "01:00")).toBe(true);
    expect(viagemAlcancaJanela("12:00", "13:00", "23:00", "01:00")).toBe(false);
  });

  it("hora inválida não vira permissão", () => {
    expect(viagemAlcancaJanela("xx", "13:00", "11:00", "13:00")).toBe(false);
  });
});

describe("valorEmCentavos — reembolso tem que fechar centavo", () => {
  it("aceita vírgula e ponto", () => {
    expect(valorEmCentavos("12,50")).toBe(1250);
    expect(valorEmCentavos("12.50")).toBe(1250);
    expect(valorEmCentavos("12")).toBe(1200);
    expect(valorEmCentavos("R$ 12,50")).toBe(1250);
  });

  it("não confunde ponto de milhar com decimal", () => {
    // Sem isso "1.234,56" vira 1.23 — erro de duas ordens de grandeza.
    expect(valorEmCentavos("1.234,56")).toBe(123456);
  });

  it("recusa o que não é valor", () => {
    expect(valorEmCentavos("")).toBeNull();
    expect(valorEmCentavos("abc")).toBeNull();
    expect(valorEmCentavos("-5")).toBeNull();
  });

  it("soma em centavos, não em float", () => {
    // 0.1 + 0.2 em float dá 0.30000000000000004.
    expect(totalEmCentavos([{ valor_centavos: 10 }, { valor_centavos: 20 }])).toBe(30);
    expect(totalEmCentavos([{ valor_centavos: 1250 }, { valor_centavos: 3499 }])).toBe(4749);
    expect(totalEmCentavos([])).toBe(0);
  });
});

describe("podeLancar — as três perguntas, nessa ordem", () => {
  it("tipo desligado não entra", () => {
    const v = podeLancar(tipo({ ativo: false }), 1000, "11:30", "12:30");
    expect(v.ok).toBe(false);
    expect(v.motivo).toBe("tipo_inativo");
  });

  it("tipo inexistente não entra", () => {
    expect(podeLancar(undefined, 1000, "11:30", "12:30").motivo).toBe("tipo_inativo");
  });

  it("fora da janela vem ANTES do teto", () => {
    // Valor absurdo E fora da janela: a mensagem tem que mandar corrigir o
    // horário, não o valor — senão a pessoa baixa o valor e continua barrada.
    const v = podeLancar(tipo(), 999999, "14:00", "18:00");
    expect(v.ok).toBe(false);
    expect(v.motivo).toBe("fora_da_janela");
    expect(v.mensagem).toContain("11:00");
  });

  it("acima do teto não entra, e a mensagem diz o teto", () => {
    const v = podeLancar(tipo({ valor_maximo_centavos: 3500 }), 4000, "11:30", "12:30");
    expect(v.ok).toBe(false);
    expect(v.motivo).toBe("acima_do_teto");
    expect(v.mensagem).toContain("35,00");
  });

  it("exatamente no teto entra", () => {
    expect(podeLancar(tipo({ valor_maximo_centavos: 3500 }), 3500, "11:30", "12:30").ok).toBe(true);
  });

  it("tipo sem teto aceita qualquer valor — era o comportamento do bot", () => {
    expect(podeLancar(tipo({ valor_maximo_centavos: null }), 9999999, "11:30", "12:30").ok).toBe(true);
  });

  it("valor zero ou inválido não entra", () => {
    expect(podeLancar(tipo(), 0, "11:30", "12:30").motivo).toBe("valor_invalido");
    expect(podeLancar(tipo(), null, "11:30", "12:30").motivo).toBe("valor_invalido");
  });

  it("o caminho feliz", () => {
    expect(podeLancar(tipo(), 2500, "11:30", "12:30")).toEqual({ ok: true });
  });
});

describe("tiposDisponiveis — filtra antes de a pessoa preencher", () => {
  const catalogo: TipoReembolso[] = [
    tipo({ codigo: "almoco", nome: "Almoço", hora_inicio: "11:00", hora_fim: "13:00", ordem: 3 }),
    tipo({ codigo: "janta", nome: "Janta", hora_inicio: "18:00", hora_fim: "21:00", ordem: 4 }),
    tipo({ codigo: "estacionamento", nome: "Estacionamento", hora_inicio: null, hora_fim: null, ordem: 5 }),
    tipo({ codigo: "hospedagem", nome: "Hospedagem", hora_inicio: null, hora_fim: null, ativo: false, ordem: 6 }),
  ];

  it("viagem de manhã até a tarde oferece almoço, não janta", () => {
    const r = tiposDisponiveis(catalogo, "09:00", "15:00").map((t) => t.codigo);
    expect(r).toContain("almoco");
    expect(r).toContain("estacionamento");
    expect(r).not.toContain("janta");
  });

  it("viagem da noite oferece janta, não almoço", () => {
    const r = tiposDisponiveis(catalogo, "17:00", "22:00").map((t) => t.codigo);
    expect(r).toContain("janta");
    expect(r).not.toContain("almoco");
  });

  it("tipo desligado nunca aparece, mesmo sem janela", () => {
    expect(tiposDisponiveis(catalogo, "09:00", "23:00").map((t) => t.codigo)).not.toContain("hospedagem");
  });

  it("sai na ordem cadastrada", () => {
    expect(tiposDisponiveis(catalogo, "09:00", "23:00").map((t) => t.ordem)).toEqual([3, 4, 5]);
  });
});

describe("proximoStatus — quem já foi decidido não volta", () => {
  it("pendente aceita as três ações", () => {
    expect(proximoStatus("pendente", "aprovar")).toBe("aprovado");
    expect(proximoStatus("pendente", "reprovar")).toBe("reprovado");
    expect(proximoStatus("pendente", "cancelar")).toBe("cancelado");
  });

  it("aprovado não se cancela — o valor já entrou na fila de pagamento", () => {
    expect(proximoStatus("aprovado", "cancelar")).toBeNull();
    expect(proximoStatus("aprovado", "reprovar")).toBeNull();
  });

  it("reprovado e cancelado são fim de linha", () => {
    for (const acao of ["aprovar", "reprovar", "cancelar"] as const) {
      expect(proximoStatus("reprovado", acao)).toBeNull();
      expect(proximoStatus("cancelado", acao)).toBeNull();
    }
  });
});

describe("data e competência", () => {
  it("aceita DDMMAAAA e DD/MM/AAAA, como o bot", () => {
    expect(dataParaISO("01012026")).toBe("2026-01-01");
    expect(dataParaISO("01/01/2026")).toBe("2026-01-01");
    expect(dataParaISO("31/12/2026")).toBe("2026-12-31");
  });

  it("recusa data que não existe", () => {
    // O bot deixava 31/02 passar: o Date normaliza para 03/03 em silêncio e o
    // fechamento do mês saía com a viagem no mês errado.
    expect(dataParaISO("31/02/2026")).toBeNull();
    expect(dataParaISO("32/01/2026")).toBeNull();
    expect(dataParaISO("01/13/2026")).toBeNull();
    expect(dataParaISO("abc")).toBeNull();
  });

  it("volta para BR e fecha a competência pelo mês da viagem", () => {
    expect(dataParaBR("2026-01-31")).toBe("31/01/2026");
    expect(competenciaDe("2026-01-31")).toBe("2026-01");
    expect(competenciaLegivel("2026-01")).toBe("Janeiro/2026");
  });
});

describe("rótulos da tela", () => {
  it("descrevem teto e janela sem o componente remontar texto", () => {
    expect(descreveJanela(tipo())).toBe("11:00 às 13:00");
    expect(descreveJanela(tipo({ hora_inicio: null, hora_fim: null }))).toBe("Qualquer horário");
    expect(descreveTeto(tipo({ valor_maximo_centavos: null }))).toBe("Sem teto");
    expect(fmtBRL(3500)).toContain("35,00");
  });
});
