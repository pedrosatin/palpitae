#!/usr/bin/env bash
# Roda só os testes do Vitest afetados pelo que mudou desde <base>.
# Uso no PR (Deploy Web): bash scripts/test-changed.sh HEAD^1
# Argumentos depois da base vão para o Vitest (por exemplo --reporter=verbose).
#
# Um teste roda quando importa, direta ou indiretamente, um arquivo alterado.
# Os arquivos de `forceRerunTriggers` (vite.config.ts), entre eles este script,
# rodam a suíte inteira.
#
# O grafo do Vitest não segue imports com `?raw`, `import.meta.glob` com
# `query: '?raw'` nem leituras por `node:fs`. Os testes que leem arquivos assim
# rodam sempre: a busca abaixo os encontra pelo próprio código.
set -euo pipefail

base="${1:?uso: test-changed.sh <commit-base> [opções do vitest]}"
shift
cd "$(dirname "$0")/.."
repo="$(git rev-parse --show-toplevel)"

# Os resultados do git passam por arquivos, e não por `< <(...)`: assim uma
# falha do git (base inválida, histórico curto) interrompe o script em vez de
# virar uma lista vazia.
diff_file="$(mktemp)"
grep_file="$(mktemp)"

# --no-renames: uma renomeação entra como exclusão e adição, e o caminho antigo
# também chega ao Vitest (renomear `.env.production` ainda dispara a suíte).
git -c core.quotePath=false diff --no-renames --name-only -z "$base...HEAD" >"$diff_file"
mapfile -d '' -t changed <"$diff_file"
changed=("${changed[@]/#/$repo/}")

# git grep sai com 1 quando nada casa; acima disso é erro.
grep_status=0
git grep -z -lE '\?raw|import\.meta\.glob|readFileSync|readFile\(|import\.meta\.url' \
  -- '*.test.ts' '*.test.tsx' ':!tests/e2e' >"$grep_file" || grep_status=$?
if [ "$grep_status" -gt 1 ]; then
  rm -f "$diff_file" "$grep_file"
  exit "$grep_status"
fi
mapfile -d '' -t outside_graph <"$grep_file"
rm -f "$diff_file" "$grep_file"

echo "Arquivos alterados desde $base: ${#changed[@]}"
echo "Testes que leem arquivos fora do grafo de imports: ${#outside_graph[@]}"
exec npx vitest related --run "$@" "${changed[@]}" "${outside_graph[@]}"
