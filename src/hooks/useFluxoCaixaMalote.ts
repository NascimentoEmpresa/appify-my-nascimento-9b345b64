import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { criarLimitadorDeConcorrencia } from "@/lib/limitarConcorrencia";

// SIS-2026-0038 (achado do usuário, DESPESA SD-2026-0038 sumida do Fluxo de
// Caixa): PostgREST limita todo select("*") sem .range() a 1000 linhas por
// padrão (db-max-rows do projeto Supabase) — v_malote_pagamento_fluxo_caixa
// já tinha 1146. As linhas que ficam de fora desse corte não são as mais
// antigas/recentes, é ordem arbitrária do Postgres — então qualquer
// lançamento podia sumir do cliente sem erro nenhum. Pagina em blocos de
// 1000 até a página vir menor que o tamanho pedido.
const TAMANHO_PAGINA = 1000;
// Incidente 23/10/2026: cada uma das seis fontes abria a sua própria onda de
// quatro páginas. Na prática, o Promise.all abaixo chegava a 24 consultas
// simultâneas, além de permissões/notificações da abertura da página, e o
// pool devolvia PGRST000/502/504. O limite precisa valer para o Fluxo INTEIRO,
// não para cada fonte. Duas conexões deixam folga para o restante do ERP;
// com ~20 mil importações, a carga continua em poucos segundos sem afogar o
// banco.
const CONCORRENCIA_TOTAL_FLUXO = 2;
// Ordenação das fontes. Paginação sem ORDER BY pode repetir/pular linhas entre
// páginas (SIS-2026-0569), e ordenar por uma chave que repete (despesa_id é
// compartilhado por todas as linhas de um rateio/parcelamento) também. Por
// isso o desempate é por colunas que existem nas 6 views alinhadas.
// A importação ainda ganha `linha_id` (único; migration 20261006000002) — se
// a migration não subiu, cai na ordenação sem ele em vez de quebrar a tela.
const ORDEM_FONTES = ["despesa_id", "numero_parcela", "contrato_id", "valor"];
const ORDEM_IMPORTACAO = ["despesa_id", "linha_id"];
// SIS-2026-0632: na view consolidada várias despesas dividem o mesmo despesa_id (a
// fatura), então o desempate precisa incluir a despesa e a parcela de ORIGEM.
const ORDEM_CONSOLIDADA = ["despesa_id", "despesa_id_origem", "numero_parcela_origem", "contrato_id", "valor"];

type ExecutarLimitado = ReturnType<typeof criarLimitadorDeConcorrencia>;

async function buscarPagina(tabela: string, ordenarPor: string[], pagina: number, executar: ExecutarLimitado): Promise<any[]> {
  return executar(async () => {
    let q = (supabase as any).from(tabela).select("*");
    for (const col of ordenarPor) q = q.order(col, { ascending: true });
    const { data, error } = await q.range(pagina * TAMANHO_PAGINA, pagina * TAMANHO_PAGINA + TAMANHO_PAGINA - 1);
    if (error) throw error;
    return data ?? [];
  });
}

async function buscarTodasLinhas(tabela: string, ordenarPor: string[] = ORDEM_FONTES, executar = criarLimitadorDeConcorrencia(1)): Promise<any[]> {
  const linhas: any[] = [];
  for (let pagina = 0; ; pagina += 1) {
    const dados = await buscarPagina(tabela, ordenarPor, pagina, executar);
    linhas.push(...dados);
    if (dados.length < TAMANHO_PAGINA) break;
  }
  return linhas;
}

// SIS-2026-0160: início do Fluxo de Caixa (Financeiro > Gestão Financeira).
// Lê direto de v_malote_pagamento_fluxo_caixa (20260907000002), que já
// resolve os nomes de empresa/contrato/classificação — sem join no
// client.
//
// SIS-2026-0254 (achado ao implementar "qual parcela está sendo paga"):
// despesa NÃO parcelada continua 1 linha só, quando fica despesa_paga; se
// for estornada/cancelada depois, a linha some sozinha. Despesa PARCELADA
// virou 1 linha por PARCELA PAGA (malote_despesa_parcela.status = 'paga'),
// cada uma com a data/valor reais daquela parcela — antes só aparecia 1x,
// no fim, com o valor cheio da despesa na data da última parcela (distorção
// real de Fluxo de Caixa/Fatura do Mês do cartão, não só falta de coluna).
export interface FluxoCaixaMaloteLinha {
  despesa_id: string;
  id_malote: string;
  data_pagamento: string | null;
  competencia: string | null;
  empresa_id: string | null;
  empresa_nome: string | null;
  contrato_id: string | null;
  contrato_nome: string | null;
  classificacao_id: string | null;
  classificacao_nome: string | null;
  descricao: string;
  forma_pagamento: string | null;
  // SIS-2026-0307: banco usado no pagamento (catálogo malote_cartao_banco,
  // reaproveitado do Cartão de Crédito) — a view já resolve o nome, sem
  // join no client.
  banco_id: string | null;
  banco_nome: string | null;
  banco_logo_path: string | null;
  // SIS-2026-0254: despesa parcelada agora entra 1 linha por PARCELA PAGA
  // (não mais 1 linha só no fim) — os dois vêm null pra despesa não
  // parcelada.
  numero_parcela: number | null;
  numero_parcelas: number | null;
  valor: number;
  // SIS-2026-0256: até então só existia saída (Malote); Débito Automático
  // soma entrada também (Nota Recebida, Movimentação Financeira "linha de
  // entrada").
  tipo: "entrada" | "saida";
  // SIS-2026-0413: de qual tabela/RPC esta linha vem — usado pra escolher
  // o botão/mutation certos de Excluir na tela de Fluxo de Caixa.
  // SIS-2026-0473: "aplicacao_financeira" cobre tanto a saída (aplicar)
  // quanto a entrada (resgate) — as duas views compartilham o mesmo
  // despesa_id só pra aplicar (id da APLICACAO_FINANCEIRA); resgate usa o
  // id do próprio resgate (não tem edição/exclusão pela tela de Fluxo, só
  // pela tela de Aplicações Financeiras).
  origem: "malote" | "debito_automatico" | "cartao_fatura" | "aplicacao_financeira" | "importacao_historica";
  // SIS-2026-0489: true quando existe uma linha em
  // financeiro_fluxo_caixa_ajuste pra este lançamento — os campos exibidos
  // já vêm resolvidos pela view (COALESCE(ajuste, original)), este flag é
  // só pra tela avisar visualmente que aquele valor foi editado só aqui,
  // sem mudar o lançamento original.
  ajustado: boolean;
  // SIS-2026-0569: só a view da importação histórica devolve — texto com o
  // que subiu sem vínculo (contrato/classificação não mapeados, possível
  // duplicidade). Calculado na view, então some sozinho quando a linha é
  // corrigida. Nas demais origens vem undefined.
  inconsistencia?: string | null;
  // Só a view da importação: id único da linha (desempate da paginação).
  linha_id?: string;
  // Só a view da importação: true quando o rateio foi criado no ERP (esse dá para refazer/desfazer pela tela;
  // o que veio rateado da planilha não é alterado).
  rateio_erp?: boolean;
  // SIS-2026-0611: só a view de previstos (Fluxo Projetado) devolve — 'aberto' | 'cancelado'.
  // Linha com isto preenchido ainda NÃO aconteceu: não é pagamento realizado.
  situacao_base?: "aberto" | "cancelado" | null;
  // SIS-2026-0632: só a view consolidada devolve. Preenchidos quando a linha é a
  // fatura consolidada de um cartão (várias despesas num despesa_id só).
  fatura_cartao_id?: string | null;
  fatura_mes?: string | null; // yyyy-mm-01 da fatura (competência da fatura)
  despesa_id_origem?: string;
  numero_parcela_origem?: number | null;
  id_malote_origem?: string | null;
  descricao_origem?: string | null;
  numero_parcelas_origem?: number | null;
  data_compra_origem?: string | null;
}

export function useFluxoCaixaMalote() {
  return useQuery({
    queryKey: ["fluxo_caixa_malote"],
    queryFn: async () => {
      const executar = criarLimitadorDeConcorrencia(CONCORRENCIA_TOTAL_FLUXO);
      const linhas = (await buscarTodasLinhas("v_malote_pagamento_fluxo_caixa", ORDEM_FONTES, executar)) as FluxoCaixaMaloteLinha[];
      linhas.sort((a, b) => (b.data_pagamento ?? "").localeCompare(a.data_pagamento ?? ""));
      return linhas;
    },
  });
}

// SIS-2026-0751: a tela de Cartão de Crédito só lia o Malote, então um Débito Automático
// lançado com a forma de pagamento de um cartão nunca entrava em "Utilizado", "Fatura do
// Mês" nem na lista de lançamentos. Só SAÍDA conta (entrada não é gasto no cartão). A chave
// começa por "fluxo_caixa_combinado" de propósito: o Débito Automático já invalida esse
// prefixo ao pagar/editar/excluir, então esta lista acompanha sem mexer no outro hook.
export function useFluxoCaixaDebitoAutomaticoSaidas() {
  return useQuery({
    queryKey: ["fluxo_caixa_combinado", "debito_automatico_saidas"],
    queryFn: async () => {
      const executar = criarLimitadorDeConcorrencia(CONCORRENCIA_TOTAL_FLUXO);
      const linhas = (await buscarTodasLinhas("v_debito_automatico_fluxo_caixa", ORDEM_FONTES, executar)) as FluxoCaixaMaloteLinha[];
      return linhas.filter((l) => l.tipo === "saida");
    },
  });
}

// SIS-2026-0256/0255: fonte combinada da tela /app/financeiro/gestao-
// financeira/fluxo-caixa — Pagamento Malote (só saída) + Débito Automático
// (entrada e saída, itens "pago" que não passam pelo Malote) + fatura de
// Cartão de Crédito importada (SIS-2026-0255, saída, itens confirmados que
// também não passam pelo Malote). Colunas alinhadas 1:1 nas 3 views — dá
// pra concatenar direto sem transformação. A tela de Cartão de Crédito em
// si continua só com a fonte do Malote (useFluxoCaixaMalote), que é o que
// calcularUtilizadoEFatura usa — fatura importada não conta pro "Utilizado"
// do card, é lançamento próprio.
export function useFluxoCaixaCombinado() {
  return useQuery({
    queryKey: ["fluxo_caixa_combinado"],
    // 16 MB de JSON: não refaz a cada 30s (padrão global) nem descarta ao sair
    // da tela. Quem edita/exclui/troca contrato já invalida esta chave, então
    // o dado do próprio usuário nunca fica velho; mudança de outra pessoa
    // aparece em até 2 min ou ao recarregar.
    staleTime: 120_000,
    gcTime: 1_800_000,
    queryFn: async () => {
      const executar = criarLimitadorDeConcorrencia(CONCORRENCIA_TOTAL_FLUXO);
      // SIS-2026-0473: Aplicações Financeiras entra como DUAS views — aplicar
      // (saída) e resgate (entrada) — pelo mesmo motivo de não dar pra
      // representar as duas pontas de uma "aplicação com resgate" numa
      // linha só (datas e tipos diferentes), mesma ideia da Movimentação
      // Financeira do Débito Automático (2 linhas ligadas por par).
      const [malote, debitoAutomatico, cartaoFatura, aplicacaoFinanceira, resgateAplicacao, importacaoHistorica] = await Promise.all([
        // SIS-2026-0632: cartão com "fatura consolidada no Fluxo" (2719) vira 1 linha
        // por fatura, no vencimento. Migration 20261008000005 ainda não aplicada
        // (view/coluna ausente) -> cai na view de sempre, 1 linha por despesa.
        buscarTodasLinhas("v_malote_pagamento_fluxo_caixa_consolidado", ORDEM_CONSOLIDADA, executar).catch((e: any) => {
          if (e?.code === "PGRST205" || e?.code === "42P01" || e?.code === "42703") return buscarTodasLinhas("v_malote_pagamento_fluxo_caixa", ORDEM_FONTES, executar);
          throw e;
        }),
        buscarTodasLinhas("v_debito_automatico_fluxo_caixa", ORDEM_FONTES, executar),
        buscarTodasLinhas("v_cartao_fatura_fluxo_caixa", ORDEM_FONTES, executar),
        buscarTodasLinhas("v_aplicacao_financeira_fluxo_caixa", ORDEM_FONTES, executar),
        buscarTodasLinhas("v_aplicacao_financeira_resgate_fluxo_caixa", ORDEM_FONTES, executar),
        // SIS-2026-0569: planilha de Fluxo de Caixa 2026 importada. Migration
        // não se auto-aplica — se o código subir antes dela, a view ainda
        // não existe; sem este guard a tela inteira do Fluxo quebraria.
        buscarTodasLinhas("v_fluxo_caixa_importado_fluxo_caixa", ORDEM_IMPORTACAO, executar)
          // linha_id ainda não existe (migration 20261006000002 não aplicada).
          .catch((e: any) => (e?.code === "42703" ? buscarTodasLinhas("v_fluxo_caixa_importado_fluxo_caixa", ["despesa_id"], executar) : Promise.reject(e)))
          .catch((e: any) => {
            if (e?.code === "PGRST205" || e?.code === "42P01") return [];
            throw e;
          }),
      ]);
      // Débito Automático no cartão com fatura consolidada já veio DENTRO da fatura (view consolidada):
      // sai daqui para não somar duas vezes.
      const debitosNaFatura = new Set(
        (malote as FluxoCaixaMaloteLinha[]).filter((l) => l.fatura_cartao_id && l.despesa_id_origem).map((l) => l.despesa_id_origem as string),
      );
      const linhas = [
        ...malote,
        ...(debitoAutomatico as FluxoCaixaMaloteLinha[]).filter((l) => !debitosNaFatura.has(l.despesa_id)),
        ...cartaoFatura,
        ...aplicacaoFinanceira,
        ...resgateAplicacao,
        ...importacaoHistorica,
      ] as FluxoCaixaMaloteLinha[];
      linhas.sort((a, b) => (b.data_pagamento ?? "").localeCompare(a.data_pagamento ?? ""));
      return linhas;
    },
  });
}

// SIS-2026-0611: compromissos ainda não pagos (aba Projetado). HOOK SEPARADO de propósito:
// a Conciliação Bancária lê useFluxoCaixaCombinado para casar com o extrato, e algo que ainda
// não foi pago não pode entrar nessa conciliação. Migration 20261014000003 ainda não aplicada
// (view ausente) -> lista vazia, a tela segue só com o que já existia.
export function useFluxoCaixaPrevisto(ativo = true) {
  return useQuery({
    queryKey: ["fluxo_caixa_previsto"],
    staleTime: 60_000,
    enabled: ativo,
    queryFn: async () => {
      try {
        const executar = criarLimitadorDeConcorrencia(CONCORRENCIA_TOTAL_FLUXO);
        const linhas = (await buscarTodasLinhas("v_fluxo_caixa_previsto", ORDEM_FONTES, executar)) as FluxoCaixaMaloteLinha[];
        return linhas;
      } catch (e: any) {
        if (e?.code === "PGRST205" || e?.code === "42P01") return [] as FluxoCaixaMaloteLinha[];
        throw e;
      }
    },
  });
}

// SIS-2026-0489: valores que sobrescrevem a linha SÓ no Fluxo de Caixa
// (financeiro_fluxo_caixa_ajuste) — a tabela de origem (malote_despesa/
// "DEBITO_AUTOMATICO"/malote_cartao_fatura_item) nunca é tocada. `undefined`
// num campo = "não mudar esse campo"; `null` = "apagar o ajuste e voltar
// pro valor original" (usado pelo botão de reverter, campo a campo).
export interface AjusteFluxoCaixaInput {
  origem: FluxoCaixaMaloteLinha["origem"];
  despesaId: string;
  numeroParcela: number | null;
  dataPagamento?: string | null;
  tipo?: "entrada" | "saida" | null;
  classificacaoId?: string | null;
  descricao?: string | null;
  competencia?: string | null;
  empresaId?: string | null;
  bancoId?: string | null;
  formaPagamento?: string | null;
  // SIS-2026-0492: adicionado depois do SIS-2026-0489 original — a
  // conciliação com o Fluxo de Caixa interno precisa poder corrigir o
  // valor de um lançamento (divergência de "VALOR SIMILAR"), coisa que o
  // pedido original de edição de linha não previa.
  valor?: number | null;
}

// Upsert manual (não usa .upsert()/on_conflict do PostgREST): numero_parcela
// é NULL na maioria dos casos (malote não-parcelado, débito automático), e
// NULL nunca "conflita" com NULL num ON CONFLICT — o upsert nativo criaria
// uma linha de ajuste nova a cada edição em vez de atualizar a existente.
export function useAjustarLinhaFluxoCaixa() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: AjusteFluxoCaixaInput) => {
      const { origem, despesaId, numeroParcela, ...campos } = input;
      let q = (supabase as any)
        .from("financeiro_fluxo_caixa_ajuste")
        .select("id")
        .eq("origem", origem)
        .eq("despesa_id", despesaId);
      q = numeroParcela == null ? q.is("numero_parcela", null) : q.eq("numero_parcela", numeroParcela);
      const { data: existente, error: errBusca } = await q.maybeSingle();
      if (errBusca) throw errBusca;

      const payload = {
        data_pagamento: campos.dataPagamento,
        tipo: campos.tipo,
        classificacao_id: campos.classificacaoId,
        descricao: campos.descricao,
        competencia: campos.competencia,
        empresa_id: campos.empresaId,
        banco_id: campos.bancoId,
        forma_pagamento: campos.formaPagamento,
        valor: campos.valor,
      };
      // Só grava os campos que quem chamou de fato passou — os outros
      // continuam com o que já estava salvo no ajuste (ou null, se for
      // linha nova).
      const camposPresentes = Object.fromEntries(
        Object.entries(payload).filter(([, v]) => v !== undefined),
      );

      if (existente) {
        const { error } = await (supabase as any)
          .from("financeiro_fluxo_caixa_ajuste")
          .update(camposPresentes)
          .eq("id", existente.id);
        if (error) throw error;
      } else {
        const { error } = await (supabase as any)
          .from("financeiro_fluxo_caixa_ajuste")
          .insert({ origem, despesa_id: despesaId, numero_parcela: numeroParcela, ...camposPresentes });
        if (error) throw error;
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["fluxo_caixa_combinado"] }),
  });
}

// SIS-2026-0552: troca o contrato de um lançamento pelo Fluxo, gravando na
// ORIGEM (rateio do Malote / débito automático / importação) via RPC — é o que
// faz o valor ir pro contrato certo no Orçamento. Ver a migration
// 20261005000020_fluxo_caixa_trocar_contrato.sql.
export function useTrocarContratoFluxoCaixa() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ origem, despesaId, contratoId }: { origem: string; despesaId: string; contratoId: string }) => {
      const { error } = await (supabase as any).rpc("fluxo_caixa_trocar_contrato", {
        _origem: origem,
        _despesa_id: despesaId,
        _contrato_id: contratoId,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["fluxo_caixa_combinado"] });
      qc.invalidateQueries({ queryKey: ["fluxo_caixa_malote"] });
      qc.invalidateQueries({ queryKey: ["utilizado_orcamento"] });
      qc.invalidateQueries({ queryKey: ["malote_despesa"] });
    },
  });
}

// Confirma (ou desfaz) que um lançamento importado não pertence a contrato:
// o selo "contrato não mapeado" some, o contrato continua nulo. Ver a migration
// 20261007000005_fluxo_caixa_importado_sem_contrato.sql.
export function useSemContratoImportado() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ linhaId, confirmado = true }: { linhaId: string; confirmado?: boolean }) => {
      const { error } = await (supabase as any).rpc("fluxo_caixa_importado_sem_contrato", { _linha_id: linhaId, _confirmado: confirmado });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["fluxo_caixa_combinado"] }),
  });
}

// Apaga a linha de ajuste inteira — a linha volta a mostrar 100% do valor
// original (não dá pra reverter campo a campo por aqui; quem editou um
// campo errado edita ele de novo, com o valor certo).
export function useReverterAjusteFluxoCaixa() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ origem, despesaId, numeroParcela }: Pick<AjusteFluxoCaixaInput, "origem" | "despesaId" | "numeroParcela">) => {
      let q = (supabase as any)
        .from("financeiro_fluxo_caixa_ajuste")
        .delete()
        .eq("origem", origem)
        .eq("despesa_id", despesaId);
      q = numeroParcela == null ? q.is("numero_parcela", null) : q.eq("numero_parcela", numeroParcela);
      const { error } = await q;
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["fluxo_caixa_combinado"] }),
  });
}

// SIS-2026-0733: histórico das edições do Fluxo (financeiro_fluxo_caixa_ajuste_historico) - quem criou, alterou ou
// desfez o ajuste de uma linha, quando, e os valores antes/depois. Gravado por gatilho no banco; aqui so leitura.
export interface HistoricoAjusteFluxo {
  id: string;
  operacao: "criado" | "alterado" | "desfeito";
  campos: string[];
  antes: Record<string, unknown> | null;
  depois: Record<string, unknown> | null;
  usuario_nome: string | null;
  usuario_banco: string;
  created_at: string;
}

// SIS-2026-0712: linha do tempo da linha do Fluxo — origem (Malote/Débito/planilha), ajustes, rateio, exclusão e restauração.
export interface EventoHistoricoLinhaFluxo {
  quando: string;
  fonte: string;
  tipo: string;
  descricao: string | null;
  usuario: string | null;
  detalhe: Record<string, any> | null;
}

export function useHistoricoLinhaFluxo(linha: { origem: string; despesa_id: string; numero_parcela: number | null } | null) {
  return useQuery({
    queryKey: ["fluxo_caixa_historico_linha", linha?.origem, linha?.despesa_id, linha?.numero_parcela ?? null],
    enabled: !!linha,
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("fluxo_caixa_historico_linha", {
        _origem: linha!.origem,
        _despesa_id: linha!.despesa_id,
        _numero_parcela: linha!.numero_parcela,
      });
      if (error) {
        // Migration ainda não aplicada: o diálogo mostra a lista vazia, sem quebrar a tela.
        if (error.code === "PGRST202" || error.code === "42883") return [] as EventoHistoricoLinhaFluxo[];
        throw error;
      }
      return (data ?? []) as EventoHistoricoLinhaFluxo[];
    },
  });
}

export function useHistoricoAjusteFluxo(linha: { origem: string; despesa_id: string; numero_parcela: number | null } | null) {
  return useQuery({
    queryKey: ["fluxo_caixa_ajuste_historico", linha?.origem, linha?.despesa_id, linha?.numero_parcela ?? null],
    enabled: !!linha,
    queryFn: async () => {
      let q = (supabase as any)
        .from("financeiro_fluxo_caixa_ajuste_historico")
        .select("id, operacao, campos, antes, depois, usuario_nome, usuario_banco, created_at")
        .eq("origem", linha!.origem)
        .eq("despesa_id", linha!.despesa_id)
        .order("created_at", { ascending: false });
      q = linha!.numero_parcela == null ? q.is("numero_parcela", null) : q.eq("numero_parcela", linha!.numero_parcela);
      const { data, error } = await q;
      if (error) {
        // Migration ainda nao aplicada: a tela segue sem a secao, sem quebrar.
        if (error.code === "PGRST205" || error.code === "42P01") return [] as HistoricoAjusteFluxo[];
        throw error;
      }
      return (data ?? []) as HistoricoAjusteFluxo[];
    },
  });
}
