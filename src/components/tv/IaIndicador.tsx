import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { Loader2, Send, Sparkles } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

// =====================================================================
// "De onde vem este número?" — I.A do indicador gerencial (14/10/2026,
// Edge tvg-ia + mig 20261014000014).
//
// Pedido do Pablo, na prévia "Ver como na TV": "ao clicar com o mouse em cima
// de cada um, uma I.A diga da onde vem cada informação, e consiga perguntar
// mais coisas". Abre já explicando a origem (modo "origem"); depois é
// conversa, com o histórico. A Edge lê o resultado e o SQL do cálculo com o
// login de quem pergunta — a tela só manda o código do indicador.
// =====================================================================

type Msg = { role: "user" | "assistant"; content: string };

async function perguntarIa(codigo: string, modo: "origem" | "pergunta", pergunta?: string, historico?: Msg[]): Promise<string> {
  const { data, error } = await supabase.functions.invoke("tvg-ia", { body: { codigo, modo, pergunta, historico } });
  if (error) {
    let msg = error.message;
    try { const corpo = await (error as { context?: Response }).context?.json(); if (corpo?.error) msg = corpo.error; } catch { /* sem corpo */ }
    throw new Error(msg);
  }
  if (data?.error) throw new Error(data.error);
  return String(data?.texto ?? "");
}

export function IaIndicadorDialog({ codigo, nome, onClose }: { codigo: string; nome: string; onClose: () => void }) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [texto, setTexto] = useState("");
  const fim = useRef<HTMLDivElement>(null);

  // Ao abrir: a explicação de origem.
  useEffect(() => {
    let vivo = true;
    setMsgs([]); setErro(null); setCarregando(true);
    perguntarIa(codigo, "origem")
      .then((t) => { if (vivo) setMsgs([{ role: "assistant", content: t }]); })
      .catch((e) => { if (vivo) setErro((e as Error).message); })
      .finally(() => { if (vivo) setCarregando(false); });
    return () => { vivo = false; };
  }, [codigo]);

  useEffect(() => { fim.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [msgs, carregando]);

  const enviar = async (p?: string) => {
    const pergunta = (p ?? texto).trim();
    if (!pergunta || carregando) return;
    const historico = msgs;
    setMsgs([...historico, { role: "user", content: pergunta }]);
    setTexto(""); setErro(null); setCarregando(true);
    try {
      const t = await perguntarIa(codigo, "pergunta", pergunta, historico);
      setMsgs((m) => [...m, { role: "assistant", content: t }]);
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setCarregando(false);
    }
  };

  const sugestoes = ["Quais contratos mais pesam nesse número?", "Por que está fora da meta?", "O que eu faço para melhorar este indicador?"];

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[88vh] max-w-2xl flex-col gap-3">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 pr-6"><Sparkles className="h-5 w-5 text-violet-600" /> {nome}</DialogTitle>
          <DialogDescription>A I.A lê o número atual e o cálculo que o ERP faz — explica de onde vem cada informação e responde suas perguntas.</DialogDescription>
        </DialogHeader>

        <div className="min-h-[220px] flex-1 space-y-3 overflow-y-auto rounded-lg border bg-muted/30 p-3">
          {msgs.map((m, k) => (
            <div key={k} className={m.role === "user" ? "ml-10 rounded-xl bg-primary px-3 py-2 text-sm text-primary-foreground" : "mr-4 rounded-xl border bg-card px-3 py-2"}>
              {m.role === "assistant"
                ? <div className="prose prose-sm max-w-none dark:prose-invert prose-h2:mb-1 prose-h2:mt-3 prose-h2:text-sm prose-p:my-1 prose-ul:my-1"><ReactMarkdown>{m.content}</ReactMarkdown></div>
                : m.content}
            </div>
          ))}
          {carregando && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> {msgs.length ? "Pensando…" : "Lendo o indicador e o cálculo no ERP…"}
            </p>
          )}
          {erro && <p className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">{erro}</p>}
          <div ref={fim} />
        </div>

        {msgs.length <= 1 && !carregando && (
          <div className="flex flex-wrap gap-1.5">
            {sugestoes.map((s) => (
              <button key={s} type="button" onClick={() => enviar(s)} className="rounded-full border px-3 py-1 text-xs hover:bg-muted">{s}</button>
            ))}
          </div>
        )}

        <div className="flex items-end gap-2">
          <Textarea rows={2} value={texto} placeholder="Pergunte sobre este indicador…" className="min-h-[44px] flex-1 resize-none"
            onChange={(e) => setTexto(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); enviar(); } }} />
          <Button onClick={() => enviar()} disabled={carregando || !texto.trim()}><Send className="h-4 w-4" /></Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
