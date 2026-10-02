import { useLocation, useNavigate } from "react-router-dom";
import { Wrench } from "lucide-react";
import { useAccessibleMenus, matchMenuCode } from "@/hooks/useAccessibleMenus";
import { useStatusDevTelas } from "@/hooks/useChecklistModulos";
import { statusDevDaTela } from "@/lib/sistemas/checklistModulos";
import { StatusPill } from "@/pages/sistemas/checklist/ui";
import { cn } from "@/lib/utils";

// =====================================================================
// Selo de STATUS DE DESENVOLVIMENTO no canto superior direito de TODA tela
// (02/10/2026, mig 20261002000003).
//
// Pedido do Pablo: o mesmo status que aparece no Controle de Efetividade
// dos Módulos (Sistemas › Checklist de Módulos) aparece em todos os
// sistemas. Vale o status da TELA; vazia, o do MÓDULO (marcado ou
// calculado pelas telas); nada preenchido = "Pendente", igual ao painel.
//
// A tela é descoberta pelo mesmo casamento de rota do RouteGuard. Rota fora
// do catálogo (início, perfil…) não mostra selo. Quem tem acesso ao
// checklist clica e vai direto para a página do módulo.
// =====================================================================

const MENU_CHECKLIST = "sistemas_checklist_modulos";
const ORIGEM: Record<string, string> = {
  tela: "status desta tela",
  modulo: "status do módulo",
  calculado: "calculado pelas telas do módulo",
  pendente: "ainda não preenchido",
};

export function StatusDevTela({ className }: { className?: string }) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { data: access } = useAccessibleMenus("visualizar");
  const q = useStatusDevTelas(!!access);

  const menuCodigo = access ? matchMenuCode(pathname, access.routes) : null;
  const r = statusDevDaTela(q.data, menuCodigo);
  if (!r) return null;

  const moduloId = q.data?.telas.find((t) => t.codigo === menuCodigo)?.modulo_id ?? null;
  const podeAbrir = !!moduloId && !!access?.codes.has(MENU_CHECKLIST);
  const titulo = `Status de desenvolvimento (${ORIGEM[r.origem]}) — Checklist de Módulos${podeAbrir ? ". Clique para ver o módulo." : ""}`;

  const conteudo = (
    <>
      <Wrench className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <span className="hidden text-[11px] font-semibold text-muted-foreground xl:inline">Status</span>
      <StatusPill etapa="dev" valor={r.status} compacto calculado={r.origem === "calculado"} />
    </>
  );

  return podeAbrir ? (
    <button type="button" title={titulo} onClick={() => navigate(`/app/sistemas/checklist-modulos/${moduloId}`)}
      className={cn("flex items-center gap-1.5 rounded-lg px-2 py-1 transition hover:bg-secondary", className)}>
      {conteudo}
    </button>
  ) : (
    <div title={titulo} className={cn("flex items-center gap-1.5 px-2 py-1", className)}>{conteudo}</div>
  );
}
