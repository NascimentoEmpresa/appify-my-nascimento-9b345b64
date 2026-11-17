import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import type { SocioConfig, SocioFechado } from "@/pages/controladoria/fechamento-socios/regras";

// SIS-2026-0872: dados guardados do Fechamento dos Sócios (migration 20261114220000). As tabelas ainda não estão nos tipos gerados do Supabase,
// por isso o cliente sem tipos. Quem lê/escreve é decidido pela RLS (fechamento-socios, -percentual e -fechar).
const db = supabase as unknown as SupabaseClient;
const KEY = "fechamento_socios";
const num = (v: unknown) => Number(v ?? 0) || 0;

type LinhaSocio = { id: string; nome: string; empregado_ids: number[] | null; percentual_padrao: number | string; ativo: boolean };

export function useSociosConfig() {
  return useQuery({
    queryKey: [KEY, "socios"],
    staleTime: 60_000,
    refetchOnMount: "always", // o cadastro é pequeno e muda pouco, mas uma lista vazia em cache não pode esconder o que acabou de ser cadastrado
    queryFn: async (): Promise<SocioConfig[]> => {
      const { data, error } = await db.from("fechamento_socio").select("id, nome, empregado_ids, percentual_padrao, ativo").order("nome");
      if (error) throw error;
      return ((data ?? []) as LinhaSocio[]).map((s) => ({ id: s.id, nome: s.nome, empregadoIds: s.empregado_ids ?? [], percentualPadrao: num(s.percentual_padrao), ativo: s.ativo }));
    },
  });
}

export interface SalvarSocioInput { id?: string; nome: string; empregadoIds: number[]; percentualPadrao: number; ativo: boolean }

export function useSalvarSocios() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (socios: SalvarSocioInput[]) => {
      const uid = (await supabase.auth.getUser()).data.user?.id ?? null;
      for (const s of socios) {
        const campos = { nome: s.nome, empregado_ids: s.empregadoIds, percentual_padrao: s.percentualPadrao, ativo: s.ativo, updated_by: uid, updated_at: new Date().toISOString() };
        const { error } = s.id ? await db.from("fechamento_socio").update(campos).eq("id", s.id) : await db.from("fechamento_socio").insert(campos);
        if (error) throw error;
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY] }),
  });
}

/** Percentual de cada sócio em cada competência do ano (só os que foram mexidos; sem linha vale o padrão). Chave: "socioId|YYYY-MM". */
export function usePercentuaisDoAno(ano: number) {
  return useQuery({
    queryKey: [KEY, "percentuais", ano],
    staleTime: 60_000,
    queryFn: async (): Promise<Map<string, number>> => {
      const { data, error } = await db.from("fechamento_socio_percentual").select("socio_id, competencia, percentual").gte("competencia", `${ano}-01-01`).lte("competencia", `${ano}-12-01`);
      if (error) throw error;
      return new Map(((data ?? []) as { socio_id: string; competencia: string; percentual: number | string }[]).map((p) => [`${p.socio_id}|${p.competencia.slice(0, 7)}`, num(p.percentual)]));
    },
  });
}

/** Grava o percentual de cada sócio em UMA competência; `null` volta ao padrão (apaga a linha). */
export function useSalvarPercentuaisDoMes() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ mes, percentuais }: { mes: string; percentuais: { socioId: string; percentual: number | null }[] }) => {
      const uid = (await supabase.auth.getUser()).data.user?.id ?? null;
      const competencia = `${mes}-01`;
      for (const p of percentuais) {
        const { error } = p.percentual === null
          ? await db.from("fechamento_socio_percentual").delete().eq("socio_id", p.socioId).eq("competencia", competencia)
          : await db.from("fechamento_socio_percentual").upsert({ socio_id: p.socioId, competencia, percentual: p.percentual, updated_by: uid, updated_at: new Date().toISOString() }, { onConflict: "socio_id,competencia" });
        if (error) throw error;
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY, "percentuais"] }),
  });
}

/** SIS-2026-0925: Reserva de Investimento (%) de cada competência ainda aberta (migration 20261117200000). Sem linha vale 0%. Chave: "YYYY-MM". */
export function useReservasDoAno(ano: number) {
  return useQuery({
    queryKey: [KEY, "reservas", ano],
    staleTime: 60_000,
    queryFn: async (): Promise<Map<string, number>> => {
      const { data, error } = await db.from("fechamento_socio_reserva").select("competencia, percentual").gte("competencia", `${ano}-01-01`).lte("competencia", `${ano}-12-01`);
      // tabela ainda não criada neste ambiente: tudo a 0% (a tela segue como antes)
      if (error) { if (error.code === "42P01" || error.code === "PGRST205") return new Map(); throw error; }
      return new Map(((data ?? []) as { competencia: string; percentual: number | string }[]).map((r) => [r.competencia.slice(0, 7), num(r.percentual)]));
    },
  });
}

/** Grava a Reserva de Investimento (%) de UMA competência; `null` (ou 0) apaga a linha e volta a 0%. */
export function useSalvarReservaDoMes() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ mes, percentual }: { mes: string; percentual: number | null }) => {
      const uid = (await supabase.auth.getUser()).data.user?.id ?? null;
      const competencia = `${mes}-01`;
      const { error } = !percentual
        ? await db.from("fechamento_socio_reserva").delete().eq("competencia", competencia)
        : await db.from("fechamento_socio_reserva").upsert({ competencia, percentual, updated_by: uid, updated_at: new Date().toISOString() }, { onConflict: "competencia" });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY, "reservas"] }),
  });
}

export interface CompetenciaFechada {
  mes: string; // YYYY-MM
  resultadoAntesRetiradas: number;
  consumoEmpresa: number;
  lucroDistribuir: number;
  /** SIS-2026-0925: Reserva de Investimento gravada no fechamento (percentual e valor) */
  reservaPercentual: number;
  reserva: number;
  dataFechamento: string;
  socios: SocioFechado[];
}

export function useCompetenciasFechadas(ano: number) {
  return useQuery({
    queryKey: [KEY, "fechadas", ano],
    staleTime: 30_000,
    queryFn: async (): Promise<Map<string, CompetenciaFechada>> => {
      const de = `${ano}-01-01`;
      const ate = `${ano}-12-01`;
      // com a reserva (SIS-2026-0925); se a migration ainda não foi aplicada (coluna ausente), lê sem ela
      const lerCabecalho = async () => {
        const base = "competencia, resultado_antes_retiradas, consumo_empresa, lucro_distribuir, fechado_em";
        const r = await db.from("fechamento_socio_competencia").select(`${base}, reserva_percentual, reserva_valor`).gte("competencia", de).lte("competencia", ate);
        if (r.error?.code === "42703") return db.from("fechamento_socio_competencia").select(base).gte("competencia", de).lte("competencia", ate);
        return r;
      };
      const [cab, soc] = await Promise.all([
        lerCabecalho(),
        db.from("fechamento_socio_competencia_socio").select("competencia, socio_id, nome, percentual, valor_lucro, retiradas, saldo, complemento_pago").gte("competencia", de).lte("competencia", ate),
      ]);
      if (cab.error) throw cab.error;
      if (soc.error) throw soc.error;
      const out = new Map<string, CompetenciaFechada>();
      for (const c of (cab.data ?? []) as Record<string, string | number>[]) {
        const mes = String(c.competencia).slice(0, 7);
        out.set(mes, {
          mes, resultadoAntesRetiradas: num(c.resultado_antes_retiradas), consumoEmpresa: num(c.consumo_empresa), lucroDistribuir: num(c.lucro_distribuir),
          reservaPercentual: num(c.reserva_percentual), reserva: num(c.reserva_valor),
          dataFechamento: String(c.fechado_em).slice(0, 10), socios: [],
        });
      }
      for (const s of (soc.data ?? []) as Record<string, string | number>[]) {
        out.get(String(s.competencia).slice(0, 7))?.socios.push({
          socioId: String(s.socio_id), nome: String(s.nome), percentual: num(s.percentual), valorLucro: num(s.valor_lucro), retiradas: num(s.retiradas), saldo: num(s.saldo),
          complementoPago: num(s.complemento_pago),
        });
      }
      return out;
    },
  });
}

export function useFecharCompetencia() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (f: { mes: string; resultadoAntesRetiradas: number; consumoEmpresa: number; lucroDistribuir: number; reservaPercentual: number; reserva: number; socios: SocioFechado[] }) => {
      const uid = (await supabase.auth.getUser().then((r) => r.data.user?.id)) ?? null;
      const competencia = `${f.mes}-01`;
      const { error } = await db.from("fechamento_socio_competencia").insert({
        competencia, resultado_antes_retiradas: f.resultadoAntesRetiradas, consumo_empresa: f.consumoEmpresa, lucro_distribuir: f.lucroDistribuir, fechado_por: uid,
        reserva_percentual: f.reservaPercentual, reserva_valor: f.reserva,
      });
      if (error) throw error;
      const { error: e2 } = await db.from("fechamento_socio_competencia_socio").insert(f.socios.map((s) => ({
        competencia, socio_id: s.socioId, nome: s.nome, percentual: s.percentual, valor_lucro: s.valorLucro, retiradas: s.retiradas, saldo: s.saldo, complemento_pago: s.complementoPago,
      })));
      if (e2) {
        // não deixa uma competência "fechada" sem a foto dos sócios
        await db.from("fechamento_socio_competencia").delete().eq("competencia", competencia);
        throw e2;
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY, "fechadas"] }),
  });
}

export function useReabrirCompetencia() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (mes: string) => {
      const competencia = `${mes}-01`;
      // a Reserva de Investimento decidida para o mês volta à tabela das competências abertas (a decisão não se perde ao reabrir)
      const { data: gravada } = await db.from("fechamento_socio_competencia").select("reserva_percentual").eq("competencia", competencia).maybeSingle();
      const pct = num((gravada as { reserva_percentual?: number | string } | null)?.reserva_percentual);
      const { error } = await db.from("fechamento_socio_competencia").delete().eq("competencia", competencia);
      if (error) throw error;
      if (pct > 0) await db.from("fechamento_socio_reserva").upsert({ competencia, percentual: pct, updated_at: new Date().toISOString() }, { onConflict: "competencia" });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: [KEY, "fechadas"] }); qc.invalidateQueries({ queryKey: [KEY, "reservas"] }); },
  });
}

/** Complemento efetivamente pago a um sócio numa competência já fechada. */
export function useSalvarComplementoPago() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ mes, socioId, valor }: { mes: string; socioId: string; valor: number }) => {
      const { error } = await db.from("fechamento_socio_competencia_socio").update({ complemento_pago: valor }).eq("competencia", `${mes}-01`).eq("socio_id", socioId);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY, "fechadas"] }),
  });
}
