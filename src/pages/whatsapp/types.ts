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
  // Pasta (fila de setor) onde a conversa está. null = ainda não direcionada.
  pasta_codigo: string | null;
  // embutido (join) quando disponível
  contato?: WaContato | null;
}

// Pasta de atendimento. `menu_codigo` é a permissão em app_menu que decide quem
// enxerga a pasta — gerenciada em Administração › Acesso por Usuário.
export interface WaPasta {
  codigo: string;
  nome: string;
  menu_codigo: string;
  ordem: number;
  ativo: boolean;
}

// Código do menu que libera ver TODAS as conversas (inclusive as sem pasta).
export const MENU_TODAS = "whatsapp_todas";

export interface WaMensagem {
  id: string;
  conversa_id: string;
  contato_id: string;
  direcao: "entrada" | "saida";
  tipo: string;
  texto: string | null;
  wa_message_id: string | null;
  status: string;
  origem: "contato" | "bot" | "atendente" | "sistema";
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
  // Preenchido pelo webhook quando a Meta devolve status "failed".
  erro?: { codigo?: number | null; titulo?: string | null; detalhe?: string | null };
  // Reações à mensagem. O WhatsApp permite uma por pessoa, então são dois
  // slots: a do contato e a nossa. String vazia/ausente = sem reação.
  reacoes?: { deles?: string | null; nossa?: string | null };
}

// Paleta do seletor. O WhatsApp aceita qualquer emoji, mas uma lista curta
// resolve o caso real (concordar, agradecer, registrar que viu) sem abrir um
// seletor completo dentro da bolha.
export const EMOJIS_REACAO = ["👍", "❤️", "😂", "😮", "😢", "🙏"];

// Motivo da falha em português. O 131047 é o caso do dia a dia: passou das 24h
// desde a última mensagem do contato, então só template é aceito.
export const motivoFalha = (erro?: WaPayload["erro"]) => {
  if (!erro) return "";
  if (erro.codigo === 131047 || erro.codigo === 131051) {
    return "Fora da janela de 24h: o contato precisa escrever primeiro para você poder responder.";
  }
  if (erro.codigo === 131026) return "Número não recebe mensagens no WhatsApp.";
  if (erro.codigo === 131049 || erro.codigo === 130472) return "A Meta limitou a entrega para este contato.";
  return erro.detalhe || erro.titulo || `Erro ${erro.codigo ?? ""}`.trim();
};

export type WaMenuAcao = "texto" | "submenu" | "ia" | "humano" | "transferir" | "concluir";

export interface WaMenuOpcao {
  id: string;
  titulo: string;
  acao: WaMenuAcao;
  valor?: string; // texto da resposta (acao "texto"/"humano") ou aviso (acao "ia"/"transferir")
  // Botões pendurados nesta opção. Em "submenu" são o próprio destino; em
  // "texto" são os próximos passos oferecidos JUNTO com a resposta (a resposta
  // vira o corpo da mensagem e eles os botões). Como cada botão é uma opção
  // comum, a resposta dele também pode ter botões — a árvore não tem limite.
  submenu?: WaMenu | null;
  // acao "transferir": código da pasta (WA_PASTA.codigo) que recebe a conversa.
  pasta?: string | null;
  // Cutucada desta opção: sem resposta em `minutos`, o bot manda `mensagem`
  // sozinho. Teto de 24h — acima disso a Meta recusa (erro 131047).
  retomada?: { minutos: number; mensagem: string } | null;
}

export const RETOMADA_MAX_MIN = 1440; // 24h

// Minutos → "2h30", "45min". Usado nos rótulos da configuração.
export const fmtMinutos = (min: number) => {
  const m = Math.max(0, Math.trunc(min));
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (!h) return `${r}min`;
  return r ? `${h}h${String(r).padStart(2, "0")}` : `${h}h`;
};

export interface WaMenu {
  titulo: string; // mensagem de abertura do menu (é também a saudação)
  opcoes: WaMenuOpcao[];
}

// Modo da conversa: o menu abre tudo; a IA só assume via a opção de atendimento
// por IA. O simulador guarda isto no estado; o webhook reconstrói do histórico.
export type WaModo = "menu" | "ia";

export type WaProvedor = "groq" | "gemini" | "openrouter" | "anthropic";

export interface WaBotConfig {
  id: boolean;
  ativo: boolean;
  persona: string;
  fallback: string;
  horario_inicio: string;
  horario_fim: string;
  dias_semana: number[];
  fora_horario_msg: string;
  atende_24h: boolean;
  // Minutos em que o menu/saudação não se repete na mesma conversa. 0 = repete sempre.
  nao_repetir_menu_min: number;
  provedor: WaProvedor;
  modelo: string;
  max_tokens: number;
  menu?: WaMenu | null;
}

// ---- Simulador (submódulo Testes) ----
// Espelha o retorno da edge function whatsapp-testar.
export type WaTesteTipo =
  | "ia" | "fallback" | "menu" | "menu_texto" | "menu_ia" | "menu_humano" | "menu_transferir"
  | "fora_horario" | "nada" | "silencio" | "menu_concluir" | "ping";

export interface WaTesteDiagnostico {
  bot_ativo: boolean;
  provedor: string;
  modelo: string;
  secret_esperado: string;
  atende_24h: boolean;
  dentro_horario: boolean;
  menu_ativo: boolean;
  base_itens: number;
  ms: number;
  erro: string | null;
}

export interface WaTesteResposta {
  tipo: WaTesteTipo;
  ok?: boolean;
  resposta: string | null;
  nota?: string;
  system?: string;
  botoes?: Array<{ id: string; titulo: string }>;
  formato?: "button" | "list";
  modo?: WaModo;               // modo da conversa depois desta mensagem
  diagnostico: WaTesteDiagnostico;
}

// Rótulo do que aconteceu, para o painel de diagnóstico do simulador.
export const TESTE_TIPO_LABEL: Record<WaTesteTipo, string> = {
  ia: "Resposta da IA",
  fallback: "Fallback (a IA falhou)",
  menu: "Menu de opções",
  menu_texto: "Resposta pronta do menu",
  menu_ia: "Menu encaminhou para a IA",
  menu_humano: "Menu encaminhou para atendente",
  menu_transferir: "Menu transferiu para uma pasta",
  fora_horario: "Fora do horário de atendimento",
  nada: "Sem resposta (menu não configurado)",
  silencio: "Menu não repetido (enviado há pouco)",
  menu_concluir: "Contato encerrou o atendimento",
  ping: "Teste de conexão",
};

export const MENU_ACOES: Array<{ value: WaMenuAcao; label: string; ajuda: string }> = [
  { value: "texto", label: "Responder um texto", ajuda: "O bot envia uma resposta pronta (ex.: link das vagas). A resposta pode terminar com botões para os próximos passos." },
  { value: "submenu", label: "Abrir mais opções", ajuda: "Mostra outro conjunto de botões dentro desta opção (fluxo em cascata)." },
  { value: "transferir", label: "Transferir para…", ajuda: "Manda a conversa para a pasta do setor e desliga o bot. Só quem tem acesso à pasta atende." },
  { value: "ia", label: "Atendimento por I.A", ajuda: "Encaminha para a IA: a pessoa passa a conversar livre e a IA responde." },
  { value: "concluir", label: "Encerrar atendimento", ajuda: "A pessoa encerra o atendimento sozinha: a conversa vai para a pasta Atendimento Concluído e fica registrado no histórico que foi ela quem encerrou." },
  { value: "humano", label: "Falar com atendente", ajuda: "Desliga o bot e passa para atendimento humano, sem pasta." },
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
