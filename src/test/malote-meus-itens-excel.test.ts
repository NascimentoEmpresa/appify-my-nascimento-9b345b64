import { describe, expect, it } from "vitest";
import type { ItemLinhaMalote, MaloteDespesaRow, Parcela } from "@/hooks/useMaloteDespesa";
import {
  CABECALHOS_EXCEL_MEUS_ITENS,
  montarLinhasExcelMeusItens,
  nomeArquivoMeusItens,
  tipoLabelDe,
} from "@/pages/malote/meusItensUtils";

function despesa(parcial: Partial<MaloteDespesaRow> = {}): MaloteDespesaRow {
  return {
    id: "despesa-1",
    numero: "MAL-001",
    empresa_id: "empresa-1",
    classificacao_id: null,
    origem: "despesa_unica",
    status: "aguardando_pagamento",
    nome: "Despesa de teste",
    valor_total: 100,
    data_pagamento: "2026-09-01",
    forma_pagamento: null,
    numero_parcelas: null,
    nivel_aprovacao_atual: null,
    excecao: false,
    justificativa_excecao: null,
    updated_at: "2026-09-15T14:30:00",
    ...parcial,
  } as MaloteDespesaRow;
}

function parcela(parcial: Partial<Parcela> = {}): Parcela {
  return {
    id: "parcela-1",
    despesa_id: "despesa-1",
    numero_parcela: 2,
    valor: 25.5,
    data_vencimento: "2026-09-01",
    status: "paga",
    comprovante_pagamento_path: null,
    observacao_pagamento: null,
    data_pagamento_real: null,
    pago_em: null,
    pago_por: null,
    banco_id: null,
    ...parcial,
  };
}

describe("exportação de Meus Itens do Malote", () => {
  it("mantém os cabeçalhos, a ordem, números e campos nulos", () => {
    const linhas = montarLinhasExcelMeusItens([{ despesa: despesa(), parcela: null }], () => "Empresa Teste");

    expect(Object.keys(linhas[0])).toEqual(CABECALHOS_EXCEL_MEUS_ITENS);
    expect(linhas[0]).toEqual(expect.objectContaining({
      "Data de pagamento": "01/09/2026",
      Classificação: "",
      "Forma de pagamento": "",
      "Valor (R$)": 100,
      "Justificativa da exceção": "",
    }));
    expect(typeof linhas[0]["Valor (R$)"]).toBe("number");
  });

  it("usa o status e os dados da parcela quando a despesa está aguardando pagamento", () => {
    const item: ItemLinhaMalote = {
      despesa: despesa({ numero_parcelas: 4 }),
      parcela: parcela(),
    };
    const linha = montarLinhasExcelMeusItens([item], () => "Empresa Teste")[0];

    expect(linha.Status).toBe("Despesa paga");
    expect(linha.Parcela).toBe("2/4");
    expect(linha["Valor (R$)"]).toBe(25.5);
  });

  it("exporta nível e todos os aprovadores pendentes", () => {
    const linha = montarLinhasExcelMeusItens([{
      despesa: despesa({
        status: "pendente_aprovacao",
        nivel_aprovacao_atual: 2,
        classificacao: { id: "class-1", nome: "Administrativo", aprovador2_nomes: ["A", "B"] },
      }),
      parcela: null,
    }], () => "Empresa Teste")[0];

    expect(linha.Status).toBe("Pendente aprovação N2");
    expect(linha["Aprovador pendente"]).toBe("A, B");
  });

  it("classifica solicitações pela fase atual", () => {
    expect(tipoLabelDe(despesa({ origem: "solicitacao", status: "cotacao_aprovada" }))).toBe("Despesa");
    expect(tipoLabelDe(despesa({ origem: "solicitacao", status: "aguardando_cotacao" }))).toBe("Solicitação");
  });

  it("gera nome de arquivo datado no horário local", () => {
    const data = new Date(2026, 0, 5);
    expect(nomeArquivoMeusItens("filtrado", data)).toBe("meus-itens-malote-filtrado-2026-01-05.xlsx");
    expect(nomeArquivoMeusItens("completo", data)).toBe("meus-itens-malote-completo-2026-01-05.xlsx");
  });
});
