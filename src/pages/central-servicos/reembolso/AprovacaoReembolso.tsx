import { useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, BadgeCheck, Send, ShieldCheck, XCircle } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { AcessoGate } from "@/components/auth/AcessoGate";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  useAprovarELancar, useConfigReembolso, useDecidirReembolso, useEnviarAoMalote, useReembolsos,
} from "@/hooks/useReembolso";
import { Link } from "react-router-dom";
import {
  ROTULO_STATUS, STATUS_TODOS, podeEnviarAoMalote, type StatusReembolso,
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
// =====================================================================

export default function AprovacaoReembolso() {
  const [status, setStatus] = useState<StatusReembolso | "todos">("pendente");
  const { data: lista = [], isLoading } = useReembolsos("fila", undefined, status);
  const decidir = useDecidirReembolso();
  const aprovarELancar = useAprovarELancar();
  const enviarMalote = useEnviarAoMalote();
  // Só para AVISAR antes do clique. Quem recusa de verdade é a RPC — esta
  // leitura é conveniência, não regra, e por isso não bloqueia o botão: se a
  // config for preenchida noutra aba, o aviso some sozinho no próximo refetch
  // e nada aqui precisa saber disso.
  const { data: cfg } = useConfigReembolso();
  const faltaClassificacao = !!cfg && !cfg.classificacao_id;

  // O motivo é por linha: com um estado só, abrir a segunda solicitação
  // herdava o texto digitado na primeira e o motivo saía trocado.
  const [motivos, setMotivos] = useState<Record<string, string>>({});

  /**
   * Aprovar e reprovar seguem caminhos diferentes desde 02/09/2026.
   *
   * APROVAR chama `cs_reembolso_aprovar_e_lancar`, que decide e cria a
   * despesa no Malote na MESMA transação — era o pedido: "ao clicar em
   * APROVAR vá pro malote e entre como despesa lá". Se o Malote recusar, a
   * aprovação não acontece e a mensagem dele aparece aqui.
   *
   * REPROVAR continua no update simples: não há nada para lançar.
   */
  const agir = (id: string, acao: "aprovar" | "reprovar") => {
    const motivo = (motivos[id] ?? "").trim();

    if (acao === "aprovar") {
      aprovarELancar.mutate(id, {
        onSuccess: () => {
          toast.success("Reembolso aprovado e lançado como despesa no Malote.");
          setMotivos((m) => ({ ...m, [id]: "" }));
        },
        onError: (e: any) => toast.error(e?.message ?? "Não deu para aprovar."),
      });
      return;
    }

    // Reprovar sem motivo devolve a solicitação sem ninguém saber o que
    // corrigir — a mesma regra das outras telas de aprovação do ERP.
    if (motivo.length < 10) {
      toast.error("Escreva o motivo da reprovação (mín. 10 caracteres).");
      return;
    }
    decidir.mutate(
      { id, acao, motivo },
      {
        onSuccess: () => {
          toast.success("Reembolso reprovado.");
          setMotivos((m) => ({ ...m, [id]: "" }));
        },
        onError: (e: any) => toast.error(e?.message ?? "Não deu para registrar a decisão."),
      },
    );
  };

  /**
   * Manda o reembolso aprovado virar despesa no Malote.
   *
   * A RPC devolve a despesa que já existe se for chamada de novo, então um
   * duplo-clique não gera dois lançamentos — mas a tela também esconde o botão
   * assim que `malote_despesa_id` aparece, para não parecer que nada aconteceu.
   */
  const enviar = (id: string) => {
    enviarMalote.mutate(id, {
      onSuccess: () => toast.success("Despesa criada no Malote."),
      onError: (e: any) => toast.error(e?.message ?? "Não deu para enviar ao malote."),
    });
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
        {/* Aprovar agora lança no Malote, então a config virou pré-requisito
            da aprovação, não do envio. Dizer isso ANTES do clique evita que a
            pessoa descubra pelo erro. */}
        {faltaClassificacao && (
          <Card className="mb-4 flex items-start gap-2 border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              <strong>Aprovar está bloqueado:</strong> falta escolher a classificação com que a
              despesa nasce no Malote. Aprovar passou a lançar a despesa na mesma hora, e o Malote
              não aceita despesa sem classificação.{" "}
              <AcessoGate menu="central_servicos_reembolso_config" acao="alterar">
                <Link className="font-semibold underline" to="/app/central-servicos/reembolso/configuracao">
                  Escolher em Tipos e Limites
                </Link>
              </AcessoGate>
            </span>
          </Card>
        )}

        <ListaReembolsos
          lista={lista}
          carregando={isLoading}
          vazio="Nada na sua alçada por aqui. Se você acabou de ganhar a permissão, confira em Acesso por Usuário se algum setor foi marcado — sem setor, a fila vem vazia."
          mostrarSolicitante
          acoes={(r) =>
            /* Aprovado e ainda não lançado: o passo seguinte é o malote. */
            podeEnviarAoMalote(r.status, !!r.malote_despesa_id) ? (
              <AcessoGate menu="central_servicos_reembolso_aprovacao" acao="aprovar">
                <Button disabled={enviarMalote.isPending} onClick={() => enviar(r.id)}>
                  <Send className="mr-2 h-4 w-4" /> Enviar ao malote
                </Button>
              </AcessoGate>
            ) : r.status !== "pendente" ? null : (
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
                    {/* O rótulo diz o que o clique FAZ. "Aprovar" sozinho
                        escondia que o dinheiro entra no Malote na mesma hora,
                        e isso é o tipo de coisa que a pessoa precisa saber
                        antes de clicar, não depois. */}
                    <Button disabled={aprovarELancar.isPending} onClick={() => agir(r.id, "aprovar")}>
                      <BadgeCheck className="mr-2 h-4 w-4" /> Aprovar e lançar no Malote
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
