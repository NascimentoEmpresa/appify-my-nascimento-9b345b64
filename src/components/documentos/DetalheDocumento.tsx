import { useRef, useState, type ReactNode } from "react";
import {
  AlertTriangle, Ban, CheckCircle2, FileText, Forward, Loader2, MessageSquare, Paperclip, Send, Trash2, Undo2, Upload,
} from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { cn } from "@/lib/utils";
import {
  useAcaoRhDocumento, useAnexarDocumento, useConcluirDocumento, useDetalheDocumento, useMensagemDocumento, useOpcoesDocumento,
  useRemoverAnexoDocumento, urlDocumento,
} from "@/hooks/useDocumentosSolicitados";
import {
  ACAO_EVENTO, STATUS_DOCUMENTO, atrasada, fmtTamanho, nomeLegivel, pendenciasEnvio, rotuloSituacao, textoPrazo,
  type AnexoDocumento, type SolicitacaoDocumento,
} from "@/lib/rh/documentosSolicitados";

// =====================================================================
// Detalhe de uma solicitação de documento (mig 20261019000040) — a mesma
// janela no RH e nos Encarregados; `lado` decide o que cada um pode fazer.
//   destinatário: baixa o original, anexa o assinado, envia com observação.
//   RH: anexa originais (pendente), devolve (concluída), reencaminha ou
//       cancela (pendente).
// Os dois lados trocam mensagens no histórico.
// =====================================================================

const hojeIso = () => new Date().toLocaleDateString("sv-SE");
const fmtData = (s: string | null) => (s ? new Date(`${s.slice(0, 10)}T12:00:00`).toLocaleDateString("pt-BR") : "—");
const fmtDataHora = (s: string | null) => (s ? new Date(s).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "—");

interface Props {
  solicitacao: SolicitacaoDocumento | null;
  lado: "rh" | "destinatario";
  /** RH: pode anexar originais (incluir/alterar). */
  podeAnexarRh?: boolean;
  /** RH: devolver, reencaminhar, cancelar. */
  podeAlterarRh?: boolean;
  onFechar: () => void;
}

export function DetalheDocumento({ solicitacao: s, lado, podeAnexarRh, podeAlterarRh, onFechar }: Props) {
  const detalhe = useDetalheDocumento(s?.id ?? null);
  const anexar = useAnexarDocumento();
  const remover = useRemoverAnexoDocumento();
  const mensagem = useMensagemDocumento();
  const concluir = useConcluirDocumento();
  const acaoRh = useAcaoRhDocumento();
  const inputArquivo = useRef<HTMLInputElement>(null);
  const [texto, setTexto] = useState("");
  const [observacao, setObservacao] = useState("");
  const [acao, setAcao] = useState<null | "devolver" | "cancelar" | "reencaminhar">(null);
  const [motivo, setMotivo] = useState("");
  const [novoDestino, setNovoDestino] = useState("");
  const opcoes = useOpcoesDocumento(lado === "rh" && acao === "reencaminhar");

  if (!s) return null;
  const hoje = hojeIso();
  const anexos = detalhe.data?.anexos ?? [];
  const eventos = detalhe.data?.eventos ?? [];
  const originais = anexos.filter((a) => a.origem === "rh");
  const assinados = anexos.filter((a) => a.origem === "destinatario");
  const pendente = s.status === "pendente";
  const souDestinatario = lado === "destinatario";
  const podeAnexar = pendente && (souDestinatario || podeAnexarRh);
  const faltas = pendenciasEnvio(s, anexos);
  const prazoTxt = textoPrazo(s, hoje);

  const subir = async (files: FileList | null) => {
    const arquivos = Array.from(files ?? []);
    if (!arquivos.length) return;
    try {
      await anexar.mutateAsync({ solicitacaoId: s.id, arquivos });
      toast.success(arquivos.length === 1 ? "Arquivo anexado." : `${arquivos.length} arquivos anexados.`);
    } catch (e) { toast.error((e as Error).message); }
    if (inputArquivo.current) inputArquivo.current.value = "";
  };

  const enviarMensagem = async () => {
    try { await mensagem.mutateAsync({ id: s.id, texto }); setTexto(""); } catch (e) { toast.error((e as Error).message); }
  };

  const enviarDocumento = async () => {
    try {
      await concluir.mutateAsync({ id: s.id, observacao });
      toast.success("Documento enviado ao RH. Solicitação concluída.");
      setObservacao("");
      onFechar();
    } catch (e) { toast.error((e as Error).message); }
  };

  const confirmarAcao = async () => {
    if (!acao) return;
    try {
      await acaoRh.mutateAsync({ id: s.id, acao, motivo, destinatario: novoDestino || undefined });
      toast.success(acao === "devolver" ? "Devolvida — voltou a pendente." : acao === "cancelar" ? "Solicitação cancelada." : "Solicitação reencaminhada.");
      setAcao(null); setMotivo(""); setNovoDestino("");
    } catch (e) { toast.error((e as Error).message); }
  };

  // Reencaminhar: com contrato, só os responsáveis dele; sem contrato, qualquer usuário.
  const destinos = (() => {
    const o = opcoes.data;
    if (!o) return [];
    if (s.contrato_empresa != null) {
      const c = o.contratos.find((x) => x.empresa === s.contrato_empresa && x.filial === s.contrato_filial);
      return (c?.responsaveis ?? []).filter((r) => r.auth_user_id && r.auth_user_id !== s.destinatario_id)
        .map((r) => ({ value: r.auth_user_id as string, label: nomeLegivel(r.nome) || "—", hint: r.tem_acesso ? r.posto ?? undefined : "sem acesso à tela Documentos" }));
    }
    return o.usuarios.filter((u) => u.id !== s.destinatario_id)
      .map((u) => ({ value: u.id, label: nomeLegivel(u.nome) || u.email || "—", hint: u.tem_acesso ? u.email ?? undefined : "sem acesso à tela Documentos" }));
  })();

  return (
    <Dialog open={!!s} onOpenChange={(v) => { if (!v) onFechar(); }}>
      <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2 pr-6">
            <span className="text-muted-foreground">#{s.id}</span> {s.titulo}
            <Badge variant="outline" className={cn("font-semibold", STATUS_DOCUMENTO[s.status].cor)}>{rotuloSituacao(s)}</Badge>
          </DialogTitle>
        </DialogHeader>

        <div className="grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2">
          <Info rotulo="Solicitado por" valor={`${nomeLegivel(s.solicitante_nome) || "—"} · ${fmtDataHora(s.created_at)}`} />
          <Info rotulo="Para" valor={nomeLegivel(s.destinatario_nome) || "—"} />
          <Info rotulo="Contrato" valor={s.contrato_nome ?? "— (enviado direto ao usuário)"} />
          <Info rotulo="Prazo" valor={
            <span className={cn(atrasada(s, hoje) && "font-semibold text-red-600")}>
              {fmtData(s.prazo)}{prazoTxt ? ` · ${prazoTxt}` : ""}
            </span>} />
          {s.status === "concluida" && <Info rotulo="Enviado" valor={`${nomeLegivel(s.concluida_por) || "—"} · ${fmtDataHora(s.concluida_em)}`} />}
          {s.status === "cancelada" && <Info rotulo="Cancelada" valor={`${nomeLegivel(s.cancelada_por) || "—"} · ${s.cancelamento_motivo ?? ""}`} />}
        </div>

        {s.descricao && (
          <div className="whitespace-pre-wrap rounded-md border bg-muted/40 px-3 py-2 text-sm">{s.descricao}</div>
        )}
        {s.observacao_envio && (
          <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
            <span className="font-semibold">Observação do envio:</span> {s.observacao_envio}
          </div>
        )}

        {/* ── Arquivos ── */}
        <div className="grid gap-3 sm:grid-cols-2">
          <ListaAnexos titulo="Documento do RH" vazio="O RH não anexou arquivo — veja a descrição." anexos={originais}
            podeRemover={(a) => podeAnexar && !souDestinatario} onRemover={(id) => remover.mutate(id, { onError: (e) => toast.error(e.message) })} />
          <ListaAnexos titulo="Documento assinado" vazio={pendente ? "Ainda não anexado." : "Nenhum."} anexos={assinados} destaque
            podeRemover={() => podeAnexar && souDestinatario} onRemover={(id) => remover.mutate(id, { onError: (e) => toast.error(e.message) })} />
        </div>

        {podeAnexar && (
          <div>
            <input ref={inputArquivo} type="file" multiple className="hidden" onChange={(e) => subir(e.target.files)} />
            <Button variant="outline" size="sm" disabled={anexar.isPending} onClick={() => inputArquivo.current?.click()}>
              {anexar.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Upload className="mr-1.5 h-4 w-4" />}
              {souDestinatario ? "Anexar documento assinado" : "Anexar documento a assinar"}
            </Button>
            <span className="ml-2 text-xs text-muted-foreground">PDF ou foto, até 20 MB cada.</span>
          </div>
        )}

        {/* ── Envio do destinatário ── */}
        {souDestinatario && pendente && (
          <div className="space-y-2 rounded-lg border border-primary/30 bg-primary/5 p-3">
            <p className="text-sm font-semibold">Enviar ao RH</p>
            <Textarea rows={2} placeholder="Observação do envio (opcional) — ex.: faltou a assinatura de um colaborador, segue amanhã."
              value={observacao} onChange={(e) => setObservacao(e.target.value)} />
            {faltas.length > 0 && (
              <p className="flex items-center gap-1.5 text-xs text-amber-700"><AlertTriangle className="h-3.5 w-3.5" /> {faltas.join(" ")}</p>
            )}
            <div className="flex justify-end">
              <Button size="sm" disabled={faltas.length > 0 || concluir.isPending} onClick={enviarDocumento}>
                {concluir.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Send className="mr-1.5 h-4 w-4" />}
                Enviar documento e concluir
              </Button>
            </div>
          </div>
        )}

        {/* ── Ações do RH ── */}
        {lado === "rh" && podeAlterarRh && s.status !== "cancelada" && (
          <div className="space-y-2">
            {!acao && (
              <div className="flex flex-wrap gap-2">
                {s.status === "concluida" && (
                  <Button variant="outline" size="sm" onClick={() => setAcao("devolver")}><Undo2 className="mr-1.5 h-4 w-4" /> Devolver ao destinatário</Button>
                )}
                {pendente && (
                  <>
                    <Button variant="outline" size="sm" onClick={() => setAcao("reencaminhar")}><Forward className="mr-1.5 h-4 w-4" /> Reencaminhar</Button>
                    <Button variant="outline" size="sm" className="text-red-600 hover:text-red-700" onClick={() => setAcao("cancelar")}>
                      <Ban className="mr-1.5 h-4 w-4" /> Cancelar solicitação
                    </Button>
                  </>
                )}
              </div>
            )}
            {acao && (
              <div className="space-y-2 rounded-lg border p-3">
                <p className="text-sm font-semibold">
                  {acao === "devolver" ? "Devolver (volta a pendente para o destinatário corrigir)" : acao === "cancelar" ? "Cancelar a solicitação" : "Reencaminhar para outra pessoa"}
                </p>
                {acao === "reencaminhar" && (
                  opcoes.isLoading ? <p className="text-xs text-muted-foreground">Carregando…</p> : (
                    <SearchableSelect value={novoDestino} onChange={setNovoDestino} options={destinos}
                      placeholder={s.contrato_empresa != null ? "Outro responsável do contrato" : "Outro usuário"}
                      emptyLabel={s.contrato_empresa != null ? "O contrato não tem outro responsável com login na Hierarquia." : "Nenhum usuário."} />
                  )
                )}
                <Textarea rows={2} placeholder={acao === "reencaminhar" ? "Motivo (opcional)" : "Motivo (obrigatório)"} value={motivo} onChange={(e) => setMotivo(e.target.value)} />
                <div className="flex justify-end gap-2">
                  <Button variant="ghost" size="sm" onClick={() => { setAcao(null); setMotivo(""); setNovoDestino(""); }}>Voltar</Button>
                  <Button size="sm" variant={acao === "cancelar" ? "destructive" : "default"} onClick={confirmarAcao}
                    disabled={acaoRh.isPending || (acao !== "reencaminhar" && !motivo.trim()) || (acao === "reencaminhar" && !novoDestino)}>
                    {acaoRh.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />} Confirmar
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Histórico e mensagens ── */}
        <div className="space-y-2">
          <p className="flex items-center gap-1.5 text-sm font-semibold"><MessageSquare className="h-4 w-4" /> Histórico e mensagens</p>
          {detalhe.isLoading ? <p className="text-xs text-muted-foreground">Carregando…</p> : (
            <ol className="space-y-1.5">
              {eventos.map((e) => (
                <li key={e.id} className={cn("rounded-md border px-3 py-1.5 text-sm",
                  e.acao === "mensagem" ? (e.lado === "rh" ? "bg-sky-50 border-sky-100" : "bg-amber-50 border-amber-100") : "bg-muted/30")}>
                  <div className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                    <span className="font-semibold text-foreground">{nomeLegivel(e.autor_nome) || "—"}</span>
                    <span>{e.lado === "rh" ? "RH" : "destinatário"}</span>
                    <span>· {ACAO_EVENTO[e.acao] ?? e.acao}</span>
                    <span className="ml-auto">{fmtDataHora(e.created_at)}</span>
                  </div>
                  {e.texto && <p className="whitespace-pre-wrap">{e.texto}</p>}
                </li>
              ))}
            </ol>
          )}
          {s.status !== "cancelada" && (
            <div className="flex gap-2">
              <Textarea rows={1} className="min-h-9" placeholder="Escrever mensagem…" value={texto} onChange={(e) => setTexto(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && texto.trim()) { e.preventDefault(); enviarMensagem(); } }} />
              <Button size="sm" variant="secondary" disabled={!texto.trim() || mensagem.isPending} onClick={enviarMensagem}>
                {mensagem.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Info({ rotulo, valor }: { rotulo: string; valor: ReactNode }) {
  return (
    <div className="flex gap-2">
      <span className="w-28 shrink-0 text-muted-foreground">{rotulo}</span>
      <span className="min-w-0">{valor}</span>
    </div>
  );
}

function ListaAnexos({ titulo, vazio, anexos, destaque, podeRemover, onRemover }: {
  titulo: string; vazio: string; anexos: AnexoDocumento[]; destaque?: boolean;
  podeRemover: (a: AnexoDocumento) => boolean | undefined; onRemover: (id: number) => void;
}) {
  return (
    <div className={cn("rounded-lg border p-3", destaque && anexos.length > 0 && "border-emerald-200 bg-emerald-50/50")}>
      <p className="mb-1.5 flex items-center gap-1.5 text-sm font-semibold">
        {destaque ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <FileText className="h-4 w-4" />} {titulo}
      </p>
      {anexos.length === 0 ? <p className="text-xs text-muted-foreground">{vazio}</p> : (
        <ul className="space-y-1">
          {anexos.map((a) => (
            <li key={a.id} className="flex items-center gap-2 text-sm">
              <Paperclip className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <button className="min-w-0 truncate text-left text-primary underline-offset-2 hover:underline" title={a.nome_arquivo ?? a.storage_path}
                onClick={async () => { const u = await urlDocumento(a.storage_path); if (u) window.open(u, "_blank"); else toast.error("Não foi possível abrir o arquivo."); }}>
                {a.nome_arquivo ?? a.storage_path}
              </button>
              <span className="shrink-0 text-xs text-muted-foreground">{fmtTamanho(a.tamanho_bytes)}</span>
              {podeRemover(a) && (
                <button className="ml-auto shrink-0 text-muted-foreground hover:text-red-600" title="Remover" onClick={() => onRemover(a.id)}>
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

