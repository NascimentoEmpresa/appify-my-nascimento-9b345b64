import { memo, useDeferredValue, useMemo, useState } from "react";
import { ChevronDown, GripVertical, PanelRightClose, PanelRightOpen, Search, Star, Users, X } from "lucide-react";
import {
  DndContext,
  type DragEndEvent,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { cn } from "@/lib/utils";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  useElencoPresenca,
  useHeartbeatPresenca,
  usePreferenciasPresenca,
  usePresencaOnline,
} from "@/hooks/usePresencaOnline";
import {
  alternarFavorito,
  alternarRecolhido,
  CHAVE_FAVORITOS,
  iniciais,
  montarGruposPresenca,
  reordenarPessoa,
  reordenarSetor,
  type GrupoPresenca,
  type PessoaPainel,
  type StatusPresenca,
  type UsuarioElenco,
} from "@/lib/presencaOnline";

/**
 * Painel "quem está online" na lateral direita (30/10/2026), no estilo da
 * lista de amigos do Discord. Todo mundo vê todo mundo — não há "adicionar
 * amigo". Passar o mouse (ou clicar) numa pessoa abre um card SÓ com o nome
 * completo e o setor: nada de cargo, e-mail ou telefone.
 *
 * Segunda versão (mesmo dia, pedido do Pablo): lista TODOS os usuários ativos,
 * agrupados por setor, com o status como bolinha; cada um marca favoritos
 * (grupo no topo), arrasta pessoas e setores para a ordem que quiser e
 * recolhe grupos — tudo salvo por usuário no banco. A regra mora em
 * src/lib/presencaOnline.ts.
 *
 * Só no desktop (lg+): no celular a lateral direita roubaria a tela inteira.
 * A largura é decidida pelo AppShell, que também empurra o conteúdo.
 * Recolhido, o painel vira uma faixa só com quem está online.
 */

export const LARGURA_PAINEL_ONLINE = { aberto: "264px", recolhido: "60px" } as const;

const COR_STATUS: Record<StatusPresenca, string> = {
  online: "bg-emerald-500",
  ausente: "bg-amber-400",
  offline: "bg-muted-foreground/40",
};
const ROTULO_STATUS: Record<StatusPresenca, string> = {
  online: "Disponível",
  ausente: "Ausente",
  offline: "Offline",
};

const idPessoa = (grupo: string, userId: string) => `p|${grupo}|${userId}`;
const idSetor = (chave: string) => `s|${chave}`;
/** Desmonta os ids acima; o nome do setor pode ter "|", o uuid do fim não. */
function lerId(id: string): { tipo: string; grupo: string; userId: string } {
  if (id.startsWith("s|")) return { tipo: "s", grupo: id.slice(2), userId: "" };
  const fim = id.lastIndexOf("|");
  return { tipo: "p", grupo: id.slice(2, fim), userId: id.slice(fim + 1) };
}

function Avatar({ pessoa, tamanho = "h-8 w-8" }: { pessoa: UsuarioElenco & { status: StatusPresenca }; tamanho?: string }) {
  return (
    <span className={cn("relative shrink-0", tamanho)}>
      {pessoa.avatar_url ? (
        <img
          src={pessoa.avatar_url}
          alt=""
          loading="lazy"
          className={cn("h-full w-full rounded-full object-cover", pessoa.status === "offline" && "grayscale")}
        />
      ) : (
        <span className="flex h-full w-full items-center justify-center rounded-full bg-primary/15 text-[11px] font-semibold text-primary">
          {iniciais(pessoa.nome)}
        </span>
      )}
      <span
        className={cn("absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full ring-2 ring-card", COR_STATUS[pessoa.status])}
        aria-label={ROTULO_STATUS[pessoa.status]}
      />
    </span>
  );
}

function CardPessoa({
  pessoa,
  children,
}: {
  pessoa: UsuarioElenco & { status: StatusPresenca };
  children: React.ReactNode;
}) {
  const [aberto, setAberto] = useState(false);
  return (
    <HoverCard open={aberto} onOpenChange={setAberto} openDelay={300} closeDelay={80}>
      <HoverCardTrigger asChild onClick={() => setAberto((a) => !a)}>
        {children}
      </HoverCardTrigger>
      <HoverCardContent side="left" align="start" className="w-64 p-3">
        <div className="flex items-center gap-3">
          <Avatar pessoa={pessoa} tamanho="h-11 w-11" />
          <div className="min-w-0">
            <p className="text-sm font-semibold leading-tight">{pessoa.nome}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{pessoa.setor || "Setor não informado"}</p>
          </div>
        </div>
      </HoverCardContent>
    </HoverCard>
  );
}

const LinhaPessoa = memo(function LinhaPessoa({
  pessoa,
  grupo,
  arrastavel,
  onFavoritar,
}: {
  pessoa: PessoaPainel;
  grupo: string;
  arrastavel: boolean;
  onFavoritar: (userId: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: idPessoa(grupo, pessoa.user_id),
    disabled: !arrastavel,
  });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn("group relative", isDragging && "z-10 opacity-70")}
    >
      <CardPessoa pessoa={pessoa}>
        <div
          {...attributes}
          {...listeners}
          role="button"
          tabIndex={0}
          className={cn(
            "flex w-full cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 pr-8 text-left transition-colors hover:bg-muted",
            pessoa.status === "offline" && "opacity-60",
            arrastavel && "active:cursor-grabbing",
          )}
        >
          <Avatar pessoa={pessoa} />
          <span className="min-w-0 flex-1 truncate text-sm font-medium">{pessoa.nome}</span>
        </div>
      </CardPessoa>
      <button
        type="button"
        onClick={() => onFavoritar(pessoa.user_id)}
        title={pessoa.favorito ? "Tirar dos favoritos" : "Adicionar aos favoritos"}
        className={cn(
          "absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-amber-500",
          pessoa.favorito ? "text-amber-500" : "opacity-0 group-hover:opacity-100 focus:opacity-100",
        )}
      >
        <Star className={cn("h-3.5 w-3.5", pessoa.favorito && "fill-current")} />
      </button>
    </div>
  );
});

function Grupo({
  grupo,
  arrastavel,
  onRecolher,
  onFavoritar,
}: {
  grupo: GrupoPresenca;
  arrastavel: boolean;
  onRecolher: (chave: string) => void;
  onFavoritar: (userId: string) => void;
}) {
  const favoritos = grupo.chave === CHAVE_FAVORITOS;
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: idSetor(grupo.chave),
    disabled: !arrastavel || favoritos,
  });
  const ids = useMemo(() => grupo.pessoas.map((p) => idPessoa(grupo.chave, p.user_id)), [grupo]);

  return (
    <section
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn("mb-1", isDragging && "relative z-20 rounded-md bg-card opacity-80 shadow")}
    >
      <div className="group/cab flex items-center">
        {arrastavel && !favoritos ? (
          <span
            {...attributes}
            {...listeners}
            title="Arrastar setor"
            className="cursor-grab rounded p-0.5 text-muted-foreground/50 opacity-0 hover:text-foreground group-hover/cab:opacity-100 active:cursor-grabbing"
          >
            <GripVertical className="h-3.5 w-3.5" />
          </span>
        ) : (
          <span className="w-[18px]" />
        )}
        <button
          type="button"
          onClick={() => onRecolher(grupo.chave)}
          className="flex min-w-0 flex-1 items-center gap-1.5 py-1 pr-2 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground"
        >
          {favoritos && <Star className="h-3 w-3 shrink-0 fill-amber-400 text-amber-400" />}
          <span className="truncate">{grupo.titulo}</span>
          <span className="shrink-0 font-normal normal-case tracking-normal">
            · <span className={grupo.online ? "text-emerald-600" : undefined}>{grupo.online}</span>/{grupo.total}
          </span>
          <ChevronDown className={cn("ml-auto h-3.5 w-3.5 shrink-0 transition-transform", grupo.recolhido && "-rotate-90")} />
        </button>
      </div>
      {!grupo.recolhido && (
        <SortableContext items={ids} strategy={verticalListSortingStrategy}>
          {grupo.pessoas.map((p) => (
            <LinhaPessoa key={p.user_id} pessoa={p} grupo={grupo.chave} arrastavel={arrastavel} onFavoritar={onFavoritar} />
          ))}
        </SortableContext>
      )}
    </section>
  );
}

export function PainelOnline({ aberto, onAlternar }: { aberto: boolean; onAlternar: () => void }) {
  useHeartbeatPresenca(true);
  const presenca = usePresencaOnline(true);
  const elencoQ = useElencoPresenca(aberto);
  const { prefs, salvar } = usePreferenciasPresenca(aberto);
  const [busca, setBusca] = useState("");
  const buscaAdiada = useDeferredValue(busca);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  // Sem o elenco (migration 20261030003600 ainda não aplicada, ou a RPC
  // falhou) o painel cai para a lista de quem deu sinal — a primeira versão.
  const elenco: UsuarioElenco[] = elencoQ.data ?? presenca.linhas;
  const grupos = useMemo(
    () => montarGruposPresenca(elenco, presenca.linhas, presenca.agora ?? new Date(), prefs, buscaAdiada),
    [elenco, presenca.linhas, presenca.agora, prefs, buscaAdiada],
  );
  const online = presenca.pessoas.filter((p) => p.status === "online").length;
  const total = elencoQ.data?.length ?? presenca.pessoas.length;
  const arrastavel = !buscaAdiada.trim();
  const idsSetores = useMemo(
    () => grupos.filter((g) => g.chave !== CHAVE_FAVORITOS).map((g) => idSetor(g.chave)),
    [grupos],
  );

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const a = lerId(String(active.id));
    const b = lerId(String(over.id));
    if (a.tipo === "s" && b.tipo === "s") {
      const setores = idsSetores.map((id) => lerId(id).grupo);
      salvar(reordenarSetor(prefs, setores, a.grupo, b.grupo));
    } else if (a.tipo === "p" && b.tipo === "p" && a.grupo === b.grupo) {
      // Pessoa só reordena dentro do próprio grupo: o setor vem da Senior.
      const g = grupos.find((x) => x.chave === a.grupo);
      if (g) salvar(reordenarPessoa(prefs, a.grupo, g.pessoas.map((p) => p.user_id), a.userId, b.userId));
    }
  };

  return (
    <aside
      style={{ width: aberto ? LARGURA_PAINEL_ONLINE.aberto : LARGURA_PAINEL_ONLINE.recolhido }}
      className="fixed inset-y-0 right-0 z-30 hidden flex-col border-l bg-card transition-[width] duration-300 lg:flex"
      aria-label="Quem está online"
    >
      <div className={cn("flex h-16 shrink-0 items-center border-b px-3", aberto ? "justify-between" : "justify-center")}>
        {aberto && (
          <span className="flex items-center gap-2 text-sm font-semibold">
            <Users className="h-4 w-4" /> Online
            <span className="text-xs font-normal text-muted-foreground">
              <span className="text-emerald-600">{online}</span> de {total}
            </span>
          </span>
        )}
        <button
          type="button"
          onClick={onAlternar}
          className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          title={aberto ? "Recolher painel" : "Ver quem está online"}
        >
          {aberto ? <PanelRightClose className="h-4 w-4" /> : <PanelRightOpen className="h-4 w-4" />}
        </button>
      </div>

      {aberto && (
        <div className="border-b p-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar pessoa"
              className="h-8 w-full rounded-md border bg-background pl-7 pr-7 text-sm outline-none focus:ring-1 focus:ring-ring"
            />
            {busca && (
              <button
                type="button"
                onClick={() => setBusca("")}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground"
                title="Limpar busca"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>
      )}

      <ScrollArea className="flex-1">
        <div className="p-2">
          {aberto ? (
            <>
              {elencoQ.isLoading && presenca.linhas.length === 0 && (
                <p className="px-2 py-3 text-xs text-muted-foreground">Carregando…</p>
              )}
              {!elencoQ.isLoading && grupos.length === 0 && (
                <p className="px-2 py-3 text-xs text-muted-foreground">
                  {busca ? "Ninguém com esse nome." : "Ninguém por aqui ainda."}
                </p>
              )}
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
                {grupos[0]?.chave === CHAVE_FAVORITOS && (
                  <Grupo
                    grupo={grupos[0]}
                    arrastavel={arrastavel}
                    onRecolher={(c) => salvar(alternarRecolhido(prefs, c))}
                    onFavoritar={(id) => salvar(alternarFavorito(prefs, id))}
                  />
                )}
                <SortableContext items={idsSetores} strategy={verticalListSortingStrategy}>
                  {grupos
                    .filter((g) => g.chave !== CHAVE_FAVORITOS)
                    .map((g) => (
                      <Grupo
                        key={g.chave}
                        grupo={g}
                        arrastavel={arrastavel}
                        onRecolher={(c) => salvar(alternarRecolhido(prefs, c))}
                        onFavoritar={(id) => salvar(alternarFavorito(prefs, id))}
                      />
                    ))}
                </SortableContext>
              </DndContext>
            </>
          ) : (
            <>
              <p className="mb-1 text-center text-[11px] font-semibold text-emerald-600" title={`${online} disponíveis`}>
                {online}
              </p>
              {presenca.pessoas.map((p) => (
                <CardPessoa key={p.user_id} pessoa={p}>
                  <button type="button" className="flex w-full justify-center rounded-md py-1.5 hover:bg-muted">
                    <Avatar pessoa={p} />
                  </button>
                </CardPessoa>
              ))}
            </>
          )}
        </div>
      </ScrollArea>
    </aside>
  );
}
