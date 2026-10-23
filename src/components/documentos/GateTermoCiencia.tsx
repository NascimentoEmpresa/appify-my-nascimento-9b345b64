import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useSolicitacaoDocumento, useTermosCienciaPendentes } from "@/hooks/useDocumentosSolicitados";
import { termosCienciaPendentes } from "@/lib/rh/documentosSolicitados";
import { AssinarDocumento } from "@/components/documentos/AssinarDocumento";
import { DetalheDocumento } from "@/components/documentos/DetalheDocumento";

/**
 * RH › Documentos — TERMO DE CIÊNCIA no login (mig 20261022000500, 22/10/2026).
 *
 * Pedido do Pablo: "sempre que o destinatário entrar no sistema, aparece um
 * card pedindo para ele ASSINAR o termo, até assinar". Fica montado no
 * AppShell, como o GateNotificacoes, porque o termo é do SISTEMA e chega a
 * qualquer usuário — inclusive quem não tem a tela Encarregados › Documentos.
 *
 * Um termo por vez, o mais antigo primeiro. "Assinar depois" adia só NESTA
 * sessão (estado, não banco): adiar não é ciência, e na próxima entrada o
 * termo volta, até ser assinado.
 *
 * Também atende o link da notificação de quem não tem a tela dos
 * Encarregados: /app?documento=<id> abre a solicitação por cima de
 * qualquer tela (rh_doc_link_destinatario decide o link no banco).
 */
export function GateTermoCiencia() {
  const { user } = useAuth();
  const termos = useTermosCienciaPendentes(user?.id);
  const [adiados, setAdiados] = useState<number[]>([]);
  const [params, setParams] = useSearchParams();
  const idLink = Number(params.get("documento")) || null;
  const doLink = useSolicitacaoDocumento(idLink);

  const fila = termosCienciaPendentes(termos.data ?? [], user?.id, adiados);
  const atual = fila[0] ?? null;
  const fecharLink = () => { params.delete("documento"); setParams(params, { replace: true }); };

  // O link da notificação vem antes do termo da fila, para não empilhar duas janelas.
  // Link de outra pessoa (ou que não abre) não trava a fila de termos.
  const s = doLink.data;
  if (idLink && s && s.destinatario_id === user?.id) {
    return <DetalheDocumento solicitacao={s} lado="destinatario" onFechar={fecharLink} />;
  }
  if (idLink && doLink.isLoading) return null;
  if (!atual) return null;
  // Assinou: sai da fila na hora (a lista recarrega pela invalidação da mutation).
  const tirarDaFila = () => setAdiados((a) => [...a, atual.id]);
  return <AssinarDocumento solicitacao={atual} restantes={fila.length - 1} onFechar={tirarDaFila} onAdiar={tirarDaFila} />;
}
