import { useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { ExternalLink, Eye, Lock, Pencil, Unlock } from "lucide-react";
import { NOME_MES_LONGO, SEM_RUBRICA, type ResultadoMes, type SituacaoMes } from "@/lib/oscFinanceiro";
import { useOscDefinirSituacao, useOscSalvar } from "@/hooks/useOscCanaa";
import {
  CtxOsc, LINK_DESPESA_MALOTE, SituacaoBadge, brl, corValor, dataBR, erroMsg, nomeRubrica,
} from "./comum";

export function CompetenciasOsc({ ctx }: { ctx: CtxOsc }) {
  const r = ctx.resultado;
  const [filtro, setFiltro] = useState<"todas" | SituacaoMes>("todas");
  const [detalhe, setDetalhe] = useState<ResultadoMes | null>(null);
  const [editar, setEditar] = useState<ResultadoMes | null>(null);
  const situacao = useOscDefinirSituacao();
  const meses = r.meses.filter((m) => filtro === "todas" || m.situacao === filtro);
  const soma = (k: keyof ResultadoMes) => meses.reduce((s, m) => s + (m[k] as number), 0);

  const alternar = async (m: ResultadoMes) => {
    const fechar = m.situacao !== "fechada";
    if (!window.confirm(fechar
      ? `Fechar ${NOME_MES_LONGO[m.mes - 1]}? O mês passa a usar só o realizado e lançamentos nele exigem "aprovar".`
      : `Reabrir ${NOME_MES_LONGO[m.mes - 1]}?`)) return;
    try {
      await situacao.mutateAsync({ parceriaId: ctx.parceria.id, competencia: m.competencia, situacao: fechar ? "fechada" : "aberta" });
      toast.success(fechar ? "Competência fechada." : "Competência reaberta.");
    } catch (e) { toast.error(erroMsg(e)); }
  };

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">Resumo financeiro por competência — {ctx.ano}</span>
          <div className="ml-auto flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">Situação</span>
            <Select value={filtro} onValueChange={(v) => setFiltro(v as typeof filtro)}>
              <SelectTrigger className="h-8 w-36"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todas">Todas</SelectItem>
                <SelectItem value="fechada">Fechado</SelectItem>
                <SelectItem value="em_aberto">Em aberto</SelectItem>
                <SelectItem value="prevista">Previsto</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="overflow-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Mês</TableHead>
                <TableHead className="text-right">Repasse</TableHead>
                <TableHead className="text-right">Pago via Malote</TableHead>
                <TableHead className="text-right">Histórico / ajustes</TableHead>
                <TableHead className="text-right">Previsto</TableHead>
                <TableHead className="text-right">Despesas</TableHead>
                <TableHead className="text-right">Aplicação</TableHead>
                <TableHead className="text-right">Resgates</TableHead>
                <TableHead className="text-right">Saldo do mês</TableHead>
                <TableHead className="text-right">Saldo acumulado</TableHead>
                <TableHead className="text-right">Após projetos</TableHead>
                <TableHead>Status</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {meses.map((m) => (
                <TableRow key={m.mes}>
                  <TableCell className="font-medium">
                    {NOME_MES_LONGO[m.mes - 1]}
                    {m.fonteRealizado === "historico" && <Badge variant="outline" className="ml-1 px-1 py-0 text-[10px]">planilha</Badge>}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {brl(m.repasse)}{!m.repasseConfirmado && <span className="ml-0.5 text-muted-foreground" title="Repasse não confirmado (previsto)">*</span>}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{brl(m.pagoMalote)}</TableCell>
                  <TableCell className="text-right tabular-nums">{brl((m.fonteRealizado === "historico" ? m.historicoImportado : 0) + m.ajustesManuais)}</TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">{brl(m.previstoDespesas + m.previstoAplicacoes)}</TableCell>
                  <TableCell className="text-right tabular-nums">{brl(m.despesas)}</TableCell>
                  <TableCell className="text-right tabular-nums">{brl(m.aplicacoes)}</TableCell>
                  <TableCell className="text-right tabular-nums">{m.resgates ? brl(m.resgates) : "—"}</TableCell>
                  <TableCell className={cn("text-right tabular-nums", corValor(m.saldoMes))}>{brl(m.saldoMes)}</TableCell>
                  <TableCell className={cn("text-right font-medium tabular-nums", corValor(m.saldoAcumulado))}>{brl(m.saldoAcumulado)}</TableCell>
                  <TableCell className={cn("text-right tabular-nums", corValor(m.saldoAposProjetos))}>{brl(m.saldoAposProjetos)}</TableCell>
                  <TableCell><SituacaoBadge situacao={m.situacao} /></TableCell>
                  <TableCell className="whitespace-nowrap text-right">
                    <Button size="icon" variant="ghost" className="h-7 w-7" title="Detalhar" onClick={() => setDetalhe(m)}><Eye className="h-4 w-4" /></Button>
                    {ctx.perms.alterar && (m.situacao !== "fechada" || ctx.perms.aprovar) && (
                      <Button size="icon" variant="ghost" className="h-7 w-7" title="Repasse e fonte" onClick={() => setEditar(m)}><Pencil className="h-4 w-4" /></Button>
                    )}
                    {ctx.perms.aprovar && (
                      <Button size="icon" variant="ghost" className="h-7 w-7" title={m.situacao === "fechada" ? "Reabrir" : "Fechar competência"}
                        onClick={() => alternar(m)} disabled={situacao.isPending}>
                        {m.situacao === "fechada" ? <Unlock className="h-4 w-4" /> : <Lock className="h-4 w-4" />}
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell>Total</TableCell>
                <TableCell className="text-right tabular-nums">{brl(soma("repasse"))}</TableCell>
                <TableCell className="text-right tabular-nums">{brl(soma("pagoMalote"))}</TableCell>
                <TableCell />
                <TableCell className="text-right tabular-nums">{brl(soma("previstoDespesas") + soma("previstoAplicacoes"))}</TableCell>
                <TableCell className="text-right tabular-nums">{brl(soma("despesas"))}</TableCell>
                <TableCell className="text-right tabular-nums">{brl(soma("aplicacoes"))}</TableCell>
                <TableCell className="text-right tabular-nums">{brl(soma("resgates"))}</TableCell>
                <TableCell className="text-right tabular-nums">{brl(soma("saldoMes"))}</TableCell>
                <TableCell colSpan={4} />
              </TableRow>
            </TableFooter>
          </Table>
        </div>
        <p className="text-xs text-muted-foreground">
          * repasse não confirmado: usa o previsto. "Pago via Malote" é sempre mostrado para conciliar, mas só entra no cálculo nos meses com fonte Malote.
          Despesas e aplicação mostram o valor considerado (fechado = realizado; em aberto = maior entre realizado e previsto; previsto = custo de referência).
        </p>
      </CardContent>
      {detalhe && <DetalheMes ctx={ctx} mes={detalhe} onClose={() => setDetalhe(null)} />}
      {editar && <EditarCompetencia ctx={ctx} mes={editar} onClose={() => setEditar(null)} />}
    </Card>
  );
}

function DetalheMes({ ctx, mes, onClose }: { ctx: CtxOsc; mes: ResultadoMes; onClose: () => void }) {
  const pagamentos = ctx.pagamentos.filter((p) => p.competencia === mes.competencia);
  const lanc = ctx.dados.lancamentos.filter((l) => l.competencia === mes.competencia);
  const linhas = Object.entries(mes.porRubrica).sort((a, b) => b[1].considerado - a[1].considerado);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-4xl overflow-auto">
        <DialogHeader><DialogTitle>{NOME_MES_LONGO[mes.mes - 1]}/{ctx.ano} — memória de cálculo</DialogTitle></DialogHeader>
        <div className="grid gap-2 text-sm sm:grid-cols-4">
          <div><span className="text-muted-foreground">Situação:</span> <SituacaoBadge situacao={mes.situacao} /></div>
          <div><span className="text-muted-foreground">Fonte:</span> {mes.fonteRealizado === "historico" ? "Planilha (histórico)" : "Malote"}</div>
          <div><span className="text-muted-foreground">Repasse:</span> {brl(mes.repasse)} {mes.repasseConfirmado ? "(recebido)" : "(previsto)"}</div>
          <div><span className="text-muted-foreground">Saldo do mês:</span> <b className={corValor(mes.saldoMes)}>{brl(mes.saldoMes)}</b></div>
        </div>
        <p className="text-xs text-muted-foreground">
          Saldo do mês = repasse {brl(mes.repasse)} − despesas {brl(mes.despesas)} − aplicação {brl(mes.aplicacoes)} + resgates {brl(mes.resgates)}.
        </p>
        <Table>
          <TableHeader>
            <TableRow><TableHead>Rubrica</TableHead><TableHead className="text-right">Previsto</TableHead><TableHead className="text-right">Realizado</TableHead><TableHead className="text-right">Considerado</TableHead><TableHead className="text-right">Diferença</TableHead></TableRow>
          </TableHeader>
          <TableBody>
            {linhas.map(([id, v]) => (
              <TableRow key={id}>
                <TableCell className={cn(id === SEM_RUBRICA && "text-amber-700 dark:text-amber-300")}>{id.startsWith("__cenario") ? "Despesa simulada" : nomeRubrica(ctx, id)}</TableCell>
                <TableCell className="text-right tabular-nums">{brl(v.previsto)}</TableCell>
                <TableCell className="text-right tabular-nums">{brl(v.realizado)}</TableCell>
                <TableCell className="text-right font-medium tabular-nums">{brl(v.considerado)}</TableCell>
                <TableCell className={cn("text-right tabular-nums", v.realizado - v.previsto > 0 && "text-red-600")}>{brl(v.realizado - v.previsto)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <h4 className="mt-2 text-sm font-semibold">Pagamentos do Malote nesta competência ({pagamentos.length})</h4>
        <Table>
          <TableHeader><TableRow><TableHead>Malote</TableHead><TableHead>Descrição</TableHead><TableHead>Pago em</TableHead><TableHead>Classificação → Rubrica</TableHead><TableHead className="text-right">Valor</TableHead></TableRow></TableHeader>
          <TableBody>
            {pagamentos.length === 0 && <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">Nenhum pagamento.</TableCell></TableRow>}
            {pagamentos.map((p) => (
              <TableRow key={p.chave} className={cn(p.ignorado && "opacity-50 line-through")}>
                <TableCell><Link to={LINK_DESPESA_MALOTE(p.despesa_id)} target="_blank" className="inline-flex items-center gap-1 text-primary hover:underline">{p.id_malote ?? "abrir"}<ExternalLink className="h-3 w-3" /></Link></TableCell>
                <TableCell className="max-w-[260px] truncate" title={p.descricao ?? ""}>{p.descricao}</TableCell>
                <TableCell>{dataBR(p.data_pagamento)}</TableCell>
                <TableCell className="text-xs">{p.classificacao_nome ?? "—"} → {nomeRubrica(ctx, p.rubrica_id)}</TableCell>
                <TableCell className="text-right tabular-nums">{brl(p.valor)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {lanc.length > 0 && (
          <>
            <h4 className="mt-2 text-sm font-semibold">Lançamentos fora do Malote ({lanc.length})</h4>
            <Table>
              <TableHeader><TableRow><TableHead>Tipo</TableHead><TableHead>Rubrica</TableHead><TableHead>Descrição / origem</TableHead><TableHead className="text-right">Valor</TableHead></TableRow></TableHeader>
              <TableBody>
                {lanc.map((l) => (
                  <TableRow key={l.id} className={cn(l.tipo === "historico" && mes.fonteRealizado !== "historico" && "opacity-50")}>
                    <TableCell className="capitalize">{l.tipo === "historico" ? "histórico" : l.tipo}</TableCell>
                    <TableCell>{nomeRubrica(ctx, l.rubrica_id)}</TableCell>
                    <TableCell className="text-xs">{l.descricao}{l.origem_ref ? ` · ${l.origem_ref}` : ""}</TableCell>
                    <TableCell className="text-right tabular-nums">{brl(l.valor)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function EditarCompetencia({ ctx, mes, onClose }: { ctx: CtxOsc; mes: ResultadoMes; onClose: () => void }) {
  const atual = ctx.dados.competencias.find((c) => c.competencia === mes.competencia);
  const [previsto, setPrevisto] = useState(atual?.repasse_previsto?.toString() ?? "");
  const [recebido, setRecebido] = useState(atual?.repasse_recebido?.toString() ?? "");
  const [recebidoEm, setRecebidoEm] = useState(atual?.repasse_recebido_em ?? "");
  const [fonte, setFonte] = useState<"malote" | "historico">(atual?.fonte_realizado ?? "malote");
  const [obs, setObs] = useState(atual?.observacao ?? "");
  const salvar = useOscSalvar("OSC_COMPETENCIA", "parceria_id,competencia");
  const n = (s: string) => (s.trim() === "" ? null : Number(s.replace(",", ".")));

  const ok = async () => {
    try {
      await salvar.mutateAsync({
        parceria_id: ctx.parceria.id,
        competencia: mes.competencia,
        repasse_previsto: n(previsto),
        repasse_recebido: n(recebido),
        repasse_recebido_em: recebidoEm || null,
        fonte_realizado: fonte,
        observacao: obs.trim() || null,
      });
      toast.success("Competência salva.");
      onClose();
    } catch (e) { toast.error(erroMsg(e)); }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>{NOME_MES_LONGO[mes.mes - 1]}/{ctx.ano} — repasse e fonte do realizado</DialogTitle></DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div><Label>Repasse previsto</Label><Input type="number" step="0.01" value={previsto} onChange={(e) => setPrevisto(e.target.value)} placeholder={`padrão ${brl(ctx.parceria.repasse_mensal)}`} /></div>
          <div><Label>Repasse recebido</Label><Input type="number" step="0.01" value={recebido} onChange={(e) => setRecebido(e.target.value)} placeholder="vazio = não confirmado" /></div>
          <div><Label>Recebido em</Label><Input type="date" value={recebidoEm} onChange={(e) => setRecebidoEm(e.target.value)} /></div>
          <div>
            <Label>Fonte do realizado</Label>
            <Select value={fonte} onValueChange={(v) => setFonte(v as typeof fonte)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="malote">Malote (oficial)</SelectItem>
                <SelectItem value="historico">Planilha importada (histórico)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="sm:col-span-2"><Label>Observação</Label><Textarea value={obs} onChange={(e) => setObs(e.target.value)} rows={2} /></div>
        </div>
        <p className="text-xs text-muted-foreground">
          Pago no Malote nesta competência: {brl(mes.pagoMalote)} · histórico importado: {brl(mes.historicoImportado)}. Troque a fonte para Malote depois de conciliar.
        </p>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={ok} disabled={salvar.isPending}>Salvar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
