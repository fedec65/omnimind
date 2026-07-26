/**
 * Portuguese language pack.
 */

export const STOPWORDS: readonly string[] = [
  // artigos / pronomes / determinantes
  'o', 'a', 'os', 'as', 'um', 'uma', 'uns', 'umas',
  'este', 'esta', 'estes', 'estas', 'esse', 'essa', 'esses', 'essas', 'aquele', 'aquela',
  'eu', 'tu', 'ele', 'ela', 'nós', 'vós', 'eles', 'elas', 'você', 'vocês',
  'meu', 'teu', 'seu', 'minha', 'tua', 'sua', 'nosso', 'nossa', 'vosso', 'vossa',
  // conjunções / preposições
  'e', 'ou', 'mas', 'porém', 'porque', 'pois', 'que', 'como', 'se',
  'de', 'do', 'da', 'dos', 'das', 'a', 'ao', 'à', 'aos', 'às', 'em', 'no', 'na', 'nos', 'nas',
  'com', 'sem', 'por', 'para', 'entre', 'sobre', 'sob', 'desde', 'até', 'durante', 'mediante',
  // advérbios / sentence starters
  'muito', 'bem', 'mal', 'melhor', 'pior', 'mais', 'menos', 'pouco', 'demais',
  'agora', 'então', 'depois', 'antes', 'finalmente', 'já', 'ainda',
  'sempre', 'nunca', 'jamais', 'vezes', 'talvez', 'quase', 'aproximadamente',
  'todo', 'toda', 'todos', 'todas', 'cada', 'outro', 'outra', 'outros', 'outras', 'mesmo', 'mesma',
  'aqui', 'aí', 'ali', 'lá', 'onde', 'quando', 'como', 'quanto', 'qual', 'quais',
  'pois', 'assim', 'também', 'tampouco', 'além', 'inclusive', 'entanto',
  'sim', 'não', 'ok', 'obrigado', 'obrigada', 'olá', 'oi',
  'perfeito', 'exato', 'correto', 'certo', 'errado', 'verdadeiro', 'falso',
  'excelente', 'ótimo', 'fantástico', 'interessante', 'notável',
  // verbos comuns
  'é', 'são', 'era', 'eram', 'ser', 'sido', 'sendo', 'seja', 'sejam', 'foi', 'foram',
  'tem', 'têm', 'tinha', 'ter', 'tido', 'há', 'havia',
  'faz', 'fazem', 'fazer', 'feito', 'fazendo', 'fez',
  'pode', 'podem', 'poder', 'poderia', 'podia', 'deve', 'devem', 'dever', 'deveria',
  'quer', 'querem', 'querer', 'queria', 'gostaria',
  'vê', 'veem', 'ver', 'visto', 'olha', 'olhar',
  'tenta', 'tentam', 'tentar', 'tentado', 'usa', 'usam', 'usar', 'usado', 'usando',
  'começa', 'começam', 'começar', 'começado', 'inicia', 'iniciar', 'termina', 'terminado',
  'verifica', 'verificar', 'confere', 'conferir', 'checa', 'checar',
  'precisa', 'precisam', 'necessário', 'necessária', 'falta',
  'parece', 'parecem', 'resulta', 'funciona', 'funcionam', 'vai', 'vão', 'ir',
  // números / vários
  'um', 'dois', 'três', 'primeiro', 'primeira', 'segundo', 'segunda', 'terceiro', 'último', 'última',
  'número', 'parte', 'partes', 'modo', 'modos', 'maneira', 'maneiras', 'forma', 'formas', 'coisa', 'coisas',
  'algo', 'nada', 'alguém', 'ninguém', 'qualquer', 'vários', 'várias',
  'exemplo', 'exemplos', 'caso', 'casos', 'tipo', 'tipos', 'classe', 'classes',
  'vs', 'etc', 'ex', 'pág',
];

export const COMMON_WORDS: readonly string[] = [
  'tempo', 'tempos', 'dia', 'dias', 'semana', 'semanas', 'mês', 'meses', 'ano', 'anos',
  'hoje', 'amanhã', 'ontem', 'tarde', 'noite', 'hora', 'horas', 'minuto', 'momento', 'momentos',
  'pessoa', 'pessoas', 'homem', 'mulher', 'gente', 'usuário', 'usuários', 'cliente', 'clientes',
  'mundo', 'vida', 'mão', 'mãos', 'olho', 'olhos', 'cabeça', 'cara', 'rosto',
  'lugar', 'lugares', 'sítio', 'sítios', 'casa', 'lado', 'lados', 'fim', 'final', 'começo',
  'ponto', 'pontos', 'linha', 'linhas', 'zona', 'zonas', 'área', 'áreas', 'nível', 'níveis',
  'problema', 'problemas', 'questão', 'questões', 'razão', 'razões', 'motivo', 'motivos',
  'pergunta', 'perguntas', 'resposta', 'respostas', 'ideia', 'ideias',
  'nome', 'nomes', 'palavra', 'palavras', 'texto', 'textos', 'documento', 'documentos',
  'dado', 'dados', 'informação', 'informações', 'valor', 'valores', 'resultado', 'resultados',
  'estado', 'estados', 'situação', 'situações', 'forma', 'formas',
  'passo', 'passos', 'fase', 'fases', 'etapa', 'etapas', 'processo', 'processos', 'procedimento',
  'sistema', 'sistemas', 'modelo', 'modelos', 'modo', 'modos', 'versão', 'versões',
  'trabalho', 'trabalhos', 'tarefa', 'tarefas', 'projeto', 'projetos', 'atividade', 'atividades',
  'mudança', 'mudanças', 'modificação', 'modificações', 'alteração', 'alterações',
  'erro', 'erros', 'aviso', 'avisos', 'advertência', 'mensagem', 'mensagens',
  'lista', 'listas', 'elemento', 'elementos', 'entrada', 'entradas', 'item', 'itens',
  'opção', 'opções', 'ajuste', 'ajustes', 'configuração',
  'prova', 'provas', 'teste', 'testes', 'verificação', 'controle', 'controles',
  'código', 'códigos', 'fonte', 'fontes', 'conteúdo', 'conteúdos', 'contexto', 'contextos',
  'memória', 'memórias', 'busca', 'buscas', 'pesquisa', 'pesquisas', 'pedido', 'pedidos', 'consulta',
  'fato', 'fatos', 'curso', 'sentido', 'resto', 'cima', 'baixo', 'dentro', 'fora',
  'esquerda', 'direita', 'centro', 'meio', 'metade', 'inteiro', 'inteira', 'total', 'cheio', 'vazio',
  'aberto', 'fechado', 'público', 'privado', 'local', 'remoto',
  'padrão', 'atual', 'anterior', 'próximo', 'próxima', 'seguinte', 'seguintes', 'recente',
];
