import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { SUPABASE_FUNCTIONS_URL } from "@/integrations/supabase/env";
import arcoNascimento from "@/assets/logo-nascimento-icon.png";
import {
  ShieldCheck, Lock, Send, Search, Copy, Check, EyeOff, UserCheck, KeyRound,
  FileText, ClipboardList, UsersRound, MessageSquareWarning, ScrollText,
  UserX, HeartCrack, Users, Banknote, HandCoins, Scale, Building2, FileLock2,
  HardHat, Leaf, BookMarked, CircleEllipsis, Info, ArrowLeft, Fingerprint,
  ServerOff, CheckCircle2, TriangleAlert, ChevronRight, MessagesSquare,
  ShieldAlert, Paperclip, X, Upload,
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
interface MensagemPublica {
  id: string;
  autor: "comite" | "denunciante";
  mensagem: string;
  criada_em: string;
}

interface DenunciaConsulta {
  protocolo: string;
  /** Assunto dado pelo comitê; nulo enquanto ninguém classificou. */
  titulo: string | null;
  /** Mensagens do comitê que a pessoa ainda não abriu. */
  nao_lidas: number;
  /** Onde o processo está (situação). */
  status: string;
  /** No que deu, quando já houve julgamento. Separado do status desde a
   *  migration 20260901000003 — antes o desfecho era o próprio status. */
  resultado: string | null;
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
  rota: "denuncia-registrar" | "denuncia-consultar" | "denuncia-conversa" | "denuncia-listas",
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
  { value: "desrespeito", label: "Desrespeito / Conduta inadequada", Icone: MessageSquareWarning },
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

/** Risco e retaliação são fato ou não são — "não sei" ali não ajudaria ninguém. */
const SIM_NAO = [
  { value: "sim", label: "Sim" },
  { value: "nao", label: "Não" },
];

const FREQUENCIA_OPC = [
  { value: "unica", label: "Aconteceu uma vez" },
  { value: "recorrente", label: "Acontece de forma repetida" },
  { value: "em_curso", label: "Está acontecendo agora" },
];

const SIM_NAO_NAOSEI = [
  { value: "sim", label: "Sim" },
  { value: "nao", label: "Não" },
  { value: "nao_sei", label: "Não sei" },
];

/** Situação — onde o processo está. */
const STATUS_LABEL: Record<string, { titulo: string; desc: string; tom: string }> = {
  nova:                  { titulo: "Recebida",              desc: "Registrada e na fila para análise inicial.", tom: "info" },
  em_analise:            { titulo: "Em análise",            desc: "A área responsável está avaliando o relato.", tom: "alerta" },
  aguardando_documentos: { titulo: "Aguardando documentos", desc: "A apuração depende de documentos ou informações complementares.", tom: "alerta" },
  investigacao:          { titulo: "Em investigação",       desc: "A apuração dos fatos está em andamento.", tom: "alerta" },
  julgada:               { titulo: "Julgada",               desc: "O comitê concluiu a análise; as providências estão em execução.", tom: "ok" },
  encerrada:             { titulo: "Encerrada",             desc: "O caso foi finalizado.", tom: "neutro" },
};

/** Desfecho — só existe depois do julgamento. */
const RESULTADO_LABEL: Record<string, { titulo: string; desc: string; tom: string }> = {
  procedente:              { titulo: "Procedente",              desc: "A apuração confirmou o relato e as medidas cabíveis foram tomadas.", tom: "ok" },
  parcialmente_procedente: { titulo: "Parcialmente procedente", desc: "Parte do que foi relatado se confirmou, com as medidas cabíveis.", tom: "ok" },
  improcedente:            { titulo: "Improcedente",            desc: "A apuração foi encerrada sem confirmar o fato relatado.", tom: "neutro" },
  arquivada:               { titulo: "Arquivada",               desc: "O caso foi encerrado sem prosseguimento.", tom: "neutro" },
};

/** Ordem do andamento na régua da tela de acompanhamento. */
const TRILHA = ["nova", "em_analise", "aguardando_documentos", "investigacao"];
const FINAIS = ["julgada", "encerrada"];

const fmtDt = (s?: string | null) => {
  if (!s) return "—";
  const d = new Date(s);
  return isNaN(+d) ? "—" : d.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
};

interface Form {
  /**
   * Duas perguntas diferentes, e é importante que continuem separadas:
   *
   *   `anonimo`      — não deixa NENHUM contato. O acompanhamento passa a ser
   *                    por protocolo + senha (20260914000003).
   *   `identificado` — deixa e-mail, mas escolhe se diz o nome.
   *
   * Juntá-las faria "não quero me identificar" significar "abro mão de saber
   * o que aconteceu com a minha denúncia", que não é a mesma coisa.
   */
  anonimo: "sim" | "nao" | "";
  identificado: "sim" | "nao" | "";
  /** Chave de acesso ao acompanhamento (vazio quando anônimo). */
  email_acesso: string;
  senha: string;
  senha2: string;
  empresa_id: string;
  contrato_informado: string;
  contrato_situacao: string;
  ocorrencia_data: string;
  ocorrencia_hora: string;
  ocorrencia_frequencia: string;
  risco_imediato: "sim" | "nao" | "";
  risco_imediato_detalhe: string;
  retaliacao: "sim" | "nao" | "";
  retaliacao_detalhe: string;
  denunciado_informado: string;
  denunciado_funcao: string;
  /** Só vive na tela: os arquivos sobem depois do registro, com o protocolo. */
  arquivos: File[];
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
  anonimo: "", identificado: "", email_acesso: "", senha: "", senha2: "",
  empresa_id: "", contrato_informado: "", contrato_situacao: "",
  ocorrencia_data: "", ocorrencia_hora: "", ocorrencia_frequencia: "",
  risco_imediato: "", risco_imediato_detalhe: "",
  retaliacao: "", retaliacao_detalhe: "",
  denunciado_informado: "", denunciado_funcao: "", arquivos: [],
  nome_completo: "", cpf: "", email: "", data_nascimento: "",
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
  // Empresa e contrato abrem o formulário: é o que decide para qual comitê o
  // caso vai e qual operação está envolvida — perguntar isso no fim faria a
  // pessoa recontar o caso já pensando em outra coisa.
  { k: "empresa_id",          label: "Em qual empresa do grupo ocorreu o fato?", req: true },
  { k: "contrato_informado",  label: "Em qual contrato ou local de trabalho?" },
  { k: "anonimo",             label: "Você quer registrar esta denúncia de forma anônima?", req: true },
  { k: "identificado",        label: "Você gostaria de informar seu nome ao comitê?", req: true,
    quando: (f) => f.anonimo !== "sim" },
  { k: "nome_completo",       label: "Nome completo", req: true, quando: seIdentificou },
  { k: "cpf",                 label: "CPF", quando: seIdentificou },
  { k: "data_nascimento",     label: "Data de nascimento", quando: seIdentificou },
  { k: "telefone_fixo",       label: "Telefone fixo", quando: seIdentificou },
  { k: "relacao",             label: "Qual a sua relação com o Grupo Nascimento?", req: true },
  { k: "tipo_denuncia",       label: "Qual o tipo de denúncia melhor se enquadra ao fato que você está registrando?", req: true },
  { k: "local_ocorrencia",    label: "Em que local exatamente aconteceu?" },
  { k: "ocorrencia_data",     label: "Em que dia aconteceu? Se não lembrar a data exata, use a mais próxima." },
  { k: "ocorrencia_hora",     label: "Por volta de que horário?" },
  { k: "ocorrencia_frequencia", label: "Isso aconteceu uma vez ou se repete?" },
  { k: "como_soube",          label: "Como você tomou conhecimento deste fato?", req: true },
  { k: "denunciado_informado", label: "Quem é a pessoa denunciada?" },
  { k: "denunciado_funcao",   label: "Qual a função dela?", quando: (f) => !!f.denunciado_informado.trim() },
  { k: "risco_imediato",      label: "Existe risco imediato à segurança ou à saúde de alguém?", destacar: "risco imediato" },
  { k: "risco_imediato_detalhe", label: "Explique o risco. Isso faz o caso furar a fila.",
    quando: (f) => f.risco_imediato === "sim" },
  { k: "retaliacao",          label: "Você sofreu ou teme sofrer ameaça ou retaliação por causa disso?", destacar: "retaliação" },
  { k: "retaliacao_detalhe",  label: "Conte o que aconteceu ou o que você teme.",
    quando: (f) => f.retaliacao === "sim" },
  { k: "lideranca_ciente",    label: "Algum Diretor, Gerente, Coordenador, Supervisor ou Encarregado está CIENTE do problema relatado?", destacar: "CIENTE" },
  { k: "lideranca_ciente_quem",    label: "Quem está ciente? Se souber, indique as pessoas ou testemunhas.", quando: (f) => f.lideranca_ciente === "sim" },
  { k: "lideranca_envolvida", label: "Algum Diretor, Gerente, Coordenador, Supervisor ou Encarregado está ENVOLVIDO diretamente no fato relatado?", destacar: "ENVOLVIDO" },
  { k: "lideranca_envolvida_quem", label: "Quem está envolvido? Se souber, indique as pessoas ou testemunhas.", quando: (f) => f.lideranca_envolvida === "sim" },
  { k: "lideranca_ocultou",   label: "Algum Diretor, Gerente, Coordenador, Supervisor ou Encarregado tentou ESCONDER o problema relatado?", destacar: "ESCONDER" },
  { k: "lideranca_ocultou_quem",   label: "Quem tentou esconder? Se souber, indique as pessoas ou testemunhas.", quando: (f) => f.lideranca_ocultou === "sim" },
  { k: "descricao",           label: "O que você quer denunciar?", req: true },
  { k: "testemunhas",         label: "Existem testemunhas? Em caso positivo, indique-as." },
  { k: "evidencias",          label: "Você sabe se existem evidências sobre o fato? Em caso positivo, indique-as." },
  { k: "arquivos",            label: "Quer anexar documentos, fotos, vídeos ou áudios?" },
  { k: "valor_financeiro",    label: "Qual o valor financeiro envolvido no fato relatado?" },
  { k: "sugestao",            label: "Você tem alguma sugestão de como solucionar o problema?" },
  // O acesso vem por último de propósito: é a última coisa que a pessoa faz
  // antes de enviar, e o enunciado explica para que serve.
  { k: "email_acesso",        label: "Qual o seu e-mail?", req: true,
    quando: (f) => f.anonimo !== "sim" },
  { k: "senha",               label: "Escolha uma senha para acompanhar a denúncia", req: true },
  { k: "celular",             label: "Qual o seu celular com WhatsApp?" },
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

    /* ---- anexos escolhidos ---- */
    .dn-anexos { list-style: none; margin: 10px 0 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
    .dn-anexos li { display: flex; align-items: center; gap: 8px; background: #f8fafc;
                    border: 1px solid #e7ecf4; border-radius: 10px; padding: 8px 10px; font-size: 13px; }
    .dn-anexos li svg { color: #64748b; flex: 0 0 auto; }
    .dn-anexo-n { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .dn-anexo-t { color: #64748b; font-size: 12px; flex: 0 0 auto; }
    .dn-anexos button { background: none; border: 0; cursor: pointer; padding: 2px; display: flex;
                        color: #b91c1c; border-radius: 6px; }
    .dn-anexos button:hover { background: #fee2e2; }

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

    /* ---- fio da conversa com o comitê ---- */
    .dn-fio { display: flex; flex-direction: column; gap: 8px; max-height: 340px; overflow-y: auto;
              background: #f8fafc; border: 1px solid #e7ecf4; border-radius: 14px; padding: 12px; }
    .dn-msg { max-width: 85%; border-radius: 13px; padding: 10px 12px; border: 1px solid #e2e8f0;
              background: #fff; align-self: flex-start; }
    .dn-msg[data-eu="1"] { align-self: flex-end; background: #f2f6fd; border-color: #cfdcf5; }
    .dn-msg-h { font-size: 10.5px; font-weight: 800; text-transform: uppercase; letter-spacing: .06em;
                color: #94a3b8; margin: 0 0 3px; }
    .dn-msg-t { font-size: 13.5px; line-height: 1.5; color: #1e293b; margin: 0;
                white-space: pre-wrap; overflow-wrap: anywhere; }
    /* Badge de mensagem nova na lista de denúncias da pessoa. */
    .dn-novas { display: inline-flex; align-items: center; gap: 4px; background: #fff4ec; color: #ea580c;
                border: 1px solid #ffdec6; border-radius: 99px; padding: 2px 8px;
                font-size: 10.5px; font-weight: 800; }

    /* ---- item da lista de denúncias da pessoa ---- */
    .dn-item { display: flex; align-items: center; justify-content: space-between; gap: 12px; width: 100%;
               text-align: left; cursor: pointer; border: 1.5px solid #dde5f0; background: #fff;
               border-radius: 14px; padding: 13px 15px; font-family: inherit;
               transition: border-color .15s, background .15s; }
    .dn-item:hover { border-color: #0f3171; background: #f4f8ff; }

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
              Conduta. Você informa um e-mail e escolhe uma senha — é com eles que acompanha a
              apuração e recebe as atualizações do caso.
            </p>
            <div className="dn-selos">
              <div className="dn-selo">
                <EyeOff className="h-5 w-5" />
                <div><b>Seu nome é opcional</b><span>Você decide se quer se identificar ao comitê.</span></div>
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
  const [ok, setOk] = useState<
    { protocolo: string; anonimo?: boolean; acesso?: string; falhasAnexo?: string[] } | null
  >(null);
  const [copiou, setCopiou] = useState(false);
  /** Progresso do upload — envio de vídeo demora, e barra parada assusta. */
  const [anexando, setAnexando] = useState<{ feitos: number; total: number } | null>(null);

  // As listas do banco. Empresa é cadastro (CANAL_DENUNCIA_EMPRESA), e os
  // contratos vêm do cadastro de pessoal da empresa escolhida.
  const [empresas, setEmpresas] = useState<{ id: string; rotulo: string }[]>([]);
  const [contratos, setContratos] = useState<string[]>([]);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((c) => ({ ...c, [k]: v }));

  // Empresas: uma vez, ao abrir.
  useEffect(() => {
    (async () => {
      const { data } = await chamarCanal<{ id: string; rotulo: string }[]>("denuncia-listas", { o: "empresas" });
      if (Array.isArray(data)) setEmpresas(data);
    })();
  }, []);

  // Contratos: sempre que a empresa muda. A lista anterior é limpa junto —
  // deixar o contrato de outra empresa selecionado seria pior que não ter lista.
  useEffect(() => {
    if (!f.empresa_id) { setContratos([]); return; }
    setF((c) => ({ ...c, contrato_informado: "", contrato_situacao: "" }));
    (async () => {
      const { data } = await chamarCanal<{ contratos: string[] }>(
        "denuncia-listas", { o: "contratos", empresa_id: f.empresa_id });
      setContratos(data?.contratos ?? []);
    })();
  }, [f.empresa_id]);

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
    if (!f.empresa_id) add("empresa_id", "selecione a empresa");
    if (f.anonimo === "") add("anonimo", "escolha uma das duas opções");
    if (f.anonimo !== "sim" && f.identificado === "") add("identificado", "escolha uma das duas opções");
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
    // Mesmas regras da RPC, checadas aqui para o erro não vir do servidor.
    // No relato anônimo não há e-mail: o acesso é pelo protocolo, e cobrar
    // e-mail aqui tornaria a opção de anonimato impossível de concluir.
    const email = f.email_acesso.trim();
    if (f.anonimo !== "sim") {
      if (!email) add("email_acesso", "informe o e-mail — é por ele que você acessa depois");
      else if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) add("email_acesso", "e-mail com formato inválido");
    }
    if (!f.senha) add("senha", "escolha uma senha");
    else if (f.senha.length < 8) add("senha", `a senha precisa de pelo menos 8 caracteres (faltam ${8 - f.senha.length})`);
    else if (f.senha !== f.senha2) add("senha", "as duas senhas digitadas não são iguais");
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
    const anon = f.anonimo === "sim";
    const ident = !anon && f.identificado === "sim";
    const { data, erro } = await chamarCanal<{ protocolo: string; anonimo: boolean; acesso: string }>(
      "denuncia-registrar",
      {
        anonimo: anon,
        identificado: ident,
        empresa_id: f.empresa_id,
        contrato_informado: f.contrato_informado,
        // Se a pessoa digitou algo mas não escolheu da lista, é preenchimento
        // manual — e isso precisa aparecer no relatório como tal.
        contrato_situacao: f.contrato_situacao
          || (f.contrato_informado.trim() ? "manual" : "nao_sei"),
        ocorrencia_data: f.ocorrencia_data,
        ocorrencia_hora: f.ocorrencia_hora,
        ocorrencia_frequencia: f.ocorrencia_frequencia,
        risco_imediato: f.risco_imediato === "sim",
        risco_imediato_detalhe: f.risco_imediato_detalhe,
        retaliacao: f.retaliacao === "sim",
        retaliacao_detalhe: f.retaliacao_detalhe,
        denunciado_informado: f.denunciado_informado,
        denunciado_funcao: f.denunciado_funcao,
        nome_completo: ident ? f.nome_completo : "",
        cpf: ident ? f.cpf : "",
        data_nascimento: ident ? f.data_nascimento : "",
        telefone_fixo: ident ? f.telefone_fixo : "",
        // Acesso. No anônimo o e-mail vai vazio de propósito: a RPC recusa
        // gravar e-mail junto de `anonimo`, e é essa recusa que faz o
        // anonimato ser uma garantia e não uma promessa.
        email_acesso: anon ? "" : f.email_acesso.trim(),
        senha: f.senha,
        celular: anon ? "" : f.celular,
        // Só para montar o link na mensagem do WhatsApp; a função valida.
        origem_url: window.location.origin,
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
    if (erro || !data) {
      setEnviando(false);
      setErroServidor(erro || "Não foi possível registrar agora. Tente novamente em instantes.");
      return;
    }

    // Os arquivos sobem DEPOIS do registro, um a um, autenticados pelo
    // protocolo que acabou de nascer e pela senha que a pessoa escolheu.
    // A denúncia já está gravada: se um anexo falhar, o relato não se perde —
    // a tela avisa quais não subiram e a pessoa reenvia pelo acompanhamento.
    const falhas: string[] = [];
    if (f.arquivos.length) {
      setAnexando({ feitos: 0, total: f.arquivos.length });
      for (const [i, arq] of f.arquivos.entries()) {
        const fd = new FormData();
        fd.append("protocolo", data.protocolo);
        fd.append("senha", f.senha);
        fd.append("arquivo", arq);
        try {
          const resp = await fetch(`${SUPABASE_FUNCTIONS_URL}/denuncia-anexar`, {
            method: "POST", body: fd,
          });
          if (!resp.ok) {
            const c = await resp.json().catch(() => null);
            falhas.push(`${arq.name}: ${c?.error ?? "falhou"}`);
          }
        } catch {
          falhas.push(`${arq.name}: sem conexão`);
        }
        setAnexando({ feitos: i + 1, total: f.arquivos.length });
      }
      setAnexando(null);
    }

    setEnviando(false);
    setOk({ ...data, falhasAnexo: falhas });
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
            {ok.anonimo
              ? "Seu relato chegou ao comitê responsável, sem nenhum dado que identifique você. Anote o número do processo abaixo: é ele, junto da sua senha, que abre o acompanhamento."
              : "Seu relato chegou ao comitê responsável. Para acompanhar, volte a esta página e entre com o seu e-mail e a senha que você escolheu."}
          </p>

          <div className="dn-chips mt-6 text-left">
            <div className="dn-chip">
              <p className="dn-chip-l">Número do processo</p>
              <p className="dn-cod">{ok.protocolo}</p>
            </div>
            <div className="dn-chip">
              <p className="dn-chip-l">Seu acesso</p>
              <p className="mt-1 break-all text-sm font-bold text-[#0f3171]">
                {ok.anonimo ? "O número do processo acima" : f.email_acesso.trim()}
              </p>
              <p className="text-xs text-slate-500">+ a senha que você escolheu</p>
            </div>
          </div>

          {/* O relato foi gravado; o anexo é que não subiu. Dizer as duas
              coisas na mesma tela evita que a pessoa registre tudo de novo
              achando que perdeu a denúncia. */}
          {!!ok.falhasAnexo?.length && (
            <div className="dn-guarde mx-auto mt-5 max-w-lg" style={{ borderColor: "#fca5a5", background: "#fef2f2" }}>
              <b>A denúncia foi registrada, mas {ok.falhasAnexo.length} arquivo(s) não subiram.</b>{" "}
              Entre em “Acompanhar esta denúncia” para enviá-los de novo. Não registre outro relato.
              <ul style={{ margin: "8px 0 0 18px", padding: 0 }}>
                {ok.falhasAnexo.map((x) => <li key={x} style={{ fontSize: 12 }}>{x}</li>)}
              </ul>
            </div>
          )}

          <div className="mt-4 flex flex-wrap justify-center gap-2.5">
            <button
              type="button" className="dn-btn dn-btn-sec"
              onClick={() => {
                // Só o número do processo: a senha não vai para a área de
                // transferência, nem para lugar nenhum fora da cabeça da pessoa.
                navigator.clipboard?.writeText(ok.protocolo);
                setCopiou(true); setTimeout(() => setCopiou(false), 2000);
              }}
            >
              {copiou ? <><Check className="h-4 w-4" /> Copiado!</> : <><Copy className="h-4 w-4" /> Copiar nº do processo</>}
            </button>
            <button type="button" className="dn-btn" onClick={onAcompanhar}>
              <Search className="h-4 w-4" /> Acompanhar esta denúncia
            </button>
          </div>

          {/* Aviso duro de propósito: não existe recuperação de senha. */}
          <div className="dn-guarde mx-auto mt-6 max-w-lg">
            <b>Não existe "esqueci minha senha".</b> A senha é guardada apenas cifrada e não pode ser
            recuperada — nem por nós. É exatamente isso que impede alguém de se passar por você para
            acompanhar a denúncia. Se esquecer, será preciso registrar um novo relato.
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
          <b>Escolhe e-mail e senha</b>
          <span className="dn-passo-d">Você define a senha; nada de código para decorar.</span>
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
            <p>Dizer seu nome é opcional. O e-mail, pedido no fim, é obrigatório.</p>
          </div>
        </div>
        <div className="dn-card-b">
          <Campo
            p={perguntas.empresa_id} falta={falta("empresa_id")} para="dn-i-empresa"
            ajuda="O grupo tem empresas diferentes, e cada uma tem o seu comitê. É por aqui que a denúncia chega a quem pode apurar."
          >
            <Sel id="dn-i-empresa" valor={f.empresa_id} onChange={(v) => set("empresa_id", v)}
                 opcoes={empresas.map((e) => ({ value: e.id, label: e.rotulo }))} />
          </Campo>

          <Campo
            p={perguntas.contrato_informado} para="dn-i-contrato"
            ajuda="Se não encontrar na lista, escolha “Não localizei” e escreva do seu jeito — ninguém precisa saber o nome oficial do contrato."
          >
            {contratos.length > 0 && (
              <Sel
                id="dn-i-contrato"
                valor={f.contrato_situacao === "selecionado" ? f.contrato_informado : ""}
                onChange={(v) => setF((c) => ({
                  ...c, contrato_informado: v, contrato_situacao: v ? "selecionado" : "",
                }))}
                opcoes={[
                  ...contratos.map((c) => ({ value: c, label: c })),
                  { value: "__nao_localizado", label: "Não localizei meu contrato na lista" },
                  { value: "__nao_sei", label: "Não sei informar" },
                ]}
              />
            )}
            {/* O campo livre aparece quando não há lista, ou quando a pessoa
                disse que não achou o contrato dela. */}
            {(contratos.length === 0
              || f.contrato_informado === "__nao_localizado"
              || f.contrato_situacao === "manual") && (
              <input
                className="dn-in"
                style={{ marginTop: contratos.length ? 8 : 0 }}
                value={f.contrato_situacao === "manual" ? f.contrato_informado : ""}
                onChange={(e) => setF((c) => ({
                  ...c, contrato_informado: e.target.value, contrato_situacao: "manual",
                }))}
                placeholder="Escreva o contrato, a unidade ou o local onde você trabalha"
              />
            )}
          </Campo>

          <Campo
            p={perguntas.anonimo} falta={falta("anonimo")}
            ajuda="Anônima: você não deixa nenhum contato, e acompanha o caso pelo número de protocolo + a senha que escolher. Com e-mail: o comitê consegue pedir esclarecimentos e você recebe o retorno."
          >
            <div className="dn-esc">
              <button type="button" data-on={f.anonimo === "nao" ? "1" : "0"} onClick={() => set("anonimo", "nao")}>
                <Fingerprint className="h-5 w-5" />
                <span className="dn-esc-t">
                  <b>Quero deixar meu e-mail</b>
                  <span>O comitê pode conversar comigo e me dar retorno.</span>
                </span>
              </button>
              <button type="button" data-on={f.anonimo === "sim" ? "1" : "0"} onClick={() => set("anonimo", "sim")}>
                <EyeOff className="h-5 w-5" />
                <span className="dn-esc-t">
                  <b>Anônima, sem nenhum contato</b>
                  <span>Guarde bem o protocolo e a senha: sem eles não há como recuperar o acesso.</span>
                </span>
              </button>
            </div>
          </Campo>

          {f.anonimo === "sim" && (
            <p className="dn-help" style={{ marginTop: -6 }}>
              Nada que identifique você é gravado — nem e-mail, nem endereço de internet, nem
              o aparelho usado. Em troca, o comitê não terá como pedir um detalhe que falte,
              e isso às vezes é o que trava uma apuração.
            </p>
          )}

          {f.anonimo !== "sim" && (
          <Campo p={perguntas.identificado} falta={falta("identificado")}>
            <div className="dn-esc">
              <button type="button" data-on={f.identificado === "nao" ? "1" : "0"} onClick={() => set("identificado", "nao")}>
                <EyeOff className="h-5 w-5" />
                <span className="dn-esc-t">
                  <b>Não, prefiro não dizer meu nome</b>
                  <span className="dn-esc-d">Nome, CPF e telefone não são solicitados.</span>
                </span>
              </button>
              <button type="button" data-on={f.identificado === "sim" ? "1" : "0"} onClick={() => set("identificado", "sim")}>
                <UserCheck className="h-5 w-5" />
                <span className="dn-esc-t">
                  <b>Sim, quero me identificar</b>
                  <span className="dn-esc-d">Facilita o contato do comitê durante a apuração.</span>
                </span>
              </button>
            </div>
          </Campo>

          )}

          {f.anonimo !== "sim" && f.identificado === "sim" && (
            <div className="dn-grid2">
              <Campo p={perguntas.nome_completo} falta={falta("nome_completo")} className="dn-full">
                <input id="dn-i-nome_completo" className="dn-in" value={f.nome_completo} onChange={(e) => set("nome_completo", e.target.value)} placeholder="Seu nome" />
              </Campo>
              <Campo p={perguntas.cpf}>
                <input id="dn-i-cpf" className="dn-in" value={f.cpf} onChange={(e) => set("cpf", e.target.value)} placeholder="000.000.000-00" />
              </Campo>
              <Campo p={perguntas.data_nascimento}>
                <input id="dn-i-data_nascimento" type="date" className="dn-in" value={f.data_nascimento} onChange={(e) => set("data_nascimento", e.target.value)} />
              </Campo>
              <Campo p={perguntas.telefone_fixo} className="dn-full">
                <input id="dn-i-telefone_fixo" className="dn-in" value={f.telefone_fixo} onChange={(e) => set("telefone_fixo", e.target.value)} placeholder="(00) 0000-0000" />
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
            <input id="dn-i-local_ocorrencia" className="dn-in" value={f.local_ocorrencia} onChange={(e) => set("local_ocorrencia", e.target.value)} placeholder="Ex.: refeitório, portaria, sala da coordenação" />
          </Campo>

          <div className="dn-grid2">
            <Campo p={perguntas.ocorrencia_data} para="dn-i-ocorrencia_data">
              <input id="dn-i-ocorrencia_data" type="date" className="dn-in"
                     value={f.ocorrencia_data} onChange={(e) => set("ocorrencia_data", e.target.value)} />
            </Campo>
            <Campo p={perguntas.ocorrencia_hora} para="dn-i-ocorrencia_hora">
              <input id="dn-i-ocorrencia_hora" className="dn-in" value={f.ocorrencia_hora}
                     onChange={(e) => set("ocorrencia_hora", e.target.value)}
                     placeholder="Ex.: de manhã, por volta das 9h" />
            </Campo>
          </div>

          <Campo p={perguntas.ocorrencia_frequencia} para="dn-i-freq">
            <Sel id="dn-i-freq" valor={f.ocorrencia_frequencia}
                 onChange={(v) => set("ocorrencia_frequencia", v)} opcoes={FREQUENCIA_OPC} />
          </Campo>

          <Campo p={perguntas.como_soube} falta={falta("como_soube")} para="dn-i-como_soube">
            <Sel id="dn-i-como_soube" valor={f.como_soube} onChange={(v) => set("como_soube", v)} opcoes={COMO_SOUBE} />
          </Campo>

          <Campo
            p={perguntas.denunciado_informado} para="dn-i-denunciado"
            ajuda="Se não souber o nome, descreva do jeito que der: “o encarregado do turno da noite” já ajuda."
          >
            <input id="dn-i-denunciado" className="dn-in" value={f.denunciado_informado}
                   onChange={(e) => set("denunciado_informado", e.target.value)}
                   placeholder="Nome ou descrição de quem cometeu o fato" />
          </Campo>

          {f.denunciado_informado.trim() && (
            <Campo p={perguntas.denunciado_funcao} para="dn-i-denunciado_funcao">
              <input id="dn-i-denunciado_funcao" className="dn-in" value={f.denunciado_funcao}
                     onChange={(e) => set("denunciado_funcao", e.target.value)}
                     placeholder="Ex.: encarregado, supervisora, motorista" />
            </Campo>
          )}
        </div>
      </section>

      {/* ------------------------------------------------ Risco e retaliação */}
      {/* Bloco à parte, e não mais uma pergunta no meio: é o que decide se o
          caso fura a fila da triagem, e no meio de vinte perguntas passaria
          batido tanto para quem responde quanto para quem lê. */}
      <section className="dn-card">
        <div className="dn-card-h">
          <span className="dn-card-ic"><ShieldAlert className="h-5 w-5" /></span>
          <div>
            <h2>Risco e proteção</h2>
            <p>Se há alguém em perigo agora, ou se você teme sofrer consequências por denunciar.</p>
          </div>
        </div>
        <div className="dn-card-b">
          <Campo p={perguntas.risco_imediato}>
            <Pills valor={f.risco_imediato} onChange={(v) => set("risco_imediato", v as "sim" | "nao")} opcoes={SIM_NAO} />
          </Campo>
          {f.risco_imediato === "sim" && (
            <Campo p={perguntas.risco_imediato_detalhe} para="dn-i-risco_det">
              <textarea id="dn-i-risco_det" className="dn-ta" rows={3}
                        value={f.risco_imediato_detalhe}
                        onChange={(e) => set("risco_imediato_detalhe", e.target.value)}
                        placeholder="Quem está em risco e por quê." />
            </Campo>
          )}

          <Campo p={perguntas.retaliacao}>
            <Pills valor={f.retaliacao} onChange={(v) => set("retaliacao", v as "sim" | "nao")} opcoes={SIM_NAO} />
          </Campo>
          {f.retaliacao === "sim" && (
            <Campo p={perguntas.retaliacao_detalhe} para="dn-i-retal_det">
              <textarea id="dn-i-retal_det" className="dn-ta" rows={3}
                        value={f.retaliacao_detalhe}
                        onChange={(e) => set("retaliacao_detalhe", e.target.value)}
                        placeholder="O que aconteceu, ou o que você teme que aconteça." />
            </Campo>
          )}
          <p className="dn-help">
            Retaliar quem usa este canal é falta grave e apurada como denúncia própria.
          </p>
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

          <Campo
            p={perguntas.arquivos}
            ajuda="Aceita imagem, vídeo, áudio, PDF e documentos, até 25 MB cada e 20 arquivos. Eles são enviados depois que a denúncia é registrada, e ficam guardados em local restrito ao comitê."
          >
            <input
              id="dn-i-arquivos" type="file" multiple className="dn-in"
              onChange={(e) => {
                const novos = Array.from(e.target.files ?? []);
                // Acumula em vez de substituir: o seletor do navegador só
                // aceita uma pasta por vez, e trocar tudo faria a pessoa
                // perder o que já tinha escolhido sem nenhum aviso.
                setF((c) => ({ ...c, arquivos: [...c.arquivos, ...novos].slice(0, 20) }));
                e.target.value = "";
              }}
            />
            {f.arquivos.length > 0 && (
              <ul className="dn-anexos">
                {f.arquivos.map((a, i) => (
                  <li key={`${a.name}-${i}`}>
                    <Paperclip className="h-4 w-4" />
                    <span className="dn-anexo-n">{a.name}</span>
                    <span className="dn-anexo-t">{(a.size / 1024 / 1024).toFixed(1)} MB</span>
                    <button
                      type="button" aria-label={`Remover ${a.name}`}
                      onClick={() => setF((c) => ({
                        ...c, arquivos: c.arquivos.filter((_, j) => j !== i),
                      }))}
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Campo>

          <Campo p={perguntas.valor_financeiro} para="dn-i-valor_financeiro">
            <input id="dn-i-valor_financeiro" className="dn-in" value={f.valor_financeiro} onChange={(e) => set("valor_financeiro", e.target.value)} placeholder="Ex.: R$ 2.500,00 aproximadamente" />
          </Campo>

          <Campo p={perguntas.sugestao} para="dn-i-sugestao">
            <textarea id="dn-i-sugestao" className="dn-in dn-ta" value={f.sugestao} onChange={(e) => set("sugestao", e.target.value)} />
          </Campo>
        </div>
      </section>

      {/* ------------------------------------------------------------ Acesso */}
      <section className="dn-card">
        <div className="dn-card-h">
          <span className="dn-card-ic"><KeyRound className="h-5 w-5" /></span>
          <div>
            <h2>Como você vai acompanhar</h2>
            <p>É com estes dados que você volta aqui para ver o andamento.</p>
          </div>
        </div>
        <div className="dn-card-b">
          <Campo
            p={perguntas.email_acesso} falta={falta("email_acesso")} para="dn-i-email_acesso"
            ajuda="Para você receber atualizações sobre a denúncia e acessar o seu processo quando quiser."
          >
            <input
              id="dn-i-email_acesso" type="email" inputMode="email" autoComplete="email"
              className="dn-in" value={f.email_acesso}
              onChange={(e) => set("email_acesso", e.target.value)}
              placeholder="voce@exemplo.com"
            />
          </Campo>

          <Campo
            p={perguntas.senha} falta={falta("senha")} para="dn-i-senha"
            ajuda="Mínimo de 8 caracteres. Escolha uma senha que você lembre — ela não pode ser recuperada depois."
          >
            <div className="dn-grid2">
              <input
                id="dn-i-senha" type="password" autoComplete="new-password"
                className="dn-in" value={f.senha}
                onChange={(e) => set("senha", e.target.value)}
                placeholder="Sua senha"
              />
              <input
                id="dn-i-senha2" type="password" autoComplete="new-password"
                className="dn-in" value={f.senha2}
                onChange={(e) => set("senha2", e.target.value)}
                placeholder="Repita a senha"
              />
            </div>
          </Campo>

          <Campo
            p={perguntas.celular} para="dn-i-celular"
            ajuda="Se informar, enviamos o número do processo e o link de acompanhamento pelo WhatsApp."
          >
            <input
              id="dn-i-celular" inputMode="tel" className="dn-in" value={f.celular}
              onChange={(e) => set("celular", e.target.value)} placeholder="(00) 00000-0000"
            />
          </Campo>

          <div className="dn-note">
            <Lock className="h-4 w-4" />
            <span>
              A senha é guardada apenas <b>cifrada</b> — nem o comitê consegue lê-la. Ela nunca é
              enviada por e-mail nem por WhatsApp: só você a conhece.
            </span>
          </div>
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
          <Send className="h-4 w-4" /> {
            anexando
              ? `Enviando anexos (${anexando.feitos} de ${anexando.total})…`
              : enviando ? "Enviando…" : "Registrar denúncia"
          }
        </button>
        <p className="mt-3 text-center text-xs leading-relaxed text-slate-500">
          Você acompanha a denúncia com o seu <b className="text-slate-700">e-mail</b> e a{" "}
          <b className="text-slate-700">senha</b> que escolheu. Informando o celular, o número do
          processo também chega pelo WhatsApp.
        </p>
        <div className="dn-note mt-4">
          <KeyRound className="h-4 w-4" />
          <span>Já registrou antes? Entre com o seu e-mail e a senha que você escolheu.</span>
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
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState("");
  const [carregando, setCarregando] = useState(false);
  /** Todas as denúncias daquele e-mail — a pessoa pode ter registrado várias. */
  const [lista, setLista] = useState<DenunciaConsulta[] | null>(null);
  const [dados, setDados] = useState<DenunciaConsulta | null>(null);

  const consultar = async () => {
    if (carregando) return;
    if (!email.trim() || !senha) {
      setErro("Informe o e-mail (ou o número do processo) e a senha que você escolheu.");
      return;
    }
    setErro(""); setCarregando(true);
    // `falha` e não `erro` porque `erro` já é o estado da tela logo acima.
    const { data, erro: falha } = await chamarCanal<{ denuncias: DenunciaConsulta[] }>("denuncia-consultar", {
      // E-mail ou protocolo — o servidor decide qual é, e a resposta é a
      // mesma para credencial errada nos dois casos.
      identificador: email.trim(),
      senha,
    });
    setCarregando(false);
    if (falha || !data) { setErro(falha || "Não foi possível consultar agora."); setLista(null); return; }
    const itens = data.denuncias ?? [];
    setLista(itens);
    // Com uma denúncia só, abrir a lista para clicar em um item seria um
    // passo a troco de nada.
    setDados(itens.length === 1 ? itens[0] : null);
  };

  const limpar = () => { setLista(null); setDados(null); setSenha(""); };

  // Mais de uma denúncia no mesmo e-mail: escolhe qual acompanhar.
  if (lista && lista.length > 1 && !dados) {
    return (
      <div className="space-y-4">
        <section className="dn-card">
          <div className="dn-card-h">
            <span className="dn-card-ic"><FileText className="h-5 w-5" /></span>
            <div>
              <h2>Suas denúncias</h2>
              <p>{lista.length} registros neste e-mail. Toque em um para ver o andamento.</p>
            </div>
          </div>
          <div className="dn-card-b">
            {lista.map((d) => {
              const s = STATUS_LABEL[d.status] ?? { titulo: d.status, desc: "", tom: "neutro" };
              return (
                <button key={d.protocolo} type="button" className="dn-item" onClick={() => setDados(d)}>
                  <span className="min-w-0">
                    <span className="dn-cod block text-base">{d.protocolo}</span>
                    {d.titulo && <span className="block truncate text-sm font-semibold text-slate-700">{d.titulo}</span>}
                    <span className="block text-xs text-slate-500">Registrada em {fmtDt(d.registrada_em)}</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    {d.nao_lidas > 0 && (
                      <span className="dn-novas">
                        <MessagesSquare className="h-3 w-3" /> {d.nao_lidas}
                      </span>
                    )}
                    <span className={`dn-st-${s.tom} rounded-lg px-2.5 py-1 text-xs font-bold`}>
                      {s.titulo}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </section>
        <button className="dn-btn dn-btn-sec dn-btn-w" onClick={limpar}>
          <ArrowLeft className="h-4 w-4" /> Sair
        </button>
      </div>
    );
  }

  if (dados) {
    const st = STATUS_LABEL[dados.status] ?? { titulo: dados.status, desc: "", tom: "neutro" };
    const res = dados.resultado ? RESULTADO_LABEL[dados.resultado] : null;
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
              {["Recebida", "Em análise", "Aguardando docs.", "Investigação", "Concluída"].map((etapa, i) => (
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

            {/* O desfecho só existe depois do julgamento, e é a informação
                que o denunciante mais espera — por isso em bloco próprio. */}
            {res && (
              <div className={`dn-st-${res.tom} rounded-xl p-4`}>
                <p className="text-[11px] font-bold uppercase tracking-wide opacity-70">Resultado da apuração</p>
                <p className="mt-0.5 text-sm font-extrabold">{res.titulo}</p>
                <p className="mt-0.5 text-xs leading-relaxed">{res.desc}</p>
              </div>
            )}

            <div className="dn-grid2">
              <div><p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Tipo</p><p className="mt-0.5 text-sm font-bold text-slate-700">{tipo}</p></div>
              <div><p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Última atualização</p><p className="mt-0.5 text-sm font-bold text-slate-700">{fmtDt(dados.atualizada_em)}</p></div>
              {dados.concluida_em && (
                <div><p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Concluída em</p><p className="mt-0.5 text-sm font-bold text-slate-700">{fmtDt(dados.concluida_em)}</p></div>
              )}
            </div>
          </div>
        </section>

        {/* A conversa vem antes do retorno: se o comitê perguntou algo, é o
            que a pessoa precisa ver primeiro ao abrir o protocolo. */}
        <ConversaPublica email={email} senha={senha} protocolo={dados.protocolo} />

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
                  basta entrar de novo com o seu e-mail e a sua senha.
                </p>}
          </div>
        </section>

        <div className="flex flex-wrap gap-3">
          {/* Com várias denúncias, volta para a lista; com uma só, sai. */}
          {lista && lista.length > 1
            ? <button className="dn-btn dn-btn-sec" style={{ flex: 1 }} onClick={() => setDados(null)}>
                <ArrowLeft className="h-4 w-4" /> Ver minhas outras denúncias
              </button>
            : <button className="dn-btn dn-btn-sec" style={{ flex: 1 }} onClick={limpar}>
                <ArrowLeft className="h-4 w-4" /> Sair
              </button>}
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
            <p>Entre com o e-mail — ou o número do processo, se a denúncia foi anônima — e a senha que você escolheu.</p>
          </div>
        </div>
        <div className="dn-card-b">
          {erro && <div className="dn-erro">{erro}</div>}

          <div>
            <label className="dn-lab" htmlFor="dn-email">E-mail ou número do processo</label>
            <input
              id="dn-email" autoComplete="username"
              className="dn-in" placeholder="voce@exemplo.com   ou   DEN-2026-00001"
              value={email} onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") consultar(); }}
            />
          </div>
          <div>
            <label className="dn-lab" htmlFor="dn-senha">Senha</label>
            <input
              id="dn-senha" type="password" autoComplete="current-password"
              className="dn-in" placeholder="A senha que você escolheu"
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
              <b>Esqueceu a senha?</b> Não há como recuperá-la — nem por nós. Ela é guardada apenas
              cifrada, justamente para que ninguém consiga se passar por você. Se esqueceu, registre um
              novo relato.
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

/**
 * Conversa do denunciante com o comitê. Recarrega a cada abertura do
 * protocolo — sem sessão, a credencial (e-mail + senha) viaja em cada
 * chamada e é conferida no servidor toda vez.
 */
function ConversaPublica({ email, senha, protocolo }: {
  email: string; senha: string; protocolo: string;
}) {
  const [itens, setItens] = useState<MensagemPublica[] | null>(null);
  const [texto, setTexto] = useState("");
  const [carregando, setCarregando] = useState(true);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState("");

  const carregar = useCallback(async (mensagem?: string) => {
    const { data, erro: falha } = await chamarCanal<{ mensagens: MensagemPublica[] }>(
      "denuncia-conversa",
      { identificador: email, senha, protocolo, ...(mensagem ? { mensagem } : {}) },
    );
    if (falha || !data) { setErro(falha || "Não foi possível carregar a conversa."); return false; }
    setErro("");
    setItens(data.mensagens ?? []);
    return true;
  }, [email, senha, protocolo]);

  useEffect(() => {
    let vivo = true;
    setCarregando(true);
    carregar().finally(() => { if (vivo) setCarregando(false); });
    return () => { vivo = false; };
  }, [carregar]);

  const enviar = async () => {
    const t = texto.trim();
    if (!t || enviando) return;
    setEnviando(true);
    const ok = await carregar(t);
    setEnviando(false);
    if (ok) setTexto("");
  };

  return (
    <section className="dn-card">
      <div className="dn-card-h">
        <span className="dn-card-ic"><MessagesSquare className="h-5 w-5" /></span>
        <div>
          <h2>Conversa com o comitê</h2>
          <p>Use este espaço para responder ao comitê ou acrescentar informação.</p>
        </div>
      </div>
      <div className="dn-card-b">
        {erro && <div className="dn-erro">{erro}</div>}

        {carregando && <p className="text-sm text-slate-500">Carregando…</p>}

        {!carregando && itens && itens.length === 0 && (
          <div className="dn-note">
            <Info className="h-4 w-4" />
            <span>
              Ainda não há mensagens. Se lembrar de algum detalhe — data, nome, testemunha — escreva
              abaixo: ajuda diretamente na apuração.
            </span>
          </div>
        )}

        {!carregando && itens && itens.length > 0 && (
          <div className="dn-fio">
            {itens.map((m) => (
              <div key={m.id} className="dn-msg" data-eu={m.autor === "denunciante" ? "1" : "0"}>
                <p className="dn-msg-h">
                  {m.autor === "comite" ? "Comitê de Ética" : "Você"} · {fmtDt(m.criada_em)}
                </p>
                <p className="dn-msg-t">{m.mensagem}</p>
              </div>
            ))}
          </div>
        )}

        <div>
          <label className="dn-lab" htmlFor="dn-msg">Escrever ao comitê</label>
          <textarea
            id="dn-msg" className="dn-in dn-ta" value={texto}
            onChange={(e) => setTexto(e.target.value)}
            placeholder="Sua mensagem…"
          />
        </div>
        <button className="dn-btn dn-btn-w" onClick={enviar} disabled={enviando || !texto.trim()}>
          <Send className="h-4 w-4" /> {enviando ? "Enviando…" : "Enviar mensagem"}
        </button>
      </div>
    </section>
  );
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
