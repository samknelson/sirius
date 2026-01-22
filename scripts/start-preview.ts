#!/usr/bin/env node
import { spawn } from "child_process";
import { createApiClient, type Branch, EndpointType } from "@neondatabase/api-client";

const GIT_BRANCH = process.env.FC_GIT_BRANCH || process.env.GITHUB_HEAD_REF || process.env.GIT_BRANCH || "preview";

function getEnv(name: string): string | undefined {
  return process.env[name];
}

function sanitizeBranchName(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9-_]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .substring(0, 63);
}

async function provisionPreviewDatabase(): Promise<string> {
  const NEON_API_KEY = getEnv("NEON_API_KEY");
  const NEON_PROJECT_ID = getEnv("NEON_PROJECT_ID");
  
  if (!NEON_API_KEY) {
    console.error("❌ FATAL: NEON_API_KEY is required for preview environments");
    console.error("Set NEON_API_KEY in Flight Control environment variables");
    process.exit(1);
  }
  
  if (!NEON_PROJECT_ID) {
    console.error("❌ FATAL: NEON_PROJECT_ID is required for preview environments");
    console.error("Set NEON_PROJECT_ID in Flight Control environment variables");
    process.exit(1);
  }
  
  console.log("🚀 Neon Preview Database Provisioning (Runtime)");
  console.log(`📌 Git Branch: ${GIT_BRANCH}`);
  
  const neonClient = createApiClient({
    apiKey: NEON_API_KEY,
  });

  const branchName = `preview-${sanitizeBranchName(GIT_BRANCH)}`;
  console.log(`🔍 Looking for Neon branch: ${branchName}`);

  const { data: branchesResponse } = await neonClient.listProjectBranches({ projectId: NEON_PROJECT_ID });
  const branches = branchesResponse.branches || [];
  
  let targetBranch: Branch | undefined = branches.find(
    (b: Branch) => b.name === branchName
  );

  if (targetBranch) {
    console.log(`✅ Found existing branch: ${branchName} (ID: ${targetBranch.id})`);
  } else {
    console.log(`📝 Branch not found, creating new branch from main...`);
    
    const mainBranch = branches.find((b: Branch) => b.name === "main" || b.primary);
    
    if (!mainBranch) {
      throw new Error("Could not find main/primary branch to fork from");
    }

    console.log(`🔀 Forking from: ${mainBranch.name} (ID: ${mainBranch.id})`);

    const { data: createResponse } = await neonClient.createProjectBranch(NEON_PROJECT_ID, {
      branch: {
        name: branchName,
        parent_id: mainBranch.id,
      },
      endpoints: [
        {
          type: EndpointType.ReadWrite,
        },
      ],
    });

    targetBranch = createResponse.branch;
    console.log(`✅ Created new branch: ${branchName} (ID: ${targetBranch.id})`);
  }

  const { data: endpointsResponse } = await neonClient.listProjectBranchEndpoints(
    NEON_PROJECT_ID,
    targetBranch.id
  );
  
  const endpoints = endpointsResponse.endpoints || [];
  const endpoint = endpoints[0];

  if (!endpoint) {
    throw new Error("No endpoint found for the branch");
  }

  const { data: passwordResponse } = await neonClient.getProjectBranchRolePassword(
    NEON_PROJECT_ID,
    targetBranch.id,
    "neondb_owner"
  );

  const password = passwordResponse.password;
  const host = endpoint.host;
  const database = "neondb";
  const user = "neondb_owner";

  const connectionString = `postgresql://${user}:${password}@${host}/${database}?sslmode=require`;
  
  console.log(`🔗 Connection endpoint: ${host}`);
  console.log(`📊 Database: ${database}`);
  console.log("✨ Preview database provisioning complete!");
  
  return connectionString;
}

async function main() {
  try {
    console.log("=".repeat(60));
    console.log("PREVIEW ENVIRONMENT STARTUP");
    console.log("=".repeat(60));
    
    const databaseUrl = await provisionPreviewDatabase();
    
    const env = { ...process.env };
    env.DATABASE_URL = databaseUrl;
    
    console.log("");
    console.log("📊 DATABASE_URL set to preview branch");
    console.log(`🌿 Branch: preview-${sanitizeBranchName(GIT_BRANCH)}`);
    console.log("=".repeat(60));
    console.log("🚀 Starting application...\n");
    
    const child = spawn("node", ["dist/server/index.js"], {
      env,
      stdio: "inherit",
      cwd: process.cwd(),
    });
    
    child.on("error", (err) => {
      console.error("Failed to start application:", err);
      process.exit(1);
    });
    
    child.on("exit", (code) => {
      process.exit(code || 0);
    });
    
  } catch (error) {
    console.error("❌ Error during preview startup:", error);
    process.exit(1);
  }
}

main();
