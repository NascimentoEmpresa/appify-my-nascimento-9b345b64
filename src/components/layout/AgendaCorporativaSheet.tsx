import { useMemo, useState } from "react";
import { Mail, Phone, MessageCircle, Search, Star } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useAgendaCorporativa, useAgendaFavoritos, type AgendaContato } from "@/hooks/useAgendaCorporativa";

// Máscara local de telefone BR — mesmo padrão inline já usado em
// src/components/admin/UsuariosReal.tsx (não existe componente de máscara
// compartilhado no projeto).
function maskFone(v: string): string {
  const d = v.replace(/\D/g, "").slice(0, 11);
  if (d.length <= 10) return d.replace(/(\d{2})(\d)/, "($1) $2").replace(/(\d{4})(\d)/, "$1-$2");
  return d.replace(/(\d{2})(\d)/, "($1) $2").replace(/(\d{5})(\d)/, "$1-$2");
}

function waLinkDe(telefone: string, nome: string | null): string | null {
  const d = telefone.replace(/\D/g, "");
  if (d.length < 10) return null;
  const num = d.startsWith("55") && d.length >= 12 ? d : "55" + d;
  const primeiroNome = (nome ?? "").trim().split(/\s+/)[0] || "";
  const msg = primeiroNome ? `Olá ${primeiroNome}, tudo bem?` : "Olá, tudo bem?";
  return `https://wa.me/${num}?text=${encodeURIComponent(msg)}`;
}

function iniciaisDe(nome: string | null, email: string | null): string {
  return (nome ?? email ?? "?").split(/\s+/).filter(Boolean).slice(0, 2).map((s) => s[0]).join("").toUpperCase();
}

type AgendaTab = "todos" | "favoritos" | "equipe";

export function AgendaCorporativaSheet({
  open,
  onOpenChange,
  userId,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  userId?: string;
}) {
  const [touched, setTouched] = useState(false);
  const [busca, setBusca] = useState("");
  const [tab, setTab] = useState<AgendaTab>("todos");

  if (open && !touched) setTouched(true);

  const agendaQ = useAgendaCorporativa(touched);
  const { favoritosSet, toggle } = useAgendaFavoritos(userId);

  const meusSetores = useMemo(() => {
    const eu = (agendaQ.data ?? []).find((c) => c.id === userId);
    return new Set(eu?.setores ?? []);
  }, [agendaQ.data, userId]);

  const filtrados = useMemo(() => {
    let base = agendaQ.data ?? [];
    if (tab === "favoritos") base = base.filter((c) => favoritosSet.has(c.id));
    if (tab === "equipe") base = base.filter((c) => c.id !== userId && c.setores.some((s) => meusSetores.has(s)));

    const q = busca.trim().toLowerCase();
    if (!q) return base;
    const qDigits = q.replace(/\D/g, "");
    return base.filter((c) => {
      const blob = `${c.display_name ?? ""} ${c.email ?? ""} ${c.cargo ?? ""} ${c.setores.join(" ")}`.toLowerCase();
      if (blob.includes(q)) return true;
      if (qDigits && (c.telefone ?? "").replace(/\D/g, "").includes(qDigits)) return true;
      return false;
    });
  }, [agendaQ.data, tab, busca, favoritosSet, meusSetores, userId]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-md">
        <SheetHeader className="border-b border-border bg-muted/30 px-5 py-4 text-left">
          <SheetTitle className="text-base">Agenda Corporativa</SheetTitle>
        </SheetHeader>

        <div className="border-b border-border px-5 py-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Pesquisar por nome, e-mail, telefone, setor..."
              className="pl-9"
            />
          </div>
          <Tabs value={tab} onValueChange={(v) => setTab(v as AgendaTab)} className="mt-3">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="todos">Todos</TabsTrigger>
              <TabsTrigger value="favoritos">Favoritos</TabsTrigger>
              <TabsTrigger value="equipe">Minha Equipe</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-3">
          {agendaQ.isLoading && (
            <p className="py-8 text-center text-sm text-muted-foreground">Carregando…</p>
          )}
          {!agendaQ.isLoading && filtrados.length === 0 && (
            <p className="py-8 text-center text-sm text-muted-foreground">Nenhum contato encontrado.</p>
          )}
          <ul className="space-y-2">
            {filtrados.map((c) => (
              <ContatoCard
                key={c.id}
                contato={c}
                favorito={favoritosSet.has(c.id)}
                onToggleFavorito={() => toggle.mutate({ contatoId: c.id, favoritar: !favoritosSet.has(c.id) })}
              />
            ))}
          </ul>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function ContatoCard({
  contato,
  favorito,
  onToggleFavorito,
}: {
  contato: AgendaContato;
  favorito: boolean;
  onToggleFavorito: () => void;
}) {
  const telefoneFormatado = contato.telefone ? maskFone(contato.telefone) : null;
  const waLink = contato.telefone ? waLinkDe(contato.telefone, contato.display_name) : null;

  return (
    <li className="rounded-lg border border-border bg-card p-3">
      <div className="flex items-start gap-3">
        {contato.avatar_url ? (
          <img src={contato.avatar_url} alt="" className="h-10 w-10 shrink-0 rounded-full object-cover" />
        ) : (
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-gradient-primary text-xs font-semibold text-primary-foreground">
            {iniciaisDe(contato.display_name, contato.email)}
          </div>
        )}

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <p className="truncate text-sm font-medium">{contato.display_name ?? "—"}</p>
            <button
              onClick={onToggleFavorito}
              aria-label={favorito ? "Remover dos favoritos" : "Adicionar aos favoritos"}
              className="shrink-0 text-muted-foreground hover:text-warning"
            >
              <Star className={cn("h-4 w-4", favorito && "fill-warning text-warning")} />
            </button>
          </div>

          {contato.cargo && <p className="truncate text-xs text-muted-foreground">{contato.cargo}</p>}

          {contato.setores.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1">
              {contato.setores.map((s) => (
                <Badge key={s} variant="secondary" className="text-[10px]">{s}</Badge>
              ))}
            </div>
          )}

          {contato.email && <p className="mt-1.5 truncate text-xs text-muted-foreground">{contato.email}</p>}
          {telefoneFormatado && <p className="text-xs text-muted-foreground">{telefoneFormatado}</p>}

          <div className="mt-2 flex items-center gap-1.5">
            {contato.email && (
              <a
                href={`mailto:${contato.email}`}
                title="Enviar e-mail"
                className="grid h-7 w-7 place-items-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground"
              >
                <Mail className="h-3.5 w-3.5" />
              </a>
            )}
            {contato.telefone && (
              <a
                href={`tel:+${contato.telefone.replace(/\D/g, "")}`}
                title="Ligar"
                className="grid h-7 w-7 place-items-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground"
              >
                <Phone className="h-3.5 w-3.5" />
              </a>
            )}
            {waLink && (
              <a
                href={waLink}
                target="_blank"
                rel="noopener noreferrer"
                title="WhatsApp"
                className="grid h-7 w-7 place-items-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground"
              >
                <MessageCircle className="h-3.5 w-3.5" />
              </a>
            )}
          </div>
        </div>
      </div>
    </li>
  );
}
