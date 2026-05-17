import fs from 'fs';
import path from 'path';
import { PrismaClient, Prisma } from '@prisma/client';
import { PrismaClient as GazellePrismaClient, Prisma as GazellePrisma } from 'gazelle-client';

type Mode = 'dry-run' | 'write';

interface Options {
  mode: Mode;
  batchSize: number;
  onlyMissing: boolean;
  force: boolean;
  userId: number | null;
  connectionId: string | null;
  includeOAuth: boolean;
  includeTokens: boolean;
  reportJson: string | null;
}

interface GazelleUserInstitution {
  userId: number;
  username: string;
  institutionId: number | null;
  institutionName: string | null;
  institutionKeyword: string | null;
  institutionActivated: boolean | null;
}

interface SectionReport {
  scanned: number;
  updated: number;
  wouldUpdate: number;
  alreadyCurrent: number;
  skipped: number;
  mismatched: number;
  overwrittenMismatch: number;
}

interface MergeReport {
  mode: Mode;
  options: Omit<Options, 'mode'>;
  started_at: string;
  finished_at: string | null;
  duration_ms: number | null;
  connections: SectionReport & {
    anonymous: number;
    missingGazelleUser: number;
    missingGazelleInstitution: number;
    tokenValidityUnknown: number;
    tokenValidityCleared: number;
    tokenValidityWouldClear: number;
  };
  participant_tokens: SectionReport & {
    enabled: boolean;
    missingGazelleUser: number;
    missingGazelleInstitution: number;
  };
  oauth_pipelines: SectionReport & {
    enabled: boolean;
    fromTokenIssueConnection: number;
    fromParticipantUser: number;
    missingSource: number;
    missingGazelleUser: number;
    missingGazelleInstitution: number;
  };
  warnings: string[];
}

function emptySection(): SectionReport {
  return {
    scanned: 0,
    updated: 0,
    wouldUpdate: 0,
    alreadyCurrent: 0,
    skipped: 0,
    mismatched: 0,
    overwrittenMismatch: 0,
  };
}

function printHelp() {
  console.log(`Usage:
  npm run db:merge:traffic-institutions -- [options]

Options:
  --dry-run                    Read and report only. Default when --write is omitted.
  --write                      Persist updates to Prism DB.
  --batch-size=<n>             Batch size for reads. Default: 1000.
  --only-missing               Only scan rows whose target institution field is null.
  --force                      Overwrite existing institution values when Gazelle differs.
  --user-id=<id>               Limit work to one Gazelle/Prism user id.
  --connection-id=<uuid>       Limit connection work to one connection id.
  --include-oauth              Backfill oauth_pipelines.participant_institution_id.
  --include-tokens             Backfill participant_tokens.institution_id.
  --report-json=<path>         Write the final report as JSON.
  --help                       Show this help.
`);
}

function parsePositiveInt(value: string, flag: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${flag} must be a positive integer`);
  }
  return parsed;
}

function parseArgs(argv: string[]): Options {
  let write = false;
  let dryRun = false;
  const options: Options = {
    mode: 'dry-run',
    batchSize: 1000,
    onlyMissing: false,
    force: false,
    userId: null,
    connectionId: null,
    includeOAuth: false,
    includeTokens: false,
    reportJson: null,
  };

  for (const arg of argv) {
    if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }
    if (arg === '--dry-run') {
      dryRun = true;
      continue;
    }
    if (arg === '--write') {
      write = true;
      continue;
    }
    if (arg === '--only-missing') {
      options.onlyMissing = true;
      continue;
    }
    if (arg === '--force') {
      options.force = true;
      continue;
    }
    if (arg === '--include-oauth') {
      options.includeOAuth = true;
      continue;
    }
    if (arg === '--include-tokens') {
      options.includeTokens = true;
      continue;
    }
    if (arg.startsWith('--batch-size=')) {
      options.batchSize = parsePositiveInt(arg.slice('--batch-size='.length), '--batch-size');
      continue;
    }
    if (arg.startsWith('--user-id=')) {
      options.userId = parsePositiveInt(arg.slice('--user-id='.length), '--user-id');
      continue;
    }
    if (arg.startsWith('--connection-id=')) {
      const id = arg.slice('--connection-id='.length).trim();
      if (!id) throw new Error('--connection-id cannot be empty');
      options.connectionId = id;
      continue;
    }
    if (arg.startsWith('--report-json=')) {
      const reportPath = arg.slice('--report-json='.length).trim();
      if (!reportPath) throw new Error('--report-json cannot be empty');
      options.reportJson = reportPath;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (write && dryRun) throw new Error('Use either --write or --dry-run, not both');
  options.mode = write ? 'write' : 'dry-run';
  return options;
}

function stripInlineComment(value: string): string {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < value.length; i += 1) {
    const ch = value[i];
    const prev = i > 0 ? value[i - 1] : '';
    if (ch === "'" && !inDouble) inSingle = !inSingle;
    if (ch === '"' && !inSingle) inDouble = !inDouble;
    if (ch === '#' && !inSingle && !inDouble && (i === 0 || /\s/.test(prev))) {
      return value.slice(0, i).trim();
    }
  }
  return value.trim();
}

function unquote(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function loadDotEnvIfPresent() {
  const envPath = path.resolve(process.cwd(), '.env');
  if (!fs.existsSync(envPath)) return;
  const content = fs.readFileSync(envPath, 'utf8');
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    const value = unquote(stripInlineComment(line.slice(eq + 1)));
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function env(name: string, fallback: string): string {
  return process.env[name] || fallback;
}

function buildPostgresUrl(user: string, pass: string, host: string, port: string, db: string, ssl: boolean): string {
  const sslParam = ssl ? '?sslmode=require' : '';
  return `postgresql://${user}:${encodeURIComponent(pass)}@${host}:${port}/${db}${sslParam}`;
}

function configureDatabaseUrls() {
  loadDotEnvIfPresent();

  if (!process.env.PRISM_DATABASE_URL) {
    process.env.PRISM_DATABASE_URL = buildPostgresUrl(
      env('PROXY_DB_USER', 'prism'),
      requireEnv('PROXY_DB_PASS'),
      env('PROXY_DB_HOST', 'postgres-prism'),
      env('PROXY_DB_PORT', '5432'),
      env('PROXY_DB_NAME', 'prism'),
      false,
    );
  }

  if (!process.env.GAZELLE_DATABASE_URL) {
    process.env.GAZELLE_DATABASE_URL = buildPostgresUrl(
      requireEnv('GAZELLE_DB_USER'),
      requireEnv('GAZELLE_DB_PASS'),
      requireEnv('GAZELLE_DB_HOST'),
      env('GAZELLE_DB_PORT', '5432'),
      env('GAZELLE_DB_NAME', 'gazelle'),
      env('GAZELLE_DB_SSL', 'false') === 'true',
    );
  }
}

function makeReport(options: Options): MergeReport {
  const { mode, ...rest } = options;
  return {
    mode,
    options: rest,
    started_at: new Date().toISOString(),
    finished_at: null,
    duration_ms: null,
    connections: {
      ...emptySection(),
      anonymous: 0,
      missingGazelleUser: 0,
      missingGazelleInstitution: 0,
      tokenValidityUnknown: 0,
      tokenValidityCleared: 0,
      tokenValidityWouldClear: 0,
    },
    participant_tokens: {
      ...emptySection(),
      enabled: options.includeTokens,
      missingGazelleUser: 0,
      missingGazelleInstitution: 0,
    },
    oauth_pipelines: {
      ...emptySection(),
      enabled: options.includeOAuth,
      fromTokenIssueConnection: 0,
      fromParticipantUser: 0,
      missingSource: 0,
      missingGazelleUser: 0,
      missingGazelleInstitution: 0,
    },
    warnings: [],
  };
}

function uniqueNumbers(values: Array<number | null | undefined>): number[] {
  return [...new Set(values.filter((v): v is number => typeof v === 'number' && Number.isFinite(v)))];
}

async function loadGazelleInstitutions(
  gazelle: GazellePrismaClient,
  userIds: Array<number | null | undefined>,
): Promise<Map<number, GazelleUserInstitution>> {
  const ids = uniqueNumbers(userIds);
  if (ids.length === 0) return new Map();

  const rows = await gazelle.$queryRaw<GazelleUserInstitution[]>`
    SELECT
      u.id AS "userId",
      u.username AS "username",
      u.institution_id AS "institutionId",
      i.name AS "institutionName",
      i.keyword AS "institutionKeyword",
      i.activated AS "institutionActivated"
    FROM usr_users u
    LEFT JOIN usr_institution i ON i.id = u.institution_id
    WHERE u.id IN (${GazellePrisma.join(ids)})
  `;

  return new Map(rows.map((row) => [row.userId, row]));
}

function shouldSetInstitution(input: {
  currentInstitutionId: number | null;
  targetInstitutionId: number;
  options: Options;
  section: SectionReport;
}): boolean {
  const { currentInstitutionId, targetInstitutionId, options, section } = input;
  if (currentInstitutionId === targetInstitutionId) {
    section.alreadyCurrent += 1;
    return false;
  }
  if (currentInstitutionId !== null && !options.force) {
    section.mismatched += 1;
    section.skipped += 1;
    return false;
  }
  if (currentInstitutionId !== null && options.force) {
    section.overwrittenMismatch += 1;
  }
  return true;
}

async function persistOrCount(
  options: Options,
  section: SectionReport,
  persist: () => Promise<unknown>,
) {
  if (options.mode === 'dry-run') {
    section.wouldUpdate += 1;
    return;
  }
  await persist();
  section.updated += 1;
}

async function processConnections(prism: PrismaClient, gazelle: GazellePrismaClient, options: Options, report: MergeReport) {
  console.log('Scanning connections...');
  const where: Prisma.ConnectionWhereInput = {};
  if (options.onlyMissing) where.institutionId = null;
  if (options.userId !== null) where.userId = options.userId;
  if (options.connectionId !== null) where.id = options.connectionId;

  let cursor: string | undefined;
  for (;;) {
    const rows = await prism.connection.findMany({
      where,
      orderBy: { id: 'asc' },
      take: options.batchSize,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true,
        userId: true,
        institutionId: true,
        participantTokenPresent: true,
        participantTokenValid: true,
        participantTokenInvalidReason: true,
      },
    });
    if (rows.length === 0) break;
    cursor = rows[rows.length - 1].id;

    const gazelleByUser = await loadGazelleInstitutions(gazelle, rows.map((row) => row.userId));

    for (const row of rows) {
      report.connections.scanned += 1;
      const updateData: Prisma.ConnectionUpdateInput = {};

      if (row.participantTokenPresent && row.participantTokenValid === null) {
        report.connections.tokenValidityUnknown += 1;
      }
      if (!row.participantTokenPresent && (row.participantTokenValid !== null || row.participantTokenInvalidReason !== null)) {
        updateData.participantTokenValid = null;
        updateData.participantTokenInvalidReason = null;
        if (options.mode === 'dry-run') report.connections.tokenValidityWouldClear += 1;
        else report.connections.tokenValidityCleared += 1;
      }

      if (row.userId === null) {
        report.connections.anonymous += 1;
      } else {
        const gazelleUser = gazelleByUser.get(row.userId);
        if (!gazelleUser) {
          report.connections.missingGazelleUser += 1;
        } else if (gazelleUser.institutionId === null) {
          report.connections.missingGazelleInstitution += 1;
        } else if (shouldSetInstitution({
          currentInstitutionId: row.institutionId,
          targetInstitutionId: gazelleUser.institutionId,
          options,
          section: report.connections,
        })) {
          updateData.institutionId = gazelleUser.institutionId;
        }
      }

      if (Object.keys(updateData).length > 0) {
        await persistOrCount(options, report.connections, () => prism.connection.update({
          where: { id: row.id },
          data: updateData,
        }));
      }
    }
  }
}

async function resolveTokenUserFilter(prism: PrismaClient, options: Options): Promise<number | null | undefined> {
  if (options.userId !== null) return options.userId;
  if (options.connectionId === null) return undefined;
  const connection = await prism.connection.findUnique({
    where: { id: options.connectionId },
    select: { userId: true },
  });
  return connection?.userId ?? null;
}

async function processParticipantTokens(
  prism: PrismaClient,
  gazelle: GazellePrismaClient,
  options: Options,
  report: MergeReport,
) {
  if (!options.includeTokens) return;
  console.log('Scanning participant tokens...');

  const userFilter = await resolveTokenUserFilter(prism, options);
  if (userFilter === null) {
    report.warnings.push('Skipped participant_tokens because the selected connection has no user_id.');
    return;
  }

  const where: Prisma.ParticipantTokenWhereInput = {};
  if (options.onlyMissing) where.institutionId = null;
  if (userFilter !== undefined) where.userId = userFilter;

  let cursor: string | undefined;
  for (;;) {
    const rows = await prism.participantToken.findMany({
      where,
      orderBy: { id: 'asc' },
      take: options.batchSize,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true,
        userId: true,
        institutionId: true,
      },
    });
    if (rows.length === 0) break;
    cursor = rows[rows.length - 1].id;

    const gazelleByUser = await loadGazelleInstitutions(gazelle, rows.map((row) => row.userId));

    for (const row of rows) {
      report.participant_tokens.scanned += 1;
      const gazelleUser = gazelleByUser.get(row.userId);
      if (!gazelleUser) {
        report.participant_tokens.missingGazelleUser += 1;
        continue;
      }
      if (gazelleUser.institutionId === null) {
        report.participant_tokens.missingGazelleInstitution += 1;
        continue;
      }
      if (!shouldSetInstitution({
        currentInstitutionId: row.institutionId,
        targetInstitutionId: gazelleUser.institutionId,
        options,
        section: report.participant_tokens,
      })) {
        continue;
      }

      await persistOrCount(options, report.participant_tokens, () => prism.participantToken.update({
        where: { id: row.id },
        data: { institutionId: gazelleUser.institutionId },
      }));
    }
  }
}

async function processOAuthPipelines(
  prism: PrismaClient,
  gazelle: GazellePrismaClient,
  options: Options,
  report: MergeReport,
) {
  if (!options.includeOAuth) return;
  console.log('Scanning OAuth pipelines...');

  const where: Prisma.OAuthPipelineWhereInput = {};
  if (options.onlyMissing) where.participantInstitutionId = null;
  if (options.userId !== null) where.participantUserId = options.userId;
  if (options.connectionId !== null) where.tokenIssueConnectionId = options.connectionId;

  let cursor: string | undefined;
  for (;;) {
    const rows = await prism.oAuthPipeline.findMany({
      where,
      orderBy: { id: 'asc' },
      take: options.batchSize,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true,
        participantUserId: true,
        participantInstitutionId: true,
        tokenIssueConnection: {
          select: {
            userId: true,
            institutionId: true,
          },
        },
      },
    });
    if (rows.length === 0) break;
    cursor = rows[rows.length - 1].id;

    const gazelleByUser = await loadGazelleInstitutions(
      gazelle,
      rows.map((row) => row.tokenIssueConnection?.userId ?? row.participantUserId),
    );

    for (const row of rows) {
      report.oauth_pipelines.scanned += 1;
      let targetInstitutionId: number | null = row.tokenIssueConnection?.institutionId ?? null;
      let fallbackUserId: number | null = null;

      if (targetInstitutionId !== null) {
        report.oauth_pipelines.fromTokenIssueConnection += 1;
      } else {
        fallbackUserId = row.tokenIssueConnection?.userId ?? row.participantUserId;
        if (fallbackUserId === null) {
          report.oauth_pipelines.missingSource += 1;
          continue;
        }
        const gazelleUser = gazelleByUser.get(fallbackUserId);
        if (!gazelleUser) {
          report.oauth_pipelines.missingGazelleUser += 1;
          continue;
        }
        if (gazelleUser.institutionId === null) {
          report.oauth_pipelines.missingGazelleInstitution += 1;
          continue;
        }
        targetInstitutionId = gazelleUser.institutionId;
        report.oauth_pipelines.fromParticipantUser += 1;
      }

      if (!shouldSetInstitution({
        currentInstitutionId: row.participantInstitutionId,
        targetInstitutionId,
        options,
        section: report.oauth_pipelines,
      })) {
        continue;
      }

      await persistOrCount(options, report.oauth_pipelines, () => prism.oAuthPipeline.update({
        where: { id: row.id },
        data: { participantInstitutionId: targetInstitutionId },
      }));
    }
  }
}

function summarizeSection(label: string, section: SectionReport) {
  console.log(`${label}: scanned=${section.scanned}, updated=${section.updated}, wouldUpdate=${section.wouldUpdate}, alreadyCurrent=${section.alreadyCurrent}, mismatched=${section.mismatched}, skipped=${section.skipped}`);
}

async function writeReportIfRequested(options: Options, report: MergeReport) {
  if (!options.reportJson) return;
  const outPath = path.resolve(process.cwd(), options.reportJson);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`Wrote report JSON: ${outPath}`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  configureDatabaseUrls();

  const prism = new PrismaClient();
  const gazelle = new GazellePrismaClient();
  const report = makeReport(options);
  const started = Date.now();

  console.log(`Mode: ${options.mode}`);
  if (options.mode === 'dry-run') {
    console.log('No Prism DB rows will be changed. Pass --write to persist updates.');
  }

  try {
    await processConnections(prism, gazelle, options, report);
    await processParticipantTokens(prism, gazelle, options, report);
    await processOAuthPipelines(prism, gazelle, options, report);
  } finally {
    await Promise.allSettled([prism.$disconnect(), gazelle.$disconnect()]);
  }

  report.finished_at = new Date().toISOString();
  report.duration_ms = Date.now() - started;

  summarizeSection('connections', report.connections);
  if (options.includeTokens) summarizeSection('participant_tokens', report.participant_tokens);
  if (options.includeOAuth) summarizeSection('oauth_pipelines', report.oauth_pipelines);
  if (report.warnings.length > 0) {
    console.warn(`Warnings:\n${report.warnings.map((w) => `- ${w}`).join('\n')}`);
  }

  await writeReportIfRequested(options, report);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
