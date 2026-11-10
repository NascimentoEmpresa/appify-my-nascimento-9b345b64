import { useEffect, useMemo, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ClipboardCheck, Home, Inbox, Menu, MessageCircle, type LucideIcon } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAccessibleMenus, rotaVisivelNoMenu } from "@/hooks/useAccessibleMenus";
import { useModoExterno } from "@/hooks/useModoExterno";
import { useTemAlcada } from "@/hooks/useTemAlcada";
import { useContagemTarefas } from "@/hooks/useTarefasFuncao";
import { abaAtiva, abasDaNavegacao, ROTA_WHATSAPP, type IdAbaMobile } from "@/lib/layoutMobile";
import { cn } from "@/lib/utils";

const ICONES: Record<IdAbaMobile, LucideIcon> = {
  inicio: Home,
  whatsapp: MessageCircle,
  aprovacoes: Inbox,
  tarefas: ClipboardCheck,
  menu: Menu,
};

/** Abaixo do `lg` (1024 px), o mesmo ponto em que a barra lateral vira gaveta. */
function useAbaixoDoLg() {
  const consulta = "(max-width: 1023.98px)";
  const [abaixo, setAbaixo] = useState(() => typeof window !== "undefined" && window.matchMedia(consulta).matches);
  useEffect(() => {
    const m = window.matchMedia(consulta);
    const mudou = () => setAbaixo(m.matches);
    m.addEventListener("change", mudou);
    mudou();
    return () => m.removeEventListener("change", mudou);
  }, []);
  return abaixo;
}

/**
 * Número de conversas com mensagem não lida na aba WhatsApp. Só roda no
 * celular, uma vez, e respeita a regra de "nenhuma tela busca sozinha"
 * (src/lib/atualizarTela.ts): atualiza no botão Atualizar e quando a própria
 * caixa de entrada invalida ["wa-conversas"], que é o prefixo desta chave.
 */
function useConversasNaoLidas(ligado: boolean): number {
  const { data } = useQuery({
    queryKey: ["wa-conversas", "nao-lidas"],
    enabled: ligado,
    queryFn: async () => {
      const { count, error } = await (supabase as any).from("WA_CONVERSA")
        .select("id", { count: "exact", head: true })
        .gt("nao_lidas", 0);
      if (error) throw error;
      return count ?? 0;
    },
  });
  return data ?? 0;
}

function Contador({ n, cor }: { n: number; cor: string }) {
  if (n <= 0) return null;
  return (
    <span className={cn("absolute -right-1.5 -top-1 grid h-4 min-w-4 place-items-center rounded-full px-1 text-[9px] font-bold text-white ring-2 ring-surface", cor)}>
      {n > 99 ? "99+" : n}
    </span>
  );
}

/**
 * Barra inferior do celular: o polegar alcança as telas de todo dia sem abrir o
 * menu. Fica fixa fora do fluxo; o AppShell reserva a altura (--nav-mobile) no
 * fim do conteúdo, e o index.css a esconde enquanto o teclado está aberto.
 */
export function NavegacaoMobile({ menuAberto, aoAlternarMenu }: { menuAberto: boolean; aoAlternarMenu: () => void }) {
  const { pathname } = useLocation();
  const externo = useModoExterno();
  const abaixoDoLg = useAbaixoDoLg();
  const { data: access } = useAccessibleMenus("visualizar");
  const { temAlcada, pendentes } = useTemAlcada();
  const tarefas = useContagemTarefas(!externo);

  const abas = useMemo(
    () => abasDaNavegacao({ externo, temAlcada, visivel: (r) => rotaVisivelNoMenu(r, access) }),
    [externo, temAlcada, access],
  );
  const ativa = abaAtiva(pathname, abas);
  const temWhatsapp = abas.some((a) => a.to === ROTA_WHATSAPP);
  const naoLidas = useConversasNaoLidas(abaixoDoLg && temWhatsapp);

  const contador = (id: IdAbaMobile) => {
    if (id === "whatsapp") return <Contador n={naoLidas} cor="bg-success" />;
    if (id === "tarefas") return <Contador n={tarefas} cor="bg-red-600" />;
    if (id === "aprovacoes") return <Contador n={pendentes} cor="bg-amber-500" />;
    return null;
  };

  return (
    <nav aria-label="Navegação principal" className="some-com-teclado fixed inset-x-0 bottom-0 z-30 border-t border-border/70 bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md lg:hidden">
      <ul className="mx-auto flex h-[3.75rem] max-w-xl items-stretch">
        {abas.map((a) => {
          const Icone = ICONES[a.id];
          const acesa = a.to ? ativa === a.id && !menuAberto : menuAberto;
          const conteudo = (
            <>
              <span className={cn("relative grid h-7 w-12 place-items-center rounded-full transition-colors", acesa && "bg-primary/10")}>
                <Icone className="h-[1.3rem] w-[1.3rem]" strokeWidth={acesa ? 2.4 : 2} />
                {contador(a.id)}
              </span>
              <span className="max-w-full truncate text-[11px] leading-none">{a.rotulo}</span>
            </>
          );
          const classe = cn(
            "flex h-full w-full flex-col items-center justify-center gap-1 px-0.5 font-medium transition-colors active:bg-muted/60",
            acesa ? "font-semibold text-primary" : "text-muted-foreground",
          );
          return (
            <li key={a.id} className="min-w-0 flex-1">
              {a.to ? (
                <NavLink to={a.to} end={a.to === "/app"} aria-current={acesa ? "page" : undefined} className={classe}>{conteudo}</NavLink>
              ) : (
                <button type="button" onClick={aoAlternarMenu} aria-expanded={menuAberto} aria-label="Abrir o menu completo" className={classe}>{conteudo}</button>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
