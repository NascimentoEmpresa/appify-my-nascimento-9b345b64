import { describe, it, expect } from "vitest";
import {
  acharVinculo, classificarTrecho, contarPor, ehSupervisor, extrairFalas, lerCabecalho, lerVinculos, levantamento,
  normalizarTranscricao, separarReunioes, temasRecorrentes, trechosDaFala, type RegistroDash,
} from "@/lib/controladoria/reunioes";

// =====================================================================
// Controladoria › Reuniões com Encarregados (mig 20261006000005):
// leitura das transcrições e classificação por regras.
// =====================================================================

const MEET = `Reunião iniciada em 2026-09-28 14:24 GMT-3
Participantes
Dickson Souza, Barbara Marques, Claudio Rene
Transcrição
Dickson Souza: Bom dia pessoal, vamos começar. Como está o ponto de vocês?
Barbara Marques: Então, o ponto continua dando problema, o aplicativo não abre e o pessoal não consegue bater.
continua assim faz uma semana.
Claudio Rene: Aqui na Câmara está faltando material de limpeza, o pedido não chegou ainda.
Barbara Marques: Ok, obrigado.`;

describe("leitura da transcrição", () => {
  it("lê data e participantes do cabeçalho do Meet", () => {
    expect(lerCabecalho(MEET)).toEqual({ data: "2026-09-28", participantes: ["Dickson Souza", "Barbara Marques", "Claudio Rene"] });
    expect(lerCabecalho("Reunião de 11/09/2026").data).toBe("2026-09-11");
    expect(lerCabecalho("sem data nenhuma").data).toBeNull();
  });
  it("separa quem falou o quê e junta a linha de continuação", () => {
    const f = extrairFalas(MEET);
    expect(f).toHaveLength(4);
    expect(f[1].falante).toBe("Barbara Marques");
    expect(f[1].texto).toMatch(/bater\. continua assim/);
  });
  it("limpa VTT do Teams (tempo, número, <v>)", () => {
    const vtt = "WEBVTT\n\n1\n00:00:01.000 --> 00:00:04.000\n<v Ana Paula>O uniforme não chegou.</v>\n";
    expect(normalizarTranscricao(vtt)).toBe("Ana Paula: O uniforme não chegou.");
  });
  it("texto colado com dois cabeçalhos vira duas reuniões", () => {
    expect(separarReunioes(`${MEET}\n\n${MEET.replace("2026-09-28", "2026-10-02")}`)).toHaveLength(2);
    expect(separarReunioes("texto sem cabeçalho")).toHaveLength(1);
  });
  it("quebra fala comprida em trechos", () => {
    const longa = "Frase de teste com bastante coisa escrita aqui. ".repeat(30);
    const t = trechosDaFala(longa, 300);
    expect(t.length).toBeGreaterThan(1);
    expect(t.every((x) => x.length <= 300)).toBe(true);
  });
});

describe("classificação", () => {
  it("ponto com problema → Ponto e acesso digital / dificuldade", () => {
    expect(classificarTrecho("O ponto continua dando problema, o aplicativo não abre")).toMatchObject({ tema: "Ponto e acesso digital", tipo: "dificuldade" });
  });
  it("pergunta sobre férias → Pessoal / dúvida", () => {
    expect(classificarTrecho("Queria saber como faço para marcar as férias da equipe?")).toMatchObject({ tema: "Pessoal, férias e cobertura", tipo: "duvida" });
  });
  it("fala sem tema ou sem reclamação/dúvida não vira registro", () => {
    expect(classificarTrecho("Bom dia a todos, obrigado pela presença hoje.")).toBeNull();
    expect(classificarTrecho("O uniforme novo ficou muito bonito na equipe.")).toBeNull();
    expect(classificarTrecho("ok")).toBeNull();
  });
});

describe("vínculos e supervisor", () => {
  const v = lerVinculos("Barbara Marques | FURG PORTARIA\nClaudio Rene | CÂMARA RIO GRANDE LIMPEZA | Claudio René Silva Bueno\nSupervisor Dickson\nEncarregada Ana Lima - UFRGS LIMPEZA");
  it("lê os três formatos e ignora a linha do supervisor", () => {
    expect(v).toHaveLength(3);
    expect(v[1]).toEqual({ encarregado: "Claudio Rene", contrato: "CÂMARA RIO GRANDE LIMPEZA", nome_transcricao: "Claudio René Silva Bueno" });
    expect(v[2]).toMatchObject({ encarregado: "Ana Lima", contrato: "UFRGS LIMPEZA" });
  });
  it("acha o vínculo sem acento e pelo primeiro + último nome", () => {
    expect(acharVinculo("claudio rene silva bueno", v)?.contrato).toBe("CÂMARA RIO GRANDE LIMPEZA");
    expect(acharVinculo("Bárbara Souza Marques", v)?.encarregado).toBe("Barbara Marques");
    expect(acharVinculo("Fulano", v)).toBeNull();
  });
  it("supervisor pelo primeiro nome", () => {
    expect(ehSupervisor("Dickson Souza", "Dickson")).toBe(true);
    expect(ehSupervisor("Barbara Marques", "Dickson")).toBe(false);
  });
});

describe("levantamento da reunião", () => {
  it("tira a fala do supervisor e liga o contrato pelo vínculo", () => {
    const r = levantamento(MEET, { supervisor: "Dickson", vinculos: lerVinculos("Barbara Marques | FURG PORTARIA\nClaudio Rene | CÂMARA RIO GRANDE") });
    expect(r.map((x) => [x.encarregado, x.contrato, x.tema, x.tipo])).toEqual([
      ["Barbara Marques", "FURG PORTARIA", "Ponto e acesso digital", "dificuldade"],
      ["Claudio Rene", "CÂMARA RIO GRANDE", "Compras e manutenção", "dificuldade"],
    ]);
  });
});

describe("dashboard", () => {
  const regs: RegistroDash[] = [
    { reuniao_id: "a", tema: "Ponto", tipo: "dificuldade", status: "pendente", contrato: "X", encarregado: "Ana" },
    { reuniao_id: "a", tema: "Ponto", tipo: "duvida", status: "validado", contrato: "X", encarregado: "Ana" },
    { reuniao_id: "b", tema: "Ponto", tipo: "dificuldade", status: "validado", contrato: "Y", encarregado: null },
    { reuniao_id: "b", tema: "Férias", tipo: "dificuldade", status: "excluido", contrato: "Y", encarregado: "Bia" },
  ];
  it("tema conta reuniões, não registros, e ignora excluídos", () => {
    expect(temasRecorrentes(regs, 2)).toEqual([{ tema: "Ponto", reunioes: 2, pct: 100 }]);
  });
  it("contagem por contrato/encarregado", () => {
    expect(contarPor(regs, (r) => r.contrato)).toEqual([{ nome: "X", n: 2 }, { nome: "Y", n: 1 }]);
    expect(contarPor(regs, (r) => r.encarregado)).toEqual([{ nome: "Ana", n: 2 }, { nome: "(não informado)", n: 1 }]);
  });
});
