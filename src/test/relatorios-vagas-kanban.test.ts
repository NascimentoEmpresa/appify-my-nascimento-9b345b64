import { describe, expect, it } from "vitest";
import { diasPorStatus, kanbanCandidatos, vagaDoDetalhe, type DetalheVaga } from "@/lib/relatorios/vagasPainel";

const ev = (id: number, created_at: string, de: string | null, para: string | null, candidato_id: number | null, evento = "mov") => ({
  id, created_at, evento, de_status: de, para_status: para, papel: null, usuario_nome: null, usuario_email: null, detalhe: null,
  candidato_nome: candidato_id ? "x" : null, candidato_id,
});
const cand = (o: Partial<DetalheVaga["candidatos"][number]>): DetalheVaga["candidatos"][number] => ({
  id: 1, nome: "ANA", criado: "2026-09-03T12:00:00Z", etapa: "ENTRADA", etapa_em: null, origem: null, selecionado_em: null, enviado_em: null,
  desistiu: false, desistencia_motivo: null, motivo_reprovacao: null, ...o,
});

const det: DetalheVaga = {
  vaga: {
    id: 99, criada: "2026-09-01T12:00:00Z", status: "Contratado", status_em: "2026-09-11T12:00:00Z", cargo: "PORTEIRO", cidade: null, uf: null,
    contrato: "X", setor: null, motivo: null, urgencia: null, qtd: 1, solicitante: null, analista: null, aprovado_por: null, contratado: null,
    inicio_previsto: null, substituido: null, motivo_reprovacao: null, legado: false, escala: null, horario: null, salario: null, local: null,
    contratado_inicio: null, req_obrigatorios: null, observacao: null,
  },
  log: [["Pendente Analista", "Pendente Recrutamento", "2026-09-02T12:00:00Z"]],
  historico: [
    ev(1, "2026-09-02T12:00:00Z", "Pendente Analista", "Pendente Recrutamento", null, "Aprovada pelo Analista"),
    ev(2, "2026-09-04T12:00:00Z", "ENTRADA", "TRIAGEM", 7),
    ev(3, "2026-09-06T12:00:00Z", "TRIAGEM", "ADMISSÃO", 7),
    ev(4, "2026-09-07T12:00:00Z", null, "Contratado", 7),
  ],
  candidatos: [
    cand({ id: 7, nome: "ANA", etapa: "ADMISSÃO", selecionado_em: "2026-09-05T12:00:00Z" }),
    cand({ id: 8, nome: "BIA", desistiu: true, desistencia_em: "2026-09-05T12:00:00Z" }),
    cand({ id: 9, nome: "CAIO", criado: "2026-09-20T12:00:00Z" }),
  ],
};
const AGORA = "2026-10-01T12:00:00Z";

describe("vaga aberta pelo número", () => {
  it("monta a linha do painel a partir do detalhe", () => {
    const v = vagaDoDetalhe(det)!;
    expect(v).toMatchObject({ id: 99, aberta: false, aprovada_em: "2026-09-02T12:00:00Z" });
    expect(v.cand).toMatchObject({ total: 3, desistiu: 1, primeiro_em: "2026-09-03T12:00:00Z", selecionado_em: "2026-09-05T12:00:00Z" });
    expect(vagaDoDetalhe({ ...det, vaga: null })).toBeNull();
  });
});

describe("kanban dos candidatos", () => {
  it("mede quanto tempo cada candidato ficou em cada coluna", () => {
    const k = kanbanCandidatos(det, AGORA);
    expect(k[0].trechos.map((t) => [t.etapa, t.dias])).toEqual([["ENTRADA", 1], ["TRIAGEM", 2], ["ADMISSÃO", 1], ["CONTRATADO", 0]]);
    expect(k[0].etapaAtual).toBe("CONTRATADO");
    expect(k[1].trechos.map((t) => [t.etapa, t.dias])).toEqual([["ENTRADA", 2], ["DESISTIU", 0]]);
    expect(k[2].trechos).toHaveLength(1);
    expect(k[2].trechos[0]).toMatchObject({ etapa: "ENTRADA", aberto: true, dias: 11 });
  });

  it("soma os dias por status", () => {
    expect(diasPorStatus([{ status: "A", etapa: "x", dias: 1 }, { status: "A", etapa: "x", dias: 2 }, { etapa: "B", dias: 1 }]))
      .toEqual([{ status: "A", etapa: "x", dias: 3 }, { status: "B", etapa: "B", dias: 1 }]);
  });
});
