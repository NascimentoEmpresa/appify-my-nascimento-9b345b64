import { describe, expect, it } from "vitest";
import {
  SolicitacaoDiaria,
  avaliarConflitos,
  cnpjValido,
  cpfValido,
  erroChavePix,
  mascaraPix,
  turnosConflitam,
  valorTotalLinha,
  visivelNaLista,
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
  pixTipo: "email",
  diarias: [
    { id: "l1", data: "2026-08-10", turno: "manha", qtVt: 2, valorUnitVt: 5, valorDiaria: 100 },
  ],
  comprovantePonto: [],
  documentos: [],
  observacoes: "",
  solicitanteId: "solicitante-1",
  solicitante: "Fulano",
  comprovantesPagamento: [],
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

  it("ignora solicitação excluída — ela não vira pagamento nenhum", () => {
    const r = avaliarConflitos(
      {
        faltanteCpf: "529.982.247-25",
        diaristaCpf: "111.444.777-35",
        linhas: [{ data: "2026-08-10", turno: "manha" }],
      },
      [solicitacao({ status: "excluida" })],
    );
    expect(r[0]).toBeNull();
  });

  it("solicitação em ajuste CONTINUA ocupando a escala — ela vai voltar", () => {
    const r = avaliarConflitos(
      {
        faltanteCpf: "529.982.247-25",
        diaristaCpf: "111.444.777-35",
        linhas: [{ data: "2026-08-10", turno: "manha" }],
      },
      [solicitacao({ status: "em_ajuste" })],
    );
    expect(r[0]?.tipo).toBe("ambos");
  });
});

/**
 * Exclusão lógica: a solicitação continua no banco (é pagamento a pessoa
 * física, a trilha não pode sumir) mas sai da lista de trabalho.
 */
describe("visivelNaLista", () => {
  it("esconde a excluída da lista padrão", () => {
    expect(visivelNaLista({ status: "excluida" }, "todos")).toBe(false);
    expect(visivelNaLista({ status: "excluida" }, "reprovada")).toBe(false);
  });

  it("mostra a excluída quando se filtra por ela de propósito", () => {
    expect(visivelNaLista({ status: "excluida" }, "excluida")).toBe(true);
  });

  it("não mexe nos outros status", () => {
    expect(visivelNaLista({ status: "solicitada" }, "todos")).toBe(true);
    expect(visivelNaLista({ status: "em_ajuste" }, "excluida")).toBe(true);
  });
});

/**
 * Chave Pix — o campo era texto livre com quatro formatos possíveis e nenhuma
 * conferência. Chave errada é dinheiro na conta de outra pessoa, e o erro só
 * aparece depois do pagamento.
 */
describe("chave Pix", () => {
  it("formata conforme o tipo escolhido", () => {
    expect(mascaraPix("cpf", "52998224725")).toBe("529.982.247-25");
    expect(mascaraPix("cnpj", "11222333000181")).toBe("11.222.333/0001-81");
    expect(mascaraPix("celular", "11987654321")).toBe("(11) 98765-4321");
    // Fixo de 8 dígitos: o traço anda uma casa para trás.
    expect(mascaraPix("celular", "1133334444")).toBe("(11) 3333-4444");
    // E-mail não tem máscara — só o espaço sobrando sai.
    expect(mascaraPix("email", "  nome@empresa.com  ")).toBe("nome@empresa.com");
  });

  it("exige o tipo antes da chave", () => {
    expect(erroChavePix("", "qualquer coisa")).toBe("Escolha o tipo da chave Pix.");
  });

  it("recusa a chave que não serve para o tipo", () => {
    expect(erroChavePix("cpf", "529.982.247-26")).toBe("CPF inexistente.");
    expect(erroChavePix("email", "nome-sem-arroba")).toBe("E-mail inválido.");
    expect(erroChavePix("celular", "(11) 9876")).toContain("DDD");
    expect(erroChavePix("cnpj", "11.222.333/0001-82")).toBe("CNPJ inexistente.");
  });

  it("aceita as quatro formas válidas", () => {
    expect(erroChavePix("cpf", "529.982.247-25")).toBeNull();
    expect(erroChavePix("cnpj", "11.222.333/0001-81")).toBeNull();
    expect(erroChavePix("celular", "(11) 98765-4321")).toBeNull();
    expect(erroChavePix("email", "diarista@empresa.com.br")).toBeNull();
  });
});

describe("cnpjValido", () => {
  it("confere o dígito verificador, não só o tamanho", () => {
    expect(cnpjValido("11.222.333/0001-81")).toBe(true);
    expect(cnpjValido("11.222.333/0001-80")).toBe(false);
    expect(cnpjValido("11111111111111")).toBe(false);
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
