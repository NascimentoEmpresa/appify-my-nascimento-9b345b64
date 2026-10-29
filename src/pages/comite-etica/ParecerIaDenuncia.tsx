import { useState } from "react";
import ReactMarkdown from "react-markdown";
import { AlertTriangle, Loader2, MessageSquare, RefreshCw, Send, Sparkles } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { fmtDataHora } from "./dossie";

// =====================================================================
// PARECER I.A — resumo e conversa sobre a denúncia (29/10/2026)
//
// Mesmo desenho do parecer de Chamados de Sistemas (ParecerIaChamado.tsx),
// com uma diferença de propósito: NADA é guardado. A Edge Function
// denuncia-parecer-ia lê o caso com o login de quem clicou (a mesma RLS das
// telas do Canal), e o que um usuário vê não é o que outro vê — um resumo
// gravado por quem enxerga tudo vazaria para a Presidência, que não lê as
// mensagens nem os anexos sigilosos. Por isso o resumo é gerado sob demanda
// e vive só nesta tela, como a conversa.
//
// A I.A falhar aparece NA TELA — nunca em silêncio.
// =====================================================================

async function chamarFuncao(body: Record<string, unknown>): Promise<{ texto?: string; modelo?: string; gerado_em?: string }> {
  const { data, error } = await supabase.functions.invoke("denuncia-parecer-ia", { body });
  if (error) {
    // A mensagem útil vem no corpo (403 sem acesso, 429 sem tokens).
    const ctx = (error as { context?: Response }).context;
    const corpo = ctx && typeof ctx.json === "function" ? await ctx.json().catch(() => null) : null;
    throw new Error(corpo?.error ?? error.message);
  }
  if (data?.error) throw new Error(data.error);
  return data ?? {};
}

type MsgChat = { role: "user" | "assistant"; content: string; erro?: boolean };

const SUGESTOES = [
  "O que falta para concluir?",
  "Quais prazos estouraram?",
  "Resuma para a Presidência.",
  "Redija o parecer conclusivo.",
];

const PROSA = "prose prose-sm max-w-none text-xs dark:prose-invert prose-headings:mb-1 prose-headings:mt-3 prose-headings:text-sm prose-p:my-1 prose-ul:my-1 prose-li:my-0";

/** Conversa sobre a denúncia. O histórico vive só nesta tela e vai junto a
 *  cada pergunta; a função relê o caso (com o login de quem pergunta) toda vez. */
function ChatDenunciaIa({ denunciaId }: { denunciaId: string }) {
  const [msgs, setMsgs] = useState<MsgChat[]>([]);
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);

  const enviar = async (pergunta: string) => {
    const p = pergunta.trim();
    if (!p || enviando) return;
    // Erros não voltam para a I.A como se fossem resposta dela.
    const historico = msgs.filter((m) => !m.erro).map(({ role, content }) => ({ role, content }));
    setMsgs((cur) => [...cur, { role: "user", content: p }]);
    setTexto("");
    setEnviando(true);
    try {
      const r = await chamarFuncao({ denuncia_id: denunciaId, modo: "chat", pergunta: p, historico });
      setMsgs((cur) => [...cur, { role: "assistant", content: r.texto || "A I.A devolveu resposta vazia.", erro: !r.texto }]);
    } catch (e) {
      setMsgs((cur) => [...cur, { role: "assistant", content: e instanceof Error ? e.message : String(e), erro: true }]);
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div className="space-y-2 rounded-lg border border-border bg-muted/30 p-3">
      <p className="flex items-center gap-1.5 text-xs font-semibold"><MessageSquare className="h-3.5 w-3.5 text-primary" /> Pergunte à I.A sobre a denúncia</p>
      {msgs.length > 0 && (
        <div className="max-h-96 space-y-2 overflow-y-auto pr-1">
          {msgs.map((m, i) => (
            m.role === "user" ? (
              <div key={i} className="ml-auto max-w-[85%] whitespace-pre-line rounded-lg bg-primary px-3 py-2 text-xs text-primary-foreground">{m.content}</div>
            ) : m.erro ? (
              <div key={i} className="flex max-w-[95%] items-start gap-1.5 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> <span>A I.A não respondeu: {m.content}</span>
              </div>
            ) : (
              <div key={i} className="max-w-[95%] rounded-lg border border-border bg-background px-3 py-2 text-xs">
                <div className={PROSA}><ReactMarkdown>{m.content}</ReactMarkdown></div>
              </div>
            )
          ))}
          {enviando && <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" /> A I.A está pensando…</p>}
        </div>
      )}
      {msgs.length === 0 && (
        <div className="flex flex-wrap gap-1.5">
          {SUGESTOES.map((s) => (
            <button key={s} type="button" onClick={() => enviar(s)} disabled={enviando}
              className="rounded-full border border-border bg-background px-2.5 py-1 text-[11px] hover:border-primary/40 disabled:opacity-50">{s}</button>
          ))}
        </div>
      )}
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); enviar(texto); }}>
        <Textarea
          value={texto} onChange={(e) => setTexto(e.target.value)} rows={1}
          placeholder="Ex.: o que falta para concluir este caso?"
          className="min-h-9 flex-1 resize-none text-xs"
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); enviar(texto); } }}
        />
        <Button type="submit" size="sm" className="h-9 gap-1" disabled={enviando || !texto.trim()}>
          {enviando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
        </Button>
      </form>
    </div>
  );
}

/** Card "Parecer I.A" — o mesmo na ficha do Comitê e na da Presidência. */
export function ParecerIaDenuncia({ denunciaId }: { denunciaId: string }) {
  const [resumo, setResumo] = useState<{ texto: string; modelo?: string; gerado_em?: string } | null>(null);
  const [gerando, setGerando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  // O diálogo da ficha é reaproveitado entre denúncias: trocar o caso zera o card.
  const [ultima, setUltima] = useState(denunciaId);
  if (denunciaId !== ultima) { setUltima(denunciaId); setResumo(null); setErro(null); }

  const gerar = async () => {
    setGerando(true);
    setErro(null);
    try {
      const r = await chamarFuncao({ denuncia_id: denunciaId, modo: "resumo" });
      if (!r.texto) throw new Error("A I.A devolveu resposta vazia. Tente de novo.");
      setResumo({ texto: r.texto, modelo: r.modelo, gerado_em: r.gerado_em });
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setGerando(false);
    }
  };

  return (
    <Card className="space-y-3 border-primary/20 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="flex items-center gap-1.5 text-sm font-bold"><Sparkles className="h-4 w-4 text-primary" /> Parecer I.A</p>
          <p className="text-xs text-muted-foreground">
            Resumo do caso e perguntas à I.A. Ela lê só o que o seu acesso enxerga, nunca a identidade do denunciante nem o conteúdo dos arquivos — e nada fica gravado.
          </p>
        </div>
        <Button size="sm" variant="outline" className="h-7 gap-1.5 text-xs" onClick={gerar} disabled={gerando}>
          {gerando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          {resumo ? "Gerar de novo" : "Gerar resumo"}
        </Button>
      </div>

      {erro && (
        <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p className="font-semibold">{resumo ? "A nova geração falhou — o resumo abaixo é o anterior." : "A I.A não conseguiu gerar o resumo."}</p>
            <p className="mt-0.5 [overflow-wrap:anywhere]">{erro}</p>
          </div>
        </div>
      )}

      {gerando && !resumo ? (
        <p className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" /> A I.A está lendo o procedimento…</p>
      ) : resumo ? (
        <div className="rounded-lg border border-border bg-background p-3">
          <div className={PROSA}><ReactMarkdown>{resumo.texto}</ReactMarkdown></div>
          <p className="mt-2 text-[10px] text-muted-foreground">
            Gerado automaticamente — confira com a ficha antes de usar. {fmtDataHora(resumo.gerado_em)}{resumo.modelo ? ` · ${resumo.modelo}` : ""}.
          </p>
        </div>
      ) : !erro && (
        <p className="text-xs text-muted-foreground">Clique em “Gerar resumo” para a I.A contar o caso: relato, linha do tempo, providências, evidências, resultado e próximos passos.</p>
      )}

      <ChatDenunciaIa key={denunciaId} denunciaId={denunciaId} />
    </Card>
  );
}
