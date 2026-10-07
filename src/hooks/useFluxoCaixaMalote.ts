import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

// SIS-2026-0038 (achado do usuário, DESPESA SD-2026-0038 sumida do Fluxo de
// Caixa): PostgREST limita todo select("*") sem .range() a 1000 linhas por
// padrão (db-max-rows do projeto Supabase) — v_malote_pagamento_fluxo_caixa
// já tinha 1146. As linhas que ficam de fora desse corte não são as mais
// antigas/recentes, é ordem arbitrária do Postgres — então qualquer
// lançamento podia sumir do cliente sem erro nenhum. Pagina em blocos de
// 1000 até a página vir menor que o tamanho pedido.
const TAMANHO_PAGINA = 1000;
// Perf do Fluxo (06/10/2026): a importação histórica tem ~20 mil linhas e as
// 20 páginas eram buscadas uma após a outra (~3,8 s só nela, de ~16 MB no
// total). Agora as páginas saem em "ondas" de CONCORRENCIA_PAGINAS ao mesmo
// tempo — não todas de uma vez: o banco já foi afogado por rajada de
// requisições (incidente de 21/09, ver erroSobrecarga em App.tsx), e 4 por
// vez ainda corta o tempo de ~20 voltas para ~5.
const CONCORRENCIA_PAGINAS = 4;
// Ordenação das fontes. Paginação sem ORDER BY pode repetir/pular linhas entre
// páginas (SIS-2026-0569), e ordenar por uma chave que repete (despesa_id é
// compartilhado por todas as linhas de um rateio/parcelamento) também. Por
// isso o desempate é por colunas que existem nas 6 views alinhadas.
// A importação ainda ganha `linha_id` (único; migration 20261006000002) — se
// a migration não subiu, cai na ordenação sem ele em vez de quebrar a tela.
const ORDEM_FONTES = ["despesa_id", "numero_parcela", "contrato_id", "valor"];
const ORDEM_IMPORTACAO = ["despesa_id", "linha_id"];

async function buscarPagina(tabela: string, ordenarPor: string[], pagina: number): Promise<any[]> {
  let q = (supabase as any).from(tabela).select("*");
  for (const col of ordenarPor) q = q.order(col, { ascending: true });
  const { data, error } = await q.range(pagina * TAMANHO_PAGINA, pagina * TAMANHO_PAGINA + TAMANHO_PAGINA - 1);
  if (error) throw error;
  return data ?? [];
}

async function buscarTodasLinhas(tabela: string, ordenarPor: string[] = ORDEM_FONTES): Promise<any[]> {
  const linhas: any[] = [];
  for (let onda = 0; ; onda += 1) {
    const paginas = Array.from({ length: CONCORRENCIA_PAGINAS }, (_, i) => onda * CONCORRENCIA_PAGINAS + i);
    const resultados = await Promise.all(paginas.map((p) => buscarPagina(tabela, ordenarPor, p)));
    for (const dados of resultados) linhas.push(...dados);
    // Onda terminou quando alguma página veio incompleta (a última).
    if (resultados.some((dados) => dados.length < TAMANHO_PAGINA)) break;
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
}

export function useFluxoCaixaMalote() {
  return useQuery({
    queryKey: ["fluxo_caixa_malote"],
    queryFn: async () => {
      const linhas = (await buscarTodasLinhas("v_malote_pagamento_fluxo_caixa")) as FluxoCaixaMaloteLinha[];
      linhas.sort((a, b) => (b.data_pagamento ?? "").localeCompare(a.data_pagamento ?? ""));
      return linhas;
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
      // SIS-2026-0473: Aplicações Financeiras entra como DUAS views — aplicar
      // (saída) e resgate (entrada) — pelo mesmo motivo de não dar pra
      // representar as duas pontas de uma "aplicação com resgate" numa
      // linha só (datas e tipos diferentes), mesma ideia da Movimentação
      // Financeira do Débito Automático (2 linhas ligadas por par).
      const [malote, debitoAutomatico, cartaoFatura, aplicacaoFinanceira, resgateAplicacao, importacaoHistorica] = await Promise.all([
        buscarTodasLinhas("v_malote_pagamento_fluxo_caixa"),
        buscarTodasLinhas("v_debito_automatico_fluxo_caixa"),
        buscarTodasLinhas("v_cartao_fatura_fluxo_caixa"),
        buscarTodasLinhas("v_aplicacao_financeira_fluxo_caixa"),
        buscarTodasLinhas("v_aplicacao_financeira_resgate_fluxo_caixa"),
        // SIS-2026-0569: planilha de Fluxo de Caixa 2026 importada. Migration
        // não se auto-aplica — se o código subir antes dela, a view ainda
        // não existe; sem este guard a tela inteira do Fluxo quebraria.
        buscarTodasLinhas("v_fluxo_caixa_importado_fluxo_caixa", ORDEM_IMPORTACAO)
          // linha_id ainda não existe (migration 20261006000002 não aplicada).
          .catch((e: any) => (e?.code === "42703" ? buscarTodasLinhas("v_fluxo_caixa_importado_fluxo_caixa", ["despesa_id"]) : Promise.reject(e)))
          .catch((e: any) => {
            if (e?.code === "PGRST205" || e?.code === "42P01") return [];
            throw e;
          }),
      ]);
      const linhas = [
        ...malote,
        ...debitoAutomatico,
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
