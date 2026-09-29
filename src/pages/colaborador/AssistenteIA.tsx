import { useEffect, useRef, useState } from "react";
import { Loader2, SendHorizontal, Sparkles, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { SUPABASE_FUNCTIONS_URL } from "@/integrations/supabase/env";
import { EVENTO_SESSAO_EXPIRADA, lerToken, limparSessao } from "@/hooks/useColaboradorPortal";

// =====================================================================
// PORTAL DO COLABORADOR — botão "Tirar dúvida" (assistente de IA)
//
// Flutua no canto da tela de entrar e de todas as telas do portal. Fala com
// a Edge Function `colaborador-ia`, que decide o que a IA pode saber: sem
// token (tela de entrar) ela só ajuda com acesso e uso do portal; com token
// recebe um contexto básico do colaborador — nunca CPF, salário ou banco.
// A conversa vive só na memória da página: fechou o navegador, apagou.
// =====================================================================

const URL_IA = `${SUPABASE_FUNCTIONS_URL}/colaborador-ia`;

type Mensagem = { role: "user" | "assistant"; content: string };

const SUGESTOES_SEM_SESSAO = [
  "Não consigo entrar no portal",
  "Qual é a minha senha?",
  "Esqueci a senha que eu criei",
];
const SUGESTOES_COM_SESSAO = [
  "Como bato o ponto?",
  "Esqueci de bater o ponto, e agora?",
  "Como troco minha senha?",
  "Como pego meu certificado?",
];

export function AssistenteIA({ logado = false, acimaDaBarra = false }: { logado?: boolean; acimaDaBarra?: boolean }) {
  const [aberto, setAberto] = useState(false);
  const [mensagens, setMensagens] = useState<Mensagem[]>([]);
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const fimRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    fimRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [mensagens, enviando, aberto]);

  useEffect(() => {
    if (aberto) setTimeout(() => inputRef.current?.focus(), 50);
  }, [aberto]);

  const perguntar = async (pergunta: string) => {
    const conteudo = pergunta.trim();
    if (!conteudo || enviando) return;
    const historico: Mensagem[] = [...mensagens, { role: "user", content: conteudo }];
    setMensagens(historico);
    setTexto("");
    setErro(null);
    setEnviando(true);
    try {
      const resp = await fetch(URL_IA, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: logado ? lerToken() : null, mensagens: historico }),
      });
      const dados = await resp.json().catch(() => ({}));
      if (resp.status === 401 && dados?.sessao === false) {
        limparSessao();
        window.dispatchEvent(new Event(EVENTO_SESSAO_EXPIRADA));
        return;
      }
      if (!resp.ok || !dados?.resposta) {
        setErro(dados?.error ?? "Não consegui responder agora. Tente de novo.");
        return;
      }
      setMensagens([...historico, { role: "assistant", content: dados.resposta }]);
    } catch {
      setErro("Sem conexão. Verifique a internet e tente de novo.");
    } finally {
      setEnviando(false);
    }
  };

  const sugestoes = logado ? SUGESTOES_COM_SESSAO : SUGESTOES_SEM_SESSAO;

  return (
    <>
      {!aberto && (
        <button
          type="button"
          onClick={() => setAberto(true)}
          className={cn(
            "btn-relief fixed right-4 z-40 flex items-center gap-2 rounded-full bg-gradient-accent px-4 py-3 text-sm font-semibold text-accent-foreground shadow-lg transition-transform hover:scale-105 active:scale-95",
            acimaDaBarra ? "bottom-20 md:bottom-6" : "bottom-6",
          )}
          style={acimaDaBarra ? { marginBottom: "env(safe-area-inset-bottom)" } : undefined}
          aria-label="Tirar dúvida com o assistente"
        >
          <Sparkles className="h-4 w-4" />
          Tirar dúvida
        </button>
      )}

      {aberto && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-end sm:justify-end sm:bg-transparent sm:p-6">
          <div
            role="dialog"
            aria-label="Assistente do Portal do Colaborador"
            className="flex h-[85vh] w-full flex-col overflow-hidden rounded-t-2xl border border-border bg-card shadow-2xl sm:h-[600px] sm:max-h-[85vh] sm:w-[400px] sm:rounded-2xl"
          >
            <header className="flex items-center gap-3 bg-gradient-hero px-4 py-3 text-white">
              <span className="grid h-9 w-9 place-items-center rounded-full bg-white/15">
                <Sparkles className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1 leading-tight">
                <p className="text-sm font-semibold">Assistente do Colaborador</p>
                <p className="text-[11px] text-white/70">Tire suas dúvidas sobre o portal e o seu trabalho</p>
              </div>
              <button
                type="button"
                onClick={() => setAberto(false)}
                className="grid h-8 w-8 place-items-center rounded-lg text-white/80 hover:bg-white/10 hover:text-white"
                aria-label="Fechar"
              >
                <X className="h-4 w-4" />
              </button>
            </header>

            <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
              <Bolha papel="assistant">
                Olá! Sou o assistente do Portal do Colaborador. Posso ajudar a entrar no portal, bater o ponto, usar os
                cursos e tirar dúvidas do dia a dia. O que você precisa?
              </Bolha>

              {mensagens.length === 0 && (
                <div className="flex flex-wrap gap-2 pt-1">
                  {sugestoes.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => perguntar(s)}
                      className="rounded-full border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground hover:border-primary hover:text-primary"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              )}

              {mensagens.map((m, i) => <Bolha key={i} papel={m.role}>{semMarkdown(m.content)}</Bolha>)}

              {enviando && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Pensando…
                </div>
              )}
              {erro && (
                <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">{erro}</p>
              )}
              <div ref={fimRef} />
            </div>

            <form
              onSubmit={(e) => { e.preventDefault(); perguntar(texto); }}
              className="border-t border-border bg-background p-3"
              style={{ paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom))" }}
            >
              <div className="flex items-end gap-2">
                <textarea
                  ref={inputRef}
                  rows={1}
                  maxLength={1000}
                  value={texto}
                  onChange={(e) => setTexto(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); perguntar(texto); }
                  }}
                  placeholder="Escreva sua dúvida…"
                  className="max-h-32 min-h-[44px] flex-1 resize-none rounded-xl border border-border bg-card px-3 py-2.5 text-base focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/30"
                />
                <button
                  type="submit"
                  disabled={!texto.trim() || enviando}
                  className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground disabled:opacity-50"
                  aria-label="Enviar"
                >
                  <SendHorizontal className="h-4 w-4" />
                </button>
              </div>
              <p className="mt-2 text-center text-[10px] text-muted-foreground">
                Respostas geradas por IA podem ter erros. Em caso de dúvida, confirme com o RH. Não envie sua senha.
              </p>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

// O prompt pede texto puro, mas o modelo às vezes escapa um **negrito** ou
// "## Título" — no balão isso vira asterisco solto, então tira aqui.
function semMarkdown(t: string) {
  return t.replace(/\*\*(.+?)\*\*/g, "$1").replace(/^#{1,6}\s+/gm, "");
}

function Bolha({ papel, children }: { papel: Mensagem["role"]; children: React.ReactNode }) {
  const minha = papel === "user";
  return (
    <div className={cn("flex", minha ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed",
          minha ? "rounded-br-md bg-primary text-primary-foreground" : "rounded-bl-md bg-muted text-foreground",
        )}
      >
        {children}
      </div>
    </div>
  );
}
