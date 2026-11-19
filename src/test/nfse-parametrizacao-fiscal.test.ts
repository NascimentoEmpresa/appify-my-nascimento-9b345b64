import { describe, expect, it } from "vitest";
import type { DadosContratoNfse, ParametroServicoNfse } from "@/hooks/useNfseParametrizacao";
import {
  aplicarDadosContrato, aplicarParametroServico, CST_PIS_COFINS, erroDadosContrato, erroParametroServico,
  formularioDosDados, limparParametroServico, normalizarItemLc116, preencherDoCadastro,
} from "@/pages/financeiro/controle-notas/parametrosFiscaisNfse";
import { validarParametrosNfse } from "@/pages/financeiro/controle-notas/validarParametrosNfse";
import { parametrosNfse } from "./fixtures/parametrosNfse";

// SIS-2026-0941
const linha = (item: string, codigo: string, ativo = true): ParametroServicoNfse => ({
  id: item, municipio_emissor: "4322004", item_lc116: item, descricao: "", codigo_tributacao: codigo, codigo_nbs: "118012100",
  codigo_integracao_municipal: "8111700", ibs_cst: "000", ibs_classificacao: "000001", ibs_indicador_operacao: "100301", ativo,
  atualizado_em: "2026-11-19T10:00:00Z", atualizado_por: null });
const dados = (extra: Partial<DadosContratoNfse> = {}): DadosContratoNfse => ({ contrato_id: "c", tomador_documento: "92969856000198",
  tomador_nome: "PREFEITURA", tomador_inscricao_municipal: "0012", tomador_municipio: "4322004", tomador_cep: "95840000",
  tomador_logradouro: "Rua", tomador_numero: "1", tomador_complemento: "", tomador_bairro: "Centro", tomador_email: "",
  local_prestacao: "4322004", consumidor_final: "0", tipo_ente_governamental: "4", iss_retido: "2", retencao_pis_cofins: "1",
  item_lc116: "07.10", origem_solicitacao_id: null, atualizado_em: "2026-11-18T10:00:00Z", atualizado_por: null, ...extra });

describe("Parametrização fiscal da NFS-e", () => {
  it("normaliza o item da LC 116 nos formatos usados no ERP e no portal", () => {
    for (const [entrada, esperado] of [["17.05", "17.05"], ["7.10", "07.10"], ["0710", "07.10"], ["071002", "07.10"], ["07.11.02", "07.11"],
      [" 17.05 ", "17.05"], ["710", ""], ["", ""], [null, ""], ["Limpeza", ""]] as const) {
      expect(normalizarItemLc116(entrada)).toBe(esperado);
    }
  });
  it("aplica os seis códigos do item, mantém o CST de PIS/COFINS e pede nova revisão", () => {
    const p = { ...parametrosNfse(), cst_pis_cofins: "01", confirmacao_fiscal: true, confirmacao_producao: true };
    const r = aplicarParametroServico(p, linha("17.05", "170501"));
    expect(r).toMatchObject({ item_lc116: "17.05", codigo_tributacao: "170501", codigo_nbs: "118012100", codigo_integracao_municipal: "8111700",
      ibs_cst: "000", ibs_classificacao: "000001", ibs_indicador_operacao: "100301", cst_pis_cofins: "01", confirmacao_fiscal: false, confirmacao_producao: false });
    expect(p.codigo_tributacao).toBe("17.05.01");
  });
  it("só aplica retenções do contrato que combinam com os valores salvos da preparação", () => {
    const p = { ...parametrosNfse(), iss_retido: "", retencao_pis_cofins: "1" };
    expect(aplicarDadosContrato(p, dados({ iss_retido: "2" }), { issqn_total: 2, csll_total: 0 }).iss_retido).toBe("2");
    expect(aplicarDadosContrato(p, dados({ iss_retido: "2" }), { issqn_total: 0, csll_total: 0 }).iss_retido).toBe("");
    expect(aplicarDadosContrato(p, dados({ iss_retido: "1" }), { issqn_total: 2, csll_total: 0 }).iss_retido).toBe("");
    expect(aplicarDadosContrato(p, dados({ retencao_pis_cofins: "4" }), { issqn_total: 0, csll_total: 0 }).retencao_pis_cofins).toBe("4");
    // Há CSLL retida: só "PIS/COFINS/CSLL retidos" passa no worker.
    expect(aplicarDadosContrato({ ...p, retencao_pis_cofins: "3" }, dados({ retencao_pis_cofins: "1" }), { issqn_total: 0, csll_total: 1 }).retencao_pis_cofins).toBe("3");
    const r = aplicarDadosContrato(p, dados(), { issqn_total: 2, csll_total: 0 });
    expect(r.tomador).toMatchObject({ documento: "92.969.856/0001-98", cep: "95840-000", inscricao_municipal: "0012" });
    expect(validarParametrosNfse(r).tomador.cep).toBe("95840000");
  });
  it("na preparação nova o item da própria nota vence o último do contrato, e item inativo não preenche", () => {
    const servicos = [linha("17.05", "170501"), linha("07.10", "071002")];
    const base = { ...parametrosNfse(), codigo_tributacao: "", item_lc116: "" };
    const nota = { issqn_total: 2, csll_total: 0 };
    expect(preencherDoCadastro(base, { dados: dados(), servicos, codigoServicoNota: "17.05", nota }).codigo_tributacao).toBe("170501");
    expect(preencherDoCadastro(base, { dados: dados(), servicos, codigoServicoNota: null, nota }).codigo_tributacao).toBe("071002");
    expect(preencherDoCadastro(base, { dados: null, servicos: [linha("17.05", "170501", false)], codigoServicoNota: "17.05", nota }).codigo_tributacao).toBe("");
    expect(preencherDoCadastro(base, { dados: null, servicos: [], codigoServicoNota: "17.05", nota })).toEqual(base);
  });
  it("a lista de CST tem os códigos de dois dígitos aceitos pela emissão", () => {
    expect(CST_PIS_COFINS.map(([c]) => c)).toEqual(["00", "01", "02", "03", "04", "05", "06", "07", "08", "09"]);
    for (const [cst] of CST_PIS_COFINS) expect(validarParametrosNfse({ ...parametrosNfse(), cst_pis_cofins: cst }, "homologacao", false, true).cst_pis_cofins).toBe(cst);
  });
  it("valida o cadastro por código de serviço com as mesmas regras do banco", () => {
    const ok = limparParametroServico({ municipio_emissor: "4322004", item_lc116: "7.10", descricao: " Limpeza ", codigo_tributacao: "07.10.02",
      codigo_nbs: "1.1803.10.00", codigo_integracao_municipal: "8121400", ibs_cst: "000", ibs_classificacao: "000001", ibs_indicador_operacao: "020201", ativo: true });
    expect(ok).toMatchObject({ item_lc116: "07.10", codigo_tributacao: "071002", codigo_nbs: "118031000", descricao: "Limpeza" });
    expect(erroParametroServico(ok)).toBeNull();
    expect(erroParametroServico({ ...ok, codigo_tributacao: "170501" })).toMatch(/deve começar por 0710/);
    expect(erroParametroServico({ ...ok, codigo_nbs: "11803100" })).toMatch(/NBS/);
    expect(erroParametroServico({ ...ok, codigo_integracao_municipal: "81-21" })).toMatch(/prefeitura/);
  });
  it("monta o formulário do contrato e recusa tomador incompleto", () => {
    const novo = formularioDosDados(null, { nome: "CLIENTE DO CONTRATO", documento: "15126437003088" });
    expect(novo.tomador).toMatchObject({ nome: "CLIENTE DO CONTRATO", documento: "15.126.437/0030-88" });
    expect(erroDadosContrato(novo)).toMatch(/Município do tomador/);
    const existente = formularioDosDados(dados());
    expect(existente).toMatchObject({ iss_retido: "2", retencao_pis_cofins: "1", item_lc116: "07.10", tipo_ente_governamental: "4" });
    expect(erroDadosContrato(existente)).toBeNull();
    expect(erroDadosContrato({ ...existente, tomador: { ...existente.tomador, documento: "123" } })).toMatch(/CPF\/CNPJ/);
  });
});
