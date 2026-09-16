import { describe, expect, it } from "vitest";
import type { PlanoAcaoRow } from "@/hooks/usePlanoAcoes";
import {
  CABECALHOS_EXCEL_PLANO_ACOES,
  LARGURAS_EXCEL_PLANO_ACOES,
  montarLinhasExcelPlanoAcoes,
  nomeArquivoPlanoAcoes,
  pendenciasDe,
} from "@/pages/plano-acoes/listaExcelUtils";

function acao(parcial: Partial<PlanoAcaoRow> = {}): PlanoAcaoRow {
  return {
    id: "8f2c1a9e-0000-0000-0000-000000000000",
    empresa_id: "empresa-1",
    id_importacao: null,
    ordem: 1,
    tipo_acao: "acao",
    titulo: "Envio de documentos",
    comite: "Administrativo",
    area: "LICITACAO",
    setor: null,
    prioridade_normalizada: "emergencial",
    prioridade_original: "EMERGENCIAL",
    problema: "Documentos atrasados",
    acao: "Enviar conforme modelo",
    responsavel_profile_id: null,
    responsavel_nome_origem: "Jose Carlos",
    criado_por: null,
    lider_comite_nome_origem: null,
    lider_setor_nome_origem: null,
    data_inicio_planejado_original: "2026-09-01",
    data_fim_planejado_original: null,
    data_inicio_real_original: null,
    data_fim_real_original: null,
    status_original: "CONCLUIDA",
    status_normalizado: "concluida_pendente_evidencia",
    comentarios: null,
    pendencias_iniciais: [],
    pendencia_responsavel: false,
    pendencia_datas: false,
    pendencia_evidencia: true,
    custo_previsto: 0,
    custo_realizado: 0,
    created_at: "2026-09-01T09:05:00",
    updated_at: "2026-09-11T14:30:00",
    deleted_at: null,
    ...parcial,
  } as PlanoAcaoRow;
}

describe("exportação da Lista de Plano de Ações", () => {
  it("mantém os cabeçalhos, a ordem e o formato das datas/números", () => {
    const linhas = montarLinhasExcelPlanoAcoes([acao()], { "empresa-1": "SN" });

    expect(Object.keys(linhas[0])).toEqual(CABECALHOS_EXCEL_PLANO_ACOES);
    expect(linhas[0]).toEqual(expect.objectContaining({
      ID: "8f2c1a9e",
      Empresa: "SN",
      Tipo: "Ação",
      Prioridade: "Emergencial",
      Status: "Concluída — pend. evidência",
      "Status (origem)": "CONCLUIDA",
      "Início planejado": "01/09/2026",
      "Fim planejado": "",
      "Custo previsto (R$)": 0,
      "Criada em": "01/09/2026 09:05",
      "Última atualização": "11/09/2026 14:30",
    }));
  });

  it("tem uma largura de coluna por cabeçalho", () => {
    expect(LARGURAS_EXCEL_PLANO_ACOES).toHaveLength(CABECALHOS_EXCEL_PLANO_ACOES.length);
  });

  it("usa o id_importação quando existe e cai no id curto quando não existe", () => {
    expect(montarLinhasExcelPlanoAcoes([acao({ id_importacao: "PA-014" })], {})[0].ID).toBe("PA-014");
    expect(montarLinhasExcelPlanoAcoes([acao()], {})[0].ID).toBe("8f2c1a9e");
  });

  it("devolve a data crua quando a origem não é ISO (texto livre da importação)", () => {
    const linha = montarLinhasExcelPlanoAcoes([acao({ data_fim_planejado_original: "a definir" })], {})[0];
    expect(linha["Fim planejado"]).toBe("a definir");
  });

  it("lista as pendências por extenso, na mesma ordem dos badges da tela", () => {
    expect(pendenciasDe(acao({ pendencia_responsavel: true, pendencia_datas: true }))).toBe(
      "Sem responsável, Sem datas planejadas, Concluída sem evidência",
    );
    expect(pendenciasDe(acao({ pendencia_evidencia: false }))).toBe("");
  });

  it("nomeia o arquivo por escopo e data", () => {
    expect(nomeArquivoPlanoAcoes("filtrado", new Date(2026, 8, 16))).toBe("plano-de-acoes-filtrado-2026-09-16.xlsx");
    expect(nomeArquivoPlanoAcoes("completo", new Date(2026, 8, 16))).toBe("plano-de-acoes-completo-2026-09-16.xlsx");
  });
});
