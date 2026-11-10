import { describe, expect, it } from "vitest";
import {
  aguardandoGestorSistemas, montarLinhaDoTempo, podeFinalizarGestao, resumoStatus,
} from "@/pages/chamados/validacaoPresidencia";

// Pedido do Pablo (10/11/2026, mig 20261110009000): depois do dev concluir e
// do solicitante confirmar, o Gestor de Sistemas finaliza — só aí o chamado
// está de fato concluído. Mesma régua da RPC chamado_finalizar_gestao.

const base = {
  status: "concluido",
  created_at: "2026-11-01T10:00:00Z",
  responsavel_id: "joao",
  concluido_em: "2026-11-09T10:00:00Z",
  motivo_reprovacao: null,
  motivo_cancelamento: null,
  cancelado_em: null,
  updated_at: "2026-11-09T10:00:00Z",
  conclusao_confirmada_em: "2026-11-10T09:00:00Z" as string | null,
  gestao_finalizada_em: null as string | null,
  desenvolvimento_iniciado_em: "2026-11-02T10:00:00Z",
  prazo_conclusao_em: null,
};

describe("etapa do Gestor de Sistemas", () => {
  it("confirmado pelo solicitante e sem finalizar = aguardando o gestor", () => {
    expect(aguardandoGestorSistemas(base)).toBe(true);
    expect(resumoStatus(base, null)).toBe("Aguardando o Gestor de Sistemas");
  });
  it("sem a confirmação do solicitante o gestor ainda não finaliza", () => {
    const c = { ...base, conclusao_confirmada_em: null };
    expect(aguardandoGestorSistemas(c)).toBe(false);
    expect(podeFinalizarGestao(c, true)).toBe(false);
  });
  it("só o Gestor de Sistemas finaliza", () => {
    expect(podeFinalizarGestao(base, true)).toBe(true);
    expect(podeFinalizarGestao(base, false)).toBe(false);
  });
  it("finalizado sai da fila e volta a ser só Concluído", () => {
    const c = { ...base, gestao_finalizada_em: "2026-11-10T12:00:00Z" };
    expect(aguardandoGestorSistemas(c)).toBe(false);
    expect(resumoStatus(c, null)).toBe("Concluído");
  });
  it("coluna não lida (undefined) não acusa pendência", () => {
    const { gestao_finalizada_em, ...semColuna } = base;
    expect(aguardandoGestorSistemas(semColuna as typeof base)).toBe(false);
  });
  it("reaberto não tem o que finalizar", () => {
    expect(podeFinalizarGestao({ ...base, status: "em_andamento" }, true)).toBe(false);
  });
  it("linha do tempo ganha o passo do gestor depois da confirmação", () => {
    const passos = montarLinhaDoTempo(base, null);
    const i = passos.findIndex((p) => p.key === "confirmacao");
    expect(passos[i + 1]).toMatchObject({ key: "gestao", situacao: "atual" });
    const fim = montarLinhaDoTempo({ ...base, gestao_finalizada_em: "2026-11-10T12:00:00Z" }, null);
    expect(fim.find((p) => p.key === "gestao")?.situacao).toBe("feito");
  });
});
