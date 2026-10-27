import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { parseOFX, parseSaldoFinalOFX, parseFimPeriodoOFX, dataDoSaldoFinal, saldoFinalNoDia, type OFXTransaction } from "@/lib/conciliacaoBancariaEngine";
import { linhasDoFluxoParaConciliacao, processarConciliacao } from "@/lib/conciliacaoCalculo";
import { buscarEmpresasPagadoras, type ConciliacaoFluxoCaixaArquivo, type ConciliacaoFluxoCaixaSalva } from "@/hooks/useConciliacaoFluxoCaixa";
import { aplicarEmpresaPagadora, mapaEmpresaPagadora } from "@/lib/conciliacaoEmpresaPagadora";
import type { FluxoCaixaMaloteLinha } from "@/hooks/useFluxoCaixaMalote";

// Conciliações salvas ANTES do resumo de valores conciliados (migrations 20261022000260/270) só tinham as divergências gravadas. Como o .OFX
// original fica guardado em cada conciliação, dá para refazer o cálculo: extrato = o .OFX guardado; Fluxo = o Fluxo de Caixa de hoje para o
// mesmo período, banco e empresas (o Fluxo já está com os ajustes feitos na época; se alguém mexeu depois, o resumo reflete o Fluxo atual).
const BUCKET = "conciliacao-fluxo-caixa";
const KEY = "conciliacao_fluxo_caixa";

export function conciliacaoSemResumo(c: Pick<ConciliacaoFluxoCaixaSalva, "resumo_dias" | "banco_id">): boolean {
  return !c.resumo_dias && !!c.banco_id;
}

class MigrationPendente extends Error {}

export interface GerarResumoInput {
  conciliacao: ConciliacaoFluxoCaixaSalva;
  linhasBrutas: FluxoCaixaMaloteLinha[];
  bancoNome: string;
}

async function gerarResumoUma({ conciliacao: c, linhasBrutas, bancoNome }: GerarResumoInput): Promise<void> {
  if (!c.banco_id) throw new Error("Conciliação sem banco gravado: não dá para refazer o resumo.");
  const { data: arquivos, error: errArq } = await (supabase as any)
    .from("financeiro_conciliacao_fluxo_caixa_arquivo")
    .select("nome_arquivo, storage_path")
    .eq("conciliacao_id", c.id);
  if (errArq) throw errArq;
  const lista = (arquivos ?? []) as Pick<ConciliacaoFluxoCaixaArquivo, "nome_arquivo" | "storage_path">[];
  if (lista.length === 0) throw new Error("Esta conciliação não tem o arquivo .OFX guardado.");

  const trns: OFXTransaction[] = [];
  for (const a of lista) {
    const { data: blob, error } = await supabase.storage.from(BUCKET).download(a.storage_path);
    if (error || !blob) throw new Error(`Não consegui abrir ${a.nome_arquivo}: ${error?.message ?? "arquivo vazio"}`);
    trns.push(...parseOFX(await blob.text(), a.nome_arquivo));
  }

  const escopo = { bancoId: c.banco_id, todasEmpresas: c.todas_empresas, empresaIds: c.empresa_ids ?? [], dataDe: c.data_inicio, dataAte: c.data_fim };
  // mesma regra da conciliação nova: despesa rateada entre empresas pertence à empresa que a pagou (quando marcada)
  const fluxo = aplicarEmpresaPagadora(linhasBrutas, mapaEmpresaPagadora(await buscarEmpresasPagadoras()), new Map());
  const linhasDoBancoEmpresa = linhasDoFluxoParaConciliacao(fluxo, escopo);
  // e rateio entre empresas pago de uma conta só conta pelo total quando o extrato traz o total
  const linhasDoBancoTodasEmpresas = linhasDoFluxoParaConciliacao(fluxo, { ...escopo, todasEmpresas: true });
  const { resumo: r, totaisExtrato } = processarConciliacao({
    linhasDoBancoEmpresa,
    linhasDoBancoTodasEmpresas,
    trns,
    dataDe: c.data_inicio,
    dataAte: c.data_fim,
    saldoExtrato: c.saldo_anterior_extrato ?? null,
    bancoNome,
  });

  const corpo: Record<string, unknown> = {
    fluxo_entradas: r.fluxoEntradas, fluxo_saidas: r.fluxoSaidas, qtd_fluxo: r.qtdFluxo, qtd_extrato: r.qtdExtrato,
    conciliado_entradas: r.conciliadoEntradas, conciliado_saidas: r.conciliadoSaidas, qtd_conciliadas: r.qtdConciliadas,
    dias_total: r.diasTotal, dias_ok: r.diasOk, resumo_dias: r.dias,
  };
  // os totais do extrato que já estavam gravados (a Auditoria da Controladoria lê deles) não são sobrescritos
  if (c.extrato_entradas == null) corpo.extrato_entradas = totaisExtrato.entradas;
  if (c.extrato_saidas == null) corpo.extrato_saidas = totaisExtrato.saidas;

  const { data, error } = await (supabase as any).from("financeiro_conciliacao_fluxo_caixa").update(corpo).eq("id", c.id).select("id");
  if (error) {
    // coluna do resumo ausente = migrations ainda não aplicadas no banco: vale para todas, não adianta seguir
    if (error.code === "PGRST204" || error.code === "42703" || /schema cache|does not exist/i.test(error.message ?? "")) {
      throw new MigrationPendente("Faltam as migrations 20261022000260 e 20261022000270 (colunas do resumo) no banco. Aplique-as e tente de novo.");
    }
    throw error;
  }
  if (!data || data.length === 0) throw new Error("Sem permissão para atualizar esta conciliação (ação Alterar em Conciliação Bancária).");
}

/** Refaz o resumo de uma ou várias conciliações antigas, uma por vez; devolve quantas deram certo e os erros. */
export function useGerarResumoConciliacoes() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (itens: GerarResumoInput[]) => {
      let ok = 0;
      const erros: string[] = [];
      for (const it of itens) {
        try {
          await gerarResumoUma(it);
          ok += 1;
        } catch (e: any) {
          if (e instanceof MigrationPendente) { erros.unshift(e.message); break; }
          erros.push(`${it.bancoNome} ${it.conciliacao.data_inicio} a ${it.conciliacao.data_fim}: ${e?.message ?? "erro"}`);
        }
      }
      return { ok, erros };
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY] }),
  });
}

// SIS-2026-0713: conciliações salvas antes do saldo final do extrato (migration 20261023000300): relê o .OFX guardado, pega o LEDGERBAL e
// grava o saldo do último dia do período. Não precisa do Fluxo. Sem LEDGERBAL no arquivo, o saldo continua "não informado".
export function conciliacaoSemSaldoFinal(c: Pick<ConciliacaoFluxoCaixaSalva, "saldo_final_extrato" | "banco_id">): boolean {
  return c.saldo_final_extrato == null && !!c.banco_id;
}

async function carregarSaldoFinalUma(c: ConciliacaoFluxoCaixaSalva): Promise<boolean> {
  const { data: arquivos, error: errArq } = await (supabase as any)
    .from("financeiro_conciliacao_fluxo_caixa_arquivo")
    .select("nome_arquivo, storage_path")
    .eq("conciliacao_id", c.id);
  if (errArq) throw errArq;
  const lista = (arquivos ?? []) as Pick<ConciliacaoFluxoCaixaArquivo, "nome_arquivo" | "storage_path">[];
  if (lista.length === 0) throw new Error("sem o arquivo .OFX guardado");

  const trns: OFXTransaction[] = [];
  let saldo: { valor: number; data: string | null } | null = null;
  let fimDosArquivos: string | null = null;
  for (const a of lista) {
    const { data: blob, error } = await supabase.storage.from(BUCKET).download(a.storage_path);
    if (error || !blob) throw new Error(`não consegui abrir ${a.nome_arquivo}: ${error?.message ?? "arquivo vazio"}`);
    const texto = await blob.text();
    trns.push(...parseOFX(texto, a.nome_arquivo));
    const fimArq = parseFimPeriodoOFX(texto);
    if (fimArq && (!fimDosArquivos || fimArq > fimDosArquivos)) fimDosArquivos = fimArq;
    const sf = parseSaldoFinalOFX(texto);
    if (sf && (!saldo || (sf.data ?? "") >= (saldo.data ?? ""))) saldo = sf;
  }
  if (!saldo) return false;
  const valor = saldoFinalNoDia(saldo, trns, c.data_fim);
  const { data, error } = await (supabase as any)
    .from("financeiro_conciliacao_fluxo_caixa")
    .update({ saldo_final_extrato: valor, saldo_final_extrato_data: dataDoSaldoFinal(saldo, trns, c.data_fim, fimDosArquivos) })
    .eq("id", c.id)
    .select("id");
  if (error) {
    if (error.code === "PGRST204" || error.code === "42703") throw new MigrationPendente("Falta a migration 20261023000300 (saldo final do extrato) no banco.");
    throw error;
  }
  if (!data || data.length === 0) throw new Error("sem permissão para atualizar (ação Alterar em Conciliação Bancária)");
  return true;
}

export function useCarregarSaldoFinalConciliacoes() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (itens: ConciliacaoFluxoCaixaSalva[]) => {
      let ok = 0;
      let semSaldo = 0;
      const erros: string[] = [];
      for (const c of itens) {
        try {
          if (await carregarSaldoFinalUma(c)) ok += 1;
          else semSaldo += 1;
        } catch (e: any) {
          if (e instanceof MigrationPendente) { erros.unshift(e.message); break; }
          erros.push(`${c.data_inicio} a ${c.data_fim}: ${e?.message ?? "erro"}`);
        }
      }
      return { ok, semSaldo, erros };
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY] }),
  });
}

// Saldo final do extrato digitado à mão numa conciliação já salva (arquivo sem saldo, como o Mentore, ou saldo de outra data). A data gravada
// é o fim do período: quem digita está informando o saldo daquele dia. Valor vazio apaga e volta a "não informado".
export function useSalvarSaldoFinalManual() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ conciliacaoId, valor, dataFim }: { conciliacaoId: string; valor: number | null; dataFim: string }) => {
      const { data, error } = await (supabase as any)
        .from("financeiro_conciliacao_fluxo_caixa")
        .update({ saldo_final_extrato: valor, saldo_final_extrato_data: valor == null ? null : dataFim })
        .eq("id", conciliacaoId)
        .select("id");
      if (error) throw error;
      if (!data || data.length === 0) throw new Error("Sem permissão para atualizar (ação Alterar em Conciliação Bancária).");
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY] }),
  });
}
