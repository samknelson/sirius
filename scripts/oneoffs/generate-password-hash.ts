/**
 * Generate a bcrypt hash for the local auth provider.
 *
 * Usage:
 *   npx tsx scripts/oneoffs/generate-password-hash.ts            # prompts (no echo to shell history)
 *   npx tsx scripts/oneoffs/generate-password-hash.ts 'MyPass!'  # or pass as an argument
 *
 * The printed hash goes into the LOCAL_AUTH_PASSWORD_HASH environment
 * variable (paired with LOCAL_AUTH_EMAIL). The plaintext password is never
 * stored anywhere.
 *
 * PEPPER: if the target deployment sets AUTH_LOCAL_PEPPER, the provider
 * verifies bcrypt(password + pepper), so the hash MUST be generated the
 * same way. Set AUTH_LOCAL_PEPPER in the environment when running this
 * script and it will be appended automatically:
 *   AUTH_LOCAL_PEPPER='same-pepper-as-deployment' npx tsx scripts/oneoffs/generate-password-hash.ts
 *
 * NOTE for ECS/JSON contexts: bcrypt hashes contain `$` characters. When
 * placing the hash in a JSON env file or shell, quote it with single quotes
 * so nothing tries to expand `$2b` etc.
 */
import bcrypt from "bcrypt";
import * as readline from "node:readline";

const COST = 12;

async function promptPassword(): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question("Password to hash: ", (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

async function main() {
  const password = process.argv[2] ?? (await promptPassword());

  if (!password || password.length < 8) {
    console.error("Refusing to hash: password must be at least 8 characters.");
    process.exit(1);
  }
  // Match the provider: it verifies bcrypt(password + pepper) when
  // AUTH_LOCAL_PEPPER is configured, so hash the same concatenation.
  const pepper = process.env.AUTH_LOCAL_PEPPER || "";
  const material = password + pepper;

  if (Buffer.byteLength(material, "utf8") > 72) {
    console.error("Refusing to hash: bcrypt only uses the first 72 bytes (password + pepper combined); choose a shorter password.");
    process.exit(1);
  }

  const hash = await bcrypt.hash(material, COST);

  // Sanity check the round trip before printing.
  const ok = await bcrypt.compare(material, hash);
  if (!ok) {
    console.error("Self-check failed: generated hash did not verify. Aborting.");
    process.exit(1);
  }

  console.log("\nbcrypt hash (put this in LOCAL_AUTH_PASSWORD_HASH):\n");
  console.log(hash);
  if (pepper) {
    console.log("\nNOTE: AUTH_LOCAL_PEPPER was applied. This hash only works on deployments with the same pepper.");
  }
  console.log("\nRemember to single-quote it in shells / escape nothing in JSON.");
}

main().catch((err) => {
  console.error("Failed to generate hash:", err);
  process.exit(1);
});
