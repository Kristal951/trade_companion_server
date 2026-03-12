export const getClientIp = (req) => {
  let ip = req.headers["x-forwarded-for"]?.split(",")[0] || req.socket?.remoteAddress || null;
  if (!ip) return null;
  if (ip === "::1") ip = "127.0.0.1";
  if (ip.startsWith("::ffff:")) ip = ip.replace("::ffff:", "");
  return ip;
}

