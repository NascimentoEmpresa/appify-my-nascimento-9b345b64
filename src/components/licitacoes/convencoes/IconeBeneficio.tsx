import {
  Baby, Bus, Coffee, Heart, ShieldAlert, ShoppingBasket, TriangleAlert, Trophy, UserRound, UtensilsCrossed,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { ChaveBeneficio } from "@/lib/licitacoes/convencoes";

// Ícone e cor de cada benefício — os mesmos no cadastro da convenção e no
// quadro da vaga (layout de referência do chamado).
const VISUAL: Record<ChaveBeneficio, { icone: LucideIcon; cor: string; fundo: string }> = {
  va:              { icone: UtensilsCrossed, cor: "text-emerald-600", fundo: "bg-emerald-50 dark:bg-emerald-950/40" },
  vl:              { icone: Coffee,          cor: "text-violet-600",  fundo: "bg-violet-50 dark:bg-violet-950/40" },
  vt:              { icone: Bus,             cor: "text-blue-600",    fundo: "bg-blue-50 dark:bg-blue-950/40" },
  insalubridade:   { icone: TriangleAlert,   cor: "text-rose-600",    fundo: "bg-rose-50 dark:bg-rose-950/40" },
  periculosidade:  { icone: ShieldAlert,     cor: "text-amber-600",   fundo: "bg-amber-50 dark:bg-amber-950/40" },
  assiduidade:     { icone: Trophy,          cor: "text-amber-500",   fundo: "bg-amber-50 dark:bg-amber-950/40" },
  cesta_basica:    { icone: ShoppingBasket,  cor: "text-green-600",   fundo: "bg-green-50 dark:bg-green-950/40" },
  plano_saude:     { icone: Heart,           cor: "text-pink-600",    fundo: "bg-pink-50 dark:bg-pink-950/40" },
  auxilio_creche:  { icone: Baby,            cor: "text-purple-600",  fundo: "bg-purple-50 dark:bg-purple-950/40" },
  adicional_lider: { icone: UserRound,       cor: "text-orange-600",  fundo: "bg-orange-50 dark:bg-orange-950/40" },
};

export function IconeBeneficio({ chave, tamanho = "md" }: { chave: ChaveBeneficio; tamanho?: "sm" | "md" }) {
  const v = VISUAL[chave];
  const Icone = v.icone;
  return (
    <span className={cn("inline-flex shrink-0 items-center justify-center rounded-lg", v.fundo,
      tamanho === "md" ? "h-11 w-11" : "h-6 w-6 rounded-md")}>
      <Icone className={cn(v.cor, tamanho === "md" ? "h-5 w-5" : "h-3.5 w-3.5")} aria-hidden />
    </span>
  );
}
