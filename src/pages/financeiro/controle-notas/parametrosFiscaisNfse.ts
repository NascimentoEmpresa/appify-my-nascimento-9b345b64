import type { ParametrosNfse } from "@/hooks/useNfseIntegracao";
import type { DadosContratoNfse, ParametroServicoEntrada, ParametroServicoNfse } from "@/hooks/useNfseParametrizacao";
import { formatarDocumento } from "@/lib/juridico/tipoProcesso";

// SIS-2026-0941: situação tributária do PIS/COFINS como no portal de Triunfo
// e no layout nacional da NFS-e. Nunca é preenchida sozinha (regra do 0841):
// o enquadramento é escolhido em cada nota.
export const CST_PIS_COFINS: [string, string][] = [
  ["00", "00 — Nenhum"],
  ["01", "01 — Operação tributável com alíquota básica"],
  ["02", "02 — Operação tributável com alíquota diferenciada"],
  ["03", "03 — Operação tributável com alíquota por unidade de medida de produto"],
  ["04", "04 — Operação tributável monofásica — revenda a alíquota zero"],
  ["05", "05 — Operação tributável por substituição tributária"],
  ["06", "06 — Operação tributável a alíquota zero"],
  ["07", "07 — Operação isenta da contribuição"],
  ["08", "08 — Operação sem incidência da contribuição"],
  ["09", "09 — Operação com suspensão da contribuição"],
];

/** "7.10", "0710", "07.10.02" ou "071002" → "07.10"; o resto → "". */
export function normalizarItemLc116(valor: string | null | undefined): string {
  const texto = String(valor ?? "").trim();
  const partes = texto.match(/^(\d{1,2})\.(\d{2})(?:\.\d{2})?$/);
  if (partes) return `${partes[1].padStart(2, "0")}.${partes[2]}`;
  const numeros = texto.replace(/\D/g, "");
  return numeros.length === 4 || numeros.length === 6 ? `${numeros.slice(0, 2)}.${numeros.slice(2, 4)}` : "";
}

/** Escolher o item de serviço preenche os seis códigos e pede nova revisão fiscal. */
export function aplicarParametroServico(p: ParametrosNfse, linha: ParametroServicoNfse): ParametrosNfse {
  return { ...p, item_lc116: linha.item_lc116,
    codigo_tributacao: linha.codigo_tributacao, codigo_nbs: linha.codigo_nbs, codigo_integracao_municipal: linha.codigo_integracao_municipal,
    ibs_cst: linha.ibs_cst, ibs_classificacao: linha.ibs_classificacao, ibs_indicador_operacao: linha.ibs_indicador_operacao,
    confirmacao_fiscal: false, confirmacao_producao: false };
}

const formatarCep = (cep: string) => cep.replace(/^(\d{5})(\d{3})$/, "$1-$2");
const tomadorDosDados = (d: DadosContratoNfse): ParametrosNfse["tomador"] => ({
  documento: formatarDocumento(d.tomador_documento), nome: d.tomador_nome, inscricao_municipal: d.tomador_inscricao_municipal,
  municipio: d.tomador_municipio, cep: formatarCep(d.tomador_cep), logradouro: d.tomador_logradouro, numero: d.tomador_numero,
  complemento: d.tomador_complemento, bairro: d.tomador_bairro, email: d.tomador_email,
});

/**
 * Tomador e dados da prestação guardados no contrato. As retenções só entram
 * quando combinam com os valores salvos da preparação — senão a nota cairia no
 * erro do worker ("A preparação desconta ISS, mas o formulário informa ISS não
 * retido") e o usuário só descobriria depois de entrar na fila.
 */
export function aplicarDadosContrato(p: ParametrosNfse, d: DadosContratoNfse, nota: { issqn_total: number; csll_total: number }): ParametrosNfse {
  const temIss = Number(nota.issqn_total) > 0;
  const issCombina = (d.iss_retido === "1" && !temIss) || (d.iss_retido === "2" && temIss);
  const retencaoCombina = d.retencao_pis_cofins !== "" && (Number(nota.csll_total) === 0 || d.retencao_pis_cofins === "3");
  return { ...p,
    local_prestacao: d.local_prestacao || p.local_prestacao,
    consumidor_final: d.consumidor_final || p.consumidor_final,
    tipo_ente_governamental: d.tipo_ente_governamental || p.tipo_ente_governamental,
    iss_retido: issCombina ? d.iss_retido : p.iss_retido,
    retencao_pis_cofins: retencaoCombina ? d.retencao_pis_cofins : p.retencao_pis_cofins,
    tomador: tomadorDosDados(d), confirmacao_fiscal: false, confirmacao_producao: false };
}

/**
 * Preparação nova: dados do contrato e, depois, os códigos do item de serviço
 * — o da própria preparação (Emissão de NF) vence o último usado no contrato.
 * Pedido anterior reaproveitado ("Corrigir dados") NÃO passa por aqui.
 */
export function preencherDoCadastro(p: ParametrosNfse, origem: {
  dados: DadosContratoNfse | null | undefined; servicos: ParametroServicoNfse[]; codigoServicoNota: string | null | undefined;
  nota: { issqn_total: number; csll_total: number };
}): ParametrosNfse {
  const base = origem.dados ? aplicarDadosContrato(p, origem.dados, origem.nota) : p;
  const item = normalizarItemLc116(origem.codigoServicoNota) || normalizarItemLc116(origem.dados?.item_lc116);
  const linha = origem.servicos.find(s => s.ativo && s.item_lc116 === item);
  return linha ? aplicarParametroServico(base, linha) : base;
}

/** Mesmos formatos do banco, de validarParametrosNfse e do worker; null quando está tudo certo. */
export function erroParametroServico(l: ParametroServicoEntrada): string | null {
  const item = normalizarItemLc116(l.item_lc116);
  if (!/^\d{7}$/.test(l.municipio_emissor)) return "Município emissor: informe o código IBGE de 7 números.";
  if (!/^\d{2}\.\d{2}$/.test(l.item_lc116) || item !== l.item_lc116) return "Item de serviço: use o formato da LC 116, por exemplo 07.10.";
  if (!/^\d{6}$/.test(l.codigo_tributacao)) return "Código nacional do serviço: informe 6 números.";
  if (l.codigo_tributacao.slice(0, 4) !== item.replace(".", "")) return `Código nacional do serviço: deve começar por ${item.replace(".", "")}, do item ${item}.`;
  if (!/^\d{9}$/.test(l.codigo_nbs)) return "NBS: informe 9 números.";
  if (!/^[a-zA-Z0-9]{0,20}$/.test(l.codigo_integracao_municipal)) return "Código do serviço na prefeitura: até 20 letras ou números, sem separadores.";
  if (!/^\d{3}$/.test(l.ibs_cst)) return "CST de IBS/CBS: informe 3 números.";
  if (!/^\d{6}$/.test(l.ibs_classificacao)) return "Classificação tributária de IBS/CBS: informe 6 números.";
  if (!/^\d{6}$/.test(l.ibs_indicador_operacao)) return "Indicador da operação: informe 6 números.";
  if (l.descricao.length > 200) return "Descrição: até 200 caracteres.";
  return null;
}
/** Remove pontos, traços e espaços dos códigos, como o portal mostra (07.10.02 → 071002). */
export function limparParametroServico(l: ParametroServicoEntrada): ParametroServicoEntrada {
  const so = (v: string) => v.replace(/[.\-/\s]/g, "");
  return { ...l, municipio_emissor: so(l.municipio_emissor), item_lc116: normalizarItemLc116(l.item_lc116) || l.item_lc116.trim(),
    codigo_tributacao: so(l.codigo_tributacao), codigo_nbs: so(l.codigo_nbs), codigo_integracao_municipal: so(l.codigo_integracao_municipal),
    ibs_cst: so(l.ibs_cst), ibs_classificacao: so(l.ibs_classificacao), ibs_indicador_operacao: so(l.ibs_indicador_operacao), descricao: l.descricao.trim() };
}

export type FormularioDadosContrato = Pick<ParametrosNfse, "tomador" | "local_prestacao" | "consumidor_final" | "tipo_ente_governamental" | "iss_retido" | "retencao_pis_cofins"> & { item_lc116: string };

/** Contrato sem cadastro: nome e CNPJ do cliente do contrato sugerem o tomador. */
export function formularioDosDados(d: DadosContratoNfse | null, sugestao?: { nome?: string | null; documento?: string | null }): FormularioDadosContrato {
  if (d) return { tomador: tomadorDosDados(d), local_prestacao: d.local_prestacao, consumidor_final: d.consumidor_final,
    tipo_ente_governamental: d.tipo_ente_governamental, iss_retido: d.iss_retido, retencao_pis_cofins: d.retencao_pis_cofins, item_lc116: d.item_lc116 };
  return { tomador: { documento: formatarDocumento(sugestao?.documento ?? ""), nome: sugestao?.nome ?? "", inscricao_municipal: "", municipio: "", cep: "",
    logradouro: "", numero: "", complemento: "", bairro: "", email: "" }, local_prestacao: "", consumidor_final: "", tipo_ente_governamental: "",
    iss_retido: "", retencao_pis_cofins: "", item_lc116: "" };
}

export function erroDadosContrato(f: FormularioDadosContrato): string | null {
  const so = (v: string) => String(v ?? "").replace(/\D/g, "");
  const t = f.tomador;
  if (!/^(\d{11}|\d{14})$/.test(so(t.documento))) return "CPF/CNPJ do tomador: informe 11 ou 14 números.";
  if (!t.nome.trim()) return "Informe o nome / razão social do tomador.";
  if (!/^\d{7}$/.test(so(t.municipio))) return "Município do tomador: escolha a cidade ou informe o código IBGE de 7 números.";
  if (!/^\d{8}$/.test(so(t.cep))) return "CEP do tomador: informe 8 números.";
  if (!t.logradouro.trim() || !t.numero.trim() || !t.bairro.trim()) return "Informe logradouro, número e bairro do tomador.";
  if ((t.inscricao_municipal ?? "").trim().length > 15) return "Inscrição municipal do tomador: até 15 caracteres.";
  if (f.local_prestacao && !/^\d{7}$/.test(so(f.local_prestacao))) return "Local da prestação: escolha a cidade ou informe o código IBGE de 7 números.";
  return null;
}
