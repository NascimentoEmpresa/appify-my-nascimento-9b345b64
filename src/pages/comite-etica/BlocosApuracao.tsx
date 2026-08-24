import { useCallback, useEffect, useRef, useState } from "react";
import { db } from "./db";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Plus, Trash2, Paperclip, Upload, Download, ShieldAlert, ShieldOff,
  Loader2, CalendarClock, CheckCircle2, Gavel,
} from "lucide-react";
import {
  CATEGORIA_ANEXO, DECISAO_SOBRE_PARECER, SITUACAO_PROVIDENCIA,
  LABEL_CATEGORIA_ANEXO, LABEL_SIT_PROVIDENCIA, rotulo,
} from "./vocabulario";
import { fmtData, fmtDataHora, bytesLegivel } from "./dossie";
import type { Anexo, Denuncia, Providencia } from "./metricas";

// =====================================================================
// COMITÊ DE ÉTICA — os três blocos que faltavam na ficha
//
//   · Providências — lista com prazo e responsável, no lugar do campo único
//     "primeira providência" que só guardava uma data.
//   · Anexos       — os arquivos do procedimento, com marcação de sigiloso.
//   · Presidência  — a decisão final, atrás de capacidade própria.
//
// Ficam num arquivo só porque são as três caixas de baixo da mesma ficha e
// dividem o mesmo jeito de salvar: gravam sozinhas, na hora, sem esperar o
// "Salvar ficha". Providência com prazo que se perde porque a pessoa fechou
// o diálogo é pior do que providência nenhuma.
// =====================================================================

const BUCKET = "denuncia-evidencias";

function Titulo({ children, icone: Icone }: { children: React.ReactNode; icone: typeof Plus }) {
  return (
    <h4 className="mb-3 flex items-center gap-2 text-sm font-semibold">
      <Icone className="h-4 w-4 text-muted-foreground" /> {children}
    </h4>
  );
}

// ------------------------------------------------------------ Providências

export function BlocoProvidencias({ denunciaId, podeEditar }: {
  denunciaId: string; podeEditar: boolean;
}) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [itens, setItens] = useState<Providencia[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [nova, setNova] = useState({ descricao: "", responsavel: "", prazo: "" });
  const [salvando, setSalvando] = useState(false);

  const carregar = useCallback(async () => {
    const { data } = await db.from("CANAL_DENUNCIA_PROVIDENCIA")
      .select("*").eq("denuncia_id", denunciaId).order("ordem");
    setItens((data ?? []) as Providencia[]);
    setCarregando(false);
  }, [denunciaId]);

  useEffect(() => { carregar(); }, [carregar]);

  const adicionar = async () => {
    if (!nova.descricao.trim()) { toast({ title: "Descreva a providência.", variant: "destructive" }); return; }
    setSalvando(true);
    const { error } = await db.from("CANAL_DENUNCIA_PROVIDENCIA").insert({
      denuncia_id: denunciaId,
      ordem: (itens.at(-1)?.ordem ?? 0) + 1,
      descricao: nova.descricao.trim(),
      responsavel: nova.responsavel.trim() || null,
      prazo: nova.prazo || null,
      criado_por_nome: user?.user_metadata?.nome ?? user?.email ?? null,
    });
    setSalvando(false);
    if (error) { toast({ title: "Erro ao gravar", description: error.message, variant: "destructive" }); return; }
    setNova({ descricao: "", responsavel: "", prazo: "" });
    carregar();
  };

  const mudar = async (p: Providencia, patch: Partial<Providencia>) => {
    // Concluir carimba a data aqui, e não no banco: a pessoa pode voltar uma
    // providência para "em andamento", e um gatilho manteria a data antiga.
    const extra = patch.situacao === "concluida" && !p.concluida_em
      ? { concluida_em: new Date().toISOString() }
      : patch.situacao && patch.situacao !== "concluida" ? { concluida_em: null } : {};
    const { error } = await db.from("CANAL_DENUNCIA_PROVIDENCIA")
      .update({ ...patch, ...extra, updated_at: new Date().toISOString() }).eq("id", p.id);
    if (error) { toast({ title: "Erro ao salvar", description: error.message, variant: "destructive" }); return; }
    carregar();
  };

  const excluir = async (p: Providencia) => {
    if (!confirm(`Excluir a providência "${p.descricao}"?`)) return;
    const { error } = await db.from("CANAL_DENUNCIA_PROVIDENCIA").delete().eq("id", p.id);
    if (error) { toast({ title: "Erro ao excluir", description: error.message, variant: "destructive" }); return; }
    carregar();
  };

  const hoje = new Date().toISOString().slice(0, 10);

  return (
    <section>
      <Titulo icone={CalendarClock}>Providências</Titulo>

      {carregando ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : !itens.length ? (
        <p className="mb-3 text-sm text-muted-foreground">
          Nenhuma providência registrada. É desta lista que saem as datas e os prazos no relatório do procedimento.
        </p>
      ) : (
        <ul className="mb-3 flex flex-col gap-2">
          {itens.map((p) => {
            const atrasada = !!p.prazo && p.prazo < hoje
              && (p.situacao === "pendente" || p.situacao === "em_andamento");
            return (
              <li key={p.id} className="rounded-md border p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <p className="flex-1 text-sm font-medium">{p.ordem}. {p.descricao}</p>
                  <div className="flex items-center gap-2">
                    {atrasada && <Badge variant="destructive" className="text-[10px]">Vencida</Badge>}
                    {podeEditar ? (
                      <Select value={p.situacao} onValueChange={(v) => mudar(p, { situacao: v })}>
                        <SelectTrigger className="h-7 w-[150px] text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {SITUACAO_PROVIDENCIA.map((o) => (
                            <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <Badge variant="outline">{rotulo(LABEL_SIT_PROVIDENCIA, p.situacao)}</Badge>
                    )}
                    {podeEditar && (
                      <Button variant="ghost" size="icon" className="h-7 w-7"
                              onClick={() => excluir(p)} aria-label="Excluir providência">
                        <Trash2 className="h-3.5 w-3.5 text-destructive" />
                      </Button>
                    )}
                  </div>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {[
                    p.responsavel ? `Responsável: ${p.responsavel}` : null,
                    p.prazo ? `Prazo: ${fmtData(p.prazo)}` : null,
                    p.concluida_em ? `Concluída em ${fmtData(p.concluida_em)}` : null,
                    `Registrada por ${p.criado_por_nome ?? "—"} em ${fmtDataHora(p.created_at)}`,
                  ].filter(Boolean).join(" · ")}
                </p>
              </li>
            );
          })}
        </ul>
      )}

      {podeEditar && (
        <div className="grid gap-2 rounded-md border border-dashed p-3 sm:grid-cols-[1fr_180px_150px_auto]">
          <Input placeholder="O que será feito" value={nova.descricao}
                 onChange={(e) => setNova((n) => ({ ...n, descricao: e.target.value }))} />
          <Input placeholder="Responsável" value={nova.responsavel}
                 onChange={(e) => setNova((n) => ({ ...n, responsavel: e.target.value }))} />
          <Input type="date" value={nova.prazo}
                 onChange={(e) => setNova((n) => ({ ...n, prazo: e.target.value }))} />
          <Button onClick={adicionar} disabled={salvando} className="gap-1.5">
            {salvando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Incluir
          </Button>
        </div>
      )}
    </section>
  );
}

// ------------------------------------------------------------------ Anexos

export function BlocoAnexos({ denunciaId, podeEditar, podeVerSigiloso }: {
  denunciaId: string; podeEditar: boolean; podeVerSigiloso: boolean;
}) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [itens, setItens] = useState<Anexo[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [enviando, setEnviando] = useState(false);
  const [categoria, setCategoria] = useState("documento_suporte");
  const [sensivel, setSensivel] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const carregar = useCallback(async () => {
    const { data } = await db.from("CANAL_DENUNCIA_ANEXO")
      .select("*").eq("denuncia_id", denunciaId).order("created_at");
    setItens((data ?? []) as Anexo[]);
    setCarregando(false);
  }, [denunciaId]);

  useEffect(() => { carregar(); }, [carregar]);

  const enviar = async (arquivos: FileList | null) => {
    if (!arquivos?.length) return;
    setEnviando(true);
    let ok = 0;
    const falhas: string[] = [];

    for (const arq of Array.from(arquivos)) {
      const path = `${denunciaId}/comite/${crypto.randomUUID()}-${
        arq.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-120)}`;
      const { error: upErr } = await supabase.storage.from(BUCKET)
        .upload(path, arq, { contentType: arq.type || undefined, upsert: false });
      if (upErr) { falhas.push(`${arq.name}: ${upErr.message}`); continue; }

      const { error: insErr } = await db.from("CANAL_DENUNCIA_ANEXO").insert({
        denuncia_id: denunciaId,
        origem: "comite",
        categoria,
        nome_arquivo: arq.name.slice(0, 200),
        storage_path: path,
        mime_type: arq.type || null,
        tamanho_bytes: arq.size,
        sensivel,
        autor_user_id: user?.id ?? null,
        autor_nome: user?.user_metadata?.nome ?? user?.email ?? null,
      });
      // Linha sem arquivo é ruim; arquivo sem linha é pior — vira lixo
      // invisível no bucket, que ninguém encontra para apagar.
      if (insErr) {
        await supabase.storage.from(BUCKET).remove([path]);
        falhas.push(`${arq.name}: ${insErr.message}`);
        continue;
      }
      ok++;
    }

    setEnviando(false);
    if (inputRef.current) inputRef.current.value = "";
    if (ok) toast({ title: `${ok} arquivo(s) anexado(s).` });
    if (falhas.length) {
      toast({ title: "Alguns arquivos não subiram", description: falhas.join(" · "), variant: "destructive" });
    }
    carregar();
  };

  const baixar = async (a: Anexo) => {
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(a.storage_path, 300);
    if (error || !data?.signedUrl) {
      toast({ title: "Não foi possível abrir o arquivo", variant: "destructive" });
      return;
    }
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  };

  const alternarSigilo = async (a: Anexo) => {
    const { error } = await db.from("CANAL_DENUNCIA_ANEXO")
      .update({ sensivel: !a.sensivel }).eq("id", a.id);
    if (error) { toast({ title: "Erro", description: error.message, variant: "destructive" }); return; }
    carregar();
  };

  const doDenunciante = itens.filter((a) => a.origem === "denunciante");

  return (
    <section>
      <Titulo icone={Paperclip}>Anexos e evidências</Titulo>

      {!podeVerSigiloso && (
        <p className="mb-3 rounded-md border border-warning/30 bg-warning/10 p-2 text-xs text-warning">
          Arquivos marcados como sigilosos não aparecem para o seu acesso. Peça a liberação de
          “Pode ver identidade e anexos sigilosos” se precisar deles.
        </p>
      )}

      {carregando ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : !itens.length ? (
        <p className="mb-3 text-sm text-muted-foreground">Nenhum arquivo neste procedimento.</p>
      ) : (
        <ul className="mb-3 flex flex-col gap-1.5">
          {itens.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center gap-2 rounded-md border px-3 py-2">
              <button type="button" onClick={() => baixar(a)}
                      className="flex-1 truncate text-left text-sm font-medium hover:underline">
                {a.nome_arquivo}
              </button>
              <Badge variant="outline" className="text-[10px]">
                {rotulo(LABEL_CATEGORIA_ANEXO, a.categoria)}
              </Badge>
              {a.origem === "denunciante" && (
                <Badge className="bg-info/10 text-[10px] text-info hover:bg-info/10">do denunciante</Badge>
              )}
              {a.sensivel && (
                <Badge variant="destructive" className="gap-1 text-[10px]">
                  <ShieldAlert className="h-3 w-3" /> sigiloso
                </Badge>
              )}
              <span className="text-xs text-muted-foreground">
                {bytesLegivel(a.tamanho_bytes)} · {fmtDataHora(a.created_at)}
              </span>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => baixar(a)}
                      aria-label={`Baixar ${a.nome_arquivo}`}>
                <Download className="h-3.5 w-3.5" />
              </Button>
              {podeEditar && podeVerSigiloso && (
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => alternarSigilo(a)}
                        aria-label={a.sensivel ? "Tirar o sigilo" : "Marcar como sigiloso"}>
                  {a.sensivel ? <ShieldOff className="h-3.5 w-3.5" /> : <ShieldAlert className="h-3.5 w-3.5" />}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      {doDenunciante.length > 0 && (
        <p className="mb-3 text-xs text-muted-foreground">
          {doDenunciante.length} arquivo(s) vieram com o relato. Eles não podem ser excluídos por ninguém —
          são prova do que foi entregue.
        </p>
      )}

      {podeEditar && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-dashed p-3">
          <Select value={categoria} onValueChange={setCategoria}>
            <SelectTrigger className="h-9 w-[190px] text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {CATEGORIA_ANEXO.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <label className="flex items-center gap-1.5 text-xs">
            <input type="checkbox" checked={sensivel} onChange={(e) => setSensivel(e.target.checked)} />
            Sigiloso
          </label>
          <input ref={inputRef} type="file" multiple className="hidden"
                 onChange={(e) => enviar(e.target.files)} />
          <Button variant="outline" size="sm" className="gap-1.5" disabled={enviando}
                  onClick={() => inputRef.current?.click()}>
            {enviando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            Anexar arquivo
          </Button>
        </div>
      )}
    </section>
  );
}

// ------------------------------------------------------------- Presidência

export function BlocoPresidencia({ denuncia, podeDecidir, onSalvo }: {
  denuncia: Denuncia; podeDecidir: boolean; onSalvo: () => void;
}) {
  const { toast } = useToast();
  const [f, setF] = useState({
    decisao_final: denuncia.decisao_final ?? "",
    decisao_sobre_parecer: denuncia.decisao_sobre_parecer ?? "",
    decisao_fundamentacao: denuncia.decisao_fundamentacao ?? "",
    decisao_medidas: denuncia.decisao_medidas ?? "",
  });
  const [salvando, setSalvando] = useState(false);

  const salvar = async () => {
    if (!f.decisao_final.trim()) {
      toast({ title: "Escreva a decisão.", variant: "destructive" });
      return;
    }
    if (!f.decisao_sobre_parecer) {
      toast({ title: "Diga o que foi feito com a recomendação do Comitê.", variant: "destructive" });
      return;
    }
    setSalvando(true);
    // `decisao_em`, quem decidiu e o nome são carimbados pelo gatilho no
    // banco — a tela não manda, e por isso não tem como mentir sobre eles.
    const { error } = await db.from("CANAL_DENUNCIA").update({
      decisao_final: f.decisao_final.trim(),
      decisao_sobre_parecer: f.decisao_sobre_parecer,
      decisao_fundamentacao: f.decisao_fundamentacao.trim() || null,
      decisao_medidas: f.decisao_medidas.trim() || null,
    }).eq("id", denuncia.id);
    setSalvando(false);
    if (error) { toast({ title: "Erro ao registrar", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Decisão registrada", description: `Protocolo ${denuncia.protocolo}` });
    onSalvo();
  };

  // Quem não decide ainda precisa LER a decisão — é ela que fecha o caso.
  if (!podeDecidir) {
    if (!denuncia.decisao_final) {
      return (
        <section>
          <Titulo icone={Gavel}>Decisão da Presidência</Titulo>
          <p className="text-sm text-muted-foreground">
            {denuncia.status === "aguardando_presidencia"
              ? "Aguardando a decisão da Presidência."
              : "Ainda não há decisão registrada."}
          </p>
        </section>
      );
    }
    return (
      <section>
        <Titulo icone={Gavel}>Decisão da Presidência</Titulo>
        <div className="rounded-md border bg-muted/40 p-3">
          <p className="whitespace-pre-wrap text-sm">{denuncia.decisao_final}</p>
          {denuncia.decisao_medidas && (
            <p className="mt-2 whitespace-pre-wrap text-sm">
              <span className="font-medium">Medidas determinadas: </span>{denuncia.decisao_medidas}
            </p>
          )}
          <p className="mt-2 text-xs text-muted-foreground">
            {denuncia.decisao_por_nome ?? "—"} · {fmtDataHora(denuncia.decisao_em)}
          </p>
        </div>
      </section>
    );
  }

  return (
    <section>
      <Titulo icone={Gavel}>Decisão da Presidência</Titulo>
      <div className="flex flex-col gap-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">
            Sobre a recomendação do Comitê
          </label>
          <Select value={f.decisao_sobre_parecer}
                  onValueChange={(v) => setF((c) => ({ ...c, decisao_sobre_parecer: v }))}>
            <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
            <SelectContent>
              {DECISAO_SOBRE_PARECER.map((o) => (
                <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">Decisão final</label>
          <Textarea rows={3} value={f.decisao_final}
                    onChange={(e) => setF((c) => ({ ...c, decisao_final: e.target.value }))}
                    placeholder="O que fica decidido." />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">Fundamentação</label>
          <Textarea rows={3} value={f.decisao_fundamentacao}
                    onChange={(e) => setF((c) => ({ ...c, decisao_fundamentacao: e.target.value }))}
                    placeholder="Por quê." />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">
            Medidas a serem executadas
          </label>
          <Textarea rows={2} value={f.decisao_medidas}
                    onChange={(e) => setF((c) => ({ ...c, decisao_medidas: e.target.value }))}
                    placeholder="O que precisa ser feito, e por quem." />
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={salvar} disabled={salvando} className="gap-1.5">
            {salvando ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
            Registrar decisão
          </Button>
          {denuncia.decisao_em && (
            <span className="text-xs text-muted-foreground">
              Registrada por {denuncia.decisao_por_nome ?? "—"} em {fmtDataHora(denuncia.decisao_em)}
            </span>
          )}
        </div>
      </div>
    </section>
  );
}
