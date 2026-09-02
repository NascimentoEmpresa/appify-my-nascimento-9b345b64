import { useState } from "react";
import { createEvent, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PainelDespesaMalote } from "@/pages/malote/PainelDespesaMalote";
import { DimensoesRateio, RateioGrid } from "@/pages/malote/RateioGrid";
import type { RateioLinha } from "@/hooks/useMaloteDespesa";
import { toast } from "sonner";

vi.mock("react-router-dom", async () => {
  const original = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return { ...original, useSearchParams: () => [new URLSearchParams(), vi.fn()] };
});

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn() },
}));

vi.mock("@/hooks/useMaloteDespesa", () => ({
  buscarNumeroDespesa: vi.fn(),
  gerarParcelas: vi.fn(() => []),
  registrarEventoDespesa: vi.fn(),
  uploadAnexoMalote: vi.fn(),
  useConverterSolicitacaoEmDespesa: () => ({ mutateAsync: vi.fn() }),
  useSalvarDespesa: () => ({ mutateAsync: vi.fn() }),
  useJustificarRateioLinha: () => ({ mutateAsync: vi.fn() }),
  useEmpresasGrupo: () => ({ data: [] }),
  useContratosAtivos: () => ({ data: [] }),
  useFornecedoresAtivos: () => ({ data: [] }),
  useIntegrantes: () => ({ data: [] }),
}));

vi.mock("@/hooks/useMaloteConfig", () => ({
  horaAtualPassouDe: vi.fn(() => false),
  useMaloteConfig: () => ({ data: undefined }),
  useMaloteDiasBloqueados: () => ({ data: [] }),
  usePrazoNormalInclusao: () => ({ data: undefined }),
}));

vi.mock("@/hooks/useMaloteFormaPagamento", () => ({
  useTiposFormaPagamento: () => ({ data: [] }),
}));

vi.mock("@/hooks/useUtilizadoOrcamento", () => ({
  useUtilizadoOrcamento: () => ({ data: [] }),
}));

vi.mock("@/hooks/useMaloteAnalistas", () => ({
  useMeusContratosAnalista: () => ({ data: [] }),
}));

vi.mock("@/pages/juridico/patrimonio/vinculoMalote", () => ({
  PARAM_ORIGEM: "origem",
  vincularContaAoMalote: vi.fn(),
}));

const dimensoesEmpresa: DimensoesRateio = {
  empresa: true,
  contrato: false,
  fornecedor: false,
  integrante: false,
};

function RateioDentroDeForm({ onSubmit }: { onSubmit: ReturnType<typeof vi.fn> }) {
  const [linhas, setLinhas] = useState<RateioLinha[]>([]);

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <RateioGrid
        linhas={linhas}
        onChange={setLinhas}
        dimensoes={dimensoesEmpresa}
        onDimensoesChange={vi.fn()}
        ratearPor="valor"
        onRatearPorChange={vi.fn()}
        valorTotal={100}
      />
    </form>
  );
}

describe("PainelDespesaMalote dentro de formulário", () => {
  beforeAll(() => {
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as typeof ResizeObserver;
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("não submete ao adicionar ou remover uma linha de rateio", () => {
    const onSubmit = vi.fn();
    const { container } = render(<RateioDentroDeForm onSubmit={onSubmit} />);

    const adicionar = screen.getByRole("button", { name: /adicionar linha/i });
    expect(adicionar).toHaveAttribute("type", "button");
    fireEvent.click(adicionar);
    expect(onSubmit).not.toHaveBeenCalled();

    const remover = container.querySelector("svg.lucide-trash-2")?.closest("button");
    expect(remover).toHaveAttribute("type", "button");
    fireEvent.click(remover!);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("bloqueia Enter em input e mantém o submit explícito ativo", () => {
    const aoSalvar = vi.fn();
    render(
      <MemoryRouter>
        <PainelDespesaMalote
          classificacaoId="classificacao"
          empresaId="empresa"
          ativo
          nomeInicial="DIÁRIA"
          valorInicial={100}
          aoSalvar={aoSalvar}
          rotuloEnviar="Aprovar e enviar"
        />
      </MemoryRouter>,
    );

    const nome = screen.getByPlaceholderText(/compra de materiais/i);
    const enter = createEvent.keyDown(nome, { key: "Enter", code: "Enter" });
    fireEvent(nome, enter);
    expect(enter.defaultPrevented).toBe(true);
    expect(toast.error).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Aprovar e enviar" }));
    expect(toast.error).toHaveBeenCalledWith("Informe a data de pagamento.");
  });
});
