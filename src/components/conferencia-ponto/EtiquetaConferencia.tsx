import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { AlertTriangle, CheckCircle2, FileClock, Loader2, MessageSquareText, ScanSearch, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

// =====================================================================
// Etiqueta "Conferindo" da Conferência de Ponto (01/10/2026, mig 284)
//
// "Um botão que o usuário clique em CONFERINDO, só pra ficar com um status
// ali tipo uma etiqueta que o usuário está conferindo; ao clicar no card da
// etiqueta aparecem as opções e observação" (Pablo).
//
// É recado entre a equipe, não trava: não muda o status do fluxo, qualquer
// um das três telas troca ou tira, e a tela tira sozinha quando alguém age
// no contrato (ver `agir` no PainelConferenciaPonto). O banco guarda só o
// código do tipo; o rótulo mora aqui.
// =====================================================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as any;
export const TABELA_ETIQUETA = "SISTEMA_CONFERENCIA_PONTO_ETIQUETA";

export type TipoEtiqueta = "conferindo" | "aguardando_documentos" | "divergencia" | "conferido";
export interface Etiqueta {
  id: number; mes_referencia: string; contrato_empresa: number; contrato_filial: number;
  tipo: TipoEtiqueta; observacao: string | null; modulo: string | null;
  por_id: string | null; por_nome: string | null; created_at: string; updated_at: string;
}

const TIPOS: Record<TipoEtiqueta, { rotulo: string; frase: string; icone: typeof ScanSearch; cor: string; ponto: string }> = {
  conferindo:            { rotulo: "Conferindo",                     frase: "está conferindo",          icone: ScanSearch,    cor: "border-sky-200 bg-sky-50 text-sky-800 hover:bg-sky-100",             ponto: "bg-sky-500" },
  aguardando_documentos: { rotulo: "Aguardando",                     frase: "Aguardando",       icone: FileClock,     cor: "border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100",     ponto: "bg-amber-500" },
  divergencia:           { rotulo: "Com divergência",                frase: "achou divergência",        icone: AlertTriangle, cor: "border-rose-200 bg-rose-50 text-rose-800 hover:bg-rose-100",         ponto: "bg-rose-500" },
  conferido:             { rotulo: "Conferido | pronto pra enviar",  frase: "Conferido | pronto pra enviar", icone: CheckCircle2, cor: "border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100", ponto: "bg-emerald-500" },
};

const MODULO_ROTULO: Record<string, string> = { operacional: "Operacional", rh: "RH", financeiro: "Financeiro" };

function haQuanto(iso: string) {
  const min = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (min < 1) return "agora";
  if (min < 60) return `há ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `há ${h} h`;
  return `há ${Math.round(h / 24)} d`;
}
const primeiroNome = (n?: string | null) => {
  const p = String(n ?? "").trim().split(/\s+/).filter(Boolean);
  if (!p.length) return "Alguém";
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
  return p.length > 1 ? `${cap(p[0])} ${cap(p[p.length - 1])}` : cap(p[0]);
};

interface Props {
  etiqueta: Etiqueta | null;
  chave: { mes_referencia: string; contrato_empresa: number; contrato_filial: number };
  modulo: string;
  meuNome: string;
  meuId?: string | null;
  onMudou: () => void;
}

export function EtiquetaConferencia({ etiqueta, chave, modulo, meuNome, meuId, onMudou }: Props) {
  const [aberto, setAberto] = useState(false);
  const [tipo, setTipo] = useState<TipoEtiqueta>(etiqueta?.tipo ?? "conferindo");
  const [obs, setObs] = useState(etiqueta?.observacao ?? "");
  const [salvando, setSalvando] = useState(false);

  // Abriu o card: parte do que está gravado (pode ter mudado por outra pessoa).
  useEffect(() => {
    if (aberto) { setTipo(etiqueta?.tipo ?? "conferindo"); setObs(etiqueta?.observacao ?? ""); }
  }, [aberto]); // eslint-disable-line react-hooks/exhaustive-deps

  const gravar = async (t: TipoEtiqueta, observacao: string | null) => {
    setSalvando(true);
    const { error } = await sb.from(TABELA_ETIQUETA).upsert(
      { ...chave, tipo: t, observacao, modulo, por_nome: meuNome || null },
      { onConflict: "mes_referencia,contrato_empresa,contrato_filial" },
    );
    setSalvando(false);
    if (error) { toast.error("Não deu para salvar a etiqueta: " + error.message); return false; }
    onMudou();
    return true;
  };

  const tirar = async () => {
    if (!etiqueta) return;
    setSalvando(true);
    const { error } = await sb.from(TABELA_ETIQUETA).delete().eq("id", etiqueta.id);
    setSalvando(false);
    if (error) { toast.error("Não deu para tirar a etiqueta: " + error.message); return; }
    setAberto(false);
    onMudou();
  };

  // Sem etiqueta: o botão "Conferindo" marca na hora, sem abrir nada.
  if (!etiqueta) {
    return (
      <button
        type="button"
        disabled={salvando}
        onClick={e => { e.stopPropagation(); gravar("conferindo", null); }}
        className="mt-1 inline-flex items-center gap-1 rounded-full border border-dashed border-muted-foreground/30 px-2 py-0.5 text-[11px] font-medium text-muted-foreground transition-colors hover:border-sky-400 hover:bg-sky-50 hover:text-sky-700"
        title="Marcar que você está conferindo este contrato"
      >
        {salvando ? <Loader2 className="h-3 w-3 animate-spin" /> : <ScanSearch className="h-3 w-3" />}
        Conferindo
      </button>
    );
  }

  const T = TIPOS[etiqueta.tipo] ?? TIPOS.conferindo;
  const souEu = !!meuId && etiqueta.por_id === meuId;
  const quem = souEu ? "Você" : primeiroNome(etiqueta.por_nome);

  return (
    <Popover open={aberto} onOpenChange={setAberto}>
      <PopoverTrigger asChild>
        <button
          type="button"
          onClick={e => e.stopPropagation()}
          className={cn("mt-1 inline-flex max-w-full items-center gap-1.5 rounded-lg border px-2 py-1 text-left text-[11px] font-semibold shadow-sm transition-colors", T.cor)}
          title={etiqueta.observacao ? `Observação: ${etiqueta.observacao}` : "Abrir a etiqueta"}
        >
          <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", T.ponto, etiqueta.tipo === "conferindo" && "animate-pulse")} />
          <T.icone className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">{quem} {T.frase}</span>
          {etiqueta.observacao && <MessageSquareText className="h-3 w-3 shrink-0 opacity-70" />}
          <span className="shrink-0 font-normal opacity-60">· {haQuanto(etiqueta.updated_at)}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-0" onClick={e => e.stopPropagation()}>
        <div className="border-b px-4 py-3">
          <p className="text-sm font-semibold">Etiqueta de conferência</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {souEu ? "Você" : (etiqueta.por_nome || "Alguém")}
            {etiqueta.modulo ? ` · ${MODULO_ROTULO[etiqueta.modulo] ?? etiqueta.modulo}` : ""}
            {` · ${haQuanto(etiqueta.updated_at)}`}
          </p>
        </div>
        <div className="space-y-3 px-4 py-3">
          <div className="grid gap-1.5">
            {(Object.keys(TIPOS) as TipoEtiqueta[]).map(t => {
              const o = TIPOS[t];
              const sel = tipo === t;
              return (
                <button key={t} type="button" onClick={() => setTipo(t)}
                  className={cn("flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-left text-xs font-medium transition-colors",
                    sel ? o.cor + " ring-1 ring-current/20" : "border-border hover:bg-muted")}>
                  <o.icone className="h-3.5 w-3.5 shrink-0" />
                  <span className="flex-1">{o.rotulo}</span>
                  {sel && <CheckCircle2 className="h-3.5 w-3.5" />}
                </button>
              );
            })}
          </div>
          <div>
            <p className="mb-1 text-xs font-semibold">Observação</p>
            <Textarea value={obs} onChange={e => setObs(e.target.value)} rows={3} maxLength={500}
              placeholder="Ex.: falta a folha de 2 colaboradores; liguei para o supervisor." className="text-xs" />
          </div>
        </div>
        <div className="flex items-center justify-between gap-2 border-t px-4 py-2.5">
          <Button variant="ghost" size="sm" className="h-8 gap-1 text-xs text-muted-foreground hover:text-destructive"
            onClick={tirar} disabled={salvando}>
            <X className="h-3.5 w-3.5" /> Tirar etiqueta
          </Button>
          <Button size="sm" className="h-8 text-xs" disabled={salvando}
            onClick={async () => { if (await gravar(tipo, obs.trim() || null)) setAberto(false); }}>
            {salvando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : souEu || !etiqueta.por_id ? "Salvar" : "Salvar (assumir)"}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
