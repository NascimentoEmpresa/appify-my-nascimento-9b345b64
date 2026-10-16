import { useMemo } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { NfEmissaoRow } from "@/hooks/useNfEmissao";
import { diasDesdeEmissao, fmtMoney } from "@/pages/financeiro/nf-emissao/shared";
import { agruparFaturamento, notasComSaldo, ponteAReceber, totaisVazios } from "./regras";

// SIS-2026-0641: o que está por trás do A Receber. Em cima, a conta que fecha do Líquido até o saldo; embaixo, as
// notas que ainda têm saldo de verdade (nota paga não aparece: não tem saldo).
export interface DetalheAReceberAlvo {
  titulo: string;
  nfs: NfEmissaoRow[];
}

const dia = (iso: string | null) => (iso ? iso.slice(0, 10).split("-").reverse().join("/") : "—");
const mes = (iso: string) => `${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

export function DetalheAReceber({ alvo, onClose }: { alvo: DetalheAReceberAlvo | null; onClose: () => void }) {
  const total = useMemo(() => {
    if (!alvo) return totaisVazios();
    const t = agruparFaturamento(alvo.nfs, () => "todas").get("todas");
    return t ?? totaisVazios();
  }, [alvo]);
  const ponte = useMemo(() => ponteAReceber(total), [total]);
  const notas = useMemo(() => (alvo ? notasComSaldo(alvo.nfs) : []), [alvo]);

  const linha = (rotulo: string, valor: number, opcoes?: { sinal?: "-" | "="; forte?: boolean; dica?: string }) => (
    <TableRow className={opcoes?.forte ? "font-semibold" : undefined}>
      <TableCell className="py-1.5">
        {opcoes?.sinal && <span className="mr-2 inline-block w-3 text-muted-foreground">{opcoes.sinal === "-" ? "−" : "="}</span>}
        {rotulo}
        {opcoes?.dica && <span className="block pl-5 text-[11px] font-normal text-muted-foreground">{opcoes.dica}</span>}
      </TableCell>
      <TableCell className="py-1.5 text-right tabular-nums">{fmtMoney(valor)}</TableCell>
    </TableRow>
  );

  return (
    <Dialog open={!!alvo} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[90vh] max-w-5xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>A Receber — {alvo?.titulo}</DialogTitle>
          <DialogDescription>
            NFs Código N validadas, sem canceladas e substituídas. Nota paga (com data de pagamento) não tem saldo.
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-md border">
          <Table className="text-sm">
            <TableBody>
              {linha("Valor Líquido", ponte.liquido, { dica: "O que as notas valem depois dos descontos da própria NF." })}
              {linha("Recebido", ponte.recebido, { sinal: "-", dica: "Valor pago registrado no Relatório de Serviços." })}
              {linha("Conta vinculada", ponte.contaVinculada, { sinal: "-", dica: "Retida na nota (coluna Desconto de conta vinculada): não entra em dinheiro, nem é saldo." })}
              {linha("Descontos depois da NF", ponte.posEmissao, { sinal: "-", dica: "Multas, glosas e outros descontos aplicados depois da emissão." })}
              {linha("Diferença em notas já baixadas", ponte.diferencaBaixadas, { sinal: "-", dica: "Nota com data de pagamento cujo valor pago não fecha com o devido; baixada, não tem saldo (positivo = pago a menos)." })}
              {linha("A Receber", ponte.aReceber, { sinal: "=", forte: true })}
            </TableBody>
          </Table>
        </div>

        <div>
          <h3 className="mb-1.5 text-sm font-semibold">
            Notas com saldo a receber ({notas.length.toLocaleString("pt-BR")})
          </h3>
          <div className="overflow-x-auto rounded-md border">
            <Table className="text-xs tabular-nums">
              <TableHeader>
                <TableRow>
                  <TableHead>Nº NF</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Contrato</TableHead>
                  <TableHead>Competência</TableHead>
                  <TableHead>Emissão</TableHead>
                  <TableHead className="text-right">Líquido (R$)</TableHead>
                  <TableHead className="text-right">Conta vinculada (R$)</TableHead>
                  <TableHead className="text-right">A Receber (R$)</TableHead>
                  <TableHead className="text-right">Dias</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {notas.map(({ nf, saldo }) => {
                  const dias = diasDesdeEmissao(nf.data_emissao);
                  return (
                    <TableRow key={nf.id}>
                      <TableCell className="whitespace-nowrap font-mono">{nf.numero_nf ?? "—"}</TableCell>
                      <TableCell className="max-w-[200px] truncate" title={nf.contrato?.cliente ?? ""}>{nf.contrato?.cliente ?? "—"}</TableCell>
                      <TableCell className="max-w-[200px] truncate" title={nf.contrato?.nome ?? ""}>{nf.contrato?.nome ?? "—"}</TableCell>
                      <TableCell>{mes(nf.competencia)}</TableCell>
                      <TableCell className="whitespace-nowrap">{dia(nf.data_emissao)}</TableCell>
                      <TableCell className="text-right">{fmtMoney(nf.vlr_liquido_total)}</TableCell>
                      <TableCell className="text-right">{nf.desconto_conta_vinculada ? fmtMoney(nf.desconto_conta_vinculada) : "—"}</TableCell>
                      <TableCell className="text-right font-medium">{fmtMoney(saldo)}</TableCell>
                      <TableCell className={`text-right ${dias !== null && dias > 30 ? "font-medium text-amber-600" : ""}`}>{dias ?? "—"}</TableCell>
                    </TableRow>
                  );
                })}
                {notas.length === 0 && (
                  <TableRow><TableCell colSpan={9} className="py-6 text-center text-muted-foreground">Nenhuma nota com saldo a receber neste recorte.</TableCell></TableRow>
                )}
              </TableBody>
              {notas.length > 0 && (
                <TableFooter>
                  <TableRow>
                    <TableCell colSpan={7} className="font-semibold">Total</TableCell>
                    <TableCell className="text-right font-semibold">{fmtMoney(notas.reduce((s, x) => s + x.saldo, 0))}</TableCell>
                    <TableCell />
                  </TableRow>
                </TableFooter>
              )}
            </Table>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
