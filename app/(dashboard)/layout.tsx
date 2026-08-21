import { Nav } from "./nav";

// Shared layout for every screen under the (dashboard) route group.
// Until now, each screen (projects, forms, responses, dashboard,
// analysis) was fully standalone with its own header and NO link to any
// other screen -- a real, accumulated gap across four prior sessions:
// a user landing on /projects after login had no way to discover
// /dashboard, /forms, /responses, or /analysis except by typing a URL
// directly. Adding this now, at the point a 5th top-level screen
// (analysis) is introduced, rather than letting the gap compound
// further.
export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen" style={{ background: "var(--paper)" }}>
      <Nav />
      {children}
    </div>
  );
}
