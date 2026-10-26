import type { ReactNode } from "react";
import { ArrowDownLeft, ArrowUpRight, FileText, Paperclip } from "lucide-react";
import { toast } from "sonner";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { urlDocumentoProcesso } from "@/hooks/useEstruturaProcessos";
import {
  ROTULO_CONEXAO, ROTULO_STATUS, arvoreEquipe, conexoesDoProcesso, equipeDoSetor, listaAtividades, processosDoSetor, rotuloNivel,
  type Estrutura, type Membro, type NoEquipe, type Processo,
} from "@/lib/organograma/estruturaProcessos";
import { AmostraTraco, Avatar, IconeSetor, cor } from "./visual";

// =====================================================================
// O detalhe de um setor no Organograma Geral: a equipe do gerente ao
// jovem aprendiz, cada pessoa com as funções dela, os processos pelos quais
// responde e, em cada processo, com quem ele se liga em outros setores (o
// processo e a pessoa responsável do outro lado). E o detalhe de um
// processo, aberto pelo clique numa caixa de processo.
// =====================================================================

export function DetalheSetor({ e, setorId, onFechar, onProcesso, onPessoa }: {
  e: Estrutura; setorId: string | null; onFechar: () => void; onProcesso: (id: string) => void; onPessoa: (m: Membro) => void;
}) {
  const s = e.setores.find((x) => x.id === setorId) ?? null;
  const equipe = s ? equipeDoSetor(e, s.id) : [];
  const procs = s ? processosDoSetor(e, s.id) : [];
  const semResponsavel = procs.filter((p) => !p.responsavel_membro_id || !equipe.some((m) => m.id === p.responsavel_membro_id));
  const c = cor(s?.cor);
  return (
    <Sheet open={!!s} onOpenChange={(v) => { if (!v) onFechar(); }}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-2xl">
        {s && (
          <>
            <SheetHeader>
              <SheetTitle className="flex items-center gap-2"><IconeSetor icone={s.icone} corSetor={s.cor} /> {s.nome}</SheetTitle>
              <SheetDescription>
                {equipe.length} {equipe.length === 1 ? "pessoa" : "pessoas"} · {procs.length} processos
                {s.descricao ? ` · ${s.descricao}` : ""}
              </SheetDescription>
            </SheetHeader>
            <div className="mt-4 space-y-2">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Equipe, funções e processos</p>
              {equipe.length === 0 && <p className="text-sm text-muted-foreground">Equipe ainda não cadastrada.</p>}
              {arvoreEquipe(equipe).map((n) => <NoPessoa key={n.membro.id} no={n} e={e} profundidade={0} onProcesso={onProcesso} onPessoa={onPessoa} corHex={c.hex} />)}
              {semResponsavel.length > 0 && (
                <div className="rounded-lg border border-dashed p-3">
                  <p className="mb-1.5 text-xs font-semibold text-muted-foreground">Processos sem responsável na equipe</p>
                  <div className="flex flex-wrap gap-1.5">{semResponsavel.map((p) => <ChipProcesso key={p.id} p={p} onClick={() => onProcesso(p.id)} />)}</div>
                </div>
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function NoPessoa({ no, e, profundidade, onProcesso, onPessoa, corHex }: { no: NoEquipe; e: Estrutura; profundidade: number; onProcesso: (id: string) => void; onPessoa: (m: Membro) => void; corHex: string }) {
  const m = no.membro;
  const meus = e.processos.filter((p) => p.responsavel_membro_id === m.id).sort((a, b) => a.ordem - b.ordem);
  const funcoes = listaAtividades(m.atividades);
  return (
    <div style={{ marginLeft: profundidade * 18 }} className="relative">
      {profundidade > 0 && <span className="absolute -left-3 top-0 h-6 w-3 rounded-bl-md border-b-2 border-l-2" style={{ borderColor: `${corHex}55` }} />}
      <div className="rounded-xl border bg-card p-3 shadow-sm" style={{ borderLeft: `3px solid ${corHex}` }}>
        {/* Clique na pessoa → perfil (dados do cadastro + o que faz). */}
        <button className="group flex w-full items-center gap-2.5 text-left" onClick={() => onPessoa(m)} title="Ver perfil">
          <Avatar nome={m.nome} foto={m.avatar_url} tamanho={34} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold group-hover:underline">{m.nome}{m.responsavel && <Badge variant="secondary" className="ml-2 text-[10px]">Responsável</Badge>}</div>
            <div className="truncate text-xs text-muted-foreground">{m.cargo} · {rotuloNivel(m.nivel)}</div>
          </div>
        </button>
        {funcoes.length > 0 && (
          <ul className="mt-2 list-disc space-y-0.5 pl-5 text-xs text-foreground/80">{funcoes.map((f, i) => <li key={i}>{f}</li>)}</ul>
        )}
        {meus.length > 0 && (
          <div className="mt-2 space-y-1.5">
            {meus.map((p) => <ProcessoComLigacoes key={p.id} p={p} e={e} onProcesso={onProcesso} onPessoa={onPessoa} />)}
          </div>
        )}
      </div>
      <div className="mt-2 space-y-2">
        {no.filhos.map((f) => <NoPessoa key={f.membro.id} no={f} e={e} profundidade={profundidade + 1} onProcesso={onProcesso} onPessoa={onPessoa} corHex={corHex} />)}
      </div>
    </div>
  );
}

function ProcessoComLigacoes({ p, e, onProcesso, onPessoa }: { p: Processo; e: Estrutura; onProcesso: (id: string) => void; onPessoa: (m: Membro) => void }) {
  const { entradas, saidas } = conexoesDoProcesso(e, p.id);
  const fora = [...entradas.map((x) => ({ ...x, entra: true })), ...saidas.map((x) => ({ ...x, entra: false }))]
    .filter((x) => x.p!.setor_id !== p.setor_id);
  return (
    <div className="rounded-lg bg-muted/40 px-2 py-1.5">
      <ChipProcesso p={p} onClick={() => onProcesso(p.id)} />
      {fora.length > 0 && (
        <ul className="mt-1 space-y-0.5 pl-1">
          {fora.map(({ c, p: outro, entra }) => {
            const setor = e.setores.find((s) => s.id === outro!.setor_id);
            const resp = e.membros.find((m) => m.id === outro!.responsavel_membro_id);
            return (
              <li key={c.id} className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                {entra ? <ArrowDownLeft className="h-3 w-3 text-emerald-600" /> : <ArrowUpRight className="h-3 w-3 text-blue-600" />}
                <AmostraTraco tipo={c.tipo} largura={18} />
                <span>{entra ? "recebe de" : "envia para"}</span>
                <button className="font-medium text-foreground hover:underline" onClick={() => onProcesso(outro!.id)}>{outro!.codigo} {outro!.nome}</button>
                <span>· {setor?.nome ?? "Presidência"}{resp && <> · <button className="hover:underline" onClick={() => onPessoa(resp)}>{resp.nome}</button></>}</span>
                {c.rotulo && <span className="italic">({c.rotulo})</span>}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function ChipProcesso({ p, onClick }: { p: Processo; onClick: () => void }) {
  return (
    <button onClick={onClick} className="inline-flex items-center gap-1.5 rounded-md border bg-card px-2 py-1 text-xs font-medium hover:border-primary">
      <FileText className="h-3.5 w-3.5 text-muted-foreground" /> {p.nome}
      <span className="text-[10px] text-muted-foreground">{p.codigo}</span>
      {p.status !== "ativo" && <span className={cn("rounded px-1 text-[9.5px]", p.status === "em_revisao" ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-500")}>{ROTULO_STATUS[p.status]}</span>}
    </button>
  );
}

export function DetalheProcesso({ e, processoId, onFechar, onProcesso, onPessoa }: {
  e: Estrutura; processoId: string | null; onFechar: () => void; onProcesso: (id: string) => void; onPessoa: (m: Membro) => void;
}) {
  const p = e.processos.find((x) => x.id === processoId) ?? null;
  const setor = p ? e.setores.find((s) => s.id === p.setor_id) : null;
  const resp: Membro | undefined = p ? e.membros.find((m) => m.id === p.responsavel_membro_id) : undefined;
  const { entradas, saidas } = p ? conexoesDoProcesso(e, p.id) : { entradas: [], saidas: [] };
  const docs = p ? e.documentos.filter((d) => d.processo_id === p.id) : [];
  const proximo = p ? e.processos.find((x) => x.id === p.proximo_id) : undefined;
  const linha = (rot: string, val: ReactNode) => (
    <div className="grid grid-cols-[120px_1fr] gap-2 border-b py-1.5 text-sm last:border-0"><span className="text-muted-foreground">{rot}</span><span>{val || "—"}</span></div>
  );
  return (
    <Sheet open={!!p} onOpenChange={(v) => { if (!v) onFechar(); }}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-lg">
        {p && (
          <>
            <SheetHeader>
              <SheetTitle className="flex items-center gap-2">{setor && <IconeSetor icone={setor.icone} corSetor={setor.cor} tamanho="sm" />}{p.nome}</SheetTitle>
              <SheetDescription>{p.codigo} · {setor?.nome ?? "Presidência"}</SheetDescription>
            </SheetHeader>
            <div className="mt-4">
              {linha("Responsável", resp ? <button className="inline-flex items-center gap-2 text-left hover:underline" onClick={() => onPessoa(resp)}><Avatar nome={resp.nome} foto={resp.avatar_url} tamanho={22} />{resp.nome} · {resp.cargo}</button> : null)}
              {linha("Frequência", p.frequencia)}
              {linha("Entrada", p.entrada)}
              {linha("Saída", p.saida)}
              {linha("Status", ROTULO_STATUS[p.status])}
              {linha("Próxima etapa", proximo ? <button className="hover:underline" onClick={() => onProcesso(proximo.id)}>{proximo.codigo} {proximo.nome}</button> : null)}
              {p.descricao && linha("Descrição", <span className="whitespace-pre-wrap">{p.descricao}</span>)}
            </div>
            {[["Recebe de", entradas], ["Envia para", saidas]].map(([rot, lista]) => (
              <div key={rot as string} className="mt-4">
                <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{rot as string}</p>
                {(lista as typeof entradas).length === 0 ? <p className="text-xs text-muted-foreground">Nenhuma conexão.</p> : (
                  <ul className="space-y-1">
                    {(lista as typeof entradas).map(({ c, p: o }) => (
                      <li key={c.id} className="flex items-center gap-2 text-sm">
                        <AmostraTraco tipo={c.tipo} largura={22} />
                        <button className="hover:underline" onClick={() => onProcesso(o!.id)}>{o!.codigo} {o!.nome}</button>
                        <span className="text-xs text-muted-foreground">· {e.setores.find((s) => s.id === o!.setor_id)?.nome ?? "Presidência"} · {ROTULO_CONEXAO[c.tipo]}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
            <div className="mt-4">
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Documentos</p>
              {docs.length === 0 ? <p className="text-xs text-muted-foreground">Nenhum documento.</p> : docs.map((d) => (
                <button key={d.id} className="flex items-center gap-2 py-0.5 text-sm text-primary hover:underline"
                  onClick={async () => { const u = await urlDocumentoProcesso(d.storage_path); if (u) window.open(u, "_blank"); else toast.error("Não foi possível abrir o arquivo."); }}>
                  <Paperclip className="h-3.5 w-3.5" /> {d.nome_arquivo ?? d.storage_path}
                </button>
              ))}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
