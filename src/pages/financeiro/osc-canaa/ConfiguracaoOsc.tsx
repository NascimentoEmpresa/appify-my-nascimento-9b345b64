import { useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { CalendarRange, FileSpreadsheet, Pencil, Plus, Trash2, Upload } from "lucide-react";
import {
  NOME_MES, NOME_MES_LONGO, competenciaDe, lerLinhasImportacao, normalizarNome, type LinhaImportacaoOsc,
} from "@/lib/oscFinanceiro";
import {
  useOscClassificacoes, useOscContratos, useOscEmpresas, useOscExcluir, useOscImportarHistorico, useOscSalvar,
  type OscRubrica,
} from "@/hooks/useOscCanaa";
import { CRITERIO_LABEL, CtxOsc, GRUPO_LABEL, brl, erroMsg } from "./comum";

export function ConfiguracaoOsc({ ctx }: { ctx: CtxOsc }) {
  const ro = !ctx.perms.alterar;
  return (
    <div className="space-y-4">
      {ro && <p className="text-sm text-muted-foreground">Somente leitura — editar o plano de trabalho exige a permissão "alterar".</p>}
      <ParceriaAno ctx={ctx} ro={ro} />
      <RubricasPrevisao ctx={ctx} ro={ro} />
      <DePara ctx={ctx} ro={ro} />
      {ctx.perms.incluir && ctx.perms.alterar && <Importacao ctx={ctx} />}
    </div>
  );
}

function ParceriaAno({ ctx, ro }: { ctx: CtxOsc; ro: boolean }) {
  const p = ctx.parceria;
  const a = ctx.dados.ano;
  const [nome, setNome] = useState(p.nome);
  const [empresaId, setEmpresaId] = useState(p.empresa_id ?? "");
  const [contratos, setContratos] = useState<string[]>(p.contrato_ids ?? []);
  const [repasse, setRepasse] = useState(String(p.repasse_mensal));
  const [obs, setObs] = useState(p.observacao ?? "");
  const [saldoInicial, setSaldoInicial] = useState(String(a?.saldo_inicial ?? 0));
  const [reservaExtra, setReservaExtra] = useState(String(a?.reserva_extra ?? 0));
  const [premissas, setPremissas] = useState(a?.premissas ?? "");
  const empresas = useOscEmpresas();
  const listaContratos = useOscContratos(empresaId || null);
  const salvarParceria = useOscSalvar("OSC_PARCERIA");
  const salvarAno = useOscSalvar("OSC_ANO", "parceria_id,ano");
  const num = (s: string) => Number(String(s).replace(",", ".")) || 0;

  const salvar = async () => {
    try {
      await salvarParceria.mutateAsync({ id: p.id, nome: nome.trim(), empresa_id: empresaId || null, contrato_ids: contratos.length ? contratos : null, repasse_mensal: num(repasse), observacao: obs.trim() || null });
      await salvarAno.mutateAsync({ ...(a ? { id: a.id } : { parceria_id: p.id, ano: ctx.ano }), saldo_inicial: num(saldoInicial), reserva_extra: num(reservaExtra), premissas: premissas.trim() || null });
      toast.success("Parceria e premissas salvas.");
    } catch (e) { toast.error(erroMsg(e)); }
  };

  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-base">Parceria e premissas de {ctx.ano}</CardTitle></CardHeader>
      <CardContent className="grid gap-3 md:grid-cols-3">
        <div><Label>Nome</Label><Input disabled={ro} value={nome} onChange={(e) => setNome(e.target.value)} /></div>
        <div>
          <Label>Empresa no Malote</Label>
          <Select disabled={ro} value={empresaId} onValueChange={(v) => { setEmpresaId(v); setContratos([]); }}>
            <SelectTrigger><SelectValue placeholder="Escolha" /></SelectTrigger>
            <SelectContent>{(empresas.data ?? []).map((e) => <SelectItem key={e.id} value={e.id}>{e.codigo} — {e.nome_fantasia ?? e.razao_social}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div><Label>Repasse mensal (R$)</Label><Input disabled={ro} type="number" step="0.01" value={repasse} onChange={(e) => setRepasse(e.target.value)} /></div>
        <div className="md:col-span-3">
          <Label>Contratos da OSC (vazio = todos os da empresa)</Label>
          <div className="mt-1 flex max-h-32 flex-wrap gap-x-4 gap-y-1 overflow-auto rounded-md border p-2 text-xs">
            {(listaContratos.data ?? []).length === 0 && <span className="text-muted-foreground">Nenhum contrato na empresa.</span>}
            {(listaContratos.data ?? []).map((c) => (
              <label key={c.id} className="flex items-center gap-1.5">
                <Checkbox disabled={ro} checked={contratos.includes(c.id)}
                  onCheckedChange={(v) => setContratos((l) => (v ? [...l, c.id] : l.filter((x) => x !== c.id)))} />
                {c.nome}
              </label>
            ))}
          </div>
        </div>
        <div><Label>Saldo inicial do ano (R$)</Label><Input disabled={ro} type="number" step="0.01" value={saldoInicial} onChange={(e) => setSaldoInicial(e.target.value)} /></div>
        <div><Label>Reserva extra a confirmar (R$)</Label><Input disabled={ro} type="number" step="0.01" value={reservaExtra} onChange={(e) => setReservaExtra(e.target.value)} />
          <span className="text-[11px] text-muted-foreground">compromissos ainda não lançados; abate do saldo livre</span></div>
        <div><Label>Observação da parceria</Label><Input disabled={ro} value={obs} onChange={(e) => setObs(e.target.value)} /></div>
        <div className="md:col-span-3"><Label>Premissas da projeção (aparecem na exportação)</Label><Textarea disabled={ro} rows={4} value={premissas} onChange={(e) => setPremissas(e.target.value)} /></div>
        {!ro && <div className="md:col-span-3"><Button onClick={salvar} disabled={salvarParceria.isPending || salvarAno.isPending}>Salvar</Button></div>}
      </CardContent>
    </Card>
  );
}

function RubricasPrevisao({ ctx, ro }: { ctx: CtxOsc; ro: boolean }) {
  const [editar, setEditar] = useState<Partial<OscRubrica> | null>(null);
  const [meses, setMeses] = useState<OscRubrica | null>(null);
  const excluir = useOscExcluir("OSC_RUBRICA");
  const ref = ctx.resultado.mesReferencia ?? 12;
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center text-base">
          Plano de trabalho — rubricas e custo de referência
          {!ro && <Button size="sm" className="ml-auto h-8 gap-1" onClick={() => setEditar({ grupo: "outros", tipo: "despesa", ativo: true })}><Plus className="h-4 w-4" />Rubrica</Button>}
        </CardTitle>
      </CardHeader>
      <CardContent className="overflow-auto">
        <Table className="text-xs">
          <TableHeader>
            <TableRow>
              <TableHead>Rubrica</TableHead><TableHead>Categoria</TableHead><TableHead>Critério</TableHead>
              <TableHead className="text-right">Base mensal</TableHead><TableHead className="text-right">Ajuste</TableHead>
              <TableHead className="text-right">Previsto {NOME_MES[ref - 1]}</TableHead><TableHead className="text-right">Meses com valor próprio</TableHead><TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {ctx.dados.rubricas.map((r) => {
              const p = ctx.dados.previsoes.find((x) => x.rubrica_id === r.id);
              const overrides = ctx.dados.previsoesMes.filter((x) => x.rubrica_id === r.id).length;
              return (
                <TableRow key={r.id} className={cn(!r.ativo && "opacity-50")}>
                  <TableCell className="font-medium">{r.nome}{r.recorrente && <span className="ml-1 text-[10px] text-muted-foreground">recorrente</span>}</TableCell>
                  <TableCell>{GRUPO_LABEL[r.grupo] ?? r.grupo}</TableCell>
                  <TableCell>{p ? CRITERIO_LABEL[p.criterio] : "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">{p ? brl(p.base_mensal) : "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">{p?.ajuste_pct ? `${(p.ajuste_pct * 100).toLocaleString("pt-BR")}%` : "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">{brl(ctx.resultado.meses[ref - 1].porRubrica[r.id]?.previsto ?? 0)}</TableCell>
                  <TableCell className="text-right">{overrides || "—"}</TableCell>
                  <TableCell className="whitespace-nowrap text-right">
                    <Button size="icon" variant="ghost" className="h-7 w-7" title="Previsto mês a mês" onClick={() => setMeses(r)}><CalendarRange className="h-4 w-4" /></Button>
                    {!ro && <Button size="icon" variant="ghost" className="h-7 w-7" title="Editar" onClick={() => setEditar(r)}><Pencil className="h-4 w-4" /></Button>}
                    {!ro && ctx.perms.excluir && (
                      <Button size="icon" variant="ghost" className="h-7 w-7" title="Excluir" onClick={async () => {
                        if (!window.confirm(`Excluir a rubrica "${r.nome}"? Se houver lançamentos nela, desative em vez de excluir.`)) return;
                        try { await excluir.mutateAsync(r.id); toast.success("Rubrica excluída."); } catch (e) { toast.error(`Não foi possível excluir (há lançamentos?). ${erroMsg(e)}`); }
                      }}><Trash2 className="h-4 w-4" /></Button>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        <p className="mt-2 text-xs text-muted-foreground">
          Critério "último mês fechado"/"média" recalcula a base sozinho quando um mês é fechado; "valor fixo" usa a base digitada. O valor próprio de um mês prevalece sobre o critério.
        </p>
      </CardContent>
      {editar && <EditarRubrica ctx={ctx} rubrica={editar} onClose={() => setEditar(null)} />}
      {meses && <PrevisaoMeses ctx={ctx} rubrica={meses} ro={ro} onClose={() => setMeses(null)} />}
    </Card>
  );
}

function EditarRubrica({ ctx, rubrica, onClose }: { ctx: CtxOsc; rubrica: Partial<OscRubrica>; onClose: () => void }) {
  const prev = rubrica.id ? ctx.dados.previsoes.find((p) => p.rubrica_id === rubrica.id) : undefined;
  const [nome, setNome] = useState(rubrica.nome ?? "");
  const [grupo, setGrupo] = useState(rubrica.grupo ?? "outros");
  const [tipo, setTipo] = useState(rubrica.tipo ?? "despesa");
  const [recorrente, setRecorrente] = useState(rubrica.recorrente ?? false);
  const [ativo, setAtivo] = useState(rubrica.ativo ?? true);
  const [ordem, setOrdem] = useState(String(rubrica.ordem ?? (ctx.dados.rubricas.length + 1) * 10));
  const [criterio, setCriterio] = useState(prev?.criterio ?? "manual");
  const [base, setBase] = useState(String(prev?.base_mensal ?? 0));
  const [ajuste, setAjuste] = useState(String((prev?.ajuste_pct ?? 0) * 100));
  const salvarRub = useOscSalvar("OSC_RUBRICA");
  const salvarPrev = useOscSalvar("OSC_PREVISAO", "rubrica_id,ano");
  const ok = async () => {
    if (!nome.trim()) { toast.error("Informe o nome."); return; }
    try {
      const id = await salvarRub.mutateAsync({
        ...(rubrica.id ? { id: rubrica.id } : { parceria_id: ctx.parceria.id }),
        nome: nome.trim(), grupo, tipo, recorrente, ativo, ordem: Number(ordem) || 0,
      });
      if (!id) throw new Error("Rubrica não foi salva.");
      await salvarPrev.mutateAsync({
        ...(prev ? { id: prev.id } : { parceria_id: ctx.parceria.id, rubrica_id: id, ano: ctx.ano }),
        criterio, base_mensal: Number(base.replace(",", ".")) || 0, ajuste_pct: (Number(ajuste.replace(",", ".")) || 0) / 100,
      });
      toast.success("Rubrica salva.");
      onClose();
    } catch (e) { toast.error(erroMsg(e)); }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>{rubrica.id ? "Editar rubrica" : "Nova rubrica"}</DialogTitle></DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2"><Label>Nome *</Label><Input value={nome} onChange={(e) => setNome(e.target.value)} /></div>
          <div>
            <Label>Categoria</Label>
            <Select value={grupo} onValueChange={setGrupo}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{Object.entries(GRUPO_LABEL).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label>Tipo</Label>
            <Select value={tipo} onValueChange={(v) => setTipo(v as OscRubrica["tipo"])}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="despesa">Despesa</SelectItem>
                <SelectItem value="reserva">Reserva/aplicação (não é despesa)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Critério do custo de referência ({ctx.ano})</Label>
            <Select value={criterio} onValueChange={(v) => setCriterio(v as typeof criterio)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{Object.entries(CRITERIO_LABEL).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div><Label>Base mensal (R$)</Label><Input type="number" step="0.01" value={base} onChange={(e) => setBase(e.target.value)} />
            <span className="text-[11px] text-muted-foreground">usada no "valor fixo" ou sem mês fechado</span></div>
          <div><Label>Ajuste (%)</Label><Input type="number" step="0.1" value={ajuste} onChange={(e) => setAjuste(e.target.value)} /></div>
          <div><Label>Ordem</Label><Input type="number" value={ordem} onChange={(e) => setOrdem(e.target.value)} /></div>
          <label className="flex items-center gap-2 text-sm"><Checkbox checked={recorrente} onCheckedChange={(v) => setRecorrente(!!v)} />Custo recorrente</label>
          <label className="flex items-center gap-2 text-sm"><Checkbox checked={ativo} onCheckedChange={(v) => setAtivo(!!v)} />Ativa</label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={ok} disabled={salvarRub.isPending || salvarPrev.isPending}>Salvar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PrevisaoMeses({ ctx, rubrica, ro, onClose }: { ctx: CtxOsc; rubrica: OscRubrica; ro: boolean; onClose: () => void }) {
  const atuais = ctx.dados.previsoesMes.filter((p) => p.rubrica_id === rubrica.id);
  const [valores, setValores] = useState<Record<number, string>>(() => {
    const v: Record<number, string> = {};
    for (const p of atuais) v[Number(p.competencia.slice(5, 7))] = String(p.valor);
    return v;
  });
  const salvar = useOscSalvar("OSC_PREVISAO_MES", "rubrica_id,competencia");
  const excluir = useOscExcluir("OSC_PREVISAO_MES");
  const ok = async () => {
    try {
      for (let m = 1; m <= 12; m++) {
        const comp = competenciaDe(ctx.ano, m);
        const atual = atuais.find((p) => p.competencia === comp);
        const txt = (valores[m] ?? "").trim();
        if (txt === "") { if (atual) await excluir.mutateAsync(atual.id); continue; }
        const v = Number(txt.replace(",", "."));
        if (!Number.isFinite(v)) continue;
        if (!atual || atual.valor !== v) await salvar.mutateAsync({ parceria_id: ctx.parceria.id, rubrica_id: rubrica.id, competencia: comp, valor: v });
      }
      toast.success("Previsão mensal salva.");
      onClose();
    } catch (e) { toast.error(erroMsg(e)); }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>{rubrica.nome} — previsto mês a mês ({ctx.ano})</DialogTitle></DialogHeader>
        <p className="text-xs text-muted-foreground">Vazio = usa o critério da rubrica. Preencha só os meses com valor diferente (ex.: reajuste de aluguel, parcela de 13º).</p>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {NOME_MES_LONGO.map((n, i) => {
            const m = ctx.resultado.meses[i];
            const obs = atuais.find((p) => Number(p.competencia.slice(5, 7)) === i + 1)?.observacao;
            return (
              <div key={i}>
                <Label className="text-xs">{n} <span className="text-muted-foreground">({m.situacao === "fechada" ? "fechado" : brl(m.porRubrica[rubrica.id]?.previsto ?? 0)})</span></Label>
                <Input disabled={ro} className="h-8" type="number" step="0.01" value={valores[i + 1] ?? ""} title={obs ?? undefined}
                  onChange={(e) => setValores((v) => ({ ...v, [i + 1]: e.target.value }))} />
              </div>
            );
          })}
        </div>
        {atuais.some((p) => p.observacao) && (
          <ul className="list-disc pl-5 text-xs text-muted-foreground">
            {atuais.filter((p) => p.observacao).map((p) => <li key={p.id}>{NOME_MES_LONGO[Number(p.competencia.slice(5, 7)) - 1]}: {p.observacao}</li>)}
          </ul>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Fechar</Button>
          {!ro && <Button onClick={ok} disabled={salvar.isPending || excluir.isPending}>Salvar</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DePara({ ctx, ro }: { ctx: CtxOsc; ro: boolean }) {
  const classificacoes = useOscClassificacoes();
  const [classId, setClassId] = useState("");
  const [rubId, setRubId] = useState("");
  const salvar = useOscSalvar("OSC_RUBRICA_CLASSIFICACAO", "parceria_id,classificacao_id");
  const excluir = useOscExcluir("OSC_RUBRICA_CLASSIFICACAO");
  const nomeClass = (id: string) => classificacoes.data?.find((c) => c.id === id)?.nome ?? "—";
  const semRubrica = useMemo(() => {
    const m = new Map<string, { nome: string; total: number; n: number }>();
    for (const p of ctx.pagamentos) {
      if (p.rubrica_id || p.ignorado || !p.classificacao_id) continue;
      const x = m.get(p.classificacao_id) ?? { nome: p.classificacao_nome ?? "—", total: 0, n: 0 };
      x.total += p.valor; x.n += 1;
      m.set(p.classificacao_id, x);
    }
    return [...m.entries()].sort((a, b) => b[1].total - a[1].total);
  }, [ctx.pagamentos]);
  const adicionar = async (c = classId, r = rubId) => {
    if (!c || !r) { toast.error("Escolha classificação e rubrica."); return; }
    try { await salvar.mutateAsync({ parceria_id: ctx.parceria.id, classificacao_id: c, rubrica_id: r }); setClassId(""); toast.success("De-para salvo."); } catch (e) { toast.error(erroMsg(e)); }
  };
  const ordenado = [...ctx.dados.depara].sort((a, b) => nomeClass(a.classificacao_id).localeCompare(nomeClass(b.classificacao_id)));
  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-base">De-para: classificação do Malote → rubrica OSC</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        {semRubrica.length > 0 && (
          <div className="rounded-md border border-amber-300 bg-amber-50 p-2 text-xs dark:border-amber-900 dark:bg-amber-950/40">
            <b>Classificações pagas sem rubrica em {ctx.ano}:</b>
            <ul className="mt-1 space-y-1">
              {semRubrica.map(([id, x]) => (
                <li key={id} className="flex flex-wrap items-center gap-2">
                  <span className="min-w-[180px]">{x.nome} — {x.n} pagamento(s), {brl(x.total)}</span>
                  {!ro && (
                    <Select onValueChange={(r) => adicionar(id, r)}>
                      <SelectTrigger className="h-7 w-56 bg-background"><SelectValue placeholder="Ligar à rubrica…" /></SelectTrigger>
                      <SelectContent>{ctx.dados.rubricas.filter((r) => r.ativo).map((r) => <SelectItem key={r.id} value={r.id}>{r.nome}</SelectItem>)}</SelectContent>
                    </Select>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
        {!ro && (
          <div className="flex flex-wrap items-end gap-2">
            <div className="w-72">
              <Label className="text-xs">Classificação do Malote</Label>
              <SearchableSelect value={classId} onChange={setClassId} placeholder="Buscar classificação…"
                options={(classificacoes.data ?? []).map((c) => ({ value: c.id, label: c.nome, muted: !c.ativo }))} />
            </div>
            <div className="w-60">
              <Label className="text-xs">Rubrica OSC</Label>
              <Select value={rubId} onValueChange={setRubId}>
                <SelectTrigger><SelectValue placeholder="Escolha" /></SelectTrigger>
                <SelectContent>{ctx.dados.rubricas.filter((r) => r.ativo).map((r) => <SelectItem key={r.id} value={r.id}>{r.nome}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <Button onClick={() => adicionar()} disabled={salvar.isPending}><Plus className="mr-1 h-4 w-4" />Ligar</Button>
          </div>
        )}
        <Table className="text-xs">
          <TableHeader><TableRow><TableHead>Classificação (Malote)</TableHead><TableHead>Rubrica OSC</TableHead><TableHead /></TableRow></TableHeader>
          <TableBody>
            {ordenado.length === 0 && <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground">Nenhuma ligação. Todo pagamento da OSC cai em "Sem rubrica".</TableCell></TableRow>}
            {ordenado.map((d) => (
              <TableRow key={d.id}>
                <TableCell>{nomeClass(d.classificacao_id)}</TableCell>
                <TableCell>{ctx.dados.rubricas.find((r) => r.id === d.rubrica_id)?.nome ?? "—"}</TableCell>
                <TableCell className="text-right">
                  {!ro && <Button size="icon" variant="ghost" className="h-7 w-7" onClick={async () => {
                    try { await excluir.mutateAsync(d.id); toast.success("Ligação removida."); } catch (e) { toast.error(erroMsg(e)); }
                  }}><Trash2 className="h-4 w-4" /></Button>}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function Importacao({ ctx }: { ctx: CtxOsc }) {
  const [arquivo, setArquivo] = useState<XLSX.WorkBook | null>(null);
  const [nomeArquivo, setNomeArquivo] = useState("");
  const [aba, setAba] = useState("");
  const [usarComoRealizado, setUsarComoRealizado] = useState(true);
  const [criarRubricas, setCriarRubricas] = useState(false);
  const importar = useOscImportarHistorico();

  const leitura = useMemo(() => {
    if (!arquivo || !aba) return null;
    const matriz = XLSX.utils.sheet_to_json<unknown[]>(arquivo.Sheets[aba], { header: 1, raw: true, defval: null });
    return lerLinhasImportacao(matriz, ctx.ano);
  }, [arquivo, aba, ctx.ano]);

  const conhecidas = new Set(ctx.dados.rubricas.map((r) => normalizarNome(r.nome)));
  const faltando = [...new Set((leitura?.linhas ?? []).filter((l) => !conhecidas.has(normalizarNome(l.rubrica))).map((l) => l.rubrica))];
  const porMes = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of leitura?.linhas ?? []) m.set(l.competencia, (m.get(l.competencia) ?? 0) + l.valor);
    return [...m.entries()].sort();
  }, [leitura]);

  const abrir = async (f: File) => {
    try {
      const wb = XLSX.read(await f.arrayBuffer(), { type: "array", cellDates: true });
      setArquivo(wb);
      setNomeArquivo(f.name);
      setAba(wb.SheetNames.find((n) => normalizarNome(n).startsWith("base")) ?? wb.SheetNames[0]);
    } catch (e) { toast.error(`Não foi possível ler o arquivo: ${erroMsg(e)}`); }
  };

  const confirmar = async (linhas: LinhaImportacaoOsc[]) => {
    try {
      const r = await importar.mutateAsync({ parceriaId: ctx.parceria.id, linhas, usarComoRealizado, criarRubricas });
      toast.success(`${r.linhas} linha(s) importada(s) em ${r.meses.length} mês(es).`);
      setArquivo(null);
    } catch (e) { toast.error(erroMsg(e)); }
  };

  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-base">Importar histórico da planilha</CardTitle></CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-xs text-muted-foreground">
          Aceita a aba "Base janeiro a julho" da planilha atual (Mês | Descrição original | Categoria | Valor | Origem) ou um modelo simples
          (Competência | Rubrica | Valor | Descrição). Substitui só o histórico importado dos meses do arquivo — nunca mexe no Malote, em ajustes ou resgates.
        </p>
        <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 hover:bg-muted">
          <Upload className="h-4 w-4" />{nomeArquivo || "Escolher arquivo .xlsx"}
          <input type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(e) => e.target.files?.[0] && abrir(e.target.files[0])} />
        </label>
        {arquivo && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <FileSpreadsheet className="h-4 w-4" />
              <Select value={aba} onValueChange={setAba}>
                <SelectTrigger className="h-8 w-64"><SelectValue /></SelectTrigger>
                <SelectContent>{arquivo.SheetNames.map((n) => <SelectItem key={n} value={n}>{n}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            {leitura && (
              <>
                {leitura.erros.length > 0 && (
                  <ul className="max-h-24 list-disc overflow-auto pl-5 text-xs text-red-600">{leitura.erros.map((e, i) => <li key={i}>{e}</li>)}</ul>
                )}
                <Table className="text-xs">
                  <TableHeader><TableRow><TableHead>Competência</TableHead><TableHead className="text-right">Planilha</TableHead><TableHead className="text-right">Pago no Malote</TableHead><TableHead className="text-right">Histórico atual</TableHead><TableHead className="text-right">Divergência planilha × Malote</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {porMes.map(([comp, total]) => {
                      const m = ctx.resultado.meses.find((x) => x.competencia === comp);
                      const malote = m?.pagoMalote ?? 0;
                      return (
                        <TableRow key={comp}>
                          <TableCell>{NOME_MES_LONGO[Number(comp.slice(5, 7)) - 1]}/{comp.slice(0, 4)}{comp.slice(0, 4) !== String(ctx.ano) && " (outro ano)"}</TableCell>
                          <TableCell className="text-right tabular-nums">{brl(total)}</TableCell>
                          <TableCell className="text-right tabular-nums">{m ? brl(malote) : "—"}</TableCell>
                          <TableCell className="text-right tabular-nums">{m ? brl(m.historicoImportado) : "—"}</TableCell>
                          <TableCell className={cn("text-right tabular-nums", m && Math.abs(total - malote) > 0.009 && "text-amber-700 dark:text-amber-300")}>{m ? brl(total - malote) : "—"}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
                {faltando.length > 0 && (
                  <p className="text-xs text-amber-700 dark:text-amber-300">Rubricas não cadastradas: {faltando.join(", ")}.</p>
                )}
                <div className="flex flex-wrap items-center gap-4">
                  <label className="flex items-center gap-2"><Checkbox checked={usarComoRealizado} onCheckedChange={(v) => setUsarComoRealizado(!!v)} />Usar a planilha como realizado desses meses</label>
                  {faltando.length > 0 && <label className="flex items-center gap-2"><Checkbox checked={criarRubricas} onCheckedChange={(v) => setCriarRubricas(!!v)} />Criar as rubricas que faltam</label>}
                  <Button className="ml-auto" disabled={!leitura.linhas.length || importar.isPending || (faltando.length > 0 && !criarRubricas)}
                    onClick={() => confirmar(leitura.linhas)}>
                    Importar {leitura.linhas.length} linha(s)
                  </Button>
                </div>
              </>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
