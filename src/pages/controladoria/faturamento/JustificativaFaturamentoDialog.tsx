import { useEffect, useRef, useState } from "react";
import { Download, ExternalLink, FileText, Loader2, MessageSquare, MessageSquarePlus, Paperclip, RefreshCw, Send, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";
import { obterAnexoJustificativa, useEnviarMensagemFaturamento, useMensagensFaturamento, type ResumoChatFaturamento } from "@/hooks/useFaturamentoJustificativa";
import { MAX_ANEXOS_POR_MENSAGEM, abreNaAba, juntarSelecao, podeEnviarMensagem, textoDaMensagem, type AnexoJustificativa } from "@/lib/controladoria/anexosJustificativa";
import { fmtTamanho } from "@/lib/solicitacoes/anexos";
import { useUsuariosAtivos } from "@/hooks/useNfEmissao";

// SIS-2026-0808: chat de justificativa de um contrato não faturado na competência. Os setores responsáveis
// perguntam e respondem aqui, e a conversa fica guardada (ninguém edita nem apaga mensagem).
// SIS-2026-0870: a mensagem pode levar documentos (comprovante, autorização de faturamento) — botão de clipe ao lado
// do campo; os arquivos ficam na própria mensagem, com quem enviou e quando, e abrem/baixam dali.

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
      title={resumo ? textoDaMensagem(resumo.ultima) : "Abrir o chat deste contrato"}
      onClick={(e) => { e.stopPropagation(); onAbrir(); }}
    >
      {resumo ? <MessageSquare className="h-3.5 w-3.5 shrink-0 text-sky-600" /> : <MessageSquarePlus className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
      {resumo ? (
        <span className="truncate"><span className="font-semibold">{resumo.total}</span> · {textoDaMensagem(resumo.ultima)}</span>
      ) : (
        <span>Perguntar / justificar</span>
      )}
    </Button>
  );
}

// Um anexo dentro do balão: nome, tamanho, "Abrir" (PDF/imagem/texto) e "Baixar".
function AnexoNaMensagem({ anexo, minha }: { anexo: AnexoJustificativa; minha: boolean }) {
  const [ocupado, setOcupado] = useState(false);

  async function usar(modo: "abrir" | "baixar") {
    // A aba é reservada AINDA no clique: depois do await o bloqueador de pop-up barraria (ver useAnexoChamado).
    const aba = modo === "abrir" ? window.open("", "_blank") : null;
    setOcupado(true);
    try {
      const blob = await obterAnexoJustificativa(anexo.path);
      const url = URL.createObjectURL(anexo.tipo && !blob.type ? new Blob([blob], { type: anexo.tipo }) : blob);
      if (aba) {
        aba.opener = null;
        aba.location.href = url;
      } else {
        const link = document.createElement("a");
        link.href = url;
        link.download = anexo.nome;
        document.body.appendChild(link);
        link.click();
        link.remove();
      }
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e) {
      aba?.close();
      toast.error(`Não foi possível ${modo === "abrir" ? "abrir" : "baixar"} "${anexo.nome}"`, { description: e instanceof Error ? e.message : undefined });
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className={cn("mt-1.5 flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs", minha ? "border-primary-foreground/30 bg-primary-foreground/10" : "bg-muted/50")}>
      {ocupado ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" /> : <FileText className="h-3.5 w-3.5 shrink-0" />}
      <span className="min-w-0 flex-1 truncate" title={anexo.nome}>{anexo.nome}</span>
      {anexo.tamanho ? <span className={cn("shrink-0", minha ? "text-primary-foreground/70" : "text-muted-foreground")}>{fmtTamanho(anexo.tamanho)}</span> : null}
      {abreNaAba(anexo) && (
        <Button type="button" variant="ghost" size="icon" className={cn("h-6 w-6 shrink-0", minha && "hover:bg-primary-foreground/20 text-primary-foreground")} title="Abrir" aria-label={`Abrir ${anexo.nome}`} disabled={ocupado} onClick={() => void usar("abrir")}>
          <ExternalLink className="h-3.5 w-3.5" />
        </Button>
      )}
      <Button type="button" variant="ghost" size="icon" className={cn("h-6 w-6 shrink-0", minha && "hover:bg-primary-foreground/20 text-primary-foreground")} title="Baixar" aria-label={`Baixar ${anexo.nome}`} disabled={ocupado} onClick={() => void usar("baixar")}>
        <Download className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

export function JustificativaFaturamentoDialog({ alvo, podeEscrever, onClose }: { alvo: AlvoJustificativaFaturamento | null; podeEscrever: boolean; onClose: () => void }) {
  const { user } = useAuth();
  const { data: usuarios = [] } = useUsuariosAtivos();
  const { data: mensagens = [], isLoading, refetch, isFetching } = useMensagensFaturamento(alvo?.contratoId ?? null, alvo?.competencia ?? null);
  const enviar = useEnviarMensagemFaturamento();
  const [texto, setTexto] = useState("");
  const [destinatario, setDestinatario] = useState(NINGUEM);
  const [arquivos, setArquivos] = useState<File[]>([]);
  const fim = useRef<HTMLDivElement>(null);
  const seletor = useRef<HTMLInputElement>(null);

  useEffect(() => { setTexto(""); setDestinatario(NINGUEM); setArquivos([]); }, [alvo?.contratoId, alvo?.competencia]);

  function adicionarArquivos(lista: FileList | null) {
    if (!lista?.length) return;
    const { arquivos: juntos, avisos } = juntarSelecao(arquivos, Array.from(lista));
    setArquivos(juntos);
    avisos.forEach((a) => toast.error(a));
    if (seletor.current) seletor.current.value = ""; // deixa escolher o mesmo arquivo de novo depois de tirar
  }
  const podeEnviar = podeEnviarMensagem(texto, arquivos.length);
  useEffect(() => { fim.current?.scrollIntoView({ block: "end" }); }, [mensagens.length, alvo]);

  const nomeUsuario = (id: string | null) => (id ? (usuarios.find((u) => u.id === id)?.display_name ?? (id === user?.id ? "Você" : "Usuário")) : "");

  async function enviarMensagem() {
    if (!alvo || enviar.isPending) return;
    if (!podeEnviarMensagem(texto, arquivos.length)) { toast.error("Escreva a mensagem ou anexe um documento."); return; }
    try {
      await enviar.mutateAsync({ contratoId: alvo.contratoId, competencia: alvo.competencia, texto: texto.trim(), destinatarioId: destinatario === NINGUEM ? null : destinatario, arquivos });
      setTexto("");
      setDestinatario(NINGUEM);
      setArquivos([]);
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
          <Button type="button" variant="outline" size="sm" className="h-7 w-fit gap-1.5 text-xs" onClick={() => void refetch()} disabled={isFetching}>
            <RefreshCw className={cn("h-3.5 w-3.5", isFetching && "animate-spin")} /> Atualizar conversa
          </Button>
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
                  {m.texto && <p className="whitespace-pre-wrap break-words">{m.texto}</p>}
                  {(m.anexos ?? []).map((a) => <AnexoNaMensagem key={a.path} anexo={a} minha={minha} />)}
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
            {arquivos.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {arquivos.map((f, i) => (
                  <span key={`${f.name}-${f.size}`} className="flex max-w-[260px] items-center gap-1 rounded-md border bg-muted/50 px-2 py-0.5 text-xs">
                    <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span className="truncate" title={f.name}>{f.name}</span>
                    <span className="shrink-0 text-muted-foreground">{fmtTamanho(f.size)}</span>
                    <button type="button" className="shrink-0 rounded p-0.5 hover:bg-muted" title="Tirar este arquivo" aria-label={`Tirar ${f.name}`} disabled={enviar.isPending} onClick={() => setArquivos((cur) => cur.filter((_, j) => j !== i))}>
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <div className="flex items-end gap-2">
              <input ref={seletor} type="file" multiple className="hidden" onChange={(e) => adicionarArquivos(e.target.files)} />
              <Textarea
                value={texto}
                onChange={(e) => setTexto(e.target.value.slice(0, 2000))}
                onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void enviarMensagem(); } }}
                rows={2}
                placeholder="Escreva a pergunta ou a justificativa… (Ctrl+Enter envia)"
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="shrink-0"
                title={`Anexar documentos (até ${MAX_ANEXOS_POR_MENSAGEM}, 25 MB cada)`}
                aria-label="Anexar documentos"
                disabled={enviar.isPending || arquivos.length >= MAX_ANEXOS_POR_MENSAGEM}
                onClick={() => seletor.current?.click()}
              >
                <Paperclip className="h-4 w-4" />
              </Button>
              <Button onClick={enviarMensagem} disabled={enviar.isPending || !podeEnviar} className="gap-1.5">
                {enviar.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} {enviar.isPending && arquivos.length ? "Enviando…" : "Enviar"}
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
