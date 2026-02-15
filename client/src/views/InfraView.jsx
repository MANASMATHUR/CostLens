import { Panel } from "../components/ui/Panel";
import { SectionLabel } from "../components/ui/SectionLabel";
import { DegradedBanner } from "../components/ui/DegradedBanner";
import { ExpandableRow } from "../components/ui/ExpandableRow";
import { MarginGauge, CostBar } from "../components/InfraVisualizations";
import { ConfBadge } from "../components/Badges";
import { fmt, fmtRange } from "../utils/formatting";
import { colors, space, type } from "../styles/tokens";

export function InfraView({ report, degraded, degradedReason, expandedInfra, setExpandedInfra }) {
  const items = report.infraCost.breakdown;
  const signals = report.infraCost.signals;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: space.lg, animation: "fadeUp 0.4s ease" }}>
      {degraded && <DegradedBanner title={degradedReason("infra")} message="Infra estimates are confidence-degraded for this run. Treat numbers as directional." />}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(260px,1fr))", gap: space.md }}>
        <Panel style={{ padding: 24 }}>
          <SectionLabel style={{ marginBottom: 12 }}>Estimated Gross Margin</SectionLabel>
          <MarginGauge {...report.infraCost.grossMargin} />
        </Panel>
        <Panel style={{ padding: 24 }}>
          <SectionLabel style={{ marginBottom: 12 }}>Monthly Infrastructure Cost</SectionLabel>
          <div style={{ fontFamily: "'Playfair Display',serif", fontWeight: 900, fontSize: 32, color: colors.accent, marginBottom: 4 }}>
            {fmtRange(report.infraCost.monthlyEstimate.low, report.infraCost.monthlyEstimate.high)}
          </div>
          <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: type.sizeMd, color: colors.textSecondary, marginBottom: 12 }}>Mid estimate: {fmt(report.infraCost.monthlyEstimate.mid)}/mo</div>
          <SectionLabel style={{ marginBottom: 6 }}>Per-user Cost</SectionLabel>
          <div style={{ fontFamily: "'Playfair Display',serif", fontWeight: 700, fontSize: 20 }}>
            ${report.infraCost.perUserEstimate.low}–${report.infraCost.perUserEstimate.high}
            <span style={{ fontSize: 13, color: colors.textMuted }}>/user/mo</span>
          </div>
        </Panel>
      </div>

      <Panel style={{ padding: 24 }}>
        <SectionLabel style={{ marginBottom: 14 }}>Infrastructure Cost Breakdown</SectionLabel>
        {items.length > 0 ? <CostBar items={items} /> : <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: type.sizeSm, color: colors.textMuted }}>No breakdown data available for this scan.</div>}
      </Panel>

      <div style={{ display: "flex", flexDirection: "column", gap: space.sm }}>
        {items.length === 0 && <Panel><div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: type.sizeSm, color: colors.textMuted }}>Detailed line items were unavailable for this run.</div></Panel>}
        {items.map((item, i) => (
          <ExpandableRow
            key={`infra-${i}`}
            title={item.category}
            badge={<ConfBadge level={item.confidence} />}
            expanded={expandedInfra === i}
            onToggle={() => setExpandedInfra(expandedInfra === i ? null : i)}
            titleRight={<span style={{ fontFamily: "'IBM Plex Mono',monospace", fontWeight: 700, fontSize: 14, color: colors.accent }}>{item.estimate}</span>}
            accessibilityLabel={`Toggle evidence for ${item.category}`}
          >
            <strong style={{ color: "#1A1815" }}>Evidence:</strong> {item.evidence}
          </ExpandableRow>
        ))}
      </div>

      <Panel>
        <SectionLabel>Detection Signals</SectionLabel>
        {signals.length === 0 && <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: type.sizeSm, color: colors.textMuted }}>No detection signals were captured.</div>}
        {signals.map((s, i) => (
          <div
            key={`signal-${i}`}
            style={{
              display: "flex",
              gap: 8,
              padding: "6px 0",
              borderBottom: i < signals.length - 1 ? "1px solid #F0EDE8" : "none",
              fontFamily: "'IBM Plex Mono',monospace",
              fontSize: type.sizeMd,
              color: colors.textSecondary,
            }}
          >
            <span>{s.icon}</span>
            <span>{s.text}</span>
          </div>
        ))}
      </Panel>
    </div>
  );
}
