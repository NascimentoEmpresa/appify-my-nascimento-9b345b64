import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronDown, FileSpreadsheet, FileText, FileType2, Loader2, Pencil, Plus, Trash2, UserPlus, X } from "lucide-react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { useDocumentosProcesso, urlDocumentoProcesso } from "@/hooks/useEstruturaProcessos";
import {
  FREQUENCIAS, ROTULO_CONEXAO, equipeDoSetor, membroPendente, processosDoSetor, rotuloNivel,
  type Estrutura, type Membro, type Processo, type Setor, type TipoConexao,
} from "@/lib/organograma/estruturaProcessos";
import { AmostraTraco, Avatar, ICONES, IconeSetor, OPCOES_COR, OPCOES_ICONE, cor } from "./visual";

// =====================================================================
// Painel da direita do Cadastro da Estrutura (mig 20261020000060).
//   Com processo selecionado: "Propriedades do processo" — nome, setor de
//   origem e de destino, responsável (da equipe), frequência, entrada/saída,
//   status, próxima etapa, as três chaves do canvas, dependências e
//   documentos. Texto grava ao sair do campo; seleção e chave, na hora.
//   Sem processo: o setor (nome, diretoria, ícone, cor) e a EQUIPE do
//   gerente ao jovem aprendiz, com cargo, nível, a quem responde e funções.
// =====================================================================

export type Gravar = (tabela: "ORG_PROC_PROCESSO" | "ORG_PROC_SETOR" | "ORG_PROC_MEMBRO" | "ORG_PROC_CONEXAO", dados: Record<string, unknown>) => Promise<unknown>;
export type Apagar = (tabela: "ORG_PROC_PROCESSO" | "ORG_PROC_SETOR" | "ORG_PROC_MEMBRO" | "ORG_PROC_CONEXAO", id: string) => Promise<unknown>;

const Rotulo = ({ children, obrig }: { children: ReactNode; obrig?: boolean }) => (
  <label className="mb-1 block text-xs font-medium text-foreground/80">{children}{obrig && <span className="text-red-500"> *</span>}</label>
);

export function PropriedadesProcesso({ e, processo, podeEditar, gravar, apagar, autor, onFechar }: {
  e: Estrutura; processo: Processo; podeEditar: boolean; gravar: Gravar; apagar: Apagar; autor: string | null; onFechar: () => void;
}) {
  const [f, setF] = useState(processo);
  useEffect(() => setF(processo), [processo]);
  const docs = useDocumentosProcesso();
  const arquivo = useRef<HTMLInputElement>(null);
  const [destino, setDestino] = useState("");
  const [novaDep, setNovaDep] = useState<{ origem: string; tipo: TipoConexao } | null>(null);
  const [novaSaida, setNovaSaida] = useState<{ destino: string; tipo: TipoConexao } | null>(null);

  const salvar = async (campos: Partial<Processo>) => {
    setF((x) => ({ ...x, ...campos }));
    try { await gravar("ORG_PROC_PROCESSO", { id: processo.id, ...campos }); }
    catch (err) { toast.error((err as Error).message); setF(processo); }
  };
  const texto = (k: keyof Processo) => ({
    value: String(f[k] ?? ""), disabled: !podeEditar,
    onChange: (ev: { target: { value: string } }) => setF((x) => ({ ...x, [k]: ev.target.value })),
    onBlur: () => { if ((f[k] ?? "") !== (processo[k] ?? "")) salvar({ [k]: String(f[k] ?? "").trim() || (k === "nome" ? processo.nome : null) } as Partial<Processo>); },
  });

  const equipe = processo.setor_id ? equipeDoSetor(e, processo.setor_id) : [];
  const irmaos = processo.setor_id ? processosDoSetor(e, processo.setor_id).filter((x) => x.id !== processo.id) : [];
  const deps = e.conexoes.filter((c) => c.destino_id === processo.id);
  const saidas = e.conexoes.filter((c) => c.origem_id === processo.id);
  const meusDocs = e.documentos.filter((d) => d.processo_id === processo.id);
  const nomeP = (id: string) => { const x = e.processos.find((p) => p.id === id); return x ? `${x.codigo} - ${x.nome}` : "—"; };
  const setorDe = (id: string) => e.setores.find((s) => s.id === e.processos.find((p) => p.id === id)?.setor_id)?.nome ?? "Presidência";
  const outrosProcessos = e.processos.filter((x) => x.id !== processo.id);

  const ligar = async (origem: string, destinoId: string, tipo: TipoConexao) => {
    try { await gravar("ORG_PROC_CONEXAO", { origem_id: origem, destino_id: destinoId, tipo }); toast.success("Conexão criada."); }
    catch (err) { toast.error(/duplicate|unique/i.test((err as Error).message) ? "Essa conexão já existe." : (err as Error).message); }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Propriedades do processo</h3>
        <button onClick={onFechar} className="text-muted-foreground hover:text-foreground" title="Fechar"><X className="h-4 w-4" /></button>
      </div>
      <div><Rotulo obrig>Nome do processo</Rotulo><Input id="org-prop-nome" className="h-9" {...texto("nome")} /></div>
      <div>
        <Rotulo obrig>Setor de origem</Rotulo>
        <Select value={f.setor_id ?? ""} disabled={!podeEditar} onValueChange={(v) => salvar({ setor_id: v, responsavel_membro_id: null, proximo_id: null, pos_x: null, pos_y: null })}>
          <SelectTrigger className="h-9"><SelectValue placeholder="Setor" /></SelectTrigger>
          <SelectContent>{e.setores.map((s) => <SelectItem key={s.id} value={s.id}><span className="inline-flex items-center gap-2"><IconeSetor icone={s.icone} corSetor={s.cor} tamanho="sm" />{s.nome}</span></SelectItem>)}</SelectContent>
        </Select>
      </div>
      <div>
        <Rotulo>Setor de destino</Rotulo>
        <Select value={destino || "_"} disabled={!podeEditar} onValueChange={(v) => { setDestino(v === "_" ? "" : v); if (v !== "_") setNovaSaida({ destino: "", tipo: "intersetorial" }); }}>
          <SelectTrigger className="h-9"><SelectValue placeholder="Selecione um setor..." /></SelectTrigger>
          <SelectContent>
            <SelectItem value="_">Selecione um setor...</SelectItem>
            {e.setores.filter((s) => s.id !== processo.setor_id).map((s) => <SelectItem key={s.id} value={s.id}>{s.nome}</SelectItem>)}
          </SelectContent>
        </Select>
        {destino && novaSaida && (
          <div className="mt-1.5 flex gap-1.5">
            <Select value={novaSaida.destino || "_"} onValueChange={(v) => setNovaSaida({ ...novaSaida, destino: v === "_" ? "" : v })}>
              <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Processo de destino" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="_">Processo de destino…</SelectItem>
                {processosDoSetor(e, destino).map((x) => <SelectItem key={x.id} value={x.id}>{x.codigo} {x.nome}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button size="sm" className="h-8" disabled={!novaSaida.destino}
              onClick={async () => { await ligar(processo.id, novaSaida.destino, "intersetorial"); setDestino(""); setNovaSaida(null); }}>Ligar</Button>
          </div>
        )}
      </div>
      <div>
        <Rotulo obrig>Responsável</Rotulo>
        <Select value={f.responsavel_membro_id ?? "_"} disabled={!podeEditar} onValueChange={(v) => salvar({ responsavel_membro_id: v === "_" ? null : v })}>
          <SelectTrigger className="h-9"><SelectValue placeholder="Da equipe do setor" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="_">— Sem responsável —</SelectItem>
            {equipe.map((m) => <SelectItem key={m.id} value={m.id}><span className="inline-flex items-center gap-2"><Avatar nome={m.nome} foto={m.avatar_url} tamanho={20} />{m.nome} <span className="text-muted-foreground">· {m.cargo}</span></span></SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div>
        <Rotulo>Frequência</Rotulo>
        <Select value={f.frequencia ?? "_"} disabled={!podeEditar} onValueChange={(v) => salvar({ frequencia: v === "_" ? null : v })}>
          <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="_">—</SelectItem>{FREQUENCIAS.map((x) => <SelectItem key={x} value={x}>{x}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      <div><Rotulo>Entrada (o que recebe)</Rotulo><Input className="h-9" placeholder="Planilhas, relatórios e dados dos setores" {...texto("entrada")} /></div>
      <div><Rotulo>Saída (o que gera)</Rotulo><Input className="h-9" placeholder="Base consolidada de dados" {...texto("saida")} /></div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <Rotulo>Status</Rotulo>
          <Select value={f.status} disabled={!podeEditar} onValueChange={(v) => salvar({ status: v as Processo["status"] })}>
            <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="ativo"><span className="inline-flex items-center gap-2"><i className="h-2 w-2 rounded-full bg-green-600" />Ativo</span></SelectItem>
              <SelectItem value="em_revisao"><span className="inline-flex items-center gap-2"><i className="h-2 w-2 rounded-full bg-amber-500" />Em revisão</span></SelectItem>
              <SelectItem value="inativo"><span className="inline-flex items-center gap-2"><i className="h-2 w-2 rounded-full bg-slate-400" />Inativo</span></SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Rotulo>Próxima etapa</Rotulo>
          <Select value={f.proximo_id ?? "_"} disabled={!podeEditar} onValueChange={(v) => salvar({ proximo_id: v === "_" ? null : v })}>
            <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="_">— Fim do fluxo —</SelectItem>{irmaos.map((x) => <SelectItem key={x.id} value={x.id}>{x.nome} ({x.codigo})</SelectItem>)}</SelectContent>
          </Select>
        </div>
      </div>
      <div>
        <Rotulo>Macroprocesso</Rotulo>
        <Select value={f.macro_id ?? "_"} disabled={!podeEditar} onValueChange={(v) => salvar({ macro_id: v === "_" ? null : v })}>
          <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="_">— Nenhum —</SelectItem>{e.macros.map((m) => <SelectItem key={m.id} value={m.id}>{m.nome}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      <div><Rotulo>Descrição</Rotulo><Textarea rows={2} placeholder="Como o processo é feito" {...texto("descricao")} /></div>
      <div className="space-y-2 pt-1">
        {([["exibir_organograma", "Exibir no organograma geral"], ["permite_intersetorial", "Permitir conexão intersetorial"], ["bloquear_posicao", "Bloquear posição no canvas"]] as const).map(([k, r]) => (
          <label key={k} className="flex items-center gap-2 text-sm">
            <Switch checked={!!f[k]} disabled={!podeEditar} onCheckedChange={(v) => salvar({ [k]: v } as Partial<Processo>)} /> {r}
          </label>
        ))}
      </div>

      {/* Dependências: quem manda algo para este processo */}
      <Secao titulo={`Dependências (${deps.length})`} onAdicionar={podeEditar ? () => setNovaDep({ origem: "", tipo: "intersetorial" }) : undefined}>
        {deps.map((c) => (
          <LinhaConexao key={c.id} texto={nomeP(c.origem_id)} sub={`${setorDe(c.origem_id)} · ${ROTULO_CONEXAO[c.tipo]}`} tipo={c.tipo}
            onTipo={podeEditar ? (t) => gravar("ORG_PROC_CONEXAO", { id: c.id, tipo: t }).catch((x) => toast.error(x.message)) : undefined}
            onRemover={podeEditar ? () => apagar("ORG_PROC_CONEXAO", c.id).catch((x) => toast.error(x.message)) : undefined} />
        ))}
        {novaDep && (
          <NovaConexao opcoes={outrosProcessos} e={e} valor={novaDep.origem} tipo={novaDep.tipo} rotulo="Processo que alimenta este"
            onChange={(o, t) => setNovaDep({ origem: o, tipo: t })} onCancelar={() => setNovaDep(null)}
            onConfirmar={async () => { await ligar(novaDep.origem, processo.id, novaDep.tipo); setNovaDep(null); }} />
        )}
      </Secao>
      <Secao titulo={`Envia para (${saidas.length})`} onAdicionar={podeEditar ? () => setNovaSaida({ destino: "", tipo: "intersetorial" }) : undefined}>
        {saidas.map((c) => (
          <LinhaConexao key={c.id} texto={nomeP(c.destino_id)} sub={`${setorDe(c.destino_id)} · ${ROTULO_CONEXAO[c.tipo]}`} tipo={c.tipo}
            onTipo={podeEditar ? (t) => gravar("ORG_PROC_CONEXAO", { id: c.id, tipo: t }).catch((x) => toast.error(x.message)) : undefined}
            onRemover={podeEditar ? () => apagar("ORG_PROC_CONEXAO", c.id).catch((x) => toast.error(x.message)) : undefined} />
        ))}
        {novaSaida && !destino && (
          <NovaConexao opcoes={outrosProcessos} e={e} valor={novaSaida.destino} tipo={novaSaida.tipo} rotulo="Processo que recebe deste"
            onChange={(d, t) => setNovaSaida({ destino: d, tipo: t })} onCancelar={() => setNovaSaida(null)}
            onConfirmar={async () => { await ligar(processo.id, novaSaida.destino, novaSaida.tipo); setNovaSaida(null); }} />
        )}
      </Secao>

      <Secao titulo={`Documentos vinculados (${meusDocs.length})`} onAdicionar={podeEditar ? () => arquivo.current?.click() : undefined}>
        <input ref={arquivo} type="file" multiple className="hidden" onChange={async (ev) => {
          const arqs = Array.from(ev.target.files ?? []); ev.target.value = "";
          if (!arqs.length) return;
          try { await docs.anexar.mutateAsync({ processoId: processo.id, arquivos: arqs, autor }); toast.success("Documento anexado."); }
          catch (err) { toast.error((err as Error).message); }
        }} />
        {docs.anexar.isPending && <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" /> Enviando…</p>}
        {meusDocs.map((d) => {
          const ext = (d.nome_arquivo ?? "").split(".").pop()?.toLowerCase() ?? "";
          const I = ext === "pdf" ? FileType2 : ["xls", "xlsx", "csv"].includes(ext) ? FileSpreadsheet : FileText;
          const cl = ext === "pdf" ? "text-red-600" : ["xls", "xlsx", "csv"].includes(ext) ? "text-green-600" : "text-blue-600";
          return (
            <div key={d.id} className="flex items-center gap-2 py-0.5 text-xs">
              <I className={cn("h-4 w-4 shrink-0", cl)} />
              <button className="min-w-0 flex-1 truncate text-left hover:underline"
                onClick={async () => { const u = await urlDocumentoProcesso(d.storage_path); if (u) window.open(u, "_blank"); else toast.error("Não foi possível abrir."); }}>
                {d.nome_arquivo ?? d.storage_path}
              </button>
              {podeEditar && <button className="text-muted-foreground hover:text-red-600" onClick={() => docs.remover.mutate({ id: d.id, path: d.storage_path }, { onError: (x) => toast.error(x.message) })}><X className="h-3.5 w-3.5" /></button>}
            </div>
          );
        })}
      </Secao>
    </div>
  );
}

function Secao({ titulo, onAdicionar, children }: { titulo: string; onAdicionar?: () => void; children: ReactNode }) {
  return (
    <Collapsible defaultOpen className="rounded-lg border">
      <div className="flex items-center justify-between px-2.5 py-1.5">
        <CollapsibleTrigger className="flex items-center gap-1 text-xs font-semibold"><ChevronDown className="h-3.5 w-3.5" /> {titulo}</CollapsibleTrigger>
        {onAdicionar && <button onClick={onAdicionar} className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"><Plus className="h-3 w-3" /> Adicionar</button>}
      </div>
      <CollapsibleContent className="space-y-1 border-t px-2.5 py-2">{children}</CollapsibleContent>
    </Collapsible>
  );
}

function LinhaConexao({ texto, sub, tipo, onTipo, onRemover }: { texto: string; sub: string; tipo: TipoConexao; onTipo?: (t: TipoConexao) => void; onRemover?: () => void }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <AmostraTraco tipo={tipo} largura={18} />
      <div className="min-w-0 flex-1"><div className="truncate font-medium">{texto}</div><div className="truncate text-[10.5px] text-muted-foreground">{sub}</div></div>
      {onTipo && (
        <select value={tipo} onChange={(ev) => onTipo(ev.target.value as TipoConexao)} className="h-6 rounded border bg-background px-1 text-[10.5px]" title="Tipo da conexão">
          {(Object.keys(ROTULO_CONEXAO) as TipoConexao[]).map((t) => <option key={t} value={t}>{ROTULO_CONEXAO[t]}</option>)}
        </select>
      )}
      {onRemover && <button className="text-muted-foreground hover:text-red-600" onClick={onRemover} title="Remover"><X className="h-3.5 w-3.5" /></button>}
    </div>
  );
}

function NovaConexao({ opcoes, e, valor, tipo, rotulo, onChange, onCancelar, onConfirmar }: {
  opcoes: Processo[]; e: Estrutura; valor: string; tipo: TipoConexao; rotulo: string;
  onChange: (id: string, t: TipoConexao) => void; onCancelar: () => void; onConfirmar: () => void;
}) {
  const nomeSetor = (id: string | null) => e.setores.find((s) => s.id === id)?.nome ?? "Presidência";
  return (
    <div className="space-y-1.5 rounded-md bg-muted/50 p-2">
      <Select value={valor || "_"} onValueChange={(v) => onChange(v === "_" ? "" : v, tipo)}>
        <SelectTrigger className="h-8 text-xs"><SelectValue placeholder={rotulo} /></SelectTrigger>
        <SelectContent className="max-h-72">
          <SelectItem value="_">{rotulo}…</SelectItem>
          {[...opcoes].sort((a, b) => nomeSetor(a.setor_id).localeCompare(nomeSetor(b.setor_id)) || a.ordem - b.ordem).map((x) => (
            <SelectItem key={x.id} value={x.id}>{nomeSetor(x.setor_id)} · {x.codigo} {x.nome}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <div className="flex gap-1.5">
        <Select value={tipo} onValueChange={(v) => onChange(valor, v as TipoConexao)}>
          <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>{(Object.keys(ROTULO_CONEXAO) as TipoConexao[]).map((t) => <SelectItem key={t} value={t}>{ROTULO_CONEXAO[t]}</SelectItem>)}</SelectContent>
        </Select>
        <Button size="sm" variant="ghost" className="h-8" onClick={onCancelar}>Cancelar</Button>
        <Button size="sm" className="h-8" disabled={!valor} onClick={onConfirmar}>Ligar</Button>
      </div>
    </div>
  );
}

// ── Setor e equipe ──────────────────────────────────────────────────────────
export function PropriedadesSetor({ e, setor, podeEditar, podeExcluir, gravar, apagar, onMembro, onExcluirSetor }: {
  e: Estrutura; setor: Setor; podeEditar: boolean; podeExcluir: boolean; gravar: Gravar; apagar: Apagar;
  onMembro: (m: Membro | null) => void; onExcluirSetor: () => void;
}) {
  const [f, setF] = useState(setor);
  useEffect(() => setF(setor), [setor]);
  const salvar = async (campos: Partial<Setor>) => {
    setF((x) => ({ ...x, ...campos }));
    try { await gravar("ORG_PROC_SETOR", { id: setor.id, ...campos }); } catch (err) { toast.error((err as Error).message); setF(setor); }
  };
  const equipe = equipeDoSetor(e, setor.id);
  const diretorias = e.unidades.filter((u) => u.tipo === "diretoria");
  return (
    <Tabs defaultValue="equipe">
      <TabsList className="grid w-full grid-cols-2"><TabsTrigger value="equipe">Equipe ({equipe.length})</TabsTrigger><TabsTrigger value="setor">Setor</TabsTrigger></TabsList>
      <TabsContent value="setor" className="space-y-3">
        <div><Rotulo obrig>Nome do setor</Rotulo>
          <Input className="h-9" value={f.nome} disabled={!podeEditar} onChange={(x) => setF({ ...f, nome: x.target.value })}
            onBlur={() => f.nome.trim() && f.nome !== setor.nome && salvar({ nome: f.nome.trim() })} /></div>
        <div><Rotulo>Diretoria</Rotulo>
          <Select value={f.unidade_id ?? "_"} disabled={!podeEditar} onValueChange={(v) => salvar({ unidade_id: v === "_" ? null : v })}>
            <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="_">— Nenhuma —</SelectItem>{diretorias.map((d) => <SelectItem key={d.id} value={d.id}>{d.nome}</SelectItem>)}</SelectContent>
          </Select></div>
        <div><Rotulo>Ícone</Rotulo>
          <div className="flex flex-wrap gap-1.5">{OPCOES_ICONE.map((i) => {
            const I = ICONES[i];
            return <button key={i} disabled={!podeEditar} onClick={() => salvar({ icone: i })} className={cn("rounded-md border p-1.5", f.icone === i && "border-primary bg-primary/10")}><I className="h-4 w-4" /></button>;
          })}</div></div>
        <div><Rotulo>Cor</Rotulo>
          <div className="flex flex-wrap gap-1.5">{OPCOES_COR.map((c) => (
            <button key={c} disabled={!podeEditar} onClick={() => salvar({ cor: c })} title={c}
              className={cn("h-6 w-6 rounded-full ring-offset-2", f.cor === c && "ring-2 ring-primary")} style={{ background: cor(c).hex }} />
          ))}</div></div>
        <div><Rotulo>Descrição / missão</Rotulo>
          <Textarea rows={3} value={f.descricao ?? ""} disabled={!podeEditar} onChange={(x) => setF({ ...f, descricao: x.target.value })}
            onBlur={() => (f.descricao ?? "") !== (setor.descricao ?? "") && salvar({ descricao: f.descricao?.trim() || null })} /></div>
        {podeExcluir && <Button variant="outline" size="sm" className="text-red-600" onClick={onExcluirSetor}><Trash2 className="mr-1.5 h-4 w-4" /> Excluir setor</Button>}
      </TabsContent>
      <TabsContent value="equipe" className="space-y-2">
        <p className="text-xs text-muted-foreground">Do gerente ao jovem aprendiz: cargo, a quem responde e as funções de cada um. Os processos ligam em quem responde por eles.</p>
        {equipe.map((m) => {
          const chefe = e.membros.find((x) => x.id === m.parent_id);
          const procs = e.processos.filter((p) => p.responsavel_membro_id === m.id).length;
          return (
            <div key={m.id} className="flex items-center gap-2 rounded-lg border p-2" style={{ marginLeft: Math.min(4, m.nivel - 1) * 8 }}>
              <Avatar nome={m.nome} foto={m.avatar_url} tamanho={30} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{m.nome}{m.responsavel && <span className="ml-1.5 rounded bg-primary/10 px-1 text-[10px] text-primary">responsável</span>}
                  {membroPendente(m) && <span className="ml-1.5 rounded bg-amber-100 px-1 text-[10px] text-amber-800 dark:bg-amber-950 dark:text-amber-200">pendente de vínculo</span>}</div>
                <div className="truncate text-[11px] text-muted-foreground">{m.cargo} · {rotuloNivel(m.nivel)}{chefe ? ` · responde a ${chefe.nome}` : ""} · {procs} proc.</div>
              </div>
              {podeEditar && membroPendente(m) && <Button variant="outline" size="sm" className="h-6 px-2 text-[11px]" onClick={() => onMembro(m)}>Vincular</Button>}
              {podeEditar && <button onClick={() => onMembro(m)} className="text-muted-foreground hover:text-foreground" title="Editar"><Pencil className="h-3.5 w-3.5" /></button>}
              {podeExcluir && <button onClick={() => { if (confirm(`Tirar ${m.nome} da equipe?`)) apagar("ORG_PROC_MEMBRO", m.id).catch((x) => toast.error(x.message)); }} className="text-muted-foreground hover:text-red-600" title="Remover"><Trash2 className="h-3.5 w-3.5" /></button>}
            </div>
          );
        })}
        {podeEditar && <Button variant="outline" size="sm" className="w-full" onClick={() => onMembro(null)}><UserPlus className="mr-1.5 h-4 w-4" /> Adicionar pessoa</Button>}
      </TabsContent>
    </Tabs>
  );
}
