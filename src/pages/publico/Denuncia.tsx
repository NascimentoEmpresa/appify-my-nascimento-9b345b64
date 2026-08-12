import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { supabaseAnonimo } from "@/integrations/supabase/anonimo";
import logoGN from "@/assets/logo-grupo-nascimento.png";
import { ShieldCheck, Lock, Send, Search, Copy, Check, AlertTriangle } from "lucide-react";

// =====================================================================
// CANAL DE ÉTICA E DENÚNCIAS — página PÚBLICA (/denuncia)
//
// Sem login, como /vagas e /formularios/:slug. Todo colaborador (ou
// terceiro) registra um relato, anônimo ou identificado.
//
// COMO A CONFIDENCIALIDADE FUNCIONA
// A tela não lê nem escreve na tabela: a chave anon está revogada nela. O
// único caminho é a RPC `denuncia_registrar` (SECURITY DEFINER), que também
// NÃO grava IP, user-agent nem auth.uid(). Quem lê é só quem tiver o menu
// 'central_servicos_canal_denuncias' liberado em Acesso por Usuário.
// Ver migration 20260812000001_canal_denuncias.
//
// Estilo self-contained com prefixo `dn-`, igual a `pv-` (Vagas) e `fp-`
// (FormularioPublico): página pública não depende do tema nem do AppShell.
// =====================================================================

const RELACAO = [
  { value: "colaborador", label: "Colaborador(a) do Grupo Nascimento" },
  { value: "ex_colaborador", label: "Ex-colaborador(a)" },
  { value: "estagiario", label: "Estagiário(a) / Aprendiz / Menor" },
  { value: "terceirizado", label: "Terceirizado(a) / Prestador(a) de serviço" },
  { value: "fornecedor", label: "Fornecedor(a)" },
  { value: "cliente", label: "Cliente" },
  { value: "outro", label: "Outro" },
];

const TIPO_DENUNCIA = [
  { value: "assedio_moral", label: "Assédio moral" },
  { value: "assedio_sexual", label: "Assédio sexual" },
  { value: "discriminacao", label: "Discriminação / Preconceito" },
  { value: "fraude", label: "Fraude / Corrupção / Suborno" },
  { value: "furto_desvio", label: "Furto / Roubo / Desvio de dinheiro ou bens" },
  { value: "conflito_interesses", label: "Conflito de interesses" },
  { value: "uso_indevido", label: "Uso indevido de recursos ou patrimônio" },
  { value: "informacoes", label: "Vazamento / uso indevido de informações" },
  { value: "sst", label: "Segurança e saúde no trabalho (SST)" },
  { value: "meio_ambiente", label: "Meio ambiente" },
  { value: "violacao_conduta", label: "Violação de leis, normas ou do Código de Conduta" },
  { value: "outro", label: "Outro" },
];

const COMO_SOUBE = [
  { value: "presenciei", label: "Presenciei o fato" },
  { value: "vitima", label: "Fui a vítima" },
  { value: "terceiros", label: "Fui informado(a) por terceiros" },
  { value: "evidencias", label: "Encontrei evidências / documentos" },
  { value: "outro", label: "Outro" },
];

const SIM_NAO_NAOSEI = [
  { value: "sim", label: "Sim" },
  { value: "nao", label: "Não" },
  { value: "nao_sei", label: "Não sei" },
];

const STATUS_LABEL: Record<string, { titulo: string; desc: string; tom: string }> = {
  nova:         { titulo: "Recebida",                    desc: "Registrada e na fila para análise inicial.", tom: "info" },
  em_analise:   { titulo: "Em análise",                  desc: "A área responsável está avaliando o relato.", tom: "alerta" },
  apuracao:     { titulo: "Em apuração",                 desc: "A apuração dos fatos está em andamento.", tom: "alerta" },
  procedente:   { titulo: "Concluída — procedente",      desc: "A apuração confirmou o relato e as medidas cabíveis foram tomadas.", tom: "ok" },
  improcedente: { titulo: "Concluída — improcedente",    desc: "A apuração foi encerrada sem confirmar o fato relatado.", tom: "neutro" },
  arquivada:    { titulo: "Arquivada",                   desc: "O caso foi encerrado sem prosseguimento.", tom: "neutro" },
};

const fmtDt = (s?: string | null) => {
  if (!s) return "—";
  const d = new Date(s);
  return isNaN(+d) ? "—" : d.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
};

interface Form {
  identificado: "sim" | "nao" | "";
  nome_completo: string; cpf: string; email: string; data_nascimento: string;
  telefone_fixo: string; celular: string;
  relacao: string; tipo_denuncia: string; local_ocorrencia: string; como_soube: string;
  lideranca_ciente: string; lideranca_envolvida: string; lideranca_ocultou: string;
  descricao: string; testemunhas: string; evidencias: string;
  valor_financeiro: string; sugestao: string;
  concordou_termo: boolean;
}

const VAZIO: Form = {
  identificado: "", nome_completo: "", cpf: "", email: "", data_nascimento: "",
  telefone_fixo: "", celular: "", relacao: "", tipo_denuncia: "", local_ocorrencia: "",
  como_soube: "", lideranca_ciente: "", lideranca_envolvida: "", lideranca_ocultou: "",
  descricao: "", testemunhas: "", evidencias: "", valor_financeiro: "", sugestao: "",
  concordou_termo: false,
};

function Estilos() {
  return <style>{`
    .dn-bg { background: radial-gradient(1100px 520px at 12% -10%, #e8eefc 0%, transparent 55%),
                          radial-gradient(900px 460px at 100% 0%, #eef2ff 0%, transparent 50%), #eff2f8;
             min-height: 100vh; color: #1e293b; }
    .dn-wrap { max-width: 760px; margin: 0 auto; padding: 0 16px; }
    .dn-head { background: #0f3171; color: #fff; }
    .dn-card { background: #fff; border: 1px solid #e2e8f0; border-radius: 16px;
               padding: 20px; box-shadow: 0 10px 30px rgba(15,23,42,.06); }
    .dn-sec-t { font-size: 15px; font-weight: 800; color: #0f172a; margin-bottom: 14px; }
    .dn-lab { display:block; font-size: 13.5px; font-weight: 700; color: #334155; margin-bottom: 6px; }
    .dn-req { color: #dc2626; }
    .dn-help { font-size: 12px; line-height: 1.5; color: #64748b; margin: 0 0 6px; }
    .dn-in { width: 100%; border: 1px solid #cbd5e1; border-radius: 10px; padding: 10px 12px;
             font-size: 14px; font-family: inherit; background: #fff; outline: none; color: #1e293b; }
    .dn-in:focus { border-color: #0f3171; box-shadow: 0 0 0 3px rgba(15,49,113,.13); }
    .dn-in[aria-invalid="true"] { border-color: #dc2626; }
    .dn-btn { border: none; border-radius: 12px; padding: 13px 18px; font-size: 15px; font-weight: 700;
              cursor: pointer; background: #0f3171; color: #fff; transition: filter .15s, transform .1s; }
    .dn-btn:hover:not(:disabled) { filter: brightness(1.12); }
    .dn-btn:active:not(:disabled) { transform: scale(.985); }
    .dn-btn:disabled { opacity: .55; cursor: not-allowed; }
    .dn-btn-sec { background: #fff; color: #334155; border: 1px solid #cbd5e1; }
    .dn-btn-sec:hover:not(:disabled) { background: #f8fafc; filter: none; }
    .dn-esc { display:flex; gap:10px; flex-wrap: wrap; }
    .dn-esc button { flex:1; min-width: 210px; border:1px solid #cbd5e1; background:#fff; border-radius:12px;
                     padding: 12px 14px; font-size: 14px; font-weight: 600; color:#334155; cursor:pointer; }
    .dn-esc button[data-on="1"] { border-color:#0f3171; background:#eef3fd; color:#0f3171; box-shadow: inset 0 0 0 1px #0f3171; }
    .dn-aviso { border-left: 4px solid #f59e0b; background: #fffbeb; color: #92400e;
                border-radius: 12px; padding: 14px 16px; font-size: 14px; line-height: 1.55; }
    .dn-erro { border: 1px solid #fecaca; background: #fef2f2; color: #991b1b;
               border-radius: 12px; padding: 14px 16px; font-size: 14px; }
    .dn-grid2 { display: grid; gap: 14px; grid-template-columns: 1fr 1fr; }
    .dn-chip { border-radius: 12px; padding: 14px; border: 1px solid #e2e8f0; background: #f8fafc; }
    .dn-cod { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 20px;
              font-weight: 800; color: #0f3171; letter-spacing: .5px; user-select: all; }
    .dn-st-info    { border:1px solid #bae6fd; background:#f0f9ff; color:#075985; }
    .dn-st-alerta  { border:1px solid #fde68a; background:#fffbeb; color:#92400e; }
    .dn-st-ok      { border:1px solid #bbf7d0; background:#f0fdf4; color:#166534; }
    .dn-st-neutro  { border:1px solid #e2e8f0; background:#f8fafc; color:#475569; }
    @media (max-width: 620px) { .dn-grid2 { grid-template-columns: 1fr; } }
  `}</style>;
}

export default function Denuncia() {
  const [params, setParams] = useSearchParams();
  const [tela, setTela] = useState<"form" | "acompanhar">(
    params.get("acompanhar") !== null ? "acompanhar" : "form",
  );

  const irPara = (t: "form" | "acompanhar") => {
    setTela(t);
    const p = new URLSearchParams(params);
    if (t === "acompanhar") p.set("acompanhar", ""); else p.delete("acompanhar");
    setParams(p, { replace: true });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <div className="dn-bg">
      <Estilos />
      <header className="dn-head">
        <div className="dn-wrap flex items-center gap-3 py-4">
          <img src={logoGN} alt="Grupo Nascimento" className="h-9 w-auto shrink-0 brightness-0 invert" />
          <div className="min-w-0 flex-1">
            <p className="text-[17px] font-bold leading-tight">Canal de Ética e Denúncias</p>
            <p className="text-xs text-white/75">Grupo Nascimento</p>
          </div>
          <ShieldCheck className="h-6 w-6 shrink-0 text-white/70" />
        </div>
      </header>

      <main className="dn-wrap py-7">
        {tela === "form"
          ? <Formulario onAcompanhar={() => irPara("acompanhar")} />
          : <Acompanhar onVoltar={() => irPara("form")} />}
      </main>

      <footer className="dn-wrap pb-8 pt-2">
        <p className="text-center text-[11.5px] leading-relaxed text-slate-500">
          As informações são tratadas com confidencialidade e usadas exclusivamente para a apuração do relato.
        </p>
      </footer>
    </div>
  );
}

// ---------------------------------------------------------------- Formulário
function Formulario({ onAcompanhar }: { onAcompanhar: () => void }) {
  const [f, setF] = useState<Form>(VAZIO);
  const [enviando, setEnviando] = useState(false);
  const [erros, setErros] = useState<string[]>([]);
  const [ok, setOk] = useState<{ protocolo: string; senha: string } | null>(null);
  const [copiou, setCopiou] = useState(false);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((c) => ({ ...c, [k]: v }));

  const faltando = useMemo(() => ([
    { id: "dn-ident", label: "Você gostaria de se identificar?", ok: f.identificado !== "" },
    { id: "dn-nome", label: "Nome completo", ok: f.identificado !== "sim" || !!f.nome_completo.trim() },
    { id: "dn-rel", label: "Sua relação com o Grupo Nascimento", ok: !!f.relacao },
    { id: "dn-tipo", label: "Tipo de denúncia", ok: !!f.tipo_denuncia },
    { id: "dn-como", label: "Como tomou conhecimento", ok: !!f.como_soube },
    // 30 é o mínimo que a RPC exige — avisar aqui evita o erro vir do servidor.
    { id: "dn-desc", label: "O que você quer denunciar (mínimo de 30 caracteres)", ok: f.descricao.trim().length >= 30 },
    { id: "dn-termo", label: "Aceitar o termo", ok: f.concordou_termo },
  ].filter((c) => !c.ok)), [f]);

  const enviar = async () => {
    if (enviando) return;
    if (faltando.length) {
      setErros(faltando.map((x) => x.label));
      document.getElementById(faltando[0].id)?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    setErros([]);
    setEnviando(true);
    const ident = f.identificado === "sim";
    const { data, error } = await supabaseAnonimo.rpc("denuncia_registrar", {
      payload: {
        identificado: ident,
        nome_completo: ident ? f.nome_completo : "",
        cpf: ident ? f.cpf : "",
        email: ident ? f.email : "",
        data_nascimento: ident ? f.data_nascimento : "",
        telefone_fixo: ident ? f.telefone_fixo : "",
        celular: ident ? f.celular : "",
        relacao: f.relacao,
        tipo_denuncia: f.tipo_denuncia,
        local_ocorrencia: f.local_ocorrencia,
        como_soube: f.como_soube,
        lideranca_ciente: f.lideranca_ciente,
        lideranca_envolvida: f.lideranca_envolvida,
        lideranca_ocultou: f.lideranca_ocultou,
        descricao: f.descricao,
        testemunhas: f.testemunhas,
        evidencias: f.evidencias,
        valor_financeiro: f.valor_financeiro,
        sugestao: f.sugestao,
        concordou_termo: true,
      },
    });
    setEnviando(false);
    if (error) {
      setErros([error.message || "Não foi possível registrar agora. Tente novamente em instantes."]);
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    setOk(data as { protocolo: string; senha: string });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  if (ok) {
    return (
      <div className="dn-card text-center">
        <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
          <Check className="h-7 w-7" strokeWidth={3} />
        </div>
        <h1 className="text-xl font-bold text-slate-800">Denúncia registrada</h1>
        <p className="mx-auto mt-1.5 max-w-md text-sm leading-relaxed text-slate-600">
          Guarde o protocolo e a senha. São a única forma de acompanhar sua denúncia sem se identificar.
        </p>

        <div className="dn-grid2 mt-5 text-left">
          <div className="dn-chip">
            <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Protocolo</p>
            <p className="dn-cod mt-1">{ok.protocolo}</p>
          </div>
          <div className="dn-chip">
            <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Senha</p>
            <p className="dn-cod mt-1">{ok.senha}</p>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap justify-center gap-2.5">
          <button
            type="button" className="dn-btn dn-btn-sec inline-flex items-center gap-2"
            onClick={() => {
              navigator.clipboard?.writeText(`Protocolo: ${ok.protocolo} · Senha: ${ok.senha}`);
              setCopiou(true); setTimeout(() => setCopiou(false), 2000);
            }}
          >
            <Copy className="h-4 w-4" /> {copiou ? "Copiado!" : "Copiar"}
          </button>
          <button type="button" className="dn-btn dn-btn-sec" onClick={onAcompanhar}>
            Acompanhar esta denúncia
          </button>
        </div>

        {/* Aviso duro de propósito: não existe recuperação de senha. */}
        <p className="dn-aviso mx-auto mt-5 max-w-lg text-left">
          <b>Anote antes de fechar esta página.</b> Estes dados não são enviados por e-mail e não podem
          ser recuperados depois — nem por nós. É o que impede alguém de se passar por você para
          acompanhar a denúncia.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="dn-aviso flex items-start gap-2.5">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        <span>
          <b>ATENÇÃO!</b> O Canal de Ética <b>NÃO</b> deve ser utilizado para dúvidas, reclamações,
          sugestões ou críticas relacionadas aos produtos e serviços fornecidos.
        </span>
      </div>

      {erros.length > 0 && (
        <div className="dn-erro">
          <p className="font-bold">Verifique antes de enviar:</p>
          <ul className="mt-1 list-inside list-disc">{erros.map((e) => <li key={e}>{e}</li>)}</ul>
        </div>
      )}

      <section className="dn-card">
        <p className="dn-sec-t">Identificação</p>
        <div id="dn-ident">
          <label className="dn-lab">Você gostaria de se identificar? <span className="dn-req">*</span></label>
          <div className="dn-esc">
            <button type="button" data-on={f.identificado === "nao" ? "1" : "0"} onClick={() => set("identificado", "nao")}>
              Não, quero permanecer anônimo(a)
            </button>
            <button type="button" data-on={f.identificado === "sim" ? "1" : "0"} onClick={() => set("identificado", "sim")}>
              Sim, quero me identificar
            </button>
          </div>
          <p className="dn-help mt-1.5">
            A denúncia anônima é aceita e apurada da mesma forma. Identificar-se é opcional.
          </p>
        </div>

        {f.identificado === "sim" && (
          <div className="dn-grid2 mt-4">
            <div style={{ gridColumn: "1 / -1" }} id="dn-nome">
              <label className="dn-lab">Nome completo <span className="dn-req">*</span></label>
              <input className="dn-in" value={f.nome_completo} onChange={(e) => set("nome_completo", e.target.value)} />
            </div>
            <div><label className="dn-lab">CPF</label><input className="dn-in" value={f.cpf} onChange={(e) => set("cpf", e.target.value)} /></div>
            <div><label className="dn-lab">E-mail</label><input type="email" className="dn-in" value={f.email} onChange={(e) => set("email", e.target.value)} /></div>
            <div><label className="dn-lab">Data de nascimento</label><input type="date" className="dn-in" value={f.data_nascimento} onChange={(e) => set("data_nascimento", e.target.value)} /></div>
            <div><label className="dn-lab">Telefone fixo</label><input className="dn-in" value={f.telefone_fixo} onChange={(e) => set("telefone_fixo", e.target.value)} /></div>
            <div style={{ gridColumn: "1 / -1" }}><label className="dn-lab">Celular</label><input className="dn-in" value={f.celular} onChange={(e) => set("celular", e.target.value)} /></div>
          </div>
        )}
      </section>

      <section className="dn-card space-y-4">
        <p className="dn-sec-t">Sobre o fato</p>
        <div id="dn-rel">
          <label className="dn-lab">Qual a sua relação com o Grupo Nascimento? <span className="dn-req">*</span></label>
          <Sel valor={f.relacao} onChange={(v) => set("relacao", v)} opcoes={RELACAO} />
        </div>
        <div id="dn-tipo">
          <label className="dn-lab">Qual o tipo de denúncia melhor se enquadra ao fato que você está registrando? <span className="dn-req">*</span></label>
          <Sel valor={f.tipo_denuncia} onChange={(v) => set("tipo_denuncia", v)} opcoes={TIPO_DENUNCIA} />
        </div>
        <div>
          <label className="dn-lab">Indique a empresa/unidade/setor do grupo onde ocorreu o fato:</label>
          <input className="dn-in" value={f.local_ocorrencia} onChange={(e) => set("local_ocorrencia", e.target.value)} />
        </div>
        <div id="dn-como">
          <label className="dn-lab">Como tomou conhecimento deste fato/transgressão? <span className="dn-req">*</span></label>
          <Sel valor={f.como_soube} onChange={(v) => set("como_soube", v)} opcoes={COMO_SOUBE} />
        </div>
      </section>

      <section className="dn-card space-y-4">
        <p className="dn-sec-t">Envolvimento da liderança</p>
        <div>
          <label className="dn-lab">Algum Diretor, Gerente, Coordenador, Supervisor ou Encarregado está <b>CIENTE</b> do problema relatado?</label>
          <Sel valor={f.lideranca_ciente} onChange={(v) => set("lideranca_ciente", v)} opcoes={SIM_NAO_NAOSEI} />
        </div>
        <div>
          <label className="dn-lab">Algum Diretor, Gerente, Coordenador, Supervisor ou Encarregado está <b>ENVOLVIDO</b> diretamente no fato relatado?</label>
          <Sel valor={f.lideranca_envolvida} onChange={(v) => set("lideranca_envolvida", v)} opcoes={SIM_NAO_NAOSEI} />
        </div>
        <div>
          <label className="dn-lab">Algum Diretor, Gerente, Coordenador, Supervisor ou Encarregado tentou <b>ESCONDER</b> o problema relatado?</label>
          <p className="dn-help">
            Apesar de não se envolver diretamente, algumas pessoas podem propositadamente ter ignorado o
            problema, se comprometido a fazer algo, afirmado que não era um problema, ou alterado evidências.
          </p>
          <Sel valor={f.lideranca_ocultou} onChange={(v) => set("lideranca_ocultou", v)} opcoes={SIM_NAO_NAOSEI} />
        </div>
      </section>

      <section className="dn-card space-y-4">
        <p className="dn-sec-t">Relato</p>
        <div id="dn-desc">
          <label className="dn-lab">O que você quer denunciar? <span className="dn-req">*</span></label>
          <p className="dn-help">
            Descreva o mais detalhadamente possível o que aconteceu, indicando o nome das pessoas
            envolvidas, quando o fato ocorreu e se ainda continua ocorrendo.
          </p>
          <textarea
            className="dn-in" style={{ minHeight: 150, resize: "vertical" }}
            value={f.descricao} onChange={(e) => set("descricao", e.target.value)}
          />
          <p className="dn-help mt-1" style={{ textAlign: "right" }}>
            {f.descricao.trim().length < 30
              ? `Faltam ${30 - f.descricao.trim().length} caracteres`
              : `${f.descricao.length} caracteres`}
          </p>
        </div>
        <div>
          <label className="dn-lab">Existem testemunhas? Em caso positivo, indique-as.</label>
          <textarea className="dn-in" style={{ minHeight: 84, resize: "vertical" }} value={f.testemunhas} onChange={(e) => set("testemunhas", e.target.value)} />
        </div>
        <div>
          <label className="dn-lab">Você sabe se existem evidências sobre o fato? Em caso positivo, indique-as.</label>
          <p className="dn-help">
            Quais e onde podem ser encontradas? Existem documentos que comprovam o fato? Qualquer
            informação pode ser útil, por mais irrelevante que pareça.
            <b> ATENÇÃO: NÃO REMOVA OU TOME CONTATO COM QUALQUER EVIDÊNCIA OU PROVA</b>, pois a
            investigação pode ser prejudicada.
          </p>
          <textarea className="dn-in" style={{ minHeight: 84, resize: "vertical" }} value={f.evidencias} onChange={(e) => set("evidencias", e.target.value)} />
        </div>
        <div>
          <label className="dn-lab">Caso seja possível, indique o valor financeiro envolvido no fato relatado:</label>
          <input className="dn-in" value={f.valor_financeiro} onChange={(e) => set("valor_financeiro", e.target.value)} />
        </div>
        <div>
          <label className="dn-lab">Caso tenha alguma sugestão de como solucionar o problema, descreva-a:</label>
          <textarea className="dn-in" style={{ minHeight: 84, resize: "vertical" }} value={f.sugestao} onChange={(e) => set("sugestao", e.target.value)} />
        </div>
      </section>

      <section className="dn-card">
        <p className="dn-sec-t">Leia com atenção</p>
        <p className="text-sm leading-relaxed text-slate-600">
          Ao preencher o formulário, você concorda que o Grupo Nascimento salve e trate as informações
          prestadas, possibilitando que medidas sejam tomadas a partir da análise do conteúdo de suas
          respostas. As informações são tratadas de forma confidencial e usadas exclusivamente para a
          apuração do relato.
        </p>
        <label
          id="dn-termo"
          className="mt-3 flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3"
        >
          <input
            type="checkbox" className="mt-0.5 h-5 w-5"
            checked={f.concordou_termo} onChange={(e) => set("concordou_termo", e.target.checked)}
          />
          <span className="text-sm font-semibold text-slate-700">Li e concordo com o termo acima.</span>
        </label>
      </section>

      <button className="dn-btn inline-flex w-full items-center justify-center gap-2" onClick={enviar} disabled={enviando}>
        <Send className="h-4 w-4" /> {enviando ? "Enviando…" : "Registrar denúncia"}
      </button>
      <p className="text-center text-xs text-slate-500">
        Ao registrar, você recebe um <b>protocolo</b> e uma <b>senha</b> para acompanhar a denúncia.
      </p>
      <button className="dn-btn dn-btn-sec inline-flex w-full items-center justify-center gap-2" onClick={onAcompanhar}>
        <Search className="h-4 w-4" /> Já tenho um protocolo — acompanhar denúncia
      </button>
    </div>
  );
}

// -------------------------------------------------------------- Acompanhar
function Acompanhar({ onVoltar }: { onVoltar: () => void }) {
  const [protocolo, setProtocolo] = useState("");
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState("");
  const [carregando, setCarregando] = useState(false);
  const [dados, setDados] = useState<any>(null);

  const consultar = async () => {
    if (carregando) return;
    if (!protocolo.trim() || !senha.trim()) {
      setErro("Informe o protocolo e a senha recebidos ao registrar a denúncia.");
      return;
    }
    setErro(""); setCarregando(true);
    const { data, error } = await supabaseAnonimo.rpc("denuncia_consultar", {
      p_protocolo: protocolo.trim(), p_senha: senha.trim(),
    });
    setCarregando(false);
    if (error) { setErro(error.message || "Não foi possível consultar agora."); setDados(null); return; }
    setDados(data);
  };

  if (dados) {
    const st = STATUS_LABEL[dados.status] ?? { titulo: dados.status, desc: "", tom: "neutro" };
    const tipo = TIPO_DENUNCIA.find((t) => t.value === dados.tipo_denuncia)?.label ?? dados.tipo_denuncia;
    return (
      <div className="space-y-5">
        <section className="dn-card">
          <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Protocolo</p>
          <p className="dn-cod">{dados.protocolo}</p>

          <div className={`dn-st-${st.tom} mt-4 rounded-xl p-4`}>
            <p className="text-sm font-bold">{st.titulo}</p>
            {st.desc && <p className="mt-0.5 text-xs leading-relaxed">{st.desc}</p>}
          </div>

          <div className="dn-grid2 mt-4">
            <div><p className="text-[11px] text-slate-500">Tipo</p><p className="text-sm font-semibold">{tipo}</p></div>
            <div><p className="text-[11px] text-slate-500">Registrada em</p><p className="text-sm font-semibold">{fmtDt(dados.registrada_em)}</p></div>
            <div><p className="text-[11px] text-slate-500">Última atualização</p><p className="text-sm font-semibold">{fmtDt(dados.atualizada_em)}</p></div>
            {dados.concluida_em && (
              <div><p className="text-[11px] text-slate-500">Concluída em</p><p className="text-sm font-semibold">{fmtDt(dados.concluida_em)}</p></div>
            )}
          </div>
        </section>

        <section className="dn-card">
          <p className="dn-sec-t">Retorno da apuração</p>
          {dados.retorno
            ? <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-slate-700 [overflow-wrap:anywhere]">{dados.retorno}</p>
            : <p className="text-sm text-slate-500">
                Ainda não há retorno publicado. Assim que a apuração avançar, a resposta aparece aqui —
                guarde seu protocolo e senha para consultar novamente.
              </p>}
        </section>

        <div className="flex flex-wrap gap-3">
          <button className="dn-btn dn-btn-sec flex-1" onClick={() => { setDados(null); setSenha(""); }}>
            Consultar outro protocolo
          </button>
          <button className="dn-btn flex-1" onClick={onVoltar}>Registrar nova denúncia</button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <section className="dn-card space-y-4">
        <div>
          <p className="dn-sec-t" style={{ marginBottom: 4 }}>Acompanhar denúncia</p>
          <p className="text-sm text-slate-600">
            Informe o protocolo e a senha recebidos ao registrar. É o único jeito de acompanhar sem se identificar.
          </p>
        </div>

        {erro && <div className="dn-erro">{erro}</div>}

        <div>
          <label className="dn-lab" htmlFor="dn-prot">Protocolo</label>
          <input
            id="dn-prot" className="dn-in" placeholder="DEN-2026-00001" style={{ fontFamily: "ui-monospace, monospace" }}
            value={protocolo} onChange={(e) => setProtocolo(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") consultar(); }}
          />
        </div>
        <div>
          <label className="dn-lab" htmlFor="dn-senha">Senha de acompanhamento</label>
          <input
            id="dn-senha" className="dn-in" placeholder="ABCD123456" style={{ fontFamily: "ui-monospace, monospace" }}
            value={senha} onChange={(e) => setSenha(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") consultar(); }}
          />
        </div>
        <button className="dn-btn inline-flex w-full items-center justify-center gap-2" onClick={consultar} disabled={carregando}>
          <Search className="h-4 w-4" /> {carregando ? "Consultando…" : "Consultar"}
        </button>
      </section>

      <div className="dn-card" style={{ background: "#f8fafc" }}>
        <p className="flex items-start gap-2 text-xs leading-relaxed text-slate-600">
          <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            <b>Perdeu o protocolo ou a senha?</b> Não há como recuperá-los — nem por nós. A senha é
            guardada apenas cifrada, justamente para que ninguém consiga se passar por você. Se perdeu
            os dados, registre um novo relato.
          </span>
        </p>
      </div>

      <button className="dn-btn dn-btn-sec w-full" onClick={onVoltar}>← Voltar e registrar uma denúncia</button>
    </div>
  );
}

function Sel({ valor, onChange, opcoes }: {
  valor: string; onChange: (v: string) => void; opcoes: { value: string; label: string }[];
}) {
  return (
    <select className="dn-in" value={valor} onChange={(e) => onChange(e.target.value)}>
      <option value="">[selecione]</option>
      {opcoes.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}
