import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  Banknote,
  BrainCircuit,
  ChevronDown,
  Handshake,
  Loader2,
  PackageX,
  RefreshCw,
  Repeat,
  Send,
  Sparkles,
  TrendingDown,
  X,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  useAnaliseEstoqueIA,
  type MsgIaEstoque,
} from "@/hooks/useEstoqueSaudavel";
import { formatarNumero } from "@/lib/suprimentos/dashboardComprasEstoque";
import type {
  EstoqueSaudavelDados,
  FiltroEstoqueSaudavel,
} from "@/lib/suprimentos/estoqueSaudavel";
import { cn } from "@/lib/utils";

/**
 * Assistente do planejamento de estoque — o "chatbot no canto da tela".
 *
 * Pedido do gerente de Supply em 20/10/2026, depois de ver a primeira versão:
 * "precisa no mínimo ter um lugar nessa tela onde eu pudesse perguntar coisas
 * para a IA, por exemplo perguntas prontas (…) e campos para poder perguntar
 * coisas a IA (…) tipo um chatboot no canto da tela com caixinha de pergunta".
 *
 * Por que isto SUBSTITUIU o painel de análise que ficava no meio da página, em
 * vez de conviver com ele: duas caixas de IA na mesma tela deixam a pessoa
 * decidindo em qual perguntar. A análise completa continua existindo — virou a
 * primeira das perguntas prontas aqui dentro.
 *
 * AS PERGUNTAS PRONTAS NÃO SÃO ENFEITE DE INTERFACE. Cada uma delas tem um
 * ranking correspondente calculado pela RPC sobre o CATÁLOGO INTEIRO
 * (`rankings` em sup_estoque_saudavel). Antes disso a IA recebia só uma amostra
 * das linhas da tabela, e "qual item mais roda" respondido sobre amostra é uma
 * resposta errada com cara de certa. Ao mexer nestas perguntas, confira se o
 * ranking que as sustenta existe — senão a IA vai responder pelo que couber no
 * prompt.
 */

interface PerguntaPronta {
  /** O que aparece no chip — curto, porque o espaço é estreito. */
  rotulo: string;
  /** O que de fato vai para a IA, escrito por extenso. */
  pergunta: string;
  icone: typeof Repeat;
  /** `true` dispara a análise completa em vez de uma pergunta. */
  analise?: boolean;
}

const PERGUNTAS: PerguntaPronta[] = [
  {
    rotulo: "Análise completa",
    pergunta: "",
    icone: Sparkles,
    analise: true,
  },
  {
    rotulo: "O que mais roda?",
    pergunta:
      "Qual item mais roda no meu estoque? Liste os primeiros pelo giro anual, " +
      "dizendo quantas vezes o estoque de cada um se renova por ano e quantos " +
      "dias de cobertura restam.",
    icone: Repeat,
  },
  {
    rotulo: "Reponho mais seguido?",
    pergunta:
      "Qual item eu preciso comprar reposição mais seguidamente? Use as " +
      "reposições que realmente aconteceram na janela, diga de quantos em " +
      "quantos dias cada um foi reposto e se vale aumentar o lote para " +
      "comprar menos vezes.",
    icone: RefreshCw,
  },
  {
    rotulo: "O que mais faltou?",
    pergunta:
      "Qual item tem faltado muito nos pedidos solicitados e precisamos " +
      "comprar urgentemente? Use o histórico de pedidos que não puderam ser " +
      "atendidos pelo estoque, não só a situação de hoje, e diga quantas " +
      "vezes cada um faltou e quanto comprar agora.",
    icone: PackageX,
  },
  {
    rotulo: "O que está acumulando?",
    pergunta:
      "Qual item não sai muito e está ficando acumulado no estoque? Diga " +
      "quanto dinheiro está parado em cada um, há quantos meses não gira e o " +
      "que eu deveria liquidar ou vender.",
    icone: TrendingDown,
  },
  {
    rotulo: "Dinheiro parado",
    pergunta:
      "Quanto dinheiro eu tenho parado no estoque hoje? Separe o que é " +
      "excesso em item que gira do que é item sem giro, e diga o que fazer " +
      "com cada parte.",
    icone: Banknote,
  },
  {
    rotulo: "Onde barganhar preço",
    pergunta:
      "Onde vale fechar um volume maior com o fornecedor para barganhar " +
      "preço? Use a compra sugerida somada por família e diga quais famílias " +
      "têm volume suficiente para negociar.",
    icone: Handshake,
  },
];

/**
 * Pedido disparado de fora (pela faixa no corpo da página).
 *
 * `seq` é um contador, e não um booleano, porque a pessoa pode clicar na mesma
 * pergunta duas vezes seguidas — com booleano o segundo clique não mudaria o
 * valor e nada aconteceria.
 */
export interface PedidoExternoChat {
  texto: string;
  modo: "analise" | "pergunta";
  seq: number;
}

export function ChatEstoqueIA({
  empresaId,
  filtros,
  dados,
  pedidoExterno,
}: {
  empresaId: string | null;
  filtros: FiltroEstoqueSaudavel;
  dados: EstoqueSaudavelDados;
  pedidoExterno?: PedidoExternoChat | null;
}) {
  const ia = useAnaliseEstoqueIA();
  const [aberto, setAberto] = useState(false);
  const [conversa, setConversa] = useState<MsgIaEstoque[]>([]);
  const [pergunta, setPergunta] = useState("");
  const [mostrarChips, setMostrarChips] = useState(true);
  const fimDaLista = useRef<HTMLDivElement>(null);
  const ultimoPedido = useRef(0);

  // Definida antes dos efeitos porque um deles a chama. Nada de `return` antes
  // daqui: o early return de `empresaId` fica DEPOIS de todos os hooks, senão
  // a ordem de hooks muda entre renders quando a empresa ainda está carregando.
  const enviar = async (texto: string, modo: "analise" | "pergunta") => {
    if (!empresaId) return;
    const rotulo = modo === "analise" ? "Faça a análise completa do estoque." : texto;
    // O histórico que vai para a IA é o de ANTES desta pergunta: mandar a
    // pergunta nova dentro do histórico a duplicaria no prompt.
    const historico = conversa;
    setConversa([...historico, { role: "user", content: rotulo }]);
    setPergunta("");
    setMostrarChips(false);
    try {
      const resposta = await ia.mutateAsync({
        empresaId,
        janelaMeses: filtros.janelaMeses,
        contratoId: filtros.contratoId,
        categoria: filtros.categoria,
        almoxarifadoId: filtros.almoxarifadoId,
        modo,
        pergunta: modo === "pergunta" ? texto : undefined,
        historico,
      });
      setConversa((c) => [...c, { role: "assistant", content: resposta }]);
    } catch (e) {
      toast.error((e as Error).message);
      // Devolve o estado anterior e a pergunta na caixa, para a pessoa poder
      // tentar de novo sem redigitar.
      setConversa(historico);
      if (modo === "pergunta") setPergunta(texto);
    }
  };

  // Rola para a última mensagem sempre que a conversa cresce ou a IA começa a
  // responder — sem isto, a resposta nova nasce fora da área visível e parece
  // que nada aconteceu.
  useEffect(() => {
    if (aberto) fimDaLista.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [conversa, ia.isPending, aberto]);

  // Pergunta disparada pela faixa no corpo da página: abre o painel e manda.
  // O guard por `seq` evita reenviar a mesma pergunta a cada novo render.
  useEffect(() => {
    if (!pedidoExterno || pedidoExterno.seq === 0) return;
    if (pedidoExterno.seq === ultimoPedido.current) return;
    ultimoPedido.current = pedidoExterno.seq;
    setAberto(true);
    void enviar(pedidoExterno.texto, pedidoExterno.modo);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pedidoExterno?.seq]);

  if (!empresaId) return null;

  const emFalta = dados.resumo.itens_em_falta;
  const jaFaltou = dados.resumo.itens_que_faltaram ?? 0;

  /* ---------------------------------------------------------------- */
  /* Botão flutuante                                                  */
  /* ---------------------------------------------------------------- */
  if (!aberto) {
    return (
      <button
        type="button"
        onClick={() => setAberto(true)}
        aria-label="Abrir o assistente do estoque"
        className="fixed bottom-6 right-6 z-50 flex items-center gap-2 rounded-full bg-violet-600 py-3 pl-4 pr-5 text-white shadow-lg transition hover:bg-violet-700 hover:shadow-xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-600"
      >
        <BrainCircuit className="h-5 w-5" />
        <span className="text-sm font-semibold">Perguntar à I.A</span>
        {emFalta > 0 && (
          <span className="ml-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-white px-1.5 text-xs font-bold text-rose-700">
            {emFalta}
          </span>
        )}
      </button>
    );
  }

  /* ---------------------------------------------------------------- */
  /* Painel aberto                                                    */
  /* ---------------------------------------------------------------- */
  return (
    <Card className="fixed bottom-6 right-6 z-50 flex w-[min(26rem,calc(100vw-2rem))] flex-col overflow-hidden border-violet-200 shadow-2xl">
      <header className="flex items-start justify-between gap-2 bg-gradient-to-br from-violet-600 to-violet-700 px-4 py-3 text-white">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-sm font-bold">
            <BrainCircuit className="h-4 w-4" /> Assistente do Estoque
          </p>
          <p className="mt-0.5 text-[11px] leading-snug text-violet-100">
            Responde sobre {formatarNumero(dados.resumo.itens_planejados)} itens do
            plano. As quantidades são calculadas pelo sistema — a I.A só interpreta.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setAberto(false)}
          aria-label="Fechar o assistente"
          className="rounded p-1 text-violet-100 transition hover:bg-white/15 hover:text-white"
        >
          <X className="h-4 w-4" />
        </button>
      </header>

      {/* Aviso que muda a leitura de qualquer resposta: enquanto houver item
          em falta, é o que importa primeiro. */}
      {(emFalta > 0 || jaFaltou > 0) && (
        <div className="flex items-start gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2 text-[11px] leading-snug text-amber-900">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
          <span>
            {emFalta > 0 && (
              <>
                <b>{formatarNumero(emFalta)}</b>{" "}
                {emFalta === 1 ? "tamanho está" : "tamanhos estão"} sem peça em casa
                agora.{" "}
              </>
            )}
            {jaFaltou > 0 && (
              <>
                <b>{formatarNumero(jaFaltou)}</b> já deixaram pedido sem atendimento.
              </>
            )}
          </span>
        </div>
      )}

      {/* clamp, e não min: o resto do painel (cabeçalho, aviso, chips e caixa
          de texto) ocupa ~22rem, e num notebook de tela baixa `min` chegava a
          calcular altura negativa para a conversa, sumindo com ela. O piso de
          10rem mantém a conversa visível e rolável em qualquer tela. */}
      <ScrollArea className="h-[clamp(10rem,calc(100vh-22rem),26rem)]">
        <div className="space-y-3 p-4">
          {conversa.length === 0 && (
            <div className="rounded-lg border bg-slate-50 p-3 text-xs text-slate-600">
              <p className="font-semibold text-slate-800">
                Pergunte o que quiser sobre o estoque.
              </p>
              <p className="mt-1">
                Escolha uma pergunta pronta abaixo ou escreva a sua. Eu leio os
                números deste painel — o que não estiver nele, eu digo que não sei.
              </p>
            </div>
          )}

          {conversa.map((m, i) => (
            <div
              key={i}
              className={cn(
                "rounded-xl px-3 py-2 text-sm",
                m.role === "user"
                  ? "ml-6 bg-violet-600 text-white"
                  : "mr-2 border bg-white",
              )}
            >
              {m.role === "assistant" ? (
                <div className="prose prose-sm max-w-none prose-headings:mb-1 prose-headings:mt-2 prose-h2:text-sm prose-p:my-1 prose-ul:my-1 prose-li:my-0">
                  <ReactMarkdown>{m.content}</ReactMarkdown>
                </div>
              ) : (
                m.content
              )}
            </div>
          ))}

          {ia.isPending && (
            <p className="flex items-center gap-1.5 text-xs text-slate-500">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Lendo os números…
            </p>
          )}

          <div ref={fimDaLista} />
        </div>
      </ScrollArea>

      {/* Perguntas prontas. Depois da primeira pergunta elas recolhem, para a
          conversa ocupar a altura — mas continuam a um clique, porque é por
          elas que a maioria das sessões começa. */}
      <div className="border-t bg-slate-50/80 px-3 py-2">
        {conversa.length > 0 && (
          <button
            type="button"
            onClick={() => setMostrarChips((v) => !v)}
            className="mb-1 flex items-center gap-1 text-[11px] font-semibold text-slate-600 hover:text-slate-900"
          >
            <ChevronDown
              className={cn("h-3.5 w-3.5 transition", mostrarChips && "rotate-180")}
            />
            Perguntas prontas
          </button>
        )}
        {mostrarChips && (
          <div className="flex flex-wrap gap-1.5">
            {PERGUNTAS.map((p) => (
              <button
                key={p.rotulo}
                type="button"
                disabled={ia.isPending}
                onClick={() => enviar(p.pergunta, p.analise ? "analise" : "pergunta")}
                className={cn(
                  "flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-medium transition disabled:opacity-50",
                  p.analise
                    ? "border-violet-300 bg-violet-100 text-violet-800 hover:bg-violet-200"
                    : "border-slate-300 bg-white text-slate-700 hover:border-violet-300 hover:bg-violet-50",
                )}
              >
                <p.icone className="h-3 w-3" />
                {p.rotulo}
              </button>
            ))}
          </div>
        )}
      </div>

      <form
        className="flex items-center gap-2 border-t bg-white p-3"
        onSubmit={(e) => {
          e.preventDefault();
          const q = pergunta.trim();
          if (q) enviar(q, "pergunta");
        }}
      >
        <Input
          value={pergunta}
          onChange={(e) => setPergunta(e.target.value)}
          placeholder="Ex.: o que comprar primeiro este mês?"
          className="h-9"
        />
        <Button
          type="submit"
          size="icon"
          className="h-9 w-9 shrink-0 bg-violet-600 hover:bg-violet-700"
          disabled={ia.isPending || !pergunta.trim()}
          title="Perguntar"
        >
          {ia.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Send className="h-4 w-4" />
          )}
        </Button>
      </form>

      {conversa.length > 0 && (
        <button
          type="button"
          onClick={() => {
            setConversa([]);
            setMostrarChips(true);
          }}
          className="border-t bg-slate-50 py-1.5 text-[11px] text-slate-500 hover:text-slate-800"
        >
          Limpar a conversa
        </button>
      )}
    </Card>
  );
}

/**
 * Faixa de chamada dentro da página.
 *
 * O botão flutuante é fácil de não ver quando a pessoa está lendo a tabela, e
 * esta aba é longa. Esta faixa mostra as perguntas mais pedidas no corpo da
 * página e abre o assistente já com a pergunta disparada — é a porta de
 * entrada descoberta sem procurar.
 */
export function ChamadaChatEstoque({
  onPerguntar,
}: {
  onPerguntar: (pergunta: string, modo: "analise" | "pergunta") => void;
}) {
  const destaque = PERGUNTAS.filter((p) => !p.analise).slice(0, 4);
  return (
    <Card className="border-violet-200 bg-gradient-to-br from-violet-50/70 to-background p-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <p className="flex items-center gap-1.5 text-sm font-bold text-violet-950">
          <BrainCircuit className="h-4 w-4 text-violet-600" /> Pergunte à I.A sobre
          o seu estoque
        </p>
        <Badge variant="outline" className="bg-white text-[11px] font-normal">
          a conta é do sistema, a leitura é da I.A
        </Badge>
        <div className="flex flex-wrap gap-1.5">
          {destaque.map((p) => (
            <button
              key={p.rotulo}
              type="button"
              onClick={() => onPerguntar(p.pergunta, "pergunta")}
              className="flex items-center gap-1 rounded-full border border-violet-300 bg-white px-2.5 py-1 text-[11px] font-medium text-violet-800 transition hover:bg-violet-100"
            >
              <p.icone className="h-3 w-3" />
              {p.rotulo}
            </button>
          ))}
        </div>
        <Button
          size="sm"
          className="ml-auto gap-1.5 bg-violet-600 hover:bg-violet-700"
          onClick={() => onPerguntar("", "analise")}
        >
          <Sparkles className="h-4 w-4" /> Análise completa
        </Button>
      </div>
    </Card>
  );
}
