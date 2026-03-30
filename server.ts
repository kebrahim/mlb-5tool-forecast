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
const db = getFirestore(firebaseConfig.firestoreDatabaseId || "(default)");

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

  // The MLB Stats Sync has been moved to the frontend (Admin.tsx) 
  // to ensure it uses the correct user permissions.
  // Server-side background sync is currently disabled due to cross-project permission constraints.

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
