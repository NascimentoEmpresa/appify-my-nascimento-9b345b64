import { useState } from "react";
import { toast } from "sonner";
import { Check, Copy, Eye, EyeOff, KeyRound } from "lucide-react";
import { copiar, useConfirmarEntregaLogin, useMinhasCredenciais } from "@/hooks/useLoginsSistemas";

// =====================================================================
// SIS-2026-0598 (mig 20261006000009) — em Minhas Solicitações, para QUEM
// PEDIU A VAGA: o login do encarregado novo que o setor de Sistemas criou.
// A RPC só devolve as vagas da pessoa logada. "Já repassei" apaga a senha
// do banco — ela só existe aqui até ser entregue.
// Sem login pronto, não aparece nada.
// =====================================================================

export function CredenciaisProntas() {
  const { data: lista = [] } = useMinhasCredenciais();
  const confirmar = useConfirmarEntregaLogin();
  const [mostrar, setMostrar] = useState<Record<string, boolean>>({});
  if (!lista.length) return null;

  const copiarTudo = async (c: (typeof lista)[number]) => {
    const texto = `Acesso ao ERP — ${c.nome}\nLogin: ${c.login_email}\nSenha: ${c.senha ?? ""}`;
    (await copiar(texto)) ? toast.success("Login e senha copiados.") : toast.error("Não deu para copiar — selecione e copie à mão.");
  };

  return (
    <div className="mb-4 rounded-2xl border-2 border-emerald-300 bg-emerald-50 p-4">
      <div className="mb-3 flex items-center gap-2">
        <KeyRound className="h-5 w-5 text-emerald-700" />
        <h3 className="text-base font-extrabold text-emerald-900">Login pronto para repassar</h3>
      </div>
      <p className="mb-3 text-xs text-emerald-900/80">
        O setor de Sistemas criou o acesso ao ERP do encarregado da vaga que você pediu. Copie e envie para ele; depois toque em <b>Já repassei</b> — a senha deixa de ficar guardada.
      </p>
      <div className="grid gap-3 md:grid-cols-2">
        {lista.map((c) => (
          <div key={c.id} className="space-y-2 rounded-xl border border-emerald-200 bg-white p-3">
            <div>
              <p className="font-bold">{c.nome}</p>
              <p className="text-xs text-slate-500">{[c.cargo, c.contrato].filter(Boolean).join(" · ")}{c.vaga_id ? ` · vaga #${c.vaga_id}` : ""}</p>
            </div>
            <Campo rotulo="Login" valor={c.login_email} />
            <Campo rotulo="Senha" valor={c.senha ?? ""} oculto={!mostrar[c.id]}
              extra={<button type="button" className="text-slate-500" onClick={() => setMostrar((m) => ({ ...m, [c.id]: !m[c.id] }))} aria-label="Mostrar senha">
                {mostrar[c.id] ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button>} />
            <div className="flex flex-wrap gap-2 pt-1">
              <button type="button" onClick={() => copiarTudo(c)} className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-700">
                <Copy className="h-3.5 w-3.5" /> Copiar login e senha
              </button>
              <button type="button" disabled={confirmar.isPending}
                onClick={async () => {
                  if (!window.confirm(`Já enviou o login e a senha para ${c.nome}? A senha deixa de aparecer aqui.`)) return;
                  try { await confirmar.mutateAsync(c.id); toast.success("Anotado — obrigado!"); } catch (e) { toast.error((e as Error).message); }
                }}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-60">
                <Check className="h-3.5 w-3.5" /> Já repassei
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Campo({ rotulo, valor, oculto, extra }: { rotulo: string; valor: string; oculto?: boolean; extra?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 rounded-lg bg-slate-50 px-2 py-1.5">
      <span className="w-12 shrink-0 text-[11px] font-semibold uppercase text-slate-500">{rotulo}</span>
      <span className="min-w-0 flex-1 truncate font-mono text-sm font-semibold">{oculto ? "••••••••••" : valor}</span>
      {extra}
      <button type="button" className="text-slate-500 hover:text-slate-900" aria-label={`Copiar ${rotulo}`}
        onClick={async () => (await copiar(valor)) ? toast.success(`${rotulo} copiado.`) : toast.error("Não deu para copiar.")}>
        <Copy className="h-4 w-4" />
      </button>
    </div>
  );
}
