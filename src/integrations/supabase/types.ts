export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      access_audit_log: {
        Row: {
          acao: string
          allowed: boolean
          created_at: string
          empresa_id: string | null
          id: string
          menu_codigo: string | null
          motivo: string | null
          rota: string | null
          user_id: string
        }
        Insert: {
          acao?: string
          allowed: boolean
          created_at?: string
          empresa_id?: string | null
          id?: string
          menu_codigo?: string | null
          motivo?: string | null
          rota?: string | null
          user_id: string
        }
        Update: {
          acao?: string
          allowed?: boolean
          created_at?: string
          empresa_id?: string | null
          id?: string
          menu_codigo?: string | null
          motivo?: string | null
          rota?: string | null
          user_id?: string
        }
        Relationships: []
      }
      alcada_aprovacao: {
        Row: {
          ativo: boolean
          created_at: string
          empresa_id: string
          etapa: string
          excecao: string | null
          id: string
          ordem: number
          responsavel_nome: string | null
          responsavel_user_id: string
          updated_at: string
          valor_max: number | null
          valor_min: number
        }
        Insert: {
          ativo?: boolean
          created_at?: string
          empresa_id: string
          etapa: string
          excecao?: string | null
          id?: string
          ordem?: number
          responsavel_nome?: string | null
          responsavel_user_id: string
          updated_at?: string
          valor_max?: number | null
          valor_min?: number
        }
        Update: {
          ativo?: boolean
          created_at?: string
          empresa_id?: string
          etapa?: string
          excecao?: string | null
          id?: string
          ordem?: number
          responsavel_nome?: string | null
          responsavel_user_id?: string
          updated_at?: string
          valor_max?: number | null
          valor_min?: number
        }
        Relationships: [
          {
            foreignKeyName: "alcada_aprovacao_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "alcada_aprovacao_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "v_ia_contexto_empresa"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "alcada_aprovacao_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "vw_bi_resumo_empresa"
            referencedColumns: ["empresa_id"]
          },
        ]
      }
      almoxarifado: {
        Row: {
          ativo: boolean
          codigo: string
          contrato_id: string | null
          created_at: string
          empresa_id: string
          endereco: string | null
          id: string
          is_matriz: boolean
          nome: string
          observacoes: string | null
          responsavel: string | null
          tipo: Database["public"]["Enums"]["almox_tipo"]
          updated_at: string
        }
        Insert: {
          ativo?: boolean
          codigo: string
          contrato_id?: string | null
          created_at?: string
          empresa_id: string
          endereco?: string | null
          id?: string
          is_matriz?: boolean
          nome: string
          observacoes?: string | null
          responsavel?: string | null
          tipo?: Database["public"]["Enums"]["almox_tipo"]
          updated_at?: string
        }
        Update: {
          ativo?: boolean
          codigo?: string
          contrato_id?: string | null
          created_at?: string
          empresa_id?: string
          endereco?: string | null
          id?: string
          is_matriz?: boolean
          nome?: string
          observacoes?: string | null
          responsavel?: string | null
          tipo?: Database["public"]["Enums"]["almox_tipo"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "almoxarifado_contrato_id_fkey"
            columns: ["contrato_id"]
            isOneToOne: false
            referencedRelation: "contrato"
            referencedColumns: ["id"]
          },
        ]
      }
      alocacao_colaborador: {
        Row: {
          ativo: boolean
          colaborador_id: string
          contrato_id: string | null
          contrato_posto_id: string | null
          created_at: string
          data_fim: string | null
          data_inicio: string
          empresa_id: string
          id: string
          observacoes: string | null
          updated_at: string
        }
        Insert: {
          ativo?: boolean
          colaborador_id: string
          contrato_id?: string | null
          contrato_posto_id?: string | null
          created_at?: string
          data_fim?: string | null
          data_inicio?: string
          empresa_id: string
          id?: string
          observacoes?: string | null
          updated_at?: string
        }
        Update: {
          ativo?: boolean
          colaborador_id?: string
          contrato_id?: string | null
          contrato_posto_id?: string | null
          created_at?: string
          data_fim?: string | null
          data_inicio?: string
          empresa_id?: string
          id?: string
          observacoes?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "alocacao_colaborador_colaborador_id_fkey"
            columns: ["colaborador_id"]
            isOneToOne: false
            referencedRelation: "colaborador"
            referencedColumns: ["id"]
          },
        ]
      }
      anexos: {
        Row: {
          created_at: string
          empresa_id: string
          enviado_por: string | null
          id: string
          mime_type: string | null
          modulo: string
          nome: string
          observacoes: string | null
          registro_id: string | null
          storage_path: string
          tamanho_bytes: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          empresa_id: string
          enviado_por?: string | null
          id?: string
          mime_type?: string | null
          modulo: string
          nome: string
          observacoes?: string | null
          registro_id?: string | null
          storage_path: string
          tamanho_bytes: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          empresa_id?: string
          enviado_por?: string | null
          id?: string
          mime_type?: string | null
          modulo?: string
          nome?: string
          observacoes?: string | null
          registro_id?: string | null
          storage_path?: string
          tamanho_bytes?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "anexos_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "anexos_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "v_ia_contexto_empresa"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "anexos_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "vw_bi_resumo_empresa"
            referencedColumns: ["empresa_id"]
          },
        ]
      }
      app_menu: {
        Row: {
          ativo: boolean
          codigo: string
          created_at: string
          id: string
          modulo_id: string
          nome: string
          ordem: number
          rota: string | null
          updated_at: string
        }
        Insert: {
          ativo?: boolean
          codigo: string
          created_at?: string
          id?: string
          modulo_id: string
          nome: string
          ordem?: number
          rota?: string | null
          updated_at?: string
        }
        Update: {
          ativo?: boolean
          codigo?: string
          created_at?: string
          id?: string
          modulo_id?: string
          nome?: string
          ordem?: number
          rota?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "app_menu_modulo_id_fkey"
            columns: ["modulo_id"]
            isOneToOne: false
            referencedRelation: "app_modulo"
            referencedColumns: ["id"]
          },
        ]
      }
      app_modulo: {
        Row: {
          ativo: boolean
          codigo: string
          created_at: string
          descricao: string | null
          icone: string | null
          id: string
          nome: string
          ordem: number
          updated_at: string
        }
        Insert: {
          ativo?: boolean
          codigo: string
          created_at?: string
          descricao?: string | null
          icone?: string | null
          id?: string
          nome: string
          ordem?: number
          updated_at?: string
        }
        Update: {
          ativo?: boolean
          codigo?: string
          created_at?: string
          descricao?: string | null
          icone?: string | null
          id?: string
          nome?: string
          ordem?: number
          updated_at?: string
        }
        Relationships: []
      }
      aprov_etapa: {
        Row: {
          ativo: boolean
          created_at: string
          empresa_id: string
          id: string
          nome: string
          ordem: number
          role_required: Database["public"]["Enums"]["app_role"]
          updated_at: string
          valor_max: number | null
          valor_min: number | null
        }
        Insert: {
          ativo?: boolean
          created_at?: string
          empresa_id: string
          id?: string
          nome: string
          ordem: number
          role_required: Database["public"]["Enums"]["app_role"]
          updated_at?: string
          valor_max?: number | null
          valor_min?: number | null
        }
        Update: {
          ativo?: boolean
          created_at?: string
          empresa_id?: string
          id?: string
          nome?: string
          ordem?: number
          role_required?: Database["public"]["Enums"]["app_role"]
          updated_at?: string
          valor_max?: number | null
          valor_min?: number | null
        }
        Relationships: []
      }
      aprov_instancia: {
        Row: {
          comentario: string | null
          created_at: string
          decidido_em: string | null
          decidido_por: string | null
          decisao: Database["public"]["Enums"]["aprov_decisao"]
          empresa_id: string
          etapa_id: string
          id: string
          orcamento_contrato_id: string
          ordem: number
          updated_at: string
        }
        Insert: {
          comentario?: string | null
          created_at?: string
          decidido_em?: string | null
          decidido_por?: string | null
          decisao?: Database["public"]["Enums"]["aprov_decisao"]
          empresa_id: string
          etapa_id: string
          id?: string
          orcamento_contrato_id: string
          ordem: number
          updated_at?: string
        }
        Update: {
          comentario?: string | null
          created_at?: string
          decidido_em?: string | null
          decidido_por?: string | null
          decisao?: Database["public"]["Enums"]["aprov_decisao"]
          empresa_id?: string
          etapa_id?: string
          id?: string
          orcamento_contrato_id?: string
          ordem?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "aprov_instancia_etapa_id_fkey"
            columns: ["etapa_id"]
            isOneToOne: false
            referencedRelation: "aprov_etapa"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "aprov_instancia_orcamento_contrato_id_fkey"
            columns: ["orcamento_contrato_id"]
            isOneToOne: false
            referencedRelation: "orcamento_contrato"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "aprov_instancia_orcamento_contrato_id_fkey"
            columns: ["orcamento_contrato_id"]
            isOneToOne: false
            referencedRelation: "vw_dre_contrato"
            referencedColumns: ["orcamento_contrato_id"]
          },
        ]
      }
      apuracao_imposto: {
        Row: {
          aliquota: number
          base_calculo: number
          calculado_em: string | null
          calculado_por: string | null
          competencia: string
          created_at: string
          data_pagamento: string | null
          empresa_id: string
          id: string
          imposto: Database["public"]["Enums"]["imposto_tipo"]
          observacoes: string | null
          regime: Database["public"]["Enums"]["regime_tributario"]
          status: Database["public"]["Enums"]["apuracao_status"]
          updated_at: string
          valor_a_pagar: number
          valor_devido: number
          valor_pago: number | null
          valor_retido: number
          vencimento: string | null
        }
        Insert: {
          aliquota?: number
          base_calculo?: number
          calculado_em?: string | null
          calculado_por?: string | null
          competencia: string
          created_at?: string
          data_pagamento?: string | null
          empresa_id: string
          id?: string
          imposto: Database["public"]["Enums"]["imposto_tipo"]
          observacoes?: string | null
          regime: Database["public"]["Enums"]["regime_tributario"]
          status?: Database["public"]["Enums"]["apuracao_status"]
          updated_at?: string
          valor_a_pagar?: number
          valor_devido?: number
          valor_pago?: number | null
          valor_retido?: number
          vencimento?: string | null
        }
        Update: {
          aliquota?: number
          base_calculo?: number
          calculado_em?: string | null
          calculado_por?: string | null
          competencia?: string
          created_at?: string
          data_pagamento?: string | null
          empresa_id?: string
          id?: string
          imposto?: Database["public"]["Enums"]["imposto_tipo"]
          observacoes?: string | null
          regime?: Database["public"]["Enums"]["regime_tributario"]
          status?: Database["public"]["Enums"]["apuracao_status"]
          updated_at?: string
          valor_a_pagar?: number
          valor_devido?: number
          valor_pago?: number | null
          valor_retido?: number
          vencimento?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "apuracao_imposto_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "apuracao_imposto_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "v_ia_contexto_empresa"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "apuracao_imposto_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "vw_bi_resumo_empresa"
            referencedColumns: ["empresa_id"]
          },
        ]
      }
      apuracao_imposto_item: {
        Row: {
          apuracao_id: string
          base: number
          created_at: string
          descricao: string | null
          id: string
          nota_fiscal_id: string | null
          valor: number
        }
        Insert: {
          apuracao_id: string
          base?: number
          created_at?: string
          descricao?: string | null
          id?: string
          nota_fiscal_id?: string | null
          valor?: number
        }
        Update: {
          apuracao_id?: string
          base?: number
          created_at?: string
          descricao?: string | null
          id?: string
          nota_fiscal_id?: string | null
          valor?: number
        }
        Relationships: [
          {
            foreignKeyName: "apuracao_imposto_item_apuracao_id_fkey"
            columns: ["apuracao_id"]
            isOneToOne: false
            referencedRelation: "apuracao_imposto"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "apuracao_imposto_item_nota_fiscal_id_fkey"
            columns: ["nota_fiscal_id"]
            isOneToOne: false
            referencedRelation: "nota_fiscal"
            referencedColumns: ["id"]
          },
        ]
      }
      area: {
        Row: {
          ativo: boolean
          centro_custo_id: string | null
          comite_id: string
          created_at: string
          descricao: string | null
          empresa_id: string
          gestor_profile_id: string | null
          id: string
          nome: string
          updated_at: string
        }
        Insert: {
          ativo?: boolean
          centro_custo_id?: string | null
          comite_id: string
          created_at?: string
          descricao?: string | null
          empresa_id: string
          gestor_profile_id?: string | null
          id?: string
          nome: string
          updated_at?: string
        }
        Update: {
          ativo?: boolean
          centro_custo_id?: string | null
          comite_id?: string
          created_at?: string
          descricao?: string | null
          empresa_id?: string
          gestor_profile_id?: string | null
          id?: string
          nome?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "area_centro_custo_id_fkey"
            columns: ["centro_custo_id"]
            isOneToOne: false
            referencedRelation: "centros_custo"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "area_comite_id_fkey"
            columns: ["comite_id"]
            isOneToOne: false
            referencedRelation: "comite"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "area_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "area_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "v_ia_contexto_empresa"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "area_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "vw_bi_resumo_empresa"
            referencedColumns: ["empresa_id"]
          },
        ]
      }
      aud_alias_bancario_snapshot: {
        Row: {
          acao: string
          after_row: Json | null
          alias: string
          before_row: Json | null
          empresa_id: string
          executado_em: string
          executado_por: string | null
          id: string
          motivo: string | null
          superbloco: string
        }
        Insert: {
          acao: string
          after_row?: Json | null
          alias: string
          before_row?: Json | null
          empresa_id: string
          executado_em?: string
          executado_por?: string | null
          id?: string
          motivo?: string | null
          superbloco: string
        }
        Update: {
          acao?: string
          after_row?: Json | null
          alias?: string
          before_row?: Json | null
          empresa_id?: string
          executado_em?: string
          executado_por?: string | null
          id?: string
          motivo?: string | null
          superbloco?: string
        }
        Relationships: []
      }
      aud_empresas_cnpj_snapshot: {
        Row: {
          batch_id: string
          cnpj_anterior: string | null
          cnpj_novo: string | null
          codigo: string
          created_at: string
          empresa_id: string
          id: string
          observacao: string | null
          razao_social_anterior: string | null
          razao_social_nova: string | null
          rollback_aplicado: boolean
          rollback_em: string | null
        }
        Insert: {
          batch_id: string
          cnpj_anterior?: string | null
          cnpj_novo?: string | null
          codigo: string
          created_at?: string
          empresa_id: string
          id?: string
          observacao?: string | null
          razao_social_anterior?: string | null
          razao_social_nova?: string | null
          rollback_aplicado?: boolean
          rollback_em?: string | null
        }
        Update: {
          batch_id?: string
          cnpj_anterior?: string | null
          cnpj_novo?: string | null
          codigo?: string
          created_at?: string
          empresa_id?: string
          id?: string
          observacao?: string | null
          razao_social_anterior?: string | null
          razao_social_nova?: string | null
          rollback_aplicado?: boolean
          rollback_em?: string | null
        }
        Relationships: []
      }
      aud_p3h0_conta_bancaria_snapshot: {
        Row: {
          acao: string
          ativa_anterior: boolean | null
          ativa_nova: boolean | null
          banco_codigo: string | null
          banco_nome: string | null
          batch_id: string
          conta_bancaria_id: string
          conta_contabil_id_anterior: string | null
          conta_contabil_id_nova: string | null
          created_at: string
          empresa_id: string | null
          id: string
          motivo: string
          observacao: string | null
          rollback_aplicado: boolean
          rollback_em: string | null
        }
        Insert: {
          acao: string
          ativa_anterior?: boolean | null
          ativa_nova?: boolean | null
          banco_codigo?: string | null
          banco_nome?: string | null
          batch_id: string
          conta_bancaria_id: string
          conta_contabil_id_anterior?: string | null
          conta_contabil_id_nova?: string | null
          created_at?: string
          empresa_id?: string | null
          id?: string
          motivo: string
          observacao?: string | null
          rollback_aplicado?: boolean
          rollback_em?: string | null
        }
        Update: {
          acao?: string
          ativa_anterior?: boolean | null
          ativa_nova?: boolean | null
          banco_codigo?: string | null
          banco_nome?: string | null
          batch_id?: string
          conta_bancaria_id?: string
          conta_contabil_id_anterior?: string | null
          conta_contabil_id_nova?: string | null
          created_at?: string
          empresa_id?: string | null
          id?: string
          motivo?: string
          observacao?: string | null
          rollback_aplicado?: boolean
          rollback_em?: string | null
        }
        Relationships: []
      }
      aud_plano_contas_origem_diagnostico: {
        Row: {
          acao_futura_recomendada: string
          aliases_detectados: string[] | null
          ativo_atual: boolean | null
          banco_inferido: string | null
          batch_id: string
          categoria: string
          classificacao: string | null
          conta_bancaria_especifica: boolean
          conta_contabil_id: string
          conta_titular_especifica: boolean
          created_at: string
          descricao: string | null
          empresa_banco_inferida: string | null
          empresa_codigo_atual: string | null
          empresa_id_atual: string | null
          empresa_inferida_cnpj: string | null
          empresa_inferida_codigo: string | null
          empresa_inferida_id: string | null
          empresa_inferida_nome: string | null
          estrutura_compartilhada_possivel: boolean
          fonte_inferencia: string | null
          id: string
          motivo_classificacao: string | null
          pode_inativar_futuro: boolean
          pode_zerar_saldo_futuro: boolean
          qtd_alias_integracao: number
          qtd_conciliacao_regra: number
          qtd_conta_bancaria: number
          qtd_empresas_com_mesma_classificacao: number | null
          qtd_fcr_sugestoes_pendencias: number
          qtd_integration_map: number
          qtd_lancamento_partida: number
          qtd_orcamento_contrato_linha: number
          qtd_parametro_fiscal: number
          qtd_plano_contas_solicitacao: number
          qtd_pre_titulo_pagar: number
          qtd_pre_titulo_rateio: number
          qtd_realizado_lancamentos: number
          qtd_saldos_distintos: number | null
          qtd_stg_bancos_detectadas: number
          qtd_stg_fluxo_resolvida: number
          qtd_stg_mapa_para_bancos: number
          qtd_titulo_pagar: number
          qtd_titulo_receber: number
          risco_debito_credito: string
          risco_relatorio_contabil: string
          saldo_inicial: number | null
          saldo_replicado_suspeito: boolean
          score_confianca: number
          tem_vinculo_real: boolean
          tipo: string | null
          tokens_detectados: string[] | null
          trava_motivo: string | null
        }
        Insert: {
          acao_futura_recomendada?: string
          aliases_detectados?: string[] | null
          ativo_atual?: boolean | null
          banco_inferido?: string | null
          batch_id: string
          categoria: string
          classificacao?: string | null
          conta_bancaria_especifica?: boolean
          conta_contabil_id: string
          conta_titular_especifica?: boolean
          created_at?: string
          descricao?: string | null
          empresa_banco_inferida?: string | null
          empresa_codigo_atual?: string | null
          empresa_id_atual?: string | null
          empresa_inferida_cnpj?: string | null
          empresa_inferida_codigo?: string | null
          empresa_inferida_id?: string | null
          empresa_inferida_nome?: string | null
          estrutura_compartilhada_possivel?: boolean
          fonte_inferencia?: string | null
          id?: string
          motivo_classificacao?: string | null
          pode_inativar_futuro?: boolean
          pode_zerar_saldo_futuro?: boolean
          qtd_alias_integracao?: number
          qtd_conciliacao_regra?: number
          qtd_conta_bancaria?: number
          qtd_empresas_com_mesma_classificacao?: number | null
          qtd_fcr_sugestoes_pendencias?: number
          qtd_integration_map?: number
          qtd_lancamento_partida?: number
          qtd_orcamento_contrato_linha?: number
          qtd_parametro_fiscal?: number
          qtd_plano_contas_solicitacao?: number
          qtd_pre_titulo_pagar?: number
          qtd_pre_titulo_rateio?: number
          qtd_realizado_lancamentos?: number
          qtd_saldos_distintos?: number | null
          qtd_stg_bancos_detectadas?: number
          qtd_stg_fluxo_resolvida?: number
          qtd_stg_mapa_para_bancos?: number
          qtd_titulo_pagar?: number
          qtd_titulo_receber?: number
          risco_debito_credito?: string
          risco_relatorio_contabil?: string
          saldo_inicial?: number | null
          saldo_replicado_suspeito?: boolean
          score_confianca?: number
          tem_vinculo_real?: boolean
          tipo?: string | null
          tokens_detectados?: string[] | null
          trava_motivo?: string | null
        }
        Update: {
          acao_futura_recomendada?: string
          aliases_detectados?: string[] | null
          ativo_atual?: boolean | null
          banco_inferido?: string | null
          batch_id?: string
          categoria?: string
          classificacao?: string | null
          conta_bancaria_especifica?: boolean
          conta_contabil_id?: string
          conta_titular_especifica?: boolean
          created_at?: string
          descricao?: string | null
          empresa_banco_inferida?: string | null
          empresa_codigo_atual?: string | null
          empresa_id_atual?: string | null
          empresa_inferida_cnpj?: string | null
          empresa_inferida_codigo?: string | null
          empresa_inferida_id?: string | null
          empresa_inferida_nome?: string | null
          estrutura_compartilhada_possivel?: boolean
          fonte_inferencia?: string | null
          id?: string
          motivo_classificacao?: string | null
          pode_inativar_futuro?: boolean
          pode_zerar_saldo_futuro?: boolean
          qtd_alias_integracao?: number
          qtd_conciliacao_regra?: number
          qtd_conta_bancaria?: number
          qtd_empresas_com_mesma_classificacao?: number | null
          qtd_fcr_sugestoes_pendencias?: number
          qtd_integration_map?: number
          qtd_lancamento_partida?: number
          qtd_orcamento_contrato_linha?: number
          qtd_parametro_fiscal?: number
          qtd_plano_contas_solicitacao?: number
          qtd_pre_titulo_pagar?: number
          qtd_pre_titulo_rateio?: number
          qtd_realizado_lancamentos?: number
          qtd_saldos_distintos?: number | null
          qtd_stg_bancos_detectadas?: number
          qtd_stg_fluxo_resolvida?: number
          qtd_stg_mapa_para_bancos?: number
          qtd_titulo_pagar?: number
          qtd_titulo_receber?: number
          risco_debito_credito?: string
          risco_relatorio_contabil?: string
          saldo_inicial?: number | null
          saldo_replicado_suspeito?: boolean
          score_confianca?: number
          tem_vinculo_real?: boolean
          tipo?: string | null
          tokens_detectados?: string[] | null
          trava_motivo?: string | null
        }
        Relationships: []
      }
      audit_log: {
        Row: {
          diff: Json | null
          id: number
          op: string
          pk: string | null
          schema_name: string
          table_name: string
          ts: string
          user_id: string | null
        }
        Insert: {
          diff?: Json | null
          id?: number
          op: string
          pk?: string | null
          schema_name: string
          table_name: string
          ts?: string
          user_id?: string | null
        }
        Update: {
          diff?: Json | null
          id?: number
          op?: string
          pk?: string | null
          schema_name?: string
          table_name?: string
          ts?: string
          user_id?: string | null
        }
        Relationships: []
      }
      audit_log_2026_04: {
        Row: {
          diff: Json | null
          id: number
          op: string
          pk: string | null
          schema_name: string
          table_name: string
          ts: string
          user_id: string | null
        }
        Insert: {
          diff?: Json | null
          id?: number
          op: string
          pk?: string | null
          schema_name: string
          table_name: string
          ts?: string
          user_id?: string | null
        }
        Update: {
          diff?: Json | null
          id?: number
          op?: string
          pk?: string | null
          schema_name?: string
          table_name?: string
          ts?: string
          user_id?: string | null
        }
        Relationships: []
      }
      audit_log_2026_05: {
        Row: {
          diff: Json | null
          id: number
          op: string
          pk: string | null
          schema_name: string
          table_name: string
          ts: string
          user_id: string | null
        }
        Insert: {
          diff?: Json | null
          id?: number
          op: string
          pk?: string | null
          schema_name: string
          table_name: string
          ts?: string
          user_id?: string | null
        }
        Update: {
          diff?: Json | null
          id?: number
          op?: string
          pk?: string | null
          schema_name?: string
          table_name?: string
          ts?: string
          user_id?: string | null
        }
        Relationships: []
      }
      audit_log_2026_06: {
        Row: {
          diff: Json | null
          id: number
          op: string
          pk: string | null
          schema_name: string
          table_name: string
          ts: string
          user_id: string | null
        }
        Insert: {
          diff?: Json | null
          id?: number
          op: string
          pk?: string | null
          schema_name: string
          table_name: string
          ts?: string
          user_id?: string | null
        }
        Update: {
          diff?: Json | null
          id?: number
          op?: string
          pk?: string | null
          schema_name?: string
          table_name?: string
          ts?: string
          user_id?: string | null
        }
        Relationships: []
      }
      audit_log_default: {
        Row: {
          diff: Json | null
          id: number
          op: string
          pk: string | null
          schema_name: string
          table_name: string
          ts: string
          user_id: string | null
        }
        Insert: {
          diff?: Json | null
          id?: number
          op: string
          pk?: string | null
          schema_name: string
          table_name: string
          ts?: string
          user_id?: string | null
        }
        Update: {
          diff?: Json | null
          id?: number
          op?: string
          pk?: string | null
          schema_name?: string
          table_name?: string
          ts?: string
          user_id?: string | null
        }
        Relationships: []
      }
      banco_layout: {
        Row: {
          ativo: boolean
          conta_bancaria_id: string
          created_at: string
          empresa_id: string
          id: string
          nome: string
          template_origem_id: string | null
          tipo: Database["public"]["Enums"]["banco_layout_tipo"]
          updated_at: string
          versao_ativa_id: string | null
        }
        Insert: {
          ativo?: boolean
          conta_bancaria_id: string
          created_at?: string
          empresa_id: string
          id?: string
          nome: string
          template_origem_id?: string | null
          tipo: Database["public"]["Enums"]["banco_layout_tipo"]
          updated_at?: string
          versao_ativa_id?: string | null
        }
        Update: {
          ativo?: boolean
          conta_bancaria_id?: string
          created_at?: string
          empresa_id?: string
          id?: string
          nome?: string
          template_origem_id?: string | null
          tipo?: Database["public"]["Enums"]["banco_layout_tipo"]
          updated_at?: string
          versao_ativa_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "banco_layout_conta_bancaria_id_fkey"
            columns: ["conta_bancaria_id"]
            isOneToOne: false
            referencedRelation: "conta_bancaria"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "banco_layout_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "banco_layout_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "v_ia_contexto_empresa"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "banco_layout_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "vw_bi_resumo_empresa"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "banco_layout_template_origem_fk"
            columns: ["template_origem_id"]
            isOneToOne: false
            referencedRelation: "banco_layout_template"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "banco_layout_versao_ativa_fk"
            columns: ["versao_ativa_id"]
            isOneToOne: false
            referencedRelation: "banco_layout_versao"
            referencedColumns: ["id"]
          },
        ]
      }
      banco_layout_template: {
        Row: {
          ativo: boolean
          banco_codigo: string | null
          banco_nome: string | null
          created_at: string
          descricao: string | null
          empresa_id: string | null
          estrutura: Json
          id: string
          nome: string
          oficial: boolean
          tipo: Database["public"]["Enums"]["banco_layout_tipo"]
          updated_at: string
          versao_layout: string | null
        }
        Insert: {
          ativo?: boolean
          banco_codigo?: string | null
          banco_nome?: string | null
          created_at?: string
          descricao?: string | null
          empresa_id?: string | null
          estrutura?: Json
          id?: string
          nome: string
          oficial?: boolean
          tipo: Database["public"]["Enums"]["banco_layout_tipo"]
          updated_at?: string
          versao_layout?: string | null
        }
        Update: {
          ativo?: boolean
          banco_codigo?: string | null
          banco_nome?: string | null
          created_at?: string
          descricao?: string | null
          empresa_id?: string | null
          estrutura?: Json
          id?: string
          nome?: string
          oficial?: boolean
          tipo?: Database["public"]["Enums"]["banco_layout_tipo"]
          updated_at?: string
          versao_layout?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "banco_layout_template_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "banco_layout_template_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "v_ia_contexto_empresa"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "banco_layout_template_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "vw_bi_resumo_empresa"
            referencedColumns: ["empresa_id"]
          },
        ]
      }
      banco_layout_teste: {
        Row: {
          created_at: string
          duracao_ms: number | null
          empresa_id: string
          erro: string | null
          executado_por: string | null
          http_status: number | null
          id: string
          input_payload: Json | null
          layout_versao_id: string
          output_gerado: string | null
          response_banco: Json | null
          sucesso: boolean | null
          tipo_teste: string
        }
        Insert: {
          created_at?: string
          duracao_ms?: number | null
          empresa_id: string
          erro?: string | null
          executado_por?: string | null
          http_status?: number | null
          id?: string
          input_payload?: Json | null
          layout_versao_id: string
          output_gerado?: string | null
          response_banco?: Json | null
          sucesso?: boolean | null
          tipo_teste: string
        }
        Update: {
          created_at?: string
          duracao_ms?: number | null
          empresa_id?: string
          erro?: string | null
          executado_por?: string | null
          http_status?: number | null
          id?: string
          input_payload?: Json | null
          layout_versao_id?: string
          output_gerado?: string | null
          response_banco?: Json | null
          sucesso?: boolean | null
          tipo_teste?: string
        }
        Relationships: [
          {
            foreignKeyName: "banco_layout_teste_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "banco_layout_teste_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "v_ia_contexto_empresa"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "banco_layout_teste_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "vw_bi_resumo_empresa"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "banco_layout_teste_layout_versao_id_fkey"
            columns: ["layout_versao_id"]
            isOneToOne: false
            referencedRelation: "banco_layout_versao"
            referencedColumns: ["id"]
          },
        ]
      }
      banco_layout_versao: {
        Row: {
          amostra_input: Json | null
          amostra_output: string | null
          aprovado_em: string | null
          aprovado_por: string | null
          created_at: string
          criado_por: string | null
          empresa_id: string
          estrutura: Json
          id: string
          layout_id: string
          motivo_rejeicao: string | null
          notas: string | null
          numero_versao: number
          rejeitado_em: string | null
          rejeitado_por: string | null
          status: Database["public"]["Enums"]["banco_layout_versao_status"]
          submetido_em: string | null
          submetido_por: string | null
          updated_at: string
        }
        Insert: {
          amostra_input?: Json | null
          amostra_output?: string | null
          aprovado_em?: string | null
          aprovado_por?: string | null
          created_at?: string
          criado_por?: string | null
          empresa_id: string
          estrutura?: Json
          id?: string
          layout_id: string
          motivo_rejeicao?: string | null
          notas?: string | null
          numero_versao: number
          rejeitado_em?: string | null
          rejeitado_por?: string | null
          status?: Database["public"]["Enums"]["banco_layout_versao_status"]
          submetido_em?: string | null
          submetido_por?: string | null
          updated_at?: string
        }
        Update: {
          amostra_input?: Json | null
          amostra_output?: string | null
          aprovado_em?: string | null
          aprovado_por?: string | null
          created_at?: string
          criado_por?: string | null
          empresa_id?: string
          estrutura?: Json
          id?: string
          layout_id?: string
          motivo_rejeicao?: string | null
          notas?: string | null
          numero_versao?: number
          rejeitado_em?: string | null
          rejeitado_por?: string | null
          status?: Database["public"]["Enums"]["banco_layout_versao_status"]
          submetido_em?: string | null
          submetido_por?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "banco_layout_versao_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "banco_layout_versao_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "v_ia_contexto_empresa"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "banco_layout_versao_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "vw_bi_resumo_empresa"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "banco_layout_versao_layout_id_fkey"
            columns: ["layout_id"]
            isOneToOne: false
            referencedRelation: "banco_layout"
            referencedColumns: ["id"]
          },
        ]
      }
      base_dissidio_categoria: {
        Row: {
          ativo: boolean
          cbo: string | null
          codigo: string
          created_at: string
          data_base_mes: number | null
          empresa_id: string | null
          id: string
          nome: string
          observacoes: string | null
          sindicato: string | null
          uf: string | null
          updated_at: string
        }
        Insert: {
          ativo?: boolean
          cbo?: string | null
          codigo: string
          created_at?: string
          data_base_mes?: number | null
          empresa_id?: string | null
          id?: string
          nome: string
          observacoes?: string | null
          sindicato?: string | null
          uf?: string | null
          updated_at?: string
        }
        Update: {
          ativo?: boolean
          cbo?: string | null
          codigo?: string
          created_at?: string
          data_base_mes?: number | null
          empresa_id?: string | null
          id?: string
          nome?: string
          observacoes?: string | null
          sindicato?: string | null
          uf?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "base_dissidio_categoria_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "base_dissidio_categoria_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "v_ia_contexto_empresa"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "base_dissidio_categoria_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "vw_bi_resumo_empresa"
            referencedColumns: ["empresa_id"]
          },
        ]
      }
      bdi_aprovacao: {
        Row: {
          acao: Database["public"]["Enums"]["bdi_aprovacao_acao"]
          ator_id: string
          bdi_versao_id: string
          created_at: string
          de_status: Database["public"]["Enums"]["bdi_status"] | null
          empresa_id: string
          id: string
          justificativa: string | null
          para_status: Database["public"]["Enums"]["bdi_status"]
        }
        Insert: {
          acao: Database["public"]["Enums"]["bdi_aprovacao_acao"]
          ator_id: string
          bdi_versao_id: string
          created_at?: string
          de_status?: Database["public"]["Enums"]["bdi_status"] | null
          empresa_id: string
          id?: string
          justificativa?: string | null
          para_status: Database["public"]["Enums"]["bdi_status"]
        }
        Update: {
          acao?: Database["public"]["Enums"]["bdi_aprovacao_acao"]
          ator_id?: string
          bdi_versao_id?: string
          created_at?: string
          de_status?: Database["public"]["Enums"]["bdi_status"] | null
          empresa_id?: string
          id?: string
          justificativa?: string | null
          para_status?: Database["public"]["Enums"]["bdi_status"]
        }
        Relationships: [
          {
            foreignKeyName: "bdi_aprovacao_bdi_versao_id_fkey"
            columns: ["bdi_versao_id"]
            isOneToOne: false
            referencedRelation: "bdi_versao"
            referencedColumns: ["id"]
          },
        ]
      }
      bdi_item: {
        Row: {
          bdi_versao_id: string
          campo_key: string
          created_at: string
          empresa_id: string
          grupo: Database["public"]["Enums"]["bdi_item_grupo"]
          id: string
          label: string
          observacao: string | null
          ordem: number
          produto_servico_id: string | null
          quantidade: number
          tipo: Database["public"]["Enums"]["bdi_item_tipo"]
          unidade: string | null
          updated_at: string
          valor: number
          valor_total_estimado: number | null
          valor_unitario_estimado: number
        }
        Insert: {
          bdi_versao_id: string
          campo_key: string
          created_at?: string
          empresa_id: string
          grupo: Database["public"]["Enums"]["bdi_item_grupo"]
          id?: string
          label: string
          observacao?: string | null
          ordem?: number
          produto_servico_id?: string | null
          quantidade?: number
          tipo?: Database["public"]["Enums"]["bdi_item_tipo"]
          unidade?: string | null
          updated_at?: string
          valor?: number
          valor_total_estimado?: number | null
          valor_unitario_estimado?: number
        }
        Update: {
          bdi_versao_id?: string
          campo_key?: string
          created_at?: string
          empresa_id?: string
          grupo?: Database["public"]["Enums"]["bdi_item_grupo"]
          id?: string
          label?: string
          observacao?: string | null
          ordem?: number
          produto_servico_id?: string | null
          quantidade?: number
          tipo?: Database["public"]["Enums"]["bdi_item_tipo"]
          unidade?: string | null
          updated_at?: string
          valor?: number
          valor_total_estimado?: number | null
          valor_unitario_estimado?: number
        }
        Relationships: [
          {
            foreignKeyName: "bdi_item_bdi_versao_id_fkey"
            columns: ["bdi_versao_id"]
            isOneToOne: false
            referencedRelation: "bdi_versao"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bdi_item_produto_servico_id_fkey"
            columns: ["produto_servico_id"]
            isOneToOne: false
            referencedRelation: "produto_servico"
            referencedColumns: ["id"]
          },
        ]
      }
      bdi_posto: {
        Row: {
          bdi_versao_id: string
          cargo: string
          created_at: string
          empresa_id: string
          epis: number
          id: string
          insalubridade_pct: number
          local: string | null
          observacao: string | null
          ordem: number
          periculosidade_pct: number
          qtd: number
          salario_base: number
          uniformes: number
          updated_at: string
          va: number
          vt: number
        }
        Insert: {
          bdi_versao_id: string
          cargo: string
          created_at?: string
          empresa_id: string
          epis?: number
          id?: string
          insalubridade_pct?: number
          local?: string | null
          observacao?: string | null
          ordem?: number
          periculosidade_pct?: number
          qtd?: number
          salario_base?: number
          uniformes?: number
          updated_at?: string
          va?: number
          vt?: number
        }
        Update: {
          bdi_versao_id?: string
          cargo?: string
          created_at?: string
          empresa_id?: string
          epis?: number
          id?: string
          insalubridade_pct?: number
          local?: string | null
          observacao?: string | null
          ordem?: number
          periculosidade_pct?: number
          qtd?: number
          salario_base?: number
          uniformes?: number
          updated_at?: string
          va?: number
          vt?: number
        }
        Relationships: [
          {
            foreignKeyName: "bdi_posto_bdi_versao_id_fkey"
            columns: ["bdi_versao_id"]
            isOneToOne: false
            referencedRelation: "bdi_versao"
            referencedColumns: ["id"]
          },
        ]
      }
      bdi_snapshot: {
        Row: {
          bdi_versao_id: string
          empresa_id: string
          gerado_em: string
          gerado_por: string
          id: string
          payload: Json
          totais: Json
        }
        Insert: {
          bdi_versao_id: string
          empresa_id: string
          gerado_em?: string
          gerado_por: string
          id?: string
          payload: Json
          totais?: Json
        }
        Update: {
          bdi_versao_id?: string
          empresa_id?: string
          gerado_em?: string
          gerado_por?: string
          id?: string
          payload?: Json
          totais?: Json
        }
        Relationships: [
          {
            foreignKeyName: "bdi_snapshot_bdi_versao_id_fkey"
            columns: ["bdi_versao_id"]
            isOneToOne: false
            referencedRelation: "bdi_versao"
            referencedColumns: ["id"]
          },
        ]
      }
      bdi_verba_folha: {
        Row: {
          bdi_versao_id: string
          created_at: string
          empresa_id: string
          id: string
          observacao: string | null
          ordem: number
          percentual: number
          rubrica: string
          updated_at: string
        }
        Insert: {
          bdi_versao_id: string
          created_at?: string
          empresa_id: string
          id?: string
          observacao?: string | null
          ordem?: number
          percentual?: number
          rubrica: string
          updated_at?: string
        }
        Update: {
          bdi_versao_id?: string
          created_at?: string
          empresa_id?: string
          id?: string
          observacao?: string | null
          ordem?: number
          percentual?: number
          rubrica?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bdi_verba_folha_bdi_versao_id_fkey"
            columns: ["bdi_versao_id"]
            isOneToOne: false
            referencedRelation: "bdi_versao"
            referencedColumns: ["id"]
          },
        ]
      }
      bdi_versao: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          base_versao_id: string | null
          centro_custo_id: string | null
          codigo: string
          contrato_id: string | null
          created_at: string
          created_by: string
          custo_indireto_pct: number
          descricao: string | null
          empresa_id: string
          id: string
          licitacao_id: string | null
          margem_pct: number
          observacao: string | null
          status: Database["public"]["Enums"]["bdi_status"]
          totais_cache: Json
          tributos_pct: number
          updated_at: string
          vigencia_fim: string | null
          vigencia_inicio: string | null
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          base_versao_id?: string | null
          centro_custo_id?: string | null
          codigo: string
          contrato_id?: string | null
          created_at?: string
          created_by?: string
          custo_indireto_pct?: number
          descricao?: string | null
          empresa_id: string
          id?: string
          licitacao_id?: string | null
          margem_pct?: number
          observacao?: string | null
          status?: Database["public"]["Enums"]["bdi_status"]
          totais_cache?: Json
          tributos_pct?: number
          updated_at?: string
          vigencia_fim?: string | null
          vigencia_inicio?: string | null
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          base_versao_id?: string | null
          centro_custo_id?: string | null
          codigo?: string
          contrato_id?: string | null
          created_at?: string
          created_by?: string
          custo_indireto_pct?: number
          descricao?: string | null
          empresa_id?: string
          id?: string
          licitacao_id?: string | null
          margem_pct?: number
          observacao?: string | null
          status?: Database["public"]["Enums"]["bdi_status"]
          totais_cache?: Json
          tributos_pct?: number
          updated_at?: string
          vigencia_fim?: string | null
          vigencia_inicio?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bdi_versao_base_versao_id_fkey"
            columns: ["base_versao_id"]
            isOneToOne: false
            referencedRelation: "bdi_versao"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bdi_versao_centro_custo_id_fkey"
            columns: ["centro_custo_id"]
            isOneToOne: false
            referencedRelation: "centros_custo"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bdi_versao_contrato_id_fkey"
            columns: ["contrato_id"]
            isOneToOne: false
            referencedRelation: "contrato"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bdi_versao_licitacao_id_fkey"
            columns: ["licitacao_id"]
            isOneToOne: false
            referencedRelation: "licitacao"
            referencedColumns: ["id"]
          },
        ]
      }
      centros_custo: {
        Row: {
          ativo: boolean
          categoria_gerencial: string | null
          codigo: string
          codigo_legado: boolean
          created_at: string
          dimensao: string | null
          direto_indireto: string | null
          empresa_id: string
          entidade_origem_id: string | null
          entidade_origem_tabela: string | null
          exige_contrato: boolean
          fixo_variavel: string | null
          gestor_user_id: string | null
          id: string
          impacta_dre: boolean
          nome: string
          origem_cadastro: Database["public"]["Enums"]["cc_origem"]
          responsavel: string | null
          status_cadastro: string
          tipo: Database["public"]["Enums"]["cc_tipo"]
          updated_at: string
          vincular_orcamento: boolean | null
        }
        Insert: {
          ativo?: boolean
          categoria_gerencial?: string | null
          codigo: string
          codigo_legado?: boolean
          created_at?: string
          dimensao?: string | null
          direto_indireto?: string | null
          empresa_id: string
          entidade_origem_id?: string | null
          entidade_origem_tabela?: string | null
          exige_contrato?: boolean
          fixo_variavel?: string | null
          gestor_user_id?: string | null
          id?: string
          impacta_dre?: boolean
          nome: string
          origem_cadastro?: Database["public"]["Enums"]["cc_origem"]
          responsavel?: string | null
          status_cadastro?: string
          tipo?: Database["public"]["Enums"]["cc_tipo"]
          updated_at?: string
          vincular_orcamento?: boolean | null
        }
        Update: {
          ativo?: boolean
          categoria_gerencial?: string | null
          codigo?: string
          codigo_legado?: boolean
          created_at?: string
          dimensao?: string | null
          direto_indireto?: string | null
          empresa_id?: string
          entidade_origem_id?: string | null
          entidade_origem_tabela?: string | null
          exige_contrato?: boolean
          fixo_variavel?: string | null
          gestor_user_id?: string | null
          id?: string
          impacta_dre?: boolean
          nome?: string
          origem_cadastro?: Database["public"]["Enums"]["cc_origem"]
          responsavel?: string | null
          status_cadastro?: string
          tipo?: Database["public"]["Enums"]["cc_tipo"]
          updated_at?: string
          vincular_orcamento?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "centros_custo_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "centros_custo_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "v_ia_contexto_empresa"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "centros_custo_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "vw_bi_resumo_empresa"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "centros_custo_gestor_user_id_fkey"
            columns: ["gestor_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      centros_custo_empresa_log: {
        Row: {
          alterado_em: string
          alterado_por: string | null
          cenario: string
          centro_custo_id: string
          empresa_id_anterior: string
          empresa_id_novo: string
          id: string
          motivo: string | null
        }
        Insert: {
          alterado_em?: string
          alterado_por?: string | null
          cenario: string
          centro_custo_id: string
          empresa_id_anterior: string
          empresa_id_novo: string
          id?: string
          motivo?: string | null
        }
        Update: {
          alterado_em?: string
          alterado_por?: string | null
          cenario?: string
          centro_custo_id?: string
          empresa_id_anterior?: string
          empresa_id_novo?: string
          id?: string
          motivo?: string | null
        }
        Relationships: []
      }
      centros_custo_sequencia: {
        Row: {
          empresa_id: string
          origem: Database["public"]["Enums"]["cc_origem"]
          proximo: number
          tipo: Database["public"]["Enums"]["cc_tipo"]
          updated_at: string
        }
        Insert: {
          empresa_id: string
          origem: Database["public"]["Enums"]["cc_origem"]
          proximo?: number
          tipo: Database["public"]["Enums"]["cc_tipo"]
          updated_at?: string
        }
        Update: {
          empresa_id?: string
          origem?: Database["public"]["Enums"]["cc_origem"]
          proximo?: number
          tipo?: Database["public"]["Enums"]["cc_tipo"]
          updated_at?: string
        }
        Relationships: []
      }
      cfop: {
        Row: {
          ativo: boolean | null
          codigo: string
          descricao: string
          tipo: string
        }
        Insert: {
          ativo?: boolean | null
          codigo: string
          descricao: string
          tipo: string
        }
        Update: {
          ativo?: boolean | null
          codigo?: string
          descricao?: string
          tipo?: string
        }
        Relationships: []
      }
      classificador_valores: {
        Row: {
          ativo: boolean
          classificador_id: string
          codigo: string
          created_at: string
          descricao: string
          id: string
          updated_at: string
        }
        Insert: {
          ativo?: boolean
          classificador_id: string
          codigo: string
          created_at?: string
          descricao: string
          id?: string
          updated_at?: string
        }
        Update: {
          ativo?: boolean
          classificador_id?: string
          codigo?: string
          created_at?: string
          descricao?: string
          id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "classificador_valores_classificador_id_fkey"
            columns: ["classificador_id"]
            isOneToOne: false
            referencedRelation: "classificadores"
            referencedColumns: ["id"]
          },
        ]
      }
      classificadores: {
        Row: {
          ativo: boolean
          codigo: string
          created_at: string
          descricao: string | null
          empresa_id: string
          id: string
          nome: string
          updated_at: string
        }
        Insert: {
          ativo?: boolean
          codigo: string
          created_at?: string
          descricao?: string | null
          empresa_id: string
          id?: string
          nome: string
          updated_at?: string
        }
        Update: {
          ativo?: boolean
          codigo?: string
          created_at?: string
          descricao?: string | null
          empresa_id?: string
          id?: string
          nome?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "classificadores_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "classificadores_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "v_ia_contexto_empresa"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "classificadores_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "vw_bi_resumo_empresa"
            referencedColumns: ["empresa_id"]
          },
        ]
      }
      cobranca_boleto: {
        Row: {
          carteira: string | null
          codigo_barras: string | null
          conta_bancaria_id: string | null
          created_at: string
          empresa_id: string
          enviado_em: string | null
          id: string
          instrucoes: string | null
          linha_digitavel: string | null
          nosso_numero: string | null
          payload_remessa: Json | null
          payload_retorno: Json | null
          registrado_em: string | null
          status_registro: Database["public"]["Enums"]["cobranca_registro_status"]
          titulo_id: string
          updated_at: string
          url_pdf: string | null
        }
        Insert: {
          carteira?: string | null
          codigo_barras?: string | null
          conta_bancaria_id?: string | null
          created_at?: string
          empresa_id: string
          enviado_em?: string | null
          id?: string
          instrucoes?: string | null
          linha_digitavel?: string | null
          nosso_numero?: string | null
          payload_remessa?: Json | null
          payload_retorno?: Json | null
          registrado_em?: string | null
          status_registro?: Database["public"]["Enums"]["cobranca_registro_status"]
          titulo_id: string
          updated_at?: string
          url_pdf?: string | null
        }
        Update: {
          carteira?: string | null
          codigo_barras?: string | null
          conta_bancaria_id?: string | null
          created_at?: string
          empresa_id?: string
          enviado_em?: string | null
          id?: string
          instrucoes?: string | null
          linha_digitavel?: string | null
          nosso_numero?: string | null
          payload_remessa?: Json | null
          payload_retorno?: Json | null
          registrado_em?: string | null
          status_registro?: Database["public"]["Enums"]["cobranca_registro_status"]
          titulo_id?: string
          updated_at?: string
          url_pdf?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cobranca_boleto_conta_bancaria_id_fkey"
            columns: ["conta_bancaria_id"]
            isOneToOne: false
            referencedRelation: "conta_bancaria"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cobranca_boleto_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cobranca_boleto_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "v_ia_contexto_empresa"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "cobranca_boleto_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "vw_bi_resumo_empresa"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "cobranca_boleto_titulo_id_fkey"
            columns: ["titulo_id"]
            isOneToOne: true
            referencedRelation: "titulo_receber"
            referencedColumns: ["id"]
          },
        ]
      }
      cobranca_evento: {
        Row: {
          created_at: string
          empresa_id: string
          id: string
          origem: string | null
          payload: Json | null
          processado: boolean
          processado_em: string | null
          tipo: string
          titulo_id: string | null
        }
        Insert: {
          created_at?: string
          empresa_id: string
          id?: string
          origem?: string | null
          payload?: Json | null
          processado?: boolean
          processado_em?: string | null
          tipo: string
          titulo_id?: string | null
        }
        Update: {
          created_at?: string
          empresa_id?: string
          id?: string
          origem?: string | null
          payload?: Json | null
          processado?: boolean
          processado_em?: string | null
          tipo?: string
          titulo_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cobranca_evento_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cobranca_evento_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "v_ia_contexto_empresa"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "cobranca_evento_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "vw_bi_resumo_empresa"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "cobranca_evento_titulo_id_fkey"
            columns: ["titulo_id"]
            isOneToOne: false
            referencedRelation: "titulo_receber"
            referencedColumns: ["id"]
          },
        ]
      }
      cobranca_pix: {
        Row: {
          chave_pix: string | null
          conta_bancaria_id: string | null
          copia_e_cola: string | null
          created_at: string
          e2eid: string | null
          empresa_id: string
          expira_em: string | null
          expiracao_segundos: number | null
          id: string
          pago_em: string | null
          payload: Json | null
          qrcode_imagem: string | null
          status: Database["public"]["Enums"]["pix_cobranca_status"]
          titulo_id: string
          txid: string
          updated_at: string
        }
        Insert: {
          chave_pix?: string | null
          conta_bancaria_id?: string | null
          copia_e_cola?: string | null
          created_at?: string
          e2eid?: string | null
          empresa_id: string
          expira_em?: string | null
          expiracao_segundos?: number | null
          id?: string
          pago_em?: string | null
          payload?: Json | null
          qrcode_imagem?: string | null
          status?: Database["public"]["Enums"]["pix_cobranca_status"]
          titulo_id: string
          txid: string
          updated_at?: string
        }
        Update: {
          chave_pix?: string | null
          conta_bancaria_id?: string | null
          copia_e_cola?: string | null
          created_at?: string
          e2eid?: string | null
          empresa_id?: string
          expira_em?: string | null
          expiracao_segundos?: number | null
          id?: string
          pago_em?: string | null
          payload?: Json | null
          qrcode_imagem?: string | null
          status?: Database["public"]["Enums"]["pix_cobranca_status"]
          titulo_id?: string
          txid?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cobranca_pix_conta_bancaria_id_fkey"
            columns: ["conta_bancaria_id"]
            isOneToOne: false
            referencedRelation: "conta_bancaria"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cobranca_pix_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cobranca_pix_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "v_ia_contexto_empresa"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "cobranca_pix_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "vw_bi_resumo_empresa"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "cobranca_pix_titulo_id_fkey"
            columns: ["titulo_id"]
            isOneToOne: true
            referencedRelation: "titulo_receber"
            referencedColumns: ["id"]
          },
        ]
      }
      colaborador: {
        Row: {
          batch_id: string | null
          cargo: string | null
          cbo: string | null
          cpf: string
          created_at: string
          data_admissao: string
          data_demissao: string | null
          data_nascimento: string | null
          departamento: string | null
          email: string | null
          empresa_id: string
          endereco_bairro: string | null
          endereco_cep: string | null
          endereco_cidade: string | null
          endereco_numero: string | null
          endereco_rua: string | null
          endereco_uf: string | null
          foto_path: string | null
          genero: string | null
          gestor_direto: string | null
          id: string
          jornada: string | null
          matricula: string | null
          nome: string
          observacoes: string | null
          pis_pasep: string | null
          rg: string | null
          salario_base: number
          status: Database["public"]["Enums"]["colab_status"]
          telefone: string | null
          tipo_contrato: string | null
          updated_at: string
        }
        Insert: {
          batch_id?: string | null
          cargo?: string | null
          cbo?: string | null
          cpf: string
          created_at?: string
          data_admissao?: string
          data_demissao?: string | null
          data_nascimento?: string | null
          departamento?: string | null
          email?: string | null
          empresa_id: string
          endereco_bairro?: string | null
          endereco_cep?: string | null
          endereco_cidade?: string | null
          endereco_numero?: string | null
          endereco_rua?: string | null
          endereco_uf?: string | null
          foto_path?: string | null
          genero?: string | null
          gestor_direto?: string | null
          id?: string
          jornada?: string | null
          matricula?: string | null
          nome: string
          observacoes?: string | null
          pis_pasep?: string | null
          rg?: string | null
          salario_base?: number
          status?: Database["public"]["Enums"]["colab_status"]
          telefone?: string | null
          tipo_contrato?: string | null
          updated_at?: string
        }
        Update: {
          batch_id?: string | null
          cargo?: string | null
          cbo?: string | null
          cpf?: string
          created_at?: string
          data_admissao?: string
          data_demissao?: string | null
          data_nascimento?: string | null
          departamento?: string | null
          email?: string | null
          empresa_id?: string
          endereco_bairro?: string | null
          endereco_cep?: string | null
          endereco_cidade?: string | null
          endereco_numero?: string | null
          endereco_rua?: string | null
          endereco_uf?: string | null
          foto_path?: string | null
          genero?: string | null
          gestor_direto?: string | null
          id?: string
          jornada?: string | null
          matricula?: string | null
          nome?: string
          observacoes?: string | null
          pis_pasep?: string | null
          rg?: string | null
          salario_base?: number
          status?: Database["public"]["Enums"]["colab_status"]
          telefone?: string | null
          tipo_contrato?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "colaborador_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "integration_batches"
            referencedColumns: ["id"]
          },
        ]
      }
      colaborador_conta_bancaria: {
        Row: {
          agencia: string
          agencia_digito: string | null
          ativa: boolean
          banco_codigo: string
          banco_nome: string
          colaborador_id: string
          conta: string
          conta_digito: string | null
          created_at: string
          empresa_id: string
          id: string
          observacoes: string | null
          pix_chave: string | null
          pix_tipo: string | null
          principal: boolean
          tipo: string
          titular_documento: string | null
          titular_nome: string | null
          updated_at: string
        }
        Insert: {
          agencia: string
          agencia_digito?: string | null
          ativa?: boolean
          banco_codigo: string
          banco_nome: string
          colaborador_id: string
          conta: string
          conta_digito?: string | null
          created_at?: string
          empresa_id: string
          id?: string
          observacoes?: string | null
          pix_chave?: string | null
          pix_tipo?: string | null
          principal?: boolean
          tipo?: string
          titular_documento?: string | null
          titular_nome?: string | null
          updated_at?: string
        }
        Update: {
          agencia?: string
          agencia_digito?: string | null
          ativa?: boolean
          banco_codigo?: string
          banco_nome?: string
          colaborador_id?: string
          conta?: string
          conta_digito?: string | null
          created_at?: string
          empresa_id?: string
          id?: string
          observacoes?: string | null
          pix_chave?: string | null
          pix_tipo?: string | null
          principal?: boolean
          tipo?: string
          titular_documento?: string | null
          titular_nome?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "colaborador_conta_bancaria_colaborador_id_fkey"
            columns: ["colaborador_id"]
            isOneToOne: false
            referencedRelation: "colaborador"
            referencedColumns: ["id"]
          },
        ]
      }
      comite: {
        Row: {
          ativo: boolean
          created_at: string
          descricao: string | null
          empresa_id: string
          gestor_profile_id: string | null
          id: string
          nome: string
          updated_at: string
        }
        Insert: {
          ativo?: boolean
          created_at?: string
          descricao?: string | null
          empresa_id: string
          gestor_profile_id?: string | null
          id?: string
          nome: string
          updated_at?: string
        }
        Update: {
          ativo?: boolean
          created_at?: string
          descricao?: string | null
          empresa_id?: string
          gestor_profile_id?: string | null
          id?: string
          nome?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "comite_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comite_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "v_ia_contexto_empresa"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "comite_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "vw_bi_resumo_empresa"
            referencedColumns: ["empresa_id"]
          },
        ]
      }
      conciliacao_match: {
        Row: {
          confirmado_em: string | null
          confirmado_por: string | null
          created_at: string
          diferenca_dias: number | null
          diferenca_valor: number | null
          empresa_id: string
          extrato_id: string
          id: string
          observacoes: string | null
          tipo_match: string
          titulo_pagar_id: string | null
          titulo_receber_id: string | null
        }
        Insert: {
          confirmado_em?: string | null
          confirmado_por?: string | null
          created_at?: string
          diferenca_dias?: number | null
          diferenca_valor?: number | null
          empresa_id: string
          extrato_id: string
          id?: string
          observacoes?: string | null
          tipo_match?: string
          titulo_pagar_id?: string | null
          titulo_receber_id?: string | null
        }
        Update: {
          confirmado_em?: string | null
          confirmado_por?: string | null
          created_at?: string
          diferenca_dias?: number | null
          diferenca_valor?: number | null
          empresa_id?: string
          extrato_id?: string
          id?: string
          observacoes?: string | null
          tipo_match?: string
          titulo_pagar_id?: string | null
          titulo_receber_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "conciliacao_match_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conciliacao_match_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "v_ia_contexto_empresa"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "conciliacao_match_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "vw_bi_resumo_empresa"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "conciliacao_match_extrato_id_fkey"
            columns: ["extrato_id"]
            isOneToOne: false
            referencedRelation: "extrato_bancario"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conciliacao_match_titulo_pagar_id_fkey"
            columns: ["titulo_pagar_id"]
            isOneToOne: false
            referencedRelation: "titulo_pagar"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conciliacao_match_titulo_receber_id_fkey"
            columns: ["titulo_receber_id"]
            isOneToOne: false
            referencedRelation: "titulo_receber"
            referencedColumns: ["id"]
          },
        ]
      }
      conciliacao_regra: {
        Row: {
          ativo: boolean
          centro_custo_id: string | null
          conta_contabil_id: string | null
          contraparte_documento: string | null
          created_at: string
          descricao_padrao: string | null
          empresa_id: string
          id: string
          nome: string
          prioridade: number
          tipo_alvo: Database["public"]["Enums"]["extrato_tipo"] | null
          updated_at: string
        }
        Insert: {
          ativo?: boolean
          centro_custo_id?: string | null
          conta_contabil_id?: string | null
          contraparte_documento?: string | null
          created_at?: string
          descricao_padrao?: string | null
          empresa_id: string
          id?: string
          nome: string
          prioridade?: number
          tipo_alvo?: Database["public"]["Enums"]["extrato_tipo"] | null
          updated_at?: string
        }
        Update: {
          ativo?: boolean
          centro_custo_id?: string | null
          conta_contabil_id?: string | null
          contraparte_documento?: string | null
          created_at?: string
          descricao_padrao?: string | null
          empresa_id?: string
          id?: string
          nome?: string
          prioridade?: number
          tipo_alvo?: Database["public"]["Enums"]["extrato_tipo"] | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "conciliacao_regra_centro_custo_id_fkey"
            columns: ["centro_custo_id"]
            isOneToOne: false
            referencedRelation: "centros_custo"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conciliacao_regra_conta_contabil_id_fkey"
            columns: ["conta_contabil_id"]
            isOneToOne: false
            referencedRelation: "conta_contabil"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conciliacao_regra_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conciliacao_regra_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "v_ia_contexto_empresa"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "conciliacao_regra_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "vw_bi_resumo_empresa"
            referencedColumns: ["empresa_id"]
          },
        ]
      }
      conciliacao_regras: {
        Row: {
          ativo: boolean
          centro_custo_id: string | null
          created_at: string
          dre_linha_id: string | null
          empresa_id: string
          id: string
          nome: string
          pattern_contraparte: string | null
          pattern_descricao: string | null
          pattern_documento: string | null
          prioridade: number
          updated_at: string
          valor_max: number | null
          valor_min: number | null
        }
        Insert: {
          ativo?: boolean
          centro_custo_id?: string | null
          created_at?: string
          dre_linha_id?: string | null
          empresa_id: string
          id?: string
          nome: string
          pattern_contraparte?: string | null
          pattern_descricao?: string | null
          pattern_documento?: string | null
          prioridade?: number
          updated_at?: string
          valor_max?: number | null
          valor_min?: number | null
        }
        Update: {
          ativo?: boolean
          centro_custo_id?: string | null
          created_at?: string
          dre_linha_id?: string | null
          empresa_id?: string
          id?: string
          nome?: string
          pattern_contraparte?: string | null
          pattern_descricao?: string | null
          pattern_documento?: string | null
          prioridade?: number
          updated_at?: string
          valor_max?: number | null
          valor_min?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "conciliacao_regras_centro_custo_id_fkey"
            columns: ["centro_custo_id"]
            isOneToOne: false
            referencedRelation: "centros_custo"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conciliacao_regras_dre_linha_id_fkey"
            columns: ["dre_linha_id"]
            isOneToOne: false
            referencedRelation: "dre_linhas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conciliacao_regras_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conciliacao_regras_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "v_ia_contexto_empresa"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "conciliacao_regras_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "vw_bi_resumo_empresa"
            referencedColumns: ["empresa_id"]
          },
        ]
      }
      conta_bancaria: {
        Row: {
          agencia: string
          ativa: boolean
          banco_codigo: string
          banco_nome: string
          cnab_carteira: string | null
          cnab_codigo_empresa: string | null
          cnab_codigo_remessa: string | null
          cnab_convenio: string | null
          cnab_layout: string
          cnab_proxima_sequencia: number
          cnab_proximo_lote: number
          conta: string
          conta_contabil_id: string | null
          created_at: string
          dias_baixa_automatica: number
          digito: string | null
          empresa_cnpj: string | null
          empresa_id: string
          empresa_nome: string | null
          id: string
          integracao_ambiente: Database["public"]["Enums"]["integracao_ambiente"]
          integracao_api_url: string | null
          integracao_certificado_ref: string | null
          integracao_client_id_ref: string | null
          integracao_client_secret_ref: string | null
          integracao_ftp_host: string | null
          integracao_ftp_pasta_remessa: string | null
          integracao_ftp_pasta_retorno: string | null
          integracao_ftp_porta: number | null
          integracao_status: Database["public"]["Enums"]["integracao_status"]
          integracao_tipo: Database["public"]["Enums"]["integracao_bancaria_tipo"]
          integracao_token_acesso_ref: string | null
          integracao_token_expira_em: string | null
          integracao_ultima_sincronia: string | null
          integracao_ultimo_erro: string | null
          integracao_webhook_url: string | null
          observacoes: string | null
          observacoes_integracao: string | null
          tipo: Database["public"]["Enums"]["banco_tipo"]
          titular: string | null
          updated_at: string
        }
        Insert: {
          agencia: string
          ativa?: boolean
          banco_codigo: string
          banco_nome: string
          cnab_carteira?: string | null
          cnab_codigo_empresa?: string | null
          cnab_codigo_remessa?: string | null
          cnab_convenio?: string | null
          cnab_layout?: string
          cnab_proxima_sequencia?: number
          cnab_proximo_lote?: number
          conta: string
          conta_contabil_id?: string | null
          created_at?: string
          dias_baixa_automatica?: number
          digito?: string | null
          empresa_cnpj?: string | null
          empresa_id: string
          empresa_nome?: string | null
          id?: string
          integracao_ambiente?: Database["public"]["Enums"]["integracao_ambiente"]
          integracao_api_url?: string | null
          integracao_certificado_ref?: string | null
          integracao_client_id_ref?: string | null
          integracao_client_secret_ref?: string | null
          integracao_ftp_host?: string | null
          integracao_ftp_pasta_remessa?: string | null
          integracao_ftp_pasta_retorno?: string | null
          integracao_ftp_porta?: number | null
          integracao_status?: Database["public"]["Enums"]["integracao_status"]
          integracao_tipo?: Database["public"]["Enums"]["integracao_bancaria_tipo"]
          integracao_token_acesso_ref?: string | null
          integracao_token_expira_em?: string | null
          integracao_ultima_sincronia?: string | null
          integracao_ultimo_erro?: string | null
          integracao_webhook_url?: string | null
          observacoes?: string | null
          observacoes_integracao?: string | null
          tipo?: Database["public"]["Enums"]["banco_tipo"]
          titular?: string | null
          updated_at?: string
        }
        Update: {
          agencia?: string
          ativa?: boolean
          banco_codigo?: string
          banco_nome?: string
          cnab_carteira?: string | null
          cnab_codigo_empresa?: string | null
          cnab_codigo_remessa?: string | null
          cnab_convenio?: string | null
          cnab_layout?: string
          cnab_proxima_sequencia?: number
          cnab_proximo_lote?: number
          conta?: string
          conta_contabil_id?: string | null
          created_at?: string
          dias_baixa_automatica?: number
          digito?: string | null
          empresa_cnpj?: string | null
          empresa_id?: string
          empresa_nome?: string | null
          id?: string
          integracao_ambiente?: Database["public"]["Enums"]["integracao_ambiente"]
          integracao_api_url?: string | null
          integracao_certificado_ref?: string | null
          integracao_client_id_ref?: string | null
          integracao_client_secret_ref?: string | null
          integracao_ftp_host?: string | null
          integracao_ftp_pasta_remessa?: string | null
          integracao_ftp_pasta_retorno?: string | null
          integracao_ftp_porta?: number | null
          integracao_status?: Database["public"]["Enums"]["integracao_status"]
          integracao_tipo?: Database["public"]["Enums"]["integracao_bancaria_tipo"]
          integracao_token_acesso_ref?: string | null
          integracao_token_expira_em?: string | null
          integracao_ultima_sincronia?: string | null
          integracao_ultimo_erro?: string | null
          integracao_webhook_url?: string | null
          observacoes?: string | null
          observacoes_integracao?: string | null
          tipo?: Database["public"]["Enums"]["banco_tipo"]
          titular?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "conta_bancaria_conta_contabil_id_fkey"
            columns: ["conta_contabil_id"]
            isOneToOne: false
            referencedRelation: "conta_contabil"
            referencedColumns: ["id"]
          },
        ]
      }
      conta_contabil: {
        Row: {
          ativo: boolean
          centro_custo_padrao: string | null
          classe_contabil: string | null
          classificacao: string
          conta_reduzida: number
          created_at: string
          descricao: string
          direto_indireto: string | null
          dre_linha_id: string | null
          empresa_id: string
          entra_fluxo: boolean
          entra_orcamento: boolean
          exige_contrato: Database["public"]["Enums"]["conta_exige_contrato"]
          fixo_variavel: string | null
          grupo_dre: Database["public"]["Enums"]["conta_grupo_dre"]
          id: string
          master_id: string | null
          natureza: Database["public"]["Enums"]["conta_natureza"]
          parent_id: string | null
          saldo_inicial: number
          tipo: Database["public"]["Enums"]["conta_tipo"]
          tipo_gerencial: string | null
          updated_at: string
        }
        Insert: {
          ativo?: boolean
          centro_custo_padrao?: string | null
          classe_contabil?: string | null
          classificacao: string
          conta_reduzida: number
          created_at?: string
          descricao: string
          direto_indireto?: string | null
          dre_linha_id?: string | null
          empresa_id: string
          entra_fluxo?: boolean
          entra_orcamento?: boolean
          exige_contrato?: Database["public"]["Enums"]["conta_exige_contrato"]
          fixo_variavel?: string | null
          grupo_dre?: Database["public"]["Enums"]["conta_grupo_dre"]
          id?: string
          master_id?: string | null
          natureza: Database["public"]["Enums"]["conta_natureza"]
          parent_id?: string | null
          saldo_inicial?: number
          tipo: Database["public"]["Enums"]["conta_tipo"]
          tipo_gerencial?: string | null
          updated_at?: string
        }
        Update: {
          ativo?: boolean
          centro_custo_padrao?: string | null
          classe_contabil?: string | null
          classificacao?: string
          conta_reduzida?: number
          created_at?: string
          descricao?: string
          direto_indireto?: string | null
          dre_linha_id?: string | null
          empresa_id?: string
          entra_fluxo?: boolean
          entra_orcamento?: boolean
          exige_contrato?: Database["public"]["Enums"]["conta_exige_contrato"]
          fixo_variavel?: string | null
          grupo_dre?: Database["public"]["Enums"]["conta_grupo_dre"]
          id?: string
          master_id?: string | null
          natureza?: Database["public"]["Enums"]["conta_natureza"]
          parent_id?: string | null
          saldo_inicial?: number
          tipo?: Database["public"]["Enums"]["conta_tipo"]
          tipo_gerencial?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "conta_contabil_dre_linha_id_fkey"
            columns: ["dre_linha_id"]
            isOneToOne: false
            referencedRelation: "dre_linhas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conta_contabil_master_id_fkey"
            columns: ["master_id"]
            isOneToOne: false
            referencedRelation: "plano_contas_master"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conta_contabil_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "conta_contabil"
            referencedColumns: ["id"]
          },
        ]
      }
      contrato: {
        Row: {
          batch_id: string | null
          centro_custo_id: string | null
          created_at: string
          empresa_id: string
          faturamento_mensal: number
          gestor: string | null
          id: string
          licitacao_id: string | null
          numero: string
          objeto: string
          observacoes: string | null
          orgao: string
          origem_licitacao_texto: string | null
          status: Database["public"]["Enums"]["contrato_status"]
          updated_at: string
          valor_total: number
          vigencia_fim: string
          vigencia_inicio: string
        }
        Insert: {
          batch_id?: string | null
          centro_custo_id?: string | null
          created_at?: string
          empresa_id: string
          faturamento_mensal?: number
          gestor?: string | null
          id?: string
          licitacao_id?: string | null
          numero: string
          objeto: string
          observacoes?: string | null
          orgao: string
          origem_licitacao_texto?: string | null
          status?: Database["public"]["Enums"]["contrato_status"]
          updated_at?: string
          valor_total?: number
          vigencia_fim: string
          vigencia_inicio: string
        }
        Update: {
          batch_id?: string | null
          centro_custo_id?: string | null
          created_at?: string
          empresa_id?: string
          faturamento_mensal?: number
          gestor?: string | null
          id?: string
          licitacao_id?: string | null
          numero?: string
          objeto?: string
          observacoes?: string | null
          orgao?: string
          origem_licitacao_texto?: string | null
          status?: Database["public"]["Enums"]["contrato_status"]
          updated_at?: string
          valor_total?: number
          vigencia_fim?: string
          vigencia_inicio?: string
        }
        Relationships: [
          {
            foreignKeyName: "contrato_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "integration_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contrato_centro_custo_id_fkey"
            columns: ["centro_custo_id"]
            isOneToOne: false
            referencedRelation: "centros_custo"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contrato_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contrato_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "v_ia_contexto_empresa"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "contrato_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "vw_bi_resumo_empresa"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "contrato_licitacao_id_fkey"
            columns: ["licitacao_id"]
            isOneToOne: false
            referencedRelation: "licitacao"
            referencedColumns: ["id"]
          },
        ]
      }
      contrato_comprovacao: {
        Row: {
          anexo_id: string | null
          contrato_id: string
          created_at: string
          data_documento: string
          descricao: string | null
          id: string
          numero: string
          observacoes: string | null
          tipo: Database["public"]["Enums"]["comprovacao_tipo"]
          updated_at: string
          valor: number
        }
        Insert: {
          anexo_id?: string | null
          contrato_id: string
          created_at?: string
          data_documento: string
          descricao?: string | null
          id?: string
          numero: string
          observacoes?: string | null
          tipo: Database["public"]["Enums"]["comprovacao_tipo"]
          updated_at?: string
          valor?: number
        }
        Update: {
          anexo_id?: string | null
          contrato_id?: string
          created_at?: string
          data_documento?: string
          descricao?: string | null
          id?: string
          numero?: string
          observacoes?: string | null
          tipo?: Database["public"]["Enums"]["comprovacao_tipo"]
          updated_at?: string
          valor?: number
        }
        Relationships: [
          {
            foreignKeyName: "contrato_comprovacao_anexo_id_fkey"
            columns: ["anexo_id"]
            isOneToOne: false
            referencedRelation: "anexos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contrato_comprovacao_contrato_id_fkey"
            columns: ["contrato_id"]
            isOneToOne: false
            referencedRelation: "contrato"
            referencedColumns: ["id"]
          },
        ]
      }
      contrato_dissidio: {
        Row: {
          aplicado: boolean
          base_calculo: Database["public"]["Enums"]["dissidio_base_calculo"]
          base_dissidio_id: string | null
          competencia: string
          contrato_id: string
          contrato_posto_id: string | null
          created_at: string
          criterio: Database["public"]["Enums"]["dissidio_criterio"]
          documento_referencia: string | null
          id: string
          indice_referencia: string | null
          observacoes: string | null
          percentual: number
          updated_at: string
          valor_fixo: number
        }
        Insert: {
          aplicado?: boolean
          base_calculo?: Database["public"]["Enums"]["dissidio_base_calculo"]
          base_dissidio_id?: string | null
          competencia: string
          contrato_id: string
          contrato_posto_id?: string | null
          created_at?: string
          criterio: Database["public"]["Enums"]["dissidio_criterio"]
          documento_referencia?: string | null
          id?: string
          indice_referencia?: string | null
          observacoes?: string | null
          percentual?: number
          updated_at?: string
          valor_fixo?: number
        }
        Update: {
          aplicado?: boolean
          base_calculo?: Database["public"]["Enums"]["dissidio_base_calculo"]
          base_dissidio_id?: string | null
          competencia?: string
          contrato_id?: string
          contrato_posto_id?: string | null
          created_at?: string
          criterio?: Database["public"]["Enums"]["dissidio_criterio"]
          documento_referencia?: string | null
          id?: string
          indice_referencia?: string | null
          observacoes?: string | null
          percentual?: number
          updated_at?: string
          valor_fixo?: number
        }
        Relationships: [
          {
            foreignKeyName: "contrato_dissidio_base_dissidio_id_fkey"
            columns: ["base_dissidio_id"]
            isOneToOne: false
            referencedRelation: "base_dissidio_categoria"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contrato_dissidio_contrato_id_fkey"
            columns: ["contrato_id"]
            isOneToOne: false
            referencedRelation: "contrato"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contrato_dissidio_contrato_posto_id_fkey"
            columns: ["contrato_posto_id"]
            isOneToOne: false
            referencedRelation: "contrato_posto"
            referencedColumns: ["id"]
          },
        ]
      }
      contrato_posto: {
        Row: {
          ativo: boolean
          base_dissidio_id: string | null
          cargo: string
          contrato_id: string
          created_at: string
          epis: number
          id: string
          insalubridade_pct: number
          jornada: Database["public"]["Enums"]["posto_jornada"]
          local: string | null
          observacoes: string | null
          periculosidade_pct: number
          quantidade: number
          salario_base: number
          uniformes: number
          updated_at: string
          va: number
          vt: number
        }
        Insert: {
          ativo?: boolean
          base_dissidio_id?: string | null
          cargo: string
          contrato_id: string
          created_at?: string
          epis?: number
          id?: string
          insalubridade_pct?: number
          jornada?: Database["public"]["Enums"]["posto_jornada"]
          local?: string | null
          observacoes?: string | null
          periculosidade_pct?: number
          quantidade?: number
          salario_base?: number
          uniformes?: number
          updated_at?: string
          va?: number
          vt?: number
        }
        Update: {
          ativo?: boolean
          base_dissidio_id?: string | null
          cargo?: string
          contrato_id?: string
          created_at?: string
          epis?: number
          id?: string
          insalubridade_pct?: number
          jornada?: Database["public"]["Enums"]["posto_jornada"]
          local?: string | null
          observacoes?: string | null
          periculosidade_pct?: number
          quantidade?: number
          salario_base?: number
          uniformes?: number
          updated_at?: string
          va?: number
          vt?: number
        }
        Relationships: [
          {
            foreignKeyName: "contrato_posto_base_dissidio_id_fkey"
            columns: ["base_dissidio_id"]
            isOneToOne: false
            referencedRelation: "base_dissidio_categoria"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contrato_posto_contrato_id_fkey"
            columns: ["contrato_id"]
            isOneToOne: false
            referencedRelation: "contrato"
            referencedColumns: ["id"]
          },
        ]
      }
      copiloto_conversa: {
        Row: {
          created_at: string
          empresa_id: string
          id: string
          titulo: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          empresa_id: string
          id?: string
          titulo?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          empresa_id?: string
          id?: string
          titulo?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      copiloto_mensagem: {
        Row: {
          audio_path: string | null
          content: string
          conversa_id: string
          created_at: string
          id: string
          metadata: Json
          role: string
        }
        Insert: {
          audio_path?: string | null
          content?: string
          conversa_id: string
          created_at?: string
          id?: string
          metadata?: Json
          role: string
        }
        Update: {
          audio_path?: string | null
          content?: string
          conversa_id?: string
          created_at?: string
          id?: string
          metadata?: Json
          role?: string
        }
        Relationships: [
          {
            foreignKeyName: "copiloto_mensagem_conversa_id_fkey"
            columns: ["conversa_id"]
            isOneToOne: false
            referencedRelation: "copiloto_conversa"
            referencedColumns: ["id"]
          },
        ]
      }
      cotacao: {
        Row: {
          created_at: string
          criado_por: string | null
          descricao: string | null
          empresa_id: string
          fechado_em: string | null
          fechado_por: string | null
          id: string
          justificativa_dispensa: string | null
          motivo_dispensa: string | null
          numero: string
          pedido_compra_ids: string[] | null
          prazo_resposta: string | null
          status: Database["public"]["Enums"]["cotacao_status"]
          titulo: string
          updated_at: string
          vencedor_fornecedor_id: string | null
        }
        Insert: {
          created_at?: string
          criado_por?: string | null
          descricao?: string | null
          empresa_id: string
          fechado_em?: string | null
          fechado_por?: string | null
          id?: string
          justificativa_dispensa?: string | null
          motivo_dispensa?: string | null
          numero?: string
          pedido_compra_ids?: string[] | null
          prazo_resposta?: string | null
          status?: Database["public"]["Enums"]["cotacao_status"]
          titulo: string
          updated_at?: string
          vencedor_fornecedor_id?: string | null
        }
        Update: {
          created_at?: string
          criado_por?: string | null
          descricao?: string | null
          empresa_id?: string
          fechado_em?: string | null
          fechado_por?: string | null
          id?: string
          justificativa_dispensa?: string | null
          motivo_dispensa?: string | null
          numero?: string
          pedido_compra_ids?: string[] | null
          prazo_resposta?: string | null
          status?: Database["public"]["Enums"]["cotacao_status"]
          titulo?: string
          updated_at?: string
          vencedor_fornecedor_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cotacao_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cotacao_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "v_ia_contexto_empresa"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "cotacao_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "vw_bi_resumo_empresa"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "cotacao_vencedor_fornecedor_id_fkey"
            columns: ["vencedor_fornecedor_id"]
            isOneToOne: false
            referencedRelation: "fornecedor"
            referencedColumns: ["id"]
          },
        ]
      }
      cotacao_fornecedor: {
        Row: {
          convidado_em: string
          cotacao_id: string
          fornecedor_id: string
          id: string
          observacoes: string | null
          respondido_em: string | null
          status: Database["public"]["Enums"]["cotacao_fornecedor_status"]
        }
        Insert: {
          convidado_em?: string
          cotacao_id: string
          fornecedor_id: string
          id?: string
          observacoes?: string | null
          respondido_em?: string | null
          status?: Database["public"]["Enums"]["cotacao_fornecedor_status"]
        }
        Update: {
          convidado_em?: string
          cotacao_id?: string
          fornecedor_id?: string
          id?: string
          observacoes?: string | null
          respondido_em?: string | null
          status?: Database["public"]["Enums"]["cotacao_fornecedor_status"]
        }
        Relationships: [
          {
            foreignKeyName: "cotacao_fornecedor_cotacao_id_fkey"
            columns: ["cotacao_id"]
            isOneToOne: false
            referencedRelation: "cotacao"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cotacao_fornecedor_fornecedor_id_fkey"
            columns: ["fornecedor_id"]
            isOneToOne: false
            referencedRelation: "fornecedor"
            referencedColumns: ["id"]
          },
        ]
      }
      cotacao_item: {
        Row: {
          cotacao_id: string
          created_at: string
          descricao: string
          id: string
          observacoes: string | null
          ordem: number
          produto_servico_id: string | null
          quantidade: number
          rc_item_id: string | null
          unidade: string | null
        }
        Insert: {
          cotacao_id: string
          created_at?: string
          descricao: string
          id?: string
          observacoes?: string | null
          ordem?: number
          produto_servico_id?: string | null
          quantidade: number
          rc_item_id?: string | null
          unidade?: string | null
        }
        Update: {
          cotacao_id?: string
          created_at?: string
          descricao?: string
          id?: string
          observacoes?: string | null
          ordem?: number
          produto_servico_id?: string | null
          quantidade?: number
          rc_item_id?: string | null
          unidade?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cotacao_item_cotacao_id_fkey"
            columns: ["cotacao_id"]
            isOneToOne: false
            referencedRelation: "cotacao"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cotacao_item_rc_item_id_fkey"
            columns: ["rc_item_id"]
            isOneToOne: false
            referencedRelation: "requisicao_compra_item"
            referencedColumns: ["id"]
          },
        ]
      }
      cotacao_proposta: {
        Row: {
          condicoes_pagamento: string | null
          cotacao_fornecedor_id: string
          cotacao_id: string
          fornecedor_id: string
          id: string
          observacoes: string | null
          prazo_entrega_dias: number | null
          prazo_pagamento_dias: number | null
          ranking: number | null
          registrado_em: string
          registrado_por: string | null
          score: number | null
          validade_dias: number | null
          valor_frete: number
          valor_total: number
        }
        Insert: {
          condicoes_pagamento?: string | null
          cotacao_fornecedor_id: string
          cotacao_id: string
          fornecedor_id: string
          id?: string
          observacoes?: string | null
          prazo_entrega_dias?: number | null
          prazo_pagamento_dias?: number | null
          ranking?: number | null
          registrado_em?: string
          registrado_por?: string | null
          score?: number | null
          validade_dias?: number | null
          valor_frete?: number
          valor_total?: number
        }
        Update: {
          condicoes_pagamento?: string | null
          cotacao_fornecedor_id?: string
          cotacao_id?: string
          fornecedor_id?: string
          id?: string
          observacoes?: string | null
          prazo_entrega_dias?: number | null
          prazo_pagamento_dias?: number | null
          ranking?: number | null
          registrado_em?: string
          registrado_por?: string | null
          score?: number | null
          validade_dias?: number | null
          valor_frete?: number
          valor_total?: number
        }
        Relationships: [
          {
            foreignKeyName: "cotacao_proposta_cotacao_fornecedor_id_fkey"
            columns: ["cotacao_fornecedor_id"]
            isOneToOne: false
            referencedRelation: "cotacao_fornecedor"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cotacao_proposta_cotacao_id_fkey"
            columns: ["cotacao_id"]
            isOneToOne: false
            referencedRelation: "cotacao"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cotacao_proposta_fornecedor_id_fkey"
            columns: ["fornecedor_id"]
            isOneToOne: false
            referencedRelation: "fornecedor"
            referencedColumns: ["id"]
          },
        ]
      }
      cotacao_proposta_item: {
        Row: {
          cotacao_item_id: string
          desconto_pct: number | null
          id: string
          ipi_pct: number | null
          marca: string | null
          observacoes: string | null
          preco_unitario: number
          proposta_id: string
        }
        Insert: {
          cotacao_item_id: string
          desconto_pct?: number | null
          id?: string
          ipi_pct?: number | null
          marca?: string | null
          observacoes?: string | null
          preco_unitario?: number
          proposta_id: string
        }
        Update: {
          cotacao_item_id?: string
          desconto_pct?: number | null
          id?: string
          ipi_pct?: number | null
          marca?: string | null
          observacoes?: string | null
          preco_unitario?: number
          proposta_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cotacao_proposta_item_cotacao_item_id_fkey"
            columns: ["cotacao_item_id"]
            isOneToOne: false
            referencedRelation: "cotacao_item"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cotacao_proposta_item_proposta_id_fkey"
            columns: ["proposta_id"]
            isOneToOne: false
            referencedRelation: "cotacao_proposta"
            referencedColumns: ["id"]
          },
        ]
      }
      cotacao_rc: {
        Row: {
          cotacao_id: string
          requisicao_id: string
        }
        Insert: {
          cotacao_id: string
          requisicao_id: string
        }
        Update: {
          cotacao_id?: string
          requisicao_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cotacao_rc_cotacao_id_fkey"
            columns: ["cotacao_id"]
            isOneToOne: false
            referencedRelation: "cotacao"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cotacao_rc_requisicao_id_fkey"
            columns: ["requisicao_id"]
            isOneToOne: false
            referencedRelation: "requisicao_compra"
            referencedColumns: ["id"]
          },
        ]
      }
      cronograma_faturamento: {
        Row: {
          competencia: string
          contrato_id: string
          created_at: string
          data_emissao_prevista: string | null
          data_recebimento_previsto: string | null
          empresa_id: string
          id: string
          numero_nf: string | null
          observacoes: string | null
          orcamento_contrato_id: string | null
          status: Database["public"]["Enums"]["cronograma_status"]
          updated_at: string
          valor_emitido: number
          valor_previsto: number
          valor_recebido: number
        }
        Insert: {
          competencia: string
          contrato_id: string
          created_at?: string
          data_emissao_prevista?: string | null
          data_recebimento_previsto?: string | null
          empresa_id: string
          id?: string
          numero_nf?: string | null
          observacoes?: string | null
          orcamento_contrato_id?: string | null
          status?: Database["public"]["Enums"]["cronograma_status"]
          updated_at?: string
          valor_emitido?: number
          valor_previsto?: number
          valor_recebido?: number
        }
        Update: {
          competencia?: string
          contrato_id?: string
          created_at?: string
          data_emissao_prevista?: string | null
          data_recebimento_previsto?: string | null
          empresa_id?: string
          id?: string
          numero_nf?: string | null
          observacoes?: string | null
          orcamento_contrato_id?: string | null
          status?: Database["public"]["Enums"]["cronograma_status"]
          updated_at?: string
          valor_emitido?: number
          valor_previsto?: number
          valor_recebido?: number
        }
        Relationships: [
          {
            foreignKeyName: "cronograma_faturamento_contrato_id_fkey"
            columns: ["contrato_id"]
            isOneToOne: false
            referencedRelation: "contrato"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cronograma_faturamento_orcamento_contrato_id_fkey"
            columns: ["orcamento_contrato_id"]
            isOneToOne: false
            referencedRelation: "orcamento_contrato"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cronograma_faturamento_orcamento_contrato_id_fkey"
            columns: ["orcamento_contrato_id"]
            isOneToOne: false
            referencedRelation: "vw_dre_contrato"
            referencedColumns: ["orcamento_contrato_id"]
          },
        ]
      }
      dre_linhas: {
        Row: {
          ativo: boolean
          codigo: string
          created_at: string
          descricao: string
          empresa_id: string | null
          id: string
          natureza: Database["public"]["Enums"]["dre_natureza"]
          nivel: number
          ordem: number
          parent_id: string | null
          updated_at: string
        }
        Insert: {
          ativo?: boolean
          codigo: string
          created_at?: string
          descricao: string
          empresa_id?: string | null
          id?: string
          natureza: Database["public"]["Enums"]["dre_natureza"]
          nivel?: number
          ordem?: number
          parent_id?: string | null
          updated_at?: string
        }
        Update: {
          ativo?: boolean
          codigo?: string
          created_at?: string
          descricao?: string
          empresa_id?: string | null
          id?: string
          natureza?: Database["public"]["Enums"]["dre_natureza"]
          nivel?: number
          ordem?: number
          parent_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "dre_linhas_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dre_linhas_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "v_ia_contexto_empresa"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "dre_linhas_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "vw_bi_resumo_empresa"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "dre_linhas_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "dre_linhas"
            referencedColumns: ["id"]
          },
        ]
      }
      empresa_fiscal_config: {
        Row: {
          aliq_cofins: number | null
          aliq_csll_presuncao: number | null
          aliq_irpj_presuncao: number | null
          aliq_iss: number | null
          aliq_pis: number | null
          aliq_simples_efetiva: number | null
          ambiente: Database["public"]["Enums"]["nfsai_ambiente"]
          anexo_simples: string | null
          cnae_principal: string | null
          created_at: string
          empresa_id: string
          faixa_simples: number | null
          id: string
          inscricao_estadual: string | null
          inscricao_municipal: string | null
          nfe_provedor: string | null
          nfe_proximo_numero: number | null
          nfe_serie: string | null
          nfse_provedor: string | null
          nfse_proximo_numero: number | null
          nfse_serie: string | null
          nfse_token_secret_name: string | null
          regime: Database["public"]["Enums"]["regime_tributario"]
          updated_at: string
        }
        Insert: {
          aliq_cofins?: number | null
          aliq_csll_presuncao?: number | null
          aliq_irpj_presuncao?: number | null
          aliq_iss?: number | null
          aliq_pis?: number | null
          aliq_simples_efetiva?: number | null
          ambiente?: Database["public"]["Enums"]["nfsai_ambiente"]
          anexo_simples?: string | null
          cnae_principal?: string | null
          created_at?: string
          empresa_id: string
          faixa_simples?: number | null
          id?: string
          inscricao_estadual?: string | null
          inscricao_municipal?: string | null
          nfe_provedor?: string | null
          nfe_proximo_numero?: number | null
          nfe_serie?: string | null
          nfse_provedor?: string | null
          nfse_proximo_numero?: number | null
          nfse_serie?: string | null
          nfse_token_secret_name?: string | null
          regime?: Database["public"]["Enums"]["regime_tributario"]
          updated_at?: string
        }
        Update: {
          aliq_cofins?: number | null
          aliq_csll_presuncao?: number | null
          aliq_irpj_presuncao?: number | null
          aliq_iss?: number | null
          aliq_pis?: number | null
          aliq_simples_efetiva?: number | null
          ambiente?: Database["public"]["Enums"]["nfsai_ambiente"]
          anexo_simples?: string | null
          cnae_principal?: string | null
          created_at?: string
          empresa_id?: string
          faixa_simples?: number | null
          id?: string
          inscricao_estadual?: string | null
          inscricao_municipal?: string | null
          nfe_provedor?: string | null
          nfe_proximo_numero?: number | null
          nfe_serie?: string | null
          nfse_provedor?: string | null
          nfse_proximo_numero?: number | null
          nfse_serie?: string | null
          nfse_token_secret_name?: string | null
          regime?: Database["public"]["Enums"]["regime_tributario"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "empresa_fiscal_config_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: true
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "empresa_fiscal_config_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: true
            referencedRelation: "v_ia_contexto_empresa"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "empresa_fiscal_config_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: true
            referencedRelation: "vw_bi_resumo_empresa"
            referencedColumns: ["empresa_id"]
          },
        ]
      }
      empresas: {
        Row: {
          ativa: boolean
          auto_aprovar_orcamento_cc: boolean
          cnpj: string
          codigo: string
          created_at: string
          diretor_user_id: string | null
          id: string
          nome_fantasia: string | null
          razao_social: string
          regime: Database["public"]["Enums"]["regime_tributario"]
          updated_at: string
          vincular_orcamento_padrao: boolean
        }
        Insert: {
          ativa?: boolean
          auto_aprovar_orcamento_cc?: boolean
          cnpj: string
          codigo: string
          created_at?: string
          diretor_user_id?: string | null
          id?: string
          nome_fantasia?: string | null
          razao_social: string
          regime: Database["public"]["Enums"]["regime_tributario"]
          updated_at?: string
          vincular_orcamento_padrao?: boolean
        }
        Update: {
          ativa?: boolean
          auto_aprovar_orcamento_cc?: boolean
          cnpj?: string
          codigo?: string
          created_at?: string
          diretor_user_id?: string | null
          id?: string
          nome_fantasia?: string | null
          razao_social?: string
          regime?: Database["public"]["Enums"]["regime_tributario"]
          updated_at?: string
          vincular_orcamento_padrao?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "empresas_diretor_user_id_fkey"
            columns: ["diretor_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      estoque_lote: {
        Row: {
          ativo: boolean
          created_at: string
          custo_unitario: number
          data_fabricacao: string | null
          data_validade: string | null
          empresa_id: string
          fornecedor_id: string | null
          id: string
          nf_numero: string | null
          numero_lote: string
          observacoes: string | null
          produto_id: string
          updated_at: string
        }
        Insert: {
          ativo?: boolean
          created_at?: string
          custo_unitario?: number
          data_fabricacao?: string | null
          data_validade?: string | null
          empresa_id: string
          fornecedor_id?: string | null
          id?: string
          nf_numero?: string | null
          numero_lote: string
          observacoes?: string | null
          produto_id: string
          updated_at?: string
        }
        Update: {
          ativo?: boolean
          created_at?: string
          custo_unitario?: number
          data_fabricacao?: string | null
          data_validade?: string | null
          empresa_id?: string
          fornecedor_id?: string | null
          id?: string
          nf_numero?: string | null
          numero_lote?: string
          observacoes?: string | null
          produto_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "estoque_lote_fornecedor_id_fkey"
            columns: ["fornecedor_id"]
            isOneToOne: false
            referencedRelation: "fornecedor"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "estoque_lote_produto_id_fkey"
            columns: ["produto_id"]
            isOneToOne: false
            referencedRelation: "produto"
            referencedColumns: ["id"]
          },
        ]
      }
      estoque_movimento: {
        Row: {
          almoxarifado_destino_id: string | null
          almoxarifado_id: string
          centro_custo_id: string | null
          contrato_id: string | null
          created_at: string
          custo_unitario: number
          data_movimento: string
          documento: string | null
          empresa_id: string
          id: string
          justificativa_negativo: string | null
          lote_id: string | null
          observacoes: string | null
          origem: Database["public"]["Enums"]["estoque_mov_origem"]
          origem_id: string | null
          permitiu_negativo: boolean
          produto_id: string
          quantidade: number
          tipo: Database["public"]["Enums"]["estoque_mov_tipo"]
          user_id: string | null
          valor_total: number | null
        }
        Insert: {
          almoxarifado_destino_id?: string | null
          almoxarifado_id: string
          centro_custo_id?: string | null
          contrato_id?: string | null
          created_at?: string
          custo_unitario?: number
          data_movimento?: string
          documento?: string | null
          empresa_id: string
          id?: string
          justificativa_negativo?: string | null
          lote_id?: string | null
          observacoes?: string | null
          origem: Database["public"]["Enums"]["estoque_mov_origem"]
          origem_id?: string | null
          permitiu_negativo?: boolean
          produto_id: string
          quantidade: number
          tipo: Database["public"]["Enums"]["estoque_mov_tipo"]
          user_id?: string | null
          valor_total?: number | null
        }
        Update: {
          almoxarifado_destino_id?: string | null
          almoxarifado_id?: string
          centro_custo_id?: string | null
          contrato_id?: string | null
          created_at?: string
          custo_unitario?: number
          data_movimento?: string
          documento?: string | null
          empresa_id?: string
          id?: string
          justificativa_negativo?: string | null
          lote_id?: string | null
          observacoes?: string | null
          origem?: Database["public"]["Enums"]["estoque_mov_origem"]
          origem_id?: string | null
          permitiu_negativo?: boolean
          produto_id?: string
          quantidade?: number
          tipo?: Database["public"]["Enums"]["estoque_mov_tipo"]
          user_id?: string | null
          valor_total?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "estoque_movimento_almoxarifado_destino_id_fkey"
            columns: ["almoxarifado_destino_id"]
            isOneToOne: false
            referencedRelation: "almoxarifado"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "estoque_movimento_almoxarifado_id_fkey"
            columns: ["almoxarifado_id"]
            isOneToOne: false
            referencedRelation: "almoxarifado"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "estoque_movimento_centro_custo_id_fkey"
            columns: ["centro_custo_id"]
            isOneToOne: false
            referencedRelation: "centros_custo"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "estoque_movimento_contrato_id_fkey"
            columns: ["contrato_id"]
            isOneToOne: false
            referencedRelation: "contrato"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "estoque_movimento_lote_id_fkey"
            columns: ["lote_id"]
            isOneToOne: false
            referencedRelation: "estoque_lote"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "estoque_movimento_produto_id_fkey"
            columns: ["produto_id"]
            isOneToOne: false
            referencedRelation: "produto"
            referencedColumns: ["id"]
          },
        ]
      }
      estoque_reserva: {
        Row: {
          almoxarifado_id: string
          contrato_id: string | null
          created_at: string
          empresa_id: string
          id: string
          liberado_em: string | null
          liberado_por: string | null
          lote_id: string | null
          observacoes: string | null
          produto_id: string
          quantidade: number
          requisicao_id: string | null
          reservado_em: string
          reservado_por: string | null
          status: string
          updated_at: string
        }
        Insert: {
          almoxarifado_id: string
          contrato_id?: string | null
          created_at?: string
          empresa_id: string
          id?: string
          liberado_em?: string | null
          liberado_por?: string | null
          lote_id?: string | null
          observacoes?: string | null
          produto_id: string
          quantidade: number
          requisicao_id?: string | null
          reservado_em?: string
          reservado_por?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          almoxarifado_id?: string
          contrato_id?: string | null
          created_at?: string
          empresa_id?: string
          id?: string
          liberado_em?: string | null
          liberado_por?: string | null
          lote_id?: string | null
          observacoes?: string | null
          produto_id?: string
          quantidade?: number
          requisicao_id?: string | null
          reservado_em?: string
          reservado_por?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "estoque_reserva_almoxarifado_id_fkey"
            columns: ["almoxarifado_id"]
            isOneToOne: false
            referencedRelation: "almoxarifado"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "estoque_reserva_contrato_id_fkey"
            columns: ["contrato_id"]
            isOneToOne: false
            referencedRelation: "contrato"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "estoque_reserva_lote_id_fkey"
            columns: ["lote_id"]
            isOneToOne: false
            referencedRelation: "estoque_lote"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "estoque_reserva_produto_id_fkey"
            columns: ["produto_id"]
            isOneToOne: false
            referencedRelation: "produto"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "estoque_reserva_requisicao_id_fkey"
            columns: ["requisicao_id"]
            isOneToOne: false
            referencedRelation: "requisicao_compra"
            referencedColumns: ["id"]
          },
        ]
      }
      estoque_saldo: {
        Row: {
          almoxarifado_id: string
          created_at: string
          custo_unitario: number
          empresa_id: string
          id: string
          lote_id: string | null
          produto_id: string
          quantidade: number
          quantidade_reservada: number
          ultima_movimentacao: string | null
          updated_at: string
          valor_total: number | null
        }
        Insert: {
          almoxarifado_id: string
          created_at?: string
          custo_unitario?: number
          empresa_id: string
          id?: string
          lote_id?: string | null
          produto_id: string
          quantidade?: number
          quantidade_reservada?: number
          ultima_movimentacao?: string | null
          updated_at?: string
          valor_total?: number | null
        }
        Update: {
          almoxarifado_id?: string
          created_at?: string
          custo_unitario?: number
          empresa_id?: string
          id?: string
          lote_id?: string | null
          produto_id?: string
          quantidade?: number
          quantidade_reservada?: number
          ultima_movimentacao?: string | null
          updated_at?: string
          valor_total?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "estoque_saldo_almoxarifado_id_fkey"
            columns: ["almoxarifado_id"]
            isOneToOne: false
            referencedRelation: "almoxarifado"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "estoque_saldo_lote_id_fkey"
            columns: ["lote_id"]
            isOneToOne: false
            referencedRelation: "estoque_lote"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "estoque_saldo_produto_id_fkey"
            columns: ["produto_id"]
            isOneToOne: false
            referencedRelation: "produto"
            referencedColumns: ["id"]
          },
        ]
      }
      extrato_bancario: {
        Row: {
          arquivo_origem_id: string | null
          conciliado_em: string | null
          conciliado_por: string | null
          conta_bancaria_id: string
          contraparte_documento: string | null
          contraparte_nome: string | null
          created_at: string
          data_lancamento: string
          data_movimento: string | null
          descricao: string | null
          documento: string | null
          empresa_id: string
          hash_linha: string | null
          historico_codigo: string | null
          id: string
          observacoes: string | null
          origem: string | null
          raw: Json | null
          saldo_apos: number | null
          status_conciliacao: Database["public"]["Enums"]["extrato_status_conciliacao"]
          tipo: Database["public"]["Enums"]["extrato_tipo"]
          titulo_pagar_id: string | null
          titulo_receber_id: string | null
          valor: number
        }
        Insert: {
          arquivo_origem_id?: string | null
          conciliado_em?: string | null
          conciliado_por?: string | null
          conta_bancaria_id: string
          contraparte_documento?: string | null
          contraparte_nome?: string | null
          created_at?: string
          data_lancamento: string
          data_movimento?: string | null
          descricao?: string | null
          documento?: string | null
          empresa_id: string
          hash_linha?: string | null
          historico_codigo?: string | null
          id?: string
          observacoes?: string | null
          origem?: string | null
          raw?: Json | null
          saldo_apos?: number | null
          status_conciliacao?: Database["public"]["Enums"]["extrato_status_conciliacao"]
          tipo: Database["public"]["Enums"]["extrato_tipo"]
          titulo_pagar_id?: string | null
          titulo_receber_id?: string | null
          valor: number
        }
        Update: {
          arquivo_origem_id?: string | null
          conciliado_em?: string | null
          conciliado_por?: string | null
          conta_bancaria_id?: string
          contraparte_documento?: string | null
          contraparte_nome?: string | null
          created_at?: string
          data_lancamento?: string
          data_movimento?: string | null
          descricao?: string | null
          documento?: string | null
          empresa_id?: string
          hash_linha?: string | null
          historico_codigo?: string | null
          id?: string
          observacoes?: string | null
          origem?: string | null
          raw?: Json | null
          saldo_apos?: number | null
          status_conciliacao?: Database["public"]["Enums"]["extrato_status_conciliacao"]
          tipo?: Database["public"]["Enums"]["extrato_tipo"]
          titulo_pagar_id?: string | null
          titulo_receber_id?: string | null
          valor?: number
        }
        Relationships: [
          {
            foreignKeyName: "extrato_bancario_conta_bancaria_id_fkey"
            columns: ["conta_bancaria_id"]
            isOneToOne: false
            referencedRelation: "conta_bancaria"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "extrato_bancario_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "extrato_bancario_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "v_ia_contexto_empresa"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "extrato_bancario_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "vw_bi_resumo_empresa"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "extrato_bancario_titulo_pagar_id_fkey"
            columns: ["titulo_pagar_id"]
            isOneToOne: false
            referencedRelation: "titulo_pagar"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "extrato_bancario_titulo_receber_id_fkey"
            columns: ["titulo_receber_id"]
            isOneToOne: false
            referencedRelation: "titulo_receber"
            referencedColumns: ["id"]
          },
        ]
      }
      fcr_batch: {
        Row: {
          aprovado_em: string | null
          aprovado_por: string | null
          arquivo_origem: string
          chunk_atual: number
          chunks_total: number | null
          created_at: string
          criado_por: string
          empresa_id: string | null
          escopo_carga: string
          id: string
          linhas_inseridas: number
          linhas_lidas: number
          modo: string
          observacao: string | null
          parse_finalizado_em: string | null
          parse_iniciado_em: string | null
          revertido_em: string | null
          revertido_por: string | null
          saldos_finais_reconciliacao: Json | null
          status: string
          storage_path: string
          totais_excel: Json | null
          totais_promovidos: Json | null
          ultimo_erro: string | null
          updated_at: string
        }
        Insert: {
          aprovado_em?: string | null
          aprovado_por?: string | null
          arquivo_origem: string
          chunk_atual?: number
          chunks_total?: number | null
          created_at?: string
          criado_por: string
          empresa_id?: string | null
          escopo_carga: string
          id?: string
          linhas_inseridas?: number
          linhas_lidas?: number
          modo: string
          observacao?: string | null
          parse_finalizado_em?: string | null
          parse_iniciado_em?: string | null
          revertido_em?: string | null
          revertido_por?: string | null
          saldos_finais_reconciliacao?: Json | null
          status?: string
          storage_path: string
          totais_excel?: Json | null
          totais_promovidos?: Json | null
          ultimo_erro?: string | null
          updated_at?: string
        }
        Update: {
          aprovado_em?: string | null
          aprovado_por?: string | null
          arquivo_origem?: string
          chunk_atual?: number
          chunks_total?: number | null
          created_at?: string
          criado_por?: string
          empresa_id?: string | null
          escopo_carga?: string
          id?: string
          linhas_inseridas?: number
          linhas_lidas?: number
          modo?: string
          observacao?: string | null
          parse_finalizado_em?: string | null
          parse_iniciado_em?: string | null
          revertido_em?: string | null
          revertido_por?: string | null
          saldos_finais_reconciliacao?: Json | null
          status?: string
          storage_path?: string
          totais_excel?: Json | null
          totais_promovidos?: Json | null
          ultimo_erro?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fcr_batch_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fcr_batch_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "v_ia_contexto_empresa"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "fcr_batch_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "vw_bi_resumo_empresa"
            referencedColumns: ["empresa_id"]
          },
        ]
      }
      fcr_parse_chunk_erro: {
        Row: {
          batch_id: string
          chunk_idx: number
          criado_em: string
          erro_msg: string
          id: string
          linha_fim: number
          linha_inicio: number
          tentativa: number
        }
        Insert: {
          batch_id: string
          chunk_idx: number
          criado_em?: string
          erro_msg: string
          id?: string
          linha_fim: number
          linha_inicio: number
          tentativa: number
        }
        Update: {
          batch_id?: string
          chunk_idx?: number
          criado_em?: string
          erro_msg?: string
          id?: string
          linha_fim?: number
          linha_inicio?: number
          tentativa?: number
        }
        Relationships: [
          {
            foreignKeyName: "fcr_parse_chunk_erro_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "fcr_batch"
            referencedColumns: ["id"]
          },
        ]
      }
      fcr_raw_excel: {
        Row: {
          aba_origem: string
          arquivo_origem: string
          banco_origem_texto: string | null
          batch_id: string
          bloco_funcional: string
          cabecalho_coluna: string | null
          classificacao_excel_original: string | null
          coluna_origem: number
          conta_origem_texto: string | null
          created_at: string
          data_caixa_derivada: string | null
          empresa_id_origem_celula: string | null
          empresa_id_resolvida: string | null
          endereco_celula: string
          fora_do_periodo: boolean
          hash_idempotencia: string
          historico_original: string | null
          id: string
          id_origem_texto: string | null
          linha_origem: number
          par_transferencia_id: string | null
          raw_json: Json | null
          status_resolucao_empresa: string
          tipo_linha: string
          updated_at: string
          valor_assinado_caixa: number | null
          valor_celula_texto: string | null
          valor_numerico: number | null
        }
        Insert: {
          aba_origem: string
          arquivo_origem: string
          banco_origem_texto?: string | null
          batch_id: string
          bloco_funcional?: string
          cabecalho_coluna?: string | null
          classificacao_excel_original?: string | null
          coluna_origem: number
          conta_origem_texto?: string | null
          created_at?: string
          data_caixa_derivada?: string | null
          empresa_id_origem_celula?: string | null
          empresa_id_resolvida?: string | null
          endereco_celula: string
          fora_do_periodo?: boolean
          hash_idempotencia: string
          historico_original?: string | null
          id?: string
          id_origem_texto?: string | null
          linha_origem: number
          par_transferencia_id?: string | null
          raw_json?: Json | null
          status_resolucao_empresa?: string
          tipo_linha?: string
          updated_at?: string
          valor_assinado_caixa?: number | null
          valor_celula_texto?: string | null
          valor_numerico?: number | null
        }
        Update: {
          aba_origem?: string
          arquivo_origem?: string
          banco_origem_texto?: string | null
          batch_id?: string
          bloco_funcional?: string
          cabecalho_coluna?: string | null
          classificacao_excel_original?: string | null
          coluna_origem?: number
          conta_origem_texto?: string | null
          created_at?: string
          data_caixa_derivada?: string | null
          empresa_id_origem_celula?: string | null
          empresa_id_resolvida?: string | null
          endereco_celula?: string
          fora_do_periodo?: boolean
          hash_idempotencia?: string
          historico_original?: string | null
          id?: string
          id_origem_texto?: string | null
          linha_origem?: number
          par_transferencia_id?: string | null
          raw_json?: Json | null
          status_resolucao_empresa?: string
          tipo_linha?: string
          updated_at?: string
          valor_assinado_caixa?: number | null
          valor_celula_texto?: string | null
          valor_numerico?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "fcr_raw_excel_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "fcr_batch"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fcr_raw_excel_empresa_id_resolvida_fkey"
            columns: ["empresa_id_resolvida"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fcr_raw_excel_empresa_id_resolvida_fkey"
            columns: ["empresa_id_resolvida"]
            isOneToOne: false
            referencedRelation: "v_ia_contexto_empresa"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "fcr_raw_excel_empresa_id_resolvida_fkey"
            columns: ["empresa_id_resolvida"]
            isOneToOne: false
            referencedRelation: "vw_bi_resumo_empresa"
            referencedColumns: ["empresa_id"]
          },
        ]
      }
      fcr_reconciliacao_lote: {
        Row: {
          batch_id: string
          chave: string
          created_at: string
          diferenca: number | null
          empresa_id: string | null
          escopo: string
          id: string
          qtd_linhas_excel: number
          qtd_linhas_sistema: number
          qtd_pendencias: number
          valor_excel: number
          valor_sistema: number
        }
        Insert: {
          batch_id: string
          chave: string
          created_at?: string
          diferenca?: number | null
          empresa_id?: string | null
          escopo: string
          id?: string
          qtd_linhas_excel?: number
          qtd_linhas_sistema?: number
          qtd_pendencias?: number
          valor_excel?: number
          valor_sistema?: number
        }
        Update: {
          batch_id?: string
          chave?: string
          created_at?: string
          diferenca?: number | null
          empresa_id?: string | null
          escopo?: string
          id?: string
          qtd_linhas_excel?: number
          qtd_linhas_sistema?: number
          qtd_pendencias?: number
          valor_excel?: number
          valor_sistema?: number
        }
        Relationships: [
          {
            foreignKeyName: "fcr_reconciliacao_lote_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "fcr_batch"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fcr_reconciliacao_lote_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fcr_reconciliacao_lote_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "v_ia_contexto_empresa"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "fcr_reconciliacao_lote_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "vw_bi_resumo_empresa"
            referencedColumns: ["empresa_id"]
          },
        ]
      }
      fcr_sugestoes_pendencias: {
        Row: {
          batch_id: string
          classificacao_excel_original: string | null
          created_at: string
          data_caixa: string | null
          destino_proposto: string | null
          empresa_id: string | null
          historico_original: string | null
          id: string
          motivo: string | null
          raw_id: string
          resolvido_em: string | null
          resolvido_por: string | null
          status: string
          sugestao_conta_contabil_id: string | null
          sugestao_dre_linha_id: string | null
          tipo_pendencia: string
          updated_at: string
          valor_original: number | null
        }
        Insert: {
          batch_id: string
          classificacao_excel_original?: string | null
          created_at?: string
          data_caixa?: string | null
          destino_proposto?: string | null
          empresa_id?: string | null
          historico_original?: string | null
          id?: string
          motivo?: string | null
          raw_id: string
          resolvido_em?: string | null
          resolvido_por?: string | null
          status?: string
          sugestao_conta_contabil_id?: string | null
          sugestao_dre_linha_id?: string | null
          tipo_pendencia: string
          updated_at?: string
          valor_original?: number | null
        }
        Update: {
          batch_id?: string
          classificacao_excel_original?: string | null
          created_at?: string
          data_caixa?: string | null
          destino_proposto?: string | null
          empresa_id?: string | null
          historico_original?: string | null
          id?: string
          motivo?: string | null
          raw_id?: string
          resolvido_em?: string | null
          resolvido_por?: string | null
          status?: string
          sugestao_conta_contabil_id?: string | null
          sugestao_dre_linha_id?: string | null
          tipo_pendencia?: string
          updated_at?: string
          valor_original?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "fcr_sugestoes_pendencias_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "fcr_batch"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fcr_sugestoes_pendencias_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fcr_sugestoes_pendencias_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "v_ia_contexto_empresa"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "fcr_sugestoes_pendencias_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "vw_bi_resumo_empresa"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "fcr_sugestoes_pendencias_raw_id_fkey"
            columns: ["raw_id"]
            isOneToOne: false
            referencedRelation: "fcr_raw_excel"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fcr_sugestoes_pendencias_sugestao_conta_contabil_id_fkey"
            columns: ["sugestao_conta_contabil_id"]
            isOneToOne: false
            referencedRelation: "conta_contabil"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fcr_sugestoes_pendencias_sugestao_dre_linha_id_fkey"
            columns: ["sugestao_dre_linha_id"]
            isOneToOne: false
            referencedRelation: "dre_linhas"
            referencedColumns: ["id"]
          },
        ]
      }
      financeiro_pagamento_aprovacao: {
        Row: {
          aprovador_id: string | null
          created_at: string
          data_pagamento_aprovada: string | null
          decidido_em: string | null
          decisao: Database["public"]["Enums"]["aprov_decisao"]
          empresa_id: string
          etapa: number
          id: string
          justificativa: string | null
          programacao_id: string
          updated_at: string
          valor_aprovado: number | null
        }
        Insert: {
          aprovador_id?: string | null
          created_at?: string
          data_pagamento_aprovada?: string | null
          decidido_em?: string | null
          decisao?: Database["public"]["Enums"]["aprov_decisao"]
          empresa_id: string
          etapa?: number
          id?: string
          justificativa?: string | null
          programacao_id: string
          updated_at?: string
          valor_aprovado?: number | null
        }
        Update: {
          aprovador_id?: string | null
          created_at?: string
          data_pagamento_aprovada?: string | null
          decidido_em?: string | null
          decisao?: Database["public"]["Enums"]["aprov_decisao"]
          empresa_id?: string
          etapa?: number
          id?: string
          justificativa?: string | null
          programacao_id?: string
          updated_at?: string
          valor_aprovado?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "financeiro_pagamento_aprovacao_programacao_id_fkey"
            columns: ["programacao_id"]
            isOneToOne: false
            referencedRelation: "malote_pagamento"
            referencedColumns: ["id"]
          },
        ]
      }
      financeiro_pagamento_log: {
        Row: {
          acao: string
          created_at: string
          detalhes: Json | null
          empresa_id: string
          id: string
          programacao_id: string | null
          titulo_pagar_id: string | null
          usuario_id: string | null
        }
        Insert: {
          acao: string
          created_at?: string
          detalhes?: Json | null
          empresa_id: string
          id?: string
          programacao_id?: string | null
          titulo_pagar_id?: string | null
          usuario_id?: string | null
        }
        Update: {
          acao?: string
          created_at?: string
          detalhes?: Json | null
          empresa_id?: string
          id?: string
          programacao_id?: string | null
          titulo_pagar_id?: string | null
          usuario_id?: string | null
        }
        Relationships: []
      }
      financeiro_pagamento_validacao: {
        Row: {
          baixa_confirmada: boolean | null
          comprovante_anexado: boolean | null
          conta_bancaria_confere: boolean | null
          created_at: string
          data_confere: boolean | null
          data_paga: string | null
          data_programada: string | null
          divergencia: string | null
          empresa_id: string
          fornecedor_confere: boolean | null
          id: string
          movimento_bancario_id: string | null
          programacao_id: string | null
          revisado_em: string | null
          revisado_por: string | null
          status_conciliacao: string | null
          status_validacao: Database["public"]["Enums"]["validacao_status"]
          titulo_pagar_id: string
          tratativa: string | null
          updated_at: string
          validado_em: string | null
          validado_por: string | null
          valor_aprovado: number | null
          valor_confere: boolean | null
          valor_pago: number | null
        }
        Insert: {
          baixa_confirmada?: boolean | null
          comprovante_anexado?: boolean | null
          conta_bancaria_confere?: boolean | null
          created_at?: string
          data_confere?: boolean | null
          data_paga?: string | null
          data_programada?: string | null
          divergencia?: string | null
          empresa_id: string
          fornecedor_confere?: boolean | null
          id?: string
          movimento_bancario_id?: string | null
          programacao_id?: string | null
          revisado_em?: string | null
          revisado_por?: string | null
          status_conciliacao?: string | null
          status_validacao?: Database["public"]["Enums"]["validacao_status"]
          titulo_pagar_id: string
          tratativa?: string | null
          updated_at?: string
          validado_em?: string | null
          validado_por?: string | null
          valor_aprovado?: number | null
          valor_confere?: boolean | null
          valor_pago?: number | null
        }
        Update: {
          baixa_confirmada?: boolean | null
          comprovante_anexado?: boolean | null
          conta_bancaria_confere?: boolean | null
          created_at?: string
          data_confere?: boolean | null
          data_paga?: string | null
          data_programada?: string | null
          divergencia?: string | null
          empresa_id?: string
          fornecedor_confere?: boolean | null
          id?: string
          movimento_bancario_id?: string | null
          programacao_id?: string | null
          revisado_em?: string | null
          revisado_por?: string | null
          status_conciliacao?: string | null
          status_validacao?: Database["public"]["Enums"]["validacao_status"]
          titulo_pagar_id?: string
          tratativa?: string | null
          updated_at?: string
          validado_em?: string | null
          validado_por?: string | null
          valor_aprovado?: number | null
          valor_confere?: boolean | null
          valor_pago?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "financeiro_pagamento_validacao_movimento_bancario_id_fkey"
            columns: ["movimento_bancario_id"]
            isOneToOne: false
            referencedRelation: "movimento_bancario"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "financeiro_pagamento_validacao_programacao_id_fkey"
            columns: ["programacao_id"]
            isOneToOne: false
            referencedRelation: "malote_pagamento"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "financeiro_pagamento_validacao_titulo_pagar_id_fkey"
            columns: ["titulo_pagar_id"]
            isOneToOne: true
            referencedRelation: "titulo_pagar"
            referencedColumns: ["id"]
          },
        ]
      }
      fluxo_caixa_projetado: {
        Row: {
          batch_id: string | null
          contrato_id: string | null
          created_at: string
          data_prevista: string
          descricao: string | null
          empresa_id: string
          hash_dedup: string | null
          id: string
          orcamento_contrato_id: string | null
          origem: string | null
          tipo: Database["public"]["Enums"]["fluxo_tipo"]
          updated_at: string
          valor: number
        }
        Insert: {
          batch_id?: string | null
          contrato_id?: string | null
          created_at?: string
          data_prevista: string
          descricao?: string | null
          empresa_id: string
          hash_dedup?: string | null
          id?: string
          orcamento_contrato_id?: string | null
          origem?: string | null
          tipo: Database["public"]["Enums"]["fluxo_tipo"]
          updated_at?: string
          valor?: number
        }
        Update: {
          batch_id?: string | null
          contrato_id?: string | null
          created_at?: string
          data_prevista?: string
          descricao?: string | null
          empresa_id?: string
          hash_dedup?: string | null
          id?: string
          orcamento_contrato_id?: string | null
          origem?: string | null
          tipo?: Database["public"]["Enums"]["fluxo_tipo"]
          updated_at?: string
          valor?: number
        }
        Relationships: [
          {
            foreignKeyName: "fluxo_caixa_projetado_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "integration_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fluxo_caixa_projetado_contrato_id_fkey"
            columns: ["contrato_id"]
            isOneToOne: false
            referencedRelation: "contrato"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fluxo_caixa_projetado_orcamento_contrato_id_fkey"
            columns: ["orcamento_contrato_id"]
            isOneToOne: false
            referencedRelation: "orcamento_contrato"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fluxo_caixa_projetado_orcamento_contrato_id_fkey"
            columns: ["orcamento_contrato_id"]
            isOneToOne: false
            referencedRelation: "vw_dre_contrato"
            referencedColumns: ["orcamento_contrato_id"]
          },
        ]
      }
      folha_evento: {
        Row: {
          centro_custo_id: string | null
          colaborador_id: string | null
          created_at: string
          descricao: string | null
          empresa_id: string
          folha_periodo_id: string
          id: string
          tipo: string
          valor: number
        }
        Insert: {
          centro_custo_id?: string | null
          colaborador_id?: string | null
          created_at?: string
          descricao?: string | null
          empresa_id: string
          folha_periodo_id: string
          id?: string
          tipo: string
          valor?: number
        }
        Update: {
          centro_custo_id?: string | null
          colaborador_id?: string | null
          created_at?: string
          descricao?: string | null
          empresa_id?: string
          folha_periodo_id?: string
          id?: string
          tipo?: string
          valor?: number
        }
        Relationships: [
          {
            foreignKeyName: "folha_evento_centro_custo_id_fkey"
            columns: ["centro_custo_id"]
            isOneToOne: false
            referencedRelation: "centros_custo"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "folha_evento_colaborador_id_fkey"
            columns: ["colaborador_id"]
            isOneToOne: false
            referencedRelation: "colaborador"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "folha_evento_folha_periodo_id_fkey"
            columns: ["folha_periodo_id"]
            isOneToOne: false
            referencedRelation: "folha_periodo"
            referencedColumns: ["id"]
          },
        ]
      }
      folha_periodo: {
        Row: {
          competencia: string
          conta_banco_id: string | null
          created_at: string
          data_encargos: string | null
          data_pagamento: string | null
          data_provisao: string | null
          empresa_id: string
          id: string
          observacoes: string | null
          status: string
          updated_at: string
        }
        Insert: {
          competencia: string
          conta_banco_id?: string | null
          created_at?: string
          data_encargos?: string | null
          data_pagamento?: string | null
          data_provisao?: string | null
          empresa_id: string
          id?: string
          observacoes?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          competencia?: string
          conta_banco_id?: string | null
          created_at?: string
          data_encargos?: string | null
          data_pagamento?: string | null
          data_provisao?: string | null
          empresa_id?: string
          id?: string
          observacoes?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "folha_periodo_conta_banco_id_fkey"
            columns: ["conta_banco_id"]
            isOneToOne: false
            referencedRelation: "conta_bancaria"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "folha_periodo_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "folha_periodo_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "v_ia_contexto_empresa"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "folha_periodo_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "vw_bi_resumo_empresa"
            referencedColumns: ["empresa_id"]
          },
        ]
      }
      fornecedor: {
        Row: {
          ativo: boolean
          bairro: string | null
          cep: string | null
          cidade: string | null
          cnae_principal: string | null
          cnpj_cpf: string
          complemento: string | null
          contato: string | null
          created_at: string
          email: string | null
          empresa_id: string
          endereco: string | null
          id: string
          inscricao_estadual: string | null
          is_global: boolean
          logradouro: string | null
          nome_fantasia: string | null
          numero: string | null
          observacoes: string | null
          pix_chave: string | null
          pix_tipo: string | null
          razao_social: string
          socios: Json
          telefone: string | null
          tipo: Database["public"]["Enums"]["fornecedor_tipo"]
          uf: string | null
          updated_at: string
        }
        Insert: {
          ativo?: boolean
          bairro?: string | null
          cep?: string | null
          cidade?: string | null
          cnae_principal?: string | null
          cnpj_cpf: string
          complemento?: string | null
          contato?: string | null
          created_at?: string
          email?: string | null
          empresa_id: string
          endereco?: string | null
          id?: string
          inscricao_estadual?: string | null
          is_global?: boolean
          logradouro?: string | null
          nome_fantasia?: string | null
          numero?: string | null
          observacoes?: string | null
          pix_chave?: string | null
          pix_tipo?: string | null
          razao_social: string
          socios?: Json
          telefone?: string | null
          tipo?: Database["public"]["Enums"]["fornecedor_tipo"]
          uf?: string | null
          updated_at?: string
        }
        Update: {
          ativo?: boolean
          bairro?: string | null
          cep?: string | null
          cidade?: string | null
          cnae_principal?: string | null
          cnpj_cpf?: string
          complemento?: string | null
          contato?: string | null
          created_at?: string
          email?: string | null
          empresa_id?: string
          endereco?: string | null
          id?: string
          inscricao_estadual?: string | null
          is_global?: boolean
          logradouro?: string | null
          nome_fantasia?: string | null
          numero?: string | null
          observacoes?: string | null
          pix_chave?: string | null
          pix_tipo?: string | null
          razao_social?: string
          socios?: Json
          telefone?: string | null
          tipo?: Database["public"]["Enums"]["fornecedor_tipo"]
          uf?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      fornecedor_conta_bancaria: {
        Row: {
          agencia: string
          agencia_digito: string | null
          ativa: boolean
          banco_codigo: string
          banco_nome: string
          conta: string
          conta_digito: string | null
          created_at: string
          empresa_id: string
          fornecedor_id: string
          id: string
          observacoes: string | null
          pix_chave: string | null
          pix_tipo: string | null
          principal: boolean
          tipo: string
          titular_documento: string | null
          titular_nome: string | null
          updated_at: string
        }
        Insert: {
          agencia: string
          agencia_digito?: string | null
          ativa?: boolean
          banco_codigo: string
          banco_nome: string
          conta: string
          conta_digito?: string | null
          created_at?: string
          empresa_id: string
          fornecedor_id: string
          id?: string
          observacoes?: string | null
          pix_chave?: string | null
          pix_tipo?: string | null
          principal?: boolean
          tipo?: string
          titular_documento?: string | null
          titular_nome?: string | null
          updated_at?: string
        }
        Update: {
          agencia?: string
          agencia_digito?: string | null
          ativa?: boolean
          banco_codigo?: string
          banco_nome?: string
          conta?: string
          conta_digito?: string | null
          created_at?: string
          empresa_id?: string
          fornecedor_id?: string
          id?: string
          observacoes?: string | null
          pix_chave?: string | null
          pix_tipo?: string | null
          principal?: boolean
          tipo?: string
          titular_documento?: string | null
          titular_nome?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fornecedor_conta_bancaria_fornecedor_id_fkey"
            columns: ["fornecedor_id"]
            isOneToOne: false
            referencedRelation: "fornecedor"
            referencedColumns: ["id"]
          },
        ]
      }
      ia_feedback: {
        Row: {
          comentario: string | null
          created_at: string
          id: string
          triagem_id: string
          user_id: string
          util: boolean
        }
        Insert: {
          comentario?: string | null
          created_at?: string
          id?: string
          triagem_id: string
          user_id: string
          util: boolean
        }
        Update: {
          comentario?: string | null
          created_at?: string
          id?: string
          triagem_id?: string
          user_id?: string
          util?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "ia_feedback_triagem_id_fkey"
            columns: ["triagem_id"]
            isOneToOne: false
            referencedRelation: "ia_triagens"
            referencedColumns: ["id"]
          },
        ]
      }
      ia_provedores: {
        Row: {
          ativo: boolean
          base_url: string | null
          codigo: string
          config: Json
          created_at: string
          id: string
          is_default: boolean
          modelo_default: string
          nome: string
          ordem: number
          secret_name: string | null
          updated_at: string
        }
        Insert: {
          ativo?: boolean
          base_url?: string | null
          codigo: string
          config?: Json
          created_at?: string
          id?: string
          is_default?: boolean
          modelo_default: string
          nome: string
          ordem?: number
          secret_name?: string | null
          updated_at?: string
        }
        Update: {
          ativo?: boolean
          base_url?: string | null
          codigo?: string
          config?: Json
          created_at?: string
          id?: string
          is_default?: boolean
          modelo_default?: string
          nome?: string
          ordem?: number
          secret_name?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      ia_triagens: {
        Row: {
          contexto: Json
          created_at: string
          custo_usd: number | null
          duracao_ms: number | null
          empresa_id: string
          erro_msg: string | null
          id: string
          modelo: string
          modulo: string
          prompt: string
          provedor_id: string
          registro_id: string | null
          resposta: string | null
          resposta_estruturada: Json | null
          solicitado_por: string | null
          status: Database["public"]["Enums"]["ia_status"]
          tokens_input: number | null
          tokens_output: number | null
          updated_at: string
        }
        Insert: {
          contexto?: Json
          created_at?: string
          custo_usd?: number | null
          duracao_ms?: number | null
          empresa_id: string
          erro_msg?: string | null
          id?: string
          modelo: string
          modulo: string
          prompt: string
          provedor_id: string
          registro_id?: string | null
          resposta?: string | null
          resposta_estruturada?: Json | null
          solicitado_por?: string | null
          status?: Database["public"]["Enums"]["ia_status"]
          tokens_input?: number | null
          tokens_output?: number | null
          updated_at?: string
        }
        Update: {
          contexto?: Json
          created_at?: string
          custo_usd?: number | null
          duracao_ms?: number | null
          empresa_id?: string
          erro_msg?: string | null
          id?: string
          modelo?: string
          modulo?: string
          prompt?: string
          provedor_id?: string
          registro_id?: string | null
          resposta?: string | null
          resposta_estruturada?: Json | null
          solicitado_por?: string | null
          status?: Database["public"]["Enums"]["ia_status"]
          tokens_input?: number | null
          tokens_output?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ia_triagens_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ia_triagens_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "v_ia_contexto_empresa"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "ia_triagens_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "vw_bi_resumo_empresa"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "ia_triagens_provedor_id_fkey"
            columns: ["provedor_id"]
            isOneToOne: false
            referencedRelation: "ia_provedores"
            referencedColumns: ["id"]
          },
        ]
      }
      identidade_visual: {
        Row: {
          cor_destaque: string | null
          cor_primaria: string | null
          cor_secundaria: string | null
          empresa_id: string
          logo_path: string | null
          nome_empresarial: string | null
          subtitulo: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          cor_destaque?: string | null
          cor_primaria?: string | null
          cor_secundaria?: string | null
          empresa_id: string
          logo_path?: string | null
          nome_empresarial?: string | null
          subtitulo?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          cor_destaque?: string | null
          cor_primaria?: string | null
          cor_secundaria?: string | null
          empresa_id?: string
          logo_path?: string | null
          nome_empresarial?: string | null
          subtitulo?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "identidade_visual_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: true
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "identidade_visual_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: true
            referencedRelation: "v_ia_contexto_empresa"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "identidade_visual_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: true
            referencedRelation: "vw_bi_resumo_empresa"
            referencedColumns: ["empresa_id"]
          },
        ]
      }
      integration_alias_bancos: {
        Row: {
          alias: string
          conta_bancaria_id: string | null
          created_at: string
          empresa_id: string
          id: string
          origem: string | null
          resolvido_em: string | null
          resolvido_por: string | null
          status: Database["public"]["Enums"]["integ_alias_status"]
        }
        Insert: {
          alias: string
          conta_bancaria_id?: string | null
          created_at?: string
          empresa_id: string
          id?: string
          origem?: string | null
          resolvido_em?: string | null
          resolvido_por?: string | null
          status?: Database["public"]["Enums"]["integ_alias_status"]
        }
        Update: {
          alias?: string
          conta_bancaria_id?: string | null
          created_at?: string
          empresa_id?: string
          id?: string
          origem?: string | null
          resolvido_em?: string | null
          resolvido_por?: string | null
          status?: Database["public"]["Enums"]["integ_alias_status"]
        }
        Relationships: [
          {
            foreignKeyName: "integration_alias_bancos_conta_bancaria_id_fkey"
            columns: ["conta_bancaria_id"]
            isOneToOne: false
            referencedRelation: "conta_bancaria"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "integration_alias_bancos_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "integration_alias_bancos_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "v_ia_contexto_empresa"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "integration_alias_bancos_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "vw_bi_resumo_empresa"
            referencedColumns: ["empresa_id"]
          },
        ]
      }
      integration_alias_centros_custo: {
        Row: {
          alias: string
          centro_custo_id: string | null
          created_at: string
          empresa_id: string
          id: string
          origem: string | null
          resolvido_em: string | null
          resolvido_por: string | null
          status: Database["public"]["Enums"]["integ_alias_status"]
        }
        Insert: {
          alias: string
          centro_custo_id?: string | null
          created_at?: string
          empresa_id: string
          id?: string
          origem?: string | null
          resolvido_em?: string | null
          resolvido_por?: string | null
          status?: Database["public"]["Enums"]["integ_alias_status"]
        }
        Update: {
          alias?: string
          centro_custo_id?: string | null
          created_at?: string
          empresa_id?: string
          id?: string
          origem?: string | null
          resolvido_em?: string | null
          resolvido_por?: string | null
          status?: Database["public"]["Enums"]["integ_alias_status"]
        }
        Relationships: [
          {
            foreignKeyName: "integration_alias_centros_custo_centro_custo_id_fkey"
            columns: ["centro_custo_id"]
            isOneToOne: false
            referencedRelation: "centros_custo"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "integration_alias_centros_custo_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "integration_alias_centros_custo_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "v_ia_contexto_empresa"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "integration_alias_centros_custo_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "vw_bi_resumo_empresa"
            referencedColumns: ["empresa_id"]
          },
        ]
      }
      integration_alias_contas_contabeis: {
        Row: {
          alias: string
          conta_contabil_id: string | null
          created_at: string
          empresa_id: string
          id: string
          origem: string | null
          resolvido_em: string | null
          resolvido_por: string | null
          status: Database["public"]["Enums"]["integ_alias_status"]
        }
        Insert: {
          alias: string
          conta_contabil_id?: string | null
          created_at?: string
          empresa_id: string
          id?: string
          origem?: string | null
          resolvido_em?: string | null
          resolvido_por?: string | null
          status?: Database["public"]["Enums"]["integ_alias_status"]
        }
        Update: {
          alias?: string
          conta_contabil_id?: string | null
          created_at?: string
          empresa_id?: string
          id?: string
          origem?: string | null
          resolvido_em?: string | null
          resolvido_por?: string | null
          status?: Database["public"]["Enums"]["integ_alias_status"]
        }
        Relationships: [
          {
            foreignKeyName: "integration_alias_contas_contabeis_conta_contabil_id_fkey"
            columns: ["conta_contabil_id"]
            isOneToOne: false
            referencedRelation: "conta_contabil"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "integration_alias_contas_contabeis_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "integration_alias_contas_contabeis_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "v_ia_contexto_empresa"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "integration_alias_contas_contabeis_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "vw_bi_resumo_empresa"
            referencedColumns: ["empresa_id"]
          },
        ]
      }
      integration_alias_contratos: {
        Row: {
          alias: string
          contrato_id: string | null
          created_at: string
          empresa_id: string
          id: string
          origem: string | null
          resolvido_em: string | null
          resolvido_por: string | null
          status: Database["public"]["Enums"]["integ_alias_status"]
        }
        Insert: {
          alias: string
          contrato_id?: string | null
          created_at?: string
          empresa_id: string
          id?: string
          origem?: string | null
          resolvido_em?: string | null
          resolvido_por?: string | null
          status?: Database["public"]["Enums"]["integ_alias_status"]
        }
        Update: {
          alias?: string
          contrato_id?: string | null
          created_at?: string
          empresa_id?: string
          id?: string
          origem?: string | null
          resolvido_em?: string | null
          resolvido_por?: string | null
          status?: Database["public"]["Enums"]["integ_alias_status"]
        }
        Relationships: [
          {
            foreignKeyName: "integration_alias_contratos_contrato_id_fkey"
            columns: ["contrato_id"]
            isOneToOne: false
            referencedRelation: "contrato"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "integration_alias_contratos_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "integration_alias_contratos_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "v_ia_contexto_empresa"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "integration_alias_contratos_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "vw_bi_resumo_empresa"
            referencedColumns: ["empresa_id"]
          },
        ]
      }
      integration_alias_dre: {
        Row: {
          alias: string
          created_at: string
          dre_linha_id: string | null
          empresa_id: string
          id: string
          origem: string | null
          resolvido_em: string | null
          resolvido_por: string | null
          status: Database["public"]["Enums"]["integ_alias_status"]
        }
        Insert: {
          alias: string
          created_at?: string
          dre_linha_id?: string | null
          empresa_id: string
          id?: string
          origem?: string | null
          resolvido_em?: string | null
          resolvido_por?: string | null
          status?: Database["public"]["Enums"]["integ_alias_status"]
        }
        Update: {
          alias?: string
          created_at?: string
          dre_linha_id?: string | null
          empresa_id?: string
          id?: string
          origem?: string | null
          resolvido_em?: string | null
          resolvido_por?: string | null
          status?: Database["public"]["Enums"]["integ_alias_status"]
        }
        Relationships: [
          {
            foreignKeyName: "integration_alias_dre_dre_linha_id_fkey"
            columns: ["dre_linha_id"]
            isOneToOne: false
            referencedRelation: "dre_linhas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "integration_alias_dre_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "integration_alias_dre_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "v_ia_contexto_empresa"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "integration_alias_dre_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "vw_bi_resumo_empresa"
            referencedColumns: ["empresa_id"]
          },
        ]
      }
      integration_alias_empresas: {
        Row: {
          alias: string
          created_at: string
          empresa_alvo_id: string | null
          empresa_id: string
          id: string
          origem: string | null
          resolvido_em: string | null
          resolvido_por: string | null
          status: Database["public"]["Enums"]["integ_alias_status"]
        }
        Insert: {
          alias: string
          created_at?: string
          empresa_alvo_id?: string | null
          empresa_id: string
          id?: string
          origem?: string | null
          resolvido_em?: string | null
          resolvido_por?: string | null
          status?: Database["public"]["Enums"]["integ_alias_status"]
        }
        Update: {
          alias?: string
          created_at?: string
          empresa_alvo_id?: string | null
          empresa_id?: string
          id?: string
          origem?: string | null
          resolvido_em?: string | null
          resolvido_por?: string | null
          status?: Database["public"]["Enums"]["integ_alias_status"]
        }
        Relationships: [
          {
            foreignKeyName: "integration_alias_empresas_empresa_alvo_id_fkey"
            columns: ["empresa_alvo_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "integration_alias_empresas_empresa_alvo_id_fkey"
            columns: ["empresa_alvo_id"]
            isOneToOne: false
            referencedRelation: "v_ia_contexto_empresa"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "integration_alias_empresas_empresa_alvo_id_fkey"
            columns: ["empresa_alvo_id"]
            isOneToOne: false
            referencedRelation: "vw_bi_resumo_empresa"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "integration_alias_empresas_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "integration_alias_empresas_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "v_ia_contexto_empresa"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "integration_alias_empresas_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "vw_bi_resumo_empresa"
            referencedColumns: ["empresa_id"]
          },
        ]
      }
      integration_alias_formas_pagamento: {
        Row: {
          alias: string
          created_at: string
          empresa_id: string
          forma_pagamento: string | null
          id: string
          origem: string | null
          resolvido_em: string | null
          resolvido_por: string | null
          status: Database["public"]["Enums"]["integ_alias_status"]
        }
        Insert: {
          alias: string
          created_at?: string
          empresa_id: string
          forma_pagamento?: string | null
          id?: string
          origem?: string | null
          resolvido_em?: string | null
          resolvido_por?: string | null
          status?: Database["public"]["Enums"]["integ_alias_status"]
        }
        Update: {
          alias?: string
          created_at?: string
          empresa_id?: string
          forma_pagamento?: string | null
          id?: string
          origem?: string | null
          resolvido_em?: string | null
          resolvido_por?: string | null
          status?: Database["public"]["Enums"]["integ_alias_status"]
        }
        Relationships: [
          {
            foreignKeyName: "integration_alias_formas_pagamento_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "integration_alias_formas_pagamento_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "v_ia_contexto_empresa"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "integration_alias_formas_pagamento_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "vw_bi_resumo_empresa"
            referencedColumns: ["empresa_id"]
          },
        ]
      }
      integration_batch_files: {
        Row: {
          batch_id: string
          created_at: string
          empresa_id: string
          hash_sha256: string
          id: string
          layout_detectado_id: string | null
          layout_score: number | null
          linhas_inseridas: number | null
          materializado_em: string | null
          metadata: Json | null
          mime_type: string | null
          nome_original: string
          sheet_name: string | null
          storage_path: string
          tamanho_bytes: number | null
        }
        Insert: {
          batch_id: string
          created_at?: string
          empresa_id: string
          hash_sha256: string
          id?: string
          layout_detectado_id?: string | null
          layout_score?: number | null
          linhas_inseridas?: number | null
          materializado_em?: string | null
          metadata?: Json | null
          mime_type?: string | null
          nome_original: string
          sheet_name?: string | null
          storage_path: string
          tamanho_bytes?: number | null
        }
        Update: {
          batch_id?: string
          created_at?: string
          empresa_id?: string
          hash_sha256?: string
          id?: string
          layout_detectado_id?: string | null
          layout_score?: number | null
          linhas_inseridas?: number | null
          materializado_em?: string | null
          metadata?: Json | null
          mime_type?: string | null
          nome_original?: string
          sheet_name?: string | null
          storage_path?: string
          tamanho_bytes?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "integration_batch_files_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "integration_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "integration_batch_files_layout_detectado_id_fkey"
            columns: ["layout_detectado_id"]
            isOneToOne: false
            referencedRelation: "integration_layouts"
            referencedColumns: ["id"]
          },
        ]
      }
      integration_batches: {
        Row: {
          aprovado_em: string | null
          aprovado_por: string | null
          codigo: string
          created_at: string
          descricao: string | null
          empresa_id: string
          enviado_por: string | null
          id: string
          layout_id: string | null
          linhas_invalidas: number | null
          linhas_validas: number | null
          metadata: Json | null
          observacoes: string | null
          status: Database["public"]["Enums"]["integ_batch_status"]
          total_linhas: number | null
          updated_at: string
        }
        Insert: {
          aprovado_em?: string | null
          aprovado_por?: string | null
          codigo: string
          created_at?: string
          descricao?: string | null
          empresa_id: string
          enviado_por?: string | null
          id?: string
          layout_id?: string | null
          linhas_invalidas?: number | null
          linhas_validas?: number | null
          metadata?: Json | null
          observacoes?: string | null
          status?: Database["public"]["Enums"]["integ_batch_status"]
          total_linhas?: number | null
          updated_at?: string
        }
        Update: {
          aprovado_em?: string | null
          aprovado_por?: string | null
          codigo?: string
          created_at?: string
          descricao?: string | null
          empresa_id?: string
          enviado_por?: string | null
          id?: string
          layout_id?: string | null
          linhas_invalidas?: number | null
          linhas_validas?: number | null
          metadata?: Json | null
          observacoes?: string | null
          status?: Database["public"]["Enums"]["integ_batch_status"]
          total_linhas?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "integration_batches_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "integration_batches_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "v_ia_contexto_empresa"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "integration_batches_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "vw_bi_resumo_empresa"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "integration_batches_layout_id_fkey"
            columns: ["layout_id"]
            isOneToOne: false
            referencedRelation: "integration_layouts"
            referencedColumns: ["id"]
          },
        ]
      }
      integration_layout_columns: {
        Row: {
          aliases: string[]
          created_at: string
          formato: string | null
          id: string
          layout_id: string
          nome_destino: string
          nome_origem: string
          obrigatorio: boolean
          observacao: string | null
          ordem: number
          tipo_dado: string
        }
        Insert: {
          aliases?: string[]
          created_at?: string
          formato?: string | null
          id?: string
          layout_id: string
          nome_destino: string
          nome_origem: string
          obrigatorio?: boolean
          observacao?: string | null
          ordem?: number
          tipo_dado: string
        }
        Update: {
          aliases?: string[]
          created_at?: string
          formato?: string | null
          id?: string
          layout_id?: string
          nome_destino?: string
          nome_origem?: string
          obrigatorio?: boolean
          observacao?: string | null
          ordem?: number
          tipo_dado?: string
        }
        Relationships: [
          {
            foreignKeyName: "integration_layout_columns_layout_id_fkey"
            columns: ["layout_id"]
            isOneToOne: false
            referencedRelation: "integration_layouts"
            referencedColumns: ["id"]
          },
        ]
      }
      integration_layout_fingerprints: {
        Row: {
          arquivo_pattern: string | null
          colunas_obrigatorias: string[]
          created_at: string
          id: string
          layout_id: string
          peso: number
          sheet_pattern: string | null
        }
        Insert: {
          arquivo_pattern?: string | null
          colunas_obrigatorias?: string[]
          created_at?: string
          id?: string
          layout_id: string
          peso?: number
          sheet_pattern?: string | null
        }
        Update: {
          arquivo_pattern?: string | null
          colunas_obrigatorias?: string[]
          created_at?: string
          id?: string
          layout_id?: string
          peso?: number
          sheet_pattern?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "integration_layout_fingerprints_layout_id_fkey"
            columns: ["layout_id"]
            isOneToOne: false
            referencedRelation: "integration_layouts"
            referencedColumns: ["id"]
          },
        ]
      }
      integration_layouts: {
        Row: {
          ativo: boolean
          codigo: string
          created_at: string
          descricao: string | null
          destino_tabela: string
          id: string
          nome: string
          staging_tabela: string
          updated_at: string
          versao: number
        }
        Insert: {
          ativo?: boolean
          codigo: string
          created_at?: string
          descricao?: string | null
          destino_tabela: string
          id?: string
          nome: string
          staging_tabela: string
          updated_at?: string
          versao?: number
        }
        Update: {
          ativo?: boolean
          codigo?: string
          created_at?: string
          descricao?: string | null
          destino_tabela?: string
          id?: string
          nome?: string
          staging_tabela?: string
          updated_at?: string
          versao?: number
        }
        Relationships: []
      }
      integration_load_run_items: {
        Row: {
          acao: string
          created_at: string
          destino_id: string | null
          destino_tabela: string
          empresa_id: string
          erro: string | null
          id: string
          load_run_id: string
          staging_id: string | null
        }
        Insert: {
          acao: string
          created_at?: string
          destino_id?: string | null
          destino_tabela: string
          empresa_id: string
          erro?: string | null
          id?: string
          load_run_id: string
          staging_id?: string | null
        }
        Update: {
          acao?: string
          created_at?: string
          destino_id?: string | null
          destino_tabela?: string
          empresa_id?: string
          erro?: string | null
          id?: string
          load_run_id?: string
          staging_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "integration_load_run_items_load_run_id_fkey"
            columns: ["load_run_id"]
            isOneToOne: false
            referencedRelation: "integration_load_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      integration_load_runs: {
        Row: {
          batch_id: string
          created_at: string
          empresa_id: string
          executado_por: string | null
          finalizado_em: string | null
          id: string
          iniciado_em: string | null
          layout_id: string | null
          observacoes: string | null
          status: Database["public"]["Enums"]["integ_load_status"]
          total_atualizados: number | null
          total_erros: number | null
          total_ignorados: number | null
          total_inseridos: number | null
        }
        Insert: {
          batch_id: string
          created_at?: string
          empresa_id: string
          executado_por?: string | null
          finalizado_em?: string | null
          id?: string
          iniciado_em?: string | null
          layout_id?: string | null
          observacoes?: string | null
          status?: Database["public"]["Enums"]["integ_load_status"]
          total_atualizados?: number | null
          total_erros?: number | null
          total_ignorados?: number | null
          total_inseridos?: number | null
        }
        Update: {
          batch_id?: string
          created_at?: string
          empresa_id?: string
          executado_por?: string | null
          finalizado_em?: string | null
          id?: string
          iniciado_em?: string | null
          layout_id?: string | null
          observacoes?: string | null
          status?: Database["public"]["Enums"]["integ_load_status"]
          total_atualizados?: number | null
          total_erros?: number | null
          total_ignorados?: number | null
          total_inseridos?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "integration_load_runs_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "integration_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "integration_load_runs_layout_id_fkey"
            columns: ["layout_id"]
            isOneToOne: false
            referencedRelation: "integration_layouts"
            referencedColumns: ["id"]
          },
        ]
      }
      integration_map_classificacao_contabil: {
        Row: {
          aprovado_em: string | null
          aprovado_por: string | null
          centro_custo_origem: string | null
          classificacao_origem: string
          conta_contabil_id: string | null
          created_at: string
          direto_indireto: string | null
          empresa_id: string
          fixo_variavel: string | null
          id: string
          status: Database["public"]["Enums"]["integ_alias_status"]
          sugestao_motivo: string | null
          tipo_gasto: string | null
          tipo_origem: string | null
        }
        Insert: {
          aprovado_em?: string | null
          aprovado_por?: string | null
          centro_custo_origem?: string | null
          classificacao_origem: string
          conta_contabil_id?: string | null
          created_at?: string
          direto_indireto?: string | null
          empresa_id: string
          fixo_variavel?: string | null
          id?: string
          status?: Database["public"]["Enums"]["integ_alias_status"]
          sugestao_motivo?: string | null
          tipo_gasto?: string | null
          tipo_origem?: string | null
        }
        Update: {
          aprovado_em?: string | null
          aprovado_por?: string | null
          centro_custo_origem?: string | null
          classificacao_origem?: string
          conta_contabil_id?: string | null
          created_at?: string
          direto_indireto?: string | null
          empresa_id?: string
          fixo_variavel?: string | null
          id?: string
          status?: Database["public"]["Enums"]["integ_alias_status"]
          sugestao_motivo?: string | null
          tipo_gasto?: string | null
          tipo_origem?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "integration_map_classificacao_contabil_conta_contabil_id_fkey"
            columns: ["conta_contabil_id"]
            isOneToOne: false
            referencedRelation: "conta_contabil"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "integration_map_classificacao_contabil_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "integration_map_classificacao_contabil_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "v_ia_contexto_empresa"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "integration_map_classificacao_contabil_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "vw_bi_resumo_empresa"
            referencedColumns: ["empresa_id"]
          },
        ]
      }
      integration_parse_runs: {
        Row: {
          batch_file_id: string
          created_at: string
          empresa_id: string
          erro_mensagem: string | null
          finalizado_em: string | null
          id: string
          iniciado_em: string
          perfil_colunas: Json | null
          preview_amostra: Json | null
          status: string
          total_linhas: number | null
        }
        Insert: {
          batch_file_id: string
          created_at?: string
          empresa_id: string
          erro_mensagem?: string | null
          finalizado_em?: string | null
          id?: string
          iniciado_em?: string
          perfil_colunas?: Json | null
          preview_amostra?: Json | null
          status?: string
          total_linhas?: number | null
        }
        Update: {
          batch_file_id?: string
          created_at?: string
          empresa_id?: string
          erro_mensagem?: string | null
          finalizado_em?: string | null
          id?: string
          iniciado_em?: string
          perfil_colunas?: Json | null
          preview_amostra?: Json | null
          status?: string
          total_linhas?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "integration_parse_runs_batch_file_id_fkey"
            columns: ["batch_file_id"]
            isOneToOne: false
            referencedRelation: "integration_batch_files"
            referencedColumns: ["id"]
          },
        ]
      }
      integration_reprocess_requests: {
        Row: {
          batch_id: string
          created_at: string
          empresa_id: string
          id: string
          motivo: string
          novo_batch_id: string | null
          solicitado_por: string | null
          status: string
        }
        Insert: {
          batch_id: string
          created_at?: string
          empresa_id: string
          id?: string
          motivo: string
          novo_batch_id?: string | null
          solicitado_por?: string | null
          status?: string
        }
        Update: {
          batch_id?: string
          created_at?: string
          empresa_id?: string
          id?: string
          motivo?: string
          novo_batch_id?: string | null
          solicitado_por?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "integration_reprocess_requests_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "integration_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "integration_reprocess_requests_novo_batch_id_fkey"
            columns: ["novo_batch_id"]
            isOneToOne: false
            referencedRelation: "integration_batches"
            referencedColumns: ["id"]
          },
        ]
      }
      integration_validation_results: {
        Row: {
          batch_id: string
          campo: string | null
          created_at: string
          empresa_id: string
          id: string
          linha_origem: number | null
          mensagem: string
          resolvido: boolean
          rule_codigo: string
          severidade: Database["public"]["Enums"]["integ_validation_severity"]
          valor_recebido: string | null
        }
        Insert: {
          batch_id: string
          campo?: string | null
          created_at?: string
          empresa_id: string
          id?: string
          linha_origem?: number | null
          mensagem: string
          resolvido?: boolean
          rule_codigo: string
          severidade: Database["public"]["Enums"]["integ_validation_severity"]
          valor_recebido?: string | null
        }
        Update: {
          batch_id?: string
          campo?: string | null
          created_at?: string
          empresa_id?: string
          id?: string
          linha_origem?: number | null
          mensagem?: string
          resolvido?: boolean
          rule_codigo?: string
          severidade?: Database["public"]["Enums"]["integ_validation_severity"]
          valor_recebido?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "integration_validation_results_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "integration_batches"
            referencedColumns: ["id"]
          },
        ]
      }
      integration_validation_rules: {
        Row: {
          ativo: boolean
          campo: string | null
          codigo: string
          created_at: string
          descricao: string
          expressao: string | null
          id: string
          layout_id: string | null
          severidade: Database["public"]["Enums"]["integ_validation_severity"]
        }
        Insert: {
          ativo?: boolean
          campo?: string | null
          codigo: string
          created_at?: string
          descricao: string
          expressao?: string | null
          id?: string
          layout_id?: string | null
          severidade?: Database["public"]["Enums"]["integ_validation_severity"]
        }
        Update: {
          ativo?: boolean
          campo?: string | null
          codigo?: string
          created_at?: string
          descricao?: string
          expressao?: string | null
          id?: string
          layout_id?: string | null
          severidade?: Database["public"]["Enums"]["integ_validation_severity"]
        }
        Relationships: [
          {
            foreignKeyName: "integration_validation_rules_layout_id_fkey"
            columns: ["layout_id"]
            isOneToOne: false
            referencedRelation: "integration_layouts"
            referencedColumns: ["id"]
          },
        ]
      }
      lancamento_contabil: {
        Row: {
          competencia: string | null
          created_at: string
          created_by: string | null
          data_lancamento: string
          empresa_id: string
          hash_dedup: string | null
          historico: string
          id: string
          numero: string
          origem: string | null
          origem_id: string | null
          origem_tipo: string | null
          status: Database["public"]["Enums"]["lanc_status"]
          updated_at: string
          valor_total: number
        }
        Insert: {
          competencia?: string | null
          created_at?: string
          created_by?: string | null
          data_lancamento?: string
          empresa_id: string
          hash_dedup?: string | null
          historico: string
          id?: string
          numero: string
          origem?: string | null
          origem_id?: string | null
          origem_tipo?: string | null
          status?: Database["public"]["Enums"]["lanc_status"]
          updated_at?: string
          valor_total?: number
        }
        Update: {
          competencia?: string | null
          created_at?: string
          created_by?: string | null
          data_lancamento?: string
          empresa_id?: string
          hash_dedup?: string | null
          historico?: string
          id?: string
          numero?: string
          origem?: string | null
          origem_id?: string | null
          origem_tipo?: string | null
          status?: Database["public"]["Enums"]["lanc_status"]
          updated_at?: string
          valor_total?: number
        }
        Relationships: []
      }
      lancamento_partida: {
        Row: {
          centro_custo_id: string | null
          conta_contabil_id: string
          created_at: string
          dc: Database["public"]["Enums"]["partida_dc"]
          historico: string | null
          id: string
          lancamento_id: string
          valor: number
        }
        Insert: {
          centro_custo_id?: string | null
          conta_contabil_id: string
          created_at?: string
          dc: Database["public"]["Enums"]["partida_dc"]
          historico?: string | null
          id?: string
          lancamento_id: string
          valor?: number
        }
        Update: {
          centro_custo_id?: string | null
          conta_contabil_id?: string
          created_at?: string
          dc?: Database["public"]["Enums"]["partida_dc"]
          historico?: string | null
          id?: string
          lancamento_id?: string
          valor?: number
        }
        Relationships: [
          {
            foreignKeyName: "lancamento_partida_lancamento_id_fkey"
            columns: ["lancamento_id"]
            isOneToOne: false
            referencedRelation: "lancamento_contabil"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lancamento_partida_lancamento_id_fkey"
            columns: ["lancamento_id"]
            isOneToOne: false
            referencedRelation: "vw_conciliacao_eventos"
            referencedColumns: ["lancamento_id"]
          },
        ]
      }
      licitacao: {
        Row: {
          abertura: string | null
          assumido_em: string | null
          assumido_por: string | null
          batch_id: string | null
          created_at: string
          empresa_id: string
          id: string
          local_prestacao: string | null
          modalidade: string | null
          numero: string
          objeto: string
          observacoes: string | null
          orgao: string
          origem_carga: string | null
          responsavel_user_id: string | null
          status: Database["public"]["Enums"]["licitacao_status"]
          updated_at: string
          valor_estimado: number | null
        }
        Insert: {
          abertura?: string | null
          assumido_em?: string | null
          assumido_por?: string | null
          batch_id?: string | null
          created_at?: string
          empresa_id: string
          id?: string
          local_prestacao?: string | null
          modalidade?: string | null
          numero: string
          objeto: string
          observacoes?: string | null
          orgao: string
          origem_carga?: string | null
          responsavel_user_id?: string | null
          status?: Database["public"]["Enums"]["licitacao_status"]
          updated_at?: string
          valor_estimado?: number | null
        }
        Update: {
          abertura?: string | null
          assumido_em?: string | null
          assumido_por?: string | null
          batch_id?: string | null
          created_at?: string
          empresa_id?: string
          id?: string
          local_prestacao?: string | null
          modalidade?: string | null
          numero?: string
          objeto?: string
          observacoes?: string | null
          orgao?: string
          origem_carga?: string | null
          responsavel_user_id?: string | null
          status?: Database["public"]["Enums"]["licitacao_status"]
          updated_at?: string
          valor_estimado?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "licitacao_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "integration_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "licitacao_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "licitacao_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "v_ia_contexto_empresa"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "licitacao_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "vw_bi_resumo_empresa"
            referencedColumns: ["empresa_id"]
          },
        ]
      }
      licitacao_importacao_lote: {
        Row: {
          arquivo_hash: string | null
          arquivo_nome: string | null
          criado_em: string
          criado_por: string
          empresa_id: string
          erros_json: Json
          finalizado_em: string | null
          id: string
          pendencias_responsavel: Json
          status: string
          total_atualizadas: number
          total_erros: number
          total_ignoradas: number
          total_inseridas: number
          total_linhas: number
          updated_at: string
        }
        Insert: {
          arquivo_hash?: string | null
          arquivo_nome?: string | null
          criado_em?: string
          criado_por: string
          empresa_id: string
          erros_json?: Json
          finalizado_em?: string | null
          id?: string
          pendencias_responsavel?: Json
          status?: string
          total_atualizadas?: number
          total_erros?: number
          total_ignoradas?: number
          total_inseridas?: number
          total_linhas?: number
          updated_at?: string
        }
        Update: {
          arquivo_hash?: string | null
          arquivo_nome?: string | null
          criado_em?: string
          criado_por?: string
          empresa_id?: string
          erros_json?: Json
          finalizado_em?: string | null
          id?: string
          pendencias_responsavel?: Json
          status?: string
          total_atualizadas?: number
          total_erros?: number
          total_ignoradas?: number
          total_inseridas?: number
          total_linhas?: number
          updated_at?: string
        }
        Relationships: []
      }
      licitacao_responsavel_historico: {
        Row: {
          acao: string
          ator_id: string
          created_at: string
          de_user_id: string | null
          empresa_id: string
          id: string
          justificativa: string | null
          licitacao_id: string
          para_user_id: string
        }
        Insert: {
          acao: string
          ator_id: string
          created_at?: string
          de_user_id?: string | null
          empresa_id: string
          id?: string
          justificativa?: string | null
          licitacao_id: string
          para_user_id: string
        }
        Update: {
          acao?: string
          ator_id?: string
          created_at?: string
          de_user_id?: string | null
          empresa_id?: string
          id?: string
          justificativa?: string | null
          licitacao_id?: string
          para_user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "licitacao_responsavel_historico_licitacao_id_fkey"
            columns: ["licitacao_id"]
            isOneToOne: false
            referencedRelation: "licitacao"
            referencedColumns: ["id"]
          },
        ]
      }
      malote_pagamento: {
        Row: {
          aprovacao_status: Database["public"]["Enums"]["programacao_aprovacao_status"]
          conta_bancaria_id: string
          created_at: string
          criado_por: string | null
          data_pagamento: string
          descricao: string | null
          empresa_id: string
          enviado_aprovacao_em: string | null
          enviado_aprovacao_por: string | null
          enviado_em: string | null
          excecao: boolean
          executado_em: string | null
          id: string
          justificativa: string | null
          observacao: string | null
          periodo_fim: string | null
          periodo_inicio: string | null
          prioridade: Database["public"]["Enums"]["programacao_prioridade"]
          qtd_titulos: number
          reaberto: boolean
          remessa_id: string | null
          status: Database["public"]["Enums"]["malote_status"]
          updated_at: string
          urgencia: boolean
          valor_total: number
        }
        Insert: {
          aprovacao_status?: Database["public"]["Enums"]["programacao_aprovacao_status"]
          conta_bancaria_id: string
          created_at?: string
          criado_por?: string | null
          data_pagamento: string
          descricao?: string | null
          empresa_id: string
          enviado_aprovacao_em?: string | null
          enviado_aprovacao_por?: string | null
          enviado_em?: string | null
          excecao?: boolean
          executado_em?: string | null
          id?: string
          justificativa?: string | null
          observacao?: string | null
          periodo_fim?: string | null
          periodo_inicio?: string | null
          prioridade?: Database["public"]["Enums"]["programacao_prioridade"]
          qtd_titulos?: number
          reaberto?: boolean
          remessa_id?: string | null
          status?: Database["public"]["Enums"]["malote_status"]
          updated_at?: string
          urgencia?: boolean
          valor_total?: number
        }
        Update: {
          aprovacao_status?: Database["public"]["Enums"]["programacao_aprovacao_status"]
          conta_bancaria_id?: string
          created_at?: string
          criado_por?: string | null
          data_pagamento?: string
          descricao?: string | null
          empresa_id?: string
          enviado_aprovacao_em?: string | null
          enviado_aprovacao_por?: string | null
          enviado_em?: string | null
          excecao?: boolean
          executado_em?: string | null
          id?: string
          justificativa?: string | null
          observacao?: string | null
          periodo_fim?: string | null
          periodo_inicio?: string | null
          prioridade?: Database["public"]["Enums"]["programacao_prioridade"]
          qtd_titulos?: number
          reaberto?: boolean
          remessa_id?: string | null
          status?: Database["public"]["Enums"]["malote_status"]
          updated_at?: string
          urgencia?: boolean
          valor_total?: number
        }
        Relationships: [
          {
            foreignKeyName: "malote_pagamento_conta_bancaria_id_fkey"
            columns: ["conta_bancaria_id"]
            isOneToOne: false
            referencedRelation: "conta_bancaria"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "malote_pagamento_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "malote_pagamento_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "v_ia_contexto_empresa"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "malote_pagamento_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "vw_bi_resumo_empresa"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "malote_pagamento_remessa_id_fkey"
            columns: ["remessa_id"]
            isOneToOne: false
            referencedRelation: "remessa_cnab"
            referencedColumns: ["id"]
          },
        ]
      }
      malote_titulo: {
        Row: {
          created_at: string
          malote_id: string
          motivo_bloqueio: string | null
          observacao: string | null
          ordem: number
          prioridade: Database["public"]["Enums"]["programacao_prioridade"]
          titulo_pagar_id: string
          valor_programado: number | null
        }
        Insert: {
          created_at?: string
          malote_id: string
          motivo_bloqueio?: string | null
          observacao?: string | null
          ordem?: number
          prioridade?: Database["public"]["Enums"]["programacao_prioridade"]
          titulo_pagar_id: string
          valor_programado?: number | null
        }
        Update: {
          created_at?: string
          malote_id?: string
          motivo_bloqueio?: string | null
          observacao?: string | null
          ordem?: number
          prioridade?: Database["public"]["Enums"]["programacao_prioridade"]
          titulo_pagar_id?: string
          valor_programado?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "malote_titulo_malote_id_fkey"
            columns: ["malote_id"]
            isOneToOne: false
            referencedRelation: "malote_pagamento"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "malote_titulo_titulo_pagar_id_fkey"
            columns: ["titulo_pagar_id"]
            isOneToOne: false
            referencedRelation: "titulo_pagar"
            referencedColumns: ["id"]
          },
        ]
      }
      movimento_bancario: {
        Row: {
          conciliado: boolean
          conta_bancaria_id: string
          contraparte: string | null
          created_at: string
          data_movimento: string
          descricao: string | null
          documento: string | null
          empresa_id: string
          id: string
          tipo: Database["public"]["Enums"]["mov_banco_tipo"]
          titulo_pagar_id: string | null
          titulo_receber_id: string | null
          updated_at: string
          valor: number
        }
        Insert: {
          conciliado?: boolean
          conta_bancaria_id: string
          contraparte?: string | null
          created_at?: string
          data_movimento: string
          descricao?: string | null
          documento?: string | null
          empresa_id: string
          id?: string
          tipo: Database["public"]["Enums"]["mov_banco_tipo"]
          titulo_pagar_id?: string | null
          titulo_receber_id?: string | null
          updated_at?: string
          valor?: number
        }
        Update: {
          conciliado?: boolean
          conta_bancaria_id?: string
          contraparte?: string | null
          created_at?: string
          data_movimento?: string
          descricao?: string | null
          documento?: string | null
          empresa_id?: string
          id?: string
          tipo?: Database["public"]["Enums"]["mov_banco_tipo"]
          titulo_pagar_id?: string | null
          titulo_receber_id?: string | null
          updated_at?: string
          valor?: number
        }
        Relationships: []
      }
      mz_01_diagnostico_arquivos_migracao: {
        Row: {
          arquivo_logico: string | null
          arquivo_origem: string | null
          arquivo_origem_carga: string
          colunas: string | null
          colunas_qtd: string | null
          created_at: string
          linha_csv: number
          linhas_lidas: string | null
          migration_batch_id: string
          mz_id: number
          sha256_origem: string | null
          tipo: string | null
          uso_na_migracao: string | null
        }
        Insert: {
          arquivo_logico?: string | null
          arquivo_origem?: string | null
          arquivo_origem_carga?: string
          colunas?: string | null
          colunas_qtd?: string | null
          created_at?: string
          linha_csv: number
          linhas_lidas?: string | null
          migration_batch_id: string
          mz_id?: number
          sha256_origem?: string | null
          tipo?: string | null
          uso_na_migracao?: string | null
        }
        Update: {
          arquivo_logico?: string | null
          arquivo_origem?: string | null
          arquivo_origem_carga?: string
          colunas?: string | null
          colunas_qtd?: string | null
          created_at?: string
          linha_csv?: number
          linhas_lidas?: string | null
          migration_batch_id?: string
          mz_id?: number
          sha256_origem?: string | null
          tipo?: string | null
          uso_na_migracao?: string | null
        }
        Relationships: []
      }
      mz_02_dim_empresas: {
        Row: {
          arquivo_origem_carga: string
          ativo: string | null
          cnpj: string | null
          created_at: string
          empresa_codigo: string | null
          empresa_nome: string | null
          id_empresa: string | null
          linha_csv: number
          migration_batch_id: string
          mz_id: number
          origem: string | null
          status_cnpj: string | null
        }
        Insert: {
          arquivo_origem_carga?: string
          ativo?: string | null
          cnpj?: string | null
          created_at?: string
          empresa_codigo?: string | null
          empresa_nome?: string | null
          id_empresa?: string | null
          linha_csv: number
          migration_batch_id: string
          mz_id?: number
          origem?: string | null
          status_cnpj?: string | null
        }
        Update: {
          arquivo_origem_carga?: string
          ativo?: string | null
          cnpj?: string | null
          created_at?: string
          empresa_codigo?: string | null
          empresa_nome?: string | null
          id_empresa?: string | null
          linha_csv?: number
          migration_batch_id?: string
          mz_id?: number
          origem?: string | null
          status_cnpj?: string | null
        }
        Relationships: []
      }
      mz_03_dim_plano_contas_atual_enriquecido: {
        Row: {
          arquivo_origem_carga: string
          centro_custo_padrao: string | null
          classe_contabil: string | null
          classificacao_gerencial_padrao: string | null
          codigo_conta: string | null
          codigo_conta_pai: string | null
          conta_reduzida: string | null
          created_at: string
          direto_indireto_padrao: string | null
          dre_codigo: string | null
          dre_descricao: string | null
          entra_fluxo: string | null
          entra_orcamento: string | null
          exige_contrato: string | null
          fixo_variavel_padrao: string | null
          grupo_contabil: string | null
          grupo_dre: string | null
          linha_csv: number
          linha_dre_padrao: string | null
          migration_batch_id: string
          mz_id: number
          natureza_devedora_credora: string | null
          nivel: string | null
          nome_conta: string | null
          origem_conta: string | null
          saldo_inicial: string | null
          status_conta: string | null
          tipo: string | null
        }
        Insert: {
          arquivo_origem_carga?: string
          centro_custo_padrao?: string | null
          classe_contabil?: string | null
          classificacao_gerencial_padrao?: string | null
          codigo_conta?: string | null
          codigo_conta_pai?: string | null
          conta_reduzida?: string | null
          created_at?: string
          direto_indireto_padrao?: string | null
          dre_codigo?: string | null
          dre_descricao?: string | null
          entra_fluxo?: string | null
          entra_orcamento?: string | null
          exige_contrato?: string | null
          fixo_variavel_padrao?: string | null
          grupo_contabil?: string | null
          grupo_dre?: string | null
          linha_csv: number
          linha_dre_padrao?: string | null
          migration_batch_id: string
          mz_id?: number
          natureza_devedora_credora?: string | null
          nivel?: string | null
          nome_conta?: string | null
          origem_conta?: string | null
          saldo_inicial?: string | null
          status_conta?: string | null
          tipo?: string | null
        }
        Update: {
          arquivo_origem_carga?: string
          centro_custo_padrao?: string | null
          classe_contabil?: string | null
          classificacao_gerencial_padrao?: string | null
          codigo_conta?: string | null
          codigo_conta_pai?: string | null
          conta_reduzida?: string | null
          created_at?: string
          direto_indireto_padrao?: string | null
          dre_codigo?: string | null
          dre_descricao?: string | null
          entra_fluxo?: string | null
          entra_orcamento?: string | null
          exige_contrato?: string | null
          fixo_variavel_padrao?: string | null
          grupo_contabil?: string | null
          grupo_dre?: string | null
          linha_csv?: number
          linha_dre_padrao?: string | null
          migration_batch_id?: string
          mz_id?: number
          natureza_devedora_credora?: string | null
          nivel?: string | null
          nome_conta?: string | null
          origem_conta?: string | null
          saldo_inicial?: string | null
          status_conta?: string | null
          tipo?: string | null
        }
        Relationships: []
      }
      mz_04_dim_centros_custo_contratos_completo: {
        Row: {
          arquivo_origem_carga: string
          ativo: string | null
          codigo: string | null
          contrato_obrigatorio: string | null
          created_at: string
          dimensao: string | null
          direto_indireto_padrao: string | null
          empresas: string | null
          linha_csv: number
          migration_batch_id: string
          mz_id: number
          nome: string | null
          origem: string | null
          qtd_empresas: string | null
          status_cadastro: string | null
          tipo: string | null
          tipo_custo_despesa_padrao: string | null
        }
        Insert: {
          arquivo_origem_carga?: string
          ativo?: string | null
          codigo?: string | null
          contrato_obrigatorio?: string | null
          created_at?: string
          dimensao?: string | null
          direto_indireto_padrao?: string | null
          empresas?: string | null
          linha_csv: number
          migration_batch_id: string
          mz_id?: number
          nome?: string | null
          origem?: string | null
          qtd_empresas?: string | null
          status_cadastro?: string | null
          tipo?: string | null
          tipo_custo_despesa_padrao?: string | null
        }
        Update: {
          arquivo_origem_carga?: string
          ativo?: string | null
          codigo?: string | null
          contrato_obrigatorio?: string | null
          created_at?: string
          dimensao?: string | null
          direto_indireto_padrao?: string | null
          empresas?: string | null
          linha_csv?: number
          migration_batch_id?: string
          mz_id?: number
          nome?: string | null
          origem?: string | null
          qtd_empresas?: string | null
          status_cadastro?: string | null
          tipo?: string | null
          tipo_custo_despesa_padrao?: string | null
        }
        Relationships: []
      }
      mz_05_dim_eventos_contabeis: {
        Row: {
          arquivo_origem_carga: string
          codigo_evento: string | null
          conta_credito_conceitual: string | null
          conta_debito_conceitual: string | null
          created_at: string
          descricao_evento: string | null
          impacta_caixa: string | null
          impacta_dre: string | null
          linha_csv: number
          migration_batch_id: string
          mz_id: number
          observacao: string | null
        }
        Insert: {
          arquivo_origem_carga?: string
          codigo_evento?: string | null
          conta_credito_conceitual?: string | null
          conta_debito_conceitual?: string | null
          created_at?: string
          descricao_evento?: string | null
          impacta_caixa?: string | null
          impacta_dre?: string | null
          linha_csv: number
          migration_batch_id: string
          mz_id?: number
          observacao?: string | null
        }
        Update: {
          arquivo_origem_carga?: string
          codigo_evento?: string | null
          conta_credito_conceitual?: string | null
          conta_debito_conceitual?: string | null
          created_at?: string
          descricao_evento?: string | null
          impacta_caixa?: string | null
          impacta_dre?: string | null
          linha_csv?: number
          migration_batch_id?: string
          mz_id?: number
          observacao?: string | null
        }
        Relationships: []
      }
      mz_06_dim_bancos_contas_financeiras: {
        Row: {
          arquivo_origem_carga: string
          ativo: string | null
          banco_original: string | null
          codigo_conta_banco: string | null
          created_at: string
          id_banco_conta: string | null
          id_sugestao_conta: string | null
          linha_csv: number
          migration_batch_id: string
          mz_id: number
          nome_conta_banco: string | null
          status_de_para_banco: string | null
        }
        Insert: {
          arquivo_origem_carga?: string
          ativo?: string | null
          banco_original?: string | null
          codigo_conta_banco?: string | null
          created_at?: string
          id_banco_conta?: string | null
          id_sugestao_conta?: string | null
          linha_csv: number
          migration_batch_id: string
          mz_id?: number
          nome_conta_banco?: string | null
          status_de_para_banco?: string | null
        }
        Update: {
          arquivo_origem_carga?: string
          ativo?: string | null
          banco_original?: string | null
          codigo_conta_banco?: string | null
          created_at?: string
          id_banco_conta?: string | null
          id_sugestao_conta?: string | null
          linha_csv?: number
          migration_batch_id?: string
          mz_id?: number
          nome_conta_banco?: string | null
          status_de_para_banco?: string | null
        }
        Relationships: []
      }
      mz_10_stg_base_original_normalizada: {
        Row: {
          arquivo_origem: string | null
          arquivo_origem_carga: string
          banco: string | null
          centro_custo_contrato: string | null
          classificacao_original: string | null
          created_at: string
          dados_originais_json: string | null
          data_normalizada: string | null
          data_original: string | null
          empresa: string | null
          historico: string | null
          id_base_original: string | null
          id_origem: string | null
          linha_csv: number
          linha_origem: string | null
          migration_batch_id: string
          mz_id: number
          status_tratamento: string | null
          tipo_base: string | null
          tipo_movimento: string | null
          uso_migracao: string | null
          valor_normalizado: string | null
          valor_original: string | null
        }
        Insert: {
          arquivo_origem?: string | null
          arquivo_origem_carga?: string
          banco?: string | null
          centro_custo_contrato?: string | null
          classificacao_original?: string | null
          created_at?: string
          dados_originais_json?: string | null
          data_normalizada?: string | null
          data_original?: string | null
          empresa?: string | null
          historico?: string | null
          id_base_original?: string | null
          id_origem?: string | null
          linha_csv: number
          linha_origem?: string | null
          migration_batch_id: string
          mz_id?: number
          status_tratamento?: string | null
          tipo_base?: string | null
          tipo_movimento?: string | null
          uso_migracao?: string | null
          valor_normalizado?: string | null
          valor_original?: string | null
        }
        Update: {
          arquivo_origem?: string | null
          arquivo_origem_carga?: string
          banco?: string | null
          centro_custo_contrato?: string | null
          classificacao_original?: string | null
          created_at?: string
          dados_originais_json?: string | null
          data_normalizada?: string | null
          data_original?: string | null
          empresa?: string | null
          historico?: string | null
          id_base_original?: string | null
          id_origem?: string | null
          linha_csv?: number
          linha_origem?: string | null
          migration_batch_id?: string
          mz_id?: number
          status_tratamento?: string | null
          tipo_base?: string | null
          tipo_movimento?: string | null
          uso_migracao?: string | null
          valor_normalizado?: string | null
          valor_original?: string | null
        }
        Relationships: []
      }
      mz_20_stg_mapa_de_para_contabil_financeiro: {
        Row: {
          arquivo_origem: string | null
          arquivo_origem_carga: string
          banco: string | null
          categoria_despesa_original: string | null
          centro_custo: string | null
          classificacao_gerencial: string | null
          classificacao_original: string | null
          competencia_original: string | null
          conta_banco_codigo: string | null
          conta_banco_nome: string | null
          conta_resultado_codigo: string | null
          conta_resultado_nome: string | null
          created_at: string
          criterio_classificacao: string | null
          data_caixa: string | null
          data_original: string | null
          direto_indireto_aplicado: string | null
          empresa: string | null
          evento_base: string | null
          evento_caixa: string | null
          fixo_variavel_aplicado: string | null
          forma_pagamento: string | null
          grau_confianca: string | null
          historico_original: string | null
          id_lct: string | null
          id_origem: string | null
          id_sugestao_conta_resultado: string | null
          linha_csv: number
          linha_origem: string | null
          migration_batch_id: string
          mz_id: number
          pendencia_base: string | null
          periodo_caixa: string | null
          status_banco: string | null
          status_validacao_base: string | null
          tipo_custo_despesa_aplicado: string | null
          tipo_original: string | null
          valor: string | null
        }
        Insert: {
          arquivo_origem?: string | null
          arquivo_origem_carga?: string
          banco?: string | null
          categoria_despesa_original?: string | null
          centro_custo?: string | null
          classificacao_gerencial?: string | null
          classificacao_original?: string | null
          competencia_original?: string | null
          conta_banco_codigo?: string | null
          conta_banco_nome?: string | null
          conta_resultado_codigo?: string | null
          conta_resultado_nome?: string | null
          created_at?: string
          criterio_classificacao?: string | null
          data_caixa?: string | null
          data_original?: string | null
          direto_indireto_aplicado?: string | null
          empresa?: string | null
          evento_base?: string | null
          evento_caixa?: string | null
          fixo_variavel_aplicado?: string | null
          forma_pagamento?: string | null
          grau_confianca?: string | null
          historico_original?: string | null
          id_lct?: string | null
          id_origem?: string | null
          id_sugestao_conta_resultado?: string | null
          linha_csv: number
          linha_origem?: string | null
          migration_batch_id: string
          mz_id?: number
          pendencia_base?: string | null
          periodo_caixa?: string | null
          status_banco?: string | null
          status_validacao_base?: string | null
          tipo_custo_despesa_aplicado?: string | null
          tipo_original?: string | null
          valor?: string | null
        }
        Update: {
          arquivo_origem?: string | null
          arquivo_origem_carga?: string
          banco?: string | null
          categoria_despesa_original?: string | null
          centro_custo?: string | null
          classificacao_gerencial?: string | null
          classificacao_original?: string | null
          competencia_original?: string | null
          conta_banco_codigo?: string | null
          conta_banco_nome?: string | null
          conta_resultado_codigo?: string | null
          conta_resultado_nome?: string | null
          created_at?: string
          criterio_classificacao?: string | null
          data_caixa?: string | null
          data_original?: string | null
          direto_indireto_aplicado?: string | null
          empresa?: string | null
          evento_base?: string | null
          evento_caixa?: string | null
          fixo_variavel_aplicado?: string | null
          forma_pagamento?: string | null
          grau_confianca?: string | null
          historico_original?: string | null
          id_lct?: string | null
          id_origem?: string | null
          id_sugestao_conta_resultado?: string | null
          linha_csv?: number
          linha_origem?: string | null
          migration_batch_id?: string
          mz_id?: number
          pendencia_base?: string | null
          periodo_caixa?: string | null
          status_banco?: string | null
          status_validacao_base?: string | null
          tipo_custo_despesa_aplicado?: string | null
          tipo_original?: string | null
          valor?: string | null
        }
        Relationships: []
      }
      mz_21_stg_mapa_de_para_bancos: {
        Row: {
          arquivo_origem_carga: string
          banco_norm: string | null
          banco_original: string | null
          codigo_conta_banco: string | null
          created_at: string
          id_sugestao_conta: string | null
          linha_csv: number
          migration_batch_id: string
          mz_id: number
          nome_conta_banco: string | null
          status_de_para_banco: string | null
        }
        Insert: {
          arquivo_origem_carga?: string
          banco_norm?: string | null
          banco_original?: string | null
          codigo_conta_banco?: string | null
          created_at?: string
          id_sugestao_conta?: string | null
          linha_csv: number
          migration_batch_id: string
          mz_id?: number
          nome_conta_banco?: string | null
          status_de_para_banco?: string | null
        }
        Update: {
          arquivo_origem_carga?: string
          banco_norm?: string | null
          banco_original?: string | null
          codigo_conta_banco?: string | null
          created_at?: string
          id_sugestao_conta?: string | null
          linha_csv?: number
          migration_batch_id?: string
          mz_id?: number
          nome_conta_banco?: string | null
          status_de_para_banco?: string | null
        }
        Relationships: []
      }
      mz_22_stg_sugestoes_novas_contas: {
        Row: {
          arquivo_origem_carga: string
          classe_contabil: string | null
          codigo_conta_pai_sugerida: string | null
          codigo_conta_sugerido: string | null
          created_at: string
          decisao_usuario: string | null
          direto_indireto_padrao: string | null
          exemplos_historico_item: string | null
          fixo_variavel_padrao: string | null
          id_sugestao_conta: string | null
          impacta_caixa: string | null
          impacta_dre: string | null
          justificativa: string | null
          linha_csv: number
          migration_batch_id: string
          mz_id: number
          natureza_devedora_credora: string | null
          nome_conta_sugerido: string | null
          observacao_usuario: string | null
          origem_sugestao: string | null
          qtd_itens_orcamento: string | null
          qtd_lancamentos_mestre_afetados: string | null
          qtd_linhas_projetado: string | null
          qtd_linhas_realizado_depara: string | null
          status_aprovacao: string | null
          tipo_conta: string | null
          valor_lancamentos_mestre_afetados: string | null
          valor_orcamento: string | null
          valor_projetado: string | null
          valor_realizado_depara: string | null
        }
        Insert: {
          arquivo_origem_carga?: string
          classe_contabil?: string | null
          codigo_conta_pai_sugerida?: string | null
          codigo_conta_sugerido?: string | null
          created_at?: string
          decisao_usuario?: string | null
          direto_indireto_padrao?: string | null
          exemplos_historico_item?: string | null
          fixo_variavel_padrao?: string | null
          id_sugestao_conta?: string | null
          impacta_caixa?: string | null
          impacta_dre?: string | null
          justificativa?: string | null
          linha_csv: number
          migration_batch_id: string
          mz_id?: number
          natureza_devedora_credora?: string | null
          nome_conta_sugerido?: string | null
          observacao_usuario?: string | null
          origem_sugestao?: string | null
          qtd_itens_orcamento?: string | null
          qtd_lancamentos_mestre_afetados?: string | null
          qtd_linhas_projetado?: string | null
          qtd_linhas_realizado_depara?: string | null
          status_aprovacao?: string | null
          tipo_conta?: string | null
          valor_lancamentos_mestre_afetados?: string | null
          valor_orcamento?: string | null
          valor_projetado?: string | null
          valor_realizado_depara?: string | null
        }
        Update: {
          arquivo_origem_carga?: string
          classe_contabil?: string | null
          codigo_conta_pai_sugerida?: string | null
          codigo_conta_sugerido?: string | null
          created_at?: string
          decisao_usuario?: string | null
          direto_indireto_padrao?: string | null
          exemplos_historico_item?: string | null
          fixo_variavel_padrao?: string | null
          id_sugestao_conta?: string | null
          impacta_caixa?: string | null
          impacta_dre?: string | null
          justificativa?: string | null
          linha_csv?: number
          migration_batch_id?: string
          mz_id?: number
          natureza_devedora_credora?: string | null
          nome_conta_sugerido?: string | null
          observacao_usuario?: string | null
          origem_sugestao?: string | null
          qtd_itens_orcamento?: string | null
          qtd_lancamentos_mestre_afetados?: string | null
          qtd_linhas_projetado?: string | null
          qtd_linhas_realizado_depara?: string | null
          status_aprovacao?: string | null
          tipo_conta?: string | null
          valor_lancamentos_mestre_afetados?: string | null
          valor_orcamento?: string | null
          valor_projetado?: string | null
          valor_realizado_depara?: string | null
        }
        Relationships: []
      }
      mz_23_stg_pendencias_de_para: {
        Row: {
          arquivo_origem: string | null
          arquivo_origem_carga: string
          banco: string | null
          centro_custo: string | null
          classificacao_original: string | null
          created_at: string
          empresa: string | null
          grau_confianca: string | null
          historico: string | null
          id_lct: string | null
          id_origem: string | null
          linha_csv: number
          linha_origem: string | null
          migration_batch_id: string
          mz_id: number
          pendencia: string | null
          status_validacao: string | null
          tipo_pendencia: string | null
          valor: string | null
        }
        Insert: {
          arquivo_origem?: string | null
          arquivo_origem_carga?: string
          banco?: string | null
          centro_custo?: string | null
          classificacao_original?: string | null
          created_at?: string
          empresa?: string | null
          grau_confianca?: string | null
          historico?: string | null
          id_lct?: string | null
          id_origem?: string | null
          linha_csv: number
          linha_origem?: string | null
          migration_batch_id: string
          mz_id?: number
          pendencia?: string | null
          status_validacao?: string | null
          tipo_pendencia?: string | null
          valor?: string | null
        }
        Update: {
          arquivo_origem?: string | null
          arquivo_origem_carga?: string
          banco?: string | null
          centro_custo?: string | null
          classificacao_original?: string | null
          created_at?: string
          empresa?: string | null
          grau_confianca?: string | null
          historico?: string | null
          id_lct?: string | null
          id_origem?: string | null
          linha_csv?: number
          linha_origem?: string | null
          migration_batch_id?: string
          mz_id?: number
          pendencia?: string | null
          status_validacao?: string | null
          tipo_pendencia?: string | null
          valor?: string | null
        }
        Relationships: []
      }
      mz_24_dim_plano_contas_completo_proposto: {
        Row: {
          arquivo_origem_carga: string
          centro_custo_padrao: string | null
          classe_contabil: string | null
          classificacao_gerencial_padrao: string | null
          codigo_conta: string | null
          codigo_conta_pai: string | null
          conta_reduzida: string | null
          created_at: string
          direto_indireto_padrao: string | null
          dre_codigo: string | null
          dre_descricao: string | null
          entra_fluxo: string | null
          entra_orcamento: string | null
          exige_contrato: string | null
          fixo_variavel_padrao: string | null
          grupo_contabil: string | null
          grupo_dre: string | null
          linha_csv: number
          linha_dre_padrao: string | null
          migration_batch_id: string
          mz_id: number
          natureza_devedora_credora: string | null
          nivel: string | null
          nome_conta: string | null
          origem_conta: string | null
          saldo_inicial: string | null
          status_conta: string | null
          tipo: string | null
        }
        Insert: {
          arquivo_origem_carga?: string
          centro_custo_padrao?: string | null
          classe_contabil?: string | null
          classificacao_gerencial_padrao?: string | null
          codigo_conta?: string | null
          codigo_conta_pai?: string | null
          conta_reduzida?: string | null
          created_at?: string
          direto_indireto_padrao?: string | null
          dre_codigo?: string | null
          dre_descricao?: string | null
          entra_fluxo?: string | null
          entra_orcamento?: string | null
          exige_contrato?: string | null
          fixo_variavel_padrao?: string | null
          grupo_contabil?: string | null
          grupo_dre?: string | null
          linha_csv: number
          linha_dre_padrao?: string | null
          migration_batch_id: string
          mz_id?: number
          natureza_devedora_credora?: string | null
          nivel?: string | null
          nome_conta?: string | null
          origem_conta?: string | null
          saldo_inicial?: string | null
          status_conta?: string | null
          tipo?: string | null
        }
        Update: {
          arquivo_origem_carga?: string
          centro_custo_padrao?: string | null
          classe_contabil?: string | null
          classificacao_gerencial_padrao?: string | null
          codigo_conta?: string | null
          codigo_conta_pai?: string | null
          conta_reduzida?: string | null
          created_at?: string
          direto_indireto_padrao?: string | null
          dre_codigo?: string | null
          dre_descricao?: string | null
          entra_fluxo?: string | null
          entra_orcamento?: string | null
          exige_contrato?: string | null
          fixo_variavel_padrao?: string | null
          grupo_contabil?: string | null
          grupo_dre?: string | null
          linha_csv?: number
          linha_dre_padrao?: string | null
          migration_batch_id?: string
          mz_id?: number
          natureza_devedora_credora?: string | null
          nivel?: string | null
          nome_conta?: string | null
          origem_conta?: string | null
          saldo_inicial?: string | null
          status_conta?: string | null
          tipo?: string | null
        }
        Relationships: []
      }
      mz_25_stg_mapa_de_para_orcamento_contratos: {
        Row: {
          arquivo_origem_carga: string
          classificacao_gerencial: string | null
          conta_contabil_codigo: string | null
          conta_contabil_nome: string | null
          created_at: string
          criterio_classificacao: string | null
          direto_indireto: string | null
          evento_sugerido: string | null
          fixo_variavel: string | null
          id_sugestao_conta: string | null
          impacta_dre: string | null
          item_orcamento: string | null
          linha_csv: number
          migration_batch_id: string
          mz_id: number
          qtd_linhas: string | null
          status_de_para: string | null
          valor_total: string | null
        }
        Insert: {
          arquivo_origem_carga?: string
          classificacao_gerencial?: string | null
          conta_contabil_codigo?: string | null
          conta_contabil_nome?: string | null
          created_at?: string
          criterio_classificacao?: string | null
          direto_indireto?: string | null
          evento_sugerido?: string | null
          fixo_variavel?: string | null
          id_sugestao_conta?: string | null
          impacta_dre?: string | null
          item_orcamento?: string | null
          linha_csv: number
          migration_batch_id: string
          mz_id?: number
          qtd_linhas?: string | null
          status_de_para?: string | null
          valor_total?: string | null
        }
        Update: {
          arquivo_origem_carga?: string
          classificacao_gerencial?: string | null
          conta_contabil_codigo?: string | null
          conta_contabil_nome?: string | null
          created_at?: string
          criterio_classificacao?: string | null
          direto_indireto?: string | null
          evento_sugerido?: string | null
          fixo_variavel?: string | null
          id_sugestao_conta?: string | null
          impacta_dre?: string | null
          item_orcamento?: string | null
          linha_csv?: number
          migration_batch_id?: string
          mz_id?: number
          qtd_linhas?: string | null
          status_de_para?: string | null
          valor_total?: string | null
        }
        Relationships: []
      }
      mz_26_template_aprovacao_contas: {
        Row: {
          arquivo_origem_carga: string
          classe_contabil: string | null
          codigo_conta_pai_sugerida: string | null
          codigo_conta_sugerido: string | null
          codigo_final_aprovado: string | null
          created_at: string
          decisao_usuario: string | null
          direto_indireto_padrao: string | null
          fixo_variavel_padrao: string | null
          id_sugestao_conta: string | null
          impacta_caixa: string | null
          impacta_dre: string | null
          justificativa: string | null
          linha_csv: number
          migration_batch_id: string
          mz_id: number
          natureza_devedora_credora: string | null
          nome_conta_sugerido: string | null
          nome_final_aprovado: string | null
          observacao_usuario: string | null
          qtd_itens_orcamento: string | null
          qtd_lancamentos_mestre_afetados: string | null
          qtd_linhas_realizado_depara: string | null
          status_aprovacao: string | null
          tipo_conta: string | null
          valor_lancamentos_mestre_afetados: string | null
          valor_orcamento: string | null
          valor_realizado_depara: string | null
        }
        Insert: {
          arquivo_origem_carga?: string
          classe_contabil?: string | null
          codigo_conta_pai_sugerida?: string | null
          codigo_conta_sugerido?: string | null
          codigo_final_aprovado?: string | null
          created_at?: string
          decisao_usuario?: string | null
          direto_indireto_padrao?: string | null
          fixo_variavel_padrao?: string | null
          id_sugestao_conta?: string | null
          impacta_caixa?: string | null
          impacta_dre?: string | null
          justificativa?: string | null
          linha_csv: number
          migration_batch_id: string
          mz_id?: number
          natureza_devedora_credora?: string | null
          nome_conta_sugerido?: string | null
          nome_final_aprovado?: string | null
          observacao_usuario?: string | null
          qtd_itens_orcamento?: string | null
          qtd_lancamentos_mestre_afetados?: string | null
          qtd_linhas_realizado_depara?: string | null
          status_aprovacao?: string | null
          tipo_conta?: string | null
          valor_lancamentos_mestre_afetados?: string | null
          valor_orcamento?: string | null
          valor_realizado_depara?: string | null
        }
        Update: {
          arquivo_origem_carga?: string
          classe_contabil?: string | null
          codigo_conta_pai_sugerida?: string | null
          codigo_conta_sugerido?: string | null
          codigo_final_aprovado?: string | null
          created_at?: string
          decisao_usuario?: string | null
          direto_indireto_padrao?: string | null
          fixo_variavel_padrao?: string | null
          id_sugestao_conta?: string | null
          impacta_caixa?: string | null
          impacta_dre?: string | null
          justificativa?: string | null
          linha_csv?: number
          migration_batch_id?: string
          mz_id?: number
          natureza_devedora_credora?: string | null
          nome_conta_sugerido?: string | null
          nome_final_aprovado?: string | null
          observacao_usuario?: string | null
          qtd_itens_orcamento?: string | null
          qtd_lancamentos_mestre_afetados?: string | null
          qtd_linhas_realizado_depara?: string | null
          status_aprovacao?: string | null
          tipo_conta?: string | null
          valor_lancamentos_mestre_afetados?: string | null
          valor_orcamento?: string | null
          valor_realizado_depara?: string | null
        }
        Relationships: []
      }
      mz_27_reconciliacao_de_para_pacote_do_zero: {
        Row: {
          arquivo_origem_carga: string
          created_at: string
          linha_csv: number
          metric: string | null
          migration_batch_id: string
          mz_id: number
          quantidade: string | null
          status: string | null
          valor: string | null
        }
        Insert: {
          arquivo_origem_carga?: string
          created_at?: string
          linha_csv: number
          metric?: string | null
          migration_batch_id: string
          mz_id?: number
          quantidade?: string | null
          status?: string | null
          valor?: string | null
        }
        Update: {
          arquivo_origem_carga?: string
          created_at?: string
          linha_csv?: number
          metric?: string | null
          migration_batch_id?: string
          mz_id?: number
          quantidade?: string | null
          status?: string | null
          valor?: string | null
        }
        Relationships: []
      }
      mz_29_stg_titulos_migracao: {
        Row: {
          arquivo_origem: string | null
          arquivo_origem_carga: string
          centro_custo: string | null
          cliente_fornecedor: string | null
          cnpj: string | null
          conta_banco_liquidacao: string | null
          conta_cliente_fornecedor: string | null
          conta_contrapartida_resultado: string | null
          contrato: string | null
          created_at: string
          data_competencia: string | null
          data_emissao: string | null
          data_liquidacao: string | null
          data_vencimento: string | null
          destino_id: string | null
          destino_tabela: string | null
          documento: string | null
          empresa: string | null
          evento_baixa: string | null
          evento_competencia: string | null
          grau_confianca: string | null
          historico: string | null
          id_lct_origem: string | null
          id_origem: string | null
          id_titulo: string | null
          linha_csv: number
          linha_origem: string | null
          migration_batch_id: string
          mz_id: number
          origem_titulo: string | null
          pendencia: string | null
          promovido_em: string | null
          promovido_por: string | null
          saldo_titulo: string | null
          status_titulo: string | null
          tipo_titulo: string | null
          valor_liquidado: string | null
          valor_titulo: string | null
        }
        Insert: {
          arquivo_origem?: string | null
          arquivo_origem_carga?: string
          centro_custo?: string | null
          cliente_fornecedor?: string | null
          cnpj?: string | null
          conta_banco_liquidacao?: string | null
          conta_cliente_fornecedor?: string | null
          conta_contrapartida_resultado?: string | null
          contrato?: string | null
          created_at?: string
          data_competencia?: string | null
          data_emissao?: string | null
          data_liquidacao?: string | null
          data_vencimento?: string | null
          destino_id?: string | null
          destino_tabela?: string | null
          documento?: string | null
          empresa?: string | null
          evento_baixa?: string | null
          evento_competencia?: string | null
          grau_confianca?: string | null
          historico?: string | null
          id_lct_origem?: string | null
          id_origem?: string | null
          id_titulo?: string | null
          linha_csv: number
          linha_origem?: string | null
          migration_batch_id: string
          mz_id?: number
          origem_titulo?: string | null
          pendencia?: string | null
          promovido_em?: string | null
          promovido_por?: string | null
          saldo_titulo?: string | null
          status_titulo?: string | null
          tipo_titulo?: string | null
          valor_liquidado?: string | null
          valor_titulo?: string | null
        }
        Update: {
          arquivo_origem?: string | null
          arquivo_origem_carga?: string
          centro_custo?: string | null
          cliente_fornecedor?: string | null
          cnpj?: string | null
          conta_banco_liquidacao?: string | null
          conta_cliente_fornecedor?: string | null
          conta_contrapartida_resultado?: string | null
          contrato?: string | null
          created_at?: string
          data_competencia?: string | null
          data_emissao?: string | null
          data_liquidacao?: string | null
          data_vencimento?: string | null
          destino_id?: string | null
          destino_tabela?: string | null
          documento?: string | null
          empresa?: string | null
          evento_baixa?: string | null
          evento_competencia?: string | null
          grau_confianca?: string | null
          historico?: string | null
          id_lct_origem?: string | null
          id_origem?: string | null
          id_titulo?: string | null
          linha_csv?: number
          linha_origem?: string | null
          migration_batch_id?: string
          mz_id?: number
          origem_titulo?: string | null
          pendencia?: string | null
          promovido_em?: string | null
          promovido_por?: string | null
          saldo_titulo?: string | null
          status_titulo?: string | null
          tipo_titulo?: string | null
          valor_liquidado?: string | null
          valor_titulo?: string | null
        }
        Relationships: []
      }
      mz_30_stg_lancamentos_mestre: {
        Row: {
          arquivo_origem: string | null
          arquivo_origem_carga: string
          banco: string | null
          centro_custo: string | null
          classificacao_gerencial: string | null
          cliente_fornecedor: string | null
          cnpj: string | null
          conta_credito_codigo: string | null
          conta_credito_nome: string | null
          conta_debito_codigo: string | null
          conta_debito_nome: string | null
          contrato: string | null
          created_at: string
          data_caixa: string | null
          data_competencia: string | null
          data_vencimento: string | null
          direto_indireto: string | null
          empresa: string | null
          evento: string | null
          fixo_variavel: string | null
          forma_pagamento: string | null
          gera_partida: string | null
          grau_confianca: string | null
          grupo_credito: string | null
          grupo_debito: string | null
          historico: string | null
          id_lct: string | null
          id_lct_mestre: string | null
          id_origem: string | null
          id_sugestao_conta_credito: string | null
          id_sugestao_conta_debito: string | null
          id_titulo: string | null
          impacta_balanco: string | null
          impacta_caixa: string | null
          impacta_dre: string | null
          linha_csv: number
          linha_origem: string | null
          migration_batch_id: string
          mz_id: number
          natureza_original: string | null
          observacao: string | null
          origem_lancamento: string | null
          pendencia: string | null
          periodo_caixa: string | null
          periodo_competencia: string | null
          status_conta_credito: string | null
          status_conta_debito: string | null
          status_validacao: string | null
          tipo_custo_despesa: string | null
          tipo_lancamento: string | null
          tipo_movimento: string | null
          valor: string | null
          valor_credito: string | null
          valor_debito: string | null
        }
        Insert: {
          arquivo_origem?: string | null
          arquivo_origem_carga?: string
          banco?: string | null
          centro_custo?: string | null
          classificacao_gerencial?: string | null
          cliente_fornecedor?: string | null
          cnpj?: string | null
          conta_credito_codigo?: string | null
          conta_credito_nome?: string | null
          conta_debito_codigo?: string | null
          conta_debito_nome?: string | null
          contrato?: string | null
          created_at?: string
          data_caixa?: string | null
          data_competencia?: string | null
          data_vencimento?: string | null
          direto_indireto?: string | null
          empresa?: string | null
          evento?: string | null
          fixo_variavel?: string | null
          forma_pagamento?: string | null
          gera_partida?: string | null
          grau_confianca?: string | null
          grupo_credito?: string | null
          grupo_debito?: string | null
          historico?: string | null
          id_lct?: string | null
          id_lct_mestre?: string | null
          id_origem?: string | null
          id_sugestao_conta_credito?: string | null
          id_sugestao_conta_debito?: string | null
          id_titulo?: string | null
          impacta_balanco?: string | null
          impacta_caixa?: string | null
          impacta_dre?: string | null
          linha_csv: number
          linha_origem?: string | null
          migration_batch_id: string
          mz_id?: number
          natureza_original?: string | null
          observacao?: string | null
          origem_lancamento?: string | null
          pendencia?: string | null
          periodo_caixa?: string | null
          periodo_competencia?: string | null
          status_conta_credito?: string | null
          status_conta_debito?: string | null
          status_validacao?: string | null
          tipo_custo_despesa?: string | null
          tipo_lancamento?: string | null
          tipo_movimento?: string | null
          valor?: string | null
          valor_credito?: string | null
          valor_debito?: string | null
        }
        Update: {
          arquivo_origem?: string | null
          arquivo_origem_carga?: string
          banco?: string | null
          centro_custo?: string | null
          classificacao_gerencial?: string | null
          cliente_fornecedor?: string | null
          cnpj?: string | null
          conta_credito_codigo?: string | null
          conta_credito_nome?: string | null
          conta_debito_codigo?: string | null
          conta_debito_nome?: string | null
          contrato?: string | null
          created_at?: string
          data_caixa?: string | null
          data_competencia?: string | null
          data_vencimento?: string | null
          direto_indireto?: string | null
          empresa?: string | null
          evento?: string | null
          fixo_variavel?: string | null
          forma_pagamento?: string | null
          gera_partida?: string | null
          grau_confianca?: string | null
          grupo_credito?: string | null
          grupo_debito?: string | null
          historico?: string | null
          id_lct?: string | null
          id_lct_mestre?: string | null
          id_origem?: string | null
          id_sugestao_conta_credito?: string | null
          id_sugestao_conta_debito?: string | null
          id_titulo?: string | null
          impacta_balanco?: string | null
          impacta_caixa?: string | null
          impacta_dre?: string | null
          linha_csv?: number
          linha_origem?: string | null
          migration_batch_id?: string
          mz_id?: number
          natureza_original?: string | null
          observacao?: string | null
          origem_lancamento?: string | null
          pendencia?: string | null
          periodo_caixa?: string | null
          periodo_competencia?: string | null
          status_conta_credito?: string | null
          status_conta_debito?: string | null
          status_validacao?: string | null
          tipo_custo_despesa?: string | null
          tipo_lancamento?: string | null
          tipo_movimento?: string | null
          valor?: string | null
          valor_credito?: string | null
          valor_debito?: string | null
        }
        Relationships: []
      }
      mz_31_fato_partidas_dobradas: {
        Row: {
          arquivo_origem: string | null
          arquivo_origem_carga: string
          centro_custo: string | null
          classificacao_gerencial: string | null
          conta_credito_codigo: string | null
          conta_credito_nome: string | null
          conta_debito_codigo: string | null
          conta_debito_nome: string | null
          contrato: string | null
          created_at: string
          data_caixa: string | null
          data_competencia: string | null
          destino_id: string | null
          direto_indireto: string | null
          documento_origem: string | null
          empresa: string | null
          evento: string | null
          fixo_variavel: string | null
          grau_confianca: string | null
          historico: string | null
          id_lct: string | null
          id_lct_mestre: string | null
          id_origem: string | null
          id_partida: string | null
          id_titulo: string | null
          impacta_balanco: string | null
          impacta_caixa: string | null
          impacta_dre: string | null
          linha_csv: number
          linha_origem: string | null
          migration_batch_id: string
          mz_id: number
          pendencia: string | null
          periodo_caixa: string | null
          periodo_competencia: string | null
          promovido_em: string | null
          promovido_por: string | null
          status_partida: string | null
          status_validacao: string | null
          tipo_custo_despesa: string | null
          valor_credito: string | null
          valor_debito: string | null
        }
        Insert: {
          arquivo_origem?: string | null
          arquivo_origem_carga?: string
          centro_custo?: string | null
          classificacao_gerencial?: string | null
          conta_credito_codigo?: string | null
          conta_credito_nome?: string | null
          conta_debito_codigo?: string | null
          conta_debito_nome?: string | null
          contrato?: string | null
          created_at?: string
          data_caixa?: string | null
          data_competencia?: string | null
          destino_id?: string | null
          direto_indireto?: string | null
          documento_origem?: string | null
          empresa?: string | null
          evento?: string | null
          fixo_variavel?: string | null
          grau_confianca?: string | null
          historico?: string | null
          id_lct?: string | null
          id_lct_mestre?: string | null
          id_origem?: string | null
          id_partida?: string | null
          id_titulo?: string | null
          impacta_balanco?: string | null
          impacta_caixa?: string | null
          impacta_dre?: string | null
          linha_csv: number
          linha_origem?: string | null
          migration_batch_id: string
          mz_id?: number
          pendencia?: string | null
          periodo_caixa?: string | null
          periodo_competencia?: string | null
          promovido_em?: string | null
          promovido_por?: string | null
          status_partida?: string | null
          status_validacao?: string | null
          tipo_custo_despesa?: string | null
          valor_credito?: string | null
          valor_debito?: string | null
        }
        Update: {
          arquivo_origem?: string | null
          arquivo_origem_carga?: string
          centro_custo?: string | null
          classificacao_gerencial?: string | null
          conta_credito_codigo?: string | null
          conta_credito_nome?: string | null
          conta_debito_codigo?: string | null
          conta_debito_nome?: string | null
          contrato?: string | null
          created_at?: string
          data_caixa?: string | null
          data_competencia?: string | null
          destino_id?: string | null
          direto_indireto?: string | null
          documento_origem?: string | null
          empresa?: string | null
          evento?: string | null
          fixo_variavel?: string | null
          grau_confianca?: string | null
          historico?: string | null
          id_lct?: string | null
          id_lct_mestre?: string | null
          id_origem?: string | null
          id_partida?: string | null
          id_titulo?: string | null
          impacta_balanco?: string | null
          impacta_caixa?: string | null
          impacta_dre?: string | null
          linha_csv?: number
          linha_origem?: string | null
          migration_batch_id?: string
          mz_id?: number
          pendencia?: string | null
          periodo_caixa?: string | null
          periodo_competencia?: string | null
          promovido_em?: string | null
          promovido_por?: string | null
          status_partida?: string | null
          status_validacao?: string | null
          tipo_custo_despesa?: string | null
          valor_credito?: string | null
          valor_debito?: string | null
        }
        Relationships: []
      }
      mz_32_fato_razao_contabil: {
        Row: {
          arquivo_origem: string | null
          arquivo_origem_carga: string
          centro_custo: string | null
          codigo_conta: string | null
          conta_contabil: string | null
          contrato: string | null
          created_at: string
          data_lancamento: string | null
          documento_origem: string | null
          empresa: string | null
          grupo_contabil: string | null
          historico: string | null
          id_lct: string | null
          id_lct_mestre: string | null
          id_origem: string | null
          id_partida: string | null
          id_razao: string | null
          id_titulo: string | null
          impacta_balanco: string | null
          impacta_caixa: string | null
          impacta_dre: string | null
          linha_csv: number
          linha_origem: string | null
          migration_batch_id: string
          mz_id: number
          natureza_conta: string | null
          pendencia: string | null
          periodo: string | null
          saldo_movimento: string | null
          status_validacao: string | null
          tipo_lancamento_conta: string | null
          valor_credito_razao: string | null
          valor_debito_razao: string | null
        }
        Insert: {
          arquivo_origem?: string | null
          arquivo_origem_carga?: string
          centro_custo?: string | null
          codigo_conta?: string | null
          conta_contabil?: string | null
          contrato?: string | null
          created_at?: string
          data_lancamento?: string | null
          documento_origem?: string | null
          empresa?: string | null
          grupo_contabil?: string | null
          historico?: string | null
          id_lct?: string | null
          id_lct_mestre?: string | null
          id_origem?: string | null
          id_partida?: string | null
          id_razao?: string | null
          id_titulo?: string | null
          impacta_balanco?: string | null
          impacta_caixa?: string | null
          impacta_dre?: string | null
          linha_csv: number
          linha_origem?: string | null
          migration_batch_id: string
          mz_id?: number
          natureza_conta?: string | null
          pendencia?: string | null
          periodo?: string | null
          saldo_movimento?: string | null
          status_validacao?: string | null
          tipo_lancamento_conta?: string | null
          valor_credito_razao?: string | null
          valor_debito_razao?: string | null
        }
        Update: {
          arquivo_origem?: string | null
          arquivo_origem_carga?: string
          centro_custo?: string | null
          codigo_conta?: string | null
          conta_contabil?: string | null
          contrato?: string | null
          created_at?: string
          data_lancamento?: string | null
          documento_origem?: string | null
          empresa?: string | null
          grupo_contabil?: string | null
          historico?: string | null
          id_lct?: string | null
          id_lct_mestre?: string | null
          id_origem?: string | null
          id_partida?: string | null
          id_razao?: string | null
          id_titulo?: string | null
          impacta_balanco?: string | null
          impacta_caixa?: string | null
          impacta_dre?: string | null
          linha_csv?: number
          linha_origem?: string | null
          migration_batch_id?: string
          mz_id?: number
          natureza_conta?: string | null
          pendencia?: string | null
          periodo?: string | null
          saldo_movimento?: string | null
          status_validacao?: string | null
          tipo_lancamento_conta?: string | null
          valor_credito_razao?: string | null
          valor_debito_razao?: string | null
        }
        Relationships: []
      }
      mz_32_promocao_log: {
        Row: {
          batch_id: string
          executado_em: string
          id: string
          resultado: Json
        }
        Insert: {
          batch_id: string
          executado_em?: string
          id?: string
          resultado: Json
        }
        Update: {
          batch_id?: string
          executado_em?: string
          id?: string
          resultado?: Json
        }
        Relationships: []
      }
      mz_33_fato_balancete: {
        Row: {
          arquivo_origem_carga: string
          codigo_conta: string | null
          conta_contabil: string | null
          created_at: string
          creditos: string | null
          debitos: string | null
          empresa: string | null
          grupo_contabil: string | null
          linha_csv: number
          migration_batch_id: string
          mz_id: number
          natureza_conta: string | null
          periodo: string | null
          qtd_lancamentos: string | null
          saldo_final: string | null
          saldo_inicial: string | null
          saldo_movimento: string | null
          status_balancete: string | null
        }
        Insert: {
          arquivo_origem_carga?: string
          codigo_conta?: string | null
          conta_contabil?: string | null
          created_at?: string
          creditos?: string | null
          debitos?: string | null
          empresa?: string | null
          grupo_contabil?: string | null
          linha_csv: number
          migration_batch_id: string
          mz_id?: number
          natureza_conta?: string | null
          periodo?: string | null
          qtd_lancamentos?: string | null
          saldo_final?: string | null
          saldo_inicial?: string | null
          saldo_movimento?: string | null
          status_balancete?: string | null
        }
        Update: {
          arquivo_origem_carga?: string
          codigo_conta?: string | null
          conta_contabil?: string | null
          created_at?: string
          creditos?: string | null
          debitos?: string | null
          empresa?: string | null
          grupo_contabil?: string | null
          linha_csv?: number
          migration_batch_id?: string
          mz_id?: number
          natureza_conta?: string | null
          periodo?: string | null
          qtd_lancamentos?: string | null
          saldo_final?: string | null
          saldo_inicial?: string | null
          saldo_movimento?: string | null
          status_balancete?: string | null
        }
        Relationships: []
      }
      mz_40_fato_fluxo_caixa_realizado: {
        Row: {
          arquivo_origem: string | null
          arquivo_origem_carga: string
          banco: string | null
          categoria_despesa: string | null
          centro_custo: string | null
          classificacao_gerencial: string | null
          classificacao_original: string | null
          competencia_original: string | null
          conta_banco_codigo: string | null
          conta_banco_nome: string | null
          conta_resultado_codigo: string | null
          conta_resultado_nome: string | null
          created_at: string
          data_caixa: string | null
          direto_indireto_aplicado: string | null
          empresa: string | null
          evento: string | null
          excluir_do_fluxo: boolean
          fixo_variavel_aplicado: string | null
          fluxo: string | null
          forma_pagamento: string | null
          historico: string | null
          id_fluxo: string | null
          id_lct: string | null
          id_origem: string | null
          impacta_caixa: string | null
          impacta_dre_base: string | null
          linha_csv: number
          linha_origem: string | null
          migration_batch_id: string
          motivo_exclusao_fluxo: string | null
          mz_id: number
          pendencia: string | null
          periodo_caixa: string | null
          promovido_em: string | null
          promovido_por: string | null
          realizado_lancamento_id: string | null
          status_fluxo: string | null
          tipo_custo_despesa_aplicado: string | null
          tipo_movimento: string | null
          valor: string | null
          valor_entrada: string | null
          valor_liquido: string | null
          valor_saida: string | null
        }
        Insert: {
          arquivo_origem?: string | null
          arquivo_origem_carga?: string
          banco?: string | null
          categoria_despesa?: string | null
          centro_custo?: string | null
          classificacao_gerencial?: string | null
          classificacao_original?: string | null
          competencia_original?: string | null
          conta_banco_codigo?: string | null
          conta_banco_nome?: string | null
          conta_resultado_codigo?: string | null
          conta_resultado_nome?: string | null
          created_at?: string
          data_caixa?: string | null
          direto_indireto_aplicado?: string | null
          empresa?: string | null
          evento?: string | null
          excluir_do_fluxo?: boolean
          fixo_variavel_aplicado?: string | null
          fluxo?: string | null
          forma_pagamento?: string | null
          historico?: string | null
          id_fluxo?: string | null
          id_lct?: string | null
          id_origem?: string | null
          impacta_caixa?: string | null
          impacta_dre_base?: string | null
          linha_csv: number
          linha_origem?: string | null
          migration_batch_id: string
          motivo_exclusao_fluxo?: string | null
          mz_id?: number
          pendencia?: string | null
          periodo_caixa?: string | null
          promovido_em?: string | null
          promovido_por?: string | null
          realizado_lancamento_id?: string | null
          status_fluxo?: string | null
          tipo_custo_despesa_aplicado?: string | null
          tipo_movimento?: string | null
          valor?: string | null
          valor_entrada?: string | null
          valor_liquido?: string | null
          valor_saida?: string | null
        }
        Update: {
          arquivo_origem?: string | null
          arquivo_origem_carga?: string
          banco?: string | null
          categoria_despesa?: string | null
          centro_custo?: string | null
          classificacao_gerencial?: string | null
          classificacao_original?: string | null
          competencia_original?: string | null
          conta_banco_codigo?: string | null
          conta_banco_nome?: string | null
          conta_resultado_codigo?: string | null
          conta_resultado_nome?: string | null
          created_at?: string
          data_caixa?: string | null
          direto_indireto_aplicado?: string | null
          empresa?: string | null
          evento?: string | null
          excluir_do_fluxo?: boolean
          fixo_variavel_aplicado?: string | null
          fluxo?: string | null
          forma_pagamento?: string | null
          historico?: string | null
          id_fluxo?: string | null
          id_lct?: string | null
          id_origem?: string | null
          impacta_caixa?: string | null
          impacta_dre_base?: string | null
          linha_csv?: number
          linha_origem?: string | null
          migration_batch_id?: string
          motivo_exclusao_fluxo?: string | null
          mz_id?: number
          pendencia?: string | null
          periodo_caixa?: string | null
          promovido_em?: string | null
          promovido_por?: string | null
          realizado_lancamento_id?: string | null
          status_fluxo?: string | null
          tipo_custo_despesa_aplicado?: string | null
          tipo_movimento?: string | null
          valor?: string | null
          valor_entrada?: string | null
          valor_liquido?: string | null
          valor_saida?: string | null
        }
        Relationships: []
      }
      mz_41_fato_fluxo_caixa_projetado: {
        Row: {
          arquivo_origem: string | null
          arquivo_origem_carga: string
          banco: string | null
          categoria_despesa: string | null
          centro_custo: string | null
          classificacao_gerencial: string | null
          classificacao_original: string | null
          competencia_original: string | null
          conta_banco_codigo: string | null
          conta_banco_nome: string | null
          conta_resultado_codigo: string | null
          conta_resultado_nome: string | null
          created_at: string
          data_prevista: string | null
          direto_indireto: string | null
          empresa: string | null
          evento_sugerido: string | null
          fixo_variavel: string | null
          forma_pagamento: string | null
          historico: string | null
          id_origem: string | null
          id_projecao: string | null
          id_sugestao_conta: string | null
          linha_csv: number
          linha_origem: string | null
          migration_batch_id: string
          mz_id: number
          origem_previsao: string | null
          pendencia: string | null
          periodo_previsto: string | null
          probabilidade: string | null
          status_projecao: string | null
          tipo_movimento: string | null
          valor_entrada_previsto: string | null
          valor_liquido_previsto: string | null
          valor_previsto: string | null
          valor_saida_previsto: string | null
        }
        Insert: {
          arquivo_origem?: string | null
          arquivo_origem_carga?: string
          banco?: string | null
          categoria_despesa?: string | null
          centro_custo?: string | null
          classificacao_gerencial?: string | null
          classificacao_original?: string | null
          competencia_original?: string | null
          conta_banco_codigo?: string | null
          conta_banco_nome?: string | null
          conta_resultado_codigo?: string | null
          conta_resultado_nome?: string | null
          created_at?: string
          data_prevista?: string | null
          direto_indireto?: string | null
          empresa?: string | null
          evento_sugerido?: string | null
          fixo_variavel?: string | null
          forma_pagamento?: string | null
          historico?: string | null
          id_origem?: string | null
          id_projecao?: string | null
          id_sugestao_conta?: string | null
          linha_csv: number
          linha_origem?: string | null
          migration_batch_id: string
          mz_id?: number
          origem_previsao?: string | null
          pendencia?: string | null
          periodo_previsto?: string | null
          probabilidade?: string | null
          status_projecao?: string | null
          tipo_movimento?: string | null
          valor_entrada_previsto?: string | null
          valor_liquido_previsto?: string | null
          valor_previsto?: string | null
          valor_saida_previsto?: string | null
        }
        Update: {
          arquivo_origem?: string | null
          arquivo_origem_carga?: string
          banco?: string | null
          categoria_despesa?: string | null
          centro_custo?: string | null
          classificacao_gerencial?: string | null
          classificacao_original?: string | null
          competencia_original?: string | null
          conta_banco_codigo?: string | null
          conta_banco_nome?: string | null
          conta_resultado_codigo?: string | null
          conta_resultado_nome?: string | null
          created_at?: string
          data_prevista?: string | null
          direto_indireto?: string | null
          empresa?: string | null
          evento_sugerido?: string | null
          fixo_variavel?: string | null
          forma_pagamento?: string | null
          historico?: string | null
          id_origem?: string | null
          id_projecao?: string | null
          id_sugestao_conta?: string | null
          linha_csv?: number
          linha_origem?: string | null
          migration_batch_id?: string
          mz_id?: number
          origem_previsao?: string | null
          pendencia?: string | null
          periodo_previsto?: string | null
          probabilidade?: string | null
          status_projecao?: string | null
          tipo_movimento?: string | null
          valor_entrada_previsto?: string | null
          valor_liquido_previsto?: string | null
          valor_previsto?: string | null
          valor_saida_previsto?: string | null
        }
        Relationships: []
      }
      mz_50_fato_orcamento_contratos_competencia: {
        Row: {
          arquivo_origem: string | null
          arquivo_origem_carga: string
          classificacao_gerencial: string | null
          cliente: string | null
          conta_contabil_codigo: string | null
          conta_contabil_nome: string | null
          contrato: string | null
          created_at: string
          criterio_classificacao: string | null
          destino_id: string | null
          direto_indireto: string | null
          empresa: string | null
          evento_sugerido: string | null
          fim_contrato: string | null
          fim_contrato_original: string | null
          fixo_variavel: string | null
          id_orcamento_item: string | null
          id_origem: string | null
          id_sugestao_conta: string | null
          impacta_dre: string | null
          item_orcamento: string | null
          linha_csv: number
          linha_origem: string | null
          migration_batch_id: string
          mz_id: number
          orcado_executado_original: string | null
          pendencia: string | null
          posto: string | null
          promovido_em: string | null
          promovido_por: string | null
          quantidade: string | null
          servico: string | null
          sindicato: string | null
          status_contrato: string | null
          status_orcamento: string | null
          tipo_orcamento: string | null
          valor_orcado_executado: string | null
          valor_original: string | null
          vigencia_inicio: string | null
          vigencia_original: string | null
        }
        Insert: {
          arquivo_origem?: string | null
          arquivo_origem_carga?: string
          classificacao_gerencial?: string | null
          cliente?: string | null
          conta_contabil_codigo?: string | null
          conta_contabil_nome?: string | null
          contrato?: string | null
          created_at?: string
          criterio_classificacao?: string | null
          destino_id?: string | null
          direto_indireto?: string | null
          empresa?: string | null
          evento_sugerido?: string | null
          fim_contrato?: string | null
          fim_contrato_original?: string | null
          fixo_variavel?: string | null
          id_orcamento_item?: string | null
          id_origem?: string | null
          id_sugestao_conta?: string | null
          impacta_dre?: string | null
          item_orcamento?: string | null
          linha_csv: number
          linha_origem?: string | null
          migration_batch_id: string
          mz_id?: number
          orcado_executado_original?: string | null
          pendencia?: string | null
          posto?: string | null
          promovido_em?: string | null
          promovido_por?: string | null
          quantidade?: string | null
          servico?: string | null
          sindicato?: string | null
          status_contrato?: string | null
          status_orcamento?: string | null
          tipo_orcamento?: string | null
          valor_orcado_executado?: string | null
          valor_original?: string | null
          vigencia_inicio?: string | null
          vigencia_original?: string | null
        }
        Update: {
          arquivo_origem?: string | null
          arquivo_origem_carga?: string
          classificacao_gerencial?: string | null
          cliente?: string | null
          conta_contabil_codigo?: string | null
          conta_contabil_nome?: string | null
          contrato?: string | null
          created_at?: string
          criterio_classificacao?: string | null
          destino_id?: string | null
          direto_indireto?: string | null
          empresa?: string | null
          evento_sugerido?: string | null
          fim_contrato?: string | null
          fim_contrato_original?: string | null
          fixo_variavel?: string | null
          id_orcamento_item?: string | null
          id_origem?: string | null
          id_sugestao_conta?: string | null
          impacta_dre?: string | null
          item_orcamento?: string | null
          linha_csv?: number
          linha_origem?: string | null
          migration_batch_id?: string
          mz_id?: number
          orcado_executado_original?: string | null
          pendencia?: string | null
          posto?: string | null
          promovido_em?: string | null
          promovido_por?: string | null
          quantidade?: string | null
          servico?: string | null
          sindicato?: string | null
          status_contrato?: string | null
          status_orcamento?: string | null
          tipo_orcamento?: string | null
          valor_orcado_executado?: string | null
          valor_original?: string | null
          vigencia_inicio?: string | null
          vigencia_original?: string | null
        }
        Relationships: []
      }
      mz_60_view_dre_gerencial_competencia: {
        Row: {
          arquivo_origem: string | null
          arquivo_origem_carga: string
          centro_custo: string | null
          classificacao_gerencial: string | null
          conta_credito_codigo: string | null
          conta_credito_nome: string | null
          conta_debito_codigo: string | null
          conta_debito_nome: string | null
          contrato: string | null
          created_at: string
          direto_indireto: string | null
          empresa: string | null
          fixo_variavel: string | null
          id_lct: string | null
          id_lct_mestre: string | null
          id_origem: string | null
          linha_csv: number
          linha_dre: string | null
          linha_origem: string | null
          migration_batch_id: string
          mz_id: number
          pendencia: string | null
          periodo_competencia: string | null
          status_validacao: string | null
          tipo_custo_despesa: string | null
          valor_dre: string | null
        }
        Insert: {
          arquivo_origem?: string | null
          arquivo_origem_carga?: string
          centro_custo?: string | null
          classificacao_gerencial?: string | null
          conta_credito_codigo?: string | null
          conta_credito_nome?: string | null
          conta_debito_codigo?: string | null
          conta_debito_nome?: string | null
          contrato?: string | null
          created_at?: string
          direto_indireto?: string | null
          empresa?: string | null
          fixo_variavel?: string | null
          id_lct?: string | null
          id_lct_mestre?: string | null
          id_origem?: string | null
          linha_csv: number
          linha_dre?: string | null
          linha_origem?: string | null
          migration_batch_id: string
          mz_id?: number
          pendencia?: string | null
          periodo_competencia?: string | null
          status_validacao?: string | null
          tipo_custo_despesa?: string | null
          valor_dre?: string | null
        }
        Update: {
          arquivo_origem?: string | null
          arquivo_origem_carga?: string
          centro_custo?: string | null
          classificacao_gerencial?: string | null
          conta_credito_codigo?: string | null
          conta_credito_nome?: string | null
          conta_debito_codigo?: string | null
          conta_debito_nome?: string | null
          contrato?: string | null
          created_at?: string
          direto_indireto?: string | null
          empresa?: string | null
          fixo_variavel?: string | null
          id_lct?: string | null
          id_lct_mestre?: string | null
          id_origem?: string | null
          linha_csv?: number
          linha_dre?: string | null
          linha_origem?: string | null
          migration_batch_id?: string
          mz_id?: number
          pendencia?: string | null
          periodo_competencia?: string | null
          status_validacao?: string | null
          tipo_custo_despesa?: string | null
          valor_dre?: string | null
        }
        Relationships: []
      }
      mz_61_view_dre_caixa_gerencial: {
        Row: {
          arquivo_origem_carga: string
          banco: string | null
          centro_custo: string | null
          classificacao_original: string | null
          created_at: string
          data_caixa: string | null
          empresa: string | null
          evento: string | null
          historico: string | null
          id_fluxo: string | null
          impacta_dre_base: string | null
          linha_csv: number
          linha_dre_caixa: string | null
          migration_batch_id: string
          mz_id: number
          pendencia: string | null
          periodo_caixa: string | null
          status_fluxo: string | null
          valor_dre_caixa: string | null
        }
        Insert: {
          arquivo_origem_carga?: string
          banco?: string | null
          centro_custo?: string | null
          classificacao_original?: string | null
          created_at?: string
          data_caixa?: string | null
          empresa?: string | null
          evento?: string | null
          historico?: string | null
          id_fluxo?: string | null
          impacta_dre_base?: string | null
          linha_csv: number
          linha_dre_caixa?: string | null
          migration_batch_id: string
          mz_id?: number
          pendencia?: string | null
          periodo_caixa?: string | null
          status_fluxo?: string | null
          valor_dre_caixa?: string | null
        }
        Update: {
          arquivo_origem_carga?: string
          banco?: string | null
          centro_custo?: string | null
          classificacao_original?: string | null
          created_at?: string
          data_caixa?: string | null
          empresa?: string | null
          evento?: string | null
          historico?: string | null
          id_fluxo?: string | null
          impacta_dre_base?: string | null
          linha_csv?: number
          linha_dre_caixa?: string | null
          migration_batch_id?: string
          mz_id?: number
          pendencia?: string | null
          periodo_caixa?: string | null
          status_fluxo?: string | null
          valor_dre_caixa?: string | null
        }
        Relationships: []
      }
      mz_62_view_ativo: {
        Row: {
          arquivo_origem_carga: string
          codigo_conta: string | null
          conta_contabil: string | null
          created_at: string
          creditos: string | null
          debitos: string | null
          empresa: string | null
          grupo_contabil: string | null
          grupo_topo: string | null
          linha_csv: number
          migration_batch_id: string
          mz_id: number
          natureza_conta: string | null
          periodo: string | null
          qtd_lancamentos: string | null
          saldo_final: string | null
          saldo_inicial: string | null
          saldo_movimento: string | null
          status_balancete: string | null
        }
        Insert: {
          arquivo_origem_carga?: string
          codigo_conta?: string | null
          conta_contabil?: string | null
          created_at?: string
          creditos?: string | null
          debitos?: string | null
          empresa?: string | null
          grupo_contabil?: string | null
          grupo_topo?: string | null
          linha_csv: number
          migration_batch_id: string
          mz_id?: number
          natureza_conta?: string | null
          periodo?: string | null
          qtd_lancamentos?: string | null
          saldo_final?: string | null
          saldo_inicial?: string | null
          saldo_movimento?: string | null
          status_balancete?: string | null
        }
        Update: {
          arquivo_origem_carga?: string
          codigo_conta?: string | null
          conta_contabil?: string | null
          created_at?: string
          creditos?: string | null
          debitos?: string | null
          empresa?: string | null
          grupo_contabil?: string | null
          grupo_topo?: string | null
          linha_csv?: number
          migration_batch_id?: string
          mz_id?: number
          natureza_conta?: string | null
          periodo?: string | null
          qtd_lancamentos?: string | null
          saldo_final?: string | null
          saldo_inicial?: string | null
          saldo_movimento?: string | null
          status_balancete?: string | null
        }
        Relationships: []
      }
      mz_63_view_passivo: {
        Row: {
          arquivo_origem_carga: string
          codigo_conta: string | null
          conta_contabil: string | null
          created_at: string
          creditos: string | null
          debitos: string | null
          empresa: string | null
          grupo_contabil: string | null
          grupo_topo: string | null
          linha_csv: number
          migration_batch_id: string
          mz_id: number
          natureza_conta: string | null
          periodo: string | null
          qtd_lancamentos: string | null
          saldo_final: string | null
          saldo_inicial: string | null
          saldo_movimento: string | null
          status_balancete: string | null
        }
        Insert: {
          arquivo_origem_carga?: string
          codigo_conta?: string | null
          conta_contabil?: string | null
          created_at?: string
          creditos?: string | null
          debitos?: string | null
          empresa?: string | null
          grupo_contabil?: string | null
          grupo_topo?: string | null
          linha_csv: number
          migration_batch_id: string
          mz_id?: number
          natureza_conta?: string | null
          periodo?: string | null
          qtd_lancamentos?: string | null
          saldo_final?: string | null
          saldo_inicial?: string | null
          saldo_movimento?: string | null
          status_balancete?: string | null
        }
        Update: {
          arquivo_origem_carga?: string
          codigo_conta?: string | null
          conta_contabil?: string | null
          created_at?: string
          creditos?: string | null
          debitos?: string | null
          empresa?: string | null
          grupo_contabil?: string | null
          grupo_topo?: string | null
          linha_csv?: number
          migration_batch_id?: string
          mz_id?: number
          natureza_conta?: string | null
          periodo?: string | null
          qtd_lancamentos?: string | null
          saldo_final?: string | null
          saldo_inicial?: string | null
          saldo_movimento?: string | null
          status_balancete?: string | null
        }
        Relationships: []
      }
      mz_64_view_patrimonio_liquido: {
        Row: {
          arquivo_origem_carga: string
          codigo_conta: string | null
          conta_contabil: string | null
          created_at: string
          creditos: string | null
          debitos: string | null
          empresa: string | null
          grupo_contabil: string | null
          grupo_topo: string | null
          linha_csv: number
          migration_batch_id: string
          mz_id: number
          natureza_conta: string | null
          periodo: string | null
          qtd_lancamentos: string | null
          saldo_final: string | null
          saldo_inicial: string | null
          saldo_movimento: string | null
          status_balancete: string | null
        }
        Insert: {
          arquivo_origem_carga?: string
          codigo_conta?: string | null
          conta_contabil?: string | null
          created_at?: string
          creditos?: string | null
          debitos?: string | null
          empresa?: string | null
          grupo_contabil?: string | null
          grupo_topo?: string | null
          linha_csv: number
          migration_batch_id: string
          mz_id?: number
          natureza_conta?: string | null
          periodo?: string | null
          qtd_lancamentos?: string | null
          saldo_final?: string | null
          saldo_inicial?: string | null
          saldo_movimento?: string | null
          status_balancete?: string | null
        }
        Update: {
          arquivo_origem_carga?: string
          codigo_conta?: string | null
          conta_contabil?: string | null
          created_at?: string
          creditos?: string | null
          debitos?: string | null
          empresa?: string | null
          grupo_contabil?: string | null
          grupo_topo?: string | null
          linha_csv?: number
          migration_batch_id?: string
          mz_id?: number
          natureza_conta?: string | null
          periodo?: string | null
          qtd_lancamentos?: string | null
          saldo_final?: string | null
          saldo_inicial?: string | null
          saldo_movimento?: string | null
          status_balancete?: string | null
        }
        Relationships: []
      }
      mz_65_view_contas_resultado: {
        Row: {
          arquivo_origem_carga: string
          codigo_conta: string | null
          conta_contabil: string | null
          created_at: string
          creditos: string | null
          debitos: string | null
          empresa: string | null
          grupo_contabil: string | null
          grupo_topo: string | null
          linha_csv: number
          migration_batch_id: string
          mz_id: number
          natureza_conta: string | null
          periodo: string | null
          qtd_lancamentos: string | null
          saldo_final: string | null
          saldo_inicial: string | null
          saldo_movimento: string | null
          status_balancete: string | null
        }
        Insert: {
          arquivo_origem_carga?: string
          codigo_conta?: string | null
          conta_contabil?: string | null
          created_at?: string
          creditos?: string | null
          debitos?: string | null
          empresa?: string | null
          grupo_contabil?: string | null
          grupo_topo?: string | null
          linha_csv: number
          migration_batch_id: string
          mz_id?: number
          natureza_conta?: string | null
          periodo?: string | null
          qtd_lancamentos?: string | null
          saldo_final?: string | null
          saldo_inicial?: string | null
          saldo_movimento?: string | null
          status_balancete?: string | null
        }
        Update: {
          arquivo_origem_carga?: string
          codigo_conta?: string | null
          conta_contabil?: string | null
          created_at?: string
          creditos?: string | null
          debitos?: string | null
          empresa?: string | null
          grupo_contabil?: string | null
          grupo_topo?: string | null
          linha_csv?: number
          migration_batch_id?: string
          mz_id?: number
          natureza_conta?: string | null
          periodo?: string | null
          qtd_lancamentos?: string | null
          saldo_final?: string | null
          saldo_inicial?: string | null
          saldo_movimento?: string | null
          status_balancete?: string | null
        }
        Relationships: []
      }
      mz_90_stg_pendencias_validacao: {
        Row: {
          arquivo_origem: string | null
          arquivo_origem_carga: string
          banco: string | null
          centro_custo: string | null
          conta_credito_codigo: string | null
          conta_credito_nome: string | null
          conta_debito_codigo: string | null
          conta_debito_nome: string | null
          contrato: string | null
          created_at: string
          empresa: string | null
          evento: string | null
          grau_confianca: string | null
          historico: string | null
          id_lct: string | null
          id_lct_mestre: string | null
          id_origem: string | null
          linha_csv: number
          linha_origem: string | null
          migration_batch_id: string
          mz_id: number
          natureza_original: string | null
          observacao: string | null
          pendencia: string | null
          status_validacao: string | null
          tipo_pendencia: string | null
          valor: string | null
        }
        Insert: {
          arquivo_origem?: string | null
          arquivo_origem_carga?: string
          banco?: string | null
          centro_custo?: string | null
          conta_credito_codigo?: string | null
          conta_credito_nome?: string | null
          conta_debito_codigo?: string | null
          conta_debito_nome?: string | null
          contrato?: string | null
          created_at?: string
          empresa?: string | null
          evento?: string | null
          grau_confianca?: string | null
          historico?: string | null
          id_lct?: string | null
          id_lct_mestre?: string | null
          id_origem?: string | null
          linha_csv: number
          linha_origem?: string | null
          migration_batch_id: string
          mz_id?: number
          natureza_original?: string | null
          observacao?: string | null
          pendencia?: string | null
          status_validacao?: string | null
          tipo_pendencia?: string | null
          valor?: string | null
        }
        Update: {
          arquivo_origem?: string | null
          arquivo_origem_carga?: string
          banco?: string | null
          centro_custo?: string | null
          conta_credito_codigo?: string | null
          conta_credito_nome?: string | null
          conta_debito_codigo?: string | null
          conta_debito_nome?: string | null
          contrato?: string | null
          created_at?: string
          empresa?: string | null
          evento?: string | null
          grau_confianca?: string | null
          historico?: string | null
          id_lct?: string | null
          id_lct_mestre?: string | null
          id_origem?: string | null
          linha_csv?: number
          linha_origem?: string | null
          migration_batch_id?: string
          mz_id?: number
          natureza_original?: string | null
          observacao?: string | null
          pendencia?: string | null
          status_validacao?: string | null
          tipo_pendencia?: string | null
          valor?: string | null
        }
        Relationships: []
      }
      mz_91_stg_logs_processamento: {
        Row: {
          arquivo_origem_carga: string
          created_at: string
          data_hora_geracao: string | null
          detalhe: string | null
          etapa: string | null
          linha_csv: number
          migration_batch_id: string
          mz_id: number
          status: string | null
        }
        Insert: {
          arquivo_origem_carga?: string
          created_at?: string
          data_hora_geracao?: string | null
          detalhe?: string | null
          etapa?: string | null
          linha_csv: number
          migration_batch_id: string
          mz_id?: number
          status?: string | null
        }
        Update: {
          arquivo_origem_carga?: string
          created_at?: string
          data_hora_geracao?: string | null
          detalhe?: string | null
          etapa?: string | null
          linha_csv?: number
          migration_batch_id?: string
          mz_id?: number
          status?: string | null
        }
        Relationships: []
      }
      mz_92_stg_reconciliacao_migracao: {
        Row: {
          arquivo_origem_carga: string
          bloco: string | null
          created_at: string
          linha_csv: number
          metrica: string | null
          migration_batch_id: string
          mz_id: number
          quantidade: string | null
          status: string | null
          valor: string | null
        }
        Insert: {
          arquivo_origem_carga?: string
          bloco?: string | null
          created_at?: string
          linha_csv: number
          metrica?: string | null
          migration_batch_id: string
          mz_id?: number
          quantidade?: string | null
          status?: string | null
          valor?: string | null
        }
        Update: {
          arquivo_origem_carga?: string
          bloco?: string | null
          created_at?: string
          linha_csv?: number
          metrica?: string | null
          migration_batch_id?: string
          mz_id?: number
          quantidade?: string | null
          status?: string | null
          valor?: string | null
        }
        Relationships: []
      }
      mz_status: {
        Row: {
          arquivo: string
          created_at: string
          finalizou_em: string | null
          id: string
          iniciou_em: string | null
          linhas_carregadas: number
          linhas_esperadas: number
          migration_batch_id: string | null
          status: string
          storage_path: string | null
          tabela: string
          ultimo_erro: string | null
          updated_at: string
          uploaded_at: string | null
          uploaded_by: string | null
        }
        Insert: {
          arquivo: string
          created_at?: string
          finalizou_em?: string | null
          id?: string
          iniciou_em?: string | null
          linhas_carregadas?: number
          linhas_esperadas?: number
          migration_batch_id?: string | null
          status?: string
          storage_path?: string | null
          tabela: string
          ultimo_erro?: string | null
          updated_at?: string
          uploaded_at?: string | null
          uploaded_by?: string | null
        }
        Update: {
          arquivo?: string
          created_at?: string
          finalizou_em?: string | null
          id?: string
          iniciou_em?: string | null
          linhas_carregadas?: number
          linhas_esperadas?: number
          migration_batch_id?: string | null
          status?: string
          storage_path?: string | null
          tabela?: string
          ultimo_erro?: string | null
          updated_at?: string
          uploaded_at?: string | null
          uploaded_by?: string | null
        }
        Relationships: []
      }
      nf_entrada: {
        Row: {
          almoxarifado_id: string | null
          centro_custo_id: string | null
          cfop: string | null
          chave_acesso: string
          contrato_id: string | null
          created_at: string
          data_emissao: string
          data_entrada: string | null
          destino: Database["public"]["Enums"]["nf_origem_destino"]
          empresa_id: string
          fornecedor_cnpj: string
          fornecedor_id: string | null
          fornecedor_razao: string | null
          id: string
          importado_em: string
          importado_por: string | null
          lancada_manualmente_por: string | null
          lancado_em: string | null
          lancado_por: string | null
          modelo: string | null
          natureza_operacao: string | null
          numero: string
          observacoes: string | null
          origem: Database["public"]["Enums"]["nf_origem"]
          pedido_compra_id: string | null
          sefaz_consultado_em: string | null
          sefaz_status: string | null
          serie: string | null
          status: Database["public"]["Enums"]["nf_status"]
          updated_at: string
          validado_em: string | null
          validado_por: string | null
          valor_cofins: number
          valor_desconto: number
          valor_frete: number
          valor_icms: number
          valor_ipi: number
          valor_outras_despesas: number
          valor_pis: number
          valor_produtos: number
          valor_seguro: number
          valor_total: number
          xml_protocolo: string | null
          xml_storage_path: string | null
        }
        Insert: {
          almoxarifado_id?: string | null
          centro_custo_id?: string | null
          cfop?: string | null
          chave_acesso: string
          contrato_id?: string | null
          created_at?: string
          data_emissao: string
          data_entrada?: string | null
          destino?: Database["public"]["Enums"]["nf_origem_destino"]
          empresa_id: string
          fornecedor_cnpj: string
          fornecedor_id?: string | null
          fornecedor_razao?: string | null
          id?: string
          importado_em?: string
          importado_por?: string | null
          lancada_manualmente_por?: string | null
          lancado_em?: string | null
          lancado_por?: string | null
          modelo?: string | null
          natureza_operacao?: string | null
          numero: string
          observacoes?: string | null
          origem?: Database["public"]["Enums"]["nf_origem"]
          pedido_compra_id?: string | null
          sefaz_consultado_em?: string | null
          sefaz_status?: string | null
          serie?: string | null
          status?: Database["public"]["Enums"]["nf_status"]
          updated_at?: string
          validado_em?: string | null
          validado_por?: string | null
          valor_cofins?: number
          valor_desconto?: number
          valor_frete?: number
          valor_icms?: number
          valor_ipi?: number
          valor_outras_despesas?: number
          valor_pis?: number
          valor_produtos?: number
          valor_seguro?: number
          valor_total?: number
          xml_protocolo?: string | null
          xml_storage_path?: string | null
        }
        Update: {
          almoxarifado_id?: string | null
          centro_custo_id?: string | null
          cfop?: string | null
          chave_acesso?: string
          contrato_id?: string | null
          created_at?: string
          data_emissao?: string
          data_entrada?: string | null
          destino?: Database["public"]["Enums"]["nf_origem_destino"]
          empresa_id?: string
          fornecedor_cnpj?: string
          fornecedor_id?: string | null
          fornecedor_razao?: string | null
          id?: string
          importado_em?: string
          importado_por?: string | null
          lancada_manualmente_por?: string | null
          lancado_em?: string | null
          lancado_por?: string | null
          modelo?: string | null
          natureza_operacao?: string | null
          numero?: string
          observacoes?: string | null
          origem?: Database["public"]["Enums"]["nf_origem"]
          pedido_compra_id?: string | null
          sefaz_consultado_em?: string | null
          sefaz_status?: string | null
          serie?: string | null
          status?: Database["public"]["Enums"]["nf_status"]
          updated_at?: string
          validado_em?: string | null
          validado_por?: string | null
          valor_cofins?: number
          valor_desconto?: number
          valor_frete?: number
          valor_icms?: number
          valor_ipi?: number
          valor_outras_despesas?: number
          valor_pis?: number
          valor_produtos?: number
          valor_seguro?: number
          valor_total?: number
          xml_protocolo?: string | null
          xml_storage_path?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "nf_entrada_almoxarifado_id_fkey"
            columns: ["almoxarifado_id"]
            isOneToOne: false
            referencedRelation: "almoxarifado"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nf_entrada_centro_custo_id_fkey"
            columns: ["centro_custo_id"]
            isOneToOne: false
            referencedRelation: "centros_custo"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nf_entrada_contrato_id_fkey"
            columns: ["contrato_id"]
            isOneToOne: false
            referencedRelation: "contrato"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nf_entrada_fornecedor_id_fkey"
            columns: ["fornecedor_id"]
            isOneToOne: false
            referencedRelation: "fornecedor"
            referencedColumns: ["id"]
          },
        ]
      }
      nf_entrada_item: {
        Row: {
          cfop: string | null
          codigo_fornecedor: string | null
          created_at: string
          descricao_original: string
          ean: string | null
          empresa_id: string
          id: string
          ncm: string | null
          nf_id: string
          numero_item: number
          observacoes: string | null
          produto_criado_auto: boolean
          produto_id: string | null
          quantidade: number
          status: Database["public"]["Enums"]["nf_item_status"]
          unidade: string
          updated_at: string
          valor_desconto: number
          valor_frete: number
          valor_icms: number
          valor_ipi: number
          valor_total: number
          valor_unitario: number
        }
        Insert: {
          cfop?: string | null
          codigo_fornecedor?: string | null
          created_at?: string
          descricao_original: string
          ean?: string | null
          empresa_id: string
          id?: string
          ncm?: string | null
          nf_id: string
          numero_item: number
          observacoes?: string | null
          produto_criado_auto?: boolean
          produto_id?: string | null
          quantidade: number
          status?: Database["public"]["Enums"]["nf_item_status"]
          unidade?: string
          updated_at?: string
          valor_desconto?: number
          valor_frete?: number
          valor_icms?: number
          valor_ipi?: number
          valor_total?: number
          valor_unitario?: number
        }
        Update: {
          cfop?: string | null
          codigo_fornecedor?: string | null
          created_at?: string
          descricao_original?: string
          ean?: string | null
          empresa_id?: string
          id?: string
          ncm?: string | null
          nf_id?: string
          numero_item?: number
          observacoes?: string | null
          produto_criado_auto?: boolean
          produto_id?: string | null
          quantidade?: number
          status?: Database["public"]["Enums"]["nf_item_status"]
          unidade?: string
          updated_at?: string
          valor_desconto?: number
          valor_frete?: number
          valor_icms?: number
          valor_ipi?: number
          valor_total?: number
          valor_unitario?: number
        }
        Relationships: [
          {
            foreignKeyName: "nf_entrada_item_nf_id_fkey"
            columns: ["nf_id"]
            isOneToOne: false
            referencedRelation: "nf_entrada"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nf_entrada_item_produto_id_fkey"
            columns: ["produto_id"]
            isOneToOne: false
            referencedRelation: "produto"
            referencedColumns: ["id"]
          },
        ]
      }
      nf_entrada_log: {
        Row: {
          created_at: string
          detalhes: Json | null
          empresa_id: string
          evento: string
          id: string
          nf_id: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          detalhes?: Json | null
          empresa_id: string
          evento: string
          id?: string
          nf_id: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          detalhes?: Json | null
          empresa_id?: string
          evento?: string
          id?: string
          nf_id?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "nf_entrada_log_nf_id_fkey"
            columns: ["nf_id"]
            isOneToOne: false
            referencedRelation: "nf_entrada"
            referencedColumns: ["id"]
          },
        ]
      }
      nfse: {
        Row: {
          aliquota_iss: number | null
          codigo_verificacao: string | null
          competencia: string | null
          contrato_id: string | null
          created_at: string
          created_by: string | null
          data_emissao: string
          discriminacao: string | null
          empresa_id: string
          id: string
          iss_retido: boolean | null
          motivo_cancelamento: string | null
          numero: string
          pdf_url: string | null
          protocolo: string | null
          rps_numero: string | null
          rps_serie: string | null
          serie: string | null
          status: Database["public"]["Enums"]["nfse_status"]
          tomador_documento: string | null
          tomador_email: string | null
          tomador_endereco: Json | null
          tomador_nome: string
          updated_at: string
          valor_cofins: number | null
          valor_csll: number | null
          valor_inss: number | null
          valor_ir: number | null
          valor_iss: number | null
          valor_liquido: number | null
          valor_pis: number | null
          valor_servicos: number
          xml_url: string | null
        }
        Insert: {
          aliquota_iss?: number | null
          codigo_verificacao?: string | null
          competencia?: string | null
          contrato_id?: string | null
          created_at?: string
          created_by?: string | null
          data_emissao?: string
          discriminacao?: string | null
          empresa_id: string
          id?: string
          iss_retido?: boolean | null
          motivo_cancelamento?: string | null
          numero: string
          pdf_url?: string | null
          protocolo?: string | null
          rps_numero?: string | null
          rps_serie?: string | null
          serie?: string | null
          status?: Database["public"]["Enums"]["nfse_status"]
          tomador_documento?: string | null
          tomador_email?: string | null
          tomador_endereco?: Json | null
          tomador_nome: string
          updated_at?: string
          valor_cofins?: number | null
          valor_csll?: number | null
          valor_inss?: number | null
          valor_ir?: number | null
          valor_iss?: number | null
          valor_liquido?: number | null
          valor_pis?: number | null
          valor_servicos: number
          xml_url?: string | null
        }
        Update: {
          aliquota_iss?: number | null
          codigo_verificacao?: string | null
          competencia?: string | null
          contrato_id?: string | null
          created_at?: string
          created_by?: string | null
          data_emissao?: string
          discriminacao?: string | null
          empresa_id?: string
          id?: string
          iss_retido?: boolean | null
          motivo_cancelamento?: string | null
          numero?: string
          pdf_url?: string | null
          protocolo?: string | null
          rps_numero?: string | null
          rps_serie?: string | null
          serie?: string | null
          status?: Database["public"]["Enums"]["nfse_status"]
          tomador_documento?: string | null
          tomador_email?: string | null
          tomador_endereco?: Json | null
          tomador_nome?: string
          updated_at?: string
          valor_cofins?: number | null
          valor_csll?: number | null
          valor_inss?: number | null
          valor_ir?: number | null
          valor_iss?: number | null
          valor_liquido?: number | null
          valor_pis?: number | null
          valor_servicos?: number
          xml_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "nfse_contrato_id_fkey"
            columns: ["contrato_id"]
            isOneToOne: false
            referencedRelation: "contrato"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nfse_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nfse_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "v_ia_contexto_empresa"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "nfse_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "vw_bi_resumo_empresa"
            referencedColumns: ["empresa_id"]
          },
        ]
      }
      nota_fiscal: {
        Row: {
          ambiente: Database["public"]["Enums"]["nfsai_ambiente"]
          base_calculo: number | null
          cancelada_em: string | null
          cancelada_por: string | null
          cancelamento_motivo: string | null
          codigo_servico: string | null
          codigo_verificacao: string | null
          competencia: string
          contrato_id: string | null
          created_at: string
          data_emissao: string | null
          discriminacao: string | null
          emitida_por: string | null
          empresa_id: string
          id: string
          iss_retido: boolean | null
          link_pdf: string | null
          link_xml: string | null
          medicao_id: string | null
          numero: number | null
          observacoes: string | null
          origem: Database["public"]["Enums"]["nfsai_origem"]
          protocolo: string | null
          rejeicao_motivo: string | null
          serie: string | null
          status: Database["public"]["Enums"]["nfsai_status"]
          tipo: Database["public"]["Enums"]["nfsai_tipo"]
          titulo_receber_id: string | null
          tomador_documento: string
          tomador_email: string | null
          tomador_endereco: Json | null
          tomador_municipio: string | null
          tomador_nome: string
          tomador_uf: string | null
          updated_at: string
          valor_cofins: number | null
          valor_csll: number | null
          valor_desconto: number | null
          valor_inss: number | null
          valor_irrf: number | null
          valor_iss: number | null
          valor_liquido: number | null
          valor_pis: number | null
          valor_produtos: number | null
          valor_servicos: number | null
          valor_total: number | null
        }
        Insert: {
          ambiente?: Database["public"]["Enums"]["nfsai_ambiente"]
          base_calculo?: number | null
          cancelada_em?: string | null
          cancelada_por?: string | null
          cancelamento_motivo?: string | null
          codigo_servico?: string | null
          codigo_verificacao?: string | null
          competencia?: string
          contrato_id?: string | null
          created_at?: string
          data_emissao?: string | null
          discriminacao?: string | null
          emitida_por?: string | null
          empresa_id: string
          id?: string
          iss_retido?: boolean | null
          link_pdf?: string | null
          link_xml?: string | null
          medicao_id?: string | null
          numero?: number | null
          observacoes?: string | null
          origem?: Database["public"]["Enums"]["nfsai_origem"]
          protocolo?: string | null
          rejeicao_motivo?: string | null
          serie?: string | null
          status?: Database["public"]["Enums"]["nfsai_status"]
          tipo: Database["public"]["Enums"]["nfsai_tipo"]
          titulo_receber_id?: string | null
          tomador_documento: string
          tomador_email?: string | null
          tomador_endereco?: Json | null
          tomador_municipio?: string | null
          tomador_nome: string
          tomador_uf?: string | null
          updated_at?: string
          valor_cofins?: number | null
          valor_csll?: number | null
          valor_desconto?: number | null
          valor_inss?: number | null
          valor_irrf?: number | null
          valor_iss?: number | null
          valor_liquido?: number | null
          valor_pis?: number | null
          valor_produtos?: number | null
          valor_servicos?: number | null
          valor_total?: number | null
        }
        Update: {
          ambiente?: Database["public"]["Enums"]["nfsai_ambiente"]
          base_calculo?: number | null
          cancelada_em?: string | null
          cancelada_por?: string | null
          cancelamento_motivo?: string | null
          codigo_servico?: string | null
          codigo_verificacao?: string | null
          competencia?: string
          contrato_id?: string | null
          created_at?: string
          data_emissao?: string | null
          discriminacao?: string | null
          emitida_por?: string | null
          empresa_id?: string
          id?: string
          iss_retido?: boolean | null
          link_pdf?: string | null
          link_xml?: string | null
          medicao_id?: string | null
          numero?: number | null
          observacoes?: string | null
          origem?: Database["public"]["Enums"]["nfsai_origem"]
          protocolo?: string | null
          rejeicao_motivo?: string | null
          serie?: string | null
          status?: Database["public"]["Enums"]["nfsai_status"]
          tipo?: Database["public"]["Enums"]["nfsai_tipo"]
          titulo_receber_id?: string | null
          tomador_documento?: string
          tomador_email?: string | null
          tomador_endereco?: Json | null
          tomador_municipio?: string | null
          tomador_nome?: string
          tomador_uf?: string | null
          updated_at?: string
          valor_cofins?: number | null
          valor_csll?: number | null
          valor_desconto?: number | null
          valor_inss?: number | null
          valor_irrf?: number | null
          valor_iss?: number | null
          valor_liquido?: number | null
          valor_pis?: number | null
          valor_produtos?: number | null
          valor_servicos?: number | null
          valor_total?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "nota_fiscal_contrato_id_fkey"
            columns: ["contrato_id"]
            isOneToOne: false
            referencedRelation: "contrato"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nota_fiscal_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nota_fiscal_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "v_ia_contexto_empresa"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "nota_fiscal_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "vw_bi_resumo_empresa"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "nota_fiscal_titulo_receber_id_fkey"
            columns: ["titulo_receber_id"]
            isOneToOne: false
            referencedRelation: "titulo_receber"
            referencedColumns: ["id"]
          },
        ]
      }
      nota_fiscal_evento: {
        Row: {
          created_at: string
          id: string
          nota_fiscal_id: string
          payload: Json | null
          status_anterior: Database["public"]["Enums"]["nfsai_status"] | null
          status_novo: Database["public"]["Enums"]["nfsai_status"] | null
          tipo: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          nota_fiscal_id: string
          payload?: Json | null
          status_anterior?: Database["public"]["Enums"]["nfsai_status"] | null
          status_novo?: Database["public"]["Enums"]["nfsai_status"] | null
          tipo: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          nota_fiscal_id?: string
          payload?: Json | null
          status_anterior?: Database["public"]["Enums"]["nfsai_status"] | null
          status_novo?: Database["public"]["Enums"]["nfsai_status"] | null
          tipo?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "nota_fiscal_evento_nota_fiscal_id_fkey"
            columns: ["nota_fiscal_id"]
            isOneToOne: false
            referencedRelation: "nota_fiscal"
            referencedColumns: ["id"]
          },
        ]
      }
      nota_fiscal_item: {
        Row: {
          aliq_cofins: number | null
          aliq_iss: number | null
          aliq_pis: number | null
          cfop: string | null
          created_at: string
          descricao: string
          id: string
          ncm: string | null
          nota_fiscal_id: string
          ordem: number
          produto_id: string | null
          quantidade: number
          servico_municipal_id: string | null
          unidade: string | null
          valor_cofins: number | null
          valor_iss: number | null
          valor_pis: number | null
          valor_total: number
          valor_unitario: number
        }
        Insert: {
          aliq_cofins?: number | null
          aliq_iss?: number | null
          aliq_pis?: number | null
          cfop?: string | null
          created_at?: string
          descricao: string
          id?: string
          ncm?: string | null
          nota_fiscal_id: string
          ordem?: number
          produto_id?: string | null
          quantidade?: number
          servico_municipal_id?: string | null
          unidade?: string | null
          valor_cofins?: number | null
          valor_iss?: number | null
          valor_pis?: number | null
          valor_total?: number
          valor_unitario?: number
        }
        Update: {
          aliq_cofins?: number | null
          aliq_iss?: number | null
          aliq_pis?: number | null
          cfop?: string | null
          created_at?: string
          descricao?: string
          id?: string
          ncm?: string | null
          nota_fiscal_id?: string
          ordem?: number
          produto_id?: string | null
          quantidade?: number
          servico_municipal_id?: string | null
          unidade?: string | null
          valor_cofins?: number | null
          valor_iss?: number | null
          valor_pis?: number | null
          valor_total?: number
          valor_unitario?: number
        }
        Relationships: [
          {
            foreignKeyName: "nota_fiscal_item_cfop_fkey"
            columns: ["cfop"]
            isOneToOne: false
            referencedRelation: "cfop"
            referencedColumns: ["codigo"]
          },
          {
            foreignKeyName: "nota_fiscal_item_nota_fiscal_id_fkey"
            columns: ["nota_fiscal_id"]
            isOneToOne: false
            referencedRelation: "nota_fiscal"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nota_fiscal_item_produto_id_fkey"
            columns: ["produto_id"]
            isOneToOne: false
            referencedRelation: "produto"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nota_fiscal_item_servico_municipal_id_fkey"
            columns: ["servico_municipal_id"]
            isOneToOne: false
            referencedRelation: "servico_municipal"
            referencedColumns: ["id"]
          },
        ]
      }
      notificacoes: {
        Row: {
          created_at: string
          empresa_id: string | null
          id: string
          lida: boolean
          link: string | null
          mensagem: string | null
          tipo: string
          titulo: string
          user_id: string
        }
        Insert: {
          created_at?: string
          empresa_id?: string | null
          id?: string
          lida?: boolean
          link?: string | null
          mensagem?: string | null
          tipo?: string
          titulo: string
          user_id: string
        }
        Update: {
          created_at?: string
          empresa_id?: string | null
          id?: string
          lida?: boolean
          link?: string | null
          mensagem?: string | null
          tipo?: string
          titulo?: string
          user_id?: string
        }
        Relationships: []
      }
      obz_periodos: {
        Row: {
          created_at: string
          id: string
          mes: number
          status: Database["public"]["Enums"]["periodo_status"]
          updated_at: string
          versao_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          mes: number
          status?: Database["public"]["Enums"]["periodo_status"]
          updated_at?: string
          versao_id: string
        }
        Update: {
          created_at?: string
          id?: string
          mes?: number
          status?: Database["public"]["Enums"]["periodo_status"]
          updated_at?: string
          versao_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "obz_periodos_versao_id_fkey"
            columns: ["versao_id"]
            isOneToOne: false
            referencedRelation: "obz_versoes"
            referencedColumns: ["id"]
          },
        ]
      }
      obz_valores: {
        Row: {
          centro_custo_id: string | null
          classificadores: Json
          created_at: string
          dre_linha_id: string
          id: string
          memoria_calculo: string | null
          periodo_id: string
          updated_at: string
          valor: number
          versao_id: string
        }
        Insert: {
          centro_custo_id?: string | null
          classificadores?: Json
          created_at?: string
          dre_linha_id: string
          id?: string
          memoria_calculo?: string | null
          periodo_id: string
          updated_at?: string
          valor?: number
          versao_id: string
        }
        Update: {
          centro_custo_id?: string | null
          classificadores?: Json
          created_at?: string
          dre_linha_id?: string
          id?: string
          memoria_calculo?: string | null
          periodo_id?: string
          updated_at?: string
          valor?: number
          versao_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "obz_valores_centro_custo_id_fkey"
            columns: ["centro_custo_id"]
            isOneToOne: false
            referencedRelation: "centros_custo"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "obz_valores_dre_linha_id_fkey"
            columns: ["dre_linha_id"]
            isOneToOne: false
            referencedRelation: "dre_linhas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "obz_valores_periodo_id_fkey"
            columns: ["periodo_id"]
            isOneToOne: false
            referencedRelation: "obz_periodos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "obz_valores_versao_id_fkey"
            columns: ["versao_id"]
            isOneToOne: false
            referencedRelation: "obz_versoes"
            referencedColumns: ["id"]
          },
        ]
      }
      obz_versoes: {
        Row: {
          ano: number
          aprovado_em: string | null
          aprovado_por: string | null
          created_at: string
          criado_por: string | null
          descricao: string | null
          empresa_id: string
          id: string
          nome: string
          revisao: number
          status: Database["public"]["Enums"]["obz_status"]
          updated_at: string
          versao: number
        }
        Insert: {
          ano: number
          aprovado_em?: string | null
          aprovado_por?: string | null
          created_at?: string
          criado_por?: string | null
          descricao?: string | null
          empresa_id: string
          id?: string
          nome: string
          revisao?: number
          status?: Database["public"]["Enums"]["obz_status"]
          updated_at?: string
          versao: number
        }
        Update: {
          ano?: number
          aprovado_em?: string | null
          aprovado_por?: string | null
          created_at?: string
          criado_por?: string | null
          descricao?: string | null
          empresa_id?: string
          id?: string
          nome?: string
          revisao?: number
          status?: Database["public"]["Enums"]["obz_status"]
          updated_at?: string
          versao?: number
        }
        Relationships: [
          {
            foreignKeyName: "obz_versoes_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "obz_versoes_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "v_ia_contexto_empresa"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "obz_versoes_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "vw_bi_resumo_empresa"
            referencedColumns: ["empresa_id"]
          },
        ]
      }
      ocorrencia_operacional: {
        Row: {
          created_at: string
          descricao: string | null
          empresa_id: string | null
          id: string
          ocorreu_em: string
          resolvida: boolean
          resolvida_em: string | null
          resolvida_por: string | null
          severidade: string
          tipo: string
          titulo: string
          usuario_id: string | null
          usuario_nome: string | null
        }
        Insert: {
          created_at?: string
          descricao?: string | null
          empresa_id?: string | null
          id?: string
          ocorreu_em?: string
          resolvida?: boolean
          resolvida_em?: string | null
          resolvida_por?: string | null
          severidade?: string
          tipo: string
          titulo: string
          usuario_id?: string | null
          usuario_nome?: string | null
        }
        Update: {
          created_at?: string
          descricao?: string | null
          empresa_id?: string | null
          id?: string
          ocorreu_em?: string
          resolvida?: boolean
          resolvida_em?: string | null
          resolvida_por?: string | null
          severidade?: string
          tipo?: string
          titulo?: string
          usuario_id?: string | null
          usuario_nome?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ocorrencia_operacional_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ocorrencia_operacional_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "v_ia_contexto_empresa"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "ocorrencia_operacional_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "vw_bi_resumo_empresa"
            referencedColumns: ["empresa_id"]
          },
        ]
      }
      orcamento_ciclo: {
        Row: {
          ano: number
          created_at: string
          data_fim: string | null
          data_inicio: string | null
          empresa_id: string
          id: string
          nome: string
          observacoes: string | null
          status: Database["public"]["Enums"]["orcamento_ciclo_status"]
          updated_at: string
        }
        Insert: {
          ano: number
          created_at?: string
          data_fim?: string | null
          data_inicio?: string | null
          empresa_id: string
          id?: string
          nome: string
          observacoes?: string | null
          status?: Database["public"]["Enums"]["orcamento_ciclo_status"]
          updated_at?: string
        }
        Update: {
          ano?: number
          created_at?: string
          data_fim?: string | null
          data_inicio?: string | null
          empresa_id?: string
          id?: string
          nome?: string
          observacoes?: string | null
          status?: Database["public"]["Enums"]["orcamento_ciclo_status"]
          updated_at?: string
        }
        Relationships: []
      }
      orcamento_contrato: {
        Row: {
          ciclo_id: string
          contrato_id: string
          created_at: string
          empresa_id: string
          gerado_em: string | null
          gerado_por: string | null
          id: string
          margem_estimada: number
          observacoes: string | null
          status: Database["public"]["Enums"]["orcamento_contrato_status"]
          updated_at: string
          valor_custo_total: number
          valor_receita_total: number
        }
        Insert: {
          ciclo_id: string
          contrato_id: string
          created_at?: string
          empresa_id: string
          gerado_em?: string | null
          gerado_por?: string | null
          id?: string
          margem_estimada?: number
          observacoes?: string | null
          status?: Database["public"]["Enums"]["orcamento_contrato_status"]
          updated_at?: string
          valor_custo_total?: number
          valor_receita_total?: number
        }
        Update: {
          ciclo_id?: string
          contrato_id?: string
          created_at?: string
          empresa_id?: string
          gerado_em?: string | null
          gerado_por?: string | null
          id?: string
          margem_estimada?: number
          observacoes?: string | null
          status?: Database["public"]["Enums"]["orcamento_contrato_status"]
          updated_at?: string
          valor_custo_total?: number
          valor_receita_total?: number
        }
        Relationships: [
          {
            foreignKeyName: "orcamento_contrato_ciclo_id_fkey"
            columns: ["ciclo_id"]
            isOneToOne: false
            referencedRelation: "orcamento_ciclo"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orcamento_contrato_contrato_id_fkey"
            columns: ["contrato_id"]
            isOneToOne: false
            referencedRelation: "contrato"
            referencedColumns: ["id"]
          },
        ]
      }
      orcamento_contrato_linha: {
        Row: {
          centro_custo_id: string | null
          ciclo_id: string | null
          competencia: string
          conta_contabil_id: string | null
          created_at: string
          dre_linha_id: string
          empresa_id: string
          id: string
          locked: boolean
          memoria_calculo: string | null
          orcamento_contrato_id: string | null
          origem: Database["public"]["Enums"]["orcamento_linha_origem"]
          source: Database["public"]["Enums"]["orcamento_linha_source"]
          sub_codigo: string | null
          updated_at: string
          valor_previsto: number
        }
        Insert: {
          centro_custo_id?: string | null
          ciclo_id?: string | null
          competencia: string
          conta_contabil_id?: string | null
          created_at?: string
          dre_linha_id: string
          empresa_id: string
          id?: string
          locked?: boolean
          memoria_calculo?: string | null
          orcamento_contrato_id?: string | null
          origem?: Database["public"]["Enums"]["orcamento_linha_origem"]
          source?: Database["public"]["Enums"]["orcamento_linha_source"]
          sub_codigo?: string | null
          updated_at?: string
          valor_previsto?: number
        }
        Update: {
          centro_custo_id?: string | null
          ciclo_id?: string | null
          competencia?: string
          conta_contabil_id?: string | null
          created_at?: string
          dre_linha_id?: string
          empresa_id?: string
          id?: string
          locked?: boolean
          memoria_calculo?: string | null
          orcamento_contrato_id?: string | null
          origem?: Database["public"]["Enums"]["orcamento_linha_origem"]
          source?: Database["public"]["Enums"]["orcamento_linha_source"]
          sub_codigo?: string | null
          updated_at?: string
          valor_previsto?: number
        }
        Relationships: [
          {
            foreignKeyName: "orcamento_contrato_linha_centro_custo_id_fkey"
            columns: ["centro_custo_id"]
            isOneToOne: false
            referencedRelation: "centros_custo"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orcamento_contrato_linha_ciclo_id_fkey"
            columns: ["ciclo_id"]
            isOneToOne: false
            referencedRelation: "orcamento_ciclo"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orcamento_contrato_linha_conta_contabil_id_fkey"
            columns: ["conta_contabil_id"]
            isOneToOne: false
            referencedRelation: "conta_contabil"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orcamento_contrato_linha_dre_linha_id_fkey"
            columns: ["dre_linha_id"]
            isOneToOne: false
            referencedRelation: "dre_linhas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orcamento_contrato_linha_orcamento_contrato_id_fkey"
            columns: ["orcamento_contrato_id"]
            isOneToOne: false
            referencedRelation: "orcamento_contrato"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orcamento_contrato_linha_orcamento_contrato_id_fkey"
            columns: ["orcamento_contrato_id"]
            isOneToOne: false
            referencedRelation: "vw_dre_contrato"
            referencedColumns: ["orcamento_contrato_id"]
          },
        ]
      }
      orcamento_contrato_linha_audit: {
        Row: {
          alterado_em: string
          alterado_por: string | null
          competencia: string | null
          dre_linha_id: string | null
          empresa_id: string | null
          id: string
          linha_id: string | null
          memoria_calculo: string | null
          operation: string
          orcamento_contrato_id: string | null
          valor_anterior: number | null
          valor_novo: number | null
        }
        Insert: {
          alterado_em?: string
          alterado_por?: string | null
          competencia?: string | null
          dre_linha_id?: string | null
          empresa_id?: string | null
          id?: string
          linha_id?: string | null
          memoria_calculo?: string | null
          operation: string
          orcamento_contrato_id?: string | null
          valor_anterior?: number | null
          valor_novo?: number | null
        }
        Update: {
          alterado_em?: string
          alterado_por?: string | null
          competencia?: string | null
          dre_linha_id?: string | null
          empresa_id?: string | null
          id?: string
          linha_id?: string | null
          memoria_calculo?: string | null
          operation?: string
          orcamento_contrato_id?: string | null
          valor_anterior?: number | null
          valor_novo?: number | null
        }
        Relationships: []
      }
      parametro_cotacao: {
        Row: {
          created_at: string
          empresa_id: string
          id: string
          min_propostas: number
          permite_emergencia: boolean
          permite_fornecedor_exclusivo: boolean
          peso_prazo_entrega: number
          peso_prazo_pagamento: number
          peso_preco: number
          updated_at: string
          valor_dispensa: number
        }
        Insert: {
          created_at?: string
          empresa_id: string
          id?: string
          min_propostas?: number
          permite_emergencia?: boolean
          permite_fornecedor_exclusivo?: boolean
          peso_prazo_entrega?: number
          peso_prazo_pagamento?: number
          peso_preco?: number
          updated_at?: string
          valor_dispensa?: number
        }
        Update: {
          created_at?: string
          empresa_id?: string
          id?: string
          min_propostas?: number
          permite_emergencia?: boolean
          permite_fornecedor_exclusivo?: boolean
          peso_prazo_entrega?: number
          peso_prazo_pagamento?: number
          peso_preco?: number
          updated_at?: string
          valor_dispensa?: number
        }
        Relationships: [
          {
            foreignKeyName: "parametro_cotacao_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: true
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "parametro_cotacao_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: true
            referencedRelation: "v_ia_contexto_empresa"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "parametro_cotacao_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: true
            referencedRelation: "vw_bi_resumo_empresa"
            referencedColumns: ["empresa_id"]
          },
        ]
      }
      parametro_fiscal: {
        Row: {
          ativo: boolean
          centro_custo_padrao_id: string | null
          conta_contabil_padrao_imposto_id: string | null
          created_at: string
          created_by: string | null
          creditavel_pis_cofins: boolean
          empresa_id: string
          id: string
          municipio_prestacao: string | null
          municipio_tomador: string | null
          observacoes: string | null
          regime_tributario: string
          regra_cofins: Json
          regra_folha_cpp_rat_terceiros: Json
          regra_irpj_csll: Json
          regra_iss: Json
          regra_pis: Json
          regra_retencao_inss: Json
          regra_retencao_irrf_csrf: Json
          updated_at: string
          vigencia_fim: string | null
          vigencia_inicio: string
        }
        Insert: {
          ativo?: boolean
          centro_custo_padrao_id?: string | null
          conta_contabil_padrao_imposto_id?: string | null
          created_at?: string
          created_by?: string | null
          creditavel_pis_cofins?: boolean
          empresa_id: string
          id?: string
          municipio_prestacao?: string | null
          municipio_tomador?: string | null
          observacoes?: string | null
          regime_tributario: string
          regra_cofins?: Json
          regra_folha_cpp_rat_terceiros?: Json
          regra_irpj_csll?: Json
          regra_iss?: Json
          regra_pis?: Json
          regra_retencao_inss?: Json
          regra_retencao_irrf_csrf?: Json
          updated_at?: string
          vigencia_fim?: string | null
          vigencia_inicio: string
        }
        Update: {
          ativo?: boolean
          centro_custo_padrao_id?: string | null
          conta_contabil_padrao_imposto_id?: string | null
          created_at?: string
          created_by?: string | null
          creditavel_pis_cofins?: boolean
          empresa_id?: string
          id?: string
          municipio_prestacao?: string | null
          municipio_tomador?: string | null
          observacoes?: string | null
          regime_tributario?: string
          regra_cofins?: Json
          regra_folha_cpp_rat_terceiros?: Json
          regra_irpj_csll?: Json
          regra_iss?: Json
          regra_pis?: Json
          regra_retencao_inss?: Json
          regra_retencao_irrf_csrf?: Json
          updated_at?: string
          vigencia_fim?: string | null
          vigencia_inicio?: string
        }
        Relationships: [
          {
            foreignKeyName: "parametro_fiscal_centro_custo_padrao_id_fkey"
            columns: ["centro_custo_padrao_id"]
            isOneToOne: false
            referencedRelation: "centros_custo"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "parametro_fiscal_conta_contabil_padrao_imposto_id_fkey"
            columns: ["conta_contabil_padrao_imposto_id"]
            isOneToOne: false
            referencedRelation: "conta_contabil"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "parametro_fiscal_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "parametro_fiscal_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "v_ia_contexto_empresa"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "parametro_fiscal_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "vw_bi_resumo_empresa"
            referencedColumns: ["empresa_id"]
          },
        ]
      }
      parametro_geral: {
        Row: {
          categoria: string | null
          chave: string
          created_at: string
          descricao: string | null
          empresa_id: string
          id: string
          tipo: string
          updated_at: string
          valor: string | null
        }
        Insert: {
          categoria?: string | null
          chave: string
          created_at?: string
          descricao?: string | null
          empresa_id: string
          id?: string
          tipo?: string
          updated_at?: string
          valor?: string | null
        }
        Update: {
          categoria?: string | null
          chave?: string
          created_at?: string
          descricao?: string | null
          empresa_id?: string
          id?: string
          tipo?: string
          updated_at?: string
          valor?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "parametro_geral_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "parametro_geral_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "v_ia_contexto_empresa"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "parametro_geral_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "vw_bi_resumo_empresa"
            referencedColumns: ["empresa_id"]
          },
        ]
      }
      parametro_integracao_bancaria: {
        Row: {
          baixa_automatica: boolean
          created_at: string
          dias_baixa_automatica: number
          email_notificacao_erros: string | null
          empresa_id: string
          modo_match: string
          notificar_divergencias: boolean
          tolerancia_dias: number
          tolerancia_valor: number
          updated_at: string
          webhook_global_url: string | null
        }
        Insert: {
          baixa_automatica?: boolean
          created_at?: string
          dias_baixa_automatica?: number
          email_notificacao_erros?: string | null
          empresa_id: string
          modo_match?: string
          notificar_divergencias?: boolean
          tolerancia_dias?: number
          tolerancia_valor?: number
          updated_at?: string
          webhook_global_url?: string | null
        }
        Update: {
          baixa_automatica?: boolean
          created_at?: string
          dias_baixa_automatica?: number
          email_notificacao_erros?: string | null
          empresa_id?: string
          modo_match?: string
          notificar_divergencias?: boolean
          tolerancia_dias?: number
          tolerancia_valor?: number
          updated_at?: string
          webhook_global_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "parametro_integracao_bancaria_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: true
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "parametro_integracao_bancaria_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: true
            referencedRelation: "v_ia_contexto_empresa"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "parametro_integracao_bancaria_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: true
            referencedRelation: "vw_bi_resumo_empresa"
            referencedColumns: ["empresa_id"]
          },
        ]
      }
      parametro_orcamento: {
        Row: {
          created_at: string
          empresa_id: string
          id: string
          observacoes: string | null
          pct_encargos_sociais: number
          pct_fgts: number
          pct_lucro_meta: number
          pct_provisoes: number
          pct_tributos_receita: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          empresa_id: string
          id?: string
          observacoes?: string | null
          pct_encargos_sociais?: number
          pct_fgts?: number
          pct_lucro_meta?: number
          pct_provisoes?: number
          pct_tributos_receita?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          empresa_id?: string
          id?: string
          observacoes?: string | null
          pct_encargos_sociais?: number
          pct_fgts?: number
          pct_lucro_meta?: number
          pct_provisoes?: number
          pct_tributos_receita?: number
          updated_at?: string
        }
        Relationships: []
      }
      pedido_compra: {
        Row: {
          centro_custo_id: string | null
          condicao_pagamento: string | null
          created_at: string
          data_emissao: string
          data_entrega_prevista: string | null
          empresa_id: string
          fornecedor_id: string
          id: string
          numero: string
          observacoes: string | null
          requisicao_id: string | null
          status: Database["public"]["Enums"]["pedido_compra_status"]
          updated_at: string
          valor_total: number
        }
        Insert: {
          centro_custo_id?: string | null
          condicao_pagamento?: string | null
          created_at?: string
          data_emissao?: string
          data_entrega_prevista?: string | null
          empresa_id: string
          fornecedor_id: string
          id?: string
          numero: string
          observacoes?: string | null
          requisicao_id?: string | null
          status?: Database["public"]["Enums"]["pedido_compra_status"]
          updated_at?: string
          valor_total?: number
        }
        Update: {
          centro_custo_id?: string | null
          condicao_pagamento?: string | null
          created_at?: string
          data_emissao?: string
          data_entrega_prevista?: string | null
          empresa_id?: string
          fornecedor_id?: string
          id?: string
          numero?: string
          observacoes?: string | null
          requisicao_id?: string | null
          status?: Database["public"]["Enums"]["pedido_compra_status"]
          updated_at?: string
          valor_total?: number
        }
        Relationships: []
      }
      pedido_compra_item: {
        Row: {
          created_at: string
          descricao: string
          id: string
          pedido_id: string
          preco_unitario: number
          produto_servico_id: string | null
          quantidade: number
          valor_total: number | null
        }
        Insert: {
          created_at?: string
          descricao: string
          id?: string
          pedido_id: string
          preco_unitario?: number
          produto_servico_id?: string | null
          quantidade?: number
          valor_total?: number | null
        }
        Update: {
          created_at?: string
          descricao?: string
          id?: string
          pedido_id?: string
          preco_unitario?: number
          produto_servico_id?: string | null
          quantidade?: number
          valor_total?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "pedido_compra_item_pedido_id_fkey"
            columns: ["pedido_id"]
            isOneToOne: false
            referencedRelation: "pedido_compra"
            referencedColumns: ["id"]
          },
        ]
      }
      perfil_metadata: {
        Row: {
          cor: string | null
          descricao: string | null
          icone: string | null
          nome: string | null
          role: Database["public"]["Enums"]["app_role"]
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          cor?: string | null
          descricao?: string | null
          icone?: string | null
          nome?: string | null
          role: Database["public"]["Enums"]["app_role"]
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          cor?: string | null
          descricao?: string | null
          icone?: string | null
          nome?: string | null
          role?: Database["public"]["Enums"]["app_role"]
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      permission_migration_snapshot: {
        Row: {
          app_menu: Json
          captured_at: string
          counts: Json
          id: string
          migration_tag: string
          perfil_metadata: Json
          role_permissions: Json
          screen_permission_profile: Json
          screen_permission_user: Json
          user_roles: Json
        }
        Insert: {
          app_menu?: Json
          captured_at?: string
          counts?: Json
          id?: string
          migration_tag: string
          perfil_metadata?: Json
          role_permissions?: Json
          screen_permission_profile?: Json
          screen_permission_user?: Json
          user_roles?: Json
        }
        Update: {
          app_menu?: Json
          captured_at?: string
          counts?: Json
          id?: string
          migration_tag?: string
          perfil_metadata?: Json
          role_permissions?: Json
          screen_permission_profile?: Json
          screen_permission_user?: Json
          user_roles?: Json
        }
        Relationships: []
      }
      permissoes_especiais: {
        Row: {
          concedido_em: string
          concedido_por: string | null
          id: string
          motivo: string | null
          permissao: string
          user_id: string
        }
        Insert: {
          concedido_em?: string
          concedido_por?: string | null
          id?: string
          motivo?: string | null
          permissao: string
          user_id: string
        }
        Update: {
          concedido_em?: string
          concedido_por?: string | null
          id?: string
          motivo?: string | null
          permissao?: string
          user_id?: string
        }
        Relationships: []
      }
      plano_acao: {
        Row: {
          acao: string | null
          area: string | null
          arquivo_origem: string | null
          atualizado_por: string | null
          centro_custo_id: string | null
          comentarios: string | null
          comite: string | null
          contrato_id: string | null
          created_at: string
          criado_por: string | null
          custo_previsto: number
          custo_realizado: number
          data_acao: string | null
          data_acao_original: string | null
          data_fim_planejado: string | null
          data_fim_planejado_original: string | null
          data_fim_real: string | null
          data_fim_real_original: string | null
          data_inicio_planejado: string | null
          data_inicio_planejado_original: string | null
          data_inicio_real: string | null
          data_inicio_real_original: string | null
          deleted_at: string | null
          duracao_original: string | null
          empresa_id: string
          hash_origem: string | null
          id: string
          id_importacao: string | null
          lider_comite_nome_origem: string | null
          lider_comite_profile_id: string | null
          lider_setor_nome_origem: string | null
          lider_setor_profile_id: string | null
          linha_csv: number | null
          metadata_origem: Json | null
          ordem: number | null
          origem: string
          pendencia_datas: boolean
          pendencia_evidencia: boolean
          pendencia_responsavel: boolean
          pendencias_iniciais: string[]
          pontuacao_original: string | null
          prioridade_normalizada: string | null
          prioridade_original: string | null
          problema: string | null
          responsavel_nome_origem: string | null
          responsavel_profile_id: string | null
          score_fim_original: string | null
          score_geral_original: string | null
          score_inicio_original: string | null
          setor: string | null
          status_normalizado: string
          status_original: string | null
          titulo: string | null
          today_original: string | null
          updated_at: string
          validacao_original: string | null
        }
        Insert: {
          acao?: string | null
          area?: string | null
          arquivo_origem?: string | null
          atualizado_por?: string | null
          centro_custo_id?: string | null
          comentarios?: string | null
          comite?: string | null
          contrato_id?: string | null
          created_at?: string
          criado_por?: string | null
          custo_previsto?: number
          custo_realizado?: number
          data_acao?: string | null
          data_acao_original?: string | null
          data_fim_planejado?: string | null
          data_fim_planejado_original?: string | null
          data_fim_real?: string | null
          data_fim_real_original?: string | null
          data_inicio_planejado?: string | null
          data_inicio_planejado_original?: string | null
          data_inicio_real?: string | null
          data_inicio_real_original?: string | null
          deleted_at?: string | null
          duracao_original?: string | null
          empresa_id: string
          hash_origem?: string | null
          id?: string
          id_importacao?: string | null
          lider_comite_nome_origem?: string | null
          lider_comite_profile_id?: string | null
          lider_setor_nome_origem?: string | null
          lider_setor_profile_id?: string | null
          linha_csv?: number | null
          metadata_origem?: Json | null
          ordem?: number | null
          origem?: string
          pendencia_datas?: boolean
          pendencia_evidencia?: boolean
          pendencia_responsavel?: boolean
          pendencias_iniciais?: string[]
          pontuacao_original?: string | null
          prioridade_normalizada?: string | null
          prioridade_original?: string | null
          problema?: string | null
          responsavel_nome_origem?: string | null
          responsavel_profile_id?: string | null
          score_fim_original?: string | null
          score_geral_original?: string | null
          score_inicio_original?: string | null
          setor?: string | null
          status_normalizado?: string
          status_original?: string | null
          titulo?: string | null
          today_original?: string | null
          updated_at?: string
          validacao_original?: string | null
        }
        Update: {
          acao?: string | null
          area?: string | null
          arquivo_origem?: string | null
          atualizado_por?: string | null
          centro_custo_id?: string | null
          comentarios?: string | null
          comite?: string | null
          contrato_id?: string | null
          created_at?: string
          criado_por?: string | null
          custo_previsto?: number
          custo_realizado?: number
          data_acao?: string | null
          data_acao_original?: string | null
          data_fim_planejado?: string | null
          data_fim_planejado_original?: string | null
          data_fim_real?: string | null
          data_fim_real_original?: string | null
          data_inicio_planejado?: string | null
          data_inicio_planejado_original?: string | null
          data_inicio_real?: string | null
          data_inicio_real_original?: string | null
          deleted_at?: string | null
          duracao_original?: string | null
          empresa_id?: string
          hash_origem?: string | null
          id?: string
          id_importacao?: string | null
          lider_comite_nome_origem?: string | null
          lider_comite_profile_id?: string | null
          lider_setor_nome_origem?: string | null
          lider_setor_profile_id?: string | null
          linha_csv?: number | null
          metadata_origem?: Json | null
          ordem?: number | null
          origem?: string
          pendencia_datas?: boolean
          pendencia_evidencia?: boolean
          pendencia_responsavel?: boolean
          pendencias_iniciais?: string[]
          pontuacao_original?: string | null
          prioridade_normalizada?: string | null
          prioridade_original?: string | null
          problema?: string | null
          responsavel_nome_origem?: string | null
          responsavel_profile_id?: string | null
          score_fim_original?: string | null
          score_geral_original?: string | null
          score_inicio_original?: string | null
          setor?: string | null
          status_normalizado?: string
          status_original?: string | null
          titulo?: string | null
          today_original?: string | null
          updated_at?: string
          validacao_original?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "plano_acao_atualizado_por_fkey"
            columns: ["atualizado_por"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plano_acao_centro_custo_id_fkey"
            columns: ["centro_custo_id"]
            isOneToOne: false
            referencedRelation: "centros_custo"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plano_acao_contrato_id_fkey"
            columns: ["contrato_id"]
            isOneToOne: false
            referencedRelation: "contrato"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plano_acao_criado_por_fkey"
            columns: ["criado_por"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plano_acao_lider_comite_profile_id_fkey"
            columns: ["lider_comite_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plano_acao_lider_setor_profile_id_fkey"
            columns: ["lider_setor_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plano_acao_responsavel_profile_id_fkey"
            columns: ["responsavel_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      plano_acao_anexo: {
        Row: {
          bucket: string
          created_at: string
          criado_por: string | null
          empresa_id: string
          id: string
          nome_arquivo: string
          plano_acao_id: string
          storage_path: string
          tamanho_bytes: number | null
          tipo_mime: string | null
        }
        Insert: {
          bucket?: string
          created_at?: string
          criado_por?: string | null
          empresa_id: string
          id?: string
          nome_arquivo: string
          plano_acao_id: string
          storage_path: string
          tamanho_bytes?: number | null
          tipo_mime?: string | null
        }
        Update: {
          bucket?: string
          created_at?: string
          criado_por?: string | null
          empresa_id?: string
          id?: string
          nome_arquivo?: string
          plano_acao_id?: string
          storage_path?: string
          tamanho_bytes?: number | null
          tipo_mime?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "plano_acao_anexo_criado_por_fkey"
            columns: ["criado_por"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plano_acao_anexo_plano_acao_id_fkey"
            columns: ["plano_acao_id"]
            isOneToOne: false
            referencedRelation: "plano_acao"
            referencedColumns: ["id"]
          },
        ]
      }
      plano_acao_backfill_responsavel_audit: {
        Row: {
          empresa_id: string
          executado_em: string
          executado_por: string | null
          id: number
          lote: string
          pendencia_responsavel_antes: boolean | null
          pendencia_responsavel_depois: boolean | null
          plano_id: string
          responsavel_nome_origem: string | null
          responsavel_profile_id_antes: string | null
          responsavel_profile_id_depois: string | null
          tipo_match: string
        }
        Insert: {
          empresa_id: string
          executado_em?: string
          executado_por?: string | null
          id?: number
          lote: string
          pendencia_responsavel_antes?: boolean | null
          pendencia_responsavel_depois?: boolean | null
          plano_id: string
          responsavel_nome_origem?: string | null
          responsavel_profile_id_antes?: string | null
          responsavel_profile_id_depois?: string | null
          tipo_match: string
        }
        Update: {
          empresa_id?: string
          executado_em?: string
          executado_por?: string | null
          id?: number
          lote?: string
          pendencia_responsavel_antes?: boolean | null
          pendencia_responsavel_depois?: boolean | null
          plano_id?: string
          responsavel_nome_origem?: string | null
          responsavel_profile_id_antes?: string | null
          responsavel_profile_id_depois?: string | null
          tipo_match?: string
        }
        Relationships: []
      }
      plano_acao_comentario: {
        Row: {
          comentario: string
          created_at: string
          criado_por: string | null
          empresa_id: string
          id: string
          plano_acao_id: string
        }
        Insert: {
          comentario: string
          created_at?: string
          criado_por?: string | null
          empresa_id: string
          id?: string
          plano_acao_id: string
        }
        Update: {
          comentario?: string
          created_at?: string
          criado_por?: string | null
          empresa_id?: string
          id?: string
          plano_acao_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "plano_acao_comentario_criado_por_fkey"
            columns: ["criado_por"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plano_acao_comentario_plano_acao_id_fkey"
            columns: ["plano_acao_id"]
            isOneToOne: false
            referencedRelation: "plano_acao"
            referencedColumns: ["id"]
          },
        ]
      }
      plano_acao_historico: {
        Row: {
          campo: string | null
          created_at: string
          criado_por: string | null
          empresa_id: string
          evento: string
          id: string
          metadata: Json | null
          plano_acao_id: string
          valor_anterior: string | null
          valor_novo: string | null
        }
        Insert: {
          campo?: string | null
          created_at?: string
          criado_por?: string | null
          empresa_id: string
          evento: string
          id?: string
          metadata?: Json | null
          plano_acao_id: string
          valor_anterior?: string | null
          valor_novo?: string | null
        }
        Update: {
          campo?: string | null
          created_at?: string
          criado_por?: string | null
          empresa_id?: string
          evento?: string
          id?: string
          metadata?: Json | null
          plano_acao_id?: string
          valor_anterior?: string | null
          valor_novo?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "plano_acao_historico_criado_por_fkey"
            columns: ["criado_por"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plano_acao_historico_plano_acao_id_fkey"
            columns: ["plano_acao_id"]
            isOneToOne: false
            referencedRelation: "plano_acao"
            referencedColumns: ["id"]
          },
        ]
      }
      plano_acao_import_batch: {
        Row: {
          arquivo_nome: string | null
          created_at: string
          criado_por: string | null
          empresa_id: string
          id: string
          metadata: Json | null
          status: string
          total_importado: number
          total_linhas: number
          total_pendente: number
        }
        Insert: {
          arquivo_nome?: string | null
          created_at?: string
          criado_por?: string | null
          empresa_id: string
          id?: string
          metadata?: Json | null
          status?: string
          total_importado?: number
          total_linhas?: number
          total_pendente?: number
        }
        Update: {
          arquivo_nome?: string | null
          created_at?: string
          criado_por?: string | null
          empresa_id?: string
          id?: string
          metadata?: Json | null
          status?: string
          total_importado?: number
          total_linhas?: number
          total_pendente?: number
        }
        Relationships: [
          {
            foreignKeyName: "plano_acao_import_batch_criado_por_fkey"
            columns: ["criado_por"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      plano_acao_import_item: {
        Row: {
          batch_id: string
          created_at: string
          empresa_id: string
          hash_origem: string | null
          id: string
          id_importacao: string | null
          linha_csv: number | null
          payload_original: Json | null
          pendencias: string[]
          plano_acao_id: string | null
          status: string
        }
        Insert: {
          batch_id: string
          created_at?: string
          empresa_id: string
          hash_origem?: string | null
          id?: string
          id_importacao?: string | null
          linha_csv?: number | null
          payload_original?: Json | null
          pendencias?: string[]
          plano_acao_id?: string | null
          status?: string
        }
        Update: {
          batch_id?: string
          created_at?: string
          empresa_id?: string
          hash_origem?: string | null
          id?: string
          id_importacao?: string | null
          linha_csv?: number | null
          payload_original?: Json | null
          pendencias?: string[]
          plano_acao_id?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "plano_acao_import_item_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "plano_acao_import_batch"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plano_acao_import_item_plano_acao_id_fkey"
            columns: ["plano_acao_id"]
            isOneToOne: false
            referencedRelation: "plano_acao"
            referencedColumns: ["id"]
          },
        ]
      }
      plano_acao_usuario_permissao: {
        Row: {
          created_at: string
          empresa_id: string
          id: string
          pode_administrar: boolean
          pode_aprovar: boolean
          pode_criar: boolean
          pode_dashboard: boolean
          pode_editar: boolean
          pode_excluir: boolean
          pode_importar: boolean
          pode_visualizar: boolean
          profile_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          empresa_id: string
          id?: string
          pode_administrar?: boolean
          pode_aprovar?: boolean
          pode_criar?: boolean
          pode_dashboard?: boolean
          pode_editar?: boolean
          pode_excluir?: boolean
          pode_importar?: boolean
          pode_visualizar?: boolean
          profile_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          empresa_id?: string
          id?: string
          pode_administrar?: boolean
          pode_aprovar?: boolean
          pode_criar?: boolean
          pode_dashboard?: boolean
          pode_editar?: boolean
          pode_excluir?: boolean
          pode_importar?: boolean
          pode_visualizar?: boolean
          profile_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "plano_acao_usuario_permissao_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      plano_contas_master: {
        Row: {
          ativo: boolean
          centro_custo_padrao: string | null
          classificacao: string
          conta_reduzida: number
          created_at: string
          descricao: string
          dre_linha_id: string | null
          entra_fluxo: boolean
          entra_orcamento: boolean
          exige_contrato: Database["public"]["Enums"]["conta_exige_contrato"]
          grupo_dre: Database["public"]["Enums"]["conta_grupo_dre"]
          id: string
          natureza: Database["public"]["Enums"]["conta_natureza"]
          parent_id: string | null
          tipo: Database["public"]["Enums"]["conta_tipo"]
          updated_at: string
        }
        Insert: {
          ativo?: boolean
          centro_custo_padrao?: string | null
          classificacao: string
          conta_reduzida: number
          created_at?: string
          descricao: string
          dre_linha_id?: string | null
          entra_fluxo?: boolean
          entra_orcamento?: boolean
          exige_contrato?: Database["public"]["Enums"]["conta_exige_contrato"]
          grupo_dre?: Database["public"]["Enums"]["conta_grupo_dre"]
          id?: string
          natureza: Database["public"]["Enums"]["conta_natureza"]
          parent_id?: string | null
          tipo: Database["public"]["Enums"]["conta_tipo"]
          updated_at?: string
        }
        Update: {
          ativo?: boolean
          centro_custo_padrao?: string | null
          classificacao?: string
          conta_reduzida?: number
          created_at?: string
          descricao?: string
          dre_linha_id?: string | null
          entra_fluxo?: boolean
          entra_orcamento?: boolean
          exige_contrato?: Database["public"]["Enums"]["conta_exige_contrato"]
          grupo_dre?: Database["public"]["Enums"]["conta_grupo_dre"]
          id?: string
          natureza?: Database["public"]["Enums"]["conta_natureza"]
          parent_id?: string | null
          tipo?: Database["public"]["Enums"]["conta_tipo"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "plano_contas_master_dre_linha_id_fkey"
            columns: ["dre_linha_id"]
            isOneToOne: false
            referencedRelation: "dre_linhas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plano_contas_master_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "plano_contas_master"
            referencedColumns: ["id"]
          },
        ]
      }
      plano_contas_solicitacao: {
        Row: {
          ativo: boolean | null
          centro_custo_padrao: string | null
          classificacao: string | null
          conta_contabil_id: string | null
          created_at: string
          decidido_em: string | null
          decidido_por: string | null
          descricao: string | null
          dre_linha_id: string | null
          empresa_id: string
          entra_fluxo: boolean | null
          entra_orcamento: boolean | null
          exige_contrato:
            | Database["public"]["Enums"]["conta_exige_contrato"]
            | null
          grupo_dre: Database["public"]["Enums"]["conta_grupo_dre"] | null
          id: string
          justificativa: string
          motivo_decisao: string | null
          natureza: Database["public"]["Enums"]["conta_natureza"] | null
          parent_classificacao: string | null
          solicitado_em: string
          solicitado_por: string
          status: Database["public"]["Enums"]["pcs_status"]
          tipo: Database["public"]["Enums"]["pcs_tipo"]
          tipo_conta: Database["public"]["Enums"]["conta_tipo"] | null
          updated_at: string
        }
        Insert: {
          ativo?: boolean | null
          centro_custo_padrao?: string | null
          classificacao?: string | null
          conta_contabil_id?: string | null
          created_at?: string
          decidido_em?: string | null
          decidido_por?: string | null
          descricao?: string | null
          dre_linha_id?: string | null
          empresa_id: string
          entra_fluxo?: boolean | null
          entra_orcamento?: boolean | null
          exige_contrato?:
            | Database["public"]["Enums"]["conta_exige_contrato"]
            | null
          grupo_dre?: Database["public"]["Enums"]["conta_grupo_dre"] | null
          id?: string
          justificativa: string
          motivo_decisao?: string | null
          natureza?: Database["public"]["Enums"]["conta_natureza"] | null
          parent_classificacao?: string | null
          solicitado_em?: string
          solicitado_por?: string
          status?: Database["public"]["Enums"]["pcs_status"]
          tipo: Database["public"]["Enums"]["pcs_tipo"]
          tipo_conta?: Database["public"]["Enums"]["conta_tipo"] | null
          updated_at?: string
        }
        Update: {
          ativo?: boolean | null
          centro_custo_padrao?: string | null
          classificacao?: string | null
          conta_contabil_id?: string | null
          created_at?: string
          decidido_em?: string | null
          decidido_por?: string | null
          descricao?: string | null
          dre_linha_id?: string | null
          empresa_id?: string
          entra_fluxo?: boolean | null
          entra_orcamento?: boolean | null
          exige_contrato?:
            | Database["public"]["Enums"]["conta_exige_contrato"]
            | null
          grupo_dre?: Database["public"]["Enums"]["conta_grupo_dre"] | null
          id?: string
          justificativa?: string
          motivo_decisao?: string | null
          natureza?: Database["public"]["Enums"]["conta_natureza"] | null
          parent_classificacao?: string | null
          solicitado_em?: string
          solicitado_por?: string
          status?: Database["public"]["Enums"]["pcs_status"]
          tipo?: Database["public"]["Enums"]["pcs_tipo"]
          tipo_conta?: Database["public"]["Enums"]["conta_tipo"] | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "plano_contas_solicitacao_conta_contabil_id_fkey"
            columns: ["conta_contabil_id"]
            isOneToOne: false
            referencedRelation: "conta_contabil"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plano_contas_solicitacao_dre_linha_id_fkey"
            columns: ["dre_linha_id"]
            isOneToOne: false
            referencedRelation: "dre_linhas"
            referencedColumns: ["id"]
          },
        ]
      }
      pre_titulo_anexo: {
        Row: {
          created_at: string
          file_name: string
          id: string
          mime_type: string | null
          pre_titulo_id: string
          size_bytes: number | null
          storage_path: string
          tipo: string | null
          uploaded_by: string | null
        }
        Insert: {
          created_at?: string
          file_name: string
          id?: string
          mime_type?: string | null
          pre_titulo_id: string
          size_bytes?: number | null
          storage_path: string
          tipo?: string | null
          uploaded_by?: string | null
        }
        Update: {
          created_at?: string
          file_name?: string
          id?: string
          mime_type?: string | null
          pre_titulo_id?: string
          size_bytes?: number | null
          storage_path?: string
          tipo?: string | null
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pre_titulo_anexo_pre_titulo_id_fkey"
            columns: ["pre_titulo_id"]
            isOneToOne: false
            referencedRelation: "pre_titulo_pagar"
            referencedColumns: ["id"]
          },
        ]
      }
      pre_titulo_pagar: {
        Row: {
          aprovado_em: string | null
          aprovador_id: string | null
          centro_custo_id: string | null
          competencia: string | null
          conta_contabil_id: string | null
          contrato_id: string | null
          created_at: string
          data_emissao: string
          data_vencimento: string
          descricao: string
          empresa_id: string
          forma_pagamento:
            | Database["public"]["Enums"]["titulo_receber_meio"]
            | null
          fornecedor_id: string | null
          id: string
          motivo_rejeicao: string | null
          numero_documento: string | null
          observacoes: string | null
          parcelado: boolean
          solicitante_id: string | null
          status: Database["public"]["Enums"]["pre_titulo_status"]
          titulo_pagar_id: string | null
          updated_at: string
          valor: number
        }
        Insert: {
          aprovado_em?: string | null
          aprovador_id?: string | null
          centro_custo_id?: string | null
          competencia?: string | null
          conta_contabil_id?: string | null
          contrato_id?: string | null
          created_at?: string
          data_emissao?: string
          data_vencimento: string
          descricao: string
          empresa_id: string
          forma_pagamento?:
            | Database["public"]["Enums"]["titulo_receber_meio"]
            | null
          fornecedor_id?: string | null
          id?: string
          motivo_rejeicao?: string | null
          numero_documento?: string | null
          observacoes?: string | null
          parcelado?: boolean
          solicitante_id?: string | null
          status?: Database["public"]["Enums"]["pre_titulo_status"]
          titulo_pagar_id?: string | null
          updated_at?: string
          valor: number
        }
        Update: {
          aprovado_em?: string | null
          aprovador_id?: string | null
          centro_custo_id?: string | null
          competencia?: string | null
          conta_contabil_id?: string | null
          contrato_id?: string | null
          created_at?: string
          data_emissao?: string
          data_vencimento?: string
          descricao?: string
          empresa_id?: string
          forma_pagamento?:
            | Database["public"]["Enums"]["titulo_receber_meio"]
            | null
          fornecedor_id?: string | null
          id?: string
          motivo_rejeicao?: string | null
          numero_documento?: string | null
          observacoes?: string | null
          parcelado?: boolean
          solicitante_id?: string | null
          status?: Database["public"]["Enums"]["pre_titulo_status"]
          titulo_pagar_id?: string | null
          updated_at?: string
          valor?: number
        }
        Relationships: [
          {
            foreignKeyName: "pre_titulo_pagar_centro_custo_id_fkey"
            columns: ["centro_custo_id"]
            isOneToOne: false
            referencedRelation: "centros_custo"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pre_titulo_pagar_conta_contabil_id_fkey"
            columns: ["conta_contabil_id"]
            isOneToOne: false
            referencedRelation: "conta_contabil"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pre_titulo_pagar_contrato_id_fkey"
            columns: ["contrato_id"]
            isOneToOne: false
            referencedRelation: "contrato"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pre_titulo_pagar_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pre_titulo_pagar_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "v_ia_contexto_empresa"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "pre_titulo_pagar_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "vw_bi_resumo_empresa"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "pre_titulo_pagar_fornecedor_id_fkey"
            columns: ["fornecedor_id"]
            isOneToOne: false
            referencedRelation: "fornecedor"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pre_titulo_pagar_titulo_pagar_id_fkey"
            columns: ["titulo_pagar_id"]
            isOneToOne: false
            referencedRelation: "titulo_pagar"
            referencedColumns: ["id"]
          },
        ]
      }
      pre_titulo_parcela: {
        Row: {
          created_at: string
          data_vencimento: string
          id: string
          numero: number
          pre_titulo_id: string
          updated_at: string
          valor: number
        }
        Insert: {
          created_at?: string
          data_vencimento: string
          id?: string
          numero: number
          pre_titulo_id: string
          updated_at?: string
          valor: number
        }
        Update: {
          created_at?: string
          data_vencimento?: string
          id?: string
          numero?: number
          pre_titulo_id?: string
          updated_at?: string
          valor?: number
        }
        Relationships: [
          {
            foreignKeyName: "pre_titulo_parcela_pre_titulo_id_fkey"
            columns: ["pre_titulo_id"]
            isOneToOne: false
            referencedRelation: "pre_titulo_pagar"
            referencedColumns: ["id"]
          },
        ]
      }
      pre_titulo_rateio: {
        Row: {
          centro_custo_id: string
          conta_contabil_id: string | null
          created_at: string
          descricao: string | null
          id: string
          percentual: number | null
          pre_titulo_id: string
          valor: number
        }
        Insert: {
          centro_custo_id: string
          conta_contabil_id?: string | null
          created_at?: string
          descricao?: string | null
          id?: string
          percentual?: number | null
          pre_titulo_id: string
          valor: number
        }
        Update: {
          centro_custo_id?: string
          conta_contabil_id?: string | null
          created_at?: string
          descricao?: string | null
          id?: string
          percentual?: number | null
          pre_titulo_id?: string
          valor?: number
        }
        Relationships: [
          {
            foreignKeyName: "pre_titulo_rateio_centro_custo_id_fkey"
            columns: ["centro_custo_id"]
            isOneToOne: false
            referencedRelation: "centros_custo"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pre_titulo_rateio_conta_contabil_id_fkey"
            columns: ["conta_contabil_id"]
            isOneToOne: false
            referencedRelation: "conta_contabil"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pre_titulo_rateio_pre_titulo_id_fkey"
            columns: ["pre_titulo_id"]
            isOneToOne: false
            referencedRelation: "pre_titulo_pagar"
            referencedColumns: ["id"]
          },
        ]
      }
      produto: {
        Row: {
          ativo: boolean
          categoria_id: string | null
          codigo: string
          codigo_externo: string | null
          controla_lote: boolean
          controla_validade: boolean
          created_at: string
          custo_medio_atual: number
          descricao: string
          empresa_id: string
          estoque_maximo: number | null
          estoque_minimo: number
          id: string
          metodo_custeio: Database["public"]["Enums"]["produto_metodo_custeio"]
          observacoes: string | null
          preco_referencia: number
          unidade: string
          updated_at: string
        }
        Insert: {
          ativo?: boolean
          categoria_id?: string | null
          codigo: string
          codigo_externo?: string | null
          controla_lote?: boolean
          controla_validade?: boolean
          created_at?: string
          custo_medio_atual?: number
          descricao: string
          empresa_id: string
          estoque_maximo?: number | null
          estoque_minimo?: number
          id?: string
          metodo_custeio?: Database["public"]["Enums"]["produto_metodo_custeio"]
          observacoes?: string | null
          preco_referencia?: number
          unidade?: string
          updated_at?: string
        }
        Update: {
          ativo?: boolean
          categoria_id?: string | null
          codigo?: string
          codigo_externo?: string | null
          controla_lote?: boolean
          controla_validade?: boolean
          created_at?: string
          custo_medio_atual?: number
          descricao?: string
          empresa_id?: string
          estoque_maximo?: number | null
          estoque_minimo?: number
          id?: string
          metodo_custeio?: Database["public"]["Enums"]["produto_metodo_custeio"]
          observacoes?: string | null
          preco_referencia?: number
          unidade?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "produto_categoria_id_fkey"
            columns: ["categoria_id"]
            isOneToOne: false
            referencedRelation: "produto_categoria"
            referencedColumns: ["id"]
          },
        ]
      }
      produto_categoria: {
        Row: {
          ativo: boolean
          codigo: string
          controla_lote_padrao: boolean
          controla_validade_padrao: boolean
          created_at: string
          descricao: string | null
          empresa_id: string
          id: string
          nome: string
          updated_at: string
        }
        Insert: {
          ativo?: boolean
          codigo: string
          controla_lote_padrao?: boolean
          controla_validade_padrao?: boolean
          created_at?: string
          descricao?: string | null
          empresa_id: string
          id?: string
          nome: string
          updated_at?: string
        }
        Update: {
          ativo?: boolean
          codigo?: string
          controla_lote_padrao?: boolean
          controla_validade_padrao?: boolean
          created_at?: string
          descricao?: string | null
          empresa_id?: string
          id?: string
          nome?: string
          updated_at?: string
        }
        Relationships: []
      }
      produto_servico: {
        Row: {
          ativo: boolean
          codigo: string
          created_at: string
          descricao: string
          empresa_id: string
          id: string
          preco_referencia: number
          tipo: Database["public"]["Enums"]["prod_serv_tipo"]
          unidade: string
          updated_at: string
        }
        Insert: {
          ativo?: boolean
          codigo: string
          created_at?: string
          descricao: string
          empresa_id: string
          id?: string
          preco_referencia?: number
          tipo?: Database["public"]["Enums"]["prod_serv_tipo"]
          unidade?: string
          updated_at?: string
        }
        Update: {
          ativo?: boolean
          codigo?: string
          created_at?: string
          descricao?: string
          empresa_id?: string
          id?: string
          preco_referencia?: number
          tipo?: Database["public"]["Enums"]["prod_serv_tipo"]
          unidade?: string
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          acessa_todas_empresas: boolean
          ativo: boolean
          avatar_url: string | null
          created_at: string
          display_name: string | null
          email: string | null
          empresa_atual_id: string | null
          empresa_id: string | null
          id: string
          must_change_password: boolean
          updated_at: string
        }
        Insert: {
          acessa_todas_empresas?: boolean
          ativo?: boolean
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          email?: string | null
          empresa_atual_id?: string | null
          empresa_id?: string | null
          id: string
          must_change_password?: boolean
          updated_at?: string
        }
        Update: {
          acessa_todas_empresas?: boolean
          ativo?: boolean
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          email?: string | null
          empresa_atual_id?: string | null
          empresa_id?: string | null
          id?: string
          must_change_password?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_empresa_atual_id_fkey"
            columns: ["empresa_atual_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profiles_empresa_atual_id_fkey"
            columns: ["empresa_atual_id"]
            isOneToOne: false
            referencedRelation: "v_ia_contexto_empresa"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "profiles_empresa_atual_id_fkey"
            columns: ["empresa_atual_id"]
            isOneToOne: false
            referencedRelation: "vw_bi_resumo_empresa"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "profiles_empresa_fk"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profiles_empresa_fk"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "v_ia_contexto_empresa"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "profiles_empresa_fk"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "vw_bi_resumo_empresa"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "profiles_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profiles_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "v_ia_contexto_empresa"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "profiles_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "vw_bi_resumo_empresa"
            referencedColumns: ["empresa_id"]
          },
        ]
      }
      realizado_lancamentos: {
        Row: {
          batch_id: string | null
          centro_custo_id: string | null
          classificadores: Json
          contraparte: string | null
          created_at: string
          data_competencia: string
          data_lancamento: string
          descricao: string
          documento: string | null
          dre_linha_id: string | null
          empresa_id: string
          hash_dedup: string | null
          id: string
          lote_id: string | null
          observacoes: string | null
          origem_externa_id: string | null
          pendente_conta_contabil: boolean
          updated_at: string
          valor: number
        }
        Insert: {
          batch_id?: string | null
          centro_custo_id?: string | null
          classificadores?: Json
          contraparte?: string | null
          created_at?: string
          data_competencia: string
          data_lancamento: string
          descricao: string
          documento?: string | null
          dre_linha_id?: string | null
          empresa_id: string
          hash_dedup?: string | null
          id?: string
          lote_id?: string | null
          observacoes?: string | null
          origem_externa_id?: string | null
          pendente_conta_contabil?: boolean
          updated_at?: string
          valor: number
        }
        Update: {
          batch_id?: string | null
          centro_custo_id?: string | null
          classificadores?: Json
          contraparte?: string | null
          created_at?: string
          data_competencia?: string
          data_lancamento?: string
          descricao?: string
          documento?: string | null
          dre_linha_id?: string | null
          empresa_id?: string
          hash_dedup?: string | null
          id?: string
          lote_id?: string | null
          observacoes?: string | null
          origem_externa_id?: string | null
          pendente_conta_contabil?: boolean
          updated_at?: string
          valor?: number
        }
        Relationships: [
          {
            foreignKeyName: "realizado_lancamentos_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "integration_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "realizado_lancamentos_centro_custo_id_fkey"
            columns: ["centro_custo_id"]
            isOneToOne: false
            referencedRelation: "centros_custo"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "realizado_lancamentos_dre_linha_id_fkey"
            columns: ["dre_linha_id"]
            isOneToOne: false
            referencedRelation: "dre_linhas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "realizado_lancamentos_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "realizado_lancamentos_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "v_ia_contexto_empresa"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "realizado_lancamentos_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "vw_bi_resumo_empresa"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "realizado_lancamentos_lote_id_fkey"
            columns: ["lote_id"]
            isOneToOne: false
            referencedRelation: "realizado_lotes"
            referencedColumns: ["id"]
          },
        ]
      }
      realizado_lotes: {
        Row: {
          arquivo_nome: string | null
          arquivo_path: string | null
          created_at: string
          empresa_id: string
          erro_msg: string | null
          id: string
          importado_em: string
          importado_por: string | null
          observacoes: string | null
          origem: Database["public"]["Enums"]["lote_origem"]
          processado_em: string | null
          referencia_ano: number
          referencia_mes: number
          status: Database["public"]["Enums"]["lote_status"]
          total_lancamentos: number
          total_valor: number
          updated_at: string
        }
        Insert: {
          arquivo_nome?: string | null
          arquivo_path?: string | null
          created_at?: string
          empresa_id: string
          erro_msg?: string | null
          id?: string
          importado_em?: string
          importado_por?: string | null
          observacoes?: string | null
          origem?: Database["public"]["Enums"]["lote_origem"]
          processado_em?: string | null
          referencia_ano: number
          referencia_mes: number
          status?: Database["public"]["Enums"]["lote_status"]
          total_lancamentos?: number
          total_valor?: number
          updated_at?: string
        }
        Update: {
          arquivo_nome?: string | null
          arquivo_path?: string | null
          created_at?: string
          empresa_id?: string
          erro_msg?: string | null
          id?: string
          importado_em?: string
          importado_por?: string | null
          observacoes?: string | null
          origem?: Database["public"]["Enums"]["lote_origem"]
          processado_em?: string | null
          referencia_ano?: number
          referencia_mes?: number
          status?: Database["public"]["Enums"]["lote_status"]
          total_lancamentos?: number
          total_valor?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "realizado_lotes_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "realizado_lotes_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "v_ia_contexto_empresa"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "realizado_lotes_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "vw_bi_resumo_empresa"
            referencedColumns: ["empresa_id"]
          },
        ]
      }
      recebimento_nf: {
        Row: {
          almoxarifado_id: string | null
          created_at: string
          empresa_id: string
          finalizado_em: string | null
          id: string
          iniciado_em: string | null
          nf_id: string
          observacoes: string | null
          recebido_por: string | null
          status: Database["public"]["Enums"]["recebimento_status"]
          updated_at: string
        }
        Insert: {
          almoxarifado_id?: string | null
          created_at?: string
          empresa_id: string
          finalizado_em?: string | null
          id?: string
          iniciado_em?: string | null
          nf_id: string
          observacoes?: string | null
          recebido_por?: string | null
          status?: Database["public"]["Enums"]["recebimento_status"]
          updated_at?: string
        }
        Update: {
          almoxarifado_id?: string | null
          created_at?: string
          empresa_id?: string
          finalizado_em?: string | null
          id?: string
          iniciado_em?: string | null
          nf_id?: string
          observacoes?: string | null
          recebido_por?: string | null
          status?: Database["public"]["Enums"]["recebimento_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "recebimento_nf_almoxarifado_id_fkey"
            columns: ["almoxarifado_id"]
            isOneToOne: false
            referencedRelation: "almoxarifado"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recebimento_nf_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recebimento_nf_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "v_ia_contexto_empresa"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "recebimento_nf_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "vw_bi_resumo_empresa"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "recebimento_nf_nf_id_fkey"
            columns: ["nf_id"]
            isOneToOne: true
            referencedRelation: "nf_entrada"
            referencedColumns: ["id"]
          },
        ]
      }
      recebimento_nf_item: {
        Row: {
          condicao: Database["public"]["Enums"]["recebimento_item_condicao"]
          conferido: boolean
          conferido_em: string | null
          conferido_por: string | null
          created_at: string
          foto_url: string | null
          id: string
          nf_item_id: string | null
          observacoes: string | null
          produto_id: string | null
          qtd_nf: number
          qtd_recebida: number
          recebimento_id: string
        }
        Insert: {
          condicao?: Database["public"]["Enums"]["recebimento_item_condicao"]
          conferido?: boolean
          conferido_em?: string | null
          conferido_por?: string | null
          created_at?: string
          foto_url?: string | null
          id?: string
          nf_item_id?: string | null
          observacoes?: string | null
          produto_id?: string | null
          qtd_nf?: number
          qtd_recebida?: number
          recebimento_id: string
        }
        Update: {
          condicao?: Database["public"]["Enums"]["recebimento_item_condicao"]
          conferido?: boolean
          conferido_em?: string | null
          conferido_por?: string | null
          created_at?: string
          foto_url?: string | null
          id?: string
          nf_item_id?: string | null
          observacoes?: string | null
          produto_id?: string | null
          qtd_nf?: number
          qtd_recebida?: number
          recebimento_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "recebimento_nf_item_nf_item_id_fkey"
            columns: ["nf_item_id"]
            isOneToOne: false
            referencedRelation: "nf_entrada_item"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recebimento_nf_item_produto_id_fkey"
            columns: ["produto_id"]
            isOneToOne: false
            referencedRelation: "produto"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recebimento_nf_item_recebimento_id_fkey"
            columns: ["recebimento_id"]
            isOneToOne: false
            referencedRelation: "recebimento_nf"
            referencedColumns: ["id"]
          },
        ]
      }
      recebimento_ocorrencia: {
        Row: {
          aberta_em: string
          aberta_por: string | null
          created_at: string
          descricao: string
          empresa_id: string
          id: string
          recebimento_id: string
          recebimento_item_id: string | null
          resolvida_em: string | null
          resolvida_por: string | null
          status: Database["public"]["Enums"]["recebimento_ocorrencia_status"]
          tipo: Database["public"]["Enums"]["recebimento_ocorrencia_tipo"]
          tratativa: string | null
          updated_at: string
        }
        Insert: {
          aberta_em?: string
          aberta_por?: string | null
          created_at?: string
          descricao: string
          empresa_id: string
          id?: string
          recebimento_id: string
          recebimento_item_id?: string | null
          resolvida_em?: string | null
          resolvida_por?: string | null
          status?: Database["public"]["Enums"]["recebimento_ocorrencia_status"]
          tipo: Database["public"]["Enums"]["recebimento_ocorrencia_tipo"]
          tratativa?: string | null
          updated_at?: string
        }
        Update: {
          aberta_em?: string
          aberta_por?: string | null
          created_at?: string
          descricao?: string
          empresa_id?: string
          id?: string
          recebimento_id?: string
          recebimento_item_id?: string | null
          resolvida_em?: string | null
          resolvida_por?: string | null
          status?: Database["public"]["Enums"]["recebimento_ocorrencia_status"]
          tipo?: Database["public"]["Enums"]["recebimento_ocorrencia_tipo"]
          tratativa?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "recebimento_ocorrencia_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recebimento_ocorrencia_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "v_ia_contexto_empresa"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "recebimento_ocorrencia_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "vw_bi_resumo_empresa"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "recebimento_ocorrencia_recebimento_id_fkey"
            columns: ["recebimento_id"]
            isOneToOne: false
            referencedRelation: "recebimento_nf"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recebimento_ocorrencia_recebimento_item_id_fkey"
            columns: ["recebimento_item_id"]
            isOneToOne: false
            referencedRelation: "recebimento_nf_item"
            referencedColumns: ["id"]
          },
        ]
      }
      regra_contabilizacao: {
        Row: {
          ativo: boolean
          centro_custo_padrao: string | null
          codigo_evento: string | null
          conta_credito_id: string | null
          conta_debito_id: string | null
          created_at: string
          descricao: string
          empresa_id: string
          entra_dre: boolean
          evento: Database["public"]["Enums"]["regra_evento"]
          exige_centro_custo: boolean
          exige_contrato: boolean
          filtro: Json | null
          gatilho: string | null
          id: string
          impacta_caixa: string | null
          observacao: string | null
          prioridade: number
          requer_3way_match: boolean
          requer_pedido: boolean
          updated_at: string
        }
        Insert: {
          ativo?: boolean
          centro_custo_padrao?: string | null
          codigo_evento?: string | null
          conta_credito_id?: string | null
          conta_debito_id?: string | null
          created_at?: string
          descricao: string
          empresa_id: string
          entra_dre?: boolean
          evento: Database["public"]["Enums"]["regra_evento"]
          exige_centro_custo?: boolean
          exige_contrato?: boolean
          filtro?: Json | null
          gatilho?: string | null
          id?: string
          impacta_caixa?: string | null
          observacao?: string | null
          prioridade?: number
          requer_3way_match?: boolean
          requer_pedido?: boolean
          updated_at?: string
        }
        Update: {
          ativo?: boolean
          centro_custo_padrao?: string | null
          codigo_evento?: string | null
          conta_credito_id?: string | null
          conta_debito_id?: string | null
          created_at?: string
          descricao?: string
          empresa_id?: string
          entra_dre?: boolean
          evento?: Database["public"]["Enums"]["regra_evento"]
          exige_centro_custo?: boolean
          exige_contrato?: boolean
          filtro?: Json | null
          gatilho?: string | null
          id?: string
          impacta_caixa?: string | null
          observacao?: string | null
          prioridade?: number
          requer_3way_match?: boolean
          requer_pedido?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "regra_contabilizacao_conta_credito_id_fkey"
            columns: ["conta_credito_id"]
            isOneToOne: false
            referencedRelation: "conta_contabil"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "regra_contabilizacao_conta_debito_id_fkey"
            columns: ["conta_debito_id"]
            isOneToOne: false
            referencedRelation: "conta_contabil"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "regra_contabilizacao_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "regra_contabilizacao_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "v_ia_contexto_empresa"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "regra_contabilizacao_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "vw_bi_resumo_empresa"
            referencedColumns: ["empresa_id"]
          },
        ]
      }
      regua_cobranca: {
        Row: {
          aplicar_para: string
          ativo: boolean
          created_at: string
          descricao: string | null
          empresa_id: string
          id: string
          nome: string
          updated_at: string
          valor_minimo: number | null
        }
        Insert: {
          aplicar_para?: string
          ativo?: boolean
          created_at?: string
          descricao?: string | null
          empresa_id: string
          id?: string
          nome: string
          updated_at?: string
          valor_minimo?: number | null
        }
        Update: {
          aplicar_para?: string
          ativo?: boolean
          created_at?: string
          descricao?: string | null
          empresa_id?: string
          id?: string
          nome?: string
          updated_at?: string
          valor_minimo?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "regua_cobranca_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "regua_cobranca_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "v_ia_contexto_empresa"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "regua_cobranca_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "vw_bi_resumo_empresa"
            referencedColumns: ["empresa_id"]
          },
        ]
      }
      regua_cobranca_etapa: {
        Row: {
          ativo: boolean
          canal: Database["public"]["Enums"]["regua_canal"]
          dias_em_relacao_vencimento: number
          exige_aprovacao: boolean
          id: string
          observacao: string | null
          ordem: number
          regua_id: string
          template_id: string | null
          valor_minimo: number | null
        }
        Insert: {
          ativo?: boolean
          canal: Database["public"]["Enums"]["regua_canal"]
          dias_em_relacao_vencimento: number
          exige_aprovacao?: boolean
          id?: string
          observacao?: string | null
          ordem: number
          regua_id: string
          template_id?: string | null
          valor_minimo?: number | null
        }
        Update: {
          ativo?: boolean
          canal?: Database["public"]["Enums"]["regua_canal"]
          dias_em_relacao_vencimento?: number
          exige_aprovacao?: boolean
          id?: string
          observacao?: string | null
          ordem?: number
          regua_id?: string
          template_id?: string | null
          valor_minimo?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "regua_cobranca_etapa_regua_id_fkey"
            columns: ["regua_id"]
            isOneToOne: false
            referencedRelation: "regua_cobranca"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "regua_cobranca_etapa_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "template_mensagem"
            referencedColumns: ["id"]
          },
        ]
      }
      regua_cobranca_execucao: {
        Row: {
          agendado_para: string | null
          assunto: string | null
          canal: Database["public"]["Enums"]["regua_canal"]
          conteudo: string | null
          created_at: string
          destinatario: string | null
          empresa_id: string
          erro: string | null
          etapa_id: string | null
          executado_em: string | null
          executado_por: string | null
          id: string
          resposta: Json | null
          status: Database["public"]["Enums"]["regua_etapa_status"]
          titulo_id: string
        }
        Insert: {
          agendado_para?: string | null
          assunto?: string | null
          canal: Database["public"]["Enums"]["regua_canal"]
          conteudo?: string | null
          created_at?: string
          destinatario?: string | null
          empresa_id: string
          erro?: string | null
          etapa_id?: string | null
          executado_em?: string | null
          executado_por?: string | null
          id?: string
          resposta?: Json | null
          status?: Database["public"]["Enums"]["regua_etapa_status"]
          titulo_id: string
        }
        Update: {
          agendado_para?: string | null
          assunto?: string | null
          canal?: Database["public"]["Enums"]["regua_canal"]
          conteudo?: string | null
          created_at?: string
          destinatario?: string | null
          empresa_id?: string
          erro?: string | null
          etapa_id?: string | null
          executado_em?: string | null
          executado_por?: string | null
          id?: string
          resposta?: Json | null
          status?: Database["public"]["Enums"]["regua_etapa_status"]
          titulo_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "regua_cobranca_execucao_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "regua_cobranca_execucao_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "v_ia_contexto_empresa"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "regua_cobranca_execucao_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "vw_bi_resumo_empresa"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "regua_cobranca_execucao_etapa_id_fkey"
            columns: ["etapa_id"]
            isOneToOne: false
            referencedRelation: "regua_cobranca_etapa"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "regua_cobranca_execucao_titulo_id_fkey"
            columns: ["titulo_id"]
            isOneToOne: false
            referencedRelation: "titulo_receber"
            referencedColumns: ["id"]
          },
        ]
      }
      remessa_cnab: {
        Row: {
          arquivo_conteudo: string | null
          arquivo_nome: string | null
          banco_codigo: string
          conta_bancaria_id: string
          created_at: string
          data_confirmacao_banco: string | null
          data_envio: string | null
          data_geracao: string
          empresa_id: string
          gerada_por: string | null
          id: string
          layout: string
          metodo_envio: Database["public"]["Enums"]["remessa_metodo_envio"]
          numero: string
          observacoes: string | null
          protocolo_banco: string | null
          qtd_titulos: number
          retorno_arquivo_nome: string | null
          retorno_processado_em: string | null
          sequencia_arquivo: number
          status: Database["public"]["Enums"]["remessa_status"]
          tentativas_envio: number
          ultimo_envio_em: string | null
          ultimo_envio_erro: string | null
          updated_at: string
          valor_total: number
        }
        Insert: {
          arquivo_conteudo?: string | null
          arquivo_nome?: string | null
          banco_codigo: string
          conta_bancaria_id: string
          created_at?: string
          data_confirmacao_banco?: string | null
          data_envio?: string | null
          data_geracao?: string
          empresa_id: string
          gerada_por?: string | null
          id?: string
          layout?: string
          metodo_envio?: Database["public"]["Enums"]["remessa_metodo_envio"]
          numero?: string
          observacoes?: string | null
          protocolo_banco?: string | null
          qtd_titulos?: number
          retorno_arquivo_nome?: string | null
          retorno_processado_em?: string | null
          sequencia_arquivo: number
          status?: Database["public"]["Enums"]["remessa_status"]
          tentativas_envio?: number
          ultimo_envio_em?: string | null
          ultimo_envio_erro?: string | null
          updated_at?: string
          valor_total?: number
        }
        Update: {
          arquivo_conteudo?: string | null
          arquivo_nome?: string | null
          banco_codigo?: string
          conta_bancaria_id?: string
          created_at?: string
          data_confirmacao_banco?: string | null
          data_envio?: string | null
          data_geracao?: string
          empresa_id?: string
          gerada_por?: string | null
          id?: string
          layout?: string
          metodo_envio?: Database["public"]["Enums"]["remessa_metodo_envio"]
          numero?: string
          observacoes?: string | null
          protocolo_banco?: string | null
          qtd_titulos?: number
          retorno_arquivo_nome?: string | null
          retorno_processado_em?: string | null
          sequencia_arquivo?: number
          status?: Database["public"]["Enums"]["remessa_status"]
          tentativas_envio?: number
          ultimo_envio_em?: string | null
          ultimo_envio_erro?: string | null
          updated_at?: string
          valor_total?: number
        }
        Relationships: [
          {
            foreignKeyName: "remessa_cnab_conta_bancaria_id_fkey"
            columns: ["conta_bancaria_id"]
            isOneToOne: false
            referencedRelation: "conta_bancaria"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "remessa_cnab_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "remessa_cnab_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "v_ia_contexto_empresa"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "remessa_cnab_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "vw_bi_resumo_empresa"
            referencedColumns: ["empresa_id"]
          },
        ]
      }
      remessa_cnab_titulo: {
        Row: {
          ordem: number
          remessa_id: string
          retorno_msg: string | null
          retorno_status: string | null
          titulo_id: string
          valor_remessa: number
        }
        Insert: {
          ordem?: number
          remessa_id: string
          retorno_msg?: string | null
          retorno_status?: string | null
          titulo_id: string
          valor_remessa: number
        }
        Update: {
          ordem?: number
          remessa_id?: string
          retorno_msg?: string | null
          retorno_status?: string | null
          titulo_id?: string
          valor_remessa?: number
        }
        Relationships: [
          {
            foreignKeyName: "remessa_cnab_titulo_remessa_id_fkey"
            columns: ["remessa_id"]
            isOneToOne: false
            referencedRelation: "remessa_cnab"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "remessa_cnab_titulo_titulo_id_fkey"
            columns: ["titulo_id"]
            isOneToOne: false
            referencedRelation: "titulo_pagar"
            referencedColumns: ["id"]
          },
        ]
      }
      requisicao_compra: {
        Row: {
          almoxarifado_destino_id: string | null
          aprovado_em: string | null
          aprovado_por: string | null
          categoria_gasto: string | null
          centro_custo_id: string | null
          contrato_id: string | null
          created_at: string
          data_necessidade: string | null
          data_solicitacao: string
          destino: Database["public"]["Enums"]["rc_destino"]
          dre_linha_id: string | null
          empresa_id: string
          id: string
          justificativa: string | null
          numero: string
          observacoes: string | null
          prioridade: Database["public"]["Enums"]["rc_prioridade"]
          solicitante: string | null
          solicitante_id: string | null
          status: Database["public"]["Enums"]["req_compra_status"]
          status_v2: Database["public"]["Enums"]["rc_status_v2"]
          tipo: Database["public"]["Enums"]["rc_tipo"]
          updated_at: string
          valor_estimado: number
        }
        Insert: {
          almoxarifado_destino_id?: string | null
          aprovado_em?: string | null
          aprovado_por?: string | null
          categoria_gasto?: string | null
          centro_custo_id?: string | null
          contrato_id?: string | null
          created_at?: string
          data_necessidade?: string | null
          data_solicitacao?: string
          destino?: Database["public"]["Enums"]["rc_destino"]
          dre_linha_id?: string | null
          empresa_id: string
          id?: string
          justificativa?: string | null
          numero: string
          observacoes?: string | null
          prioridade?: Database["public"]["Enums"]["rc_prioridade"]
          solicitante?: string | null
          solicitante_id?: string | null
          status?: Database["public"]["Enums"]["req_compra_status"]
          status_v2?: Database["public"]["Enums"]["rc_status_v2"]
          tipo?: Database["public"]["Enums"]["rc_tipo"]
          updated_at?: string
          valor_estimado?: number
        }
        Update: {
          almoxarifado_destino_id?: string | null
          aprovado_em?: string | null
          aprovado_por?: string | null
          categoria_gasto?: string | null
          centro_custo_id?: string | null
          contrato_id?: string | null
          created_at?: string
          data_necessidade?: string | null
          data_solicitacao?: string
          destino?: Database["public"]["Enums"]["rc_destino"]
          dre_linha_id?: string | null
          empresa_id?: string
          id?: string
          justificativa?: string | null
          numero?: string
          observacoes?: string | null
          prioridade?: Database["public"]["Enums"]["rc_prioridade"]
          solicitante?: string | null
          solicitante_id?: string | null
          status?: Database["public"]["Enums"]["req_compra_status"]
          status_v2?: Database["public"]["Enums"]["rc_status_v2"]
          tipo?: Database["public"]["Enums"]["rc_tipo"]
          updated_at?: string
          valor_estimado?: number
        }
        Relationships: [
          {
            foreignKeyName: "requisicao_compra_almoxarifado_destino_id_fkey"
            columns: ["almoxarifado_destino_id"]
            isOneToOne: false
            referencedRelation: "almoxarifado"
            referencedColumns: ["id"]
          },
        ]
      }
      requisicao_compra_item: {
        Row: {
          created_at: string
          descricao: string
          id: string
          observacoes: string | null
          preco_estimado: number
          produto_servico_id: string | null
          quantidade: number
          requisicao_id: string
          unidade: string
          updated_at: string
          valor_total: number | null
        }
        Insert: {
          created_at?: string
          descricao: string
          id?: string
          observacoes?: string | null
          preco_estimado?: number
          produto_servico_id?: string | null
          quantidade?: number
          requisicao_id: string
          unidade?: string
          updated_at?: string
          valor_total?: number | null
        }
        Update: {
          created_at?: string
          descricao?: string
          id?: string
          observacoes?: string | null
          preco_estimado?: number
          produto_servico_id?: string | null
          quantidade?: number
          requisicao_id?: string
          unidade?: string
          updated_at?: string
          valor_total?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "requisicao_compra_item_produto_servico_id_fkey"
            columns: ["produto_servico_id"]
            isOneToOne: false
            referencedRelation: "produto_servico"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "requisicao_compra_item_requisicao_id_fkey"
            columns: ["requisicao_id"]
            isOneToOne: false
            referencedRelation: "requisicao_compra"
            referencedColumns: ["id"]
          },
        ]
      }
      requisicao_compra_log: {
        Row: {
          created_at: string
          evento: string
          id: string
          payload: Json
          requisicao_id: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          evento: string
          id?: string
          payload?: Json
          requisicao_id: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          evento?: string
          id?: string
          payload?: Json
          requisicao_id?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "requisicao_compra_log_requisicao_id_fkey"
            columns: ["requisicao_id"]
            isOneToOne: false
            referencedRelation: "requisicao_compra"
            referencedColumns: ["id"]
          },
        ]
      }
      requisicao_compra_status_hist: {
        Row: {
          created_at: string
          id: string
          motivo: string | null
          requisicao_id: string
          status_anterior: Database["public"]["Enums"]["rc_status_v2"] | null
          status_novo: Database["public"]["Enums"]["rc_status_v2"]
          user_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          motivo?: string | null
          requisicao_id: string
          status_anterior?: Database["public"]["Enums"]["rc_status_v2"] | null
          status_novo: Database["public"]["Enums"]["rc_status_v2"]
          user_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          motivo?: string | null
          requisicao_id?: string
          status_anterior?: Database["public"]["Enums"]["rc_status_v2"] | null
          status_novo?: Database["public"]["Enums"]["rc_status_v2"]
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "requisicao_compra_status_hist_requisicao_id_fkey"
            columns: ["requisicao_id"]
            isOneToOne: false
            referencedRelation: "requisicao_compra"
            referencedColumns: ["id"]
          },
        ]
      }
      retorno_bancario: {
        Row: {
          arquivo_conteudo: string | null
          arquivo_hash: string | null
          arquivo_nome: string | null
          conta_bancaria_id: string
          created_at: string
          data_geracao_arquivo: string | null
          data_processamento: string | null
          data_recebimento: string
          empresa_id: string
          formato: Database["public"]["Enums"]["retorno_formato"]
          id: string
          log_processamento: string | null
          origem: string | null
          qtd_erros: number | null
          qtd_processados: number | null
          qtd_registros: number | null
          recebido_por: string | null
          status: Database["public"]["Enums"]["retorno_status"]
          updated_at: string
          valor_total: number | null
        }
        Insert: {
          arquivo_conteudo?: string | null
          arquivo_hash?: string | null
          arquivo_nome?: string | null
          conta_bancaria_id: string
          created_at?: string
          data_geracao_arquivo?: string | null
          data_processamento?: string | null
          data_recebimento?: string
          empresa_id: string
          formato?: Database["public"]["Enums"]["retorno_formato"]
          id?: string
          log_processamento?: string | null
          origem?: string | null
          qtd_erros?: number | null
          qtd_processados?: number | null
          qtd_registros?: number | null
          recebido_por?: string | null
          status?: Database["public"]["Enums"]["retorno_status"]
          updated_at?: string
          valor_total?: number | null
        }
        Update: {
          arquivo_conteudo?: string | null
          arquivo_hash?: string | null
          arquivo_nome?: string | null
          conta_bancaria_id?: string
          created_at?: string
          data_geracao_arquivo?: string | null
          data_processamento?: string | null
          data_recebimento?: string
          empresa_id?: string
          formato?: Database["public"]["Enums"]["retorno_formato"]
          id?: string
          log_processamento?: string | null
          origem?: string | null
          qtd_erros?: number | null
          qtd_processados?: number | null
          qtd_registros?: number | null
          recebido_por?: string | null
          status?: Database["public"]["Enums"]["retorno_status"]
          updated_at?: string
          valor_total?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "retorno_bancario_conta_bancaria_id_fkey"
            columns: ["conta_bancaria_id"]
            isOneToOne: false
            referencedRelation: "conta_bancaria"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "retorno_bancario_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "retorno_bancario_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "v_ia_contexto_empresa"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "retorno_bancario_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "vw_bi_resumo_empresa"
            referencedColumns: ["empresa_id"]
          },
        ]
      }
      retorno_bancario_ocorrencia: {
        Row: {
          codigo_ocorrencia: string | null
          conta_id_credito: string | null
          created_at: string
          data_credito: string | null
          data_ocorrencia: string | null
          descricao_ocorrencia: string | null
          empresa_id: string
          erro_processamento: string | null
          id: string
          nosso_numero: string | null
          processado: boolean
          raw: Json | null
          retorno_id: string
          seu_numero: string | null
          status_apos: string | null
          titulo_pagar_id: string | null
          titulo_receber_id: string | null
          valor_desconto: number | null
          valor_juros: number | null
          valor_pago: number | null
          valor_tarifa: number | null
          valor_titulo: number | null
        }
        Insert: {
          codigo_ocorrencia?: string | null
          conta_id_credito?: string | null
          created_at?: string
          data_credito?: string | null
          data_ocorrencia?: string | null
          descricao_ocorrencia?: string | null
          empresa_id: string
          erro_processamento?: string | null
          id?: string
          nosso_numero?: string | null
          processado?: boolean
          raw?: Json | null
          retorno_id: string
          seu_numero?: string | null
          status_apos?: string | null
          titulo_pagar_id?: string | null
          titulo_receber_id?: string | null
          valor_desconto?: number | null
          valor_juros?: number | null
          valor_pago?: number | null
          valor_tarifa?: number | null
          valor_titulo?: number | null
        }
        Update: {
          codigo_ocorrencia?: string | null
          conta_id_credito?: string | null
          created_at?: string
          data_credito?: string | null
          data_ocorrencia?: string | null
          descricao_ocorrencia?: string | null
          empresa_id?: string
          erro_processamento?: string | null
          id?: string
          nosso_numero?: string | null
          processado?: boolean
          raw?: Json | null
          retorno_id?: string
          seu_numero?: string | null
          status_apos?: string | null
          titulo_pagar_id?: string | null
          titulo_receber_id?: string | null
          valor_desconto?: number | null
          valor_juros?: number | null
          valor_pago?: number | null
          valor_tarifa?: number | null
          valor_titulo?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "retorno_bancario_ocorrencia_conta_id_credito_fkey"
            columns: ["conta_id_credito"]
            isOneToOne: false
            referencedRelation: "conta_bancaria"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "retorno_bancario_ocorrencia_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "retorno_bancario_ocorrencia_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "v_ia_contexto_empresa"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "retorno_bancario_ocorrencia_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "vw_bi_resumo_empresa"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "retorno_bancario_ocorrencia_retorno_id_fkey"
            columns: ["retorno_id"]
            isOneToOne: false
            referencedRelation: "retorno_bancario"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "retorno_bancario_ocorrencia_titulo_pagar_id_fkey"
            columns: ["titulo_pagar_id"]
            isOneToOne: false
            referencedRelation: "titulo_pagar"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "retorno_bancario_ocorrencia_titulo_receber_id_fkey"
            columns: ["titulo_receber_id"]
            isOneToOne: false
            referencedRelation: "titulo_receber"
            referencedColumns: ["id"]
          },
        ]
      }
      role_permissions: {
        Row: {
          acao: Database["public"]["Enums"]["app_acao"]
          created_at: string
          id: string
          menu_codigo: string | null
          modulo: string
          role: Database["public"]["Enums"]["app_role"]
        }
        Insert: {
          acao: Database["public"]["Enums"]["app_acao"]
          created_at?: string
          id?: string
          menu_codigo?: string | null
          modulo: string
          role: Database["public"]["Enums"]["app_role"]
        }
        Update: {
          acao?: Database["public"]["Enums"]["app_acao"]
          created_at?: string
          id?: string
          menu_codigo?: string | null
          modulo?: string
          role?: Database["public"]["Enums"]["app_role"]
        }
        Relationships: []
      }
      saldos_iniciais_caixa: {
        Row: {
          banco: string
          categoria: string | null
          created_at: string
          data_referencia: string
          empresa_id: string
          id: string
          subcategoria: string | null
          tipo: string | null
          updated_at: string
          valor: number
        }
        Insert: {
          banco: string
          categoria?: string | null
          created_at?: string
          data_referencia: string
          empresa_id: string
          id?: string
          subcategoria?: string | null
          tipo?: string | null
          updated_at?: string
          valor?: number
        }
        Update: {
          banco?: string
          categoria?: string | null
          created_at?: string
          data_referencia?: string
          empresa_id?: string
          id?: string
          subcategoria?: string | null
          tipo?: string | null
          updated_at?: string
          valor?: number
        }
        Relationships: [
          {
            foreignKeyName: "saldos_iniciais_caixa_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "saldos_iniciais_caixa_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "v_ia_contexto_empresa"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "saldos_iniciais_caixa_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "vw_bi_resumo_empresa"
            referencedColumns: ["empresa_id"]
          },
        ]
      }
      screen_permission_profile: {
        Row: {
          acao: Database["public"]["Enums"]["app_acao"]
          allow: boolean
          created_at: string
          id: string
          menu_codigo: string
          role: Database["public"]["Enums"]["app_role"]
          updated_at: string
        }
        Insert: {
          acao: Database["public"]["Enums"]["app_acao"]
          allow?: boolean
          created_at?: string
          id?: string
          menu_codigo: string
          role: Database["public"]["Enums"]["app_role"]
          updated_at?: string
        }
        Update: {
          acao?: Database["public"]["Enums"]["app_acao"]
          allow?: boolean
          created_at?: string
          id?: string
          menu_codigo?: string
          role?: Database["public"]["Enums"]["app_role"]
          updated_at?: string
        }
        Relationships: []
      }
      screen_permission_user: {
        Row: {
          acao: Database["public"]["Enums"]["app_acao"]
          allow: boolean
          created_at: string
          created_by: string | null
          empresa_id: string | null
          id: string
          menu_codigo: string
          motivo: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          acao: Database["public"]["Enums"]["app_acao"]
          allow: boolean
          created_at?: string
          created_by?: string | null
          empresa_id?: string | null
          id?: string
          menu_codigo: string
          motivo?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          acao?: Database["public"]["Enums"]["app_acao"]
          allow?: boolean
          created_at?: string
          created_by?: string | null
          empresa_id?: string | null
          id?: string
          menu_codigo?: string
          motivo?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      servico_municipal: {
        Row: {
          aliq_iss: number
          ativo: boolean | null
          codigo_lc116: string
          codigo_municipal: string | null
          created_at: string
          descricao: string
          empresa_id: string
          id: string
          iss_retido_padrao: boolean | null
          updated_at: string
        }
        Insert: {
          aliq_iss?: number
          ativo?: boolean | null
          codigo_lc116: string
          codigo_municipal?: string | null
          created_at?: string
          descricao: string
          empresa_id: string
          id?: string
          iss_retido_padrao?: boolean | null
          updated_at?: string
        }
        Update: {
          aliq_iss?: number
          ativo?: boolean | null
          codigo_lc116?: string
          codigo_municipal?: string | null
          created_at?: string
          descricao?: string
          empresa_id?: string
          id?: string
          iss_retido_padrao?: boolean | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "servico_municipal_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "servico_municipal_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "v_ia_contexto_empresa"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "servico_municipal_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "vw_bi_resumo_empresa"
            referencedColumns: ["empresa_id"]
          },
        ]
      }
      sessoes_ativas: {
        Row: {
          ativa: boolean
          id: string
          iniciada_em: string
          ip: string | null
          ultima_atividade: string
          user_agent: string | null
          user_id: string
        }
        Insert: {
          ativa?: boolean
          id?: string
          iniciada_em?: string
          ip?: string | null
          ultima_atividade?: string
          user_agent?: string | null
          user_id: string
        }
        Update: {
          ativa?: boolean
          id?: string
          iniciada_em?: string
          ip?: string | null
          ultima_atividade?: string
          user_agent?: string | null
          user_id?: string
        }
        Relationships: []
      }
      setor: {
        Row: {
          area_id: string
          ativo: boolean
          centro_custo_id: string | null
          created_at: string
          descricao: string | null
          empresa_id: string
          gestor_profile_id: string | null
          id: string
          nome: string
          updated_at: string
        }
        Insert: {
          area_id: string
          ativo?: boolean
          centro_custo_id?: string | null
          created_at?: string
          descricao?: string | null
          empresa_id: string
          gestor_profile_id?: string | null
          id?: string
          nome: string
          updated_at?: string
        }
        Update: {
          area_id?: string
          ativo?: boolean
          centro_custo_id?: string | null
          created_at?: string
          descricao?: string | null
          empresa_id?: string
          gestor_profile_id?: string | null
          id?: string
          nome?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "setor_area_id_fkey"
            columns: ["area_id"]
            isOneToOne: false
            referencedRelation: "area"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "setor_centro_custo_id_fkey"
            columns: ["centro_custo_id"]
            isOneToOne: false
            referencedRelation: "centros_custo"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "setor_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "setor_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "v_ia_contexto_empresa"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "setor_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "vw_bi_resumo_empresa"
            referencedColumns: ["empresa_id"]
          },
        ]
      }
      solicitacao_desbloqueio: {
        Row: {
          comentario_decisor: string | null
          created_at: string
          decidido_em: string | null
          decidido_por: string | null
          empresa_id: string
          id: string
          linha_id: string
          motivo: string
          novo_valor: number | null
          solicitado_por: string
          status: Database["public"]["Enums"]["desbloqueio_status"]
          updated_at: string
        }
        Insert: {
          comentario_decisor?: string | null
          created_at?: string
          decidido_em?: string | null
          decidido_por?: string | null
          empresa_id: string
          id?: string
          linha_id: string
          motivo: string
          novo_valor?: number | null
          solicitado_por: string
          status?: Database["public"]["Enums"]["desbloqueio_status"]
          updated_at?: string
        }
        Update: {
          comentario_decisor?: string | null
          created_at?: string
          decidido_em?: string | null
          decidido_por?: string | null
          empresa_id?: string
          id?: string
          linha_id?: string
          motivo?: string
          novo_valor?: number | null
          solicitado_por?: string
          status?: Database["public"]["Enums"]["desbloqueio_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "solicitacao_desbloqueio_linha_id_fkey"
            columns: ["linha_id"]
            isOneToOne: false
            referencedRelation: "orcamento_contrato_linha"
            referencedColumns: ["id"]
          },
        ]
      }
      stg_aprovacao_contas: {
        Row: {
          aprovado_em: string | null
          aprovado_por: string | null
          classe_contabil_sugerida: string | null
          codigo_conta_pai_sugerido: string | null
          codigo_conta_sugerido: string | null
          created_at: string
          decisao_usuario: string | null
          direto_indireto_padrao: string | null
          fixo_variavel_padrao: string | null
          id_sugestao_conta: string
          linha_dre_padrao: string | null
          motivo_sugestao: string | null
          nome_conta_pai_sugerido: string | null
          nome_conta_sugerido: string | null
          observacao_usuario: string | null
          origens_afetadas: string | null
          qtd_lancamentos_afetados: number | null
          status_aprovacao: string
          tipo_gerencial_padrao: string | null
          updated_at: string
          valor_total_abs_afetado: number | null
        }
        Insert: {
          aprovado_em?: string | null
          aprovado_por?: string | null
          classe_contabil_sugerida?: string | null
          codigo_conta_pai_sugerido?: string | null
          codigo_conta_sugerido?: string | null
          created_at?: string
          decisao_usuario?: string | null
          direto_indireto_padrao?: string | null
          fixo_variavel_padrao?: string | null
          id_sugestao_conta: string
          linha_dre_padrao?: string | null
          motivo_sugestao?: string | null
          nome_conta_pai_sugerido?: string | null
          nome_conta_sugerido?: string | null
          observacao_usuario?: string | null
          origens_afetadas?: string | null
          qtd_lancamentos_afetados?: number | null
          status_aprovacao?: string
          tipo_gerencial_padrao?: string | null
          updated_at?: string
          valor_total_abs_afetado?: number | null
        }
        Update: {
          aprovado_em?: string | null
          aprovado_por?: string | null
          classe_contabil_sugerida?: string | null
          codigo_conta_pai_sugerido?: string | null
          codigo_conta_sugerido?: string | null
          created_at?: string
          decisao_usuario?: string | null
          direto_indireto_padrao?: string | null
          fixo_variavel_padrao?: string | null
          id_sugestao_conta?: string
          linha_dre_padrao?: string | null
          motivo_sugestao?: string | null
          nome_conta_pai_sugerido?: string | null
          nome_conta_sugerido?: string | null
          observacao_usuario?: string | null
          origens_afetadas?: string | null
          qtd_lancamentos_afetados?: number | null
          status_aprovacao?: string
          tipo_gerencial_padrao?: string | null
          updated_at?: string
          valor_total_abs_afetado?: number | null
        }
        Relationships: []
      }
      stg_bancos_contas_detectadas: {
        Row: {
          codigo_banco_conta: string
          conta_contabil_sugerida: string | null
          created_at: string
          empresa_codigo_detectada: string | null
          empresa_nome_detectada: string | null
          id: string
          nome_banco_conta: string | null
          observacao: string | null
          origem_detectada: string | null
          qtd_linhas_detectadas: number | null
          status_carga: string | null
          status_de_para_conta: string | null
          tipo_conta_financeira: string | null
        }
        Insert: {
          codigo_banco_conta: string
          conta_contabil_sugerida?: string | null
          created_at?: string
          empresa_codigo_detectada?: string | null
          empresa_nome_detectada?: string | null
          id?: string
          nome_banco_conta?: string | null
          observacao?: string | null
          origem_detectada?: string | null
          qtd_linhas_detectadas?: number | null
          status_carga?: string | null
          status_de_para_conta?: string | null
          tipo_conta_financeira?: string | null
        }
        Update: {
          codigo_banco_conta?: string
          conta_contabil_sugerida?: string | null
          created_at?: string
          empresa_codigo_detectada?: string | null
          empresa_nome_detectada?: string | null
          id?: string
          nome_banco_conta?: string | null
          observacao?: string | null
          origem_detectada?: string | null
          qtd_linhas_detectadas?: number | null
          status_carga?: string | null
          status_de_para_conta?: string | null
          tipo_conta_financeira?: string | null
        }
        Relationships: []
      }
      stg_clientes_cnpj: {
        Row: {
          batch_id: string
          cnpj: string | null
          contrato_origem: string | null
          contrato_resolvido_id: string | null
          created_at: string
          data_fim: string | null
          data_inicio: string | null
          empresa_id: string
          empresa_origem: string | null
          erro_msg: string | null
          filial: string | null
          id: string
          linha_origem: number | null
          raw: Json | null
          valido: boolean | null
        }
        Insert: {
          batch_id: string
          cnpj?: string | null
          contrato_origem?: string | null
          contrato_resolvido_id?: string | null
          created_at?: string
          data_fim?: string | null
          data_inicio?: string | null
          empresa_id: string
          empresa_origem?: string | null
          erro_msg?: string | null
          filial?: string | null
          id?: string
          linha_origem?: number | null
          raw?: Json | null
          valido?: boolean | null
        }
        Update: {
          batch_id?: string
          cnpj?: string | null
          contrato_origem?: string | null
          contrato_resolvido_id?: string | null
          created_at?: string
          data_fim?: string | null
          data_inicio?: string | null
          empresa_id?: string
          empresa_origem?: string | null
          erro_msg?: string | null
          filial?: string | null
          id?: string
          linha_origem?: number | null
          raw?: Json | null
          valido?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "stg_clientes_cnpj_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "integration_batches"
            referencedColumns: ["id"]
          },
        ]
      }
      stg_colaboradores_ativos: {
        Row: {
          batch_id: string
          cadastro: string | null
          centro_custo_codigo: string | null
          centro_custo_descricao: string | null
          centro_custo_resolvido_id: string | null
          contrato_resolvido_id: string | null
          cpf: string | null
          created_at: string
          empresa_id: string
          erro_msg: string | null
          filial_apelido: string | null
          id: string
          linha_origem: number | null
          nome: string | null
          raw: Json | null
          situacao: string | null
          valido: boolean | null
        }
        Insert: {
          batch_id: string
          cadastro?: string | null
          centro_custo_codigo?: string | null
          centro_custo_descricao?: string | null
          centro_custo_resolvido_id?: string | null
          contrato_resolvido_id?: string | null
          cpf?: string | null
          created_at?: string
          empresa_id: string
          erro_msg?: string | null
          filial_apelido?: string | null
          id?: string
          linha_origem?: number | null
          nome?: string | null
          raw?: Json | null
          situacao?: string | null
          valido?: boolean | null
        }
        Update: {
          batch_id?: string
          cadastro?: string | null
          centro_custo_codigo?: string | null
          centro_custo_descricao?: string | null
          centro_custo_resolvido_id?: string | null
          contrato_resolvido_id?: string | null
          cpf?: string | null
          created_at?: string
          empresa_id?: string
          erro_msg?: string | null
          filial_apelido?: string | null
          id?: string
          linha_origem?: number | null
          nome?: string | null
          raw?: Json | null
          situacao?: string | null
          valido?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "stg_colaboradores_ativos_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "integration_batches"
            referencedColumns: ["id"]
          },
        ]
      }
      stg_colaboradores_base: {
        Row: {
          batch_id: string
          cadastro: string | null
          cargo: string | null
          cbo: string | null
          cpf: string | null
          created_at: string
          data_admissao: string | null
          data_demissao: string | null
          data_nascimento: string | null
          departamento: string | null
          email: string | null
          empresa_id: string
          empresa_origem: string | null
          endereco_bairro: string | null
          endereco_cep: string | null
          endereco_cidade: string | null
          endereco_numero: string | null
          endereco_rua: string | null
          endereco_uf: string | null
          erro_msg: string | null
          filial: string | null
          genero: string | null
          gestor_direto: string | null
          id: string
          jornada: string | null
          linha_origem: number | null
          matricula: string | null
          nome: string | null
          observacoes: string | null
          pis_pasep: string | null
          raw: Json | null
          rg: string | null
          salario_base: number | null
          situacao: string | null
          telefone: string | null
          tipo_contrato: string | null
          valido: boolean | null
        }
        Insert: {
          batch_id: string
          cadastro?: string | null
          cargo?: string | null
          cbo?: string | null
          cpf?: string | null
          created_at?: string
          data_admissao?: string | null
          data_demissao?: string | null
          data_nascimento?: string | null
          departamento?: string | null
          email?: string | null
          empresa_id: string
          empresa_origem?: string | null
          endereco_bairro?: string | null
          endereco_cep?: string | null
          endereco_cidade?: string | null
          endereco_numero?: string | null
          endereco_rua?: string | null
          endereco_uf?: string | null
          erro_msg?: string | null
          filial?: string | null
          genero?: string | null
          gestor_direto?: string | null
          id?: string
          jornada?: string | null
          linha_origem?: number | null
          matricula?: string | null
          nome?: string | null
          observacoes?: string | null
          pis_pasep?: string | null
          raw?: Json | null
          rg?: string | null
          salario_base?: number | null
          situacao?: string | null
          telefone?: string | null
          tipo_contrato?: string | null
          valido?: boolean | null
        }
        Update: {
          batch_id?: string
          cadastro?: string | null
          cargo?: string | null
          cbo?: string | null
          cpf?: string | null
          created_at?: string
          data_admissao?: string | null
          data_demissao?: string | null
          data_nascimento?: string | null
          departamento?: string | null
          email?: string | null
          empresa_id?: string
          empresa_origem?: string | null
          endereco_bairro?: string | null
          endereco_cep?: string | null
          endereco_cidade?: string | null
          endereco_numero?: string | null
          endereco_rua?: string | null
          endereco_uf?: string | null
          erro_msg?: string | null
          filial?: string | null
          genero?: string | null
          gestor_direto?: string | null
          id?: string
          jornada?: string | null
          linha_origem?: number | null
          matricula?: string | null
          nome?: string | null
          observacoes?: string | null
          pis_pasep?: string | null
          raw?: Json | null
          rg?: string | null
          salario_base?: number | null
          situacao?: string | null
          telefone?: string | null
          tipo_contrato?: string | null
          valido?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "stg_colaboradores_base_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "integration_batches"
            referencedColumns: ["id"]
          },
        ]
      }
      stg_contratos_custos_long: {
        Row: {
          batch_id: string
          cenario: string | null
          componente_custo: string | null
          contrato_origem: string | null
          contrato_resolvido_id: string | null
          created_at: string
          empresa_id: string
          erro_msg: string | null
          id: string
          linha_origem: number | null
          posto_origem: string | null
          posto_resolvido_id: string | null
          raw: Json | null
          servico_origem: string | null
          valido: boolean | null
          valor: number | null
        }
        Insert: {
          batch_id: string
          cenario?: string | null
          componente_custo?: string | null
          contrato_origem?: string | null
          contrato_resolvido_id?: string | null
          created_at?: string
          empresa_id: string
          erro_msg?: string | null
          id?: string
          linha_origem?: number | null
          posto_origem?: string | null
          posto_resolvido_id?: string | null
          raw?: Json | null
          servico_origem?: string | null
          valido?: boolean | null
          valor?: number | null
        }
        Update: {
          batch_id?: string
          cenario?: string | null
          componente_custo?: string | null
          contrato_origem?: string | null
          contrato_resolvido_id?: string | null
          created_at?: string
          empresa_id?: string
          erro_msg?: string | null
          id?: string
          linha_origem?: number | null
          posto_origem?: string | null
          posto_resolvido_id?: string | null
          raw?: Json | null
          servico_origem?: string | null
          valido?: boolean | null
          valor?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "stg_contratos_custos_long_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "integration_batches"
            referencedColumns: ["id"]
          },
        ]
      }
      stg_contratos_custos_wide: {
        Row: {
          batch_id: string
          cenario: string | null
          cliente: string | null
          contrato: string | null
          created_at: string
          empresa_id: string
          empresa_origem: string | null
          id: string
          linha_origem: number | null
          posto: string | null
          quantidade: number | null
          raw: Json | null
          servico: string | null
          status: string | null
          valores: Json | null
          vigencia: string | null
        }
        Insert: {
          batch_id: string
          cenario?: string | null
          cliente?: string | null
          contrato?: string | null
          created_at?: string
          empresa_id: string
          empresa_origem?: string | null
          id?: string
          linha_origem?: number | null
          posto?: string | null
          quantidade?: number | null
          raw?: Json | null
          servico?: string | null
          status?: string | null
          valores?: Json | null
          vigencia?: string | null
        }
        Update: {
          batch_id?: string
          cenario?: string | null
          cliente?: string | null
          contrato?: string | null
          created_at?: string
          empresa_id?: string
          empresa_origem?: string | null
          id?: string
          linha_origem?: number | null
          posto?: string | null
          quantidade?: number | null
          raw?: Json | null
          servico?: string | null
          status?: string | null
          valores?: Json | null
          vigencia?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "stg_contratos_custos_wide_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "integration_batches"
            referencedColumns: ["id"]
          },
        ]
      }
      stg_contratos_master: {
        Row: {
          batch_id: string
          cidade: string | null
          contrato_nome: string | null
          contrato_resolvido_id: string | null
          created_at: string
          data_inicio: string | null
          empresa_id: string
          erro_msg: string | null
          id: string
          linha_origem: number | null
          numero_edital: string | null
          quant_funcionarios: number | null
          raw: Json | null
          responsavel: string | null
          valido: boolean | null
          valor_mensal: number | null
        }
        Insert: {
          batch_id: string
          cidade?: string | null
          contrato_nome?: string | null
          contrato_resolvido_id?: string | null
          created_at?: string
          data_inicio?: string | null
          empresa_id: string
          erro_msg?: string | null
          id?: string
          linha_origem?: number | null
          numero_edital?: string | null
          quant_funcionarios?: number | null
          raw?: Json | null
          responsavel?: string | null
          valido?: boolean | null
          valor_mensal?: number | null
        }
        Update: {
          batch_id?: string
          cidade?: string | null
          contrato_nome?: string | null
          contrato_resolvido_id?: string | null
          created_at?: string
          data_inicio?: string | null
          empresa_id?: string
          erro_msg?: string | null
          id?: string
          linha_origem?: number | null
          numero_edital?: string | null
          quant_funcionarios?: number | null
          raw?: Json | null
          responsavel?: string | null
          valido?: boolean | null
          valor_mensal?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "stg_contratos_master_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "integration_batches"
            referencedColumns: ["id"]
          },
        ]
      }
      stg_fluxo_caixa_projetado: {
        Row: {
          batch_id: string
          cenario: string | null
          centro_custo_resolvido_id: string | null
          classificacao: string | null
          contrato_resolvido_id: string | null
          created_at: string
          data_prevista: string | null
          empresa_id: string
          erro_msg: string | null
          id: string
          id_origem: string | null
          linha_origem: number | null
          raw: Json | null
          tipo: string | null
          valido: boolean | null
          valor: number | null
          valor_orcado: number | null
        }
        Insert: {
          batch_id: string
          cenario?: string | null
          centro_custo_resolvido_id?: string | null
          classificacao?: string | null
          contrato_resolvido_id?: string | null
          created_at?: string
          data_prevista?: string | null
          empresa_id: string
          erro_msg?: string | null
          id?: string
          id_origem?: string | null
          linha_origem?: number | null
          raw?: Json | null
          tipo?: string | null
          valido?: boolean | null
          valor?: number | null
          valor_orcado?: number | null
        }
        Update: {
          batch_id?: string
          cenario?: string | null
          centro_custo_resolvido_id?: string | null
          classificacao?: string | null
          contrato_resolvido_id?: string | null
          created_at?: string
          data_prevista?: string | null
          empresa_id?: string
          erro_msg?: string | null
          id?: string
          id_origem?: string | null
          linha_origem?: number | null
          raw?: Json | null
          tipo?: string | null
          valido?: boolean | null
          valor?: number | null
          valor_orcado?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "stg_fluxo_caixa_projetado_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "integration_batches"
            referencedColumns: ["id"]
          },
        ]
      }
      stg_fluxo_caixa_realizado: {
        Row: {
          banco_origem: string | null
          batch_id: string
          centro_custo_origem: string | null
          centro_custo_resolvido_id: string | null
          classificacao: string | null
          conta_bancaria_resolvida_id: string | null
          conta_contabil_resolvida_id: string | null
          contrato_resolvido_id: string | null
          created_at: string
          data_lancamento: string | null
          empresa_id: string
          empresa_origem: string | null
          erro_msg: string | null
          flag_categoria_ambigua: boolean | null
          forma_pagamento_origem: string | null
          historico: string | null
          id: string
          id_origem: string | null
          linha_origem: number | null
          numero_parcela: number | null
          observacao_categoria_original: string | null
          pendente_conta_contabil: boolean | null
          raw: Json | null
          recorrencia_tipo: string | null
          tipo: string | null
          valido: boolean | null
          valor: number | null
        }
        Insert: {
          banco_origem?: string | null
          batch_id: string
          centro_custo_origem?: string | null
          centro_custo_resolvido_id?: string | null
          classificacao?: string | null
          conta_bancaria_resolvida_id?: string | null
          conta_contabil_resolvida_id?: string | null
          contrato_resolvido_id?: string | null
          created_at?: string
          data_lancamento?: string | null
          empresa_id: string
          empresa_origem?: string | null
          erro_msg?: string | null
          flag_categoria_ambigua?: boolean | null
          forma_pagamento_origem?: string | null
          historico?: string | null
          id?: string
          id_origem?: string | null
          linha_origem?: number | null
          numero_parcela?: number | null
          observacao_categoria_original?: string | null
          pendente_conta_contabil?: boolean | null
          raw?: Json | null
          recorrencia_tipo?: string | null
          tipo?: string | null
          valido?: boolean | null
          valor?: number | null
        }
        Update: {
          banco_origem?: string | null
          batch_id?: string
          centro_custo_origem?: string | null
          centro_custo_resolvido_id?: string | null
          classificacao?: string | null
          conta_bancaria_resolvida_id?: string | null
          conta_contabil_resolvida_id?: string | null
          contrato_resolvido_id?: string | null
          created_at?: string
          data_lancamento?: string | null
          empresa_id?: string
          empresa_origem?: string | null
          erro_msg?: string | null
          flag_categoria_ambigua?: boolean | null
          forma_pagamento_origem?: string | null
          historico?: string | null
          id?: string
          id_origem?: string | null
          linha_origem?: number | null
          numero_parcela?: number | null
          observacao_categoria_original?: string | null
          pendente_conta_contabil?: boolean | null
          raw?: Json | null
          recorrencia_tipo?: string | null
          tipo?: string | null
          valido?: boolean | null
          valor?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "stg_fluxo_caixa_realizado_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "integration_batches"
            referencedColumns: ["id"]
          },
        ]
      }
      stg_licitacoes: {
        Row: {
          batch_id: string
          cidade: string | null
          created_at: string
          data_sessao: string | null
          edital: string | null
          empresa_id: string
          empresa_obs: string | null
          erro_msg: string | null
          fase: string | null
          horario: string | null
          id: string
          linha_origem: number | null
          local_prestacao: string | null
          objeto: string | null
          raw: Json | null
          status_obs: string | null
          uf: string | null
          valido: boolean | null
        }
        Insert: {
          batch_id: string
          cidade?: string | null
          created_at?: string
          data_sessao?: string | null
          edital?: string | null
          empresa_id: string
          empresa_obs?: string | null
          erro_msg?: string | null
          fase?: string | null
          horario?: string | null
          id?: string
          linha_origem?: number | null
          local_prestacao?: string | null
          objeto?: string | null
          raw?: Json | null
          status_obs?: string | null
          uf?: string | null
          valido?: boolean | null
        }
        Update: {
          batch_id?: string
          cidade?: string | null
          created_at?: string
          data_sessao?: string | null
          edital?: string | null
          empresa_id?: string
          empresa_obs?: string | null
          erro_msg?: string | null
          fase?: string | null
          horario?: string | null
          id?: string
          linha_origem?: number | null
          local_prestacao?: string | null
          objeto?: string | null
          raw?: Json | null
          status_obs?: string | null
          uf?: string | null
          valido?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "stg_licitacoes_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "integration_batches"
            referencedColumns: ["id"]
          },
        ]
      }
      stg_logs_processamento: {
        Row: {
          created_at: string
          detalhe: string | null
          etapa: string | null
          id: string
          pacote: string
          status: string | null
        }
        Insert: {
          created_at?: string
          detalhe?: string | null
          etapa?: string | null
          id?: string
          pacote: string
          status?: string | null
        }
        Update: {
          created_at?: string
          detalhe?: string | null
          etapa?: string | null
          id?: string
          pacote?: string
          status?: string | null
        }
        Relationships: []
      }
      stg_mapa_de_para_bancos_pacote02: {
        Row: {
          banco_original: string | null
          classificacoes_top: string | null
          conta_contabil_codigo_sugerida: string | null
          conta_contabil_nome_sugerida: string | null
          created_at: string
          empresa_detectada: string | null
          grau_confianca: string | null
          id_de_para_banco: string
          id_sugestao_conta: string | null
          origem_de_para: string | null
          origens_detectadas: string | null
          pendencia: string | null
          qtd_linhas_afetadas: number | null
          status_de_para_banco: string | null
          tipos_movimento_top: string | null
          valor_abs_total: number | null
        }
        Insert: {
          banco_original?: string | null
          classificacoes_top?: string | null
          conta_contabil_codigo_sugerida?: string | null
          conta_contabil_nome_sugerida?: string | null
          created_at?: string
          empresa_detectada?: string | null
          grau_confianca?: string | null
          id_de_para_banco: string
          id_sugestao_conta?: string | null
          origem_de_para?: string | null
          origens_detectadas?: string | null
          pendencia?: string | null
          qtd_linhas_afetadas?: number | null
          status_de_para_banco?: string | null
          tipos_movimento_top?: string | null
          valor_abs_total?: number | null
        }
        Update: {
          banco_original?: string | null
          classificacoes_top?: string | null
          conta_contabil_codigo_sugerida?: string | null
          conta_contabil_nome_sugerida?: string | null
          created_at?: string
          empresa_detectada?: string | null
          grau_confianca?: string | null
          id_de_para_banco?: string
          id_sugestao_conta?: string | null
          origem_de_para?: string | null
          origens_detectadas?: string | null
          pendencia?: string | null
          qtd_linhas_afetadas?: number | null
          status_de_para_banco?: string | null
          tipos_movimento_top?: string | null
          valor_abs_total?: number | null
        }
        Relationships: []
      }
      stg_mapa_de_para_contabil_financeiro: {
        Row: {
          arquivo_origem: string | null
          bancos_top: string | null
          categoria_despesa_top: string | null
          centros_custo_top: string | null
          chave_de_para: string | null
          classificacao_original: string | null
          codigo_evento_sugerido: string | null
          conta_credito_codigo_sugerida: string | null
          conta_credito_nome_sugerida: string | null
          conta_credito_origem: string | null
          conta_debito_codigo_sugerida: string | null
          conta_debito_nome_sugerida: string | null
          conta_debito_origem: string | null
          conta_resultado_ref_codigo: string | null
          conta_resultado_ref_nome: string | null
          conta_resultado_ref_origem: string | null
          contexto_gerencial: string | null
          created_at: string
          descricao_evento_sugerido: string | null
          direto_indireto: string | null
          empresas_detectadas_top: string | null
          exemplos_historico: string | null
          fixo_variavel: string | null
          gera_competencia_estimada: string | null
          gera_partida_caixa: string | null
          grau_confianca: string | null
          id_de_para: string
          ids_sugestoes_contas_relacionadas: string | null
          impacta_balanco: string | null
          impacta_caixa: string | null
          impacta_dre_caixa: string | null
          impacta_dre_competencia: string | null
          observacao_migracao: string | null
          origem_base: string | null
          pendencia: string | null
          qtd_linhas_afetadas: number | null
          qtd_valor_valido: number | null
          status_de_para: string | null
          tipo_gerencial: string | null
          tipo_movimento: string | null
          valor_abs_total: number | null
          valor_total: number | null
        }
        Insert: {
          arquivo_origem?: string | null
          bancos_top?: string | null
          categoria_despesa_top?: string | null
          centros_custo_top?: string | null
          chave_de_para?: string | null
          classificacao_original?: string | null
          codigo_evento_sugerido?: string | null
          conta_credito_codigo_sugerida?: string | null
          conta_credito_nome_sugerida?: string | null
          conta_credito_origem?: string | null
          conta_debito_codigo_sugerida?: string | null
          conta_debito_nome_sugerida?: string | null
          conta_debito_origem?: string | null
          conta_resultado_ref_codigo?: string | null
          conta_resultado_ref_nome?: string | null
          conta_resultado_ref_origem?: string | null
          contexto_gerencial?: string | null
          created_at?: string
          descricao_evento_sugerido?: string | null
          direto_indireto?: string | null
          empresas_detectadas_top?: string | null
          exemplos_historico?: string | null
          fixo_variavel?: string | null
          gera_competencia_estimada?: string | null
          gera_partida_caixa?: string | null
          grau_confianca?: string | null
          id_de_para: string
          ids_sugestoes_contas_relacionadas?: string | null
          impacta_balanco?: string | null
          impacta_caixa?: string | null
          impacta_dre_caixa?: string | null
          impacta_dre_competencia?: string | null
          observacao_migracao?: string | null
          origem_base?: string | null
          pendencia?: string | null
          qtd_linhas_afetadas?: number | null
          qtd_valor_valido?: number | null
          status_de_para?: string | null
          tipo_gerencial?: string | null
          tipo_movimento?: string | null
          valor_abs_total?: number | null
          valor_total?: number | null
        }
        Update: {
          arquivo_origem?: string | null
          bancos_top?: string | null
          categoria_despesa_top?: string | null
          centros_custo_top?: string | null
          chave_de_para?: string | null
          classificacao_original?: string | null
          codigo_evento_sugerido?: string | null
          conta_credito_codigo_sugerida?: string | null
          conta_credito_nome_sugerida?: string | null
          conta_credito_origem?: string | null
          conta_debito_codigo_sugerida?: string | null
          conta_debito_nome_sugerida?: string | null
          conta_debito_origem?: string | null
          conta_resultado_ref_codigo?: string | null
          conta_resultado_ref_nome?: string | null
          conta_resultado_ref_origem?: string | null
          contexto_gerencial?: string | null
          created_at?: string
          descricao_evento_sugerido?: string | null
          direto_indireto?: string | null
          empresas_detectadas_top?: string | null
          exemplos_historico?: string | null
          fixo_variavel?: string | null
          gera_competencia_estimada?: string | null
          gera_partida_caixa?: string | null
          grau_confianca?: string | null
          id_de_para?: string
          ids_sugestoes_contas_relacionadas?: string | null
          impacta_balanco?: string | null
          impacta_caixa?: string | null
          impacta_dre_caixa?: string | null
          impacta_dre_competencia?: string | null
          observacao_migracao?: string | null
          origem_base?: string | null
          pendencia?: string | null
          qtd_linhas_afetadas?: number | null
          qtd_valor_valido?: number | null
          status_de_para?: string | null
          tipo_gerencial?: string | null
          tipo_movimento?: string | null
          valor_abs_total?: number | null
          valor_total?: number | null
        }
        Relationships: []
      }
      stg_mapa_de_para_orcamento_contratos: {
        Row: {
          arquivo_origem: string | null
          cenarios_top: string | null
          clientes_top: string | null
          conta_orcamento_codigo_sugerida: string | null
          conta_orcamento_nome_sugerida: string | null
          conta_orcamento_origem: string | null
          contratos_top: string | null
          created_at: string
          descricoes_outros_top: string | null
          direto_indireto: string | null
          empresas_top: string | null
          fixo_variavel: string | null
          gera_lancamento_contabil: string | null
          grau_confianca: string | null
          id_de_para_orcamento: string
          id_sugestao_conta: string | null
          impacta_dre_orcada: string | null
          item_orcamento_original: string | null
          linha_dre_gerencial: string | null
          natureza_orcamento: string | null
          observacao: string | null
          origem_base: string | null
          pendencia: string | null
          qtd_linhas_com_valor: number | null
          servicos_top: string | null
          status_contrato_top: string | null
          status_de_para: string | null
          tipo_gerencial: string | null
          valor_abs_total: number | null
          valor_total: number | null
        }
        Insert: {
          arquivo_origem?: string | null
          cenarios_top?: string | null
          clientes_top?: string | null
          conta_orcamento_codigo_sugerida?: string | null
          conta_orcamento_nome_sugerida?: string | null
          conta_orcamento_origem?: string | null
          contratos_top?: string | null
          created_at?: string
          descricoes_outros_top?: string | null
          direto_indireto?: string | null
          empresas_top?: string | null
          fixo_variavel?: string | null
          gera_lancamento_contabil?: string | null
          grau_confianca?: string | null
          id_de_para_orcamento: string
          id_sugestao_conta?: string | null
          impacta_dre_orcada?: string | null
          item_orcamento_original?: string | null
          linha_dre_gerencial?: string | null
          natureza_orcamento?: string | null
          observacao?: string | null
          origem_base?: string | null
          pendencia?: string | null
          qtd_linhas_com_valor?: number | null
          servicos_top?: string | null
          status_contrato_top?: string | null
          status_de_para?: string | null
          tipo_gerencial?: string | null
          valor_abs_total?: number | null
          valor_total?: number | null
        }
        Update: {
          arquivo_origem?: string | null
          cenarios_top?: string | null
          clientes_top?: string | null
          conta_orcamento_codigo_sugerida?: string | null
          conta_orcamento_nome_sugerida?: string | null
          conta_orcamento_origem?: string | null
          contratos_top?: string | null
          created_at?: string
          descricoes_outros_top?: string | null
          direto_indireto?: string | null
          empresas_top?: string | null
          fixo_variavel?: string | null
          gera_lancamento_contabil?: string | null
          grau_confianca?: string | null
          id_de_para_orcamento?: string
          id_sugestao_conta?: string | null
          impacta_dre_orcada?: string | null
          item_orcamento_original?: string | null
          linha_dre_gerencial?: string | null
          natureza_orcamento?: string | null
          observacao?: string | null
          origem_base?: string | null
          pendencia?: string | null
          qtd_linhas_com_valor?: number | null
          servicos_top?: string | null
          status_contrato_top?: string | null
          status_de_para?: string | null
          tipo_gerencial?: string | null
          valor_abs_total?: number | null
          valor_total?: number | null
        }
        Relationships: []
      }
      stg_pendencias_de_para: {
        Row: {
          arquivo_origem: string | null
          classificacao_ou_item: string | null
          contexto_gerencial: string | null
          created_at: string
          descricao_pendencia: string | null
          id_pendencia: string
          id_referencia: string | null
          id_sugestao_conta: string | null
          origem_pendencia: string | null
          qtd_linhas_afetadas: number | null
          status_pendencia: string | null
          tipo_movimento: string | null
          tipo_pendencia: string | null
          valor_abs_total: number | null
        }
        Insert: {
          arquivo_origem?: string | null
          classificacao_ou_item?: string | null
          contexto_gerencial?: string | null
          created_at?: string
          descricao_pendencia?: string | null
          id_pendencia: string
          id_referencia?: string | null
          id_sugestao_conta?: string | null
          origem_pendencia?: string | null
          qtd_linhas_afetadas?: number | null
          status_pendencia?: string | null
          tipo_movimento?: string | null
          tipo_pendencia?: string | null
          valor_abs_total?: number | null
        }
        Update: {
          arquivo_origem?: string | null
          classificacao_ou_item?: string | null
          contexto_gerencial?: string | null
          created_at?: string
          descricao_pendencia?: string | null
          id_pendencia?: string
          id_referencia?: string | null
          id_sugestao_conta?: string | null
          origem_pendencia?: string | null
          qtd_linhas_afetadas?: number | null
          status_pendencia?: string | null
          tipo_movimento?: string | null
          tipo_pendencia?: string | null
          valor_abs_total?: number | null
        }
        Relationships: []
      }
      stg_plano_contas_proposto: {
        Row: {
          ativo: string | null
          centro_custo_padrao: string | null
          classe_contabil_normalizada: string | null
          classe_original: string | null
          codigo_conta: string
          codigo_conta_pai: string | null
          conta_reduzida: string | null
          created_at: string
          direto_indireto_padrao: string | null
          dre_codigo_original: string | null
          dre_descricao_original: string | null
          entra_fluxo: string | null
          entra_orcamento: string | null
          exige_contrato: string | null
          fixo_variavel_padrao: string | null
          grupo_contabil_normalizado: string | null
          grupo_dre_original: string | null
          grupo_principal_original: string | null
          id_sugestao_conta: string | null
          linha_dre_padrao: string | null
          natureza: string | null
          nivel: number | null
          nome_conta: string | null
          observacao_migracao: string | null
          origem_conta: string | null
          saldo_inicial: number | null
          status_aprovacao: string | null
          status_carga: string | null
          tipo_conta: string | null
          tipo_gerencial_padrao: string | null
        }
        Insert: {
          ativo?: string | null
          centro_custo_padrao?: string | null
          classe_contabil_normalizada?: string | null
          classe_original?: string | null
          codigo_conta: string
          codigo_conta_pai?: string | null
          conta_reduzida?: string | null
          created_at?: string
          direto_indireto_padrao?: string | null
          dre_codigo_original?: string | null
          dre_descricao_original?: string | null
          entra_fluxo?: string | null
          entra_orcamento?: string | null
          exige_contrato?: string | null
          fixo_variavel_padrao?: string | null
          grupo_contabil_normalizado?: string | null
          grupo_dre_original?: string | null
          grupo_principal_original?: string | null
          id_sugestao_conta?: string | null
          linha_dre_padrao?: string | null
          natureza?: string | null
          nivel?: number | null
          nome_conta?: string | null
          observacao_migracao?: string | null
          origem_conta?: string | null
          saldo_inicial?: number | null
          status_aprovacao?: string | null
          status_carga?: string | null
          tipo_conta?: string | null
          tipo_gerencial_padrao?: string | null
        }
        Update: {
          ativo?: string | null
          centro_custo_padrao?: string | null
          classe_contabil_normalizada?: string | null
          classe_original?: string | null
          codigo_conta?: string
          codigo_conta_pai?: string | null
          conta_reduzida?: string | null
          created_at?: string
          direto_indireto_padrao?: string | null
          dre_codigo_original?: string | null
          dre_descricao_original?: string | null
          entra_fluxo?: string | null
          entra_orcamento?: string | null
          exige_contrato?: string | null
          fixo_variavel_padrao?: string | null
          grupo_contabil_normalizado?: string | null
          grupo_dre_original?: string | null
          grupo_principal_original?: string | null
          id_sugestao_conta?: string | null
          linha_dre_padrao?: string | null
          natureza?: string | null
          nivel?: number | null
          nome_conta?: string | null
          observacao_migracao?: string | null
          origem_conta?: string | null
          saldo_inicial?: number | null
          status_aprovacao?: string | null
          status_carga?: string | null
          tipo_conta?: string | null
          tipo_gerencial_padrao?: string | null
        }
        Relationships: []
      }
      stg_reconciliacao_pacotes: {
        Row: {
          created_at: string
          id: string
          indicador: string
          observacao: string | null
          pacote: string
          quantidade: number | null
        }
        Insert: {
          created_at?: string
          id?: string
          indicador: string
          observacao?: string | null
          pacote: string
          quantidade?: number | null
        }
        Update: {
          created_at?: string
          id?: string
          indicador?: string
          observacao?: string | null
          pacote?: string
          quantidade?: number | null
        }
        Relationships: []
      }
      stg_sugestoes_novas_contas: {
        Row: {
          classe_contabil_sugerida: string | null
          codigo_conta_pai_sugerido: string | null
          codigo_conta_sugerido: string | null
          created_at: string
          decisao_usuario: string | null
          direto_indireto_padrao: string | null
          entra_orcamento: string | null
          exemplos_historico_ou_item: string | null
          fixo_variavel_padrao: string | null
          grau_confianca: string | null
          grupo_contabil_sugerido: string | null
          id_sugestao_conta: string
          impacta_caixa: string | null
          impacta_dre: string | null
          linha_dre_padrao: string | null
          motivo_sugestao: string | null
          natureza_sugerida: string | null
          nivel_sugerido: number | null
          nome_conta_pai_sugerido: string | null
          nome_conta_sugerido: string | null
          observacao_usuario: string | null
          origem_referencia: string | null
          origens_afetadas: string | null
          qtd_lancamentos_afetados: number | null
          status_aprovacao: string
          tipo_conta_sugerido: string | null
          tipo_gerencial_padrao: string | null
          valor_total_abs_afetado: number | null
        }
        Insert: {
          classe_contabil_sugerida?: string | null
          codigo_conta_pai_sugerido?: string | null
          codigo_conta_sugerido?: string | null
          created_at?: string
          decisao_usuario?: string | null
          direto_indireto_padrao?: string | null
          entra_orcamento?: string | null
          exemplos_historico_ou_item?: string | null
          fixo_variavel_padrao?: string | null
          grau_confianca?: string | null
          grupo_contabil_sugerido?: string | null
          id_sugestao_conta: string
          impacta_caixa?: string | null
          impacta_dre?: string | null
          linha_dre_padrao?: string | null
          motivo_sugestao?: string | null
          natureza_sugerida?: string | null
          nivel_sugerido?: number | null
          nome_conta_pai_sugerido?: string | null
          nome_conta_sugerido?: string | null
          observacao_usuario?: string | null
          origem_referencia?: string | null
          origens_afetadas?: string | null
          qtd_lancamentos_afetados?: number | null
          status_aprovacao?: string
          tipo_conta_sugerido?: string | null
          tipo_gerencial_padrao?: string | null
          valor_total_abs_afetado?: number | null
        }
        Update: {
          classe_contabil_sugerida?: string | null
          codigo_conta_pai_sugerido?: string | null
          codigo_conta_sugerido?: string | null
          created_at?: string
          decisao_usuario?: string | null
          direto_indireto_padrao?: string | null
          entra_orcamento?: string | null
          exemplos_historico_ou_item?: string | null
          fixo_variavel_padrao?: string | null
          grau_confianca?: string | null
          grupo_contabil_sugerido?: string | null
          id_sugestao_conta?: string
          impacta_caixa?: string | null
          impacta_dre?: string | null
          linha_dre_padrao?: string | null
          motivo_sugestao?: string | null
          natureza_sugerida?: string | null
          nivel_sugerido?: number | null
          nome_conta_pai_sugerido?: string | null
          nome_conta_sugerido?: string | null
          observacao_usuario?: string | null
          origem_referencia?: string | null
          origens_afetadas?: string | null
          qtd_lancamentos_afetados?: number | null
          status_aprovacao?: string
          tipo_conta_sugerido?: string | null
          tipo_gerencial_padrao?: string | null
          valor_total_abs_afetado?: number | null
        }
        Relationships: []
      }
      sup_aprov_alerta_log: {
        Row: {
          degrau_id: string
          destinatarios_efetivos: Json | null
          enviado_em: string
          etapa_id: string
          id: string
          instancia_id: string
        }
        Insert: {
          degrau_id: string
          destinatarios_efetivos?: Json | null
          enviado_em?: string
          etapa_id: string
          id?: string
          instancia_id: string
        }
        Update: {
          degrau_id?: string
          destinatarios_efetivos?: Json | null
          enviado_em?: string
          etapa_id?: string
          id?: string
          instancia_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sup_aprov_alerta_log_degrau_id_fkey"
            columns: ["degrau_id"]
            isOneToOne: false
            referencedRelation: "sup_aprov_regua_degrau"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sup_aprov_alerta_log_etapa_id_fkey"
            columns: ["etapa_id"]
            isOneToOne: false
            referencedRelation: "sup_aprov_etapa"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sup_aprov_alerta_log_instancia_id_fkey"
            columns: ["instancia_id"]
            isOneToOne: false
            referencedRelation: "sup_aprov_instancia"
            referencedColumns: ["id"]
          },
        ]
      }
      sup_aprov_etapa: {
        Row: {
          ativo: boolean
          created_at: string
          criticidade: Database["public"]["Enums"]["sup_aprov_criticidade"]
          delegado_ate: string | null
          delegado_para_user_id: string | null
          fluxo_id: string
          id: string
          instancia_id: string | null
          nome: string
          ordem: number
          prazo_horas: number
          regra_auto: Json | null
          responsavel_user_id: string
          tipo_parecer: Database["public"]["Enums"]["sup_aprov_tipo_parecer"]
          updated_at: string
          valor_max: number | null
          valor_min: number
        }
        Insert: {
          ativo?: boolean
          created_at?: string
          criticidade?: Database["public"]["Enums"]["sup_aprov_criticidade"]
          delegado_ate?: string | null
          delegado_para_user_id?: string | null
          fluxo_id: string
          id?: string
          instancia_id?: string | null
          nome: string
          ordem: number
          prazo_horas?: number
          regra_auto?: Json | null
          responsavel_user_id: string
          tipo_parecer?: Database["public"]["Enums"]["sup_aprov_tipo_parecer"]
          updated_at?: string
          valor_max?: number | null
          valor_min?: number
        }
        Update: {
          ativo?: boolean
          created_at?: string
          criticidade?: Database["public"]["Enums"]["sup_aprov_criticidade"]
          delegado_ate?: string | null
          delegado_para_user_id?: string | null
          fluxo_id?: string
          id?: string
          instancia_id?: string | null
          nome?: string
          ordem?: number
          prazo_horas?: number
          regra_auto?: Json | null
          responsavel_user_id?: string
          tipo_parecer?: Database["public"]["Enums"]["sup_aprov_tipo_parecer"]
          updated_at?: string
          valor_max?: number | null
          valor_min?: number
        }
        Relationships: [
          {
            foreignKeyName: "sup_aprov_etapa_delegado_para_user_id_fkey"
            columns: ["delegado_para_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sup_aprov_etapa_fluxo_id_fkey"
            columns: ["fluxo_id"]
            isOneToOne: false
            referencedRelation: "sup_aprov_fluxo"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sup_aprov_etapa_instancia_id_fkey"
            columns: ["instancia_id"]
            isOneToOne: false
            referencedRelation: "sup_aprov_instancia"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sup_aprov_etapa_responsavel_user_id_fkey"
            columns: ["responsavel_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      sup_aprov_fluxo: {
        Row: {
          alvo: Database["public"]["Enums"]["sup_aprov_alvo"]
          ativo: boolean
          created_at: string
          empresa_id: string
          id: string
          nome: string
          observacao: string | null
          regua_escalonamento_id: string | null
          updated_at: string
        }
        Insert: {
          alvo: Database["public"]["Enums"]["sup_aprov_alvo"]
          ativo?: boolean
          created_at?: string
          empresa_id: string
          id?: string
          nome: string
          observacao?: string | null
          regua_escalonamento_id?: string | null
          updated_at?: string
        }
        Update: {
          alvo?: Database["public"]["Enums"]["sup_aprov_alvo"]
          ativo?: boolean
          created_at?: string
          empresa_id?: string
          id?: string
          nome?: string
          observacao?: string | null
          regua_escalonamento_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sup_aprov_fluxo_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sup_aprov_fluxo_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "v_ia_contexto_empresa"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "sup_aprov_fluxo_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "vw_bi_resumo_empresa"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "sup_aprov_fluxo_regua_escalonamento_id_fkey"
            columns: ["regua_escalonamento_id"]
            isOneToOne: false
            referencedRelation: "sup_aprov_regua_escalonamento"
            referencedColumns: ["id"]
          },
        ]
      }
      sup_aprov_instancia: {
        Row: {
          aberta_em: string
          alvo: Database["public"]["Enums"]["sup_aprov_alvo"]
          centro_custo_id: string | null
          created_at: string
          empresa_id: string
          etapa_atual_id: string | null
          fechada_em: string | null
          fluxo_id: string
          id: string
          referencia_codigo: string | null
          referencia_id: string
          solicitante_user_id: string | null
          status: Database["public"]["Enums"]["sup_aprov_status"]
          updated_at: string
          valor: number
        }
        Insert: {
          aberta_em?: string
          alvo: Database["public"]["Enums"]["sup_aprov_alvo"]
          centro_custo_id?: string | null
          created_at?: string
          empresa_id: string
          etapa_atual_id?: string | null
          fechada_em?: string | null
          fluxo_id: string
          id?: string
          referencia_codigo?: string | null
          referencia_id: string
          solicitante_user_id?: string | null
          status?: Database["public"]["Enums"]["sup_aprov_status"]
          updated_at?: string
          valor?: number
        }
        Update: {
          aberta_em?: string
          alvo?: Database["public"]["Enums"]["sup_aprov_alvo"]
          centro_custo_id?: string | null
          created_at?: string
          empresa_id?: string
          etapa_atual_id?: string | null
          fechada_em?: string | null
          fluxo_id?: string
          id?: string
          referencia_codigo?: string | null
          referencia_id?: string
          solicitante_user_id?: string | null
          status?: Database["public"]["Enums"]["sup_aprov_status"]
          updated_at?: string
          valor?: number
        }
        Relationships: [
          {
            foreignKeyName: "sup_aprov_instancia_centro_custo_id_fkey"
            columns: ["centro_custo_id"]
            isOneToOne: false
            referencedRelation: "centros_custo"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sup_aprov_instancia_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sup_aprov_instancia_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "v_ia_contexto_empresa"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "sup_aprov_instancia_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "vw_bi_resumo_empresa"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "sup_aprov_instancia_etapa_atual_id_fkey"
            columns: ["etapa_atual_id"]
            isOneToOne: false
            referencedRelation: "sup_aprov_etapa"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sup_aprov_instancia_fluxo_id_fkey"
            columns: ["fluxo_id"]
            isOneToOne: false
            referencedRelation: "sup_aprov_fluxo"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sup_aprov_instancia_solicitante_user_id_fkey"
            columns: ["solicitante_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      sup_aprov_notif_pref: {
        Row: {
          email_ativo: boolean
          push_ativo: boolean
          sininho_ativo: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          email_ativo?: boolean
          push_ativo?: boolean
          sininho_ativo?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          email_ativo?: boolean
          push_ativo?: boolean
          sininho_ativo?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sup_aprov_notif_pref_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      sup_aprov_regua_degrau: {
        Row: {
          canais: Json
          created_at: string
          destinatarios: Json
          horas_extra: number | null
          id: string
          ordem: number
          pct_prazo: number | null
          reatribui: boolean
          regua_id: string
        }
        Insert: {
          canais?: Json
          created_at?: string
          destinatarios?: Json
          horas_extra?: number | null
          id?: string
          ordem: number
          pct_prazo?: number | null
          reatribui?: boolean
          regua_id: string
        }
        Update: {
          canais?: Json
          created_at?: string
          destinatarios?: Json
          horas_extra?: number | null
          id?: string
          ordem?: number
          pct_prazo?: number | null
          reatribui?: boolean
          regua_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sup_aprov_regua_degrau_regua_id_fkey"
            columns: ["regua_id"]
            isOneToOne: false
            referencedRelation: "sup_aprov_regua_escalonamento"
            referencedColumns: ["id"]
          },
        ]
      }
      sup_aprov_regua_escalonamento: {
        Row: {
          ativo: boolean
          created_at: string
          descricao: string | null
          id: string
          nome: string
          updated_at: string
        }
        Insert: {
          ativo?: boolean
          created_at?: string
          descricao?: string | null
          id?: string
          nome: string
          updated_at?: string
        }
        Update: {
          ativo?: boolean
          created_at?: string
          descricao?: string | null
          id?: string
          nome?: string
          updated_at?: string
        }
        Relationships: []
      }
      sup_aprov_voto: {
        Row: {
          etapa_id: string
          id: string
          instancia_id: string
          justificativa: string | null
          parecer: Database["public"]["Enums"]["sup_aprov_parecer"]
          usuario_id: string
          votado_em: string
        }
        Insert: {
          etapa_id: string
          id?: string
          instancia_id: string
          justificativa?: string | null
          parecer: Database["public"]["Enums"]["sup_aprov_parecer"]
          usuario_id: string
          votado_em?: string
        }
        Update: {
          etapa_id?: string
          id?: string
          instancia_id?: string
          justificativa?: string | null
          parecer?: Database["public"]["Enums"]["sup_aprov_parecer"]
          usuario_id?: string
          votado_em?: string
        }
        Relationships: [
          {
            foreignKeyName: "sup_aprov_voto_etapa_id_fkey"
            columns: ["etapa_id"]
            isOneToOne: false
            referencedRelation: "sup_aprov_etapa"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sup_aprov_voto_instancia_id_fkey"
            columns: ["instancia_id"]
            isOneToOne: false
            referencedRelation: "sup_aprov_instancia"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sup_aprov_voto_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      template_mensagem: {
        Row: {
          assunto: string | null
          ativo: boolean
          codigo: string
          corpo: string
          created_at: string
          empresa_id: string | null
          id: string
          nome: string
          tipo: Database["public"]["Enums"]["template_tipo"]
          updated_at: string
          variaveis: Json | null
        }
        Insert: {
          assunto?: string | null
          ativo?: boolean
          codigo: string
          corpo: string
          created_at?: string
          empresa_id?: string | null
          id?: string
          nome: string
          tipo: Database["public"]["Enums"]["template_tipo"]
          updated_at?: string
          variaveis?: Json | null
        }
        Update: {
          assunto?: string | null
          ativo?: boolean
          codigo?: string
          corpo?: string
          created_at?: string
          empresa_id?: string | null
          id?: string
          nome?: string
          tipo?: Database["public"]["Enums"]["template_tipo"]
          updated_at?: string
          variaveis?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "template_mensagem_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "template_mensagem_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "v_ia_contexto_empresa"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "template_mensagem_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "vw_bi_resumo_empresa"
            referencedColumns: ["empresa_id"]
          },
        ]
      }
      titulo_pagar: {
        Row: {
          centro_custo_id: string | null
          codigo_barras: string | null
          competencia: string
          conta_bancaria_id: string | null
          conta_contabil_id: string | null
          contrato_id: string | null
          created_at: string
          data_agendamento: string | null
          data_emissao: string
          data_pagamento: string | null
          data_vencimento: string
          empresa_id: string
          forma_pagamento: Database["public"]["Enums"]["forma_pagamento"] | null
          fornecedor_id: string | null
          hash_dedup: string | null
          id: string
          linha_digitavel: string | null
          nf_entrada_id: string | null
          nosso_numero: string | null
          numero_documento: string
          observacoes: string | null
          parcela_num: number
          parcela_total: number
          pedido_id: string | null
          pix_chave: string | null
          remessa_id: string | null
          remessa_status: Database["public"]["Enums"]["titulo_remessa_status"]
          status: Database["public"]["Enums"]["titulo_status"]
          updated_at: string
          valor: number
          valor_pago: number
        }
        Insert: {
          centro_custo_id?: string | null
          codigo_barras?: string | null
          competencia: string
          conta_bancaria_id?: string | null
          conta_contabil_id?: string | null
          contrato_id?: string | null
          created_at?: string
          data_agendamento?: string | null
          data_emissao?: string
          data_pagamento?: string | null
          data_vencimento: string
          empresa_id: string
          forma_pagamento?:
            | Database["public"]["Enums"]["forma_pagamento"]
            | null
          fornecedor_id?: string | null
          hash_dedup?: string | null
          id?: string
          linha_digitavel?: string | null
          nf_entrada_id?: string | null
          nosso_numero?: string | null
          numero_documento: string
          observacoes?: string | null
          parcela_num?: number
          parcela_total?: number
          pedido_id?: string | null
          pix_chave?: string | null
          remessa_id?: string | null
          remessa_status?: Database["public"]["Enums"]["titulo_remessa_status"]
          status?: Database["public"]["Enums"]["titulo_status"]
          updated_at?: string
          valor?: number
          valor_pago?: number
        }
        Update: {
          centro_custo_id?: string | null
          codigo_barras?: string | null
          competencia?: string
          conta_bancaria_id?: string | null
          conta_contabil_id?: string | null
          contrato_id?: string | null
          created_at?: string
          data_agendamento?: string | null
          data_emissao?: string
          data_pagamento?: string | null
          data_vencimento?: string
          empresa_id?: string
          forma_pagamento?:
            | Database["public"]["Enums"]["forma_pagamento"]
            | null
          fornecedor_id?: string | null
          hash_dedup?: string | null
          id?: string
          linha_digitavel?: string | null
          nf_entrada_id?: string | null
          nosso_numero?: string | null
          numero_documento?: string
          observacoes?: string | null
          parcela_num?: number
          parcela_total?: number
          pedido_id?: string | null
          pix_chave?: string | null
          remessa_id?: string | null
          remessa_status?: Database["public"]["Enums"]["titulo_remessa_status"]
          status?: Database["public"]["Enums"]["titulo_status"]
          updated_at?: string
          valor?: number
          valor_pago?: number
        }
        Relationships: [
          {
            foreignKeyName: "titulo_pagar_centro_custo_fk"
            columns: ["centro_custo_id"]
            isOneToOne: false
            referencedRelation: "centros_custo"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "titulo_pagar_conta_bancaria_fk"
            columns: ["conta_bancaria_id"]
            isOneToOne: false
            referencedRelation: "conta_bancaria"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "titulo_pagar_contrato_fk"
            columns: ["contrato_id"]
            isOneToOne: false
            referencedRelation: "contrato"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "titulo_pagar_fornecedor_fk"
            columns: ["fornecedor_id"]
            isOneToOne: false
            referencedRelation: "fornecedor"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "titulo_pagar_nf_entrada_id_fkey"
            columns: ["nf_entrada_id"]
            isOneToOne: false
            referencedRelation: "nf_entrada"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "titulo_pagar_remessa_fk"
            columns: ["remessa_id"]
            isOneToOne: false
            referencedRelation: "remessa_cnab"
            referencedColumns: ["id"]
          },
        ]
      }
      titulo_receber: {
        Row: {
          centro_custo_id: string | null
          cliente_nome: string
          competencia: string
          conta_bancaria_id: string | null
          conta_contabil_id: string | null
          contrato_id: string | null
          created_at: string
          created_by: string | null
          cronograma_id: string | null
          data_emissao: string
          data_recebimento: string | null
          data_vencimento: string
          descricao: string | null
          empresa_id: string
          hash_dedup: string | null
          id: string
          meio_cobranca: Database["public"]["Enums"]["titulo_receber_meio"]
          nfse_id: string | null
          numero: string | null
          numero_documento: string
          observacoes: string | null
          sacado_documento: string | null
          sacado_email: string | null
          sacado_endereco: Json | null
          sacado_nome: string
          sacado_telefone: string | null
          status: Database["public"]["Enums"]["titulo_status"]
          updated_at: string
          valor: number
          valor_desconto: number
          valor_juros: number
          valor_multa: number
          valor_recebido: number
        }
        Insert: {
          centro_custo_id?: string | null
          cliente_nome: string
          competencia: string
          conta_bancaria_id?: string | null
          conta_contabil_id?: string | null
          contrato_id?: string | null
          created_at?: string
          created_by?: string | null
          cronograma_id?: string | null
          data_emissao?: string
          data_recebimento?: string | null
          data_vencimento: string
          descricao?: string | null
          empresa_id: string
          hash_dedup?: string | null
          id?: string
          meio_cobranca?: Database["public"]["Enums"]["titulo_receber_meio"]
          nfse_id?: string | null
          numero?: string | null
          numero_documento: string
          observacoes?: string | null
          sacado_documento?: string | null
          sacado_email?: string | null
          sacado_endereco?: Json | null
          sacado_nome: string
          sacado_telefone?: string | null
          status?: Database["public"]["Enums"]["titulo_status"]
          updated_at?: string
          valor?: number
          valor_desconto?: number
          valor_juros?: number
          valor_multa?: number
          valor_recebido?: number
        }
        Update: {
          centro_custo_id?: string | null
          cliente_nome?: string
          competencia?: string
          conta_bancaria_id?: string | null
          conta_contabil_id?: string | null
          contrato_id?: string | null
          created_at?: string
          created_by?: string | null
          cronograma_id?: string | null
          data_emissao?: string
          data_recebimento?: string | null
          data_vencimento?: string
          descricao?: string | null
          empresa_id?: string
          hash_dedup?: string | null
          id?: string
          meio_cobranca?: Database["public"]["Enums"]["titulo_receber_meio"]
          nfse_id?: string | null
          numero?: string | null
          numero_documento?: string
          observacoes?: string | null
          sacado_documento?: string | null
          sacado_email?: string | null
          sacado_endereco?: Json | null
          sacado_nome?: string
          sacado_telefone?: string | null
          status?: Database["public"]["Enums"]["titulo_status"]
          updated_at?: string
          valor?: number
          valor_desconto?: number
          valor_juros?: number
          valor_multa?: number
          valor_recebido?: number
        }
        Relationships: [
          {
            foreignKeyName: "titulo_receber_cronograma_id_fkey"
            columns: ["cronograma_id"]
            isOneToOne: false
            referencedRelation: "cronograma_faturamento"
            referencedColumns: ["id"]
          },
        ]
      }
      titulo_receber_baixa: {
        Row: {
          conta_bancaria_id: string | null
          created_at: string
          created_by: string | null
          data_baixa: string
          empresa_id: string
          id: string
          meio: Database["public"]["Enums"]["titulo_receber_meio"]
          movimento_bancario_id: string | null
          observacoes: string | null
          origem: string | null
          titulo_id: string
          valor: number
          valor_desconto: number
          valor_juros: number
          valor_multa: number
        }
        Insert: {
          conta_bancaria_id?: string | null
          created_at?: string
          created_by?: string | null
          data_baixa?: string
          empresa_id: string
          id?: string
          meio?: Database["public"]["Enums"]["titulo_receber_meio"]
          movimento_bancario_id?: string | null
          observacoes?: string | null
          origem?: string | null
          titulo_id: string
          valor: number
          valor_desconto?: number
          valor_juros?: number
          valor_multa?: number
        }
        Update: {
          conta_bancaria_id?: string | null
          created_at?: string
          created_by?: string | null
          data_baixa?: string
          empresa_id?: string
          id?: string
          meio?: Database["public"]["Enums"]["titulo_receber_meio"]
          movimento_bancario_id?: string | null
          observacoes?: string | null
          origem?: string | null
          titulo_id?: string
          valor?: number
          valor_desconto?: number
          valor_juros?: number
          valor_multa?: number
        }
        Relationships: [
          {
            foreignKeyName: "titulo_receber_baixa_conta_bancaria_id_fkey"
            columns: ["conta_bancaria_id"]
            isOneToOne: false
            referencedRelation: "conta_bancaria"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "titulo_receber_baixa_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "titulo_receber_baixa_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "v_ia_contexto_empresa"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "titulo_receber_baixa_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "vw_bi_resumo_empresa"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "titulo_receber_baixa_titulo_id_fkey"
            columns: ["titulo_id"]
            isOneToOne: false
            referencedRelation: "titulo_receber"
            referencedColumns: ["id"]
          },
        ]
      }
      user_empresa: {
        Row: {
          created_at: string
          created_by: string | null
          empresa_id: string
          id: string
          is_default: boolean
          user_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          empresa_id: string
          id?: string
          is_default?: boolean
          user_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          empresa_id?: string
          id?: string
          is_default?: boolean
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_empresa_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_empresa_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "v_ia_contexto_empresa"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "user_empresa_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "vw_bi_resumo_empresa"
            referencedColumns: ["empresa_id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      v_dre_comparativo: {
        Row: {
          ano: number | null
          centro_custo_id: string | null
          dre_linha_id: string | null
          empresa_id: string | null
          mes: number | null
          valor_orcado: number | null
          valor_realizado: number | null
          variacao_abs: number | null
          variacao_pct: number | null
        }
        Relationships: []
      }
      v_estoque_consolidado: {
        Row: {
          abaixo_minimo: boolean | null
          almoxarifado_id: string | null
          almoxarifado_nome: string | null
          categoria_id: string | null
          custo_unitario_medio: number | null
          empresa_id: string | null
          estoque_maximo: number | null
          estoque_minimo: number | null
          is_matriz: boolean | null
          produto_codigo: string | null
          produto_descricao: string | null
          produto_id: string | null
          quantidade_disponivel: number | null
          quantidade_reservada_total: number | null
          quantidade_total: number | null
          unidade: string | null
          valor_total_estoque: number | null
        }
        Relationships: [
          {
            foreignKeyName: "estoque_saldo_almoxarifado_id_fkey"
            columns: ["almoxarifado_id"]
            isOneToOne: false
            referencedRelation: "almoxarifado"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "estoque_saldo_produto_id_fkey"
            columns: ["produto_id"]
            isOneToOne: false
            referencedRelation: "produto"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "produto_categoria_id_fkey"
            columns: ["categoria_id"]
            isOneToOne: false
            referencedRelation: "produto_categoria"
            referencedColumns: ["id"]
          },
        ]
      }
      v_fluxo_caixa_consolidado: {
        Row: {
          ano: number | null
          empresa_id: string | null
          entradas: number | null
          mes: number | null
          regime: string | null
          saidas: number | null
          saldo: number | null
        }
        Relationships: []
      }
      v_fluxo_caixa_mensal: {
        Row: {
          ano: number | null
          empresa_id: string | null
          entradas: number | null
          mes: number | null
          saidas: number | null
          saldo: number | null
        }
        Relationships: [
          {
            foreignKeyName: "realizado_lancamentos_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "realizado_lancamentos_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "v_ia_contexto_empresa"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "realizado_lancamentos_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "vw_bi_resumo_empresa"
            referencedColumns: ["empresa_id"]
          },
        ]
      }
      v_ia_contexto_empresa: {
        Row: {
          ano_referencia: number | null
          codigo: string | null
          empresa_id: string | null
          entradas_ytd: number | null
          orcado_ytd: number | null
          razao_social: string | null
          realizado_ytd: number | null
          saidas_ytd: number | null
          saldo_ytd: number | null
          variacao_abs_ytd: number | null
        }
        Relationships: []
      }
      v_obz_mensal: {
        Row: {
          ano: number | null
          centro_custo_id: string | null
          dre_linha_id: string | null
          empresa_id: string | null
          mes: number | null
          revisao: number | null
          valor_orcado: number | null
          versao: number | null
          versao_status: Database["public"]["Enums"]["obz_status"] | null
        }
        Relationships: [
          {
            foreignKeyName: "obz_valores_centro_custo_id_fkey"
            columns: ["centro_custo_id"]
            isOneToOne: false
            referencedRelation: "centros_custo"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "obz_valores_dre_linha_id_fkey"
            columns: ["dre_linha_id"]
            isOneToOne: false
            referencedRelation: "dre_linhas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "obz_versoes_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "obz_versoes_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "v_ia_contexto_empresa"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "obz_versoes_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "vw_bi_resumo_empresa"
            referencedColumns: ["empresa_id"]
          },
        ]
      }
      v_realizado_mensal: {
        Row: {
          ano: number | null
          centro_custo_id: string | null
          dre_linha_id: string | null
          empresa_id: string | null
          mes: number | null
          qtd_lancamentos: number | null
          valor_realizado: number | null
        }
        Relationships: [
          {
            foreignKeyName: "realizado_lancamentos_centro_custo_id_fkey"
            columns: ["centro_custo_id"]
            isOneToOne: false
            referencedRelation: "centros_custo"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "realizado_lancamentos_dre_linha_id_fkey"
            columns: ["dre_linha_id"]
            isOneToOne: false
            referencedRelation: "dre_linhas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "realizado_lancamentos_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "realizado_lancamentos_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "v_ia_contexto_empresa"
            referencedColumns: ["empresa_id"]
          },
          {
            foreignKeyName: "realizado_lancamentos_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "vw_bi_resumo_empresa"
            referencedColumns: ["empresa_id"]
          },
        ]
      }
      vw_bi_resumo_empresa: {
        Row: {
          colaboradores_ativos: number | null
          contas_pagar_aberto: number | null
          contas_receber_aberto: number | null
          contratos_ativos: number | null
          empresa_id: string | null
          faturamento_mensal_total: number | null
          pedidos_compra_abertos: number | null
          razao_social: string | null
        }
        Insert: {
          colaboradores_ativos?: never
          contas_pagar_aberto?: never
          contas_receber_aberto?: never
          contratos_ativos?: never
          empresa_id?: string | null
          faturamento_mensal_total?: never
          pedidos_compra_abertos?: never
          razao_social?: string | null
        }
        Update: {
          colaboradores_ativos?: never
          contas_pagar_aberto?: never
          contas_receber_aberto?: never
          contratos_ativos?: never
          empresa_id?: string | null
          faturamento_mensal_total?: never
          pedidos_compra_abertos?: never
          razao_social?: string | null
        }
        Relationships: []
      }
      vw_conciliacao_eventos: {
        Row: {
          contabilizado: boolean | null
          data: string | null
          doc: string | null
          empresa_id: string | null
          lancamento_id: string | null
          lancamento_numero: string | null
          lancamento_status: string | null
          origem_id: string | null
          origem_tipo: string | null
          status_origem: string | null
          valor: number | null
        }
        Relationships: []
      }
      vw_dre_contrato: {
        Row: {
          ciclo_id: string | null
          competencia: string | null
          contrato_id: string | null
          dre_codigo: string | null
          dre_descricao: string | null
          dre_linha_id: string | null
          dre_natureza: Database["public"]["Enums"]["dre_natureza"] | null
          empresa_id: string | null
          orcamento_contrato_id: string | null
          valor_previsto: number | null
        }
        Relationships: [
          {
            foreignKeyName: "orcamento_contrato_ciclo_id_fkey"
            columns: ["ciclo_id"]
            isOneToOne: false
            referencedRelation: "orcamento_ciclo"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orcamento_contrato_contrato_id_fkey"
            columns: ["contrato_id"]
            isOneToOne: false
            referencedRelation: "contrato"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orcamento_contrato_linha_dre_linha_id_fkey"
            columns: ["dre_linha_id"]
            isOneToOne: false
            referencedRelation: "dre_linhas"
            referencedColumns: ["id"]
          },
        ]
      }
      vw_mz_32_promocao_status: {
        Row: {
          mestres_promovidos: number | null
          mestres_staging: number | null
          pct_promovido: number | null
          pendentes: number | null
          sigla: string | null
          total_promovido_brl: number | null
        }
        Relationships: []
      }
    }
    Functions: {
      _aud_normaliza_texto: { Args: { p_txt: string }; Returns: string }
      _bdi_assert_responsavel: {
        Args: { p_acao: string; p_licitacao_id: string }
        Returns: {
          empresa_id: string
          responsavel_user_id: string
          status: Database["public"]["Enums"]["licitacao_status"]
        }[]
      }
      _conta_contabil_de_banco: {
        Args: { p_conta_bancaria_id: string }
        Returns: string
      }
      admin_alterar_empresa_cc: {
        Args: { _cc_id: string; _motivo: string; _nova_empresa_id: string }
        Returns: Json
      }
      admin_exec_dml: { Args: { p_sql: string }; Returns: undefined }
      admin_list_active_sessions: {
        Args: never
        Returns: {
          created_at: string
          display_name: string
          email: string
          id: string
          ip: string
          refreshed_at: string
          user_agent: string
          user_id: string
        }[]
      }
      admin_list_auth_logs: {
        Args: { _limit?: number }
        Returns: {
          created_at: string
          id: string
          ip_address: string
          payload: Json
        }[]
      }
      aplicar_plano_mestre: { Args: { _empresa_id: string }; Returns: number }
      apurar_impostos_competencia: {
        Args: { _competencia: string; _empresa_id: string }
        Returns: Json
      }
      balancete: {
        Args: { _data_fim: string; _data_ini: string; _empresa_id: string }
        Returns: {
          classificacao: string
          conta_id: string
          credito: number
          debito: number
          descricao: string
          natureza: string
          saldo: number
        }[]
      }
      balanco_patrimonial: {
        Args: { _data_corte: string; _empresa_id: string }
        Returns: {
          classificacao: string
          conta_id: string
          descricao: string
          grupo: string
          saldo: number
        }[]
      }
      bdi_atualizar_versao: {
        Args: { p_payload: string; p_versao_id: string }
        Returns: Json
      }
      bdi_cancelar: {
        Args: { p_justificativa: string; p_versao_id: string }
        Returns: Json
      }
      bdi_criar_versao: { Args: { p_licitacao_id: string }; Returns: Json }
      bdi_excluir_item: { Args: { p_item_id: string }; Returns: Json }
      bdi_excluir_posto: { Args: { p_posto_id: string }; Returns: Json }
      bdi_excluir_verba: { Args: { p_verba_id: string }; Returns: Json }
      bdi_obter_versao: { Args: { p_licitacao_id: string }; Returns: Json }
      bdi_recalcular: { Args: { p_versao_id: string }; Returns: Json }
      bdi_salvar_item: {
        Args: {
          p_campo_key: string
          p_grupo: Database["public"]["Enums"]["bdi_item_grupo"]
          p_item_id: string
          p_label: string
          p_observacao: string
          p_ordem: number
          p_produto_servico_id: string
          p_quantidade: number
          p_tipo: Database["public"]["Enums"]["bdi_item_tipo"]
          p_unidade: string
          p_valor: number
          p_versao_id: string
          p_vunit_est: number
        }
        Returns: Json
      }
      bdi_salvar_posto: {
        Args: {
          p_cargo: string
          p_epis: number
          p_insalub_pct: number
          p_local: string
          p_observacao: string
          p_ordem: number
          p_pericul_pct: number
          p_posto_id: string
          p_qtd: number
          p_salario_base: number
          p_uniformes: number
          p_va: number
          p_versao_id: string
          p_vt: number
        }
        Returns: Json
      }
      bdi_salvar_verba: {
        Args: {
          p_observacao: string
          p_ordem: number
          p_percentual: number
          p_rubrica: string
          p_verba_id: string
          p_versao_id: string
        }
        Returns: Json
      }
      bdi_submeter: {
        Args: { p_justificativa: string; p_versao_id: string }
        Returns: Json
      }
      can_access: {
        Args: {
          _acao?: Database["public"]["Enums"]["app_acao"]
          _empresa?: string
          _menu: string
          _modulo?: string
          _user: string
        }
        Returns: boolean
      }
      cnab_gerar_remessa: {
        Args: { _conta_bancaria_id: string; _titulo_ids: string[] }
        Returns: Json
      }
      cnab_gerar_remessa_cobranca: {
        Args: { _boleto_ids: string[]; _conta_bancaria_id: string }
        Returns: Json
      }
      cnab_processar_retorno: { Args: { _retorno_id: string }; Returns: Json }
      cobranca_gerar_boleto: {
        Args: { _carteira?: string; _instrucoes?: string; _titulo_id: string }
        Returns: Json
      }
      cobranca_gerar_pix: {
        Args: {
          _chave_pix?: string
          _expiracao_segundos?: number
          _titulo_id: string
        }
        Returns: Json
      }
      conciliacao_auto_match: { Args: { _empresa_id: string }; Returns: Json }
      contabilizar_baixa_pagar: {
        Args: { _titulo_id: string }
        Returns: string
      }
      contabilizar_baixa_receber: {
        Args: { _baixa_id: string }
        Returns: string
      }
      contabilizar_folha: {
        Args: { _evento: string; _periodo_id: string }
        Returns: string
      }
      contabilizar_nf_entrada: {
        Args: { p_codigo_evento: string; p_nf_id: string }
        Returns: string
      }
      contabilizar_nota_fiscal: { Args: { _nota_id: string }; Returns: string }
      cotacao_calcular_score: { Args: { _cotacao_id: string }; Returns: Json }
      cotacao_fechar: {
        Args: {
          _cotacao_id: string
          _justificativa?: string
          _motivo_dispensa?: string
          _vencedor_fornecedor_id: string
        }
        Returns: Json
      }
      diagnostico_alterar_empresa_cc: {
        Args: { _cc_id: string }
        Returns: Json
      }
      dre_gerencial_competencia: {
        Args: { _ano: number; _empresa_id: string; _versao_obz?: string }
        Returns: {
          codigo: string
          descricao: string
          dre_linha_id: string
          mes: number
          natureza: string
          orcado: number
          ordem: number
          realizado: number
          variacao: number
        }[]
      }
      dre_gerencial_competencia_detalhado: {
        Args: { _ano: number; _empresa_id: string; _versao_obz?: string }
        Returns: {
          dre_linha_id: string
          linha_codigo: string
          linha_descricao: string
          linha_natureza: string
          linha_ordem: number
          mes: number
          orcado: number
          realizado: number
          sub_codigo: string
          sub_descricao: string
          sub_ordem: number
        }[]
      }
      dre_gerencial_mensal: {
        Args: { _ano: number; _empresa_id: string; _versao_obz?: string }
        Returns: {
          codigo: string
          descricao: string
          dre_linha_id: string
          mes: number
          natureza: string
          orcado: number
          ordem: number
          realizado: number
          variacao: number
        }[]
      }
      dre_realizado: {
        Args: { _data_fim: string; _data_ini: string; _empresa_id: string }
        Returns: {
          classificacao: string
          conta_id: string
          descricao: string
          grupo: string
          valor: number
        }[]
      }
      dre_sublinha_dict: {
        Args: never
        Returns: {
          linha_codigo: string
          sub_codigo: string
          sub_descricao: string
          sub_ordem: number
        }[]
      }
      dre_sublinha_label: {
        Args: { _classificacao: string; _descricao: string }
        Returns: {
          linha_codigo: string
          sub_codigo: string
          sub_descricao: string
          sub_ordem: number
        }[]
      }
      emitir_titulo_de_cronograma: {
        Args: {
          _conta_bancaria_id?: string
          _cronograma_id: string
          _data_vencimento?: string
          _descricao?: string
          _meio_cobranca?: Database["public"]["Enums"]["titulo_receber_meio"]
          _sacado_documento?: string
          _sacado_email?: string
          _sacado_nome?: string
        }
        Returns: Json
      }
      emitir_titulos_cronograma_lote: {
        Args: {
          _conta_bancaria_id?: string
          _ids: string[]
          _meio_cobranca?: Database["public"]["Enums"]["titulo_receber_meio"]
        }
        Returns: Json
      }
      estornar_lancamento_contabil: {
        Args: { p_lancamento_id: string; p_motivo?: string }
        Returns: string
      }
      extrato_importar: {
        Args: {
          _conta_bancaria_id: string
          _conteudo: string
          _formato: Database["public"]["Enums"]["retorno_formato"]
        }
        Returns: Json
      }
      faturar_contrato_competencia: {
        Args: {
          _competencia: string
          _conta_bancaria_id?: string
          _contrato_id: string
          _data_vencimento: string
          _descricao?: string
          _meio_cobranca?: Database["public"]["Enums"]["titulo_receber_meio"]
          _sacado_documento?: string
          _sacado_email?: string
          _sacado_nome?: string
          _valor: number
        }
        Returns: Json
      }
      fcr_promover_lancamento: {
        Args: {
          _centro_custo_id: string
          _contraparte?: string
          _data_competencia: string
          _data_lancamento: string
          _descricao: string
          _documento?: string
          _dre_linha_id: string
          _empresa_id: string
          _mz_id: number
          _observacoes?: string
          _valor: number
        }
        Returns: string
      }
      fluxo_caixa_diario: {
        Args: { _data_fim: string; _data_ini: string; _empresa_id: string }
        Returns: {
          bloco: string
          categoria: string
          dia: string
          saldo_inicial: number
          valor: number
        }[]
      }
      fluxo_caixa_diario_consolidado: {
        Args: { _data_fim: string; _data_ini: string }
        Returns: {
          bloco: string
          categoria: string
          dia: string
          saldo_inicial: number
          valor: number
        }[]
      }
      fluxo_caixa_diario_orcado: {
        Args: { _data_fim: string; _data_ini: string; _empresa_id: string }
        Returns: {
          bloco: string
          categoria: string
          dia: string
          valor: number
        }[]
      }
      fluxo_caixa_diario_orcado_consolidado: {
        Args: { _data_fim: string; _data_ini: string }
        Returns: {
          bloco: string
          categoria: string
          dia: string
          valor: number
        }[]
      }
      fn_gerar_cronograma_provisorio: {
        Args: { p_contrato_id: string; p_meses?: number }
        Returns: number
      }
      fn_promover_contratos_mz50: {
        Args: { meses_default?: number }
        Returns: {
          contratos_existentes: number
          contratos_inseridos: number
          sem_empresa: number
        }[]
      }
      gerar_codigo_cc: {
        Args: {
          _empresa_id: string
          _origem: Database["public"]["Enums"]["cc_origem"]
          _tipo: Database["public"]["Enums"]["cc_tipo"]
        }
        Returns: string
      }
      gerar_lancamento_contabil: {
        Args: {
          p_centro_custo_id?: string
          p_codigo_evento: string
          p_conta_banco_id?: string
          p_conta_credito_id?: string
          p_conta_debito_id?: string
          p_data: string
          p_empresa_id: string
          p_historico: string
          p_origem_id?: string
          p_origem_tipo?: string
          p_valor: number
        }
        Returns: string
      }
      gerar_orcamento_contrato: {
        Args: { _ciclo_id: string; _contrato_id: string }
        Returns: Json
      }
      get_user_empresa: { Args: { _user_id: string }; Returns: string }
      has_permissao: {
        Args: { _acao: string; _menu: string; _modulo: string; _user: string }
        Returns: boolean
      }
      has_permission: {
        Args: {
          _acao: Database["public"]["Enums"]["app_acao"]
          _modulo: string
          _user_id: string
        }
        Returns: boolean
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      has_screen_access: {
        Args: {
          _acao: Database["public"]["Enums"]["app_acao"]
          _empresa?: string
          _menu: string
          _user: string
        }
        Returns: boolean
      }
      integration_approve_batch: {
        Args: { p_batch_id: string }
        Returns: undefined
      }
      integration_materialize_staging: {
        Args: { p_batch_file_id: string; p_rows: Json }
        Returns: Json
      }
      integration_promote_batch: { Args: { p_batch_id: string }; Returns: Json }
      integration_reject_batch: {
        Args: { p_batch_id: string; p_motivo?: string }
        Returns: undefined
      }
      integration_resolve_alias: {
        Args: {
          p_alias: string
          p_empresa_id: string
          p_id_interno: string
          p_tipo: string
        }
        Returns: undefined
      }
      is_estrutura_admin: { Args: { _uid: string }; Returns: boolean }
      layout_aprovar_versao: { Args: { _versao_id: string }; Returns: Json }
      layout_nova_versao: { Args: { _layout_id: string }; Returns: Json }
      layout_rejeitar_versao: {
        Args: { _motivo: string; _versao_id: string }
        Returns: Json
      }
      layout_submeter_aprovacao: { Args: { _versao_id: string }; Returns: Json }
      lc_promover_partida_contabil: {
        Args: { _mz_id: number; _payload: Json }
        Returns: string
      }
      licitacao_assumir: { Args: { p_licitacao_id: string }; Returns: string }
      licitacao_importacao_anexar_linhas: {
        Args: { p_linhas: Json; p_lote: string }
        Returns: Json
      }
      licitacao_importacao_cancelar: {
        Args: { p_lote: string }
        Returns: undefined
      }
      licitacao_importacao_confirmar: {
        Args: { p_lote: string }
        Returns: Json
      }
      licitacao_importacao_criar_lote: {
        Args: {
          p_arquivo_hash: string
          p_arquivo_nome: string
          p_empresa: string
        }
        Returns: string
      }
      licitacao_transferir: {
        Args: {
          p_justificativa: string
          p_licitacao_id: string
          p_novo_user: string
        }
        Returns: string
      }
      list_accessible_menus: {
        Args: { _acao?: string; _empresa?: string; _user: string }
        Returns: {
          menu_codigo: string
        }[]
      }
      list_usuarios_empresa: {
        Args: { _empresa_id: string }
        Returns: {
          display_name: string
          email: string
          id: string
        }[]
      }
      malote_adicionar_titulo: {
        Args: { _malote_id: string; _titulo_id: string }
        Returns: undefined
      }
      malote_criar: {
        Args: {
          _conta_bancaria_id: string
          _data_pagamento: string
          _descricao?: string
          _empresa_id: string
        }
        Returns: string
      }
      malote_executar: { Args: { _malote_id: string }; Returns: Json }
      malote_remover_titulo: {
        Args: { _malote_id: string; _titulo_id: string }
        Returns: undefined
      }
      mz_32_diagnosticar_razao: { Args: { p_batch_id: string }; Returns: Json }
      mz_32_promover_razao: {
        Args: { p_batch_id: string; p_limit_mestres?: number; p_sigla?: string }
        Returns: Json
      }
      mz_parse_num: { Args: { p: string }; Returns: number }
      nf_gerar_titulos: { Args: { _nf_id: string }; Returns: Json }
      nf_lancar_estoque: { Args: { _nf_id: string }; Returns: Json }
      normaliza_alias_banco: { Args: { _in: string }; Returns: string }
      nota_fiscal_autorizar: {
        Args: {
          _link_pdf?: string
          _link_xml?: string
          _nf_id: string
          _protocolo?: string
        }
        Returns: undefined
      }
      nota_fiscal_cancelar: {
        Args: { _motivo: string; _nf_id: string }
        Returns: undefined
      }
      nota_fiscal_emitir: {
        Args: {
          _codigo_servico?: string
          _contrato_id?: string
          _discriminacao?: string
          _empresa_id: string
          _origem: Database["public"]["Enums"]["nfsai_origem"]
          _tipo: Database["public"]["Enums"]["nfsai_tipo"]
          _titulo_receber_id?: string
          _tomador_documento: string
          _tomador_email?: string
          _tomador_nome: string
          _valor_produtos?: number
          _valor_servicos?: number
        }
        Returns: string
      }
      obz_valor_upsert: {
        Args: {
          _centro_custo_id: string
          _dre_linha_id: string
          _memoria?: string
          _mes: number
          _valor: number
          _versao_id: string
        }
        Returns: string
      }
      obz_versao_aprovar: { Args: { _id: string }; Returns: undefined }
      obz_versao_arquivar: { Args: { _id: string }; Returns: undefined }
      obz_versao_criar: {
        Args: {
          _ano: number
          _descricao?: string
          _empresa_id: string
          _nome?: string
        }
        Returns: string
      }
      obz_versao_submeter: { Args: { _id: string }; Returns: undefined }
      oc_promover_orcamento_linha: {
        Args: { _mz_id: number; _payload: Json }
        Returns: string
      }
      orcamento_copiar_ano: {
        Args: {
          p_ano_destino: number
          p_ano_origem: number
          p_empresa_id: string
          p_nome_ciclo?: string
          p_reajuste_pct?: number
        }
        Returns: string
      }
      orcamento_criar_ciclo: {
        Args: { p_ano: number; p_empresa_id: string; p_nome: string }
        Returns: string
      }
      parse_mz40_valor: { Args: { _in: string }; Returns: number }
      plano_acao_can_access: {
        Args: { p_empresa_id: string; p_permission: string; p_user_id: string }
        Returns: boolean
      }
      plano_acao_seed_inicial: {
        Args: { _empresa: string; _payload: Json }
        Returns: Json
      }
      plano_acao_visible_by_user: {
        Args: { _plano_id: string; _user: string }
        Returns: boolean
      }
      pode_alterar_empresa_cc: { Args: { _cc_id: string }; Returns: string }
      pode_usar_copiloto: { Args: { _uid: string }; Returns: boolean }
      pre_titulo_aprovar: { Args: { _id: string }; Returns: undefined }
      pre_titulo_promover: { Args: { _id: string }; Returns: string }
      pre_titulo_rejeitar: {
        Args: { _id: string; _motivo: string }
        Returns: undefined
      }
      pre_titulo_submeter: { Args: { _id: string }; Returns: undefined }
      pres_caixa_status: {
        Args: never
        Returns: {
          eh_hagg: boolean
          empresa_codigo: string
          empresa_id: string
          entradas: number
          mov_com_alias: number
          mov_sem_match: number
          pend_aplicacao: number
          pend_convenio: number
          pend_meio_pagamento: number
          pend_outra_empresa: number
          pend_revisar_humano: number
          qtd_valores_invalidos: number
          saidas: number
          saldo_inicial: number
          saldo_liquido: number
          status_confiabilidade: string
        }[]
      }
      programacao_decidir: {
        Args: {
          p_decisao: Database["public"]["Enums"]["aprov_decisao"]
          p_justificativa?: string
          p_programacao_id: string
        }
        Returns: undefined
      }
      programacao_reabrir: {
        Args: { p_motivo: string; p_programacao_id: string }
        Returns: undefined
      }
      programacao_submeter_aprovacao: {
        Args: { p_programacao_id: string }
        Returns: string
      }
      promover_contas_aprovadas: {
        Args: { _empresa_id: string }
        Returns: Json
      }
      promover_mz50_orcamento: {
        Args: { _ano: number; _empresa_id: string }
        Returns: {
          criadas_linhas: number
          criados_contratos: number
        }[]
      }
      proximo_numero_lancamento: {
        Args: { _empresa_id: string }
        Returns: string
      }
      razao_contabil: {
        Args: {
          _conta_id: string
          _data_fim: string
          _data_ini: string
          _empresa_id: string
        }
        Returns: {
          contrapartida: string
          credito: number
          data_lancamento: string
          dc: string
          debito: number
          historico: string
          numero: string
          saldo: number
        }[]
      }
      razao_saldo_anterior: {
        Args: {
          _cc_id?: string
          _classif_ate?: string
          _classif_de?: string
          _classificacao_prefix?: string
          _conta_id?: string
          _contrato_id?: string
          _data_ini: string
          _empresa_id: string
          _grupo_dre?: string
          _natureza?: string
          _origem?: string
        }
        Returns: {
          saldo: number
          total_credito: number
          total_debito: number
        }[]
      }
      razao_unificado_listar: {
        Args: {
          _busca?: string
          _cc_id?: string
          _classif_ate?: string
          _classif_de?: string
          _classificacao_prefix?: string
          _conta_id?: string
          _contrato_id?: string
          _data_fim: string
          _data_ini: string
          _empresa_id: string
          _grupo_dre?: string
          _limit?: number
          _natureza?: string
          _offset?: number
          _origem?: string
        }
        Returns: {
          cc_codigo: string
          cc_nome: string
          conta_classif: string
          conta_desc: string
          conta_grupo: string
          conta_natureza: string
          contrato_num: string
          credito: number
          data_lcto: string
          debito: number
          documento: string
          historico: string
          lcto_numero: string
          origem: string
          total_count: number
        }[]
      }
      recebimento_confirmar: {
        Args: { _recebimento_id: string }
        Returns: Json
      }
      regua_agendar_etapas: {
        Args: { _regua_id?: string; _titulo_id: string }
        Returns: Json
      }
      resolver_dre_linha: {
        Args: { _classif: string; _conta_codigo: string }
        Returns: string
      }
      storage_path_empresa: { Args: { _name: string }; Returns: string }
      sup_aprov_abrir_instancia: {
        Args: {
          _centro_custo_id: string
          _fluxo_id: string
          _referencia_codigo: string
          _referencia_id: string
          _solicitante: string
          _valor: number
        }
        Returns: string
      }
      sup_aprov_avancar: { Args: { _instancia_id: string }; Returns: undefined }
      sup_aprov_fluxo_padrao: {
        Args: {
          _alvo: Database["public"]["Enums"]["sup_aprov_alvo"]
          _empresa_id: string
        }
        Returns: string
      }
      sup_aprov_pendentes_do_usuario: {
        Args: { _uid?: string }
        Returns: {
          aberta_em: string
          alvo: Database["public"]["Enums"]["sup_aprov_alvo"]
          criticidade: Database["public"]["Enums"]["sup_aprov_criticidade"]
          empresa_id: string
          etapa_id: string
          etapa_nome: string
          horas_paradas: number
          instancia_id: string
          prazo_horas: number
          referencia_codigo: string
          tipo_parecer: Database["public"]["Enums"]["sup_aprov_tipo_parecer"]
          valor: number
        }[]
      }
      sup_aprov_registrar_voto: {
        Args: {
          _etapa_id: string
          _instancia_id: string
          _justificativa: string
          _parecer: Database["public"]["Enums"]["sup_aprov_parecer"]
        }
        Returns: undefined
      }
      sup_aprov_responsavel_efetivo: {
        Args: { _etapa_id: string }
        Returns: string
      }
      sup_aprov_tem_orcamento_cc: {
        Args: { _cc_id: string; _periodo?: string; _valor: number }
        Returns: boolean
      }
      sup_aprov_vincula_orcamento: {
        Args: { _centro_custo_id: string; _empresa_id: string }
        Returns: boolean
      }
      tem_permissao_especial: {
        Args: { _permissao: string; _user_id: string }
        Returns: boolean
      }
      titulo_agendar: {
        Args: {
          _conta_bancaria_id: string
          _data_pgto: string
          _forma?: Database["public"]["Enums"]["forma_pagamento"]
          _titulo_id: string
        }
        Returns: Json
      }
      titulo_baixar: {
        Args: {
          _conta_bancaria_id?: string
          _data_baixa?: string
          _desconto?: number
          _juros?: number
          _meio?: Database["public"]["Enums"]["titulo_receber_meio"]
          _multa?: number
          _observacoes?: string
          _titulo_id: string
          _valor: number
        }
        Returns: Json
      }
      titulo_pagar_baixar: {
        Args: {
          _conta_bancaria_id?: string
          _data_baixa?: string
          _desconto?: number
          _juros?: number
          _multa?: number
          _observacoes?: string
          _titulo_id: string
          _valor: number
        }
        Returns: Json
      }
      titulo_receber_marcar_vencidos: { Args: never; Returns: number }
      tp_promover_titulo_pagar: {
        Args: { _mz_id: number; _payload: Json }
        Returns: string
      }
      tr_promover_titulo_receber: {
        Args: { _mz_id: number; _payload: Json }
        Returns: string
      }
      unaccent_safe: { Args: { t: string }; Returns: string }
      user_can_see_empresa: { Args: { _empresa_id: string }; Returns: boolean }
      user_pode_atuar_empresa: {
        Args: { _empresa: string; _user: string }
        Returns: boolean
      }
      validacao_enviar_conciliacao: {
        Args: { p_titulo_pagar_id: string }
        Returns: undefined
      }
      validacao_registrar: {
        Args: {
          p_divergencia?: string
          p_status: Database["public"]["Enums"]["validacao_status"]
          p_titulo_pagar_id: string
          p_tratativa?: string
        }
        Returns: string
      }
    }
    Enums: {
      almox_tipo: "matriz" | "deposito" | "obra" | "veiculo" | "outro"
      app_acao:
        | "visualizar"
        | "incluir"
        | "alterar"
        | "excluir"
        | "aprovar"
        | "exportar"
        | "executar_ia"
        | "alterar_dre"
        | "responder"
      app_role:
        | "admin"
        | "controladoria"
        | "comercial"
        | "operacional"
        | "juridico"
        | "sst"
        | "diretor_adm"
        | "diretor_op"
        | "visitante"
        | "comprador"
        | "almoxarife"
        | "gestor_cc"
        | "fiscal_recebedor"
        | "financeiro"
        | "fiscal"
        | "presidencia"
        | "usuario"
        | "rh"
        | "sistemas"
        | "treinamentos"
      aprov_decisao: "pendente" | "aprovado" | "rejeitado" | "devolvido"
      apuracao_status: "aberta" | "calculada" | "fechada" | "pago" | "atrasado"
      banco_layout_tipo:
        | "cnab240_remessa_pagamento"
        | "cnab240_retorno"
        | "cnab400_remessa"
        | "cnab400_retorno"
        | "api_rest_pagamento"
        | "api_rest_consulta"
        | "ofx_extrato"
        | "csv_extrato"
      banco_layout_versao_status:
        | "rascunho"
        | "pendente_aprovacao"
        | "aprovada"
        | "rejeitada"
        | "arquivada"
      banco_tipo: "corrente" | "poupanca" | "aplicacao" | "vinculada"
      bdi_aprovacao_acao:
        | "submeter"
        | "aprovar"
        | "reprovar"
        | "congelar"
        | "cancelar"
      bdi_item_grupo:
        | "posto"
        | "encargo"
        | "beneficio"
        | "insumo"
        | "imposto"
        | "margem"
        | "outro"
      bdi_item_tipo: "moeda" | "percent" | "numero" | "texto"
      bdi_status:
        | "rascunho"
        | "em_revisao"
        | "aprovado"
        | "congelado"
        | "substituido"
        | "cancelado"
      cc_origem: "manual" | "contrato" | "licitacao" | "rateio" | "corporativo"
      cc_tipo: "adm" | "operacional" | "socios"
      cobranca_registro_status:
        | "pendente"
        | "enviado"
        | "registrado"
        | "rejeitado"
        | "baixado"
        | "liquidado"
        | "cancelado"
      colab_status: "ativo" | "afastado" | "demitido" | "ferias"
      comprovacao_tipo:
        | "empenho"
        | "ordem_servico"
        | "aditivo"
        | "apostilamento"
        | "nota_fiscal"
        | "contrato_assinado"
        | "publicacao_doe"
        | "outro"
      conta_exige_contrato: "sim" | "nao" | "opcional"
      conta_grupo_dre: "balanco" | "balanco_gerencial" | "dre"
      conta_natureza: "D" | "C"
      conta_tipo: "sintetica" | "analitica"
      contrato_status: "implantacao" | "ativo" | "suspenso" | "encerrado"
      cotacao_fornecedor_status:
        | "convidado"
        | "respondeu"
        | "recusou"
        | "vencedor"
        | "perdedor"
      cotacao_status:
        | "rascunho"
        | "aberta"
        | "em_analise"
        | "fechada"
        | "cancelada"
      cronograma_status:
        | "previsto"
        | "emitido"
        | "recebido"
        | "atrasado"
        | "cancelado"
      desbloqueio_status: "pendente" | "aprovado" | "rejeitado"
      dissidio_base_calculo: "salario_base" | "total_remuneracao" | "posto"
      dissidio_criterio:
        | "indice"
        | "percentual_fixo"
        | "cct"
        | "acordo_coletivo"
        | "judicial"
      dre_natureza:
        | "receita"
        | "deducao"
        | "custo"
        | "despesa"
        | "resultado"
        | "tributo"
        | "financeiro"
      estoque_mov_origem:
        | "nf_entrada"
        | "rc"
        | "pedido_compra"
        | "ajuste_manual"
        | "transferencia"
        | "inventario"
        | "devolucao"
      estoque_mov_tipo:
        | "entrada"
        | "saida"
        | "transferencia"
        | "ajuste"
        | "reserva"
        | "liberacao_reserva"
        | "consumo"
      extrato_status_conciliacao:
        | "pendente"
        | "sugerido"
        | "conciliado"
        | "ignorado"
        | "divergente"
      extrato_tipo: "credito" | "debito"
      fluxo_tipo: "entrada" | "saida"
      forma_pagamento:
        | "boleto"
        | "ted"
        | "pix"
        | "transferencia"
        | "dinheiro"
        | "cheque"
        | "debito_automatico"
      fornecedor_tipo: "pj" | "pf"
      ia_status: "pendente" | "processando" | "concluida" | "erro" | "cancelada"
      imposto_tipo:
        | "iss"
        | "pis"
        | "cofins"
        | "irpj"
        | "csll"
        | "das"
        | "inss"
        | "irrf"
      integ_alias_status: "pendente" | "sugerido" | "aprovado" | "rejeitado"
      integ_batch_status:
        | "rascunho"
        | "aguardando_validacao"
        | "validando"
        | "com_erros"
        | "pronto_para_carga"
        | "aprovado"
        | "carregando"
        | "carregado"
        | "rejeitado"
        | "reprocessando"
        | "arquivado"
        | "processando"
        | "validado_ok"
        | "validado_com_erros"
      integ_load_status:
        | "pendente"
        | "em_execucao"
        | "concluido"
        | "falhou"
        | "revertido"
      integ_validation_severity: "bloqueante" | "alerta" | "informativo"
      integracao_ambiente: "sandbox" | "producao"
      integracao_bancaria_tipo:
        | "manual"
        | "api_rest"
        | "open_finance"
        | "cnab_arquivo"
      integracao_status:
        | "nao_configurado"
        | "configurado"
        | "ativo"
        | "erro"
        | "pausado"
      lanc_status: "rascunho" | "efetivado" | "estornado"
      licitacao_status:
        | "rascunho"
        | "oportunidade"
        | "em_andamento"
        | "vencida"
        | "perdida"
        | "cancelada"
      lote_origem: "manual" | "erp" | "extrato_bancario" | "planilha" | "api"
      lote_status: "pendente" | "processado" | "erro" | "cancelado"
      malote_status:
        | "rascunho"
        | "enviado"
        | "executado"
        | "cancelado"
        | "aprovado"
      mov_banco_tipo: "debito" | "credito"
      nf_item_status: "ok" | "pendente_revisao" | "produto_novo" | "divergencia"
      nf_origem: "xml" | "manual"
      nf_origem_destino: "estoque" | "contrato" | "consumo_imediato"
      nf_status:
        | "importada"
        | "validada"
        | "lancada_estoque"
        | "cancelada"
        | "rejeitada"
      nfsai_ambiente: "homologacao" | "producao"
      nfsai_origem: "titulo" | "medicao" | "avulsa" | "manual"
      nfsai_status:
        | "rascunho"
        | "emitida"
        | "autorizada"
        | "cancelada"
        | "rejeitada"
        | "denegada"
      nfsai_tipo: "nfse" | "nfe" | "nfce"
      nfse_status:
        | "rascunho"
        | "emitida"
        | "cancelada"
        | "rejeitada"
        | "substituida"
      obz_status: "rascunho" | "em_aprovacao" | "aprovada" | "arquivada"
      orcamento_ciclo_status:
        | "aberto"
        | "em_aprovacao"
        | "aprovado"
        | "encerrado"
      orcamento_contrato_status:
        | "rascunho"
        | "em_aprovacao"
        | "aprovado"
        | "rejeitado"
        | "encerrado"
      orcamento_linha_origem: "contrato" | "manual"
      orcamento_linha_source:
        | "licitacao"
        | "obz"
        | "manual"
        | "recorrente"
        | "dissidio"
        | "calculado"
      partida_dc: "D" | "C"
      pcs_status: "pendente" | "aprovada" | "rejeitada" | "aplicada" | "erro"
      pcs_tipo: "criar" | "alterar" | "inativar"
      pedido_compra_status:
        | "rascunho"
        | "aguardando_aprovacao"
        | "aprovado"
        | "enviado"
        | "recebido_parcial"
        | "recebido"
        | "cancelado"
      periodo_status: "aberto" | "fechado"
      pix_cobranca_status: "ativa" | "concluida" | "removida" | "expirada"
      posto_jornada:
        | "12x36"
        | "8h"
        | "6h"
        | "4h"
        | "escala_5x2"
        | "escala_6x1"
        | "outra"
      pre_titulo_status:
        | "rascunho"
        | "em_aprovacao"
        | "aprovado"
        | "rejeitado"
        | "promovido"
        | "cancelado"
      prod_serv_tipo: "produto" | "servico"
      produto_metodo_custeio: "compra" | "medio"
      programacao_aprovacao_status:
        | "nao_submetida"
        | "pendente"
        | "aprovada"
        | "reprovada"
        | "devolvida"
      programacao_prioridade: "baixa" | "normal" | "alta" | "emergencial"
      rc_destino: "estoque" | "contrato"
      rc_prioridade: "baixa" | "normal" | "alta" | "urgente"
      rc_status_v2:
        | "rascunho"
        | "enviada"
        | "em_validacao_estoque"
        | "parcialmente_atendida_por_estoque"
        | "aguardando_budget"
        | "bloqueada_sem_budget"
        | "aguardando_aprovacao"
        | "aprovada"
        | "em_compras"
        | "pedido_gerado"
        | "parcialmente_atendida"
        | "atendida_total"
        | "cancelada"
        | "rejeitada"
      rc_tipo: "material" | "servico" | "custo_direto" | "administrativo"
      recebimento_item_condicao:
        | "ok"
        | "avariado"
        | "trocado"
        | "faltante"
        | "excedente"
      recebimento_ocorrencia_status:
        | "aberta"
        | "em_tratativa"
        | "resolvida"
        | "cancelada"
      recebimento_ocorrencia_tipo:
        | "quantidade"
        | "qualidade"
        | "produto_trocado"
        | "documento"
        | "outro"
      recebimento_status:
        | "aguardando"
        | "em_conferencia"
        | "recebido"
        | "recebido_com_ocorrencia"
        | "cancelado"
      regime_tributario: "lucro_real" | "lucro_presumido" | "simples_nacional"
      regra_evento:
        | "nf_servico_autorizada"
        | "nf_produto_autorizada"
        | "baixa_receber"
        | "baixa_pagar"
        | "impostos_faturamento"
        | "provisao_folha"
        | "manual"
        | "nf_entrada_estoque"
        | "nf_entrada_consumo_contrato"
        | "nf_entrada_servico_admin"
        | "pagamento_folha"
        | "recolhimento_encargos_folha"
        | "mutuo_intercompany_saida"
        | "mutuo_intercompany_entrada"
        | "rateio_admin_intercompany"
        | "baixa_estoque_contrato"
        | "provisao_irpj_csll"
        | "provisao_ferias_13"
        | "retencao_faturamento"
        | "imposto_recuperavel"
        | "imposto_nao_recuperavel"
      regua_canal:
        | "email"
        | "whatsapp"
        | "sms"
        | "ligacao"
        | "protesto"
        | "serasa"
        | "negativacao"
        | "interno"
      regua_etapa_status:
        | "pendente"
        | "executada"
        | "falhou"
        | "cancelada"
        | "reagendada"
      remessa_metodo_envio: "download_manual" | "api" | "ftp" | "sftp"
      remessa_status:
        | "gerada"
        | "enviada"
        | "processada"
        | "rejeitada"
        | "cancelada"
      req_compra_status:
        | "rascunho"
        | "enviada"
        | "aprovada"
        | "rejeitada"
        | "pedido_emitido"
        | "cancelada"
      retorno_formato: "cnab240" | "cnab400" | "ofx" | "csv" | "api_json"
      retorno_status:
        | "recebido"
        | "processando"
        | "processado"
        | "erro"
        | "parcial"
      sup_aprov_alvo:
        | "requisicao_compra"
        | "licitacao_etapa"
        | "programacao_pagamento"
        | "pedido_compra"
      sup_aprov_criticidade: "normal" | "urgente" | "critico"
      sup_aprov_parecer: "aprovado" | "reprovado" | "ciencia"
      sup_aprov_status:
        | "pendente"
        | "aprovado"
        | "reprovado"
        | "auto_aprovado"
        | "cancelado"
      sup_aprov_tipo_parecer: "bloqueante" | "consultivo" | "ciencia"
      template_tipo: "email" | "whatsapp" | "sms" | "interno"
      titulo_receber_meio:
        | "boleto"
        | "pix"
        | "ted"
        | "dinheiro"
        | "deposito"
        | "cartao"
        | "outro"
      titulo_remessa_status: "nao_enviado" | "enviado" | "pago" | "rejeitado"
      titulo_status:
        | "aberto"
        | "parcial"
        | "pago"
        | "cancelado"
        | "vencido"
        | "agendado"
      validacao_status:
        | "pendente"
        | "conferido"
        | "divergente"
        | "pendente_comprovante"
        | "pendente_baixa"
        | "pendente_conciliacao"
        | "conciliado"
        | "arquivado"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      almox_tipo: ["matriz", "deposito", "obra", "veiculo", "outro"],
      app_acao: [
        "visualizar",
        "incluir",
        "alterar",
        "excluir",
        "aprovar",
        "exportar",
        "executar_ia",
        "alterar_dre",
        "responder",
      ],
      app_role: [
        "admin",
        "controladoria",
        "comercial",
        "operacional",
        "juridico",
        "sst",
        "diretor_adm",
        "diretor_op",
        "visitante",
        "comprador",
        "almoxarife",
        "gestor_cc",
        "fiscal_recebedor",
        "financeiro",
        "fiscal",
        "presidencia",
        "usuario",
      ],
      aprov_decisao: ["pendente", "aprovado", "rejeitado", "devolvido"],
      apuracao_status: ["aberta", "calculada", "fechada", "pago", "atrasado"],
      banco_layout_tipo: [
        "cnab240_remessa_pagamento",
        "cnab240_retorno",
        "cnab400_remessa",
        "cnab400_retorno",
        "api_rest_pagamento",
        "api_rest_consulta",
        "ofx_extrato",
        "csv_extrato",
      ],
      banco_layout_versao_status: [
        "rascunho",
        "pendente_aprovacao",
        "aprovada",
        "rejeitada",
        "arquivada",
      ],
      banco_tipo: ["corrente", "poupanca", "aplicacao", "vinculada"],
      bdi_aprovacao_acao: [
        "submeter",
        "aprovar",
        "reprovar",
        "congelar",
        "cancelar",
      ],
      bdi_item_grupo: [
        "posto",
        "encargo",
        "beneficio",
        "insumo",
        "imposto",
        "margem",
        "outro",
      ],
      bdi_item_tipo: ["moeda", "percent", "numero", "texto"],
      bdi_status: [
        "rascunho",
        "em_revisao",
        "aprovado",
        "congelado",
        "substituido",
        "cancelado",
      ],
      cc_origem: ["manual", "contrato", "licitacao", "rateio", "corporativo"],
      cc_tipo: ["adm", "operacional", "socios"],
      cobranca_registro_status: [
        "pendente",
        "enviado",
        "registrado",
        "rejeitado",
        "baixado",
        "liquidado",
        "cancelado",
      ],
      colab_status: ["ativo", "afastado", "demitido", "ferias"],
      comprovacao_tipo: [
        "empenho",
        "ordem_servico",
        "aditivo",
        "apostilamento",
        "nota_fiscal",
        "contrato_assinado",
        "publicacao_doe",
        "outro",
      ],
      conta_exige_contrato: ["sim", "nao", "opcional"],
      conta_grupo_dre: ["balanco", "balanco_gerencial", "dre"],
      conta_natureza: ["D", "C"],
      conta_tipo: ["sintetica", "analitica"],
      contrato_status: ["implantacao", "ativo", "suspenso", "encerrado"],
      cotacao_fornecedor_status: [
        "convidado",
        "respondeu",
        "recusou",
        "vencedor",
        "perdedor",
      ],
      cotacao_status: [
        "rascunho",
        "aberta",
        "em_analise",
        "fechada",
        "cancelada",
      ],
      cronograma_status: [
        "previsto",
        "emitido",
        "recebido",
        "atrasado",
        "cancelado",
      ],
      desbloqueio_status: ["pendente", "aprovado", "rejeitado"],
      dissidio_base_calculo: ["salario_base", "total_remuneracao", "posto"],
      dissidio_criterio: [
        "indice",
        "percentual_fixo",
        "cct",
        "acordo_coletivo",
        "judicial",
      ],
      dre_natureza: [
        "receita",
        "deducao",
        "custo",
        "despesa",
        "resultado",
        "tributo",
        "financeiro",
      ],
      estoque_mov_origem: [
        "nf_entrada",
        "rc",
        "pedido_compra",
        "ajuste_manual",
        "transferencia",
        "inventario",
        "devolucao",
      ],
      estoque_mov_tipo: [
        "entrada",
        "saida",
        "transferencia",
        "ajuste",
        "reserva",
        "liberacao_reserva",
        "consumo",
      ],
      extrato_status_conciliacao: [
        "pendente",
        "sugerido",
        "conciliado",
        "ignorado",
        "divergente",
      ],
      extrato_tipo: ["credito", "debito"],
      fluxo_tipo: ["entrada", "saida"],
      forma_pagamento: [
        "boleto",
        "ted",
        "pix",
        "transferencia",
        "dinheiro",
        "cheque",
        "debito_automatico",
      ],
      fornecedor_tipo: ["pj", "pf"],
      ia_status: ["pendente", "processando", "concluida", "erro", "cancelada"],
      imposto_tipo: [
        "iss",
        "pis",
        "cofins",
        "irpj",
        "csll",
        "das",
        "inss",
        "irrf",
      ],
      integ_alias_status: ["pendente", "sugerido", "aprovado", "rejeitado"],
      integ_batch_status: [
        "rascunho",
        "aguardando_validacao",
        "validando",
        "com_erros",
        "pronto_para_carga",
        "aprovado",
        "carregando",
        "carregado",
        "rejeitado",
        "reprocessando",
        "arquivado",
        "processando",
        "validado_ok",
        "validado_com_erros",
      ],
      integ_load_status: [
        "pendente",
        "em_execucao",
        "concluido",
        "falhou",
        "revertido",
      ],
      integ_validation_severity: ["bloqueante", "alerta", "informativo"],
      integracao_ambiente: ["sandbox", "producao"],
      integracao_bancaria_tipo: [
        "manual",
        "api_rest",
        "open_finance",
        "cnab_arquivo",
      ],
      integracao_status: [
        "nao_configurado",
        "configurado",
        "ativo",
        "erro",
        "pausado",
      ],
      lanc_status: ["rascunho", "efetivado", "estornado"],
      licitacao_status: [
        "rascunho",
        "oportunidade",
        "em_andamento",
        "vencida",
        "perdida",
        "cancelada",
      ],
      lote_origem: ["manual", "erp", "extrato_bancario", "planilha", "api"],
      lote_status: ["pendente", "processado", "erro", "cancelado"],
      malote_status: [
        "rascunho",
        "enviado",
        "executado",
        "cancelado",
        "aprovado",
      ],
      mov_banco_tipo: ["debito", "credito"],
      nf_item_status: ["ok", "pendente_revisao", "produto_novo", "divergencia"],
      nf_origem: ["xml", "manual"],
      nf_origem_destino: ["estoque", "contrato", "consumo_imediato"],
      nf_status: [
        "importada",
        "validada",
        "lancada_estoque",
        "cancelada",
        "rejeitada",
      ],
      nfsai_ambiente: ["homologacao", "producao"],
      nfsai_origem: ["titulo", "medicao", "avulsa", "manual"],
      nfsai_status: [
        "rascunho",
        "emitida",
        "autorizada",
        "cancelada",
        "rejeitada",
        "denegada",
      ],
      nfsai_tipo: ["nfse", "nfe", "nfce"],
      nfse_status: [
        "rascunho",
        "emitida",
        "cancelada",
        "rejeitada",
        "substituida",
      ],
      obz_status: ["rascunho", "em_aprovacao", "aprovada", "arquivada"],
      orcamento_ciclo_status: [
        "aberto",
        "em_aprovacao",
        "aprovado",
        "encerrado",
      ],
      orcamento_contrato_status: [
        "rascunho",
        "em_aprovacao",
        "aprovado",
        "rejeitado",
        "encerrado",
      ],
      orcamento_linha_origem: ["contrato", "manual"],
      orcamento_linha_source: [
        "licitacao",
        "obz",
        "manual",
        "recorrente",
        "dissidio",
        "calculado",
      ],
      partida_dc: ["D", "C"],
      pcs_status: ["pendente", "aprovada", "rejeitada", "aplicada", "erro"],
      pcs_tipo: ["criar", "alterar", "inativar"],
      pedido_compra_status: [
        "rascunho",
        "aguardando_aprovacao",
        "aprovado",
        "enviado",
        "recebido_parcial",
        "recebido",
        "cancelado",
      ],
      periodo_status: ["aberto", "fechado"],
      pix_cobranca_status: ["ativa", "concluida", "removida", "expirada"],
      posto_jornada: [
        "12x36",
        "8h",
        "6h",
        "4h",
        "escala_5x2",
        "escala_6x1",
        "outra",
      ],
      pre_titulo_status: [
        "rascunho",
        "em_aprovacao",
        "aprovado",
        "rejeitado",
        "promovido",
        "cancelado",
      ],
      prod_serv_tipo: ["produto", "servico"],
      produto_metodo_custeio: ["compra", "medio"],
      programacao_aprovacao_status: [
        "nao_submetida",
        "pendente",
        "aprovada",
        "reprovada",
        "devolvida",
      ],
      programacao_prioridade: ["baixa", "normal", "alta", "emergencial"],
      rc_destino: ["estoque", "contrato"],
      rc_prioridade: ["baixa", "normal", "alta", "urgente"],
      rc_status_v2: [
        "rascunho",
        "enviada",
        "em_validacao_estoque",
        "parcialmente_atendida_por_estoque",
        "aguardando_budget",
        "bloqueada_sem_budget",
        "aguardando_aprovacao",
        "aprovada",
        "em_compras",
        "pedido_gerado",
        "parcialmente_atendida",
        "atendida_total",
        "cancelada",
        "rejeitada",
      ],
      rc_tipo: ["material", "servico", "custo_direto", "administrativo"],
      recebimento_item_condicao: [
        "ok",
        "avariado",
        "trocado",
        "faltante",
        "excedente",
      ],
      recebimento_ocorrencia_status: [
        "aberta",
        "em_tratativa",
        "resolvida",
        "cancelada",
      ],
      recebimento_ocorrencia_tipo: [
        "quantidade",
        "qualidade",
        "produto_trocado",
        "documento",
        "outro",
      ],
      recebimento_status: [
        "aguardando",
        "em_conferencia",
        "recebido",
        "recebido_com_ocorrencia",
        "cancelado",
      ],
      regime_tributario: ["lucro_real", "lucro_presumido", "simples_nacional"],
      regra_evento: [
        "nf_servico_autorizada",
        "nf_produto_autorizada",
        "baixa_receber",
        "baixa_pagar",
        "impostos_faturamento",
        "provisao_folha",
        "manual",
        "nf_entrada_estoque",
        "nf_entrada_consumo_contrato",
        "nf_entrada_servico_admin",
        "pagamento_folha",
        "recolhimento_encargos_folha",
        "mutuo_intercompany_saida",
        "mutuo_intercompany_entrada",
        "rateio_admin_intercompany",
        "baixa_estoque_contrato",
        "provisao_irpj_csll",
        "provisao_ferias_13",
        "retencao_faturamento",
        "imposto_recuperavel",
        "imposto_nao_recuperavel",
      ],
      regua_canal: [
        "email",
        "whatsapp",
        "sms",
        "ligacao",
        "protesto",
        "serasa",
        "negativacao",
        "interno",
      ],
      regua_etapa_status: [
        "pendente",
        "executada",
        "falhou",
        "cancelada",
        "reagendada",
      ],
      remessa_metodo_envio: ["download_manual", "api", "ftp", "sftp"],
      remessa_status: [
        "gerada",
        "enviada",
        "processada",
        "rejeitada",
        "cancelada",
      ],
      req_compra_status: [
        "rascunho",
        "enviada",
        "aprovada",
        "rejeitada",
        "pedido_emitido",
        "cancelada",
      ],
      retorno_formato: ["cnab240", "cnab400", "ofx", "csv", "api_json"],
      retorno_status: [
        "recebido",
        "processando",
        "processado",
        "erro",
        "parcial",
      ],
      sup_aprov_alvo: [
        "requisicao_compra",
        "licitacao_etapa",
        "programacao_pagamento",
        "pedido_compra",
      ],
      sup_aprov_criticidade: ["normal", "urgente", "critico"],
      sup_aprov_parecer: ["aprovado", "reprovado", "ciencia"],
      sup_aprov_status: [
        "pendente",
        "aprovado",
        "reprovado",
        "auto_aprovado",
        "cancelado",
      ],
      sup_aprov_tipo_parecer: ["bloqueante", "consultivo", "ciencia"],
      template_tipo: ["email", "whatsapp", "sms", "interno"],
      titulo_receber_meio: [
        "boleto",
        "pix",
        "ted",
        "dinheiro",
        "deposito",
        "cartao",
        "outro",
      ],
      titulo_remessa_status: ["nao_enviado", "enviado", "pago", "rejeitado"],
      titulo_status: [
        "aberto",
        "parcial",
        "pago",
        "cancelado",
        "vencido",
        "agendado",
      ],
      validacao_status: [
        "pendente",
        "conferido",
        "divergente",
        "pendente_comprovante",
        "pendente_baixa",
        "pendente_conciliacao",
        "conciliado",
        "arquivado",
      ],
    },
  },
} as const
