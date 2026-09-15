import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Paperclip } from "lucide-react";
import { AcoesVinculadasPauta, SeloTransferencia } from "./PautaVinculos";
import {
  nomeUsuario, PAUTA_STATUS_COR, PAUTA_STATUS_LABEL,
  type ReuniaoDecisaoAcao, type ReuniaoPauta, type ReuniaoPautaAnexo, type ReuniaoResposta, type ReuniaoTransferenciaRef, type Usuario,
} from "../types";

function Secao({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section className="space-y-1.5">
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{titulo}</p>
      {children}
    </section>
  );
}

function TextoOuVazio({ valor, vazio }: { valor: string | null | undefined; vazio: string }) {
  return valor
    ? <p className="whitespace-pre-wrap break-words text-sm">{valor}</p>
    : <p className="text-sm text-muted-foreground">{vazio}</p>;
}

/**
 * Leitura ampliada de um item de pauta (SIS-2026-0373): na tabela a
 * descrição fica resumida em 2 linhas; aqui aparece inteira, junto com
 * resposta/decisão (editável durante a reunião), ações vinculadas e anexos.
 */
export function PautaDetalheDialog({
  item, indice, open, onOpenChange, resposta, anexos, itensDecisaoAcao, usuarios, reunioesTransferencia,
  podeResponder, onSalvarResposta, onDownloadAnexo,
}: {
  item: ReuniaoPauta | undefined;
  indice: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  resposta: ReuniaoResposta | undefined;
  anexos: ReuniaoPautaAnexo[];
  itensDecisaoAcao: ReuniaoDecisaoAcao[];
  usuarios: Usuario[];
  reunioesTransferencia: Record<string, ReuniaoTransferenciaRef>;
  podeResponder: boolean;
  onSalvarResposta: (pautaId: string, texto: string, encaminhamento: string) => Promise<boolean>;
  onDownloadAnexo: (path: string) => void;
}) {
  const [texto, setTexto] = useState("");
  const [obs, setObs] = useState("");
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTexto(resposta?.texto_resposta ?? "");
    setObs(resposta?.encaminhamento ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, item?.id]);

  if (!item) return null;

  const alterado = texto !== (resposta?.texto_resposta ?? "") || obs !== (resposta?.encaminhamento ?? "");

  const salvar = async () => {
    setSalvando(true);
    const ok = await onSalvarResposta(item.id, texto, obs);
    setSalvando(false);
    if (ok) onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-2xl space-y-1 overflow-y-auto">
        <DialogHeader className="space-y-2">
          <DialogTitle className="pr-6 text-base leading-snug">{indice + 1}. {item.titulo_topico}</DialogTitle>
          <DialogDescription className="sr-only">Detalhe do item de pauta</DialogDescription>
          <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            <span className={`inline-flex rounded-full border px-2 py-0.5 ${PAUTA_STATUS_COR[item.status]}`}>{PAUTA_STATUS_LABEL[item.status]}</span>
            {item.fora_pauta && (
              <span className="inline-flex rounded-full border border-amber-200 bg-amber-100 px-2 py-0.5 text-[10px] text-amber-800">Fora da pauta</span>
            )}
            <SeloTransferencia item={item} reunioes={reunioesTransferencia} />
            <span>Responsável: {nomeUsuario(usuarios, item.responsavel_user_id) ?? "—"}</span>
            {item.prazo && <span>· Prazo: {new Date(`${item.prazo}T00:00:00`).toLocaleDateString("pt-BR")}</span>}
          </div>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          <Secao titulo="Descrição">
            <TextoOuVazio valor={item.descricao} vazio="Sem descrição." />
          </Secao>

          <div className="grid gap-4 sm:grid-cols-2">
            <Secao titulo="Resposta / Decisão">
              {podeResponder
                ? <Textarea value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Resposta / decisão" className="min-h-24 text-sm" />
                : <TextoOuVazio valor={resposta?.texto_resposta} vazio="—" />}
            </Secao>
            <Secao titulo="Observações">
              {podeResponder
                ? <Textarea value={obs} onChange={(e) => setObs(e.target.value)} placeholder="Observações" className="min-h-24 text-sm" />
                : <TextoOuVazio valor={resposta?.encaminhamento} vazio="—" />}
            </Secao>
          </div>
          {podeResponder && (
            <div className="flex justify-end">
              <Button size="sm" disabled={!alterado || salvando} onClick={salvar}>{salvando ? "Salvando…" : "Salvar resposta"}</Button>
            </div>
          )}

          <Secao titulo={`Ações e decisões (${itensDecisaoAcao.length})`}>
            {itensDecisaoAcao.length > 0
              ? <AcoesVinculadasPauta itens={itensDecisaoAcao} />
              : <p className="text-sm text-muted-foreground">Nenhuma ação ou decisão registrada para este item.</p>}
          </Secao>

          <Secao titulo={`Anexos (${anexos.length})`}>
            {anexos.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {anexos.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => onDownloadAnexo(a.storage_path)}
                    className="inline-flex max-w-full items-center gap-1 rounded border border-border px-2 py-1 text-xs text-primary hover:underline"
                  >
                    <Paperclip className="h-3 w-3 shrink-0" /><span className="truncate">{a.nome_arquivo}</span>
                  </button>
                ))}
              </div>
            ) : <p className="text-sm text-muted-foreground">Nenhum anexo.</p>}
          </Secao>
        </div>
      </DialogContent>
    </Dialog>
  );
}
