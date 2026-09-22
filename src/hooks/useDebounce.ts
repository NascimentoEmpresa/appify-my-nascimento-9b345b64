import { useEffect, useState } from "react";

/**
 * Atrasa a propagação de um valor até ele parar de mudar por `atrasoMs`.
 *
 * Criado em 21/09/2026, depois que o Postgres de produção reiniciou sozinho por
 * esgotamento de conexões (61 em uso para 57 utilizáveis na instância Micro) e
 * o upgrade de máquina foi vetado — o alívio tem que vir de consultar menos.
 *
 * O caso que este hook resolve: campo de busca cujo texto entra direto na
 * `queryKey`. Cada tecla digitada vira uma `queryKey` nova, e cada `queryKey`
 * nova é uma ida ao banco. Digitar "MARIA" dispara cinco consultas, das quais
 * só a última interessa — as outras quatro são trabalho jogado fora que ainda
 * assim ocupa uma das 57 conexões.
 *
 * Com o debounce, só o valor final chega na `queryKey`: uma consulta por
 * palavra digitada, em vez de uma por tecla.
 *
 * 300ms é o mesmo valor que o `ColaboradorCombobox` já usava por conta própria
 * desde antes deste hook existir — rápido o bastante para o usuário não
 * perceber espera, lento o bastante para absorver a digitação.
 *
 * Não substitui o piso de caracteres (`enabled: busca.length >= 3`): o debounce
 * corta a repetição, o piso corta a busca ampla demais. Os dois somam.
 *
 * @example
 * const buscaAtrasada = useDebounce(texto.trim());
 * useQuery({ queryKey: ["algo", buscaAtrasada], enabled: buscaAtrasada.length >= 3 });
 */
export function useDebounce<T>(valor: T, atrasoMs = 300): T {
  const [atrasado, setAtrasado] = useState(valor);

  useEffect(() => {
    const t = setTimeout(() => setAtrasado(valor), atrasoMs);
    return () => clearTimeout(t);
  }, [valor, atrasoMs]);

  return atrasado;
}
