/**
 * "Os chamados SIS-2026-0496 e SIS-2026-0490 eu não terminei" — 22/09/2026.
 *
 * A tabela de conclusão da HE exige uma PR do GitHub por linha, e a lixeira
 * só aparecia nos chamados ADICIONAIS. Chamado que entrou na solicitação mas
 * não foi feito não tinha PR para informar nem como sair da tabela: a HE
 * inteira ficava presa no botão "Concluir e Enviar para Aprovação".
 *
 * A regra de quem pode sair é testada em hora-extra-pr.test.ts. Este é um
 * teste de render — fora do padrão do projeto, como o de diárias — porque o
 * que estava errado era a própria coluna Ações: só renderizando dá para
 * provar que a lixeira agora existe em TODA linha e que o chamado escolhido
 * some da tabela depois da confirmação.
 */
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ChamadoHoraExtra, SolicitacaoHoraExtra } from "@/pages/sistemas/hora-extra/types";

// As bordas de rede do modal: sem isto o teste subiria react-query e o
// cliente do Supabase só para desenhar a tabela.
vi.mock("@/hooks/useHoraExtra", () => ({
  useConcluirHoraExtra: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useEnviarAnexosHoraExtra: () => vi.fn(async () => []),
  buscarInformacoesPrHoraExtra: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn() } }));

import ConcluirHoraExtraDialog from "@/pages/sistemas/hora-extra/ConcluirHoraExtraDialog";

const chamado = (
  numero: string,
  adicional: boolean,
  pr: number | null,
): ChamadoHoraExtra => ({
  id: `linha-${numero}`,
  chamado_id: `chamado-${numero}`,
  chamado_numero: numero,
  chamado_assunto: `Assunto de ${numero}`,
  prioridade: "media",
  adicional,
  percentual_previsto: adicional ? null : 100,
  percentual_concluido: pr ? 100 : 0,
  status_execucao: pr ? "concluido" : "nao_iniciado",
  pr_numero: pr,
  pr_url: pr ? `https://github.com/x/pull/${pr}` : null,
  pr_titulo: pr ? `${numero}: entrega` : null,
  pr_linhas_adicionadas: pr ? 411 : null,
  pr_commits: pr ? 2 : null,
  pr_arquivos_adicionados: pr ? 11 : null,
});

const solicitacao: SolicitacaoHoraExtra = {
  id: "he-1",
  numero: "HE-2026-0013",
  colaborador_id: "u1",
  colaborador_nome: "Eduardo",
  criado_por: "u1",
  data_he: "2026-09-22",
  tipo: "normal",
  ponto_entrada: "07:30",
  ponto_saida_intervalo: "12:00",
  ponto_retorno_intervalo: "13:00",
  ponto_saida: "20:36",
  jornada_minutos: 528,
  he_inicio_previsto: "17:18",
  he_fim_previsto: "20:36",
  total_previsto_min: 198,
  justificativa: "Chamados em aberto",
  status: "aprovada",
  created_at: "2026-09-21T10:00:00Z",
  updated_at: "2026-09-21T10:00:00Z",
  chamados: [
    chamado("SIS-2026-0496", false, null),
    chamado("SIS-2026-0494", false, 656),
    chamado("SIS-2026-0470", true, 666),
  ],
};

const abrir = () =>
  render(<ConcluirHoraExtraDialog aberto aoFechar={() => {}} solicitacao={solicitacao} />);

describe("conclusão da HE — remover chamado do relatório", () => {
  it("oferece a lixeira em toda linha, inclusive nos chamados da solicitação", () => {
    abrir();
    expect(screen.getByLabelText("Remover o chamado SIS-2026-0496 do relatório")).toBeInTheDocument();
    expect(screen.getByLabelText("Remover o chamado SIS-2026-0494 do relatório")).toBeInTheDocument();
    expect(screen.getByLabelText("Remover o chamado SIS-2026-0470 do relatório")).toBeInTheDocument();
  });

  it("tira da tabela o chamado que não foi realizado, depois de confirmar", () => {
    abrir();
    fireEvent.click(screen.getByLabelText("Remover o chamado SIS-2026-0496 do relatório"));

    const confirmacao = screen.getByRole("alertdialog");
    expect(
      within(confirmacao).getByText("Remover o chamado #SIS-2026-0496 do relatório?"),
    ).toBeInTheDocument();
    fireEvent.click(within(confirmacao).getByRole("button", { name: "Remover" }));

    expect(screen.queryByText("#SIS-2026-0496")).not.toBeInTheDocument();
    expect(screen.getByText("#SIS-2026-0494")).toBeInTheDocument();
    expect(screen.getByText("#SIS-2026-0470")).toBeInTheDocument();
  });

  it("mantém a linha quando a confirmação é recusada", () => {
    abrir();
    fireEvent.click(screen.getByLabelText("Remover o chamado SIS-2026-0496 do relatório"));
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Voltar" }));

    expect(screen.getByText("#SIS-2026-0496")).toBeInTheDocument();
  });
});
