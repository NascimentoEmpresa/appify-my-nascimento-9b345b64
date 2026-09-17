/**
 * "Após voltar para ajuste some todos os campos que já haviam sido
 * preenchidos" — relato de 17/09/2026, em produção.
 *
 * A causa não estava no mapeamento dos valores, estava no GUARD que decide se
 * o bloco de preenchimento roda: `useState(chave)` fazia `chaveAtual` nascer
 * igual a `chave`, então a comparação dava falso já na primeira renderização.
 * E como o modal é montado do zero a cada abertura, a primeira renderização é
 * a única que existe — o bloco nunca rodou uma vez sequer.
 *
 * Passou despercebido porque os outros modos não dependiam dele: "nova" quer
 * campos vazios (que já é o valor inicial) e os de leitura nem usam esse
 * estado. Teste de mapeamento puro não teria pego isso — só renderizar pega.
 * Daí este ser um teste de render, fora do padrão do projeto.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { SolicitacaoDiaria } from "@/pages/operacional/diarias";

// As bordas de rede do modal. Sem isto o teste subiria react-query e o cliente
// do Supabase só para desenhar um formulário.
vi.mock("@/hooks/useDiarias", async () => {
  const real = await vi.importActual<typeof import("@/hooks/useDiarias")>("@/hooks/useDiarias");
  return {
    ...real,
    useContratosDiaria: () => ({
      data: [{ id: "c1", nome: "Contrato 1", cliente: "Cliente", empresa: "Empresa" }],
      isLoading: false,
      isError: false,
      error: null,
    }),
    usePostosDiaria: () => ({
      data: [{ id: "p1", nome: "Posto A" }],
      isFetching: false,
      isError: false,
      error: null,
    }),
    useEmpresaContratoDiaria: () => ({ data: "e1", isLoading: false }),
    useBuscaEmpregadosDiaria: () => ({ data: [], isFetching: false }),
  };
});

vi.mock("@/hooks/usePlanejamentoOrcamentario", () => ({
  useClassificacoesOrcamento: () => ({ data: [], isLoading: false }),
}));

// Só renderiza no modo "aprovar", mas importar puxa o módulo inteiro do Malote.
vi.mock("@/pages/malote/PainelDespesaMalote", () => ({
  FORM_ID_PAINEL_DESPESA_DIARIA: "form-despesa-diaria",
  PainelDespesaMalote: () => null,
}));

import { SolicitacaoDiariaModal } from "@/pages/operacional/SolicitacaoDiariaModal";

const devolvida: SolicitacaoDiaria = {
  uuid: "u1",
  id: "SD-2026-000040",
  criadoEm: "17/09/2026, 08:21:46",
  status: "em_ajuste",
  contratoId: "c1",
  contratoNome: "Contrato 1",
  contratoCliente: "Cliente",
  contratoEmpresa: "Empresa",
  posto: "Posto A",
  faltanteNome: "MARIA DA SILVA",
  faltanteCpf: "529.982.247-25",
  diaristaNome: "JOAO PEREIRA",
  diaristaCpf: "111.444.777-35",
  pix: "111.444.777-35",
  pixTipo: "cpf",
  diarias: [
    { id: "l1", data: "2026-09-18", turno: "tarde", qtVt: 2, valorUnitVt: 5.5, valorDiaria: 120 },
  ],
  comprovantePonto: [],
  documentos: [],
  observacoes: "Cobertura do posto da portaria.",
  solicitanteId: "user-1",
  solicitante: "Fulano",
  ajusteMotivo: "é 4 reais e nao 4 mil",
  ajustePedidoPor: "Iury de Jesus Silva",
  ajustePedidoEm: "17/09/2026, 08:23:10",
  comprovantesPagamento: [],
};

const abrir = (modo: "ajustar" | "nova") =>
  render(
    <SolicitacaoDiariaModal
      aberto
      modo={modo}
      solicitacao={modo === "ajustar" ? devolvida : null}
      existentes={[devolvida]}
      onFechar={() => {}}
      onSalvar={() => {}}
      onReenviar={() => {}}
      onAprovar={() => {}}
      onReprovar={() => {}}
    />,
  );

describe("modo ajustar", () => {
  it("abre com os campos preenchidos como a solicitação foi enviada", () => {
    abrir("ajustar");
    // Pessoas e Pix: é o que sumia inteiro no relato.
    expect(screen.getByDisplayValue("MARIA DA SILVA")).toBeInTheDocument();
    expect(screen.getByDisplayValue("529.982.247-25")).toBeInTheDocument();
    expect(screen.getByDisplayValue("JOAO PEREIRA")).toBeInTheDocument();
    // Dois: o campo de CPF do diarista e o da chave Pix, que aqui é o mesmo
    // CPF — caso comum de verdade, e que prova os DOIS campos preenchidos.
    expect(screen.getAllByDisplayValue("111.444.777-35")).toHaveLength(2);
    // A grade de diárias volta com a linha lançada, não com uma linha vazia.
    expect(screen.getByDisplayValue("2026-09-18")).toBeInTheDocument();
    expect(screen.getByDisplayValue("120")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Cobertura do posto da portaria.")).toBeInTheDocument();
  });

  it("mostra o que o Operacional pediu para ajustar", () => {
    abrir("ajustar");
    expect(screen.getByText("é 4 reais e nao 4 mil")).toBeInTheDocument();
    expect(screen.getByText(/Iury de Jesus Silva/)).toBeInTheDocument();
  });

  it("os campos continuam EDITÁVEIS — ajustar é corrigir, não reler", () => {
    abrir("ajustar");
    expect(screen.getByDisplayValue("MARIA DA SILVA")).not.toHaveAttribute("readonly");
    expect(screen.getByRole("button", { name: /Reenviar para aprovação/i })).toBeInTheDocument();
  });

  it("não contamina o modo nova: ali os campos continuam vazios", () => {
    abrir("nova");
    expect(screen.queryByDisplayValue("MARIA DA SILVA")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Salvar solicitação/i })).toBeInTheDocument();
  });
});
