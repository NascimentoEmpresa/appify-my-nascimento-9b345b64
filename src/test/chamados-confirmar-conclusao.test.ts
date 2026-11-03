import { describe, expect, it } from "vitest";
import {
  abrirChamadoTravado, conclusaoAguardandoConfirmacao, descreverPendencias, montarLinhaDoTempo,
  podeConfirmarConclusao, resumoStatus, separarPendencias, type PendenciaSolicitante,
} from "@/pages/chamados/validacaoPresidencia";

// =====================================================================
// Confirmar conclusão pelo solicitante (28/10/2026, mig 20261028001300).
//
// Pedido do Pablo: "o setor de sistemas quando clicar em CONCLUIR o
// SOLICITANTE vai ter que clicar em CONFIRMAR CONCLUSÃO, antes de continuar e
// abrir o próximo quarto chamado (respeitando aquele limite de 3)."
//
// podeConfirmarConclusao ESPELHA a RPC chamado_confirmar_conclusao; a trava
// de 3 é a mesma de antes, agora contando também as confirmações.
// =====================================================================

const SOLIC = "u-solic";
const DEV = "u-dev";

const chamado = (over: Record<string, unknown> = {}) => ({
  status: "concluido",
  solicitante_id: SOLIC,
  responsavel_id: DEV,
  created_at: "2026-10-20T10:00:00Z",
  updated_at: "2026-10-27T10:00:00Z",
  concluido_em: "2026-10-27T10:00:00Z",
  conclusao_confirmada_em: null as string | null,
  motivo_reprovacao: null,
  motivo_cancelamento: null,
  cancelado_em: null,
  ...over,
});

const pend = (pendencia: PendenciaSolicitante["pendencia"], i = 0): PendenciaSolicitante =>
  ({ id: `c${i}`, numero: `SIS-2026-000${i}`, assunto: "x", concluido_em: null, pendencia });

describe("quem pode confirmar a conclusão", () => {
  it("só o solicitante, com o chamado concluído e ainda não confirmado", () => {
    expect(podeConfirmarConclusao(chamado(), null, SOLIC)).toBe(true);
    expect(podeConfirmarConclusao(chamado(), null, DEV)).toBe(false);
    expect(podeConfirmarConclusao(chamado(), null, null)).toBe(false);
    expect(podeConfirmarConclusao(chamado({ conclusao_confirmada_em: "2026-10-28T09:00:00Z" }), null, SOLIC)).toBe(false);
  });

  it("chamado que não está concluído não tem o que confirmar", () => {
    for (const status of ["aberto", "em_andamento", "aguardando_retorno", "reprovado", "cancelado"]) {
      expect(podeConfirmarConclusao(chamado({ status }), null, SOLIC)).toBe(false);
    }
  });

  it("no fluxo da Presidência, só depois que ela aprova (mesma janela da avaliação)", () => {
    expect(podeConfirmarConclusao(chamado(), { etapa: "validacao_presidencia" }, SOLIC)).toBe(false);
    expect(podeConfirmarConclusao(chamado(), { etapa: "desenvolvimento" }, SOLIC)).toBe(false);
    expect(podeConfirmarConclusao(chamado(), { etapa: "treinamento" }, SOLIC)).toBe(true);
    expect(podeConfirmarConclusao(chamado(), { etapa: "finalizado" }, SOLIC)).toBe(true);
  });

  it("aguardando confirmação = concluído sem conclusao_confirmada_em", () => {
    expect(conclusaoAguardandoConfirmacao(chamado())).toBe(true);
    expect(conclusaoAguardandoConfirmacao(chamado({ conclusao_confirmada_em: "2026-10-28T09:00:00Z" }))).toBe(false);
    expect(conclusaoAguardandoConfirmacao(chamado({ status: "em_andamento" }))).toBe(false);
  });
});

describe("trava de 3 conta confirmar e avaliar juntos", () => {
  it("3 chamados aguardando confirmação travam o 4º", () => {
    expect(abrirChamadoTravado([pend("confirmacao", 1), pend("confirmacao", 2)])).toBe(false);
    expect(abrirChamadoTravado([pend("confirmacao", 1), pend("confirmacao", 2), pend("confirmacao", 3)])).toBe(true);
  });

  it("mistura de confirmar e avaliar também trava na 3ª", () => {
    expect(abrirChamadoTravado([pend("confirmacao", 1), pend("avaliacao", 2), pend("avaliacao_participante", 3)])).toBe(true);
  });

  it("separa o que falta confirmar do que falta avaliar", () => {
    const { confirmar, avaliar } = separarPendencias([pend("confirmacao", 1), pend("avaliacao", 2), pend("avaliacao_participante", 3)]);
    expect(confirmar.map((p) => p.id)).toEqual(["c1"]);
    expect(avaliar.map((p) => p.id)).toEqual(["c2", "c3"]);
  });

  it("a frase do aviso diz quantos faltam de cada", () => {
    expect(descreverPendencias([pend("confirmacao", 1)])).toBe("Você tem 1 chamado aguardando sua confirmação");
    expect(descreverPendencias([pend("confirmacao", 1), pend("confirmacao", 2), pend("avaliacao", 3)]))
      .toBe("Você tem 2 chamados aguardando sua confirmação e 1 chamado sem avaliar");
    expect(descreverPendencias([pend("avaliacao", 1), pend("avaliacao", 2)])).toBe("Você tem 2 chamados sem avaliar");
    expect(descreverPendencias([])).toBe("");
  });
});

describe("linha do tempo e resumo do botão Status", () => {
  const situacao = (p: ReturnType<typeof montarLinhaDoTempo>, key: string) => p.find((x) => x.key === key)?.situacao;

  it("concluído pelo time: confirmação é o passo atual", () => {
    const p = montarLinhaDoTempo(chamado(), null);
    expect(p.map((x) => x.key)).toEqual(["aberto", "desenvolvimento", "concluido", "confirmacao"]);
    expect(situacao(p, "concluido")).toBe("feito");
    expect(situacao(p, "confirmacao")).toBe("atual");
    expect(resumoStatus(chamado(), null)).toBe("Aguardando confirmação do solicitante");
  });

  it("confirmado fecha a linha e o resumo volta a 'Concluído'", () => {
    const c = chamado({ conclusao_confirmada_em: "2026-10-28T09:00:00Z" });
    const p = montarLinhaDoTempo(c, null);
    expect(p.every((x) => x.situacao === "feito")).toBe(true);
    expect(resumoStatus(c, null)).toBe("Concluído");
  });

  it("em andamento: a confirmação ainda é futura", () => {
    const p = montarLinhaDoTempo(chamado({ status: "em_andamento", concluido_em: null }), null);
    expect(situacao(p, "confirmacao")).toBe("pendente");
  });
});
