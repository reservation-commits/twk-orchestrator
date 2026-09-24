@echo off
set NODE_DIR=C:\Users\bianc\AppData\Local\nodejs-portable\node-v24.15.0-win-x64
set PATH=%NODE_DIR%;%PATH%
cd /d "%~dp0"
echo Starting TWK DB Architect...
set NODE_OPTIONS=--max-old-space-size=4096
npm run dev
