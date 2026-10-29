import { useHistoricoAjusteFluxo, type HistoricoAjusteFluxo as Evento } from "@/hooks/useFluxoCaixaMalote";

// SIS-2026-0733: "Histórico de alterações" da linha no diálogo de edição do Fluxo.
const ROTULO_CAMPO: Record<string, string> = {
  valor: "Valor",
  data_pagamento: "Data de pagamento",
  tipo: "Tipo",
  classificacao_id: "Classificação",
  descricao: "Descrição",
  competencia: "Competência",
  empresa_id: "Empresa",
  banco_id: "Banco",
  forma_pagamento: "Forma de pagamento",
};

const ROTULO_OPERACAO: Record<Evento["operacao"], string> = { criado: "Ajuste criado", alterado: "Ajuste alterado", desfeito: "Ajuste desfeito" };

function formatar(campo: string, v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (campo === "valor") return Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  if ((campo === "data_pagamento" || campo === "competencia") && typeof v === "string") {
    return new Date(v.slice(0, 10) + "T00:00:00").toLocaleDateString("pt-BR");
  }
  // classificação, empresa e banco guardam o id; o histórico mostra que mudou, sem resolver o nome.
  if (campo.endsWith("_id")) return "alterado";
  return String(v);
}

export function HistoricoAjusteFluxo({ linha }: { linha: { origem: string; despesa_id: string; numero_parcela: number | null } | null }) {
  const { data: eventos = [] } = useHistoricoAjusteFluxo(linha);
  if (eventos.length === 0) return null;

  return (
    <div className="rounded-md border p-2.5 text-xs">
      <p className="mb-1.5 font-medium">Histórico de alterações deste lançamento</p>
      <ul className="max-h-40 space-y-1.5 overflow-y-auto">
        {eventos.map((e) => (
          <li key={e.id}>
            <span className="font-medium">{ROTULO_OPERACAO[e.operacao]}</span>
            <span className="text-muted-foreground">
              {" "}
              — {e.usuario_nome ?? `banco de dados (${e.usuario_banco})`}, {new Date(e.created_at).toLocaleString("pt-BR")}
            </span>
            {e.campos.length > 0 && (
              <ul className="ml-3 text-muted-foreground">
                {e.campos.map((c) => (
                  <li key={c}>
                    {ROTULO_CAMPO[c] ?? c}: {formatar(c, e.antes?.[c])} → {formatar(c, e.depois?.[c])}
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
