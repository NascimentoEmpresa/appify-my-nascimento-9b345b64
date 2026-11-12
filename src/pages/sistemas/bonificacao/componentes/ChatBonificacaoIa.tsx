// Chat de I.A sobre o Comparativo individual (12/11/2026). Manda para a Edge
// bonificacao-ia o que a tela está mostrando (contextoComparativo) e o
// histórico da conversa. A conversa vive só nesta tela: trocar de mês ou de
// filtro recomeça, para a I.A não misturar números de contextos diferentes.
import { useEffect, useRef, useState } from "react";
import { Bot, Loader2, Send, Sparkles, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { usePerguntarBonificacaoIa } from "@/hooks/useBonificacaoColetiva";
import type { ResumoDev } from "@/lib/sistemas/bonificacaoColetiva";
import { contextoComparativo } from "@/lib/sistemas/bonificacaoDetalhe";
import { Titulo } from "./comum";

type Msg = { role: "user" | "assistant"; content: string; erro?: boolean };

const SUGESTOES = [
  "Explique de onde vem o valor de mercado de cada desenvolvedor.",
  "Quais chamados mais pesaram no valor de cada um?",
  "Por que a média por entrega é diferente entre eles?",
  "O valor de mercado muda o pagamento da bonificação?",
];

export function ChatBonificacaoIa({ devs, rotuloMes }: { devs: ResumoDev[]; rotuloMes: string }) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [texto, setTexto] = useState("");
  const perguntar = usePerguntarBonificacaoIa();
  const fim = useRef<HTMLDivElement>(null);
  const chave = `${rotuloMes}|${devs.map((d) => d.devId).join(",")}`;

  useEffect(() => { setMsgs([]); }, [chave]);
  useEffect(() => { fim.current?.scrollIntoView({ block: "nearest" }); }, [msgs, perguntar.isPending]);

  const enviar = (pergunta: string) => {
    const p = pergunta.trim();
    if (!p || perguntar.isPending) return;
    const historico = [...msgs.filter((m) => !m.erro), { role: "user" as const, content: p }];
    setMsgs((m) => [...m, { role: "user", content: p }]);
    setTexto("");
    perguntar.mutate(
      { mensagens: historico.map(({ role, content }) => ({ role, content })), contexto: contextoComparativo(devs, rotuloMes), rotuloMes },
      {
        onSuccess: (resposta) => setMsgs((m) => [...m, { role: "assistant", content: resposta }]),
        onError: (e) => setMsgs((m) => [...m, { role: "assistant", content: e instanceof Error ? e.message : "A IA não respondeu.", erro: true }]),
      },
    );
  };

  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-2">
        <Titulo ajuda="Pergunte sobre as notas, os valores e os chamados do comparativo acima. A I.A só enxerga o que esta tela mostra no mês e no filtro escolhidos.">
          <span className="inline-flex items-center gap-1.5"><Sparkles className="h-4 w-4 text-primary" /> Pergunte à I.A sobre o comparativo</span>
        </Titulo>
        {msgs.length > 0 && (
          <Button variant="ghost" size="sm" onClick={() => setMsgs([])} className="text-muted-foreground">
            <Trash2 className="mr-1.5 h-4 w-4" /> Limpar
          </Button>
        )}
      </div>

      {!devs.some((d) => d.entregas.length) ? (
        <p className="text-sm text-muted-foreground">Sem entregas em {rotuloMes} para analisar.</p>
      ) : (
        <>
          <div className="mb-3 max-h-[420px] space-y-3 overflow-y-auto">
            {msgs.length === 0 && (
              <div className="flex flex-wrap gap-2">
                {SUGESTOES.map((s) => (
                  <button key={s} type="button" onClick={() => enviar(s)}
                    className="rounded-full border bg-muted/40 px-3 py-1.5 text-left text-xs hover:bg-muted">
                    {s}
                  </button>
                ))}
              </div>
            )}
            {msgs.map((m, i) => (
              <div key={i} className={m.role === "user" ? "flex justify-end" : "flex gap-2"}>
                {m.role === "assistant" && <Bot className="mt-1 h-4 w-4 shrink-0 text-primary" />}
                <div className={
                  m.role === "user"
                    ? "max-w-[85%] whitespace-pre-wrap rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground"
                    : `max-w-[85%] whitespace-pre-wrap rounded-lg border px-3 py-2 text-sm ${m.erro ? "border-destructive/40 text-destructive" : "bg-muted/30"}`
                }>
                  {m.content}
                </div>
              </div>
            ))}
            {perguntar.isPending && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Analisando o comparativo…
              </div>
            )}
            <div ref={fim} />
          </div>
          <form className="flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); enviar(texto); }}>
            <Textarea
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); enviar(texto); } }}
              placeholder={`Ex.: por que o valor do João em ${rotuloMes} é esse?`}
              maxLength={2000}
              rows={2}
              className="min-h-[44px] resize-none"
            />
            <Button type="submit" disabled={!texto.trim() || perguntar.isPending} aria-label="Enviar pergunta">
              <Send className="h-4 w-4" />
            </Button>
          </form>
        </>
      )}
    </Card>
  );
}
