#!/bin/zsh
cd -- "${0:A:h}"
if ! command -v node >/dev/null 2>&1 && [[ -s "$HOME/.nvm/nvm.sh" ]]; then
  source "$HOME/.nvm/nvm.sh"
  nvm use 24
fi
npm run dev -- --open
