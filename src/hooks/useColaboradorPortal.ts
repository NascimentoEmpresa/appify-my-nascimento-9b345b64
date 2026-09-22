import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { SUPABASE_FUNCTIONS_URL } from "@/integrations/supabase/env";

// =====================================================================
// PORTAL DO COLABORADOR (/colaborador) — acesso a dados
//
// Nada aqui passa pelo cliente Supabase nem pelo PostgREST. O colaborador de
// campo não tem conta no Auth (e não vai ter — ver o cabeçalho da migration
// 20260930000196): a sessão é um token opaco devolvido por `login`, guardado
// no localStorage e mandado no corpo de cada chamada à Edge Function
// `colaborador-portal`, que roda com service_role e chama as RPCs `col_*`.
//
// A função resolve QUEM é pela sessão; o front nunca manda empregado_id. Se
// o token venceu ou foi revogado, a resposta é 401 { sessao: false } — o
// helper apaga o token e dispara `colaborador:sessao-expirada`, que o Shell
// ouve para voltar ao login.
// =====================================================================

const URL_PORTAL = `${SUPABASE_FUNCTIONS_URL}/colaborador-portal`;
const CHAVE_TOKEN = "col_portal_token";
const CHAVE_NOME = "col_portal_nome";
export const EVENTO_SESSAO_EXPIRADA = "colaborador:sessao-expirada";

export function lerToken(): string | null {
  try { return localStorage.getItem(CHAVE_TOKEN); } catch { return null; }
}
export function lerNomeSalvo(): string | null {
  try { return localStorage.getItem(CHAVE_NOME); } catch { return null; }
}
export function guardarSessao(token: string, nome: string) {
  try { localStorage.setItem(CHAVE_TOKEN, token); localStorage.setItem(CHAVE_NOME, nome); } catch { /* modo privado */ }
}
export function limparSessao() {
  try { localStorage.removeItem(CHAVE_TOKEN); localStorage.removeItem(CHAVE_NOME); } catch { /* idem */ }
}

export class ErroPortal extends Error {
  sessaoExpirada: boolean;
  constructor(msg: string, sessaoExpirada = false) {
    super(msg);
    this.sessaoExpirada = sessaoExpirada;
  }
}

export async function chamarPortal<T>(acao: string, corpo: Record<string, unknown> = {}): Promise<T> {
  const token = lerToken();
  let resp: Response;
  try {
    resp = await fetch(URL_PORTAL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ acao, token, ...corpo }),
    });
  } catch {
    throw new ErroPortal("Sem conexão. Verifique a internet e tente de novo.");
  }
  const dados = await resp.json().catch(() => ({}));
  if (resp.status === 401 && dados?.sessao === false) {
    limparSessao();
    window.dispatchEvent(new Event(EVENTO_SESSAO_EXPIRADA));
    throw new ErroPortal(dados.error ?? "Sessão expirada.", true);
  }
  if (!resp.ok) throw new ErroPortal(dados?.error ?? "Não foi possível concluir agora.");
  return dados as T;
}

// ── Tipos (espelham o jsonb das RPCs col_*) ─────────────────────────────

export interface RespostaLogin {
  ok: boolean; error?: string; token?: string; nome?: string; expira_em?: string; empregado_id?: number; senha_propria?: boolean;
}

export interface PerfilColaborador {
  empregado_id: number; nome: string; matricula: string | null; cpf: string | null; nascimento: string | null;
  sexo: string | null; estado_civil: string | null; instrucao: string | null; nacionalidade: string | null;
  email: string | null; pis: string | null; ctps: string | null;
  cargo: string | null; setor: string | null; posto: string | null; local: string | null; filial: string | null;
  empresa: string | null; centro_custo: string | null; situacao: string | null; admissao: string | null;
  data_cargo: string | null; data_afastamento: string | null; escala: string | null; escala_codigo: string | null;
  tipo_contrato: string | null; categoria: string | null; lider: string | null;
  tem_conta_erp: boolean; senha_propria: boolean;
}

export interface SalarioColaborador {
  valor: number | null; valor_texto: string | null; tipo: string | null; data_salario: string | null;
  motivo_alteracao: string | null; complemento: number | null; suplementar: number | null; adiantamento: string | null;
  periodo_pagto: string | null; modo_pagto: string | null; recebe_13: string | null; dependentes_ir: number | null;
  insalubridade_pct: number | null; periculosidade_pct: number | null; desconta_inss: string | null; opcao_fgts: string | null;
  banco: string | null; agencia: string | null; conta: string | null; tipo_conta: string | null;
  pix_tipo: string | null; pix: string | null; cargo: string | null; data_cargo: string | null;
}

export type TipoBatida = "entrada" | "saida_intervalo" | "retorno_intervalo" | "saida";
export const ROTULO_BATIDA: Record<TipoBatida, string> = {
  entrada: "Entrada", saida_intervalo: "Saída p/ intervalo", retorno_intervalo: "Retorno do intervalo", saida: "Saída",
};

export interface BatidaRegistro { tipo: TipoBatida; em: string; lat: number | null; lng: number | null; obs: string | null }
export interface DiaPonto {
  data: string; entrada: string | null; saida_intervalo: string | null; retorno_intervalo: string | null; saida: string | null;
  minutos: number; incompleto?: boolean; registros?: BatidaRegistro[]; proximo?: TipoBatida | null; pode_sair?: boolean;
}
export interface HoraExtraLinha {
  id: string; numero: string | null; data: string; tipo: string; status: string; inicio: string; fim: string;
  previsto_min: number; real_min: number | null; justificativa: string;
}
export interface PontoMes {
  mes: string; hoje: DiaPonto; dias: DiaPonto[]; total_min: number; dias_trabalhados: number;
  escala: { nome: string | null; codigo: string | null; horario: { descricao: string; tipo_jornada: string | null; turno: number | null } | null };
  fechamento: { status: string; contrato: string | null; aprovado_em: string | null; confirmado_em: string | null; pago_em: string | null } | null;
  horas_extras: HoraExtraLinha[];
}

export interface HistoricoColaborador {
  ferias: { id: number; saida: string | null; retorno: string | null; dias: number | null; vendidos: number | null; status: string; criado_em: string; motivo_reprovacao: string | null }[];
  trocas_funcao: { id: number; cargo_atual: string | null; cargo_novo: string; posto: string | null; data_pretendida: string | null; status: string; criado_em: string }[];
  advertencias: { id: number; tipo: string | null; grau: string | null; data: string | null; status: string; resultado: string | null; criado_em: string }[];
}

export interface CursoAluno {
  id: string; nome: string; descricao: string | null; capa_path: string | null; capa_formato: "paisagem" | "retrato" | "quadrado";
  categoria: string | null; carga_horaria_min: number | null; em_breve: boolean; inscrito_em: string | null;
  aulas: number; concluidas: number; pct: number; certificado: string | null; libera_em: string | null; expira_em: string | null; bloqueado: boolean;
}
export interface AvisoAluno {
  id: string; titulo: string; url: string | null; tipo: "texto" | "imagem" | "video"; mensagem: string | null;
  imagem_path: string | null; video_url: string | null; criado_em: string;
}
export interface NotificacaoAluno { id: string; titulo: string; mensagem: string; url: string | null; enviada_em: string; lida: boolean }
export interface EventoAluno {
  id: string; titulo: string; descricao: string | null; inicio_em: string; fim_em: string | null; dia_inteiro: boolean;
  local: string | null; url: string | null; cor: string | null;
}
export interface CursosResposta {
  aluno: { id: string; nome: string; status: "pendente" | "ativo" | "bloqueado"; expira_em: string | null; acesso_completo: boolean; expirado: boolean } | null;
  cursos: CursoAluno[]; avisos: AvisoAluno[]; notificacoes: NotificacaoAluno[]; eventos: EventoAluno[];
}

export interface PerguntaQuizAluno { id: string; enunciado: string; opcoes: string[] }
export interface MaterialAula { nome: string; path?: string | null; url?: string | null }
export interface AulaAluno {
  id: string; nome: string; tipo_conteudo: "texto" | "video" | "ao_vivo" | "audio" | "link" | "embed";
  video_url: string | null; video_path: string | null; thumb_path: string | null; descricao: string | null; posicao: number;
  carga_horaria_min: number | null; materiais: MaterialAula[]; cta_texto: string | null; cta_url: string | null;
  quiz: PerguntaQuizAluno[] | null; nota_minima: number; libera_em: string | null; bloqueado: boolean;
  concluida: boolean; concluida_em: string | null; avaliacao: number | null; tempo_seg: number; nota_quiz: number | null;
}
export interface ModuloAluno { id: string; nome: string; posicao: number; libera_em: string | null; bloqueado: boolean; aulas: AulaAluno[] }
export interface CursoDetalheAluno {
  curso: { id: string; nome: string; descricao: string | null; capa_path: string | null; carga_horaria_min: number | null; comentarios_habilitados: boolean; emite_certificado: boolean; inscrito_em: string | null };
  modulos: ModuloAluno[]; aulas: number; concluidas: number; pct: number; certificado: string | null;
}
export interface ResultadoQuiz {
  nota: number; aprovado: boolean; nota_minima: number; acertos: number; total: number; corretas: boolean[]; certificado: string | null;
}
export interface ComentarioAluno {
  id: string; texto: string; status: "pendente" | "aprovado" | "rejeitado"; resposta: string | null; respondido_em: string | null;
  criado_em: string; autor: string; meu: boolean;
}
export interface CertificadoAluno {
  codigo: string; emitido_em: string; carga_horaria_min: number | null; aluno: string; documento: string | null; curso: string;
  modelo: Record<string, unknown> | null; modulos: { nome: string; aulas: string[] }[];
}

// ── Queries ─────────────────────────────────────────────────────────────

export function usePerfilColaborador() {
  return useQuery({
    queryKey: ["colaborador", "perfil"],
    queryFn: () => chamarPortal<PerfilColaborador>("perfil"),
    staleTime: 5 * 60_000,
    retry: false,
  });
}

export function useSalarioColaborador() {
  return useQuery({
    queryKey: ["colaborador", "salario"],
    queryFn: () => chamarPortal<SalarioColaborador>("salario"),
    staleTime: 5 * 60_000,
    retry: false,
  });
}

export function usePontoColaborador(mes: string) {
  return useQuery({
    queryKey: ["colaborador", "ponto", mes],
    queryFn: () => chamarPortal<PontoMes>("ponto", { mes }),
    retry: false,
  });
}

export function useBaterPonto() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (p: { tipo: TipoBatida; latitude?: number | null; longitude?: number | null; precisao?: number | null; observacao?: string | null }) =>
      chamarPortal<PontoMes>("bater_ponto", p),
    onSuccess: (dados) => {
      qc.setQueryData(["colaborador", "ponto", dados.mes], dados);
      qc.invalidateQueries({ queryKey: ["colaborador", "ponto"] });
    },
  });
}

export function useHistoricoColaborador() {
  return useQuery({
    queryKey: ["colaborador", "historico"],
    queryFn: () => chamarPortal<HistoricoColaborador>("historico"),
    retry: false,
  });
}

export function useCursosColaborador() {
  return useQuery({
    queryKey: ["colaborador", "cursos"],
    queryFn: () => chamarPortal<CursosResposta>("cursos"),
    retry: false,
  });
}

export function useCursoColaborador(cursoId: string | undefined) {
  return useQuery({
    queryKey: ["colaborador", "curso", cursoId],
    queryFn: () => chamarPortal<CursoDetalheAluno>("curso", { curso_id: cursoId }),
    enabled: !!cursoId,
    retry: false,
  });
}

export function useConcluirAula(cursoId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (p: { aula_id: string; tempo_seg?: number; avaliacao?: number | null }) =>
      chamarPortal<{ ok: boolean; certificado: string | null }>("concluir_aula", p),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["colaborador", "curso", cursoId] });
      qc.invalidateQueries({ queryKey: ["colaborador", "cursos"] });
    },
  });
}

export function useResponderQuiz(cursoId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (p: { aula_id: string; respostas: (number | null)[] }) => chamarPortal<ResultadoQuiz>("responder_quiz", p),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["colaborador", "curso", cursoId] });
      qc.invalidateQueries({ queryKey: ["colaborador", "cursos"] });
    },
  });
}

// ── Prova da aula (22/09/2026) ──────────────────────────────────────────
// Espelha trn_prova_estado / trn_prova_responder (migration 205). A opção
// carrega o índice ORIGINAL (`i`): é ele que volta na resposta, mesmo com as
// opções embaralhadas.
export interface PerguntaProva {
  id: string; tipo: "unica" | "multipla" | "vf"; enunciado: string; pontos: number;
  opcoes: { i: number; texto: string }[];
}
export interface EstadoProva {
  tem_prova: boolean;
  config?: {
    titulo: string; instrucoes: string | null; tentativas_max: number | null; nota_minima: number;
    nota_vale: "maior" | "ultima"; tempo_limite_min: number | null; intervalo_min: number | null;
    gabarito: "nunca" | "resultado" | "ao_final" | "sempre"; perguntas: number;
  };
  liberada?: boolean; motivo?: string | null; proxima_em?: string | null; video_assistido?: boolean;
  usadas?: number; restantes?: number | null; nota?: number | null; aprovado?: boolean;
  historico?: { numero: number; nota: number; aprovado: boolean; enviada_em: string; encerramento: string }[];
  aberta?: { id: string; numero: number; iniciada_em: string; expira_em: string | null; perguntas: PerguntaProva[] } | null;
}
export interface ItemCorrecao {
  id: string; ok: boolean; pontos: number; max: number; marcadas: number[];
  corretas?: number[]; explicacao?: string | null;
}
export interface ResultadoProva {
  nota: number; aprovado: boolean; nota_minima: number; pontos: number; pontos_total: number;
  acertos: number; total: number; numero: number; restantes: number | null; nota_vigente: number | null;
  itens: ItemCorrecao[] | null; certificado: string | null;
}

export function useProvaAula(aulaId: string | null | undefined, habilitado = true) {
  return useQuery({
    queryKey: ["colaborador", "prova", aulaId],
    queryFn: () => chamarPortal<EstadoProva>("prova", { aula_id: aulaId }),
    enabled: !!aulaId && habilitado,
    retry: false,
  });
}

export function useIniciarProva(aulaId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => chamarPortal<EstadoProva>("prova_iniciar", { aula_id: aulaId }),
    onSuccess: (dados) => qc.setQueryData(["colaborador", "prova", aulaId], dados),
  });
}

export function useResponderProva(aulaId: string, cursoId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (p: { tentativa_id: string; respostas: Record<string, number[]> }) => chamarPortal<ResultadoProva>("prova_responder", p),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["colaborador", "prova", aulaId] });
      qc.invalidateQueries({ queryKey: ["colaborador", "curso", cursoId] });
      qc.invalidateQueries({ queryKey: ["colaborador", "cursos"] });
    },
  });
}

/** O player chegou ao fim (≥ 90%) — libera a prova. Falha em silêncio. */
export function avisarVideoAssistido(aulaId: string) {
  return chamarPortal("video_assistido", { aula_id: aulaId }).catch(() => undefined);
}

/** Tempo assistido, mandado em lotes pelo player. Falha em silêncio. */
export function registrarTempoAula(aulaId: string, segundos: number) {
  if (segundos <= 0) return;
  chamarPortal("registrar_tempo", { aula_id: aulaId, tempo_seg: Math.round(segundos) }).catch(() => undefined);
}

export function useComentariosAula(aulaId: string | null | undefined) {
  return useQuery({
    queryKey: ["colaborador", "comentarios", aulaId],
    queryFn: () => chamarPortal<ComentarioAluno[]>("comentarios", { aula_id: aulaId }),
    enabled: !!aulaId,
    retry: false,
  });
}

export function useComentar() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (p: { aula_id: string; texto: string }) => chamarPortal<ComentarioAluno[]>("comentar", p),
    onSuccess: (dados, vars) => qc.setQueryData(["colaborador", "comentarios", vars.aula_id], dados),
  });
}

export function useCertificadoColaborador(cursoId: string | undefined) {
  return useQuery({
    queryKey: ["colaborador", "certificado", cursoId],
    queryFn: () => chamarPortal<CertificadoAluno>("certificado", { curso_id: cursoId }),
    enabled: !!cursoId,
    retry: false,
  });
}

export function useMarcarNotificacoesLidas() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => chamarPortal<{ ok: boolean }>("notificacoes_lidas"),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["colaborador", "cursos"] }),
  });
}

export function useAlterarSenhaColaborador() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (p: { atual: string; nova: string }) => chamarPortal<{ ok: boolean; error?: string }>("alterar_senha", p),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["colaborador", "perfil"] }),
  });
}

// ── Formatação ──────────────────────────────────────────────────────────

export const fmtData = (iso: string | null | undefined) => {
  if (!iso) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  return iso;
};
export const fmtHora = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" }) : "—";
export const fmtDataHora = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" }) : "—";
export const fmtMoeda = (v: number | null | undefined) =>
  v == null ? "—" : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
export const fmtMinutos = (min: number | null | undefined) => {
  const m = Math.max(0, Math.round(min ?? 0));
  return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}`;
};
export const mesAtualISO = () => {
  const agora = new Date();
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit" }).formatToParts(agora);
  const ano = p.find((x) => x.type === "year")?.value;
  const mes = p.find((x) => x.type === "month")?.value;
  return `${ano}-${mes}`;
};
export const rotuloMes = (iso: string) => {
  const [a, m] = iso.split("-").map(Number);
  const t = new Date(a, m - 1, 1).toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
  return t.charAt(0).toUpperCase() + t.slice(1);
};
/** "JOÃO CARLOS" → "João" — o nome em EMPREGADOS vem todo em maiúsculas. */
export const primeiroNomeBonito = (nome: string) => {
  const p = (nome ?? "").trim().split(/\s+/)[0] ?? "";
  return p.charAt(0).toUpperCase() + p.slice(1).toLowerCase();
};
