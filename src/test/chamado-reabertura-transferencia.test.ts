import { describe, it, expect } from "vitest";
import {
  MIN_MOTIVO, motivoValido, podeDecidir, opcoesDesenvolvedor, destinosTransferencia,
  reaberturaEmDestaque, fraseEventoReabertura, type Reabertura,
} from "@/lib/chamados/reabertura";

// Espelho das regras da mig 20261112190000 (as RPCs são quem manda). Se a
// tela liberar mais que o banco, o botão aparece e a RPC devolve erro.

const reab = (over: Partial<Reabertura> = {}): Reabertura => ({
  id: 1, chamado_id: "c1", solicitado_por: "sol", motivo: "faltou a coluna", status: "pendente",
  status_chamado: "concluido", responsavel_anterior: "d1", responsavel_novo: null,
  decidido_por: null, decidido_em: null, motivo_decisao: null, created_at: "2026-11-12T10:00:00Z",
  ...over,
});

describe("motivo obrigatório (negar reabertura / recusar ou pedir transferência)", () => {
  it("exige o mesmo mínimo das RPCs, sem contar espaços", () => {
    expect(MIN_MOTIVO).toBe(5);
    expect(motivoValido("")).toBe(false);
    expect(motivoValido("   abc   ")).toBe(false);
    expect(motivoValido(null)).toBe(false);
    expect(motivoValido("fora do escopo")).toBe(true);
  });
});

describe("quem decide", () => {
  it("Gestor de Sistemas ou Coordenar — mesma regra de chamado_pode_decidir", () => {
    expect(podeDecidir({ canGestorSistemas: true, canCoordenar: false })).toBe(true);
    expect(podeDecidir({ canGestorSistemas: false, canCoordenar: true })).toBe(true);
    expect(podeDecidir({ canGestorSistemas: false, canCoordenar: false })).toBe(false);
  });
});

describe("opções do Confirmar reabertura", () => {
  const devs = [
    { id: "d3", display_name: "Zélia" },
    { id: "d1", display_name: "Bruno" },
    { id: "d2", display_name: "Ana" },
  ];
  it("o dev atual vem primeiro (manter o mesmo), os outros em ordem alfabética", () => {
    const o = opcoesDesenvolvedor(devs, "d1");
    expect(o.map((d) => d.id)).toEqual(["d1", "d2", "d3"]);
    expect(o[0].atual).toBe(true);
    expect(o.slice(1).every((d) => !d.atual)).toBe(true);
  });
  it("sem dev atual (ou dev que saiu da lista), ninguém é marcado como atual", () => {
    expect(opcoesDesenvolvedor(devs, null).some((d) => d.atual)).toBe(false);
    expect(opcoesDesenvolvedor(devs, "fora").map((d) => d.id)).toEqual(["d2", "d1", "d3"]);
  });
  it("o dev não pede transferência para si mesmo", () => {
    expect(destinosTransferencia(devs, "d1").map((d) => d.id)).toEqual(["d3", "d2"]);
  });
});

describe("card CHAMADO REABERTO em destaque", () => {
  const agora = new Date("2026-11-20T10:00:00Z");
  it("sempre enquanto pendente", () => {
    expect(reaberturaEmDestaque(reab(), agora)).toBe(true);
  });
  it("decidido, fica uma semana mostrando o desfecho", () => {
    expect(reaberturaEmDestaque(reab({ status: "negada", decidido_em: "2026-11-15T10:00:00Z" }), agora)).toBe(true);
    expect(reaberturaEmDestaque(reab({ status: "confirmada", decidido_em: "2026-11-12T09:00:00Z" }), agora)).toBe(false);
  });
  it("sem pedido, sem card", () => {
    expect(reaberturaEmDestaque(null, agora)).toBe(false);
  });
});

describe("chat: textos gravados pelas RPCs", () => {
  it("pedido de reabertura, sem o sufixo técnico", () => {
    expect(fraseEventoReabertura(
      "Reabertura solicitada: não atendeu o solicitado — faltou a coluna (aguardando o Gestor de Sistemas)", "Cassio",
    )).toBe("Cassio pediu para reabrir o chamado — não atendeu o solicitado — faltou a coluna");
  });
  it("reabertura negada", () => {
    expect(fraseEventoReabertura("Reabertura negada: fora do escopo", "Iury")).toBe("Iury negou a reabertura — fora do escopo");
  });
  it("Transferido para <dev> (gatilho de troca de responsável)", () => {
    expect(fraseEventoReabertura("Transferido para HELENA NASCIMENTO", "Iury")).toBe("Transferido para HELENA NASCIMENTO");
  });
  it("não mexe nos outros eventos — 'Chamado reaberto: …' segue contado pela bonificação", () => {
    expect(fraseEventoReabertura("Chamado reaberto: não atendeu o solicitado — x", "Iury")).toBeNull();
    expect(fraseEventoReabertura("Chamado direcionado a Ana", "Iury")).toBeNull();
  });
});
