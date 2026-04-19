param(
  [string]$ProjectWindowsPath = (Get-Location).Path,
  [string]$Distro = "Ubuntu",
  [switch]$InstallWSL,
  [switch]$SkipBackfill
)

$ErrorActionPreference = "Stop"

function Write-Step {
  param([string]$Message)
  Write-Host ""
  Write-Host "==> $Message" -ForegroundColor Cyan
}

function Ensure-Command {
  param([string]$Name)
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Missing command: $Name"
  }
}

Ensure-Command "wsl"

if ($InstallWSL) {
  Write-Step "Installing WSL ($Distro). This may require reboot."
  wsl --install -d $Distro
  Write-Host ""
  Write-Host "WSL install command executed. If prompted, reboot Windows and re-run this script without -InstallWSL." -ForegroundColor Yellow
  exit 0
}

Write-Step "Checking installed WSL distros"
$distros = wsl -l -q | ForEach-Object { $_.Trim() } | Where-Object { $_ -ne "" }
if (-not ($distros -contains $Distro)) {
  throw "WSL distro '$Distro' not found. Run: wsl --install -d $Distro"
}

Write-Step "Converting project path to WSL path"
$projectWslPath = (wsl -d $Distro -- wslpath -a "$ProjectWindowsPath").Trim()
if ([string]::IsNullOrWhiteSpace($projectWslPath)) {
  throw "Unable to resolve WSL path for '$ProjectWindowsPath'"
}
Write-Host "Project path in WSL: $projectWslPath"

$skipBackfillInt = if ($SkipBackfill) { 1 } else { 0 }

Write-Step "Running setup inside WSL distro '$Distro'"
$bashScript = @"
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive

echo "[1/8] Updating apt packages"
sudo apt update -y
sudo apt upgrade -y
sudo apt install -y curl git build-essential

echo "[2/8] Installing nvm (if missing) and Node 22"
if [ ! -d "\$HOME/.nvm" ]; then
  curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
fi
export NVM_DIR="\$HOME/.nvm"
[ -s "\$NVM_DIR/nvm.sh" ] && . "\$NVM_DIR/nvm.sh"
nvm install 22
nvm use 22

echo "[3/8] Setting timezone env to Asia/Kolkata"
if ! grep -q '^export TZ=Asia/Kolkata$' "\$HOME/.bashrc"; then
  echo 'export TZ=Asia/Kolkata' >> "\$HOME/.bashrc"
fi
export TZ=Asia/Kolkata

echo "[4/8] Entering project"
cd "$projectWslPath"

echo "[5/8] Installing npm dependencies"
npm install

echo "[6/8] Ensuring .env"
if [ ! -f .env ]; then
  printf 'DATABASE_URL="file:./prisma/dev.db"\n' > .env
fi

echo "[7/8] Prisma setup"
npx prisma generate
npx prisma db push

if [ "$skipBackfillInt" = "0" ]; then
  echo "[7b/8] Running backfill scripts"
  npm run backfill:business-day-keys || true
  npm run backfill:daily-closing || true
  npm run backfill:expenses || true
fi

echo "[8/8] Building app"
npm run build

echo ""
echo "Setup complete."
echo "Start command:"
echo "  cd $projectWslPath && npm run start"
echo "LAN IP check:"
echo "  hostname -I"
"@

wsl -d $Distro -- bash -lc $bashScript

Write-Host ""
Write-Host "Done. Start server with: cd $projectWslPath && npm run start" -ForegroundColor Green
