import { useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { AlertTriangle, FileText, Loader2, Paperclip, Upload } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { SeletorContratos } from "@/pages/treinamentos/plataforma/SeletorContratos";
import {
  abrirArquivoDss, enviarArquivoDss, useContratosDss, useLancarPapelDss, useSalvarDss,
  type ContratoDssOpcao, type DssCompleto,
} from "@/hooks/useDss";
import {
  ROTULO_SITUACAO, ROTULO_STATUS_PESSOA, hojeIso, rotuloSemana, segundaDaSemana, somarDias, statusPessoa,
  type PessoaDss, type SituacaoDss, type StatusContratoDss, type StatusPessoaDss,
} from "@/lib/treinamentos/dss";
import { siglaEmpresa } from "@/lib/treinamentos/contratoTreinamento";

// =====================================================================
// DSS (SIS-2026-0891) — peças do lado do SST: formulário de criar/publicar,
// lançamento da folha em papel, selos de status e exportação para Excel.
// =====================================================================

const TAMANHO_MAX = 10 * 1024 * 1024; // = file_size_limit do bucket sst-dss
const TIPOS_ANEXO = "application/pdf,image/png,image/jpeg,image/webp";

export function SeloSituacao({ situacao, vigente }: { situacao: SituacaoDss; vigente?: boolean }) {
  if (situacao === "publicado" && vigente === false) {
    return <Badge variant="outline" className="border-slate-300 text-slate-600">Fora da vigência</Badge>;
  }
  const cor = situacao === "publicado" ? "bg-emerald-100 text-emerald-800 border-emerald-200"
    : situacao === "rascunho" ? "bg-amber-100 text-amber-800 border-amber-200" : "bg-slate-100 text-slate-700 border-slate-200";
  return <Badge variant="outline" className={cor}>{ROTULO_SITUACAO[situacao]}</Badge>;
}

export function SeloPessoa({ status }: { status: StatusPessoaDss }) {
  const cor: Record<StatusPessoaDss, string> = {
    nao_acessado: "bg-red-50 text-red-700 border-red-200",
    aguardando: "bg-amber-50 text-amber-800 border-amber-200",
    assinado: "bg-emerald-50 text-emerald-800 border-emerald-200",
    assinado_papel: "bg-sky-50 text-sky-800 border-sky-200",
  };
  return <Badge variant="outline" className={cn("whitespace-nowrap", cor[status])}>{ROTULO_STATUS_PESSOA[status]}</Badge>;
}

export function SeloContrato({ status }: { status: StatusContratoDss }) {
  if (status === "concluido") return <Badge className="bg-emerald-600 hover:bg-emerald-600">Concluído</Badge>;
  if (status === "pendente") return <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-800">Com pendências</Badge>;
  return <Badge variant="outline">Sem colaboradores</Badge>;
}

export function BarraPct({ valor }: { valor: number }) {
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 w-20 overflow-hidden rounded-full bg-muted">
        <div className={cn("h-full rounded-full", valor >= 100 ? "bg-emerald-500" : valor >= 50 ? "bg-amber-500" : "bg-red-500")}
          style={{ width: `${Math.min(100, valor)}%` }} />
      </div>
      <span className="w-12 text-right text-xs tabular-nums">{valor.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%</span>
    </div>
  );
}

export const fmtDataHoraBr = (s: string | null | undefined) =>
  s ? new Date(s).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" }) : "—";

export function exportarXlsx(nome: string, abas: { nome: string; linhas: Record<string, unknown>[] }[]) {
  const wb = XLSX.utils.book_new();
  for (const a of abas) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(a.linhas.length ? a.linhas : [{ "": "Sem dados" }]), a.nome.slice(0, 31));
  XLSX.writeFile(wb, nome);
}

/** Nome exibido do contrato no seletor — repete a sigla da empresa só quando o nome se repete. */
function nomesUnicos(contratos: ContratoDssOpcao[]) {
  const conta = new Map<string, number>();
  for (const c of contratos) conta.set(c.nome, (conta.get(c.nome) ?? 0) + 1);
  return contratos.map((c) => ({ ...c, rotulo: (conta.get(c.nome) ?? 0) > 1 ? `${c.nome} · ${siglaEmpresa(c.empresa)}` : c.nome }));
}

// ── Criar / editar rascunho / publicar ───────────────────────────────────
export function DssFormDialog({ aberto, onFechar, editando, onSalvo }: {
  aberto: boolean; onFechar: () => void; editando?: DssCompleto | null; onSalvo?: (id: string, publicado: boolean) => void;
}) {
  const contratosQ = useContratosDss();
  const salvar = useSalvarDss();
  const [id, setId] = useState("");
  const [tema, setTema] = useState("");
  const [conteudo, setConteudo] = useState("");
  const [semana, setSemana] = useState("");
  const [de, setDe] = useState("");
  const [ate, setAte] = useState("");
  const [todos, setTodos] = useState(false);
  const [selecionados, setSelecionados] = useState<string[]>([]);
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [anexoAtual, setAnexoAtual] = useState<{ path: string; nome: string | null } | null>(null);
  const [confirmarPublicacao, setConfirmarPublicacao] = useState(false);
  const [enviando, setEnviando] = useState(false);

  const opcoes = useMemo(() => nomesUnicos(contratosQ.data ?? []), [contratosQ.data]);
  const porRotulo = useMemo(() => new Map(opcoes.map((c) => [c.rotulo, c])), [opcoes]);

  useEffect(() => {
    if (!aberto) return;
    const hoje = hojeIso();
    setId(editando?.id ?? crypto.randomUUID());
    setTema(editando?.tema ?? "");
    setConteudo(editando?.conteudo ?? "");
    setSemana(editando?.semana_ref ?? segundaDaSemana(hoje));
    setDe(editando?.disponivel_de ?? hoje);
    setAte(editando ? editando.disponivel_ate ?? "" : somarDias(segundaDaSemana(hoje), 6));
    setTodos(editando?.todos_contratos ?? false);
    setArquivo(null);
    setAnexoAtual(editando?.arquivo_path ? { path: editando.arquivo_path, nome: editando.arquivo_nome } : null);
    setConfirmarPublicacao(false);
    // Pelo id, não pelo objeto: refazer a consulta (foco da janela) não pode apagar o que está sendo digitado.
  }, [aberto, editando?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Os contratos do rascunho viram rótulos quando a lista chega.
  useEffect(() => {
    if (!aberto) return;
    const chaves = new Set((editando?.contratos ?? []).map((c) => `${c.empresa}/${c.filial}`));
    setSelecionados(opcoes.filter((c) => chaves.has(`${c.empresa}/${c.filial}`)).map((c) => c.rotulo));
  }, [aberto, editando?.id, opcoes]); // eslint-disable-line react-hooks/exhaustive-deps

  const escolhidos = selecionados.map((r) => porRotulo.get(r)).filter((c): c is NonNullable<typeof c> => !!c);
  const estimativa = todos ? opcoes.reduce((a, c) => a + c.colaboradores, 0) : escolhidos.reduce((a, c) => a + c.colaboradores, 0);

  const validar = (): string | null => {
    if (!tema.trim()) return "Informe o tema do DSS.";
    if (!conteudo.trim() && !arquivo && !anexoAtual) return "Escreva o conteúdo ou anexe o material do DSS.";
    if (!semana || !de) return "Informe a semana e o início da disponibilização.";
    if (ate && ate < de) return "O fim da disponibilização é antes do início.";
    if (!todos && escolhidos.length === 0) return "Escolha pelo menos um contrato (ou marque todos).";
    if (arquivo && arquivo.size > TAMANHO_MAX) return "O anexo passa de 10 MB.";
    return null;
  };

  const enviar = async (publicar: boolean) => {
    const erro = validar();
    if (erro) return toast.error(erro);
    if (publicar && !confirmarPublicacao) return setConfirmarPublicacao(true);
    setEnviando(true);
    try {
      let anexo = anexoAtual;
      if (arquivo) anexo = { path: await enviarArquivoDss("dss", id, arquivo), nome: arquivo.name };
      setAnexoAtual(anexo);
      setArquivo(null);
      await salvar.mutateAsync({
        publicar,
        dados: {
          id, tema: tema.trim(), conteudo, arquivo_path: anexo?.path ?? null, arquivo_nome: anexo?.nome ?? null,
          semana_ref: segundaDaSemana(semana), disponivel_de: de, disponivel_ate: ate || null,
          todos_contratos: todos, contratos: escolhidos.map((c) => ({ empresa: c.empresa, filial: c.filial, nome: c.nome })),
        },
      });
      toast.success(publicar ? "DSS publicado. Os colaboradores já podem ler e assinar no Portal do Colaborador." : "Rascunho salvo.");
      onSalvo?.(id, publicar);
      onFechar();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível salvar o DSS.");
    } finally {
      setEnviando(false);
    }
  };

  return (
    <Dialog open={aberto} onOpenChange={(v) => !v && !enviando && onFechar()}>
      <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editando ? "Editar rascunho do DSS" : "Novo DSS"}</DialogTitle>
          <DialogDescription>
            Escreva o DSS da semana e escolha para quais contratos ele vai. Ao publicar, ele aparece no Portal do Colaborador
            de cada pessoa desses contratos, que lê e assina pelo celular.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label htmlFor="dss-tema">Tema *</Label>
            <Input id="dss-tema" value={tema} maxLength={200} onChange={(e) => setTema(e.target.value)} placeholder="Ex.: Uso correto das luvas de proteção" />
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <Label htmlFor="dss-semana">Semana de referência *</Label>
              <Input id="dss-semana" type="date" value={semana} onChange={(e) => setSemana(e.target.value)} />
              {semana && <p className="mt-1 text-[11px] text-muted-foreground">{rotuloSemana(segundaDaSemana(semana))}</p>}
            </div>
            <div>
              <Label htmlFor="dss-de">Disponível a partir de *</Label>
              <Input id="dss-de" type="date" value={de} onChange={(e) => setDe(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="dss-ate">Disponível até</Label>
              <Input id="dss-ate" type="date" value={ate} min={de || undefined} onChange={(e) => setAte(e.target.value)} />
              <p className="mt-1 text-[11px] text-muted-foreground">Vazio = fica disponível até você encerrar.</p>
            </div>
          </div>

          <div>
            <Label htmlFor="dss-conteudo">Conteúdo</Label>
            <Textarea id="dss-conteudo" rows={10} value={conteudo} onChange={(e) => setConteudo(e.target.value)}
              placeholder="Texto que o colaborador vai ler no celular. Pode colar o DSS inteiro aqui." />
          </div>

          <div className="space-y-2">
            <Label>Material anexo (PDF ou imagem, até 10 MB)</Label>
            {anexoAtual && !arquivo && (
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <Paperclip className="h-4 w-4 text-muted-foreground" />
                <button type="button" className="text-primary underline" onClick={() => abrirArquivoDss(anexoAtual.path).catch((e) => toast.error(e.message))}>
                  {anexoAtual.nome ?? "anexo"}
                </button>
                <Button type="button" variant="ghost" size="sm" onClick={() => setAnexoAtual(null)}>Remover</Button>
              </div>
            )}
            <Input type="file" accept={TIPOS_ANEXO} onChange={(e) => setArquivo(e.target.files?.[0] ?? null)} />
          </div>

          <div className="space-y-2 rounded-lg border p-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <Label htmlFor="dss-todos">Enviar para todos os contratos</Label>
                <p className="text-xs text-muted-foreground">Desligado: escolha os contratos abaixo (dá para marcar grupos, como "Todas UFRGS").</p>
              </div>
              <Switch id="dss-todos" checked={todos} onCheckedChange={setTodos} />
            </div>
            {!todos && (
              contratosQ.isLoading ? <p className="text-sm text-muted-foreground">Carregando contratos…</p> : (
                <SeletorContratos
                  contratos={opcoes.map((c) => ({ nome: c.rotulo, alunos: c.colaboradores }))}
                  value={selecionados} onChange={setSelecionados} textoLimpar="Limpar seleção"
                />
              )
            )}
            <p className="text-xs text-muted-foreground">
              Hoje {todos ? "todos os contratos somam" : `${escolhidos.length} contrato(s) somam`}{" "}
              <b>{estimativa.toLocaleString("pt-BR")}</b> colaborador(es) ativo(s). Quem entrar nesses contratos enquanto o DSS estiver disponível também recebe.
            </p>
          </div>

          {confirmarPublicacao && (
            <div className="flex gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <p>
                Depois de publicado, <b>o texto, o anexo e os contratos não podem mais ser alterados</b> — a assinatura de cada
                colaborador comprova a ciência deste conteúdo exato. Para corrigir, encerre e publique um novo. Confira e clique
                em <b>Confirmar publicação</b>.
              </p>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onFechar} disabled={enviando}>Cancelar</Button>
          <Button variant="secondary" onClick={() => enviar(false)} disabled={enviando}>Salvar rascunho</Button>
          <Button onClick={() => enviar(true)} disabled={enviando}>
            {enviando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {confirmarPublicacao ? "Confirmar publicação" : "Publicar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Folha em papel ───────────────────────────────────────────────────────
export function LancarPapelDialog({ aberto, onFechar, dssId, contrato, pessoas }: {
  aberto: boolean; onFechar: () => void; dssId: string;
  contrato: { empresa: number; filial: number; nome: string } | null; pessoas: PessoaDss[];
}) {
  const lancar = useLancarPapelDss();
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [marcados, setMarcados] = useState<Set<number>>(new Set());
  const pendentes = useMemo(() => pessoas.filter((p) => {
    const s = statusPessoa(p);
    return contrato && p.empresa === contrato.empresa && p.filial === contrato.filial && s !== "assinado" && s !== "assinado_papel";
  }), [pessoas, contrato]);

  useEffect(() => { if (aberto) { setArquivo(null); setMarcados(new Set()); } }, [aberto]);

  const alterna = (id: number) => setMarcados((m) => {
    const n = new Set(m);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });
  const todosMarcados = pendentes.length > 0 && pendentes.every((p) => marcados.has(p.empregado_id));

  const enviar = async () => {
    if (!contrato) return;
    if (!arquivo) return toast.error("Anexe a foto ou o PDF da folha assinada.");
    if (arquivo.size > TAMANHO_MAX) return toast.error("O arquivo passa de 10 MB.");
    if (marcados.size === 0) return toast.error("Marque quem assinou a folha.");
    try {
      const r = await lancar.mutateAsync({ dssId, empresa: contrato.empresa, filial: contrato.filial, arquivo, empregados: [...marcados] });
      toast.success(`${r.lancados} assinatura(s) em papel registrada(s).${r.ja_assinados ? ` ${r.ja_assinados} já estava(m) assinada(s).` : ""}`);
      onFechar();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível lançar a folha.");
    }
  };

  return (
    <Dialog open={aberto} onOpenChange={(v) => !v && !lancar.isPending && onFechar()}>
      <DialogContent className="max-h-[92vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Lançar folha assinada em papel</DialogTitle>
          <DialogDescription>
            {contrato?.nome}. Anexe a folha que voltou assinada do contrato e marque quem assinou nela. Quem já assinou
            pelo portal não aparece aqui.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>Folha assinada (foto ou PDF, até 10 MB) *</Label>
            <Input type="file" accept={TIPOS_ANEXO} onChange={(e) => setArquivo(e.target.files?.[0] ?? null)} />
          </div>
          <div className="rounded-lg border">
            <label className="flex items-center gap-2 border-b bg-muted/40 px-3 py-2 text-sm font-medium">
              <Checkbox checked={todosMarcados} disabled={pendentes.length === 0}
                onCheckedChange={(v) => setMarcados(v === true ? new Set(pendentes.map((p) => p.empregado_id)) : new Set())} />
              Marcar todos ({pendentes.length} pendente(s))
            </label>
            <div className="max-h-72 overflow-y-auto">
              {pendentes.length === 0 && <p className="p-3 text-sm text-muted-foreground">Ninguém pendente neste contrato.</p>}
              {pendentes.map((p) => (
                <label key={p.empregado_id} className="flex items-center gap-2 border-b px-3 py-2 text-sm last:border-0">
                  <Checkbox checked={marcados.has(p.empregado_id)} onCheckedChange={() => alterna(p.empregado_id)} />
                  <span className="flex-1">{p.nome}</span>
                  <span className="text-xs text-muted-foreground">{p.matricula ? `Mat. ${p.matricula}` : ""}</span>
                </label>
              ))}
            </div>
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onFechar} disabled={lancar.isPending}>Cancelar</Button>
          <Button onClick={enviar} disabled={lancar.isPending}>
            {lancar.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
            Lançar {marcados.size || ""} assinatura(s)
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function LinkAnexo({ path, nome }: { path: string; nome: string | null }) {
  return (
    <button type="button" className="inline-flex items-center gap-1 text-sm text-primary underline"
      onClick={() => abrirArquivoDss(path).catch((e) => toast.error(e instanceof Error ? e.message : "Não foi possível abrir."))}>
      <FileText className="h-4 w-4" /> {nome ?? "Abrir anexo"}
    </button>
  );
}
