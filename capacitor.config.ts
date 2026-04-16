import type { CapacitorConfig } from "@capacitor/cli";

const serverUrl = process.env.CUEDESK_SERVER_URL || "http://192.168.1.50:3000";

const config: CapacitorConfig = {
  appId: "com.jonessaif.cuedesk",
  appName: "CueDesk",
  webDir: "out",
  server: {
    url: serverUrl,
    cleartext: true,
  },
};

export default config;
