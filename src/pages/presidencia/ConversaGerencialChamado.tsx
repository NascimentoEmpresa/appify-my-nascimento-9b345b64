// =====================================================================
// ACOMPANHAMENTO DE CHAMADOS › conversa do chamado, SÓ LEITURA
// (SIS-2026-0923, mig 20261116230000)
//
// A gestão lê a mesma conversa que o solicitante lê — sem as observações
// internas da equipe — pelas RPCs chamado_gerencial_conversa/_anexos, e não
// escreve nela (decisão registrada na migration: mensagem da Presidência no
// meio do chat do solicitante confundiria quem está sendo atendido). Para
// falar com Sistemas existe o pedido "Solicitar informações / atualização".
// Os avisos do sistema usam a MESMA tradução do chat (lib/chamados/avisoChat).
// =====================================================================
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Lock, Paperclip, Send } from "lucide-react";
import { descreverAviso } from "@/lib/chamados/avisoChat";
import { rotuloMensagemApagada } from "@/lib/chamados/mensagemEditavel";
import {
  PrioridadeBadge, StatusBadge, fmtData, fmtDataHora, moduloLabel, type Evento,
} from "@/pages/chamados/types";
import { rpcGerencial } from "@/pages/chamados/acoesGestaoApi";
import type { ChamadoGerencial } from "@/lib/chamados/painelGerencial";
import { useIndiceDasTelas } from "@/pages/chamados/impacto/catalogoTelas";

interface EventoGerencial extends Evento { autor_nome: string | null }
interface AnexoGerencial { id: string; evento_id: string | null; nome_arquivo: string; created_at: string }

export function ConversaGerencialChamado({
  chamado, onClose, podePedir, onSolicitarAcao,
}: {
  chamado: ChamadoGerencial | null;
  onClose: () => void;
  podePedir: boolean;
  onSolicitarAcao: (c: ChamadoGerencial) => void;
}) {
  // SIS-2026-0921: re-renderiza quando a barra lateral muda os rótulos "Setor › Tela" (moduloLabel).
  const indiceTelas = useIndiceDasTelas();
  const id = chamado?.id ?? "";
  const { data: eventos = [], isLoading, error } = useQuery({
    queryKey: ["chamado-gerencial-conversa", id],
    enabled: !!chamado,
    queryFn: async () => {
      const { data, error } = await rpcGerencial<EventoGerencial[]>("chamado_gerencial_conversa", { p_chamado_id: id });
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });
  const { data: anexos = [] } = useQuery({
    queryKey: ["chamado-gerencial-anexos", id],
    enabled: !!chamado,
    queryFn: async () => {
      const { data, error } = await rpcGerencial<AnexoGerencial[]>("chamado_gerencial_anexos", { p_chamado_id: id });
      if (error) return [];
      return data ?? [];
    },
  });

  const nomes = useMemo(() => {
    const m: Record<string, string> = {};
    eventos.forEach((e) => { if (e.autor_id && e.autor_nome) m[e.autor_id] = e.autor_nome; });
    if (chamado?.responsavel_id && chamado.responsavel_nome) m[chamado.responsavel_id] = chamado.responsavel_nome;
    if (chamado?.solicitante_id && chamado.solicitante_nome) m[chamado.solicitante_id] = chamado.solicitante_nome;
    return m;
  }, [eventos, chamado]);
  const nomeDe = (uid: string | null) => (uid ? nomes[uid] ?? "Alguém" : "Sistema");

  const anexosPorEvento = useMemo(() => {
    const m: Record<string, AnexoGerencial[]> = {};
    anexos.forEach((a) => { const k = a.evento_id ?? "abertura"; (m[k] ??= []).push(a); });
    return m;
  }, [anexos]);

  return (
    <Sheet open={!!chamado} onOpenChange={(v) => { if (!v) onClose(); }}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-xl">
        {chamado && (
          <>
            <SheetHeader className="space-y-2 border-b border-border p-4 text-left">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-xs font-semibold">#{chamado.numero}</span>
                <StatusBadge status={chamado.status} />
                <PrioridadeBadge prioridade={chamado.prioridade} />
              </div>
              <SheetTitle className="text-base [overflow-wrap:anywhere]">{chamado.assunto}</SheetTitle>
              <SheetDescription className="text-xs">
                Solicitante: <b>{chamado.solicitante_nome ?? "—"}</b>{chamado.setor ? ` (${chamado.setor})` : ""}
                {" · "}Responsável: <b>{chamado.responsavel_nome ?? "sem responsável"}</b>
                {chamado.posicao_dev ? ` · ${chamado.posicao_dev}º na fila` : ""}
                {" · "}{moduloLabel(chamado)} · aberto em {fmtData(chamado.created_at)}
              </SheetDescription>
              {chamado.descricao && (
                <details className="rounded-md bg-muted/40 px-2.5 py-1.5 text-xs">
                  <summary className="cursor-pointer font-semibold">Descrição do chamado</summary>
                  <p className="mt-1 whitespace-pre-wrap [overflow-wrap:anywhere]">{chamado.descricao}</p>
                </details>
              )}
              {(anexosPorEvento.abertura ?? []).length > 0 && (
                <ListaAnexos anexos={anexosPorEvento.abertura} />
              )}
            </SheetHeader>

            <div className="flex-1 space-y-2 overflow-y-auto bg-muted/20 p-4">
              {isLoading ? (
                <p className="py-8 text-center text-sm text-muted-foreground">Carregando a conversa…</p>
              ) : error ? (
                <p className="py-8 text-center text-sm text-destructive">Não foi possível carregar: {(error as Error).message}</p>
              ) : eventos.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">Ainda não há mensagens neste chamado.</p>
              ) : eventos.map((e) => {
                const aviso = descreverAviso(e, nomeDe);
                if (aviso) {
                  return (
                    <p key={e.id} className="mx-auto max-w-[90%] rounded-md bg-muted px-2.5 py-1 text-center text-[11px] text-muted-foreground [overflow-wrap:anywhere]">
                      {aviso.texto} · {fmtDataHora(e.created_at)}
                    </p>
                  );
                }
                const doSolicitante = e.autor_id === chamado.solicitante_id;
                return (
                  <div key={e.id} className={`flex ${doSolicitante ? "justify-start" : "justify-end"}`}>
                    <div className={`max-w-[85%] rounded-lg border px-3 py-2 text-sm ${doSolicitante ? "border-border bg-card" : "border-primary/20 bg-primary/5"}`}>
                      <p className="text-[11px] font-semibold text-muted-foreground">{nomeDe(e.autor_id)}</p>
                      {e.apagado_em ? (
                        <p className="italic text-muted-foreground">{rotuloMensagemApagada(nomeDe(e.apagado_por ?? e.autor_id), e.apagado_em)}</p>
                      ) : (
                        <p className="whitespace-pre-wrap [overflow-wrap:anywhere]">{e.texto}</p>
                      )}
                      {(anexosPorEvento[e.id] ?? []).length > 0 && <ListaAnexos anexos={anexosPorEvento[e.id]} />}
                      <p className="mt-0.5 text-right text-[10px] text-muted-foreground">
                        {fmtDataHora(e.created_at)}{e.editado_em && !e.apagado_em ? " · editada" : ""}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border p-3">
              <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <Lock className="h-3.5 w-3.5" /> Só leitura — observações internas da equipe não aparecem aqui.
              </p>
              {podePedir && (
                <Button size="sm" className="gap-1.5" onClick={() => onSolicitarAcao(chamado)}>
                  <Send className="h-3.5 w-3.5" /> Solicitar ação
                </Button>
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function ListaAnexos({ anexos }: { anexos: AnexoGerencial[] }) {
  return (
    <div className="mt-1 flex flex-wrap gap-1" title="O arquivo abre na tela do chamado, para quem participa dele.">
      {anexos.map((a) => (
        <span key={a.id} className="inline-flex max-w-full items-center gap-1 rounded border border-border bg-background px-1.5 py-0.5 text-[10px]">
          <Paperclip className="h-3 w-3 shrink-0" /> <span className="truncate">{a.nome_arquivo}</span>
        </span>
      ))}
    </div>
  );
}
