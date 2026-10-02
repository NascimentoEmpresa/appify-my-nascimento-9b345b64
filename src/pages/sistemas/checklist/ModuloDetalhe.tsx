import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  Activity, AlertTriangle, ArrowLeft, BarChart3, Bug, CheckCircle2, ExternalLink, FileSpreadsheet, GraduationCap, Layers, Loader2,
  Pencil, Rocket, Search, Settings, ShieldCheck, Users, Wrench,
} from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { usePermissoes } from "@/context/PermissoesContext";
import { useChamadosModulo, useChecklistDados } from "@/hooks/useChecklistModulos";
import { STATUS_CHAMADO } from "@/pages/chamados/types";
import { cn } from "@/lib/utils";
import {
  ETAPAS, ROTULO_PENDENTE, montarModulos, opcaoDe,
  type Etapa, type LinhaTela, type StatusDev,
} from "@/lib/sistemas/checklistModulos";
import { BarraEfetividade, CardIndicador, MENU_CHECKLIST, StatusPill, fmtData, fmtDataHora } from "./ui";
import { TabelaTelas } from "./TabelaTelas";
import { ItemDialog, type AlvoItem } from "./ItemDialog";
import { BugsPainel, type NovoBugPadrao } from "./BugsPainel";
import { PessoasModulo } from "./PessoasModulo";
import { HistoricoLista } from "./HistoricoLista";
import { DonutStatusModulos } from "./DonutStatusModulos";
import { exportarChecklist } from "./exportar";

// =====================================================================
// Sistemas › Controle de Efetividade › PÁGINA DO MÓDULO (02/10/2026)
// /app/sistemas/checklist-modulos/:moduloId
//
// Pedido do Pablo: "quando clicar em um módulo, abra outra janela com todos
// os detalhes desse módulo e dos submódulos". Substitui a gaveta lateral
// (ModuloSheet) — página própria tem endereço, abre em nova aba e volta.
//
// A rota cai no mesmo menu (sistemas_checklist_modulos) pelo casamento por
// prefixo do RouteGuard — não precisa de app_menu novo.
//
// Em cima: as quatro etapas do módulo (marcadas ou calculadas pelas telas),
// efetividade e quem cuida. Embaixo, abas: Submódulos (status de cada tela,
// clique preenche), Pessoas (uso e treinamento por pessoa), Bugs, Chamados
// de sistemas e Histórico.
// =====================================================================

const TODOS = "__todos";
const ICONE_ETAPA: Record<Etapa, typeof Wrench> = { dev: Wrench, implantacao: Rocket, treinamento: GraduationCap, validacao: ShieldCheck };
/** Valor da etapa que conta como "concluída" numa tela. */
const CONCLUIDO: Record<Etapa, string[]> = { dev: ["pronto"], implantacao: ["implantado"], treinamento: ["treinado", "nao_se_aplica"], validacao: ["validado"] };

export default function ModuloDetalhe() {
  const { moduloId } = useParams<{ moduloId: string }>();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const q = useChecklistDados();
  const { can } = usePermissoes();
  const podeAlterar = can("alterar", undefined, MENU_CHECKLIST);
  const podeIncluir = can("incluir", undefined, MENU_CHECKLIST) || podeAlterar;
  const podeExcluir = can("excluir", undefined, MENU_CHECKLIST);
  const podeExportar = can("exportar", undefined, MENU_CHECKLIST);

  const aba = params.get("aba") ?? "submodulos";
  const irAba = (a: string) => setParams((p) => { const n = new URLSearchParams(p); n.set("aba", a); n.delete("novo"); return n; }, { replace: true });
  const [editando, setEditando] = useState<AlvoItem | null>(null);
  const [novoBug, setNovoBug] = useState<NovoBugPadrao | null>(null);
  const [busca, setBusca] = useState("");
  const [fEtapa, setFEtapa] = useState<string>(TODOS);

  const dados = q.data;
  const modulos = useMemo(() => (dados ? montarModulos(dados) : []), [dados]);
  const m = modulos.find((x) => x.modulo.id === moduloId) ?? null;
  const nomeUsuario = useMemo(() => new Map((dados?.usuarios ?? []).map((u) => [u.id, u.nome])), [dados?.usuarios]);
  const chamados = useChamadosModulo(m?.modulo.codigo ?? null);

  // "Registrar bug" vindo do painel (?aba=bugs&novo=1).
  useEffect(() => {
    if (m && params.get("novo") === "1") setNovoBug({ moduloId: m.modulo.id, menuId: null });
  }, [m?.modulo.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const ativas = useMemo(() => (m ? m.telas.filter((t) => t.tela.ativo) : []), [m]);
  const contagem = useMemo(() => {
    const r = {} as Record<Etapa, { feitas: number; preenchidas: number }>;
    ETAPAS.forEach((e) => {
      r[e.chave] = {
        feitas: ativas.filter((t) => CONCLUIDO[e.chave].includes((t.item?.[e.campo] as string | null) ?? "")).length,
        preenchidas: ativas.filter((t) => !!t.item?.[e.campo]).length,
      };
    });
    return r;
  }, [ativas]);
  const porDevTelas = useMemo(() => {
    const r: Record<StatusDev | "pendente", number> = { pronto: 0, em_homologacao: 0, em_desenvolvimento: 0, nao_iniciado: 0, pendente: 0 };
    ativas.forEach((t) => { r[t.item?.status_dev ?? "pendente"] += 1; });
    return r;
  }, [ativas]);
  const telasFiltradas = useMemo(() => {
    if (!m) return [];
    const t = busca.trim().toLowerCase();
    return m.telas.filter((x) =>
      (!t || x.tela.nome.toLowerCase().includes(t) || x.tela.rota.toLowerCase().includes(t))
      && (fEtapa === TODOS || (fEtapa === "pendente" ? !x.preenchido : fEtapa.split(":")[1] === ((x.item?.[ETAPAS.find((e) => e.chave === fEtapa.split(":")[0])!.campo] as string | null) ?? "")))
    );
  }, [m, busca, fEtapa]);

  if (q.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-16 rounded-xl" />
        <Skeleton className="h-44 rounded-xl" />
        <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-6">{[0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-24 rounded-xl" />)}</div>
        <Skeleton className="h-96 rounded-xl" />
      </div>
    );
  }
  if (q.isError || !dados || !m) {
    return (
      <div>
        <Button variant="ghost" size="sm" className="mb-3 gap-1.5 px-2" asChild><Link to="/app/sistemas/checklist-modulos"><ArrowLeft className="h-4 w-4" /> Voltar ao painel</Link></Button>
        <Card className="flex items-start gap-3 border-destructive/40 bg-destructive/5 p-5 text-sm">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
          <p className="font-semibold text-destructive">{q.isError ? `Não foi possível carregar: ${(q.error as Error)?.message}` : "Módulo não encontrado."}</p>
        </Card>
      </div>
    );
  }

  const editarModulo = () => setEditando({
    moduloId: m.modulo.id, moduloNome: m.modulo.nome, moduloCodigo: m.modulo.codigo, menuId: null, item: m.item,
    calculado: {
      status_dev: m.calculado.dev ? m.status.status_dev : null, status_implantacao: m.calculado.implantacao ? m.status.status_implantacao : null,
      status_treinamento: m.calculado.treinamento ? m.status.status_treinamento : null, status_validacao: m.calculado.validacao ? m.status.status_validacao : null,
    },
  });
  const editarTela = (t: LinhaTela) => setEditando({ moduloId: m.modulo.id, moduloNome: m.modulo.nome, moduloCodigo: m.modulo.codigo, menuId: t.tela.id, telaNome: t.tela.nome, rota: t.tela.rota, item: t.item });
  const bugTela = (t: LinhaTela | null) => { setNovoBug({ moduloId: m.modulo.id, menuId: t?.tela.id ?? null }); irAba("bugs"); };
  const resp = m.responsavelId ? nomeUsuario.get(m.responsavelId) : null;
  const chave = m.usuarioChaveId ? nomeUsuario.get(m.usuarioChaveId) : null;
  const statusChave: Record<Etapa, string | null> = {
    dev: m.status.status_dev, implantacao: m.status.status_implantacao, treinamento: m.status.status_treinamento, validacao: m.status.status_validacao,
  };

  return (
    <div>
      <Button variant="ghost" size="sm" className="mb-2 gap-1.5 px-2" onClick={() => (window.history.length > 1 ? navigate(-1) : navigate("/app/sistemas/checklist-modulos"))}>
        <ArrowLeft className="h-4 w-4" /> Voltar ao painel
      </Button>
      <PageHeader
        title={m.modulo.nome}
        subtitle={`${m.area} · ${m.ativas} ${m.ativas === 1 ? "submódulo ativo" : "submódulos ativos"} · ${m.preenchidas} preenchido${m.preenchidas === 1 ? "" : "s"}${m.ultimaAtualizacao ? ` · atualizado em ${fmtDataHora(m.ultimaAtualizacao)}` : ""}`}
        module="Sistemas"
        breadcrumb={["Controle de Efetividade dos Módulos", m.modulo.nome]}
        actions={
          <>
            {podeIncluir && <Button variant="outline" size="sm" className="gap-1.5" onClick={() => bugTela(null)}><Bug className="h-4 w-4" /> Registrar bug</Button>}
            {podeExportar && <Button variant="outline" size="sm" className="gap-1.5" onClick={() => exportarChecklist([m], nomeUsuario, `efetividade-${m.modulo.codigo}`)}><FileSpreadsheet className="h-4 w-4" /> Exportar</Button>}
            {podeAlterar && <Button size="sm" className="gap-1.5" onClick={editarModulo}><Pencil className="h-4 w-4" /> Editar status do módulo</Button>}
          </>
        }
      />

      {!m.modulo.ativo && (
        <p className="mb-4 rounded-lg border border-border bg-muted/50 px-3 py-2 text-sm text-muted-foreground">Este módulo está <b>inativo</b> no cadastro de acesso — não entra nos indicadores do painel.</p>
      )}

      {/* ── As quatro etapas do módulo ───────────────────────────── */}
      <Card className="mb-4 p-4">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {ETAPAS.map((e, i) => {
              const Icone = ICONE_ETAPA[e.chave];
              const o = opcaoDe(e.chave, statusChave[e.chave]);
              const c = contagem[e.chave];
              const feito = o && CONCLUIDO[e.chave].includes(o.valor);
              return (
                <div key={e.chave} className={cn("relative rounded-xl border p-3", feito ? "border-emerald-300 bg-emerald-50/50 dark:border-emerald-900 dark:bg-emerald-950/20" : "border-border")}>
                  <div className="mb-2 flex items-center gap-2">
                    <span className={cn("flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold", feito ? "bg-emerald-600 text-white" : "bg-muted text-muted-foreground")}>
                      {feito ? <CheckCircle2 className="h-4 w-4" /> : i + 1}
                    </span>
                    <Icone className="h-4 w-4 text-muted-foreground" />
                    <p className="text-sm font-bold">{e.titulo}</p>
                  </div>
                  <StatusPill etapa={e.chave} valor={statusChave[e.chave]} calculado={m.calculado[e.chave]} />
                  <p className="mt-2 text-[11.5px] text-muted-foreground">
                    {m.calculado[e.chave] ? "Calculado pelas telas · " : m.item?.[e.campo] ? "Marcado no módulo · " : ""}
                    <b className="text-foreground">{c.feitas}</b>/{m.ativas} submódulos {e.chave === "dev" ? "liberados" : e.chave === "implantacao" ? "implantados" : e.chave === "treinamento" ? "treinados" : "validados"}
                  </p>
                  <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full bg-emerald-500" style={{ width: `${m.ativas ? (c.feitas / m.ativas) * 100 : 0}%` }} />
                  </div>
                  {!e.noPercentual && <p className="mt-1 text-[10.5px] text-muted-foreground">não entra no % de efetividade</p>}
                  {e.chave === "treinamento" && (
                    <p className="mt-1.5 text-[11.5px] text-muted-foreground">
                      Responsável(is):{" "}
                      <b className="text-foreground">
                        {m.item?.treinamento_responsaveis?.length ? m.item.treinamento_responsaveis.map((id) => nomeUsuario.get(id) ?? "—").join(", ") : "—"}
                      </b>
                    </p>
                  )}
                </div>
              );
            })}
          </div>
          <div className="space-y-2.5 rounded-xl bg-muted/40 p-3 text-sm">
            <div>
              <p className="text-xs font-semibold text-muted-foreground">Efetividade do módulo</p>
              <div className="mt-1"><BarraEfetividade valor={m.efetividade} largura="w-40" /></div>
            </div>
            <Info rotulo="Responsável (Sistemas)" valor={resp ?? "—"} detalhe={!m.item?.responsavel_id && resp ? "o mais frequente nas telas" : undefined} />
            <Info rotulo="Usuário-chave (valida)" valor={chave ?? "—"} detalhe={!m.item?.usuario_chave_id && chave ? "o mais frequente nas telas" : undefined} />
            <Info rotulo="Previsão de entrega" valor={fmtData(m.item?.previsao_entrega)} />
            {m.item?.observacoes && <p className="rounded-lg bg-card px-2.5 py-2 text-xs text-foreground">{m.item.observacoes}</p>}
          </div>
        </div>
      </Card>

      {/* ── Números do módulo ───────────────────────────────────── */}
      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
        <CardIndicador icone={<Layers className="h-7 w-7" />} cor="#0f2a5c" fundo="#e0e7ff" valor={String(m.ativas)} rotulo="Submódulos ativos" variacao={null} />
        <CardIndicador icone={<CheckCircle2 className="h-7 w-7" />} cor="#16a34a" fundo="#dcfce7" valor={`${contagem.dev.feitas}`} rotulo="Liberados" variacao={null} />
        <CardIndicador icone={<GraduationCap className="h-7 w-7" />} cor="#2563eb" fundo="#dbeafe" valor={`${contagem.treinamento.feitas}`} rotulo="Treinados" variacao={null} />
        <CardIndicador icone={<Users className="h-7 w-7" />} cor="#7c3aed" fundo="#ede9fe" valor={`${contagem.validacao.feitas}`} rotulo="Validados" variacao={null} />
        <CardIndicador icone={<Activity className="h-7 w-7" />} cor="#0e7490" fundo="#cffafe" valor={`${m.ativos30d}/${m.comAcesso}`} rotulo="Usaram em 30 dias" variacao={null} />
        <CardIndicador icone={<Bug className="h-7 w-7" />} cor="#dc2626" fundo="#fee2e2" valor={String(m.bugsAbertos)} rotulo={`Bugs abertos · ${m.chamadosAbertos} chamado${m.chamadosAbertos === 1 ? "" : "s"}`} variacao={null} />
      </div>

      {/* ── Abas ─────────────────────────────────────────────────── */}
      <Tabs value={aba} onValueChange={irAba}>
        <TabsList className="mb-3 flex-wrap">
          <TabsTrigger value="submodulos" className="gap-1.5"><Layers className="h-4 w-4" /> Submódulos ({m.telas.length})</TabsTrigger>
          <TabsTrigger value="pessoas" className="gap-1.5"><Users className="h-4 w-4" /> Pessoas · uso e treinamento</TabsTrigger>
          <TabsTrigger value="bugs" className="gap-1.5"><Bug className="h-4 w-4" /> Bugs{m.bugsAbertos ? ` (${m.bugsAbertos})` : ""}</TabsTrigger>
          <TabsTrigger value="chamados" className="gap-1.5"><Settings className="h-4 w-4" /> Chamados{m.chamadosAbertos ? ` (${m.chamadosAbertos})` : ""}</TabsTrigger>
          <TabsTrigger value="historico" className="gap-1.5"><BarChart3 className="h-4 w-4" /> Histórico</TabsTrigger>
        </TabsList>

        <TabsContent value="submodulos">
          <div className="grid gap-4 2xl:grid-cols-[minmax(0,1fr)_340px]">
            <Card className="overflow-hidden">
              <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
                <p className="mr-auto text-[15px] font-bold">Submódulos (telas) <span className="font-normal text-muted-foreground">({telasFiltradas.length})</span></p>
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input className="h-9 w-56 pl-8" placeholder="Buscar submódulo ou rota…" value={busca} onChange={(e) => setBusca(e.target.value)} />
                </div>
                <Select value={fEtapa} onValueChange={setFEtapa}>
                  <SelectTrigger className="h-9 w-60"><SelectValue /></SelectTrigger>
                  <SelectContent className="max-h-80">
                    <SelectItem value={TODOS}>Todos os status</SelectItem>
                    <SelectItem value="pendente">{ROTULO_PENDENTE}</SelectItem>
                    {ETAPAS.flatMap((e) => e.opcoes.map((o) => <SelectItem key={`${e.chave}:${o.valor}`} value={`${e.chave}:${o.valor}`}>{e.titulo}: {o.rotulo}</SelectItem>))}
                  </SelectContent>
                </Select>
              </div>
              {podeAlterar && m.preenchidas < m.ativas && (
                <p className="border-b border-border bg-amber-50 px-4 py-2 text-xs text-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
                  <b>{m.ativas - m.preenchidas}</b> submódulo{m.ativas - m.preenchidas === 1 ? "" : "s"} pendente{m.ativas - m.preenchidas === 1 ? "" : "s"} de preenchimento — clique na linha para preencher.
                </p>
              )}
              <TabelaTelas modulo={m} telas={telasFiltradas} nomeUsuario={nomeUsuario} podeAlterar={podeAlterar} podeIncluir={podeIncluir}
                onEditar={editarTela} onBug={bugTela} />
            </Card>
            <div className="space-y-4">
              <Card className="p-4">
                <p className="mb-3 text-[15px] font-bold">Status dos submódulos</p>
                <DonutStatusModulos porDev={porDevTelas} total={ativas.length} unidade="Telas" />
              </Card>
              <Card className="p-4">
                <p className="mb-2 text-[15px] font-bold">Uso nos últimos 30 dias</p>
                <p className="text-xs text-muted-foreground">Pessoas que abriram alguma tela do módulo ÷ pessoas com acesso.</p>
                <div className="mt-2"><BarraEfetividade valor={m.comAcesso ? Math.min(1, m.ativos30d / m.comAcesso) : null} largura="w-40" /></div>
                <p className="mt-2 text-xs text-muted-foreground">{m.acessos30d} acesso{m.acessos30d === 1 ? "" : "s"} · {ativas.filter((t) => t.tela.com_acesso > 0 && t.tela.ativos_30d === 0).length} tela(s) com acesso e sem uso</p>
                <Button variant="link" size="sm" className="h-auto px-0 text-xs" onClick={() => irAba("pessoas")}>Ver por pessoa →</Button>
              </Card>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="pessoas">
          <PessoasModulo moduloId={m.modulo.id} moduloNome={m.modulo.nome} podeAlterar={podeAlterar} />
        </TabsContent>

        <TabsContent value="bugs">
          <BugsPainel dados={dados} moduloId={m.modulo.id} podeIncluir={podeIncluir} podeAlterar={podeAlterar} podeExcluir={podeExcluir}
            novoBug={novoBug} onNovoBugUsado={() => setNovoBug(null)} />
        </TabsContent>

        <TabsContent value="chamados">
          {chamados.isLoading ? (
            <p className="flex items-center gap-2 py-6 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Carregando chamados…</p>
          ) : !chamados.data?.length ? (
            <Card className="p-8 text-center text-sm text-muted-foreground">Nenhum chamado de sistemas aberto para "{m.modulo.nome}".</Card>
          ) : (
            <Card className="overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left text-[10.5px] font-bold uppercase tracking-wide text-muted-foreground">
                  <tr><th className="px-3 py-2">Chamado</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Solicitante</th><th className="px-3 py-2">Aberto em</th><th /></tr>
                </thead>
                <tbody>
                  {chamados.data.map((c) => {
                    const st = STATUS_CHAMADO[c.status];
                    return (
                      <tr key={c.id} className="border-t border-border">
                        <td className="max-w-[420px] px-3 py-2"><p className="text-xs font-bold text-muted-foreground">{c.numero}</p><p className="truncate font-medium">{c.assunto}</p></td>
                        <td className="px-3 py-2"><span className={cn("rounded-full border px-2 py-0.5 text-[11px] font-semibold", st?.cls)}>{st?.label ?? c.status}</span></td>
                        <td className="px-3 py-2 text-xs">{c.solicitante ?? "—"}</td>
                        <td className="px-3 py-2 text-xs text-muted-foreground">{fmtDataHora(c.created_at)}</td>
                        <td className="px-3 py-2 text-right">
                          <Link to={`/app/sistemas/chamados/${c.id}/acompanhar`} className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline">Abrir <ExternalLink className="h-3 w-3" /></Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="historico">
          <HistoricoLista dados={dados} moduloId={m.modulo.id} compacto />
        </TabsContent>
      </Tabs>

      {editando && <ItemDialog alvo={editando} usuarios={dados.usuarios} onFechar={() => setEditando(null)} />}
    </div>
  );
}

function Info({ rotulo, valor, detalhe }: { rotulo: string; valor: string; detalhe?: string }) {
  return (
    <div>
      <p className="text-xs font-semibold text-muted-foreground">{rotulo}</p>
      <p className="font-medium text-foreground">{valor}{detalhe && <span className="ml-1 text-[11px] font-normal italic text-muted-foreground">({detalhe})</span>}</p>
    </div>
  );
}
