// Matches a scan target against a consent record's scope text.
//
// Scope entries are comma/semicolon/newline separated. Each entry may be:
//   - an exact IP or domain             ("10.0.0.5", "shop.example.nl")
//   - an IPv4 CIDR range                ("10.0.0.0/24")
//   - a wildcard subdomain              ("*.example.nl")
//   - a bare domain, which also covers its subdomains
//     ("example.nl" covers "example.nl" and "shop.example.nl")
//
// IPv6 CIDR matching is not implemented (see docs/gvm-integration.md).

function normalizeScopeEntries(scope) {
  return String(scope || '')
    .split(/[,;\n]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

function ipToInt(ip) {
  const parts = String(ip).split('.');
  if (parts.length !== 4) return null;
  const nums = parts.map(Number);
  if (nums.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) return null;
  return ((nums[0] << 24) | (nums[1] << 16) | (nums[2] << 8) | nums[3]) >>> 0;
}

function isIpInCidr(ip, cidr) {
  const [range, bitsStr] = cidr.split('/');
  const bits = Number(bitsStr);
  if (!Number.isInteger(bits) || bits < 0 || bits > 32) return false;

  const ipInt = ipToInt(ip);
  const rangeInt = ipToInt(range);
  if (ipInt === null || rangeInt === null) return false;

  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return (ipInt & mask) === (rangeInt & mask);
}

function isTargetCoveredByScope(target, scope) {
  const normalizedTarget = String(target || '').trim().toLowerCase();
  if (!normalizedTarget) return false;

  const entries = normalizeScopeEntries(scope);

  return entries.some((entry) => {
    if (entry === normalizedTarget) return true;

    if (entry.includes('/')) {
      return isIpInCidr(normalizedTarget, entry);
    }

    if (entry.startsWith('*.')) {
      const base = entry.slice(2);
      return normalizedTarget === base || normalizedTarget.endsWith(`.${base}`);
    }

    // Bare domain also covers its subdomains.
    return normalizedTarget.endsWith(`.${entry}`);
  });
}

module.exports = {
  normalizeScopeEntries,
  isTargetCoveredByScope,
  isIpInCidr,
  ipToInt,
};
