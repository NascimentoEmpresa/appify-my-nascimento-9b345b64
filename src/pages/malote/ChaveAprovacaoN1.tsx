import { useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, KeyRound } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useMinhasExcecoes, useN1ForaDoPrazo, useSolicitarExcecaoAprovacao } from "@/hooks/useMaloteExcecao";
import { pedidoDeAprovacaoDaDespesa, restanteDaSenha, STATUS_EXCECAO_BADGE, STATUS_EXCECAO_LABEL, statusExibidoExcecao } from "./excecao/regras";

interface ChaveAprovacaoN1Props {
  despesaId: string;
  userId: string | null | undefined;
  /** Horário 1.1 das Configurações (HH:MM), só para o texto. */
  horario?: string | null;
  senha: string;
  onSenha: (s: string) => void;
  disabled?: boolean;
}

// Malote: depois do horário 1.1 o Nível 1 só aprova com a senha de uma exceção de aprovação daquela despesa. A regra de verdade mora
// no banco (malote_aprovar_despesa, migration 20261020000130); aqui o aprovador vê o aviso, pede a chave e digita a senha.
// Só aparece quando o relógio do banco já passou do horário; antes disso (ou antes da migration) não renderiza nada.
export function ChaveAprovacaoN1({ despesaId, userId, horario, senha, onSenha, disabled }: ChaveAprovacaoN1Props) {
  const { data: foraDoPrazo } = useN1ForaDoPrazo();
  const { data: minhas = [] } = useMinhasExcecoes(userId);
  const solicitar = useSolicitarExcecaoAprovacao();
  const [abrir, setAbrir] = useState(false);
  const [justificativa, setJustificativa] = useState("");

  if (!foraDoPrazo) return null;

  const pedido = pedidoDeAprovacaoDaDespesa(minhas, despesaId);
  const status = pedido ? statusExibidoExcecao(pedido) : null;
  const horarioFmt = horario ? horario.slice(0, 5) : "o horário";

  async function enviarPedido() {
    if (!justificativa.trim()) {
      toast.error("Informe por que a aprovação precisa sair do prazo.");
      return;
    }
    try {
      await solicitar.mutateAsync({ despesaId, justificativa: justificativa.trim() });
      toast.success("Chave solicitada. Quando for aprovada, a senha aparece aqui.");
      setAbrir(false);
      setJustificativa("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível solicitar a chave.");
    }
  }

  return (
    <div className="sm:col-span-3 space-y-2">
      <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/30 p-3 text-xs">
        <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
        <p className="text-amber-800/90 dark:text-amber-300/90">
          Já passou das <span className="font-medium">{horarioFmt}</span> (regra 1.1). Depois desse horário o Nível 1 só aprova com a senha de uma{" "}
          <span className="font-medium">exceção de aprovação</span> desta despesa. Peça a chave abaixo; quem decide as exceções do Malote libera a senha e ela vale 24 horas.
        </p>
      </div>

      <div className="rounded-lg border border-dashed border-input p-3 space-y-2">
        <Label className="text-xs flex items-center gap-1.5"><KeyRound className="h-3.5 w-3.5" />Senha da exceção de aprovação</Label>

        {pedido && status && (
          <p className="text-xs text-muted-foreground flex flex-wrap items-center gap-2">
            <span>Pedido {pedido.numero}:</span>
            <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${STATUS_EXCECAO_BADGE[status]}`}>{STATUS_EXCECAO_LABEL[status]}</span>
            {status === "aprovada" && pedido.senha && (
              <>
                <span>senha</span>
                <button
                  type="button"
                  className="font-mono rounded bg-muted px-1.5 py-0.5 hover:bg-muted/70"
                  title="Usar esta senha"
                  onClick={() => onSenha(pedido.senha as string)}
                  disabled={disabled}
                >
                  {pedido.senha}
                </button>
                <span>(restam {restanteDaSenha(pedido.senha_expira_em)})</span>
              </>
            )}
            {status === "reprovada" && pedido.motivo_decisao && <span>— {pedido.motivo_decisao}</span>}
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          <Input
            value={senha}
            onChange={(e) => onSenha(e.target.value)}
            placeholder="EXC-XXXXXX"
            className="max-w-56 font-mono uppercase"
            disabled={disabled}
            autoComplete="off"
          />
          {(!pedido || status === "reprovada" || status === "expirada" || status === "cancelada") && (
            <Button type="button" variant="outline" onClick={() => setAbrir(true)} disabled={disabled}>
              Solicitar exceção de aprovação
            </Button>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          O acompanhamento também fica em <Link to="/app/malote/excecao/solicitar" className="text-primary hover:underline">Solicitar Exceção</Link>.
        </p>
      </div>

      <Dialog open={abrir} onOpenChange={setAbrir}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Solicitar exceção de aprovação</DialogTitle>
            <DialogDescription>
              Explique por que esta despesa precisa ser aprovada no Nível 1 depois das {horarioFmt}. O pedido vai para quem decide as exceções do Malote.
            </DialogDescription>
          </DialogHeader>
          <Textarea value={justificativa} onChange={(e) => setJustificativa(e.target.value)} rows={4} placeholder="Justificativa" />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setAbrir(false)}>Cancelar</Button>
            <Button type="button" onClick={() => void enviarPedido()} disabled={solicitar.isPending}>
              {solicitar.isPending ? "Enviando…" : "Enviar pedido"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
