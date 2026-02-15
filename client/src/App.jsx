import { useState, useCallback, useRef, useEffect } from "react";
import { normalizeReport } from "./utils/report";
import { ScanOverlay } from "./components/ScanOverlay";
import { AppHeader } from "./components/AppHeader";
import { LandingView } from "./views/LandingView";
import { ReportSummary } from "./components/ReportSummary";
import { InfraView } from "./views/InfraView";
import { BuildView } from "./views/BuildView";
import { BuyerView } from "./views/BuyerView";
import { colors, space } from "./styles/tokens";

export default function App() {
  const [view, setView] = useState(null); // null = landing, "infra" | "build" | "buyer"
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

  const actions = [
    "Fingerprinting tech stack via HTTP headers...",
    "Extracting client-side JavaScript bundles...",
    "Detecting cloud provider from CDN signatures...",
    "Mapping API endpoints and database patterns...",
    "Crawling Cloudflare Radar for traffic estimates...",
    "Scanning LinkedIn for engineering headcount...",
    "Extracting salary data from Glassdoor...",
    "Analyzing pricing page for hidden costs...",
    "Cross-referencing G2 reviews for overage complaints...",
    "Checking Crunchbase for revenue estimates...",
    "Estimating infrastructure costs via AWS Calculator...",
    "AI synthesizing cost model...",
  ];

  const POLL_INTERVAL_MS = 3500;
  const POLL_TIMEOUT_MS = 5 * 60 * 1000; // 5 min max polling (TinyFish runs async on their side)

  const runScan = useCallback(async () => {
    const target = url.trim();
    if (!target || scanning) return;

    setScanError("");
    setResults(null);
    setView(null);
    setScanning(true);
    setProgress(5);
    setAction("Starting investigation (async)...");
    setScanPlatforms(["Target Site", "GitHub", "LinkedIn", "Glassdoor", "Levels.fyi", "AWS Calculator", "Cloudflare Radar", "SimilarWeb", "G2", "Reddit"]);

    try {
      const startRes = await fetch("/api/investigate/async", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: target }),
      });
      if (!startRes.ok) {
        const data = await startRes.json().catch(() => ({}));
        throw new Error(data?.error || startRes.statusText || "Failed to start investigation.");
      }
      const { runIds, domain, name } = await startRes.json();
      if (!runIds?.infra && !runIds?.build && !runIds?.buyer) {
        throw new Error("No run IDs returned. Check API keys and try again.");
      }

      setProgress(15);
      setAction("Running scans in background...");

      const pollStart = Date.now();
      let lastProgress = 15;
      while (Date.now() - pollStart < POLL_TIMEOUT_MS) {
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
        const pollRes = await fetch("/api/investigate/async/poll", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ runIds, domain, name }),
        });
        if (!pollRes.ok) {
          const data = await pollRes.json().catch(() => ({}));
          throw new Error(data?.error || "Poll failed.");
        }
        const data = await pollRes.json();
        if (data.status === "complete") {
          setProgress(100);
          setAction("Investigation complete");
          setResults(data.report);
          setView("infra");
          setScanning(false);
          return;
        }
        const runs = data.runs || {};
        const done = [runs.infra, runs.build, runs.buyer].filter((s) => s === "COMPLETED" || s === "FAILED").length;
        lastProgress = 20 + Math.round((done / 3) * 60);
        setProgress(lastProgress);
        setAction(`Waiting for scans... (${done}/3 done)`);
      }
      throw new Error("Investigation took too long. Try again or use a simpler URL.");
    } catch (err) {
      setScanError(err?.message || "Investigation failed. Please try again.");
    } finally {
      setScanning(false);
    }
  }, [scanning, url]);

  const hasResults = Boolean(results);
  const R = normalizeReport(results);
  const degradedSet = new Set(R.quality.degradedPillars || []);
  const tabMeta = [
    ["infra", "Their Cost"],
    ["build", "Build Cost"],
    ["buyer", "Your Cost"],
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

      <AppHeader hasResults={hasResults} view={view} onViewChange={setView} tabMeta={tabMeta} degradedSet={degradedSet} degradedReason={degradedReason} />

      <main id="main-content" ref={mainRef} tabIndex={-1} style={{ maxWidth: hasResults ? 1000 : undefined, width: "100%", margin: "0 auto", padding: hasResults ? `${space.xl}px ${space.xxl}px 64px` : 0 }} aria-label="Main content">
        {!hasResults && (
          <LandingView
            url={url}
            setUrl={setUrl}
            runScan={runScan}
            scanning={scanning}
            scanError={scanError}
            onClearError={() => setScanError("")}
          />
        )}

        {hasResults && (
          <div style={{ display: "flex", flexDirection: "column", gap: space.lg }}>
            <ReportSummary report={R} />
            {view === "infra" && (
              <InfraView
                report={R}
                degraded={degradedSet.has("infra")}
                degradedReason={degradedReason}
                expandedInfra={expandedInfra}
                setExpandedInfra={setExpandedInfra}
              />
            )}
            {view === "build" && (
              <BuildView
                report={R}
                degraded={degradedSet.has("build")}
                degradedReason={degradedReason}
                expandedBuild={expandedBuild}
                setExpandedBuild={setExpandedBuild}
              />
            )}
            {view === "buyer" && <BuyerView report={R} degraded={degradedSet.has("buyer")} degradedReason={degradedReason} />}
          </div>
        )}
      </main>

      <footer style={{ borderTop: `1px solid ${colors.border}`, padding: `14px ${space.xxxl}px`, display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
        <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 10, color: colors.textMuted }}>NakedSaaS v1.0 — A TinyFish Web Agent by TinyFish Solutions showcase</span>
        <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 10, color: colors.textMuted }}>Data is estimated. Not financial advice.</span>
      </footer>
    </div>
  );
}
