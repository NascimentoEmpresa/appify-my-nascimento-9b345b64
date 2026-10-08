// =====================================================================
// RH › ATIVOS/CONTRATOS (/app/rh/ativos-contratos) — migs 20260930000279
// e 20261005000001
//
// Por contrato e por posto da Planilha de Custo: PREVISTO ("QT. PESSOAS")
// × TEM (colaboradores ativos da EMPREGADOS que estão no posto e contam —
// só quem está TRABALHANDO; atestado, auxílio-doença, licença, férias etc.
// não contam e aparecem em "Afastados", com a lista ao passar o mouse —
// atestado passou a ser afastado em 06/10/2026, mig 20261006000011).
//
// O posto da Senior ("01-1099-0071-0061-06-RECEPCIONISTA-B1 40H 5X2") não
// tem chave em comum com o da planilha ("POSTO B1 - RECEPCIONISTA 40H 5X2"):
// cada posto da Senior é ligado UMA vez a um posto da planilha (a tela
// sugere), e quem foge à regra é movido pessoa a pessoa.
//
// v2 (05/10/2026): a v1 mostrava grupos muitos-para-muitos, pendentes,
// ignorados e órfãos ao mesmo tempo — "tá MUITO CONFUSO". Ficou: previsto,
// tem, saldo, afastados; e um bloco "Definir posto" enquanto houver gente
// sem posto.
// =====================================================================
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import {
  AlertTriangle, Building2, CheckCircle2, ChevronDown, ChevronRight, Loader2, Search,
  ShieldAlert, Sparkles, UserMinus, Users, UserX, MessageSquare, Trash2, Send,
} from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { useAccessibleMenus } from "@/hooks/useAccessibleMenus";
import {
  usePainelAtivosContratos, usePessoasAtivas, useVincularPostos, useVincularFilial,
  useMoverColaborador, useObservacoesAtivos, useSalvarObservacaoAtivos, useExcluirObservacaoAtivos,
  type ObservacaoAtivos,
} from "@/hooks/useAtivosContratos";
import {
  conferirContrato, limparPostoSenior, fmtSaldo, sugerirContrato,
  type ContratoAtivos, type ConferenciaContrato, type ConferenciaPosto, type PessoaContrato,
  type PendenteSenior, type Situacao, type PainelAtivos,
} from "./conferenciaAtivos";

type Filtro = "todos" | "falta" | "excesso" | "ok" | "sem_posto" | "sem_planilha";
type Linha = { c: ContratoAtivos; conf: ConferenciaContrato };

const FILTROS: { k: Filtro; label: string }[] = [
  { k: "todos", label: "Todos" },
  { k: "falta", label: "Falta gente" },
  { k: "excesso", label: "Acima do previsto" },
  { k: "ok", label: "Completo" },
  { k: "sem_posto", label: "Gente sem posto" },
  { k: "sem_planilha", label: "Sem planilha" },
];

const passa = (l: Linha, f: Filtro) => {
  const temPlanilha = l.c.postos.length > 0;
  switch (f) {
    case "todos": return true;
    case "sem_planilha": return !temPlanilha;
    case "sem_posto": return temPlanilha && l.conf.semPosto > 0;
    default: return temPlanilha && l.conf.situacao === f;
  }
};

const corSaldo = (n: number) => (n === 0 ? "text-success" : n < 0 ? "text-destructive" : "text-warning");

// Valores especiais do Select de posto (o Radix não aceita value vazio).
const FORA = "__fora__";
const DA_SENIOR = "__senior__";

function Kpi({ icon: Icon, valor, rotulo, dica, tom = "primary" }: {
  icon: typeof Users; valor: React.ReactNode; rotulo: string; dica?: string; tom?: string;
}) {
  const tons: Record<string, string> = {
    primary: "bg-primary/10 text-primary", success: "bg-success/10 text-success",
    warning: "bg-warning/10 text-warning", destructive: "bg-destructive/10 text-destructive",
    info: "bg-info/10 text-info",
  };
  return (
    <Card className="flex items-center gap-3 p-4">
      <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${tons[tom]}`}><Icon className="h-5 w-5" /></div>
      <div className="min-w-0">
        <p className="text-2xl font-bold leading-none tabular-nums">{valor}</p>
        <p className="mt-1 truncate text-xs font-medium text-muted-foreground">{rotulo}</p>
        {dica && <p className="truncate text-[11px] text-muted-foreground/70">{dica}</p>}
      </div>
    </Card>
  );
}

function SituacaoBadge({ situacao, saldo }: { situacao: Situacao; saldo: number }) {
  if (situacao === "ok") {
    return <Badge variant="outline" className="gap-1 border-success/30 bg-success/10 text-[10px] font-semibold text-success"><CheckCircle2 className="h-3 w-3" /> Completo</Badge>;
  }
  if (situacao === "falta") {
    return <Badge variant="outline" className="border-destructive/30 bg-destructive/10 text-[10px] font-semibold text-destructive">Faltam {-saldo}</Badge>;
  }
  return <Badge variant="outline" className="border-warning/30 bg-warning/10 text-[10px] font-semibold text-warning">{saldo} acima</Badge>;
}

/** Número de afastados; ao passar o mouse, quem são. */
function Afastados({ pessoas, mostrarPosto = false }: { pessoas: PessoaContrato[]; mostrarPosto?: boolean }) {
  if (!pessoas.length) return <span className="text-muted-foreground/50">—</span>;
  return (
    <HoverCard openDelay={80} closeDelay={80}>
      <HoverCardTrigger asChild>
        <button type="button" onClick={(e) => e.stopPropagation()}
          className="cursor-default rounded px-1.5 font-medium text-warning underline decoration-dotted underline-offset-4 hover:bg-warning/10">
          {pessoas.length}
        </button>
      </HoverCardTrigger>
      <HoverCardContent align="end" className="w-96 p-0" onClick={(e) => e.stopPropagation()}>
        <p className="border-b border-border px-3 py-2 text-xs font-semibold">
          Afastados · não contam no posto ({pessoas.length})
        </p>
        <div className="max-h-72 overflow-y-auto py-1">
          {pessoas.map((p) => (
            <div key={p.id} className="px-3 py-1.5 text-xs">
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-medium">{p.nome}</span>
                <span className="shrink-0 text-warning">{p.situacao ?? "—"}</span>
              </div>
              {mostrarPosto && <p className="truncate text-[11px] text-muted-foreground">{p.posto ?? limparPostoSenior(p.posto_senior)}</p>}
            </div>
          ))}
        </div>
      </HoverCardContent>
    </HoverCard>
  );
}

export default function AtivosContratos() {
  const { data: access } = useAccessibleMenus("visualizar");
  const podeVincular = !!access?.codes.has("rh_ativos_contratos_vincular");
  const { data, isLoading, error, isFetching, refetch } = usePainelAtivosContratos();

  const [busca, setBusca] = useState("");
  const [filtro, setFiltro] = useState<Filtro>("todos");
  const [aberto, setAberto] = useState<string | null>(null);
  const [pessoasDe, setPessoasDe] = useState<{ filial: string } | null>(null);

  const linhas: Linha[] = useMemo(
    () => (data?.contratos ?? []).map((c) => ({ c, conf: conferirContrato(c) })),
    [data],
  );

  const contagem = useMemo(() => {
    const m = {} as Record<Filtro, number>;
    FILTROS.forEach(({ k }) => { m[k] = linhas.filter((l) => passa(l, k)).length; });
    return m;
  }, [linhas]);

  const visiveis = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return linhas
      .filter((l) => passa(l, filtro))
      .filter((l) => !q || l.c.nome.toLowerCase().includes(q) || (l.c.cliente ?? "").toLowerCase().includes(q));
  }, [linhas, filtro, busca]);

  const tot = useMemo(() => {
    const com = linhas.filter((l) => l.c.postos.length);
    return {
      previsto: com.reduce((s, l) => s + l.conf.previsto, 0),
      tem: com.reduce((s, l) => s + l.conf.tem, 0),
      falta: com.reduce((s, l) => s + l.conf.falta, 0),
      sobra: com.reduce((s, l) => s + l.conf.sobra, 0),
      semPosto: com.reduce((s, l) => s + l.conf.semPosto, 0),
      contratosSemPosto: com.filter((l) => l.conf.semPosto > 0).length,
      afastados: com.reduce((s, l) => s + l.conf.afastados.length, 0),
      semContrato: (data?.filiais_sem_contrato ?? []).reduce((s, f) => s + f.qtd, 0),
    };
  }, [linhas, data]);

  // 07/10/2026: só troca a tela pelo erro quando não há nada para mostrar. Antes,
  // uma recarga em segundo plano que falhava (depois de mover alguém, por
  // ex.) apagava a tela de quem estava editando ("tá caindo toda hora").
  if (error && !data) {
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
        subtitle="Quantas pessoas cada posto deveria ter (Planilha de Custo) e quantas tem de fato."
        module="Recursos Humanos"
        breadcrumb={["Recursos Humanos", "Ativos/Contratos"]}
      />

      {error && data && (
        <div className="mb-3 flex items-center gap-2 rounded-lg border border-warning/40 bg-warning/5 px-3 py-2 text-xs text-muted-foreground">
          <AlertTriangle className="h-4 w-4 shrink-0 text-warning" />
          <span>Não deu para atualizar agora — mostrando os últimos dados carregados.</span>
          <Button size="sm" variant="outline" className="ml-auto h-7 text-xs" disabled={isFetching} onClick={() => refetch()}>Tentar de novo</Button>
        </div>
      )}
      {isLoading || !data ? (
        <Card className="flex items-center gap-2 p-6 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Carregando…</Card>
      ) : (
        <>
          <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Kpi icon={Users} valor={tot.previsto.toLocaleString("pt-BR")} rotulo="Previsto" dica="soma das vagas da planilha" tom="info" />
            <Kpi icon={CheckCircle2} valor={tot.tem.toLocaleString("pt-BR")} rotulo="Tem" dica={`trabalhando · ${tot.afastados} afastado(s) fora`} tom="success" />
            {/* Falta posto a posto só é real com todo mundo no seu posto — antes
                disso, gente "sem posto" vira falta no posto e infla o número. */}
            <Kpi icon={AlertTriangle} valor={<span className={corSaldo(tot.tem - tot.previsto)}>{fmtSaldo(tot.tem - tot.previsto)}</span>}
                 rotulo="Saldo geral (tem − previsto)"
                 dica={tot.semPosto ? "posto a posto: defina o posto de todos" : `posto a posto: faltam ${tot.falta}, sobram ${tot.sobra}`}
                 tom="destructive" />
            <Kpi icon={UserMinus} valor={tot.semPosto.toLocaleString("pt-BR")} rotulo="Pessoas sem posto definido"
                 dica={`${tot.contratosSemPosto} contrato(s) — defina para a conta fechar`} tom="warning" />
          </div>

          {tot.semContrato > 0 && (
            <button type="button" onClick={() => document.getElementById("sem-contrato")?.scrollIntoView({ behavior: "smooth" })}
              className="mb-4 flex w-full items-center gap-2 rounded-lg border border-warning/30 bg-warning/5 px-4 py-2.5 text-left text-sm hover:bg-warning/10">
              <UserX className="h-4 w-4 shrink-0 text-warning" />
              <span><b>{tot.semContrato}</b> colaborador(es) ativos em {data.filiais_sem_contrato.length} filial(is) da Senior sem contrato ligado — não entram em conta nenhuma.</span>
              <span className="ml-auto shrink-0 text-xs font-medium text-primary">Ligar ao contrato ↓</span>
            </button>
          )}

          <Card className="p-4">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <div className="relative w-full sm:w-72">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input className="h-9 pl-8 text-sm" placeholder="Buscar contrato ou cliente…" value={busca} onChange={(e) => setBusca(e.target.value)} />
              </div>
              <div className="flex flex-wrap gap-1.5">
                {FILTROS.map(({ k, label }) => (
                  <Button key={k} size="sm" variant={filtro === k ? "default" : "outline"} className="h-8 text-xs" onClick={() => setFiltro(k)}>
                    {label}
                    <span className="ml-1.5 rounded-full bg-background/20 px-1.5 text-[10px]">{contagem[k] ?? 0}</span>
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
                    <th className="w-24 py-2 pr-3 text-right">Previsto</th>
                    <th className="w-24 py-2 pr-3 text-right">Tem</th>
                    <th className="w-24 py-2 pr-3 text-right">Saldo</th>
                    <th className="w-24 py-2 pr-3 text-right">Afastados</th>
                    <th className="w-56 py-2 pr-3" />
                  </tr>
                </thead>
                <tbody>
                  {visiveis.map(({ c, conf }) => {
                    const exp = aberto === c.id;
                    return (
                      <LinhaContrato key={c.id} c={c} conf={conf} aberto={exp} podeVincular={podeVincular}
                        onToggle={() => setAberto(exp ? null : c.id)} />
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
              contratos={data.todos_contratos}
              podeVincular={podeVincular}
              onVerPessoas={(f) => setPessoasDe({ filial: f })}
            />
          )}

          <p className="mt-3 text-[11px] text-muted-foreground">
            Tem = colaboradores ativos no posto que estão trabalhando. Atestado, auxílio-doença, licença, férias e
            outros afastamentos não contam (o posto está descoberto) e aparecem em Afastados.
            Previsto = QT. PESSOAS dos postos EXECUTADO vigentes da Planilha de Custo. Atualizado em {new Date(data.gerado_em).toLocaleString("pt-BR")}.
          </p>
        </>
      )}

      <DialogPessoasFilial filial={pessoasDe?.filial ?? null} onClose={() => setPessoasDe(null)} />
    </div>
  );
}

// ---- Linha do contrato ---------------------------------------------------------

function LinhaContrato({ c, conf, aberto, podeVincular, onToggle }: {
  c: ContratoAtivos; conf: ConferenciaContrato; aberto: boolean; podeVincular: boolean; onToggle: () => void;
}) {
  const temPlanilha = c.postos.length > 0;
  return (
    <>
      <tr className={`cursor-pointer border-b border-border/60 hover:bg-muted/30 ${aberto ? "bg-muted/30" : ""}`} onClick={onToggle}>
        <td className="py-2.5 pl-3 text-muted-foreground">{aberto ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</td>
        <td className="py-2.5 pr-3">
          <p className="flex items-center gap-1.5 font-medium">{c.nome}<SeloObservacoes contratoId={c.id} /></p>
          {c.cliente && <p className="text-[11px] text-muted-foreground">{c.cliente}</p>}
        </td>
        <td className="py-2.5 pr-3 text-right tabular-nums">{temPlanilha ? conf.previsto : "—"}</td>
        <td className="py-2.5 pr-3 text-right font-medium tabular-nums">{conf.tem}</td>
        <td className={`py-2.5 pr-3 text-right font-bold tabular-nums ${temPlanilha ? corSaldo(conf.saldo) : "text-muted-foreground"}`}>
          {temPlanilha ? fmtSaldo(conf.saldo) : "—"}
        </td>
        <td className="py-2.5 pr-3 text-right tabular-nums"><Afastados pessoas={conf.afastados} mostrarPosto /></td>
        <td className="py-2.5 pr-3">
          <div className="flex items-center gap-1 whitespace-nowrap">
            {temPlanilha
              ? <SituacaoBadge situacao={conf.situacao} saldo={conf.saldo} />
              : <Badge variant="outline" className="text-[10px] text-muted-foreground">Sem planilha</Badge>}
            {temPlanilha && conf.semPosto > 0 && (
              <Badge variant="outline" className="border-info/30 bg-info/10 text-[10px] font-semibold text-info">{conf.semPosto} sem posto</Badge>
            )}
          </div>
        </td>
      </tr>
      {aberto && (
        <tr className="border-b border-border">
          <td colSpan={7} className="bg-muted/10 p-4">
            <DetalheContrato c={c} conf={conf} podeVincular={podeVincular} />
          </td>
        </tr>
      )}
    </>
  );
}

// ---- Detalhe do contrato -------------------------------------------------------

function DetalheContrato({ c, conf, podeVincular }: { c: ContratoAtivos; conf: ConferenciaContrato; podeVincular: boolean }) {
  if (!c.postos.length) {
    return (
      <div className="space-y-2 text-sm">
        <p className="text-muted-foreground">
          Este contrato não tem posto EXECUTADO vigente na Planilha de Custo — não há quantidade prevista para comparar.
        </p>
        <ListaPessoas pessoas={c.pessoas} />
        <ObservacoesContrato c={c} />
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <ObservacoesContrato c={c} />
      {conf.pendentes.length > 0 && <DefinirPostos c={c} conf={conf} podeVincular={podeVincular} />}
      <TabelaPostos c={c} conf={conf} podeVincular={podeVincular} />
      {conf.fora.length > 0 && <ForaDaConta c={c} pessoas={conf.fora} podeVincular={podeVincular} />}
    </div>
  );
}

/** Select de posto da planilha, com "fora da conta" e (opcional) "voltar ao posto da Senior". */
function SelectPosto({ c, valor, onChange, disabled, comVoltar = false, placeholder = "Escolher posto…", className = "w-72" }: {
  c: ContratoAtivos; valor: string | undefined; onChange: (v: string) => void; disabled?: boolean;
  comVoltar?: boolean; placeholder?: string; className?: string;
}) {
  return (
    <Select value={valor ?? ""} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger className={`h-8 text-xs ${className}`} onClick={(e) => e.stopPropagation()}><SelectValue placeholder={placeholder} /></SelectTrigger>
      <SelectContent>
        {c.postos.map((p) => (
          <SelectItem key={p.nome} value={p.nome} className="text-xs">{p.nome} <span className="text-muted-foreground">· {p.vagas} vaga(s)</span></SelectItem>
        ))}
        <SelectSeparator />
        {comVoltar && <SelectItem value={DA_SENIOR} className="text-xs">Voltar ao posto da Senior</SelectItem>}
        <SelectItem value={FORA} className="text-xs text-muted-foreground">Fora da conta deste contrato</SelectItem>
      </SelectContent>
    </Select>
  );
}

function useAcoesPosto(c: ContratoAtivos) {
  const vincular = useVincularPostos();
  const mover = useMoverColaborador();
  const ligarPostoSenior = async (pares: { posto_senior: string; destino: string }[]) => {
    try {
      await vincular.mutateAsync({
        contratoId: c.id,
        itens: pares.map(({ posto_senior, destino }) => ({
          posto_senior, planilha_postos: destino === FORA ? [] : [destino], ignorar: destino === FORA,
        })),
      });
      const n = pares.length;
      toast.success(n === 1 ? "Posto definido" : `${n} postos da Senior definidos`);
      return true;
    } catch (e) { toast.error((e as Error).message); return false; }
  };
  const moverPessoa = async (p: PessoaContrato, destino: string) => {
    try {
      await mover.mutateAsync({ empregadoId: p.id, posto: destino === DA_SENIOR ? null : destino === FORA ? "" : destino });
      toast.success(destino === DA_SENIOR ? `${p.nome} voltou ao posto da Senior`
        : destino === FORA ? `${p.nome} fora da conta` : `${p.nome} → ${destino}`);
    } catch (e) { toast.error((e as Error).message); }
  };
  return { ligarPostoSenior, moverPessoa, salvando: vincular.isPending || mover.isPending };
}

/** Bloco em destaque enquanto houver gente sem posto da planilha. */
function DefinirPostos({ c, conf, podeVincular }: { c: ContratoAtivos; conf: ConferenciaContrato; podeVincular: boolean }) {
  const { ligarPostoSenior, moverPessoa, salvando } = useAcoesPosto(c);
  const [escolha, setEscolha] = useState<Record<string, string>>({});
  const [abertos, setAbertos] = useState<Set<string>>(new Set());
  const destino = (g: PendenteSenior) => escolha[g.posto_senior] ?? g.sugestao ?? undefined;
  const prontos = conf.pendentes.filter((g) => destino(g));

  return (
    <div className="rounded-lg border border-info/40 bg-info/5 p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold">Definir o posto de {conf.semPosto} pessoa(s)</p>
          <p className="text-[11px] text-muted-foreground">
            Escolha em qual posto da planilha fica cada posto da Senior — vale para todos que estão nele.
            Quem estiver em outro posto, abra a lista e mova a pessoa.
          </p>
        </div>
        {podeVincular && prontos.length > 0 && (
          <Button size="sm" className="h-8 gap-1.5 text-xs" disabled={salvando}
            onClick={() => ligarPostoSenior(prontos.map((g) => ({ posto_senior: g.posto_senior, destino: destino(g)! })))}>
            <Sparkles className="h-3.5 w-3.5" /> Confirmar {prontos.length === conf.pendentes.length ? "todos" : `${prontos.length} preenchido(s)`}
          </Button>
        )}
      </div>

      <div className="overflow-hidden rounded-md border border-border bg-background">
        {conf.pendentes.map((g) => {
          const exp = abertos.has(g.posto_senior);
          const d = destino(g);
          return (
            <div key={g.posto_senior} className="border-b border-border/60 last:border-0">
              <div className="flex flex-wrap items-center gap-2 px-3 py-2 text-xs">
                <button type="button" className="flex min-w-[240px] flex-1 items-center gap-1.5 text-left"
                  onClick={() => setAbertos((s) => { const n = new Set(s); if (exp) n.delete(g.posto_senior); else n.add(g.posto_senior); return n; })}>
                  {exp ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
                  <span>
                    <span className="font-medium" title={g.posto_senior}>{limparPostoSenior(g.posto_senior)}</span>
                    <span className="text-muted-foreground"> · {g.pessoas.length} pessoa(s)</span>
                  </span>
                </button>
                {podeVincular ? (
                  <>
                    {g.sugestao && !escolha[g.posto_senior] && (
                      <span className="flex items-center gap-1 text-[10px] text-info"><Sparkles className="h-3 w-3" /> sugerido</span>
                    )}
                    <SelectPosto c={c} valor={d} disabled={salvando}
                      onChange={(v) => setEscolha((cur) => ({ ...cur, [g.posto_senior]: v }))} />
                    <Button size="sm" variant="outline" className="h-8 text-xs" disabled={!d || salvando}
                      onClick={() => d && ligarPostoSenior([{ posto_senior: g.posto_senior, destino: d }])}>
                      Confirmar
                    </Button>
                  </>
                ) : (
                  <span className="text-muted-foreground">{g.sugestao ? `sugestão: ${g.sugestao}` : "sem sugestão"}</span>
                )}
              </div>
              {exp && (
                <div className="border-t border-border/60 bg-muted/20 px-3 py-1.5">
                  {g.pessoas.map((p) => (
                    <LinhaPessoa key={p.id} p={p} c={c} podeVincular={podeVincular} salvando={salvando} onMover={moverPessoa} />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {!podeVincular && (
        <p className="mt-2 text-[11px] text-muted-foreground">Para definir os postos, peça a liberação de <b>Ativos/Contratos · Vincular postos</b> em Acesso por Usuário.</p>
      )}
    </div>
  );
}

/** Previsto × tem de cada posto da planilha. Clique abre quem está no posto. */
function TabelaPostos({ c, conf, podeVincular }: { c: ContratoAtivos; conf: ConferenciaContrato; podeVincular: boolean }) {
  const [aberto, setAberto] = useState<string | null>(null);
  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-background">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-border bg-muted/40 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            <th className="w-7 py-2 pl-3" />
            <th className="py-2 pr-3">Posto</th>
            <th className="w-20 py-2 pr-3 text-right">Previsto</th>
            <th className="w-20 py-2 pr-3 text-right">Tem</th>
            <th className="w-20 py-2 pr-3 text-right">Saldo</th>
            <th className="w-20 py-2 pr-3 text-right">Afastados</th>
            <th className="w-32 py-2 pr-3" />
          </tr>
        </thead>
        <tbody>
          {conf.postos.map((p) => (
            <LinhaPosto key={p.nome} c={c} p={p} aberto={aberto === p.nome} podeVincular={podeVincular}
              onToggle={() => setAberto(aberto === p.nome ? null : p.nome)} />
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t border-border bg-muted/30 font-semibold">
            <td />
            <td className="py-2 pr-3">Total{conf.semPosto > 0 && <span className="font-normal text-muted-foreground"> · {conf.semPosto} pessoa(s) ainda sem posto entram só no total do contrato</span>}</td>
            <td className="py-2 pr-3 text-right tabular-nums">{conf.previsto}</td>
            <td className="py-2 pr-3 text-right tabular-nums">{conf.postos.reduce((s, p) => s + p.tem, 0)}</td>
            <td className="py-2 pr-3 text-right tabular-nums">
              <span className="text-destructive">−{conf.falta}</span>
              {conf.sobra > 0 && <span className="text-warning"> / +{conf.sobra}</span>}
            </td>
            <td className="py-2 pr-3 text-right tabular-nums"><Afastados pessoas={conf.postos.flatMap((p) => p.afastados)} mostrarPosto /></td>
            <td />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function LinhaPosto({ c, p, aberto, podeVincular, onToggle }: {
  c: ContratoAtivos; p: ConferenciaPosto; aberto: boolean; podeVincular: boolean; onToggle: () => void;
}) {
  const { ligarPostoSenior, moverPessoa, salvando } = useAcoesPosto(c);
  // Dentro do posto, quem veio pelo posto da Senior fica agrupado (dá para
  // trocar o posto do grupo inteiro); quem foi movido aparece à parte.
  const grupos = useMemo(() => {
    const m = new Map<string, PessoaContrato[]>();
    p.pessoas.filter((x) => x.origem !== "pessoa").forEach((x) => {
      if (!m.has(x.posto_senior)) m.set(x.posto_senior, []);
      m.get(x.posto_senior)!.push(x);
    });
    return [...m.entries()];
  }, [p.pessoas]);
  const movidos = p.pessoas.filter((x) => x.origem === "pessoa");

  return (
    <>
      <tr className={`border-b border-border/60 ${p.pessoas.length ? "cursor-pointer hover:bg-muted/30" : ""} ${aberto ? "bg-muted/30" : ""}`}
        onClick={() => p.pessoas.length && onToggle()}>
        <td className="py-2 pl-3 text-muted-foreground">
          {p.pessoas.length > 0 && (aberto ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />)}
        </td>
        <td className="py-2 pr-3 font-medium"><span className="inline-flex items-center gap-1.5">{p.nome}<SeloObservacoes contratoId={c.id} posto={p.nome} /></span></td>
        <td className="py-2 pr-3 text-right tabular-nums">{p.previsto}</td>
        <td className="py-2 pr-3 text-right font-medium tabular-nums">{p.tem}</td>
        <td className={`py-2 pr-3 text-right font-bold tabular-nums ${corSaldo(p.saldo)}`}>{fmtSaldo(p.saldo)}</td>
        <td className="py-2 pr-3 text-right tabular-nums"><Afastados pessoas={p.afastados} /></td>
        <td className="py-2 pr-3"><SituacaoBadge situacao={p.situacao} saldo={p.saldo} /></td>
      </tr>
      {aberto && (
        <tr className="border-b border-border/60">
          <td colSpan={7} className="bg-muted/10 px-4 py-2">
            {grupos.map(([ps, pessoas]) => (
              <div key={ps} className="mb-2 last:mb-0">
                <div className="flex flex-wrap items-center gap-2 py-1">
                  <p className="flex-1 text-[11px] text-muted-foreground">
                    Posto na Senior: <span className="font-medium text-foreground" title={ps}>{limparPostoSenior(ps)}</span> · {pessoas.length}
                  </p>
                  {podeVincular && (
                    <SelectPosto c={c} valor={undefined} disabled={salvando} placeholder="Trocar o posto de todos…" className="w-60"
                      onChange={(v) => v !== p.nome && ligarPostoSenior([{ posto_senior: ps, destino: v }])} />
                  )}
                </div>
                {pessoas.map((x) => <LinhaPessoa key={x.id} p={x} c={c} podeVincular={podeVincular} salvando={salvando} onMover={moverPessoa} />)}
              </div>
            ))}
            {movidos.length > 0 && (
              <div>
                <p className="py-1 text-[11px] text-muted-foreground">Movidos para este posto individualmente · {movidos.length}</p>
                {movidos.map((x) => <LinhaPessoa key={x.id} p={x} c={c} podeVincular={podeVincular} salvando={salvando} onMover={moverPessoa} mostrarSenior />)}
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

function LinhaPessoa({ p, c, podeVincular, salvando, onMover, mostrarSenior = false }: {
  p: PessoaContrato; c: ContratoAtivos; podeVincular: boolean; salvando: boolean;
  onMover: (p: PessoaContrato, destino: string) => void; mostrarSenior?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded px-1 py-1 text-xs hover:bg-background">
      <span className="w-16 shrink-0 tabular-nums text-muted-foreground">{p.cadastro ?? "—"}</span>
      <span className="min-w-[180px] flex-1">
        <span className="font-medium">{p.nome}</span>
        {p.cargo && <span className="text-muted-foreground"> · {p.cargo}</span>}
        {mostrarSenior && <span className="text-muted-foreground"> · Senior: {limparPostoSenior(p.posto_senior)}</span>}
      </span>
      <span className={`w-36 shrink-0 ${p.conta ? "text-muted-foreground" : "font-medium text-warning"}`}>{p.situacao ?? "—"}</span>
      {podeVincular && (
        <SelectPosto c={c} valor={undefined} disabled={salvando} placeholder="Mover para…" className="w-52" comVoltar={p.origem === "pessoa"}
          onChange={(v) => v !== p.posto && onMover(p, v)} />
      )}
    </div>
  );
}

function ForaDaConta({ c, pessoas, podeVincular }: { c: ContratoAtivos; pessoas: PessoaContrato[]; podeVincular: boolean }) {
  const { ligarPostoSenior, moverPessoa, salvando } = useAcoesPosto(c);
  const [aberto, setAberto] = useState(false);
  return (
    <div className="rounded-lg border border-border bg-background p-3">
      <button type="button" className="flex items-center gap-1.5 text-xs font-semibold" onClick={() => setAberto(!aberto)}>
        {aberto ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        Fora da conta · {pessoas.length} pessoa(s)
      </button>
      {aberto && (
        <div className="mt-1.5">
          {pessoas.map((p) => (
            <div key={p.id} className="flex flex-wrap items-center gap-2 px-1 py-1 text-xs">
              <span className="min-w-[180px] flex-1"><span className="font-medium">{p.nome}</span>
                <span className="text-muted-foreground"> · Senior: {limparPostoSenior(p.posto_senior)}</span></span>
              <span className="w-36 text-muted-foreground">{p.situacao ?? "—"}</span>
              {podeVincular && (
                <SelectPosto c={c} valor={undefined} disabled={salvando} placeholder="Colocar em…" className="w-52"
                  onChange={(v) => {
                    if (v === FORA) return;
                    // Fora por causa do posto da Senior inteiro → desfaz o "ignorar" do posto;
                    // fora individualmente → move a pessoa.
                    if (p.origem === "posto") ligarPostoSenior([{ posto_senior: p.posto_senior, destino: v }]);
                    else moverPessoa(p, v);
                  }} />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ListaPessoas({ pessoas }: { pessoas: PessoaContrato[] }) {
  return (
    <div className="max-h-80 overflow-y-auto rounded-md border border-border bg-background p-2">
      {pessoas.map((p) => (
        <div key={p.id} className="flex gap-2 px-1 py-0.5 text-xs">
          <span className="w-16 tabular-nums text-muted-foreground">{p.cadastro ?? "—"}</span>
          <span className="flex-1 font-medium">{p.nome}</span>
          <span className="flex-1 text-muted-foreground">{limparPostoSenior(p.posto_senior)}</span>
          <span className={p.conta ? "text-muted-foreground" : "text-warning"}>{p.situacao}</span>
        </div>
      ))}
      {!pessoas.length && <p className="p-2 text-xs text-muted-foreground">Ninguém ativo.</p>}
    </div>
  );
}

// ---- Filiais sem contrato ------------------------------------------------------

function FiliaisSemContrato({ filiais, contratos, podeVincular, onVerPessoas }: {
  filiais: { filial: string; qtd: number }[]; contratos: PainelAtivos["todos_contratos"]; podeVincular: boolean;
  onVerPessoas: (f: string) => void;
}) {
  const vincular = useVincularFilial();
  const [escolha, setEscolha] = useState<Record<string, string>>({});
  const opcoes = useMemo(() => [...contratos].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")), [contratos]);
  const sugestao = useMemo(() => {
    const m: Record<string, string> = {};
    filiais.forEach((f) => { const s = sugerirContrato(f.filial, opcoes); if (s) m[f.filial] = s.id; });
    return m;
  }, [filiais, opcoes]);

  return (
    <Card id="sem-contrato" className="mt-4 scroll-mt-4 p-4">
      <p className="flex items-center gap-1.5 text-sm font-bold"><Building2 className="h-4 w-4 text-muted-foreground" /> Filiais da Senior sem contrato ligado</p>
      <p className="mb-3 text-xs text-muted-foreground">
        O nome da filial não bateu com nenhum contrato (ex.: "CAXIAS DO SUL - 95.2026" × "CAXIAS DO SUL - 2026/95").
        {podeVincular ? " Ligue ao contrato certo — vale também para Suprimentos e o Espaço do Colaborador." : ""}
      </p>
      <div className="space-y-1.5">
        {filiais.map((f) => {
          const sel = escolha[f.filial] ?? sugestao[f.filial];
          return (
            <div key={f.filial} className="flex flex-wrap items-center gap-2 rounded-md border border-border px-3 py-1.5 text-xs">
              <span className="min-w-[240px] flex-1 font-medium">{f.filial}</span>
              <span className="text-muted-foreground">{f.qtd} ativo(s)</span>
              <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => onVerPessoas(f.filial)}>Ver</Button>
              {podeVincular && f.filial !== "(sem filial)" && (
                <>
                  {sel && !escolha[f.filial] && <span className="flex items-center gap-1 text-[10px] text-info"><Sparkles className="h-3 w-3" /> sugerido</span>}
                  <Select value={sel ?? ""} onValueChange={(v) => setEscolha((cur) => ({ ...cur, [f.filial]: v }))}>
                    <SelectTrigger className="h-7 w-72 text-xs"><SelectValue placeholder="Contrato…" /></SelectTrigger>
                    <SelectContent>
                      {opcoes.map((c) => <SelectItem key={c.id} value={c.id} className="text-xs">{c.nome}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Button size="sm" className="h-7 text-xs" disabled={!sel || vincular.isPending}
                    onClick={async () => {
                      try {
                        await vincular.mutateAsync({ filial: f.filial, contratoId: sel! });
                        toast.success("Filial ligada ao contrato");
                      } catch (e) { toast.error((e as Error).message); }
                    }}>
                    Ligar
                  </Button>
                </>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function DialogPessoasFilial({ filial, onClose }: { filial: string | null; onClose: () => void }) {
  const { data = [], isLoading } = usePessoasAtivas(null, filial, !!filial);
  return (
    <Dialog open={!!filial} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-3xl">
        <DialogHeader><DialogTitle className="pr-6">Colaboradores ativos · {filial}</DialogTitle></DialogHeader>
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
                {data.map((p) => (
                  <tr key={p.empregado_id} className="border-t border-border/60">
                    <td className="px-2 py-1 tabular-nums text-muted-foreground">{p.cadastro ?? "—"}</td>
                    <td className="px-2 py-1 font-medium">{p.nome}</td>
                    <td className="px-2 py-1">{p.cargo ?? "—"}</td>
                    <td className="px-2 py-1" title={p.posto_senior}>{limparPostoSenior(p.posto_senior)}</td>
                    <td className="px-2 py-1">{p.situacao ?? "—"}</td>
                  </tr>
                ))}
                {data.length === 0 && <tr><td colSpan={5} className="p-4 text-center text-muted-foreground">Ninguém.</td></tr>}
              </tbody>
            </table>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---- Observações (mig 20261008000010, 08/10/2026) --------------------------
// "Por que tem gente a mais/a menos aqui": recado datado e assinado no
// contrato inteiro ou num posto. Selo com a contagem nas linhas (passe o
// mouse para ler) e a lista com o campo de escrever ao abrir o contrato.

function useObservacoesDe(contratoId: string, posto?: string) {
  const { data = [] } = useObservacoesAtivos();
  return useMemo(() => data.filter((o) => o.contrato_id === contratoId && (posto === undefined || o.posto === posto)), [data, contratoId, posto]);
}

const fmtQuando = (iso: string) => new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });

function SeloObservacoes({ contratoId, posto }: { contratoId: string; posto?: string }) {
  const obs = useObservacoesDe(contratoId, posto);
  if (!obs.length) return null;
  return (
    <HoverCard openDelay={150}>
      <HoverCardTrigger asChild>
        <span onClick={(e) => e.stopPropagation()}
          className="inline-flex cursor-help items-center gap-0.5 rounded-full border border-amber-300 bg-amber-50 px-1.5 py-px text-[10px] font-semibold text-amber-700 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
          <MessageSquare className="h-3 w-3" /> {obs.length}
        </span>
      </HoverCardTrigger>
      <HoverCardContent className="w-96 space-y-2 p-3" align="start">
        <p className="text-xs font-semibold">{posto === undefined ? "Observações do contrato" : `Observações do posto ${posto}`}</p>
        {obs.slice(0, 4).map((o) => <ItemObservacao key={o.id} o={o} compacto />)}
        {obs.length > 4 && <p className="text-[11px] text-muted-foreground">+{obs.length - 4} — abra o contrato para ver todas.</p>}
      </HoverCardContent>
    </HoverCard>
  );
}

function ItemObservacao({ o, compacto = false }: { o: ObservacaoAtivos; compacto?: boolean }) {
  const excluir = useExcluirObservacaoAtivos();
  return (
    <div className="rounded-md border border-border bg-background px-2.5 py-1.5 text-xs">
      <div className="flex items-start gap-2">
        <p className="flex-1 whitespace-pre-wrap">{o.texto}</p>
        {!compacto && o.pode_apagar && (
          <button type="button" title="Apagar observação" disabled={excluir.isPending}
            className="text-muted-foreground hover:text-destructive"
            onClick={() => window.confirm("Apagar esta observação?") && excluir.mutate(o.id, { onError: (e) => toast.error((e as Error).message) })}>
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      <p className="mt-0.5 text-[10px] text-muted-foreground">
        {o.posto ? <span className="font-medium text-foreground">Posto {o.posto} · </span> : <span className="font-medium text-foreground">Contrato · </span>}
        {o.autor_nome ?? "—"} · {fmtQuando(o.created_at)}
      </p>
    </div>
  );
}

function ObservacoesContrato({ c }: { c: ContratoAtivos }) {
  const obs = useObservacoesDe(c.id);
  const salvar = useSalvarObservacaoAtivos();
  const [texto, setTexto] = useState("");
  const [posto, setPosto] = useState("");   // "" = contrato inteiro
  const enviar = () => {
    if (texto.trim().length < 3) { toast.error("Escreva a observação."); return; }
    salvar.mutate({ contratoId: c.id, posto, texto: texto.trim() }, {
      onSuccess: () => { setTexto(""); toast.success("Observação salva."); },
      onError: (e) => toast.error((e as Error).message),
    });
  };
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50/50 p-3 dark:border-amber-900 dark:bg-amber-950/20">
      <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold"><MessageSquare className="h-3.5 w-3.5 text-amber-600" /> Observações {obs.length > 0 && `(${obs.length})`}
        <span className="font-normal text-muted-foreground">— por que este contrato ou posto está com gente a mais ou a menos</span></p>
      {obs.length > 0 && <div className="mb-2 max-h-60 space-y-1.5 overflow-y-auto">{obs.map((o) => <ItemObservacao key={o.id} o={o} />)}</div>}
      <div className="flex flex-wrap items-start gap-2">
        <Select value={posto || "__contrato"} onValueChange={(v) => setPosto(v === "__contrato" ? "" : v)}>
          <SelectTrigger className="h-9 w-56 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__contrato" className="text-xs">Contrato inteiro</SelectItem>
            {c.postos.map((p) => <SelectItem key={p.nome} value={p.nome} className="text-xs">Posto: {p.nome}</SelectItem>)}
          </SelectContent>
        </Select>
        <Textarea value={texto} onChange={(e) => setTexto(e.target.value)} rows={2} maxLength={2000}
          placeholder="Ex.: +3 serventes cobrindo férias até 30/10; reforço pedido pelo cliente no evento de novembro…"
          className="min-h-9 flex-1 text-xs" onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) enviar(); }} />
        <Button size="sm" className="h-9 gap-1.5" disabled={salvar.isPending || texto.trim().length < 3} onClick={enviar}>
          {salvar.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />} Salvar
        </Button>
      </div>
    </div>
  );
}
