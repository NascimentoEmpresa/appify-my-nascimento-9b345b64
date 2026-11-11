import type { ParametrosNfse } from "@/hooks/useNfseIntegracao";

export function parametrosNfse(): ParametrosNfse {
  return {
    serie: "1041", municipio_emissor: "3542404", inscricao_municipal: "100", opcao_simples: "1", regime_especial: "0", regime_apuracao: "",
    local_prestacao: "4322004", codigo_tributacao: "17.05.01", codigo_municipal: "", codigo_nbs: "1.1801.21.00", descricao: "Serviço de teste",
    iss_retido: "2", aliquota_iss: "2.00", cst_pis_cofins: "01", retencao_pis_cofins: "1",
    ibs_cst: "000", ibs_classificacao: "000001", ibs_indicador_operacao: "100301", consumidor_final: "0", tipo_operacao: "", tipo_ente_governamental: "",
    tributos_aproximados_federais: "0", tributos_aproximados_estaduais: "0", tributos_aproximados_municipais: "2",
    confirmacao_fiscal: true, confirmacao_producao: false,
    tomador: { documento: "98765432000198", nome: "TOMADOR DE TESTES", municipio: "4322004", cep: "95840-000", logradouro: "Rua de teste", numero: "1", bairro: "Centro", complemento: "", email: "" },
  };
}
