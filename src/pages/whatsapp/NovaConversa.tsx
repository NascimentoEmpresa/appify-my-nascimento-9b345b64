import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { erroDaFunction } from "@/lib/utils";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, MessageCirclePlus, AlertTriangle, Info, MousePointerClick, Send } from "lucide-react";
import { fmtTelefone, type WaPasta } from "./types";

// O que wa_consultar_telefone devolve. `existe: false` é número que nunca
// falou com a gente — o caso normal de uma conversa que nós começamos.
interface Consulta {
  valido: boolean;
  existe?: boolean;
  nome?: string | null;
  nome_manual?: string | null;
  conversa_id?: string | null;
  pasta_codigo?: string | null;
  pode_ver?: boolean;
  tem_mensagens?: boolean;
  dentro_janela?: boolean;
}

// Valor do Select para "sem pasta". O Select não aceita item de valor "",
// e null não atravessa o componente — então a triagem tem um código próprio
// aqui e vira null na hora de chamar a RPC.
const SEM_PASTA = "__triagem__";

interface Props {
  aberto: boolean;
  onFechar: () => void;
  // A pasta volta junto para a Caixa poder alinhar a aba: sem isso a conversa
  // abriria "selecionada" numa lista que não a contém.
  onAberta: (conversaId: string, pastaCodigo: string | null) => void;
  // Quem tem o menu do Chatbot pode criar o template na Meta direto daqui.
  podeConfig: boolean;
  // Pastas que esta pessoa enxerga, e se ela vê as conversas sem pasta.
  pastas: WaPasta[];
  podeTodas: boolean;
}

export function NovaConversa({ aberto, onFechar, onAberta, podeConfig, pastas, podeTodas }: Props) {
  const { toast } = useToast();
  const qc = useQueryClient();

  const [telefone, setTelefone] = useState("");
  const [nome, setNome] = useState("");
  // O atendente mexeu no nome? Enquanto não mexeu, a consulta manda nele.
  // Sem esta trava, digitar o nome e continuar ajustando o telefone fazia a
  // consulta seguinte apagar o que a pessoa acabou de escrever.
  const [nomeTocado, setNomeTocado] = useState(false);
  const [enviarAbertura, setEnviarAbertura] = useState(true);
  // Onde a conversa nova vai nascer. Quem enxerga tudo pode deixar na
  // triagem; quem atende uma fila precisa nascer dentro dela, senão a RLS
  // esconde a conversa de quem acabou de criá-la.
  const [pasta, setPasta] = useState<string>(SEM_PASTA);
  const [consulta, setConsulta] = useState<Consulta | null>(null);
  const [consultando, setConsultando] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [faltaTemplate, setFaltaTemplate] = useState(false);
  const [criandoTemplate, setCriandoTemplate] = useState(false);

  const digitos = telefone.replace(/\D/g, "");
  const telefoneOk = digitos.length >= 10;

  // Texto/botão da abertura: mesma fonte que a edge function usa para enviar,
  // então a prévia aqui é o que a pessoa vai receber de verdade.
  const { data: cfg } = useQuery({
    queryKey: ["wa-abertura-cfg"],
    enabled: aberto,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data } = await (supabase as any).from("WA_BOT_CONFIG")
        .select("abertura_texto, abertura_botao").limit(1).maybeSingle();
      return (data ?? null) as { abertura_texto: string; abertura_botao: string } | null;
    },
  });

  // Zera tudo ao abrir/fechar — modal que guarda o número anterior faz o
  // atendente mandar abertura para a pessoa errada.
  useEffect(() => {
    setTelefone(""); setNome(""); setNomeTocado(false); setEnviarAbertura(true);
    setConsulta(null); setFaltaTemplate(false);
    setPasta(podeTodas ? SEM_PASTA : (pastas[0]?.codigo ?? SEM_PASTA));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aberto]);

  // "Quem é este número?" com debounce — a cada tecla seria uma consulta ao
  // banco por dígito digitado.
  useEffect(() => {
    if (!aberto) return;
    if (!telefoneOk) { setConsulta(null); setConsultando(false); return; }
    let cancelado = false;
    setConsultando(true);
    const t = setTimeout(async () => {
      const { data, error } = await (supabase as any).rpc("wa_consultar_telefone", { p_telefone: digitos });
      if (cancelado) return;
      setConsultando(false);
      if (error) { setConsulta(null); return; }
      const r = (data ?? null) as Consulta | null;
      setConsulta(r);
      // Preenche o nome com o que já sabemos deste número. Só enquanto o
      // atendente não digitou o dele.
      if (r?.existe && !nomeTocado) setNome((r.nome_manual ?? r.nome ?? "").trim());
      // Conversa que já tem mensagens não precisa de abertura: é só abrir.
      if (r?.tem_mensagens) setEnviarAbertura(false);
    }, 400);
    return () => { cancelado = true; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [digitos, aberto]);

  const criarTemplate = async () => {
    setCriandoTemplate(true);
    try {
      const { data, error } = await supabase.functions.invoke("whatsapp-abertura", {
        body: { acao: "criar_template" },
      });
      if (error) throw new Error(await erroDaFunction(error));
      const r = data as { status?: string; ja_existia?: boolean };
      toast({
        title: r.ja_existia ? `Template já existe (${r.status})` : "Template enviado para a Meta",
        description: r.status === "APPROVED"
          ? "Já está aprovado — pode mandar a abertura."
          : "A revisão costuma levar de alguns minutos a um dia. Enquanto isso, só dá para responder quem escreveu primeiro.",
      });
      if (r.status === "APPROVED") setFaltaTemplate(false);
    } catch (e) {
      toast({ title: "Não deu para criar o template", description: String((e as Error)?.message ?? e), variant: "destructive" });
    } finally {
      setCriandoTemplate(false);
    }
  };

  const confirmar = async () => {
    if (!telefoneOk || salvando) return;
    setSalvando(true);
    setFaltaTemplate(false);
    try {
      const { data, error } = await (supabase as any).rpc("wa_abrir_conversa_por_telefone", {
        p_telefone: digitos,
        p_nome: nome.trim() || null,
        p_pasta: pasta === SEM_PASTA ? null : pasta,
      });
      if (error) throw new Error(error.message);
      const r = data as { conversa_id: string; pasta_codigo: string | null };
      if (!r?.conversa_id) throw new Error("não consegui abrir a conversa");

      // A conversa já existe a partir daqui. Se a abertura falhar, ela fica
      // na Caixa mesmo assim — o atendente vê o motivo na bolha e decide.
      if (enviarAbertura) {
        const { error: erroEnvio } = await supabase.functions.invoke("whatsapp-abertura", {
          body: { conversa_id: r.conversa_id },
        });
        if (erroEnvio) {
          const detalhe = await erroDaFunction(erroEnvio);
          // A function marca o caso "template não aprovado" para a gente
          // poder oferecer a criação em vez de só repetir o erro.
          if (/template/i.test(detalhe)) setFaltaTemplate(true);
          toast({ title: "Conversa criada, mas a abertura não saiu", description: detalhe, variant: "destructive" });
          qc.invalidateQueries({ queryKey: ["wa-conversas"] });
          onAberta(r.conversa_id, r.pasta_codigo ?? null);
          return;
        }
      }

      qc.invalidateQueries({ queryKey: ["wa-conversas"] });
      onAberta(r.conversa_id, r.pasta_codigo ?? null);
      onFechar();
    } catch (e) {
      toast({ title: "Não deu para abrir a conversa", description: String((e as Error)?.message ?? e), variant: "destructive" });
    } finally {
      setSalvando(false);
    }
  };

  const jaTemConversa = !!consulta?.tem_mensagens;
  // Conversa que existe numa pasta fora do acesso: a RPC recusaria, e a RLS
  // não deixaria abrir. Barrar aqui evita o clique que só produz erro.
  const foraDoAcesso = !!consulta?.conversa_id && consulta?.pode_ver === false;
  // Sem pasta escolhida e sem "todas", a conversa nasceria invisível.
  const semDestino = !podeTodas && pasta === SEM_PASTA;

  return (
    <Dialog open={aberto} onOpenChange={(v) => !v && onFechar()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MessageCirclePlus className="h-5 w-5 text-success" /> Nova conversa
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="wa-telefone">Número (com DDD)</Label>
            <Input
              id="wa-telefone" autoFocus inputMode="tel" placeholder="(51) 99999-9999"
              value={telefone} onChange={(e) => setTelefone(e.target.value)}
            />
            <p className="min-h-[16px] text-[11px] text-muted-foreground">
              {!telefoneOk
                ? "Informe DDD + número."
                : consultando
                  ? "Procurando…"
                  : consulta?.existe
                    ? `Já temos este contato${consulta.tem_mensagens ? " — e a conversa dele" : ""}: ${fmtTelefone(digitos)}`
                    : `Número novo: ${fmtTelefone(digitos)}`}
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="wa-nome">Nome</Label>
            <Input
              id="wa-nome" placeholder="Como esta pessoa aparece na Caixa de Entrada"
              value={nome}
              onChange={(e) => { setNome(e.target.value); setNomeTocado(true); }}
            />
            {/* O nome do WhatsApp (profile.name) só chega junto da mensagem de
                entrada — não há como perguntá-lo à Meta a partir do número.
                Dizer isso aqui evita a impressão de campo quebrado. */}
            <p className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
              <Info className="mt-px h-3 w-3 shrink-0" />
              {consulta?.existe && (consulta.nome ?? "").trim()
                ? <>No WhatsApp esta pessoa se chama <b>{consulta.nome}</b>. O nome que você escrever aqui é o que a equipe vai ver.</>
                : <>O nome do WhatsApp aparece sozinho quando a pessoa responder. Até lá, vale o que você escrever aqui.</>}
            </p>
          </div>

          {/* Pasta de destino. Some quando a conversa já existe: ela fica onde
              está, e mover é ação à parte (que avisa o contato). */}
          {!jaTemConversa && (
            <div className="space-y-1.5">
              <Label>Pasta</Label>
              <Select value={pasta} onValueChange={setPasta}>
                <SelectTrigger><SelectValue placeholder="Escolha a pasta" /></SelectTrigger>
                <SelectContent>
                  {podeTodas && <SelectItem value={SEM_PASTA}>Sem pasta (triagem)</SelectItem>}
                  {pastas.map((p) => <SelectItem key={p.codigo} value={p.codigo}>{p.nome}</SelectItem>)}
                </SelectContent>
              </Select>
              {!podeTodas && (
                <p className="text-[11px] text-muted-foreground">
                  A conversa nasce nesta pasta — é por ela que você continua enxergando o atendimento.
                </p>
              )}
            </div>
          )}

          {foraDoAcesso && (
            <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
              <div>
                <p className="font-semibold">Este número já está em atendimento</p>
                <p className="mt-0.5 text-muted-foreground">
                  A conversa dele está numa pasta que você não acessa. Peça a liberação em Administração › Acesso por
                  Usuário, ou peça a quem atende aquela pasta para assumir.
                </p>
              </div>
            </div>
          )}

          {/* Mensagem de abertura */}
          <div className="rounded-md border border-border p-3">
            <label className="flex items-center gap-2 text-sm font-medium">
              <input
                type="checkbox" className="h-4 w-4 accent-primary"
                checked={enviarAbertura} onChange={(e) => setEnviarAbertura(e.target.checked)}
              />
              Enviar a mensagem de abertura
            </label>
            {jaTemConversa && (
              <p className="mt-1 text-[11px] text-muted-foreground">
                Este número já conversou com a gente — normalmente é só abrir a conversa e escrever.
              </p>
            )}
            {enviarAbertura && (
              <div className="mt-2 rounded-md bg-success/10 p-2.5 text-xs">
                <p className="whitespace-pre-wrap break-words">{cfg?.abertura_texto ?? "…"}</p>
                {cfg?.abertura_botao && (
                  <div className="mt-1.5 flex items-center justify-center gap-1 rounded-md border-t border-current/15 bg-muted px-2 py-1 text-[11px] font-medium">
                    <MousePointerClick className="h-3 w-3 opacity-70" /> {cfg.abertura_botao}
                  </div>
                )}
              </div>
            )}
            {enviarAbertura && consulta?.dentro_janela === false && consulta?.tem_mensagens && (
              <p className="mt-2 text-[11px] text-muted-foreground">
                Passou de 24h desde a última mensagem dela, então esta abertura sai como template aprovado.
              </p>
            )}
          </div>

          {faltaTemplate && (
            <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/5 p-3">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
              <div className="min-w-0 flex-1 text-xs">
                <p className="font-semibold">Falta o template aprovado na Meta</p>
                <p className="mt-0.5 text-muted-foreground">
                  Fora da janela de 24h a Meta só entrega mensagem de template. A conversa já está criada — assim que
                  o template for aprovado, a abertura pode ser reenviada.
                </p>
                {podeConfig && (
                  <Button
                    size="sm" variant="outline" className="mt-2 gap-1.5"
                    onClick={criarTemplate} disabled={criandoTemplate}
                  >
                    {criandoTemplate ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                    Criar template na Meta
                  </Button>
                )}
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onFechar} disabled={salvando}>Cancelar</Button>
          <Button
            className="gap-1.5 bg-success text-success-foreground hover:bg-success/90"
            onClick={confirmar} disabled={!telefoneOk || salvando || foraDoAcesso || semDestino}
          >
            {salvando
              ? <><Loader2 className="h-4 w-4 animate-spin" /> Abrindo…</>
              : <><MessageCirclePlus className="h-4 w-4" /> {jaTemConversa && !enviarAbertura ? "Abrir conversa" : "Abrir e enviar"}</>}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
