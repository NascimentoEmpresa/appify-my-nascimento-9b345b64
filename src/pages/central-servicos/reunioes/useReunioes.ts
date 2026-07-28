import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import type { BloqueioAgenda, Finalidade, NotificarPor, Reuniao, ReuniaoCalendario, ResultadoEsperado, TipoLocalReuniao, TipoReuniao, Usuario } from "./types";
import { registrarLog } from "./registrarLog";

const REUNIAO_COLUNAS =
  "id, numero, titulo, objetivo, data_hora, duracao_minutos, tipo_local, local_ou_link, link_online, etapa, criado_por, organizador_user_id, responsavel_preenchimento_user_id, tipo_reuniao, finalidade, resultado_esperado, notificar_por, setor_responsavel, justificativa_alteracao_duracao, serie_recorrencia_id, motivo_cancelamento, created_at, updated_at";

/** Calendário geral: todas as reuniões da empresa (recorte mínimo) — abrir o card ainda exige interação, via RLS de "reuniao". */
export function useReunioes() {
  return useQuery({
    queryKey: ["reuniao-calendario"],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("listar_reunioes_calendario");
      if (error) throw error;
      return (data ?? []) as ReuniaoCalendario[];
    },
  });
}

export function useMinhasReunioes() {
  return useQuery({
    queryKey: ["reuniao-minhas"],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("listar_minhas_reunioes");
      if (error) throw error;
      return (data ?? []) as Reuniao[];
    },
  });
}

export function useOcultarReuniaoDaHome() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (reuniaoId: string) => {
      const { error } = await (supabase as any)
        .from("reuniao_home_ocultada")
        .insert({ reuniao_id: reuniaoId });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["reuniao-minhas"] });
    },
  });
}

/** Sobreposição de horário: mesma sala presencial, mesma faixa de tempo, reunião não cancelada. */
export async function verificarConflitoSala(params: {
  local: string;
  dataHoraIso: string;
  duracaoMinutos: number;
  reuniaoIdIgnorar?: string;
}): Promise<Reuniao | null> {
  const inicio = new Date(params.dataHoraIso);
  const fim = new Date(inicio.getTime() + params.duracaoMinutos * 60_000);

  let query = (supabase as any)
    .from("reuniao")
    .select(REUNIAO_COLUNAS)
    .in("tipo_local", ["presencial", "hibrido"])
    .eq("local_ou_link", params.local)
    .neq("etapa", "cancelada");
  if (params.reuniaoIdIgnorar) {
    query = query.neq("id", params.reuniaoIdIgnorar);
  }
  const { data, error } = await query;
  if (error) throw error;

  const conflito = ((data ?? []) as Reuniao[]).find((r) => {
    const outroInicio = new Date(r.data_hora);
    const outroFim = new Date(outroInicio.getTime() + (r.duracao_minutos ?? 60) * 60_000);
    return inicio < outroFim && outroInicio < fim;
  });
  return conflito ?? null;
}

/** Sobreposição de horário: mesma pessoa convidada em duas reuniões não canceladas na mesma faixa de tempo. */
export async function verificarConflitoParticipante(params: {
  userId: string;
  dataHoraIso: string;
  duracaoMinutos: number;
  reuniaoIdIgnorar?: string;
}): Promise<Reuniao | null> {
  const inicio = new Date(params.dataHoraIso);
  const fim = new Date(inicio.getTime() + params.duracaoMinutos * 60_000);

  const { data, error } = await (supabase as any)
    .from("reuniao_convidado")
    .select(`reuniao:reuniao_id (${REUNIAO_COLUNAS})`)
    .eq("user_id", params.userId);
  if (error) throw error;

  const reunioes = ((data ?? []) as { reuniao: Reuniao | null }[])
    .map((row) => row.reuniao)
    .filter((r): r is Reuniao => !!r && r.etapa !== "cancelada" && r.id !== params.reuniaoIdIgnorar);

  const conflito = reunioes.find((r) => {
    const outroInicio = new Date(r.data_hora);
    const outroFim = new Date(outroInicio.getTime() + (r.duracao_minutos ?? 60) * 60_000);
    return inicio < outroFim && outroInicio < fim;
  });
  return conflito ?? null;
}

/**
 * Sobreposição pura entre um bloqueio já carregado e uma janela de
 * data/hora — mesma lógica usada pelo trigger pessoa_tem_bloqueio_agenda
 * no banco (inclusive a mesma particularidade de bloqueio parcial de
 * horário usar sempre data_inicio como referência de dia, não data_fim).
 * Sem I/O — pra reaproveitar sobre bloqueios já buscados (aviso ao vivo no
 * formulário), sem uma query nova a cada tecla.
 */
export function bloqueioSobrepoe(b: BloqueioAgenda, dataHoraIso: string, duracaoMinutos: number): boolean {
  const inicio = new Date(dataHoraIso);
  const fim = new Date(inicio.getTime() + duracaoMinutos * 60_000);
  const bInicio = b.dia_inteiro ? new Date(`${b.data_inicio}T00:00:00`) : new Date(`${b.data_inicio}T${b.hora_inicio}`);
  const bFim = b.dia_inteiro
    ? new Date(new Date(`${b.data_fim}T00:00:00`).getTime() + 24 * 60 * 60_000)
    : new Date(`${b.data_inicio}T${b.hora_fim}`);
  return inicio < bFim && bInicio < fim;
}

/**
 * Busca do banco + checa sobreposição de bloqueio de agenda de uma pessoa.
 * A RLS de reuniao_bloqueio_agenda agora é visível pra qualquer um com
 * acesso à Agenda de Reunião (não só o dono) — funciona pra checar
 * qualquer pessoa envolvida na reunião, não só quem está logado.
 */
export async function verificarBloqueioAgenda(params: {
  userId: string;
  dataHoraIso: string;
  duracaoMinutos: number;
}): Promise<BloqueioAgenda | null> {
  const { data, error } = await (supabase as any)
    .from("reuniao_bloqueio_agenda")
    .select("id, user_id, tipo, data_inicio, data_fim, dia_inteiro, hora_inicio, hora_fim, motivo, motivo_outro, created_at")
    .eq("user_id", params.userId);
  if (error) throw error;

  const conflito = ((data ?? []) as BloqueioAgenda[]).find((b) => bloqueioSobrepoe(b, params.dataHoraIso, params.duracaoMinutos));
  return conflito ?? null;
}

export function useUsuariosAtivos() {
  return useQuery({
    queryKey: ["reunioes-usuarios-ativos"],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("listar_usuarios_ativos");
      if (error) throw error;
      return (data ?? []) as Usuario[];
    },
  });
}

interface NovaPauta {
  titulo_topico: string;
  descricao: string;
  responsavel_user_id?: string | null;
  tempo_previsto_minutos?: number | null;
}

interface NovaReuniao {
  titulo: string;
  objetivo: string;
  data_hora: string;
  duracao_minutos: number;
  justificativa_alteracao_duracao?: string | null;
  tipo_local: TipoLocalReuniao;
  local_ou_link: string;
  link_online: string | null;
  organizador_user_id: string;
  responsavel_preenchimento_user_id: string;
  tipo_reuniao: TipoReuniao | null;
  finalidade: Finalidade[];
  resultado_esperado: ResultadoEsperado[];
  notificar_por: NotificarPor[];
  setor_responsavel: string | null;
  pauta: NovaPauta[];
  convidados: string[];
  observadores: string[];
  anexos?: File[];
  serie_recorrencia_id?: string | null;
}

const ANEXOS_BUCKET = "reunioes";

/** Cria uma reunião (linha reuniao + pauta + convidados/observadores + notificação + log). Usado tanto pra criação avulsa quanto, em loop, pra recorrência. */
async function criarUmaReuniao(nova: NovaReuniao): Promise<string> {
  const { data: reuniao, error } = await (supabase as any)
    .from("reuniao")
    .insert({
      titulo: nova.titulo,
      objetivo: nova.objetivo || null,
      data_hora: nova.data_hora,
      duracao_minutos: nova.duracao_minutos,
      tipo_local: nova.tipo_local,
      local_ou_link: nova.local_ou_link,
      link_online: nova.link_online,
      organizador_user_id: nova.organizador_user_id,
      responsavel_preenchimento_user_id: nova.responsavel_preenchimento_user_id,
      tipo_reuniao: nova.tipo_reuniao,
      finalidade: nova.finalidade,
      resultado_esperado: nova.resultado_esperado,
      notificar_por: nova.notificar_por,
      setor_responsavel: nova.setor_responsavel,
      justificativa_alteracao_duracao: nova.justificativa_alteracao_duracao || null,
      serie_recorrencia_id: nova.serie_recorrencia_id ?? null,
    })
    .select("id")
    .single();
  if (error) {
    if (error.code === "23P01") {
      throw new Error(`Sala "${nova.local_ou_link}" já está reservada nesse horário.`);
    }
    throw error;
  }
  const reuniaoId = reuniao.id as string;

  if (nova.pauta.length > 0) {
    const { error: pautaErr } = await (supabase as any).from("reuniao_pauta").insert(
      nova.pauta.map((p, i) => ({
        reuniao_id: reuniaoId,
        ordem: i,
        titulo_topico: p.titulo_topico,
        descricao: p.descricao || null,
        responsavel_user_id: p.responsavel_user_id || null,
        tempo_previsto_minutos: p.tempo_previsto_minutos || null,
      })),
    );
    if (pautaErr) throw pautaErr;
  }

  // reuniao_convidado é único por (reuniao_id, user_id) — se a mesma pessoa
  // vier em convidados e observadores, convidado prevalece.
  const observadoresSemDuplicata = nova.observadores.filter((userId) => !nova.convidados.includes(userId));
  const participantes = [
    ...nova.convidados.map((userId) => ({ reuniao_id: reuniaoId, user_id: userId, papel: "convidado" })),
    ...observadoresSemDuplicata.map((userId) => ({ reuniao_id: reuniaoId, user_id: userId, papel: "observador" })),
  ];
  if (participantes.length > 0) {
    const { error: convidadosErr } = await (supabase as any).from("reuniao_convidado").insert(participantes);
    if (convidadosErr) throw convidadosErr;
  }

  if (nova.anexos && nova.anexos.length > 0) {
    for (const file of nova.anexos) {
      const nomeSanitizado = file.name
        .normalize("NFD").replace(/[̀-ͯ]/g, "")
        .replace(/[^a-zA-Z0-9._-]/g, "_");
      const path = `${reuniaoId}/${Date.now()}-${nomeSanitizado}`;
      const up = await supabase.storage.from(ANEXOS_BUCKET).upload(path, file, { contentType: file.type });
      if (up.error) continue;
      await (supabase as any).from("reuniao_anexo").insert({
        reuniao_id: reuniaoId,
        storage_path: path,
        nome_arquivo: file.name,
        mime_type: file.type || null,
        tamanho_bytes: file.size,
      });
    }
  }

  supabase.functions
    .invoke("enviar-notificacao-push-reuniao", { body: { reuniao_id: reuniaoId, evento: "agendada" } })
    .catch(() => {});

  registrarLog(reuniaoId, "reuniao_agendada", `Reunião "${nova.titulo}" agendada`);

  return reuniaoId;
}

export function useCriarReuniao() {
  const qc = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: criarUmaReuniao,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["reuniao-calendario"] });
      qc.invalidateQueries({ queryKey: ["reuniao-minhas"] });
      toast({ title: "Reunião agendada" });
    },
    onError: (error: any) => {
      toast({ title: "Erro ao agendar reunião", description: error.message, variant: "destructive" });
    },
  });
}

interface ResultadoRecorrencia {
  criadas: number;
  puladas: { dataHoraIso: string; motivo: string }[];
}

/** Cria uma série de reuniões (mesmo conteúdo, datas diferentes) — cada data é uma tentativa independente, igual a criar uma avulsa; se uma data específica já estiver ocupada, só ela fica de fora. */
export function useCriarReunioesRecorrentes() {
  const qc = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ base, datas }: { base: Omit<NovaReuniao, "data_hora">; datas: string[] }): Promise<ResultadoRecorrencia> => {
      const resultado: ResultadoRecorrencia = { criadas: 0, puladas: [] };
      // Todas as ocorrências da mesma criação recorrente compartilham essa tag —
      // é o que permite editar a série inteira de uma vez depois (ver editarSerieRecorrente).
      const serieId = crypto.randomUUID();
      for (const dataHoraIso of datas) {
        try {
          await criarUmaReuniao({ ...base, data_hora: dataHoraIso, serie_recorrencia_id: serieId });
          resultado.criadas += 1;
        } catch (e) {
          resultado.puladas.push({ dataHoraIso, motivo: e instanceof Error ? e.message : String(e) });
        }
      }
      return resultado;
    },
    onSuccess: (resultado) => {
      qc.invalidateQueries({ queryKey: ["reuniao-calendario"] });
      qc.invalidateQueries({ queryKey: ["reuniao-minhas"] });
      if (resultado.puladas.length === 0) {
        toast({ title: `${resultado.criadas} reuniões agendadas` });
        return;
      }
      const datasPuladas = resultado.puladas
        .map((p) => new Date(p.dataHoraIso).toLocaleDateString("pt-BR"))
        .join(", ");
      toast({
        title: `${resultado.criadas} reuniões agendadas, ${resultado.puladas.length} pulada(s)`,
        description: `Datas com conflito: ${datasPuladas}`,
        variant: resultado.criadas === 0 ? "destructive" : undefined,
      });
    },
    onError: (error: any) => {
      toast({ title: "Erro ao agendar reuniões recorrentes", description: error.message, variant: "destructive" });
    },
  });
}

/** Desloca a data pro novo dia da semana dentro da mesma semana da ocorrência (pode ir pra frente ou pra trás), aplicando o novo horário. */
function aplicarNovoDiaHorario(dataHoraIso: string, novoDiaSemana: number, novoHorario: string): string {
  const d = new Date(dataHoraIso);
  const deltaDias = novoDiaSemana - d.getDay();
  const novaData = new Date(d.getTime() + deltaDias * 24 * 60 * 60 * 1000);
  const [h, m] = novoHorario.split(":").map(Number);
  novaData.setHours(h, m, 0, 0);
  return novaData.toISOString();
}

interface ResultadoEdicaoSerie {
  atualizadas: number;
  puladas: { titulo: string; motivo: string }[];
}

/** Núcleo compartilhado: edita dia da semana + horário de uma lista de reuniões já carregadas — cada uma com conflito no novo horário é pulada individualmente (mesma regra da criação recorrente), sem afetar as demais. Usado tanto pra "Editar série" (busca por serie_recorrencia_id) quanto pra edição em massa por seleção manual na lista. */
async function editarReunioesEmLote(reunioes: Reuniao[], novoDiaSemana: number, novoHorario: string): Promise<ResultadoEdicaoSerie> {
  const resultado: ResultadoEdicaoSerie = { atualizadas: 0, puladas: [] };
  for (const r of reunioes) {
    const novaDataHora = aplicarNovoDiaHorario(r.data_hora, novoDiaSemana, novoHorario);
    try {
      if (r.tipo_local === "presencial" || r.tipo_local === "hibrido") {
        const conflitoSala = await verificarConflitoSala({
          local: r.local_ou_link, dataHoraIso: novaDataHora, duracaoMinutos: r.duracao_minutos, reuniaoIdIgnorar: r.id,
        });
        if (conflitoSala) throw new Error(`"${r.local_ou_link}" já está reservada nesse horário (reunião "${conflitoSala.titulo}").`);
      }

      const { data: convidados } = await (supabase as any)
        .from("reuniao_convidado")
        .select("user_id")
        .eq("reuniao_id", r.id);
      const pessoas = [
        r.organizador_user_id,
        r.responsavel_preenchimento_user_id,
        ...((convidados ?? []) as { user_id: string }[]).map((c) => c.user_id),
      ];
      for (const userId of new Set(pessoas)) {
        const conflitoPessoa = await verificarConflitoParticipante({
          userId, dataHoraIso: novaDataHora, duracaoMinutos: r.duracao_minutos, reuniaoIdIgnorar: r.id,
        });
        if (conflitoPessoa) throw new Error(`Um dos participantes já está em outra reunião nesse horário (reunião "${conflitoPessoa.titulo}").`);
      }

      const { error: updErr } = await (supabase as any).from("reuniao").update({ data_hora: novaDataHora }).eq("id", r.id);
      if (updErr) throw updErr;
      registrarLog(r.id, "horario_alterado_serie", `Horário alterado em massa para ${new Date(novaDataHora).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}`);
      resultado.atualizadas += 1;
    } catch (e) {
      resultado.puladas.push({ titulo: r.titulo, motivo: e instanceof Error ? e.message : String(e) });
    }
  }
  return resultado;
}

function useResultadoEdicaoToast() {
  const { toast } = useToast();
  return (resultado: ResultadoEdicaoSerie, tituloBase: string) => {
    if (resultado.puladas.length === 0) {
      toast({ title: `${resultado.atualizadas} ${tituloBase}` });
      return;
    }
    toast({
      title: `${resultado.atualizadas} atualizadas, ${resultado.puladas.length} pulada(s) por conflito`,
      description: resultado.puladas.map((p) => `${p.titulo}: ${p.motivo}`).join(" · "),
      variant: resultado.atualizadas === 0 ? "destructive" : undefined,
    });
  };
}

/** Edita dia da semana + horário de todas as ocorrências futuras "agendada" de uma série recorrente — passadas/em andamento/concluídas/canceladas ficam intocadas. */
export function useEditarSerieRecorrente() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const mostrarResultado = useResultadoEdicaoToast();

  return useMutation({
    mutationFn: async ({ serieId, novoDiaSemana, novoHorario }: { serieId: string; novoDiaSemana: number; novoHorario: string }): Promise<ResultadoEdicaoSerie> => {
      const { data: reunioes, error } = await (supabase as any)
        .from("reuniao")
        .select(REUNIAO_COLUNAS)
        .eq("serie_recorrencia_id", serieId)
        .eq("etapa", "agendada")
        .gt("data_hora", new Date().toISOString());
      if (error) throw error;
      return editarReunioesEmLote((reunioes ?? []) as Reuniao[], novoDiaSemana, novoHorario);
    },
    onSuccess: (resultado) => {
      qc.invalidateQueries({ queryKey: ["reuniao-calendario"] });
      qc.invalidateQueries({ queryKey: ["reuniao-minhas"] });
      qc.invalidateQueries({ queryKey: ["reuniao"] });
      mostrarResultado(resultado, "reuniões da série atualizadas");
    },
    onError: (error: any) => {
      toast({ title: "Erro ao editar série", description: error.message, variant: "destructive" });
    },
  });
}

interface ResultadoExclusaoLote {
  excluidas: number;
  puladas: { titulo: string; motivo: string }[];
}

const ANEXOS_BUCKET_REUNIAO = "reunioes";

/** Exclui uma lista de reuniões (mesma regra do "Excluir reunião" individual — remove anexos do Storage antes, e confirma que a linha foi de fato removida em vez de assumir sucesso). Usado por "Excluir série" e pela seleção manual na lista. */
export function useExcluirReunioesEmMassa() {
  const qc = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (reuniaoIds: string[]): Promise<ResultadoExclusaoLote> => {
      const resultado: ResultadoExclusaoLote = { excluidas: 0, puladas: [] };
      for (const id of reuniaoIds) {
        const { data: reuniaoRow } = await (supabase as any).from("reuniao").select("titulo").eq("id", id).maybeSingle();
        const titulo = reuniaoRow?.titulo ?? id;
        try {
          const [{ data: anexos }, { data: pautas }] = await Promise.all([
            (supabase as any).from("reuniao_anexo").select("storage_path").eq("reuniao_id", id),
            (supabase as any).from("reuniao_pauta").select("id").eq("reuniao_id", id),
          ]);
          const pautaIds = ((pautas ?? []) as { id: string }[]).map((p) => p.id);
          const { data: pautaAnexos } = pautaIds.length > 0
            ? await (supabase as any).from("reuniao_pauta_anexo").select("storage_path").in("pauta_id", pautaIds)
            : { data: [] };
          const paths = [
            ...((anexos ?? []) as { storage_path: string }[]).map((a) => a.storage_path),
            ...((pautaAnexos ?? []) as { storage_path: string }[]).map((a) => a.storage_path),
          ];
          if (paths.length > 0) await supabase.storage.from(ANEXOS_BUCKET_REUNIAO).remove(paths);

          const { data, error } = await (supabase as any).from("reuniao").delete().eq("id", id).select("id");
          if (error) throw error;
          if (!data || data.length === 0) throw new Error("Sem permissão pra excluir esta reunião.");
          resultado.excluidas += 1;
        } catch (e) {
          resultado.puladas.push({ titulo, motivo: e instanceof Error ? e.message : String(e) });
        }
      }
      return resultado;
    },
    onSuccess: (resultado) => {
      qc.invalidateQueries({ queryKey: ["reuniao-calendario"] });
      qc.invalidateQueries({ queryKey: ["reuniao-minhas"] });
      if (resultado.puladas.length === 0) {
        toast({ title: `${resultado.excluidas} reuniões excluídas` });
        return;
      }
      toast({
        title: `${resultado.excluidas} excluídas, ${resultado.puladas.length} pulada(s)`,
        description: resultado.puladas.map((p) => `${p.titulo}: ${p.motivo}`).join(" · "),
        variant: resultado.excluidas === 0 ? "destructive" : undefined,
      });
    },
    onError: (error: any) => {
      toast({ title: "Erro ao excluir em massa", description: error.message, variant: "destructive" });
    },
  });
}
