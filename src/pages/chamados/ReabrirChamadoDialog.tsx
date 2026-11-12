import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { CopyPlus, Lightbulb, RotateCcw } from "lucide-react";
import { STATUS_CHAMADO, statusAoReabrir, type Chamado } from "./types";
import { MOTIVOS_REABERTURA, rotaNovoChamado, type MotivoReabertura } from "@/lib/chamados/vinculos";

// =====================================================================
// REABRIR CHAMADO — desfaz a conclusão (ou a reprovação) e devolve o
// chamado à fila.
//
// POR QUE EXISTE: a conclusão automática dispara no merge da PR
// (edge function chamado-concluir-pr), mas há chamado que precisa de mais
// de uma PR. Sem reabrir, a segunda entrega ficaria sem chamado aberto
// para pendurar — e o solicitante veria "concluído" com trabalho em curso.
//
// O QUE O BANCO FAZ SOZINHO ao mudar o status (nada disso vai no update):
//   · `concluido_em` volta a NULL — trigger chamado_sistema_guard;
//   · `posicao_dev` é recalculado e o chamado entra no FIM da fila do
//     responsável — trigger chamado_sistema_fila_dev.
//
// `motivo_reprovacao` fica como estava, de propósito: é o registro de uma
// reprovação que de fato aconteceu. As telas só o exibem enquanto o status
// é 'reprovado', então ele some da vista ao reabrir sem sumir do histórico
// (o relatório em PDF continua mostrando, que é o comportamento desejado).
//
// MODO "solicitante" (28/09/2026, mig 255): quem ABRIU o chamado também
// reabre — é ele quem descobre que a entrega não resolveu.
//
// MOTIVO DA REABERTURA (12/11/2026, mig 20261112002000, pedido do Pablo):
// o solicitante escolhe por quê.
//   · "Não atendeu o solicitado" → RPC chamado_reabrir_nao_atendeu. Na mig
//     20261112002000 voltava direto para 'aberto' sem responsável; desde a
//     mig 20261112190000 (mesmo dia) só registra o PEDIDO — o Gestor de
//     Sistemas confirma (mesmo dev ou outro) ou nega com motivo, no card
//     CHAMADO REABERTO. O que não ficou certo é obrigatório.
//   · "Precisa de modificações" → NÃO reabre: "Pra melhorias, abra outro
//     chamado". O botão leva ao formulário de chamado novo já preenchido com
//     este (AbrirChamado ?baseado=), com o quadro "O que é preciso a mais", e
//     o novo fica vinculado como a parte seguinte (Parte 2, 3…).
// =====================================================================
export function ReabrirChamadoDialog({
  open,
  onOpenChange,
  chamado,
  onReaberto,
  modo = "equipe",
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  chamado: Pick<Chamado, "id" | "numero" | "status" | "responsavel_id"> | null;
  onReaberto?: () => void;
  modo?: "equipe" | "solicitante";
}) {
  const solicitante = modo === "solicitante";
  const qc = useQueryClient();
  const nav = useNavigate();
  const { pathname } = useLocation();
  const { toast } = useToast();
  const [motivo, setMotivo] = useState("");
  const [tipoMotivo, setTipoMotivo] = useState<MotivoReabertura | "">("");
  const [reabrindo, setReabrindo] = useState(false);
  // Para onde volta. O solicitante sempre manda para a triagem ('aberto',
  // sem responsável); a equipe segue statusAoReabrir.
  const statusDestino = !chamado ? "aberto"
    : solicitante ? "aberto"
    : statusAoReabrir(chamado);

  const fechar = (v: boolean) => {
    if (reabrindo) return;
    if (!v) { setMotivo(""); setTipoMotivo(""); }
    onOpenChange(v);
  };

  const abrirBaseadoNesse = () => {
    if (!chamado) return;
    setMotivo(""); setTipoMotivo("");
    onOpenChange(false);
    nav(rotaNovoChamado(pathname, chamado.id));
  };

  const reabrir = async () => {
    if (!chamado || reabrindo) return;
    if (solicitante && tipoMotivo !== "nao_atendeu") return;
    if (solicitante && motivo.trim().length < 5) {
      toast({ title: "Conte o que não ficou como você pediu", description: "O Gestor de Sistemas lê antes de mandar de novo para um desenvolvedor.", variant: "destructive" });
      return;
    }
    setReabrindo(true);

    let novo = statusDestino;
    if (solicitante) {
      // Desde a mig 20261112190000 a RPC só PEDE: o status fica como está até
      // o Gestor de Sistemas confirmar ou negar (card CHAMADO REABERTO).
      const { data, error } = await (supabase as any)
        .rpc("chamado_reabrir_nao_atendeu", { p_chamado_id: chamado.id, p_motivo: motivo.trim() });
      if (error) {
        setReabrindo(false);
        toast({ title: "Erro ao reabrir", description: error.message, variant: "destructive" });
        return;
      }
      novo = (data as string) || novo;
    } else {
      const { error } = await (supabase as any)
        .from("CHAMADO_SISTEMA").update({ status: novo }).eq("id", chamado.id);
      if (error) {
        setReabrindo(false);
        toast({ title: "Erro ao reabrir", description: error.message, variant: "destructive" });
        return;
      }
      // Mesmo formato de "Chamado reprovado: motivo": é o que ChatChamado
      // traduz para "Fulano reabriu o chamado — motivo". Sem o status no texto
      // de propósito — ele já aparece no selo do chamado.
      const texto = motivo.trim() ? `Chamado reaberto: ${motivo.trim()}` : "Chamado reaberto";
      // Histórico e push não desfazem a reabertura, que já valeu — por isso o
      // erro daqui não vira toast de falha (o supabase-js devolve em `error`,
      // não lança).
      await (supabase as any).from("CHAMADO_SISTEMA_EVENTO")
        .insert({ chamado_id: chamado.id, tipo: "evento", texto });
    }

    const rotulo = STATUS_CHAMADO[novo]?.label ?? novo;
    supabase.functions
      .invoke("enviar-notificacao-push", { body: { chamado_id: chamado.id, evento: "reaberto" } })
      .catch(() => {});

    setReabrindo(false);
    setMotivo("");
    setTipoMotivo("");
    onOpenChange(false);
    toast({
      title: solicitante ? `Pedido de reabertura do #${chamado.numero} enviado` : `Chamado #${chamado.numero} reaberto`,
      description: solicitante ? "O Gestor de Sistemas confirma a reabertura e envia para um desenvolvedor — você é avisado." : `Voltou para "${rotulo}".`,
    });
    // Um chamado reaberto muda fila, contadores e listas das duas telas ao
    // mesmo tempo; invalidar por prefixo evita listar chave por chave e
    // esquecer uma quando surgir tela nova.
    qc.invalidateQueries({ predicate: (q) => String(q.queryKey[0] ?? "").startsWith("chamado") });
    onReaberto?.();
  };

  const novo = statusDestino;

  return (
    <Dialog open={open} onOpenChange={fechar}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <RotateCcw className="h-5 w-5 text-primary" /> Reabrir chamado{chamado ? ` #${chamado.numero}` : ""}
          </DialogTitle>
        </DialogHeader>

        {solicitante ? (
          <>
            <div className="space-y-2">
              <p className="text-sm font-semibold">Motivo da reabertura do chamado:</p>
              <RadioGroup value={tipoMotivo} onValueChange={(v) => setTipoMotivo(v as MotivoReabertura)} className="gap-2">
                {MOTIVOS_REABERTURA.map((m) => (
                  <Label key={m.valor} htmlFor={`motivo-${m.valor}`}
                    className={`flex cursor-pointer items-start gap-2.5 rounded-md border p-3 font-normal transition-colors ${tipoMotivo === m.valor ? "border-primary bg-primary/5 ring-1 ring-primary" : "border-border hover:border-primary/40"}`}>
                    <RadioGroupItem id={`motivo-${m.valor}`} value={m.valor} className="mt-0.5" />
                    <span>
                      <span className="block text-sm font-semibold">{m.rotulo}</span>
                      <span className="block text-xs text-muted-foreground">{m.ajuda}</span>
                    </span>
                  </Label>
                ))}
              </RadioGroup>
            </div>

            {tipoMotivo === "nao_atendeu" && (
              <>
                <Textarea
                  rows={3}
                  autoFocus
                  placeholder="O que não ficou como você pediu? Ex.: o relatório continua saindo sem a coluna de comissão. (obrigatório)"
                  value={motivo}
                  onChange={(e) => setMotivo(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  O pedido vai para o <b>Gestor de Sistemas</b>, que confirma a reabertura (com o mesmo desenvolvedor ou outro) ou explica por que não reabre.
                </p>
              </>
            )}

            {tipoMotivo === "modificacoes" && (
              <div className="space-y-2 rounded-md border border-info/40 bg-info/5 p-3">
                <p className="flex items-center gap-1.5 text-sm font-semibold text-info">
                  <Lightbulb className="h-4 w-4" /> Pra melhorias, abra outro chamado.
                </p>
                <p className="text-xs text-muted-foreground">
                  O chamado novo já vem preenchido com as informações deste. Você só conta <b>o que é preciso a mais</b>,
                  e os dois ficam vinculados (Parte 1, Parte 2…).
                </p>
              </div>
            )}

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => fechar(false)} disabled={reabrindo}>Cancelar</Button>
              {tipoMotivo === "modificacoes" ? (
                <Button className="gap-1.5" onClick={abrirBaseadoNesse}>
                  <CopyPlus className="h-4 w-4" /> Reabrir chamado baseado nesse
                </Button>
              ) : (
                <Button onClick={reabrir} disabled={!chamado || reabrindo || tipoMotivo !== "nao_atendeu" || motivo.trim().length < 5}>
                  {reabrindo ? "Reabrindo…" : "Reabrir chamado"}
                </Button>
              )}
            </div>
          </>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              O chamado volta para <b>{STATUS_CHAMADO[novo]?.label ?? novo}</b>
              {novo === "em_andamento" ? ", no fim da fila do responsável" : ""}, e a data de conclusão é desfeita.
              {" O solicitante é avisado."}
            </p>
            <Textarea
              rows={3}
              placeholder="Motivo (opcional) — ex.: falta a segunda PR do ajuste. Aparece no histórico."
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
            />
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => fechar(false)} disabled={reabrindo}>Cancelar</Button>
              <Button onClick={reabrir} disabled={!chamado || reabrindo}>
                {reabrindo ? "Reabrindo…" : "Reabrir chamado"}
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
