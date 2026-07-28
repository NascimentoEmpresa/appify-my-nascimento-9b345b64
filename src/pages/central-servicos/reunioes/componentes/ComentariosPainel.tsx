import { useState } from "react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Trash2 } from "lucide-react";
import { nomeUsuario, type ReuniaoComentario, type Usuario } from "../types";

function iniciais(nome: string): string {
  return nome.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join("");
}

// Comentário lateral — entra na seção "Encaminhamentos" do PDF final da ata.
export function ComentariosPainel({
  comentarios, usuarios, userId, podeGerenciar, onComentar, onRemoverComentario,
}: {
  comentarios: ReuniaoComentario[];
  usuarios: Usuario[];
  userId?: string;
  podeGerenciar: boolean;
  onComentar: (texto: string) => Promise<boolean>;
  onRemoverComentario: (id: string) => Promise<boolean>;
}) {
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);

  const enviar = async () => {
    if (!texto.trim()) return;
    setEnviando(true);
    const ok = await onComentar(texto.trim());
    if (ok) setTexto("");
    setEnviando(false);
  };

  return (
    <div className="flex h-[420px] min-h-0 min-w-0 flex-col">
      <p className="mb-2 shrink-0 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Encaminhamentos
      </p>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
        {comentarios.map((c) => {
          const nome = nomeUsuario(usuarios, c.autor_id) ?? "Usuário";
          const podeExcluir = podeGerenciar || c.autor_id === userId;
          return (
            <div key={c.id} className="flex items-start gap-2">
              <Avatar className="h-6 w-6 shrink-0">
                <AvatarFallback className="text-[9px]">{iniciais(nome)}</AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <p className="text-[11px]">
                  <span className="font-medium">{nome}</span>
                  <span className="ml-1.5 text-muted-foreground">{new Date(c.created_at).toLocaleString("pt-BR")}</span>
                </p>
                <p className="break-words text-xs">{c.texto}</p>
              </div>
              {podeExcluir && (
                <Button size="icon" variant="ghost" className="h-5 w-5 shrink-0" onClick={() => onRemoverComentario(c.id)}>
                  <Trash2 className="h-3 w-3" />
                </Button>
              )}
            </div>
          );
        })}
        {comentarios.length === 0 && <p className="text-[11px] text-muted-foreground">Nenhum comentário ainda.</p>}
      </div>
      <div className="mt-3 flex shrink-0 items-center gap-2">
        <Input
          placeholder="Comentar..."
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && enviar()}
          className="text-xs"
        />
        <Button size="sm" variant="ghost" onClick={enviar} disabled={!texto.trim() || enviando}>
          Enviar
        </Button>
      </div>
    </div>
  );
}
