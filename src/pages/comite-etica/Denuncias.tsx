import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  ShieldAlert, Copy, Check, Search, Link2, UserX, User, Inbox, Gavel,
} from "lucide-react";

// =====================================================================
// COMITÊ DE ÉTICA — Denúncias recebidas pelo canal próprio
//
// O que chega aqui vem do formulário público /denuncia (sem login), via
// RPC denuncia_registrar. Esta tela é a tratativa: ler, atribuir status e
// escrever o retorno que o denunciante enxerga ao consultar o protocolo.
//
// Quem enxerga: só quem tem o menu 'central_servicos_canal_denuncias'
// liberado em Acesso por Usuário — a RLS de CANAL_DENUNCIA exige isso, sem
// bypass por papel de admin. O relato é imutável pela API (trigger no banco);
// daqui só saem status, responsável, parecer e retorno.
// =====================================================================

const STATUS: Record<string, { label: string; cls: string }> = {
  nova:         { label: "Nova",          cls: "border-info/30 bg-info/10 text-info" },
  em_analise:   { label: "Em análise",    cls: "border-warning/30 bg-warning/10 text-warning" },
  apuracao:     { label: "Em apuração",   cls: "border-warning/30 bg-warning/10 text-warning" },
  procedente:   { label: "Procedente",    cls: "border-destructive/30 bg-destructive/10 text-destructive" },
  improcedente: { label: "Improcedente",  cls: "border-success/30 bg-success/10 text-success" },
  arquivada:    { label: "Arquivada",     cls: "border-border bg-muted text-muted-foreground" },
};

const TIPOS: Record<string, string> = {
  assedio_moral: "Assédio moral", assedio_sexual: "Assédio sexual",
  discriminacao: "Discriminação", fraude: "Fraude / Corrupção",
  furto_desvio: "Furto / Desvio", conflito_interesses: "Conflito de interesses",
  uso_indevido: "Uso indevido de recursos", informacoes: "Vazamento de informações",
  sst: "SST", meio_ambiente: "Meio ambiente",
  violacao_conduta: "Violação de conduta", outro: "Outro",
};

const RELACOES: Record<string, string> = {
  colaborador: "Colaborador(a)", ex_colaborador: "Ex-colaborador(a)",
  estagiario: "Estagiário / Aprendiz", terceirizado: "Terceirizado(a)",
  fornecedor: "Fornecedor(a)", cliente: "Cliente", outro: "Outro",
};

const SIM_NAO: Record<string, string> = { sim: "Sim", nao: "Não", nao_sei: "Não sei" };

interface Denuncia {
  id: string; protocolo: string; identificado: boolean;
  nome_completo: string | null; cpf: string | null; email: string | null;
  data_nascimento: string | null; telefone_fixo: string | null; celular: string | null;
  relacao: string; tipo_denuncia: string; local_ocorrencia: string | null; como_soube: string;
  lideranca_ciente: string | null; lideranca_envolvida: string | null; lideranca_ocultou: string | null;
  lideranca_ciente_quem: string | null; lideranca_envolvida_quem: string | null; lideranca_ocultou_quem: string | null;
  descricao: string; testemunhas: string | null; evidencias: string | null;
  valor_financeiro: string | null; sugestao: string | null;
  status: string; parecer_interno: string | null; retorno_denunciante: string | null;
  concluido_em: string | null; created_at: string; updated_at: string;
}

const fmt = (s?: string | null) => {
  if (!s) return "—";
  const d = new Date(s);
  return isNaN(+d) ? "—" : d.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
};

export default function DenunciasComiteEtica() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [busca, setBusca] = useState("");
  const [fStatus, setFStatus] = useState("todos");
  const [alvo, setAlvo] = useState<Denuncia | null>(null);
  const [copiou, setCopiou] = useState(false);

  const { data: denuncias = [], isLoading } = useQuery({
    queryKey: ["canal-denuncias"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("CANAL_DENUNCIA").select("*").order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Denuncia[];
    },
  });

  // O link do formulário público. Vive no mesmo domínio do ERP, então sai do
  // próprio endereço da página — não tem constante para desatualizar.
  const linkPublico = `${window.location.origin}/denuncia`;

  const copiarLink = async () => {
    try {
      await navigator.clipboard.writeText(linkPublico);
      setCopiou(true);
      setTimeout(() => setCopiou(false), 2000);
      toast({ title: "Link copiado", description: linkPublico });
    } catch {
      toast({ title: "Não consegui copiar", description: linkPublico, variant: "destructive" });
    }
  };

  const filtradas = useMemo(() => {
    const t = busca.trim().toLowerCase();
    return denuncias.filter((d) => {
      if (fStatus !== "todos" && d.status !== fStatus) return false;
      if (!t) return true;
      return d.protocolo.toLowerCase().includes(t)
        || d.descricao.toLowerCase().includes(t)
        || (d.local_ocorrencia ?? "").toLowerCase().includes(t)
        || (d.nome_completo ?? "").toLowerCase().includes(t);
    });
  }, [denuncias, busca, fStatus]);

  const contagem = useMemo(() => {
    const m: Record<string, number> = {};
    denuncias.forEach((d) => { m[d.status] = (m[d.status] ?? 0) + 1; });
    return m;
  }, [denuncias]);

  return (
    <div>
      <PageHeader
        title="Denúncias"
        subtitle="Relatos recebidos pelo Canal de Ética. Conteúdo confidencial."
        module="Comitê de Ética"
        breadcrumb={["Comitê de Ética", "Denúncias"]}
        actions={
          <Button variant="outline" className="gap-1.5" onClick={copiarLink}>
            {copiou ? <Check className="h-4 w-4 text-success" /> : <Link2 className="h-4 w-4" />}
            {copiou ? "Link copiado" : "Copiar link da denúncia"}
          </Button>
        }
      />

      <Card className="mb-4 flex flex-wrap items-center gap-3 border-info/30 bg-info/5 p-4">
        <ShieldAlert className="h-5 w-5 shrink-0 text-info" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-info">Link público para registrar denúncia</p>
          <p className="truncate font-mono text-xs text-muted-foreground">{linkPublico}</p>
        </div>
        <Button size="sm" variant="outline" className="gap-1.5" onClick={copiarLink}>
          <Copy className="h-3.5 w-3.5" /> Copiar
        </Button>
      </Card>

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { k: "todas", label: "Total recebidas", v: denuncias.length, icon: Inbox, tone: "text-primary" },
          { k: "nova", label: "Novas", v: contagem.nova ?? 0, icon: ShieldAlert, tone: "text-info" },
          { k: "apuracao", label: "Em apuração", v: (contagem.em_analise ?? 0) + (contagem.apuracao ?? 0), icon: Search, tone: "text-warning" },
          { k: "procedente", label: "Procedentes", v: contagem.procedente ?? 0, icon: Gavel, tone: "text-destructive" },
        ].map((s) => (
          <Card key={s.k} className="flex items-center gap-3 p-4">
            <s.icon className={`h-5 w-5 shrink-0 ${s.tone}`} />
            <div>
              <p className="text-2xl font-bold leading-none">{s.v}</p>
              <p className="mt-1 text-xs text-muted-foreground">{s.label}</p>
            </div>
          </Card>
        ))}
      </div>

      <Card className="p-4">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <div className="relative min-w-[220px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-9" placeholder="Buscar por protocolo, relato ou local…"
              value={busca} onChange={(e) => setBusca(e.target.value)}
            />
          </div>
          <Select value={fStatus} onValueChange={setFStatus}>
            <SelectTrigger className="w-[190px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos os status</SelectItem>
              {Object.entries(STATUS).map(([k, s]) => (
                <SelectItem key={k} value={k}>{s.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Protocolo</TableHead>
                <TableHead>Recebida em</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Origem</TableHead>
                <TableHead>Local</TableHead>
                <TableHead>Relato</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow><TableCell colSpan={7} className="py-8 text-center text-sm text-muted-foreground">
                  Carregando…
                </TableCell></TableRow>
              )}
              {!isLoading && filtradas.length === 0 && (
                <TableRow><TableCell colSpan={7} className="py-8 text-center text-sm text-muted-foreground">
                  {denuncias.length === 0
                    ? "Nenhuma denúncia recebida ainda. Divulgue o link acima para o canal começar a receber."
                    : "Nenhuma denúncia com esse filtro."}
                </TableCell></TableRow>
              )}
              {filtradas.map((d) => (
                <TableRow key={d.id} className="cursor-pointer" onClick={() => setAlvo(d)}>
                  <TableCell className="whitespace-nowrap font-mono text-xs font-semibold">{d.protocolo}</TableCell>
                  <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{fmt(d.created_at)}</TableCell>
                  <TableCell className="text-xs">{TIPOS[d.tipo_denuncia] ?? d.tipo_denuncia}</TableCell>
                  <TableCell className="text-xs">
                    <span className="flex items-center gap-1.5">
                      {d.identificado
                        ? <><User className="h-3.5 w-3.5 text-muted-foreground" /> {d.nome_completo || "Identificado"}</>
                        : <><UserX className="h-3.5 w-3.5 text-muted-foreground" /> Anônima</>}
                    </span>
                    <span className="text-[11px] text-muted-foreground">{RELACOES[d.relacao] ?? d.relacao}</span>
                  </TableCell>
                  <TableCell className="max-w-[150px] truncate text-xs">{d.local_ocorrencia || "—"}</TableCell>
                  <TableCell className="max-w-[260px] truncate text-xs text-muted-foreground">{d.descricao}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className={`text-[10px] font-semibold ${STATUS[d.status]?.cls ?? ""}`}>
                      {STATUS[d.status]?.label ?? d.status}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          Mostrando {filtradas.length} de {denuncias.length} denúncias. Clique numa linha para ler e tratar.
        </p>
      </Card>

      <DetalheDenuncia
        denuncia={alvo}
        onFechar={() => setAlvo(null)}
        onSalvo={() => { qc.invalidateQueries({ queryKey: ["canal-denuncias"] }); setAlvo(null); }}
      />
    </div>
  );
}

// ----------------------------------------------------------- Detalhe
function DetalheDenuncia({ denuncia, onFechar, onSalvo }: {
  denuncia: Denuncia | null; onFechar: () => void; onSalvo: () => void;
}) {
  const { toast } = useToast();
  const [salvando, setSalvando] = useState(false);
  const [status, setStatus] = useState("");
  const [parecer, setParecer] = useState("");
  const [retorno, setRetorno] = useState("");

  // Recarrega o formulário quando troca a denúncia aberta.
  const chave = denuncia?.id ?? "";
  const [ultima, setUltima] = useState("");
  if (chave !== ultima) {
    setUltima(chave);
    setStatus(denuncia?.status ?? "nova");
    setParecer(denuncia?.parecer_interno ?? "");
    setRetorno(denuncia?.retorno_denunciante ?? "");
  }

  if (!denuncia) return null;
  const d = denuncia;

  const salvar = async () => {
    if (salvando) return;
    setSalvando(true);
    const encerrada = ["procedente", "improcedente", "arquivada"].includes(status);
    const { error } = await (supabase as any).from("CANAL_DENUNCIA").update({
      status,
      parecer_interno: parecer.trim() || null,
      retorno_denunciante: retorno.trim() || null,
      concluido_em: encerrada ? (d.concluido_em ?? new Date().toISOString()) : null,
    }).eq("id", d.id);
    setSalvando(false);
    if (error) {
      toast({ title: "Erro ao salvar", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Tratativa salva", description: `Protocolo ${d.protocolo}` });
    onSalvo();
  };

  const Campo = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <div className="min-w-0">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
      <div className="break-words text-sm [overflow-wrap:anywhere]">{children || "—"}</div>
    </div>
  );

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onFechar(); }}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            <span className="font-mono">{d.protocolo}</span>
            <Badge variant="outline" className={`text-[10px] font-semibold ${STATUS[d.status]?.cls ?? ""}`}>
              {STATUS[d.status]?.label ?? d.status}
            </Badge>
            {!d.identificado && (
              <Badge variant="outline" className="gap-1 text-[10px]"><UserX className="h-3 w-3" /> Anônima</Badge>
            )}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <Card className="grid gap-4 p-4 sm:grid-cols-3">
            <Campo label="Recebida em">{fmt(d.created_at)}</Campo>
            <Campo label="Tipo">{TIPOS[d.tipo_denuncia] ?? d.tipo_denuncia}</Campo>
            <Campo label="Relação com o grupo">{RELACOES[d.relacao] ?? d.relacao}</Campo>
            <Campo label="Local do fato">{d.local_ocorrencia}</Campo>
            <Campo label="Como soube">{d.como_soube}</Campo>
            <Campo label="Valor envolvido">{d.valor_financeiro}</Campo>
          </Card>

          {d.identificado && (
            <Card className="grid gap-4 p-4 sm:grid-cols-3">
              <p className="text-xs font-bold sm:col-span-3">Quem denunciou (optou por se identificar)</p>
              <Campo label="Nome">{d.nome_completo}</Campo>
              <Campo label="CPF">{d.cpf}</Campo>
              <Campo label="E-mail">{d.email}</Campo>
              <Campo label="Nascimento">{d.data_nascimento}</Campo>
              <Campo label="Telefone">{d.telefone_fixo}</Campo>
              <Campo label="Celular">{d.celular}</Campo>
            </Card>
          )}

          <Card className="grid gap-4 p-4 sm:grid-cols-3">
            <p className="text-xs font-bold sm:col-span-3">Envolvimento da liderança</p>
            {/* Quem foi citado só aparece quando o denunciante quis dizer —
                o campo é opcional mesmo depois de um "sim". */}
            <Campo label="Está ciente">
              {SIM_NAO[d.lideranca_ciente ?? ""] ?? "—"}
              {d.lideranca_ciente_quem && (
                <p className="mt-1 whitespace-pre-wrap text-xs text-muted-foreground">{d.lideranca_ciente_quem}</p>
              )}
            </Campo>
            <Campo label="Está envolvida">
              {SIM_NAO[d.lideranca_envolvida ?? ""] ?? "—"}
              {d.lideranca_envolvida_quem && (
                <p className="mt-1 whitespace-pre-wrap text-xs text-muted-foreground">{d.lideranca_envolvida_quem}</p>
              )}
            </Campo>
            <Campo label="Tentou esconder">
              {SIM_NAO[d.lideranca_ocultou ?? ""] ?? "—"}
              {d.lideranca_ocultou_quem && (
                <p className="mt-1 whitespace-pre-wrap text-xs text-muted-foreground">{d.lideranca_ocultou_quem}</p>
              )}
            </Campo>
          </Card>

          <Card className="space-y-3 p-4">
            <Campo label="Relato"><p className="whitespace-pre-wrap">{d.descricao}</p></Campo>
            <Campo label="Testemunhas"><p className="whitespace-pre-wrap">{d.testemunhas}</p></Campo>
            <Campo label="Evidências"><p className="whitespace-pre-wrap">{d.evidencias}</p></Campo>
            <Campo label="Sugestão do denunciante"><p className="whitespace-pre-wrap">{d.sugestao}</p></Campo>
          </Card>

          {/* Tratativa — o único bloco que escreve. O relato acima é imutável
              pelo banco: serve como registro do que foi efetivamente dito. */}
          <Card className="space-y-3 border-primary/30 p-4">
            <p className="text-sm font-bold">Tratativa</p>
            <div>
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Status</p>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(STATUS).map(([k, s]) => (
                    <SelectItem key={k} value={k}>{s.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Parecer interno <span className="font-normal normal-case">(só o comitê vê)</span>
              </p>
              <Textarea rows={3} value={parecer} onChange={(e) => setParecer(e.target.value)}
                placeholder="Apuração, decisões, encaminhamentos…" />
            </div>
            <div>
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Retorno ao denunciante <span className="font-normal normal-case">(aparece na consulta por protocolo)</span>
              </p>
              <Textarea rows={3} value={retorno} onChange={(e) => setRetorno(e.target.value)}
                placeholder="O que a pessoa vê ao consultar o protocolo dela." />
              <p className="mt-1 text-[11px] text-muted-foreground">
                É o único texto daqui que sai para fora — quem denunciou anonimamente só recebe notícia por aqui.
              </p>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={onFechar} disabled={salvando}>Fechar</Button>
              <Button onClick={salvar} disabled={salvando}>{salvando ? "Salvando…" : "Salvar tratativa"}</Button>
            </div>
          </Card>
        </div>
      </DialogContent>
    </Dialog>
  );
}
