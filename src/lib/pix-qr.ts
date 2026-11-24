export function pixQrMime(base64: string | null | undefined) {
  if (!base64 || base64.length > 500000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) return null;
  if (base64.startsWith("iVBORw0KGgo")) return "image/png";
  if (base64.startsWith("/9j/")) return "image/jpeg";
  return null;
}
