/**
 * English language pack (moved from entityStopwords.ts).
 */

export const STOPWORDS: readonly string[] = [
  // articles / determiners / pronouns
  'the', 'a', 'an', 'this', 'that', 'these', 'those', 'it', 'its',
  'i', 'me', 'my', 'we', 'us', 'our', 'you', 'your', 'he', 'she', 'they', 'them',
  // discourse markers / sentence starters
  'let', 'now', 'so', 'well', 'sure', 'great', 'thanks', 'thank', 'please',
  'yes', 'yeah', 'no', 'ok', 'okay', 'hi', 'hello', 'hey',
  'actually', 'basically', 'really', 'just', 'also', 'too', 'anyway',
  'first', 'second', 'third', 'then', 'next', 'finally', 'last',
  'here', 'there', 'where', 'when', 'what', 'why', 'how', 'which', 'who',
  'done', 'fixed', 'update', 'updated', 'note', 'todo', 'fixme',
  'perfect', 'exactly', 'right', 'correct', 'wrong', 'true', 'false',
  'good', 'bad', 'nice', 'cool', 'awesome', 'amazing', 'interesting',
  'excellent', 'wonderful', 'fantastic', 'summary', 'return', 'returns',
  'skip', 'skipping',
  'sorry', 'oops', 'wow', 'hmm', 'ah', 'oh', 'eh',
  // generic verbs commonly capitalized at sentence start
  'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'do', 'does', 'did', 'have', 'has', 'had',
  'can', 'could', 'will', 'would', 'shall', 'should', 'may', 'might', 'must',
  'get', 'got', 'see', 'look', 'check', 'try', 'tried', 'make', 'made',
  'use', 'used', 'using', 'run', 'ran', 'go', 'going', 'gone',
  'start', 'started', 'stop', 'stopped', 'wait', 'waiting',
  'need', 'needs', 'want', 'wants', 'seems', 'looks', 'works', 'working',
  // connectors / misc
  'and', 'or', 'but', 'if', 'else', 'not', 'nor', 'for', 'with', 'without',
  'from', 'into', 'onto', 'upon', 'over', 'under', 'again', 'still',
  'all', 'any', 'both', 'each', 'few', 'more', 'most', 'other', 'some', 'such',
  'own', 'same', 'very', 'much', 'many', 'lot', 'lots',
  'new', 'old', 'big', 'small', 'long', 'short', 'high', 'low',
  'one', 'two', 'three', 'number', 'part', 'way', 'thing', 'things',
  'something', 'anything', 'nothing', 'everything', 'someone', 'anyone',
  'vs', 'etc', 'eg', 'ie', 'via', 'per',
];

export const COMMON_WORDS: readonly string[] = [
  'time', 'times', 'day', 'days', 'week', 'month', 'year', 'today', 'tomorrow',
  'yesterday', 'morning', 'afternoon', 'evening', 'night', 'hour', 'minute',
  'people', 'person', 'man', 'woman', 'user', 'users', 'team', 'teams',
  'world', 'life', 'hand', 'hands', 'eye', 'eyes', 'head', 'face',
  'place', 'places', 'home', 'house', 'room', 'side', 'end', 'back', 'front',
  'point', 'points', 'line', 'lines', 'area', 'areas', 'level', 'levels',
  'case', 'cases', 'example', 'examples', 'problem', 'problems', 'issue', 'issues',
  'question', 'questions', 'answer', 'answers', 'idea', 'ideas', 'reason', 'reasons',
  'name', 'names', 'word', 'words', 'text', 'texts', 'file', 'files',
  'data', 'info', 'value', 'values', 'result', 'results', 'output', 'input',
  'state', 'states', 'status', 'type', 'types', 'kind', 'kinds', 'form', 'forms',
  'step', 'steps', 'stage', 'stages', 'phase', 'phases', 'process', 'processes',
  'system', 'systems', 'model', 'models', 'mode', 'modes', 'version', 'versions',
  'work', 'works', 'job', 'jobs', 'task', 'tasks', 'project', 'projects',
  'change', 'changes', 'error', 'errors', 'warning', 'warnings', 'message', 'messages',
  'list', 'lists', 'set', 'sets', 'map', 'item', 'items', 'entry', 'entries',
  'option', 'options', 'setting', 'settings', 'config', 'configs',
  'test', 'tests', 'build', 'builds', 'release', 'releases', 'feature', 'features',
  'code', 'codes', 'source', 'sources', 'content', 'contents', 'context', 'contexts',
  'memory', 'memories', 'query', 'queries', 'search', 'searches',
  'fact', 'course', 'moment', 'sense', 'bit', 'rest', 'top', 'bottom',
  'left', 'center', 'middle', 'half', 'whole', 'total', 'full', 'empty',
  'open', 'close', 'closed', 'public', 'private', 'local', 'remote',
  'default', 'current', 'previous', 'latest', 'recent', 'future', 'past',
  'following', 'above', 'below', 'between', 'inside', 'outside',
];
