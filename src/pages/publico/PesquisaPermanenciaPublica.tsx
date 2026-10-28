import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import logoNascimento from "@/assets/logo-nascimento-completo.webp";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { usePesquisaPublica, useResponderPesquisa, type ContratoOpcao } from "@/hooks/usePesquisaPermanencia";
import {
  MENSAGEM_FINAL, MENSAGEM_INICIAL, PERGUNTA_PRINCIPAL, PERGUNTAS, TITULO_PESQUISA,
  alternar, alternarComplemento, errosDaPergunta, validarRespostas,
  type Pergunta, type RespostaPergunta, type Respostas,
} from "../../../supabase/functions/_shared/pesquisa-permanencia";

// =====================================================================
// PESQUISA DE PERMANÊNCIA — /pesquisa-permanencia/<token>, sem login
// (mig 20261028001200).
//
// Quem chega pelo link/QR da aplicação escolhe CONTRATO, POSTO e FUNÇÃO
// (listas da Senior/Hierarquia de Postos, nada digitado) e responde as 8
// perguntas do documento do RH. Não pede nome. As regras de cada pergunta
// (até 3 + a mais importante, complemento embaixo da alternativa, exclusiva)
// estão no _shared e são conferidas de novo no banco (pp_responder).
//
// Depois de enviar: a mensagem final do documento e um botão para a PRÓXIMA
// pessoa responder no mesmo aparelho (o celular do encarregado passa de mão
// em mão no posto) — por isso nada aqui trava "já respondeu".
// =====================================================================

const SEM_POSTO = "__sem_posto__";

export default function PesquisaPermanenciaPublica() {
  const { token } = useParams<{ token: string }>();
  const q = usePesquisaPublica(token);
  const enviar = useResponderPesquisa();
  const [contratoK, setContratoK] = useState<string | null>(null);
  const [posto, setPosto] = useState<string | null>(null);
  const [funcao, setFuncao] = useState<string | null>(null);
  const [resp, setResp] = useState<Respostas>({});
  const [tentouEnviar, setTentouEnviar] = useState(false);
  const [enviado, setEnviado] = useState(false);

  useEffect(() => { document.title = `${TITULO_PESQUISA} · Grupo Nascimento`; }, []);

  const contratos = q.data?.contratos ?? [];
  const contrato: ContratoOpcao | undefined = contratos.find((c) => `${c.empresa}-${c.filial}` === contratoK);
  const postoSel = contrato?.postos.find((p) => p.codigo === posto);
  // Função: as de quem está no posto escolhido; sem posto (ou posto vazio), as do contrato.
  const funcoes = postoSel && postoSel.funcoes.length ? postoSel.funcoes : contrato?.funcoes ?? [];

  const opcoesContrato = useMemo(() => contratos.map((c) => ({ value: `${c.empresa}-${c.filial}`, label: c.nome })), [contratos]);
  const opcoesPosto = useMemo(() => [
    { value: SEM_POSTO, label: "Não sei qual é o meu posto" },
    ...(contrato?.postos ?? []).map((p) => ({ value: p.codigo, label: p.nome, hint: p.codigo })),
  ], [contrato]);

  const recorteOk = !!contrato && posto !== null && !!funcao;
  const erros = validarRespostas(resp);

  const novaResposta = () => {
    setResp({}); setTentouEnviar(false); setEnviado(false);
    setContratoK(null); setPosto(null); setFuncao(null);
    window.scrollTo({ top: 0 });
  };

  const submeter = () => {
    setTentouEnviar(true);
    if (!recorteOk) { toast.error("Escolha o contrato, o posto e a função."); window.scrollTo({ top: 0, behavior: "smooth" }); return; }
    if (erros.length) {
      toast.error(erros[0]);
      const p = PERGUNTAS.find((x) => errosDaPergunta(x, resp[x.id]).length);
      if (p) document.getElementById(`pergunta-${p.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    enviar.mutate(
      { token: token!, empresa: contrato!.empresa, filial: contrato!.filial, posto: posto === SEM_POSTO ? null : posto, funcao: funcao!, respostas: resp },
      { onSuccess: () => { setEnviado(true); window.scrollTo({ top: 0 }); }, onError: (e) => toast.error(e.message) },
    );
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-2xl px-4 py-6">
        <div className="mb-5 flex justify-center"><img src={logoNascimento} alt="Grupo Nascimento" className="h-12" /></div>

        {q.isLoading ? (
          <div className="flex justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-slate-400" /></div>
        ) : q.error || !q.data?.encontrada ? (
          <Aviso icone={<XCircle className="h-10 w-10 text-red-500" />} titulo="Pesquisa não encontrada" texto="Confira o link ou o QR Code com o seu encarregado." />
        ) : !q.data.aberta ? (
          <Aviso icone={<XCircle className="h-10 w-10 text-amber-500" />} titulo={q.data.titulo ?? TITULO_PESQUISA} texto="Esta pesquisa não está recebendo respostas no momento." />
        ) : enviado ? (
          <div className="rounded-2xl bg-white p-8 text-center shadow-sm">
            <CheckCircle2 className="mx-auto h-14 w-14 text-emerald-500" />
            <p className="mt-4 text-lg font-semibold text-slate-800">{MENSAGEM_FINAL}</p>
            <Button variant="outline" className="mt-6" onClick={novaResposta}>Responder outra pessoa neste aparelho</Button>
          </div>
        ) : (
          <>
            <div className="rounded-2xl bg-white p-6 shadow-sm">
              <h1 className="text-xl font-bold text-slate-800">{TITULO_PESQUISA}</h1>
              <p className="mt-3 text-base font-semibold text-emerald-700">{MENSAGEM_INICIAL.titulo}</p>
              <p className="mt-2 text-sm leading-relaxed text-slate-600">{MENSAGEM_INICIAL.texto}</p>
              <p className="mt-2 text-xs text-slate-500">Não é preciso dizer o seu nome. Todas as perguntas são obrigatórias.</p>
            </div>

            <div className={cn("mt-4 space-y-3 rounded-2xl bg-white p-6 shadow-sm", tentouEnviar && !recorteOk && "ring-2 ring-red-300")}>
              <p className="font-semibold text-slate-800">Onde você trabalha</p>
              <Campo rotulo="Contrato">
                <SearchableSelect value={contratoK} options={opcoesContrato} placeholder="Escolha o contrato" searchPlaceholder="Buscar contrato…"
                  onChange={(v) => { setContratoK(v || null); setPosto(null); setFuncao(null); }} />
              </Campo>
              <Campo rotulo="Posto de trabalho">
                <SearchableSelect value={posto} options={opcoesPosto} placeholder={contrato ? "Escolha o posto" : "Escolha o contrato primeiro"}
                  searchPlaceholder="Buscar posto…" disabled={!contrato}
                  onChange={(v) => { setPosto(v || null); setFuncao(null); }} />
              </Campo>
              <Campo rotulo="Função">
                <SearchableSelect value={funcao} options={funcoes.map((f) => ({ value: f, label: f }))}
                  placeholder={posto === null ? "Escolha o posto primeiro" : "Escolha a função"} searchPlaceholder="Buscar função…"
                  disabled={posto === null} onChange={(v) => setFuncao(v || null)} />
              </Campo>
            </div>

            {PERGUNTAS.map((p) => (
              <BlocoPergunta key={p.id} p={p} r={resp[p.id]} mostrarErro={tentouEnviar}
                onChange={(r) => setResp((x) => ({ ...x, [p.id]: r }))} />
            ))}

            <Button className="mt-6 h-12 w-full text-base" onClick={submeter} disabled={enviar.isPending}>
              {enviar.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Enviar respostas
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

function Aviso({ icone, titulo, texto }: { icone: React.ReactNode; titulo: string; texto: string }) {
  return (
    <div className="rounded-2xl bg-white p-8 text-center shadow-sm">
      <div className="flex justify-center">{icone}</div>
      <p className="mt-3 text-lg font-semibold text-slate-800">{titulo}</p>
      <p className="mt-1 text-sm text-slate-600">{texto}</p>
    </div>
  );
}

function Campo({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return <div><p className="mb-1 text-sm font-medium text-slate-700">{rotulo}</p>{children}</div>;
}

function Marca({ multipla, ativo }: { multipla: boolean; ativo: boolean }) {
  return (
    <span className={cn("mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center border-2",
      multipla ? "rounded" : "rounded-full", ativo ? "border-emerald-600 bg-emerald-600" : "border-slate-300 bg-white")}>
      {ativo && <span className={cn("bg-white", multipla ? "h-2 w-2 rounded-sm" : "h-2 w-2 rounded-full")} />}
    </span>
  );
}

function BlocoPergunta({ p, r, onChange, mostrarErro }: {
  p: Pergunta; r: RespostaPergunta | undefined; onChange: (r: RespostaPergunta) => void; mostrarErro: boolean;
}) {
  const marcadas = r?.marcadas ?? [];
  const erros = mostrarErro ? errosDaPergunta(p, r) : [];
  const multipla = p.max > 1;
  return (
    <div id={`pergunta-${p.id}`} className={cn("mt-4 rounded-2xl bg-white p-6 shadow-sm", erros.length && "ring-2 ring-red-300")}>
      <p className="font-semibold text-slate-800">{p.numero}. {p.titulo}</p>
      <p className="mt-1 text-xs text-slate-500">{multipla ? `Marque até ${p.max} opções.` : "Marque uma opção."}</p>
      <div className="mt-3 space-y-2">
        {p.opcoes.map((o) => {
          const ativo = marcadas.includes(o.cod);
          const cheio = multipla && !ativo && !o.exclusiva && marcadas.filter((c) => !p.opcoes.find((x) => x.cod === c)?.exclusiva).length >= p.max;
          return (
            <div key={o.cod}>
              <button type="button" onClick={() => onChange(alternar(p, r, o.cod))} disabled={cheio}
                className={cn("flex w-full items-start gap-3 rounded-xl border px-3 py-2.5 text-left text-sm transition",
                  ativo ? "border-emerald-500 bg-emerald-50" : "border-slate-200 hover:bg-slate-50", cheio && "opacity-50")}>
                <Marca multipla={multipla} ativo={ativo} />
                <span className="text-slate-700">{o.rotulo}</span>
              </button>
              {ativo && o.complemento && (
                <div className="ml-4 mt-2 border-l-2 border-emerald-200 pl-4">
                  {o.complemento.texto && (
                    <div className="mb-3">
                      <p className="mb-1 text-sm font-medium text-slate-700">{o.complemento.texto.rotulo}</p>
                      <Input value={r?.texto?.[o.cod] ?? ""} maxLength={o.complemento.texto.max}
                        onChange={(e) => onChange({ ...r!, texto: { ...(r?.texto ?? {}), [o.cod]: e.target.value } })} />
                    </div>
                  )}
                  <p className="text-sm font-medium text-slate-700">{o.complemento.titulo}</p>
                  <p className="text-xs text-slate-500">{o.complemento.multipla ? "Marque todas as que se aplicam." : "Marque uma opção."}</p>
                  <div className="mt-2 space-y-1.5">
                    {o.complemento.opcoes.map((c) => {
                      const on = (r?.comp?.[o.cod] ?? []).includes(c.cod);
                      return (
                        <button key={c.cod} type="button" onClick={() => onChange(alternarComplemento(p, r!, o.cod, c.cod))}
                          className={cn("flex w-full items-start gap-3 rounded-lg border px-3 py-2 text-left text-sm",
                            on ? "border-emerald-500 bg-emerald-50" : "border-slate-200 hover:bg-slate-50")}>
                          <Marca multipla={o.complemento!.multipla} ativo={on} />
                          <span className="text-slate-700">{c.rotulo}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {multipla && marcadas.length > 1 && (
        <div className="mt-4 rounded-xl bg-slate-50 p-3">
          <p className="text-sm font-medium text-slate-700">{PERGUNTA_PRINCIPAL}</p>
          <div className="mt-2 space-y-1.5">
            {marcadas.map((cod) => {
              const o = p.opcoes.find((x) => x.cod === cod)!;
              const on = r?.principal === cod;
              return (
                <button key={cod} type="button" onClick={() => onChange({ ...r!, principal: cod })}
                  className={cn("flex w-full items-start gap-3 rounded-lg border bg-white px-3 py-2 text-left text-sm",
                    on ? "border-emerald-500" : "border-slate-200")}>
                  <Marca multipla={false} ativo={on} />
                  <span className="text-slate-700">{o.rotulo}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {erros.length > 0 && <p className="mt-3 text-sm text-red-600">{erros[0]}</p>}
    </div>
  );
}
