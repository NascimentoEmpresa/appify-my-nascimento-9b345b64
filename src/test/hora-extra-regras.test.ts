import { describe, expect, it } from "vitest";
import {
  conclusaoExibicao,
  dataLocalISO,
  formatarDuracao,
  linhasExcel,
  mediaConclusao,
  sobrepoe,
  statusExecucaoPorPercentual,
  statusExibicao,
  totalHe,
  validarConclusao,
  validarSolicitacao,
} from "@/pages/sistemas/hora-extra/horaExtraUtils";

describe("regras de hora extra", () => {
  it("calcula 18:05 até 21:27", () => expect(formatarDuracao(totalHe("18:05", "21:27"))).toBe("3h 22min"));
  it("calcula HE que cruza meia-noite", () => expect(totalHe("22:00", "02:00")).toBe(240));
  it("formata a data no fuso local", () => expect(dataLocalISO(new Date(2026, 8, 15, 23, 30))).toBe("2026-09-15"));
  it("formata duração curta", () => expect(formatarDuracao(180, true)).toBe("3h00"));
  it("recusa horários iguais na solicitação", () =>
    expect(
      validarSolicitacao({
        chamados: [{ percentual_previsto: 100 }],
        ponto_entrada: "08:00",
        ponto_saida: "18:00",
        he_inicio_previsto: "18:00",
        he_fim_previsto: "18:00",
      }),
    ).toContain("O início e o término da HE não podem ser iguais."));
  it("recusa horários iguais na conclusão", () =>
    expect(validarConclusao({ he_inicio_real: "18:00", he_fim_real: "18:00" })).toContain(
      "O início e o término da HE não podem ser iguais.",
    ));
  it.each([99, 101])("recusa soma %s", (valor) =>
    expect(
      validarSolicitacao({
        chamados: [{ percentual_previsto: valor }],
        ponto_entrada: "08:00",
        ponto_saida: "18:00",
        he_inicio_previsto: "18:00",
        he_fim_previsto: "22:00",
      }),
    ).toContain("A expectativa de conclusão deve totalizar 100%."),
  );
  it("recusa solicitação sem chamado", () =>
    expect(
      validarSolicitacao({
        chamados: [],
        ponto_entrada: "08:00",
        ponto_saida: "18:00",
        he_inicio_previsto: "18:00",
        he_fim_previsto: "22:00",
      })[0],
    ).toContain("pelo menos um chamado"));
  it("recusa HE dentro da jornada", () =>
    expect(
      validarSolicitacao({
        chamados: [{ percentual_previsto: 100 }],
        ponto_entrada: "08:00",
        ponto_saida: "18:00",
        he_inicio_previsto: "16:00",
        he_fim_previsto: "17:00",
      }),
    ).toContain("O horário da HE deve ficar fora da jornada informada."));
  it("detecta sobreposição", () => expect(sobrepoe("18:00", "21:00", "20:00", "22:00")).toBe(true));
  it("não acusa horários adjacentes", () => expect(sobrepoe("18:00", "20:00", "20:00", "22:00")).toBe(false));
  it("detecta sobreposição cruzando meia-noite", () => expect(sobrepoe("22:00", "02:00", "23:00", "01:00")).toBe(true));
  it.each([
    ["aguardando_liberacao", "Aguardando liberação"],
    ["aprovada", "Pendente de conclusão"],
    ["aguardando_validacao", "Aprovada para execução"],
    ["concluida", "Concluída"],
    ["reprovada", "Reprovada"],
  ] as const)("mapeia status %s", (status, label) =>
    expect(statusExibicao(status, "2026-09-14", new Date("2026-09-15T12:00:00")).label).toBe(label),
  );
  it.each([
    ["aguardando_liberacao", "Não iniciada"],
    ["aprovada", "Pendente de preenchimento"],
    ["aguardando_validacao", "Enviada para validação"],
    ["concluida", "Finalizada"],
    ["reprovada", "Não iniciada"],
  ] as const)("mapeia conclusão %s", (status, label) => expect(conclusaoExibicao(status).label).toBe(label));
  it("mantém conclusão não iniciada para HE aprovada futura", () =>
    expect(conclusaoExibicao("aprovada", "2026-09-16", new Date("2026-09-15T12:00:00")).label).toBe("Não iniciada"));
  it.each([
    [100, "concluido"],
    [70, "parcial"],
    [0, "nao_iniciado"],
  ] as const)("deriva execução %s", (valor, status) => expect(statusExecucaoPorPercentual(valor)).toBe(status));
  it("calcula média de conclusão", () => expect(mediaConclusao([70, 30, 0, 100])).toBe(50));
  it("exporta chamado adicional", () => {
    const linhas = linhasExcel([
      {
        id: "1",
        numero: "HE-2026-0001",
        colaborador_id: "u",
        colaborador_nome: "Ana",
        criado_por: "u",
        data_he: "2026-09-15",
        tipo: "normal",
        ponto_entrada: "08:00",
        ponto_saida_intervalo: "12:00",
        ponto_retorno_intervalo: "13:00",
        ponto_saida: "18:00",
        he_inicio_previsto: "18:00",
        he_fim_previsto: "20:00",
        total_previsto_min: 120,
        justificativa: "x",
        status: "concluida",
        created_at: "2026-09-15T12:00:00Z",
        updated_at: "2026-09-15T12:00:00Z",
        chamados: [
          {
            id: "c",
            chamado_id: "c",
            chamado_numero: "SIS-1",
            chamado_assunto: "Ajuste",
            prioridade: "media",
            adicional: true,
            percentual_previsto: null,
            percentual_concluido: 100,
            status_execucao: "concluido",
          },
        ],
      },
    ]);
    expect(linhas[0].Adicional).toBe("Sim");
  });
});
