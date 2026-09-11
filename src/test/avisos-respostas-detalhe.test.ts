import { describe, expect, it } from "vitest";
import {
  ordenarRespostas, respostasComNome, type CienciaNotificacao,
} from "@/lib/notificacoes";

// Pedido do Pablo (10/09/2026): "preciso que aqui em visualizar tenha opção de
// ver quem respondeu discordo e concordo". O painel só serve se, num aviso com
// dezenas de respostas, quem discordou aparecer sem precisar rolar — é o único
// grupo que pede alguma providência de quem publicou.

function ciencia(over: Partial<CienciaNotificacao> = {}): CienciaNotificacao {
  return {
    notificacao_id: 1,
    user_id: "u1",
    escolha: "CONCORDO",
    respondido_em: "2026-09-10T09:00:00Z",
    ...over,
  };
}

describe("ordenarRespostas", () => {
  it("põe DISCORDO na frente de CONCORDO e de CIENTE, mesmo tendo respondido por último", () => {
    const ordenadas = ordenarRespostas([
      ciencia({ user_id: "a", escolha: "CONCORDO", respondido_em: "2026-09-10T08:00:00Z" }),
      ciencia({ user_id: "b", escolha: "CIENTE", respondido_em: "2026-09-10T08:30:00Z" }),
      ciencia({ user_id: "c", escolha: "DISCORDO", respondido_em: "2026-09-10T07:00:00Z" }),
    ]);
    expect(ordenadas.map((r) => r.user_id)).toEqual(["c", "a", "b"]);
  });

  it("dentro da mesma escolha, a resposta mais recente vem primeiro", () => {
    const ordenadas = ordenarRespostas([
      ciencia({ user_id: "antigo", respondido_em: "2026-09-01T10:00:00Z" }),
      ciencia({ user_id: "novo", respondido_em: "2026-09-09T10:00:00Z" }),
    ]);
    expect(ordenadas.map((r) => r.user_id)).toEqual(["novo", "antigo"]);
  });

  it("não mexe no array que recebeu — a lista da tela vem do cache do React Query", () => {
    const original = [
      ciencia({ user_id: "a", escolha: "CONCORDO" }),
      ciencia({ user_id: "b", escolha: "DISCORDO" }),
    ];
    ordenarRespostas(original);
    expect(original.map((r) => r.user_id)).toEqual(["a", "b"]);
  });
});

describe("respostasComNome", () => {
  it("resolve o nome pelo id do profile", () => {
    const lista = respostasComNome(
      [ciencia({ user_id: "u1" })],
      new Map([["u1", "Iury de Jesus Silva"]]),
    );
    expect(lista[0].nome).toBe("Iury de Jesus Silva");
  });

  it("quem não está mais em profiles continua na lista, com rótulo próprio", () => {
    // Sumir com a linha faria a lista mostrar 1 resposta embaixo de um cartão
    // que diz 2, e quem administra iria procurar bug onde não há.
    const lista = respostasComNome(
      [ciencia({ user_id: "u1" }), ciencia({ user_id: "sumiu" })],
      new Map([["u1", "Iury"]]),
    );
    expect(lista).toHaveLength(2);
    expect(lista.map((r) => r.nome)).toContain("(usuário removido)");
  });

  it("mantém a ordem de ordenarRespostas: discordo primeiro", () => {
    const lista = respostasComNome(
      [
        ciencia({ user_id: "u1", escolha: "CONCORDO" }),
        ciencia({ user_id: "u2", escolha: "DISCORDO" }),
      ],
      new Map([["u1", "Ana"], ["u2", "Bruno"]]),
    );
    expect(lista.map((r) => r.nome)).toEqual(["Bruno", "Ana"]);
  });
});
