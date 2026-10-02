import { useMemo, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { BadgeCheck, CheckCircle2, Loader2, UserCheck, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogDescription, DialogHeader, DialogOverlay, DialogPortal, DialogTitle } from "@/components/ui/dialog";
import { cpfValido, maskCpf, nomeCompletoValido, soDigitos } from "@/lib/recrutamento/vagaRegras";
import { cn } from "@/lib/utils";

// =====================================================================
// CONCLUIR VAGA DIRETO (02/10/2026, mig 20260930000289)
//
// Pedido do Pablo: marcar a vaga como concluída e mandar quem foi contratado
// direto para a Admissão — com nome completo e CPF obrigatórios. Só aparece
// para quem tem "PODE CONCLUIR DIRETO" (Acesso por Usuário › Recrutamento e
// Seleção). Quem faz o trabalho é a RPC rec_concluir_direto: a vaga vira
// "Contratado" e a pessoa entra na etapa ADMISSÃO já enviada ao RH (cai em
// RH › Novas Admissões). Se a pessoa já era candidata da vaga (mesmo CPF), é
// ela que avança — por isso a lista de candidatos para preencher com um
// clique.
//
// Camada 1100, como os outros diálogos da Gestão Recrutamento: abre por cima
// da gaveta da vaga (.rec-drawer-ov, z-index 500), que cobriria o z-50 do
// DialogContent padrão.
// =====================================================================

const sb = supabase as unknown as SupabaseClient;

export interface VagaParaConcluir { id: number; cargo?: string | null; contrato?: string | null; cidade?: string | null }
export interface CandidatoParaConcluir { id: number; nome?: string | null; cpf?: string | null; etapa_processo?: string | null }

export function ModalConcluirDireto({ vaga, candidatos, onFechar, onConcluida }: {
  vaga: VagaParaConcluir;
  candidatos: CandidatoParaConcluir[];
  onFechar: () => void;
  onConcluida: (nome: string) => void;
}) {
  const [nome, setNome] = useState("");
  const [cpf, setCpf] = useState("");
  const [tocado, setTocado] = useState({ nome: false, cpf: false });
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  // Candidatos da vaga com CPF, os mais adiantados primeiro (reprovado fica de fora).
  const sugestoes = useMemo(() => candidatos
    .filter((c) => c.nome && soDigitos(c.cpf).length === 11 && c.etapa_processo !== "Reprovado")
    .slice(0, 6), [candidatos]);

  const nomeOk = nomeCompletoValido(nome);
  const cpfOk = cpfValido(cpf);
  const escolhido = sugestoes.find((c) => soDigitos(c.cpf) === soDigitos(cpf));

  const concluir = async () => {
    setTocado({ nome: true, cpf: true });
    if (!nomeOk || !cpfOk) return;
    setSalvando(true); setErro(null);
    const { error } = await sb.rpc("rec_concluir_direto", { p_vaga: vaga.id, p_nome: nome.trim(), p_cpf: soDigitos(cpf) });
    setSalvando(false);
    if (error) { setErro(error.message); return; }
    onConcluida(nome.trim().toUpperCase());
  };

  return (
    <Dialog open onOpenChange={(v) => !v && !salvando && onFechar()}>
      <DialogPortal>
      <DialogOverlay className="z-[1100]" />
      <DialogPrimitive.Content
        className="fixed left-1/2 top-1/2 z-[1101] grid max-h-[calc(100vh-2rem)] w-[calc(100vw-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 gap-4 overflow-y-auto rounded-xl border bg-background p-6 shadow-2xl data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95">
        <DialogPrimitive.Close disabled={salvando} className="absolute right-4 top-4 rounded-sm opacity-70 transition-opacity hover:opacity-100 disabled:pointer-events-none" aria-label="Fechar">
          <X className="h-4 w-4" />
        </DialogPrimitive.Close>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 text-emerald-600" /> Concluir vaga #{vaga.id}
          </DialogTitle>
          <DialogDescription>
            {[vaga.cargo, vaga.contrato, vaga.cidade].filter(Boolean).join(" · ")}
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-xs text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">
          A vaga é encerrada como <b>Contratado</b> e quem foi contratado vai <b>direto para a Admissão</b>
          (RH › Novas Admissões), sem passar pelas etapas do processo seletivo.
        </div>

        {sugestoes.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-xs font-semibold text-muted-foreground">É um dos candidatos desta vaga? Clique para preencher:</p>
            <div className="flex flex-wrap gap-1.5">
              {sugestoes.map((c) => (
                <button key={c.id} type="button"
                  onClick={() => { setNome(c.nome ?? ""); setCpf(maskCpf(c.cpf)); setTocado({ nome: true, cpf: true }); setErro(null); }}
                  className={cn("rounded-full border px-2.5 py-1 text-xs font-medium transition hover:border-primary hover:text-primary",
                    escolhido?.id === c.id ? "border-primary bg-primary/10 text-primary" : "border-border text-foreground")}>
                  {c.nome}{c.etapa_processo ? <span className="ml-1 text-[10px] text-muted-foreground">· {c.etapa_processo}</span> : null}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="cd-nome">Nome completo de quem foi contratado *</Label>
            <Input id="cd-nome" autoFocus value={nome} maxLength={120} placeholder="Ex.: Maria Aparecida da Silva"
              className="uppercase placeholder:normal-case"
              onChange={(e) => { setNome(e.target.value); setErro(null); }}
              onBlur={() => setTocado((t) => ({ ...t, nome: true }))}
              aria-invalid={tocado.nome && !nomeOk} />
            {tocado.nome && !nomeOk && <p className="text-xs text-destructive">Informe nome e sobrenome.</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cd-cpf">CPF *</Label>
            <Input id="cd-cpf" inputMode="numeric" value={cpf} placeholder="000.000.000-00" className="w-48 tabular-nums"
              onChange={(e) => { setCpf(maskCpf(e.target.value)); setErro(null); }}
              onBlur={() => setTocado((t) => ({ ...t, cpf: true }))}
              aria-invalid={tocado.cpf && !cpfOk} />
            {tocado.cpf && !cpfOk && <p className="text-xs text-destructive">CPF inválido — confira os 11 dígitos.</p>}
            {escolhido && cpfOk && (
              <p className="flex items-center gap-1 text-xs text-emerald-700 dark:text-emerald-400">
                <BadgeCheck className="h-3.5 w-3.5" /> Já é candidato desta vaga — ele mesmo avança para a Admissão.
              </p>
            )}
          </div>
        </div>

        {erro && <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{erro}</p>}

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="outline" onClick={onFechar} disabled={salvando}>Cancelar</Button>
          <Button onClick={concluir} disabled={salvando} className="gap-1.5 bg-emerald-600 text-white hover:bg-emerald-700">
            {salvando ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserCheck className="h-4 w-4" />}
            Concluir e enviar à Admissão
          </Button>
        </div>
      </DialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  );
}
