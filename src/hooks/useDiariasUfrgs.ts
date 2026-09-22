import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useDebounce } from "@/hooks/useDebounce";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { NovaParcela, RateioLinha, uploadAnexoMalote } from "@/hooks/useMaloteDespesa";
import {
  AnexoDiariaUfrgs,
  DiariaUfrgs,
  LotacaoUfrgs,
  PostoUfrgs,
  RascunhoTarifaUfrgs,
  StatusSolicitacao,
  TarifaUfrgs,
} from "@/pages/operacional/diariasUfrgs";
import { VisualizacaoDiaria } from "@/pages/operacional/diarias";

/**
 * Diárias UFRGS — o segundo tipo do Controle de Diárias.
 *
 * Backend em supabase/migrations/20260930000155_diarias_ufrgs.sql. Mesmo
 * desenho de src/hooks/useDiarias.ts: leitura por PostgREST (a RLS recorta),
 * escrita SEMPRE por RPC — as tabelas DIARIA_UFRGS_* só têm GRANT SELECT,
 * porque as validações e as fórmulas vivem no banco.
 *
 * As tabelas e RPCs desta entrega não estão em
 * src/integrations/supabase/types.ts (que é gerado à mão, fora do CI), então
 * as chamadas passam pelo `sb` destipado — mesmo padrão de useDiarias.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as any;
// O bucket é o mesmo da diária de diarista, com prefixo próprio de pasta: as
// policies de storage de lá já passam por diaria_pode(), e um bucket novo só
// duplicaria três policies idênticas (ver 20260930000155, seção 6).
const BUCKET = "diarias";
const PASTA = "ufrgs";

const paraReais = (centavos: number | string | null | undefined) => (Number(centavos) || 0) / 100;

/** Colunas da tarifa que existem desde a 20260930000155. */
const COLUNAS_TARIFA =
  "id, sindicato, vigencia_inicio, hospedagem_centavos, cafe_centavos, almoco_centavos, janta_centavos, va_centavos, aliquota_pis, aliquota_cofins, aliquota_iss, ativo";
/** As da trilha de edição pela tela, que chegaram na 20260930000212. */
const COLUNAS_TARIFA_TRILHA = ", motivo, atualizado_em, atualizado_por_nome";
const numero = (v: number | string | null | undefined) => Number(v) || 0;

export interface NovaDiariaUfrgs {
  contratoId: string;
  codFornecedor: string;
  matricula: string;
  motoristaEmpregadoId: number | null;
  motoristaNome: string;
  sindicato: string;
  lotacao: string;
  numeroOficio: string;
  saida: string;
  retorno: string;
  destino: string;
  posto: string;
  valorPostoVariavelCentavos: number;
  qtHospedagem: number;
  qtCafe: number;
  qtAlmoco: number;
  qtJanta: number;
  qtVa: number;
  observacoes: string;
  anexos: File[];
}

/** A edição manda a diária inteira outra vez, mais o que fazer com os anexos. */
export interface EdicaoDiariaUfrgs extends NovaDiariaUfrgs {
  uuid: string;
  anexosRemovidos: string[];
}

export interface MotoristaUfrgs {
  id: number;
  nome: string;
  /** EMPREGADOS."Cadastro" — é ela que preenche a coluna "Matr.". */
  matricula: string;
  cargo: string | null;
  situacao: string | null;
}

export interface DespesaMaloteUfrgs {
  nome: string;
  valor_total: number;
  data_pagamento: string | null;
  competencia: string | null;
  forma_pagamento: string | null;
  informacoes_pagamento: string | null;
  excecao?: boolean;
  justificativa_excecao?: string | null;
  parcelado?: boolean;
  numero_parcelas?: number | null;
  dia_desconto?: number | null;
  rateio?: RateioLinha[];
  parcelas?: NovaParcela[];
  arquivosNovos: File[];
}

interface AnexoUfrgsBanco {
  storage_path: string;
  nome_arquivo: string | null;
  mime_type: string | null;
  tamanho_bytes: number | string | null;
  created_at: string;
}

interface DiariaUfrgsBanco {
  id: string;
  numero: string | null;
  status: Exclude<StatusSolicitacao, "paga">;
  /** Campo computado: a despesa do Malote gerada no envio já foi paga. */
  malote_despesa_paga: boolean | null;
  /** Campo computado: a data em que a despesa foi paga = Data de Depósito. */
  diaria_ufrgs_data_deposito: string | null;
  contrato_id: string;
  contrato_nome: string | null;
  contrato_cliente: string | null;
  contrato_empresa: string | null;
  competencia: string;
  cod_fornecedor: string | null;
  matricula: string | null;
  motorista_empregado_id: number | string | null;
  motorista_nome: string;
  sindicato: string;
  lotacao: string;
  numero_oficio: string;
  saida: string;
  retorno: string;
  destino: string;
  posto: string | null;
  valor_posto_variavel_centavos: number | string | null;
  qt_hospedagem: number | string | null;
  qt_cafe: number | string | null;
  qt_almoco: number | string | null;
  qt_janta: number | string | null;
  qt_va: number | string | null;
  fiscal: string | null;
  tarifa_id: string | null;
  aliquota_total: number | string | null;
  valor_total_centavos: number | string | null;
  valor_va_centavos: number | string | null;
  valor_liquido_centavos: number | string | null;
  tributos_centavos: number | string | null;
  valor_faturar_centavos: number | string | null;
  observacoes: string | null;
  solicitante_id: string;
  solicitante_nome: string | null;
  malote_despesa_id: string | null;
  malote_motivo: string | null;
  malote_data_pagamento: string | null;
  enviado_malote_em: string | null;
  decidido_por_nome: string | null;
  decidido_em: string | null;
  ajuste_motivo: string | null;
  ajuste_pedido_por_nome: string | null;
  ajuste_pedido_em: string | null;
  exclusao_motivo: string | null;
  excluida_por_nome: string | null;
  excluida_em: string | null;
  created_at: string;
  anexos: AnexoUfrgsBanco[] | null;
  posto_ref: { descricao: string | null } | null;
}

const SELECT_UFRGS = `
  id, numero, status, malote_despesa_paga, diaria_ufrgs_data_deposito,
  contrato_id, contrato_nome, contrato_cliente, contrato_empresa, competencia,
  cod_fornecedor, matricula, motorista_empregado_id, motorista_nome,
  sindicato, lotacao, numero_oficio, saida, retorno, destino, posto,
  valor_posto_variavel_centavos, qt_hospedagem, qt_cafe, qt_almoco, qt_janta, qt_va,
  fiscal, tarifa_id, aliquota_total,
  valor_total_centavos, valor_va_centavos, valor_liquido_centavos,
  tributos_centavos, valor_faturar_centavos,
  observacoes, solicitante_id, solicitante_nome,
  malote_despesa_id, malote_motivo, malote_data_pagamento, enviado_malote_em,
  decidido_por_nome, decidido_em,
  ajuste_motivo, ajuste_pedido_por_nome, ajuste_pedido_em,
  exclusao_motivo, excluida_por_nome, excluida_em, created_at,
  anexos:DIARIA_UFRGS_ANEXO ( storage_path, nome_arquivo, mime_type, tamanho_bytes, created_at ),
  posto_ref:DIARIA_UFRGS_POSTO ( descricao )
`;

// ── Consultas ────────────────────────────────────────────────────────

/**
 * Tarifas por sindicato. É delas que sai o Valor Total enquanto a pessoa
 * digita — o banco recalcula tudo na gravação, mas sem isto o modal não
 * conseguiria mostrar um total antes de salvar.
 *
 * Traz as DESATIVADAS junto (o `.eq("ativo", true)` saiu em 22/09/2026):
 * quem consome para calcular filtra em tarifaVigente(), e o modal de tarifas
 * precisa delas para mostrar o histórico riscado. Uma consulta só para os
 * dois usos — duas chaves de cache dariam telas discordando sobre qual
 * tabela está em vigor logo depois de alguém salvar.
 */
export function useTarifasUfrgs() {
  return useQuery({
    queryKey: ["diaria_ufrgs_tarifas"],
    staleTime: 30 * 60_000,
    queryFn: async (): Promise<TarifaUfrgs[]> => {
      const buscar = (colunas: string) =>
        sb
          .from("DIARIA_UFRGS_TARIFA")
          .select(colunas)
          .order("sindicato")
          .order("vigencia_inicio", { ascending: false });

      let { data, error } = await buscar(COLUNAS_TARIFA + COLUNAS_TARIFA_TRILHA);
      // 42703 = "column does not exist". É a JANELA entre subir o front e
      // rodar a 20260930000212 no SQL Editor — migration neste projeto não se
      // aplica sozinha ao mergear. Sem este ramo, aquela janela deixaria a
      // consulta de tarifas em erro, e SEM TARIFA o modal da diária não
      // calcula nada: o bloco 4 inteiro para para todo mundo por causa de
      // três colunas que só servem para mostrar quem editou.
      if (error?.code === "42703") ({ data, error } = await buscar(COLUNAS_TARIFA));
      if (error) throw error;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return ((data ?? []) as any[]).map((t) => ({
        id: t.id,
        sindicato: t.sindicato,
        vigenciaInicio: t.vigencia_inicio,
        hospedagemCentavos: numero(t.hospedagem_centavos),
        cafeCentavos: numero(t.cafe_centavos),
        almocoCentavos: numero(t.almoco_centavos),
        jantaCentavos: numero(t.janta_centavos),
        vaCentavos: numero(t.va_centavos),
        aliquotaPis: numero(t.aliquota_pis),
        aliquotaCofins: numero(t.aliquota_cofins),
        aliquotaIss: numero(t.aliquota_iss),
        ativo: t.ativo !== false,
        motivo: t.motivo ?? null,
        atualizadoEm: t.atualizado_em ? new Date(t.atualizado_em).toLocaleString("pt-BR") : null,
        atualizadoPorNome: t.atualizado_por_nome ?? null,
      }));
    },
  });
}

/** O que a RPC devolve depois de gravar uma tarifa. */
export interface ResultadoTarifaUfrgs {
  /** false quando a data já tinha linha e o que houve foi correção. */
  criada: boolean;
  /** Diárias em aberto que o banco recalculou na mesma transação. */
  recalculadas: number;
  /** Aprovadas/pagas na mesma janela, que continuam com o valor antigo. */
  congeladas: number;
}

/**
 * Salvar uma tarifa — o pedido de 22/09/2026, "o próprio usuário final com
 * permissão pode editar os valores dos sindicatos".
 *
 * Escrita por RPC, como todo o resto deste módulo: "DIARIA_UFRGS_TARIFA" só
 * tem GRANT SELECT, e quem autoriza é diaria_ufrgs_tarifa_pode() (a chave
 * 'financeiro_diarias_tarifas' do Gerenciamento de Acesso), não a tela.
 *
 * Invalida as DIÁRIAS junto porque a gravação recalcula as que estão em
 * aberto: sem isso a lista continuaria mostrando o valor velho até o próximo
 * F5, que é exatamente a desconfiança que o pedido quer eliminar.
 */
export function useSalvarTarifaUfrgs() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: RascunhoTarifaUfrgs & { motivo?: string }): Promise<ResultadoTarifaUfrgs> => {
      const { data, error } = await sb.rpc("diaria_ufrgs_tarifa_salvar", {
        p_dados: {
          sindicato: input.sindicato.trim(),
          vigencia_inicio: input.vigenciaInicio,
          hospedagem_centavos: input.hospedagemCentavos,
          cafe_centavos: input.cafeCentavos,
          almoco_centavos: input.almocoCentavos,
          janta_centavos: input.jantaCentavos,
          va_centavos: input.vaCentavos,
          aliquota_pis: input.aliquotaPis,
          aliquota_cofins: input.aliquotaCofins,
          aliquota_iss: input.aliquotaIss,
          motivo: input.motivo ?? "",
        },
      });
      if (error) throw error;
      return {
        criada: !!data?.criada,
        recalculadas: numero(data?.recalculadas),
        congeladas: numero(data?.congeladas),
      };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["diaria_ufrgs_tarifas"] });
      qc.invalidateQueries({ queryKey: ["diarias_ufrgs"] });
    },
  });
}

/**
 * Remover uma vigência. Desativa, não apaga — a diária lançada nela aponta
 * para a linha e precisa continuar explicando o valor faturado.
 *
 * Existe por causa do erro que só a TELA cria: salvar a tabela certa na data
 * errada. O banco recusa se for a única tabela do sindicato ou se deixar
 * diária em aberto sem nenhuma vigência anterior para cair.
 */
export function useRemoverTarifaUfrgs() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string): Promise<number> => {
      const { data, error } = await sb.rpc("diaria_ufrgs_tarifa_remover", { p_id: id });
      if (error) throw error;
      return numero(data?.recalculadas);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["diaria_ufrgs_tarifas"] });
      qc.invalidateQueries({ queryKey: ["diarias_ufrgs"] });
    },
  });
}

/** Lotações do dropdown, cada uma já com o fiscal que a tela preenche sozinha. */
export function useLotacoesUfrgs() {
  return useQuery({
    queryKey: ["diaria_ufrgs_lotacoes"],
    staleTime: 30 * 60_000,
    queryFn: async (): Promise<LotacaoUfrgs[]> => {
      const { data, error } = await sb
        .from("DIARIA_UFRGS_LOTACAO")
        .select("lotacao, fiscal")
        .eq("ativo", true)
        .order("ordem");
      if (error) throw error;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return ((data ?? []) as any[]).map((l) => ({ lotacao: l.lotacao, fiscal: l.fiscal }));
    },
  });
}

/** Postos/cargos do contrato — o código da coluna "Posto" e a localidade. */
export function usePostosUfrgs() {
  return useQuery({
    queryKey: ["diaria_ufrgs_postos"],
    staleTime: 30 * 60_000,
    queryFn: async (): Promise<PostoUfrgs[]> => {
      const { data, error } = await sb
        .from("DIARIA_UFRGS_POSTO")
        .select("codigo, descricao, localidade, ordem")
        .eq("ativo", true)
        .order("ordem");
      if (error) throw error;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return ((data ?? []) as any[]).map((p) => ({
        codigo: p.codigo,
        descricao: p.descricao,
        localidade: p.localidade,
        ordem: numero(p.ordem),
      }));
    },
  });
}

/** Piso de caracteres para consultar EMPREGADOS — o mesmo checado na RPC. */
export const MIN_BUSCA_MOTORISTA = 3;

/**
 * Busca de motorista. A RPC devolve a MATRÍCULA junto, que é o que preenche
 * a coluna "Matr." — na planilha isso era uma XLOOKUP que quebrava (sete
 * linhas do mês entregue mostram " FALSO" porque o nome digitado não batia
 * com a tabela de apoio).
 */
export function useBuscaMotoristasUfrgs(termo: string) {
  // 21/09/2026: debounce pra uma consulta por palavra, não por tecla digitada.
  // Soma com o piso de caracteres logo abaixo — um corta repetição, o outro
  // corta busca ampla demais.
  const busca = useDebounce(termo.trim());
  return useQuery({
    queryKey: ["diaria_ufrgs_motoristas", busca],
    enabled: busca.length >= MIN_BUSCA_MOTORISTA,
    staleTime: 60_000,
    queryFn: async (): Promise<MotoristaUfrgs[]> => {
      const { data, error } = await sb.rpc("diaria_ufrgs_buscar_motoristas", { p_termo: busca });
      if (error) throw error;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return ((data ?? []) as any[]).map((e) => ({
        id: Number(e.empregado_id),
        nome: e.nome ?? "",
        matricula: e.matricula ?? "",
        cargo: e.cargo ?? null,
        situacao: e.situacao ?? null,
      }));
    },
  });
}

/**
 * Todas as diárias UFRGS que o usuário enxerga. Base inteira, como na diária
 * de diarista: filtros, paginação, exportação e aviso de sobreposição são
 * calculados em cima dela.
 *
 * `apenasMinhas` existe pela mesma razão de useSolicitacoesDiaria: a rota de
 * Encarregados é "minhas solicitações", e isso é da ROTA, não da permissão.
 */
export function useDiariasUfrgs(apenasMinhas = false) {
  const { user } = useAuth();
  const meuId = user?.id ?? null;
  return useQuery({
    queryKey: ["diarias_ufrgs", apenasMinhas ? meuId : "todas"],
    enabled: !apenasMinhas || !!meuId,
    queryFn: async (): Promise<DiariaUfrgs[]> => {
      let q = sb
        .from("DIARIA_UFRGS")
        .select(SELECT_UFRGS)
        .order("created_at", { ascending: false })
        .limit(5000);
      if (apenasMinhas && meuId) q = q.eq("solicitante_id", meuId);
      const { data, error } = await q;
      if (error) throw error;
      return ((data ?? []) as DiariaUfrgsBanco[]).map(mapearDiariaUfrgs);
    },
  });
}

/**
 * Quem já abriu esta diária. Consulta própria, por diária — o pedido é
 * mostrar isso no PÉ da diária aberta, e pendurar a tabela na lista (até
 * 5000 linhas com anexos aninhados) sairia caro em toda abertura de tela.
 */
export function useVisualizacoesUfrgs(diariaId: string | null | undefined) {
  return useQuery({
    queryKey: ["diaria_ufrgs_visualizacoes", diariaId],
    enabled: !!diariaId,
    queryFn: async (): Promise<VisualizacaoDiaria[]> => {
      const { data, error } = await sb
        .from("DIARIA_UFRGS_VISUALIZACAO")
        .select("user_id, user_nome, visualizada_em")
        .eq("diaria_id", diariaId)
        .order("visualizada_em", { ascending: false });
      if (error) throw error;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return ((data ?? []) as any[]).map((v) => ({
        userId: v.user_id,
        nome: v.user_nome ?? "Usuário",
        quando: new Date(v.visualizada_em)
          .toLocaleString("pt-BR", {
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          })
          // "16/09/2026, 09:24" → "16/09/2026 - 09:24", o formato pedido.
          .replace(", ", " - "),
      }));
    },
  });
}

/** A trilha da diária — criada, editada, aprovada, devolvida, excluída. */
export interface EventoDiariaUfrgs {
  id: string;
  tipo: string;
  descricao: string;
  autor: string;
  quando: string;
}

export function useEventosUfrgs(diariaId: string | null | undefined) {
  return useQuery({
    queryKey: ["diaria_ufrgs_eventos", diariaId],
    enabled: !!diariaId,
    queryFn: async (): Promise<EventoDiariaUfrgs[]> => {
      const { data, error } = await sb
        .from("DIARIA_UFRGS_EVENTO")
        .select("id, tipo, descricao, autor_nome, created_at")
        .eq("diaria_id", diariaId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return ((data ?? []) as any[]).map((e) => ({
        id: e.id,
        tipo: e.tipo,
        descricao: e.descricao ?? "",
        autor: e.autor_nome ?? "—",
        quando: new Date(e.created_at)
          .toLocaleString("pt-BR", {
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          })
          .replace(", ", " - "),
      }));
    },
  });
}

/**
 * Carimba que o usuário logado abriu a diária, "independente da rota" — é o
 * pedido. A RPC grava só a PRIMEIRA vez (ON CONFLICT DO NOTHING), então
 * chamar a cada abertura de modal é barato e idempotente.
 */
export function useRegistrarVisualizacaoUfrgs() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (diariaId: string) => {
      const { error } = await sb.rpc("diaria_ufrgs_registrar_visualizacao", {
        p_diaria_id: diariaId,
      });
      if (error) throw error;
      return diariaId;
    },
    onSuccess: (diariaId) =>
      qc.invalidateQueries({ queryKey: ["diaria_ufrgs_visualizacoes", diariaId] }),
    // Sem onError: registrar leitura é telemetria. Uma falha aqui não pode
    // virar toast vermelho por cima de uma diária que abriu normalmente.
  });
}

// ── Escritas ─────────────────────────────────────────────────────────

/**
 * Cria a diária. Os arquivos sobem primeiro (o caminho no bucket é
 * diarias/ufrgs/<id>/..., por isso o id é gerado aqui) e só então a RPC
 * grava cabeçalho e anexos numa transação só. Se a RPC recusar, os objetos
 * recém-enviados são removidos — upload e INSERT não compartilham transação.
 */
export function useCriarDiariaUfrgs() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: NovaDiariaUfrgs) => {
      const id = crypto.randomUUID();
      let enviados: AnexoEnviado[] = [];
      try {
        enviados = await enviarArquivos(id, input.anexos);
        const { data, error } = await sb.rpc("diaria_ufrgs_criar", {
          p_dados: { id, ...payloadDiaria(input), anexos: enviados },
        });
        if (error) throw error;
        const linha = Array.isArray(data) ? data[0] : data;
        return { id, numero: (linha?.numero as string) ?? "" };
      } catch (erro) {
        await removerSilenciosamente(enviados.map((a) => a.storage_path));
        throw erro;
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["diarias_ufrgs"] }),
  });
}

/**
 * Editar. Mesma coreografia da criação ao contrário: os arquivos NOVOS sobem
 * antes, a RPC grava numa transação, e só DEPOIS de ela aceitar é que os
 * removidos saem do Storage. Apagar antes deixaria a diária sem anexo caso a
 * RPC recusasse — e não há como desfazer um delete de bucket.
 */
export function useEditarDiariaUfrgs() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: EdicaoDiariaUfrgs) => {
      let enviados: AnexoEnviado[] = [];
      try {
        enviados = await enviarArquivos(input.uuid, input.anexos);
        const { error } = await sb.rpc("diaria_ufrgs_editar", {
          p_dados: {
            id: input.uuid,
            ...payloadDiaria(input),
            anexos_novos: enviados,
            anexos_removidos: input.anexosRemovidos,
          },
        });
        if (error) throw error;
        await removerSilenciosamente(input.anexosRemovidos);
      } catch (erro) {
        await removerSilenciosamente(enviados.map((a) => a.storage_path));
        throw erro;
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["diarias_ufrgs"] }),
  });
}

/** Aprovar ou reprovar, sem tocar no Malote. */
export function useDecidirDiariaUfrgs() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      id: string;
      status: Extract<StatusSolicitacao, "aprovada" | "reprovada">;
    }) => {
      const { error } = await sb.rpc("diaria_ufrgs_decidir", {
        p_diaria_id: input.id,
        p_status: input.status,
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["diarias_ufrgs"] }),
  });
}

/**
 * Enviar para o Malote (com ou sem aprovar na mesma ação — a RPC decide pelo
 * status atual). A despesa, o rateio e as parcelas nascem na mesma transação
 * em que a diária muda; os anexos vão depois, porque o caminho no Storage
 * depende do id devolvido pela RPC.
 */
export function useEnviarMaloteUfrgs() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; despesa: DespesaMaloteUfrgs }) => {
      const { arquivosNovos, ...pDespesa } = input.despesa;
      const { data, error } = await sb.rpc("diaria_ufrgs_enviar_malote", {
        p_diaria_id: input.id,
        p_despesa: pDespesa,
      });
      if (error) throw error;
      const despesaId = typeof data === "string" ? data : (data?.id as string | undefined);
      if (!despesaId) throw new Error("O envio não devolveu o id da despesa criada.");

      // Os anexos da diária seguem para a despesa (SIS-2026-0287 fez o mesmo
      // na diária de diarista): eles são a papelada que o aprovador do Malote
      // precisa ver, e o bucket "diarias" exige permissão de Diárias, que a
      // Controladoria normalmente não tem. Cópia, não referência.
      const { paths: daDiaria, falhas } = await copiarAnexosParaMalote(input.id, despesaId);
      const resultados = await Promise.allSettled(
        (arquivosNovos ?? []).map((arquivo) => uploadAnexoMalote(arquivo, despesaId)),
      );
      const doAprovador = resultados
        .filter((r): r is PromiseFulfilledResult<string> => r.status === "fulfilled")
        .map((r) => r.value);
      const paths = [...daDiaria, ...doAprovador];
      let anexosComFalha = falhas.length > 0 || resultados.some((r) => r.status === "rejected");
      if (paths.length > 0) {
        const { error: erroAnexos } = await sb
          .from("malote_despesa")
          .update({ arquivos: paths })
          .eq("id", despesaId)
          .select("id")
          .single();
        anexosComFalha = anexosComFalha || !!erroAnexos;
      }
      return { despesaId, anexosComFalha, falhas };
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["diarias_ufrgs"] }),
  });
}

export function useSolicitarAjusteUfrgs() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; motivo: string }) => {
      const { error } = await sb.rpc("diaria_ufrgs_solicitar_ajuste", {
        p_diaria_id: input.id,
        p_motivo: input.motivo,
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["diarias_ufrgs"] }),
  });
}

/** Excluir — LOGICAMENTE. A linha continua no banco e some da lista. */
export function useExcluirDiariaUfrgs() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; motivo: string }) => {
      const { error } = await sb.rpc("diaria_ufrgs_excluir", {
        p_diaria_id: input.id,
        p_motivo: input.motivo,
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["diarias_ufrgs"] }),
  });
}

/** Link temporário para abrir um anexo — o bucket é privado. */
export async function urlAnexoUfrgs(storagePath: string) {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(storagePath, 300);
  if (error) throw error;
  return data.signedUrl;
}

// ── Apoio ────────────────────────────────────────────────────────────

interface AnexoEnviado {
  storage_path: string;
  nome_arquivo: string;
  mime_type: string;
  tamanho_bytes: string;
}

const payloadDiaria = (input: NovaDiariaUfrgs) => ({
  contrato_id: input.contratoId,
  cod_fornecedor: input.codFornecedor,
  matricula: input.matricula,
  motorista_empregado_id: input.motoristaEmpregadoId ?? "",
  motorista_nome: input.motoristaNome,
  sindicato: input.sindicato,
  lotacao: input.lotacao,
  numero_oficio: input.numeroOficio,
  saida: input.saida,
  retorno: input.retorno,
  destino: input.destino,
  posto: input.posto,
  valor_posto_variavel_centavos: input.valorPostoVariavelCentavos,
  qt_hospedagem: input.qtHospedagem,
  qt_cafe: input.qtCafe,
  qt_almoco: input.qtAlmoco,
  qt_janta: input.qtJanta,
  qt_va: input.qtVa,
  observacoes: input.observacoes,
});

async function enviarArquivos(diariaId: string, arquivos: File[]): Promise<AnexoEnviado[]> {
  const enviados: AnexoEnviado[] = [];
  try {
    for (const arquivo of arquivos) {
      // O nome vai sanitizado: acento e espaço no caminho do bucket viram
      // "Invalid key" no Storage, e nome de arquivo brasileiro tem os dois.
      const seguro = arquivo.name.normalize("NFD").replace(/[^\w.-]+/g, "_");
      const path = `${PASTA}/${diariaId}/${Date.now()}-${seguro}`;
      const { error } = await supabase.storage.from(BUCKET).upload(path, arquivo);
      if (error) throw error;
      enviados.push({
        storage_path: path,
        nome_arquivo: arquivo.name,
        mime_type: arquivo.type,
        tamanho_bytes: String(arquivo.size),
      });
    }
  } catch (erro) {
    await removerSilenciosamente(enviados.map((a) => a.storage_path));
    throw erro;
  }
  return enviados;
}

async function removerSilenciosamente(caminhos: string[]) {
  if (caminhos.length === 0) return;
  try {
    await supabase.storage.from(BUCKET).remove(caminhos);
  } catch {
    // Limpeza de melhor esforço: o erro que importa é o do upload/RPC
    // original, não uma segunda falha ao remover o que já subiu.
  }
}

/**
 * Leva os anexos da diária para a pasta da despesa no Malote.
 *
 * Nunca lança: quando isto roda a despesa já existe e a diária já está
 * aprovada. Devolve o que subiu e o nome do que falhou, para o aviso na tela.
 */
async function copiarAnexosParaMalote(
  diariaId: string,
  despesaId: string,
): Promise<{ paths: string[]; falhas: string[] }> {
  const paths: string[] = [];
  const falhas: string[] = [];

  const { data, error } = await sb
    .from("DIARIA_UFRGS_ANEXO")
    .select("storage_path, nome_arquivo, mime_type")
    .eq("diaria_id", diariaId);
  if (error || !data) return { paths, falhas: ["não foi possível ler os anexos da diária"] };

  const usados = new Set<string>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const anexo of data as any[]) {
    const nomeExibido: string =
      anexo.nome_arquivo || String(anexo.storage_path).split("/").pop() || "anexo";
    try {
      const { data: blob, error: erroDownload } = await supabase.storage
        .from(BUCKET)
        .download(anexo.storage_path);
      if (erroDownload || !blob) throw erroDownload ?? new Error("arquivo vazio");

      const seguro = nomeExibido.normalize("NFD").replace(/[^\w.-]+/g, "_");
      let nome = `diaria-ufrgs-${seguro}`;
      // Dois documentos com o mesmo nome existem; o Storage recusa o segundo.
      for (let n = 2; usados.has(nome); n++) nome = `diaria-ufrgs-${n}-${seguro}`;
      usados.add(nome);

      const caminho = `${despesaId}/${nome}`;
      const { error: erroUpload } = await supabase.storage
        .from("malote-anexos")
        .upload(caminho, blob, { contentType: anexo.mime_type || blob.type || undefined });
      if (erroUpload) throw erroUpload;
      paths.push(caminho);
    } catch {
      falhas.push(nomeExibido);
    }
  }
  return { paths, falhas };
}

const fmtTamanho = (bytes: number | null) =>
  !bytes
    ? "—"
    : bytes >= 1024 * 1024
      ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
      : `${Math.max(1, Math.round(bytes / 1024))} KB`;

const mapearAnexo = (a: AnexoUfrgsBanco): AnexoDiariaUfrgs => ({
  nome: a.nome_arquivo ?? a.storage_path.split("/").pop() ?? "arquivo",
  tipo: (a.nome_arquivo ?? "").split(".").pop()?.toUpperCase() || "ARQ",
  tamanho: fmtTamanho(a.tamanho_bytes ? Number(a.tamanho_bytes) : null),
  enviadoEm: new Date(a.created_at).toLocaleString("pt-BR"),
  storagePath: a.storage_path,
});

function mapearDiariaUfrgs(d: DiariaUfrgsBanco): DiariaUfrgs {
  return {
    uuid: d.id,
    id: d.numero ?? d.id,
    criadoEm: new Date(d.created_at).toLocaleString("pt-BR"),
    // O pagamento acontece só no Malote; a diária continua 'aprovada' no
    // banco e vira "Paga" aqui quando a despesa dela chega a despesa_paga.
    // Mesma derivação da diária de diarista (20260930000151), e é isso que
    // faz o status "refletir igual em qualquer rota".
    status: d.status === "aprovada" && d.malote_despesa_paga ? "paga" : d.status,
    contratoId: d.contrato_id,
    contratoNome: d.contrato_nome ?? "—",
    contratoCliente: d.contrato_cliente ?? "—",
    contratoEmpresa: d.contrato_empresa ?? "—",
    competencia: d.competencia,
    codFornecedor: d.cod_fornecedor ?? "",
    matricula: d.matricula ?? "",
    motoristaEmpregadoId: d.motorista_empregado_id != null ? Number(d.motorista_empregado_id) : null,
    motoristaNome: d.motorista_nome ?? "",
    sindicato: d.sindicato ?? "",
    lotacao: d.lotacao ?? "",
    numeroOficio: d.numero_oficio ?? "",
    saida: d.saida,
    retorno: d.retorno,
    destino: d.destino ?? "",
    dataDeposito: d.diaria_ufrgs_data_deposito ?? null,
    posto: d.posto ?? "",
    postoDescricao: d.posto_ref?.descricao ?? "",
    valorPostoVariavelCentavos: numero(d.valor_posto_variavel_centavos),
    qtHospedagem: numero(d.qt_hospedagem),
    qtCafe: numero(d.qt_cafe),
    qtAlmoco: numero(d.qt_almoco),
    qtJanta: numero(d.qt_janta),
    qtVa: numero(d.qt_va),
    fiscal: d.fiscal ?? "",
    aliquotaTotal: numero(d.aliquota_total),
    tarifaId: d.tarifa_id ?? null,
    valorTotalCentavos: numero(d.valor_total_centavos),
    valorVaCentavos: numero(d.valor_va_centavos),
    valorLiquidoCentavos: numero(d.valor_liquido_centavos),
    tributosCentavos: numero(d.tributos_centavos),
    valorFaturarCentavos: numero(d.valor_faturar_centavos),
    observacoes: d.observacoes ?? "",
    anexos: (d.anexos ?? []).map(mapearAnexo),
    solicitanteId: d.solicitante_id,
    solicitante: d.solicitante_nome ?? "—",
    maloteDespesaId: d.malote_despesa_id ?? null,
    maloteMotivo: d.malote_motivo ?? undefined,
    maloteDataPagamento: d.malote_data_pagamento ?? undefined,
    enviadoMaloteEm: d.enviado_malote_em
      ? new Date(d.enviado_malote_em).toLocaleString("pt-BR")
      : undefined,
    decididoPor: d.decidido_por_nome ?? undefined,
    decididoEm: d.decidido_em ? new Date(d.decidido_em).toLocaleString("pt-BR") : undefined,
    ajusteMotivo: d.ajuste_motivo ?? undefined,
    ajustePedidoPor: d.ajuste_pedido_por_nome ?? undefined,
    ajustePedidoEm: d.ajuste_pedido_em
      ? new Date(d.ajuste_pedido_em).toLocaleString("pt-BR")
      : undefined,
    exclusaoMotivo: d.exclusao_motivo ?? undefined,
    excluidaPor: d.excluida_por_nome ?? undefined,
    excluidaEm: d.excluida_em ? new Date(d.excluida_em).toLocaleString("pt-BR") : undefined,
  };
}

/** Mesma extração de mensagem de erro de useDiarias — reexportada para a tela. */
export { mensagemErroDiaria } from "@/hooks/useDiarias";

/** Reais → centavos, para os campos de dinheiro do modal. */
export const paraCentavosUfrgs = (reais: number) => Math.round((Number(reais) || 0) * 100);
export const paraReaisUfrgs = paraReais;
