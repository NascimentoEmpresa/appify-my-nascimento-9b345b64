import { useState } from "react";
import { PDFDocument } from "pdf-lib";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription,
  AlertDialogFooter, AlertDialogCancel, AlertDialogAction,
} from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Paperclip, Trash2, Plus, FileDown, CheckCircle2, RotateCcw,
  FileText, CalendarClock, CalendarCheck2, History,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { AcessoGate } from "@/components/auth/AcessoGate";
import { useScreenAccess } from "@/hooks/useScreenAccess";
import {
  AnexoSolicitacaoAjuste,
  BUCKET_SOLICITACAO_AJUSTE_ANEXOS,
  ItemSolicitacaoAjuste,
  SETOR_BADGE_CLASSE,
  SETORES_SOLICITACAO_AJUSTE,
  SolicitacaoAjuste,
  STATUS_BADGE_CLASSE_SOLICITACAO_AJUSTE,
  STATUS_LABEL_SOLICITACAO_AJUSTE,
  StatusSolicitacaoAjuste,
  TRANSICOES_STATUS_SOLICITACAO_AJUSTE,
  useAdicionarItemSolicitacaoAjuste,
  useAnexarItemSolicitacaoAjuste,
  useAnexosItemSolicitacaoAjuste,
  useExcluirAnexoSolicitacaoAjuste,
  useExcluirItemSolicitacaoAjuste,
  useExcluirSolicitacaoAjuste,
  useItensSolicitacaoAjuste,
  useMudarStatusSolicitacaoAjuste,
  useRegistrarDespachoSolicitacaoAjuste,
  useResponderItemSolicitacaoAjuste,
  useTiposSolicitacaoAjuste,
} from "@/hooks/useSolicitacaoAjuste";
import { HistoricoCompetenciaModal } from "./HistoricoCompetenciaModal";
import { ComboSugestao } from "./ComboSugestao";

const MENU_CODIGO = "financeiro-solicitacoes-ajuste";

// SIS-2026-0305: sem automação Windows/COM disponível no web (mesma decisão
// já tomada no Checklist de Faturamento pro envio por Outlook) — a
// "unificação de PDF" do legado (pypdf, main.py:3384-3543) é substituída por
// merge client-side com pdf-lib: baixa os anexos via signed URL, concatena
// e dispara download do Blob resultante. Não persiste o PDF gerado.
async function unificarPdfs(paths: string[], nomeSaida: string) {
  const saida = await PDFDocument.create();
  for (const path of paths) {
    const { data, error } = await supabase.storage.from(BUCKET_SOLICITACAO_AJUSTE_ANEXOS).download(path);
    if (error || !data) continue;
    const bytes = await data.arrayBuffer();
    try {
      const doc = await PDFDocument.load(bytes);
      const paginas = await saida.copyPages(doc, doc.getPageIndices());
      paginas.forEach((p) => saida.addPage(p));
    } catch {
      // Não é PDF válido (ex. imagem anexada) — ignora, segue os demais.
    }
  }
  const bytesSaida = await saida.save();
  const blob = new Blob([bytesSaida], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nomeSaida;
  a.click();
  URL.revokeObjectURL(url);
}

function LinhaItem({ item, podeEditar, podeExcluir }: { item: ItemSolicitacaoAjuste; podeEditar: boolean; podeExcluir: boolean }) {
  const { data: anexos = [] } = useAnexosItemSolicitacaoAjuste(item.id);
  const responder = useResponderItemSolicitacaoAjuste();
  const anexar = useAnexarItemSolicitacaoAjuste();
  const excluirAnexo = useExcluirAnexoSolicitacaoAjuste();
  const excluirItem = useExcluirItemSolicitacaoAjuste();

  async function handleArquivo(file: File) {
    try {
      await anexar.mutateAsync({ itemId: item.id, arquivo: file });
      toast.success("Anexo enviado.");
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao enviar anexo.");
    }
  }

  async function abrirAnexo(anexo: AnexoSolicitacaoAjuste) {
    const { data, error } = await supabase.storage.from(BUCKET_SOLICITACAO_AJUSTE_ANEXOS).createSignedUrl(anexo.storage_path, 60);
    if (error || !data?.signedUrl) {
      toast.error("Erro ao abrir o arquivo.");
      return;
    }
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  }

  async function handleUnificarItem() {
    const pdfs = anexos.filter((a) => a.nome_original.toLowerCase().endsWith(".pdf"));
    if (pdfs.length < 2) {
      toast.error("Precisa de ao menos 2 anexos PDF pra unificar.");
      return;
    }
    await unificarPdfs(pdfs.map((a) => a.storage_path), `item${item.numero_item}_unificado.pdf`);
  }

  // Silencioso antes (achado do usuário testando: mudou o setor, não deu
  // erro nenhum, mas também não salvou — porque a coluna ainda não existia
  // no banco). Agora qualquer falha do UPDATE aparece como toast.
  function responderComToast(input: Parameters<typeof responder.mutate>[0]) {
    responder.mutate(input, { onError: (e: any) => toast.error(e.message ?? "Erro ao salvar.") });
  }

  return (
    <div className="rounded border p-3">
      <div className="flex items-center gap-2">
        <span className="w-12 shrink-0 text-center text-[11px] text-muted-foreground">Item {item.numero_item}</span>
        <Select
          value={item.setor}
          disabled={!podeEditar}
          onValueChange={(v) => responderComToast({ itemId: item.id, solicitacaoId: item.solicitacao_id, setor: v })}
        >
          <SelectTrigger className={cn("h-8 w-[110px] shrink-0 border text-xs", SETOR_BADGE_CLASSE[item.setor])}>
            <SelectValue placeholder="Setor" />
          </SelectTrigger>
          <SelectContent>
            {SETORES_SOLICITACAO_AJUSTE.map((s) => <SelectItem key={s} value={s} className="text-xs">{s}</SelectItem>)}
          </SelectContent>
        </Select>
        <Input
          value={item.descricao}
          disabled={!podeEditar}
          onChange={(e) => responderComToast({ itemId: item.id, solicitacaoId: item.solicitacao_id, descricao: e.target.value })}
          className="h-8 min-w-0 flex-1 text-sm"
        />
        <Input
          type="date"
          disabled={!podeEditar}
          value={item.data_resposta ?? ""}
          onChange={(e) => responderComToast({ itemId: item.id, solicitacaoId: item.solicitacao_id, dataResposta: e.target.value || null })}
          className={cn(
            "h-8 w-[148px] shrink-0 text-xs",
            item.data_resposta && "border-emerald-300 text-emerald-700 dark:border-emerald-900 dark:text-emerald-300",
          )}
        />
        {podeExcluir && (
          <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => excluirItem.mutate({ itemId: item.id, solicitacaoId: item.solicitacao_id })}>
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {anexos.map((a) => (
          <Badge key={a.id} variant="outline" className="gap-1 pr-1 text-xs">
            <button type="button" onClick={() => abrirAnexo(a)} className="max-w-[160px] truncate hover:underline">
              {a.nome_original}
            </button>
            {podeExcluir && (
              <button type="button" onClick={() => excluirAnexo.mutate(a)} className="ml-0.5 text-muted-foreground hover:text-destructive">
                <Trash2 className="h-3 w-3" />
              </button>
            )}
          </Badge>
        ))}
        {podeEditar && (
          <label className="inline-flex cursor-pointer items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
            <Paperclip className="h-3.5 w-3.5" /> Anexar
            <input type="file" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleArquivo(f); e.target.value = ""; }} />
          </label>
        )}
        {anexos.length >= 2 && (
          <button type="button" onClick={handleUnificarItem} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
            <FileDown className="h-3.5 w-3.5" /> Unificar PDF
          </button>
        )}
      </div>
    </div>
  );
}

interface Props {
  solicitacao: SolicitacaoAjuste | null;
  onOpenChange: (open: boolean) => void;
}

export function DetalheSolicitacaoModal({ solicitacao, onOpenChange }: Props) {
  const [novoItem, setNovoItem] = useState("");
  const [novoItemSetor, setNovoItemSetor] = useState<string>("RH");
  const [confirmarExcluir, setConfirmarExcluir] = useState(false);
  const [historicoAberto, setHistoricoAberto] = useState(false);
  const { data: itens = [] } = useItensSolicitacaoAjuste(solicitacao?.id ?? null);
  const { data: tipos = [] } = useTiposSolicitacaoAjuste();
  const opcoesTipo = tipos.filter((t) => t.ativo).map((t) => t.nome);
  const adicionarItem = useAdicionarItemSolicitacaoAjuste();
  const mudarStatus = useMudarStatusSolicitacaoAjuste();
  const registrarDespacho = useRegistrarDespachoSolicitacaoAjuste();
  const excluirSolicitacao = useExcluirSolicitacaoAjuste();

  if (!solicitacao) return null;
  const transicoes = TRANSICOES_STATUS_SOLICITACAO_AJUSTE[solicitacao.status];
  const reabrirDeEnviado = solicitacao.status === "enviado";

  async function handleMudarStatus(novo: StatusSolicitacaoAjuste) {
    try {
      await mudarStatus.mutateAsync({ id: solicitacao!.id, status: novo });
      toast.success(`Status alterado para "${STATUS_LABEL_SOLICITACAO_AJUSTE[novo]}".`);
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao mudar status.");
    }
  }

  async function handleAdicionarItem() {
    if (!novoItem.trim()) return;
    await adicionarItem.mutateAsync({ solicitacaoId: solicitacao!.id, descricao: novoItem, setor: novoItemSetor });
    setNovoItem("");
  }

  async function handleUnificarTudo() {
    const { data } = await (supabase as any)
      .from("SOLICITACAO_AJUSTE_ANEXO")
      .select("storage_path, nome_original, item:item_id(numero_item)")
      .in("item_id", itens.map((i) => i.id));
    const pdfs = (data ?? [])
      .filter((a: any) => a.nome_original.toLowerCase().endsWith(".pdf"))
      .sort((a: any, b: any) => (a.item?.numero_item ?? 0) - (b.item?.numero_item ?? 0));
    if (pdfs.length < 1) {
      toast.error("Nenhum anexo PDF encontrado.");
      return;
    }
    await unificarPdfs(pdfs.map((a: any) => a.storage_path), `solicitacao_unificado.pdf`);
  }

  async function abrirDocPedido() {
    if (!solicitacao!.doc_pedido_path) return;
    const { data, error } = await supabase.storage.from(BUCKET_SOLICITACAO_AJUSTE_ANEXOS).createSignedUrl(solicitacao!.doc_pedido_path, 60);
    if (error || !data?.signedUrl) {
      toast.error("Erro ao abrir o documento.");
      return;
    }
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  }

  return (
    <>
      <Dialog open={!!solicitacao} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <div className="flex flex-wrap items-center gap-1.5">
              <DialogTitle className="mr-1">{solicitacao.contrato?.nome}</DialogTitle>
              <Badge variant="outline" className={cn("border", STATUS_BADGE_CLASSE_SOLICITACAO_AJUSTE[solicitacao.status])}>
                {STATUS_LABEL_SOLICITACAO_AJUSTE[solicitacao.status]}
              </Badge>
              {solicitacao.iteracao > 1 && <Badge variant="secondary">{solicitacao.iteracao}ª abertura</Badge>}
            </div>
          </DialogHeader>

          {/* Estilo denso do legado (achado nos prints do usuário testando):
              badges compactos coloridos em vez de blocos de texto largos. */}
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            {solicitacao.doc_pedido_path && (
              <button type="button" onClick={abrirDocPedido} className="inline-flex items-center gap-1 rounded border border-border bg-muted px-2 py-1 hover:bg-muted/70">
                <FileText className="h-3.5 w-3.5" /> {solicitacao.doc_pedido_nome}
              </button>
            )}
            <span className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-muted-foreground">
              comp. {solicitacao.competencia?.slice(0, 7)}
            </span>
            {solicitacao.quem_recebeu && (
              <span className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-muted-foreground">
                Receb. por {solicitacao.quem_recebeu}{solicitacao.data_recebimento ? ` em ${solicitacao.data_recebimento}` : ""}
              </span>
            )}
            {solicitacao.prazo_resposta && (
              <span className="inline-flex items-center gap-1 rounded border border-amber-300 bg-amber-50 px-2 py-1 text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
                <CalendarClock className="h-3.5 w-3.5" /> Prazo resposta {solicitacao.prazo_resposta}
              </span>
            )}
          </div>

          {solicitacao.status === "enviado" && (
            <div className="flex items-center gap-1.5 rounded border bg-muted/40 p-2 text-sm">
              <CalendarCheck2 className="h-4 w-4 text-muted-foreground" />
              Prazo de despacho: <strong>{solicitacao.prazo_despacho ?? "—"}</strong>
              {solicitacao.data_despacho ? (
                <span className="ml-2 text-emerald-600">Despacho registrado em {solicitacao.data_despacho}</span>
              ) : (
                <AcessoGate menu={MENU_CODIGO} acao="alterar">
                  <Button size="sm" variant="outline" className="ml-2 h-7" onClick={() => registrarDespacho.mutate(solicitacao.id)}>
                    Registrar despacho
                  </Button>
                </AcessoGate>
              )}
            </div>
          )}

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium">Itens ({itens.length})</p>
              <div className="flex gap-1">
                {solicitacao.iteracao > 1 && (
                  <Button variant="ghost" size="sm" className="h-7 gap-1.5 text-xs" onClick={() => setHistoricoAberto(true)}>
                    <History className="h-3.5 w-3.5" /> Histórico da competência
                  </Button>
                )}
                {itens.some((i) => i.data_resposta) && (
                  <Button variant="ghost" size="sm" className="h-7 gap-1.5 text-xs" onClick={handleUnificarTudo}>
                    <FileDown className="h-3.5 w-3.5" /> Unificar tudo
                  </Button>
                )}
              </div>
            </div>
            {itens.map((item) => <LinhaItemGate key={item.id} item={item} />)}
            <AcessoGate menu={MENU_CODIGO} acao="alterar">
              <div className="flex items-center gap-2">
                <Select value={novoItemSetor} onValueChange={setNovoItemSetor}>
                  <SelectTrigger className="h-8 w-[110px] shrink-0 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {SETORES_SOLICITACAO_AJUSTE.map((s) => <SelectItem key={s} value={s} className="text-xs">{s}</SelectItem>)}
                  </SelectContent>
                </Select>
                <div className="min-w-0 flex-1">
                  <ComboSugestao value={novoItem} onChange={setNovoItem} options={opcoesTipo} placeholder="Novo item..." className="h-8 text-sm" />
                </div>
                <Button size="sm" variant="outline" className="h-8 gap-1" onClick={handleAdicionarItem}>
                  <Plus className="h-3.5 w-3.5" /> Adicionar
                </Button>
              </div>
            </AcessoGate>
          </div>

          <DialogFooter className="flex-wrap items-center justify-between gap-2 sm:justify-between">
            <AcessoGate menu={MENU_CODIGO} acao="excluir">
              <Button variant="ghost" className="gap-1.5 text-destructive hover:text-destructive" onClick={() => setConfirmarExcluir(true)}>
                <Trash2 className="h-4 w-4" /> Excluir solicitação
              </Button>
            </AcessoGate>
            <div className="flex flex-wrap gap-2">
              {reabrirDeEnviado ? (
                <AcessoGate menu={MENU_CODIGO} acao="excluir">
                  <Button variant="outline" className="gap-1.5" onClick={() => handleMudarStatus("em_conferencia")}>
                    <RotateCcw className="h-4 w-4" /> Reabrir
                  </Button>
                </AcessoGate>
              ) : (
                <AcessoGate menu={MENU_CODIGO} acao="alterar">
                  {transicoes.map((t) => (
                    <Button
                      key={t} variant="outline"
                      className={cn("gap-1.5 border", STATUS_BADGE_CLASSE_SOLICITACAO_AJUSTE[t])}
                      onClick={() => handleMudarStatus(t)}
                    >
                      {t === "enviado" && <CheckCircle2 className="h-4 w-4" />}
                      {STATUS_LABEL_SOLICITACAO_AJUSTE[t]}
                    </Button>
                  ))}
                </AcessoGate>
              )}
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <HistoricoCompetenciaModal
        contratoId={historicoAberto ? solicitacao.contrato_id : null}
        competencia={historicoAberto ? solicitacao.competencia : null}
        contratoNome={solicitacao.contrato?.nome}
        onOpenChange={(open) => !open && setHistoricoAberto(false)}
      />

      <AlertDialog open={confirmarExcluir} onOpenChange={setConfirmarExcluir}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir solicitação?</AlertDialogTitle>
            <AlertDialogDescription>
              Remove a solicitação e todos os itens/anexos. Essa ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={async () => {
                await excluirSolicitacao.mutateAsync(solicitacao.id);
                setConfirmarExcluir(false);
                onOpenChange(false);
              }}
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function LinhaItemGate({ item }: { item: ItemSolicitacaoAjuste }) {
  const { data: podeEditar } = useScreenAccess(MENU_CODIGO, "alterar");
  const { data: podeExcluir } = useScreenAccess(MENU_CODIGO, "excluir");
  return <LinhaItem item={item} podeEditar={!!podeEditar} podeExcluir={!!podeExcluir} />;
}
