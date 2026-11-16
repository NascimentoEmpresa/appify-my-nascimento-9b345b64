import { describe, expect, it } from "vitest";
import { montarPainel, type ConfirmacaoPainel, type ItemPainel, type RespostaPainel } from "@/lib/implantacao/painelSetores";
import { itemComBolinha, pendenciasPorRota, setorAguardaConfirmacao } from "@/lib/implantacao/notifConfirmacao";

const itens: ItemPainel[] = [
  { row_index: 1, item: "CNPJ do órgão", responsavel_acao: "Todos" },
  { row_index: 2, item: "Pedido de compra de uniformes", responsavel_acao: "Compras" },
  { row_index: 3, item: "Treinamento NR", responsavel_acao: "SST/Treinamentos" },
];

const rotaCompras = "/app/licitacoes/implantacao/painel/compras";
const rotaSst = "/app/licitacoes/implantacao/painel/sst";

function contrato(respostas: RespostaPainel[], confirmacoes: ConfirmacaoPainel[] = [], status: "ativo" | "encerrado" = "ativo") {
  return { status, setores: montarPainel(itens, respostas, confirmacoes).setores };
}

const tudoRespondido: RespostaPainel[] = [
  { row_index: 1, resposta: "00.000.000/0001-00" },
  { row_index: 2, resposta: "Sim" },
  { row_index: 3, resposta: "Sim" },
];

describe("bolinha do Resumo dos Contratos", () => {
  it("acende para o setor com tudo respondido e sem confirmação", () => {
    const porRota = pendenciasPorRota([contrato(tudoRespondido)], ["compras", "sst"]);
    expect(porRota).toEqual({ [rotaCompras]: 1, [rotaSst]: 1 });
    expect(itemComBolinha(porRota, rotaCompras)).toBe(true);
  });

  it("só aparece para quem tem a permissão daquele setor", () => {
    const porRota = pendenciasPorRota([contrato(tudoRespondido)], ["compras"]);
    expect(itemComBolinha(porRota, rotaCompras)).toBe(true);
    expect(itemComBolinha(porRota, rotaSst)).toBe(false);
    expect(pendenciasPorRota([contrato(tudoRespondido)], [])).toEqual({});
  });

  it("some quando o setor confirma o recebimento", () => {
    const antes = contrato(tudoRespondido);
    const compras = antes.setores.find((s) => s.slug === "compras")!;
    const confirmado = contrato(tudoRespondido, [
      { setor: "Compras", assinatura: compras.assinatura, confirmado_em: "2026-11-13T12:00:00Z", confirmado_por: "u1" },
    ]);
    const porRota = pendenciasPorRota([confirmado], ["compras", "sst"]);
    expect(itemComBolinha(porRota, rotaCompras)).toBe(false);
    expect(itemComBolinha(porRota, rotaSst)).toBe(true);
  });

  it("não acende enquanto faltar resposta do setor (botão de confirmar desabilitado)", () => {
    const faltando = contrato([{ row_index: 1, resposta: "x" }, { row_index: 2, resposta: "  " }]);
    expect(pendenciasPorRota([faltando], ["compras"])).toEqual({});
  });

  it("contrato encerrado não espera ninguém", () => {
    expect(pendenciasPorRota([contrato(tudoRespondido, [], "encerrado")], ["compras"])).toEqual({});
  });

  it("conta um por contrato pendente", () => {
    const porRota = pendenciasPorRota([contrato(tudoRespondido), contrato(tudoRespondido)], ["compras"]);
    expect(porRota[rotaCompras]).toBe(2);
  });

  it("regra unitária", () => {
    expect(setorAguardaConfirmacao("ativo", { prontoParaConfirmar: true, confirmacao: null })).toBe(true);
    expect(setorAguardaConfirmacao("ativo", { prontoParaConfirmar: false, confirmacao: null })).toBe(false);
  });
});
