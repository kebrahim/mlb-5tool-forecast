import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import admin from "firebase-admin";
import { getFirestore } from "firebase-admin/firestore";
import fs from "fs";
import { MLB_TEAMS, DEFAULT_LINES } from "./src/mlbData.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load Firebase Config
const firebaseConfig = JSON.parse(fs.readFileSync(path.join(__dirname, "firebase-applet-config.json"), "utf8"));

// Initialize Firebase Admin (Bypasses rules for server-side sync)
admin.initializeApp({
  projectId: firebaseConfig.projectId
});
const db = getFirestore(firebaseConfig.firestoreDatabaseId);

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  // Debug route
  app.get("/api/db-info", (req, res) => {
    res.json({ 
      projectId: firebaseConfig.projectId,
      databaseId: firebaseConfig.firestoreDatabaseId,
      dbDatabaseId: (db as any)._databaseId || (db as any).databaseId || "unknown"
    });
  });

  // MLB API Sync Logic
  async function syncMLBStats() {
    try {
      // 1. Check if sync is enabled FIRST
      const syncSetting = await db.collection("settings").doc("mlb_sync").get();
      
      if (!syncSetting.exists || !syncSetting.data()?.enabled) {
        // Only log this once in a while or if it was previously enabled to avoid log spam
        return;
      }

      console.log("MLB Stats Sync: Starting update...");
      // 1. Fetch Standings (Wins/Losses)
      const standingsRes = await fetch("https://statsapi.mlb.com/api/v1/standings?leagueId=103,104&season=2026&standingsTypes=regularSeason");
      const standingsData = await standingsRes.json();
      
      const teamStatsMap: Record<string, { wins: number, losses: number }> = {};
      standingsData.records.forEach((record: any) => {
        record.teamRecords.forEach((teamRecord: any) => {
          teamStatsMap[teamRecord.team.id.toString()] = {
            wins: teamRecord.wins,
            losses: teamRecord.losses
          };
        });
      });

      // 2. Fetch Team Lines from Firestore
      let teamLinesSnap = await db.collection("team_lines").get();
      
      // Auto-seed if empty
      if (teamLinesSnap.empty) {
        console.log("team_lines collection is empty. Seeding initial teams...");
        
        const batch = db.batch();
        MLB_TEAMS.forEach(team => {
          const ref = db.collection("team_lines").doc(team.id);
          batch.set(ref, {
            team_name: team.name,
            abbreviation: team.abbr,
            ou_line: DEFAULT_LINES[team.id] || 81.0,
            stats: { wins: 0, losses: 0, hrs: 0, ks: 0 },
            last_sync: new Date().toISOString()
          });
        });
        await batch.commit();
        console.log("Initial teams seeded.");
        teamLinesSnap = await db.collection("team_lines").get();
      }

      // Auto-seed contest if empty
      const contestsSnap = await db.collection("contests").get();
      if (contestsSnap.empty) {
        console.log("contests collection is empty. Seeding initial contest...");
        await db.collection("contests").doc("season_2026").set({
          theme_name: 'Season 2026: Big Bet',
          metric_key: 'wins',
          start_time: new Date('2026-03-25T20:00:00-04:00'),
          end_time: new Date('2026-10-01T00:00:00Z'),
          is_active: true
        });
        console.log("Initial contest seeded.");
      }
      
      for (const teamDoc of teamLinesSnap.docs) {
        const teamId = teamDoc.id;
        const mlbStats = teamStatsMap[teamId];

        if (mlbStats) {
          // Fetch HRs and Ks for each team
          const hittingRes = await fetch(`https://statsapi.mlb.com/api/v1/teams/${teamId}/stats?stats=season&group=hitting&season=2026`);
          const hittingData = await hittingRes.json();
          const hrs = hittingData.stats?.[0]?.splits?.[0]?.stat?.homeRuns || 0;

          const pitchingRes = await fetch(`https://statsapi.mlb.com/api/v1/teams/${teamId}/stats?stats=season&group=pitching&season=2026`);
          const pitchingData = await pitchingRes.json();
          const ks = pitchingData.stats?.[0]?.splits?.[0]?.stat?.strikeOuts || 0;

          await db.collection("team_lines").doc(teamId).update({
            "stats.wins": mlbStats.wins,
            "stats.losses": mlbStats.losses,
            "stats.hrs": hrs,
            "stats.ks": ks,
            last_sync: new Date().toISOString()
          });
        }
      }
      console.log("MLB Stats Sync Completed Successfully.");
    } catch (error: any) {
      // If it's a permission error during the initial check, it might be because the doc doesn't exist yet
      // or the Admin SDK is still warming up. We'll log it more subtly.
      if (error.code === 7 || error.message?.includes("PERMISSION_DENIED")) {
        // Silently fail the check - it will retry on the next interval
        return;
      }
      console.error("MLB Stats Sync: Unexpected error:", error);
    }
  }

  // Run sync every hour
  setInterval(syncMLBStats, 60 * 60 * 1000);
  // Run initial sync after server start (delayed slightly)
  setTimeout(syncMLBStats, 10000);

  // API Routes
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
