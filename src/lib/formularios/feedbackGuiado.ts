// É o "feedback guiado" (o formulário de feedback de liderança)?
//
// O Painel Gerencial tem dois diagnósticos por IA (15/09/2026): o dos
// feedbacks, que cruza liderados ↔ líder, e o genérico, que lê qualquer
// formulário. A escolha é feita aqui, pelos enunciados — os mesmos padrões
// que a Edge Function diagnostico-feedback-ia usa em destinoDaPergunta()
// (_shared/diagnostico-feedback.ts). Mudou lá, muda aqui.
import type { Pergunta } from "@/pages/central-servicos/Formularios";

const semAcento = (v: unknown) => String(v ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "");
const tituloNormalizado = (t: unknown) => semAcento(t).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

const PADROES_LIDERADOS = [
  /como voce acredita que esta o seu trabalho/,
  /maior dificuldade/,
  /precisa (?:mais )?(?:da|de) (?:sua )?lideranca/,
  /sente que precisa melhorar/,
];
const PADROES_LIDER = [
  /visao do liderado/,
  /nivel de entrega/,
  /nivel de comprometimento/,
  /principal necessidade de desenvolvimento/,
  /profissional hoje esta/,
  /ponto forte principal/,
  /ponto de melhoria principal/,
];

/** Feedback guiado = tem pelo menos uma pergunta de cada eixo (equipe e liderança). */
export function ehFeedbackGuiado(perguntas: Pergunta[] | null | undefined): boolean {
  const titulos = (perguntas ?? []).map(p => tituloNormalizado(p.titulo)).filter(Boolean);
  const temLiderados = titulos.some(t => PADROES_LIDERADOS.some(re => re.test(t)));
  const temLider = titulos.some(t => PADROES_LIDER.some(re => re.test(t)));
  return temLiderados && temLider;
}
