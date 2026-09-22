import { useEffect, useMemo, useRef, useState } from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from "@/components/ui/command";
import {
  ChevronDown, ChevronRight, ChevronsUpDown, Clock, Eye, CheckCircle2, Send,
  Inbox, ShieldAlert, FileSignature, X,
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
  MESES, STATUS_CONFIG, StatusBadge, ListaAnexos, SeletorArquivos, SeloContrato,
  fmtDatetime, iniciais, agruparPorAnoMes, aberturaInicial,
  contratosCotados, nomeContrato, type ContratoCotado,
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

  // ── "Contratos cotados" (SIS-2026-0487) ────────────────────────────────
  //
  // O acordeão ano → mês responde "o que chegou em agosto?". Quem trabalha
  // por contrato tem a pergunta inversa — "onde caiu a cotação do CT tal?" —
  // e para respondê-la precisava abrir mês por mês. Este seletor é o índice
  // que faltava: escolher um contrato ABRE o ano e o mês onde a cotação está
  // e rola até ela. Não filtra a lista de propósito: o pedido foi localizar a
  // cotação dentro do acordeão, e esconder o resto tiraria justamente o
  // contexto de "o que mais veio no mesmo mês".
  const contratos = useMemo(() => contratosCotados(cotacoes), [cotacoes]);

  // `pulso` existe para reescolher o MESMO contrato voltar a rolar até ele —
  // sem ele o efeito não redispararia, e o segundo clique não faria nada.
  const [alvo, setAlvo] = useState<{ chave: string; nome: string; id: string; pulso: number } | null>(null);
  const pulsoRef = useRef(0);

  function localizarContrato(item: ContratoCotado) {
    // Um contrato pode ter sido cotado em vários meses: abre TODOS, para que
    // as outras ocorrências fiquem à vista depois do salto.
    setAnosAbertos((s) => {
      const novo = new Set(s);
      for (const o of item.ocorrencias) novo.add(o.year);
      return novo;
    });
    setMesesAbertos((s) => {
      const novo = new Set(s);
      for (const o of item.ocorrencias) novo.add(`${o.year}-${o.month}`);
      return novo;
    });
    // ocorrencias já vem da mais recente para a mais antiga.
    setAlvo({
      chave: item.nome.toLocaleLowerCase("pt-BR"),
      nome: item.nome,
      id: item.ocorrencias[0].id,
      pulso: ++pulsoRef.current,
    });
  }

  // O acordeão expande no mesmo commit que definiu o alvo; o card só existe
  // no DOM no frame seguinte, então o scroll espera por ele.
  useEffect(() => {
    if (!alvo) return;
    const frame = requestAnimationFrame(() => {
      document.getElementById(`cotacao-${alvo.id}`)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    return () => cancelAnimationFrame(frame);
  }, [alvo?.id, alvo?.pulso]);

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
        title="Cotações para a Licitação"
        // `module` default do PageHeader é "Licitações": sem passar, o
        // breadcrumb desta tela dizia "ERP › Licitações › Suprimentos".
        module="Suprimentos"
        breadcrumb={["Licitação", "Cotações para a Licitação"]}
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
          <BarraContratosCotados
            contratos={contratos}
            alvo={alvo}
            onLocalizar={localizarContrato}
            onLimpar={() => setAlvo(null)}
          />

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
                              <CardCotacao
                                key={c.id}
                                cotacao={c}
                                podeResponder={podeResponder}
                                destacado={
                                  !!alvo
                                  && nomeContrato(c)?.toLocaleLowerCase("pt-BR") === alvo.chave
                                }
                              />
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

/**
 * "Contratos cotados" — o índice por contrato, acima do acordeão (SIS-2026-0487).
 *
 * Lista EXATAMENTE o que a Licitação digitou no campo Contrato, sem
 * reescrever nem abreviar: o pessoal de Compras procura pelo nome que
 * combinou com a Licitação, e qualquer normalização cosmética aqui faria o
 * item procurado não aparecer com o nome esperado.
 *
 * É busca, não filtro — escolher leva até a cotação e deixa o resto do
 * acordeão como está.
 */
function BarraContratosCotados({
  contratos, alvo, onLocalizar, onLimpar,
}: {
  contratos: ContratoCotado[];
  alvo: { chave: string; nome: string } | null;
  onLocalizar: (c: ContratoCotado) => void;
  onLimpar: () => void;
}) {
  const [aberto, setAberto] = useState(false);

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2">
      <Popover open={aberto} onOpenChange={setAberto}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            size="sm"
            disabled={contratos.length === 0}
            className="h-9 gap-2 bg-background"
          >
            <FileSignature className="h-4 w-4 opacity-70" />
            Contratos cotados
            <span className="rounded-full bg-muted px-1.5 py-0.5 text-[11px] font-semibold text-muted-foreground">
              {contratos.length}
            </span>
            <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[min(28rem,calc(100vw-2rem))] p-0" align="start">
          <Command>
            <CommandInput placeholder="Digite parte do nome do contrato…" />
            <CommandList>
              <CommandEmpty>Nenhum contrato com esse nome.</CommandEmpty>
              <CommandGroup>
                {contratos.map((item) => {
                  const recente = item.ocorrencias[0];
                  return (
                    <CommandItem
                      key={item.nome.toLocaleLowerCase("pt-BR")}
                      value={item.nome}
                      // Fecha o closure no próprio item: `onSelect` devolve o
                      // value já em minúsculas (cmdk), que não serve para
                      // reencontrar o contrato com a grafia original.
                      onSelect={() => { onLocalizar(item); setAberto(false); }}
                      className="flex-col items-start gap-0.5"
                    >
                      <span className="break-words font-medium">{item.nome}</span>
                      <span className="text-xs text-muted-foreground">
                        {item.ocorrencias.length === 1
                          ? `1 cotação · ${MESES[recente.month]}/${recente.year}`
                          : `${item.ocorrencias.length} cotações · última em ${MESES[recente.month]}/${recente.year}`}
                      </span>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      {contratos.length === 0 ? (
        <span className="text-xs text-muted-foreground">
          Nenhuma cotação com contrato informado ainda — o campo é preenchido pela
          Licitação ao enviar a solicitação.
        </span>
      ) : alvo ? (
        <span className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">
          <span className="break-words">Mostrando: {alvo.nome}</span>
          <button type="button" onClick={onLimpar} title="Tirar o destaque"
                  className="shrink-0 opacity-70 hover:opacity-100">
            <X className="h-3 w-3" />
          </button>
        </span>
      ) : (
        <span className="text-xs text-muted-foreground">
          Escolha um contrato para abrir o mês em que ele foi cotado.
        </span>
      )}
    </div>
  );
}

function CardCotacao({ cotacao: c, podeResponder, destacado = false }: {
  cotacao: CotacaoLicitacao;
  podeResponder: boolean;
  /** Ligado pelo seletor "Contratos cotados": todas as cotações do contrato escolhido. */
  destacado?: boolean;
}) {
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
    <div
      // O id é o destino do scroll do seletor de contrato — `scrollIntoView`
      // precisa de um nó real, e o card é o menor que identifica a cotação.
      id={`cotacao-${c.id}`}
      className={cn(
        "overflow-hidden rounded-lg border border-l-4 bg-card transition-shadow",
        cfg.border, cfg.accent, aberto && "shadow-md",
        // O anel marca TODAS as cotações do contrato escolhido, não só aquela
        // até onde rolou: o mesmo contrato costuma ter ida e volta em meses
        // diferentes, e ver só uma esconderia o resto.
        destacado && "ring-2 ring-primary ring-offset-2 ring-offset-background",
      )}
    >
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
            {/* SIS-2026-0487: o contrato cotado, em linha própria — é o dado
                que Compras vinha abrindo card por card para descobrir. */}
            <div className="mt-1"><SeloContrato contrato={nomeContrato(c)} /></div>
            <p className="mt-1 text-xs text-muted-foreground">{fmtDatetime(c.created_at)}</p>
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
                <ListaAnexos anexos={c.anexosSolicitacao} />
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
                    {/* Nome de quem respondeu, não "Sua resposta": mais de uma
                        pessoa atende esta fila, e o card é lido pelos dois setores. */}
                    <CheckCircle2 className="h-3.5 w-3.5" /> Resposta de {c.respondente_nome}
                  </p>
                  <p className="whitespace-pre-wrap text-sm leading-relaxed">{c.resposta_comentario}</p>
                  <ListaAnexos anexos={c.anexosResposta} tom="resposta" />
                  <p className="text-xs text-muted-foreground">{fmtDatetime(c.data_resposta)}</p>
                  <p className="flex items-center gap-1 text-xs italic text-muted-foreground">
                    <Eye className="h-3 w-3" />
                    {c.resposta_visualizada_em
                      ? `Lido por ${c.resposta_visualizada_por_nome} em ${fmtDatetime(c.resposta_visualizada_em)}`
                      : "Ninguém leu esta resposta ainda."}
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
  const [comentario, setComentario] = useState("");
  const [arquivos, setArquivos] = useState<File[]>([]);

  async function enviar() {
    if (!comentario.trim() || !arquivos.length) return;
    try {
      await responder.mutateAsync({ id: cotacao.id, empresa_id: cotacao.empresa_id, comentario, arquivos });
      toast.success(
        arquivos.length === 1
          ? "Resposta enviada para a Licitação."
          : `Resposta enviada com ${arquivos.length} anexos.`,
      );
    } catch (e) {
      toast.error("Não foi possível responder", { description: (e as Error).message });
    }
  }

  const pronto = !!comentario.trim() && arquivos.length > 0 && !responder.isPending;

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
        <Label className="text-xs">Anexos * (qualquer formato, até 10 MB cada)</Label>
        <SeletorArquivos arquivos={arquivos} onChange={setArquivos} />
      </div>

      <Button size="sm" className="h-8 gap-1.5 text-xs" onClick={enviar} disabled={!pronto}>
        <Send className="h-3.5 w-3.5" />
        {responder.isPending
          ? `Enviando ${arquivos.length} arquivo${arquivos.length > 1 ? "s" : ""}…`
          : "Enviar resposta"}
      </Button>
    </div>
  );
}
