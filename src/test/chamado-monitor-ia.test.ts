import { describe, expect, it } from "vitest";
import {
  CRITERIOS_IA, extrairJsonMonitor, montarPromptMonitor, validarAvaliacaoMonitor,
} from "../../supabase/functions/_shared/chamado-monitor-ia";

const base = {
  numero: "SIS-2026-0001", assunto: "Ajuste na vaga", tipo_solicitacao: "ajuste", descricao: "Local: Vagas → Etapa 1.",
  observacoes_solicitante: null, categorias: null, modulo_sistema: "recrutamento", modulo_sistema_outro: null,
  impacto_trabalho: "impede", urgencia: "alta", afeta_usuarios: 5, prioridade: "alta", status: "aberto",
  setor: "RH", solicitante_id: "u1",
};

describe("chamado-monitor-ia — prompt e resposta", () => {
  it("leva descrição, anexos e a conversa marcando quem é o solicitante (sem nota interna)", () => {
    const p = montarPromptMonitor(base, [
      { tipo: "solicitar_info", texto: "Qual contrato?", autor_id: "dev", created_at: "2026-11-01T10:00:00Z" },
      { tipo: "comentario", texto: "Contrato 020.2022", autor_id: "u1", created_at: "2026-11-01T11:00:00Z" },
      { tipo: "observacao_interna", texto: "segredo", autor_id: "dev", created_at: "2026-11-01T12:00:00Z" },
    ], [{ nome_arquivo: "explicacao.pdf", campo: "abertura" }, { nome_arquivo: "x.png", campo: "interno" }]);
    expect(p).toContain("Local: Vagas → Etapa 1.");
    expect(p).toContain("explicacao.pdf");
    expect(p).not.toContain("x.png");
    expect(p).toContain("EQUIPE DE SISTEMAS (pedido de informação): Qual contrato?");
    expect(p).toContain("SOLICITANTE: Contrato 020.2022");
    expect(p).not.toContain("segredo");
    expect(p).toContain("impede o trabalho");
  });

  it("aceita resposta com cerca ``` e vírgula decimal; rejeita critério faltando", () => {
    const criterios = Object.fromEntries(CRITERIOS_IA.map((k) => [k, { nota: "9,5", motivo: "bom" }]));
    const ok = validarAvaliacaoMonitor(extrairJsonMonitor("```json\n" + JSON.stringify({ criterios, resumo: "ótimo" }) + "\n```"));
    expect(ok?.criterios.clareza_problema.nota).toBe(9.5);
    expect(ok?.resumo).toBe("ótimo");
    const { confiabilidade, ...menos } = criterios;
    expect(validarAvaliacaoMonitor({ criterios: menos })).toBeNull();
    expect(validarAvaliacaoMonitor({ criterios: { ...criterios, descricao: { nota: 14 } } })?.criterios.descricao.nota).toBe(10);
  });
});
