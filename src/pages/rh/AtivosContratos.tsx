// =====================================================================
// RH › ATIVOS/CONTRATOS (/app/rh/ativos-contratos) — mig 20260930000279
//
// Por contrato: quantos colaboradores ativos a EMPREGADOS tem × quantos a
// Planilha de Custo diz que deveria ter ("QT. PESSOAS" de cada posto
// vigente), conferido POSTO A POSTO.
//
// O posto da Senior ("01-1099-0071-0061-06-RECEPCIONISTA-B1 40H 5X2") e o da
// planilha ("POSTO B1 - RECEPCIONISTA 40H 5X2") não têm chave em comum, então
// cada posto da Senior é ligado uma vez ao(s) posto(s) da planilha — a tela
// sugere, quem tem "Vincular postos" confirma. Postos ligados entre si formam
// um grupo e a conferência é no total do grupo (conferenciaAtivos.ts).
// =====================================================================
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, EyeOff, Link2, Loader2,
  Search, ShieldAlert, Sparkles, Undo2, Users, UserX, Building2, FileSpreadsheet,
} from "lucide-react";
import { useAccessibleMenus } from "@/hooks/useAccessibleMenus";
import {
  usePainelAtivosContratos, usePessoasAtivas, useVincularPostos, useVincularFilial,
  type ItemVinculo,
} from "@/hooks/useAtivosContratos";
import {
  conferirContrato, sugerirPostos, limparPostoSenior, fmtDiferenca,
  type ContratoAtivos, type ConferenciaContrato, type PostoSenior, type SituacaoGrupo,
} from "./conferenciaAtivos";

type Filtro = "todos" | "falta" | "excesso" | "ok" | "pendente" | "sem_planilha";

type Linha = { c: ContratoAtivos; conf: ConferenciaContrato; estado: Exclude<Filtro, "todos"> };

const ESTADO: Record<Exclude<Filtro, "todos">, { label: string; cls: string }> = {
  falta:        { label: "Falta gente",      cls: "border-destructive/30 bg-destructive/10 text-destructive" },
  excesso:      { label: "Acima do previsto", cls: "border-warning/30 bg-warning/10 text-warning" },
  ok:           { label: "Confere",          cls: "border-success/30 bg-success/10 text-success" },
  pendente:     { label: "Vincular postos",  cls: "border-info/30 bg-info/10 text-info" },
  sem_planilha: { label: "Sem planilha",     cls: "border-muted-foreground/30 bg-muted text-muted-foreground" },
};

const SIT_GRUPO: Record<SituacaoGrupo, { label: string; cls: string }> = {
  falta:   { label: "Falta",   cls: "text-destructive" },
  excesso: { label: "Excesso", cls: "text-warning" },
  ok:      { label: "OK",      cls: "text-success" },
};

function estadoDo(c: ContratoAtivos, conf: ConferenciaContrato): Linha["estado"] {
  if (!c.postos.length) return "sem_planilha";
  if (conf.pessoasPendentes > 0) return "pendente";
  if (conf.grupos.some((g) => g.situacao === "falta") || conf.planilhaSemVinculo.some((p) => p.vagas > 0)) return "falta";
  if (conf.grupos.some((g) => g.situacao === "excesso")) return "excesso";
  return "ok";
}

const corDif = (n: number) => (n === 0 ? "text-success" : n < 0 ? "text-destructive" : "text-warning");

function Kpi({ icon: Icon, valor, rotulo, dica, tom = "primary" }: {
  icon: typeof Users; valor: React.ReactNode; rotulo: string; dica?: string; tom?: string;
}) {
  const tons: Record<string, string> = {
    primary: "bg-primary/10 text-primary", success: "bg-success/10 text-success",
    warning: "bg-warning/10 text-warning", destructive: "bg-destructive/10 text-destructive",
    info: "bg-info/10 text-info", muted: "bg-muted text-muted-foreground",
  };
  return (
    <Card className="flex items-center gap-3 p-4">
      <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${tons[tom]}`}><Icon className="h-5 w-5" /></div>
      <div className="min-w-0">
        <p className="text-2xl font-bold leading-none">{valor}</p>
        <p className="mt-1 truncate text-xs font-medium text-muted-foreground">{rotulo}</p>
        {dica && <p className="truncate text-[11px] text-muted-foreground/70">{dica}</p>}
      </div>
    </Card>
  );
}

export default function AtivosContratos() {
  const { data: access } = useAccessibleMenus("visualizar");
  const podeVincular = !!access?.codes.has("rh_ativos_contratos_vincular");
  const { data, isLoading, error } = usePainelAtivosContratos();

  const [busca, setBusca] = useState("");
  const [filtro, setFiltro] = useState<Filtro>("todos");
  const [aberto, setAberto] = useState<string | null>(null);
  const [pessoasDe, setPessoasDe] = useState<{ contratoId: string | null; filial: string | null; titulo: string } | null>(null);

  const linhas: Linha[] = useMemo(
    () => (data?.contratos ?? []).map((c) => {
      const conf = conferirContrato(c);
      return { c, conf, estado: estadoDo(c, conf) };
    }),
    [data],
  );

  const contagem = useMemo(() => {
    const m: Record<string, number> = {};
    linhas.forEach((l) => { m[l.estado] = (m[l.estado] ?? 0) + 1; });
    return m;
  }, [linhas]);

  const visiveis = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return linhas
      .filter((l) => filtro === "todos" || l.estado === filtro)
      .filter((l) => !q || l.c.nome.toLowerCase().includes(q) || (l.c.cliente ?? "").toLowerCase().includes(q));
  }, [linhas, filtro, busca]);

  const tot = useMemo(() => {
    const comPlanilha = linhas.filter((l) => l.c.postos.length);
    return {
      previsto: comPlanilha.reduce((s, l) => s + l.conf.previsto, 0),
      ativosComPlanilha: comPlanilha.reduce((s, l) => s + l.conf.ativos, 0),
      pendentes: linhas.reduce((s, l) => s + l.conf.pessoasPendentes, 0),
      semContrato: (data?.filiais_sem_contrato ?? []).reduce((s, f) => s + f.qtd, 0),
    };
  }, [linhas, data]);

  if (error) {
    return (
      <div>
        <PageHeader title="Ativos/Contratos" module="Recursos Humanos" breadcrumb={["Recursos Humanos", "Ativos/Contratos"]} />
        <Card className="flex items-center gap-3 p-6 text-sm text-muted-foreground">
          <ShieldAlert className="h-5 w-5 text-warning" /> {(error as Error).message}
        </Card>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Ativos/Contratos"
        subtitle="Colaboradores ativos (EMPREGADOS) × quantidade contratada por posto (Planilha de Custo)."
        module="Recursos Humanos"
        breadcrumb={["Recursos Humanos", "Ativos/Contratos"]}
      />

      {isLoading || !data ? (
        <Card className="flex items-center gap-2 p-6 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Carregando…</Card>
      ) : (
        <>
          <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <Kpi icon={Users} valor={data.total_ativos.toLocaleString("pt-BR")} rotulo="Colaboradores ativos" dica={`${data.com_contrato.toLocaleString("pt-BR")} ligados a contrato`} />
            <Kpi icon={FileSpreadsheet} valor={tot.previsto.toLocaleString("pt-BR")} rotulo="Previsto na planilha" dica="soma do QT. PESSOAS vigente" tom="info" />
            <Kpi icon={AlertTriangle} valor={<span className={corDif(tot.ativosComPlanilha - tot.previsto)}>{fmtDiferenca(tot.ativosComPlanilha - tot.previsto)}</span>}
                 rotulo="Ativos − previsto" dica={`${tot.ativosComPlanilha.toLocaleString("pt-BR")} ativos em contratos com planilha`} tom="warning" />
            <Kpi icon={Link2} valor={tot.pendentes.toLocaleString("pt-BR")} rotulo="Em postos não vinculados" dica={`${contagem.pendente ?? 0} contrato(s) a vincular`} tom="info" />
            <Kpi icon={UserX} valor={tot.semContrato.toLocaleString("pt-BR")} rotulo="Ativos sem contrato" dica={`${data.filiais_sem_contrato.length} filial(is)`} tom="muted" />
          </div>

          <Card className="p-4">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <div className="relative w-full sm:w-72">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input className="h-9 pl-8 text-sm" placeholder="Buscar contrato ou cliente…" value={busca} onChange={(e) => setBusca(e.target.value)} />
              </div>
              <div className="flex flex-wrap gap-1.5">
                {(["todos", "falta", "excesso", "pendente", "ok", "sem_planilha"] as Filtro[]).map((f) => (
                  <Button key={f} size="sm" variant={filtro === f ? "default" : "outline"} className="h-8 text-xs" onClick={() => setFiltro(f)}>
                    {f === "todos" ? "Todos" : ESTADO[f].label}
                    <span className="ml-1.5 rounded-full bg-background/20 px-1.5 text-[10px]">{f === "todos" ? linhas.length : contagem[f] ?? 0}</span>
                  </Button>
                ))}
              </div>
            </div>

            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/40 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    <th className="w-8 py-2 pl-3" />
                    <th className="py-2 pr-3">Contrato</th>
                    <th className="py-2 pr-3 text-right">Previsto</th>
                    <th className="py-2 pr-3 text-right">Ativos</th>
                    <th className="py-2 pr-3 text-right">Diferença</th>
                    <th className="py-2 pr-3 text-right">Afastados</th>
                    <th className="py-2 pr-3">Situação</th>
                  </tr>
                </thead>
                <tbody>
                  {visiveis.map(({ c, conf, estado }) => {
                    const exp = aberto === c.id;
                    return (
                      <FragmentoContrato
                        key={c.id} c={c} conf={conf} estado={estado} aberto={exp}
                        onToggle={() => setAberto(exp ? null : c.id)}
                        podeVincular={podeVincular}
                        onVerPessoas={() => setPessoasDe({ contratoId: c.id, filial: null, titulo: c.nome })}
                      />
                    );
                  })}
                  {visiveis.length === 0 && (
                    <tr><td colSpan={7} className="py-8 text-center text-sm text-muted-foreground">Nenhum contrato neste filtro.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>

          {data.filiais_sem_contrato.length > 0 && (
            <FiliaisSemContrato
              filiais={data.filiais_sem_contrato}
              contratos={data.contratos}
              podeVincular={podeVincular}
              onVerPessoas={(f) => setPessoasDe({ contratoId: null, filial: f, titulo: f })}
            />
          )}

          <p className="mt-3 text-[11px] text-muted-foreground">
            Ativo = qualquer situação exceto demitido/desligado/aposentado (férias e afastados ocupam o posto e aparecem em "Afastados").
            Previsto = QT. PESSOAS dos postos EXECUTADO vigentes da Planilha de Custo. Atualizado em {new Date(data.gerado_em).toLocaleString("pt-BR")}.
          </p>
        </>
      )}

      <DialogPessoas alvo={pessoasDe} onClose={() => setPessoasDe(null)} />
    </div>
  );
}

// ---- Linha do contrato + detalhe ---------------------------------------------

function FragmentoContrato({ c, conf, estado, aberto, onToggle, podeVincular, onVerPessoas }: {
  c: ContratoAtivos; conf: ConferenciaContrato; estado: Linha["estado"]; aberto: boolean;
  onToggle: () => void; podeVincular: boolean; onVerPessoas: () => void;
}) {
  const e = ESTADO[estado];
  return (
    <>
      <tr className={`cursor-pointer border-b border-border/60 hover:bg-muted/30 ${aberto ? "bg-muted/30" : ""}`} onClick={onToggle}>
        <td className="py-2.5 pl-3 text-muted-foreground">{aberto ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</td>
        <td className="py-2.5 pr-3">
          <p className="font-medium">{c.nome}</p>
          {c.cliente && <p className="text-[11px] text-muted-foreground">{c.cliente}</p>}
        </td>
        <td className="py-2.5 pr-3 text-right tabular-nums">{c.postos.length ? conf.previsto : "—"}</td>
        <td className="py-2.5 pr-3 text-right tabular-nums">{conf.ativos}</td>
        <td className={`py-2.5 pr-3 text-right font-semibold tabular-nums ${c.postos.length ? corDif(conf.diferenca) : "text-muted-foreground"}`}>
          {c.postos.length ? fmtDiferenca(conf.diferenca) : "—"}
        </td>
        <td className="py-2.5 pr-3 text-right tabular-nums text-muted-foreground">{conf.afastados || "—"}</td>
        <td className="py-2.5 pr-3">
          <Badge variant="outline" className={`text-[10px] font-semibold ${e.cls}`}>{e.label}</Badge>
          {estado === "pendente" && <span className="ml-1.5 text-[11px] text-muted-foreground">{conf.pessoasPendentes} pessoa(s)</span>}
        </td>
      </tr>
      {aberto && (
        <tr className="border-b border-border">
          <td colSpan={7} className="bg-muted/10 p-3">
            <DetalheContrato c={c} conf={conf} podeVincular={podeVincular} onVerPessoas={onVerPessoas} />
          </td>
        </tr>
      )}
    </>
  );
}

function DetalheContrato({ c, conf, podeVincular, onVerPessoas }: {
  c: ContratoAtivos; conf: ConferenciaContrato; podeVincular: boolean; onVerPessoas: () => void;
}) {
  const vincular = useVincularPostos();
  const [editando, setEditando] = useState<string | null>(null);

  const salvar = async (itens: ItemVinculo[], ok: string) => {
    try {
      await vincular.mutateAsync({ contratoId: c.id, itens });
      toast.success(ok);
      setEditando(null);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const sugestoes = useMemo(
    () => conf.seniorPendentes
      .map((s) => ({ s, sug: sugerirPostos(s.posto_senior, c.postos) }))
      .filter((x) => x.sug.length > 0),
    [conf.seniorPendentes, c.postos],
  );

  const vinculosDe = (posto: string) => c.vinculos.filter((v) => v.posto_senior === posto && v.planilha_posto).map((v) => v.planilha_posto!);

  if (!c.postos.length) {
    return (
      <div className="space-y-2 text-sm">
        <p className="flex items-center gap-1.5 text-muted-foreground">
          <FileSpreadsheet className="h-4 w-4" /> Este contrato não tem posto EXECUTADO vigente na Planilha de Custo — não há quantidade prevista para comparar.
        </p>
        <ListaSenior titulo={`Postos na Senior (${conf.ativos} ativos)`} itens={c.postos_senior} />
        <Button size="sm" variant="outline" className="gap-1.5" onClick={onVerPessoas}><Users className="h-3.5 w-3.5" /> Ver colaboradores</Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          {c.postos.length} posto(s) na planilha · {c.postos_senior.length} posto(s) na Senior · previsto <b>{conf.previsto}</b> · ativos <b>{conf.ativos}</b>
        </p>
        <Button size="sm" variant="outline" className="h-8 gap-1.5" onClick={onVerPessoas}><Users className="h-3.5 w-3.5" /> Ver colaboradores</Button>
      </div>

      {/* Conferência por grupo de postos */}
      {conf.grupos.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-border bg-background">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border bg-muted/40 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                <th className="py-2 pl-3 pr-3">Posto na planilha</th>
                <th className="py-2 pr-3">Posto na Senior</th>
                <th className="py-2 pr-3 text-right">Previsto</th>
                <th className="py-2 pr-3 text-right">Ativos</th>
                <th className="py-2 pr-3 text-right">Afast.</th>
                <th className="py-2 pr-3 text-right">Dif.</th>
                <th className="py-2 pr-3" />
              </tr>
            </thead>
            <tbody>
              {conf.grupos.map((g) => (
                <tr key={g.chave} className="border-b border-border/60 align-top last:border-0">
                  <td className="py-2 pl-3 pr-3">
                    {g.planilha.map((p) => <p key={p.nome}>{p.nome} <span className="text-muted-foreground">({p.vagas})</span></p>)}
                  </td>
                  <td className="py-2 pr-3">
                    {g.senior.map((s) => (
                      <div key={s.posto_senior} className="flex items-center gap-1.5">
                        <span title={s.posto_senior}>{limparPostoSenior(s.posto_senior)} <span className="text-muted-foreground">({s.qtd})</span></span>
                        {podeVincular && (
                          <button type="button" className="text-[10px] text-primary hover:underline" onClick={() => setEditando(s.posto_senior)}>alterar</button>
                        )}
                      </div>
                    ))}
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums">{g.previsto}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{g.ativos}</td>
                  <td className="py-2 pr-3 text-right tabular-nums text-muted-foreground">{g.afastados || "—"}</td>
                  <td className={`py-2 pr-3 text-right font-semibold tabular-nums ${corDif(g.diferenca)}`}>{fmtDiferenca(g.diferenca)}</td>
                  <td className={`py-2 pr-3 font-semibold ${SIT_GRUPO[g.situacao].cls}`}>{SIT_GRUPO[g.situacao].label}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Postos da Senior ainda sem ligação */}
      {conf.seniorPendentes.length > 0 && (
        <div className="rounded-lg border border-info/30 bg-info/5 p-3">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <p className="flex items-center gap-1.5 text-xs font-semibold">
              <Link2 className="h-3.5 w-3.5 text-info" /> Postos da Senior sem vínculo — {conf.pessoasPendentes} pessoa(s) fora da conferência
            </p>
            {podeVincular && sugestoes.length > 0 && (
              <Button size="sm" className="h-7 gap-1.5 text-xs" disabled={vincular.isPending}
                onClick={() => salvar(sugestoes.map((x) => ({ posto_senior: x.s.posto_senior, planilha_postos: x.sug, ignorar: false })),
                  `${sugestoes.length} posto(s) vinculado(s) pela sugestão`)}>
                <Sparkles className="h-3.5 w-3.5" /> Aplicar {sugestoes.length} sugestão(ões)
              </Button>
            )}
          </div>
          <div className="space-y-1.5">
            {conf.seniorPendentes.map((s) => (
              <LinhaPendente
                key={s.posto_senior} s={s} c={c} podeVincular={podeVincular} salvando={vincular.isPending}
                onSalvar={(postos) => salvar([{ posto_senior: s.posto_senior, planilha_postos: postos, ignorar: false }], "Posto vinculado")}
                onIgnorar={() => salvar([{ posto_senior: s.posto_senior, planilha_postos: [], ignorar: true }], "Posto ignorado na conferência")}
              />
            ))}
          </div>
          {!podeVincular && (
            <p className="mt-2 text-[11px] text-muted-foreground">Para vincular, peça a liberação de <b>Ativos/Contratos · Vincular postos</b> em Acesso por Usuário.</p>
          )}
        </div>
      )}

      {/* Postos da planilha sem ninguém ligado */}
      {conf.planilhaSemVinculo.length > 0 && (
        <div className="rounded-lg border border-border bg-background p-3">
          <p className="mb-1.5 text-xs font-semibold">Postos da planilha sem nenhum posto da Senior ligado</p>
          <div className="flex flex-wrap gap-1.5">
            {conf.planilhaSemVinculo.map((p) => (
              <span key={p.nome} className={`rounded-md border px-2 py-0.5 text-[11px] ${p.vagas ? "border-destructive/30 text-destructive" : "border-border text-muted-foreground"}`}>
                {p.nome} · {p.vagas} vaga(s)
              </span>
            ))}
          </div>
          <p className="mt-1.5 text-[11px] text-muted-foreground">Se há gente nesses postos, ela está num posto da Senior ainda não vinculado.</p>
        </div>
      )}

      {conf.vinculosOrfaos.length > 0 && (
        <p className="flex items-center gap-1.5 text-[11px] text-warning">
          <AlertTriangle className="h-3.5 w-3.5" />
          {conf.vinculosOrfaos.length} vínculo(s) apontam para posto que saiu da planilha vigente
          ({conf.vinculosOrfaos.map((v) => v.planilha_posto_gravado).join(", ")}) — vincule de novo.
        </p>
      )}

      {conf.seniorIgnorados.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
          <EyeOff className="h-3.5 w-3.5" /> Fora da conta:
          {conf.seniorIgnorados.map((s) => (
            <span key={s.posto_senior} className="inline-flex items-center gap-1 rounded-md border border-border px-1.5 py-0.5">
              {limparPostoSenior(s.posto_senior)} ({s.qtd})
              {podeVincular && (
                <button type="button" title="Voltar a contar" onClick={() => salvar([{ posto_senior: s.posto_senior, planilha_postos: [], ignorar: false }], "Posto voltou para a conferência")}>
                  <Undo2 className="h-3 w-3 text-primary" />
                </button>
              )}
            </span>
          ))}
        </div>
      )}

      <DialogEditarVinculo
        aberto={!!editando}
        posto={editando}
        c={c}
        atuais={editando ? vinculosDe(editando) : []}
        salvando={vincular.isPending}
        onClose={() => setEditando(null)}
        onSalvar={(postos) => editando && salvar([{ posto_senior: editando, planilha_postos: postos, ignorar: false }], "Vínculo atualizado")}
        onIgnorar={() => editando && salvar([{ posto_senior: editando, planilha_postos: [], ignorar: true }], "Posto ignorado na conferência")}
      />
    </div>
  );
}

function ListaSenior({ titulo, itens }: { titulo: string; itens: PostoSenior[] }) {
  return (
    <div>
      <p className="mb-1 text-xs font-semibold">{titulo}</p>
      <div className="flex flex-wrap gap-1.5">
        {itens.map((s) => (
          <span key={s.posto_senior} title={s.posto_senior} className="rounded-md border border-border bg-background px-2 py-0.5 text-[11px]">
            {limparPostoSenior(s.posto_senior)} · {s.qtd}
          </span>
        ))}
      </div>
    </div>
  );
}

/** Um posto da Senior pendente: sugestão + escolha manual + ignorar. */
function LinhaPendente({ s, c, podeVincular, salvando, onSalvar, onIgnorar }: {
  s: PostoSenior; c: ContratoAtivos; podeVincular: boolean; salvando: boolean;
  onSalvar: (postos: string[]) => void; onIgnorar: () => void;
}) {
  const sug = useMemo(() => sugerirPostos(s.posto_senior, c.postos), [s.posto_senior, c.postos]);
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md bg-background px-2.5 py-1.5 text-xs">
      <span className="min-w-[220px] flex-1 font-medium" title={s.posto_senior}>
        {limparPostoSenior(s.posto_senior)} <span className="font-normal text-muted-foreground">· {s.qtd} pessoa(s)</span>
      </span>
      {sug.length > 0 ? (
        <span className="flex items-center gap-1 text-muted-foreground">
          <Sparkles className="h-3 w-3 text-info" /> {sug.join(" + ")}
        </span>
      ) : (
        <span className="text-muted-foreground">sem sugestão</span>
      )}
      {podeVincular && (
        <span className="ml-auto flex gap-1">
          {sug.length > 0 && (
            <Button size="sm" variant="outline" className="h-7 text-xs" disabled={salvando} onClick={() => onSalvar(sug)}>Aceitar</Button>
          )}
          <EscolherPostos postos={c.postos.map((p) => p.nome)} iniciais={sug} salvando={salvando} onConfirmar={onSalvar} />
          <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs text-muted-foreground" disabled={salvando} onClick={onIgnorar} title="Não contar este posto">
            <EyeOff className="h-3.5 w-3.5" /> Ignorar
          </Button>
        </span>
      )}
    </div>
  );
}

/** Escolha de um ou mais postos da planilha (popover com checkboxes). */
function EscolherPostos({ postos, iniciais, salvando, onConfirmar, rotulo = "Escolher" }: {
  postos: string[]; iniciais: string[]; salvando: boolean; onConfirmar: (p: string[]) => void; rotulo?: string;
}) {
  const [aberto, setAberto] = useState(false);
  const [sel, setSel] = useState<string[]>(iniciais);
  const [q, setQ] = useState("");
  const vis = postos.filter((p) => p.toLowerCase().includes(q.toLowerCase()));
  return (
    <Popover open={aberto} onOpenChange={(o) => { setAberto(o); if (o) { setSel(iniciais); setQ(""); } }}>
      <PopoverTrigger asChild>
        <Button size="sm" variant="outline" className="h-7 text-xs">{rotulo}</Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-2" align="end">
        <Input className="mb-2 h-8 text-xs" placeholder="Filtrar postos da planilha…" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="max-h-64 space-y-0.5 overflow-y-auto">
          {vis.map((p) => (
            <label key={p} className="flex cursor-pointer items-start gap-2 rounded px-1.5 py-1 text-xs hover:bg-muted">
              <Checkbox className="mt-0.5" checked={sel.includes(p)}
                onCheckedChange={(v) => setSel((cur) => v === true ? [...cur, p] : cur.filter((x) => x !== p))} />
              <span>{p}</span>
            </label>
          ))}
          {vis.length === 0 && <p className="px-1.5 py-2 text-xs text-muted-foreground">Nenhum posto.</p>}
        </div>
        <p className="mt-1 text-[10px] text-muted-foreground">Marque mais de um quando a planilha separa (por cidade, turno…) o que na Senior é um posto só.</p>
        <div className="mt-2 flex justify-end gap-1.5">
          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setAberto(false)}>Cancelar</Button>
          <Button size="sm" className="h-7 text-xs" disabled={!sel.length || salvando} onClick={() => { onConfirmar(sel); setAberto(false); }}>
            Vincular {sel.length > 1 ? `(${sel.length})` : ""}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function DialogEditarVinculo({ aberto, posto, c, atuais, salvando, onClose, onSalvar, onIgnorar }: {
  aberto: boolean; posto: string | null; c: ContratoAtivos; atuais: string[]; salvando: boolean;
  onClose: () => void; onSalvar: (p: string[]) => void; onIgnorar: () => void;
}) {
  return (
    <Dialog open={aberto} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>Alterar vínculo do posto</DialogTitle></DialogHeader>
        {posto != null && (
          <div className="space-y-3 text-sm">
            <p><span className="text-muted-foreground">Posto na Senior:</span> <b>{limparPostoSenior(posto)}</b></p>
            <p><span className="text-muted-foreground">Ligado hoje a:</span> {atuais.join(" + ") || "—"}</p>
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="ghost" className="gap-1.5 text-muted-foreground" disabled={salvando} onClick={onIgnorar}><EyeOff className="h-4 w-4" /> Ignorar este posto</Button>
              <EscolherPostos postos={c.postos.map((p) => p.nome)} iniciais={atuais} salvando={salvando} onConfirmar={onSalvar} rotulo="Escolher postos da planilha" />
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ---- Filiais sem contrato ------------------------------------------------------

function FiliaisSemContrato({ filiais, contratos, podeVincular, onVerPessoas }: {
  filiais: { filial: string; qtd: number }[]; contratos: ContratoAtivos[]; podeVincular: boolean;
  onVerPessoas: (f: string) => void;
}) {
  const vincular = useVincularFilial();
  const [escolha, setEscolha] = useState<Record<string, string>>({});
  const opcoes = useMemo(() => [...contratos].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")), [contratos]);

  return (
    <Card className="mt-4 p-4">
      <p className="flex items-center gap-1.5 text-sm font-bold"><Building2 className="h-4 w-4 text-muted-foreground" /> Ativos sem contrato identificado</p>
      <p className="mb-3 text-xs text-muted-foreground">
        A filial do colaborador não tem o mesmo nome de nenhum contrato. {podeVincular ? "Ligue a filial ao contrato certo — vale também para Suprimentos e o Espaço do Colaborador." : ""}
      </p>
      <div className="space-y-1.5">
        {filiais.map((f) => (
          <div key={f.filial} className="flex flex-wrap items-center gap-2 rounded-md border border-border px-3 py-1.5 text-xs">
            <span className="min-w-[240px] flex-1 font-medium">{f.filial}</span>
            <span className="text-muted-foreground">{f.qtd} ativo(s)</span>
            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => onVerPessoas(f.filial)}>Ver</Button>
            {podeVincular && f.filial !== "(sem filial)" && (
              <>
                <Select value={escolha[f.filial] ?? ""} onValueChange={(v) => setEscolha((cur) => ({ ...cur, [f.filial]: v }))}>
                  <SelectTrigger className="h-7 w-64 text-xs"><SelectValue placeholder="Contrato…" /></SelectTrigger>
                  <SelectContent>
                    {opcoes.map((c) => <SelectItem key={c.id} value={c.id} className="text-xs">{c.nome}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Button size="sm" className="h-7 text-xs" disabled={!escolha[f.filial] || vincular.isPending}
                  onClick={async () => {
                    try {
                      await vincular.mutateAsync({ filial: f.filial, contratoId: escolha[f.filial] });
                      toast.success("Filial ligada ao contrato");
                    } catch (e) { toast.error((e as Error).message); }
                  }}>
                  Ligar
                </Button>
              </>
            )}
          </div>
        ))}
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground">
        Contratos que só aparecem com "Sem planilha" ou sem ativos costumam ser o outro lado desta lista — ex.: a filial "GUAPORÉ LIMP SMED…" e o contrato "GUAPORÉ LIMPEZA SMED…".
      </p>
    </Card>
  );
}

// ---- Lista de colaboradores ---------------------------------------------------

function DialogPessoas({ alvo, onClose }: {
  alvo: { contratoId: string | null; filial: string | null; titulo: string } | null; onClose: () => void;
}) {
  const { data = [], isLoading } = usePessoasAtivas(alvo?.contratoId ?? null, alvo?.filial ?? null, !!alvo);
  const [q, setQ] = useState("");
  const vis = data.filter((p) => !q || [p.nome, p.cargo, p.posto_senior, p.cadastro].some((x) => (x ?? "").toLowerCase().includes(q.toLowerCase())));
  return (
    <Dialog open={!!alvo} onOpenChange={(o) => { if (!o) { onClose(); setQ(""); } }}>
      <DialogContent className="max-w-3xl">
        <DialogHeader><DialogTitle className="pr-6">Colaboradores ativos · {alvo?.titulo}</DialogTitle></DialogHeader>
        <Input className="h-8 text-sm" placeholder="Buscar nome, cargo, posto ou matrícula…" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="max-h-[60vh] overflow-auto rounded-md border border-border">
          {isLoading ? (
            <p className="flex items-center gap-2 p-4 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Carregando…</p>
          ) : (
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-muted">
                <tr className="text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  <th className="px-2 py-1.5">Matr.</th><th className="px-2 py-1.5">Nome</th><th className="px-2 py-1.5">Cargo</th>
                  <th className="px-2 py-1.5">Posto (Senior)</th><th className="px-2 py-1.5">Situação</th>
                </tr>
              </thead>
              <tbody>
                {vis.map((p) => (
                  <tr key={p.empregado_id} className="border-t border-border/60">
                    <td className="px-2 py-1 tabular-nums text-muted-foreground">{p.cadastro ?? "—"}</td>
                    <td className="px-2 py-1 font-medium">{p.nome}</td>
                    <td className="px-2 py-1">{p.cargo ?? "—"}</td>
                    <td className="px-2 py-1" title={p.posto_senior}>{limparPostoSenior(p.posto_senior)}</td>
                    <td className={`px-2 py-1 ${p.situacao === "Trabalhando" ? "" : "text-warning"}`}>{p.situacao ?? "—"}</td>
                  </tr>
                ))}
                {vis.length === 0 && <tr><td colSpan={5} className="p-4 text-center text-muted-foreground">Ninguém.</td></tr>}
              </tbody>
            </table>
          )}
        </div>
        <p className="text-[11px] text-muted-foreground">{vis.length} de {data.length} colaborador(es)</p>
      </DialogContent>
    </Dialog>
  );
}
