import { useHistoricoNfEmissao, useUsuariosAtivos } from "@/hooks/useNfEmissao";

export function HistoricoNfPainel({ nfEmissaoId }: { nfEmissaoId: string | null | undefined }) {
  const { data: logs = [] } = useHistoricoNfEmissao(nfEmissaoId);
  const { data: usuarios = [] } = useUsuariosAtivos();

  if (logs.length === 0) {
    return <p className="text-sm text-muted-foreground">Sem histórico ainda.</p>;
  }

  return (
    <div className="space-y-2">
      {logs.map((l) => {
        const nome = usuarios.find((u) => u.id === l.user_id)?.display_name ?? "Usuário";
        return (
          <div key={l.id} className="rounded-md border border-border px-3 py-2 text-xs">
            <span className="font-medium">{nome}</span>{" "}
            <span className="text-muted-foreground">{l.detalhe}</span>
            <p className="mt-0.5 text-[11px] text-muted-foreground">{new Date(l.created_at).toLocaleString("pt-BR")}</p>
          </div>
        );
      })}
    </div>
  );
}
