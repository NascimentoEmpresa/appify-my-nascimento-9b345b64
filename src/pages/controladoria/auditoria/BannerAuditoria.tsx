import { Link } from "react-router-dom";
import { AlertTriangle, CheckCircle2, ShieldAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { statusGeral } from "./regras";
import { useStatusPeriodoAuditoria } from "./useAuditoriaValidacoes";

// SIS-2026-0553: checkpoint oficial antes da Lucratividade. Só ALERTA — não
// bloqueia (decisão: o bloqueio pode virar configuração depois, com o Setor de
// Sistemas). Mostra o Status Geral do período e, quando as 7 validações estão
// aprovadas, o carimbo de quem validou e quando. Não revela valores.
export function BannerAuditoria({ mes, empresaId }: { mes: string; empresaId: string | null }) {
  const { data } = useStatusPeriodoAuditoria(mes, empresaId);
  // null = migration ainda não aplicada neste ambiente; undefined = carregando.
  if (!data) return null;

  const resumo = statusGeral(data);
  const completo = resumo.aprovadas === resumo.total;
  const ultima = data.filter((v) => v.decidido_em).sort((a, b) => (b.decidido_em ?? "").localeCompare(a.decidido_em ?? ""))[0];

  const link = (
    <Link to="/app/controladoria/auditoria" className="underline underline-offset-2 font-medium whitespace-nowrap">Abrir a Auditoria da Controladoria</Link>
  );

  if (completo) {
    return (
      <div className="rounded-md border border-emerald-300 bg-emerald-50 text-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200 dark:border-emerald-900 p-3 text-sm flex items-start gap-2">
        <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" />
        <p>
          Valores deste período validados pela Controladoria (7 de 7 validações aprovadas)
          {ultima?.decidido_em ? <> — última aprovação em {new Date(ultima.decidido_em).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })} por {ultima.decidido_por_nome ?? "—"}</> : null}. {link}
        </p>
      </div>
    );
  }

  const rejeitou = resumo.rejeitadas > 0;
  const Icone = rejeitou ? ShieldAlert : AlertTriangle;
  return (
    <div className={cn("rounded-md border p-3 text-sm flex items-start gap-2", rejeitou
      ? "border-red-300 bg-red-50 text-red-900 dark:bg-red-950/30 dark:text-red-200 dark:border-red-900"
      : "border-amber-300 bg-amber-50 text-amber-900 dark:bg-amber-950/30 dark:text-amber-200 dark:border-amber-900")}>
      <Icone className="h-4 w-4 mt-0.5 shrink-0" />
      <p>
        <strong>Valores ainda não validados pela Controladoria:</strong> {resumo.aprovadas} aprovada(s), {resumo.pendentes} pendente(s) e {resumo.rejeitadas} rejeitada(s) de {resumo.total} validações neste período.
        {" "}Os números abaixo podem mudar até o fechamento. {link}
      </p>
    </div>
  );
}
