import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  BUCKET_TRN, type Aluno, type AlunoLista, type Aula, type Aviso, type Categoria, type Certificado,
  type CertificadoModelo, type Comentario, type Curso, type CursoLista, type Dashboard, type Evento,
  type Historico, type Matricula, type Modulo, type Notificacao, type ProgressoLinha, type Publico,
  type StatusComentario, type Tag,
} from "@/pages/treinamentos/plataforma/tipos";

// =====================================================================
// Dados da plataforma de Treinamentos (tabelas TRN_*).
//
// Um hook por consulta, um por escrita, `invalidateQueries` no sucesso —
// o padrão de `useReembolso.ts`. Quem decide o que cada usuário pode é a
// RLS (por menu, ver a migration); aqui não há regra de acesso, só dados.
// =====================================================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as any;

const K = {
  dashboard: "trn-dashboard", tags: "trn-tags", alunos: "trn-alunos", aluno: "trn-aluno",
  matriculas: "trn-matriculas", historico: "trn-historico", progresso: "trn-progresso",
  certificados: "trn-certificados", categorias: "trn-categorias", modelos: "trn-modelos",
  cursos: "trn-cursos", curso: "trn-curso", modulos: "trn-modulos", aulas: "trn-aulas", aula: "trn-aula",
  comentarios: "trn-comentarios", avisos: "trn-avisos", notificacoes: "trn-notificacoes",
  eventos: "trn-eventos", alcance: "trn-alcance",
};

const invalidar = (qc: ReturnType<typeof useQueryClient>, ...chaves: string[]) =>
  chaves.forEach((c) => qc.invalidateQueries({ queryKey: [c] }));

// ── Storage ──────────────────────────────────────────────────────────
/** URL pública de um arquivo do bucket trn-midia (o bucket é público). */
export function urlMidia(path: string | null | undefined): string | null {
  if (!path) return null;
  if (/^https?:\/\//i.test(path)) return path;
  return supabase.storage.from(BUCKET_TRN).getPublicUrl(path).data.publicUrl;
}

/** Sobe um arquivo para `pasta/` e devolve o path gravado. */
export async function uploadMidia(file: File, pasta: string): Promise<string> {
  const limpo = file.name.replace(/[^\w.-]+/g, "_");
  const path = `${pasta}/${Date.now()}-${limpo}`;
  const { error } = await supabase.storage.from(BUCKET_TRN).upload(path, file, { contentType: file.type, upsert: false });
  if (error) throw error;
  return path;
}

// ── Dashboard ────────────────────────────────────────────────────────
export function useTrnDashboard(cursoId?: string | null, de?: string | null, ate?: string | null) {
  return useQuery({
    queryKey: [K.dashboard, cursoId ?? "", de ?? "", ate ?? ""],
    queryFn: async (): Promise<Dashboard> => {
      const { data, error } = await sb.rpc("trn_dashboard", { _curso: cursoId || null, _de: de || null, _ate: ate || null });
      if (error) throw error;
      return data as Dashboard;
    },
  });
}

// ── Tags ─────────────────────────────────────────────────────────────
export function useTrnTags() {
  return useQuery({
    queryKey: [K.tags],
    queryFn: async (): Promise<Tag[]> => {
      const { data, error } = await sb.from("TRN_TAG").select("*, TRN_ALUNO_TAG(count)").order("nome");
      if (error) throw error;
      return (data ?? []).map((t: any) => ({ ...t, alunos: t.TRN_ALUNO_TAG?.[0]?.count ?? 0 }));
    },
  });
}

export function useTrnSalvarTag() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (tag: { id?: string; nome: string; cor?: string | null }) => {
      const linha = { nome: tag.nome.trim(), cor: tag.cor ?? null };
      const { error } = tag.id
        ? await sb.from("TRN_TAG").update(linha).eq("id", tag.id)
        : await sb.from("TRN_TAG").insert(linha);
      if (error) throw error;
    },
    onSuccess: () => invalidar(qc, K.tags, K.alunos),
  });
}

export function useTrnExcluirTag() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await sb.from("TRN_TAG").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => invalidar(qc, K.tags, K.alunos),
  });
}

// ── Alunos ───────────────────────────────────────────────────────────
/**
 * RPC que devolve SETOF em páginas de 1000: o PostgREST corta em 1000 linhas
 * por resposta (max-rows), e com 13 mil alunos (21/09/2026, todo colaborador
 * é aluno) a lista parava em "1000 ativos, 0 inativos". Vai buscando até a
 * página vir menor que o passo.
 */
export async function rpcTodasAsLinhas<T>(fn: string, args?: Record<string, unknown>): Promise<T[]> {
  const PASSO = 1000;
  const tudo: T[] = [];
  for (let de = 0; ; de += PASSO) {
    const { data, error } = await sb.rpc(fn, args ?? {}).range(de, de + PASSO - 1);
    if (error) throw error;
    const pagina = (data ?? []) as T[];
    tudo.push(...pagina);
    if (pagina.length < PASSO) break;
  }
  return tudo;
}

export function useTrnAlunos() {
  return useQuery({
    queryKey: [K.alunos],
    queryFn: () => rpcTodasAsLinhas<AlunoLista>("trn_alunos_lista"),
  });
}

export function useTrnAluno(id: string | null | undefined) {
  return useQuery({
    queryKey: [K.aluno, id ?? ""],
    enabled: !!id,
    queryFn: async () => {
      const [{ data: a, error }, { data: tags, error: e2 }, { data: mats, error: e3 }] = await Promise.all([
        sb.from("TRN_ALUNO").select("*").eq("id", id).single(),
        sb.from("TRN_ALUNO_TAG").select("tag_id").eq("aluno_id", id),
        sb.from("TRN_MATRICULA").select("*").eq("aluno_id", id),
      ]);
      if (error) throw error; if (e2) throw e2; if (e3) throw e3;
      return {
        aluno: a as Aluno,
        tagIds: (tags ?? []).map((t: any) => t.tag_id as string),
        matriculas: (mats ?? []) as Matricula[],
      };
    },
  });
}

export interface AlunoInput {
  id?: string;
  nome: string; email: string; telefone: string | null; documento: string | null; observacoes: string | null;
  idioma: string; status?: Aluno["status"]; acesso_completo: boolean; bloquear_gamificacao: boolean;
  prazo_acesso_dias: number | null; empregado_id: number | null;
  tagIds: string[];
  /** curso_id → data de inscrição (ISO). Só vale com acesso personalizado. */
  matriculas: Record<string, string>;
}

export function useTrnSalvarAluno() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (a: AlunoInput): Promise<string> => {
      const linha = {
        nome: a.nome, email: a.email, telefone: a.telefone, documento: a.documento, observacoes: a.observacoes,
        idioma: a.idioma, acesso_completo: a.acesso_completo, bloquear_gamificacao: a.bloquear_gamificacao,
        prazo_acesso_dias: a.prazo_acesso_dias, empregado_id: a.empregado_id,
        ...(a.status ? { status: a.status } : {}),
        // Trocar o prazo recalcula a expiração (a trigger só preenche quando vier nula).
        ...(a.id ? { expira_em: a.prazo_acesso_dias == null ? null : undefined } : {}),
      };
      let id = a.id;
      if (id) {
        const { error } = await sb.from("TRN_ALUNO").update(linha).eq("id", id);
        if (error) throw error;
      } else {
        const { data, error } = await sb.from("TRN_ALUNO").insert(linha).select("id").single();
        if (error) throw error;
        id = data.id as string;
      }

      // Tags: substitui o conjunto.
      const { data: atuais } = await sb.from("TRN_ALUNO_TAG").select("tag_id").eq("aluno_id", id);
      const atualSet = new Set<string>((atuais ?? []).map((t: any) => String(t.tag_id)));
      const novoSet = new Set(a.tagIds);
      const tirar = [...atualSet].filter((t) => !novoSet.has(t));
      const por = [...novoSet].filter((t) => !atualSet.has(t));
      if (tirar.length) { const { error } = await sb.from("TRN_ALUNO_TAG").delete().eq("aluno_id", id).in("tag_id", tirar); if (error) throw error; }
      if (por.length) { const { error } = await sb.from("TRN_ALUNO_TAG").insert(por.map((tag_id) => ({ aluno_id: id, tag_id }))); if (error) throw error; }

      // Matrículas: só com acesso personalizado; acesso completo dispensa.
      const { data: matsAtuais } = await sb.from("TRN_MATRICULA").select("id, curso_id, inscrito_em").eq("aluno_id", id);
      const mapaAtual = new Map<string, { id: string; inscrito_em: string }>();
      (matsAtuais ?? []).forEach((m: any) => mapaAtual.set(m.curso_id, { id: m.id, inscrito_em: m.inscrito_em }));
      const desejadas = a.acesso_completo ? {} : a.matriculas;
      for (const [curso_id, m] of mapaAtual) {
        if (!(curso_id in desejadas)) { const { error } = await sb.from("TRN_MATRICULA").delete().eq("id", m.id); if (error) throw error; }
        else if (desejadas[curso_id] && desejadas[curso_id] !== m.inscrito_em) {
          const { error } = await sb.from("TRN_MATRICULA").update({ inscrito_em: desejadas[curso_id] }).eq("id", m.id); if (error) throw error;
        }
      }
      const novas = Object.entries(desejadas).filter(([c]) => !mapaAtual.has(c))
        .map(([curso_id, inscrito_em]) => ({ aluno_id: id, curso_id, origem: "manual", ...(inscrito_em ? { inscrito_em } : {}) }));
      if (novas.length) { const { error } = await sb.from("TRN_MATRICULA").insert(novas); if (error) throw error; }
      return id!;
    },
    onSuccess: () => invalidar(qc, K.alunos, K.aluno, K.tags, K.matriculas, K.historico, K.dashboard, K.cursos),
  });
}

/**
 * E-mail/telefone do aluno-colaborador (22/09/2026): grava em EMPREGADOS
 * (colunas do ERP, a Senior não reescreve) e o trigger leva pro aluno —
 * editar só o TRN_ALUNO seria desfeito pela sincronização.
 */
export function useTrnAtualizarContatoAluno() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (p: { alunoId: string; email: string; telefone: string | null }) => {
      const { error } = await sb.rpc("trn_aluno_atualizar_contato", { p_aluno_id: p.alunoId, p_email: p.email, p_telefone: p.telefone });
      if (error) throw error;
    },
    onSuccess: () => invalidar(qc, K.alunos, K.aluno, K.historico),
  });
}

export function useTrnExcluirAluno() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await sb.from("TRN_ALUNO").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => invalidar(qc, K.alunos, K.tags, K.dashboard, K.cursos),
  });
}

export function useTrnHistorico(alunoId: string | null | undefined) {
  return useQuery({
    queryKey: [K.historico, alunoId ?? ""],
    enabled: !!alunoId,
    queryFn: async (): Promise<Historico[]> => {
      const { data, error } = await sb.from("TRN_ALUNO_HISTORICO").select("*").eq("aluno_id", alunoId).order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useTrnProgressoAluno(alunoId: string | null | undefined) {
  return useQuery({
    queryKey: [K.progresso, alunoId ?? ""],
    enabled: !!alunoId,
    queryFn: async (): Promise<ProgressoLinha[]> => {
      const { data, error } = await sb.rpc("trn_aluno_progresso", { _aluno: alunoId });
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useTrnCertificadosAluno(alunoId: string | null | undefined) {
  return useQuery({
    queryKey: [K.certificados, alunoId ?? ""],
    enabled: !!alunoId,
    queryFn: async (): Promise<Certificado[]> => {
      const { data, error } = await sb.from("TRN_CERTIFICADO").select("*").eq("aluno_id", alunoId);
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useTrnEmitirCertificado() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { alunoId: string; cursoId: string }): Promise<string> => {
      const { data, error } = await sb.rpc("trn_emitir_certificado", { _aluno: args.alunoId, _curso: args.cursoId });
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => invalidar(qc, K.certificados, K.historico, K.dashboard),
  });
}

export function useTrnImportarAlunos() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { linhas: Record<string, string>[]; substituirTags: boolean }) => {
      const { data, error } = await sb.rpc("trn_importar_alunos", { _linhas: args.linhas, _substituir_tags: args.substituirTags });
      if (error) throw error;
      return data as { criados: number; atualizados: number; erros: { linha: number; erro: string }[] };
    },
    onSuccess: () => invalidar(qc, K.alunos, K.tags, K.dashboard, K.cursos),
  });
}

export function useTrnAcaoMassa() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { acao: string; alunos?: string[]; tag?: string | null; param?: Record<string, unknown> }) => {
      const { data, error } = await sb.rpc("trn_acao_massa", {
        _acao: args.acao, _alunos: args.alunos?.length ? args.alunos : null, _tag: args.tag ?? null, _param: args.param ?? {},
      });
      if (error) throw error;
      return data as { afetados: number; alvo: number };
    },
    onSuccess: () => invalidar(qc, K.alunos, K.aluno, K.tags, K.historico, K.dashboard, K.cursos),
  });
}

// ── Categorias e modelos de certificado ──────────────────────────────
export function useTrnCategorias() {
  return useQuery({
    queryKey: [K.categorias],
    queryFn: async (): Promise<Categoria[]> => {
      const { data, error } = await sb.from("TRN_CATEGORIA").select("*").order("ordem").order("nome");
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useTrnSalvarCategoria() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (c: Partial<Categoria> & { nome: string }) => {
      const linha = { nome: c.nome.trim(), ordem: c.ordem ?? 100, ativo: c.ativo ?? true };
      const { error } = c.id ? await sb.from("TRN_CATEGORIA").update(linha).eq("id", c.id) : await sb.from("TRN_CATEGORIA").insert(linha);
      if (error) throw error;
    },
    onSuccess: () => invalidar(qc, K.categorias, K.cursos),
  });
}

export function useTrnExcluirCategoria() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => { const { error } = await sb.from("TRN_CATEGORIA").delete().eq("id", id); if (error) throw error; },
    onSuccess: () => invalidar(qc, K.categorias, K.cursos),
  });
}

export function useTrnModelosCertificado() {
  return useQuery({
    queryKey: [K.modelos],
    queryFn: async (): Promise<CertificadoModelo[]> => {
      const { data, error } = await sb.from("TRN_CERTIFICADO_MODELO").select("*").order("created_at");
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useTrnSalvarModelo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (m: Partial<CertificadoModelo> & { nome: string; titulo: string }) => {
      const { id, created_at, updated_at, ...linha } = m as any;
      const { error } = id ? await sb.from("TRN_CERTIFICADO_MODELO").update(linha).eq("id", id) : await sb.from("TRN_CERTIFICADO_MODELO").insert(linha);
      if (error) throw error;
    },
    onSuccess: () => invalidar(qc, K.modelos),
  });
}

export function useTrnExcluirModelo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => { const { error } = await sb.from("TRN_CERTIFICADO_MODELO").delete().eq("id", id); if (error) throw error; },
    onSuccess: () => invalidar(qc, K.modelos, K.cursos),
  });
}

// ── Cursos, módulos, aulas ───────────────────────────────────────────
export function useTrnCursos() {
  return useQuery({
    queryKey: [K.cursos],
    queryFn: async (): Promise<CursoLista[]> => {
      const { data, error } = await sb.rpc("trn_cursos_lista");
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useTrnCurso(id: string | null | undefined) {
  return useQuery({
    queryKey: [K.curso, id ?? ""],
    enabled: !!id,
    queryFn: async () => {
      const [{ data: c, error }, { data: mods, error: e2 }] = await Promise.all([
        sb.from("TRN_CURSO").select("*").eq("id", id).single(),
        sb.from("TRN_MODULO").select("*, TRN_AULA(*)").eq("curso_id", id).order("posicao"),
      ]);
      if (error) throw error; if (e2) throw e2;
      const modulos = (mods ?? []).map((m: any) => ({
        ...m,
        aulas: ((m.TRN_AULA ?? []) as Aula[]).sort((a, b) => a.posicao - b.posicao),
      })) as (Modulo & { aulas: Aula[] })[];
      return { curso: c as Curso, modulos };
    },
  });
}

export type CursoInput = Omit<Partial<Curso>, "id"> & { id?: string; nome: string };

export function useTrnSalvarCurso() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (c: CursoInput): Promise<string> => {
      const { id, created_at, updated_at, ...linha } = c as any;
      if (id) {
        const { error } = await sb.from("TRN_CURSO").update(linha).eq("id", id);
        if (error) throw error;
        return id;
      }
      const { data, error } = await sb.from("TRN_CURSO").insert({ slug: "", ...linha }).select("id").single();
      if (error) throw error;
      return data.id as string;
    },
    onSuccess: () => invalidar(qc, K.cursos, K.curso, K.dashboard),
  });
}

export function useTrnExcluirCurso() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => { const { error } = await sb.from("TRN_CURSO").delete().eq("id", id); if (error) throw error; },
    onSuccess: () => invalidar(qc, K.cursos, K.dashboard, K.alunos),
  });
}

export function useTrnDuplicarCurso() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string): Promise<string> => {
      const { data, error } = await sb.rpc("trn_duplicar_curso", { _curso: id });
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => invalidar(qc, K.cursos, K.dashboard),
  });
}

export function useTrnSalvarModulo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (m: { id?: string; curso_id: string; nome: string; posicao?: number; liberar_dias?: number | null }) => {
      const { id, ...linha } = m;
      const { error } = id ? await sb.from("TRN_MODULO").update(linha).eq("id", id) : await sb.from("TRN_MODULO").insert(linha);
      if (error) throw error;
    },
    onSuccess: () => invalidar(qc, K.curso, K.cursos),
  });
}

export function useTrnExcluirModulo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => { const { error } = await sb.from("TRN_MODULO").delete().eq("id", id); if (error) throw error; },
    onSuccess: () => invalidar(qc, K.curso, K.cursos),
  });
}

export function useTrnDuplicarModulo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { moduloId: string; cursoDestino: string }) => {
      const { error } = await sb.rpc("trn_duplicar_modulo", { _modulo: args.moduloId, _curso_destino: args.cursoDestino });
      if (error) throw error;
    },
    onSuccess: () => invalidar(qc, K.curso, K.cursos),
  });
}

/** Reordena módulos (ou aulas) gravando `posicao` = índice + 1. */
export function useTrnReordenar() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { tabela: "TRN_MODULO" | "TRN_AULA"; ids: string[] }) => {
      for (const [i, id] of args.ids.entries()) {
        const { error } = await sb.from(args.tabela).update({ posicao: i + 1 }).eq("id", id);
        if (error) throw error;
      }
    },
    onSuccess: () => invalidar(qc, K.curso),
  });
}

export function useTrnAula(id: string | null | undefined) {
  return useQuery({
    queryKey: [K.aula, id ?? ""],
    enabled: !!id,
    queryFn: async (): Promise<Aula> => {
      const { data, error } = await sb.from("TRN_AULA").select("*").eq("id", id).single();
      if (error) throw error;
      return data as Aula;
    },
  });
}

export type AulaInput = Omit<Partial<Aula>, "id"> & { id?: string; modulo_id: string; nome: string };

export function useTrnSalvarAula() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (a: AulaInput): Promise<string> => {
      const { id, created_at, updated_at, ...linha } = a as any;
      if (id) {
        const { error } = await sb.from("TRN_AULA").update(linha).eq("id", id);
        if (error) throw error;
        return id;
      }
      const { data, error } = await sb.from("TRN_AULA").insert(linha).select("id").single();
      if (error) throw error;
      return data.id as string;
    },
    onSuccess: () => invalidar(qc, K.curso, K.cursos, K.aula),
  });
}

export function useTrnExcluirAula() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => { const { error } = await sb.from("TRN_AULA").delete().eq("id", id); if (error) throw error; },
    onSuccess: () => invalidar(qc, K.curso, K.cursos),
  });
}

// ── Comentários ──────────────────────────────────────────────────────
export function useTrnComentarios(status: StatusComentario | "todos", cursoId?: string | null) {
  return useQuery({
    queryKey: [K.comentarios, status, cursoId ?? ""],
    queryFn: async (): Promise<Comentario[]> => {
      let q = sb.from("TRN_COMENTARIO")
        .select("*, aluno:TRN_ALUNO(nome, email), aula:TRN_AULA(nome, modulo:TRN_MODULO(curso_id, curso:TRN_CURSO(nome)))")
        .order("created_at", { ascending: false });
      if (status !== "todos") q = q.eq("status", status);
      const { data, error } = await q;
      if (error) throw error;
      const lista = (data ?? []) as Comentario[];
      return cursoId ? lista.filter((c) => c.aula?.modulo?.curso_id === cursoId) : lista;
    },
  });
}

export function useTrnModerarComentario() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { id: string; status?: StatusComentario; resposta?: string | null }) => {
      const patch: Record<string, unknown> = {};
      if (args.status) patch.status = args.status;
      if (args.resposta !== undefined) { patch.resposta = args.resposta; patch.respondido_em = new Date().toISOString(); }
      const { error } = await sb.from("TRN_COMENTARIO").update(patch).eq("id", args.id);
      if (error) throw error;
    },
    onSuccess: () => invalidar(qc, K.comentarios, K.dashboard),
  });
}

export function useTrnExcluirComentario() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => { const { error } = await sb.from("TRN_COMENTARIO").delete().eq("id", id); if (error) throw error; },
    onSuccess: () => invalidar(qc, K.comentarios, K.dashboard),
  });
}

// ── Comunicação ──────────────────────────────────────────────────────
export function useTrnAvisos() {
  return useQuery({
    queryKey: [K.avisos],
    queryFn: async (): Promise<Aviso[]> => {
      const { data, error } = await sb.from("TRN_AVISO").select("*, tags:TRN_AVISO_TAG(tag_id)").order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useTrnSalvarAviso() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (a: Omit<Partial<Aviso>, "id" | "tags"> & { id?: string; titulo: string; tagIds: string[] }) => {
      const { id, tagIds, created_at, ...linha } = a as any;
      let avisoId = id;
      if (avisoId) { const { error } = await sb.from("TRN_AVISO").update(linha).eq("id", avisoId); if (error) throw error; }
      else { const { data, error } = await sb.from("TRN_AVISO").insert(linha).select("id").single(); if (error) throw error; avisoId = data.id; }
      const { error: eDel } = await sb.from("TRN_AVISO_TAG").delete().eq("aviso_id", avisoId); if (eDel) throw eDel;
      if (a.publico === "tags" && tagIds.length) {
        const { error } = await sb.from("TRN_AVISO_TAG").insert(tagIds.map((tag_id: string) => ({ aviso_id: avisoId, tag_id }))); if (error) throw error;
      }
    },
    onSuccess: () => invalidar(qc, K.avisos),
  });
}

export function useTrnExcluirAviso() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => { const { error } = await sb.from("TRN_AVISO").delete().eq("id", id); if (error) throw error; },
    onSuccess: () => invalidar(qc, K.avisos),
  });
}

export function useTrnNotificacoes() {
  return useQuery({
    queryKey: [K.notificacoes],
    queryFn: async (): Promise<Notificacao[]> => {
      const { data, error } = await sb.from("TRN_NOTIFICACAO").select("*, tags:TRN_NOTIFICACAO_TAG(tag_id)").order("enviada_em", { ascending: false }).limit(50);
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useTrnAlcance(publico: Publico, tagIds: string[]) {
  return useQuery({
    queryKey: [K.alcance, publico, [...tagIds].sort().join(",")],
    queryFn: async (): Promise<number> => {
      const { data, error } = await sb.rpc("trn_alcance", { _publico: publico, _tags: publico === "tags" ? tagIds : null });
      if (error) throw error;
      return Number(data ?? 0);
    },
  });
}

export function useTrnEnviarNotificacao() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (n: { titulo: string; mensagem: string; url: string | null; publico: Publico; tagIds: string[] }) => {
      const { data, error } = await sb.rpc("trn_enviar_notificacao", {
        _titulo: n.titulo, _mensagem: n.mensagem, _url: n.url, _publico: n.publico, _tags: n.publico === "tags" ? n.tagIds : null,
      });
      if (error) throw error;
      return data as { id: string; alcance: number };
    },
    onSuccess: () => invalidar(qc, K.notificacoes),
  });
}

export function useTrnEventos(deISO: string, ateISO: string) {
  return useQuery({
    queryKey: [K.eventos, deISO, ateISO],
    queryFn: async (): Promise<Evento[]> => {
      const { data, error } = await sb.from("TRN_EVENTO").select("*, tags:TRN_EVENTO_TAG(tag_id)")
        .gte("inicio_em", deISO).lte("inicio_em", ateISO).order("inicio_em");
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useTrnSalvarEvento() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (e: Omit<Partial<Evento>, "id" | "tags"> & { id?: string; titulo: string; inicio_em: string; tagIds: string[] }) => {
      const { id, tagIds, created_at, ...linha } = e as any;
      let eventoId = id;
      if (eventoId) { const { error } = await sb.from("TRN_EVENTO").update(linha).eq("id", eventoId); if (error) throw error; }
      else { const { data, error } = await sb.from("TRN_EVENTO").insert(linha).select("id").single(); if (error) throw error; eventoId = data.id; }
      const { error: eDel } = await sb.from("TRN_EVENTO_TAG").delete().eq("evento_id", eventoId); if (eDel) throw eDel;
      if (e.publico === "tags" && tagIds.length) {
        const { error } = await sb.from("TRN_EVENTO_TAG").insert(tagIds.map((tag_id: string) => ({ evento_id: eventoId, tag_id }))); if (error) throw error;
      }
    },
    onSuccess: () => invalidar(qc, K.eventos),
  });
}

export function useTrnExcluirEvento() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => { const { error } = await sb.from("TRN_EVENTO").delete().eq("id", id); if (error) throw error; },
    onSuccess: () => invalidar(qc, K.eventos),
  });
}
