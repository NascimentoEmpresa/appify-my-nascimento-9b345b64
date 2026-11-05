import { useEffect, useRef, useState } from "react";
import { MessageSquare, MessageSquarePlus, Send } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";
import { useEnviarMensagemFaturamento, useMensagensFaturamento, type ResumoChatFaturamento } from "@/hooks/useFaturamentoJustificativa";
import { useUsuariosAtivos } from "@/hooks/useNfEmissao";

// SIS-2026-0808: chat de justificativa de um contrato não faturado na competência. Os setores responsáveis
// perguntam e respondem aqui, e a conversa fica guardada (ninguém edita nem apaga mensagem).

export interface AlvoJustificativaFaturamento {
  contratoId: string;
  contratoNome: string;
  empresaNome: string;
  competencia: string; // YYYY-MM-01
  competenciaLabel: string;
}

const NINGUEM = "__ninguem";
const quando = (iso: string) => new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });

// Célula da tabela: quantas mensagens e a última; sem conversa e sem permissão para escrever, não mostra nada.
export function CelulaJustificativa({ resumo, podeEscrever, onAbrir }: { resumo?: ResumoChatFaturamento; podeEscrever: boolean; onAbrir: () => void }) {
  if (!resumo && !podeEscrever) return <span className="text-muted-foreground">—</span>;
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="h-7 max-w-[280px] justify-start gap-1.5 px-2 text-left text-xs font-normal"
      title={resumo ? resumo.ultima.texto : "Abrir o chat deste contrato"}
      onClick={(e) => { e.stopPropagation(); onAbrir(); }}
    >
      {resumo ? <MessageSquare className="h-3.5 w-3.5 shrink-0 text-sky-600" /> : <MessageSquarePlus className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
      {resumo ? (
        <span className="truncate"><span className="font-semibold">{resumo.total}</span> · {resumo.ultima.texto}</span>
      ) : (
        <span>Perguntar / justificar</span>
      )}
    </Button>
  );
}

export function JustificativaFaturamentoDialog({ alvo, podeEscrever, onClose }: { alvo: AlvoJustificativaFaturamento | null; podeEscrever: boolean; onClose: () => void }) {
  const { user } = useAuth();
  const { data: usuarios = [] } = useUsuariosAtivos();
  const { data: mensagens = [], isLoading } = useMensagensFaturamento(alvo?.contratoId ?? null, alvo?.competencia ?? null);
  const enviar = useEnviarMensagemFaturamento();
  const [texto, setTexto] = useState("");
  const [destinatario, setDestinatario] = useState(NINGUEM);
  const fim = useRef<HTMLDivElement>(null);

  useEffect(() => { setTexto(""); setDestinatario(NINGUEM); }, [alvo?.contratoId, alvo?.competencia]);
  useEffect(() => { fim.current?.scrollIntoView({ block: "end" }); }, [mensagens.length, alvo]);

  const nomeUsuario = (id: string | null) => (id ? (usuarios.find((u) => u.id === id)?.display_name ?? (id === user?.id ? "Você" : "Usuário")) : "");

  async function enviarMensagem() {
    if (!alvo) return;
    if (texto.trim().length < 2) { toast.error("Escreva a mensagem."); return; }
    try {
      await enviar.mutateAsync({ contratoId: alvo.contratoId, competencia: alvo.competencia, texto: texto.trim(), destinatarioId: destinatario === NINGUEM ? null : destinatario });
      setTexto("");
      setDestinatario(NINGUEM);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível enviar a mensagem.");
    }
  }

  return (
    <Dialog open={!!alvo} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[85vh] max-w-xl flex-col">
        <DialogHeader>
          <DialogTitle>Justificativa — contrato não faturado</DialogTitle>
          <DialogDescription>
            {alvo?.contratoNome} · {alvo?.empresaNome} · {alvo?.competenciaLabel}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-[200px] flex-1 space-y-2 overflow-y-auto rounded-md border bg-muted/30 p-3">
          {isLoading && <p className="py-6 text-center text-xs text-muted-foreground">Carregando…</p>}
          {!isLoading && mensagens.length === 0 && (
            <p className="py-6 text-center text-xs text-muted-foreground">
              Ainda não há conversa sobre este contrato nesta competência.{podeEscrever ? " Pergunte aos responsáveis pelo faturamento abaixo." : ""}
            </p>
          )}
          {mensagens.map((m) => {
            const minha = m.autor_id === user?.id;
            return (
              <div key={m.id} className={cn("flex", minha ? "justify-end" : "justify-start")}>
                <div className={cn("max-w-[85%] rounded-lg px-3 py-2 text-sm", minha ? "bg-primary text-primary-foreground" : "bg-card border")}>
                  <p className={cn("mb-0.5 text-[11px] font-semibold", minha ? "text-primary-foreground/80" : "text-muted-foreground")}>
                    {minha ? "Você" : nomeUsuario(m.autor_id)} · {quando(m.created_at)}
                  </p>
                  {m.destinatario_id && (
                    <p className={cn("mb-0.5 text-[11px]", minha ? "text-primary-foreground/80" : "text-sky-700 dark:text-sky-400")}>para {m.destinatario_id === user?.id ? "você" : nomeUsuario(m.destinatario_id)}</p>
                  )}
                  <p className="whitespace-pre-wrap break-words">{m.texto}</p>
                </div>
              </div>
            );
          })}
          <div ref={fim} />
        </div>

        {podeEscrever ? (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-xs">
              <span className="text-muted-foreground">Perguntar a:</span>
              <Select value={destinatario} onValueChange={setDestinatario}>
                <SelectTrigger className="h-8 w-64 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NINGUEM}>Ninguém em especial (avisa quem já participa)</SelectItem>
                  {usuarios.filter((u) => u.id !== user?.id).map((u) => <SelectItem key={u.id} value={u.id}>{u.display_name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end gap-2">
              <Textarea
                value={texto}
                onChange={(e) => setTexto(e.target.value.slice(0, 2000))}
                onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void enviarMensagem(); } }}
                rows={2}
                placeholder="Escreva a pergunta ou a justificativa… (Ctrl+Enter envia)"
              />
              <Button onClick={enviarMensagem} disabled={enviar.isPending || texto.trim().length < 2} className="gap-1.5">
                <Send className="h-4 w-4" /> Enviar
              </Button>
            </div>
          </div>
        ) : (
          <p className="text-[11px] text-muted-foreground">Você pode ler esta conversa, mas não tem permissão para escrever nela.</p>
        )}
      </DialogContent>
    </Dialog>
  );
}
