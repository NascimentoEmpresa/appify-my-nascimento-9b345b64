import { useLocation, useNavigate } from "react-router-dom";
import { Headset } from "lucide-react";

// Botão flutuante para abrir um chamado de qualquer tela do ERP. Substitui o
// antigo FAB de ajuda: um clique leva direto à tela de abrir chamado.
export function ChamadoFab() {
  const { pathname } = useLocation();
  const nav = useNavigate();

  // Não aparece nas próprias telas de chamados.
  if (pathname.includes("/chamados")) return null;

  // No WhatsApp do celular o canto é do botão de nova conversa, e por cima da
  // conversa o botão cobria o Enviar.
  const noWhatsapp = pathname === "/app/whatsapp";

  return (
    <button
      onClick={() => nav("/app/central-servicos/chamados")}
      className={`some-com-teclado fixed bottom-6 right-6 lg:right-[calc(var(--painel-online-width,0px)_+_1.5rem)] z-20 lg:z-40 flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg transition hover:scale-105 hover:shadow-xl max-lg:bottom-[calc(var(--nav-mobile)_+_0.75rem)] max-lg:right-3 max-lg:h-11 max-lg:w-11 ${noWhatsapp ? "max-md:hidden" : ""}`}
      aria-label="Abrir chamado"
      title="Abrir chamado"
    >
      <Headset className="h-6 w-6" />
    </button>
  );
}
