#!/usr/bin/env bash
# Roda só os testes do Vitest afetados pelo que mudou desde <base>.
# Uso no CI do PR: bash scripts/test-changed.sh HEAD^1
# Argumentos depois da base vão para o Vitest (por exemplo --reporter=verbose).
#
# Um teste roda quando importa, direta ou indiretamente, um arquivo alterado.
# Os arquivos de `forceRerunTriggers` (vite.config.ts) rodam a suíte inteira.
#
# O grafo do Vitest não segue imports com `?raw`, `import.meta.glob` com
# `query: '?raw'` nem leituras por `node:fs`. Os testes que leem arquivos assim
# rodam sempre: a busca abaixo os encontra pelo próprio código.
set -euo pipefail

base="${1:?uso: test-changed.sh <commit-base> [opções do vitest]}"
shift
cd "$(dirname "$0")/.."
repo="$(git rev-parse --show-toplevel)"

mapfile -t changed < <(git -c core.quotePath=false diff --name-only "$base...HEAD" | sed "s|^|$repo/|")
mapfile -t outside_graph < <(
  git grep -lE '\?raw|import\.meta\.glob|readFileSync|readFile\(|import\.meta\.url' \
    -- '*.test.ts' '*.test.tsx' ':!tests/e2e'
)

echo "Arquivos alterados desde $base: ${#changed[@]}"
echo "Testes que leem arquivos fora do grafo de imports: ${#outside_graph[@]}"
exec npx vitest related --run "$@" "${changed[@]}" "${outside_graph[@]}"
