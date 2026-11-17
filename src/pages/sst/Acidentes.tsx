import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { FileDown, FileSpreadsheet, Loader2, Paperclip, Plus, Search } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { FichaAcidenteDialog, SeloConclusao } from "@/components/sst/FichaAcidente";
import { ImportarAcidentesDialog } from "@/components/sst/ImportarAcidentes";
import { MENU_ACIDENTES, useListaAcidentes } from "@/hooks/useAcidentes";
import { useScreenAccess } from "@/hooks/useScreenAccess";
import {
  FILTROS_INICIAIS, ROTULO_TIPO, baixarPlanilhaAcidentes, contratoExibido, diasSemAcidente, filtrarAcidentes, fmtData, hojeIso, indicadores,
  type Acidente, type FiltroConcluida, type FiltrosAcidente,
} from "@/lib/sst/acidentes";
import { cn } from "@/lib/utils";

// =====================================================================
// SST › ACIDENTES DE TRABALHO (SIS-2026-0889, mig 20261117220000)
//
// Substitui a "PLANILHA DE ACIDENTES.xlsx" do SST: cada acidente ligado ao
// colaborador, com a CAT anexada, filtros por período, contrato,
// colaborador e conclusão, e a exportação no formato da planilha para o
// Power BI. ?id=N abre direto a ficha (link da Ficha do Colaborador).
// =====================================================================

export default function Acidentes() {
  const podeAlterar = useScreenAccess(MENU_ACIDENTES, "alterar").data === true;
  const podeExcluir = useScreenAccess(MENU_ACIDENTES, "excluir").data === true;
  const { data: lista = [], isLoading, error } = useListaAcidentes();
  const [params, setParams] = useSearchParams();
  const [novo, setNovo] = useState(false);
  const [importando, setImportando] = useState(false);
  const [f, setF] = useState<FiltrosAcidente>(FILTROS_INICIAIS);
  const filtro = <K extends keyof FiltrosAcidente>(k: K, v: FiltrosAcidente[K]) => setF((x) => ({ ...x, [k]: v }));
  const hoje = hojeIso();

  const abertoId = Number(params.get("id")) || null;
  const aberto = abertoId != null ? lista.find((a) => a.id === abertoId) ?? null : null;
  const abrir = (id: number | null) => setParams((p) => { const n = new URLSearchParams(p); if (id == null) n.delete("id"); else n.set("id", String(id)); return n; }, { replace: true });

  const contratos = useMemo(() => [...new Set(lista.map((a) => contratoExibido(a) ?? "").filter(Boolean))].sort(), [lista]);
  const visiveis = useMemo(() => filtrarAcidentes(lista, f), [lista, f]);
  const ind = indicadores(visiveis);
  const semAcidente = diasSemAcidente(lista, hoje);
  const filtrando = JSON.stringify(f) !== JSON.stringify(FILTROS_INICIAIS);

  return (
    <div className="space-y-4">
      <PageHeader title="Acidentes de Trabalho" module="SST" breadcrumb={["Acidentes de Trabalho"]}
        subtitle="Registro e controle dos acidentes: colaborador, contrato, afastamento, INSS e a CAT anexada."
        actions={(
          <>
            <Button variant="outline" onClick={() => baixarPlanilhaAcidentes(visiveis, hoje)} disabled={visiveis.length === 0}
              title="Mesmo formato da planilha antiga, com o que está filtrado na tela">
              <FileDown className="mr-2 h-4 w-4" /> Exportar Excel
            </Button>
            {podeAlterar && <Button variant="outline" onClick={() => setImportando(true)}><FileSpreadsheet className="mr-2 h-4 w-4" /> Importar planilha</Button>}
            {podeAlterar && <Button onClick={() => setNovo(true)}><Plus className="mr-2 h-4 w-4" /> Registrar acidente</Button>}
          </>
        )} />

      <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <Indicador valor={ind.total} titulo={filtrando ? "Acidentes no filtro" : "Acidentes registrados"} />
        <Indicador valor={ind.comAfastamento} titulo="Com afastamento" />
        <Indicador valor={ind.comInss} titulo="Encaminhados ao INSS" />
        <Indicador valor={ind.diasAfastamento} titulo="Dias de afastamento" />
        <Indicador valor={ind.emAberto} titulo="Em aberto" destaque={ind.emAberto > 0} ativo={f.concluida === "nao"}
          onClick={() => filtro("concluida", f.concluida === "nao" ? "todas" : "nao")} />
        <Indicador valor={semAcidente ?? "—"} titulo="Dias sem acidente" ajuda="Desde o último acidente registrado, sem filtro" />
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <label className="space-y-1 text-xs font-medium">
          <span className="block">De</span>
          <Input type="date" className="w-40" value={f.de} onChange={(e) => filtro("de", e.target.value)} aria-label="Data inicial" />
        </label>
        <label className="space-y-1 text-xs font-medium">
          <span className="block">Até</span>
          <Input type="date" className="w-40" value={f.ate} onChange={(e) => filtro("ate", e.target.value)} aria-label="Data final" />
        </label>
        <div className="space-y-1">
          <Label className="text-xs">Contrato</Label>
          <Select value={f.contrato} onValueChange={(v) => filtro("contrato", v)}>
            <SelectTrigger className="w-64" aria-label="Contrato"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos</SelectItem>
              {contratos.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="relative min-w-56 flex-1">
          <Label className="text-xs">Colaborador</Label>
          <Search className="absolute bottom-3 left-2.5 h-4 w-4 text-muted-foreground" />
          <Input className="mt-1 pl-8" placeholder="Nome do colaborador" aria-label="Colaborador" value={f.colaborador} onChange={(e) => filtro("colaborador", e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Concluída</Label>
          <Select value={f.concluida} onValueChange={(v) => filtro("concluida", v as FiltroConcluida)}>
            <SelectTrigger className="w-36" aria-label="Concluída"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todas">Todas</SelectItem>
              <SelectItem value="sim">Sim</SelectItem>
              <SelectItem value="nao">Não (em aberto)</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <label className="flex h-10 items-center gap-2 text-sm">
          <Checkbox checked={f.soSemVinculo} onCheckedChange={(v) => filtro("soSemVinculo", v === true)} /> Só sem vínculo com colaborador
        </label>
        {filtrando && <Button variant="ghost" onClick={() => setF(FILTROS_INICIAIS)}>Limpar filtros</Button>}
      </div>

      <Card className="overflow-x-auto">
        <Table className="min-w-[1100px]">
          <TableHeader>
            <TableRow>
              <TableHead>Data</TableHead>
              <TableHead>Colaborador</TableHead>
              <TableHead>Contrato</TableHead>
              <TableHead>Tipo</TableHead>
              <TableHead>Afastamento</TableHead>
              <TableHead>CAT</TableHead>
              <TableHead>Encarregado</TableHead>
              <TableHead>Situação</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={8} className="py-10 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" /></TableCell></TableRow>
            ) : error ? (
              <TableRow><TableCell colSpan={8} className="py-10 text-center text-destructive">{(error as Error).message}</TableCell></TableRow>
            ) : visiveis.length === 0 ? (
              <TableRow><TableCell colSpan={8} className="py-10 text-center text-muted-foreground">
                {lista.length === 0 ? "Nenhum acidente registrado ainda." : "Nenhum acidente neste filtro."}
              </TableCell></TableRow>
            ) : visiveis.map((a) => <Linha key={a.id} a={a} onAbrir={() => abrir(a.id)} />)}
          </TableBody>
        </Table>
      </Card>
      <p className="text-xs text-muted-foreground">{visiveis.length} de {lista.length} acidente(s).</p>

      {(aberto || novo) && (
        <FichaAcidenteDialog acidente={novo ? null : aberto} podeAlterar={podeAlterar} podeExcluir={podeExcluir}
          onFechar={() => { setNovo(false); abrir(null); }}
          onCriado={(id) => { setNovo(false); abrir(id); }} />
      )}
      {importando && <ImportarAcidentesDialog onFechar={() => setImportando(false)} />}
    </div>
  );
}

function Linha({ a, onAbrir }: { a: Acidente; onAbrir: () => void }) {
  return (
    <TableRow className="cursor-pointer" onClick={onAbrir}>
      <TableCell className="whitespace-nowrap">{fmtData(a.data_acidente)}</TableCell>
      <TableCell>
        <button type="button" className="text-left font-medium text-primary underline-offset-2 hover:underline" onClick={(e) => { e.stopPropagation(); onAbrir(); }}>{a.nome}</button>
        <div className="mt-1 flex flex-wrap gap-1">
          {!a.vinculado && <Badge variant="outline" className="border-amber-400 text-amber-800">Sem vínculo</Badge>}
          {a.desligado && <Badge variant="outline">Desligado</Badge>}
          {a.morte_invalidez && <Badge variant="destructive">Morte / invalidez</Badge>}
        </div>
      </TableCell>
      <TableCell className="max-w-60">
        <span className={cn("block truncate", !a.contrato_nome && a.contrato_texto && "italic")} title={contratoExibido(a) ?? undefined}>{contratoExibido(a) ?? "—"}</span>
        {a.empresa && <span className="block text-xs text-muted-foreground">{a.empresa}</span>}
      </TableCell>
      <TableCell>{a.tipo ? ROTULO_TIPO[a.tipo] : "—"}</TableCell>
      <TableCell className="whitespace-nowrap">
        {!a.houve_afastamento ? "Sem afastamento" : (
          <>
            <span className="block">{a.dias_afastamento != null ? `${a.dias_afastamento} dia(s)` : "Com afastamento"}</span>
            {a.encaminhado_inss && <Badge variant="outline" className="border-sky-400 text-sky-800">INSS</Badge>}
          </>
        )}
      </TableCell>
      <TableCell className="max-w-56">
        {a.cat_emitida == null ? <span className="text-muted-foreground">Não informado</span> : !a.cat_emitida ? "Não emitida" : (
          <span className="flex items-center gap-1">
            <span className="truncate" title={a.numero_cat ?? undefined}>{a.numero_cat ?? "Sem número"}</span>
            {a.cat_anexada && <Paperclip className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-label="CAT anexada" />}
          </span>
        )}
      </TableCell>
      <TableCell className="max-w-48 truncate" title={a.encarregado ?? undefined}>{a.encarregado ?? "—"}</TableCell>
      <TableCell><SeloConclusao concluido={a.concluido} /></TableCell>
    </TableRow>
  );
}

function Indicador({ valor, titulo, destaque, ativo, onClick, ajuda }: {
  valor: number | string; titulo: string; destaque?: boolean; ativo?: boolean; onClick?: () => void; ajuda?: string;
}) {
  const classe = cn("rounded-lg border bg-card p-3 text-left", destaque && "border-amber-300 bg-amber-50", ativo && "border-primary ring-2 ring-primary/30",
    onClick && "transition hover:border-primary");
  const corpo = (
    <>
      <span className="block text-2xl font-bold">{valor}</span>
      <span className="block text-xs text-muted-foreground">{titulo}</span>
    </>
  );
  return onClick
    ? <button type="button" aria-pressed={ativo} className={classe} onClick={onClick} title={ajuda}>{corpo}</button>
    : <div className={classe} title={ajuda}>{corpo}</div>;
}
