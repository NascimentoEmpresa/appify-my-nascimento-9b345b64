// Tipos compartilhados do Painel Gerencial dos formulários. Ficam num arquivo
// só porque a página, os cálculos e os gráficos falam todos deles — deixá-los
// dentro da tela obrigava a importar a tela inteira para usar um tipo.

// Uma resposta de formulário, como o painel a lê de CS_FORM_RESPOSTAS.
export interface Resp { id: string; formulario_id: string; enviado_em: string; respondente_nome?: string | null; criado_por?: string | null; setor?: string | null; respondente_cadastro?: Record<string, any> | null; itens: Record<string, any>; }

// O mapeamento pergunta→indicador: para cada indicador, o id da pergunta que o
// alimenta ('dimensoes' é a exceção, guarda uma lista de ids).
export type Mapa = Record<string, any>;  // singles = id da pergunta; dimensoes = string[]

// Como o usuário escolheu ver um gráfico.
export type Viz = "barras" | "colunas" | "pizza" | "rosca" | "linha" | "area";

// Item de gráfico: além da contagem, QUEM está por trás dela — é o que o
// tooltip mostra ao passar o mouse. `quem` já vem pronto para exibição.
export interface ItemDist { nome: string; completo: string; n: number; quem: string[] }

// Uma liderança no ranking da aba Liderança.
export type Lider = { lider: string; indice: number; n: number; evol: number | null };

// Um agrupamento (setor, liderança…) com média e evolução, na aba Alinhamento.
export type Grupo = { chave: string; media: number; n: number; evol: number | null };
