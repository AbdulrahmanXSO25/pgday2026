import { getCloudflareContext } from "@opennextjs/cloudflare";

export function getDB(): D1Database {
  const { env } = getCloudflareContext();
  const db = env.DB;
  if (!db) {
    throw new Error(
      "D1 binding `DB` not found. Did you run migrations? (npm run db:migrate:local)"
    );
  }
  return db;
}

export async function findRegistrationByEmail(
  db: D1Database,
  email: string
): Promise<{ id: string } | null> {
  const result = await db
    .prepare("SELECT id FROM registrations WHERE email = ?1")
    .bind(email.trim().toLowerCase())
    .first<{ id: string }>();
  return result ?? null;
}

export async function insertRegistration(
  db: D1Database,
  row: {
    id: string;
    name: string;
    email: string;
    organization?: string;
    role?: string;
    dietaryNotes?: string;
    status: string;
    createdAt: string;
  }
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO registrations (id, name, email, organization, role, dietary_notes, status, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`
    )
    .bind(
      row.id,
      row.name,
      row.email,
      row.organization ?? null,
      row.role ?? null,
      row.dietaryNotes ?? null,
      row.status,
      row.createdAt
    )
    .run();
}
