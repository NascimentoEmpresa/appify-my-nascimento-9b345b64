import { useMemo } from "react";
import { Link } from "react-router-dom";
import { CalendarDays, ClipboardCheck, Clock, Headset, Inbox, Megaphone, MessageCircle, User, type LucideIcon } from "lucide-react";
import { useAccessibleMenus, rotaVisivelNoMenu } from "@/hooks/useAccessibleMenus";
import { useModoExterno } from "@/hooks/useModoExterno";
import { useTemAlcada } from "@/hooks/useTemAlcada";
import { atalhosVisiveis, type IdAtalhoMobile } from "@/lib/layoutMobile";

const VISUAL: Record<IdAtalhoMobile, { icone: LucideIcon; cor: string }> = {
  whatsapp: { icone: MessageCircle, cor: "bg-success/15 text-success" },
  tarefas: { icone: ClipboardCheck, cor: "bg-primary/10 text-primary" },
  aprovacoes: { icone: Inbox, cor: "bg-amber-500/15 text-amber-600" },
  chamados: { icone: Headset, cor: "bg-info/15 text-info" },
  "hora-extra": { icone: Clock, cor: "bg-accent/15 text-accent" },
  reunioes: { icone: CalendarDays, cor: "bg-primary/10 text-primary" },
  novidades: { icone: Megaphone, cor: "bg-accent/15 text-accent" },
  perfil: { icone: User, cor: "bg-muted text-muted-foreground" },
};

/** Atalhos do Início no celular: as telas de todo dia a um toque, sem passar pelo menu. */
export function AtalhosMobile() {
  const externo = useModoExterno();
  const { data: access } = useAccessibleMenus("visualizar");
  const { temAlcada } = useTemAlcada();
  const atalhos = useMemo(
    () => atalhosVisiveis({ temAlcada, visivel: (r) => rotaVisivelNoMenu(r, access) }),
    [temAlcada, access],
  );
  if (externo || atalhos.length === 0) return null;
  return (
    <nav aria-label="Atalhos" className="mb-4 grid grid-cols-4 gap-2 lg:hidden">
      {atalhos.map((a) => {
        const { icone: Icone, cor } = VISUAL[a.id];
        return (
          <Link key={a.id} to={a.to} className="flex min-w-0 flex-col items-center gap-1.5 rounded-xl border border-border/70 bg-card px-1 py-2.5 shadow-sm transition active:scale-95 active:bg-muted/60">
            <span className={`grid h-10 w-10 place-items-center rounded-xl ${cor}`}><Icone className="h-5 w-5" /></span>
            <span className="w-full truncate text-center text-[11px] font-medium leading-tight text-foreground">{a.rotulo}</span>
          </Link>
        );
      })}
    </nav>
  );
}
