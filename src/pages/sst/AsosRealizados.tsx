import { useEffect, useState } from "react";
import { FileSpreadsheet, Link2, Loader2, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { ImportarAsosDialog } from "@/components/sst/ImportarAsos";
import { Indicador } from "@/components/sst/PecasSst";
import {
  buscarColaboradoresAso, MENU_ASOS_REALIZADOS, useExcluirAso, useListaAsoHistorico, useSalvarAso,
  type ColaboradorAso, type SalvarAso,
} from "@/hooks/useAsoHistorico";
import { useScreenAccess } from "@/hooks/useScreenAccess";
import {
  FILTROS_ASO_INICIAIS, fmtData, hojeIso, ROTULO_SITUACAO_ASO, ROTULO_TIPO_ASO, SITUACOES_ASO, TIPOS_ASO,
  type AsoHistorico, type FiltrosAsoHistorico, type SituacaoAso, type TipoAso,
} from "@/lib/sst/asoHistorico";
import { cn } from "@/lib/utils";

// =====================================================================
// SST › ASOs REALIZADOS (histórico) — SIS-2026-0816, mig 20261121100000.
//
// O que o SST guardava na planilha de exames clínicos passa a morar aqui,
// com cadastro manual e reimportação da planilha. Os ASOs ligados a um
// colaborador (menos o demissional) entram na conta do ASO Periódico: é o
// que corrige o "Estimado pela admissão" dos vencidos.
// =====================================================================

const LIMITE = 300;
const COR_SITUACAO: Record<SituacaoAso, string> = {
  realizado: "bg-emerald-100 text-emerald-800 border-emerald-200",
  aguardando: "bg-sky-100 text-sky-800 border-sky-200",
  atrasado: "bg-amber-100 text-amber-800 border-amber-200",
  cancelado: "bg-slate-100 text-slate-600 border-slate-200",
  valido: "bg-slate-100 text-slate-700 border-slate-200",
  nao_compareceu: "bg-red-100 text-red-800 border-red-200",
};

export default function AsosRealizados() {
  const podeAlterar = useScreenAccess(MENU_ASOS_REALIZADOS, "alterar").data === true;
  const podeExcluir = useScreenAccess(MENU_ASOS_REALIZADOS, "excluir").data === true;
  const [f, setF] = useState<FiltrosAsoHistorico>(FILTROS_ASO_INICIAIS);
  // A busca por nome vai ao banco: espera parar de digitar.
  const [busca, setBusca] = useState("");
  useEffect(() => { const t = window.setTimeout(() => setF((x) => ({ ...x, busca })), 400); return () => window.clearTimeout(t); }, [busca]);
  const { data, isLoading, isFetching, error } = useListaAsoHistorico(f, LIMITE);
  const [editando, setEditando] = useState<AsoHistorico | "novo" | null>(null);
  const [importando, setImportando] = useState(false);
  const excluir = useExcluirAso();
  const filtro = <K extends keyof FiltrosAsoHistorico>(k: K, v: FiltrosAsoHistorico[K]) => setF((x) => ({ ...x, [k]: v }));
  const filtrando = JSON.stringify({ ...f, busca }) !== JSON.stringify(FILTROS_ASO_INICIAIS);
  const r = data?.resumo;
  const ano = hojeIso().slice(0, 4);

  const apagar = (a: AsoHistorico) => {
    if (!window.confirm(`Excluir o ASO ${ROTULO_TIPO_ASO[a.tipo].toLowerCase()} de ${a.nome}? Não dá para desfazer.`)) return;
    excluir.mutate(a.id, { onSuccess: () => toast.success("Registro excluído."), onError: (e) => toast.error((e as Error).message) });
  };

  return (
    <div className="space-y-4">
      <PageHeader title="ASOs Realizados" module="SST" breadcrumb={["ASOs Realizados"]}
        subtitle="Histórico dos ASOs feitos fora dos fluxos do ERP (planilha de exames clínicos). Os ligados a um colaborador corrigem o vencimento do ASO Periódico."
        actions={podeAlterar && (
          <>
            <Button variant="outline" onClick={() => setImportando(true)}><FileSpreadsheet className="mr-2 h-4 w-4" /> Importar planilha</Button>
            <Button onClick={() => setEditando("novo")}><Plus className="mr-2 h-4 w-4" /> Registrar ASO</Button>
          </>
        )} />

      <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-7">
        <Indicador valor={r?.realizados_ano ?? "—"} titulo={`Realizados em ${ano}`} />
        {TIPOS_ASO.map((t) => (
          <Indicador key={t} valor={r?.por_tipo_ano?.[t] ?? 0} titulo={`${ROTULO_TIPO_ASO[t]} em ${ano}`} ativo={f.tipo === t}
            onClick={() => filtro("tipo", f.tipo === t ? "todos" : t)} />
        ))}
        <Indicador valor={r?.sem_vinculo ?? "—"} titulo="Sem vínculo com colaborador" destaque={(r?.sem_vinculo ?? 0) > 0 ? "aviso" : undefined}
          ativo={f.soSemVinculo} onClick={() => filtro("soSemVinculo", !f.soSemVinculo)}
          ajuda="Nome da planilha que não casou com um colaborador: não conta no vencimento até ligar" />
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="relative min-w-56 flex-1">
          <Label className="text-xs">Colaborador ou filial</Label>
          <Search className="absolute bottom-3 left-2.5 h-4 w-4 text-muted-foreground" />
          <Input className="mt-1 pl-8" placeholder="Nome" aria-label="Colaborador ou filial" value={busca} onChange={(e) => setBusca(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Tipo</Label>
          <Select value={f.tipo} onValueChange={(v) => filtro("tipo", v as TipoAso | "todos")}>
            <SelectTrigger className="w-48" aria-label="Tipo"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos</SelectItem>
              {TIPOS_ASO.map((t) => <SelectItem key={t} value={t}>{ROTULO_TIPO_ASO[t]}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Situação</Label>
          <Select value={f.situacao} onValueChange={(v) => filtro("situacao", v as SituacaoAso | "todas")}>
            <SelectTrigger className="w-52" aria-label="Situação"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todas">Todas</SelectItem>
              {SITUACOES_ASO.map((s) => <SelectItem key={s} value={s}>{ROTULO_SITUACAO_ASO[s]}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <label className="space-y-1 text-xs font-medium">
          <span className="block">De</span>
          <Input type="date" className="w-40" value={f.de} onChange={(e) => filtro("de", e.target.value)} aria-label="Data inicial" />
        </label>
        <label className="space-y-1 text-xs font-medium">
          <span className="block">Até</span>
          <Input type="date" className="w-40" value={f.ate} onChange={(e) => filtro("ate", e.target.value)} aria-label="Data final" />
        </label>
        <label className="flex h-10 items-center gap-2 text-sm">
          <Checkbox checked={f.soSemVinculo} onCheckedChange={(v) => filtro("soSemVinculo", v === true)} /> Só sem vínculo
        </label>
        {filtrando && <Button variant="ghost" onClick={() => { setBusca(""); setF(FILTROS_ASO_INICIAIS); }}>Limpar filtros</Button>}
      </div>

      <Card className="overflow-x-auto">
        <Table className="min-w-[1000px]">
          <TableHeader>
            <TableRow>
              <TableHead>Colaborador</TableHead>
              <TableHead>Tipo</TableHead>
              <TableHead>Empresa / filial</TableHead>
              <TableHead>Solicitação</TableHead>
              <TableHead>Realização</TableHead>
              <TableHead>Situação</TableHead>
              <TableHead>Origem</TableHead>
              <TableHead className="w-24" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={8} className="py-10 text-center text-muted-foreground"><Loader2 className="mx-auto h-5 w-5 animate-spin" /></TableCell></TableRow>
            ) : error ? (
              <TableRow><TableCell colSpan={8} className="py-10 text-center text-red-700">{(error as Error).message}</TableCell></TableRow>
            ) : (data?.itens.length ?? 0) === 0 ? (
              <TableRow><TableCell colSpan={8} className="py-10 text-center text-muted-foreground">
                {filtrando ? "Nada com esses filtros." : "Nenhum ASO registrado ainda. Importe a planilha de exames clínicos ou registre um ASO."}
              </TableCell></TableRow>
            ) : data!.itens.map((a) => (
              <TableRow key={a.id} className={cn(isFetching && "opacity-70")}>
                <TableCell>
                  <span className="font-medium">{a.nome}</span>
                  {!a.vinculado && <span className="block text-xs font-medium text-amber-700">sem vínculo — não conta no vencimento</span>}
                </TableCell>
                <TableCell>{ROTULO_TIPO_ASO[a.tipo]}</TableCell>
                <TableCell className="text-sm">
                  {a.empresa && <Badge variant="outline" className="mr-1">{a.empresa}</Badge>}
                  <span className="text-muted-foreground">{a.filial_texto ?? ""}</span>
                </TableCell>
                <TableCell className="tabular-nums">{fmtData(a.data_solicitacao) || "—"}</TableCell>
                <TableCell className="tabular-nums">{fmtData(a.data_realizacao) || "—"}</TableCell>
                <TableCell><Badge variant="outline" className={COR_SITUACAO[a.situacao]}>{ROTULO_SITUACAO_ASO[a.situacao]}</Badge></TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {a.origem === "planilha" ? "Planilha" : `Manual${a.created_by_nome ? ` · ${a.created_by_nome}` : ""}`}
                  {a.editado_manual && <span className="block">corrigido na tela</span>}
                </TableCell>
                <TableCell className="text-right">
                  {podeAlterar && (
                    <Button size="icon" variant="ghost" onClick={() => setEditando(a)} aria-label={a.vinculado ? "Editar" : "Ligar ao colaborador"}
                      title={a.vinculado ? "Editar" : "Ligar ao colaborador"}>
                      {a.vinculado ? <Pencil className="h-4 w-4" /> : <Link2 className="h-4 w-4 text-amber-700" />}
                    </Button>
                  )}
                  {podeExcluir && (
                    <Button size="icon" variant="ghost" onClick={() => apagar(a)} aria-label="Excluir" title="Excluir"><Trash2 className="h-4 w-4" /></Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
      {data && data.total > data.itens.length && (
        <p className="text-sm text-muted-foreground">
          Mostrando os {data.itens.length} mais recentes de {data.total.toLocaleString("pt-BR")}. Use os filtros para achar um registro.
        </p>
      )}

      {editando && <FormAso aso={editando === "novo" ? null : editando} onFechar={() => setEditando(null)} />}
      {importando && <ImportarAsosDialog onFechar={() => setImportando(false)} />}
    </div>
  );
}

function FormAso({ aso, onFechar }: { aso: AsoHistorico | null; onFechar: () => void }) {
  const salvar = useSalvarAso();
  const [p, setP] = useState<SalvarAso>({
    id: aso?.id, empregado_id: null, tipo: aso?.tipo ?? "periodico", situacao: aso?.situacao ?? "realizado",
    data_solicitacao: aso?.data_solicitacao ?? null, data_realizacao: aso?.data_realizacao ?? null,
    empresa: aso?.empresa ?? null, filial_texto: aso?.filial_texto ?? null, solicitado_por: aso?.solicitado_por ?? null,
    clinica: aso?.clinica ?? null, observacoes: aso?.observacoes ?? null,
  });
  const campo = <K extends keyof SalvarAso>(k: K, v: SalvarAso[K]) => setP((x) => ({ ...x, [k]: v }));
  const [busca, setBusca] = useState(aso && !aso.vinculado ? aso.nome : "");
  const [opcoes, setOpcoes] = useState<ColaboradorAso[] | null>(null);
  const [escolhido, setEscolhido] = useState<ColaboradorAso | null>(null);
  const [buscando, setBuscando] = useState(false);
  const precisaPessoa = !aso || !aso.vinculado;

  const procurar = async () => {
    setBuscando(true);
    try { setOpcoes(await buscarColaboradoresAso(busca)); } catch (e) { toast.error((e as Error).message); } finally { setBuscando(false); }
  };
  const enviar = () => {
    if (!aso && !escolhido) { toast.error("Escolha o colaborador."); return; }
    if (p.situacao === "realizado" && !p.data_realizacao) { toast.error("Informe a data de realização."); return; }
    salvar.mutate({ ...p, empregado_id: escolhido?.empregado_id ?? null }, {
      onSuccess: () => { toast.success("ASO salvo."); onFechar(); },
      onError: (e) => toast.error((e as Error).message),
    });
  };

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onFechar(); }}>
      <DialogContent className="max-h-[92vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{aso ? `ASO de ${aso.nome}` : "Registrar ASO"}</DialogTitle>
          <DialogDescription>
            {aso?.origem === "planilha" ? "Veio da planilha. O que for corrigido aqui não é sobrescrito numa nova importação." : "ASO feito fora dos fluxos do ERP."}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          {precisaPessoa && (
            <div className="space-y-1 sm:col-span-2">
              <Label>{aso ? "Ligar ao colaborador" : "Colaborador"}</Label>
              <div className="flex gap-2">
                <Input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Nome (mín. 3 letras)" onKeyDown={(e) => { if (e.key === "Enter") procurar(); }} />
                <Button type="button" variant="outline" onClick={procurar} disabled={buscando || busca.trim().length < 3}>
                  {buscando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                </Button>
              </div>
              {escolhido && <p className="text-sm">Escolhido: <b>{escolhido.nome}</b> {escolhido.desligado && "(desligado)"}</p>}
              {opcoes && !escolhido && (
                <div className="max-h-40 overflow-y-auto rounded border">
                  {opcoes.length === 0 ? <p className="p-2 text-sm text-muted-foreground">Ninguém com esse nome.</p> : opcoes.map((o) => (
                    <button type="button" key={o.empregado_id} className="block w-full px-2 py-1 text-left text-sm hover:bg-muted" onClick={() => setEscolhido(o)}>
                      {o.nome} <span className="text-xs text-muted-foreground">· empresa {o.empresa_codigo ?? "?"}{o.desligado ? " · desligado" : ""}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          <div className="space-y-1">
            <Label>Tipo</Label>
            <Select value={p.tipo} onValueChange={(v) => campo("tipo", v as TipoAso)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{TIPOS_ASO.map((t) => <SelectItem key={t} value={t}>{ROTULO_TIPO_ASO[t]}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Situação</Label>
            <Select value={p.situacao} onValueChange={(v) => campo("situacao", v as SituacaoAso)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{SITUACOES_ASO.map((s) => <SelectItem key={s} value={s}>{ROTULO_SITUACAO_ASO[s]}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Data da solicitação</Label>
            <Input type="date" value={p.data_solicitacao ?? ""} onChange={(e) => campo("data_solicitacao", e.target.value || null)} />
          </div>
          <div className="space-y-1">
            <Label>Data da realização</Label>
            <Input type="date" max={hojeIso()} value={p.data_realizacao ?? ""} onChange={(e) => campo("data_realizacao", e.target.value || null)} />
          </div>
          <div className="space-y-1">
            <Label>Empresa</Label>
            <Input value={p.empresa ?? ""} onChange={(e) => campo("empresa", e.target.value || null)} placeholder="HAGG, SN, NH, CANAÃ" />
          </div>
          <div className="space-y-1">
            <Label>Filial / contrato</Label>
            <Input value={p.filial_texto ?? ""} onChange={(e) => campo("filial_texto", e.target.value || null)} />
          </div>
          <div className="space-y-1">
            <Label>Solicitado por</Label>
            <Input value={p.solicitado_por ?? ""} onChange={(e) => campo("solicitado_por", e.target.value || null)} />
          </div>
          <div className="space-y-1">
            <Label>Clínica</Label>
            <Input value={p.clinica ?? ""} onChange={(e) => campo("clinica", e.target.value || null)} />
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label>Observações</Label>
            <Textarea rows={2} value={p.observacoes ?? ""} onChange={(e) => campo("observacoes", e.target.value || null)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onFechar}>Cancelar</Button>
          <Button onClick={enviar} disabled={salvar.isPending}>{salvar.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Salvar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
