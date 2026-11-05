import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ChevronLeft, ChevronRight, Loader2, Network, ThumbsDown, ThumbsUp, Users, Workflow } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useScreenAccess } from "@/hooks/useScreenAccess";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { LinhaMovimentacao } from "@/components/organograma/PerfilPessoaDialog";
import { cn } from "@/lib/utils";
import { hojeLocal, ROTULO_NATUREZA, ROTULO_TIPO, type Movimentacao, type Natureza } from "@/lib/organograma/pessoas";

// =====================================================================
// DASHBOARD DE GESTÃO (04/11/2026, mig 20261104009000)
//
// "Toda atitude (positiva ou negativa) que gere uma movimentação ou feedback
// deve ficar registrada no perfil do liderado e impactar o contrato/setor
// correspondente." Uma leitura só: movimentações do organograma, advertências
// (Jurídico) e trocas de função (RH). Os totais vêm do banco.
// =====================================================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as any;
const POR_PAGINA = 30;

interface Grupo { total: number; positivas: number; negativas: number; neutras: number }
interface PorContrato extends Grupo { empresa: number | null; filial: number | null; contrato: string }
interface PorSetor extends Grupo { setor: string }
interface Painel {
  kpis: { total: number; positivas: number; negativas: number; neutras: number; pessoas: number };
  estrutura: { pessoas: number; pendentes: number };
  por_contrato: PorContrato[]; por_setor: PorSetor[]; por_tipo: { tipo: string; total: number }[]; lista: Movimentacao[];
  setores: string[]; contratos: { empresa: number; filial: number; nome: string }[];
}

const CLASSE_SELECT = "h-9 rounded-md border border-input bg-background px-2 text-sm";

function Kpi({ titulo, valor, icone: Icone, cor, sub }: { titulo: string; valor: number; icone: typeof Users; cor?: string; sub?: string }) {
  return (
    <Card className="flex items-center gap-3 p-4">
      <span className={cn("grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-muted", cor)}><Icone className="h-5 w-5" /></span>
      <div className="min-w-0">
        <p className="truncate text-[11px] font-semibold uppercase text-muted-foreground">{titulo}</p>
        <p className="text-2xl font-extrabold tabular-nums">{valor.toLocaleString("pt-BR")}</p>
        {sub && <p className="truncate text-[11px] text-muted-foreground">{sub}</p>}
      </div>
    </Card>
  );
}

function TabelaImpacto({ titulo, linhas, ativo, onLinha }: {
  titulo: string;
  linhas: (Grupo & { rotulo: string; chave: string })[];
  ativo: string | null;
  onLinha: (chave: string) => void;
}) {
  return (
    <Card className="min-w-0 overflow-hidden">
      <p className="border-b px-4 py-2.5 text-sm font-bold">{titulo}</p>
      {linhas.length ? (
        <div className="max-h-80 overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-card text-[11px] uppercase text-muted-foreground">
              <tr><th className="px-4 py-1.5 text-left font-semibold">Nome</th><th className="px-2 py-1.5 text-right font-semibold">Pos.</th><th className="px-2 py-1.5 text-right font-semibold">Neg.</th><th className="px-4 py-1.5 text-right font-semibold">Total</th></tr>
            </thead>
            <tbody>
              {linhas.map((l) => (
                <tr key={l.chave} onClick={() => onLinha(l.chave)} className={cn("cursor-pointer border-t hover:bg-muted/60", ativo === l.chave && "bg-primary/10")}>
                  <td className="max-w-0 truncate px-4 py-1.5" title={l.rotulo}>{l.rotulo}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-emerald-700 dark:text-emerald-300">{l.positivas}</td>
                  <td className="px-2 py-1.5 text-right font-semibold tabular-nums text-red-700 dark:text-red-300">{l.negativas}</td>
                  <td className="px-4 py-1.5 text-right tabular-nums">{l.total}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <p className="p-4 text-sm text-muted-foreground">Nada no período.</p>}
    </Card>
  );
}

export default function GestaoOrganograma() {
  const acesso = useScreenAccess("organograma_gestao", "visualizar");
  // Do 1º dia de dois meses atrás até hoje.
  const inicio = (() => { const [a, m] = hojeLocal().split("-").map(Number); const d = new Date(a, m - 3, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`; })();

  const [de, setDe] = useState(inicio);
  const [ate, setAte] = useState(hojeLocal());
  const [contrato, setContrato] = useState<string | null>(null);
  const [setor, setSetor] = useState<string | null>(null);
  const [natureza, setNatureza] = useState<Natureza | null>(null);
  const [tipo, setTipo] = useState<string | null>(null);
  const [busca, setBusca] = useState("");
  const [buscaAplicada, setBuscaAplicada] = useState("");
  const [pagina, setPagina] = useState(0);

  const [empresa, filial] = contrato ? contrato.split("-").map((x) => (x ? Number(x) : null)) : [null, null];
  const filtros = { de, ate, empresa, filial, setor, natureza, tipo, buscaAplicada, pagina };
  const q = useQuery({
    queryKey: ["organograma-gestao", filtros],
    enabled: acesso.data === true,
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const { data, error } = await sb.rpc("organograma_gestao_painel", {
        p_de: de || null, p_ate: ate || null, p_empresa: empresa, p_filial: filial, p_setor: setor, p_natureza: natureza,
        p_tipo: tipo, p_busca: buscaAplicada || null, p_offset: pagina * POR_PAGINA, p_limite: POR_PAGINA,
      });
      if (error) throw error;
      return data as Painel;
    },
  });
  const p = q.data?.kpis ? q.data : undefined;
  const filtrou = <T,>(set: (v: T) => void) => (v: T) => { set(v); setPagina(0); };

  if (acesso.isLoading) return <Card className="flex items-center gap-2 p-6 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Carregando…</Card>;
  if (acesso.data !== true) {
    return (
      <div>
        <PageHeader title="Dashboard de Gestão" module="Organograma" breadcrumb={["Organograma", "Dashboard de Gestão"]} />
        <Card className="p-6 text-sm text-muted-foreground">Você não tem liberação para o Dashboard de Gestão. Peça em Administração › Acesso por Usuário.</Card>
      </div>
    );
  }

  const totalLista = p?.kpis.total ?? 0;

  return (
    <div>
      <PageHeader
        title="Dashboard de Gestão"
        subtitle="Movimentações e feedbacks de cada pessoa, somados por contrato e setor."
        module="Organograma"
        breadcrumb={["Organograma", "Dashboard de Gestão"]}
        actions={<Button variant="outline" asChild className="gap-1.5"><Link to="/app/organograma"><Network className="h-4 w-4" /> Ver organograma</Link></Button>}
      />

      <Card className="mb-3 flex flex-wrap items-end gap-2 p-3">
        <label className="text-[11px] font-semibold text-muted-foreground">De<Input type="date" className="mt-0.5 h-9 w-[150px]" value={de} onChange={(e) => filtrou(setDe)(e.target.value)} /></label>
        <label className="text-[11px] font-semibold text-muted-foreground">Até<Input type="date" className="mt-0.5 h-9 w-[150px]" value={ate} onChange={(e) => filtrou(setAte)(e.target.value)} /></label>
        <label className="min-w-[200px] flex-1 text-[11px] font-semibold text-muted-foreground">Contrato
          <select className={cn(CLASSE_SELECT, "mt-0.5 w-full font-normal text-foreground")} value={contrato ?? ""} onChange={(e) => filtrou(setContrato)(e.target.value || null)}>
            <option value="">Todos</option>
            {p?.contratos.map((c) => <option key={`${c.empresa}-${c.filial}`} value={`${c.empresa}-${c.filial}`}>{c.nome}</option>)}
          </select>
        </label>
        <label className="text-[11px] font-semibold text-muted-foreground">Setor
          <select className={cn(CLASSE_SELECT, "mt-0.5 block w-[170px] font-normal text-foreground")} value={setor ?? ""} onChange={(e) => filtrou(setSetor)(e.target.value || null)}>
            <option value="">Todos</option>
            {p?.setores.map((s) => <option key={s}>{s}</option>)}
          </select>
        </label>
        <label className="text-[11px] font-semibold text-muted-foreground">Natureza
          <select className={cn(CLASSE_SELECT, "mt-0.5 block w-[120px] font-normal text-foreground")} value={natureza ?? ""} onChange={(e) => filtrou(setNatureza)((e.target.value || null) as Natureza | null)}>
            <option value="">Todas</option>
            {(Object.keys(ROTULO_NATUREZA) as Natureza[]).map((n) => <option key={n} value={n}>{ROTULO_NATUREZA[n]}</option>)}
          </select>
        </label>
        <label className="text-[11px] font-semibold text-muted-foreground">Tipo
          <select className={cn(CLASSE_SELECT, "mt-0.5 block w-[170px] font-normal text-foreground")} value={tipo ?? ""} onChange={(e) => filtrou(setTipo)(e.target.value || null)}>
            <option value="">Todos</option>
            {Object.entries(ROTULO_TIPO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <form className="flex items-end gap-1" onSubmit={(e) => { e.preventDefault(); setBuscaAplicada(busca.trim()); setPagina(0); }}>
          <label className="text-[11px] font-semibold text-muted-foreground">Pessoa<Input className="mt-0.5 h-9 w-[170px]" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Nome…" /></label>
          <Button type="submit" variant="outline" size="sm" className="h-9">Buscar</Button>
        </form>
      </Card>

      {q.isError && <Card className="mb-3 p-4 text-sm text-destructive">{(q.error as Error).message}</Card>}
      {q.isLoading && <Card className="flex items-center gap-2 p-6 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Somando…</Card>}

      {p && (
        <>
          <div className="mb-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi titulo="Movimentações" valor={p.kpis.total} icone={Workflow} sub={`${p.kpis.pessoas.toLocaleString("pt-BR")} pessoa(s) envolvida(s)`} />
            <Kpi titulo="Positivas" valor={p.kpis.positivas} icone={ThumbsUp} cor="text-emerald-700 dark:text-emerald-300" />
            <Kpi titulo="Negativas" valor={p.kpis.negativas} icone={ThumbsDown} cor="text-red-700 dark:text-red-300" />
            <Kpi titulo="No organograma" valor={p.estrutura.pessoas} icone={Users} sub={p.estrutura.pendentes ? `${p.estrutura.pendentes.toLocaleString("pt-BR")} sem superior definido` : "Todos com superior"} />
          </div>

          <div className="mb-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
            <TabelaImpacto titulo="Por contrato" ativo={contrato}
              linhas={p.por_contrato.map((c) => ({ ...c, rotulo: c.contrato, chave: `${c.empresa ?? ""}-${c.filial ?? ""}` }))}
              onLinha={(k) => filtrou(setContrato)(contrato === k ? null : k)} />
            <TabelaImpacto titulo="Por setor" ativo={setor}
              linhas={p.por_setor.map((s) => ({ ...s, rotulo: s.setor, chave: s.setor }))}
              onLinha={(k) => filtrou(setSetor)(setor === k ? null : k)} />
          </div>

          <Card className="p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="text-sm font-bold">Histórico</p>
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <span className="tabular-nums">{totalLista ? `${pagina * POR_PAGINA + 1}–${Math.min((pagina + 1) * POR_PAGINA, totalLista)} de ${totalLista.toLocaleString("pt-BR")}` : "0"}</span>
                <Button variant="ghost" size="icon" className="h-7 w-7" title="Anterior" disabled={pagina === 0} onClick={() => setPagina((x) => x - 1)}><ChevronLeft className="h-4 w-4" /></Button>
                <Button variant="ghost" size="icon" className="h-7 w-7" title="Próxima" disabled={(pagina + 1) * POR_PAGINA >= totalLista} onClick={() => setPagina((x) => x + 1)}><ChevronRight className="h-4 w-4" /></Button>
              </div>
            </div>
            {p.lista.length ? (
              <ul className="grid grid-cols-1 gap-1.5 lg:grid-cols-2">{p.lista.map((m) => <LinhaMovimentacao key={m.chave} m={m} comPessoa />)}</ul>
            ) : <p className="p-4 text-center text-sm text-muted-foreground">Nenhuma movimentação com estes filtros.</p>}
          </Card>
        </>
      )}
    </div>
  );
}
