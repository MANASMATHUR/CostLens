export function normalizePillarMeta(value, fallbackPillar) {
  const meta = value && typeof value === "object" ? value._meta : null;
  return {
    pillar: meta?.pillar || fallbackPillar,
    extractedAt: meta?.extractedAt || new Date().toISOString(),
    sourceFamilies: Array.isArray(meta?.sourceFamilies) ? [...new Set(meta.sourceFamilies)] : [],
    sourceCount: Number.isFinite(Number(meta?.sourceCount))
      ? Number(meta.sourceCount)
      : Array.isArray(meta?.sourceFamilies)
        ? meta.sourceFamilies.length
        : 0,
  };
}
