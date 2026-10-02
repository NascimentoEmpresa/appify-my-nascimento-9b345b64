import type { StatusDev } from "@/lib/sistemas/checklistModulos";
import { HEX_TOM } from "./ui";

// Rosca do "Status Geral" (módulos ou telas, pelo desenvolvimento). Fatia
// "Pendente de preenchimento" só aparece quando existe — no começo é tudo ela.

const FATIAS: { chave: StatusDev | "pendente"; rotulo: string; cor: string }[] = [
  { chave: "pronto", rotulo: "Liberados", cor: HEX_TOM.ok },
  { chave: "em_desenvolvimento", rotulo: "Em desenvolvimento", cor: HEX_TOM.andamento },
  { chave: "em_homologacao", rotulo: "Em homologação", cor: "#facc15" },
  { chave: "nao_iniciado", rotulo: "Não iniciados", cor: "#cbd5e1" },
  { chave: "pendente", rotulo: "Pendente de preenchimento", cor: "#e2e8f0" },
];

export function DonutStatusModulos({ porDev, total, unidade = "Módulos" }: {
  porDev: Record<StatusDev | "pendente", number>; total: number; unidade?: string;
}) {
  const R = 52, C = 2 * Math.PI * R;
  const fatias = FATIAS.filter((x) => x.chave !== "pendente" || porDev.pendente > 0);
  let acum = 0;
  return (
    <div className="flex flex-wrap items-center gap-6">
      <svg viewBox="0 0 140 140" className="h-40 w-40 shrink-0 -rotate-90" role="img" aria-label={`Status geral: ${total} ${unidade.toLowerCase()}`}>
        <circle cx="70" cy="70" r={R} fill="none" stroke="hsl(var(--muted))" strokeWidth="22" />
        {total > 0 && fatias.map((x) => {
          const v = porDev[x.chave];
          if (!v) return null;
          const len = (v / total) * C;
          const el = (
            <circle key={x.chave} cx="70" cy="70" r={R} fill="none" stroke={x.cor} strokeWidth="22"
              strokeDasharray={`${len} ${C - len}`} strokeDashoffset={-acum} />
          );
          acum += len;
          return el;
        })}
        <g className="rotate-90" style={{ transformOrigin: "70px 70px" }}>
          <text x="70" y="70" textAnchor="middle" className="fill-foreground" style={{ fontSize: 26, fontWeight: 800 }}>{total}</text>
          <text x="70" y="88" textAnchor="middle" className="fill-muted-foreground" style={{ fontSize: 11 }}>{unidade}</text>
        </g>
      </svg>
      <ul className="min-w-[200px] flex-1 space-y-2.5">
        {fatias.map((x) => (
          <li key={x.chave} className="flex items-center gap-2.5 text-[13px]">
            <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: x.cor }} />
            <span className="flex-1 text-foreground/90">{x.rotulo}</span>
            <span className="font-semibold tabular-nums">
              {porDev[x.chave]} <span className="font-normal text-muted-foreground">({total ? ((porDev[x.chave] / total) * 100).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : "0,0"}%)</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
