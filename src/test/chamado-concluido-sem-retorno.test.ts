import { describe, expect, it } from "vitest";
import { concluidoSemRetorno, prazoRetornoTexto, ROTULO_CONCLUIDO_SEM_RETORNO } from "@/lib/chamados/prazoRetorno";
import { pendenteDoGestorSistemas, resumoStatus } from "@/pages/chamados/validacaoPresidencia";

// Chamado sem retorno do solicitante (18/11/2026, SIS-2026-0771): a rotina
// conclui, confirma e finaliza de uma vez (mig 20261119030000). O solicitante
// vê o texto exato e o chamado não cai na fila do Gestor de Sistemas.

const concluidoAuto = {
  status: "concluido",
  concluido_sem_retorno: true,
  conclusao_confirmada_em: "2026-11-19T03:20:00Z",
  gestao_finalizada_em: "2026-11-19T03:20:00Z",
  desenvolvimento_iniciado_em: null as string | null,
  desenvolvimento_entregue_em: null as string | null,
};

describe("conclusão automática por falta de retorno", () => {
  it("texto exato pedido pelo Pablo", () => {
    expect(ROTULO_CONCLUIDO_SEM_RETORNO).toBe("Concluído automaticamente por falta de retorno");
  });

  it("só vale para concluído com a marca", () => {
    expect(concluidoSemRetorno(concluidoAuto)).toBe(true);
    expect(concluidoSemRetorno({ ...concluidoAuto, concluido_sem_retorno: false })).toBe(false);
    expect(concluidoSemRetorno({ status: "concluido" })).toBe(false); // coluna não lida
    // Reaberto: o gatilho zera a marca, mas mesmo que não zerasse o status manda.
    expect(concluidoSemRetorno({ status: "em_andamento", concluido_sem_retorno: true })).toBe(false);
  });

  it("status resumido mostra o texto exato, não 'Aguardando o Gestor de Sistemas'", () => {
    expect(resumoStatus(concluidoAuto, null)).toBe(ROTULO_CONCLUIDO_SEM_RETORNO);
    // Mesmo concluído sem retorno antigo, sem a finalização (antes da mig).
    expect(resumoStatus({ ...concluidoAuto, gestao_finalizada_em: null }, null)).toBe(ROTULO_CONCLUIDO_SEM_RETORNO);
  });

  it("finalizado pela rotina não entra na fila do gestor", () => {
    expect(pendenteDoGestorSistemas(concluidoAuto)).toBe(false);
  });

  it("prazo do 0771: quarta, 18/11 (23:59 de Brasília)", () => {
    expect(prazoRetornoTexto("2026-11-19T02:59:59Z")).toBe("quarta, 18/11");
    expect(prazoRetornoTexto(null)).toBeNull();
  });
});
