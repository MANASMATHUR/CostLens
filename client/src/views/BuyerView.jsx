import { Panel } from "../components/ui/Panel";
import { SectionLabel } from "../components/ui/SectionLabel";
import { DegradedBanner } from "../components/ui/DegradedBanner";
import { colors, space, type } from "../styles/tokens";

export function BuyerView({ report, degraded, degradedReason }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: space.lg, animation: "fadeUp 0.4s ease" }}>
      {degraded && <DegradedBanner title={degradedReason("buyer")} message="Buyer-cost findings are incomplete for this scan. Confirm key plan details manually." />}

      <Panel style={{ display: "flex", alignItems: "center", gap: space.md, background: colors.accentSoft, borderColor: "#C41E3A25" }}>
        <span style={{ fontSize: 22 }}>⚠️</span>
        <div>
          <div style={{ fontFamily: "'Playfair Display',serif", fontWeight: 700, fontSize: 15 }}>The price on the page is rarely the price you pay</div>
          <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: type.sizeSm, color: colors.textSecondary }}>
            Hidden costs can inflate {report.target.name}&apos;s listed price by 40-55% for typical teams.
          </div>
        </div>
      </Panel>

      <div>
        <SectionLabel>Plan-by-Plan True Cost Analysis</SectionLabel>
        {report.buyerCost.plans.length === 0 && (
          <Panel>
            <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: type.sizeSm, color: colors.textMuted }}>No plan-level details were captured for this scan.</div>
          </Panel>
        )}
        {report.buyerCost.plans.map((plan, i) => (
          <Panel key={`plan-${i}`} style={{ marginBottom: space.sm }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <span style={{ fontFamily: "'Playfair Display',serif", fontWeight: 900, fontSize: 18 }}>{plan.name}</span>
                <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: type.sizeMd, color: colors.textMuted }}>Listed: {plan.listed}</span>
              </div>
              <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontWeight: 700, fontSize: 15, color: colors.accent }}>Actual: {plan.actualMonthly}</div>
            </div>

            {plan.hiddenCosts.length > 0 && (
              <div style={{ marginBottom: 10 }}>
                <SectionLabel style={{ marginBottom: 6, color: colors.accent, fontWeight: 700 }}>Hidden Costs</SectionLabel>
                {plan.hiddenCosts.map((hc, j) => (
                  <div key={`hidden-${j}`} style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap", padding: "6px 10px", background: "#C41E3A06", borderRadius: 4, marginBottom: 3 }}>
                    <div>
                      <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: type.sizeMd, fontWeight: 600, color: colors.text }}>{hc.item}</span>
                      <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: type.sizeXs, color: colors.textMuted, marginLeft: 8 }}>{hc.note}</span>
                    </div>
                    <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: type.sizeMd, fontWeight: 700, color: colors.accent }}>{hc.cost}</span>
                  </div>
                ))}
              </div>
            )}

            <div>
              <SectionLabel style={{ marginBottom: 4 }}>Gotchas</SectionLabel>
              {plan.gotchas.length === 0 && <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: type.sizeSm, color: colors.textMuted }}>No gotchas detected.</div>}
              {plan.gotchas.map((g, j) => (
                <div key={`gotcha-${j}`} style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: type.sizeSm, color: colors.textSecondary, padding: "3px 0", display: "flex", gap: 6 }}>
                  <span style={{ color: colors.accent, flexShrink: 0 }}>•</span>
                  {g}
                </div>
              ))}
            </div>
          </Panel>
        ))}
      </div>

      <Panel>
        <SectionLabel>Real-World TCO Scenarios</SectionLabel>
        {report.buyerCost.tcoComparison.length === 0 && <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: type.sizeSm, color: colors.textMuted }}>No TCO scenarios available.</div>}
        {report.buyerCost.tcoComparison.map((row, i) => (
          <div key={`tco-${i}`} style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr", gap: 8, padding: "10px 0", borderTop: i > 0 ? "1px solid #F0EDE8" : "none" }}>
            <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: type.sizeSm, color: colors.text }}>{row.scenario}</div>
            <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: type.sizeSm, color: colors.textMuted }}>{row.monthlyListed}/mo</div>
            <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: type.sizeSm, fontWeight: 700 }}>{row.monthlyActual}/mo</div>
            <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: type.sizeSm, fontWeight: 700, color: colors.accent }}>+{row.annualDelta}/yr</div>
          </div>
        ))}
      </Panel>

      <Panel>
        <SectionLabel>Competitor True Cost Comparison</SectionLabel>
        {report.buyerCost.competitorComparison.length === 0 && (
          <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: type.sizeSm, color: colors.textMuted }}>No competitor benchmarks available for this run.</div>
        )}
        {report.buyerCost.competitorComparison.map((c, i) => (
          <div key={`comp-${i}`} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap", padding: "10px 12px", background: i === 0 ? "#C41E3A08" : "transparent", borderRadius: 4, borderBottom: "1px solid #F0EDE8" }}>
            <div>
              <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 13, fontWeight: 700, color: i === 0 ? colors.accent : colors.text }}>{c.name}</span>
              <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: type.sizeXs, color: colors.textMuted, marginLeft: 8 }}>{c.features}</span>
            </div>
            <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 14, fontWeight: 700, color: i === 0 ? colors.accent : colors.text }}>{c.cost}</span>
          </div>
        ))}
      </Panel>
    </div>
  );
}
