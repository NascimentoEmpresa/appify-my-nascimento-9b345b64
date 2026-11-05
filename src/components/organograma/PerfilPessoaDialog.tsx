import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ChevronRight, Loader2, MessageSquarePlus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import {
  COR_NATUREZA, fmtDataBr, funcaoDe, hojeLocal, ROTULO_NATUREZA, ROTULO_TIPO, TIPOS_REGISTRO,
  type Movimentacao, type Natureza, type NoPessoa,
} from "@/lib/organograma/pessoas";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as any;

interface Perfil {
  bio: string | null; pode_ver_historico: boolean; pode_registrar: boolean; contratos_extras: string[];
  cadeia: { id: string; nome: string }[]; liderados: { id: string; nome: string }[]; historico: Movimentacao[];
}

export function LinhaMovimentacao({ m, comPessoa = false }: { m: Movimentacao; comPessoa?: boolean }) {
  const mudanca = m.valor_antes || m.valor_depois;
  return (
    <li className="rounded-lg border bg-card p-2.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-bold uppercase", COR_NATUREZA[m.natureza])}>{ROTULO_TIPO[m.tipo] ?? m.tipo}</span>
        <span className="text-[11px] tabular-nums text-muted-foreground">{fmtDataBr(m.data_evento)}</span>
        {m.autor_nome && <span className="ml-auto truncate text-[11px] text-muted-foreground">por {m.autor_nome}</span>}
      </div>
      {comPessoa && <p className="mt-1 text-sm font-bold">{m.pessoa_nome}</p>}
      <p className="mt-1 text-sm font-semibold">{m.titulo}</p>
      {mudanca && <p className="text-xs text-muted-foreground">{m.valor_antes ? `${m.valor_antes} → ${m.valor_depois ?? "—"}` : m.valor_depois}</p>}
      {m.descricao && <p className="mt-0.5 whitespace-pre-wrap text-xs text-muted-foreground">{m.descricao}</p>}
      {m.contrato_nome && <p className="mt-0.5 truncate text-[11px] text-muted-foreground">Contrato: {m.contrato_nome}{m.setor ? ` · ${m.setor}` : ""}</p>}
    </li>
  );
}

function RegistrarMovimentacao({ noId, onSalvo }: { noId: string; onSalvo: () => void }) {
  const [tipo, setTipo] = useState("elogio");
  const [natureza, setNatureza] = useState<Natureza>("positiva");
  const [titulo, setTitulo] = useState("");
  const [descricao, setDescricao] = useState("");
  const [data, setData] = useState(hojeLocal());
  const [salvando, setSalvando] = useState(false);

  const trocarTipo = (t: string) => {
    setTipo(t);
    setNatureza(TIPOS_REGISTRO.find((x) => x.tipo === t)?.natureza ?? "neutra");
  };
  const salvar = async () => {
    if (!titulo.trim()) { toast.error("Diga o que aconteceu."); return; }
    setSalvando(true);
    const { error } = await sb.rpc("organograma_registrar_mov", {
      p_no: noId, p_tipo: tipo, p_natureza: natureza, p_titulo: titulo.trim(), p_descricao: descricao.trim() || null, p_data: data,
    });
    setSalvando(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Registrado no perfil.");
    setTitulo(""); setDescricao("");
    onSalvo();
  };

  return (
    <div className="space-y-2 rounded-xl border border-dashed border-primary/40 p-3">
      <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-primary"><MessageSquarePlus className="h-3.5 w-3.5" /> Registrar movimentação ou feedback</p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <select aria-label="Tipo" className="h-9 rounded-md border border-input bg-background px-2 text-sm" value={tipo} onChange={(e) => trocarTipo(e.target.value)}>
          {TIPOS_REGISTRO.map((t) => <option key={t.tipo} value={t.tipo}>{ROTULO_TIPO[t.tipo]}</option>)}
        </select>
        <select aria-label="Natureza" className="h-9 rounded-md border border-input bg-background px-2 text-sm" value={natureza} onChange={(e) => setNatureza(e.target.value as Natureza)}>
          {(Object.keys(ROTULO_NATUREZA) as Natureza[]).map((n) => <option key={n} value={n}>{ROTULO_NATUREZA[n]}</option>)}
        </select>
        <Input aria-label="Data" type="date" className="col-span-2 sm:col-span-1" value={data} max={hojeLocal()} onChange={(e) => setData(e.target.value)} />
      </div>
      <Input value={titulo} maxLength={140} onChange={(e) => setTitulo(e.target.value)} placeholder="O que aconteceu (ex.: Assumiu o posto na falta do colega)" />
      <Textarea value={descricao} rows={2} maxLength={1000} onChange={(e) => setDescricao(e.target.value)} placeholder="Detalhes (opcional)" />
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] text-muted-foreground">Advertência formal segue no Jurídico e aparece aqui sozinha.</p>
        <Button size="sm" onClick={salvar} disabled={salvando}>{salvando ? "Salvando…" : "Registrar"}</Button>
      </div>
    </div>
  );
}

export function PerfilPessoaDialog({ no, onFechar, onAbrirPessoa }: {
  no: NoPessoa; onFechar: () => void; onAbrirPessoa: (id: string) => void;
}) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["organograma-perfil", no.id],
    queryFn: async () => {
      const { data, error } = await sb.rpc("organograma_perfil", { p_no: no.id });
      if (error) throw error;
      return data as Perfil;
    },
  });
  const p = q.data;

  return (
    <Dialog open onOpenChange={(v) => !v && onFechar()}>
      <DialogContent className="max-h-[90vh] max-w-2xl grid-cols-[minmax(0,1fr)] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="pr-6">{no.nome}</DialogTitle>
          <DialogDescription>{[funcaoDe(no), no.setor].filter(Boolean).join(" · ") || "Sem cargo no cadastro"}</DialogDescription>
        </DialogHeader>

        <dl className="grid grid-cols-1 gap-x-4 gap-y-1.5 text-sm sm:grid-cols-2">
          <div><dt className="text-[11px] font-semibold uppercase text-muted-foreground">Contrato</dt><dd>{no.contrato || "—"}{p?.contratos_extras?.map((c) => <span key={c} className="block text-xs text-muted-foreground">também: {c}</span>)}</dd></div>
          <div><dt className="text-[11px] font-semibold uppercase text-muted-foreground">Posto</dt><dd>{no.posto_nome || no.posto_codigo || "—"}</dd></div>
          {no.superior_pendente && <div className="sm:col-span-2"><dd className="rounded-md bg-amber-100 px-2 py-1 text-xs font-semibold text-amber-900">Sem superior imediato definido.</dd></div>}
          {no.superior_origem !== "manual" && !no.superior_pendente && no.parent_id && <div className="sm:col-span-2"><dd className="text-xs text-muted-foreground">Superior sugerido automaticamente pelo {no.superior_origem === "posto" ? "posto" : "contrato"}, ainda não confirmado.</dd></div>}
        </dl>

        {q.isLoading && <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Carregando…</p>}
        {q.isError && <p className="text-sm text-destructive">{(q.error as Error).message}</p>}
        {p && (
          <>
            {p.bio && <div><p className="text-[11px] font-semibold uppercase text-muted-foreground">O que faz</p><p className="whitespace-pre-wrap text-sm">{p.bio}</p></div>}

            <div>
              <p className="mb-1 text-[11px] font-semibold uppercase text-muted-foreground">Linha de comando</p>
              {p.cadeia.length ? (
                <div className="flex flex-wrap items-center gap-1 text-sm">
                  {p.cadeia.map((c) => (
                    <span key={c.id} className="inline-flex items-center gap-1">
                      <button type="button" className="rounded px-1 font-medium text-primary hover:underline" onClick={() => onAbrirPessoa(c.id)}>{c.nome}</button>
                      <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                    </span>
                  ))}
                  <span className="px-1 font-semibold">{no.nome}</span>
                </div>
              ) : <p className="text-sm text-muted-foreground">Não reporta a ninguém.</p>}
            </div>

            {p.liderados.length > 0 && (
              <div>
                <p className="mb-1 text-[11px] font-semibold uppercase text-muted-foreground">Equipe direta ({p.liderados.length})</p>
                <div className="flex max-h-32 flex-wrap gap-1 overflow-y-auto">
                  {p.liderados.map((l) => (
                    <button key={l.id} type="button" onClick={() => onAbrirPessoa(l.id)} className="rounded-full border px-2 py-0.5 text-xs hover:bg-muted">{l.nome}</button>
                  ))}
                </div>
              </div>
            )}

            {p.pode_registrar && <RegistrarMovimentacao noId={no.id} onSalvo={() => { qc.invalidateQueries({ queryKey: ["organograma-perfil", no.id] }); qc.invalidateQueries({ queryKey: ["organograma-gestao"] }); }} />}

            {p.pode_ver_historico && (
              <div>
                <p className="mb-1.5 text-[11px] font-semibold uppercase text-muted-foreground">Histórico ({p.historico.length})</p>
                {p.historico.length ? (
                  <ul className="space-y-1.5">{p.historico.map((m) => <LinhaMovimentacao key={m.chave} m={m} />)}</ul>
                ) : <p className="text-sm text-muted-foreground">Nada registrado ainda.</p>}
              </div>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
