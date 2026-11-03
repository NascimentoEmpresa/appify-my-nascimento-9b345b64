import { useMemo, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { AlertOctagon, ChevronLeft, ChevronRight, Eye, FileSpreadsheet, FileText, Landmark, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { useScreenAccess } from "@/hooks/useScreenAccess";
import { useConvencoes, useExcluirConvencao, nomeEmpresa, type Convencao } from "@/hooks/useConvencoes";
import { dataBr, identificacaoCct, pendenciasConvencao } from "@/lib/licitacoes/convencoes";
import { FormConvencao } from "@/components/licitacoes/convencoes/FormConvencao";

// =====================================================================
// Licitações › Convenções Coletivas e Decretos Municipais (27/10/2026,
// mig 20261027000930).
//
// Chamado: a Licitação cadastra e anexa a CCT/decreto com os benefícios e
// adicionais em campos próprios; na Planilha de Custo vincula a referência
// ao posto; na Abertura de Vagas o quadro de benefícios aparece sozinho.
// Layout pela referência do chamado: 4 KPIs, filtros, tabela com situação
// e o cadastro num painel lateral.
// =====================================================================

const MENU = "licitacoes_convencoes";
const TODOS = "__todos";

function Kpi({ icone, cor, titulo, valor, sub }: { icone: ReactNode; cor: string; titulo: string; valor: number; sub: string }) {
  return (
    <Card className="flex items-start gap-4 p-4">
      <span className={cn("flex h-11 w-11 shrink-0 items-center justify-center rounded-xl", cor)}>{icone}</span>
      <div>
        <p className="text-xs text-muted-foreground">{titulo}</p>
        <p className="text-3xl font-bold leading-tight text-foreground">{valor}</p>
        <p className="text-xs text-muted-foreground">{sub}</p>
      </div>
    </Card>
  );
}

const pct = (n: number, d: number) => (d ? `${(n / d * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%` : "0%");

export default function ConvencoesColetivas() {
  const { data: lista = [], isLoading, error } = useConvencoes();
  const excluir = useExcluirConvencao();
  const { data: podeIncluir = false } = useScreenAccess(MENU, "incluir");
  const { data: podeAlterar = false } = useScreenAccess(MENU, "alterar");
  const { data: podeExcluir = false } = useScreenAccess(MENU, "excluir");

  const [params, setParams] = useSearchParams();
  const [fEmpresa, setFEmpresa] = useState(TODOS);
  const [fContrato, setFContrato] = useState(TODOS);
  const [fSituacao, setFSituacao] = useState(TODOS);
  const [busca, setBusca] = useState("");
  const [pagina, setPagina] = useState(1);
  const [porPagina, setPorPagina] = useState(10);
  const [form, setForm] = useState<{ conv: Convencao | null; ler: boolean } | null>(null);

  // ?editar=<id> / ?ver=<id> — o "Editar se necessário" do quadro da vaga
  // abre aqui direto no cadastro de origem.
  const alvo = params.get("editar") ?? params.get("ver");
  const deLink = alvo ? lista.find((c) => c.id === alvo) ?? null : null;
  const formAberto = form ?? (deLink ? { conv: deLink, ler: !params.get("editar") || !podeAlterar } : null);
  const fechar = () => {
    setForm(null);
    if (alvo) { params.delete("editar"); params.delete("ver"); setParams(params, { replace: true }); }
  };

  const empresas = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of lista) m.set(c.empresa_id, nomeEmpresa(c.empresa));
    return [...m].sort((a, b) => a[1].localeCompare(b[1], "pt-BR"));
  }, [lista]);
  const contratos = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of lista) if (fEmpresa === TODOS || c.empresa_id === fEmpresa) m.set(c.contrato_id, c.contrato?.nome ?? "—");
    return [...m].sort((a, b) => a[1].localeCompare(b[1], "pt-BR"));
  }, [lista, fEmpresa]);

  const filtrados = useMemo(() => {
    const t = busca.trim().toLowerCase();
    return lista.filter((c) =>
      (fEmpresa === TODOS || c.empresa_id === fEmpresa)
      && (fContrato === TODOS || c.contrato_id === fContrato)
      && (fSituacao === TODOS || c.situacao === fSituacao)
      && (!t || [c.contrato?.nome, c.categoria_profissional, c.sindicato, identificacaoCct(c), c.decreto_numero, c.municipio, nomeEmpresa(c.empresa)]
        .some((x) => String(x ?? "").toLowerCase().includes(t))));
  }, [lista, fEmpresa, fContrato, fSituacao, busca]);

  const total = lista.length;
  const comCct = lista.filter((c) => !!c.cct_arquivo_path).length;
  const comDecreto = lista.filter((c) => !!c.decreto_numero).length;
  const pendentes = lista.filter((c) => c.situacao === "pendente").length;

  const paginas = Math.max(1, Math.ceil(filtrados.length / porPagina));
  const pag = Math.min(pagina, paginas);
  const visiveis = filtrados.slice((pag - 1) * porPagina, pag * porPagina);
  const limpar = () => { setFEmpresa(TODOS); setFContrato(TODOS); setFSituacao(TODOS); setBusca(""); setPagina(1); };

  const apagar = async (c: Convencao) => {
    if (!confirm(`Excluir a convenção de ${c.contrato?.nome ?? "contrato"}? Os anexos também saem.`)) return;
    try { await excluir.mutateAsync(c); toast.success("Convenção excluída."); }
    catch (e) { toast.error(e instanceof Error ? e.message : String(e)); }
  };

  return (
    <div className="space-y-5">
      <div>
        <nav className="mb-2 flex items-center gap-1.5 text-xs text-muted-foreground">
          <span>ERP</span><ChevronRight className="h-3 w-3" /><span>Licitações</span><ChevronRight className="h-3 w-3" />
          <span className="font-semibold text-foreground">Convenções Coletivas e Decretos Municipais</span>
        </nav>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="flex items-center gap-2.5 font-display text-2xl font-bold tracking-tight text-foreground lg:text-3xl">
              <FileText className="h-7 w-7 text-[#0f3171] dark:text-blue-300" />Convenções Coletivas e Decretos Municipais
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">Cadastro e consulta das convenções coletivas, decretos municipais e benefícios por contrato.</p>
          </div>
          {podeIncluir && (
            <Button onClick={() => setForm({ conv: null, ler: false })} className="bg-[#0f3171] hover:bg-[#0c2860]">
              <Plus className="mr-1 h-4 w-4" />Nova convenção
            </Button>
          )}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi icone={<FileSpreadsheet className="h-5 w-5 text-[#0f3171] dark:text-blue-300" />} cor="bg-blue-50 dark:bg-blue-950/40"
          titulo="Total de Registros" valor={total} sub={`${total === 1 ? "contrato cadastrado" : "contratos cadastrados"}`} />
        <Kpi icone={<FileText className="h-5 w-5 text-emerald-600" />} cor="bg-emerald-50 dark:bg-emerald-950/40"
          titulo="Com Convenção Coletiva" valor={comCct} sub={`${pct(comCct, total)} dos contratos`} />
        <Kpi icone={<Landmark className="h-5 w-5 text-amber-600" />} cor="bg-amber-50 dark:bg-amber-950/40"
          titulo="Com Decreto Municipal" valor={comDecreto} sub={`${pct(comDecreto, total)} dos contratos`} />
        <Kpi icone={<AlertOctagon className="h-5 w-5 text-red-600" />} cor="bg-red-50 dark:bg-red-950/40"
          titulo="Pendentes de Cadastro" valor={pendentes} sub={`${pct(pendentes, total)} dos contratos`} />
      </div>

      <Card className="flex flex-wrap items-center gap-2 p-3">
        <Select value={fEmpresa} onValueChange={(v) => { setFEmpresa(v); setFContrato(TODOS); setPagina(1); }}>
          <SelectTrigger className="h-9 w-[170px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={TODOS}>Todas as empresas</SelectItem>
            {empresas.map(([id, nome]) => <SelectItem key={id} value={id}>{nome}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={fContrato} onValueChange={(v) => { setFContrato(v); setPagina(1); }}>
          <SelectTrigger className="h-9 w-[200px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={TODOS}>Todos os contratos</SelectItem>
            {contratos.map(([id, nome]) => <SelectItem key={id} value={id}>{nome}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={fSituacao} onValueChange={(v) => { setFSituacao(v); setPagina(1); }}>
          <SelectTrigger className="h-9 w-[140px]"><SelectValue placeholder="Situação" /></SelectTrigger>
          <SelectContent>
            <SelectItem value={TODOS}>Situação</SelectItem>
            <SelectItem value="completo">Completo</SelectItem>
            <SelectItem value="pendente">Pendente</SelectItem>
          </SelectContent>
        </Select>
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={busca} onChange={(e) => { setBusca(e.target.value); setPagina(1); }} placeholder="Buscar por contrato, CCT, categoria, sindicato…" className="h-9 pl-9" />
        </div>
        <Button variant="outline" onClick={limpar} className="h-9 font-semibold text-[#0f3171] dark:text-blue-300">Limpar filtros</Button>
      </Card>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] text-sm">
            <thead>
              <tr className="border-b text-left text-xs font-medium text-muted-foreground">
                <th className="px-4 py-3">Contrato</th>
                <th className="px-4 py-3">Empresa</th>
                <th className="px-4 py-3">Categoria Profissional</th>
                <th className="px-4 py-3">Sindicato</th>
                <th className="px-4 py-3">CCT</th>
                <th className="px-4 py-3">Decreto Municipal</th>
                <th className="px-4 py-3">Última Atualização</th>
                <th className="px-4 py-3">Situação</th>
                <th className="px-4 py-3 text-center">Ações</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={9} className="p-4"><Skeleton className="h-32 w-full" /></td></tr>
              ) : error ? (
                <tr><td colSpan={9} className="px-4 py-10 text-center text-muted-foreground">Não foi possível carregar: {String((error as Error).message ?? error)}</td></tr>
              ) : visiveis.length === 0 ? (
                <tr><td colSpan={9} className="px-4 py-10 text-center text-muted-foreground">{total ? "Nada com esses filtros." : "Nenhuma convenção cadastrada ainda."}</td></tr>
              ) : visiveis.map((c) => {
                const ident = c.cct_arquivo_path || c.vigencia_inicio ? identificacaoCct(c) : null;
                const pend = c.situacao === "pendente" ? pendenciasConvencao(c) : [];
                return (
                  <tr key={c.id} className="border-b last:border-0 hover:bg-muted/30">
                    <td className="px-4 py-3 font-semibold uppercase text-foreground">{c.contrato?.nome ?? "—"}</td>
                    <td className="px-4 py-3 text-muted-foreground">{nomeEmpresa(c.empresa)}</td>
                    <td className="max-w-[160px] px-4 py-3 text-muted-foreground">{c.categoria_profissional || "—"}</td>
                    <td className="px-4 py-3 text-muted-foreground">{c.sindicato || "—"}</td>
                    <td className="px-4 py-3">
                      {ident ? <span className="whitespace-nowrap rounded-md bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700 dark:bg-blue-950/40 dark:text-blue-300">{ident}</span> : <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="px-4 py-3">
                      {c.decreto_numero ? <span className="whitespace-nowrap rounded-md bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">{c.decreto_numero}</span> : <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="px-4 py-3 tabular-nums text-muted-foreground">{dataBr(c.updated_at)}</td>
                    <td className="px-4 py-3">
                      <span title={pend.join("\n") || undefined}
                        className={cn("rounded-md px-2.5 py-1 text-xs font-semibold",
                          c.situacao === "completo" ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300"
                            : "bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300")}>
                        {c.situacao === "completo" ? "Completo" : "Pendente"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-center gap-1.5">
                        <button onClick={() => setForm({ conv: c, ler: true })} title="Visualizar"
                          className="flex h-8 w-8 items-center justify-center rounded-md border text-[#0f3171] hover:bg-muted dark:text-blue-300"><Eye className="h-4 w-4" /></button>
                        {podeAlterar && (
                          <button onClick={() => setForm({ conv: c, ler: false })} title="Editar"
                            className="flex h-8 w-8 items-center justify-center rounded-md border text-[#0f3171] hover:bg-muted dark:text-blue-300"><Pencil className="h-4 w-4" /></button>
                        )}
                        {podeExcluir && (
                          <button onClick={() => apagar(c)} title="Excluir"
                            className="flex h-8 w-8 items-center justify-center rounded-md border text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40"><Trash2 className="h-4 w-4" /></button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3 text-xs text-muted-foreground">
          <span>
            {filtrados.length
              ? `Exibindo ${(pag - 1) * porPagina + 1} a ${Math.min(pag * porPagina, filtrados.length)} de ${filtrados.length} registros`
              : "Nenhum registro"}
          </span>
          <div className="flex items-center gap-1.5">
            <Button variant="outline" size="icon" className="h-8 w-8" disabled={pag <= 1} onClick={() => setPagina(pag - 1)}><ChevronLeft className="h-4 w-4" /></Button>
            {Array.from({ length: paginas }, (_, i) => i + 1)
              .filter((p) => p === 1 || p === paginas || Math.abs(p - pag) <= 2)
              .map((p) => (
                <Button key={p} variant={p === pag ? "default" : "outline"} size="icon"
                  className={cn("h-8 w-8", p === pag && "bg-[#0f3171] hover:bg-[#0c2860]")} onClick={() => setPagina(p)}>{p}</Button>
              ))}
            <Button variant="outline" size="icon" className="h-8 w-8" disabled={pag >= paginas} onClick={() => setPagina(pag + 1)}><ChevronRight className="h-4 w-4" /></Button>
            <Select value={String(porPagina)} onValueChange={(v) => { setPorPagina(Number(v)); setPagina(1); }}>
              <SelectTrigger className="ml-2 h-8 w-[72px]"><SelectValue /></SelectTrigger>
              <SelectContent>{[10, 25, 50].map((n) => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        </div>
      </Card>

      <FormConvencao aberto={!!formAberto} onFechar={fechar} convencao={formAberto?.conv ?? null}
        somenteLeitura={formAberto?.ler} existentes={lista} />
    </div>
  );
}
