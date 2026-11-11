import type { ParametrosNfse } from "@/hooks/useNfseIntegracao";

function codigo(valor: string, nome: string, tamanho: number) {
  const codigo = String(valor ?? "").replace(/[.\-/\s]/g, "");
  if (!/^\d+$/.test(codigo) || codigo.length !== tamanho) throw new Error(`${nome}: informe ${tamanho} números.`);
  return codigo;
}

export function validarParametrosNfse(parametros: ParametrosNfse): ParametrosNfse {
  return { ...parametros,
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
