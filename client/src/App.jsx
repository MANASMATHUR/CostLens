import { useState, useCallback, useRef, useEffect } from "react";
import { normalizeReport } from "./utils/report";
import { ScanOverlay } from "./components/ScanOverlay";
import { AppHeader } from "./components/AppHeader";
import { LandingView } from "./views/LandingView";
import { ReportSummary } from "./components/ReportSummary";
import { InfraView } from "./views/InfraView";
import { BuildView } from "./views/BuildView";
import { BuyerView } from "./views/BuyerView";
import { RiskView } from "./views/RiskView";
import { CompetitorView } from "./views/CompetitorView";
import { ExecutiveSummary } from "./components/ExecutiveSummary";
import { ExportBar } from "./components/ExportBar";
import { saveReport, loadReport } from "./utils/history";
import { colors, space } from "./styles/tokens";

const PILLAR_PROGRESS = {
  infra: { label: "TinyFish Agent · Infrastructure", platforms: ["Target site", "TinyFish Fetch API", "TinyFish Agent · Infra"] },
  build: { label: "TinyFish Agent · Build surface", platforms: ["Target site", "TinyFish Fetch API", "TinyFish Agent · Build"] },
  buyer: { label: "TinyFish Agent · Buyer pricing", platforms: ["Target site", "TinyFish Fetch API", "TinyFish Search API", "TinyFish Agent · Buyer"] },
  risk: { label: "TinyFish Agent · Risk audit", platforms: ["Target site", "TinyFish Fetch API", "TinyFish Agent · Risk"] },
  competitors: { label: "TinyFish Agent · Competitors", platforms: ["TinyFish Search API", "TinyFish Agent · Competitors"] },
};

const PILLAR_ORDER = ["infra", "build", "buyer", "risk", "competitors"];

export default function App() {
  const [view, setView] = useState(null);
  const [results, setResults] = useState(null);
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [action, setAction] = useState("");
  const [scanPlatforms, setScanPlatforms] = useState([]);
  const [scanError, setScanError] = useState("");
  const [url, setUrl] = useState("");
  const [expandedInfra, setExpandedInfra] = useState(null);
  const [expandedBuild, setExpandedBuild] = useState(null);
  const mainRef = useRef(null);

  useEffect(() => {
    if (results || scanError) {
      mainRef.current?.focus?.();
    }
  }, [results, scanError]);

  const POLL_INTERVAL_MS = 3500;
  const POLL_TIMEOUT_MS = 5 * 60 * 1000;
  const REQUEST_TIMEOUT_MS = 20000;

  const fetchJsonWithTimeout = useCallback(async (url, options = {}, timeoutMs = REQUEST_TIMEOUT_MS) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { ...options, signal: controller.signal });
      if (!response.ok) {
        const raw = await response.text().catch(() => "");
        let parsed = {};
        try {
          parsed = raw ? JSON.parse(raw) : {};
        } catch (_) {}
        throw new Error(parsed?.error || response.statusText || "Request failed");
      }
      try {
        return await response.json();
      } catch (_) {
        throw new Error("Server returned an invalid JSON response.");
      }
    } catch (error) {
      if (error?.name === "AbortError") {
        throw new Error("Request timed out. Please retry.");
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }, []);

  const runScan = useCallback(async () => {
    const target = url.trim();
    if (!target || scanning) return;

    setScanError("");
    setResults(null);
    setView(null);
    setScanning(true);
    setProgress(5);
    setAction("Queuing TinyFish agent runs (5 pillars)...");
    setScanPlatforms(["Target site", "TinyFish Web Agent"]);

    try {
      const startData = await fetchJsonWithTimeout("/api/investigate/async", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: target }),
      });
      const { runIds, domain, name, strategy } = startData;
      if (!runIds?.infra && !runIds?.build && !runIds?.buyer) {
        throw new Error("No run IDs returned. Check API keys and try again.");
      }

      setProgress(12);
      setAction(
        strategy === "batch"
          ? "TinyFish batch run started — polling structured outputs..."
          : "TinyFish queued 5 pillar runs — polling for completion..."
      );

      const pollStart = Date.now();
      let pollFailures = 0;
      const activePlatforms = new Set(["Target site", "TinyFish Web Agent"]);

      while (Date.now() - pollStart < POLL_TIMEOUT_MS) {
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
        let data;
        try {
          data = await fetchJsonWithTimeout("/api/investigate/async/poll", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ runIds, domain, name }),
          });
          pollFailures = 0;
        } catch (pollError) {
          pollFailures += 1;
          if (pollFailures >= 3) {
            throw new Error(pollError?.message || "Poll failed repeatedly.");
          }
          setAction(`Transient poll issue (${pollFailures}/3), retrying...`);
          continue;
        }
        if (data.status === "complete") {
          setProgress(100);
          setAction("Investigation complete");
          const reportPlatforms = data.report?.platformsScanned;
          if (Array.isArray(reportPlatforms) && reportPlatforms.length > 0) {
            setScanPlatforms(reportPlatforms);
          }
          setResults(data.report);
          saveReport(data.report);
          setView("infra");
          setScanning(false);
          return;
        }
        const runs = data.runs || {};
        const donePillars = PILLAR_ORDER.filter((p) => runs[p] === "COMPLETED" || runs[p] === "FAILED");
        for (const pillar of donePillars) {
          for (const platform of PILLAR_PROGRESS[pillar]?.platforms || []) {
            activePlatforms.add(platform);
          }
        }
        const runningPillar = PILLAR_ORDER.find((p) => runs[p] === "RUNNING" || runs[p] === "PENDING");
        const done = donePillars.length;
        setProgress(15 + Math.round((done / PILLAR_ORDER.length) * 70));
        setAction(
          runningPillar
            ? `${PILLAR_PROGRESS[runningPillar]?.label || runningPillar} — ${done}/${PILLAR_ORDER.length} pillars done`
            : `Waiting for TinyFish runs... (${done}/${PILLAR_ORDER.length} done)`
        );
        setScanPlatforms([...activePlatforms]);
      }
      throw new Error("Investigation took too long. Try again or use a simpler URL.");
    } catch (err) {
      setScanError(err?.message || "Investigation failed. Please try again.");
    } finally {
      setScanning(false);
    }
  }, [fetchJsonWithTimeout, scanning, url]);

  const handleLoadReport = useCallback((id) => {
    const report = loadReport(id);
    if (report) {
      setResults(report);
      setView("infra");
      setScanError("");
    }
  }, []);

  const handleGoHome = useCallback(() => {
    setResults(null);
    setView(null);
    setUrl("");
    setScanError("");
    setExpandedInfra(null);
    setExpandedBuild(null);
  }, []);

  const hasResults = Boolean(results);
  const R = normalizeReport(results);
  const degradedSet = new Set(R.quality.degradedPillars || []);
  const tabMeta = [
    ["infra", "Their Cost"],
    ["build", "Build Cost"],
    ["buyer", "Your Cost"],
    ["risk", "Risk"],
    ["competitors", "Competitors"],
  ];
  const degradedReason = (pillar) => {
    const scanner = R.quality?.scannerErrors?.[pillar];
    const model = R.quality?.modelErrors?.[pillar];
    if (scanner && model) return `Scanner: ${scanner} | Model: ${model}`;
    if (scanner) return `Scanner: ${scanner}`;
    if (model) return `Model: ${model}`;
    return "Lower confidence due to incomplete signals in this pillar.";
  };

  return (
    <div style={{ minHeight: "100vh", background: colors.bg, color: colors.text, fontFamily: "'Source Serif 4',Georgia,serif" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@300;400;500;600;700&family=Playfair+Display:wght@400;500;600;700;800;900&family=Source+Serif+4:ital,wght@0,300;0,400;0,500;0,600;0,700;1,400;1,500&display=swap');*{margin:0;padding:0;box-sizing:border-box}::selection{background:${colors.accent};color:#fff}::-webkit-scrollbar{width:5px}::-webkit-scrollbar-track{background:transparent}::-webkit-scrollbar-thumb{background:${colors.borderStrong};border-radius:3px}@keyframes fadeUp{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}.skip-link:focus{position:fixed;left:8px;top:8px}`}</style>

      <a href="#main-content" style={{ position: "absolute", left: -9999, zIndex: 9999, padding: "8px 16px", background: colors.accent, color: "#fff", fontFamily: "'IBM Plex Mono',monospace", fontSize: 12, textDecoration: "none", borderRadius: 4 }} className="skip-link">
        Skip to main content
      </a>

      {scanning && <ScanOverlay progress={progress} action={action} platforms={scanPlatforms} />}

      <AppHeader hasResults={hasResults} view={view} onViewChange={setView} onGoHome={handleGoHome} tabMeta={tabMeta} degradedSet={degradedSet} degradedReason={degradedReason} />

      <main id="main-content" ref={mainRef} tabIndex={-1} style={{ maxWidth: hasResults ? 1000 : undefined, width: "100%", margin: "0 auto", padding: hasResults ? `${space.xl}px ${space.xxl}px 64px` : 0 }} aria-label="Main content">
        {!hasResults && (
          <LandingView
            url={url}
            setUrl={setUrl}
            runScan={runScan}
            scanning={scanning}
            scanError={scanError}
            onClearError={() => setScanError("")}
            onLoadReport={handleLoadReport}
          />
        )}

        {hasResults && (
          <div style={{ display: "flex", flexDirection: "column", gap: space.lg }}>
            <ExportBar report={R} />
            <ReportSummary report={R} activePillar={view || "infra"} />
            <ExecutiveSummary executiveSummary={R.executiveSummary} />
            {view === "infra" && (
              <section role="tabpanel" id="panel-infra" aria-labelledby="tab-infra">
                <InfraView
                  report={R}
                  degraded={degradedSet.has("infra")}
                  degradedReason={degradedReason}
                  expandedInfra={expandedInfra}
                  setExpandedInfra={setExpandedInfra}
                />
              </section>
            )}
            {view === "build" && (
              <section role="tabpanel" id="panel-build" aria-labelledby="tab-build">
                <BuildView
                  report={R}
                  degraded={degradedSet.has("build")}
                  degradedReason={degradedReason}
                  expandedBuild={expandedBuild}
                  setExpandedBuild={setExpandedBuild}
                />
              </section>
            )}
            {view === "buyer" && (
              <section role="tabpanel" id="panel-buyer" aria-labelledby="tab-buyer">
                <BuyerView report={R} degraded={degradedSet.has("buyer")} degradedReason={degradedReason} />
              </section>
            )}
            {view === "risk" && (
              <section role="tabpanel" id="panel-risk" aria-labelledby="tab-risk">
                <RiskView report={R} degraded={degradedSet.has("risk")} degradedReason={degradedReason} />
              </section>
            )}
            {view === "competitors" && (
              <section role="tabpanel" id="panel-competitors" aria-labelledby="tab-competitors">
                <CompetitorView report={R} />
              </section>
            )}
          </div>
        )}
      </main>

      <footer style={{ borderTop: `1px solid ${colors.border}`, padding: `14px ${space.xxxl}px`, display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
        <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 10, color: colors.textMuted }}>CostLens v1.0 — Powered by TinyFish Web Agent</span>
        <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 10, color: colors.textMuted }}>Data is estimated. Not financial advice.</span>
      </footer>
    </div>
  );
}
