import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  MessageCircle, Bot, User, FolderTree, CheckCircle2, RotateCcw, SmilePlus, Paperclip, AlertTriangle, Loader2,
} from "lucide-react";
import { fmtDataHora, type WaMensagem } from "./types";

// Uma linha do histórico, já normalizada. As duas fontes (mensagens e eventos)
// viram o mesmo formato para poderem ser ordenadas juntas.
interface Linha {
  id: string;
  quando: string;
  texto: string;
  detalhe?: string | null;
  icone: any;
  cor: string;
}

interface WaEvento {
  id: string; tipo: string; ator_id: string | null;
  descricao: string; detalhe: any; criada_em: string;
}

const ICONE_EVENTO: Record<string, { icone: any; cor: string }> = {
  pasta:      { icone: FolderTree,   cor: "text-primary" },
  conclusao:  { icone: CheckCircle2, cor: "text-success" },
  reabertura: { icone: RotateCcw,    cor: "text-warning" },
  reacao:     { icone: SmilePlus,    cor: "text-info" },
  bot:        { icone: Bot,          cor: "text-muted-foreground" },
};

export function HistoricoConversa({ conversaId, nomeContato, aberto, onFechar }: {
  conversaId: string | null; nomeContato: string; aberto: boolean; onFechar: () => void;
}) {
  // Só busca quando o painel abre: histórico completo é caro e ninguém olha
  // toda hora.
  const { data: eventos = [], isLoading: carregandoEv } = useQuery({
    queryKey: ["wa-eventos", conversaId],
    enabled: aberto && !!conversaId,
    // Sem retentativa: enquanto a migration do histórico não estiver aplicada a
    // tabela não existe, e o padrão do react-query ficaria 3 tentativas
    // insistindo — foi o que deixava "Carregando…" preso na tela com a lista
    // já montada. Falha aqui é ausência de eventos, não erro pro usuário.
    retry: false,
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("WA_EVENTO")
        .select("*").eq("conversa_id", conversaId).order("criada_em", { ascending: false });
      if (error) return [] as WaEvento[];
      return (data ?? []) as WaEvento[];
    },
  });

  const { data: mensagens = [], isLoading: carregandoMsg } = useQuery({
    queryKey: ["wa-hist-mensagens", conversaId],
    enabled: aberto && !!conversaId,
    queryFn: async () => {
      const { data } = await (supabase as any).from("WA_MENSAGEM")
        .select("*").eq("conversa_id", conversaId).order("criada_em", { ascending: false });
      return (data ?? []) as WaMensagem[];
    },
  });

  // Nomes dos autores: WA_MENSAGEM guarda autor_id, não o nome. Uma busca só
  // para todos os ids evita uma consulta por linha.
  const idsAutores = useMemo(
    () => [...new Set(mensagens.map((m) => m.autor_id).filter(Boolean) as string[])],
    [mensagens]);

  const { data: nomes = {} } = useQuery({
    queryKey: ["wa-hist-autores", idsAutores.join(",")],
    enabled: aberto && idsAutores.length > 0,
    queryFn: async () => {
      const { data } = await (supabase as any).from("profiles").select("id, display_name").in("id", idsAutores);
      return Object.fromEntries((data ?? []).map((p: any) => [p.id, p.display_name])) as Record<string, string>;
    },
  });

  const linhas = useMemo<Linha[]>(() => {
    const doEvento: Linha[] = eventos.map((e) => ({
      id: `e-${e.id}`,
      quando: e.criada_em,
      texto: e.descricao,
      icone: ICONE_EVENTO[e.tipo]?.icone ?? FolderTree,
      cor: ICONE_EVENTO[e.tipo]?.cor ?? "text-muted-foreground",
    }));

    const daMensagem: Linha[] = mensagens
      .map((m) => {
        // Conclusão/reabertura são gravadas como mensagem de sistema (é o que
        // aparece dentro da conversa) e NÃO viram evento, para o histórico não
        // mostrar a mesma coisa duas vezes com palavras diferentes.
        if (m.origem === "sistema") {
          return {
            id: `m-${m.id}`,
            quando: m.criada_em,
            texto: m.texto ?? "Evento da conversa",
            icone: (m.texto ?? "").includes("reabert") ? RotateCcw : CheckCircle2,
            cor: (m.texto ?? "").includes("reabert") ? "text-warning" : "text-success",
          } as Linha;
        }
        const anexo = m.payload?.midia ? ` (${m.payload.midia.tipo})` : "";
        const corpo = (m.texto ?? "").replace(/^\*[^*]+\*\n/, ""); // tira a assinatura
        const resumo = corpo.length > 90 ? corpo.slice(0, 90) + "…" : corpo;

        let quem: string;
        let icone = MessageCircle;
        let cor = "text-muted-foreground";
        if (m.direcao === "entrada") {
          quem = `${nomeContato} enviou`;
          cor = "text-info";
        } else if (m.origem === "bot") {
          quem = "O bot respondeu";
          icone = Bot;
        } else {
          quem = `${(m.autor_id && nomes[m.autor_id]) || "Um atendente"} enviou`;
          icone = User;
          cor = "text-success";
        }
        return {
          id: `m-${m.id}`,
          quando: m.criada_em,
          texto: quem + anexo,
          detalhe: resumo || null,
          icone: m.payload?.midia ? Paperclip : icone,
          cor: m.status === "erro" ? "text-destructive" : cor,
        };
      });

    return [...doEvento, ...daMensagem].sort((a, b) => b.quando.localeCompare(a.quando));
  }, [eventos, mensagens, nomes, nomeContato]);

  const carregando = carregandoEv || carregandoMsg;

  return (
    <Sheet open={aberto} onOpenChange={(v) => !v && onFechar()}>
      <SheetContent className="flex w-full flex-col sm:max-w-lg">
        <SheetHeader>
          <SheetTitle className="text-base">Histórico — {nomeContato}</SheetTitle>
        </SheetHeader>
        <p className="text-xs text-muted-foreground">
          Tudo que aconteceu nesta conversa, do mais recente para o mais antigo.
        </p>

        <ScrollArea className="-mx-2 mt-2 flex-1 px-2">
          {/* Só ocupa a tela enquanto NÃO há nada para mostrar. Com a lista já
              montada, um "carregando" acima dela só confunde. */}
          {carregando && linhas.length === 0 && (
            <div className="flex flex-col items-center gap-2 py-10 text-muted-foreground">
              <Loader2 className="h-6 w-6 animate-spin" />
              <p className="text-sm">Carregando o histórico…</p>
            </div>
          )}
          {carregando && linhas.length > 0 && (
            <p className="flex items-center justify-center gap-1.5 py-1 text-[11px] text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" /> atualizando…
            </p>
          )}
          {!carregando && linhas.length === 0 && (
            <p className="py-6 text-center text-sm text-muted-foreground">Nada registrado ainda.</p>
          )}
          <ol className="space-y-3 py-2">
            {linhas.map((l) => {
              const Icone = l.icone;
              return (
                <li key={l.id} className="flex gap-2.5">
                  <Icone className={`mt-0.5 h-4 w-4 shrink-0 ${l.cor}`} />
                  <div className="min-w-0 flex-1 border-b border-border/50 pb-3">
                    <p className="text-sm leading-snug">{l.texto}</p>
                    {l.detalhe && <p className="mt-0.5 truncate text-xs text-muted-foreground">{l.detalhe}</p>}
                    <p className="mt-0.5 text-[11px] text-muted-foreground">{fmtDataHora(l.quando)}</p>
                  </div>
                </li>
              );
            })}
          </ol>
        </ScrollArea>

        <p className="flex items-start gap-1.5 border-t border-border pt-2 text-[11px] text-muted-foreground">
          <AlertTriangle className="mt-px h-3 w-3 shrink-0" />
          Movimentações e reações passaram a ser registradas a partir da implantação deste histórico;
          o que aconteceu antes disso não aparece aqui.
        </p>
      </SheetContent>
    </Sheet>
  );
}
