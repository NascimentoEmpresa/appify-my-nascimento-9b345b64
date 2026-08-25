import { useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useEmpresaAtiva } from "@/context/EmpresaAtivaContext";
import { chaveCampoOutros, GRUPO_OUTROS } from "@/lib/planilhaCustoClassificacoes";

export type JustificativaEntry = {
  ts: string;
  usuario: string;
  texto: string;
};

export type PlanilhaCustoRow = {
  id: string;
  empresa_id: string;
  orexec: string | null;
  cliente: string;
  contrato: string;
  posto: string;
  servico: string | null;
  sindicato: string | null;
  data_vigencia: string | null;
  qt_postos: number;
  arquivo_origem: string | null;
  // Remuneração
  salario: number;
  insalubridade: number;
  periculosidade: number;
  lideranca: number;
  adicional_noturno_reduzido: number;
  adicional_noturno: number;
  adicional_extra: number;
  dsr: number;
  // Encargos
  decimo_terceiro: number;
  adicional_ferias: number;
  incidencia_enc_41: number;
  inss: number;
  salario_educacao: number;
  rat_fap: number;
  sesi: number;
  senai: number;
  sebrae: number;
  incra: number;
  fgts: number;
  seguro_acidente_trabalho: number;
  // Benefícios
  transporte: number;
  transporte_desconto: number;
  aux_alimentacao: number;
  aux_alimentacao_desconto: number;
  aux_refeicao: number;
  beneficio_familiar: number;
  aux_lanche: number;
  seguro_vida: number;
  abono_indenizatorio: number;
  aux_educacao: number;
  cesta_basica: number;
  assistencia_medica: number;
  hospedagem: number;
  odontologico: number;
  manutencao_profissional: number;
  cafe: number;
  almoco: number;
  janta: number;
  ceia: number;
  funeral: number;
  assiduidade: number;
  beneficio_trabalhador: number;
  patronal: number;
  fundo_assistencial: number;
  fundo_profissional: number;
  natalidade: number;
  deducoes: number;
  outros_1: number;
  outros_1_descricao: string | null;
  outros_2: number;
  outros_2_descricao: string | null;
  outros_3: number;
  outros_3_descricao: string | null;
  // Rescisão
  aviso_indenizado: number;
  incidencia_fgts: number;
  multa_rescisoria: number;
  aviso_trabalhado: number;
  incidencia_aviso_trabalhado: number;
  multa_aviso_indenizado: number;
  contratualidade: number;
  // Reposição
  sub_ferias: number;
  sub_ausencias_legais: number;
  sub_paternidade: number;
  sub_acidente_trabalho: number;
  sub_maternidade: number;
  sub_doenca: number;
  sub_repouso: number;
  incidencia_maternidade: number;
  incidencia_enc_reposicao: number;
  incidencia_enc_reposicao_2: number;
  incidencia_enc_reposicao_3: number;
  incidencia_enc_reposicao_4: number;
  // Insumos
  uniforme: number;
  epi: number;
  epc: number;
  materiais: number;
  equipamentos: number;
  relogio_digital: number;
  ponto_eletronico: number;
  outros_insumos: number;
  // Custos/Tributos
  custos_indiretos: number;
  lucro: number;
  cofins: number;
  pis: number;
  irpj_csll: number;
  iss: number;
  total_por_empregado: number;
  encerrado: boolean;
  data_encerramento: string | null;
  justificativa_divergencia: JustificativaEntry[];
  contrato_id: string | null;
  created_at: string;
  updated_at: string;
};

export type PlanilhaCustoInsert = Omit<PlanilhaCustoRow, "id" | "created_at" | "updated_at">;

export const formatBRL = (v: number | null | undefined) =>
  (v ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

// "2026-08" -> último dia de agosto/2026 — data de referência usada pra
// resolver qual vigência conta pro período selecionado nos filtros
// (SIS-2026-0168), no lugar de "hoje".
export function fimDoMes(anoMes: string): Date {
  const [ano, mes] = anoMes.split("-").map(Number);
  const d = new Date(ano, mes, 0);
  d.setHours(0, 0, 0, 0);
  return d;
}

// "YYYY-MM" de hoje — valor default do filtro Ano/Mês.
export function anoMesAtual(): string {
  const hoje = new Date();
  return `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}`;
}

export interface PostoVigente {
  posto: string;
  valorTotal: number;
  valorUnitario: number;
  qtdColaboradores: number;
}

// Linhas vigentes de um contrato: "data de vigência mais recente <= hoje,
// por posto" (mesma lógica usada em ContratosERP.tsx). Compartilhada entre
// resolverPostosVigentes (soma total_por_empregado) e resolverValorPorCampos
// (soma rubricas específicas, ex.: EPI) — pra não duplicar a resolução de
// vigência em dois lugares.
export function resolverLinhasVigentes(rows: PlanilhaCustoRow[], contratoId: string): PlanilhaCustoRow[] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return resolverLinhasPorPeriodo(rows, contratoId, today);
}

// Igual a resolverLinhasVigentes, mas resolve pra uma data de referência
// arbitrária em vez de "hoje" — usado pelo Orçamento Geral (SIS-2026-0168)
// pra achar a vigência que cobre o Ano/Mês selecionado no filtro, mesmo
// que hoje ela já esteja Histórico ou ainda "Vai iniciar" (a Planilha de
// Custo já tem vigências com data_vigencia futura de verdade).
export function resolverLinhasPorPeriodo(rows: PlanilhaCustoRow[], contratoId: string, referencia: Date): PlanilhaCustoRow[] {
  const doContrato = rows.filter((r) => r.contrato_id === contratoId && r.orexec === "EXECUTADO" && !r.encerrado && r.data_vigencia);

  const datasPorPosto = new Map<string, Date[]>();
  for (const r of doContrato) {
    const d = new Date(r.data_vigencia + "T00:00:00");
    const arr = datasPorPosto.get(r.posto) ?? [];
    arr.push(d);
    datasPorPosto.set(r.posto, arr);
  }
  const vigentePorPosto = new Map<string, Date | null>();
  datasPorPosto.forEach((dates, posto) => {
    const passadas = dates.filter((d) => d <= referencia).sort((a, b) => b.getTime() - a.getTime());
    vigentePorPosto.set(posto, passadas[0] ?? null);
  });

  return doContrato.filter((r) => {
    const rowDate = new Date(r.data_vigencia + "T00:00:00");
    const vigente = vigentePorPosto.get(r.posto) ?? null;
    return !!vigente && rowDate.getTime() === vigente.getTime();
  });
}

// Postos vigentes de um contrato, agrupando por posto (total_por_empregado).
export function resolverPostosVigentes(rows: PlanilhaCustoRow[], contratoId: string): PostoVigente[] {
  return resolverLinhasVigentes(rows, contratoId).map((r) => ({
    posto: r.posto,
    // Posto sem ninguém (qt_postos = 0) zera o Total Posto — mesma regra
    // já aplicada em PlanilhaCusto.tsx (a pedido do Iury): não usar "|| 1"
    // aqui, senão volta a contar como 1 pessoa fictícia.
    valorTotal: (r.total_por_empregado ?? 0) * (r.qt_postos || 0),
    valorUnitario: r.total_por_empregado ?? 0,
    qtdColaboradores: r.qt_postos || 0,
  }));
}

// Soma rubricas específicas (ex.: ["epi", "epc"]) das linhas vigentes de um
// contrato — base do Orçamento de Contratos (SIS-2026-0125): cada
// Classificação do Malote do tipo "contrato" é ligada a uma ou mais
// rubricas fixas da planilha de custo (malote_licitacao_classificacao_link),
// e o valor orçado é a soma dessas rubricas nas linhas vigentes.
export function resolverValorPorCampos(rows: PlanilhaCustoRow[], contratoId: string, campos: string[]): number {
  return somarCamposEmLinhas(resolverLinhasVigentes(rows, contratoId), campos);
}

// Mesma soma de resolverValorPorCampos, mas recebendo as linhas vigentes já
// resolvidas — evita recalcular a resolução de vigência a cada rubrica
// quando o chamador precisa somar várias rubricas do mesmo contrato (ex.:
// useOrcamentoContratos, que soma ~80 rubricas por contrato).
export function somarCamposEmLinhas(linhasVigentes: PlanilhaCustoRow[], campos: string[]): number {
  return linhasVigentes.reduce((soma, r) => {
    const valorLinha = campos.reduce((s, campo) => s + (Number((r as any)[campo]) || 0), 0);
    // Posto sem ninguém (qt_postos = 0) zera a contribuição dessa linha —
    // "|| 1" faria um posto zerado contar como 1 pessoa fictícia no Orçado.
    return soma + valorLinha * (r.qt_postos || 0);
  }, 0);
}

export interface DescricaoOutros {
  campo: string; // chaveCampoOutros(descricao) — mesma chave usada em useOrcamentoContratos
  label: string; // descrição original (primeira grafia encontrada)
  grupo: string;
}

// Descrições distintas já digitadas em outros_1/2/3 de QUALQUER contrato —
// pra Configurações → Ligação (SIS-2026-0168, a pedido do Iury) oferecer
// cada descrição como algo ligável a uma Classificação do Malote, já que
// esses campos não têm uma "classificação" fixa (ver
// planilhaCustoClassificacoes.ts). Não filtra por vigência/contrato: a
// ligação vale pra descrição em qualquer lugar que ela apareça.
export function useDescricoesOutros() {
  const { data: rows = [], isLoading } = usePlanilhaCustos();
  const data = useMemo(() => {
    const porChave = new Map<string, string>();
    for (const r of rows) {
      for (const campo of ["outros_1_descricao", "outros_2_descricao", "outros_3_descricao"] as const) {
        const desc = (r[campo] ?? "").trim();
        if (!desc) continue;
        const chave = chaveCampoOutros(desc);
        if (!porChave.has(chave)) porChave.set(chave, desc);
      }
    }
    return Array.from(porChave.entries())
      .map(([campo, label]): DescricaoOutros => ({ campo, label, grupo: GRUPO_OUTROS }))
      .sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));
  }, [rows]);
  return { data, isLoading };
}

export function usePlanilhaCustos(filtros?: { cliente?: string; contrato?: string; q?: string }) {
  const { empresa } = useEmpresaAtiva();
  return useQuery({
    queryKey: ["planilha_custo", empresa.id, filtros],
    queryFn: async () => {
      // Busca em lotes de 1000 para contornar o limite do PostgREST
      const PAGE = 1000;
      let all: PlanilhaCustoRow[] = [];
      let from = 0;
      while (true) {
        let q = (supabase as any)
          .from("planilha_custo")
          .select("*")
          .eq("empresa_id", empresa.id)
          .order("created_at", { ascending: false })
          .range(from, from + PAGE - 1);
        if (filtros?.cliente) q = q.ilike("cliente", `%${filtros.cliente}%`);
        if (filtros?.contrato) q = q.ilike("contrato", `%${filtros.contrato}%`);
        const { data, error } = await q;
        if (error) throw error;
        all = all.concat(data ?? []);
        if (!data || data.length < PAGE) break;
        from += PAGE;
      }
      return all;
    },
  });
}

export function useSavePlanilhaCusto() {
  const qc = useQueryClient();
  const { empresa } = useEmpresaAtiva();
  return useMutation({
    mutationFn: async (payload: Partial<PlanilhaCustoRow> & { id?: string }) => {
      const { id, ...rest } = payload;
      if (id) {
        const { data, error } = await (supabase as any)
          .from("planilha_custo")
          .update({ ...rest, updated_at: new Date().toISOString() })
          .eq("id", id)
          .select()
          .single();
        if (error) throw error;
        return data;
      } else {
        const { data, error } = await (supabase as any)
          .from("planilha_custo")
          .insert({ ...rest, empresa_id: empresa.id })
          .select()
          .single();
        if (error) throw error;
        return data;
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["planilha_custo"] }),
  });
}

export function useDeletePlanilhaCusto() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).from("planilha_custo").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["planilha_custo"] }),
  });
}

export function useEncerrarContrato() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ contrato, data_encerramento }: { contrato: string; data_encerramento: string }) => {
      const { error } = await (supabase as any)
        .from("planilha_custo")
        .update({ encerrado: true, data_encerramento, updated_at: new Date().toISOString() })
        .eq("contrato", contrato);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["planilha_custo"] }),
  });
}

export function useSalvarJustificativaDivergencia() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      contrato,
      texto,
      rowsDoContrato,
    }: {
      contrato: string;
      texto: string;
      rowsDoContrato: PlanilhaCustoRow[];
    }) => {
      const { data: authData } = await supabase.auth.getUser();
      const { data: profile } = authData?.user
        ? await (supabase as any).from("profiles").select("display_name, email").eq("id", authData.user.id).maybeSingle()
        : { data: null };
      const usuario = profile?.display_name || profile?.email || authData?.user?.email || "—";

      const existing: JustificativaEntry[] = rowsDoContrato[0]?.justificativa_divergencia ?? [];
      const nova: JustificativaEntry = {
        ts: new Date().toLocaleString("pt-BR"),
        usuario,
        texto,
      };
      const atualizado = [...existing, nova];

      const ids = rowsDoContrato.map((r) => r.id);
      const { error } = await (supabase as any)
        .from("planilha_custo")
        .update({ justificativa_divergencia: atualizado, updated_at: new Date().toISOString() })
        .in("id", ids);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["planilha_custo"] }),
  });
}

export function useBulkInsertPlanilhaCusto() {
  const qc = useQueryClient();
  const { empresa } = useEmpresaAtiva();
  return useMutation({
    mutationFn: async (rows: Omit<PlanilhaCustoInsert, "empresa_id">[]) => {
      const payload = rows.map((r) => ({ ...r, empresa_id: empresa.id }));
      const { error } = await (supabase as any).from("planilha_custo").insert(payload);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["planilha_custo"] }),
  });
}
