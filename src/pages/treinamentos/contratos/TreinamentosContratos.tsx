import { useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { BarChart3, Building2, ChevronRight, Loader2, Search } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { useContratosTreinamento } from "@/hooks/useTreinamentosContrato";
import { EMPRESAS_TREINAMENTO, fmtDataBr, siglaEmpresa } from "@/lib/treinamentos/contratoTreinamento";

// =====================================================================
// TREINAMENTOS › POR CONTRATO (mig 20261104006000, 04/11/2026)
//
// Entrada da área: TREINAMENTOS → empresa (HAGG, NH, SN) → contrato →
// treinamento. Contrato é o de "CONTRATOS" (ativos, mais os inativos que já
// tiveram treinamento), pela RPC trn_ct_contratos.
// =====================================================================

export default function TreinamentosContratos() {
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const contratos = useContratosTreinamento(null);
  const [busca, setBusca] = useState("");
  const [soComTreinamento, setSoComTreinamento] = useState(false);

  const todos = useMemo(() => contratos.data ?? [], [contratos.data]);
  const empresas = useMemo(() => {
    const extras = Array.from(new Set(todos.map((c) => c.empresa))).filter((e) => !EMPRESAS_TREINAMENTO.some((x) => x.codigo === e)).sort((a, b) => a - b);
    return [...EMPRESAS_TREINAMENTO.map((e) => e.codigo), ...extras].map((codigo) => {
      const lista = todos.filter((c) => c.empresa === codigo);
      return {
        codigo, sigla: siglaEmpresa(codigo), contratos: lista.length,
        treinamentos: lista.reduce((a, c) => a + c.treinamentos, 0),
        participantes: lista.reduce((a, c) => a + c.participantes, 0),
      };
    });
  }, [todos]);

  const empresa = Number(params.get("empresa") ?? EMPRESAS_TREINAMENTO[0].codigo);
  const escolher = (codigo: number) => { params.set("empresa", String(codigo)); setParams(params, { replace: true }); };

  const visiveis = useMemo(() => {
    const t = busca.trim().toLowerCase();
    return todos
      .filter((c) => c.empresa === empresa && (!soComTreinamento || c.treinamentos > 0)
        && (!t || c.nome.toLowerCase().includes(t) || String(c.filial).includes(t)))
      .sort((a, b) => (b.treinamentos > 0 ? 1 : 0) - (a.treinamentos > 0 ? 1 : 0) || a.nome.localeCompare(b.nome, "pt-BR"));
  }, [todos, empresa, busca, soComTreinamento]);

  return (
    <div className="space-y-4">
      <PageHeader title="Treinamentos por Contrato" module="Treinamentos" breadcrumb={["Treinamentos por Contrato"]}
        subtitle="Escolha a empresa e o contrato para registrar treinamentos, fotos, lista de presença, avaliações e pesquisa de satisfação."
        actions={<Button variant="outline" asChild><Link to="/app/treinamentos/contratos/relatorios"><BarChart3 className="mr-2 h-4 w-4" />Relatórios</Link></Button>} />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {empresas.map((e) => (
          <button key={e.codigo} onClick={() => escolher(e.codigo)}
            className={cn("rounded-xl border bg-card p-4 text-left transition hover:border-primary/60 hover:shadow-sm",
              e.codigo === empresa && "border-primary ring-2 ring-primary/20")}>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary"><Building2 className="h-5 w-5" /></div>
              <div>
                <p className="text-lg font-bold leading-tight">{e.sigla}</p>
                <p className="text-xs text-muted-foreground">{e.contratos} contrato(s)</p>
              </div>
            </div>
            <div className="mt-3 flex gap-4 text-xs text-muted-foreground">
              <span><b className="text-foreground">{e.treinamentos}</b> treinamento(s)</span>
              <span><b className="text-foreground">{e.participantes}</b> presença(s)</span>
            </div>
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-full max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input className="pl-8" placeholder={`Buscar contrato da ${siglaEmpresa(empresa)}`} value={busca} onChange={(e) => setBusca(e.target.value)} />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={soComTreinamento} onCheckedChange={(v) => setSoComTreinamento(v === true)} /> Só contratos com treinamento
        </label>
      </div>

      <div className="rounded-xl border bg-card">
        {contratos.isLoading ? (
          <div className="flex items-center justify-center p-10 text-muted-foreground"><Loader2 className="mr-2 h-4 w-4 animate-spin" />Carregando contratos…</div>
        ) : contratos.error ? (
          <p className="p-6 text-sm text-destructive">{(contratos.error as Error).message}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Contrato</TableHead>
                <TableHead className="w-24">Filial</TableHead>
                <TableHead className="w-32 text-right">Treinamentos</TableHead>
                <TableHead className="w-32 text-right">Presenças</TableHead>
                <TableHead className="w-32">Último</TableHead>
                <TableHead className="w-8" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {visiveis.length === 0 && <TableRow><TableCell colSpan={6} className="py-8 text-center text-muted-foreground">Nenhum contrato encontrado.</TableCell></TableRow>}
              {visiveis.map((c) => (
                <TableRow key={`${c.empresa}-${c.filial}`} className="cursor-pointer" onClick={() => nav(`/app/treinamentos/contratos/${c.empresa}/${c.filial}`)}>
                  <TableCell className="font-medium">{c.nome} {!c.ativo && <Badge variant="outline" className="ml-2">inativo</Badge>}</TableCell>
                  <TableCell>{c.filial}</TableCell>
                  <TableCell className="text-right">{c.treinamentos || "—"}</TableCell>
                  <TableCell className="text-right">{c.participantes || "—"}</TableCell>
                  <TableCell>{fmtDataBr(c.ultimo)}</TableCell>
                  <TableCell><ChevronRight className="h-4 w-4 text-muted-foreground" /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}
