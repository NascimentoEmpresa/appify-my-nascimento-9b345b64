import { useMemo, useState } from "react";
import {
  Activity, AlertTriangle, Bug, CheckCircle2, ChevronDown, ChevronRight, ClipboardList, FileSpreadsheet, Gauge, GraduationCap,
  History, Info, Layers, ListChecks, Loader2, Pencil, RefreshCw, Rocket, Search, ShieldCheck, Wrench, XCircle,
} from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { usePermissoes } from "@/context/PermissoesContext";
import { useChecklistDados } from "@/hooks/useChecklistModulos";
import { cn } from "@/lib/utils";
import {
  FILTROS_VAZIOS, OPCOES_DEV, OPCOES_TREINAMENTO, OPCOES_VALIDACAO, ROTULO_PENDENTE, filtrarModulos, indicadores, montarModulos,
  opcaoDe, pct, type FiltrosChecklist, type LinhaModulo, type LinhaTela, type StatusDev,
} from "@/lib/sistemas/checklistModulos";
import { BarraEfetividade, MENU_CHECKLIST, PONTO_TOM, Tile, fmtDataHora } from "./ui";
import { TabelaTelas } from "./TabelaTelas";
import { ItemDialog } from "./ItemDialog";
import { ModuloSheet } from "./ModuloSheet";
import { BugsPainel, type NovoBugPadrao } from "./BugsPainel";
import { UsoPainel } from "./UsoPainel";
import { HistoricoLista } from "./HistoricoLista";

// =====================================================================
// Sistemas › CHECKLIST DE MÓDULOS (02/10/2026, mig 20260930000291)
//
// Solicitação: "acompanhar criação, implantação, treinamento, medição de uso
// de cada módulo por cada usuário, cadastro de bugs e encaminhamento inicial
// de chamados". Pedido do Pablo: todos os sistemas na tela; clicou no
// módulo, aparecem os submódulos e o status de tudo; começa PENDENTE de
// preenchimento — o gerente de sistemas preenche.
//
// O catálogo é o próprio cadastro de acesso (app_modulo + app_menu com
// rota): tela nova entra sozinha. Abas: Checklist (status por tela, com
// edição), Uso do ERP (medição pelo RouteGuard), Bugs (registro, triagem e
// "encaminhar como chamado") e Histórico (cada mudança, por gatilho).
// Regras e contas: src/lib/sistemas/checklistModulos.ts (com teste).
// =====================================================================

const TODOS = "__todos";
const ORDEM_DEV: (StatusDev | "pendente")[] = ["pronto", "em_homologacao", "em_desenvolvimento", "nao_iniciado", "pendente"];
const ROTULO_DEV_RESUMO: Record<StatusDev | "pendente", string> = {
  pronto: "Pronto", em_homologacao: "Em homologação", em_desenvolvimento: "Em desenvolvimento", nao_iniciado: "Não iniciado", pendente: "Pendente de preenchimento",
};
const tomDev = (k: StatusDev | "pendente") => (k === "pendente" ? "pendente" : opcaoDe("dev", k)!.tom);

export default function ChecklistModulos() {
  const q = useChecklistDados();
  const { can } = usePermissoes();
  const podeAlterar = can("alterar", undefined, MENU_CHECKLIST);
  const podeIncluir = can("incluir", undefined, MENU_CHECKLIST) || podeAlterar;
  const podeExcluir = can("excluir", undefined, MENU_CHECKLIST);
  const podeExportar = can("exportar", undefined, MENU_CHECKLIST);

  const [aba, setAba] = useState("checklist");
  const [f, setF] = useState<FiltrosChecklist>(FILTROS_VAZIOS);
  const [abertos, setAbertos] = useState<Set<string>>(new Set());
  const [editando, setEditando] = useState<Parameters<typeof ItemDialog>[0]["alvo"]>(null);
  const [detalhe, setDetalhe] = useState<string | null>(null);
  const [novoBug, setNovoBug] = useState<NovoBugPadrao | null>(null);

  const dados = q.data;
  const modulos = useMemo(() => (dados ? montarModulos(dados) : []), [dados]);
  const filtrados = useMemo(() => filtrarModulos(modulos, f), [modulos, f]);
  const ind = useMemo(() => indicadores(modulos), [modulos]);
  const nomeUsuario = useMemo(() => new Map((dados?.usuarios ?? []).map((u) => [u.id, u.nome])), [dados?.usuarios]);
  const responsaveis = useMemo(() => {
    const ids = new Set<string>();
    dados?.checklist.forEach((c) => c.responsavel_id && ids.add(c.responsavel_id));
    return [...ids].map((id) => ({ id, nome: nomeUsuario.get(id) ?? "—" })).sort((a, b) => a.nome.localeCompare(b.nome));
  }, [dados?.checklist, nomeUsuario]);
  const porDevGeral = useMemo(() => {
    const r: Record<StatusDev | "pendente", number> = { pronto: 0, em_homologacao: 0, em_desenvolvimento: 0, nao_iniciado: 0, pendente: 0 };
    modulos.filter((m) => m.modulo.ativo).forEach((m) => ORDEM_DEV.forEach((k) => { r[k] += m.porDev[k]; }));
    return r;
  }, [modulos]);
  const bugsAbertos = ind.bugsAbertos;
  const moduloDetalhe = modulos.find((m) => m.modulo.id === detalhe) ?? null;

  const mudar = (p: Partial<FiltrosChecklist>) => setF((x) => ({ ...x, ...p }));
  const filtrosAtivos = [f.modulo, f.dev, f.treinamento, f.validacao, f.responsavel, f.busca.trim()].filter(Boolean).length + (f.soPendentes ? 1 : 0) + (f.mostrarInativas ? 1 : 0);
  const alternar = (id: string) => setAbertos((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const temFiltroTela = !!(f.dev || f.treinamento || f.validacao || f.responsavel || f.busca.trim() || f.soPendentes);

  const editarTela = (m: LinhaModulo, t: LinhaTela) => setEditando({ moduloId: m.modulo.id, moduloNome: m.modulo.nome, menuId: t.tela.id, telaNome: t.tela.nome, rota: t.tela.rota, item: t.item });
  const editarModulo = (m: LinhaModulo) => setEditando({ moduloId: m.modulo.id, moduloNome: m.modulo.nome, menuId: null, item: m.item });
  const bugTela = (m: LinhaModulo, t: LinhaTela | null) => { setDetalhe(null); setNovoBug({ moduloId: m.modulo.id, menuId: t?.tela.id ?? null }); setAba("bugs"); };

  const exportar = async () => {
    if (!dados) return;
    const XLSX = await import("xlsx");
    const rot = (etapa: Parameters<typeof opcaoDe>[0], v: string | null | undefined) => opcaoDe(etapa, v)?.rotulo ?? "Pendente";
    const linhas = modulos.flatMap((m) => m.telas.map((t) => ({
      "Módulo": m.modulo.nome, "Tela": t.tela.nome, "Rota": t.tela.rota, "Ativa": t.tela.ativo ? "Sim" : "Não",
      "Desenvolvimento": rot("dev", t.item?.status_dev), "Implantação": rot("implantacao", t.item?.status_implantacao),
      "Treinamento": rot("treinamento", t.item?.status_treinamento), "Validação do usuário": rot("validacao", t.item?.status_validacao),
      "Responsável": nomeUsuario.get(t.item?.responsavel_id ?? m.item?.responsavel_id ?? "") ?? "",
      "Usuário-chave": nomeUsuario.get(t.item?.usuario_chave_id ?? m.item?.usuario_chave_id ?? "") ?? "",
      "Previsão de entrega": t.item?.previsao_entrega ?? "", "Implantado em": t.item?.data_implantacao ?? "",
      "Treinado em": t.item?.data_treinamento ?? "", "Validado em": t.item?.data_validacao ?? "",
      "Com acesso": t.tela.com_acesso, "Usaram (30d)": t.tela.ativos_30d, "Acessos (30d)": t.tela.acessos_30d,
      "Bugs abertos": t.bugsAbertos, "Efetividade": t.preenchido ? `${Math.round(t.efetividade * 100)}%` : "",
      "Observações": t.item?.observacoes ?? "", "Atualizado por": t.item?.atualizado_por ?? "", "Atualizado em": t.item ? fmtDataHora(t.item.atualizado_em) : "",
    })));
    const resumo = modulos.filter((m) => m.modulo.ativo).map((m) => ({
      "Módulo": m.modulo.nome, "Telas ativas": m.ativas, "Preenchidas": m.preenchidas, "Prontas": m.prontas, "Implantadas": m.implantadas,
      "Treinadas": m.treinadas, "Validadas": m.validadas, "Efetividade": `${Math.round(m.efetividade * 100)}%`,
      "Com acesso (pessoas)": m.comAcesso, "Usaram 30d (pessoas)": m.ativos30d, "Bugs abertos": m.bugsAbertos, "Chamados abertos": m.chamadosAbertos,
      "Responsável": nomeUsuario.get(m.item?.responsavel_id ?? "") ?? "",
    }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(resumo), "Módulos");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(linhas), "Telas");
    XLSX.writeFile(wb, `checklist-modulos-${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  return (
    <div>
      <PageHeader
        title="Checklist de Módulos"
        subtitle="Cada módulo e cada tela do ERP: desenvolvimento, implantação, treinamento, validação do usuário, uso real por pessoa, bugs e chamados."
        module="Sistemas"
        breadcrumb={["Checklist de Módulos"]}
        actions={
          <>
            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => q.refetch()} disabled={q.isFetching}>
              <RefreshCw className={cn("h-4 w-4", q.isFetching && "animate-spin")} /> Atualizar
            </Button>
            {podeExportar && (
              <Button size="sm" className="gap-1.5" onClick={exportar} disabled={!dados}><FileSpreadsheet className="h-4 w-4" /> Exportar relatório</Button>
            )}
          </>
        }
      />

      {q.isLoading ? (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-6">{[0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-24 rounded-xl" />)}</div>
          {[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-20 rounded-xl" />)}
        </div>
      ) : q.isError || !dados ? (
        <Card className="flex items-start gap-3 border-destructive/40 bg-destructive/5 p-5 text-sm">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
          <div><p className="font-semibold text-destructive">Não foi possível carregar o checklist.</p><p className="text-muted-foreground">{(q.error as Error)?.message}</p></div>
        </Card>
      ) : (
        <Tabs value={aba} onValueChange={setAba}>
          <TabsList className="mb-4">
            <TabsTrigger value="checklist" className="gap-1.5"><ListChecks className="h-4 w-4" /> Checklist</TabsTrigger>
            <TabsTrigger value="uso" className="gap-1.5"><Activity className="h-4 w-4" /> Uso do ERP</TabsTrigger>
            <TabsTrigger value="bugs" className="gap-1.5"><Bug className="h-4 w-4" /> Bugs{bugsAbertos ? <span className="ml-1 rounded-full bg-red-600 px-1.5 text-[10px] font-bold text-white">{bugsAbertos}</span> : null}</TabsTrigger>
            <TabsTrigger value="historico" className="gap-1.5"><History className="h-4 w-4" /> Histórico</TabsTrigger>
          </TabsList>

          {/* ── CHECKLIST ───────────────────────────────────────────── */}
          <TabsContent value="checklist" className="space-y-5">
            {ind.pendentes > 0 && (
              <div className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
                <ClipboardList className="h-5 w-5 shrink-0" />
                <p className="flex-1">
                  <b>{ind.pendentes} de {ind.telas} telas</b> estão pendentes de preenchimento.
                  {podeAlterar ? " Abra o módulo e clique na tela para preencher o status de cada etapa." : " O gerente de sistemas vai preencher."}
                </p>
                <Button variant="outline" size="sm" className="h-8 border-amber-300 bg-white/70 dark:bg-transparent" onClick={() => mudar({ soPendentes: !f.soPendentes })}>
                  {f.soPendentes ? "Mostrar todas" : "Ver só as pendentes"}
                </Button>
              </div>
            )}

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
              <Tile icone={<CheckCircle2 className="h-5 w-5" />} rotulo="Telas prontas" valor={String(ind.prontas)} sub={`de ${ind.telas} telas · ${ind.modulos} módulos`} cor="#15803d"
                ativo={f.dev === "pronto"} onClick={() => mudar({ dev: f.dev === "pronto" ? "" : "pronto" })} />
              <Tile icone={<Wrench className="h-5 w-5" />} rotulo="Em desenvolvimento" valor={String(ind.emDesenvolvimento)} sub="inclui homologação" cor="#c2410c"
                ativo={f.dev === "em_desenvolvimento"} onClick={() => mudar({ dev: f.dev === "em_desenvolvimento" ? "" : "em_desenvolvimento" })} />
              <Tile icone={<Rocket className="h-5 w-5" />} rotulo="Implantadas" valor={String(ind.implantadas)} sub="em uso pelo setor" cor="#0e7490" />
              <Tile icone={<GraduationCap className="h-5 w-5" />} rotulo="Treinadas" valor={String(ind.treinadas)} sub="usuários treinados" cor="#2563eb"
                ativo={f.treinamento === "treinado"} onClick={() => mudar({ treinamento: f.treinamento === "treinado" ? "" : "treinado" })} />
              <Tile icone={<ShieldCheck className="h-5 w-5" />} rotulo="Validadas" valor={String(ind.validadas)} sub="pelo usuário-chave" cor="#7c3aed"
                ativo={f.validacao === "validado"} onClick={() => mudar({ validacao: f.validacao === "validado" ? "" : "validado" })} />
              <Tile icone={<Gauge className="h-5 w-5" />} rotulo="% de efetividade" valor={pct(ind.efetividade)} sub={`${ind.preenchidas} de ${ind.telas} telas preenchidas`} />
            </div>

            {/* Filtros */}
            <Card className="p-3">
              <div className="flex flex-wrap items-end gap-2">
                <Filtro rotulo="Área (módulo)">
                  <Select value={f.modulo || TODOS} onValueChange={(v) => mudar({ modulo: v === TODOS ? "" : v })}>
                    <SelectTrigger className="h-9 w-52"><SelectValue /></SelectTrigger>
                    <SelectContent className="max-h-80">
                      <SelectItem value={TODOS}>Todas</SelectItem>
                      {modulos.filter((m) => f.mostrarInativas || m.modulo.ativo).map((m) => <SelectItem key={m.modulo.id} value={m.modulo.id}>{m.modulo.nome}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </Filtro>
                <Filtro rotulo="Desenvolvimento">
                  <Select value={f.dev || TODOS} onValueChange={(v) => mudar({ dev: v === TODOS ? "" : (v as FiltrosChecklist["dev"]) })}>
                    <SelectTrigger className="h-9 w-48"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={TODOS}>Todos</SelectItem>
                      {OPCOES_DEV.map((o) => <SelectItem key={o.valor} value={o.valor}>{o.rotulo}</SelectItem>)}
                      <SelectItem value="pendente">{ROTULO_PENDENTE}</SelectItem>
                    </SelectContent>
                  </Select>
                </Filtro>
                <Filtro rotulo="Treinamento">
                  <Select value={f.treinamento || TODOS} onValueChange={(v) => mudar({ treinamento: v === TODOS ? "" : (v as FiltrosChecklist["treinamento"]) })}>
                    <SelectTrigger className="h-9 w-40"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={TODOS}>Todos</SelectItem>
                      {OPCOES_TREINAMENTO.map((o) => <SelectItem key={o.valor} value={o.valor}>{o.rotulo}</SelectItem>)}
                      <SelectItem value="sem">Sem preenchimento</SelectItem>
                    </SelectContent>
                  </Select>
                </Filtro>
                <Filtro rotulo="Validação do usuário">
                  <Select value={f.validacao || TODOS} onValueChange={(v) => mudar({ validacao: v === TODOS ? "" : (v as FiltrosChecklist["validacao"]) })}>
                    <SelectTrigger className="h-9 w-40"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={TODOS}>Todos</SelectItem>
                      {OPCOES_VALIDACAO.map((o) => <SelectItem key={o.valor} value={o.valor}>{o.rotulo}</SelectItem>)}
                      <SelectItem value="sem">Sem preenchimento</SelectItem>
                    </SelectContent>
                  </Select>
                </Filtro>
                <Filtro rotulo="Responsável">
                  <Select value={f.responsavel || TODOS} onValueChange={(v) => mudar({ responsavel: v === TODOS ? "" : v })}>
                    <SelectTrigger className="h-9 w-44"><SelectValue /></SelectTrigger>
                    <SelectContent className="max-h-80">
                      <SelectItem value={TODOS}>Todos</SelectItem>
                      {responsaveis.map((r) => <SelectItem key={r.id} value={r.id}>{r.nome}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </Filtro>
                <Filtro rotulo="Buscar">
                  <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input className="h-9 w-56 pl-8" placeholder="Módulo, tela ou rota…" value={f.busca} onChange={(e) => mudar({ busca: e.target.value })} />
                  </div>
                </Filtro>
                <div className="flex items-center gap-4 pb-1.5">
                  <label className="flex items-center gap-2 text-xs font-medium"><Switch checked={f.soPendentes} onCheckedChange={(v) => mudar({ soPendentes: v })} /> Só pendentes</label>
                  <label className="flex items-center gap-2 text-xs font-medium"><Switch checked={f.mostrarInativas} onCheckedChange={(v) => mudar({ mostrarInativas: v })} /> Mostrar inativas</label>
                </div>
                {filtrosAtivos > 0 && (
                  <Button variant="ghost" size="sm" className="h-9 gap-1 text-xs" onClick={() => setF(FILTROS_VAZIOS)}><XCircle className="h-3.5 w-3.5" /> Limpar filtros</Button>
                )}
              </div>
            </Card>

            {/* Lista de módulos */}
            <div className="space-y-1">
              <div className="flex items-center justify-between px-1 pb-1">
                <p className="text-sm font-bold">
                  Módulos do ERP <span className="font-normal text-muted-foreground">({filtrados.length} {filtrados.length === 1 ? "módulo" : "módulos"} · {filtrados.reduce((s, x) => s + x.telas.length, 0)} telas)</span>
                </p>
                <div className="flex gap-1">
                  <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => setAbertos(new Set(filtrados.map((x) => x.modulo.modulo.id)))}>Expandir tudo</Button>
                  <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => setAbertos(new Set())}>Recolher tudo</Button>
                </div>
              </div>

              {filtrados.length === 0 && <Card className="p-10 text-center text-sm text-muted-foreground">Nenhum módulo neste filtro.</Card>}

              <div className="space-y-2.5">
                {filtrados.map(({ modulo: m, telas }) => {
                  const aberto = abertos.has(m.modulo.id) || (temFiltroTela && filtrados.length <= 3);
                  return (
                    <Card key={m.modulo.id} className={cn("overflow-hidden transition", aberto && "ring-1 ring-primary/20")}>
                      <button type="button" onClick={() => alternar(m.modulo.id)}
                        className="grid w-full grid-cols-[auto_minmax(180px,1.3fr)_minmax(160px,1fr)_auto] items-center gap-4 px-4 py-3 text-left hover:bg-muted/40 lg:grid-cols-[auto_minmax(200px,1.2fr)_minmax(180px,1fr)_auto_auto_auto]">
                        {aberto ? <ChevronDown className="h-4 w-4 text-primary" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                        <div className="min-w-0">
                          <p className="truncate font-bold text-foreground">
                            {m.modulo.nome}
                            {!m.modulo.ativo && <span className="ml-1.5 rounded bg-muted px-1.5 py-0.5 text-[10px] font-bold uppercase text-muted-foreground">inativo</span>}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {m.ativas} {m.ativas === 1 ? "tela" : "telas"}
                            {m.preenchidas < m.ativas ? <> · <span className="font-semibold text-amber-700 dark:text-amber-400">{m.ativas - m.preenchidas} pendente{m.ativas - m.preenchidas === 1 ? "" : "s"}</span></> : m.ativas ? " · tudo preenchido" : ""}
                            {m.item?.responsavel_id ? <> · {nomeUsuario.get(m.item.responsavel_id)}</> : null}
                          </p>
                        </div>
                        {/* Composição do desenvolvimento das telas */}
                        <div className="min-w-0">
                          <div className="flex h-2 overflow-hidden rounded-full bg-muted" title={ORDEM_DEV.filter((k) => m.porDev[k]).map((k) => `${ROTULO_DEV_RESUMO[k]}: ${m.porDev[k]}`).join(" · ")}>
                            {ORDEM_DEV.map((k) => m.porDev[k] > 0 && (
                              <div key={k} className={cn("h-full border-r-2 border-card last:border-r-0", PONTO_TOM[tomDev(k)])} style={{ width: `${(m.porDev[k] / Math.max(1, m.ativas)) * 100}%` }} />
                            ))}
                          </div>
                          <p className="mt-1 truncate text-[11px] text-muted-foreground">
                            <b className="text-foreground">{m.prontas}</b> prontas · {m.implantadas} implantadas · {m.treinadas} treinadas · {m.validadas} validadas
                          </p>
                        </div>
                        <div className="hidden text-right text-xs lg:block" title="Pessoas que usaram em 30 dias / pessoas com acesso">
                          <p className="font-bold tabular-nums text-foreground">{m.ativos30d}/{m.comAcesso}</p>
                          <p className="text-muted-foreground">uso 30d</p>
                        </div>
                        <div className="hidden items-center gap-1.5 lg:flex">
                          {m.bugsAbertos > 0 && <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-bold text-red-700 dark:bg-red-950/50 dark:text-red-300" title="Bugs em aberto"><Bug className="h-3 w-3" />{m.bugsAbertos}</span>}
                          {m.chamadosAbertos > 0 && <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-[11px] font-bold text-blue-700 dark:bg-blue-950/50 dark:text-blue-300" title="Chamados de sistemas em aberto"><Layers className="h-3 w-3" />{m.chamadosAbertos}</span>}
                        </div>
                        <BarraEfetividade valor={m.efetividade} vazio={!m.preenchidas} />
                      </button>

                      {aberto && (
                        <div className="border-t border-border">
                          <div className="flex flex-wrap items-center gap-2 bg-muted/30 px-4 py-2">
                            <Button variant="outline" size="sm" className="h-8 gap-1.5" onClick={() => setDetalhe(m.modulo.id)}><Info className="h-3.5 w-3.5" /> Detalhes do módulo</Button>
                            {podeAlterar && <Button variant="outline" size="sm" className="h-8 gap-1.5" onClick={() => editarModulo(m)}><Pencil className="h-3.5 w-3.5" /> Responsável e observações</Button>}
                            {podeIncluir && <Button variant="outline" size="sm" className="h-8 gap-1.5" onClick={() => bugTela(m, null)}><Bug className="h-3.5 w-3.5" /> Registrar bug</Button>}
                            {m.item?.observacoes && <p className="ml-auto max-w-xl truncate text-xs text-muted-foreground" title={m.item.observacoes}>📝 {m.item.observacoes}</p>}
                          </div>
                          <TabelaTelas modulo={m} telas={telas} nomeUsuario={nomeUsuario} podeAlterar={podeAlterar} podeIncluir={podeIncluir}
                            onEditar={(t) => editarTela(m, t)} onBug={(t) => bugTela(m, t)} />
                        </div>
                      )}
                    </Card>
                  );
                })}
              </div>
            </div>

            {/* Resumo embaixo: composição geral + últimas movimentações */}
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
              <Card className="p-4">
                <p className="mb-3 text-sm font-bold">Status geral das telas · desenvolvimento</p>
                <div className="flex h-3 overflow-hidden rounded-full bg-muted">
                  {ORDEM_DEV.map((k) => porDevGeral[k] > 0 && (
                    <div key={k} className={cn("h-full border-r-2 border-card last:border-r-0", PONTO_TOM[tomDev(k)])} style={{ width: `${(porDevGeral[k] / Math.max(1, ind.telas)) * 100}%` }} />
                  ))}
                </div>
                <ul className="mt-4 space-y-2">
                  {ORDEM_DEV.map((k) => (
                    <li key={k} className="flex items-center gap-2 text-sm">
                      <span className={cn("h-2.5 w-2.5 rounded-full", PONTO_TOM[tomDev(k)])} />
                      <span className="flex-1">{ROTULO_DEV_RESUMO[k]}</span>
                      <span className="font-bold tabular-nums">{porDevGeral[k]}</span>
                      <span className="w-12 text-right text-xs tabular-nums text-muted-foreground">{pct(ind.telas ? porDevGeral[k] / ind.telas : 0)}</span>
                    </li>
                  ))}
                </ul>
              </Card>
              <Card className="p-4">
                <div className="mb-3 flex items-center justify-between">
                  <p className="text-sm font-bold">Últimas movimentações</p>
                  <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setAba("historico")}>Ver todas</Button>
                </div>
                <div className="max-h-[300px] overflow-auto pr-1">
                  <HistoricoLista dados={dados} itens={dados.historico.slice(0, 8)} />
                </div>
              </Card>
            </div>
          </TabsContent>

          {/* ── USO ─────────────────────────────────────────────────── */}
          <TabsContent value="uso">
            <UsoPainel dados={dados} modulos={modulos} podeAlterar={podeAlterar} />
          </TabsContent>

          {/* ── BUGS ────────────────────────────────────────────────── */}
          <TabsContent value="bugs">
            <BugsPainel dados={dados} podeIncluir={podeIncluir} podeAlterar={podeAlterar} podeExcluir={podeExcluir}
              novoBug={novoBug} onNovoBugUsado={() => setNovoBug(null)} />
          </TabsContent>

          {/* ── HISTÓRICO ───────────────────────────────────────────── */}
          <TabsContent value="historico">
            <HistoricoLista dados={dados} />
          </TabsContent>
        </Tabs>
      )}

      {editando && dados && <ItemDialog alvo={editando} usuarios={dados.usuarios} onFechar={() => setEditando(null)} />}
      {moduloDetalhe && dados && (
        <ModuloSheet modulo={moduloDetalhe} dados={dados} nomeUsuario={nomeUsuario}
          podeAlterar={podeAlterar} podeIncluir={podeIncluir} podeExcluir={podeExcluir}
          onFechar={() => setDetalhe(null)} onEditarModulo={editarModulo} onEditarTela={editarTela} onBugTela={bugTela} />
      )}
    </div>
  );
}

function Filtro({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-[11px] font-semibold text-muted-foreground">{rotulo}</Label>
      {children}
    </div>
  );
}
