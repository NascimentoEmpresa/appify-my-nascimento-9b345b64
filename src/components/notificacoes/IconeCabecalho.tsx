// O ícone do cabeçalho do aviso (16/10/2026, Pablo: "deixa customizar essa cor
// e ícone aqui de cima"). A lista com os nomes mora em ICONES_CABECALHO
// (src/lib/notificacoes.ts); aqui só o desenho de cada um, para a lib não
// depender do lucide. "" (aviso antigo, coluna NULL) = o "!" de sempre.
import {
  AlertCircle, Bell, Cake, CalendarDays, Gift, Heart, Info, Megaphone, PartyPopper,
  ShieldCheck, Star, Trophy, type LucideIcon,
} from "lucide-react";
import { iconeCabecalhoDe } from "@/lib/notificacoes";

const DESENHO: Record<string, LucideIcon> = {
  "": AlertCircle,
  megafone: Megaphone,
  festa: PartyPopper,
  trofeu: Trophy,
  coracao: Heart,
  estrela: Star,
  calendario: CalendarDays,
  info: Info,
  escudo: ShieldCheck,
  presente: Gift,
  bolo: Cake,
  sino: Bell,
};

export function IconeCabecalho({ icone, className }: { icone: unknown; className?: string }) {
  const Desenho = DESENHO[iconeCabecalhoDe(icone)] ?? AlertCircle;
  return <Desenho className={className} aria-hidden="true" />;
}
