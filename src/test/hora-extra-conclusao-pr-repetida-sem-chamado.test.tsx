/**
 * "No sistema de H.E tem que aceitar 2x PR do mesmo chamado, às vezes eu
 * lanço mais de uma PR pro mesmo chamado; tem que aceitar PRs sem chamado
 * também" — Pablo, 08/10/2026 (mig 20261008000009).
 *
 * A segunda PR do SIS-2026-0544 era recusada com "O chamado #SIS-2026-0544 já
 * está listado nesta HE." e PR [SEM-CHAMADO] nem passava da Edge. Render,
 * como o teste da lixeira: o que estava errado era o comportamento da tabela.
 */
import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChamadoHoraExtra, SolicitacaoHoraExtra } from "@/pages/sistemas/hora-extra/types";

vi.mock("@/hooks/useHoraExtra", () => ({
  useConcluirHoraExtra: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useEnviarAnexosHoraExtra: () => vi.fn(async () => []),
  buscarInformacoesPrHoraExtra: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn() } }));

import { toast } from "sonner";
import { buscarInformacoesPrHoraExtra } from "@/hooks/useHoraExtra";
import ConcluirHoraExtraDialog from "@/pages/sistemas/hora-extra/ConcluirHoraExtraDialog";

const linha = (numero: string, pr: number): ChamadoHoraExtra => ({
  id: `linha-${numero}`,
  chamado_id: `chamado-${numero}`,
  chamado_numero: numero,
  chamado_assunto: `Assunto de ${numero}`,
  prioridade: "media",
  adicional: false,
  percentual_previsto: 100,
  percentual_concluido: 100,
  status_execucao: "concluido",
  pr_numero: pr,
  pr_url: `https://github.com/x/pull/${pr}`,
  pr_titulo: `${numero}: entrega`,
  pr_linhas_adicionadas: 100,
  pr_commits: 2,
  pr_arquivos_adicionados: 5,
});

const solicitacao: SolicitacaoHoraExtra = {
  id: "he-38",
  numero: "HE-2026-0038",
  colaborador_id: "u1",
  colaborador_nome: "Pablo",
  criado_por: "u1",
  data_he: "2026-10-07",
  tipo: "normal",
  ponto_entrada: "07:42",
  ponto_saida_intervalo: "12:01",
  ponto_retorno_intervalo: "12:50",
  ponto_saida: "21:19",
  jornada_minutos: 528,
  he_inicio_previsto: "17:19",
  he_fim_previsto: "21:19",
  total_previsto_min: 240,
  justificativa: "Chamados",
  status: "aprovada",
  created_at: "2026-10-07T10:00:00Z",
  updated_at: "2026-10-07T10:00:00Z",
  chamados: [linha("SIS-2026-0587", 825), linha("SIS-2026-0544", 827)],
};

const pr = (numero: number, titulo: string) => ({
  numero, url: `https://github.com/x/pull/${numero}`, titulo, linhas_adicionadas: 10, commits: 1, arquivos_adicionados: 2,
});

/** "Adicionar Chamado", digita a PR na linha nova e confirma com Enter. */
async function adicionarPr(numero: number) {
  fireEvent.click(screen.getByRole("button", { name: /Adicionar Chamado/ }));
  const entradas = screen.getAllByLabelText("Número da Pull Request");
  const nova = entradas[entradas.length - 1];
  fireEvent.change(nova, { target: { value: `#${numero}` } });
  fireEvent.keyDown(nova, { key: "Enter" });
}

describe("conclusão da HE — várias PRs por chamado e PR sem chamado", () => {
  beforeEach(() => {
    vi.mocked(toast.error).mockClear();
    vi.mocked(buscarInformacoesPrHoraExtra).mockReset();
  });

  it("aceita a segunda PR do mesmo chamado como outra linha", async () => {
    vi.mocked(buscarInformacoesPrHoraExtra).mockResolvedValueOnce({
      pr: pr(826, "SIS-2026-0544: ajuste"),
      chamado: { id: "chamado-SIS-2026-0544", numero: "SIS-2026-0544", assunto: "Assunto de SIS-2026-0544" } as never,
    });
    render(<ConcluirHoraExtraDialog aberto aoFechar={() => {}} solicitacao={solicitacao} />);
    await adicionarPr(826);

    expect(await screen.findByText("#826")).toBeInTheDocument();
    expect(screen.getAllByText("#SIS-2026-0544")).toHaveLength(2);
    expect(toast.error).not.toHaveBeenCalled();
    // A TOTAL conta PRs e chamados sem repetir.
    const total = screen.getByText("TOTAL · 3 PRs").closest("tr") as HTMLElement;
    expect(within(total).getByText("2 chamados")).toBeInTheDocument();
  });

  it("aceita PR sem chamado, como linha adicional marcada 'Sem chamado'", async () => {
    vi.mocked(buscarInformacoesPrHoraExtra).mockResolvedValueOnce({
      pr: pr(830, "[SEM-CHAMADO] TV's: ajuste"),
      chamado: null,
      sem_chamado: true,
    });
    render(<ConcluirHoraExtraDialog aberto aoFechar={() => {}} solicitacao={solicitacao} />);
    await adicionarPr(830);

    expect(await screen.findByText("Sem chamado")).toBeInTheDocument();
    expect(screen.getByText("[SEM-CHAMADO] TV's: ajuste")).toBeInTheDocument();
    expect(toast.error).not.toHaveBeenCalled();
    const total = screen.getByText("TOTAL · 3 PRs").closest("tr") as HTMLElement;
    expect(within(total).getByText("2 chamados · 1 sem chamado")).toBeInTheDocument();
  });

  it("a mesma PR em duas linhas continua recusada", async () => {
    render(<ConcluirHoraExtraDialog aberto aoFechar={() => {}} solicitacao={solicitacao} />);
    await adicionarPr(827);

    expect(toast.error).toHaveBeenCalledWith("A PR #827 já está em outra linha desta HE.");
    expect(buscarInformacoesPrHoraExtra).not.toHaveBeenCalled();
  });
});
