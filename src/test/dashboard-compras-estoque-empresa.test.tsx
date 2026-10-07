import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { consultarDashboard } = vi.hoisted(() => ({
  consultarDashboard: vi.fn(),
}));

vi.mock("@/components/auth/AcessoGate", () => ({
  AcessoGate: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("@/context/EmpresaAtivaContext", () => ({
  useEmpresaAtiva: () => ({
    empresa: { id: "agps", sigla: "AGPS", razao: "AGPS ADMINISTRADORA" },
    empresas: [
      { id: "agps", sigla: "AGPS", razao: "AGPS ADMINISTRADORA" },
      { id: "hagg", sigla: "HAGG", razao: "NASCIMENTO SERVIÇOS" },
    ],
  }),
}));

vi.mock("@/hooks/useEmpresaId", () => ({
  useEmpresaId: () => ({ data: "hagg" }),
}));

vi.mock("@/hooks/useDashboardComprasEstoque", () => ({
  useDashboardComprasEstoque: (empresaId: string | null, filtros: unknown) => {
    consultarDashboard(empresaId, filtros);
    return {
      data: undefined,
      error: null,
      isLoading: true,
      isFetching: false,
      refetch: vi.fn(),
    };
  },
}));

import DashboardComprasEstoque from "@/pages/suprimentos/DashboardComprasEstoque";

describe("dashboard de Suprimentos — empresa operacional", () => {
  beforeEach(() => consultarDashboard.mockClear());

  it("consulta a empresa do perfil mesmo quando a empresa global ativa é outra", () => {
    render(<DashboardComprasEstoque />);

    expect(consultarDashboard).toHaveBeenCalledWith("hagg", expect.objectContaining({
      contratoId: null,
      categoria: null,
      comprador: null,
    }));
    expect(screen.getByText("NASCIMENTO SERVIÇOS")).toBeInTheDocument();
  });
});
