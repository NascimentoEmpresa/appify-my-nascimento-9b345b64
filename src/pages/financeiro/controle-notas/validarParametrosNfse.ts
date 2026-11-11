import type { AmbienteNfse, ParametrosNfse } from "@/hooks/useNfseIntegracao";

function codigo(valor: string, nome: string, tamanho: number) {
  const codigo = String(valor ?? "").replace(/[.\-/\s]/g, "");
  if (!/^\d+$/.test(codigo) || codigo.length !== tamanho) throw new Error(`${nome}: informe ${tamanho} números.`);
  return codigo;
}

export function validarParametrosNfse(parametros: ParametrosNfse, ambiente: AmbienteNfse = "homologacao"): ParametrosNfse {
  const integracaoMunicipal = String(parametros.codigo_integracao_municipal ?? "").trim();
  if (integracaoMunicipal && !/^[a-zA-Z0-9]{1,20}$/.test(integracaoMunicipal)) throw new Error("Código do serviço na prefeitura: informe até 20 letras ou números, sem separadores.");
  if (ambiente === "producao" && parametros.municipio_emissor === "4322004" && parametros.codigo_tributacao.replace(/[.\-/\s]/g, "") === "170501" && !integracaoMunicipal) {
    throw new Error("Informe o Código do serviço na prefeitura para o serviço 170501 de Triunfo. Confirme o código usado no portal com o responsável fiscal.");
  }
  return { ...parametros,
    codigo_integracao_municipal: integracaoMunicipal,
    municipio_emissor: codigo(parametros.municipio_emissor, "Município emissor — código IBGE", 7),
    local_prestacao: codigo(parametros.local_prestacao, "Local da prestação — código IBGE", 7),
    codigo_tributacao: codigo(parametros.codigo_tributacao, "Código nacional do serviço", 6),
    codigo_nbs: codigo(parametros.codigo_nbs, "NBS", 9),
    ibs_cst: codigo(parametros.ibs_cst, "CST de IBS/CBS", 3),
    ibs_classificacao: codigo(parametros.ibs_classificacao, "Classificação tributária de IBS/CBS", 6),
    ibs_indicador_operacao: codigo(parametros.ibs_indicador_operacao, "Indicador da operação", 6),
    tomador: { ...parametros.tomador,
      municipio: codigo(parametros.tomador.municipio, "Município do tomador — código IBGE", 7),
      cep: codigo(parametros.tomador.cep, "CEP do tomador", 8),
    },
  };
}
