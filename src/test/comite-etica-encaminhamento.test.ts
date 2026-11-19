import { describe, expect, it } from "vitest";
import {
  caminhoArquivo, cicloAberto, cumprimento, etapaDaMedida, podeEnviarParecer, validarAplicacao, validarDecisao,
} from "@/lib/comite-etica/encaminhamento";
import {
  conferirEncaminhamento, montarPedidoEncaminhamento,
} from "../../supabase/functions/_shared/denuncia-encaminhamento-ia";
import { rotaVisivelNoMenu } from "@/hooks/useAccessibleMenus";

// SIS-2026-0957 — Comitê → Presidência → Jurídico → Supervisor.
// As regras do banco estão provadas em PGlite; aqui, o espelho delas na tela.

describe("etapa da medida", () => {
  it("segue a medida da Presidência até a aplicação", () => {
    expect(etapaDaMedida({ status: "pendente", medida: "advertencia" }).rotulo).toMatch(/Presidência/);
    expect(etapaDaMedida({ status: "desaprovada", medida: "advertencia" }).tom).toBe("erro");
    expect(etapaDaMedida({ status: "aprovada", medida: "advertencia" }).rotulo).toMatch(/Jurídico/);
    expect(etapaDaMedida({ status: "aprovada", medida: "advertencia" }, { status: "aguardando_aplicacao", aplicada_em: null }).rotulo).toMatch(/supervisor/);
    expect(etapaDaMedida({ status: "aprovada", medida: "advertencia" }, { status: "aplicada", aplicada_em: "2026-11-18" }).rotulo).toBe("Aplicada em 18/11/2026");
    expect(etapaDaMedida({ status: "aprovada", medida: "nenhuma" }).tom).toBe("ok");
  });
});

describe("cumprimento", () => {
  const medidas = [
    { id: "a", status: "aprovada" as const, medida: "advertencia" },
    { id: "b", status: "aprovada" as const, medida: "treinamento" },
    { id: "c", status: "desaprovada" as const, medida: "suspensao" },
    { id: "d", status: "aprovada" as const, medida: "nenhuma" },
  ];
  it("conta só as aprovadas que precisam de aplicação", () => {
    expect(cumprimento(medidas, [{ medida_id: "a", status: "aplicada" }])).toEqual({ total: 2, aplicadas: 1, completo: false });
    expect(cumprimento(medidas, [{ medida_id: "a", status: "aplicada" }, { medida_id: "b", status: "aplicada" }]).completo).toBe(true);
    expect(cumprimento([], []).completo).toBe(false);
  });
});

describe("reenvio do parecer", () => {
  it("só com parecer final, sem ciclo aberto e denúncia não encerrada", () => {
    expect(podeEnviarParecer({ parecerFinal: true, ciclos: [{ status: "devolvido" }], statusDenuncia: "parecer_elaboracao" })).toBe(true);
    expect(podeEnviarParecer({ parecerFinal: false, ciclos: [], statusDenuncia: "parecer_elaboracao" })).toBe(false);
    expect(podeEnviarParecer({ parecerFinal: true, ciclos: [{ status: "aguardando_presidencia" }], statusDenuncia: "aguardando_presidencia" })).toBe(false);
    expect(podeEnviarParecer({ parecerFinal: true, ciclos: [], statusDenuncia: "concluida" })).toBe(false);
    expect(cicloAberto([{ status: "decidido" }, { status: "aguardando_presidencia" }])).toEqual({ status: "aguardando_presidencia" });
  });
});

describe("decisão da presidente", () => {
  it("desaprovar exige proposta/aditivo; aprovar com Jurídico exige o resumo", () => {
    expect(validarDecisao({ aprovar: false, medida: "advertencia", texto: " ", resumo: "" })).toMatch(/aditivo/);
    expect(validarDecisao({ aprovar: false, medida: "advertencia", texto: "Trocar por orientação", resumo: "" })).toBeNull();
    expect(validarDecisao({ aprovar: true, medida: "advertencia", texto: "", resumo: "" })).toMatch(/resumo/);
    expect(validarDecisao({ aprovar: true, medida: "advertencia", texto: "", resumo: "Resumo" })).toBeNull();
    expect(validarDecisao({ aprovar: true, medida: "nenhuma", texto: "", resumo: "" })).toBeNull();
  });
});

describe("aplicação e arquivos", () => {
  it("data obrigatória e não futura", () => {
    expect(validarAplicacao("", "2026-11-19")).toMatch(/Informe/);
    expect(validarAplicacao("2026-11-20", "2026-11-19")).toMatch(/futura/);
    expect(validarAplicacao("2026-11-19", "2026-11-19")).toBeNull();
  });
  it("caminho na pasta da medida (é o que a RLS do storage confere)", () => {
    const p = caminhoArquivo("m-1", "comprovante", "Ciência assinada (João).pdf", 123);
    expect(p).toBe("m-1/comprovante/123_Ciencia_assinada_Joao_.pdf");
    expect(caminhoArquivo("m-1", "documento", "", 1)).toBe("m-1/documento/1_arquivo");
  });
});

describe("resumo da I.A para o Jurídico", () => {
  it("pede as seções e leva medida, colaborador e parecer", () => {
    const p = montarPedidoEncaminhamento({ medidaRotulo: "Advertência", colaborador: "FULANO", contrato: "SMED", parecer: "PARECER X" });
    expect(p).toContain('"Advertência"');
    expect(p).toContain("FULANO");
    expect(p).toContain("PARECER X");
    expect(p).toMatch(/MEDIDA APROVADA PELA PRESIDÊNCIA/);
    expect(montarPedidoEncaminhamento({ medidaRotulo: "Treinamento" })).toContain("Colaborador: não informado");
  });
  it("limpa Markdown, recusa curto ou sem a seção da medida", () => {
    const bom = "## DENÚNCIA\nDEN-1\n**FATO APURADO**\n" + "x".repeat(200) + "\nMEDIDA APROVADA PELA PRESIDÊNCIA\nAdvertência";
    const r = conferirEncaminhamento("```\n" + bom + "\n```");
    expect(r.ok).toBe(true);
    if (r.ok) { expect(r.texto).not.toMatch(/\*\*|##|```/); }
    expect(conferirEncaminhamento("curto").ok).toBe(false);
    expect(conferirEncaminhamento("y".repeat(400)).ok).toBe(false);
  });
});

describe("sidebar: outro menu da mesma rota também é porta", () => {
  const routes = [
    { codigo: "advertencias", rota: "/app/juridico/advertencias", ativo: true, pendente: false },
    { codigo: "advertencias_recebido_juridico", rota: "/app/juridico/advertencias", ativo: true, pendente: false },
  ];
  const acesso = (codes: string[], rs = routes) => ({ codes: new Set(codes), routes: rs, inactiveCodes: new Set<string>() });
  it("supervisor só com o menu do card vê Advertências", () => {
    expect(rotaVisivelNoMenu("/app/juridico/advertencias", acesso(["advertencias_recebido_juridico"]))).toBe(true);
    expect(rotaVisivelNoMenu("/app/juridico/advertencias", acesso(["advertencias"]))).toBe(true);
    expect(rotaVisivelNoMenu("/app/juridico/advertencias", acesso([]))).toBe(false);
  });
  it("menu do card ainda pendente não abre nada", () => {
    const pend = [routes[0], { ...routes[1], pendente: true }];
    expect(rotaVisivelNoMenu("/app/juridico/advertencias", acesso([], pend))).toBe(false);
  });
});
