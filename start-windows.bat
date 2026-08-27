@echo off
cd /d "%~dp0"
python serve.py
if errorlevel 1 (
  echo.
  echo Python 3 was not found. Install it from https://www.python.org/downloads/
  echo and tick "Add Python to PATH" during setup, then run this again.
  echo.
  echo Or open index.html in Firefox, which allows local storage on file:// pages.
  pause
)
