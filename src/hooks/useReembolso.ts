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
  /** Preenchido quando já virou despesa no Malote — trava o reenvio. */
  malote_despesa_id: string | null;
  enviado_malote_em: string | null;
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
 * `escopo: "meus"` filtra por solicitante; `"fila"` traz SÓ o que a pessoa
 * aprova.
 *
 * A fila vem da RPC `cs_reembolso_fila` e não de um SELECT na tabela. Não é
 * preciosismo: a policy de SELECT precisa do ramo `solicitante_id =
 * auth.uid()` para o dono ver a própria solicitação em "Minhas solicitações",
 * e um SELECT sem filtro na tela de aprovação herdava esse ramo — a pessoa via
 * os PRÓPRIOS reembolsos numa fila onde o guard depois respondia "Você não
 * aprova reembolso do setor X". A RPC aplica o par menu + `aprova_setor` sem o
 * ramo do dono, e continua sendo uma cópia só da regra, no banco.
 */
export function useReembolsos(escopo: "meus" | "fila", competencia?: string, status?: StatusReembolso | "todos") {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["reembolsos", escopo, competencia ?? "", status ?? "todos", user?.id ?? ""],
    queryFn: async (): Promise<Reembolso[]> => {
      if (escopo === "fila") {
        const { data, error } = await sb.rpc("cs_reembolso_fila", {
          _status: status && status !== "todos" ? status : null,
        });
        if (error) throw error;
        const lista = (data ?? []) as Reembolso[];
        return competencia ? lista.filter((r) => r.competencia === competencia) : lista;
      }

      let q = sb.from("CS_REEMBOLSO").select("*").order("created_at", { ascending: false });
      if (user?.id) q = q.eq("solicitante_id", user.id);
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
  despesas: DespesaNova[];
  // `setor` NÃO entra aqui de propósito: quem carimba é a trigger
  // `cs_reembolso_carimba_setor`, a partir do cadastro. O setor decide QUEM
  // aprova — deixá-lo vir do cliente seria deixar a pessoa escolher o próprio
  // aprovador.

  /**
   * Onde o envio está, para a tela contar em voz alta.
   *
   * O envio não é uma chamada só: é cabeçalho, depois um upload e um insert
   * POR despesa. Com três comprovantes de celular numa rede de obra isso passa
   * fácil de dez segundos, e um spinner mudo nesse tempo é indistinguível de
   * travamento. `etapa` é o que a pessoa lê; `indice`/`total` alimentam a
   * barra.
   */
  onProgresso?: (p: EtapaEnvio) => void;
}

export interface EtapaEnvio {
  etapa: "abrindo" | "comprovante" | "registrando" | "concluido";
  indice: number;   // 1-based, dentro de `total`
  total: number;    // quantidade de despesas
  nomeArquivo?: string;
}

/**
 * Cria a solicitação e sobe um comprovante por despesa.
 *
 * O comprovante sobe ANTES do item: a coluna `storage_path` é NOT NULL porque
 * o bot travava o "concluir" enquanto faltasse anexo, e sem o arquivo o
 * financeiro não presta contas. Se um item falhar, a solicitação inteira é
 * apagada — meia solicitação no banco é pior que nenhuma, porque some da tela
 * de quem pediu e aparece na fila de quem aprova.
 *
 * ⚠️ Esse rollback foi decorativo até 01/09/2026: `CS_REEMBOLSO` não tinha
 * GRANT de DELETE, então o `delete` voltava sem erro e sem apagar nada, e cada
 * envio que falhava largava um REEMB pendente de R$ 0,00 sem despesa nenhuma.
 * A permissão veio na 20260930000027, estreita (dono, pendente, sem itens). Se
 * o delete ainda assim não pegar, a solicitação é cancelada — visível, mas
 * inerte — em vez de ficar pendurada na fila de alguém.
 */
export function useCriarReembolso() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (nova: SolicitacaoNova) => {
      const total = nova.despesas.length;
      const avisa = (p: EtapaEnvio) => nova.onProgresso?.(p);

      avisa({ etapa: "abrindo", indice: 0, total });
      const { data: cabecalho, error } = await sb.from("CS_REEMBOLSO").insert({
        pix: nova.pix,
        distancia_km: nova.distancia_km,
        data_viagem: nova.data_viagem,
        competencia: nova.competencia,
        saida: nova.saida,
        chegada: nova.chegada,
        observacoes: nova.observacoes,
        solicitante_nome: nova.solicitante_nome,
      }).select("id, numero").single();
      if (error) throw error;

      try {
        for (const [i, d] of nova.despesas.entries()) {
          const limpo = d.arquivo.name.replace(/[^\w.-]+/g, "_");
          const caminho = `${cabecalho.id}/${d.tipo_codigo}-${Date.now()}-${limpo}`;
          avisa({
            etapa: "comprovante", indice: i + 1, total, nomeArquivo: d.arquivo.name,
          });
          const up = await supabase.storage
            .from(BUCKET_REEMBOLSO)
            .upload(caminho, d.arquivo, { contentType: d.arquivo.type });
          if (up.error) throw up.error;

          avisa({
            etapa: "registrando", indice: i + 1, total, nomeArquivo: d.arquivo.name,
          });
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
        const { error: erroDelete } = await sb
          .from("CS_REEMBOLSO").delete().eq("id", cabecalho.id);
        if (erroDelete) {
          await sb.from("CS_REEMBOLSO")
            .update({ status: "cancelado" }).eq("id", cabecalho.id);
        }
        throw e;
      }

      avisa({ etapa: "concluido", indice: total, total });
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

/**
 * O setor de quem está pedindo, resolvido PELO BANCO.
 *
 * Sai de `user_setor` — o setor marcado em Administração › Acesso por Usuário,
 * do catálogo do ERP. Vem daqui e não do `useVinculoEmpregado` para a tela
 * mostrar exatamente o que a trigger vai carimbar: se os dois discordassem, a
 * pessoa veria "Sistemas" na tela e a solicitação chegaria para o aprovador de
 * outro setor.
 *
 * EMPREGADOS ERA a primeira fonte e saiu em 02/09/2026. O Senior guarda o
 * setor da FOLHA, onde 547 das 630 pessoas são `PADRAO` — um setor que não
 * existe no ERP e que ninguém aprova. As solicitações do Jurídico nasciam
 * carimbadas assim e sumiam da fila de quem devia decidir. Ver a migration
 * 20260930000040.
 *
 * `null` significa cadastro sem setor, OU com mais de um: nos dois casos a
 * tela bloqueia e explica, em vez de deixar abrir uma solicitação que ninguém
 * pode aprovar ou de chutar entre dois aprovadores.
 */
export function useMeuSetor() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["reembolso_meu_setor", user?.id ?? ""],
    queryFn: async (): Promise<string | null> => {
      const { data, error } = await sb.rpc("cs_reembolso_meu_setor");
      if (error) throw error;
      return (typeof data === "string" && data.trim()) ? data : null;
    },
    enabled: !!user?.id,
  });
}

export interface ConfigReembolso {
  empresa_id: string | null;
  classificacao_id: string | null;
  forma_pagamento: string | null;
  tipo_movimento: string | null;
}

/** Os padrões usados ao criar a despesa no Malote. Linha única. */
export function useConfigReembolso() {
  return useQuery({
    queryKey: ["reembolso_config"],
    queryFn: async (): Promise<ConfigReembolso> => {
      const { data, error } = await sb
        .from("CS_REEMBOLSO_CONFIG")
        .select("empresa_id, classificacao_id, forma_pagamento, tipo_movimento")
        .maybeSingle();
      if (error) throw error;
      return data ?? {
        empresa_id: null, classificacao_id: null, forma_pagamento: null, tipo_movimento: null,
      };
    },
  });
}

export function useSalvarConfigReembolso() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (cfg: ConfigReembolso) => {
      const { error } = await sb.from("CS_REEMBOLSO_CONFIG").update({
        ...cfg,
        atualizado_por: user?.id ?? null,
        atualizado_por_nome: user?.user_metadata?.display_name ?? user?.email ?? null,
        updated_at: new Date().toISOString(),
      }).eq("id", true);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["reembolso_config"] }),
  });
}

/**
 * Aprova e JÁ lança a despesa no Malote, numa transação só.
 *
 * É o que o botão Aprovar chama desde 02/09/2026. Antes eram dois cliques —
 * aprovar, e depois um "Enviar ao malote" que quase ninguém dava, deixando o
 * reembolso aprovado e o dinheiro em lugar nenhum.
 *
 * Se o Malote recusar, a aprovação volta atrás junto (é uma função, logo uma
 * transação) e a mensagem da RPC diz o motivo — normalmente "falta escolher a
 * classificação em Tipos e Limites". Meio caminho aqui seria reproduzir
 * exatamente o estado que esta mudança existe para eliminar.
 */
export function useAprovarELancar() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string): Promise<string> => {
      const { data, error } = await sb.rpc("cs_reembolso_aprovar_e_lancar", { _id: id });
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["reembolsos"] });
      qc.invalidateQueries({ queryKey: ["reembolso_meus_stats"] });
      qc.invalidateQueries({ queryKey: ["reembolso_eventos"] });
    },
  });
}

/**
 * Cria a despesa no Malote a partir do reembolso aprovado.
 *
 * Continua existindo para as solicitações que já estavam em `aprovado` antes
 * de aprovar passar a lançar sozinho — sem isto elas ficariam encalhadas, sem
 * botão nenhum que as levasse ao Malote.
 *
 * Toda a regra está na RPC (`cs_reembolso_enviar_ao_malote`): ela confere que
 * quem chamou aprova aquele setor, que o reembolso está aprovado, e devolve a
 * despesa já existente se for chamada de novo. O front não repete nada disso —
 * só mostra o que voltar.
 */
export function useEnviarAoMalote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string): Promise<string> => {
      const { data, error } = await sb.rpc("cs_reembolso_enviar_ao_malote", { _id: id });
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["reembolsos"] });
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
