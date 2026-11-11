import { Link, useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { rotaVisivelNoMenu, useAccessibleMenus } from "@/hooks/useAccessibleMenus";
import { etapasControleNotas, ROTA_CONTROLE_NOTAS } from "./navegacao";

export function NavegacaoControleNotas() {
  const { data: acesso } = useAccessibleMenus();
  const { pathname } = useLocation();
  const links = [
    ...(rotaVisivelNoMenu(ROTA_CONTROLE_NOTAS, acesso) ? [{ rota: ROTA_CONTROLE_NOTAS, titulo: "Controle de Notas" }] : []),
    ...etapasControleNotas(acesso),
  ];
  if (!links.length) return null;
  return <nav aria-label="Etapas do Controle de Notas" className="flex flex-wrap gap-2">
    {links.map(link => {
      const atual = pathname.replace(/\/$/, "") === link.rota;
      return <Button key={link.rota} variant={atual ? "default" : "outline"} size="sm" asChild>
        <Link to={link.rota} aria-current={atual ? "page" : undefined}>{link.titulo}</Link>
      </Button>;
    })}
  </nav>;
}
