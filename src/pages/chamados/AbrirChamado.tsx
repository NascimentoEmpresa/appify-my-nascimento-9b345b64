import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useVinculoEmpregado } from "@/hooks/useVinculoEmpregado";
import { useChamadoPerms } from "./useChamadoPerms";
import { useToast } from "@/hooks/use-toast";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Flag, UploadCloud, Info, XCircle, CheckCircle2, Lightbulb, Clock, X, Star, ClipboardPaste, FileText, ListChecks } from "lucide-react";
import type { PendenciaSolicitante } from "./validacaoPresidencia";
import {
  CATEGORIAS, TIPOS, IMPACTOS, URGENCIAS, MODULOS_ERP, AMBIENTES, PRIORIDADES, BUCKET_CHAMADOS,
} from "./types";
import { imagensDoClipboard } from "@/lib/imagensColadas";

const TITULO_MAX = 120;
const TAMANHO_MAX_MB = 20; // igual ao limite do bucket (mesmo valor do ChatChamado)

// O que uma boa descrição responde — aparece como guia acima do campo, e o
// "Usar roteiro" preenche o campo com as mesmas perguntas (28/09/2026).
const GUIA_DESCRICAO = [
  { t: "O que aconteceu", d: "o erro, a mensagem ou o que precisa mudar" },
  { t: "Onde e como", d: "a tela e o passo a passo até chegar lá" },
  { t: "O que você esperava", d: "o resultado certo, na sua visão" },
];
const ROTEIRO_DESCRICAO =
  "O que aconteceu:\n\n\nOnde (tela) e passo a passo:\n1. \n2. \n\nO que eu esperava:\n";

const EXEMPLOS = [
  "Erro ao salvar registro", "Relatório com informações incorretas", "Campo não está atualizando",
  "Ajuste no filtro de pesquisa", "Permissão de acesso incorreta", "Relatório / Dashboard com erro no Power BI",
];

const sanitizeNome = (nome: string) =>
  nome.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-zA-Z0-9._-]/g, "_");

export default function AbrirChamado({ base = "/app/central-servicos/chamados" }: { base?: string }) {
  const nav = useNavigate();
  const { user } = useAuth();
  const { empregado } = useVinculoEmpregado();
  const { canAbrir, loading: permLoading } = useChamadoPerms();
  const { toast } = useToast();

  // Avaliações pendentes: não pode abrir novo chamado enquanto houver chamado
  // concluído sem avaliação (regra também enforçada por trigger no banco).
  // Chamado ainda na validação da Presidência não conta (mig 273). O
  // treinamento não trava: é confirmado em Treinamentos Sistemas.
  const { data: avaliacoesPendentes = [] } = useQuery({
    queryKey: ["chamados-avaliacoes-pendentes"],
    queryFn: async () => {
      const { data } = await (supabase as any).rpc("chamados_meus_avaliacoes_pendentes");
      return (data ?? []) as PendenciaSolicitante[];
    },
  });

  const nome = empregado?.nome || (user?.user_metadata as any)?.nome || user?.email || "—";
  const setor = empregado?.setor || "—";

  const [assunto, setAssunto] = useState("");
  const [categorias, setCategorias] = useState<string[]>([]);
  const [tipo, setTipo] = useState("");
  const [prioridade, setPrioridade] = useState("");
  const [descricao, setDescricao] = useState("");
  const [observacoes, setObservacoes] = useState("");
  const [impacto, setImpacto] = useState("");
  const [urgencia, setUrgencia] = useState("");
  const [modulo, setModulo] = useState("");
  const [moduloOutro, setModuloOutro] = useState("");
  const [ambiente, setAmbiente] = useState("producao");
  const [afetaUsuarios, setAfetaUsuarios] = useState("");
  const [arquivos, setArquivos] = useState<File[]>([]);
  const [salvando, setSalvando] = useState(false);
  const [arrastando, setArrastando] = useState(false);

  // Arquivo acima do limite do bucket nem entra na lista (antes o erro só
  // aparecia depois de enviar, como "anexo com falha").
  const adicionarArquivos = (novos: File[]) => {
    const limite = TAMANHO_MAX_MB * 1024 * 1024;
    const grandes = novos.filter((f) => f.size > limite);
    if (grandes.length) {
      toast({ title: `Arquivo acima de ${TAMANHO_MAX_MB} MB`, description: grandes.map((f) => f.name).join(", "), variant: "destructive" });
    }
    const ok = novos.filter((f) => f.size <= limite);
    if (ok.length) setArquivos((cur) => [...cur, ...ok]);
    return ok.length;
  };

  // Ctrl+V com print em QUALQUER lugar da tela vira anexo (28/09/2026) — o
  // print é colado logo depois de tirado, quase sempre com o cursor no campo
  // de descrição. Texto colado segue normal: só imagem é interceptada.
  useEffect(() => {
    const aoColar = (ev: ClipboardEvent) => {
      const imagens = imagensDoClipboard(ev.clipboardData);
      if (!imagens.length) return;
      ev.preventDefault(); // senão o navegador cola o caminho do arquivo no texto
      const n = adicionarArquivos(imagens);
      if (n) toast({ title: n === 1 ? "Print anexado" : `${n} prints anexados`, description: "Aparece em Prints e anexos, abaixo da descrição." });
    };
    window.addEventListener("paste", aoColar);
    return () => window.removeEventListener("paste", aoColar);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Miniatura das imagens anexadas; as URLs são liberadas quando a lista muda.
  const previas = useMemo(
    () => arquivos.map((f) => (f.type.startsWith("image/") ? URL.createObjectURL(f) : null)),
    [arquivos],
  );
  useEffect(() => () => previas.forEach((u) => u && URL.revokeObjectURL(u)), [previas]);

  const toggleCategoria = (v: string) =>
    setCategorias((cur) => (cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v]));

  const [erroValidacao, setErroValidacao] = useState(false);

  // Campos obrigatórios (na ordem do formulário). Serve para dizer EXATAMENTE
  // o que falta preencher quando o usuário tenta enviar — em vez de só travar.
  const faltando = useMemo(() => {
    const req = [
      { id: "campo-assunto",     label: "Título",               ok: !!assunto.trim() },
      { id: "campo-categorias",  label: "Categorias",           ok: categorias.length > 0 },
      { id: "campo-tipo",        label: "Tipo de solicitação",  ok: !!tipo },
      { id: "campo-modulo",      label: "Módulo / Sistema",     ok: !!modulo },
      { id: "campo-modulo",      label: "Qual sistema (Outro)", ok: modulo !== "outro" || !!moduloOutro.trim() },
      { id: "campo-prioridade",  label: "Prioridade",           ok: !!prioridade },
      { id: "campo-descricao",   label: "Descrição",            ok: !!descricao.trim() && descricao.trim() !== ROTEIRO_DESCRICAO.trim() },
      { id: "campo-impacto",     label: "Impacto no trabalho",  ok: !!impacto },
      { id: "campo-urgencia",    label: "Urgência",             ok: !!urgencia },
    ];
    return req.filter((c) => !c.ok);
  }, [assunto, categorias, tipo, modulo, moduloOutro, prioridade, descricao, impacto, urgencia]);
  const podeEnviar = faltando.length === 0;

  const irParaCampo = (campoId: string) =>
    document.getElementById(campoId)?.scrollIntoView({ behavior: "smooth", block: "center" });

  const limpar = () => {
    setAssunto(""); setCategorias([]); setTipo(""); setPrioridade(""); setDescricao(""); setObservacoes("");
    setImpacto(""); setUrgencia(""); setModulo(""); setModuloOutro(""); setAmbiente("producao");
    setAfetaUsuarios(""); setArquivos([]);
  };

  const enviar = async () => {
    if (!podeEnviar) {
      setErroValidacao(true);
      setTimeout(() => setErroValidacao(false), 600);
      irParaCampo(faltando[0].id);
      toast({
        title: `Faltam ${faltando.length} ${faltando.length === 1 ? "campo" : "campos"} para enviar`,
        description: faltando.map((f) => f.label).join(" · "),
        variant: "destructive",
      });
      return;
    }
    setSalvando(true);
    const { data, error } = await (supabase as any).from("CHAMADO_SISTEMA").insert({
      assunto: assunto.trim(),
      categorias,
      tipo_solicitacao: tipo,
      prioridade,
      descricao: descricao.trim(),
      observacoes_solicitante: observacoes.trim() || null,
      impacto_trabalho: impacto,
      urgencia,
      modulo_sistema: modulo,
      modulo_sistema_outro: modulo === "outro" ? moduloOutro.trim() || null : null,
      ambiente,
      afeta_usuarios: afetaUsuarios ? Number(afetaUsuarios) : null,
      solicitante_nome: nome !== "—" ? nome : null,
      setor: setor !== "—" ? setor : null,
    }).select("id, numero").single();

    if (error) { setSalvando(false); toast({ title: "Erro ao abrir chamado", description: error.message, variant: "destructive" }); return; }

    supabase.functions.invoke("notificar-chamado-whatsapp", { body: { chamado_id: data.id, evento: "criado" } }).catch(() => {});

    // Anexos (best-effort). O evento de "Chamado aberto" é gravado por trigger.
    const falhas: string[] = [];
    for (const file of arquivos) {
      const path = `${data.id}/${Date.now()}-${sanitizeNome(file.name)}`;
      const up = await supabase.storage.from(BUCKET_CHAMADOS).upload(path, file, { contentType: file.type });
      if (up.error) { falhas.push(file.name); continue; }
      await (supabase as any).from("CHAMADO_SISTEMA_ANEXO").insert({
        chamado_id: data.id, storage_path: path, nome_arquivo: file.name,
        mime_type: file.type || null, tamanho_bytes: file.size, campo: "abertura",
      });
    }

    setSalvando(false);
    toast({
      title: `Chamado ${data.numero} aberto`,
      description: falhas.length ? `Anexos com falha: ${falhas.join(", ")}` : "Você receberá um número de protocolo para acompanhar.",
    });
    nav(base);
  };

  if (!permLoading && !canAbrir) {
    return (
      <div>
        <PageHeader title="Abrir Novo Chamado" module="Central de Serviços" breadcrumb={["Chamados de Sistemas", "Abrir Novo Chamado"]} />
        <Card className="p-6 text-sm text-muted-foreground">
          Você não tem permissão para abrir chamados. Fale com o administrador para liberar
          <b> Chamados — Abrir chamado (solicitar)</b> em Acesso por Usuário.
        </Card>
      </div>
    );
  }

  if (avaliacoesPendentes.length > 0) {
    return (
      <div>
        <PageHeader title="Abrir Novo Chamado" module="Central de Serviços" breadcrumb={["Chamados de Sistemas", "Abrir Novo Chamado"]} />
        <Card className="space-y-3 border-warning/40 bg-warning/5 p-6">
          <p className="flex items-center gap-1.5 text-sm font-bold text-warning"><Star className="h-4 w-4" /> Você tem avaliação(ões) pendente(s)</p>
          <p className="text-sm text-muted-foreground">
            Antes de abrir um novo chamado, avalie {avaliacoesPendentes.length === 1 ? "o chamado concluído" : `os ${avaliacoesPendentes.length} chamados concluídos`} abaixo:
          </p>
          <div className="space-y-1.5">
            {avaliacoesPendentes.map((p) => (
              <button key={p.id} onClick={() => nav(`${base}/${p.id}/acompanhar`)}
                className="flex w-full items-center justify-between gap-2 rounded border border-border px-3 py-2 text-left text-sm hover:border-warning/50">
                <span className="min-w-0 flex-1 truncate"><span className="font-mono text-xs font-semibold">#{p.numero}</span> {p.assunto}</span>
                <span className="flex shrink-0 items-center gap-1 text-warning"><Star className="h-4 w-4" /> Avaliar</span>
              </button>
            ))}
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Abrir Novo Chamado"
        subtitle="Preencha as informações abaixo para que possamos entender e resolver sua solicitação."
        module="Central de Serviços"
        breadcrumb={["Chamados de Sistemas", "Abrir Novo Chamado"]}
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-4">
          {/* Cabeçalho da solicitação */}
          <Card className="grid gap-4 p-4 sm:grid-cols-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">ID da solicitação</p>
              <p className="text-sm font-semibold">gerado ao enviar</p>
            </div>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Quem solicita</p>
              <p className="text-sm font-semibold">{nome}</p>
            </div>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Setor</p>
              <p className="text-sm font-semibold">{setor}</p>
            </div>
          </Card>

          {/* ── 1. Título + descrição + prints (28/09/2026) ──────────────────
              Antes o "Assunto" dividia linha com as categorias e a descrição
              ficava lá embaixo, depois da prioridade: quem abria o chamado
              preenchia classificação antes de contar o problema. Agora o
              relato vem primeiro, junto com os prints (Ctrl+V em qualquer
              lugar da tela), e a classificação depois. */}
          <Card className="space-y-5 p-5">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-sm font-bold text-foreground">1. O que você precisa?</p>
              <p className="text-xs text-muted-foreground">Campos com <span className="text-destructive">*</span> são obrigatórios.</p>
            </div>

            <div id="campo-assunto" className="scroll-mt-24">
              <Label htmlFor="ch-titulo" className="block text-sm font-semibold">Título <span className="text-destructive">*</span></Label>
              <p className="mb-2 mt-0.5 text-xs text-muted-foreground">Uma frase que resume o problema ou o pedido — é o que o time lê primeiro na fila.</p>
              <Input
                id="ch-titulo" maxLength={TITULO_MAX}
                className="h-11 text-base font-medium"
                placeholder="Ex.: Relatório de comissões sai sem a coluna “Valor”"
                value={assunto} onChange={(e) => setAssunto(e.target.value)}
              />
              <div className="mt-1 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                <span>
                  <span className="text-success">✓ Bom:</span> diz <i>o quê</i> e <i>onde</i>.{" "}
                  <span className="text-destructive">✗ Evite:</span> “Erro”, “Ajuda”, “Urgente”.
                </span>
                <span className="shrink-0">{assunto.length}/{TITULO_MAX}</span>
              </div>
            </div>

            <div id="campo-descricao" className="scroll-mt-24">
              <div className="flex flex-wrap items-end justify-between gap-2">
                <div>
                  <Label htmlFor="ch-descricao" className="block text-sm font-semibold">Descrição <span className="text-destructive">*</span></Label>
                  <p className="mt-0.5 text-xs text-muted-foreground">Conte como se o time não conhecesse a sua tela.</p>
                </div>
                {!descricao.trim() && (
                  <Button type="button" variant="outline" size="sm" className="h-7 gap-1 text-xs" onClick={() => setDescricao(ROTEIRO_DESCRICAO)}>
                    <ListChecks className="h-3.5 w-3.5" /> Usar roteiro
                  </Button>
                )}
              </div>
              <div className="mb-2 mt-2 grid gap-1.5 sm:grid-cols-3">
                {GUIA_DESCRICAO.map((g, i) => (
                  <div key={g.t} className="rounded-md border border-border bg-muted/40 px-2.5 py-1.5">
                    <p className="text-[11px] font-semibold text-foreground">{i + 1}. {g.t}</p>
                    <p className="text-[11px] text-muted-foreground">{g.d}</p>
                  </div>
                ))}
              </div>
              <Textarea
                id="ch-descricao" rows={8} maxLength={4000}
                className="text-sm leading-relaxed"
                placeholder="O que aconteceu, em qual tela, o passo a passo até o problema e o que você esperava que acontecesse."
                value={descricao} onChange={(e) => setDescricao(e.target.value)}
              />
              <div className="mt-1 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                <span className="flex items-center gap-1"><ClipboardPaste className="h-3.5 w-3.5" /> Tirou print? Cole aqui com <kbd className="rounded border border-border bg-muted px-1 font-mono text-[10px]">Ctrl</kbd>+<kbd className="rounded border border-border bg-muted px-1 font-mono text-[10px]">V</kbd> — vira anexo.</span>
                <span className="shrink-0">{descricao.length}/4000</span>
              </div>
            </div>

            {/* Prints e anexos — logo abaixo do relato que eles ilustram. */}
            <div>
              <p className="mb-1.5 text-sm font-semibold">Prints e anexos <span className="font-normal text-muted-foreground">(opcional)</span></p>
              <label
                onDragOver={(e) => { e.preventDefault(); setArrastando(true); }}
                onDragLeave={() => setArrastando(false)}
                onDrop={(e) => { e.preventDefault(); setArrastando(false); adicionarArquivos(Array.from(e.dataTransfer.files ?? [])); }}
                className={`flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed p-5 text-center transition-colors ${arrastando ? "border-primary bg-primary/5" : "border-border hover:border-primary/40"}`}
              >
                <UploadCloud className="h-6 w-6 text-muted-foreground" />
                <span className="text-sm font-medium">Cole com Ctrl+V, arraste aqui ou clique para selecionar</span>
                <span className="text-[11px] text-muted-foreground">PNG, JPG, PDF, DOC, XLS, ZIP — máx. {TAMANHO_MAX_MB} MB por arquivo</span>
                <input
                  type="file" multiple className="hidden"
                  accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.zip,image/*"
                  onChange={(e) => { adicionarArquivos(Array.from(e.target.files ?? [])); e.target.value = ""; }}
                />
              </label>
              {arquivos.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {arquivos.map((f, i) => (
                    <div key={`${f.name}-${i}`} className="group relative flex w-28 flex-col overflow-hidden rounded-md border border-border bg-background">
                      {previas[i]
                        ? <img src={previas[i]!} alt={f.name} className="h-20 w-full object-cover" />
                        : <div className="grid h-20 place-items-center bg-muted/50"><FileText className="h-6 w-6 text-muted-foreground" /></div>}
                      <span className="truncate px-1.5 py-1 text-[10px]" title={f.name}>{f.name}</span>
                      <button
                        type="button" aria-label={`Remover ${f.name}`}
                        onClick={() => setArquivos((cur) => cur.filter((_, j) => j !== i))}
                        className="absolute right-1 top-1 grid h-5 w-5 place-items-center rounded-full bg-background/90 text-muted-foreground shadow hover:text-destructive"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </Card>

          <Card className="space-y-5 p-5">
            <p className="text-sm font-bold text-foreground">2. Classificação</p>

            <div className="grid gap-4 md:grid-cols-2">
              <div id="campo-categorias" className="scroll-mt-24">
                <Label className="mb-1.5 block text-xs font-semibold">Categorias <span className="text-destructive">*</span> <span className="font-normal text-muted-foreground">(uma ou mais)</span></Label>
                <div className="grid grid-cols-2 gap-1.5">
                  {CATEGORIAS.map((c) => (
                    <label key={c.value} className="flex items-center gap-2 text-xs">
                      <Checkbox checked={categorias.includes(c.value)} onCheckedChange={() => toggleCategoria(c.value)} />
                      <span>{c.label}</span>
                    </label>
                  ))}
                </div>
              </div>
              <div id="campo-tipo" className="scroll-mt-24">
                <Label className="mb-1.5 block text-xs font-semibold">Tipo de solicitação <span className="text-destructive">*</span></Label>
                <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                  {TIPOS.map((t) => (
                    <label key={t.value} className="flex items-center gap-2 text-xs">
                      <Checkbox checked={tipo === t.value} onCheckedChange={() => setTipo(t.value)} />
                      <span>{t.label}</span>
                    </label>
                  ))}
                </div>
              </div>
              <div id="campo-modulo" className="scroll-mt-24">
                <Label className="mb-1.5 block text-xs font-semibold">Módulo / Sistema <span className="text-destructive">*</span></Label>
                <Select value={modulo} onValueChange={setModulo}>
                  <SelectTrigger><SelectValue placeholder="Selecione o sistema…" /></SelectTrigger>
                  <SelectContent>
                    {MODULOS_ERP.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
                  </SelectContent>
                </Select>
                {modulo === "outro" && (
                  <Input className="mt-2" placeholder="Qual sistema?" value={moduloOutro} onChange={(e) => setModuloOutro(e.target.value)} />
                )}
              </div>
            </div>

            <div id="campo-prioridade" className="scroll-mt-24">
              <Label className="mb-1.5 block text-xs font-semibold">Prioridade <span className="text-destructive">*</span></Label>
              <div className="grid gap-2 sm:grid-cols-3">
                {(["alta", "media", "baixa"] as const).map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setPrioridade(p)}
                    className={`flex items-center gap-2 rounded-lg border p-3 text-left transition-colors ${
                      prioridade === p ? "border-primary bg-primary/5 ring-1 ring-primary" : "border-border hover:border-primary/40"
                    }`}
                  >
                    <Flag className={`h-4 w-4 ${p === "alta" ? "text-destructive" : p === "media" ? "text-warning" : "text-success"}`} />
                    <div>
                      <p className="text-sm font-semibold">{PRIORIDADES[p].label}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {p === "alta" ? "Impacto crítico ou urgência" : p === "media" ? "Impacto moderado" : "Impacto baixo"}
                      </p>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <Label className="mb-1.5 block text-xs font-semibold">Observações adicionais <span className="font-normal text-muted-foreground">(opcional)</span></Label>
              <Textarea
                rows={3} maxLength={2000}
                placeholder="Contexto adicional, resultado esperado, horários em que ocorre, exemplos…"
                value={observacoes} onChange={(e) => setObservacoes(e.target.value)}
              />
              <p className="mt-1 text-right text-[11px] text-muted-foreground">{observacoes.length}/2000 caracteres</p>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div id="campo-impacto" className="scroll-mt-24">
                <Label className="mb-1.5 block text-xs font-semibold">Impacto no trabalho <span className="text-destructive">*</span></Label>
                <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                  {IMPACTOS.map((i) => (
                    <label key={i.value} className="flex items-center gap-2 text-xs">
                      <Checkbox checked={impacto === i.value} onCheckedChange={() => setImpacto(i.value)} />
                      <span>{i.label}</span>
                    </label>
                  ))}
                </div>
              </div>
              <div id="campo-urgencia" className="scroll-mt-24">
                <Label className="mb-1.5 block text-xs font-semibold">Urgência <span className="text-destructive">*</span> <span className="font-normal text-muted-foreground">(prazo que precisa)</span></Label>
                <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                  {URGENCIAS.map((u) => (
                    <label key={u.value} className="flex items-center gap-2 text-xs">
                      <Checkbox checked={urgencia === u.value} onCheckedChange={() => setUrgencia(u.value)} />
                      <span>{u.label}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <Label className="mb-1.5 block text-xs font-semibold">Ambiente</Label>
                <Select value={ambiente} onValueChange={setAmbiente}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {AMBIENTES.map((a) => <SelectItem key={a.value} value={a.value}>{a.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="mb-1.5 block text-xs font-semibold">Afeta quantos usuários?</Label>
                <Input type="number" min={0} placeholder="Opcional" value={afetaUsuarios} onChange={(e) => setAfetaUsuarios(e.target.value)} />
              </div>
            </div>
          </Card>

          {faltando.length > 0 && (
            <Card className={`border-warning/40 bg-warning/5 p-3 ${erroValidacao ? "animate-shake" : ""}`}>
              <p className="flex items-center gap-1.5 text-xs font-semibold text-warning">
                <Info className="h-3.5 w-3.5" /> Faltam {faltando.length} {faltando.length === 1 ? "campo obrigatório" : "campos obrigatórios"}. Clique para ir até ele:
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {faltando.map((f) => (
                  <button
                    key={f.label}
                    type="button"
                    onClick={() => irParaCampo(f.id)}
                    className="flex items-center gap-1.5 rounded-full border border-warning/50 bg-background px-2.5 py-1 text-[11px] font-medium transition-transform hover:border-warning hover:bg-warning/10 active:scale-90"
                  >
                    <span className="h-1.5 w-1.5 rounded-full bg-warning" /> {f.label}
                  </button>
                ))}
              </div>
            </Card>
          )}

          <div className="flex items-center justify-between">
            <Button variant="outline" onClick={() => nav(base)}>Cancelar</Button>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={limpar}>Limpar</Button>
              <Button
                onClick={enviar}
                disabled={salvando}
                className={`gap-1.5 transition-transform active:scale-95 ${erroValidacao ? "animate-shake" : ""} ${!podeEnviar ? "bg-muted text-muted-foreground hover:bg-muted" : ""}`}
              >
                {salvando ? "Enviando…" : podeEnviar ? "Enviar chamado" : `Enviar chamado — faltam ${faltando.length}`}
              </Button>
            </div>
          </div>
          <p className="text-center text-[11px] text-muted-foreground">Ao enviar, você receberá um número de protocolo para acompanhar o andamento.</p>
        </div>

        {/* Coluna lateral informativa */}
        <div className="space-y-4">
          <Card className="space-y-2 border-info/30 bg-info/5 p-4">
            <p className="flex items-center gap-1.5 text-sm font-semibold text-info"><Info className="h-4 w-4" /> Sobre este canal</p>
            <p className="text-xs text-muted-foreground">Este canal é exclusivo para ajustes, correções e melhorias em funcionalidades já existentes, além de dúvidas de uso que impactam o seu dia a dia.</p>
            <p className="text-xs text-muted-foreground">Nosso time analisará e retornará o mais breve possível.</p>
          </Card>
          <Card className="space-y-2 p-4">
            <p className="flex items-center gap-1.5 text-sm font-semibold text-destructive"><XCircle className="h-4 w-4" /> Não utilize para:</p>
            <ul className="space-y-1 text-xs text-muted-foreground">
              <li>• Criação de novos módulos ou funcionalidades</li>
              <li>• Novas integrações ou automações complexas</li>
              <li>• Solicitações estratégicas ou mudanças de processo</li>
            </ul>
          </Card>
          <Card className="space-y-2 p-4">
            <p className="flex items-center gap-1.5 text-sm font-semibold text-success"><CheckCircle2 className="h-4 w-4" /> Dicas para atendimento mais rápido</p>
            <ul className="space-y-1 text-xs text-muted-foreground">
              <li>• Seja claro e objetivo na descrição</li>
              <li>• Informe o passo a passo para reproduzir o erro</li>
              <li>• Anexe imagens ou documentos que ajudem</li>
              <li>• Informe o impacto e a urgência corretamente</li>
            </ul>
          </Card>
          <Card className="space-y-2 p-4">
            <p className="flex items-center gap-1.5 text-sm font-semibold"><Lightbulb className="h-4 w-4 text-warning" /> Exemplos de assuntos</p>
            <ul className="space-y-1 text-xs text-muted-foreground">
              {EXEMPLOS.map((e) => <li key={e}>• {e}</li>)}
            </ul>
          </Card>
          <Card className="space-y-1 p-4">
            <p className="flex items-center gap-1.5 text-sm font-semibold"><Clock className="h-4 w-4 text-primary" /> Horário de atendimento</p>
            <p className="text-xs text-muted-foreground">Segunda a Sexta-feira | 8h às 12h e 13h às 17h</p>
            <p className="text-[11px] text-muted-foreground/70">Chamados fora do horário serão avaliados no próximo dia útil.</p>
          </Card>
        </div>
      </div>
    </div>
  );
}
