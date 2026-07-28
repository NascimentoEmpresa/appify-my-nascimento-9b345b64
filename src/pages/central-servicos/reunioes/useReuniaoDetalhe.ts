import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import type {
  Reuniao, ReuniaoAnexo, ReuniaoAssinatura, ReuniaoAssuntoForaPauta, ReuniaoComentario, ReuniaoConvidado, ReuniaoDecisaoAcao,
  ReuniaoEtapa, ReuniaoLog, ReuniaoPauta, ReuniaoPautaAnexo, ReuniaoResposta, RespostaConducaoItem, Usuario,
} from "./types";
import { gerarAtaFinalPdfBlob } from "./pdf/ataFinalPdf";
import { registrarLog } from "./registrarLog";

const BUCKET = "reunioes";

export function useReuniaoDetalhe(id: string | undefined) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { user } = useAuth();

  const { data: reuniao, isLoading } = useQuery({
    queryKey: ["reuniao", id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("reuniao")
        .select("id, numero, titulo, objetivo, data_hora, duracao_minutos, tipo_local, local_ou_link, link_online, etapa, criado_por, organizador_user_id, responsavel_preenchimento_user_id, tipo_reuniao, finalidade, resultado_esperado, notificar_por, setor_responsavel, justificativa_alteracao_duracao, serie_recorrencia_id, motivo_cancelamento, checklist_inicio, checklist_encerramento, hora_inicio_real, hora_termino_real, duracao_real_minutos, created_at, updated_at")
        .eq("id", id)
        .maybeSingle();
      if (error) throw error;
      return data as Reuniao | null;
    },
  });

  const { data: pauta = [] } = useQuery({
    queryKey: ["reuniao_pauta", id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("reuniao_pauta")
        .select("id, reuniao_id, ordem, titulo_topico, descricao, responsavel_user_id, prazo, tempo_previsto_minutos, status, natureza, created_at")
        .eq("reuniao_id", id)
        .order("ordem", { ascending: true });
      if (error) throw error;
      return (data ?? []) as ReuniaoPauta[];
    },
  });

  const { data: respostas = [] } = useQuery({
    queryKey: ["reuniao_resposta", id],
    enabled: !!id && pauta.length > 0,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("reuniao_resposta")
        .select("id, pauta_id, texto_resposta, encaminhamento, checklist_conducao, respondido_por, created_at, updated_at")
        .in("pauta_id", pauta.map((p) => p.id));
      if (error) throw error;
      return (data ?? []) as ReuniaoResposta[];
    },
  });

  const { data: convidados = [] } = useQuery({
    queryKey: ["reuniao_convidado", id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("reuniao_convidado")
        .select("id, reuniao_id, user_id, papel, presente, presente_marcado_em, created_at")
        .eq("reuniao_id", id)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as ReuniaoConvidado[];
    },
  });

  const { data: anexos = [] } = useQuery({
    queryKey: ["reuniao_anexo", id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("reuniao_anexo")
        .select("id, reuniao_id, storage_path, nome_arquivo, mime_type, tamanho_bytes, enviado_por, created_at")
        .eq("reuniao_id", id)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as ReuniaoAnexo[];
    },
  });

  const { data: comentarios = [] } = useQuery({
    queryKey: ["reuniao_comentario", id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("reuniao_comentario")
        .select("id, reuniao_id, autor_id, texto, created_at")
        .eq("reuniao_id", id)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as ReuniaoComentario[];
    },
  });

  const { data: assinaturas = [] } = useQuery({
    queryKey: ["reuniao_assinatura", id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("reuniao_assinatura")
        .select("id, reuniao_id, user_id, assinatura_png, created_at")
        .eq("reuniao_id", id)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as ReuniaoAssinatura[];
    },
  });

  const { data: pautaAnexos = [] } = useQuery({
    queryKey: ["reuniao_pauta_anexo", id],
    enabled: !!id && pauta.length > 0,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("reuniao_pauta_anexo")
        .select("id, pauta_id, storage_path, nome_arquivo, mime_type, tamanho_bytes, enviado_por, created_at")
        .in("pauta_id", pauta.map((p) => p.id))
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as ReuniaoPautaAnexo[];
    },
  });

  const { data: logs = [] } = useQuery({
    queryKey: ["reuniao_log", id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("reuniao_log")
        .select("id, reuniao_id, user_id, acao, detalhe, created_at")
        .eq("reuniao_id", id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as ReuniaoLog[];
    },
  });

  const { data: decisoesAcoes = [] } = useQuery({
    queryKey: ["reuniao_decisao_acao", id],
    enabled: !!id && pauta.length > 0,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("reuniao_decisao_acao")
        .select("id, pauta_id, tipo, texto, responsavel_user_id, prazo, prioridade, status, necessita_comprovacao, setor_impactado, anexo_storage_path, plano_acao_id, criado_por, created_at")
        .in("pauta_id", pauta.map((p) => p.id))
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as ReuniaoDecisaoAcao[];
    },
  });

  const { data: assuntosForaPauta = [] } = useQuery({
    queryKey: ["reuniao_assunto_fora_pauta", id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("reuniao_assunto_fora_pauta")
        .select("id, reuniao_id, classificacao, tratativa, assunto_estacionado, responsavel_tratativa_user_id, data_prevista, reuniao_futura_necessaria, observacoes, concluido, criado_por, created_at")
        .eq("reuniao_id", id)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as ReuniaoAssuntoForaPauta[];
    },
  });

  const invalidarReuniao = () => {
    qc.invalidateQueries({ queryKey: ["reuniao", id] });
    qc.invalidateQueries({ queryKey: ["reuniao-calendario"] });
    qc.invalidateQueries({ queryKey: ["reuniao-minhas"] });
  };

  const notificar = (evento: string) => {
    if (!id) return;
    supabase.functions.invoke("enviar-notificacao-push-reuniao", { body: { reuniao_id: id, evento } }).catch(() => {});
  };

  const mudarEtapa = async (
    novaEtapa: ReuniaoEtapa,
    extra?: Record<string, unknown>,
    log?: { acao: string; detalhe: string },
  ): Promise<boolean> => {
    if (!id) return false;
    const { error } = await (supabase as any).from("reuniao").update({ etapa: novaEtapa, ...extra }).eq("id", id);
    if (error) {
      toast({ title: "Erro ao mudar etapa", description: error.message, variant: "destructive" });
      return false;
    }
    invalidarReuniao();
    notificar(novaEtapa);
    if (log) registrarLog(id, log.acao, log.detalhe);
    toast({ title: "Etapa atualizada" });
    return true;
  };

  const cancelarReuniao = async (motivo: string): Promise<boolean> => {
    return mudarEtapa(
      "cancelada",
      { motivo_cancelamento: motivo },
      { acao: "reuniao_cancelada", detalhe: `Reunião cancelada. Motivo: ${motivo}` },
    );
  };

  /** Exclusão de verdade (sem volta) — diferente de cancelar. As tabelas filhas cascateiam sozinhas (FK ON DELETE CASCADE); só os arquivos do Storage precisam ser removidos manualmente antes. */
  const excluirReuniao = async (): Promise<boolean> => {
    if (!id) return false;
    const paths = [...anexos.map((a) => a.storage_path), ...pautaAnexos.map((a) => a.storage_path)];
    if (paths.length > 0) {
      await supabase.storage.from(BUCKET).remove(paths);
    }
    // .select("id") depois do delete é o que permite detectar exclusão bloqueada por RLS:
    // sem RLS permissiva, o Postgres não erra, só apaga zero linhas — sem o .select(),
    // "data" viria vazio de qualquer forma e passaria como sucesso silencioso.
    const { data, error } = await (supabase as any).from("reuniao").delete().eq("id", id).select("id");
    if (error) {
      toast({ title: "Erro ao excluir reunião", description: error.message, variant: "destructive" });
      return false;
    }
    if (!data || data.length === 0) {
      toast({ title: "Não foi possível excluir", description: "Nenhuma linha foi removida — você pode não ter permissão para excluir esta reunião.", variant: "destructive" });
      return false;
    }
    qc.invalidateQueries({ queryKey: ["reuniao-calendario"] });
    qc.invalidateQueries({ queryKey: ["reuniao-minhas"] });
    toast({ title: "Reunião excluída" });
    return true;
  };

  const iniciarReuniao = async (checklistInicio?: Record<string, string>): Promise<boolean> =>
    mudarEtapa(
      "em_andamento",
      { checklist_inicio: checklistInicio ?? null, hora_inicio_real: new Date().toISOString() },
      { acao: "reuniao_iniciada", detalhe: "Reunião iniciada" },
    );

  // Ao encerrar, gera o PDF final da ata (mesmo gerador usado no botão
  // manual) e sobe pro Storage — o worker externo (whatsapp-web.js +
  // Nodemailer) usa esse arquivo pra mandar por e-mail automaticamente,
  // sem precisar portar a geração de PDF pra fora do navegador.
  const encerrarReuniao = async (usuarios: Usuario[], checklistEncerramento?: Record<string, string>): Promise<boolean> => {
    if (!id || !reuniao) return false;
    try {
      const blob = gerarAtaFinalPdfBlob(reuniao, pauta, respostas, assinaturas, usuarios, comentarios);
      const path = `${id}/ata-final.pdf`;
      const up = await supabase.storage.from(BUCKET).upload(path, blob, {
        contentType: "application/pdf",
        upsert: true,
      });
      if (up.error) {
        toast({ title: "Erro ao gerar PDF final", description: up.error.message, variant: "destructive" });
        return false;
      }
      const horaTermino = new Date();
      const duracaoReal = reuniao.hora_inicio_real
        ? Math.round((horaTermino.getTime() - new Date(reuniao.hora_inicio_real).getTime()) / 60_000)
        : null;
      return mudarEtapa(
        "concluida",
        {
          pdf_final_storage_path: path,
          checklist_encerramento: checklistEncerramento ?? null,
          hora_termino_real: horaTermino.toISOString(),
          duracao_real_minutos: duracaoReal,
        },
        { acao: "reuniao_encerrada", detalhe: "Reunião encerrada" },
      );
    } catch (e) {
      toast({ title: "Erro ao gerar PDF final", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
      return false;
    }
  };

  // Edição de campos gerais (data/hora, local, organizador) — não é uma
  // transição de etapa, então não deve disparar a notificação de "mudou de
  // status"; o trigger reuniao_etapa_notificar já ignora updates onde a
  // etapa não muda, mas o push do cliente precisa da mesma checagem.
  const atualizarCampos = async (
    patch: Record<string, unknown>,
    log?: { acao: string; detalhe: string },
  ): Promise<boolean> => {
    if (!id) return false;
    const { error } = await (supabase as any).from("reuniao").update(patch).eq("id", id);
    if (error) {
      if (error.code === "23P01") {
        toast({ title: "Sala já reservada", description: "Já existe uma reunião nesse horário para o local selecionado.", variant: "destructive" });
      } else {
        toast({ title: "Erro ao atualizar reunião", description: error.message, variant: "destructive" });
      }
      return false;
    }
    invalidarReuniao();
    if (log) registrarLog(id, log.acao, log.detalhe);
    toast({ title: "Reunião atualizada" });
    return true;
  };

  const salvarPautaItem = async (item: { titulo_topico: string; descricao: string; responsavel_user_id?: string | null; prazo?: string | null }): Promise<boolean> => {
    if (!id) return false;
    const { error } = await (supabase as any).from("reuniao_pauta").insert({
      reuniao_id: id,
      ordem: pauta.length,
      titulo_topico: item.titulo_topico,
      descricao: item.descricao || null,
      responsavel_user_id: item.responsavel_user_id ?? null,
      prazo: item.prazo ?? null,
    });
    if (error) {
      toast({ title: "Erro ao adicionar tópico", description: error.message, variant: "destructive" });
      return false;
    }
    qc.invalidateQueries({ queryKey: ["reuniao_pauta", id] });
    if (id) registrarLog(id, "pauta_topico_criado", `Tópico adicionado: "${item.titulo_topico}"`);
    return true;
  };

  const atualizarPautaItem = async (
    pautaId: string,
    patch: Partial<Pick<ReuniaoPauta, "titulo_topico" | "descricao" | "responsavel_user_id" | "prazo" | "status" | "natureza">>,
  ): Promise<boolean> => {
    const { error } = await (supabase as any).from("reuniao_pauta").update(patch).eq("id", pautaId);
    if (error) {
      toast({ title: "Erro ao atualizar tópico", description: error.message, variant: "destructive" });
      return false;
    }
    qc.invalidateQueries({ queryKey: ["reuniao_pauta", id] });
    return true;
  };

  const reordenarPauta = async (itensOrdenados: string[]): Promise<boolean> => {
    const updates = itensOrdenados.map((pautaId, ordem) =>
      (supabase as any).from("reuniao_pauta").update({ ordem }).eq("id", pautaId),
    );
    const resultados = await Promise.all(updates);
    const erro = resultados.find((r) => r.error)?.error;
    if (erro) {
      toast({ title: "Erro ao reordenar pauta", description: erro.message, variant: "destructive" });
      return false;
    }
    qc.invalidateQueries({ queryKey: ["reuniao_pauta", id] });
    return true;
  };

  const removerPautaItem = async (pautaId: string): Promise<boolean> => {
    const titulo = pauta.find((p) => p.id === pautaId)?.titulo_topico ?? pautaId;
    const { error } = await (supabase as any).from("reuniao_pauta").delete().eq("id", pautaId);
    if (error) {
      toast({ title: "Erro ao remover tópico", description: error.message, variant: "destructive" });
      return false;
    }
    qc.invalidateQueries({ queryKey: ["reuniao_pauta", id] });
    if (id) registrarLog(id, "pauta_topico_removido", `Tópico removido: "${titulo}"`);
    return true;
  };

  const salvarResposta = async (pautaId: string, texto: string, encaminhamento: string): Promise<boolean> => {
    const existente = respostas.find((r) => r.pauta_id === pautaId);
    const { error } = existente
      ? await (supabase as any)
          .from("reuniao_resposta")
          .update({ texto_resposta: texto || null, encaminhamento: encaminhamento || null })
          .eq("id", existente.id)
      : await (supabase as any)
          .from("reuniao_resposta")
          .insert({ pauta_id: pautaId, texto_resposta: texto || null, encaminhamento: encaminhamento || null });
    if (error) {
      toast({ title: "Erro ao salvar resposta", description: error.message, variant: "destructive" });
      return false;
    }
    qc.invalidateQueries({ queryKey: ["reuniao_resposta", id] });
    return true;
  };

  const salvarChecklistConducaoItem = async (pautaId: string, checklist: Record<string, RespostaConducaoItem>): Promise<boolean> => {
    const existente = respostas.find((r) => r.pauta_id === pautaId);
    const { error } = existente
      ? await (supabase as any).from("reuniao_resposta").update({ checklist_conducao: checklist }).eq("id", existente.id)
      : await (supabase as any).from("reuniao_resposta").insert({ pauta_id: pautaId, checklist_conducao: checklist });
    if (error) {
      toast({ title: "Erro ao salvar checklist do item", description: error.message, variant: "destructive" });
      return false;
    }
    qc.invalidateQueries({ queryKey: ["reuniao_resposta", id] });
    return true;
  };

  const uploadAnexo = async (file: File): Promise<boolean> => {
    if (!id) return false;
    const nomeSanitizado = file.name
      .normalize("NFD").replace(/[̀-ͯ]/g, "")
      .replace(/[^a-zA-Z0-9._-]/g, "_");
    const path = `${id}/${Date.now()}-${nomeSanitizado}`;
    const up = await supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type });
    if (up.error) {
      toast({ title: `Erro ao enviar "${file.name}"`, description: up.error.message, variant: "destructive" });
      return false;
    }
    const { error } = await (supabase as any).from("reuniao_anexo").insert({
      reuniao_id: id,
      storage_path: path,
      nome_arquivo: file.name,
      mime_type: file.type || null,
      tamanho_bytes: file.size,
    });
    if (error) {
      toast({ title: "Erro ao registrar anexo", description: error.message, variant: "destructive" });
      return false;
    }
    qc.invalidateQueries({ queryKey: ["reuniao_anexo", id] });
    registrarLog(id, "anexo_adicionado", `Anexo adicionado: "${file.name}"`);
    return true;
  };

  const removerAnexo = async (anexoId: string): Promise<boolean> => {
    const alvo = anexos.find((a) => a.id === anexoId);
    if (!alvo || !id) return false;
    await supabase.storage.from(BUCKET).remove([alvo.storage_path]);
    const { error } = await (supabase as any).from("reuniao_anexo").delete().eq("id", anexoId);
    if (error) {
      toast({ title: "Erro ao remover anexo", description: error.message, variant: "destructive" });
      return false;
    }
    qc.invalidateQueries({ queryKey: ["reuniao_anexo", id] });
    registrarLog(id, "anexo_removido", `Anexo removido: "${alvo.nome_arquivo}"`);
    return true;
  };

  const downloadAnexo = async (path: string) => {
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 3600);
    if (error || !data?.signedUrl) {
      toast({ title: "Erro ao abrir anexo", description: error?.message, variant: "destructive" });
      return;
    }
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  };

  const uploadPautaAnexo = async (pautaId: string, file: File): Promise<boolean> => {
    const nomeSanitizado = file.name
      .normalize("NFD").replace(/[̀-ͯ]/g, "")
      .replace(/[^a-zA-Z0-9._-]/g, "_");
    const path = `${pautaId}/${Date.now()}-${nomeSanitizado}`;
    const up = await supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type });
    if (up.error) {
      toast({ title: `Erro ao enviar "${file.name}"`, description: up.error.message, variant: "destructive" });
      return false;
    }
    const { error } = await (supabase as any).from("reuniao_pauta_anexo").insert({
      pauta_id: pautaId,
      storage_path: path,
      nome_arquivo: file.name,
      mime_type: file.type || null,
      tamanho_bytes: file.size,
    });
    if (error) {
      toast({ title: "Erro ao registrar anexo", description: error.message, variant: "destructive" });
      return false;
    }
    qc.invalidateQueries({ queryKey: ["reuniao_pauta_anexo", id] });
    const topico = pauta.find((p) => p.id === pautaId)?.titulo_topico ?? "";
    if (id) registrarLog(id, "anexo_pauta_adicionado", `Anexo adicionado no tópico "${topico}": "${file.name}"`);
    return true;
  };

  const removerPautaAnexo = async (anexoId: string): Promise<boolean> => {
    const alvo = pautaAnexos.find((a) => a.id === anexoId);
    if (!alvo) return false;
    await supabase.storage.from(BUCKET).remove([alvo.storage_path]);
    const { error } = await (supabase as any).from("reuniao_pauta_anexo").delete().eq("id", anexoId);
    if (error) {
      toast({ title: "Erro ao remover anexo", description: error.message, variant: "destructive" });
      return false;
    }
    qc.invalidateQueries({ queryKey: ["reuniao_pauta_anexo", id] });
    const topico = pauta.find((p) => p.id === alvo.pauta_id)?.titulo_topico ?? "";
    if (id) registrarLog(id, "anexo_pauta_removido", `Anexo removido do tópico "${topico}": "${alvo.nome_arquivo}"`);
    return true;
  };

  const adicionarConvidado = async (userId: string, nomeDisplay?: string, papel: "convidado" | "observador" = "convidado"): Promise<boolean> => {
    if (!id) return false;
    const { error } = await (supabase as any).from("reuniao_convidado").insert({ reuniao_id: id, user_id: userId, papel });
    if (error) {
      toast({ title: "Erro ao adicionar participante", description: error.message, variant: "destructive" });
      return false;
    }
    qc.invalidateQueries({ queryKey: ["reuniao_convidado", id] });
    notificar("convidado");
    registrarLog(id, papel === "observador" ? "observador_adicionado" : "convidado_adicionado", `Adicionou ${nomeDisplay ?? "um participante"} como ${papel === "observador" ? "observador" : "convidado"}`);
    return true;
  };

  const removerConvidado = async (convidadoId: string, nomeDisplay?: string): Promise<boolean> => {
    const { error } = await (supabase as any).from("reuniao_convidado").delete().eq("id", convidadoId);
    if (error) {
      toast({ title: "Erro ao remover convidado", description: error.message, variant: "destructive" });
      return false;
    }
    qc.invalidateQueries({ queryKey: ["reuniao_convidado", id] });
    if (id) registrarLog(id, "convidado_removido", `Removeu ${nomeDisplay ?? "um participante"}`);
    return true;
  };

  const marcarPresenca = async (convidadoId: string, presente: boolean, nomeParticipante?: string): Promise<boolean> => {
    const { data, error } = await (supabase as any)
      .from("reuniao_convidado")
      .update({ presente, presente_marcado_em: new Date().toISOString() })
      .eq("id", convidadoId)
      .select("id");
    if (error) {
      toast({ title: "Erro ao marcar presença", description: error.message, variant: "destructive" });
      return false;
    }
    if (!data || data.length === 0) {
      toast({ title: "Erro ao marcar presença", description: "Sem permissão pra marcar a presença deste participante.", variant: "destructive" });
      return false;
    }
    qc.invalidateQueries({ queryKey: ["reuniao_convidado", id] });
    if (id) registrarLog(id, "presenca_marcada", `${nomeParticipante ?? "Participante"} marcado(a) como ${presente ? "presente" : "ausente"}`);
    return true;
  };

  const adicionarComentario = async (texto: string): Promise<boolean> => {
    if (!id) return false;
    const { error } = await (supabase as any).from("reuniao_comentario").insert({ reuniao_id: id, texto });
    if (error) {
      toast({ title: "Erro ao comentar", description: error.message, variant: "destructive" });
      return false;
    }
    qc.invalidateQueries({ queryKey: ["reuniao_comentario", id] });
    registrarLog(id, "comentario_adicionado", "Adicionou um comentário");
    return true;
  };

  const removerComentario = async (comentarioId: string): Promise<boolean> => {
    const { error } = await (supabase as any).from("reuniao_comentario").delete().eq("id", comentarioId);
    if (error) {
      toast({ title: "Erro ao remover comentário", description: error.message, variant: "destructive" });
      return false;
    }
    qc.invalidateQueries({ queryKey: ["reuniao_comentario", id] });
    if (id) registrarLog(id, "comentario_removido", "Removeu um comentário");
    return true;
  };

  const criarDecisaoAcao = async (dados: {
    pauta_id: string; tipo: "decisao"; texto: string; responsavel_user_id?: string | null; prazo?: string | null;
    prioridade?: "alta" | "media" | "baixa"; necessita_comprovacao?: boolean; setor_impactado?: string | null;
  }): Promise<boolean> => {
    const { error } = await (supabase as any).from("reuniao_decisao_acao").insert({
      pauta_id: dados.pauta_id,
      tipo: dados.tipo,
      texto: dados.texto,
      responsavel_user_id: dados.responsavel_user_id ?? null,
      prazo: dados.prazo ?? null,
      prioridade: dados.prioridade ?? "media",
      necessita_comprovacao: dados.necessita_comprovacao ?? false,
      setor_impactado: dados.setor_impactado ?? null,
    });
    if (error) {
      toast({ title: "Erro ao registrar decisão", description: error.message, variant: "destructive" });
      return false;
    }
    qc.invalidateQueries({ queryKey: ["reuniao_decisao_acao", id] });
    const topico = pauta.find((p) => p.id === dados.pauta_id)?.titulo_topico ?? "";
    if (id) registrarLog(id, "decisao_registrada", `Decisão registrada no tópico "${topico}": "${dados.texto}"`);
    return true;
  };

  /** "Ação" não fica só na tabela da reunião — vira um registro de verdade em plano_acao (RPC libera pela interação com a reunião, não pela permissão pode_criar do módulo). */
  const criarAcaoPlanoAcao = async (dados: {
    pauta_id: string;
    titulo: string;
    tipo_acao?: string;
    problema?: string | null;
    acao?: string | null;
    comite?: string | null;
    tipo_reuniao?: string | null;
    area?: string | null;
    prioridade_normalizada?: string;
    status_normalizado?: string;
    data_inicio_planejado?: string | null;
    data_fim_planejado?: string | null;
    responsavel_profile_id?: string | null;
    lider_comite_profile_id?: string | null;
    visibilidade?: string;
    comentarios?: string | null;
  }): Promise<boolean> => {
    if (!id) return false;
    const { error } = await (supabase as any).rpc("criar_acao_reuniao_plano_acao", {
      _reuniao_id: id,
      _pauta_id: dados.pauta_id,
      _titulo: dados.titulo,
      _tipo_acao: dados.tipo_acao ?? "acao",
      _problema: dados.problema ?? null,
      _acao: dados.acao ?? null,
      _comite: dados.comite ?? null,
      _tipo_reuniao: dados.tipo_reuniao ?? null,
      _area: dados.area ?? null,
      _prioridade_normalizada: dados.prioridade_normalizada ?? "media",
      _status_normalizado: dados.status_normalizado ?? "a_definir",
      _data_inicio_planejado: dados.data_inicio_planejado ?? null,
      _data_fim_planejado: dados.data_fim_planejado ?? null,
      _responsavel_profile_id: dados.responsavel_profile_id ?? null,
      _lider_comite_profile_id: dados.lider_comite_profile_id ?? null,
      _visibilidade: dados.visibilidade ?? "privado",
      _comentarios: dados.comentarios ?? null,
    });
    if (error) {
      toast({ title: "Erro ao criar ação no Plano de Ações", description: error.message, variant: "destructive" });
      return false;
    }
    qc.invalidateQueries({ queryKey: ["reuniao_decisao_acao", id] });
    const topico = pauta.find((p) => p.id === dados.pauta_id)?.titulo_topico ?? "";
    registrarLog(id, "acao_registrada", `Ação registrada no Plano de Ações a partir do tópico "${topico}": "${dados.titulo}"`);
    return true;
  };

  const atualizarDecisaoAcao = async (
    decisaoAcaoId: string,
    patch: Partial<Pick<ReuniaoDecisaoAcao, "texto" | "responsavel_user_id" | "prazo" | "prioridade" | "status" | "necessita_comprovacao" | "setor_impactado">>,
  ): Promise<boolean> => {
    const { error } = await (supabase as any).from("reuniao_decisao_acao").update(patch).eq("id", decisaoAcaoId);
    if (error) {
      toast({ title: "Erro ao atualizar decisão/ação", description: error.message, variant: "destructive" });
      return false;
    }
    qc.invalidateQueries({ queryKey: ["reuniao_decisao_acao", id] });
    return true;
  };

  const removerDecisaoAcao = async (decisaoAcaoId: string): Promise<boolean> => {
    const { error } = await (supabase as any).from("reuniao_decisao_acao").delete().eq("id", decisaoAcaoId);
    if (error) {
      toast({ title: "Erro ao remover decisão/ação", description: error.message, variant: "destructive" });
      return false;
    }
    qc.invalidateQueries({ queryKey: ["reuniao_decisao_acao", id] });
    return true;
  };

  const criarAssuntoForaPauta = async (dados: {
    classificacao: "urgente_relevante" | "importante_nao_urgente" | "sem_relacao";
    tratativa: "tratar_agora" | "estacionar" | "encerrar_retornar_pauta";
    assunto_estacionado?: string | null;
    responsavel_tratativa_user_id?: string | null;
    data_prevista?: string | null;
    reuniao_futura_necessaria?: boolean;
    observacoes?: string | null;
  }): Promise<boolean> => {
    if (!id) return false;
    const { error } = await (supabase as any).from("reuniao_assunto_fora_pauta").insert({
      reuniao_id: id,
      classificacao: dados.classificacao,
      tratativa: dados.tratativa,
      assunto_estacionado: dados.assunto_estacionado ?? null,
      responsavel_tratativa_user_id: dados.responsavel_tratativa_user_id ?? null,
      data_prevista: dados.data_prevista ?? null,
      reuniao_futura_necessaria: dados.reuniao_futura_necessaria ?? false,
      observacoes: dados.observacoes ?? null,
    });
    if (error) {
      toast({ title: "Erro ao registrar assunto fora da pauta", description: error.message, variant: "destructive" });
      return false;
    }
    qc.invalidateQueries({ queryKey: ["reuniao_assunto_fora_pauta", id] });
    registrarLog(id, "assunto_fora_pauta_registrado", "Registrou um assunto fora da pauta");
    return true;
  };

  const marcarAssuntoForaPautaConcluido = async (assuntoId: string, concluido: boolean): Promise<boolean> => {
    const { error } = await (supabase as any).from("reuniao_assunto_fora_pauta").update({ concluido }).eq("id", assuntoId);
    if (error) {
      toast({ title: "Erro ao atualizar assunto", description: error.message, variant: "destructive" });
      return false;
    }
    qc.invalidateQueries({ queryKey: ["reuniao_assunto_fora_pauta", id] });
    return true;
  };

  const removerAssuntoForaPauta = async (assuntoId: string): Promise<boolean> => {
    const { error } = await (supabase as any).from("reuniao_assunto_fora_pauta").delete().eq("id", assuntoId);
    if (error) {
      toast({ title: "Erro ao remover assunto", description: error.message, variant: "destructive" });
      return false;
    }
    qc.invalidateQueries({ queryKey: ["reuniao_assunto_fora_pauta", id] });
    return true;
  };

  const salvarAssinatura = async (assinaturaPng: string): Promise<boolean> => {
    if (!id) return false;
    const { error } = await (supabase as any)
      .from("reuniao_assinatura")
      .upsert({ reuniao_id: id, user_id: user?.id, assinatura_png: assinaturaPng }, { onConflict: "reuniao_id,user_id" });
    if (error) {
      toast({ title: "Erro ao assinar", description: error.message, variant: "destructive" });
      return false;
    }
    qc.invalidateQueries({ queryKey: ["reuniao_assinatura", id] });
    registrarLog(id, "assinatura_registrada", "Registrou assinatura");
    toast({ title: "Assinatura registrada" });
    return true;
  };

  return {
    reuniao, isLoading, pauta, respostas, convidados, anexos, pautaAnexos, comentarios, assinaturas, logs,
    decisoesAcoes, assuntosForaPauta,
    mudarEtapa, cancelarReuniao, excluirReuniao, iniciarReuniao, encerrarReuniao, atualizarCampos,
    salvarPautaItem, atualizarPautaItem, reordenarPauta, removerPautaItem, salvarResposta, salvarChecklistConducaoItem,
    uploadAnexo, removerAnexo, downloadAnexo, uploadPautaAnexo, removerPautaAnexo,
    adicionarConvidado, removerConvidado, marcarPresenca, adicionarComentario, removerComentario, salvarAssinatura,
    criarDecisaoAcao, criarAcaoPlanoAcao, atualizarDecisaoAcao, removerDecisaoAcao, criarAssuntoForaPauta, removerAssuntoForaPauta,
    marcarAssuntoForaPautaConcluido,
  };
}
