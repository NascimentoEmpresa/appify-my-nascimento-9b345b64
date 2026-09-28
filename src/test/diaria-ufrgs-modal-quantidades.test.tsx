import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

/**
 * SIS-2026-0429 — relato de 28/09/2026: quem abria uma Diária UFRGS já
 * lançada (Operacional, aprovação para o Malote) via Qt. Hosp./Café/Alm./
 * Janta/VA zerados, enquanto a lista mostrava os números certos.
 *
 * O painel só MONTA o modal quando há linha escolhida, então a primeira
 * renderização já é a abertura — e a carga do formulário não rodava nela.
 * Este teste monta o modal do mesmo jeito que o painel (direto, `aberto`)
 * e confere que as quantidades gravadas aparecem.
 */

const { vazio } = vi.hoisted(() => ({ vazio: { data: [], isLoading: false } }));
vi.mock("@/hooks/useDiariasUfrgs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/useDiariasUfrgs")>()),
  useTarifasUfrgs: () => vazio,
  useLotacoesUfrgs: () => vazio,
  usePostosUfrgs: () => vazio,
  useBuscaMotoristasUfrgs: () => vazio,
}));
vi.mock("@/hooks/useDiarias", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/useDiarias")>()),
  useContratosDiaria: () => vazio,
  useEmpresaContratoDiaria: () => ({ data: null, isLoading: false }),
}));
vi.mock("@/hooks/usePlanejamentoOrcamentario", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/usePlanejamentoOrcamentario")>()),
  useClassificacoesOrcamento: () => vazio,
}));
vi.mock("@/pages/malote/PainelDespesaMalote", () => ({
  FORM_ID_PAINEL_DESPESA_DIARIA: "form-painel-despesa-diaria",
  PainelDespesaMalote: () => null,
}));

import { DiariaUfrgsModal } from "@/pages/operacional/DiariaUfrgsModal";
import type { DiariaUfrgs } from "@/pages/operacional/diariasUfrgs";

const diaria = {
  uuid: "00000000-0000-0000-0000-000000000005",
  id: "DU-2026-000005",
  criadoEm: "2026-09-28T12:00:00Z",
  status: "aprovada",
  contratoId: "c1",
  contratoNome: "UFRGS",
  contratoCliente: "UFRGS",
  contratoEmpresa: "Empresa",
  competencia: "2026-09-01",
  codFornecedor: "",
  matricula: "5644",
  motoristaEmpregadoId: null,
  motoristaNome: "MOTORISTA TESTE",
  sindicato: "SINDIRODOSUL/RS",
  lotacao: "DITRAN",
  numeroOficio: "001/2026",
  saida: "2026-09-29",
  retorno: "2026-09-30",
  destino: "Uruguaiana",
  dataDeposito: null,
  posto: "B3",
  postoDescricao: "",
  valorPostoVariavelCentavos: 0,
  fiscal: "",
  pix: "",
  pixTipo: null,
  qtHospedagem: 7,
  qtCafe: 8,
  qtAlmoco: 9,
  qtJanta: 6,
  qtVa: 4,
  anexos: [],
} as unknown as DiariaUfrgs;

const permissoes = {
  incluir: true,
  excluir: false,
  aprovar: true,
  enviarMalote: true,
  editarTarifas: false,
};

const noop = () => {};

function montar(modo: "visualizar" | "editar") {
  render(
    <DiariaUfrgsModal
      aberto
      modo={modo}
      diaria={diaria}
      existentes={[diaria]}
      permissoes={permissoes}
      onFechar={noop}
      onSalvar={noop}
      onEditar={noop}
      onDecidir={noop}
      onEnviarMalote={noop}
      onSolicitarAjuste={noop}
      onExcluir={noop}
      onPedirEdicao={noop}
    />,
  );
}

describe("Diária UFRGS — modal aberto direto mostra as quantidades gravadas", () => {
  it("no visualizar (Operacional / aprovação para o Malote)", () => {
    montar("visualizar");
    for (const n of ["7", "8", "9", "6", "4"]) {
      expect(screen.getByText(n, { selector: "div" })).toBeInTheDocument();
    }
  });

  it("no editar aberto pela lista (formulário nasce preenchido)", () => {
    montar("editar");
    const numeros = screen
      .getAllByRole("spinbutton")
      .map((el) => (el as HTMLInputElement).value);
    expect(numeros).toEqual(expect.arrayContaining(["7", "8", "9", "6", "4"]));
    expect(screen.getByDisplayValue("Uruguaiana")).toBeInTheDocument();
  });
});
