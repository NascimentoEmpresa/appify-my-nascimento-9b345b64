/**
 * Lista fixa das rubricas de custo da Planilha de Custo (public.planilha_custo
 * — ver supabase/migrations/20260623000001_planilha_custo.sql). Não é um
 * catálogo no banco: essas colunas são fixas no schema, então a lista de
 * "Classificação Licitação" pra ligar com uma Classificação do Malote
 * (SIS-2026-0084) vive aqui, no frontend.
 *
 * outros_1/2/3 (rubricas livres, com descrição digitada por linha) e
 * total_por_empregado (campo calculado) ficam de fora de propósito — não
 * são uma "classificação" fixa pra ligar.
 */
export interface ClassificacaoLicitacao {
  campo: string; // coluna correspondente em public.planilha_custo
  label: string;
  grupo: string;
}

export const CLASSIFICACOES_LICITACAO: ClassificacaoLicitacao[] = [
  // Remuneração
  { campo: "salario", label: "Salário Base", grupo: "Remuneração" },
  { campo: "insalubridade", label: "Adicional Insalubridade", grupo: "Remuneração" },
  { campo: "periculosidade", label: "Adicional Periculosidade", grupo: "Remuneração" },
  { campo: "lideranca", label: "Adicional de Líder / Supervisor", grupo: "Remuneração" },
  { campo: "adicional_noturno_reduzido", label: "ADD Noturno Hr Red", grupo: "Remuneração" },
  { campo: "adicional_noturno", label: "ADD Noturno", grupo: "Remuneração" },
  { campo: "adicional_extra", label: "ADD Hr Extra", grupo: "Remuneração" },
  { campo: "dsr", label: "DSR", grupo: "Remuneração" },

  // Encargos
  { campo: "decimo_terceiro", label: "13º", grupo: "Encargos" },
  { campo: "adicional_ferias", label: "Adicional Férias", grupo: "Encargos" },
  { campo: "incidencia_enc_41", label: "Encargos Previdenciários sobre Salário e Férias", grupo: "Encargos" },
  { campo: "inss", label: "INSS", grupo: "Encargos" },
  { campo: "salario_educacao", label: "Salário Educação", grupo: "Encargos" },
  { campo: "rat_fap", label: "RAT X FAP", grupo: "Encargos" },
  { campo: "sesi", label: "SESC ou SESI", grupo: "Encargos" },
  { campo: "senai", label: "SENAI/SENAC", grupo: "Encargos" },
  { campo: "sebrae", label: "SEBRAE", grupo: "Encargos" },
  { campo: "incra", label: "INCRA", grupo: "Encargos" },
  { campo: "fgts", label: "FGTS", grupo: "Encargos" },
  { campo: "seguro_acidente_trabalho", label: "Seguro Acidente de Trabalho", grupo: "Encargos" },

  // Benefícios
  { campo: "transporte", label: "Vale Transporte", grupo: "Benefícios" },
  { campo: "aux_alimentacao", label: "Auxílio Alimentação", grupo: "Benefícios" },
  { campo: "aux_alimentacao_desconto", label: "Desconto Auxílio Alimentação", grupo: "Benefícios" },
  { campo: "aux_refeicao", label: "Auxílio Refeição", grupo: "Benefícios" },
  { campo: "beneficio_familiar", label: "Benefício Familiar", grupo: "Benefícios" },
  { campo: "aux_lanche", label: "Auxílio Lanche", grupo: "Benefícios" },
  { campo: "seguro_vida", label: "Seguro de Vida", grupo: "Benefícios" },
  { campo: "abono_indenizatorio", label: "Abono Indenizatório", grupo: "Benefícios" },
  { campo: "aux_educacao", label: "Auxílio Educação", grupo: "Benefícios" },
  { campo: "cesta_basica", label: "Cesta Básica", grupo: "Benefícios" },
  { campo: "assistencia_medica", label: "Assistência Médica", grupo: "Benefícios" },
  { campo: "hospedagem", label: "Hospedagem", grupo: "Benefícios" },
  { campo: "odontologico", label: "Odontológico", grupo: "Benefícios" },
  { campo: "manutencao_profissional", label: "Manutenção Profissional", grupo: "Benefícios" },
  { campo: "cafe", label: "Café", grupo: "Benefícios" },
  { campo: "almoco", label: "Almoço", grupo: "Benefícios" },
  { campo: "janta", label: "Janta", grupo: "Benefícios" },
  { campo: "ceia", label: "Ceia", grupo: "Benefícios" },
  { campo: "funeral", label: "Auxílio Funeral", grupo: "Benefícios" },
  { campo: "assiduidade", label: "Prêmio Assiduidade", grupo: "Benefícios" },
  { campo: "beneficio_trabalhador", label: "Benefício Trabalhador", grupo: "Benefícios" },
  { campo: "patronal", label: "Contribuição Patronal", grupo: "Benefícios" },
  { campo: "fundo_assistencial", label: "Fundo Assistencial", grupo: "Benefícios" },
  { campo: "fundo_profissional", label: "Fundo Profissional", grupo: "Benefícios" },
  { campo: "natalidade", label: "Auxílio Natalidade", grupo: "Benefícios" },
  { campo: "deducoes", label: "Deduções", grupo: "Benefícios" },

  // Rescisão / Provisão
  { campo: "aviso_indenizado", label: "Aviso Prévio Indenizado", grupo: "Rescisão / Provisão" },
  { campo: "incidencia_fgts", label: "Incidência FGTS sobre Rescisão", grupo: "Rescisão / Provisão" },
  { campo: "multa_rescisoria", label: "Multa Rescisória (FGTS)", grupo: "Rescisão / Provisão" },
  { campo: "aviso_trabalhado", label: "Aviso Prévio Trabalhado", grupo: "Rescisão / Provisão" },
  { campo: "incidencia_aviso_trabalhado", label: "Incidência sobre Aviso Trabalhado", grupo: "Rescisão / Provisão" },
  { campo: "multa_aviso_indenizado", label: "Multa sobre Aviso Indenizado", grupo: "Rescisão / Provisão" },
  { campo: "contratualidade", label: "Contratualidade", grupo: "Rescisão / Provisão" },

  // Reposição de Profissional Ausente
  { campo: "sub_ferias", label: "Substituto de Férias", grupo: "Reposição de Ausente" },
  { campo: "sub_ausencias_legais", label: "Substituto de Ausências Legais", grupo: "Reposição de Ausente" },
  { campo: "sub_paternidade", label: "Substituto de Paternidade", grupo: "Reposição de Ausente" },
  { campo: "sub_acidente_trabalho", label: "Substituto de Acidente de Trabalho", grupo: "Reposição de Ausente" },
  { campo: "sub_maternidade", label: "Substituto de Maternidade", grupo: "Reposição de Ausente" },
  { campo: "sub_doenca", label: "Substituto de Doença", grupo: "Reposição de Ausente" },
  { campo: "sub_repouso", label: "Substituto de Repouso", grupo: "Reposição de Ausente" },
  { campo: "incidencia_maternidade", label: "Incidência sobre Maternidade", grupo: "Reposição de Ausente" },
  { campo: "incidencia_enc_reposicao", label: "Incidência de Encargos (Reposição I)", grupo: "Reposição de Ausente" },
  { campo: "incidencia_enc_reposicao_2", label: "Incidência de Encargos (Reposição II)", grupo: "Reposição de Ausente" },
  { campo: "incidencia_enc_reposicao_3", label: "Incidência de Encargos (Reposição III)", grupo: "Reposição de Ausente" },
  { campo: "incidencia_enc_reposicao_4", label: "Incidência de Encargos (Reposição IV)", grupo: "Reposição de Ausente" },

  // Insumos Diversos
  { campo: "uniforme", label: "Uniforme", grupo: "Insumos Diversos" },
  { campo: "epi", label: "EPI", grupo: "Insumos Diversos" },
  { campo: "epc", label: "EPC", grupo: "Insumos Diversos" },
  { campo: "materiais", label: "Materiais", grupo: "Insumos Diversos" },
  { campo: "equipamentos", label: "Equipamentos", grupo: "Insumos Diversos" },
  { campo: "relogio_digital", label: "Relógio Digital", grupo: "Insumos Diversos" },
  { campo: "ponto_eletronico", label: "Ponto Eletrônico", grupo: "Insumos Diversos" },
  { campo: "outros_insumos", label: "Outros Insumos", grupo: "Insumos Diversos" },

  // Custos Indiretos / Lucro / Tributos
  { campo: "custos_indiretos", label: "Custos Indiretos", grupo: "Custos Indiretos / Lucro / Tributos" },
  { campo: "lucro", label: "Lucro", grupo: "Custos Indiretos / Lucro / Tributos" },
  { campo: "cofins", label: "COFINS", grupo: "Custos Indiretos / Lucro / Tributos" },
  { campo: "pis", label: "PIS", grupo: "Custos Indiretos / Lucro / Tributos" },
  { campo: "irpj_csll", label: "IRPJ / CSLL", grupo: "Custos Indiretos / Lucro / Tributos" },
  { campo: "iss", label: "ISS", grupo: "Custos Indiretos / Lucro / Tributos" },
];

export function labelClassificacaoLicitacao(campo: string): string {
  return CLASSIFICACOES_LICITACAO.find((c) => c.campo === campo)?.label ?? campo;
}
