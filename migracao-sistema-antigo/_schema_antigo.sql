--
-- PostgreSQL database dump
--

\restrict nNc1DqRjXTfbGi2P8PWynloAdy2elDttsW4scsurz0gftlC0kod6ewtlcUTdQLI

-- Dumped from database version 16.13 (Debian 16.13-1.pgdg12+1)
-- Dumped by pg_dump version 18.4

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA public;


--
-- Name: adicionar_log_solicitacao(character varying, text, character varying); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.adicionar_log_solicitacao(p_solicitacao_id character varying, p_mensagem text, p_usuario character varying) RETURNS void
    LANGUAGE plpgsql
    AS $$
BEGIN
    UPDATE solicitacoes_vagas
    SET logs = logs || jsonb_build_object(
        'timestamp', CURRENT_TIMESTAMP,
        'mensagem', p_mensagem,
        'usuario', p_usuario
    )
    WHERE solicitacao_id = p_solicitacao_id;
END;
$$;


--
-- Name: atualizar_data_atualizacao(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.atualizar_data_atualizacao() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.data_atualizacao = NOW();
    RETURN NEW;
END;
$$;


--
-- Name: candidato_ja_aplicou(character varying, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.candidato_ja_aplicou(cpf_param character varying, vaga_id_param integer) RETURNS boolean
    LANGUAGE plpgsql
    AS $$
DECLARE
  resultado BOOLEAN;
BEGIN
  SELECT EXISTS(
    SELECT 1 
    FROM candidatos c
    INNER JOIN candidatos_vagas cv ON c.id = cv.candidato_id
    WHERE c.cpf = cpf_param AND cv.vaga_id = vaga_id_param
  ) INTO resultado;
  
  RETURN resultado;
END;
$$;


--
-- Name: get_taxa_conversao_vaga(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_taxa_conversao_vaga(vaga_id_param integer) RETURNS TABLE(total_candidatos bigint, em_processo bigint, aprovados bigint, contratados bigint, taxa_aprovacao numeric, taxa_contratacao numeric)
    LANGUAGE plpgsql
    AS $$
BEGIN
  RETURN QUERY
  SELECT 
    COUNT(*) as total_candidatos,
    COUNT(*) FILTER (WHERE status IN ('triagem', 'entrevista_agendada', 'entrevista_realizada')) as em_processo,
    COUNT(*) FILTER (WHERE status = 'aprovado') as aprovados,
    COUNT(*) FILTER (WHERE status = 'contratado') as contratados,
    ROUND(
      COUNT(*) FILTER (WHERE status = 'aprovado')::NUMERIC / 
      NULLIF(COUNT(*), 0) * 100, 
      2
    ) as taxa_aprovacao,
    ROUND(
      COUNT(*) FILTER (WHERE status = 'contratado')::NUMERIC / 
      NULLIF(COUNT(*), 0) * 100, 
      2
    ) as taxa_contratacao
  FROM candidatos_vagas
  WHERE vaga_id = vaga_id_param;
END;
$$;


--
-- Name: update_solicitacoes_vagas_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_solicitacoes_vagas_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$;


--
-- Name: update_updated_at_column(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_updated_at_column() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: alteracoes_catalogo_site_externo; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.alteracoes_catalogo_site_externo (
    id integer NOT NULL,
    lote_id character varying(100) NOT NULL,
    alteracao_id integer NOT NULL,
    tipo_entidade character varying(50) NOT NULL,
    tipo_acao character varying(50) NOT NULL,
    dados jsonb NOT NULL,
    descricao text NOT NULL,
    status character varying(20) DEFAULT 'PENDENTE'::character varying,
    data_criacao timestamp without time zone DEFAULT now(),
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now()
);


--
-- Name: alteracoes_catalogo_site_externo_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.alteracoes_catalogo_site_externo_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: alteracoes_catalogo_site_externo_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.alteracoes_catalogo_site_externo_id_seq OWNED BY public.alteracoes_catalogo_site_externo.id;


--
-- Name: bd_negativo; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bd_negativo (
    id integer NOT NULL,
    nome character varying(300) NOT NULL,
    cpf character varying(20),
    motivo text,
    solicitacao_id character varying(100),
    entrevista_id integer,
    data_inclusao timestamp without time zone DEFAULT now(),
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now()
);


--
-- Name: bd_negativo_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.bd_negativo_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: bd_negativo_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.bd_negativo_id_seq OWNED BY public.bd_negativo.id;


--
-- Name: candidatos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.candidatos (
    id integer NOT NULL,
    nome_completo character varying(200) NOT NULL,
    cpf character varying(14) NOT NULL,
    email character varying(200),
    telefone_whatsapp character varying(20) NOT NULL,
    telefone_fixo character varying(20),
    endereco_completo text,
    cidade character varying(100),
    estado character(2),
    cep character varying(10),
    arquivo_path character varying(500),
    arquivo_tipo character varying(50),
    arquivo_mime_type character varying(100),
    arquivo_tamanho_bytes bigint,
    origem character varying(50) DEFAULT 'whatsapp_chatbot'::character varying,
    origem_campanha character varying(100),
    status character varying(30) DEFAULT 'novo'::character varying,
    observacoes text,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    ultimo_contato timestamp without time zone
);


--
-- Name: TABLE candidatos; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.candidatos IS 'Informações dos candidatos cadastrados via chatbot WhatsApp';


--
-- Name: candidatos_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.candidatos_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: candidatos_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.candidatos_id_seq OWNED BY public.candidatos.id;


--
-- Name: candidatos_vagas; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.candidatos_vagas (
    id integer NOT NULL,
    candidato_id integer NOT NULL,
    vaga_id integer NOT NULL,
    status character varying(30) DEFAULT 'novo'::character varying,
    data_aplicacao timestamp without time zone DEFAULT now(),
    data_triagem timestamp without time zone,
    data_entrevista timestamp without time zone,
    data_resposta timestamp without time zone,
    nota_triagem numeric(3,1),
    nota_entrevista numeric(3,1),
    parecer_recrutador text,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now()
);


--
-- Name: TABLE candidatos_vagas; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.candidatos_vagas IS 'Relacionamento entre candidatos e vagas aplicadas';


--
-- Name: candidatos_vagas_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.candidatos_vagas_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: candidatos_vagas_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.candidatos_vagas_id_seq OWNED BY public.candidatos_vagas.id;


--
-- Name: compras_anexos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.compras_anexos (
    id integer NOT NULL,
    solicitacao_id integer NOT NULL,
    historico_id integer,
    nome_arquivo character varying(500) NOT NULL,
    caminho_arquivo character varying(1000) NOT NULL,
    tamanho_kb integer,
    tipo_mime character varying(200),
    enviado_por_cpf character varying(11),
    enviado_por_nome character varying(255) NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: compras_anexos_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.compras_anexos_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: compras_anexos_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.compras_anexos_id_seq OWNED BY public.compras_anexos.id;


--
-- Name: compras_historico; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.compras_historico (
    id integer NOT NULL,
    solicitacao_id integer NOT NULL,
    tipo character varying(30) NOT NULL,
    conteudo text,
    autor_cpf character varying(11),
    autor_nome character varying(255) NOT NULL,
    autor_setor character varying(100),
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: compras_historico_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.compras_historico_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: compras_historico_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.compras_historico_id_seq OWNED BY public.compras_historico.id;


--
-- Name: compras_solicitacoes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.compras_solicitacoes (
    id integer NOT NULL,
    numero integer NOT NULL,
    nome character varying(500) NOT NULL,
    motivo text,
    descricao text,
    tipo character varying(50) NOT NULL,
    classificacao character varying(200),
    empresa character varying(300),
    contrato character varying(300),
    valor_estimado numeric(12,2),
    valor_final numeric(12,2),
    status character varying(30) DEFAULT 'PENDENTE'::character varying NOT NULL,
    criado_por_cpf character varying(11),
    criado_por_nome character varying(255) NOT NULL,
    criado_por_setor character varying(100),
    aprovado_por_cpf character varying(11),
    aprovado_por_nome character varying(255),
    aprovado_em timestamp without time zone,
    justificativa_aprovacao text,
    cotado_por_cpf character varying(11),
    cotado_por_nome character varying(255),
    cotado_em timestamp without time zone,
    observacao_cotacao text,
    pago_por_cpf character varying(11),
    pago_por_nome character varying(255),
    pago_em timestamp without time zone,
    observacao_pagamento text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    dispensa_cotacao boolean DEFAULT false
);


--
-- Name: compras_solicitacoes_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.compras_solicitacoes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: compras_solicitacoes_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.compras_solicitacoes_id_seq OWNED BY public.compras_solicitacoes.id;


--
-- Name: compras_solicitacoes_numero_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.compras_solicitacoes_numero_seq
    START WITH 97
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: contratos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.contratos (
    id integer NOT NULL,
    numero_contrato character varying(50) NOT NULL,
    licitacao_id integer,
    fornecedor_id integer,
    objeto text NOT NULL,
    valor_inicial numeric(15,2) NOT NULL,
    valor_atual numeric(15,2) NOT NULL,
    data_assinatura date NOT NULL,
    data_inicio date NOT NULL,
    data_termino date NOT NULL,
    prazo_meses integer,
    vigencia_determinada boolean DEFAULT true,
    tipo_contrato character varying(50),
    modalidade_licitacao character varying(50),
    numero_processo_licitacao character varying(50),
    fiscal_contrato character varying(200),
    gestor_contrato character varying(200),
    status character varying(30) DEFAULT 'vigente'::character varying,
    observacoes text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: TABLE contratos; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.contratos IS 'Contratos firmados com fornecedores';


--
-- Name: COLUMN contratos.valor_atual; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.contratos.valor_atual IS 'Valor com aditivos aplicados';


--
-- Name: COLUMN contratos.status; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.contratos.status IS 'vigente, encerrado, suspenso, rescindido';


--
-- Name: contratos_aditivos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.contratos_aditivos (
    id integer NOT NULL,
    contrato_id integer,
    numero_aditivo character varying(50) NOT NULL,
    tipo_aditivo character varying(50) NOT NULL,
    descricao text,
    valor_aditivo numeric(15,2),
    nova_data_termino date,
    data_assinatura date,
    justificativa text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: TABLE contratos_aditivos; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.contratos_aditivos IS 'Aditivos contratuais (prazo, valor, escopo)';


--
-- Name: COLUMN contratos_aditivos.tipo_aditivo; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.contratos_aditivos.tipo_aditivo IS 'prazo, valor, escopo, misto';


--
-- Name: contratos_aditivos_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.contratos_aditivos_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: contratos_aditivos_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.contratos_aditivos_id_seq OWNED BY public.contratos_aditivos.id;


--
-- Name: contratos_anuais; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.contratos_anuais (
    id integer NOT NULL,
    empresa character varying(50),
    cidade character varying(100),
    contratos text,
    estado character varying(2),
    data_inicio date,
    data_fim date,
    valor_efetivo_faturado numeric(15,2),
    valor_por_colaborador numeric(15,2),
    custo_anual_insumos numeric(15,2),
    custo_ind_mensal numeric(15,2),
    lucro_mensal numeric(15,2),
    total_lucro_custo_mensal numeric(15,2),
    media_custo_lucro_func numeric(15,2),
    valor_global numeric(15,2),
    custo_ind_global numeric(15,2),
    valor_mensal_2024 numeric(15,2),
    valor_executado_2025 numeric(15,2),
    valor_mensal_2025_contratado numeric(15,2),
    lucro_global numeric(15,2),
    total_lucro_custo_global numeric(15,2),
    diferenca_mensal numeric(15,2),
    diferenca_ate_apostilamento numeric(15,2),
    quant_func_estip integer,
    quant_func_exec integer,
    quant_func_exec_real integer,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT contratos_anuais_empresa_check CHECK (((empresa)::text = ANY (ARRAY[('Hagg'::character varying)::text, ('NH'::character varying)::text, ('SN'::character varying)::text, ('CANA├â'::character varying)::text, ('Nascimento'::character varying)::text]))),
    CONSTRAINT contratos_anuais_estado_check CHECK (((estado)::text = ANY (ARRAY[('AC'::character varying)::text, ('AL'::character varying)::text, ('AP'::character varying)::text, ('AM'::character varying)::text, ('BA'::character varying)::text, ('CE'::character varying)::text, ('DF'::character varying)::text, ('ES'::character varying)::text, ('GO'::character varying)::text, ('MA'::character varying)::text, ('MT'::character varying)::text, ('MS'::character varying)::text, ('MG'::character varying)::text, ('PA'::character varying)::text, ('PB'::character varying)::text, ('PR'::character varying)::text, ('PE'::character varying)::text, ('PI'::character varying)::text, ('RJ'::character varying)::text, ('RN'::character varying)::text, ('RS'::character varying)::text, ('RO'::character varying)::text, ('RR'::character varying)::text, ('SC'::character varying)::text, ('SE'::character varying)::text, ('SP'::character varying)::text, ('TO'::character varying)::text])))
);


--
-- Name: TABLE contratos_anuais; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.contratos_anuais IS 'Controle Anual de Contratos - Porta 3003';


--
-- Name: COLUMN contratos_anuais.empresa; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.contratos_anuais.empresa IS 'Hagg, NH, SN, CANA├â, Nascimento';


--
-- Name: COLUMN contratos_anuais.estado; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.contratos_anuais.estado IS 'Sigla do estado (2 letras)';


--
-- Name: contratos_anuais_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.contratos_anuais_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: contratos_anuais_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.contratos_anuais_id_seq OWNED BY public.contratos_anuais.id;


--
-- Name: contratos_documentos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.contratos_documentos (
    id integer NOT NULL,
    contrato_id integer,
    tipo_documento character varying(100) NOT NULL,
    nome_arquivo character varying(300) NOT NULL,
    caminho_arquivo text NOT NULL,
    tamanho_kb integer,
    data_upload timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    uploaded_by integer
);


--
-- Name: TABLE contratos_documentos; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.contratos_documentos IS 'Documentos anexados aos contratos - Aba 2';


--
-- Name: COLUMN contratos_documentos.tipo_documento; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.contratos_documentos.tipo_documento IS 'contratosAditivos, dadosInicioContrato, planilhaCusto, apoliceSeguro, pedidosReequilibrio';


--
-- Name: contratos_documentos_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.contratos_documentos_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: contratos_documentos_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.contratos_documentos_id_seq OWNED BY public.contratos_documentos.id;


--
-- Name: contratos_fiscalizacao; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.contratos_fiscalizacao (
    id integer NOT NULL,
    contrato_id integer,
    data_fiscalizacao date NOT NULL,
    fiscal_responsavel character varying(200),
    tipo_fiscalizacao character varying(50),
    observacoes text,
    status_conformidade character varying(30),
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    created_by integer
);


--
-- Name: TABLE contratos_fiscalizacao; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.contratos_fiscalizacao IS 'Registro de fiscaliza├º├Áes realizadas';


--
-- Name: COLUMN contratos_fiscalizacao.tipo_fiscalizacao; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.contratos_fiscalizacao.tipo_fiscalizacao IS 'rotina, especial, den├║ncia';


--
-- Name: COLUMN contratos_fiscalizacao.status_conformidade; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.contratos_fiscalizacao.status_conformidade IS 'conforme, nao_conforme, pendente';


--
-- Name: contratos_fiscalizacao_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.contratos_fiscalizacao_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: contratos_fiscalizacao_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.contratos_fiscalizacao_id_seq OWNED BY public.contratos_fiscalizacao.id;


--
-- Name: contratos_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.contratos_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: contratos_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.contratos_id_seq OWNED BY public.contratos.id;


--
-- Name: contratos_resumo_financeiro; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.contratos_resumo_financeiro (
    id integer NOT NULL,
    contrato_id integer,
    numero_contrato character varying(100),
    cliente_orgao character varying(300),
    quantidade_postos_total integer,
    valor_mensal numeric(15,2),
    cnpj_contratante character varying(20),
    objeto_descricao text,
    posto character varying(200),
    valor_posto numeric(10,2),
    quantidade_postos integer,
    valor_mensal_postos numeric(15,2),
    vigencia_inicio date,
    vigencia_fim date,
    observacoes text,
    numero_contrato_controle character varying(100),
    etapa character varying(200),
    responsavel character varying(200),
    data_limite date,
    status character varying(50),
    observacoes_controle text,
    documentacao character varying(300),
    data_entrega date,
    status_documentacao character varying(50),
    observacoes_documentacao text,
    dados jsonb,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: TABLE contratos_resumo_financeiro; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.contratos_resumo_financeiro IS 'Resumo Financeiro - Aba 4';


--
-- Name: contratos_resumo_financeiro_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.contratos_resumo_financeiro_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: contratos_resumo_financeiro_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.contratos_resumo_financeiro_id_seq OWNED BY public.contratos_resumo_financeiro.id;


--
-- Name: contratos_resumo_rh; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.contratos_resumo_rh (
    id integer NOT NULL,
    contrato_id integer,
    tipo_posto character varying(200),
    tipo_servico_cargo character varying(200),
    cbo character varying(20),
    salario_base numeric(10,2),
    insalubridade_40 numeric(10,2),
    insalubridade_20 numeric(10,2),
    gratificacao_funcao numeric(10,2),
    adicional_noturno numeric(10,2),
    hora_noturna_reduzida numeric(10,2),
    dsr_adicional_noturno numeric(10,2),
    intervalo_intrajornada numeric(10,2),
    intrajornada numeric(10,2),
    bsf numeric(10,2),
    horas_extras numeric(10,2),
    va numeric(10,2),
    desconto_va numeric(10,2),
    vl numeric(10,2),
    total_remuneracao numeric(10,2),
    escala character varying(100),
    carga_horaria character varying(50),
    dias_semana_turno character varying(200),
    num_funcionarios_posto integer,
    sindicato character varying(200),
    vale_transporte_dia numeric(10,2),
    desconto_vt numeric(10,2),
    especificacoes_objeto text,
    preposto character varying(200),
    informacao_importante text,
    atribuicao_postos text,
    local character varying(300),
    endereco text,
    dados jsonb,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: TABLE contratos_resumo_rh; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.contratos_resumo_rh IS 'Resumo RH, Operacional e Compras - Aba 3';


--
-- Name: COLUMN contratos_resumo_rh.dados; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.contratos_resumo_rh.dados IS 'Dados completos em formato JSON incluindo: 
- locaisTrabalho (array)
- uniformes (array)
- epis (array)
- equipamentos (array) [NOVO v2.2]
- maquinas (array) [NOVO v2.2]
- qualificacoesProfissionais (array)
- contatos (array)
- documentacoes (array)';


--
-- Name: contratos_resumo_rh_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.contratos_resumo_rh_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: contratos_resumo_rh_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.contratos_resumo_rh_id_seq OWNED BY public.contratos_resumo_rh.id;


--
-- Name: contratos_vigentes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.contratos_vigentes (
    id integer NOT NULL,
    empresa character varying(50) NOT NULL,
    contrato text,
    data_apresentacao_proposta_ipca character varying(200),
    status_vigencia character varying(100),
    havera_prorrogacao character varying(100),
    status character varying(100),
    reequilibrio_ano_vigente character varying(100),
    seguro_garantia character varying(100),
    reequilibrios_2023 character varying(100),
    situacao_renovacao character varying(100),
    ccts character varying(100),
    documento_adicional_prorrogar text,
    cidade character varying(100),
    numero_contrato integer,
    funcionarios integer,
    meses_execucao integer,
    meses_vigencia integer,
    dias_para_data_fim integer,
    valor_sem_repac integer,
    inicio date,
    data_inicio date,
    data_inicio_prorrogacoes date,
    data_fim date,
    valor_atualizado numeric(15,2),
    dif_quando_def numeric(15,2),
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT contratos_vigentes_empresa_check CHECK (((empresa)::text = ANY (ARRAY[('Hagg'::character varying)::text, ('SN'::character varying)::text, ('NH'::character varying)::text, ('CANA├â'::character varying)::text, ('Nascimento'::character varying)::text])))
);


--
-- Name: TABLE contratos_vigentes; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.contratos_vigentes IS 'Contratos vigentes - CRUD completo via porta 5005';


--
-- Name: COLUMN contratos_vigentes.empresa; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.contratos_vigentes.empresa IS 'Dropdown: Hagg, SN, NH, CANA├â, Nascimento';


--
-- Name: COLUMN contratos_vigentes.valor_sem_repac; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.contratos_vigentes.valor_sem_repac IS 'Valor sem reajuste (inteiro)';


--
-- Name: COLUMN contratos_vigentes.valor_atualizado; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.contratos_vigentes.valor_atualizado IS 'Valor monet├írio com 2 casas decimais';


--
-- Name: COLUMN contratos_vigentes.dif_quando_def; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.contratos_vigentes.dif_quando_def IS 'Diferen├ºa quando definitivo (monet├írio)';


--
-- Name: contratos_vigentes_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.contratos_vigentes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: contratos_vigentes_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.contratos_vigentes_id_seq OWNED BY public.contratos_vigentes.id;


--
-- Name: cotacoes_impugnacoes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cotacoes_impugnacoes (
    id integer NOT NULL,
    tipo character varying(20) NOT NULL,
    arquivo_url character varying(500) NOT NULL,
    arquivo_nome character varying(255) NOT NULL,
    comentario text NOT NULL,
    remetente character varying(255) NOT NULL,
    data_envio timestamp without time zone DEFAULT now() NOT NULL,
    status character varying(20) DEFAULT 'pendente'::character varying NOT NULL,
    resposta_arquivo_url character varying(500),
    resposta_arquivo_nome character varying(255),
    resposta_comentario text,
    respondente character varying(255),
    data_resposta timestamp without time zone,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    visualizado_por character varying(200),
    visualizado_em timestamp without time zone,
    editado_por character varying(200),
    editado_em timestamp without time zone,
    resposta_visualizada_por character varying(200),
    resposta_visualizada_em timestamp without time zone,
    CONSTRAINT cotacoes_impugnacoes_status_check CHECK (((status)::text = ANY (ARRAY[('pendente'::character varying)::text, ('respondido'::character varying)::text, ('cancelado'::character varying)::text]))),
    CONSTRAINT cotacoes_impugnacoes_tipo_check CHECK (((tipo)::text = ANY (ARRAY[('cotacao'::character varying)::text, ('impugnacao'::character varying)::text])))
);


--
-- Name: TABLE cotacoes_impugnacoes; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.cotacoes_impugnacoes IS 'Gerencia solicita├º├Áes de cota├º├Áes e impugna├º├Áes entre Licita├º├úo e Compras';


--
-- Name: COLUMN cotacoes_impugnacoes.tipo; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.cotacoes_impugnacoes.tipo IS 'Tipo da solicita├º├úo: cotacao ou impugnacao';


--
-- Name: COLUMN cotacoes_impugnacoes.arquivo_url; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.cotacoes_impugnacoes.arquivo_url IS 'URL relativa do arquivo enviado pela Licita├º├úo';


--
-- Name: COLUMN cotacoes_impugnacoes.status; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.cotacoes_impugnacoes.status IS 'Status: pendente (aguardando resposta), respondido (Compras respondeu), cancelado';


--
-- Name: COLUMN cotacoes_impugnacoes.resposta_arquivo_url; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.cotacoes_impugnacoes.resposta_arquivo_url IS 'URL relativa do arquivo de resposta enviado por Compras';


--
-- Name: cotacoes_impugnacoes_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.cotacoes_impugnacoes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: cotacoes_impugnacoes_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.cotacoes_impugnacoes_id_seq OWNED BY public.cotacoes_impugnacoes.id;


--
-- Name: demissoes_solicitadas; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.demissoes_solicitadas (
    id integer NOT NULL,
    solicitacao_id character varying(50) NOT NULL,
    data_solicitacao date NOT NULL,
    nome_solicitante character varying(300) NOT NULL,
    email_solicitante character varying(300) NOT NULL,
    nome_colaborador character varying(300) NOT NULL,
    posto_colaborador character varying(300) NOT NULL,
    contrato character varying(300) NOT NULL,
    escala_trabalho character varying(100) NOT NULL,
    motivo_solicitacao character varying(200) NOT NULL,
    motivo_solicitacao_outro text,
    motivo_pedido_demissao character varying(200) NOT NULL,
    relato_motivo text,
    termino_contrato_experiencia character varying(200),
    termino_contrato_experiencia_outro text,
    data_aviso date,
    modelo_aviso character varying(200),
    telefone_colaborador character varying(30),
    email_colaborador character varying(300),
    documentos_anexados jsonb DEFAULT '[]'::jsonb,
    status character varying(50) DEFAULT 'PENDENTE_OPERACIONAL'::character varying,
    comentario_operacional text,
    atualizado_por character varying(200),
    origem character varying(100) DEFAULT 'SITE_EXTERNO'::character varying,
    logs jsonb DEFAULT '[]'::jsonb,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    comentario_rh text,
    atualizado_por_rh character varying(200)
);


--
-- Name: demissoes_solicitadas_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.demissoes_solicitadas_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: demissoes_solicitadas_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.demissoes_solicitadas_id_seq OWNED BY public.demissoes_solicitadas.id;


--
-- Name: entrevistas_vagas; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.entrevistas_vagas (
    id integer NOT NULL,
    solicitacao_id character varying(100) NOT NULL,
    nome_candidato character varying(300) NOT NULL,
    cpf_candidato character varying(20),
    data_entrevista date,
    hora_entrevista time without time zone,
    status character varying(50) DEFAULT 'PENDENTE'::character varying,
    comentario text,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now()
);


--
-- Name: entrevistas_vagas_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.entrevistas_vagas_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: entrevistas_vagas_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.entrevistas_vagas_id_seq OWNED BY public.entrevistas_vagas.id;


--
-- Name: equipamentos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.equipamentos (
    id integer NOT NULL,
    nome character varying(255) NOT NULL,
    descricao text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    contrato character varying(500),
    posto character varying(500),
    em_manutencao boolean DEFAULT false,
    data_inicio_manutencao date,
    data_previsao_fim_manutencao date
);


--
-- Name: TABLE equipamentos; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.equipamentos IS 'Tabela de cadastro de equipamentos para manutenção';


--
-- Name: equipamentos_arquivos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.equipamentos_arquivos (
    id integer NOT NULL,
    equipamento_id integer NOT NULL,
    nome_original character varying(500) NOT NULL,
    nome_arquivo character varying(500) NOT NULL,
    tamanho integer NOT NULL,
    tipo character varying(100) NOT NULL,
    url character varying(1000) NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    comentario text,
    valor numeric(12,2)
);


--
-- Name: TABLE equipamentos_arquivos; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.equipamentos_arquivos IS 'Arquivos anexados aos equipamentos (fotos, documentos, etc)';


--
-- Name: equipamentos_arquivos_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.equipamentos_arquivos_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: equipamentos_arquivos_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.equipamentos_arquivos_id_seq OWNED BY public.equipamentos_arquivos.id;


--
-- Name: equipamentos_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.equipamentos_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: equipamentos_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.equipamentos_id_seq OWNED BY public.equipamentos.id;


--
-- Name: estoque_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.estoque_items (
    id integer NOT NULL,
    nome character varying(255) NOT NULL,
    quantidade_total integer DEFAULT 0 NOT NULL,
    localizacao character varying(300),
    tipo_item character varying(100) NOT NULL,
    estado character varying(50) NOT NULL,
    valor_unitario numeric(10,2) NOT NULL,
    estoque_minimo integer DEFAULT 0 NOT NULL,
    validade date,
    fornecedor character varying(300),
    contrato_id integer,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    devolucao boolean DEFAULT false,
    CONSTRAINT estoque_items_estado_check CHECK (((estado)::text = ANY (ARRAY[('Novo'::character varying)::text, ('Higienizado'::character varying)::text])))
);


--
-- Name: TABLE estoque_items; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.estoque_items IS 'Itens do controle de estoque - Porta 3017';


--
-- Name: COLUMN estoque_items.quantidade_total; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.estoque_items.quantidade_total IS 'Quantidade total de tags dispon├¡veis (calculado automaticamente)';


--
-- Name: COLUMN estoque_items.estado; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.estoque_items.estado IS 'Estado do item: Novo ou Higienizado';


--
-- Name: COLUMN estoque_items.contrato_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.estoque_items.contrato_id IS 'Refer├¬ncia ao contrato relacionado';


--
-- Name: estoque_items_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.estoque_items_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: estoque_items_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.estoque_items_id_seq OWNED BY public.estoque_items.id;


--
-- Name: estoque_tags; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.estoque_tags (
    id integer NOT NULL,
    item_id integer NOT NULL,
    tag_id character varying(50) NOT NULL,
    tamanho character varying(20) NOT NULL,
    sequencia integer NOT NULL,
    usado boolean DEFAULT false NOT NULL,
    pedido_id character varying(50),
    usado_em timestamp without time zone,
    usado_por character varying(255),
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    tipo_tag character varying(10) DEFAULT 'unico'::character varying NOT NULL,
    quantidade_massa integer,
    quantidade_original_massa integer,
    valor_unitario numeric(10,2),
    equipamento_index integer,
    CONSTRAINT check_quantidade_massa_valida CHECK (((((tipo_tag)::text = 'massa'::text) AND (quantidade_massa IS NOT NULL) AND (quantidade_massa >= 0)) OR (((tipo_tag)::text = 'unico'::text) AND (quantidade_massa IS NULL)))),
    CONSTRAINT estoque_tags_tipo_tag_check CHECK (((tipo_tag)::text = ANY (ARRAY[('unico'::character varying)::text, ('massa'::character varying)::text])))
);


--
-- Name: TABLE estoque_tags; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.estoque_tags IS 'Tags individuais dos itens do estoque';


--
-- Name: COLUMN estoque_tags.tag_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.estoque_tags.tag_id IS 'ID ├║nico da tag (c├│digo de barras)';


--
-- Name: COLUMN estoque_tags.usado; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.estoque_tags.usado IS 'Indica se a tag j├í foi utilizada em um pedido';


--
-- Name: COLUMN estoque_tags.pedido_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.estoque_tags.pedido_id IS 'ID do pedido onde a tag foi utilizada';


--
-- Name: COLUMN estoque_tags.tipo_tag; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.estoque_tags.tipo_tag IS 'Tipo da TAG: "unico" (1 tag = 1 item) ou "massa" (1 tag = m├â┬║ltiplas quantidades)';


--
-- Name: COLUMN estoque_tags.quantidade_massa; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.estoque_tags.quantidade_massa IS 'Quantidade dispon├â┬¡vel para TAGs tipo "massa". NULL para TAGs tipo "unico"';


--
-- Name: COLUMN estoque_tags.quantidade_original_massa; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.estoque_tags.quantidade_original_massa IS 'Quantidade original quando criada (para hist├â┬│rico). NULL para TAGs tipo "unico"';


--
-- Name: COLUMN estoque_tags.valor_unitario; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.estoque_tags.valor_unitario IS 'Valor unitário específico desta tag (opcional). Se NULL, usa o valor_unitario do item pai.';


--
-- Name: estoque_tags_consumo; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.estoque_tags_consumo (
    id integer NOT NULL,
    tag_id character varying(100) NOT NULL,
    item_id integer,
    pedido_id character varying(100) NOT NULL,
    quantidade integer DEFAULT 1 NOT NULL,
    equipamento_index integer,
    consumido_em timestamp without time zone DEFAULT now(),
    consumido_por character varying(100)
);


--
-- Name: estoque_tags_consumo_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.estoque_tags_consumo_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: estoque_tags_consumo_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.estoque_tags_consumo_id_seq OWNED BY public.estoque_tags_consumo.id;


--
-- Name: estoque_tags_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.estoque_tags_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: estoque_tags_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.estoque_tags_id_seq OWNED BY public.estoque_tags.id;


--
-- Name: fornecedores; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.fornecedores (
    id integer NOT NULL,
    razao_social character varying(300) NOT NULL,
    nome_fantasia character varying(300),
    cnpj character varying(18) NOT NULL,
    inscricao_estadual character varying(20),
    inscricao_municipal character varying(20),
    telefone character varying(20),
    email character varying(200),
    endereco text,
    cidade character varying(100),
    estado character(2),
    cep character varying(10),
    ativo boolean DEFAULT true,
    data_cadastro timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: TABLE fornecedores; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.fornecedores IS 'Cadastro de empresas fornecedoras';


--
-- Name: fornecedores_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.fornecedores_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: fornecedores_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.fornecedores_id_seq OWNED BY public.fornecedores.id;


--
-- Name: licitacoes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.licitacoes (
    id integer NOT NULL,
    data date NOT NULL,
    horario time without time zone,
    edital character varying(200) NOT NULL,
    cidade character varying(100),
    objeto text,
    empresa character varying(50),
    responsavel character varying(50),
    uf character varying(2),
    status character varying(100),
    fase character varying(50),
    posicao integer,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    valor_estimado numeric(15,2) DEFAULT NULL::numeric,
    numero_postos integer,
    CONSTRAINT licitacoes_empresa_check CHECK (((empresa)::text = ANY ((ARRAY['Hagg'::character varying, 'NH'::character varying, 'SN'::character varying, 'CANAÃ'::character varying, 'Nascimento'::character varying, 'LF ZELADORIA'::character varying, 'A Definir'::character varying])::text[]))),
    CONSTRAINT licitacoes_fase_check CHECK (((fase)::text = ANY ((ARRAY['NÃO PARTICIPADO'::character varying, 'SUSPENSO/REVOGADO'::character varying, 'EM ANDAMENTO'::character varying, 'INICIADO'::character varying, 'À INICIAR'::character varying, 'FINALIZADA'::character varying])::text[]))),
    CONSTRAINT licitacoes_responsavel_check CHECK (((responsavel)::text = ANY ((ARRAY['Renato'::character varying, 'Otniel'::character varying, 'Amália'::character varying, 'Gabriela'::character varying, 'A Definir'::character varying])::text[]))),
    CONSTRAINT licitacoes_uf_check CHECK (((uf)::text ~ '^[A-Z]{2}$'::text))
);


--
-- Name: TABLE licitacoes; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.licitacoes IS 'Controle de licita├º├Áes - Grade de Licita├º├úo (Porta 3005/3006)';


--
-- Name: COLUMN licitacoes.id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.licitacoes.id IS 'Identificador ├║nico da licita├º├úo';


--
-- Name: COLUMN licitacoes.data; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.licitacoes.data IS 'Data da licita├º├úo';


--
-- Name: COLUMN licitacoes.horario; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.licitacoes.horario IS 'Hor├írio da licita├º├úo (formato HH:MM)';


--
-- Name: COLUMN licitacoes.edital; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.licitacoes.edital IS 'N├║mero/c├│digo do edital';


--
-- Name: COLUMN licitacoes.cidade; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.licitacoes.cidade IS 'Cidade da licita├º├úo';


--
-- Name: COLUMN licitacoes.objeto; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.licitacoes.objeto IS 'Objeto/descri├º├úo da licita├º├úo';


--
-- Name: COLUMN licitacoes.empresa; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.licitacoes.empresa IS 'Empresa participante (5 op├º├Áes)';


--
-- Name: COLUMN licitacoes.responsavel; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.licitacoes.responsavel IS 'Respons├ível pela licita├º├úo (4 op├º├Áes)';


--
-- Name: COLUMN licitacoes.uf; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.licitacoes.uf IS 'Unidade Federativa (sigla do estado)';


--
-- Name: COLUMN licitacoes.status; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.licitacoes.status IS 'Status atual da licita├º├úo';


--
-- Name: COLUMN licitacoes.fase; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.licitacoes.fase IS 'Fase da licita├º├úo (6 op├º├Áes)';


--
-- Name: COLUMN licitacoes.posicao; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.licitacoes.posicao IS 'Posi├º├úo/classifica├º├úo';


--
-- Name: licitacoes_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.licitacoes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: licitacoes_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.licitacoes_id_seq OWNED BY public.licitacoes.id;


--
-- Name: lotes_alteracoes_catalogo; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.lotes_alteracoes_catalogo (
    id integer NOT NULL,
    lote_id character varying(100) NOT NULL,
    total_alteracoes integer NOT NULL,
    callback_url text NOT NULL,
    status character varying(20) DEFAULT 'PENDENTE'::character varying,
    usuario_erp character varying(255),
    comentario_erp text,
    data_envio timestamp without time zone NOT NULL,
    data_resposta timestamp without time zone,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now()
);


--
-- Name: lotes_alteracoes_catalogo_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.lotes_alteracoes_catalogo_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: lotes_alteracoes_catalogo_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.lotes_alteracoes_catalogo_id_seq OWNED BY public.lotes_alteracoes_catalogo.id;


--
-- Name: manutencao_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.manutencao_logs (
    id integer NOT NULL,
    tipo_item character varying(20) NOT NULL,
    item_id integer NOT NULL,
    item_nome character varying(255),
    acao character varying(80) NOT NULL,
    campo character varying(100),
    valor_anterior text,
    valor_novo text,
    usuario_nome character varying(255),
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: manutencao_logs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.manutencao_logs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: manutencao_logs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.manutencao_logs_id_seq OWNED BY public.manutencao_logs.id;


--
-- Name: metas; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.metas (
    id integer NOT NULL,
    texto text NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: COLUMN metas.id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.metas.id IS 'ID ├║nico da meta (gerado automaticamente)';


--
-- Name: COLUMN metas.texto; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.metas.texto IS 'Descri├º├úo da meta';


--
-- Name: COLUMN metas.created_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.metas.created_at IS 'Data de cria├º├úo do registro';


--
-- Name: COLUMN metas.updated_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.metas.updated_at IS 'Data da ├║ltima atualiza├º├úo';


--
-- Name: metas_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.metas_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: metas_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.metas_id_seq OWNED BY public.metas.id;


--
-- Name: orcamentos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.orcamentos (
    id integer NOT NULL,
    empresa character varying(100),
    cliente text,
    contrato text NOT NULL,
    posto text,
    servico text,
    quantidade integer DEFAULT 1,
    sindicato character varying(200),
    vigencia date,
    status_contrato character varying(100),
    orcado_executado character varying(50),
    contrato_id integer,
    dados jsonb DEFAULT '{}'::jsonb,
    total_por_funcionario numeric(15,2) DEFAULT 0,
    total_posto numeric(15,2) DEFAULT 0,
    importado_de character varying(300),
    criado_por character varying(200),
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: orcamentos_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.orcamentos_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: orcamentos_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.orcamentos_id_seq OWNED BY public.orcamentos.id;


--
-- Name: pedido_equipamentos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pedido_equipamentos (
    id integer NOT NULL,
    pedido_id integer NOT NULL,
    nome_equipamento character varying(255) NOT NULL,
    tamanho character varying(10),
    quantidade integer NOT NULL,
    data_criacao timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT pedido_equipamentos_quantidade_check CHECK ((quantidade > 0))
);


--
-- Name: TABLE pedido_equipamentos; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.pedido_equipamentos IS 'Equipamentos solicitados em cada pedido';


--
-- Name: COLUMN pedido_equipamentos.tamanho; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.pedido_equipamentos.tamanho IS 'Tamanho do equipamento (P, M, G, GG, n├║meros, etc)';


--
-- Name: pedido_equipamentos_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.pedido_equipamentos_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: pedido_equipamentos_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.pedido_equipamentos_id_seq OWNED BY public.pedido_equipamentos.id;


--
-- Name: pedidos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pedidos (
    id integer NOT NULL,
    pedido_id character varying(50) NOT NULL,
    nome_solicitante character varying(255) NOT NULL,
    nome_colaborador character varying(255) NOT NULL,
    matricula_colaborador character varying(50) NOT NULL,
    admissao boolean DEFAULT false,
    data_admissao date,
    data_solicitacao date NOT NULL,
    contrato character varying(255) NOT NULL,
    posto character varying(255) NOT NULL,
    funcao character varying(255) NOT NULL,
    status character varying(50) DEFAULT 'PENDENTE'::character varying,
    data_criacao timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    data_atualizacao timestamp without time zone
);


--
-- Name: TABLE pedidos; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.pedidos IS 'Pedidos de equipamentos sincronizados do Site 1 (Sistema Externo Nascimento)';


--
-- Name: COLUMN pedidos.pedido_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.pedidos.pedido_id IS 'ID ├║nico do pedido (vem do Site 1)';


--
-- Name: COLUMN pedidos.admissao; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.pedidos.admissao IS 'Indica se ├® um pedido de admiss├úo';


--
-- Name: COLUMN pedidos.status; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.pedidos.status IS 'Status do pedido: PENDENTE, APROVADO, REJEITADO, EM_ANALISE';


--
-- Name: pedidos_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.pedidos_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: pedidos_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.pedidos_id_seq OWNED BY public.pedidos.id;


--
-- Name: pedidos_site_externo; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pedidos_site_externo (
    id integer NOT NULL,
    pedido_id character varying(50) NOT NULL,
    nome_solicitante character varying(255) NOT NULL,
    nome_colaborador character varying(255) NOT NULL,
    matricula_colaborador character varying(50) NOT NULL,
    admissao boolean DEFAULT false,
    data_admissao date,
    data_solicitacao date NOT NULL,
    contrato character varying(255) NOT NULL,
    posto character varying(255) NOT NULL,
    funcao character varying(255) NOT NULL,
    equipamentos jsonb NOT NULL,
    status character varying(50) DEFAULT 'EM PREPARACAO'::character varying,
    tags jsonb,
    observacao text,
    data_criacao timestamp without time zone DEFAULT now(),
    data_atualizacao timestamp without time zone DEFAULT now(),
    tipo_pedido character varying(100),
    observacoes_solicitante text,
    imagem_cracha_url character varying(500) DEFAULT NULL::character varying,
    tipo_admissao character varying(50) DEFAULT NULL::character varying,
    data_despachado timestamp without time zone
);


--
-- Name: TABLE pedidos_site_externo; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.pedidos_site_externo IS 'Pedidos sincronizados do Site Externo para a ERP';


--
-- Name: COLUMN pedidos_site_externo.pedido_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.pedidos_site_externo.pedido_id IS 'ID único do pedido (formato: PED-AAAAMMDD-XXXX)';


--
-- Name: COLUMN pedidos_site_externo.equipamentos; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.pedidos_site_externo.equipamentos IS 'Array de equipamentos em formato JSON';


--
-- Name: COLUMN pedidos_site_externo.status; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.pedidos_site_externo.status IS 'Status do pedido (EM PREPARACAO, PROCESSANDO, DESPACHADO, etc)';


--
-- Name: COLUMN pedidos_site_externo.tags; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.pedidos_site_externo.tags IS 'TAGs adicionadas pelo admin para organização';


--
-- Name: pedidos_site_externo20260623; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pedidos_site_externo20260623 (
    id integer,
    pedido_id character varying(50),
    nome_solicitante character varying(255),
    nome_colaborador character varying(255),
    matricula_colaborador character varying(50),
    admissao boolean,
    data_admissao date,
    data_solicitacao date,
    contrato character varying(255),
    posto character varying(255),
    funcao character varying(255),
    equipamentos jsonb,
    status character varying(50),
    tags jsonb,
    observacao text,
    data_criacao timestamp without time zone,
    data_atualizacao timestamp without time zone,
    tipo_pedido character varying(100),
    observacoes_solicitante text,
    imagem_cracha_url character varying(500),
    tipo_admissao character varying(50),
    data_despachado timestamp without time zone
);


--
-- Name: pedidos_site_externo_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.pedidos_site_externo_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: pedidos_site_externo_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.pedidos_site_externo_id_seq OWNED BY public.pedidos_site_externo.id;


--
-- Name: powerbi_relatorios; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.powerbi_relatorios (
    id integer NOT NULL,
    label character varying(255) NOT NULL,
    url text NOT NULL,
    categoria character varying(100) DEFAULT 'Geral'::character varying NOT NULL,
    ativo boolean DEFAULT true,
    ordem integer DEFAULT 999,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: powerbi_relatorios_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.powerbi_relatorios_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: powerbi_relatorios_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.powerbi_relatorios_id_seq OWNED BY public.powerbi_relatorios.id;


--
-- Name: sei_anexos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sei_anexos (
    id integer NOT NULL,
    processo_id integer NOT NULL,
    resposta_id integer,
    nome_arquivo character varying(500) NOT NULL,
    caminho_arquivo character varying(500) NOT NULL,
    tamanho_kb integer,
    tipo_mime character varying(200),
    enviado_por character varying(200) NOT NULL,
    substituido boolean DEFAULT false,
    substituido_por character varying(200),
    substituido_at timestamp without time zone,
    arquivo_anterior character varying(500),
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: sei_anexos_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.sei_anexos_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: sei_anexos_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.sei_anexos_id_seq OWNED BY public.sei_anexos.id;


--
-- Name: sei_permissoes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sei_permissoes (
    id integer NOT NULL,
    processo_id integer NOT NULL,
    tipo character varying(20) NOT NULL,
    valor character varying(200) NOT NULL,
    concedido_por character varying(200),
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    removido_em timestamp without time zone,
    removido_por character varying(200)
);


--
-- Name: sei_permissoes_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.sei_permissoes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: sei_permissoes_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.sei_permissoes_id_seq OWNED BY public.sei_permissoes.id;


--
-- Name: sei_processos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sei_processos (
    id integer NOT NULL,
    codigo character varying(30) NOT NULL,
    titulo character varying(300) NOT NULL,
    descricao text,
    visibilidade character varying(20) DEFAULT 'publico'::character varying,
    status character varying(30) DEFAULT 'aberto'::character varying,
    criado_por_nome character varying(200) NOT NULL,
    criado_por_setor character varying(200),
    setor_atual character varying(200),
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    finalizado_at timestamp without time zone,
    finalizado_por character varying(200)
);


--
-- Name: sei_processos_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.sei_processos_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: sei_processos_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.sei_processos_id_seq OWNED BY public.sei_processos.id;


--
-- Name: sei_respostas; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sei_respostas (
    id integer NOT NULL,
    processo_id integer NOT NULL,
    tipo character varying(30) DEFAULT 'comentario'::character varying,
    conteudo text,
    autor_nome character varying(200) NOT NULL,
    autor_setor character varying(200),
    mover_para_setor character varying(200),
    mover_para_pessoas text,
    justificativa_movimentacao text,
    editado boolean DEFAULT false,
    editado_por character varying(200),
    editado_at timestamp without time zone,
    conteudo_anterior text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: sei_respostas_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.sei_respostas_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: sei_respostas_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.sei_respostas_id_seq OWNED BY public.sei_respostas.id;


--
-- Name: sei_visualizacoes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sei_visualizacoes (
    id integer NOT NULL,
    processo_id integer NOT NULL,
    resposta_id integer,
    usuario_nome character varying(200) NOT NULL,
    usuario_setor character varying(200),
    visualizado_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: sei_visualizacoes_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.sei_visualizacoes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: sei_visualizacoes_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.sei_visualizacoes_id_seq OWNED BY public.sei_visualizacoes.id;


--
-- Name: senhas_backup_crypto; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.senhas_backup_crypto (
    cpf character varying(11) NOT NULL,
    senha_crypto text NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: solicitacoes_vagas; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.solicitacoes_vagas (
    id integer NOT NULL,
    solicitacao_id character varying(50) NOT NULL,
    contrato character varying(255) NOT NULL,
    cidade character varying(255) NOT NULL,
    cargo character varying(255) NOT NULL,
    escala_prevista character varying(50) NOT NULL,
    solicitado_por character varying(255) NOT NULL,
    motivo_vaga character varying(50) NOT NULL,
    nome_substituido character varying(255),
    horario character varying(100) NOT NULL,
    salario character varying(100) NOT NULL,
    beneficios_vt_vr character varying(255),
    recebe_insalubridade character varying(10) NOT NULL,
    quantos_insalubridade character varying(50),
    local_exato_trabalho text NOT NULL,
    data_prevista_inicio date NOT NULL,
    requisitos_obrigatorios text,
    requisitos_desejaveis text,
    experiencia_minima character varying(10),
    qual_experiencia_minima text,
    grau_urgencia character varying(50) NOT NULL,
    alta_rotatividade character varying(10) NOT NULL,
    possui_recomendacao character varying(255),
    observacoes_importantes text,
    status character varying(50) DEFAULT 'PENDENTE_OPERACIONAL'::character varying NOT NULL,
    status_treinamento character varying(100),
    editado boolean DEFAULT false,
    logs jsonb DEFAULT '[]'::jsonb,
    contratado_nome character varying(255),
    contratado_cpf character varying(14),
    contratado_data_inicio date,
    contratado_numero_contato character varying(20),
    contratado_pis character varying(20),
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_by character varying(255),
    origem character varying(50) DEFAULT 'SITE_EXTERNO'::character varying,
    posto_vaga character varying(300),
    enviado_para character varying(200),
    enviado_para_comentario text,
    concorrentes jsonb DEFAULT '[]'::jsonb,
    concorrente_selecionado character varying(200),
    reaberto_motivo text,
    reaberto_em timestamp without time zone,
    reaberto_por character varying(200)
);


--
-- Name: solicitacoes_vagas_auditoria; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.solicitacoes_vagas_auditoria (
    id integer NOT NULL,
    solicitacao_id character varying(50) NOT NULL,
    status_antigo character varying(50),
    status_novo character varying(50) NOT NULL,
    modificado_por character varying(255),
    observacao text,
    data_alteracao timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: solicitacoes_vagas_auditoria_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.solicitacoes_vagas_auditoria_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: solicitacoes_vagas_auditoria_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.solicitacoes_vagas_auditoria_id_seq OWNED BY public.solicitacoes_vagas_auditoria.id;


--
-- Name: solicitacoes_vagas_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.solicitacoes_vagas_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: solicitacoes_vagas_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.solicitacoes_vagas_id_seq OWNED BY public.solicitacoes_vagas.id;


--
-- Name: solicitar_erp; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.solicitar_erp (
    id integer NOT NULL,
    quem_voce character varying(300) NOT NULL,
    setor character varying(200) NOT NULL,
    titulo character varying(500) NOT NULL,
    motivo character varying(300),
    descricao text,
    status character varying(50) DEFAULT 'pendente_helena'::character varying NOT NULL,
    aprovado_helena_em timestamp without time zone,
    aprovado_helena_por character varying(300),
    aprovado_controladoria_em timestamp without time zone,
    aprovado_controladoria_por character varying(300),
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now()
);


--
-- Name: solicitar_erp_anexos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.solicitar_erp_anexos (
    id integer NOT NULL,
    solicitacao_id integer NOT NULL,
    nome_original character varying(500),
    nome_arquivo character varying(500),
    tamanho_kb integer,
    tipo_mime character varying(200),
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: solicitar_erp_anexos_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.solicitar_erp_anexos_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: solicitar_erp_anexos_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.solicitar_erp_anexos_id_seq OWNED BY public.solicitar_erp_anexos.id;


--
-- Name: solicitar_erp_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.solicitar_erp_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: solicitar_erp_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.solicitar_erp_id_seq OWNED BY public.solicitar_erp.id;


--
-- Name: solicitar_setor_sistemas; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.solicitar_setor_sistemas (
    id integer NOT NULL,
    descricao text NOT NULL,
    responsavel character varying(100) NOT NULL,
    status character varying(30) DEFAULT 'pendente'::character varying NOT NULL,
    solicitante_nome character varying(300),
    concluido_por character varying(300),
    concluido_em timestamp without time zone,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now()
);


--
-- Name: solicitar_setor_sistemas_anexos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.solicitar_setor_sistemas_anexos (
    id integer NOT NULL,
    solicitacao_id integer NOT NULL,
    nome_original character varying(500),
    nome_arquivo character varying(500),
    tamanho_kb integer,
    tipo_mime character varying(200),
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: solicitar_setor_sistemas_anexos_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.solicitar_setor_sistemas_anexos_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: solicitar_setor_sistemas_anexos_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.solicitar_setor_sistemas_anexos_id_seq OWNED BY public.solicitar_setor_sistemas_anexos.id;


--
-- Name: solicitar_setor_sistemas_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.solicitar_setor_sistemas_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: solicitar_setor_sistemas_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.solicitar_setor_sistemas_id_seq OWNED BY public.solicitar_setor_sistemas.id;


--
-- Name: tarefas; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tarefas (
    id integer NOT NULL,
    titulo character varying(255) NOT NULL,
    prazo date,
    status character varying(50) DEFAULT 'Pendente'::character varying,
    criado_por character varying(14),
    criado_em timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    atualizado_em timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    ativo boolean DEFAULT true,
    CONSTRAINT tarefas_status_check CHECK (((status)::text = ANY (ARRAY[('Pendente'::character varying)::text, ('Em Progresso'::character varying)::text, ('Finalizado'::character varying)::text])))
);


--
-- Name: TABLE tarefas; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.tarefas IS 'Tabela de tarefas do dashboard geral';


--
-- Name: COLUMN tarefas.titulo; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.tarefas.titulo IS 'T├¡tulo/descri├º├úo da tarefa';


--
-- Name: COLUMN tarefas.prazo; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.tarefas.prazo IS 'Data de prazo da tarefa';


--
-- Name: COLUMN tarefas.status; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.tarefas.status IS 'Status: Pendente, Em Progresso ou Finalizado';


--
-- Name: COLUMN tarefas.criado_por; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.tarefas.criado_por IS 'CPF do usu├írio que criou a tarefa';


--
-- Name: tarefas_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.tarefas_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: tarefas_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.tarefas_id_seq OWNED BY public.tarefas.id;


--
-- Name: usuarios_permissoes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.usuarios_permissoes (
    cpf character varying(11) NOT NULL,
    nome character varying(255) NOT NULL,
    cargo character varying(255) NOT NULL,
    setor character varying(100) NOT NULL,
    permissoes jsonb DEFAULT '{"papel": "VISUALIZADOR", "modulos": []}'::jsonb,
    ativo boolean DEFAULT true,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    login character varying(50),
    senha character varying(100)
);


--
-- Name: vagas; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vagas (
    id integer NOT NULL,
    titulo character varying(200) NOT NULL,
    funcao character varying(150) NOT NULL,
    descricao text,
    requisitos text,
    cidade character varying(100) NOT NULL,
    estado character(2) NOT NULL,
    salario numeric(10,2),
    beneficios text,
    tipo_contrato character varying(50) DEFAULT 'CLT'::character varying,
    jornada character varying(50),
    nivel character varying(50),
    status character varying(20) DEFAULT 'ativa'::character varying,
    vagas_disponiveis integer DEFAULT 1,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    encerrada_em timestamp without time zone
);


--
-- Name: TABLE vagas; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.vagas IS 'Vagas de emprego disponíveis para candidatura via WhatsApp';


--
-- Name: vagas_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.vagas_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: vagas_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.vagas_id_seq OWNED BY public.vagas.id;


--
-- Name: veiculos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.veiculos (
    id integer NOT NULL,
    nome character varying(255) NOT NULL,
    descricao text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    contrato character varying(500),
    posto character varying(500),
    em_manutencao boolean DEFAULT false,
    data_inicio_manutencao date,
    data_previsao_fim_manutencao date
);


--
-- Name: TABLE veiculos; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.veiculos IS 'Tabela de cadastro de veículos para manutenção';


--
-- Name: veiculos_arquivos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.veiculos_arquivos (
    id integer NOT NULL,
    veiculo_id integer NOT NULL,
    nome_original character varying(255) NOT NULL,
    nome_arquivo character varying(255) NOT NULL,
    tamanho integer,
    tipo character varying(100),
    url text,
    comentario text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    valor numeric(12,2)
);


--
-- Name: TABLE veiculos_arquivos; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.veiculos_arquivos IS 'Arquivos anexados aos veículos (fotos, documentos, etc)';


--
-- Name: veiculos_arquivos_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.veiculos_arquivos_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: veiculos_arquivos_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.veiculos_arquivos_id_seq OWNED BY public.veiculos_arquivos.id;


--
-- Name: veiculos_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.veiculos_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: veiculos_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.veiculos_id_seq OWNED BY public.veiculos.id;


--
-- Name: vw_candidatos_completo; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.vw_candidatos_completo AS
SELECT
    NULL::integer AS id,
    NULL::character varying(200) AS nome_completo,
    NULL::character varying(14) AS cpf,
    NULL::character varying(20) AS telefone_whatsapp,
    NULL::character varying(200) AS email,
    NULL::character varying(100) AS cidade,
    NULL::character(2) AS estado,
    NULL::character varying(50) AS origem,
    NULL::character varying(30) AS status,
    NULL::bigint AS total_aplicacoes,
    NULL::timestamp without time zone AS ultima_aplicacao,
    NULL::timestamp without time zone AS created_at;


--
-- Name: vw_pipeline_recrutamento; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.vw_pipeline_recrutamento AS
SELECT
    NULL::integer AS vaga_id,
    NULL::character varying(200) AS vaga_titulo,
    NULL::character varying(150) AS funcao,
    NULL::bigint AS etapa_1_novo,
    NULL::bigint AS etapa_2_triagem,
    NULL::bigint AS etapa_3_entrevista,
    NULL::bigint AS etapa_4_aprovado,
    NULL::bigint AS etapa_5_contratado,
    NULL::bigint AS rejeitados;


--
-- Name: vw_vagas_resumo; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.vw_vagas_resumo AS
SELECT
    NULL::integer AS id,
    NULL::character varying(200) AS titulo,
    NULL::character varying(150) AS funcao,
    NULL::character varying(100) AS cidade,
    NULL::character(2) AS estado,
    NULL::character varying(20) AS status,
    NULL::bigint AS total_candidatos,
    NULL::bigint AS candidatos_novos,
    NULL::bigint AS candidatos_em_analise,
    NULL::bigint AS candidatos_aprovados,
    NULL::timestamp without time zone AS ultima_aplicacao,
    NULL::timestamp without time zone AS created_at,
    NULL::timestamp without time zone AS updated_at;


--
-- Name: whatsapp_conversas; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.whatsapp_conversas (
    id integer NOT NULL,
    telefone_whatsapp character varying(20) NOT NULL,
    candidato_id integer,
    estado_atual character varying(50),
    dados_temporarios jsonb,
    status character varying(30) DEFAULT 'ativa'::character varying,
    iniciada_em timestamp without time zone DEFAULT now(),
    finalizada_em timestamp without time zone,
    ultima_mensagem_em timestamp without time zone DEFAULT now()
);


--
-- Name: TABLE whatsapp_conversas; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.whatsapp_conversas IS 'Log de conversas via WhatsApp para controle de estado';


--
-- Name: whatsapp_conversas_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.whatsapp_conversas_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: whatsapp_conversas_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.whatsapp_conversas_id_seq OWNED BY public.whatsapp_conversas.id;


--
-- Name: whatsapp_mensagens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.whatsapp_mensagens (
    id integer NOT NULL,
    conversa_id integer,
    telefone_whatsapp character varying(20) NOT NULL,
    message_id character varying(200),
    direcao character varying(10) NOT NULL,
    tipo character varying(30),
    conteudo text,
    conteudo_raw jsonb,
    media_id character varying(200),
    media_url character varying(500),
    media_mime_type character varying(100),
    status character varying(30),
    erro_codigo character varying(50),
    erro_mensagem text,
    enviada_em timestamp without time zone DEFAULT now(),
    entregue_em timestamp without time zone,
    lida_em timestamp without time zone,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: TABLE whatsapp_mensagens; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.whatsapp_mensagens IS 'Histórico completo de mensagens enviadas e recebidas';


--
-- Name: whatsapp_mensagens_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.whatsapp_mensagens_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: whatsapp_mensagens_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.whatsapp_mensagens_id_seq OWNED BY public.whatsapp_mensagens.id;


--
-- Name: whatsapp_webhook_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.whatsapp_webhook_logs (
    id integer NOT NULL,
    payload jsonb NOT NULL,
    signature_valida boolean,
    ip_origem character varying(50),
    processado boolean DEFAULT false,
    erro text,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: TABLE whatsapp_webhook_logs; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.whatsapp_webhook_logs IS 'Log de webhooks recebidos da Meta para debugging';


--
-- Name: whatsapp_webhook_logs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.whatsapp_webhook_logs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: whatsapp_webhook_logs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.whatsapp_webhook_logs_id_seq OWNED BY public.whatsapp_webhook_logs.id;


--
-- Name: alteracoes_catalogo_site_externo id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.alteracoes_catalogo_site_externo ALTER COLUMN id SET DEFAULT nextval('public.alteracoes_catalogo_site_externo_id_seq'::regclass);


--
-- Name: bd_negativo id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bd_negativo ALTER COLUMN id SET DEFAULT nextval('public.bd_negativo_id_seq'::regclass);


--
-- Name: candidatos id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.candidatos ALTER COLUMN id SET DEFAULT nextval('public.candidatos_id_seq'::regclass);


--
-- Name: candidatos_vagas id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.candidatos_vagas ALTER COLUMN id SET DEFAULT nextval('public.candidatos_vagas_id_seq'::regclass);


--
-- Name: compras_anexos id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.compras_anexos ALTER COLUMN id SET DEFAULT nextval('public.compras_anexos_id_seq'::regclass);


--
-- Name: compras_historico id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.compras_historico ALTER COLUMN id SET DEFAULT nextval('public.compras_historico_id_seq'::regclass);


--
-- Name: compras_solicitacoes id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.compras_solicitacoes ALTER COLUMN id SET DEFAULT nextval('public.compras_solicitacoes_id_seq'::regclass);


--
-- Name: contratos id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contratos ALTER COLUMN id SET DEFAULT nextval('public.contratos_id_seq'::regclass);


--
-- Name: contratos_aditivos id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contratos_aditivos ALTER COLUMN id SET DEFAULT nextval('public.contratos_aditivos_id_seq'::regclass);


--
-- Name: contratos_anuais id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contratos_anuais ALTER COLUMN id SET DEFAULT nextval('public.contratos_anuais_id_seq'::regclass);


--
-- Name: contratos_documentos id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contratos_documentos ALTER COLUMN id SET DEFAULT nextval('public.contratos_documentos_id_seq'::regclass);


--
-- Name: contratos_fiscalizacao id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contratos_fiscalizacao ALTER COLUMN id SET DEFAULT nextval('public.contratos_fiscalizacao_id_seq'::regclass);


--
-- Name: contratos_resumo_financeiro id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contratos_resumo_financeiro ALTER COLUMN id SET DEFAULT nextval('public.contratos_resumo_financeiro_id_seq'::regclass);


--
-- Name: contratos_resumo_rh id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contratos_resumo_rh ALTER COLUMN id SET DEFAULT nextval('public.contratos_resumo_rh_id_seq'::regclass);


--
-- Name: contratos_vigentes id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contratos_vigentes ALTER COLUMN id SET DEFAULT nextval('public.contratos_vigentes_id_seq'::regclass);


--
-- Name: cotacoes_impugnacoes id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cotacoes_impugnacoes ALTER COLUMN id SET DEFAULT nextval('public.cotacoes_impugnacoes_id_seq'::regclass);


--
-- Name: demissoes_solicitadas id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.demissoes_solicitadas ALTER COLUMN id SET DEFAULT nextval('public.demissoes_solicitadas_id_seq'::regclass);


--
-- Name: entrevistas_vagas id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.entrevistas_vagas ALTER COLUMN id SET DEFAULT nextval('public.entrevistas_vagas_id_seq'::regclass);


--
-- Name: equipamentos id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.equipamentos ALTER COLUMN id SET DEFAULT nextval('public.equipamentos_id_seq'::regclass);


--
-- Name: equipamentos_arquivos id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.equipamentos_arquivos ALTER COLUMN id SET DEFAULT nextval('public.equipamentos_arquivos_id_seq'::regclass);


--
-- Name: estoque_items id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.estoque_items ALTER COLUMN id SET DEFAULT nextval('public.estoque_items_id_seq'::regclass);


--
-- Name: estoque_tags id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.estoque_tags ALTER COLUMN id SET DEFAULT nextval('public.estoque_tags_id_seq'::regclass);


--
-- Name: estoque_tags_consumo id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.estoque_tags_consumo ALTER COLUMN id SET DEFAULT nextval('public.estoque_tags_consumo_id_seq'::regclass);


--
-- Name: fornecedores id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fornecedores ALTER COLUMN id SET DEFAULT nextval('public.fornecedores_id_seq'::regclass);


--
-- Name: licitacoes id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.licitacoes ALTER COLUMN id SET DEFAULT nextval('public.licitacoes_id_seq'::regclass);


--
-- Name: lotes_alteracoes_catalogo id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lotes_alteracoes_catalogo ALTER COLUMN id SET DEFAULT nextval('public.lotes_alteracoes_catalogo_id_seq'::regclass);


--
-- Name: manutencao_logs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.manutencao_logs ALTER COLUMN id SET DEFAULT nextval('public.manutencao_logs_id_seq'::regclass);


--
-- Name: metas id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.metas ALTER COLUMN id SET DEFAULT nextval('public.metas_id_seq'::regclass);


--
-- Name: orcamentos id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orcamentos ALTER COLUMN id SET DEFAULT nextval('public.orcamentos_id_seq'::regclass);


--
-- Name: pedido_equipamentos id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pedido_equipamentos ALTER COLUMN id SET DEFAULT nextval('public.pedido_equipamentos_id_seq'::regclass);


--
-- Name: pedidos id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pedidos ALTER COLUMN id SET DEFAULT nextval('public.pedidos_id_seq'::regclass);


--
-- Name: pedidos_site_externo id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pedidos_site_externo ALTER COLUMN id SET DEFAULT nextval('public.pedidos_site_externo_id_seq'::regclass);


--
-- Name: powerbi_relatorios id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.powerbi_relatorios ALTER COLUMN id SET DEFAULT nextval('public.powerbi_relatorios_id_seq'::regclass);


--
-- Name: sei_anexos id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sei_anexos ALTER COLUMN id SET DEFAULT nextval('public.sei_anexos_id_seq'::regclass);


--
-- Name: sei_permissoes id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sei_permissoes ALTER COLUMN id SET DEFAULT nextval('public.sei_permissoes_id_seq'::regclass);


--
-- Name: sei_processos id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sei_processos ALTER COLUMN id SET DEFAULT nextval('public.sei_processos_id_seq'::regclass);


--
-- Name: sei_respostas id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sei_respostas ALTER COLUMN id SET DEFAULT nextval('public.sei_respostas_id_seq'::regclass);


--
-- Name: sei_visualizacoes id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sei_visualizacoes ALTER COLUMN id SET DEFAULT nextval('public.sei_visualizacoes_id_seq'::regclass);


--
-- Name: solicitacoes_vagas id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.solicitacoes_vagas ALTER COLUMN id SET DEFAULT nextval('public.solicitacoes_vagas_id_seq'::regclass);


--
-- Name: solicitacoes_vagas_auditoria id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.solicitacoes_vagas_auditoria ALTER COLUMN id SET DEFAULT nextval('public.solicitacoes_vagas_auditoria_id_seq'::regclass);


--
-- Name: solicitar_erp id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.solicitar_erp ALTER COLUMN id SET DEFAULT nextval('public.solicitar_erp_id_seq'::regclass);


--
-- Name: solicitar_erp_anexos id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.solicitar_erp_anexos ALTER COLUMN id SET DEFAULT nextval('public.solicitar_erp_anexos_id_seq'::regclass);


--
-- Name: solicitar_setor_sistemas id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.solicitar_setor_sistemas ALTER COLUMN id SET DEFAULT nextval('public.solicitar_setor_sistemas_id_seq'::regclass);


--
-- Name: solicitar_setor_sistemas_anexos id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.solicitar_setor_sistemas_anexos ALTER COLUMN id SET DEFAULT nextval('public.solicitar_setor_sistemas_anexos_id_seq'::regclass);


--
-- Name: tarefas id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tarefas ALTER COLUMN id SET DEFAULT nextval('public.tarefas_id_seq'::regclass);


--
-- Name: vagas id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vagas ALTER COLUMN id SET DEFAULT nextval('public.vagas_id_seq'::regclass);


--
-- Name: veiculos id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.veiculos ALTER COLUMN id SET DEFAULT nextval('public.veiculos_id_seq'::regclass);


--
-- Name: veiculos_arquivos id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.veiculos_arquivos ALTER COLUMN id SET DEFAULT nextval('public.veiculos_arquivos_id_seq'::regclass);


--
-- Name: whatsapp_conversas id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.whatsapp_conversas ALTER COLUMN id SET DEFAULT nextval('public.whatsapp_conversas_id_seq'::regclass);


--
-- Name: whatsapp_mensagens id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.whatsapp_mensagens ALTER COLUMN id SET DEFAULT nextval('public.whatsapp_mensagens_id_seq'::regclass);


--
-- Name: whatsapp_webhook_logs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.whatsapp_webhook_logs ALTER COLUMN id SET DEFAULT nextval('public.whatsapp_webhook_logs_id_seq'::regclass);


--
-- Name: alteracoes_catalogo_site_externo alteracoes_catalogo_site_externo_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.alteracoes_catalogo_site_externo
    ADD CONSTRAINT alteracoes_catalogo_site_externo_pkey PRIMARY KEY (id);


--
-- Name: bd_negativo bd_negativo_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bd_negativo
    ADD CONSTRAINT bd_negativo_pkey PRIMARY KEY (id);


--
-- Name: candidatos candidatos_cpf_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.candidatos
    ADD CONSTRAINT candidatos_cpf_key UNIQUE (cpf);


--
-- Name: candidatos candidatos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.candidatos
    ADD CONSTRAINT candidatos_pkey PRIMARY KEY (id);


--
-- Name: candidatos_vagas candidatos_vagas_candidato_id_vaga_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.candidatos_vagas
    ADD CONSTRAINT candidatos_vagas_candidato_id_vaga_id_key UNIQUE (candidato_id, vaga_id);


--
-- Name: candidatos_vagas candidatos_vagas_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.candidatos_vagas
    ADD CONSTRAINT candidatos_vagas_pkey PRIMARY KEY (id);


--
-- Name: compras_anexos compras_anexos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.compras_anexos
    ADD CONSTRAINT compras_anexos_pkey PRIMARY KEY (id);


--
-- Name: compras_historico compras_historico_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.compras_historico
    ADD CONSTRAINT compras_historico_pkey PRIMARY KEY (id);


--
-- Name: compras_solicitacoes compras_solicitacoes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.compras_solicitacoes
    ADD CONSTRAINT compras_solicitacoes_pkey PRIMARY KEY (id);


--
-- Name: contratos_aditivos contratos_aditivos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contratos_aditivos
    ADD CONSTRAINT contratos_aditivos_pkey PRIMARY KEY (id);


--
-- Name: contratos_anuais contratos_anuais_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contratos_anuais
    ADD CONSTRAINT contratos_anuais_pkey PRIMARY KEY (id);


--
-- Name: contratos_documentos contratos_documentos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contratos_documentos
    ADD CONSTRAINT contratos_documentos_pkey PRIMARY KEY (id);


--
-- Name: contratos_fiscalizacao contratos_fiscalizacao_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contratos_fiscalizacao
    ADD CONSTRAINT contratos_fiscalizacao_pkey PRIMARY KEY (id);


--
-- Name: contratos contratos_numero_contrato_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contratos
    ADD CONSTRAINT contratos_numero_contrato_key UNIQUE (numero_contrato);


--
-- Name: contratos contratos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contratos
    ADD CONSTRAINT contratos_pkey PRIMARY KEY (id);


--
-- Name: contratos_resumo_financeiro contratos_resumo_financeiro_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contratos_resumo_financeiro
    ADD CONSTRAINT contratos_resumo_financeiro_pkey PRIMARY KEY (id);


--
-- Name: contratos_resumo_rh contratos_resumo_rh_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contratos_resumo_rh
    ADD CONSTRAINT contratos_resumo_rh_pkey PRIMARY KEY (id);


--
-- Name: contratos_vigentes contratos_vigentes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contratos_vigentes
    ADD CONSTRAINT contratos_vigentes_pkey PRIMARY KEY (id);


--
-- Name: cotacoes_impugnacoes cotacoes_impugnacoes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cotacoes_impugnacoes
    ADD CONSTRAINT cotacoes_impugnacoes_pkey PRIMARY KEY (id);


--
-- Name: demissoes_solicitadas demissoes_solicitadas_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.demissoes_solicitadas
    ADD CONSTRAINT demissoes_solicitadas_pkey PRIMARY KEY (id);


--
-- Name: demissoes_solicitadas demissoes_solicitadas_solicitacao_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.demissoes_solicitadas
    ADD CONSTRAINT demissoes_solicitadas_solicitacao_id_key UNIQUE (solicitacao_id);


--
-- Name: entrevistas_vagas entrevistas_vagas_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.entrevistas_vagas
    ADD CONSTRAINT entrevistas_vagas_pkey PRIMARY KEY (id);


--
-- Name: equipamentos_arquivos equipamentos_arquivos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.equipamentos_arquivos
    ADD CONSTRAINT equipamentos_arquivos_pkey PRIMARY KEY (id);


--
-- Name: equipamentos equipamentos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.equipamentos
    ADD CONSTRAINT equipamentos_pkey PRIMARY KEY (id);


--
-- Name: estoque_items estoque_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.estoque_items
    ADD CONSTRAINT estoque_items_pkey PRIMARY KEY (id);


--
-- Name: estoque_tags_consumo estoque_tags_consumo_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.estoque_tags_consumo
    ADD CONSTRAINT estoque_tags_consumo_pkey PRIMARY KEY (id);


--
-- Name: estoque_tags estoque_tags_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.estoque_tags
    ADD CONSTRAINT estoque_tags_pkey PRIMARY KEY (id);


--
-- Name: estoque_tags estoque_tags_tag_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.estoque_tags
    ADD CONSTRAINT estoque_tags_tag_id_key UNIQUE (tag_id);


--
-- Name: fornecedores fornecedores_cnpj_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fornecedores
    ADD CONSTRAINT fornecedores_cnpj_key UNIQUE (cnpj);


--
-- Name: fornecedores fornecedores_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fornecedores
    ADD CONSTRAINT fornecedores_pkey PRIMARY KEY (id);


--
-- Name: licitacoes licitacoes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.licitacoes
    ADD CONSTRAINT licitacoes_pkey PRIMARY KEY (id);


--
-- Name: lotes_alteracoes_catalogo lotes_alteracoes_catalogo_lote_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lotes_alteracoes_catalogo
    ADD CONSTRAINT lotes_alteracoes_catalogo_lote_id_key UNIQUE (lote_id);


--
-- Name: lotes_alteracoes_catalogo lotes_alteracoes_catalogo_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lotes_alteracoes_catalogo
    ADD CONSTRAINT lotes_alteracoes_catalogo_pkey PRIMARY KEY (id);


--
-- Name: manutencao_logs manutencao_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.manutencao_logs
    ADD CONSTRAINT manutencao_logs_pkey PRIMARY KEY (id);


--
-- Name: metas metas_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.metas
    ADD CONSTRAINT metas_pkey PRIMARY KEY (id);


--
-- Name: orcamentos orcamentos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orcamentos
    ADD CONSTRAINT orcamentos_pkey PRIMARY KEY (id);


--
-- Name: pedido_equipamentos pedido_equipamentos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pedido_equipamentos
    ADD CONSTRAINT pedido_equipamentos_pkey PRIMARY KEY (id);


--
-- Name: pedidos pedidos_pedido_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pedidos
    ADD CONSTRAINT pedidos_pedido_id_key UNIQUE (pedido_id);


--
-- Name: pedidos pedidos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pedidos
    ADD CONSTRAINT pedidos_pkey PRIMARY KEY (id);


--
-- Name: pedidos_site_externo pedidos_site_externo_pedido_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pedidos_site_externo
    ADD CONSTRAINT pedidos_site_externo_pedido_id_key UNIQUE (pedido_id);


--
-- Name: pedidos_site_externo pedidos_site_externo_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pedidos_site_externo
    ADD CONSTRAINT pedidos_site_externo_pkey PRIMARY KEY (id);


--
-- Name: powerbi_relatorios powerbi_relatorios_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.powerbi_relatorios
    ADD CONSTRAINT powerbi_relatorios_pkey PRIMARY KEY (id);


--
-- Name: sei_anexos sei_anexos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sei_anexos
    ADD CONSTRAINT sei_anexos_pkey PRIMARY KEY (id);


--
-- Name: sei_permissoes sei_permissoes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sei_permissoes
    ADD CONSTRAINT sei_permissoes_pkey PRIMARY KEY (id);


--
-- Name: sei_processos sei_processos_codigo_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sei_processos
    ADD CONSTRAINT sei_processos_codigo_key UNIQUE (codigo);


--
-- Name: sei_processos sei_processos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sei_processos
    ADD CONSTRAINT sei_processos_pkey PRIMARY KEY (id);


--
-- Name: sei_respostas sei_respostas_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sei_respostas
    ADD CONSTRAINT sei_respostas_pkey PRIMARY KEY (id);


--
-- Name: sei_visualizacoes sei_visualizacoes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sei_visualizacoes
    ADD CONSTRAINT sei_visualizacoes_pkey PRIMARY KEY (id);


--
-- Name: senhas_backup_crypto senhas_backup_crypto_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.senhas_backup_crypto
    ADD CONSTRAINT senhas_backup_crypto_pkey PRIMARY KEY (cpf);


--
-- Name: solicitacoes_vagas_auditoria solicitacoes_vagas_auditoria_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.solicitacoes_vagas_auditoria
    ADD CONSTRAINT solicitacoes_vagas_auditoria_pkey PRIMARY KEY (id);


--
-- Name: solicitacoes_vagas solicitacoes_vagas_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.solicitacoes_vagas
    ADD CONSTRAINT solicitacoes_vagas_pkey PRIMARY KEY (id);


--
-- Name: solicitacoes_vagas solicitacoes_vagas_solicitacao_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.solicitacoes_vagas
    ADD CONSTRAINT solicitacoes_vagas_solicitacao_id_key UNIQUE (solicitacao_id);


--
-- Name: solicitar_erp_anexos solicitar_erp_anexos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.solicitar_erp_anexos
    ADD CONSTRAINT solicitar_erp_anexos_pkey PRIMARY KEY (id);


--
-- Name: solicitar_erp solicitar_erp_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.solicitar_erp
    ADD CONSTRAINT solicitar_erp_pkey PRIMARY KEY (id);


--
-- Name: solicitar_setor_sistemas_anexos solicitar_setor_sistemas_anexos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.solicitar_setor_sistemas_anexos
    ADD CONSTRAINT solicitar_setor_sistemas_anexos_pkey PRIMARY KEY (id);


--
-- Name: solicitar_setor_sistemas solicitar_setor_sistemas_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.solicitar_setor_sistemas
    ADD CONSTRAINT solicitar_setor_sistemas_pkey PRIMARY KEY (id);


--
-- Name: tarefas tarefas_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tarefas
    ADD CONSTRAINT tarefas_pkey PRIMARY KEY (id);


--
-- Name: usuarios_permissoes usuarios_permissoes_login_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.usuarios_permissoes
    ADD CONSTRAINT usuarios_permissoes_login_key UNIQUE (login);


--
-- Name: usuarios_permissoes usuarios_permissoes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.usuarios_permissoes
    ADD CONSTRAINT usuarios_permissoes_pkey PRIMARY KEY (cpf);


--
-- Name: vagas vagas_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vagas
    ADD CONSTRAINT vagas_pkey PRIMARY KEY (id);


--
-- Name: veiculos_arquivos veiculos_arquivos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.veiculos_arquivos
    ADD CONSTRAINT veiculos_arquivos_pkey PRIMARY KEY (id);


--
-- Name: veiculos veiculos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.veiculos
    ADD CONSTRAINT veiculos_pkey PRIMARY KEY (id);


--
-- Name: whatsapp_conversas whatsapp_conversas_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.whatsapp_conversas
    ADD CONSTRAINT whatsapp_conversas_pkey PRIMARY KEY (id);


--
-- Name: whatsapp_mensagens whatsapp_mensagens_message_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.whatsapp_mensagens
    ADD CONSTRAINT whatsapp_mensagens_message_id_key UNIQUE (message_id);


--
-- Name: whatsapp_mensagens whatsapp_mensagens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.whatsapp_mensagens
    ADD CONSTRAINT whatsapp_mensagens_pkey PRIMARY KEY (id);


--
-- Name: whatsapp_webhook_logs whatsapp_webhook_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.whatsapp_webhook_logs
    ADD CONSTRAINT whatsapp_webhook_logs_pkey PRIMARY KEY (id);


--
-- Name: bd_negativo_cpf_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX bd_negativo_cpf_unique ON public.bd_negativo USING btree (cpf) WHERE ((cpf IS NOT NULL) AND ((cpf)::text <> ''::text));


--
-- Name: idx_alteracoes_catalogo_lote_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_alteracoes_catalogo_lote_id ON public.alteracoes_catalogo_site_externo USING btree (lote_id);


--
-- Name: idx_alteracoes_catalogo_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_alteracoes_catalogo_status ON public.alteracoes_catalogo_site_externo USING btree (status);


--
-- Name: idx_alteracoes_catalogo_tipo_entidade; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_alteracoes_catalogo_tipo_entidade ON public.alteracoes_catalogo_site_externo USING btree (tipo_entidade);


--
-- Name: idx_candidatos_cpf; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_candidatos_cpf ON public.candidatos USING btree (cpf);


--
-- Name: idx_candidatos_origem; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_candidatos_origem ON public.candidatos USING btree (origem);


--
-- Name: idx_candidatos_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_candidatos_status ON public.candidatos USING btree (status);


--
-- Name: idx_candidatos_telefone; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_candidatos_telefone ON public.candidatos USING btree (telefone_whatsapp);


--
-- Name: idx_candidatos_vagas_candidato; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_candidatos_vagas_candidato ON public.candidatos_vagas USING btree (candidato_id);


--
-- Name: idx_candidatos_vagas_data; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_candidatos_vagas_data ON public.candidatos_vagas USING btree (data_aplicacao);


--
-- Name: idx_candidatos_vagas_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_candidatos_vagas_status ON public.candidatos_vagas USING btree (status);


--
-- Name: idx_candidatos_vagas_vaga; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_candidatos_vagas_vaga ON public.candidatos_vagas USING btree (vaga_id);


--
-- Name: idx_compras_anexos_sol; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_compras_anexos_sol ON public.compras_anexos USING btree (solicitacao_id);


--
-- Name: idx_compras_hist_sol; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_compras_hist_sol ON public.compras_historico USING btree (solicitacao_id);


--
-- Name: idx_compras_sol_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_compras_sol_created_at ON public.compras_solicitacoes USING btree (created_at);


--
-- Name: idx_compras_sol_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_compras_sol_status ON public.compras_solicitacoes USING btree (status);


--
-- Name: idx_contrato; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contrato ON public.pedidos_site_externo USING btree (contrato);


--
-- Name: idx_contratos_anuais_datas; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contratos_anuais_datas ON public.contratos_anuais USING btree (data_inicio, data_fim);


--
-- Name: idx_contratos_anuais_empresa; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contratos_anuais_empresa ON public.contratos_anuais USING btree (empresa);


--
-- Name: idx_contratos_anuais_estado; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contratos_anuais_estado ON public.contratos_anuais USING btree (estado);


--
-- Name: idx_contratos_data_inicio; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contratos_data_inicio ON public.contratos USING btree (data_inicio DESC);


--
-- Name: idx_contratos_docs_contrato_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contratos_docs_contrato_id ON public.contratos_documentos USING btree (contrato_id);


--
-- Name: idx_contratos_docs_tipo; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contratos_docs_tipo ON public.contratos_documentos USING btree (tipo_documento);


--
-- Name: idx_contratos_documentos_contrato_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contratos_documentos_contrato_id ON public.contratos_documentos USING btree (contrato_id);


--
-- Name: idx_contratos_numero; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contratos_numero ON public.contratos USING btree (numero_contrato);


--
-- Name: idx_contratos_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contratos_status ON public.contratos USING btree (status);


--
-- Name: idx_contratos_vigentes_cidade; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contratos_vigentes_cidade ON public.contratos_vigentes USING btree (cidade);


--
-- Name: idx_contratos_vigentes_data_fim; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contratos_vigentes_data_fim ON public.contratos_vigentes USING btree (data_fim);


--
-- Name: idx_contratos_vigentes_empresa; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contratos_vigentes_empresa ON public.contratos_vigentes USING btree (empresa);


--
-- Name: idx_contratos_vigentes_numero_contrato; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contratos_vigentes_numero_contrato ON public.contratos_vigentes USING btree (numero_contrato);


--
-- Name: idx_contratos_vigentes_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contratos_vigentes_status ON public.contratos_vigentes USING btree (status);


--
-- Name: idx_contratos_vigentes_status_vigencia; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contratos_vigentes_status_vigencia ON public.contratos_vigentes USING btree (status_vigencia);


--
-- Name: idx_cotacoes_data_envio; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cotacoes_data_envio ON public.cotacoes_impugnacoes USING btree (data_envio DESC);


--
-- Name: idx_cotacoes_data_resposta; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cotacoes_data_resposta ON public.cotacoes_impugnacoes USING btree (data_resposta DESC);


--
-- Name: idx_cotacoes_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cotacoes_status ON public.cotacoes_impugnacoes USING btree (status);


--
-- Name: idx_cotacoes_tipo; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cotacoes_tipo ON public.cotacoes_impugnacoes USING btree (tipo);


--
-- Name: idx_data_solicitacao; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_data_solicitacao ON public.pedidos_site_externo USING btree (data_solicitacao);


--
-- Name: idx_documentos_contrato; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_documentos_contrato ON public.contratos_documentos USING btree (contrato_id);


--
-- Name: idx_documentos_tipo; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_documentos_tipo ON public.contratos_documentos USING btree (tipo_documento);


--
-- Name: idx_equipamentos_arquivos_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_equipamentos_arquivos_created_at ON public.equipamentos_arquivos USING btree (created_at DESC);


--
-- Name: idx_equipamentos_arquivos_equipamento_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_equipamentos_arquivos_equipamento_id ON public.equipamentos_arquivos USING btree (equipamento_id);


--
-- Name: idx_equipamentos_nome; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_equipamentos_nome ON public.equipamentos USING btree (nome);


--
-- Name: idx_estoque_items_contrato; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_estoque_items_contrato ON public.estoque_items USING btree (contrato_id);


--
-- Name: idx_estoque_items_estado; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_estoque_items_estado ON public.estoque_items USING btree (estado);


--
-- Name: idx_estoque_items_tipo; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_estoque_items_tipo ON public.estoque_items USING btree (tipo_item);


--
-- Name: idx_estoque_tags_item; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_estoque_tags_item ON public.estoque_tags USING btree (item_id);


--
-- Name: idx_estoque_tags_item_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_estoque_tags_item_id ON public.estoque_tags USING btree (item_id);


--
-- Name: idx_estoque_tags_pedido; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_estoque_tags_pedido ON public.estoque_tags USING btree (pedido_id);


--
-- Name: idx_estoque_tags_pedido_equipamento; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_estoque_tags_pedido_equipamento ON public.estoque_tags USING btree (pedido_id, equipamento_index);


--
-- Name: idx_estoque_tags_quantidade_massa; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_estoque_tags_quantidade_massa ON public.estoque_tags USING btree (quantidade_massa) WHERE ((tipo_tag)::text = 'massa'::text);


--
-- Name: idx_estoque_tags_tag_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_estoque_tags_tag_id ON public.estoque_tags USING btree (tag_id);


--
-- Name: idx_estoque_tags_tipo; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_estoque_tags_tipo ON public.estoque_tags USING btree (tipo_tag);


--
-- Name: idx_estoque_tags_tipo_tag; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_estoque_tags_tipo_tag ON public.estoque_tags USING btree (tipo_tag);


--
-- Name: idx_estoque_tags_usado; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_estoque_tags_usado ON public.estoque_tags USING btree (usado);


--
-- Name: idx_licitacoes_data; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_licitacoes_data ON public.licitacoes USING btree (data);


--
-- Name: idx_licitacoes_empresa; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_licitacoes_empresa ON public.licitacoes USING btree (empresa);


--
-- Name: idx_licitacoes_fase; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_licitacoes_fase ON public.licitacoes USING btree (fase);


--
-- Name: idx_licitacoes_responsavel; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_licitacoes_responsavel ON public.licitacoes USING btree (responsavel);


--
-- Name: idx_licitacoes_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_licitacoes_status ON public.licitacoes USING btree (status);


--
-- Name: idx_licitacoes_uf; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_licitacoes_uf ON public.licitacoes USING btree (uf);


--
-- Name: idx_lotes_alteracoes_data_envio; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_lotes_alteracoes_data_envio ON public.lotes_alteracoes_catalogo USING btree (data_envio DESC);


--
-- Name: idx_lotes_alteracoes_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_lotes_alteracoes_status ON public.lotes_alteracoes_catalogo USING btree (status);


--
-- Name: idx_metas_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_metas_created_at ON public.metas USING btree (created_at DESC);


--
-- Name: idx_nome_colaborador; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_nome_colaborador ON public.pedidos_site_externo USING btree (nome_colaborador);


--
-- Name: idx_orcamentos_contrato; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orcamentos_contrato ON public.orcamentos USING btree (contrato);


--
-- Name: idx_orcamentos_contrato_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orcamentos_contrato_id ON public.orcamentos USING btree (contrato_id);


--
-- Name: idx_pedido_contrato; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pedido_contrato ON public.pedidos USING btree (contrato);


--
-- Name: idx_pedido_data_criacao; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pedido_data_criacao ON public.pedidos USING btree (data_criacao DESC);


--
-- Name: idx_pedido_equipamentos_pedido_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pedido_equipamentos_pedido_id ON public.pedido_equipamentos USING btree (pedido_id);


--
-- Name: idx_pedido_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pedido_id ON public.pedidos USING btree (pedido_id);


--
-- Name: idx_pedido_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pedido_status ON public.pedidos USING btree (status);


--
-- Name: idx_pedidos_data_criacao; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pedidos_data_criacao ON public.pedidos USING btree (data_criacao DESC);


--
-- Name: idx_pedidos_pedido_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pedidos_pedido_id ON public.pedidos USING btree (pedido_id);


--
-- Name: idx_pedidos_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pedidos_status ON public.pedidos USING btree (status);


--
-- Name: idx_resumo_financeiro_contrato; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_resumo_financeiro_contrato ON public.contratos_resumo_financeiro USING btree (contrato_id);


--
-- Name: idx_resumo_rh_contrato; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_resumo_rh_contrato ON public.contratos_resumo_rh USING btree (contrato_id);


--
-- Name: idx_sei_permissoes_processo; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sei_permissoes_processo ON public.sei_permissoes USING btree (processo_id);


--
-- Name: idx_sei_processos_codigo; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sei_processos_codigo ON public.sei_processos USING btree (codigo);


--
-- Name: idx_sei_processos_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sei_processos_created_at ON public.sei_processos USING btree (created_at);


--
-- Name: idx_sei_processos_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sei_processos_status ON public.sei_processos USING btree (status);


--
-- Name: idx_sei_respostas_processo; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sei_respostas_processo ON public.sei_respostas USING btree (processo_id);


--
-- Name: idx_sei_viz_unico; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_sei_viz_unico ON public.sei_visualizacoes USING btree (resposta_id, usuario_nome);


--
-- Name: idx_senhas_backup_cpf; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_senhas_backup_cpf ON public.senhas_backup_crypto USING btree (cpf);


--
-- Name: idx_solicitacoes_vagas_auditoria_solicitacao; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_solicitacoes_vagas_auditoria_solicitacao ON public.solicitacoes_vagas_auditoria USING btree (solicitacao_id);


--
-- Name: idx_solicitacoes_vagas_cidade; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_solicitacoes_vagas_cidade ON public.solicitacoes_vagas USING btree (cidade);


--
-- Name: idx_solicitacoes_vagas_contrato; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_solicitacoes_vagas_contrato ON public.solicitacoes_vagas USING btree (contrato);


--
-- Name: idx_solicitacoes_vagas_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_solicitacoes_vagas_created_at ON public.solicitacoes_vagas USING btree (created_at DESC);


--
-- Name: idx_solicitacoes_vagas_grau_urgencia; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_solicitacoes_vagas_grau_urgencia ON public.solicitacoes_vagas USING btree (grau_urgencia);


--
-- Name: idx_solicitacoes_vagas_solicitacao_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_solicitacoes_vagas_solicitacao_id ON public.solicitacoes_vagas USING btree (solicitacao_id);


--
-- Name: idx_solicitacoes_vagas_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_solicitacoes_vagas_status ON public.solicitacoes_vagas USING btree (status);


--
-- Name: idx_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_status ON public.pedidos_site_externo USING btree (status);


--
-- Name: idx_tarefas_ativo; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tarefas_ativo ON public.tarefas USING btree (ativo);


--
-- Name: idx_tarefas_criado_por; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tarefas_criado_por ON public.tarefas USING btree (criado_por);


--
-- Name: idx_tarefas_prazo; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tarefas_prazo ON public.tarefas USING btree (prazo);


--
-- Name: idx_tarefas_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tarefas_status ON public.tarefas USING btree (status);


--
-- Name: idx_usuarios_permissoes_ativo; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_usuarios_permissoes_ativo ON public.usuarios_permissoes USING btree (ativo);


--
-- Name: idx_usuarios_permissoes_nome; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_usuarios_permissoes_nome ON public.usuarios_permissoes USING btree (nome);


--
-- Name: idx_usuarios_permissoes_setor; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_usuarios_permissoes_setor ON public.usuarios_permissoes USING btree (setor);


--
-- Name: idx_vagas_cidade; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vagas_cidade ON public.vagas USING btree (cidade);


--
-- Name: idx_vagas_funcao; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vagas_funcao ON public.vagas USING btree (funcao);


--
-- Name: idx_vagas_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vagas_status ON public.vagas USING btree (status);


--
-- Name: idx_veiculos_arquivos_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_veiculos_arquivos_created_at ON public.veiculos_arquivos USING btree (created_at DESC);


--
-- Name: idx_veiculos_arquivos_veiculo_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_veiculos_arquivos_veiculo_id ON public.veiculos_arquivos USING btree (veiculo_id);


--
-- Name: idx_veiculos_nome; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_veiculos_nome ON public.veiculos USING btree (nome);


--
-- Name: idx_webhook_logs_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_webhook_logs_created ON public.whatsapp_webhook_logs USING btree (created_at);


--
-- Name: idx_webhook_logs_processado; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_webhook_logs_processado ON public.whatsapp_webhook_logs USING btree (processado);


--
-- Name: idx_whatsapp_conversas_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_whatsapp_conversas_status ON public.whatsapp_conversas USING btree (status);


--
-- Name: idx_whatsapp_conversas_telefone; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_whatsapp_conversas_telefone ON public.whatsapp_conversas USING btree (telefone_whatsapp);


--
-- Name: idx_whatsapp_mensagens_conversa; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_whatsapp_mensagens_conversa ON public.whatsapp_mensagens USING btree (conversa_id);


--
-- Name: idx_whatsapp_mensagens_message_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_whatsapp_mensagens_message_id ON public.whatsapp_mensagens USING btree (message_id);


--
-- Name: idx_whatsapp_mensagens_telefone; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_whatsapp_mensagens_telefone ON public.whatsapp_mensagens USING btree (telefone_whatsapp);


--
-- Name: idx_whatsapp_mensagens_tipo; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_whatsapp_mensagens_tipo ON public.whatsapp_mensagens USING btree (tipo);


--
-- Name: vw_candidatos_completo _RETURN; Type: RULE; Schema: public; Owner: -
--

CREATE OR REPLACE VIEW public.vw_candidatos_completo AS
 SELECT c.id,
    c.nome_completo,
    c.cpf,
    c.telefone_whatsapp,
    c.email,
    c.cidade,
    c.estado,
    c.origem,
    c.status,
    count(cv.id) AS total_aplicacoes,
    max(cv.data_aplicacao) AS ultima_aplicacao,
    c.created_at
   FROM (public.candidatos c
     LEFT JOIN public.candidatos_vagas cv ON ((c.id = cv.candidato_id)))
  GROUP BY c.id;


--
-- Name: vw_pipeline_recrutamento _RETURN; Type: RULE; Schema: public; Owner: -
--

CREATE OR REPLACE VIEW public.vw_pipeline_recrutamento AS
 SELECT v.id AS vaga_id,
    v.titulo AS vaga_titulo,
    v.funcao,
    count(cv.id) FILTER (WHERE ((cv.status)::text = 'novo'::text)) AS etapa_1_novo,
    count(cv.id) FILTER (WHERE ((cv.status)::text = 'triagem'::text)) AS etapa_2_triagem,
    count(cv.id) FILTER (WHERE ((cv.status)::text = 'entrevista_agendada'::text)) AS etapa_3_entrevista,
    count(cv.id) FILTER (WHERE ((cv.status)::text = 'aprovado'::text)) AS etapa_4_aprovado,
    count(cv.id) FILTER (WHERE ((cv.status)::text = 'contratado'::text)) AS etapa_5_contratado,
    count(cv.id) FILTER (WHERE ((cv.status)::text = 'reprovado'::text)) AS rejeitados
   FROM (public.vagas v
     LEFT JOIN public.candidatos_vagas cv ON ((v.id = cv.vaga_id)))
  WHERE ((v.status)::text = 'ativa'::text)
  GROUP BY v.id;


--
-- Name: vw_vagas_resumo _RETURN; Type: RULE; Schema: public; Owner: -
--

CREATE OR REPLACE VIEW public.vw_vagas_resumo AS
 SELECT v.id,
    v.titulo,
    v.funcao,
    v.cidade,
    v.estado,
    v.status,
    count(cv.id) AS total_candidatos,
    count(cv.id) FILTER (WHERE ((cv.status)::text = 'novo'::text)) AS candidatos_novos,
    count(cv.id) FILTER (WHERE ((cv.status)::text = 'em_analise'::text)) AS candidatos_em_analise,
    count(cv.id) FILTER (WHERE ((cv.status)::text = 'aprovado'::text)) AS candidatos_aprovados,
    max(cv.data_aplicacao) AS ultima_aplicacao,
    v.created_at,
    v.updated_at
   FROM (public.vagas v
     LEFT JOIN public.candidatos_vagas cv ON ((v.id = cv.vaga_id)))
  GROUP BY v.id;


--
-- Name: pedidos_site_externo trigger_atualizar_pedidos_site_externo; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trigger_atualizar_pedidos_site_externo BEFORE UPDATE ON public.pedidos_site_externo FOR EACH ROW EXECUTE FUNCTION public.atualizar_data_atualizacao();


--
-- Name: candidatos update_candidatos_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_candidatos_updated_at BEFORE UPDATE ON public.candidatos FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: candidatos_vagas update_candidatos_vagas_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_candidatos_vagas_updated_at BEFORE UPDATE ON public.candidatos_vagas FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: solicitacoes_vagas update_solicitacoes_vagas_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_solicitacoes_vagas_updated_at BEFORE UPDATE ON public.solicitacoes_vagas FOR EACH ROW EXECUTE FUNCTION public.update_solicitacoes_vagas_updated_at();


--
-- Name: vagas update_vagas_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_vagas_updated_at BEFORE UPDATE ON public.vagas FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: candidatos_vagas candidatos_vagas_candidato_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.candidatos_vagas
    ADD CONSTRAINT candidatos_vagas_candidato_id_fkey FOREIGN KEY (candidato_id) REFERENCES public.candidatos(id) ON DELETE CASCADE;


--
-- Name: candidatos_vagas candidatos_vagas_vaga_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.candidatos_vagas
    ADD CONSTRAINT candidatos_vagas_vaga_id_fkey FOREIGN KEY (vaga_id) REFERENCES public.vagas(id) ON DELETE CASCADE;


--
-- Name: compras_anexos compras_anexos_historico_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.compras_anexos
    ADD CONSTRAINT compras_anexos_historico_id_fkey FOREIGN KEY (historico_id) REFERENCES public.compras_historico(id) ON DELETE SET NULL;


--
-- Name: compras_anexos compras_anexos_solicitacao_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.compras_anexos
    ADD CONSTRAINT compras_anexos_solicitacao_id_fkey FOREIGN KEY (solicitacao_id) REFERENCES public.compras_solicitacoes(id) ON DELETE CASCADE;


--
-- Name: compras_historico compras_historico_solicitacao_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.compras_historico
    ADD CONSTRAINT compras_historico_solicitacao_id_fkey FOREIGN KEY (solicitacao_id) REFERENCES public.compras_solicitacoes(id) ON DELETE CASCADE;


--
-- Name: contratos_aditivos contratos_aditivos_contrato_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contratos_aditivos
    ADD CONSTRAINT contratos_aditivos_contrato_id_fkey FOREIGN KEY (contrato_id) REFERENCES public.contratos(id) ON DELETE CASCADE;


--
-- Name: contratos_documentos contratos_documentos_contrato_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contratos_documentos
    ADD CONSTRAINT contratos_documentos_contrato_id_fkey FOREIGN KEY (contrato_id) REFERENCES public.contratos(id) ON DELETE CASCADE;


--
-- Name: contratos_fiscalizacao contratos_fiscalizacao_contrato_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contratos_fiscalizacao
    ADD CONSTRAINT contratos_fiscalizacao_contrato_id_fkey FOREIGN KEY (contrato_id) REFERENCES public.contratos(id) ON DELETE CASCADE;


--
-- Name: contratos contratos_fornecedor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contratos
    ADD CONSTRAINT contratos_fornecedor_id_fkey FOREIGN KEY (fornecedor_id) REFERENCES public.fornecedores(id);


--
-- Name: contratos_resumo_financeiro contratos_resumo_financeiro_contrato_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contratos_resumo_financeiro
    ADD CONSTRAINT contratos_resumo_financeiro_contrato_id_fkey FOREIGN KEY (contrato_id) REFERENCES public.contratos(id) ON DELETE CASCADE;


--
-- Name: contratos_resumo_rh contratos_resumo_rh_contrato_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contratos_resumo_rh
    ADD CONSTRAINT contratos_resumo_rh_contrato_id_fkey FOREIGN KEY (contrato_id) REFERENCES public.contratos(id) ON DELETE CASCADE;


--
-- Name: equipamentos_arquivos equipamentos_arquivos_equipamento_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.equipamentos_arquivos
    ADD CONSTRAINT equipamentos_arquivos_equipamento_id_fkey FOREIGN KEY (equipamento_id) REFERENCES public.equipamentos(id) ON DELETE CASCADE;


--
-- Name: estoque_tags estoque_tags_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.estoque_tags
    ADD CONSTRAINT estoque_tags_item_id_fkey FOREIGN KEY (item_id) REFERENCES public.estoque_items(id) ON DELETE CASCADE;


--
-- Name: pedido_equipamentos fk_pedido; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pedido_equipamentos
    ADD CONSTRAINT fk_pedido FOREIGN KEY (pedido_id) REFERENCES public.pedidos(id) ON DELETE CASCADE;


--
-- Name: solicitacoes_vagas_auditoria fk_solicitacao_auditoria; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.solicitacoes_vagas_auditoria
    ADD CONSTRAINT fk_solicitacao_auditoria FOREIGN KEY (solicitacao_id) REFERENCES public.solicitacoes_vagas(solicitacao_id) ON DELETE CASCADE;


--
-- Name: sei_anexos sei_anexos_processo_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sei_anexos
    ADD CONSTRAINT sei_anexos_processo_id_fkey FOREIGN KEY (processo_id) REFERENCES public.sei_processos(id) ON DELETE CASCADE;


--
-- Name: sei_anexos sei_anexos_resposta_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sei_anexos
    ADD CONSTRAINT sei_anexos_resposta_id_fkey FOREIGN KEY (resposta_id) REFERENCES public.sei_respostas(id) ON DELETE SET NULL;


--
-- Name: sei_permissoes sei_permissoes_processo_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sei_permissoes
    ADD CONSTRAINT sei_permissoes_processo_id_fkey FOREIGN KEY (processo_id) REFERENCES public.sei_processos(id) ON DELETE CASCADE;


--
-- Name: sei_respostas sei_respostas_processo_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sei_respostas
    ADD CONSTRAINT sei_respostas_processo_id_fkey FOREIGN KEY (processo_id) REFERENCES public.sei_processos(id) ON DELETE CASCADE;


--
-- Name: sei_visualizacoes sei_visualizacoes_processo_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sei_visualizacoes
    ADD CONSTRAINT sei_visualizacoes_processo_id_fkey FOREIGN KEY (processo_id) REFERENCES public.sei_processos(id) ON DELETE CASCADE;


--
-- Name: sei_visualizacoes sei_visualizacoes_resposta_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sei_visualizacoes
    ADD CONSTRAINT sei_visualizacoes_resposta_id_fkey FOREIGN KEY (resposta_id) REFERENCES public.sei_respostas(id) ON DELETE CASCADE;


--
-- Name: senhas_backup_crypto senhas_backup_crypto_cpf_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.senhas_backup_crypto
    ADD CONSTRAINT senhas_backup_crypto_cpf_fkey FOREIGN KEY (cpf) REFERENCES public.usuarios_permissoes(cpf) ON DELETE CASCADE;


--
-- Name: solicitar_erp_anexos solicitar_erp_anexos_solicitacao_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.solicitar_erp_anexos
    ADD CONSTRAINT solicitar_erp_anexos_solicitacao_id_fkey FOREIGN KEY (solicitacao_id) REFERENCES public.solicitar_erp(id) ON DELETE CASCADE;


--
-- Name: solicitar_setor_sistemas_anexos solicitar_setor_sistemas_anexos_solicitacao_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.solicitar_setor_sistemas_anexos
    ADD CONSTRAINT solicitar_setor_sistemas_anexos_solicitacao_id_fkey FOREIGN KEY (solicitacao_id) REFERENCES public.solicitar_setor_sistemas(id) ON DELETE CASCADE;


--
-- Name: veiculos_arquivos veiculos_arquivos_veiculo_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.veiculos_arquivos
    ADD CONSTRAINT veiculos_arquivos_veiculo_id_fkey FOREIGN KEY (veiculo_id) REFERENCES public.veiculos(id) ON DELETE CASCADE;


--
-- Name: whatsapp_conversas whatsapp_conversas_candidato_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.whatsapp_conversas
    ADD CONSTRAINT whatsapp_conversas_candidato_id_fkey FOREIGN KEY (candidato_id) REFERENCES public.candidatos(id) ON DELETE SET NULL;


--
-- Name: whatsapp_mensagens whatsapp_mensagens_conversa_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.whatsapp_mensagens
    ADD CONSTRAINT whatsapp_mensagens_conversa_id_fkey FOREIGN KEY (conversa_id) REFERENCES public.whatsapp_conversas(id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--

\unrestrict nNc1DqRjXTfbGi2P8PWynloAdy2elDttsW4scsurz0gftlC0kod6ewtlcUTdQLI

