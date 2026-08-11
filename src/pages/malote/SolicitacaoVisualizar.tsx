import { useParams, useNavigate } from "react-router-dom";
import { SolicitacaoModal } from "./SolicitacaoModal";

// Fallback de deep-link direto pra /app/malote/solicitacao/:id (ex: link de
// notificação). O fluxo normal (a partir de Meus Itens) abre o mesmo modal
// sem navegação, com a lista visível atrás — ver SolicitacaoModal.tsx.
export default function SolicitacaoVisualizar() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  if (!id) return null;

  return <SolicitacaoModal despesaId={id} onClose={() => navigate("/app/malote/meus-itens")} />;
}
