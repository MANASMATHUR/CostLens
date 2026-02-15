import { Panel } from "../components/ui/Panel";
import { SectionLabel } from "../components/ui/SectionLabel";
import { DegradedBanner } from "../components/ui/DegradedBanner";
import { ExpandableRow } from "../components/ui/ExpandableRow";
import { ConfBadge, ComplexBadge } from "../components/Badges";
import { fmt, fmtRange } from "../utils/formatting";
import { colors, space, type } from "../styles/tokens";

export function BuildView({ report, degraded, degradedReason, expandedBuild, setExpandedBuild }) {
  const cards = [
    { label: "Total Build Cost", value: fmtRange(report.buildCost.totalEstimate.low, report.buildCost.totalEstimate.high), sub: `Mid: ${fmt(report.buildCost.totalEstimate.mid)}` },
    { label: "Timeline", value: `${report.buildCost.timeEstimate.low}–${report.buildCost.timeEstimate.high} months`, sub: `Optimal: ${report.buildCost.timeEstimate.mid} months` },
    { label: "Team Size", value: `${report.buildCost.teamSize.min}–${report.buildCost.teamSize.max} engineers`, sub: `Optimal: ${report.buildCost.teamSize.optimal}` },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: space.lg, animation: "fadeUp 0.4s ease" }}>
      {degraded && <DegradedBanner title={degradedReason("build")} message="Build estimates are based on partial signals. Validate before budgeting." />}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: space.md }}>
        {cards.map((c) => (
          <Panel key={c.label}>
            <SectionLabel style={{ marginBottom: 8 }}>{c.label}</SectionLabel>
            <div style={{ fontFamily: "'Playfair Display',serif", fontWeight: 900, fontSize: 22, color: colors.accent, lineHeight: 1 }}>{c.value}</div>
            <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: type.sizeSm, color: colors.textMuted, marginTop: 4 }}>{c.sub}</div>
          </Panel>
        ))}
      </div>

      <div>
        <SectionLabel>Module-by-Module Build Estimate</SectionLabel>
        {report.buildCost.breakdown.length === 0 && (
          <Panel>
            <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: type.sizeSm, color: colors.textMuted }}>No module-level breakdown data available.</div>
          </Panel>
        )}
        <div style={{ display: "flex", flexDirection: "column", gap: space.sm }}>
          {report.buildCost.breakdown.map((mod, i) => (
            <ExpandableRow
              key={`build-${i}`}
              title={mod.module}
              badge={<ComplexBadge level={mod.complexity} />}
              expanded={expandedBuild === i}
              onToggle={() => setExpandedBuild(expandedBuild === i ? null : i)}
              titleRight={
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontWeight: 700, fontSize: 13, color: colors.accent }}>{mod.cost}</div>
                  <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: type.sizeXs, color: colors.textMuted }}>{mod.effort}</div>
                </div>
              }
            >
              {mod.notes}
            </ExpandableRow>
          ))}
        </div>
      </div>

      <Panel>
        <SectionLabel>Detected Tech Stack</SectionLabel>
        {report.buildCost.techStack.length === 0 && <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: type.sizeSm, color: colors.textMuted }}>No tech stack signals were captured.</div>}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))", gap: space.xs + 2 }}>
          {report.buildCost.techStack.map((t, i) => (
            <div key={`tech-${i}`} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 12px", background: colors.bg, borderRadius: 4 }}>
              <div>
                <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: type.sizeXs, color: colors.textMuted }}>{t.layer}: </span>
                <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: type.sizeMd, fontWeight: 600, color: colors.text }}>{t.tech}</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                {t.detected && <span style={{ color: "#2E7D32", fontSize: 11 }}>✓</span>}
                <ConfBadge level={t.confidence} />
              </div>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}
