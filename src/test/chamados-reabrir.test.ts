import { describe, it, expect } from "vitest";
import { podeReabrirChamado, statusAoReabrir } from "@/pages/chamados/types";

// O que está sendo travado aqui é o contrato com o BANCO. `podeReabrirChamado`
// espelha o trigger chamado_sistema_guard: se a tela liberar mais do que ele,
// o botão aparece e o UPDATE volta com "Sem permissão para alterar o status".
const chamado = (over: Partial<{ status: string; responsavel_id: string | null }> = {}) => ({
  status: "concluido",
  responsavel_id: null as string | null,
  ...over,
});

const NINGUEM = { canCoordenar: false, canAprovar: false, canDev: false, userId: "u1" };

describe("statusAoReabrir", () => {
  it("com responsável, volta direto para a fila dele", () => {
    expect(statusAoReabrir({ responsavel_id: "dev1" })).toBe("em_andamento");
  });

  it("sem responsável, volta para a mesa da coordenação", () => {
    expect(statusAoReabrir({ responsavel_id: null })).toBe("aberto");
  });
});

describe("podeReabrirChamado", () => {
  it("não oferece reabrir o que ainda está em andamento", () => {
    for (const status of ["aberto", "em_andamento", "aguardando_retorno"]) {
      expect(podeReabrirChamado(chamado({ status }), { ...NINGUEM, canCoordenar: true })).toBe(false);
    }
  });

  it("vale tanto para concluído quanto para reprovado", () => {
    for (const status of ["concluido", "reprovado"]) {
      expect(podeReabrirChamado(chamado({ status }), { ...NINGUEM, canCoordenar: true })).toBe(true);
    }
  });

  it("quem coordena ou aprova reabre qualquer chamado", () => {
    expect(podeReabrirChamado(chamado(), { ...NINGUEM, canCoordenar: true })).toBe(true);
    expect(podeReabrirChamado(chamado(), { ...NINGUEM, canAprovar: true })).toBe(true);
  });

  it("dev reabre o que é dele", () => {
    expect(podeReabrirChamado(chamado({ responsavel_id: "u1" }), { ...NINGUEM, canDev: true })).toBe(true);
  });

  it("dev NÃO reabre chamado de outro dev", () => {
    expect(podeReabrirChamado(chamado({ responsavel_id: "outro" }), { ...NINGUEM, canDev: true })).toBe(false);
  });

  it("dev sem responsável definido não reabre — o trigger recusaria", () => {
    expect(podeReabrirChamado(chamado({ responsavel_id: null }), { ...NINGUEM, canDev: true })).toBe(false);
  });

  // Este é o caso que motivou a função: `gestor` na tela = painel OU coordenar
  // OU aprovar, mas só o painel NÃO autoriza troca de status no banco.
  it("só ver o Painel de Distribuição não dá direito de reabrir", () => {
    expect(podeReabrirChamado(chamado({ responsavel_id: "dev1" }), NINGUEM)).toBe(false);
  });

  it("sem usuário logado, a via do dev não abre", () => {
    expect(podeReabrirChamado(chamado({ responsavel_id: "u1" }), { ...NINGUEM, canDev: true, userId: null })).toBe(false);
  });
});
