import { describe, expect, it } from "vitest";
import {
  calcularIndicadores, casarParticipante, detectarColunas, escalaDaColuna, formatarCpf, horasEntre,
  lerAvaliacoes, lerDataPlanilha, lerNota, lerSatisfacao, mediasPorPergunta, nomeArquivoSeguro,
  normalizarCpf, siglaEmpresa, valorEscala,
} from "@/lib/treinamentos/contratoTreinamento";

describe("treinamentos por contrato — empresa e CPF", () => {
  it("sigla da empresa pelo código da Senior", () => {
    expect(siglaEmpresa(1)).toBe("HAGG");
    expect(siglaEmpresa(5)).toBe("NH");
    expect(siglaEmpresa(2)).toBe("SN");
    expect(siglaEmpresa(3)).toBe("CANAÃ");
    expect(siglaEmpresa(9)).toBe("Empresa 9");
  });
  it("CPF: só dígitos, devolve o zero que o Excel comeu", () => {
    expect(normalizarCpf("012.345.678-90")).toBe("01234567890");
    expect(normalizarCpf(1234567890)).toBe("01234567890");
    expect(normalizarCpf("123")).toBeNull();
    expect(normalizarCpf("")).toBeNull();
    expect(formatarCpf("1234567890")).toBe("012.345.678-90");
  });
});

describe("lerNota", () => {
  it("formato do Google Forms", () => {
    expect(lerNota("8 / 10")).toEqual({ nota: 8, acertos: 8, total: 10 });
    expect(lerNota("15/20")).toEqual({ nota: 7.5, acertos: 15, total: 20 });
    expect(lerNota("3 de 4")).toEqual({ nota: 7.5, acertos: 3, total: 4 });
  });
  it("percentual, decimal com vírgula e número", () => {
    expect(lerNota("80%").nota).toBe(8);
    expect(lerNota("8,5").nota).toBe(8.5);
    expect(lerNota(9).nota).toBe(9);
    expect(lerNota(85).nota).toBe(8.5);
  });
  it("lixo e impossível viram null", () => {
    expect(lerNota("abc").nota).toBeNull();
    expect(lerNota("11 / 10").nota).toBeNull();
    expect(lerNota("").nota).toBeNull();
    expect(lerNota(null).nota).toBeNull();
  });
});

describe("lerDataPlanilha", () => {
  it("dd/mm/aaaa com e sem hora", () => {
    const d = new Date(lerDataPlanilha("04/11/2026 10:22:33")!);
    expect([d.getDate(), d.getMonth() + 1, d.getFullYear(), d.getHours(), d.getMinutes()]).toEqual([4, 11, 2026, 10, 22]);
    expect(new Date(lerDataPlanilha("31/12/2026")!).getDate()).toBe(31);
    expect(lerDataPlanilha("31/02/2026")).toBeNull();
  });
  it("serial do Excel", () => {
    const d = new Date(lerDataPlanilha(46330.5)!); // 04/11/2026 12:00
    expect([d.getDate(), d.getMonth() + 1, d.getFullYear(), d.getHours()]).toEqual([4, 11, 2026, 12]);
  });
});

describe("detectarColunas", () => {
  it("reconhece o export do Google Forms", () => {
    const c = detectarColunas(["Carimbo de data/hora", "Endereço de e-mail", "Pontuação", "Nome completo", "CPF", "1) O que é EPI?", "Comentários"]);
    expect(c.nome).toBe("Nome completo");
    expect(c.cpf).toBe("CPF");
    expect(c.nota).toBe("Pontuação");
    expect(c.data).toBe("Carimbo de data/hora");
    expect(c.comentario).toBe("Comentários");
    expect(c.perguntas).toEqual(["1) O que é EPI?"]);
  });
});

describe("lerAvaliacoes", () => {
  const linhas = [
    { "Carimbo de data/hora": "04/11/2026 10:00:00", "Pontuação": "8 / 10", "Nome": "Ana Souza", "CPF": "123.456.789-01", "Q1": "B" },
    { "Carimbo de data/hora": "04/11/2026 10:05:00", "Pontuação": "5 / 10", "Nome": "Bruno Lima", "CPF": "", "Q1": "A" },
    { "Carimbo de data/hora": "", "Pontuação": "", "Nome": "", "CPF": "", "Q1": "" },
    { "Carimbo de data/hora": "04/11/2026 10:06:00", "Pontuação": "x", "Nome": "Carla", "CPF": "", "Q1": "" },
  ];
  it("lê, aprova pela nota mínima e avisa o que não entendeu", () => {
    const r = lerAvaliacoes(linhas, 7);
    expect(r.itens).toHaveLength(3);
    expect(r.itens[0]).toMatchObject({ nome: "Ana Souza", cpf: "12345678901", nota: 8, acertos: 8, total: 10, aprovado: true, respostas: { Q1: "B" } });
    expect(r.itens[1]).toMatchObject({ nome: "Bruno Lima", cpf: null, nota: 5, aprovado: false });
    expect(r.itens[2]).toMatchObject({ nome: "Carla", nota: null, aprovado: null });
    expect(r.erros.some((e) => e.includes("Linha 5") && e.includes("não reconhecida"))).toBe(true);
  });
  it("sem coluna de nome não importa nada", () => {
    const r = lerAvaliacoes([{ Pontuação: "8 / 10" }]);
    expect(r.itens).toHaveLength(0);
    expect(r.erros[0]).toMatch(/nome/);
  });
});

describe("satisfação", () => {
  it("escala 1–5 vira 0–10; texto de escala também", () => {
    expect(valorEscala("5", 5)).toBe(10);
    expect(valorEscala("Ótimo", 5)).toBe(10);
    expect(valorEscala("Regular", 5)).toBe(6);
    expect(valorEscala("8", 10)).toBe(8);
    expect(valorEscala("talvez", 5)).toBeNull();
    expect(escalaDaColuna(["1", "4", "5"])).toBe(5);
    expect(escalaDaColuna([7, 10])).toBe(10);
    expect(escalaDaColuna(["sim", "não"])).toBeNull();
  });
  it("lerSatisfacao: média das perguntas de escala, comentário à parte", () => {
    const r = lerSatisfacao([
      { "Carimbo de data/hora": "04/11/2026 11:00", "Conteúdo": 5, "Instrutor": "Ótimo", "Local": 3, "Sugestões": "Mais exemplos" },
      { "Carimbo de data/hora": "04/11/2026 11:01", "Conteúdo": 4, "Instrutor": "Bom", "Local": 4, "Sugestões": "" },
    ]);
    expect(r.itens).toHaveLength(2);
    // (10 + 10 + 6) / 3
    expect(r.itens[0].nota).toBe(8.67);
    expect(r.itens[0].comentario).toBe("Mais exemplos");
    expect(r.itens[0].nome).toBeNull();
    expect(r.itens[1].nota).toBe(8);
    expect(mediasPorPergunta(r.itens.map((i) => i.respostas))).toEqual([
      { pergunta: "Conteúdo", media: 9, n: 2 },
      { pergunta: "Instrutor", media: 9, n: 2 },
      { pergunta: "Local", media: 7, n: 2 },
    ]);
  });
});

describe("participantes e indicadores", () => {
  const parts = [
    { id: 1, nome: "Ana Souza", cpf: "12345678901", presente: true },
    { id: 2, nome: "José da Silva", cpf: null, presente: true },
    { id: 3, nome: "Maria", cpf: null, presente: false },
  ];
  it("casa pelo CPF e, sem CPF, pelo nome sem acento", () => {
    expect(casarParticipante({ nome: "outro", cpf: "123.456.789-01" }, parts)?.id).toBe(1);
    expect(casarParticipante({ nome: "JOSE DA SILVA", cpf: null }, parts)?.id).toBe(2);
    expect(casarParticipante({ nome: "Ninguém", cpf: null }, parts)).toBeNull();
  });
  it("indicadores", () => {
    const i = calcularIndicadores({
      participantes: parts,
      avaliacoes: [{ nota: 8, aprovado: true }, { nota: 5, aprovado: false }, { nota: null, aprovado: null }],
      satisfacao: [{ nota: 9 }, { nota: 7 }, { nota: null }],
    });
    expect(i).toMatchObject({ participantes: 3, presentes: 2, taxaPresenca: 66.7, avaliacoes: 3, notaMedia: 6.5, aprovados: 1, taxaAprovacao: 50, respostasSatisfacao: 3, satisfacaoMedia: 8 });
    expect(calcularIndicadores({ participantes: [], avaliacoes: [], satisfacao: [] }).taxaPresenca).toBeNull();
  });
  it("carga horária pelos horários", () => {
    expect(horasEntre("08:00", "12:30")).toBe(4.5);
    expect(horasEntre("08:00:00", "08:00:00")).toBeNull();
    expect(horasEntre(null, "10:00")).toBeNull();
  });
  it("nome de arquivo seguro", () => {
    expect(nomeArquivoSeguro("Lista de presença – manhã.pdf")).toBe("Lista_de_presenca_manha.pdf");
  });
});
