import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { Calculator, Pencil, Plus, Trash2 } from "lucide-react";
import { calcularOsc } from "@/lib/oscFinanceiro";
import { useOscExcluir, useOscSalvar, type OscProjeto } from "@/hooks/useOscCanaa";
import {
  CtxOsc, STATUS_PROJETO_CLASSE, STATUS_PROJETO_LABEL, brl, corValor, erroMsg, mesAno, nomeRubrica,
} from "./comum";

export function InvestimentosOsc({ ctx }: { ctx: CtxOsc }) {
  const [editar, setEditar] = useState<Partial<OscProjeto> | null>(null);
  const [simular, setSimular] = useState<OscProjeto | null>(null);
  const excluir = useOscExcluir("OSC_PROJETO");
  const r = ctx.resultado;
  const projetos = ctx.dados.projetos;
  const somaStatus = (s: string) => projetos.filter((p) => p.status === s).reduce((t, p) => t + p.valor_estimado, 0);

  // impacto de cada projeto: saldo de dezembro sem ele − com ele
  const semProjeto = (p: OscProjeto) => calcularOsc({ ...ctx.entrada, projetos: ctx.entrada.projetos.filter((x) => x !== (p as unknown)) });

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-4">
        <Mini titulo="Saldo projetado dezembro" valor={r.saldoProjetadoDezembro} />
        <Mini titulo="Aprovados" valor={somaStatus("aprovado")} neutro />
        <Mini titulo="Pendentes" valor={somaStatus("pendente")} neutro />
        <Mini titulo="Saldo livre após projetos" valor={r.saldoLivre} />
      </div>
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center text-base">
            Planejamento de investimentos — escola infantil
            {ctx.perms.incluir && (
              <Button size="sm" className="ml-auto h-8 gap-1" onClick={() => setEditar({ status: "pendente" })}><Plus className="h-4 w-4" />Novo projeto</Button>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Table className="text-sm">
            <TableHeader>
              <TableRow><TableHead>Projeto</TableHead><TableHead>Descrição</TableHead><TableHead>Rubrica</TableHead><TableHead>Mês previsto</TableHead><TableHead className="text-right">Valor estimado</TableHead><TableHead>Status</TableHead><TableHead /></TableRow>
            </TableHeader>
            <TableBody>
              {projetos.length === 0 && <TableRow><TableCell colSpan={7} className="py-6 text-center text-muted-foreground">Nenhum projeto planejado.</TableCell></TableRow>}
              {projetos.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="font-medium">{p.nome}</TableCell>
                  <TableCell className="max-w-[280px] text-xs text-muted-foreground">{p.descricao}</TableCell>
                  <TableCell className="text-xs">{p.rubrica_id ? nomeRubrica(ctx, p.rubrica_id) : "—"}</TableCell>
                  <TableCell className="text-xs">{p.competencia_prevista ? mesAno(p.competencia_prevista) : "Sem mês (dez.)"}</TableCell>
                  <TableCell className="text-right tabular-nums">{brl(p.valor_estimado)}</TableCell>
                  <TableCell><Badge variant="outline" className={cn("border", STATUS_PROJETO_CLASSE[p.status])}>{STATUS_PROJETO_LABEL[p.status]}</Badge></TableCell>
                  <TableCell className="whitespace-nowrap text-right">
                    <Button size="icon" variant="ghost" className="h-7 w-7" title="Simular impacto" onClick={() => setSimular(p)}><Calculator className="h-4 w-4" /></Button>
                    {ctx.perms.alterar && <Button size="icon" variant="ghost" className="h-7 w-7" title="Editar" onClick={() => setEditar(p)}><Pencil className="h-4 w-4" /></Button>}
                    {ctx.perms.excluir && (
                      <Button size="icon" variant="ghost" className="h-7 w-7" title="Excluir" onClick={async () => {
                        if (!window.confirm(`Excluir o projeto "${p.nome}"?`)) return;
                        try { await excluir.mutateAsync(p.id); toast.success("Projeto excluído."); } catch (e) { toast.error(erroMsg(e)); }
                      }}><Trash2 className="h-4 w-4" /></Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
            {projetos.length > 0 && (
              <TableFooter>
                <TableRow><TableCell colSpan={4}>Total (sem cancelados)</TableCell>
                  <TableCell className="text-right tabular-nums">{brl(projetos.filter((p) => p.status !== "cancelado").reduce((s, p) => s + p.valor_estimado, 0))}</TableCell>
                  <TableCell colSpan={2} /></TableRow>
              </TableFooter>
            )}
          </Table>
          <p className="mt-2 text-xs text-muted-foreground">
            Pendentes e aprovados abatem do saldo projetado no mês previsto (sem mês = dezembro). Executado = já pago pelo Malote, não abate de novo.
            O uso do saldo deve obedecer ao instrumento de parceria, ao plano de trabalho e às regras de prestação de contas.
          </p>
        </CardContent>
      </Card>
      {editar && <EditarProjeto ctx={ctx} projeto={editar} onClose={() => setEditar(null)} />}
      {simular && (
        <Dialog open onOpenChange={(o) => !o && setSimular(null)}>
          <DialogContent className="max-w-md">
            <DialogHeader><DialogTitle>Impacto de “{simular.nome}”</DialogTitle></DialogHeader>
            {(() => {
              const sem = semProjeto(simular);
              const contaHoje = simular.status === "pendente" || simular.status === "aprovado";
              const comProjeto = contaHoje ? r : calcularOsc({ ...ctx.entrada, projetos: [...ctx.entrada.projetos.filter((x) => x !== (simular as unknown)), { ...simular, status: "aprovado" }] });
              return (
                <div className="space-y-2 text-sm">
                  <Linha rotulo="Saldo livre sem o projeto" valor={sem.saldoLivre} />
                  <Linha rotulo="Saldo livre com o projeto" valor={comProjeto.saldoLivre} />
                  <Linha rotulo="Menor saldo após projetos no ano" valor={Math.min(...comProjeto.meses.map((m) => m.saldoAposProjetos))} />
                  {comProjeto.saldoLivre < 0 && <p className="text-xs text-red-600">Com este projeto o saldo de dezembro fica negativo.</p>}
                </div>
              );
            })()}
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

function Linha({ rotulo, valor }: { rotulo: string; valor: number }) {
  return <div className="flex justify-between"><span className="text-muted-foreground">{rotulo}</span><b className={cn("tabular-nums", corValor(valor))}>{brl(valor)}</b></div>;
}
function Mini({ titulo, valor, neutro }: { titulo: string; valor: number; neutro?: boolean }) {
  return (
    <div className="rounded-md border bg-card p-3">
      <div className="text-xs text-muted-foreground">{titulo}</div>
      <div className={cn("text-lg font-semibold tabular-nums", !neutro && corValor(valor))}>{brl(valor)}</div>
    </div>
  );
}

function EditarProjeto({ ctx, projeto, onClose }: { ctx: CtxOsc; projeto: Partial<OscProjeto>; onClose: () => void }) {
  const [nome, setNome] = useState(projeto.nome ?? "");
  const [descricao, setDescricao] = useState(projeto.descricao ?? "");
  const [rubricaId, setRubricaId] = useState(projeto.rubrica_id ?? "nenhuma");
  const [valor, setValor] = useState(projeto.valor_estimado?.toString() ?? "");
  const [mes, setMes] = useState(projeto.competencia_prevista?.slice(0, 7) ?? "");
  const [status, setStatus] = useState(projeto.status ?? "pendente");
  const [obs, setObs] = useState(projeto.observacao ?? "");
  const salvar = useOscSalvar("OSC_PROJETO");
  const ok = async () => {
    const v = Number(valor.replace(",", "."));
    if (!nome.trim() || !(v >= 0)) { toast.error("Informe nome e valor."); return; }
    try {
      await salvar.mutateAsync({
        ...(projeto.id ? { id: projeto.id } : { parceria_id: ctx.parceria.id }),
        nome: nome.trim(), descricao: descricao.trim() || null, rubrica_id: rubricaId === "nenhuma" ? null : rubricaId,
        valor_estimado: v, competencia_prevista: mes ? `${mes}-01` : null, status, observacao: obs.trim() || null,
      });
      toast.success("Projeto salvo.");
      onClose();
    } catch (e) { toast.error(erroMsg(e)); }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>{projeto.id ? "Editar projeto" : "Novo projeto"}</DialogTitle></DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2"><Label>Projeto *</Label><Input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex.: Materiais pedagógicos" /></div>
          <div className="sm:col-span-2"><Label>Descrição</Label><Textarea rows={2} value={descricao} onChange={(e) => setDescricao(e.target.value)} placeholder="Ex.: livros, brinquedos e recursos didáticos" /></div>
          <div><Label>Valor estimado (R$) *</Label><Input type="number" step="0.01" value={valor} onChange={(e) => setValor(e.target.value)} /></div>
          <div><Label>Mês previsto</Label><Input type="month" value={mes} onChange={(e) => setMes(e.target.value)} /></div>
          <div>
            <Label>Rubrica do plano de trabalho</Label>
            <Select value={rubricaId} onValueChange={setRubricaId}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="nenhuma">—</SelectItem>
                {ctx.dados.rubricas.filter((r) => r.tipo === "despesa").map((r) => <SelectItem key={r.id} value={r.id}>{r.nome}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Status</Label>
            <Select value={status} onValueChange={(v) => setStatus(v as OscProjeto["status"])}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.entries(STATUS_PROJETO_LABEL).map(([k, v]) => <SelectItem key={k} value={k} disabled={k === "aprovado" && !ctx.perms.aprovar && projeto.status !== "aprovado"}>{v}</SelectItem>)}
              </SelectContent>
            </Select>
            {!ctx.perms.aprovar && <span className="text-[11px] text-muted-foreground">Aprovar projeto exige a permissão "aprovar".</span>}
          </div>
          <div className="sm:col-span-2"><Label>Observação</Label><Textarea rows={2} value={obs} onChange={(e) => setObs(e.target.value)} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={ok} disabled={salvar.isPending}>Salvar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
