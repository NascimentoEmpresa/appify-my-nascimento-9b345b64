import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CheckCircle2, ClipboardList, Clock, PieChart } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AcessoGate } from "@/components/auth/AcessoGate";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { fmtBRL } from "@/lib/conciliacaoBancariaEngine";
import { conciliacaoSemSaldoFinal, useCarregarSaldoFinalConciliacoes } from "@/hooks/useGerarResumoConciliacao";
import { registrosAtuais, saldosMensais, type SaldoMensal } from "@/lib/conciliacaoDashboard";
import { useFluxoCaixaCombinado } from "@/hooks/useFluxoCaixaMalote";
import { useCartaoBancos } from "@/hooks/useMaloteCartaoCredito";
import { useEmpresasGrupo } from "@/hooks/useMaloteDespesa";
import {
  useConciliacoesFluxoCaixaSalvas,
  useSaldosIniciaisConciliacao,
  useSalvarSaldoInicialConciliacao,
} from "@/hooks/useConciliacaoFluxoCaixa";

// SIS-2026-0713: dashboard de conciliações. Os registros vêm das conciliações salvas (um por empresa + banco + conta + período: salvar de novo
// o mesmo registro não duplica os indicadores). O Fluxo só entra para os saldos mensais, que são calculados empresa por empresa e banco por
// banco, sem somar nem compensar entre grupos.

const TODAS = "todas";
const isoParaBR = (iso: string) => iso.split("-").reverse().join("/");
const mesParaBR = (mes: string) => `${mes.slice(5, 7)}/${mes.slice(0, 4)}`;
const traco = "—";

function parseValor(txt: string): number | null {
  const t = txt.replace(/R\$|\s/g, "");
  if (!t) return null;
  const n = Number(t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : t);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

function BadgeConfere({ s }: { s: SaldoMensal }) {
  if (s.confere === "sim") return <Badge className="bg-green-100 text-green-700 border-green-200 hover:bg-green-100">Sim, saldos conferidos</Badge>;
  if (s.confere === "nao")
    return <Badge className="bg-red-100 text-red-700 border-red-200 hover:bg-red-100">Não, saldo divergente {s.diferenca != null ? `(${s.diferenca > 0 ? "+" : ""}${fmtBRL(s.diferenca)})` : ""}</Badge>;
  return <Badge className="bg-yellow-100 text-yellow-800 border-yellow-200 hover:bg-yellow-100">Pendente de conferência</Badge>;
}

export function DashboardConciliacoes({ onVerDetalhes }: { onVerDetalhes: (id: string) => void }) {
  const { data: salvas = [], isLoading } = useConciliacoesFluxoCaixaSalvas();
  const { data: bancos = [] } = useCartaoBancos();
  const { data: empresas = [] } = useEmpresasGrupo();
  const { data: linhasFluxo = [] } = useFluxoCaixaCombinado();
  const { data: iniciais = [] } = useSaldosIniciaisConciliacao();
  const salvarInicial = useSalvarSaldoInicialConciliacao();
  const carregarSaldos = useCarregarSaldoFinalConciliacoes();

  const hoje = new Date();
  const [empresaId, setEmpresaId] = useState(TODAS);
  const [bancoId, setBancoId] = useState(TODAS);
  const [mesDe, setMesDe] = useState(`${hoje.getFullYear()}-01`);
  const [mesAte, setMesAte] = useState("");
  const [situacao, setSituacao] = useState<"todas" | "concluida" | "pendente">(TODAS as "todas");
  const [subaba, setSubaba] = useState<"conciliacoes" | "saldos">("conciliacoes");
  const [rascunhoBase, setRascunhoBase] = useState<Record<string, string>>({});

  const empresaNome = (id: string) => empresas.find((e) => e.id === id)?.nome ?? "—";
  const bancoNome = (id: string | null) => (id ? bancos.find((b) => b.id === id)?.nome ?? "—" : "—");

  const atuais = useMemo(() => registrosAtuais(salvas), [salvas]);
  const todosSaldos = useMemo(() => saldosMensais(linhasFluxo, iniciais, salvas), [linhasFluxo, iniciais, salvas]);

  // Banco e conta só das opções que existem para a empresa escolhida.
  const bancosDaEmpresa = useMemo(() => {
    const ids = new Set<string>();
    for (const s of todosSaldos) if (empresaId === TODAS || s.empresaId === empresaId) ids.add(s.bancoId);
    for (const c of atuais) {
      if (c.banco_id && (empresaId === TODAS || c.todas_empresas || c.empresa_ids.includes(empresaId))) ids.add(c.banco_id);
    }
    return [...ids].map((id) => ({ id, nome: bancoNome(id) })).sort((a, b) => a.nome.localeCompare(b.nome));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [todosSaldos, atuais, empresaId, bancos]);

  const bancoValido = bancoId === TODAS || bancosDaEmpresa.some((b) => b.id === bancoId) ? bancoId : TODAS;

  const mesDoRegistro = (c: { data_fim: string }) => c.data_fim.slice(0, 7);
  const dentroDoPeriodo = (mes: string) => (!mesDe || mes >= mesDe) && (!mesAte || mes <= mesAte);

  // Registros concluídos (conciliação salva) + meses com movimento e sem conciliação (pendentes).
  const registros = useMemo(() => {
    const concluidos = atuais
      .filter((c) => (empresaId === TODAS || c.todas_empresas || c.empresa_ids.includes(empresaId)) && (bancoValido === TODAS || c.banco_id === bancoValido))
      .filter((c) => dentroDoPeriodo(mesDoRegistro(c)))
      .map((c) => ({ tipo: "concluida" as const, id: c.id, c }));
    const pendentes = todosSaldos
      .filter((s) => !s.conciliacaoId && s.entradas + s.saidas > 0)
      .filter((s) => (empresaId === TODAS || s.empresaId === empresaId) && (bancoValido === TODAS || s.bancoId === bancoValido) && dentroDoPeriodo(s.mes))
      .map((s) => ({ tipo: "pendente" as const, id: s.chave, s }));
    return { concluidos, pendentes };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [atuais, todosSaldos, empresaId, bancoValido, mesDe, mesAte]);

  const totalConcluidas = registros.concluidos.length;
  const totalPendentes = registros.pendentes.length;
  const cobertura = totalConcluidas + totalPendentes > 0 ? Math.round((totalConcluidas / (totalConcluidas + totalPendentes)) * 100) : null;
  const lista = [...(situacao === "pendente" ? [] : registros.concluidos), ...(situacao === "concluida" ? [] : registros.pendentes)];

  const saldosFiltrados = todosSaldos.filter(
    (s) => (empresaId === TODAS || s.empresaId === empresaId) && (bancoValido === TODAS || s.bancoId === bancoValido) && dentroDoPeriodo(s.mes),
  );
  const grupos = useMemo(() => {
    const m = new Map<string, SaldoMensal[]>();
    for (const s of todosSaldos) {
      if (!saldosFiltrados.includes(s)) continue;
      const k = `${s.empresaId}|${s.bancoId}`;
      m.set(k, [...(m.get(k) ?? []), s]);
    }
    return [...m.entries()].sort((a, b) => empresaNome(a[0].split("|")[0]).localeCompare(empresaNome(b[0].split("|")[0])) || bancoNome(a[0].split("|")[1]).localeCompare(bancoNome(b[0].split("|")[1])));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [todosSaldos, saldosFiltrados, empresas, bancos]);

  // Conciliações salvas antes do saldo final do extrato: relê o .OFX guardado de cada uma.
  const semSaldoFinal = useMemo(() => atuais.filter(conciliacaoSemSaldoFinal), [atuais]);
  async function carregarSaldosAntigos() {
    const r = await carregarSaldos.mutateAsync(semSaldoFinal);
    if (r.ok > 0) toast.success(`Saldo final carregado em ${r.ok} conciliação(ões).`);
    if (r.semSaldo > 0) toast.info(`${r.semSaldo} extrato(s) não trazem o saldo final (LEDGERBAL): ficam "Não informado".`);
    if (r.erros.length > 0) toast.error(r.erros[0] + (r.erros.length > 1 ? ` (e mais ${r.erros.length - 1} erro(s))` : ""));
  }

  // KPIs clicáveis: clicar mostra o respectivo item na lista (clicar de novo limpa). "% conciliado" mostra tudo (concluídas + pendentes).
  const kpis = [
    { rotulo: "Conciliações registradas", valor: String(totalConcluidas), situacao: "concluida" as const, Icone: ClipboardList, corIcone: "text-blue-300", anel: "ring-blue-400",
      rodape: "Clique para ver os registros", dica: "Um registro por empresa, banco, conta e período (salvar de novo não duplica)." },
    { rotulo: "Concluídas", valor: String(totalConcluidas), situacao: "concluida" as const, Icone: CheckCircle2, corIcone: "text-emerald-300", anel: "ring-emerald-400",
      rodape: "Clique para ver as concluídas", dica: "Só se salva a conciliação com tudo resolvido: toda conciliação registrada está concluída." },
    { rotulo: "Meses pendentes", valor: String(totalPendentes), situacao: "pendente" as const, Icone: Clock, corIcone: "text-amber-300", anel: "ring-amber-400",
      rodape: "Clique para ver quais meses", dica: "Mês com lançamento no Fluxo, para a empresa e o banco, e sem conciliação salva." },
    { rotulo: "% conciliado", valor: cobertura == null ? traco : `${cobertura}%`, situacao: "todas" as const, Icone: PieChart, corIcone: "text-purple-300", anel: "ring-purple-400",
      barra: cobertura, rodape: `${totalConcluidas} concluídas de ${totalConcluidas + totalPendentes}`, dica: "Concluídas ÷ (concluídas + meses pendentes)." },
  ];
  function escolherKpi(alvo: "todas" | "concluida" | "pendente") {
    setSituacao((atual) => (atual === alvo ? "todas" : alvo));
  }

  // Meses em que o saldo do sistema não bate com o do extrato (aparece como aviso na sub-aba).
  const divergentes = saldosFiltrados.filter((s) => s.confere === "nao").length;

  async function salvarBase(eId: string, bId: string, ano: number, chave: string) {
    const txt = rascunhoBase[chave];
    if (txt === undefined) return;
    const valor = parseValor(txt);
    if (txt.trim() && valor == null) {
      toast.error("Valor inválido para o saldo anterior de janeiro.");
      return;
    }
    try {
      await salvarInicial.mutateAsync({ empresaId: eId, bancoId: bId, conta: "", ano, valor });
      setRascunhoBase((r) => {
        const { [chave]: _, ...resto } = r;
        return resto;
      });
      toast.success(valor == null ? "Saldo anterior removido." : "Saldo anterior de janeiro salvo.");
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao salvar o saldo anterior.");
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Filtros</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3">
          <div>
            <Label className="text-xs">Empresa</Label>
            <Select value={empresaId} onValueChange={(v) => { setEmpresaId(v); setBancoId(TODAS); }}>
              <SelectTrigger className="h-9 w-56"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={TODAS}>Todas as empresas</SelectItem>
                {empresas.map((e) => <SelectItem key={e.id} value={e.id}>{e.nome}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Banco / conta</Label>
            <Select value={bancoValido} onValueChange={setBancoId}>
              <SelectTrigger className="h-9 w-56"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={TODAS}>Todos os bancos</SelectItem>
                {bancosDaEmpresa.map((b) => <SelectItem key={b.id} value={b.id}>{b.nome}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Competência — de</Label>
            <Input type="month" className="h-9 w-40" value={mesDe} onChange={(e) => setMesDe(e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">até</Label>
            <Input type="month" className="h-9 w-40" value={mesAte} onChange={(e) => setMesAte(e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">Situação da conciliação</Label>
            <Select value={situacao} onValueChange={(v) => setSituacao(v as typeof situacao)}>
              <SelectTrigger className="h-9 w-44"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todas">Todas</SelectItem>
                <SelectItem value="concluida">Concluída</SelectItem>
                <SelectItem value="pendente">Pendente (mês sem conciliação)</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Tabs value={subaba} onValueChange={(v) => setSubaba(v as typeof subaba)}>
        <TabsList>
          <TabsTrigger value="conciliacoes">Conciliações</TabsTrigger>
          <TabsTrigger value="saldos" className="gap-1.5">
            Saldos mensais
            {divergentes > 0 && <Badge className="bg-red-100 text-red-700 border-red-200 hover:bg-red-100 px-1.5 py-0 text-[10px]">{divergentes} divergente{divergentes > 1 ? "s" : ""}</Badge>}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="conciliacoes" className="mt-4 space-y-4">
      {/* Mesmo desenho dos KPIs do Painel Executivo de Licitações: ícone gigante ao fundo, translúcido, com fade para o centro. */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4 xl:items-stretch">
        {kpis.map((k) => {
          const ativo = k.situacao === situacao && situacao !== "todas";
          return (
            <button
              key={k.rotulo}
              type="button"
              title={k.dica}
              onClick={() => escolherKpi(k.situacao)}
              className={cn(
                "relative flex min-h-[110px] flex-col overflow-hidden rounded-xl bg-white p-5 text-left shadow-sm ring-1 ring-slate-200 transition-all hover:shadow-md focus:outline-none focus-visible:ring-2 dark:bg-card dark:ring-border",
                ativo && cn("ring-2 shadow-md", k.anel),
              )}
            >
              <div
                className="pointer-events-none absolute right-0 top-1/2 -translate-y-1/2 translate-x-2"
                style={{
                  fontSize: 0,
                  WebkitMaskImage: "linear-gradient(to left, black 0%, black 30%, rgba(0,0,0,0.6) 60%, transparent 100%)",
                  maskImage: "linear-gradient(to left, black 0%, black 30%, rgba(0,0,0,0.6) 60%, transparent 100%)",
                }}
              >
                <span className="[&>svg]:h-28 [&>svg]:w-28">
                  <k.Icone className={k.corIcone} strokeWidth={1.5} />
                </span>
              </div>
              <p className="relative z-10 mb-3 text-[10px] font-semibold uppercase tracking-widest text-slate-400">{k.rotulo}</p>
              <p className="relative z-10 text-3xl font-bold leading-none text-slate-900 dark:text-foreground">{k.valor}</p>
              <div className="relative z-10 mt-auto pt-3">
                {k.barra != null && (
                  <div className="mb-1.5 h-1.5 w-2/3 overflow-hidden rounded-full bg-slate-200">
                    <div className="h-full rounded-full bg-purple-400" style={{ width: `${k.barra}%` }} />
                  </div>
                )}
                <p className="text-[11px] leading-snug text-slate-500">{ativo ? "Na lista abaixo · clique para limpar" : k.rodape}</p>
              </div>
            </button>
          );
        })}
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">
            {situacao === "pendente" ? "Meses pendentes — sem conciliação salva" : situacao === "concluida" ? "Conciliações concluídas" : "Conciliações"}
            <span className="ml-2 font-normal text-muted-foreground">({lista.length})</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <p className="text-sm text-muted-foreground text-center py-10">Carregando...</p>
          ) : lista.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-10">Nenhum registro para os filtros escolhidos.</p>
          ) : (
            <div className="max-h-[420px] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10 bg-muted">
                <tr className="border-b bg-muted/40">
                  <th className="text-left px-4 py-2 font-medium text-muted-foreground">Empresa</th>
                  <th className="text-left px-4 py-2 font-medium text-muted-foreground">Banco / conta</th>
                  <th className="text-left px-4 py-2 font-medium text-muted-foreground">Mês / período</th>
                  <th className="text-center px-4 py-2 font-medium text-muted-foreground">Situação</th>
                  <th className="text-center px-4 py-2 font-medium text-muted-foreground">Pendências</th>
                  <th className="text-left px-4 py-2 font-medium text-muted-foreground">Última atualização</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody>
                {lista.map((r) =>
                  r.tipo === "concluida" ? (
                    <tr key={r.id} className="border-b">
                      <td className="px-4 py-2">{r.c.todas_empresas ? "Todas as empresas" : r.c.empresa_ids.map(empresaNome).join(", ") || traco}</td>
                      <td className="px-4 py-2 text-xs">
                        <div className="font-medium">{bancoNome(r.c.banco_id)}</div>
                        <div className="text-muted-foreground">{r.c.conta_extrato ?? traco}</div>
                      </td>
                      <td className="px-4 py-2">{isoParaBR(r.c.data_inicio)} — {isoParaBR(r.c.data_fim)}</td>
                      <td className="px-4 py-2 text-center"><Badge className="bg-green-100 text-green-700 border-green-200 hover:bg-green-100">Concluída</Badge></td>
                      <td className="px-4 py-2 text-center">0</td>
                      <td className="px-4 py-2 text-xs text-muted-foreground">{new Date(r.c.created_at).toLocaleString("pt-BR")}</td>
                      <td className="px-4 py-2 text-right"><Button size="sm" variant="ghost" onClick={() => onVerDetalhes(r.c.id)}>Ver detalhes</Button></td>
                    </tr>
                  ) : (
                    <tr key={r.id} className="border-b bg-yellow-50/50 dark:bg-yellow-950/10">
                      <td className="px-4 py-2">{empresaNome(r.s.empresaId)}</td>
                      <td className="px-4 py-2 text-xs"><div className="font-medium">{bancoNome(r.s.bancoId)}</div><div className="text-muted-foreground">{r.s.conta || traco}</div></td>
                      <td className="px-4 py-2">{mesParaBR(r.s.mes)}</td>
                      <td className="px-4 py-2 text-center"><Badge className="bg-yellow-100 text-yellow-800 border-yellow-200 hover:bg-yellow-100">Pendente</Badge></td>
                      <td className="px-4 py-2 text-center text-muted-foreground">{traco}</td>
                      <td className="px-4 py-2 text-xs text-muted-foreground">Sem conciliação salva</td>
                      <td className="px-4 py-2" />
                    </tr>
                  ),
                )}
              </tbody>
            </table>
            </div>
          )}
        </CardContent>
      </Card>

        </TabsContent>

        <TabsContent value="saldos" className="mt-4">
      <div className="space-y-3">
        <div>
          <h3 className="text-sm font-semibold">Saldos mensais por empresa e banco</h3>
          <p className="text-xs text-muted-foreground">
            Saldo do sistema = saldo anterior de janeiro (manual) + entradas − saídas, mês a mês. Saldo do extrato = saldo final lido do OFX da conciliação do mês.
            Diferença = sistema − extrato. Cada empresa e banco é conferido sozinho: nada é somado nem compensado entre grupos.
          </p>
        </div>
        {semSaldoFinal.length > 0 && (
          <AcessoGate menu="conciliacao-fluxo-caixa" acao="alterar">
            <div className="flex flex-wrap items-center gap-3 rounded-md border bg-muted/30 p-3 text-sm">
              <span className="flex-1 min-w-[260px] text-muted-foreground">
                {semSaldoFinal.length} conciliação(ões) salva(s) antes do saldo final do extrato. Dá para carregar agora: lê o saldo final do .OFX guardado
                (descontando o que se movimentou depois do último dia do período, se o arquivo passa dele).
              </span>
              <Button size="sm" onClick={() => void carregarSaldosAntigos()} disabled={carregarSaldos.isPending}>
                {carregarSaldos.isPending ? "Carregando..." : `Carregar saldo das ${semSaldoFinal.length} conciliações`}
              </Button>
            </div>
          </AcessoGate>
        )}
        {grupos.length === 0 && <p className="text-sm text-muted-foreground">Nenhum saldo para os filtros escolhidos.</p>}
        {grupos.map(([chave, meses]) => {
          const [eId, bId] = chave.split("|");
          const doGrupo = iniciais.filter((i) => i.empresa_id === eId && i.banco_id === bId);
          const ano = doGrupo.length ? Math.min(...doGrupo.map((i) => i.ano)) : Number(meses[0].mes.slice(0, 4));
          const salvo = doGrupo.filter((i) => i.ano === ano).reduce((t, i) => t + i.valor, 0);
          const campo = rascunhoBase[chave] ?? (doGrupo.length ? String(salvo).replace(".", ",") : "");
          const conta = meses.find((m) => m.conta)?.conta;
          return (
            <Card key={chave}>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex flex-wrap items-center gap-x-4 gap-y-2">
                  <span>{empresaNome(eId)} · {bancoNome(bId)}{conta ? ` · ${conta}` : ""}</span>
                  <AcessoGate menu="conciliacao-fluxo-caixa" acao="alterar">
                    <span className="flex items-center gap-2 text-xs font-normal">
                      <Label className="text-xs">Saldo anterior de janeiro/{ano} (manual)</Label>
                      <Input
                        className="h-8 w-36"
                        inputMode="decimal"
                        placeholder="Fechamento de dezembro"
                        value={campo}
                        onChange={(e) => setRascunhoBase((r) => ({ ...r, [chave]: e.target.value }))}
                      />
                      <Button size="sm" variant="outline" className="h-8" disabled={rascunhoBase[chave] === undefined || salvarInicial.isPending} onClick={() => void salvarBase(eId, bId, ano, chave)}>
                        Salvar
                      </Button>
                    </span>
                  </AcessoGate>
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b bg-muted/40">
                      <th className="text-left px-3 py-2">Competência</th>
                      <th className="text-right px-3 py-2">Entradas</th>
                      <th className="text-right px-3 py-2">Saídas</th>
                      <th className="text-right px-3 py-2">Saldo final (sistema)</th>
                      <th className="text-right px-3 py-2">Saldo final (extrato)</th>
                      <th className="text-right px-3 py-2">Diferença</th>
                      <th className="text-center px-3 py-2">Saldos conferem?</th>
                      <th className="px-3 py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {meses.map((s) => (
                      <tr key={s.chave} className="border-b">
                        <td className="px-3 py-2 font-medium">{mesParaBR(s.mes)}</td>
                        <td className="px-3 py-2 text-right text-emerald-700">{fmtBRL(s.entradas)}</td>
                        <td className="px-3 py-2 text-right text-rose-700">{fmtBRL(s.saidas)}</td>
                        <td className="px-3 py-2 text-right">{s.saldoSistema == null ? "Não informado" : fmtBRL(s.saldoSistema)}</td>
                        <td className="px-3 py-2 text-right">{s.saldoExtrato == null ? "Não informado" : fmtBRL(s.saldoExtrato)}</td>
                        <td className={cn("px-3 py-2 text-right font-medium", s.diferenca != null && s.diferenca !== 0 && "text-red-600")}>
                          {s.diferenca == null ? traco : fmtBRL(s.diferenca)}
                        </td>
                        <td className="px-3 py-2 text-center"><BadgeConfere s={s} /></td>
                        <td className="px-3 py-2 text-right">
                          <Button size="sm" variant="ghost" disabled={!s.conciliacaoId} title={s.conciliacaoId ? undefined : "Sem conciliação salva neste mês"} onClick={() => s.conciliacaoId && onVerDetalhes(s.conciliacaoId)}>
                            Ver detalhes
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          );
        })}
      </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
