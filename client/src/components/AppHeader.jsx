import { colors, radius, space, type } from "../styles/tokens";

export function AppHeader({ hasResults, view, onViewChange, tabMeta, degradedSet, degradedReason }) {
  return (
    <header
      style={{
        position: "sticky",
        top: 0,
        zIndex: 100,
        background: "rgba(250,247,243,0.88)",
        backdropFilter: "blur(12px)",
        borderBottom: `1px solid ${colors.border}`,
        padding: `${space.sm + 2}px ${space.xxl}px`,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 10,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div
          style={{
            width: 32,
            height: 32,
            borderRadius: radius.sm,
            background: colors.accent,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontFamily: "'IBM Plex Mono',monospace",
            fontWeight: 700,
            fontSize: type.sizeSm,
            color: "#fff",
            letterSpacing: "-0.5px",
          }}
        >
          NS
        </div>
        <div>
          <div style={{ fontFamily: "'Playfair Display',serif", fontWeight: 900, fontSize: 17, letterSpacing: "-0.02em", lineHeight: 1.1, color: colors.text }}>NakedSaaS</div>
          <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 9, color: colors.textMuted, letterSpacing: "0.06em", textTransform: "uppercase" }}>Strip any SaaS to its true cost</div>
        </div>
      </div>
      {hasResults && (
        <div style={{ display: "flex", border: `1px solid ${colors.borderStrong}`, borderRadius: radius.sm, overflow: "hidden", flexWrap: "wrap" }} role="tablist" aria-label="Report pillars">
          {tabMeta.map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={view === id}
              onClick={() => onViewChange(id)}
              style={{
                padding: "6px 16px",
                border: "none",
                borderRight: `1px solid ${colors.borderStrong}`,
                background: view === id ? colors.accent : "transparent",
                color: view === id ? "#fff" : colors.textSecondary,
                fontFamily: "'IBM Plex Mono',monospace",
                fontSize: 11,
                fontWeight: 600,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              {label}
                {degradedSet.has(id) && (
                <span title={degradedReason(id)} style={{ width: 7, height: 7, borderRadius: "50%", background: view === id ? "#fff" : colors.accent, display: "inline-block" }} />
              )}
            </button>
          ))}
        </div>
      )}
      <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: type.sizeXs, color: colors.textMuted, display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ width: 5, height: 5, borderRadius: "50%", background: colors.success }} />
        TinyFish Web Agent
      </div>
    </header>
  );
}
