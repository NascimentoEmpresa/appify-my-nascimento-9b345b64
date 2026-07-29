// Tipos e helpers do módulo WhatsApp — Chatbot.

export interface WaContato {
  id: string;
  wa_id: string;
  nome: string | null;
  telefone: string | null;
}

export interface WaConversa {
  id: string;
  contato_id: string;
  status: string;
  bot_ativo: boolean;
  atendente_id: string | null;
  ultima_mensagem_em: string | null;
  ultima_mensagem_preview: string | null;
  ultima_direcao: string | null;
  nao_lidas: number;
  // embutido (join) quando disponível
  contato?: WaContato | null;
}

export interface WaMensagem {
  id: string;
  conversa_id: string;
  contato_id: string;
  direcao: "entrada" | "saida";
  tipo: string;
  texto: string | null;
  wa_message_id: string | null;
  status: string;
  origem: "contato" | "bot" | "atendente";
  autor_id: string | null;
  criada_em: string;
  // Mensagens interativas: botões enviados (saída) ou id do botão clicado (entrada).
  payload?: WaPayload | null;
}

export interface WaPayload {
  tipo?: string;
  botoes?: Array<{ id: string; titulo: string }>;
  reply_id?: string;
}

export interface WaBotConfig {
  id: boolean;
  ativo: boolean;
  persona: string;
  saudacao: string | null;
  fallback: string;
  horario_inicio: string;
  horario_fim: string;
  dias_semana: number[];
  fora_horario_msg: string;
  modelo: string;
  max_tokens: number;
}

export interface WaConhecimento {
  id: string;
  titulo: string;
  conteudo: string;
  ativo: boolean;
  ordem: number;
}

export const MODELOS = [
  { value: "claude-opus-5", label: "Claude Opus 5 (mais capaz)" },
  { value: "claude-sonnet-5", label: "Claude Sonnet 5 (equilíbrio)" },
  { value: "claude-haiku-4-5", label: "Claude Haiku 4.5 (rápido/econômico)" },
] as const;

export const DIAS = [
  { v: 0, l: "Dom" }, { v: 1, l: "Seg" }, { v: 2, l: "Ter" }, { v: 3, l: "Qua" },
  { v: 4, l: "Qui" }, { v: 5, l: "Sex" }, { v: 6, l: "Sáb" },
] as const;

export const fmtHora = (s?: string | null) => {
  if (!s) return "";
  const d = new Date(s);
  return isNaN(+d) ? "" : d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
};
export const fmtDataHora = (s?: string | null) => {
  if (!s) return "—";
  const d = new Date(s);
  return isNaN(+d) ? "—" : d.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
};

// Número no formato Cloud API (55DDNNNNNNNNN) → (DD) NNNNN-NNNN quando possível.
export const fmtTelefone = (wa?: string | null) => {
  if (!wa) return "—";
  const d = wa.replace(/\D/g, "");
  const nac = d.startsWith("55") ? d.slice(2) : d;
  if (nac.length === 11) return `(${nac.slice(0, 2)}) ${nac.slice(2, 7)}-${nac.slice(7)}`;
  if (nac.length === 10) return `(${nac.slice(0, 2)}) ${nac.slice(2, 6)}-${nac.slice(6)}`;
  return wa;
};

export const iniciais = (nome?: string | null, wa?: string | null) => {
  const base = (nome ?? "").trim();
  if (base) return base.split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? "").join("");
  return (wa ?? "?").slice(-2);
};
