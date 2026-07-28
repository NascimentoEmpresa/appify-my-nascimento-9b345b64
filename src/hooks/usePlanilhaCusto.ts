import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useEmpresaAtiva } from "@/context/EmpresaAtivaContext";

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

export interface PostoVigente {
  posto: string;
  valorTotal: number;
  valorUnitario: number;
  qtdColaboradores: number;
}

// Postos vigentes de um contrato (mesma lógica de "data de vigência mais
// recente <= hoje" usada em ContratosERP.tsx, mas agrupando por posto em vez
// de somar tudo no total do contrato).
export function resolverPostosVigentes(rows: PlanilhaCustoRow[], contratoId: string): PostoVigente[] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
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
    const passadas = dates.filter((d) => d <= today).sort((a, b) => b.getTime() - a.getTime());
    vigentePorPosto.set(posto, passadas[0] ?? null);
  });

  const resultado: PostoVigente[] = [];
  for (const r of doContrato) {
    const rowDate = new Date(r.data_vigencia + "T00:00:00");
    const vigente = vigentePorPosto.get(r.posto) ?? null;
    if (!vigente || rowDate.getTime() !== vigente.getTime()) continue;
    resultado.push({
      posto: r.posto,
      valorTotal: (r.total_por_empregado ?? 0) * (r.qt_postos || 1),
      valorUnitario: r.total_por_empregado ?? 0,
      qtdColaboradores: r.qt_postos || 0,
    });
  }
  return resultado;
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
