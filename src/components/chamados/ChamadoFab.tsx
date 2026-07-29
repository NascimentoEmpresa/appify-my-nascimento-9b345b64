import { useLocation, useNavigate } from "react-router-dom";
import { Headset } from "lucide-react";

// Botão flutuante para abrir um chamado de qualquer tela do ERP. Substitui o
// antigo FAB de ajuda: um clique leva direto à tela de abrir chamado.
export function ChamadoFab() {
  const { pathname } = useLocation();
  const nav = useNavigate();

  // Não aparece na própria tela de abrir chamado.
  if (pathname.endsWith("/chamados/novo")) return null;

  return (
    <button
      onClick={() => nav("/app/sistemas/chamados/novo")}
      className="fixed bottom-6 right-6 z-40 flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg transition hover:scale-105 hover:shadow-xl"
      aria-label="Abrir chamado"
      title="Abrir chamado"
    >
      <Headset className="h-6 w-6" />
    </button>
  );
}
