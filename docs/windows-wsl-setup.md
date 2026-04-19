# Windows + WSL Setup (CueDesk)

Use this on a new Windows machine to install and run CueDesk with business-day-safe timezone defaults.

## Option A: Single Script (Recommended)

From Windows PowerShell (run in project folder after clone):

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\windows-wsl-setup.ps1 -InstallWSL
```

If WSL was just installed, reboot Windows, then run:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\windows-wsl-setup.ps1
```

To skip backfill during setup:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\windows-wsl-setup.ps1 -SkipBackfill
```

## Option B: Manual Commands

### 1) Install WSL (Admin PowerShell)

```powershell
wsl --install
```

Reboot if prompted.

### 2) In WSL (Ubuntu)

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y curl git build-essential
curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
source ~/.bashrc
nvm install 22
nvm use 22
node -v
npm -v
```

### 3) Set timezone (important for business day calculations)

```bash
echo 'export TZ=Asia/Kolkata' >> ~/.bashrc
source ~/.bashrc
date
```

### 4) Project setup

```bash
cd /path/to/cuedesk
npm install
```

If `.env` does not exist:

```bash
printf 'DATABASE_URL="file:./prisma/dev.db"\n' > .env
```

Then:

```bash
npx prisma generate
npx prisma db push
npm run backfill:business-day-keys
npm run backfill:daily-closing
npm run backfill:expenses
npm run build
npm run start
```

Open:

`http://localhost:3000`

For LAN access:

```bash
hostname -I
```

Use:

`http://<LAN-IP>:3000`
