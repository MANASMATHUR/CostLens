import { Panel } from "./ui/Panel";
import { SectionLabel } from "./ui/SectionLabel";
import { fmt } from "../utils/formatting";
import { colors, space, type } from "../styles/tokens";

export function ReportSummary({ report }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: space.md }}>
      <Panel style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <div
          style={{
            width: 52,
            height: 52,
            borderRadius: 8,
            background: colors.text,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontFamily: "'Playfair Display',serif",
            fontWeight: 900,
            fontSize: type.sizeDisplay,
            color: "#fff",
            flexShrink: 0,
          }}
        >
          {report.target.logo}
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontFamily: "'Playfair Display',serif", fontWeight: 900, fontSize: type.sizeDisplay, overflow: "hidden", textOverflow: "ellipsis" }}>
            {report.target.name}
          </div>
          <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: type.sizeMd, color: colors.textMuted }}>{report.target.url}</div>
          <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: type.sizeSm, color: colors.textMuted, marginTop: 2 }}>
            Scanned {report.platformsScanned.length} sources · {new Date(report.scannedAt).toLocaleDateString()}
          </div>
        </div>
      </Panel>

      <Panel>
        <SectionLabel style={{ marginBottom: 6 }}>Data Completeness</SectionLabel>
        <div style={{ fontFamily: "'Playfair Display',serif", fontWeight: 800, fontSize: 26, color: report.quality.completenessScore < 70 ? colors.accent : colors.text }}>
          {report.quality.completenessScore}%
        </div>
        <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: type.sizeSm, color: colors.textMuted, marginTop: 4 }}>
          {report.quality.partialData ? "Partial scan quality detected" : "High confidence structure"}
        </div>
      </Panel>

      <Panel>
        <SectionLabel style={{ marginBottom: 6 }}>Trust Summary</SectionLabel>
        <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: type.sizeMd, color: colors.textSecondary, lineHeight: 1.5 }}>
          {report.quality.degradedPillars.length > 0 ? `Degraded pillars: ${report.quality.degradedPillars.join(", ")}` : "All pillars healthy"}
        </div>
        <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: type.sizeSm, color: colors.textMuted, marginTop: 6 }}>
          Est. Revenue Signal: {fmt(report.infraCost.revenueEstimate)}/mo
        </div>
      </Panel>
    </div>
  );
}
