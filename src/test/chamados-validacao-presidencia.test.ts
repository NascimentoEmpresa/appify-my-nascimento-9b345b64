import { describe, it, expect } from "vitest";
import {
  montarLinhaDoTempo, pendenciaTreinamento, resumoStatus, type ValidacaoChamado,
} from "@/pages/chamados/validacaoPresidencia";

// =====================================================================
// Validação da Presidência + treinamento (mig 20260930000266).
//
// pendenciaTreinamento espelha a RPC chamado_treinamento_confirmar: se a
// tela mostrar o botão para quem o banco recusa (ou esconder de quem deve
// confirmar), o chamado nunca finaliza. A linha do tempo é o que o
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

describe("pendenciaTreinamento", () => {
  it("fora da etapa de treinamento ninguém confirma", () => {
    for (const etapa of ["desenvolvimento", "validacao_presidencia", "finalizado"] as const) {
      expect(pendenciaTreinamento(validacao({ etapa, desenvolvedor_id: DEV }), chamado(), SOLIC))
        .toEqual({ comoDev: false, comoSolicitante: false });
    }
  });

  it("no treinamento, dev e solicitante confirmam cada um o seu", () => {
    const v = validacao({ etapa: "treinamento", desenvolvedor_id: DEV });
    expect(pendenciaTreinamento(v, chamado(), DEV)).toEqual({ comoDev: true, comoSolicitante: false });
    expect(pendenciaTreinamento(v, chamado(), SOLIC)).toEqual({ comoDev: false, comoSolicitante: true });
    expect(pendenciaTreinamento(v, chamado(), OUTRO)).toEqual({ comoDev: false, comoSolicitante: false });
  });

  it("quem já confirmou não confirma de novo", () => {
    const v = validacao({ etapa: "treinamento", desenvolvedor_id: DEV, treinamento_dev_em: "2026-09-05T10:00:00Z" });
    expect(pendenciaTreinamento(v, chamado(), DEV).comoDev).toBe(false);
    expect(pendenciaTreinamento(v, chamado(), SOLIC).comoSolicitante).toBe(true);
  });

  it("o dev é quem concluiu; sem registro, o responsável", () => {
    const concluiuOutro = validacao({ etapa: "treinamento", desenvolvedor_id: OUTRO });
    expect(pendenciaTreinamento(concluiuOutro, chamado(), DEV).comoDev).toBe(false);
    expect(pendenciaTreinamento(concluiuOutro, chamado(), OUTRO).comoDev).toBe(true);
    const semRegistro = validacao({ etapa: "treinamento", desenvolvedor_id: null });
    expect(pendenciaTreinamento(semRegistro, chamado(), DEV).comoDev).toBe(true);
  });

  it("dev que abriu o próprio chamado confirma os dois papéis", () => {
    const v = validacao({ etapa: "treinamento", desenvolvedor_id: DEV });
    expect(pendenciaTreinamento(v, chamado({ solicitante_id: DEV }), DEV)).toEqual({ comoDev: true, comoSolicitante: true });
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

  it("treinamento mostra quem já confirmou", () => {
    const p = montarLinhaDoTempo(
      chamado({ status: "concluido" }),
      validacao({ etapa: "treinamento", presidencia_aprovado: true, treinamento_solic_em: "2026-09-06T10:00:00Z" }),
    );
    const t = p.find((x) => x.key === "treinamento")!;
    expect(t.situacao).toBe("atual");
    expect(t.itens?.map((i) => i.feito)).toEqual([false, true]);
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
