import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CalendarDays, MapPin, Video } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCriarReuniao, verificarBloqueioAgenda, verificarConflitoParticipante, verificarConflitoSala } from "../useReunioes";
import { montarReuniaoExtraordinaria, pessoasObrigatoriasReuniao, tituloReuniaoExtraordinaria } from "../transferenciaPauta";
import {
  MOTIVO_BLOQUEIO_LABEL, SALAS_PRESENCIAIS, nomeUsuario,
  type Reuniao, type ReuniaoConvidado, type ReuniaoPauta, type TipoLocalReuniao, type Usuario,
} from "../types";

interface ReuniaoDestino {
  id: string;
  numero: string;
  titulo: string;
  data_hora: string;
  tipo_local: TipoLocalReuniao;
  local_ou_link: string;
}

const fmtDataHora = (iso: string) => new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });

/**
 * SIS-2026-0373: "movimentar uma pauta para uma próxima reunião já marcada
 * ou até criar uma extraordinária". Transferência com rastro (RPC
 * transferir_pauta_reuniao) — a extraordinária é criada com o mesmo
 * criarUmaReuniao do formulário normal, herdando da reunião de origem tudo
 * que não é data/hora/local, e recebe a pauta pela mesma RPC.
 */
export function TransferirPautaDialog({
  pauta, reuniaoOrigem, convidadosOrigem, usuarios, userId, onFechar, onTransferir,
}: {
  pauta: ReuniaoPauta | null;
  reuniaoOrigem: Reuniao;
  convidadosOrigem: ReuniaoConvidado[];
  usuarios: Usuario[];
  userId: string | undefined;
  onFechar: () => void;
  onTransferir: (pautaId: string, reuniaoDestinoId: string) => Promise<boolean>;
}) {
  const open = !!pauta;
  const [aba, setAba] = useState<"existente" | "extraordinaria">("existente");
  const [destinoId, setDestinoId] = useState("");
  const [titulo, setTitulo] = useState("");
  const [data, setData] = useState("");
  const [hora, setHora] = useState("");
  const [duracao, setDuracao] = useState(reuniaoOrigem.duracao_minutos);
  const [tipoLocal, setTipoLocal] = useState<TipoLocalReuniao>(reuniaoOrigem.tipo_local);
  const [sala, setSala] = useState("");
  const [salaOutro, setSalaOutro] = useState("");
  const [link, setLink] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [processando, setProcessando] = useState(false);
  const criarReuniao = useCriarReuniao();

  // Reabre limpo a cada item — estado não pode vazar de uma pauta pra outra.
  // Local já vem sugerido com o da reunião de origem.
  useEffect(() => {
    if (!pauta) return;
    const salaFixa = (SALAS_PRESENCIAIS as readonly string[]).includes(reuniaoOrigem.local_ou_link);
    const origemOnline = reuniaoOrigem.tipo_local === "online";
    setAba("existente");
    setDestinoId("");
    setErro(null);
    setTitulo(tituloReuniaoExtraordinaria(pauta.titulo_topico));
    setData("");
    setHora("");
    setDuracao(reuniaoOrigem.duracao_minutos);
    setTipoLocal(reuniaoOrigem.tipo_local);
    setSala(origemOnline ? "" : salaFixa ? reuniaoOrigem.local_ou_link : "Outro");
    setSalaOutro(!origemOnline && !salaFixa ? reuniaoOrigem.local_ou_link : "");
    setLink(origemOnline ? reuniaoOrigem.local_ou_link : reuniaoOrigem.link_online ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pauta?.id]);

  const { data: destinos = [], isLoading: carregandoDestinos } = useQuery({
    queryKey: ["reuniao-destinos-transferencia", reuniaoOrigem.id, userId],
    enabled: open && !!userId,
    queryFn: async () => {
      // Só reuniões futuras ainda "agendada" que o usuário organiza — a RPC valida a mesma regra no banco.
      const { data: linhas, error } = await (supabase as any)
        .from("reuniao")
        .select("id, numero, titulo, data_hora, tipo_local, local_ou_link")
        .eq("etapa", "agendada")
        .neq("id", reuniaoOrigem.id)
        .gte("data_hora", new Date().toISOString())
        .or(`criado_por.eq.${userId},responsavel_preenchimento_user_id.eq.${userId},organizador_user_id.eq.${userId}`)
        .order("data_hora", { ascending: true })
        .limit(50);
      if (error) throw error;
      return (linhas ?? []) as ReuniaoDestino[];
    },
  });

  const usaSala = tipoLocal === "presencial" || tipoLocal === "hibrido";
  const usaLink = tipoLocal === "online" || tipoLocal === "hibrido";
  const salaFinal = sala === "Outro" ? salaOutro.trim() : sala;
  const localFinal = usaSala ? salaFinal : link.trim();
  const formValido = !!titulo.trim() && !!data && !!hora && duracao > 0 && (!usaSala || !!salaFinal) && (!usaLink || !!link.trim());
  const hoje = new Date().toLocaleDateString("sv-SE");

  const fechar = () => { if (!processando) onFechar(); };

  const transferirParaExistente = async () => {
    if (!pauta || !destinoId) return;
    setProcessando(true);
    const ok = await onTransferir(pauta.id, destinoId);
    setProcessando(false);
    if (ok) onFechar();
  };

  const criarExtraordinaria = async () => {
    if (!pauta || !formValido) return;
    setErro(null);
    const dataHoraIso = new Date(`${data}T${hora}:00`).toISOString();
    if (new Date(dataHoraIso) <= new Date()) {
      setErro("Escolha uma data e hora futuras.");
      return;
    }

    const nova = montarReuniaoExtraordinaria({
      origem: reuniaoOrigem,
      convidadosOrigem,
      tituloPauta: pauta.titulo_topico,
      titulo,
      dataHoraIso,
      duracaoMinutos: duracao,
      tipoLocal,
      localOuLink: localFinal,
      linkOnline: usaLink ? link.trim() : null,
    });

    setProcessando(true);
    try {
      // Mesmas checagens do ReuniaoFormCriar, antes de gravar qualquer coisa.
      if (usaSala) {
        const conflito = await verificarConflitoSala({ local: localFinal, dataHoraIso, duracaoMinutos: duracao });
        if (conflito) {
          setErro(`"${localFinal}" já está reservada nesse horário (reunião "${conflito.titulo}").`);
          return;
        }
      }
      for (const pessoaId of pessoasObrigatoriasReuniao(nova)) {
        const rotulo = nomeUsuario(usuarios, pessoaId) ?? "Um participante";
        const bloqueio = await verificarBloqueioAgenda({ userId: pessoaId, dataHoraIso, duracaoMinutos: duracao });
        if (bloqueio) {
          setErro(`${rotulo} está com a agenda bloqueada nesse horário (${MOTIVO_BLOQUEIO_LABEL[bloqueio.motivo]}).`);
          return;
        }
        const conflito = await verificarConflitoParticipante({ userId: pessoaId, dataHoraIso, duracaoMinutos: duracao });
        if (conflito) {
          setErro(`${rotulo} já está em outra reunião nesse horário (reunião "${conflito.titulo}").`);
          return;
        }
      }

      const novaReuniaoId = await criarReuniao.mutateAsync(nova);
      // Se só a transferência falhar, a extraordinária já existe: o toast de
      // erro aparece e dá pra tentar de novo pela aba "Reunião já marcada".
      if (await onTransferir(pauta.id, novaReuniaoId)) onFechar();
    } catch {
      // useCriarReuniao já mostra o toast de erro.
    } finally {
      setProcessando(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) fechar(); }}>
      <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Mover pauta para outra reunião</DialogTitle>
          <DialogDescription>
            "{pauta?.titulo_topico}" será incluída na reunião escolhida. Aqui ela continua registrada, marcada como transferida —
            a ata e o histórico desta reunião não mudam. Os anexos são copiados; respostas e ações ficam nesta reunião.
          </DialogDescription>
        </DialogHeader>

        <Tabs value={aba} onValueChange={(v) => { setAba(v as "existente" | "extraordinaria"); setErro(null); }}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="existente">Reunião já marcada</TabsTrigger>
            <TabsTrigger value="extraordinaria">Nova extraordinária</TabsTrigger>
          </TabsList>

          <TabsContent value="existente" className="space-y-3">
            {carregandoDestinos ? (
              <p className="text-sm text-muted-foreground">Carregando reuniões…</p>
            ) : destinos.length === 0 ? (
              <p className="rounded-md border border-dashed border-border p-3 text-sm text-muted-foreground">
                Nenhuma reunião futura agendada que você organize. Crie uma extraordinária na outra aba.
              </p>
            ) : (
              <div role="radiogroup" aria-label="Reunião de destino" className="max-h-72 space-y-1.5 overflow-y-auto pr-1">
                {destinos.map((d) => (
                  <button
                    key={d.id}
                    type="button"
                    role="radio"
                    aria-checked={destinoId === d.id}
                    onClick={() => setDestinoId(d.id)}
                    className={cn(
                      "w-full rounded-md border px-3 py-2 text-left transition-colors",
                      destinoId === d.id ? "border-primary bg-primary/5" : "border-border hover:bg-muted/50",
                    )}
                  >
                    <p className="text-sm font-medium">{d.titulo}</p>
                    <p className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                      <span>{d.numero}</span>
                      <span className="inline-flex items-center gap-1"><CalendarDays className="h-3 w-3" />{fmtDataHora(d.data_hora)}</span>
                      <span className="inline-flex items-center gap-1">
                        {d.tipo_local === "online" ? <Video className="h-3 w-3" /> : <MapPin className="h-3 w-3" />}
                        {d.tipo_local === "online" ? "Online" : d.local_ou_link}
                      </span>
                    </p>
                  </button>
                ))}
              </div>
            )}
            <DialogFooter>
              <Button variant="ghost" onClick={fechar} disabled={processando}>Cancelar</Button>
              <Button onClick={transferirParaExistente} disabled={!destinoId || processando}>
                {processando ? "Transferindo…" : "Transferir pauta"}
              </Button>
            </DialogFooter>
          </TabsContent>

          <TabsContent value="extraordinaria" className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Organizador, responsável pela ata, tipo, setor e participantes serão os mesmos da reunião {reuniaoOrigem.numero}.
            </p>
            <div className="space-y-1">
              <Label htmlFor="extra-titulo">Título</Label>
              <Input id="extra-titulo" value={titulo} onChange={(e) => setTitulo(e.target.value)} />
            </div>
            <div className="grid gap-2 sm:grid-cols-3">
              <div className="space-y-1">
                <Label htmlFor="extra-data">Data</Label>
                <Input id="extra-data" type="date" min={hoje} value={data} onChange={(e) => setData(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="extra-hora">Hora</Label>
                <Input id="extra-hora" type="time" value={hora} onChange={(e) => setHora(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="extra-duracao">Duração (min)</Label>
                <Input id="extra-duracao" type="number" min={5} step={5} value={duracao} onChange={(e) => setDuracao(Number(e.target.value) || 0)} />
              </div>
            </div>
            <div className="space-y-1">
              <Label>Local</Label>
              <Select value={tipoLocal} onValueChange={(v) => setTipoLocal(v as TipoLocalReuniao)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="presencial">Presencial</SelectItem>
                  <SelectItem value="online">Online</SelectItem>
                  <SelectItem value="hibrido">Híbrido</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {usaSala && (
              <>
                <Select value={sala} onValueChange={setSala}>
                  <SelectTrigger><SelectValue placeholder="Selecione a sala" /></SelectTrigger>
                  <SelectContent>
                    {SALAS_PRESENCIAIS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
                {sala === "Outro" && <Input value={salaOutro} onChange={(e) => setSalaOutro(e.target.value)} placeholder="Descreva o local" />}
              </>
            )}
            {usaLink && <Input value={link} onChange={(e) => setLink(e.target.value)} placeholder="Link da reunião" />}
            {erro && <p className="text-xs text-destructive">{erro}</p>}
            <DialogFooter>
              <Button variant="ghost" onClick={fechar} disabled={processando}>Cancelar</Button>
              <Button onClick={criarExtraordinaria} disabled={!formValido || processando}>
                {processando ? "Criando…" : "Criar e transferir"}
              </Button>
            </DialogFooter>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
