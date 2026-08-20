import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PageHeader } from "@/components/layout/PageHeader";
import { BuscaColaborador, type EmpregadoEscolhido } from "@/components/demissao/BuscaColaborador";
import {
  ACCEPT_ANEXO, BUCKET, MODELOS_AVISO, MOTIVOS_PEDIDO, MOTIVOS_SOLICITACAO,
  TABELA, TABELA_ANEXOS, TERMINOS_EXPERIENCIA,
  corDoStatus, emailValido, erroDoArquivo, explicaStatus, fmtData, fmtTamanho,
  hojeISO, mascaraTelefone, telefoneCompleto, type SolicitacaoDemissao,
} from "@/lib/demissao/solicitacao";
import {
  CheckCircle2, ChevronLeft, ChevronRight, FileText, Loader2, Lock, Paperclip, Trash2, UserMinus,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

const sb = supabase as any;

/**
 * Solicitar Demissão — wizard do encarregado (4 passos).
 *
 * O caminho é o mesmo de Solicitar Vaga: o encarregado ESCOLHE o colaborador
 * e o cadastro preenche o resto. Posto, contrato e escala chegam travados de
 * propósito — se dessem para editar, a demissão poderia apontar para um posto
 * que a pessoa não ocupa, e é o operacional que descobriria isso depois.
 *
 * Ao enviar, a solicitação nasce em "Pendente Operacional". A tela também
 * lista o que este encarregado já pediu, com o status de cada uma: o pedido
 * era acompanhar do começo ao fim, não só abrir e esperar aviso.
 */

const PASSOS = ["Solicitante e colaborador", "Motivos", "Aviso e documentos", "Conferência"];

const VAZIO = {
  data_solicitacao: hojeISO(),
  motivo_solicitacao: "",
  motivo_pedido: "",
  relato: "",
  termino_experiencia: "",
  data_aviso: "",
  modelo_aviso: "",
  colaborador_telefone: "",
  colaborador_email: "",
};

/** Campo preenchido pelo cadastro: aparece, explica de onde veio e não edita. */
function CampoTravado({ label, valor }: { label: string; valor: string }) {
  return (
    <div>
      <Label className="flex items-center gap-1.5">
        {label}
        <Lock className="h-3 w-3 text-muted-foreground" aria-hidden />
      </Label>
      <div className="mt-1 flex min-h-10 items-center rounded-md border bg-muted/50 px-3 py-2 text-sm">
        {valor || <span className="text-muted-foreground">Escolha o colaborador para preencher</span>}
      </div>
    </div>
  );
}

export default function SolicitarDemissao() {
  const { user } = useAuth();
  const [passo, setPasso] = useState(0);
  const [form, setForm] = useState({ ...VAZIO });
  const [colaborador, setColaborador] = useState<EmpregadoEscolhido | null>(null);
  const [arquivos, setArquivos] = useState<File[]>([]);
  const [enviando, setEnviando] = useState(false);
  const [protocolo, setProtocolo] = useState<number | null>(null);
  const inputArquivos = useRef<HTMLInputElement>(null);

  // Quem está pedindo: nome oficial do perfil, não digitado.
  const [solicitante, setSolicitante] = useState({ nome: "", email: "" });
  useEffect(() => {
    if (!user?.id) return;
    (async () => {
      const { data } = await supabase.from("profiles")
        .select("display_name, email").eq("id", user.id).maybeSingle();
      setSolicitante({
        nome: data?.display_name ?? user.email ?? "",
        email: data?.email ?? user.email ?? "",
      });
    })();
  }, [user?.id, user?.email]);

  // Contrato do colaborador: vem da coluna "Descrição do Local" da EMPREGADOS.
  //
  // Antes a tela ligava EMPREGADOS.Filial → CONTRATOS.Filial e pegava o
  // primeiro que casasse. Só que UMA FILIAL TEM MAIS DE UM CONTRATO — a 1093
  // tem "LIMPEZA HUSM" e "ADM E ESTAGIARIOS - NH" — então o `find` devolvia
  // o contrato de outra gente (era daí que saía o "LIMPEZA HUSM" num
  // analista do administrativo).
  const [contratos, setContratos] = useState<any[]>([]);
  useEffect(() => {
    (async () => {
      const { data } = await sb.from("CONTRATOS")
        .select('id, "NOME CONTRATO", Filial').eq("ATIVO", "SIM");
      setContratos(data ?? []);
    })();
  }, []);
  const nomeContrato = colaborador?.descricaoLocal || colaborador?.nomeFilial || "";
  // O id só sai quando o nome bate mesmo com um contrato ativo — apontar para
  // um id que não corresponde ao nome exibido é pior do que não apontar.
  const contratoDoColaborador = useMemo(() => {
    const alvo = nomeContrato.trim().toUpperCase();
    if (!alvo) return null;
    return contratos.find((c: any) => String(c["NOME CONTRATO"] ?? "").trim().toUpperCase() === alvo) ?? null;
  }, [contratos, nomeContrato]);

  // Minhas solicitações, para acompanhar o andamento sem sair da tela.
  const [minhas, setMinhas] = useState<SolicitacaoDemissao[]>([]);
  const carregarMinhas = async (email: string) => {
    if (!email) return;
    const { data } = await sb.from(TABELA)
      .select("*").eq("solicitante_email", email)
      .order("criado_em", { ascending: false }).limit(20);
    setMinhas(data ?? []);
  };
  useEffect(() => { carregarMinhas(solicitante.email); }, [solicitante.email]);

  const setCampo = (campo: keyof typeof VAZIO, valor: string) =>
    setForm((f) => ({ ...f, [campo]: valor }));

  // Escolher a pessoa traz junto o contato do cadastro — o encarregado ainda
  // pode corrigir telefone/e-mail, que é o dado que mais desatualiza.
  const escolherColaborador = (e: EmpregadoEscolhido | null) => {
    setColaborador(e);
    if (e) {
      setForm((f) => ({
        ...f,
        colaborador_telefone: f.colaborador_telefone || mascaraTelefone(e.telefone),
        colaborador_email: f.colaborador_email || e.email,
      }));
    }
  };

  const adicionarArquivos = (lista: FileList | null) => {
    if (!lista?.length) return;
    const novos: File[] = [];
    for (const f of Array.from(lista)) {
      const erro = erroDoArquivo(f);
      if (erro) { toast.error(erro); continue; }
      if (arquivos.some((a) => a.name === f.name && a.size === f.size)) continue;  // mesmo arquivo 2x
      novos.push(f);
    }
    if (novos.length) setArquivos((a) => [...a, ...novos]);
    if (inputArquivos.current) inputArquivos.current.value = "";
  };

  // ── Validação por passo ────────────────────────────────────────────
  // Cada passo diz o que falta ANTES de avançar: descobrir no fim que o
  // telefone estava errado obrigaria a percorrer o formulário todo de novo.
  const faltaNoPasso = (p: number): string | null => {
    if (p === 0) {
      if (!form.data_solicitacao) return "Informe a data da solicitação.";
      if (!solicitante.nome || !solicitante.email) return "Não consegui identificar você. Recarregue a página.";
      if (!colaborador) return "Escolha o colaborador na lista.";
      return null;
    }
    if (p === 1) {
      if (!form.motivo_solicitacao) return "Selecione o motivo da solicitação.";
      if (!form.motivo_pedido) return "Selecione o motivo do pedido de demissão.";
      if (form.relato.trim().length < 20) return "Relate o motivo com pelo menos 20 caracteres.";
      return null;
    }
    if (p === 2) {
      if (!form.termino_experiencia) return "Informe o término de contrato de experiência.";
      if (!form.data_aviso) return "Informe a data do aviso.";
      if (!form.modelo_aviso) return "Selecione o modelo de aviso.";
      if (!telefoneCompleto(form.colaborador_telefone)) return "Informe o telefone do colaborador com DDD.";
      if (!emailValido(form.colaborador_email)) return "Informe um e-mail válido do colaborador.";
      if (!arquivos.length) return "Anexe pelo menos 1 documento.";
      return null;
    }
    return null;
  };

  const avancar = () => {
    const falta = faltaNoPasso(passo);
    if (falta) { toast.error(falta); return; }
    setPasso((p) => Math.min(p + 1, PASSOS.length - 1));
  };

  // ── Envio ──────────────────────────────────────────────────────────
  // A solicitação nasce primeiro para os anexos terem um id de verdade no
  // caminho do arquivo. Se algum upload falhar, o pedido é desfeito: uma
  // solicitação de demissão sem documento não serve para o operacional
  // decidir, e ficaria parada na fila sem ninguém entender por quê.
  const enviar = async () => {
    for (let p = 0; p < 3; p++) {
      const falta = faltaNoPasso(p);
      if (falta) { setPasso(p); toast.error(falta); return; }
    }
    setEnviando(true);
    const payload = {
      solicitante_nome: solicitante.nome,
      solicitante_email: solicitante.email,
      data_solicitacao: form.data_solicitacao,
      colaborador_id: colaborador!.id,
      colaborador_nome: colaborador!.nome,
      colaborador_cpf: colaborador!.cpf || null,
      colaborador_posto: colaborador!.posto || null,
      colaborador_cargo: colaborador!.cargo || null,
      colaborador_filial: colaborador!.nomeFilial || colaborador!.filial || null,
      colaborador_admissao: colaborador!.admissao,
      colaborador_telefone: form.colaborador_telefone,
      colaborador_email: form.colaborador_email.trim(),
      contrato: nomeContrato || null,
      contrato_id: contratoDoColaborador?.id ?? null,
      escala: colaborador!.escala || null,
      motivo_solicitacao: form.motivo_solicitacao,
      motivo_pedido: form.motivo_pedido,
      relato: form.relato.trim(),
      termino_experiencia: form.termino_experiencia,
      data_aviso: form.data_aviso,
      modelo_aviso: form.modelo_aviso,
      status: "Pendente Operacional",
    };

    const { data: criada, error } = await sb.from(TABELA).insert(payload).select("id").single();
    if (error) {
      setEnviando(false);
      toast.error("Erro ao enviar a solicitação: " + error.message);
      return;
    }

    const enviados: string[] = [];
    for (const arquivo of arquivos) {
      const limpo = arquivo.name.replace(/[^\w.\-]+/g, "_");
      const caminho = `${criada.id}/${Date.now()}-${limpo}`;
      const { error: erroUpload } = await supabase.storage.from(BUCKET).upload(caminho, arquivo);
      if (erroUpload) {
        if (enviados.length) await supabase.storage.from(BUCKET).remove(enviados);
        await sb.from(TABELA).delete().eq("id", criada.id);
        setEnviando(false);
        toast.error(`Não consegui enviar "${arquivo.name}": ${erroUpload.message}. Nada foi salvo — tente de novo.`);
        return;
      }
      enviados.push(caminho);
      await sb.from(TABELA_ANEXOS).insert({
        solicitacao_id: criada.id, nome: arquivo.name, storage_path: caminho,
        tamanho: arquivo.size, tipo: arquivo.type || null, enviado_por: solicitante.email,
      });
    }

    setEnviando(false);
    setProtocolo(criada.id);
    toast.success(`Solicitação #${criada.id} enviada para o Operacional.`);
    carregarMinhas(solicitante.email);
  };

  const recomecar = () => {
    setProtocolo(null); setPasso(0); setForm({ ...VAZIO });
    setColaborador(null); setArquivos([]);
  };

  // ── Recibo ─────────────────────────────────────────────────────────
  if (protocolo) {
    return (
      <div className="mx-auto max-w-3xl">
        <PageHeader title="Solicitar Demissão" module="Encarregados" breadcrumb={["Recursos Humanos", "Solicitar Demissão"]} />
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <CheckCircle2 className="h-12 w-12 text-emerald-500" />
            <h2 className="text-xl font-semibold">Solicitação #{protocolo} enviada</h2>
            <p className="max-w-md text-sm text-muted-foreground">
              O Operacional vai aprovar ou reprovar. Depois de aprovada, ela segue para o RH concluir.
              Você acompanha o andamento aqui mesmo, na lista abaixo do formulário.
            </p>
            <div className="mt-2 flex gap-2">
              <Button onClick={recomecar}>Nova solicitação</Button>
              <Button variant="outline" asChild><Link to="/app/encarregados/solicitar-demissao">Ver minhas solicitações</Link></Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Solicitar Demissão"
        subtitle="Escolha o colaborador e preencha os dados do desligamento. O Operacional aprova e o RH conclui."
        module="Encarregados"
        breadcrumb={["Recursos Humanos", "Solicitar Demissão"]}
      />

      {/* Passos */}
      <div className="mb-4 flex items-center gap-2">
        {PASSOS.map((p, i) => (
          <div key={p} className="flex flex-1 items-center gap-1">
            <div className={cn(
              "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold transition-colors",
              i < passo ? "bg-emerald-500 text-white"
                : i === passo ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground",
            )}>
              {i < passo ? "✓" : i + 1}
            </div>
            <span className={cn("hidden truncate text-xs sm:inline",
              i === passo ? "font-semibold text-foreground" : "text-muted-foreground")}>
              {p}
            </span>
            {i < PASSOS.length - 1 && <div className="h-px flex-1 bg-border" />}
          </div>
        ))}
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">{PASSOS[passo]}</CardTitle></CardHeader>
        <CardContent className="space-y-5">

          {/* ── Passo 1: solicitante e colaborador ── */}
          {passo === 0 && (
            <>
              <div>
                <Label htmlFor="data">Data *</Label>
                <Input id="data" type="date" className="mt-1" value={form.data_solicitacao}
                  onChange={(e) => setCampo("data_solicitacao", e.target.value)} />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <CampoTravado label="Nome completo do solicitante (você)" valor={solicitante.nome} />
                <CampoTravado label="E-mail do solicitante (você)" valor={solicitante.email} />
              </div>
              <div>
                <Label>Nome completo do(a) colaborador(a) *</Label>
                <BuscaColaborador valor={colaborador} onEscolher={escolherColaborador} />
                <p className="mt-1 text-xs text-muted-foreground">
                  Escolha na lista. Posto, contrato e escala vêm do cadastro e não podem ser trocados.
                </p>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <CampoTravado label="Posto do(a) colaborador(a)" valor={colaborador?.posto ?? ""} />
                <CampoTravado label="Contrato" valor={nomeContrato} />
                <CampoTravado label="Escala que trabalha" valor={colaborador?.escala ?? ""} />
                <CampoTravado label="Cargo" valor={colaborador?.cargo ?? ""} />
              </div>
            </>
          )}

          {/* ── Passo 2: motivos ── */}
          {passo === 1 && (
            <>
              <div>
                <Label>Qual motivo da solicitação *</Label>
                <Select value={form.motivo_solicitacao} onValueChange={(v) => setCampo("motivo_solicitacao", v)}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder="Selecione o motivo" /></SelectTrigger>
                  <SelectContent>
                    {MOTIVOS_SOLICITACAO.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Qual motivo do pedido de demissão *</Label>
                <Select value={form.motivo_pedido} onValueChange={(v) => setCampo("motivo_pedido", v)}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder="Selecione o motivo" /></SelectTrigger>
                  <SelectContent>
                    {MOTIVOS_PEDIDO.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="relato">Relate abaixo o motivo da solicitação de demissão *</Label>
                <Textarea id="relato" className="mt-1 min-h-32" placeholder="Descreva detalhadamente o motivo…"
                  value={form.relato} onChange={(e) => setCampo("relato", e.target.value)} />
                <p className="mt-1 text-xs text-muted-foreground">
                  {form.relato.trim().length}/20 caracteres mínimos — é o que o Operacional lê para decidir.
                </p>
              </div>
            </>
          )}

          {/* ── Passo 3: aviso e documentos ── */}
          {passo === 2 && (
            <>
              <div>
                <Label>Término de contrato de experiência *</Label>
                <Select value={form.termino_experiencia} onValueChange={(v) => setCampo("termino_experiencia", v)}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder="Selecione (se aplicável)" /></SelectTrigger>
                  <SelectContent>
                    {TERMINOS_EXPERIENCIA.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <Label htmlFor="data_aviso">Data do aviso *</Label>
                  <Input id="data_aviso" type="date" className="mt-1" value={form.data_aviso}
                    onChange={(e) => setCampo("data_aviso", e.target.value)} />
                </div>
                <div>
                  <Label>Qual modelo de aviso *</Label>
                  <Select value={form.modelo_aviso} onValueChange={(v) => setCampo("modelo_aviso", v)}>
                    <SelectTrigger className="mt-1"><SelectValue placeholder="Selecione o modelo" /></SelectTrigger>
                    <SelectContent>
                      {MODELOS_AVISO.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <Label htmlFor="tel">Número de telefone do colaborador *</Label>
                  <Input id="tel" className="mt-1" placeholder="(00) 00000-0000" value={form.colaborador_telefone}
                    onChange={(e) => setCampo("colaborador_telefone", mascaraTelefone(e.target.value))} />
                </div>
                <div>
                  <Label htmlFor="mail">E-mail do colaborador *</Label>
                  <Input id="mail" type="email" className="mt-1" placeholder="exemplo@gmail.com"
                    value={form.colaborador_email} onChange={(e) => setCampo("colaborador_email", e.target.value)} />
                  <p className="mt-1 text-xs text-muted-foreground">Somente e-mails em formato válido são aceitos.</p>
                </div>
              </div>
              <div>
                <Label htmlFor="docs">Anexar documentos *</Label>
                <Input id="docs" ref={inputArquivos} type="file" multiple accept={ACCEPT_ANEXO} className="mt-1"
                  onChange={(e) => adicionarArquivos(e.target.files)} />
                <p className="mt-1 text-xs text-muted-foreground">
                  PDF, JPG, PNG, DOC, DOCX — máx. 10 MB por arquivo — obrigatório anexar ao menos 1 documento.
                </p>
                {arquivos.length > 0 && (
                  <ul className="mt-3 space-y-2">
                    {arquivos.map((a, i) => (
                      <li key={`${a.name}-${i}`} className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
                        <Paperclip className="h-4 w-4 shrink-0 text-muted-foreground" />
                        <span className="min-w-0 flex-1 truncate">{a.name}</span>
                        <span className="text-xs text-muted-foreground">{fmtTamanho(a.size)}</span>
                        <Button type="button" variant="ghost" size="sm"
                          onClick={() => setArquivos((lista) => lista.filter((_, j) => j !== i))}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          )}

          {/* ── Passo 4: conferência ── */}
          {passo === 3 && (
            <div className="space-y-4 text-sm">
              <p className="text-muted-foreground">
                Confira antes de enviar. Depois do envio, quem decide é o Operacional.
              </p>
              <Bloco titulo="Solicitante e colaborador" itens={[
                ["Data", fmtData(form.data_solicitacao)],
                ["Solicitante", solicitante.nome],
                ["E-mail do solicitante", solicitante.email],
                ["Colaborador", colaborador?.nome ?? "—"],
                ["Posto", colaborador?.posto || "—"],
                ["Contrato", nomeContrato || "—"],
                ["Escala", colaborador?.escala || "—"],
                ["Cargo", colaborador?.cargo || "—"],
              ]} />
              <Bloco titulo="Motivos" itens={[
                ["Motivo da solicitação", form.motivo_solicitacao],
                ["Motivo do pedido", form.motivo_pedido],
                ["Relato", form.relato],
              ]} />
              <Bloco titulo="Aviso e contato" itens={[
                ["Término de experiência", form.termino_experiencia],
                ["Data do aviso", fmtData(form.data_aviso)],
                ["Modelo de aviso", form.modelo_aviso],
                ["Telefone", form.colaborador_telefone],
                ["E-mail", form.colaborador_email],
                ["Documentos", `${arquivos.length} arquivo(s)`],
              ]} />
            </div>
          )}

          {/* Navegação */}
          <div className="flex items-center justify-between gap-2 pt-2">
            <Button type="button" variant="outline" disabled={passo === 0 || enviando}
              onClick={() => setPasso((p) => Math.max(0, p - 1))}>
              <ChevronLeft className="mr-1 h-4 w-4" /> Voltar
            </Button>
            {passo < PASSOS.length - 1 ? (
              <Button type="button" onClick={avancar}>
                Avançar <ChevronRight className="ml-1 h-4 w-4" />
              </Button>
            ) : (
              <Button type="button" onClick={enviar} disabled={enviando}>
                {enviando
                  ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Enviando…</>
                  : <><UserMinus className="mr-2 h-4 w-4" /> Enviar solicitação</>}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Acompanhamento */}
      <Card className="mt-6">
        <CardHeader><CardTitle className="text-base">Minhas solicitações</CardTitle></CardHeader>
        <CardContent>
          {minhas.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Você ainda não abriu nenhuma solicitação de demissão.
            </p>
          ) : (
            <ul className="divide-y">
              {minhas.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center gap-2 py-3">
                  <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="font-medium">#{s.id} · {s.colaborador_nome}</span>
                  <span className="text-xs text-muted-foreground">{fmtData(s.criado_em)}</span>
                  <Badge variant="outline" className={cn("ml-auto", corDoStatus(s.status))}>{s.status}</Badge>
                  <p className="w-full text-xs text-muted-foreground">
                    {explicaStatus(s.status)}
                    {s.status === "Reprovada" && s.operacional_motivo ? ` Motivo: ${s.operacional_motivo}` : ""}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Bloco({ titulo, itens }: { titulo: string; itens: [string, string][] }) {
  return (
    <div className="rounded-lg border p-4">
      <h3 className="mb-2 text-sm font-semibold">{titulo}</h3>
      <dl className="grid gap-x-4 gap-y-2 sm:grid-cols-2">
        {itens.map(([rotulo, valor]) => (
          <div key={rotulo} className="min-w-0">
            <dt className="text-xs uppercase tracking-wide text-muted-foreground">{rotulo}</dt>
            <dd className="break-words">{valor || "—"}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
