import { describe, it, expect } from "vitest";
import {
  avaliacaoLiberada, montarLinhaDoTempo, podeEnviarTreinamento, resumoParticipantes, resumoStatus, type ValidacaoChamado,
} from "@/pages/chamados/validacaoPresidencia";

// =====================================================================
// Validação da Presidência + treinamento (mig 20260930000266).
//
// podeEnviarTreinamento espelha a RPC chamado_treinamento_enviar (mig 273):
// se a tela esconder o botão de quem deve enviar, o chamado nunca finaliza. A linha do tempo é o que o
// solicitante vê no botão "Status".
// =====================================================================

const SOLIC = "u-solic";
const DEV = "u-dev";
const OUTRO = "u-outro";

const chamado = (over: Partial<Parameters<typeof montarLinhaDoTempo>[0]> & { solicitante_id?: string } = {}) => ({
  status: "em_andamento",
  created_at: "2026-09-01T10:00:00Z",
  updated_at: "2026-09-02T10:00:00Z",
  responsavel_id: DEV,
  solicitante_id: SOLIC,
  concluido_em: null,
  motivo_reprovacao: null,
  motivo_cancelamento: null,
  cancelado_em: null,
  ...over,
});

const validacao = (over: Partial<ValidacaoChamado> = {}): ValidacaoChamado => ({
  chamado_id: "c1",
  etapa: "desenvolvimento",
  enviado_por: "u-coord",
  enviado_em: "2026-09-01T11:00:00Z",
  observacao_envio: null,
  desenvolvedor_id: null,
  desenvolvimento_concluido_em: null,
  devolucoes: 0,
  presidencia_por: null,
  presidencia_em: null,
  presidencia_aprovado: null,
  presidencia_parecer: null,
  treinamento_dev_por: null,
  treinamento_dev_em: null,
  treinamento_dev_obs: null,
  treinamento_solic_por: null,
  treinamento_solic_em: null,
  treinamento_solic_obs: null,
  finalizado_em: null,
  created_at: "2026-09-01T11:00:00Z",
  updated_at: "2026-09-01T11:00:00Z",
  ...over,
});

describe("podeEnviarTreinamento", () => {
  // Espelha a RPC chamado_treinamento_enviar (mig 273): o dev que concluiu —
  // ou a gestão, por ele — escolhe quem recebe o treinamento, uma vez.
  it("fora da etapa de treinamento ninguém envia", () => {
    for (const etapa of ["desenvolvimento", "validacao_presidencia", "finalizado"] as const) {
      expect(podeEnviarTreinamento(validacao({ etapa, desenvolvedor_id: DEV }), chamado(), DEV)).toBe(false);
    }
  });

  it("no treinamento, só o dev que concluiu envia — o solicitante não", () => {
    const v = validacao({ etapa: "treinamento", desenvolvedor_id: DEV });
    expect(podeEnviarTreinamento(v, chamado(), DEV)).toBe(true);
    expect(podeEnviarTreinamento(v, chamado(), SOLIC)).toBe(false);
    expect(podeEnviarTreinamento(v, chamado(), OUTRO)).toBe(false);
  });

  it("depois de enviado, ninguém envia de novo", () => {
    const v = validacao({ etapa: "treinamento", desenvolvedor_id: DEV, treinamento_dev_em: "2026-09-30T09:07:00Z" });
    expect(podeEnviarTreinamento(v, chamado(), DEV)).toBe(false);
    expect(podeEnviarTreinamento(v, chamado(), OUTRO, { gestao: true })).toBe(false);
  });

  it("o dev é quem concluiu; sem registro, o responsável", () => {
    const concluiuOutro = validacao({ etapa: "treinamento", desenvolvedor_id: OUTRO });
    expect(podeEnviarTreinamento(concluiuOutro, chamado(), DEV)).toBe(false);
    expect(podeEnviarTreinamento(concluiuOutro, chamado(), OUTRO)).toBe(true);
    expect(podeEnviarTreinamento(validacao({ etapa: "treinamento", desenvolvedor_id: null }), chamado(), DEV)).toBe(true);
  });

  it("a gestão (gerente do dev) envia por ele", () => {
    const v = validacao({ etapa: "treinamento", desenvolvedor_id: DEV });
    expect(podeEnviarTreinamento(v, chamado(), OUTRO, { gestao: true })).toBe(true);
  });
});

describe("resumoParticipantes", () => {
  it("conta participantes e confirmações", () => {
    expect(resumoParticipantes([{ confirmado_em: null }, { confirmado_em: "2026-09-30T10:00:00Z" }, { confirmado_em: null }]))
      .toEqual({ total: 3, confirmados: 1 });
    expect(resumoParticipantes(null)).toEqual({ total: 0, confirmados: 0 });
  });
});

describe("avaliacaoLiberada", () => {
  it("fluxo normal (sem Presidência) avalia direto", () => {
    expect(avaliacaoLiberada(null)).toEqual({ liberada: true, motivo: null });
  });

  it("com a Presidência validando ainda não avalia", () => {
    expect(avaliacaoLiberada(validacao({ etapa: "validacao_presidencia" }))).toEqual({ liberada: false, motivo: "presidencia" });
    expect(avaliacaoLiberada(validacao({ etapa: "desenvolvimento" }))).toEqual({ liberada: false, motivo: "presidencia" });
  });

  it("aprovada pela Presidência, avalia — o treinamento não trava mais (mig 273)", () => {
    expect(avaliacaoLiberada(validacao({ etapa: "treinamento" }))).toEqual({ liberada: true, motivo: null });
    expect(avaliacaoLiberada(validacao({ etapa: "finalizado" }))).toEqual({ liberada: true, motivo: null });
  });
});

describe("montarLinhaDoTempo", () => {
  const chaves = (p: ReturnType<typeof montarLinhaDoTempo>) => p.map((x) => x.key);
  const situacao = (p: ReturnType<typeof montarLinhaDoTempo>, key: string) => p.find((x) => x.key === key)?.situacao;

  it("sem Presidência: aberto → desenvolvimento → concluído", () => {
    const p = montarLinhaDoTempo(chamado(), null);
    expect(chaves(p)).toEqual(["aberto", "desenvolvimento", "concluido"]);
    expect(situacao(p, "desenvolvimento")).toBe("atual");
    expect(situacao(p, "concluido")).toBe("pendente");
  });

  it("com Presidência mostra validação, treinamento e finalização", () => {
    const p = montarLinhaDoTempo(chamado(), validacao());
    expect(chaves(p)).toEqual(["aberto", "desenvolvimento", "concluido", "presidencia", "treinamento", "finalizado"]);
  });

  it("dev concluiu → Presidência é o passo atual", () => {
    const p = montarLinhaDoTempo(
      chamado({ status: "concluido" }),
      validacao({ etapa: "validacao_presidencia", desenvolvedor_id: DEV, desenvolvimento_concluido_em: "2026-09-03T10:00:00Z" }),
    );
    expect(situacao(p, "desenvolvimento")).toBe("feito");
    expect(situacao(p, "concluido")).toBe("feito");
    expect(situacao(p, "presidencia")).toBe("atual");
    expect(situacao(p, "treinamento")).toBe("pendente");
  });

  it("treinamento mostra o envio e o andamento dos participantes", () => {
    const p = montarLinhaDoTempo(
      chamado({ status: "concluido" }),
      validacao({ etapa: "treinamento", presidencia_aprovado: true, treinamento_dev_em: "2026-09-30T10:00:00Z" }),
      undefined,
      { total: 5, confirmados: 2 },
    );
    const t = p.find((x) => x.key === "treinamento")!;
    expect(t.situacao).toBe("atual");
    expect(t.itens?.map((i) => i.feito)).toEqual([true, false]);
    expect(t.itens?.[1].titulo).toContain("2 de 5");
  });

  it("finalizado fecha todos os passos", () => {
    const p = montarLinhaDoTempo(
      chamado({ status: "concluido" }),
      validacao({ etapa: "finalizado", presidencia_aprovado: true, finalizado_em: "2026-09-07T10:00:00Z" }),
    );
    expect(p.every((x) => x.situacao === "feito")).toBe(true);
  });

  it("devolvido pela Presidência volta ao desenvolvimento com o parecer", () => {
    const p = montarLinhaDoTempo(
      chamado({ status: "em_andamento" }),
      validacao({ etapa: "desenvolvimento", devolucoes: 1, presidencia_aprovado: false, presidencia_parecer: "Falta o filtro por data" }),
    );
    expect(situacao(p, "desenvolvimento")).toBe("atual");
    expect(p.find((x) => x.key === "desenvolvimento")?.detalhe).toContain("Falta o filtro por data");
    expect(situacao(p, "presidencia")).toBe("pendente");
  });

  it("cancelado interrompe a linha e não mostra etapas futuras", () => {
    const p = montarLinhaDoTempo(chamado({ status: "cancelado", motivo_cancelamento: "Não preciso mais" }), validacao());
    expect(chaves(p)).toEqual(["aberto", "desenvolvimento", "encerrado"]);
    expect(situacao(p, "encerrado")).toBe("interrompido");
  });
});

describe("resumoStatus", () => {
  it("a etapa da Presidência vence o status 'concluído'", () => {
    expect(resumoStatus({ status: "concluido" }, validacao({ etapa: "treinamento" }))).toBe("Treinamento pendente");
    expect(resumoStatus({ status: "concluido" }, null)).toBe("Concluído");
    expect(resumoStatus({ status: "em_andamento" }, validacao())).toBe("Em desenvolvimento");
  });
});
