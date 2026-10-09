import type { CSSProperties } from "react";
import { statusDetalhadoVaga, type EtapaVaga } from "@/lib/recrutamento/statusDetalhado";

/**
 * Selo de status da vaga com a etapa do kanban (08/10/2026): "Recrutamento:
 * TRIAGEM", na cor da coluna. Quando não há detalhe (vaga encerrada, fila de
 * aprovação), devolve o selo de sempre da tela — `classe` é o formato do selo
 * de cada tela (rec-badge, ini-badge…) e `classeCor` a cor que ela já usava.
 * Regras em src/lib/recrutamento/statusDetalhado.ts.
 */
export function StatusVagaBadge({ status, etapa, classe, classeCor = "", style }: {
  status: string | null | undefined;
  etapa?: EtapaVaga | null;
  classe: string;
  classeCor?: string;
  style?: CSSProperties;
}) {
  const d = statusDetalhadoVaga(status, etapa);
  if (!d.detalhado || !d.cor) {
    return <span className={`${classe} ${classeCor}`} style={style}>{d.texto || "—"}</span>;
  }
  return (
    <span className={classe} title={d.dica}
      style={{ background: `${d.cor}1f`, color: d.tinta, border: `1px solid ${d.cor}66`, ...style }}>
      {d.texto}
    </span>
  );
}
