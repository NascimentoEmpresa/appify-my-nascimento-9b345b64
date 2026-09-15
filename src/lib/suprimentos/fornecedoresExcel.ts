export interface FornecedorExcel {
  id: string;
  tipo: string;
  cnpj_cpf: string | null;
  razao_social: string;
  nome_fantasia: string | null;
  inscricao_estadual: string | null;
  cnae_principal: string | null;
  socios: unknown;
  contato: string | null;
  telefone: string | null;
  email: string | null;
  cidade: string | null;
  uf: string | null;
  endereco: string | null;
  cep: string | null;
  logradouro: string | null;
  numero: string | null;
  complemento: string | null;
  bairro: string | null;
  pix_tipo: string | null;
  pix_chave: string | null;
  observacoes: string | null;
  ativo: boolean;
  is_global: boolean;
  created_at: string;
  updated_at: string;
  email_financeiro: string | null;
  email_nota_fiscal: string | null;
  telefone_vendedor: string | null;
  formas_pagamento: string[] | null;
  condicao_pagamento: string | null;
  prazo_entrega_dias: number | null;
  devolucao_prazo_dias: number | null;
  devolucao_procedimento: string | null;
}

export interface ContaFornecedorExcel {
  fornecedor_id: string;
  banco_codigo: string | null;
  banco_nome: string | null;
  agencia: string | null;
  agencia_digito: string | null;
  conta: string | null;
  conta_digito: string | null;
  tipo: string | null;
  titular_nome: string | null;
  titular_documento: string | null;
  pix_tipo: string | null;
  pix_chave: string | null;
  principal: boolean;
  ativa: boolean;
  observacoes: string | null;
}

export interface MaterialFornecedorExcel {
  fornecedor_id: string;
  codigo_fornecedor: string | null;
  sup_item: { nome: string; tipo: string } | null;
}

const ROTULOS_FORMA_PAGAMENTO: Record<string, string> = {
  boleto: "Boleto",
  pix: "PIX",
  transferencia: "Transferência / TED",
};

const ROTULOS_TIPO_MATERIAL: Record<string, string> = {
  epi: "EPI",
  uniforme: "Uniforme",
  insumo: "Insumo",
  equipamento: "Equipamento",
};

function juntarNumero(numero: string | null, digito: string | null): string {
  if (!numero) return "";
  return digito ? `${numero}-${digito}` : numero;
}

function formatarSocios(socios: unknown): string {
  if (!socios) return "";
  if (typeof socios === "string") return socios;
  if (!Array.isArray(socios)) return JSON.stringify(socios);

  return socios.map((socio) => {
    if (!socio || typeof socio !== "object") return String(socio);
    const dados = socio as Record<string, unknown>;
    const nome = dados.nome ?? dados.nome_socio ?? dados.razao_social;
    const documento = dados.cpf_cnpj ?? dados.cpf ?? dados.documento;
    return [nome, documento].filter(Boolean).join(" — ") || JSON.stringify(socio);
  }).join("; ");
}

function dataExcel(valor: string): Date | null {
  const data = new Date(valor);
  return Number.isNaN(data.getTime()) ? null : data;
}

export function montarDadosExcelFornecedores(
  fornecedores: FornecedorExcel[],
  contas: ContaFornecedorExcel[],
  materiais: MaterialFornecedorExcel[],
) {
  const fornecedorPorId = new Map(fornecedores.map((fornecedor) => [fornecedor.id, fornecedor]));

  const abaFornecedores = fornecedores.map((fornecedor) => ({
    Tipo: fornecedor.tipo === "pf" ? "Pessoa física" : "Pessoa jurídica",
    "CNPJ / CPF": fornecedor.cnpj_cpf ?? "",
    "Razão social / Nome": fornecedor.razao_social,
    "Nome fantasia": fornecedor.nome_fantasia ?? "",
    "Inscrição estadual": fornecedor.inscricao_estadual ?? "",
    "CNAE principal": fornecedor.cnae_principal ?? "",
    Sócios: formatarSocios(fornecedor.socios),
    "Pessoa de contato": fornecedor.contato ?? "",
    Telefone: fornecedor.telefone ?? "",
    "E-mail": fornecedor.email ?? "",
    Cidade: fornecedor.cidade ?? "",
    UF: fornecedor.uf ?? "",
    CEP: fornecedor.cep ?? "",
    Logradouro: fornecedor.logradouro ?? fornecedor.endereco ?? "",
    Número: fornecedor.numero ?? "",
    Complemento: fornecedor.complemento ?? "",
    Bairro: fornecedor.bairro ?? "",
    "E-mail do financeiro": fornecedor.email_financeiro ?? "",
    "E-mail para nota fiscal": fornecedor.email_nota_fiscal ?? "",
    "Telefone do vendedor": fornecedor.telefone_vendedor ?? "",
    "Formas de pagamento": (fornecedor.formas_pagamento ?? [])
      .map((forma) => ROTULOS_FORMA_PAGAMENTO[forma] ?? forma)
      .join(", "),
    "Condição de pagamento": fornecedor.condicao_pagamento ?? "",
    "Prazo de entrega (dias)": fornecedor.prazo_entrega_dias,
    "Prazo de devolução (dias)": fornecedor.devolucao_prazo_dias,
    "Procedimento de devolução": fornecedor.devolucao_procedimento ?? "",
    "Tipo da chave PIX (cadastro)": fornecedor.pix_tipo ?? "",
    "Chave PIX (cadastro)": fornecedor.pix_chave ?? "",
    Observações: fornecedor.observacoes ?? "",
    Status: fornecedor.ativo ? "Ativo" : "Inativo",
    "Fornecedor global": fornecedor.is_global ? "Sim" : "Não",
    "Data de cadastro": dataExcel(fornecedor.created_at),
    "Última atualização": dataExcel(fornecedor.updated_at),
  }));

  const abaContas = contas.map((conta) => {
    const fornecedor = fornecedorPorId.get(conta.fornecedor_id);
    return {
      Fornecedor: fornecedor?.razao_social ?? "",
      "CNPJ / CPF": fornecedor?.cnpj_cpf ?? "",
      "Código do banco": conta.banco_codigo ?? "",
      Banco: conta.banco_nome ?? "",
      Agência: juntarNumero(conta.agencia, conta.agencia_digito),
      Conta: juntarNumero(conta.conta, conta.conta_digito),
      "Tipo de conta": conta.tipo ?? "",
      Titular: conta.titular_nome ?? "",
      "Documento do titular": conta.titular_documento ?? "",
      "Tipo da chave PIX": conta.pix_tipo ?? "",
      "Chave PIX": conta.pix_chave ?? "",
      Principal: conta.principal ? "Sim" : "Não",
      Status: conta.ativa ? "Ativa" : "Inativa",
      Observações: conta.observacoes ?? "",
    };
  });

  const abaMateriais = materiais.map((material) => {
    const fornecedor = fornecedorPorId.get(material.fornecedor_id);
    return {
      Fornecedor: fornecedor?.razao_social ?? "",
      "CNPJ / CPF": fornecedor?.cnpj_cpf ?? "",
      Material: material.sup_item?.nome ?? "",
      Tipo: material.sup_item
        ? (ROTULOS_TIPO_MATERIAL[material.sup_item.tipo] ?? material.sup_item.tipo)
        : "",
      "Código do fornecedor": material.codigo_fornecedor ?? "",
    };
  });

  return { abaFornecedores, abaContas, abaMateriais };
}
