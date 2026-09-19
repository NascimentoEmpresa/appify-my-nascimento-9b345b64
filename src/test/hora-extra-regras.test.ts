import { describe, expect, it } from "vitest";
import {
  calcularHoraExtra,
  conclusaoExibicao,
  dataLocalISO,
  diaSemana,
  ehFimDeSemana,
  formatarData,
  formatarDataHora,
  formatarDuracao,
  jornadaParaCalculoHoraExtra,
  limitarPercentual,
  linhasExcel,
  mediaConclusao,
  mensagemErro,
  minutosJornada,
  minutosTrabalhados,
  normalizarPontoSemIntervalo,
  podeAlterarHorariosNaLiberacao,
  podeEditarHoraExtra,
  podeIgnorarEscalaNoFimDeSemana,
  rotuloFaseAnexo,
  sobrepoe,
  statusExecucaoPorPercentual,
  statusExibicao,
  totalHe,
  validarConclusao,
  validarSolicitacao,
} from "@/pages/sistemas/hora-extra/horaExtraUtils";

// Escala oficial da empresa: 07:30-12:00-13:00-17:18, ou seja 8h48.
const ESCALA = { entrada: "07:30", saida_intervalo: "12:00", retorno_intervalo: "13:00", saida: "17:18" };
const JORNADA = minutosTrabalhados(ESCALA);

describe("regras de hora extra", () => {
  it("calcula 18:05 até 21:27", () => expect(formatarDuracao(totalHe("18:05", "21:27"))).toBe("3h 22min"));
  it("calcula HE que cruza meia-noite", () => expect(totalHe("22:00", "02:00")).toBe(240));
  it("formata a data no fuso local", () => expect(dataLocalISO(new Date(2026, 8, 15, 23, 30))).toBe("2026-09-15"));
  it("formata duração curta", () => expect(formatarDuracao(180, true)).toBe("3h00"));
  // --- cálculo pela escala de trabalho (16/09/2026) -------------------
  it("a escala padrão dá 8h48 de jornada", () => expect(formatarDuracao(JORNADA, true)).toBe("8h48"));
  it("lê a jornada de uma escala diferente", () =>
    expect(
      minutosJornada({ entrada: "08:00", saida_intervalo: "12:00", retorno_intervalo: "14:00", saida: "18:00" }),
    ).toBe(480));
  it("identifica sábado e domingo sem depender de UTC", () => {
    expect(ehFimDeSemana("2026-09-19")).toBe(true);
    expect(ehFimDeSemana("2026-09-20")).toBe(true);
    expect(ehFimDeSemana("2026-09-21")).toBe(false);
  });
  it("oferece a exceção somente para uma escala marcada no fim de semana", () => {
    expect(podeIgnorarEscalaNoFimDeSemana("2026-09-19", { nao_aplicavel_fins_semana: true })).toBe(true);
    expect(podeIgnorarEscalaNoFimDeSemana("2026-09-19", { nao_aplicavel_fins_semana: false })).toBe(false);
    expect(podeIgnorarEscalaNoFimDeSemana("2026-09-21", { nao_aplicavel_fins_semana: true })).toBe(false);
  });
  it("considera todo o período como HE quando a escala não é seguida no fim de semana", () => {
    const ponto = normalizarPontoSemIntervalo(
      { entrada: "08:00", saida_intervalo: "12:00", retorno_intervalo: "13:00", saida: "12:00" },
      true,
    );
    const calculo = calcularHoraExtra(ponto, jornadaParaCalculoHoraExtra(JORNADA, false));
    expect(calculo.trabalhado).toBe(240);
    expect(calculo.excedente).toBe(240);
    expect(calculo.inicio).toBe("08:00");
  });
  it("conta 1h42 de HE em 08:00-12:00-13:00-19:30", () => {
    const calculo = calcularHoraExtra(
      { entrada: "08:00", saida_intervalo: "12:00", retorno_intervalo: "13:00", saida: "19:30" },
      JORNADA,
    );
    expect(formatarDuracao(calculo.trabalhado, true)).toBe("10h30");
    expect(formatarDuracao(calculo.excedente, true)).toBe("1h42");
    expect(calculo.inicio).toBe("17:48");
    expect(calculo.fim).toBe("19:30");
  });
  it("não dá hora extra em 08:10-11:55-13:05-18:00", () => {
    const calculo = calcularHoraExtra(
      { entrada: "08:10", saida_intervalo: "11:55", retorno_intervalo: "13:05", saida: "18:00" },
      JORNADA,
    );
    expect(formatarDuracao(calculo.trabalhado, true)).toBe("8h40");
    expect(calculo.excedente).toBe(0);
  });
  it("conta HE que vira o dia", () => {
    const calculo = calcularHoraExtra(
      { entrada: "13:00", saida_intervalo: "17:00", retorno_intervalo: "18:00", saida: "01:00" },
      JORNADA,
    );
    expect(calculo.trabalhado).toBe(660);
    expect(calculo.excedente).toBe(132);
    expect(calculo.inicio).toBe("22:48");
  });
  it("volta para antes do intervalo quando a HE passa do turno da tarde", () =>
    expect(
      calcularHoraExtra(
        { entrada: "02:00", saida_intervalo: "12:00", retorno_intervalo: "13:00", saida: "14:00" },
        JORNADA,
      ).inicio,
    ).toBe("10:48"));
  it("recusa solicitação sem hora extra", () =>
    expect(
      validarSolicitacao({ chamados: [{ percentual_previsto: 100 }], ponto: ESCALA, jornadaMinutos: JORNADA }),
    ).toContain("Os horários informados somam 8h48, dentro da jornada de 8h48. Não há hora extra."));
  it("recusa conclusão sem hora extra", () =>
    expect(validarConclusao(ESCALA, JORNADA)).toHaveLength(1));
  it("aceita conclusão com hora extra", () =>
    expect(
      validarConclusao(
        { entrada: "07:30", saida_intervalo: "12:00", retorno_intervalo: "13:00", saida: "19:00" },
        JORNADA,
      ),
    ).toHaveLength(0));
  it.each([-10, 101, 150])("recusa expectativa de %s%%", (valor) =>
    expect(
      validarSolicitacao({
        chamados: [{ percentual_previsto: valor }],
        ponto: { entrada: "07:30", saida_intervalo: "12:00", retorno_intervalo: "13:00", saida: "19:00" },
        jornadaMinutos: JORNADA,
      }),
    ).toContain("A expectativa de conclusão de cada chamado deve ficar entre 0% e 100%."),
  );
  it("aceita 0 e 100 na expectativa", () =>
    expect(
      validarSolicitacao({
        chamados: [{ percentual_previsto: 0 }, { percentual_previsto: 100 }],
        ponto: { entrada: "07:30", saida_intervalo: "12:00", retorno_intervalo: "13:00", saida: "19:00" },
        jornadaMinutos: JORNADA,
      }),
    ).toHaveLength(0));
  it("recusa solicitação sem chamado", () =>
    expect(
      validarSolicitacao({
        chamados: [],
        ponto: { entrada: "07:30", saida_intervalo: "12:00", retorno_intervalo: "13:00", saida: "19:00" },
        jornadaMinutos: JORNADA,
      })[0],
    ).toContain("pelo menos um chamado"));
  it.each([
    [150, 100],
    [-5, 0],
    [42, 42],
  ])("limita o campo de porcentagem %s", (entrada, saida) => expect(limitarPercentual(entrada)).toBe(saida));
  it("a média de três chamados nunca passa de 100", () => expect(mediaConclusao([100, 100, 100])).toBe(100));
  it("mostra a mensagem do banco mesmo sem Error", () =>
    expect(mensagemErro({ message: "O chamado já foi designado a outro usuário: Ana" }, "falhou")).toBe(
      "O chamado já foi designado a outro usuário: Ana",
    ));
  it.each([
    ["solicitacao", "Solicitação"],
    ["conclusao", "Conclusão"],
  ])("rotula o anexo da fase %s", (fase, rotulo) => expect(rotuloFaseAnexo(fase)).toBe(rotulo));
  // A HE reprovada tinha só "Excluir": corrigir obrigava a digitar tudo de
  // novo, com número novo (pedido de 17/09/2026).
  it.each([
    ["aguardando_liberacao", true],
    ["reprovada", true],
    ["aprovada", false],
    ["aguardando_validacao", false],
    ["concluida", false],
  ])("dono com alterar edita a HE em %s: %s", (status, esperado) =>
    expect(podeEditarHoraExtra({ status, ehDono: true, podeAlterar: true })).toBe(esperado),
  );
  it("não deixa editar a HE reprovada de outra pessoa", () =>
    expect(podeEditarHoraExtra({ status: "reprovada", ehDono: false, podeAlterar: true })).toBe(false));
  it("não deixa editar sem a ação alterar", () =>
    expect(podeEditarHoraExtra({ status: "reprovada", ehDono: true, podeAlterar: false })).toBe(false));
  it.each([
    ["aguardando_liberacao", true, true],
    ["aguardando_liberacao", false, false],
    ["aguardando_validacao", true, true],
    ["aguardando_validacao", false, false],
    ["aprovada", true, false],
  ])("libera ajuste do ponto na liberação ou validação somente com alterar (%s, %s)", (status, podeAlterar, esperado) =>
    expect(podeAlterarHorariosNaLiberacao({ status, podeAlterar })).toBe(esperado),
  );
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

  // A tela inteira caiu em produção (15/09/2026) porque formatarDataHora usava
  // `dateStyle` junto com `hour`/`minute`, combinação que o Intl recusa.
  it("formata data e hora da solicitação sem lançar erro", () =>
    expect(formatarDataHora("2026-09-15T11:32:00Z")).toMatch(new RegExp("^[0-9]{2}/[0-9]{2}/[0-9]{4} [0-9]{2}:[0-9]{2}$")));
  it("formata a data da HE", () => expect(formatarData("2026-09-15")).toBe("15/09/2026"));
  it("escreve o dia da semana com inicial maiúscula", () => expect(diaSemana("2026-09-15")).toBe("Terça-feira"));
  it("mostra traço quando não há data", () => expect(formatarDataHora(null)).toBe("—"));
});
