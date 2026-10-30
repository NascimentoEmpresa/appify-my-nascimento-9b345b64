import { ReactNode, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Link } from "react-router-dom";
import { ArrowRight, Pencil, AlertTriangle, ArrowDown, ArrowUp, BarChart3, Briefcase, CheckCircle2, ClipboardCopy, CreditCard, FileText, Landmark, MinusCircle, ArrowUpDown, RefreshCw, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { useScreenAccess } from "@/hooks/useScreenAccess";
import { fmtMoney } from "@/pages/financeiro/nf-emissao/shared";
import {
  diferenca, DivergenciaMalote, EntradasSaidas, fmtPercentual, LABEL_MOTIVO_DIVERGENCIA, LABEL_MOTIVO_SEM_CENTRO, LABEL_ORIGEM_FINANCEIRO, LABEL_ORIGEM_LANCAMENTO,
  LancamentoSemCentro, LinkCard, linkReclassificarFluxo, PainelCentrosFluxo, PainelFluxoExtrato, PontePainelFluxo, PainelMaloteFluxo, PainelOrcadoRealizado, relatorioDivergencias, relatorioSemCentro, SituacaoComparacao, TotaisCard,
} from "./regras";
import { AjusteRegistrado, useAjustesDasDespesas } from "./useAuditoriaDados";

// SIS-2026-0657: corpos dos cards 1, 2 e 4 do painel de auditoria, no formato dos mockups da
// Controladoria. Só desenham; os números já vêm calculados (regras.ts / useTotaisAuditoria.ts).

const pctTxt = (p: number | null) => (p === null ? "—" : `${(p * 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`);

const TOM = {
  saida: { circulo: "bg-red-100 text-red-600 dark:bg-red-950/40 dark:text-red-400", valor: "text-red-600 dark:text-red-400" },
  entrada: { circulo: "bg-emerald-100 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400", valor: "text-emerald-700 dark:text-emerald-400" },
  neutro: { circulo: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300", valor: "text-foreground" },
} as const;

function Metrica({ tom, rotulo, valor, grande = true, icone }: { tom: keyof typeof TOM; rotulo: string; valor: number; grande?: boolean; icone?: ReactNode }) {
  const Icone = tom === "entrada" ? ArrowUp : tom === "saida" ? ArrowDown : ArrowUpDown;
  return (
    <div className="flex items-center gap-2.5">
      <span className={cn("flex shrink-0 items-center justify-center rounded-full", grande ? "h-9 w-9" : "h-7 w-7", TOM[tom].circulo)}>
        {icone ?? <Icone className={grande ? "h-4 w-4" : "h-3.5 w-3.5"} />}
      </span>
      <div className="min-w-0">
        <p className="text-[11px] text-muted-foreground leading-tight">{rotulo}</p>
        <p className={cn("font-bold leading-tight", grande ? "text-lg" : "text-sm", TOM[tom].valor)}>{fmtMoney(valor)}</p>
      </div>
    </div>
  );
}

function Painel({ titulo, icone, link, children }: { titulo: string; icone: ReactNode; link?: LinkCard; children: ReactNode }) {
  return (
    <div className="rounded-lg border overflow-hidden">
      <div className="flex items-center gap-2 border-b bg-muted/40 px-3 py-2">
        <span className="text-muted-foreground">{icone}</span>
        <p className="flex-1 text-sm font-semibold">{titulo}</p>
        {link && <Link to={link.to} className="text-[11px] text-primary hover:underline whitespace-nowrap">{link.rotulo} →</Link>}
      </div>
      <div className="space-y-3 p-3">{children}</div>
    </div>
  );
}

function Resumo({ itens, situacao, semDados, onClick, dica }: { itens: { rotulo: string; valor: number }[]; situacao: SituacaoComparacao | null; semDados?: boolean; onClick?: () => void; dica?: string }) {
  const confere = situacao === "confere";
  return (
    <div
      className={cn("rounded-lg border", onClick && "cursor-pointer transition-colors hover:bg-muted/40")}
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); } } : undefined}
    >
      <div className="flex items-center gap-2 border-b bg-muted/40 px-3 py-2 text-sm font-semibold">
        <FileText className="h-4 w-4 text-muted-foreground" />Resumo da Conciliação
        {dica && <span className="ml-auto text-[11px] font-medium text-primary">{dica}</span>}
      </div>
      <div className="grid grid-cols-2 gap-3 p-3 sm:grid-cols-3">
        {itens.map((i) => <Metrica key={i.rotulo} tom={i.valor === 0 ? "neutro" : "saida"} rotulo={i.rotulo} valor={i.valor} grande={false} />)}
        <div className="flex items-center gap-2.5">
          <span className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-full", semDados ? TOM.neutro.circulo : confere ? TOM.entrada.circulo : TOM.saida.circulo)}>
            {semDados ? <MinusCircle className="h-4 w-4" /> : confere ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
          </span>
          <div>
            <p className="text-[11px] text-muted-foreground leading-tight">Status da conciliação</p>
            <p className={cn("text-sm font-bold leading-tight", semDados ? "text-muted-foreground" : confere ? "text-emerald-700 dark:text-emerald-400" : "text-red-600 dark:text-red-400")}>
              {semDados ? "Sem conciliação salva" : confere ? "Totais conferem" : "Há diferença"}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function Aviso({ tom, children }: { tom: "ok" | "erro" | "espera"; children: ReactNode }) {
  const c = {
    ok: "border-emerald-300 bg-emerald-50 text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300 dark:border-emerald-900",
    erro: "border-red-300 bg-red-50 text-red-800 dark:bg-red-950/30 dark:text-red-300 dark:border-red-900",
    espera: "border-amber-400 bg-amber-50 text-amber-800 dark:bg-amber-950/30 dark:text-amber-300 dark:border-amber-800",
  }[tom];
  return <p className={cn("rounded-md border border-dashed p-2 text-xs", c)}>{children}</p>;
}

// ── 1. Malote + Financeiro × Fluxo ──────────────────────────────────────────
function iconeDaOrigem(origem: string): ReactNode {
  if (origem === "aplicacao_financeira") return <TrendingUp className="h-3.5 w-3.5" />;
  if (origem === "cartao_fatura") return <CreditCard className="h-3.5 w-3.5" />;
  if (origem === "debito_automatico") return <RefreshCw className="h-3.5 w-3.5" />;
  return <FileText className="h-3.5 w-3.5" />;
}

export function CorpoMaloteFluxo({ p, t, situacao, linkMalote, linkFluxo }: { p: PainelMaloteFluxo; t: TotaisCard; situacao: SituacaoComparacao | null; linkMalote: LinkCard; linkFluxo: LinkCard }) {
  const dif = diferenca(t);
  const [verDivergencias, setVerDivergencias] = useState(false);
  const qtdDiv = p.divergencias.length;
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {/* SIS-2026-0687: o Malote e cada origem que alimenta o Fluxo, somando o total das origens. */}
        <Painel titulo="Lançamentos do Financeiro" icone={<FileText className="h-4 w-4" />} link={linkMalote}>
          {/* Cada origem é um atalho: o Malote abre o Pagamento Malote; as demais abrem o Fluxo de Caixa já nessa origem, no mesmo período e empresa. */}
          <Link to={linkMalote.to} title="Abrir o Malote" className="flex items-center justify-between gap-3 rounded-lg border border-sky-300 bg-sky-50 p-3 transition-colors hover:bg-sky-100 dark:border-sky-900 dark:bg-sky-950/30 dark:hover:bg-sky-950/60">
            <span className="flex items-center gap-2.5">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-sky-100 text-sky-700 dark:bg-sky-900/50 dark:text-sky-300"><Briefcase className="h-4 w-4" /></span>
              <span><span className="block text-sm font-bold leading-tight">Malote</span><span className="block text-[11px] text-muted-foreground leading-tight">Saídas</span></span>
            </span>
            <span className="text-base font-bold">{fmtMoney(p.malote)}</span>
          </Link>
          {p.financeiroPorOrigem.map((o) => (
            <Link
              key={o.origem}
              to={`${linkFluxo.to}${linkFluxo.to.includes("?") ? "&" : "?"}origem=${encodeURIComponent(o.origem)}`}
              title={`Ver no Fluxo de Caixa: ${LABEL_ORIGEM_FINANCEIRO[o.origem] ?? o.origem}`}
              className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2 transition-colors hover:bg-muted/50"
            >
              <span className="flex items-center gap-2.5">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">{iconeDaOrigem(o.origem)}</span>
                <span><span className="block text-xs font-semibold leading-tight">{LABEL_ORIGEM_FINANCEIRO[o.origem] ?? o.origem}</span><span className="block text-[11px] text-muted-foreground leading-tight">Saídas</span></span>
              </span>
              <span className="text-sm font-semibold">{fmtMoney(o.valor)}</span>
            </Link>
          ))}
          <div className="flex items-center justify-between rounded-md bg-muted/50 px-3 py-2 text-sm font-semibold">
            <span>Total das origens:</span><span>{fmtMoney(t.a)}</span>
          </div>
        </Painel>
        <Painel titulo="Fluxo de Caixa" icone={<ArrowUpDown className="h-4 w-4" />} link={linkFluxo}>
          <Metrica tom="saida" rotulo="Saídas" valor={p.fluxoSaidas} />
          {p.aplicacoes > 0 && (
            <p className="text-[11px] text-muted-foreground">
              Inclui aplicações financeiras (giro de caixa): saídas de {fmtMoney(p.aplicacoes)}.
            </p>
          )}
        </Painel>
      </div>
      <Resumo
        itens={[{ rotulo: "Diferença de saídas", valor: dif.valor }]}
        situacao={situacao}
        onClick={qtdDiv > 0 ? () => setVerDivergencias(true) : undefined}
        dica={qtdDiv > 0 ? `Ver ${qtdDiv} despesa${qtdDiv === 1 ? "" : "s"} divergente${qtdDiv === 1 ? "" : "s"} →` : undefined}
      />
      <Aviso tom={situacao === "confere" ? "ok" : "erro"}>
        {["Malote", ...p.financeiroPorOrigem.filter((o) => o.valor !== 0).map((o) => LABEL_ORIGEM_FINANCEIRO[o.origem] ?? o.origem)].join(" + ")} totalizam <strong>{fmtMoney(t.a)}</strong>{" "}
        {situacao === "confere"
          ? `e conferem com as saídas do Fluxo de Caixa. Diferença: ${fmtMoney(dif.valor)}.`
          : `e não conferem com as saídas do Fluxo de Caixa. Diferença: ${fmtMoney(dif.valor)} (${pctTxt(dif.percentual)}). Costuma ser ajuste de valor feito só no Fluxo.`}
      </Aviso>
      {qtdDiv > 0 && (
        <Dialog open={verDivergencias} onOpenChange={setVerDivergencias}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Despesas divergentes — Malote × Fluxo de Caixa</DialogTitle>
              <DialogDescription>Despesas cujo valor no Malote não é o mesmo do Fluxo de Caixa neste período, com o motivo e quem ajustou, quando há registro.</DialogDescription>
            </DialogHeader>
            <RelatorioDivergencias divergencias={p.divergencias} />
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

const fmtDataHora = (iso: string) => new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

// Frase curta de "quem ajustou" para a despesa (o ajuste mais recente que mexeu no valor).
function quemAjustou(lista: AjusteRegistrado[] | undefined): string | null {
  if (!lista || lista.length === 0) return null;
  const a = lista.find((x) => x.acao !== "revertido") ?? lista[0];
  const valores = a.valorAntes !== null && a.valorDepois !== null && a.acao === "alterado" ? ` (${fmtMoney(a.valorAntes)} → ${fmtMoney(a.valorDepois)})` : "";
  if (a.acao === "anterior_ao_registro" || !a.usuario) return "autor não registrado (ajuste anterior ao registro de autoria)";
  return `ajustado por ${a.usuario} em ${fmtDataHora(a.em)}${valores}`;
}

// SIS-2026-0657: relatório das despesas que não batem entre Malote e Fluxo — quais, quanto e por quê.
function RelatorioDivergencias({ divergencias }: { divergencias: DivergenciaMalote[] }) {
  const ids = useMemo(() => divergencias.filter((d) => d.motivo !== "so_no_malote").map((d) => d.despesaId), [divergencias]);
  const { data: ajustes } = useAjustesDasDespesas(ids);
  const autores = useMemo(() => {
    const m = new Map<string, string>();
    for (const d of divergencias) {
      const q = quemAjustou(ajustes?.get(d.despesaId));
      if (q) m.set(d.despesaId, q);
    }
    return m;
  }, [divergencias, ajustes]);
  const totalDif = divergencias.reduce((s, d) => s + d.diferenca, 0);

  async function copiar() {
    try {
      await navigator.clipboard.writeText(relatorioDivergencias(divergencias, autores));
      toast.success("Relatório copiado.");
    } catch {
      toast.error("Não foi possível copiar.");
    }
  }

  return (
    <div className="overflow-hidden rounded-lg border">
      <div className="flex items-center gap-2 border-b bg-muted/40 px-3 py-2">
        <AlertTriangle className="h-4 w-4 text-amber-600" />
        <p className="flex-1 text-sm font-semibold">Despesas divergentes ({divergencias.length})</p>
        <Button type="button" variant="ghost" size="sm" className="h-7 gap-1 text-[11px]" onClick={copiar}><ClipboardCopy className="h-3.5 w-3.5" />Copiar relatório</Button>
      </div>
      <ul className="max-h-[55vh] divide-y overflow-y-auto text-xs">
        {divergencias.map((d) => (
          <li key={d.despesaId} className="space-y-0.5 px-3 py-2">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
              <Link to={`/app/malote/despesa/${d.despesaId}`} className="font-mono text-primary hover:underline">{d.numero ?? d.despesaId.slice(0, 8)}</Link>
              <span className="text-muted-foreground">Malote {fmtMoney(d.malote)} · Fluxo {fmtMoney(d.fluxo)}</span>
              <span className={cn("font-semibold", d.diferenca > 0 ? "text-red-600 dark:text-red-400" : "text-emerald-700 dark:text-emerald-400")}>Dif. {fmtMoney(d.diferenca)}</span>
            </div>
            <p className="text-muted-foreground">{LABEL_MOTIVO_DIVERGENCIA[d.motivo]}{autores.get(d.despesaId) ? ` — ${autores.get(d.despesaId)}` : ""}</p>
          </li>
        ))}
      </ul>
      <p className="border-t bg-muted/30 px-3 py-1.5 text-[11px] text-muted-foreground">Soma das diferenças: <span className="font-medium text-foreground">{fmtMoney(totalDif)}</span> (Malote − Fluxo).</p>
    </div>
  );
}

// ── 2. Fluxo × Extrato (entradas e saídas separadas) ────────────────────────
function ColunaEntradasSaidas({ v }: { v: EntradasSaidas }) {
  return (
    <>
      <Metrica tom="entrada" rotulo="Entradas" valor={v.entradas} grande={false} />
      <Metrica tom="saida" rotulo="Saídas" valor={v.saidas} grande={false} />
      <div className="space-y-2 rounded-md bg-muted/40 p-2.5">
        <Metrica tom="neutro" rotulo="Total movimentado" valor={v.movimentado} grande={false} icone={<BarChart3 className="h-3.5 w-3.5" />} />
        <div className="pl-9">
          <p className="text-[11px] text-muted-foreground leading-tight">Saldo gerado</p>
          <p className={cn("text-sm font-bold leading-tight", v.saldo < 0 ? "text-red-600 dark:text-red-400" : "text-emerald-700 dark:text-emerald-400")}>{fmtMoney(v.saldo)}</p>
        </div>
      </div>
    </>
  );
}

export function CorpoFluxoExtrato({ p, situacao, semDados, links }: { p: PainelFluxoExtrato; situacao: SituacaoComparacao | null; semDados: boolean; links: { malote: LinkCard; fluxo: LinkCard; banco: LinkCard } }) {
  const pct = p.cobertura === null ? null : fmtPercentual(p.cobertura);
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {/* SIS-2026-0701: o valor do Fluxo é o mesmo do item 1 e da tela do Fluxo de Caixa (todos os bancos); embaixo, a parte que vai contra o extrato. */}
        <Painel titulo="Fluxo de Caixa" icone={<ArrowUpDown className="h-4 w-4" />} link={links.fluxo}>
          <ColunaEntradasSaidas v={p.ponte?.total ?? p.fluxo} />
          {p.ponte && (
            <p className="mt-2 text-[11px] text-muted-foreground">
              Dos bancos conciliados (contra o extrato): entradas {fmtMoney(p.fluxo.entradas)} · saídas {fmtMoney(p.fluxo.saidas)}
            </p>
          )}
        </Painel>
        <Painel titulo="Extrato Bancário" icone={<Landmark className="h-4 w-4" />} link={links.banco}><ColunaEntradasSaidas v={p.extrato} /></Painel>
      </div>
      <Resumo itens={[{ rotulo: p.ponte ? "Diferença de entradas (bancos conciliados)" : "Diferença de entradas", valor: p.difEntradas }, { rotulo: p.ponte ? "Diferença de saídas (bancos conciliados)" : "Diferença de saídas", valor: p.difSaidas }]} situacao={situacao} semDados={semDados} />
      {semDados ? (
        <Aviso tom="espera">Aguardando dados do extrato. Nenhuma conciliação bancária foi salva para este mês. A validação será habilitada quando houver conciliação salva.</Aviso>
      ) : (
        <Aviso tom={situacao === "confere" ? "ok" : "erro"}>
          {situacao === "confere"
            ? "Entradas e saídas do Fluxo de Caixa conferem com o extrato nos bancos conciliados."
            : "Há diferença entre o Fluxo e o extrato nos bancos conciliados. Confira lançamentos do Fluxo fora do extrato ou o contrário na Conciliação Bancária."}
        </Aviso>
      )}
      {!semDados && (
        <div className="space-y-1 rounded-md bg-muted/40 p-2.5 text-[11px] text-muted-foreground">
          <p>
            <span className="font-semibold text-foreground">Cobertura:</span> {p.conciliacoes} conta(s)/empresa(s) conciliada(s){p.bancos.length > 0 ? ` (${p.bancos.join(", ")})` : ""}
            {pct !== null ? ` — ${pct} das saídas do Fluxo do mês` : ""}.
          </p>
          <p>Fluxo do mês inteiro (todos os bancos): entradas {fmtMoney(p.fluxoMes.entradas)} · saídas {fmtMoney(p.fluxoMes.saidas)}. Bancos sem conciliação salva ficam fora da comparação.</p>
          {p.semTotais > 0 && <p className="text-amber-700 dark:text-amber-400">{p.semTotais} conciliação(ões) sem o total do extrato registrado — aplique a migration 20261014000006.</p>}
        </div>
      )}
      {!semDados && p.ponte && <PonteFluxo ponte={p.ponte} recorte={p.fluxo} linkFluxo={links.fluxo} />}
      <p className="text-[11px] text-muted-foreground">
        Origem dos valores:{" "}
        <Link to={links.malote.to} className="text-primary hover:underline">{links.malote.rotulo}</Link>
        {" · "}
        <Link to={links.fluxo.to} className="text-primary hover:underline">{links.fluxo.rotulo}</Link>
        {" · "}
        <Link to={links.banco.to} className="text-primary hover:underline">{links.banco.rotulo}</Link>
      </p>
    </div>
  );
}


// SIS-2026-0701: do total que a tela do Fluxo de Caixa mostra até o recorte que se compara com o extrato, parte a parte.
function PonteFluxo({ ponte, recorte, linkFluxo }: { ponte: PontePainelFluxo; recorte: EntradasSaidas; linkFluxo: LinkCard }) {
  const linhas: { rotulo: string; v: EntradasSaidas; sinal: -1 | 1; dica?: string }[] = [
    { rotulo: "Fluxo de Caixa (igual à tela do Fluxo)", v: ponte.total, sinal: 1 },
    { rotulo: "Saldo anterior (abertura do mês)", v: ponte.saldoAnterior, sinal: -1, dica: "Passagem de saldo: o extrato não traz isto como movimento." },
    { rotulo: "Bancos sem conciliação salva", v: ponte.semConciliacao, sinal: -1, dica: "Contas cujo extrato ainda não foi conciliado no mês." },
    { rotulo: "Ignorados na conciliação", v: ponte.ignorados, sinal: -1, dica: "Conta vinculada e resgates de conta vinculada (BB e Caixa): não aparecem no extrato." },
  ];
  return (
    <div className="rounded-md border p-2.5 text-[11px]">
      <p className="mb-1.5 font-semibold text-foreground">De onde vem o valor comparado (ponte com o Fluxo de Caixa)</p>
      <table className="w-full">
        <thead>
          <tr className="text-left text-muted-foreground">
            <th className="pb-1 font-normal">Parte</th>
            <th className="pb-1 text-right font-normal">Entradas</th>
            <th className="pb-1 text-right font-normal">Saídas</th>
          </tr>
        </thead>
        <tbody>
          {linhas.map((l) => (
            <tr key={l.rotulo} className="border-t" title={l.dica}>
              <td className="py-1">{l.sinal === -1 ? "(−) " : ""}{l.rotulo}</td>
              <td className="py-1 text-right tabular-nums">{fmtMoney(l.v.entradas)}</td>
              <td className="py-1 text-right tabular-nums">{fmtMoney(l.v.saidas)}</td>
            </tr>
          ))}
          <tr className="border-t font-semibold">
            <td className="py-1">(=) Fluxo dos bancos conciliados (o que vai contra o extrato)</td>
            <td className="py-1 text-right tabular-nums">{fmtMoney(recorte.entradas)}</td>
            <td className="py-1 text-right tabular-nums">{fmtMoney(recorte.saidas)}</td>
          </tr>
        </tbody>
      </table>
      <p className="mt-1.5 text-muted-foreground">Confira o total na tela do <Link to={linkFluxo.to} className="text-primary hover:underline">Fluxo de Caixa</Link> com o mesmo período.</p>
    </div>
  );
}

// ── 3. Lançamentos sem centro de custo ──────────────────────────────────────
// SIS-2026-0657: o card 3 só mostrava o valor "sem centro"; aqui a Controladoria vê QUAIS lançamentos são.
export function CorpoSemCentro({ pendentes, linkFluxo }: { pendentes: LancamentoSemCentro[]; linkFluxo: string }) {
  const [aberto, setAberto] = useState(false);
  if (pendentes.length === 0) return null;
  const total = pendentes.reduce((s, l) => s + l.valor, 0);
  const dia = (iso: string | null) => (iso ? iso.split("-").reverse().join("/") : "—");
  const destino = (l: LancamentoSemCentro) =>
    l.origem === "malote" && l.despesaId ? `/app/malote/despesa/${l.despesaId}` : `${linkFluxo}${l.numero ? `&busca=${encodeURIComponent(l.numero)}` : ""}`;

  async function copiar() {
    try {
      await navigator.clipboard.writeText(relatorioSemCentro(pendentes));
      toast.success("Relatório copiado.");
    } catch {
      toast.error("Não foi possível copiar.");
    }
  }

  return (
    <>
      <Button type="button" variant="outline" size="sm" className="w-full justify-between" onClick={() => setAberto(true)}>
        <span>Ver {pendentes.length} lançamento{pendentes.length === 1 ? "" : "s"} sem centro</span>
        <span className="font-semibold">{fmtMoney(total)} →</span>
      </Button>
      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Lançamentos sem centro de custo</DialogTitle>
            <DialogDescription>Gasto sem contrato nem classificação administrativa: não dá para atribuir a um centro. Clique no ID para abrir o lançamento de origem.</DialogDescription>
          </DialogHeader>
          <div className="flex justify-end">
            <Button type="button" variant="ghost" size="sm" className="h-7 gap-1 text-[11px]" onClick={copiar}><ClipboardCopy className="h-3.5 w-3.5" />Copiar relatório</Button>
          </div>
          <ul className="max-h-[55vh] divide-y overflow-y-auto rounded-lg border text-xs">
            {pendentes.map((l, i) => (
              <li key={`${l.origem}-${l.despesaId ?? i}-${i}`} className="space-y-0.5 px-3 py-2">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                  <Link to={destino(l)} className="font-mono text-primary hover:underline">{l.numero ?? "sem ID"}</Link>
                  <span className="text-muted-foreground">{LABEL_ORIGEM_LANCAMENTO[l.origem] ?? l.origem} · {dia(l.data)}</span>
                  <span className="font-semibold">{fmtMoney(l.valor)}</span>
                </div>
                <p className="truncate" title={l.descricao}>{l.descricao || "sem descrição"}</p>
                <p className="text-muted-foreground">{LABEL_MOTIVO_SEM_CENTRO[l.motivo]}{l.classificacao ? ` · ${l.classificacao}` : ""}</p>
              </li>
            ))}
          </ul>
          <p className="text-[11px] text-muted-foreground">Total: <span className="font-medium text-foreground">{fmtMoney(total)}</span> em {pendentes.length} lançamento(s).</p>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ── 3 (SIS-2026-0720). Centros de custo × saída total do Fluxo de Caixa ───────────────────────────────────
// Saída total → (−) aplicação → (−) transferência entre contas = saldo utilizável, que precisa estar nos centros de custo. O que não está
// em nenhum é o "falta distribuir": a seta abre os lançamentos e cada um leva ao Fluxo já na edição para reclassificar.
function LinhaValor({ rotulo, valor, forte, tom, dica }: { rotulo: string; valor: number; forte?: boolean; tom?: "neutro" | "alerta"; dica?: string }) {
  return (
    <div className={cn("flex items-center justify-between gap-2 px-3 py-1.5 text-sm", forte && "bg-muted/50 font-semibold", tom === "alerta" && "text-red-600 dark:text-red-400")} title={dica}>
      <span>{rotulo}</span>
      <span className="tabular-nums">{fmtMoney(valor)}</span>
    </div>
  );
}

export function CorpoCentrosFluxo({ p, mes, empresaId }: { p: PainelCentrosFluxo; mes: string; empresaId: string | null }) {
  const [aberto, setAberto] = useState(false);
  // Só Controladoria e Financeiro reclassificam: é a permissão "Alterar" do Fluxo de Caixa.
  const { data: podeReclassificar = false } = useScreenAccess("financeiro-fluxo-caixa-gestao", "alterar");
  const dia = (iso: string | null) => (iso ? iso.split("-").reverse().join("/") : "—");
  const temFalta = p.lancamentos.length > 0;
  const fechou = Math.abs(p.faltaDistribuir) < 1;

  async function copiar() {
    try {
      await navigator.clipboard.writeText(relatorioSemCentro(p.lancamentos));
      toast.success("Relatório copiado.");
    } catch {
      toast.error("Não foi possível copiar.");
    }
  }

  return (
    <div className="space-y-3">
      <div className="text-center">
        <p className="text-2xl font-bold">{fmtMoney(p.saidaTotal)}</p>
        <p className="text-[11px] text-muted-foreground">Total de saídas do Fluxo de Caixa</p>
      </div>
      <div className="divide-y rounded-lg border overflow-hidden">
        <LinhaValor rotulo="Saída total do Fluxo de Caixa" valor={p.saidaTotal} />
        <LinhaValor rotulo="Aplicação (não utiliza)" valor={p.aplicacoes} dica="Aplicação financeira é giro de caixa, não despesa." />
        <LinhaValor rotulo="Transferências entre contas (não utiliza)" valor={p.transferencias} dica="Classificação TRANSFERÊNCIA ENTRE CONTAS: dinheiro que muda de conta, não despesa." />
        <LinhaValor rotulo="Saldo utilizável" valor={p.saldoUtilizavel} forte />
      </div>
      <div className="rounded-lg border overflow-hidden">
        <p className="border-b bg-muted/40 px-3 py-1.5 text-xs font-semibold">Centros de custo</p>
        <div className="divide-y">
          <LinhaValor rotulo="Contratos" valor={p.contratos} dica="Mesmo valor do Total de custos da Lucratividade de Contratos (no mesmo período e base)." />
          {p.contratosForaLucratividade !== 0 && (
            <LinhaValor
              rotulo="Contratos fora da Lucratividade"
              valor={p.contratosForaLucratividade}
              dica="Saídas de contrato que a Lucratividade não conta como custo: contratos de investimento, obra administrativa, estoque ou movimentação financeira; classificações que não são custo (transferência, financiamento, distribuição…); e lançamentos sem classificação."
            />
          )}
          <LinhaValor rotulo="Administrativo" valor={p.administrativo} />
          <LinhaValor rotulo="Sócios" valor={p.socios} />
          <div className={cn("flex items-center justify-between gap-2 px-3 py-1.5 text-sm font-semibold", fechou ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300" : "bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-300")}>
            <span>Falta distribuir</span>
            <span className="flex items-center gap-2">
              <span className="tabular-nums">{fmtMoney(p.faltaDistribuir)}</span>
              {temFalta && (
                <Button type="button" variant="outline" size="icon" className="h-6 w-6" title={`Ver os ${p.lancamentos.length} lançamentos que compõem o valor`} onClick={() => setAberto(true)}>
                  <ArrowRight className="h-3.5 w-3.5" />
                </Button>
              )}
            </span>
          </div>
        </div>
      </div>
      <p className="text-[11px] text-muted-foreground">
        Base de leitura: saídas do Fluxo de Caixa menos aplicações e transferências entre contas; comparação com os valores distribuídos nos centros de custo.
        {temFalta ? ` Clique na seta para ver os ${p.lancamentos.length} lançamentos que compõem o "falta distribuir".` : ""}
      </p>

      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>Falta distribuir — {fmtMoney(p.faltaDistribuir)}</DialogTitle>
            <DialogDescription>
              Saídas sem contrato e sem classificação administrativa: não estão em nenhum centro de custo. Reclassifique pelo ID: o Fluxo de Caixa abre direto na edição do lançamento.
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] text-muted-foreground">
              {podeReclassificar
                ? "Você pode reclassificar no Fluxo de Caixa (permissão Alterar)."
                : "Só a Controladoria e o Financeiro reclassificam (permissão Alterar no Fluxo de Caixa). Aqui você consulta e identifica o gerente responsável."}
            </p>
            <Button type="button" variant="ghost" size="sm" className="h-7 gap-1 text-[11px]" onClick={copiar}><ClipboardCopy className="h-3.5 w-3.5" />Copiar relatório</Button>
          </div>
          <ul className="max-h-[55vh] divide-y overflow-y-auto rounded-lg border text-xs">
            {p.lancamentos.map((l, i) => (
              <li key={`${l.origem}-${l.despesaId ?? i}-${l.numeroParcela ?? ""}-${i}`} className="space-y-0.5 px-3 py-2">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                  <span className="font-mono">{l.numero ?? "sem ID"}</span>
                  <span className="text-muted-foreground">{LABEL_ORIGEM_LANCAMENTO[l.origem] ?? l.origem} · {dia(l.data)}</span>
                  <span className="font-semibold">{fmtMoney(l.valor)}</span>
                </div>
                <p className="truncate" title={l.descricao}>{l.descricao || "sem descrição"}</p>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-muted-foreground">
                    {LABEL_MOTIVO_SEM_CENTRO[l.motivo]}{l.classificacao ? ` · ${l.classificacao}` : ""}
                    {" · "}Gerente responsável: <span className="text-foreground">{l.responsaveis.length ? l.responsaveis.join(", ") : "não definido (sem classificação)"}</span>
                  </p>
                  {podeReclassificar && l.despesaId && (
                    <Button asChild size="sm" variant="outline" className="h-7 gap-1 text-[11px]">
                      <Link to={linkReclassificarFluxo(mes, empresaId, l)}><Pencil className="h-3 w-3" />Reclassificar no Fluxo</Link>
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
          <p className="text-[11px] text-muted-foreground">
            Total: <span className="font-medium text-foreground">{fmtMoney(p.lancamentos.reduce((s, l) => s + l.valor, 0))}</span> em {p.lancamentos.length} lançamento(s).
            O envio da solicitação de alteração ao gerente responsável entra com o módulo de ajuste de lançamento (SIS-2026-0560).
          </p>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── 4. Orçado × Realizado ───────────────────────────────────────────────────
export function CorpoOrcadoRealizado({ p, t }: { p: PainelOrcadoRealizado; t: TotaisCard }) {
  const dif = diferenca({ a: t.a, b: t.b });
  const usoPct = t.a > 0 ? (t.b / t.a) * 100 : t.b > 0 ? 100 : 0;
  const estourou = t.b > t.a;
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 text-center">
        <div><p className="text-xl font-bold">{fmtMoney(t.a)}</p><p className="text-[11px] text-muted-foreground">Total Orçado</p></div>
        <div>
          <p className="text-xl font-bold">{fmtMoney(t.b)}</p>
          <p className="text-[11px] text-muted-foreground">Total Realizado</p>
          <p className="text-[11px] text-primary">Utilizado nas classificações com orçado</p>
        </div>
      </div>
      <div className="h-3 w-full overflow-hidden rounded bg-muted" title={`${Math.round(usoPct)}% do orçado`}>
        <div className={cn("h-full", estourou ? "bg-red-500" : "bg-emerald-500")} style={{ width: `${Math.min(100, usoPct)}%` }} />
      </div>
      <p className="text-center text-xs">
        Diferença: <span className={cn("font-bold", dif.valor > 0 ? "text-red-600 dark:text-red-400" : "text-emerald-700 dark:text-emerald-400")}>{fmtMoney(dif.valor)} ({pctTxt(dif.percentual)})</span>
      </p>
      <div className="rounded-lg border overflow-hidden">
        <p className="border-b bg-muted/40 px-3 py-2 text-xs font-semibold">Centros de custo que mais consumiram acima do orçado</p>
        {p.principais.length === 0 ? (
          <p className="px-3 py-3 text-xs text-muted-foreground">Nenhum centro de custo acima do orçado neste período.</p>
        ) : (
          <ul className="divide-y text-xs">
            {p.principais.map((c) => (
              <li key={c.nome} className="flex justify-between gap-2 px-3 py-1.5"><span className="truncate" title={c.nome}>{c.nome}</span><span className="font-medium">{fmtMoney(c.excesso)}</span></li>
            ))}
            {p.outrosQtd > 0 && (
              <li className="flex justify-between gap-2 px-3 py-1.5 text-muted-foreground"><span>Outros {p.outrosQtd} centro(s)</span><span className="font-medium">{fmtMoney(p.outros)}</span></li>
            )}
            <li className="flex justify-between gap-2 bg-muted/40 px-3 py-1.5 font-semibold"><span>Total acima do orçado:</span><span>{fmtMoney(p.totalAcima)}</span></li>
          </ul>
        )}
      </div>
    </div>
  );
}
