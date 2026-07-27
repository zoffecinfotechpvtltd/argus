import { useState } from "react";
import { Navbar } from "./components/Navbar";
import { Hero } from "./components/Hero";
import { Outcomes } from "./components/Outcomes";
import { Comparison } from "./components/Comparison";
import { Features } from "./components/Features";
import { HowItWorks } from "./components/HowItWorks";
import { Alerting } from "./components/Alerting";
import { Pricing } from "./components/Pricing";
import { FAQ } from "./components/FAQ";
import { Contact } from "./components/Contact";
import { Footer } from "./components/Footer";
import { RELEASE } from "./config";

export function App() {
  const [plan, setPlan] = useState("");

  function selectPlan(p: string) {
    setPlan(p);
    document.getElementById("contact")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <div className="min-h-screen bg-canvas font-sans text-fog">
      <Navbar downloadUrl={RELEASE.downloadUrl} />
      <Hero downloadUrl={RELEASE.downloadUrl} version={RELEASE.version} sizeMb={RELEASE.sizeMb} />
      <Outcomes />
      <Comparison />
      <Features />
      <HowItWorks />
      <Alerting />
      <Pricing onSelectPlan={selectPlan} />
      <FAQ />
      <Contact plan={plan} onPlanChange={setPlan} />
      <Footer downloadUrl={RELEASE.downloadUrl} version={RELEASE.version} builtDate={RELEASE.builtDate} />
    </div>
  );
}
