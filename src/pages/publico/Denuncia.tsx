import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { SUPABASE_FUNCTIONS_URL } from "@/integrations/supabase/env";
import arcoNascimento from "@/assets/logo-nascimento-icon.png";
import {
  ShieldCheck, Lock, Send, Search, Copy, Check, EyeOff, UserCheck, KeyRound,
  FileText, ClipboardList, UsersRound, MessageSquareWarning, ScrollText,
  UserX, HeartCrack, Users, Banknote, HandCoins, Scale, Building2, FileLock2,
  HardHat, Leaf, BookMarked, CircleEllipsis, Info, ArrowLeft, Fingerprint,
  ServerOff, CheckCircle2, TriangleAlert, ChevronRight,
} from "lucide-react";

// =====================================================================
// CANAL DE ÉTICA E DENÚNCIAS — página PÚBLICA (/denuncia)
//
// Sem login, como /vagas e /formularios/:slug. Todo colaborador (ou
// terceiro) registra um relato, anônimo ou identificado.
//
// COMO A CONFIDENCIALIDADE FUNCIONA
// A tela não lê nem escreve na tabela, e não carrega credencial nenhuma:
// fala com duas Edge Functions públicas (`denuncia-registrar` e
// `denuncia-consultar`, verify_jwt = false) mandando JSON puro, sem header de
// autenticação. Token nenhum — nem o da sessão de quem estiver logado no ERP,
// nem chave de API — passa por este navegador.
//
// Do outro lado, a função chama a RPC `denuncia_registrar` (SECURITY
// DEFINER), que valida os campos e NÃO grava IP, user-agent nem auth.uid().
// Quem lê as denúncias é só quem tiver o menu
// 'central_servicos_canal_denuncias' liberado em Acesso por Usuário.
// Ver migration 20260812000001_canal_denuncias.
//
// Estilo self-contained com prefixo `dn-`, igual a `pv-` (Vagas) e `fp-`
// (FormularioPublico): página pública não depende do tema nem do AppShell.
// =====================================================================

/** O que a consulta por protocolo devolve — nunca o relato, só o andamento. */
interface DenunciaConsulta {
  protocolo: string;
  status: string;
  tipo_denuncia: string;
  registrada_em: string;
  atualizada_em: string;
  concluida_em: string | null;
  retorno: string | null;
}

/**
 * Chamada às rotas públicas do canal. Sem `Authorization`, sem `apikey`:
 * é um POST de JSON como qualquer outro — é isso que mantém o navegador
 * livre de token. Quem guarda a chave é a Edge Function, no servidor.
 */
async function chamarCanal<T>(
  rota: "denuncia-registrar" | "denuncia-consultar",
  corpo: unknown,
): Promise<{ data: T | null; erro: string | null }> {
  try {
    const resp = await fetch(`${SUPABASE_FUNCTIONS_URL}/${rota}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(corpo),
    });
    const corpoResp = await resp.json().catch(() => null);
    if (!resp.ok) {
      return { data: null, erro: corpoResp?.error || "Não foi possível completar agora." };
    }
    return { data: corpoResp as T, erro: null };
  } catch {
    // Rede fora, DNS, bloqueio: sem isso a tela ficaria em "enviando" para
    // sempre, e o relato já digitado se perderia sem explicação.
    return { data: null, erro: "Sem conexão com o servidor. Tente de novo em instantes." };
  }
}

const RELACAO = [
  { value: "colaborador", label: "Colaborador(a) do Grupo Nascimento" },
  { value: "ex_colaborador", label: "Ex-colaborador(a)" },
  { value: "estagiario", label: "Estagiário(a) / Aprendiz / Menor" },
  { value: "terceirizado", label: "Terceirizado(a) / Prestador(a) de serviço" },
  { value: "fornecedor", label: "Fornecedor(a)" },
  { value: "cliente", label: "Cliente" },
  { value: "outro", label: "Outro" },
];

/**
 * Os `value` são os mesmos que a RPC aceita — o `Icone` é só enfeite da
 * grade de escolha, então trocar de ícone nunca mexe no que é gravado.
 */
const TIPO_DENUNCIA = [
  { value: "assedio_moral", label: "Assédio moral", Icone: UserX },
  { value: "assedio_sexual", label: "Assédio sexual", Icone: HeartCrack },
  { value: "discriminacao", label: "Discriminação / Preconceito", Icone: Users },
  { value: "fraude", label: "Fraude / Corrupção / Suborno", Icone: Banknote },
  { value: "furto_desvio", label: "Furto / Roubo / Desvio", Icone: HandCoins },
  { value: "conflito_interesses", label: "Conflito de interesses", Icone: Scale },
  { value: "uso_indevido", label: "Uso indevido de recursos", Icone: Building2 },
  { value: "informacoes", label: "Vazamento de informações", Icone: FileLock2 },
  { value: "sst", label: "Segurança e saúde no trabalho", Icone: HardHat },
  { value: "meio_ambiente", label: "Meio ambiente", Icone: Leaf },
  { value: "violacao_conduta", label: "Violação do Código de Conduta", Icone: BookMarked },
  { value: "outro", label: "Outro", Icone: CircleEllipsis },
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

/** Ordem do andamento na régua da tela de acompanhamento. */
const TRILHA = ["nova", "em_analise", "apuracao"];
const FINAIS = ["procedente", "improcedente", "arquivada"];

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
  lideranca_ciente_quem: string; lideranca_envolvida_quem: string; lideranca_ocultou_quem: string;
  descricao: string; testemunhas: string; evidencias: string;
  valor_financeiro: string; sugestao: string;
  concordou_termo: boolean;
}

const VAZIO: Form = {
  identificado: "", nome_completo: "", cpf: "", email: "", data_nascimento: "",
  telefone_fixo: "", celular: "", relacao: "", tipo_denuncia: "", local_ocorrencia: "",
  como_soube: "", lideranca_ciente: "", lideranca_envolvida: "", lideranca_ocultou: "",
  lideranca_ciente_quem: "", lideranca_envolvida_quem: "", lideranca_ocultou_quem: "",
  descricao: "", testemunhas: "", evidencias: "", valor_financeiro: "", sugestao: "",
  concordou_termo: false,
};

// ------------------------------------------------------------------ Marca
/**
 * Assinatura da Nascimento: o arco laranja (arte oficial, mesma que o resto
 * do ERP usa) sobre o nome e a linha de apoio. Fica em componente próprio
 * porque aparece no topo e no rodapé — e porque, no dia em que existir um
 * PNG do logo fechado, é só trocar o miolo daqui.
 */
function LogoNascimento({ tam = "sm" }: { tam?: "sm" | "md" }) {
  return (
    <span className="dn-logo" data-tam={tam} role="img" aria-label="Nascimento — soluções em serviços">
      <img src={arcoNascimento} alt="" aria-hidden="true" />
      <span className="dn-logo-nome">Nascimento</span>
      <span className="dn-logo-sub">soluções em serviços</span>
    </span>
  );
}

/**
 * Enunciado de cada pergunta, na ordem em que aparece na tela. É daqui que
 * sai a numeração (1-, 2-, 3-…) e também o texto do aviso de pendência — ter
 * uma fonte só evita o clássico "o erro diz um nome e o campo diz outro".
 */
interface Pergunta {
  k: keyof Form;
  label: string;
  /** Sem isso a denúncia não é aceita. */
  req?: boolean;
  /** Só entra na tela (e na numeração) quando isto for verdade. */
  quando?: (f: Form) => boolean;
  /** Palavra do enunciado que vai em negrito. */
  destacar?: string;
}

const seIdentificou = (f: Form) => f.identificado === "sim";

const PERGUNTAS: Pergunta[] = [
  { k: "identificado",        label: "Você gostaria de se identificar?", req: true },
  { k: "nome_completo",       label: "Nome completo", req: true, quando: seIdentificou },
  { k: "cpf",                 label: "CPF", quando: seIdentificou },
  { k: "email",               label: "E-mail", quando: seIdentificou },
  { k: "data_nascimento",     label: "Data de nascimento", quando: seIdentificou },
  { k: "telefone_fixo",       label: "Telefone fixo", quando: seIdentificou },
  { k: "celular",             label: "Celular", quando: seIdentificou },
  { k: "relacao",             label: "Qual a sua relação com o Grupo Nascimento?", req: true },
  { k: "tipo_denuncia",       label: "Qual o tipo de denúncia melhor se enquadra ao fato que você está registrando?", req: true },
  { k: "local_ocorrencia",    label: "Em qual empresa, unidade ou setor do grupo ocorreu o fato?" },
  { k: "como_soube",          label: "Como você tomou conhecimento deste fato?", req: true },
  { k: "lideranca_ciente",    label: "Algum Diretor, Gerente, Coordenador, Supervisor ou Encarregado está CIENTE do problema relatado?", destacar: "CIENTE" },
  { k: "lideranca_ciente_quem",    label: "Quem está ciente? Se souber, indique as pessoas ou testemunhas.", quando: (f) => f.lideranca_ciente === "sim" },
  { k: "lideranca_envolvida", label: "Algum Diretor, Gerente, Coordenador, Supervisor ou Encarregado está ENVOLVIDO diretamente no fato relatado?", destacar: "ENVOLVIDO" },
  { k: "lideranca_envolvida_quem", label: "Quem está envolvido? Se souber, indique as pessoas ou testemunhas.", quando: (f) => f.lideranca_envolvida === "sim" },
  { k: "lideranca_ocultou",   label: "Algum Diretor, Gerente, Coordenador, Supervisor ou Encarregado tentou ESCONDER o problema relatado?", destacar: "ESCONDER" },
  { k: "lideranca_ocultou_quem",   label: "Quem tentou esconder? Se souber, indique as pessoas ou testemunhas.", quando: (f) => f.lideranca_ocultou === "sim" },
  { k: "descricao",           label: "O que você quer denunciar?", req: true },
  { k: "testemunhas",         label: "Existem testemunhas? Em caso positivo, indique-as." },
  { k: "evidencias",          label: "Você sabe se existem evidências sobre o fato? Em caso positivo, indique-as." },
  { k: "valor_financeiro",    label: "Qual o valor financeiro envolvido no fato relatado?" },
  { k: "sugestao",            label: "Você tem alguma sugestão de como solucionar o problema?" },
  { k: "concordou_termo",     label: "Li e concordo com o termo acima.", req: true },
];

function Estilos() {
  return <style>{`
    .dn *, .dn *::before, .dn *::after { box-sizing: border-box; }
    .dn { min-height: 100vh; display: flex; flex-direction: column;
          font-family: Inter, system-ui, -apple-system, sans-serif; color: #0f172a;
          background: #f5f7fb; -webkit-font-smoothing: antialiased; }
    .dn h1, .dn h2, .dn h3 { font-family: 'Plus Jakarta Sans', Inter, sans-serif; letter-spacing: -.02em; margin: 0; }
    .dn-main { flex: 1 0 auto; }
    .dn-wrap { max-width: 880px; margin: 0 auto; padding: 0 20px; width: 100%; }

    /* ---- marca ---- */
    .dn-logo { display: inline-flex; flex-direction: column; align-items: center; line-height: 1; }
    .dn-logo img { display: block; width: auto; }
    .dn-logo-nome { font-family: 'Plus Jakarta Sans', Inter, sans-serif; font-weight: 800;
                    color: #241f66; letter-spacing: -.035em; }
    .dn-logo-sub { font-family: 'Plus Jakarta Sans', Inter, sans-serif; font-weight: 600;
                   color: #241f66; letter-spacing: .005em; }
    .dn-logo[data-tam="sm"] img       { height: 18px; margin-bottom: 2px; }
    .dn-logo[data-tam="sm"] .dn-logo-nome { font-size: 19px; }
    .dn-logo[data-tam="sm"] .dn-logo-sub  { font-size: 8px; margin-top: 2px; }
    .dn-logo[data-tam="md"] img       { height: 23px; margin-bottom: 3px; }
    .dn-logo[data-tam="md"] .dn-logo-nome { font-size: 24px; }
    .dn-logo[data-tam="md"] .dn-logo-sub  { font-size: 10px; margin-top: 3px; }

    /* ---- topo ---- */
    .dn-nav { position: sticky; top: 0; z-index: 40; background: rgba(255,255,255,.9);
              backdrop-filter: blur(12px); border-bottom: 1px solid #e7ecf4; }
    .dn-nav-in { max-width: 880px; margin: 0 auto; padding: 12px 20px; display: flex;
                 align-items: center; justify-content: space-between; gap: 14px; }
    .dn-nav-tag { display: flex; flex-direction: column; gap: 2px; padding-left: 16px;
                  border-left: 1px solid #e2e8f0; min-width: 0; }
    .dn-nav-tag b { font-family: 'Plus Jakarta Sans', sans-serif; font-size: 14px; font-weight: 800;
                    color: #0b1f44; line-height: 1.15; }
    .dn-nav-tag span { font-size: 10px; font-weight: 700; letter-spacing: .16em; text-transform: uppercase; color: #94a3b8; }
    .dn-nav-cta { display: inline-flex; align-items: center; gap: 7px; background: #fff; color: #0f3171;
                  border: 1.5px solid #dbe4f0; border-radius: 11px; padding: 9px 15px; font-size: 13px;
                  font-weight: 700; cursor: pointer; white-space: nowrap; font-family: inherit; }
    .dn-nav-cta:hover { border-color: #f97316; color: #ea580c; }

    /* ---- barra de progresso ---- */
    .dn-prog { position: sticky; top: 74px; z-index: 35; background: #fff; border-bottom: 1px solid #eef2f7; }
    .dn-prog-in { max-width: 880px; margin: 0 auto; padding: 9px 20px; display: flex; align-items: center; gap: 12px; }
    .dn-prog-tri { flex: 1; height: 6px; border-radius: 99px; background: #e8edf5; overflow: hidden; }
    .dn-prog-tri i { display: block; height: 100%; border-radius: 99px;
                     background: linear-gradient(90deg, #f97316, #0f3171); transition: width .35s ease; }
    .dn-prog-txt { font-size: 11.5px; font-weight: 700; color: #64748b; white-space: nowrap; }

    /* ---- herói ---- */
    .dn-hero { position: relative; overflow: hidden; background:
        radial-gradient(760px 380px at 12% -30%, #e6edfb 0%, transparent 60%),
        radial-gradient(620px 320px at 92% -10%, #ffeede 0%, transparent 55%), #f5f7fb; }
    .dn-hero-in { max-width: 880px; margin: 0 auto; padding: 46px 20px 34px; text-align: center; }
    .dn-eyebrow { display: inline-flex; align-items: center; gap: 7px; font-size: 11.5px; font-weight: 800;
                  letter-spacing: .14em; text-transform: uppercase; color: #ea580c; background: #fff4ec;
                  border: 1px solid #ffdec6; border-radius: 99px; padding: 6px 14px; }
    .dn-hero h1 { font-size: clamp(28px, 4.6vw, 44px); font-weight: 800; line-height: 1.06;
                  color: #0b1f44; margin: 18px 0 0; }
    .dn-hero h1 em { font-style: normal; color: #f97316; }
    .dn-hero p { font-size: clamp(14.5px, 1.7vw, 17px); line-height: 1.6; color: #475569;
                 max-width: 590px; margin: 15px auto 0; }
    .dn-selos { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-top: 26px; text-align: left; }
    .dn-selo { display: flex; align-items: flex-start; gap: 10px; background: #fff; border: 1px solid #e7ecf4;
               border-radius: 14px; padding: 13px 14px; box-shadow: 0 4px 14px rgba(15,31,68,.04); }
    .dn-selo svg { color: #0f3171; flex-shrink: 0; margin-top: 1px; }
    .dn-selo b { display: block; font-size: 12.5px; font-weight: 800; color: #0b1f44; }
    .dn-selo span { display: block; font-size: 11.5px; line-height: 1.45; color: #64748b; margin-top: 2px; }

    /* ---- passos ---- */
    .dn-passos { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
    .dn-passo { background: #fff; border: 1px solid #e7ecf4; border-radius: 16px; padding: 16px;
                box-shadow: 0 4px 14px rgba(15,31,68,.04); }
    .dn-passo-n { display: inline-flex; align-items: center; justify-content: center; height: 26px;
                  min-width: 26px; padding: 0 8px; border-radius: 8px; background: #eef3fd; color: #0f3171;
                  font-size: 11.5px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; }
    .dn-passo b { display: block; font-size: 13.5px; font-weight: 800; color: #0b1f44; margin-top: 10px; }
    .dn-passo-d { display: block; font-size: 12.5px; line-height: 1.5; color: #64748b; margin-top: 3px; }

    /* ---- cartões / seções ---- */
    .dn-card { background: #fff; border: 1px solid #e7ecf4; border-radius: 18px;
               box-shadow: 0 8px 26px rgba(15,31,68,.05); }
    .dn-card-h { display: flex; align-items: center; gap: 12px; padding: 18px 20px;
                 border-bottom: 1px solid #f1f5f9; }
    .dn-card-ic { display: grid; place-items: center; height: 38px; width: 38px; border-radius: 11px;
                  background: #eef3fd; color: #0f3171; flex-shrink: 0; }
    .dn-card-h h2 { font-size: 16px; font-weight: 800; color: #0b1f44; line-height: 1.2; }
    .dn-card-h p { font-size: 12.5px; color: #64748b; margin: 2px 0 0; line-height: 1.4; }
    .dn-card-b { padding: 20px; display: flex; flex-direction: column; gap: 18px; }

    /* ---- campos ---- */
    /* O halo do box-shadow pinta a pendência sem empurrar nada de lugar —
       borda de verdade mudaria a altura do bloco e a página daria um pulo. */
    .dn-q { position: relative; border-radius: 10px; scroll-margin-top: 126px;
            transition: background .2s ease, box-shadow .2s ease; }
    .dn-q[data-falta="1"] { background: #fff5f5; box-shadow: 0 0 0 11px #fff5f5; }
    .dn-q[data-falta="1"] .dn-in { border-color: #fca5a5; }
    .dn-q[data-falta="1"] .dn-num { color: #dc2626; }
    /* Pergunta que só nasce por causa de um "sim" — recuada, para ler como
       desdobramento da anterior e não como item solto da lista. */
    .dn-sub { margin-top: -6px; padding-left: 14px; border-left: 2px solid #e7ecf4; }
    .dn-lab { display: block; font-size: 13.5px; font-weight: 700; color: #1e293b; margin-bottom: 6px; }
    .dn-num { font-family: 'Plus Jakarta Sans', Inter, sans-serif; font-weight: 800; color: #f97316;
              margin-right: 6px; font-variant-numeric: tabular-nums; }
    .dn-req { color: #dc2626; }
    .dn-opt { font-size: 11px; font-weight: 700; color: #94a3b8; text-transform: uppercase; letter-spacing: .06em; }
    .dn-help { font-size: 12.5px; line-height: 1.55; color: #64748b; margin: 0 0 8px; }
    .dn-in { width: 100%; border: 1.5px solid #dde5f0; border-radius: 12px; padding: 11px 13px;
             font-size: 14px; font-family: inherit; background: #fff; outline: none; color: #0f172a;
             transition: border-color .15s, box-shadow .15s; }
    .dn-in::placeholder { color: #b3bfd0; }
    .dn-in:hover { border-color: #c6d3e6; }
    .dn-in:focus { border-color: #0f3171; box-shadow: 0 0 0 3.5px rgba(15,49,113,.11); }
    .dn-sel-w { position: relative; }
    .dn-sel-w svg { position: absolute; right: 13px; top: 50%; transform: translateY(-50%);
                    color: #94a3b8; pointer-events: none; }
    .dn-sel-w select { appearance: none; -webkit-appearance: none; padding-right: 38px; cursor: pointer; }
    .dn-ta { min-height: 92px; resize: vertical; line-height: 1.55; }

    /* ---- escolha grande (identificação) ---- */
    .dn-esc { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    .dn-esc button { display: flex; align-items: flex-start; gap: 11px; text-align: left; cursor: pointer;
                     border: 1.5px solid #dde5f0; background: #fff; border-radius: 14px; padding: 15px;
                     font-family: inherit; transition: border-color .15s, background .15s, box-shadow .15s; }
    .dn-esc button:hover { border-color: #c6d3e6; }
    .dn-esc button svg { color: #94a3b8; flex-shrink: 0; margin-top: 1px; }
    .dn-esc button b { display: block; font-size: 14px; font-weight: 800; color: #0b1f44; line-height: 1.3; }
    .dn-esc-t { display: block; min-width: 0; }
    .dn-esc-d { display: block; font-size: 12px; line-height: 1.45; color: #64748b; margin-top: 3px; }
    .dn-esc button[data-on="1"] { border-color: #0f3171; background: #f4f8ff;
                                  box-shadow: 0 0 0 3.5px rgba(15,49,113,.09); }
    .dn-esc button[data-on="1"] svg { color: #0f3171; }

    /* ---- grade de tipos ---- */
    .dn-tiles { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
    .dn-tile { display: flex; flex-direction: column; gap: 8px; align-items: flex-start; text-align: left;
               border: 1.5px solid #dde5f0; background: #fff; border-radius: 13px; padding: 13px 12px;
               font-family: inherit; font-size: 12.5px; font-weight: 700; color: #334155; line-height: 1.35;
               cursor: pointer; transition: border-color .15s, background .15s, box-shadow .15s; }
    .dn-tile:hover { border-color: #c6d3e6; }
    .dn-tile svg { color: #94a3b8; }
    .dn-tile[data-on="1"] { border-color: #0f3171; background: #f4f8ff; color: #0f3171;
                            box-shadow: 0 0 0 3.5px rgba(15,49,113,.09); }
    .dn-tile[data-on="1"] svg { color: #f97316; }

    /* ---- pílulas sim/não ---- */
    .dn-pills { display: inline-flex; flex-wrap: wrap; gap: 4px; background: #f1f5f9; padding: 4px; border-radius: 13px; }
    .dn-pills button { border: none; background: transparent; border-radius: 10px; padding: 8px 18px;
                       font-family: inherit; font-size: 13.5px; font-weight: 700; color: #64748b; cursor: pointer;
                       transition: background .15s, color .15s; }
    .dn-pills button:hover { color: #334155; }
    .dn-pills button[data-on="1"] { background: #fff; color: #0f3171; box-shadow: 0 1px 4px rgba(15,23,42,.13); }

    /* ---- contador do relato ---- */
    .dn-cnt { display: flex; align-items: center; gap: 10px; margin-top: 8px; }
    .dn-cnt-tri { flex: 1; height: 4px; border-radius: 99px; background: #eef2f7; overflow: hidden; }
    .dn-cnt-tri i { display: block; height: 100%; background: #f97316; border-radius: 99px; transition: width .25s ease; }
    .dn-cnt-tri[data-ok="1"] i { background: #16a34a; }
    .dn-cnt span { font-size: 11.5px; font-weight: 700; color: #94a3b8; white-space: nowrap; }

    /* ---- avisos ---- */
    .dn-note { display: flex; gap: 9px; align-items: flex-start; background: #f8fafc; border: 1px solid #e7ecf4;
               border-radius: 12px; padding: 11px 13px; font-size: 12px; line-height: 1.55; color: #475569; }
    .dn-note svg { flex-shrink: 0; margin-top: 1px; color: #94a3b8; }
    .dn-note b { color: #0b1f44; }
    .dn-guarde { border: 1px solid #ffdec6; background: #fff8f2; border-radius: 14px; padding: 14px 16px;
                 font-size: 13px; line-height: 1.6; color: #7c2d12; text-align: left; }
    .dn-erro { border: 1.5px solid #fecaca; background: #fef2f2; color: #991b1b; border-radius: 14px;
               padding: 15px 17px; font-size: 13.5px; }
    .dn-erro-t { display: flex; align-items: center; gap: 8px; font-weight: 800; font-size: 14px; }
    .dn-erro ul { margin: 10px 0 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 6px; }
    .dn-erro li button { display: flex; align-items: flex-start; gap: 8px; width: 100%; text-align: left;
                         background: #fff; border: 1px solid #fecaca; border-radius: 10px; padding: 9px 11px;
                         font-family: inherit; font-size: 13px; line-height: 1.45; color: #7f1d1d; cursor: pointer; }
    .dn-erro li button:hover { border-color: #ef4444; background: #fff7f7; }
    .dn-erro li button svg { flex-shrink: 0; margin-top: 2px; color: #ef4444; }
    .dn-erro li b { font-variant-numeric: tabular-nums; }
    .dn-erro li i { display: block; font-style: normal; font-size: 12px; color: #b91c1c; margin-top: 1px; }

    /* ---- termo ---- */
    .dn-termo { display: flex; align-items: flex-start; gap: 12px; cursor: pointer; border: 1.5px solid #dde5f0;
                background: #f8fafc; border-radius: 14px; padding: 14px; transition: border-color .15s, background .15s; }
    .dn-termo:hover { border-color: #c6d3e6; }
    .dn-termo[data-on="1"] { border-color: #0f3171; background: #f4f8ff; }
    .dn-termo input { height: 19px; width: 19px; margin-top: 1px; accent-color: #0f3171; cursor: pointer; flex-shrink: 0; }
    .dn-termo span { font-size: 13.5px; font-weight: 700; color: #1e293b; }

    /* ---- botões ---- */
    .dn-btn { display: inline-flex; align-items: center; justify-content: center; gap: 8px; border: none;
              border-radius: 13px; padding: 14px 20px; font-family: inherit; font-size: 15px; font-weight: 800;
              cursor: pointer; background: #0f3171; color: #fff; transition: background .15s, transform .1s; }
    .dn-btn:hover:not(:disabled) { background: #0b2350; }
    .dn-btn:active:not(:disabled) { transform: scale(.99); }
    .dn-btn:disabled { opacity: .55; cursor: not-allowed; }
    .dn-btn-lar { background: #f97316; }
    .dn-btn-lar:hover:not(:disabled) { background: #ea580c; }
    .dn-btn-sec { background: #fff; color: #0f3171; border: 1.5px solid #dbe4f0; }
    .dn-btn-sec:hover:not(:disabled) { background: #f8fafc; border-color: #c6d3e6; }
    .dn-btn-w { width: 100%; }

    /* ---- protocolo ---- */
    .dn-chips { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    .dn-chip { border-radius: 15px; padding: 15px; border: 1.5px solid #dde5f0; background: #f8fafc; text-align: left; }
    .dn-chip-l { font-size: 10.5px; font-weight: 800; text-transform: uppercase; letter-spacing: .12em;
                 color: #94a3b8; margin: 0; }
    .dn-cod { font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 21px;
              font-weight: 700; color: #0f3171; letter-spacing: .5px; user-select: all; margin: 5px 0 0; }

    /* ---- régua de status ---- */
    .dn-tl { display: flex; align-items: flex-start; gap: 0; }
    .dn-tl-p { flex: 1; text-align: center; position: relative; }
    .dn-tl-p::before { content: ""; position: absolute; top: 13px; left: -50%; width: 100%; height: 2px; background: #e2e8f0; }
    .dn-tl-p:first-child::before { display: none; }
    .dn-tl-p[data-on="1"]::before { background: #0f3171; }
    .dn-tl-b { position: relative; display: grid; place-items: center; height: 28px; width: 28px; margin: 0 auto;
               border-radius: 50%; background: #fff; border: 2px solid #e2e8f0; color: #cbd5e1; }
    .dn-tl-p[data-on="1"] .dn-tl-b { border-color: #0f3171; background: #0f3171; color: #fff; }
    .dn-tl-p small { display: block; font-size: 11px; font-weight: 700; color: #94a3b8; margin-top: 7px; line-height: 1.3; }
    .dn-tl-p[data-on="1"] small { color: #0b1f44; }

    .dn-st-info    { border: 1px solid #bae6fd; background: #f0f9ff; color: #075985; }
    .dn-st-alerta  { border: 1px solid #fde68a; background: #fffbeb; color: #92400e; }
    .dn-st-ok      { border: 1px solid #bbf7d0; background: #f0fdf4; color: #166534; }
    .dn-st-neutro  { border: 1px solid #e2e8f0; background: #f8fafc; color: #475569; }

    /* ---- grades ---- */
    .dn-grid2 { display: grid; gap: 14px; grid-template-columns: 1fr 1fr; }
    .dn-full { grid-column: 1 / -1; }

    /* ---- rodapé ---- */
    .dn-foot { margin-top: 44px; background: #0b1f44; color: #cbd5e1; }
    .dn-foot-in { max-width: 880px; margin: 0 auto; padding: 32px 20px 26px; }
    .dn-foot .dn-logo-nome, .dn-foot .dn-logo-sub { color: #fff; }
    .dn-foot-cols { display: grid; grid-template-columns: auto 1fr; gap: 28px; align-items: start; }
    .dn-foot h3 { font-size: 13px; font-weight: 800; color: #fff; }
    .dn-foot p { font-size: 12.5px; line-height: 1.65; color: #94a3b8; margin: 7px 0 0; }
    .dn-foot-bar { border-top: 1px solid rgba(255,255,255,.1); margin-top: 22px; padding-top: 16px;
                   display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
    .dn-foot-bar span { font-size: 11.5px; color: #64748b; }
    .dn-foot-bar b { display: inline-flex; align-items: center; gap: 6px; font-size: 11.5px; color: #94a3b8; font-weight: 700; }

    @media (max-width: 760px) {
      .dn-tiles { grid-template-columns: repeat(2, 1fr); }
      .dn-selos, .dn-passos { grid-template-columns: 1fr; }
      .dn-nav-tag { display: none; }
    }
    @media (max-width: 620px) {
      .dn-grid2, .dn-esc, .dn-chips { grid-template-columns: 1fr; }
      .dn-foot-cols { grid-template-columns: 1fr; gap: 20px; }
      .dn-tl-p small { font-size: 10px; }
      .dn-hero-in { padding: 30px 18px 26px; }
      .dn-wrap, .dn-nav-in, .dn-prog-in, .dn-foot-in { padding-left: 16px; padding-right: 16px; }
      .dn-card-h { padding: 15px 16px; gap: 10px; }
      .dn-card-b { padding: 16px; gap: 16px; }
      /* 16px é o mínimo que evita o Safari do iPhone dar zoom ao focar o campo. */
      .dn-in { font-size: 16px; padding: 12px 13px; }
      /* Dedo não acerta alvo de 36px: pílulas viram três colunas cheias. */
      .dn-pills { display: grid; grid-template-columns: repeat(3, 1fr); width: 100%; }
      .dn-pills button { padding: 13px 6px; font-size: 14px; }
      .dn-nav-cta { padding: 13px 14px; }
      .dn-cod { font-size: 19px; }
      .dn-btn { padding: 15px 18px; }
    }
    @media (max-width: 420px) {
      .dn-tiles { grid-template-columns: 1fr; }
      .dn-nav-cta span { display: none; }
    }
  `}</style>;
}

export default function Denuncia() {
  const [params, setParams] = useSearchParams();
  const [tela, setTela] = useState<"form" | "acompanhar">(
    params.get("acompanhar") !== null ? "acompanhar" : "form",
  );
  // O herói e a barra de progresso só fazem sentido enquanto o formulário
  // está aberto — depois de registrar, a tela vira recibo.
  const [registrou, setRegistrou] = useState(false);
  const [progresso, setProgresso] = useState(0);

  const irPara = (t: "form" | "acompanhar") => {
    setTela(t);
    const p = new URLSearchParams(params);
    if (t === "acompanhar") p.set("acompanhar", ""); else p.delete("acompanhar");
    setParams(p, { replace: true });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const noForm = tela === "form" && !registrou;

  return (
    <div className="dn">
      <Estilos />

      <nav className="dn-nav">
        <div className="dn-nav-in">
          <div className="flex min-w-0 items-center gap-4">
            <LogoNascimento />
            <div className="dn-nav-tag">
              <b>Canal de Ética</b>
              <span>Denúncias</span>
            </div>
          </div>
          {/* Em tela estreita sobra só o ícone — daí o aria-label, que é o que
              o leitor de tela passa a anunciar quando o texto some. */}
          <button
            type="button" className="dn-nav-cta"
            aria-label={tela === "form" ? "Acompanhar denúncia" : "Registrar denúncia"}
            onClick={() => irPara(tela === "form" ? "acompanhar" : "form")}
          >
            {tela === "form"
              ? <><Search className="h-3.5 w-3.5" /><span>Acompanhar denúncia</span></>
              : <><ArrowLeft className="h-3.5 w-3.5" /><span>Registrar denúncia</span></>}
          </button>
        </div>
      </nav>

      {noForm && (
        <div className="dn-prog">
          <div className="dn-prog-in">
            <div className="dn-prog-tri"><i style={{ width: `${progresso}%` }} /></div>
            <span className="dn-prog-txt">{progresso}% preenchido</span>
          </div>
        </div>
      )}

      {noForm && (
        <header className="dn-hero">
          <div className="dn-hero-in">
            <span className="dn-eyebrow"><ShieldCheck className="h-3.5 w-3.5" /> Canal de Ética e Denúncias</span>
            <h1>Sua voz é protegida.<br /><em>Relate com segurança.</em></h1>
            <p>
              Um espaço reservado para relatar condutas contrárias aos nossos valores e ao Código de
              Conduta. Você escolhe se quer se identificar — a apuração é a mesma nos dois casos.
            </p>
            <div className="dn-selos">
              <div className="dn-selo">
                <EyeOff className="h-5 w-5" />
                <div><b>Anônimo se você quiser</b><span>Nenhum campo de identificação é obrigatório.</span></div>
              </div>
              <div className="dn-selo">
                <ServerOff className="h-5 w-5" />
                <div><b>Sem rastro técnico</b><span>Não gravamos IP, navegador nem login.</span></div>
              </div>
              <div className="dn-selo">
                <Lock className="h-5 w-5" />
                <div><b>Acesso restrito</b><span>Só o comitê responsável enxerga o relato.</span></div>
              </div>
            </div>
          </div>
        </header>
      )}

      <main className="dn-main dn-wrap" style={{ paddingTop: noForm ? 8 : 28, paddingBottom: 8 }}>
        {tela === "form"
          ? <Formulario
              onAcompanhar={() => irPara("acompanhar")}
              onRegistrou={() => setRegistrou(true)}
              onProgresso={setProgresso}
            />
          : <Acompanhar onVoltar={() => irPara("form")} />}
      </main>

      <footer className="dn-foot">
        <div className="dn-foot-in">
          <div className="dn-foot-cols">
            <LogoNascimento tam="md" />
            <div>
              <h3>Canal de Ética e Denúncias</h3>
              <p>
                As informações são tratadas com confidencialidade e usadas exclusivamente para a apuração
                do relato. Este canal recebe desvios de conduta — dúvidas, solicitações e reclamações sobre
                produtos e serviços devem seguir pelos canais de atendimento habituais.
              </p>
            </div>
          </div>
          <div className="dn-foot-bar">
            <span>© {new Date().getFullYear()} Grupo Nascimento — Soluções em Serviços</span>
            <b><ShieldCheck className="h-3.5 w-3.5" /> Conexão protegida · sem registro de identidade</b>
          </div>
        </div>
      </footer>
    </div>
  );
}

// ---------------------------------------------------------------- Formulário
function Formulario({ onAcompanhar, onRegistrou, onProgresso }: {
  onAcompanhar: () => void; onRegistrou: () => void; onProgresso: (p: number) => void;
}) {
  const [f, setF] = useState<Form>(VAZIO);
  const [enviando, setEnviando] = useState(false);
  // `tentou` só liga depois do primeiro clique em enviar: ninguém merece o
  // formulário inteiro pintado de vermelho antes de ter respondido nada.
  const [tentou, setTentou] = useState(false);
  const [erroServidor, setErroServidor] = useState("");
  const [ok, setOk] = useState<{ protocolo: string; senha: string } | null>(null);
  const [copiou, setCopiou] = useState(false);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((c) => ({ ...c, [k]: v }));

  /**
   * Numeração corrida das perguntas visíveis. Recalcula quando alguma
   * resposta abre perguntas novas (identificar-se, ou responder "sim" na
   * liderança): tudo que vem depois anda para a frente.
   */
  const perguntas = useMemo(() => {
    const visiveis = PERGUNTAS.filter((p) => !p.quando || p.quando(f));
    const mapa = {} as Record<string, Pergunta & { n: number }>;
    visiveis.forEach((p, i) => { mapa[p.k] = { ...p, n: i + 1 }; });
    return mapa;
  }, [f]);

  /** O que exatamente falta em cada obrigatória — é o texto que o aviso mostra. */
  const faltando = useMemo(() => {
    const pend: { k: string; n: number; label: string; motivo: string }[] = [];
    const add = (k: keyof Form, motivo: string) => {
      const p = perguntas[k];
      if (p) pend.push({ k, n: p.n, label: p.label, motivo });
    };
    if (f.identificado === "") add("identificado", "escolha uma das duas opções");
    if (f.identificado === "sim" && !f.nome_completo.trim()) add("nome_completo", "digite seu nome completo");
    if (!f.relacao) add("relacao", "selecione uma opção na lista");
    if (!f.tipo_denuncia) add("tipo_denuncia", "toque em um dos tipos");
    if (!f.como_soube) add("como_soube", "selecione uma opção na lista");
    // 30 é o mínimo que a RPC exige — avisar aqui evita o erro vir do servidor.
    const n = f.descricao.trim().length;
    if (n < 30) {
      add("descricao", n === 0
        ? "escreva o relato — são necessários pelo menos 30 caracteres"
        : `faltam ${30 - n} caracteres para o mínimo de 30`);
    }
    if (!f.concordou_termo) add("concordou_termo", "marque a caixa de aceite");
    return pend;
  }, [f, perguntas]);

  /** Vermelho só nas que continuam pendentes depois de um envio recusado. */
  const falta = (k: keyof Form) => tentou && faltando.some((x) => x.k === k);
  const irAte = (k: string) =>
    document.getElementById(`dn-q-${k}`)?.scrollIntoView({ behavior: "smooth", block: "center" });

  // A barra do topo mora no componente pai, mas quem sabe o que falta é aqui.
  const totReq = Object.values(perguntas).filter((p) => p.req).length;
  const pct = Math.round(((totReq - faltando.length) / totReq) * 100);
  useEffect(() => { onProgresso(pct); }, [pct, onProgresso]);

  const enviar = async () => {
    if (enviando) return;
    setTentou(true);
    if (faltando.length) {
      irAte(faltando[0].k);
      return;
    }
    setErroServidor("");
    setEnviando(true);
    const ident = f.identificado === "sim";
    const { data, erro } = await chamarCanal<{ protocolo: string; senha: string }>(
      "denuncia-registrar",
      {
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
        // A RPC ignora o "quem" quando a resposta não foi "sim" — mandar do
        // mesmo jeito evita a tela ter que adivinhar a regra do banco.
        lideranca_ciente_quem: f.lideranca_ciente_quem,
        lideranca_envolvida_quem: f.lideranca_envolvida_quem,
        lideranca_ocultou_quem: f.lideranca_ocultou_quem,
        descricao: f.descricao,
        testemunhas: f.testemunhas,
        evidencias: f.evidencias,
        valor_financeiro: f.valor_financeiro,
        sugestao: f.sugestao,
        concordou_termo: true,
      },
    );
    setEnviando(false);
    if (erro || !data) {
      setErroServidor(erro || "Não foi possível registrar agora. Tente novamente em instantes.");
      return;
    }
    setOk(data);
    onRegistrou();
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  if (ok) {
    return (
      <div className="dn-card" style={{ overflow: "hidden" }}>
        <div className="px-5 pb-6 pt-8 text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 ring-8 ring-emerald-50/60">
            <Check className="h-8 w-8" strokeWidth={3} />
          </div>
          <h1 className="mt-4 text-2xl font-extrabold text-[#0b1f44]">Denúncia registrada</h1>
          <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-slate-600">
            Seu relato chegou ao comitê responsável. Guarde o protocolo e a senha: são a única forma de
            acompanhar a apuração sem se identificar.
          </p>

          <div className="dn-chips mt-6 text-left">
            <div className="dn-chip">
              <p className="dn-chip-l">Protocolo</p>
              <p className="dn-cod">{ok.protocolo}</p>
            </div>
            <div className="dn-chip">
              <p className="dn-chip-l">Senha de acompanhamento</p>
              <p className="dn-cod">{ok.senha}</p>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap justify-center gap-2.5">
            <button
              type="button" className="dn-btn dn-btn-sec"
              onClick={() => {
                navigator.clipboard?.writeText(`Protocolo: ${ok.protocolo} · Senha: ${ok.senha}`);
                setCopiou(true); setTimeout(() => setCopiou(false), 2000);
              }}
            >
              {copiou ? <><Check className="h-4 w-4" /> Copiado!</> : <><Copy className="h-4 w-4" /> Copiar dados</>}
            </button>
            <button type="button" className="dn-btn" onClick={onAcompanhar}>
              <Search className="h-4 w-4" /> Acompanhar esta denúncia
            </button>
          </div>

          {/* Aviso duro de propósito: não existe recuperação de senha. */}
          <div className="dn-guarde mx-auto mt-6 max-w-lg">
            <b>Anote antes de fechar esta página.</b> Estes dados não são enviados por e-mail e não podem
            ser recuperados depois — nem por nós. É exatamente isso que impede alguém de se passar por
            você para acompanhar a denúncia.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <section className="dn-passos">
        <div className="dn-passo">
          <span className="dn-passo-n">Passo 1</span>
          <b>Você relata</b>
          <span className="dn-passo-d">Preencha o formulário abaixo. Quanto mais detalhes, melhor a apuração.</span>
        </div>
        <div className="dn-passo">
          <span className="dn-passo-n">Passo 2</span>
          <b>Recebe protocolo e senha</b>
          <span className="dn-passo-d">Dois códigos gerados na hora, que só você conhece.</span>
        </div>
        <div className="dn-passo">
          <span className="dn-passo-n">Passo 3</span>
          <b>Acompanha o desfecho</b>
          <span className="dn-passo-d">Volte aqui a qualquer momento para ver o andamento e o retorno.</span>
        </div>
      </section>

      {/* ---------------------------------------------------- Identificação */}
      <section className="dn-card">
        <div className="dn-card-h">
          <span className="dn-card-ic"><Fingerprint className="h-5 w-5" /></span>
          <div>
            <h2>Identificação</h2>
            <p>Opcional — o relato anônimo é apurado do mesmo jeito.</p>
          </div>
        </div>
        <div className="dn-card-b">
          <Campo p={perguntas.identificado} falta={falta("identificado")}>
            <div className="dn-esc">
              <button type="button" data-on={f.identificado === "nao" ? "1" : "0"} onClick={() => set("identificado", "nao")}>
                <EyeOff className="h-5 w-5" />
                <span className="dn-esc-t">
                  <b>Não, quero permanecer anônimo(a)</b>
                  <span className="dn-esc-d">Nenhum dado pessoal é solicitado ou gravado.</span>
                </span>
              </button>
              <button type="button" data-on={f.identificado === "sim" ? "1" : "0"} onClick={() => set("identificado", "sim")}>
                <UserCheck className="h-5 w-5" />
                <span className="dn-esc-t">
                  <b>Sim, quero me identificar</b>
                  <span className="dn-esc-d">Permite que o comitê fale com você durante a apuração.</span>
                </span>
              </button>
            </div>
          </Campo>

          {f.identificado === "sim" && (
            <div className="dn-grid2">
              <Campo p={perguntas.nome_completo} falta={falta("nome_completo")} className="dn-full">
                <input id="dn-i-nome_completo" className="dn-in" value={f.nome_completo} onChange={(e) => set("nome_completo", e.target.value)} placeholder="Seu nome" />
              </Campo>
              <Campo p={perguntas.cpf}>
                <input id="dn-i-cpf" className="dn-in" value={f.cpf} onChange={(e) => set("cpf", e.target.value)} placeholder="000.000.000-00" />
              </Campo>
              <Campo p={perguntas.email}>
                <input id="dn-i-email" type="email" className="dn-in" value={f.email} onChange={(e) => set("email", e.target.value)} placeholder="voce@exemplo.com" />
              </Campo>
              <Campo p={perguntas.data_nascimento}>
                <input id="dn-i-data_nascimento" type="date" className="dn-in" value={f.data_nascimento} onChange={(e) => set("data_nascimento", e.target.value)} />
              </Campo>
              <Campo p={perguntas.telefone_fixo}>
                <input id="dn-i-telefone_fixo" className="dn-in" value={f.telefone_fixo} onChange={(e) => set("telefone_fixo", e.target.value)} placeholder="(00) 0000-0000" />
              </Campo>
              <Campo p={perguntas.celular} className="dn-full">
                <input id="dn-i-celular" className="dn-in" value={f.celular} onChange={(e) => set("celular", e.target.value)} placeholder="(00) 00000-0000" />
              </Campo>
            </div>
          )}
        </div>
      </section>

      {/* ------------------------------------------------------ Sobre o fato */}
      <section className="dn-card">
        <div className="dn-card-h">
          <span className="dn-card-ic"><ClipboardList className="h-5 w-5" /></span>
          <div>
            <h2>Sobre o fato</h2>
            <p>De onde vem o relato e o que melhor descreve o ocorrido.</p>
          </div>
        </div>
        <div className="dn-card-b">
          <Campo p={perguntas.relacao} falta={falta("relacao")} para="dn-i-relacao">
            <Sel id="dn-i-relacao" valor={f.relacao} onChange={(v) => set("relacao", v)} opcoes={RELACAO} />
          </Campo>

          <Campo
            p={perguntas.tipo_denuncia} falta={falta("tipo_denuncia")}
            ajuda="Escolha a opção mais próxima. Se nada encaixar, use “Outro” e explique no relato."
          >
            <div className="dn-tiles">
              {TIPO_DENUNCIA.map(({ value, label, Icone }) => (
                <button
                  key={value} type="button" className="dn-tile"
                  data-on={f.tipo_denuncia === value ? "1" : "0"}
                  onClick={() => set("tipo_denuncia", value)}
                >
                  <Icone className="h-[18px] w-[18px]" />
                  {label}
                </button>
              ))}
            </div>
          </Campo>

          <Campo p={perguntas.local_ocorrencia} para="dn-i-local_ocorrencia">
            <input id="dn-i-local_ocorrencia" className="dn-in" value={f.local_ocorrencia} onChange={(e) => set("local_ocorrencia", e.target.value)} placeholder="Ex.: contrato SMED — unidade Centro" />
          </Campo>

          <Campo p={perguntas.como_soube} falta={falta("como_soube")} para="dn-i-como_soube">
            <Sel id="dn-i-como_soube" valor={f.como_soube} onChange={(v) => set("como_soube", v)} opcoes={COMO_SOUBE} />
          </Campo>
        </div>
      </section>

      {/* ---------------------------------------------- Envolvimento da liderança */}
      <section className="dn-card">
        <div className="dn-card-h">
          <span className="dn-card-ic"><UsersRound className="h-5 w-5" /></span>
          <div>
            <h2>Envolvimento da liderança</h2>
            <p>Ajuda o comitê a definir quem pode ou não participar da apuração.</p>
          </div>
        </div>
        <div className="dn-card-b">
          <Campo p={perguntas.lideranca_ciente}>
            <Pills valor={f.lideranca_ciente} onChange={(v) => set("lideranca_ciente", v)} opcoes={SIM_NAO_NAOSEI} />
          </Campo>
          {f.lideranca_ciente === "sim" && (
            <Campo p={perguntas.lideranca_ciente_quem} para="dn-i-lideranca_ciente_quem" className="dn-sub">
              <textarea
                id="dn-i-lideranca_ciente_quem" className="dn-in dn-ta" style={{ minHeight: 70 }}
                value={f.lideranca_ciente_quem} onChange={(e) => set("lideranca_ciente_quem", e.target.value)}
                placeholder="Nome, cargo ou como identificar a pessoa — deixe em branco se preferir não informar"
              />
            </Campo>
          )}

          <Campo p={perguntas.lideranca_envolvida}>
            <Pills valor={f.lideranca_envolvida} onChange={(v) => set("lideranca_envolvida", v)} opcoes={SIM_NAO_NAOSEI} />
          </Campo>
          {f.lideranca_envolvida === "sim" && (
            <Campo p={perguntas.lideranca_envolvida_quem} para="dn-i-lideranca_envolvida_quem" className="dn-sub">
              <textarea
                id="dn-i-lideranca_envolvida_quem" className="dn-in dn-ta" style={{ minHeight: 70 }}
                value={f.lideranca_envolvida_quem} onChange={(e) => set("lideranca_envolvida_quem", e.target.value)}
                placeholder="Nome, cargo ou como identificar a pessoa — deixe em branco se preferir não informar"
              />
            </Campo>
          )}

          <Campo
            p={perguntas.lideranca_ocultou}
            ajuda="Apesar de não se envolver diretamente, algumas pessoas podem propositadamente ter ignorado o problema, se comprometido a fazer algo, afirmado que não era um problema, ou alterado evidências."
          >
            <Pills valor={f.lideranca_ocultou} onChange={(v) => set("lideranca_ocultou", v)} opcoes={SIM_NAO_NAOSEI} />
          </Campo>
          {f.lideranca_ocultou === "sim" && (
            <Campo p={perguntas.lideranca_ocultou_quem} para="dn-i-lideranca_ocultou_quem" className="dn-sub">
              <textarea
                id="dn-i-lideranca_ocultou_quem" className="dn-in dn-ta" style={{ minHeight: 70 }}
                value={f.lideranca_ocultou_quem} onChange={(e) => set("lideranca_ocultou_quem", e.target.value)}
                placeholder="Nome, cargo ou como identificar a pessoa — deixe em branco se preferir não informar"
              />
            </Campo>
          )}
        </div>
      </section>

      {/* ------------------------------------------------------------ Relato */}
      <section className="dn-card">
        <div className="dn-card-h">
          <span className="dn-card-ic"><MessageSquareWarning className="h-5 w-5" /></span>
          <div>
            <h2>Relato</h2>
            <p>A parte mais importante: conte o que aconteceu com o máximo de detalhe.</p>
          </div>
        </div>
        <div className="dn-card-b">
          <Campo
            p={perguntas.descricao} falta={falta("descricao")} para="dn-i-descricao"
            ajuda="Descreva o mais detalhadamente possível o que aconteceu, indicando o nome das pessoas envolvidas, quando o fato ocorreu e se ainda continua ocorrendo."
          >
            <textarea
              id="dn-i-descricao" className="dn-in dn-ta" style={{ minHeight: 168 }}
              value={f.descricao} onChange={(e) => set("descricao", e.target.value)}
              placeholder="O que aconteceu, quem estava envolvido, quando e onde…"
            />
            <div className="dn-cnt">
              <div className="dn-cnt-tri" data-ok={f.descricao.trim().length >= 30 ? "1" : "0"}>
                <i style={{ width: `${Math.min(100, (f.descricao.trim().length / 30) * 100)}%` }} />
              </div>
              <span>
                {f.descricao.trim().length < 30
                  ? `Faltam ${30 - f.descricao.trim().length} caracteres`
                  : `${f.descricao.length} caracteres`}
              </span>
            </div>
          </Campo>

          <Campo p={perguntas.testemunhas} para="dn-i-testemunhas">
            <textarea id="dn-i-testemunhas" className="dn-in dn-ta" value={f.testemunhas} onChange={(e) => set("testemunhas", e.target.value)} />
          </Campo>

          <Campo
            p={perguntas.evidencias} para="dn-i-evidencias"
            ajuda="Quais e onde podem ser encontradas? Existem documentos que comprovam o fato? Qualquer informação pode ser útil, por mais irrelevante que pareça."
          >
            <textarea id="dn-i-evidencias" className="dn-in dn-ta" value={f.evidencias} onChange={(e) => set("evidencias", e.target.value)} />
            <div className="dn-note mt-2">
              <Info className="h-4 w-4" />
              <span>
                <b>Não remova nem tome contato com qualquer evidência ou prova.</b> Manipular documentos,
                mensagens ou objetos pode prejudicar a investigação.
              </span>
            </div>
          </Campo>

          <Campo p={perguntas.valor_financeiro} para="dn-i-valor_financeiro">
            <input id="dn-i-valor_financeiro" className="dn-in" value={f.valor_financeiro} onChange={(e) => set("valor_financeiro", e.target.value)} placeholder="Ex.: R$ 2.500,00 aproximadamente" />
          </Campo>

          <Campo p={perguntas.sugestao} para="dn-i-sugestao">
            <textarea id="dn-i-sugestao" className="dn-in dn-ta" value={f.sugestao} onChange={(e) => set("sugestao", e.target.value)} />
          </Campo>
        </div>
      </section>

      {/* ------------------------------------------------------------- Termo */}
      <section className="dn-card">
        <div className="dn-card-h">
          <span className="dn-card-ic"><ScrollText className="h-5 w-5" /></span>
          <div>
            <h2>Leia antes de enviar</h2>
            <p>Como suas informações serão tratadas.</p>
          </div>
        </div>
        <div className="dn-card-b">
          <p className="text-sm leading-relaxed text-slate-600">
            Ao preencher o formulário, você concorda que o Grupo Nascimento salve e trate as informações
            prestadas, possibilitando que medidas sejam tomadas a partir da análise do conteúdo de suas
            respostas. As informações são tratadas de forma confidencial e usadas exclusivamente para a
            apuração do relato.
          </p>
          <div className="dn-q" id="dn-q-concordou_termo" data-falta={falta("concordou_termo") ? "1" : "0"}>
            <label className="dn-termo" data-on={f.concordou_termo ? "1" : "0"}>
              <input
                type="checkbox"
                checked={f.concordou_termo} onChange={(e) => set("concordou_termo", e.target.checked)}
              />
              <span>
                <span className="dn-num">{perguntas.concordou_termo.n}-</span>
                {perguntas.concordou_termo.label} <span className="dn-req">*</span>
              </span>
            </label>
          </div>
        </div>
      </section>

      <div className="dn-card" style={{ padding: 20 }}>
        {/* Depois de um envio recusado a lista fica viva: cada pendência some
            sozinha assim que a pergunta é respondida. */}
        {tentou && faltando.length > 0 && (
          <div className="dn-erro" style={{ marginBottom: 16 }}>
            <p className="dn-erro-t">
              <TriangleAlert className="h-4 w-4" />
              {faltando.length === 1
                ? "Falta responder 1 pergunta obrigatória:"
                : `Faltam responder ${faltando.length} perguntas obrigatórias:`}
            </p>
            <ul>
              {faltando.map((x) => (
                <li key={x.k}>
                  <button type="button" onClick={() => irAte(x.k)}>
                    <ChevronRight className="h-4 w-4" />
                    <span>
                      <b>{x.n}-</b> {x.label}
                      <i>{x.motivo}</i>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {erroServidor && <div className="dn-erro" style={{ marginBottom: 16 }}>{erroServidor}</div>}

        <button className="dn-btn dn-btn-lar dn-btn-w" onClick={enviar} disabled={enviando}>
          <Send className="h-4 w-4" /> {enviando ? "Enviando…" : "Registrar denúncia"}
        </button>
        <p className="mt-3 text-center text-xs leading-relaxed text-slate-500">
          Ao registrar, você recebe um <b className="text-slate-700">protocolo</b> e uma{" "}
          <b className="text-slate-700">senha</b> para acompanhar a denúncia.
        </p>
        <div className="dn-note mt-4">
          <KeyRound className="h-4 w-4" />
          <span>Já registrou antes? Consulte o andamento com o protocolo e a senha que você guardou.</span>
        </div>
        <button className="dn-btn dn-btn-sec dn-btn-w mt-3" onClick={onAcompanhar}>
          <Search className="h-4 w-4" /> Acompanhar uma denúncia
        </button>
      </div>
    </div>
  );
}

// -------------------------------------------------------------- Acompanhar
function Acompanhar({ onVoltar }: { onVoltar: () => void }) {
  const [protocolo, setProtocolo] = useState("");
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState("");
  const [carregando, setCarregando] = useState(false);
  const [dados, setDados] = useState<DenunciaConsulta | null>(null);

  const consultar = async () => {
    if (carregando) return;
    if (!protocolo.trim() || !senha.trim()) {
      setErro("Informe o protocolo e a senha recebidos ao registrar a denúncia.");
      return;
    }
    setErro(""); setCarregando(true);
    // `falha` e não `erro` porque `erro` já é o estado da tela logo acima.
    const { data, erro: falha } = await chamarCanal<DenunciaConsulta>("denuncia-consultar", {
      protocolo: protocolo.trim(),
      senha: senha.trim(),
    });
    setCarregando(false);
    if (falha || !data) { setErro(falha || "Não foi possível consultar agora."); setDados(null); return; }
    setDados(data);
  };

  if (dados) {
    const st = STATUS_LABEL[dados.status] ?? { titulo: dados.status, desc: "", tom: "neutro" };
    const tipo = TIPO_DENUNCIA.find((t) => t.value === dados.tipo_denuncia)?.label ?? dados.tipo_denuncia;
    // Caso final acende a régua inteira; caso em curso acende até a etapa atual.
    const encerrada = FINAIS.includes(dados.status);
    const atual = encerrada ? TRILHA.length : TRILHA.indexOf(dados.status);

    return (
      <div className="space-y-4">
        <section className="dn-card">
          <div className="dn-card-h">
            <span className="dn-card-ic"><FileText className="h-5 w-5" /></span>
            <div>
              <h2>Protocolo {dados.protocolo}</h2>
              <p>Registrada em {fmtDt(dados.registrada_em)}</p>
            </div>
          </div>
          <div className="dn-card-b">
            <div className="dn-tl">
              {["Recebida", "Em análise", "Em apuração", "Concluída"].map((etapa, i) => (
                <div key={etapa} className="dn-tl-p" data-on={i <= atual ? "1" : "0"}>
                  <span className="dn-tl-b">
                    {i < atual || (encerrada && i === TRILHA.length)
                      ? <Check className="h-3.5 w-3.5" strokeWidth={3} />
                      : <CheckCircle2 className="h-3.5 w-3.5" />}
                  </span>
                  <small>{etapa}</small>
                </div>
              ))}
            </div>

            <div className={`dn-st-${st.tom} rounded-xl p-4`}>
              <p className="text-sm font-extrabold">{st.titulo}</p>
              {st.desc && <p className="mt-0.5 text-xs leading-relaxed">{st.desc}</p>}
            </div>

            <div className="dn-grid2">
              <div><p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Tipo</p><p className="mt-0.5 text-sm font-bold text-slate-700">{tipo}</p></div>
              <div><p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Última atualização</p><p className="mt-0.5 text-sm font-bold text-slate-700">{fmtDt(dados.atualizada_em)}</p></div>
              {dados.concluida_em && (
                <div><p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Concluída em</p><p className="mt-0.5 text-sm font-bold text-slate-700">{fmtDt(dados.concluida_em)}</p></div>
              )}
            </div>
          </div>
        </section>

        <section className="dn-card">
          <div className="dn-card-h">
            <span className="dn-card-ic"><MessageSquareWarning className="h-5 w-5" /></span>
            <div>
              <h2>Retorno da apuração</h2>
              <p>O que o comitê publicou sobre este caso.</p>
            </div>
          </div>
          <div className="dn-card-b">
            {dados.retorno
              ? <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-slate-700 [overflow-wrap:anywhere]">{dados.retorno}</p>
              : <p className="text-sm leading-relaxed text-slate-500">
                  Ainda não há retorno publicado. Assim que a apuração avançar, a resposta aparece aqui —
                  guarde seu protocolo e senha para consultar novamente.
                </p>}
          </div>
        </section>

        <div className="flex flex-wrap gap-3">
          <button className="dn-btn dn-btn-sec" style={{ flex: 1 }} onClick={() => { setDados(null); setSenha(""); }}>
            <Search className="h-4 w-4" /> Consultar outro protocolo
          </button>
          <button className="dn-btn" style={{ flex: 1 }} onClick={onVoltar}>Registrar nova denúncia</button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <section className="dn-card">
        <div className="dn-card-h">
          <span className="dn-card-ic"><KeyRound className="h-5 w-5" /></span>
          <div>
            <h2>Acompanhar denúncia</h2>
            <p>É o único jeito de ver o andamento sem se identificar.</p>
          </div>
        </div>
        <div className="dn-card-b">
          {erro && <div className="dn-erro">{erro}</div>}

          <div>
            <label className="dn-lab" htmlFor="dn-prot">Protocolo</label>
            <input
              id="dn-prot" className="dn-in" placeholder="DEN-2026-00001"
              style={{ fontFamily: "'JetBrains Mono', ui-monospace, monospace" }}
              value={protocolo} onChange={(e) => setProtocolo(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") consultar(); }}
            />
          </div>
          <div>
            <label className="dn-lab" htmlFor="dn-senha">Senha de acompanhamento</label>
            <input
              id="dn-senha" className="dn-in" placeholder="ABCD123456"
              style={{ fontFamily: "'JetBrains Mono', ui-monospace, monospace" }}
              value={senha} onChange={(e) => setSenha(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") consultar(); }}
            />
          </div>
          <button className="dn-btn dn-btn-w" onClick={consultar} disabled={carregando}>
            <Search className="h-4 w-4" /> {carregando ? "Consultando…" : "Consultar andamento"}
          </button>

          <div className="dn-note">
            <Lock className="h-4 w-4" />
            <span>
              <b>Perdeu o protocolo ou a senha?</b> Não há como recuperá-los — nem por nós. A senha é
              guardada apenas cifrada, justamente para que ninguém consiga se passar por você. Se perdeu
              os dados, registre um novo relato.
            </span>
          </div>
        </div>
      </section>

      <button className="dn-btn dn-btn-sec dn-btn-w" onClick={onVoltar}>
        <ArrowLeft className="h-4 w-4" /> Voltar e registrar uma denúncia
      </button>
    </div>
  );
}

/**
 * Uma pergunta: número, enunciado, ajuda e o controle. Fica com o `id`
 * `dn-q-<campo>` porque é para ele que o aviso de pendência rola a tela.
 */
function Campo({ p, falta = false, ajuda, para, className = "", children }: {
  p: Pergunta & { n: number };
  falta?: boolean;
  ajuda?: string;
  /** id do controle, quando a pergunta tem um só — dá clique no rótulo. */
  para?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={`dn-q ${className}`} id={`dn-q-${p.k}`} data-falta={falta ? "1" : "0"}>
      <label className="dn-lab" htmlFor={para}>
        <span className="dn-num">{p.n}-</span>
        <Enunciado texto={p.label} destacar={p.destacar} />
        {p.req ? <span className="dn-req"> *</span> : <span className="dn-opt"> opcional</span>}
      </label>
      {ajuda && <p className="dn-help">{ajuda}</p>}
      {children}
    </div>
  );
}

/** Enunciado com uma palavra em negrito (CIENTE, ENVOLVIDO, ESCONDER). */
function Enunciado({ texto, destacar }: { texto: string; destacar?: string }) {
  if (!destacar) return <>{texto}</>;
  const i = texto.indexOf(destacar);
  if (i < 0) return <>{texto}</>;
  return <>{texto.slice(0, i)}<b>{destacar}</b>{texto.slice(i + destacar.length)}</>;
}

function Sel({ id, valor, onChange, opcoes }: {
  id?: string; valor: string; onChange: (v: string) => void; opcoes: { value: string; label: string }[];
}) {
  return (
    <div className="dn-sel-w">
      <select id={id} className="dn-in" value={valor} onChange={(e) => onChange(e.target.value)}>
        <option value="">Selecione uma opção…</option>
        {opcoes.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <ChevronBaixo />
    </div>
  );
}

function ChevronBaixo() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

function Pills({ valor, onChange, opcoes }: {
  valor: string; onChange: (v: string) => void; opcoes: { value: string; label: string }[];
}) {
  return (
    <div className="dn-pills">
      {opcoes.map((o) => (
        <button key={o.value} type="button" data-on={valor === o.value ? "1" : "0"} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}
