import { useState } from "react";
import { ChevronDown, PanelRightClose, PanelRightOpen, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useHeartbeatPresenca, usePresencaOnline } from "@/hooks/usePresencaOnline";
import { iniciais, type PessoaPresenca } from "@/lib/presencaOnline";

/**
 * Painel "quem está online" na lateral direita (30/10/2026), no estilo da
 * lista de amigos do Discord. Todo mundo vê todo mundo — não há "adicionar
 * amigo". Passar o mouse (ou clicar) numa pessoa abre um card SÓ com o nome
 * completo e o setor: nada de cargo, e-mail ou telefone.
 *
 * Só no desktop (lg+): no celular a lateral direita roubaria a tela inteira.
 * A largura é decidida pelo AppShell, que também empurra o conteúdo.
 */

export const LARGURA_PAINEL_ONLINE = { aberto: "248px", recolhido: "60px" } as const;

const COR_STATUS: Record<PessoaPresenca["status"], string> = {
  online: "bg-emerald-500",
  ausente: "bg-amber-400",
};
const ROTULO_STATUS: Record<PessoaPresenca["status"], string> = {
  online: "Disponível",
  ausente: "Ausente",
};

function Avatar({ pessoa, tamanho = "h-8 w-8" }: { pessoa: PessoaPresenca; tamanho?: string }) {
  return (
    <span className={cn("relative shrink-0", tamanho)}>
      {pessoa.avatar_url ? (
        <img src={pessoa.avatar_url} alt="" loading="lazy" className="h-full w-full rounded-full object-cover" />
      ) : (
        <span className="flex h-full w-full items-center justify-center rounded-full bg-primary/15 text-[11px] font-semibold text-primary">
          {iniciais(pessoa.nome)}
        </span>
      )}
      <span
        className={cn(
          "absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full ring-2 ring-card",
          COR_STATUS[pessoa.status],
        )}
        aria-label={ROTULO_STATUS[pessoa.status]}
      />
    </span>
  );
}

function LinhaPessoa({ pessoa, recolhido }: { pessoa: PessoaPresenca; recolhido: boolean }) {
  const [aberto, setAberto] = useState(false);
  return (
    <HoverCard open={aberto} onOpenChange={setAberto} openDelay={250} closeDelay={80}>
      <HoverCardTrigger asChild>
        <button
          type="button"
          onClick={() => setAberto((a) => !a)}
          className={cn(
            "flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-muted",
            recolhido && "justify-center px-0",
            pessoa.status === "ausente" && "opacity-75",
          )}
        >
          <Avatar pessoa={pessoa} />
          {!recolhido && <span className="min-w-0 flex-1 truncate text-sm font-medium">{pessoa.nome}</span>}
        </button>
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

export function PainelOnline({ aberto, onAlternar }: { aberto: boolean; onAlternar: () => void }) {
  useHeartbeatPresenca(true);
  const { pessoas, carregando } = usePresencaOnline(true);
  const [grupoFechado, setGrupoFechado] = useState(false);
  const online = pessoas.filter((p) => p.status === "online").length;
  const recolhido = !aberto;

  return (
    <aside
      style={{ width: aberto ? LARGURA_PAINEL_ONLINE.aberto : LARGURA_PAINEL_ONLINE.recolhido }}
      className="fixed inset-y-0 right-0 z-30 hidden flex-col border-l bg-card transition-[width] duration-300 lg:flex"
      aria-label="Quem está online"
    >
      <div className={cn("flex h-16 shrink-0 items-center border-b px-3", recolhido ? "justify-center" : "justify-between")}>
        {!recolhido && (
          <span className="flex items-center gap-2 text-sm font-semibold">
            <Users className="h-4 w-4" /> Online
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

      <ScrollArea className="flex-1">
        <div className="p-2">
          {recolhido ? (
            <p className="mb-1 text-center text-[11px] font-semibold text-emerald-600" title={`${online} disponíveis`}>
              {online}
            </p>
          ) : (
            <button
              type="button"
              onClick={() => setGrupoFechado((f) => !f)}
              className="mb-1 flex items-center gap-1.5 px-2 py-1 text-xs font-medium text-muted-foreground hover:text-foreground"
            >
              <span className="h-2 w-2 rounded-full bg-emerald-500" />
              Disponível · {online}
              <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", grupoFechado && "-rotate-90")} />
            </button>
          )}

          {carregando && pessoas.length === 0 && !recolhido && (
            <p className="px-2 py-3 text-xs text-muted-foreground">Carregando…</p>
          )}

          {!grupoFechado || recolhido
            ? pessoas.map((p) => <LinhaPessoa key={p.user_id} pessoa={p} recolhido={recolhido} />)
            : null}
        </div>
      </ScrollArea>
    </aside>
  );
}
