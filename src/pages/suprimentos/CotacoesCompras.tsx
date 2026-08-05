import { useMemo, useRef, useState } from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  ChevronDown, ChevronRight, Clock, Eye, CheckCircle2, Paperclip, Send, Inbox, ShieldAlert,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { usePermissoes } from "@/context/PermissoesContext";
import {
  useCotacoesLicitacao,
  useCotacaoMarcarVisualizada,
  useCotacaoResponder,
  type CotacaoLicitacao,
} from "@/hooks/useCotacoesLicitacao";
import {
  MESES, STATUS_CONFIG, StatusBadge, LinkArquivo, fmtDatetime, iniciais,
  agruparPorAnoMes, aberturaInicial, recusaArquivo, EXTENSOES_ACEITAS,
} from "@/components/cotacoes/comum";

/**
 * Cotações — lado de Compras (Subsistema 5, REPLICAR-MODULO-COMPRAS.md §7).
 *
 * Espelho de /app/licitacoes/cotacoes: mesma linha no banco, mesmo acordeão
 * ano → mês, vista pelo outro lado do balcão. O que muda é o papel — aqui não
 * se abre, não se edita e não se exclui solicitação. Compras lê e responde.
 *
 * As duas ações passam por RPC (`sup_cot_*`) para que o nome de quem leu e de
 * quem respondeu venha de `profiles`, e não do payload do cliente.
 */
export default function CotacoesCompras() {
  const { can } = usePermissoes();
  const { data: cotacoes = [], isLoading, error } = useCotacoesLicitacao();

  const podeResponder = can("alterar", "suprimentos", "sup_cotacoes");

  const inicial = useMemo(aberturaInicial, []);
  const [anosAbertos, setAnosAbertos] = useState<Set<number>>(inicial.anos);
  const [mesesAbertos, setMesesAbertos] = useState<Set<string>>(inicial.meses);

  const grupos = useMemo(() => agruparPorAnoMes(cotacoes), [cotacoes]);

  // §7.3: o contador de Compras é o inverso do da Licitação — o que ainda não
  // foi lido por nós, não o que ainda não foi respondido.
  const naoLidas = cotacoes.filter((c) => c.status === "pendente").length;

  const alternar = <T,>(set: Set<T>, chave: T) => {
    const novo = new Set(set);
    novo.has(chave) ? novo.delete(chave) : novo.add(chave);
    return novo;
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Cotações"
        breadcrumb={["Suprimentos", "Cotações"]}
        subtitle="Solicitações que o setor de Licitação enviou para Compras."
        actions={
          naoLidas > 0 ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-red-400/40 bg-red-500/15 px-3 py-1 text-xs font-semibold text-red-600">
              <Clock className="h-3.5 w-3.5" />
              {naoLidas} aguardando leitura
            </span>
          ) : null
        }
      />

      {error ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 py-12 text-center">
          <ShieldAlert className="h-10 w-10 text-destructive" />
          <p className="font-medium">Não foi possível carregar as cotações.</p>
          <p className="max-w-md text-sm text-muted-foreground">{(error as Error).message}</p>
        </div>
      ) : isLoading ? (
        <p className="py-16 text-center text-sm text-muted-foreground">Carregando…</p>
      ) : cotacoes.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-16 text-center">
          <Inbox className="h-12 w-12 text-muted-foreground/50" />
          <p className="font-medium">Nenhuma cotação recebida.</p>
          <p className="text-sm text-muted-foreground">
            Quando Licitação enviar uma solicitação, ela aparece aqui.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {grupos.map(({ year, total, months }) => (
            <div key={year} className="overflow-hidden rounded-lg border border-border">
              <button
                onClick={() => setAnosAbertos((s) => alternar(s, year))}
                className="flex w-full items-center justify-between bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground"
              >
                <span className="flex items-center gap-2">
                  {anosAbertos.has(year) ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                  {year}
                </span>
                <span className="rounded-full bg-white/20 px-2.5 py-0.5 text-xs font-bold">{total} cotações</span>
              </button>

              {anosAbertos.has(year) && (
                <div className="space-y-2 bg-card p-3">
                  {months.map(({ month, items }) => {
                    const chave = `${year}-${month}`;
                    const aberto = mesesAbertos.has(chave);
                    const pendentes = items.filter((c) => c.status !== "respondido").length;
                    return (
                      <div key={chave} className="overflow-hidden rounded-md border border-border">
                        <button
                          onClick={() => setMesesAbertos((s) => alternar(s, chave))}
                          className="flex w-full items-center justify-between bg-muted/50 px-4 py-2.5 text-sm font-medium hover:bg-muted"
                        >
                          <span className="flex items-center gap-2">
                            {aberto ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                            {MESES[month]}
                          </span>
                          <span className={cn(
                            "rounded-full px-2.5 py-0.5 text-[11px] font-semibold",
                            pendentes > 0
                              ? "border border-red-400/40 bg-red-500/15 text-red-600"
                              : "border border-emerald-400/40 bg-emerald-500/15 text-emerald-600",
                          )}>
                            {pendentes > 0
                              ? `${pendentes} a responder`
                              : `${items.length} respondida${items.length > 1 ? "s" : ""}`}
                          </span>
                        </button>

                        {aberto && (
                          <div className="space-y-2 p-3">
                            {items.map((c) => (
                              <CardCotacao key={c.id} cotacao={c} podeResponder={podeResponder} />
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function CardCotacao({ cotacao: c, podeResponder }: { cotacao: CotacaoLicitacao; podeResponder: boolean }) {
  const marcarVisualizada = useCotacaoMarcarVisualizada();
  const [aberto, setAberto] = useState(false);
  const cfg = STATUS_CONFIG[c.status];

  function alternar() {
    // §7.4 — "ler é o ato de marcar como lido". O usuário não precisa fazer
    // nada além de abrir o card; é este gesto que produz o "Visualizado por
    // Compras em…" na tela da Licitação.
    if (!aberto && c.status === "pendente") marcarVisualizada.mutate(c.id);
    setAberto((v) => !v);
  }

  return (
    <div className={cn(
      "overflow-hidden rounded-lg border border-l-4 bg-card transition-shadow",
      cfg.border, cfg.accent, aberto && "shadow-md",
    )}>
      <button
        onClick={alternar}
        className={cn("flex w-full items-center justify-between gap-3 px-4 py-3 text-left", cfg.headerBg)}
      >
        <div className="flex min-w-0 items-center gap-3">
          <div className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold", cfg.bg, cfg.text)}>
            {iniciais(c.remetente_nome)}
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className={cn("truncate text-sm font-semibold", cfg.headerText)}>{c.remetente_nome}</p>
              <span className="text-xs font-medium text-muted-foreground">{c.tipo}</span>
              {c.status === "pendente" && (
                <span className="rounded-full bg-primary px-2 py-0.5 text-[10px] font-bold text-white">Não lida</span>
              )}
            </div>
            <p className="text-xs text-muted-foreground">{fmtDatetime(c.created_at)}</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <StatusBadge status={c.status} />
          {aberto ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
        </div>
      </button>

      {aberto && (
        <div className="space-y-0 border-t border-border/50 px-4 pb-4 pt-3">
          <div className="relative pl-5">
            <div className="absolute bottom-2 left-1.5 top-2 w-px bg-border" />

            {/* O pedido da Licitação */}
            <div className="relative mb-4">
              <div className="absolute -left-[13px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-background bg-muted-foreground/50" />
              <div className="space-y-2">
                <p className="whitespace-pre-wrap text-sm leading-relaxed">{c.comentario}</p>
                <LinkArquivo caminho={c.arquivo_url} nome={c.arquivo_nome} />
                {c.editado_em && (
                  <p className="text-xs italic text-muted-foreground">
                    Editado por {c.editado_por_nome} em {fmtDatetime(c.editado_em)} — releia antes de responder.
                  </p>
                )}
                {c.visualizado_em && (
                  <p className="flex items-center gap-1 text-xs italic text-muted-foreground">
                    <Eye className="h-3 w-3" /> Lido por {c.visualizado_por_nome} em {fmtDatetime(c.visualizado_em)}
                  </p>
                )}
              </div>
            </div>

            {/* A resposta de Compras */}
            <div className="relative">
              <div className={cn(
                "absolute -left-[13px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-background",
                c.status === "respondido" ? "bg-emerald-500" : "bg-yellow-400",
              )} />
              {c.status === "respondido" ? (
                <div className="space-y-2 rounded-md border border-emerald-400/30 bg-emerald-500/10 p-3">
                  <p className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-emerald-600">
                    <CheckCircle2 className="h-3.5 w-3.5" /> Sua resposta
                  </p>
                  <p className="whitespace-pre-wrap text-sm leading-relaxed">{c.resposta_comentario}</p>
                  <LinkArquivo caminho={c.resposta_arquivo_url} nome={c.resposta_arquivo_nome} tom="resposta" />
                  <p className="text-xs text-muted-foreground">
                    {c.respondente_nome} · {fmtDatetime(c.data_resposta)}
                  </p>
                  <p className="flex items-center gap-1 text-xs italic text-muted-foreground">
                    <Eye className="h-3 w-3" />
                    {c.resposta_visualizada_em
                      ? `Licitação leu em ${fmtDatetime(c.resposta_visualizada_em)}`
                      : "Licitação ainda não leu esta resposta."}
                  </p>
                </div>
              ) : podeResponder ? (
                <FormularioResposta cotacao={c} />
              ) : (
                <p className="text-xs italic text-muted-foreground">
                  Você pode ler esta cotação, mas não responder.
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Resposta inline, dentro do próprio card (§7.4). Comentário e arquivo são
 * obrigatórios: a Licitação precisa do documento para anexar ao processo.
 */
function FormularioResposta({ cotacao }: { cotacao: CotacaoLicitacao }) {
  const responder = useCotacaoResponder();
  const inputRef = useRef<HTMLInputElement>(null);
  const [comentario, setComentario] = useState("");
  const [arquivo, setArquivo] = useState<File | null>(null);

  function escolher(f: File | null) {
    const recusa = recusaArquivo(f);
    if (recusa) {
      toast.error("Arquivo não aceito", { description: recusa });
      if (inputRef.current) inputRef.current.value = "";
      return;
    }
    setArquivo(f);
  }

  async function enviar() {
    if (!comentario.trim() || !arquivo) return;
    try {
      await responder.mutateAsync({ id: cotacao.id, comentario, arquivo });
      toast.success("Resposta enviada para a Licitação.");
    } catch (e) {
      toast.error("Não foi possível responder", { description: (e as Error).message });
    }
  }

  const pronto = !!comentario.trim() && !!arquivo && !responder.isPending;

  return (
    <div className="space-y-3 rounded-md border border-yellow-400/30 bg-yellow-500/5 p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-yellow-700 dark:text-yellow-400">
        Responder
      </p>

      <div className="space-y-1.5">
        <Label className="text-xs">Comentário *</Label>
        <Textarea
          rows={3}
          placeholder="Ex.: segue planilha com os três orçamentos, melhor preço na coluna F."
          value={comentario}
          onChange={(e) => setComentario(e.target.value)}
        />
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs">Arquivo * (PDF, Excel, Word ou ZIP, até 10 MB)</Label>
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={inputRef}
            type="file"
            accept={EXTENSOES_ACEITAS}
            className="hidden"
            onChange={(e) => escolher(e.target.files?.[0] ?? null)}
          />
          <Button type="button" variant="outline" size="sm" className="h-8 text-xs"
                  onClick={() => inputRef.current?.click()}>
            <Paperclip className="mr-1.5 h-3.5 w-3.5" />
            {arquivo ? "Trocar arquivo" : "Escolher arquivo"}
          </Button>
          {arquivo && (
            <span className="max-w-[220px] truncate text-xs text-muted-foreground">{arquivo.name}</span>
          )}
        </div>
      </div>

      <Button size="sm" className="h-8 gap-1.5 text-xs" onClick={enviar} disabled={!pronto}>
        <Send className="h-3.5 w-3.5" />
        {responder.isPending ? "Enviando…" : "Enviar resposta"}
      </Button>
    </div>
  );
}
