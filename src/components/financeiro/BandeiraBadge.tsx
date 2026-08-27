// SIS-2026-0224: mesma lógica de BancoBadge.tsx — prioriza o logo real do
// catálogo (malote_cartao_bandeira.logo_path); sem logo, cai numa pílula
// colorida nas cores reais de marca (fallback pra bandeira cadastrada sem
// upload ainda).
const ESTILO_FALLBACK: Record<string, { bg: string; fg: string }> = {
  visa: { bg: "#1A1F71", fg: "#ffffff" },
  mastercard: { bg: "#EB001B", fg: "#ffffff" },
  elo: { bg: "#000000", fg: "#FFCB05" },
  "american express": { bg: "#006FCF", fg: "#ffffff" },
  "diners club": { bg: "#0079BE", fg: "#ffffff" },
};

export function BandeiraBadge({ nome, logoUrl }: { nome: string; logoUrl?: string | null }) {
  if (logoUrl) {
    return <img src={logoUrl} alt={nome} title={nome} className="h-6 max-w-[64px] object-contain" />;
  }
  const { bg, fg } = ESTILO_FALLBACK[nome.toLowerCase()] ?? { bg: "#64748b", fg: "#ffffff" };
  return (
    <span
      className="inline-flex items-center rounded px-2 py-0.5 text-xs font-semibold leading-none"
      style={{ backgroundColor: bg, color: fg }}
    >
      {nome}
    </span>
  );
}
