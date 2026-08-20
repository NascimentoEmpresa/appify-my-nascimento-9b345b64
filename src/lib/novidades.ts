/**
 * NOVIDADES DO SISTEMA — regras da funcionalidade, num lugar só.
 *
 * O changelog interno do ERP: aparece no Início, no megafone do topo e na
 * página /app/novidades. Todo mundo lê; só quem tem o flag "Pode criar
 * novidades do sistema" (menu de capacidade `novidades_publicar` em
 * Administração › Acesso por Usuário) publica.
 *
 * Este arquivo não importa Supabase nem React de propósito: é o que os testes
 * carregam, e é o que as três telas compartilham para não divergirem no
 * primeiro ajuste de rótulo.
 */

export const MENU_PUBLICAR = "novidades_publicar";
export const TABELA = "SISTEMA_NOVIDADES";
export const TABELA_LIDAS = "SISTEMA_NOVIDADES_LIDAS";

export type TipoNovidade = "NOVO" | "MELHORIA" | "AJUSTE" | "AVISO";

export interface Novidade {
  id: number;
  titulo: string;
  descricao: string;
  tipo: TipoNovidade;
  rota: string | null;
  publicado: boolean;
  publicado_em: string;
  criado_por?: string | null;
  criado_por_nome?: string | null;
}

/** O selo de cada tipo. `cor` é usada em CSS var, então vem em hex. */
export const TIPOS: { valor: TipoNovidade; rotulo: string; cor: string; fundo: string }[] = [
  { valor: "NOVO",     rotulo: "Novo",     cor: "#15803d", fundo: "#dcfce7" },
  { valor: "MELHORIA", rotulo: "Melhoria", cor: "#1d4ed8", fundo: "#dbeafe" },
  { valor: "AJUSTE",   rotulo: "Ajuste",   cor: "#a16207", fundo: "#fef9c3" },
  { valor: "AVISO",    rotulo: "Aviso",    cor: "#b91c1c", fundo: "#fee2e2" },
];

export const selo = (t?: string | null) =>
  TIPOS.find(x => x.valor === String(t ?? "").toUpperCase()) ?? TIPOS[0];

/** Limite do contador: acima disso a bolinha vira "9+" (não cabe mais que isso). */
export const TETO_BOLINHA = 9;

export const rotuloContador = (n: number): string =>
  n > TETO_BOLINHA ? `${TETO_BOLINHA}+` : String(n);

/**
 * Quais novidades esta pessoa ainda não viu.
 *
 * A marca de leitura é por linha (SISTEMA_NOVIDADES_LIDAS), não uma data de
 * "última visita": quem publica pode editar uma novidade antiga, e uma data
 * única faria a lista inteira voltar a piscar. Rascunho não conta — ele só
 * existe para quem publica, e não é "novidade" para ninguém ainda.
 */
export function naoLidas(novidades: Novidade[], lidas: Iterable<number>): Novidade[] {
  const vistas = new Set(lidas);
  return novidades.filter(n => n.publicado && !vistas.has(n.id));
}

/** Data no formato curto que a lista usa: 20/08/2026. */
export function fmtData(iso?: string | null): string {
  const s = String(iso ?? "");
  if (!s) return "—";
  const d = new Date(s.length <= 10 ? `${s}T12:00:00` : s);
  return isNaN(+d) ? s : d.toLocaleDateString("pt-BR");
}

/** "hoje" / "ontem" / "há 3 dias" / a data. Cabeçalho de novidade cansa de ver data. */
export function fmtQuando(iso?: string | null, agora = new Date()): string {
  const s = String(iso ?? "");
  if (!s) return "—";
  const d = new Date(s.length <= 10 ? `${s}T12:00:00` : s);
  if (isNaN(+d)) return s;
  const dia = (x: Date) => Date.UTC(x.getFullYear(), x.getMonth(), x.getDate());
  const dias = Math.round((dia(agora) - dia(d)) / 86_400_000);
  if (dias <= 0) return "hoje";
  if (dias === 1) return "ontem";
  if (dias < 7) return `há ${dias} dias`;
  return fmtData(iso);
}

/** Novidade "fresquinha" — é o que acende o selo NOVO no menu lateral. */
export const DIAS_RECENTE = 7;
export function ehRecente(iso?: string | null, agora = new Date()): boolean {
  const d = new Date(String(iso ?? ""));
  if (isNaN(+d)) return false;
  return (agora.getTime() - d.getTime()) / 86_400_000 <= DIAS_RECENTE;
}

export interface FormNovidade {
  titulo: string;
  descricao: string;
  tipo: TipoNovidade;
  rota: string;
  publicado: boolean;
}

export const FORM_VAZIO: FormNovidade = {
  titulo: "", descricao: "", tipo: "NOVO", rota: "", publicado: true,
};

/**
 * Erro do formulário, ou null. Devolve UMA mensagem: o formulário tem quatro
 * campos, e uma lista de erros ali é mais ruído que ajuda.
 *
 * A rota é validada de propósito: ela vira o "Saiba mais →", e um link para
 * fora do ERP (ou um `javascript:`) não tem o que fazer no changelog interno.
 */
export function validarNovidade(f: FormNovidade): string | null {
  if (!f.titulo.trim()) return "Informe o título da novidade.";
  if (f.titulo.trim().length < 4) return "O título está curto demais para dizer o que mudou.";
  if (!f.descricao.trim()) return "Escreva o que mudou — é o que a equipe vai ler.";
  if (!TIPOS.some(t => t.valor === f.tipo)) return "Escolha o tipo da novidade.";
  const rota = f.rota.trim();
  if (rota && !rota.startsWith("/")) return 'O link deve ser uma rota interna do ERP, começando com "/" (ex.: /app/rh/colaboradores).';
  if (rota.startsWith("//")) return "O link deve ser uma rota interna do ERP, não um endereço externo.";
  return null;
}

/** O que vai para o banco. Rota vazia vira NULL, não string vazia. */
export function paraBanco(f: FormNovidade, nome?: string | null) {
  return {
    titulo: f.titulo.trim(),
    descricao: f.descricao.trim(),
    tipo: f.tipo,
    rota: f.rota.trim() || null,
    publicado: f.publicado,
    criado_por_nome: nome?.trim() || null,
  };
}
