import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Check, Copy, ExternalLink, KeyRound, UserMinus, UserPlus, X } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AcessoGate } from "@/components/auth/AcessoGate";
import {
  copiar, useCancelarPedidoLogin, useDemitidosComLogin, useMarcarLoginCriado, usePedidosLogin, useTratarDesligamento,
  type DemitidoComLogin, type PedidoLogin,
} from "@/hooks/useLoginsSistemas";

// =====================================================================
// SIS-2026-0598 — SISTEMAS › LOGINS (ADMISSÃO E DEMISSÃO), mig 20261006000009
//
// Pedido: "um submódulo para nos avisar caso alguém que tenha login seja
// demitido, para excluir os logins; na admissão, o recrutamento informa se
// a pessoa precisará de login, e quando for admitida já está tudo pronto".
//   · Logins novos: a vaga de encarregado com "precisa de login" concluída
//     no kanban aparece aqui com nome completo, e-mail sugerido e senha
//     aleatória, cada um com botão de copiar. Criada a conta em
//     Administração › Usuários, "Marcar como criado" (com o login e a
//     senha finais) libera para quem pediu a vaga, em Minhas Solicitações.
//   · Demitidos com login: quem saiu e ainda tem acesso ao ERP. Excluído
//     o usuário em Administração › Usuários, ele some daqui sozinho;
//     "Manter" pede o motivo.
// =====================================================================

const MENU = "sistemas_logins";
const fmtData = (iso: string | null | undefined) => (iso ? new Date(iso.length === 10 ? iso + "T12:00:00" : iso).toLocaleDateString("pt-BR") : "—");

function BotaoCopiar({ texto, rotulo }: { texto: string; rotulo: string }) {
  return (
    <Button type="button" size="sm" variant="outline" className="h-7 px-2 text-xs"
      onClick={async () => (await copiar(texto)) ? toast.success(`${rotulo} copiado.`) : toast.error("Não deu para copiar — selecione e copie à mão.")}>
      <Copy className="mr-1 h-3.5 w-3.5" /> Copiar
    </Button>
  );
}

function Linha({ rotulo, valor, mono }: { rotulo: string; valor: string; mono?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-20 shrink-0 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{rotulo}</span>
      <span className={`min-w-0 flex-1 truncate text-sm font-semibold ${mono ? "font-mono" : ""}`} title={valor}>{valor}</span>
      <BotaoCopiar texto={valor} rotulo={rotulo} />
    </div>
  );
}

export default function Logins() {
  const { data: pedidos = [], isLoading: carregandoP } = usePedidosLogin();
  const { data: demitidos = [], isLoading: carregandoD } = useDemitidosComLogin();
  const pendentes = pedidos.filter((p) => p.status === "pendente");
  const naoTratados = demitidos.filter((d) => !d.tratado);

  return (
    <div className="space-y-4">
      <PageHeader title="Logins — Admissão e Demissão" subtitle="Logins a criar para encarregados admitidos e logins de quem foi desligado"
        module="Sistemas" breadcrumb={["Logins"]} />
      <AcessoGate menu={MENU} acao="visualizar" fallback={<Card className="p-6 text-sm text-muted-foreground">Você não tem liberação para esta tela.</Card>}>
        <Tabs defaultValue={pendentes.length || !naoTratados.length ? "novos" : "demitidos"}>
          <TabsList>
            <TabsTrigger value="novos" className="gap-1.5"><UserPlus className="h-4 w-4" /> Logins novos (Admissão) {pendentes.length > 0 && <Badge variant="destructive" className="h-5 px-1.5 text-[10px]">{pendentes.length}</Badge>}</TabsTrigger>
            <TabsTrigger value="demitidos" className="gap-1.5"><UserMinus className="h-4 w-4" /> Demitidos com login {naoTratados.length > 0 && <Badge variant="destructive" className="h-5 px-1.5 text-[10px]">{naoTratados.length}</Badge>}</TabsTrigger>
          </TabsList>
          <TabsContent value="novos"><LoginsNovos pedidos={pedidos} carregando={carregandoP} /></TabsContent>
          <TabsContent value="demitidos"><Demitidos lista={demitidos} carregando={carregandoD} /></TabsContent>
        </Tabs>
      </AcessoGate>
    </div>
  );
}

// ---- Admissão ----------------------------------------------------------------

function LoginsNovos({ pedidos, carregando }: { pedidos: PedidoLogin[]; carregando: boolean }) {
  const [filtro, setFiltro] = useState<"abertos" | "todos">("abertos");
  const [criando, setCriando] = useState<PedidoLogin | null>(null);
  const [cancelando, setCancelando] = useState<PedidoLogin | null>(null);
  const lista = filtro === "abertos" ? pedidos.filter((p) => p.status === "pendente" || p.status === "criado") : pedidos;

  return (
    <div className="space-y-3">
      <Card className="flex flex-wrap items-center gap-3 p-3 text-xs text-muted-foreground">
        <span>Vaga de encarregado com <b className="text-foreground">"Precisa de login para a ERP?"</b> chega aqui quando o contratado é enviado à Admissão. Crie a conta em</span>
        <Button asChild size="sm" variant="outline" className="h-7"><Link to="/app/administracao?tab=usuarios"><ExternalLink className="mr-1 h-3.5 w-3.5" /> Administração › Usuários</Link></Button>
        <div className="ml-auto flex gap-1">
          <Button size="sm" variant={filtro === "abertos" ? "default" : "outline"} className="h-7 text-xs" onClick={() => setFiltro("abertos")}>Em aberto</Button>
          <Button size="sm" variant={filtro === "todos" ? "default" : "outline"} className="h-7 text-xs" onClick={() => setFiltro("todos")}>Todos</Button>
        </div>
      </Card>
      {carregando ? <Card className="p-6 text-sm text-muted-foreground">Carregando…</Card> : lista.length === 0 ? (
        <Card className="p-6 text-center text-sm text-muted-foreground">Nenhum login {filtro === "abertos" ? "para criar agora" : "pedido ainda"}.</Card>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {lista.map((p) => (
            <Card key={p.id} className={`space-y-2 p-4 ${p.status === "cancelado" ? "opacity-60" : ""}`}>
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-muted-foreground">{[p.cargo, p.contrato].filter(Boolean).join(" · ")}{p.vaga_id ? ` · vaga #${p.vaga_id}` : ""}</p>
                </div>
                <SeloPedido status={p.status} />
              </div>
              <Linha rotulo="Nome" valor={p.nome} />
              <Linha rotulo="E-mail" valor={p.login_email ?? p.email_sugerido} mono />
              {p.senha ? <Linha rotulo="Senha" valor={p.senha} mono /> : (
                <p className="text-xs text-muted-foreground">{p.status === "entregue" ? `Senha repassada e apagada do sistema em ${fmtData(p.entregue_em)}.` : "Sem senha guardada."}</p>
              )}
              <p className="text-[11px] text-muted-foreground">
                Pedida por {p.solicitante_nome ?? p.solicitante_email ?? "—"} · chegou em {fmtData(p.created_at)}
                {p.criado_em && ` · criado por ${p.criado_por_nome ?? "—"} em ${fmtData(p.criado_em)}`}
                {p.obs && ` · ${p.obs}`}
              </p>
              {(p.status === "pendente" || p.status === "criado") && (
                <AcessoGate menu={MENU} acao="alterar">
                  <div className="flex gap-2 pt-1">
                    <Button size="sm" onClick={() => setCriando(p)}><KeyRound className="mr-1 h-4 w-4" /> {p.status === "pendente" ? "Marcar como criado" : "Corrigir login/senha"}</Button>
                    <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setCancelando(p)}><X className="mr-1 h-4 w-4" /> Não precisa</Button>
                  </div>
                </AcessoGate>
              )}
            </Card>
          ))}
        </div>
      )}
      <DialogCriado pedido={criando} onClose={() => setCriando(null)} />
      <DialogCancelar pedido={cancelando} onClose={() => setCancelando(null)} />
    </div>
  );
}

function SeloPedido({ status }: { status: PedidoLogin["status"] }) {
  const m = {
    pendente: ["A criar", "border-amber-300 bg-amber-50 text-amber-700"],
    criado: ["Criado — aguardando repasse", "border-sky-300 bg-sky-50 text-sky-700"],
    entregue: ["Entregue", "border-emerald-300 bg-emerald-50 text-emerald-700"],
    cancelado: ["Cancelado", "border-slate-300 bg-slate-50 text-slate-500"],
  } as const;
  return <Badge variant="outline" className={`shrink-0 text-[10px] ${m[status][1]}`}>{m[status][0]}</Badge>;
}

function DialogCriado({ pedido, onClose }: { pedido: PedidoLogin | null; onClose: () => void }) {
  const marcar = useMarcarLoginCriado();
  const [login, setLogin] = useState("");
  const [senha, setSenha] = useState("");
  useEffect(() => { if (pedido) { setLogin(pedido.login_email ?? pedido.email_sugerido); setSenha(pedido.senha ?? ""); } }, [pedido]);
  const gravar = async () => {
    if (!pedido) return;
    try { await marcar.mutateAsync({ id: pedido.id, login, senha }); toast.success("Pronto — o login aparece para quem pediu a vaga."); onClose(); }
    catch (e) { toast.error((e as Error).message); }
  };
  return (
    <Dialog open={!!pedido} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Login criado — {pedido?.nome}</DialogTitle></DialogHeader>
        <p className="text-xs text-muted-foreground">Confira o login e a senha com que a conta foi criada em Administração › Usuários. É isto que quem pediu a vaga vai receber.</p>
        <div className="space-y-3">
          <div><Label className="text-xs">Login (e-mail)</Label><Input value={login} onChange={(e) => setLogin(e.target.value)} className="font-mono" /></div>
          <div><Label className="text-xs">Senha</Label><Input value={senha} onChange={(e) => setSenha(e.target.value)} className="font-mono" /></div>
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose}>Cancelar</Button><Button disabled={marcar.isPending} onClick={gravar}><Check className="mr-1 h-4 w-4" /> Confirmar</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DialogCancelar({ pedido, onClose }: { pedido: PedidoLogin | null; onClose: () => void }) {
  const cancelar = useCancelarPedidoLogin();
  const [obs, setObs] = useState("");
  useEffect(() => { if (pedido) setObs(""); }, [pedido]);
  return (
    <Dialog open={!!pedido} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Não criar login para {pedido?.nome}?</DialogTitle></DialogHeader>
        <div><Label className="text-xs">Motivo (opcional)</Label><Textarea rows={2} value={obs} onChange={(e) => setObs(e.target.value)} placeholder="Ex.: já tinha login, desistiu antes de começar…" /></div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Voltar</Button>
          <Button variant="destructive" disabled={cancelar.isPending} onClick={async () => {
            if (!pedido) return;
            try { await cancelar.mutateAsync({ id: pedido.id, obs }); toast.success("Pedido cancelado."); onClose(); } catch (e) { toast.error((e as Error).message); }
          }}>Cancelar pedido</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---- Demissão ----------------------------------------------------------------

function Demitidos({ lista, carregando }: { lista: DemitidoComLogin[]; carregando: boolean }) {
  const tratar = useTratarDesligamento();
  const [mantendo, setMantendo] = useState<DemitidoComLogin | null>(null);
  const [motivo, setMotivo] = useState("");
  const [verTratados, setVerTratados] = useState(false);
  const visiveis = useMemo(() => lista.filter((d) => verTratados || !d.tratado), [lista, verTratados]);

  const marcar = async (d: DemitidoComLogin, acao: "excluido" | "mantido", obs = "") => {
    try { await tratar.mutateAsync({ auth_user_id: d.auth_user_id, empregado_id: d.empregado_id, acao, obs }); toast.success(acao === "excluido" ? "Marcado como excluído." : "Login mantido."); setMantendo(null); }
    catch (e) { toast.error((e as Error).message); }
  };

  return (
    <div className="space-y-3">
      <Card className="flex flex-wrap items-center gap-3 p-3 text-xs text-muted-foreground">
        <span>Colaboradores <b className="text-foreground">demitidos</b> que ainda têm login no ERP. Exclua o usuário em</span>
        <Button asChild size="sm" variant="outline" className="h-7"><Link to="/app/administracao?tab=usuarios"><ExternalLink className="mr-1 h-3.5 w-3.5" /> Administração › Usuários</Link></Button>
        <span>— ele sai desta lista sozinho.</span>
        <label className="ml-auto flex items-center gap-1.5"><input type="checkbox" checked={verTratados} onChange={(e) => setVerTratados(e.target.checked)} /> Mostrar os já tratados</label>
      </Card>
      {carregando ? <Card className="p-6 text-sm text-muted-foreground">Carregando…</Card> : visiveis.length === 0 ? (
        <Card className="p-6 text-center text-sm text-muted-foreground">Nenhum demitido com login ativo. 👍</Card>
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead className="bg-muted/60 text-left text-xs text-muted-foreground">
              <tr><th className="px-4 py-2 font-medium">Colaborador</th><th className="px-3 py-2 font-medium">Login</th><th className="px-3 py-2 font-medium">Desligamento</th><th className="px-3 py-2 font-medium">Último acesso</th><th className="px-3 py-2" /></tr>
            </thead>
            <tbody>
              {visiveis.map((d) => (
                <tr key={d.auth_user_id} className="border-t align-top">
                  <td className="px-4 py-2">
                    <p className="font-semibold">{d.nome}</p>
                    <p className="text-xs text-muted-foreground">{[d.cargo, d.contrato].filter(Boolean).join(" · ")}</p>
                  </td>
                  <td className="px-3 py-2"><div className="flex items-center gap-1.5"><span className="font-mono text-xs">{d.login_email}</span><BotaoCopiar texto={d.login_email} rotulo="Login" /></div></td>
                  <td className="whitespace-nowrap px-3 py-2 text-xs">{fmtData(d.desligamento)}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-xs">{fmtData(d.ultimo_acesso)}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right">
                    {d.tratado ? (
                      <span className="text-xs text-muted-foreground">{d.tratado === "excluido" ? "Marcado excluído" : "Mantido"} · {d.tratado_por} · {fmtData(d.tratado_em)}</span>
                    ) : (
                      <AcessoGate menu={MENU} acao="alterar">
                        <div className="flex justify-end gap-1.5">
                          <Button size="sm" variant="outline" onClick={() => { if (window.confirm(`Já excluiu o usuário ${d.login_email} em Administração › Usuários?`)) marcar(d, "excluido"); }}><Check className="mr-1 h-3.5 w-3.5" /> Já excluí</Button>
                          <Button size="sm" variant="ghost" onClick={() => { setMantendo(d); setMotivo(""); }}>Manter</Button>
                        </div>
                      </AcessoGate>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
      <Dialog open={!!mantendo} onOpenChange={(o) => !o && setMantendo(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Manter o login de {mantendo?.nome}?</DialogTitle></DialogHeader>
          <div><Label className="text-xs">Por quê? *</Label><Textarea rows={2} value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ex.: vai ser recontratado(a), presta serviço como terceiro…" /></div>
          <DialogFooter><Button variant="outline" onClick={() => setMantendo(null)}>Voltar</Button><Button disabled={tratar.isPending} onClick={() => mantendo && marcar(mantendo, "mantido", motivo)}>Manter login</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
