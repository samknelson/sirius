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

interface ClientConfig {
  clientId: string;
  neonProjectId: string;
}

function detectClient(branchName: string): ClientConfig {
  const clientMappings: { prefix: string; clientId: string; envVar: string }[] = [
    { prefix: "dev-hta", clientId: "hta", envVar: "NEON_PROJECT_ID_HTA" },
    { prefix: "dev-btu", clientId: "btu", envVar: "NEON_PROJECT_ID_BTU" },
  ];

  for (const mapping of clientMappings) {
    if (branchName.startsWith(mapping.prefix)) {
      const projectId = getEnv(mapping.envVar);
      if (projectId) {
        console.log(`🏢 Detected client: ${mapping.clientId.toUpperCase()} (from branch prefix: ${mapping.prefix})`);
        return { clientId: mapping.clientId, neonProjectId: projectId };
      } else {
        console.warn(`⚠️ Branch matches ${mapping.clientId.toUpperCase()} but ${mapping.envVar} is not set, falling back to default`);
      }
    }
  }

  const defaultProjectId = getEnv("NEON_PROJECT_ID");
  if (!defaultProjectId) {
    console.error("❌ FATAL: No matching client Neon project ID found and NEON_PROJECT_ID fallback is not set");
    console.error("Set NEON_PROJECT_ID_HTA, NEON_PROJECT_ID_BTU, or NEON_PROJECT_ID in Flight Control environment variables");
    process.exit(1);
  }

  console.log("🏢 No specific client detected, using default NEON_PROJECT_ID");
  return { clientId: "default", neonProjectId: defaultProjectId };
}

async function provisionPreviewDatabase(): Promise<string> {
  const NEON_API_KEY = getEnv("NEON_API_KEY");
  
  if (!NEON_API_KEY) {
    console.error("❌ FATAL: NEON_API_KEY is required for preview environments");
    console.error("Set NEON_API_KEY in Flight Control environment variables");
    process.exit(1);
  }
  
  const client = detectClient(GIT_BRANCH);
  const NEON_PROJECT_ID = client.neonProjectId;
  
  console.log("🚀 Neon Preview Database Provisioning (Runtime)");
  console.log(`📌 Git Branch: ${GIT_BRANCH}`);
  console.log(`🏢 Client: ${client.clientId.toUpperCase()}`);
  console.log(`📦 Neon Project: ${NEON_PROJECT_ID}`);
  
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
    console.log(`📝 Branch not found, creating clone from production data...`);
    
    console.log(`📋 Available branches in project ${NEON_PROJECT_ID}:`);
    for (const b of branches) {
      console.log(`   - ${b.name} (ID: ${b.id}, primary: ${b.primary || false})`);
    }

    const parentBranch = branches.find((b: Branch) => b.primary)
      || branches.find((b: Branch) => b.name === "main");
    
    if (!parentBranch) {
      throw new Error("Could not find primary branch to fork from. Available branches: " + branches.map(b => b.name).join(", "));
    }

    console.log(`🔀 Cloning from: ${parentBranch.name} (ID: ${parentBranch.id}, primary: ${parentBranch.primary || false})`);

    const { data: createResponse } = await neonClient.createProjectBranch(NEON_PROJECT_ID, {
      branch: {
        name: branchName,
        parent_id: parentBranch.id,
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
