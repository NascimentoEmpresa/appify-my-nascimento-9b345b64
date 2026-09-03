import { useState } from "react";
import { toast } from "sonner";
import { BadgeCheck, ShieldCheck, XCircle } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { AcessoGate } from "@/components/auth/AcessoGate";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useDecidirReembolso, useReembolsos } from "@/hooks/useReembolso";
import {
  ROTULO_STATUS, STATUS_TODOS, type StatusReembolso,
} from "@/lib/reembolso/regras";
import { ListaReembolsos } from "./componentes/ListaReembolsos";

// =====================================================================
// REEMBOLSO — a fila de quem aprova.
//
// No bot, isto era uma DM: a solicitação chegava no privado de quem tinha a
// role de líder do setor, com dois botões. Quem apagasse a conversa perdia a
// fila, e quem entrasse depois nunca via o que já tinha sido decidido.
//
// Quem vê O QUÊ é decidido pela RLS (`cs_reembolso_aprova_setor`): a pessoa
// enxerga e decide os reembolsos dos SETORES marcados para ela em
// Administração › Acesso por Usuário, no painel ao lado deste menu. Sem setor
// marcado, não vê nem decide nada — nem com o menu liberado.
//
// Esta tela NÃO repete esse recorte: duas cópias da mesma regra divergem com o
// tempo, e a cópia do front é justamente a que não protege nada.
//
// "Enviar ao malote" NÃO mora mais aqui (04/09/2026, troca de fluxo pedida
// pelo Pablo): o aprovador só decide. Quem lança a despesa aprovada no
// Malote é quem pediu o reembolso, em Minhas Solicitações — ver
// `SolicitarReembolso.tsx`. O motivo era o próprio histórico: o evento
// "enviado ao malote" saía assinado com o nome de quem aprova, não de quem
// de fato clicou (ver migration 20260930000050).
// =====================================================================

export default function AprovacaoReembolso() {
  const [status, setStatus] = useState<StatusReembolso | "todos">("pendente");
  const { data: lista = [], isLoading } = useReembolsos("fila", undefined, status);
  const decidir = useDecidirReembolso();

  // O motivo é por linha: com um estado só, abrir a segunda solicitação
  // herdava o texto digitado na primeira e o motivo saía trocado.
  const [motivos, setMotivos] = useState<Record<string, string>>({});

  const agir = (id: string, acao: "aprovar" | "reprovar") => {
    const motivo = (motivos[id] ?? "").trim();
    // Reprovar sem motivo devolve a solicitação sem ninguém saber o que
    // corrigir — a mesma regra das outras telas de aprovação do ERP.
    if (acao === "reprovar" && motivo.length < 10) {
      toast.error("Escreva o motivo da reprovação (mín. 10 caracteres).");
      return;
    }
    decidir.mutate(
      { id, acao, motivo },
      {
        onSuccess: () => {
          toast.success(
            acao === "aprovar"
              ? "Reembolso aprovado — quem pediu já pode lançar no malote, em Minhas Solicitações."
              : "Reembolso reprovado.",
          );
          setMotivos((m) => ({ ...m, [id]: "" }));
        },
        onError: (e: any) => toast.error(e?.message ?? "Não deu para registrar a decisão."),
      },
    );
  };

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Reembolso — Aprovação"
        subtitle="As solicitações de reembolso que estão na sua alçada."
        module="Central de Serviços"
        breadcrumb={["Solicitar Reembolso", "Aprovação"]}
        actions={
          <div className="w-52">
            <Select value={status} onValueChange={(v) => setStatus(v as StatusReembolso | "todos")}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos os status</SelectItem>
                {STATUS_TODOS.map((s) => (
                  <SelectItem key={s} value={s}>{ROTULO_STATUS[s]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        }
      />

      <AcessoGate
        menu="central_servicos_reembolso_aprovacao"
        acao="visualizar"
        fallback={
          <Card className="p-6 text-sm text-muted-foreground">
            <ShieldCheck className="mb-2 h-5 w-5" />
            Você não tem liberação para ver a fila de aprovação de reembolsos.
          </Card>
        }
      >
        <ListaReembolsos
          lista={lista}
          carregando={isLoading}
          vazio="Nada na sua alçada por aqui. Se você acabou de ganhar a permissão, confira em Acesso por Usuário se algum setor foi marcado — sem setor, a fila vem vazia."
          mostrarSolicitante
          acoes={(r) =>
            /* Decidido (aprovado/reprovado/o resto): nada mais para o
               aprovador fazer aqui — o malote é passo de quem pediu. */
            r.status !== "pendente" ? null : (
              <AcessoGate
                menu="central_servicos_reembolso_aprovacao"
                acao="aprovar"
                fallback={
                  <p className="text-xs text-muted-foreground">
                    Você acompanha esta fila, mas não tem a ação de aprovar.
                  </p>
                }
              >
                <div className="w-full space-y-3">
                  <div className="space-y-1.5">
                    <Label htmlFor={`motivo-${r.id}`} className="text-xs">
                      Motivo <span className="text-muted-foreground">(obrigatório para reprovar)</span>
                    </Label>
                    <Textarea
                      id={`motivo-${r.id}`}
                      rows={2}
                      placeholder="O que precisa ser corrigido?"
                      value={motivos[r.id] ?? ""}
                      onChange={(e) => setMotivos((m) => ({ ...m, [r.id]: e.target.value }))}
                    />
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button disabled={decidir.isPending} onClick={() => agir(r.id, "aprovar")}>
                      <BadgeCheck className="mr-2 h-4 w-4" /> Aprovar
                    </Button>
                    <Button variant="destructive" disabled={decidir.isPending}
                            onClick={() => agir(r.id, "reprovar")}>
                      <XCircle className="mr-2 h-4 w-4" /> Reprovar
                    </Button>
                  </div>
                </div>
              </AcessoGate>
            )
          }
        />
      </AcessoGate>
    </div>
  );
}
