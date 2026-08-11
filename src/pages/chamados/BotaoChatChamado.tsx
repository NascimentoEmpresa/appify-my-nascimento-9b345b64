// =====================================================================
// CHAMADOS — botão "Chat" das listas + o modal que ele abre
//
// Nas listas ("Meus chamados", "Painel do Desenvolvedor") não dava pra saber
// que alguém tinha escrito sem abrir chamado por chamado. Aqui o botão mostra
// a bolinha vermelha com quantas mensagens estão esperando e abre, sem sair da
// lista, a conversa junto com o cabeçalho do chamado (status, prioridade,
// responsável, prazo) — que é o contexto necessário pra responder.
// =====================================================================
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { MessageSquare } from "lucide-react";
import { ChatChamado } from "./ChatChamado";
import { StatusBadge, PrioridadeBadge, fmtData, type Chamado } from "./types";

/** Mensagens esperando por mim, por chamado. Alimenta a bolinha vermelha. */
export function useChamadosNaoLidos() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["chamados-nao-lidos", user?.id],
    enabled: !!user?.id,
    refetchInterval: 30000,
    queryFn: async () => {
      const { data } = await (supabase as any).rpc("chamados_nao_lidos");
      const m: Record<string, number> = {};
      (data ?? []).forEach((r: { chamado_id: string; nao_lidos: number }) => {
        m[r.chamado_id] = r.nao_lidos;
      });
      return m;
    },
  });
}

export interface BotaoChatChamadoProps {
  chamado: Chamado;
  perfil: "equipe" | "solicitante";
  naoLidos?: number;
  /** Nome do responsável já resolvido pela lista (evita buscar de novo). */
  responsavelNome?: string;
  somenteLeitura?: boolean;
}

export function BotaoChatChamado({
  chamado, perfil, naoLidos = 0, responsavelNome, somenteLeitura = false,
}: BotaoChatChamadoProps) {
  const [aberto, setAberto] = useState(false);
  const qc = useQueryClient();
  const encerrado = chamado.status === "concluido" || chamado.status === "reprovado";

  return (
    <>
      <Button
        size="sm"
        variant={naoLidos > 0 ? "default" : "outline"}
        className="relative h-8 gap-1.5"
        onClick={() => setAberto(true)}
      >
        <MessageSquare className="h-3.5 w-3.5" /> Chat
        {naoLidos > 0 && (
          <span
            className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold text-destructive-foreground"
            aria-label={`${naoLidos} mensagem(ns) não lida(s)`}
          >
            {naoLidos > 9 ? "9+" : naoLidos}
          </span>
        )}
      </Button>

      <Dialog
        open={aberto}
        onOpenChange={(v) => {
          setAberto(v);
          // Fechou → a leitura já foi carimbada lá dentro; atualiza a bolinha.
          if (!v) qc.invalidateQueries({ queryKey: ["chamados-nao-lidos"] });
        }}
      >
        <DialogContent className="max-w-3xl gap-3">
          <DialogHeader className="space-y-2">
            <DialogTitle className="flex flex-wrap items-center gap-2">
              <span className="font-mono">#{chamado.numero}</span>
              <StatusBadge status={chamado.status} />
              <PrioridadeBadge prioridade={chamado.prioridade} />
            </DialogTitle>
            <p className="text-sm font-semibold">{chamado.assunto}</p>
            <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] text-muted-foreground">
              <span>Solicitante: <b className="text-foreground">{chamado.solicitante_nome || "—"}</b></span>
              <span>Responsável: <b className="text-foreground">{responsavelNome || "—"}</b></span>
              <span>Prazo: <b className="text-foreground">{fmtData(chamado.prazo_previsto)}</b></span>
            </div>
          </DialogHeader>

          {aberto && (
            <ChatChamado
              chamadoId={chamado.id}
              solicitanteId={chamado.solicitante_id}
              perfil={perfil}
              encerrado={encerrado}
              somenteLeitura={somenteLeitura}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
