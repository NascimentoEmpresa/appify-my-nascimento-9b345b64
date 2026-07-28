import { Button } from "@/components/ui/button";
import { nomeUsuario, type ReuniaoConvidado, type Usuario } from "../types";

export function PresencaConducaoPainel({
  convidados, usuarios, userId, podeGerenciar, onMarcar,
}: {
  convidados: ReuniaoConvidado[];
  usuarios: Usuario[];
  userId: string | undefined;
  podeGerenciar: boolean;
  onMarcar: (convidadoId: string, presente: boolean, nome?: string) => void;
}) {
  const presentes = convidados.filter((c) => c.presente === true).length;
  const ausentes = convidados.filter((c) => c.presente === false).length;

  return (
    <div className="space-y-2">
      <p className="text-sm font-semibold">Participantes ({convidados.length})</p>
      <p className="text-xs text-muted-foreground">Presentes: {presentes} · Ausentes: {ausentes}</p>
      <div className="space-y-1">
        {convidados.map((c) => {
          const nome = nomeUsuario(usuarios, c.user_id) ?? c.user_id ?? "Usuário";
          const podeMarcar = podeGerenciar || c.user_id === userId;
          return (
            <div key={c.id} className="flex items-center justify-between gap-2 rounded border border-border px-2 py-1.5 text-sm">
              <span className="min-w-0 truncate">
                {nome}
                {c.papel === "observador" && <span className="ml-1 text-xs text-muted-foreground">(observador)</span>}
                {c.presente_marcado_em && (
                  <span className="block text-[10px] text-muted-foreground">
                    Confirmado em {new Date(c.presente_marcado_em).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}
                  </span>
                )}
              </span>
              {podeMarcar ? (
                <div className="flex shrink-0 gap-1">
                  <Button type="button" size="sm" variant={c.presente === true ? "default" : "outline"} onClick={() => onMarcar(c.id, true, nome)}>
                    Presente
                  </Button>
                  <Button type="button" size="sm" variant={c.presente === false ? "destructive" : "outline"} onClick={() => onMarcar(c.id, false, nome)}>
                    Ausente
                  </Button>
                </div>
              ) : (
                <span className="shrink-0 text-xs text-muted-foreground">
                  {c.presente === true ? "Presente" : c.presente === false ? "Ausente" : "—"}
                </span>
              )}
            </div>
          );
        })}
        {convidados.length === 0 && <p className="text-xs text-muted-foreground">Nenhum participante adicionado.</p>}
      </div>
    </div>
  );
}
