import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import * as XLSX from "xlsx";
import { Download, FileUp, HeartPulse, Loader2, Plus, RefreshCw, Search, Stethoscope } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { useScreenAccess } from "@/hooks/useScreenAccess";
import {
  buscarColaboradores, previaLotacao, useCapturarSenior, useImportarPlanilha, useListaAfastamentos, useSalvarAfastamento,
  type ColaboradorBusca, type Lotacao,
} from "@/hooks/useAfastamentos";
import { FichaAfastamentoDialog } from "@/components/sst/FichaAfastamento";
import {
  RETORNOS, TELE_STATUS, TIPOS, brl, calcularImpacto, consolidar, fmtData, fmtNum, lerPlanilhaTelemedicina, relatorioMensal,
  rotuloCompetencia, type Agrupamento, type AfastamentoItem, type LinhaImportacao, type TeleStatus,
} from "@/lib/sst/afastamentos";

// =====================================================================
// SST › AFASTAMENTOS E TELEMEDICINA (mig 20261028002000, 28/10/2026)
//
// Substitui a PLANILHA TELEMEDICINA e o RELATÓRIO MENSAL ATESTADOS: cada
// afastamento com a lotação puxada sozinha na data (contrato, posto, escala,
// valor do posto), a cobertura (Efetividade, Diárias, RT, HE e despesas
// registradas) e, para quem tem sst_afastamentos_financeiro, o impacto
// financeiro. Relatório gerencial por colaborador / posto / contrato /
// competência e o relatório mensal no formato da planilha de hoje.
// =====================================================================

const p2 = (n: number) => String(n).padStart(2, "0");
const hoje = new Date();
const mesIso = (d: Date) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}`;
const ultimoDia = (m: string) => { const [a, mm] = m.split("-").map(Number); return `${m}-${p2(new Date(a, mm, 0).getDate())}`; };

export default function Afastamentos() {
  const [params, setParams] = useSearchParams();
  const podeAlterar = useScreenAccess("sst_afastamentos", "alterar").data === true;
  const [mesIni, setMesIni] = useState(mesIso(new Date(hoje.getFullYear(), hoje.getMonth() - 2, 1)));
  const [mesFim, setMesFim] = useState(mesIso(hoje));
  const lista = useListaAfastamentos(`${mesIni}-01`, ultimoDia(mesFim));
  const veFin = lista.data?.ve_financeiro ?? false;
  const [busca, setBusca] = useState("");
  const [fContrato, setFContrato] = useState("_");
  const [fTele, setFTele] = useState("_");
  const [fRetorno, setFRetorno] = useState("_");
  const [verCancelados, setVerCancelados] = useState(false);
  const [aberta, setAberta] = useState<number | null>(null);
  const [novo, setNovo] = useState(false);
  const [importar, setImportar] = useState(false);
  const capturar = useCapturarSenior();

  useEffect(() => { const s = Number(params.get("a")); if (s) setAberta(s); }, [params]);
  const fechar = () => { setAberta(null); if (params.get("a")) { params.delete("a"); setParams(params, { replace: true }); } };

  const todos = useMemo(() => lista.data?.itens ?? [], [lista.data]);
  const contratos = useMemo(() => [...new Set(todos.map((a) => a.contrato_nome || a.contrato_planilha || "(sem contrato)"))].sort(), [todos]);
  const itens = useMemo(() => {
    const t = busca.trim().toLowerCase();
    return todos.filter((a) => (verCancelados || !a.cancelado)
      && (fContrato === "_" || (a.contrato_nome || a.contrato_planilha || "(sem contrato)") === fContrato)
      && (fTele === "_" || a.tele_status === fTele)
      && (fRetorno === "_" || a.retorno_status === fRetorno)
      && (!t || [a.nome, a.protocolo, a.cpf, a.contrato_nome, a.posto_planilha, a.posto_senior, a.encarregado_nome].some((v) => String(v ?? "").toLowerCase().includes(t))));
  }, [todos, busca, fContrato, fTele, fRetorno, verCancelados]);

  const kpi = useMemo(() => {
    let dias = 0, evitados = 0, cobertos = 0, custo = 0, impacto = 0, economia = 0, tele = 0, aguardando = 0;
    for (const a of itens) {
      if (a.cancelado) continue;
      const i = calcularImpacto(a);
      dias += i.dias; evitados += i.diasEvitados; cobertos += i.diasCobertos; custo += i.custoCobertura;
      impacto += i.impactoTotal ?? i.custoCobertura; economia += i.economiaTelemedicina ?? 0;
      if (a.tele_status === "realizada") tele++;
      if (a.retorno_status === "aguardando") aguardando++;
    }
    return { qtd: itens.filter((a) => !a.cancelado).length, dias, evitados, cobertos, custo, impacto, economia, tele, aguardando };
  }, [itens]);

  return (
    <div className="space-y-4">
      <PageHeader title="Afastamentos e Telemedicina" module="SST" breadcrumb={["Afastamentos e Telemedicina"]}
        subtitle="Atestados com a lotação puxada automaticamente (contrato, posto, escala e valor do posto), a cobertura da ausência e o impacto financeiro." />

      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1"><Label className="text-xs">De</Label><Input type="month" className="w-40" value={mesIni} onChange={(e) => e.target.value && setMesIni(e.target.value)} /></div>
        <div className="space-y-1"><Label className="text-xs">Até</Label><Input type="month" className="w-40" value={mesFim} onChange={(e) => e.target.value && setMesFim(e.target.value)} /></div>
        <div className="ml-auto flex flex-wrap gap-2">
          {podeAlterar && <>
            <Button variant="outline" disabled={capturar.isPending} onClick={() => capturar.mutateAsync().then(
              (r) => toast.success(`Senior: ${r.novos} afastamento(s) novo(s), ${r.retornos} retorno(s), ${r.desligados} desligado(s).`),
              (e) => toast.error((e as Error).message))}>
              <RefreshCw className={cn("mr-1 h-4 w-4", capturar.isPending && "animate-spin")} /> Trazer da Senior
            </Button>
            <Button variant="outline" onClick={() => setImportar(true)}><FileUp className="mr-1 h-4 w-4" /> Importar planilha</Button>
            <Button onClick={() => setNovo(true)}><Plus className="mr-1 h-4 w-4" /> Novo afastamento</Button>
          </>}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
        <Kpi r="Afastamentos" v={fmtNum(kpi.qtd)} />
        <Kpi r="Dias de afastamento" v={fmtNum(kpi.dias)} />
        <Kpi r="Avaliados na telemedicina" v={`${fmtNum(kpi.tele)}`} sub={kpi.qtd ? `${Math.round((kpi.tele / kpi.qtd) * 100)}%` : ""} />
        <Kpi r="Dias evitados (telemedicina)" v={fmtNum(kpi.evitados)} cor="text-emerald-700" />
        <Kpi r="Dias cobertos" v={fmtNum(kpi.cobertos)} sub={kpi.dias ? `${Math.round((kpi.cobertos / kpi.dias) * 100)}% dos dias` : ""} />
        <Kpi r="Aguardando retorno" v={fmtNum(kpi.aguardando)} cor="text-amber-700" />
        <Kpi r="Custo de cobertura" v={brl(kpi.custo)} />
        {veFin ? <Kpi r="Impacto financeiro" v={brl(kpi.impacto)} sub={`economia tele: ${brl(kpi.economia)}`} cor="text-red-700" />
          : <Kpi r="Impacto financeiro" v="—" sub="sem acesso aos valores" />}
      </div>

      <Tabs defaultValue="lista">
        <TabsList>
          <TabsTrigger value="lista">Afastamentos ({itens.length})</TabsTrigger>
          <TabsTrigger value="gerencial">Relatório gerencial</TabsTrigger>
          <TabsTrigger value="mensal">Relatório mensal por contrato</TabsTrigger>
        </TabsList>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <div className="relative w-full sm:w-72">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input className="pl-8" placeholder="Nome, protocolo, CPF, posto…" value={busca} onChange={(e) => setBusca(e.target.value)} />
          </div>
          <Filtro valor={fContrato} set={setFContrato} todos="Todos os contratos" ops={contratos.map((c) => ({ v: c, r: c }))} largura="w-64" />
          <Filtro valor={fTele} set={setFTele} todos="Telemedicina: todas" ops={Object.entries(TELE_STATUS).map(([v, x]) => ({ v, r: x.r }))} />
          <Filtro valor={fRetorno} set={setFRetorno} todos="Retorno: todos" ops={Object.entries(RETORNOS).map(([v, x]) => ({ v, r: x.r }))} />
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground"><input type="checkbox" checked={verCancelados} onChange={(e) => setVerCancelados(e.target.checked)} /> mostrar cancelados</label>
        </div>

        <TabsContent value="lista">
          <Card className="overflow-x-auto">
            {lista.isLoading ? <Carregando /> : lista.error ? <div className="p-6 text-sm text-red-600">{(lista.error as Error).message}</div>
              : itens.length === 0 ? <Vazio /> : (
              <Table>
                <TableHeader><TableRow>
                  <TableHead>Colaborador</TableHead>
                  <TableHead className="hidden lg:table-cell">Contrato · posto</TableHead>
                  <TableHead>Período</TableHead>
                  <TableHead className="text-right">Dias</TableHead>
                  <TableHead>Telemedicina</TableHead>
                  <TableHead className="hidden md:table-cell">Cobertura</TableHead>
                  {veFin && <TableHead className="text-right">Impacto</TableHead>}
                  <TableHead>Retorno</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {itens.map((a) => {
                    const i = calcularImpacto(a);
                    return (
                      <TableRow key={a.id} className={cn("cursor-pointer", a.cancelado && "opacity-50")} onClick={() => setAberta(a.id)}>
                        <TableCell>
                          <div className="font-medium">{a.nome}</div>
                          <div className="text-xs text-muted-foreground">{a.protocolo} · {TIPOS.find((t) => t.v === a.tipo)?.r}{!a.empregado_id && <span className="text-amber-700"> · sem cadastro</span>}</div>
                        </TableCell>
                        <TableCell className="hidden max-w-[260px] lg:table-cell">
                          <div className="truncate text-sm">{a.contrato_nome || a.contrato_planilha || "—"}</div>
                          <div className="truncate text-xs text-muted-foreground">{a.posto_planilha || a.posto_senior || "—"}</div>
                        </TableCell>
                        <TableCell className="text-sm">{fmtData(a.data_inicio)}<div className="text-xs text-muted-foreground">{a.dias_considerados == null ? "em aberto" : ""}</div></TableCell>
                        <TableCell className="text-right">
                          <span className="font-semibold">{i.dias}</span>
                          {i.diasEvitados > 0 && <div className="text-xs text-emerald-700">de {a.dias_atestado} (−{i.diasEvitados})</div>}
                        </TableCell>
                        <TableCell><Badge variant="outline" className={TELE_STATUS[a.tele_status as TeleStatus].cor}>{TELE_STATUS[a.tele_status as TeleStatus].r}</Badge></TableCell>
                        <TableCell className="hidden text-sm md:table-cell">
                          {i.diasCobertos}/{i.dias} dia(s){a.dias_rt > 0 && <Badge variant="outline" className="ml-1 border-indigo-200 bg-indigo-50 text-indigo-700">RT {a.dias_rt}</Badge>}
                          {i.custoCobertura > 0 && <div className="text-xs text-muted-foreground">{brl(i.custoCobertura)}</div>}
                        </TableCell>
                        {veFin && <TableCell className="text-right text-sm">{i.impactoTotal != null ? brl(i.impactoTotal) : <span className="text-xs text-muted-foreground">sem valor do posto</span>}</TableCell>}
                        <TableCell><Badge variant="outline" className={RETORNOS[a.retorno_status].cor}>{RETORNOS[a.retorno_status].r}</Badge></TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </Card>
        </TabsContent>

        <TabsContent value="gerencial"><Gerencial itens={itens} veFin={veFin} /></TabsContent>
        <TabsContent value="mensal"><Mensal itens={itens} /></TabsContent>
      </Tabs>

      <FichaAfastamentoDialog id={aberta} podeAlterar={podeAlterar} onFechar={fechar} />
      {novo && <NovoAfastamento veFin={veFin} onFechar={(id) => { setNovo(false); if (id) setAberta(id); }} />}
      {importar && <ImportarPlanilha onFechar={() => setImportar(false)} />}
    </div>
  );
}

function Kpi({ r, v, sub, cor }: { r: string; v: string; sub?: string; cor?: string }) {
  return (
    <Card className="p-3">
      <div className={cn("text-lg font-bold leading-tight", cor)}>{v}</div>
      <div className="text-[11px] text-muted-foreground">{r}</div>
      {sub && <div className="text-[10px] text-muted-foreground">{sub}</div>}
    </Card>
  );
}
function Filtro({ valor, set, todos, ops, largura = "w-52" }: { valor: string; set: (v: string) => void; todos: string; ops: { v: string; r: string }[]; largura?: string }) {
  return (
    <Select value={valor} onValueChange={set}>
      <SelectTrigger className={largura}><SelectValue /></SelectTrigger>
      <SelectContent><SelectItem value="_">{todos}</SelectItem>{ops.map((o) => <SelectItem key={o.v} value={o.v}>{o.r}</SelectItem>)}</SelectContent>
    </Select>
  );
}
const Carregando = () => <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Carregando…</div>;
const Vazio = () => <div className="p-10 text-center text-sm text-muted-foreground"><HeartPulse className="mx-auto mb-2 h-8 w-8 opacity-40" /> Nenhum afastamento no período.</div>;

// ── Relatório gerencial ──────────────────────────────────────────────
const AGRUP: { v: Agrupamento; r: string }[] = [
  { v: "contrato", r: "Por contrato" }, { v: "posto", r: "Por posto" }, { v: "colaborador", r: "Por colaborador" }, { v: "competencia", r: "Por competência (mês)" },
];

function Gerencial({ itens, veFin }: { itens: AfastamentoItem[]; veFin: boolean }) {
  const [por, setPor] = useState<Agrupamento>("contrato");
  const linhas = useMemo(() => consolidar(itens, por), [itens, por]);
  const tot = linhas.reduce((s, l) => ({
    afastamentos: s.afastamentos + l.afastamentos, dias: s.dias + l.dias, diasCobertos: s.diasCobertos + l.diasCobertos, diasRt: s.diasRt + l.diasRt,
    diasEvitados: s.diasEvitados + l.diasEvitados, custoCobertura: s.custoCobertura + l.custoCobertura, perdaReceita: s.perdaReceita + l.perdaReceita,
    impacto: s.impacto + l.impacto, margemApurada: s.margemApurada + l.margemApurada, economiaTele: s.economiaTele + l.economiaTele,
  }), { afastamentos: 0, dias: 0, diasCobertos: 0, diasRt: 0, diasEvitados: 0, custoCobertura: 0, perdaReceita: 0, impacto: 0, margemApurada: 0, economiaTele: 0 });

  const exportar = () => {
    const cab = ["Grupo", "Detalhe", "Afastamentos", "Dias", "Dias cobertos", "Dias RT", "Dias evitados (tele)", "Custo de cobertura",
      ...(veFin ? ["Perda de receita", "Impacto total", "Margem prevista", "Margem apurada", "Economia telemedicina"] : [])];
    const dados = linhas.map((l) => [l.rotulo, l.sub ?? "", l.afastamentos, Math.round(l.dias), Math.round(l.diasCobertos), Math.round(l.diasRt),
      Math.round(l.diasEvitados), +l.custoCobertura.toFixed(2),
      ...(veFin ? [+l.perdaReceita.toFixed(2), +l.impacto.toFixed(2), +l.margemPrevista.toFixed(2), +l.margemApurada.toFixed(2), +l.economiaTele.toFixed(2)] : [])]);
    const det = itens.filter((a) => !a.cancelado).map((a) => {
      const i = calcularImpacto(a);
      return {
        Protocolo: a.protocolo, Colaborador: a.nome, Contrato: a.contrato_nome || a.contrato_planilha || "", "Posto (planilha)": a.posto_planilha ?? "",
        "Posto (Senior)": a.posto_senior ?? "", Cargo: a.cargo ?? "", Escala: a.escala ?? "", Início: fmtData(a.data_inicio), "Dias atestado": a.dias_atestado ?? "",
        "Dias considerados": i.dias, Telemedicina: TELE_STATUS[a.tele_status].r, "Data tele": fmtData(a.tele_data), "Dias evitados": i.diasEvitados,
        "Dias cobertos": i.diasCobertos, "Dias RT": a.dias_rt, "Custo cobertura": +i.custoCobertura.toFixed(2), Retorno: RETORNOS[a.retorno_status].r,
        ...(veFin ? { "Valor mensal posto": a.valor_mensal_posto ?? "", "Perda de receita": i.perdaReceita != null ? +i.perdaReceita.toFixed(2) : "",
          "Impacto total": i.impactoTotal != null ? +i.impactoTotal.toFixed(2) : "", "Margem apurada": i.margemApurada != null ? +i.margemApurada.toFixed(2) : "" } : {}),
      };
    });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([cab, ...dados]), AGRUP.find((a) => a.v === por)!.r.slice(0, 30));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(det), "Afastamentos");
    XLSX.writeFile(wb, `afastamentos-${por}-${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  return (
    <Card className="overflow-x-auto p-3">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Select value={por} onValueChange={(v) => setPor(v as Agrupamento)}>
          <SelectTrigger className="w-60"><SelectValue /></SelectTrigger>
          <SelectContent>{AGRUP.map((a) => <SelectItem key={a.v} value={a.v}>{a.r}</SelectItem>)}</SelectContent>
        </Select>
        {!veFin && <span className="text-xs text-muted-foreground">Valores do posto, perda de receita e margem aparecem para quem tem "Afastamentos — Ver valores e impacto financeiro".</span>}
        <Button variant="outline" className="ml-auto" onClick={exportar} disabled={!linhas.length}><Download className="mr-1 h-4 w-4" /> Exportar Excel</Button>
      </div>
      {linhas.length === 0 ? <Vazio /> : (
        <Table>
          <TableHeader><TableRow>
            <TableHead>{AGRUP.find((a) => a.v === por)!.r.replace("Por ", "")}</TableHead>
            <TableHead className="text-right">Afast.</TableHead><TableHead className="text-right">Dias</TableHead>
            <TableHead className="text-right">Cobertos</TableHead><TableHead className="text-right">RT</TableHead>
            <TableHead className="text-right">Evitados</TableHead><TableHead className="text-right">Custo cobertura</TableHead>
            {veFin && <><TableHead className="text-right">Perda receita</TableHead><TableHead className="text-right">Impacto</TableHead>
              <TableHead className="text-right">Margem apurada</TableHead><TableHead className="text-right">Economia tele</TableHead></>}
          </TableRow></TableHeader>
          <TableBody>
            {linhas.map((l) => (
              <TableRow key={l.chave}>
                <TableCell><div className="font-medium">{l.rotulo}</div>{l.sub && <div className="text-xs text-muted-foreground">{l.sub}</div>}
                  {veFin && l.semValor > 0 && <div className="text-[10px] text-amber-700">{l.semValor} sem valor do posto</div>}</TableCell>
                <TableCell className="text-right">{l.afastamentos}</TableCell>
                <TableCell className="text-right font-semibold">{fmtNum(l.dias)}</TableCell>
                <TableCell className="text-right">{fmtNum(l.diasCobertos)}</TableCell>
                <TableCell className="text-right">{fmtNum(l.diasRt)}</TableCell>
                <TableCell className="text-right text-emerald-700">{fmtNum(l.diasEvitados)}</TableCell>
                <TableCell className="text-right">{brl(l.custoCobertura)}</TableCell>
                {veFin && <><TableCell className="text-right">{brl(l.perdaReceita)}</TableCell>
                  <TableCell className="text-right font-semibold text-red-700">{brl(l.impacto)}</TableCell>
                  <TableCell className={cn("text-right", l.margemApurada < 0 ? "text-red-700" : "text-emerald-700")}>{brl(l.margemApurada)}</TableCell>
                  <TableCell className="text-right text-emerald-700">{brl(l.economiaTele)}</TableCell></>}
              </TableRow>
            ))}
            <TableRow className="bg-muted/50 font-semibold">
              <TableCell>Total</TableCell><TableCell className="text-right">{tot.afastamentos}</TableCell><TableCell className="text-right">{fmtNum(tot.dias)}</TableCell>
              <TableCell className="text-right">{fmtNum(tot.diasCobertos)}</TableCell><TableCell className="text-right">{fmtNum(tot.diasRt)}</TableCell>
              <TableCell className="text-right">{fmtNum(tot.diasEvitados)}</TableCell><TableCell className="text-right">{brl(tot.custoCobertura)}</TableCell>
              {veFin && <><TableCell className="text-right">{brl(tot.perdaReceita)}</TableCell><TableCell className="text-right">{brl(tot.impacto)}</TableCell>
                <TableCell className="text-right">{brl(tot.margemApurada)}</TableCell><TableCell className="text-right">{brl(tot.economiaTele)}</TableCell></>}
            </TableRow>
          </TableBody>
        </Table>
      )}
    </Card>
  );
}

// ── Relatório mensal (formato do RELATÓRIO MENSAL ATESTADOS) ─────────
function Mensal({ itens }: { itens: AfastamentoItem[] }) {
  const linhas = useMemo(() => relatorioMensal(itens), [itens]);
  const exportar = () => {
    const ws = XLSX.utils.aoa_to_sheet([
      ["MÊS:", "CONTRATO:", "QUANT. ATESTADOS:", "SOMA DE DIAS DE ATESTADO:", "ATESTADOS AVALIADOS POR TELEMEDICINA:",
        "ATESTADOS NÃO AVALIADOS POR CONTA DO PRAZO:", "QUANT. TOTAL DE DIAS NÃO AVALIADOS:", "DIAS EVITADOS PELA TELEMEDICINA:"],
      ...linhas.map((l) => [rotuloCompetencia(l.competencia), l.contrato, l.quantidade, l.somaDias, l.avaliadosTele, l.naoAvaliadosPrazo, l.diasNaoAvaliados, l.diasEvitados]),
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Relatório mensal");
    XLSX.writeFile(wb, `relatorio-mensal-atestados-${new Date().toISOString().slice(0, 10)}.xlsx`);
  };
  return (
    <Card className="overflow-x-auto p-3">
      <div className="mb-3 flex items-center gap-2">
        <p className="text-xs text-muted-foreground">O mesmo quadro do RELATÓRIO MENSAL ATESTADOS, gerado dos afastamentos (mês do início do atestado).</p>
        <Button variant="outline" className="ml-auto" onClick={exportar} disabled={!linhas.length}><Download className="mr-1 h-4 w-4" /> Exportar Excel</Button>
      </div>
      {linhas.length === 0 ? <Vazio /> : (
        <Table>
          <TableHeader><TableRow>
            <TableHead>Mês</TableHead><TableHead>Contrato</TableHead><TableHead className="text-right">Atestados</TableHead>
            <TableHead className="text-right">Soma de dias</TableHead><TableHead className="text-right">Avaliados (tele)</TableHead>
            <TableHead className="text-right">Não avaliados (prazo)</TableHead><TableHead className="text-right">Dias não avaliados</TableHead>
            <TableHead className="text-right">Dias evitados</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {linhas.map((l) => (
              <TableRow key={`${l.competencia}|${l.contrato}`}>
                <TableCell>{rotuloCompetencia(l.competencia)}</TableCell><TableCell>{l.contrato}</TableCell>
                <TableCell className="text-right">{l.quantidade}</TableCell><TableCell className="text-right">{l.somaDias}</TableCell>
                <TableCell className="text-right">{l.avaliadosTele}</TableCell><TableCell className="text-right">{l.naoAvaliadosPrazo}</TableCell>
                <TableCell className="text-right">{l.diasNaoAvaliados}</TableCell><TableCell className="text-right text-emerald-700">{l.diasEvitados}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Card>
  );
}

// ── Novo afastamento ─────────────────────────────────────────────────
function NovoAfastamento({ veFin, onFechar }: { veFin: boolean; onFechar: (id?: number) => void }) {
  const [busca, setBusca] = useState("");
  const [opcoes, setOpcoes] = useState<ColaboradorBusca[]>([]);
  const [col, setCol] = useState<ColaboradorBusca | null>(null);
  const [data, setData] = useState(new Date().toISOString().slice(0, 10));
  const [dias, setDias] = useState("");
  const [tipo, setTipo] = useState("atestado");
  const [lot, setLot] = useState<Lotacao | null>(null);
  const salvar = useSalvarAfastamento();

  useEffect(() => {
    if (col || busca.trim().length < 3) { setOpcoes([]); return; }
    const t = setTimeout(() => { buscarColaboradores(busca).then(setOpcoes, () => setOpcoes([])); }, 250);
    return () => clearTimeout(t);
  }, [busca, col]);
  useEffect(() => {
    if (!col) { setLot(null); return; }
    previaLotacao(col.id, data).then(setLot, () => setLot(null));
  }, [col, data]);

  const criar = async () => {
    if (!col) { toast.error("Escolha o colaborador."); return; }
    try {
      const id = await salvar.mutateAsync({ empregado_id: col.id, data_inicio: data, dias_atestado: dias, tipo });
      toast.success("Afastamento registrado."); onFechar(id);
    } catch (e) { toast.error((e as Error).message); }
  };

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onFechar(); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle className="flex items-center gap-2"><Stethoscope className="h-5 w-5" /> Novo afastamento</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label>Colaborador</Label>
            {col ? (
              <div className="flex items-center gap-2 rounded-lg border px-3 py-2">
                <div><div className="font-medium">{col.nome}</div><div className="text-xs text-muted-foreground">{col.cargo} · {col.filial} · {col.situacao}</div></div>
                <Button size="sm" variant="ghost" className="ml-auto" onClick={() => { setCol(null); setBusca(""); }}>Trocar</Button>
              </div>
            ) : (
              <>
                <Input autoFocus placeholder="Digite o nome ou o CPF (mín. 3 letras)" value={busca} onChange={(e) => setBusca(e.target.value)} />
                {opcoes.length > 0 && (
                  <div className="max-h-56 overflow-y-auto rounded-lg border">
                    {opcoes.map((o) => (
                      <button key={o.id} type="button" className="block w-full border-b px-3 py-2 text-left text-sm last:border-0 hover:bg-muted" onClick={() => setCol(o)}>
                        <div className="font-medium">{o.nome}</div><div className="text-xs text-muted-foreground">{o.cargo} · {o.filial} · {o.situacao}</div>
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1"><Label>Início do atestado</Label><Input type="date" value={data} onChange={(e) => setData(e.target.value)} /></div>
            <div className="space-y-1"><Label>Dias</Label><Input type="number" min={0} value={dias} onChange={(e) => setDias(e.target.value)} placeholder="em aberto" /></div>
            <div className="space-y-1"><Label>Tipo</Label>
              <Select value={tipo} onValueChange={setTipo}><SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{TIPOS.map((t) => <SelectItem key={t.v} value={t.v}>{t.r}</SelectItem>)}</SelectContent></Select></div>
          </div>
          {lot && (
            <div className="rounded-lg border border-sky-200 bg-sky-50 p-3 text-sm">
              <div className="mb-1 text-xs font-bold uppercase text-sky-800">Lotação encontrada na data (preenchida sozinha)</div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                <span><b>Contrato:</b> {lot.contrato_nome ?? <span className="text-amber-700">não identificado</span>}</span>
                <span><b>Posto:</b> {lot.posto_planilha ?? lot.posto_senior ?? "—"}</span>
                <span><b>Cargo:</b> {lot.cargo ?? "—"}</span>
                <span><b>Escala:</b> {lot.escala ?? "—"}</span>
                <span><b>RT no contrato:</b> {lot.rt_no_contrato > 0 ? `${lot.rt_no_contrato} colaborador(es)` : "não há"}</span>
                {veFin && <span><b>Valor mensal do posto:</b> {brl(lot.valor_mensal_posto)}</span>}
              </div>
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onFechar()}>Cancelar</Button>
            <Button onClick={criar} disabled={salvar.isPending || !col}>{salvar.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />} Registrar e abrir a ficha</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Importar a planilha de telemedicina ──────────────────────────────
function ImportarPlanilha({ onFechar }: { onFechar: () => void }) {
  const [linhas, setLinhas] = useState<LinhaImportacao[] | null>(null);
  const [arquivo, setArquivo] = useState("");
  const [res, setRes] = useState<{ inseridos: number; atualizados: number; sem_cadastro: string[] } | null>(null);
  const imp = useImportarPlanilha();

  const ler = async (f: File) => {
    setArquivo(f.name); setRes(null);
    try {
      const wb = XLSX.read(await f.arrayBuffer());
      const abas = wb.SheetNames.map((n) => ({ nome: n, linhas: XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[n], { header: 1, raw: true, defval: null }) }));
      const l = lerPlanilhaTelemedicina(abas);
      if (!l.length) toast.error("Não achei as abas da planilha de telemedicina (Agendamentos / Não comparecimento / Redução).");
      setLinhas(l);
    } catch (e) { toast.error("Não consegui ler o arquivo: " + (e as Error).message); }
  };
  const resumo = useMemo(() => {
    if (!linhas) return null;
    const c = (f: (l: LinhaImportacao) => boolean) => linhas.filter(f).length;
    return { total: linhas.length, tele: c((l) => l.tele_status === "realizada"), nao: c((l) => l.tele_status === "nao_compareceu"),
      red: c((l) => l.tele_resultado === "reduzido" || l.tele_resultado === "zerado"), meses: [...new Set(linhas.map((l) => l.data_inicio.slice(0, 7)))].sort() };
  }, [linhas]);

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onFechar(); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>Importar a planilha de telemedicina</DialogTitle></DialogHeader>
        <div className="space-y-3 text-sm">
          <p className="text-muted-foreground">Lê as abas <b>Agendamentos</b>, <b>Não comparecimento</b> e <b>Redução de atestados</b>. Cada linha vira um afastamento com a lotação puxada do cadastro; a observação vira campos (dias reduzidos, assinatura, não compareceu, desligado). Reimportar atualiza sem duplicar.</p>
          <Input type="file" accept=".xlsx,.xls" onChange={(e) => { const f = e.target.files?.[0]; if (f) ler(f); }} />
          {resumo && (
            <div className="rounded-lg border bg-muted/30 p-3">
              <div className="font-semibold">{arquivo}</div>
              <div>{resumo.total} atestado(s) · {resumo.tele} avaliado(s) na telemedicina · {resumo.nao} não compareceu · {resumo.red} com dias reduzidos</div>
              <div className="text-xs text-muted-foreground">Meses: {resumo.meses.map(rotuloCompetencia).join(", ")}</div>
            </div>
          )}
          {res && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
              <div className="font-semibold text-emerald-800">{res.inseridos} importado(s), {res.atualizados} atualizado(s).</div>
              {res.sem_cadastro.length > 0 && (
                <div className="mt-1 text-xs text-amber-800">
                  {res.sem_cadastro.length} nome(s) sem cadastro igual em EMPREGADOS (entraram sem lotação — corrija o nome na ficha):
                  <div className="mt-1 max-h-28 overflow-y-auto">{res.sem_cadastro.join(" · ")}</div>
                </div>
              )}
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onFechar}>Fechar</Button>
            <Button disabled={!linhas?.length || imp.isPending} onClick={() => imp.mutateAsync(linhas!).then(setRes, (e) => toast.error((e as Error).message))}>
              {imp.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />} Importar {linhas?.length ?? 0} linha(s)
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
