import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { BarChart3, Check, Clock, Copy, ExternalLink, IdCard, KeyRound, Link2, UserCheck, UserMinus, UserPlus, X } from "lucide-react";
import { LoginsPainel } from "./LoginsPainel";
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
  copiar, pedidoPronto, useCancelarPedidoLogin, useCienteBloqueio, useDefinirCpfPedido, useLiberarLogin, useLoginsBloqueados, useMarcarLoginCriado, usePedidosLogin, useTravarLogin,
  type LoginBloqueado, type PedidoLogin,
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
//   · Logins bloqueados (07/10/2026, mig 20261007000007): o login da ERP é
//     bloqueado AUTOMATICAMENTE pela situação na Senior, pelo CPF — só
//     Trabalhando, Atestado e Aviso Prévio Trabalhado entram; demitido,
//     férias, auxílio-doença, licença… não. A aba lista quem está travado e
//     o motivo ("Travado por <situação>"); o botão OK só registra que
//     Sistemas viu. Voltando a Trabalhando, libera sozinho. Afastado pode ser
//     LIBERADO com motivo (mig 20261007000009), enquanto durar a situação;
//     demitido não tem exceção ("desabilita e pronto").
//   · Painel de uso (07/10/2026, mig 20261007000008): logins e acessos por
//     setor, por dia, horário, dispositivo, quem mais usa e quem não entra.
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
  const { data: bloqueados = [], isLoading: carregandoB } = useLoginsBloqueados();
  // Badge = trabalho a fazer agora: admitido na Senior e login ainda não criado.
  const pendentes = pedidos.filter(pedidoPronto);
  const semOk = bloqueados.filter((b) => !b.ciente && !b.liberado);

  return (
    <div className="space-y-4">
      <PageHeader title="Logins — Admissão e Demissão" subtitle="Logins a criar para encarregados admitidos e logins bloqueados pela situação na Senior"
        module="Sistemas" breadcrumb={["Logins"]} />
      <AcessoGate menu={MENU} acao="visualizar" fallback={<Card className="p-6 text-sm text-muted-foreground">Você não tem liberação para esta tela.</Card>}>
        <Tabs defaultValue={pendentes.length || !semOk.length ? "novos" : "bloqueados"}>
          <TabsList>
            <TabsTrigger value="novos" className="gap-1.5"><UserPlus className="h-4 w-4" /> Logins novos (Admissão) {pendentes.length > 0 && <Badge variant="destructive" className="h-5 px-1.5 text-[10px]">{pendentes.length}</Badge>}</TabsTrigger>
            <TabsTrigger value="bloqueados" className="gap-1.5"><UserMinus className="h-4 w-4" /> Logins bloqueados {semOk.length > 0 && <Badge variant="destructive" className="h-5 px-1.5 text-[10px]">{semOk.length}</Badge>}</TabsTrigger>
            <TabsTrigger value="painel" className="gap-1.5"><BarChart3 className="h-4 w-4" /> Painel de uso</TabsTrigger>
          </TabsList>
          <TabsContent value="novos"><LoginsNovos pedidos={pedidos} carregando={carregandoP} /></TabsContent>
          <TabsContent value="painel"><LoginsPainel /></TabsContent>
          <TabsContent value="bloqueados"><Bloqueados lista={bloqueados} carregando={carregandoB} /></TabsContent>
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
  const [informandoCpf, setInformandoCpf] = useState<PedidoLogin | null>(null);
  // Prontos (admitidos na Senior) primeiro; depois os que aguardam admissão.
  const lista = (filtro === "abertos" ? pedidos.filter((p) => p.status === "pendente" || p.status === "criado") : pedidos)
    .slice().sort((a, b) => Number(pedidoPronto(b)) - Number(pedidoPronto(a)));

  return (
    <div className="space-y-3">
      <Card className="flex flex-wrap items-center gap-3 p-3 text-xs text-muted-foreground">
        <span>
          Vaga de encarregado com <b className="text-foreground">"Precisa de login para a ERP?"</b> chega aqui quando o contratado é enviado à Admissão.
          O login só é liberado quando a admissão aparece na Senior como <b className="text-foreground">Trabalhando</b> (pelo CPF) — ao informar o e-mail,
          ele fica <b className="text-foreground">vinculado ao colaborador</b>, e se ele for demitido o acesso ao ERP para sozinho. Crie a conta em
        </span>
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
                <SeloPedido status={p.status} pronto={pedidoPronto(p)} />
              </div>
              <Linha rotulo="Nome" valor={p.nome} />
              <Linha rotulo="E-mail" valor={p.login_email ?? p.email_sugerido} mono />
              {p.senha ? <Linha rotulo="Senha" valor={p.senha} mono /> : (
                <p className="text-xs text-muted-foreground">{p.status === "entregue" ? `Senha repassada e apagada do sistema em ${fmtData(p.entregue_em)}.` : "Sem senha guardada."}</p>
              )}
              <BlocoSenior pedido={p} onInformarCpf={() => setInformandoCpf(p)} />
              <p className="text-[11px] text-muted-foreground">
                Pedida por {p.solicitante_nome ?? p.solicitante_email ?? "—"} · chegou em {fmtData(p.created_at)}
                {p.criado_em && ` · criado por ${p.criado_por_nome ?? "—"} em ${fmtData(p.criado_em)}`}
                {p.obs && ` · ${p.obs}`}
              </p>
              {(p.status === "pendente" || p.status === "criado") && (
                <AcessoGate menu={MENU} acao="alterar">
                  <div className="flex flex-wrap gap-2 pt-1">
                    {/* Só com a admissão Trabalhando na Senior: é ela que recebe o vínculo. */}
                    <Button size="sm" disabled={!p.senior_id} onClick={() => setCriando(p)}
                      title={p.senior_id ? undefined : "Aguardando a admissão aparecer na Senior como Trabalhando"}>
                      <KeyRound className="mr-1 h-4 w-4" /> {p.status === "pendente" ? "Informar login e vincular" : "Corrigir login/senha"}
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setInformandoCpf(p)}><IdCard className="mr-1 h-4 w-4" /> {p.cpf ? "Corrigir CPF" : "Informar CPF"}</Button>
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
      <DialogCpf pedido={informandoCpf} onClose={() => setInformandoCpf(null)} />
    </div>
  );
}

function SeloPedido({ status, pronto }: { status: PedidoLogin["status"]; pronto?: boolean }) {
  const m = {
    pendente: pronto ? ["Admitido — liberar login", "border-amber-300 bg-amber-50 text-amber-700"]
                     : ["Aguardando admissão na Senior", "border-slate-300 bg-slate-50 text-slate-600"],
    criado: ["Criado e vinculado — aguardando repasse", "border-sky-300 bg-sky-50 text-sky-700"],
    entregue: ["Entregue", "border-emerald-300 bg-emerald-50 text-emerald-700"],
    cancelado: ["Cancelado", "border-slate-300 bg-slate-50 text-slate-500"],
  } as const;
  return <Badge variant="outline" className={`shrink-0 text-[10px] ${m[status][1]}`}>{m[status][0]}</Badge>;
}

const fmtCpf = (c: string | null) => {
  const d = (c ?? "").replace(/\D/g, "");
  return d.length === 11 ? `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}` : (c || "—");
};

/** A situação do admitido na Senior — é o que libera (e recebe) o login. */
function BlocoSenior({ pedido: p, onInformarCpf }: { pedido: PedidoLogin; onInformarCpf: () => void }) {
  if (p.status === "cancelado") return null;
  if (!p.cpf) {
    return (
      <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs">
        <IdCard className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
        <span>Pedido <b>sem CPF</b>. Sem ele não dá para achar a admissão na Senior —{" "}
          <button type="button" className="font-semibold text-primary underline" onClick={onInformarCpf}>informe o CPF</button> (peça ao Recrutamento).</span>
      </div>
    );
  }
  if (!p.senior_id) {
    return (
      <div className="flex items-start gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
        <Clock className="mt-0.5 h-4 w-4 shrink-0" />
        <span>CPF {fmtCpf(p.cpf)} ainda <b className="text-foreground">não aparece como Trabalhando</b> na Senior. O login é liberado assim que a admissão for feita lá.</span>
      </div>
    );
  }
  const vinculadoAqui = p.auth_user_id && p.empregado_id === p.senior_id;
  return (
    <div className="flex items-start gap-2 rounded-md border border-emerald-300/60 bg-emerald-50/60 px-3 py-2 text-xs dark:bg-emerald-950/20">
      <UserCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
      <span className="min-w-0">
        <b>Admitido na Senior:</b> {p.senior_nome} · matr. {p.senior_cadastro ?? "—"} · {p.senior_cargo ?? "—"}
        <span className="block text-muted-foreground">{p.senior_filial ?? "—"} · admissão {fmtData(p.senior_admissao)} · CPF {fmtCpf(p.cpf)}</span>
        {p.senior_login && (
          <span className={`mt-0.5 flex items-center gap-1 ${vinculadoAqui ? "text-emerald-700" : "text-amber-700"}`}>
            <Link2 className="h-3.5 w-3.5" /> {vinculadoAqui ? "Vinculado ao login" : "Já vinculado ao login"} <b className="font-mono">{p.senior_login}</b>
          </span>
        )}
      </span>
    </div>
  );
}

function DialogCriado({ pedido, onClose }: { pedido: PedidoLogin | null; onClose: () => void }) {
  const marcar = useMarcarLoginCriado();
  const [login, setLogin] = useState("");
  const [senha, setSenha] = useState("");
  useEffect(() => { if (pedido) { setLogin(pedido.login_email ?? pedido.email_sugerido); setSenha(pedido.senha ?? ""); } }, [pedido]);
  const gravar = async () => {
    if (!pedido?.senior_id) return;
    try {
      await marcar.mutateAsync({ id: pedido.id, login, senha, empregadoId: pedido.senior_id });
      toast.success("Login vinculado ao colaborador — já aparece para quem pediu a vaga.");
      onClose();
    } catch (e) { toast.error((e as Error).message); }
  };
  return (
    <Dialog open={!!pedido} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Informar login e vincular — {pedido?.nome}</DialogTitle></DialogHeader>
        <p className="text-xs text-muted-foreground">
          Crie a conta em Administração › Usuários com este e-mail e confirme aqui. O ERP vincula o login ao cadastro abaixo:
          se o colaborador for demitido na Senior, o acesso ao ERP para sozinho (ele continua no Portal do Colaborador).
        </p>
        {pedido?.senior_id && (
          <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs">
            <p className="font-semibold">{pedido.senior_nome}</p>
            <p className="text-muted-foreground">Matr. {pedido.senior_cadastro ?? "—"} · {pedido.senior_cargo ?? "—"} · {pedido.senior_filial ?? "—"}</p>
            <p className="text-muted-foreground">Trabalhando desde {fmtData(pedido.senior_admissao)} · CPF {fmtCpf(pedido.cpf)}</p>
          </div>
        )}
        <div className="space-y-3">
          <div><Label className="text-xs">Login (e-mail)</Label><Input value={login} onChange={(e) => setLogin(e.target.value)} className="font-mono" /></div>
          <div><Label className="text-xs">Senha</Label><Input value={senha} onChange={(e) => setSenha(e.target.value)} className="font-mono" /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button disabled={marcar.isPending || !pedido?.senior_id} onClick={gravar}><Link2 className="mr-1 h-4 w-4" /> Confirmar e vincular</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DialogCpf({ pedido, onClose }: { pedido: PedidoLogin | null; onClose: () => void }) {
  const definir = useDefinirCpfPedido();
  const [cpf, setCpf] = useState("");
  useEffect(() => { if (pedido) setCpf(pedido.cpf ?? ""); }, [pedido]);
  const digitos = cpf.replace(/\D/g, "");
  return (
    <Dialog open={!!pedido} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>CPF do admitido — {pedido?.nome}</DialogTitle></DialogHeader>
        <p className="text-xs text-muted-foreground">É pelo CPF que o ERP encontra a admissão na Senior (situação Trabalhando) para liberar e vincular o login.</p>
        <div><Label className="text-xs">CPF</Label><Input value={cpf} onChange={(e) => setCpf(e.target.value)} placeholder="000.000.000-00" className="font-mono" /></div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button disabled={definir.isPending || digitos.length !== 11} onClick={async () => {
            if (!pedido) return;
            try { await definir.mutateAsync({ id: pedido.id, cpf: digitos }); toast.success("CPF gravado."); onClose(); }
            catch (e) { toast.error((e as Error).message); }
          }}><Check className="mr-1 h-4 w-4" /> Gravar</Button>
        </DialogFooter>
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

// ---- Logins bloqueados (demissão, férias, afastamentos) ------------------------

function Bloqueados({ lista, carregando }: { lista: LoginBloqueado[]; carregando: boolean }) {
  const ciente = useCienteBloqueio();
  const liberar = useLiberarLogin();
  const travar = useTravarLogin();
  const [verTodos, setVerTodos] = useState(false);
  const [liberando, setLiberando] = useState<LoginBloqueado | null>(null);
  const [motivo, setMotivo] = useState("");
  // Pendente = travado, sem OK e sem liberação. "Mostrar todos" traz os vistos e os liberados.
  const visiveis = useMemo(() => lista.filter((b) => verTodos || (!b.ciente && !b.liberado)), [lista, verTodos]);
  const liberados = lista.filter((b) => b.liberado).length;

  const ok = async (b: LoginBloqueado) => {
    try { await ciente.mutateAsync(b.auth_user_id); toast.success(`OK — ${b.nome}`); }
    catch (e) { toast.error((e as Error).message); }
  };
  const confirmarLiberar = async () => {
    if (!liberando) return;
    try { await liberar.mutateAsync({ authUserId: liberando.auth_user_id, motivo }); toast.success(`Login de ${liberando.nome} liberado enquanto estiver em ${liberando.situacao}.`); setLiberando(null); }
    catch (e) { toast.error((e as Error).message); }
  };
  const travarDeNovo = async (b: LoginBloqueado) => {
    if (!window.confirm(`Travar de novo o login de ${b.nome}? Ele(a) para de acessar o ERP na hora.`)) return;
    try { await travar.mutateAsync(b.auth_user_id); toast.success(`Login de ${b.nome} travado.`); }
    catch (e) { toast.error((e as Error).message); }
  };

  return (
    <div className="space-y-3">
      <Card className="flex flex-wrap items-center gap-3 p-3 text-xs text-muted-foreground">
        <span className="min-w-0 flex-1">
          O login da ERP é <b className="text-foreground">travado automaticamente</b> pela situação na Senior (pelo CPF): só entra quem está
          {" "}<b className="text-foreground">Trabalhando</b>, de <b className="text-foreground">Atestado</b> ou em <b className="text-foreground">Aviso Prévio Trabalhado</b>.
          Quem está <b className="text-foreground">afastado</b> (férias, licença, auxílio-doença…) pode ser <b className="text-foreground">liberado</b> com o motivo — vale enquanto durar aquela situação.
          {" "}<b className="text-foreground">Demitido não tem liberação.</b> O <b className="text-foreground">OK</b> só tira o aviso da lista.
        </span>
        <label className="flex items-center gap-1.5"><input type="checkbox" checked={verTodos} onChange={(e) => setVerTodos(e.target.checked)} /> Mostrar vistos e liberados{liberados > 0 ? ` (${liberados} liberado${liberados > 1 ? "s" : ""})` : ""}</label>
      </Card>
      {carregando ? <Card className="p-6 text-sm text-muted-foreground">Carregando…</Card> : visiveis.length === 0 ? (
        <Card className="p-6 text-center text-sm text-muted-foreground">Nenhum login travado para ver. 👍</Card>
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead className="bg-muted/60 text-left text-xs text-muted-foreground">
              <tr><th className="px-4 py-2 font-medium">Colaborador</th><th className="px-3 py-2 font-medium">Status</th><th className="px-3 py-2 font-medium">Login</th><th className="px-3 py-2 font-medium">Último acesso</th><th className="px-3 py-2" /></tr>
            </thead>
            <tbody>
              {visiveis.map((b) => (
                <tr key={b.auth_user_id} className="border-t align-top">
                  <td className="px-4 py-2">
                    <p className="font-semibold">{b.nome}</p>
                    <p className="text-xs text-muted-foreground">{[b.cargo, b.contrato].filter(Boolean).join(" · ")}</p>
                  </td>
                  <td className="px-3 py-2">
                    {b.liberado ? (
                      <>
                        <Badge variant="outline" className="border-success/50 text-success">Liberado · {b.situacao}</Badge>
                        <p className="mt-0.5 max-w-xs text-[11px] text-muted-foreground">“{b.liberado_motivo}” — {b.liberado_por} · {fmtData(b.liberado_em)}</p>
                      </>
                    ) : (
                      <>
                        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Travado por</p>
                        <Badge variant="outline" className={b.desligado ? "border-destructive/40 text-destructive" : "border-warning/50 text-warning"}>{b.situacao ?? "Sem situação"}</Badge>
                        {b.desligado && b.desde && <p className="mt-0.5 text-[11px] text-muted-foreground">desde {fmtData(b.desde)}</p>}
                      </>
                    )}
                  </td>
                  <td className="px-3 py-2"><div className="flex items-center gap-1.5"><span className="font-mono text-xs">{b.login_email}</span><BotaoCopiar texto={b.login_email} rotulo="Login" /></div></td>
                  <td className="whitespace-nowrap px-3 py-2 text-xs">{fmtData(b.ultimo_acesso)}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right">
                    <AcessoGate menu={MENU} acao="alterar" fallback={b.ciente ? <span className="text-xs text-muted-foreground">Visto · {b.ciente_por}</span> : null}>
                      <div className="flex items-center justify-end gap-1.5">
                        {b.liberado ? (
                          <Button size="sm" variant="ghost" className="text-destructive" disabled={travar.isPending} onClick={() => travarDeNovo(b)}><KeyRound className="mr-1 h-3.5 w-3.5" /> Travar de novo</Button>
                        ) : (
                          <>
                            {!b.desligado && <Button size="sm" variant="outline" onClick={() => { setLiberando(b); setMotivo(""); }}><UserCheck className="mr-1 h-3.5 w-3.5" /> Liberar</Button>}
                            {b.ciente ? <span className="text-xs text-muted-foreground">Visto · {b.ciente_por} · {fmtData(b.ciente_em)}</span>
                              : <Button size="sm" variant="outline" disabled={ciente.isPending} onClick={() => ok(b)}><Check className="mr-1 h-3.5 w-3.5" /> OK</Button>}
                          </>
                        )}
                      </div>
                    </AcessoGate>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
      <Dialog open={!!liberando} onOpenChange={(o) => !o && setLiberando(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Liberar o login de {liberando?.nome}?</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            Está travado por <b className="text-foreground">{liberando?.situacao}</b>. A liberação vale enquanto durar essa situação — se mudar
            (outro afastamento, demissão), o login trava de novo sozinho.
          </p>
          <div><Label className="text-xs">Por que liberar? *</Label><Textarea rows={2} value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ex.: precisa aprovar pedidos durante as férias, autorizado pela diretoria…" /></div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLiberando(null)}>Voltar</Button>
            <Button disabled={liberar.isPending || motivo.trim().length < 5} onClick={confirmarLiberar}><UserCheck className="mr-1 h-4 w-4" /> Liberar login</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
