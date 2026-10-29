import { describe, it, expect } from "vitest";
import {
  extrairJson, montarPrompt, validarParecer, PERFIS, type ChamadoParaParecer,
} from "../../supabase/functions/_shared/chamado-parecer-ia.ts";

const resposta = (extra: Record<string, unknown> = {}) => ({
  precos: [
    { perfil: "freelancer", valor_hora: 100, horas: 10, embasamento: "faixa média", explicacao: "entrega rápida" },
    { perfil: "software_house", valor_hora: 200, horas: 15, embasamento: "inclui gestão", explicacao: "com garantia" },
    { perfil: "interno", valor_hora: 80, horas: 8, embasamento: "custo CLT", explicacao: "já conhece o sistema" },
  ],
  complexidade_nivel: 3,
  complexidade_justificativa: "Mexe em tela e banco.",
  premissas: "Sem integração externa.",
  ...extra,
});

describe("parecer da I.A do chamado", () => {
  it("faz a conta do preço no servidor (horas × valor/hora) e a média", () => {
    const v = validarParecer(resposta());
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.parecer.precos.map((p) => p.valor)).toEqual([1000, 3000, 640]);
    expect(v.parecer.valor_medio).toBe(1546.67);
    expect(v.parecer.horas_estimadas).toBe(11);
    expect(v.parecer.complexidade_rotulo).toBe("Média");
    expect(v.parecer.precos.map((p) => p.perfil)).toEqual(PERFIS.map((p) => p.perfil));
  });

  it("puxa o valor/hora para dentro da faixa do perfil", () => {
    const r = resposta();
    (r.precos as Array<Record<string, unknown>>)[0].valor_hora = 900;
    const v = validarParecer(r);
    expect(v.ok && v.parecer.precos[0].valor_hora).toBe(150);
  });

  it("recusa resposta sem um dos perfis, sem nível ou sem justificativa", () => {
    const semPerfil = resposta({ precos: resposta().precos.slice(0, 2) });
    expect(validarParecer(semPerfil).ok).toBe(false);
    expect(validarParecer(resposta({ complexidade_nivel: 9 })).ok).toBe(false);
    expect(validarParecer(resposta({ complexidade_justificativa: "" })).ok).toBe(false);
    expect(validarParecer(null).ok).toBe(false);
  });

  it("lê o JSON mesmo com cerca de código", () => {
    expect(extrairJson("```json\n{\"a\":1}\n```")).toEqual({ a: 1 });
    expect(extrairJson("texto {\"a\":2} fim")).toEqual({ a: 2 });
  });

  it("monta o prompt com o pedido do chamado", () => {
    const c: ChamadoParaParecer = {
      id: "1", numero: "SIS-2026-0001", assunto: "Filtro por data", tipo_solicitacao: "melhoria",
      descricao: "Quero filtrar a lista por data.", categorias: ["ajuste_tela_cadastro"], modulo_sistema: "rh",
      modulo_sistema_outro: null, ambiente: "producao", impacto_trabalho: null, urgencia: null,
      afeta_usuarios: 3, observacoes_solicitante: null,
    };
    const p = montarPrompt(c);
    expect(p).toContain("Filtro por data");
    expect(p).toContain("Quero filtrar a lista por data.");
    expect(p).toContain("Módulo: rh");
  });
});
