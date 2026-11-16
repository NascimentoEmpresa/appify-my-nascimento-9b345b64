import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { Plus, Trash2 } from "lucide-react";
import { NOME_MES_LONGO } from "@/lib/oscFinanceiro";
import { useOscExcluir, useOscSalvar, type OscLancamento } from "@/hooks/useOscCanaa";
import { CtxOsc, brl, erroMsg, mesAno, nomeRubrica } from "./comum";

const TIPO_LABEL: Record<string, string> = { historico: "Histórico (planilha)", ajuste: "Pago fora do Malote", resgate: "Resgate da reserva" };

export function ReservasOsc({ ctx }: { ctx: CtxOsc }) {
  const r = ctx.resultado;
  const [novo, setNovo] = useState<null | "ajuste" | "resgate">(null);
  const [tipo, setTipo] = useState("ajuste_resgate");
  const excluir = useOscExcluir("OSC_LANCAMENTO");
  const lancamentos = ctx.dados.lancamentos.filter((l) => tipo === "todos" || (tipo === "ajuste_resgate" ? l.tipo !== "historico" : l.tipo === tipo));
  const fechada = (comp: string) => ctx.dados.competencias.some((c) => c.competencia === comp && c.situacao === "fechada");

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Reserva para férias e 13º</CardTitle></CardHeader>
        <CardContent>
          <Table className="text-xs">
            <TableHeader>
              <TableRow><TableHead>Mês</TableHead><TableHead className="text-right">Aplicado</TableHead><TableHead className="text-right">Resgatado</TableHead><TableHead className="text-right">Reserva acumulada</TableHead></TableRow>
            </TableHeader>
            <TableBody>
              {r.meses.map((m) => (
                <TableRow key={m.mes} className={m.situacao === "prevista" ? "text-muted-foreground" : ""}>
                  <TableCell>{NOME_MES_LONGO[m.mes - 1]}{m.situacao === "prevista" && " (previsto)"}</TableCell>
                  <TableCell className="text-right tabular-nums">{brl(m.aplicacoes)}</TableCell>
                  <TableCell className="text-right tabular-nums">{m.resgates ? brl(m.resgates) : "—"}</TableCell>
                  <TableCell className="text-right font-medium tabular-nums">{brl(m.reservaAcumulada)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <p className="mt-2 text-xs text-muted-foreground">
            A aplicação sai do saldo livre mas não é despesa. Quando férias/13º/rescisão forem pagos com o dinheiro aplicado, registre o resgate:
            a despesa entra pelo Malote e o resgate volta como entrada — sem contar duas vezes. O total aplicado não equivale ao saldo bancário da aplicação (sem rendimentos).
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex flex-wrap items-center gap-2 text-base">
            Lançamentos fora do Malote
            <div className="ml-auto flex gap-2">
              <Select value={tipo} onValueChange={setTipo}>
                <SelectTrigger className="h-8 w-48"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ajuste_resgate">Ajustes e resgates</SelectItem>
                  <SelectItem value="historico">Histórico (planilha)</SelectItem>
                  <SelectItem value="todos">Todos</SelectItem>
                </SelectContent>
              </Select>
              {ctx.perms.incluir && (
                <>
                  <Button size="sm" variant="outline" className="h-8 gap-1" onClick={() => setNovo("resgate")}><Plus className="h-4 w-4" />Resgate</Button>
                  <Button size="sm" variant="outline" className="h-8 gap-1" onClick={() => setNovo("ajuste")}><Plus className="h-4 w-4" />Pago fora do Malote</Button>
                </>
              )}
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Table className="text-xs">
            <TableHeader><TableRow><TableHead>Competência</TableHead><TableHead>Tipo</TableHead><TableHead>Rubrica</TableHead><TableHead>Descrição / origem</TableHead><TableHead className="text-right">Valor</TableHead><TableHead /></TableRow></TableHeader>
            <TableBody>
              {lancamentos.length === 0 && <TableRow><TableCell colSpan={6} className="py-4 text-center text-muted-foreground">Nenhum lançamento.</TableCell></TableRow>}
              {lancamentos.map((l: OscLancamento) => (
                <TableRow key={l.id}>
                  <TableCell>{mesAno(l.competencia)}</TableCell>
                  <TableCell><Badge variant="outline">{TIPO_LABEL[l.tipo]}</Badge></TableCell>
                  <TableCell>{nomeRubrica(ctx, l.rubrica_id)}</TableCell>
                  <TableCell className="max-w-[320px] truncate" title={`${l.descricao ?? ""} ${l.origem_ref ?? ""}`}>{l.descricao}{l.origem_ref ? ` · ${l.origem_ref}` : ""}</TableCell>
                  <TableCell className="text-right tabular-nums">{brl(l.valor)}</TableCell>
                  <TableCell className="text-right">
                    {ctx.perms.excluir && (!fechada(l.competencia) || ctx.perms.aprovar) && (
                      <Button size="icon" variant="ghost" className="h-7 w-7" title="Excluir"
                        onClick={async () => {
                          if (!window.confirm("Excluir este lançamento?")) return;
                          try { await excluir.mutateAsync(l.id); toast.success("Lançamento excluído."); } catch (e) { toast.error(erroMsg(e)); }
                        }}><Trash2 className="h-4 w-4" /></Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      {novo && <NovoLancamento ctx={ctx} tipo={novo} onClose={() => setNovo(null)} />}
    </div>
  );
}

function NovoLancamento({ ctx, tipo, onClose }: { ctx: CtxOsc; tipo: "ajuste" | "resgate"; onClose: () => void }) {
  const opcoes = ctx.dados.rubricas.filter((r) => r.ativo && (tipo === "resgate" ? r.tipo === "reserva" : true));
  const [rubricaId, setRubricaId] = useState(opcoes[0]?.id ?? "");
  const [mes, setMes] = useState(`${ctx.ano}-${String(Math.min(Math.max(ctx.resultado.mesAtual, 1), 12)).padStart(2, "0")}`);
  const [valor, setValor] = useState("");
  const [descricao, setDescricao] = useState("");
  const salvar = useOscSalvar("OSC_LANCAMENTO");
  const ok = async () => {
    const v = Number(valor.replace(",", "."));
    if (!rubricaId || !v) { toast.error("Informe rubrica e valor."); return; }
    try {
      await salvar.mutateAsync({ parceria_id: ctx.parceria.id, competencia: `${mes}-01`, rubrica_id: rubricaId, tipo, valor: v, descricao: descricao.trim() || null });
      toast.success("Lançamento incluído.");
      onClose();
    } catch (e) { toast.error(erroMsg(e)); }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>{tipo === "resgate" ? "Resgate da reserva" : "Despesa paga fora do Malote"}</DialogTitle></DialogHeader>
        <div className="grid gap-3">
          <div>
            <Label>Rubrica</Label>
            <Select value={rubricaId} onValueChange={setRubricaId}>
              <SelectTrigger><SelectValue placeholder="Escolha" /></SelectTrigger>
              <SelectContent>{opcoes.map((r) => <SelectItem key={r.id} value={r.id}>{r.nome}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div><Label>Competência</Label><Input type="month" value={mes} onChange={(e) => setMes(e.target.value)} /></div>
          <div><Label>Valor (R$)</Label><Input type="number" step="0.01" value={valor} onChange={(e) => setValor(e.target.value)} />
            {tipo === "ajuste" && <span className="text-[11px] text-muted-foreground">Negativo para estorno/devolução fora do Malote.</span>}</div>
          <div><Label>Descrição</Label><Textarea rows={2} value={descricao} onChange={(e) => setDescricao(e.target.value)} placeholder={tipo === "resgate" ? "Ex.: resgate para pagar rescisões de agosto" : "Ex.: tarifa debitada direto na conta"} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={ok} disabled={salvar.isPending}>Incluir</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
