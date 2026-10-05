import { useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Banknote, Paperclip, Pencil } from "lucide-react";
import { toast } from "sonner";
import { AcessoGate } from "@/components/auth/AcessoGate";
import { formatBRL } from "@/hooks/usePlanilhaCusto";
import { DebitoAutomaticoLinha, useAnexosDebito, usePagarDebito } from "@/hooks/useDebitoAutomatico";
import { AnexosDebito } from "./AnexosDebito";
import { DIAS_AVISO_VENCIMENTO, diasParaVencer } from "./parcelas";

const MENU_CODIGO = "financeiro-debito-automatico";

// SIS-2026-0570: débitos futuros — tudo que ainda está pendente (parcelas e
// débitos avulsos), por vencimento. Só entra no Fluxo de Caixa depois de pago.
export const vencimentoDe = (l: DebitoAutomaticoLinha) => l.data_vencimento ?? l.data_pagamento;

const fmtData = (iso: string) => new Date(iso + "T00:00:00").toLocaleDateString("pt-BR");

function textoPrazo(dias: number) {
  if (dias < 0) return `vencido há ${-dias} dia${dias === -1 ? "" : "s"}`;
  if (dias === 0) return "vence hoje";
  if (dias === 1) return "vence amanhã";
  return `em ${dias} dias`;
}

type FiltroPrazo = "todos" | "vencidos" | "proximos" | "futuros";

export function AVencerTab({
  linhas, hoje, filtroInicial = "todos", onEditar,
}: {
  linhas: DebitoAutomaticoLinha[];
  hoje: string;
  filtroInicial?: FiltroPrazo;
  onEditar: (l: DebitoAutomaticoLinha) => void;
}) {
  const [filtro, setFiltro] = useState<FiltroPrazo>(filtroInicial);
  const [pagando, setPagando] = useState<DebitoAutomaticoLinha | null>(null);
  const [anexosDe, setAnexosDe] = useState<DebitoAutomaticoLinha | null>(null);

  const pendentes = useMemo(
    () => linhas.filter((l) => l.status === "pendente").sort((a, b) => vencimentoDe(a).localeCompare(vencimentoDe(b))),
    [linhas]
  );

  const classifica = (l: DebitoAutomaticoLinha): Exclude<FiltroPrazo, "todos"> => {
    const d = diasParaVencer(vencimentoDe(l), hoje);
    return d < 0 ? "vencidos" : d <= DIAS_AVISO_VENCIMENTO ? "proximos" : "futuros";
  };

  const contagem = useMemo(() => {
    const c = { todos: pendentes.length, vencidos: 0, proximos: 0, futuros: 0 };
    pendentes.forEach((l) => { c[classifica(l)]++; });
    return c;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendentes, hoje]);

  const visiveis = filtro === "todos" ? pendentes : pendentes.filter((l) => classifica(l) === filtro);
  const totalVisivel = visiveis.reduce((s, l) => s + (l.tipo === "saida" ? Number(l.valor) : 0), 0);

  const chips: { id: FiltroPrazo; label: string }[] = [
    { id: "todos", label: "Todos" },
    { id: "vencidos", label: "Vencidos" },
    { id: "proximos", label: `Próximos ${DIAS_AVISO_VENCIMENTO} dias` },
    { id: "futuros", label: "Futuros" },
  ];

  return (
    <>
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-semibold">Débitos a vencer</p>
            <div className="flex flex-wrap gap-1.5">
              {chips.map((c) => (
                <Button key={c.id} size="sm" variant={filtro === c.id ? "default" : "outline"} className="h-7 text-xs" onClick={() => setFiltro(c.id)}>
                  {c.label} ({contagem[c.id]})
                </Button>
              ))}
            </div>
          </div>

          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="[&>th]:px-2 [&>th]:py-2">
                  <TableHead>Vencimento</TableHead>
                  <TableHead>Prazo</TableHead>
                  <TableHead>ID</TableHead>
                  <TableHead>Descrição</TableHead>
                  <TableHead>Parcela</TableHead>
                  <TableHead>Empresa</TableHead>
                  <TableHead>Contrato</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead className="text-right">Valor (R$)</TableHead>
                  <TableHead className="text-center">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visiveis.length === 0 && (
                  <TableRow><TableCell colSpan={10} className="text-center text-muted-foreground py-10">Nenhum débito pendente nesta visão.</TableCell></TableRow>
                )}
                {visiveis.map((l) => {
                  const dias = diasParaVencer(vencimentoDe(l), hoje);
                  const cor = dias < 0 ? "text-red-600 dark:text-red-400 font-medium" : dias <= DIAS_AVISO_VENCIMENTO ? "text-amber-600 dark:text-amber-400 font-medium" : "text-muted-foreground";
                  return (
                    <TableRow key={l.id} className="[&>td]:px-2 [&>td]:py-2">
                      <TableCell className="text-xs whitespace-nowrap">{fmtData(vencimentoDe(l))}</TableCell>
                      <TableCell className={`text-xs whitespace-nowrap ${cor}`}>{textoPrazo(dias)}</TableCell>
                      <TableCell className="font-mono text-xs whitespace-nowrap">{l.numero}</TableCell>
                      <TableCell className="text-xs max-w-[220px] truncate" title={l.descricao}>{l.descricao}</TableCell>
                      <TableCell className="text-xs whitespace-nowrap">
                        {l.numero_parcela ? <Badge variant="secondary">{l.numero_parcela}/{l.total_parcelas}</Badge> : "—"}
                      </TableCell>
                      <TableCell className="text-xs max-w-[90px] truncate" title={l.empresa_nome ?? ""}>{l.empresa_nome ?? "—"}</TableCell>
                      <TableCell className="text-xs max-w-[130px] truncate" title={l.contrato_nome ?? ""}>{l.contrato_nome ?? "—"}</TableCell>
                      <TableCell>
                        {l.tipo === "entrada" ? (
                          <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">Entrada</Badge>
                        ) : (
                          <Badge className="bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-300">Saída</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right text-xs font-medium whitespace-nowrap">{formatBRL(l.valor)}</TableCell>
                      <TableCell className="text-center whitespace-nowrap">
                        <AcessoGate menu={MENU_CODIGO} acao="alterar">
                          <Button size="sm" className="h-7 gap-1 text-xs" onClick={() => setPagando(l)}>
                            <Banknote className="h-3.5 w-3.5" /> Pagar
                          </Button>
                          <Button size="icon" variant="ghost" className="h-7 w-7" title="Editar / alterar vencimento" onClick={() => onEditar(l)}>
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                        </AcessoGate>
                        <Button size="icon" variant="ghost" className="h-7 w-7" title="Anexos" onClick={() => setAnexosDe(l)}>
                          <Paperclip className="h-3.5 w-3.5" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
          {visiveis.length > 0 && (
            <p className="text-xs text-muted-foreground">
              {visiveis.length} lançamento{visiveis.length === 1 ? "" : "s"} — saídas somam {formatBRL(totalVisivel)}
            </p>
          )}
        </CardContent>
      </Card>

      <PagarDebitoDialog registro={pagando} hoje={hoje} onClose={() => setPagando(null)} />

      <Dialog open={!!anexosDe} onOpenChange={(o) => !o && setAnexosDe(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Anexos — {anexosDe?.numero}</DialogTitle>
            <DialogDescription>{anexosDe?.descricao}</DialogDescription>
          </DialogHeader>
          {anexosDe && (
            <div className="space-y-4">
              <AnexosDebito debitoId={anexosDe.id} tipo="lancamento" titulo="Nota / boleto" />
              <AnexosDebito debitoId={anexosDe.id} tipo="comprovante" titulo="Comprovante de pagamento" />
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

// Parcela só paga com comprovante PRÓPRIO (a RPC também confere). A data
// sugerida é o vencimento; é essa data que entra no Fluxo de Caixa.
function PagarDebitoDialog({ registro, hoje, onClose }: { registro: DebitoAutomaticoLinha | null; hoje: string; onClose: () => void }) {
  const pagar = usePagarDebito();
  const { data: anexos = [] } = useAnexosDebito(registro?.id ?? null);
  const [dataPagamento, setDataPagamento] = useState("");

  // Reinicia a data (sugere o vencimento) quando abre outro registro.
  useEffect(() => {
    if (registro) setDataPagamento(vencimentoDe(registro));
  }, [registro?.id]);

  const exigeComprovante = !!registro?.grupo_parcelas_id;
  const temComprovante = anexos.some((a) => a.tipo === "comprovante");
  const bloqueado = exigeComprovante && !temComprovante;

  async function confirmar() {
    if (!registro) return;
    if (!dataPagamento) {
      toast.error("Informe a data do pagamento.");
      return;
    }
    try {
      await pagar.mutateAsync({ id: registro.id, data_pagamento: dataPagamento });
      toast.success("Pagamento registrado — o lançamento foi para o Fluxo de Caixa.");
      onClose();
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao registrar pagamento.");
    }
  }

  return (
    <Dialog open={!!registro} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Pagar {registro?.numero_parcela ? `parcela ${registro.numero_parcela}/${registro.total_parcelas}` : "lançamento"}</DialogTitle>
          <DialogDescription>
            {registro?.descricao} — {registro ? formatBRL(registro.valor) : ""} (vence em {registro ? fmtData(vencimentoDe(registro)) : ""})
          </DialogDescription>
        </DialogHeader>
        {registro && (
          <div className="space-y-4">
            <div>
              <Label className="text-xs">Data do pagamento *</Label>
              <Input type="date" max={hoje} value={dataPagamento} onChange={(e) => setDataPagamento(e.target.value)} />
              <p className="mt-1 text-[11px] text-muted-foreground">É a data que aparece no Fluxo de Caixa. Se pagou em outro dia, corrija aqui.</p>
            </div>
            <AnexosDebito debitoId={registro.id} tipo="comprovante" titulo={exigeComprovante ? "Comprovante desta parcela *" : "Comprovante (opcional)"} />
            {bloqueado && <p className="text-xs text-destructive">Anexe o comprovante desta parcela para poder pagar.</p>}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pagar.isPending}>Cancelar</Button>
          <Button onClick={confirmar} disabled={pagar.isPending || bloqueado}>{pagar.isPending ? "Registrando..." : "Confirmar pagamento"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
