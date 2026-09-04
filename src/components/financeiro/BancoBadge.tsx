import { cn } from "@/lib/utils";

// SIS-2026-0224: identificação visual do banco. Prioriza o logo real
// cadastrado no catálogo (malote_cartao_banco.logo_path, bucket público
// cartao-logos) — quando não tem logo (ex.: banco cadastrado sem upload),
// cai no círculo colorido com sigla, mesma ideia de "iniciais coloridas"
// usada em avatar de usuário.
const BANCOS_CONHECIDOS: { match: RegExp; sigla: string; bg: string; fg: string }[] = [
  { match: /banco do brasil|^bb$/i, sigla: "BB", bg: "#FFEF38", fg: "#0033A0" },
  { match: /ita[uú]/i, sigla: "Itaú", bg: "#EC7000", fg: "#ffffff" },
  { match: /bradesco/i, sigla: "Bra", bg: "#CC092F", fg: "#ffffff" },
  { match: /santander/i, sigla: "San", bg: "#EC0000", fg: "#ffffff" },
  { match: /caixa/i, sigla: "CEF", bg: "#0033A0", fg: "#F8971D" },
  { match: /sicredi/i, sigla: "Sicr", bg: "#7DB61C", fg: "#ffffff" },
  { match: /sicoob/i, sigla: "Sico", bg: "#00AE9D", fg: "#ffffff" },
  { match: /banrisul/i, sigla: "Banr", bg: "#004B8D", fg: "#ffffff" },
  { match: /nubank|nu\s?pagamentos/i, sigla: "Nu", bg: "#820AD1", fg: "#ffffff" },
  { match: /inter\b/i, sigla: "Inter", bg: "#FF7A00", fg: "#ffffff" },
  { match: /\bc6\b/i, sigla: "C6", bg: "#000000", fg: "#ffffff" },
  { match: /safra/i, sigla: "Safra", bg: "#1C3F94", fg: "#ffffff" },
  { match: /btg/i, sigla: "BTG", bg: "#0A0A0A", fg: "#ffffff" },
  { match: /mentore/i, sigla: "Men", bg: "#808080", fg: "#ffffff" },
  { match: /prospera/i, sigla: "Pro", bg: "#2E7D32", fg: "#ffffff" },
];

function estiloBanco(nome: string) {
  const conhecido = BANCOS_CONHECIDOS.find((b) => b.match.test(nome));
  if (conhecido) return conhecido;
  const inicial = nome.trim().slice(0, 2).toUpperCase() || "?";
  return { sigla: inicial, bg: "#64748b", fg: "#ffffff" };
}

// `showNome=false` (SIS-2026-0256, tabela do Débito Automático — tirar o
// nome por extenso pra encolher a coluna e sumir com o scroll lateral)
// mostra só o ícone/logo, com o nome só no `title` (tooltip nativo ao
// passar o mouse) — cada branch já tinha `title={nome}` no ícone, então só
// precisa deixar de renderizar o `<span>` de texto.
export function BancoBadge({
  nome,
  logoUrl,
  className,
  showNome = true,
}: {
  nome: string;
  logoUrl?: string | null;
  className?: string;
  showNome?: boolean;
}) {
  if (logoUrl) {
    return (
      <span className={cn("inline-flex items-center gap-2", className)}>
        <img src={logoUrl} alt={nome} className="h-6 w-6 shrink-0 rounded-full object-contain" title={nome} />
        {showNome && <span className="text-sm">{nome}</span>}
      </span>
    );
  }
  const { sigla, bg, fg } = estiloBanco(nome);
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <span
        className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[9px] font-bold leading-none"
        style={{ backgroundColor: bg, color: fg }}
        title={nome}
      >
        {sigla.length > 3 ? sigla.slice(0, 3) : sigla}
      </span>
      {showNome && <span className="text-sm">{nome}</span>}
    </span>
  );
}
