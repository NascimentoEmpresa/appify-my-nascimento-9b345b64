import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { SUPABASE_FUNCTIONS_URL } from "@/integrations/supabase/env";
import { acaoPublicaManutencao, STATUS_MANUTENCAO, type StatusManutencao } from "@/lib/suprimentos/manutencaoQr";
import { CheckCircle2, FileUp, Loader2, Play, Wrench } from "lucide-react";

type Dados = {
  equipamento: { nome: string; numero_serie: string; placa_patrimonial: string };
  solicitacao: null | { id: string; descricao: string | null; status: StatusManutencao; decisao_motivo: string | null; prestadora_empresa: string | null; prestadora_responsavel: string | null };
  anexos: { id: string; categoria: string; nome_arquivo: string; url: string | null }[];
  historico: { id: string; status: StatusManutencao; autor_nome: string | null; origem: string; created_at: string }[];
};

async function chamar(body: FormData | object) {
  const resposta = await fetch(`${SUPABASE_FUNCTIONS_URL}/sup-manutencao-publica`, {
    method: "POST", headers: body instanceof FormData ? undefined : { "Content-Type": "application/json" },
    body: body instanceof FormData ? body : JSON.stringify(body),
  });
  const dados = await resposta.json();
  if (!resposta.ok) throw new Error(dados?.error ?? "Não foi possível consultar a manutenção.");
  return dados;
}

export default function ManutencaoEquipamentoPublica() {
  const { token = "" } = useParams();
  const [dados, setDados] = useState<Dados | null>(null); const [erro, setErro] = useState("");
  const [carregando, setCarregando] = useState(true); const [enviando, setEnviando] = useState(false);
  const [empresa, setEmpresa] = useState(""); const [responsavel, setResponsavel] = useState("");
  const [arquivo, setArquivo] = useState<File | null>(null);
  const consultar = useCallback(async () => {
    setCarregando(true); setErro("");
    try { const retorno = await chamar({ token, acao: "consultar" }); setDados(retorno); }
    catch (e) { setErro((e as Error).message); } finally { setCarregando(false); }
  }, [token]);
  useEffect(() => { consultar(); }, [consultar]);
  const acao = dados?.solicitacao ? acaoPublicaManutencao(dados.solicitacao.status) : null;
  async function transicionar(proxima: "iniciar" | "concluir") {
    if (proxima === "iniciar" && dados?.solicitacao && !dados.solicitacao.prestadora_empresa
      && (!empresa.trim() || !responsavel.trim())) return setErro("Informe empresa e responsável antes de iniciar.");
    setEnviando(true); setErro(""); try { await chamar({ token, acao: proxima, empresa, responsavel }); await consultar(); }
    catch (e) { setErro((e as Error).message); } finally { setEnviando(false); }
  }
  async function enviarOrcamento() {
    if (!empresa.trim() || !responsavel.trim() || !arquivo) return setErro("Preencha empresa, responsável e selecione o orçamento.");
    const form = new FormData(); form.set("token", token); form.set("empresa", empresa); form.set("responsavel", responsavel); form.set("arquivo", arquivo);
    setEnviando(true); setErro(""); try { await chamar(form); setArquivo(null); await consultar(); }
    catch (e) { setErro((e as Error).message); } finally { setEnviando(false); }
  }
  if (carregando) return <TelaCentral><Loader2 className="h-8 w-8 animate-spin" /><p>Carregando manutenção...</p></TelaCentral>;
  if (erro && !dados) return <TelaCentral><Wrench className="h-10 w-10" /><h1 className="text-xl font-semibold">Link indisponível</h1><p className="max-w-md text-center text-muted-foreground">{erro}</p></TelaCentral>;
  return <main className="min-h-screen bg-muted/30 p-4 sm:p-8"><div className="mx-auto max-w-3xl space-y-4">
    <Card><CardHeader><CardTitle className="flex items-center gap-2"><Wrench className="h-5 w-5" />Manutenção de equipamento</CardTitle></CardHeader><CardContent className="grid gap-2 sm:grid-cols-3"><Info label="Máquina" valor={dados!.equipamento.nome} /><Info label="Número de série" valor={dados!.equipamento.numero_serie} /><Info label="Patrimônio" valor={dados!.equipamento.placa_patrimonial} /></CardContent></Card>
    {!dados!.solicitacao ? <Card><CardContent className="py-10 text-center text-muted-foreground">Não há manutenção ativa para esta máquina.</CardContent></Card> : <>
      <Card><CardHeader><div className="flex flex-wrap items-center justify-between gap-2"><CardTitle className="text-lg">Atendimento atual</CardTitle><Badge>{STATUS_MANUTENCAO[dados!.solicitacao!.status]}</Badge></div></CardHeader><CardContent className="space-y-3"><Info label="Defeito / serviço" valor={dados!.solicitacao!.descricao || "Não informado"} />{dados!.solicitacao!.decisao_motivo && <Info label="Decisão de Suprimentos" valor={dados!.solicitacao!.decisao_motivo} />}<div className="flex flex-wrap gap-2">{dados!.anexos.map((a) => a.url && <Button key={a.id} asChild variant="outline" size="sm"><a href={a.url} target="_blank" rel="noreferrer">{a.categoria === "orcamento" ? "Abrir orçamento" : "Abrir foto"}</a></Button>)}</div></CardContent></Card>
      {acao === "orcamento" && <Card><CardHeader><CardTitle className="text-lg">Enviar orçamento</CardTitle></CardHeader><CardContent className="space-y-4"><div className="grid gap-4 sm:grid-cols-2"><div><Label>Empresa *</Label><Input value={empresa} onChange={(e) => setEmpresa(e.target.value)} /></div><div><Label>Responsável *</Label><Input value={responsavel} onChange={(e) => setResponsavel(e.target.value)} /></div></div><div><Label>Arquivo *</Label><Input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={(e) => setArquivo(e.target.files?.[0] ?? null)} /><p className="mt-1 text-xs text-muted-foreground">JPG, PNG, WEBP ou PDF, até 5 MB.</p></div><Button onClick={enviarOrcamento} disabled={enviando}><FileUp className="mr-2 h-4 w-4" />Enviar para autorização</Button></CardContent></Card>}
      {acao === "iniciar" && <Card><CardContent className="space-y-4 py-8"><p className="text-center">O orçamento foi autorizado. Confirme quando o conserto começar.</p>{!dados!.solicitacao!.prestadora_empresa && <div className="grid gap-4 sm:grid-cols-2"><div><Label>Empresa prestadora *</Label><Input value={empresa} onChange={(e) => setEmpresa(e.target.value)} /></div><div><Label>Responsável *</Label><Input value={responsavel} onChange={(e) => setResponsavel(e.target.value)} /></div></div>}<div className="text-center"><Button onClick={() => transicionar("iniciar")} disabled={enviando}><Play className="mr-2 h-4 w-4" />Iniciar conserto</Button></div></CardContent></Card>}
      {acao === "concluir" && <Card><CardContent className="flex flex-col items-center gap-3 py-8 text-center"><p>Quando o equipamento estiver disponível, avise o solicitante.</p><Button onClick={() => transicionar("concluir")} disabled={enviando}><CheckCircle2 className="mr-2 h-4 w-4" />Marcar pronto para retirada</Button></CardContent></Card>}
      <Card><CardHeader><CardTitle className="text-lg">Andamento</CardTitle></CardHeader><CardContent><div className="space-y-3 border-l pl-4">{dados!.historico.map((h) => <div key={h.id}><p className="font-medium">{STATUS_MANUTENCAO[h.status]}</p><p className="text-xs text-muted-foreground">{new Date(h.created_at).toLocaleString("pt-BR")} · {h.autor_nome || h.origem}</p></div>)}</div></CardContent></Card>
    </>}{erro && <p className="rounded bg-destructive/10 p-3 text-sm text-destructive">{erro}</p>}
  </div></main>;
}

function Info({ label, valor }: { label: string; valor: string }) { return <div><p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p><p className="font-medium">{valor}</p></div>; }
function TelaCentral({ children }: { children: React.ReactNode }) { return <main className="flex min-h-screen flex-col items-center justify-center gap-3 bg-muted/30 p-6">{children}</main>; }
