import { describe, expect, it } from "vitest";
import { extrairLinhasDoPdf, identificarLayoutPdf, rotuloTipo, TIPOS_RATEIO, totalDoPdf } from "@/lib/rh/rateioDespesas";

// Pedido do Pablo (10/11/2026, mig 20261110190000): tipo novo "Auxílio
// Farmácia PCD". O comprovante de pedido da SWAP/Prospera tem uma linha por
// beneficiário (Nome, CPF, Time, Valor) e o "Total" do pedido — a leitura
// genérica (CPF + último valor) já resolve. Linhas no formato do PDF real;
// nomes e CPFs inventados (CPFs válidos de exemplo).
const comprovante = [
  "Comprovante de pedido  Aguardando pagamento  Boleto",
  "Detalhamento do pedido",
  "Pedido #2483  Total: R$ 300,00",
  "Livre - Crédito  R$ 100,00",
  "Nome  Documento  Time  Valor",
  "Fulana Administrativa  529.982.247-25  Administrativo  R$ 100,00",
  "Saúde - Crédito  R$ 200,00",
  "Nome  Documento  Time  Valor",
  "Beltrano Da Silva  111.444.777-35  AUX FARMACIA  R$ 100,00",
  "PCD HAGG",
  "Ciclano Com Nome Muito  390.533.447-05  AUX FARMACIA  R$ 100,00",
  "Comprido  SN",
  "Pedido #2483  Total: R$ 300,00",
];

describe("Auxílio Farmácia PCD", () => {
  it("é um tipo de rateio pelo PDF", () => {
    expect(TIPOS_RATEIO.find((t) => t.tipo === "auxilio_farmacia_pcd")).toMatchObject({ criterio: "pdf" });
    expect(rotuloTipo("auxilio_farmacia_pcd")).toBe("Auxílio Farmácia PCD");
  });

  it("lê uma linha por beneficiário (CPF + valor) e o total do pedido", () => {
    const layout = identificarLayoutPdf(comprovante).layout;
    const linhas = extrairLinhasDoPdf(comprovante, layout);
    expect(linhas.map((l) => [l.cpf, l.valor])).toEqual([
      ["52998224725", 100],
      ["11144477735", 100],
      ["39053344705", 100],
    ]);
    expect(totalDoPdf(comprovante, layout)).toBe(300);
  });
});
