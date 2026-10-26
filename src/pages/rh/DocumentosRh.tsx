import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { AlertTriangle, Archive, Download, FileCheck2, FilePlus2, FileSignature, FileText, ImagePlus, Loader2, Paperclip, Search, ShieldCheck, Upload, Users, X } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { useScreenAccess } from "@/hooks/useScreenAccess";
import {
  useEncarregadosDocumento, useOpcoesDocumento, useSolicitacoesDocumento, useSolicitarDocumento, useSolicitarLote, type EncarregadoDocumento,
} from "@/hooks/useDocumentosSolicitados";
import { DetalheDocumento } from "@/components/documentos/DetalheDocumento";
import {
  STATUS_DOCUMENTO, TIPO_DOCUMENTO, TIPOS_NOVO_DOCUMENTO, atrasada, errosSolicitacao, nomeLegivel, ordenarSolicitacoes, partirContrato,
  rotuloSituacao, textoPrazo, type FormSolicitacao, type StatusDocumento, type TipoNovoDocumento,
  ROTULO_SITUACAO_LOTE, resumoLotes, situacaoNoLote, type ResumoLote, type SituacaoNoLote, type SolicitacaoDocumento,
} from "@/lib/rh/documentosSolicitados";

// =====================================================================
// RH › DOCUMENTOS (mig 20261019000040, 19/10/2026)
//
// Chamado: o RH manda documentos aos encarregados, eles colhem a
// assinatura e devolvem anexado — "documentos muitas vezes são extraviados
// e não retornam ao RH como deveria". Aqui o RH solicita formalmente
// (título, descrição, contrato + responsável — o mesmo da Conferência de
// Ponto, pela Hierarquia de Postos — ou um usuário qualquer) e acompanha:
// fica "Pendente (FULANO — CONTRATO)" até o destinatário anexar e enviar.
// O lado do encarregado é /app/encarregados/documentos.
//
// TIPO obrigatório (mig 20261022000500, 22/10/2026): Registro (só guarda,
// nasce concluído), Assinatura (o destinatário assina no sistema) e Termo
// de ciência (pede a assinatura a cada entrada até ele assinar). Imagens
// anexadas aparecem no card e na janela de assinatura.
//
// PARA TODOS OS ENCARREGADOS (mig 20261025000030, 25/10/2026) — chamado:
// "o documento seja exibido na tela inicial de todos os encarregados [...]
// até que realize a leitura, assine e anexe o arquivo assinado". Novo tipo
// "Termo assinado e anexado" (aparece a cada entrada até anexarem o
// assinado) e "Enviar para › Todos os encarregados": uma solicitação por
// encarregado, no mesmo lote. O quadro "Envios para todos os encarregados"
// acompanha cada envio — quem concluiu, quem só leu, quem nem abriu.
// =====================================================================

const ICONE_TIPO: Record<TipoNovoDocumento, typeof Archive> = { registro: Archive, assinatura: FileSignature, ciencia: ShieldCheck, ciencia_anexo: FileCheck2 };

type Filtro = "pendente" | "atrasada" | "concluida" | "cancelada" | "todas";
const hojeIso = () => new Date().toLocaleDateString("sv-SE");
const fmtData = (s: string | null) => (s ? new Date(`${s.slice(0, 10)}T12:00:00`).toLocaleDateString("pt-BR") : "—");

export default function DocumentosRh() {
  const [params, setParams] = useSearchParams();
  const lista = useSolicitacoesDocumento();
  const podeIncluir = useScreenAccess("rh_documentos", "incluir").data === true;
  const podeAlterar = useScreenAccess("rh_documentos", "alterar").data === true;
  const [filtro, setFiltro] = useState<Filtro>("pendente");
  const [busca, setBusca] = useState("");
  const [aberta, setAberta] = useState<number | null>(null);
  const [nova, setNova] = useState(false);
  const hoje = hojeIso();

  // Link da notificação: ?s=<id>
  useEffect(() => {
    const s = Number(params.get("s"));
    if (s) setAberta(s);
  }, [params]);

  const todas = useMemo(() => lista.data ?? [], [lista.data]);
  const contagem = useMemo(() => ({
    pendente: todas.filter((s) => s.status === "pendente").length,
    atrasada: todas.filter((s) => atrasada(s, hoje)).length,
    concluida: todas.filter((s) => s.status === "concluida").length,
    cancelada: todas.filter((s) => s.status === "cancelada").length,
    todas: todas.length,
  }), [todas, hoje]);

  const visiveis = useMemo(() => {
    const t = busca.trim().toLowerCase();
    const filtradas = todas.filter((s) => {
      if (filtro === "atrasada" ? !atrasada(s, hoje) : filtro !== "todas" && s.status !== filtro) return false;
      if (!t) return true;
      return [String(s.id), s.titulo, s.descricao, s.contrato_nome, s.destinatario_nome, s.solicitante_nome]
        .some((v) => String(v ?? "").toLowerCase().includes(t));
    });
    return ordenarSolicitacoes(filtradas, hoje);
  }, [todas, filtro, busca, hoje]);

  const lotes = useMemo(() => resumoLotes(todas), [todas]);
  const [loteAberto, setLoteAberto] = useState<string | null>(null);
  const solicitacaoAberta = todas.find((s) => s.id === aberta) ?? null;
  const fechar = () => { setAberta(null); if (params.get("s")) { params.delete("s"); setParams(params, { replace: true }); } };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Documentos"
        subtitle="Solicite documentos aos encarregados (ou a qualquer usuário) e acompanhe até voltarem assinados."
        module="Recursos Humanos"
        actions={podeIncluir ? <Button onClick={() => setNova(true)}><FilePlus2 className="mr-1.5 h-4 w-4" /> Nova solicitação</Button> : undefined}
      />

      {lotes.length > 0 && <QuadroLotes lotes={lotes} onAbrir={setLoteAberto} />}

      <div className="flex flex-wrap items-center gap-3">
        <Tabs value={filtro} onValueChange={(v) => setFiltro(v as Filtro)}>
          <TabsList className="h-auto flex-wrap">
            <TabsTrigger value="pendente">Pendentes ({contagem.pendente})</TabsTrigger>
            <TabsTrigger value="atrasada" className={cn(contagem.atrasada > 0 && "text-red-600")}>Atrasadas ({contagem.atrasada})</TabsTrigger>
            <TabsTrigger value="concluida">Concluídas ({contagem.concluida})</TabsTrigger>
            <TabsTrigger value="cancelada">Canceladas ({contagem.cancelada})</TabsTrigger>
            <TabsTrigger value="todas">Todas ({contagem.todas})</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="relative ml-auto w-full sm:w-72">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input className="pl-8" placeholder="Buscar título, contrato, pessoa…" value={busca} onChange={(e) => setBusca(e.target.value)} />
        </div>
      </div>

      <Card className="overflow-x-auto">
        {lista.isLoading ? (
          <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Carregando…</div>
        ) : lista.error ? (
          <div className="p-6 text-sm text-red-600">{(lista.error as Error).message}</div>
        ) : visiveis.length === 0 ? (
          <div className="p-10 text-center text-sm text-muted-foreground">
            <FileText className="mx-auto mb-2 h-8 w-8 opacity-40" /> Nenhuma solicitação aqui.
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-14">Nº</TableHead>
                <TableHead>Documento</TableHead>
                <TableHead>Situação</TableHead>
                <TableHead className="hidden md:table-cell">Prazo</TableHead>
                <TableHead className="hidden lg:table-cell">Solicitado</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visiveis.map((s) => (
                <TableRow key={s.id} className="cursor-pointer" onClick={() => setAberta(s.id)}>
                  <TableCell className="text-muted-foreground">#{s.id}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-medium">{s.titulo}</span>
                      <Badge variant="outline" className={cn("px-1.5 py-0 text-[10px] font-semibold", TIPO_DOCUMENTO[s.tipo]?.cor)}>
                        {TIPO_DOCUMENTO[s.tipo]?.rotulo ?? s.tipo}
                      </Badge>
                    </div>
                    {s.descricao && <div className="line-clamp-1 max-w-md text-xs text-muted-foreground">{s.descricao}</div>}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={cn("whitespace-normal text-left font-semibold", STATUS_DOCUMENTO[s.status as StatusDocumento].cor)}>
                      {rotuloSituacao(s)}
                    </Badge>
                    {s.status === "concluida" && (
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        {nomeLegivel(s.destinatario_nome)}{s.contrato_nome ? ` — ${s.contrato_nome}` : ""}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    <span className={cn("text-sm", atrasada(s, hoje) && "font-semibold text-red-600")}>{fmtData(s.prazo)}</span>
                    {textoPrazo(s, hoje) && <div className="text-xs text-muted-foreground">{textoPrazo(s, hoje)}</div>}
                  </TableCell>
                  <TableCell className="hidden text-sm lg:table-cell">
                    {new Date(s.created_at).toLocaleDateString("pt-BR")}
                    <div className="text-xs text-muted-foreground">{nomeLegivel(s.solicitante_nome)}</div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      {nova && (
        <NovaSolicitacao onFechar={() => setNova(false)}
          onCriada={(id, tipo) => { setNova(false); setFiltro(tipo === "registro" ? "concluida" : "pendente"); setAberta(id); }}
          onLote={(lote) => { setNova(false); setFiltro("pendente"); setLoteAberto(lote); }} />
      )}
      <DetalheDocumento solicitacao={solicitacaoAberta} lado="rh" podeAnexarRh={podeIncluir || podeAlterar} podeAlterarRh={podeAlterar} onFechar={fechar} />
      {loteAberto && (
        <DialogoLote lote={lotes.find((l) => l.lote_id === loteAberto) ?? null} solicitacoes={todas.filter((x) => x.lote_id === loteAberto)}
          onFechar={() => setLoteAberto(null)} onAbrir={(id) => setAberta(id)} />
      )}
    </div>
  );
}

// ── Nova solicitação ─────────────────────────────────────────────────────
function NovaSolicitacao({ onFechar, onCriada, onLote }: { onFechar: () => void; onCriada: (id: number, tipo: TipoNovoDocumento) => void; onLote: (lote: string) => void }) {
  const opcoes = useOpcoesDocumento();
  const solicitar = useSolicitarDocumento();
  const solicitarLote = useSolicitarLote();
  const inputArquivo = useRef<HTMLInputElement>(null);
  const inputImagem = useRef<HTMLInputElement>(null);
  const [f, setF] = useState<FormSolicitacao>({ tipo: "", titulo: "", descricao: "", modo: "contrato", contrato: "", destinatario_id: "", prazo: "" });
  const [arquivos, setArquivos] = useState<File[]>([]);
  // Prévia das imagens escolhidas (URL local, liberada ao trocar a lista).
  const previas = useMemo(() => arquivos.map((a) => (a.type.startsWith("image/") ? URL.createObjectURL(a) : null)), [arquivos]);
  useEffect(() => () => previas.forEach((u) => u && URL.revokeObjectURL(u)), [previas]);
  const [tentou, setTentou] = useState(false);
  const set = (p: Partial<FormSolicitacao>) => setF((x) => ({ ...x, ...p }));
  // Todos os encarregados (mig 20261025000030): todos marcados; o RH desmarca quem não deve receber.
  const encarregados = useEncarregadosDocumento(f.modo === "encarregados");
  const [fora, setFora] = useState<Set<string>>(new Set());
  const [buscaEnc, setBuscaEnc] = useState("");
  const marcados = (encarregados.data ?? []).filter((x) => !fora.has(x.id));

  const contratos = useMemo(() => opcoes.data?.contratos ?? [], [opcoes.data]);
  const contratoSel = contratos.find((c) => `${c.empresa}__${c.filial}` === f.contrato);
  const responsaveis = contratoSel?.responsaveis ?? [];
  const comLogin = responsaveis.filter((r) => r.auth_user_id);

  // Contrato com um só responsável com login: já escolhe.
  useEffect(() => {
    if (f.modo === "contrato" && f.contrato && !f.destinatario_id && comLogin.length === 1) set({ destinatario_id: comLogin[0].auth_user_id as string });
  }, [f.modo, f.contrato, f.destinatario_id, comLogin]);

  const opcoesContrato = contratos.map((c) => ({
    value: `${c.empresa}__${c.filial}`, label: c.nome ?? `${c.empresa}/${c.filial}`,
    hint: c.responsaveis.length ? c.responsaveis.map((r) => nomeLegivel(r.nome)).join(", ") : "sem responsável na Hierarquia",
  }));
  const opcoesUsuario = (opcoes.data?.usuarios ?? []).map((u) => ({
    value: u.id, label: nomeLegivel(u.nome) || u.email || "—", hint: u.tem_acesso ? u.email ?? undefined : "sem acesso à tela Documentos",
  }));
  const destinoSemAcesso = f.destinatario_id && (f.modo === "contrato"
    ? responsaveis.find((r) => r.auth_user_id === f.destinatario_id)?.tem_acesso === false
    : opcoes.data?.usuarios.find((u) => u.id === f.destinatario_id)?.tem_acesso === false);

  const erros = errosSolicitacao(f, arquivos.length, marcados.length);
  const registro = f.tipo === "registro";

  const salvar = async () => {
    setTentou(true);
    if (erros.length || !f.tipo) return;
    const tipo = f.tipo;
    if (f.modo === "encarregados") {
      if (!confirm(`Enviar "${f.titulo.trim()}" para ${marcados.length} encarregado(s)? Cada um recebe a sua pendência.`)) return;
      try {
        const r = await solicitarLote.mutateAsync({
          tipo, titulo: f.titulo.trim(), descricao: f.descricao.trim(), prazo: f.prazo || null,
          destinatarios: marcados.map((x) => x.id), arquivos,
        });
        toast.success(`Enviado para ${r.ids.length} encarregado(s).`);
        onLote(r.lote);
      } catch (e) { toast.error((e as Error).message); }
      return;
    }
    const c = f.modo === "contrato" ? partirContrato(f.contrato) : null;
    try {
      const id = await solicitar.mutateAsync({
        tipo, titulo: f.titulo.trim(), descricao: f.descricao.trim(),
        contrato_empresa: c?.empresa ?? null, contrato_filial: c?.filial ?? null,
        destinatario_id: f.destinatario_id, prazo: registro ? null : f.prazo || null, arquivos,
      });
      toast.success(registro ? `Documento #${id} registrado.` : `Solicitação #${id} enviada.`);
      onCriada(id, tipo);
    } catch (e) { toast.error((e as Error).message); }
  };
  const adicionar = (files: FileList | null) => setArquivos((a) => [...a, ...Array.from(files ?? [])]);

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onFechar(); }}>
      <DialogContent className="max-h-[92vh] max-w-2xl overflow-y-auto">
        <DialogHeader><DialogTitle>Nova solicitação de documento</DialogTitle></DialogHeader>

        <div className="space-y-3">
          <div>
            <Label>Tipo *</Label>
            <div role="radiogroup" className="mt-1 grid gap-2 sm:grid-cols-2">
              {TIPOS_NOVO_DOCUMENTO.map((t) => {
                const Icone = ICONE_TIPO[t];
                const sel = f.tipo === t;
                return (
                  <button key={t} type="button" role="radio" aria-checked={sel} onClick={() => set({ tipo: t })}
                    className={cn("rounded-lg border p-2.5 text-left transition",
                      sel ? "border-primary bg-primary/5 ring-2 ring-primary/30" : "hover:border-primary/40 hover:bg-muted/40",
                      tentou && !f.tipo && "border-red-300")}>
                    <span className="flex items-center gap-1.5 text-sm font-semibold"><Icone className="h-4 w-4 text-primary" /> {TIPO_DOCUMENTO[t].rotulo}</span>
                    <span className="mt-1 block text-xs leading-snug text-muted-foreground">{TIPO_DOCUMENTO[t].explicacao}</span>
                  </button>
                );
              })}
            </div>
          </div>
          <div>
            <Label>Título *</Label>
            <Input value={f.titulo} maxLength={150} placeholder="ex.: Termo de entrega de EPI — outubro" onChange={(e) => set({ titulo: e.target.value })} />
          </div>
          <div>
            <Label>Descrição da solicitação *</Label>
            <Textarea rows={3} value={f.descricao} placeholder="O que deve ser assinado, por quem, e como devolver."
              onChange={(e) => set({ descricao: e.target.value })} />
          </div>

          <div>
            <Label>Enviar para</Label>
            <Tabs value={f.modo} onValueChange={(v) => set({ modo: v as FormSolicitacao["modo"], destinatario_id: "" })}>
              <TabsList className="mt-1">
                <TabsTrigger value="contrato">Responsável do contrato</TabsTrigger>
                <TabsTrigger value="usuario">Usuário do sistema</TabsTrigger>
                <TabsTrigger value="encarregados" className="gap-1.5"><Users className="h-3.5 w-3.5" /> Todos os encarregados</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>

          {opcoes.isLoading ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Carregando contratos e usuários…</p>
          ) : opcoes.error ? (
            <p className="text-sm text-red-600">{(opcoes.error as Error).message}</p>
          ) : f.modo === "encarregados" ? (
            <ListaEncarregados lista={encarregados.data} carregando={encarregados.isLoading} erro={encarregados.error as Error | null}
              fora={fora} setFora={setFora} busca={buscaEnc} setBusca={setBuscaEnc} />
          ) : f.modo === "contrato" ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label>Contrato *</Label>
                <SearchableSelect value={f.contrato} onChange={(v) => set({ contrato: v, destinatario_id: "" })} options={opcoesContrato}
                  placeholder="Escolha o contrato" searchPlaceholder="Buscar contrato…" />
              </div>
              <div>
                <Label>Responsável pelo contrato *</Label>
                <SearchableSelect value={f.destinatario_id} onChange={(v) => set({ destinatario_id: v })} disabled={!f.contrato}
                  options={comLogin.map((r) => ({ value: r.auth_user_id as string, label: nomeLegivel(r.nome) || "—",
                    hint: r.tem_acesso ? r.posto ?? undefined : "sem acesso à tela Documentos" }))}
                  placeholder={f.contrato ? "Escolha o responsável" : "Escolha o contrato antes"}
                  emptyLabel="Nenhum responsável com login" />
                {f.contrato && responsaveis.length === 0 && (
                  <p className="mt-1 text-xs text-amber-700">Este contrato não tem responsável na Hierarquia de Postos — envie para um usuário do sistema.</p>
                )}
                {f.contrato && responsaveis.length > 0 && comLogin.length === 0 && (
                  <p className="mt-1 text-xs text-amber-700">
                    O responsável ({responsaveis.map((r) => nomeLegivel(r.nome)).join(", ")}) não tem login vinculado ao cadastro — envie para um usuário do sistema.
                  </p>
                )}
              </div>
            </div>
          ) : (
            <div>
              <Label>Usuário *</Label>
              <SearchableSelect value={f.destinatario_id} onChange={(v) => set({ destinatario_id: v })} options={opcoesUsuario}
                placeholder="Escolha o usuário" searchPlaceholder="Buscar por nome ou e-mail…" />
            </div>
          )}
          {/* Assinar não exige a tela: a notificação abre a solicitação em qualquer lugar e o termo aparece no login. */}
          {destinoSemAcesso && f.tipo !== "registro" && (
            <p className="flex items-start gap-1.5 rounded-md border border-sky-200 bg-sky-50 px-2.5 py-1.5 text-xs text-sky-800">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              Essa pessoa não tem a tela Encarregados › Documentos — tudo bem: ela é notificada e assina pelo link da notificação
              {f.tipo === "ciencia" ? " (e o termo aparece para ela ao entrar no sistema)" : ""}. Para ela acompanhar a lista de
              documentos, libere a tela em Administração › Acesso por Usuário.
            </p>
          )}

          <div className={cn("grid gap-3", !registro && "sm:grid-cols-2")}>
            {!registro && (
              <div>
                <Label>Prazo para assinar</Label>
                <Input type="date" value={f.prazo} min={hojeIso()} onChange={(e) => set({ prazo: e.target.value })} />
              </div>
            )}
            <div>
              <Label>{registro ? "Documento a registrar *" : f.tipo === "ciencia" ? "Termo e imagens" : "Documento a assinar"}</Label>
              <input ref={inputArquivo} type="file" multiple className="hidden" onChange={(e) => { adicionar(e.target.files); e.target.value = ""; }} />
              <input ref={inputImagem} type="file" accept="image/*" multiple className="hidden" onChange={(e) => { adicionar(e.target.files); e.target.value = ""; }} />
              <div className="grid grid-cols-2 gap-2">
                <Button type="button" variant="outline" onClick={() => inputArquivo.current?.click()}>
                  <Upload className="mr-1.5 h-4 w-4" /> Arquivo
                </Button>
                <Button type="button" variant="outline" onClick={() => inputImagem.current?.click()}>
                  <ImagePlus className="mr-1.5 h-4 w-4" /> Imagem
                </Button>
              </div>
            </div>
          </div>
          {arquivos.length > 0 && (
            <ul className="space-y-1">
              {arquivos.map((a, i) => (
                <li key={`${a.name}-${i}`} className="flex items-center gap-2 text-sm">
                  {previas[i]
                    ? <img src={previas[i] as string} alt={a.name} className="h-10 w-10 shrink-0 rounded border object-cover" />
                    : <Paperclip className="h-3.5 w-3.5 text-muted-foreground" />}
                  <span className="truncate">{a.name}</span>
                  <button className="ml-auto text-muted-foreground hover:text-red-600" onClick={() => setArquivos((x) => x.filter((_, j) => j !== i))}>
                    <X className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
          {f.tipo && f.tipo !== "registro" && arquivos.some((a) => a.type.startsWith("image/")) && (
            <p className="text-xs text-muted-foreground">As imagens aparecem no card e na janela em que o destinatário assina.</p>
          )}

          {tentou && erros.length > 0 && <p className="text-sm text-red-600">{erros.join(" ")}</p>}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onFechar}>Cancelar</Button>
          <Button onClick={salvar} disabled={solicitar.isPending || solicitarLote.isPending}>
            {(solicitar.isPending || solicitarLote.isPending) && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            {registro ? "Registrar" : f.modo === "encarregados" ? `Enviar para ${marcados.length} encarregado(s)` : "Solicitar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Todos os encarregados: a lista para conferir antes de enviar ────────────
function ListaEncarregados({ lista, carregando, erro, fora, setFora, busca, setBusca }: {
  lista: EncarregadoDocumento[] | undefined; carregando: boolean; erro: Error | null;
  fora: Set<string>; setFora: (s: Set<string>) => void; busca: string; setBusca: (s: string) => void;
}) {
  if (carregando) return <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Buscando os encarregados…</p>;
  if (erro) return <p className="text-sm text-red-600">{erro.message}</p>;
  const todos = lista ?? [];
  const t = busca.trim().toLowerCase();
  const vis = todos.filter((x) => !t || [x.nome, x.cargo, x.contratos].some((v) => String(v ?? "").toLowerCase().includes(t)));
  const alternar = (id: string) => { const n = new Set(fora); if (n.has(id)) n.delete(id); else n.add(id); setFora(n); };
  return (
    <div className="space-y-2 rounded-lg border p-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <b>{todos.length - fora.size}</b> de {todos.length} encarregados vão receber.
        <button type="button" className="text-xs text-primary hover:underline" onClick={() => setFora(new Set())}>Marcar todos</button>
        <div className="relative ml-auto w-56">
          <Search className="absolute left-2 top-2 h-3.5 w-3.5 text-muted-foreground" />
          <Input className="h-8 pl-7 text-xs" placeholder="Buscar…" value={busca} onChange={(e) => setBusca(e.target.value)} />
        </div>
      </div>
      <p className="text-[11px] text-muted-foreground">
        Encarregado = responsável de contrato na Hierarquia de Postos ou colaborador ativo com cargo de encarregado — os dois com login no ERP.
        Quem não tem login não aparece (não teria como ver a pendência).
      </p>
      <div className="max-h-56 space-y-0.5 overflow-y-auto">
        {vis.map((x) => (
          <label key={x.id} className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-muted/50">
            <Checkbox checked={!fora.has(x.id)} onCheckedChange={() => alternar(x.id)} />
            <span className="min-w-0 flex-1 truncate">{nomeLegivel(x.nome) || "—"}
              <span className="ml-1.5 text-xs text-muted-foreground">{x.cargo ?? ""}{x.contratos ? ` · ${x.contratos}` : ""}</span>
            </span>
          </label>
        ))}
        {vis.length === 0 && <p className="px-1.5 py-2 text-xs text-muted-foreground">Ninguém com esse filtro.</p>}
      </div>
    </div>
  );
}

// ── Envios para todos os encarregados: acompanhamento ───────────────────────
const COR_SITUACAO: Record<SituacaoNoLote, string> = {
  concluida: "border-emerald-200 bg-emerald-50 text-emerald-700",
  leu: "border-amber-200 bg-amber-50 text-amber-800",
  nao_abriu: "border-red-200 bg-red-50 text-red-700",
  cancelada: "border-slate-200 bg-slate-50 text-slate-500",
};

function QuadroLotes({ lotes, onAbrir }: { lotes: ResumoLote[]; onAbrir: (lote: string) => void }) {
  return (
    <Card className="p-4">
      <p className="mb-2 flex items-center gap-1.5 text-sm font-semibold"><Users className="h-4 w-4" /> Envios para todos os encarregados</p>
      <div className="space-y-2">
        {lotes.slice(0, 6).map((l) => (
          <button key={l.lote_id} onClick={() => onAbrir(l.lote_id)} className="flex w-full flex-wrap items-center gap-3 rounded-lg border px-3 py-2 text-left hover:border-primary/50 hover:bg-muted/30">
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{l.titulo}</div>
              <div className="text-xs text-muted-foreground">
                {new Date(l.criado_em).toLocaleDateString("pt-BR")} · {TIPO_DOCUMENTO[l.tipo]?.rotulo ?? l.tipo}{l.solicitante ? ` · ${nomeLegivel(l.solicitante)}` : ""}
              </div>
            </div>
            <div className="w-56">
              <Progress value={l.pct} className="h-2" />
              <div className="mt-1 flex justify-between text-[11px] text-muted-foreground">
                <span className="text-emerald-700">{l.concluidas}/{l.total} concluídos</span>
                <span>{l.leram} leram · {l.nao_abriram} não abriram</span>
              </div>
            </div>
          </button>
        ))}
      </div>
    </Card>
  );
}

function DialogoLote({ lote, solicitacoes, onFechar, onAbrir }: {
  lote: ResumoLote | null; solicitacoes: SolicitacaoDocumento[]; onFechar: () => void; onAbrir: (id: number) => void;
}) {
  const [filtro, setFiltro] = useState<SituacaoNoLote | "todas">("todas");
  if (!lote) return null;
  const fmt = (x: string | null | undefined) => (x ? new Date(x).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "—");
  const ordem: Record<SituacaoNoLote, number> = { nao_abriu: 0, leu: 1, concluida: 2, cancelada: 3 };
  const linhas = [...solicitacoes]
    .filter((x) => filtro === "todas" || situacaoNoLote(x) === filtro)
    .sort((a, b) => ordem[situacaoNoLote(a)] - ordem[situacaoNoLote(b)] || String(a.destinatario_nome).localeCompare(String(b.destinatario_nome)));
  const exportar = () => {
    const cab = ["Encarregado", "Contrato", "Situação", "Leu em", "Concluído em", "Observação"];
    const rows = solicitacoes.map((x) => [nomeLegivel(x.destinatario_nome), x.contrato_nome ?? "", ROTULO_SITUACAO_LOTE[situacaoNoLote(x)], fmt(x.lido_em), fmt(x.concluida_em), x.observacao_envio ?? ""]);
    const csv = "\uFEFF" + [cab, ...rows].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(";")).join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a"); a.href = url; a.download = "confirmacoes-documento.csv"; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <Dialog open onOpenChange={(v) => { if (!v) onFechar(); }}>
      <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto">
        <DialogHeader><DialogTitle>{lote.titulo}</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {([["todas", "Encarregados", lote.total], ["concluida", "Concluíram", lote.concluidas], ["leu", "Leram, faltam anexar", lote.leram], ["nao_abriu", "Não abriram", lote.nao_abriram]] as const).map(([k, r, n]) => (
            <button key={k} onClick={() => setFiltro(k)} className={cn("rounded-lg border p-2.5 text-left", filtro === k && "border-primary ring-2 ring-primary/20")}>
              <div className="text-xl font-bold">{n}</div><div className="text-xs text-muted-foreground">{r}</div>
            </button>
          ))}
        </div>
        <Progress value={lote.pct} className="h-2" />
        <div className="flex justify-end">
          <Button variant="outline" size="sm" onClick={exportar}><Download className="mr-1.5 h-4 w-4" /> Exportar confirmações (CSV)</Button>
        </div>
        <Table>
          <TableHeader>
            <TableRow><TableHead>Encarregado</TableHead><TableHead>Situação</TableHead><TableHead>Leu em</TableHead><TableHead>Concluído em</TableHead></TableRow>
          </TableHeader>
          <TableBody>
            {linhas.map((x) => {
              const sit = situacaoNoLote(x);
              return (
                <TableRow key={x.id} className="cursor-pointer" onClick={() => onAbrir(x.id)}>
                  <TableCell>
                    <div className="font-medium">{nomeLegivel(x.destinatario_nome) || "—"}</div>
                    {x.contrato_nome && <div className="text-xs text-muted-foreground">{x.contrato_nome}</div>}
                  </TableCell>
                  <TableCell><Badge variant="outline" className={cn("font-semibold", COR_SITUACAO[sit])}>{ROTULO_SITUACAO_LOTE[sit]}</Badge></TableCell>
                  <TableCell className="text-xs">{fmt(x.lido_em)}</TableCell>
                  <TableCell className="text-xs">{fmt(x.concluida_em)}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </DialogContent>
    </Dialog>
  );
}
