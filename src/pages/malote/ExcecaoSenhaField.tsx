import { useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, CheckCircle2, KeyRound, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { validarSenhaExcecao } from "@/hooks/useMaloteExcecao";
import { normalizarSenhaExcecao, restanteDaSenha, type ExcecaoValidada } from "./excecao/regras";

interface ExcecaoSenhaFieldProps {
  /** Exceção já validada e anexada a esta despesa (null = nenhuma). */
  validada: ExcecaoValidada | null;
  onValidada: (e: ExcecaoValidada | null) => void;
  /** A despesa já é exceção (edição de uma despesa antiga ou já liberada): só mostra o selo. */
  jaEhExcecao?: boolean;
  disabled?: boolean;
  // SIS-2026-0250: true quando a data de pagamento pedida é mais cedo que o prazo normal calculado pela
  // regra 1.1 — a partir daí a despesa só entra com a senha de uma exceção aprovada.
  foraDoPrazoInclusao?: boolean;
  prazoNormal?: string | null;
}

// SIS-2026-0668: substitui o antigo checkbox "Lançar como exceção". A exceção agora é PEDIDA antes
// (Malote › Solicitar Exceção), aprovada pelo aprovador das exceções, e a senha gerada é digitada aqui.
// Quem marca a exceção é o banco (gatilho malote_despesa_0_excecao_senha); esta tela só valida e avisa.
export function ExcecaoSenhaField({ validada, onValidada, jaEhExcecao, disabled, foraDoPrazoInclusao, prazoNormal }: ExcecaoSenhaFieldProps) {
  const [senha, setSenha] = useState("");
  const [validando, setValidando] = useState(false);
  const prazoNormalFmt = prazoNormal ? new Date(prazoNormal + "T00:00:00").toLocaleDateString("pt-BR") : null;

  async function validar() {
    const s = normalizarSenhaExcecao(senha);
    if (!s) {
      toast.error("Digite a senha da exceção.");
      return;
    }
    setValidando(true);
    try {
      const exc = await validarSenhaExcecao(s);
      onValidada(exc);
      setSenha("");
      toast.success(`Exceção ${exc.numero} validada.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível validar a senha.");
    } finally {
      setValidando(false);
    }
  }

  if (validada) {
    return (
      <div className="flex items-start gap-2 rounded-lg border border-emerald-300 bg-emerald-50 dark:bg-emerald-950/30 p-3 text-xs">
        <CheckCircle2 className="h-4 w-4 text-emerald-600 mt-0.5 shrink-0" />
        <div className="flex-1 space-y-0.5">
          <p className="font-medium text-emerald-800 dark:text-emerald-300">Exceção {validada.numero} liberada para esta despesa</p>
          <p className="text-emerald-800/80 dark:text-emerald-300/80">
            Vale para o pagamento em {validada.data_pagamento.split("-").reverse().join("/")}, até{" "}
            {Number(validada.valor).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}. A senha só é consumida quando você salvar a despesa
            {" "}(restam {restanteDaSenha(validada.senha_expira_em)}). Depois disso a despesa segue a aprovação normal.
          </p>
        </div>
        {!disabled && (
          <Button type="button" variant="ghost" size="icon" className="h-6 w-6" onClick={() => onValidada(null)} title="Remover a exceção desta despesa">
            <X className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
    );
  }

  if (jaEhExcecao) {
    return (
      <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-xs">
        <KeyRound className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
        <p className="text-destructive/90">Esta despesa foi lançada como <span className="font-medium">exceção</span>.</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {foraDoPrazoInclusao && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/30 p-3 text-xs">
          <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
          <p className="text-amber-800/80 dark:text-amber-300/80">
            A data de pagamento escolhida é mais cedo que o prazo normal de inclusão (regra 1.1
            {prazoNormalFmt && <> — hoje o prazo normal é <span className="font-medium">{prazoNormalFmt}</span></>}
            ). Informe a senha de uma exceção aprovada para continuar.
          </p>
        </div>
      )}
      <div className="rounded-lg border border-dashed border-input p-3 space-y-2">
        <div>
          <Label className="text-xs flex items-center gap-1.5"><KeyRound className="h-3.5 w-3.5" />Senha da exceção</Label>
          <p className="text-xs text-muted-foreground">
            Só preencha se esta despesa for uma exceção. Para pagar em dia bloqueado (feriado, recesso, fim de semana) ou fora do prazo normal a senha é <span className="font-medium">obrigatória</span>: peça a exceção em{" "}
            <Link to="/app/malote/excecao/solicitar" className="text-primary hover:underline">Solicitar Exceção</Link>. Depois da aprovação da diretoria financeira, informe aqui a senha.
          </p>
        </div>
        <div className="flex gap-2">
          <Input
            value={senha}
            onChange={(e) => setSenha(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void validar(); } }}
            placeholder="EXC-XXXXXX"
            className="max-w-56 font-mono uppercase"
            disabled={disabled || validando}
            autoComplete="off"
          />
          <Button type="button" variant="outline" onClick={() => void validar()} disabled={disabled || validando || !senha.trim()}>
            {validando ? "Validando…" : "Validar senha"}
          </Button>
        </div>
      </div>
    </div>
  );
}
