import { describe, expect, it } from "vitest";
import {
  estaAtivo,
  iniciais,
  INATIVIDADE_AUSENTE_MS,
  JANELA_ONLINE_MS,
  montarListaPresenca,
  statusPresenca,
  type PresencaLinha,
} from "@/lib/presencaOnline";

const AGORA = "2026-10-30T15:00:00.000Z";
const antes = (msAtras: number) => new Date(Date.parse(AGORA) - msAtras).toISOString();

describe("statusPresenca", () => {
  it("heartbeat recente e ativo = online", () => {
    expect(statusPresenca(antes(10_000), antes(10_000), AGORA)).toBe("online");
  });

  it("aba aberta mas parada = ausente", () => {
    expect(statusPresenca(antes(10_000), antes(JANELA_ONLINE_MS + 1), AGORA)).toBe("ausente");
  });

  it("no limite exato da janela ainda está online", () => {
    expect(statusPresenca(antes(JANELA_ONLINE_MS), antes(JANELA_ONLINE_MS), AGORA)).toBe("online");
  });

  it("sem heartbeat além da janela = offline, mesmo que ativo_em seja recente", () => {
    expect(statusPresenca(antes(JANELA_ONLINE_MS + 1), antes(0), AGORA)).toBe("offline");
  });

  it("data ausente ou inválida = offline", () => {
    expect(statusPresenca(null, null, AGORA)).toBe("offline");
    expect(statusPresenca("lixo", antes(0), AGORA)).toBe("offline");
  });

  it("um heartbeat perdido (2 min) não derruba ninguém", () => {
    expect(statusPresenca(antes(120_000), antes(120_000), AGORA)).toBe("online");
  });
});

describe("estaAtivo", () => {
  const t = Date.parse(AGORA);
  it("aba escondida nunca é ativa", () => {
    expect(estaAtivo(false, t, t)).toBe(false);
  });
  it("aba visível com interação recente é ativa", () => {
    expect(estaAtivo(true, t - 1000, t)).toBe(true);
  });
  it("aba visível parada há muito tempo vira ausente", () => {
    expect(estaAtivo(true, t - INATIVIDADE_AUSENTE_MS, t)).toBe(false);
  });
});

describe("montarListaPresenca", () => {
  const linha = (nome: string, visto: number, ativo: number): PresencaLinha => ({
    user_id: nome,
    nome,
    avatar_url: null,
    setor: null,
    visto_em: antes(visto),
    ativo_em: antes(ativo),
  });

  it("tira offline, põe online antes de ausente e ordena por nome sem acento", () => {
    const lista = montarListaPresenca(
      [
        linha("Zeca", 0, 0),
        linha("Érica", 0, 0),
        linha("Bruno", 0, JANELA_ONLINE_MS + 1),
        linha("Ana", 0, JANELA_ONLINE_MS + 1),
        linha("Carlos", JANELA_ONLINE_MS + 1, 0),
      ],
      AGORA,
    );
    expect(lista.map((p) => `${p.nome}:${p.status}`)).toEqual([
      "Érica:online",
      "Zeca:online",
      "Ana:ausente",
      "Bruno:ausente",
    ]);
  });
});

describe("iniciais", () => {
  it("primeira e última palavra", () => {
    expect(iniciais("Ana Luiza Faleiro")).toBe("AF");
    expect(iniciais("cálita")).toBe("C");
    expect(iniciais("  ")).toBe("?");
    expect(iniciais(null)).toBe("?");
  });
});
