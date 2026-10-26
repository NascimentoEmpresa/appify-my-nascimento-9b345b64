import { describe, expect, it } from "vitest";
import {
  apareceAoEntrar, concluiAnexando, errosSolicitacao, pedeAssinatura, resumoLotes, situacaoNoLote, termosCienciaPendentes,
  type FormSolicitacao,
} from "@/lib/rh/documentosSolicitados";

const base: FormSolicitacao = { tipo: "ciencia_anexo", titulo: "Procedimento de afastamentos", descricao: "Ler, assinar e anexar", modo: "encarregados", contrato: "", destinatario_id: "", prazo: "" };

describe("Termo assinado e anexado", () => {
  it("aparece ao entrar e conclui anexando (não assinando no sistema)", () => {
    expect(apareceAoEntrar({ tipo: "ciencia_anexo" })).toBe(true);
    expect(concluiAnexando({ tipo: "ciencia_anexo" })).toBe(true);
    expect(pedeAssinatura({ tipo: "ciencia_anexo" })).toBe(false);
    expect(apareceAoEntrar({ tipo: "assinatura" })).toBe(false);
    expect(concluiAnexando({ tipo: "anexo" })).toBe(true);
  });
  it("entra na fila da janela de entrada junto com o termo de ciência", () => {
    const l = [
      { id: 1, tipo: "ciencia_anexo" as const, status: "pendente" as const, destinatario_id: "u", created_at: "2026-10-25T10:00:00Z" },
      { id: 2, tipo: "ciencia" as const, status: "pendente" as const, destinatario_id: "u", created_at: "2026-10-24T10:00:00Z" },
      { id: 3, tipo: "ciencia_anexo" as const, status: "concluida" as const, destinatario_id: "u", created_at: "2026-10-23T10:00:00Z" },
      { id: 4, tipo: "assinatura" as const, status: "pendente" as const, destinatario_id: "u", created_at: "2026-10-22T10:00:00Z" },
    ];
    expect(termosCienciaPendentes(l, "u").map((x) => x.id)).toEqual([2, 1]);
    expect(termosCienciaPendentes(l, "u", [2]).map((x) => x.id)).toEqual([1]);
  });
});

describe("Formulário — todos os encarregados", () => {
  it("pede o documento e ao menos um encarregado", () => {
    expect(errosSolicitacao(base, 0, 0)).toEqual(["Anexe o documento que eles vão ler e assinar.", "Marque ao menos um encarregado."]);
    expect(errosSolicitacao(base, 1, 42)).toEqual([]);
  });
  it("não exige contrato nem destinatário único", () => {
    expect(errosSolicitacao({ ...base, tipo: "assinatura" }, 0, 3)).toEqual([]);
  });
  it("registro não vai para todos", () => {
    expect(errosSolicitacao({ ...base, tipo: "registro" }, 1, 3)).toContain("Registro não vai para todos os encarregados — escolha outro tipo.");
  });
});

describe("Acompanhamento do envio", () => {
  const s = (lote: string | null, status: "pendente" | "concluida" | "cancelada", lido: string | null, em = "2026-10-25T10:00:00Z") => ({
    lote_id: lote, titulo: "Procedimento", tipo: "ciencia_anexo" as const, created_at: em, solicitante_nome: "Alessandra", prazo: null, status, lido_em: lido,
  });
  it("situação de cada encarregado", () => {
    expect(situacaoNoLote(s("a", "concluida", null))).toBe("concluida");
    expect(situacaoNoLote(s("a", "pendente", "2026-10-25T11:00:00Z"))).toBe("leu");
    expect(situacaoNoLote(s("a", "pendente", null))).toBe("nao_abriu");
    expect(situacaoNoLote(s("a", "cancelada", null))).toBe("cancelada");
  });
  it("resumo por envio: concluídos, leram, não abriram (cancelados fora do total)", () => {
    const r = resumoLotes([
      s("a", "concluida", "x"), s("a", "pendente", "x"), s("a", "pendente", null), s("a", "pendente", null), s("a", "cancelada", null),
      s("b", "pendente", null, "2026-10-20T10:00:00Z"), s(null, "pendente", null),
    ]);
    expect(r.map((x) => x.lote_id)).toEqual(["a", "b"]);
    expect(r[0]).toMatchObject({ total: 4, concluidas: 1, leram: 1, nao_abriram: 2, canceladas: 1, pct: 25 });
  });
});
