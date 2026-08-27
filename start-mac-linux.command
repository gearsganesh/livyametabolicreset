#!/bin/sh
cd "$(dirname "$0")" || exit 1
if command -v python3 >/dev/null 2>&1; then
  exec python3 serve.py
elif command -v python >/dev/null 2>&1; then
  exec python serve.py
else
  echo "Python 3 is not installed. Install it from https://www.python.org/downloads/ and run this again."
  echo "Or open index.html in Firefox, which allows local storage on file:// pages."
  read -r _
fi
