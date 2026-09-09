import { useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PageHeader } from "@/components/layout/PageHeader";
import { AcessoGate } from "@/components/auth/AcessoGate";
import {
  useFilaSeparacao, useConfirmarSeparacao, useDivergenciaSeparacao,
  type LinhaFilaSeparacao,
} from "@/hooks/useSupSeparacao";
import {
  PackageCheck, Search, MapPin, AlertTriangle, Check, Boxes, Clock,
} from "lucide-react";

/**
 * Separação de Pedidos — a tela dos estoquistas.
 *
 * O gerente descreveu o fluxo assim: a supervisora confere o pedido e monta o
 * pré-pedido; "os guris automaticamente, na sequência, eles vão pegar esse
 * pedido que está disponível para separar, e já vai sair para separar".
 *
 * Duas regras de desenho que vêm direto da conversa:
 *
 *   1. O separador NÃO vê a fila comercial. Toda a leitura passa por
 *      sup_sep_fila(), que devolve só o necessário para achar a peça na
 *      prateleira. É por isso que esta tela tem menu próprio (sup_separacao)
 *      em vez de ser uma aba de Pedidos de Materiais.
 *
 *   2. Divergência é registro, não conserto. Quando não está na doca, o
 *      estoquista diz quanto faltou e por quê; o saldo NÃO é corrigido aqui.
 *      Quem decide quanto existe de verdade é a contagem rotativa — e é isso
 *      que preserva a prova de que a peça sumiu sem baixa.
 */

interface PedidoAgrupado {
  pedido_id: string;
  protocolo: string;
  contrato_nome: string | null;
  posto_nome: string | null;
  funcao_nome: string | null;
  nome_colaborador: string | null;
  data_solicitacao: string | null;
  reservado_em: string;
  linhas: LinhaFilaSeparacao[];
}

/** Há quantos dias o pré-pedido está esperando alguém separar. */
function diasParado(iso: string): number {
  const ms = Date.now() - new Date(iso).getTime();
  return Math.max(Math.floor(ms / 86_400_000), 0);
}

export default function SeparacaoMateriais() {
  const [busca, setBusca] = useState("");
  const [marcadas, setMarcadas] = useState<Set<string>>(new Set());
  const [divergindo, setDivergindo] = useState<LinhaFilaSeparacao | null>(null);

  const filaQ = useFilaSeparacao();
  const confirmar = useConfirmarSeparacao();

  const pedidos = useMemo<PedidoAgrupado[]>(() => {
    const linhas = filaQ.data ?? [];
    const alvo = busca.trim().toLowerCase();
    const mapa = new Map<string, PedidoAgrupado>();

    for (const l of linhas) {
      if (alvo) {
        const alcance = [l.protocolo, l.nome_colaborador, l.contrato_nome, l.posto_nome,
                         l.nome_item, l.codigo, l.localizacao]
          .filter(Boolean).join(" ").toLowerCase();
        if (!alcance.includes(alvo)) continue;
      }
      const g = mapa.get(l.pedido_id);
      if (g) {
        g.linhas.push(l);
        if (l.reservado_em < g.reservado_em) g.reservado_em = l.reservado_em;
      } else {
        mapa.set(l.pedido_id, {
          pedido_id: l.pedido_id, protocolo: l.protocolo,
          contrato_nome: l.contrato_nome, posto_nome: l.posto_nome,
          funcao_nome: l.funcao_nome, nome_colaborador: l.nome_colaborador,
          data_solicitacao: l.data_solicitacao, reservado_em: l.reservado_em,
          linhas: [l],
        });
      }
    }
    // Mais antigo primeiro: quem esperou mais sai antes da doca.
    return [...mapa.values()].sort((a, b) => a.reservado_em.localeCompare(b.reservado_em));
  }, [filaQ.data, busca]);

  const totalUnidades = useMemo(
    () => (filaQ.data ?? []).reduce((s, l) => s + l.quantidade, 0),
    [filaQ.data],
  );

  function alternar(id: string) {
    setMarcadas((m) => {
      const n = new Set(m);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }

  function confirmarPedido(g: PedidoAgrupado) {
    const alvo = g.linhas.filter((l) => marcadas.has(l.reserva_id));
    const itens = (alvo.length ? alvo : g.linhas).map((l) => ({ reserva_id: l.reserva_id }));
    confirmar.mutate({ pedido_id: g.pedido_id, itens }, {
      onSuccess: () => setMarcadas(new Set()),
    });
  }

  return (
    <AcessoGate
      menu="sup_separacao"
      acao="visualizar"
      fallback={
        <div className="p-6 text-sm text-muted-foreground">
          Você não tem acesso à fila de separação.
        </div>
      }
    >
      <div className="p-4 lg:p-6">
        <PageHeader
          title="Separação de Pedidos"
          subtitle="Pré-pedidos aprovados, prontos para separar na prateleira"
          module="Suprimentos"
          breadcrumb={["Suprimentos", "Separação"]}
        />

        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative w-full sm:max-w-md">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Protocolo, colaborador, material, lote ou prateleira…"
              className="pl-9"
            />
          </div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Boxes className="h-4 w-4" />
            {pedidos.length} pedido(s) · {totalUnidades} unidade(s) a separar
          </div>
        </div>

        {filaQ.isLoading && (
          <p className="py-10 text-center text-sm text-muted-foreground">Carregando a fila…</p>
        )}

        {!filaQ.isLoading && pedidos.length === 0 && (
          <Card>
            <CardContent className="py-12 text-center">
              <PackageCheck className="mx-auto mb-3 h-10 w-10 text-muted-foreground/50" />
              <p className="font-medium">Nada para separar agora.</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Os pedidos aparecem aqui quando o Suprimentos confirma o pré-pedido.
              </p>
            </CardContent>
          </Card>
        )}

        <div className="space-y-4">
          {pedidos.map((g) => {
            const dias = diasParado(g.reservado_em);
            return (
              <Card key={g.pedido_id} className="overflow-hidden">
                <CardContent className="p-0">
                  <div className="flex flex-col gap-2 border-b bg-muted/40 p-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono font-semibold">{g.protocolo}</span>
                        <Badge variant="outline">{g.linhas.length} item(ns)</Badge>
                        {dias >= 2 && (
                          <Badge className="border-amber-400/50 bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300">
                            <Clock className="mr-1 h-3 w-3" />
                            parado há {dias} dias
                          </Badge>
                        )}
                      </div>
                      <p className="mt-1 truncate text-sm text-muted-foreground">
                        {[g.nome_colaborador, g.contrato_nome, g.posto_nome, g.funcao_nome]
                          .filter(Boolean).join(" · ") || "—"}
                      </p>
                    </div>
                    <AcessoGate menu="sup_separacao" acao="alterar">
                      <Button
                        onClick={() => confirmarPedido(g)}
                        disabled={confirmar.isPending}
                        className="shrink-0"
                      >
                        <Check className="mr-2 h-4 w-4" />
                        {g.linhas.some((l) => marcadas.has(l.reserva_id))
                          ? "Confirmar marcados"
                          : "Confirmar tudo"}
                      </Button>
                    </AcessoGate>
                  </div>

                  <div className="divide-y">
                    {g.linhas.map((l) => (
                      <div key={l.reserva_id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
                        <Checkbox
                          checked={marcadas.has(l.reserva_id)}
                          onCheckedChange={() => alternar(l.reserva_id)}
                          aria-label={`Marcar ${l.nome_item}`}
                          className="shrink-0"
                        />
                        <div className="min-w-0 flex-1">
                          <p className="font-medium">
                            {l.nome_item}
                            {l.item_tamanho && (
                              <span className="ml-2 text-sm text-muted-foreground">({l.item_tamanho})</span>
                            )}
                          </p>
                          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                            <span className="font-mono">lote {l.codigo}</span>
                            {l.localizacao && (
                              <span className="inline-flex items-center gap-1">
                                <MapPin className="h-3 w-3" />
                                {l.localizacao}
                              </span>
                            )}
                            <span>reservado por {l.reservado_por_nome ?? "—"}</span>
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <Badge variant="secondary" className="text-sm">{l.quantidade} un</Badge>
                          <AcessoGate menu="sup_separacao" acao="alterar">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setDivergindo(l)}
                              className="text-amber-700 hover:text-amber-800 dark:text-amber-300"
                            >
                              <AlertTriangle className="mr-1.5 h-3.5 w-3.5" />
                              Divergência
                            </Button>
                          </AcessoGate>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>

        <DialogDivergencia linha={divergindo} onFechar={() => setDivergindo(null)} />
      </div>
    </AcessoGate>
  );
}

/**
 * "Chegou lá, 9 tinha e 1 estava errado."
 *
 * Pede quanto faltou e por quê. O motivo é obrigatório porque é ele que a
 * apuração vai ler depois — sem ele, a linha na contagem rotativa não ajuda
 * ninguém a descobrir o que aconteceu.
 */
function DialogDivergencia({
  linha, onFechar,
}: { linha: LinhaFilaSeparacao | null; onFechar: () => void }) {
  const [faltante, setFaltante] = useState(1);
  const [motivo, setMotivo] = useState("");
  const divergir = useDivergenciaSeparacao();

  const aberto = !!linha;
  const max = linha?.quantidade ?? 1;

  function fechar() {
    setFaltante(1);
    setMotivo("");
    onFechar();
  }

  return (
    <Dialog open={aberto} onOpenChange={(o) => { if (!o) fechar(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Registrar divergência</DialogTitle>
        </DialogHeader>

        {linha && (
          <div className="space-y-4">
            <div className="rounded-md border bg-muted/40 p-3 text-sm">
              <p className="font-medium">{linha.nome_item}{linha.item_tamanho ? ` (${linha.item_tamanho})` : ""}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                lote <span className="font-mono">{linha.codigo}</span> · reservado {linha.quantidade} un
                {linha.localizacao ? ` · ${linha.localizacao}` : ""}
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="faltante">Quantas unidades NÃO estavam na doca</Label>
              <Input
                id="faltante"
                type="number"
                min={1}
                max={max}
                value={faltante}
                onChange={(e) => setFaltante(Math.min(Math.max(Number(e.target.value) || 1, 1), max))}
              />
              {faltante < max && (
                <p className="text-xs text-muted-foreground">
                  As outras {max - faltante} continuam reservadas e podem ser separadas normalmente.
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="motivo">O que aconteceu</Label>
              <Textarea
                id="motivo"
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                placeholder="Ex.: só havia 2 na caixa; a prateleira estava vazia; peça avariada…"
                rows={3}
              />
              <p className="text-xs text-muted-foreground">
                O saldo do sistema NÃO é corrigido agora. O material entra na lista de
                contagem rotativa, e a contagem é que decide quanto existe de verdade.
              </p>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={fechar}>Cancelar</Button>
          <Button
            disabled={!motivo.trim() || divergir.isPending}
            onClick={() =>
              linha && divergir.mutate(
                { reserva_id: linha.reserva_id, faltante, motivo: motivo.trim() },
                { onSuccess: fechar },
              )
            }
          >
            Registrar divergência
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
