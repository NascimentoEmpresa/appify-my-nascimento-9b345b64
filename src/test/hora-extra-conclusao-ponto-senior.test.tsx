/**
 * "aqui quando eu concluir a H.E tem que puxar o ponto da senior também,
 * corrigindo automaticamente, claro se não tiver ajustamos manualmente" — Pablo,
 * 06/11/2026.
 *
 * A regra de qual batida vai em qual campo é testada em
 * hora-extra-ponto-senior.test.ts. Este é um teste de render, como o da lixeira:
 * o que precisa de prova aqui é a tela usar essa regra ao abrir, sem atropelar o
 * que foi digitado nem o que já estava salvo.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Batida } from "@/lib/gestaoPonto";
import type { SolicitacaoHoraExtra } from "@/pages/sistemas/hora-extra/types";

const consulta = vi.hoisted(() => ({
  atual: {} as Record<string, unknown>,
  refetch: vi.fn(),
}));

vi.mock("@/hooks/useHoraExtra", () => ({
  useConcluirHoraExtra: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useEnviarAnexosHoraExtra: () => vi.fn(async () => []),
  buscarInformacoesPrHoraExtra: vi.fn(),
  usePontoMesHoraExtra: () => ({ ...consulta.atual, refetch: consulta.refetch }),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn() } }));

import ConcluirHoraExtraDialog from "@/pages/sistemas/hora-extra/ConcluirHoraExtraDialog";

const h = (hora: number, minuto = 0) => hora * 60 + minuto;
const respostaCom = (batidas: Batida[]) => ({ data: { ponto_disponivel: true, colaborador: { batidas } } });

const solicitacao: SolicitacaoHoraExtra = {
  id: "he-66",
  numero: "HE-2026-0066",
  colaborador_id: "u1",
  colaborador_nome: "Pablo",
  criado_por: "u1",
  data_he: "2026-11-05",
  tipo: "normal",
  ponto_entrada: "07:30",
  ponto_saida_intervalo: "12:00",
  ponto_retorno_intervalo: "13:00",
  ponto_saida: "20:00",
  jornada_minutos: 528,
  he_inicio_previsto: "17:18",
  he_fim_previsto: "20:00",
  total_previsto_min: 162,
  justificativa: "Chamados",
  status: "aprovada",
  created_at: "2026-11-05T10:00:00Z",
  updated_at: "2026-11-05T10:00:00Z",
  chamados: [],
};

const abrir = (s: SolicitacaoHoraExtra = solicitacao) =>
  render(<ConcluirHoraExtraDialog aberto aoFechar={() => {}} solicitacao={s} />);
const campos = () => [...document.querySelectorAll<HTMLInputElement>('input[type="time"]')];
const horarios = () => campos().map((c) => c.value);

const QUATRO: Batida[] = [
  ["2026-11-05", h(7, 30)],
  ["2026-11-05", h(12, 7)],
  ["2026-11-05", h(12, 39)],
  ["2026-11-05", h(20, 50)],
];

describe("conclusão da HE — ponto puxado da Senior", () => {
  beforeEach(() => {
    consulta.atual = respostaCom(QUATRO);
    consulta.refetch.mockReset();
  });

  it("abre com as quatro batidas do dia no lugar do horário planejado, e a HE sai delas", async () => {
    abrir();
    await waitFor(() => expect(horarios()).toEqual(["07:30", "12:07", "12:39", "20:50"]));
    expect(screen.getByText(/Puxado da Senior: Entrada, Saída \(intervalo\), Retorno, Saída/)).toBeInTheDocument();
    expect(screen.getAllByText("4h 00min").length).toBeGreaterThan(0);
  });

  it("sem a batida de saída: fica o planejado e a tela avisa para preencher", async () => {
    consulta.atual = respostaCom(QUATRO.slice(0, 3));
    abrir();
    await waitFor(() => expect(horarios()).toEqual(["07:30", "12:07", "12:39", "20:00"]));
    expect(screen.getByText(/Sem batida na Senior: Saída\. Preencha manualmente/)).toBeInTheDocument();
  });

  it("sem nenhuma batida continua tudo editável à mão", async () => {
    consulta.atual = respostaCom([]);
    abrir();
    await waitFor(() => expect(screen.getByText(/Sem batida na Senior: Entrada/)).toBeInTheDocument());
    expect(horarios()).toEqual(["07:30", "12:00", "13:00", "20:00"]);
    fireEvent.change(campos()[3], { target: { value: "21:00" } });
    expect(horarios()[3]).toBe("21:00");
  });

  it("falha na consulta e colaborador sem ponto não travam a conclusão: viram aviso", async () => {
    consulta.atual = { isError: true };
    const { unmount } = abrir();
    expect(screen.getByText(/Não foi possível consultar o ponto da Senior/)).toBeInTheDocument();
    unmount();
    consulta.atual = { data: { ponto_disponivel: false, colaborador: null } };
    abrir();
    expect(screen.getByText(/Ponto da Senior indisponível/)).toBeInTheDocument();
    expect(horarios()).toEqual(["07:30", "12:00", "13:00", "20:00"]);
  });

  it("o que a pessoa digitou fica, mesmo quando chega batida nova", async () => {
    consulta.atual = respostaCom(QUATRO.slice(0, 3));
    const { rerender } = abrir();
    await waitFor(() => expect(horarios()[1]).toBe("12:07"));
    fireEvent.change(campos()[1], { target: { value: "12:15" } });
    consulta.atual = respostaCom(QUATRO);
    rerender(<ConcluirHoraExtraDialog aberto aoFechar={() => {}} solicitacao={solicitacao} />);
    await waitFor(() => expect(horarios()[3]).toBe("20:50"));
    expect(horarios()[1]).toBe("12:15");
  });

  it("HE devolvida para ajuste mantém os horários salvos; o botão troca pelas batidas e busca de novo", async () => {
    abrir({
      ...solicitacao,
      ponto_entrada_real: "08:00:00",
      ponto_saida_intervalo_real: "12:00:00",
      ponto_retorno_intervalo_real: "13:00:00",
      ponto_saida_real: "21:00:00",
    });
    await waitFor(() => expect(screen.getByText(/Horários já informados mantidos/)).toBeInTheDocument());
    expect(horarios()).toEqual(["08:00", "12:00", "13:00", "21:00"]);

    fireEvent.click(screen.getByRole("button", { name: /Puxar da Senior/ }));
    await waitFor(() => expect(horarios()).toEqual(["07:30", "12:07", "12:39", "20:50"]));
    expect(consulta.refetch).toHaveBeenCalledTimes(1);
  });

  it("dia sem intervalo: entrada e saída, e os campos do intervalo seguem a entrada", async () => {
    consulta.atual = respostaCom([["2026-11-05", h(8)], ["2026-11-05", h(14)]]);
    abrir({ ...solicitacao, sem_intervalo: true });
    await waitFor(() => expect(horarios()[3]).toBe("14:00"));
    expect(horarios()[0]).toBe("08:00");
    expect(screen.getByText(/Puxado da Senior: Entrada, Saída\./)).toBeInTheDocument();
  });
});
