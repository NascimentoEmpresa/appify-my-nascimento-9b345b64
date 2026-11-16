import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { ExternalLink, Search, Tags, Undo2 } from "lucide-react";
import { NOME_MES_LONGO, competenciaDe } from "@/lib/oscFinanceiro";
import {
  OscPagamentoMalote, useOscComprometido, useOscDesfazerReclassificacao, useOscReclassificar, useOscSalvar,
} from "@/hooks/useOscCanaa";
import { CtxOsc, LINK_DESPESA_MALOTE, brl, dataBR, erroMsg, mesAno, nomeRubrica } from "./comum";

const STATUS_MALOTE: Record<string, string> = {
  pendente_aprovacao: "Pendente de aprovação",
  aguardando_pagamento: "Aguardando pagamento",
  pronto_para_pagar: "Pronto para pagar",
  ajuste_pagamento: "Ajuste de pagamento",
};

export function PagamentosOsc({ ctx }: { ctx: CtxOsc }) {
  const [mes, setMes] = useState("todos");
  const [rubrica, setRubrica] = useState("todas");
  const [busca, setBusca] = useState("");
  const [revisar, setRevisar] = useState<OscPagamentoMalote | null>(null);
  const desfazer = useOscDesfazerReclassificacao();
  const comprometido = useOscComprometido(ctx.parceria.id);

  const lista = useMemo(() => {
    const b = busca.trim().toLowerCase();
    return ctx.pagamentos
      .filter((p) => mes === "todos" || p.competencia === mes)
      .filter((p) => rubrica === "todas" || (rubrica === "sem" ? !p.rubrica_id && !p.ignorado : rubrica === "ignorados" ? p.ignorado : p.rubrica_id === rubrica))
      .filter((p) => !b || [p.id_malote, p.descricao, p.fornecedor, p.classificacao_nome, p.contrato_nome].some((x) => x?.toLowerCase().includes(b)))
      .sort((a, b2) => (b2.data_pagamento ?? "").localeCompare(a.data_pagamento ?? ""));
  }, [ctx.pagamentos, mes, rubrica, busca]);
  const total = lista.filter((p) => !p.ignorado).reduce((s, p) => s + p.valor, 0);
  const semRubrica = ctx.pagamentos.filter((p) => !p.rubrica_id && !p.ignorado).length;

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="space-y-3 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium">Pagamentos confirmados no Malote — {ctx.ano}</span>
            {semRubrica > 0 && (
              <Badge variant="outline" className="cursor-pointer border-amber-300 bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300" onClick={() => setRubrica("sem")}>
                {semRubrica} sem rubrica
              </Badge>
            )}
            <div className="ml-auto flex flex-wrap items-center gap-2">
              <div className="relative">
                <Search className="absolute left-2 top-2 h-4 w-4 text-muted-foreground" />
                <Input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar nº, descrição, fornecedor…" className="h-8 w-60 pl-7" />
              </div>
              <Select value={mes} onValueChange={setMes}>
                <SelectTrigger className="h-8 w-36"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos os meses</SelectItem>
                  {NOME_MES_LONGO.map((n, i) => <SelectItem key={i} value={competenciaDe(ctx.ano, i + 1)}>{n}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={rubrica} onValueChange={setRubrica}>
                <SelectTrigger className="h-8 w-48"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="todas">Todas as rubricas</SelectItem>
                  <SelectItem value="sem">Sem rubrica</SelectItem>
                  <SelectItem value="ignorados">Marcados "não é da OSC"</SelectItem>
                  {ctx.dados.rubricas.map((r) => <SelectItem key={r.id} value={r.id}>{r.nome}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="overflow-auto">
            <Table className="text-xs">
              <TableHeader>
                <TableRow>
                  <TableHead>Malote</TableHead>
                  <TableHead>Competência</TableHead>
                  <TableHead>Pago em</TableHead>
                  <TableHead>Descrição</TableHead>
                  <TableHead>Fornecedor</TableHead>
                  <TableHead>Classificação (Malote)</TableHead>
                  <TableHead>Rubrica OSC</TableHead>
                  <TableHead className="text-right">Valor</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {lista.length === 0 && <TableRow><TableCell colSpan={9} className="py-6 text-center text-muted-foreground">Nenhum pagamento.</TableCell></TableRow>}
                {lista.map((p) => {
                  const divergente = p.data_pagamento && p.data_pagamento.slice(0, 7) !== p.competencia.slice(0, 7);
                  return (
                    <TableRow key={p.chave} className={cn(p.ignorado && "opacity-50")}>
                      <TableCell className="whitespace-nowrap">
                        <Link to={LINK_DESPESA_MALOTE(p.despesa_id)} target="_blank" className="inline-flex items-center gap-1 text-primary hover:underline">
                          {p.id_malote ?? "abrir"}{p.numero_parcela ? ` (${p.numero_parcela}ª)` : ""}<ExternalLink className="h-3 w-3" />
                        </Link>
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {mesAno(p.competencia)}
                        {p.competencia !== p.competencia_malote && <span className="block text-[10px] text-muted-foreground">Malote: {mesAno(p.competencia_malote)}</span>}
                      </TableCell>
                      <TableCell className={cn("whitespace-nowrap", divergente && "text-amber-700 dark:text-amber-300")} title={divergente ? "Pago fora do mês da competência" : undefined}>{dataBR(p.data_pagamento)}</TableCell>
                      <TableCell className="max-w-[240px] truncate" title={p.descricao ?? ""}>{p.descricao}</TableCell>
                      <TableCell className="max-w-[160px] truncate" title={p.fornecedor ?? ""}>{p.fornecedor ?? "—"}</TableCell>
                      <TableCell>{p.classificacao_nome ?? "—"}</TableCell>
                      <TableCell>
                        {p.ignorado ? <Badge variant="outline">Não é da OSC</Badge>
                          : p.rubrica_id ? nomeRubrica(ctx, p.rubrica_id)
                            : <Badge variant="outline" className="border-amber-300 text-amber-800 dark:text-amber-300">Sem rubrica</Badge>}
                        {p.rubrica_origem === "reclassificado" && (
                          <span className="block text-[10px] text-muted-foreground" title={p.ajuste_motivo ?? ""}>revisado por {p.ajuste_por ?? "—"} em {dataBR(p.ajuste_em)}</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{brl(p.valor)}</TableCell>
                      <TableCell className="whitespace-nowrap text-right">
                        {ctx.perms.alterar && (
                          <Button size="icon" variant="ghost" className="h-7 w-7" title="Revisar classificação" onClick={() => setRevisar(p)}><Tags className="h-4 w-4" /></Button>
                        )}
                        {ctx.perms.alterar && p.ajuste_id && (
                          <Button size="icon" variant="ghost" className="h-7 w-7" title="Desfazer revisão"
                            onClick={async () => {
                              if (!window.confirm("Desfazer a revisão deste pagamento? Volta a valer o de-para.")) return;
                              try { await desfazer.mutateAsync(p.ajuste_id!); toast.success("Revisão desfeita."); } catch (e) { toast.error(erroMsg(e)); }
                            }}><Undo2 className="h-4 w-4" /></Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
          <p className="text-xs text-muted-foreground">
            {lista.length} linha(s) · total {brl(total)} (sem os marcados "não é da OSC"). A revisão não altera nada no Malote: fica registrada aqui com motivo, responsável e data.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Aprovado no Malote e ainda não pago (comprometido)</CardTitle></CardHeader>
        <CardContent>
          <Table className="text-xs">
            <TableHeader><TableRow><TableHead>Malote</TableHead><TableHead>Descrição</TableHead><TableHead>Status</TableHead><TableHead>Competência</TableHead><TableHead>Classificação</TableHead><TableHead className="text-right">Valor</TableHead></TableRow></TableHeader>
            <TableBody>
              {(comprometido.data ?? []).length === 0 && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">Nada aguardando pagamento.</TableCell></TableRow>}
              {(comprometido.data ?? []).map((c) => (
                <TableRow key={c.despesa_id}>
                  <TableCell><Link to={LINK_DESPESA_MALOTE(c.despesa_id)} target="_blank" className="text-primary hover:underline">{c.id_malote ?? "abrir"}</Link></TableCell>
                  <TableCell className="max-w-[260px] truncate">{c.descricao}</TableCell>
                  <TableCell>{STATUS_MALOTE[c.status] ?? c.status}</TableCell>
                  <TableCell>{mesAno(c.competencia)}</TableCell>
                  <TableCell>{c.classificacao_nome ?? "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">{brl(c.valor)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <p className="mt-2 text-xs text-muted-foreground">Informativo: só entra no saldo quando for pago. Solicitado/aprovado não equivale a pago.</p>
        </CardContent>
      </Card>

      {revisar && <RevisarPagamento ctx={ctx} pagamento={revisar} onClose={() => setRevisar(null)} />}
    </div>
  );
}

function RevisarPagamento({ ctx, pagamento, onClose }: { ctx: CtxOsc; pagamento: OscPagamentoMalote; onClose: () => void }) {
  const [modo, setModo] = useState<"este" | "depara">(pagamento.classificacao_id && !pagamento.rubrica_id ? "depara" : "este");
  const [rubricaId, setRubricaId] = useState(pagamento.rubrica_id ?? "");
  const [comp, setComp] = useState(pagamento.competencia.slice(0, 7));
  const [ignorar, setIgnorar] = useState(pagamento.ignorado);
  const [motivo, setMotivo] = useState(pagamento.ajuste_motivo ?? "");
  const reclass = useOscReclassificar();
  const salvarDePara = useOscSalvar("OSC_RUBRICA_CLASSIFICACAO", "parceria_id,classificacao_id");

  const ok = async () => {
    try {
      if (modo === "depara") {
        if (!rubricaId || !pagamento.classificacao_id) { toast.error("Escolha a rubrica."); return; }
        await salvarDePara.mutateAsync({ parceria_id: ctx.parceria.id, classificacao_id: pagamento.classificacao_id, rubrica_id: rubricaId });
        toast.success(`Classificação "${pagamento.classificacao_nome}" ligada à rubrica.`);
      } else {
        const compAlterada = comp && `${comp}-01` !== pagamento.competencia_malote ? `${comp}-01` : null;
        await reclass.mutateAsync({
          parceriaId: ctx.parceria.id, despesaId: pagamento.despesa_id, numeroParcela: pagamento.numero_parcela,
          classificacaoId: pagamento.classificacao_id, rubricaId: ignorar ? null : rubricaId || null,
          competencia: ignorar ? null : compAlterada, ignorar, motivo,
        });
        toast.success("Revisão registrada.");
      }
      onClose();
    } catch (e) { toast.error(erroMsg(e)); }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Revisar pagamento {pagamento.id_malote}</DialogTitle></DialogHeader>
        <p className="text-sm text-muted-foreground">{pagamento.descricao} · {brl(pagamento.valor)} · classificação {pagamento.classificacao_nome ?? "—"}</p>
        {pagamento.classificacao_id && (
          <RadioGroup value={modo} onValueChange={(v) => setModo(v as typeof modo)} className="gap-2">
            <label className="flex items-start gap-2 text-sm"><RadioGroupItem value="depara" className="mt-0.5" />
              <span>Toda a classificação <b>{pagamento.classificacao_nome}</b> vai para a rubrica (de-para — vale para os pagamentos atuais e futuros)</span></label>
            <label className="flex items-start gap-2 text-sm"><RadioGroupItem value="este" className="mt-0.5" />
              <span>Só este pagamento (exceção, com motivo)</span></label>
          </RadioGroup>
        )}
        <div className="grid gap-3">
          {!(modo === "este" && ignorar) && (
            <div>
              <Label>Rubrica OSC</Label>
              <Select value={rubricaId} onValueChange={setRubricaId}>
                <SelectTrigger><SelectValue placeholder="Escolha" /></SelectTrigger>
                <SelectContent>{ctx.dados.rubricas.filter((r) => r.ativo).map((r) => <SelectItem key={r.id} value={r.id}>{r.nome}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          )}
          {modo === "este" && (
            <>
              {!ignorar && (
                <div><Label>Competência</Label><Input type="month" value={comp} onChange={(e) => setComp(e.target.value)} /></div>
              )}
              <label className="flex items-center gap-2 text-sm"><Checkbox checked={ignorar} onCheckedChange={(v) => setIgnorar(!!v)} />Não é despesa da OSC (não entra no painel)</label>
              <div><Label>Motivo *</Label><Textarea value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={2} placeholder="Por que este pagamento muda de rubrica/competência?" /></div>
            </>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={ok} disabled={reclass.isPending || salvarDePara.isPending}>Salvar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
