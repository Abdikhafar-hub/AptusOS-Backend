function parseUserAgent(userAgent) {
  const ua = String(userAgent || '').trim();
  const lower = ua.toLowerCase();

  let browser = null;
  if (lower.includes('edg/')) browser = 'Edge';
  else if (lower.includes('opr/') || lower.includes('opera/')) browser = 'Opera';
  else if (lower.includes('chrome/') && !lower.includes('edg/') && !lower.includes('opr/')) browser = 'Chrome';
  else if (lower.includes('firefox/')) browser = 'Firefox';
  else if (lower.includes('safari/') && !lower.includes('chrome/')) browser = 'Safari';

  let os = null;
  if (lower.includes('windows nt')) os = 'Windows';
  else if (lower.includes('android')) os = 'Android';
  else if (lower.includes('iphone') || lower.includes('ipad') || lower.includes('ipod')) os = 'iOS';
  else if (lower.includes('mac os x')) os = 'macOS';
  else if (lower.includes('linux')) os = 'Linux';

  let device = 'Desktop';
  if (lower.includes('mobile') || lower.includes('iphone') || lower.includes('ipod') || lower.includes('android')) device = 'Mobile';
  else if (lower.includes('ipad') || lower.includes('tablet')) device = 'Tablet';

  return { browser, os, device };
}

module.exports = { parseUserAgent };

