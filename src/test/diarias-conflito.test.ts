import { describe, expect, it } from "vitest";
import {
  SolicitacaoDiaria,
  avaliarConflitos,
  cpfValido,
  turnosConflitam,
  valorTotalLinha,
} from "@/pages/operacional/diarias";

/**
 * Duplicidade de escala — a regra que impede pagar duas diárias para a mesma
 * pessoa no mesmo turno.
 *
 * Ela existe em DOIS lugares: aqui (avisa o usuário linha a linha enquanto ele
 * digita) e na trigger `diaria_linha_valida()` da migration
 * 20260930000019_operacional_diarias.sql (a barreira de verdade, porque o
 * front fala direto com o Supabase pela anon key). Este teste trava o
 * comportamento do lado do front para os dois não divergirem em silêncio.
 */

const solicitacao = (over: Partial<SolicitacaoDiaria> = {}): SolicitacaoDiaria => ({
  uuid: "u1",
  id: "SD-2026-000001",
  criadoEm: "01/08/2026",
  status: "solicitada",
  contratoId: "c1",
  contratoNome: "Contrato 1",
  contratoCliente: "Cliente",
  contratoEmpresa: "Empresa",
  posto: "Posto A",
  faltanteNome: "Faltante",
  faltanteCpf: "529.982.247-25",
  diaristaNome: "Diarista",
  diaristaCpf: "111.444.777-35",
  pix: "x@y.com",
  diarias: [
    { id: "l1", data: "2026-08-10", turno: "manha", qtVt: 2, valorUnitVt: 5, valorDiaria: 100 },
  ],
  comprovantePonto: [],
  documentos: [],
  observacoes: "",
  solicitanteId: "solicitante-1",
  solicitante: "Fulano",
  ...over,
});

describe("turnos", () => {
  it("dia inteiro cobre os três turnos", () => {
    expect(turnosConflitam("dia_inteiro", "manha")).toBe(true);
    expect(turnosConflitam("noite", "dia_inteiro")).toBe(true);
  });

  it("turnos diferentes não conflitam entre si", () => {
    expect(turnosConflitam("manha", "tarde")).toBe(false);
  });
});

describe("avaliarConflitos", () => {
  it("acusa a mesma data e turno repetidos dentro da própria solicitação", () => {
    const r = avaliarConflitos(
      {
        faltanteCpf: "529.982.247-25",
        diaristaCpf: "111.444.777-35",
        linhas: [
          { data: "2026-08-10", turno: "manha" },
          { data: "2026-08-10", turno: "manha" },
        ],
      },
      [],
    );
    expect(r[0]?.tipo).toBe("ambos");
    expect(r[1]?.tipo).toBe("ambos");
  });

  it("acusa contra o que já está lançado, casando CPF pelos dígitos", () => {
    const r = avaliarConflitos(
      {
        // Mesmo faltante, sem pontuação — tem que casar assim mesmo.
        faltanteCpf: "52998224725",
        diaristaCpf: "987.654.321-00",
        linhas: [{ data: "2026-08-10", turno: "dia_inteiro" }],
      },
      [solicitacao()],
    );
    expect(r[0]?.tipo).toBe("faltante");
  });

  it("ignora solicitação reprovada — refazer a corrigida é o fluxo normal", () => {
    const r = avaliarConflitos(
      {
        faltanteCpf: "529.982.247-25",
        diaristaCpf: "111.444.777-35",
        linhas: [{ data: "2026-08-10", turno: "manha" }],
      },
      [solicitacao({ status: "reprovada" })],
    );
    expect(r[0]).toBeNull();
  });
});

describe("valor da linha", () => {
  it("soma a diária com o VT (quantidade x unitário)", () => {
    expect(valorTotalLinha({ qtVt: 2, valorUnitVt: 5.5, valorDiaria: 100 })).toBe(111);
  });
});

describe("cpfValido", () => {
  it("recusa CPF de dígito verificador errado", () => {
    expect(cpfValido("529.982.247-26")).toBe(false);
    expect(cpfValido("529.982.247-25")).toBe(true);
  });
});
