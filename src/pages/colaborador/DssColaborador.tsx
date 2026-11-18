import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, CheckCircle2, ChevronRight, FileText, Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  chamarPortal, fmtData, fmtDataHora, useAbrirDssColaborador, useAssinarDssColaborador, useDssColaborador,
  type DssColaborador,
} from "@/hooks/useColaboradorPortal";
import { DECLARACAO_DSS, rotuloSemana } from "@/lib/treinamentos/dss";
import { Carregando, Chip, Erro, Secao, Vazio } from "./ui";

// =====================================================================
// PORTAL DO COLABORADOR — DSS (Diálogo Semanal de Segurança, SIS-2026-0891)
//
// /colaborador/dss       os DSS que valem para o contrato da pessoa (para
//                        ler e assinar) e o histórico dos que ela já viu.
// /colaborador/dss/:id   o DSS em si: abrir já registra o acesso no banco;
//                        a assinatura é a declaração + o botão, com data,
//                        hora, IP e aparelho gravados (col_dss_assinar). Sem
//                        senha pessoal, de propósito — ver o cabeçalho da
//                        mig 20261119100000.
// =====================================================================

function Situacao({ d }: { d: Pick<DssColaborador, "assinado_em" | "origem" | "acessado_em" | "vigente"> }) {
  if (d.assinado_em) return <Chip tom="ok">{d.origem === "papel" ? "Assinado em papel" : "Assinado"}</Chip>;
  if (!d.vigente) return <Chip tom="erro">Prazo encerrado</Chip>;
  return <Chip tom="alerta">{d.acessado_em ? "Falta assinar" : "Novo"}</Chip>;
}

export default function DssColaboradorLista() {
  const q = useDssColaborador();
  if (q.isLoading) return <Carregando texto="Buscando os DSS…" />;
  if (q.isError || !q.data) return <Erro erro={q.error} acao={<button className="text-sm underline" onClick={() => q.refetch()}>Tentar de novo</button>} />;
  const pendentes = q.data.filter((d) => !d.assinado_em && d.vigente);
  const historico = q.data.filter((d) => d.assinado_em || !d.vigente);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="grid h-11 w-11 place-items-center rounded-xl bg-primary/10 text-primary"><ShieldCheck className="h-6 w-6" /></div>
        <div>
          <h1 className="font-display text-xl font-bold leading-tight">DSS – Diálogo Semanal de Segurança</h1>
          <p className="text-xs text-muted-foreground">Leia as orientações da semana e assine para confirmar.</p>
        </div>
      </div>

      <Secao titulo="Para ler e assinar" descricao={pendentes.length ? `${pendentes.length} pendente(s)` : undefined}>
        {pendentes.length === 0 ? <Vazio>Nenhum DSS pendente. Quando o SST publicar o próximo, ele aparece aqui.</Vazio> : <Lista itens={pendentes} />}
      </Secao>

      {historico.length > 0 && (
        <Secao titulo="Histórico">
          <Lista itens={historico} />
        </Secao>
      )}
    </div>
  );
}

function Lista({ itens }: { itens: DssColaborador[] }) {
  return (
    <ul className="divide-y divide-border">
      {itens.map((d) => (
        <li key={d.id}>
          <Link to={`/colaborador/dss/${d.id}`} className="flex items-center gap-3 py-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">{d.tema}</p>
              <p className="text-[11px] text-muted-foreground">{rotuloSemana(d.semana_ref)}</p>
              <div className="mt-1"><Situacao d={d} /></div>
            </div>
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function DssColaboradorLeitura() {
  const { dssId } = useParams<{ dssId: string }>();
  const q = useAbrirDssColaborador(dssId);
  const assinar = useAssinarDssColaborador(dssId);
  const [ciente, setCiente] = useState(false);
  const [abrindoArquivo, setAbrindoArquivo] = useState(false);

  const voltar = <Link to="/colaborador/dss" className="inline-flex items-center gap-1 text-sm font-semibold text-primary"><ArrowLeft className="h-4 w-4" />Meus DSS</Link>;
  if (q.isLoading) return <Carregando texto="Abrindo o DSS…" />;
  if (q.isError || !q.data) return <div className="space-y-3">{voltar}<Erro erro={q.error} /></div>;
  const d = q.data;

  const abrirArquivo = async () => {
    setAbrindoArquivo(true);
    try {
      const { url } = await chamarPortal<{ url: string }>("dss_arquivo", { dss_id: d.id });
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (e) { toast.error(e instanceof Error ? e.message : "Não foi possível abrir o material."); }
    finally { setAbrindoArquivo(false); }
  };

  const confirmar = () => assinar.mutate(undefined, {
    onSuccess: () => toast.success("Pronto! Sua assinatura do DSS foi registrada."),
    onError: (e) => toast.error(e instanceof Error ? e.message : "Não foi possível assinar."),
  });

  return (
    <div className="space-y-4">
      {voltar}
      <Secao titulo={d.tema} descricao={`${rotuloSemana(d.semana_ref)} · ${d.contrato}`} acao={<Situacao d={d} />}>
        {d.conteudo.trim() && <div className="whitespace-pre-wrap break-words text-[15px] leading-relaxed">{d.conteudo}</div>}
        {d.tem_arquivo && (
          <Button variant="outline" className="mt-3 w-full" onClick={abrirArquivo} disabled={abrindoArquivo}>
            {abrindoArquivo ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileText className="mr-2 h-4 w-4" />}
            Abrir material {d.arquivo_nome ? `(${d.arquivo_nome})` : ""}
          </Button>
        )}
      </Secao>

      {d.assinado_em ? (
        <Secao>
          <div className="flex items-start gap-3">
            <CheckCircle2 className="mt-0.5 h-6 w-6 shrink-0 text-success" />
            <div className="min-w-0 space-y-1 text-sm">
              <p className="font-semibold">{d.origem === "papel" ? "Assinado na folha em papel" : "Você assinou este DSS"} em {fmtDataHora(d.assinado_em)}</p>
              {d.origem === "papel" && <p className="text-xs text-muted-foreground">A folha assinada com o seu encarregado foi registrada pelo SST.</p>}
              <p className="break-all text-[11px] text-muted-foreground">Código de comprovação: {d.assinatura_hash}</p>
            </div>
          </div>
        </Secao>
      ) : !d.vigente ? (
        <Erro erro={new Error(`O prazo para assinar este DSS terminou${d.disponivel_ate ? ` em ${fmtData(d.disponivel_ate)}` : ""}. Fale com o seu encarregado.`)} />
      ) : (
        <Secao titulo="Assinatura">
          <label className="flex items-start gap-3 rounded-xl bg-muted/50 p-3 text-sm">
            <Checkbox className="mt-0.5" checked={ciente} onCheckedChange={(v) => setCiente(v === true)} />
            <span>{DECLARACAO_DSS}</span>
          </label>
          <Button className="mt-3 h-12 w-full text-base" disabled={!ciente || assinar.isPending} onClick={confirmar}>
            {assinar.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Li e estou ciente — assinar
          </Button>
          <p className="mt-2 text-[11px] text-muted-foreground">Ficam registrados a data, a hora e o aparelho usado para assinar.</p>
        </Secao>
      )}
    </div>
  );
}
