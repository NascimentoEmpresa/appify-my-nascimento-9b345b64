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

export interface WaMidia {
  tipo: string;                // image | document | audio | video | sticker
  media_id?: string;
  filename?: string | null;
  mime_type?: string | null;
  caption?: string | null;
  storage_path?: string;
  tamanho?: number | null;
  status?: "baixando" | "pronto" | "erro";
}

export interface WaPayload {
  tipo?: string;
  botoes?: Array<{ id: string; titulo: string }>;
  reply_id?: string;
  midia?: WaMidia;
}

export type WaMenuAcao = "texto" | "ia" | "humano";

export interface WaMenuOpcao {
  id: string;
  titulo: string;
  acao: WaMenuAcao;
  valor?: string; // texto da resposta (acao "texto"/"humano") ou aviso (acao "ia")
}

export interface WaMenu {
  ativo: boolean;
  titulo: string; // corpo da mensagem do menu
  opcoes: WaMenuOpcao[];
}

export type WaProvedor = "groq" | "gemini" | "openrouter" | "anthropic";

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
  provedor: WaProvedor;
  modelo: string;
  max_tokens: number;
  menu?: WaMenu | null;
}

export const MENU_ACOES: Array<{ value: WaMenuAcao; label: string; ajuda: string }> = [
  { value: "texto", label: "Responder um texto", ajuda: "O bot envia uma resposta pronta." },
  { value: "ia", label: "Continuar com a IA", ajuda: "O cliente escreve à vontade e a IA responde." },
  { value: "humano", label: "Falar com atendente", ajuda: "Desliga o bot e passa para atendimento humano." },
];

export interface WaConhecimento {
  id: string;
  titulo: string;
  conteudo: string;
  ativo: boolean;
  ordem: number;
}

// Provedores de IA. O secret é a chave que precisa existir em
// Supabase → Edge Functions → Secrets para o provedor funcionar.
export const PROVEDORES: Array<{ value: WaProvedor; label: string; secret: string; ajuda: string }> = [
  {
    value: "groq", label: "Groq — grátis", secret: "GROQ_API_KEY",
    ajuda: "Chave em console.groq.com (sem cartão). Respostas quase instantâneas e limite alto — melhor opção para atendimento.",
  },
  {
    value: "gemini", label: "Google Gemini — grátis", secret: "GEMINI_API_KEY",
    ajuda: "Chave em aistudio.google.com (sem cartão). Melhor português entre os gratuitos, mas o limite diário é baixo.",
  },
  {
    value: "openrouter", label: "OpenRouter — grátis", secret: "OPENROUTER_API_KEY",
    ajuda: "Chave em openrouter.ai. Vários modelos :free com uma chave só; limite diário baixo sem créditos.",
  },
  {
    value: "anthropic", label: "Claude — pago", secret: "ANTHROPIC_API_KEY",
    ajuda: "Chave em console.anthropic.com. Melhor qualidade de resposta, cobrado por uso.",
  },
];

export const MODELOS: Record<WaProvedor, Array<{ value: string; label: string }>> = {
  groq: [
    { value: "llama-3.3-70b-versatile", label: "Llama 3.3 70B (recomendado)" },
    { value: "openai/gpt-oss-120b", label: "GPT-OSS 120B (mais capaz)" },
    { value: "llama-3.1-8b-instant", label: "Llama 3.1 8B (mais rápido)" },
  ],
  gemini: [
    { value: "gemini-2.5-flash", label: "Gemini 2.5 Flash (recomendado)" },
    { value: "gemini-2.0-flash", label: "Gemini 2.0 Flash (limite maior)" },
    { value: "gemini-2.5-flash-lite", label: "Gemini 2.5 Flash Lite (mais rápido)" },
  ],
  openrouter: [
    { value: "meta-llama/llama-3.3-70b-instruct:free", label: "Llama 3.3 70B (free)" },
    { value: "deepseek/deepseek-chat-v3-0324:free", label: "DeepSeek V3 (free)" },
    { value: "google/gemma-3-27b-it:free", label: "Gemma 3 27B (free)" },
  ],
  anthropic: [
    { value: "claude-opus-5", label: "Claude Opus 5 (mais capaz)" },
    { value: "claude-sonnet-5", label: "Claude Sonnet 5 (equilíbrio)" },
    { value: "claude-haiku-4-5", label: "Claude Haiku 4.5 (rápido/econômico)" },
  ],
};

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
