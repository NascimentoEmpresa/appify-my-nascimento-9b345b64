import { describe, expect, it } from "vitest";
import { montarDadosExcelFornecedores } from "@/lib/suprimentos/fornecedoresExcel";

describe("exportação de fornecedores", () => {
  it("leva todos os campos cadastrais, inclusive fornecedor inativo", () => {
    const resultado = montarDadosExcelFornecedores([
      {
        id: "fornecedor-1",
        tipo: "pj",
        cnpj_cpf: "12.345.678/0001-90",
        razao_social: "Fornecedor Teste Ltda.",
        nome_fantasia: "Fornecedor Teste",
        inscricao_estadual: "123.456.789.000",
        cnae_principal: "46.49-4-99",
        socios: [{ nome: "Ana Souza", cpf: "111.222.333-44" }],
        contato: "Maria",
        telefone: "(11) 99999-9999",
        email: "contato@teste.com",
        cidade: "São Paulo",
        uf: "SP",
        endereco: null,
        cep: "01001-000",
        logradouro: "Praça da Sé",
        numero: "100",
        complemento: "Sala 1",
        bairro: "Sé",
        pix_tipo: "cnpj",
        pix_chave: "12.345.678/0001-90",
        observacoes: "Atendimento nacional",
        ativo: false,
        is_global: true,
        created_at: "2026-01-15T10:00:00.000Z",
        updated_at: "2026-09-14T12:00:00.000Z",
        email_financeiro: "financeiro@teste.com",
        email_nota_fiscal: "nfe@teste.com",
        telefone_vendedor: "(11) 98888-8888",
        formas_pagamento: ["boleto", "pix"],
        condicao_pagamento: "30/60 dias",
        prazo_entrega_dias: 7,
        devolucao_prazo_dias: 10,
        devolucao_procedimento: "Solicitar autorização por e-mail",
      },
    ], [], []);

    expect(resultado.abaFornecedores).toEqual([
      expect.objectContaining({
        "Razão social / Nome": "Fornecedor Teste Ltda.",
        "E-mail do financeiro": "financeiro@teste.com",
        "Inscrição estadual": "123.456.789.000",
        Sócios: "Ana Souza — 111.222.333-44",
        Logradouro: "Praça da Sé",
        "Formas de pagamento": "Boleto, PIX",
        "Prazo de entrega (dias)": 7,
        "Procedimento de devolução": "Solicitar autorização por e-mail",
        Status: "Inativo",
        "Fornecedor global": "Sim",
        "Data de cadastro": expect.any(Date),
      }),
    ]);
  });

  it("relaciona contas bancárias e materiais ao fornecedor correto", () => {
    const fornecedor = {
      id: "fornecedor-1", tipo: "pf", cnpj_cpf: "123.456.789-00",
      razao_social: "João da Silva", nome_fantasia: null, contato: null,
      inscricao_estadual: null, cnae_principal: null, socios: [],
      telefone: null, email: null, cidade: null, uf: null, observacoes: null,
      endereco: null, cep: null, logradouro: null, numero: null, complemento: null,
      bairro: null, pix_tipo: null, pix_chave: null,
      ativo: true, email_financeiro: null, email_nota_fiscal: null,
      is_global: false, created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
      telefone_vendedor: null, formas_pagamento: [], condicao_pagamento: null,
      prazo_entrega_dias: null, devolucao_prazo_dias: null,
      devolucao_procedimento: null,
    };

    const resultado = montarDadosExcelFornecedores([fornecedor], [{
      fornecedor_id: fornecedor.id,
      banco_codigo: "001", banco_nome: "Banco do Brasil", agencia: "1234",
      agencia_digito: "5", conta: "98765", conta_digito: "4", tipo: "corrente",
      titular_nome: "João da Silva", pix_tipo: "cpf", pix_chave: "123.456.789-00",
      titular_documento: "123.456.789-00", principal: true, ativa: true,
      observacoes: "Conta confirmada",
    }], [{
      fornecedor_id: fornecedor.id,
      codigo_fornecedor: "BOT-42",
      sup_item: { nome: "Botina de segurança", tipo: "epi" },
    }]);

    expect(resultado.abaContas[0]).toEqual(expect.objectContaining({
      Fornecedor: "João da Silva",
      Agência: "1234-5",
      Conta: "98765-4",
      Principal: "Sim",
    }));
    expect(resultado.abaMateriais[0]).toEqual(expect.objectContaining({
      Fornecedor: "João da Silva",
      Material: "Botina de segurança",
      Tipo: "EPI",
      "Código do fornecedor": "BOT-42",
    }));
  });
});
