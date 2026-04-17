export function isNativeServerSetupAvailable(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  const cap = (window as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  return typeof cap?.isNativePlatform === "function" && cap.isNativePlatform();
}

export function openNativeServerSetup(): boolean {
  if (!isNativeServerSetupAvailable()) {
    return false;
  }
  window.location.href = "cuedesk://server-config";
  return true;
}
