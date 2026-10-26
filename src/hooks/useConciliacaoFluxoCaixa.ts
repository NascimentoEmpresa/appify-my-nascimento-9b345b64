import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { emLotes } from "@/lib/emLotes";
import type { PlanilhaRow } from "@/lib/conciliacaoBancariaEngine";
import type { FluxoCaixaMaloteLinha } from "@/hooks/useFluxoCaixaMalote";
import type { DiaConciliado, ResumoConciliacao } from "@/lib/conciliacaoResumo";

// SIS-2026-0492: conciliação automática — o lado "Fluxo" vem direto do
// Fluxo de Caixa interno (useFluxoCaixaCombinado), não de planilha subida.
// Este adaptador é o único ponto de contato entre os dois mundos: reusa o
// motor de comparação (`reconciliar`) sem duplicar o algoritmo.
// Conta vinculada (pedido do Iury, 06/10/2026): saída com "CONTA VINCULADA" na
// descrição (ex. "RESGATE CONTA VINCULADA") é movimento interno da conta
// bloqueada, não aparece no extrato da conta corrente — acusava "FLUXO - NÃO
// ENCONTRADO" à toa. Só SAÍDA: a entrada ("RECEBIMENTO DE NOTA - CONTA
// VINCULADA") continua na conciliação.
// SIS-2026-0637: o resgate da conta vinculada do Banco do Brasil e da Caixa também fica
// de fora quando está lançado como ENTRADA (o dinheiro sai da conta vinculada e a
// movimentação não aparece no extrato da conta corrente desses bancos). No Banrisul o
// resgate é dinheiro que cai de verdade na conta: continua na conciliação.
const semAcento = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
function bancoDeContaVinculada(banco: string | null | undefined): boolean {
  const b = semAcento((banco ?? "").trim());
  return b === "BB" || b.includes("BANCO DO BRASIL") || b.includes("CAIXA");
}

export function ignoraNaConciliacao(
  l: Pick<FluxoCaixaMaloteLinha, "tipo" | "descricao"> & { classificacao_nome?: string | null; banco_nome?: string | null },
): boolean {
  // O SALDO ANTERIOR (abertura) nunca é ignorado: tem tratamento próprio.
  if ((l.classificacao_nome ?? "").trim().toUpperCase() === "SALDO ANTERIOR") return false;
  const desc = (l.descricao ?? "").toUpperCase();
  if (l.tipo === "saida" && desc.includes("CONTA VINCULADA")) return true;
  return desc.includes("RESGATE") && desc.includes("VINCULADA") && bancoDeContaVinculada(l.banco_nome);
}

// SIS-2026-0637: o rateio existe só para organização interna (um lançamento dividido por
// contrato) — no extrato cai UM valor, o total. A conciliação compara o total da despesa
// (e da parcela), não cada pedaço do rateio. Mesma chave do Fluxo de Caixa
// (despesa_id + parcela), e só junta o que é do mesmo dia, banco, tipo e origem.
export function linhasFluxoParaPlanilhaRow(linhas: FluxoCaixaMaloteLinha[]): PlanilhaRow[] {
  const saida: PlanilhaRow[] = [];
  const porChave = new Map<string, PlanilhaRow>();
  for (const l of linhas) {
    if (ignoraNaConciliacao(l)) continue;
    const row: PlanilhaRow = {
      dia: l.data_pagamento ?? "",
      valor: l.valor,
      tipo: l.tipo === "entrada" ? "ENTRADA" : "SAÍDA",
      banco: l.banco_nome ?? "—",
      despesaId: l.despesa_id,
      numeroParcela: l.numero_parcela,
      origemFluxo: l.origem,
      empresaNome: l.empresa_nome,
      // ID e descrição do lançamento no Fluxo: a divergência aponta para eles (o rateio é somado numa linha só, então o valor da
      // divergência pode não existir como linha única na tela do Fluxo).
      idMalote: l.id_malote,
      descricaoFluxo: l.descricao,
      partes: 1,
    };
    if (!l.despesa_id) {
      saida.push(row);
      continue;
    }
    const chave = [l.origem, l.despesa_id, l.numero_parcela ?? "", row.dia, row.tipo, row.banco].join("|");
    const existente = porChave.get(chave);
    if (existente) {
      existente.valor = Math.round((existente.valor + row.valor) * 100) / 100;
      existente.partes = (existente.partes ?? 1) + 1;
    } else {
      porChave.set(chave, row);
      saida.push(row);
    }
  }
  return saida;
}

export interface ConciliacaoFluxoCaixaSalva {
  id: string;
  data_inicio: string;
  data_fim: string;
  observacoes: string | null;
  total_linhas: number;
  linhas_ajustadas: number;
  linhas_criadas: number;
  linhas_ignoradas: number;
  created_by: string | null;
  created_at: string;
  // Banco + empresa(s) da conciliação (conciliação é por conta). Registros
  // anteriores à migration 20261005000001 vêm com todas_empresas = true.
  banco_id: string | null;
  todas_empresas: boolean;
  empresa_ids: string[];
  conta_extrato: string | null;
  // Saldo anterior (abertura) conferido na conciliação — null quando a
  // pessoa não informou o do extrato.
  saldo_anterior_fluxo: number | null;
  saldo_anterior_extrato: number | null;
  // SIS-2026-0657: totais do extrato (OFX) dentro do período. null nas conciliações anteriores à migration
  // 20261014000006 que ainda não receberam a carga.
  extrato_entradas?: number | null;
  extrato_saidas?: number | null;
  // Resumo do que foi conciliado (migration 20261022000260). null nas conciliações anteriores.
  fluxo_entradas?: number | null;
  fluxo_saidas?: number | null;
  qtd_fluxo?: number | null;
  qtd_extrato?: number | null;
  conciliado_entradas?: number | null;
  conciliado_saidas?: number | null;
  qtd_conciliadas?: number | null;
  dias_total?: number | null;
  dias_ok?: number | null;
  // Resumo dia a dia (migration 20261022000270).
  resumo_dias?: DiaConciliado[] | null;
  // SIS-2026-0713: saldo final do extrato (LEDGERBAL do OFX, corrigível à mão) — migration 20261023000300. null = não informado.
  saldo_final_extrato?: number | null;
  saldo_final_extrato_data?: string | null;
}

export interface ConciliacaoFluxoCaixaArquivo {
  id: string;
  conciliacao_id: string;
  nome_arquivo: string;
  storage_path: string;
  created_at: string;
}

export interface ConciliacaoFluxoCaixaLinha {
  id: string;
  conciliacao_id: string;
  dia: string;
  origem: "fluxo" | "extrato";
  tipo: "entrada" | "saida";
  valor: number;
  descricao: string | null;
  banco: string | null;
  status: "ok" | "ajustado" | "ignorado" | "criado";
  observacao: string | null;
  despesa_id: string | null;
  numero_parcela: number | null;
}

const BUCKET = "conciliacao-fluxo-caixa";
const KEY = "conciliacao_fluxo_caixa";

export function useConciliacoesFluxoCaixaSalvas() {
  return useQuery({
    queryKey: [KEY, "lista"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("financeiro_conciliacao_fluxo_caixa")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as ConciliacaoFluxoCaixaSalva[];
    },
  });
}

export function useConciliacaoFluxoCaixaDetalhe(id: string | null) {
  return useQuery({
    queryKey: [KEY, "detalhe", id],
    enabled: !!id,
    queryFn: async () => {
      const [linhas, arquivos] = await Promise.all([
        (supabase as any)
          .from("financeiro_conciliacao_fluxo_caixa_linha")
          .select("*")
          .eq("conciliacao_id", id)
          .order("dia"),
        (supabase as any)
          .from("financeiro_conciliacao_fluxo_caixa_arquivo")
          .select("*")
          .eq("conciliacao_id", id),
      ]);
      if (linhas.error) throw linhas.error;
      if (arquivos.error) throw arquivos.error;

      const arquivosComUrl = await Promise.all(
        ((arquivos.data ?? []) as ConciliacaoFluxoCaixaArquivo[]).map(async (a) => {
          const { data } = await supabase.storage.from(BUCKET).createSignedUrl(a.storage_path, 3600);
          return { ...a, url: data?.signedUrl ?? null };
        })
      );

      return {
        linhas: (linhas.data ?? []) as ConciliacaoFluxoCaixaLinha[],
        arquivos: arquivosComUrl,
      };
    },
  });
}

export interface SalvarConciliacaoInput {
  dataInicio: string;
  dataFim: string;
  observacoes: string | null;
  bancoId: string;
  todasEmpresas: boolean;
  empresaIds: string[];
  contaExtrato: string | null;
  saldoAnteriorFluxo: number | null;
  saldoAnteriorExtrato: number | null;
  // SIS-2026-0657: soma do extrato dentro do período. A Auditoria da Controladoria lê daqui (quando tudo bate, nenhuma linha é gravada).
  extratoEntradas?: number | null;
  extratoSaidas?: number | null;
  // O que bateu (Fluxo × extrato): gravado para a lista de conciliações salvas mostrar valores mesmo sem divergência.
  resumo?: ResumoConciliacao | null;
  saldoFinalExtrato?: number | null;
  saldoFinalExtratoData?: string | null;
  arquivosOfx: File[];
  linhas: Omit<ConciliacaoFluxoCaixaLinha, "id" | "conciliacao_id">[];
}

// Só é chamada quando 100% das linhas já estão ok/ajustado/ignorado/criado
// (decisão do usuário — a tela não deixa salvar com pendência em aberto).
export function useSalvarConciliacaoFluxoCaixa() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: SalvarConciliacaoInput) => {
      const contagem = { ajustado: 0, criado: 0, ignorado: 0 };
      for (const l of input.linhas) {
        if (l.status === "ajustado") contagem.ajustado++;
        else if (l.status === "criado") contagem.criado++;
        else if (l.status === "ignorado") contagem.ignorado++;
      }

      const cabecalho = {
        data_inicio: input.dataInicio,
        data_fim: input.dataFim,
        observacoes: input.observacoes,
        banco_id: input.bancoId,
        todas_empresas: input.todasEmpresas,
        empresa_ids: input.todasEmpresas ? [] : input.empresaIds,
        conta_extrato: input.contaExtrato,
        saldo_anterior_fluxo: input.saldoAnteriorFluxo,
        saldo_anterior_extrato: input.saldoAnteriorExtrato,
        total_linhas: input.linhas.length,
        linhas_ajustadas: contagem.ajustado,
        linhas_criadas: contagem.criado,
        linhas_ignoradas: contagem.ignorado,
      };
      const inserir = (dados: Record<string, unknown>) =>
        (supabase as any).from("financeiro_conciliacao_fluxo_caixa").insert(dados).select("id").single();
      // SIS-2026-0657: guarda os totais do extrato. Migration 20261014000006 ainda não aplicada (coluna
      // ausente): salva sem eles, para a conciliação não deixar de salvar.
      const r = input.resumo;
      const resumoCols = r
        ? {
            fluxo_entradas: r.fluxoEntradas, fluxo_saidas: r.fluxoSaidas, qtd_fluxo: r.qtdFluxo, qtd_extrato: r.qtdExtrato,
            conciliado_entradas: r.conciliadoEntradas, conciliado_saidas: r.conciliadoSaidas, qtd_conciliadas: r.qtdConciliadas,
            dias_total: r.diasTotal, dias_ok: r.diasOk,
          }
        : {};
      const diasCol = r ? { resumo_dias: r.dias } : {};
      const saldoFinalCols = input.saldoFinalExtrato != null ? { saldo_final_extrato: input.saldoFinalExtrato, saldo_final_extrato_data: input.saldoFinalExtratoData ?? null } : {};
      const totaisExtrato = { extrato_entradas: input.extratoEntradas ?? null, extrato_saidas: input.extratoSaidas ?? null };
      const colunaAusente = (e: { code?: string } | null) => !!e && (e.code === "PGRST204" || e.code === "42703");
      // Migrations 20261022000270 (dia a dia), 20261022000260 (resumo) e 20261014000006 (totais do extrato) ainda não aplicadas: tenta sem as colunas que faltam.
      let { data: conciliacao, error: errHeader } = await inserir({ ...cabecalho, ...totaisExtrato, ...resumoCols, ...diasCol, ...saldoFinalCols });
      // Migration 20261023000300 (saldo final do extrato) ainda não aplicada: tenta sem essas colunas.
      if (colunaAusente(errHeader)) ({ data: conciliacao, error: errHeader } = await inserir({ ...cabecalho, ...totaisExtrato, ...resumoCols, ...diasCol }));
      if (colunaAusente(errHeader)) ({ data: conciliacao, error: errHeader } = await inserir({ ...cabecalho, ...totaisExtrato, ...resumoCols }));
      if (colunaAusente(errHeader)) ({ data: conciliacao, error: errHeader } = await inserir({ ...cabecalho, ...totaisExtrato }));
      if (colunaAusente(errHeader)) ({ data: conciliacao, error: errHeader } = await inserir(cabecalho));
      if (errHeader) throw errHeader;
      const conciliacaoId = conciliacao.id as string;

      if (input.linhas.length) {
        const { error: errLinhas } = await (supabase as any)
          .from("financeiro_conciliacao_fluxo_caixa_linha")
          .insert(input.linhas.map((l) => ({ ...l, conciliacao_id: conciliacaoId })));
        if (errLinhas) throw errLinhas;
      }

      for (const arquivo of input.arquivosOfx) {
        const path = `${conciliacaoId}/${Date.now()}_${arquivo.name}`;
        const { error: errUpload } = await supabase.storage.from(BUCKET).upload(path, arquivo);
        if (errUpload) throw new Error(`Arquivo ${arquivo.name}: ${errUpload.message}`);
        const { error: errArquivo } = await (supabase as any)
          .from("financeiro_conciliacao_fluxo_caixa_arquivo")
          .insert({ conciliacao_id: conciliacaoId, nome_arquivo: arquivo.name, storage_path: path });
        if (errArquivo) throw errArquivo;
      }

      return conciliacaoId;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY] }),
  });
}

// ── SIS-2026-0713: saldo inicial de janeiro informado à mão ──────────────────

export interface SaldoInicialConciliacao {
  id: string;
  empresa_id: string;
  banco_id: string;
  conta: string;
  ano: number;
  valor: number;
  updated_at: string;
}

const KEY_SALDO_INICIAL = "conciliacao_saldo_inicial";

export function useSaldosIniciaisConciliacao() {
  return useQuery({
    queryKey: [KEY_SALDO_INICIAL],
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("financeiro_conciliacao_saldo_inicial").select("*").order("ano");
      if (error) throw error;
      return ((data ?? []) as SaldoInicialConciliacao[]).map((s) => ({ ...s, valor: Number(s.valor) }));
    },
  });
}

export function useSalvarSaldoInicialConciliacao() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { empresaId: string; bancoId: string; conta: string; ano: number; valor: number | null }) => {
      const { data: auth } = await supabase.auth.getUser();
      const chave = { empresa_id: input.empresaId, banco_id: input.bancoId, conta: input.conta, ano: input.ano };
      // Valor em branco = remove a base (volta a "não informado").
      if (input.valor == null) {
        const { error } = await (supabase as any).from("financeiro_conciliacao_saldo_inicial").delete().match(chave);
        if (error) throw error;
        return;
      }
      const { error } = await (supabase as any)
        .from("financeiro_conciliacao_saldo_inicial")
        .upsert({ ...chave, valor: input.valor, updated_by: auth.user?.id ?? null, updated_at: new Date().toISOString() }, { onConflict: "empresa_id,banco_id,conta,ano" });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY_SALDO_INICIAL] }),
  });
}

// SIS-2026-0720: divergências TRATADAS (ignorada, ajustada ou criada) das conciliações, para explicar de onde vem a diferença dos KPIs de valor.
// A conciliação não grava o que bateu sozinho; só o que precisou de tratamento.
export function useDivergenciasTratadas(conciliacaoIds: string[], ativo: boolean) {
  const chave = [...conciliacaoIds].sort().join(",");
  return useQuery({
    queryKey: [KEY, "tratadas", chave],
    enabled: ativo && conciliacaoIds.length > 0,
    queryFn: async () =>
      emLotes<ConciliacaoFluxoCaixaLinha>(conciliacaoIds, 40, (lote) =>
        (supabase as any)
          .from("financeiro_conciliacao_fluxo_caixa_linha")
          .select("id, conciliacao_id, dia, origem, tipo, valor, descricao, status, observacao")
          .in("conciliacao_id", lote)
          .in("status", ["ignorado", "ajustado", "criado"])
          .order("dia"),
        4,
      ),
  });
}
