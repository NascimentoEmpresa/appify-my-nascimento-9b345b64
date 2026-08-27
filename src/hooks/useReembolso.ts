import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import type { StatusReembolso, TipoReembolso } from "@/lib/reembolso/regras";

/**
 * Dados do Solicitar Reembolso (Central de Serviços).
 *
 * As tabelas nasceram na migration 20260930000006 e ainda não estão em
 * `integrations/supabase/types.ts` — o arquivo é gerado à mão, fora do CI. Daí
 * os `as any` nas chamadas: é o mesmo que os módulos recentes fazem enquanto
 * os tipos não são regerados, não é gambiarra local.
 */

export const BUCKET_REEMBOLSO = "reembolsos";

export interface Reembolso {
  id: string;
  numero: string | null;
  solicitante_id: string;
  solicitante_nome: string | null;
  setor: string | null;
  competencia: string;
  pix: string;
  distancia_km: number;
  data_viagem: string;
  saida: string;
  chegada: string;
  observacoes: string | null;
  total_centavos: number;
  status: StatusReembolso;
  decidido_por_nome: string | null;
  decidido_em: string | null;
  motivo_reprovacao: string | null;
  created_at: string;
}

export interface ItemReembolso {
  id: string;
  reembolso_id: string;
  tipo_codigo: string;
  valor_centavos: number;
  storage_path: string;
  nome_arquivo: string | null;
  mime_type: string | null;
  tamanho_bytes: number | null;
}

export interface EventoReembolso {
  id: string;
  reembolso_id: string;
  tipo: string;
  descricao: string | null;
  autor_nome: string | null;
  created_at: string;
}

const sb = supabase as any;

// ── Catálogo de tipos ────────────────────────────────────────────────
/**
 * O catálogo é lido por TODO mundo (a tela de solicitar precisa do teto e da
 * janela para avisar antes de a pessoa preencher) e escrito só por quem tem
 * `central_servicos_reembolso_config` — quem decide isso é a RLS, não daqui.
 */
export function useTiposReembolso() {
  return useQuery({
    queryKey: ["reembolso_tipos"],
    queryFn: async (): Promise<TipoReembolso[]> => {
      const { data, error } = await sb
        .from("CS_REEMBOLSO_TIPO")
        .select("codigo, nome, valor_maximo_centavos, hora_inicio, hora_fim, ativo, ordem")
        .order("ordem", { ascending: true });
      if (error) throw error;
      return (data ?? []).map((t: any) => ({
        ...t,
        // O banco devolve `time` como "11:00:00"; a tela e as regras trabalham
        // com "HH:MM" e comparam string em alguns lugares.
        hora_inicio: t.hora_inicio ? String(t.hora_inicio).slice(0, 5) : null,
        hora_fim: t.hora_fim ? String(t.hora_fim).slice(0, 5) : null,
      }));
    },
  });
}

export function useSalvarTipo() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (tipo: TipoReembolso & { novo?: boolean }) => {
      const linha = {
        codigo: tipo.codigo,
        nome: tipo.nome,
        valor_maximo_centavos: tipo.valor_maximo_centavos,
        hora_inicio: tipo.hora_inicio,
        hora_fim: tipo.hora_fim,
        ativo: tipo.ativo,
        ordem: tipo.ordem,
        atualizado_por: user?.id ?? null,
        atualizado_por_nome: user?.user_metadata?.display_name ?? user?.email ?? null,
      };
      const { error } = tipo.novo
        ? await sb.from("CS_REEMBOLSO_TIPO").insert(linha)
        : await sb.from("CS_REEMBOLSO_TIPO").update(linha).eq("codigo", tipo.codigo);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["reembolso_tipos"] }),
  });
}

// ── Solicitações ─────────────────────────────────────────────────────
/**
 * `escopo: "meus"` filtra por solicitante; `"fila"` traz o que a RLS deixar
 * ver — que já é o recorte por setor de quem lidera (ver
 * `cs_reembolso_lidera_setor` na migration). O front não repete esse recorte
 * de propósito: duas cópias da mesma regra divergem com o tempo.
 */
export function useReembolsos(escopo: "meus" | "fila", competencia?: string, status?: StatusReembolso | "todos") {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["reembolsos", escopo, competencia ?? "", status ?? "todos", user?.id ?? ""],
    queryFn: async (): Promise<Reembolso[]> => {
      let q = sb.from("CS_REEMBOLSO").select("*").order("created_at", { ascending: false });
      if (escopo === "meus" && user?.id) q = q.eq("solicitante_id", user.id);
      if (competencia) q = q.eq("competencia", competencia);
      if (status && status !== "todos") q = q.eq("status", status);
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
    enabled: escopo === "fila" || !!user?.id,
  });
}

export function useItensReembolso(reembolsoId: string | null) {
  return useQuery({
    queryKey: ["reembolso_itens", reembolsoId ?? ""],
    queryFn: async (): Promise<ItemReembolso[]> => {
      const { data, error } = await sb
        .from("CS_REEMBOLSO_ITEM").select("*").eq("reembolso_id", reembolsoId);
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!reembolsoId,
  });
}

export function useEventosReembolso(reembolsoId: string | null) {
  return useQuery({
    queryKey: ["reembolso_eventos", reembolsoId ?? ""],
    queryFn: async (): Promise<EventoReembolso[]> => {
      const { data, error } = await sb
        .from("CS_REEMBOLSO_EVENTO").select("*")
        .eq("reembolso_id", reembolsoId).order("created_at", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!reembolsoId,
  });
}

export function useMeusStats() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["reembolso_meus_stats", user?.id ?? ""],
    queryFn: async () => {
      const { data, error } = await sb.rpc("cs_reembolso_meus_stats");
      if (error) throw error;
      return (data?.[0] ?? {
        pendentes: 0, aprovados: 0, reprovados: 0, total_aprovado_centavos: 0,
      }) as { pendentes: number; aprovados: number; reprovados: number; total_aprovado_centavos: number };
    },
    enabled: !!user?.id,
  });
}

// ── Escrita ──────────────────────────────────────────────────────────
export interface DespesaNova {
  tipo_codigo: string;
  valor_centavos: number;
  arquivo: File;
}

export interface SolicitacaoNova {
  pix: string;
  distancia_km: number;
  data_viagem: string;   // ISO
  competencia: string;   // AAAA-MM
  saida: string;         // HH:MM
  chegada: string;       // HH:MM
  observacoes: string | null;
  solicitante_nome: string | null;
  setor: string | null;
  despesas: DespesaNova[];
}

/**
 * Cria a solicitação e sobe um comprovante por despesa.
 *
 * O comprovante sobe ANTES do item: a coluna `storage_path` é NOT NULL porque
 * o bot travava o "concluir" enquanto faltasse anexo, e sem o arquivo o
 * financeiro não presta contas. Se um item falhar, a solicitação inteira é
 * apagada — meia solicitação no banco é pior que nenhuma, porque some da tela
 * de quem pediu e aparece na fila de quem aprova.
 */
export function useCriarReembolso() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (nova: SolicitacaoNova) => {
      const { data: cabecalho, error } = await sb.from("CS_REEMBOLSO").insert({
        pix: nova.pix,
        distancia_km: nova.distancia_km,
        data_viagem: nova.data_viagem,
        competencia: nova.competencia,
        saida: nova.saida,
        chegada: nova.chegada,
        observacoes: nova.observacoes,
        solicitante_nome: nova.solicitante_nome,
        setor: nova.setor,
      }).select("id, numero").single();
      if (error) throw error;

      try {
        for (const d of nova.despesas) {
          const limpo = d.arquivo.name.replace(/[^\w.-]+/g, "_");
          const caminho = `${cabecalho.id}/${d.tipo_codigo}-${Date.now()}-${limpo}`;
          const up = await supabase.storage
            .from(BUCKET_REEMBOLSO)
            .upload(caminho, d.arquivo, { contentType: d.arquivo.type });
          if (up.error) throw up.error;

          const { error: erroItem } = await sb.from("CS_REEMBOLSO_ITEM").insert({
            reembolso_id: cabecalho.id,
            tipo_codigo: d.tipo_codigo,
            valor_centavos: d.valor_centavos,
            storage_path: caminho,
            nome_arquivo: d.arquivo.name,
            mime_type: d.arquivo.type || null,
            tamanho_bytes: d.arquivo.size,
          });
          // A mensagem da trigger de teto/janela vem por aqui — é ela que o
          // usuário precisa ler, não um "erro ao salvar" genérico.
          if (erroItem) throw erroItem;
        }
      } catch (e) {
        await sb.from("CS_REEMBOLSO").delete().eq("id", cabecalho.id);
        throw e;
      }

      return cabecalho as { id: string; numero: string | null };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["reembolsos"] });
      qc.invalidateQueries({ queryKey: ["reembolso_meus_stats"] });
    },
  });
}

/**
 * Aprovar, reprovar ou cancelar.
 *
 * Quem pode o quê é decidido no banco (policy + `cs_reembolso_guard`), não
 * aqui: esta função só monta o patch. Um erro voltando daqui costuma ser a
 * trigger recusando a transição, e a mensagem dela é legível — mostre-a.
 */
export function useDecidirReembolso() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (
      args: { id: string; acao: "aprovar" | "reprovar" | "cancelar"; motivo?: string },
    ) => {
      const nome = user?.user_metadata?.display_name ?? user?.email ?? null;
      const patch: Record<string, unknown> =
        args.acao === "cancelar"
          ? { status: "cancelado" }
          : {
              status: args.acao === "aprovar" ? "aprovado" : "reprovado",
              decidido_por: user?.id ?? null,
              decidido_por_nome: nome,
              decidido_em: new Date().toISOString(),
              motivo_reprovacao: args.acao === "reprovar" ? (args.motivo ?? null) : null,
            };

      const { error } = await sb.from("CS_REEMBOLSO").update(patch).eq("id", args.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["reembolsos"] });
      qc.invalidateQueries({ queryKey: ["reembolso_meus_stats"] });
      qc.invalidateQueries({ queryKey: ["reembolso_eventos"] });
    },
  });
}

/** Link temporário do comprovante — o bucket é privado. */
export async function urlDoComprovante(storagePath: string): Promise<string | null> {
  const { data, error } = await supabase.storage
    .from(BUCKET_REEMBOLSO).createSignedUrl(storagePath, 3600);
  if (error) return null;
  return data?.signedUrl ?? null;
}
